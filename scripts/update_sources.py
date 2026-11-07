#!/usr/bin/env python3
"""
厚労省「セルフメディケーション税制について」のページから、
「最新（令和N年M月1日時点）」ブロックの対象品目一覧の直リンクを読み取り、
scripts/sources.json を書き換える。

使い方:
    python scripts/update_sources.py            # sources.json を更新
    python scripts/update_sources.py --check    # 読み取り結果を表示するだけ

厚労省は最新月のファイルを同じ content ID で毎月上書きするため、
URL が変わらなくても中身は変わることがある。変更の有無は
build_medicines.py で作り直したデータを比べて判断する（diff_medicines.py）。

ページの形が変わって読み取れないときは、終了コード 1 で止まる
（GitHub Actions では失敗としてメール通知される）。
"""
from __future__ import annotations

import html
import json
import re
import sys
import unicodedata
from pathlib import Path

import requests

PAGE_URL = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000124853.html"
BASE = "https://www.mhlw.go.jp"
HEADERS = {"User-Agent": "Mozilla/5.0 (selfmed-tax-checker data builder)"}
SOURCES_PATH = Path(__file__).resolve().parent / "sources.json"

_LINK_RE = re.compile(r'<a\s[^>]*href="([^"]*/content/\d+/\d+\.(xlsx|pdf))"[^>]*>(.*?)</a>', re.S)
_DATE_RE = re.compile(r"対象品目一覧\s*(令和\s*[0-9]+\s*年\s*[0-9]+\s*月\s*[0-9]+\s*日\s*時点)")


def _text(fragment: str) -> str:
    t = re.sub(r"<[^>]+>", " ", fragment)
    t = unicodedata.normalize("NFKC", html.unescape(t))
    return re.sub(r"\s+", " ", t).strip()


def _abs(url: str) -> str:
    return url if url.startswith("http") else BASE + url


def _pick(section: str) -> dict | None:
    """セクション内の「対象品目一覧」のリンクを探す。xlsx を優先し、なければ PDF。"""
    found = {}
    for m in _LINK_RE.finditer(section):
        if _text(m.group(3)).startswith("対象品目一覧"):
            found.setdefault(m.group(2), _abs(m.group(1)))
    if "xlsx" in found:
        return {"url": found["xlsx"], "kind": "xlsx"}
    if "pdf" in found:
        return {"url": found["pdf"], "kind": "pdf"}
    return None


def parse(page: str) -> list[dict]:
    # 「最新」ブロック = 日付付きの「対象品目一覧 令和…時点」から「過去の品目一覧」まで
    head = None
    for m in re.finditer(r"対象品目一覧", page):
        tail = _text(page[m.start(): m.start() + 400])
        d = _DATE_RE.match(tail)
        if d:
            head = (m.start(), re.sub(r"\s+", "", d.group(1)))
            break
    if head is None:
        raise ValueError("「対象品目一覧 令和…時点」の見出しが見つからない")
    start, label_date = head
    end = page.find("過去の品目一覧", start)
    if end < 0:
        raise ValueError("「過去の品目一覧」が見つからず、最新ブロックの終わりが分からない")
    block = page[start:end]

    # 「■非スイッチOTC」より前がスイッチOTC、後が非スイッチOTC
    m_non = re.search(r"■\s*非スイッチ", block)
    m_sw = re.search(r"■\s*スイッチ", block)
    if not (m_non and m_sw and m_sw.start() < m_non.start()):
        raise ValueError("「■スイッチOTC」「■非スイッチOTC」の区切りが見つからない")
    sw = _pick(block[m_sw.start(): m_non.start()])
    non = _pick(block[m_non.start():])
    if not sw or sw["kind"] != "xlsx":
        raise ValueError("スイッチOTC の対象品目一覧 xlsx が見つからない")
    if not non:
        raise ValueError("非スイッチOTC の対象品目一覧が見つからない")

    return [
        {"type": "switch", "label": f"スイッチOTC {label_date}", **sw},
        {"type": "non-switch", "label": f"非スイッチOTC {label_date}", **non},
    ]


def main(argv: list[str]) -> int:
    r = requests.get(PAGE_URL, headers=HEADERS, timeout=60)
    r.raise_for_status()
    r.encoding = r.apparent_encoding if not r.encoding or r.encoding.lower() == "iso-8859-1" else r.encoding
    try:
        sources = parse(r.text)
    except ValueError as e:
        print(f"ERROR: 厚労省ページの読み取りに失敗: {e}", file=sys.stderr)
        return 1
    for s in sources:
        print(f"[{s['type']}] {s['label']} {s['kind']} {s['url']}")
    if "--check" in argv:
        return 0
    old = SOURCES_PATH.read_text(encoding="utf-8") if SOURCES_PATH.exists() else ""
    new = json.dumps(sources, ensure_ascii=False, indent=2) + "\n"
    if new != old:
        SOURCES_PATH.write_text(new, encoding="utf-8", newline="\n")
        print("sources.json を更新しました")
    else:
        print("sources.json は変更なし")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
