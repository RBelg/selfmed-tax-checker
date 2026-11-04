"""D/結合. ダウンロード済みxlsxを parse_xlsx→dedupe に通し、medicines.json と一致するか確認(ネットワーク不使用)。
使い方: PYTHONUTF8=1 python tests/test_build_offline.py <001705872.xlsx のあるフォルダ>"""
import json, sys, subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_medicines as b
d = Path(sys.argv[1])
items = b.parse_xlsx((d / "001705872.xlsx").read_bytes(), "switch") + b.parse_xlsx((d / "001705876.xlsx").read_bytes(), "non-switch")
dd = sorted(b.dedupe(items), key=lambda x: x["name_norm"])
cur = json.load(open(ROOT / "data" / "medicines.json", encoding="utf-8"))
res = []
def t(n, ok, x=""): res.append(ok); print(("PASS " if ok else "FAIL ") + n + ("" if ok else " :: " + x))
t("rebuilt count == json count", len(dd) == cur["count"], f"{len(dd)} vs {cur['count']}")
t("rebuilt items identical to json", dd == cur["items"])
t("deterministic (second dedupe+sort identical)", sorted(b.dedupe(items), key=lambda x: x["name_norm"]) == dd)
print(f"raw rows {len(items)} -> deduped {len(dd)}")
# 旧版(HEAD)との差分
try:
    old = json.loads(subprocess.check_output(["git", "-C", str(ROOT), "show", "HEAD:data/medicines.json"]).decode("utf-8"))
    on = {i["name_norm"] for i in old["items"]}; nn = {i["name_norm"] for i in cur["items"]}
    print(f"old {len(on)} new {len(nn)} removed {len(on-nn)} added {len(nn-on)}")
    print("removed sample:", sorted(on - nn)[:15])
except Exception as e:
    print("old diff skipped", e)
sys.exit(0 if all(res) else 1)
