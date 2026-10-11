/*
 * Extras on the "Our plan" screen: weather forecast, scratch card, animated
 * signature, the wax-seal easter egg, and the add-to-home-screen hint.
 * Talks to app.js through window.DateApp and the date:step / date:plan events.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const herName = () => CONFIG.herName || "She";

  function stored(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function save(key, value) {
    try { window.localStorage.setItem(key, value); } catch { /* Private browsing. */ }
  }

  /* ------------------------------ Weather -------------------------------- */
  const weatherCard = $("#weather-card");
  const weatherIcon = $("#weather-icon");
  const weatherSummary = $("#weather-summary");
  const weatherAdvice = $("#weather-advice");
  const forecastCache = new Map();

  const CONDITIONS = [
    [[0], "Clear sky", "sun"],
    [[1], "Mostly clear", "sun"],
    [[2], "Partly cloudy", "cloud-sun"],
    [[3], "Overcast", "cloud"],
    [[45, 48], "Foggy", "cloud-fog"],
    [[51, 53, 55, 56, 57], "Drizzle", "cloud-drizzle"],
    [[61, 80], "Light rain", "cloud-rain"],
    [[63, 81], "Rain", "cloud-rain"],
    [[65, 82], "Heavy rain", "cloud-rain"],
    [[66, 67], "Freezing rain", "cloud-rain"],
    [[71, 77, 85], "Light snow", "cloud-snow"],
    [[73, 75, 86], "Snow", "cloud-snow"],
    [[95, 96, 99], "Thunderstorms", "cloud-lightning"]
  ];

  function condition(code, isDay) {
    const match = CONDITIONS.find(([codes]) => codes.includes(code)) || [[], "Mixed weather", "cloud"];
    const night = !isDay;
    let icon = match[2];
    if (night && icon === "sun") icon = "moon";
    if (night && icon === "cloud-sun") icon = "cloud-moon";
    return { label: match[1], icon };
  }

  function advice(code, temperature, rainChance, plan, isDay) {
    const indoors = /cook|movie|lego|stay in|relax/i.test(plan.activity) || /^(my|your) place$/i.test(plan.place);
    const wet = rainChance >= 50 || [51, 53, 55, 61, 63, 65, 66, 67, 80, 81, 82].includes(code);
    if ([95, 96, 99].includes(code)) return indoors ? "Thunder outside, the perfect excuse to stay cozy inside." : "Thunderstorms likely, so let's have an indoor backup.";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow! Warm boots and your biggest scarf. ❄️";
    if (wet) return indoors ? `${rainChance}% chance of rain, which makes inside even cozier.` : `${rainChance}% chance of rain, bring an umbrella ☂️`;
    if (temperature <= 4) return "Freezing, wear your warmest jacket 🧣";
    if (temperature <= 12) return "A bit chilly, bring a jacket.";
    if (temperature >= 28) return "Hot! Sunglasses and lots of water 🕶️";
    if (code <= 1 && !isDay) return indoors ? "Clear night, maybe a little walk under the stars too?" : "Clear and starry, perfect for it ✨";
    if (code <= 1) return indoors ? "Lovely weather, maybe a little walk too?" : "Perfect weather for it ☀️";
    return "Comfy weather, wear whatever you like.";
  }

  const BERN = { label: "in Bern", latitude: 46.948, longitude: 7.4474 };
  const GENERIC_PLACES = ["you pick", "my place", "your place", "somewhere new"];
  const placeCache = new Map();

  function kmFromBern(result) {
    const dx = (result.longitude - BERN.longitude) * 111 * Math.cos(BERN.latitude * Math.PI / 180);
    const dy = (result.latitude - BERN.latitude) * 111;
    return Math.hypot(dx, dy);
  }

  // Town or area names (Thun, Gurten, Murten…) get their own forecast. Venue
  // names can't be looked up, so those, and the generic choices, use Bern.
  async function locate(place) {
    const name = String(place || "").trim();
    if (!name || GENERIC_PLACES.includes(name.toLowerCase())) return BERN;
    if (placeCache.has(name)) return placeCache.get(name);
    let found = BERN;
    try {
      const response = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&countryCode=CH`);
      const data = await response.json();
      const near = (data.results || []).find((result) => kmFromBern(result) <= 40);
      if (near) {
        const town = /^PPL/.test(near.feature_code || "");
        found = { label: `${town ? "in" : "at"} ${near.name}`, latitude: near.latitude, longitude: near.longitude };
      }
    } catch { /* Fall back to Bern. */ }
    placeCache.set(name, found);
    return found;
  }

  async function fetchForecast(date, location) {
    const key = `${date}:${location.latitude},${location.longitude}`;
    const cached = forecastCache.get(key);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.data;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${location.latitude}&longitude=${location.longitude}`
      + "&hourly=temperature_2m,precipitation_probability,weather_code,is_day&timezone=Europe%2FZurich"
      + `&start_date=${date}&end_date=${date}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Forecast unavailable");
    const data = await response.json();
    forecastCache.set(key, { at: Date.now(), data });
    return data;
  }

  function showWeather(icon, summary, tip) {
    weatherIcon.innerHTML = `<i class="icon" data-lucide="${icon}"></i>`;
    weatherSummary.textContent = summary;
    weatherAdvice.textContent = tip;
    weatherCard.hidden = false;
    window.DateApp?.refreshIcons();
  }

  async function renderWeather(plan) {
    if (!weatherCard) return;
    if (!plan || plan.status !== "confirmed") { weatherCard.hidden = true; return; }
    const [year, month, day] = plan.date.split("-").map(Number);
    const [hour, minute] = plan.time.split(":").map(Number);
    const start = window.DateApp.dateInTimeZone(year, month, day, hour, minute);
    if (start.getTime() + 3 * 3600 * 1000 < Date.now()) { weatherCard.hidden = true; return; }

    const [todayYear, todayMonth, todayDay] = window.DateApp.todayISO().split("-").map(Number);
    const daysAway = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86400000);
    const weekday = new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day, 12)));
    const dayLabel = daysAway === 0 ? "Today" : daysAway === 1 ? "Tomorrow" : weekday;

    const location = await locate(plan.place);
    if (daysAway > 15) {
      showWeather("calendar-clock", `${weekday} ${location.label}`, "The forecast shows up about two weeks before.");
      return;
    }
    try {
      const data = await fetchForecast(plan.date, location);
      const roundedHour = minute >= 30 ? Math.min(23, hour + 1) : hour;
      const index = data.hourly.time.indexOf(`${plan.date}T${String(roundedHour).padStart(2, "0")}:00`);
      if (index < 0) throw new Error("Hour missing");
      const code = data.hourly.weather_code[index];
      const temperature = Math.round(data.hourly.temperature_2m[index]);
      const rainChance = Math.round(data.hourly.precipitation_probability[index] ?? 0);
      const isDay = data.hourly.is_day?.[index] !== 0;
      const { label, icon } = condition(code, isDay);
      // Ignore late answers if the plan changed while the forecast was loading.
      const current = window.DateApp.plan;
      if (current?.date !== plan.date || current?.time !== plan.time || current?.place !== plan.place) return;
      showWeather(icon, `${dayLabel} ${location.label}: ${temperature}°, ${label.toLowerCase()}`, advice(code, temperature, rainChance, plan, isDay));
    } catch {
      weatherCard.hidden = true;
    }
  }

  /* ---------------------------- Scratch card ----------------------------- */
  const scratchCard = $("#scratch-card");
  const foil = $("#scratch-foil");
  const scratchSecret = $("#scratch-secret");
  const scratchSkip = $("#scratch-skip");
  const SCRATCH_KEY = "date-letter-scratched";
  let scratchRevealed = stored(SCRATCH_KEY) === "1";
  let foilContext = null;
  let scratching = false;
  let lastPoint = null;
  let strokes = 0;

  if (scratchSecret) scratchSecret.textContent = CONFIG.scratchSecret || "You're my favorite person.";

  function paintFoil(width, height) {
    const ctx = foilContext;
    ctx.globalCompositeOperation = "source-over";
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#c6cbd4");
    gradient.addColorStop(0.35, "#f4f5f8");
    gradient.addColorStop(0.55, "#bcc1cb");
    gradient.addColorStop(0.8, "#eef0f3");
    gradient.addColorStop(1, "#b5bac4");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    for (let i = 0; i < (width * height) / 55; i += 1) {
      ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.55})`;
      ctx.fillRect(Math.random() * width, Math.random() * height, 1.3, 1.3);
    }
    ctx.fillStyle = "rgba(138, 144, 158, .28)";
    ctx.font = "13px Manrope, sans-serif";
    ctx.textAlign = "center";
    for (let y = 18; y < height; y += 26) {
      for (let x = (y / 26) % 2 ? 14 : 30; x < width; x += 32) ctx.fillText("♥", x, y);
    }
    ctx.fillStyle = "#6f7582";
    ctx.font = "800 12px Manrope, sans-serif";
    ctx.fillText("SCRATCH HERE ✨", width / 2, height / 2 + 4);
  }

  function setupScratch() {
    if (!scratchCard) return;
    scratchCard.classList.toggle("is-revealed", scratchRevealed);
    scratchSkip.hidden = scratchRevealed;
    if (scratchRevealed) {
      scratchSecret.removeAttribute("aria-hidden");
      return;
    }
    const rect = scratchCard.getBoundingClientRect();
    if (!rect.width) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    foil.width = Math.round(rect.width * dpr);
    foil.height = Math.round(rect.height * dpr);
    foilContext = foil.getContext("2d", { willReadFrequently: true });
    foilContext.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintFoil(rect.width, rect.height);
    strokes = 0;
  }

  function revealScratch(celebrate) {
    if (scratchRevealed) return;
    scratchRevealed = true;
    save(SCRATCH_KEY, "1");
    scratchCard.classList.add("is-revealed");
    scratchSecret.removeAttribute("aria-hidden");
    scratchSkip.hidden = true;
    if (celebrate) {
      window.LetterFX?.burstFrom(scratchCard, 30);
      window.LetterFX?.chime?.();
    }
  }

  function scratchProgress() {
    const { data } = foilContext.getImageData(0, 0, foil.width, foil.height);
    let cleared = 0;
    let sampled = 0;
    for (let i = 3; i < data.length; i += 4 * 23) {
      sampled += 1;
      if (data[i] < 40) cleared += 1;
    }
    return cleared / sampled;
  }

  function scratchAt(event) {
    const rect = foil.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const ctx = foilContext;
    ctx.globalCompositeOperation = "destination-out";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 36;
    ctx.beginPath();
    if (lastPoint) {
      ctx.moveTo(lastPoint.x, lastPoint.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
    } else {
      ctx.arc(point.x, point.y, 18, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPoint = point;
    strokes += 1;
    if (strokes % 6 === 0 && scratchProgress() > 0.5) revealScratch(true);
  }

  if (foil) {
    foil.addEventListener("pointerdown", (event) => {
      if (scratchRevealed || !foilContext) return;
      scratching = true;
      lastPoint = null;
      foil.setPointerCapture(event.pointerId);
      scratchAt(event);
    });
    foil.addEventListener("pointermove", (event) => { if (scratching) scratchAt(event); });
    const stop = () => {
      if (!scratching) return;
      scratching = false;
      lastPoint = null;
      if (!scratchRevealed && scratchProgress() > 0.5) revealScratch(true);
    };
    foil.addEventListener("pointerup", stop);
    foil.addEventListener("pointercancel", stop);
    scratchSkip.addEventListener("click", () => revealScratch(true));
    let resizeTimer = null;
    window.addEventListener("resize", () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { if (window.DateApp?.step === "planned") setupScratch(); }, 200);
    });
  }

  /* ------------------------- Animated signature -------------------------- */
  const signature = $("#signature");
  const signatureText = $("#signature-text");
  const signatureReveal = $("#signature-reveal");
  const signatureSwash = $("#signature-swash");
  let signatureFrame = 0;
  let signatureObserver = null;
  const signedName = (CONFIG.yourName || "").trim() || "Your date";
  if (signature) {
    signatureText.textContent = signedName;
    $("#signature-label").textContent = `See you soon, ${signedName}`;
  }

  function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  }

  async function writeSignature() {
    try { await document.fonts?.load('48px "Great Vibes"'); } catch { /* Falls back to a cursive font. */ }
    signatureText.style.fontSize = "";
    let box = signatureText.getBBox();
    if (box.width > 300) {
      signatureText.style.fontSize = `${Math.floor(48 * 300 / box.width)}px`;
      box = signatureText.getBBox();
    }
    const start = box.x - 8;
    const width = box.width + 16;
    const y = box.y + box.height + 2;
    const sx = box.x + box.width * 0.1;
    const ex = box.x + box.width + 6;
    signatureReveal.setAttribute("x", String(start));
    signatureSwash.setAttribute("d", `M${sx} ${y} C ${sx + (ex - sx) * 0.3} ${y + 11}, ${sx + (ex - sx) * 0.7} ${y - 9}, ${ex} ${y - 3}`);
    const length = signatureSwash.getTotalLength();
    signatureSwash.style.strokeDasharray = String(length);

    if (reduced) {
      signatureReveal.setAttribute("width", String(width));
      signatureSwash.style.strokeDashoffset = "0";
      return;
    }
    const duration = 2600;
    const began = performance.now();
    window.cancelAnimationFrame(signatureFrame);
    const frame = (now) => {
      const t = Math.min(1, (now - began) / duration);
      const write = Math.min(1, t / 0.78);
      const swash = Math.max(0, (t - 0.7) / 0.3);
      signatureReveal.setAttribute("width", String(width * easeInOut(write)));
      signatureSwash.style.strokeDashoffset = String(length * (1 - easeInOut(swash)));
      if (t < 1) signatureFrame = window.requestAnimationFrame(frame);
    };
    signatureFrame = window.requestAnimationFrame(frame);
  }

  function prepareSignature() {
    if (!signature) return;
    window.cancelAnimationFrame(signatureFrame);
    signatureReveal.setAttribute("width", "0");
    signatureSwash.style.strokeDashoffset = "1000";
    signatureObserver?.disconnect();
    // Write it when it scrolls into view, since it sits at the end of the letter.
    signatureObserver = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      signatureObserver.disconnect();
      writeSignature();
    }, { threshold: 0.6 });
    signatureObserver.observe(signature);
  }

  /* ------------------------ Wax seal easter egg -------------------------- */
  const sealStamp = $("#seal-stamp");
  const sealHint = $("#seal-hint");
  const secretCard = $("#secret-card");
  const SECRET_KEY = "date-letter-secret";
  let sealTaps = 0;
  let sealTimer = null;
  if (secretCard) {
    $("#secret-text").textContent = CONFIG.secretMessage || "You found the secret! 🤫";
    secretCard.hidden = stored(SECRET_KEY) !== "1";
  }

  sealStamp?.addEventListener("click", () => {
    sealStamp.classList.remove("is-tapped");
    void sealStamp.offsetWidth;
    sealStamp.classList.add("is-tapped");
    if (!secretCard.hidden) return;
    sealTaps += 1;
    window.clearTimeout(sealTimer);
    sealTimer = window.setTimeout(() => { sealTaps = 0; sealHint.textContent = ""; }, 2200);
    const left = 5 - sealTaps;
    if (left > 0) {
      sealHint.textContent = sealTaps >= 2 ? (left === 1 ? "One more…" : `${left} more…`) : "";
      return;
    }
    sealTaps = 0;
    sealHint.textContent = "";
    secretCard.hidden = false;
    save(SECRET_KEY, "1");
    window.LetterFX?.burstFrom(sealStamp, 30);
    window.LetterFX?.chime?.();
    secretCard.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
    window.DateApp?.notify(`${herName()} found the secret message 🤫`, "She tapped the wax seal 5 times and unlocked it.", ["lock", "sparkles"]);
  });

  /* ------------------------- Home-screen install ------------------------- */
  const installCard = $("#install-card");
  const installButton = $("#install-button");
  const installText = $("#install-text");
  const INSTALL_KEY = "date-letter-install-dismissed";
  const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let installPrompt = null;

  function updateInstallCard() {
    if (!installCard) return;
    installCard.hidden = isStandalone || stored(INSTALL_KEY) === "1" || !(installPrompt || isIOS);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    updateInstallCard();
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    save(INSTALL_KEY, "1");
    updateInstallCard();
  });
  installButton?.addEventListener("click", async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice.catch(() => ({ outcome: "dismissed" }));
      installPrompt = null;
      if (outcome === "accepted") save(INSTALL_KEY, "1");
      updateInstallCard();
      return;
    }
    installText.textContent = "In Safari, tap the Share button, then “Add to Home Screen”.";
    installButton.hidden = true;
  });
  $("#install-dismiss")?.addEventListener("click", () => {
    save(INSTALL_KEY, "1");
    updateInstallCard();
  });

  if ("serviceWorker" in navigator && window.isSecureContext) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* Works fine without offline support. */ });
    });
  }

  /* ------------------------------- Wiring -------------------------------- */
  document.addEventListener("date:plan", (event) => renderWeather(event.detail.plan));
  document.addEventListener("date:step", (event) => {
    if (event.detail.name !== "planned") {
      window.cancelAnimationFrame(signatureFrame);
      signatureObserver?.disconnect();
      return;
    }
    updateInstallCard();
    window.requestAnimationFrame(() => {
      setupScratch();
      prepareSignature();
    });
  });
})();
