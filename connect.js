/*
 * Connections for two: 16 words, 4 hidden groups of 4 (yellow = easy … purple = tricky).
 * Tap Start (the Worker notes the time and only then sends the words), pick four that
 * belong together and submit. Every guess goes to the Worker, which says right, one away
 * or wrong; four mistakes end the round. More groups wins, then fewer mistakes, then the
 * faster one. Looks from match.css + quick.css + puzzles.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="connect"]');
  if (!section) return;

  const ledeEl = $("#connect-lede");
  const statusEl = $("#connect-status");
  const introEl = $("#connect-intro");
  const startButton = $("#connect-start");
  const playEl = $("#connect-play");
  const clockEl = $("#connect-clock");
  const mistakesEl = $("#connect-mistakes");
  const foundEl = $("#connect-found");
  const gridEl = $("#connect-grid");
  const toastEl = $("#connect-toast");
  const shuffleButton = $("#connect-shuffle");
  const clearButton = $("#connect-clear");
  const submitButton = $("#connect-submit");
  const resultEl = $("#connect-result");
  const errorEl = $("#connect-error");
  const retryButton = $("#connect-retry");
  const statsEl = $("#connect-stats");

  const POLL_MS = 12000;
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview") ? "date-letter-connect-draft-preview" : "date-letter-connect-draft";
  const PICK = 4;

  let data = null;
  let layout = [];          // the words on the board, in the order they show
  let selected = [];        // the words I tapped (up to 4)
  let pending = null;       // a guess on its way (sent again by "Try again")
  let playing = false;
  let saving = false;
  let startedAt = 0;
  let frame = 0;
  let toastTimer = 0;
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let drawn = { result: "", stats: "" };

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const iconHtml = (name) => `<i class="icon" data-lucide="${name}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;
  const seconds = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)}\u00a0s`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const fold = (word) => String(word ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const keyOf = (words) => words.map(fold).sort().join("|");
  const level = (value) => Math.min(4, Math.max(1, Number(value) || 1));

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  function saveDraft() {
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ day: data?.day, author: me(), layout, selected })); } catch { /* Optional. */ }
  }

  function readDraft() {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null");
      return draft && draft.day === data?.day && draft.author === me() ? draft : null;
    } catch { return null; }
  }

  function clearDraft() {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional. */ }
  }

  function toast(message, kind = "") {
    window.clearTimeout(toastTimer);
    toastEl.textContent = message;
    toastEl.className = `connect-toast is-shown${kind ? ` is-${kind}` : ""}`;
    toastTimer = window.setTimeout(() => { toastEl.className = "connect-toast"; }, 2200);
  }

  /* ------------------------------- Playing ------------------------------- */
  function tick() {
    if (!playing) return;
    clockEl.textContent = ((performance.now() - startedAt) / 1000).toFixed(1);
    frame = window.requestAnimationFrame(tick);
  }

  const foundWords = () => new Set((data?.found || []).flatMap((group) => group.words));

  function groupHtml(group, extra = "") {
    return `<li class="connect-group is-level-${level(group.level)}${extra}">
        <strong>${escape(group.name)}</strong>
        <span>${group.words.map(escape).join(", ")}</span>
      </li>`;
  }

  function renderMistakes() {
    const max = Number(data?.maxMistakes) || 4;
    const left = Math.max(0, max - (Number(data?.mistakes) || 0));
    mistakesEl.setAttribute("aria-label", `${left} of ${max} mistakes left`);
    mistakesEl.innerHTML = `<span aria-hidden="true">Mistakes left</span><span class="connect-dots" aria-hidden="true">${Array.from({ length: max }, (_, index) => `<i class="${index < left ? "is-on" : ""}"></i>`).join("")}</span>`;
  }

  function renderControls() {
    const busy = saving || !playing;
    gridEl.querySelectorAll(".connect-word").forEach((button) => {
      const on = selected.includes(button.dataset.word);
      button.classList.toggle("is-selected", on);
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.disabled = busy;
    });
    submitButton.disabled = busy || selected.length !== PICK;
    clearButton.disabled = busy || !selected.length;
    shuffleButton.disabled = busy;
    gridEl.classList.toggle("is-saving", saving);
  }

  // Long words shrink until they fit their tile (no word ever breaks in the middle).
  function fitWords() {
    gridEl.querySelectorAll(".connect-word").forEach((button) => {
      button.style.fontSize = "";
      let size = parseFloat(window.getComputedStyle(button).fontSize) || 15;
      while (button.scrollWidth > button.clientWidth + 1 && size > 9) {
        size -= 0.5;
        button.style.fontSize = `${size}px`;
      }
    });
  }

  function renderBoard({ newest = false } = {}) {
    renderMistakes();
    const found = data.found || [];
    foundEl.innerHTML = found.map((group, index) => groupHtml(group, newest && index === found.length - 1 && !reduced() ? " is-new" : "")).join("");
    foundEl.hidden = !found.length;
    const taken = foundWords();
    layout = layout.filter((word) => !taken.has(word));
    selected = selected.filter((word) => layout.includes(word));
    gridEl.innerHTML = layout.map((word) => `<button class="connect-word" type="button" aria-pressed="false" data-word="${escape(word)}"><span>${escape(word)}</span></button>`).join("");
    renderControls();
    fitWords();
  }

  function begin(resumeMs = 0) {
    playing = true;
    startedAt = performance.now() - resumeMs;
    const words = data.words || [];
    const draft = readDraft();
    // The board as I left it (shuffled or not), if this page was reloaded mid-round.
    layout = draft && Array.isArray(draft.layout) && draft.layout.length && draft.layout.every((word) => words.includes(word)) ? [...draft.layout] : [...words];
    for (const word of words) if (!layout.includes(word)) layout.push(word);
    selected = draft && Array.isArray(draft.selected) ? draft.selected.filter((word) => words.includes(word)).slice(0, PICK) : [];
    introEl.hidden = true;
    resultEl.hidden = true;
    ledeEl.hidden = true;
    playEl.hidden = false;
    renderBoard();
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(tick);
    gridEl.querySelector(".connect-word")?.focus({ preventScroll: true });
  }

  async function start() {
    if (!data || saving || playing) return;
    startButton.disabled = true;
    showError("");
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/connect", "POST", { author: me(), day: data.day, action: "start" });
      if (identity !== identitySeq) return;
      data = result;
      begin(Number(result.elapsedMs) || 0);
    } catch (error) {
      startButton.disabled = false;
      showError(error.status ? error.message : "Couldn’t start. Check your connection and try again.");
      if (error.status === 409) load();
    }
  }

  function toggle(word) {
    if (!playing || saving) return;
    if (selected.includes(word)) selected = selected.filter((item) => item !== word);
    else if (selected.length < PICK) selected = [...selected, word];
    else {
      toast("Four at a time. Tap one to unpick it.");
      return;
    }
    saveDraft();
    renderControls();
  }

  function shake(words) {
    if (reduced()) return;
    gridEl.querySelectorAll(".connect-word").forEach((button) => {
      if (!words.includes(button.dataset.word)) return;
      button.classList.remove("is-shake");
      void button.offsetWidth;
      button.classList.add("is-shake");
    });
  }

  async function guess(words = selected) {
    if (!playing || saving || words.length !== PICK) return;
    if ((data.tried || []).some((tried) => keyOf(tried) === keyOf(words))) {
      toast("You already tried those four.");
      shake(words);
      return;
    }
    saving = true;
    pending = [...words];
    showError("");
    retryButton.hidden = true;
    renderControls();
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/connect", "POST", {
        author: me(), day: data.day, action: "guess", words: pending, ms: Math.round(performance.now() - startedAt)
      });
      if (identity !== identitySeq) return;
      saving = false;
      pending = null;
      data = result;
      games()?.reward?.(result.awarded);
      const outcome = result.last?.result;
      if (result.done) {
        finished(result);
        return;
      }
      if (outcome === "right") {
        selected = [];
        saveDraft();
        renderBoard({ newest: true });
        toast(["Nice!", "Yes!", "You got it!"][(result.found.length - 1) % 3], "right");
      } else {
        renderMistakes();
        renderControls();
        shake(words);
        toast(outcome === "oneAway" ? "One away…" : "Not quite.", "wrong");
      }
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      renderControls();
      if (error.status === 409 || error.status === 400) {
        // Already tried, or the round changed elsewhere: show it and catch up.
        pending = null;
        toast(error.message || "Not quite.", "wrong");
        refresh();
        return;
      }
      showError(error.status ? error.message : "Couldn’t send your guess. Check your connection and try again.");
      retryButton.hidden = false;
    }
  }

  // The round is over (all four found, or four mistakes).
  function finished(result) {
    playing = false;
    window.cancelAnimationFrame(frame);
    clearDraft();
    selected = [];
    layout = [];
    render({ reveal: true });
    const res = result.result;
    const mine = result.mine;
    postActivity({
      kind: "connect.played",
      text: res
        ? (res.winner === me() ? "won today’s connections" : res.winner === "tie" ? "played connections: a tie" : "played connections: you won")
        : `found ${mine.solved === 4 ? "all 4" : `${mine.solved} of 4`} groups in connections${mine.mistakes ? `, with ${plural(mine.mistakes, "mistake")}` : ", no mistakes"}`,
      step: "connect",
      icon: "layout-grid",
      push: true
    });
    games()?.refresh?.();
  }

  // Catch up with the Worker while a round is open (after a refused guess).
  async function refresh() {
    const identity = identitySeq;
    try {
      const result = await app().apiRequest(`/games/connect?author=${encodeURIComponent(me())}`);
      if (identity !== identitySeq || saving) return;
      data = result;
      if (result.done) {
        playing = false;
        window.cancelAnimationFrame(frame);
        clearDraft();
        render();
      } else if (playing) {
        renderBoard();
      }
    } catch { /* The next action tries again. */ }
  }

  /* -------------------------------- Result -------------------------------- */
  function patternHtml(round, who) {
    if (!round) return "";
    const rows = (round.pattern || []).map((row) => `<span>${row.map((value) => `<i class="is-level-${level(value)}"></i>`).join("")}</span>`).join("");
    return `<figure class="connect-pattern" aria-label="${escape(who)}: ${plural((round.pattern || []).length, "guess")}, ${round.solved} of 4 groups">
        <figcaption>${escape(who)}</figcaption><div class="connect-pattern-rows" aria-hidden="true">${rows}</div>
      </figure>`;
  }

  // One side of the score: groups, mistakes and time, stacked so it fits a small phone.
  function sideHtml(who, round, win) {
    return `<div class="connect-side${win ? " is-win" : ""}">
        <strong>${who}${win ? iconHtml("crown") : ""}</strong>
        <span>${round.solved} of 4 groups</span>
        <span>${round.mistakes ? plural(round.mistakes, "mistake") : "no mistakes"}</span>
        <span>${seconds(round.ms)}</span>
      </div>`;
  }

  function resultHtml() {
    const them = escape(nameOf(other()));
    const res = data.result;
    const mine = data.mine;
    const foundLevels = new Set((data.found || []).map((group) => group.level));
    const groups = (data.groups || []).map((group) => groupHtml(group, foundLevels.has(group.level) ? "" : " is-missed")).join("");
    let head;
    if (!res) {
      const title = mine.solved === 4 ? "All 4 groups" : `${mine.solved} of 4 groups`;
      head = `<div class="match-waiting"><span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">${escape(title)} in ${seconds(mine.ms)}</p>
          <p class="match-waiting-copy">${mine.mistakes ? `${plural(mine.mistakes, "mistake")}.` : "No mistakes!"} Waiting for ${them} to play. Shh, no spoilers!</p></div></div>`;
    } else {
      const message = res.winner === "tie" ? "A perfect tie!" : res.winner === me() ? "You won today!" : `${them} won today!`;
      head = `<div class="match-score${mine.perfect ? " is-perfect" : ""}">
          <div class="connect-versus">${sideHtml("You", mine, res.winner === me())}${sideHtml(them, data.theirs, res.winner === other())}</div>
          <p class="match-score-msg">${escape(message)}</p></div>`;
    }
    const patterns = `<div class="connect-patterns">${patternHtml(mine, "You")}${patternHtml(data.theirs, nameOf(other()))}</div>`;
    return `${head}<ol class="connect-found is-result">${groups}</ol>${patterns}`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    return `<div class="match-stat"><dt>Wins</dt><dd><strong>${Number(stats.wins?.[me()]) || 0} : ${Number(stats.wins?.[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Perfect</dt><dd><strong>${Number(stats.perfect?.[me()]) || 0} : ${Number(stats.perfect?.[other()]) || 0}</strong><small>all 4, no mistakes</small></dd></div>
      <div class="match-stat"><dt>Played</dt><dd><strong>${Number(stats.daysPlayed) || 0}</strong><small>${Number(stats.daysPlayed) === 1 ? "day" : "days"} together</small></dd></div>`;
  }

  function put(element, key, html) {
    if (drawn[key] === html) return;
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
  }

  function render({ reveal = false } = {}) {
    if (!data || playing) return;
    statusEl.hidden = true;
    const done = data.done;
    ledeEl.hidden = done;
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : "Sixteen words, four hidden groups of four. Fewest mistakes wins.";
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));
    introEl.hidden = done || data.started;
    startButton.disabled = false;
    playEl.hidden = true;
    resultEl.hidden = !done;
    if (done) {
      put(resultEl, "result", resultHtml());
      resultEl.classList.toggle("is-revealed", reveal && !reduced());
    }
    const stats = statsHtml(data.stats);
    statsEl.hidden = !stats;
    put(statsEl, "stats", stats);
    // A round that already started (a reload) carries on; the Worker keeps the real time.
    if (data.started && !done && !saving) begin(Number(data.elapsedMs) || 0);
  }

  /* -------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    if (playing || saving) return;
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s puzzle…";
      introEl.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/connect?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || playing || saving) return;
      data = result;
      if (!quiet) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "Connections needs the latest server update first." : "Couldn’t load today’s puzzle. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "connect") return;
      load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function resetIdentity() {
    identitySeq += 1;
    loadSeq += 1;
    playing = false;
    saving = false;
    pending = null;
    window.cancelAnimationFrame(frame);
    data = null;
    layout = [];
    selected = [];
    drawn = { result: "", stats: "" };
    gridEl.innerHTML = "";
    foundEl.innerHTML = "";
    resultEl.innerHTML = "";
    statsEl.innerHTML = "";
    showError("");
    if (app()?.step === "connect") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  startButton.addEventListener("click", start);
  gridEl.addEventListener("click", (event) => {
    const button = event.target.closest(".connect-word");
    if (button && !button.disabled) toggle(button.dataset.word);
  });
  shuffleButton.addEventListener("click", () => {
    if (!playing || saving) return;
    for (let index = layout.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [layout[index], layout[swap]] = [layout[swap], layout[index]];
    }
    saveDraft();
    renderBoard();
  });
  clearButton.addEventListener("click", () => {
    if (!playing || saving) return;
    selected = [];
    saveDraft();
    renderControls();
  });
  submitButton.addEventListener("click", () => guess());
  retryButton.addEventListener("click", () => {
    retryButton.hidden = true;
    showError("");
    if (playing && pending) guess(pending);
    else load();
  });
  window.addEventListener("resize", () => {
    if (playing) fitWords();
  });
  document.fonts?.ready?.then(() => { if (playing) fitWords(); }).catch(() => {});
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "connect") {
      load();
      startPolling();
      if (playing) window.requestAnimationFrame(fitWords);
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "connect") load({ quiet: true });
  });
})();
