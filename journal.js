/*
 * Date journal: after a date has started, each of you rates it (1–5 hearts),
 * writes a note and can add a photo. Entries are stored in the Worker, so
 * past dates stay as a shared history on both phones.
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
  const photoInput = $("#journal-photo-input");
  const photoPreview = $("#journal-photo-preview");
  const photoRemove = $("#journal-photo-remove");
  const photoLabel = $("#photo-pick-label");
  const saveButton = $("#journal-save");
  const errorEl = $("#journal-error");
  const waitingEl = $("#journal-waiting");
  const listEl = $("#journal-list");
  const promptEl = $("#journal-prompt");
  const AUTHOR_KEY = "date-letter-author";
  const MAX_PHOTO_CHARS = 650000;
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
  let photo; // undefined: keep the saved one · null: remove it · string: new photo
  let entries = [];
  let loaded = false;
  const photoCache = new Map();

  const escape = (text) => window.DateApp.escapeHtml(text);
  const entryKey = (plan) => `${plan.date}T${plan.time}`;

  function planStarted(plan) {
    if (!plan || plan.status !== "confirmed") return false;
    const [year, month, day] = plan.date.split("-").map(Number);
    const [hour, minute] = plan.time.split(":").map(Number);
    return window.DateApp.dateInTimeZone(year, month, day, hour, minute).getTime() <= Date.now();
  }

  authorButtons.forEach((button) => { button.textContent = names[button.dataset.author]; });
  ratingEl.innerHTML = [1, 2, 3, 4, 5].map((value) =>
    `<button type="button" role="radio" aria-checked="false" aria-label="${value} heart${value === 1 ? "" : "s"}" data-stars="${value}">${HEART}</button>`
  ).join("") + '<span class="heart-infinity" hidden>∞ / 5</span>';
  const infinityEl = ratingEl.querySelector(".heart-infinity");

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

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

  function setPreview(src) {
    photoPreview.hidden = !src;
    photoRemove.hidden = !src;
    if (src) photoPreview.src = src;
    else photoPreview.removeAttribute("src");
    photoLabel.textContent = src ? "Change photo" : "Add a photo";
  }

  // Fill the form with what this person already wrote for the current date.
  function prefill() {
    const plan = window.DateApp.plan;
    const review = plan && author ? entries.find((entry) => entry.key === entryKey(plan))?.reviews?.[author] : null;
    resetHeartTaps();
    setStars(review?.stars || 0, Boolean(review?.overflow));
    noteEl.value = review?.note || "";
    photo = undefined;
    setPreview(null);
    if (review?.hasPhoto) loadPhoto(entryKey(plan), author).then((src) => { if (photo === undefined && src) setPreview(src); });
    saveButton.firstChild.textContent = review ? "Update my review " : "Save to our journal ";
  }

  async function loadPhoto(key, who) {
    const cacheKey = `${key}:${who}`;
    if (photoCache.has(cacheKey)) return photoCache.get(cacheKey);
    try {
      const data = await window.DateApp.apiRequest(`/journal/photo?key=${encodeURIComponent(key)}&author=${encodeURIComponent(who)}`);
      const src = typeof data.photo === "string" && data.photo.startsWith("data:image/") ? data.photo : null;
      photoCache.set(cacheKey, src);
      return src;
    } catch {
      return null;
    }
  }

  function hearts(count, infinite) {
    return [1, 2, 3, 4, 5].map((value) => `<span class="${value <= count ? "is-on" : ""}">${HEART}</span>`).join("")
      + (infinite ? '<b class="journal-infinity">∞</b>' : "");
  }

  function renderList() {
    if (!entries.length) {
      listEl.innerHTML = '<p class="journal-empty">No dates in here yet. Our first one goes right here.</p>';
      return;
    }
    listEl.innerHTML = entries.map((entry) => {
      const reviews = ["her", "sender"].map((who) => {
        const review = entry.reviews?.[who];
        if (!review) return `<div class="journal-review is-pending"><p class="journal-review-head"><span>${escape(names[who])}</span></p><p class="journal-pending">Hasn't written yet</p></div>`;
        return `<div class="journal-review">
          <p class="journal-review-head"><span>${escape(names[who])}</span><span class="journal-hearts" role="img" aria-label="${review.overflow ? "Off the scale, infinity" : review.stars} out of 5 hearts">${hearts(review.stars, review.overflow)}</span></p>
          ${review.note ? `<p class="journal-note">“${escape(review.note)}”</p>` : ""}
          ${review.hasPhoto ? `<img class="journal-img" alt="Photo from ${escape(names[who])}" data-key="${escape(entry.key)}" data-author="${who}">` : ""}
        </div>`;
      }).join("");
      return `<article class="journal-entry">
        <header><strong>${escape(entry.activity)}</strong><small>${escape(window.DateApp.formatDate(entry.date))} · ${escape(entry.place)}</small></header>
        <div class="journal-reviews">${reviews}</div>
      </article>`;
    }).join("");
    listEl.querySelectorAll("img[data-key]").forEach(async (img) => {
      const src = await loadPhoto(img.dataset.key, img.dataset.author);
      if (src) img.src = src;
      else img.remove();
    });
  }

  function render() {
    const plan = window.DateApp.plan;
    const canRate = planStarted(plan);
    form.hidden = !canRate || !loaded;
    waitingEl.hidden = canRate || !plan || plan.status !== "confirmed";
    if (canRate) {
      forEl.textContent = `${plan.activity} · ${window.DateApp.formatDate(plan.date)}`;
      authorButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.author === author)));
      prefill();
    }
    renderList();
  }

  async function load() {
    showError("");
    try {
      entries = (await window.DateApp.apiRequest("/journal")).entries || [];
      loaded = true;
    } catch (error) {
      loaded = false;
      listEl.innerHTML = `<p class="journal-empty">${error.status === 404
        ? "The journal needs the latest server update first."
        : "Couldn’t load the journal. Check your connection and try again."}</p>`;
      form.hidden = true;
      return;
    }
    render();
  }

  async function shrinkPhoto(file) {
    let source;
    try {
      source = await createImageBitmap(file);
    } catch {
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
    }
    const naturalWidth = source.width || source.naturalWidth;
    const naturalHeight = source.height || source.naturalHeight;
    let maxSide = 1280;
    let quality = 0.82;
    const canvas = document.createElement("canvas");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const scale = Math.min(1, maxSide / Math.max(naturalWidth, naturalHeight));
      canvas.width = Math.round(naturalWidth * scale);
      canvas.height = Math.round(naturalHeight * scale);
      canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL("image/jpeg", quality);
      if (data.length <= MAX_PHOTO_CHARS) return data;
      maxSide *= 0.8;
      quality = Math.max(0.55, quality - 0.07);
    }
    throw new Error("That photo is too large. Try another one.");
  }

  authorButtons.forEach((button) => button.addEventListener("click", () => setAuthor(button.dataset.author)));
  ratingEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-stars]");
    if (!button) return;
    const value = Number(button.dataset.stars);
    setStars(value, overflow);
    countHeartTap(value);
  });
  ratingEl.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const next = Math.min(5, Math.max(1, (stars || 0) + (event.key === "ArrowRight" ? 1 : -1)));
    setStars(next, overflow);
    ratingEl.querySelector(`[data-stars="${next}"]`)?.focus();
  });
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    photoInput.value = "";
    if (!file) return;
    showError("");
    photoLabel.textContent = "Preparing photo…";
    try {
      photo = await shrinkPhoto(file);
      setPreview(photo);
    } catch (error) {
      showError(error.message || "That photo couldn't be read.");
      photoLabel.textContent = "Add a photo";
    }
  });
  photoRemove.addEventListener("click", () => {
    photo = null;
    setPreview(null);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const plan = window.DateApp.plan;
    if (!planStarted(plan)) return;
    if (!author) { showError("Tap who's writing first."); return; }
    if (!stars) { showError("Pick 1 to 5 hearts."); return; }
    showError("");
    saveButton.disabled = true;
    const body = {
      key: entryKey(plan),
      date: plan.date,
      time: plan.time,
      activity: plan.activity,
      place: plan.place,
      author,
      stars,
      overflow,
      note: noteEl.value.trim()
    };
    if (photo !== undefined) body.photo = photo;
    const addedPhoto = typeof photo === "string";
    try {
      entries = (await window.DateApp.apiRequest("/journal", "PUT", body)).entries || [];
      if (photo !== undefined) photoCache.set(`${body.key}:${author}`, photo);
      render();
      window.LetterFX?.burstFrom(saveButton, 26);
      window.LetterFX?.chime?.();
      if (author === "her") {
        window.DateApp.notify(
          overflow ? `${names.her} rated your date ∞/5 💞 (she broke the scale)` : `${names.her} rated your date ${stars}/5 ${stars >= 4 ? "💕" : "💌"}`,
          `${body.activity} · ${window.DateApp.formatDate(body.date)}${body.note ? `\n“${body.note}”` : ""}${addedPhoto ? "\nShe added a photo too." : ""}`,
          ["heart", "star"]
        );
      }
    } catch (error) {
      showError(error.message || "Couldn’t save that. Please try again.");
    } finally {
      saveButton.disabled = false;
    }
  });

  document.addEventListener("date:plan", (event) => {
    if (promptEl) promptEl.hidden = !planStarted(event.detail.plan);
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "journal") load();
  });
})();
