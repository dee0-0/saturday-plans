/*
 * Love coupons (redeemable once, synced through the Worker, notify on redeem)
 * and the "Catch the fries" mini game that unlocks the bonus coupon.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const herName = () => CONFIG.herName || "She";
  const escape = (text) => window.DateApp?.escapeHtml(text) ?? String(text);
  const LOCAL_KEY = "date-letter-coupons";

  /* ------------------------------- Coupons ------------------------------- */
  const list = $("#coupon-list");
  const errorEl = $("#coupon-error");
  const tileNote = $("#coupon-tile-note");
  const coupons = Array.isArray(CONFIG.coupons) ? CONFIG.coupons : [];
  const bonus = CONFIG.bonusCoupon || null;
  // Stays out of sight until she finds every secret (secrets.js).
  const secretPrize = CONFIG.secretsCoupon || null;
  let state = { redeemed: {}, unlocked: {} };
  // The Worker might still be the old version (before deploy): keep coupons on this device then.
  let localOnly = false;
  let armedId = null;
  let armTimer = null;

  function readLocal() {
    try { return { redeemed: {}, unlocked: {}, ...JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "{}") }; }
    catch { return { redeemed: {}, unlocked: {} }; }
  }
  function writeLocal() {
    try { window.localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); } catch { /* Private browsing. */ }
  }

  function allCoupons() {
    const list = bonus ? [...coupons, { ...bonus, bonus: true }] : [...coupons];
    if (secretPrize && state.unlocked[secretPrize.id]) list.push(secretPrize);
    return list;
  }

  function showError(message) {
    errorEl.textContent = message;
    errorEl.hidden = !message;
  }

  function stampDate(iso) {
    return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "Europe/Zurich" }).format(new Date(iso));
  }

  function render() {
    if (!list) return;
    list.innerHTML = allCoupons().map((coupon) => {
      const redeemedAt = state.redeemed[coupon.id];
      const locked = coupon.bonus && !state.unlocked[coupon.id];
      let action = `<button class="coupon-redeem" type="button" data-coupon="${escape(coupon.id)}">Redeem</button>`;
      if (redeemedAt) action = `<span class="coupon-stamp">Redeemed<small>${escape(stampDate(redeemedAt))}</small></span>`;
      else if (locked) action = `<button class="coupon-lock" type="button" data-action="goto" data-target="game">Win the fry game</button>`;
      return `<article class="coupon${redeemedAt ? " is-redeemed" : ""}${locked ? " is-locked" : ""}" data-id="${escape(coupon.id)}">
        <span class="coupon-art" aria-hidden="true">${locked ? "🔒" : escape(coupon.icon || "💌")}</span>
        <span class="coupon-copy"><strong>${escape(coupon.title)}</strong><small>${escape(locked ? "Prize coupon. Win the fry game to unlock it." : coupon.detail || "")}</small></span>
        <span class="coupon-action">${action}</span>
      </article>`;
    }).join("");
    updateTile();
  }

  function updateTile() {
    if (!tileNote) return;
    const available = allCoupons().filter((coupon) => !state.redeemed[coupon.id] && !(coupon.bonus && !state.unlocked[coupon.id])).length;
    tileNote.textContent = available ? `${available} to redeem` : "All used 💕";
  }

  async function load() {
    try {
      const data = await window.DateApp.apiRequest("/coupons");
      state = data.coupons;
      localOnly = false;
      showError("");
    } catch (error) {
      if (error.status === 404) {
        localOnly = true;
        state = readLocal();
      } else if (window.DateApp?.step === "coupons") {
        showError("Couldn’t load the coupons. Check your connection and try again.");
      }
    }
    render();
  }

  function disarm() {
    armedId = null;
    window.clearTimeout(armTimer);
    list.querySelectorAll(".coupon-redeem.is-armed").forEach((button) => {
      button.classList.remove("is-armed");
      button.textContent = "Redeem";
    });
  }

  async function redeem(id, button) {
    const coupon = allCoupons().find((item) => item.id === id);
    if (!coupon) return;
    disarm();
    button.disabled = true;
    button.textContent = "Redeeming…";
    showError("");
    try {
      if (localOnly) {
        state.redeemed[id] = new Date().toISOString();
        writeLocal();
      } else {
        state = (await window.DateApp.apiRequest("/coupons", "POST", { action: "redeem", id })).coupons;
      }
      render();
      const ticket = list.querySelector(`.coupon[data-id="${CSS.escape(id)}"]`);
      ticket?.classList.add("just-redeemed");
      window.LetterFX?.burstFrom(ticket, 26);
      window.LetterFX?.chime?.();
      const delivered = await window.DateApp.notify(`${herName()} redeemed a coupon 🎟️`, `${coupon.icon || ""} ${coupon.title}\n${coupon.detail || ""}`.trim(), ["tickets"]);
      if (!delivered) showError("Redeemed! The notification didn’t go through, so maybe tell me in person.");
    } catch (error) {
      if (error.status === 409 && error.data?.coupons) {
        state = error.data.coupons;
        showError("That coupon was already used.");
      } else {
        showError(error.message || "Couldn’t redeem that. Please try again.");
      }
      render();
    }
  }

  list?.addEventListener("click", (event) => {
    const button = event.target.closest(".coupon-redeem");
    if (!button || button.disabled) return;
    const id = button.dataset.coupon;
    // Two taps, so a coupon can't be used up by accident.
    if (armedId === id) {
      redeem(id, button);
      return;
    }
    disarm();
    armedId = id;
    button.classList.add("is-armed");
    button.textContent = "Tap again";
    armTimer = window.setTimeout(disarm, 3500);
  });

  // True when this just unlocked it, false when it already was, null when saving failed.
  async function unlock(coupon) {
    if (!coupon) return false;
    if (localOnly) {
      const fresh = !state.unlocked[coupon.id];
      state.unlocked[coupon.id] = state.unlocked[coupon.id] || new Date().toISOString();
      writeLocal();
      render();
      return fresh;
    }
    try {
      const data = await window.DateApp.apiRequest("/coupons", "POST", { action: "unlock", id: coupon.id });
      state = data.coupons;
      render();
      return Boolean(data.changed);
    } catch (error) {
      if (error.status === 404) {
        localOnly = true;
        state = readLocal();
        return unlock(coupon);
      }
      return null;
    }
  }

  /* ------------------------------ Fry game ------------------------------- */
  const canvas = $("#game-canvas");
  const stage = $("#game-stage");
  const overlay = $("#game-overlay");
  const resultEl = $("#game-result");
  const startButton = $("#game-start");
  const prizeButton = $("#game-prize");
  const scoreEl = $("#game-score");
  const timeEl = $("#game-time");
  const bestEl = $("#game-best");
  const TARGET = Number(CONFIG.gameTarget) || 15;
  const SECRET_SCORE = window.LetterSecrets?.gameSecretScore ?? Infinity;
  const secretEl = $("#game-secret");
  const DURATION = 20;
  const BEST_KEY = "date-letter-fry-best";
  const ITEMS = [
    { emoji: "🍟", points: 1, weight: 0.6 },
    { emoji: "💗", points: 3, weight: 0.17 },
    { emoji: "🥦", points: -2, weight: 0.23 }
  ];
  let ctx = null;
  let width = 0;
  let height = 0;
  let running = false;
  let frameId = 0;
  let last = 0;
  let elapsed = 0;
  let score = 0;
  let spawnTimer = 0;
  let items = [];
  let pops = [];
  let playerX = 0;
  let targetX = 0;
  const keys = { left: false, right: false };
  const PLAYER_W = 72;
  const PLAYER_H = 50;

  $("#game-hint").textContent = `Score ${TARGET} in ${DURATION} seconds to win a prize coupon. Fries are 1 point, hearts 3, broccoli takes 2 away.`;

  function best() {
    try { return Number(window.localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; }
  }

  function sizeCanvas() {
    const rect = stage.getBoundingClientRect();
    if (!rect.width) return false;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!playerX) playerX = targetX = width / 2;
    playerX = Math.min(Math.max(playerX, PLAYER_W / 2), width - PLAYER_W / 2);
    return true;
  }

  function drawBag(x) {
    const top = height - PLAYER_H - 10;
    const left = x - PLAYER_W / 2;
    ctx.save();
    ctx.shadowColor = "rgba(120, 30, 60, .25)";
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 4;
    const gradient = ctx.createLinearGradient(0, top, 0, top + PLAYER_H);
    gradient.addColorStop(0, "#ec6a98");
    gradient.addColorStop(1, "#c93a6f");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left + PLAYER_W, top);
    ctx.lineTo(left + PLAYER_W - 8, top + PLAYER_H);
    ctx.lineTo(left + 8, top + PLAYER_H);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#f7a8c3";
    ctx.fillRect(left - 3, top - 4, PLAYER_W + 6, 7);
    ctx.fillStyle = "#fff";
    ctx.font = "20px Manrope, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("♥", x, top + PLAYER_H / 2 + 2);
  }

  function draw() {
    ctx.clearRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const item of items) {
      ctx.save();
      ctx.translate(item.x, item.y);
      ctx.rotate(item.rotation);
      ctx.font = `${item.size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      ctx.fillText(item.emoji, 0, 0);
      ctx.restore();
    }
    drawBag(playerX);
    for (const pop of pops) {
      ctx.globalAlpha = Math.max(0, pop.life);
      ctx.fillStyle = pop.points > 0 ? "#ad315f" : "#5d7f45";
      ctx.font = "800 16px Manrope, sans-serif";
      ctx.fillText(pop.points > 0 ? `+${pop.points}` : `${pop.points}`, pop.x, pop.y);
      ctx.globalAlpha = 1;
    }
  }

  function spawn() {
    let roll = Math.random();
    const kind = ITEMS.find((item) => (roll -= item.weight) < 0) || ITEMS[0];
    const size = 30;
    items.push({
      ...kind,
      size,
      x: size / 2 + Math.random() * (width - size),
      y: -size,
      speed: 150 + elapsed * 6 + Math.random() * 60,
      rotation: (Math.random() - 0.5) * 0.6,
      spin: (Math.random() - 0.5) * 2
    });
  }

  function step(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;
    const keyboard = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    if (keyboard) targetX += keyboard * 440 * dt;
    targetX = Math.min(Math.max(targetX, PLAYER_W / 2), width - PLAYER_W / 2);
    playerX += (targetX - playerX) * Math.min(1, dt * 18);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawn();
      spawnTimer = Math.max(0.36, 0.72 - elapsed * 0.018);
    }

    const catchTop = height - PLAYER_H - 14;
    items = items.filter((item) => {
      item.y += item.speed * dt;
      item.rotation += item.spin * dt;
      const caught = item.y + item.size * 0.35 >= catchTop && item.y <= height - 10 && Math.abs(item.x - playerX) < PLAYER_W / 2 + 6;
      if (caught) {
        score = Math.max(0, score + item.points);
        pops.push({ x: item.x, y: catchTop - 8, points: item.points, life: 1 });
        scoreEl.textContent = String(score);
        return false;
      }
      return item.y < height + item.size;
    });
    pops = pops.filter((pop) => {
      pop.y -= 40 * dt;
      pop.life -= dt * 1.4;
      return pop.life > 0;
    });

    const left = Math.max(0, DURATION - elapsed);
    timeEl.textContent = String(Math.ceil(left));
    draw();
    if (left <= 0) {
      finish();
      return;
    }
    frameId = window.requestAnimationFrame(step);
  }

  function start() {
    if (!sizeCanvas()) return;
    running = true;
    elapsed = 0;
    score = 0;
    spawnTimer = 0.3;
    items = [];
    pops = [];
    scoreEl.textContent = "0";
    timeEl.textContent = String(DURATION);
    overlay.hidden = true;
    secretEl.hidden = true;
    stage.classList.add("is-playing");
    last = performance.now();
    frameId = window.requestAnimationFrame(step);
  }

  function stop() {
    running = false;
    window.cancelAnimationFrame(frameId);
    stage?.classList.remove("is-playing");
  }

  async function finish() {
    stop();
    const previousBest = best();
    if (score > previousBest) {
      try { window.localStorage.setItem(BEST_KEY, String(score)); } catch { /* Private browsing. */ }
    }
    bestEl.textContent = String(Math.max(score, previousBest));
    overlay.hidden = false;
    startButton.innerHTML = `Play again ${document.querySelector("svg.lucide-play")?.outerHTML || ""}`;
    const points = `${score} point${score === 1 ? "" : "s"}`;
    if (score >= TARGET) {
      const legend = score >= SECRET_SCORE;
      resultEl.textContent = legend
        ? `${points}!! That's the secret high score 🤯 Your prize coupon is unlocked too.`
        : `${points}! You won 🏆 Your prize coupon is unlocked.`;
      prizeButton.hidden = false;
      window.LetterFX?.burstFrom(stage, legend ? 60 : 40);
      window.LetterFX?.chime?.();
      if (legend) {
        secretEl.textContent = CONFIG.gameSecretMessage || "You're officially a fry legend 🍟";
        secretEl.hidden = false;
        if (window.LetterSecrets.found("game")) {
          window.LetterSecrets.notify(`${herName()} hit the secret fry score 🍟🤯`, `She scored ${score} points. The secret score was ${SECRET_SCORE}.`, ["fries", "exploding_head"]);
        }
      }
      const fresh = await unlock(bonus);
      if (fresh) window.DateApp?.notify(`${herName()} won the fry game 🍟🏆`, `She scored ${score} points (needed ${TARGET}) and unlocked the prize coupon.`, ["trophy", "fries"]);
    } else {
      const cheer = score >= TARGET * 0.7 ? "So close!" : "Nice try!";
      resultEl.textContent = `${points}. You need ${TARGET} to win. ${cheer} One more round?`;
      prizeButton.hidden = !state.unlocked[bonus?.id];
    }
  }

  function idleScene() {
    if (running || !sizeCanvas()) return;
    items = [
      { emoji: "🍟", size: 30, x: width * 0.22, y: height * 0.28, rotation: -0.2 },
      { emoji: "💗", size: 30, x: width * 0.55, y: height * 0.16, rotation: 0.1 },
      { emoji: "🥦", size: 30, x: width * 0.8, y: height * 0.42, rotation: 0.25 }
    ];
    pops = [];
    draw();
  }

  if (canvas) {
    const aim = (event) => {
      const rect = canvas.getBoundingClientRect();
      targetX = event.clientX - rect.left;
    };
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      aim(event);
    });
    canvas.addEventListener("pointermove", (event) => {
      if (event.pointerType === "mouse" || event.buttons) aim(event);
    });
    window.addEventListener("keydown", (event) => {
      if (!running) return;
      if (event.key === "ArrowLeft") { keys.left = true; event.preventDefault(); }
      if (event.key === "ArrowRight") { keys.right = true; event.preventDefault(); }
    });
    window.addEventListener("keyup", (event) => {
      if (event.key === "ArrowLeft") keys.left = false;
      if (event.key === "ArrowRight") keys.right = false;
    });
    startButton.addEventListener("click", start);
    window.addEventListener("resize", () => { if (window.DateApp?.step === "game" && !running) idleScene(); });
  }

  /* ------------------------------- Wiring -------------------------------- */
  window.DateCoupons = { unlockSecretPrize: () => unlock(secretPrize) };

  document.addEventListener("date:step", (event) => {
    const { name } = event.detail;
    if (name !== "game") stop();
    if (name === "planned" || name === "coupons") load();
    if (name === "game") {
      bestEl.textContent = String(best());
      overlay.hidden = false;
      prizeButton.hidden = true;
      secretEl.hidden = true;
      resultEl.textContent = "Move the bag with your finger to catch what falls.";
      window.requestAnimationFrame(idleScene);
    }
  });
  document.addEventListener("visibilitychange", () => {
    // Time only counts while she's actually looking at the game.
    if (!document.hidden && running) last = performance.now();
  });
})();
