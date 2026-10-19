/*
 * Movie night: one shared list of movies we want to watch. Either of us adds
 * movies (searched on TMDB through the Worker, or typed when posters are off),
 * hearts the ones we're in the mood for, and spins the wheel. The Worker picks
 * the movie; the wheel only animates to land on it, so both phones agree.
 * Synced through the Worker; changes show instantly and roll back if saving fails.
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="movies"]');
  if (!section) return;

  const form = $("#movie-form");
  const queryInput = $("#movie-query");
  const yearInput = $("#movie-year");
  const addButton = $("#movie-add-button");
  const clearButton = $("#movie-query-clear");
  const busyEl = $("#movie-query-busy");
  const noteEl = $("#movie-search-note");
  const hitsEl = $("#movie-hits");
  const hitsStatus = $("#movie-hits-status");
  const addErrorEl = $("#movie-add-error");
  const modeEl = $("#movie-mode");
  const modeHint = $("#movie-mode-hint");
  const countAll = $("#movie-count-all");
  const countBoth = $("#movie-count-both");
  const wheelEl = $("#movie-wheel");
  const discEl = $("#movie-wheel-disc");
  const svgEl = $("#movie-wheel-svg");
  const pointerEl = $("#movie-wheel-pointer");
  const statusEl = $("#movie-spin-status");
  const spinButton = $("#movie-spin-button");
  const pickEl = $("#movie-pick");
  const listCount = $("#movie-list-count");
  const errorEl = $("#movie-error");
  const listEl = $("#movie-list");
  const emptyEl = $("#movie-empty");
  const watchedEl = $("#movie-watched");
  const watchedCount = $("#movie-watched-count");
  const watchedList = $("#movie-watched-list");
  const creditEl = $("#movie-credit");

  const POLL_MS = 10000;
  const SEARCH_DELAY = 350;
  const MAX_TITLE = 120;
  const MAX_QUERY = 80;
  const WHEEL_MAX = 12;       // slices on the wheel; bigger lists show 12, always including the pick
  const SPIN_SPEED = 0.6;     // degrees per millisecond at full speed
  const SPIN_RAMP = 450;      // milliseconds to get up to speed
  const POINTER = 90;         // the pointer sits at 3 o'clock (degrees clockwise from 12)
  const LABEL_END = 87;       // wheel labels end just inside the pegs (viewBox units)...
  const LABEL_ROOM = 59;      // ...and must stay clear of the hub
  const POSTER_PATH = /^\/[A-Za-z0-9._-]{1,100}$/; // a TMDB poster_path, like "/abc.jpg"
  const MODE_KEY = "date-letter-movie-mode";
  const POSTERS_OFF_KEY = "date-letter-movie-posters-off";
  const OFFLINE = "Check your connection and try again.";
  // Soft placeholder colors for movies without a poster.
  const TINTS = [["#fde4ec", "#f4bdd0"], ["#fdeadf", "#f2c3b0"], ["#f1e5f7", "#d8c0ea"], ["#fff0e0", "#f5cfa6"], ["#e8eefa", "#c6d1f0"], ["#fbe3ea", "#e9b0c6"]];
  // Slice fill and label color; three tones so neighbors never match.
  const SLICES = [["#dc4f83", "#ffffff"], ["#f9cfdd", "#8e2a50"], ["#ad315f", "#ffffff"]];

  let confirmed = { movies: [], pick: null }; // last state the server sent
  let pending = [];      // optimistic changes still on their way
  let loaded = false;
  let epoch = 0;         // bumps on every change, so an older poll can't undo it
  let loads = 0;         // only the latest load counts when two overlap on a slow connection
  let queue = Promise.resolve();
  let pollTimer = null;
  let tempCount = 0;
  const rendered = new WeakMap();
  const flashTimers = new WeakMap();
  const heartsPosted = new Set(); // movies this visit already told the other phone about

  let mode = readMode();     // "all" | "both": which movies this phone wants on the wheel
  let postersOff = readPostersOff(); // the Worker has no TMDB key: typing titles only (for this session)
  let searchFailed = false;  // search didn't answer this time: typing titles instead
  let searchTimer = null;
  let searchToken = 0;
  let hits = [];             // search results on screen
  let hitsQuery = "";
  const searchCache = new Map();

  let rotation = 0;          // the wheel's rotation in degrees, clockwise
  let wheelItems = [];       // movies on the wheel, slice by slice (clockwise from 12 o'clock)
  let wheelSig = "";
  let labelsFitted = true;   // false while the wheel was drawn off screen (labels can't be measured)
  let shownPick = null;      // "id|at" of the pick on screen; null until the first load
  let spinning = false;
  let anim = null;           // the running wheel animation
  let lastSlice = -1;
  let lastTick = 0;
  let audio = null;
  let openMenu = null;       // the card whose menu is open

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = (who) => (who === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  const escape = (text) => app().escapeHtml(text ?? "");
  const icon = (name, extra = "") => `<i class="icon${extra ? ` ${extra}` : ""}" data-lucide="${name}" aria-hidden="true"></i>`;
  const time = (iso) => Date.parse(iso) || 0;
  const mod = (value, base) => ((value % base) + base) % base;
  const cleanText = (text) => String(text ?? "").trim().replace(/\s+/g, " ");
  const sameText = (a, b) => cleanText(a).toLowerCase() === cleanText(b).toLowerCase();
  const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const bothHearted = (movie) => Boolean(movie.hearts?.her && movie.hearts?.sender);
  const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

  function readMode() {
    try { return window.localStorage.getItem(MODE_KEY) === "both" ? "both" : "all"; } catch { return "all"; }
  }

  function saveMode() {
    try { window.localStorage.setItem(MODE_KEY, mode); } catch { /* Private browsing. */ }
  }

  function readPostersOff() {
    try { return window.sessionStorage.getItem(POSTERS_OFF_KEY) === "1"; } catch { return false; }
  }

  function savePostersOff() {
    try { window.sessionStorage.setItem(POSTERS_OFF_KEY, "1"); } catch { /* Private browsing. */ }
  }

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // Replaces a part's markup only when it changed, keeping focus on the same control.
  function setHtml(element, html) {
    if (rendered.get(element) === html) return false;
    const focused = element.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    element.innerHTML = html;
    rendered.set(element, html);
    icons(element);
    if (focused) element.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
    return true;
  }

  function showError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function showAddMessage(message, { info = false } = {}) {
    addErrorEl.textContent = message || "";
    addErrorEl.classList.toggle("is-info", info);
    addErrorEl.hidden = !message;
  }

  // Offline the browser only says "Failed to fetch" / "Load failed", so say it in plain words.
  function failed(error, what) {
    showError(error?.status ? error.message : `${what} ${OFFLINE}`);
  }

  // Tells the other phone (bell + push) through activity.js; optional, never blocks anything.
  function activity(kind, text, extra = {}) {
    try {
      window.DateActivity?.post?.({ kind, text, step: "movies", ...extra })?.catch?.(() => {});
    } catch { /* The bell is a nice-to-have. */ }
  }

  function stamp(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    const zone = "Europe/Zurich";
    const day = (value) => new Intl.DateTimeFormat("en-CA", { timeZone: zone }).format(value);
    const clock = new Intl.DateTimeFormat("en-GB", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
    if (day(date) === day(new Date())) return `today ${clock}`;
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: zone, day: "numeric", month: "short" }).format(date)}, ${clock}`;
  }

  function shortDate(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Zurich", day: "numeric", month: "short" }).format(date);
  }

  /* ------------------------------- State --------------------------------- */
  function normalize(data) {
    const movies = (Array.isArray(data?.movies) ? data.movies : []).filter((movie) => movie && movie.id).map((movie) => ({
      ...movie,
      title: String(movie.title || ""),
      year: movie.year ? String(movie.year) : "",
      poster: typeof movie.poster === "string" ? movie.poster : "",
      overview: typeof movie.overview === "string" ? movie.overview : "",
      hearts: { ...(movie.hearts || {}) },
      watched: Boolean(movie.watched)
    }));
    const pick = data?.pick && typeof data.pick === "object" && data.pick.id ? { ...data.pick } : null;
    return { movies, pick };
  }

  // What the page shows: the server's state with the not-yet-saved changes on top.
  function current() {
    const state = {
      movies: confirmed.movies.map((movie) => ({ ...movie, hearts: { ...movie.hearts } })),
      pick: confirmed.pick ? { ...confirmed.pick } : null
    };
    pending.forEach((op) => op.apply?.(state));
    return state;
  }

  // The pick only counts while its movie is still on the list and not watched yet.
  function activePick(state) {
    const movie = state.pick && state.movies.find((item) => item.id === state.pick.id);
    return movie && !movie.watched && !movie.pending ? { pick: state.pick, movie } : null;
  }

  function onWheel(state) {
    const unwatched = state.movies.filter((movie) => !movie.watched && !movie.pending);
    return { all: unwatched, both: unwatched.filter(bothHearted) };
  }

  // "Both hearted" falls back to all movies while there are none (the choice itself is kept).
  function wheelMode(pools) {
    return mode === "both" && pools.both.length ? "both" : "all";
  }

  function findDuplicate(movies, { title, year, tmdbId }) {
    return movies.find((movie) => (tmdbId && Number(movie.tmdbId) === Number(tmdbId))
      // Typed without a year: any movie with that title counts.
      || (sameText(movie.title, title) && (!year || !movie.year || String(movie.year) === String(year))));
  }

  function posterUrl(path, size) {
    return POSTER_PATH.test(path || "") ? `https://image.tmdb.org/t/p/${size}${path}` : "";
  }

  function tint(title) {
    let hash = 0;
    for (const character of String(title)) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return TINTS[hash % TINTS.length];
  }

  // A poster, or a soft gradient with the title when there is none (or it can't load).
  function posterHtml(movie, size = "w342", { label = true } = {}) {
    const url = posterUrl(movie.poster, size);
    const [from, to] = tint(movie.title);
    return `${url ? `<img src="${escape(url)}" alt="" loading="lazy" decoding="async">` : ""}<span class="movie-poster-fallback" style="--tint-a:${from};--tint-b:${to}">${icon("film")}${label ? `<span>${escape(movie.title)}</span>` : ""}</span>`;
  }

  /* ------------------------------- Render -------------------------------- */
  function render() {
    renderAddMode();
    if (!loaded) return;
    const state = current();
    renderLists(state);
    renderSpin(state);
  }

  function bodyHtml(movie) {
    const self = me();
    const title = escape(movie.title);
    if (movie.watched) {
      const when = movie.watchedAt ? `watched ${shortDate(movie.watchedAt)}` : "watched";
      return `<strong class="movie-title">${title}</strong><small class="movie-meta">${escape([movie.year, when].filter(Boolean).join(" · "))}</small>`;
    }
    const meta = movie.pending ? "Adding…" : `added by ${nameOf(movie.author) || "one of us"}`;
    const mine = Boolean(movie.hearts[self]);
    const theirs = Boolean(movie.hearts[other(self)]);
    const otherName = escape(nameOf(other(self)));
    return `<strong class="movie-title">${title}</strong>
      <small class="movie-meta">${escape([movie.year, meta].filter(Boolean).join(" · "))}</small>
      <span class="movie-hearts">
        <button class="movie-heart is-mine${mine ? " is-on" : ""}" type="button" aria-pressed="${mine}" aria-label="Your heart for ${title}" data-heart data-focus="heart"${movie.pending ? " disabled" : ""}>${icon("heart")}<span>You</span></button>
        <span class="movie-heart is-theirs${theirs ? " is-on" : ""}" role="img" aria-label="${otherName} ${theirs ? "hearted it" : "hasn't hearted it"}">${icon("heart")}<span>${otherName}</span></span>
      </span>`;
  }

  function menuHtml(movie) {
    const first = movie.watched
      ? `<button type="button" role="menuitem" data-menu="unwatch" data-focus="menu-unwatch">${icon("undo-2")}<span>Not watched yet</span></button>`
      : `<button type="button" role="menuitem" data-menu="watched" data-focus="menu-watched">${icon("check")}<span>Watched</span></button>`;
    return `${first}<button class="is-danger" type="button" role="menuitem" data-menu="remove" data-focus="menu-remove">${icon("trash-2")}<span>Remove</span></button>`;
  }

  function createCard(id) {
    const card = document.createElement("li");
    card.className = "movie-card is-new";
    card.dataset.id = id;
    card.innerHTML = `<div class="movie-poster">
        <div class="movie-art"></div>
        <div class="movie-badges"></div>
        <button class="movie-menu-button" type="button" aria-haspopup="menu" aria-expanded="false" data-focus="menu">${icon("ellipsis")}</button>
        <div class="movie-menu" role="menu" hidden></div>
      </div>
      <div class="movie-body"></div>`;
    card.addEventListener("animationend", () => card.classList.remove("is-new"), { once: true });
    icons(card);
    return card;
  }

  function updateCard(card, movie) {
    const both = !movie.watched && bothHearted(movie);
    card.classList.toggle("is-pending", Boolean(movie.pending));
    card.classList.toggle("is-both", both);
    const art = card.querySelector(".movie-art");
    if (setHtml(art, posterHtml(movie))) art.classList.remove("is-broken");
    setHtml(card.querySelector(".movie-badges"), both ? `<span class="movie-badge">${icon("heart")}<span>Both hearted</span></span>` : "");
    const menuButton = card.querySelector(".movie-menu-button");
    menuButton.setAttribute("aria-label", `More for ${movie.title}`);
    menuButton.disabled = Boolean(movie.pending);
    setHtml(card.querySelector(".movie-menu"), menuHtml(movie));
    setHtml(card.querySelector(".movie-body"), bodyHtml(movie));
  }

  // Updates a list in place, so polling doesn't replay animations, reload posters or steal focus.
  function syncList(container, movies) {
    const cards = new Map([...container.children].map((element) => [element.dataset.id, element]));
    movies.forEach((movie, index) => {
      let card = cards.get(movie.id);
      if (!card) {
        // A just-saved movie keeps the card it had while it was still "Adding…".
        card = [...cards.values()].find((element) => element.dataset.temp && !movies.some((item) => item.id === element.dataset.id)
          && findDuplicate([{ title: element.dataset.title, year: element.dataset.year, tmdbId: Number(element.dataset.tmdb) || null }], movie));
      }
      if (card) cards.delete(card.dataset.id);
      else card = createCard(movie.id);
      card.dataset.id = movie.id;
      card.dataset.title = movie.title;
      card.dataset.year = movie.year || "";
      card.dataset.tmdb = movie.tmdbId ? String(movie.tmdbId) : "";
      if (movie.pending) card.dataset.temp = "1";
      else delete card.dataset.temp;
      updateCard(card, movie);
      if (container.children[index] !== card) container.insertBefore(card, container.children[index] || null);
    });
    cards.forEach((card) => {
      if (card === openMenu) openMenu = null;
      card.remove();
    });
  }

  function renderLists(state) {
    const open = state.movies.filter((movie) => !movie.watched).sort((a, b) => time(b.at) - time(a.at));
    const watched = state.movies.filter((movie) => movie.watched).sort((a, b) => time(b.watchedAt) - time(a.watchedAt));
    syncList(listEl, open);
    syncList(watchedList, watched);
    listCount.textContent = String(open.length);
    emptyEl.hidden = open.length > 0;
    const how = manualMode() ? "Type" : "Search for";
    emptyEl.textContent = watched.length
      ? `We've watched everything on our list. ${how} the next one above.`
      : `No movies yet. ${how} one above and it lands on our list.`;
    watchedEl.hidden = !watched.length;
    watchedCount.textContent = String(watched.length);
    // TMDB asks for credit wherever its posters show up.
    creditEl.hidden = postersOff && !state.movies.some((movie) => posterUrl(movie.poster, "w342"));
  }

  /* ------------------------------ The wheel ------------------------------ */
  function point(radius, degrees) {
    const radians = (degrees * Math.PI) / 180;
    return `${(radius * Math.sin(radians)).toFixed(2)} ${(-radius * Math.cos(radians)).toFixed(2)}`;
  }

  function sliceColors(index, count) {
    if (count <= 2) return SLICES[index];
    let tone = index % 3;
    if (index === count - 1 && tone === 0) tone = 1; // the last slice touches the first one
    return SLICES[tone];
  }

  function wheelMarkup(items) {
    const radius = 96;
    if (!items.length) return `<circle class="movie-wheel-empty" r="${radius}"/><circle class="movie-wheel-empty-ring" r="64"/>`;
    const count = items.length;
    const slice = 360 / count;
    const slices = items.map((movie, index) => {
      const [fill, ink] = sliceColors(index, count);
      const start = index * slice;
      const shape = count === 1
        ? `<circle r="${radius}" fill="${fill}"/>`
        : `<path d="M0 0L${point(radius, start)}A${radius} ${radius} 0 ${slice > 180 ? 1 : 0} 1 ${point(radius, start + slice)}Z" fill="${fill}"/>`;
      // Labels run from the hub out to the rim, so the slice under the pointer reads left to right.
      return `<g class="movie-wheel-slice" data-id="${escape(movie.id)}">${shape}<text transform="rotate(${(start + slice / 2 - 90).toFixed(2)})" x="${LABEL_END}" y="0" dy=".35em" text-anchor="end" fill="${ink}" data-title="${escape(movie.title)}">${escape(clip(movie.title, 12))}</text></g>`;
    }).join("");
    const pegs = count > 1
      ? items.map((_, index) => `<circle class="movie-wheel-peg" r="2.2" transform="rotate(${(index * slice).toFixed(2)}) translate(0 -${radius - 4})"/>`).join("")
      : "";
    return `${slices}<circle class="movie-wheel-rim" r="${radius}"/>${pegs}`;
  }

  // Which movies go on the wheel: all of them up to 12, otherwise 12 that include the pick.
  function layoutWheel(pool, pickId = null, { fresh = false } = {}) {
    const ordered = [...pool].sort((a, b) => time(a.at) - time(b.at) || String(a.id).localeCompare(String(b.id)));
    if (ordered.length <= WHEEL_MAX) return ordered;
    const byId = new Map(ordered.map((movie) => [movie.id, movie]));
    const kept = wheelItems.map((movie) => byId.get(movie.id)).filter(Boolean);
    if (kept.length === WHEEL_MAX && (!pickId || kept.some((movie) => movie.id === pickId))) return kept;
    if (fresh && byId.has(pickId)) {
      // A new spin: the pick plus 11 others at random, so every movie gets its turn on the wheel.
      const others = ordered.filter((movie) => movie.id !== pickId);
      for (let index = others.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(Math.random() * (index + 1));
        [others[index], others[swap]] = [others[swap], others[index]];
      }
      return ordered.filter((movie) => movie.id === pickId || others.slice(0, WHEEL_MAX - 1).includes(movie));
    }
    const subset = ordered.slice(0, WHEEL_MAX);
    if (byId.has(pickId) && !subset.some((movie) => movie.id === pickId)) subset[WHEEL_MAX - 1] = byId.get(pickId);
    return subset;
  }

  function drawWheel(items) {
    wheelItems = items;
    const sig = items.map((movie) => `${movie.id}:${movie.title}`).join("|");
    if (sig === wheelSig && svgEl.childElementCount) return false;
    wheelSig = sig;
    svgEl.innerHTML = wheelMarkup(items);
    labelsFitted = fitLabels();
    wheelEl.setAttribute("aria-label", items.length ? `The movie wheel with ${plural(items.length, "movie")}` : "The movie wheel, still empty");
    lastSlice = -1;
    return true;
  }

  // Shrinks each label (down to 7 units from the base 9) and then shortens it until it fits
  // between the hub and the rim. Returns false while the wheel isn't on screen to measure.
  function fitLabels() {
    const labels = [...svgEl.querySelectorAll("text[data-title]")];
    if (!labels.length) return true;
    if (!labels[0].getComputedTextLength()) return false;
    labels.forEach((label) => {
      const title = label.dataset.title;
      label.style.fontSize = "";
      label.textContent = title;
      const length = label.getComputedTextLength();
      if (length <= LABEL_ROOM) return;
      // Text doesn't scale quite linearly with its size, hence the 3% margin.
      label.style.fontSize = `${Math.max(7, (0.97 * 9 * LABEL_ROOM) / length).toFixed(2)}px`;
      let width = label.getComputedTextLength();
      if (width <= LABEL_ROOM) return;
      let shown = title.slice(0, Math.max(3, Math.floor((title.length * LABEL_ROOM) / width))).trimEnd();
      label.textContent = `${shown}…`;
      while (shown.length > 3 && (width = label.getComputedTextLength()) > LABEL_ROOM) {
        shown = shown.slice(0, -1).trimEnd();
        label.textContent = `${shown}…`;
      }
    });
    return true;
  }

  // The rotation that puts slice `index` under the pointer; `jitter` (-0.5..0.5) moves it inside the slice.
  function targetAngle(index, count, jitter = 0) {
    return mod(POINTER - (index + 0.5 + jitter) * (360 / count), 360);
  }

  function setRotation(degrees) {
    rotation = degrees;
    discEl.style.transform = `rotate(${degrees.toFixed(3)}deg)`;
  }

  function sliceAtPointer() {
    const count = wheelItems.length;
    return count ? Math.floor(mod(POINTER - rotation, 360) / (360 / count)) % count : -1;
  }

  function primeAudio() {
    if (window.LetterFX?.tick || document.getElementById("sound-toggle")?.getAttribute("aria-pressed") === "false") return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      audio = audio || new Context();
      if (audio.state === "suspended") audio.resume().catch(() => {});
    } catch { audio = null; }
  }

  // A light tick each time a peg passes the pointer.
  function tick() {
    const now = performance.now();
    if (now - lastTick < 45) return;
    lastTick = now;
    try { pointerEl.animate?.([{ transform: "rotate(0deg)" }, { transform: "rotate(-18deg)" }, { transform: "rotate(0deg)" }], { duration: 110, easing: "ease-out" }); } catch { /* Decoration. */ }
    if (window.LetterFX?.tick) {
      window.LetterFX.tick();
      return;
    }
    if (!audio || document.getElementById("sound-toggle")?.getAttribute("aria-pressed") === "false") return;
    try {
      const start = audio.currentTime;
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.type = "triangle";
      tone.frequency.setValueAtTime(1700, start);
      tone.frequency.exponentialRampToValueAtTime(850, start + 0.03);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.022, start + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.045);
      tone.connect(gain);
      gain.connect(audio.destination);
      tone.start(start);
      tone.stop(start + 0.06);
    } catch { /* Sound is optional. */ }
  }

  function stopAnim() {
    if (!anim) return;
    window.cancelAnimationFrame(anim.raf);
    const done = anim.done;
    anim = null;
    done();
  }

  // Runs `step(now)` every frame until it returns true.
  function animate(step) {
    stopAnim();
    return new Promise((resolve) => {
      const handle = { raf: 0, done: resolve };
      const frame = (now) => {
        if (anim !== handle) return;
        const finished = step(now);
        const slice = sliceAtPointer();
        if (slice !== lastSlice) {
          lastSlice = slice;
          tick();
        }
        if (finished) {
          anim = null;
          setRotation(mod(rotation, 360));
          resolve();
          return;
        }
        handle.raf = window.requestAnimationFrame(frame);
      };
      anim = handle;
      handle.raf = window.requestAnimationFrame(frame);
    });
  }

  // Starts spinning right away (before the server answered); `land` then eases out onto the pick.
  function freeSpin() {
    const from = rotation;
    const started = performance.now();
    let landing = null;
    const freeAngle = (elapsed) => {
      const t = Math.max(0, elapsed);
      return t < SPIN_RAMP
        ? from + (SPIN_SPEED * t * t) / (2 * SPIN_RAMP)
        : from + (SPIN_SPEED * SPIN_RAMP) / 2 + SPIN_SPEED * (t - SPIN_RAMP);
    };
    const running = animate((now) => {
      if (!landing) {
        setRotation(freeAngle(now - started));
        return false;
      }
      const progress = Math.min(1, Math.max(0, (now - landing.start) / landing.duration));
      // Quartic ease-out: starts at full speed, crawls over the last pegs.
      setRotation(landing.from + landing.distance * (1 - Math.pow(1 - progress, 4)));
      return progress >= 1;
    });
    const settle = (target, minDuration) => new Promise((resolve) => {
      const begin = () => {
        if (!anim) {
          resolve();
          return;
        }
        const elapsed = performance.now() - started;
        if (elapsed < SPIN_RAMP) {
          window.setTimeout(begin, SPIN_RAMP - elapsed);
          return;
        }
        const start = freeAngle(elapsed);
        const minimum = (SPIN_SPEED * minDuration) / 4;
        const distance = target === null ? minimum : minimum + mod(target - (start + minimum), 360);
        // Matching the free spin's speed at the hand-over keeps the motion seamless.
        landing = { start: performance.now(), from: start, distance, duration: (4 * distance) / SPIN_SPEED };
        running.then(resolve);
      };
      begin();
    });
    return { land: (target) => settle(target, 2800), stop: () => settle(null, 1000) };
  }

  // The other phone spun: turn once and settle on their pick.
  function settleTo(target) {
    const from = rotation;
    const distance = 360 + mod(target - from, 360);
    let start = null;
    return animate((now) => {
      if (start === null) start = now;
      const progress = Math.min(1, (now - start) / 1700);
      const eased = progress < 0.5 ? 4 * progress ** 3 : 1 - Math.pow(-2 * progress + 2, 3) / 2;
      setRotation(from + distance * eased);
      return progress >= 1;
    });
  }

  function setStatus(text, { error = false } = {}) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-error", error);
  }

  function spinnerName(pick) {
    return pick.by === me() ? "You" : nameOf(pick.by) || "Someone";
  }

  function renderPick(found) {
    pickEl.hidden = !found;
    if (!found) {
      setHtml(pickEl, "");
      return;
    }
    const { pick, movie } = found;
    const meta = [movie.year, pick.at ? `spun ${stamp(pick.at)}` : ""].filter(Boolean).join(" · ");
    setHtml(pickEl, `<div class="movie-art movie-pick-art">${posterHtml(movie)}</div>
      <div class="movie-pick-copy">
        <p class="movie-pick-label">${icon("sparkles")}<span>Tonight's movie</span></p>
        <h3 class="movie-pick-title">${escape(movie.title)}</h3>
        ${meta ? `<p class="movie-pick-meta">${escape(meta)}</p>` : ""}
        ${movie.overview ? `<p class="movie-pick-overview">${escape(movie.overview)}</p>` : ""}
      </div>
      <div class="movie-pick-actions">
        <button class="btn btn-secondary" type="button" data-pick="watched" data-focus="pick-watched">${icon("check")} Watched it</button>
        <button class="btn btn-primary" type="button" data-pick="again" data-focus="pick-again">${icon("dices")} Spin again</button>
      </div>`);
  }

  function renderSpin(state) {
    const pools = onWheel(state);
    const shown = wheelMode(pools);
    countAll.textContent = String(pools.all.length);
    countBoth.textContent = String(pools.both.length);
    modeEl.querySelectorAll("[data-mode]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.mode === shown));
      const locked = button.dataset.mode === "both" && !pools.both.length;
      button.disabled = spinning || locked;
      if (locked) button.setAttribute("aria-describedby", "movie-mode-hint");
      else button.removeAttribute("aria-describedby");
    });
    modeHint.hidden = pools.both.length > 0 || !pools.all.length;
    if (spinning) return; // the spin itself draws the wheel and reveals the pick

    let candidates = pools[shown];
    const found = activePick(state);
    // A pick from the other pool (all movies, while this phone shows both hearted) still goes on the wheel.
    if (found && !candidates.some((movie) => movie.id === found.pick.id)) candidates = [...candidates, found.movie];
    const pickKey = found ? `${found.pick.id}|${found.pick.at}` : "";
    const items = layoutWheel(candidates, found?.pick.id);
    const redrawn = drawWheel(items);
    const index = found ? items.findIndex((movie) => movie.id === found.pick.id) : -1;
    if (pickKey !== shownPick) {
      // A pick that shows up while the page is open came from the other phone: let the wheel turn to it.
      const fromOtherPhone = shownPick !== null && found;
      shownPick = pickKey;
      if (index >= 0) {
        const target = targetAngle(index, items.length);
        if (fromOtherPhone && !reduced() && !document.hidden && app()?.step === "movies") settleTo(target);
        else {
          stopAnim();
          setRotation(target);
        }
      }
    } else if (redrawn && index >= 0 && !anim) {
      setRotation(targetAngle(index, items.length));
    }

    renderPick(found);
    spinButton.hidden = Boolean(found);
    spinButton.disabled = !candidates.length;
    if (found) setStatus(`${spinnerName(found.pick)} spun: ${found.movie.title}`);
    else if (!pools.all.length) setStatus("Add a movie and it goes on the wheel.");
    else if (candidates.length > WHEEL_MAX) setStatus(`${WHEEL_MAX} of ${candidates.length} on the wheel. Each one has the same chance.`);
    else setStatus(shown === "both" ? `${plural(candidates.length, "movie")} you both hearted` : `${plural(candidates.length, "movie")} on the wheel`);
  }

  async function spin() {
    if (spinning || !loaded) return;
    const pools = onWheel(current());
    const spinMode = wheelMode(pools);
    const pool = pools[spinMode];
    if (!pool.length) return;
    const calm = reduced();
    // Keyboard and VoiceOver users land on "Spin again" afterwards instead of losing their place.
    const keepFocus = document.activeElement === spinButton || pickEl.contains(document.activeElement);
    primeAudio(); // inside the tap, so iOS lets the ticks play
    closeMenu();
    showError("");
    spinning = true;
    renderSpin(current());
    pickEl.hidden = true;
    spinButton.hidden = false;
    spinButton.disabled = true;
    wheelEl.classList.add("is-spinning");
    setStatus("Spinning…");
    const motion = calm ? null : freeSpin();

    let result;
    try {
      result = normalize(await send({ action: "spin", author: me(), mode: spinMode }));
      if (!activePick(result)) throw new Error("The wheel couldn't pick a movie. Please try again.");
    } catch (error) {
      if (motion) await motion.stop();
      spinning = false;
      wheelEl.classList.remove("is-spinning");
      render();
      setStatus(error.status || error.message?.startsWith("The wheel") ? error.message : `Couldn’t spin the wheel. ${OFFLINE}`, { error: true });
      if (keepFocus && !spinButton.hidden) spinButton.focus({ preventScroll: true });
      return;
    }

    const { pick, movie } = activePick(result);
    activity("movies.spin", `spun the wheel: ${clip(movie.title, 110)}`, {
      detail: spinMode === "both" ? "From the movies we both hearted" : "",
      icon: "dices",
      push: true
    });
    // The server's list may have changed since the spin started: lay the wheel out from its answer.
    const fresh = onWheel(result)[spinMode];
    if (!fresh.some((item) => item.id === movie.id)) fresh.push(movie);
    const items = layoutWheel(fresh, movie.id, { fresh: true });
    drawWheel(items);
    const target = targetAngle(items.findIndex((item) => item.id === movie.id), items.length, (Math.random() - 0.5) * 0.64);
    if (motion) await motion.land(target);
    else setRotation(target);

    shownPick = `${pick.id}|${pick.at}`;
    spinning = false;
    wheelEl.classList.remove("is-spinning");
    render();
    if (keepFocus) pickEl.querySelector('[data-pick="again"]')?.focus({ preventScroll: true });
    window.LetterFX?.chime?.();
    if (!calm) window.LetterFX?.burstFrom?.(pickEl, 22);
    pickEl.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "nearest" });
  }

  /* ------------------------------- Sync ---------------------------------- */
  async function load({ quiet = false } = {}) {
    if (spinning) return;
    const started = epoch;
    const ticket = loads += 1;
    if (!loaded && !quiet) {
      emptyEl.hidden = false;
      emptyEl.textContent = "Loading our list…";
    }
    try {
      const data = await app().apiRequest("/movies");
      if (ticket !== loads || started !== epoch || pending.length || spinning) return;
      confirmed = normalize(data);
      loaded = true;
      if (!quiet) showError("");
      render();
    } catch (error) {
      if (loaded || quiet || ticket !== loads) return;
      emptyEl.hidden = false;
      emptyEl.textContent = error.status === 404
        ? "The movie list needs the latest server update first."
        : `Couldn’t load our movies. ${OFFLINE}`;
      setStatus("");
    }
  }

  // Sends one change; changes go out one at a time so the answers come back in order.
  // `apply` shows it right away and is dropped again (rolled back) if saving fails.
  function send(body, apply = null) {
    const op = { apply };
    if (apply) pending.push(op);
    epoch += 1;
    render();
    const run = queue.then(async () => {
      try {
        const data = await app().apiRequest("/movies", "POST", body);
        confirmed = normalize(data);
        loaded = true;
        return data;
      } catch (error) {
        // A refusal can carry the current list (say, the other phone just changed it): catch up with it.
        if (Array.isArray(error.data?.movies)) confirmed = normalize(error.data);
        throw error;
      } finally {
        pending = pending.filter((item) => item !== op);
        epoch += 1;
        render();
      }
    });
    queue = run.catch(() => {});
    return run;
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (!document.hidden && app()?.step === "movies") load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  /* ------------------------------ Actions -------------------------------- */
  function highlight(id) {
    let card = listEl.querySelector(`.movie-card[data-id="${CSS.escape(id)}"]`);
    if (!card) {
      card = watchedList.querySelector(`.movie-card[data-id="${CSS.escape(id)}"]`);
      if (card) watchedEl.open = true;
    }
    if (!card) return;
    card.classList.remove("is-flash");
    void card.offsetWidth;
    card.classList.add("is-flash");
    // With reduced motion the flash is a still ring, so take it off again after a moment.
    window.clearTimeout(flashTimers.get(card));
    flashTimers.set(card, window.setTimeout(() => card.classList.remove("is-flash"), 1800));
    card.scrollIntoView({ behavior: reduced() ? "auto" : "smooth", block: "nearest" });
  }

  function resetSearch() {
    window.clearTimeout(searchTimer);
    searchToken += 1;
    queryInput.value = "";
    yearInput.value = "";
    clearButton.hidden = true;
    setBusy(false);
    closeHits();
  }

  function addMovie({ title: rawTitle, year: rawYear = "", tmdbId = null, poster = "", overview = "" }) {
    const title = cleanText(rawTitle);
    const year = cleanText(rawYear);
    if (!title) {
      showAddMessage("Type a movie title first.");
      queryInput.focus();
      return false;
    }
    if (title.length > MAX_TITLE) {
      showAddMessage(`Keep the title under ${MAX_TITLE} characters.`);
      return false;
    }
    if (year && (!/^\d{4}$/.test(year) || Number(year) < 1870 || Number(year) > new Date().getFullYear() + 10)) {
      showAddMessage("Use a 4-digit year, like 2006, or leave it empty.");
      yearInput.focus();
      return false;
    }
    if (!loaded) {
      showAddMessage(`Our list hasn’t loaded yet. ${OFFLINE}`);
      load();
      return false;
    }
    const movie = { title, year, tmdbId: Number.isFinite(Number(tmdbId)) && tmdbId ? Number(tmdbId) : null, poster: POSTER_PATH.test(poster || "") ? poster : "", overview: cleanText(overview).slice(0, 400) };
    const existing = findDuplicate(current().movies, movie);
    if (existing) {
      showAddMessage(existing.watched ? `We’ve already watched “${existing.title}”.` : `“${existing.title}” is already on our list.`, { info: true });
      highlight(existing.id);
      return true;
    }
    showAddMessage("");
    const author = me();
    const known = new Set(confirmed.movies.map((item) => item.id));
    const temp = { ...movie, id: `temp-${tempCount += 1}`, author, at: new Date().toISOString(), hearts: {}, watched: false, watchedAt: null, pending: true };
    send({ action: "add", ...movie, author }, (state) => {
      if (!findDuplicate(state.movies, movie)) state.movies.push(temp);
    }).then((data) => {
      // The other phone may have just added it too: the Worker then names the movie that was there.
      if (data.duplicate) highlight(data.duplicate);
      const added = normalize(data).movies.find((item) => !known.has(item.id) && item.author === author && findDuplicate([item], movie));
      if (added) activity("movies.add", `added ${clip(added.title, 100)} to our movie list`, { icon: "clapperboard", push: false });
    }).catch((error) => {
      showAddMessage(error.status ? error.message : `Couldn’t add that movie. ${OFFLINE}`);
      // Give the title back so nobody has to type it again.
      if (!queryInput.value) {
        queryInput.value = title;
        clearButton.hidden = false;
        if (manualMode()) yearInput.value = year;
      }
    });
    return true;
  }

  function addTyped() {
    if (addMovie({ title: queryInput.value, year: manualMode() ? yearInput.value : "" })) resetSearch();
  }

  function toggleHeart(id) {
    const movie = current().movies.find((item) => item.id === id);
    if (!movie || movie.pending || movie.watched) return;
    const author = me();
    const on = !movie.hearts[author];
    showError("");
    if (on && movie.hearts[other(author)]) {
      // That makes two: a little burst for the match.
      const card = listEl.querySelector(`.movie-card[data-id="${CSS.escape(id)}"]`);
      window.LetterFX?.burstFrom?.(card?.querySelector(".movie-heart.is-mine") || card, 16);
    }
    send({ action: "heart", id, author, on }, (state) => {
      const target = state.movies.find((item) => item.id === id);
      if (!target) return;
      if (on) target.hearts[author] = true;
      else delete target.hearts[author];
    }).then(() => {
      // One bell item per movie per visit, even when the heart is tapped off and on again.
      if (on && !heartsPosted.has(id)) {
        heartsPosted.add(id);
        activity("movies.heart", `hearted ${clip(movie.title, 110)}`, { icon: "heart", push: false });
      }
    }).catch((error) => failed(error, "Couldn’t save your heart."));
  }

  function setWatched(id, watched) {
    const state = current();
    const movie = state.movies.find((item) => item.id === id);
    if (!movie || movie.pending || movie.watched === watched) return;
    const at = new Date().toISOString();
    showError("");
    send({ action: "watched", id, watched, author: me() }, (draft) => {
      const target = draft.movies.find((item) => item.id === id);
      if (target) Object.assign(target, { watched, watchedAt: watched ? at : null });
      if (watched && draft.pick?.id === id) draft.pick = null;
    }).then(() => {
      if (!watched) return;
      activity("movies.watched", `marked ${clip(movie.title, 100)} as watched`, { icon: "check", push: false });
    }).catch((error) => failed(error, "Couldn’t save that."));
  }

  function removeMovie(id) {
    const state = current();
    const movie = state.movies.find((item) => item.id === id);
    if (!movie || movie.pending) return;
    if (!window.confirm(`Remove “${movie.title}” from our list?`)) return;
    showError("");
    // The Worker clears tonight's pick itself when it's this movie (and only then, so a
    // newer spin from the other phone is never wiped).
    send({ action: "remove", id }, (draft) => {
      draft.movies = draft.movies.filter((item) => item.id !== id);
      if (draft.pick?.id === id) draft.pick = null;
    }).catch((error) => failed(error, "Couldn’t remove that movie."));
  }

  /* ------------------------------- Menus --------------------------------- */
  function openMenuFor(card) {
    closeMenu();
    const menu = card.querySelector(".movie-menu");
    const grid = card.parentElement.getBoundingClientRect();
    const box = card.getBoundingClientRect();
    // Open toward the middle of the grid so the menu never hangs off the card.
    menu.classList.toggle("is-left", box.left + box.width / 2 < grid.left + grid.width / 2);
    menu.hidden = false;
    card.classList.add("is-menu-open");
    card.querySelector(".movie-menu-button").setAttribute("aria-expanded", "true");
    openMenu = card;
    menu.querySelector("button")?.focus({ preventScroll: true });
  }

  function closeMenu({ focus = false } = {}) {
    const card = openMenu;
    if (!card) return;
    openMenu = null;
    card.querySelector(".movie-menu").hidden = true;
    card.classList.remove("is-menu-open");
    const button = card.querySelector(".movie-menu-button");
    button.setAttribute("aria-expanded", "false");
    if (focus && card.isConnected) button.focus({ preventScroll: true });
  }

  /* ------------------------------- Search -------------------------------- */
  function manualMode() {
    return postersOff || searchFailed;
  }

  function renderAddMode() {
    const manual = manualMode();
    form.classList.toggle("is-manual", manual);
    yearInput.hidden = !manual;
    addButton.hidden = !manual;
    queryInput.placeholder = manual ? "Movie title" : "Search for a movie…";
    queryInput.setAttribute("enterkeyhint", manual ? "done" : "search");
    noteEl.hidden = !manual;
    noteEl.textContent = postersOff
      ? "Movie search is off for now, so type the title and tap Add."
      : "Search isn’t answering right now, so type the title and tap Add.";
  }

  function setBusy(busy) {
    busyEl.hidden = !busy;
    form.classList.toggle("is-busy", busy);
  }

  function closeHits() {
    hits = [];
    hitsQuery = "";
    hitsEl.hidden = true;
    hitsEl.innerHTML = "";
    hitsStatus.textContent = "";
  }

  function scheduleSearch(now = false) {
    window.clearTimeout(searchTimer);
    const query = cleanText(queryInput.value).slice(0, MAX_QUERY);
    if (!query || (!now && query.length < 2)) {
      searchToken += 1;
      setBusy(false);
      closeHits();
      return;
    }
    if (query === hitsQuery && !hitsEl.hidden) return;
    searchTimer = window.setTimeout(() => search(query), now ? 0 : SEARCH_DELAY);
  }

  async function search(query) {
    const token = searchToken += 1;
    if (searchCache.has(query)) {
      setBusy(false);
      showHits(query, searchCache.get(query));
      return;
    }
    setBusy(true);
    try {
      const data = await app().apiRequest(`/movies/search?q=${encodeURIComponent(query)}`);
      if (token !== searchToken) return;
      const results = (Array.isArray(data.results) ? data.results : []).slice(0, 8)
        .filter((hit) => hit && cleanText(hit.title))
        .map((hit) => ({ tmdbId: hit.tmdbId ?? null, title: cleanText(hit.title).slice(0, MAX_TITLE), year: hit.year ? String(hit.year) : "", poster: hit.poster || "", overview: String(hit.overview || "") }));
      searchCache.set(query, results);
      showHits(query, results);
    } catch (error) {
      if (token !== searchToken) return;
      closeHits();
      // No TMDB key on the Worker: stay with typed titles for this session. Anything else: just this time.
      if (error.status === 503 && error.data?.postersOff) {
        postersOff = true;
        savePostersOff();
      } else searchFailed = true;
      render();
    } finally {
      if (token === searchToken) setBusy(false);
    }
  }

  function showHits(query, results) {
    hits = results;
    hitsQuery = query;
    const movies = loaded ? current().movies : [];
    const rows = results.map((hit, index) => {
      const listed = findDuplicate(movies, hit);
      const label = `${hit.title}${hit.year ? ` (${hit.year})` : ""}`;
      return `<li><button class="movie-hit${listed ? " is-listed" : ""}" type="button" data-hit="${index}" aria-label="${escape(listed ? `${label}, already on our list` : `Add ${label}`)}">
        <span class="movie-art movie-hit-art" aria-hidden="true">${posterHtml(hit, "w185", { label: false })}</span>
        <span class="movie-hit-copy"><strong>${escape(hit.title)}</strong><small>${hit.year ? `<b>${escape(hit.year)}</b>` : ""}${hit.year && hit.overview ? " · " : ""}${escape(clip(hit.overview, 140))}</small></span>
        <span class="movie-hit-action" aria-hidden="true">${icon(listed ? "check" : "plus")}</span>
      </button></li>`;
    }).join("");
    const typed = `<li><button class="movie-hit is-typed" type="button" data-typed aria-label="${escape(`Add “${query}” without a poster`)}">
        <span class="movie-hit-art is-typed" aria-hidden="true">${icon("type")}</span>
        <span class="movie-hit-copy"><strong>Add “${escape(query)}”</strong><small>Just the title, no poster</small></span>
        <span class="movie-hit-action" aria-hidden="true">${icon("plus")}</span>
      </button></li>`;
    hitsEl.innerHTML = `${results.length ? "" : `<p class="movie-hits-empty">No movies found for “${escape(query)}”.</p>`}<ul class="movie-hit-list">${rows}${typed}</ul>`;
    hitsEl.hidden = false;
    hitsStatus.textContent = results.length ? `${plural(results.length, "movie")} found. Tap one to add it.` : "No movies found.";
    icons(hitsEl);
  }

  /* ------------------------------- Wiring -------------------------------- */
  queryInput.addEventListener("input", () => {
    showAddMessage("");
    clearButton.hidden = !queryInput.value;
    if (!manualMode()) scheduleSearch();
  });

  [queryInput, yearInput].forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !hitsEl.hidden) {
      closeHits();
      return;
    }
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    if (manualMode()) {
      addTyped();
      return;
    }
    // Enter searches right away and drops the keyboard so the results are in view.
    scheduleSearch(true);
    queryInput.blur();
  }));

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (manualMode()) addTyped();
    else scheduleSearch(true);
  });

  clearButton.addEventListener("click", () => {
    resetSearch();
    showAddMessage("");
    queryInput.focus();
  });

  hitsEl.addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.matches("[data-typed]")) {
      addTyped();
      return;
    }
    const hit = hits[Number(button.dataset.hit)];
    if (hit && addMovie(hit)) resetSearch();
  });

  modeEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-mode]");
    if (!button || button.disabled || spinning || button.getAttribute("aria-pressed") === "true") return;
    mode = button.dataset.mode;
    saveMode();
    render();
  });

  spinButton.addEventListener("click", spin);

  pickEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pick]");
    if (!button || spinning) return;
    if (button.dataset.pick === "again") spin();
    else {
      const found = activePick(current());
      const hadFocus = pickEl.contains(document.activeElement);
      if (found) setWatched(found.movie.id, true);
      if (hadFocus && !spinButton.hidden) spinButton.focus({ preventScroll: true });
    }
  });

  [listEl, watchedList].forEach((container) => {
    container.addEventListener("click", (event) => {
      const button = event.target.closest("button");
      const card = button?.closest(".movie-card");
      if (!card || button.disabled) return;
      const id = card.dataset.id;
      if (button.matches("[data-heart]")) toggleHeart(id);
      else if (button.matches(".movie-menu-button")) {
        if (openMenu === card) closeMenu();
        else openMenuFor(card);
      } else if (button.matches("[data-menu]")) {
        const action = button.dataset.menu;
        closeMenu();
        if (action === "watched") setWatched(id, true);
        else if (action === "unwatch") setWatched(id, false);
        else if (action === "remove") removeMovie(id);
      }
    });
    container.addEventListener("keydown", (event) => {
      const menu = event.target.closest?.(".movie-menu");
      if (!menu || !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = [...menu.querySelectorAll("button")];
      const index = items.indexOf(document.activeElement);
      const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: items.length - 1 }[event.key];
      items[mod(next, items.length)]?.focus();
    });
  });

  section.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && openMenu) closeMenu({ focus: true });
  });

  document.addEventListener("click", (event) => {
    if (openMenu && !openMenu.contains(event.target)) closeMenu();
  });

  // A poster that can't load shows the soft placeholder instead of a broken image.
  section.addEventListener("error", (event) => {
    if (event.target.tagName === "IMG") event.target.parentElement?.classList.add("is-broken");
  }, true);

  document.addEventListener("date:step", (event) => {
    if (event.detail.name === "movies") {
      searchFailed = false;
      if (!labelsFitted) labelsFitted = fitLabels();
      render();
      load();
      startPolling();
    } else {
      stopPolling();
      closeMenu();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "movies") load({ quiet: true });
  });

  // Labels are measured in the real font, so fit them again once the web fonts are in.
  document.fonts?.addEventListener?.("loadingdone", () => { labelsFitted = fitLabels(); });

  drawWheel([]);
})();
