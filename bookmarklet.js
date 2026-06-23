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

  // ドキュメントを走査し、対象品目を検出して found(キー=品目正規化名) に集約。
  // 各ヒットに 販売名・成分・近傍価格・そのページURL を持たせる。
  function processDoc(root, MED, found, pageUrl) {
    if (!root) return found;
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
      if (best && !found[best.k]) {
        found[best.k] = { med: best, raw: t, price: findPriceNear(n), pageUrl: pageUrl || location.href };
      }
    }
    return found;
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

  // 全ページをiframeで巡回し、対象品目＋近傍価格を found に集約する
  function gatherAllPages(MED, onProgress) {
    var CAP = 100;          // 安全上の最大ページ数
    var PAGE = 10;          // 1ページ当たりの注文数（Amazon既定）
    var PAGE_TIMEOUT = 9000;
    var found = Object.create(null);
    var seenSig = Object.create(null);

    // 安全用に現在表示ページを先に処理（描画済みなので確実に取れる）
    processDoc(document.body, MED, found, location.href);

    function loop(idx, pageNo) {
      if (pageNo > CAP) return Promise.resolve(found);
      if (onProgress) onProgress(pageNo);
      var pageUrl = buildPageUrl(idx);
      return loadPageViaIframe(pageUrl, PAGE_TIMEOUT).then(function (p) {
        if (!p || !p.sig) return found;          // 注文が描画されない＝最終ページ超過
        if (seenSig[p.sig]) return found;        // 既出ページ＝これ以上進まない
        seenSig[p.sig] = 1;
        processDoc(p.body, MED, found, pageUrl);
        return loop(idx + PAGE, pageNo + 1);
      });
    }
    return loop(0, 1);
  }

  function run(MED) {
    var prog = showProgress();
    gatherAllPages(MED, function (p) { prog.update(p); }).then(function (found) {
      prog.done();
      renderOverlay(Object.keys(found).map(function (k) { return found[k]; }));
    }).catch(function (e) {
      prog.done();
      // 失敗時は現在ページだけで判定（フォールバック）
      var found = processDoc(document.body, MED, Object.create(null), location.href);
      renderOverlay(Object.keys(found).map(function (k) { return found[k]; }));
    });
  }

  // 取得中の簡易プログレス表示
  function showProgress() {
    var p = document.createElement("div");
    p.id = "smtc-progress";
    p.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;background:#1f8a70;color:#fff;" +
      "font-family:sans-serif;font-size:13px;padding:10px 16px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25)";
    p.textContent = "注文履歴を確認中…";
    document.body.appendChild(p);
    return {
      update: function (n) { p.textContent = "注文履歴を確認中… (" + Math.round(n) + "ページ目)"; },
      done: function () { if (p && p.parentNode) p.parentNode.removeChild(p); }
    };
  }

  function yen(x) { return "¥" + Math.round(x).toLocaleString("ja-JP"); }

  function renderOverlay(hits) {
    var host = document.createElement("div");
    host.id = "smtc-overlay-host";
    host.style.cssText = "position:fixed;top:16px;right:16px;z-index:2147483647;";
    var root = host.attachShadow({ mode: "open" });

    var rows = hits.map(function (h, i) {
      return '<div class="row">' +
        '<input type="checkbox" checked data-i="' + i + '">' +
        '<div class="mid">' +
          '<div class="nm">' + esc(h.med.n) + '</div>' +
          '<div class="ig">' + esc(h.med.g || "") +
            (h.pageUrl ? ' · <a class="vf" href="' + esc(h.pageUrl) + '" target="_blank" rel="noopener">注文を確認</a>' : '') +
          '</div>' +
        '</div>' +
        '<input class="pr" type="number" min="0" step="1" data-i="' + i + '" value="' + (h.price != null ? h.price : "") + '" placeholder="円">' +
      '</div>';
    }).join("");

    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.panel{font-family:-apple-system,"Segoe UI","Yu Gothic",Meiryo,sans-serif;width:360px;max-height:86vh;overflow:auto;' +
      'background:#fff;color:#1f2933;border:1px solid #d8e0e8;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);font-size:13px;line-height:1.6}' +
      '.hd{background:linear-gradient(135deg,#1f8a70,#156b56);color:#fff;padding:10px 14px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center}' +
      '.hd b{font-size:14px}.x{cursor:pointer;font-size:18px;line-height:1;opacity:.9}' +
      '.bd{padding:12px 14px}' +
      '.verdict{border-radius:10px;padding:10px;text-align:center;margin:8px 0}' +
      '.yes{background:#e6f6f1;border:1px solid #bfe6da}.no{background:#fff6e6;border:1px solid #ffe0a3}' +
      '.big{font-size:16px;font-weight:800}.yes .big{color:#1f8a70}.no .big{color:#b45309}' +
      '.row{display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #eef2f5}' +
      '.mid{flex:1;min-width:0}.nm{font-weight:600;word-break:break-all}.ig{color:#66727f;font-size:11px}' +
      '.vf{color:#1f8a70}' +
      '.pr{width:78px;padding:5px 6px;border:1px solid #cfd8e0;border-radius:6px;text-align:right;font-size:13px;flex:none}' +
      '.totalline{margin:10px 0 2px;font-size:14px;text-align:right}.totalline b{font-size:17px}' +
      '.muted{color:#66727f}.small{font-size:11px}' +
      'table{width:100%;border-collapse:collapse;margin-top:6px}td{padding:3px 0;border-bottom:1px solid #eef2f5}.r{text-align:right}' +
      '.btns{display:flex;gap:8px;margin-top:10px}' +
      '.btn{flex:1;text-align:center;text-decoration:none;padding:8px;border-radius:8px;font-weight:700;cursor:pointer;border:0;font-size:12px}' +
      '.kofi{background:#ff5e5b;color:#fff}.site{background:#1f8a70;color:#fff}' +
      '.empty{padding:8px 0;color:#66727f}' +
      '</style>' +
      '<div class="panel">' +
        '<div class="hd"><b>セルフメディケーション判定</b><span class="x" id="x">×</span></div>' +
        '<div class="bd">' +
          (hits.length === 0
            ? '<div class="empty">対象のOTC医薬品は見つかりませんでした。<br>注文履歴の対象期間（年）を選んでから実行してください。</div>'
            : '<div class="muted small">対象薬を <b>' + hits.length + '件</b> 検出。金額は自動取得した推定値です（修正可・不要な行はチェックを外す）。</div>' +
              '<div id="list">' + rows + '</div>' +
              '<div class="totalline">対象薬の合計：<b id="total">¥0</b></div>' +
              '<div id="verdict"></div>' +
              '<div id="tax"></div>' +
              '<div class="small muted" style="margin-top:6px">「注文を確認」は別タブで開くのでこの画面は消えません。価格が空欄の薬は注文を開いて手入力してください。</div>') +
          '<div class="btns">' +
            (SITE ? '<a class="btn site" href="' + esc(SITE) + '" target="_blank" rel="noopener">使い方・詳しく</a>' : '') +
            '<a class="btn kofi" href="https://buymeacoffee.com/r.bleg" target="_blank" rel="noopener">☕ 応援</a>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(host);
    root.getElementById("x").onclick = function () { host.remove(); };

    if (hits.length === 0) return;

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
