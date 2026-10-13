/*
 * Snack wishlist: one shared list for our dates. Either of us adds snacks
 * (typed or quick-add chips), ticks them off once they're in the bag, and
 * clears the done ones. Synced through the Worker; changes show instantly
 * and roll back if saving fails.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="snacks"]');
  if (!section) return;

  const form = $("#snack-form");
  const input = $("#snack-input");
  const chipsEl = $("#snack-chips");
  const errorEl = $("#snack-error");
  const openList = $("#snack-open");
  const emptyEl = $("#snack-empty");
  const doneWrap = $("#snack-done");
  const doneList = $("#snack-done-list");
  const doneCount = $("#snack-done-count");
  const clearButton = $("#snack-clear");

  const POLL_MS = 8000;
  const MAX_NAME = 60;

  let confirmed = [];   // last list the server sent
  let pending = [];     // optimistic changes still on their way
  let loaded = false;
  let epoch = 0;        // bumps on every change, so an older poll can't undo it
  let queue = Promise.resolve();
  let pollTimer = null;
  let tempCount = 0;
  const rendered = new WeakMap();

  const app = () => window.DateApp;
  const me = () => app().me();
  const escape = (text) => app().escapeHtml(text ?? "");
  const sameName = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const time = (iso) => Date.parse(iso) || 0;

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // What the page shows: the server's list with the not-yet-saved changes on top.
  function current() {
    const list = confirmed.map((snack) => ({ ...snack }));
    pending.forEach((op) => op.apply(list));
    return list;
  }

  /* ------------------------------- Render -------------------------------- */
  function itemHtml(snack) {
    const name = escape(snack.name);
    const who = app().names[snack.done ? snack.doneBy : snack.author];
    const note = snack.done ? (who ? `${who} got it` : "Got it") : `added by ${who || "one of us"}`;
    const busy = snack.pending ? " disabled" : "";
    return `<button class="snack-check" type="button" role="checkbox" aria-checked="${Boolean(snack.done)}" aria-label="Got ${name}" data-toggle data-focus="toggle"${busy}><i class="icon" data-lucide="check" aria-hidden="true"></i></button>
      <span class="snack-copy"><strong>${name}</strong><small>${escape(snack.pending ? "Adding…" : note)}</small></span>
      <button class="planner-icon-btn snack-remove" type="button" aria-label="Remove ${name}" data-remove data-focus="remove"${busy}><i class="icon" data-lucide="x" aria-hidden="true"></i></button>`;
  }

  // Updates the list in place, so polling doesn't replay animations or steal focus.
  function syncList(listEl, snacks) {
    const items = new Map([...listEl.children].map((element) => [element.dataset.id, element]));
    snacks.forEach((snack, index) => {
      let element = items.get(snack.id);
      if (!element) {
        // A just-saved snack keeps the row it had while it was still "Adding…".
        element = [...items.values()].find((row) => row.dataset.temp && sameName(row.dataset.name, snack.name) && !snacks.some((item) => item.id === row.dataset.id));
        if (element) items.delete(element.dataset.id);
      }
      if (!element) {
        element = document.createElement("li");
        element.classList.add("is-new");
        element.addEventListener("animationend", () => element.classList.remove("is-new"), { once: true });
      } else {
        items.delete(element.dataset.id);
      }
      element.dataset.id = snack.id;
      element.dataset.name = snack.name;
      if (snack.pending) element.dataset.temp = "1";
      else delete element.dataset.temp;
      element.classList.add("snack-item");
      element.classList.toggle("is-pending", Boolean(snack.pending));
      const html = itemHtml(snack);
      if (rendered.get(element) !== html) {
        const focused = element.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
        element.innerHTML = html;
        rendered.set(element, html);
        icons(element);
        if (focused) element.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
      }
      if (listEl.children[index] !== element) listEl.insertBefore(element, listEl.children[index] || null);
    });
    items.forEach((element) => element.remove());
  }

  function render() {
    if (!loaded) return;
    const list = current();
    const open = list.filter((snack) => !snack.done).sort((a, b) => time(a.at) - time(b.at));
    const done = list.filter((snack) => snack.done).sort((a, b) => time(a.doneAt) - time(b.doneAt));
    syncList(openList, open);
    syncList(doneList, done);
    emptyEl.hidden = open.length > 0;
    emptyEl.textContent = done.length ? "Everything’s in the bag. Add more if you’re still hungry." : "Nothing on the list yet. Add whatever you’re craving.";
    doneWrap.hidden = !done.length;
    doneCount.textContent = String(done.length);
    clearButton.disabled = !done.length;
    chipsEl.querySelectorAll("[data-snack]").forEach((chip) => {
      const added = open.some((snack) => sameName(snack.name, chip.dataset.snack));
      chip.classList.toggle("is-added", added);
      chip.disabled = added;
      chip.setAttribute("aria-label", added ? `${chip.dataset.snack}, already on the list` : `Add ${chip.dataset.snack}`);
    });
  }

  /* ------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    const started = epoch;
    if (!loaded && !quiet) {
      emptyEl.hidden = false;
      emptyEl.textContent = "Loading our list…";
    }
    try {
      const data = await app().apiRequest("/snacks");
      if (started !== epoch || pending.length) return;
      confirmed = Array.isArray(data.snacks) ? data.snacks : [];
      loaded = true;
      if (!quiet) showError("");
      render();
    } catch (error) {
      if (loaded || quiet) return;
      emptyEl.hidden = false;
      emptyEl.textContent = error.status === 404
        ? "The snack list needs the latest server update first."
        : "Couldn’t load the list. Check your connection and try again.";
    }
  }

  // Sends one change; changes go out one at a time so the answers come back in order.
  // `apply` shows it right away and is dropped again (rolled back) if saving fails.
  function send(body, apply) {
    const op = { apply };
    pending.push(op);
    epoch += 1;
    render();
    const run = queue.then(async () => {
      try {
        const data = await app().apiRequest("/snacks", "POST", body);
        confirmed = Array.isArray(data.snacks) ? data.snacks : confirmed;
        return data;
      } finally {
        pending = pending.filter((item) => item !== op);
        epoch += 1;
        render();
      }
    });
    queue = run.catch(() => {});
    // Offline the browser only says "Failed to fetch" / "Load failed", so say it in plain words.
    run.catch((error) => showError(error.status ? error.message : "Couldn’t save that. Check your connection and try again."));
    return run;
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (!document.hidden && app()?.step === "snacks") load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------ Actions -------------------------------- */
  function flash(name) {
    const row = [...openList.children].find((element) => sameName(element.dataset.name, name));
    if (!row) return;
    row.classList.remove("is-flash");
    void row.offsetWidth;
    row.classList.add("is-flash");
  }

  function add(rawName) {
    const name = String(rawName || "").trim().replace(/\s+/g, " ");
    if (!name) {
      showError("Type a snack first.");
      input.focus();
      return false;
    }
    if (name.length > MAX_NAME) {
      showError(`Keep it under ${MAX_NAME} characters.`);
      return false;
    }
    showError("");
    if (current().some((snack) => !snack.done && sameName(snack.name, name))) {
      flash(name);
      return true;
    }
    const author = me();
    const temp = { id: `temp-${tempCount += 1}`, name, author, done: false, doneBy: null, at: new Date().toISOString(), doneAt: null, pending: true };
    send({ action: "add", name, author }, (list) => {
      if (!list.some((snack) => !snack.done && sameName(snack.name, name))) list.push(temp);
    }).catch(() => {
      // Give her the text back so she doesn't have to type it again.
      if (!input.value) input.value = name;
    });
    return true;
  }

  function toggle(id) {
    const snack = current().find((item) => item.id === id);
    if (!snack || snack.pending) return;
    const author = me();
    const done = !snack.done;
    const at = new Date().toISOString();
    showError("");
    send({ action: "toggle", id, author, done }, (list) => {
      const target = list.find((item) => item.id === id);
      if (target) Object.assign(target, { done, doneBy: done ? author : null, doneAt: done ? at : null });
    }).catch(() => {});
  }

  function remove(id) {
    const snack = current().find((item) => item.id === id);
    if (!snack || snack.pending) return;
    showError("");
    send({ action: "remove", id }, (list) => {
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) list.splice(index, 1);
    }).catch(() => {});
  }

  function clearDone() {
    if (!current().some((snack) => snack.done)) return;
    showError("");
    send({ action: "clearDone" }, (list) => {
      for (let index = list.length - 1; index >= 0; index -= 1) if (list[index].done) list.splice(index, 1);
    }).catch(() => {});
  }

  /* ------------------------------- Wiring -------------------------------- */
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!loaded) {
      load();
      return;
    }
    if (add(input.value)) input.value = "";
  });
  chipsEl.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-snack]");
    if (!chip || chip.disabled || !loaded) return;
    add(chip.dataset.snack);
  });
  [openList, doneList].forEach((listEl) => listEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    const row = button?.closest(".snack-item");
    if (!row || button.disabled) return;
    if (button.matches("[data-toggle]")) toggle(row.dataset.id);
    else if (button.matches("[data-remove]")) remove(row.dataset.id);
  }));
  clearButton.addEventListener("click", clearDone);

  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "snacks") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "snacks") load({ quiet: true });
  });
})();
