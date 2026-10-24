/*
 * Stop the clock: stop a stopwatch at exactly the day's target (say 5.25 seconds). The
 * digits vanish after 1.5 seconds, so you have to feel it. Three tries, the closest one
 * counts. Each try is timed here (performance.now(), from the tap itself) and sent the
 * moment you stop, so there's no redo. The other one's tries show once you've used all
 * three. Looks from match.css + quick.css + arcade.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="clock"]');
  if (!section) return;

  const ledeEl = $("#clock-lede");
  const statusEl = $("#clock-status");
  const gameEl = $("#clock-game");
  const targetEl = $("#clock-target");
  const face = $("#clock-face");
  const digitsEl = $("#clock-digits");
  const hintEl = $("#clock-hint");
  const noteEl = $("#clock-note");
  const triesEl = $("#clock-tries");
  const resultEl = $("#clock-result");
  const errorEl = $("#clock-error");
  const retryButton = $("#clock-retry");
  const statsEl = $("#clock-stats");

  const POLL_MS = 12000;
  const VISIBLE_MS = 1500;  // the digits show this long, then you're on your own
  const MAX_MS = 30000;
  const MIN_MS = 300;       // a stop this soon is a double tap, not a stop
  const REST_MS = 600;      // after a stop, a short pause before the next try can start
  const HOLD_MS = 1300;     // the last try stays on the face this long before the result
  const LEDE = "Stop it at exactly the target. The digits vanish after 1.5 seconds. Best of 3 tries.";
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview") ? "date-letter-clock-draft-preview" : "date-letter-clock-draft";

  let data = null;
  let run = null;        // { from } while the stopwatch runs (performance.now() time)
  let pending = null;    // { day, index, ms }: a stopped try on its way to the Worker
  let stuck = false;     // the last send failed: a tap on the face sends it again
  let lastTry = null;    // { index, ms }: the try just stopped, shown on the face
  let restUntil = 0;
  let holdUntil = 0;
  let lastPress = 0;
  let frame = 0;
  let blindTimer = 0;
  let laterTimer = 0;
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let drawn = { target: "", tries: "", note: "", result: "", stats: "" };

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const iconHtml = (name) => `<i class="icon" data-lucide="${name}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;
  const secs = (ms) => (Math.max(0, ms) / 1000).toFixed(2);
  // "0.13 s off"; under a hundredth it shows the milliseconds too ("0.004 s off").
  const offText = (off) => `${(Math.max(0, off) / 1000).toFixed(off < 10 ? 3 : 2)} s off`;
  const count = () => data?.tries || 3;
  const triesDone = () => data?.mine?.tries?.length || 0;

  function verdict(ms, target) {
    const off = Math.abs(ms - target);
    const early = ms < target;
    if (off <= 10) return "Perfect!";
    if (off <= 50) return "Incredible!";
    if (off <= 100) return "So close!";
    if (off <= 250) return early ? "Nice, a touch early" : "Nice, a touch late";
    if (off <= 600) return early ? "A bit early" : "A bit late";
    return early ? "Way too early" : "Way too late";
  }

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

  // A stopped try that hasn't reached the Worker yet survives a reload (and gets sent then).
  function saveDraft() {
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...pending, author: me() })); } catch { /* Optional. */ }
  }

  function readDraft() {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null");
      return draft && draft.day === data?.day && draft.author === me() && Number.isInteger(draft.index) && Number.isFinite(draft.ms) ? draft : null;
    } catch { return null; }
  }

  function clearDraft() {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional. */ }
  }

  /* ------------------------------- Playing ------------------------------- */
  // The tap's own time stamp (same clock as performance.now()) is closer to the real moment.
  function eventTime(event) {
    const now = performance.now();
    const stamp = Number(event?.timeStamp);
    return Number.isFinite(stamp) && stamp > 0 && stamp <= now && now - stamp < 1000 ? stamp : now;
  }

  const resting = () => Boolean(pending) || performance.now() < restUntil;

  function press(event) {
    if (!data || data.done) return;
    if (pending && stuck) {
      send();
      return;
    }
    const at = eventTime(event);
    if (run) {
      if (at - run.from >= MIN_MS) stop(at);
    } else if (!resting() && triesDone() < count()) {
      begin(at);
    }
  }

  function begin(at) {
    run = { from: at };
    lastTry = null;
    showError("");
    retryButton.hidden = true;
    face.classList.remove("is-blind", "is-stopped", "is-perfect", "is-resting");
    face.classList.add("is-running");
    digitsEl.textContent = "0.00";
    hintEl.textContent = "Tap to stop";
    setNote("");
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(tick);
  }

  function tick() {
    if (!run) return;
    const elapsed = performance.now() - run.from;
    if (elapsed < VISIBLE_MS) {
      digitsEl.textContent = secs(elapsed);
      frame = window.requestAnimationFrame(tick);
      return;
    }
    // From here on the face shows nothing that gives the time away.
    face.classList.add("is-blind");
    digitsEl.textContent = "?.??";
    window.clearTimeout(blindTimer);
    blindTimer = window.setTimeout(() => { if (run) stop(run.from + MAX_MS); }, Math.max(0, MAX_MS - elapsed));
  }

  // Leaving mid-run (another page, the phone locked) drops that run: no try is used.
  function cancelRun() {
    if (!run) return;
    run = null;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(blindTimer);
    if (data) render();
  }

  function stop(at) {
    const ms = Math.round(Math.min(MAX_MS, Math.max(0, at - run.from)));
    run = null;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(blindTimer);
    const index = triesDone();
    pending = { day: data.day, index, ms };
    lastTry = { index, ms };
    restUntil = performance.now() + REST_MS;
    if (index === count() - 1) holdUntil = performance.now() + HOLD_MS;
    saveDraft();
    render();
    send();
  }

  async function send() {
    if (!pending) return;
    const attempt = pending;
    stuck = false;
    showError("");
    retryButton.hidden = true;
    if (data) drawFace();
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/clock", "POST", { author: me(), day: attempt.day, action: "try", index: attempt.index, ms: attempt.ms });
      if (identity !== identitySeq || pending !== attempt) return;
      pending = null;
      clearDraft();
      data = result;
      render();
      later(Math.max(restUntil, holdUntil) - performance.now());
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
      if (result.done && attempt.index === count() - 1) {
        const res = result.result;
        postActivity({
          kind: "clock.played",
          text: res
            ? (res.winner === me() ? "won today’s stop the clock" : res.winner === "tie" ? "played stop the clock: a tie" : "played stop the clock: you won")
            : "stopped today’s clock. Your turn!",
          step: "clock",
          icon: "timer",
          push: true
        });
      }
    } catch (error) {
      if (identity !== identitySeq || pending !== attempt) return;
      if (error.status === 409 || error.status === 400) {
        pending = null;
        lastTry = null;
        clearDraft();
        showError(error.message);
        load();
        return;
      }
      stuck = true;
      showError(error.status ? error.message : "Couldn’t send your try. Check your connection and try again.");
      retryButton.hidden = false;
      render();
    }
  }

  // Draws again once the short rest after a stop is over (the hint changes to "Tap for try 2").
  function later(ms) {
    window.clearTimeout(laterTimer);
    if (ms > 0) laterTimer = window.setTimeout(render, ms + 20);
  }

  /* -------------------------------- Drawing ------------------------------- */
  function setNote(html) {
    if (drawn.note === html) return;
    noteEl.innerHTML = html;
    drawn.note = html;
  }

  function drawFace() {
    const tries = data.mine?.tries || [];
    const shown = lastTry || (tries.length ? { index: tries.length - 1, ms: tries[tries.length - 1] } : null);
    const used = tries.length + (pending && pending.index === tries.length ? 1 : 0);
    face.classList.remove("is-running", "is-blind");
    face.classList.toggle("is-stopped", Boolean(shown));
    face.classList.toggle("is-perfect", Boolean(shown) && Math.abs(shown.ms - data.target) <= 50);
    face.classList.toggle("is-resting", resting() || used >= count());
    face.setAttribute("aria-disabled", String((Boolean(pending) && !stuck) || used >= count()));
    digitsEl.textContent = shown ? secs(shown.ms) : "0.00";
    if (pending) hintEl.textContent = stuck ? "Tap to send again" : "Saving…";
    else if (used >= count()) hintEl.textContent = "All done";
    else if (resting()) hintEl.textContent = "Get ready…";
    else hintEl.textContent = used === 0 ? "Tap to start" : `Tap for try ${used + 1}`;
    setNote(shown ? `<span><b>${secs(shown.ms)} s</b> — ${escape(offText(Math.abs(shown.ms - data.target)))}</span><em>${escape(verdict(shown.ms, data.target))}</em>` : "");
  }

  function triesHtml(tries, { pendingMs = null } = {}) {
    const list = [...tries];
    if (pendingMs !== null) list.push(pendingMs);
    const offs = list.map((ms) => Math.abs(ms - data.target));
    const best = offs.length ? Math.min(...offs) : null;
    return Array.from({ length: count() }, (_, index) => {
      if (index >= list.length) return `<li class="clock-try is-empty"><small>Try ${index + 1}</small><b>–</b><span>to go</span></li>`;
      const off = offs[index];
      const classes = ["clock-try", list.length > 1 && off === best ? "is-best" : "", off <= 50 ? "is-perfect" : ""].filter(Boolean).join(" ");
      return `<li class="${classes}"><small>Try ${index + 1}</small><b>${secs(list[index])}</b><span>${escape(offText(off))}</span></li>`;
    }).join("");
  }

  function duelHtml() {
    const them = escape(nameOf(other()));
    const mine = data.mine;
    const theirs = data.theirs;
    const cell = (player, index) => {
      const ms = player.tries[index];
      const off = player.offs[index];
      return `<span class="clock-duel-cell${off === player.best ? " is-best" : ""}" role="cell"><b>${secs(ms)}</b><small>${escape(offText(off))}</small></span>`;
    };
    const rows = Array.from({ length: count() }, (_, index) => `<div class="clock-duel-row" role="row"><span class="clock-duel-label" role="rowheader">Try ${index + 1}</span>${cell(mine, index)}${cell(theirs, index)}</div>`).join("");
    return `<div class="clock-duel" role="table" aria-label="Both of our tries">
        <div class="clock-duel-row is-head" role="row"><span class="clock-duel-label" role="columnheader"><span class="visually-hidden">Try</span></span><span role="columnheader">You</span><span role="columnheader">${them}</span></div>
        ${rows}
      </div>`;
  }

  function resultHtml() {
    const them = escape(nameOf(other()));
    const mine = data.mine;
    const res = data.result;
    if (!res) {
      return `<div class="match-waiting"><span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">Your best: ${escape(offText(mine.best))}</p>
          <p class="match-waiting-copy">Waiting for ${them} to play. Shh, no spoilers!</p></div></div>
        <p class="clock-target is-small">Target <strong>${secs(data.target)} s</strong></p>
        <ol class="clock-tries" aria-label="Your tries">${triesHtml(mine.tries)}</ol>`;
    }
    const message = res.winner === "tie" ? "Just as close. A tie!" : res.winner === me() ? "You won today!" : `${them} won today!`;
    return `<div class="match-score${res.perfect[me()] ? " is-perfect" : ""}">
        <p class="match-score-big"><strong>${secs(data.target)} s</strong>was today’s target</p>
        <p class="quick-versus"><span class="${res.winner === me() ? "is-win" : ""}">${iconHtml("timer")}You ${escape(offText(res.best[me()]))}</span><span class="${res.winner === other() ? "is-win" : ""}">${iconHtml("timer")}${them} ${escape(offText(res.best[other()]))}</span></p>
        <p class="match-score-msg">${escape(message)}</p>
      </div>
      ${duelHtml()}`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    const best = stats.best?.[me()];
    return `<div class="match-stat"><dt>Wins</dt><dd><strong>${Number(stats.wins?.[me()]) || 0} : ${Number(stats.wins?.[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Your best ever</dt><dd><strong>${best === null || best === undefined ? "–" : `${(best / 1000).toFixed(best < 10 ? 3 : 2)} s`}</strong><small>off the target</small></dd></div>
      <div class="match-stat"><dt>Perfect stops</dt><dd><strong>${Number(stats.perfect?.[me()]) || 0} : ${Number(stats.perfect?.[other()]) || 0}</strong><small>within 0.05 s</small></dd></div>
      <div class="match-stat"><dt>Played</dt><dd><strong>${Number(stats.daysPlayed) || 0}</strong><small>${Number(stats.daysPlayed) === 1 ? "day" : "days"} together</small></dd></div>`;
  }

  function put(element, key, html) {
    if (drawn[key] === html) return;
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
  }

  function render() {
    if (!data || run) return;
    statusEl.hidden = true;
    // The last try stays on the face a moment before the result takes over.
    const holding = data.done && performance.now() < holdUntil;
    const done = data.done && !holding;
    ledeEl.hidden = done;
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : LEDE;
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));
    gameEl.hidden = done;
    if (!done) {
      put(targetEl, "target", `Stop at exactly <strong>${secs(data.target)}</strong> seconds`);
      drawFace();
      put(triesEl, "tries", triesHtml(data.mine?.tries || [], { pendingMs: pending && pending.index === triesDone() ? pending.ms : null }));
    }
    resultEl.hidden = !done;
    if (done) put(resultEl, "result", resultHtml());
    const stats = statsHtml(data.stats);
    statsEl.hidden = !stats;
    put(statsEl, "stats", stats);
    if (holding) later(holdUntil - performance.now());
  }

  /* -------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    if (run || pending) return;
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s clock…";
      gameEl.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/clock?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || run || pending) return;
      data = result;
      if (!quiet) retryButton.hidden = true;
      // A try stopped just before a reload that never got through: send it now.
      const draft = readDraft();
      if (draft && draft.index === triesDone() && !data.done) {
        pending = { day: draft.day, index: draft.index, ms: draft.ms };
        lastTry = { index: draft.index, ms: draft.ms };
        render();
        send();
        return;
      }
      if (draft) clearDraft();
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "Stop the clock needs the latest server update first." : "Couldn’t load today’s clock. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "clock") return;
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
    run = null;
    pending = null;
    stuck = false;
    lastTry = null;
    holdUntil = 0;
    restUntil = 0;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(blindTimer);
    window.clearTimeout(laterTimer);
    data = null;
    drawn = { target: "", tries: "", note: "", result: "", stats: "" };
    targetEl.innerHTML = "";
    triesEl.innerHTML = "";
    noteEl.innerHTML = "";
    resultEl.innerHTML = "";
    statsEl.innerHTML = "";
    showError("");
    if (app()?.step === "clock") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  // Start and stop on the touch itself (pointerdown), not on the click a moment later.
  face.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    lastPress = performance.now();
    press(event);
  });
  face.addEventListener("keydown", (event) => {
    if ((event.key !== " " && event.key !== "Enter") || event.repeat) return;
    event.preventDefault();
    lastPress = performance.now();
    press(event);
  });
  // A click without a pointer before it (VoiceOver, Switch Control) still works.
  face.addEventListener("click", (event) => {
    if (performance.now() - lastPress < 1000) return;
    press(event);
  });
  face.addEventListener("contextmenu", (event) => event.preventDefault());
  retryButton.addEventListener("click", () => {
    retryButton.hidden = true;
    showError("");
    if (pending) send();
    else load();
  });
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "clock") {
      load();
      startPolling();
    } else {
      cancelRun();
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelRun();
    else if (app()?.step === "clock") load({ quiet: true });
  });
})();
