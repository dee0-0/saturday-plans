/*
 * Which came first? 5 pairs a day. Tap Start (the Worker notes the time and only then
 * sends the pairs), tap the one that happened first in each, and your time stops after
 * the fifth. More right answers wins; with the same number right, the faster one wins.
 * Both years show once you've played. Looks from match.css + quick.css + puzzles.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="first"]');
  if (!section) return;

  const ledeEl = $("#first-lede");
  const statusEl = $("#first-status");
  const introEl = $("#first-intro");
  const startButton = $("#first-start");
  const playEl = $("#first-play");
  const clockEl = $("#first-clock");
  const countEl = $("#first-count");
  const cardsEl = $("#first-cards");
  const cardEls = [...cardsEl.querySelectorAll(".match-card")];
  const resultEl = $("#first-result");
  const errorEl = $("#first-error");
  const retryButton = $("#first-retry");
  const statsEl = $("#first-stats");

  const POLL_MS = 12000;
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview") ? "date-letter-first-draft-preview" : "date-letter-first-draft";

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
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  const iconHtml = (name, fallback = "history") => `<i class="icon" data-lucide="${ICON_NAME.test(name || "") ? name : fallback}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;
  const seconds = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)}\u00a0s`;
  const count = () => data?.count || 5;

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

  function showPair() {
    const index = picks.length;
    const pair = data.pairs?.[index];
    if (!pair) return;
    countEl.textContent = `Pair ${index + 1} of ${count()}`;
    cardEls.forEach((card, side) => {
      const option = pair.options[side];
      card.querySelector(".match-card-label").textContent = option.label;
      card.querySelector(".match-card-art").innerHTML = iconHtml(option.icon);
      card.setAttribute("aria-label", option.label);
      card.classList.remove("is-picked", "is-other");
      card.disabled = false;
    });
    icons(cardsEl);
    if (!reduced()) {
      cardsEl.classList.remove("is-next");
      void cardsEl.offsetWidth;
      cardsEl.classList.add("is-next");
    }
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
    if (picks.length >= count()) {
      finish();
      return;
    }
    showPair();
    cardEls[0].focus({ preventScroll: true });
  }

  async function start() {
    if (!data || saving || playing) return;
    startButton.disabled = true;
    showError("");
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/first", "POST", { author: me(), day: data.day, action: "start" });
      if (identity !== identitySeq) return;
      data = result;
      begin(0);
    } catch (error) {
      startButton.disabled = false;
      showError(error.status ? error.message : "Couldn’t start. Check your connection and try again.");
      if (error.status === 409) load();
    }
  }

  function pick(side) {
    if (!playing || saving || picks.length >= count()) return;
    picks.push(side);
    saveDraft();
    cardEls.forEach((card, at) => {
      card.disabled = true;
      card.classList.toggle("is-picked", at === side);
      card.classList.toggle("is-other", at !== side);
    });
    if (picks.length >= count()) finish();
    else window.setTimeout(showPair, reduced() ? 60 : 220);
  }

  async function finish() {
    if (!playing || saving) return;
    playing = false;
    window.cancelAnimationFrame(frame);
    const ms = Math.round(performance.now() - startedAt);
    saving = true;
    countEl.textContent = "Sending…";
    cardEls.forEach((card) => { card.disabled = true; });
    const identity = identitySeq;
    const answers = Array.from({ length: count() }, (_, index) => (picks[index] === 0 || picks[index] === 1 ? picks[index] : null));
    try {
      const result = await app().apiRequest("/games/first", "POST", { author: me(), day: data.day, action: "submit", picks: answers, ms });
      if (identity !== identitySeq) return;
      saving = false;
      clearDraft();
      data = result;
      picks = [];
      render();
      const res = result.result;
      postActivity({
        kind: "first.played",
        text: res
          ? (res.winner === me() ? "won today’s which came first" : res.winner === "tie" ? "played which came first: a tie" : "played which came first: you won")
          : `got ${result.mine.right} of ${count()} right in which came first, in ${seconds(result.mine.ms)}`,
        step: "first",
        icon: "history",
        push: true
      });
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      playing = true; // so a retry can send the same answers
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
    const rows = (data.pairs || []).map((pair, index) => {
      const options = pair.options.map((option, side) => {
        const who = [mine.picks[index] === side ? "You" : "", data.theirs?.picks?.[index] === side ? them : ""].filter(Boolean).join(" · ");
        const classes = [side === pair.first ? "is-first" : "", mine.picks[index] === side && side !== pair.first ? "is-wrong" : ""].filter(Boolean).join(" ");
        return `<span class="first-option ${classes}">
            <span class="first-option-year">${escape(String(option.year))}</span>
            <span class="first-option-label">${escape(option.label)}</span>
            ${who ? `<small>${who}</small>` : ""}
          </span>`;
      }).join("");
      const right = mine.picks[index] === pair.first;
      return `<li class="first-row${right ? " is-right" : ""}"><span class="first-row-mark" aria-label="${right ? "You got it" : "Not this one"}">${iconHtml(right ? "check" : "x")}</span><div class="first-options">${options}</div></li>`;
    }).join("");
    let head;
    if (!res) {
      head = `<div class="match-waiting"><span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">${mine.right} of ${count()} right in ${seconds(mine.ms)}</p>
          <p class="match-waiting-copy">Waiting for ${them} to play. Shh, no spoilers!</p></div></div>`;
    } else {
      const message = res.winner === "tie" ? "A perfect tie!" : res.winner === me() ? "You won today!" : `${them} won today!`;
      head = `<div class="match-score${res.right[me()] === count() ? " is-perfect" : ""}">
          <p class="quick-versus"><span class="${res.winner === me() ? "is-win" : ""}">${iconHtml("check")}You ${res.right[me()]}/${count()} · ${seconds(res.ms[me()])}</span><span class="${res.winner === other() ? "is-win" : ""}">${iconHtml("check")}${them} ${res.right[other()]}/${count()} · ${seconds(res.ms[other()])}</span></p>
          <p class="match-score-msg">${escape(message)}</p></div>`;
    }
    return `${head}<ol class="first-rows">${rows}</ol>`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    return `<div class="match-stat"><dt>Wins</dt><dd><strong>${Number(stats.wins?.[me()]) || 0} : ${Number(stats.wins?.[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Perfect</dt><dd><strong>${Number(stats.perfect?.[me()]) || 0} : ${Number(stats.perfect?.[other()]) || 0}</strong><small>days with 5 of 5</small></dd></div>
      <div class="match-stat"><dt>Played</dt><dd><strong>${Number(stats.daysPlayed) || 0}</strong><small>${Number(stats.daysPlayed) === 1 ? "day" : "days"} together</small></dd></div>`;
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
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : "Five pairs. Tap the one that happened first. Fastest right answers win.";
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
      statusEl.textContent = "Loading today’s pairs…";
      introEl.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/first?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || playing || saving) return;
      data = result;
      if (!quiet) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "Which came first needs the latest server update first." : "Couldn’t load today’s pairs. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "first") return;
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
    if (app()?.step === "first") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  startButton.addEventListener("click", start);
  cardsEl.addEventListener("click", (event) => {
    const card = event.target.closest(".match-card");
    if (card && !card.disabled) pick(Number(card.dataset.pick));
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
    if (event.detail.name === "first") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "first") load({ quiet: true });
  });
})();
