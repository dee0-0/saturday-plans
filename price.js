/*
 * Price is right: 3 things a day, both of us guess what each costs (Swiss francs).
 * After sending your guesses you see the real prices; the other one's guesses and
 * who was closer show once they guessed too. Looks from match.css + quick.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="price"]');
  if (!section) return;

  const ledeEl = $("#price-lede");
  const statusEl = $("#price-status");
  const form = $("#price-form");
  const itemsEl = $("#price-items");
  const sendButton = $("#price-send");
  const resultEl = $("#price-result");
  const errorEl = $("#price-error");
  const statsEl = $("#price-stats");

  const POLL_MS = 15000;

  let data = null;
  let saving = false;
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let formDay = "";
  let drawn = { result: "", stats: "" };

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  const iconHtml = (name, fallback = "tag") => `<i class="icon" data-lucide="${ICON_NAME.test(name || "") ? name : fallback}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;
  const money = (value) => {
    const number = Number(value) || 0;
    return `Fr. ${number >= 100 ? Math.round(number).toLocaleString("de-CH") : number.toFixed(2).replace(/\.00$/, ".–")}`;
  };

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

  const parse = (text) => {
    const clean = String(text || "").replace(/['’\s]/g, "").replace(",", ".").replace(/^fr\.?/i, "");
    if (!clean) return null;
    const number = Number(clean);
    return Number.isFinite(number) && number >= 0 ? number : null;
  };

  /* --------------------------------- Form --------------------------------- */
  function renderForm() {
    if (formDay === data.day) return; // keep what's typed while polling
    formDay = data.day;
    itemsEl.innerHTML = data.items.map((item, index) => `
      <li class="price-item">
        <span class="price-icon">${iconHtml(item.icon)}</span>
        <label class="price-name" for="price-guess-${index}">${escape(item.name)}</label>
        <span class="price-input"><span aria-hidden="true">Fr.</span>
          <input id="price-guess-${index}" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="${index < 2 ? "next" : "done"}" placeholder="0" maxlength="10"></span>
      </li>`).join("");
    icons(itemsEl);
    updateSend();
  }

  function guesses() {
    return [...itemsEl.querySelectorAll("input")].map((input) => parse(input.value));
  }

  function updateSend() {
    sendButton.disabled = saving || guesses().some((guess) => guess === null);
  }

  async function submit(event) {
    event?.preventDefault();
    if (!data || saving || data.mine) return;
    const values = guesses();
    if (values.some((guess) => guess === null)) {
      showError("Guess all 3 prices first (just a number).");
      return;
    }
    saving = true;
    updateSend();
    showError("");
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/price", "POST", { author: me(), day: data.day, guesses: values });
      if (identity !== identitySeq) return;
      saving = false;
      data = result;
      render();
      const res = result.result;
      postActivity({
        kind: "price.played",
        text: res ? (res.winner === me() ? "won today’s price is right" : res.winner === "tie" ? "played price is right: a tie" : "played price is right: you won") : "guessed today’s prices",
        step: "price",
        icon: "tag",
        push: true
      });
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
      resultEl.scrollIntoView({ block: "nearest", behavior: "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      updateSend();
      showError(error.status ? error.message : "Couldn’t send your guesses. Check your connection and try again.");
      if (error.status === 409) load();
    }
  }

  /* -------------------------------- Result -------------------------------- */
  function resultHtml() {
    const them = escape(nameOf(other()));
    const res = data.result;
    const rows = data.items.map((item, index) => {
      const row = res?.items?.[index];
      const mine = data.mine[index];
      const theirs = data.theirs?.[index];
      const mark = (who) => (row?.winner === who || row?.winner === "tie" ? " is-win" : "");
      const spot = (who) => (row?.spotOn?.[who] ? `<em class="price-spot">Spot on</em>` : "");
      return `<li class="price-item is-done">
          <span class="price-icon">${iconHtml(item.icon)}</span>
          <span class="price-name">${escape(item.name)}</span>
          <span class="price-real"><small>About</small>${escape(money(item.price))}</span>
          <span class="price-guesses">
            <span class="price-guess${mark(me())}">You: ${escape(money(mine))}${spot(me())}</span>
            <span class="price-guess${mark(other())}">${them}: ${theirs === undefined || theirs === null ? "…" : escape(money(theirs))}${spot(other())}</span>
          </span>
        </li>`;
    }).join("");
    let head;
    if (!res) {
      head = `<div class="match-waiting"><span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">Waiting for ${them}…</p>
          <p class="match-waiting-copy">Here are the real prices. Don’t tell ${them}!</p></div></div>`;
    } else {
      const score = `${res.points[me()]} : ${res.points[other()]}`.replace(/\.5/g, "½");
      const message = res.winner === "tie" ? "A tie!" : res.winner === me() ? "You won today!" : `${them} won today!`;
      head = `<div class="match-score"><p class="match-score-big"><strong>${escape(score)}</strong></p><p class="match-score-msg">${escape(message)}</p></div>`;
    }
    return `${head}<ol class="price-items">${rows}</ol>`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    return `<div class="match-stat"><dt>Wins</dt><dd><strong>${Number(stats.wins?.[me()]) || 0} : ${Number(stats.wins?.[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Spot on</dt><dd><strong>${Number(stats.spotOn?.[me()]) || 0} : ${Number(stats.spotOn?.[other()]) || 0}</strong><small>within 10%</small></dd></div>
      <div class="match-stat"><dt>Played</dt><dd><strong>${Number(stats.daysPlayed) || 0}</strong><small>days together</small></dd></div>`;
  }

  function put(element, key, html) {
    if (drawn[key] === html) return;
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
  }

  function render() {
    if (!data) return;
    statusEl.hidden = true;
    const done = Array.isArray(data.mine);
    ledeEl.hidden = done;
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already guessed. Your turn!` : "Guess what each one costs, in Swiss francs. Closest guess wins.";
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));
    form.hidden = done;
    if (!done) renderForm();
    resultEl.hidden = !done;
    if (done) put(resultEl, "result", resultHtml());
    const stats = statsHtml(data.stats);
    statsEl.hidden = !stats;
    put(statsEl, "stats", stats);
  }

  /* -------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    if (saving) return;
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s prices…";
      form.hidden = true;
      resultEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/price?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || saving) return;
      if (data?.day !== result.day) formDay = "";
      data = result;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "Price is right needs the latest server update first." : "Couldn’t load today’s prices. Check your connection and try again.";
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "price") return;
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
    saving = false;
    formDay = "";
    drawn = { result: "", stats: "" };
    itemsEl.innerHTML = "";
    resultEl.innerHTML = "";
    statsEl.innerHTML = "";
    showError("");
    if (app()?.step === "price") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  form.addEventListener("submit", submit);
  itemsEl.addEventListener("input", () => {
    showError("");
    updateSend();
  });
  itemsEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || !event.target.matches("input")) return;
    event.preventDefault();
    const inputs = [...itemsEl.querySelectorAll("input")];
    const next = inputs[inputs.indexOf(event.target) + 1];
    if (next) next.focus();
    else submit();
  });
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "price") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "price") load({ quiet: true });
  });
})();
