import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from build_medicines import normalize_name
S = json.load(open(Path(__file__).parent / "norm_samples.json", encoding="utf-8"))
sys.stdout.write(json.dumps([normalize_name(s) for s in S]))
