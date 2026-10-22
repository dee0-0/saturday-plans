/*
 * Daily duel: 5 quick questions a day about the two of us, one of each kind:
 * "Who's the better…?", "Who did it?" (or "Who would rather…?"), "Same answer"
 * (four options, double hearts when we pick the same), "Truth meter" (true or
 * false for me, plus a guess for you) and "Mind reader" (a colour, an animal and
 * a number; every match scores). Your answers only show to the other once they
 * played too (the Worker enforces that); then both see what we agreed on.
 * Shares its result and stats look with the daily match (match.css).
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="duel"]');
  if (!section) return;

  const ledeEl = $("#duel-lede");
  const statusEl = $("#duel-status");
  const playEl = $("#duel-play");
  const progressEl = $("#duel-progress");
  const countEl = $("#duel-count");
  const cardEl = $("#duel-card");
  const backButton = $("#duel-back");
  const resultEl = $("#duel-result");
  const headlineEl = $("#duel-headline");
  const rowsEl = $("#duel-rows");
  const errorEl = $("#duel-error");
  const retryButton = $("#duel-retry");
  const statsEl = $("#duel-stats");
  const historyWrap = $("#duel-history");
  const historyList = $("#duel-history-list");

  const POLL_MS = 12000;
  const COUNT = 5;
  const PICK_DELAY = 280;
  const KIND = {
    better: { label: "Who’s the better…", icon: "crown" },
    did: { label: "Who did it?", icon: "users" },
    same: { label: "Same answer · double hearts", icon: "heart-handshake" },
    truth: { label: "Truth meter", icon: "scale" },
    mind: { label: "Mind reader", icon: "brain" }
  };

  let data = null;          // GET /games/duel answer for today
  let draft = [];           // answers so far while playing
  let partial = null;       // the truth or mind answer being put together
  let saving = false;
  let advancing = false;
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let celebrated = "";
  let drawn = { card: "", headline: "", rows: "", stats: "", history: "" };
  const openDays = new Set();

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const offline = (error, fallback) => (error.status ? error.message : fallback);
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  const iconHtml = (name, fallback = "heart") => `<i class="icon" data-lucide="${ICON_NAME.test(name || "") ? name : fallback}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;

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

  function shortDay(iso) {
    const [year, month, date] = String(iso).split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
      .format(new Date(Date.UTC(year, month - 1, date, 12)));
  }

  const questions = (item) => (Array.isArray(item?.questions) ? item.questions : []);
  const mind = () => data?.mind || { colours: [], animals: [], numbers: [] };
  // "You" for me, the name for the other one.
  const youLabel = (who) => (who === me() ? "You" : nameOf(who));

  // A mind-reader answer as text: "Pink · Cat · 3".
  function mindText(answer) {
    if (!Array.isArray(answer)) return "";
    const m = mind();
    return [m.colours[answer[0]]?.[0], m.animals[answer[1]]?.[0], m.numbers[answer[2]]].filter(Boolean).join(" · ");
  }

  /* ------------------------------- Playing ------------------------------- */
  function choiceButton(value, label, extra = "", pressed = false) {
    return `<button class="duel-choice${extra ? ` ${extra}` : ""}" type="button" data-value="${escape(value)}" aria-pressed="${pressed}">${label}</button>`;
  }

  function cardHtml(question) {
    const kind = KIND[question.kind] || KIND.better;
    const head = `<p class="duel-kind">${iconHtml(kind.icon)}<span>${escape(kind.label)}</span></p>
      <p class="duel-question" id="duel-question">${escape(question.text)}</p>`;
    if (question.kind === "better" || question.kind === "did") {
      return `${head}<div class="duel-choices is-two" role="group" aria-labelledby="duel-question">
          ${choiceButton(me(), `${iconHtml("user")}<span>Me</span>`, "is-big")}
          ${choiceButton(other(), `${iconHtml("heart")}<span>${escape(nameOf(other()))}</span>`, "is-big")}
        </div>`;
    }
    if (question.kind === "same") {
      return `${head}<div class="duel-choices is-four" role="group" aria-labelledby="duel-question">
          ${question.options.map((option, index) => choiceButton(index, `<span>${escape(option)}</span>`)).join("")}
        </div>`;
    }
    if (question.kind === "truth") {
      const value = partial || {};
      const row = (part, title) => `<div class="duel-part" role="group" aria-label="${escape(title)}">
          <p class="duel-part-title">${escape(title)}</p>
          <div class="duel-choices is-two">
            ${choiceButton(`${part}:1`, `${iconHtml("thumbs-up")}<span>True</span>`, "", value[part] === true)}
            ${choiceButton(`${part}:0`, `${iconHtml("thumbs-down")}<span>Not true</span>`, "", value[part] === false)}
          </div>
        </div>`;
      return `${head}${row("self", "For me, this is…")}${row("guess", `My guess for ${nameOf(other())}`)}`;
    }
    const m = mind();
    const value = partial || [];
    const swatches = m.colours.map(([label, colour], index) => `<button class="duel-swatch" type="button" data-value="0:${index}" aria-pressed="${value[0] === index}" aria-label="${escape(label)}" style="--swatch: ${escape(colour)}"></button>`).join("");
    const animals = m.animals.map(([label, icon], index) => `<button class="duel-animal" type="button" data-value="1:${index}" aria-pressed="${value[1] === index}" aria-label="${escape(label)}">${iconHtml(icon)}</button>`).join("");
    const numbers = m.numbers.map((label, index) => `<button class="duel-number" type="button" data-value="2:${index}" aria-pressed="${value[2] === index}">${escape(label)}</button>`).join("");
    const ready = [0, 1, 2].every((part) => Number.isInteger(value[part]));
    return `${head}
      <div class="duel-part" role="group" aria-label="A colour"><p class="duel-part-title">A colour</p><div class="duel-row">${swatches}</div></div>
      <div class="duel-part" role="group" aria-label="An animal"><p class="duel-part-title">An animal</p><div class="duel-row">${animals}</div></div>
      <div class="duel-part" role="group" aria-label="A number"><p class="duel-part-title">A number</p><div class="duel-row">${numbers}</div></div>
      <button class="btn btn-primary duel-send" type="button" data-send ${ready && !saving ? "" : "disabled"}>${saving ? "Sending…" : "Send my answers"} ${iconHtml("send")}</button>`;
  }

  function renderPlay(force = false) {
    const index = Math.min(draft.length, COUNT - 1);
    const question = questions(data)[index];
    if (!question) return;
    const html = cardHtml(question);
    const key = `${data.day}:${draft.length}:${saving}:${html}`;
    if (!force && (drawn.card === key || advancing)) return;
    drawn.card = key;
    cardEl.innerHTML = html;
    cardEl.dataset.kind = question.kind;
    icons(cardEl);
    countEl.textContent = saving ? "Sending your answers…" : `${index + 1} of ${COUNT}`;
    [...progressEl.children].forEach((dot, dotIndex) => {
      dot.classList.toggle("is-done", dotIndex < draft.length);
      dot.classList.toggle("is-current", dotIndex === draft.length);
    });
    backButton.hidden = !draft.length || saving;
  }

  function advance(answer, button) {
    const hadFocus = cardEl.contains(document.activeElement);
    draft.push(answer);
    partial = null;
    button?.classList.add("is-picked");
    advancing = true;
    window.setTimeout(() => {
      advancing = false;
      if (!reduced()) {
        cardEl.classList.remove("is-next");
        void cardEl.offsetWidth;
        cardEl.classList.add("is-next");
      }
      renderPlay(true);
      if (hadFocus) cardEl.querySelector("button")?.focus({ preventScroll: true });
    }, reduced() ? 120 : PICK_DELAY);
  }

  function choose(button) {
    if (!data || saving || advancing || data.mine || draft.length >= COUNT) return;
    const question = questions(data)[draft.length];
    const value = button.dataset.value;
    if (question.kind === "better" || question.kind === "did") {
      advance(value, button);
    } else if (question.kind === "same") {
      advance(Number(value), button);
    } else if (question.kind === "truth") {
      const [part, bit] = value.split(":");
      partial = { ...(partial || {}), [part]: bit === "1" };
      if (typeof partial.self === "boolean" && typeof partial.guess === "boolean") advance(partial, button);
      else renderPlay(true);
    } else if (question.kind === "mind") {
      const [part, index] = value.split(":").map(Number);
      const next = Array.isArray(partial) ? [...partial] : [];
      next[part] = index;
      partial = next;
      renderPlay(true);
      cardEl.querySelector(`[data-value="${part}:${index}"]`)?.focus({ preventScroll: true });
    }
  }

  function undo() {
    if (saving || advancing || !draft.length) return;
    partial = null;
    draft.pop();
    renderPlay(true);
    cardEl.querySelector("button")?.focus({ preventScroll: true });
  }

  async function submit() {
    if (!data || saving || data.mine) return;
    if (draft.length === COUNT - 1 && Array.isArray(partial) && [0, 1, 2].every((part) => Number.isInteger(partial[part]))) {
      draft.push([...partial]);
      partial = null;
    }
    if (draft.length !== COUNT) return;
    const answers = [...draft];
    const author = me();
    const identity = identitySeq;
    saving = true;
    loadSeq += 1;
    showError("");
    retryButton.hidden = true;
    renderPlay(true);
    try {
      const result = await app().apiRequest("/games/duel", "POST", { author, day: data.day, answers });
      if (identity !== identitySeq) return;
      data = result;
      draft = [];
      saving = false;
      render();
      const res = result.result;
      postActivity({
        kind: "duel.played",
        text: res ? `played today’s duel: ${res.agreements} of ${res.possible} the same` : "played today’s duel",
        step: "duel",
        icon: "swords",
        push: true
      });
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
      headlineEl.focus({ preventScroll: true });
      headlineEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      if (error.status === 409) {
        draft = [];
        partial = null;
        showError(error.message);
        await load();
        return;
      }
      // Keep the answers; the last one goes back into the card so it can be sent again.
      partial = draft.pop();
      showError(offline(error, "Couldn’t send your answers. Check your connection and try again."));
      retryButton.hidden = false;
      renderPlay(true);
    }
  }

  /* -------------------------------- Result -------------------------------- */
  function chip(text, who, verb = "") {
    return `<span class="match-chip${who === me() ? " is-mine" : ""}"><span><b>${escape(youLabel(who))}${verb}:</b> ${escape(text)}</span></span>`;
  }

  function rowsHtml(item) {
    if (!Array.isArray(item?.mine)) return "";
    const theirs = Array.isArray(item.theirs) ? item.theirs : null;
    const rows = item.result?.rows || [];
    return questions(item).map((question, index) => {
      const row = rows[index];
      const mine = item.mine[index];
      const their = theirs ? theirs[index] : undefined;
      let picks;
      let detail = "";
      if (question.kind === "truth") {
        picks = chip(mine?.self ? "True" : "Not true", me()) + (theirs ? chip(their?.self ? "True" : "Not true", other()) : "");
        if (row) {
          const mineRight = row.right?.[me()];
          const theirRight = row.right?.[other()];
          detail = `<span class="duel-guess${mineRight ? " is-right" : ""}">${iconHtml(mineRight ? "check" : "x")}Your guess was ${mineRight ? "right" : "wrong"}</span>
            <span class="duel-guess${theirRight ? " is-right" : ""}">${iconHtml(theirRight ? "check" : "x")}${escape(nameOf(other()))}’s guess was ${theirRight ? "right" : "wrong"}</span>`;
        } else {
          detail = `<span class="duel-guess">${iconHtml("eye")}You guessed “${mine?.guess ? "true" : "not true"}” for ${escape(nameOf(other()))}</span>`;
        }
      } else if (question.kind === "mind") {
        const sameAll = row?.same;
        picks = sameAll
          ? `<span class="match-chip is-both"><span><b>Both:</b> ${escape(mindText(mine))}</span></span>`
          : chip(mindText(mine), me()) + (theirs ? chip(mindText(their), other()) : "");
        if (row) detail = `<span class="duel-guess${row.matches ? " is-right" : ""}">${iconHtml("sparkles")}${row.matches} of 3 the same</span>`;
      } else {
        const label = (answer) => (question.kind === "same" ? question.options?.[answer] ?? "" : youLabel(answer));
        picks = row?.same
          ? `<span class="match-chip is-both"><span><b>Both:</b> ${escape(label(mine))}</span></span>`
          : chip(label(mine), me(), question.kind === "same" ? "" : " picked") + (theirs ? chip(label(their), other(), question.kind === "same" ? "" : " picked") : "");
      }
      const good = row && (question.kind === "mind" ? row.matches > 0 : question.kind === "truth" ? row.right?.[me()] : row.same);
      const hearts = row ? row.hearts?.[me()] || 0 : 0;
      const mark = row ? `<span class="match-row-mark" aria-label="${good ? "Scored" : "No score"}">${hearts ? `<b class="duel-plus">+${hearts}</b>` : iconHtml("x")}</span>` : "";
      return `<li class="match-row${row && good ? " is-same" : ""}${row && !good ? " is-different" : ""}" style="--row: ${index}">
          <span class="match-row-num" aria-hidden="true">${iconHtml(KIND[question.kind]?.icon || "heart")}</span>
          <div class="match-row-copy">
            <p class="match-row-pair">${escape(question.text)}</p>
            <p class="match-row-picks">${picks}</p>
            ${detail ? `<p class="duel-details">${detail}</p>` : ""}
          </div>${mark}
        </li>`;
    }).join("");
  }

  function headlineHtml() {
    const them = escape(nameOf(other()));
    const res = data.result;
    if (!res) {
      return `<div class="match-waiting">
          <span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">Waiting for ${them}…</p>
          <p class="match-waiting-copy">Your answers are locked in. You’ll see everything as soon as ${them} plays too.</p></div>
        </div>`;
    }
    const mine = res.total?.[me()] || 0;
    const theirs = res.total?.[other()] || 0;
    const message = res.agreements >= 5 ? "Totally in sync!" : res.agreements >= 3 ? "Pretty in tune today." : res.agreements >= 1 ? "A little different today." : "Opposites today!";
    return `<div class="match-score${res.agreements === res.possible ? " is-perfect" : ""}">
        <p class="match-score-big"><strong>${res.agreements}</strong> of ${res.possible} the same</p>
        <p class="duel-totals"><span>${iconHtml("heart")}You +${mine}</span><span>${iconHtml("heart")}${them} +${theirs}</span></p>
        <p class="match-score-msg">${escape(message)}</p>
      </div>`;
  }

  function statsHtml(stats) {
    if (!stats || !stats.daysPlayed) return "";
    const percent = Math.max(0, Math.min(100, Number(stats.agreement) || 0));
    const days = Number(stats.daysPlayed) || 0;
    const right = stats.truthRight || {};
    return `<div class="match-stat is-main"><dt>Agreement</dt><dd><strong>${percent}%</strong><small>over ${days === 1 ? "1 duel" : `${days} duels`}</small><span class="match-meter" aria-hidden="true"><span style="width: ${percent}%"></span></span></dd></div>
      <div class="match-stat"><dt>Truth guesses</dt><dd><strong>${Number(right[me()]) || 0} : ${Number(right[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Best day</dt><dd><strong>${Number(stats.bestDay) || 0}</strong><small>of 6 the same</small></dd></div>`;
  }

  function historyHtml(history) {
    const them = escape(nameOf(other()));
    return history.map((item) => {
      let badge;
      if (item.result) badge = `<span class="match-day-score${item.result.agreements === item.result.possible ? " is-perfect" : ""}">${item.result.agreements} of ${item.result.possible}</span>`;
      else if (item.mine) badge = `<span class="match-day-note">${them} missed it</span>`;
      else badge = `<span class="match-day-note">You missed it</span>`;
      const body = item.mine
        ? `<ol class="match-rows is-compact">${rowsHtml(item)}</ol>`
        : `<p class="match-day-empty">${them} played this one. Their answers stay a secret.</p>`;
      return `<details class="match-day" data-day="${escape(item.day)}"${openDays.has(item.day) ? " open" : ""}>
          <summary><span class="match-day-label">${escape(shortDay(item.day))}</span>${badge}${iconHtml("chevron-down")}</summary>
          ${body}
        </details>`;
    }).join("");
  }

  function put(element, key, html) {
    if (drawn[key] === html) return false;
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
    return true;
  }

  function render() {
    if (!data) return;
    statusEl.hidden = true;
    const played = Array.isArray(data.mine);
    ledeEl.hidden = played;
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : "Five quick questions about us. Agree to win hearts.";
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));

    playEl.hidden = played;
    if (!played) renderPlay();

    resultEl.hidden = !played;
    if (played) {
      const revealedNow = put(headlineEl, "headline", headlineHtml());
      const rowsChanged = put(rowsEl, "rows", rowsHtml(data));
      const revealed = Boolean(data.result);
      resultEl.classList.toggle("is-revealed", revealed);
      if (rowsChanged && revealed && celebrated !== data.day) {
        celebrated = data.day;
        rowsEl.classList.remove("is-arriving");
        if (!reduced()) {
          void rowsEl.offsetWidth;
          rowsEl.classList.add("is-arriving");
        }
        if (revealedNow && data.result.agreements >= 4 && !reduced()) {
          window.LetterFX?.burstFrom?.(headlineEl, data.result.agreements === data.result.possible ? 30 : 16);
          window.LetterFX?.chime?.();
        }
      }
    }

    const stats = statsHtml(data.stats);
    statsEl.hidden = !stats;
    put(statsEl, "stats", stats);

    const history = Array.isArray(data.history) ? data.history : [];
    historyWrap.hidden = !history.length;
    put(historyList, "history", historyHtml(history));
  }

  /* -------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    const today = app().todayISO();
    if (data && data.day !== today && !saving) {
      draft = [];
      partial = null;
      data = null;
    }
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s questions…";
      playEl.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/duel?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || saving) return;
      if (data?.day !== result.day) {
        draft = [];
        partial = null;
      }
      data = result;
      if (!quiet) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404
        ? "The daily duel needs the latest server update first."
        : "Couldn’t load today’s questions. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "duel") return;
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
    data = null;
    draft = [];
    partial = null;
    saving = false;
    celebrated = "";
    drawn = { card: "", headline: "", rows: "", stats: "", history: "" };
    openDays.clear();
    cardEl.innerHTML = "";
    headlineEl.innerHTML = "";
    rowsEl.innerHTML = "";
    statsEl.innerHTML = "";
    historyList.innerHTML = "";
    showError("");
    if (app()?.step === "duel") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  cardEl.addEventListener("click", (event) => {
    const send = event.target.closest("[data-send]");
    if (send && !send.disabled) {
      submit();
      return;
    }
    const button = event.target.closest("button[data-value]");
    if (button && !button.disabled) choose(button);
  });
  backButton.addEventListener("click", undo);
  retryButton.addEventListener("click", () => {
    retryButton.hidden = true;
    if (data && !data.mine && draft.length === COUNT - 1 && Array.isArray(partial)) submit();
    else load();
  });
  historyList.addEventListener("toggle", (event) => {
    const item = event.target.closest?.(".match-day");
    if (!item) return;
    if (item.open) openDays.add(item.dataset.day);
    else openDays.delete(item.dataset.day);
  }, true);

  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "duel") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "duel") load({ quiet: true });
  });
})();
