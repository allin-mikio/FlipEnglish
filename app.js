(function () {
  "use strict";

  var CSV_URL = "data/cards.csv";
  var LEVELS = ["A1", "A2", "B1", "B2"];
  var LEVEL_INFO = {
    A1: {
      color: "#259B4D",
      label: "入門",
      school: "小学校高学年 〜 中学校基礎",
      eiken: "英検5級 〜 3級",
    },
    A2: {
      color: "#28A7E0",
      label: "初級",
      school: "中学校卒業 〜 高校基礎",
      eiken: "英検準2級",
    },
    B1: {
      color: "#F58F1E",
      label: "中級",
      school: "高校卒業 〜 大学入試標準",
      eiken: "英検2級",
    },
    B2: {
      color: "#D51F6E",
      label: "中上級",
      school: "難関大学入試 〜 大学生・ビジネス",
      eiken: "英検準1級",
    },
  };
  var STATUS_UNREAD = "unread";
  var STATUS_LEARNED = "learned";
  var STATUS_REVIEW = "review";
  var FILTERS = [
    { id: "all", label: "すべて" },
    { id: "unread", label: "未読" },
    { id: "review", label: "要復習" },
  ];
  var TOAST_MS = 5000;
  var CATS = [
    { id: "all", label: "全部" },
    { id: "life", label: "生活" },
    { id: "town", label: "街・移動" },
    { id: "people", label: "人・仕事" },
    { id: "hobby", label: "趣味" },
    { id: "other", label: "その他" },
  ];
  var BAND_PAD_Y = 30;
  var OVERSCAN = 10;
  var STORAGE_KEY = "flipenglish.status.v1";
  var LEGACY_CHECKED_KEY = "flipenglish.checked.v1";
  var LONG_PRESS_MS = 550;

  var listEl = document.getElementById("card-list");
  var tabsEl = document.getElementById("level-tabs");
  var catEl = document.getElementById("cat-tabs");
  var filterEl = document.getElementById("filter-tabs");
  var statusEl = document.getElementById("status");
  var toastEl = document.getElementById("level-toast");
  var topBtn = document.getElementById("top-btn");
  var unreadBtn = document.getElementById("unread-btn");
  var toastTimer = null;
  var TOP_SHOW_Y = 240;

  var allCards = [];
  var viewCards = [];
  var heights = [];
  var offsets = [];
  var totalHeight = 0;
  var mounted = Object.create(null);
  var activeLevel = "A1";
  var activeCat = "all";
  var filterAll = true;
  var filterUnread = false;
  var filterReview = false;
  var statusMap = loadStatusMap();
  var baseH = 76;
  var gapH = 8;
  var scrollRaf = 0;
  var lastRangeKey = "";

  function setStatus(message, isError) {
    if (!statusEl) return;
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.style.color = isError ? "#b00020" : "";
  }

  function cardKey(card) {
    return card.cefr + "::" + card.word;
  }

  function loadStatusMap() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" ? parsed : {};
      }
    } catch (err) {
      /* fall through to legacy */
    }

    // Migrate old On/Off map → learned
    try {
      var legacy = localStorage.getItem(LEGACY_CHECKED_KEY);
      if (!legacy) return {};
      var oldMap = JSON.parse(legacy);
      if (!oldMap || typeof oldMap !== "object") return {};
      var migrated = {};
      var keys = Object.keys(oldMap);
      for (var i = 0; i < keys.length; i++) {
        if (oldMap[keys[i]]) migrated[keys[i]] = STATUS_LEARNED;
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    } catch (err2) {
      return {};
    }
  }

  function saveStatusMap() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(statusMap));
    } catch (err) {
      /* ignore */
    }
  }

  function getStatus(card) {
    return statusMap[cardKey(card)] || STATUS_UNREAD;
  }

  function setStatusState(card, status) {
    var key = cardKey(card);
    if (!status || status === STATUS_UNREAD) delete statusMap[key];
    else statusMap[key] = status;
    saveStatusMap();
  }

  function isLearned(card) {
    return getStatus(card) === STATUS_LEARNED;
  }

  function parseCsvLine(line) {
    var cols = [];
    var cur = "";
    var inQuotes = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line.charAt(i);
      if (inQuotes) {
        if (ch === '"') {
          if (line.charAt(i + 1) === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        cols.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur);
    return cols;
  }

  function parseCsv(text) {
    var lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
    if (!lines.length) return [];

    var header = parseCsvLine(lines[0]).map(function (h) {
      return h.trim();
    });
    var idx = {};
    for (var h = 0; h < header.length; h++) {
      idx[header[h]] = h;
    }

    function col(cols, name) {
      var i = idx[name];
      return i === undefined ? "" : (cols[i] || "").trim();
    }

    var cards = [];
    for (var i = 1; i < lines.length; i++) {
      var line = lines[i];
      if (!line || !line.trim()) continue;
      var cols = parseCsvLine(line);
      var word = col(cols, "word");
      var ja = col(cols, "ja");
      var cefr = col(cols, "cefr") || "A1";
      var cat = col(cols, "cat") || "other";
      var pos = col(cols, "pos");
      var exampleEn = col(cols, "example_en");
      var exampleJa = col(cols, "example_ja");
      var ipa = col(cols, "ipa");
      var audio = col(cols, "audio");
      if (!word || !ja) continue;
      cards.push({
        word: word,
        ja: ja,
        cefr: cefr,
        cat: cat,
        pos: pos,
        exampleEn: exampleEn,
        exampleJa: exampleJa,
        ipa: ipa,
        audio: audio,
      });
    }
    return cards;
  }

  function cssPx(name, fallback) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    var n = parseFloat(raw);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  function refreshMetrics() {
    baseH = cssPx("--band-h", 76);
    gapH = cssPx("--card-gap", 8);
  }

  function measureClassHeight(className, text, widthPx) {
    var probe = document.createElement("div");
    probe.className = className;
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.pointerEvents = "none";
    probe.style.left = "-9999px";
    probe.style.top = "0";
    probe.style.width = widthPx + "px";
    probe.style.display = "block";
    probe.style.overflow = "visible";
    probe.textContent = text;
    document.body.appendChild(probe);
    var h = Math.ceil(probe.getBoundingClientRect().height || probe.scrollHeight);
    document.body.removeChild(probe);
    return h;
  }

  function measureJaHeight(text, widthPx) {
    return measureClassHeight("ja", text, widthPx);
  }

  var POS_LABEL = {
    noun: "名",
    verb: "動",
    adjective: "形",
    adverb: "副",
    pronoun: "代",
    preposition: "前",
    conjunction: "接",
    determiner: "限",
    number: "数",
    "modal auxiliary": "助",
    "be-verb": "動",
    "do-verb": "動",
    "have-verb": "動",
    interjection: "感",
    "infinitive-to": "to",
  };

  function posLabel(pos) {
    if (!pos) return "";
    return POS_LABEL[pos] || pos;
  }

  var speakAudio = null;

  function speakWord(word, audioUrl) {
    var text = (word || "").split("/")[0].trim();
    if (!text) return;

    if (speakAudio) {
      try {
        speakAudio.pause();
      } catch (err) {
        /* ignore */
      }
      speakAudio = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    if (audioUrl) {
      try {
        speakAudio = new Audio(audioUrl);
        speakAudio.play().catch(function () {
          speakWithWebSpeech(text);
        });
        return;
      } catch (err2) {
        /* fall through */
      }
    }
    speakWithWebSpeech(text);
  }

  function speakWithWebSpeech(text) {
    if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    var utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    utter.rate = 0.92;
    window.speechSynthesis.speak(utter);
  }

  function matchesFilter(card) {
    if (activeCat !== "all" && card.cat !== activeCat) return false;
    if (filterAll) return true;
    var st = getStatus(card);
    if (filterUnread && st === STATUS_UNREAD) return true;
    if (filterReview && st === STATUS_REVIEW) return true;
    return false;
  }

  function catLabel(id) {
    for (var i = 0; i < CATS.length; i++) {
      if (CATS[i].id === id) return CATS[i].label;
    }
    return id;
  }

  function currentFilterLabel() {
    if (filterAll) return "すべて";
    var parts = [];
    if (filterUnread) parts.push("未読");
    if (filterReview) parts.push("要復習");
    return parts.length ? parts.join("+") : "すべて";
  }

  function normalizeStatusFilters() {
    if (filterAll) {
      filterUnread = false;
      filterReview = false;
      return;
    }
    if (!filterUnread && !filterReview) filterAll = true;
  }

  function assignLevelIndexes() {
    var counters = {};
    for (var i = 0; i < allCards.length; i++) {
      var card = allCards[i];
      var n = (counters[card.cefr] || 0) + 1;
      counters[card.cefr] = n;
      card.index = n;
    }
  }

  function cardsForView() {
    var out = [];
    for (var i = 0; i < allCards.length; i++) {
      var card = allCards[i];
      if (card.cefr !== activeLevel) continue;
      if (!matchesFilter(card)) continue;
      out.push(card);
    }
    return out;
  }

  function rebuildGeometry() {
    offsets = new Array(viewCards.length);
    var y = 0;
    for (var i = 0; i < viewCards.length; i++) {
      offsets[i] = y;
      y += heights[i] + gapH;
    }
    totalHeight = viewCards.length ? y - gapH : 0;
    listEl.style.height = totalHeight + "px";
  }

  function setItemHeight(index, height, repaint) {
    if (index < 0 || index >= heights.length) return;
    if (heights[index] === height) {
      var node = mounted[index];
      if (node) {
        node.style.top = offsets[index] + "px";
        node.style.height = height + "px";
      }
      return;
    }
    heights[index] = height;
    rebuildGeometry();
    if (repaint !== false) paintVirtual(true);
  }

  function clearMounted() {
    var keys = Object.keys(mounted);
    for (var i = 0; i < keys.length; i++) {
      var node = mounted[keys[i]];
      if (node && typeof node._teardown === "function") node._teardown();
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    mounted = Object.create(null);
    lastRangeKey = "";
  }

  function statusClass(status) {
    if (status === STATUS_LEARNED) return " is-learned";
    if (status === STATUS_REVIEW) return " is-review";
    return "";
  }

  function statusMarkText(status) {
    if (status === STATUS_LEARNED) return "済";
    if (status === STATUS_REVIEW) return "要";
    return "";
  }

  function statusAria(status) {
    if (status === STATUS_LEARNED) return "学習済み。タップで要復習、長押しで未読";
    if (status === STATUS_REVIEW) return "要復習。タップで学習済み、長押しで未読";
    return "未読。タップで要復習、長押しで未読のまま";
  }

  function createCard(card, index) {
    var root = document.createElement("div");
    var current = getStatus(card);
    root.className = "card" + statusClass(current);
    root.dataset.index = String(card.index || "");
    root.dataset.vindex = String(index);
    root.setAttribute("role", "button");
    root.tabIndex = 0;
    root.setAttribute("aria-label", card.word + "。タップで訳を見る");
    root.style.top = offsets[index] + "px";
    root.style.height = heights[index] + "px";

    var inner = document.createElement("div");
    inner.className = "card-inner";

    var front = document.createElement("div");
    front.className = "face face-front";
    front.setAttribute("aria-hidden", "false");

    var word = document.createElement("div");
    word.className = "word";
    word.textContent = card.word;

    var statusCol = document.createElement("div");
    statusCol.className = "status-col";

    var markBtn = document.createElement("button");
    markBtn.type = "button";
    markBtn.className = "status-mark";
    markBtn.textContent = statusMarkText(current);
    markBtn.setAttribute("aria-label", card.word + " " + statusAria(current));
    markBtn.title = "タップ: 要復習切替 / 長押し: 未読";

    var indexEl = document.createElement("span");
    indexEl.className = "card-index";
    indexEl.textContent = String(card.index || "");

    statusCol.appendChild(markBtn);
    statusCol.appendChild(indexEl);
    front.appendChild(word);
    front.appendChild(statusCol);

    var back = document.createElement("div");
    back.className = "face face-back";
    back.setAttribute("aria-hidden", "true");

    var backWordRow = document.createElement("div");
    backWordRow.className = "back-word-row";

    var backWord = document.createElement("span");
    backWord.className = "back-word";
    backWord.textContent = card.word;
    backWordRow.appendChild(backWord);

    var posText = posLabel(card.pos);
    if (posText) {
      var backPos = document.createElement("span");
      backPos.className = "back-pos";
      backPos.textContent = posText;
      backWordRow.appendChild(backPos);
    }

    if (card.ipa) {
      var backIpa = document.createElement("span");
      backIpa.className = "back-ipa";
      backIpa.textContent = card.ipa;
      backWordRow.appendChild(backIpa);
    }

    var speakBtn = document.createElement("button");
    speakBtn.type = "button";
    speakBtn.className = "speak-btn";
    speakBtn.textContent = "▶";
    speakBtn.title = "発音を聞く";
    speakBtn.setAttribute("aria-label", card.word + " の発音を聞く");
    backWordRow.appendChild(speakBtn);

    var ja = document.createElement("div");
    ja.className = "ja";
    ja.textContent = card.ja;
    back.appendChild(backWordRow);
    back.appendChild(ja);

    var hasExample = !!(card.exampleEn && card.exampleJa);
    var exampleOpen = hasExample;
    var exampleToggle = null;
    var exampleBody = null;
    var EXAMPLE_TOGGLE_H = 22;
    var EXAMPLE_GAP = 4;

    if (hasExample) {
      var exampleBlock = document.createElement("div");
      exampleBlock.className = "example-block";

      exampleToggle = document.createElement("button");
      exampleToggle.type = "button";
      exampleToggle.className = "example-toggle";
      exampleToggle.textContent = "▼ 例文";
      exampleToggle.setAttribute("aria-expanded", "true");

      exampleBody = document.createElement("div");
      exampleBody.className = "example-body";
      exampleBody.hidden = false;

      var exampleEn = document.createElement("div");
      exampleEn.className = "example-en";
      exampleEn.textContent = card.exampleEn;

      var exampleJaEl = document.createElement("div");
      exampleJaEl.className = "example-ja";
      exampleJaEl.textContent = card.exampleJa;

      exampleBody.appendChild(exampleEn);
      exampleBody.appendChild(exampleJaEl);
      exampleBlock.appendChild(exampleToggle);
      exampleBlock.appendChild(exampleBody);
      back.appendChild(exampleBlock);
    }

    inner.appendChild(front);
    inner.appendChild(back);
    root.appendChild(inner);

    var longPressTimer = null;
    var longPressFired = false;
    var frontH = baseH;
    var textWidth = Math.max(0, listEl.clientWidth - 28);
    var jaH = measureJaHeight(card.ja, textWidth || 320);
    var exampleClosedExtra = hasExample ? EXAMPLE_TOGGLE_H + EXAMPLE_GAP : 0;
    var exampleOpenExtra = 0;
    if (hasExample) {
      exampleOpenExtra =
        EXAMPLE_TOGGLE_H +
        EXAMPLE_GAP +
        measureClassHeight("example-en", card.exampleEn, textWidth || 320) +
        4 +
        measureClassHeight("example-ja", card.exampleJa, textWidth || 320) +
        EXAMPLE_GAP;
    }
    var backHClosed = Math.max(frontH, jaH + BAND_PAD_Y + 16 + exampleClosedExtra);
    var backHOpen = Math.max(frontH, jaH + BAND_PAD_Y + 16 + exampleOpenExtra);
    var backH = exampleOpen ? backHOpen : backHClosed;

    function currentBackH() {
      return exampleOpen ? backHOpen : backHClosed;
    }

    function setExampleOpen(open) {
      if (!hasExample || !exampleToggle || !exampleBody) return;
      exampleOpen = open;
      exampleBody.hidden = !open;
      exampleToggle.textContent = open ? "▼ 例文" : "▶ 例文";
      exampleToggle.setAttribute("aria-expanded", open ? "true" : "false");
      backH = currentBackH();
      if (root.classList.contains("is-flipped")) {
        setItemHeight(index, backH, true);
      }
    }

    function clearLongPress() {
      if (longPressTimer !== null) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    }

    function applyStatus(status) {
      setStatusState(card, status);
      current = status;
      root.className =
        "card" +
        statusClass(status) +
        (root.classList.contains("is-flipped") ? " is-flipped" : "");
      markBtn.textContent = statusMarkText(status);
      markBtn.setAttribute("aria-label", card.word + " " + statusAria(status));
      refreshTabCounts();
      if (!matchesFilter(card)) {
        renderList(false);
        return;
      }
      updateStatusCount();
    }

    function showFront() {
      root.classList.remove("is-flipped");
      setItemHeight(index, frontH, true);
      root.setAttribute("aria-label", card.word + "。タップで訳を見る");
      front.setAttribute("aria-hidden", "false");
      back.setAttribute("aria-hidden", "true");
    }

    function showBack() {
      var wasUnread = current === STATUS_UNREAD;
      if (hasExample) setExampleOpen(true);
      backH = currentBackH();
      root.classList.add("is-flipped");
      setItemHeight(index, backH, true);
      root.setAttribute("aria-label", card.word + "：" + card.ja + "。タップで戻す");
      front.setAttribute("aria-hidden", "true");
      back.setAttribute("aria-hidden", "false");
      // 裏を見た時点で未読→学習済み。要復習は手動専用
      if (wasUnread) applyStatus(STATUS_LEARNED);
      // 未読フリップ時は裏面の占有高さ分スクロールし、同じ位置のタップで次へ進める
      if (wasUnread) {
        window.scrollBy({
          top: backH + gapH,
          left: 0,
          behavior: "smooth",
        });
      }
    }

    function toggleFlip() {
      if (root.classList.contains("is-flipped")) showFront();
      else showBack();
    }

    function onStatusTap() {
      if (current === STATUS_REVIEW) applyStatus(STATUS_LEARNED);
      else applyStatus(STATUS_REVIEW);
    }

    root.addEventListener("click", function (ev) {
      if (statusCol.contains(ev.target)) return;
      if (speakBtn.contains(ev.target)) return;
      if (exampleToggle && exampleToggle.contains(ev.target)) return;
      if (exampleBody && !exampleBody.hidden && exampleBody.contains(ev.target)) {
        return;
      }
      toggleFlip();
    });

    root.addEventListener("keydown", function (ev) {
      if (ev.target === markBtn || ev.target === speakBtn) return;
      if (exampleToggle && ev.target === exampleToggle) return;
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggleFlip();
      }
    });

    statusCol.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });

    speakBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      speakWord(card.word, card.audio || "");
    });

    if (exampleToggle) {
      exampleToggle.addEventListener("click", function (ev) {
        ev.stopPropagation();
        setExampleOpen(!exampleOpen);
      });
    }

    markBtn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (longPressFired) {
        longPressFired = false;
        return;
      }
      onStatusTap();
    });

    markBtn.addEventListener("pointerdown", function (ev) {
      ev.stopPropagation();
      longPressFired = false;
      clearLongPress();
      longPressTimer = setTimeout(function () {
        longPressFired = true;
        applyStatus(STATUS_UNREAD);
      }, LONG_PRESS_MS);
    });

    markBtn.addEventListener("pointerup", clearLongPress);
    markBtn.addEventListener("pointerleave", clearLongPress);
    markBtn.addEventListener("pointercancel", clearLongPress);
    markBtn.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
    });

    root._teardown = function () {
      clearLongPress();
    };
    return root;
  }

  function visibleRange() {
    if (!viewCards.length) return { start: 0, end: -1 };

    var listTop = listEl.getBoundingClientRect().top + window.scrollY;
    var viewTop = window.scrollY;
    var viewBottom = viewTop + window.innerHeight;
    var localTop = Math.max(0, viewTop - listTop);
    var localBottom = Math.max(0, viewBottom - listTop);

    var start = 0;
    while (start < viewCards.length && offsets[start] + heights[start] < localTop) {
      start++;
    }
    var end = start;
    while (end < viewCards.length && offsets[end] <= localBottom) {
      end++;
    }
    end = end - 1;

    start = Math.max(0, start - OVERSCAN);
    end = Math.min(viewCards.length - 1, end + OVERSCAN);
    return { start: start, end: end };
  }

  function paintVirtual(force) {
    if (!viewCards.length) {
      clearMounted();
      return;
    }

    var range = visibleRange();
    var key = range.start + ":" + range.end + ":" + totalHeight;
    if (!force && key === lastRangeKey) {
      var existing = Object.keys(mounted);
      for (var e = 0; e < existing.length; e++) {
        var ei = Number(existing[e]);
        var enode = mounted[ei];
        if (!enode) continue;
        enode.style.top = offsets[ei] + "px";
        enode.style.height = heights[ei] + "px";
      }
      return;
    }
    lastRangeKey = key;

    var keep = Object.create(null);
    for (var i = range.start; i <= range.end; i++) {
      keep[i] = 1;
      var node = mounted[i];
      if (!node) {
        node = createCard(viewCards[i], i);
        mounted[i] = node;
        listEl.appendChild(node);
      } else {
        node.style.top = offsets[i] + "px";
        node.style.height = heights[i] + "px";
      }
    }

    var keys = Object.keys(mounted);
    for (var k = 0; k < keys.length; k++) {
      var idx = Number(keys[k]);
      if (keep[idx]) continue;
      var dead = mounted[idx];
      if (dead && typeof dead._teardown === "function") dead._teardown();
      if (dead && dead.parentNode) dead.parentNode.removeChild(dead);
      delete mounted[idx];
    }
  }

  function cardAbsTop(index) {
    return listEl.getBoundingClientRect().top + window.scrollY + offsets[index];
  }

  function isCardInViewport(index) {
    var top = cardAbsTop(index);
    var bottom = top + heights[index];
    var viewTop = window.scrollY;
    var viewBottom = viewTop + window.innerHeight;
    return bottom > viewTop + 4 && top < viewBottom - 4;
  }

  function hasVisibleUnread() {
    for (var i = 0; i < viewCards.length; i++) {
      if (getStatus(viewCards[i]) !== STATUS_UNREAD) continue;
      if (isCardInViewport(i)) return true;
    }
    return false;
  }

  function findNearestUnreadIndex() {
    var viewTop = window.scrollY;
    var viewBottom = viewTop + window.innerHeight;
    var bestBelow = -1;
    var bestBelowDist = Infinity;
    var bestAbove = -1;
    var bestAboveDist = Infinity;

    for (var i = 0; i < viewCards.length; i++) {
      if (getStatus(viewCards[i]) !== STATUS_UNREAD) continue;
      if (isCardInViewport(i)) continue;

      var top = cardAbsTop(i);
      var bottom = top + heights[i];
      if (top >= viewBottom - 4) {
        var down = top - viewBottom;
        if (down < bestBelowDist) {
          bestBelowDist = down;
          bestBelow = i;
        }
      } else if (bottom <= viewTop + 4) {
        var up = viewTop - bottom;
        if (up < bestAboveDist) {
          bestAboveDist = up;
          bestAbove = i;
        }
      }
    }

    if (bestBelow >= 0) return bestBelow;
    return bestAbove;
  }

  function jumpToNearestUnread() {
    var idx = findNearestUnreadIndex();
    if (idx < 0) return;
    var cardMid = cardAbsTop(idx) + heights[idx] / 2;
    var y = Math.max(0, cardMid - window.innerHeight / 2);
    window.scrollTo({ top: y, behavior: "smooth" });
  }

  function updateNavBtns() {
    if (topBtn) topBtn.hidden = window.scrollY < TOP_SHOW_Y;
    if (!unreadBtn) return;
    var target = findNearestUnreadIndex();
    unreadBtn.hidden = target < 0 || hasVisibleUnread();
  }

  function onScrollOrResize() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      paintVirtual(false);
      updateNavBtns();
    });
  }

  function countLevelStats(level) {
    var target = level || activeLevel;
    var total = 0;
    var on = 0;
    for (var i = 0; i < allCards.length; i++) {
      if (allCards[i].cefr !== target) continue;
      total++;
      if (isLearned(allCards[i])) on++;
    }
    return { total: total, on: on, off: total - on };
  }

  function countCatStats(catId, level) {
    var targetLevel = level || activeLevel;
    var total = 0;
    var on = 0;
    for (var i = 0; i < allCards.length; i++) {
      var card = allCards[i];
      if (card.cefr !== targetLevel) continue;
      if (catId !== "all" && card.cat !== catId) continue;
      total++;
      if (isLearned(card)) on++;
    }
    return { total: total, on: on, off: total - on };
  }

  function progressPct(on, total) {
    return total > 0 ? Math.round((on / total) * 1000) / 10 : 0;
  }

  function fillTabButton(btn, title, on, total) {
    btn.textContent = "";
    var titleEl = document.createElement("span");
    titleEl.className = "tab-title";
    titleEl.textContent = title;
    var countEl = document.createElement("span");
    countEl.className = "tab-count";
    countEl.textContent = on + "/" + total;
    btn.appendChild(titleEl);
    btn.appendChild(countEl);
    btn.setAttribute("aria-label", title + " " + on + "/" + total);
    btn.style.setProperty("--progress", progressPct(on, total) + "%");
  }

  function fillLevelTab(btn, level, on, total) {
    var info = LEVEL_INFO[level] || { color: "#888", label: "" };
    btn.textContent = "";
    btn.style.setProperty("--level-color", info.color);
    btn.style.setProperty("--progress", progressPct(on, total) + "%");

    var titleEl = document.createElement("span");
    titleEl.className = "tab-title";
    titleEl.textContent = level;

    var countEl = document.createElement("span");
    countEl.className = "tab-count";
    countEl.textContent = on + "/" + total;

    btn.appendChild(titleEl);
    btn.appendChild(countEl);
    btn.setAttribute(
      "aria-label",
      level + " " + info.label + " " + on + "/" + total
    );
  }

  function hideLevelToast() {
    if (!toastEl) return;
    toastEl.hidden = true;
    toastEl.textContent = "";
    if (toastTimer !== null) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  }

  function showLevelToast(level) {
    if (!toastEl) return;
    var info = LEVEL_INFO[level];
    if (!info) return;
    var stats = countLevelStats(level);
    toastEl.style.setProperty("--toast-color", info.color);
    toastEl.textContent = "";

    var badge = document.createElement("div");
    badge.className = "level-toast-badge";
    badge.textContent = level + " " + info.label;

    var school = document.createElement("div");
    school.className = "level-toast-line";
    school.textContent = "学校: " + info.school;

    var eiken = document.createElement("div");
    eiken.className = "level-toast-line";
    eiken.textContent = "英検: " + info.eiken;

    var words = document.createElement("div");
    words.className = "level-toast-words";
    words.textContent = stats.total.toLocaleString("ja-JP") + "語";

    toastEl.appendChild(badge);
    toastEl.appendChild(school);
    toastEl.appendChild(eiken);
    toastEl.appendChild(words);
    toastEl.hidden = false;

    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = setTimeout(hideLevelToast, TOAST_MS);
  }

  function updateStatusCount() {
    // タブ側で進捗・件数が分かるので、通常時はステータス行を出さない
    setStatus("");
    updateNavBtns();
  }

  function refreshTabCounts() {
    renderTabs();
    renderCats();
  }

  function renderTabs() {
    tabsEl.textContent = "";
    for (var i = 0; i < LEVELS.length; i++) {
      var level = LEVELS[i];
      var stats = countLevelStats(level);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "level-tab level-" +
        level.toLowerCase() +
        (level === activeLevel ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", level === activeLevel ? "true" : "false");
      btn.dataset.level = level;
      fillLevelTab(btn, level, stats.on, stats.total);
      btn.addEventListener("click", function (ev) {
        var next = ev.currentTarget.dataset.level;
        if (!next) return;
        var changed = next !== activeLevel;
        activeLevel = next;
        renderTabs();
        if (changed) {
          renderCats();
          renderList(true);
        }
        showLevelToast(next);
      });
      tabsEl.appendChild(btn);
    }
  }

  function renderCats() {
    catEl.textContent = "";
    for (var i = 0; i < CATS.length; i++) {
      var item = CATS[i];
      var stats = countCatStats(item.id, activeLevel);
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cat-tab" + (item.id === activeCat ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", item.id === activeCat ? "true" : "false");
      btn.dataset.cat = item.id;
      fillTabButton(btn, item.label, stats.on, stats.total);
      btn.addEventListener("click", function (ev) {
        var next = ev.currentTarget.dataset.cat;
        if (!next || next === activeCat) return;
        activeCat = next;
        renderCats();
        renderList(true);
      });
      catEl.appendChild(btn);
    }
  }

  function renderFilters() {
    normalizeStatusFilters();
    filterEl.textContent = "";
    filterEl.className = "filter-checks";

    function addCheck(id, label, checked) {
      var wrap = document.createElement("label");
      wrap.className = "status-check" + (checked ? " is-on" : "");
      var input = document.createElement("input");
      input.type = "checkbox";
      input.checked = checked;
      input.dataset.filter = id;
      var text = document.createElement("span");
      text.textContent = label;
      wrap.appendChild(input);
      wrap.appendChild(text);
      input.addEventListener("change", function () {
        if (id === "all") {
          filterAll = input.checked;
          if (filterAll) {
            filterUnread = false;
            filterReview = false;
          } else if (!filterUnread && !filterReview) {
            filterAll = true;
          }
        } else if (id === "unread") {
          filterUnread = input.checked;
          if (filterUnread) filterAll = false;
        } else if (id === "review") {
          filterReview = input.checked;
          if (filterReview) filterAll = false;
        }
        normalizeStatusFilters();
        renderFilters();
        renderList(true);
      });
      filterEl.appendChild(wrap);
    }

    addCheck("all", "すべて", filterAll);
    addCheck("unread", "未読", filterUnread);
    addCheck("review", "要復習", filterReview);
  }

  function renderList(scrollTop) {
    refreshMetrics();
    clearMounted();
    viewCards = cardsForView();
    heights = new Array(viewCards.length);
    for (var i = 0; i < viewCards.length; i++) heights[i] = baseH;
    rebuildGeometry();
    updateStatusCount();
    if (scrollTop) window.scrollTo(0, 0);
    paintVirtual(true);
  }

  function boot() {
    setStatus("読み込み中…");
    window.addEventListener("scroll", onScrollOrResize, { passive: true });
    window.addEventListener("resize", onScrollOrResize);
    if (topBtn) {
      topBtn.addEventListener("click", function () {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    }
    if (unreadBtn) {
      unreadBtn.addEventListener("click", jumpToNearestUnread);
    }
    updateNavBtns();
    document.addEventListener(
      "pointerdown",
      function (ev) {
        if (!toastEl || toastEl.hidden) return;
        if (toastEl.contains(ev.target)) return;
        if (ev.target.closest && ev.target.closest(".level-tab")) return;
        hideLevelToast();
      },
      true
    );

    fetch(CSV_URL + "?t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("CSV を読めませんでした (" + res.status + ")");
        return res.text();
      })
      .then(function (text) {
        allCards = parseCsv(text);
        if (!allCards.length) throw new Error("カードデータが空です");
        assignLevelIndexes();
        renderTabs();
        renderCats();
        renderFilters();
        renderList(false);
      })
      .catch(function (err) {
        setStatus(err.message || "読み込みに失敗しました", true);
      });
  }

  boot();
})();
