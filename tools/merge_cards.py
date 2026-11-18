#!/usr/bin/env python3
"""Merge CEFR headwords (all levels) with EJDict-hand glosses."""

from __future__ import annotations

import csv
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CEFR_PATH = ROOT / "cefrj-vocabulary-profile-1.5.csv"
EJDICT_DIR = ROOT / "vendor" / "EJDict-master" / "src"
OUT_MATCHED = ROOT / "data" / "cards.csv"
OUT_UNMATCHED = ROOT / "data" / "unmatched.csv"
LEVELS = ("A1", "A2", "B1", "B2")
CAT_OTHER = "other"
CAT_LABELS = {
    "life": "生活",
    "town": "街・移動",
    "people": "人・仕事",
    "hobby": "趣味",
    "other": "その他",
}

# Raw CEFR theme -> coarse category id
THEME_TO_CAT = {
    # 生活
    "food and drink": "life",
    "clothes": "life",
    "house and home, environment": "life",
    "objects and rooms": "life",
    "family life": "life",
    "daily life": "life",
    "health and body care": "life",
    "weather": "life",
    "colours": "life",
    "colors": "life",
    # 街・移動
    "things in the town, shops and shopping": "town",
    "shopping": "town",
    "travel": "town",
    "travel and services vocab": "town",
    "ways of travelling": "town",
    "holidays": "town",
    "services": "town",
    "places": "town",
    # 人・仕事・学校
    "personal identification": "people",
    "personal information": "people",
    "work and jobs": "people",
    "education": "people",
    "relations with other people": "people",
    "nationalities and countries": "people",
    "adjectives: personality, description, feelings": "people",
    # 趣味・メディア
    "hobbies and pastimes": "hobby",
    "hobbies and lifestyles": "hobby",
    "free time, entertainment": "hobby",
    "leisure activities": "hobby",
    "media": "hobby",
    "arts": "hobby",
    "books and literature": "hobby",
    "film": "hobby",
    "language": "hobby",
    "news, lifestyles and current affairs": "hobby",
}


def raw_theme(row: dict[str, str]) -> str:
    for key in ("CoreInventory 1", "CoreInventory 2", "Threshold"):
        value = (row.get(key) or "").strip()
        if value:
            return value
    return ""


def category_of(theme: str) -> str:
    if not theme:
        return CAT_OTHER
    return THEME_TO_CAT.get(theme.strip().lower(), CAT_OTHER)


SPLIT_HEAD_RE = re.compile(r"[/]")
COMMA_SPLIT_RE = re.compile(r"\s*,\s*")
SENSE_SPLIT_RE = re.compile(r"\s*/\s*")
MARKER_RE = re.compile(r"〈[^〉]*〉|《[^》]*》|\{[^}]*\}|『|』")
NON_WORD_RE = re.compile(r"[^a-z0-9'.\-\s]+")
SPACE_RE = re.compile(r"\s+")
HAS_JA_RE = re.compile(r"[\u3040-\u30ff\u3400-\u9fff]")


def normalize_word(text: str) -> str:
    text = text.strip().lower().replace("’", "'")
    text = NON_WORD_RE.sub(" ", text)
    text = SPACE_RE.sub(" ", text).strip()
    return text


def headword_candidates(headword: str) -> list[str]:
    chunks = [p.strip() for p in SPLIT_HEAD_RE.split(headword) if p.strip()]
    if not chunks:
        chunks = [headword]

    seen: set[str] = set()
    out: list[str] = []

    def add(raw: str) -> None:
        key = normalize_word(raw)
        if key and key not in seen:
            seen.add(key)
            out.append(key)
        compact = key.replace(" ", "") if key else ""
        if compact and compact not in seen:
            seen.add(compact)
            out.append(compact)

    for chunk in chunks:
        add(chunk)
        if "-" in chunk:
            add(chunk.replace("-", ""))
            add(chunk.replace("-", " "))
    return out


def format_ja(raw: str) -> str:
    """Keep the full dictionary gloss; only light cleanup, no truncation."""
    cleaned = MARKER_RE.sub("", raw)
    cleaned = SPACE_RE.sub(" ", cleaned).strip()
    return cleaned


def headword_priority(token: str) -> int:
    """Prefer common lowercase lemmas over acronyms / chemical symbols."""
    raw = token.strip()
    if not raw:
        return -1
    # as / at / cap など通常見出しを最優先
    if raw.islower():
        return 4
    letters = re.sub(r"[^A-Za-z]", "", raw)
    if letters and letters.isupper() and len(letters) <= 5:
        # CAP, AS, AT のような略語・記号
        return 0
    if letters and letters[:1].isupper() and letters[1:].islower() and len(letters) <= 2:
        # As, At のような元素記号
        return 1
    if raw[:1].isupper() and raw[1:].islower():
        return 2
    return 3


def should_replace_gloss(
    prev_gloss: str,
    prev_prio: int,
    gloss: str,
    prio: int,
) -> bool:
    prev_ja = bool(HAS_JA_RE.search(prev_gloss))
    new_ja = bool(HAS_JA_RE.search(gloss))
    if new_ja and not prev_ja:
        return True
    if prev_ja and not new_ja:
        return False
    if prio > prev_prio:
        return True
    if prio == prev_prio and len(gloss) > len(prev_gloss) * 1.4:
        # 同じ優先度なら、明らかに詳しい語義を採用
        return True
    return False


def load_ejdict(src_dir: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    priority: dict[str, int] = {}
    files = sorted(src_dir.glob("*.txt"))
    if not files:
        raise FileNotFoundError(f"EJDict src not found: {src_dir}")

    def put(key: str, gloss: str, prio: int) -> None:
        prev = mapping.get(key)
        if prev is None or should_replace_gloss(prev, priority.get(key, -1), gloss, prio):
            mapping[key] = gloss
            priority[key] = prio

    for path in files:
        for line in path.read_text(encoding="utf-8").splitlines():
            if not line.strip() or "\t" not in line:
                continue
            left, right = line.split("\t", 1)
            gloss = right.strip()
            if not gloss:
                continue
            for token in COMMA_SPLIT_RE.split(left):
                key = normalize_word(token)
                if not key:
                    continue
                prio = headword_priority(token)
                put(key, gloss, prio)
                compact = key.replace(" ", "")
                if compact != key:
                    put(compact, gloss, prio)
    return mapping


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if not CEFR_PATH.exists():
        print(f"CEFR file missing: {CEFR_PATH}", file=sys.stderr)
        return 1

    ejdict = load_ejdict(EJDICT_DIR)
    print(f"EJDICT entries indexed: {len(ejdict)}")

    matched_rows: list[dict[str, str]] = []
    unmatched_rows: list[dict[str, str]] = []
    seen_keys: set[tuple[str, str]] = set()
    by_level = Counter()
    unmatched_by_level = Counter()
    by_cat = Counter()
    by_level_cat: Counter[tuple[str, str]] = Counter()

    with CEFR_PATH.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            cefr = (row.get("CEFR") or "").strip()
            if cefr not in LEVELS:
                continue
            headword = (row.get("headword") or "").strip()
            if not headword:
                continue

            dedupe_key = (normalize_word(headword.split("/")[0]), cefr)
            if dedupe_key in seen_keys:
                continue
            seen_keys.add(dedupe_key)

            theme = raw_theme(row)
            cat = category_of(theme)

            candidates = headword_candidates(headword)
            found_key = None
            raw_ja = None
            for cand in candidates:
                if cand in ejdict:
                    found_key = cand
                    raw_ja = ejdict[cand]
                    break

            if found_key is None:
                unmatched_by_level[cefr] += 1
                unmatched_rows.append(
                    {
                        "word": headword,
                        "cefr": cefr,
                        "cat": cat,
                        "theme": theme,
                        "tried": "|".join(candidates),
                    }
                )
                continue

            ja = format_ja(raw_ja or "")
            by_level[cefr] += 1
            by_cat[cat] += 1
            by_level_cat[(cefr, cat)] += 1
            matched_rows.append(
                {
                    "word": headword,
                    "ja": ja,
                    "cefr": cefr,
                    "cat": cat,
                    "theme": theme,
                }
            )

    level_order = {level: i for i, level in enumerate(LEVELS)}
    matched_rows.sort(key=lambda r: (level_order[r["cefr"]], r["word"].lower()))
    unmatched_rows.sort(key=lambda r: (level_order.get(r["cefr"], 99), r["word"].lower()))

    OUT_MATCHED.parent.mkdir(parents=True, exist_ok=True)

    with OUT_MATCHED.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["word", "ja", "cefr", "cat", "theme"])
        writer.writeheader()
        writer.writerows(matched_rows)

    with OUT_UNMATCHED.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f, fieldnames=["word", "cefr", "cat", "theme", "tried"]
        )
        writer.writeheader()
        writer.writerows(unmatched_rows)

    total = len(matched_rows) + len(unmatched_rows)
    rate = (len(matched_rows) / total * 100) if total else 0.0
    print(f"Unique words:  {total}")
    print(f"Matched:       {len(matched_rows)} ({rate:.1f}%)")
    print(f"Unmatched:     {len(unmatched_rows)}")
    for level in LEVELS:
        print(f"  {level}: matched {by_level[level]}, unmatched {unmatched_by_level[level]}")
    print("Categories:")
    for cat_id, label in CAT_LABELS.items():
        print(f"  {label}: {by_cat[cat_id]}")
    print("A1 by category:")
    for cat_id, label in CAT_LABELS.items():
        print(f"  {label}: {by_level_cat[('A1', cat_id)]}")
    print(f"Wrote:         {OUT_MATCHED}")
    print(f"Wrote:         {OUT_UNMATCHED}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
