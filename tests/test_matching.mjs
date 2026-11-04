// B/C. 正規化一致・照合ロジックテスト。実行: node tests/test_matching.mjs （PYTHONUTF8=1 推奨）
import fs from "node:fs"; import vm from "node:vm"; import path from "node:path"; import { fileURLToPath } from "node:url"; import { execFileSync } from "node:child_process";
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.join(here, "..");
const src = fs.readFileSync(path.join(root, "app.js"), "utf8");
const a = src.indexOf("var MIN_MATCH_LEN"), b = src.indexOf("function toast"), c = src.indexOf("function normStarts"), d = src.indexOf("// 価格パターン"), e = src.indexOf("var DRUG_RE");
if ([a,b,c,d,e].some(x => x < 0)) throw new Error("app.js の抽出アンカーが見つからない");
const code = src.slice(a, src.indexOf("\n", a)) + "\n" + src.slice(src.indexOf("var BR ="), b) + src.slice(c, d) + src.slice(e, src.indexOf("\n", e));
const ctx = {}; vm.createContext(ctx);
vm.runInContext(code + "\nthis.norm=norm;this.normStarts=normStarts;this.matchOne=matchOne;this.DRUG_RE=DRUG_RE;this.MIN=MIN_MATCH_LEN;", ctx);
const { norm, normStarts, matchOne, DRUG_RE } = ctx;
let pass = 0, fail = 0; const log = (ok, n, x = "") => { ok ? pass++ : fail++; console.log((ok ? "PASS " : "FAIL ") + n + (ok ? "" : " :: " + x)); };

// B
const S = JSON.parse(fs.readFileSync(path.join(here, "norm_samples.json"), "utf8"));
const py = JSON.parse(execFileSync("python", ["-I", path.join(here, "dump_norm.py")], { env: { ...process.env, PYTHONUTF8: "1" }, encoding: "utf8" }));
S.forEach((s, i) => log(norm(s) === py[i], `norm parity [${JSON.stringify(s)}]`, `js=${JSON.stringify(norm(s))} py=${JSON.stringify(py[i])}`));
// 全品目名でもパリティ
const D = JSON.parse(fs.readFileSync(path.join(root, "data", "medicines.json"), "utf8"));
const mism = D.items.filter(i => norm(i.name) !== i.name_norm);
log(mism.length === 0, `norm parity on all ${D.items.length} item names`, mism.slice(0, 5).map(i => i.name + "|" + norm(i.name) + "|" + i.name_norm).join(" ; "));
log(S.every(s => normStarts(s).t === norm(s)), "normStarts.t == norm for samples");

// C
const MED = D.items.map(i => ({ k: i.name_norm, n: i.name, g: i.ingredient }));
const m = t => { const no = normStarts(t); return DRUG_RE.test(t) ? matchOne(no, MED) : null; };
const pos = [
  ["【第2類医薬品】ロキソニンSテープ 7枚入", "ロキソニンSテープ"], ["サロンパスEX 【第2類医薬品】", "サロンパスEX"],
  ["ガスター10 24錠【第1類医薬品】", "ガスター10"], ["【第2類医薬品】アレグラFX 28錠", "アレグラFX"],
  ["【指定第2類医薬品】イブA錠 60錠", "イブA錠"], ["【第2類医薬品】ロキソニンEXテープ 7枚", "ロキソニンEXテープ"],
  ["ロキソニンSプレミアム24錠 【第１類医薬品】", "ロキソニンSプレミアム"], ["【第2類医薬品】サロンパス30 40枚", "サロンパス30"],
  ["【第 2 類医薬品】「クラシエ」漢方小青竜湯エキス錠 24錠", "漢方小青竜湯エキス錠"], ["【第2類医薬品】ナザールスプレー 30mL", "ナザールスプレー"],
];
for (const [t, exp] of pos) { const r = m(t); log(!!r && norm(r.n).startsWith(norm(exp)) || (!!r && norm(r.n).includes(norm(exp))), `TP ${t}`, r ? r.n : "null"); }
// 数量直後
{ const r = m("【第1類医薬品】ロキソニンSプレミアム24錠"); log(!!r, "TP 直後が数量(24錠)", r ? r.n : "null"); }
// DRUG_RE必須
for (const t of ["ロキソニンSテープ 7枚入", "サロンパスEX 大容量", "ガスター10 24錠", "アレグラFX 28錠 医薬部外品", "【医薬部外品】ロキソニンSテープ"])
  log(!DRUG_RE.test(t) && m(t) === null, `no DRUG_RE -> null: ${t}`);
// 過去バグ
for (const t of ["スワンタッチ 洗濯機用ホース", "アイリスオーヤマ 収納ボックス", "アバロン 干しアワビ 100g", "ホース ワンタッチ 継手", "アイリスオーヤマ 空気清浄機 PM2.5"])
  { const r = m(t); log(r === null, `regress null: ${t}`, r ? r.n : ""); }
// 医薬品表記があっても語中一致は不可（参考）
for (const t of ["【第2類医薬品】ホース ワンタッチ", "【第2類医薬品】アイリスオーヤマ"]) { const r = matchOne(normStarts(t), MED); log(r === null, `語中/語末条件 with 医薬品表記: ${t}`, r ? r.n : ""); }
// DRUG_RE
for (const [t, e] of [["第2類医薬品", true], ["第１類医薬品", true], ["指定第２類医薬品", true], ["第3類医薬品", true], ["第4類医薬品", false], ["第2類医薬部外品", false]]) log(DRUG_RE.test(t) === e, `DRUG_RE ${t}`);
console.log(`\nTOTAL ${pass + fail} PASS ${pass} FAIL ${fail}`); process.exit(fail ? 1 : 0);
