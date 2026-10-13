/*
 * Ideas jar: one shared jar of date ideas. Either of us drops ideas in, pulls a
 * random one out when we can't decide, and turns it into our next date (the
 * next-date page opens with it picked, and app.js marks it used once that date
 * is saved). Used ideas sit in their own list and can be put back. Synced
 * through the Worker; changes show instantly and roll back if saving fails.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="ideas"]');
  if (!section) return;

  const jarEl = $("#jar");
  const notesEl = $("#jar-notes");
  const countEl = $("#jar-count");
  const pullButton = $("#jar-pull");
  const revealEl = $("#jar-reveal");
  const slipEl = $("#jar-slip");
  const slipText = $("#jar-slip-text");
  const slipBy = $("#jar-slip-by");
  const planButton = $("#jar-plan");
  const laterEl = $("#jar-later");
  const againButton = $("#jar-again");
  const closeButton = $("#jar-slip-close");
  const form = $("#jar-form");
  const input = $("#jar-input");
  const errorEl = $("#jar-error");
  const listEl = $("#jar-list");
  const emptyEl = $("#jar-empty");
  const usedWrap = $("#jar-used");
  const usedList = $("#jar-used-list");
  const usedCount = $("#jar-used-count");

  const POLL_MS = 10000;
  const MAX_TEXT = 120;
  const MAX_NOTES = 14;   // folded notes drawn inside the jar
  const SHAKE_MS = 650;
  const TONES = 5;

  let confirmed = [];   // last list the server sent
  let pending = [];     // optimistic changes still on their way
  let loaded = false;
  let epoch = 0;        // bumps on every change, so an older poll can't undo it
  let queue = Promise.resolve();
  let pollTimer = null;
  let tempCount = 0;
  let pulledId = null;  // the idea on the open slip
  let pullTimer = null;
  let shaking = false;
  let drewNotes = false; // the first jar render places notes without dropping them in
  const rendered = new WeakMap();

  const app = () => window.DateApp;
  const me = () => app().me();
  const escape = (text) => app().escapeHtml(text ?? "");
  const nameOf = (who) => app().names[who] || "one of us";
  const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  const time = (iso) => Date.parse(iso) || 0;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // The bell on the other phone (activity.js); never let it break the jar.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  // A small stable number in [0, 1) per idea, so each note keeps its color and spot.
  function seed(id, salt) {
    let hash = 2166136261;
    for (const character of `${id}:${salt}`) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return (hash >>> 0) / 4294967296;
  }
  const tone = (idea) => Math.floor(seed(idea.id, "tone") * TONES);

  // What the page shows: the server's list with the not-yet-saved changes on top.
  function current() {
    const list = confirmed.map((idea) => ({ ...idea }));
    pending.forEach((op) => op.apply(list));
    return list;
  }

  /* ------------------------------- Render -------------------------------- */
  function shortDate(iso) {
    const [year, month, day] = String(iso).split("-").map(Number);
    return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" })
      .format(new Date(Date.UTC(year, month - 1, day, 12)));
  }

  // "Used for <date>" when it became the date we have planned, otherwise the day it was used.
  function usedLabel(idea) {
    const plan = app().plan;
    const usedAt = time(idea.usedAt);
    if (!usedAt) return "Used";
    if (plan && plan.date && Math.abs(usedAt - time(plan.createdAt)) < 10 * 60 * 1000) return `Used for ${shortDate(plan.date)}`;
    return `Used on ${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", day: "numeric", month: "short" }).format(new Date(usedAt))}`;
  }

  function itemHtml(idea) {
    const text = escape(idea.text);
    const busy = idea.pending ? " disabled" : "";
    const remove = `<button class="planner-icon-btn jar-remove" type="button" aria-label="Remove ${text}" data-remove data-focus="remove"${busy}><i class="icon" data-lucide="x" aria-hidden="true"></i></button>`;
    if (idea.usedAt) {
      return `<span class="jar-item-note jar-tone-${tone(idea)}" aria-hidden="true"></span>
        <span class="jar-item-copy"><strong>${text}</strong><small>${escape(usedLabel(idea))}</small></span>
        <button class="jar-putback" type="button" aria-label="Put ${text} back in the jar" data-unuse data-focus="unuse"${busy}><i class="icon" data-lucide="undo-2" aria-hidden="true"></i><span>Put back</span></button>
        ${remove}`;
    }
    const note = idea.pending ? "Dropping it in…" : `added by ${nameOf(idea.author)}`;
    return `<span class="jar-item-note jar-tone-${tone(idea)}" aria-hidden="true"></span>
      <span class="jar-item-copy"><strong>${text}</strong><small>${escape(note)}</small></span>
      ${remove}`;
  }

  // Updates a list in place, so polling doesn't replay animations or steal focus.
  function syncList(target, ideas) {
    const items = new Map([...target.children].map((element) => [element.dataset.id, element]));
    ideas.forEach((idea, index) => {
      let element = items.get(idea.id);
      if (!element) {
        // A just-saved idea keeps the row it had while it was still "Dropping it in…".
        element = [...items.values()].find((row) => row.dataset.temp && sameText(row.dataset.text, idea.text) && !ideas.some((item) => item.id === row.dataset.id));
        if (element) items.delete(element.dataset.id);
      } else {
        items.delete(idea.id);
      }
      if (!element) {
        element = document.createElement("li");
        element.classList.add("is-new");
        element.addEventListener("animationend", () => element.classList.remove("is-new"), { once: true });
      }
      element.dataset.id = idea.id;
      element.dataset.text = idea.text;
      if (idea.pending) element.dataset.temp = "1";
      else delete element.dataset.temp;
      element.classList.add("jar-item");
      element.classList.toggle("is-pending", Boolean(idea.pending));
      const html = itemHtml(idea);
      if (rendered.get(element) !== html) {
        const focused = element.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
        element.innerHTML = html;
        rendered.set(element, html);
        icons(element);
        if (focused) element.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
      }
      if (target.children[index] !== element) target.insertBefore(element, target.children[index] || null);
    });
    items.forEach((element) => element.remove());
  }

  // The folded notes inside the drawn jar: oldest at the bottom, new ones drop in on top.
  function renderJar(open) {
    const shown = open.slice(-MAX_NOTES);
    const notes = new Map([...notesEl.children].map((element) => [element.dataset.id, element]));
    shown.forEach((idea, index) => {
      let note = notes.get(idea.id);
      if (!note) {
        note = [...notes.values()].find((element) => element.dataset.temp && sameText(element.dataset.text, idea.text) && !shown.some((item) => item.id === element.dataset.id));
        if (note) notes.delete(note.dataset.id);
      } else {
        notes.delete(idea.id);
      }
      if (!note) {
        note = document.createElement("span");
        if (drewNotes && !reduced()) {
          note.classList.add("is-dropping");
          note.addEventListener("animationend", () => note.classList.remove("is-dropping"), { once: true });
        }
        notesEl.append(note);
      }
      note.dataset.id = idea.id;
      note.dataset.text = idea.text;
      if (idea.pending) note.dataset.temp = "1";
      else delete note.dataset.temp;
      note.classList.add("jar-note", `jar-tone-${tone(idea)}`);
      const row = Math.floor(index / 4);
      const left = 6 + (index % 4) * 20 + (row % 2 ? 8 : 0) + (seed(idea.id, "x") - .5) * 7;
      const bottom = 3 + row * 12 + seed(idea.id, "y") * 4;
      const turn = (seed(idea.id, "r") - .5) * 60;
      note.style.left = `${left.toFixed(1)}%`;
      note.style.bottom = `${bottom.toFixed(1)}%`;
      note.style.setProperty("--turn", `${turn.toFixed(1)}deg`);
    });
    notes.forEach((element) => element.remove());
    drewNotes = true;
  }

  function render() {
    if (!loaded) return;
    const list = current();
    const open = list.filter((idea) => !idea.usedAt).sort((a, b) => time(a.at) - time(b.at));
    const used = list.filter((idea) => idea.usedAt).sort((a, b) => time(b.usedAt) - time(a.usedAt));
    syncList(listEl, open.slice().reverse());
    syncList(usedList, used);
    renderJar(open);
    countEl.textContent = open.length ? `${open.length} ${open.length === 1 ? "idea" : "ideas"} inside` : "The jar is empty";
    emptyEl.hidden = open.length > 0;
    emptyEl.textContent = used.length ? "Every idea has been used. Time for new ones." : "Nothing in the jar yet. Drop in the first idea.";
    usedWrap.hidden = !used.length;
    usedCount.textContent = String(used.length);
    const ready = open.filter((idea) => !idea.pending);
    pullButton.disabled = shaking || !ready.length;
    if (pulledId && !ready.some((idea) => idea.id === pulledId)) hideSlip();
    else updateSlip(ready.length);
  }

  function updateSlip(count) {
    const canPlan = Boolean(app()?.planStarted(app().plan)) && typeof app()?.startNextPlan === "function";
    planButton.hidden = !canPlan;
    laterEl.hidden = canPlan;
    againButton.hidden = count < 2;
  }

  /* ------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    const started = epoch;
    if (!loaded && !quiet) {
      emptyEl.hidden = false;
      emptyEl.textContent = "Loading our jar…";
    }
    try {
      const data = await app().apiRequest("/ideas");
      if (started !== epoch || pending.length) return;
      confirmed = Array.isArray(data.ideas) ? data.ideas : [];
      loaded = true;
      if (!quiet) showError("");
      render();
    } catch (error) {
      if (loaded || quiet) return;
      emptyEl.hidden = false;
      emptyEl.textContent = error.status === 404
        ? "The ideas jar needs the latest server update first."
        : "Couldn’t open the jar. Check your connection and try again.";
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
        const data = await app().apiRequest("/ideas", "POST", body);
        confirmed = Array.isArray(data.ideas) ? data.ideas : confirmed;
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
      if (!document.hidden && app()?.step === "ideas") load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------ Actions -------------------------------- */
  function flash(text) {
    const row = [...listEl.children].find((element) => sameText(element.dataset.text, text));
    if (!row) return;
    row.classList.remove("is-flash");
    void row.offsetWidth;
    row.classList.add("is-flash");
  }

  function add(rawText) {
    const text = String(rawText || "").trim().replace(/\s+/g, " ");
    if (!text) {
      showError("Type an idea first.");
      input.focus();
      return false;
    }
    if (text.length > MAX_TEXT) {
      showError(`Keep it under ${MAX_TEXT} characters.`);
      return false;
    }
    showError("");
    if (current().some((idea) => !idea.usedAt && sameText(idea.text, text))) {
      flash(text);
      return true;
    }
    const author = me();
    const known = new Set(confirmed.map((idea) => idea.id));
    const temp = { id: `temp-${tempCount += 1}`, text, author, at: new Date().toISOString(), usedAt: null, usedBy: null, pending: true };
    send({ action: "add", text, author }, (list) => {
      if (!list.some((idea) => !idea.usedAt && sameText(idea.text, text))) list.push(temp);
    }).then((data) => {
      const added = (data.ideas || []).some((idea) => !known.has(idea.id) && !idea.usedAt && sameText(idea.text, text));
      if (added) postActivity({ kind: "ideas.add", text: "dropped an idea in the jar", detail: text, step: "ideas", icon: "lightbulb", push: false });
    }).catch(() => {
      // Give the text back so it doesn't have to be typed again.
      if (!input.value) input.value = text;
    });
    return true;
  }

  function remove(id) {
    const idea = current().find((item) => item.id === id);
    if (!idea || idea.pending) return;
    if (!window.confirm(`Take “${idea.text}” out of the jar? It disappears for both of us.`)) return;
    showError("");
    send({ action: "remove", id }, (list) => {
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0) list.splice(index, 1);
    }).catch(() => {});
  }

  function unuse(id) {
    const idea = current().find((item) => item.id === id);
    if (!idea || idea.pending || !idea.usedAt) return;
    showError("");
    send({ action: "unuse", id }, (list) => {
      const target = list.find((item) => item.id === id);
      if (target) Object.assign(target, { usedAt: null, usedBy: null });
    }).catch(() => {});
  }

  function hideSlip() {
    window.clearTimeout(pullTimer);
    pulledId = null;
    revealEl.hidden = true;
    revealEl.classList.remove("is-popping");
  }

  function showSlip(idea, animate) {
    pulledId = idea.id;
    slipText.textContent = idea.text;
    slipBy.textContent = `added by ${nameOf(idea.author)}`;
    revealEl.classList.remove("is-popping");
    revealEl.hidden = false;
    if (animate) {
      void revealEl.offsetWidth;
      revealEl.classList.add("is-popping");
      window.LetterFX?.burstFrom?.(slipEl, 16);
    }
    render();
    slipEl.focus({ preventScroll: true });
    slipEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  }

  // Shakes the jar, then a random note pops out (just appears with reduced motion).
  function pull() {
    const open = current().filter((idea) => !idea.usedAt && !idea.pending);
    if (!open.length || shaking) return;
    // Don't hand back the same note twice in a row when there's a choice.
    const pool = open.length > 1 ? open.filter((idea) => idea.id !== pulledId) : open;
    const picked = pool[Math.floor(Math.random() * pool.length)];
    hideSlip();
    if (reduced()) {
      showSlip(picked, false);
      return;
    }
    shaking = true;
    jarEl.classList.remove("is-shaking");
    void jarEl.offsetWidth;
    jarEl.classList.add("is-shaking");
    render();
    pullTimer = window.setTimeout(() => {
      shaking = false;
      jarEl.classList.remove("is-shaking");
      // A poll may have taken it out meanwhile; then pull again from what's left.
      const fresh = current().find((idea) => idea.id === picked.id && !idea.usedAt);
      if (fresh) showSlip(fresh, true);
      else {
        render();
        pull();
      }
    }, SHAKE_MS);
  }

  function planIt() {
    const idea = current().find((item) => item.id === pulledId && !item.usedAt);
    if (!idea || typeof app().startNextPlan !== "function") return;
    hideSlip();
    app().startNextPlan({ idea: { id: idea.id, text: idea.text } });
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
  [listEl, usedList].forEach((target) => target.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    const row = button?.closest(".jar-item");
    if (!row || button.disabled) return;
    if (button.matches("[data-remove]")) remove(row.dataset.id);
    else if (button.matches("[data-unuse]")) unuse(row.dataset.id);
  }));
  pullButton.addEventListener("click", pull);
  againButton.addEventListener("click", pull);
  closeButton.addEventListener("click", () => {
    hideSlip();
    pullButton.focus({ preventScroll: true });
  });
  planButton.addEventListener("click", planIt);

  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "ideas") {
      load();
      startPolling();
    } else {
      stopPolling();
      if (shaking) {
        shaking = false;
        jarEl.classList.remove("is-shaking");
      }
      hideSlip();
    }
  });
  document.addEventListener("date:plan", () => {
    if (loaded) render();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "ideas") load({ quiet: true });
  });
})();
