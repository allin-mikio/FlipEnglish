(function () {
  "use strict";

  var CSV_URL = "data/cards.csv";
  var AUTO_BACK_MS = 3000;
  var LEVELS = ["A1", "A2", "B1", "B2"];
  var FILTERS = [
    { id: "all", label: "すべて" },
    { id: "off", label: "Offのみ" },
    { id: "on", label: "Onのみ" },
  ];
  var BAND_PAD_Y = 20;
  var STORAGE_KEY = "flipenglish.checked.v1";

  var listEl = document.getElementById("card-list");
  var tabsEl = document.getElementById("level-tabs");
  var filterEl = document.getElementById("filter-tabs");
  var statusEl = document.getElementById("status");

  var allCards = [];
  var activeLevel = "A1";
  var activeFilter = "all";
  var checkedMap = loadCheckedMap();

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

  function loadCheckedMap() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  function saveCheckedMap() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(checkedMap));
    } catch (err) {
      /* ignore quota / private mode */
    }
  }

  function isChecked(card) {
    return !!checkedMap[cardKey(card)];
  }

  function setCheckedState(card, checked) {
    var key = cardKey(card);
    if (checked) checkedMap[key] = 1;
    else delete checkedMap[key];
    saveCheckedMap();
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
      if (!word || !ja) continue;
      cards.push({ word: word, ja: ja, cefr: cefr });
    }
    return cards;
  }

  function measureJaHeight(text, widthPx) {
    var probe = document.createElement("div");
    probe.className = "ja";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.left = "-9999px";
    probe.style.top = "0";
    probe.style.width = widthPx + "px";
    probe.textContent = text;
    document.body.appendChild(probe);
    var h = probe.scrollHeight;
    document.body.removeChild(probe);
    return h;
  }

  function baseBandHeight() {
    var raw = getComputedStyle(document.documentElement).getPropertyValue("--band-h");
    var n = parseFloat(raw);
    return isFinite(n) && n > 0 ? n : 56;
  }

  function matchesFilter(card) {
    var on = isChecked(card);
    if (activeFilter === "off") return !on;
    if (activeFilter === "on") return on;
    return true;
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

  function createCard(card) {
    var root = document.createElement("div");
    root.className = "card" + (isChecked(card) ? " is-checked" : "");
    root.dataset.index = String(card.index || "");
    root.setAttribute("role", "button");
    root.tabIndex = 0;
    root.setAttribute("aria-label", card.word + "。タップで訳を見る");

    var inner = document.createElement("div");
    inner.className = "card-inner";

    var front = document.createElement("div");
    front.className = "face face-front";
    front.setAttribute("aria-hidden", "false");

    var word = document.createElement("div");
    word.className = "word";
    word.textContent = card.word;

    var checkCol = document.createElement("div");
    checkCol.className = "check-col";

    var checkWrap = document.createElement("label");
    checkWrap.className = "check-wrap";
    checkWrap.title = "チェック";

    var checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = isChecked(card);
    checkbox.setAttribute("aria-label", card.word + " をチェック");
    checkWrap.appendChild(checkbox);

    var indexEl = document.createElement("span");
    indexEl.className = "card-index";
    indexEl.textContent = String(card.index || "");

    checkCol.appendChild(checkWrap);
    checkCol.appendChild(indexEl);

    front.appendChild(word);
    front.appendChild(checkCol);

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
    var frontH = baseBandHeight();
    var backH = frontH;

    function clearAuto() {
      if (autoTimer !== null) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
    }

    function applyChecked(checked) {
      setCheckedState(card, checked);
      checkbox.checked = checked;
      root.classList.toggle("is-checked", checked);
      if (!matchesFilter(card)) {
        root.remove();
        updateStatusCount();
      } else {
        updateStatusCount();
      }
    }

    function fitHeights() {
      frontH = baseBandHeight();
      var textWidth = Math.max(0, root.clientWidth - 28);
      var jaH = measureJaHeight(card.ja, textWidth || root.clientWidth);
      backH = Math.max(frontH, jaH + BAND_PAD_Y);
      if (!root.classList.contains("is-flipped")) {
        root.style.height = frontH + "px";
      } else {
        root.style.height = backH + "px";
      }
    }

    function showFront(fromBack) {
      clearAuto();
      root.classList.remove("is-flipped");
      root.style.height = frontH + "px";
      root.setAttribute("aria-label", card.word + "。タップで訳を見る");
      front.setAttribute("aria-hidden", "false");
      back.setAttribute("aria-hidden", "true");
      if (fromBack) applyChecked(true);
    }

    function showBack() {
      clearAuto();
      root.classList.add("is-flipped");
      root.style.height = backH + "px";
      root.setAttribute("aria-label", card.word + "：" + card.ja + "。タップで戻す");
      front.setAttribute("aria-hidden", "true");
      back.setAttribute("aria-hidden", "false");
      autoTimer = setTimeout(function () {
        showFront(true);
      }, AUTO_BACK_MS);
    }

    function toggleFlip() {
      if (root.classList.contains("is-flipped")) showFront(true);
      else showBack();
    }

    root.addEventListener("click", function (ev) {
      if (ev.target === checkbox || checkCol.contains(ev.target)) return;
      toggleFlip();
    });

    root.addEventListener("keydown", function (ev) {
      if (ev.target === checkbox) return;
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        toggleFlip();
      }
    });

    checkCol.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });

    checkbox.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });

    checkbox.addEventListener("change", function (ev) {
      ev.stopPropagation();
      applyChecked(checkbox.checked);
    });

    root._fitHeights = fitHeights;
    return root;
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

  function countLevelStats() {
    var total = 0;
    var on = 0;
    for (var i = 0; i < allCards.length; i++) {
      if (allCards[i].cefr !== activeLevel) continue;
      total++;
      if (isChecked(allCards[i])) on++;
    }
    return { total: total, on: on, off: total - on };
  }

  function updateStatusCount() {
    var stats = countLevelStats();
    var shown = listEl.querySelectorAll(".card").length;
    var filterLabel =
      activeFilter === "off" ? "Offのみ" : activeFilter === "on" ? "Onのみ" : "すべて";
    setStatus(
      activeLevel +
        " · " +
        filterLabel +
        " " +
        shown +
        " / 全" +
        stats.total +
        "（On " +
        stats.on +
        "）"
    );
  }

  function renderTabs() {
    tabsEl.textContent = "";
    for (var i = 0; i < LEVELS.length; i++) {
      var level = LEVELS[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-tab" + (level === activeLevel ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", level === activeLevel ? "true" : "false");
      btn.dataset.level = level;
      btn.textContent = level;
      btn.addEventListener("click", function (ev) {
        var next = ev.currentTarget.dataset.level;
        if (!next || next === activeLevel) return;
        activeLevel = next;
        renderTabs();
        renderList();
        window.scrollTo(0, 0);
      });
      tabsEl.appendChild(btn);
    }
  }

  function renderFilters() {
    filterEl.textContent = "";
    for (var i = 0; i < FILTERS.length; i++) {
      var item = FILTERS[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "filter-tab" + (item.id === activeFilter ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", item.id === activeFilter ? "true" : "false");
      btn.dataset.filter = item.id;
      btn.textContent = item.label;
      btn.addEventListener("click", function (ev) {
        var next = ev.currentTarget.dataset.filter;
        if (!next || next === activeFilter) return;
        activeFilter = next;
        renderFilters();
        renderList();
        window.scrollTo(0, 0);
      });
      filterEl.appendChild(btn);
    }
  }

  function renderList() {
    var cards = cardsForView();
    listEl.textContent = "";
    for (var i = 0; i < cards.length; i++) {
      listEl.appendChild(createCard(cards[i]));
    }
    updateStatusCount();
    requestAnimationFrame(function () {
      var nodes = listEl.querySelectorAll(".card");
      for (var i = 0; i < nodes.length; i++) {
        if (typeof nodes[i]._fitHeights === "function") nodes[i]._fitHeights();
      }
    });
  }

  function boot() {
    setStatus("読み込み中…");
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
        renderFilters();
        renderList();
      })
      .catch(function (err) {
        setStatus(err.message || "読み込みに失敗しました", true);
      });
  }

  boot();
})();
