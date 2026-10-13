/*
 * Outfit vote: either of us posts outfit photos for the current date, then we
 * each rate them (1–5 hearts), comment, and pick a favorite. Stored per date in
 * the Worker (the photos go through media.js), so both phones see the same vote.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="outfits"]');
  if (!section) return;

  const forEl = $("#outfit-for");
  const noPlanEl = $("#outfit-noplan");
  const boardEl = $("#outfit-board");
  const form = $("#outfit-form");
  const fileInput = $("#outfit-file");
  const pickLabel = $("#outfit-pick");
  const draftEl = $("#outfit-draft");
  const draftImg = $("#outfit-draft-img");
  const titleInput = $("#outfit-title");
  const cancelButton = $("#outfit-cancel");
  const postButton = $("#outfit-post");
  const progressEl = $("#outfit-progress");
  const progressFill = $("#outfit-progress-fill");
  const errorEl = $("#outfit-error");
  const listEl = $("#outfit-list");

  const POLL_MS = 10000;
  const COMMENTS_SHOWN = 4;
  const PICK_ICONS = { her: "crown", sender: "heart" };
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

  let key = "";            // the date (plan key) these outfits belong to
  let confirmed = empty(); // last state the server sent: { outfits, favorites }
  let pending = [];        // optimistic changes still on their way to the server
  let loaded = false;
  let epoch = 0;           // bumps on every change, so an older poll can't undo it
  let queue = Promise.resolve();
  let pollTimer = null;
  let draftFile = null;
  let draftUrl = "";
  let uploading = false;
  let fetchingMedia = false;
  const media = new Map();     // mediaId -> Media (for thumbnails and the lightbox)
  const expanded = new Set();  // outfits whose full comment list is open
  const rendered = new WeakMap();
  let tempCount = 0;

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = (who) => (who === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const icon = (name, extra = "") => `<i class="icon${extra ? ` ${extra}` : ""}" data-lucide="${name}" aria-hidden="true"></i>`;

  function empty() {
    return { outfits: [], favorites: {} };
  }

  function normalize(data) {
    const outfits = (Array.isArray(data?.outfits) ? data.outfits : []).map((outfit) => ({
      ...outfit,
      ratings: outfit.ratings || {},
      comments: Array.isArray(outfit.comments) ? outfit.comments : []
    }));
    return { outfits, favorites: { ...(data?.favorites || {}) } };
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // Replaces a part's markup only when it changed, keeping focus on the same control.
  function setHtml(element, html) {
    if (rendered.get(element) === html) return;
    const focused = element.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    element.innerHTML = html;
    rendered.set(element, html);
    icons(element);
    if (focused) element.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  }

  function stamp(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const zone = "Europe/Zurich";
    const day = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(value);
    const time = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    if (day(date) === day(new Date())) return time;
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(date)}, ${time}`;
  }

  function fileUrl(id) {
    return window.DateMedia?.fileUrl?.(id) || app().apiUrl(`/media/file?id=${encodeURIComponent(id)}`);
  }

  function thumbUrl(id) {
    return window.DateMedia?.thumbUrl?.(id) || app().apiUrl(`/media/thumb?id=${encodeURIComponent(id)}`);
  }

  function planKey() {
    const plan = app()?.plan;
    return plan && plan.status !== "cancelled" ? app().entryKey(plan) : "";
  }

  // What the page shows: the server's state with the not-yet-saved changes on top.
  function current() {
    const state = JSON.parse(JSON.stringify(confirmed));
    pending.forEach((op) => op.apply?.(state));
    return state;
  }

  function titleOf(outfit, index) {
    return outfit.title || `Outfit ${index + 1}`;
  }

  /* ------------------------------- Render -------------------------------- */
  function render() {
    const plan = app()?.plan;
    const hasPlan = Boolean(key);
    noPlanEl.hidden = hasPlan;
    boardEl.hidden = !hasPlan;
    forEl.hidden = !hasPlan;
    if (!hasPlan) {
      noPlanEl.textContent = plan?.status === "cancelled"
        ? "Our date is cancelled right now. Once it's back on, we can vote on outfits here."
        : "Once we have a date planned, we can post outfit ideas here and vote on them together.";
      return;
    }
    forEl.textContent = `For ${plan.activity} · ${app().formatDate(plan.date)}`;
    if (!loaded) return;
    renderList(current());
  }

  function renderList(state) {
    const { outfits, favorites } = state;
    listEl.querySelector(".outfit-empty")?.remove();
    const cards = new Map([...listEl.querySelectorAll(".outfit-card")].map((card) => [card.dataset.id, card]));
    outfits.forEach((outfit, index) => {
      let card = cards.get(outfit.id);
      if (!card) card = createCard(outfit.id);
      cards.delete(outfit.id);
      updateCard(card, outfit, index, favorites);
      if (listEl.children[index] !== card) listEl.insertBefore(card, listEl.children[index] || null);
    });
    cards.forEach((card) => card.remove());
    if (!outfits.length) {
      listEl.insertAdjacentHTML("beforeend", `<p class="outfit-empty">${icon("shirt")}<span>No outfits yet. Post the first one and we'll vote on it together.</span></p>`);
      icons(listEl);
    }
  }

  function createCard(id) {
    const card = document.createElement("article");
    card.className = "outfit-card";
    card.dataset.id = id;
    card.innerHTML = `<div class="outfit-figure"><div class="outfit-photo-wrap"></div><div class="outfit-badges"></div></div>
      <div class="outfit-body">
        <div class="outfit-head"></div>
        <div class="outfit-vote"></div>
        <div class="outfit-comments">
          <div class="outfit-thread"></div>
          <form class="outfit-comment-form" novalidate>
            <input type="text" maxlength="300" placeholder="Say something about it…" aria-label="Write a comment" autocomplete="off" enterkeyhint="send">
            <button class="outfit-comment-send" type="submit" aria-label="Send comment">${icon("send")}</button>
          </form>
        </div>
      </div>`;
    icons(card);
    return card;
  }

  function updateCard(card, outfit, index, favorites) {
    const self = me();
    const title = titleOf(outfit, index);
    const picks = ["her", "sender"].filter((who) => favorites[who] === outfit.id);
    card.classList.toggle("is-picked", picks.length > 0);
    card.classList.toggle("is-match", picks.length === 2);
    card.classList.toggle("is-mine", outfit.author === self);

    setHtml(card.querySelector(".outfit-photo-wrap"), photoHtml(outfit, title));
    setHtml(card.querySelector(".outfit-badges"), picks.map((who) =>
      `<span class="outfit-badge is-${who}">${icon(PICK_ICONS[who])}<span>${escape(nameOf(who))}'s pick</span></span>`
    ).join(""));

    setHtml(card.querySelector(".outfit-head"), `<div class="outfit-name"><strong>${escape(title)}</strong><small>by ${escape(nameOf(outfit.author))}${outfit.at ? ` · ${escape(stamp(outfit.at))}` : ""}</small></div>
      ${outfit.author === self ? `<button class="planner-icon-btn outfit-delete" type="button" data-focus="delete" aria-label="Delete ${escape(title)}">${icon("trash-2")}</button>` : ""}`);

    const mine = Number(outfit.ratings[self]) || 0;
    const theirs = Number(outfit.ratings[other(self)]) || 0;
    const otherName = nameOf(other(self));
    const picked = favorites[self] === outfit.id;
    setHtml(card.querySelector(".outfit-vote"), `<div class="outfit-scores">
        <span class="outfit-score-label" id="outfit-rate-${escape(outfit.id)}">Your hearts</span>
        ${theirs
          ? `<span class="outfit-theirs" role="img" aria-label="${escape(otherName)} gave it ${theirs} out of 5 hearts"><b>${escape(otherName)}</b><span class="outfit-mini">${miniHearts(theirs)}</span></span>`
          : `<span class="outfit-theirs is-waiting">${escape(otherName)} hasn't rated yet</span>`}
      </div>
      <div class="outfit-rate" role="radiogroup" aria-labelledby="outfit-rate-${escape(outfit.id)}">${[1, 2, 3, 4, 5].map((value) =>
        `<button type="button" role="radio" class="${value <= mine ? "is-on" : ""}" aria-checked="${value === mine}" aria-label="${value} heart${value === 1 ? "" : "s"}" data-rate="${value}" data-focus="rate-${value}">${HEART}</button>`
      ).join("")}</div>
      <button class="outfit-pick" type="button" aria-pressed="${picked}" data-focus="pick">${icon(PICK_ICONS[self])}<span>My pick</span></button>`);

    const comments = outfit.comments;
    const hidden = expanded.has(outfit.id) ? 0 : Math.max(0, comments.length - COMMENTS_SHOWN);
    setHtml(card.querySelector(".outfit-thread"), (hidden
      ? `<button class="outfit-more" type="button" data-focus="more">Show all ${comments.length} comments</button>` : "")
      + (comments.length ? `<ul class="outfit-comment-list">${comments.slice(hidden).map((comment) => {
        const own = comment.author === self;
        return `<li class="outfit-comment${own ? " is-mine" : ""}${comment.pending ? " is-pending" : ""}">
          <p><strong>${escape(nameOf(comment.author))}</strong> ${escape(comment.text)}</p>
          <time datetime="${escape(comment.at || "")}">${escape(comment.pending ? "Sending…" : stamp(comment.at))}</time>
          ${own && !comment.pending ? `<button class="planner-icon-btn outfit-comment-delete" type="button" data-comment-id="${escape(comment.id)}" data-focus="uncomment-${escape(comment.id)}" aria-label="Delete your comment">${icon("x")}</button>` : ""}
        </li>`;
      }).join("")}</ul>` : ""));
  }

  function photoHtml(outfit, title) {
    const meta = media.get(outfit.mediaId);
    const full = fileUrl(outfit.mediaId);
    const thumb = meta?.hasThumb ? thumbUrl(outfit.mediaId) : "";
    // Small phones get the thumbnail, sharp screens the full photo.
    const srcset = thumb ? ` srcset="${escape(thumb)} 480w, ${escape(full)} ${Math.max(481, Number(meta.width) || 2048)}w" sizes="(max-width: 520px) 88vw, 400px"` : "";
    return `<button class="outfit-photo" type="button" data-focus="photo" aria-label="Open the photo of ${escape(title)}">
      <img src="${escape(thumb || full)}"${srcset} alt="" loading="lazy" decoding="async">
      <span class="outfit-photo-fallback">${icon("image-off")}</span>
    </button>`;
  }

  function miniHearts(count) {
    return [1, 2, 3, 4, 5].map((value) => `<span class="${value <= count ? "is-on" : ""}">${HEART}</span>`).join("");
  }

  /* ------------------------------- Sync ---------------------------------- */
  function syncKey() {
    const next = planKey();
    if (next === key) return;
    key = next;
    confirmed = empty();
    pending = [];
    loaded = false;
    expanded.clear();
    listEl.innerHTML = "";
    showError("");
  }

  async function load({ quiet = false } = {}) {
    syncKey();
    render();
    if (!key) return;
    const forKey = key;
    const started = epoch;
    if (!loaded && !quiet) listEl.innerHTML = '<p class="outfit-empty is-loading">Loading the outfits…</p>';
    try {
      const data = await app().apiRequest(`/outfits?key=${encodeURIComponent(forKey)}`);
      if (forKey !== key || started !== epoch || pending.length) return;
      confirmed = normalize(data);
      if (!loaded) listEl.innerHTML = "";
      loaded = true;
      if (!quiet) showError("");
      render();
      loadMedia();
    } catch (error) {
      if (forKey !== key || loaded) return;
      listEl.innerHTML = `<p class="outfit-empty">${error.status === 404
        ? "The outfit vote needs the latest server update first."
        : "Couldn’t load the outfits. Check your connection and try again."}</p>`;
    }
  }

  // Thumbnails and the lightbox need each photo's details; fetch them when a new one shows up.
  async function loadMedia() {
    if (fetchingMedia || !key || confirmed.outfits.every((outfit) => media.has(outfit.mediaId))) return;
    fetchingMedia = true;
    const forKey = key;
    try {
      const data = await app().apiRequest(`/media?key=${encodeURIComponent(forKey)}&scope=outfit`);
      (data.media || []).forEach((item) => media.set(item.id, item));
      if (forKey === key) render();
    } catch { /* The full-size photos still work without it. */ }
    finally { fetchingMedia = false; }
  }

  // Sends one change; changes go out one at a time so the answers come back in order.
  // `apply` shows the change right away and is dropped again (rolled back) if it fails.
  function send(body, apply = null) {
    const op = { apply };
    if (apply) pending.push(op);
    epoch += 1;
    render();
    const run = queue.then(async () => {
      try {
        const data = await app().apiRequest("/outfits", "POST", body);
        if (body.key === key) {
          confirmed = normalize(data);
          loaded = true;
        }
        return data;
      } finally {
        pending = pending.filter((item) => item !== op);
        epoch += 1;
        render();
        loadMedia();
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  function findOutfit(state, id) {
    return state.outfits.find((outfit) => outfit.id === id);
  }

  function failed(error, fallback) {
    // Offline the browser only says "Failed to fetch" / "Load failed"; show a plain message then.
    showError(error?.status ? error.message : fallback);
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (!document.hidden && app()?.step === "outfits") load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------ Actions -------------------------------- */
  function rate(id, stars) {
    const author = me();
    const outfit = findOutfit(current(), id);
    if (!outfit || outfit.ratings[author] === stars) return;
    showError("");
    send({ action: "rate", key, id, author, stars }, (state) => {
      const target = findOutfit(state, id);
      if (target) target.ratings = { ...target.ratings, [author]: stars };
    }).catch((error) => failed(error, "Couldn’t save your hearts. Please try again."));
  }

  function togglePick(id) {
    const author = me();
    const state = current();
    const outfit = findOutfit(state, id);
    if (!outfit) return;
    const next = state.favorites[author] === id ? null : id;
    const index = state.outfits.indexOf(outfit);
    showError("");
    send({ action: "favorite", key, author, id: next }, (draft) => {
      draft.favorites = { ...draft.favorites, [author]: next };
    }).then(() => {
      if (!next) return;
      const card = listEl.querySelector(`.outfit-card[data-id="${CSS.escape(id)}"]`);
      window.LetterFX?.burstFrom(card?.querySelector(".outfit-pick") || card, 18);
      if (author === "her") {
        const title = titleOf(outfit, index);
        app().notify(`${nameOf("her")} picked her favorite outfit: ${title}`, outfitLine(), ["crown"]);
      }
    }).catch((error) => failed(error, "Couldn’t save your pick. Please try again."));
  }

  function comment(id, input) {
    const text = input.value.trim().slice(0, 300);
    if (!text) return;
    const author = me();
    const state = current();
    const outfit = findOutfit(state, id);
    if (!outfit) return;
    const index = state.outfits.indexOf(outfit);
    const temp = { id: `temp-${tempCount += 1}`, author, text, at: new Date().toISOString(), pending: true };
    input.value = "";
    showError("");
    send({ action: "comment", key, id, author, text }, (draft) => {
      const target = findOutfit(draft, id);
      if (target) target.comments = [...target.comments, temp];
    }).then(() => {
      if (author === "her") {
        app().notify(`${nameOf("her")} commented on ${titleOf(outfit, index)}`, `“${text}”\n${outfitLine()}`, ["speech_balloon"]);
      }
    }).catch((error) => {
      if (!input.value) input.value = text;
      failed(error, "Couldn’t send that comment. Please try again.");
    });
  }

  function uncomment(id, commentId) {
    const author = me();
    showError("");
    send({ action: "uncomment", key, id, commentId, author }, (draft) => {
      const target = findOutfit(draft, id);
      if (target) target.comments = target.comments.filter((item) => item.id !== commentId);
    }).catch((error) => failed(error, "Couldn’t delete that comment. Please try again."));
  }

  function dropOutfits(draft, matches) {
    const gone = draft.outfits.filter(matches).map((outfit) => outfit.id);
    draft.outfits = draft.outfits.filter((outfit) => !gone.includes(outfit.id));
    Object.keys(draft.favorites).forEach((who) => {
      if (gone.includes(draft.favorites[who])) draft.favorites[who] = null;
    });
  }

  function remove(id) {
    const state = current();
    const outfit = findOutfit(state, id);
    if (!outfit || outfit.author !== me()) return;
    const title = titleOf(outfit, state.outfits.indexOf(outfit));
    if (!window.confirm(`Delete “${title}”? Its photo, hearts and comments go too.`)) return;
    showError("");
    send({ action: "remove", key, id, author: me() }, (draft) => dropOutfits(draft, (item) => item.id === id))
      .catch((error) => failed(error, "Couldn’t delete that outfit. Please try again."));
  }

  function openPhoto(id) {
    const state = current();
    const index = state.outfits.findIndex((outfit) => outfit.id === id);
    if (index < 0) return;
    const items = state.outfits.map((outfit) => media.get(outfit.mediaId) || {
      id: outfit.mediaId, key: outfit.key || key, scope: "outfit", kind: "photo", mime: "image/jpeg",
      author: outfit.author, status: "ready", hasThumb: false, at: outfit.at
    });
    if (!window.DateMedia?.view) {
      window.open(fileUrl(items[index].id), "_blank", "noopener");
      return;
    }
    window.DateMedia.view(items, index, {
      // Deleting a photo there also deletes the outfit that uses it (Worker side).
      onDelete: (item) => {
        media.delete(item.id);
        dropOutfits(confirmed, (outfit) => outfit.mediaId === item.id);
        epoch += 1;
        render();
        load({ quiet: true });
      }
    });
  }

  function outfitLine() {
    const plan = app().plan;
    return plan ? `For ${plan.activity} · ${app().formatDate(plan.date)}` : "";
  }

  /* ------------------------------ New outfit ----------------------------- */
  function setProgress(fraction) {
    const percent = Math.round(Math.min(1, Math.max(0, Number(fraction) || 0)) * 100);
    progressFill.style.width = `${percent}%`;
    progressEl.setAttribute("aria-valuenow", String(percent));
    if (uploading) postButton.firstChild.textContent = percent < 100 ? `Uploading ${percent}% ` : "Posting… ";
  }

  function setUploading(value) {
    uploading = value;
    progressEl.hidden = !value;
    postButton.disabled = value;
    cancelButton.disabled = value;
    titleInput.disabled = value;
    if (!value) postButton.firstChild.textContent = "Post outfit ";
  }

  function showDraft(file) {
    clearDraft();
    draftFile = file;
    try { draftUrl = URL.createObjectURL(file); } catch { draftUrl = ""; }
    if (draftUrl) draftImg.src = draftUrl;
    draftImg.hidden = !draftUrl;
    draftEl.hidden = false;
    pickLabel.hidden = true;
    draftEl.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "nearest" });
  }

  function clearDraft() {
    if (draftUrl) URL.revokeObjectURL(draftUrl);
    draftUrl = "";
    draftFile = null;
    draftImg.removeAttribute("src");
    titleInput.value = "";
    draftEl.hidden = true;
    pickLabel.hidden = false;
    progressFill.style.width = "0%";
  }

  async function postOutfit() {
    if (uploading || !draftFile || !key) return;
    if (!window.DateMedia?.upload) {
      showError("Photo uploads aren’t ready yet. Please reload the page and try again.");
      return;
    }
    const postKey = key;
    const author = me();
    const title = titleInput.value.trim().slice(0, 60);
    showError("");
    setUploading(true);
    setProgress(0);
    let uploaded = null;
    try {
      uploaded = await window.DateMedia.upload(draftFile, { key: postKey, scope: "outfit", onProgress: setProgress });
      media.set(uploaded.id, uploaded);
      setProgress(1);
      const data = await send({ action: "add", key: postKey, author, title, mediaId: uploaded.id });
      uploaded = null;
      setUploading(false);
      clearDraft();
      const added = normalize(data).outfits.filter((outfit) => outfit.author === author).pop();
      const card = added && listEl.querySelector(`.outfit-card[data-id="${CSS.escape(added.id)}"]`);
      if (card) {
        card.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        window.LetterFX?.burstFrom(card, 24);
      }
      window.LetterFX?.chime?.();
      if (author === "her") {
        app().notify(title ? `${nameOf("her")} posted an outfit: ${title}` : `${nameOf("her")} posted an outfit`, outfitLine(), ["shirt"]);
      }
    } catch (error) {
      setUploading(false);
      // A network failure only says "Failed to fetch" / "Load failed"; upload errors are already worded.
      showError(error instanceof TypeError || !error?.message ? "Couldn’t post that outfit. Check your connection and try again." : error.message);
      // The photo made it but the outfit didn't: don't leave it lying around.
      if (uploaded) window.DateMedia.remove?.(uploaded.id).catch(() => {});
    }
  }

  /* ------------------------------- Wiring -------------------------------- */
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = "";
    if (!file) return;
    showError("");
    if (file.type && !file.type.startsWith("image/")) {
      showError("That isn’t a photo. Pick a picture of the outfit.");
      return;
    }
    showDraft(file);
  });
  cancelButton.addEventListener("click", () => {
    if (uploading) return;
    clearDraft();
    showError("");
    fileInput.focus({ preventScroll: true });
  });
  // A photo the browser can't preview (HEIC on some browsers) still uploads fine.
  draftImg.addEventListener("error", () => { if (draftImg.getAttribute("src")) draftImg.hidden = true; });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    postOutfit();
  });

  listEl.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    const card = target?.closest(".outfit-card");
    if (!target || !card) return;
    const id = card.dataset.id;
    if (target.matches(".outfit-photo")) openPhoto(id);
    else if (target.matches("[data-rate]")) rate(id, Number(target.dataset.rate));
    else if (target.matches(".outfit-pick")) togglePick(id);
    else if (target.matches(".outfit-delete")) remove(id);
    else if (target.matches(".outfit-comment-delete")) uncomment(id, target.dataset.commentId);
    else if (target.matches(".outfit-more")) {
      expanded.add(id);
      render();
    }
  });
  listEl.addEventListener("keydown", (event) => {
    const button = event.target.closest?.("[data-rate]");
    if (!button || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const stars = Math.min(5, Math.max(1, Number(button.dataset.rate) + (event.key === "ArrowRight" ? 1 : -1)));
    button.parentElement.querySelector(`[data-rate="${stars}"]`)?.focus();
    rate(button.closest(".outfit-card").dataset.id, stars);
  });
  listEl.addEventListener("submit", (event) => {
    const commentForm = event.target.closest(".outfit-comment-form");
    if (!commentForm) return;
    event.preventDefault();
    comment(commentForm.closest(".outfit-card").dataset.id, commentForm.querySelector("input"));
  });
  // A photo that can't load shows a soft placeholder instead of a broken image.
  listEl.addEventListener("error", (event) => {
    if (event.target.tagName === "IMG") event.target.closest(".outfit-photo")?.classList.add("is-broken");
  }, true);

  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "outfits") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("date:plan", () => {
    if (app()?.step === "outfits" && planKey() !== key) load();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "outfits") load({ quiet: true });
  });
})();
