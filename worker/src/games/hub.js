// Games hub: GET /games (streak, hearts, every game's summary, leaderboard, badges) and POST /games/nudge.
// Each game module's `summary(ctx)` feeds the hub's "Today" list, the leaderboard and the badges wall.
// One summary failing (or returning junk) only hides that game; it never breaks the hub.
import { GameError, parseAuthor, other, streakView, pointsView, awardTotals, recordNudge } from "./common.js";

const STATUSES = ["todo", "waiting", "done", "new", "idle"];
const SUMMARY_ID = /^[a-z0-9-]{1,40}$/;
const MAX_BOARD_ROWS = 6;
const MAX_BADGES = 500;

// The parts of a summary the hub can rely on; anything malformed is dropped or defaulted.
function tidySummary(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (typeof value.id !== "string" || !SUMMARY_ID.test(value.id)) return null;
  const board = Array.isArray(value.board)
    ? value.board.filter((row) => row && typeof row === "object" && typeof row.label === "string" && row.label).slice(0, MAX_BOARD_ROWS)
    : [];
  const badges = Array.isArray(value.badges)
    ? value.badges.filter((badge) => badge && typeof badge === "object" && typeof badge.name === "string" && badge.name)
    : [];
  return {
    ...value,
    title: typeof value.title === "string" && value.title ? value.title : value.id,
    step: typeof value.step === "string" && value.step ? value.step : value.id,
    status: STATUSES.includes(value.status) ? value.status : "idle",
    line: typeof value.line === "string" ? value.line : "",
    board,
    badges
  };
}

async function safeSummary(module, ctx) {
  if (typeof module?.summary !== "function") return null;
  try {
    return tidySummary(await module.summary(ctx));
  } catch (error) {
    console.error("Games hub: a game summary failed", error);
    return null;
  }
}

// Every summary's badges in one list, newest first, each badge once.
function collectBadges(games) {
  const seen = new Set();
  const badges = [];
  for (const game of games) {
    for (const badge of game.badges) {
      const key = typeof badge.id === "string" && badge.id ? `${game.id}:${badge.id}` : `${game.id}:${badge.name}:${badge.at || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      badges.push({ ...badge, game: game.id });
    }
  }
  badges.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  return badges.slice(0, MAX_BADGES);
}

async function hub(ctx) {
  if (ctx.method !== "GET") throw new GameError(405, "Method not allowed.");
  const author = parseAuthor(ctx.query("author"));
  // Streak and hearts from one consistent read; the games' summaries in parallel next to it.
  const [shared, summaries] = await Promise.all([
    ctx.storage.transaction(async (txn) => ({
      streak: await streakView(txn, ctx.today),
      points: await pointsView(txn),
      earned: await awardTotals(txn)
    })),
    Promise.all((ctx.modules || []).map((module) => safeSummary(module, { ...ctx, author })))
  ]);
  const games = summaries.filter(Boolean);
  return {
    today: ctx.today,
    week: ctx.week,
    streak: shared.streak,
    points: shared.points,
    games,
    badges: collectBadges(games),
    earned: shared.earned
  };
}

// "Don't break our streak!": once a day, only while the other one hasn't played yet.
async function nudge(ctx) {
  if (ctx.method !== "POST") throw new GameError(405, "Method not allowed.");
  const author = parseAuthor(ctx.body?.author);
  return ctx.storage.transaction(async (txn) => {
    const nudgedAt = await recordNudge(txn, author, ctx.today);
    return { nudgedAt, nudged: other(author), streak: await streakView(txn, ctx.today) };
  });
}

export const routes = {
  "/games": hub,
  "/games/nudge": nudge
};
