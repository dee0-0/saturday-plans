// Speed round: 10 this-or-that pairs in 15 seconds, no time to think. The pairs stay
// hidden until you tap Start (the Worker notes when), so nobody can read them first.
// Once we both played: how many we picked the same, and who was faster (more answered,
// then less time). The time is the shorter of what the phone measured and what the
// Worker saw between Start and the answers.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";
import { PAIRS } from "./match.js";

const KEY = "games:speed";
const MAX_DAYS = 400;
const COUNT = 10;
export const LIMIT_MS = 15000;
const GRACE_MS = 4000;      // network time on top of the 15 seconds
const SYNC_MIN = 7;         // this many the same earns both a heart
const HISTORY_DAYS = 7;
const ORDER = seededShuffle(PAIRS.map((_, index) => index), "speed-round");

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  const start = (dayNumber(day) * COUNT) % ORDER.length;
  const pairs = Array.from({ length: COUNT }, (_, index) => PAIRS[ORDER[(start + index) % ORDER.length]])
    .map(([left, right, leftIcon = "", rightIcon = ""]) => [left, right, leftIcon, rightIcon]);
  doc.days[day] = { pairs, players: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const playerOf = (entry, author) => entry?.players?.[author] || null;
const doneOf = (entry, author) => Boolean(playerOf(entry, author)?.doneAt);
const answeredOf = (picks) => picks.filter((pick) => pick === 0 || pick === 1).length;

export function speedResult(entry) {
  const her = playerOf(entry, "her");
  const sender = playerOf(entry, "sender");
  if (!her?.doneAt || !sender?.doneAt) return null;
  const matches = her.picks.reduce((count, pick, index) => count + ((pick === 0 || pick === 1) && pick === sender.picks[index] ? 1 : 0), 0);
  const answered = { her: answeredOf(her.picks), sender: answeredOf(sender.picks) };
  let faster = "tie";
  if (answered.her !== answered.sender) faster = answered.her > answered.sender ? "her" : "sender";
  else if (Math.abs(her.ms - sender.ms) >= 50) faster = her.ms < sender.ms ? "her" : "sender";
  return { matches, answered, ms: { her: her.ms, sender: sender.ms }, faster };
}

function dayView(entry, day, author, now) {
  const mine = playerOf(entry, author);
  const theirs = playerOf(entry, other(author));
  const started = Boolean(mine?.startedAt);
  const done = Boolean(mine?.doneAt);
  const left = started && !done ? Math.max(0, LIMIT_MS - (Date.parse(now) - Date.parse(mine.startedAt))) : null;
  return {
    day,
    started,
    done,
    leftMs: left,
    // The pairs only once I started (so nobody can read them before the clock runs).
    pairs: started ? entry.pairs : null,
    mine: done ? { picks: mine.picks, ms: mine.ms } : null,
    theirs: done && theirs?.doneAt ? { picks: theirs.picks, ms: theirs.ms } : null,
    theirsDone: Boolean(theirs?.doneAt),
    result: done ? speedResult(entry) : null
  };
}

export function speedStats(doc, today) {
  const played = Object.keys(doc.days).filter((day) => day <= today && speedResult(doc.days[day])).sort();
  const wins = { her: 0, sender: 0 };
  let matches = 0;
  let best = { her: null, sender: null };
  for (const day of played) {
    const result = speedResult(doc.days[day]);
    matches += result.matches;
    if (result.faster !== "tie") wins[result.faster] += 1;
    for (const author of AUTHORS) {
      if (result.answered[author] === COUNT && (best[author] === null || result.ms[author] < best[author])) best[author] = result.ms[author];
    }
  }
  return { daysPlayed: played.length, sync: played.length ? Math.round((100 * matches) / (played.length * COUNT)) : null, wins, best };
}

function view(doc, day, author, today, now) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && doneOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => ({ day: key, result: speedResult(doc.days[key]) }));
  return { ...dayView(doc.days[day], day, author, now), limitMs: LIMIT_MS, count: COUNT, stats: speedStats(doc, today), history };
}

function parsePicks(value) {
  if (!Array.isArray(value) || value.length !== COUNT || !value.every((pick) => pick === 0 || pick === 1 || pick === null)) {
    throw new GameError(400, "Those answers don't look right.");
  }
  return [...value];
}

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = parseDay(ctx.query("day"), ctx.today);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    if (day === ctx.today) {
      if (assignDay(doc, day, ctx.now)) await txn.put(KEY, doc);
    } else if (!doc.days[day]) {
      throw new GameError(404, "There was no speed round that day.");
    }
    return view(doc, day, author, ctx.today, ctx.now);
  });
}

async function act(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here's today's round.");
  const action = ctx.body.action;
  if (!["start", "submit"].includes(action)) throw new GameError(400, "Unknown action.");
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    const player = { ...(playerOf(entry, author) || {}) };
    if (player.doneAt) throw new GameError(409, "You already played today's speed round.");
    let awarded = 0;
    if (action === "start") {
      // Starting again (a reload) keeps the first start: the clock doesn't reset.
      if (!player.startedAt) player.startedAt = ctx.now;
    } else {
      if (!player.startedAt) throw new GameError(409, "Tap Start first.");
      const picks = parsePicks(ctx.body.picks);
      const seen = Date.parse(ctx.now) - Date.parse(player.startedAt);
      const told = Number(ctx.body.ms);
      // Too late: whatever came in after the 15 seconds (plus a little network time) doesn't count.
      const late = seen > LIMIT_MS + GRACE_MS;
      const ms = Math.round(Math.max(0, Math.min(LIMIT_MS, Number.isFinite(told) && told > 0 ? Math.min(told, seen) : seen)));
      Object.assign(player, { picks: late ? picks.map(() => null) : picks, ms: late ? LIMIT_MS : ms, doneAt: ctx.now });
    }
    entry.players = { ...(entry.players || {}), [author]: player };
    await txn.put(KEY, doc);
    if (action === "submit") {
      awarded += await award(txn, `speed:${day}:play:${author}`, author, 1);
      const result = speedResult(entry);
      if (result) {
        for (const person of AUTHORS) {
          let hearts = result.matches >= SYNC_MIN ? 1 : 0;
          if (result.faster === person) hearts += 2;
          else if (result.faster === "tie") hearts += 1;
          const delta = await award(txn, `speed:${day}:score:${person}`, person, hearts);
          if (person === author) awarded += delta;
        }
      }
      awarded += await markActive(txn, author, ctx.today);
    }
    return { ...view(doc, day, author, ctx.today, ctx.now), awarded };
  });
}

export const routes = {
  "/games/speed": async (ctx) => {
    if (ctx.method === "GET") return read(ctx);
    if (ctx.method === "POST") return act(ctx);
    throw new GameError(405, "Method not allowed.");
  }
};

export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const entry = doc.days[ctx.today];
  const mine = doneOf(entry, ctx.author);
  const theirs = doneOf(entry, other(ctx.author));
  let status = "todo";
  let line = theirs ? "{them} played. Your turn" : "10 picks in 15 seconds";
  if (mine && theirs) {
    const result = speedResult(entry);
    status = "done";
    line = result.faster === "tie" ? `${result.matches} the same · a tie` : `${result.matches} the same · ${result.faster === ctx.author ? "{me}" : "{them}"} faster`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = speedStats(doc, ctx.today);
  const board = [{ label: "Speed round wins", her: stats.wins.her, sender: stats.wins.sender }];
  if (stats.best.her !== null && stats.best.sender !== null) {
    board.push({ label: "Fastest round (s)", her: Math.round(stats.best.her / 100) / 10, sender: Math.round(stats.best.sender / 100) / 10, lowerWins: true });
  }
  return { id: "speed", title: "Speed round", icon: "zap", step: "speed", status, line, board };
}
