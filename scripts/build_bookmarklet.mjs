/*
 * bookmarklet.js（正本）から、公開用の app.js と 手動コピー用ローダー bookmarklet.min.txt を生成する。
 *
 * 使い方:
 *   node scripts/build_bookmarklet.mjs [サイトURL]
 *   例: node scripts/build_bookmarklet.mjs https://rbelg.github.io/selfmed-tax-checker/
 *
 * 仕組み（ローダー方式）:
 *   - app.js … bookmarklet.js のプレースホルダ(__DATA_URL__/__SITE__)を実URLに置換した「本体」。サイトに公開する。
 *   - 登録するブックマークレットは「app.js を読み込むだけ」の小さなローダー。
 *     → 本体(app.js)を更新すれば、ユーザーは再登録なしで常に最新版が動く。
 *   サイトのドラッグ用リンクは index.html が同じローダーを生成する。本ファイルの .min.txt は手貼り用。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = (process.argv[2] || "https://YOUR-SITE-URL/").replace(/\/?$/, "/");
const DATA_URL = SITE + "data/medicines.json";
const APP_URL = SITE + "app.js";

// 1) 公開本体 app.js を生成（プレースホルダを実URLに全件置換）
let src = fs.readFileSync(path.join(ROOT, "bookmarklet.js"), "utf-8");
src = src.replace(/__DATA_URL__/g, DATA_URL.replace(/"/g, '\\"')).replace(/__SITE__/g, SITE.replace(/"/g, '\\"'));
fs.writeFileSync(path.join(ROOT, "app.js"), src, "utf-8");

// 2) 手動コピー用ローダー（javascript: 文字列）
const loader =
  "(function(){var s=document.createElement('script');" +
  "s.src=" + JSON.stringify(APP_URL) + "+'?t='+Date.now();" +
  "(document.head||document.documentElement).appendChild(s);})();";
const href = "javascript:" + encodeURIComponent(loader);
fs.writeFileSync(path.join(ROOT, "bookmarklet.min.txt"), href + "\n", "utf-8");

console.log("生成: app.js（公開本体）");
console.log("生成: bookmarklet.min.txt（ローダー）");
console.log("サイトURL:", SITE);
console.log("app.js URL:", APP_URL);
if (SITE.includes("YOUR-SITE-URL")) console.log("※ デプロイ後の実URLを引数に渡して再生成してください。");
console.log("ローダー長:", href.length, "文字");
