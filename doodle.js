/*
 * Daily doodle: the same prompt for both of us each day. Each of us draws it once
 * with a finger (or mouse or pen) on a square pad; the strokes go to the Worker as
 * small vectors (x, y from 0 to 1000). The other's drawing only shows once you've
 * sent yours (the Worker enforces that too), then both sit side by side and can be
 * replayed stroke by stroke. Earlier days stay in a little gallery below.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="doodle"]');
  if (!section) return;

  const eyebrow = $("#doodle-eyebrow");
  const promptEl = $("#doodle-prompt");
  const statusEl = $("#doodle-status");
  const nudgeEl = $("#doodle-nudge");
  const board = $("#doodle-board");
  const canvas = $("#doodle-canvas");
  const padHint = $("#doodle-pad-hint");
  const colorsEl = $("#doodle-colors");
  const sizesEl = $("#doodle-sizes");
  const undoButton = $("#doodle-undo");
  const clearButton = $("#doodle-clear");
  const submitButton = $("#doodle-submit");
  const errorEl = $("#doodle-error");
  const resultEl = $("#doodle-result");
  const resultLine = $("#doodle-result-line");
  const pairEl = $("#doodle-pair");
  const replayButton = $("#doodle-replay");
  const galleryEl = $("#doodle-gallery");
  const daysEl = $("#doodle-days");
  const moreButton = $("#doodle-more");

  const POLL_MS = 12000;
  const SIZE = 1000;           // strokes are stored on a 1000 x 1000 grid
  const MAX_STROKES = 400;     // the Worker's limits
  const MAX_POINTS = 8000;
  const MIN_STEP = 4;          // points closer than this to the last one are skipped
  const WIDTHS = [9, 24];      // thin and thick pen, in grid units
  const REPLAY_MS = 3000;
  const GALLERY_STEP = 6;
  // Preview has its own draft, so a test drawing never ends up in the real letter.
  // (Read from the URL: app.js, and DateApp.preview with it, loads after this file.)
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview")
    ? "date-letter-doodle-draft-preview"
    : "date-letter-doodle-draft";
  const PALETTE = [
    { color: "#29252f", name: "Ink" },
    { color: "#dc4f83", name: "Pink" },
    { color: "#f28b30", name: "Orange" },
    { color: "#f2c641", name: "Yellow" },
    { color: "#2e9e83", name: "Green" },
    { color: "#3f7fd8", name: "Blue" }
  ];

  let data = null;             // GET /games/doodle for today
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let submitting = false;
  let strokes = [];            // the drawing on the pad
  let actions = [];            // undo history: "stroke", or { cleared: [...] } for Clear
  let current = null;          // the stroke under the finger
  let pointer = null;
  let pen = { color: PALETTE[0].color, width: 0 };
  let frame = 0;
  let replayFrame = 0;
  let replayed = "";           // the day whose reveal already played once
  let galleryShown = GALLERY_STEP;
  let galleryDrawn = "";
  let openDay = "";            // the earlier day opened in the gallery
  const pastDays = new Map();  // day -> GET answer (earlier days never change)
  const art = new Map();       // canvas key -> strokes, painted after each render

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const offline = (error, fallback) => (error.status ? error.message : fallback);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clamp = (value) => Math.max(0, Math.min(SIZE, Math.round(value)));
  const pointsIn = (list) => list.reduce((sum, stroke) => sum + stroke.p.length / 2, 0);
  const capital = (text) => String(text || "").charAt(0).toUpperCase() + String(text || "").slice(1);

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // The bell on the other phone (activity.js); never let it break the page.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  // The games hub (games.js): "+1 heart" and a fresh hub. Optional too.
  function rewarded(amount) {
    try { window.DateGames?.reward?.(amount); } catch { /* Optional. */ }
    try { window.DateGames?.refresh?.(); } catch { /* Optional. */ }
  }

  function shortDay(iso) {
    const [year, month, date] = String(iso).split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
      .format(new Date(Date.UTC(year, month - 1, date, 12)));
  }

  const doodlePath = (day = "") => `/games/doodle?author=${encodeURIComponent(me())}${day ? `&day=${encodeURIComponent(day)}` : ""}`;

  /* ------------------------------ Painting ------------------------------- */
  // Sizes the canvas bitmap to its box (sharp on Retina screens) and returns its context.
  function fit(target) {
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const size = Math.max(1, Math.round(target.clientWidth * ratio));
    if (target.width !== size || target.height !== size) {
      target.width = size;
      target.height = size;
    }
    return target.getContext("2d");
  }

  // One stroke through the midpoints of its points, so lines look smooth. `count` points only.
  function trace(context, stroke, count, scale) {
    const p = stroke.p;
    const width = WIDTHS[stroke.w] * scale;
    context.strokeStyle = stroke.c;
    context.fillStyle = stroke.c;
    context.lineWidth = width;
    context.lineCap = "round";
    context.lineJoin = "round";
    if (count < 2) {
      context.beginPath();
      context.arc(p[0] * scale, p[1] * scale, width / 2, 0, Math.PI * 2);
      context.fill();
      return;
    }
    context.beginPath();
    context.moveTo(p[0] * scale, p[1] * scale);
    for (let index = 1; index < count - 1; index += 1) {
      const x = p[index * 2] * scale;
      const y = p[index * 2 + 1] * scale;
      context.quadraticCurveTo(x, y, (x + p[index * 2 + 2] * scale) / 2, (y + p[index * 2 + 3] * scale) / 2);
    }
    context.lineTo(p[(count - 1) * 2] * scale, p[(count - 1) * 2 + 1] * scale);
    context.stroke();
  }

  // Draws `list` on `target`; `limit` stops after that many points (for the replay).
  function paint(target, list, limit = Infinity) {
    if (!target || !target.isConnected) return;
    const context = fit(target);
    const scale = target.width / SIZE;
    context.clearRect(0, 0, target.width, target.height);
    let left = limit;
    for (const stroke of list || []) {
      if (left <= 0) break;
      const count = Math.min(stroke.p.length / 2, left);
      trace(context, stroke, count, scale);
      left -= count;
    }
  }

  function paintPad() {
    frame = 0;
    paint(canvas, current ? [...strokes, current] : strokes);
  }

  function schedulePad() {
    if (!frame) frame = window.requestAnimationFrame(paintPad);
  }

  function paintArt(root = section) {
    root.querySelectorAll("canvas[data-art]").forEach((element) => paint(element, art.get(element.dataset.art)));
  }

  function stopReplay() {
    window.cancelAnimationFrame(replayFrame);
    replayFrame = 0;
  }

  // Redraws the drawings in `root` stroke by stroke, both finishing after about 3 seconds.
  function replay(root) {
    stopReplay();
    const items = [...root.querySelectorAll("canvas[data-art]")].map((element) => ({ element, list: art.get(element.dataset.art) || [] }));
    if (!items.length) return;
    if (reduced()) {
      items.forEach(({ element, list }) => paint(element, list));
      return;
    }
    const totals = items.map(({ list }) => pointsIn(list));
    const start = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - start) / REPLAY_MS);
      items.forEach(({ element, list }, index) => paint(element, list, Math.ceil(totals[index] * progress)));
      replayFrame = progress < 1 ? window.requestAnimationFrame(step) : 0;
    };
    items.forEach(({ element }) => paint(element, []));
    replayFrame = window.requestAnimationFrame(step);
  }

  /* ------------------------------- Drafts -------------------------------- */
  // The unsent drawing survives a reload (the Home Screen app can be closed any time).
  function saveDraft() {
    try {
      if (!strokes.length || !data) window.localStorage.removeItem(DRAFT_KEY);
      else window.localStorage.setItem(DRAFT_KEY, JSON.stringify({ day: data.day, author: me(), strokes }));
    } catch { /* Private browsing or full storage: the drawing just isn't kept. */ }
  }

  function loadDraft(day) {
    try {
      const draft = JSON.parse(window.localStorage.getItem(DRAFT_KEY) || "null");
      if (draft && draft.day === day && draft.author === me() && Array.isArray(draft.strokes)) {
        return draft.strokes.filter((stroke) => stroke && Array.isArray(stroke.p) && stroke.p.length >= 2 && PALETTE.some((item) => item.color === stroke.c) && (stroke.w === 0 || stroke.w === 1));
      }
    } catch { /* Ignore a broken draft. */ }
    return [];
  }

  function dropDraft() {
    try { window.localStorage.removeItem(DRAFT_KEY); } catch { /* Nothing to drop. */ }
  }

  /* ------------------------------- Drawing ------------------------------- */
  const canDraw = () => Boolean(data && !data.mine && !submitting && !board.hidden);

  function toPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return [clamp(((event.clientX - rect.left) / rect.width) * SIZE), clamp(((event.clientY - rect.top) / rect.height) * SIZE)];
  }

  function updateTools() {
    undoButton.disabled = !actions.length || submitting;
    clearButton.disabled = !strokes.length || submitting;
    submitButton.disabled = !strokes.length || submitting;
    const cleared = !strokes.length && actions.length && typeof actions[actions.length - 1] === "object";
    padHint.textContent = cleared ? "Cleared. Undo brings it back." : "Draw here with your finger";
    padHint.hidden = Boolean(strokes.length || current);
  }

  function addPoint(event) {
    const [x, y] = toPoint(event);
    const p = current.p;
    const lastX = p[p.length - 2];
    const lastY = p[p.length - 1];
    if (Math.hypot(x - lastX, y - lastY) < MIN_STEP) return true;
    if (pointsIn(strokes) + p.length / 2 >= MAX_POINTS) return false;
    p.push(x, y);
    return true;
  }

  function finishStroke() {
    if (current) {
      strokes.push(current);
      actions.push("stroke");
      current = null;
      saveDraft();
    }
    pointer = null;
    updateTools();
    schedulePad();
  }

  function showFull() {
    showError("That's all the ink for one doodle. Undo a line or send it.");
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!canDraw() || pointer !== null) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    if (strokes.length >= MAX_STROKES || pointsIn(strokes) >= MAX_POINTS) {
      showFull();
      return;
    }
    showError("");
    pointer = event.pointerId;
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic events. */ }
    const [x, y] = toPoint(event);
    current = { w: pen.width, c: pen.color, p: [x, y] };
    padHint.hidden = true;
    schedulePad();
  });

  canvas.addEventListener("pointermove", (event) => {
    if (event.pointerId !== pointer || !current) return;
    event.preventDefault();
    const events = typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [];
    for (const item of events.length ? events : [event]) {
      if (!addPoint(item)) {
        finishStroke();
        showFull();
        return;
      }
    }
    schedulePad();
  });

  const endStroke = (event) => {
    if (event.pointerId === pointer) finishStroke();
  };
  canvas.addEventListener("pointerup", endStroke);
  canvas.addEventListener("pointercancel", endStroke);
  canvas.addEventListener("lostpointercapture", endStroke);
  // iOS: a long press on the pad must not open the text magnifier or scroll the page.
  canvas.addEventListener("touchstart", (event) => { if (canDraw()) event.preventDefault(); }, { passive: false });
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  function undo() {
    const last = actions.pop();
    if (!last) return;
    if (last === "stroke") strokes.pop();
    else strokes = last.cleared;
    showError("");
    saveDraft();
    updateTools();
    schedulePad();
  }

  function clearPad() {
    if (!strokes.length) return;
    actions.push({ cleared: strokes });
    strokes = [];
    showError("");
    saveDraft();
    updateTools();
    schedulePad();
  }

  function renderTools() {
    // PALETTE is our own fixed list, so it needs no escaping (and DateApp may not exist yet).
    colorsEl.innerHTML = PALETTE.map((item) => `<button class="doodle-color" type="button" role="radio" aria-checked="${item.color === pen.color}" aria-label="${item.name}" data-color="${item.color}" style="--swatch: ${item.color}"></button>`).join("");
    sizesEl.querySelectorAll("[data-width]").forEach((button) => {
      button.setAttribute("aria-checked", String(Number(button.dataset.width) === pen.width));
    });
    sizesEl.style.setProperty("--pen", pen.color);
  }

  /* ------------------------------- Render -------------------------------- */
  function cellHtml(entry, who, key, { past }) {
    const mine = who === me();
    const drawing = mine ? entry.mine : entry.theirs;
    const label = mine ? "You" : nameOf(who);
    let body;
    if (drawing) {
      art.set(`${key}:${who}`, drawing.strokes);
      const name = mine ? "Your drawing" : `${nameOf(who)}’s drawing`;
      body = `<canvas class="doodle-art" data-art="${escape(`${key}:${who}`)}" role="img" aria-label="${escape(name)}"></canvas>`;
    } else if (mine) {
      body = `<span class="doodle-empty"><i class="icon" data-lucide="pencil-off" aria-hidden="true"></i><span>${past ? "You didn’t draw this one" : "Yours shows up here"}</span></span>`;
    } else if (!entry.mine && entry.theirsDone) {
      body = `<span class="doodle-empty is-locked"><i class="icon" data-lucide="lock-keyhole" aria-hidden="true"></i><span>${past ? "Hidden, you didn’t draw" : "Draw yours to see it"}</span></span>`;
    } else {
      body = `<span class="doodle-empty"><i class="icon" data-lucide="${past ? "pencil-off" : "hourglass"}" aria-hidden="true"></i><span>${past ? "Didn’t draw this one" : `Waiting for ${escape(nameOf(who))}`}</span></span>`;
    }
    return `<figure class="doodle-cell${mine ? " is-mine" : ""}${drawing ? "" : " is-empty"}">${body}<figcaption>${escape(label)}</figcaption></figure>`;
  }

  // Both drawings side by side, always Dee first and then her, so both phones look alike.
  const pairHtml = (entry, key, options) => ["sender", "her"].map((who) => cellHtml(entry, who, key, options)).join("");

  function renderHead() {
    eyebrow.textContent = "Today’s doodle";
    promptEl.textContent = data ? `Draw ${data.prompt}` : "Draw it!";
  }

  function renderNudge() {
    const show = Boolean(data && !data.mine && data.theirsDone);
    nudgeEl.hidden = !show;
    const text = `${nameOf(other())} already drew theirs. Draw yours to see it.`;
    if (show && nudgeEl.dataset.text !== text) {
      nudgeEl.dataset.text = text;
      nudgeEl.innerHTML = `<i class="icon" data-lucide="lock-keyhole" aria-hidden="true"></i><span>${escape(text)}</span>`;
      icons(nudgeEl);
    }
  }

  let pairDrawn = "";
  function renderResult() {
    const show = Boolean(data?.mine);
    resultEl.hidden = !show;
    if (!show) {
      pairDrawn = "";
      return;
    }
    const both = Boolean(data.theirs);
    resultLine.textContent = both ? "Both drawings are ready" : `Sent! Now it’s ${nameOf(other())}’s turn.`;
    resultLine.classList.toggle("is-both", both);
    replayButton.hidden = !both;
    const signature = `${data.day}:${data.mine?.at}:${data.theirs?.at || ""}`;
    if (signature !== pairDrawn) {
      pairEl.innerHTML = pairHtml(data, `today-${data.day}`, { past: false });
      pairDrawn = signature;
      icons(pairEl);
      paintArt(pairEl);
      // The moment both are there: play it once.
      if (both && replayed !== data.day) {
        replayed = data.day;
        window.requestAnimationFrame(() => replay(pairEl));
      }
    }
  }

  function renderBoard() {
    const drawing = Boolean(data && !data.mine);
    const wasHidden = board.hidden;
    board.hidden = !drawing;
    if (drawing && wasHidden) window.requestAnimationFrame(paintPad);
    updateTools();
  }

  function dayItemHtml(item) {
    const open = openDay === item.day;
    const who = item.mine && item.theirs ? "Both drew"
      : item.mine ? "Only you drew"
        : item.theirs ? `Only ${nameOf(other())} drew` : "Nobody drew";
    const loaded = pastDays.get(item.day);
    let panel = "";
    if (open) {
      if (!loaded) panel = `<p class="doodle-day-loading">Loading…</p>`;
      else if (loaded.error) panel = `<p class="error">${escape(loaded.error)}</p>`;
      else {
        panel = `<div class="doodle-pair is-compact">${pairHtml(loaded, `day-${item.day}`, { past: true })}</div>`
          + (loaded.mine && loaded.theirs ? `<button class="doodle-mini-replay" type="button" data-replay="${escape(item.day)}"><i class="icon" data-lucide="play" aria-hidden="true"></i><span>Replay</span></button>` : "");
      }
    }
    return `<li class="doodle-day${open ? " is-open" : ""}">
        <button class="doodle-day-head" type="button" aria-expanded="${open}" data-day="${escape(item.day)}">
          <span class="doodle-day-icon" aria-hidden="true"><i class="icon" data-lucide="${item.mine && item.theirs ? "brush" : "pencil-line"}"></i></span>
          <span class="doodle-day-copy"><small>${escape(shortDay(item.day))} · ${escape(who)}</small><strong>${escape(capital(item.prompt))}</strong></span>
          <i class="icon doodle-day-chevron" data-lucide="chevron-down" aria-hidden="true"></i>
        </button>
        ${open ? `<div class="doodle-day-panel" data-panel="${escape(item.day)}">${panel}</div>` : ""}
      </li>`;
  }

  function renderGallery(force = false) {
    const items = (Array.isArray(data?.history) ? data.history : []).filter((item) => item.day !== data.day);
    galleryEl.hidden = !items.length;
    const shown = items.slice(0, Math.max(galleryShown, items.findIndex((item) => item.day === openDay) + 1));
    const html = shown.map(dayItemHtml).join("");
    const more = items.length - shown.length;
    moreButton.hidden = more <= 0;
    moreButton.textContent = `Show ${Math.min(more, GALLERY_STEP)} more`;
    if (html === galleryDrawn && !force) return;
    const focused = document.activeElement?.closest?.("[data-day]")?.dataset.day;
    daysEl.innerHTML = html;
    galleryDrawn = html;
    icons(daysEl);
    paintArt(daysEl);
    if (focused) daysEl.querySelector(`[data-day="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  function render() {
    if (!data) return;
    statusEl.hidden = true;
    renderHead();
    renderNudge();
    renderBoard();
    renderResult();
    renderGallery();
  }

  /* -------------------------------- Sync --------------------------------- */
  function apply(next) {
    const dayChanged = !data || data.day !== next.day;
    data = next;
    if (dayChanged && !next.mine) {
      // A new day (or the first load): pick up an unsent drawing of that day, if any.
      if (!strokes.length) {
        strokes = loadDraft(next.day);
        actions = strokes.map(() => "stroke");
      } else {
        saveDraft();
      }
    }
    if (next.mine) {
      // Sent (maybe from another phone): nothing left to draw today.
      if (strokes.length) dropDraft();
      strokes = [];
      actions = [];
      current = null;
      pointer = null;
    }
    render();
  }

  async function load({ quiet = false } = {}) {
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s doodle…";
    }
    try {
      const next = await app().apiRequest(doodlePath());
      if (seq !== loadSeq || identity !== identitySeq || submitting) return;
      apply(next);
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      board.hidden = true;
      resultEl.hidden = true;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404
        ? "The daily doodle needs the latest server update first."
        : "Couldn’t load today’s doodle. Check your connection and try again.";
    }
  }

  async function loadDay(day) {
    const identity = identitySeq;
    try {
      const entry = await app().apiRequest(doodlePath(day));
      if (identity !== identitySeq) return;
      pastDays.set(day, entry);
    } catch (error) {
      if (identity !== identitySeq) return;
      pastDays.set(day, { error: offline(error, "Couldn’t load that day. Check your connection and try again.") });
      // Let a later tap try again.
      window.setTimeout(() => { if (pastDays.get(day)?.error) pastDays.delete(day); }, 4000);
    }
    if (openDay === day) renderGallery(true);
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "doodle") return;
      load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------- Submit -------------------------------- */
  function setSubmitLabel() {
    submitButton.innerHTML = submitting
      ? "Sending…"
      : `Done drawing <i class="icon" data-lucide="check" aria-hidden="true"></i>`;
    if (!submitting) icons(submitButton);
  }

  async function submit() {
    if (current) finishStroke();
    if (submitting || !data || data.mine || !strokes.length) return;
    const author = me();
    const identity = identitySeq;
    const prompt = data.prompt;
    submitting = true;
    loadSeq += 1;
    showError("");
    setSubmitLabel();
    updateTools();
    try {
      const next = await app().apiRequest("/games/doodle", "POST", { author, day: data.day, strokes });
      if (identity !== identitySeq) return;
      dropDraft();
      submitting = false;
      apply(next);
      rewarded(next.awarded);
      postActivity(next.theirs
        ? { kind: "doodle.drawn", text: "drew today’s doodle", detail: "Both drawings are ready", step: "doodle", icon: "brush", push: true }
        : { kind: "doodle.drawn", text: "drew today’s doodle", detail: capital(prompt), step: "doodle", icon: "brush", push: true });
      if (!reduced()) window.LetterFX?.burstFrom?.(resultEl, next.theirs ? 26 : 14);
      window.LetterFX?.chime?.();
      resultEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      submitting = false;
      showError(offline(error, "Couldn’t send your drawing. Check your connection and try again."));
      // A new day started, or it was already sent from another phone: show what's true now.
      if (error.status === 409) load({ quiet: true });
    } finally {
      submitting = false;
      setSubmitLabel();
      updateTools();
    }
  }

  /* ------------------------------- Wiring -------------------------------- */
  function resetIdentity() {
    identitySeq += 1;
    loadSeq += 1;
    stopReplay();
    data = null;
    strokes = [];
    actions = [];
    current = null;
    pointer = null;
    submitting = false;
    replayed = "";
    openDay = "";
    galleryShown = GALLERY_STEP;
    galleryDrawn = "";
    pairDrawn = "";
    pastDays.clear();
    art.clear();
    pairEl.innerHTML = "";
    daysEl.innerHTML = "";
    board.hidden = true;
    resultEl.hidden = true;
    galleryEl.hidden = true;
    nudgeEl.hidden = true;
    showError("");
    renderHead();
    if (app()?.step === "doodle") load();
  }
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });

  colorsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    pen = { ...pen, color: button.dataset.color };
    renderTools();
    colorsEl.querySelector(`[data-color="${CSS.escape(pen.color)}"]`)?.focus({ preventScroll: true });
  });
  sizesEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-width]");
    if (!button) return;
    pen = { ...pen, width: Number(button.dataset.width) === 1 ? 1 : 0 };
    renderTools();
  });
  // Arrow keys move through the colours, like a radio group.
  colorsEl.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const index = PALETTE.findIndex((item) => item.color === pen.color);
    const step = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1;
    pen = { ...pen, color: PALETTE[(index + step + PALETTE.length) % PALETTE.length].color };
    renderTools();
    colorsEl.querySelector(`[data-color="${CSS.escape(pen.color)}"]`)?.focus();
  });
  undoButton.addEventListener("click", undo);
  clearButton.addEventListener("click", clearPad);
  submitButton.addEventListener("click", submit);
  replayButton.addEventListener("click", () => replay(pairEl));
  moreButton.addEventListener("click", () => {
    galleryShown += GALLERY_STEP;
    renderGallery(true);
  });
  daysEl.addEventListener("click", (event) => {
    const replayDay = event.target.closest("[data-replay]");
    if (replayDay) {
      const panel = daysEl.querySelector(`[data-panel="${CSS.escape(replayDay.dataset.replay)}"]`);
      if (panel) replay(panel);
      return;
    }
    const head = event.target.closest(".doodle-day-head");
    if (!head) return;
    const day = head.dataset.day;
    stopReplay();
    openDay = openDay === day ? "" : day;
    renderGallery(true);
    if (openDay && !pastDays.has(day)) loadDay(day);
  });

  // Keep drawings sharp when the phone turns or the window resizes.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (app()?.step !== "doodle") return;
      stopReplay();
      paintPad();
      paintArt();
    }, 120);
  });

  document.addEventListener("date:step", (event) => {
    const { name } = event.detail;
    if (name === "doodle") {
      load();
      startPolling();
      // The step was hidden until now, so the canvases had no size yet.
      window.requestAnimationFrame(() => {
        paintPad();
        paintArt();
      });
    } else {
      stopPolling();
      stopReplay();
      if (current) finishStroke();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "doodle") load({ quiet: true });
  });

  renderTools();
  setSubmitLabel();
  updateTools();
})();
