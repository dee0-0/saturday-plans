/*
 * Weekly challenges: three little challenges a week, the same on both phones.
 * Each of us ticks our part "Done", with an optional note and photo (uploaded
 * through DateMedia with scope "challenge"). When both did it, the challenge's
 * badge unlocks and we both get hearts; all three make a perfect week. Synced
 * through the Worker (GET/POST /games/challenges) and polled while open.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="challenges"]');
  if (!section) return;

  const weekEl = $("#challenges-week");
  const statusEl = $("#challenges-status");
  const perfectEl = $("#challenges-perfect");
  const listEl = $("#challenges-list");
  const errorEl = $("#challenges-error");
  const liveEl = $("#challenges-live");
  const badgesWrap = $("#challenges-badges-wrap");
  const badgesEl = $("#challenges-badges");
  const badgeCount = $("#challenges-badge-count");
  const badgesEmpty = $("#challenges-badges-empty");
  const pastWrap = $("#challenges-past-wrap");
  const pastEl = $("#challenges-past");
  const photoInput = $("#challenges-photo-input");

  const POLL_MS = 12000;
  const MAX_NOTE = 200;
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  const OFFLINE = "Check your connection and try again.";

  let data = null;       // the last answer from the server
  let loaded = false;
  let busy = false;      // a done/undo on its way
  let epoch = 0;         // bumps on every change, so an older poll can't undo it
  let pollTimer = null;
  let sheet = null;      // the open "Mark done" sheet: { id, element, file, previewUrl }
  let completeSeen = null; // challenge ids we already saw complete (to pop newly unlocked badges)
  const media = new Map();  // media id -> media item, for thumbnails
  const missingMedia = new Set();
  const donePosted = new Set(); // "<week>:<challenge>" already announced this visit
  let mediaRequest = null;
  const drawn = {};

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = (who) => (who === "her" ? "sender" : "her");
  const escape = (text) => app().escapeHtml(text ?? "");
  const nameOf = (who) => app()?.names?.[who] || (who === "her" ? "Her" : "Your date");
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const iconName = (name, fallback) => (ICON_NAME.test(String(name || "")) ? name : fallback);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // The bell on the other phone (activity.js); never let it break the page.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  function games() {
    return window.DateGames || null;
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  // Offline the browser only says "Failed to fetch" / "Load failed", so say it in plain words.
  const friendly = (error) => (error?.status ? error.message : `Couldn’t save that. ${OFFLINE}`);

  /* ------------------------------- Dates --------------------------------- */
  function dayDate(day) {
    const [year, month, date] = String(day).split("-").map(Number);
    return new Date(Date.UTC(year, (month || 1) - 1, date || 1, 12));
  }
  const format = (day, options) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(dayDate(day));

  // "19–25 Oct", or "26 Oct – 1 Nov" across two months.
  function weekRange(monday, sunday) {
    const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
    return sameMonth
      ? `${format(monday, { day: "numeric" })}–${format(sunday, { day: "numeric", month: "short" })}`
      : `${format(monday, { day: "numeric", month: "short" })} – ${format(sunday, { day: "numeric", month: "short" })}`;
  }

  function zurichDay(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }

  // "today", "yesterday" or the weekday ("Tue").
  function doneWhen(iso) {
    const day = zurichDay(iso);
    const today = data?.today || app().todayISO();
    if (!day) return "";
    if (day === today) return "today";
    if (Date.parse(`${today}T12:00:00Z`) - Date.parse(`${day}T12:00:00Z`) === 86400000) return "yesterday";
    return format(day, { weekday: "short" });
  }

  const daysLeftText = (count) => (count <= 1 ? "Last day" : `${count} days left`);

  /* ------------------------------- Photos -------------------------------- */
  const mediaKey = () => `${data.week}T00:00`;

  function mediaIds() {
    return (data?.challenges || []).flatMap((item) => ["her", "sender"].map((who) => item.done[who]?.mediaId).filter(Boolean));
  }

  // Thumbnails need to know whether a photo has one: ask the media store once per new photo.
  function loadMedia() {
    if (!data || mediaRequest || typeof window.DateMedia === "undefined") return;
    const unknown = mediaIds().filter((id) => !media.has(id) && !missingMedia.has(id));
    if (!unknown.length) return;
    mediaRequest = app().apiRequest(`/media?key=${encodeURIComponent(mediaKey())}&scope=challenge`)
      .then((result) => {
        (result.media || []).forEach((item) => media.set(item.id, item));
        unknown.forEach((id) => { if (!media.has(id)) missingMedia.add(id); });
        render();
      })
      .catch(() => { /* Thumbnails fall back to the full photo. */ })
      .finally(() => { mediaRequest = null; });
  }

  function photoItem(id, who, at) {
    const known = media.get(id);
    return known || { id, kind: "photo", author: who, at, hasThumb: true };
  }

  function photoHtml(item, who) {
    const part = item.done[who];
    if (!part?.mediaId || missingMedia.has(part.mediaId) || typeof window.DateMedia === "undefined") return "";
    return `<span class="challenges-photo" data-photo="${escape(part.mediaId)}">${window.DateMedia.tileHtml(photoItem(part.mediaId, who, part.at))}</span>`;
  }

  /* ------------------------------- Render -------------------------------- */
  function initial(name) {
    const letter = Array.from(String(name || "").trim())[0] || "?";
    return letter.toUpperCase();
  }

  function personHtml(item, who) {
    const part = item.done[who];
    const mine = who === me();
    const name = mine ? "You" : nameOf(who);
    const state = part ? `Done ${doneWhen(part.at)}`.trim() : "Not yet";
    const note = part?.note ? `<span class="challenges-person-note">${escape(part.note)}</span>` : "";
    return `<li class="challenges-person${part ? " is-done" : ""}${mine ? " is-me" : ""}">
        <span class="challenges-avatar" aria-hidden="true">${escape(initial(nameOf(who)))}${part ? '<span class="challenges-avatar-check"><i class="icon" data-lucide="check"></i></span>' : ""}</span>
        <span class="challenges-person-copy"><strong>${escape(name)}</strong><small>${escape(state)}</small>${note}</span>
        ${photoHtml(item, who)}
      </li>`;
  }

  function cardHtml(item) {
    const mine = me();
    const badgeIcon = iconName(item.badge?.icon, "award");
    // Without notes or photos, both of us fit side by side.
    const pair = ["her", "sender"].every((who) => !item.done[who]?.note && !item.done[who]?.mediaId);
    const undo = `<button class="btn btn-ghost challenges-undo" type="button" data-undo data-focus="undo" aria-label="Undo your part of ${escape(item.title)}"${busy ? " disabled" : ""}><i class="icon" data-lucide="undo-2" aria-hidden="true"></i> Undo</button>`;
    const mark = `<button class="btn btn-primary challenges-mark" type="button" data-mark data-focus="mark" aria-expanded="${sheet?.id === item.id}" aria-label="Mark ${escape(item.title)} done"${busy ? " disabled" : ""}><i class="icon" data-lucide="check" aria-hidden="true"></i> Mark done</button>`;
    // Nothing to do on a complete card: the unlocked badge says it all.
    const action = item.complete ? "" : item.done[mine] ? undo : mark;
    return `<div class="challenges-card-head">
        <span class="challenges-card-icon" aria-hidden="true"><i class="icon" data-lucide="${iconName(item.icon, "badge-check")}"></i></span>
        <span class="challenges-card-copy">
          <strong class="challenges-card-title">${escape(item.title)}</strong>
          ${item.detail ? `<span class="challenges-card-detail">${escape(item.detail)}</span>` : ""}
        </span>
      </div>
      <ul class="challenges-people${pair ? " is-pair" : ""}" aria-label="Who did it">${[mine, other(mine)].map((who) => personHtml(item, who)).join("")}</ul>
      <div class="challenges-card-foot">
        <span class="challenges-badge-chip${item.complete ? " is-unlocked" : ""}">
          <span class="challenges-badge-icon" aria-hidden="true"><i class="icon" data-lucide="${badgeIcon}"></i></span>
          <span class="challenges-badge-copy"><small>${item.complete ? "Done together · badge unlocked" : "Unlocks a badge"}</small><strong>${escape(item.badge?.name || "Badge")}</strong></span>
        </span>
        ${action}
      </div>`;
  }

  // Replaces an element's markup only when it changed, keeping focus on the same control.
  function put(element, html) {
    if (drawn[element.dataset.key || element.id] === html) return false;
    const focusKey = element.contains(document.activeElement) ? document.activeElement.dataset?.focus : "";
    element.innerHTML = html;
    drawn[element.dataset.key || element.id] = html;
    icons(element);
    if (focusKey) element.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    return true;
  }

  function renderCards() {
    const items = data.challenges;
    const cards = new Map([...listEl.children].map((element) => [element.dataset.id, element]));
    items.forEach((item, index) => {
      let card = cards.get(item.id);
      cards.delete(item.id);
      if (!card) {
        card = document.createElement("li");
        card.className = "challenges-card";
        card.dataset.id = item.id;
        card.tabIndex = -1;
        card.innerHTML = '<div class="challenges-card-body"></div><div class="challenges-sheet-slot"></div>';
        card.firstElementChild.dataset.key = `card:${item.id}`;
        delete drawn[`card:${item.id}`];
      }
      card.classList.toggle("is-complete", item.complete);
      card.classList.toggle("is-open", sheet?.id === item.id);
      put(card.firstElementChild, cardHtml(item));
      // A badge the other one just unlocked pops in.
      if (item.complete && completeSeen && !completeSeen.has(item.id)) celebrate(card, false);
      if (listEl.children[index] !== card) listEl.insertBefore(card, listEl.children[index] || null);
    });
    cards.forEach((card) => card.remove());
    completeSeen = new Set(items.filter((item) => item.complete).map((item) => item.id));
    // The sheet's challenge was done (or the week changed) meanwhile.
    if (sheet && !items.some((item) => item.id === sheet.id && !item.complete && !item.done[me()])) {
      closeSheet({ focus: false, rerender: false });
    }
  }

  function badgeHtml(badge) {
    const perfect = String(badge.id || "").endsWith(":perfect");
    const when = badge.week ? format(badge.week, { day: "numeric", month: "short" }) : "";
    return `<li class="challenges-badge${perfect ? " is-perfect" : ""}">
        <span class="challenges-badge-medal" aria-hidden="true"><i class="icon" data-lucide="${iconName(badge.icon, "award")}"></i></span>
        <strong>${escape(badge.name)}</strong>
        ${when ? `<small><span class="visually-hidden">week of </span>${escape(when)}</small>` : ""}
        ${badge.challenge ? `<span class="visually-hidden">${escape(badge.challenge)}</span>` : ""}
      </li>`;
  }

  function pastState(item) {
    if (item.complete) return "Done together";
    const mine = me();
    if (item.done[mine]) return "Only you";
    if (item.done[other(mine)]) return `Only ${nameOf(other(mine))}`;
    return "Not done";
  }

  function pastHtml(week) {
    const dots = week.challenges.map((item) => `<span class="${item.complete ? "is-on" : ""}"></span>`).join("");
    const count = week.perfect
      ? '<span class="challenges-past-count is-perfect"><i class="icon" data-lucide="crown" aria-hidden="true"></i>Perfect</span>'
      : `<span class="challenges-past-count">${week.completed} of ${week.challenges.length}</span>`;
    const rows = week.challenges.map((item) => `<li class="${item.complete ? "is-complete" : ""}">
        <span class="challenges-past-icon" aria-hidden="true"><i class="icon" data-lucide="${item.complete ? "check" : iconName(item.icon, "badge-check")}"></i></span>
        <span class="challenges-past-title">${escape(item.title)}</span>
        <small>${escape(pastState(item))}</small>
      </li>`).join("");
    return `<li class="challenges-past-item"><details>
        <summary data-focus="past-${escape(week.week)}">
          <span class="challenges-past-when">${escape(weekRange(week.week, week.weekEnd))}</span>
          <span class="challenges-past-dots" aria-hidden="true">${dots}</span>
          ${count}
          <i class="icon challenges-chevron" data-lucide="chevron-down" aria-hidden="true"></i>
        </summary>
        <ul class="challenges-past-rows">${rows}</ul>
      </details></li>`;
  }

  function render() {
    if (!loaded || !data) return;
    statusEl.hidden = true;
    const completed = data.challenges.filter((item) => item.complete).length;
    weekEl.textContent = `${weekRange(data.week, data.weekEnd)} · ${daysLeftText(data.daysLeft)} · ${completed} of ${data.challenges.length} done`;
    perfectEl.hidden = !data.perfect;
    renderCards();

    const badges = Array.isArray(data.badges) ? data.badges : [];
    badgesWrap.hidden = false;
    badgeCount.textContent = String(badges.length);
    badgesEmpty.hidden = badges.length > 0;
    put(badgesEl, badges.map(badgeHtml).join(""));

    const past = Array.isArray(data.past) ? data.past : [];
    pastWrap.hidden = !past.length;
    // Keep the open/closed state of each past week across polls.
    const open = new Set([...pastEl.querySelectorAll("details[open] summary")].map((summary) => summary.dataset.focus));
    if (put(pastEl, past.map(pastHtml).join(""))) {
      pastEl.querySelectorAll("summary").forEach((summary) => { if (open.has(summary.dataset.focus)) summary.parentElement.open = true; });
    }
    loadMedia();
  }

  /* ------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    const started = epoch;
    if (!loaded && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading this week’s challenges…";
    }
    try {
      const result = await app().apiRequest(`/games/challenges?author=${encodeURIComponent(me())}`);
      if (started !== epoch || busy) return;
      data = result;
      loaded = true;
      if (!quiet) showError("");
      render();
    } catch (error) {
      if (loaded || quiet) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404
        ? "The challenges need the latest server update first."
        : `Couldn’t load this week’s challenges. ${OFFLINE}`;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (!document.hidden && app()?.step === "challenges") load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  async function send(body) {
    busy = true;
    epoch += 1;
    render();
    try {
      const result = await app().apiRequest("/games/challenges", "POST", { author: me(), ...body });
      data = result;
      return result;
    } finally {
      busy = false;
      epoch += 1;
      render();
    }
  }

  /* ------------------------------ Celebrate ------------------------------ */
  function celebrate(card, petals) {
    const chip = card?.querySelector(".challenges-badge-chip");
    if (!chip || reduced()) return;
    chip.classList.remove("is-popping");
    void chip.offsetWidth;
    chip.classList.add("is-popping");
    chip.addEventListener("animationend", () => chip.classList.remove("is-popping"), { once: true });
    if (petals) {
      window.LetterFX?.burstFrom?.(chip, 28);
      window.LetterFX?.chime?.();
    }
  }

  /* -------------------------------- Sheet -------------------------------- */
  function sheetHtml(item) {
    return `<form class="challenges-sheet" novalidate>
        <p class="challenges-sheet-title">Nice! Anything to add?</p>
        <label for="challenges-note">A little note <span>(optional)</span></label>
        <textarea id="challenges-note" rows="2" maxlength="${MAX_NOTE}" placeholder="How did it go?"></textarea>
        <div class="challenges-sheet-photo">
          <button class="challenges-photo-pick" type="button" data-pick-photo><i class="icon" data-lucide="image-plus" aria-hidden="true"></i><span>Add a photo <small>(optional)</small></span></button>
          <span class="challenges-photo-preview" hidden>
            <img alt="The photo you picked">
            <button class="planner-icon-btn challenges-photo-clear" type="button" data-clear-photo aria-label="Remove the photo"><i class="icon" data-lucide="x" aria-hidden="true"></i></button>
          </span>
        </div>
        <div class="planner-progress" role="progressbar" aria-label="Uploading the photo" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" hidden><span></span></div>
        <p class="error challenges-sheet-error" role="alert" hidden></p>
        <div class="challenges-sheet-actions">
          <button class="btn btn-ghost" type="button" data-cancel>Cancel</button>
          <button class="btn btn-primary" type="submit" data-submit aria-label="Done: ${escape(item.title)}"><i class="icon" data-lucide="check" aria-hidden="true"></i> Done</button>
        </div>
      </form>`;
  }

  function openSheet(id) {
    const item = data?.challenges.find((entry) => entry.id === id);
    const card = [...listEl.children].find((element) => element.dataset.id === id);
    if (!item || !card || item.complete || item.done[me()] || busy) return;
    if (sheet) closeSheet({ focus: false });
    const slot = card.querySelector(".challenges-sheet-slot");
    slot.innerHTML = sheetHtml(item);
    icons(slot);
    sheet = { id, element: slot.firstElementChild, file: null, previewUrl: "" };
    render();
    const note = sheet.element.querySelector("textarea");
    note.focus({ preventScroll: true });
    sheet.element.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  }

  function clearPhoto() {
    if (!sheet) return;
    if (sheet.previewUrl) URL.revokeObjectURL(sheet.previewUrl);
    sheet.file = null;
    sheet.previewUrl = "";
    const preview = sheet.element.querySelector(".challenges-photo-preview");
    preview.hidden = true;
    preview.querySelector("img").removeAttribute("src");
    sheet.element.querySelector("[data-pick-photo]").hidden = false;
  }

  function closeSheet({ focus = true, rerender = true } = {}) {
    if (!sheet) return;
    const { id, element } = sheet;
    clearPhoto();
    element.remove();
    sheet = null;
    const card = [...listEl.children].find((entry) => entry.dataset.id === id);
    card?.classList.remove("is-open");
    if (rerender && loaded) render();
    if (focus) card?.querySelector("[data-mark], [data-undo]")?.focus({ preventScroll: true });
  }

  function sheetError(message) {
    const element = sheet?.element.querySelector(".challenges-sheet-error");
    if (!element) return;
    element.textContent = message || "";
    element.hidden = !message;
  }

  function setSheetBusy(on, label) {
    if (!sheet) return;
    sheet.element.querySelectorAll("button, textarea").forEach((control) => { control.disabled = on; });
    const submit = sheet.element.querySelector("[data-submit]");
    submit.innerHTML = on
      ? `<span>${escape(label || "Saving…")}</span>`
      : '<i class="icon" data-lucide="check" aria-hidden="true"></i> Done';
    if (!on) icons(submit);
  }

  function showProgress(fraction) {
    const bar = sheet?.element.querySelector(".planner-progress");
    if (!bar) return;
    const percent = Math.round(fraction * 100);
    bar.hidden = false;
    bar.setAttribute("aria-valuenow", String(percent));
    bar.firstElementChild.style.width = `${percent}%`;
    setSheetBusy(true, `Uploading ${percent}%`);
  }

  function pickedPhoto(file) {
    if (!sheet || !file) return;
    if (!String(file.type || "").startsWith("image/") && !/\.(jpe?g|png|webp|heic|heif|gif|avif)$/i.test(file.name || "")) {
      sheetError("That file isn’t a photo. Try another one.");
      return;
    }
    sheetError("");
    clearPhoto();
    sheet.file = file;
    sheet.previewUrl = URL.createObjectURL(file);
    const preview = sheet.element.querySelector(".challenges-photo-preview");
    preview.querySelector("img").src = sheet.previewUrl;
    preview.hidden = false;
    sheet.element.querySelector("[data-pick-photo]").hidden = true;
    preview.querySelector("[data-clear-photo]").focus({ preventScroll: true });
  }

  async function submitSheet() {
    if (!sheet || busy) return;
    const current = sheet;
    const item = data.challenges.find((entry) => entry.id === current.id);
    if (!item) return;
    const note = current.element.querySelector("textarea").value.trim();
    if (note.length > MAX_NOTE) {
      sheetError(`Keep the note under ${MAX_NOTE} characters.`);
      return;
    }
    sheetError("");
    showError("");
    let mediaId = null;
    let uploading = Boolean(current.file);
    setSheetBusy(true, uploading ? "Uploading…" : "Saving…");
    try {
      if (current.file) {
        const uploaded = await window.DateMedia.upload(current.file, { key: mediaKey(), scope: "challenge", onProgress: showProgress });
        mediaId = uploaded.id;
        media.set(uploaded.id, uploaded);
        uploading = false;
        setSheetBusy(true, "Saving…");
      }
      const result = await send({ action: "done", id: item.id, note, mediaId });
      closeSheet({ focus: false });
      finishDone(item, result, note);
    } catch (error) {
      // The challenge wasn't saved: don't leave the photo behind.
      if (mediaId) window.DateMedia.remove(mediaId).catch(() => {});
      // DateMedia's own errors are already in plain words (too big, offline…).
      const message = uploading && !error.status ? error.message || friendly(error) : friendly(error);
      if (sheet === current) {
        setSheetBusy(false);
        current.element.querySelector(".planner-progress").hidden = true;
        sheetError(message);
      } else {
        showError(message);
      }
    }
  }

  function finishDone(item, result, note) {
    const unlocked = Array.isArray(result.unlocked) ? result.unlocked : [];
    const badge = unlocked.find((entry) => !String(entry.id).endsWith(":perfect"));
    const perfect = unlocked.some((entry) => String(entry.id).endsWith(":perfect"));
    const card = [...listEl.children].find((element) => element.dataset.id === item.id);
    if (badge) celebrate(card, true);
    games()?.reward?.(result.awarded, perfect ? "Perfect week" : badge ? `Badge: ${badge.name}` : "");
    games()?.refresh?.();
    const detail = badge ? `Badge unlocked: ${badge.name}${perfect ? " · Perfect week!" : ""}` : note;
    liveEl.textContent = badge ? `Done together! Badge unlocked: ${badge.name}.${perfect ? " Perfect week!" : ""}` : `Marked done: ${item.title}.`;
    // Once per challenge and week (Undo then Done again stays quiet), but always when a badge unlocks.
    const posted = `${result.week || data?.week || ""}:${item.id}`;
    if (badge || !donePosted.has(posted)) {
      donePosted.add(posted);
      postActivity({ kind: "challenges.done", text: `did this week’s challenge: ${item.title}`, detail, step: "challenges", icon: "badge-check", push: true });
    }
    (card?.querySelector("[data-undo]") || card)?.focus({ preventScroll: true });
  }

  async function undo(id) {
    const item = data?.challenges.find((entry) => entry.id === id);
    const part = item?.done[me()];
    if (!item || !part || item.complete || busy) return;
    if ((part.note || part.mediaId) && !window.confirm(`Undo your part of “${item.title}”? Your note and photo go away too.`)) return;
    showError("");
    try {
      await send({ action: "undo", id });
      liveEl.textContent = `Undone: ${item.title}.`;
      if (part.mediaId) window.DateMedia?.remove?.(part.mediaId).catch(() => {});
      games()?.refresh?.();
      [...listEl.children].find((element) => element.dataset.id === id)?.querySelector("[data-mark]")?.focus({ preventScroll: true });
    } catch (error) {
      showError(friendly(error));
    }
  }

  /* ------------------------------- Wiring -------------------------------- */
  listEl.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    const card = target?.closest(".challenges-card");
    if (!target || !card || target.disabled) return;
    const id = card.dataset.id;
    if (target.matches("[data-mark]")) openSheet(id);
    else if (target.matches("[data-undo]")) undo(id);
    else if (target.matches("[data-cancel]")) closeSheet();
    else if (target.matches("[data-pick-photo]")) {
      photoInput.value = "";
      photoInput.click();
    } else if (target.matches("[data-clear-photo]")) {
      clearPhoto();
      sheet?.element.querySelector("[data-pick-photo]")?.focus({ preventScroll: true });
    } else if (target.matches(".media-tile")) {
      const item = data?.challenges.find((entry) => entry.id === id);
      if (!item || typeof window.DateMedia === "undefined") return;
      const photos = [me(), other(me())]
        .map((who) => (item.done[who]?.mediaId && !missingMedia.has(item.done[who].mediaId) ? photoItem(item.done[who].mediaId, who, item.done[who].at) : null))
        .filter(Boolean);
      const index = Math.max(0, photos.findIndex((photo) => photo.id === target.dataset.mediaId));
      window.DateMedia.view(photos, index, { canDelete: false });
    }
  });
  listEl.addEventListener("submit", (event) => {
    event.preventDefault();
    submitSheet();
  });
  listEl.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && sheet && sheet.element.contains(event.target)) closeSheet();
  });
  photoInput.addEventListener("change", () => {
    pickedPhoto(photoInput.files?.[0]);
    photoInput.value = "";
  });

  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "challenges") {
      load();
      startPolling();
    } else {
      stopPolling();
      if (sheet && !busy) closeSheet({ focus: false });
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "challenges") load({ quiet: true });
  });
})();
