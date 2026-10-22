/*
 * Activity bell: what the other one of us did on the letter (rated our date,
 * posted an outfit, spun the movie wheel…), with a badge, an "Activity" panel,
 * small toasts while the page is open and phone notifications (web push, shown
 * by sw.js). Other scripts report through window.DateActivity.post(); the feed
 * and the push subscriptions live in the Worker (/activity, /push/*).
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const params = new URLSearchParams(window.location.search);
  const preview = params.has("preview");
  // Preview has its own activity feed, but the browser's push subscription is
  // shared with the live letter. Never touch that subscription from preview.
  const SEEN_KEY = preview ? "date-letter-activity-seen-preview" : "date-letter-activity-seen";
  const PUSH_KEY = "date-letter-push";
  const POLL_MS = 15000;
  const MAX_BACKOFF_MS = 4 * 60 * 1000;
  const TOAST_MS = 6500;
  const SHOWN = 50;
  const KEPT = 100;
  // Pages an activity can open (the ones the "goto" buttons can reach).
  const STEPS = ["planned", "coupons", "game", "journal", "outfits", "snacks", "movies", "ideas", "question", "games", "match", "wordle", "doodle", "icons", "challenges", "shop", "duel", "speed", "price", "odd", "hunt"];
  const KIND = /^[a-z.]{1,40}$/;
  const ICON = /^[a-z0-9-]{1,40}$/;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let items = [];       // newest first, deduped by id
  let cursor = "";      // newest `at` the server has sent; the next poll asks for anything after it
  let loaded = false;
  let loadError = null;
  let polling = null;
  let pollAgain = false;
  let failures = 0;
  let nextPollAt = 0;
  let pollTimer = null;
  let panelOpen = false;
  let unreadBefore = 0; // the "seen" time when the panel opened, so new items keep their dot
  let returnFocus = null;
  let listSignature = "";
  let toastItems = [];
  let toastTimer = null;
  let pendingStep = STEPS.includes(params.get("step")) ? params.get("step") : "";

  /* -------------------------------- Markup ------------------------------- */
  const root = $("#activity-root");
  const bell = $("#activity-bell");
  const badge = $("#activity-badge");
  const layer = $("#activity-layer");
  const panel = $("#activity-panel");
  const listEl = $("#activity-list");
  const emptyEl = $("#activity-empty");
  const toastEl = $("#activity-toast");
  const toastBody = $("#activity-toast-body");
  const toastClose = $("#activity-toast-close");
  const pushEl = $("#activity-push");
  const pushText = $("#activity-push-text");
  const pushButton = $("#activity-push-button");
  const hasUi = Boolean(root && bell && badge && layer && panel && listEl && emptyEl && toastEl && toastBody && toastClose && pushEl && pushText && pushButton);

  /* ------------------------------- Helpers ------------------------------- */
  // DateApp is defined last (app.js), so everything waits for it.
  let readyPromise = null;
  function ready() {
    if (window.DateApp) return Promise.resolve(window.DateApp);
    if (!readyPromise) {
      readyPromise = new Promise((resolve, reject) => {
        let tries = 0;
        const timer = window.setInterval(() => {
          tries += 1;
          if (window.DateApp) {
            window.clearInterval(timer);
            resolve(window.DateApp);
          } else if (tries > 600) {
            window.clearInterval(timer);
            reject(new Error("The letter didn't start."));
          }
        }, 50);
      });
    }
    return readyPromise;
  }

  const app = () => window.DateApp;
  const time = (iso) => Date.parse(iso) || 0;
  const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));

  function stored(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function save(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch { /* Private browsing. */ }
  }

  // One line, at most `max` UTF-16 units (the Worker's limit), never cutting an emoji in half.
  function clip(value, max) {
    const text = String(value ?? "").replace(/\s+/g, " ").trim();
    if (text.length <= max) return text;
    let out = "";
    for (const character of text) {
      if (out.length + character.length > max - 1) break;
      out += character;
    }
    return `${out.trimEnd()}…`;
  }

  function nameOf(item) {
    return app()?.names?.[item.author] || item.name || "";
  }

  function iconName(name) {
    if (!ICON.test(name || "")) return "bell";
    const icons = window.lucide?.icons;
    if (!icons) return name;
    const key = name.replace(/(^|-)([a-z0-9])/g, (_, __, letter) => letter.toUpperCase());
    return icons[key] ? name : "bell";
  }

  function refreshIcons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  function ago(iso) {
    const seconds = Math.max(0, (Date.now() - time(iso)) / 1000);
    if (seconds < 45) return "just now";
    const minutes = Math.max(1, Math.floor(seconds / 60));
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    const date = new Date(time(iso));
    const sameYear = date.getFullYear() === new Date().getFullYear();
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }), timeZone: "Europe/Zurich" }).format(date);
  }

  function canOpen(step) {
    return STEPS.includes(step) && Boolean(app()?.plan) && Boolean(document.querySelector(`[data-step="${step}"]`));
  }

  // Shows a page from a tapped item, toast, notification or ?step=, once the plan is there.
  function goTo(step) {
    if (!STEPS.includes(step)) return;
    if (!app()?.plan) {
      pendingStep = step;
      return;
    }
    pendingStep = "";
    if (canOpen(step)) app().showStep(step);
  }

  /* -------------------------------- Feed --------------------------------- */
  function seenAt() {
    return time(stored(SEEN_KEY));
  }

  function isMine(item) {
    return item.author === app()?.me();
  }

  function unread() {
    const seen = seenAt();
    return items.filter((item) => !isMine(item) && time(item.at) > seen);
  }

  // Remembers the newest item on the server's clock, so a phone whose clock is off still counts right.
  function markSeen(upTo = items[0]?.at) {
    if (!upTo || time(upTo) <= seenAt()) return;
    save(SEEN_KEY, new Date(time(upTo)).toISOString());
  }

  function valid(item) {
    return item && typeof item.id === "string" && typeof item.text === "string" && time(item.at) > 0;
  }

  // Adds items (deduped by id) and returns the ones that weren't there before.
  function merge(list) {
    const known = new Set(items.map((item) => item.id));
    const fresh = (Array.isArray(list) ? list : []).filter((item) => valid(item) && !known.has(item.id));
    if (!fresh.length) return [];
    items = [...fresh, ...items]
      .filter((item, index, all) => all.findIndex((other) => other.id === item.id) === index)
      .sort((a, b) => time(b.at) - time(a.at))
      .slice(0, KEPT);
    return fresh;
  }

  async function poll({ force = false } = {}) {
    if (polling) {
      // Asked for right now (a push just came in) while a request is out: ask once more after it,
      // since that one may have left before the new item was saved.
      if (force) pollAgain = true;
      return polling;
    }
    if (!force && Date.now() < nextPollAt) return null;
    polling = (async () => {
      try {
        const api = await ready();
        // A millisecond of overlap, so two items saved in the same instant can't slip through.
        const since = cursor ? `?since=${encodeURIComponent(new Date(time(cursor) - 1).toISOString())}` : "";
        const data = await api.apiRequest(`/activity${since}`);
        const list = (Array.isArray(data.activity) ? data.activity : []).filter(valid);
        list.forEach((item) => { if (time(item.at) > time(cursor)) cursor = item.at; });
        const fresh = merge(list);
        const first = !loaded;
        loaded = true;
        loadError = null;
        failures = 0;
        nextPollAt = 0;
        if (panelOpen) markSeen();
        else if (!first) {
          const seen = seenAt();
          const theirs = fresh.filter((item) => !isMine(item) && time(item.at) > seen);
          if (theirs.length) showToast(theirs);
        }
        render();
        if (fresh.some((item) => !isMine(item))) bumpBadge();
      } catch (error) {
        loadError = error;
        failures += 1;
        // An old Worker (404) or no connection: ask less often until it answers again.
        nextPollAt = Date.now() + Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** failures);
        render();
      } finally {
        polling = null;
        if (pollAgain) {
          pollAgain = false;
          poll({ force: true });
        }
      }
    })();
    return polling;
  }

  function startPolling() {
    window.clearInterval(pollTimer);
    pollTimer = window.setInterval(() => {
      if (!document.hidden) poll();
    }, POLL_MS);
  }

  /* ----------------------------- Public API ------------------------------ */
  // Records something this phone's person did, for the other one's bell (and phone, when push is on).
  // Never throws: activity is a nice-to-have, the action itself already happened.
  async function post({ kind, text, detail = "", step = "", icon = "", push = true } = {}) {
    try {
      const api = await ready();
      const author = api.me();
      const body = {
        author,
        name: clip(api.names?.[author] || (author === "her" ? "Her" : "Your date"), 60),
        kind: KIND.test(kind || "") ? kind : "activity",
        text: clip(text, 140),
        detail: clip(detail, 200),
        step: STEPS.includes(step) ? step : "",
        push: !preview && push !== false
      };
      if (ICON.test(icon || "")) body.icon = icon;
      if (!body.text) return null;
      const data = await api.apiRequest("/activity", "POST", body);
      if (!valid(data?.item)) return null;
      merge([data.item]);
      render();
      return data.item;
    } catch {
      return null;
    }
  }

  window.DateActivity = {
    post,
    refresh: () => poll({ force: true }),
    open: () => { if (hasUi) openPanel(); },
    close: () => { if (hasUi) closePanel(); }
  };

  // Without the bell's markup the feed still records (post), it just shows nothing.
  if (!hasUi) return;
  root.hidden = false;

  /* -------------------------------- Render ------------------------------- */
  function bellVisible() {
    const step = app()?.step;
    return !document.body.classList.contains("is-envelope-landing") && step !== "loading" && step !== "intro";
  }

  function renderBell() {
    const count = loaded ? unread().length : 0;
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.hidden = !count;
    bell.classList.toggle("has-unread", count > 0);
    bell.setAttribute("aria-label", count ? `Activity, ${count} new` : "Activity");
    bell.setAttribute("aria-expanded", String(panelOpen));
  }

  function bumpBadge() {
    if (!hasUi || badge.hidden || reduced()) return;
    [[badge, "is-bumped"], [bell, "is-ringing"]].forEach(([element, name]) => {
      element.classList.remove(name);
      void element.offsetWidth;
      element.classList.add(name);
    });
  }

  function itemHtml(item) {
    const mine = isMine(item);
    const isNew = !mine && time(item.at) > unreadBefore;
    const open = canOpen(item.step);
    const tag = open ? "button" : "div";
    const attributes = open ? ` type="button" data-activity-step="${escape(item.step)}" data-activity-id="${escape(item.id)}"` : "";
    return `<li>
      <${tag} class="activity-item${mine ? " is-mine" : ""}${isNew ? " is-new" : ""}${open ? " is-link" : ""}"${attributes}>
        <span class="activity-item-icon" aria-hidden="true"><i class="icon" data-lucide="${escape(iconName(item.icon))}"></i></span>
        <span class="activity-item-copy">
          <span class="activity-item-text"><strong>${escape(nameOf(item))}</strong> ${escape(item.text)}</span>
          ${item.detail ? `<span class="activity-item-detail">${escape(item.detail)}</span>` : ""}
          <time class="activity-item-time" datetime="${escape(item.at)}">${escape(ago(item.at))}${isNew ? '<span class="visually-hidden">, new</span>' : ""}</time>
        </span>
        ${isNew ? '<span class="activity-item-dot" aria-hidden="true"></span>' : ""}
        ${open ? '<i class="icon activity-item-arrow" data-lucide="chevron-right" aria-hidden="true"></i>' : ""}
      </${tag}>
    </li>`;
  }

  function renderList() {
    const shown = items.slice(0, SHOWN);
    let empty = "";
    if (!shown.length) {
      if (!loaded && !loadError) empty = '<p class="activity-empty-title">Loading…</p>';
      else if (!loaded) {
        empty = `<span class="activity-empty-icon" aria-hidden="true"><i class="icon" data-lucide="wifi-off"></i></span>
          <p class="activity-empty-title">Couldn’t load what’s new</p>
          <p>${loadError?.status === 404 ? "The activity feed needs the latest server update first." : "Check your connection and try again."}</p>`;
      } else {
        empty = `<span class="activity-empty-icon" aria-hidden="true"><i class="icon" data-lucide="bell"></i></span>
          <p class="activity-empty-title">Nothing new yet</p>
          <p>When one of us rates a date, posts an outfit or spins the movie wheel, it shows up here.</p>`;
      }
    }
    const html = shown.map(itemHtml).join("");
    const signature = `${html}|${empty}`;
    if (signature === listSignature) return;
    listSignature = signature;
    const focusedId = listEl.contains(document.activeElement) ? document.activeElement.dataset.activityId : null;
    listEl.innerHTML = html;
    listEl.hidden = !shown.length;
    emptyEl.innerHTML = empty;
    emptyEl.hidden = Boolean(shown.length);
    refreshIcons(panel);
    if (focusedId) listEl.querySelector(`[data-activity-id="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }

  function render() {
    if (!hasUi) return;
    renderBell();
    if (panelOpen) renderList();
  }

  /* -------------------------------- Panel -------------------------------- */
  function focusable() {
    return [...panel.querySelectorAll("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])")]
      .filter((element) => !element.closest("[hidden]") && element.getClientRects().length);
  }

  function openPanel() {
    if (panelOpen) return;
    panelOpen = true;
    unreadBefore = seenAt();
    returnFocus = document.activeElement;
    listSignature = "";
    layer.hidden = false;
    document.documentElement.classList.add("activity-open");
    hideToast();
    markSeen();
    renderList();
    renderBell();
    renderPush();
    listEl.scrollTop = 0;
    window.requestAnimationFrame(() => layer.classList.add("is-open"));
    panel.focus({ preventScroll: true });
    poll({ force: true });
    syncPush();
    if (support() === "ok" && permission() !== "denied") pushKey().catch(() => { /* Asked again on "Turn on". */ });
  }

  function closePanel({ restoreFocus = true } = {}) {
    if (!panelOpen) return;
    panelOpen = false;
    layer.classList.remove("is-open");
    layer.hidden = true;
    document.documentElement.classList.remove("activity-open");
    // "A test notification is on its way" is news once; next time it just says it's on.
    if (!pushState.busy) pushState = { ...pushState, note: "", error: "" };
    markSeen();
    renderBell();
    if (restoreFocus) (returnFocus?.isConnected && returnFocus !== document.body ? returnFocus : bell).focus({ preventScroll: true });
    returnFocus = null;
  }

  bell.addEventListener("click", () => (panelOpen ? closePanel() : openPanel()));
  layer.addEventListener("click", (event) => {
    if (event.target.closest("[data-activity-close]")) {
      closePanel();
      return;
    }
    const item = event.target.closest("[data-activity-step]");
    if (!item) return;
    closePanel({ restoreFocus: false });
    goTo(item.dataset.activityStep);
  });
  document.addEventListener("keydown", (event) => {
    if (!panelOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closePanel();
      return;
    }
    if (event.key !== "Tab") return;
    // Keep Tab inside the panel while it's open.
    const elements = focusable();
    if (!elements.length) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = elements[0];
    const last = elements[elements.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    } else if (!panel.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    }
  });

  /* -------------------------------- Toast -------------------------------- */
  function showToast(fresh) {
    if (!hasUi || !bellVisible() || panelOpen) return;
    const ids = new Set(fresh.map((item) => item.id));
    toastItems = [...fresh, ...toastItems.filter((item) => !ids.has(item.id))]
      .sort((a, b) => time(b.at) - time(a.at))
      .slice(0, 20);
    const [item] = toastItems;
    const more = toastItems.length - 1;
    const note = more ? `and ${more} more` : item.detail;
    toastBody.innerHTML = `<span class="activity-toast-icon" aria-hidden="true"><i class="icon" data-lucide="${escape(iconName(item.icon))}"></i></span>
      <span class="activity-toast-copy">
        <span class="activity-toast-text"><strong>${escape(nameOf(item))}</strong> ${escape(item.text)}</span>
        ${note ? `<small>${escape(note)}</small>` : ""}
      </span>`;
    toastBody.setAttribute("aria-label", `${nameOf(item)} ${item.text}${note ? `, ${note}` : ""}. ${more ? "Open the activity" : canOpen(item.step) ? "Open it" : "Dismiss"}`);
    refreshIcons(toastBody);
    toastEl.hidden = false;
    // Next frame, so the slide-in plays even when it was hidden a moment ago.
    window.requestAnimationFrame(() => toastEl.classList.add("is-visible"));
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(hideToast, TOAST_MS);
  }

  function hideToast() {
    window.clearTimeout(toastTimer);
    toastItems = [];
    toastEl.classList.remove("is-visible");
    toastTimer = window.setTimeout(() => {
      if (!toastEl.classList.contains("is-visible")) toastEl.hidden = true;
    }, reduced() ? 0 : 320);
  }

  toastBody.addEventListener("click", () => {
    const [item] = toastItems;
    if (!item) {
      hideToast();
      return;
    }
    // Several at once: the panel lists them all. One: straight to its page.
    if (toastItems.length > 1) {
      hideToast();
      openPanel();
      return;
    }
    markSeen(item.at);
    hideToast();
    renderBell();
    goTo(item.step);
  });
  toastClose.addEventListener("click", hideToast);

  /* ------------------------- Phone notifications ------------------------- */
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  // iOS 16.4 brought web push (Home Screen apps only). Newer Safaris freeze the "OS" number in
  // their user agent, so the Safari version counts too; iPads asking for the desktop site say neither.
  const iosVersions = [/OS (\d+)_(\d+)/, /Version\/(\d+)\.(\d+)/]
    .map((pattern) => navigator.userAgent.match(pattern))
    .filter(Boolean)
    .map((match) => Number(match[1]) + Number(match[2]) / 100);
  const iosTooOld = isIOS && iosVersions.length > 0 && iosVersions.every((version) => version < 16.04);
  const standalone = () => window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.isSecureContext;
  let pushState = { subscribed: false, busy: "", error: "", note: "" };
  let syncing = null;
  let pushSyncAgain = false;
  let keyRequest = null;

  function support() {
    if (preview) return "preview";
    if (iosTooOld) return "none";
    // iPhones only get web push in the Home Screen app, not in Safari itself.
    if (isIOS && !standalone()) return "howto";
    return pushSupported() ? "ok" : "none";
  }

  function record() {
    try { return JSON.parse(stored(PUSH_KEY) || "null"); } catch { return null; }
  }

  function permission() {
    try { return window.Notification.permission; } catch { return "default"; }
  }

  function otherName() {
    const api = app();
    if (!api) return "the other one";
    return api.names[api.me() === "her" ? "sender" : "her"] || "the other one";
  }

  function renderPush() {
    const mode = support();
    pushEl.hidden = mode === "none";
    if (mode === "none") return;
    pushEl.classList.toggle("is-on", mode === "ok" && pushState.subscribed);
    if (mode === "preview") {
      pushText.textContent = "The activity bell works in preview. Phone notifications are only available in the live letter.";
      pushButton.hidden = true;
      pushButton.disabled = true;
      return;
    }
    if (mode === "howto") {
      pushText.textContent = "Add this letter to your Home Screen (Share, then Add to Home Screen), open it from there and turn notifications on here.";
      pushButton.hidden = true;
      return;
    }
    const state = permission();
    pushButton.hidden = false;
    pushButton.disabled = Boolean(pushState.busy);
    if (pushState.busy) {
      pushButton.textContent = pushState.busy === "sync" ? "Updating…" : pushState.busy === "on" ? "Turning on…" : "Turning off…";
    } else if (pushState.subscribed) {
      pushButton.textContent = "Turn off";
    } else {
      pushButton.textContent = "Turn on";
    }
    if (state === "denied" && !pushState.subscribed) {
      pushButton.hidden = true;
      pushText.textContent = isIOS
        ? "Notifications are blocked for this letter. To allow them, open Settings, then Notifications, then Our date, and turn on Allow Notifications."
        : "Notifications are blocked for this site. Allow them in your browser’s site settings, then come back here.";
      return;
    }
    if (pushState.error) pushText.textContent = pushState.error;
    else if (pushState.subscribed) pushText.textContent = pushState.note || `On for ${app()?.names?.[app()?.me()] || "you"} on this phone`;
    else pushText.textContent = `Get a notification on this phone when ${otherName()} does something here.`;
  }

  function setPush(changes) {
    pushState = { ...pushState, ...changes };
    renderPush();
  }

  function withTimeout(promise, ms, message) {
    let timer = null;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = window.setTimeout(() => reject(new Error(message)), ms); })
    ]).finally(() => window.clearTimeout(timer));
  }

  async function registration() {
    if (preview) throw new Error("Phone notifications are only available in the live letter.");
    const container = navigator.serviceWorker;
    try {
      if (!(await container.getRegistration())) await container.register("sw.js");
    } catch { /* `ready` below says whether it worked. */ }
    return withTimeout(container.ready, 10000, "The letter's background helper isn't ready.");
  }

  function keyBytes(base64url) {
    const base64 = `${base64url}${"=".repeat((4 - (base64url.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
    return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
  }

  function sameKey(subscription, bytes) {
    const current = subscription?.options?.applicationServerKey;
    if (!current) return true;
    const view = new Uint8Array(current);
    return view.length === bytes.length && view.every((value, index) => value === bytes[index]);
  }

  function subscriptionBody(subscription) {
    const json = subscription.toJSON();
    return { endpoint: json.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } };
  }

  // The Worker's push key, asked for once (and again after a failure). Fetched when the panel
  // opens, so "Turn on" gets to subscribing quickly, while Safari still counts it as the tap's doing.
  function pushKey() {
    if (preview) return Promise.reject(new Error("Phone notifications are only available in the live letter."));
    if (!keyRequest) {
      keyRequest = ready()
        .then((api) => api.apiRequest("/push/key"))
        .then(({ publicKey } = {}) => {
          if (typeof publicKey !== "string" || !/^[A-Za-z0-9_-]{40,200}$/.test(publicKey)) throw new Error("No push key.");
          return publicKey;
        });
      keyRequest.catch(() => { keyRequest = null; });
    }
    return keyRequest;
  }

  // Subscribes (or reuses this phone's subscription) and tells the Worker who it belongs to.
  async function subscribe(reg) {
    if (preview) throw new Error("Phone notifications are only available in the live letter.");
    const api = await ready();
    const bytes = keyBytes(await pushKey());
    let subscription = await reg.pushManager.getSubscription();
    // A subscription made for an older key can't receive from the new one.
    if (subscription && !sameKey(subscription, bytes)) {
      await subscription.unsubscribe().catch(() => {});
      subscription = null;
    }
    if (!subscription) subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
    const previous = record();
    const author = api.me();
    await api.apiRequest("/push/subscribe", "POST", { author, subscription: subscriptionBody(subscription) });
    if (previous?.endpoint && previous.endpoint !== subscription.endpoint) {
      api.apiRequest("/push/unsubscribe", "POST", { endpoint: previous.endpoint }).catch(() => {});
    }
    save(PUSH_KEY, JSON.stringify({ endpoint: subscription.endpoint, author, at: Date.now() }));
    if (author !== api.me()) pushSyncAgain = true;
    return subscription;
  }

  function askPermission() {
    // Older Safari answers through a callback instead of a promise.
    return new Promise((resolve) => {
      try {
        const result = window.Notification.requestPermission(resolve);
        if (result?.then) result.then(resolve, () => resolve(permission()));
      } catch {
        resolve(permission());
      }
    });
  }

  async function turnOn() {
    if (preview || pushState.busy) return;
    // Asked right away, inside the tap: Safari only shows the question for a tap.
    const asking = permission() === "granted" ? Promise.resolve("granted") : askPermission();
    setPush({ busy: "on", error: "", note: "" });
    try {
      const answer = await asking;
      if (answer !== "granted") {
        setPush({ busy: "", error: answer === "denied" ? "" : "Notifications weren’t allowed. Tap Turn on to try again." });
        return;
      }
      const reg = await registration();
      await subscribe(reg);
      setPush({ busy: "", subscribed: true, note: "On on this phone. A test notification is on its way." });
      const api = await ready();
      api.apiRequest("/push/test", "POST", { author: api.me() }).catch(() => {});
    } catch {
      setPush({ busy: "", error: "Couldn’t turn on notifications. Check your connection and try again." });
    } finally {
      continuePushSync();
    }
  }

  async function turnOff() {
    if (preview || pushState.busy) return;
    setPush({ busy: "off", error: "", note: "" });
    let endpoint = record()?.endpoint || "";
    try {
      const reg = await registration();
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        endpoint = subscription.endpoint;
        await subscription.unsubscribe();
      }
    } catch {
      setPush({ busy: "", error: "Couldn’t turn notifications off. Please try again." });
      continuePushSync();
      return;
    }
    // Remembered, so the next visit doesn't switch it back on by itself.
    save(PUSH_KEY, JSON.stringify({ off: true }));
    setPush({ busy: "", subscribed: false });
    if (endpoint) ready().then((api) => api.apiRequest("/push/unsubscribe", "POST", { endpoint })).catch(() => { /* A dead endpoint is dropped on the next send anyway. */ });
    continuePushSync();
  }

  pushButton.addEventListener("click", () => (pushState.subscribed ? turnOff() : turnOn()));

  // On load (and when the panel opens), with permission granted: notifications turned on here
  // whose subscription went missing, or that belongs to the other person (?me switched who this
  // phone is), subscribe again quietly. Once a day the Worker hears about it again anyway, in
  // case it dropped the subscription. Turned off here stays off.
  function continuePushSync() {
    if (!pushSyncAgain || syncing || pushState.busy) return;
    pushSyncAgain = false;
    syncPush();
  }

  function syncPush({ identityChanged = false } = {}) {
    if (preview) return Promise.resolve();
    if (syncing || pushState.busy) {
      if (identityChanged) pushSyncAgain = true;
      return syncing || Promise.resolve();
    }
    syncing = (async () => {
      if (support() !== "ok" || pushState.busy) return;
      if (permission() !== "granted") {
        setPush({ subscribed: false });
        return;
      }
      const saved = record();
      if (saved?.off) {
        setPush({ subscribed: false });
        return;
      }
      setPush({ busy: "sync" });
      let subscription = null;
      try {
        const api = await ready();
        const reg = await registration();
        subscription = await reg.pushManager.getSubscription();
        if (!subscription && !saved?.endpoint) {
          // Never turned on here: that takes a tap on "Turn on".
          setPush({ subscribed: false });
          return;
        }
        const current = subscription && saved?.endpoint === subscription.endpoint && saved.author === api.me();
        if (current && Date.now() - (Number(saved.at) || 0) < 24 * 60 * 60 * 1000) {
          setPush({ subscribed: true });
          return;
        }
        await subscribe(reg);
        setPush({ subscribed: true, error: "" });
      } catch {
        // Offline for now: the subscription this phone still has keeps counting as on.
        setPush({ subscribed: Boolean(subscription && saved?.endpoint === subscription.endpoint) });
      }
    })().finally(() => {
      syncing = null;
      if (pushState.busy === "sync") setPush({ busy: "" });
      continuePushSync();
    });
    return syncing;
  }

  /* ------------------------------- Wiring -------------------------------- */
  if ("serviceWorker" in navigator) {
    // sw.js: a tapped notification shows its page here; a push that arrived refreshes the feed.
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      // An old worker might broadcast to every open letter. Keep its live
      // notification from navigating a preview, and legacy preview messages
      // from navigating the live letter.
      const messagePreview = data.store === "preview";
      if (preview !== messagePreview) return;
      if (data.type === "date:show-step") {
        if (panelOpen) closePanel({ restoreFocus: false });
        goTo(data.step);
        poll({ force: true });
      } else if (data.type === "date:activity") {
        poll({ force: true });
      }
    });
    try { navigator.serviceWorker.startMessages?.(); } catch { /* Messages start on load anyway. */ }
  }

  // ?step=journal (from a notification) opens that page once the plan has loaded.
  function clearStepParam() {
    if (!params.has("step")) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("step");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    } catch { /* Only cosmetic. */ }
  }

  document.addEventListener("date:plan", () => {
    if (!pendingStep) return;
    // After app.js has finished showing the plan page.
    window.setTimeout(() => {
      clearStepParam();
      goTo(pendingStep);
    }, 0);
  });

  document.addEventListener("date:step", (event) => {
    const { name } = event.detail;
    if (["intro", "loading"].includes(name)) {
      if (panelOpen) closePanel({ restoreFocus: false });
      hideToast();
    }
    // She went somewhere herself (no plan yet, so she opened the envelope): forget the page from the link.
    if (pendingStep && !["intro", "loading", "planned"].includes(name)) pendingStep = "";
    renderBell();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      poll({ force: true });
      syncPush();
    }
  });
  window.addEventListener("focus", () => {
    poll();
    syncPush();
  });

  function identityChanged() {
    hideToast();
    listSignature = "";
    render();
    setPush({ note: "", error: "" });
    syncPush({ identityChanged: true });
  }
  document.addEventListener("date:identity", identityChanged);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) identityChanged();
  });

  // Relative times ("2 min ago") stay fresh while the panel is open.
  window.setInterval(() => {
    if (panelOpen && !document.hidden) renderList();
  }, 30000);

  refreshIcons(root);
  renderBell();
  ready().then(() => {
    poll({ force: true });
    startPolling();
    renderPush();
    syncPush();
  }).catch(() => { /* Without the app there's nothing to show. */ });
})();
