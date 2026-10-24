/*
 * Sort it: 5 things to put in order by a rule ("Oldest first"). Tap Start (the Worker
 * notes the time and only then sends the rule and the things, mixed up), drag the rows
 * into order or move them with the arrows, and lock it in. Each thing in its right place
 * is a point; more points wins, then the faster one. The right order with the years or
 * sizes shows once you've played. Looks from match.css + quick.css + puzzles.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="sort"]');
  if (!section) return;

  const ledeEl = $("#sort-lede");
  const statusEl = $("#sort-status");
  const introEl = $("#sort-intro");
  const startButton = $("#sort-start");
  const playEl = $("#sort-play");
  const clockEl = $("#sort-clock");
  const ruleEl = $("#sort-rule");
  const aboutEl = $("#sort-about");
  const topEl = $("#sort-top");
  const bottomEl = $("#sort-bottom");
  const listEl = $("#sort-list");
  const sendButton = $("#sort-send");
  const liveEl = $("#sort-live");
  const resultEl = $("#sort-result");
  const errorEl = $("#sort-error");
  const retryButton = $("#sort-retry");
  const statsEl = $("#sort-stats");

  const POLL_MS = 12000;
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview") ? "date-letter-sort-draft-preview" : "date-letter-sort-draft";
  const ORDINALS = ["1st", "2nd", "3rd", "4th", "5th"];

  let data = null;
  let order = [];      // the shown positions (0–4), top to bottom, as I arranged them
  let playing = false;
  let saving = false;
  let startedAt = 0;
  let frame = 0;
  let drag = null;
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
  const count = () => data?.count || 5;
  const labelOf = (at) => data?.puzzle?.items?.[at] || "";

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
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ day: data?.day, author: me(), order })); } catch { /* Optional. */ }
  }

  function readDraft() {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null");
      const value = draft && draft.day === data?.day && draft.author === me() && Array.isArray(draft.order) ? draft.order : null;
      return value && value.length === count() && new Set(value).size === count() && value.every((at) => Number.isInteger(at) && at >= 0 && at < count()) ? value : null;
    } catch { return null; }
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

  function renderList() {
    listEl.innerHTML = order.map((at) => `<li class="sort-item" data-at="${at}">
        <span class="sort-num" aria-hidden="true"></span>
        <span class="sort-label">${escape(labelOf(at))}</span>
        <span class="sort-grip" aria-hidden="true">${iconHtml("grip-vertical")}</span>
        <button class="sort-move" type="button" data-move="-1">${iconHtml("chevron-up")}</button>
        <button class="sort-move" type="button" data-move="1">${iconHtml("chevron-down")}</button>
      </li>`).join("");
    icons(listEl);
    renumber();
  }

  // Numbers, labels and the arrows' state follow the rows' current order.
  function renumber() {
    [...listEl.children].forEach((row, position) => {
      const label = labelOf(Number(row.dataset.at));
      row.querySelector(".sort-num").textContent = String(position + 1);
      const [up, down] = row.querySelectorAll(".sort-move");
      up.disabled = position === 0 || saving;
      down.disabled = position === count() - 1 || saving;
      up.setAttribute("aria-label", `Move ${label} up (now ${ORDINALS[position]})`);
      down.setAttribute("aria-label", `Move ${label} down (now ${ORDINALS[position]})`);
    });
  }

  // Slides rows from where they were to where they are now (FLIP), unless motion is reduced.
  function slideFrom(tops, skip) {
    if (reduced()) return;
    for (const row of listEl.children) {
      if (row === skip || !tops.has(row)) continue;
      const shift = tops.get(row) - row.offsetTop;
      if (!shift) continue;
      row.style.transition = "none";
      row.style.transform = `translateY(${shift}px)`;
      void row.offsetWidth;
      row.style.transition = "";
      row.style.transform = "";
    }
  }

  function moveBy(row, step) {
    const rows = [...listEl.children];
    const from = rows.indexOf(row);
    const to = from + step;
    if (from < 0 || to < 0 || to >= rows.length) return;
    const tops = new Map(rows.map((item) => [item, item.offsetTop]));
    // Move the neighbour (never the row itself), so focus and a drag stay on it.
    const neighbour = rows[to];
    if (step > 0) listEl.insertBefore(neighbour, row);
    else listEl.insertBefore(neighbour, row.nextSibling);
    [order[from], order[to]] = [order[to], order[from]];
    slideFrom(tops, drag?.row === row ? row : null);
    renumber();
    saveDraft();
    liveEl.textContent = `${labelOf(Number(row.dataset.at))}: now ${ORDINALS[to]}`;
  }

  function begin(resumeMs = 0) {
    playing = true;
    startedAt = performance.now() - resumeMs;
    clockEl.textContent = (Math.max(0, resumeMs) / 1000).toFixed(1);
    order = readDraft() || Array.from({ length: count() }, (_, index) => index);
    const puzzle = data.puzzle || {};
    ruleEl.textContent = puzzle.rule || "";
    aboutEl.textContent = puzzle.about || "";
    topEl.innerHTML = `${iconHtml("arrow-up")}<span>${escape(puzzle.top || "")}</span>`;
    bottomEl.innerHTML = `${iconHtml("arrow-down")}<span>${escape(puzzle.bottom || "")}</span>`;
    icons(topEl);
    icons(bottomEl);
    renderList();
    introEl.hidden = true;
    resultEl.hidden = true;
    ledeEl.hidden = true;
    playEl.hidden = false;
    sendButton.disabled = false;
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(tick);
    if (!reduced()) {
      listEl.classList.remove("is-arriving");
      void listEl.offsetWidth;
      listEl.classList.add("is-arriving");
    }
    listEl.querySelector(".sort-move:not(:disabled)")?.focus({ preventScroll: true });
  }

  async function start() {
    if (!data || saving || playing) return;
    startButton.disabled = true;
    showError("");
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/sort", "POST", { author: me(), day: data.day, action: "start" });
      if (identity !== identitySeq) return;
      data = result;
      begin(0);
    } catch (error) {
      startButton.disabled = false;
      showError(error.status ? error.message : "Couldn’t start. Check your connection and try again.");
      if (error.status === 409) load();
    }
  }

  async function finish() {
    if (!playing || saving) return;
    endDrag();
    playing = false;
    window.cancelAnimationFrame(frame);
    const ms = Math.round(performance.now() - startedAt);
    saving = true;
    sendButton.disabled = true;
    renumber();
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/sort", "POST", { author: me(), day: data.day, action: "submit", order, ms });
      if (identity !== identitySeq) return;
      saving = false;
      clearDraft();
      data = result;
      render();
      const res = result.result;
      postActivity({
        kind: "sort.played",
        text: res
          ? (res.winner === me() ? "won today’s sort it" : res.winner === "tie" ? "played sort it: a tie" : "played sort it: you won")
          : `sorted today’s five: ${result.mine.right} in the right place, in ${seconds(result.mine.ms)}`,
        step: "sort",
        icon: "arrow-down-up",
        push: true
      });
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
      resultEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      playing = true; // so a retry can send the same order
      renumber();
      showError(error.status ? error.message : "Couldn’t send your order. Check your connection and try again.");
      retryButton.hidden = false;
      if (error.status === 409) {
        playing = false;
        clearDraft();
        load();
      }
    }
  }

  /* -------------------------------- Drag --------------------------------- */
  function onPointerDown(event) {
    const row = event.target.closest(".sort-item");
    if (!row || !playing || saving || drag || event.target.closest("button")) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    drag = { id: event.pointerId, row, startY: event.clientY };
    try { row.setPointerCapture(event.pointerId); } catch { /* Fine without capture. */ }
    row.classList.add("is-dragging");
    listEl.classList.add("is-sorting");
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault();
    const { row } = drag;
    let shift = event.clientY - drag.startY;
    // Past half of the neighbour: swap with it, and keep the row under the finger.
    for (;;) {
      const next = row.nextElementSibling;
      const previous = row.previousElementSibling;
      const top = row.offsetTop;
      if (next && shift > next.offsetHeight / 2) moveBy(row, 1);
      else if (previous && -shift > previous.offsetHeight / 2) moveBy(row, -1);
      else break;
      drag.startY += row.offsetTop - top;
      shift = event.clientY - drag.startY;
    }
    row.style.transform = `translateY(${shift}px)`;
  }

  function endDrag() {
    if (!drag) return;
    const { row } = drag;
    drag = null;
    row.classList.remove("is-dragging");
    listEl.classList.remove("is-sorting");
    row.style.transform = "";
    renumber();
  }

  /* -------------------------------- Result -------------------------------- */
  function resultHtml() {
    const them = escape(nameOf(other()));
    const res = data.result;
    const mine = data.mine;
    const theirs = data.theirs;
    const puzzle = data.puzzle || {};
    const rows = (data.answer || []).map((item, index) => {
      const minePlace = mine.placed.indexOf(index);
      const theirPlace = theirs ? theirs.placed.indexOf(index) : -1;
      const chip = (who, place) => `<span class="sort-chip${place === index ? " is-right" : ""}">${who}: ${place === index ? `${iconHtml("check")}right` : ORDINALS[place]}</span>`;
      return `<li class="sort-answer${minePlace === index ? " is-right" : ""}">
          <span class="sort-num">${index + 1}</span>
          <span class="sort-answer-copy"><strong>${escape(item.label)}</strong><small>${escape(item.shown)}</small></span>
          <span class="sort-chips">${chip("You", minePlace)}${theirs ? chip(them, theirPlace) : ""}</span>
        </li>`;
    }).join("");
    let head;
    if (!res) {
      head = `<div class="match-waiting"><span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">${mine.right} of ${count()} in the right place, in ${seconds(mine.ms)}</p>
          <p class="match-waiting-copy">Waiting for ${them} to play. Shh, no spoilers!</p></div></div>`;
    } else {
      const message = res.winner === "tie" ? "A perfect tie!" : res.winner === me() ? "You won today!" : `${them} won today!`;
      head = `<div class="match-score${res.right[me()] === count() ? " is-perfect" : ""}">
          <p class="quick-versus"><span class="${res.winner === me() ? "is-win" : ""}">${iconHtml("check")}You ${res.right[me()]}/${count()} · ${seconds(res.ms[me()])}</span><span class="${res.winner === other() ? "is-win" : ""}">${iconHtml("check")}${them} ${res.right[other()]}/${count()} · ${seconds(res.ms[other()])}</span></p>
          <p class="match-score-msg">${escape(message)}</p></div>`;
    }
    return `${head}<p class="sort-result-rule"><strong>${escape(puzzle.rule || "")}</strong>${escape(puzzle.about || "")}</p><ol class="sort-answers">${rows}</ol>`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    return `<div class="match-stat"><dt>Wins</dt><dd><strong>${Number(stats.wins?.[me()]) || 0} : ${Number(stats.wins?.[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Perfect</dt><dd><strong>${Number(stats.perfect?.[me()]) || 0} : ${Number(stats.perfect?.[other()]) || 0}</strong><small>all 5 in place</small></dd></div>
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
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : "Five things, one rule. Put them in the right order, fast.";
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
      statusEl.textContent = "Loading today’s five…";
      introEl.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/sort?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || playing || saving) return;
      data = result;
      if (!quiet) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "Sort it needs the latest server update first." : "Couldn’t load today’s five. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "sort") return;
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
    endDrag();
    playing = false;
    saving = false;
    window.cancelAnimationFrame(frame);
    data = null;
    order = [];
    drawn = { result: "", stats: "" };
    listEl.innerHTML = "";
    resultEl.innerHTML = "";
    statsEl.innerHTML = "";
    showError("");
    if (app()?.step === "sort") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  startButton.addEventListener("click", start);
  sendButton.addEventListener("click", finish);
  listEl.addEventListener("click", (event) => {
    const button = event.target.closest(".sort-move");
    if (!button || button.disabled || !playing || saving) return;
    const row = button.closest(".sort-item");
    moveBy(row, Number(button.dataset.move));
    // Keep the focus on the moved row's arrow (or the other one at the ends).
    const [up, down] = row.querySelectorAll(".sort-move");
    const same = Number(button.dataset.move) < 0 ? up : down;
    (same.disabled ? (same === up ? down : up) : same).focus({ preventScroll: true });
  });
  listEl.addEventListener("pointerdown", onPointerDown);
  listEl.addEventListener("pointermove", onPointerMove);
  listEl.addEventListener("pointerup", endDrag);
  listEl.addEventListener("pointercancel", endDrag);
  listEl.addEventListener("lostpointercapture", endDrag);
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
    if (event.detail.name === "sort") {
      load();
      startPolling();
    } else {
      endDrag();
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "sort") load({ quiet: true });
  });
})();
