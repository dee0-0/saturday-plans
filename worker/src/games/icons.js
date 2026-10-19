// Icon story: one of us tells a movie, a song or a memory in 3 to 5 icons and the other
// guesses it (3 tries). The answer stays on the server until the story is finished, so
// the guesser's phone never has it while guessing.
import { GameError, AUTHORS, parseAuthor, cleanLine, cleanId, newId, other, award, markActive } from "./common.js";

const KEY = "games:icons";
const MAX_STORIES = 100;
const MAX_OPEN = 5;          // open stories per sender
const MAX_TRIES = 3;
const MIN_ICONS = 3;
const MAX_ICONS = 5;
const MAX_ANSWER = 80;
const MAX_HINT = 80;
const GUESSER_HEARTS = 2;
const SENDER_HEARTS = 1;
const CATEGORIES = ["movie", "song", "memory", "other"];

// The picker's icons (icons.js on the page lists the same names in tabs).
export const ICON_NAMES = [
  // People & love
  "heart", "heart-handshake", "heart-crack", "hand-heart", "smile", "laugh", "frown", "angry", "meh", "baby", "user",
  "users", "person-standing", "hand", "thumbs-up", "thumbs-down", "eye", "ear", "brain", "footprints", "crown", "glasses",
  // Food
  "pizza", "croissant", "hamburger", "sandwich", "salad", "soup", "egg-fried", "drumstick", "fish", "carrot", "apple",
  "banana", "cherry", "cake", "cookie", "donut", "ice-cream-cone", "popcorn", "coffee", "wine", "beer", "chef-hat",
  // Places & travel
  "house", "building-2", "castle", "church", "school", "hospital", "store", "tent", "ferris-wheel", "landmark", "map",
  "map-pin", "globe", "plane", "car", "bus", "train-front", "ship", "sailboat", "bike", "rocket", "luggage",
  // Things
  "gift", "key", "lock", "smartphone", "laptop", "tv", "camera", "book-open", "mail", "shirt", "watch", "umbrella",
  "scissors", "hammer", "lamp", "bed", "sofa", "bath", "shopping-bag", "wallet", "gem", "lightbulb",
  // Nature & weather
  "sun", "moon", "star", "cloud", "cloud-rain", "cloud-lightning", "snowflake", "rainbow", "wind", "flame", "droplet",
  "waves", "leaf", "flower", "tree-pine", "tree-palm", "cat", "dog", "bird", "rabbit", "turtle", "snail", "bug", "paw-print",
  // Fun & music
  "music", "guitar", "piano", "drum", "mic-vocal", "headphones", "radio", "film", "clapperboard", "drama", "gamepad-2",
  "dices", "puzzle", "party-popper", "balloon", "trophy", "medal", "volleyball", "dumbbell", "palette", "ticket", "ghost",
  // Symbols
  "plus", "minus", "x", "check", "equal", "arrow-right", "arrow-left", "arrow-up", "arrow-down", "repeat", "infinity",
  "zap", "sparkles", "circle-help", "circle-alert", "ban", "clock", "calendar", "hourglass", "flag", "target", "bell"
];
const ICON_SET = new Set(ICON_NAMES);

// ---- Checking a guess -------------------------------------------------------------

// Lower case, no accents or punctuation, no leading "the/a/an", single spaces:
// "The Lion King!" and "lion king" read the same.
export function normalizeGuess(text) {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’‘`´]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^(?:the|a|an) (?=\S)/, "")
    .replace(/\s+/g, " ");
}

// Edits (insert, delete, replace one letter) between two strings.
export function levenshtein(a, b) {
  const left = Array.from(a);
  const right = Array.from(b);
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[right.length];
}

// Right when it matches after normalizing, allowing a small typo: 1 letter off
// (2 for answers of 8+ letters). Very short answers (1-3 letters) must match exactly,
// since one letter off is usually a different word there ("Up" vs "Us").
export function isMatch(guess, answer) {
  const a = normalizeGuess(guess);
  const b = normalizeGuess(answer);
  // An answer made only of symbols ("?!") has to be typed as is.
  if (!b) return String(guess ?? "").trim().toLowerCase() === String(answer ?? "").trim().toLowerCase();
  if (!a) return false;
  if (a === b) return true;
  const length = Array.from(b).length;
  if (length < 4) return false;
  return levenshtein(a, b) <= (length >= 8 ? 2 : 1);
}

// ---- Storage --------------------------------------------------------------------

function normalizeStory(item) {
  if (!item || typeof item !== "object" || typeof item.id !== "string" || !AUTHORS.includes(item.author)) return null;
  return {
    id: item.id,
    author: item.author,
    icons: Array.isArray(item.icons) ? item.icons.filter((name) => typeof name === "string") : [],
    category: CATEGORIES.includes(item.category) ? item.category : "other",
    answer: String(item.answer || ""),
    hint: String(item.hint || ""),
    at: String(item.at || ""),
    guesses: Array.isArray(item.guesses) ? item.guesses.filter((guess) => guess && typeof guess.text === "string").map((guess) => ({
      text: guess.text,
      at: String(guess.at || ""),
      correct: Boolean(guess.correct),
      ...(guess.counted ? { counted: true } : {})
    })) : [],
    status: ["open", "solved", "revealed"].includes(item.status) ? item.status : "open",
    doneAt: item.doneAt ? String(item.doneAt) : null
  };
}

function normalizeDoc(value) {
  const zero = () => ({ her: 0, sender: 0 });
  const doc = {
    stories: (Array.isArray(value?.stories) ? value.stories : []).map(normalizeStory).filter(Boolean),
    // Totals that outlive the 100 kept stories (for the leaderboard).
    counts: { sent: zero(), guessed: zero() }
  };
  for (const kind of ["sent", "guessed"]) {
    for (const author of AUTHORS) doc.counts[kind][author] = Math.max(0, Number(value?.counts?.[kind]?.[author]) || 0);
  }
  return doc;
}

const time = (iso) => Date.parse(iso) || 0;
const openCount = (doc, author) => doc.stories.filter((story) => story.author === author && story.status === "open").length;

// A story as `viewer` may see it: the answer of an open story by the other one stays hidden.
function storyView(story, viewer) {
  const secret = story.status === "open" && story.author !== viewer;
  return {
    id: story.id,
    author: story.author,
    icons: story.icons,
    category: story.category,
    answer: secret ? null : story.answer,
    hint: story.hint,
    at: story.at,
    guesses: story.guesses,
    triesLeft: Math.max(0, MAX_TRIES - story.guesses.length),
    status: story.status,
    doneAt: story.doneAt
  };
}

function view(doc, viewer) {
  const newestFirst = (a, b) => time(b.doneAt || b.at) - time(a.doneAt || a.at);
  const forMe = doc.stories.filter((story) => story.author === other(viewer));
  const open = forMe.filter((story) => story.status === "open").sort((a, b) => time(b.at) - time(a.at));
  const done = forMe.filter((story) => story.status !== "open").sort(newestFirst);
  const fromMe = doc.stories.filter((story) => story.author === viewer).sort((a, b) => {
    // My open stories first (newest first), then finished ones by when they finished.
    if ((a.status === "open") !== (b.status === "open")) return a.status === "open" ? -1 : 1;
    return a.status === "open" ? time(b.at) - time(a.at) : newestFirst(a, b);
  });
  return {
    forMe: [...open, ...done].map((story) => storyView(story, viewer)),
    fromMe: fromMe.map((story) => storyView(story, viewer)),
    stats: {
      guessed: { ...doc.counts.guessed },
      sent: { ...doc.counts.sent },
      openForMe: open.length,
      openFromMe: openCount(doc, viewer),
      maxOpen: MAX_OPEN
    }
  };
}

// Drop the oldest finished stories beyond the cap (open ones are never dropped).
function trim(doc) {
  const extra = doc.stories.length - MAX_STORIES;
  if (extra <= 0) return;
  const finished = doc.stories.filter((story) => story.status !== "open")
    .sort((a, b) => time(a.doneAt || a.at) - time(b.doneAt || b.at))
    .slice(0, extra)
    .map((story) => story.id);
  doc.stories = doc.stories.filter((story) => !finished.includes(story.id));
}

function findStory(doc, value) {
  const id = cleanId(value, "That story is gone.");
  const story = doc.stories.find((item) => item.id === id);
  if (!story) throw new GameError(404, "That story is gone.");
  return story;
}

// Both hearts for a solved story: the guesser's and the sender's (set once, by key).
async function rewardSolved(txn, story) {
  const guesser = other(story.author);
  const toGuesser = await award(txn, `icons:${story.id}:${guesser}`, guesser, GUESSER_HEARTS);
  const toSender = await award(txn, `icons:${story.id}:${story.author}`, story.author, SENDER_HEARTS);
  return { [guesser]: toGuesser, [story.author]: toSender };
}

function cleanIcons(value) {
  if (!Array.isArray(value) || value.length < MIN_ICONS || value.length > MAX_ICONS) {
    throw new GameError(400, `Pick ${MIN_ICONS} to ${MAX_ICONS} icons.`);
  }
  if (!value.every((name) => typeof name === "string" && ICON_SET.has(name))) throw new GameError(400, "Pick icons from the list.");
  return value.slice();
}

async function act(txn, ctx, body) {
  const author = parseAuthor(body.author);
  const doc = normalizeDoc(await txn.get(KEY));
  const now = ctx.now || new Date().toISOString();
  let awarded = 0;
  const event = {};

  switch (body.action) {
    case "send": {
      const icons = cleanIcons(body.icons);
      if (!CATEGORIES.includes(body.category)) throw new GameError(400, "Choose what kind of story it is.");
      const answer = cleanLine(body.answer, MAX_ANSWER, `Write the answer (up to ${MAX_ANSWER} characters).`);
      const hint = cleanLine(body.hint, MAX_HINT, `Keep the hint under ${MAX_HINT} characters.`, { optional: true });
      if (openCount(doc, author) >= MAX_OPEN) {
        throw new GameError(409, "Wait until they guessed one of your stories.", { openLimit: MAX_OPEN });
      }
      const story = { id: newId(), author, icons, category: body.category, answer, hint, at: now, guesses: [], status: "open", doneAt: null };
      doc.stories.push(story);
      doc.counts.sent[author] += 1;
      trim(doc);
      event.id = story.id;
      awarded += await markActive(txn, author, ctx.today);
      break;
    }
    case "guess": {
      const story = findStory(doc, body.id);
      if (story.author === author) throw new GameError(409, "That's your own story.");
      if (story.status !== "open") throw new GameError(409, "That story is already finished.");
      const text = cleanLine(body.text, MAX_ANSWER, `Write your guess (up to ${MAX_ANSWER} characters).`);
      const tried = normalizeGuess(text);
      if (story.guesses.some((guess) => normalizeGuess(guess.text) === tried)) throw new GameError(409, "You already tried that one.");
      const correct = isMatch(text, story.answer);
      story.guesses.push({ text, at: now, correct });
      if (correct) {
        story.status = "solved";
        story.doneAt = now;
        doc.counts.guessed[author] += 1;
        awarded += (await rewardSolved(txn, story))[author];
      } else if (story.guesses.length >= MAX_TRIES) {
        story.status = "revealed";
        story.doneAt = now;
      }
      event.id = story.id;
      event.correct = correct;
      awarded += await markActive(txn, author, ctx.today);
      break;
    }
    case "giveup": {
      const story = findStory(doc, body.id);
      if (story.author === author) throw new GameError(409, "That's your own story.");
      if (story.status !== "open") throw new GameError(409, "That story is already finished.");
      story.status = "revealed";
      story.doneAt = now;
      event.id = story.id;
      break;
    }
    case "accept": {
      // "Count it": the sender says a wrong guess was close enough.
      const story = findStory(doc, body.id);
      if (story.author !== author) throw new GameError(403, "Only the one who sent the story can count a guess.");
      if (story.status === "solved") throw new GameError(409, "That story is already solved.");
      const index = body.index;
      if (!Number.isInteger(index) || index < 0 || index >= story.guesses.length) throw new GameError(400, "That guess is gone.");
      story.guesses[index] = { ...story.guesses[index], correct: true, counted: true };
      story.status = "solved";
      story.doneAt = now;
      doc.counts.guessed[other(author)] += 1;
      awarded += (await rewardSolved(txn, story))[author];
      event.id = story.id;
      break;
    }
    case "remove": {
      const story = findStory(doc, body.id);
      if (story.author !== author) throw new GameError(403, "Only the one who sent the story can remove it.");
      if (story.status !== "open") throw new GameError(409, "Finished stories stay in our history.");
      doc.stories = doc.stories.filter((item) => item.id !== story.id);
      doc.counts.sent[author] = Math.max(0, doc.counts.sent[author] - 1);
      break;
    }
    default:
      throw new GameError(400, "Unknown icon story action.");
  }

  await txn.put(KEY, doc);
  return { ...view(doc, author), awarded, ...event };
}

async function icons(ctx) {
  if (ctx.method === "GET") {
    const author = parseAuthor(ctx.query("author"));
    const doc = normalizeDoc(await ctx.storage.get(KEY));
    return view(doc, author);
  }
  if (ctx.method !== "POST") throw new GameError(405, "Method not allowed.");
  return ctx.storage.transaction((txn) => act(txn, ctx, ctx.body || {}));
}

export const routes = { "/games/icons": icons };

export async function summary(ctx) {
  const author = AUTHORS.includes(ctx.author) ? ctx.author : "her";
  const doc = normalizeDoc(await ctx.storage.get(KEY));
  const waiting = doc.stories.filter((story) => story.author === other(author) && story.status === "open").length;
  return {
    id: "icons",
    title: "Icon story",
    icon: "shapes",
    step: "icons",
    status: waiting ? "new" : "idle",
    line: waiting ? `${waiting} ${waiting === 1 ? "story" : "stories"} to guess` : "Send {them} a story",
    board: [{ label: "Icon stories guessed", her: doc.counts.guessed.her, sender: doc.counts.guessed.sender }]
  };
}
