/*
 * Odd one out: 3 puzzles of 4 words, one doesn't fit. Tap Start (the Worker notes the
 * time and only then sends the words), pick the odd word in each, and your time stops
 * after the third. More right answers wins; with the same number right, the faster
 * one wins. Answers and the reason show once you've played. Looks from match.css + quick.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="odd"]');
  if (!section) return;

  const ledeEl = $("#odd-lede");
  const statusEl = $("#odd-status");
  const introEl = $("#odd-intro");
  const startButton = $("#odd-start");
  const playEl = $("#odd-play");
  const clockEl = $("#odd-clock");
  const countEl = $("#odd-count");
  const wordsEl = $("#odd-words");
  const resultEl = $("#odd-result");
  const errorEl = $("#odd-error");
  const retryButton = $("#odd-retry");
  const statsEl = $("#odd-stats");

  const POLL_MS = 12000;
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview") ? "date-letter-odd-draft-preview" : "date-letter-odd-draft";

  let data = null;
  let picks = [];
  let playing = false;
  let saving = false;
  let startedAt = 0;
  let frame = 0;
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let drawn = { result: "", stats: "" };

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const iconHtml = (name) => `<i class="icon" data-lucide="${name}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;
  const seconds = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;
  const count = () => data?.count || 3;

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
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ day: data?.day, author: me(), picks })); } catch { /* Optional. */ }
  }

  function readDraft() {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null");
      return draft && draft.day === data?.day && draft.author === me() && Array.isArray(draft.picks) ? draft.picks : [];
    } catch { return []; }
  }

  function clearDraft() {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional. */ }
  }

  /* ------------------------------- Playing ------------------------------- */
  function tick() {
    if (!playing) return;
    clockEl.textContent = ((performance.now() - startedAt) / 1000).toFixed(1);
    frame = window.requestAnimationFrame(tick);
  }

  function showPuzzle() {
    const index = picks.length;
    const puzzle = data.puzzles?.[index];
    if (!puzzle) return;
    countEl.textContent = `Puzzle ${index + 1} of ${count()}`;
    wordsEl.innerHTML = puzzle.words.map((word, at) => `<button class="quick-word" type="button" data-pick="${at}">${escape(word)}</button>`).join("");
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      wordsEl.classList.remove("is-next");
      void wordsEl.offsetWidth;
      wordsEl.classList.add("is-next");
    }
    wordsEl.querySelector("button")?.focus({ preventScroll: true });
  }

  function begin(resumeMs = 0) {
    playing = true;
    startedAt = performance.now() - resumeMs;
    picks = readDraft().slice(0, count());
    introEl.hidden = true;
    resultEl.hidden = true;
    ledeEl.hidden = true;
    playEl.hidden = false;
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(tick);
    if (picks.length >= count()) finish();
    else showPuzzle();
  }

  async function start() {
    if (!data || saving || playing) return;
    startButton.disabled = true;
    showError("");
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/odd", "POST", { author: me(), day: data.day, action: "start" });
      if (identity !== identitySeq) return;
      data = result;
      begin(0);
    } catch (error) {
      startButton.disabled = false;
      showError(error.status ? error.message : "Couldn’t start. Check your connection and try again.");
      if (error.status === 409) load();
    }
  }

  function pick(at) {
    if (!playing || saving) return;
    picks.push(at);
    saveDraft();
    wordsEl.querySelector(`[data-pick="${at}"]`)?.classList.add("is-picked");
    if (picks.length >= count()) finish();
    else window.setTimeout(showPuzzle, 140);
  }

  async function finish() {
    if (!playing || saving) return;
    playing = false;
    window.cancelAnimationFrame(frame);
    const ms = Math.round(performance.now() - startedAt);
    saving = true;
    countEl.textContent = "Sending…";
    wordsEl.querySelectorAll("button").forEach((button) => { button.disabled = true; });
    const identity = identitySeq;
    const answers = Array.from({ length: count() }, (_, index) => (Number.isInteger(picks[index]) ? picks[index] : null));
    try {
      const result = await app().apiRequest("/games/odd", "POST", { author: me(), day: data.day, action: "submit", picks: answers, ms });
      if (identity !== identitySeq) return;
      saving = false;
      clearDraft();
      data = result;
      picks = [];
      render();
      const res = result.result;
      postActivity({
        kind: "odd.played",
        text: res
          ? (res.winner === me() ? "won today’s odd one out" : res.winner === "tie" ? "played odd one out: a tie" : "played odd one out: you won")
          : `solved ${result.mine.right} of ${count()} odd ones out in ${seconds(result.mine.ms)}`,
        step: "odd",
        icon: "shapes",
        push: true
      });
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      playing = true;
      showError(error.status ? error.message : "Couldn’t send your answers. Check your connection and try again.");
      retryButton.hidden = false;
      if (error.status === 409) {
        playing = false;
        clearDraft();
        load();
      }
    }
  }

  /* -------------------------------- Result -------------------------------- */
  function resultHtml() {
    const them = escape(nameOf(other()));
    const res = data.result;
    const mine = data.mine;
    const puzzles = (data.puzzles || []).map((puzzle, index) => {
      const words = puzzle.words.map((word, at) => {
        const classes = [at === puzzle.odd ? "is-odd" : "", mine.picks[index] === at && at !== puzzle.odd ? "is-wrong" : ""].filter(Boolean).join(" ");
        const who = [mine.picks[index] === at ? "You" : "", data.theirs?.picks?.[index] === at ? them : ""].filter(Boolean).join(" · ");
        return `<span class="quick-chip ${classes}">${escape(word)}${who ? `<small>${who}</small>` : ""}</span>`;
      }).join("");
      return `<li class="quick-puzzle"><div class="quick-chips">${words}</div><p class="quick-why">${iconHtml("lightbulb")}${escape(puzzle.why || "")}</p></li>`;
    }).join("");
    let head;
    if (!res) {
      head = `<div class="match-waiting"><span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">${mine.right} of ${count()} right in ${seconds(mine.ms)}</p>
          <p class="match-waiting-copy">Waiting for ${them} to play. Shh, no spoilers!</p></div></div>`;
    } else {
      const message = res.winner === "tie" ? "A perfect tie!" : res.winner === me() ? "You won today!" : `${them} won today!`;
      head = `<div class="match-score">
          <p class="quick-versus"><span class="${res.winner === me() ? "is-win" : ""}">${iconHtml("check")}You ${res.right[me()]}/${count()} · ${seconds(res.ms[me()])}</span><span class="${res.winner === other() ? "is-win" : ""}">${iconHtml("check")}${them} ${res.right[other()]}/${count()} · ${seconds(res.ms[other()])}</span></p>
          <p class="match-score-msg">${escape(message)}</p></div>`;
    }
    return `${head}<ol class="quick-puzzles">${puzzles}</ol>`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    return `<div class="match-stat"><dt>Wins</dt><dd><strong>${Number(stats.wins?.[me()]) || 0} : ${Number(stats.wins?.[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Solved</dt><dd><strong>${Number(stats.right?.[me()]) || 0} : ${Number(stats.right?.[other()]) || 0}</strong><small>puzzles right</small></dd></div>
      <div class="match-stat"><dt>Played</dt><dd><strong>${Number(stats.daysPlayed) || 0}</strong><small>days together</small></dd></div>`;
  }

  function put(element, key, html) {
    if (drawn[key] === html) return;
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
  }

  function render() {
    if (!data || playing) return;
    statusEl.hidden = true;
    const done = data.done;
    ledeEl.hidden = done;
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : "Three puzzles. One word doesn’t fit. Fastest right answers win.";
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));
    introEl.hidden = done || data.started;
    startButton.disabled = false;
    playEl.hidden = true;
    resultEl.hidden = !done;
    if (done) put(resultEl, "result", resultHtml());
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
      statusEl.textContent = "Loading today’s puzzles…";
      introEl.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/odd?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || playing || saving) return;
      data = result;
      if (!quiet) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "Odd one out needs the latest server update first." : "Couldn’t load today’s puzzles. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "odd") return;
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
    window.cancelAnimationFrame(frame);
    data = null;
    picks = [];
    drawn = { result: "", stats: "" };
    resultEl.innerHTML = "";
    statsEl.innerHTML = "";
    showError("");
    if (app()?.step === "odd") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  startButton.addEventListener("click", start);
  wordsEl.addEventListener("click", (event) => {
    const button = event.target.closest(".quick-word");
    if (button && !button.disabled) pick(Number(button.dataset.pick));
  });
  retryButton.addEventListener("click", () => {
    retryButton.hidden = true;
    showError("");
    if (playing && !saving) finish();
    else load();
  });
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "odd") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "odd") load({ quiet: true });
  });
})();
