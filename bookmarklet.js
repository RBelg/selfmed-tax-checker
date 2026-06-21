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

  // --- ドキュメントから商品名候補テキストを収集（構造非依存・root指定可） ---
  function collectCandidates(root, set, out) {
    root = root || document.body;
    set = set || Object.create(null);
    out = out || [];
    if (!root) return out;
    var walker = (root.ownerDocument || document).createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      var t = (n.nodeValue || "").replace(/\s+/g, " ").trim();
      if (t.length >= 6 && t.length <= 200 && !/^[\d¥,，.\s]+$/.test(t) && !set[t]) {
        set[t] = 1;
        out.push(t);
      }
    }
    return out;
  }

  // 候補テキスト群 -> 対象品目（最長一致）。重複品目は1件に集約。
  function matchCandidates(candidates, MED, found) {
    found = found || {};
    candidates.forEach(function (text) {
      var nt = norm(text);
      if (!nt) return;
      var best = null;
      for (var i = 0; i < MED.length; i++) {
        var k = MED[i].k;
        if (k.length < MIN_MATCH_LEN) { if (k === nt) { if (!best || k.length > best.k.length) best = MED[i]; } continue; }
        if (nt.indexOf(k) !== -1) { if (!best || k.length > best.k.length) best = MED[i]; }
      }
      if (best && !found[best.k]) found[best.k] = { med: best, raw: text };
    });
    return found;
  }

  // 注文を示す手がかり（注文日）の有無で「まだ注文がある／もう無い」を判定
  var ORDER_HINT = /\d{4}年\s*\d{1,2}月\s*\d{1,2}日|注文日|ご注文/;

  // 注文履歴の全ページを startIndex で巡回し、候補テキストを集約する
  function gatherAllPages(onProgress) {
    var PAGE = 10;       // 1ページ当たりの注文数（Amazonの既定）
    var CAP = 60;        // 安全上の最大ページ数
    var set = Object.create(null);
    var out = [];
    // まず現在表示中のページを収集
    collectCandidates(document.body, set, out);

    var path = location.pathname;
    var baseParams = new URLSearchParams(location.search);
    var parser = new DOMParser();

    function fetchPage(idx) {
      baseParams.set("startIndex", String(idx));
      var url = location.origin + path + "?" + baseParams.toString();
      return fetch(url, { credentials: "same-origin", cache: "no-store" })
        .then(function (r) { return r.ok ? r.text() : ""; })
        .then(function (html) {
          if (!html) return false;
          var doc = parser.parseFromString(html, "text/html");
          var body = doc.body;
          var txt = body ? (body.innerText || body.textContent || "") : "";
          if (!ORDER_HINT.test(txt)) return false; // 注文が無い＝最終ページ超過
          var before = out.length;
          collectCandidates(body, set, out);
          return out.length > before; // 新規候補が増えたページのみ「続行」
        })
        .catch(function () { return false; });
    }

    // startIndex=10,20,... と順に取得（現在ページの startIndex に依存せず0基準で網羅）
    // ページネーションが効かず同一ページが返る場合は「新規ゼロ」で停止する
    function loop(idx) {
      if (idx >= CAP * PAGE) return Promise.resolve(out);
      if (onProgress) onProgress(idx / PAGE + 1);
      return fetchPage(idx).then(function (more) {
        if (!more) return out;
        return loop(idx + PAGE);
      });
    }
    // 0ページ目も取得（現在ページが途中startIndexの場合の取りこぼし防止）
    return loop(0);
  }

  function run(MED) {
    var prog = showProgress();
    gatherAllPages(function (p) { prog.update(p); }).then(function (candidates) {
      prog.done();
      var found = matchCandidates(candidates, MED, {});
      var hits = Object.keys(found).map(function (k) { return found[k]; });
      renderOverlay(hits);
    }).catch(function (e) {
      prog.done();
      // 失敗時は現在ページだけで判定（フォールバック）
      var found = matchCandidates(collectCandidates(document.body), MED, {});
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
      return '<label class="row"><input type="checkbox" checked data-i="' + i + '">' +
        '<span class="nm">' + esc(h.med.n) + '</span>' +
        '<span class="ig">' + esc(h.med.g || "") + '</span></label>';
    }).join("");

    root.innerHTML =
      '<style>' +
      ':host{all:initial}' +
      '.panel{font-family:-apple-system,"Segoe UI","Yu Gothic",Meiryo,sans-serif;width:340px;max-height:84vh;overflow:auto;' +
      'background:#fff;color:#1f2933;border:1px solid #d8e0e8;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);font-size:13px;line-height:1.6}' +
      '.hd{background:linear-gradient(135deg,#1f8a70,#156b56);color:#fff;padding:10px 14px;border-radius:12px 12px 0 0;display:flex;justify-content:space-between;align-items:center}' +
      '.hd b{font-size:14px}.x{cursor:pointer;font-size:18px;line-height:1;opacity:.9}' +
      '.bd{padding:12px 14px}' +
      '.verdict{border-radius:10px;padding:10px;text-align:center;margin-bottom:10px}' +
      '.yes{background:#e6f6f1;border:1px solid #bfe6da}.no{background:#fff6e6;border:1px solid #ffe0a3}' +
      '.big{font-size:16px;font-weight:800}.yes .big{color:#1f8a70}.no .big{color:#b45309}' +
      '.amt{width:130px;padding:6px 8px;border:1px solid #cfd8e0;border-radius:6px;text-align:right;font-size:14px}' +
      '.row{display:flex;gap:6px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #eef2f5}' +
      '.nm{flex:1;font-weight:600}.ig{color:#66727f;font-size:11px}' +
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
            ? '<div class="empty">このページで対象のOTC医薬品は見つかりませんでした。<br>注文履歴の対象期間を表示して再実行してください。</div>'
            : '<div class="muted small">対象薬を <b>' + hits.length + '件</b> 検出。下のチェックを外すと除外できます。</div>' +
              '<div id="list">' + rows + '</div>' +
              '<div style="margin:10px 0 4px">対象薬の合計購入額：<input class="amt" id="amt" type="number" min="0" step="1" placeholder="例 15000"> 円</div>' +
              '<div id="verdict"></div>' +
              '<div id="tax"></div>') +
          '<div class="btns">' +
            (SITE ? '<a class="btn site" id="site" href="' + esc(SITE) + '" target="_blank" rel="noopener">サイトで詳しく</a>' : '') +
            '<a class="btn kofi" href="https://buymeacoffee.com/r.bleg" target="_blank" rel="noopener">☕ 応援</a>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(host);
    root.getElementById("x").onclick = function () { host.remove(); };

    if (hits.length === 0) return;

    var checks = root.querySelectorAll('input[type=checkbox]');
    var amt = root.getElementById("amt");
    function selectedCount() {
      var c = 0; checks.forEach(function (cb) { if (cb.checked) c++; }); return c;
    }
    function update() {
      var total = Number(amt.value) || 0;
      var ded = Math.max(0, Math.min(total - THRESHOLD, DEDUCT_CAP));
      var worth = total > THRESHOLD;
      var v = root.getElementById("verdict");
      v.className = "verdict " + (worth ? "yes" : "no");
      v.innerHTML = worth
        ? '<div class="big">✅ 申告する価値あり</div><div class="small">控除額 ' + yen(ded) + '</div>'
        : (total > 0
            ? '<div class="big">あと ' + yen(THRESHOLD + 1 - total) + '</div><div class="small">12,000円超で対象</div>'
            : '<div class="small muted">合計購入額を入力してください</div>');
      var tx = root.getElementById("tax");
      if (worth && ded > 0) {
        tx.innerHTML = '<table><tr><td class="muted small">所得税率</td><td class="r muted small">節税額の目安</td></tr>' +
          RATES.map(function (rt) {
            return '<tr><td>' + (rt * 100) + '%</td><td class="r"><b>' + yen(ded * (rt + RESIDENT)) + '</b></td></tr>';
          }).join("") +
          '</table><div class="small muted" style="margin-top:4px">※住民税10%込み。通常の医療費控除(10万円超)とは選択適用。</div>';
      } else { tx.innerHTML = ""; }
    }
    checks.forEach(function (cb) { cb.onchange = update; });
    amt.oninput = update;
    // 「詳しく」リンクに検出品目を渡す（サイト側で価格入力＆詳細判定）
    var siteLink = root.getElementById("site");
    if (siteLink && SITE) {
      var items = hits.map(function (h) { return { name: h.med.n, price: "" }; });
      siteLink.href = SITE + "#smtc=" + encodeURIComponent(JSON.stringify(items));
    }
    amt.focus();
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
