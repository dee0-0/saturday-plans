/*
 * Games hub: one page that lists every game with what's waiting today, our
 * couple streak (with a "Don't break our streak!" nudge), the hearts we earned
 * and the way into the love shop, a leaderboard and our badges. One GET /games
 * gives all of it; each game's Worker module adds its own summary. Also keeps
 * the "Games" tile on the plan page fresh, and gives the game pages
 * window.DateGames: reward() for the floating "+2 hearts" pop, refresh(),
 * nameOf() and other().
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);

  const POLL_MS = 15000;
  const TILE_MS = 60000;    // the plan page asks at most once a minute
  const BADGES_SHOWN = 9;
  const POP_MS = 1900;
  const PILLS = { todo: "Your turn", waiting: "Waiting", done: "Done", new: "New" };
  const ICON_NAME = /^[a-z0-9-]{1,48}$/;
  // The Fry game lives on the page itself, not in the Worker, so its row is fixed.
  const FRY_GAME = { id: "fry", title: "Fry game", icon: "gamepad-2", step: "game", status: "idle", line: "Win a prize" };

  const app = () => window.DateApp;
  const me = () => (app()?.me?.() === "sender" ? "sender" : "her");
  const other = (author = me()) => (author === "her" ? "sender" : "her");
  const nameOf = (author) => app()?.names?.[author] || (author === "her" ? "Her" : "Your date");
  const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const count = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0);
  const plural = (value, word) => `${value} ${word}${value === 1 ? "" : "s"}`;

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // A lucide name from the server, or `fallback` when it's malformed or unknown.
  function iconName(name, fallback) {
    if (typeof name !== "string" || !ICON_NAME.test(name)) return fallback;
    const known = window.lucide?.icons;
    if (!known) return name;
    const pascal = name.replace(/(^|-)([a-z0-9])/g, (_, dash, letter) => letter.toUpperCase());
    return known[pascal] ? name : fallback;
  }

  // The bell on the other phone (activity.js); never let it break the page.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  /* --------------------------- Reward pop ------------------------------- */
  let rewardLayer = null;

  // A small "+2 hearts" that floats up in the middle of the screen. Does nothing for 0 or less.
  function reward(amount, label = "") {
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value) || value <= 0 || !document.body) return;
    if (!rewardLayer) {
      rewardLayer = document.createElement("div");
      rewardLayer.className = "games-reward-layer";
      rewardLayer.setAttribute("role", "status");
      rewardLayer.setAttribute("aria-live", "polite");
      document.body.append(rewardLayer);
    }
    const pop = document.createElement("div");
    pop.className = "games-reward";
    // Pops that overlap step aside a little.
    pop.style.setProperty("--pop-shift", `${(rewardLayer.childElementCount % 3) * 30}px`);
    pop.innerHTML = `<span class="games-reward-heart"><i class="icon" data-lucide="heart" aria-hidden="true"></i></span>
      <span class="games-reward-copy"><strong>+${value} ${value === 1 ? "heart" : "hearts"}</strong>${label ? `<small>${escape(label)}</small>` : ""}</span>`;
    rewardLayer.append(pop);
    icons(pop);
    window.setTimeout(() => pop.remove(), reducedMotion() ? POP_MS + 400 : POP_MS);
  }

  /* ------------------------------ Public -------------------------------- */
  let refreshHub = () => Promise.resolve(null);
  window.DateGames = {
    reward,
    refresh: () => refreshHub(),
    nameOf,
    other,
    get data() { return hubData; }
  };

  /* ------------------------------- Hub ---------------------------------- */
  const section = $('[data-step="games"]');
  const tile = $("#games-tile");
  const tileNote = $("#games-tile-note");
  const statusEl = $("#games-status");
  const hubEl = $("#games-hub");
  const streakEl = $("#games-streak");
  const balancesEl = $("#games-balances");
  const todayEl = $("#games-today");
  const boardEl = $("#games-board");
  const badgesEl = $("#games-badges");

  let hubData = null;       // the last GET /games answer, tidied
  let loadSeq = 0;          // bumps per request, so an older answer can't overwrite a newer one
  let identitySeq = 0;
  let pollTimer = null;
  let tileAskedAt = 0;
  let tileDrawn = "";
  let nudging = false;
  let nudgeError = "";
  let badgesOpen = false;
  const drawn = {};

  const onHub = () => app()?.step === "games";

  function shortDay(iso, options) {
    const [year, month, date] = String(iso).slice(0, 10).split("-").map(Number);
    if (!year || !month || !date) return "";
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(new Date(Date.UTC(year, month - 1, date, 12)));
  }

  // "14:05" or "16 Oct" for a timestamp, in our time zone.
  function zurich(iso, options) {
    const at = new Date(iso);
    if (typeof iso !== "string" || !Number.isFinite(at.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", ...options }).format(at);
  }
  const clockTime = (iso) => zurich(iso, { hour: "2-digit", minute: "2-digit" });

  // Anything the page reads from the answer, with safe defaults (an older Worker, a module mid-rollout).
  function tidyStreak(value) {
    const streak = value && typeof value === "object" ? value : {};
    return {
      count: count(streak.count),
      best: count(streak.best),
      today: { her: Boolean(streak.today?.her), sender: Boolean(streak.today?.sender) },
      atRisk: Boolean(streak.atRisk),
      lastDays: Array.isArray(streak.lastDays)
        ? streak.lastDays.filter((entry) => entry && typeof entry.day === "string").slice(-7)
        : [],
      nudges: { her: streak.nudges?.her || null, sender: streak.nudges?.sender || null }
    };
  }

  function tidyPoints(value) {
    const person = (entry) => ({ earned: count(entry?.earned), spent: count(entry?.spent), balance: Math.round(Number(entry?.balance) || 0) });
    return { her: person(value?.her), sender: person(value?.sender) };
  }

  function tidy(value) {
    return {
      today: typeof value?.today === "string" ? value.today : app()?.todayISO?.() || "",
      streak: tidyStreak(value?.streak),
      points: tidyPoints(value?.points),
      games: (Array.isArray(value?.games) ? value.games : [])
        .filter((game) => game && typeof game === "object" && typeof game.id === "string" && game.id),
      badges: (Array.isArray(value?.badges) ? value.badges : [])
        .filter((badge) => badge && typeof badge === "object" && typeof badge.name === "string" && badge.name)
    };
  }

  // Replaces a block only when its markup changed, keeping focus on the same control.
  function put(element, key, html) {
    if (!element || drawn[key] === html) return;
    const focusKey = element.contains(document.activeElement) ? document.activeElement.dataset?.focus : "";
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
    if (focusKey) element.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
  }

  /* ----------------------------- Streak --------------------------------- */
  function streakHtml(data) {
    const { streak } = data;
    const mine = me();
    const theirs = other(mine);
    const them = nameOf(theirs);
    const head = streak.count > 0
      ? `<p class="games-streak-count"><strong>${streak.count}</strong> ${streak.count === 1 ? "day" : "days"}</p>
         <p class="games-streak-sub">in a row</p>`
      : `<p class="games-streak-count is-start">Start a streak today</p>
         <p class="games-streak-sub">A day counts when we both play</p>`;
    const best = streak.best > 0 ? `<p class="games-streak-best"><small>Best</small><strong>${streak.best}</strong></p>` : "";

    const days = streak.lastDays.map((entry) => {
      const both = Boolean(entry.her && entry.sender);
      const one = Boolean(entry.her || entry.sender);
      const who = entry[mine] ? "you" : them;
      const said = both ? "we both played" : one ? `only ${who} played` : "nobody played";
      const isToday = entry.day === data.today;
      return `<li class="games-day${both ? " is-both" : one ? " is-one" : ""}${isToday ? " is-today" : ""}">
          <span class="games-day-dot" aria-hidden="true"></span>
          <span class="games-day-name" aria-hidden="true">${escape(shortDay(entry.day, { weekday: "narrow" }))}</span>
          <span class="visually-hidden">${escape(isToday ? "Today" : shortDay(entry.day, { weekday: "long" }))}: ${escape(said)}</span>
        </li>`;
    }).join("");

    const chip = (who) => {
      const played = streak.today[who];
      return `<span class="games-played${played ? " is-played" : ""}">
          <i class="icon" data-lucide="${played ? "circle-check" : "hourglass"}" aria-hidden="true"></i>
          <span><b>${escape(who === mine ? "You" : nameOf(who))}</b> ${played ? "played" : "not yet"}</span>
        </span>`;
    };

    let nudge = "";
    if (streak.nudges[theirs] && !streak.today[mine]) {
      nudge += `<p class="games-nudged"><i class="icon" data-lucide="bell-ring" aria-hidden="true"></i><span>${escape(them)} nudged you: Don’t break our streak!</span></p>`;
    }
    if (!streak.today[theirs]) {
      nudge += streak.nudges[mine]
        ? `<p class="games-nudge-sent" data-focus="nudge" tabindex="-1"><i class="icon" data-lucide="check" aria-hidden="true"></i><span>You nudged ${escape(them)}${clockTime(streak.nudges[mine]) ? ` at ${escape(clockTime(streak.nudges[mine]))}` : ""}</span></p>`
        : `<button class="btn btn-secondary games-nudge" type="button" data-nudge data-focus="nudge"${nudging ? " disabled" : ""}>
             <i class="icon" data-lucide="bell-ring" aria-hidden="true"></i><span>${nudging ? "Nudging…" : `Nudge ${escape(them)}`}</span>
           </button>`;
    }
    if (nudgeError) nudge += `<p class="error games-nudge-error" role="alert">${escape(nudgeError)}</p>`;

    return `<div class="games-streak-top">
        <span class="games-flame${streak.count > 0 ? " is-lit" : ""}${streak.atRisk ? " is-at-risk" : ""}" aria-hidden="true"><i class="icon" data-lucide="flame" aria-hidden="true"></i></span>
        <div class="games-streak-copy">${head}</div>
        ${best}
      </div>
      <ol class="games-days" aria-label="The last 7 days">${days}</ol>
      <div class="games-played-row">${chip(mine)}${chip(theirs)}</div>
      ${nudge}`;
  }

  /* ----------------------------- Hearts --------------------------------- */
  function balancesHtml(data) {
    const mine = me();
    return [mine, other(mine)].map((who) => `<p class="games-balance${who === mine ? " is-me" : ""}">
        <i class="icon" data-lucide="heart" aria-hidden="true"></i>
        <strong>${escape(data.points[who].balance)}</strong>
        <small>${escape(who === mine ? "You" : nameOf(who))}</small>
      </p>`).join("");
  }

  /* ------------------------------ Today --------------------------------- */
  function rowHtml(game) {
    const status = PILLS[game.status] ? game.status : "idle";
    const line = String(game.line || "")
      .replace(/\{me\}/g, "You")
      .replace(/\{them\}/g, nameOf(other()));
    const step = typeof game.step === "string" && game.step ? game.step : game.id;
    return `<li><button class="games-row is-${status}" type="button" data-action="goto" data-target="${escape(step)}" data-focus="row-${escape(game.id)}">
        <span class="games-row-icon"><i class="icon" data-lucide="${iconName(game.icon, "sparkles")}" aria-hidden="true"></i></span>
        <span class="games-row-copy"><strong>${escape(game.title || game.id)}</strong>${line ? `<small>${escape(line)}</small>` : ""}</span>
        ${PILLS[status] ? `<span class="games-pill is-${status}">${PILLS[status]}</span>` : ""}
        <i class="icon games-row-chevron" data-lucide="chevron-right" aria-hidden="true"></i>
      </button></li>`;
  }

  /* --------------------------- Leaderboard ------------------------------ */
  const numberOf = (value) => {
    if (value === null || value === undefined || value === "") return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  };

  function shown(value) {
    if (value === null || value === undefined || value === "") return "–";
    if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
    return String(value);
  }

  // Who wins a row: the higher number, or the lower one for `lowerWins` rows (where 0 means no games yet).
  function leaderOf(row) {
    let her = numberOf(row.her);
    let sender = numberOf(row.sender);
    if (row.lowerWins) {
      if (her === null || sender === null || her <= 0 || sender <= 0 || her === sender) return null;
      return her < sender ? "her" : "sender";
    }
    her = her ?? 0;
    sender = sender ?? 0;
    if (her === sender || Math.max(her, sender) <= 0) return null;
    return her > sender ? "her" : "sender";
  }

  function boardHtml(data) {
    const mine = me();
    const rows = [{ label: "Hearts earned", her: data.points.her.earned, sender: data.points.sender.earned }];
    data.games.forEach((game) => (Array.isArray(game.board) ? game.board : []).forEach((row) => {
      if (row && typeof row === "object" && typeof row.label === "string" && row.label) rows.push(row);
    }));
    const crowns = { her: 0, sender: 0 };
    const crown = '<i class="icon games-crown" data-lucide="crown" aria-hidden="true"></i><span class="visually-hidden"> (ahead)</span>';
    const body = rows.map((row) => {
      const label = `<span class="games-board-label" role="rowheader">${escape(row.label)}</span>`;
      const shared = row.her === undefined && row.sender === undefined;
      if (shared) {
        return `<div class="games-board-row" role="row">${label}<span class="games-board-shared" role="cell" aria-colspan="2">${escape(shown(row.value))}</span></div>`;
      }
      const lead = leaderOf(row);
      if (lead) crowns[lead] += 1;
      // In a lower-wins row (average tries) 0 means no games yet.
      const value = (who) => (row.lowerWins && numberOf(row[who]) !== null && numberOf(row[who]) <= 0 ? null : row[who]);
      const cell = (who) => `<span class="games-board-cell${who === mine ? " is-me" : ""}${lead === who ? " is-lead" : ""}" role="cell">${escape(shown(value(who)))}${lead === who ? crown : ""}</span>`;
      return `<div class="games-board-row${row.lowerWins ? " is-lower" : ""}" role="row">${label}${cell("her")}${cell("sender")}</div>`;
    }).join("");

    const head = `<div class="games-board-row is-head" role="row">
        <span class="games-board-label" role="columnheader"><span class="visually-hidden">Game</span></span>
        ${["her", "sender"].map((who) => `<span class="games-board-cell${who === mine ? " is-me" : ""}" role="columnheader">${escape(nameOf(who))}${who === mine ? '<span class="visually-hidden"> (you)</span>' : ""}</span>`).join("")}
      </div>`;

    const mineCrowns = crowns[mine];
    const theirCrowns = crowns[other(mine)];
    let lead = "";
    if (mineCrowns || theirCrowns) {
      const text = mineCrowns === theirCrowns
        ? `All square: ${plural(mineCrowns, "crown")} each`
        : mineCrowns > theirCrowns
          ? `You’re ahead, ${plural(mineCrowns, "crown")} to ${theirCrowns}`
          : `${nameOf(other(mine))} is ahead, ${plural(theirCrowns, "crown")} to ${mineCrowns}`;
      lead = `<p class="games-board-lead"><i class="icon" data-lucide="crown" aria-hidden="true"></i><span>${escape(text)}</span></p>`;
    }
    return { lead, table: head + body };
  }

  /* ------------------------------ Badges -------------------------------- */
  function badgesHtml(data) {
    if (!data.badges.length) {
      return `<button class="games-badges-empty" type="button" data-action="goto" data-target="challenges" data-focus="badges-empty">
          <span class="games-row-icon"><i class="icon" data-lucide="award" aria-hidden="true"></i></span>
          <span>Finish a weekly challenge together to earn badges</span>
          <i class="icon games-row-chevron" data-lucide="chevron-right" aria-hidden="true"></i>
        </button>`;
    }
    const list = badgesOpen ? data.badges : data.badges.slice(0, BADGES_SHOWN);
    const more = data.badges.length - list.length;
    return `<ul class="games-badge-grid">${list.map((badge) => {
      const when = zurich(badge.at, { day: "numeric", month: "short" });
      return `<li class="games-badge">
          <span class="games-badge-icon"><i class="icon" data-lucide="${iconName(badge.icon, "award")}" aria-hidden="true"></i></span>
          <strong>${escape(badge.name)}</strong>${when ? `<small>${escape(when)}</small>` : ""}
        </li>`;
    }).join("")}</ul>${more > 0 ? `<button class="btn btn-ghost games-more" type="button" data-badges-more data-focus="badges-more">Show all ${data.badges.length}</button>` : ""}`;
  }

  /* ------------------------------ Render -------------------------------- */
  function showStatus(message, { retry = false } = {}) {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.innerHTML = `<span>${escape(message)}</span>${retry ? ' <button class="games-retry" type="button" data-games-retry>Try again</button>' : ""}`;
    if (hubEl) hubEl.hidden = true;
  }

  function render() {
    if (!section || !hubData) return;
    statusEl.hidden = true;
    hubEl.hidden = false;
    put(streakEl, "streak", streakHtml(hubData));
    streakEl.classList.toggle("is-lit", hubData.streak.count > 0);
    put(balancesEl, "balances", balancesHtml(hubData));
    put(todayEl, "today", [...hubData.games, FRY_GAME].map(rowHtml).join(""));
    const board = boardHtml(hubData);
    put(boardEl, "board", `${board.lead}<div class="games-board-table" role="table" aria-labelledby="games-board-label">${board.table}</div>`);
    put(badgesEl, "badges", badgesHtml(hubData));
  }

  /* ------------------------------- Tile --------------------------------- */
  function updateTile() {
    if (!tileNote) return;
    const days = hubData?.streak.count || 0;
    const news = Boolean(hubData?.games.some((game) => game.status === "todo" || game.status === "new"));
    const html = days > 0
      ? `<i class="icon games-tile-flame" data-lucide="flame" aria-hidden="true"></i>${days}-day streak`
      : "Play together";
    if (html !== tileDrawn) {
      tileNote.innerHTML = html;
      tileDrawn = html;
      icons(tileNote);
    }
    tile?.classList.toggle("has-news", news);
    tile?.classList.toggle("has-streak", days > 0);
    tile?.setAttribute("aria-label", `Games, ${days > 0 ? `${days}-day streak` : "play together"}${news ? ", your turn" : ""}`);
  }

  /* ------------------------------- Sync --------------------------------- */
  async function load({ quiet = false } = {}) {
    if (!app()?.apiRequest) return hubData;
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!hubData && !quiet && onHub()) showStatus("Loading our games…");
    try {
      const data = await app().apiRequest(`/games?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq) return hubData;
      hubData = tidy(data);
      tileAskedAt = Date.now();
      updateTile();
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || hubData || !onHub()) return hubData;
      showStatus(error.status === 404
        ? "The games need the latest server update first."
        : "Couldn’t load the games. Check your connection and try again.", { retry: !error.status || error.status >= 500 });
    }
    return hubData;
  }
  refreshHub = () => load({ quiet: true });

  // Cheap check for the plan page tile: at most once a minute.
  function refreshTile({ force = false } = {}) {
    if (!tileNote || document.hidden) return;
    if (!force && Date.now() - tileAskedAt < TILE_MS) return;
    tileAskedAt = Date.now();
    load({ quiet: true });
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (!document.hidden && onHub()) load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------ Actions ------------------------------- */
  async function sendNudge() {
    if (nudging || !hubData) return;
    const author = me();
    const identity = identitySeq;
    nudging = true;
    nudgeError = "";
    loadSeq += 1;
    render();
    try {
      const data = await app().apiRequest("/games/nudge", "POST", { author });
      if (identity !== identitySeq) return;
      if (data?.streak) hubData.streak = tidyStreak(data.streak);
      else hubData.streak.nudges[author] = data?.nudgedAt || new Date().toISOString();
      postActivity({ kind: "streak.nudge", text: "nudged you: Don’t break our streak!", step: "games", icon: "flame", push: true });
    } catch (error) {
      if (identity !== identitySeq) return;
      nudgeError = error.status ? error.message : "Couldn’t send the nudge. Check your connection and try again.";
      if (error.status) load({ quiet: true });
    } finally {
      if (identity === identitySeq) {
        nudging = false;
        render();
        updateTile();
        // The disabled button dropped focus; put it on the note (or the button again).
        if (onHub() && (!document.activeElement || document.activeElement === document.body)) {
          streakEl.querySelector('[data-focus="nudge"]')?.focus({ preventScroll: true });
        }
      }
    }
  }

  /* ------------------------------- Wiring ------------------------------- */
  function resetIdentity() {
    identitySeq += 1;
    loadSeq += 1;
    hubData = null;
    nudging = false;
    nudgeError = "";
    badgesOpen = false;
    tileAskedAt = 0;
    Object.keys(drawn).forEach((key) => { delete drawn[key]; });
    updateTile();
    if (!section) return;
    showStatus("Loading our games…");
    if (onHub()) load();
    else if (app()?.step === "planned") refreshTile({ force: true });
  }

  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });

  section?.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button || button.disabled) return;
    if (button.matches("[data-nudge]")) sendNudge();
    else if (button.matches("[data-games-retry]")) load();
    else if (button.matches("[data-badges-more]")) {
      badgesOpen = true;
      render();
      badgesEl.querySelector(`.games-badge:nth-child(${BADGES_SHOWN + 1})`)?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
    }
  });

  document.addEventListener("date:step", (event) => {
    const { name } = event.detail;
    if (name === "games") {
      nudgeError = "";
      if (hubData) render();
      load();
      startPolling();
    } else {
      stopPolling();
    }
    if (name === "planned") refreshTile();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
    if (onHub()) load({ quiet: true });
    else if (app()?.step === "planned") refreshTile();
  });
})();
