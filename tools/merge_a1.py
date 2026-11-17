#!/usr/bin/env python3
"""Merge CEFR A1 headwords with EJDict-hand glosses."""

from __future__ import annotations

import csv
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CEFR_PATH = ROOT / "cefrj-vocabulary-profile-1.5.csv"
EJDICT_DIR = ROOT / "vendor" / "EJDict-master" / "src"
OUT_MATCHED = ROOT / "data" / "cards_a1.csv"
OUT_UNMATCHED = ROOT / "data" / "unmatched_a1.csv"

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
    """Build lookup keys from a CEFR headword."""
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
        # Also try a spaceless form for compounds like "all right".
        compact = key.replace(" ", "") if key else ""
        if compact and compact not in seen:
            seen.add(compact)
            out.append(compact)

    for chunk in chunks:
        add(chunk)
        # email / e-mail variants already split by /, but also accept hyphen forms.
        if "-" in chunk:
            add(chunk.replace("-", ""))
            add(chunk.replace("-", " "))
    return out


def shorten_ja(raw: str, max_senses: int = 2, max_len: int = 36) -> str:
    cleaned = MARKER_RE.sub("", raw)
    senses = [s.strip(" ,;、。") for s in SENSE_SPLIT_RE.split(cleaned) if s.strip()]
    if not senses:
        return ""

    ja_senses: list[str] = []
    for sense in senses:
        sense = SPACE_RE.sub(" ", sense).strip()
        # Drop English-only senses (e.g. "answer", "ampere").
        if not HAS_JA_RE.search(sense):
            continue
        # Light cleanup of leftover Latin wrappers around Japanese.
        sense = re.sub(r"\s+", "", sense)
        if sense:
            ja_senses.append(sense)
        if len(ja_senses) >= max_senses:
            break

    if not ja_senses:
        # Fallback: first sense even if English-heavy.
        fallback = re.sub(r"\s+", "", senses[0])
        ja_senses = [fallback] if fallback else []

    text = "；".join(ja_senses)
    if len(text) > max_len:
        text = text[: max_len - 1] + "…"
    return text


def load_ejdict(src_dir: Path) -> dict[str, str]:
    mapping: dict[str, str] = {}
    files = sorted(src_dir.glob("*.txt"))
    if not files:
        raise FileNotFoundError(f"EJDict src not found: {src_dir}")

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
                # Prefer entries whose gloss already contains Japanese.
                prev = mapping.get(key)
                if prev is None:
                    mapping[key] = gloss
                elif not HAS_JA_RE.search(prev) and HAS_JA_RE.search(gloss):
                    mapping[key] = gloss
                # Also index spaceless key for phrase lookup.
                compact = key.replace(" ", "")
                if compact != key:
                    prev_c = mapping.get(compact)
                    if prev_c is None:
                        mapping[compact] = gloss
                    elif not HAS_JA_RE.search(prev_c) and HAS_JA_RE.search(gloss):
                        mapping[compact] = gloss
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
    match_via = Counter()

    with CEFR_PATH.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if (row.get("CEFR") or "").strip() != "A1":
                continue
            headword = (row.get("headword") or "").strip()
            pos = (row.get("pos") or "").strip()
            cefr = (row.get("CEFR") or "").strip()
            if not headword:
                continue

            candidates = headword_candidates(headword)
            found_key = None
            raw_ja = None
            for cand in candidates:
                if cand in ejdict:
                    found_key = cand
                    raw_ja = ejdict[cand]
                    break

            if found_key is None:
                unmatched_rows.append(
                    {
                        "word": headword,
                        "pos": pos,
                        "cefr": cefr,
                        "tried": "|".join(candidates),
                    }
                )
                continue

            ja = shorten_ja(raw_ja or "")
            primary = normalize_word(headword.split("/")[0])
            how = "exact" if found_key in (primary, primary.replace(" ", "")) else "alias"
            match_via[how] += 1
            matched_rows.append(
                {
                    "word": headword,
                    "ja": ja,
                    "pos": pos,
                    "cefr": cefr,
                    "match_key": found_key,
                    "match_via": how,
                    "ja_raw": raw_ja or "",
                }
            )

    OUT_MATCHED.parent.mkdir(parents=True, exist_ok=True)

    with OUT_MATCHED.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["word", "ja", "pos", "cefr", "match_key", "match_via", "ja_raw"],
        )
        writer.writeheader()
        writer.writerows(matched_rows)

    with OUT_UNMATCHED.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["word", "pos", "cefr", "tried"])
        writer.writeheader()
        writer.writerows(unmatched_rows)

    total = len(matched_rows) + len(unmatched_rows)
    rate = (len(matched_rows) / total * 100) if total else 0.0

    print(f"A1 total:      {total}")
    print(f"Matched:       {len(matched_rows)} ({rate:.1f}%)")
    print(f"  exact:       {match_via['exact']}")
    print(f"  alias:       {match_via['alias']}")
    print(f"Unmatched:     {len(unmatched_rows)}")
    print(f"Wrote:         {OUT_MATCHED}")
    print(f"Wrote:         {OUT_UNMATCHED}")

    print("\nSample matched:")
    for row in matched_rows[:10]:
        print(f"  {row['word']:<22} {row['ja']}")

    if unmatched_rows:
        print("\nUnmatched:")
        for row in unmatched_rows:
            print(f"  {row['word']:<22} tried={row['tried']}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
