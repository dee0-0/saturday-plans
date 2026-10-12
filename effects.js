/*
 * Visual effects for the letter landing and step transitions.
 * - Canvas petals + bokeh (all steps)
 * - Intro choreography, idle float, mouse/gyro parallax (landing)
 * - Envelope opening timeline that can be played (tap) or scrubbed (scroll / swipe)
 * Exposes window.LetterFX for app.js. Everything degrades gracefully without GSAP
 * or when the visitor prefers reduced motion.
 */
(function () {
  "use strict";

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const gsap = window.gsap;
  const ObserverPlugin = window.Observer;
  const gsapLoaded = Boolean(gsap);
  const hasGsap = gsapLoaded && !reduced;
  const root = document.documentElement;

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // GSAP drives the envelope whenever it loaded, even with reduced motion
  // (which gets a calmer opening below), so the CSS fallback stays out of the way.
  if (gsapLoaded) {
    root.classList.add("has-gsap");
    if (ObserverPlugin) gsap.registerPlugin(ObserverPlugin);
  }

  const button = $(".envelope-open");
  const title = $(".letter-title");
  const tapSub = $("#tap-sub");
  const soundToggle = $("#sound-toggle");
  let soundEnabled = true;
  let audioContext = null;
  try {
    const savedSound = window.localStorage.getItem("date-letter-sound");
    if (savedSound !== null) soundEnabled = savedSound === "on";
  } catch { /* Storage may be unavailable in private browsing. */ }

  function updateSoundToggle() {
    if (!soundToggle) return;
    soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    soundToggle.setAttribute("aria-label", soundEnabled ? "Turn sound off" : "Turn sound on");
    const label = $(".sound-toggle-label", soundToggle);
    if (label) label.textContent = soundEnabled ? "Sound on" : "Sound off";
  }

  function playChime(notes) {
    if (!soundEnabled) return;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      if (!audioContext) audioContext = new AudioContext();
      const schedule = () => {
        const startAt = audioContext.currentTime;
        notes.forEach(({ frequency, delay, duration = .28, volume = .025 }) => {
          const oscillator = audioContext.createOscillator();
          const gain = audioContext.createGain();
          const start = startAt + delay;
          oscillator.type = "sine";
          oscillator.frequency.setValueAtTime(frequency, start);
          gain.gain.setValueAtTime(.0001, start);
          gain.gain.exponentialRampToValueAtTime(volume, start + .025);
          gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
          oscillator.connect(gain);
          gain.connect(audioContext.destination);
          oscillator.start(start);
          oscillator.stop(start + duration + .03);
        });
      };
      if (audioContext.state === "suspended") audioContext.resume().then(schedule).catch(() => {});
      else schedule();
    } catch { /* Audio is optional; the invitation still works without it. */ }
  }

  function chimeOpen() {
    playChime([
      { frequency: 523.25, delay: 0, duration: .26 },
      { frequency: 659.25, delay: .12, duration: .34 },
      { frequency: 783.99, delay: .25, duration: .48 }
    ]);
  }

  function chimeSuccess() {
    playChime([
      { frequency: 659.25, delay: 0, duration: .25 },
      { frequency: 783.99, delay: .13, duration: .42 }
    ]);
  }

  // A little tune for the sound-button secret.
  function melody() {
    playChime([
      [783.99, 0], [659.25, .22], [783.99, .44], [1046.5, .66, .5],
      [987.77, 1.08], [880, 1.3], [783.99, 1.52], [659.25, 1.74], [698.46, 1.96], [783.99, 2.18, .9]
    ].map(([frequency, delay, duration = .34]) => ({ frequency, delay, duration, volume: .03 })));
  }

  updateSoundToggle();
  soundToggle?.addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    updateSoundToggle();
    try { window.localStorage.setItem("date-letter-sound", soundEnabled ? "on" : "off"); } catch { /* Ignore unavailable storage. */ }
    if (soundEnabled) playChime([{ frequency: 659.25, delay: 0, duration: .2, volume: .018 }]);
    window.LetterMusic?.setEnabled(soundEnabled);
  });
  const canScrubAtAll = hasGsap && Boolean(ObserverPlugin);
  if (tapSub) {
    tapSub.textContent = coarse ? "or swipe up" : "or scroll down";
    tapSub.hidden = !canScrubAtAll;
  }

  /* ------------------------------------------------------------------ */
  /* Title: split into words/characters for the letter-by-letter reveal */
  /* ------------------------------------------------------------------ */
  const titleChars = [];
  if (title) {
    const words = title.textContent.trim().split(/\s+/);
    title.textContent = "";
    words.forEach((word, index) => {
      const wordEl = document.createElement("span");
      wordEl.className = "word";
      wordEl.setAttribute("aria-hidden", "true");
      for (const character of word) {
        const charEl = document.createElement("span");
        charEl.className = "char";
        charEl.textContent = character;
        wordEl.append(charEl);
        titleChars.push(charEl);
      }
      title.append(wordEl);
      if (index < words.length - 1) title.append(document.createTextNode(" "));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Petal field (canvas)                                                */
  /* ------------------------------------------------------------------ */
  const petals = createPetalField($("#petal-canvas"));

  function createPetalField(canvas) {
    const noop = { burst() {}, gust() {}, setParallax() {} };
    if (!canvas || reduced || !canvas.getContext) return noop;
    const ctx = canvas.getContext("2d");
    if (!ctx) return noop;

    const palette = [
      ["#ffe7ee", "#f4a6b8"],
      ["#fff2f5", "#f0b3c2"],
      ["#ffd8e2", "#e992a9"],
      ["#fff8f2", "#f6c4cf"]
    ];
    const BASE = 64;
    const blurLevels = [0, 1.6, 4.2]; // mid, far, near
    const sprites = palette.map((colors) => blurLevels.map((blur) => makePetalSprite(colors, blur)));
    const bokehSprite = makeBokehSprite();

    function makePetalSprite([light, dark], blur) {
      const pad = Math.ceil(blur * 3) + 2;
      const size = BASE + pad * 2;
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = size;
      const g = sprite.getContext("2d");
      if (blur && "filter" in g) g.filter = `blur(${blur}px)`;
      g.translate(size / 2, size / 2);
      const r = BASE / 2 - 2;
      const gradient = g.createLinearGradient(0, r, 0, -r);
      gradient.addColorStop(0, dark);
      gradient.addColorStop(.55, light);
      gradient.addColorStop(1, light);
      g.fillStyle = gradient;
      g.beginPath();
      g.moveTo(0, r);
      g.bezierCurveTo(r * .78, r * .42, r * .66, -r * .8, r * .14, -r * .96);
      g.quadraticCurveTo(0, -r * .8, -r * .14, -r * .96);
      g.bezierCurveTo(-r * .66, -r * .8, -r * .78, r * .42, 0, r);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,.5)";
      g.lineWidth = 1.1;
      g.beginPath();
      g.moveTo(0, r * .86);
      g.quadraticCurveTo(r * .07, 0, 0, -r * .7);
      g.stroke();
      return { canvas: sprite, scale: size / BASE };
    }

    function makeBokehSprite() {
      const sprite = document.createElement("canvas");
      sprite.width = sprite.height = 64;
      const g = sprite.getContext("2d");
      const gradient = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, "rgba(255,255,255,.95)");
      gradient.addColorStop(.45, "rgba(255,240,245,.5)");
      gradient.addColorStop(1, "rgba(255,240,245,0)");
      g.fillStyle = gradient;
      g.fillRect(0, 0, 64, 64);
      return sprite;
    }

    let width = 0;
    let height = 0;
    let parallaxX = 0;
    let parallaxY = 0;
    let gustVelocity = 0;
    let time = 0;
    let last = performance.now();
    let running = !document.hidden;
    const items = [];
    const bokeh = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(petal, initial) {
      const z = Math.random();
      const layer = z < .32 ? 1 : z > .9 ? 2 : 0;
      petal.z = z;
      petal.size = layer === 1 ? rand(9, 14) : layer === 2 ? rand(34, 52) : rand(15, 24);
      petal.alpha = layer === 1 ? rand(.35, .55) : layer === 2 ? rand(.4, .6) : rand(.7, .95);
      petal.vy = layer === 1 ? rand(16, 28) : layer === 2 ? rand(55, 80) : rand(28, 48);
      petal.vx = rand(-8, 8);
      petal.x = rand(-40, width + 40);
      petal.y = initial ? rand(-height * .2, height) : rand(-140, -50);
      petal.rot = rand(0, Math.PI * 2);
      petal.vr = rand(-1.1, 1.1);
      petal.flip = rand(0, Math.PI * 2);
      petal.vf = rand(1, 2.6);
      petal.sway = rand(12, 34);
      petal.swayF = rand(.5, 1.3);
      petal.phase = rand(0, Math.PI * 2);
      petal.sprite = sprites[(Math.random() * palette.length) | 0][layer];
      petal.temp = false;
      petal.gravity = 0;
      return petal;
    }

    function populate() {
      const target = Math.round(clamp((width * height) / 36000, 18, 36));
      while (items.filter((p) => !p.temp).length < target) items.push(spawn({}, true));
      const bokehTarget = width > 720 ? 12 : 8;
      while (bokeh.length < bokehTarget) {
        bokeh.push({
          x: rand(0, width), y: rand(0, height), r: rand(8, 34), z: Math.random(),
          vy: -rand(3, 9), a: rand(.12, .32), tw: rand(.4, 1.1), phase: rand(0, Math.PI * 2)
        });
      }
    }

    function frame(now) {
      if (!running) return;
      const dt = Math.min(.05, (now - last) / 1000);
      last = now;
      time += dt;
      gustVelocity *= Math.pow(.3, dt);
      const wind = Math.sin(time * .23) * 14 + Math.sin(time * .61) * 6 + gustVelocity;

      ctx.clearRect(0, 0, width, height);

      for (const b of bokeh) {
        b.y += b.vy * dt;
        b.x += Math.sin(time * .2 + b.phase) * 4 * dt;
        if (b.y < -b.r * 2) { b.y = height + b.r * 2; b.x = rand(0, width); }
        ctx.globalAlpha = b.a * (.6 + .4 * Math.sin(time * b.tw + b.phase));
        const ox = -parallaxX * 10 * b.z;
        const oy = -parallaxY * 8 * b.z;
        ctx.drawImage(bokehSprite, b.x + ox - b.r, b.y + oy - b.r, b.r * 2, b.r * 2);
      }

      for (let i = items.length - 1; i >= 0; i -= 1) {
        const p = items[i];
        if (p.temp) {
          p.vy = Math.min(p.vy + p.gravity * dt, 95);
          p.vx *= Math.pow(.55, dt);
        }
        p.y += p.vy * dt;
        p.x += (p.vx + wind * (.4 + p.z) + Math.sin(time * p.swayF + p.phase) * p.sway) * dt;
        p.rot += p.vr * dt;
        p.flip += p.vf * dt;
        if (p.y > height + 80 || p.x < -160 || p.x > width + 160) {
          if (p.temp) { items.splice(i, 1); continue; }
          spawn(p, false);
        }
        const ox = parallaxX * (p.z - .5) * 40;
        const oy = parallaxY * (p.z - .5) * 24;
        const size = p.size * p.sprite.scale;
        const flip = Math.cos(p.flip);
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x + ox, p.y + oy);
        ctx.rotate(p.rot);
        ctx.scale(Math.abs(flip) < .14 ? .14 * (flip < 0 ? -1 : 1) : flip, 1);
        ctx.drawImage(p.sprite.canvas, -size / 2, -size / 2, size, size);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      window.requestAnimationFrame(frame);
    }

    resize();
    populate();
    window.addEventListener("resize", () => { resize(); populate(); }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      running = !document.hidden;
      if (running) { last = performance.now(); window.requestAnimationFrame(frame); }
    });
    if (running) window.requestAnimationFrame(frame);

    return {
      burst(x, y, count = 24, spread = 1) {
        for (let i = 0; i < count; i += 1) {
          const petal = spawn({}, false);
          const layer = Math.random() < .2 ? 2 : 0;
          petal.sprite = sprites[(Math.random() * palette.length) | 0][layer];
          petal.size = layer === 2 ? rand(28, 40) : rand(14, 24);
          petal.alpha = rand(.75, .95);
          petal.temp = true;
          petal.x = x + rand(-24, 24);
          petal.y = y + rand(-10, 10);
          const angle = rand(-Math.PI * .92, -Math.PI * .08);
          const speed = rand(170, 430) * spread;
          petal.vx = Math.cos(angle) * speed;
          petal.vy = Math.sin(angle) * speed;
          petal.gravity = rand(240, 340);
          petal.vr = rand(-5, 5);
          petal.vf = rand(3, 7);
          petal.sway = rand(4, 14);
          items.push(petal);
        }
      },
      gust(amount) { gustVelocity = clamp(gustVelocity + amount, -160, 160); },
      setParallax(x, y) { parallaxX = x; parallaxY = y; }
    };
  }

  // Petals burst out of an element and briefly fly in front of the card.
  let frontTimer = null;
  function burstFrom(element, count = 26) {
    const rect = element?.getBoundingClientRect();
    if (!rect) return;
    document.body.classList.add("petals-in-front");
    window.clearTimeout(frontTimer);
    frontTimer = window.setTimeout(() => document.body.classList.remove("petals-in-front"), 2300);
    petals.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, count);
    petals.gust(50);
  }

  // Petals thrown across the whole screen, in front of the card (the shake secret).
  function scatter(count = 42) {
    document.body.classList.add("petals-in-front");
    window.clearTimeout(frontTimer);
    frontTimer = window.setTimeout(() => document.body.classList.remove("petals-in-front"), 2300);
    [0.2, 0.5, 0.8].forEach((x) => petals.burst(window.innerWidth * x, window.innerHeight * 0.5, Math.round(count / 3), 1.1));
    petals.gust(80);
  }

  /* ------------------------------------------------------------------ */
  /* No GSAP / reduced motion: expose a minimal API and stop here       */
  /* ------------------------------------------------------------------ */
  if (!hasGsap || !button) {
    root.classList.remove("intro-pending");
    let burstTimer = null;
    function fallbackBurst() {
      if (reduced) return;
      const envelope = $(".envelope-parallax");
      const rect = envelope?.getBoundingClientRect();
      if (!rect) return;
      document.body.classList.add("petals-in-front");
      petals.burst(rect.left + rect.width / 2, rect.top + rect.height * .24, 30, 1.05);
      petals.gust(72);
      window.clearTimeout(burstTimer);
      burstTimer = window.setTimeout(() => document.body.classList.remove("petals-in-front"), 2300);
    }

    // Reduced motion: the opening is user-triggered and is the whole point of the
    // page, so it still plays, but short and flat (no parallax, zoom or petals).
    function createCalmOpen() {
      const flap = $(".env-flap");
      gsap.set(flap, { transformPerspective: 1100, transformOrigin: "50% 0%", rotationX: 0 });
      const tl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut" } })
        .to([".tap-cue", ".wax-seal", ".env-peek"], { opacity: 0, duration: .25 }, 0)
        .to(flap, { rotationX: 180, duration: .6 }, .15)
        .set(flap, { zIndex: 2 }, .45)
        .set(".env-flap-face", { backgroundImage: "linear-gradient(0deg, #e6a0b0 0%, #eeb0be 70%, #f2bbc6 100%)" }, .45)
        .to(".env-letter", { yPercent: -40, duration: .6, ease: "power2.out" }, .55)
        .to([".intro-head", ".envelope-parallax"], { opacity: 0, duration: .35 }, 1.2);
      return {
        play: () => new Promise((resolve) => {
          tl.eventCallback("onComplete", () => {
            tl.eventCallback("onComplete", null);
            resolve();
          });
          tl.restart();
        }),
        reset: () => {
          tl.eventCallback("onComplete", null);
          tl.pause(0);
        }
      };
    }

    const calm = gsapLoaded && button ? createCalmOpen() : null;
    window.LetterFX = {
      open() {
        chimeOpen();
        if (calm) return calm.play();
        fallbackBurst();
        return new Promise((resolve) => window.setTimeout(resolve, reduced ? 0 : 820));
      },
      reset() { calm?.reset(); },
      enterStep(stepEl, name, previous) { if (name === "intro" && previous) calm?.reset(); },
      celebrate() {
        chimeSuccess();
        fallbackBurst();
      },
      chime: chimeSuccess,
      melody,
      burstFrom,
      scatter,
      burst(x, y, count = 24) { petals.burst(x, y, count); }
    };
    return;
  }

  /* ------------------------------------------------------------------ */
  /* Elements                                                            */
  /* ------------------------------------------------------------------ */
  const head = $(".intro-head");
  const cue = $(".tap-cue");
  const parallaxEl = $(".envelope-parallax");
  const stage = $(".envelope-stage");
  const floatEl = $(".envelope-float");
  const envShadow = $(".env-shadow");
  const back = $(".env-back");
  const letter = $(".env-letter");
  const pocket = $(".env-pocket");
  const peek = $(".env-peek");
  const flap = $(".env-flap");
  const flapFace = $(".env-flap-face");
  const seal = $(".wax-seal");
  const bg = $(".letter-bg");
  const bgImg = $(".letter-bg img");
  const card = $("#question-card");

  gsap.set(flap, { transformPerspective: 1100, transformOrigin: "50% 0%" });
  gsap.set(parallaxEl, { transformPerspective: 900 });

  /* ------------------------------------------------------------------ */
  /* Background: slow Ken Burns                                          */
  /* ------------------------------------------------------------------ */
  if (bgImg) {
    gsap.fromTo(bgImg, { scale: 1.16 }, {
      scale: 1.03,
      duration: 3.4,
      ease: "power2.out",
      onComplete() {
        gsap.to(bgImg, { scale: 1.1, duration: 18, ease: "sine.inOut", yoyo: true, repeat: -1 });
      }
    });
  }

  /* ------------------------------------------------------------------ */
  /* Intro entrance + idle life                                          */
  /* ------------------------------------------------------------------ */
  function playIntro(first) {
    const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
    tl.fromTo(titleChars,
      { opacity: 0, yPercent: 70, rotation: 8, filter: "blur(6px)" },
      { opacity: 1, yPercent: 0, rotation: 0, filter: "blur(0px)", duration: 1.05, stagger: .045 },
      first ? .3 : 0)
      .fromTo(".ornament-line", { scaleX: 0 }, { scaleX: 1, duration: 1.1, ease: "power2.inOut" }, "-=.75")
      .fromTo(".ornament-flower", { scale: 0, rotation: -120, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: .9, ease: "back.out(2.2)" }, "<.15")
      .fromTo(stage,
        { y: -70, opacity: 0, rotation: -5, scale: .9 },
        { y: 0, opacity: 1, rotation: 0, scale: 1, duration: 1.35, ease: "back.out(1.5)" },
        first ? .65 : .1)
      .fromTo(".tap-cue > *", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: .8, stagger: .12 }, "-=.55");
    return tl;
  }

  const floatTl = gsap.timeline({ repeat: -1, yoyo: true, defaults: { ease: "sine.inOut", duration: 2.8 } });
  floatTl.to(floatEl, { y: -9, rotation: .8 }, 0).to(envShadow, { scaleX: .86, scaleY: .8 }, 0);

  playIntro(true);
  root.classList.remove("intro-pending");

  /* ------------------------------------------------------------------ */
  /* Parallax: mouse on desktop, device tilt on phones                   */
  /* ------------------------------------------------------------------ */
  const quick = (el, prop) => gsap.quickTo(el, prop, { duration: .9, ease: "power3.out" });
  const bgX = quick(bg, "x");
  const bgY = quick(bg, "y");
  const headX = quick(head, "x");
  const parX = quick(parallaxEl, "x");
  const parY = quick(parallaxEl, "y");
  const parRX = quick(parallaxEl, "rotationX");
  const parRY = quick(parallaxEl, "rotationY");

  function setTilt(nx, ny) {
    if (!document.body.classList.contains("is-envelope-landing")) { petals.setParallax(nx * .5, ny * .5); return; }
    bgX(-nx * 16);
    bgY(-ny * 12);
    headX(nx * 7);
    parX(nx * 12);
    parY(ny * 8);
    parRY(nx * 8);
    parRX(-ny * 6);
    petals.setParallax(nx, ny);
  }

  if (!coarse) {
    window.addEventListener("pointermove", (event) => {
      setTilt((event.clientX / window.innerWidth) * 2 - 1, (event.clientY / window.innerHeight) * 2 - 1);
    }, { passive: true });
    document.addEventListener("pointerleave", () => setTilt(0, 0));
  }
  window.addEventListener("deviceorientation", (event) => {
    if (event.gamma == null || event.beta == null) return;
    setTilt(clamp(event.gamma / 25, -1, 1), clamp((event.beta - 45) / 25, -1, 1));
  }, { passive: true });

  /* ------------------------------------------------------------------ */
  /* Opening timeline (scrubbable) + finish (fly into the question card) */
  /* ------------------------------------------------------------------ */
  const openTl = gsap.timeline({ paused: true, defaults: { ease: "power2.inOut" } });
  openTl
    .to(cue, { opacity: 0, y: 14, duration: .35, ease: "power1.in" }, 0)
    .to(seal, { scale: 1.18, duration: .18, ease: "power2.out" }, 0)
    .to(seal, { scale: .35, opacity: 0, rotation: -40, y: -18, duration: .34, ease: "power2.in" }, .18)
    .to(peek, { yPercent: 22, opacity: 0, duration: .35 }, .1)
    .to(flap, { rotationX: 180, duration: .72, ease: "power2.inOut" }, .3)
    .set(flap, { zIndex: 2 }, .66)
    .set(flapFace, { backgroundImage: "linear-gradient(0deg, #e6a0b0 0%, #eeb0be 70%, #f2bbc6 100%)" }, .66)
    .to(head, { opacity: 0, yPercent: -30, duration: .6, ease: "power2.in" }, .6)
    .to(letter, { yPercent: -62, duration: .9, ease: "power3.out" }, .86);

  const finishTl = gsap.timeline({ paused: true });
  finishTl
    .to([back, pocket, flap, peek], { y: 70, opacity: 0, duration: .55, ease: "power2.in" }, 0)
    .to(envShadow, { opacity: 0, duration: .4 }, 0)
    .to(letter, { scale: 1.12, duration: .45, ease: "power2.out" }, 0)
    .to(letter, { scale: 1.7, opacity: 0, filter: "blur(5px)", duration: .45, ease: "power2.in" }, .4);

  let committing = false;
  let scrubTarget = 0;
  let didDrag = false;
  let dragDistance = 0;

  function burstFromEnvelope(count = 22) {
    const rect = parallaxEl.getBoundingClientRect();
    petals.burst(rect.left + rect.width / 2, rect.top + rect.height * .25, count);
    petals.gust(60);
  }

  function open() {
    committing = true;
    chimeOpen();
    document.body.classList.add("petals-in-front");
    window.setTimeout(() => document.body.classList.remove("petals-in-front"), 2300);
    observer?.disable();
    gsap.killTweensOf(openTl);
    floatTl.pause();
    const speed = 1.15;
    const untilBurst = Math.max(0, (.95 - openTl.time()) / speed);
    gsap.delayedCall(untilBurst, () => burstFromEnvelope());
    return new Promise((resolve) => {
      const finish = () => {
        finishTl.eventCallback("onComplete", () => {
          finishTl.eventCallback("onComplete", null);
          resolve();
        });
        finishTl.restart();
      };
      if (openTl.progress() >= .999) {
        finish();
        return;
      }
      openTl.eventCallback("onComplete", () => {
        openTl.eventCallback("onComplete", null);
        finish();
      });
      openTl.timeScale(speed).play();
    });
  }

  function reset() {
    committing = false;
    scrubTarget = 0;
    didDrag = false;
    gsap.killTweensOf(openTl);
    openTl.eventCallback("onComplete", null);
    finishTl.eventCallback("onComplete", null);
    finishTl.pause(0);
    openTl.timeScale(1).pause(0);
    floatTl.play();
    playIntro(false);
    observer?.enable();
  }

  /* ------------------------------------------------------------------ */
  /* Scroll / swipe to open                                              */
  /* ------------------------------------------------------------------ */
  function canScrub() {
    return document.body.classList.contains("is-envelope-landing") && !button.disabled && !committing;
  }

  function scrubTo(target) {
    scrubTarget = clamp(target, 0, 1);
    gsap.to(openTl, { progress: scrubTarget, duration: .5, ease: "power3.out", overwrite: true });
  }

  function nudge(delta) {
    if (!canScrub()) return;
    scrubTo(scrubTarget + delta);
    petals.gust(delta * 220);
    if (scrubTarget >= .98) commit();
  }

  function settle() {
    if (!canScrub() || scrubTarget <= 0) return;
    if (scrubTarget > .42) commit();
    else scrubTo(0);
  }

  function commit() {
    if (committing) return;
    button.dispatchEvent(new CustomEvent("letter:open-request", { bubbles: true }));
  }

  const observer = canScrubAtAll ? ObserverPlugin.create({
    target: window,
    type: "wheel,touch,pointer",
    dragMinimum: 6,
    tolerance: 4,
    onPress() { didDrag = false; dragDistance = 0; },
    onDrag(self) {
      if (!canScrub()) return;
      // A finger tap usually wobbles a few pixels; only a real swipe should scrub
      // (and then swallow the click), otherwise taps on phones get eaten.
      dragDistance += Math.abs(self.deltaY);
      if (dragDistance < 18) return;
      didDrag = true;
      nudge(-self.deltaY / 280);
    },
    onWheel(self) { nudge(self.deltaY / 750); },
    onDragEnd: settle,
    onStop(self) { if (!self.isPressed) settle(); }
  }) : null;

  // A drag that ends over the envelope shouldn't also count as a tap.
  button.addEventListener("click", (event) => {
    if (!didDrag) return;
    didDrag = false;
    event.stopPropagation();
    event.preventDefault();
  }, true);

  /* ------------------------------------------------------------------ */
  /* Step transitions                                                    */
  /* ------------------------------------------------------------------ */
  function enterStep(stepEl, name, previous) {
    if (!stepEl || name === previous) return;
    if (name === "intro") {
      reset();
      return;
    }
    observer?.disable();
    if (previous === "intro" || !previous) {
      gsap.fromTo(card, { opacity: 0, y: 40, scale: .94 }, { opacity: 1, y: 0, scale: 1, duration: .85, ease: "power3.out", clearProps: "opacity,transform" });
    }
    const direction = stepEl.classList.contains("enter-backward") ? -1 : 1;
    const parts = [];
    [...stepEl.children].forEach((child) => {
      if (child.hidden || window.getComputedStyle(child).display === "none") return;
      if (child.classList.contains("choices")) parts.push(...child.children);
      else parts.push(child);
    });
    gsap.fromTo(stepEl, { opacity: 0, x: 18 * direction }, { opacity: 1, x: 0, duration: .45, ease: "power3.out", clearProps: "opacity,transform" });
    gsap.fromTo(parts, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: .55, stagger: .045, delay: .06, ease: "power3.out", clearProps: "opacity,transform" });
  }

  function celebrate() {
    chimeSuccess();
    petals.burst(window.innerWidth / 2, window.innerHeight * .38, 46, 1.2);
    petals.gust(90);
  }

  window.LetterFX = {
    open,
    reset,
    enterStep,
    celebrate,
    chime: chimeSuccess,
    melody,
    burstFrom,
    scatter,
    burst: (x, y, n) => petals.burst(x, y, n)
  };
})();
