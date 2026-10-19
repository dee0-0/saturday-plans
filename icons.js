/*
 * Icon story: one of us tells a movie, a song or a memory in 3 to 5 icons, the
 * other one guesses it (3 tries, then the answer shows). The Worker checks the
 * guesses and never sends the answer to the guesser's phone while the story is
 * open. Two parts: "To guess" (stories from the other one) and "Send one" (the
 * composer, then the stories you sent, where a close guess can be counted).
 */
(function () {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const section = $('[data-step="icons"]');
  if (!section) return;

  const switchEl = $("#icons-switch");
  const guessCount = $("#icons-guess-count");
  const statusEl = $("#icons-status");
  const guessPanel = $("#icons-guess");
  const openEl = $("#icons-open");
  const emptyEl = $("#icons-empty");
  const emptyText = $("#icons-empty-text");
  const earlierEl = $("#icons-earlier");
  const earlierCount = $("#icons-earlier-count");
  const earlierList = $("#icons-earlier-list");
  const sendPanel = $("#icons-send");
  const form = $("#icons-form");
  const categoriesEl = $("#icons-categories");
  const chosenEl = $("#icons-chosen");
  const chosenCount = $("#icons-chosen-count");
  const tabsEl = $("#icons-tabs");
  const gridEl = $("#icons-grid");
  const answerInput = $("#icons-answer");
  const hintInput = $("#icons-hint");
  const limitEl = $("#icons-limit");
  const errorEl = $("#icons-error");
  const sendButton = $("#icons-send-button");
  const sentWrap = $("#icons-sent-wrap");
  const sentList = $("#icons-sent");

  const POLL_MS = 12000;
  const MIN_ICONS = 3;
  const MAX_ICONS = 5;
  const MAX_TEXT = 80;
  const EARLIER_SHOWN = 12;
  const SENT_SHOWN = 8;

  const CATEGORIES = [
    { id: "movie", label: "Movie", icon: "film", phrase: "A movie" },
    { id: "song", label: "Song", icon: "music", phrase: "A song" },
    { id: "memory", label: "Memory", icon: "camera", phrase: "A memory" },
    { id: "other", label: "Something else", icon: "sparkles", phrase: "Something" }
  ];

  // The picker (the Worker accepts exactly these names, see worker/src/games/icons.js).
  const PICKER = [
    { label: "People & love", icons: ["heart", "heart-handshake", "heart-crack", "hand-heart", "smile", "laugh", "frown", "angry", "meh", "baby", "user",
      "users", "person-standing", "hand", "thumbs-up", "thumbs-down", "eye", "ear", "brain", "footprints", "crown", "glasses"] },
    { label: "Food", icons: ["pizza", "croissant", "hamburger", "sandwich", "salad", "soup", "egg-fried", "drumstick", "fish", "carrot", "apple",
      "banana", "cherry", "cake", "cookie", "donut", "ice-cream-cone", "popcorn", "coffee", "wine", "beer", "chef-hat"] },
    { label: "Places & travel", icons: ["house", "building-2", "castle", "church", "school", "hospital", "store", "tent", "ferris-wheel", "landmark", "map",
      "map-pin", "globe", "plane", "car", "bus", "train-front", "ship", "sailboat", "bike", "rocket", "luggage"] },
    { label: "Things", icons: ["gift", "key", "lock", "smartphone", "laptop", "tv", "camera", "book-open", "mail", "shirt", "watch", "umbrella",
      "scissors", "hammer", "lamp", "bed", "sofa", "bath", "shopping-bag", "wallet", "gem", "lightbulb"] },
    { label: "Nature & weather", icons: ["sun", "moon", "star", "cloud", "cloud-rain", "cloud-lightning", "snowflake", "rainbow", "wind", "flame", "droplet",
      "waves", "leaf", "flower", "tree-pine", "tree-palm", "cat", "dog", "bird", "rabbit", "turtle", "snail", "bug", "paw-print"] },
    { label: "Fun & music", icons: ["music", "guitar", "piano", "drum", "mic-vocal", "headphones", "radio", "film", "clapperboard", "drama", "gamepad-2",
      "dices", "puzzle", "party-popper", "balloon", "trophy", "medal", "volleyball", "dumbbell", "palette", "ticket", "ghost"] },
    { label: "Symbols", icons: ["plus", "minus", "x", "check", "equal", "arrow-right", "arrow-left", "arrow-up", "arrow-down", "repeat", "infinity",
      "zap", "sparkles", "circle-help", "circle-alert", "ban", "clock", "calendar", "hourglass", "flag", "target", "bell"] }
  ];
  const ALL_ICONS = new Set(PICKER.flatMap((group) => group.icons));

  // Spoken names for screen readers, where the icon's own name doesn't say it well.
  const ICON_NAMES = {
    "heart-handshake": "handshake heart", "heart-crack": "broken heart", "hand-heart": "hand with a heart", "person-standing": "person",
    "egg-fried": "fried egg", "ice-cream-cone": "ice cream", "chef-hat": "chef", "building-2": "building", "map-pin": "pin",
    "train-front": "train", "book-open": "book", "cloud-rain": "rain", "cloud-lightning": "lightning", "tree-pine": "pine tree",
    "tree-palm": "palm tree", "paw-print": "paw print", "mic-vocal": "microphone", "gamepad-2": "game controller", dices: "dice",
    x: "cross", "circle-help": "question mark", "circle-alert": "exclamation mark", ban: "no", "party-popper": "party"
  };
  const iconName = (name) => ICON_NAMES[name] || name.replace(/-/g, " ");

  let data = null;            // GET /games/icons
  let drawnJson = "";
  let loadSeq = 0;
  let identitySeq = 0;
  let pollTimer = null;
  let busy = false;
  let tab = "";               // "guess" | "send"; picked once data is in, then the person's choice
  let tabChosen = false;
  let category = "";
  let chosen = [];
  let pickerTab = 0;
  let showAllEarlier = false;
  let showAllSent = false;
  const drafts = {};          // story id -> unsent guess
  const hints = new Set();    // story ids whose hint is shown
  const justDone = new Map(); // story id -> "solved" | "revealed": stays on top until you leave the page
  const notes = {};           // story id -> { text, kind } line under the guess form

  const app = () => window.DateApp;
  const me = () => app().me();
  const other = () => (me() === "her" ? "sender" : "her");
  const nameOf = (who) => app().names[who] || "";
  // DateApp (app.js) loads last; the picker is drawn before it exists, so fall back to the same escaping.
  const escape = (text) => (window.DateApp?.escapeHtml
    ? window.DateApp.escapeHtml(text ?? "")
    : String(text ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character])));
  const offline = (error, fallback) => (error.status ? error.message : fallback);
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const categoryOf = (id) => CATEGORIES.find((item) => item.id === id) || CATEGORIES[3];
  const icon = (name, extra = "") => `<i class="icon${extra ? ` ${extra}` : ""}" data-lucide="${escape(name)}" aria-hidden="true"></i>`;

  function showError(element, message) {
    element.textContent = message || "";
    element.hidden = !message;
  }

  function icons(root) {
    try { window.lucide?.createIcons?.({ root }); } catch { /* Icons are decoration. */ }
  }

  // The bell on the other phone (activity.js); never let it break the page.
  function postActivity(entry) {
    try { window.DateActivity?.post?.(entry)?.catch?.(() => {}); } catch { /* Optional. */ }
  }

  // The games hub (games.js): "+2 hearts" and a fresh hub. Optional too.
  function rewarded(amount) {
    try { window.DateGames?.reward?.(amount); } catch { /* Optional. */ }
    try { window.DateGames?.refresh?.(); } catch { /* Optional. */ }
  }

  function friendly(error, fallback) {
    if (error.status === 409 && error.data?.openLimit) return `Wait until ${nameOf(other())} guessed one of your stories.`;
    return offline(error, fallback);
  }

  /* ------------------------------- Render -------------------------------- */
  function rowHtml(names, size) {
    const label = `Icons: ${names.map(iconName).join(", ")}`;
    return `<div class="icons-row is-${size}" role="img" aria-label="${escape(label)}">${names.map((name) => `<span class="icons-tile">${icon(name)}</span>`).join("")}</div>`;
  }

  function chipHtml(story) {
    const item = categoryOf(story.category);
    return `<span class="icons-chip">${icon(item.icon)}<span>${escape(item.label)}</span></span>`;
  }

  function triesHtml(story) {
    const used = story.guesses.length;
    return `<span class="icons-tries" aria-label="${story.triesLeft} ${story.triesLeft === 1 ? "try" : "tries"} left">${[0, 1, 2].map((index) => `<span class="icons-try${index < used ? " is-used" : ""}"></span>`).join("")}</span>`;
  }

  function guessesHtml(story, { canCount = false } = {}) {
    if (!story.guesses.length) return "";
    return `<ul class="icons-guesses">${story.guesses.map((guess, index) => {
      const state = guess.correct ? (guess.counted ? "is-counted" : "is-right") : "is-wrong";
      const mark = guess.correct ? icon("check") : icon("x");
      const count = canCount && !guess.correct
        ? `<button class="icons-count-it" type="button" data-accept="${index}">Count it</button>` : "";
      const tag = guess.counted ? `<small>counted</small>` : "";
      return `<li class="${state}">${mark}<span>${escape(guess.text)}</span>${tag}${count}</li>`;
    }).join("")}</ul>`;
  }

  function openCardHtml(story) {
    const draft = drafts[story.id] || "";
    const id = `icons-guess-${story.id}`;
    const hint = story.hint
      ? (hints.has(story.id)
        ? `<p class="icons-hint">${icon("lightbulb")}<span>${escape(story.hint)}</span></p>`
        : `<button class="icons-hint-button" type="button" data-hint>${icon("lightbulb")}<span>Show the hint</span></button>`)
      : "";
    const note = notes[story.id];
    return `<article class="icons-card${note?.kind === "miss" ? " is-miss" : ""}" data-id="${escape(story.id)}">
        <div class="icons-card-top">${chipHtml(story)}<span class="icons-from">from ${escape(nameOf(story.author))}</span>${triesHtml(story)}</div>
        ${rowHtml(story.icons, "big")}
        ${hint}
        ${guessesHtml(story)}
        <form class="icons-guess-form" data-id="${escape(story.id)}" novalidate>
          <label class="visually-hidden" for="${escape(id)}">Your guess</label>
          <input type="text" id="${escape(id)}" maxlength="${MAX_TEXT}" placeholder="Your guess…" autocomplete="off" autocorrect="off" enterkeyhint="send" value="${escape(draft)}">
          <button class="btn btn-primary" type="submit">Guess</button>
        </form>
        <p class="icons-note${note ? ` is-${note.kind}` : ""}" role="status" aria-live="polite">${note ? escape(note.text) : ""}</p>
        <div class="icons-card-foot">
          <span>${story.triesLeft} ${story.triesLeft === 1 ? "try" : "tries"} left</span>
          <button class="icons-giveup" type="button" data-giveup>Give up</button>
        </div>
      </article>`;
  }

  function doneCardHtml(story) {
    const solved = story.status === "solved";
    const counted = story.guesses.some((guess) => guess.counted);
    const title = solved ? (counted ? `${nameOf(story.author)} counted it!` : "You got it!") : "The answer was";
    return `<article class="icons-card is-done${solved ? " is-solved" : " is-revealed"}${justDone.has(story.id) ? " is-fresh" : ""}" data-id="${escape(story.id)}">
        <div class="icons-card-top">${chipHtml(story)}<span class="icons-from">from ${escape(nameOf(story.author))}</span></div>
        ${rowHtml(story.icons, "big")}
        <div class="icons-result">
          <span class="icons-result-icon" aria-hidden="true">${icon(solved ? "party-popper" : "eye")}</span>
          <span class="icons-result-copy"><small>${escape(title)}</small><strong>${escape(story.answer || "")}</strong></span>
        </div>
        ${guessesHtml(story)}
      </article>`;
  }

  function resultLine(story, { mine }) {
    const them = nameOf(other());
    const tries = story.guesses.length;
    if (story.status === "solved") {
      if (story.guesses.some((guess) => guess.counted)) return mine ? `You counted ${them}’s guess` : `${nameOf(story.author)} counted your guess`;
      const right = story.guesses.findIndex((guess) => guess.correct) + 1;
      return mine ? `${them} got it in ${right}` : `You got it in ${right}`;
    }
    if (story.status === "revealed") {
      if (mine) return tries >= 3 ? `${them} didn’t get it` : `${them} gave up`;
      return tries >= 3 ? "Not this time" : "You gave up";
    }
    if (!tries) return `Waiting for ${them}`;
    return `${them} tried ${tries} of 3`;
  }

  function earlierItemHtml(story) {
    return `<li class="icons-mini${story.status === "solved" ? " is-solved" : ""}">
        ${rowHtml(story.icons, "small")}
        <span class="icons-mini-copy"><strong>${escape(story.answer || "")}</strong><small>${escape(categoryOf(story.category).label)} · ${escape(resultLine(story, { mine: false }))}</small></span>
      </li>`;
  }

  function sentItemHtml(story) {
    const open = story.status === "open";
    const canCount = story.status !== "solved";
    const state = story.status === "solved" ? "is-solved" : story.status === "revealed" ? "is-revealed" : "is-open";
    return `<li class="icons-sent-item ${state}" data-id="${escape(story.id)}">
        <div class="icons-sent-top">
          ${rowHtml(story.icons, "small")}
          ${open ? `<button class="planner-icon-btn" type="button" data-remove aria-label="Remove this story">${icon("x")}</button>` : ""}
        </div>
        <p class="icons-sent-answer">${escape(story.answer || "")}</p>
        <p class="icons-sent-line">${icon(open ? "hourglass" : story.status === "solved" ? "circle-check" : "eye")}<span>${escape(categoryOf(story.category).label)} · ${escape(resultLine(story, { mine: true }))}</span></p>
        ${story.hint ? `<p class="icons-sent-hint">Hint: ${escape(story.hint)}</p>` : ""}
        ${guessesHtml(story, { canCount })}
      </li>`;
  }

  // Redraws the stories, keeping the cursor in a guess box that is being typed into.
  function renderLists(force = false) {
    if (!data) return;
    const json = JSON.stringify([data, [...justDone], [...hints], notes, showAllEarlier, showAllSent]);
    if (json === drawnJson && !force) return;
    drawnJson = json;
    const focused = document.activeElement;
    const focusId = focused && section.contains(focused) ? focused.id : "";
    const selection = focusId && typeof focused.selectionStart === "number" ? [focused.selectionStart, focused.selectionEnd] : null;

    const forMe = Array.isArray(data.forMe) ? data.forMe : [];
    const open = forMe.filter((story) => story.status === "open");
    const fresh = forMe.filter((story) => story.status !== "open" && justDone.has(story.id));
    const earlier = forMe.filter((story) => story.status !== "open" && !justDone.has(story.id));
    openEl.innerHTML = [...fresh.map(doneCardHtml), ...open.map(openCardHtml)].join("");
    emptyEl.hidden = Boolean(open.length || fresh.length);
    emptyText.textContent = forMe.length
      ? `You guessed them all. Send ${nameOf(other())} one back?`
      : `Nothing to guess yet. Send ${nameOf(other())} the first one?`;
    earlierEl.hidden = !earlier.length;
    earlierCount.textContent = String(earlier.length);
    const shown = showAllEarlier ? earlier : earlier.slice(0, EARLIER_SHOWN);
    earlierList.innerHTML = shown.map(earlierItemHtml).join("")
      + (earlier.length > shown.length ? `<li class="icons-more"><button class="btn btn-secondary" type="button" data-more>Show all ${earlier.length}</button></li>` : "");

    // Open ones always, then the most recent finished ones (all on request).
    const fromMe = Array.isArray(data.fromMe) ? data.fromMe : [];
    const sentShown = showAllSent ? fromMe : fromMe.filter((story, index) => story.status === "open" || index < SENT_SHOWN);
    sentWrap.hidden = !fromMe.length;
    sentList.innerHTML = sentShown.map(sentItemHtml).join("")
      + (fromMe.length > sentShown.length ? `<li class="icons-more"><button class="btn btn-secondary" type="button" data-more-sent>Show all ${fromMe.length}</button></li>` : "");

    guessCount.hidden = !open.length;
    guessCount.textContent = String(open.length);
    icons(guessPanel);
    icons(sentList);
    if (focusId) {
      const again = document.getElementById(focusId);
      if (again && again !== document.activeElement) {
        again.focus({ preventScroll: true });
        if (selection) try { again.setSelectionRange(...selection); } catch { /* Not a text box. */ }
      }
    }
  }

  function renderTabs() {
    switchEl.querySelectorAll("[data-tab]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.tab === tab)));
    guessPanel.hidden = !data || tab !== "guess";
    sendPanel.hidden = !data || tab !== "send";
    if (!sendPanel.hidden) updateTabsFade();
  }

  function renderLimit() {
    const full = Boolean(data && data.stats?.openFromMe >= (data.stats?.maxOpen || 5));
    limitEl.hidden = !full;
    limitEl.textContent = full ? `You have ${data.stats.openFromMe} stories waiting. Wait until ${nameOf(other())} guessed one of them.` : "";
    sendButton.disabled = full || busy;
  }

  function renderComposer() {
    categoriesEl.querySelectorAll("[data-category]").forEach((button) => button.setAttribute("aria-checked", String(button.dataset.category === category)));
    chosenCount.textContent = `${chosen.length} / ${MAX_ICONS}`;
    chosenEl.innerHTML = Array.from({ length: MAX_ICONS }, (_, index) => {
      const name = chosen[index];
      if (!name) return `<span class="icons-slot${index < MIN_ICONS ? " is-needed" : ""}" aria-hidden="true"></span>`;
      return `<button class="icons-slot is-filled" type="button" data-unpick="${index}" aria-label="Remove ${escape(iconName(name))}">${icon(name)}<span class="icons-slot-x" aria-hidden="true">${icon("x")}</span></button>`;
    }).join("");
    icons(chosenEl);
    gridEl.classList.toggle("is-full", chosen.length >= MAX_ICONS);
    renderLimit();
  }

  function renderPicker() {
    tabsEl.innerHTML = PICKER.map((group, index) => `<button class="icons-tab" type="button" role="tab" id="icons-tab-${index}" aria-selected="${index === pickerTab}" aria-controls="icons-grid" tabindex="${index === pickerTab ? 0 : -1}" data-group="${index}">${escape(group.label)}</button>`).join("");
    gridEl.setAttribute("aria-labelledby", `icons-tab-${pickerTab}`);
    gridEl.innerHTML = PICKER[pickerTab].icons.map((name) => `<button class="icons-pick" type="button" data-pick="${escape(name)}" aria-label="Add ${escape(iconName(name))}">${icon(name)}</button>`).join("");
    icons(gridEl);
    updateTabsFade();
  }

  function updateTabsFade() {
    tabsEl.classList.toggle("has-more", tabsEl.scrollLeft + tabsEl.clientWidth < tabsEl.scrollWidth - 2);
  }

  function render() {
    if (!data) return;
    statusEl.hidden = true;
    if (!tab) tab = data.stats?.openForMe ? "guess" : "send";
    renderTabs();
    renderLists();
    renderLimit();
  }

  /* -------------------------------- Sync --------------------------------- */
  async function load({ quiet = false } = {}) {
    const seq = loadSeq += 1;
    const identity = identitySeq;
    if (!data && !quiet) {
      statusEl.hidden = false;
      statusEl.textContent = "Loading our stories…";
    }
    try {
      const next = await app().apiRequest(`/games/icons?author=${encodeURIComponent(me())}`);
      if (seq !== loadSeq || identity !== identitySeq || busy) return;
      data = next;
      // A new story while nothing was picked yet: show it.
      if (!tabChosen && data.stats?.openForMe) tab = "guess";
      render();
    } catch (error) {
      if (seq !== loadSeq || identity !== identitySeq || data) return;
      statusEl.hidden = false;
      statusEl.textContent = error.status === 404
        ? "Icon stories need the latest server update first."
        : "Couldn’t load our stories. Check your connection and try again.";
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      if (document.hidden || app()?.step !== "icons") return;
      load({ quiet: true });
    }, POLL_MS);
  }

  function stopPolling() {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  // One POST at a time; the answer replaces the view.
  async function act(body) {
    if (busy) return null;
    const identity = identitySeq;
    busy = true;
    loadSeq += 1;
    renderLimit();
    try {
      const next = await app().apiRequest("/games/icons", "POST", { author: me(), ...body });
      if (identity !== identitySeq) return null;
      data = next;
      return next;
    } finally {
      busy = false;
      if (identity === identitySeq) renderLimit();
    }
  }

  const findStory = (list, id) => (Array.isArray(list) ? list.find((story) => story.id === id) : null);

  function celebrate(id) {
    const card = openEl.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    if (reduced()) return;
    window.LetterFX?.burstFrom?.(card, 24);
    window.LetterFX?.chime?.();
  }

  /* ------------------------------ Actions -------------------------------- */
  async function guess(formEl) {
    if (busy) return;
    const id = formEl.dataset.id;
    const input = formEl.querySelector("input");
    const text = clean(input.value);
    if (!text) {
      notes[id] = { text: "Type your guess first.", kind: "error" };
      renderLists(true);
      document.getElementById(`icons-guess-${id}`)?.focus();
      return;
    }
    const button = formEl.querySelector('[type="submit"]');
    button.disabled = true;
    button.textContent = "…";
    delete notes[id];
    try {
      const next = await act({ action: "guess", id, text });
      if (!next) return;
      const story = findStory(next.forMe, id);
      drafts[id] = "";
      rewarded(next.awarded);
      if (next.correct) {
        justDone.set(id, "solved");
        renderLists(true);
        celebrate(id);
        postActivity({ kind: "icons.solved", text: `guessed your icon story: ${story?.answer || text}`, step: "icons", icon: "shapes", push: true });
      } else if (story?.status === "revealed") {
        justDone.set(id, "revealed");
        renderLists(true);
        postActivity({ kind: "icons.revealed", text: "couldn’t guess your icon story", detail: story.answer || "", step: "icons", icon: "shapes", push: false });
      } else {
        const left = story?.triesLeft ?? 0;
        notes[id] = { text: `Not quite. ${left} ${left === 1 ? "try" : "tries"} left.`, kind: "miss" };
        renderLists(true);
        document.getElementById(`icons-guess-${id}`)?.focus({ preventScroll: true });
      }
    } catch (error) {
      notes[id] = { text: friendly(error, "Couldn’t send your guess. Check your connection and try again."), kind: "error" };
      drafts[id] = text;
      if (error.status === 409 || error.status === 404) load({ quiet: true });
      renderLists(true);
    }
  }

  async function giveUp(id) {
    if (!window.confirm("Give up? The answer will be shown.")) return;
    try {
      const next = await act({ action: "giveup", id });
      if (!next) return;
      justDone.set(id, "revealed");
      delete notes[id];
      renderLists(true);
      const story = findStory(next.forMe, id);
      postActivity({ kind: "icons.revealed", text: "gave up on your icon story", detail: story?.answer || "", step: "icons", icon: "shapes", push: false });
    } catch (error) {
      notes[id] = { text: friendly(error, "Couldn’t do that. Check your connection and try again."), kind: "error" };
      renderLists(true);
      if (error.status === 409 || error.status === 404) load({ quiet: true });
    }
  }

  async function countIt(id, index) {
    try {
      const next = await act({ action: "accept", id, index });
      if (!next) return;
      renderLists(true);
      rewarded(next.awarded);
      const story = findStory(next.fromMe, id);
      postActivity({ kind: "icons.counted", text: "counted your guess on an icon story", detail: story?.answer || "", step: "icons", icon: "shapes", push: true });
    } catch (error) {
      showError(errorEl, friendly(error, "Couldn’t count that guess. Check your connection and try again."));
      load({ quiet: true });
    }
  }

  async function remove(id) {
    if (!window.confirm(`Remove this story? ${nameOf(other())} won’t see it anymore.`)) return;
    try {
      const next = await act({ action: "remove", id });
      if (next) renderLists(true);
    } catch (error) {
      showError(errorEl, friendly(error, "Couldn’t remove that story. Check your connection and try again."));
      load({ quiet: true });
    }
  }

  async function send(event) {
    event.preventDefault();
    if (busy) return;
    const answer = clean(answerInput.value);
    const hint = clean(hintInput.value);
    let problem = "";
    if (!category) problem = "Choose what kind of story it is.";
    else if (chosen.length < MIN_ICONS) problem = `Pick at least ${MIN_ICONS} icons.`;
    else if (!answer) problem = "Write the answer, so the guesses can be checked.";
    else if (answer.length > MAX_TEXT || hint.length > MAX_TEXT) problem = `Keep it under ${MAX_TEXT} characters.`;
    if (problem) {
      showError(errorEl, problem);
      if (!answer && category && chosen.length >= MIN_ICONS) answerInput.focus();
      return;
    }
    showError(errorEl, "");
    sendButton.innerHTML = "Sending…";
    const count = chosen.length;
    const phrase = categoryOf(category).phrase;
    try {
      const next = await act({ action: "send", icons: chosen.slice(), category, answer, hint });
      if (!next) return;
      category = "";
      chosen = [];
      answerInput.value = "";
      hintInput.value = "";
      renderComposer();
      renderLists(true);
      rewarded(next.awarded);
      postActivity({ kind: "icons.sent", text: "sent you an icon story", detail: `${phrase} in ${count} icons`, step: "icons", icon: "shapes", push: true });
      showError(errorEl, "");
      sentWrap.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
      sentList.firstElementChild?.classList.add("is-new");
    } catch (error) {
      showError(errorEl, friendly(error, "Couldn’t send your story. Check your connection and try again."));
      if (error.status === 409) load({ quiet: true });
    } finally {
      setSendLabel();
      renderLimit();
    }
  }

  function setSendLabel() {
    sendButton.innerHTML = `Send to ${escape(nameOf(other()))} ${icon("send")}`;
    icons(sendButton);
  }

  /* ------------------------------- Wiring -------------------------------- */
  function resetIdentity() {
    identitySeq += 1;
    loadSeq += 1;
    data = null;
    drawnJson = "";
    busy = false;
    tab = "";
    tabChosen = false;
    category = "";
    chosen = [];
    showAllEarlier = false;
    showAllSent = false;
    [drafts, notes].forEach((store) => Object.keys(store).forEach((key) => { delete store[key]; }));
    hints.clear();
    justDone.clear();
    answerInput.value = "";
    hintInput.value = "";
    openEl.innerHTML = "";
    earlierList.innerHTML = "";
    sentList.innerHTML = "";
    showError(errorEl, "");
    renderTabs();
    renderComposer();
    if (app()?.step === "icons") {
      setSendLabel();
      load();
    }
  }
  document.addEventListener("date:identity", resetIdentity);
  window.addEventListener("storage", (event) => {
    if (event.key === "date-letter-author" || event.key === null) resetIdentity();
  });

  switchEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tab]");
    if (!button || !data) return;
    tab = button.dataset.tab;
    tabChosen = true;
    renderTabs();
  });
  emptyEl.addEventListener("click", (event) => {
    if (!event.target.closest("[data-go-send]")) return;
    tab = "send";
    tabChosen = true;
    renderTabs();
    categoriesEl.querySelector("[data-category]")?.focus();
  });

  openEl.addEventListener("click", (event) => {
    const card = event.target.closest(".icons-card");
    if (!card) return;
    if (event.target.closest("[data-hint]")) {
      hints.add(card.dataset.id);
      renderLists(true);
    } else if (event.target.closest("[data-giveup]")) {
      giveUp(card.dataset.id);
    }
  });
  openEl.addEventListener("input", (event) => {
    const formEl = event.target.closest(".icons-guess-form");
    if (formEl) drafts[formEl.dataset.id] = event.target.value;
  });
  openEl.addEventListener("submit", (event) => {
    event.preventDefault();
    const formEl = event.target.closest(".icons-guess-form");
    if (formEl) guess(formEl);
  });
  earlierList.addEventListener("click", (event) => {
    if (!event.target.closest("[data-more]")) return;
    showAllEarlier = true;
    renderLists(true);
  });
  sentList.addEventListener("click", (event) => {
    if (event.target.closest("[data-more-sent]")) {
      showAllSent = true;
      renderLists(true);
      return;
    }
    const item = event.target.closest(".icons-sent-item");
    if (!item) return;
    const accept = event.target.closest("[data-accept]");
    if (accept) countIt(item.dataset.id, Number(accept.dataset.accept));
    else if (event.target.closest("[data-remove]")) remove(item.dataset.id);
  });

  categoriesEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    category = button.dataset.category;
    showError(errorEl, "");
    renderComposer();
  });
  tabsEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-group]");
    if (!button) return;
    pickerTab = Number(button.dataset.group);
    renderPicker();
    tabsEl.querySelector(`[data-group="${pickerTab}"]`)?.focus({ preventScroll: true });
  });
  // Arrow keys move between the picker's tabs.
  tabsEl.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    pickerTab = (pickerTab + (event.key === "ArrowLeft" ? -1 : 1) + PICKER.length) % PICKER.length;
    renderPicker();
    const active = tabsEl.querySelector(`[data-group="${pickerTab}"]`);
    active?.focus();
    active?.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
  tabsEl.addEventListener("scroll", updateTabsFade, { passive: true });
  window.addEventListener("resize", updateTabsFade);
  gridEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pick]");
    if (!button || !ALL_ICONS.has(button.dataset.pick)) return;
    if (chosen.length >= MAX_ICONS) {
      showError(errorEl, `That’s ${MAX_ICONS}. Tap one of yours above to swap it.`);
      return;
    }
    chosen = [...chosen, button.dataset.pick];
    showError(errorEl, "");
    renderComposer();
    if (!reduced()) {
      const added = chosenEl.querySelector(`[data-unpick="${chosen.length - 1}"]`);
      added?.classList.add("is-new");
    }
  });
  chosenEl.addEventListener("click", (event) => {
    const button = event.target.closest("[data-unpick]");
    if (!button) return;
    const index = Number(button.dataset.unpick);
    chosen = chosen.filter((_, position) => position !== index);
    showError(errorEl, "");
    renderComposer();
    (chosenEl.querySelector(`[data-unpick="${Math.min(index, chosen.length - 1)}"]`) || gridEl.querySelector("[data-pick]"))?.focus({ preventScroll: true });
  });
  form.addEventListener("submit", send);

  document.addEventListener("date:step", (event) => {
    const { name } = event.detail;
    if (name === "icons") {
      setSendLabel();
      load();
      startPolling();
    } else {
      stopPolling();
      // Finished stories move down to "Earlier" next time.
      if (justDone.size) {
        justDone.clear();
        drawnJson = "";
      }
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && app()?.step === "icons") load({ quiet: true });
  });

  renderPicker();
  renderComposer();
})();
