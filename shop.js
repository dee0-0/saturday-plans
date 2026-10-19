/*
 * Love shop: rewards we set up ourselves and buy with the hearts we earn in the
 * games. The other one makes a bought reward happen ("Done"); the buyer can
 * cancel an open one and gets the hearts back. Synced through the Worker
 * (GET/POST /games/shop) and polled while the page is open.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="shop"]');
  if (!section) return;

  const balanceEl = $("#shop-balance");
  const mineEl = $("#shop-balance-mine");
  const theirsEl = $("#shop-balance-theirs");
  const statusEl = $("#shop-status");
  const waitingWrap = $("#shop-waiting-wrap");
  const waitingEl = $("#shop-waiting");
  const waitingCount = $("#shop-waiting-count");
  const itemsWrap = $("#shop-items-wrap");
  const gridEl = $("#shop-grid");
  const quickEl = $("#shop-quick");
  const chipsEl = $("#shop-chips");
  const errorEl = $("#shop-error");
  const addEl = $("#shop-add");
  const form = $("#shop-form");
  const titleInput = $("#shop-title");
  const costInput = $("#shop-cost");
  const iconsEl = $("#shop-icons");
  const submitButton = $("#shop-submit");
  const historyEl = $("#shop-history");
  const historyList = $("#shop-history-list");
  const historyCount = $("#shop-history-count");

  const POLL_MS = 12000;
  const MAX_TITLE = 60;
  const MIN_COST = 1;
  const MAX_COST = 500;
  const COST_STEP = 5;
  const OFFLINE = "Check your connection and try again.";
  // The same icons the Worker accepts (worker/src/games/shop.js), with a name for screen readers.
  const ICONS = [
    ["gift", "Gift"], ["heart", "Heart"], ["hand-heart", "Caring hand"], ["utensils", "Dinner"],
    ["croissant", "Croissant"], ["coffee", "Coffee"], ["cake-slice", "Cake"], ["ice-cream-cone", "Ice cream"],
    ["pizza", "Pizza"], ["clapperboard", "Movie"], ["sofa", "Sofa"], ["sparkles", "Sparkles"],
    ["flower-2", "Flower"], ["music", "Music"], ["car", "Car"], ["moon", "Moon"]
  ];
  const ICON_NAMES = ICONS.map(([name]) => name);
  const QUICK = [
    { title: "A massage", cost: 20, icon: "hand-heart" },
    { title: "I pick the restaurant", cost: 15, icon: "utensils" },
    { title: "Breakfast in bed", cost: 30, icon: "croissant" },
    { title: "Movie of my choice", cost: 10, icon: "clapperboard" },
    { title: "Dessert on you", cost: 10, icon: "cake-slice" },
    { title: "A day without chores", cost: 25, icon: "sofa" },
    { title: "A surprise date", cost: 40, icon: "sparkles" }
  ];

  let data = null;      // the last answer from the server
  let loaded = false;
  let busy = false;     // one change at a time
  let epoch = 0;        // bumps on every change, so an older poll can't undo it
  let pollTimer = null;
  let chosenIcon = "gift";
  let lastBalance = null;
  const drawn = {};

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = (who) => (who === "her" ? "sender" : "her");
  const escape = (text) => app().escapeHtml(text ?? "");
  const nameOf = (who) => app()?.names?.[who] || (who === "her" ? "Her" : "Your date");
  const hearts = (count) => `${count} ${Math.abs(count) === 1 ? "heart" : "hearts"}`;
  const moreHearts = (count) => `${count} more ${count === 1 ? "heart" : "hearts"}`;
  const iconOf = (name) => (ICON_NAMES.includes(name) ? name : "gift");
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sameTitle = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // The bell on the other phone (activity.js); never let it break the shop.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  // Offline the browser only says "Failed to fetch" / "Load failed", so say it in plain words.
  function friendly(error) {
    if (!error?.status) return `Couldn’t save that. ${OFFLINE}`;
    if (error.status === 409 && Number.isFinite(error.data?.cost) && Number.isFinite(error.data?.balance)) {
      return `Not enough hearts yet. You need ${moreHearts(error.data.cost - error.data.balance)}.`;
    }
    return error.message;
  }

  function shortDate(iso) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", day: "numeric", month: "short" }).format(date);
  }

  // Replaces a block only when its markup changed, keeping focus on the same control.
  function put(element, html) {
    if (drawn[element.id] === html) return false;
    const focusKey = element.contains(document.activeElement) ? document.activeElement.dataset?.focus : "";
    element.innerHTML = html;
    drawn[element.id] = html;
    icons(element);
    if (focusKey) element.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    return true;
  }

  function balanceOf(who) {
    return Math.round(Number(data?.points?.[who]?.balance) || 0);
  }

  /* ------------------------------- Render -------------------------------- */
  function itemHtml(item) {
    const need = item.cost - balanceOf(me());
    const title = escape(item.title);
    const buy = need > 0
      ? `<button class="shop-buy" type="button" disabled aria-label="${escape(moreHearts(need))} needed for ${title}">${escape(moreHearts(need))}</button>`
      : `<button class="shop-buy" type="button" data-buy data-focus="buy-${escape(item.id)}" aria-label="Buy ${title} for ${escape(hearts(item.cost))}"${busy ? " disabled" : ""}>Buy</button>`;
    return `<li class="shop-item${need > 0 ? " is-short" : ""}" data-id="${escape(item.id)}">
        <button class="planner-icon-btn shop-remove" type="button" data-remove data-focus="remove-${escape(item.id)}" aria-label="Remove ${title} from the shop"${busy ? " disabled" : ""}><i class="icon" data-lucide="x" aria-hidden="true"></i></button>
        <span class="shop-item-icon" aria-hidden="true"><i class="icon" data-lucide="${iconOf(item.icon)}"></i></span>
        <strong class="shop-item-title">${title}</strong>
        <span class="shop-cost"><i class="icon" data-lucide="heart" aria-hidden="true"></i>${item.cost}<span class="visually-hidden"> hearts</span></span>
        ${buy}
      </li>`;
  }

  function waitingHtml(purchase) {
    const mine = purchase.buyer === me();
    const title = escape(purchase.title);
    const line = mine ? `Waiting for ${nameOf(other(me()))}` : `${nameOf(purchase.buyer)} bought this`;
    const action = mine
      ? `<button class="shop-row-btn" type="button" data-cancel data-focus="cancel-${escape(purchase.id)}" aria-label="Cancel ${title} and get your hearts back"${busy ? " disabled" : ""}>Cancel</button>`
      : `<button class="shop-row-btn is-primary" type="button" data-done data-focus="done-${escape(purchase.id)}" aria-label="${title} happened: mark it done"${busy ? " disabled" : ""}><i class="icon" data-lucide="check" aria-hidden="true"></i>Done</button>`;
    return `<li class="shop-row${mine ? "" : " is-theirs"}" data-id="${escape(purchase.id)}">
        <span class="shop-row-icon" aria-hidden="true"><i class="icon" data-lucide="${iconOf(purchase.icon)}"></i></span>
        <span class="shop-row-copy"><strong>${title}</strong><small>${escape(line)} · ${escape(hearts(purchase.cost))}</small></span>
        ${action}
      </li>`;
  }

  function historyHtml(purchase) {
    const buyer = purchase.buyer === me() ? "You" : nameOf(purchase.buyer);
    const when = shortDate(purchase.doneAt);
    return `<li class="shop-row is-done">
        <span class="shop-row-icon" aria-hidden="true"><i class="icon" data-lucide="${iconOf(purchase.icon)}"></i></span>
        <span class="shop-row-copy"><strong>${escape(purchase.title)}</strong><small>${escape(`${buyer} bought it${when ? ` · happened ${when}` : ""}`)}</small></span>
        <span class="shop-row-cost">${escape(String(purchase.cost))}<i class="icon" data-lucide="heart" aria-hidden="true"></i></span>
      </li>`;
  }

  function chipsHtml(items) {
    return QUICK.filter((chip) => !items.some((item) => sameTitle(item.title, chip.title))).map((chip) => (
      `<button class="shop-chip" type="button" data-quick="${escape(chip.title)}" data-focus="quick-${escape(chip.title)}"${busy ? " disabled" : ""}>
        <i class="icon" data-lucide="${chip.icon}" aria-hidden="true"></i><span>${escape(chip.title)}</span><b>${chip.cost}<span class="visually-hidden"> hearts</span></b>
      </button>`
    )).join("");
  }

  function render() {
    if (!loaded || !data) return;
    statusEl.hidden = true;
    const mine = balanceOf(me());
    mineEl.textContent = `You have ${hearts(mine)}`;
    theirsEl.textContent = `${nameOf(other(me()))}: ${hearts(balanceOf(other(me())))}`;
    if (lastBalance !== null && lastBalance !== mine && !reduced()) {
      balanceEl.classList.remove("is-bump");
      void balanceEl.offsetWidth;
      balanceEl.classList.add("is-bump");
    }
    lastBalance = mine;

    const items = Array.isArray(data.items) ? data.items : [];
    const purchases = Array.isArray(data.purchases) ? data.purchases : [];
    // Things I should make happen come first.
    const open = purchases.filter((item) => !item.doneAt).sort((a, b) => Number(a.buyer === me()) - Number(b.buyer === me()));
    const done = purchases.filter((item) => item.doneAt);

    waitingWrap.hidden = !open.length;
    waitingCount.textContent = String(open.length);
    put(waitingEl, open.map(waitingHtml).join(""));

    itemsWrap.hidden = false;
    gridEl.hidden = !items.length;
    put(gridEl, items.map(itemHtml).join(""));
    quickEl.hidden = items.length > 0;
    put(chipsEl, items.length ? "" : chipsHtml(items));

    historyEl.hidden = !done.length;
    historyCount.textContent = String(done.length);
    put(historyList, done.map(historyHtml).join(""));
    submitButton.disabled = busy;
  }

  function renderIcons() {
    iconsEl.innerHTML = ICONS.map(([name, label]) => (
      `<button class="shop-icon-choice" type="button" role="radio" data-icon="${name}" aria-label="${label}" aria-checked="${name === chosenIcon}" tabindex="${name === chosenIcon ? "0" : "-1"}"><i class="icon" data-lucide="${name}" aria-hidden="true"></i></button>`
    )).join("");
    icons(iconsEl);
  }

  function chooseIcon(name, focus = false) {
    chosenIcon = iconOf(name);
    iconsEl.querySelectorAll("[data-icon]").forEach((button) => {
      const on = button.dataset.icon === chosenIcon;
      button.setAttribute("aria-checked", String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus({ preventScroll: true });
    });
  }

  /* ------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    const started = epoch;
    if (!loaded && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Opening the shop…";
    }
    try {
      const result = await app().apiRequest(`/games/shop?author=${encodeURIComponent(me())}`);
      if (started !== epoch || busy) return;
      data = result;
      loaded = true;
      if (!quiet) showError("");
      render();
    } catch (error) {
      if (loaded || quiet) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404
        ? "The love shop needs the latest server update first."
        : `Couldn’t open the shop. ${OFFLINE}`;
    }
  }

  async function send(body) {
    if (busy) throw new Error("Busy.");
    busy = true;
    epoch += 1;
    showError("");
    render();
    try {
      const result = await app().apiRequest("/games/shop", "POST", { author: me(), ...body });
      data = result;
      return result;
    } catch (error) {
      showError(friendly(error));
      throw error;
    } finally {
      busy = false;
      epoch += 1;
      render();
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (!document.hidden && app()?.step === "shop") load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function flash(list, id) {
    const row = [...list.children].find((element) => element.dataset.id === id);
    if (!row || reduced()) return;
    row.classList.remove("is-flash");
    void row.offsetWidth;
    row.classList.add("is-flash");
  }

  /* ------------------------------ Actions -------------------------------- */
  function clampCost(value) {
    const number = Math.round(Number(String(value).replace(/[^\d]/g, "")) || 0);
    return Math.min(MAX_COST, Math.max(MIN_COST, number));
  }

  async function add({ title, cost, icon }) {
    const known = new Set((data?.items || []).map((item) => item.id));
    const result = await send({ action: "add", title, cost, icon });
    const added = (result.items || []).find((item) => !known.has(item.id));
    if (added) {
      postActivity({ kind: "shop.add", text: "added a reward to the love shop", detail: `${added.title} · ${hearts(added.cost)}`, step: "shop", icon: "gift", push: false });
      flash(gridEl, added.id);
    }
    return added;
  }

  async function addFromForm() {
    const title = titleInput.value.replace(/\s+/g, " ").trim();
    if (!title) {
      showError("Give the reward a name first.");
      titleInput.focus();
      return;
    }
    if (title.length > MAX_TITLE) {
      showError(`Keep the name under ${MAX_TITLE} characters.`);
      return;
    }
    const cost = clampCost(costInput.value);
    costInput.value = String(cost);
    try {
      const added = await add({ title, cost, icon: chosenIcon });
      titleInput.value = "";
      addEl.open = false;
      const tile = added && [...gridEl.children].find((element) => element.dataset.id === added.id);
      tile?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
      tile?.querySelector("[data-buy], .shop-buy")?.focus?.({ preventScroll: true });
    } catch { /* The error is on screen; the form keeps what was typed. */ }
  }

  async function buy(id) {
    const item = data?.items.find((entry) => entry.id === id);
    if (!item || busy) return;
    if (!window.confirm(`Spend ${hearts(item.cost)} on ${item.title}?`)) return;
    const known = new Set((data.purchases || []).map((entry) => entry.id));
    try {
      const result = await send({ action: "buy", id });
      const bought = (result.purchases || []).find((entry) => !known.has(entry.id));
      postActivity({ kind: "shop.buy", text: `bought ${item.title} from the love shop`, detail: hearts(item.cost), step: "shop", icon: "shopping-bag", push: true });
      window.DateGames?.refresh?.();
      if (bought) {
        flash(waitingEl, bought.id);
        [...waitingEl.children].find((element) => element.dataset.id === bought.id)?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
      }
      if (!reduced()) window.LetterFX?.burstFrom?.(balanceEl, 18);
    } catch { /* Shown by send(). */ }
  }

  async function markDone(id) {
    const purchase = data?.purchases.find((entry) => entry.id === id);
    if (!purchase || busy) return;
    if (!window.confirm(`Did “${purchase.title}” happen? It moves to Done for both of you.`)) return;
    try {
      await send({ action: "done", id });
      postActivity({ kind: "shop.done", text: `made it happen: ${purchase.title}`, step: "shop", icon: "gift", push: true });
      window.DateGames?.refresh?.();
    } catch { /* Shown by send(). */ }
  }

  async function cancel(id) {
    const purchase = data?.purchases.find((entry) => entry.id === id);
    if (!purchase || busy) return;
    if (!window.confirm(`Cancel “${purchase.title}”? You get your ${hearts(purchase.cost)} back.`)) return;
    try {
      await send({ action: "cancel", id });
      window.DateGames?.refresh?.();
    } catch { /* Shown by send(). */ }
  }

  async function remove(id) {
    const item = data?.items.find((entry) => entry.id === id);
    if (!item || busy) return;
    if (!window.confirm(`Remove “${item.title}” from the shop? It disappears for both of you.`)) return;
    try { await send({ action: "remove", id }); } catch { /* Shown by send(). */ }
  }

  /* ------------------------------- Wiring -------------------------------- */
  gridEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    const id = button?.closest(".shop-item")?.dataset.id;
    if (!button || !id || button.disabled) return;
    if (button.matches("[data-buy]")) buy(id);
    else if (button.matches("[data-remove]")) remove(id);
  });
  waitingEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    const id = button?.closest(".shop-row")?.dataset.id;
    if (!button || !id || button.disabled) return;
    if (button.matches("[data-done]")) markDone(id);
    else if (button.matches("[data-cancel]")) cancel(id);
  });
  chipsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-quick]");
    const chip = QUICK.find((entry) => entry.title === button?.dataset.quick);
    if (!chip || button.disabled || busy) return;
    add(chip).catch(() => {});
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!loaded) {
      load();
      return;
    }
    if (!busy) addFromForm();
  });
  form.addEventListener("click", (event) => {
    const step = event.target.closest("[data-delta]");
    if (!step) return;
    const delta = Number(step.dataset.delta);
    const current = clampCost(costInput.value);
    // Steps land on multiples of 5 (1 → 5 → 10 …), never below 1.
    const next = delta > 0 ? Math.floor(current / COST_STEP) * COST_STEP + COST_STEP : Math.ceil(current / COST_STEP) * COST_STEP - COST_STEP;
    costInput.value = String(Math.min(MAX_COST, Math.max(MIN_COST, next)));
  });
  costInput.addEventListener("input", () => {
    costInput.value = costInput.value.replace(/[^\d]/g, "").slice(0, 3);
  });
  costInput.addEventListener("blur", () => {
    costInput.value = String(clampCost(costInput.value));
  });
  iconsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-icon]");
    if (button) chooseIcon(button.dataset.icon);
  });
  // Arrow keys move through the icons like any radio group.
  iconsEl.addEventListener("keydown", (event) => {
    const keys = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const index = ICON_NAMES.indexOf(chosenIcon);
    chooseIcon(ICON_NAMES[(index + keys[event.key] + ICON_NAMES.length) % ICON_NAMES.length], true);
  });
  addEl.addEventListener("toggle", () => {
    if (addEl.open) titleInput.focus({ preventScroll: true });
  });

  renderIcons();

  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "shop") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "shop") load({ quiet: true });
  });
})();
