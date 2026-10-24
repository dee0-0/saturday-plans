/*
 * How many? Tap Start and a picture (sweets in a jar, hearts in a box, stars in the
 * sky…) shows for 5 seconds, then it's gone: guess how many things were in it. The
 * Worker sends the drawing only for those 5 seconds and after your guess (where every
 * item goes); this page paints it on a canvas, sharp on Retina. Closest guess wins.
 * Looks from match.css + quick.css + arcade.css.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="count"]');
  if (!section) return;

  const ledeEl = $("#count-lede");
  const statusEl = $("#count-status");
  const introEl = $("#count-intro");
  const todayEl = $("#count-today");
  const startButton = $("#count-start");
  const timerEl = $("#count-timer");
  const timerBar = $("#count-timer-bar");
  const timerText = $("#count-timer-text");
  const resultEl = $("#count-result");
  const frameEl = $("#count-frame");
  const canvas = $("#count-canvas");
  const tallyEl = $("#count-tally");
  const form = $("#count-form");
  const questionEl = $("#count-question");
  const input = $("#count-guess");
  const sendButton = $("#count-send");
  const errorEl = $("#count-error");
  const retryButton = $("#count-retry");
  const statsEl = $("#count-stats");

  const POLL_MS = 12000;
  const LEDE = "A picture shows for 5 seconds. Guess how many. Closest guess wins.";
  // Where the "87 sweets" tally sits on the answer picture: a corner with no items.
  const TOP_TALLY = ["sweets", "hearts", "sheep"];
  const KIND_ICONS = { sweets: "candy", hearts: "heart", stars: "star", balloons: "balloon", dots: "circle-dot", sheep: "fence", fish: "fish" };
  const DRAFT_KEY = new URLSearchParams(window.location.search).has("preview") ? "date-letter-count-draft-preview" : "date-letter-count-draft";

  let data = null;
  let showing = false;
  let saving = false;
  let frame = 0;
  let showTimer = 0;
  let revealFrame = 0;
  let revealedDay = "";
  let onCanvas = null;   // { scene, shown } what the canvas holds (redrawn on resize)
  let formDay = "";
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let resizeTimer = 0;
  let drawn = { today: "", result: "", stats: "" };

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const ICON_NAME = /^[a-z0-9-]{1,40}$/;
  const iconHtml = (name, fallback = "image") => `<i class="icon" data-lucide="${ICON_NAME.test(name || "") ? name : fallback}" aria-hidden="true"></i>`;
  const games = () => window.DateGames || null;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  function saveDraft() {
    try { window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ day: data?.day, author: me(), guess: input.value })); } catch { /* Optional. */ }
  }

  function readDraft() {
    try {
      const draft = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY) || "null");
      return draft && draft.day === data?.day && draft.author === me() && typeof draft.guess === "string" ? draft.guess : "";
    } catch { return ""; }
  }

  function clearDraft() {
    try { window.sessionStorage.removeItem(DRAFT_KEY); } catch { /* Optional. */ }
  }

  /* ------------------------------ Painting -------------------------------- */
  // A 1000 x 1000 scene. Where the items go comes from the Worker (worker/src/games/count.js
  // places them inside the shapes drawn here, so keep the two in step).
  const SIZE = 1000;
  const TAU = Math.PI * 2;

  function random(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let value = state;
      value = Math.imul(value ^ (value >>> 15), value | 1);
      value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
      return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
  }

  // A colour mixed toward white (amount > 0) or black (amount < 0), optionally see-through.
  function tint(hex, amount, alpha = 1) {
    const value = parseInt(hex.slice(1), 16);
    const target = amount > 0 ? 255 : 0;
    const k = Math.abs(amount);
    const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((part) => Math.round(part + (target - part) * k));
    return alpha === 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${alpha})`;
  }

  function vertical(ctx, top, bottom, stops) {
    const gradient = ctx.createLinearGradient(0, top, 0, bottom);
    stops.forEach(([at, colour]) => gradient.addColorStop(at, colour));
    return gradient;
  }

  function glow(ctx, x, y, r, colour) {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, colour);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function circle(ctx, x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
  }

  // A heart around (0, 0), about 2s wide.
  function heartPath(ctx, s) {
    ctx.beginPath();
    ctx.moveTo(0, -0.42 * s);
    ctx.bezierCurveTo(-0.16 * s, -0.86 * s, -0.98 * s, -0.8 * s, -0.98 * s, -0.2 * s);
    ctx.bezierCurveTo(-0.98 * s, 0.22 * s, -0.5 * s, 0.5 * s, 0, 0.88 * s);
    ctx.bezierCurveTo(0.5 * s, 0.5 * s, 0.98 * s, 0.22 * s, 0.98 * s, -0.2 * s);
    ctx.bezierCurveTo(0.98 * s, -0.8 * s, 0.16 * s, -0.86 * s, 0, -0.42 * s);
    ctx.closePath();
  }

  function heart(ctx, x, y, s, angle, colour) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    heartPath(ctx, s);
    ctx.fillStyle = vertical(ctx, -0.8 * s, 0.9 * s, [[0, tint(colour, 0.38)], [0.5, colour], [1, tint(colour, -0.2)]]);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.lineWidth = Math.max(1.5, s * 0.05);
    ctx.strokeStyle = tint(colour, -0.4, 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-0.47 * s, -0.36 * s, 0.21 * s, 0.12 * s, -0.75, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,.72)";
    ctx.fill();
    ctx.restore();
  }

  function bow(ctx, x, y, s, colour) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = colour;
    ctx.strokeStyle = tint(colour, -0.3, 0.7);
    ctx.lineWidth = 2.5;
    ctx.lineJoin = "round";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 3, 4);
      ctx.lineTo(side * 22, 44);
      ctx.lineTo(side * 13, 40);
      ctx.lineTo(side * 9, 50);
      ctx.lineTo(side * -3, 8);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(side * 24, -3, 25, 14, side * 0.32, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(side * 22, -4, 12, 5, side * 0.32, 0, TAU);
      ctx.fillStyle = tint(colour, -0.25, 0.55);
      ctx.fill();
      ctx.fillStyle = colour;
    }
    circle(ctx, 0, 0, 9);
    ctx.fillStyle = tint(colour, 0.2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /* Sweets in a jar */
  const SWEETS = ["#ff5d73", "#ff9f43", "#ffd447", "#5fd38d", "#4cc3f0", "#a77bf3", "#ff8cc6"];
  const CLOTHS = ["#e8486e", "#7d62e6", "#26a77f"];

  function jarOutline(ctx) {
    ctx.beginPath();
    ctx.moveTo(306, 238);
    ctx.lineTo(306, 262);
    ctx.quadraticCurveTo(212, 272, 212, 364);
    ctx.lineTo(212, 828);
    ctx.quadraticCurveTo(212, 904, 288, 904);
    ctx.lineTo(712, 904);
    ctx.quadraticCurveTo(788, 904, 788, 828);
    ctx.lineTo(788, 364);
    ctx.quadraticCurveTo(788, 272, 694, 262);
    ctx.lineTo(694, 238);
    ctx.closePath();
  }

  function jarInside(ctx) {
    ctx.beginPath();
    ctx.moveTo(318, 254);
    ctx.quadraticCurveTo(229, 284, 229, 372);
    ctx.lineTo(229, 828);
    ctx.quadraticCurveTo(229, 887, 288, 887);
    ctx.lineTo(712, 887);
    ctx.quadraticCurveTo(771, 887, 771, 828);
    ctx.lineTo(771, 372);
    ctx.quadraticCurveTo(771, 284, 682, 254);
    ctx.closePath();
  }

  function sweet(ctx, x, y, r, colour) {
    const gradient = ctx.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.08, x, y, r);
    gradient.addColorStop(0, tint(colour, 0.62));
    gradient.addColorStop(0.42, colour);
    gradient.addColorStop(1, tint(colour, -0.24));
    circle(ctx, x, y, r);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.lineWidth = Math.max(1.6, r * 0.055);
    ctx.strokeStyle = tint(colour, -0.42, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x - r * 0.36, y - r * 0.44, r * 0.27, r * 0.15, -0.6, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,.8)";
    ctx.fill();
  }

  function paintSweets(ctx, items, seed, shown, unit) {
    const rand = random(seed);
    const cloth = CLOTHS[Math.floor(rand() * CLOTHS.length)];
    ctx.fillStyle = vertical(ctx, 0, SIZE, [[0, "#fff7fa"], [0.75, "#fde6ee"], [1, "#fbdbe6"]]);
    ctx.fillRect(0, 0, SIZE, SIZE);
    glow(ctx, 210, 150, 560, "rgba(255,255,255,.8)");
    // The table and the jar's soft shadow on it.
    ctx.fillStyle = vertical(ctx, 872, SIZE, [[0, "#f7d4bf"], [1, "#efbc9d"]]);
    ctx.fillRect(0, 872, SIZE, SIZE - 872);
    ctx.fillStyle = "rgba(255,255,255,.6)";
    ctx.fillRect(0, 872, SIZE, 5);
    ctx.save();
    ctx.translate(500, 908);
    ctx.scale(1, 0.085);
    glow(ctx, 0, 0, 360, "rgba(150,70,60,.32)");
    ctx.restore();
    // The glass at the back, then the sweets inside it.
    jarOutline(ctx);
    ctx.fillStyle = "rgba(255,255,255,.45)";
    ctx.fill();
    ctx.save();
    jarInside(ctx);
    ctx.clip();
    ctx.fillStyle = "rgba(210,234,246,.32)";
    ctx.fillRect(200, 240, 600, 660);
    for (const [x, y, r, , c] of items.slice(0, shown)) sweet(ctx, x, y, r, SWEETS[c % SWEETS.length]);
    ctx.restore();
    // The glass in front: a sheen, the outline and a few bright reflections.
    jarOutline(ctx);
    const sheen = ctx.createLinearGradient(212, 0, 788, 0);
    sheen.addColorStop(0, "rgba(255,255,255,.26)");
    sheen.addColorStop(0.2, "rgba(255,255,255,.05)");
    sheen.addColorStop(0.82, "rgba(255,255,255,0)");
    sheen.addColorStop(1, "rgba(255,255,255,.18)");
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.lineJoin = "round";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "rgba(140,174,196,.9)";
    ctx.stroke();
    jarInside(ctx);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,.8)";
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.55)";
    roundedRect(ctx, 248, 400, 22, 330, 11);
    ctx.fill();
    roundedRect(ctx, 250, 752, 18, 44, 9);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.35)";
    roundedRect(ctx, 738, 420, 12, 170, 6);
    ctx.fill();
    // The rim and a gingham cloth over the lid, tied with a ribbon.
    roundedRect(ctx, 292, 214, 416, 46, 16);
    ctx.fillStyle = vertical(ctx, 214, 260, [[0, "#f6fbff"], [1, "#d4e6f1"]]);
    ctx.fill();
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(140,174,196,.9)";
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(280, 222);
    ctx.bezierCurveTo(280, 136, 720, 136, 720, 222);
    ctx.lineTo(736, 246);
    for (let index = 0; index < 8; index += 1) {
      const x = 736 - index * 59;
      ctx.quadraticCurveTo(x - 29.5, 272, x - 59, 246);
    }
    ctx.closePath();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#fff";
    ctx.fillRect(260, 120, 490, 160);
    ctx.fillStyle = tint(cloth, 0, 0.4);
    for (let x = 262; x < 750; x += 36) ctx.fillRect(x, 120, 18, 160);
    for (let y = 132; y < 280; y += 36) ctx.fillRect(260, y, 490, 18);
    ctx.fillStyle = vertical(ctx, 150, 272, [[0, "rgba(255,255,255,.25)"], [1, "rgba(90,20,40,.18)"]]);
    ctx.fillRect(260, 120, 490, 160);
    ctx.restore();
    ctx.lineWidth = 4;
    ctx.strokeStyle = tint(cloth, -0.2, 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(284, 226);
    ctx.quadraticCurveTo(500, 240, 716, 226);
    ctx.lineWidth = 14;
    ctx.strokeStyle = cloth;
    ctx.stroke();
    bow(ctx, 372, 234, 1.15, cloth);
  }

  /* Hearts in a box */
  const HEARTS = ["#e8304f", "#ff6b8b", "#ff9ab8", "#b86bf5", "#ffab61", "#ff4fa3"];

  function paintHearts(ctx, items, seed, shown, unit) {
    const rand = random(seed);
    ctx.fillStyle = vertical(ctx, 0, SIZE, [[0, "#f8eeff"], [1, "#ffe6ef"]]);
    ctx.fillRect(0, 0, SIZE, SIZE);
    glow(ctx, 760, 120, 520, "rgba(255,255,255,.7)");
    // The box with its shadow, the rim, then the tissue paper inside.
    ctx.save();
    ctx.shadowColor = "rgba(120,40,80,.3)";
    ctx.shadowBlur = 40 * unit;
    ctx.shadowOffsetY = 16 * unit;
    roundedRect(ctx, 96, 200, 808, 728, 46);
    ctx.fillStyle = "#e0538a";
    ctx.fill();
    ctx.restore();
    roundedRect(ctx, 96, 200, 808, 728, 46);
    ctx.fillStyle = vertical(ctx, 200, 928, [[0, "#ff94b7"], [1, "#e9588d"]]);
    ctx.fill();
    roundedRect(ctx, 104, 206, 792, 714, 40);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,255,255,.45)";
    ctx.stroke();
    roundedRect(ctx, 130, 234, 740, 660, 26);
    const floor = ctx.createRadialGradient(500, 540, 40, 500, 560, 520);
    floor.addColorStop(0, "#fff3f7");
    floor.addColorStop(1, "#ffd0df");
    ctx.fillStyle = floor;
    ctx.fill();
    ctx.save();
    roundedRect(ctx, 130, 234, 740, 660, 26);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,.6)";
    ctx.lineWidth = 3;
    for (let index = 0; index < 14; index += 1) {
      const x = 140 + rand() * 720;
      const y = 250 + rand() * 630;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + 40 + rand() * 60, y - 30 + rand() * 60, x + 90 + rand() * 90, y - 20 + rand() * 40);
      ctx.stroke();
    }
    // A soft shadow under the rim (inside the box).
    ctx.shadowColor = "rgba(150,40,80,.38)";
    ctx.shadowBlur = 26 * unit;
    ctx.shadowOffsetY = 10 * unit;
    roundedRect(ctx, 110, 214, 780, 700, 42);
    ctx.lineWidth = 40;
    ctx.strokeStyle = "#e9588d";
    ctx.stroke();
    ctx.restore();
    ctx.save();
    roundedRect(ctx, 130, 234, 740, 660, 26);
    ctx.clip();
    ctx.shadowColor = "rgba(140,30,70,.3)";
    ctx.shadowBlur = 8 * unit;
    ctx.shadowOffsetY = 3 * unit;
    for (const [x, y, s, a, c] of items.slice(0, shown)) heart(ctx, x, y, s, a, HEARTS[c % HEARTS.length]);
    ctx.restore();
    // A ribbon bow on the rim.
    ctx.save();
    ctx.shadowColor = "rgba(120,40,80,.25)";
    ctx.shadowBlur = 10 * unit;
    ctx.shadowOffsetY = 4 * unit;
    bow(ctx, 500, 196, 1.6, "#f7c948");
    ctx.restore();
  }

  /* Stars in the sky */
  const STARS = ["#ffe27a", "#fff3b8", "#ffd6ec", "#d6ecff", "#ffc85c"];

  function star(ctx, x, y, s, angle, colour) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.beginPath();
    for (let index = 0; index < 10; index += 1) {
      const r = index % 2 ? s * 0.47 : s;
      const t = -Math.PI / 2 + (index * Math.PI) / 5;
      ctx.lineTo(Math.cos(t) * r, Math.sin(t) * r);
    }
    ctx.closePath();
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, s);
    gradient.addColorStop(0, "#fffdf3");
    gradient.addColorStop(0.5, colour);
    gradient.addColorStop(1, tint(colour, -0.08));
    ctx.lineJoin = "round";
    ctx.lineWidth = s * 0.2;
    ctx.strokeStyle = colour;
    ctx.stroke();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  function hills(ctx, base, height, rand, colour) {
    const a = rand() * TAU;
    const b = rand() * TAU;
    ctx.beginPath();
    ctx.moveTo(0, SIZE);
    for (let x = 0; x <= SIZE; x += 20) ctx.lineTo(x, base + Math.sin(x / 170 + a) * height + Math.sin(x / 64 + b) * height * 0.3);
    ctx.lineTo(SIZE, SIZE);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    return (x) => base + Math.sin(x / 170 + a) * height + Math.sin(x / 64 + b) * height * 0.3;
  }

  function paintStars(ctx, items, seed, shown, unit) {
    const rand = random(seed);
    ctx.fillStyle = vertical(ctx, 0, SIZE, [[0, "#121845"], [0.5, "#272461"], [0.82, "#4a3474"], [1, "#6a4580"]]);
    ctx.fillRect(0, 0, SIZE, SIZE);
    glow(ctx, 200 + rand() * 600, 300 + rand() * 300, 420, "rgba(255,120,190,.13)");
    glow(ctx, 200 + rand() * 600, 200 + rand() * 300, 380, "rgba(110,150,255,.13)");
    // The moon (on the side the Worker keeps free of stars).
    const left = seed % 2 === 1;
    const mx = left ? 170 : 830;
    const my = 150;
    glow(ctx, mx, my, 230, "rgba(255,236,190,.3)");
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, SIZE, SIZE);
    ctx.moveTo(mx + (left ? 34 : -34) + 62, my - 20);
    ctx.arc(mx + (left ? 34 : -34), my - 20, 62, 0, TAU);
    ctx.clip("evenodd");
    circle(ctx, mx, my, 72);
    const moon = ctx.createRadialGradient(mx - 22, my - 22, 6, mx, my, 72);
    moon.addColorStop(0, "#fffcec");
    moon.addColorStop(1, "#ffe39a");
    ctx.fillStyle = moon;
    ctx.fill();
    ctx.restore();
    // Two rows of hills, a few pines and a little house with a warm window.
    hills(ctx, 818, 24, rand, "#2c2457");
    const near = hills(ctx, 884, 30, rand, "#1a1538");
    ctx.fillStyle = "#120f2b";
    for (let index = 0; index < 5; index += 1) {
      const x = 60 + rand() * 880;
      const y = near(x) + 6;
      const h = 46 + rand() * 30;
      ctx.beginPath();
      ctx.moveTo(x, y - h);
      ctx.lineTo(x + h * 0.32, y);
      ctx.lineTo(x - h * 0.32, y);
      ctx.closePath();
      ctx.fill();
    }
    const hx = left ? 700 + rand() * 160 : 140 + rand() * 160;
    const hy = near(hx) + 10;
    ctx.fillStyle = "#120f2b";
    ctx.fillRect(hx - 34, hy - 50, 68, 50);
    ctx.beginPath();
    ctx.moveTo(hx - 44, hy - 48);
    ctx.lineTo(hx, hy - 86);
    ctx.lineTo(hx + 44, hy - 48);
    ctx.closePath();
    ctx.fill();
    glow(ctx, hx - 10, hy - 26, 46, "rgba(255,200,110,.35)");
    ctx.fillStyle = "#ffcf6e";
    ctx.fillRect(hx - 20, hy - 38, 18, 18);
    // The stars, each with a soft glow.
    ctx.save();
    ctx.shadowColor = "rgba(255,226,150,.85)";
    for (const [x, y, s, a, c] of items.slice(0, shown)) {
      ctx.shadowBlur = s * 0.55 * unit;
      star(ctx, x, y, s, a, STARS[c % STARS.length]);
    }
    ctx.restore();
  }

  /* A bunch of balloons */
  const BALLOONS = ["#ff5470", "#ffad33", "#ffd84d", "#45cf9b", "#46a6ff", "#a06bff", "#ff79c3"];
  const KNOT = { x: 500, y: 922 };

  function cloud(ctx, x, y, s, unit) {
    ctx.save();
    ctx.shadowColor = "rgba(120,160,200,.25)";
    ctx.shadowBlur = 14 * unit;
    ctx.shadowOffsetY = 6 * unit;
    ctx.fillStyle = "rgba(255,255,255,.95)";
    ctx.beginPath();
    for (const [dx, dy, r] of [[-0.95, 0.12, 0.5], [-0.42, -0.22, 0.66], [0.22, -0.32, 0.76], [0.82, -0.02, 0.58], [1.25, 0.18, 0.42]]) {
      ctx.moveTo(x + dx * s + r * s, y + dy * s);
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, TAU);
    }
    ctx.moveTo(x - 1.2 * s, y + 0.3 * s);
    ctx.ellipse(x + 0.1 * s, y + 0.3 * s, 1.4 * s, 0.32 * s, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function balloon(ctx, x, y, r, angle, colour) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    ctx.beginPath();
    ctx.moveTo(0, -r);
    ctx.bezierCurveTo(0.62 * r, -r, 0.9 * r, -0.55 * r, 0.9 * r, -0.1 * r);
    ctx.bezierCurveTo(0.9 * r, 0.42 * r, 0.42 * r, 0.9 * r, 0, r);
    ctx.bezierCurveTo(-0.42 * r, 0.9 * r, -0.9 * r, 0.42 * r, -0.9 * r, -0.1 * r);
    ctx.bezierCurveTo(-0.9 * r, -0.55 * r, -0.62 * r, -r, 0, -r);
    ctx.closePath();
    const gradient = ctx.createRadialGradient(-0.32 * r, -0.42 * r, r * 0.05, 0, 0, r * 1.1);
    gradient.addColorStop(0, tint(colour, 0.55));
    gradient.addColorStop(0.45, colour);
    gradient.addColorStop(1, tint(colour, -0.26));
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.lineWidth = Math.max(1.4, r * 0.04);
    ctx.strokeStyle = tint(colour, -0.38, 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-0.11 * r, 1.09 * r);
    ctx.lineTo(0.11 * r, 1.09 * r);
    ctx.lineTo(0, 0.97 * r);
    ctx.closePath();
    ctx.fillStyle = tint(colour, -0.2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-0.38 * r, -0.4 * r, 0.14 * r, 0.27 * r, 0.45, 0, TAU);
    ctx.fillStyle = "rgba(255,255,255,.62)";
    ctx.fill();
    ctx.restore();
  }

  function paintBalloons(ctx, items, seed, shown, unit) {
    const rand = random(seed);
    ctx.fillStyle = vertical(ctx, 0, SIZE, [[0, "#9fd6ff"], [0.62, "#d8f0ff"], [1, "#fff0f6"]]);
    ctx.fillRect(0, 0, SIZE, SIZE);
    glow(ctx, rand() < 0.5 ? 120 : 880, 90, 420, "rgba(255,255,255,.65)");
    for (let index = 0; index < 4; index += 1) cloud(ctx, 80 + rand() * 840, 90 + rand() * 600, 52 + rand() * 30, unit);
    // A grassy hill to tie the bunch to.
    ctx.beginPath();
    ctx.moveTo(0, 968);
    ctx.quadraticCurveTo(500, 900, SIZE, 968);
    ctx.lineTo(SIZE, SIZE);
    ctx.lineTo(0, SIZE);
    ctx.closePath();
    ctx.fillStyle = vertical(ctx, 920, SIZE, [[0, "#ade283"], [1, "#84ca5e"]]);
    ctx.fill();
    const list = items.slice(0, shown);
    // The strings first, so the balloons sit in front of them.
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(96,96,124,.5)";
    for (const [x, y, r, a] of list) {
      const t = (a * Math.PI) / 180;
      const kx = x - Math.sin(t) * r * 1.08;
      const ky = y + Math.cos(t) * r * 1.08;
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.quadraticCurveTo(kx + (KNOT.x - kx) * 0.15 + (rand() - 0.5) * 30, (ky + KNOT.y) / 2, KNOT.x, KNOT.y);
      ctx.stroke();
    }
    ctx.save();
    ctx.shadowColor = "rgba(90,40,60,.25)";
    ctx.shadowBlur = 8 * unit;
    ctx.shadowOffsetY = 3 * unit;
    heart(ctx, KNOT.x, KNOT.y + 38, 26, 0, "#e8304f");
    ctx.restore();
    bow(ctx, KNOT.x, KNOT.y, 0.7, "#ff5f8f");
    for (const [x, y, r, a, c] of list) balloon(ctx, x, y, r, a, BALLOONS[c % BALLOONS.length]);
  }

  /* Dots in a circle */
  const DOTS = ["#ef6f6c", "#f7a072", "#f2c14e", "#43aa8b", "#277da1", "#f28fad", "#9b72cf"];

  function paintDots(ctx, items, seed, shown, unit) {
    ctx.fillStyle = vertical(ctx, 0, SIZE, [[0, "#fbf3ea"], [1, "#f3e3d4"]]);
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.save();
    ctx.shadowColor = "rgba(120,80,50,.22)";
    ctx.shadowBlur = 40 * unit;
    ctx.shadowOffsetY = 14 * unit;
    circle(ctx, 500, 500, 436);
    ctx.fillStyle = "#fffaf3";
    ctx.fill();
    ctx.restore();
    circle(ctx, 500, 500, 436);
    ctx.lineWidth = 12;
    ctx.strokeStyle = "#ecd8c3";
    ctx.stroke();
    circle(ctx, 500, 500, 419);
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(236,216,195,.7)";
    ctx.stroke();
    for (const [x, y, r, , c] of items.slice(0, shown)) {
      const colour = DOTS[c % DOTS.length];
      const gradient = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
      gradient.addColorStop(0, tint(colour, 0.28));
      gradient.addColorStop(1, colour);
      circle(ctx, x, y, r);
      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }

  /* Sheep in a field */
  const WOOL = ["#ffffff", "#fff8ea", "#f4efe8", "#4b4148"];
  const PUFFS = Array.from({ length: 10 }, (_, index) => [Math.cos((index * TAU) / 10) * 0.55, Math.sin((index * TAU) / 10) * 0.3]);

  function sheep(ctx, x, y, s, colour, flipped) {
    const black = colour === 3;
    const wool = WOOL[colour] || WOOL[0];
    const skin = black ? "#272025" : "#3d3740";
    const d = flipped ? -1 : 1;
    const cy = y - 0.76 * s;
    ctx.beginPath();
    ctx.ellipse(x, y, s * 0.86, s * 0.16, 0, 0, TAU);
    ctx.fillStyle = "rgba(40,90,30,.22)";
    ctx.fill();
    ctx.fillStyle = skin;
    for (const lx of [-0.42, -0.18, 0.18, 0.42]) {
      roundedRect(ctx, x + lx * s - 0.065 * s, y - 0.5 * s, 0.13 * s, 0.5 * s, 0.06 * s);
      ctx.fill();
    }
    // Wool: a shaded rim first, then the fluffy body over it.
    const fluff = (r, dy) => {
      ctx.beginPath();
      ctx.ellipse(x, cy + dy, 0.55 * s, 0.34 * s, 0, 0, TAU);
      for (const [px, py] of PUFFS) {
        ctx.moveTo(x + px * s + r * s, cy + py * s + dy);
        ctx.arc(x + px * s, cy + py * s + dy, r * s, 0, TAU);
      }
      ctx.fill();
    };
    ctx.fillStyle = black ? "#2c2429" : "#d6d0c8";
    fluff(0.29, 0.035 * s);
    ctx.fillStyle = wool;
    fluff(0.26, 0);
    ctx.fillStyle = black ? "rgba(255,255,255,.08)" : "rgba(255,255,255,.95)";
    circle(ctx, x - 0.2 * s, cy - 0.22 * s, 0.16 * s);
    ctx.fill();
    // The head, ears, an eye and a little tuft of wool.
    const hx = x + d * 0.66 * s;
    const hy = y - 0.94 * s;
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(hx - d * 0.2 * s, hy - 0.16 * s, 0.15 * s, 0.065 * s, d * -0.5, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(hx, hy, 0.22 * s, 0.29 * s, d * 0.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#fff";
    circle(ctx, hx + d * 0.08 * s, hy - 0.06 * s, 0.05 * s);
    ctx.fill();
    ctx.fillStyle = wool;
    circle(ctx, hx - d * 0.08 * s, hy - 0.25 * s, 0.11 * s);
    ctx.fill();
    circle(ctx, hx + d * 0.04 * s, hy - 0.28 * s, 0.09 * s);
    ctx.fill();
  }

  function paintSheep(ctx, items, seed, shown, unit) {
    const rand = random(seed);
    ctx.fillStyle = vertical(ctx, 0, 450, [[0, "#86cbff"], [1, "#dcf2ff"]]);
    ctx.fillRect(0, 0, SIZE, 450);
    const sunX = rand() < 0.5 ? 150 : 850;
    glow(ctx, sunX, 110, 250, "rgba(255,240,170,.55)");
    circle(ctx, sunX, 110, 50);
    ctx.fillStyle = "#ffe26b";
    ctx.fill();
    // The Alps in the distance, with snow on top.
    const peaks = [];
    for (let x = -60; x < SIZE + 120; x += 130 + rand() * 90) peaks.push([x, 228 + rand() * 96]);
    ctx.beginPath();
    ctx.moveTo(-60, 450);
    for (const [x, y] of peaks) ctx.lineTo(x, y);
    ctx.lineTo(SIZE + 120, 450);
    ctx.closePath();
    ctx.fillStyle = "#b3c7e4";
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = "#fbfdff";
    for (const [x, y] of peaks) {
      ctx.beginPath();
      ctx.moveTo(x - 80, y + 56);
      ctx.lineTo(x - 30, y + 40);
      ctx.lineTo(x, y + 58);
      ctx.lineTo(x + 34, y + 38);
      ctx.lineTo(x + 80, y + 56);
      ctx.lineTo(x, y - 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // Rolling green hills, then the meadow.
    ctx.beginPath();
    ctx.moveTo(0, 398);
    ctx.bezierCurveTo(240, 350, 420, 428, 620, 384);
    ctx.bezierCurveTo(780, 352, 900, 378, SIZE, 368);
    ctx.lineTo(SIZE, 480);
    ctx.lineTo(0, 480);
    ctx.closePath();
    ctx.fillStyle = "#a9dd86";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 432);
    ctx.quadraticCurveTo(500, 400, SIZE, 430);
    ctx.lineTo(SIZE, SIZE);
    ctx.lineTo(0, SIZE);
    ctx.closePath();
    ctx.fillStyle = vertical(ctx, 410, SIZE, [[0, "#9cda72"], [1, "#5fb646"]]);
    ctx.fill();
    ctx.strokeStyle = "rgba(60,130,45,.5)";
    ctx.lineCap = "round";
    for (let index = 0; index < 46; index += 1) {
      const y = 450 + rand() * 540;
      const x = rand() * SIZE;
      const s = 7 + ((y - 440) / 560) * 12;
      ctx.lineWidth = Math.max(2, s * 0.28);
      ctx.beginPath();
      ctx.moveTo(x - s * 0.6, y - s);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y - s * 1.2);
      ctx.moveTo(x, y);
      ctx.lineTo(x + s * 0.6, y - s);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    for (const [x, y, s, , c, f] of items.slice(0, shown)) sheep(ctx, x, y, s, c, f === 1);
  }

  /* Fish in a tank */
  const FISH = ["#ff8a3d", "#ffd23f", "#e8304f", "#ff6fb5", "#9b6bff", "#38d39f"];

  function fish(ctx, x, y, s, angle, c, flipped) {
    const colour = FISH[c % FISH.length];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((angle * Math.PI) / 180);
    if (flipped) ctx.scale(-1, 1);
    ctx.fillStyle = tint(colour, -0.12);
    ctx.beginPath();
    ctx.moveTo(-0.78 * s, 0);
    ctx.quadraticCurveTo(-1.18 * s, -0.56 * s, -1.42 * s, -0.52 * s);
    ctx.quadraticCurveTo(-1.22 * s, 0, -1.42 * s, 0.52 * s);
    ctx.quadraticCurveTo(-1.18 * s, 0.56 * s, -0.78 * s, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-0.34 * s, -0.5 * s);
    ctx.quadraticCurveTo(-0.08 * s, -0.98 * s, 0.32 * s, -0.52 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, 0, s, 0.6 * s, 0, 0, TAU);
    ctx.fillStyle = vertical(ctx, -0.6 * s, 0.6 * s, [[0, tint(colour, 0.35)], [0.55, colour], [1, tint(colour, -0.18)]]);
    ctx.fill();
    if (c === 0) {
      // A clownfish: white bands.
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "rgba(255,255,255,.92)";
      ctx.fillRect(-0.28 * s, -s, 0.17 * s, 2 * s);
      ctx.fillRect(0.3 * s, -s, 0.14 * s, 2 * s);
      ctx.restore();
    }
    ctx.lineWidth = Math.max(1.4, s * 0.05);
    ctx.strokeStyle = tint(colour, -0.42, 0.45);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-0.02 * s, 0.2 * s, 0.22 * s, 0.11 * s, 0.5, 0, TAU);
    ctx.fillStyle = tint(colour, -0.2, 0.7);
    ctx.fill();
    circle(ctx, 0.55 * s, -0.12 * s, 0.17 * s);
    ctx.fillStyle = "#fff";
    ctx.fill();
    circle(ctx, 0.6 * s, -0.12 * s, 0.09 * s);
    ctx.fillStyle = "#1d1a26";
    ctx.fill();
    ctx.restore();
  }

  function paintFish(ctx, items, seed, shown, unit) {
    const rand = random(seed);
    ctx.fillStyle = vertical(ctx, 0, SIZE, [[0, "#fff1f6"], [1, "#fde0eb"]]);
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = vertical(ctx, 930, SIZE, [[0, "#ecc1a8"], [1, "#e2ad90"]]);
    ctx.fillRect(0, 930, SIZE, SIZE - 930);
    // The water, light from above, sand and swaying weed.
    ctx.save();
    roundedRect(ctx, 70, 130, 860, 790, 24);
    ctx.fillStyle = vertical(ctx, 130, 920, [[0, "#a8e8ff"], [0.5, "#58b9ee"], [1, "#2a83cf"]]);
    ctx.fill();
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,.12)";
    for (let index = 0; index < 3; index += 1) {
      const x = 160 + index * 260 + rand() * 80;
      ctx.beginPath();
      ctx.moveTo(x, 130);
      ctx.lineTo(x + 70, 130);
      ctx.lineTo(x + 170, 900);
      ctx.lineTo(x + 40, 900);
      ctx.closePath();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(70, 846);
    for (let x = 70; x <= 930; x += 20) ctx.lineTo(x, 840 + Math.sin(x / 60) * 7);
    ctx.lineTo(930, 920);
    ctx.lineTo(70, 920);
    ctx.closePath();
    ctx.fillStyle = vertical(ctx, 830, 920, [[0, "#f7e1ad"], [1, "#e6c483"]]);
    ctx.fill();
    for (let index = 0; index < 9; index += 1) {
      ctx.beginPath();
      ctx.ellipse(100 + rand() * 800, 872 + rand() * 36, 12 + rand() * 10, 7 + rand() * 4, 0, 0, TAU);
      ctx.fillStyle = ["#cdbba8", "#f2b3c2", "#a9cfdf"][index % 3];
      ctx.fill();
    }
    ctx.lineCap = "round";
    for (const [x, top, colour] of [[110, 560, "#2e9b63"], [150, 640, "#3fb67a"], [858, 590, "#3fb67a"], [896, 660, "#2e9b63"]]) {
      ctx.lineWidth = 16;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      ctx.moveTo(x, 880);
      ctx.bezierCurveTo(x - 34, 790, x + 34, 720, x - 6, top);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    for (const [x, y, s, a, c, f] of items.slice(0, shown)) fish(ctx, x, y, s, a, c, f === 1);
    ctx.fillStyle = "rgba(255,255,255,.1)";
    ctx.beginPath();
    ctx.moveTo(700, 130);
    ctx.lineTo(800, 130);
    ctx.lineTo(560, 920);
    ctx.lineTo(500, 920);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // The glass edge and the tank's lid and stand.
    roundedRect(ctx, 70, 130, 860, 790, 24);
    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(255,255,255,.75)";
    ctx.stroke();
    ctx.fillStyle = vertical(ctx, 112, 146, [[0, "#6c7b8c"], [1, "#4f5c6b"]]);
    roundedRect(ctx, 58, 112, 884, 34, 12);
    ctx.fill();
    ctx.fillStyle = vertical(ctx, 904, 940, [[0, "#6c7b8c"], [1, "#4f5c6b"]]);
    roundedRect(ctx, 58, 904, 884, 36, 12);
    ctx.fill();
  }

  const PAINTERS = { sweets: paintSweets, hearts: paintHearts, stars: paintStars, balloons: paintBalloons, dots: paintDots, sheep: paintSheep, fish: paintFish };

  // Paints the scene (the first `shown` items) at the canvas's real pixel size.
  function paint(scene, shown = Infinity) {
    const width = canvas.clientWidth;
    if (!width) return;
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const pixels = Math.round(width * ratio);
    if (canvas.width !== pixels || canvas.height !== pixels) {
      canvas.width = pixels;
      canvas.height = pixels;
    }
    const ctx = canvas.getContext("2d");
    const unit = pixels / SIZE;
    const items = Array.isArray(scene?.items) ? scene.items.filter((item) => Array.isArray(item) && item.length >= 5 && item.every(Number.isFinite)) : [];
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixels, pixels);
    ctx.setTransform(unit, 0, 0, unit, 0, 0);
    try {
      (PAINTERS[scene?.kind] || paintDots)(ctx, items, Number(scene?.seed) >>> 0, Math.min(items.length, shown), unit);
    } catch (error) {
      console.error(error);
    }
    onCanvas = { scene, shown };
  }

  function wipe() {
    window.cancelAnimationFrame(revealFrame);
    onCanvas = null;
    canvas.width = 1;
    canvas.height = 1;
  }

  /* ------------------------------- Playing ------------------------------- */
  async function start() {
    if (!data || saving || showing) return;
    startButton.disabled = true;
    showError("");
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/count", "POST", { author: me(), day: data.day, action: "start" });
      if (identity !== identitySeq) return;
      data = result;
      if (result.scene && result.showLeftMs > 0) look(result.showLeftMs);
      else render();
    } catch (error) {
      startButton.disabled = false;
      showError(error.status ? error.message : "Couldn’t start. Check your connection and try again.");
      if (error.status === 409) load();
    }
  }

  // The picture shows for the time that's left, with a bar running down.
  function look(leftMs) {
    showing = true;
    const total = data.showMs || 5000;
    const until = performance.now() + Math.max(0, Math.min(total, leftMs));
    statusEl.hidden = true;
    ledeEl.hidden = true;
    introEl.hidden = true;
    form.hidden = true;
    resultEl.hidden = true;
    tallyEl.hidden = true;
    timerEl.hidden = false;
    frameEl.hidden = false;
    canvas.setAttribute("aria-label", `${data.title}. Look closely: it’s gone in 5 seconds.`);
    paint(data.scene);
    frameEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    const tick = () => {
      const left = Math.max(0, until - performance.now());
      timerText.textContent = (left / 1000).toFixed(1);
      timerBar.style.transform = `scaleX(${left / total})`;
      timerEl.classList.toggle("is-hurry", left < 1500);
      if (left <= 0) {
        hide();
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    window.cancelAnimationFrame(frame);
    frame = window.requestAnimationFrame(tick);
    // Also when the phone sleeps through the frames.
    window.clearTimeout(showTimer);
    showTimer = window.setTimeout(() => { if (showing && performance.now() >= until) hide(); }, Math.max(0, until - performance.now()) + 60);
  }

  function hide() {
    if (!showing) return;
    showing = false;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(showTimer);
    wipe();
    data = { ...data, scene: null, showLeftMs: 0 };
    render();
    input.focus({ preventScroll: true });
    form.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  }

  const parse = (text) => {
    const clean = String(text || "").replace(/[^\d]/g, "");
    if (!clean) return null;
    const number = Number(clean);
    return Number.isInteger(number) && number <= 9999 ? number : null;
  };

  function updateSend() {
    sendButton.disabled = saving || parse(input.value) === null;
  }

  function renderForm() {
    questionEl.textContent = data.question || "How many were there?";
    if (formDay !== data.day) {
      formDay = data.day;
      input.value = readDraft();
    }
    updateSend();
  }

  async function submit(event) {
    event?.preventDefault();
    if (!data || saving || data.done || !data.started) return;
    const guess = parse(input.value);
    if (guess === null) {
      showError("Type how many you saw (just a number).");
      return;
    }
    saving = true;
    updateSend();
    showError("");
    const identity = identitySeq;
    try {
      const result = await app().apiRequest("/games/count", "POST", { author: me(), day: data.day, action: "guess", guess });
      if (identity !== identitySeq) return;
      saving = false;
      clearDraft();
      input.blur();
      data = result;
      render();
      const res = result.result;
      const question = String(result.question || "How many were there?").replace(/^How/, "how").replace(/\?$/, "");
      postActivity({
        kind: "count.played",
        text: res
          ? (res.winner === me() ? "won today’s how many" : res.winner === "tie" ? "played how many: a tie" : "played how many: you were closer")
          : `guessed ${question}. Your turn!`,
        step: "count",
        icon: "circle-dot",
        push: true
      });
      games()?.reward?.(result.awarded);
      games()?.refresh?.();
      resultEl.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      saving = false;
      updateSend();
      showError(error.status ? error.message : "Couldn’t send your guess. Check your connection and try again.");
      if (error.status === 409) load();
    }
  }

  /* -------------------------------- Result -------------------------------- */
  // The picture again with the answer: the first time, the items pop in as a counter runs up.
  function showAnswer() {
    const scene = data.scene;
    if (!scene) return;
    frameEl.hidden = false;
    tallyEl.hidden = false;
    tallyEl.dataset.corner = TOP_TALLY.includes(scene.kind) ? "top" : "bottom";
    canvas.setAttribute("aria-label", `${data.title}: ${data.n} ${data.noun}.`);
    const total = Array.isArray(scene.items) ? scene.items.length : 0;
    const tally = (value) => { tallyEl.innerHTML = `<b>${value}</b> ${escape(data.noun)}`; };
    if (revealedDay === data.day || reduced()) {
      if (revealedDay !== data.day || !onCanvas || onCanvas.scene !== scene) {
        window.cancelAnimationFrame(revealFrame);
        paint(scene);
        tally(data.n);
      }
      revealedDay = data.day;
      return;
    }
    revealedDay = data.day;
    const begin = performance.now();
    const duration = Math.min(2200, 700 + total * 9);
    const step = () => {
      const k = Math.min(1, (performance.now() - begin) / duration);
      const shown = Math.round(total * (1 - (1 - k) * (1 - k)));
      paint(scene, shown);
      tally(k < 1 ? shown : data.n);
      if (k < 1) revealFrame = window.requestAnimationFrame(step);
    };
    window.cancelAnimationFrame(revealFrame);
    revealFrame = window.requestAnimationFrame(step);
  }

  function resultHtml() {
    const them = escape(nameOf(other()));
    const res = data.result;
    const mine = data.mine;
    const noun = escape(data.noun);
    const offText = (off) => (off === 0 ? "" : ` · ${off} off`);
    if (!res) {
      const praise = mine.off === 0 ? "Exactly right. Wow!" : mine.off <= data.n * 0.1 ? "Within 10%. Nice eye!" : `${mine.off} off.`;
      return `<div class="match-waiting"><span class="match-waiting-icon">${iconHtml("hourglass")}</span>
          <div><p class="match-waiting-title">You said ${mine.guess}. There were ${data.n}!</p>
          <p class="match-waiting-copy">${escape(praise)} Waiting for ${them} to guess. Shh, no spoilers!</p></div></div>`;
    }
    const message = res.winner === "tie" ? "Just as close. A tie!" : res.winner === me() ? "You were closer!" : `${them} was closer!`;
    const badge = (who) => (res.bonus[who] === 2 ? `<em class="count-badge">Exact</em>` : res.bonus[who] === 1 ? `<em class="count-badge">Within 10%</em>` : "");
    return `<div class="match-score${res.bonus[me()] === 2 ? " is-perfect" : ""}">
        <p class="match-score-big"><strong>${res.n}</strong>${noun}</p>
        <p class="quick-versus"><span class="${res.winner === me() ? "is-win" : ""}">${iconHtml("circle-dot")}You ${mine.guess}${offText(res.off[me()])}${badge(me())}</span><span class="${res.winner === other() ? "is-win" : ""}">${iconHtml("circle-dot")}${them} ${data.theirs.guess}${offText(res.off[other()])}${badge(other())}</span></p>
        <p class="match-score-msg">${escape(message)}</p>
      </div>`;
  }

  function statsHtml(stats) {
    if (!stats?.daysPlayed) return "";
    return `<div class="match-stat"><dt>Wins</dt><dd><strong>${Number(stats.wins?.[me()]) || 0} : ${Number(stats.wins?.[other()]) || 0}</strong><small>you : ${escape(nameOf(other()))}</small></dd></div>
      <div class="match-stat"><dt>Exact</dt><dd><strong>${Number(stats.exact?.[me()]) || 0} : ${Number(stats.exact?.[other()]) || 0}</strong><small>spot-on guesses</small></dd></div>
      <div class="match-stat"><dt>Within 10%</dt><dd><strong>${Number(stats.close?.[me()]) || 0} : ${Number(stats.close?.[other()]) || 0}</strong><small>close guesses</small></dd></div>
      <div class="match-stat"><dt>Played</dt><dd><strong>${Number(stats.daysPlayed) || 0}</strong><small>${Number(stats.daysPlayed) === 1 ? "day" : "days"} together</small></dd></div>`;
  }

  function put(element, key, html) {
    if (drawn[key] === html) return;
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
  }

  function render() {
    if (!data || showing) return;
    statusEl.hidden = true;
    const done = data.done;
    const started = data.started;
    // Back in the middle of the 5 seconds (a reload): look for the time that's left.
    if (started && !done && data.scene && data.showLeftMs > 0) {
      look(data.showLeftMs);
      return;
    }
    ledeEl.hidden = done;
    ledeEl.textContent = data.theirsDone ? `${nameOf(other())} already played. Your turn!` : LEDE;
    ledeEl.classList.toggle("is-nudge", Boolean(data.theirsDone));
    introEl.hidden = started || done;
    put(todayEl, "today", `${iconHtml(KIND_ICONS[data.kind])}<span>Today: <strong>${escape(data.title)}</strong></span>`);
    startButton.disabled = false;
    timerEl.hidden = true;
    form.hidden = !started || done;
    if (started && !done) renderForm();
    resultEl.hidden = !done;
    frameEl.hidden = !done;
    if (done) {
      put(resultEl, "result", resultHtml());
      showAnswer();
    } else if (onCanvas) {
      wipe();
    }
    const stats = statsHtml(data.stats);
    statsEl.hidden = !stats;
    put(statsEl, "stats", stats);
  }

  /* -------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    if (showing || saving) return;
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading today’s picture…";
      introEl.hidden = true;
      form.hidden = true;
      resultEl.hidden = true;
      frameEl.hidden = true;
    }
    try {
      const result = await app().apiRequest(`/games/count?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || showing || saving) return;
      if (data?.day !== result.day) formDay = "";
      data = result;
      if (!quiet) retryButton.hidden = true;
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404 ? "How many? needs the latest server update first." : "Couldn’t load today’s picture. Check your connection and try again.";
      retryButton.hidden = false;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "count") return;
      load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function resetIdentity() {
    identitySeq += 1;
    loadSeq += 1;
    showing = false;
    saving = false;
    window.cancelAnimationFrame(frame);
    window.clearTimeout(showTimer);
    wipe();
    data = null;
    formDay = "";
    revealedDay = "";
    drawn = { today: "", result: "", stats: "" };
    input.value = "";
    todayEl.innerHTML = "";
    resultEl.innerHTML = "";
    statsEl.innerHTML = "";
    timerEl.hidden = true;
    frameEl.hidden = true;
    showError("");
    if (app()?.step === "count") load();
  }

  /* ------------------------------- Wiring --------------------------------- */
  startButton.addEventListener("click", start);
  form.addEventListener("submit", submit);
  input.addEventListener("input", () => {
    const clean = input.value.replace(/[^\d]/g, "").slice(0, 4);
    if (clean !== input.value) input.value = clean;
    showError("");
    saveDraft();
    updateSend();
  });
  retryButton.addEventListener("click", () => {
    retryButton.hidden = true;
    showError("");
    load();
  });
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => { if (onCanvas && !frameEl.hidden) paint(onCanvas.scene, onCanvas.shown); }, 150);
  });
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });
  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "count") {
      load();
      startPolling();
    } else {
      stopPolling();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "count") load({ quiet: true });
  });
})();
