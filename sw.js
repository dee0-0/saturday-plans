// Network first, cache as an offline fallback, so a new deploy always shows up
// right away. Only same-origin page files are cached; the plan API, ntfy,
// weather, CDN scripts and the background video always go to the network.
const CACHE = "date-letter-v1";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.headers.has("range") || url.pathname.endsWith(".mp4")) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && response.type === "basic") {
        const copy = response.clone();
        event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
      }
      return response;
    } catch (error) {
      const cached = await caches.match(request, { ignoreSearch: request.mode === "navigate" });
      if (cached) return cached;
      if (request.mode === "navigate") {
        const page = await caches.match("./", { ignoreSearch: true });
        if (page) return page;
      }
      throw error;
    }
  })());
});

// Web push (activity.js subscribes, the Worker sends): show what the other one
// did, and open the letter on that page when the notification is tapped.
const STEP_NAME = /^[a-z]{1,20}$/;

function scopeUrl(path) {
  return new URL(path, self.registration.scope).href;
}

// Preview and the live letter share a worker, but a notification must only
// open/refresh a window in the same mode as its payload.
async function letterWindows(store = "live") {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows.filter((client) => {
    if (!client.url.startsWith(self.registration.scope)) return false;
    try { return new URL(client.url).searchParams.has("preview") === (store === "preview"); }
    catch { return false; }
  });
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    try { payload = { body: event.data.text() }; } catch { payload = {}; }
  }
  if (!payload || typeof payload !== "object") payload = {};
  const text = (value) => (typeof value === "string" ? value.trim() : "");
  const title = text(payload.title) || "Our date";
  const body = text(payload.title) ? text(payload.body) : text(payload.body) || "Something new is waiting in our letter.";
  const step = STEP_NAME.test(payload.step || "") ? payload.step : "";
  const store = payload.store === "preview" ? "preview" : "live";
  const tag = text(payload.tag).slice(0, 64) || "activity";
  const icon = scopeUrl("assets/icon-192.png");
  event.waitUntil(Promise.all([
    self.registration.showNotification(title, { body, icon, badge: icon, tag: `${store}:${tag}`, renotify: true, data: { step, store } }),
    // An open letter refreshes its bell right away.
    letterWindows(store)
      .then((windows) => windows.forEach((client) => client.postMessage({ type: "date:activity", store })))
      .catch(() => {})
  ]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const step = STEP_NAME.test(event.notification.data?.step || "") ? event.notification.data.step : "";
  const store = event.notification.data?.store === "preview" ? "preview" : "live";
  event.waitUntil((async () => {
    const windows = await letterWindows(store);
    const client = windows.find((item) => item.focused) || windows.find((item) => item.visibilityState === "visible") || windows[0];
    if (client) {
      try { await client.focus(); } catch { /* Still show the page below. */ }
      client.postMessage({ type: "date:show-step", step, store });
      return;
    }
    const url = new URL(scopeUrl("./"));
    if (store === "preview") url.searchParams.set("preview", "");
    if (step) url.searchParams.set("step", step);
    await self.clients.openWindow(url.href);
  })());
});
