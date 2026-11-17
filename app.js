(function () {
  "use strict";

  var CSV_URL = "data/cards_a1.csv";
  var AUTO_BACK_MS = 3000;

  var grid = document.getElementById("card-grid");
  var statusEl = document.getElementById("status");

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
      if (!word || !ja) continue;
      cards.push({
        word: word,
        ja: ja,
        pos: col(cols, "pos"),
        cefr: col(cols, "cefr") || "A1",
      });
    }
    return cards;
  }

  function metaText(card) {
    var parts = [];
    if (card.pos) parts.push(card.pos);
    if (card.cefr) parts.push(card.cefr);
    return parts.join(" · ");
  }

  function createFace(side, card) {
    var face = document.createElement("div");
    face.className = "face face-" + side;
    face.setAttribute("aria-hidden", side === "back" ? "true" : "false");

    var body = document.createElement("div");
    body.className = "face-body";

    if (side === "front") {
      var word = document.createElement("div");
      word.className = "word";
      word.textContent = card.word;
      body.appendChild(word);
    } else {
      var ja = document.createElement("div");
      ja.className = "ja";
      ja.textContent = card.ja;
      body.appendChild(ja);
    }

    var footer = document.createElement("div");
    footer.className = "face-footer";
    footer.textContent = metaText(card);

    face.appendChild(body);
    face.appendChild(footer);
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

  function render(cards) {
    grid.textContent = "";
    for (var i = 0; i < cards.length; i++) {
      grid.appendChild(createCard(cards[i], i));
    }
    setStatus(cards.length + " cards · A1");
  }

  function boot() {
    setStatus("読み込み中…");
    fetch(CSV_URL + "?t=" + Date.now())
      .then(function (res) {
        if (!res.ok) throw new Error("CSV を読めませんでした (" + res.status + ")");
        return res.text();
      })
      .then(function (text) {
        var cards = parseCsv(text);
        if (!cards.length) throw new Error("カードデータが空です");
        render(cards);
      })
      .catch(function (err) {
        setStatus(err.message || "読み込みに失敗しました", true);
      });
  }

  boot();
})();
