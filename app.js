(function () {
  "use strict";

  var CSV_URL = "data/cards.csv";
  var AUTO_BACK_MS = 3000;
  var LEVELS = ["A1", "A2", "B1", "B2"];

  var listEl = document.getElementById("card-list");
  var tabsEl = document.getElementById("level-tabs");
  var statusEl = document.getElementById("status");

  var allCards = [];
  var activeLevel = "A1";

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

  function createFace(side, card) {
    var face = document.createElement("div");
    face.className = "face face-" + side;
    face.setAttribute("aria-hidden", side === "back" ? "true" : "false");

    var text = document.createElement("div");
    text.className = side === "front" ? "word" : "ja";
    text.textContent = side === "front" ? card.word : card.ja;
    face.appendChild(text);
    return face;
  }

  function createCard(card, index) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card";
    btn.dataset.index = String(index);
    btn.setAttribute("aria-label", card.word + "。タップで訳を見る");

    var inner = document.createElement("div");
    inner.className = "card-inner";
    inner.appendChild(createFace("front", card));
    inner.appendChild(createFace("back", card));
    btn.appendChild(inner);

    var autoTimer = null;

    function clearAuto() {
      if (autoTimer !== null) {
        clearTimeout(autoTimer);
        autoTimer = null;
      }
    }

    function showFront() {
      clearAuto();
      btn.classList.remove("is-flipped");
      btn.setAttribute("aria-label", card.word + "。タップで訳を見る");
      var faces = btn.querySelectorAll(".face");
      if (faces[0]) faces[0].setAttribute("aria-hidden", "false");
      if (faces[1]) faces[1].setAttribute("aria-hidden", "true");
    }

    function showBack() {
      clearAuto();
      btn.classList.add("is-flipped");
      btn.setAttribute("aria-label", card.word + "：" + card.ja + "。タップで戻す");
      var faces = btn.querySelectorAll(".face");
      if (faces[0]) faces[0].setAttribute("aria-hidden", "true");
      if (faces[1]) faces[1].setAttribute("aria-hidden", "false");
      autoTimer = setTimeout(showFront, AUTO_BACK_MS);
    }

    btn.addEventListener("click", function () {
      if (btn.classList.contains("is-flipped")) {
        showFront();
      } else {
        showBack();
      }
    });

    return btn;
  }

  function cardsForLevel(level) {
    var out = [];
    for (var i = 0; i < allCards.length; i++) {
      if (allCards[i].cefr === level) out.push(allCards[i]);
    }
    return out;
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

  function renderList() {
    var cards = cardsForLevel(activeLevel);
    listEl.textContent = "";
    for (var i = 0; i < cards.length; i++) {
      listEl.appendChild(createCard(cards[i], i));
    }
    setStatus(activeLevel + " · " + cards.length + " words");
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
        renderTabs();
        renderList();
      })
      .catch(function (err) {
        setStatus(err.message || "読み込みに失敗しました", true);
      });
  }

  boot();
})();
