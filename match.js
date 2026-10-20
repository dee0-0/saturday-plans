/*
 * Daily match: 5 quick this-or-that picks a day. The Worker chooses the day's
 * pairs the first time either of us opens it; you tap one side per pair and the
 * fifth tap sends your picks. The other one's picks only show once you played
 * too (the Worker enforces that), then both see "4 of 5 the same", our
 * compatibility over all days and the match streak. Earlier days stay below.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="match"]');
  if (!section) return;

  const ledeEl = $("#match-lede");
  const statusEl = $("#match-status");
  const playEl = $("#match-play");
  const progressEl = $("#match-progress");
  const countEl = $("#match-count");
  const promptEl = $("#match-prompt");
  const cardsEl = $("#match-cards");
  const cardEls = [...cardsEl.querySelectorAll(".match-card")];
  const backButton = $("#match-back");
  const resultEl = $("#match-result");
  const headlineEl = $("#match-headline");
  const rowsEl = $("#match-rows");
  const errorEl = $("#match-error");
  const retryButton = $("#match-retry");
  const statsEl = $("#match-stats");
  const historyWrap = $("#match-history");
  const historyList = $("#match-history-list");

  const POLL_MS = 12000;
  const PAIRS = 5;
  const PICK_DELAY = 260;  // the tapped card shows its pick for a moment before the next pair

  let data = null;         // GET /games/match answer for today
  let draft = [];          // picks so far while playing (0 = left, 1 = right)
  let saving = false;
  let advancing = false;   // between a tap and the next pair
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let celebrated = "";     // the day whose reveal already got its petals
  let playDrawn = "";
  let drawn = { headline: "", rows: "", stats: "", history: "" };
  const openDays = new Set(); // earlier days expanded in the list

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const offline = (error, fallback) => (error.status ? error.message : fallback);
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  const iconHtml = (name, fallback = "heart") => `<i class="icon" data-lucide="${ICON_NAME.test(name || "") ? name : fallback}" aria-hidden="true"></i>`;

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  // The bell on the other phone (activity.js); never let it break the page.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  function games() {
    return window.DateGames || null;
  }

  function shortDay(iso) {
    const [year, month, date] = String(iso).split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
      .format(new Date(Date.UTC(year, month - 1, date, 12)));
  }

  const validPicks = (picks) => Array.isArray(picks) && picks.length === PAIRS && picks.every((pick) => pick === 0 || pick === 1);
  const pairAt = (item, index) => (Array.isArray(item?.pairs?.[index]) ? item.pairs[index] : ["", ""]);
  const iconAt = (item, index, side) => item?.icons?.[index]?.[side] || "";

  function scoreMessage(score) {
    return [
      "Perfect opposites. Impressive!",
      "Opposites attract, right?",
      "Two of a kind, sometimes.",
      "More alike than not.",
      "So in sync.",
      "A perfect match!"
    ][score] || "";
  }

  /* ------------------------------- Playing ------------------------------- */
  function renderPlay() {
    // Polls redraw the page; the cards only change when the pair (or saving) does.
    const key = `${data.day}:${draft.length}:${saving}`;
    if (playDrawn === key || advancing) return;
    playDrawn = key;
    const index = Math.min(draft.length, PAIRS - 1);
    const [left, right] = pairAt(data, index);
    countEl.textContent = `${index + 1} of ${PAIRS}`;
    promptEl.textContent = `${left} or ${right}?`;
    [...progressEl.children].forEach((dot, dotIndex) => {
      dot.classList.toggle("is-done", dotIndex < draft.length);
      dot.classList.toggle("is-current", dotIndex === draft.length);
    });
    cardEls.forEach((card, side) => {
      const label = side === 0 ? left : right;
      card.querySelector(".match-card-label").textContent = label;
      card.querySelector(".match-card-art").innerHTML = iconHtml(iconAt(data, index, side), side === 0 ? "heart" : "sparkles");
      card.setAttribute("aria-label", label);
      card.classList.remove("is-picked", "is-other");
      card.disabled = saving;
    });
    icons(cardsEl);
    backButton.hidden = !draft.length || saving;
    cardsEl.classList.toggle("is-saving", saving);
    countEl.textContent = saving ? "Sending your picks…" : `${index + 1} of ${PAIRS}`;
  }

  function pick(side) {
    if (!data || saving || advancing || data.mine || draft.length >= PAIRS) return;
    const hadFocus = cardsEl.contains(document.activeElement);
    draft.push(side);
    cardEls[side].classList.add("is-picked");
    cardEls[1 - side].classList.add("is-other");
    advancing = true;
    window.setTimeout(() => {
      advancing = false;
      if (draft.length >= PAIRS) {
        submit();
        return;
      }
      if (!reduced()) {
        cardsEl.classList.remove("is-next");
        void cardsEl.offsetWidth; // restart the slide-in
        cardsEl.classList.add("is-next");
      }
      renderPlay();
      if (hadFocus) cardEls[0].focus({ preventScroll: true });
    }, reduced() ? 120 : PICK_DELAY);
  }

  function undo() {
    if (saving || advancing || !draft.length) return;
    draft.pop();
    renderPlay();
    cardEls[0].focus({ preventScroll: true });
  }

  async function submit() {
    if (!data || saving || !validPicks(draft)) return;
    const picks = [...draft];
    const author = me();
    const identity = identitySeq;
    const hadFocus = cardsEl.contains(document.activeElement);
    saving = true;
    loadSeq += 1;
    showError("");
    retryButton.hidden = true;
    renderPlay();
    try {
      const result = await app().apiRequest("/games/match", "POST", { author, day: data.day, picks });
      if (identity !== identitySeq) return;
      data = result;
      draft = [];
      saving = false;
      render();
      const second = result.score !== null && result.score !== undefined;
      postActivity({
        kind: "match.played",
        text: second ? `played today’s match: ${result.score} of ${PAIRS} the same` : "played today’s match",
        step: "match",
        icon: "split",
        push: true
      });
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
      // The cards are gone: keep keyboard and screen reader users on the result.
      if (hadFocus) headlineEl.focus({ preventScroll: true });
      headlineEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      if (error.status === 409) {
        // Already played on the other tab, or a new day began: show what the server has.
        draft = [];
        showError(error.message);
        await load();
        return;
      }
      showError(offline(error, "Couldn’t send your picks. Check your connection and try again."));
      retryButton.hidden = false;
      renderPlay();
    }
  }

  /* -------------------------------- Result -------------------------------- */
  function chipHtml(item, index, who, picks) {
    const side = picks[index];
    const label = pairAt(item, index)[side];
    const owner = who === me() ? "You" : nameOf(who);
    return `<span class="match-chip${who === me() ? " is-mine" : ""}">${iconHtml(iconAt(item, index, side), "circle")}<span><b>${escape(owner)}:</b> ${escape(label)}</span></span>`;
  }

  // One row per pair: both picks, or one "Both: Beach" chip when they're the same.
  function rowsHtml(item) {
    if (!validPicks(item?.mine)) return "";
    const theirs = validPicks(item.theirs) ? item.theirs : null;
    return item.mine.map((side, index) => {
      const [left, right] = pairAt(item, index);
      const same = theirs && theirs[index] === side;
      let picks;
      if (same) {
        picks = `<span class="match-chip is-both">${iconHtml(iconAt(item, index, side), "heart")}<span><b>Both:</b> ${escape(pairAt(item, index)[side])}</span></span>`;
      } else {
        picks = chipHtml(item, index, me(), item.mine) + (theirs ? chipHtml(item, index, other(), theirs) : "");
      }
      const mark = theirs
        ? `<span class="match-row-mark" aria-label="${same ? "Same" : "Different"}">${iconHtml(same ? "heart" : "x")}</span>`
        : "";
      return `<li class="match-row${same ? " is-same" : ""}${theirs && !same ? " is-different" : ""}" style="--row: ${index}">
          <span class="match-row-num" aria-hidden="true">${index + 1}</span>
          <div class="match-row-copy">
            <p class="match-row-pair">${escape(left)} <span>or</span> ${escape(right)}</p>
            <p class="match-row-picks">${picks}</p>
          </div>${mark}
        </li>`;
    }).join("");
  }

  function headlineHtml() {
    const them = escape(nameOf(other()));
    if (data.score === null || data.score === undefined) {
      return `<div class="match-waiting">
          <span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">Waiting for ${them}…</p>
          <p class="match-waiting-copy">Your picks are locked in. The score shows as soon as ${them} plays too.</p></div>
        </div>`;
    }
    const hearts = Array.from({ length: PAIRS }, (_, index) => `<span class="${index < data.score ? "is-on" : ""}">${iconHtml("heart")}</span>`).join("");
    return `<div class="match-score${data.score === PAIRS ? " is-perfect" : ""}">
        <p class="match-score-big"><strong>${data.score}</strong> of ${PAIRS} the same</p>
        <p class="match-score-hearts" aria-hidden="true">${hearts}</p>
        <p class="match-score-msg">${escape(scoreMessage(data.score))}</p>
      </div>`;
  }

  function statsHtml(stats) {
    if (!stats || !stats.daysTogether) return "";
    const streak = Number(stats.streak) || 0;
    const best = Number(stats.best) || 0;
    const percent = Math.max(0, Math.min(100, Number(stats.compatibility) || 0));
    const days = Number(stats.daysTogether) || 0;
    return `<div class="match-stat is-main"><dt>Compatibility</dt><dd><strong>${percent}%</strong><small>over ${days === 1 ? "1 day" : `${days} days`} together</small><span class="match-meter" aria-hidden="true"><span style="width: ${percent}%"></span></span></dd></div>
      <div class="match-stat"><dt>Match streak</dt><dd><strong>${streak}</strong><small>${streak === 1 ? "day" : "days"} in a row${best > streak ? ` · best ${best}` : ""}</small></dd></div>
      <div class="match-stat"><dt>Perfect days</dt><dd><strong>${Number(stats.perfectDays) || 0}</strong><small>all 5 the same</small></dd></div>`;
  }

  function historyHtml(history) {
    return history.map((item) => {
      const them = escape(nameOf(other()));
      let badge;
      if (item.score !== null && item.score !== undefined) badge = `<span class="match-day-score${item.score === PAIRS ? " is-perfect" : ""}">${item.score} of ${PAIRS}</span>`;
      else if (item.mine) badge = `<span class="match-day-note">${them} missed it</span>`;
      else badge = `<span class="match-day-note">You missed it</span>`;
      const body = item.mine
        ? `<ol class="match-rows is-compact">${rowsHtml(item)}</ol>`
        : `<p class="match-day-empty">${them} played this one. Their picks stay a secret.</p>`;
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
    const played = validPicks(data.mine);
    ledeEl.hidden = played;
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : "Five quick picks. Then see how alike you are today.";
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));

    playEl.hidden = played;
    if (!played) renderPlay();

    resultEl.hidden = !played;
    if (played) {
      const revealedNow = put(headlineEl, "headline", headlineHtml());
      const rowsChanged = put(rowsEl, "rows", rowsHtml(data));
      const revealed = data.score !== null && data.score !== undefined;
      resultEl.classList.toggle("is-revealed", revealed);
      if (rowsChanged && revealed && celebrated !== data.day) {
        celebrated = data.day;
        rowsEl.classList.remove("is-arriving");
        if (!reduced()) {
          void rowsEl.offsetWidth;
          rowsEl.classList.add("is-arriving");
        }
        if (revealedNow && data.score >= 4 && !reduced()) {
          window.LetterFX?.burstFrom?.(headlineEl, data.score === PAIRS ? 30 : 16);
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
    // A new day while half-way through the old one's picks: start fresh with today's.
    if (data && data.day !== today && !saving) {
      draft = [];
      data = null;
    }
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s pairs…";
      playEl.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/match?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || saving) return;
      // Picks already made today on this phone stay; a stale day starts over.
      if (data?.day !== result.day) draft = [];
      data = result;
      if (!quiet) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404
        ? "The daily match needs the latest server update first."
        : "Couldn’t load today’s pairs. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "match") return;
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
    saving = false;
    celebrated = "";
    drawn = { headline: "", rows: "", stats: "", history: "" };
    playDrawn = "";
    openDays.clear();
    headlineEl.innerHTML = "";
    rowsEl.innerHTML = "";
    statsEl.innerHTML = "";
    historyList.innerHTML = "";
    showError("");
    if (app()?.step === "match") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  cardsEl.addEventListener("click", (event) => {
    const card = event.target.closest(".match-card");
    if (card && !card.disabled) pick(Number(card.dataset.pick));
  });
  backButton.addEventListener("click", undo);
  retryButton.addEventListener("click", () => {
    retryButton.hidden = true;
    if (data && validPicks(draft) && !data.mine) submit();
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
    if (event.detail.name === "match") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "match") load({ quiet: true });
  });
})();
