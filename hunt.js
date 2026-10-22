/*
 * Secret hunt, season 2: twenty harder easter eggs around the letter that both of
 * us hunt for, on both phones, with one shared list in the Worker (/games/hunt).
 * Every egg has a free riddle and a clearer hint for 5 hearts (bought once, seen by
 * both). Four eggs need both phones at once: the page "pings" the Worker, which
 * checks that the other phone pinged the same egg recently.
 * This file holds the riddles, the detectors (document-level listeners and a few
 * observers that only read the other pages; no other script has to know about
 * them) and the "hunt" page: progress, the twenty cards and the final reveal.
 * Season 2 stays invisible until season 1 (secrets.js) is complete.
 */
(function () {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const preview = new URLSearchParams(window.location.search).has("preview");
  // Finds that couldn't be sent (offline) wait here; preview keeps its own.
  const QUEUE_KEY = preview ? "date-letter-hunt-queue-preview" : "date-letter-hunt-queue";
  // The final reveal's confetti plays once per phone.
  const FINAL_KEY = preview ? "date-letter-hunt-final-preview" : "date-letter-hunt-final";
  const TOTAL = 20;
  const HINT_COST = 5;
  const POLL_MS = 15000;
  const REFRESH_MS = 20000;   // other pages refresh the state at most this often
  const REPEAT_MS = 10000;    // an egg found again shows its toast at most this often
  const HOLD_MOVE = 16;       // px a finger may drift during a long press
  const TAP_MS = 500;
  const TAP_MOVE = 14;

  const app = () => window.DateApp;
  const me = () => (app()?.me?.() === "sender" ? "sender" : "her");
  const other = (who = me()) => (who === "her" ? "sender" : "her");
  const nameOf = (who) => app()?.names?.[who] || (who === "her" ? "Her" : "Your date");
  const escape = (text) => String(text ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Lower case, no accents or punctuation, single spaces: "To Infinity & Beyond!" -> "to infinity and beyond".
  const plain = (text) => String(text ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
  const visible = (element) => Boolean(element && !element.closest("[hidden]") && element.getClientRects().length);
  const two = (value) => String(value).padStart(2, "0");
  const localDay = (date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;

  /* ------------------------------- The eggs -------------------------------- */
  // `fx`: little icons that float up from where it happened (plus an extra for some).
  const EGGS = [
    { id: "wish", icon: "sparkles", name: "Make a wish", fx: { icons: ["sparkles", "star"], scatter: true },
      riddle: "When ones line up four in a row,\nor twos do the same before bed,\nhold the small heart at the top of the page\nand make the wish in your head.",
      hint: "At 11:11 or 22:22 on your phone’s clock, press and hold the small heart in the top-left corner for 2 seconds.",
      reward: "11:11. Whatever you wished for, I hope it’s the same thing I did." },
    { id: "dateday", icon: "calendar-heart", name: "Today’s the day", fx: { icons: ["heart", "calendar-heart"] },
      riddle: "On the day the counting runs out of days\nbut a few hours still stand in between,\ndon’t tap the clock on our plan. Hold it,\nuntil it admits what the numbers mean.",
      hint: "On the day of our date, before it starts, press and hold the countdown on the plan page for 3 seconds.",
      reward: "Zero days left. Today it’s just hours, and then it’s just us." },
    { id: "bell", icon: "bell-ring", name: "Ring my bell", together: true, fx: { icons: ["bell", "heart"] },
      riddle: "Every ding needs a dong.\nOne of you leans on the little bell until it rings;\nthe other answers by simply looking inside theirs,\nbefore a minute has passed.",
      hint: "One of you presses and holds the bell (top right) for 2 seconds. Within 60 seconds, the other one opens their bell.",
      reward: "Ding dong. Whenever you ring, I’ll answer." },
    { id: "silence", icon: "volume-x", name: "A minute of silence", fx: { icons: ["music", "music-2"], melody: true },
      riddle: "Hush the music for as long as a minute lasts,\nnot a breath less and hardly a breath more.\nThen let it sing again.",
      hint: "Turn the sound off with the speaker button (top right), then turn it back on 60 to 66 seconds later.",
      reward: "Sixty seconds of quiet, and the first thing back is our song." },
    { id: "hug", icon: "hand-heart", name: "The extra-long hug", fx: { hearts: true },
      riddle: "One of your coupons comes with a minimum.\nGive it exactly what it asks for,\nwith a fingertip instead of two arms.",
      hint: "On the coupons page, press and hold the “One extra-long hug” coupon itself (not its button) for 30 seconds.",
      reward: "Thirty seconds, as promised. Also redeemable in person, any time." },
    { id: "heartsonly", icon: "heart", name: "Hearts only", fx: { hearts: true },
      riddle: "In the bag game, leave the fries for me\nand the greens for nobody.\nCatch only what I would hand you myself,\nfour of them at least, and nothing else.",
      hint: "In the fry game, finish a round in which you caught at least 4 hearts and no fries and no broccoli at all.",
      reward: "Hearts only. The fries were always mine anyway." },
    { id: "dayone", icon: "stamp", name: "Day one", fx: { icons: ["heart", "stamp"] },
      riddle: "Our scrapbook stamps every page like a postcard.\nFind the stamp that came before all the others\nand press it the way you hold on to a memory:\nlong enough to feel it.",
      hint: "In the journal, scroll to the oldest date (the last card) and press and hold its date stamp for 2 seconds.",
      reward: "Day one. Look how far we’ve come since this page." },
    { id: "slowburn", icon: "flame-kindling", name: "Slow burn", fx: { icons: ["flame", "heart"] },
      riddle: "Don’t fall for an outfit all at once.\nFall the slow way: one heart, then the next,\nfrom a little to completely,\nwithout skipping a single step.",
      hint: "On the outfits page, rate one outfit 1 heart, then 2, 3, 4 and 5, quickly one after another.",
      reward: "Slowly, then all at once. That’s how it happened to me too." },
    { id: "peapod", icon: "bean", name: "Two peas in a pod", together: true, fx: { icons: ["bean", "heart"] },
      riddle: "A saying about us, cut in half:\none of you puts the little green twins on the snack list,\nthe other adds the home they share.\nTen minutes apart at most.",
      hint: "One of you adds “peas” to the snack list. Within 10 minutes, the other one adds “pod”.",
      reward: "Two peas in a pod. Disgustingly cute, and proud of it." },
    { id: "infinity", icon: "rocket", name: "To infinity", fx: { icons: ["rocket", "star"] },
      riddle: "A space ranger shouted it as he leapt\n(and fell, with style).\nSay all of it where we go looking for films.",
      hint: "On the movies page, type “to infinity and beyond” into the movie search.",
      reward: "To infinity and beyond. Roughly how far I’d go for you." },
    { id: "palindrome", icon: "arrow-left-right", name: "Either way", fx: { icons: ["repeat", "heart"] },
      riddle: "Drop a wish in the jar that reads the same\nfrom the lid as from the bottom.\nA kayak is too short, and spaces don’t count.",
      hint: "Drop an idea into the ideas jar that reads the same backwards, with at least 7 letters (a palindrome), like “taco cat” or “never odd or even”.",
      reward: "Forwards or backwards, it still spells you and me." },
    { id: "firstq", icon: "mail-question", name: "The first question", fx: { icons: ["heart", "mail"] },
      riddle: "Every letter starts with a question,\nand ours had only one right answer.\nAsk it again, word for word,\nwhere we add questions of our own.",
      hint: "On the daily question page, add your own question: “Will you go out with me?”",
      reward: "Yes, the first time. Yes, every time since." },
    { id: "midnight", icon: "moon-star", name: "Midnight", together: true, fx: { icons: ["moon-star", "star"], scatter: true },
      riddle: "Where our little flame keeps count,\nstay with it while one day hands itself to the next.\nBoth of you, both watching, the same midnight.",
      hint: "Both of you open the Games page before midnight and keep it open while the clock turns from 23:59 to 00:00.",
      reward: "A brand-new day, and we were both there for its first minute." },
    { id: "neither", icon: "scale", name: "Why not both", fx: { icons: ["heart", "sparkles"] },
      riddle: "Two cards and one choice,\nand a tiny word between them that never takes a side.\nBefore you choose, knock twice on it.",
      hint: "In the daily match, before you pick, double-tap the little “or” between the two cards.",
      reward: "Can’t decide? Same. Let’s just have both." },
    { id: "rainbow", icon: "rainbow", name: "Over the rainbow", fx: { rainbow: true, icons: ["sparkles"] },
      riddle: "When the mind reader asks for a colour,\npaint the sky after rain instead,\nfrom the outside in.\nPink isn’t invited.",
      hint: "In the daily duel’s mind reader, tap the colours red, yellow, green, blue and purple, in that order.",
      reward: "Somewhere over the rainbow there’s a date with your name on it." },
    { id: "xoxox", icon: "heart-plus", name: "Hugs and kisses", fx: { letters: "XOXOX" },
      riddle: "Five letters the word list will never accept:\na kiss, a hug, a kiss, a hug, a kiss.\nSend them anyway.",
      hint: "In Wordle, before you finish today’s word, type X O X O X and press Enter.",
      reward: "The word list said no. I say yes to every single one." },
    { id: "corners", icon: "pin", name: "Pinned up", fx: { icons: ["pin", "heart"] },
      riddle: "Before a drawing goes on the fridge it needs pinning:\none little tack in every corner of the paper.",
      hint: "On the daily doodle, tap once in each of the four corners of the drawing pad, within 10 seconds.",
      reward: "Pinned to the wall, the way you’re pinned to my mind." },
    { id: "iloveus", icon: "eye", name: "Three little pictures", fx: { icons: ["heart", "users"] },
      riddle: "Say three words without a single letter:\nthe I that sees, the love that beats,\nand instead of you, the two of us.\nLine them up where stories are told in pictures.",
      hint: "In Icon story, under “Send one”, pick exactly these three icons in this order: the eye, the heart and the two people.",
      reward: "I love us. No letters needed." },
    { id: "team", icon: "heart-handshake", name: "Team effort", together: true, fx: { icons: ["heart-handshake", "badge-check"] },
      riddle: "Some badges take two hands.\nChoose one of this week’s three,\nand both of you press its picture at the same moment,\nwherever you are. Don’t let go too soon.",
      hint: "Both of you open Weekly challenges and press and hold the icon of the same challenge for 2 seconds, within 20 seconds of each other.",
      reward: "Two hands, one badge. Best team there is." },
    { id: "priceless", icon: "gem", name: "Priceless", fx: { icons: ["gem", "heart"] },
      riddle: "Put the one thing that can’t be bought\nup for sale in the love shop.\nCall it what it is,\nand ask the most the till will take.",
      hint: "In the love shop, add a reward called “Priceless” that costs 500 hearts (the highest price).",
      reward: "Priceless. Nobody can afford it, so it stays ours." }
  ];
  const byId = Object.fromEntries(EGGS.map((egg) => [egg.id, egg]));

  /* -------------------------------- State --------------------------------- */
  let state = null;          // the last GET/POST /games/hunt answer
  let loading = null;
  let loadedAt = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let watchUntil = 0;        // after a together ping: look for the other phone finishing it
  let watchTimer = null;
  const celebrated = new Set(); // eggs this phone already celebrated (or knew as found)
  const repeatAt = {};
  const sending = new Set();

  function tidy(data) {
    const found = {};
    for (const egg of EGGS) {
      const item = data?.found?.[egg.id];
      if (item && typeof item.at === "string") found[egg.id] = { by: ["her", "sender", "both"].includes(item.by) ? item.by : "her", at: item.at };
    }
    const person = (entry) => ({ balance: Math.round(Number(entry?.balance) || 0), earned: Math.round(Number(entry?.earned) || 0) });
    return {
      unlocked: Boolean(data?.unlocked),
      season1: { found: Number(data?.season1?.found) || 0, total: Number(data?.season1?.total) || 16 },
      found,
      hints: new Set((Array.isArray(data?.hints) ? data.hints : []).filter((id) => byId[id])),
      completed: Boolean(data?.completed),
      points: { her: person(data?.points?.her), sender: person(data?.points?.sender) }
    };
  }

  const isFound = (id) => Boolean(state?.found[id]);
  const foundCount = () => (state ? Object.keys(state.found).length : 0);
  // Detectors only report while season 2 is open (or before the first answer came in).
  const listening = (id) => !state || (state.unlocked && !isFound(id));

  function applyState(data) {
    const before = state;
    state = tidy(data);
    loadedAt = Date.now();
    // Eggs the other phone finished together with us while we waited: celebrate here too.
    if (before) {
      for (const egg of EGGS) {
        if (egg.together && state.found[egg.id] && !before.found[egg.id] && !celebrated.has(egg.id) && watchUntil > Date.now()) {
          celebrated.add(egg.id);
          celebrate(egg, { awarded: 0, mine: false });
        }
      }
    }
    Object.keys(state.found).forEach((id) => celebrated.add(id));
    if (before && !before.completed && state.completed && app()?.step === "hunt") finalConfetti();
    render();
  }

  const huntPath = () => `/games/hunt?author=${encodeURIComponent(me())}`;

  function load({ force = false } = {}) {
    if (!app()?.apiRequest) return Promise.resolve(state);
    if (loading) return loading;
    if (!force && Date.now() - loadedAt < REFRESH_MS) return Promise.resolve(state);
    const identity = identitySeq;
    loading = app().apiRequest(huntPath())
      .then((data) => {
        if (identity !== identitySeq) return state;
        applyState(data);
        flushQueue();
        return state;
      })
      .catch((error) => {
        if (identity === identitySeq && !state && app()?.step === "hunt") showStatus(error.status === 404
          ? "The hunt needs the latest server update first."
          : "Couldn’t load the hunt. Check your connection and try again.", { retry: true });
        return state;
      })
      .finally(() => { loading = null; });
    return loading;
  }

  /* ----------------------------- Offline queue ----------------------------- */
  function readQueue() {
    try { return (JSON.parse(window.localStorage.getItem(QUEUE_KEY) || "[]") || []).filter((item) => byId[item?.id] && !byId[item.id].together); } catch { return []; }
  }
  function writeQueue(list) {
    try {
      if (list.length) window.localStorage.setItem(QUEUE_KEY, JSON.stringify(list.slice(-TOTAL)));
      else window.localStorage.removeItem(QUEUE_KEY);
    } catch { /* Private browsing: it's simply tried again next time it happens. */ }
  }
  function queueFind(id) {
    const list = readQueue().filter((item) => item.id !== id || item.author !== me());
    writeQueue([...list, { id, author: me() }]);
  }
  function flushQueue() {
    if (!state?.unlocked) return;
    const list = readQueue();
    if (!list.length) return;
    writeQueue([]);
    list.filter((item) => item.author === me() && !isFound(item.id)).forEach((item) => find(item.id, { queued: true }));
  }

  /* ------------------------------ Reporting -------------------------------- */
  // A solo egg was found on this phone: the Worker decides whether it's new.
  async function find(id, { from = null, queued = false } = {}) {
    const egg = byId[id];
    if (!egg || egg.together) return;
    if (state && !state.unlocked) return;
    if (isFound(id)) {
      foundAgain(egg, from);
      return;
    }
    if (sending.has(id)) return;
    if (!app()?.apiRequest) {
      queueFind(id);
      return;
    }
    sending.add(id);
    const identity = identitySeq;
    try {
      const data = await app().apiRequest("/games/hunt", "POST", { author: me(), action: "found", id });
      if (identity !== identitySeq) return;
      celebrated.add(id);
      applyState(data);
      if (data.new) celebrate(egg, { awarded: data.awarded, mine: true, from, justCompleted: data.justCompleted, queued });
      else foundAgain(egg, from);
    } catch (error) {
      // Offline: try again once the hunt answers. A 409 means season 2 isn't open; stay quiet.
      if (!error.status) queueFind(id);
    } finally {
      sending.delete(id);
    }
  }

  // Half of a together egg from this phone. `quiet`: no "your turn" note (it could be ordinary use).
  async function ping(key, { part, value, from = null, quiet = false } = {}) {
    const egg = byId[key];
    if (!egg?.together || (state && !state.unlocked) || !app()?.apiRequest) return;
    if (isFound(key)) {
      if (!quiet) foundAgain(egg, from);
      return;
    }
    const identity = identitySeq;
    try {
      const data = await app().apiRequest("/games/hunt", "POST", { author: me(), action: "ping", key, ...(part ? { part } : {}), ...(value ? { value } : {}) });
      if (identity !== identitySeq) return;
      if (data.new) {
        celebrated.add(key);
        applyState(data);
        celebrate(egg, { awarded: data.awarded, mine: true, from, justCompleted: data.justCompleted });
        return;
      }
      applyState(data);
      if (data.together) {
        if (!quiet) foundAgain(egg, from);
        return;
      }
      // Waiting for the other phone: look for it to finish during the egg's window.
      watch((Number(data.window) || 60) * 1000);
      if (!quiet) {
        nudge(from);
        toast({ icon: egg.icon, title: egg.name, text: `Your half is done. Now it’s up to ${nameOf(other())}.`, note: "Season 2 · together", duration: 4200 });
      }
    } catch { /* Together eggs need both phones online at the same time anyway. */ }
  }

  function watch(ms) {
    watchUntil = Math.max(watchUntil, Date.now() + ms + 4000);
    if (watchTimer) return;
    watchTimer = window.setInterval(() => {
      if (Date.now() > watchUntil) {
        window.clearInterval(watchTimer);
        watchTimer = null;
        return;
      }
      if (!document.hidden) load({ force: true });
    }, 5000);
  }

  /* ------------------------------ Celebrating ------------------------------ */
  function toast(item) {
    if (window.LetterSecrets?.toast) window.LetterSecrets.toast(item);
  }

  function nudge(element) {
    try { window.LetterSecrets?.nudge?.(element); } catch { /* Decoration. */ }
  }

  function lucideSvg(name) {
    const key = String(name).replace(/(^|-)([a-z0-9])/g, (_, dash, letter) => letter.toUpperCase());
    const node = window.lucide?.icons?.[key];
    try { return node ? window.lucide.createElement(node).outerHTML : ""; } catch { return ""; }
  }

  // Little icons (or letters) floating up and out of `from`.
  function float(from, { icons = [], letters = "" } = {}) {
    if (reduced()) return;
    const rect = visible(from) ? from.getBoundingClientRect() : { left: window.innerWidth / 2 - 20, top: window.innerHeight * .45, width: 40, height: 40 };
    const pieces = letters ? [...letters, ...letters] : Array.from({ length: 14 }, (_, index) => icons[index % icons.length]);
    const markup = icons.map(lucideSvg);
    const layer = document.createElement("div");
    layer.className = "hunt-float";
    layer.setAttribute("aria-hidden", "true");
    pieces.forEach((piece, index) => {
      const span = document.createElement("span");
      if (letters) {
        span.textContent = piece;
        span.className = "is-letter";
      } else {
        span.innerHTML = markup[index % markup.length] || "";
      }
      const angle = -Math.PI / 2 + (Math.random() - .5) * 2.2;
      const distance = 70 + Math.random() * 110;
      span.style.left = `${rect.left + rect.width / 2 - 11}px`;
      span.style.top = `${rect.top + rect.height / 2 - 11}px`;
      span.style.setProperty("--dx", `${Math.cos(angle) * distance}px`);
      span.style.setProperty("--dy", `${Math.sin(angle) * distance - 30}px`);
      span.style.setProperty("--spin", `${(Math.random() - .5) * 120}deg`);
      span.style.animationDelay = `${index * 45}ms`;
      layer.append(span);
    });
    document.body.append(layer);
    window.setTimeout(() => layer.remove(), 2600);
  }

  function rainbowArc() {
    if (reduced()) return;
    const arc = document.createElement("div");
    arc.className = "hunt-rainbow";
    arc.setAttribute("aria-hidden", "true");
    document.body.append(arc);
    window.setTimeout(() => arc.remove(), 3200);
  }

  function effects(egg, from) {
    const fx = egg.fx || {};
    try {
      if (fx.icons || fx.letters) float(from, fx);
      if (fx.hearts) window.LetterSecrets?.spray?.("hearts", { count: 26, from: visible(from) ? from : null });
      if (fx.scatter) window.LetterFX?.scatter?.(44);
      else if (visible(from)) window.LetterFX?.burstFrom?.(from, 18);
      if (fx.rainbow) rainbowArc();
      if (fx.melody) {
        window.LetterMusic?.duck?.(3.4);
        window.setTimeout(() => window.LetterFX?.melody?.(), 250);
      } else {
        window.LetterFX?.chime?.();
      }
    } catch { /* Effects are decoration. */ }
  }

  // A new find: the effect, the toast, the hearts and (when it was this phone) the other's bell.
  function celebrate(egg, { awarded = 0, mine = true, from = null, justCompleted = false, queued = false } = {}) {
    const count = foundCount();
    effects(egg, from);
    toast({
      icon: egg.icon,
      title: egg.name,
      text: egg.reward,
      note: `${queued ? "Found earlier · " : ""}Season 2 · ${count} of ${TOTAL}${egg.together ? " · together" : ""}`,
      duration: 7000
    });
    announce(`Secret found: ${egg.name}. ${count} of ${TOTAL}.`);
    try { if (awarded > 0) window.DateGames?.reward?.(awarded, "Secret found"); } catch { /* Optional. */ }
    try { window.DateGames?.refresh?.(); } catch { /* Optional. */ }
    if (mine) {
      postActivity({ kind: "hunt.found", text: `found a season 2 secret: ${egg.name}`, detail: `${count} of ${TOTAL}`, step: "hunt", icon: "key-round", push: true });
    }
    if (justCompleted) finale();
  }

  // Found before (by either of us): the reward again, quietly, at most every few seconds.
  function foundAgain(egg, from) {
    const now = Date.now();
    if (now - (repeatAt[egg.id] || 0) < REPEAT_MS) return;
    repeatAt[egg.id] = now;
    const item = state?.found[egg.id];
    const who = !item ? "" : item.by === "both" ? "together" : item.by === me() ? "by you" : `by ${nameOf(item.by)}`;
    nudge(from);
    toast({ icon: egg.icon, title: egg.name, text: egg.reward, note: who ? `Already found ${who}` : "Already found", duration: 4800 });
  }

  // The 20th secret: both of us get 20 hearts (the Worker did that); show the reveal.
  function finale() {
    postActivity({ kind: "hunt.complete", text: "found the last season 2 secret: all 20 found", detail: `+20 hearts for both of us`, step: "hunt", icon: "trophy", push: true });
    window.setTimeout(() => {
      toast({ icon: "trophy", title: "All 20 found", text: "Every season 2 secret, found together. 20 hearts each.", note: "Season 2 complete", duration: 8000 });
      if (app()?.step === "hunt") finalConfetti();
      else app()?.showStep?.("hunt");
    }, 2200);
  }

  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* The bell is a bonus. */ }
  }

  /* --------------------------- Pointer helpers ----------------------------- */
  // Long presses: { match(target) -> element | null, ms, done(element, startedAt), progress?, cancel? }
  const holdSpecs = [];
  // Short taps (pointer down and up close together): { match(target) -> element | null, done(element, event) }
  const tapSpecs = [];
  let hold = null;
  let tap = null;

  function stopHold() {
    if (!hold) return;
    window.clearTimeout(hold.timer);
    window.cancelAnimationFrame(hold.frame);
    hold.spec.cancel?.(hold.element);
    hold = null;
  }

  function startHold(spec, element, event) {
    const startedAt = Date.now();
    hold = { spec, element, id: event.pointerId, x: event.clientX, y: event.clientY, startedAt, frame: 0, timer: 0 };
    hold.timer = window.setTimeout(() => {
      const done = hold;
      if (!done) return;
      window.cancelAnimationFrame(done.frame);
      hold = null;
      done.spec.cancel?.(done.element);
      if (done.element.isConnected) done.spec.done(done.element, done.startedAt);
    }, spec.ms);
    if (spec.progress) {
      const step = () => {
        if (!hold || hold.spec !== spec) return;
        spec.progress(element, Math.min(1, (Date.now() - startedAt) / spec.ms), Date.now() - startedAt);
        hold.frame = window.requestAnimationFrame(step);
      };
      hold.frame = window.requestAnimationFrame(step);
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (hold) stopHold(); // a second finger: no hold
    else {
      for (const spec of holdSpecs) {
        const element = spec.match(target);
        if (element) {
          startHold(spec, element, event);
          break;
        }
      }
    }
    tap = null;
    for (const spec of tapSpecs) {
      const element = spec.match(target);
      if (element) {
        tap = { spec, element, id: event.pointerId, x: event.clientX, y: event.clientY, at: Date.now() };
        break;
      }
    }
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (hold && event.pointerId === hold.id && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > (hold.spec.move || HOLD_MOVE)) stopHold();
    if (tap && event.pointerId === tap.id && Math.hypot(event.clientX - tap.x, event.clientY - tap.y) > TAP_MOVE) tap = null;
  }, true);

  document.addEventListener("pointerup", (event) => {
    if (hold && event.pointerId === hold.id) stopHold();
    if (tap && event.pointerId === tap.id) {
      const done = tap;
      tap = null;
      if (Date.now() - done.at <= TAP_MS && Math.hypot(event.clientX - done.x, event.clientY - done.y) <= TAP_MOVE) done.spec.done(done.element, { clientX: done.x, clientY: done.y });
    }
  }, true);

  document.addEventListener("pointercancel", (event) => {
    if (hold && event.pointerId === hold.id) stopHold();
    if (tap && event.pointerId === tap.id) tap = null;
  }, true);

  // While a long press runs, no long-press menu or text selection gets in its way.
  document.addEventListener("contextmenu", (event) => { if (hold) event.preventDefault(); }, true);
  document.addEventListener("selectstart", (event) => { if (hold) event.preventDefault(); }, true);
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopHold(); });

  // Runs `done(form)` when one of our forms is sent, before its own script empties it.
  const submitSpecs = [];
  document.addEventListener("submit", (event) => {
    const form = event.target instanceof Element ? event.target : null;
    submitSpecs.forEach((spec) => {
      if (form?.matches(spec.selector)) {
        try { spec.done(form); } catch { /* Never break the form. */ }
      }
    });
  }, true);

  /* ------------------------------ Detectors -------------------------------- */
  // 1. Make a wish: 11:11 or 22:22, hold the heart at the top for 2 s.
  const wishTime = (date) => (date.getHours() === 11 && date.getMinutes() === 11) || (date.getHours() === 22 && date.getMinutes() === 22);
  holdSpecs.push({
    match: (target) => target.closest(".brand-mark"),
    ms: 2000,
    done: (element, startedAt) => {
      if (wishTime(new Date(startedAt)) || wishTime(new Date())) find("wish", { from: element });
    }
  });

  // 2. Today's the day: on the day of the date, hold the countdown for 3 s.
  function dateDay() {
    const plan = app()?.plan;
    return Boolean(plan && plan.status === "confirmed" && plan.date === app().todayISO() && !app().planStarted(plan) && visible($("#planned-countdown")));
  }
  holdSpecs.push({
    match: (target) => target.closest("#planned-countdown"),
    ms: 3000,
    done: (element) => { if (dateDay()) find("dateday", { from: element }); }
  });

  // 3. Ring my bell (together): one holds the bell for 2 s, the other opens theirs within a minute.
  let rangAt = 0;
  holdSpecs.push({
    match: (target) => target.closest("#activity-bell"),
    ms: 2000,
    done: (element) => {
      if (!listening("bell")) return;
      rangAt = Date.now();
      ping("bell", { part: "ring", from: element });
    }
  });
  const activityLayer = $("#activity-layer");
  if (activityLayer) {
    let wasOpen = !activityLayer.hidden;
    new MutationObserver(() => {
      const open = !activityLayer.hidden;
      // Opening the bell is ordinary, so this half never says anything; the ringer's own bell doesn't answer.
      if (open && !wasOpen && listening("bell") && Date.now() - rangAt > 60000) ping("bell", { part: "answer", quiet: true });
      wasOpen = open;
    }).observe(activityLayer, { attributes: true, attributeFilter: ["hidden"] });
  }

  // 4. A minute of silence: sound off, then on again 60 to 66 s later.
  let mutedAt = 0;
  document.addEventListener("click", (event) => {
    const toggle = event.target instanceof Element ? event.target.closest("#sound-toggle") : null;
    if (!toggle) return;
    // Bubbling: effects.js has already switched it.
    const on = toggle.getAttribute("aria-pressed") === "true";
    if (!on) {
      mutedAt = Date.now();
      return;
    }
    const quiet = Date.now() - mutedAt;
    mutedAt = 0;
    if (quiet >= 60000 && quiet <= 66000) find("silence", { from: toggle });
  });

  // 5. The extra-long hug: hold the hug coupon (not its button) for 30 s. A small meter shows after 2 s.
  let hugMeter = null;
  function showHugMeter(element, fraction, elapsed) {
    if (elapsed < 2000) return;
    if (!hugMeter) {
      hugMeter = document.createElement("div");
      hugMeter.className = "hunt-hug";
      hugMeter.setAttribute("aria-hidden", "true");
      hugMeter.innerHTML = `<span class="hunt-hug-ring"></span><span class="hunt-hug-heart">${lucideSvg("heart")}</span>`;
      document.body.append(hugMeter);
    }
    const rect = element.getBoundingClientRect();
    hugMeter.style.left = `${rect.right - 30}px`;
    hugMeter.style.top = `${rect.top - 14}px`;
    hugMeter.style.setProperty("--hug", fraction.toFixed(3));
  }
  function hideHugMeter() {
    hugMeter?.remove();
    hugMeter = null;
  }
  const isHugCoupon = (coupon) => coupon.dataset.id === "long-hug" || /\bhug\b/i.test(coupon.querySelector(".coupon-copy strong")?.textContent || "");
  holdSpecs.push({
    match: (target) => {
      if (target.closest("button")) return null;
      const coupon = target.closest("#coupon-list .coupon");
      return coupon && isHugCoupon(coupon) && listening("hug") ? coupon : null;
    },
    ms: 30000,
    move: 26,
    progress: showHugMeter,
    cancel: hideHugMeter,
    done: (element) => find("hug", { from: element })
  });

  // 6. Hearts only: a fry-game round with at least 4 hearts caught and nothing else.
  const scoreEl = $("#game-score");
  const overlayEl = $("#game-overlay");
  if (scoreEl && overlayEl) {
    let round = null; // { last, hearts, other } while a round runs
    // One observer for the score and the overlay, so the changes arrive in order.
    const roundWatcher = new MutationObserver((records) => {
      for (const record of records) {
        if (record.type === "attributes") {
          if (overlayEl.hidden) round = { last: 0, hearts: 0, other: 0 };
          else if (round) {
            const result = round;
            round = null;
            if (result.hearts >= 4 && result.other === 0) find("heartsonly", { from: $("#game-stage") });
          }
          continue;
        }
        if (!round) continue;
        const score = Number(scoreEl.textContent) || 0;
        // A fry is +1, a heart +3, broccoli takes 2 away (never below 0).
        if (score - round.last === 3) round.hearts += 1;
        else round.other += 1;
        round.last = score;
      }
    });
    roundWatcher.observe(scoreEl, { childList: true, characterData: true, subtree: true });
    roundWatcher.observe(overlayEl, { attributes: true, attributeFilter: ["hidden"] });
  }

  // 7. Day one: hold the date stamp of the oldest journal page for 2 s.
  function oldestPage() {
    return [...document.querySelectorAll("#journal-list .scrap[data-key]")]
      .sort((a, b) => a.dataset.key.localeCompare(b.dataset.key))[0] || null;
  }
  holdSpecs.push({
    match: (target) => {
      const stamp = target.closest("#journal-list .scrap-stamp");
      return stamp && oldestPage()?.contains(stamp) ? stamp : null;
    },
    ms: 2000,
    done: (element) => find("dayone", { from: element })
  });

  // 8. Slow burn: rate one outfit 1, 2, 3, 4, 5 hearts in a row (each within 4 s).
  let burn = null;
  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest(".outfit-card [data-rate]") : null;
    if (!button) return;
    const card = button.closest(".outfit-card");
    const value = Number(button.dataset.rate);
    const now = Date.now();
    if (value === 1) burn = { id: card.dataset.id, next: 2, at: now };
    else if (burn && burn.id === card.dataset.id && value === burn.next && now - burn.at <= 4000) {
      burn.next += 1;
      burn.at = now;
      if (burn.next > 5) {
        burn = null;
        find("slowburn", { from: card });
      }
    } else burn = null;
  }, true);

  // 9. Two peas in a pod (together): one adds "peas" to the snack list, the other "pod".
  submitSpecs.push({
    selector: "#snack-form",
    done: (form) => {
      const input = $("#snack-input", form);
      const text = plain(input?.value);
      if (/^(two |2 |some |green |little )?peas?$/.test(text)) ping("peapod", { part: "pea", from: input, quiet: true });
      else if (/^(a |the |in a |in the )?pods?$/.test(text)) ping("peapod", { part: "pod", from: input });
    }
  });

  // 10. To infinity: type the space ranger's line into the movie search.
  document.addEventListener("input", (event) => {
    if (event.target?.id !== "movie-query") return;
    if (plain(event.target.value) === "to infinity and beyond") find("infinity", { from: event.target });
  }, true);

  // 11. Either way: a palindrome of 7+ letters dropped in the ideas jar.
  submitSpecs.push({
    selector: "#jar-form",
    done: (form) => {
      const letters = plain($("#jar-input", form)?.value).replace(/[^a-z]/g, "");
      if (letters.length >= 7 && new Set(letters).size >= 3 && letters === [...letters].reverse().join("")) find("palindrome", { from: $("#jar") });
    }
  });

  // 12. The first question: "Will you go out with me?" as your own daily question.
  submitSpecs.push({
    selector: "#question-custom-form",
    done: (form) => {
      const text = plain($("#question-custom-input", form)?.value);
      if (/^(will|would) (you|u) go out with me( please)?$/.test(text)) find("firstq", { from: form });
    }
  });

  // 13. Midnight (together): both watch the Games page from 23:59 into 00:00.
  let sawLastMinute = false;
  let midnightSent = "";
  window.setInterval(() => {
    if (document.hidden || app()?.step !== "games" || !listening("midnight")) {
      sawLastMinute = false;
      return;
    }
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();
    if (hours === 23 && minutes === 59) sawLastMinute = true;
    else if (hours === 0 && minutes <= 1 && sawLastMinute) {
      const night = localDay(now);
      if (midnightSent !== night) {
        midnightSent = night;
        ping("midnight", { value: night, from: $("#games-streak .games-flame") });
      }
    } else sawLastMinute = false;
  }, 2000);

  // 14. Why not both: double-tap the "or" between the daily match's two cards.
  let orTapAt = 0;
  tapSpecs.push({
    match: (target) => target.closest("#match-cards .match-or"),
    done: (element) => {
      const now = Date.now();
      if (now - orTapAt <= 450) {
        orTapAt = 0;
        find("neither", { from: element });
      } else orTapAt = now;
    }
  });

  // 15. Over the rainbow: the mind reader's colours tapped red, yellow, green, blue, purple.
  const RAINBOW = ["red", "yellow", "green", "blue", "purple"];
  let rainbowStep = 0;
  let rainbowAt = 0;
  document.addEventListener("click", (event) => {
    const swatch = event.target instanceof Element ? event.target.closest("#duel-card .duel-swatch") : null;
    if (!swatch) return;
    const colour = plain(swatch.getAttribute("aria-label"));
    const now = Date.now();
    if (now - rainbowAt > 6000) rainbowStep = 0;
    rainbowAt = now;
    if (colour === RAINBOW[rainbowStep]) rainbowStep += 1;
    else rainbowStep = colour === RAINBOW[0] ? 1 : 0;
    if (rainbowStep === RAINBOW.length) {
      rainbowStep = 0;
      find("rainbow", { from: $("#duel-card") });
    }
  }, true);

  // 16. Hugs and kisses: X O X O X sent in Wordle (the word list says no; we don't).
  function typedGuess() {
    const row = $("#wordle-board .wordle-row.is-current");
    return row ? [...row.children].map((tile) => tile.textContent.trim().toLowerCase()).join("") : "";
  }
  function checkGuess() {
    if (app()?.step === "wordle" && typedGuess() === "xoxox") find("xoxox", { from: $("#wordle-board .wordle-row.is-current") });
  }
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element && event.target.closest('#wordle-keyboard [data-key="enter"]')) checkGuess();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.repeat || app()?.step !== "wordle") return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("input, textarea, select, [contenteditable], [role='dialog']")) return;
    if (target?.closest("button, a, summary") && !target.closest("#wordle-keyboard")) return;
    if (!visible($("#wordle-keyboard"))) return;
    checkGuess();
  }, true);

  // 17. Pinned up: a tap in each corner of the doodle pad within 10 s.
  let pins = null;
  tapSpecs.push({
    match: (target) => (target.id === "doodle-canvas" && visible($("#doodle-board")) ? target : null),
    done: (canvas, point) => {
      const rect = canvas.getBoundingClientRect();
      const x = (point.clientX - rect.left) / rect.width;
      const y = (point.clientY - rect.top) / rect.height;
      const edge = .16;
      const column = x <= edge ? "l" : x >= 1 - edge ? "r" : "";
      const row = y <= edge ? "t" : y >= 1 - edge ? "b" : "";
      if (!column || !row) return;
      const now = Date.now();
      if (!pins || now - pins.at > 10000) pins = { at: now, corners: new Set() };
      pins.corners.add(row + column);
      if (pins.corners.size === 4) {
        pins = null;
        find("corners", { from: canvas });
      }
    }
  });

  // 18. Three little pictures: eye, heart, users in the icon story composer.
  const chosenEl = $("#icons-chosen");
  if (chosenEl) {
    const iconOf = (slot) => {
      const icon = slot.querySelector(":scope > svg, :scope > i");
      return icon?.getAttribute("data-lucide") || "";
    };
    new MutationObserver(() => {
      const names = [...chosenEl.querySelectorAll("[data-unpick]")].map(iconOf);
      if (names.join(" ") === "eye heart users") find("iloveus", { from: chosenEl });
    }).observe(chosenEl, { childList: true });
  }

  // 19. Team effort (together): both hold the same challenge's picture for 2 s, within 20 s.
  holdSpecs.push({
    match: (target) => target.closest("#challenges-list .challenges-card-icon"),
    ms: 2000,
    done: (element) => {
      if (!listening("team")) return;
      ping("team", { value: element.closest(".challenges-card")?.dataset.id || "card", from: element });
    }
  });

  // 20. Priceless: a love-shop reward called "Priceless" for the highest price (500).
  submitSpecs.push({
    selector: "#shop-form",
    done: (form) => {
      const title = plain($("#shop-title", form)?.value);
      const cost = Math.round(Number(String($("#shop-cost", form)?.value || "").replace(/[^\d]/g, "")) || 0);
      if (/\bpriceless\b/.test(title) && cost >= 500) find("priceless", { from: $("#shop-balance") });
    }
  });

  /* -------------------------------- Page ----------------------------------- */
  const section = $('[data-step="hunt"]');
  const statusEl = $("#hunt-status");
  const lockedEl = $("#hunt-locked");
  const boardEl = $("#hunt-board");
  const finalEl = $("#hunt-final");
  const summaryEl = $("#hunt-summary");
  const gridEl = $("#hunt-grid");
  const errorEl = $("#hunt-error");
  const liveEl = $("#hunt-live");
  let openId = "";
  let buying = "";
  const drawn = {};

  const onPage = () => app()?.step === "hunt";

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  function put(element, key, html) {
    if (!element || drawn[key] === html) return false;
    const focusKey = element.contains(document.activeElement) ? document.activeElement.dataset?.focus : "";
    element.innerHTML = html;
    drawn[key] = html;
    icons(element);
    if (focusKey) element.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
    return true;
  }

  function announce(text) {
    if (!liveEl) return;
    liveEl.textContent = "";
    window.setTimeout(() => { liveEl.textContent = text; }, 60);
  }

  function showError(message) {
    if (!errorEl) return;
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function showStatus(message, { retry = false } = {}) {
    if (!statusEl) return;
    statusEl.hidden = false;
    statusEl.innerHTML = `<span>${escape(message)}</span>${retry ? ' <button class="hunt-retry" type="button" data-hunt-retry>Try again</button>' : ""}`;
    if (boardEl) boardEl.hidden = true;
    if (lockedEl) lockedEl.hidden = true;
  }

  function when(iso) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", day: "numeric", month: "short" }).format(date);
  }

  function finderText(item) {
    if (item.by === "both") return "Found together";
    return item.by === me() ? "Found by you" : `Found by ${nameOf(item.by)}`;
  }

  // A riddle's lines, each its own line (a long one wraps with an indent, like a poem).
  const poem = (text) => String(text).split("\n").map((line) => `<span class="hunt-line">${escape(line)}</span>`).join("");
  const pairIcon = '<span class="hunt-pair" title="Needs both phones"><i class="icon" data-lucide="users" aria-hidden="true"></i><span class="visually-hidden">Needs both of you</span></span>';

  function cardHtml(egg, index) {
    const number = String(index + 1).padStart(2, "0");
    const item = state.found[egg.id];
    if (item) {
      return `<li class="hunt-card is-found${egg.together ? " is-together" : ""}" data-id="${egg.id}">
          <div class="hunt-card-head">
            <span class="hunt-card-badge"><i class="icon" data-lucide="${egg.icon}" aria-hidden="true"></i></span>
            <span class="hunt-card-title"><small>No. ${number}</small><strong>${escape(egg.name)}</strong></span>
            ${egg.together ? pairIcon : ""}
          </div>
          <p class="hunt-card-who"><i class="icon" data-lucide="${item.by === "both" ? "users" : "check"}" aria-hidden="true"></i><span>${escape(finderText(item))}${when(item.at) ? ` · ${escape(when(item.at))}` : ""}</span></p>
          <p class="hunt-card-reward">${escape(egg.reward)}</p>
        </li>`;
    }
    const hinted = state.hints.has(egg.id);
    const head = (pair) => `<span class="hunt-card-head">
        <span class="hunt-card-badge"><i class="icon" data-lucide="${hinted ? "lightbulb" : "lock"}" aria-hidden="true"></i></span>
        <span class="hunt-card-title"><small>No. ${number}</small><strong>???</strong></span>
        ${pair && egg.together ? pairIcon : ""}
      </span>`;
    // Closed, the whole card opens its riddle; open, it spans the row with the riddle and the hint.
    if (openId !== egg.id) {
      return `<li class="hunt-card${egg.together ? " is-together" : ""}${hinted ? " is-hinted" : ""}" data-id="${egg.id}">
          <button class="hunt-card-button" type="button" data-riddle="${egg.id}" data-focus="riddle-${egg.id}" aria-expanded="false" aria-label="Secret ${number}${egg.together ? ", needs both of you" : ""}: read the riddle${hinted ? " and the hint" : ""}">
            ${head(false)}
            <span class="hunt-card-foot">
              <span class="hunt-card-cta"><i class="icon" data-lucide="scroll-text" aria-hidden="true"></i>${hinted ? "Riddle + hint" : "Riddle"}</span>
              ${egg.together ? pairIcon : ""}
            </span>
          </button>
        </li>`;
    }
    const hint = hinted
      ? `<p class="hunt-hint"><i class="icon" data-lucide="lightbulb" aria-hidden="true"></i><span>${escape(egg.hint)}</span></p>`
      : "";
    const buy = hinted ? "" : `<button class="hunt-btn is-hint" type="button" data-hint="${egg.id}" data-focus="hint-${egg.id}"${buying ? " disabled" : ""}>
        <i class="icon" data-lucide="lightbulb" aria-hidden="true"></i><span>${buying === egg.id ? "Unlocking…" : "Clearer hint"}</span><small>${HINT_COST} hearts</small>
      </button>`;
    return `<li class="hunt-card is-open${egg.together ? " is-together" : ""}" data-id="${egg.id}">
        ${head(true)}
        <div class="hunt-riddle" id="hunt-riddle-${egg.id}">
          <p class="hunt-riddle-text">${poem(egg.riddle)}</p>
          ${hint}
        </div>
        <div class="hunt-card-actions">
          ${buy}
          <button class="hunt-btn is-close" type="button" data-riddle="${egg.id}" data-focus="riddle-${egg.id}" aria-expanded="true" aria-controls="hunt-riddle-${egg.id}">
            <i class="icon" data-lucide="chevron-up" aria-hidden="true"></i><span>Close</span>
          </button>
        </div>
      </li>`;
  }

  function summaryHtml() {
    const count = foundCount();
    const counts = { her: 0, sender: 0, both: 0 };
    Object.values(state.found).forEach((item) => { counts[item.by] += 1; });
    const mine = me();
    const who = [
      `You ${counts[mine]}`,
      `${nameOf(other(mine))} ${counts[other(mine)]}`,
      counts.both ? `Together ${counts.both}` : ""
    ].filter(Boolean).join(" · ");
    const balance = state.points[mine].balance;
    return `<div class="hunt-summary-top">
        <span class="hunt-key" aria-hidden="true"><i class="icon" data-lucide="key-round"></i></span>
        <p class="hunt-count"><strong>${count}</strong> of ${TOTAL} found</p>
        <span class="hunt-left">${count >= TOTAL ? "All found" : `${TOTAL - count} left`}</span>
      </div>
      <div class="hunt-progress" role="progressbar" aria-label="Season 2 secrets found" aria-valuemin="0" aria-valuemax="${TOTAL}" aria-valuenow="${count}"><span style="width: ${(count / TOTAL) * 100}%"></span></div>
      <p class="hunt-who">${escape(who)}</p>
      <p class="hunt-rules">Every riddle is free. A clearer hint costs ${HINT_COST} hearts and shows on both phones. Secrets marked <i class="icon" data-lucide="users" aria-hidden="true"></i><span class="visually-hidden">with two people</span> need both of you at once.</p>
      <p class="hunt-balance"><i class="icon" data-lucide="heart" aria-hidden="true"></i><span>You have <strong>${balance}</strong> ${balance === 1 ? "heart" : "hearts"}</span></p>`;
  }

  function finalHtml() {
    const counts = { her: 0, sender: 0, both: 0 };
    Object.values(state.found).forEach((item) => { counts[item.by] += 1; });
    const mine = me();
    const message = (typeof CONFIG !== "undefined" && CONFIG.season2Message) || "All twenty, found together.";
    return `<span class="hunt-final-icon" aria-hidden="true"><i class="icon" data-lucide="trophy"></i></span>
      <p class="hunt-final-eyebrow">Season 2 complete</p>
      <p class="hunt-final-title">All 20 found</p>
      <p class="hunt-final-text">${escape(message)}</p>
      <p class="hunt-final-who">You found ${counts[mine]}, ${escape(nameOf(other(mine)))} found ${counts[other(mine)]}, and ${counts.both} together. 20 extra hearts each.</p>`;
  }

  function render() {
    if (!section || !state) return;
    statusEl.hidden = true;
    if (!state.unlocked) {
      boardEl.hidden = true;
      lockedEl.hidden = false;
      put($("#hunt-locked-progress"), "locked", escape(`${state.season1.found} of ${state.season1.total} found so far.`));
      return;
    }
    lockedEl.hidden = true;
    boardEl.hidden = false;
    finalEl.hidden = !state.completed;
    if (state.completed) put(finalEl, "final", finalHtml());
    put(summaryEl, "summary", summaryHtml());
    put(gridEl, "grid", EGGS.map(cardHtml).join(""));
  }

  // Confetti for the final reveal: once per phone.
  function finalConfetti() {
    let seen = false;
    try { seen = window.localStorage.getItem(FINAL_KEY) === "1"; } catch { /* Private browsing. */ }
    if (seen || !state?.completed) return;
    try { window.localStorage.setItem(FINAL_KEY, "1"); } catch { /* Then it may play again. */ }
    try {
      window.LetterFX?.scatter?.(60);
      window.LetterFX?.chime?.();
      window.LetterSecrets?.spray?.("hearts", { count: 34 });
    } catch { /* Decoration. */ }
    if (reduced()) return;
    const layer = document.createElement("div");
    layer.className = "hunt-confetti";
    layer.setAttribute("aria-hidden", "true");
    const colors = ["#dc4f83", "#ffb067", "#f2c641", "#2e9e83", "#3f7fd8", "#8a5cd1", "#f4a3bf"];
    for (let index = 0; index < 70; index += 1) {
      const piece = document.createElement("span");
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[index % colors.length];
      piece.style.setProperty("--drift", `${(Math.random() - .5) * 120}px`);
      piece.style.setProperty("--spin", `${(Math.random() - .5) * 900}deg`);
      piece.style.animationDuration = `${2.2 + Math.random() * 1.6}s`;
      piece.style.animationDelay = `${Math.random() * .7}s`;
      layer.append(piece);
    }
    document.body.append(layer);
    window.setTimeout(() => layer.remove(), 5000);
  }

  async function buyHint(id) {
    const egg = byId[id];
    if (!egg || buying || !state) return;
    const balance = state.points[me()].balance;
    showError("");
    if (balance < HINT_COST) {
      showError(`A clearer hint costs ${HINT_COST} hearts and you have ${balance}. Play a game to earn more.`);
      return;
    }
    const number = String(EGGS.indexOf(egg) + 1).padStart(2, "0");
    if (!window.confirm(`Spend ${HINT_COST} hearts on a clearer hint for secret No. ${number}? ${nameOf(other())} will see it too.`)) return;
    buying = id;
    render();
    const identity = identitySeq;
    try {
      const data = await app().apiRequest("/games/hunt", "POST", { author: me(), action: "hint", id });
      if (identity !== identitySeq) return;
      openId = id;
      buying = "";
      applyState(data);
      announce(`Hint unlocked for secret ${number}.`);
      try { window.DateGames?.refresh?.(); } catch { /* Optional. */ }
      gridEl.querySelector(`[data-id="${id}"] .hunt-hint`)?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    } catch (error) {
      if (identity !== identitySeq) return;
      buying = "";
      render();
      showError(error.status === 409 && error.data?.balance !== undefined
        ? `Not enough hearts yet: you have ${error.data.balance}, a hint costs ${HINT_COST}.`
        : error.status ? error.message : "Couldn’t unlock the hint. Check your connection and try again.");
      if (error.status) load({ force: true });
    }
  }

  function toggleRiddle(id) {
    openId = openId === id ? "" : id;
    showError("");
    render();
    const card = gridEl.querySelector(`[data-id="${id}"]`);
    card?.querySelector("[data-riddle]")?.focus({ preventScroll: true });
    if (openId) card?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
  }

  section?.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("button") : null;
    if (!button || button.disabled) return;
    if (button.matches("[data-riddle]")) toggleRiddle(button.dataset.riddle);
    else if (button.matches("[data-hint]")) buyHint(button.dataset.hint);
    else if (button.matches("[data-hunt-retry]")) {
      showStatus("Loading the hunt…");
      load({ force: true });
    }
  });

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (!document.hidden && onPage()) load({ force: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------- Wiring ---------------------------------- */
  function resetIdentity() {
    identitySeq += 1;
    state = null;
    loadedAt = 0;
    openId = "";
    buying = "";
    celebrated.clear();
    Object.keys(drawn).forEach((key) => { delete drawn[key]; });
    if (onPage()) showStatus("Loading the hunt…");
    load({ force: true });
  }
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });

  document.addEventListener("date:step", (event) => {
    stopHold();
    if (event.detail.name === "hunt") {
      showError("");
      if (state) render();
      else showStatus("Loading the hunt…");
      load({ force: true }).then(() => { if (onPage()) finalConfetti(); });
      startPolling();
    } else {
      stopPolling();
      load();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) load({ force: onPage() });
  });
  window.addEventListener("online", () => load({ force: true }));

  // The letter's own script (app.js) loads last: start once it's there.
  let tries = 0;
  const starter = window.setInterval(() => {
    tries += 1;
    if (window.DateApp?.apiRequest) {
      window.clearInterval(starter);
      load({ force: true });
    } else if (tries > 600) {
      window.clearInterval(starter);
    }
  }, 50);
})();
