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
EXAMPLES_PATH = ROOT / "data" / "examples.csv"
PHONETICS_PATH = ROOT / "data" / "phonetics.csv"
LEVELS = ("A1", "A2", "B1", "B2")
CAT_OTHER = "other"
CAT_LABELS = {
    "life": "Life",
    "town": "Travel",
    "people": "Work",
    "hobby": "Hobby",
    "nature": "Nature",
    "feelings": "Feelings",
    "time": "Time",
    "basics": "Basics",
    "other": "Other",
}

# Raw CEFR theme -> coarse category id
THEME_TO_CAT = {
    # Life
    "food and drink": "life",
    "clothes": "life",
    "house and home, environment": "life",
    "objects and rooms": "life",
    "family life": "life",
    "daily life": "life",
    "health and body care": "life",
    "weather": "nature",
    "colours": "life",
    "colors": "life",
    # Travel
    "things in the town, shops and shopping": "town",
    "shopping": "town",
    "travel": "town",
    "travel and services vocab": "town",
    "ways of travelling": "town",
    "holidays": "town",
    "services": "town",
    "places": "town",
    # Work / people / school
    "personal identification": "people",
    "personal information": "people",
    "work and jobs": "people",
    "education": "people",
    "relations with other people": "people",
    "nationalities and countries": "people",
    "adjectives: personality, description, feelings": "feelings",
    # Hobby / media
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

# Closed-class / ultra-basic lemmas (theme-less words)
BASICS_WORDS = {
    "a", "an", "the", "and", "or", "but", "if", "because", "so", "than", "that",
    "this", "these", "those", "there", "here", "it", "its", "itself",
    "i", "me", "my", "mine", "myself", "we", "us", "our", "ours", "ourselves",
    "you", "your", "yours", "yourself", "yourselves",
    "he", "him", "his", "himself", "she", "her", "hers", "herself",
    "they", "them", "their", "theirs", "themselves",
    "who", "whom", "whose", "which", "what", "where", "when", "why", "how",
    "not", "no", "yes", "do", "does", "did", "done", "doing",
    "be", "am", "is", "are", "was", "were", "been", "being",
    "'m", "'re", "'s", "'ve", "'ll", "'d",
    "have", "has", "had", "having",
    "will", "would", "can", "could", "may", "might", "shall", "should", "must",
    "of", "to", "in", "on", "at", "for", "from", "with", "by", "as", "into",
    "about", "up", "out", "off", "over", "under", "again", "further", "then",
    "once", "all", "any", "both", "each", "few", "more", "most", "other",
    "some", "such", "only", "own", "same", "too", "very", "just", "also",
    "even", "still", "already", "yet", "ever", "never", "always", "often",
    "usually", "sometimes", "perhaps", "maybe", "almost", "quite", "rather",
    "enough", "either", "neither", "whether", "while", "during", "before",
    "after", "above", "below", "between", "through", "during", "without",
    "within", "along", "across", "behind", "beyond", "plus", "minus",
    "something", "anything", "nothing", "everything",
    "somebody", "anybody", "nobody", "everybody",
    "someone", "anyone", "everyone", "somewhere", "anywhere", "everywhere",
    "nowhere", "another", "else", "etc", "etc.",
    "real", "really", "actual", "actually", "true", "truly", "very",
}

BASICS_POS = {
    "preposition",
    "pronoun",
    "determiner",
    "conjunction",
    "modal auxiliary",
    "be-verb",
    "do-verb",
    "have-verb",
    "infinitive-to",
    "interjection",
}

# (cat_id, english lemmas, japanese keywords) — first match wins after Basics/Time shortcuts
RULE_GROUPS: list[tuple[str, set[str], tuple[str, ...]]] = [
    (
        "time",
        {
            "time", "times", "hour", "hours", "minute", "minutes", "second", "seconds",
            "day", "days", "week", "weeks", "month", "months", "year", "years",
            "today", "tonight", "tomorrow", "yesterday", "morning", "afternoon",
            "evening", "night", "midnight", "noon", "weekend", "weekday",
            "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
            "january", "february", "march", "april", "may", "june", "july",
            "august", "september", "october", "november", "december",
            "spring", "summer", "autumn", "fall", "winter",
            "season", "date", "dates", "calendar", "clock", "watch",
            "early", "late", "later", "soon", "ago", "now", "recent",
            "recently", "currently", "future", "moment",
            "century", "decade", "am", "pm", "a.m.", "p.m.",
            "schedule", "deadline", "delay", "immediately", "eventually",
        },
        (
            # 1文字の「分」「時」「夜」「月」「年」は 部分/十分/夜明け 等に誤爆しやすいので使わない
            "時間", "時刻", "時計", "時間割", "時点", "時代",
            "分間", "何分", "数分", "毎分", "分後", "分前", "30分", "秒",
            "今日", "明日", "昨日", "今朝", "今晚", "今夜", "昨夜", "夜中",
            "夜明け", "朝", "昼間", "夕方", "夜に", "週末", "平日", "曜日",
            "月曜", "火曜", "水曜", "木曜", "金曜", "土曜", "日曜",
            "一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月",
            "九月", "十月", "十一月", "十二月", "ヶ月", "か月", "一年", "年間",
            "年齢", "季節", "春季", "夏季", "秋季", "冬季", "春夏", "秋冬",
            "午前", "午後", "期間", "予定", "締切", "直後", "以前", "以後",
            "最近", "将来", "過去", "現在", "瞬間", "しばらく", "いつ",
            "今朝", "明朝", "早朝",
        ),
    ),
    (
        "nature",
        {
            "animal", "animals", "bird", "birds", "dog", "cat", "fish", "horse",
            "cow", "pig", "sheep", "lion", "tiger", "bear", "wolf", "fox", "mouse",
            "insect", "bee", "butterfly", "tree", "trees", "flower", "flowers",
            "plant", "plants", "grass", "leaf", "leaves", "forest", "wood", "woods",
            "mountain", "mountains", "hill", "river", "lake", "sea", "ocean",
            "beach", "island", "sky", "sun", "moon", "star", "stars", "cloud",
            "rain", "rainy", "rainfall", "rainstorm", "rainbow", "snow", "snowy",
            "snowfall", "snowstorm", "wind", "windy", "storm", "thunder",
            "thunderstorm", "lightning", "weather", "fog", "mist", "frost",
            "nature", "earth", "ground", "soil", "rock", "stone", "sand", "field",
            "garden", "farm", "wild", "natural", "environment", "climate",
            "temperature", "hot", "cold", "warm", "cool", "freeze", "melt",
            "rainforest",
        },
        (
            "動物", "鳥", "犬", "猫", "魚", "馬", "牛", "豚", "羊", "虫", "木",
            "花", "草", "葉", "森", "山", "川", "湖", "海", "浜", "島", "空",
            "太陽", "月光", "月が", "月を", "星", "雲", "雨", "雪", "風", "嵐",
            "雷", "天気", "自然", "地球", "地面", "岩", "石", "砂", "畑", "庭",
            "気候", "気温", "環境", "霜", "霧", "虹", "植物", "雨林", "光",
            "光線", "日光",
        ),
    ),
    (
        "feelings",
        {
            "feel", "feeling", "feelings", "emotion", "mood", "happy", "sad",
            "angry", "afraid", "scared", "worried", "nervous", "surprised",
            "excited", "bored", "tired", "lonely", "proud", "ashamed", "jealous",
            "love", "hate", "like", "dislike", "hope", "wish", "fear", "worry",
            "think", "thought", "believe", "mind", "heart", "soul", "dream",
            "memory", "remember", "forget", "understand", "realize", "decide",
            "choice", "opinion", "idea", "agree", "disagree", "prefer",
            "kind", "nice", "friendly", "rude", "polite", "honest", "brave",
            "clever", "stupid", "smart", "lazy", "patient", "serious", "funny",
            "interesting", "boring", "amazing", "awful", "terrible", "wonderful",
            "beautiful", "ugly", "pleasant", "pain", "hurt", "cry", "laugh",
            "smile", "enjoy", "please", "glad", "sorry", "thank", "thanks",
        },
        (
            "感情", "感じ", "思考", "思う", "考える", "心の", "心を", "喜び",
            "楽しい", "悲しい", "怒る", "怖い", "不安", "心配", "驚く", "興奮",
            "退屈", "疲れる", "孤独", "誇り", "恥ずかしい", "嫉妬", "愛する",
            "嫌い", "好き", "望む", "願う", "恐れ", "覚える", "忘れる", "理解",
            "決める", "意見", "親切", "丁寧", "正直", "勇敢", "賢い", "怠惰",
            "忍耐", "真面目", "面白い", "素敵", "ひどい", "素晴", "美しい",
            "醜い", "痛い", "泣く", "笑う", "感謝", "性格", "気分", "気持",
        ),
    ),
    (
        "life",
        {
            "food", "meal", "breakfast", "lunch", "dinner", "bread", "rice", "meat",
            "fruit", "vegetable", "water", "milk", "tea", "coffee", "juice", "beer",
            "wine", "eat", "drink", "cook", "kitchen", "restaurant", "hungry",
            "thirsty", "house", "home", "room", "door", "window", "floor", "wall",
            "bed", "table", "chair", "bathroom", "toilet", "family", "mother",
            "father", "parent", "brother", "sister", "son", "daughter", "baby",
            "child", "children", "husband", "wife", "clothes", "shirt", "shoes",
            "hat", "coat", "wear", "body", "head", "hand", "foot", "eye", "ear",
            "mouth", "nose", "face", "hair", "health", "doctor", "hospital",
            "medicine", "sick", "ill", "sleep", "wake", "wash", "clean", "dirty",
            "money", "price", "buy", "sell", "pay", "cost", "cheap", "expensive",
            "color", "colour", "red", "blue", "green", "yellow", "black", "white",
        },
        (
            "食事", "食べる", "飲む", "料理", "ご飯", "パン", "肉", "果物", "野菜",
            "牛乳", "お茶", "コーヒ", "お酒", "酒を", "家", "部屋", "戸", "窓",
            "床", "壁", "ベッド", "机", "椅子", "風呂", "トイレ", "家族", "母親",
            "父親", "両親", "兄弟", "姉妹", "息子", "娘", "赤ちゃん", "子供",
            "夫", "妻", "衣服", "シャツ", "靴", "帽子", "身体", "頭の", "頭を",
            "手の", "手を", "手首", "手足", "足の", "足を", "足首", "目の",
            "目を", "耳の", "耳を", "口の", "口を", "鼻の", "鼻を", "顔", "髪",
            "健康", "医者", "病院", "薬", "病気", "眠る", "眠い", "洗う", "掃除",
            "お金", "値段", "買う", "売る", "払う", "安い", "高い", "色",
        ),
    ),
    (
        "town",
        {
            "travel", "trip", "journey", "tour", "holiday", "vacation", "hotel",
            "airport", "station", "train", "bus", "car", "taxi", "plane", "flight",
            "ship", "boat", "bike", "bicycle", "road", "street", "map", "ticket",
            "passport", "luggage", "bag", "shop", "store", "market", "mall",
            "city", "town", "village", "country", "place", "address", "left",
            "right", "north", "south", "east", "west", "near", "far", "arrive",
            "leave", "depart", "visit", "tourist", "guide", "bridge", "park",
            "museum", "bank", "post", "office", "police", "hospital",
        },
        (
            "旅行", "旅する", "観光", "休暇", "ホテル", "空港", "駅", "電車",
            "バス", "自動車", "タクシー", "飛行機", "船", "自転車", "道路",
            "地図", "切符", "パスポ", "荷物", "商店", "市場", "都市", "町",
            "村", "国家", "国籍", "住所", "左側", "右側", "北側", "南側",
            "東側", "西側", "近い", "遠い", "到着", "出発", "訪問", "橋",
            "公園", "美術館", "銀行", "郵便局", "警察",
        ),
    ),
    (
        "people",
        {
            "work", "job", "jobs", "office", "company", "business", "boss",
            "manager", "worker", "employee", "employer", "salary", "wage",
            "meeting", "career", "profession", "school", "student", "teacher",
            "class", "lesson", "homework", "exam", "test", "study", "learn",
            "university", "college", "education", "friend", "friends", "people",
            "person", "man", "woman", "boy", "girl", "name", "age", "born",
            "live", "life", "country", "nationality", "language", "english",
            "japanese", "chinese", "spanish", "french", "german",
        },
        (
            "仕事", "職業", "会社", "事務所", "社員", "給料", "会議", "学校",
            "生徒", "学生", "先生", "教師", "授業", "宿題", "試験", "勉強",
            "大学", "教育", "友達", "友人", "男性", "女性", "少年", "少女",
            "名前", "年齢", "住む", "住居", "国籍", "言語", "英語", "日本語",
        ),
    ),
    (
        "hobby",
        {
            "hobby", "hobbies", "sport", "sports", "game", "games", "play",
            "music", "song", "sing", "dance", "movie", "film", "tv", "television",
            "radio", "book", "read", "write", "draw", "paint", "photo",
            "camera", "computer", "internet", "phone", "email", "news",
            "newspaper", "magazine", "art", "museum", "theater", "theatre",
            "concert", "party", "fun", "entertainment", "leisure",
        },
        (
            "趣味", "スポーツ", "試合", "遊ぶ", "音楽", "歌う", "踊る", "映画",
            "テレビ", "ラジオ", "書籍", "図書", "読書", "本を", "読む", "書く",
            "描く", "写真", "カメラ", "パソコン", "ネット", "電話", "メール",
            "ニュース", "新聞", "雑誌", "芸術", "劇場", "コンサート", "パーティ",
            "娯楽",
        ),
    ),
]


def raw_theme(row: dict[str, str]) -> str:
    for key in ("CoreInventory 1", "CoreInventory 2", "Threshold"):
        value = (row.get(key) or "").strip()
        if value:
            return value
    return ""


def _lemma(word: str) -> str:
    return normalize_word(word.split("/")[0])


def lemma_category(word: str) -> str | None:
    """Strong match: English headword itself is listed for a category."""
    lemma = _lemma(word)
    if lemma in BASICS_WORDS:
        return "basics"
    for cat_id, en_words, _ja_keys in RULE_GROUPS:
        if lemma in en_words:
            return cat_id
    return None


def primary_ja_senses(ja: str, limit: int = 1) -> str:
    """Use only the first N dictionary senses (split by /) for JA keywords."""
    parts = [p.strip() for p in re.split(r"\s*/\s*", ja or "") if p.strip()]
    return " / ".join(parts[:limit])


def classify_by_rules(word: str, ja: str, pos: str) -> str:
    """Rule-based category for theme-less (or unmapped) headwords."""
    lemma_hit = lemma_category(word)
    if lemma_hit:
        return lemma_hit

    pos_l = (pos or "").strip().lower()
    if pos_l in BASICS_POS or pos_l == "number":
        return "basics"

    # 例文は使わない。和訳は第1義のみ（第2義以降の部分一致誤爆を避ける）
    ja_text = primary_ja_senses(ja, 1)
    for cat_id, _en_words, ja_keys in RULE_GROUPS:
        for key in ja_keys:
            if key in ja_text:
                return cat_id
    return CAT_OTHER


def category_of(theme: str, word: str = "", ja: str = "", pos: str = "") -> str:
    # 英単語が明示リストにあるときは theme より優先
    # (CEFR theme が Media などで rain などが誤ることがあるため)
    lemma_hit = lemma_category(word)
    if lemma_hit:
        return lemma_hit

    if theme:
        mapped = THEME_TO_CAT.get(theme.strip().lower())
        if mapped:
            return mapped
    return classify_by_rules(word, ja, pos)


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


def load_examples(path: Path) -> dict[tuple[str, str], dict[str, str]]:
    """Optional curated examples keyed by (normalized word, CEFR)."""
    out: dict[tuple[str, str], dict[str, str]] = {}
    if not path.exists():
        return out
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            word = normalize_word(row.get("word") or "")
            cefr = (row.get("cefr") or "").strip()
            en = (row.get("example_en") or "").strip()
            ja = (row.get("example_ja") or "").strip()
            if not word or cefr not in LEVELS or not en or not ja:
                continue
            out[(word, cefr)] = {"example_en": en, "example_ja": ja}
    return out


def load_phonetics(path: Path) -> dict[str, dict[str, str]]:
    """Optional IPA/audio keyed by exact card headword."""
    out: dict[str, dict[str, str]] = {}
    if not path.exists():
        return out
    with path.open(encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f):
            word = (row.get("word") or "").strip()
            if not word:
                continue
            out[word] = {
                "ipa": (row.get("ipa") or "").strip(),
                "audio": (row.get("audio") or "").strip(),
            }
    return out


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
    examples = load_examples(EXAMPLES_PATH)
    phonetics = load_phonetics(PHONETICS_PATH)
    print(f"EJDICT entries indexed: {len(ejdict)}")
    print(f"Curated examples: {len(examples)}")
    print(f"Phonetics: {len(phonetics)}")

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
            pos = (row.get("pos") or "").strip()

            candidates = headword_candidates(headword)
            found_key = None
            raw_ja = None
            for cand in candidates:
                if cand in ejdict:
                    found_key = cand
                    raw_ja = ejdict[cand]
                    break

            if found_key is None:
                cat = category_of(theme, headword, "", pos)
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
            cat = category_of(theme, headword, ja, pos)
            ex = examples.get((normalize_word(headword.split("/")[0]), cefr), {})
            ph = phonetics.get(headword) or phonetics.get(
                headword.split("/")[0].strip(), {}
            )
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
                    "pos": pos,
                    "example_en": ex.get("example_en", ""),
                    "example_ja": ex.get("example_ja", ""),
                    "ipa": ph.get("ipa", ""),
                    "audio": ph.get("audio", ""),
                }
            )

    level_order = {level: i for i, level in enumerate(LEVELS)}
    matched_rows.sort(key=lambda r: (level_order[r["cefr"]], r["word"].lower()))
    unmatched_rows.sort(key=lambda r: (level_order.get(r["cefr"], 99), r["word"].lower()))

    OUT_MATCHED.parent.mkdir(parents=True, exist_ok=True)

    with OUT_MATCHED.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "word",
                "ja",
                "cefr",
                "cat",
                "theme",
                "pos",
                "example_en",
                "example_ja",
                "ipa",
                "audio",
            ],
        )
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
