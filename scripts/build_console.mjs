/*
 * bookmarklet.js（正本）から「自己完結スニペット」を生成する。
 *
 * 品目データを fetch せずコード内に埋め込むため、公開URL不要・オフラインでも動く。
 * 実Amazonの注文履歴ページで「開発者ツール → Console に貼り付けて実行」する用途。
 *
 * 使い方:
 *   node scripts/build_console.mjs [サイトURL(任意)]
 *   -> dist/console-snippet.js を生成
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.argv[2] || ""; // 空なら「サイトで詳しく」ボタンを非表示

let src = fs.readFileSync(path.join(ROOT, "bookmarklet.js"), "utf-8");
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "medicines.json"), "utf-8"));

// 照合・表示に必要な n(販売名)/k(正規化)/g(成分) のみ埋め込む
const slim = data.items.map(it => ({ n: it.name, k: it.name_norm, g: it.ingredient }));
const embedded =
  "var MED=" + JSON.stringify(slim) + ";run(MED);";

// データ取得部（fetch）を埋め込みデータに差し替え
src = src.replace(
  /\/\*__DATASOURCE_START__\*\/[\s\S]*?\/\*__DATASOURCE_END__\*\//,
  embedded
);

// プレースホルダ置換（DATA_URL は未使用になるが安全のため空に）
src = src.replace("__DATA_URL__", "").replace("__SITE__", SITE.replace(/"/g, '\\"'));

const outDir = path.join(ROOT, "dist");
fs.mkdirSync(outDir, { recursive: true });
const outPath = path.join(outDir, "console-snippet.js");
fs.writeFileSync(outPath, src, "utf-8");

// --- コピー用ページ（ダブルクリックでブラウザで開ける）も生成 ---
const escHtml = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const copyHtml = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>コードをコピー｜セルフメディケーション税制チェッカー</title>
<style>
body{font-family:-apple-system,"Segoe UI","Yu Gothic",Meiryo,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1f2933;line-height:1.8}
h1{font-size:1.3rem}.big{display:inline-block;background:#1f8a70;color:#fff;border:0;border-radius:10px;padding:14px 28px;font-size:1.1rem;font-weight:700;cursor:pointer}
.big:hover{background:#156b56}.ok{color:#1f8a70;font-weight:700;margin-left:12px}
ol{background:#f1f5f9;border-radius:10px;padding:16px 16px 16px 36px}ol li{margin:8px 0}
textarea{width:100%;height:120px;margin-top:18px;font-family:monospace;font-size:11px;color:#888}
code{background:#eef2f5;padding:1px 6px;border-radius:4px}
</style></head><body>
<h1>セルフメディケーション税制チェッカー（テスト用）</h1>
<p>下のボタンを押すとコードがコピーされます。その後の手順で、Amazonの注文履歴ページに貼り付けて実行してください。</p>
<p><button class="big" id="btn">① クリックしてコードをコピー</button><span class="ok" id="ok"></span></p>
<ol>
  <li>Amazonの<a href="https://www.amazon.co.jp/gp/css/order-history" target="_blank" rel="noopener">注文履歴</a>を開く（薬を買った期間に絞る）</li>
  <li>キーボードの <code>F12</code> を押す → 上のタブで「<b>Console</b>（コンソール）」を選ぶ</li>
  <li>初回だけ、入力欄に <code>allow pasting</code> と打って Enter（Chromeの安全機能）</li>
  <li>①でコピーしたコードを貼り付けて <b>Enter</b></li>
  <li>画面右上に判定パネルが表示されます</li>
</ol>
<p style="color:#66727f;font-size:.9rem">※コピーがうまくいかない場合は、下の枠内を全選択（Ctrl+A）してコピー（Ctrl+C）してください。</p>
<textarea id="code" readonly>${escHtml(src)}</textarea>
<script>
var ta=document.getElementById('code');
document.getElementById('btn').onclick=function(){
  ta.select();
  var done=false;
  try{done=document.execCommand('copy');}catch(e){}
  if(navigator.clipboard){navigator.clipboard.writeText(ta.value).then(function(){},function(){});}
  document.getElementById('ok').textContent='✅ コピーしました！手順2へ';
};
</script>
</body></html>`;
const copyPath = path.join(outDir, "copy.html");
fs.writeFileSync(copyPath, copyHtml, "utf-8");

console.log("生成:", outPath);
console.log("生成:", copyPath, "（ブラウザで開いてコピー）");
console.log("品目数:", slim.length, "/ スニペット:", (src.length / 1024).toFixed(0), "KB");
console.log("サイトURL:", SITE || "(なし＝『サイトで詳しく』非表示)");
