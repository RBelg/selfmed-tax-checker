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

console.log("生成:", outPath);
console.log("品目数:", slim.length, "/ サイズ:", (src.length / 1024).toFixed(0), "KB");
console.log("サイトURL:", SITE || "(なし＝『サイトで詳しく』非表示)");
