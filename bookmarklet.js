/*
 * セルフメディケーション税制チェッカー — オールインワン・ブックマークレット（正本）
 *
 * 役割（Amazon注文履歴ページ上で全部完結する）:
 *   1. 自サイトから medicines.json を取得（Amazonの強制CSPは script/connect を制限しないため fetch 可）
 *   2. ページ全体のテキストを走査し、対象品目リストと「構造に依存せず」照合
 *      （Amazonのclass名やDOM変更に強い。PC/スマホ/他サイトでも動く）
 *   3. ページ上にオーバーレイで判定結果を表示（合計購入額を入力 → 判定・節税額）
 *
 * このファイルが唯一の正本。index.html が実行時に fetch し、下記2つの
 *   プレースホルダ（データURL・サイトURL）を全件置換して javascript: 登録リンクを生成する。
 *   手動コピー用は scripts/build_bookmarklet.mjs で bookmarklet.min.txt を生成。
 */
(function () {
  "use strict";
  var DATA_URL = "__DATA_URL__"; // 例: https://your-site/data/medicines.json
  var SITE = "__SITE__";         // 自サイトURL（「詳しく見る」用）
  var MIN_MATCH_LEN = 4;         // 部分一致に使う販売名の最小正規化長（誤検知抑制）
  var THRESHOLD = 12000, DEDUCT_CAP = 88000, RESIDENT = 0.10;
  var RATES = [0.05, 0.10, 0.20, 0.23, 0.33];

  // 二重起動防止
  if (document.getElementById("smtc-overlay-host")) {
    document.getElementById("smtc-overlay-host").remove();
  }

  // --- 正規化（build_medicines.py / index.html と同一ルール） ---
  var BR = /[【〔\[(（][^】〕\])）]*[】〕\])）]/g;
  var SY = /[\s　・,，.。/／\\\-－—–~〜=＝!！?？"'’＇`*＊#＃&＆+＋:：;；]/g;
  function norm(s) {
    if (!s) return "";
    return String(s).normalize("NFKC").replace(BR, "").toLowerCase().replace(SY, "");
  }

  function toast(msg) { alert(msg); }

  // 正規化済みテキスト -> 対象品目（最長一致）。なければ null
  function matchOne(nt, MED) {
    var best = null;
    for (var i = 0; i < MED.length; i++) {
      var k = MED[i].k;
      if (k.length < MIN_MATCH_LEN) { if (k === nt && (!best || k.length > best.k.length)) best = MED[i]; continue; }
      if (nt.indexOf(k) !== -1 && (!best || k.length > best.k.length)) best = MED[i];
    }
    return best;
  }

  // 価格パターン（¥1,980 / 1,980円 など）
  var PRICE_RE = /[¥￥]\s?([\d,]{2,})|([\d,]{2,})\s?円/;
  // ある要素テキストから妥当な価格(数値)を1つ取り出す
  function priceInText(txt) {
    var m = txt && txt.match(PRICE_RE);
    if (!m) return null;
    var v = parseInt((m[1] || m[2] || "").replace(/,/g, ""), 10);
    return (v >= 10 && v <= 1000000) ? v : null;
  }
  // 商品名ノードの近傍（祖先をたどって）から価格を推定
  function findPriceNear(node) {
    var el = node && node.parentElement;
    var hops = 0;
    while (el && hops < 7) {
      var p = priceInText(el.textContent || "");
      if (p != null) return p;
      el = el.parentElement; hops++;
    }
    return null;
  }

  // 商品名ノードから、その注文の詳細ページ（無ければ商品ページ）URLを特定する。
  // 祖先を上りながら最初に見つかった注文詳細リンクを返す＝その商品が属する注文。
  function findOrderLink(node, baseUrl) {
    var el = node && node.parentElement;
    var hops = 0, productHref = null;
    function abs(h) { try { return new URL(h, baseUrl).href; } catch (e) { return null; } }
    while (el && hops < 9) {
      if (el.querySelector) {
        var od = el.querySelector('a[href*="order-details"],a[href*="orderID"],a[href*="orderId"],a[href*="/orders/details"]');
        if (od && od.getAttribute("href")) { var u = abs(od.getAttribute("href")); if (u) return u; }
        if (!productHref) {
          var pa = el.querySelector('a[href*="/dp/"],a[href*="/gp/product/"],a[href*="/product/"]');
          if (pa && pa.getAttribute("href")) productHref = abs(pa.getAttribute("href"));
        }
      }
      el = el.parentElement; hops++;
    }
    return productHref;
  }

  // 医薬品クラス表記（第1〜3類医薬品／指定第2類医薬品）。医薬部外品は含めない。
  var DRUG_RE = /第[\s　]*[1-3１２３][\s　]*類医薬品/;

  // ドキュメントを走査し、対象品目(ok)と「医薬品だが対象外(out)」を acc に集約。
  // acc = { ok: {品目正規化名: {name,ingredient,price,pageUrl}}, out: {正規化名: {name,price,pageUrl}} }
  function processDoc(root, MED, acc, pageUrl) {
    if (!root) return acc;
    pageUrl = pageUrl || location.href;
    var seen = Object.create(null);
    var walker = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      var t = (n.nodeValue || "").replace(/\s+/g, " ").trim();
      if (t.length < 6 || t.length > 200 || /^[\d¥,，.\s]+$/.test(t) || seen[t]) continue;
      seen[t] = 1;
      var nt = norm(t);
      if (!nt) continue;
      var best = matchOne(nt, MED);
      if (best) {
        if (!acc.ok[best.k]) acc.ok[best.k] = { name: best.n, ingredient: best.g, price: findPriceNear(n), pageUrl: findOrderLink(n, pageUrl) || pageUrl };
      } else if (DRUG_RE.test(t) && t.length <= 120) {
        if (!acc.out[nt]) acc.out[nt] = { name: t, price: findPriceNear(n), pageUrl: findOrderLink(n, pageUrl) || pageUrl };
      }
    }
    return acc;
  }

  // 注文番号（Amazon: 250-1234567-1234567 形式）。ページ識別と「注文有無」の判定に使う
  var ORDER_NUM = /\d{3}-\d{7}-\d{7}/g;
  function pageSignature(text) {
    var m = text.match(ORDER_NUM);
    if (!m) return "";
    // 重複除去してソート → そのページの注文集合を表す一意キー
    var uniq = {}; m.forEach(function (x) { uniq[x] = 1; });
    return Object.keys(uniq).sort().join(",");
  }

  function delay(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // 指定URLを非表示iframeで実際に描画させ、注文が出るまで待ってDocumentを返す。
  // 新しい注文履歴(/your-orders/orders)はSPA（JSで後から描画）なので、HTML取得では中身が無い。
  // 同一オリジンなのでiframeのDocumentを読める。sandboxでトップ遷移は禁止しつつJSは動かす。
  function loadPageViaIframe(url, timeoutMs) {
    return new Promise(function (resolve) {
      var ifr = document.createElement("iframe");
      ifr.setAttribute("sandbox", "allow-same-origin allow-scripts allow-forms");
      ifr.style.cssText = "position:fixed;left:-99999px;top:-99999px;width:1200px;height:900px;border:0;opacity:0;";
      var done = false, start = Date.now();
      function finish(result) {
        if (done) return; done = true;
        try { ifr.parentNode && ifr.parentNode.removeChild(ifr); } catch (e) {}
        resolve(result);
      }
      function readDoc() { try { return ifr.contentDocument; } catch (e) { return null; } }
      function poll() {
        if (done) return;
        var doc = readDoc();
        var body = doc && doc.body;
        var txt = body ? (body.innerText || body.textContent || "") : "";
        var sig = pageSignature(txt);
        if (sig) { finish({ doc: doc, body: body, sig: sig }); return; }
        if (Date.now() - start > timeoutMs) { finish(body ? { doc: doc, body: body, sig: "" } : null); return; }
        setTimeout(poll, 500);
      }
      ifr.onload = function () { setTimeout(poll, 400); };
      ifr.src = url;
      document.body.appendChild(ifr);
      setTimeout(function () { finish(readDoc() && readDoc().body ? { doc: readDoc(), body: readDoc().body, sig: "" } : null); }, timeoutMs + 3000);
    });
  }

  // 現在の注文履歴URLを基準に startIndex だけ差し替えたURLを作る
  function buildPageUrl(idx) {
    var u = new URL(location.href);
    u.searchParams.set("startIndex", String(idx));
    u.searchParams.delete("ref_");
    return u.href;
  }

  // 全ページをiframeで巡回し、acc(ok/out)に集約する
  function gatherAllPages(MED, onProgress) {
    var CAP = 100;          // 安全上の最大ページ数
    var PAGE = 10;          // 1ページ当たりの注文数（Amazon既定）
    var PAGE_TIMEOUT = 9000;
    var acc = { ok: Object.create(null), out: Object.create(null) };
    var seenSig = Object.create(null);

    // 安全用に現在表示ページを先に処理（描画済みなので確実に取れる）
    processDoc(document.body, MED, acc, location.href);

    function loop(idx, pageNo) {
      if (pageNo > CAP) return Promise.resolve(acc);
      if (onProgress) onProgress(pageNo);
      var pageUrl = buildPageUrl(idx);
      return loadPageViaIframe(pageUrl, PAGE_TIMEOUT).then(function (p) {
        if (!p || !p.sig) return acc;          // 注文が描画されない＝最終ページ超過
        if (seenSig[p.sig]) return acc;        // 既出ページ＝これ以上進まない
        seenSig[p.sig] = 1;
        processDoc(p.body, MED, acc, pageUrl);
        return loop(idx + PAGE, pageNo + 1);
      });
    }
    return loop(0, 1);
  }

  var CACHE_KEY = "smtc_cache_v1";
  var CACHE_MAX_MIN = 120;
  function saveCache(ok, out) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), ok: ok, out: out })); } catch (e) {}
  }
  function loadCache() {
    try {
      var c = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
      if (c && c.ts && (Date.now() - c.ts) < CACHE_MAX_MIN * 60000) {
        c.minAgo = Math.round((Date.now() - c.ts) / 60000);
        return c;
      }
    } catch (e) {}
    return null;
  }
  function accToArrays(acc) {
    return {
      ok: Object.keys(acc.ok).map(function (k) { return acc.ok[k]; }),
      out: Object.keys(acc.out).map(function (k) { return acc.out[k]; })
    };
  }

  function startScan(MED) {
    var prog = showProgress();
    gatherAllPages(MED, function (p) { prog.update(p); }).then(function (acc) {
      prog.done();
      var a = accToArrays(acc);
      saveCache(a.ok, a.out);
      renderOverlay(a.ok, a.out, { onRescan: function () { startScan(MED); } });
    }).catch(function (e) {
      prog.done();
      var a = accToArrays(processDoc(document.body, MED, { ok: Object.create(null), out: Object.create(null) }, location.href));
      renderOverlay(a.ok, a.out, { onRescan: function () { startScan(MED); } });
    });
  }

  function run(MED) {
    // 直近の結果があれば、まず即表示（ページ移動後に押し直すと再スキャン無しで復元）
    var cache = loadCache();
    if (cache) {
      renderOverlay(cache.ok, cache.out, { cachedMin: cache.minAgo, onRescan: function () { startScan(MED); } });
    } else {
      startScan(MED);
    }
  }

  // 取得中の簡易プログレス表示
  function showProgress() {
    var p = document.createElement("div");
    p.id = "smtc-progress";
    p.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#1f8a70;color:#fff;" +
      "font-family:sans-serif;font-size:16px;padding:12px 18px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25)";
    p.textContent = "注文履歴を確認中…";
    document.body.appendChild(p);
    return {
      update: function (n) { p.textContent = "注文履歴を確認中… (" + Math.round(n) + "ページ目)"; },
      done: function () { if (p && p.parentNode) p.parentNode.removeChild(p); }
    };
  }

  function yen(x) { return "¥" + Math.round(x).toLocaleString("ja-JP"); }

  function renderOverlay(okHits, outHits, opts) {
    okHits = okHits || []; outHits = outHits || []; opts = opts || {};
    // 既存パネルを消して重複表示を防ぐ
    var old = document.getElementById("smtc-overlay-host");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var host = document.createElement("div");
    host.id = "smtc-overlay-host";
    host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
    var root = host.attachShadow({ mode: "open" });

    var rows = okHits.map(function (h, i) {
      return '<div class="row">' +
        '<input type="checkbox" checked data-i="' + i + '">' +
        '<div class="mid">' +
          '<div class="nm">' + esc(h.name) + '</div>' +
          '<div class="ig">' + esc(h.ingredient || "") +
            (h.pageUrl ? ' · <a class="vf" href="' + esc(h.pageUrl) + '" target="_blank" rel="noopener">注文を確認</a>' : '') +
          '</div>' +
        '</div>' +
        '<input class="pr" type="number" min="0" step="1" data-i="' + i + '" value="' + (h.price != null ? h.price : "") + '" placeholder="円">' +
      '</div>';
    }).join("");

    var outRows = outHits.map(function (o) {
      return '<div class="orow"><span class="onm">' + esc(o.name) + '</span>' +
        (o.pageUrl ? ' <a class="vf" href="' + esc(o.pageUrl) + '" target="_blank" rel="noopener">確認</a>' : '') + '</div>';
    }).join("");
    var outSection = outHits.length
      ? '<details class="outbox"><summary>対象外の医薬品（参考）' + outHits.length + '件</summary>' +
        '<div class="small muted" style="margin:4px 0">医薬品ですがセルフメディケーション税制の対象品目リストに無いものです（控除の合計には含めません）。</div>' +
        outRows + '</details>'
      : "";

    var cachedNote = (opts.cachedMin != null)
      ? '<div class="cached small">前回の結果（約' + opts.cachedMin + '分前）を表示中。最新にするには「再スキャン」を押してください。</div>'
      : "";

    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.panel{font-family:-apple-system,"Segoe UI","Yu Gothic",Meiryo,sans-serif;width:420px;max-height:86vh;overflow:auto;' +
      'background:#fff;color:#1f2933;border:1px solid #d8e0e8;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);font-size:16px;line-height:1.7}' +
      '.hd{background:linear-gradient(135deg,#1f8a70,#156b56);color:#fff;padding:12px 16px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center}' +
      '.hd b{font-size:17px}.x{cursor:pointer;font-size:22px;line-height:1;opacity:.9}' +
      '.bd{padding:14px 16px}' +
      '.cached{background:#fff6e6;border:1px solid #ffe0a3;border-radius:8px;padding:8px 10px;margin-bottom:10px;color:#8a5a00}' +
      '.verdict{border-radius:10px;padding:12px;text-align:center;margin:10px 0}' +
      '.yes{background:#e6f6f1;border:1px solid #bfe6da}.no{background:#fff6e6;border:1px solid #ffe0a3}' +
      '.big{font-size:20px;font-weight:800}.yes .big{color:#1f8a70}.no .big{color:#b45309}' +
      '.row{display:flex;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid #eef2f5}' +
      '.mid{flex:1;min-width:0}.nm{font-weight:600;word-break:break-all}.ig{color:#66727f;font-size:13px}' +
      '.vf{color:#1f8a70}' +
      '.pr{width:92px;padding:7px 8px;border:1px solid #cfd8e0;border-radius:6px;text-align:right;font-size:16px;flex:none}' +
      '.totalline{margin:12px 0 2px;font-size:17px;text-align:right}.totalline b{font-size:21px}' +
      '.muted{color:#66727f}.small{font-size:13px}' +
      '.outbox{margin-top:12px}.outbox summary{cursor:pointer;font-weight:600;color:#66727f;font-size:14px}' +
      '.orow{padding:6px 0;border-bottom:1px solid #f2f5f7;color:#66727f;font-size:14px;word-break:break-all}' +
      'table{width:100%;border-collapse:collapse;margin-top:6px}td{padding:5px 0;border-bottom:1px solid #eef2f5}.r{text-align:right}' +
      '.btns{display:flex;gap:8px;margin-top:12px}' +
      '.btn{flex:1;text-align:center;text-decoration:none;padding:10px;border-radius:8px;font-weight:700;cursor:pointer;border:0;font-size:15px}' +
      '.kofi{background:#ff5e5b;color:#fff}.site{background:#1f8a70;color:#fff}.rescan{background:#eef2f5;color:#1f2933}' +
      '.empty{padding:8px 0;color:#66727f}' +
      '</style>' +
      '<div class="panel">' +
        '<div class="hd"><b>セルフメディケーション判定</b><span class="x" id="x">×</span></div>' +
        '<div class="bd">' +
          cachedNote +
          (okHits.length === 0
            ? '<div class="empty">対象のOTC医薬品は見つかりませんでした。' +
              (outHits.length ? '（対象外の医薬品は' + outHits.length + '件）' : '') +
              '<br>注文履歴の対象期間（年）を選んでから実行してください。</div>'
            : '<div class="muted small">対象薬を <b>' + okHits.length + '件</b> 検出。金額は自動取得した推定値です（修正可・不要な行はチェックを外す）。</div>' +
              '<div id="list">' + rows + '</div>' +
              '<div class="totalline">対象薬の合計：<b id="total">¥0</b></div>' +
              '<div id="verdict"></div>' +
              '<div id="tax"></div>' +
              '<div class="small muted" style="margin-top:6px">「注文を確認」は別タブで開くのでこの画面は消えません。価格が空欄の薬は注文を開いて手入力してください。</div>') +
          outSection +
          '<div class="btns">' +
            '<button class="btn rescan" id="rescan">再スキャン</button>' +
            '<a class="btn kofi" href="https://buymeacoffee.com/r.bleg" target="_blank" rel="noopener">☕ 応援</a>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(host);
    root.getElementById("x").onclick = function () { host.remove(); };
    var rescanBtn = root.getElementById("rescan");
    if (rescanBtn) rescanBtn.onclick = function () { host.remove(); if (opts.onRescan) opts.onRescan(); };

    if (okHits.length === 0) return;

    var hits = okHits;
    function priceAt(i) {
      var pr = root.querySelector('input.pr[data-i="' + i + '"]');
      return pr ? (Number(pr.value) || 0) : 0;
    }
    function checkedAt(i) {
      var cb = root.querySelector('input[type=checkbox][data-i="' + i + '"]');
      return cb ? cb.checked : false;
    }
    function update() {
      var total = 0;
      for (var i = 0; i < hits.length; i++) if (checkedAt(i)) total += priceAt(i);
      root.getElementById("total").textContent = yen(total);
      var ded = Math.max(0, Math.min(total - THRESHOLD, DEDUCT_CAP));
      var worth = total > THRESHOLD;
      var v = root.getElementById("verdict");
      v.className = "verdict " + (worth ? "yes" : "no");
      v.innerHTML = worth
        ? '<div class="big">✅ 申告する価値あり</div><div class="small">控除額 ' + yen(ded) + '</div>'
        : (total > 0
            ? '<div class="big">あと ' + yen(THRESHOLD + 1 - total) + ' で対象</div><div class="small">12,000円超で対象</div>'
            : '<div class="small muted">金額を入力すると判定します</div>');
      var tx = root.getElementById("tax");
      if (worth && ded > 0) {
        tx.innerHTML = '<table><tr><td class="muted small">所得税率</td><td class="r muted small">節税額の目安</td></tr>' +
          RATES.map(function (rt) {
            return '<tr><td>' + (rt * 100) + '%</td><td class="r"><b>' + yen(ded * (rt + RESIDENT)) + '</b></td></tr>';
          }).join("") +
          '</table><div class="small muted" style="margin-top:4px">※住民税10%込み。通常の医療費控除(10万円超)とは選択適用。</div>';
      } else { tx.innerHTML = ""; }
    }
    root.querySelectorAll('input[type=checkbox]').forEach(function (cb) { cb.onchange = update; });
    root.querySelectorAll('input.pr').forEach(function (pr) { pr.oninput = update; });
    update();
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // --- データ取得して実行 ---
  // /*__DATASOURCE_START__*/ から END までを build_console.mjs が埋め込みデータに差し替える。
  /*__DATASOURCE_START__*/
  fetch(DATA_URL, { cache: "force-cache" })
    .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
    .then(function (data) {
      // medicines.json は {items:[{name,name_norm,ingredient,...}]}。軽量化のため n/k/g に詰め替え。
      var MED = data.items.map(function (it) { return { n: it.name, k: it.name_norm, g: it.ingredient }; });
      run(MED);
    })
    .catch(function (e) {
      toast("品目データの取得に失敗しました（" + e.message + "）。\nサイトが公開済みか、ネット接続をご確認ください。");
    });
  /*__DATASOURCE_END__*/
})();
