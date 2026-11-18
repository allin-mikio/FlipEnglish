#!/usr/bin/env python3
"""Estimate FlipEnglish localStorage footprint."""
from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "data" / "cards.csv"


def main() -> None:
    rows = list(csv.DictReader(CSV_PATH.open(encoding="utf-8-sig")))
    learned = {}
    for row in rows:
        word = (row.get("word") or "").strip()
        cefr = (row.get("cefr") or "").strip()
        if not word or not cefr:
            continue
        learned[f"{cefr}::{word}"] = "learned"
    raw = json.dumps(learned, ensure_ascii=False)
    # localStorage measures in UTF-16 code units roughly for quota accounting in browsers
    utf16 = sum(2 if ord(ch) > 0xFFFF else 1 for ch in raw) * 2
    print(f"cards: {len(rows)}")
    print(f"json bytes (utf-8): {len(raw.encode('utf-8'))}")
    print(f"approx utf-16 bytes: {utf16}")
    print(f"sample key: {next(iter(learned))}")


if __name__ == "__main__":
    main()
