// Routes every /games/… request to the game module that owns it. Each module exports
// `routes` ({ "/games/x": async (ctx) => result }) and, for the games hub, `summary`.
// A handler returns a plain object (answered as 200 JSON) or throws a GameError.
import { GameError, ensureMigrated, zurichDay, weekStart } from "./common.js";
import * as hub from "./hub.js";
import * as match from "./match.js";
import * as duel from "./duel.js";
import * as speed from "./speed.js";
import * as price from "./price.js";
import * as odd from "./odd.js";
import * as hunt from "./hunt.js";
import * as guess from "./guess.js";
import * as wordle from "./wordle.js";
import * as doodle from "./doodle.js";
import * as icons from "./icons.js";
import * as challenges from "./challenges.js";
import * as shop from "./shop.js";

// In the order the games hub lists them.
export const GAME_MODULES = [match, duel, speed, price, odd, guess, wordle, doodle, icons, challenges, hunt, shop];
const ALL_MODULES = [hub, ...GAME_MODULES];
export const GAME_ROUTES = ALL_MODULES.flatMap((module) => Object.keys(module.routes || {}));

// Stores already checked for the one-time backfill (per Durable Object instance).
const migrated = new WeakSet();

export async function handleGame(storage, request, url) {
  const path = url.pathname.replace(/\/$/, "");
  const module = ALL_MODULES.find((item) => item.routes && Object.hasOwn(item.routes, path));
  if (!module) return { status: 404, body: { error: "Not found." } };
  if (!["GET", "POST"].includes(request.method)) return { status: 405, body: { error: "Method not allowed." } };

  let body = null;
  if (request.method === "POST") {
    try { body = await request.json(); } catch { return { status: 400, body: { error: "Invalid request body." } }; }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { status: 400, body: { error: "Invalid request body." } };
  }

  try {
    if (!migrated.has(storage)) {
      await storage.transaction((txn) => ensureMigrated(txn));
      migrated.add(storage);
    }
    const today = zurichDay();
    const result = await module.routes[path]({
      storage,
      method: request.method,
      url,
      query: (name) => url.searchParams.get(name) || "",
      body,
      today,
      week: weekStart(today),
      now: new Date().toISOString(),
      modules: GAME_MODULES
    });
    return { status: 200, body: result ?? {} };
  } catch (error) {
    if (error instanceof GameError) return { status: error.status, body: { error: error.message, ...error.extra } };
    console.error(error);
    return { status: 500, body: { error: "Something went wrong. Please try again." } };
  }
}
