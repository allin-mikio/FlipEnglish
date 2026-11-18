#!/usr/bin/env python3
"""Validate and assemble generated example CSV chunks into data/examples.csv."""

from __future__ import annotations

import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = DATA / "examples.csv"

sys.path.insert(0, str(ROOT / "tools"))
from example_quality import validate_example  # noqa: E402


def iter_gen_files() -> list[Path]:
    return sorted(DATA.glob("_gen_*.csv"))


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    rows: dict[tuple[str, str], dict[str, str]] = {}
    kept = 0
    dropped = 0

    files = iter_gen_files()
    if not files:
        print("No _gen_*.csv files found", file=sys.stderr)
        return 1

    for path in files:
        with path.open(encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            for row in reader:
                word = (row.get("word") or "").strip()
                cefr = (row.get("cefr") or "").strip()
                en = (row.get("example_en") or "").strip()
                ja = (row.get("example_ja") or "").strip()
                issues = validate_example(word, cefr, en, ja)
                if issues:
                    dropped += 1
                    continue
                key = (word.lower(), cefr)
                rows[key] = {
                    "word": word,
                    "cefr": cefr,
                    "example_en": en,
                    "example_ja": ja,
                }
                kept += 1

    ordered = sorted(rows.values(), key=lambda r: (r["cefr"], r["word"].lower()))
    with OUT.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["word", "cefr", "example_en", "example_ja"]
        )
        writer.writeheader()
        writer.writerows(ordered)

    print(f"files:   {len(files)}")
    print(f"kept:    {kept}")
    print(f"dropped: {dropped}")
    print(f"unique:  {len(ordered)}")
    by = {}
    for r in ordered:
        by[r["cefr"]] = by.get(r["cefr"], 0) + 1
    for lv in ("A1", "A2", "B1", "B2"):
        print(f"  {lv}: {by.get(lv, 0)}")
    print(f"wrote:   {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
