/*
 * Our journal: a scrapbook of every date. Once the current date has started,
 * each of you rates it (1–5 hearts) and writes a note. Every date gets a card
 * with both reviews, the outfit pick and a shared gallery of photos and videos
 * (media.js). It all lives in the Worker, so both phones see the same book.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const form = $("#journal-form");
  if (!form) return;

  const forEl = $("#journal-for");
  const authorButtons = [...form.querySelectorAll("[data-author]")];
  const ratingEl = $("#heart-rating");
  const heartHint = $("#heart-hint");
  const noteEl = $("#journal-note");
  const saveButton = $("#journal-save");
  const errorEl = $("#journal-error");
  const savedEl = $("#journal-saved");
  const waitingEl = $("#journal-waiting");
  const waitingText = $("#journal-waiting-text");
  const nextButton = $("#journal-next");
  const listEl = $("#journal-list");
  const mediaInput = $("#journal-media-input");
  const promptEl = $("#journal-prompt");
  const AUTHOR_KEY = "date-letter-author";
  const AUTHORS = ["her", "sender"];
  const POLL_MS = 20000;
  const names = {
    her: CONFIG.herName || "Her",
    sender: (CONFIG.yourName || "").trim() || "Your date"
  };
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

  let author = null;
  try { author = window.localStorage.getItem(AUTHOR_KEY); } catch { /* Private browsing. */ }
  if (!names[author]) author = null;
  let stars = 0;
  let overflow = false; // the easter egg: tapped past 5 hearts, so it's ∞ / 5
  let heartTaps = 0;
  let heartTimer = null;
  const OVERFLOW_TAPS = 10;
  const OVERFLOW_HINTS = ["More than 5?", "Keep going…", "They're filling up…", "Almost overflowing…"];
  let entries = [];
  let loaded = false;
  let loading = null;
  let listSignature = "";
  let formKey = "";
  let formTarget = null; // the date the form rates: { key, date, time, activity, place }
  let chosenKey = ""; // a date picked with "Write my review" on its card
  let formDirty = false; // she's mid-review: polling must not reset the form
  let pollTimer = null;
  // Uploads in progress, shown as chips on their date's card.
  let uploads = [];
  let uploadSeq = 0;
  let uploadQueue = Promise.resolve();
  let pickKey = null;
  // Review photos from before the gallery existed: "key:who" -> blob URL, null (missing) or a pending promise.
  const legacyPhotos = new Map();

  const escape = (text) => window.DateApp.escapeHtml(text);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  authorButtons.forEach((button) => { button.textContent = names[button.dataset.author]; });
  ratingEl.innerHTML = [1, 2, 3, 4, 5].map((value) =>
    `<button type="button" role="radio" aria-checked="false" aria-label="${value} heart${value === 1 ? "" : "s"}" data-stars="${value}">${HEART}</button>`
  ).join("") + '<span class="heart-infinity" hidden>∞ / 5</span>';
  const infinityEl = ratingEl.querySelector(".heart-infinity");

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function refreshIcons(root) {
    try { window.lucide?.createIcons({ root }); } catch { /* Icons are decoration. */ }
  }

  function canPlanNext() {
    return window.DateApp.planStarted(window.DateApp.plan) && typeof window.DateApp.startNextPlan === "function";
  }

  // A confirmed date that hasn't started yet: the waiting card shows instead of the form.
  function upcomingPlan() {
    const plan = window.DateApp.plan;
    return plan && plan.status === "confirmed" && !window.DateApp.planStarted(plan) ? plan : null;
  }

  /* ------------------------------ Review form ----------------------------- */
  function setAuthor(value) {
    author = value;
    try { window.localStorage.setItem(AUTHOR_KEY, value); } catch { /* Private browsing. */ }
    authorButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.author === value)));
    prefill();
  }

  function setStars(value, infinite = false) {
    stars = value;
    overflow = value === 5 && infinite;
    ratingEl.querySelectorAll("[data-stars]").forEach((button) => {
      const on = Number(button.dataset.stars) <= value;
      button.classList.toggle("is-on", on);
      button.setAttribute("aria-checked", String(Number(button.dataset.stars) === value));
    });
    ratingEl.classList.toggle("is-overflowing", overflow);
    infinityEl.hidden = !overflow;
  }

  function resetHeartTaps() {
    heartTaps = 0;
    window.clearTimeout(heartTimer);
    heartHint.textContent = "";
    ratingEl.style.removeProperty("--fill");
  }

  // Easter egg: keep tapping the fifth heart (10 taps) and the rating overflows into ∞.
  function countHeartTap(value) {
    if (value !== 5 || overflow) {
      resetHeartTaps();
      return;
    }
    heartTaps += 1;
    window.clearTimeout(heartTimer);
    heartTimer = window.setTimeout(resetHeartTaps, 2200);
    const extra = heartTaps - 5;
    if (heartTaps < OVERFLOW_TAPS) {
      if (extra > 0) {
        heartHint.textContent = OVERFLOW_HINTS[extra - 1];
        ratingEl.style.setProperty("--fill", String(extra / 5));
      }
      return;
    }
    resetHeartTaps();
    setStars(5, true);
    window.LetterSecrets?.spray("hearts", { count: 36 });
    window.LetterFX?.burstFrom(ratingEl, 24);
    window.LetterFX?.chime?.();
    window.LetterSecrets?.found("hearts", { toast: { text: "∞ / 5. I'm taking that as a compliment." } });
  }

  // Which date the form rates: a half-written review stays put; then a date picked on its card;
  // then the current date once it started; otherwise the latest date this person hasn't rated yet
  // (so the date that just happened can still be rated after the next one is planned).
  function pickTarget() {
    const find = (key) => entries.find((entry) => entry.key === key);
    if (formDirty && formTarget && find(formTarget.key)) return formTarget;
    if (chosenKey && find(chosenKey)) return find(chosenKey);
    chosenKey = "";
    const plan = window.DateApp.plan;
    if (window.DateApp.planStarted(plan)) {
      const key = window.DateApp.entryKey(plan);
      return find(key) || { key, date: plan.date, time: plan.time, activity: plan.activity, place: plan.place };
    }
    const who = author || window.DateApp.me();
    const latest = entries[0];
    return latest && !latest.reviews?.[who] ? latest : null;
  }

  // Fill the form with what this person already wrote for the date it rates.
  function prefill() {
    const review = formTarget && author ? entries.find((entry) => entry.key === formTarget.key)?.reviews?.[author] : null;
    resetHeartTaps();
    setStars(review?.stars || 0, Boolean(review?.overflow));
    noteEl.value = review?.note || "";
    formDirty = false;
    saveButton.firstChild.textContent = review ? "Update my review " : "Save to our journal ";
  }

  function markDirty() {
    formDirty = true;
    savedEl.hidden = true;
  }

  /* ------------------------------- Timeline ------------------------------- */
  function hearts(count, infinite) {
    return [1, 2, 3, 4, 5].map((value) => `<span class="${value <= count ? "is-on" : ""}">${HEART}</span>`).join("")
      + (infinite ? '<b class="journal-infinity">∞</b>' : "");
  }

  function dateStamp(iso) {
    const [year, month, day] = iso.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day, 12));
    const part = (options) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(date);
    return `<span class="scrap-stamp" aria-hidden="true"><strong>${part({ day: "numeric" })}</strong><small>${part({ month: "short" })}</small><small>${part({ year: "numeric" })}</small></span>`;
  }

  function galleryItems(entry) {
    const legacy = AUTHORS.filter((who) => entry.reviews?.[who]?.hasPhoto && typeof legacyPhotos.get(`${entry.key}:${who}`) === "string")
      .map((who) => {
        const src = legacyPhotos.get(`${entry.key}:${who}`);
        return { id: `review-photo-${who}`, kind: "photo", author: who, legacy: true, src, thumbSrc: src, at: entry.reviews[who].at };
      });
    return [...legacy, ...entry.media];
  }

  function reviewHtml(entry, who) {
    const review = entry.reviews?.[who];
    if (!review) {
      return `<div class="scrap-review is-pending"><p class="scrap-review-head"><span>${escape(names[who])}</span></p><p class="journal-pending">Hasn't written yet</p></div>`;
    }
    const label = review.overflow ? "Off the scale, infinity" : `${review.stars} out of 5 hearts`;
    return `<div class="scrap-review">
      <p class="scrap-review-head"><span>${escape(names[who])}</span><span class="journal-hearts" role="img" aria-label="${label}">${hearts(review.stars, review.overflow)}</span></p>
      ${review.note ? `<p class="journal-note">“${escape(review.note)}”</p>` : ""}
    </div>`;
  }

  function outfitHtml(outfit) {
    if (!outfit?.mediaId) return "";
    const thumb = window.DateMedia.thumbUrl(outfit.mediaId);
    return `<button class="scrap-outfit" type="button" data-outfit-media="${escape(outfit.mediaId)}" data-outfit-author="${escape(outfit.author || "")}">
      <span class="scrap-outfit-photo"><img src="${escape(thumb)}" data-fallback="${escape(window.DateMedia.fileUrl(outfit.mediaId))}" alt="" loading="lazy" decoding="async"></span>
      <span class="scrap-outfit-copy"><small><i class="icon" data-lucide="shirt" aria-hidden="true"></i> Outfit pick</small><strong>${escape(outfit.title || "The outfit")}</strong></span>
      <i class="icon scrap-outfit-arrow" data-lucide="chevron-right" aria-hidden="true"></i>
    </button>`;
  }

  function chipHtml(job) {
    const video = job.kind === "video";
    const state = {
      queued: "Waiting",
      preparing: "Preparing",
      uploading: `${Math.round(job.progress * 100)}%`,
      done: "Added",
      error: ""
    }[job.status];
    if (job.status === "error") {
      return `<li class="upload-chip is-error" data-upload="${job.uid}">
        <i class="icon" data-lucide="circle-alert" aria-hidden="true"></i>
        <span class="upload-chip-copy"><strong>${escape(job.name)}</strong><small>${escape(job.error)}</small></span>
        <button class="upload-chip-dismiss" type="button" data-dismiss-upload="${job.uid}" aria-label="Dismiss"><i class="icon" data-lucide="x" aria-hidden="true"></i></button>
      </li>`;
    }
    return `<li class="upload-chip is-${job.status}" data-upload="${job.uid}">
      <i class="icon" data-lucide="${video ? "film" : "image"}" aria-hidden="true"></i>
      <span class="upload-chip-name">${escape(job.name)}</span>
      <span class="upload-chip-state">${state}</span>
      <span class="upload-chip-bar" aria-hidden="true"><span style="width:${Math.round((job.status === "done" ? 1 : job.progress) * 100)}%"></span></span>
    </li>`;
  }

  function chipsHtml(key) {
    return uploads.filter((job) => job.key === key).map(chipHtml).join("");
  }

  function entryHtml(entry) {
    const items = galleryItems(entry);
    const waitingLegacy = AUTHORS.some((who) => entry.reviews?.[who]?.hasPhoto && legacyPhotos.get(`${entry.key}:${who}`) instanceof Promise);
    const gallery = items.length
      ? `<div class="scrap-gallery">${items.map((item) => window.DateMedia.tileHtml(item)).join("")}</div>`
      : `<p class="scrap-empty">${waitingLegacy ? "Loading photos…" : "No photos or videos yet."}</p>`;
    return `<article class="scrap${entry.current ? " is-current" : ""}" data-key="${escape(entry.key)}" aria-labelledby="scrap-${escape(entry.key.replace(/\W/g, ""))}">
      <header class="scrap-head">
        ${dateStamp(entry.date)}
        <div class="scrap-title">
          <h3 id="scrap-${escape(entry.key.replace(/\W/g, ""))}">${escape(entry.activity)}</h3>
          <p>${escape(window.DateApp.formatDate(entry.date))}${entry.place ? ` · ${escape(entry.place)}` : ""}</p>
        </div>
      </header>
      <div class="scrap-reviews">${AUTHORS.map((who) => reviewHtml(entry, who)).join("")}</div>
      ${outfitHtml(entry.outfit)}
      ${gallery}
      <ul class="scrap-uploads" data-uploads-for="${escape(entry.key)}" aria-live="polite">${chipsHtml(entry.key)}</ul>
      <div class="scrap-actions">
        <button class="scrap-add" type="button" data-add-media="${escape(entry.key)}"><i class="icon" data-lucide="image-plus" aria-hidden="true"></i><span>Add photos &amp; videos</span></button>
        <button class="scrap-add scrap-rate" type="button" data-review-key="${escape(entry.key)}"><i class="icon" data-lucide="heart" aria-hidden="true"></i><span>${entry.reviews?.[author || window.DateApp.me()] ? "Edit my review" : "Write my review"}</span></button>
      </div>
    </article>`;
  }

  // Remember what had focus, so a background refresh doesn't drop it.
  function focusedSelector() {
    const active = document.activeElement;
    if (!active || !listEl.contains(active)) return null;
    const card = active.closest("[data-key]");
    if (!card) return null;
    const attribute = ["data-media-id", "data-add-media", "data-outfit-media"].find((name) => active.hasAttribute(name));
    return attribute ? { key: card.dataset.key, attribute, value: active.getAttribute(attribute) } : null;
  }

  function restoreFocus(saved) {
    if (!saved) return;
    const card = [...listEl.querySelectorAll("[data-key]")].find((element) => element.dataset.key === saved.key);
    const target = card && [...card.querySelectorAll(`[${saved.attribute}]`)].find((element) => element.getAttribute(saved.attribute) === saved.value);
    target?.focus({ preventScroll: true });
  }

  function renderList(force = false) {
    const waiting = Boolean(upcomingPlan());
    const signature = JSON.stringify([waiting, author, entries]);
    if (!force && signature === listSignature) return;
    listSignature = signature;
    const focus = focusedSelector();
    // Before the very first date the waiting card says it all.
    listEl.innerHTML = entries.length
      ? entries.map(entryHtml).join("")
      : waiting ? "" : '<p class="journal-empty">No dates in here yet. Our first one goes right here.</p>';
    refreshIcons(listEl);
    restoreFocus(focus);
  }

  function renderChips(key) {
    const list = [...listEl.querySelectorAll("[data-uploads-for]")].find((element) => element.dataset.uploadsFor === key);
    if (!list) return;
    list.innerHTML = chipsHtml(key);
    refreshIcons(list);
  }

  // Progress ticks only touch their own chip.
  function updateChip(job) {
    const chip = listEl.querySelector(`[data-upload="${job.uid}"]`);
    if (!chip || !chip.classList.contains(`is-${job.status}`)) {
      renderChips(job.key);
      return;
    }
    chip.querySelector(".upload-chip-state").textContent = `${Math.round(job.progress * 100)}%`;
    chip.querySelector(".upload-chip-bar span").style.width = `${Math.round(job.progress * 100)}%`;
  }

  /* -------------------------------- Render -------------------------------- */
  function renderTop() {
    const plan = upcomingPlan();
    nextButton.hidden = !canPlanNext();
    if (!canPlanNext()) savedEl.hidden = true;
    waitingEl.hidden = !plan || !loaded;
    if (plan) {
      waitingText.textContent = entries.length
        ? `Next up: ${plan.activity} on ${window.DateApp.formatDate(plan.date)}. Afterwards, come back here to rate it and add photos and videos. Both of us can.`
        : "After our date, come back here to rate it and add photos and videos. Both of us can.";
    }
  }

  function renderForm() {
    const target = loaded ? pickTarget() : null;
    form.hidden = !target;
    if (!target) return;
    const changed = target.key !== formKey;
    formTarget = target;
    forEl.textContent = `${target.activity} · ${window.DateApp.formatDate(target.date)}`;
    authorButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.author === author)));
    // An unsaved review survives refreshes and leaving the journal; it resets only for another date.
    if (changed || !formDirty) prefill();
    formKey = target.key;
  }

  let arriveTimer = null;
  function render(full = false) {
    renderTop();
    renderForm();
    if (full) {
      // Cards drift in when the journal opens, not on every background refresh.
      listEl.classList.add("is-arriving");
      window.clearTimeout(arriveTimer);
      arriveTimer = window.setTimeout(() => listEl.classList.remove("is-arriving"), 1200);
    }
    renderList(full);
  }

  /* --------------------------------- Data --------------------------------- */
  function normalize(list) {
    return (Array.isArray(list) ? list : [])
      .filter((entry) => entry && typeof entry.key === "string" && typeof entry.date === "string")
      .map((entry) => ({
        ...entry,
        reviews: entry.reviews && typeof entry.reviews === "object" ? entry.reviews : {},
        media: Array.isArray(entry.media) ? entry.media.filter((item) => item && item.id) : [],
        outfit: entry.outfit || null
      }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }

  async function fetchLegacyPhoto(key, who) {
    try {
      const data = await window.DateApp.apiRequest(`/journal/photo?key=${encodeURIComponent(key)}&author=${encodeURIComponent(who)}`);
      if (typeof data.photo !== "string" || !data.photo.startsWith("data:image/")) return null;
      // A blob URL keeps a 600 KB data URL out of the page markup.
      try { return URL.createObjectURL(await (await fetch(data.photo)).blob()); } catch { return data.photo; }
    } catch {
      return null;
    }
  }

  function loadLegacyPhotos() {
    const pending = [];
    entries.forEach((entry) => AUTHORS.forEach((who) => {
      const cacheKey = `${entry.key}:${who}`;
      if (!entry.reviews?.[who]?.hasPhoto || legacyPhotos.has(cacheKey)) return;
      const request = fetchLegacyPhoto(entry.key, who).then((src) => legacyPhotos.set(cacheKey, src));
      legacyPhotos.set(cacheKey, request);
      pending.push(request);
    }));
    if (pending.length) Promise.all(pending).then(() => renderList(true));
  }

  // `fresh` waits out a refresh that is already running and asks again, for
  // when the answer has to include something that just changed.
  function load({ full = false, fresh = false } = {}) {
    if (loading) return loading.then(() => (fresh ? load({ full }) : full ? render(true) : undefined));
    loading = (async () => {
      try {
        entries = normalize((await window.DateApp.apiRequest("/journal")).entries);
        loaded = true;
      } catch (error) {
        // A failed background refresh keeps the last good journal on screen.
        if (loaded) return;
        listSignature = "";
        listEl.innerHTML = `<p class="journal-empty">${error.status === 404
          ? "The journal needs the latest server update first."
          : "Couldn’t load the journal. Check your connection and try again."}</p>`;
        form.hidden = true;
        waitingEl.hidden = true;
        nextButton.hidden = !canPlanNext();
        return;
      }
      render(full);
      loadLegacyPhotos();
    })().finally(() => { loading = null; });
    return loading;
  }

  function startPolling() {
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => {
      if (!document.hidden && window.DateApp.step === "journal") load();
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* -------------------------------- Uploads ------------------------------- */
  function describeBatch(photos, videos) {
    return [photos ? plural(photos, "photo") : "", videos ? plural(videos, "video") : ""].filter(Boolean).join(" and ");
  }

  async function runBatch(key, jobs, files) {
    let photos = 0;
    let videos = 0;
    for (const [index, job] of jobs.entries()) {
      job.status = "preparing";
      renderChips(key);
      try {
        const media = await window.DateMedia.upload(files[index], {
          key,
          scope: "journal",
          onProgress(fraction) {
            const changed = job.status !== "uploading";
            job.status = "uploading";
            job.progress = fraction;
            if (changed) renderChips(key);
            else updateChip(job);
          }
        });
        job.status = "done";
        if (media?.kind === "video") videos += 1;
        else photos += 1;
      } catch (error) {
        job.status = "error";
        job.error = error.message || "That one didn’t upload. Please try again.";
      }
      renderChips(key);
    }
    uploads = uploads.filter((job) => !(jobs.includes(job) && job.status === "done"));
    await load({ fresh: true });
    renderList(true);
    if (!photos && !videos) return;
    window.LetterFX?.chime?.();
    window.DateActivity?.post({
      kind: "journal.media",
      text: `added ${describeBatch(photos, videos)}`,
      detail: entries.find((item) => item.key === key)?.activity || "",
      step: "journal",
      icon: "camera"
    });
    if (window.DateApp.me() === "her") {
      const entry = entries.find((item) => item.key === key);
      window.DateApp.notify(
        `${names.her} added ${describeBatch(photos, videos)} to ${entry?.activity || "our journal"}`,
        entry ? `${window.DateApp.formatDate(entry.date)} · ${entry.place}` : "Open our journal to see them.",
        ["camera"]
      );
    }
  }

  function queueUploads(key, files) {
    const jobs = files.map((file) => ({
      uid: ++uploadSeq,
      key,
      name: file.name || "Photo",
      kind: String(file.type).startsWith("video/") || /\.(mov|mp4|m4v|webm|qt)$/i.test(file.name || "") ? "video" : "photo",
      status: "queued",
      progress: 0,
      error: ""
    }));
    uploads.push(...jobs);
    renderChips(key);
    // One file at a time keeps memory low on the phone.
    uploadQueue = uploadQueue.then(() => runBatch(key, jobs, files)).catch(() => {});
  }

  const uploading = () => uploads.some((job) => ["queued", "preparing", "uploading"].includes(job.status));

  function openGallery(card, tile) {
    const entry = entries.find((item) => item.key === card.dataset.key);
    if (!entry) return;
    const items = galleryItems(entry);
    const index = items.findIndex((item) => String(item.id) === tile.dataset.mediaId);
    window.DateMedia.view(items, Math.max(0, index), {
      onDelete: () => load({ fresh: true })
    });
  }

  /* -------------------------------- Events -------------------------------- */
  authorButtons.forEach((button) => button.addEventListener("click", () => {
    setAuthor(button.dataset.author);
    savedEl.hidden = true;
  }));
  ratingEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stars]");
    if (!button) return;
    const value = Number(button.dataset.stars);
    markDirty();
    setStars(value, overflow);
    countHeartTap(value);
  });
  ratingEl.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    markDirty();
    const next = Math.min(5, Math.max(1, (stars || 0) + (event.key === "ArrowRight" ? 1 : -1)));
    setStars(next, overflow);
    ratingEl.querySelector(`[data-stars="${next}"]`)?.focus();
  });
  noteEl.addEventListener("input", markDirty);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const plan = formTarget;
    if (!plan) return;
    if (!author) { showError("Tap who's writing first."); return; }
    if (!stars) { showError("Pick 1 to 5 hearts."); return; }
    showError("");
    saveButton.disabled = true;
    const body = {
      key: plan.key,
      date: plan.date,
      time: plan.time,
      activity: plan.activity,
      place: plan.place,
      author,
      stars,
      overflow,
      note: noteEl.value.trim()
    };
    try {
      const saved = normalize((await window.DateApp.apiRequest("/journal", "PUT", body)).entries);
      // PUT answers with the reviews only; the full scrapbook comes from GET.
      const review = saved.find((entry) => entry.key === body.key)?.reviews;
      const mine = entries.find((entry) => entry.key === body.key);
      if (review && mine) mine.reviews = review;
      else if (review) {
        const { key, date, time, activity, place } = body;
        entries = normalize([{ key, date, time, activity, place, current: key === window.DateApp.entryKey(window.DateApp.plan), reviews: review }, ...entries]);
      }
      formDirty = false;
      chosenKey = "";
      render(true);
      load({ fresh: true });
      savedEl.hidden = !canPlanNext();
      window.LetterFX?.burstFrom(saveButton, 26);
      window.LetterFX?.chime?.();
      window.DateActivity?.post({
        kind: "journal.review",
        text: body.overflow ? "rated our date ∞ / 5" : `rated our date ${plural(body.stars, "heart")}`,
        detail: `${body.activity} · ${window.DateApp.formatDate(body.date)}`,
        step: "journal",
        icon: "heart"
      });
      if (author === "her") {
        window.DateApp.notify(
          overflow ? `${names.her} rated your date ∞/5 💞 (she broke the scale)` : `${names.her} rated your date ${stars}/5 ${stars >= 4 ? "💕" : "💌"}`,
          `${body.activity} · ${window.DateApp.formatDate(body.date)}${body.note ? `\n“${body.note}”` : ""}`,
          ["heart", "star"]
        );
      }
    } catch (error) {
      showError(error.message || "Couldn’t save that. Please try again.");
    } finally {
      saveButton.disabled = false;
    }
  });

  [nextButton, $("#journal-saved-next")].forEach((button) => button?.addEventListener("click", () => {
    window.DateApp.startNextPlan?.();
  }));

  listEl.addEventListener("click", (event) => {
    const card = event.target.closest("[data-key]");
    if (!card) return;
    const tile = event.target.closest(".media-tile");
    if (tile) { openGallery(card, tile); return; }
    const add = event.target.closest("[data-add-media]");
    if (add) {
      pickKey = add.dataset.addMedia;
      mediaInput.click();
      return;
    }
    const rate = event.target.closest("[data-review-key]");
    if (rate) {
      // Rate (or re-rate) this date: unsaved changes to another date's review are dropped on purpose.
      chosenKey = rate.dataset.reviewKey;
      formDirty = false;
      savedEl.hidden = true;
      renderForm();
      form.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      return;
    }
    const outfit = event.target.closest("[data-outfit-media]");
    if (outfit) {
      window.DateMedia.view([{ id: outfit.dataset.outfitMedia, kind: "photo", author: outfit.dataset.outfitAuthor, hasThumb: true }], 0, { canDelete: false });
      return;
    }
    const dismiss = event.target.closest("[data-dismiss-upload]");
    if (dismiss) {
      uploads = uploads.filter((job) => String(job.uid) !== dismiss.dataset.dismissUpload);
      renderChips(card.dataset.key);
      card.querySelector("[data-add-media]")?.focus({ preventScroll: true });
    }
  });

  // The outfit thumbnail falls back to the full photo, then hides.
  listEl.addEventListener("error", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.closest(".scrap-outfit")) return;
    if (img.dataset.fallback) {
      img.src = img.dataset.fallback;
      delete img.dataset.fallback;
    } else {
      img.closest(".scrap-outfit-photo").classList.add("is-missing");
      img.remove();
    }
  }, true);

  mediaInput.addEventListener("change", () => {
    const files = [...(mediaInput.files || [])];
    const key = pickKey;
    mediaInput.value = "";
    pickKey = null;
    if (files.length && key) queueUploads(key, files);
  });

  window.addEventListener("beforeunload", (event) => {
    if (!uploading()) return;
    event.preventDefault();
    event.returnValue = "";
  });

  document.addEventListener("date:plan", (event) => {
    if (promptEl) promptEl.hidden = !window.DateApp.planStarted(event.detail.plan);
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "journal") {
      savedEl.hidden = true;
      load({ full: true });
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && window.DateApp?.step === "journal") load();
  });
})();
