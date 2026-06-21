/*
 * bookmarklet.js（正本）から手動コピー用の bookmarklet.min.txt を生成する。
 *
 * 使い方:
 *   node scripts/build_bookmarklet.mjs [サイトURL]
 *   例: node scripts/build_bookmarklet.mjs https://your-site.example/
 *
 * サイトのドラッグ＆ドロップ用リンクは index.html が実行時に bookmarklet.js を
 * 読み込んで生成するため、本ファイルは「URLを手で貼り付けたい人」向けの補助。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = process.argv[2] || "https://YOUR-SITE-URL/";
const DATA_URL = SITE.replace(/\/?$/, "/") + "data/medicines.json";

let src = fs.readFileSync(path.join(ROOT, "bookmarklet.js"), "utf-8");

// 先頭のブロックコメントと行コメントを除去（文字列内に // を含まない前提）
src = src.replace(/\/\*[\s\S]*?\*\//g, "");
src = src.replace(/^\s*\/\/.*$/gm, "");
// 行頭の余白を詰め、空行を除去
src = src.split("\n").map(l => l.trim()).filter(Boolean).join("\n");

src = src.replace("__DATA_URL__", DATA_URL.replace(/"/g, '\\"')).replace("__SITE__", SITE.replace(/"/g, '\\"'));

const href = "javascript:" + encodeURIComponent(src);
const outPath = path.join(ROOT, "bookmarklet.min.txt");
fs.writeFileSync(outPath, href + "\n", "utf-8");

console.log(`生成: ${outPath}`);
console.log(`サイトURL: ${SITE}`);
if (SITE.includes("YOUR-SITE-URL")) {
  console.log("※ デプロイ後の実URLを引数に渡して再生成してください。");
}
console.log(`長さ: ${href.length} 文字`);
