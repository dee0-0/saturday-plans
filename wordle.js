/*
 * Wordle for two: the same five-letter word for both of us each day, six tries
 * each. The Worker scores every guess and keeps the word to itself until you're
 * done; meanwhile you only see the colours of the other one's guesses, live in a
 * mini grid next to their name. Once both of us finished, fewer tries wins.
 * The list of allowed words (wordle-words.js) loads when the page first opens.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="wordle"]');
  if (!section) return;

  const ledeEl = $("#wordle-lede");
  const statusEl = $("#wordle-status");
  const gameEl = $("#wordle-game");
  const duelEl = $("#wordle-duel");
  const boardEl = $("#wordle-board");
  const toastEl = $("#wordle-toast");
  const liveEl = $("#wordle-live");
  const keyboardEl = $("#wordle-keyboard");
  const errorEl = $("#wordle-error");
  const resultEl = $("#wordle-result");
  const statsEl = $("#wordle-stats");

  const POLL_MS = 12000;
  const LENGTH = 5;
  const MAX_TRIES = 6;
  const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];
  const FLIP_STEP = 260;   // ms between the tiles of a row turning over
  const FLIP_MS = 520;     // one tile's turn
  const MARK_WORDS = { g: "right spot", y: "in the word", b: "not in the word" };
  const PRAISE = ["Genius!", "Magnificent!", "Impressive!", "Splendid!", "Great!", "Phew!"];
  // The same cache-busting version as this script, for the word list.
  const VERSION = (document.currentScript?.src.match(/[?&]v=([^&#]+)/) || [])[1] || "";

  let state = null;        // the Worker's view of today (GET / POST /games/wordle)
  let typed = "";          // letters of the guess being typed
  let busy = false;        // a guess is on its way
  let revealing = false;   // a row is turning over
  let shownKeys = {};      // keyboard colours, updated once a reveal finished
  let loadSeq = 0;         // bumps per request, so an older answer can't overwrite a newer one
  let identitySeq = 0;
  let pollTimer = null;
  let toastTimer = null;
  let shakeTimer = null;
  let clockTimer = null;
  let words = null;        // Set of allowed guesses once wordle-words.js is in
  let wordsPromise = null;
  let scrolledDay = "";    // the day the keyboard was last scrolled into view for
  let resultDrawn = "";
  let statsDrawn = "";
  let duelDrawn = "";

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
  const games = () => window.DateGames;

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // The bell on the other phone (activity.js); never let it break the page.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  function reward(amount, label) {
    try { if (amount > 0) games()?.reward?.(amount, label); } catch { /* The hub is optional here. */ }
  }

  function refreshHub() {
    try { games()?.refresh?.(); } catch { /* Optional. */ }
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  /* ------------------------------ Word list ------------------------------ */
  // Loaded once, on demand. Without it the Worker still checks the shape of a guess.
  function loadWords() {
    if (words) return Promise.resolve(words);
    if (wordsPromise) return wordsPromise;
    wordsPromise = new Promise((resolve) => {
      if (Array.isArray(window.WORDLE_WORDS)) {
        resolve(window.WORDLE_WORDS);
        return;
      }
      const script = document.createElement("script");
      script.src = `wordle-words.js${VERSION ? `?v=${encodeURIComponent(VERSION)}` : ""}`;
      script.async = true;
      script.onload = () => resolve(window.WORDLE_WORDS);
      script.onerror = () => {
        script.remove();
        resolve(null);
      };
      document.head.append(script);
    }).then((list) => {
      if (Array.isArray(list) && list.length) words = new Set(list);
      else wordsPromise = null; // try again next time
      return words;
    });
    return wordsPromise;
  }

  // Waits a moment for the list on a slow connection, then lets the Worker decide.
  function wordsWithin(ms) {
    return Promise.race([loadWords(), new Promise((resolve) => window.setTimeout(() => resolve(words), ms))]);
  }

  /* ------------------------------- Build --------------------------------- */
  const rowEls = [];
  const keyEls = {};

  function buildBoard() {
    boardEl.innerHTML = Array.from({ length: MAX_TRIES }, () =>
      `<div class="wordle-row" role="img">${'<span class="wordle-tile" data-state="empty" aria-hidden="true"></span>'.repeat(LENGTH)}</div>`
    ).join("");
    rowEls.push(...boardEl.children);
  }

  function buildKeyboard() {
    const key = (letter) => `<button class="wordle-key" type="button" data-key="${letter}" aria-label="${letter.toUpperCase()}">${letter.toUpperCase()}</button>`;
    keyboardEl.innerHTML = [
      `<div class="wordle-keys">${[...KEY_ROWS[0]].map(key).join("")}</div>`,
      `<div class="wordle-keys is-middle">${[...KEY_ROWS[1]].map(key).join("")}</div>`,
      `<div class="wordle-keys">
        <button class="wordle-key is-wide" type="button" data-key="enter" aria-label="Enter">Enter</button>
        ${[...KEY_ROWS[2]].map(key).join("")}
        <button class="wordle-key is-wide" type="button" data-key="back" aria-label="Delete letter"><i class="icon" data-lucide="delete" aria-hidden="true"></i></button>
      </div>`
    ].join("");
    keyboardEl.querySelectorAll("[data-key]").forEach((button) => { keyEls[button.dataset.key] = button; });
    icons(keyboardEl);
  }

  /* ------------------------------- Render -------------------------------- */
  function rowLabel(index, guess, current) {
    const prefix = `Guess ${index + 1} of ${MAX_TRIES}`;
    if (guess) {
      const parts = [...guess.word].map((letter, i) => `${letter.toUpperCase()} ${MARK_WORDS[guess.marks[i]]}`);
      return `${prefix}: ${guess.word.toUpperCase()}. ${parts.join(", ")}`;
    }
    if (current && typed) return `${prefix}: ${typed.toUpperCase()}`;
    return `${prefix}: empty`;
  }

  function paintBoard() {
    const guesses = state?.mine?.guesses || [];
    const playing = state && !state.mine.done;
    rowEls.forEach((row, index) => {
      const guess = guesses[index];
      const current = playing && index === guesses.length;
      const letters = guess ? guess.word : current ? typed : "";
      [...row.children].forEach((tile, i) => {
        const letter = letters[i] || "";
        tile.textContent = letter.toUpperCase();
        tile.dataset.state = guess ? guess.marks[i] : letter ? "filled" : "empty";
      });
      row.classList.toggle("is-current", Boolean(current));
      // Once I'm done, the empty rows fold away so the result sits right under my guesses.
      const unused = Boolean(state?.mine?.done && !revealing && !guess);
      row.classList.toggle("is-unused", unused);
      if (unused) row.removeAttribute("aria-label");
      else row.setAttribute("aria-label", rowLabel(index, guess, current));
    });
  }

  function paintKeyboard() {
    Object.entries(keyEls).forEach(([letter, button]) => {
      const mark = shownKeys[letter] || "";
      if (button.dataset.mark !== mark) {
        if (mark) button.dataset.mark = mark;
        else delete button.dataset.mark;
      }
      if (letter.length === 1) button.setAttribute("aria-label", mark ? `${letter.toUpperCase()}, ${MARK_WORDS[mark]}` : letter.toUpperCase());
    });
    keyboardEl.classList.toggle("is-busy", busy);
  }

  // The other one's colours, row by row (letters only once I'm done).
  function miniGridHtml(marks) {
    return Array.from({ length: MAX_TRIES }, (_, row) => {
      const line = marks[row] || "";
      return `<span class="wordle-mini-row">${Array.from({ length: LENGTH }, (_, i) =>
        `<i class="wordle-mini-cell" data-mark="${escape(line[i] || "")}"></i>`).join("")}</span>`;
    }).join("");
  }

  function theirLine(theirs) {
    if (theirs.done) return theirs.solved ? `Solved in ${theirs.tries}` : "Didn’t get it";
    if (!theirs.marks.length) return "Hasn’t played yet";
    return `Playing · ${theirs.marks.length} of ${MAX_TRIES} tries`;
  }

  function paintDuel() {
    const theirs = state.theirs;
    const mineLine = state.mine.done
      ? (state.mine.solved ? `You: solved in ${state.mine.tries}` : "You: didn’t get it")
      : `You: ${state.mine.guesses.length} of ${MAX_TRIES}`;
    const html = `<span class="wordle-mini" aria-hidden="true">${miniGridHtml(theirs.marks)}</span>
      <span class="wordle-duel-copy">
        <strong>${escape(nameOf(other()))}</strong>
        <small>${escape(theirLine(theirs))}</small>
      </span>
      <span class="wordle-duel-me">${escape(mineLine)}</span>`;
    if (html === duelDrawn) return;
    duelEl.innerHTML = html;
    duelDrawn = html;
  }

  function untilNextWord() {
    try {
      const [year, month, day] = state.day.split("-").map(Number);
      const next = app().dateInTimeZone(year, month, day + 1, 0, 0);
      const minutes = Math.max(1, Math.ceil((next.getTime() - Date.now()) / 60000));
      const hours = Math.floor(minutes / 60);
      return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
    } catch {
      return "";
    }
  }

  // The duel line under my result: waiting for the other one, or who won.
  function verdict() {
    const them = nameOf(other());
    if (!state.result) {
      const playing = state.theirs.marks.length;
      const so = playing ? ` (${plural(playing, "try")} so far)` : "";
      const text = state.mine.solved ? `Waiting for ${them}${so}. Fewer tries wins.` : `Waiting for ${them} to finish${so}.`;
      return { icon: "hourglass", tone: "is-waiting", text };
    }
    const winner = state.result.winner;
    if (winner === me()) return { icon: "crown", tone: "is-win", text: "You won today! +2 hearts" };
    if (winner === other()) {
      const how = state.theirs.solved ? ` in ${state.theirs.tries}` : "";
      return { icon: "trophy", tone: "", text: `${them} won today${how}. Rematch tomorrow!` };
    }
    if (winner === "tie") return { icon: "handshake", tone: "is-win", text: "It’s a tie! +1 heart each" };
    return { icon: "sunrise", tone: "", text: "Neither of us got it. New word tomorrow!" };
  }

  function verdictHtml() {
    const { icon, tone, text } = verdict();
    return `<p class="wordle-verdict ${tone}"><i class="icon" data-lucide="${icon}" aria-hidden="true"></i><span>${escape(text)}</span></p>`;
  }

  // Screen readers hear results once, not every time the card redraws.
  function announce(text) {
    liveEl.textContent = "";
    window.setTimeout(() => { liveEl.textContent = text; }, 60);
  }

  // Their guesses with letters: the Worker only sends them once I'm done.
  function theirBoardHtml() {
    const list = Array.isArray(state.theirs.words) ? state.theirs.words : [];
    if (!list.length) return "";
    const rows = list.map((word, row) => {
      const marks = state.theirs.marks[row] || "";
      return `<span class="wordle-their-row">${[...word].map((letter, i) =>
        `<span class="wordle-their-tile" data-mark="${escape(marks[i] || "")}">${escape(letter.toUpperCase())}</span>`).join("")}</span>`;
    }).join("");
    return `<div class="wordle-theirs">
        <p class="wordle-label">${escape(nameOf(other()))}’s guesses</p>
        <div class="wordle-their-board" role="img" aria-label="${escape(`${nameOf(other())} guessed ${list.map((word) => word.toUpperCase()).join(", ")}`)}">${rows}</div>
      </div>`;
  }

  function paintResult() {
    const done = state.mine.done && !revealing;
    resultEl.hidden = !done;
    if (!done) {
      resultDrawn = "";
      return;
    }
    const word = escape(String(state.answer || "").toUpperCase());
    const solved = state.mine.solved;
    const title = solved ? `Solved in ${state.mine.tries}!` : "So close!";
    const sub = solved ? PRAISE[state.mine.tries - 1] || "Nice one!" : `The word was <strong>${word}</strong>`;
    const next = untilNextWord();
    const html = `<div class="wordle-result-card${solved ? " is-solved" : ""}">
        <span class="wordle-result-icon" aria-hidden="true"><i class="icon" data-lucide="${solved ? "party-popper" : "sunrise"}"></i></span>
        <p class="wordle-result-title">${escape(title)}</p>
        <p class="wordle-result-sub">${sub}</p>
        ${verdictHtml()}
        ${theirBoardHtml()}
        ${next ? `<p class="wordle-next"><i class="icon" data-lucide="clock" aria-hidden="true"></i><span>New word in ${escape(next)}</span></p>` : ""}
      </div>`;
    if (html === resultDrawn) return;
    resultEl.innerHTML = html;
    resultDrawn = html;
    icons(resultEl);
  }

  function paintStats() {
    const mine = state.stats?.[me()];
    const theirs = state.stats?.[other()];
    const show = Boolean(state.mine.done && !revealing && mine);
    statsEl.hidden = !show;
    if (!show) {
      statsDrawn = "";
      return;
    }
    const most = Math.max(1, ...mine.dist);
    const today = state.mine.solved ? state.mine.tries : 0;
    const bars = mine.dist.map((count, index) => {
      const width = Math.max(8, Math.round((count / most) * 100));
      return `<li class="wordle-bar${index + 1 === today ? " is-today" : ""}">
          <span class="wordle-bar-label">${index + 1}</span>
          <span class="wordle-bar-track"><span class="wordle-bar-fill" style="width:${width}%">${count}</span></span>
        </li>`;
    }).join("");
    const ties = mine.ties ? ` · ${plural(mine.ties, "tie")}` : "";
    const html = `<p class="wordle-label">Your stats</p>
      <dl class="wordle-numbers">
        <div><dt>Played</dt><dd>${mine.played}</dd></div>
        <div><dt>Win %</dt><dd>${mine.winRate}</dd></div>
        <div><dt>Streak</dt><dd>${mine.streak}</dd></div>
        <div><dt>Best</dt><dd>${mine.maxStreak}</dd></div>
      </dl>
      <p class="wordle-duels"><i class="icon" data-lucide="crown" aria-hidden="true"></i><span>Days won: You ${mine.wins} · ${escape(nameOf(other()))} ${theirs?.wins ?? 0}${escape(ties)}</span></p>
      <p class="wordle-label">Guess distribution</p>
      <ol class="wordle-dist" aria-label="How many tries your solved words took">${bars}</ol>`;
    if (html === statsDrawn) return;
    statsEl.innerHTML = html;
    statsDrawn = html;
    icons(statsEl);
  }

  function paintLede() {
    const text = `The same word for both of us. Solve it for a heart, beat ${nameOf(other())} for two more.`;
    if (ledeEl.textContent !== text) ledeEl.textContent = text;
  }

  function render() {
    if (!state) return;
    statusEl.hidden = true;
    gameEl.hidden = false;
    paintLede();
    paintBoard();
    paintDuel();
    keyboardEl.hidden = state.mine.done && !revealing;
    paintKeyboard();
    paintResult();
    paintStats();
  }

  // On short screens the keyboard starts below the fold: each time the page opens, scroll so
  // the keys are on screen (keeping the other one's progress in view when there's room).
  function revealKeyboard() {
    if (!state || state.mine.done || scrolledDay === state.day || app()?.step !== "wordle") return;
    scrolledDay = state.day;
    window.setTimeout(() => {
      const keys = keyboardEl.getBoundingClientRect();
      const top = duelEl.getBoundingClientRect().top - 8;
      const overflow = keys.bottom + 12 - window.innerHeight;
      if (overflow <= 0 || keyboardEl.hidden) return;
      window.scrollBy({ top: top > 0 ? Math.min(overflow, top) : overflow, behavior: reduced() ? "auto" : "smooth" });
    }, 420);
  }

  /* ------------------------------ Feedback ------------------------------- */
  function toast(message) {
    window.clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.classList.remove("is-in");
    void toastEl.offsetWidth;
    toastEl.classList.add("is-in");
    toastTimer = window.setTimeout(() => { toastEl.hidden = true; }, 1800);
  }

  function shake() {
    const row = rowEls[state?.mine?.guesses?.length ?? 0];
    if (!row) return;
    window.clearTimeout(shakeTimer);
    row.classList.remove("is-shake");
    void row.offsetWidth;
    row.classList.add("is-shake");
    shakeTimer = window.setTimeout(() => row.classList.remove("is-shake"), 650);
  }

  function popTile(index) {
    const tile = rowEls[state.mine.guesses.length]?.children[index];
    if (!tile) return;
    tile.classList.remove("is-pop");
    void tile.offsetWidth;
    tile.classList.add("is-pop");
  }

  // Turns the newest row over tile by tile, then colours the keyboard and shows the result.
  function revealRow(index, done) {
    const row = rowEls[index];
    const total = reduced() ? 0 : FLIP_STEP * (LENGTH - 1) + FLIP_MS;
    if (!row || !total) {
      done();
      return;
    }
    revealing = true;
    [...row.children].forEach((tile, i) => {
      tile.style.setProperty("--i", String(i));
      tile.classList.add("is-flip");
    });
    window.setTimeout(() => {
      [...row.children].forEach((tile) => tile.classList.remove("is-flip"));
      revealing = false;
      done();
    }, total + 40);
  }

  function celebrate(index) {
    const row = rowEls[index];
    if (!row) return;
    if (!reduced()) {
      [...row.children].forEach((tile, i) => tile.style.setProperty("--i", String(i)));
      row.classList.add("is-win");
      window.setTimeout(() => row.classList.remove("is-win"), 1300);
    }
    window.LetterFX?.burstFrom?.(row, 24);
    window.LetterFX?.chime?.();
  }

  /* ------------------------------- Sync ---------------------------------- */
  const wordlePath = () => `/games/wordle?author=${encodeURIComponent(me())}`;

  function applyState(data) {
    const dayChanged = state && data.day !== state.day;
    const before = state;
    state = data;
    if (!before || dayChanged) {
      typed = "";
      resultDrawn = "";
      statsDrawn = "";
    }
    if (!revealing) shownKeys = { ...(data.keyboard || {}) };
    return { before, dayChanged };
  }

  async function load({ quiet = false } = {}) {
    if (busy || revealing) return;
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!state && !quiet) {
      gameEl.hidden = true;
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s word…";
    }
    try {
      const data = await app().apiRequest(wordlePath());
      if (seq !== loadSeq || identity !== identitySeq || busy || revealing) return;
      const { before, dayChanged } = applyState(data);
      if (!quiet) showError("");
      // The other one just finished while I was watching and settled the day.
      if (before && !dayChanged && !before.result && data.result && data.mine.done) {
        const winner = data.result.winner;
        if (winner === me()) reward(2, "You won today");
        else if (winner === "tie") reward(1, "It’s a tie");
        if (winner === me() || winner === "tie") window.LetterFX?.chime?.();
        refreshHub();
        render();
        announce(verdict().text);
      }
      render();
      revealKeyboard();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq) return;
      if (state) {
        if (!quiet) showError(error.status ? error.message : "Couldn’t refresh. Check your connection and try again.");
        return;
      }
      gameEl.hidden = true;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404
        ? "Wordle needs the latest server update first."
        : "Couldn’t load today’s word. Check your connection and try again.";
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "wordle") return;
      load({ quiet: true });
    }, POLL_MS);
    // Keeps "New word in …" honest while the result is open.
    clockTimer = window.setInterval(() => {
      if (!document.hidden && app()?.step === "wordle" && state?.mine?.done) paintResult();
    }, 30000);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    window.clearInterval(clockTimer);
    pollTimer = null;
    clockTimer = null;
  }

  /* ------------------------------ Actions -------------------------------- */
  function press(key) {
    if (!state || state.mine.done || busy || revealing) return;
    if (key === "enter") {
      submit();
      return;
    }
    if (key === "back") {
      if (!typed) return;
      typed = typed.slice(0, -1);
    } else if (/^[a-z]$/.test(key)) {
      if (typed.length >= LENGTH) return;
      typed += key;
    } else {
      return;
    }
    toastEl.hidden = true;
    paintBoard();
    paintKeyboard();
    if (key !== "back") popTile(typed.length - 1);
  }

  async function submit() {
    if (!state || state.mine.done || busy || revealing) return;
    const word = typed;
    if (word.length < LENGTH) {
      toast("Not enough letters");
      shake();
      return;
    }
    if (state.mine.guesses.some((guess) => guess.word === word)) {
      toast("You already tried that word");
      shake();
      return;
    }
    busy = true;
    paintKeyboard();
    const list = await wordsWithin(2500);
    if (list && !list.has(word)) {
      busy = false;
      paintKeyboard();
      toast("Not in the word list");
      shake();
      return;
    }
    const identity = identitySeq;
    const before = state;
    const row = before.mine.guesses.length;
    loadSeq += 1;
    rowEls[row]?.classList.add("is-pending");
    showError("");
    try {
      const data = await app().apiRequest("/games/wordle", "POST", { author: me(), word, day: before.day });
      if (identity !== identitySeq) return;
      busy = false;
      rowEls[row]?.classList.remove("is-pending");
      if (data.day !== before.day) {
        applyState(data);
        render();
        return;
      }
      revealing = true; // keep the keyboard colours until the row has turned over
      state = data;
      typed = "";
      paintBoard();
      paintDuel();
      paintKeyboard();
      const won = data.result?.winner === me();
      reward(data.awarded, won ? "You won today" : data.mine.solved ? "Solved!" : "");
      refreshHub();
      const newest = data.mine.guesses[data.mine.guesses.length - 1];
      revealRow(row, () => {
        revealing = false;
        shownKeys = { ...(data.keyboard || {}) };
        render();
        const said = newest ? `${rowLabel(row, newest, false)}.` : "";
        if (!data.mine.done) {
          announce(said);
          return;
        }
        const outcome = data.mine.solved ? `Solved in ${data.mine.tries}!` : `The word was ${String(data.answer || "").toUpperCase()}.`;
        announce(`${said} ${outcome} ${verdict().text}`);
        finished(before, data, row);
      });
    } catch (error) {
      if (identity !== identitySeq) return;
      busy = false;
      revealing = false;
      rowEls[row]?.classList.remove("is-pending");
      paintKeyboard();
      if (error.status === 400) {
        toast(error.message);
        shake();
      } else if (error.status === 409) {
        toast(error.message);
        typed = "";
        load();
      } else {
        showError(error.status ? error.message : "Couldn’t send your guess. Check your connection and try again.");
      }
    }
  }

  function finished(before, data, row) {
    if (before.mine.done) return;
    const solved = data.mine.solved;
    if (solved) celebrate(row);
    let detail = "";
    const winner = data.result?.winner;
    if (data.result) {
      if (winner === me()) detail = "I won";
      else if (winner === other()) detail = "You won";
      else if (winner === "tie") detail = "It’s a tie";
      else detail = "Neither of us got it";
    }
    postActivity({
      kind: solved ? "wordle.solved" : "wordle.missed",
      text: solved ? `solved today’s word in ${data.mine.tries}` : "didn’t get today’s word",
      detail,
      step: "wordle",
      icon: "grid-3x3",
      push: true
    });
    const card = resultEl.querySelector(".wordle-result-card");
    if (card) card.classList.add("is-new");
    window.setTimeout(() => {
      resultEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    }, reduced() ? 0 : 500);
  }

  /* ------------------------------- Wiring -------------------------------- */
  buildBoard();
  buildKeyboard();

  keyboardEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-key]");
    if (button && !button.disabled) press(button.dataset.key);
  });
  // A mouse click shouldn't leave focus (and a focus ring) on the key.
  keyboardEl.addEventListener("mousedown", (event) => {
    if (event.target.closest("[data-key]")) event.preventDefault();
  });

  // A physical keyboard works too, unless you're typing somewhere else or a panel is open.
  document.addEventListener("keydown", (event) => {
    if (app()?.step !== "wordle" || !state || state.mine.done) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='dialog']")) return;
    const layer = $("#activity-layer");
    if (layer && !layer.hidden) return;
    if (event.key === "Enter") {
      // Enter on another button (like "Games") keeps doing what that button does.
      if (target?.closest("button, a, summary") && !keyboardEl.contains(target)) return;
      event.preventDefault();
      if (!event.repeat) press("enter");
    } else if (event.key === "Backspace") {
      event.preventDefault();
      press("back");
    } else if (/^[a-z]$/i.test(event.key)) {
      event.preventDefault();
      press(event.key.toLowerCase());
    }
  });

  function resetIdentity() {
    identitySeq += 1;
    loadSeq += 1;
    state = null;
    typed = "";
    busy = false;
    revealing = false;
    shownKeys = {};
    scrolledDay = "";
    resultDrawn = "";
    statsDrawn = "";
    duelDrawn = "";
    showError("");
    gameEl.hidden = true;
    if (app()?.step === "wordle") load();
  }
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });

  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "wordle") {
      loadWords();
      scrolledDay = "";
      if (state) {
        render();
        revealKeyboard();
      }
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "wordle") load({ quiet: true });
  });
})();
