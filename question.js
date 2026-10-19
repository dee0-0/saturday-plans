/*
 * Question of the day: one question for both of us each day. The Worker picks
 * it the first time either of us opens that day (our own queued questions
 * first, then its built-in list) and never changes it. Each of us answers; the
 * other's answer only shows once you've answered yourself (the Worker enforces
 * that too). Earlier days stay below with the same rule, and either of us can
 * queue our own questions. Also keeps the "Question" tile on the plan page fresh.
 *
 * Guess my answer: with your answer you can guess what the other one says (only
 * while their answer is still hidden from you). Once you both answered, each of
 * you judges the other's guess: Spot on (3 hearts for the guesser), Close (1) or
 * Not quite. Answers on earlier days can be edited too.
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
  const guessField = $("#question-guess-field");
  const guessInput = $("#question-guess");
  const guessLabel = $("#question-guess-label");
  const guessHint = $("#question-guess-hint");
  const cancelButton = $("#question-cancel");
  const submitButton = $("#question-submit");
  const errorEl = $("#question-error");
  const answersEl = $("#question-answers");
  const guessesEl = $("#question-guesses");
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
  const MAX_GUESS = 200;
  const MAX_QUESTION = 200;
  const HISTORY_STEP = 5;
  const LONG_ANSWER = 160; // longer answers stack instead of sitting in two narrow columns
  const VERDICTS = {
    spot: { label: "Spot on", icon: "sparkles", hearts: 3 },
    close: { label: "Close", icon: "thumbs-up", hearts: 1 },
    miss: { label: "Not quite", icon: "x", hearts: 0 }
  };

  let today = null;        // GET /question answer for `day`
  let day = "";
  let editing = false;     // "Update my answer" form open
  let saving = false;
  let loadSeq = 0;         // bumps per request, so an older answer can't overwrite a newer one
  let pollTimer = null;
  let tileAskedAt = 0;
  let custom = [];
  let customQueue = [];    // ids, owners and timestamps only; other queued text stays on the server
  let otherWaiting = 0;
  let customLoaded = false;
  let customBusy = false;
  let customLoadSeq = 0;
  let identitySeq = 0;
  let historyOpen = "";    // the earlier day being answered or edited right now
  let historyShown = HISTORY_STEP;
  let historyDrawn = "";
  let answersDrawn = "";
  let guessesDrawn = "";
  let judging = "";        // the day whose verdict is being saved
  const drafts = {};       // earlier day -> unsent answer text
  const guessDrafts = {};  // earlier day -> unsent guess
  const judgeErrors = {};  // day -> last verdict error

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const time = (iso) => Date.parse(iso) || 0;
  const clean = (text) => String(text || "").trim().replace(/[ \t]+/g, " ");
  const oneLine = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const offline = (error, fallback) => (error.status ? error.message : fallback);
  const isLong = (item) => [item?.mine?.text, item?.theirs?.text].some((text) => String(text || "").length > LONG_ANSWER);
  // The guess can only be set or changed while their answer is still hidden from me.
  const canGuess = (item) => !item?.mine || !item?.theirsAnswered;
  const games = () => window.DateGames || null;
  const iconHtml = (name) => `<i class="icon" data-lucide="${name}" aria-hidden="true"></i>`;

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

  // "Guess what <name> will answer" before they did, "answered" after.
  const guessPrompt = (item) => `Guess what ${nameOf(other())} ${item?.theirsAnswered ? "answered" : "will answer"}`;

  /* -------------------------------- Tile --------------------------------- */
  function updateTile(data) {
    if (!tileNote) return;
    const nudge = Boolean(data && !data.mine && data.theirsAnswered);
    const judge = Boolean(data?.mine && data?.theirs?.guess && !data?.verdicts?.theirs);
    let note = "Answer today’s";
    if (nudge) note = `${nameOf(other())} answered`;
    else if (judge) note = `Rate ${nameOf(other())}’s guess`;
    else if (data?.mine) note = data.theirsAnswered ? "See both answers" : "You answered";
    tileNote.textContent = note;
    tile?.classList.toggle("has-news", nudge || judge);
  }

  // Cheap check for the plan page tile: one GET, at most once a minute.
  async function refreshTile({ force = false } = {}) {
    if (!tileNote || document.hidden) return;
    if (!force && Date.now() - tileAskedAt < TILE_MS) return;
    tileAskedAt = Date.now();
    const identity = identitySeq;
    try {
      const data = await app().apiRequest(questionPath(app().todayISO()));
      if (identity !== identitySeq) return;
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
      else if (!item.mine && item.theirsAnswered) body = `<p class="answer-wait is-locked">${iconHtml("lock-keyhole")}<span>Answer to see theirs</span></p>`;
      else body = `<p class="answer-wait">${iconHtml("hourglass")}<span>Hasn’t answered yet</span></p>`;
      let edit = "";
      if (mine && entry?.text && (forToday || historyOpen !== item.day)) {
        const target = forToday ? "data-edit" : `data-edit-day="${escape(item.day)}"`;
        edit = `<button class="answer-edit" type="button" ${target}>${iconHtml("pencil")}<span>Edit</span></button>`;
      }
      const you = mine ? ' <span class="answer-you">you</span>' : "";
      return `<article class="answer-card${mine ? " is-mine" : ""}${entry?.text ? "" : " is-empty"}">
        <p class="answer-who">${escape(nameOf(who))}${you}</p>${body}${edit}</article>`;
    }).join("");
  }

  function verdictButtons(item) {
    const current = item.verdicts?.theirs || "";
    const busy = judging === item.day;
    return Object.entries(VERDICTS).map(([id, verdict]) => `<button class="guess-verdict is-${id}${current === id ? " is-chosen" : ""}" type="button" data-verdict="${id}" aria-pressed="${current === id}"${busy ? " disabled" : ""}>${iconHtml(verdict.icon)}<span>${verdict.label}</span></button>`).join("");
  }

  // Their guess about my answer (for me to judge) and my guess about theirs (with their verdict).
  function guessesHtml(item, { compact = false, score = null } = {}) {
    if (!item?.mine) return "";
    const them = escape(nameOf(other()));
    const cards = [];
    const revealed = Boolean(item.theirs);
    if (revealed && item.theirs.guess) {
      const verdict = VERDICTS[item.verdicts?.theirs];
      const error = judgeErrors[item.day];
      cards.push(`<div class="guess-card is-judge">
          <p class="guess-label">${iconHtml("target")}<span>${them} guessed you’d say</span></p>
          <p class="guess-text">${escape(item.theirs.guess)}</p>
          <p class="guess-ask">${verdict ? `You said: ${verdict.label}. Change it?` : "How close was it?"}</p>
          <div class="guess-verdicts" role="group" aria-label="How close was ${them}’s guess?">${verdictButtons(item)}</div>
          ${error ? `<p class="error" role="alert">${escape(error)}</p>` : ""}
        </div>`);
    }
    if (item.mine.guess) {
      let foot;
      if (!revealed) foot = `<p class="guess-foot">${iconHtml("eye-off")}<span>Hidden until ${them} answers.</span></p>`;
      else if (item.verdicts?.mine) {
        const verdict = VERDICTS[item.verdicts.mine];
        const hearts = verdict.hearts ? ` · +${verdict.hearts} ${verdict.hearts === 1 ? "heart" : "hearts"}` : "";
        foot = `<p class="guess-result is-${escape(item.verdicts.mine)}">${iconHtml(verdict.icon)}<span>${them}: ${verdict.label}${hearts}</span></p>`;
      } else {
        foot = `<p class="guess-foot">${iconHtml("hourglass")}<span>Waiting for ${them} to judge it</span></p>`;
      }
      cards.push(`<div class="guess-card is-mine">
          <p class="guess-label">${iconHtml("target")}<span>${revealed ? `You guessed ${them} would say` : "Your guess"}</span></p>
          <p class="guess-text">${escape(item.mine.guess)}</p>
          ${foot}
        </div>`);
    }
    let scoreHtml = "";
    if (score && (score.her || score.sender || cards.length)) {
      scoreHtml = `<p class="guess-score"><span class="guess-score-title">${iconHtml("target")}Guess points</span><span>You <b>${escape(score[me()] || 0)}</b></span><span>${them} <b>${escape(score[other()] || 0)}</b></span></p>`;
    }
    if (!cards.length && !scoreHtml) return "";
    return `<div class="guess-block${compact ? " is-compact" : ""}" data-day="${escape(item.day)}">${scoreHtml}${cards.join("")}</div>`;
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

  function renderGuessField() {
    const show = canGuess(today);
    guessField.hidden = !show;
    if (!show) return;
    guessLabel.textContent = guessPrompt(today);
    guessHint.textContent = `If ${nameOf(other())} says it’s spot on, you get 3 hearts.`;
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
    renderGuessField();
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
    const guesses = guessesHtml(today, { score: today.guessScore });
    if (guesses !== guessesDrawn) {
      const focused = document.activeElement?.closest?.("[data-verdict]")?.dataset.verdict;
      guessesEl.innerHTML = guesses;
      guessesDrawn = guesses;
      icons(guessesEl);
      if (focused) guessesEl.querySelector(`[data-verdict="${focused}"]`)?.focus({ preventScroll: true });
    }
    updateTile(today);
  }

  function historyFormHtml(item) {
    const id = `question-answer-${item.day}`;
    const guessId = `question-guess-${item.day}`;
    const editingOld = Boolean(item.mine);
    const text = drafts[item.day] ?? item.mine?.text ?? "";
    const guess = guessDrafts[item.day] ?? item.mine?.guess ?? "";
    const guessHtml = canGuess(item)
      ? `<div class="question-guess-field is-compact">
          <label for="${escape(guessId)}">${iconHtml("target")}<span>${escape(guessPrompt(item))}</span><small>optional</small></label>
          <input type="text" id="${escape(guessId)}" data-guess maxlength="${MAX_GUESS}" placeholder="I bet the answer is…" autocomplete="off" enterkeyhint="done" value="${escape(guess)}">
        </div>`
      : "";
    return `<form class="history-form" data-day="${escape(item.day)}" data-mode="${editingOld ? "edit" : "answer"}" novalidate>
        <label class="visually-hidden" for="${escape(id)}">Your answer</label>
        <textarea id="${escape(id)}" rows="2" maxlength="${MAX_ANSWER}" placeholder="Better late than never…">${escape(text)}</textarea>
        ${guessHtml}
        <p class="error" role="alert" hidden></p>
        <div class="history-form-foot">
          <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
          <button class="btn btn-primary" type="submit">${editingOld ? "Update" : "Save"}</button>
        </div>
      </form>`;
  }

  function historyCardHtml(item) {
    let action = "";
    if (historyOpen === item.day) action = historyFormHtml(item);
    else if (!item.mine) {
      action = `<button class="history-answer" type="button" data-open="${escape(item.day)}">${iconHtml("pen-line")}<span>Answer this one</span></button>`;
    }
    return `<article class="history-card" data-day="${escape(item.day)}">
        <p class="history-day">${escape(shortDay(item.day))}</p>
        <p class="history-question">${escape(item.question)}</p>
        <div class="answer-pair is-compact${isLong(item) ? " is-long" : ""}">${pairHtml(item, { forToday: false })}</div>
        ${action}
        ${guessesHtml(item, { compact: true })}
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
    const mine = custom.filter((item) => !item.usedOn && item.author === me())
      .sort((a, b) => time(a.at) - time(b.at) || String(a.id).localeCompare(String(b.id)));
    customList.innerHTML = mine.map((item) => {
      const next = customQueue[0]?.id === item.id;
      return `<li class="custom-item${item.pending ? " is-pending" : ""}" data-id="${escape(item.id)}">
          <span class="custom-copy"><strong>${escape(item.text)}</strong><small${next ? ' class="is-next"' : ""}>${next ? "Up next" : "Waiting its turn"}</small></span>
          <button class="planner-icon-btn" type="button" aria-label="Remove ${escape(item.text)}" data-remove${item.pending ? " disabled" : ""}><i class="icon" data-lucide="x" aria-hidden="true"></i></button>
        </li>`;
    }).join("");
    icons(customList);
    customTheirs.hidden = !otherWaiting;
    customTheirs.textContent = otherWaiting === 1
      ? `${nameOf(other())} queued a question too. It stays a surprise.`
      : `${nameOf(other())} queued ${otherWaiting} questions too. They stay a surprise.`;
  }

  function applyCustomView(data) {
    custom = Array.isArray(data.custom) ? data.custom.filter((item) => item.author === me()) : [];
    customQueue = Array.isArray(data.queue) ? data.queue : [];
    otherWaiting = Number.isInteger(data.otherWaiting) && data.otherWaiting >= 0 ? data.otherWaiting : 0;
  }

  const customSnapshot = () => ({ custom, queue: customQueue, otherWaiting });

  // A POST answer for an earlier day returns that day's view: copy it into the history item.
  function applyDayView(data) {
    if (data?.guessScore && today) today.guessScore = data.guessScore;
    if (today && data?.day === today.day) {
      const history = today.history;
      today = { ...data, history: Array.isArray(data.history) && data.history.length ? data.history : history };
      return;
    }
    const item = today?.history?.find((entry) => entry.day === data?.day);
    if (item) Object.assign(item, { mine: data.mine, theirs: data.theirs, theirsAnswered: data.theirsAnswered, verdicts: data.verdicts });
  }

  /* ------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    const now = app().todayISO();
    // A new day shows its question, unless an answer is half-written for the old one.
    if (day !== now && (!day || (!clean(answerInput.value) && !clean(guessInput.value) && !editing && !historyOpen))) {
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
      if (seq !== loadSeq || saving || judging) return;
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
    if (customBusy) return;
    const identity = identitySeq;
    const seq = customLoadSeq += 1;
    try {
      const data = await app().apiRequest(`/question/custom?author=${encodeURIComponent(me())}`);
      if (customBusy || identity !== identitySeq || seq !== customLoadSeq) return;
      applyCustomView(data);
      customLoaded = true;
      if (!quiet) showError(customError, "");
      renderCustom();
    } catch (error) {
      if (identity !== identitySeq || seq !== customLoadSeq) return;
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
    const guessing = canGuess(today);
    const guess = oneLine(guessInput.value);
    if (!text) {
      showError(errorEl, "Write your answer first.");
      answerInput.focus();
      return;
    }
    if (text.length > MAX_ANSWER) {
      showError(errorEl, `Keep it under ${MAX_ANSWER} characters.`);
      return;
    }
    if (guessing && guess.length > MAX_GUESS) {
      showError(errorEl, `Keep your guess under ${MAX_GUESS} characters.`);
      guessInput.focus();
      return;
    }
    if (editing && text === today.mine?.text && (!guessing || guess === (today.mine?.guess || ""))) {
      stopEditing();
      return;
    }
    const first = !today.mine;
    const question = today.question;
    const author = me();
    const identity = identitySeq;
    showError(errorEl, "");
    saving = true;
    loadSeq += 1;
    submitButton.disabled = true;
    cancelButton.disabled = true;
    setSubmitLabel();
    try {
      const body = { action: "answer", day: today.day, author, text };
      if (guessing) body.guess = guess;
      const data = await app().apiRequest("/question", "POST", body);
      if (identity !== identitySeq) return;
      today = data;
      editing = false;
      answerInput.value = "";
      guessInput.value = "";
      updateCount();
      saving = false;
      render();
      games()?.reward?.(data.awarded);
      games()?.refresh?.();
      if (first) {
        postActivity({ kind: "question.answer", text: "answered today’s question", detail: question, step: "question", icon: "message-circle-heart", push: true });
        window.LetterFX?.burstFrom?.(answersEl, today.theirs ? 26 : 14);
        window.LetterFX?.chime?.();
      }
      answersEl.querySelector(".answer-card.is-mine")?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      showError(errorEl, offline(error, "Couldn’t save your answer. Check your connection and try again."));
    } finally {
      saving = false;
      submitButton.disabled = false;
      cancelButton.disabled = false;
      setSubmitLabel();
      if (identity !== identitySeq && app()?.step === "question") load();
    }
  }

  function startEditing() {
    if (!today?.mine) return;
    editing = true;
    answerInput.value = today.mine.text;
    guessInput.value = today.mine.guess || "";
    updateCount();
    showError(errorEl, "");
    renderToday();
    answerInput.focus();
    answerInput.setSelectionRange(answerInput.value.length, answerInput.value.length);
  }

  function stopEditing() {
    editing = false;
    answerInput.value = "";
    guessInput.value = "";
    updateCount();
    showError(errorEl, "");
    renderToday();
    answersEl.querySelector("[data-edit]")?.focus({ preventScroll: true });
  }

  function openHistory(forDay) {
    historyOpen = forDay;
    renderHistory(true);
    const textarea = historyList.querySelector(".history-form textarea");
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function closeHistory() {
    const openDay = historyOpen;
    delete drafts[openDay];
    delete guessDrafts[openDay];
    historyOpen = "";
    renderHistory(true);
    historyList.querySelector(`[data-open="${CSS.escape(openDay)}"], [data-edit-day="${CSS.escape(openDay)}"]`)?.focus();
  }

  async function submitHistory(formEl) {
    const forDay = formEl.dataset.day;
    const item = today?.history?.find((entry) => entry.day === forDay);
    const textarea = formEl.querySelector("textarea");
    const guessEl = formEl.querySelector("[data-guess]");
    const errorBox = formEl.querySelector(".error");
    const button = formEl.querySelector('[type="submit"]');
    const label = button.textContent;
    const text = textarea.value.trim();
    const guess = guessEl ? oneLine(guessEl.value) : null;
    const first = !item?.mine;
    if (!text) {
      showError(errorBox, "Write your answer first.");
      textarea.focus();
      return;
    }
    if (guess !== null && guess.length > MAX_GUESS) {
      showError(errorBox, `Keep your guess under ${MAX_GUESS} characters.`);
      guessEl.focus();
      return;
    }
    if (!first && text === item.mine.text && (guess === null || guess === (item.mine.guess || ""))) {
      closeHistory();
      return;
    }
    showError(errorBox, "");
    button.disabled = true;
    button.textContent = first ? "Saving…" : "Updating…";
    const author = me();
    const identity = identitySeq;
    try {
      const body = { action: "answer", day: forDay, author, text };
      if (guess !== null) body.guess = guess;
      const data = await app().apiRequest("/question", "POST", body);
      if (identity !== identitySeq) return;
      applyDayView(data);
      delete drafts[forDay];
      delete guessDrafts[forDay];
      historyOpen = "";
      renderHistory(true);
      renderToday();
      games()?.reward?.(data.awarded);
      games()?.refresh?.();
      if (first) postActivity({ kind: "question.answer", text: "answered an earlier question", detail: data.question, step: "question", icon: "message-circle-heart", push: false });
      historyList.querySelector(`[data-edit-day="${CSS.escape(forDay)}"]`)?.focus({ preventScroll: true });
    } catch (error) {
      if (identity !== identitySeq) return;
      showError(errorBox, offline(error, "Couldn’t save your answer. Check your connection and try again."));
      button.disabled = false;
      button.textContent = label;
    }
  }

  // I judge their guess about my answer; changing it later replaces their hearts.
  async function judge(forDay, verdict) {
    if (judging || !VERDICTS[verdict]) return;
    const item = today?.day === forDay ? today : today?.history?.find((entry) => entry.day === forDay);
    if (!item?.theirs?.guess || item.verdicts?.theirs === verdict) return;
    const before = item.verdicts?.theirs || null;
    const author = me();
    const identity = identitySeq;
    const question = item.question;
    judging = forDay;
    loadSeq += 1;
    delete judgeErrors[forDay];
    item.verdicts = { ...(item.verdicts || {}), theirs: verdict };
    renderAfterJudge(forDay, verdict);
    try {
      const data = await app().apiRequest("/question", "POST", { action: "judge", day: forDay, author, verdict });
      if (identity !== identitySeq) return;
      judging = "";
      applyDayView(data);
      renderAfterJudge(forDay, verdict);
      postActivity({
        kind: "question.judge",
        text: `judged your guess: ${VERDICTS[verdict].label}`,
        detail: question,
        step: "question",
        icon: "target",
        push: !before
      });
      games()?.reward?.(data.awarded);
      games()?.refresh?.();
    } catch (error) {
      if (identity !== identitySeq) return;
      judging = "";
      item.verdicts = { ...(item.verdicts || {}), theirs: before };
      judgeErrors[forDay] = offline(error, "Couldn’t save that. Check your connection and try again.");
      renderAfterJudge(forDay, verdict);
    }
  }

  function renderAfterJudge(forDay, verdict) {
    // Today's card also shows the running guess points, so it redraws either way.
    renderToday();
    if (today?.day !== forDay) renderHistory(true);
    const root = today?.day === forDay ? guessesEl : historyList.querySelector(`.history-card[data-day="${CSS.escape(forDay)}"]`);
    root?.querySelector(`[data-verdict="${verdict}"]`)?.focus({ preventScroll: true });
  }

  function onVerdictClick(event) {
    const button = event.target.closest("[data-verdict]");
    const block = button?.closest(".guess-block");
    if (!button || button.disabled || !block) return false;
    judge(block.dataset.day, button.dataset.verdict);
    return true;
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
    const before = customSnapshot();
    const author = me();
    const identity = identitySeq;
    customBusy = true;
    customLoadSeq += 1;
    button.disabled = true;
    const pending = { id: "temp-question", text, author, at: new Date().toISOString(), usedOn: null, pending: true };
    custom = [...custom, pending];
    customQueue = [...customQueue, { id: pending.id, author, at: pending.at }];
    customInput.value = "";
    renderCustom();
    try {
      const data = await app().apiRequest("/question", "POST", { action: "custom", text, author });
      if (identity !== identitySeq) return;
      applyCustomView(data);
    } catch (error) {
      if (identity !== identitySeq) return;
      applyCustomView(before);
      if (!customInput.value) customInput.value = text;
      showError(customError, offline(error, "Couldn’t add that. Check your connection and try again."));
    } finally {
      customBusy = false;
      button.disabled = false;
      renderCustom();
      if (identity !== identitySeq && app()?.step === "question") loadCustom();
    }
  }

  async function removeCustom(id) {
    if (customBusy) return;
    const before = customSnapshot();
    const author = me();
    const identity = identitySeq;
    customBusy = true;
    customLoadSeq += 1;
    custom = custom.filter((item) => item.id !== id);
    customQueue = customQueue.filter((item) => item.id !== id);
    renderCustom();
    showError(customError, "");
    try {
      const data = await app().apiRequest("/question", "POST", { action: "uncustom", id, author });
      if (identity !== identitySeq) return;
      applyCustomView(data);
    } catch (error) {
      if (identity !== identitySeq) return;
      applyCustomView(before);
      showError(customError, offline(error, "Couldn’t remove that. Check your connection and try again."));
    } finally {
      customBusy = false;
      renderCustom();
      if (identity !== identitySeq && app()?.step === "question") loadCustom();
    }
  }

  /* ------------------------------- Wiring -------------------------------- */
  function resetIdentity() {
    identitySeq += 1;
    loadSeq += 1;
    customLoadSeq += 1;
    today = null;
    editing = false;
    judging = "";
    day = "";
    historyOpen = "";
    answersDrawn = "";
    guessesDrawn = "";
    historyDrawn = "";
    historyShown = HISTORY_STEP;
    [drafts, guessDrafts, judgeErrors].forEach((store) => Object.keys(store).forEach((key) => { delete store[key]; }));
    answerInput.value = "";
    guessInput.value = "";
    customInput.value = "";
    customLoaded = false;
    applyCustomView({});
    answersEl.innerHTML = "";
    guessesEl.innerHTML = "";
    historyList.innerHTML = "";
    todayEl.hidden = true;
    historyWrap.hidden = true;
    tileAskedAt = 0;
    updateTile(null);
    renderCustom();
    if (app()?.step === "question") { load(); loadCustom(); }
    else if (app()?.step === "planned") refreshTile({ force: true });
  }
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });

  form.addEventListener("submit", submitAnswer);
  answerInput.addEventListener("input", updateCount);
  cancelButton.addEventListener("click", stopEditing);
  answersEl.addEventListener("click", (event) => {
    if (event.target.closest("[data-edit]")) startEditing();
  });
  guessesEl.addEventListener("click", onVerdictClick);
  historyList.addEventListener("click", (event) => {
    if (onVerdictClick(event)) return;
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-open]")) openHistory(button.dataset.open);
    else if (button.matches("[data-edit-day]")) openHistory(button.dataset.editDay);
    else if (button.matches("[data-cancel]")) closeHistory();
    else if (button.matches("[data-more]")) {
      historyShown += HISTORY_STEP * 2;
      renderHistory(true);
    }
  });
  historyList.addEventListener("input", (event) => {
    const formEl = event.target.closest(".history-form");
    if (!formEl) return;
    if (event.target.matches("[data-guess]")) guessDrafts[formEl.dataset.day] = event.target.value;
    else drafts[formEl.dataset.day] = event.target.value;
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
