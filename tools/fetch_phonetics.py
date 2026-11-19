#!/usr/bin/env python3
"""Fetch free IPA (+ optional audio URL) from dictionaryapi.dev."""

from __future__ import annotations

import csv
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CARDS_PATH = ROOT / "data" / "cards.csv"
OUT_PATH = ROOT / "data" / "phonetics.csv"
API = "https://api.dictionaryapi.dev/api/v2/entries/en/{}"
UA = "FlipEnglish/1.0 (educational vocabulary app; local build)"
WORKERS = 4
RETRIES = 4

SPLIT_RE = re.compile(r"[/|]")


def headword_query(raw: str) -> str:
    parts = [p.strip() for p in SPLIT_RE.split(raw or "") if p.strip()]
    if not parts:
        return ""
    q = parts[0]
    q = q.replace(".", "")
    # drop leading articles-like junk already uncommon in CEFR headwords
    return q.strip().lower()


def pick_ipa_and_audio(payload: list) -> tuple[str, str]:
    ipa = ""
    audio = ""
    if not payload:
        return ipa, audio
    entry = payload[0] if isinstance(payload, list) else payload
    if not isinstance(entry, dict):
        return ipa, audio

    top = (entry.get("phonetic") or "").strip()
    if top:
        ipa = top

    for item in entry.get("phonetics") or []:
        if not isinstance(item, dict):
            continue
        text = (item.get("text") or "").strip()
        url = (item.get("audio") or "").strip()
        if text and not ipa:
            ipa = text
        if url and not audio:
            audio = url
        # Prefer an entry that has both
        if text and url:
            ipa = text
            audio = url
            break

    if ipa and not ipa.startswith("/"):
        ipa = f"/{ipa.strip('/')}/"
    return ipa, audio


def fetch_one(word: str) -> tuple[str, str, str, bool]:
    """Return (word, ipa, audio, ok). ok=False means retryable failure (do not cache)."""
    q = headword_query(word)
    if not q or not re.search(r"[a-z]", q):
        return word, "", "", True
    url = API.format(urllib.parse.quote(q))
    for attempt in range(RETRIES):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=20) as res:
                data = json.load(res)
            ipa, audio = pick_ipa_and_audio(data)
            return word, ipa, audio, True
        except urllib.error.HTTPError as err:
            if err.code == 404:
                return word, "", "", True
            if err.code in (429, 503, 403):
                time.sleep(1.2 * (attempt + 1))
                continue
            return word, "", "", True
        except Exception:  # noqa: BLE001
            time.sleep(0.6 * (attempt + 1))
    return word, "", "", False


def load_existing(path: Path) -> dict[str, dict[str, str]]:
    out: dict[str, dict[str, str]] = {}
    if not path.exists():
        return out
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            w = (row.get("word") or "").strip()
            if not w:
                continue
            out[w] = {
                "word": w,
                "ipa": (row.get("ipa") or "").strip(),
                "audio": (row.get("audio") or "").strip(),
            }
    return out


def unique_words_from_cards(path: Path) -> list[str]:
    seen: set[str] = set()
    words: list[str] = []
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            w = (row.get("word") or "").strip()
            if not w or w in seen:
                continue
            seen.add(w)
            words.append(w)
    return words


def save_phonetics(path: Path, words: list[str], existing: dict[str, dict[str, str]]) -> None:
    rows = [existing[w] for w in words if w in existing]
    seen = {r["word"] for r in rows}
    for w, row in existing.items():
        if w not in seen:
            rows.append(row)
    rows.sort(key=lambda r: r["word"].lower())
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".csv.tmp")
    with tmp.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=["word", "ipa", "audio"])
        writer.writeheader()
        writer.writerows(rows)
    tmp.replace(path)


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    if not CARDS_PATH.exists():
        print(f"missing {CARDS_PATH}", file=sys.stderr)
        return 1

    words = unique_words_from_cards(CARDS_PATH)
    existing = load_existing(OUT_PATH)
    retry_empty = "--retry-empty" in sys.argv
    if retry_empty:
        todo = [w for w in words if not (existing.get(w) or {}).get("ipa")]
    else:
        todo = [w for w in words if w not in existing]
    print(f"unique words: {len(words)}", flush=True)
    print(
        f"cached:       {len(existing)} (ipa={sum(1 for r in existing.values() if r.get('ipa'))})",
        flush=True,
    )
    print(f"to fetch:     {len(todo)} (retry_empty={retry_empty})", flush=True)

    done = 0
    hit = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_one, w): w for w in todo}
        for fut in as_completed(futures):
            word, ipa, audio, ok = fut.result()
            done += 1
            if not ok:
                failed += 1
            else:
                existing[word] = {"word": word, "ipa": ipa, "audio": audio}
                if ipa:
                    hit += 1
            if done % 40 == 0 or done == len(todo):
                save_phonetics(OUT_PATH, words, existing)
                print(
                    f"  progress {done}/{len(todo)} ipa_hit={hit} failed={failed}",
                    flush=True,
                )
            time.sleep(0.05)

    save_phonetics(OUT_PATH, words, existing)
    with_ipa = sum(1 for r in existing.values() if r.get("ipa"))
    with_audio = sum(1 for r in existing.values() if r.get("audio"))
    print(f"wrote {OUT_PATH}", flush=True)
    print(f"rows={len(existing)} with_ipa={with_ipa} with_audio={with_audio}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
