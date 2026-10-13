/*
 * Question of the day: one question for both of us each day. The Worker picks
 * it the first time either of us opens that day (our own queued questions
 * first, then its built-in list) and never changes it. Each of us answers; the
 * other's answer only shows once you've answered yourself (the Worker enforces
 * that too). Earlier days stay below with the same rule, and either of us can
 * queue our own questions. Also keeps the "Question" tile on the plan page fresh.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="question"]');
  if (!section) return;

  const heading = $("#question-heading");
  const dayEl = $("#question-day");
  const statusEl = $("#question-status");
  const todayEl = $("#question-today");
  const lockEl = $("#question-lock");
  const form = $("#question-form");
  const answerInput = $("#question-answer");
  const countEl = $("#question-count");
  const cancelButton = $("#question-cancel");
  const submitButton = $("#question-submit");
  const errorEl = $("#question-error");
  const answersEl = $("#question-answers");
  const historyWrap = $("#question-history");
  const historyList = $("#question-history-list");
  const customForm = $("#question-custom-form");
  const customInput = $("#question-custom-input");
  const customError = $("#question-custom-error");
  const customList = $("#question-custom-list");
  const customTheirs = $("#question-custom-theirs");
  const tile = $("#question-tile");
  const tileNote = $("#question-tile-note");

  const POLL_MS = 15000;
  const TILE_MS = 60000;   // the plan page asks at most once a minute
  const MAX_ANSWER = 500;
  const MAX_QUESTION = 200;
  const HISTORY_STEP = 5;
  const LONG_ANSWER = 160; // longer answers stack instead of sitting in two narrow columns

  let today = null;        // GET /question answer for `day`
  let day = "";
  let editing = false;     // "Update my answer" form open
  let saving = false;
  let loadSeq = 0;         // bumps per request, so an older answer can't overwrite a newer one
  let pollTimer = null;
  let tileAskedAt = 0;
  let custom = [];
  let customLoaded = false;
  let customBusy = false;
  let historyOpen = "";    // the earlier day being answered right now
  let historyShown = HISTORY_STEP;
  let historyDrawn = "";
  let answersDrawn = "";
  const drafts = {};       // earlier day -> unsent text

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const time = (iso) => Date.parse(iso) || 0;
  const clean = (text) => String(text || "").trim().replace(/[ \t]+/g, " ");
  const offline = (error, fallback) => (error.status ? error.message : fallback);
  const isLong = (item) => [item?.mine?.text, item?.theirs?.text].some((text) => String(text || "").length > LONG_ANSWER);

  function showError(element, message) {
    element.textContent = message || "";
    element.hidden = !message;
  }

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // The bell on the other phone (activity.js); never let it break the page.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  function shortDay(iso) {
    const [year, month, date] = String(iso).split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
      .format(new Date(Date.UTC(year, month - 1, date, 12)));
  }

  const questionPath = (forDay) => `/question?day=${encodeURIComponent(forDay)}&author=${encodeURIComponent(me())}`;

  /* -------------------------------- Tile --------------------------------- */
  function updateTile(data) {
    if (!tileNote) return;
    const nudge = Boolean(data && !data.mine && data.theirsAnswered);
    let note = "Answer today’s";
    if (nudge) note = `${nameOf(other())} answered`;
    else if (data?.mine) note = data.theirsAnswered ? "See both answers" : "You answered";
    tileNote.textContent = note;
    tile?.classList.toggle("has-news", nudge);
  }

  // Cheap check for the plan page tile: one GET, at most once a minute.
  async function refreshTile({ force = false } = {}) {
    if (!tileNote || document.hidden) return;
    if (!force && Date.now() - tileAskedAt < TILE_MS) return;
    tileAskedAt = Date.now();
    try {
      const data = await app().apiRequest(questionPath(app().todayISO()));
      if (data && data.day === app().todayISO()) updateTile(data);
    } catch { /* Keep the last text. */ }
  }

  /* ------------------------------- Render -------------------------------- */
  // Both answers side by side, always Dee first and then her, so both phones look alike.
  function pairHtml(item, { forToday }) {
    return ["sender", "her"].map((who) => {
      const mine = who === me();
      const entry = mine ? item.mine : item.theirs;
      let body;
      if (entry?.text) body = `<p class="answer-text">${escape(entry.text)}</p>`;
      else if (mine) body = `<p class="answer-wait">${forToday ? "Your answer shows up here" : "You didn’t answer this one"}</p>`;
      else if (!item.mine && item.theirsAnswered) body = `<p class="answer-wait is-locked"><i class="icon" data-lucide="lock-keyhole" aria-hidden="true"></i><span>Answer to see theirs</span></p>`;
      else body = `<p class="answer-wait"><i class="icon" data-lucide="hourglass" aria-hidden="true"></i><span>Hasn’t answered yet</span></p>`;
      const edit = forToday && mine && entry?.text
        ? `<button class="answer-edit" type="button" data-edit><i class="icon" data-lucide="pencil" aria-hidden="true"></i><span>Edit</span></button>`
        : "";
      const you = mine ? ' <span class="answer-you">you</span>' : "";
      return `<article class="answer-card${mine ? " is-mine" : ""}${entry?.text ? "" : " is-empty"}">
        <p class="answer-who">${escape(nameOf(who))}${you}</p>${body}${edit}</article>`;
    }).join("");
  }

  function setSubmitLabel() {
    const label = saving ? (today?.mine ? "Updating…" : "Saving…") : (today?.mine ? "Update my answer" : "Answer");
    submitButton.innerHTML = saving ? escape(label) : `${escape(label)} <i class="icon" data-lucide="send" aria-hidden="true"></i>`;
    if (!saving) icons(submitButton);
  }

  function updateCount() {
    const length = answerInput.value.length;
    countEl.textContent = `${length} / ${MAX_ANSWER}`;
    countEl.classList.toggle("is-near", length > MAX_ANSWER - 50);
  }

  function renderToday() {
    if (!today) return;
    heading.textContent = today.question;
    dayEl.textContent = today.source === "custom"
      ? `${app().formatDate(today.day)} · one of our own questions`
      : app().formatDate(today.day);
    statusEl.hidden = true;
    todayEl.hidden = false;
    const answered = Boolean(today.mine);
    form.hidden = answered && !editing;
    cancelButton.hidden = !editing;
    lockEl.hidden = answered;
    const lock = today.theirsAnswered
      ? `${nameOf(other())} already answered. Answer to see theirs.`
      : "Answers stay private until you’ve both answered.";
    if (lockEl.dataset.text !== lock) {
      lockEl.dataset.text = lock;
      lockEl.innerHTML = `<i class="icon" data-lucide="${today.theirsAnswered ? "lock-keyhole" : "eye-off"}" aria-hidden="true"></i><span>${escape(lock)}</span>`;
      icons(lockEl);
    }
    lockEl.classList.toggle("is-nudge", Boolean(today.theirsAnswered));
    setSubmitLabel();
    const html = pairHtml(today, { forToday: true });
    if (html !== answersDrawn) {
      const hadFocus = answersEl.contains(document.activeElement);
      answersEl.innerHTML = html;
      answersDrawn = html;
      icons(answersEl);
      if (hadFocus) answersEl.querySelector("[data-edit]")?.focus({ preventScroll: true });
    }
    answersEl.classList.toggle("is-revealed", Boolean(today.mine && today.theirs));
    answersEl.classList.toggle("is-long", isLong(today));
    updateTile(today);
  }

  function historyCardHtml(item) {
    const answering = historyOpen === item.day;
    let action = "";
    if (!item.mine && answering) {
      const id = `question-answer-${item.day}`;
      action = `<form class="history-form" data-day="${escape(item.day)}" novalidate>
          <label class="visually-hidden" for="${escape(id)}">Your answer</label>
          <textarea id="${escape(id)}" rows="2" maxlength="${MAX_ANSWER}" placeholder="Better late than never…">${escape(drafts[item.day] || "")}</textarea>
          <p class="error" role="alert" hidden></p>
          <div class="history-form-foot">
            <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
            <button class="btn btn-primary" type="submit">Save</button>
          </div>
        </form>`;
    } else if (!item.mine) {
      action = `<button class="history-answer" type="button" data-open="${escape(item.day)}"><i class="icon" data-lucide="pen-line" aria-hidden="true"></i><span>Answer this one</span></button>`;
    }
    return `<article class="history-card" data-day="${escape(item.day)}">
        <p class="history-day">${escape(shortDay(item.day))}</p>
        <p class="history-question">${escape(item.question)}</p>
        <div class="answer-pair is-compact${isLong(item) ? " is-long" : ""}">${pairHtml(item, { forToday: false })}</div>
        ${action}
      </article>`;
  }

  // Redrawn only when something changed, and never while an earlier answer is being typed.
  function renderHistory(force = false) {
    const history = Array.isArray(today?.history) ? today.history : [];
    historyWrap.hidden = !history.length;
    if (historyOpen && !force) return;
    const shown = history.slice(0, historyShown);
    const more = history.length - shown.length;
    const html = shown.map(historyCardHtml).join("")
      + (more > 0 ? `<button class="btn btn-secondary history-more" type="button" data-more>Show ${Math.min(more, HISTORY_STEP * 2)} more</button>` : "");
    if (html === historyDrawn && !force) return;
    historyList.innerHTML = html;
    historyDrawn = html;
    icons(historyList);
  }

  function render() {
    renderToday();
    renderHistory();
  }

  function renderCustom() {
    const waiting = custom.filter((item) => !item.usedOn).sort((a, b) => time(a.at) - time(b.at));
    const mine = waiting.filter((item) => item.author === me());
    const theirs = waiting.length - mine.length;
    customList.innerHTML = mine.map((item) => {
      const next = waiting[0]?.id === item.id;
      return `<li class="custom-item${item.pending ? " is-pending" : ""}" data-id="${escape(item.id)}">
          <span class="custom-copy"><strong>${escape(item.text)}</strong><small${next ? ' class="is-next"' : ""}>${next ? "Up next" : "Waiting its turn"}</small></span>
          <button class="planner-icon-btn" type="button" aria-label="Remove ${escape(item.text)}" data-remove${item.pending ? " disabled" : ""}><i class="icon" data-lucide="x" aria-hidden="true"></i></button>
        </li>`;
    }).join("");
    icons(customList);
    customTheirs.hidden = !theirs;
    customTheirs.textContent = theirs === 1
      ? `${nameOf(other())} queued a question too. It stays a surprise.`
      : `${nameOf(other())} queued ${theirs} questions too. They stay a surprise.`;
  }

  /* ------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    const now = app().todayISO();
    // A new day shows its question, unless an answer is half-written for the old one.
    if (day !== now && (!day || (!clean(answerInput.value) && !editing && !historyOpen))) {
      day = now;
      editing = false;
      historyShown = HISTORY_STEP;
    }
    const seq = loadSeq += 1;
    if (!today && !quiet) {
      todayEl.hidden = true;
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s question…";
    }
    try {
      const data = await app().apiRequest(questionPath(day));
      if (seq !== loadSeq || saving) return;
      today = data;
      if (!quiet) showError(errorEl, "");
      render();
    } catch (error) {
      if (seq !== loadSeq || (today && quiet)) return;
      if (today) return;
      heading.textContent = "Today’s question";
      dayEl.textContent = "";
      todayEl.hidden = true;
      historyWrap.hidden = true;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404
        ? "The daily question needs the latest server update first."
        : "Couldn’t load today’s question. Check your connection and try again.";
    }
  }

  async function loadCustom({ quiet = false } = {}) {
    try {
      const data = await app().apiRequest("/question/custom");
      if (customBusy) return;
      custom = Array.isArray(data.custom) ? data.custom : [];
      customLoaded = true;
      if (!quiet) showError(customError, "");
      renderCustom();
    } catch (error) {
      if (quiet || customLoaded || error.status === 404) return;
      showError(customError, "Couldn’t load our queued questions. Check your connection and try again.");
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "question") return;
      load({ quiet: true });
      loadCustom({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------ Actions -------------------------------- */
  async function submitAnswer(event) {
    event.preventDefault();
    if (saving || !today) return;
    const text = answerInput.value.trim();
    if (!text) {
      showError(errorEl, "Write your answer first.");
      answerInput.focus();
      return;
    }
    if (text.length > MAX_ANSWER) {
      showError(errorEl, `Keep it under ${MAX_ANSWER} characters.`);
      return;
    }
    if (editing && text === today.mine?.text) {
      stopEditing();
      return;
    }
    const first = !today.mine;
    const question = today.question;
    showError(errorEl, "");
    saving = true;
    loadSeq += 1;
    submitButton.disabled = true;
    cancelButton.disabled = true;
    setSubmitLabel();
    try {
      const data = await app().apiRequest("/question", "POST", { action: "answer", day: today.day, author: me(), text });
      today = data;
      editing = false;
      answerInput.value = "";
      updateCount();
      saving = false;
      render();
      if (first) {
        postActivity({ kind: "question.answer", text: "answered today’s question", detail: question, step: "question", icon: "message-circle-heart", push: true });
        window.LetterFX?.burstFrom?.(answersEl, today.theirs ? 26 : 14);
        window.LetterFX?.chime?.();
      }
      answersEl.querySelector(".answer-card.is-mine")?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } catch (error) {
      showError(errorEl, offline(error, "Couldn’t save your answer. Check your connection and try again."));
    } finally {
      saving = false;
      submitButton.disabled = false;
      cancelButton.disabled = false;
      setSubmitLabel();
    }
  }

  function startEditing() {
    if (!today?.mine) return;
    editing = true;
    answerInput.value = today.mine.text;
    updateCount();
    showError(errorEl, "");
    renderToday();
    answerInput.focus();
    answerInput.setSelectionRange(answerInput.value.length, answerInput.value.length);
  }

  function stopEditing() {
    editing = false;
    answerInput.value = "";
    updateCount();
    showError(errorEl, "");
    renderToday();
    answersEl.querySelector("[data-edit]")?.focus({ preventScroll: true });
  }

  async function submitHistory(formEl) {
    const forDay = formEl.dataset.day;
    const textarea = formEl.querySelector("textarea");
    const errorBox = formEl.querySelector(".error");
    const button = formEl.querySelector('[type="submit"]');
    const text = textarea.value.trim();
    if (!text) {
      showError(errorBox, "Write your answer first.");
      textarea.focus();
      return;
    }
    showError(errorBox, "");
    button.disabled = true;
    button.textContent = "Saving…";
    try {
      const data = await app().apiRequest("/question", "POST", { action: "answer", day: forDay, author: me(), text });
      const item = today?.history?.find((entry) => entry.day === forDay);
      if (item) Object.assign(item, { mine: data.mine, theirs: data.theirs, theirsAnswered: data.theirsAnswered });
      delete drafts[forDay];
      historyOpen = "";
      renderHistory(true);
      postActivity({ kind: "question.answer", text: "answered an earlier question", detail: data.question, step: "question", icon: "message-circle-heart", push: false });
    } catch (error) {
      showError(errorBox, offline(error, "Couldn’t save your answer. Check your connection and try again."));
      button.disabled = false;
      button.textContent = "Save";
    }
  }

  async function addCustom(event) {
    event.preventDefault();
    if (customBusy) return;
    const text = clean(customInput.value);
    if (!text) {
      showError(customError, "Type a question first.");
      customInput.focus();
      return;
    }
    if (text.length > MAX_QUESTION) {
      showError(customError, `Keep it under ${MAX_QUESTION} characters.`);
      return;
    }
    showError(customError, "");
    const button = customForm.querySelector('[type="submit"]');
    const before = custom;
    customBusy = true;
    button.disabled = true;
    custom = [...custom, { id: "temp-question", text, author: me(), at: new Date().toISOString(), usedOn: null, pending: true }];
    customInput.value = "";
    renderCustom();
    try {
      const data = await app().apiRequest("/question", "POST", { action: "custom", text, author: me() });
      custom = Array.isArray(data.custom) ? data.custom : before;
    } catch (error) {
      custom = before;
      if (!customInput.value) customInput.value = text;
      showError(customError, offline(error, "Couldn’t add that. Check your connection and try again."));
    } finally {
      customBusy = false;
      button.disabled = false;
      renderCustom();
    }
  }

  async function removeCustom(id) {
    if (customBusy) return;
    const before = custom;
    customBusy = true;
    custom = custom.filter((item) => item.id !== id);
    renderCustom();
    showError(customError, "");
    try {
      const data = await app().apiRequest("/question", "POST", { action: "uncustom", id });
      custom = Array.isArray(data.custom) ? data.custom : custom;
    } catch (error) {
      custom = before;
      showError(customError, offline(error, "Couldn’t remove that. Check your connection and try again."));
    } finally {
      customBusy = false;
      renderCustom();
    }
  }

  /* ------------------------------- Wiring -------------------------------- */
  form.addEventListener("submit", submitAnswer);
  answerInput.addEventListener("input", updateCount);
  cancelButton.addEventListener("click", stopEditing);
  answersEl.addEventListener("click", (event) => {
    if (event.target.closest("[data-edit]")) startEditing();
  });
  historyList.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-open]")) {
      historyOpen = button.dataset.open;
      renderHistory(true);
      historyList.querySelector(".history-form textarea")?.focus();
    } else if (button.matches("[data-cancel]")) {
      const openDay = historyOpen;
      historyOpen = "";
      renderHistory(true);
      historyList.querySelector(`[data-open="${CSS.escape(openDay)}"]`)?.focus();
    } else if (button.matches("[data-more]")) {
      historyShown += HISTORY_STEP * 2;
      renderHistory(true);
    }
  });
  historyList.addEventListener("input", (event) => {
    const formEl = event.target.closest(".history-form");
    if (formEl) drafts[formEl.dataset.day] = event.target.value;
  });
  historyList.addEventListener("submit", (event) => {
    event.preventDefault();
    const formEl = event.target.closest(".history-form");
    if (formEl) submitHistory(formEl);
  });
  customForm.addEventListener("submit", addCustom);
  customList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove]");
    const row = button?.closest(".custom-item");
    if (row && !button.disabled) removeCustom(row.dataset.id);
  });

  document.addEventListener("date:step", (event) => {
    const { name } = event.detail;
    if (name === "question") {
      load();
      loadCustom();
      startPolling();
    } else {
      stopPolling();
    }
    if (name === "planned") refreshTile();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (app()?.step === "question") {
      load({ quiet: true });
      loadCustom({ quiet: true });
    } else if (app()?.step === "planned") {
      refreshTile();
    }
  });
})();
