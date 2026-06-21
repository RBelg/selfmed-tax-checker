/*
 * セルフメディケーション税制チェッカー — 抽出ブックマークレット（正本）
 *
 * 役割:
 *   Amazonの注文履歴ページのDOMから「商品名」を抽出し、
 *   localStorage と URLハッシュ に格納して自サイトへ遷移する。
 *   ※ medicines.json の取得・照合はここでは行わない（AmazonのCSP回避のため）。
 *
 * このファイルが唯一の正本。index.html が実行時に fetch して
 *   __SITE__ / __KEY__ を置換し javascript: リンクとして登録リンクを生成する。
 *   bookmarklet.min.txt（手動コピー用）は scripts/build_bookmarklet.mjs で生成。
 *
 * 注意（要実機確認）:
 *   AmazonのDOM構造は変わりやすい。下記セレクタ・除外語は実ページで要検証。
 *   PC版/スマホ版/年フィルタで構造差あり。うまく取れない場合はサイトの手動貼り付けへ。
 */
(function () {
  "use strict";
  var SITE = "__SITE__";
  var KEY = "__KEY__";

  // 商品名の候補となるリンク。Amazon注文履歴では商品タイトルがリンクとして並ぶ。
  var SELECTORS = [
    ".yohtmlc-product-title",                 // 新しめの注文履歴の商品タイトル
    "a.a-link-normal.yohtmlc-product-title",
    ".a-fixed-left-grid .a-link-normal",      // 旧レイアウトの商品リンク
    ".item-view-left-col-inner a.a-link-normal",
    "a.a-link-normal[href*='/product/']",
    "a.a-link-normal[href*='/dp/']",
    "a.a-link-normal[href*='/gp/product/']",
  ];

  // 商品名ではない（ボタン・補助リンク）テキストを除外
  var EXCLUDE = /(再び購入|もう一度購入|商品の詳細|レビュー|注文内容を表示|注文の詳細|配送状況|追跡|領収書|返品|交換|問題|ギフト|サポート|キャンセル|出品者|ストアフロント|詳細を見る|定期おトク便)/;

  function looksLikeProduct(t) {
    if (!t) return false;
    t = t.trim();
    if (t.length < 6 || t.length > 180) return false;   // 極端に短い/長いものを除外
    if (EXCLUDE.test(t)) return false;
    if (/^\d+$/.test(t)) return false;
    return true;
  }

  var seen = Object.create(null);
  var items = [];
  SELECTORS.forEach(function (sel) {
    document.querySelectorAll(sel).forEach(function (el) {
      var t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (looksLikeProduct(t) && !seen[t]) {
        seen[t] = 1;
        items.push({ name: t, price: "" });
      }
    });
  });

  if (items.length === 0) {
    alert(
      "商品名を抽出できませんでした。\n" +
      "Amazonの『注文履歴』ページで実行してください。\n" +
      "うまくいかない場合はサイトの『手動で貼り付ける』をご利用ください。"
    );
    return;
  }

  var payload = JSON.stringify(items);
  try { localStorage.setItem(KEY, payload); } catch (e) { /* プライベートモード等 */ }
  // URLハッシュでも渡す（別ブラウザ/別プロファイルへのフォールバック）
  location.href = SITE + "#smtc=" + encodeURIComponent(payload);
})();
