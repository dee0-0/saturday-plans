/*
 * The secret hunt: a "Secrets found" tracker on the plan page, the late-night
 * message, shake-for-a-compliment, and the prize for finding every secret.
 * The wax seal (extras.js), the fry-game high score (coupons.js) and the
 * overflowing hearts (journal.js) report in through window.LetterSecrets.found().
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const herName = () => CONFIG.herName || "She";
  const preview = new URLSearchParams(window.location.search).has("preview");
  const FOUND_KEY = "date-letter-secrets";
  // The prize lives in the shared store, and preview has its own store.
  const REWARD_KEY = preview ? "date-letter-secrets-reward-preview" : "date-letter-secrets-reward";
  const MOTION_KEY = "date-letter-motion";

  const gameTarget = Number(CONFIG.gameTarget) || 15;
  const GAME_SECRET_SCORE = Math.max(gameTarget + 1, Number(CONFIG.gameSecretScore) || gameTarget * 2);
  const lateNightMessage = CONFIG.lateNightMessage || "Shouldn't you be asleep? …thinking about me? 😏";
  const compliments = Array.isArray(CONFIG.compliments) && CONFIG.compliments.length ? CONFIG.compliments : ["You're my favorite person."];
  const prize = CONFIG.secretsCoupon || null;

  const SECRETS = [
    { id: "seal", name: "The shy wax seal", hint: "The little seal under my name doesn't open on the first tap.", reward: () => CONFIG.secretMessage || "You found the secret! 🤫" },
    { id: "shake", name: "Shake it up", hint: "Things fall out when you shake them 📱", reward: () => "Shake your phone on this page anytime for a new compliment 💌" },
    { id: "night", name: "Night owl", hint: "Some messages only come out after midnight 🌙", reward: () => lateNightMessage },
    { id: "game", name: "Fry legend", hint: `The fry game has a secret high score. Try ${GAME_SECRET_SCORE}+ 🍟`, reward: () => CONFIG.gameSecretMessage || "You're officially a fry legend 🍟" },
    { id: "hearts", name: "Off the scale", hint: "After our date, rate it higher than the hearts go.", reward: () => "You broke the rating scale: ∞ / 5 💕" }
  ];

  function stored(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* Private browsing. */ }
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  const found = new Set();
  try { (JSON.parse(stored(FOUND_KEY) || "[]") || []).forEach((id) => found.add(id)); } catch { /* Start fresh. */ }
  // The wax seal is older than the tracker, so a seal she already opened counts.
  if (stored("date-letter-secret") === "1") found.add("seal");

  const foundCount = () => SECRETS.filter((secret) => found.has(secret.id)).length;
  const complete = () => foundCount() === SECRETS.length;

  // Your own phone (you picked your name in the journal) doesn't report your finds as hers.
  function notify(title, message, tags) {
    if (!preview && stored("date-letter-author") === "sender") return Promise.resolve(false);
    return window.DateApp?.notify(title, message, tags) ?? Promise.resolve(false);
  }

  /* ------------------------------- Toasts -------------------------------- */
  const toastEl = document.createElement("div");
  toastEl.className = "secret-toast";
  toastEl.setAttribute("role", "status");
  toastEl.setAttribute("aria-live", "polite");
  toastEl.innerHTML = '<span class="secret-toast-icon" aria-hidden="true"></span><span class="secret-toast-copy"><strong></strong><span></span><small></small></span>';
  document.body.append(toastEl);
  if (preview) document.body.classList.add("has-preview-bar");
  const toastIcon = toastEl.querySelector(".secret-toast-icon");
  const [toastTitle, toastText, toastNote] = toastEl.querySelector(".secret-toast-copy").children;
  const toastQueue = [];
  let toastTimer = null;
  let toastShowing = false;

  function toast(item) {
    toastQueue.push(item);
    if (!toastShowing) nextToast();
  }

  function nextToast() {
    const item = toastQueue.shift();
    if (!item) {
      toastShowing = false;
      [toastIcon, toastTitle, toastText, toastNote].forEach((element) => { element.textContent = ""; });
      return;
    }
    toastShowing = true;
    toastIcon.textContent = item.icon || "🗝️";
    toastTitle.textContent = item.title || "";
    toastTitle.hidden = !item.title;
    toastText.textContent = item.text || "";
    toastNote.textContent = item.note || "";
    toastNote.hidden = !item.note;
    toastEl.classList.add("is-visible");
    toastTimer = window.setTimeout(dismissToast, item.duration || 5200);
  }

  function dismissToast() {
    window.clearTimeout(toastTimer);
    toastEl.classList.remove("is-visible");
    window.setTimeout(nextToast, 280);
  }
  toastEl.addEventListener("click", () => { if (toastShowing) dismissToast(); });

  /* ---------------------------- Heart shower ----------------------------- */
  function rain(emojis, count = 30) {
    if (reduced) return;
    const layer = document.createElement("div");
    layer.className = "emoji-rain";
    layer.setAttribute("aria-hidden", "true");
    for (let i = 0; i < count; i += 1) {
      const drop = document.createElement("span");
      drop.textContent = emojis[i % emojis.length];
      drop.style.left = `${Math.random() * 100}%`;
      drop.style.fontSize = `${16 + Math.random() * 18}px`;
      drop.style.setProperty("--drift", `${(Math.random() - 0.5) * 90}px`);
      drop.style.setProperty("--spin", `${(Math.random() - 0.5) * 140}deg`);
      drop.style.animationDuration = `${1.9 + Math.random() * 1.5}s`;
      drop.style.animationDelay = `${Math.random() * 0.8}s`;
      layer.append(drop);
    }
    document.body.append(layer);
    window.setTimeout(() => layer.remove(), 4500);
  }

  /* ------------------------------- Tracker ------------------------------- */
  const tracker = $("#secret-tracker");
  const listEl = $("#secret-list");
  const finalEl = $("#secret-final");
  const motionNeedsPermission = typeof window.DeviceMotionEvent?.requestPermission === "function";
  let listening = false;

  function renderTracker() {
    if (!tracker) return;
    const count = foundCount();
    tracker.hidden = count === 0;
    if (!count) return;
    $("#secret-count").textContent = `${count}/${SECRETS.length}`;
    $("#secret-dots").innerHTML = SECRETS.map((secret) => `<i class="${found.has(secret.id) ? "is-found" : ""}"></i>`).join("");
    listEl.innerHTML = SECRETS.map((secret) => {
      const done = found.has(secret.id);
      const askMotion = secret.id === "shake" && !done && motionNeedsPermission && !listening;
      return `<li class="${done ? "is-found" : ""}">
        <span class="secret-mark" aria-hidden="true">${done ? "✓" : "?"}</span>
        <span class="secret-copy">
          <strong>${done ? escapeHtml(secret.name) : '<span aria-hidden="true">???</span><span class="visually-hidden">Not found yet</span>'}</strong>
          <small>${escapeHtml(done ? secret.reward() : secret.hint)}</small>
          ${askMotion ? '<button class="secret-motion" type="button" data-secret-motion>Allow shaking</button>' : ""}
        </span>
      </li>`;
    }).join("");
    finalEl.hidden = !complete();
    $("#secret-final-text").textContent = CONFIG.allSecretsMessage || "You found every single secret 🗝️";
    $("#secret-final-prize").hidden = !prize;
  }

  async function claimPrize() {
    if (stored(REWARD_KEY) === "1" || !window.DateCoupons) return;
    const unlocked = await window.DateCoupons.unlockSecretPrize();
    // null means the request failed; it tries again next time the plan page opens.
    if (unlocked !== null) save(REWARD_KEY, "1");
  }

  function finishHunt() {
    window.LetterFX?.scatter?.(54);
    window.LetterFX?.chime?.();
    toast({
      icon: "🏆",
      title: `All ${SECRETS.length} secrets found!`,
      text: prize ? `You unlocked a secret coupon: ${prize.icon || ""} ${prize.title}`.replace(/\s+/g, " ") : CONFIG.allSecretsMessage || "You found every single secret.",
      duration: 8000
    });
    notify(
      `${herName()} found ALL the secrets 🗝️`,
      `All ${SECRETS.length} easter eggs found${prize ? `, so "${prize.title}" is unlocked` : ""}.`,
      ["key", "trophy"]
    );
    claimPrize();
  }

  // Marks a secret as found. Pass `display` to show your own toast (it gets a
  // "Secret 2 of 5" line the first time); otherwise a first find gets a default one.
  // Returns true only the first time, so callers can notify once.
  function markFound(id, display) {
    if (!SECRETS.some((secret) => secret.id === id)) return false;
    const fresh = !found.has(id);
    if (fresh) {
      found.add(id);
      save(FOUND_KEY, JSON.stringify([...found]));
    }
    const count = foundCount();
    const total = SECRETS.length;
    if (display) {
      toast({ ...display, note: fresh ? `🗝️ Secret ${count} of ${total} found` : "" });
    } else if (fresh && count < total) {
      toast({
        icon: "🗝️",
        title: "You found a secret!",
        text: count === 1
          ? `That's 1 of ${total}. More are hidden in this letter, and your list is on the plan page 👀`
          : `That's ${count} of ${total}. Keep looking 👀`
      });
    }
    renderTracker();
    if (fresh && count === total) finishHunt();
    return fresh;
  }

  /* ------------------------- Late-night message -------------------------- */
  let nightShown = false;
  function checkLateNight() {
    if (nightShown || document.hidden) return;
    const now = new Date();
    if (now.getHours() >= 4) return;
    nightShown = true;
    const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const time = window.DateApp?.formatTime(clock) || clock;
    if (markFound("night", { icon: "🌙", title: `It's ${time}`, text: lateNightMessage, duration: 9000 })) {
      notify(`${herName()} found the late-night secret 🌙`, `She opened the letter at ${time}.`, ["crescent_moon"]);
    }
  }
  // Wait for the letter's opening animation before saying anything.
  window.setTimeout(checkLateNight, 2800);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) window.setTimeout(checkLateNight, 800);
  });

  /* ------------------------------- Shaking ------------------------------- */
  let lastReading = null;
  let jolts = [];
  let lastShake = 0;
  let lastCompliment = -1;

  function onMotion(event) {
    if (window.DateApp?.step !== "planned") { lastReading = null; return; }
    const reading = event.accelerationIncludingGravity;
    if (!reading || reading.x == null) return;
    const now = performance.now();
    if (lastReading) {
      const change = Math.abs(reading.x - lastReading.x) + Math.abs(reading.y - lastReading.y) + Math.abs(reading.z - lastReading.z);
      // A shake is a few hard jolts close together, not one bump.
      if (change > 26 && now - (jolts[jolts.length - 1] || 0) > 110) {
        jolts = jolts.filter((time) => now - time < 1000);
        jolts.push(now);
      }
      if (jolts.length >= 3 && now - lastShake > 1800) {
        lastShake = now;
        jolts = [];
        shaken();
      }
    }
    lastReading = { x: reading.x, y: reading.y, z: reading.z };
  }

  function shaken() {
    let index = Math.floor(Math.random() * compliments.length);
    if (compliments.length > 1 && index === lastCompliment) index = (index + 1) % compliments.length;
    lastCompliment = index;
    const compliment = compliments[index];
    window.LetterFX?.scatter?.(42);
    window.LetterFX?.chime?.();
    if (markFound("shake", { icon: "💌", text: compliment, duration: 6000 })) {
      notify(`${herName()} shook her phone 📱`, `She found the shake secret. Her first compliment: "${compliment}"`, ["iphone", "sparkles"]);
    }
  }

  function listenForShakes() {
    if (listening) return;
    listening = true;
    window.addEventListener("devicemotion", onMotion, { passive: true });
  }

  // iPhones only share motion after a tap and a yes to Safari's question.
  async function askForMotion() {
    if (listening) return true;
    try {
      if (await window.DeviceMotionEvent.requestPermission() === "granted") {
        save(MOTION_KEY, "1");
        listenForShakes();
        return true;
      }
    } catch { /* Needs a tap, or she said no. */ }
    return false;
  }

  if (!motionNeedsPermission) {
    if ("DeviceMotionEvent" in window) listenForShakes();
  } else if (stored(MOTION_KEY) === "1") {
    // She allowed it on an earlier visit; Safari still wants a tap before it says so again.
    document.addEventListener("click", () => { askForMotion().then(renderTracker); }, { once: true, capture: true });
  }

  listEl?.addEventListener("click", async (event) => {
    if (!event.target.closest("[data-secret-motion]")) return;
    const allowed = await askForMotion();
    renderTracker();
    toast(allowed
      ? { icon: "📱", title: "Now shake it", text: "Give your phone a good shake while this page is open." }
      : { icon: "📱", title: "Safari said no", text: "Tap “Allow shaking” again and choose Allow when Safari asks." });
  });

  /* ------------------------------- Wiring -------------------------------- */
  document.addEventListener("date:step", (event) => {
    if (event.detail.name !== "planned") return;
    renderTracker();
    if (complete()) claimPrize();
  });
  renderTracker();

  window.LetterSecrets = {
    found: markFound,
    notify,
    rain,
    toast,
    gameSecretScore: GAME_SECRET_SCORE
  };
})();
