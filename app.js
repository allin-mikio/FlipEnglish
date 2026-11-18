(function () {
  "use strict";

  var CSV_URL = "data/cards.csv";
  var AUTO_BACK_MS = 3000;
  var LEVELS = ["A1", "A2", "B1", "B2"];
  var STATUS_UNREAD = "unread";
  var STATUS_LEARNED = "learned";
  var STATUS_REVIEW = "review";
  var FILTERS = [
    { id: "all", label: "すべて" },
    { id: "unread", label: "未読" },
    { id: "review", label: "要復習" },
  ];
  var CATS = [
    { id: "all", label: "全部" },
    { id: "life", label: "生活" },
    { id: "town", label: "街・移動" },
    { id: "people", label: "人・仕事" },
    { id: "hobby", label: "趣味" },
    { id: "other", label: "その他" },
  ];
  var BAND_PAD_Y = 24;
  var OVERSCAN = 10;
  var STORAGE_KEY = "flipenglish.status.v1";
  var LEGACY_CHECKED_KEY = "flipenglish.checked.v1";
  var LONG_PRESS_MS = 550;

  var listEl = document.getElementById("card-list");
  var tabsEl = document.getElementById("level-tabs");
  var catEl = document.getElementById("cat-tabs");
  var filterEl = document.getElementById("filter-tabs");
  var statusEl = document.getElementById("status");

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
  var baseH = 56;
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
      if (!word || !ja) continue;
      cards.push({ word: word, ja: ja, cefr: cefr, cat: cat });
    }
    return cards;
  }

  function cssPx(name, fallback) {
    var raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    var n = parseFloat(raw);
    return isFinite(n) && n > 0 ? n : fallback;
  }

  function refreshMetrics() {
    baseH = cssPx("--band-h", 56);
    gapH = cssPx("--card-gap", 8);
  }

  function measureJaHeight(text, widthPx) {
    var probe = document.createElement("div");
    probe.className = "ja";
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

    var ja = document.createElement("div");
    ja.className = "ja";
    ja.textContent = card.ja;
    back.appendChild(ja);

    inner.appendChild(front);
    inner.appendChild(back);
    root.appendChild(inner);

    var autoTimer = null;
    var longPressTimer = null;
    var longPressFired = false;
    var frontH = baseH;
    var textWidth = Math.max(0, listEl.clientWidth - 28);
    var backH = Math.max(frontH, measureJaHeight(card.ja, textWidth || 320) + BAND_PAD_Y);

    function clearAuto() {
      if (autoTimer !== null) {
        clearTimeout(autoTimer);
        autoTimer = null;
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
        clearAuto();
        renderList(false);
        return;
      }
      updateStatusCount();
    }

    function showFront(fromBack) {
      clearAuto();
      root.classList.remove("is-flipped");
      setItemHeight(index, frontH, true);
      root.setAttribute("aria-label", card.word + "。タップで訳を見る");
      front.setAttribute("aria-hidden", "false");
      back.setAttribute("aria-hidden", "true");
      // 要復習は手動専用。フリップ戻りでは未読→学習済みのみ自動遷移
      if (fromBack && current === STATUS_UNREAD) applyStatus(STATUS_LEARNED);
    }

    function showBack() {
      clearAuto();
      root.classList.add("is-flipped");
      setItemHeight(index, backH, true);
      root.setAttribute("aria-label", card.word + "：" + card.ja + "。タップで戻す");
      front.setAttribute("aria-hidden", "true");
      back.setAttribute("aria-hidden", "false");
      window.scrollBy({
        top: frontH + gapH,
        left: 0,
        behavior: "smooth",
      });
      autoTimer = setTimeout(function () {
        showFront(true);
      }, AUTO_BACK_MS);
    }

    function toggleFlip() {
      if (root.classList.contains("is-flipped")) showFront(true);
      else showBack();
    }

    function onStatusTap() {
      if (current === STATUS_REVIEW) applyStatus(STATUS_LEARNED);
      else applyStatus(STATUS_REVIEW);
    }

    root.addEventListener("click", function (ev) {
      if (statusCol.contains(ev.target)) return;
      toggleFlip();
    });

    root.addEventListener("keydown", function (ev) {
      if (ev.target === markBtn) return;
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggleFlip();
      }
    });

    statusCol.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });

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
      clearAuto();
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

  function onScrollOrResize() {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = 0;
      paintVirtual(false);
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
    var pct = total > 0 ? Math.round((on / total) * 1000) / 10 : 0;
    btn.style.setProperty("--progress", pct + "%");
  }

  function updateStatusCount() {
    var stats = countLevelStats();
    setStatus(
      activeLevel +
        " · " +
        catLabel(activeCat) +
        " · " +
        currentFilterLabel() +
        " " +
        viewCards.length +
        " / 全" +
        stats.total +
        "（学習済 " +
        stats.on +
        "）"
    );
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
      btn.className = "level-tab" + (level === activeLevel ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", level === activeLevel ? "true" : "false");
      btn.dataset.level = level;
      fillTabButton(btn, level, stats.on, stats.total);
      btn.addEventListener("click", function (ev) {
        var next = ev.currentTarget.dataset.level;
        if (!next || next === activeLevel) return;
        activeLevel = next;
        renderTabs();
        renderCats();
        renderList(true);
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
