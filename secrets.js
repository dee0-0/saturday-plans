/*
 * The secret hunt: a "Secret hunt" tracker with a progress bar and hints on
 * the plan page, the small easter eggs around the letter, and the prize for
 * finding every one. The wax seal, signature and scratch-card P.S. (extras.js),
 * the fry game and prize coupon (coupons.js) and the overflowing hearts
 * (journal.js) report in through window.LetterSecrets.found().
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const herName = () => CONFIG.herName || "She";
  const preview = new URLSearchParams(window.location.search).has("preview");
  // Preview keeps its own finds and hints, so testing never counts toward her letter.
  const FOUND_KEY = preview ? "date-letter-secrets-preview" : "date-letter-secrets";
  const HINTS_KEY = preview ? "date-letter-secret-hints-preview" : "date-letter-secret-hints";
  // The prize lives in the shared store, and preview has its own store.
  const REWARD_KEY = preview ? "date-letter-secrets-reward-preview" : "date-letter-secrets-reward";
  const MOTION_KEY = "date-letter-motion";

  const gameTarget = Number(CONFIG.gameTarget) || 15;
  const GAME_SECRET_SCORE = Math.max(gameTarget + 1, Number(CONFIG.gameSecretScore) || gameTarget * 2);
  const lateNightMessage = CONFIG.lateNightMessage || "Shouldn't you be asleep? …thinking about me?";
  const compliments = Array.isArray(CONFIG.compliments) && CONFIG.compliments.length ? CONFIG.compliments : ["You're my favorite person."];
  const prize = CONFIG.secretsCoupon || null;
  const motionNeedsPermission = typeof window.DeviceMotionEvent?.requestPermission === "function";

  const SECRETS = [
    { id: "seal", icon: "stamp", name: "The shy wax seal", where: "Plan page",
      hint: "Tap the little wax seal under my name five times.",
      reward: () => CONFIG.secretMessage || "You found the secret!" },
    { id: "heart", icon: "heart", name: "Stolen heart", where: "Plan page",
      hint: "Tap the heart above “The plan is set!” five times.",
      reward: () => CONFIG.heartMessage || "You stole my heart. Please return it in person." },
    { id: "signature", icon: "signature", name: "Signed with love", where: "Plan page",
      hint: "Press and hold my signature for two seconds.",
      reward: () => `My signature, the honest version: “${CONFIG.signatureNickname || "Yours ♡"}”` },
    { id: "countdown", icon: "timer", name: "Missing you", where: "Plan page, before our date",
      hint: "Tap the seconds in the countdown five times.",
      reward: () => "Missing you. The countdown agrees." },
    { id: "weather", icon: "cloud-sun", name: "Second opinion", where: "Plan page, before our date",
      hint: "Tap the weather card three times.",
      reward: () => `Forecast: ${CONFIG.fakeForecast || "100% chance of me annoying you"}.` },
    { id: "mcdonalds", icon: "fries", name: "Dead serious", where: "Plan page",
      hint: "Tap the McDonald's line above my signature three times.",
      reward: () => "I'm serious about the McDonald's." },
    { id: "scratch", icon: "scroll-text", name: "The hidden P.S.", where: "Plan page",
      hint: "Once the silver card is scratched, tap its message five times.",
      reward: () => CONFIG.scratchSecretTwo || "P.S. The wish never expires." },
    { id: "shake", icon: "vibrate", name: "Shake it up", where: "Plan page",
      hint: motionNeedsPermission ? "Give your phone a good shake on the plan page. Tap “Allow shaking” first." : "Give your phone a good shake on the plan page.",
      reward: () => "Shake your phone on the plan page anytime for a new compliment." },
    { id: "logo", icon: "sparkles", name: "Love mode", where: "Top of the page",
      hint: "Tap the little heart in the top-left corner seven times.",
      reward: () => "Love mode activated." },
    { id: "sound", icon: "music", name: "Our melody", where: "Top of the page",
      hint: "Switch the sound off and on three times, quickly.",
      reward: () => "A little melody, just for you. Switch the sound off and on again to replay it." },
    { id: "footer", icon: "croissant", name: "Favorite croissant", where: "Bottom of the page",
      hint: "Tap your name at the very bottom of the page three times.",
      reward: () => "My favorite croissant." },
    { id: "game", icon: "trophy", name: "Fry legend", where: "Fry game",
      hint: `Score ${GAME_SECRET_SCORE} or more in the fry game.`,
      reward: () => CONFIG.gameSecretMessage || "You're officially a fry legend." },
    { id: "broccoli", icon: "broccoli", name: "Healthy queen", where: "Fry game",
      hint: "Catch 5 broccoli in one round of the fry game. On purpose.",
      reward: () => "Okay, healthy queen." },
    { id: "coupon", icon: "lock-keyhole", name: "Nice try", where: "Coupons",
      hint: "Tap the fry-game prize coupon five times. The coupon, not its button.",
      reward: () => "Nice try, you have to earn it." },
    { id: "hearts", icon: "infinity", name: "Off the scale", where: "Journal, after our date",
      hint: "After our date, tap the fifth heart in the journal ten times.",
      reward: () => "You broke the rating scale: ∞ / 5." },
    { id: "night", icon: "moon", name: "Night owl", where: "Late at night",
      hint: "Open the letter between midnight and 4 a.m.",
      reward: () => lateNightMessage }
  ];
  const byId = Object.fromEntries(SECRETS.map((secret) => [secret.id, secret]));

  function stored(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* Private browsing. */ }
  }
  function storedSet(key) {
    try { return new Set(JSON.parse(stored(key) || "[]") || []); } catch { return new Set(); }
  }
  function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
  }

  // Opening the letter once with ?me marks the phone as yours (same as picking
  // your name in the journal).
  if (new URLSearchParams(window.location.search).has("me")) save("date-letter-author", "sender");
  // Your own phone doesn't count as hers: it shows her progress from the server,
  // your taps don't count or notify, and they never unlock her prize.
  const isOwnPhone = () => !preview && stored("date-letter-author") === "sender";
  const ownPhone = isOwnPhone();

  const found = ownPhone ? new Set() : storedSet(FOUND_KEY);
  const hintsShown = storedSet(HINTS_KEY);
  // The wax seal is older than the tracker, so a seal she already opened counts.
  if (!preview && !ownPhone && stored("date-letter-secret") === "1") found.add("seal");

  const foundCount = () => SECRETS.filter((secret) => found.has(secret.id)).length;
  const complete = () => foundCount() === SECRETS.length;
  function notify(title, message, tags) {
    if (isOwnPhone()) return Promise.resolve(false);
    return window.DateApp?.notify(title, message, tags) ?? Promise.resolve(false);
  }

  /* -------------------------------- Icons -------------------------------- */
  // Lucide has no fries, so this one is drawn in the same line style.
  const FRIES_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 10 7 4"/><path d="M10.7 10V3"/><path d="M13.3 10V2.5"/><path d="m16 10 1-6"/><path d="M5.5 10h13l-1.4 10.3a2 2 0 0 1-2 1.7H8.9a2 2 0 0 1-2-1.7Z"/><path d="M9.5 15.5a2.5 2.5 0 0 0 5 0"/></svg>';
  const HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>';

  function iconHtml(name) {
    return name === "fries" ? FRIES_SVG : `<i class="icon" data-lucide="${escapeHtml(name)}" aria-hidden="true"></i>`;
  }
  function renderIcons(root) {
    try { window.lucide?.createIcons({ root }); } catch { /* Icons are decoration. */ }
  }
  function lucideSvg(name) {
    const key = name.replace(/(^|-)(\w)/g, (_, __, letter) => letter.toUpperCase());
    const node = window.lucide?.icons?.[key];
    return node ? window.lucide.createElement(node).outerHTML : HEART_SVG;
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
    toastIcon.innerHTML = iconHtml(item.icon || "key-round");
    renderIcons(toastIcon);
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

  /* ---------------------------- Little effects --------------------------- */
  const SPRAYS = {
    hearts: { svg: () => HEART_SVG, colors: ["#dc4f83", "#ef7aa3", "#ad315f", "#f4a3bf"] },
    fries: { svg: () => FRIES_SVG, colors: ["#d9962f", "#dc4f83", "#b97b22"] },
    croissant: { svg: () => lucideSvg("croissant"), colors: ["#cf8a35", "#b26f22", "#dc4f83"] }
  };

  // Icons raining down the screen, or bursting out of `from` when it's given.
  function spray(kind, { count = 28, from = null } = {}) {
    if (reduced || !SPRAYS[kind]) return;
    const { svg, colors } = SPRAYS[kind];
    const markup = svg();
    const rect = from?.getBoundingClientRect();
    const layer = document.createElement("div");
    layer.className = `icon-spray${rect ? " is-burst" : ""}`;
    layer.setAttribute("aria-hidden", "true");
    for (let i = 0; i < count; i += 1) {
      const piece = document.createElement("span");
      const size = 14 + Math.random() * 16;
      piece.innerHTML = markup;
      piece.style.color = colors[i % colors.length];
      piece.style.width = piece.style.height = `${size}px`;
      piece.style.setProperty("--spin", `${(Math.random() - 0.5) * 160}deg`);
      if (rect) {
        const angle = Math.random() * Math.PI * 2;
        const distance = 60 + Math.random() * 120;
        piece.style.left = `${rect.left + rect.width / 2 - size / 2}px`;
        piece.style.top = `${rect.top + rect.height / 2 - size / 2}px`;
        piece.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
        piece.style.setProperty("--dy", `${Math.sin(angle) * distance - 40}px`);
        piece.style.animationDuration = `${0.9 + Math.random() * 0.7}s`;
      } else {
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 90}px`);
        piece.style.animationDuration = `${1.9 + Math.random() * 1.5}s`;
        piece.style.animationDelay = `${Math.random() * 0.8}s`;
      }
      layer.append(piece);
    }
    document.body.append(layer);
    window.setTimeout(() => layer.remove(), 4500);
  }

  // A little squeeze on every tap, so she can tell something is listening.
  // Web Animations, so it doesn't restart the element's own CSS animation.
  function nudge(element, { pop = false } = {}) {
    if (!element?.animate || reduced) return;
    const frames = pop
      ? [{ transform: "scale(1)" }, { transform: "scale(1.45)" }, { transform: "scale(.9)" }, { transform: "scale(1)" }]
      : [{ transform: "scale(1)" }, { transform: "scale(.93)" }, { transform: "scale(1.05)" }, { transform: "scale(1)" }];
    element.animate(frames, { duration: pop ? 620 : 340, easing: "cubic-bezier(.3,.7,.3,1.3)" });
  }

  // Runs `done` after `needed` quick taps on `element` (each within `gap` ms of the last).
  function onTaps(element, needed, done, { gap = 1500, onTap } = {}) {
    if (!element) return;
    let count = 0;
    let timer = null;
    element.addEventListener("click", (event) => {
      count += 1;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { count = 0; }, gap);
      onTap?.(count, event);
      if (count < needed) return;
      count = 0;
      window.clearTimeout(timer);
      done(event);
    });
  }

  /* ------------------------------- Tracker ------------------------------- */
  const tracker = $("#secret-tracker");
  const listEl = $("#secret-list");
  const finalEl = $("#secret-final");
  let listening = false;

  function renderTracker() {
    if (!tracker) return;
    const count = foundCount();
    const total = SECRETS.length;
    tracker.hidden = count === 0;
    if (!count) return;
    $("#secret-count").textContent = `${count} of ${total} found`;
    $("#secret-left").textContent = count === total ? "All found" : `${total - count} left`;
    $("#secret-progress-fill").style.width = `${(count / total) * 100}%`;
    $("#secret-progress").setAttribute("aria-valuenow", String(count));
    $("#secret-progress").setAttribute("aria-valuemax", String(total));
    listEl.innerHTML = SECRETS.map((secret) => {
      if (found.has(secret.id)) {
        return `<li class="is-found">
          <span class="secret-badge">${iconHtml(secret.icon)}</span>
          <span class="secret-copy"><strong>${escapeHtml(secret.name)}</strong><small>${escapeHtml(secret.reward())}</small></span>
        </li>`;
      }
      const hint = hintsShown.has(secret.id);
      const askMotion = hint && secret.id === "shake" && motionNeedsPermission && !listening;
      return `<li>
        <span class="secret-badge">${iconHtml("lock")}</span>
        <span class="secret-copy">
          <strong>Hidden secret</strong><small>${escapeHtml(secret.where)}</small>
          ${hint ? `<span class="secret-hint">${iconHtml("lightbulb")}${escapeHtml(secret.hint)}</span>` : ""}
          ${askMotion ? '<button class="secret-motion" type="button" data-secret-motion>Allow shaking</button>' : ""}
        </span>
        ${hint ? "" : `<button class="secret-hint-button" type="button" data-hint="${secret.id}" aria-label="Show a hint for this ${escapeHtml(secret.where.toLowerCase())} secret">Hint</button>`}
      </li>`;
    }).join("");
    renderIcons(listEl);
    finalEl.hidden = count !== total;
    $("#secret-final-text").textContent = CONFIG.allSecretsMessage || "You found every single secret.";
    $("#secret-final-prize").hidden = !prize;
  }

  async function claimPrize() {
    if (stored(REWARD_KEY) === "1" || !window.DateCoupons || isOwnPhone()) return;
    const unlocked = await window.DateCoupons.unlockSecretPrize();
    // null means the request failed; it tries again next time the plan page opens.
    if (unlocked !== null) save(REWARD_KEY, "1");
  }

  function finishHunt() {
    window.LetterFX?.scatter?.(54);
    window.LetterFX?.chime?.();
    toast({
      icon: "trophy",
      title: `All ${SECRETS.length} secrets found`,
      text: prize ? `You unlocked a secret coupon: ${prize.title}.` : CONFIG.allSecretsMessage || "You found every single secret.",
      duration: 8000
    });
    notify(
      `${herName()} found ALL the secrets 🗝️`,
      `All ${SECRETS.length} easter eggs found${prize ? `, so "${prize.title}" is unlocked` : ""}.`,
      ["key", "trophy"]
    );
    claimPrize();
  }

  // Marks a secret as found and shows a toast: `toast` replaces the default one
  // (the secret's own message), `toast: false` shows none. The first time it
  // also gets a "Secret 3 of 16" line and sends you a notification, with
  // `detail` added to it. `quietRepeat` skips the toast after the first time.
  // Returns true only the first time.
  function markFound(id, { toast: custom, detail = "", quietRepeat = false } = {}) {
    const secret = byId[id];
    if (!secret) return false;
    if (ownPhone) {
      if (custom !== false) toast({ icon: secret.icon, title: secret.name, text: secret.reward(), ...custom, note: "Your phone · doesn't count for her" });
      return false;
    }
    const fresh = !found.has(id);
    if (fresh) {
      found.add(id);
      save(FOUND_KEY, JSON.stringify([...found]));
      postFound(id);
    }
    const count = foundCount();
    const total = SECRETS.length;
    if (custom !== false && (fresh || !quietRepeat)) {
      const note = !fresh ? "" : count === 1
        ? `Secret 1 of ${total} · your list is on the plan page`
        : count === total ? "Every secret found" : `Secret ${count} of ${total} · ${total - count} left`;
      toast({ icon: secret.icon, title: secret.name, text: secret.reward(), ...custom, note });
    }
    renderTracker();
    if (fresh) {
      notify(`${herName()} found a secret (${count}/${total})`, `${secret.name}${detail ? `\n${detail}` : ""}`, ["key"]);
      if (count === total) finishHunt();
    }
    return fresh;
  }

  listEl?.addEventListener("click", async (event) => {
    const hintButton = event.target.closest("[data-hint]");
    if (hintButton) {
      hintsShown.add(hintButton.dataset.hint);
      save(HINTS_KEY, JSON.stringify([...hintsShown]));
      renderTracker();
      return;
    }
    if (!event.target.closest("[data-secret-motion]")) return;
    const allowed = await askForMotion();
    renderTracker();
    toast(allowed
      ? { icon: "smartphone", title: "Now shake it", text: "Give your phone a good shake while the plan page is open." }
      : { icon: "smartphone", title: "Safari said no", text: "Tap “Allow shaking” again and choose Allow when Safari asks." });
  });

  /* ------------------------- Late-night message -------------------------- */
  let nightShown = false;
  function checkLateNight() {
    if (nightShown || document.hidden) return;
    const now = new Date();
    if (now.getHours() >= 4) return;
    nightShown = true;
    const clock = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const time = window.DateApp?.formatTime(clock) || clock;
    markFound("night", { toast: { title: `It's ${time}`, text: lateNightMessage, duration: 9000 }, detail: `She opened the letter at ${time}.` });
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
    markFound("shake", { toast: { icon: "heart", title: "", text: compliment, duration: 6000 }, detail: `Her first compliment: "${compliment}"` });
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

  /* --------------------- Tap secrets around the letter -------------------- */
  // The big heart above "The plan is set!"
  const bigHeart = $('[data-step="planned"] .success-icon');
  onTaps(bigHeart, 5, () => {
    nudge(bigHeart, { pop: true });
    spray("hearts", { count: 22, from: bigHeart });
    window.LetterFX?.burstFrom(bigHeart, 20);
    window.LetterFX?.chime?.();
    markFound("heart");
  }, { onTap: () => nudge(bigHeart) });

  // The seconds in the countdown turn into "Missing you".
  const countdown = $("#planned-countdown");
  const seconds = $("#planned-countdown-seconds")?.parentElement;
  let missingTimer = null;
  onTaps(seconds, 5, () => {
    countdown.classList.add("is-missing");
    window.clearTimeout(missingTimer);
    missingTimer = window.setTimeout(() => countdown.classList.remove("is-missing"), 3600);
    window.LetterFX?.chime?.();
    markFound("countdown");
  }, { onTap: () => nudge(seconds) });

  // The weather card's second opinion.
  const weatherCard = $("#weather-card");
  let forecastTimer = null;
  if (weatherCard) $("#weather-fake-text").textContent = `${CONFIG.fakeForecast || "100% chance of me annoying you"}`;
  onTaps(weatherCard, 3, () => {
    weatherCard.classList.add("is-fake");
    window.clearTimeout(forecastTimer);
    forecastTimer = window.setTimeout(() => weatherCard.classList.remove("is-fake"), 5200);
    markFound("weather");
  }, { gap: 1200, onTap: () => nudge(weatherCard) });

  // The McDonald's line.
  const closingNote = $("#closing-note");
  onTaps(closingNote, 3, () => {
    spray("fries", { count: 30 });
    markFound("mcdonalds");
  }, { gap: 1200, onTap: () => nudge(closingNote) });

  // Her name at the very bottom.
  const footerName = $("#footer-name");
  onTaps(footerName, 3, () => {
    spray("croissant", { count: 18, from: footerName });
    markFound("footer");
  }, { gap: 1200, onTap: () => nudge(footerName) });

  // The little heart in the top-left corner: love mode.
  const logo = $(".brand-mark");
  onTaps(logo, 7, () => {
    const glow = document.createElement("div");
    glow.className = "love-mode";
    glow.setAttribute("aria-hidden", "true");
    document.body.append(glow);
    window.setTimeout(() => glow.remove(), 3800);
    spray("hearts", { count: 30 });
    window.LetterFX?.chime?.();
    markFound("logo");
  }, { gap: 1200, onTap: () => nudge(logo) });

  // Sound off and on three times: a little melody.
  const soundToggle = $("#sound-toggle");
  let soundOns = 0;
  let soundTimer = null;
  soundToggle?.addEventListener("click", () => {
    window.clearTimeout(soundTimer);
    soundTimer = window.setTimeout(() => { soundOns = 0; }, 1500);
    if (soundToggle.getAttribute("aria-pressed") !== "true") return;
    // Counting switches to "on", so it works whether the sound started on or off.
    soundOns += 1;
    if (soundOns < 3) return;
    soundOns = 0;
    window.LetterMusic?.duck?.(3.4);
    window.setTimeout(() => window.LetterFX?.melody?.(), 250);
    markFound("sound");
  });

  /* ---------------------------- Server sync ------------------------------ */
  // Her finds are saved in the shared store too, so your phone shows her hunt.
  function postFound(id) {
    if (ownPhone) return;
    window.DateApp?.apiRequest("/secrets", "POST", { id }).catch(() => { /* Sent again on the next sync. */ });
  }

  async function syncWithServer() {
    if (!window.DateApp) return;
    let saved;
    try { saved = (await window.DateApp.apiRequest("/secrets")).found || []; } catch { return; }
    const before = foundCount();
    saved.forEach((id) => { if (byId[id]) found.add(id); });
    if (!ownPhone) {
      // Finds from before the server kept them, or that couldn't be sent.
      [...found].filter((id) => byId[id] && !saved.includes(id)).forEach(postFound);
      save(FOUND_KEY, JSON.stringify([...found]));
    }
    if (foundCount() !== before) renderTracker();
    if (!ownPhone && complete()) claimPrize();
  }
  window.setInterval(() => {
    if (!document.hidden && window.DateApp?.step === "planned") syncWithServer();
  }, 30000);

  /* ------------------------------- Wiring -------------------------------- */
  document.addEventListener("date:step", (event) => {
    if (event.detail.name !== "planned") return;
    renderTracker();
    if (complete()) claimPrize();
    syncWithServer();
  });
  renderTracker();

  window.LetterSecrets = {
    found: markFound,
    isFound: (id) => found.has(id),
    notify,
    spray,
    nudge,
    onTaps,
    toast,
    gameSecretScore: GAME_SECRET_SCORE
  };
})();
