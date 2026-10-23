// How many? A picture (sweets in a jar, hearts in a box, stars in the sky…) shows for
// 5 seconds after you tap Start, then it's gone: guess how many things were in it. The
// day's scene (what, how many, a seed) is picked from the day and stored. The Worker works
// out where every item goes and sends that drawing data only during your 5 seconds and
// after your guess; the number itself only once you've guessed. The closer guess wins.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";

const KEY = "games:count";
const MAX_DAYS = 400;
const HISTORY_DAYS = 7;
export const SHOW_MS = 5000;
export const MIN_ITEMS = 20;
export const MAX_ITEMS = 180;
const MAX_GUESS = 9999;
// Within this share of the real number earns a bonus heart (exact earns two).
export const CLOSE = 0.1;

// What the picture can be. The page (count.js) draws each kind; the layouts below place
// the items inside the shapes it draws (a 1000 x 1000 scene).
export const KINDS = {
  sweets: { title: "Sweets in a jar", noun: "sweets", question: "How many sweets were in the jar?", line: "Count the sweets in the jar" },
  hearts: { title: "Hearts in a box", noun: "hearts", question: "How many hearts were in the box?", line: "Count the hearts in the box" },
  stars: { title: "Stars in the sky", noun: "stars", question: "How many stars were in the sky?", line: "Count the stars in the sky" },
  balloons: { title: "A bunch of balloons", noun: "balloons", question: "How many balloons were there?", line: "Count the balloons" },
  dots: { title: "Dots in a circle", noun: "dots", question: "How many dots were in the circle?", line: "Count the dots in the circle" },
  sheep: { title: "Sheep in a field", noun: "sheep", question: "How many sheep were in the field?", line: "Count the sheep in the field" },
  fish: { title: "Fish in a tank", noun: "fish", question: "How many fish were in the tank?", line: "Count the fish in the tank" }
};
export const KIND_IDS = Object.keys(KINDS);

// Every number from 20 to 180 once, in a fixed shuffled order (161 days without a repeat).
const COUNTS = seededShuffle(Array.from({ length: MAX_ITEMS - MIN_ITEMS + 1 }, (_, index) => MIN_ITEMS + index), "how-many");

function hash(text) {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

// The same random numbers for the same seed (mulberry32, like common.js).
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (number, size) => ((number % size) + size) % size;

// The day's picture kind: every kind once per cycle, never the same two days running.
export function kindFor(day) {
  const number = dayNumber(day);
  const size = KIND_IDS.length;
  const cycle = Math.floor(number / size);
  const order = (at) => seededShuffle(KIND_IDS, `how-many-kinds:${at}`);
  let list = order(cycle);
  if (list[0] === order(cycle - 1)[size - 1]) list = [list[1], list[0], ...list.slice(2)];
  return list[wrap(number, size)];
}

export function sceneFor(day) {
  return { kind: kindFor(day), n: COUNTS[wrap(dayNumber(day), COUNTS.length)], seed: hash(`how-many:${day}`) };
}

/* ------------------------------- Layouts -------------------------------- */
// Each item is [x, y, size, angle (degrees), colour index, flipped (0|1)], whole numbers
// in the 1000 x 1000 scene. Keep the shapes here in step with the drawings in count.js.
export const JAR = { left: 232, right: 768, floor: 884, corner: 58, top: 336 };
export const BOX = { left: 150, right: 850, top: 262, bottom: 872 };
export const SKY = { left: 34, right: 966, top: 34, bottom: 744, moonY: 150, moonR: 72 };
export const BUNCH = { x: 500, y: 400, rx: 420, ry: 320, knotY: 922 };
export const DISC = { x: 500, y: 500, r: 404 };
export const FIELD = { left: 36, right: 964, top: 452, bottom: 958 };
export const TANK = { left: 108, right: 892, top: 196, bottom: 800 };

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
// How full a picture looks: airy with few items, busier with many.
const busy = (n) => clamp((n - MIN_ITEMS) / (MAX_ITEMS - MIN_ITEMS), 0, 1);
export const moonLeft = (seed) => seed % 2 === 1;

// Best-candidate scattering: each new item goes to the spot (of a few random ones) that
// keeps the most room to the others, so items spread evenly but still look random.
function scatter(n, rand, size, sample, { squash = 1, tries = 16 } = {}) {
  const items = [];
  for (let index = 0; index < n; index += 1) {
    const own = size(rand);
    let best = null;
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const spot = sample(rand, own);
      const r = own * (spot.scale ?? 1);
      let room = Infinity;
      for (const item of items) {
        const gap = Math.hypot(item.x - spot.x, (item.y - spot.y) * squash) - (item.r + r);
        if (gap < room) room = gap;
      }
      if (!best || room > best.room) best = { x: spot.x, y: spot.y, r, room };
    }
    items.push(best);
  }
  return items;
}

// The jar's floor under a sweet of radius r at x (rounded corners at the bottom).
function floorAt(x, r) {
  const { left, right, floor, corner } = JAR;
  const centre = x < left + corner ? left + corner : x > right - corner ? right - corner : null;
  if (centre === null) return floor - r;
  const reach = Math.max(0, corner - r);
  const dx = Math.min(reach, Math.abs(x - centre));
  return floor - corner + Math.sqrt(reach * reach - dx * dx);
}

// Sweets poured into the jar: each one drops at a few random spots and stays where it
// lands lowest, overlapping its neighbours a little, like a real jar seen from the side.
function pour(n, base, rand) {
  const items = [];
  for (let index = 0; index < n; index += 1) {
    const r = base * (0.88 + rand() * 0.24);
    let best = null;
    for (let attempt = 0; attempt < 22; attempt += 1) {
      const x = JAR.left + r + rand() * (JAR.right - JAR.left - 2 * r);
      let y = floorAt(x, r);
      for (const item of items) {
        const reach = (r + item.r) * 0.84;
        const dx = Math.abs(item.x - x);
        if (dx < reach) y = Math.min(y, item.y - Math.sqrt(reach * reach - dx * dx));
      }
      if (!best || y > best.y) best = { x, y, r };
    }
    items.push(best);
  }
  return items;
}

const LAYOUTS = {
  sweets(n, rand) {
    const area = (JAR.right - JAR.left) * (JAR.floor - JAR.top);
    let base = clamp(Math.sqrt(((0.62 + rand() * 0.36) * area) / (n * Math.PI)), 14, 60);
    let items = pour(n, base, rand);
    // Too full for the jar: smaller sweets until they fit under the shoulders.
    for (let attempt = 0; attempt < 10 && items.some((item) => item.y - item.r < JAR.top); attempt += 1) {
      base *= 0.93;
      items = pour(n, base, rand);
    }
    return items.map((item) => [item.x, item.y, item.r, 0, Math.floor(rand() * 7), 0]);
  },
  hearts(n, rand) {
    const area = (BOX.right - BOX.left) * (BOX.bottom - BOX.top);
    const base = clamp(Math.sqrt(((0.42 + 0.5 * busy(n)) * area) / (2.6 * n)), 24, 84);
    return scatter(n, rand, () => base * (0.85 + rand() * 0.3), (next, s) => ({
      x: BOX.left + s + next() * (BOX.right - BOX.left - 2 * s),
      y: BOX.top + s * 0.8 + next() * (BOX.bottom - BOX.top - 1.7 * s)
    })).map((item) => [item.x, item.y, item.r, Math.round((rand() - 0.5) * 56), Math.floor(rand() * 6), 0]);
  },
  stars(n, rand, seed) {
    const moonX = moonLeft(seed) ? 170 : 830;
    const area = (SKY.right - SKY.left) * (SKY.bottom - SKY.top) - Math.PI * 130 * 130;
    const base = clamp(Math.sqrt(((0.06 + 0.12 * busy(n)) * area) / n), 15, 44);
    return scatter(n, rand, () => base * (0.7 + rand() * 0.6), (next, s) => {
      let spot = null;
      for (let attempt = 0; attempt < 40 && !spot; attempt += 1) {
        const x = SKY.left + s + next() * (SKY.right - SKY.left - 2 * s);
        const y = SKY.top + s + next() * (SKY.bottom - SKY.top - 2 * s);
        if (Math.hypot(x - moonX, y - SKY.moonY) > SKY.moonR + 30 + s) spot = { x, y };
      }
      return spot || { x: 500, y: SKY.bottom - s };
    }).map((item) => [item.x, item.y, item.r, Math.round(rand() * 72), Math.floor(rand() * 5), 0]);
  },
  balloons(n, rand) {
    const full = Math.PI * BUNCH.rx * BUNCH.ry;
    const cover = 0.8 + 0.35 * busy(n);
    const base = clamp(Math.sqrt((cover * full) / (0.9 * Math.PI * n)), 26, 76);
    // A small bunch stays small: the cluster only grows as big as its balloons need.
    const k = Math.min(1, Math.sqrt((n * 0.9 * Math.PI * base * base) / cover / full));
    const items = scatter(n, rand, () => base * (0.9 + rand() * 0.2), (next, s) => {
      const angle = next() * Math.PI * 2;
      const reach = Math.sqrt(next());
      return { x: BUNCH.x + Math.cos(angle) * reach * (BUNCH.rx * k - s * 0.3), y: BUNCH.y + Math.sin(angle) * reach * (BUNCH.ry * k - s * 0.3) };
    }, { squash: 0.9 });
    return items
      .sort((a, b) => a.y - b.y)
      .map((item) => [item.x, item.y, item.r, Math.round((Math.atan2(item.x - BUNCH.x, BUNCH.knotY - item.y) * 180) / Math.PI * 0.6), Math.floor(rand() * 7), 0]);
  },
  dots(n, rand) {
    const area = Math.PI * DISC.r * DISC.r;
    const base = clamp(Math.sqrt(((0.38 + 0.3 * busy(n)) * area) / (Math.PI * n)), 11, 66);
    return scatter(n, rand, () => base * (0.62 + rand() * 0.76), (next, s) => {
      const angle = next() * Math.PI * 2;
      const reach = Math.sqrt(next()) * (DISC.r - s);
      return { x: DISC.x + Math.cos(angle) * reach, y: DISC.y + Math.sin(angle) * reach };
    }).map((item) => [item.x, item.y, item.r, 0, Math.floor(rand() * 7), 0]);
  },
  sheep(n, rand) {
    const area = (FIELD.right - FIELD.left) * (FIELD.bottom - FIELD.top);
    const base = clamp(Math.sqrt(((0.4 + 0.36 * busy(n)) * area) / (1.6 * n)), 22, 82);
    const depth = (y) => 0.5 + 0.5 * ((y - FIELD.top) / (FIELD.bottom - FIELD.top));
    const items = scatter(n, rand, () => base * (0.9 + rand() * 0.2), (next, s) => {
      // More sheep further back, where they look smaller.
      const y = FIELD.top + Math.pow(next(), 1.25) * (FIELD.bottom - FIELD.top);
      const scale = depth(y);
      return { x: FIELD.left + s * scale + next() * (FIELD.right - FIELD.left - 2 * s * scale), y, scale };
    }, { squash: 1.8 });
    // Now and then a black sheep.
    return items
      .sort((a, b) => a.y - b.y)
      .map((item) => [item.x, item.y, item.r, 0, rand() < 0.035 ? 3 : Math.floor(rand() * 3), rand() < 0.5 ? 1 : 0]);
  },
  fish(n, rand) {
    const area = (TANK.right - TANK.left) * (TANK.bottom - TANK.top);
    const base = clamp(Math.sqrt(((0.3 + 0.36 * busy(n)) * area) / (2.4 * n)), 15, 66);
    return scatter(n, rand, () => base * (0.8 + rand() * 0.4), (next, s) => ({
      x: TANK.left + s * 1.4 + next() * (TANK.right - TANK.left - 2.8 * s),
      y: TANK.top + s * 0.7 + next() * (TANK.bottom - TANK.top - 1.4 * s)
    }), { squash: 1.6 }).map((item) => [item.x, item.y, item.r, Math.round((rand() - 0.5) * 24), Math.floor(rand() * 6), rand() < 0.5 ? 1 : 0]);
  }
};

// Where every item of a scene goes (the same every time for the same scene).
const layoutCache = new Map();
export function layout(kind, n, seed) {
  const id = `${kind}:${n}:${seed}`;
  if (layoutCache.has(id)) return layoutCache.get(id);
  const place = LAYOUTS[kind] || LAYOUTS.dots;
  const items = place(n, random(seed ^ 0x5bd1e995), seed).map((item) => item.map((value) => Math.round(value)));
  layoutCache.set(id, items);
  if (layoutCache.size > 8) layoutCache.delete(layoutCache.keys().next().value);
  return items;
}

/* -------------------------------- Game ---------------------------------- */
function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  doc.days[day] = { scene: sceneFor(day), players: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const playerOf = (entry, author) => entry?.players?.[author] || null;
const guessOf = (entry, author) => (Number.isInteger(playerOf(entry, author)?.guess) ? playerOf(entry, author).guess : null);
const doneOf = (entry, author) => guessOf(entry, author) !== null;
const bonusOf = (off, n) => (off === 0 ? 2 : off <= n * CLOSE ? 1 : 0);

export function countResult(entry) {
  const her = guessOf(entry, "her");
  const sender = guessOf(entry, "sender");
  if (her === null || sender === null) return null;
  const n = entry.scene.n;
  const off = { her: Math.abs(her - n), sender: Math.abs(sender - n) };
  const winner = off.her === off.sender ? "tie" : off.her < off.sender ? "her" : "sender";
  return { n, off, winner, bonus: { her: bonusOf(off.her, n), sender: bonusOf(off.sender, n) } };
}

const kindInfo = (kind) => KINDS[kind] || KINDS.dots;
const sceneView = (scene) => ({ kind: scene.kind, seed: scene.seed, items: layout(scene.kind, scene.n, scene.seed) });

function dayView(entry, day, author, now) {
  const mine = playerOf(entry, author);
  const started = Boolean(mine?.startedAt);
  const done = doneOf(entry, author);
  const theirsDone = doneOf(entry, other(author));
  const leftMs = started && !done ? Math.max(0, SHOW_MS - (Date.parse(now) - Date.parse(mine.startedAt))) : null;
  const n = entry.scene.n;
  const { title, noun, question } = kindInfo(entry.scene.kind);
  return {
    day,
    kind: entry.scene.kind,
    title,
    noun,
    question,
    showMs: SHOW_MS,
    started,
    done,
    // Time left to look (a reload in the middle carries on); 0 once the picture is gone.
    showLeftMs: leftMs,
    // The drawing only while I'm looking and once I've guessed; how many only after my guess.
    scene: (started && !done && leftMs > 0) || done ? sceneView(entry.scene) : null,
    n: done ? n : null,
    mine: done ? { guess: mine.guess, off: Math.abs(mine.guess - n) } : null,
    theirs: done && theirsDone ? { guess: guessOf(entry, other(author)), off: Math.abs(guessOf(entry, other(author)) - n) } : null,
    theirsDone,
    result: done ? countResult(entry) : null
  };
}

// Wins and exact or close guesses. Today only counts once `viewer` guessed it.
export function countStats(doc, today, viewer) {
  const days = Object.keys(doc.days).filter((day) => day < today || (day === today && doneOf(doc.days[day], viewer))).sort();
  const wins = { her: 0, sender: 0 };
  const exact = { her: 0, sender: 0 };
  const close = { her: 0, sender: 0 };
  let daysPlayed = 0;
  for (const day of days) {
    const entry = doc.days[day];
    const result = countResult(entry);
    if (result) {
      daysPlayed += 1;
      if (result.winner !== "tie") wins[result.winner] += 1;
    }
    for (const author of AUTHORS) {
      const guess = guessOf(entry, author);
      if (guess === null) continue;
      const bonus = bonusOf(Math.abs(guess - entry.scene.n), entry.scene.n);
      if (bonus === 2) exact[author] += 1;
      if (bonus >= 1) close[author] += 1;
    }
  }
  return { daysPlayed, wins, exact, close };
}

function view(doc, day, author, today, now) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && doneOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => {
      const entry = doc.days[key];
      return { day: key, kind: entry.scene.kind, title: kindInfo(entry.scene.kind).title, n: entry.scene.n, guess: guessOf(entry, author), result: countResult(entry) };
    });
  return { ...dayView(doc.days[day], day, author, now), stats: countStats(doc, today, author), history };
}

function parseGuess(value) {
  const number = typeof value === "string" && value.trim() ? Number(value.trim()) : value;
  if (!Number.isInteger(number) || number < 0 || number > MAX_GUESS) throw new GameError(400, "Type how many you saw (a whole number).");
  return number;
}

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = parseDay(ctx.query("day"), ctx.today);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    if (day === ctx.today) {
      if (assignDay(doc, day, ctx.now)) await txn.put(KEY, doc);
    } else if (!doc.days[day]) {
      throw new GameError(404, "There was no picture to count that day.");
    }
    return view(doc, day, author, ctx.today, ctx.now);
  });
}

async function act(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here’s today’s picture.");
  const action = ctx.body.action;
  if (!["start", "guess"].includes(action)) throw new GameError(400, "Unknown action.");
  const guess = action === "guess" ? parseGuess(ctx.body.guess) : null;
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    const player = { ...(playerOf(entry, author) || {}) };
    if (Number.isInteger(player.guess)) throw new GameError(409, "You already guessed today’s picture.");
    if (action === "start") {
      // Starting again (a reload) keeps the first start: the 5 seconds don't begin again.
      if (!player.startedAt) player.startedAt = ctx.now;
    } else {
      if (!player.startedAt) throw new GameError(409, "Tap Start first.");
      Object.assign(player, { guess, doneAt: ctx.now });
    }
    entry.players = { ...(entry.players || {}), [author]: player };
    await txn.put(KEY, doc);
    let awarded = 0;
    if (action === "guess") {
      awarded += await award(txn, `count:${day}:play:${author}`, author, 1);
      const result = countResult(entry);
      if (result) {
        for (const person of AUTHORS) {
          const hearts = (result.winner === person ? 2 : result.winner === "tie" ? 1 : 0) + result.bonus[person];
          const delta = await award(txn, `count:${day}:score:${person}`, person, hearts);
          if (person === author) awarded += delta;
        }
      }
      awarded += await markActive(txn, author, ctx.today);
    }
    return { ...view(doc, day, author, ctx.today, ctx.now), awarded };
  });
}

export const routes = {
  "/games/count": async (ctx) => {
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
  let line = theirs ? "{them} played. Your turn" : kindInfo(entry?.scene?.kind || kindFor(ctx.today)).line;
  if (mine && theirs) {
    const result = countResult(entry);
    status = "done";
    line = result.winner === "tie" ? "A tie today" : `${result.winner === ctx.author ? "{me}" : "{them}"} won today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = countStats(doc, ctx.today, ctx.author);
  return {
    id: "count",
    title: "How many?",
    icon: "circle-dot",
    step: "count",
    status,
    line,
    board: [
      { label: "How many? wins", her: stats.wins.her, sender: stats.wins.sender },
      { label: "Exact guesses", her: stats.exact.her, sender: stats.exact.sender }
    ]
  };
}
