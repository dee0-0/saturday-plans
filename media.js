/*
 * Photos and videos for the journal and the outfit vote (window.DateMedia).
 * Files are prepared on the phone first (photos become a 2048px JPEG, both get
 * a small thumbnail), then uploaded to the Worker, which keeps them in chunks.
 * view() opens a full-screen viewer with swipe, arrow keys and a delete button
 * on your own items. Its styles live in journal.css.
 *
 * Items are Media objects from the Worker. Things that don't live in the media
 * store (like the journal's older review photos) can pass `src` (the full image
 * URL), `thumbSrc` (the tile image) and `legacy: true` (never deletable).
 */
(function () {
  "use strict";

  const MB = 1024 * 1024;
  const PHOTO_LIMIT = 8 * MB;
  const VIDEO_LIMIT = 80 * MB;
  const THUMB_LIMIT = 300 * 1024;
  const PHOTO_SIDE = 2048;
  const PHOTO_QUALITY = 0.85;
  const THUMB_SIDE = 480;
  const THUMB_QUALITY = 0.72;
  const VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"];
  const VIDEO_EXTENSIONS = { mp4: "video/mp4", mov: "video/quicktime", qt: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm" };
  const PHOTO_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "heic", "heif", "gif", "avif"];
  const OFFLINE = "Couldn’t reach the server. Check your connection and try again.";

  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  // Inline lucide SVGs, so markup from tileHtml() needs no icon refresh.
  function icon(name) {
    const key = name.replace(/(^|-)(\w)/g, (_, __, letter) => letter.toUpperCase());
    const node = window.lucide?.icons?.[key];
    if (!node || typeof window.lucide.createElement !== "function") return `<i class="icon" data-lucide="${name}" aria-hidden="true"></i>`;
    const svg = window.lucide.createElement(node);
    svg.setAttribute("class", `icon lucide lucide-${name}`);
    svg.setAttribute("aria-hidden", "true");
    return svg.outerHTML;
  }

  const app = () => window.DateApp;
  const nameOf = (who) => app()?.names?.[who] || "";
  const fileUrl = (id) => app().apiUrl(`/media/file?id=${encodeURIComponent(id)}`);
  const thumbUrl = (id) => app().apiUrl(`/media/thumb?id=${encodeURIComponent(id)}`);

  function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return "";
    const total = Math.max(1, Math.round(seconds));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
  }

  /* ------------------------------ Preparing ------------------------------ */
  function extension(name) {
    const match = /\.([a-z0-9]+)$/i.exec(name || "");
    return match ? match[1].toLowerCase() : "";
  }

  function kindOf(file) {
    const type = String(file.type || "").toLowerCase();
    if (type.startsWith("image/")) return "photo";
    if (type.startsWith("video/")) return "video";
    const ext = extension(file.name);
    if (VIDEO_EXTENSIONS[ext]) return "video";
    if (PHOTO_EXTENSIONS.includes(ext)) return "photo";
    return null;
  }

  function videoMime(file) {
    const type = String(file.type || "").toLowerCase();
    return VIDEO_TYPES.includes(type) ? type : VIDEO_EXTENSIONS[extension(file.name)] || null;
  }

  function drawScaled(source, width, height, maxSide, background) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (background) {
      // JPEG has no transparency: see-through PNGs get paper white, not black.
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // iPhones cap the total canvas memory, so give it back right away.
  function freeCanvas(canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }

  function canvasJpeg(canvas, quality) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== "function") { reject(new Error("No canvas export.")); return; }
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No canvas export."))), "image/jpeg", quality);
    });
  }

  // A JPEG of `source` at most maxSide wide/tall and at most `limit` bytes.
  async function jpegUnder(source, width, height, { maxSide, quality, limit, background }) {
    let side = maxSide;
    let q = quality;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const canvas = drawScaled(source, width, height, side, background);
      const size = { width: canvas.width, height: canvas.height };
      const blob = await canvasJpeg(canvas, q).finally(() => freeCanvas(canvas));
      if (blob.size <= limit) return { blob, ...size };
      side = Math.round(side * 0.8);
      q = Math.max(0.55, q - 0.08);
    }
    return null;
  }

  async function decodeImage(file) {
    if (typeof window.createImageBitmap === "function") {
      try {
        const bitmap = await window.createImageBitmap(file, { imageOrientation: "from-image" });
        if (bitmap.width && bitmap.height) return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close?.() };
      } catch { /* Older Safari: decode with an <img> below, which also respects the photo's rotation. */ }
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = url;
      });
    } catch {
      URL.revokeObjectURL(url);
      throw new Error("That photo couldn’t be read. Try a different one.");
    }
    if (!img.naturalWidth || !img.naturalHeight) {
      URL.revokeObjectURL(url);
      throw new Error("That photo couldn’t be read. Try a different one.");
    }
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => URL.revokeObjectURL(url) };
  }

  async function preparePhoto(file) {
    const image = await decodeImage(file);
    try {
      const photo = await jpegUnder(image.source, image.width, image.height, { maxSide: PHOTO_SIDE, quality: PHOTO_QUALITY, limit: PHOTO_LIMIT, background: "#fff" });
      if (!photo) throw new Error("That photo is too big. Try another one.");
      const thumb = await jpegUnder(image.source, image.width, image.height, { maxSide: THUMB_SIDE, quality: THUMB_QUALITY, limit: THUMB_LIMIT, background: "#fff" }).catch(() => null);
      return { body: photo.blob, mime: "image/jpeg", width: photo.width, height: photo.height, duration: null, thumb: thumb?.blob || null };
    } catch (error) {
      throw error.message === "No canvas export." ? new Error("That photo couldn’t be prepared. Try a different one.") : error;
    } finally {
      image.release();
    }
  }

  function waitFor(target, eventName, ms) {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => finish(reject, new Error("Timed out.")), ms);
      function finish(callback, value) {
        window.clearTimeout(timer);
        target.removeEventListener(eventName, onEvent);
        target.removeEventListener("error", onError);
        callback(value);
      }
      function onEvent() { finish(resolve); }
      function onError() { finish(reject, new Error("Media error.")); }
      target.addEventListener(eventName, onEvent);
      target.addEventListener("error", onError);
    });
  }

  function isBlank(canvas) {
    try {
      const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      for (let index = 3; index < data.length; index += 16) if (data[index] !== 0) return false;
      return true;
    } catch {
      return true;
    }
  }

  async function frameJpeg(video) {
    if (!video.videoWidth || !video.videoHeight) return null;
    const canvas = drawScaled(video, video.videoWidth, video.videoHeight, THUMB_SIDE);
    try {
      if (isBlank(canvas)) return null;
      const blob = await canvasJpeg(canvas, THUMB_QUALITY);
      return blob.size <= THUMB_LIMIT ? blob : null;
    } finally {
      freeCanvas(canvas);
    }
  }

  async function grabFrame(video) {
    const at = Math.min(0.1, (video.duration || 0.2) / 2);
    let seeked = waitFor(video, "seeked", 5000);
    video.currentTime = at;
    await seeked;
    if (video.readyState < 2) await waitFor(video, "loadeddata", 4000);
    let thumb = await frameJpeg(video);
    if (!thumb) {
      // iOS sometimes only paints a frame once the video has played for a moment.
      try { await video.play(); } catch { /* Low power mode can block this. */ }
      video.pause();
      seeked = waitFor(video, "seeked", 4000);
      video.currentTime = at;
      await seeked;
      thumb = await frameJpeg(video);
    }
    return thumb;
  }

  // Reads size, length and a thumbnail frame. Anything that fails here (a phone
  // that can't decode the video, a blank frame on iOS) just means no thumbnail.
  async function prepareVideo(file) {
    const result = { body: file, mime: videoMime(file), width: null, height: null, duration: null, thumb: null };
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("muted", "");
    video.setAttribute("playsinline", "");
    video.setAttribute("aria-hidden", "true");
    video.preload = "metadata";
    video.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none;z-index:-1";
    document.body.append(video);
    try {
      const metadata = waitFor(video, "loadedmetadata", 10000);
      video.src = url;
      await metadata;
      if (video.videoWidth && video.videoHeight) {
        result.width = video.videoWidth;
        result.height = video.videoHeight;
      }
      if (Number.isFinite(video.duration) && video.duration > 0) result.duration = Math.round(video.duration * 10) / 10;
      result.thumb = await grabFrame(video).catch(() => null);
    } catch { /* Upload it without the extras. */ }
    finally {
      video.removeAttribute("src");
      try { video.load(); } catch { /* Already gone. */ }
      video.remove();
      URL.revokeObjectURL(url);
    }
    return result;
  }

  /* ------------------------------- Uploading ------------------------------ */
  function friendlyError(error, kind) {
    if (error?.status === 413) {
      return new Error(kind === "video" ? "That video is too big. Try one under about a minute." : "That photo is too big. Try another one.");
    }
    if (error?.status === 404 && /^not found\.?$/i.test(error.message || "")) {
      return new Error("Photos and videos need the latest server update first.");
    }
    if (error && !error.status && (error instanceof TypeError || !error.message)) return new Error(OFFLINE);
    return error instanceof Error ? error : new Error("The upload didn’t go through. Please try again.");
  }

  // Raw PUT with upload progress (fetch can't report it).
  function putBinary(path, body, type, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", app().apiUrl(path));
      xhr.setRequestHeader("Content-Type", type);
      if (onProgress) {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable && event.total) onProgress(event.loaded / event.total);
        };
      }
      xhr.onload = () => {
        let data = {};
        try { data = JSON.parse(xhr.responseText || "{}"); } catch { /* Not JSON. */ }
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(data);
          return;
        }
        const error = new Error(data.error || "The upload didn’t go through. Please try again.");
        error.status = xhr.status;
        error.data = data;
        reject(error);
      };
      xhr.onerror = () => reject(new Error("The upload didn’t go through. Check your connection and try again."));
      xhr.onabort = xhr.onerror;
      xhr.send(body);
    });
  }

  function remove(id) {
    const who = app().me();
    return app().apiRequest(`/media?id=${encodeURIComponent(id)}&author=${encodeURIComponent(who)}`, "DELETE");
  }

  async function upload(file, { key, scope = "journal", onProgress } = {}) {
    const report = (fraction) => {
      try { onProgress?.(Math.min(1, Math.max(0, fraction))); } catch { /* A progress display never breaks an upload. */ }
    };
    if (!file) throw new Error("Pick a photo or video first.");
    const kind = kindOf(file);
    if (!kind) throw new Error("That file isn’t a photo or a video.");
    if (kind === "video") {
      if (file.size > VIDEO_LIMIT) throw new Error("That video is too big. Try one under about a minute.");
      if (!videoMime(file)) throw new Error("That kind of video can’t be added. Try an MP4 or MOV.");
      if (!file.size) throw new Error("That video is empty.");
    }
    const prepared = kind === "photo" ? await preparePhoto(file) : await prepareVideo(file);

    const details = { key, scope, kind, mime: prepared.mime, size: prepared.body.size, author: app().me() };
    ["width", "height", "duration"].forEach((field) => {
      if (Number.isFinite(prepared[field]) && prepared[field] > 0) details[field] = prepared[field];
    });
    let media;
    try {
      media = (await app().apiRequest("/media", "POST", details)).media;
    } catch (error) {
      throw friendlyError(error, kind);
    }
    if (!media?.id) throw new Error("The upload didn’t go through. Please try again.");
    const id = encodeURIComponent(media.id);

    try {
      if (prepared.thumb) {
        try { media = (await putBinary(`/media/thumb?id=${id}`, prepared.thumb, "image/jpeg")).media || media; }
        catch { /* No thumbnail: the tile shows a soft gradient instead. */ }
      }
      report(0);
      const data = await putBinary(`/media/file?id=${id}`, prepared.body, prepared.mime, report);
      report(1);
      return data.media || { ...media, status: "ready" };
    } catch (error) {
      // Don't leave a half-uploaded item behind.
      remove(media.id).catch(() => {});
      throw friendlyError(error, kind);
    }
  }

  /* --------------------------------- Tiles -------------------------------- */
  function tileHtml(item) {
    const video = item.kind === "video";
    const duration = video ? formatDuration(Number(item.duration)) : "";
    const who = nameOf(item.author);
    const label = `${video ? "Video" : "Photo"}${who ? ` from ${who}` : ""}${duration ? `, ${duration}` : ""}`;
    let thumb = item.thumbSrc || "";
    if (!thumb && item.id && !item.legacy && item.hasThumb) thumb = thumbUrl(item.id);
    if (!thumb && !video) thumb = item.src || (item.id && !item.legacy ? fileUrl(item.id) : "");
    const art = thumb
      ? `<img src="${escapeHtml(thumb)}" alt="" loading="lazy" decoding="async">`
      : `<span class="media-tile-art" aria-hidden="true">${icon(video ? "film" : "image")}</span>`;
    const badge = video ? `<span class="media-tile-badge" aria-hidden="true">${icon("play")}${duration ? `<span>${duration}</span>` : ""}</span>` : "";
    return `<button class="media-tile${video ? " is-video" : ""}" type="button" data-media-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(label)}">${art}${badge}</button>`;
  }

  // A tile whose thumbnail can't load falls back to the gradient.
  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement) || !img.parentElement?.classList.contains("media-tile")) return;
    const art = document.createElement("span");
    art.className = "media-tile-art";
    art.setAttribute("aria-hidden", "true");
    art.innerHTML = icon(img.parentElement.classList.contains("is-video") ? "film" : "image-off");
    img.replaceWith(art);
  }, true);

  /* -------------------------------- Viewer -------------------------------- */
  let viewer = null;
  const current = { items: [], index: 0, options: {}, opener: null, startId: "" };

  function buildViewer() {
    const root = document.createElement("div");
    root.className = "media-viewer";
    root.hidden = true;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Photos and videos");
    root.innerHTML = `
      <div class="media-viewer-top">
        <span class="media-viewer-count" aria-live="polite"></span>
        <button class="media-viewer-button media-viewer-close" type="button" aria-label="Close">${icon("x")}</button>
      </div>
      <div class="media-viewer-stage"></div>
      <button class="media-viewer-button media-viewer-prev" type="button" aria-label="Previous">${icon("chevron-left")}</button>
      <button class="media-viewer-button media-viewer-next" type="button" aria-label="Next">${icon("chevron-right")}</button>
      <p class="media-viewer-error" role="alert" hidden></p>
      <div class="media-viewer-bar">
        <p class="media-viewer-caption"><span></span><small></small></p>
        <button class="media-viewer-delete" type="button">${icon("trash-2")}<span>Delete</span></button>
      </div>`;
    document.body.append(root);
    const parts = {
      root,
      count: root.querySelector(".media-viewer-count"),
      stage: root.querySelector(".media-viewer-stage"),
      close: root.querySelector(".media-viewer-close"),
      prev: root.querySelector(".media-viewer-prev"),
      next: root.querySelector(".media-viewer-next"),
      error: root.querySelector(".media-viewer-error"),
      who: root.querySelector(".media-viewer-caption span"),
      when: root.querySelector(".media-viewer-caption small"),
      remove: root.querySelector(".media-viewer-delete")
    };
    parts.close.addEventListener("click", close);
    parts.prev.addEventListener("click", () => go(-1));
    parts.next.addEventListener("click", () => go(1));
    parts.remove.addEventListener("click", deleteCurrent);
    root.addEventListener("keydown", onKeydown);

    // Swipe left/right to move, down to close. Not on a video's control bar.
    let touch = null;
    parts.stage.addEventListener("touchstart", (event) => {
      if (event.touches.length !== 1) { touch = null; return; }
      const point = event.touches[0];
      const video = event.target instanceof HTMLVideoElement ? event.target.getBoundingClientRect() : null;
      touch = video && point.clientY > video.bottom - Math.max(64, video.height * 0.25) ? null : { x: point.clientX, y: point.clientY };
    }, { passive: true });
    parts.stage.addEventListener("touchend", (event) => {
      if (!touch) return;
      const point = event.changedTouches[0];
      const dx = point.clientX - touch.x;
      const dy = point.clientY - touch.y;
      touch = null;
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) go(dx < 0 ? 1 : -1);
      else if (dy > 90 && dy > Math.abs(dx) * 1.4) close();
    }, { passive: true });
    // Keep the page underneath from scrolling while the viewer is open.
    root.addEventListener("touchmove", (event) => {
      if (event.touches.length === 1 && !(event.target instanceof HTMLVideoElement)) event.preventDefault();
    }, { passive: false });
    return parts;
  }

  function focusables() {
    return [...viewer.root.querySelectorAll("button, video[controls]")]
      .filter((element) => !element.hidden && !element.disabled && element.getClientRects().length);
  }

  function onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !(event.target instanceof HTMLVideoElement)) {
      event.preventDefault();
      go(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Tab") {
      const list = focusables();
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && (document.activeElement === first || !viewer.root.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !viewer.root.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  function stopPlayback() {
    viewer.stage.querySelectorAll("video").forEach((video) => {
      video.pause();
      video.removeAttribute("src");
      try { video.load(); } catch { /* Already gone. */ }
    });
  }

  function canDelete(item) {
    return current.options.canDelete !== false && !item.legacy && Boolean(item.id) && item.author === app()?.me();
  }

  function shortDate(iso) {
    const date = new Date(iso);
    if (!iso || Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Zurich" }).format(date);
  }

  function showError(message) {
    viewer.error.textContent = message;
    viewer.error.hidden = !message;
  }

  function show(index) {
    const items = current.items;
    current.index = Math.min(Math.max(0, index), items.length - 1);
    const item = items[current.index];
    const video = item.kind === "video";
    stopPlayback();
    showError("");
    viewer.stage.innerHTML = "";
    viewer.stage.classList.add("is-loading");
    const done = () => viewer.stage.classList.remove("is-loading");
    const failed = () => {
      done();
      showError(`This ${video ? "video" : "photo"} couldn’t be loaded right now.`);
    };
    let element;
    if (video) {
      element = document.createElement("video");
      element.controls = true;
      element.playsInline = true;
      element.setAttribute("playsinline", "");
      element.preload = "metadata";
      if (item.thumbSrc) element.poster = item.thumbSrc;
      else if (item.hasThumb && !item.legacy) element.poster = thumbUrl(item.id);
      element.addEventListener("loadedmetadata", done, { once: true });
      element.addEventListener("error", failed, { once: true });
      element.src = item.src || fileUrl(item.id);
      element.setAttribute("aria-label", `Video from ${nameOf(item.author) || "one of us"}`);
    } else {
      element = document.createElement("img");
      element.alt = `Photo from ${nameOf(item.author) || "one of us"}`;
      element.decoding = "async";
      element.addEventListener("load", done, { once: true });
      element.addEventListener("error", failed, { once: true });
      element.src = item.src || fileUrl(item.id);
    }
    element.className = "media-viewer-media";
    viewer.stage.append(element);

    const who = nameOf(item.author);
    viewer.who.textContent = `${video ? "Video" : "Photo"}${who ? ` from ${who}` : ""}`;
    viewer.when.textContent = shortDate(item.at);
    viewer.when.hidden = !viewer.when.textContent;
    viewer.count.textContent = items.length > 1 ? `${current.index + 1} / ${items.length}` : "";
    viewer.prev.hidden = current.index === 0;
    viewer.next.hidden = current.index === items.length - 1;
    viewer.remove.hidden = !canDelete(item);
    viewer.remove.querySelector("span").textContent = `Delete ${video ? "video" : "photo"}`;
    if (!viewer.root.contains(document.activeElement) || document.activeElement.hidden) viewer.close.focus({ preventScroll: true });

    // Warm up the neighbors so swiping feels instant.
    [items[current.index - 1], items[current.index + 1]].forEach((neighbor) => {
      if (neighbor && neighbor.kind !== "video") new Image().src = neighbor.src || fileUrl(neighbor.id);
    });
  }

  function go(step) {
    if (!viewer || viewer.root.hidden) return;
    const index = current.index + step;
    if (index < 0 || index >= current.items.length) return;
    show(index);
  }

  function view(items, startIndex = 0, options = {}) {
    const list = (Array.isArray(items) ? items : []).filter((item) => item && (item.id || item.src));
    if (!list.length) return;
    viewer = viewer || buildViewer();
    const wasOpen = !viewer.root.hidden;
    current.items = list;
    current.options = options || {};
    if (!wasOpen) current.opener = document.activeElement;
    current.startId = list[Math.min(Math.max(0, startIndex), list.length - 1)]?.id || "";
    viewer.root.hidden = false;
    document.documentElement.classList.add("media-viewer-open");
    show(startIndex);
    viewer.close.focus({ preventScroll: true });
  }

  function close() {
    if (!viewer || viewer.root.hidden) return;
    stopPlayback();
    viewer.stage.innerHTML = "";
    viewer.root.hidden = true;
    document.documentElement.classList.remove("media-viewer-open");
    let target = current.opener;
    if (!target?.isConnected && current.startId) {
      target = [...document.querySelectorAll(".media-tile[data-media-id]")].find((tile) => tile.dataset.mediaId === current.startId);
    }
    if (target?.isConnected) target.focus({ preventScroll: true });
    current.opener = null;
  }

  async function deleteCurrent() {
    const item = current.items[current.index];
    if (!item || !canDelete(item)) return;
    const what = item.kind === "video" ? "video" : "photo";
    if (!window.confirm(`Delete this ${what}? It disappears for both of you.`)) return;
    viewer.remove.disabled = true;
    showError("");
    try {
      await remove(item.id).catch((error) => {
        if (error.status !== 404) throw error; // Already gone counts as deleted.
      });
      current.items = current.items.filter((entry) => entry !== item);
      try { current.options.onDelete?.(item); } catch { /* The caller refreshes on its own. */ }
      if (current.items.length) show(Math.min(current.index, current.items.length - 1));
      else close();
    } catch (error) {
      showError(error.status === 403 ? `Only the person who added this ${what} can delete it.` : error.message || `Couldn’t delete this ${what}. Please try again.`);
    } finally {
      viewer.remove.disabled = false;
    }
  }

  window.DateMedia = { fileUrl, thumbUrl, upload, remove, view, close, tileHtml, formatDuration };
})();
