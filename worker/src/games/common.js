// Shared helpers for the games (worker/src/games/*.js): days in Zurich, input checks,
// the hearts ledger (points you earn by playing and spend in the love shop), the couple
// streak, and the error type the games router turns into a JSON answer.

export const AUTHORS = ["her", "sender"];
export const FIRST_GAME_DAY = "2026-01-01";
// The daily question's storage key (worker/src/index.js owns that data).
export const QUESTIONS_KEY = "questions";

const POINTS_KEY = "games:points";
const ACTIVE_KEY = "games:active";
const MIGRATED_KEY = "games:migrated";
// Old awards are folded into a per-person total so the ledger never grows past this.
const MAX_AWARDS = 3000;
const MAX_ACTIVE_DAYS = 800;
// Every 7 days in a row we both play, each of us gets this many hearts.
export const STREAK_MILESTONE = 7;
export const STREAK_BONUS = 5;

const ITEM_ID = /^[a-z0-9-]{1,64}$/;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// A failed game request: the router answers `{ error: message, ...extra }` with `status`.
export class GameError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const other = (author) => (author === "her" ? "sender" : "her");

// ---- Days -------------------------------------------------------------------

export function zurichDay(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isValidDay(day) {
  if (typeof day !== "string" || !DAY_PATTERN.test(day)) return false;
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === date;
}

const dayToUtc = (day) => {
  const [year, month, date] = day.split("-").map(Number);
  return Date.UTC(year, month - 1, date);
};

export function addDays(day, count) {
  return new Date(dayToUtc(day) + count * DAY_MS).toISOString().slice(0, 10);
}

// Whole days since FIRST_GAME_DAY (0 on that day), for picking a day's word or prompt.
export function dayNumber(day) {
  return Math.round((dayToUtc(day) - dayToUtc(FIRST_GAME_DAY)) / DAY_MS);
}

// The Monday of the day's week.
export function weekStart(day) {
  const weekday = new Date(dayToUtc(day)).getUTCDay(); // 0 = Sunday
  return addDays(day, -((weekday + 6) % 7));
}

// A day from a request: empty means today; never after today or before the first game day.
export function parseDay(value, today = zurichDay()) {
  if (value === undefined || value === null || value === "") return today;
  if (!isValidDay(value) || value < FIRST_GAME_DAY || value > today) {
    throw new GameError(400, "Choose a day between January 1, 2026 and today.");
  }
  return value;
}

// ---- Input checks -------------------------------------------------------------

export function parseAuthor(value, message = "Choose who is playing.") {
  if (!AUTHORS.includes(value)) throw new GameError(400, message);
  return value;
}

export function cleanId(value, message = "That item is gone.") {
  if (typeof value !== "string" || !ITEM_ID.test(value)) throw new GameError(400, message);
  return value;
}

// Single-line text with whitespace tidied (titles, guesses, hints).
export function cleanLine(value, maxLength, message, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string") throw new GameError(400, message);
  const text = value.replace(/\s+/g, " ").trim();
  if ((!optional && !text) || text.length > maxLength) throw new GameError(400, message);
  return text;
}

// Multi-line text (notes, answers): line breaks kept, ends trimmed.
export function cleanText(value, maxLength, message, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string") throw new GameError(400, message);
  const text = value.replace(/\r\n?/g, "\n").trim();
  if ((!optional && !text) || text.length > maxLength) throw new GameError(400, message);
  return text;
}

export const newId = () => crypto.randomUUID();

// ---- Deterministic picks (the same word or prompt on both phones) -------------

function hashSeed(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// The same shuffle of `list` every time for the same salt.
export function seededShuffle(list, salt) {
  const random = mulberry32(hashSeed(String(salt)));
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy;
}

// One item per day from a fixed shuffled order: no repeats until the whole list was used.
// Adding items to the END of `list` later keeps earlier days the same only within a cycle,
// so modules that must never change a past day store what they picked.
export function pickForDay(list, day, salt) {
  if (!list.length) return undefined;
  const order = seededShuffle(list.map((_, index) => index), salt);
  const position = ((dayNumber(day) % order.length) + order.length) % order.length;
  return list[order[position]];
}

// ---- Hearts --------------------------------------------------------------------

function normalizePoints(value) {
  return {
    awards: { ...(value?.awards || {}) },
    banked: { her: Number(value?.banked?.her) || 0, sender: Number(value?.banked?.sender) || 0 },
    spent: { her: Number(value?.spent?.her) || 0, sender: Number(value?.spent?.sender) || 0 }
  };
}

function pointsSummary(doc) {
  const earned = { her: doc.banked.her, sender: doc.banked.sender };
  for (const item of Object.values(doc.awards)) {
    if (AUTHORS.includes(item.author)) earned[item.author] += Number(item.amount) || 0;
  }
  return Object.fromEntries(AUTHORS.map((author) => [author, {
    earned: earned[author],
    spent: doc.spent[author],
    balance: earned[author] - doc.spent[author]
  }]));
}

// Hearts earned per kind of award, e.g. { wordle: { her: 4, sender: 6 } } for keys "wordle:…".
// Only counts awards still in the ledger (the last few thousand).
export async function awardTotals(txn) {
  const doc = normalizePoints(await txn.get(POINTS_KEY));
  const totals = {};
  for (const [key, item] of Object.entries(doc.awards)) {
    const kind = key.split(":")[0];
    totals[kind] ||= { her: 0, sender: 0 };
    if (AUTHORS.includes(item.author)) totals[kind][item.author] += Number(item.amount) || 0;
  }
  return totals;
}

// Sets the award `key` (for example "wordle:2026-10-19:her") to `amount` hearts for `author`.
// Setting the same key again replaces it (never adds twice); amount 0 removes it.
// Returns the change in that author's hearts (what the page can show as "+2").
export async function award(txn, key, author, amount) {
  if (!AUTHORS.includes(author)) throw new GameError(400, "Choose who is playing.");
  const doc = normalizePoints(await txn.get(POINTS_KEY));
  const before = doc.awards[key]?.author === author ? Number(doc.awards[key].amount) || 0 : 0;
  const value = Math.max(0, Math.round(Number(amount) || 0));
  if (value === before && (value === 0 || doc.awards[key])) return 0;
  if (value === 0) delete doc.awards[key];
  else doc.awards[key] = { author, amount: value, at: new Date().toISOString() };
  const keys = Object.keys(doc.awards);
  if (keys.length > MAX_AWARDS) {
    // Fold the oldest awards into the totals (they can no longer change).
    const oldest = keys.sort((a, b) => String(doc.awards[a].at).localeCompare(String(doc.awards[b].at)))
      .slice(0, keys.length - MAX_AWARDS);
    for (const old of oldest) {
      const item = doc.awards[old];
      if (AUTHORS.includes(item.author)) doc.banked[item.author] += Number(item.amount) || 0;
      delete doc.awards[old];
    }
  }
  await txn.put(POINTS_KEY, doc);
  return value - before;
}

// Takes hearts from `author`'s balance; 409 when there aren't enough.
export async function spend(txn, author, amount) {
  const value = Math.round(Number(amount) || 0);
  if (!AUTHORS.includes(author) || value <= 0) throw new GameError(400, "That doesn't cost anything.");
  const doc = normalizePoints(await txn.get(POINTS_KEY));
  const balance = pointsSummary(doc)[author].balance;
  if (balance < value) throw new GameError(409, "Not enough hearts yet.", { balance, cost: value });
  doc.spent[author] += value;
  await txn.put(POINTS_KEY, doc);
  return pointsSummary(doc);
}

// Gives back hearts spent earlier (a cancelled purchase).
export async function refund(txn, author, amount) {
  const value = Math.round(Number(amount) || 0);
  if (!AUTHORS.includes(author) || value <= 0) return pointsView(txn);
  const doc = normalizePoints(await txn.get(POINTS_KEY));
  doc.spent[author] = Math.max(0, doc.spent[author] - value);
  await txn.put(POINTS_KEY, doc);
  return pointsSummary(doc);
}

// { her: { earned, spent, balance }, sender: { … } }
export async function pointsView(txn) {
  return pointsSummary(normalizePoints(await txn.get(POINTS_KEY)));
}

// ---- Couple streak ---------------------------------------------------------------

function normalizeActive(value) {
  return { days: { ...(value?.days || {}) }, nudges: { ...(value?.nudges || {}) } };
}

const complete = (entry) => Boolean(entry?.her && entry?.sender);

// Days in a row (ending on `day`) on which both of us played.
function runEndingAt(days, day) {
  let count = 0;
  let cursor = day;
  while (complete(days[cursor])) {
    count += 1;
    cursor = addDays(cursor, -1);
  }
  return count;
}

// Records that `author` played on `day` (today by default). When that makes the day count
// for both of us and the streak reaches a multiple of 7, both get the streak bonus.
// Returns the hearts `author` got from a streak bonus (0 most of the time).
export async function markActive(txn, author, day = zurichDay()) {
  if (!AUTHORS.includes(author) || !isValidDay(day)) return 0;
  const doc = normalizeActive(await txn.get(ACTIVE_KEY));
  const entry = { ...(doc.days[day] || {}) };
  if (entry[author]) return 0;
  const wasComplete = complete(entry);
  entry[author] = new Date().toISOString();
  doc.days[day] = entry;
  const keys = Object.keys(doc.days).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ACTIVE_DAYS))) delete doc.days[old];
  for (const old of Object.keys(doc.nudges).sort().slice(0, Math.max(0, Object.keys(doc.nudges).length - 60))) {
    delete doc.nudges[old];
  }
  await txn.put(ACTIVE_KEY, doc);
  if (wasComplete || !complete(entry)) return 0;
  const run = runEndingAt(doc.days, day);
  if (run === 0 || run % STREAK_MILESTONE !== 0) return 0;
  let mine = 0;
  for (const person of AUTHORS) {
    const delta = await award(txn, `streak:${day}:${person}`, person, STREAK_BONUS);
    if (person === author) mine = delta;
  }
  return mine;
}

// The streak right now: days in a row we both played, ending today if today already
// counts, otherwise ending yesterday (so it isn't lost until today is over).
export async function streakView(txn, today = zurichDay()) {
  const doc = normalizeActive(await txn.get(ACTIVE_KEY));
  const todayEntry = doc.days[today] || {};
  const count = complete(todayEntry) ? runEndingAt(doc.days, today) : runEndingAt(doc.days, addDays(today, -1));
  let best = 0;
  for (const day of Object.keys(doc.days)) {
    if (complete(doc.days[day]) && !complete(doc.days[addDays(day, 1)])) best = Math.max(best, runEndingAt(doc.days, day));
  }
  const lastDays = Array.from({ length: 7 }, (_, index) => addDays(today, index - 6)).map((day) => ({
    day,
    her: Boolean(doc.days[day]?.her),
    sender: Boolean(doc.days[day]?.sender)
  }));
  return {
    count,
    best: Math.max(best, count),
    today: { her: Boolean(todayEntry.her), sender: Boolean(todayEntry.sender) },
    // The streak only lives on if today counts for both of us before midnight.
    atRisk: count > 0 && !complete(todayEntry),
    lastDays,
    nudges: { her: doc.nudges[today]?.her || null, sender: doc.nudges[today]?.sender || null }
  };
}

// One "Don't break our streak!" nudge per person per day, only while the other hasn't played.
export async function recordNudge(txn, author, today = zurichDay()) {
  const doc = normalizeActive(await txn.get(ACTIVE_KEY));
  if (doc.days[today]?.[other(author)]) throw new GameError(409, "They already played today.");
  if (doc.nudges[today]?.[author]) throw new GameError(409, "You already nudged today.");
  doc.nudges[today] = { ...(doc.nudges[today] || {}), [author]: new Date().toISOString() };
  await txn.put(ACTIVE_KEY, doc);
  return doc.nudges[today][author];
}

// ---- One-time backfill ---------------------------------------------------------------

// Daily-question answers written before the games existed count too: a heart for each
// answer and the days we both answered for the streak. Runs once per store.
export async function ensureMigrated(txn) {
  if (await txn.get(MIGRATED_KEY)) return false;
  const questions = await txn.get(QUESTIONS_KEY);
  const answers = [];
  for (const [day, entry] of Object.entries(questions?.days || {})) {
    for (const author of AUTHORS) {
      const answer = entry?.answers?.[author];
      if (answer?.text) answers.push({ day, author, at: answer.at });
    }
  }
  answers.sort((a, b) => String(a.at).localeCompare(String(b.at)));
  for (const item of answers) {
    await award(txn, `question:${item.day}:${item.author}`, item.author, 1);
    const at = new Date(item.at);
    await markActive(txn, item.author, Number.isFinite(at.getTime()) ? zurichDay(at) : item.day);
  }
  await txn.put(MIGRATED_KEY, new Date().toISOString());
  return true;
}
