// Stop the clock: stop a stopwatch at exactly the day's target (say 5.25 seconds). The
// digits vanish after 1.5 seconds, so you have to feel it. Three tries, the closest one
// counts. The phone times each try (the Worker can't time milliseconds over the network)
// and sends it the moment you stop, one at a time, so there's no redo. The other one's
// tries show once you've used all three; the closer best try wins the day.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";

const KEY = "games:clock";
const MAX_DAYS = 400;
const HISTORY_DAYS = 7;
export const TRIES = 3;
export const MAX_TRY_MS = 30000;
// Best tries this close together are a tie.
export const TIE_MS = 5;
// A best try this close to the target earns a bonus heart.
export const PERFECT_MS = 50;

// 3.00 to 9.00 seconds in quarter seconds, in a fixed shuffled order (one per day).
export const TARGETS = Array.from({ length: 25 }, (_, index) => 3000 + index * 250);
const ORDER = seededShuffle(TARGETS.map((_, index) => index), "stop-the-clock");

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

export function targetFor(day) {
  const number = dayNumber(day);
  return TARGETS[ORDER[((number % ORDER.length) + ORDER.length) % ORDER.length]];
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  doc.days[day] = { target: targetFor(day), players: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const triesOf = (entry, author) => (Array.isArray(entry?.players?.[author]?.tries) ? entry.players[author].tries : []);
const doneOf = (entry, author) => triesOf(entry, author).length >= TRIES;
const offsOf = (tries, target) => tries.map((ms) => Math.abs(ms - target));
const bestOf = (tries, target) => (tries.length ? Math.min(...offsOf(tries, target)) : null);

export function clockResult(entry) {
  if (!doneOf(entry, "her") || !doneOf(entry, "sender")) return null;
  const best = { her: bestOf(triesOf(entry, "her"), entry.target), sender: bestOf(triesOf(entry, "sender"), entry.target) };
  let winner = "tie";
  if (Math.abs(best.her - best.sender) > TIE_MS) winner = best.her < best.sender ? "her" : "sender";
  return { best, winner, perfect: { her: best.her <= PERFECT_MS, sender: best.sender <= PERFECT_MS } };
}

function playerView(entry, author) {
  const tries = triesOf(entry, author);
  return { tries, offs: offsOf(tries, entry.target), best: bestOf(tries, entry.target), done: tries.length >= TRIES };
}

function dayView(entry, day, author) {
  const mine = playerView(entry, author);
  const theirsDone = doneOf(entry, other(author));
  return {
    day,
    target: entry.target,
    tries: TRIES,
    done: mine.done,
    // My own tries so far; theirs only once I've used all of mine (and they've played).
    mine,
    theirs: mine.done && theirsDone ? playerView(entry, other(author)) : null,
    theirsDone,
    result: mine.done ? clockResult(entry) : null
  };
}

// Wins, perfect stops and the best try ever. Today only counts once `viewer` played it,
// so the other one's numbers never give away how today went for them.
export function clockStats(doc, today, viewer) {
  const days = Object.keys(doc.days).filter((day) => day < today || (day === today && doneOf(doc.days[day], viewer))).sort();
  const wins = { her: 0, sender: 0 };
  const perfect = { her: 0, sender: 0 };
  const best = { her: null, sender: null };
  let daysPlayed = 0;
  for (const day of days) {
    const entry = doc.days[day];
    const result = clockResult(entry);
    if (result) {
      daysPlayed += 1;
      if (result.winner !== "tie") wins[result.winner] += 1;
    }
    for (const author of AUTHORS) {
      if (!doneOf(entry, author)) continue;
      const off = bestOf(triesOf(entry, author), entry.target);
      if (off <= PERFECT_MS) perfect[author] += 1;
      if (best[author] === null || off < best[author]) best[author] = off;
    }
  }
  return { daysPlayed, wins, perfect, best };
}

function view(doc, day, author, today) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && doneOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => ({ day: key, target: doc.days[key].target, best: bestOf(triesOf(doc.days[key], author), doc.days[key].target), result: clockResult(doc.days[key]) }));
  return { ...dayView(doc.days[day], day, author), stats: clockStats(doc, today, author), history };
}

function parseTry(value) {
  const ms = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0 || ms > MAX_TRY_MS) {
    throw new GameError(400, "That try doesn’t look right (0 to 30 seconds).");
  }
  return Math.round(ms);
}

function parseIndex(value) {
  if (!Number.isInteger(value) || value < 0 || value >= TRIES) throw new GameError(400, "Which try was that?");
  return value;
}

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = parseDay(ctx.query("day"), ctx.today);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    if (day === ctx.today) {
      if (assignDay(doc, day, ctx.now)) await txn.put(KEY, doc);
    } else if (!doc.days[day]) {
      throw new GameError(404, "There was no stop the clock that day.");
    }
    return view(doc, day, author, ctx.today);
  });
}

async function act(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here’s today’s target.");
  if (ctx.body.action !== "try") throw new GameError(400, "Unknown action.");
  const index = parseIndex(ctx.body.index);
  const ms = parseTry(ctx.body.ms);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    const tries = [...triesOf(entry, author)];
    if (index < tries.length) {
      // The same try sent again (the answer got lost on the way): nothing changes.
      if (tries[index] === ms) return { ...view(doc, day, author, ctx.today), awarded: 0 };
      throw new GameError(409, "That try is already in. No redos!");
    }
    if (tries.length >= TRIES) throw new GameError(409, "You already used your 3 tries today.");
    if (index !== tries.length) throw new GameError(409, "Your tries got out of step. Here’s where you are.");
    tries.push(ms);
    const player = { ...(entry.players?.[author] || {}), tries };
    if (tries.length >= TRIES) player.doneAt = ctx.now;
    entry.players = { ...(entry.players || {}), [author]: player };
    await txn.put(KEY, doc);
    let awarded = 0;
    if (tries.length >= TRIES) {
      awarded += await award(txn, `clock:${day}:play:${author}`, author, 1);
      const result = clockResult(entry);
      if (result) {
        for (const person of AUTHORS) {
          let hearts = result.winner === person ? 2 : result.winner === "tie" ? 1 : 0;
          if (result.perfect[person]) hearts += 1;
          const delta = await award(txn, `clock:${day}:score:${person}`, person, hearts);
          if (person === author) awarded += delta;
        }
      }
    }
    awarded += await markActive(txn, author, ctx.today);
    return { ...view(doc, day, author, ctx.today), awarded };
  });
}

export const routes = {
  "/games/clock": async (ctx) => {
    if (ctx.method === "GET") return read(ctx);
    if (ctx.method === "POST") return act(ctx);
    throw new GameError(405, "Method not allowed.");
  }
};

// Seconds off for the leaderboard, as text so the hub shows it as is ("0.013"). A perfect
// 0 ms shows as 0.001 (the hub reads 0 in a lower-wins row as "no games yet").
const offText = (ms) => (ms === null ? null : (Math.max(1, ms) / 1000).toFixed(3));

export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const entry = doc.days[ctx.today];
  const mine = triesOf(entry, ctx.author).length;
  const theirs = doneOf(entry, other(ctx.author));
  const target = entry?.target ?? targetFor(ctx.today);
  let status = "todo";
  let line = theirs ? "{them} played. Your turn" : `Stop at exactly ${(target / 1000).toFixed(2)} s`;
  if (mine > 0 && mine < TRIES) line = `${mine} of ${TRIES} tries done`;
  if (mine >= TRIES && theirs) {
    const result = clockResult(entry);
    status = "done";
    line = result.winner === "tie" ? "A tie today" : `${result.winner === ctx.author ? "{me}" : "{them}"} won today`;
  } else if (mine >= TRIES) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = clockStats(doc, ctx.today, ctx.author);
  const board = [{ label: "Stop the clock wins", her: stats.wins.her, sender: stats.wins.sender }];
  if (stats.best.her !== null || stats.best.sender !== null) {
    board.push({ label: "Best ever (s off)", her: offText(stats.best.her), sender: offText(stats.best.sender), lowerWins: true });
  }
  return { id: "clock", title: "Stop the clock", icon: "timer", step: "clock", status, line, board };
}
