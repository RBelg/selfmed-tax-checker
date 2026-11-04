"""A. データ整合性テスト。実行: PYTHONUTF8=1 python tests/test_data_integrity.py"""
import json, re, sys, unicodedata
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
from build_medicines import normalize_name  # noqa

D = json.load(open(ROOT / "data" / "medicines.json", encoding="utf-8"))
items = D["items"]
res = []
def t(name, ok, detail=""):
    res.append((name, ok, detail)); print(("PASS " if ok else "FAIL ") + name + (" :: " + detail if detail and not ok else ""))

t("keys present", all(k in D for k in ("updated", "source", "count", "items")))
t("count == len(items)", D["count"] == len(items), f"{D['count']} vs {len(items)}")
norms = [i["name_norm"] for i in items]
t("name_norm unique", len(set(norms)) == len(norms), f"dup={len(norms)-len(set(norms))}")
t("no empty name_norm", all(norms))
t("no empty name", all(i["name"].strip() for i in items))
t("required fields on every item", all(all(k in i for k in ("name","name_norm","ingredient","maker","type")) for i in items))
t("type values valid", {i["type"] for i in items} <= {"switch", "non-switch"}, str({i["type"] for i in items}))
t("both types present", {i["type"] for i in items} == {"switch", "non-switch"})
t("sorted by name_norm", norms == sorted(norms))
t("name_norm == normalize_name(name)", all(normalize_name(i["name"]) == i["name_norm"] for i in items),
  str([i["name"] for i in items if normalize_name(i["name"]) != i["name_norm"]][:5]))
rad = re.compile("[⺀-⻿⼀-⿟]")
bad = [i["name"] for i in items if rad.search(i["name"])]
t("no Kangxi/CJK-radical chars in name", not bad, str(bad[:10]))
bad2 = [i["name"] for i in items if rad.search(i["ingredient"] + i["maker"])]
t("no radical chars in ingredient/maker", not bad2, str(bad2[:10]))
bad3 = [i["name"] for i in items if "�" in i["name"]]
t("no U+FFFD", not bad3, str(bad3[:5]))
t("name_norm has no radicals", not any(rad.search(n) for n in norms))

def has(sub):
    s = normalize_name(sub)
    return [i["name"] for i in items if s in i["name_norm"]]
for q in ["サロンパスEX","サロンパス30","ロキソニンEXテープ","ロキソニンEXゲル","ガスター10","アレグラFX","ナザール","イブA錠","バファリン","ロートジー","サンテ","小青竜湯","麻黄湯","葛根湯","ロキソニンS"]:
    r = has(q); t(f"contains '{q}'", bool(r), "" if r else "none")
fails = [r for r in res if not r[1]]
print(f"\nTOTAL {len(res)} PASS {len(res)-len(fails)} FAIL {len(fails)}")
sys.exit(1 if fails else 0)
