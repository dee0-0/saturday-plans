// Secret hunt, season 2: 20 harder easter eggs we hunt for together. Both phones find them
// and share one list (each find remembers who found it). Four of them need both phones at
// once: the page "pings" the Worker with the egg's key, and the Worker checks whether the
// other phone pinged the same key recently (in the right way); then the egg is found for both
// of us and both get the hearts. The riddles and hints live in the page (hunt.js); the Worker
// only knows the ids. Season 2 opens once season 1 is complete (all 16 ids in "secrets").
import { GameError, AUTHORS, parseAuthor, cleanLine, other, award, markActive, pointsView, spend, zurichDay } from "./common.js";

const KEY = "games:hunt";
// Season 1's easter eggs (worker/src/index.js keeps the list her phone found under this key).
const SECRETS_KEY = "secrets";
export const SEASON_ONE = [
  "seal", "heart", "signature", "countdown", "weather", "mcdonalds", "scratch", "shake",
  "logo", "sound", "footer", "game", "broccoli", "coupon", "hearts", "night"
];

// Eggs one phone finds on its own (the page reports them with action "found").
export const SOLO = [
  "wish", "dateday", "dayone", "slowburn", "infinity", "palindrome", "firstq", "neither",
  "xoxox", "corners", "iloveus", "priceless", "rainbow", "silence", "hug", "heartsonly"
];
// Eggs that need both phones (action "ping"). `window` is in seconds.
//   parts: each phone sends one of the two parts (either order, unless `ordered`: then the
//          first part has to come before the second)
//   sameValue: both phones send the same value (the same night, the same challenge)
export const TOGETHER = {
  peapod: { window: 10 * 60, parts: ["pea", "pod"] },
  midnight: { window: 5 * 60, sameValue: true },
  team: { window: 20, sameValue: true },
  bell: { window: 60, parts: ["ring", "answer"], ordered: true }
};
export const IDS = [...SOLO, ...Object.keys(TOGETHER)];
export const TOTAL = IDS.length;

export const FIND_HEARTS = 2;
export const COMPLETE_HEARTS = 20;
export const HINT_COST = 5;
const ACTIONS = ["found", "hint", "ping"];
const PING_TTL = 24 * 60 * 60 * 1000;
const MAX_VALUE = 40;
const FINDERS = [...AUTHORS, "both"];

const validTime = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));

function normalize(value) {
  const found = {};
  for (const id of IDS) {
    const item = value?.found?.[id];
    if (item && FINDERS.includes(item.by) && validTime(item.at)) found[id] = { by: item.by, at: item.at };
  }
  const hints = {};
  for (const id of IDS) {
    const item = value?.hints?.[id];
    if (item && AUTHORS.includes(item.by) && validTime(item.at)) hints[id] = { by: item.by, at: item.at };
  }
  const pings = {};
  for (const key of Object.keys(TOGETHER)) {
    for (const author of AUTHORS) {
      const item = value?.pings?.[key]?.[author];
      if (!item || !validTime(item.at)) continue;
      pings[key] ||= {};
      pings[key][author] = {
        at: item.at,
        part: typeof item.part === "string" ? item.part : "",
        value: typeof item.value === "string" ? item.value : ""
      };
    }
  }
  return { found, hints, pings, completedAt: validTime(value?.completedAt) ? value.completedAt : null };
}

// Pings older than a day can't match anything any more.
function prunePings(doc, now) {
  for (const [key, entry] of Object.entries(doc.pings)) {
    for (const author of AUTHORS) {
      if (entry[author] && now - Date.parse(entry[author].at) > PING_TTL) delete entry[author];
    }
    if (!entry.her && !entry.sender) delete doc.pings[key];
  }
}

async function seasonOne(txn) {
  const list = await txn.get(SECRETS_KEY);
  const found = Array.isArray(list) ? SEASON_ONE.filter((id) => list.includes(id)).length : 0;
  return { found, total: SEASON_ONE.length, complete: found === SEASON_ONE.length };
}

// How many each of us found (eggs found together count for both).
function counts(doc) {
  const result = { her: 0, sender: 0, both: 0 };
  for (const item of Object.values(doc.found)) result[item.by] += 1;
  return { ...result, her: result.her + result.both, sender: result.sender + result.both, together: result.both };
}

async function view(txn, doc, season1) {
  return {
    unlocked: season1.complete,
    season1: { found: season1.found, total: season1.total },
    total: TOTAL,
    found: doc.found,
    hints: IDS.filter((id) => doc.hints[id]),
    hintsBy: doc.hints,
    count: Object.keys(doc.found).length,
    counts: counts(doc),
    completed: Boolean(doc.completedAt),
    completedAt: doc.completedAt,
    cost: HINT_COST,
    points: await pointsView(txn)
  };
}

// The 20th find: 20 hearts each, once.
async function complete(txn, doc, actor, now) {
  if (doc.completedAt || Object.keys(doc.found).length < TOTAL) return 0;
  doc.completedAt = now;
  let mine = 0;
  for (const person of AUTHORS) {
    const delta = await award(txn, `hunt:complete:${person}`, person, COMPLETE_HEARTS);
    if (person === actor) mine = delta;
  }
  return mine;
}

function lockedError(season1) {
  return new GameError(409, "Finish season 1 first.", { season1: { found: season1.found, total: season1.total } });
}

async function found(ctx, txn, doc, author, season1) {
  const id = ctx.body?.id;
  if (typeof id !== "string" || !IDS.includes(id)) throw new GameError(400, "Unknown secret.");
  if (TOGETHER[id]) throw new GameError(400, "That secret needs both of you.");
  if (!season1.complete) throw lockedError(season1);
  if (doc.found[id]) return { new: false, id, awarded: 0, justCompleted: false };
  doc.found[id] = { by: author, at: ctx.now };
  let awarded = await award(txn, `hunt:${id}:${author}`, author, FIND_HEARTS);
  awarded += await markActive(txn, author, ctx.today);
  const before = doc.completedAt;
  awarded += await complete(txn, doc, author, ctx.now);
  return { new: true, id, awarded, justCompleted: !before && Boolean(doc.completedAt) };
}

async function hint(ctx, txn, doc, author, season1) {
  const id = ctx.body?.id;
  if (typeof id !== "string" || !IDS.includes(id)) throw new GameError(400, "Unknown secret.");
  if (!season1.complete) throw lockedError(season1);
  // Bought once, by either of us: both see it, nobody pays twice.
  if (doc.hints[id]) return { id, spent: 0 };
  if (doc.found[id]) throw new GameError(409, "That secret is already found.");
  await spend(txn, author, HINT_COST);
  doc.hints[id] = { by: author, at: ctx.now };
  return { id, spent: HINT_COST };
}

async function ping(ctx, txn, doc, author, season1) {
  const key = ctx.body?.key;
  const rule = typeof key === "string" && Object.hasOwn(TOGETHER, key) ? TOGETHER[key] : null;
  if (!rule) throw new GameError(400, "Unknown secret.");
  let part = "";
  if (rule.parts) {
    part = ctx.body?.part;
    if (!rule.parts.includes(part)) throw new GameError(400, "Unknown secret.");
  }
  const value = rule.sameValue ? cleanLine(ctx.body?.value, MAX_VALUE, "Unknown secret.") : "";
  if (!season1.complete) throw lockedError(season1);
  if (doc.found[key]) return { new: false, id: key, together: true, awarded: 0, justCompleted: false };

  const now = Date.parse(ctx.now);
  prunePings(doc, now);
  const theirs = doc.pings[key]?.[other(author)];
  const age = theirs ? now - Date.parse(theirs.at) : Infinity;
  const matched = Boolean(theirs) && age >= 0 && age <= rule.window * 1000
    && (!rule.sameValue || theirs.value === value)
    && (!rule.parts || theirs.part !== part)
    && (!rule.ordered || (theirs.part === rule.parts[0] && part === rule.parts[1]));
  if (!matched) {
    doc.pings[key] = { ...(doc.pings[key] || {}), [author]: { at: ctx.now, part, value } };
    return { new: false, id: key, together: false, awarded: 0, justCompleted: false, window: rule.window };
  }

  // Found together: it counts for both of us, and both get the hearts.
  delete doc.pings[key];
  doc.found[key] = { by: "both", at: ctx.now };
  let awarded = 0;
  for (const person of AUTHORS) {
    const delta = await award(txn, `hunt:${key}:${person}`, person, FIND_HEARTS);
    const streak = await markActive(txn, person, ctx.today);
    if (person === author) awarded += delta + streak;
  }
  const before = doc.completedAt;
  awarded += await complete(txn, doc, author, ctx.now);
  return { new: true, id: key, together: true, awarded, justCompleted: !before && Boolean(doc.completedAt) };
}

async function hunt(ctx) {
  if (ctx.method === "GET") {
    parseAuthor(ctx.query("author"));
    return ctx.storage.transaction(async (txn) => view(txn, normalize(await txn.get(KEY)), await seasonOne(txn)));
  }
  if (ctx.method !== "POST") throw new GameError(405, "Method not allowed.");
  const author = parseAuthor(ctx.body?.author);
  const action = ctx.body?.action;
  if (!ACTIONS.includes(action)) throw new GameError(400, "Unknown action.");
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    const season1 = await seasonOne(txn);
    const handler = { found, hint, ping }[action];
    const result = await handler(ctx, txn, doc, author, season1);
    await txn.put(KEY, doc);
    return { ...(await view(txn, doc, season1)), ...result };
  });
}

export const routes = {
  "/games/hunt": hunt
};

// Hidden on the hub until season 1 is complete.
export async function summary(ctx) {
  const season1 = await seasonOne(ctx.storage);
  if (!season1.complete) return null;
  const doc = normalize(await ctx.storage.get(KEY));
  const count = Object.keys(doc.found).length;
  const them = other(ctx.author);
  // Something new waits for me: the other one found a secret today.
  const fresh = Object.values(doc.found).some((item) => item.by === them && zurichDay(new Date(item.at)) === ctx.today);
  const mine = counts(doc);
  return {
    id: "hunt",
    title: "Secret hunt · Season 2",
    icon: "key-round",
    step: "hunt",
    status: count >= TOTAL ? "done" : fresh ? "new" : "idle",
    line: count >= TOTAL ? "All 20 found together" : `${count} of ${TOTAL} found`,
    board: [{ label: "Season 2 secrets", her: mine.her, sender: mine.sender }]
  };
}
