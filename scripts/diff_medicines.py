#!/usr/bin/env python3
"""
新旧の medicines.json を比べ、変更の有無と要約（Markdown）を出す。

使い方:
    python scripts/diff_medicines.py <旧.json> <新.json> <要約の出力先.md>

終了コード: 0 = 品目に変更あり / 3 = 変更なし（updated の日付だけの差は無視）
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

SHOW = 30  # 要約に並べる品目名の最大数


def load(p: str) -> dict:
    return json.loads(Path(p).read_text(encoding="utf-8"))


def main(argv: list[str]) -> int:
    old, new, out = load(argv[0]), load(argv[1]), Path(argv[2])
    o = {i["name_norm"]: i for i in old["items"]}
    n = {i["name_norm"]: i for i in new["items"]}
    added = [n[k] for k in sorted(n.keys() - o.keys())]
    removed = [o[k] for k in sorted(o.keys() - n.keys())]
    changed = [n[k] for k in sorted(n.keys() & o.keys()) if n[k] != o[k]]
    same = not added and not removed and not changed and old.get("source") == new.get("source")

    lines = [
        f"- 出典: {old.get('source')} → **{new.get('source')}**",
        f"- 件数: {old['count']} → **{new['count']}**（追加 {len(added)} / 削除 {len(removed)} / 内容変更 {len(changed)}）",
    ]

    def section(title: str, items: list[dict]) -> None:
        if not items:
            return
        lines.append(f"\n### {title}（{len(items)}件）")
        for i in items[:SHOW]:
            lines.append(f"- {i['name']}（{i['type']}）")
        if len(items) > SHOW:
            lines.append(f"- ほか {len(items) - SHOW} 件")

    section("追加", added)
    section("削除", removed)
    section("内容変更（成分・メーカー等）", changed)
    if len(removed) > max(50, old["count"] // 10):
        lines.insert(0, f"> ⚠️ 削除が {len(removed)} 件と多い。厚労省のファイル形式が変わって取りこぼしていないか確認すること。\n")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 3 if same else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
