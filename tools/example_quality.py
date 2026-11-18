#!/usr/bin/env python3
"""Quality checks for curated FlipEnglish example sentences."""

from __future__ import annotations

import re
from dataclasses import dataclass


WORD_RE = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)?")
MAX_EN_CHARS = 72
MAX_EN_WORDS = 12
MAX_JA_CHARS = 40


@dataclass
class ExampleIssue:
    code: str
    detail: str


def tokenize_en(text: str) -> list[str]:
    return [m.group(0).lower() for m in WORD_RE.finditer(text)]


def headword_variants(word: str) -> set[str]:
    w = word.strip().lower()
    out = {w}
    if " " in w or "/" in w or "-" in w:
        for part in re.split(r"[\s/\-]+", w):
            if part:
                out.add(part)
    # light inflection / contraction tolerance
    if w.endswith("y") and len(w) > 3:
        out.add(w[:-1] + "ies")
    if w.endswith("e"):
        out.add(w + "d")
        out.add(w + "s")
    else:
        out.add(w + "ed")
        out.add(w + "ing")
        out.add(w + "s")
        out.add(w + "es")
    if w.endswith("s"):
        out.add(w[:-1])
    return out


def headword_in_sentence(word: str, sentence: str) -> bool:
    tokens = set(tokenize_en(sentence))
    variants = headword_variants(word)
    return any(v in tokens for v in variants)


def validate_example(word: str, cefr: str, en: str, ja: str) -> list[ExampleIssue]:
    issues: list[ExampleIssue] = []
    en = (en or "").strip()
    ja = (ja or "").strip()
    word = (word or "").strip()

    if not word:
        issues.append(ExampleIssue("no_word", "missing headword"))
        return issues
    if not en or not ja:
        issues.append(ExampleIssue("empty", "missing en/ja"))
        return issues
    if len(en) > MAX_EN_CHARS:
        issues.append(ExampleIssue("en_long", f"{len(en)}>{MAX_EN_CHARS}"))
    words = tokenize_en(en)
    if len(words) > MAX_EN_WORDS:
        issues.append(ExampleIssue("en_words", f"{len(words)}>{MAX_EN_WORDS}"))
    if len(ja) > MAX_JA_CHARS:
        issues.append(ExampleIssue("ja_long", f"{len(ja)}>{MAX_JA_CHARS}"))
    if not re.search(r"[。．！？!?]$", ja):
        issues.append(ExampleIssue("ja_end", "ja should end with 。！？"))
    if not re.search(r"[.!?]$", en):
        issues.append(ExampleIssue("en_end", "en should end with .!?"))
    if not headword_in_sentence(word, en):
        issues.append(ExampleIssue("missing_hw", "headword not in sentence"))
    # avoid obvious dictionary-style meta
    low = en.lower()
    if "means" in low or "is a word" in low or "this word" in low:
        issues.append(ExampleIssue("meta", "dictionary-like meta sentence"))
    return issues
