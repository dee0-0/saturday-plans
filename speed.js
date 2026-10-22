/*
 * Speed round: 10 this-or-that pairs in 15 seconds. Tap Start (the Worker notes the
 * time and only then sends the pairs), tap one side per pair as fast as you can, and
 * the round sends itself after the 10th pick or when the time runs out. Once both
 * played: how many we picked the same and who was faster. Looks from match.css + quick.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="speed"]');
  if (!section) return;

  const ledeEl = $("#speed-lede");
  const statusEl = $("#speed-status");
  const introEl = $("#speed-intro");
  const startButton = $("#speed-start");
  const playEl = $("#speed-play");
  const timerEl = $("#speed-timer");
  const timerBar = $("#speed-timer-bar");
  const countEl = $("#speed-count");
  const cardsEl = $("#speed-cards");
  const cardEls = [...cardsEl.querySelectorAll(".match-card")];
  const resultEl = $("#speed-result");
  const errorEl = $("#speed-error");
  const retryButton = $("#speed-retry");
  const statsEl = $("#speed-stats");

  const POLL_MS = 12000;
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview") ? "date-letter-speed-draft-preview" : "date-letter-speed-draft";

  let data = null;
  let picks = [];
  let playing = false;
  let saving = false;
  let startedAt = 0;   // performance.now() at the start (or when resumed, shifted by the time already used)
  let limit = 15000;
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
  const iconHtml = (name, fallback = "heart") => `<i class="icon" data-lucide="${ICON_NAME.test(name || "") ? name : fallback}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;
  const seconds = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

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
  function elapsed() {
    return Math.min(limit, performance.now() - startedAt);
  }

  function tick() {
    if (!playing) return;
    const left = Math.max(0, limit - elapsed());
    timerEl.textContent = (left / 1000).toFixed(1);
    timerBar.style.transform = `scaleX(${left / limit})`;
    timerEl.parentElement.classList.toggle("is-hurry", left < 4000);
    if (left <= 0) {
      finish();
      return;
    }
    frame = window.requestAnimationFrame(tick);
  }

  function showPair() {
    const index = picks.length;
    const pair = data.pairs?.[index];
    if (!pair) return;
    countEl.textContent = `${index + 1} / ${data.count || 10}`;
    cardEls.forEach((card, side) => {
      card.querySelector(".match-card-label").textContent = pair[side];
      card.querySelector(".match-card-art").innerHTML = iconHtml(pair[2 + side], side === 0 ? "heart" : "sparkles");
      card.setAttribute("aria-label", pair[side]);
      card.classList.remove("is-picked", "is-other");
      card.disabled = false;
    });
    icons(cardsEl);
  }

  function begin(leftMs) {
    playing = true;
    limit = data.limitMs || 15000;
    startedAt = performance.now() - (limit - (leftMs ?? limit));
    picks = readDraft().slice(0, (data.count || 10));
    introEl.hidden = true;
    resultEl.hidden = true;
    playEl.hidden = false;
    ledeEl.hidden = true;
    showPair();
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(tick);
    cardEls[0].focus({ preventScroll: true });
    if (picks.length >= (data.count || 10)) finish();
  }

  async function start() {
    if (!data || saving || playing) return;
    startButton.disabled = true;
    showError("");
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/speed", "POST", { author: me(), day: data.day, action: "start" });
      if (identity !== identitySeq) return;
      data = result;
      begin(result.leftMs);
    } catch (error) {
      startButton.disabled = false;
      showError(error.status ? error.message : "Couldn’t start. Check your connection and try again.");
      if (error.status === 409) load();
    }
  }

  function pick(side) {
    if (!playing || saving) return;
    picks.push(side);
    saveDraft();
    cardEls[side].classList.add("is-picked");
    if (picks.length >= (data.count || 10)) {
      finish();
      return;
    }
    showPair();
  }

  async function finish() {
    if (!playing || saving) return;
    playing = false;
    window.cancelAnimationFrame(frame);
    const ms = Math.round(elapsed());
    const count = data.count || 10;
    const answers = Array.from({ length: count }, (_, index) => (picks[index] === 0 || picks[index] === 1 ? picks[index] : null));
    saving = true;
    cardEls.forEach((card) => { card.disabled = true; });
    countEl.textContent = "Sending…";
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/speed", "POST", { author: me(), day: data.day, action: "submit", picks: answers, ms });
      if (identity !== identitySeq) return;
      saving = false;
      clearDraft();
      data = result;
      picks = [];
      render();
      const res = result.result;
      const answered = answers.filter((x) => x !== null).length;
      postActivity({
        kind: "speed.played",
        text: res ? `played the speed round: ${res.matches} the same, ${res.faster === me() ? "and I was faster" : res.faster === "tie" ? "a tie" : "you were faster"}` : `played the speed round: ${answered} picks in ${seconds(result.mine?.ms ?? ms)}`,
        step: "speed",
        icon: "zap",
        push: true
      });
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      playing = true; // so a retry can send the same answers
      showError(error.status ? error.message : "Couldn’t send your picks. Check your connection and try again.");
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
    const mine = data.mine;
    const res = data.result;
    if (!res) {
      return `<div class="match-waiting">
          <span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">Waiting for ${them}…</p>
          <p class="match-waiting-copy">You made ${mine.picks.filter((x) => x !== null).length} picks in ${seconds(mine.ms)}. The result shows when ${them} has played too.</p></div>
        </div>`;
    }
    const faster = res.faster === "tie" ? "Exactly as fast. A tie!" : res.faster === me() ? "You were faster!" : `${them} was faster!`;
    const rows = (data.pairs || []).map((pair, index) => {
      const a = mine.picks[index];
      const b = data.theirs?.picks?.[index];
      const label = (pick) => (pick === 0 || pick === 1 ? escape(pair[pick]) : "–");
      const same = (a === 0 || a === 1) && a === b;
      return `<li class="quick-row${same ? " is-same" : ""}"><span class="quick-row-pair">${escape(pair[0])} <i>or</i> ${escape(pair[1])}</span>
          <span class="quick-row-picks">${same ? `<b>Both: ${label(a)}</b>` : `You: ${label(a)} · ${them}: ${label(b)}`}</span></li>`;
    }).join("");
    return `<div class="match-score${res.matches === 10 ? " is-perfect" : ""}">
        <p class="match-score-big"><strong>${res.matches}</strong> of 10 the same</p>
        <p class="quick-versus"><span class="${res.faster === me() ? "is-win" : ""}">${iconHtml("zap")}You ${res.answered[me()]}/10 · ${seconds(res.ms[me()])}</span><span class="${res.faster === other() ? "is-win" : ""}">${iconHtml("zap")}${them} ${res.answered[other()]}/10 · ${seconds(res.ms[other()])}</span></p>
        <p class="match-score-msg">${escape(faster)}</p>
      </div>
      <ol class="quick-rows">${rows}</ol>`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    const wins = stats.wins || {};
    const best = stats.best?.[me()];
    return `<div class="match-stat is-main"><dt>In sync</dt><dd><strong>${Number(stats.sync) || 0}%</strong><small>the same picks over ${stats.daysPlayed} ${stats.daysPlayed === 1 ? "round" : "rounds"}</small><span class="match-meter" aria-hidden="true"><span style="width: ${Math.min(100, Number(stats.sync) || 0)}%"></span></span></dd></div>
      <div class="match-stat"><dt>Faster</dt><dd><strong>${Number(wins[me()]) || 0} : ${Number(wins[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Your best</dt><dd><strong>${best ? seconds(best) : "–"}</strong><small>all 10 picks</small></dd></div>`;
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
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : "Ten picks. Fifteen seconds. Go with your gut.";
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));
    introEl.hidden = done || data.started;
    startButton.disabled = false;
    playEl.hidden = true;
    resultEl.hidden = !done;
    if (done) put(resultEl, "result", resultHtml());
    const stats = statsHtml(data.stats);
    statsEl.hidden = !stats;
    put(statsEl, "stats", stats);
    // Came back to a round that already started (a reload): carry on with the time that's left.
    if (data.started && !done && !saving) begin(data.leftMs);
  }

  /* -------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    if (playing || saving) return;
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s round…";
      introEl.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/speed?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || playing || saving) return;
      data = result;
      if (!quiet) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "The speed round needs the latest server update first." : "Couldn’t load today’s round. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "speed") return;
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
    if (app()?.step === "speed") load();
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
    if (event.detail.name === "speed") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "speed") load({ quiet: true });
  });
})();
