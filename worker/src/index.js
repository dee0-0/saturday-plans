import { GAME_ROUTES, handleGame } from "./games/router.js";
import { award, awardTotals, markActive } from "./games/common.js";

const ALLOWED_ORIGIN = "https://dee0-0.github.io";
const PLAN_KEY = "current-plan";
const HISTORY_KEY = "history";
const COUPONS_KEY = "coupons";
const SECRETS_KEY = "secrets";
const SECRET_ID = /^[a-z]{1,24}$/;
const MAX_SECRETS = 64;
const JOURNAL_KEY = "journal";
const MEDIA_KEY = "media";
const SNACKS_KEY = "snacks";
const MAX_TEXT_LENGTH = 400;
const MAX_COUPONS = 100;
const MAX_JOURNAL_ENTRIES = 200;
const MAX_HISTORY = 200;
const MAX_PHOTO_LENGTH = 700_000;
const MAX_MEDIA = 2000;
const MAX_OUTFITS = 30;
const MAX_COMMENTS = 100;
const MAX_SNACKS = 100;
const COUPON_ID = /^[a-z0-9-]{1,40}$/;
const ITEM_ID = /^[a-z0-9-]{1,64}$/;
const ENTRY_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const AUTHORS = ["her", "sender"];
const ROUTES = [
  "/plan", "/plan/late", "/plan/next", "/coupons", "/journal", "/journal/photo", "/secrets",
  "/media", "/media/file", "/media/thumb", "/outfits", "/snacks", "/reset",
  "/activity", "/push/key", "/push/subscribe", "/push/unsubscribe", "/push/test",
  "/movies", "/movies/search", "/ideas", "/question", "/question/custom",
  // The games (worker/src/games/): /games, /games/match, /games/wordle, …
  ...GAME_ROUTES
];
// <img> and <video> load these directly, without an Origin header, so they are public.
const PUBLIC_ROUTES = ["/media/file", "/media/thumb"];
const EXPOSED_HEADERS = "Content-Range, Accept-Ranges, Content-Length";
// Photos and videos are stored in 1 MiB pieces (a single stored value is capped at about 2 MB).
const CHUNK_SIZE = 1024 * 1024;
const MAX_THUMB_LENGTH = 300 * 1024;
// Uploads that never finished are dropped after a day.
const PENDING_MEDIA_TTL = 24 * 60 * 60 * 1000;
const MEDIA_SCOPES = ["journal", "outfit", "challenge"];
const MEDIA_KINDS = {
  photo: {
    types: ["image/jpeg", "image/png", "image/webp"],
    maxSize: 8 * CHUNK_SIZE,
    unsupported: "That photo type isn't supported.",
    tooBig: "That photo is too big."
  },
  video: {
    types: ["video/mp4", "video/quicktime", "video/webm", "video/x-m4v"],
    maxSize: 80 * CHUNK_SIZE,
    unsupported: "That video type isn't supported.",
    tooBig: "That video is too big. Try one under about a minute."
  }
};
const OUTFIT_ACTIONS = ["add", "rate", "comment", "uncomment", "favorite", "remove"];
const SNACK_ACTIONS = ["add", "toggle", "remove", "clearDone"];
const MOVIE_ACTIONS = ["add", "heart", "watched", "remove", "spin", "clearPick"];
const IDEA_ACTIONS = ["add", "remove", "use", "unuse"];
const QUESTION_ACTIONS = ["answer", "judge", "custom", "uncustom"];
const ACTIVITY_KEY = "activity";
const PUSH_KEY = "push";
const VAPID_KEY = "vapid";
const MOVIES_KEY = "movies";
const IDEAS_KEY = "ideas";
const QUESTIONS_KEY = "questions";
const MAX_ACTIVITY = 300;
const MAX_ACTIVITY_RESPONSE = 100;
const MAX_ACTIVITY_TEXT = 140;
const MAX_ACTIVITY_DETAIL = 200;
// Longer activity text (a long movie title or date plan) is cut to fit; past this it's refused.
const MAX_ACTIVITY_INPUT = 1000;
const MAX_PUSH_SUBSCRIPTIONS = 20;
const MAX_MOVIES = 150;
const MAX_IDEAS = 200;
const MAX_QUESTION_DAYS = 400;
const MAX_CUSTOM_QUESTIONS = 200;
const QUESTION_HISTORY = 60;
const FIRST_QUESTION_DAY = "2026-01-01";
// Pages of the letter an activity can open (the steps in app.js).
const STEPS = [
  "intro", "ask", "date", "time", "activity", "place", "note", "review", "planned", "coupons", "game",
  "journal", "next", "outfits", "snacks", "movies", "ideas", "question",
  "games", "match", "wordle", "doodle", "icons", "challenges", "shop", "duel",
  "speed", "price", "odd", "hunt", "connect", "sort", "first", "clock", "count", "pin"
];
const ACTIVITY_KIND = /^[a-z.]{1,40}$/;
const ICON_NAME = /^[a-z0-9-]{0,40}$/;
const BASE64URL = /^[A-Za-z0-9+/_-]+={0,2}$/;
const POSTER_PATH = /^\/[A-Za-z0-9._-]{1,100}$/;
// Web push (RFC 8030, 8291 and 8292). The VAPID subject tells push services who is sending.
const PUSH_SUBJECT = "https://dee0-0.github.io/saturday-plans/";
const PUSH_TTL = 86400;
const PUSH_RECORD_SIZE = 4096;
const PUSH_JWT_LIFETIME = 12 * 60 * 60;
const PUSH_REQUEST_TIMEOUT = 8000;
// Without background tasks, an activity waits at most this long for its notifications.
const PUSH_WAIT = 3000;
// Movie posters come from TMDB through the Worker, so the token stays a Worker secret.
const TMDB_SEARCH_URL = "https://api.themoviedb.org/3/search/movie";
const SEARCH_CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHED_SEARCHES = 200;
const SEARCH_TIMEOUT = 6000;
// ?store=preview uses a separate sandbox so the letter can be tested end to end
// without touching her real plan, coupons or journal. Only the sandbox can be reset.
const STORES = { live: "one-plan-for-this-invitation", preview: "preview-sandbox" };

// Local `wrangler dev` passes --var DEV_ORIGIN:http://localhost:5185 so the
// static site can be tested locally. Production only accepts GitHub Pages.
function isAllowedOrigin(origin, env) {
  return origin === ALLOWED_ORIGIN || (Boolean(env.DEV_ORIGIN) && origin === env.DEV_ORIGIN);
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : "null",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Range",
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

// Errors from the public media routes, readable from any page.
function publicJson(body, status, extraHeaders = {}) {
  const response = json(body, status, "");
  response.headers.set("Access-Control-Allow-Origin", "*");
  for (const [name, value] of Object.entries(extraHeaders)) response.headers.set(name, value);
  return response;
}

function mediaHeaders(mime, length) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": EXPOSED_HEADERS,
    "Content-Type": mime,
    "Content-Length": String(length),
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=31536000, immutable"
  };
}

function cleanText(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} is missing or too long.`);
  }
  return value.trim();
}

// Short single-line text (outfit titles, comments, snack names), with whitespace tidied.
function cleanLabel(value, maxLength, message, optional = false) {
  if (optional && (value === undefined || value === null)) return "";
  if (typeof value !== "string") throw new Error(message);
  const text = value.replace(/\s+/g, " ").trim();
  if ((!optional && !text) || text.length > maxLength) throw new Error(message);
  return text;
}

function itemId(value, message) {
  if (typeof value !== "string" || !ITEM_ID.test(value)) throw new Error(message);
  return value;
}

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function bernTimestamp(date, time) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  let timestamp = desired;
  let parts;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
    const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    timestamp += desired - represented;
  }
  parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
  if (Number(parts.year) !== year || Number(parts.month) !== month || Number(parts.day) !== day || Number(parts.hour) !== hour || Number(parts.minute) !== minute) {
    return NaN;
  }
  return timestamp;
}

// Bern time of a journal key ("YYYY-MM-DDTHH:MM"), NaN when it isn't a real date.
function keyTimestamp(key) {
  if (typeof key !== "string" || !ENTRY_KEY.test(key)) return NaN;
  const [date, time] = key.split("T");
  return isValidDate(date) ? bernTimestamp(date, time) : NaN;
}

function entryKey(plan) {
  return `${plan.date}T${plan.time}`;
}

function planStarted(plan) {
  return Boolean(plan) && plan.status === "confirmed" && keyTimestamp(entryKey(plan)) <= Date.now();
}

function planDetails(plan) {
  return { date: plan.date, time: plan.time, activity: plan.activity, place: plan.place, note: plan.note || "" };
}

// A date that already happened stays in the journal (with its photos, videos and outfit
// pick) whenever its plan gets replaced, rescheduled or cancelled.
async function archivePlan(txn, plan) {
  if (!planStarted(plan)) return;
  const key = entryKey(plan);
  const history = (await txn.get(HISTORY_KEY)) || [];
  if (history.some((item) => item.key === key)) return;
  history.push({ key, id: plan.id, ...planDetails(plan) });
  history.sort((a, b) => b.key.localeCompare(a.key));
  await txn.put(HISTORY_KEY, history.slice(0, MAX_HISTORY));
}

function normalizePlan(input, previous) {
  if (!input || typeof input !== "object") throw new Error("Plan details are required.");
  const date = cleanText(input.date, "Date");
  const time = cleanText(input.time, "Time");
  if (!isValidDate(date)) throw new Error("Choose a valid date.");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Choose a valid time.");
  const timestamp = bernTimestamp(date, time);
  if (!Number.isFinite(timestamp)) throw new Error("Choose a local Bern time that exists.");
  if (timestamp <= Date.now()) throw new Error("Choose a future date and time.");

  return {
    id: previous?.id || crypto.randomUUID(),
    status: "confirmed",
    date,
    time,
    timezone: "Europe/Zurich",
    activity: cleanText(input.activity, "Activity"),
    place: cleanText(input.place, "Meeting place"),
    note: cleanText(input.note, "Note", true),
    lateByMinutes: null,
    lateAt: null,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeCoupons(value) {
  return { redeemed: { ...(value?.redeemed || {}) }, unlocked: { ...(value?.unlocked || {}) } };
}

function normalizeReview(input) {
  if (!input || typeof input !== "object") throw new Error("Review details are required.");
  const key = input.key;
  if (typeof key !== "string" || !ENTRY_KEY.test(key)) throw new Error("Unknown date.");
  const date = cleanText(input.date, "Date");
  const time = cleanText(input.time, "Time");
  if (`${date}T${time}` !== key || !isValidDate(date)) throw new Error("Unknown date.");
  const timestamp = bernTimestamp(date, time);
  if (!Number.isFinite(timestamp)) throw new Error("Unknown date.");
  if (timestamp > Date.now()) throw new Error("You can rate the date once it has started.");
  if (!AUTHORS.includes(input.author)) throw new Error("Choose who is writing.");
  if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) throw new Error("Choose 1 to 5 hearts.");
  const photo = input.photo;
  if (photo !== undefined && photo !== null) {
    if (typeof photo !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) throw new Error("That photo couldn't be read.");
    if (photo.length > MAX_PHOTO_LENGTH) throw new Error("That photo is too large.");
  }
  return {
    key,
    date,
    time,
    activity: cleanText(input.activity, "Activity"),
    place: cleanText(input.place, "Meeting place"),
    author: input.author,
    stars: input.stars,
    // The "tapped past 5 hearts" easter egg: shown as ∞ / 5.
    overflow: input.overflow === true && input.stars === 5,
    note: cleanText(input.note, "Note", true),
    photo
  };
}

// ---------- Storage helpers (a single get/put/delete takes at most 128 keys) ----------

async function getMany(storage, keys) {
  const found = new Map();
  for (let index = 0; index < keys.length; index += 128) {
    for (const [key, value] of await storage.get(keys.slice(index, index + 128))) found.set(key, value);
  }
  return found;
}

async function deleteMany(storage, keys) {
  for (let index = 0; index < keys.length; index += 128) await storage.delete(keys.slice(index, index + 128));
}

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value);
}

function tooLargeError() {
  return Object.assign(new Error("Too large."), { tooLarge: true });
}

const byAt = (a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id));

// ---------- Journal ----------

// Every date we've had, newest first: archived plans, the current plan once it started,
// and any rated date (older reviews may not have an archived plan).
async function buildJournal(storage) {
  const stored = await storage.get([PLAN_KEY, HISTORY_KEY, JOURNAL_KEY, MEDIA_KEY]);
  const byKey = new Map();
  const merge = (key, fields) => {
    const entry = byKey.get(key) || { key, date: "", time: "", activity: "", place: "", note: "", current: false, reviews: {}, media: [], outfit: null };
    byKey.set(key, Object.assign(entry, fields));
  };
  for (const item of stored.get(JOURNAL_KEY) || []) {
    merge(item.key, { date: item.date, time: item.time, activity: item.activity, place: item.place, reviews: { ...item.reviews } });
  }
  for (const item of stored.get(HISTORY_KEY) || []) merge(item.key, planDetails(item));
  const plan = stored.get(PLAN_KEY);
  if (planStarted(plan)) merge(entryKey(plan), { ...planDetails(plan), current: true });

  for (const item of stored.get(MEDIA_KEY) || []) {
    if (item.status === "ready" && item.scope === "journal" && byKey.has(item.key)) byKey.get(item.key).media.push(item);
  }
  const outfitDocs = await getMany(storage, [...byKey.keys()].map(outfitsKey));
  const entries = [...byKey.values()].sort((a, b) => b.key.localeCompare(a.key));
  for (const entry of entries) {
    entry.media.sort(byAt);
    entry.outfit = favoriteOutfit(outfitDocs.get(outfitsKey(entry.key)));
  }
  return entries;
}

// ---------- Media ----------

const chunkKey = (id, index) => `media:chunk:${id}:${index}`;
const thumbKey = (id) => `media:thumb:${id}`;
const chunkKeys = (id, count) => Array.from({ length: count }, (_, index) => chunkKey(id, index));

function normalizeMedia(input) {
  if (!input || typeof input !== "object") throw new Error("Photo or video details are required.");
  const timestamp = keyTimestamp(input.key);
  if (!Number.isFinite(timestamp)) throw new Error("Unknown date.");
  if (!MEDIA_SCOPES.includes(input.scope)) throw new Error("Unknown album.");
  if (!Object.keys(MEDIA_KINDS).includes(input.kind)) throw new Error("Choose a photo or a video.");
  const kind = MEDIA_KINDS[input.kind];
  const mime = typeof input.mime === "string" ? input.mime.split(";")[0].trim().toLowerCase() : "";
  if (!kind.types.includes(mime)) throw new Error(kind.unsupported);
  if (typeof input.size !== "number" || !Number.isFinite(input.size) || input.size <= 0) throw new Error("That file is empty.");
  if (input.size > kind.maxSize) throw new Error(kind.tooBig);
  if (!AUTHORS.includes(input.author)) throw new Error("Choose who is adding this.");
  if (input.scope === "journal" && timestamp > Date.now()) throw new Error("You can add photos once the date has started.");
  const measure = (value, max, digits = 0) => (
    typeof value === "number" && Number.isFinite(value) && value > 0 && value <= max
      ? Math.round(value * 10 ** digits) / 10 ** digits
      : null
  );
  return {
    id: crypto.randomUUID(),
    key: input.key,
    scope: input.scope,
    kind: input.kind,
    mime,
    size: Math.round(input.size),
    author: input.author,
    width: measure(input.width, 20000),
    height: measure(input.height, 20000),
    duration: input.kind === "video" ? measure(input.duration, 24 * 60 * 60, 2) : null,
    status: "pending",
    hasThumb: false,
    at: new Date().toISOString()
  };
}

async function deleteMediaData(storage, item) {
  // A finished upload knows its chunk count; an unfinished one may have left any of them.
  const count = Number.isInteger(item.chunks) ? item.chunks : Math.ceil(MEDIA_KINDS[item.kind].maxSize / CHUNK_SIZE);
  await deleteMany(storage, [thumbKey(item.id), ...chunkKeys(item.id, count)]);
}

// Reads and discards the rest of an upload, so the phone receives our error
// response instead of a dropped connection.
async function drain(reader) {
  try {
    while (!(await reader.read()).done) { /* Discard. */ }
  } catch { /* The upload stopped anyway. */ }
}

// Reads a request body into memory, refusing anything over maxSize bytes.
async function readBody(body, maxSize) {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const bytes = toBytes(value);
    size += bytes.byteLength;
    if (size > maxSize) {
      await drain(reader);
      throw tooLargeError();
    }
    parts.push(bytes);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

// Streams an upload straight into 1 MiB storage chunks, so even a long video
// never sits in memory all at once. Cleans up after itself when it fails.
async function storeChunks(storage, id, body, maxSize) {
  const reader = body.getReader();
  let chunk = new Uint8Array(CHUNK_SIZE);
  let filled = 0;
  let size = 0;
  let count = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const bytes = toBytes(value);
      size += bytes.byteLength;
      if (size > maxSize) throw tooLargeError();
      let offset = 0;
      while (offset < bytes.byteLength) {
        const take = Math.min(CHUNK_SIZE - filled, bytes.byteLength - offset);
        chunk.set(bytes.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
        if (filled === CHUNK_SIZE) {
          await storage.put(chunkKey(id, count), chunk);
          count += 1;
          chunk = new Uint8Array(CHUNK_SIZE);
          filled = 0;
        }
      }
    }
    if (filled > 0) {
      await storage.put(chunkKey(id, count), chunk.slice(0, filled));
      count += 1;
    }
    return { size, chunks: count };
  } catch (error) {
    await drain(reader);
    await deleteMany(storage, chunkKeys(id, count + 1));
    throw error;
  }
}

// A single "bytes=a-b", "bytes=a-" or "bytes=-n" range. null: no range (send everything),
// false: a byte range we can't serve (416).
function parseRange(header, size) {
  if (!header || !/^\s*bytes=/i.test(header)) return null;
  const match = /^\s*bytes=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!match || (match[1] === "" && match[2] === "")) return false;
  let start;
  let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Number(match[2]);
    if (end < start) return false;
    end = Math.min(end, size - 1);
  }
  return start < size ? { start, end } : false;
}

// Streams bytes start..end (inclusive), loading one stored chunk at a time.
function chunkStream(storage, id, start, end) {
  let index = Math.floor(start / CHUNK_SIZE);
  const last = Math.floor(end / CHUNK_SIZE);
  const stream = new ReadableStream({
    async pull(controller) {
      const stored = await storage.get(chunkKey(id, index));
      if (!stored) {
        controller.error(new Error("A piece of this file is missing."));
        return;
      }
      const bytes = toBytes(stored);
      const base = index * CHUNK_SIZE;
      controller.enqueue(bytes.subarray(Math.max(start - base, 0), Math.min(end - base + 1, bytes.byteLength)));
      index += 1;
      if (index > last) controller.close();
    }
  }, { highWaterMark: 0 });
  // On Cloudflare a fixed-length stream sends a real Content-Length, which Safari wants for video.
  return typeof FixedLengthStream === "function" ? stream.pipeThrough(new FixedLengthStream(end - start + 1)) : stream;
}

// ---------- Outfits ----------

const outfitsKey = (key) => `outfits:${key}`;

function normalizeOutfits(value) {
  return {
    outfits: Array.isArray(value?.outfits) ? value.outfits : [],
    favorites: { ...(value?.favorites || {}) }
  };
}

function outfitState(value) {
  const { outfits, favorites } = normalizeOutfits(value);
  return { outfits: [...outfits].sort(byAt), favorites };
}

// Rescheduling an upcoming date keeps its outfit vote: outfits and their photos move to the new key.
async function moveOutfits(txn, fromKey, toKey) {
  const from = await txn.get(outfitsKey(fromKey));
  if (!from) return;
  const moved = normalizeOutfits(from);
  const target = normalizeOutfits(await txn.get(outfitsKey(toKey)));
  target.outfits.push(...moved.outfits.map((outfit) => ({ ...outfit, key: toKey })));
  target.favorites = { ...moved.favorites, ...target.favorites };
  await txn.put(outfitsKey(toKey), target);
  await txn.delete(outfitsKey(fromKey));
  const media = (await txn.get(MEDIA_KEY)) || [];
  let changed = false;
  for (const item of media) {
    if (item.scope === "outfit" && item.key === fromKey) { item.key = toKey; changed = true; }
  }
  if (changed) await txn.put(MEDIA_KEY, media);
}

async function saveOutfits(storage, key, doc) {
  if (doc.outfits.length || Object.keys(doc.favorites).length) await storage.put(outfitsKey(key), doc);
  else await storage.delete(outfitsKey(key));
}

// Her pick wins, then Dee's.
function favoriteOutfit(value) {
  if (!value) return null;
  const { outfits, favorites } = normalizeOutfits(value);
  const pick = AUTHORS.map((who) => outfits.find((outfit) => outfit.id === favorites[who])).find(Boolean);
  return pick ? { id: pick.id, title: pick.title, mediaId: pick.mediaId, author: pick.author } : null;
}

// Drops the outfits that show a deleted photo (and any picks pointing at them).
async function removeOutfitsUsing(storage, key, mediaId) {
  const doc = normalizeOutfits(await storage.get(outfitsKey(key)));
  const removed = doc.outfits.filter((outfit) => outfit.mediaId === mediaId).map((outfit) => outfit.id);
  if (!removed.length) return;
  doc.outfits = doc.outfits.filter((outfit) => !removed.includes(outfit.id));
  for (const who of AUTHORS) if (removed.includes(doc.favorites[who])) delete doc.favorites[who];
  await saveOutfits(storage, key, doc);
}

function normalizeOutfitAction(input) {
  if (!input || typeof input !== "object") throw new Error("Outfit details are required.");
  const { action, key, author } = input;
  if (!OUTFIT_ACTIONS.includes(action)) throw new Error("Unknown outfit action.");
  if (typeof key !== "string" || !ENTRY_KEY.test(key)) throw new Error("Unknown date.");
  if (!AUTHORS.includes(author)) throw new Error("Choose who is writing.");
  const change = { action, key, author };
  if (action === "add") {
    change.title = cleanLabel(input.title, 60, "Keep the outfit title under 60 characters.", true);
    change.mediaId = itemId(input.mediaId, "Choose a photo for the outfit.");
    return change;
  }
  if (action === "favorite") {
    change.id = input.id === null || input.id === undefined ? null : itemId(input.id, "That outfit is gone.");
    return change;
  }
  change.id = itemId(input.id, "That outfit is gone.");
  if (action === "rate") {
    if (!Number.isInteger(input.stars) || input.stars < 1 || input.stars > 5) throw new Error("Choose 1 to 5 hearts.");
    change.stars = input.stars;
  }
  if (action === "comment") change.text = cleanLabel(input.text, 300, "Write a comment (up to 300 characters).");
  if (action === "uncomment") change.commentId = itemId(input.commentId, "That comment is gone.");
  return change;
}

// Runs inside a transaction. Removing something that is already gone is a quiet no-op.
async function applyOutfitAction(txn, change) {
  const { action, key, author } = change;
  const doc = normalizeOutfits(await txn.get(outfitsKey(key)));
  const fail = (status, error) => ({ status, error, doc });
  const outfit = change.id ? doc.outfits.find((item) => item.id === change.id) : null;
  const now = new Date().toISOString();

  if (action === "add") {
    if (doc.outfits.some((item) => item.mediaId === change.mediaId)) return { doc };
    if (doc.outfits.length >= MAX_OUTFITS) return fail(400, `There are already ${MAX_OUTFITS} outfits for this date.`);
    const media = ((await txn.get(MEDIA_KEY)) || []).find((item) => item.id === change.mediaId);
    if (!media || media.status !== "ready" || media.scope !== "outfit" || media.key !== key) {
      return fail(400, "That photo isn't ready yet. Please try again.");
    }
    doc.outfits.push({ id: crypto.randomUUID(), key, author, title: change.title, mediaId: change.mediaId, at: now, ratings: {}, comments: [] });
  } else if (action === "favorite") {
    if (change.id === null) delete doc.favorites[author];
    else if (!outfit) return fail(404, "That outfit is gone.");
    else doc.favorites[author] = outfit.id;
  } else if (!outfit) {
    return action === "remove" || action === "uncomment" ? { doc } : fail(404, "That outfit is gone.");
  } else if (action === "rate") {
    outfit.ratings = { ...outfit.ratings, [author]: change.stars };
  } else if (action === "comment") {
    if (outfit.comments.length >= MAX_COMMENTS) return fail(400, "There are too many comments on this outfit.");
    outfit.comments.push({ id: crypto.randomUUID(), author, text: change.text, at: now });
  } else if (action === "uncomment") {
    const comment = outfit.comments.find((item) => item.id === change.commentId);
    if (!comment) return { doc };
    if (comment.author !== author) return fail(403, "You can only delete your own comments.");
    outfit.comments = outfit.comments.filter((item) => item !== comment);
  } else if (action === "remove") {
    if (outfit.author !== author) return fail(403, "You can only remove your own outfits.");
    doc.outfits = doc.outfits.filter((item) => item !== outfit);
    for (const who of AUTHORS) if (doc.favorites[who] === outfit.id) delete doc.favorites[who];
    const list = (await txn.get(MEDIA_KEY)) || [];
    const media = list.find((item) => item.id === outfit.mediaId);
    if (media) {
      await txn.put(MEDIA_KEY, list.filter((item) => item !== media));
      await deleteMediaData(txn, media);
    }
  }
  await saveOutfits(txn, key, doc);
  return { doc };
}

// ---------- Snacks ----------

// Open snacks first (oldest first), then the ones we already got.
function sortSnacks(snacks) {
  const open = snacks.filter((snack) => !snack.done).sort(byAt);
  const done = snacks.filter((snack) => snack.done).sort((a, b) => String(a.doneAt).localeCompare(String(b.doneAt)));
  return [...open, ...done];
}

function normalizeSnackAction(input) {
  if (!input || typeof input !== "object" || !SNACK_ACTIONS.includes(input.action)) throw new Error("Unknown snack action.");
  const change = { action: input.action };
  if (change.action === "add") change.name = cleanLabel(input.name, 60, "Write a snack name (up to 60 characters).");
  if (["add", "toggle"].includes(change.action)) {
    if (!AUTHORS.includes(input.author)) throw new Error("Choose who is writing.");
    change.author = input.author;
  }
  if (["toggle", "remove"].includes(change.action)) change.id = itemId(input.id, "That snack is gone.");
  if (change.action === "toggle" && typeof input.done === "boolean") change.done = input.done;
  return change;
}

function applySnackAction(snacks, change) {
  const now = new Date().toISOString();
  if (change.action === "add") {
    const name = change.name.toLowerCase();
    if (snacks.some((snack) => !snack.done && snack.name.toLowerCase() === name)) return { snacks };
    if (snacks.length >= MAX_SNACKS) return { status: 400, error: "The snack list is full. Clear the ones you got first.", snacks };
    snacks.push({ id: crypto.randomUUID(), name: change.name, author: change.author, done: false, doneBy: null, at: now, doneAt: null });
    return { snacks, changed: true };
  }
  if (change.action === "toggle") {
    const snack = snacks.find((item) => item.id === change.id);
    if (!snack) return { status: 404, error: "That snack is gone.", snacks };
    // The phone sends the state it wants ("done" true/false), so both ticking the same snack keeps it ticked.
    const done = typeof change.done === "boolean" ? change.done : !snack.done;
    if (done === snack.done) return { snacks };
    Object.assign(snack, done ? { done: true, doneBy: change.author, doneAt: now } : { done: false, doneBy: null, doneAt: null });
    return { snacks, changed: true };
  }
  const kept = snacks.filter((snack) => (change.action === "remove" ? snack.id !== change.id : !snack.done));
  return { snacks: kept, changed: kept.length !== snacks.length };
}

// ---------- Small shared helpers ----------

const encoder = new TextEncoder();

function concatBytes(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function toBase64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// null when the text isn't base64url (plain base64 is read too).
function fromBase64url(text) {
  if (typeof text !== "string" || !BASE64URL.test(text)) return null;
  const base64 = text.replace(/=+$/, "").replace(/-/g, "+").replace(/_/g, "/");
  try {
    return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

// A uniformly random index below count (no modulo bias).
function randomIndex(count) {
  const limit = Math.floor(0x100000000 / count) * count;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value); while (value[0] >= limit);
  return value[0] % count;
}

function timeoutSignal(ms) {
  return typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(ms) : undefined;
}

// Tidies whitespace and cuts long text with an ellipsis, at a word when one ends close to the limit.
function shorten(text, maxLength) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxLength) return clean;
  // Never split an emoji (or any other two-part character) in half.
  const cut = clean.slice(0, maxLength - 1).replace(/[\uD800-\uDBFF]$/, "");
  const atWord = cut.replace(/\s+\S*$/, "");
  return `${atWord.length >= cut.length - 24 ? atWord : cut.trimEnd()}…`;
}

// ---------- Activity and phone notifications ----------

const TEST_PUSH = { title: "Notifications are on", body: "You'll hear from each other here.", step: "planned", tag: "test" };

function normalizeActivity(input) {
  if (!input || typeof input !== "object") throw new Error("Activity details are required.");
  if (!AUTHORS.includes(input.author)) throw new Error("Choose who did this.");
  if (typeof input.kind !== "string" || !ACTIVITY_KIND.test(input.kind)) throw new Error("Unknown kind of activity.");
  const step = input.step === undefined || input.step === null ? "" : input.step;
  if (step !== "" && !STEPS.includes(step)) throw new Error("Unknown page.");
  const icon = input.icon === undefined || input.icon === null ? "" : input.icon;
  if (typeof icon !== "string" || !ICON_NAME.test(icon)) throw new Error("Unknown icon.");
  if (input.push !== undefined && input.push !== null && typeof input.push !== "boolean") throw new Error("Choose whether to send a notification.");
  return {
    item: {
      id: crypto.randomUUID(),
      author: input.author,
      name: cleanLabel(input.name, 60, "Write a name (up to 60 characters)."),
      kind: input.kind,
      text: shorten(cleanLabel(input.text, MAX_ACTIVITY_INPUT, "Describe what happened."), MAX_ACTIVITY_TEXT),
      detail: shorten(cleanLabel(input.detail, MAX_ACTIVITY_INPUT, "That detail is too long.", true), MAX_ACTIVITY_DETAIL),
      step,
      icon,
      at: new Date().toISOString()
    },
    push: input.push !== false
  };
}

function activityPush(item) {
  return { title: `${item.name} ${item.text}`, body: item.detail || "", step: item.step, tag: item.kind };
}

function pushEndpoint(value) {
  const message = "That notification address isn't valid.";
  if (typeof value !== "string" || value.length > 600) throw new Error(message);
  let url;
  try { url = new URL(value); } catch { throw new Error(message); }
  if (url.protocol !== "https:" || url.username || url.password) throw new Error(message);
  return value;
}

async function normalizeSubscription(input) {
  if (!input || typeof input !== "object") throw new Error("Notification details are required.");
  if (!AUTHORS.includes(input.author)) throw new Error("Choose whose phone this is.");
  const subscription = input.subscription;
  if (!subscription || typeof subscription !== "object") throw new Error("Notification details are required.");
  const endpoint = pushEndpoint(subscription.endpoint);
  const keys = subscription.keys && typeof subscription.keys === "object" ? subscription.keys : {};
  const p256dh = fromBase64url(keys.p256dh);
  const auth = fromBase64url(keys.auth);
  const invalid = "This phone's notification keys aren't valid.";
  if (!p256dh || p256dh.byteLength !== 65 || p256dh[0] !== 4 || !auth || auth.byteLength !== 16) throw new Error(invalid);
  // The phone's key has to be a real P-256 point, or nothing could ever be encrypted for it.
  try {
    await crypto.subtle.importKey("raw", p256dh, { name: "ECDH", namedCurve: "P-256" }, false, []);
  } catch {
    throw new Error(invalid);
  }
  return { endpoint, p256dh: toBase64url(p256dh), auth: toBase64url(auth), author: input.author, at: new Date().toISOString() };
}

async function hkdf(salt, ikm, info, length) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

// RFC 8291 "aes128gcm": a fresh ECDH key per message, mixed with the phone's auth secret,
// encrypting a single record that ends with the 0x02 padding delimiter.
async function encryptPush(text, subscription) {
  const uaPublic = fromBase64url(subscription.p256dh);
  const authSecret = fromBase64url(subscription.auth);
  const plaintext = concatBytes(encoder.encode(text), new Uint8Array([2]));
  if (plaintext.byteLength + 16 > PUSH_RECORD_SIZE) throw new Error("The notification is too long.");
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const local = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", local.publicKey));
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, local.privateKey, 256));
  const keyInfo = concatBytes(encoder.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, concatBytes(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(salt, ikm, concatBytes(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, plaintext));
  // Header: salt, record size, key id length, then our public key as the key id.
  const header = new Uint8Array(16 + 4 + 1 + asPublic.byteLength);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, PUSH_RECORD_SIZE);
  header[20] = asPublic.byteLength;
  header.set(asPublic, 21);
  return concatBytes(header, ciphertext);
}

// RFC 8292 VAPID: a short-lived ES256 JWT for the push service's origin. WebCrypto ECDSA
// signatures are already the raw r||s form that JWTs use.
async function vapidToken(privateKey, audience) {
  const part = (value) => toBase64url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud: audience, exp: Math.floor(Date.now() / 1000) + PUSH_JWT_LIFETIME, sub: PUSH_SUBJECT })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, encoder.encode(unsigned));
  return `${unsigned}.${toBase64url(new Uint8Array(signature))}`;
}

// Sends one notification: "sent", "gone" (the phone unsubscribed: 404 or 410) or "failed".
async function sendPush(subscription, payload, vapid) {
  try {
    const body = await encryptPush(JSON.stringify(payload), subscription);
    const token = await vapidToken(vapid.privateKey, new URL(subscription.endpoint).origin);
    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        TTL: String(PUSH_TTL),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        Urgency: "normal",
        Authorization: `vapid t=${token}, k=${vapid.publicKey}`
      },
      body,
      signal: timeoutSignal(PUSH_REQUEST_TIMEOUT)
    });
    try { await response.arrayBuffer(); } catch { /* Only the status matters. */ }
    if (response.ok) return "sent";
    return [404, 410].includes(response.status) ? "gone" : "failed";
  } catch {
    return "failed";
  }
}

// ---------- Movies ----------

function normalizeMovies(value) {
  return { movies: Array.isArray(value?.movies) ? value.movies : [], pick: value?.pick || null };
}

// Movies we haven't watched yet first (oldest first), then the watched ones, latest first.
function movieState(value) {
  const { movies, pick } = normalizeMovies(value);
  const open = movies.filter((movie) => !movie.watched).sort(byAt);
  const watched = movies.filter((movie) => movie.watched).sort((a, b) => String(b.watchedAt).localeCompare(String(a.watchedAt)));
  return { movies: [...open, ...watched], pick: pick && movies.some((movie) => movie.id === pick.id) ? pick : null };
}

function movieYear(value) {
  if (value === undefined || value === null || value === "") return "";
  const year = typeof value === "number" ? String(value) : value;
  if (typeof year !== "string" || !/^\d{4}$/.test(year.trim())) throw new Error("Choose a valid year.");
  return year.trim();
}

function normalizeMovieAction(input) {
  if (!input || typeof input !== "object" || !MOVIE_ACTIONS.includes(input.action)) throw new Error("Unknown movie action.");
  const change = { action: input.action };
  if (["add", "heart", "watched", "spin"].includes(change.action)) {
    if (!AUTHORS.includes(input.author)) throw new Error("Choose who is choosing.");
    change.author = input.author;
  }
  if (change.action === "add") {
    change.title = cleanLabel(input.title, 120, "Write a movie title (up to 120 characters).");
    change.year = movieYear(input.year);
    if (input.tmdbId === undefined || input.tmdbId === null) change.tmdbId = null;
    else if (Number.isSafeInteger(input.tmdbId) && input.tmdbId > 0) change.tmdbId = input.tmdbId;
    else throw new Error("Unknown movie.");
    const poster = input.poster === undefined || input.poster === null ? "" : input.poster;
    if (typeof poster !== "string" || (poster !== "" && !POSTER_PATH.test(poster))) throw new Error("That poster isn't valid.");
    change.poster = poster;
    if (input.overview !== undefined && input.overview !== null && typeof input.overview !== "string") throw new Error("That summary isn't valid.");
    // TMDB summaries can run long: keep the first 400 characters.
    change.overview = shorten(input.overview || "", 400);
  }
  if (["heart", "watched", "remove"].includes(change.action)) change.id = itemId(input.id, "That movie is gone.");
  if (change.action === "heart") {
    if (typeof input.on !== "boolean") throw new Error("Choose heart or no heart.");
    change.on = input.on;
  }
  if (change.action === "watched") {
    if (typeof input.watched !== "boolean") throw new Error("Choose watched or not.");
    change.watched = input.watched;
  }
  if (change.action === "spin") {
    if (!["all", "both"].includes(input.mode)) throw new Error("Choose which movies to spin.");
    change.mode = input.mode;
  }
  return change;
}

// Changes doc ({ movies, pick }) in place. Removing a movie that is already gone is a quiet no-op.
function applyMovieAction(doc, change) {
  const now = new Date().toISOString();
  const movie = change.id ? doc.movies.find((item) => item.id === change.id) : null;
  if (change.action === "add") {
    const title = change.title.toLowerCase();
    const existing = doc.movies.find((item) => (
      (change.tmdbId !== null && item.tmdbId === change.tmdbId) || (String(item.title).toLowerCase() === title && item.year === change.year)
    ));
    if (existing) return { duplicate: existing.id };
    if (doc.movies.length >= MAX_MOVIES) return { status: 400, error: "The movie list is full. Remove a few first." };
    const { title: cleanTitle, year, tmdbId, poster, overview, author } = change;
    doc.movies.push({ id: crypto.randomUUID(), title: cleanTitle, year, tmdbId, poster, overview, author, at: now, hearts: {}, watched: false, watchedAt: null });
    return { changed: true };
  }
  if (change.action === "spin") {
    // The server spins, so both phones land on the same movie.
    const candidates = doc.movies.filter((item) => !item.watched && (change.mode === "all" || (item.hearts?.her && item.hearts?.sender)));
    if (!candidates.length) {
      return change.mode === "both"
        ? { status: 400, error: "There's no movie you both hearted yet. Heart a few first." }
        : { status: 400, error: "Add a movie you haven't watched yet first." };
    }
    doc.pick = { id: candidates[randomIndex(candidates.length)].id, by: change.author, at: now };
    return { changed: true, candidates: candidates.map((item) => item.id) };
  }
  if (change.action === "clearPick") {
    if (!doc.pick) return {};
    doc.pick = null;
    return { changed: true };
  }
  if (change.action === "remove") {
    if (!movie) return {};
    doc.movies = doc.movies.filter((item) => item !== movie);
    if (doc.pick?.id === movie.id) doc.pick = null;
    return { changed: true };
  }
  if (!movie) return { status: 404, error: "That movie is gone." };
  if (change.action === "heart") {
    const hearts = { ...movie.hearts };
    if (change.on) hearts[change.author] = true;
    else delete hearts[change.author];
    movie.hearts = hearts;
    return { changed: true };
  }
  if (Boolean(movie.watched) === change.watched) return {};
  Object.assign(movie, change.watched
    ? { watched: true, watchedAt: now, watchedBy: change.author }
    : { watched: false, watchedAt: null, watchedBy: null });
  // Tonight's pick is done once we've watched it.
  if (change.watched && doc.pick?.id === movie.id) doc.pick = null;
  return { changed: true };
}

// ---------- Movie search (TMDB posters) ----------

// Recent searches per query, kept in memory for a few minutes.
const searchCache = new Map();

function tmdbMovie(result) {
  if (!result || typeof result !== "object" || !Number.isSafeInteger(result.id) || result.id <= 0) return null;
  const title = typeof result.title === "string" ? shorten(result.title, 120) : "";
  if (!title) return null;
  const released = typeof result.release_date === "string" ? result.release_date : "";
  return {
    tmdbId: result.id,
    title,
    year: /^\d{4}/.test(released) ? released.slice(0, 4) : "",
    poster: typeof result.poster_path === "string" && POSTER_PATH.test(result.poster_path) ? result.poster_path : "",
    overview: typeof result.overview === "string" ? shorten(result.overview, 400) : ""
  };
}

async function searchMovies(url, env, origin) {
  const query = (url.searchParams.get("q") || "").replace(/\s+/g, " ").trim();
  if (!query || query.length > 80) return json({ error: "Type a movie title (up to 80 characters)." }, 400, origin);
  const token = typeof env.TMDB_TOKEN === "string" ? env.TMDB_TOKEN.trim() : "";
  if (!token) return json({ error: "Movie posters aren't set up yet.", postersOff: true }, 503, origin);

  const cacheKey = query.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.at < SEARCH_CACHE_TTL) return json({ results: cached.results }, 200, origin);

  const search = new URL(TMDB_SEARCH_URL);
  search.search = new URLSearchParams({ query, include_adult: "false", language: "en-US", page: "1" }).toString();
  const headers = { Accept: "application/json" };
  // A v4 read access token is a JWT; anything else is a v3 API key.
  if (token.startsWith("eyJ")) headers.Authorization = `Bearer ${token}`;
  else search.searchParams.set("api_key", token);
  let data;
  try {
    const response = await fetch(search.toString(), { headers, signal: timeoutSignal(SEARCH_TIMEOUT) });
    if (!response.ok) throw new Error(`TMDB answered ${response.status}.`);
    data = await response.json();
  } catch {
    return json({ error: "Movie search isn't working right now. Type the title instead." }, 502, origin);
  }
  const results = (Array.isArray(data?.results) ? data.results : []).map(tmdbMovie).filter(Boolean).slice(0, 8);
  searchCache.delete(cacheKey);
  searchCache.set(cacheKey, { at: Date.now(), results });
  while (searchCache.size > MAX_CACHED_SEARCHES) searchCache.delete(searchCache.keys().next().value);
  return json({ results }, 200, origin);
}

// ---------- Ideas jar ----------

// Ideas we haven't used yet first (oldest first), then the used ones, latest first.
function sortIdeas(ideas) {
  const open = ideas.filter((idea) => !idea.usedAt).sort(byAt);
  const used = ideas.filter((idea) => idea.usedAt).sort((a, b) => String(b.usedAt).localeCompare(String(a.usedAt)));
  return [...open, ...used];
}

// The next plan and its selected idea commit together. Old clients can omit this.
async function consumePlanIdea(txn, input, plan) {
  if (input.jarIdea === undefined || input.jarIdea === null) return null;
  const selected = input.jarIdea;
  if (!selected || typeof selected !== "object") throw new Error("Choose an idea from the jar again.");
  const id = itemId(selected.id, "That idea is gone. Pull another idea from the jar.");
  if (!AUTHORS.includes(selected.author)) throw new Error("Choose who is planning.");
  const same = (text) => String(text || "").trim().replace(/\s+/g, " ").toLowerCase();
  const text = cleanLabel(selected.text, 120, "Choose an idea from the jar again.");
  const activity = cleanText(selected.activity, "Activity");
  if (same(activity) !== same(plan.activity)) throw new Error("The activity changed. Choose an idea from the jar again.");
  const ideas = (await txn.get(IDEAS_KEY)) || [];
  const idea = ideas.find((item) => item.id === id);
  if (!idea || idea.usedAt || same(idea.text) !== same(text)) {
    throw new Error("That idea has changed or was already used. Pull another idea from the jar.");
  }
  Object.assign(idea, { usedAt: plan.createdAt, usedBy: selected.author, usedForPlan: plan.id });
  await txn.put(IDEAS_KEY, ideas);
  return id;
}

function normalizeIdeaAction(input) {
  if (!input || typeof input !== "object" || !IDEA_ACTIONS.includes(input.action)) throw new Error("Unknown idea action.");
  const change = { action: input.action };
  if (["add", "use"].includes(change.action)) {
    if (!AUTHORS.includes(input.author)) throw new Error("Choose who is writing.");
    change.author = input.author;
  }
  if (change.action === "add") change.text = cleanLabel(input.text, 120, "Write an idea (up to 120 characters).");
  else change.id = itemId(input.id, "That idea is gone.");
  return change;
}

function applyIdeaAction(ideas, change) {
  const now = new Date().toISOString();
  if (change.action === "add") {
    const text = change.text.toLowerCase();
    const existing = ideas.find((idea) => !idea.usedAt && String(idea.text).toLowerCase() === text);
    if (existing) return { ideas, duplicate: existing.id };
    if (ideas.length >= MAX_IDEAS) return { status: 400, error: "The jar is full. Take a few ideas out first.", ideas };
    ideas.push({ id: crypto.randomUUID(), text: change.text, author: change.author, at: now, usedAt: null, usedBy: null });
    return { ideas, changed: true };
  }
  const idea = ideas.find((item) => item.id === change.id);
  if (change.action === "remove") return idea ? { ideas: ideas.filter((item) => item !== idea), changed: true } : { ideas };
  if (!idea) return { status: 404, error: "That idea is gone.", ideas };
  if (change.action === "use") {
    if (idea.usedAt) return { ideas };
    Object.assign(idea, { usedAt: now, usedBy: change.author });
  } else {
    if (!idea.usedAt) return { ideas };
    Object.assign(idea, { usedAt: null, usedBy: null });
  }
  return { ideas, changed: true };
}

// ---------- Daily question ----------

// A fixed, mixed order: playful, nostalgic, dreamy and deep questions take turns.
const BUILTIN_QUESTIONS = [
  "What was your very first impression of me, honestly?",
  "If we had a whole free day with no plans at all, how would you want to spend it with me?",
  "What is your favorite memory from a summer when you were a kid?",
  "Where in the world would you love to wake up with me one day?",
  "What makes you feel truly cared for?",
  "Mountains or the sea for a weekend away, and why?",
  "When did you first feel like a grown-up?",
  "What would you love to celebrate together one day?",
  "What are you grateful for this week?",
  "What would your perfect pizza have on it?",
  "What was the first song or album you were completely obsessed with?",
  "What do you hope your life looks like five years from now?",
  "What is a lesson you learned the hard way?",
  "What is your go-to karaoke song, or the one you would secretly love to sing?",
  "If you could relive one day of your life, which would it be?",
  "If you wrote a book, what would it be about?",
  "How do you like to be comforted when you are sad?",
  "If you had to describe me as a dessert, which one would I be?",
  "What did your bedroom look like when you were a teenager?",
  "What is an adventure you would love for us to have together?",
  "Who has shaped who you are the most?",
  "What is a small thing that instantly puts you in a good mood?",
  "What was your favorite cartoon or TV show growing up?",
  "What would you do with a whole month off?",
  "What is a quality you admire in other people?",
  "What is the silliest thing that ever made you laugh until you cried?",
  "What is the funniest thing that happened to you at school?",
  "If money were no object, how would you spend a year?",
  "What have you been curious about lately?",
  "Which board game or card game brings out your competitive side?",
  "What toy or object did you take everywhere as a kid?",
  "What is something you want to learn in the next few years?",
  "Is there something you have always wanted to ask me?",
  "What is a guilty pleasure you are not even a little sorry about?",
  "What is a childhood snack you still crave?",
  "What is a place you have only seen in photos and keep dreaming about?",
  "What is something new you would like to try, even if it makes you a little nervous?",
  "What is the best thing you have ever found by accident?",
  "What were you scared of as a child that seems funny now?",
  "If you could live in any decade, which one would you choose?",
  "When was the last time you felt really at peace?",
  "Sweet or savory breakfast, and what exactly is on the plate?",
  "Who was your best friend in school, and what did you two get up to?",
  "Which city would you like to live in for a few months?",
  "What kind of person do you want to be for the people you love?",
  "Which movie can you watch again and again without getting bored?",
  "What is a family tradition you would love to keep someday?",
  "What would you plant if you had a garden with all the space in the world?",
  "What is a compliment that stuck with you?",
  "If you could instantly master one skill, what would you pick?",
  "What is a holiday memory that still makes you smile?",
  "If you could have dinner with anyone, living or not, who would it be?",
  "What is your favorite way to show love without words?",
  "What is the most useless talent you have?",
  "What is the best trip you have ever taken?",
  "What would your perfect rainy day look like?",
  "What makes a place feel like home to you?",
  "Which fictional world would you most like to live in for a week?",
  "Which song takes you straight back to being a teenager?",
  "What would you cook for me if you wanted to impress me?",
  "What is the best advice anyone has ever given you?",
  "What would your superhero name be, and what would your power be?",
  "When did you first notice you liked me?",
  "What tradition would you like the two of us to start?",
  "What is a value you never want to compromise on?",
  "What is the strangest food you have ever tried?",
  "Which smell instantly takes you back to your childhood?",
  "What is a skill you would love for us to learn together?",
  "What is something about us that you never want to change?",
  "If we opened a tiny cafe together, what would be on the menu?",
  "What is a place from your past you would love to show me?",
  "What does a cozy evening at home with me look like to you?",
  "What would your friends say is your best quality?",
  "If you could have any animal as a pet, no matter how impractical, what would it be?",
  "What was the first thing you ever bought with your own money?",
  "What would your perfect date with me look like, from morning to night?",
  "What is a moment when you felt really brave?",
  "If you could swap lives with anyone for a day, who would it be?",
  "What was a rule at home growing up that you thought was unfair?",
  "What is one thing on your bucket list that would surprise people?",
  "What is a kindness from a stranger you still remember?",
  "If our story were a movie, who would play us?",
  "Which teacher made a real difference in your life?",
  "If we could spend a week anywhere in Switzerland, where would you pick?",
  "When do you feel most like yourself?",
  "Which snack would you bring to a desert island?",
  "What is the best birthday you have ever had?",
  "What is a small dream you have never told anyone?",
  "How do you recharge after a long week?",
  "If you had a free plane ticket for tomorrow, where would you go?",
  "What did you want to be when you grew up, back when you were seven?",
  "What does your dream home look like, room by room?",
  "What is something you are looking forward to right now?",
  "What is a word or phrase you catch yourself saying all the time?",
  "What is a moment from our dates so far that you keep thinking about?",
  "Where would we go if we could take a road trip anywhere?",
  "What made you smile today?",
  "What would we name our boat if we had one?",
  "What is a concert or event you would love to go to together?",
  "What is one small thing I do that makes you happy?",
  "What is a food you could happily eat every single day?",
  "What is something you changed your mind about in the last few years?",
  "Which song would you pick as the theme song for the two of us?",
  "What is one thing you would like us to do more often?",
  "Which season suits you best, and what do you love about it?",
  "What is something you would like me to understand about you better?",
  "What is the most spontaneous thing you have ever done?",
  "What is something you are proud of that you rarely talk about?",
  "What would you tell your younger self if you could?",
  "What is a book, film or song that changed how you see things?",
  "What is one thing you wish more people knew about you?",
  "What is a fear you would like to grow out of?",
  "What does a good relationship mean to you?",
  "What does a really good day look like for you, from start to finish?",
  "What do you think we are really good at together?",
  "What helps you most when you have a bad day?",
  "What is one way I could make your week a little easier?"
];

function todayInBern() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function questionDay(value) {
  if (typeof value !== "string" || !isValidDate(value) || value < FIRST_QUESTION_DAY || value > todayInBern()) {
    throw new Error("Choose a day between January 1, 2026 and today.");
  }
  return value;
}

function normalizeQuestions(value) {
  return {
    days: { ...(value?.days || {}) },
    custom: Array.isArray(value?.custom) ? value.custom : [],
    next: Number.isInteger(value?.next) && value.next >= 0 ? value.next : 0
  };
}

// Gives a day its question the first time anyone opens it: our own questions first (oldest
// first), then the next built-in one. Assigned questions never change. True when it assigned one.
function assignQuestion(doc, day) {
  if (doc.days[day]) return false;
  const custom = doc.custom.filter((item) => !item.usedOn).sort(byAt)[0];
  if (custom) {
    custom.usedOn = day;
    doc.days[day] = { question: custom.text, source: "custom", customId: custom.id, answers: {} };
  } else {
    const index = doc.next % BUILTIN_QUESTIONS.length;
    doc.days[day] = { question: BUILTIN_QUESTIONS[index], source: "builtin", answers: {} };
    doc.next = (index + 1) % BUILTIN_QUESTIONS.length;
  }
  // Keep the newest days, and always the one just opened.
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_QUESTION_DAYS))) delete doc.days[old];
  return true;
}

// Guess my answer: with your answer you can guess what the other one says. Once you both
// answered, each of you judges the other's guess; the guesser gets this many hearts.
const GUESS_HEARTS = { spot: 3, close: 1, miss: 0 };
const MAX_GUESS = 200;

const questionPartner = (author) => (author === "her" ? "sender" : "her");

// An answer as the pages see it (answers saved before guesses existed have none).
function answerOut(answer) {
  if (!answer) return null;
  return { text: answer.text, at: answer.at, guess: typeof answer.guess === "string" && answer.guess ? answer.guess : null };
}

// Their answer (and their guess about mine) only shows once I've answered too.
// Verdicts only exist once we both answered: `mine` is theirs on my guess, `theirs` mine on theirs.
function answerView(entry, author) {
  const other = questionPartner(author);
  const mine = entry.answers?.[author] || null;
  const theirs = entry.answers?.[other] || null;
  const verdictOn = (guesser) => {
    const verdict = entry.verdicts?.[guesser]?.verdict;
    return mine && theirs && Object.hasOwn(GUESS_HEARTS, verdict) ? verdict : null;
  };
  return {
    question: entry.question,
    mine: answerOut(mine),
    theirs: mine ? answerOut(theirs) : null,
    theirsAnswered: Boolean(theirs),
    verdicts: { mine: verdictOn(author), theirs: verdictOn(other) }
  };
}

function questionView(doc, day, author) {
  const entry = doc.days[day];
  const history = Object.keys(doc.days)
    .filter((key) => key < day)
    .sort()
    .reverse()
    .slice(0, QUESTION_HISTORY)
    .map((key) => ({ day: key, ...answerView(doc.days[key], author) }));
  const { question, mine, theirs, theirsAnswered, verdicts } = answerView(entry, author);
  return { day, question, source: entry.source, mine, theirs, theirsAnswered, verdicts, history };
}

// Hearts each of us earned from guesses judged right (the running guess score).
async function guessScore(txn) {
  const totals = (await awardTotals(txn)).guess || {};
  return { her: totals.her || 0, sender: totals.sender || 0 };
}

// Questions still waiting first (in the order they come up), then the asked ones, latest first.
function sortCustom(custom) {
  const waiting = custom.filter((item) => !item.usedOn).sort(byAt);
  const asked = custom.filter((item) => item.usedOn).sort((a, b) => String(b.usedOn).localeCompare(String(a.usedOn)) || byAt(b, a));
  return [...waiting, ...asked];
}

// Other people's queued wording never leaves the store; order alone keeps "Up next" accurate.
function customQuestionView(doc, author) {
  const queue = doc.custom.filter((item) => !item.usedOn).sort(byAt)
    .map(({ id, author: owner, at }) => ({ id, author: owner, at }));
  return {
    author,
    custom: sortCustom(doc.custom.filter((item) => item.author === author)),
    otherWaiting: queue.filter((item) => item.author !== author).length,
    queue
  };
}

function normalizeQuestionAction(input) {
  if (!input || typeof input !== "object" || !QUESTION_ACTIONS.includes(input.action)) throw new Error("Unknown question action.");
  const change = { action: input.action };
  if (!AUTHORS.includes(input.author)) throw new Error("Choose who is writing.");
  change.author = input.author;
  if (change.action === "answer") {
    change.day = questionDay(input.day);
    const text = typeof input.text === "string" ? input.text.replace(/\r\n?/g, "\n").trim() : "";
    if (!text || text.length > 500) throw new Error("Write an answer (up to 500 characters).");
    change.text = text;
    // Optional; left out keeps the guess as it is, "" removes it.
    if (input.guess !== undefined && input.guess !== null) {
      change.guess = cleanLabel(input.guess, MAX_GUESS, `Keep your guess under ${MAX_GUESS} characters.`, true);
    }
  }
  if (change.action === "judge") {
    change.day = questionDay(input.day);
    if (!Object.hasOwn(GUESS_HEARTS, input.verdict)) throw new Error("Choose how close the guess was.");
    change.verdict = input.verdict;
  }
  if (change.action === "custom") change.text = cleanLabel(input.text, 200, "Write a question (up to 200 characters).");
  if (change.action === "uncustom") change.id = itemId(input.id, "That question is gone.");
  return change;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = isAllowedOrigin(origin, env);
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    // Photos and videos are fetched by <img>/<video> from any page, with or without an Origin.
    const isPublic = PUBLIC_ROUTES.includes(path) && ["GET", "HEAD"].includes(request.method);
    const withOrigin = (response) => {
      if (!allowed || origin === ALLOWED_ORIGIN) return response;
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", origin);
      return new Response(response.body, { status: response.status, headers });
    };
    if (request.method === "OPTIONS") return withOrigin(new Response(null, { status: 204, headers: corsHeaders(origin) }));
    if (!allowed && !isPublic) return json({ error: "Origin not allowed." }, 403, origin);

    if (!ROUTES.includes(path)) return withOrigin(json({ error: "Not found." }, 404, origin));
    if (!isPublic && !["GET", "POST", "PUT", "DELETE"].includes(request.method)) {
      return withOrigin(json({ error: "Method not allowed." }, 405, origin));
    }

    // Movie search only talks to TMDB (with the Worker's secret token), so it needs no store.
    if (path === "/movies/search") {
      return withOrigin(request.method === "GET"
        ? await searchMovies(url, env, origin)
        : json({ error: "Method not allowed." }, 405, origin));
    }

    const store = url.searchParams.get("store") === "preview" ? "preview" : "live";
    if (path === "/reset" && (store !== "preview" || request.method !== "POST")) {
      return withOrigin(json({ error: "Not found." }, 404, origin));
    }
    const id = env.PLAN_STORE.idFromName(STORES[store]);
    const response = await env.PLAN_STORE.get(id).fetch(new Request(`https://plan-store${path}${url.search}`, request));
    // Public media responses already allow every origin; pass them through untouched so they keep streaming.
    return isPublic ? response : withOrigin(response);
  }
};

export class PlanStore {
  constructor(ctx) {
    this.ctx = ctx;
    // Media ids with an upload in progress, so the same file isn't written twice at once.
    this.uploads = new Set();
    // The VAPID keys, once loaded from storage (or made).
    this.vapidKeys = null;
  }

  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/reset" && request.method === "POST") {
      // The sandbox's notification key and the phones subscribed to it survive a reset:
      // a new key would silently break every subscription made with the old one.
      const kept = await this.ctx.storage.get([VAPID_KEY, PUSH_KEY]);
      await this.ctx.storage.deleteAll();
      if (kept.size) await this.ctx.storage.put(Object.fromEntries(kept));
      return json({ reset: true }, 200, origin);
    }

    if (path === "/media" || path.startsWith("/media/")) return this.media(request, url, origin);
    if (path === "/outfits") return this.outfits(request, url, origin);
    if (path === "/snacks") return this.snacks(request, origin);
    if (path === "/activity") return this.activity(request, url, origin);
    if (path.startsWith("/push/")) {
      if (url.searchParams.get("store") === "preview" && path !== "/push/unsubscribe") {
        // Finish the forwarded request stream before replying (especially for old clients' POSTs).
        await request.arrayBuffer();
        return json({ error: "Phone notifications are disabled in preview. Use the real letter instead." }, 409, origin);
      }
      return this.push(request, path, origin);
    }
    if (path === "/movies") return this.movies(request, origin);
    if (path === "/ideas") return this.ideas(request, origin);
    if (path === "/question" || path === "/question/custom") return this.question(request, url, origin);
    if (path === "/games" || path.startsWith("/games/")) return this.games(request, url, origin);

    if (path === "/coupons" && request.method === "GET") {
      return json({ coupons: normalizeCoupons(await this.ctx.storage.get(COUPONS_KEY)) }, 200, origin);
    }

    if (path === "/coupons" && request.method === "POST") {
      let input;
      try { input = await request.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }
      const id = input?.id;
      const action = input?.action;
      if (typeof id !== "string" || !COUPON_ID.test(id) || !["redeem", "unlock"].includes(action)) {
        return json({ error: "Unknown coupon." }, 400, origin);
      }
      const result = await this.ctx.storage.transaction(async (txn) => {
        const coupons = normalizeCoupons(await txn.get(COUPONS_KEY));
        const bucket = action === "redeem" ? coupons.redeemed : coupons.unlocked;
        if (action === "redeem" && bucket[id]) return { conflict: true, coupons };
        if (bucket[id]) return { coupons };
        if (Object.keys(bucket).length >= MAX_COUPONS) return { full: true, coupons };
        bucket[id] = new Date().toISOString();
        await txn.put(COUPONS_KEY, coupons);
        return { coupons, changed: true };
      });
      if (result.conflict) return json({ error: "This coupon was already redeemed.", coupons: result.coupons }, 409, origin);
      if (result.full) return json({ error: "There are too many coupons saved." }, 400, origin);
      return json({ coupons: result.coupons, changed: Boolean(result.changed) }, 200, origin);
    }

    // The easter eggs she has found, so both phones show her secret hunt.
    if (path === "/secrets" && request.method === "GET") {
      return json({ found: (await this.ctx.storage.get(SECRETS_KEY)) || [] }, 200, origin);
    }

    if (path === "/secrets" && request.method === "POST") {
      let input;
      try { input = await request.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }
      if (typeof input?.id !== "string" || !SECRET_ID.test(input.id)) return json({ error: "Unknown secret." }, 400, origin);
      const found = await this.ctx.storage.transaction(async (txn) => {
        const list = (await txn.get(SECRETS_KEY)) || [];
        if (!list.includes(input.id) && list.length < MAX_SECRETS) {
          list.push(input.id);
          await txn.put(SECRETS_KEY, list);
        }
        return list;
      });
      return json({ found }, 200, origin);
    }

    if (path === "/journal" && request.method === "GET") {
      return json({ entries: await buildJournal(this.ctx.storage) }, 200, origin);
    }

    if (path === "/journal/photo" && request.method === "GET") {
      const key = url.searchParams.get("key") || "";
      const author = url.searchParams.get("author") || "";
      if (!ENTRY_KEY.test(key) || !AUTHORS.includes(author)) return json({ error: "Unknown photo." }, 400, origin);
      const photo = await this.ctx.storage.get(`photo:${key}:${author}`);
      return photo ? json({ photo }, 200, origin) : json({ error: "No photo for this review." }, 404, origin);
    }

    if (path === "/journal" && request.method === "PUT") {
      let review;
      try { review = normalizeReview(await request.json()); } catch (error) {
        return json({ error: error instanceof SyntaxError ? "Invalid request body." : error.message }, 400, origin);
      }
      const result = await this.ctx.storage.transaction(async (txn) => {
        const entries = (await txn.get(JOURNAL_KEY)) || [];
        let entry = entries.find((item) => item.key === review.key);
        if (!entry) {
          if (entries.length >= MAX_JOURNAL_ENTRIES) return { full: true };
          entry = { key: review.key, date: review.date, time: review.time, activity: review.activity, place: review.place, reviews: {} };
          entries.push(entry);
        }
        const photoKey = `photo:${review.key}:${review.author}`;
        let hasPhoto = Boolean(entry.reviews[review.author]?.hasPhoto);
        if (typeof review.photo === "string") {
          await txn.put(photoKey, review.photo);
          hasPhoto = true;
        } else if (review.photo === null) {
          await txn.delete(photoKey);
          hasPhoto = false;
        }
        entry.reviews[review.author] = { stars: review.stars, ...(review.overflow ? { overflow: true } : {}), note: review.note, hasPhoto, at: new Date().toISOString() };
        entries.sort((a, b) => b.key.localeCompare(a.key));
        await txn.put(JOURNAL_KEY, entries);
        return { entries };
      });
      // Answers with the same full timeline as GET /journal, so the page can render it right away.
      return result.full
        ? json({ error: "The journal is full." }, 400, origin)
        : json({ entries: await buildJournal(this.ctx.storage) }, 200, origin);
    }

    if (path === "/plan" && request.method === "GET") {
      return json({ plan: (await this.ctx.storage.get(PLAN_KEY)) || null }, 200, origin);
    }

    if (path === "/plan/late" && request.method === "POST") {
      let input;
      try { input = await request.json(); } catch { return json({ error: "Choose a late estimate." }, 400, origin); }
      if (!input || typeof input !== "object" || ![5, 10, 15, 30].includes(input.minutes)) {
        return json({ error: "Choose one of the available late estimates." }, 400, origin);
      }
      const result = await this.ctx.storage.transaction(async (txn) => {
        const existing = await txn.get(PLAN_KEY);
        if (!existing) return { missing: true };
        if (existing.status !== "confirmed") return { cancelled: true, plan: existing };
        const plan = { ...existing, lateByMinutes: input.minutes, lateAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        await txn.put(PLAN_KEY, plan);
        return { plan };
      });
      if (result.missing) return json({ error: "There is no confirmed plan." }, 404, origin);
      if (result.cancelled) return json({ error: "This date has been cancelled.", plan: result.plan }, 409, origin);
      return json({ plan: result.plan }, 200, origin);
    }

    if (path === "/plan/late" && request.method === "DELETE") {
      const result = await this.ctx.storage.transaction(async (txn) => {
        const existing = await txn.get(PLAN_KEY);
        if (!existing) return { missing: true };
        const plan = { ...existing, lateByMinutes: null, lateAt: null, updatedAt: new Date().toISOString() };
        await txn.put(PLAN_KEY, plan);
        return { plan };
      });
      return result.missing ? json({ error: "There is no plan to update." }, 404, origin) : json({ plan: result.plan }, 200, origin);
    }

    if (path === "/plan" && request.method === "POST") {
      let input;
      try { input = await request.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }

      try {
        const result = await this.ctx.storage.transaction(async (txn) => {
          const existing = await txn.get(PLAN_KEY);
          if (existing) return { conflict: true, plan: existing };
          const plan = normalizePlan(input, null);
          await txn.put(PLAN_KEY, plan);
          return { conflict: false, plan };
        });
        return result.conflict
          ? json({ error: "A plan already exists. Reschedule the current plan instead.", plan: result.plan }, 409, origin)
          : json({ plan: result.plan }, 201, origin);
      } catch (error) {
        return json({ error: error.message || "Could not save the plan." }, 400, origin);
      }
    }

    // Plans the next date once the current one has happened: the old plan moves into
    // the journal history, a cancelled one is simply replaced.
    if (path === "/plan/next" && request.method === "POST") {
      let input;
      try { input = await request.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }

      try {
        const requestId = input?.requestId === undefined ? null : itemId(input.requestId, "Could not identify this plan request.");
        const result = await this.ctx.storage.transaction(async (txn) => {
          const existing = await txn.get(PLAN_KEY);
          // A lost response can be retried without replacing the saved date or consuming twice.
          if (requestId && existing?.creationRequestId === requestId) return { plan: existing, replayed: true };
          if (existing?.status === "confirmed" && !planStarted(existing)) return { conflict: true, plan: existing };
          const plan = normalizePlan(input, null);
          const jarIdeaId = await consumePlanIdea(txn, input, plan);
          if (requestId) plan.creationRequestId = requestId;
          if (jarIdeaId) plan.jarIdeaId = jarIdeaId;
          await archivePlan(txn, existing);
          await txn.put(PLAN_KEY, plan);
          return { plan };
        });
        return result.conflict
          ? json({ error: "Your current date hasn't happened yet.", plan: result.plan }, 409, origin)
          : json({ plan: result.plan, jarIdeaUsed: Boolean(result.plan.jarIdeaId) }, result.replayed ? 200 : 201, origin);
      } catch (error) {
        return json({ error: error.message || "Could not save the plan." }, 400, origin);
      }
    }

    if (path === "/plan" && request.method === "PUT") {
      let input;
      try { input = await request.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }
      try {
        const result = await this.ctx.storage.transaction(async (txn) => {
          const existing = await txn.get(PLAN_KEY);
          if (!existing) return { missing: true };
          const plan = normalizePlan(input, existing);
          if (planStarted(existing)) await archivePlan(txn, existing);
          else if (entryKey(existing) !== entryKey(plan)) await moveOutfits(txn, entryKey(existing), entryKey(plan));
          await txn.put(PLAN_KEY, plan);
          return { plan };
        });
        return result.missing ? json({ error: "There is no plan to reschedule." }, 404, origin) : json({ plan: result.plan }, 200, origin);
      } catch (error) {
        return json({ error: error.message || "Could not update the plan." }, 400, origin);
      }
    }

    if (path !== "/plan" || request.method !== "DELETE") return json({ error: "Method not allowed." }, 405, origin);

    const result = await this.ctx.storage.transaction(async (txn) => {
      const existing = await txn.get(PLAN_KEY);
      if (!existing) return { missing: true };
      await archivePlan(txn, existing);
      const plan = { ...existing, status: "cancelled", lateByMinutes: null, lateAt: null, updatedAt: new Date().toISOString() };
      await txn.put(PLAN_KEY, plan);
      return { plan };
    });
    return result.missing ? json({ error: "There is no plan to cancel." }, 404, origin) : json({ plan: result.plan }, 200, origin);
  }

  async findMedia(id) {
    if (!ITEM_ID.test(id)) return null;
    return ((await this.ctx.storage.get(MEDIA_KEY)) || []).find((item) => item.id === id) || null;
  }

  // Photos and videos for the journal and the outfit vote.
  async media(request, url, origin) {
    const path = url.pathname;
    const method = request.method;
    const id = url.searchParams.get("id") || "";
    const storage = this.ctx.storage;

    if (path === "/media/file" && ["GET", "HEAD"].includes(method)) {
      const item = await this.findMedia(id);
      if (!item || item.status !== "ready") return publicJson({ error: "That photo or video is gone." }, 404);
      const range = parseRange(request.headers.get("Range"), item.size);
      if (range === false) {
        return publicJson({ error: "That part of the file doesn't exist." }, 416, { "Content-Range": `bytes */${item.size}` });
      }
      const { start, end } = range || { start: 0, end: item.size - 1 };
      const headers = mediaHeaders(item.mime, end - start + 1);
      if (range) headers["Content-Range"] = `bytes ${start}-${end}/${item.size}`;
      const body = method === "HEAD" ? null : chunkStream(storage, item.id, start, end);
      return new Response(body, { status: range ? 206 : 200, headers });
    }

    if (path === "/media/thumb" && ["GET", "HEAD"].includes(method)) {
      const thumb = ITEM_ID.test(id) ? await storage.get(thumbKey(id)) : undefined;
      if (!thumb) return publicJson({ error: "There is no preview for this." }, 404);
      const bytes = toBytes(thumb);
      return new Response(method === "HEAD" ? null : bytes, { status: 200, headers: mediaHeaders("image/jpeg", bytes.byteLength) });
    }

    if (path === "/media" && method === "GET") {
      const key = url.searchParams.get("key") || "";
      const scope = url.searchParams.get("scope") || "";
      if (!ENTRY_KEY.test(key) || !MEDIA_SCOPES.includes(scope)) return json({ error: "Unknown album." }, 400, origin);
      const media = ((await storage.get(MEDIA_KEY)) || [])
        .filter((item) => item.status === "ready" && item.key === key && item.scope === scope)
        .sort(byAt);
      return json({ media }, 200, origin);
    }

    if (path === "/media" && method === "POST") {
      let item;
      try { item = normalizeMedia(await request.json()); } catch (error) {
        return json({ error: error instanceof SyntaxError ? "Invalid request body." : error.message }, 400, origin);
      }
      const result = await storage.transaction(async (txn) => {
        const list = (await txn.get(MEDIA_KEY)) || [];
        const stale = list.filter((media) => media.status === "pending" && Date.now() - Date.parse(media.at) > PENDING_MEDIA_TTL);
        for (const media of stale) await deleteMediaData(txn, media);
        const kept = list.filter((media) => !stale.includes(media));
        if (kept.length >= MAX_MEDIA) {
          if (stale.length) await txn.put(MEDIA_KEY, kept);
          return { full: true };
        }
        kept.push(item);
        await txn.put(MEDIA_KEY, kept);
        return { media: item };
      });
      return result.full
        ? json({ error: "There are too many photos and videos saved." }, 400, origin)
        : json({ media: result.media }, 201, origin);
    }

    if (path === "/media" && method === "DELETE") {
      const author = url.searchParams.get("author") || "";
      if (!ITEM_ID.test(id) || !AUTHORS.includes(author)) return json({ error: "Unknown photo or video." }, 400, origin);
      const result = await storage.transaction(async (txn) => {
        const list = (await txn.get(MEDIA_KEY)) || [];
        const item = list.find((media) => media.id === id);
        if (!item) return { deleted: true };
        if (item.author !== author) return { forbidden: true };
        await txn.put(MEDIA_KEY, list.filter((media) => media !== item));
        await deleteMediaData(txn, item);
        await removeOutfitsUsing(txn, item.key, item.id);
        return { deleted: true };
      });
      return result.forbidden
        ? json({ error: "You can only delete your own photos and videos." }, 403, origin)
        : json({ deleted: true }, 200, origin);
    }

    if (["/media/file", "/media/thumb"].includes(path) && method === "PUT") {
      const response = await this.upload(request, path, id, origin);
      // Early answers (unknown id, too big…) still take in the whole upload first.
      if (request.body && !request.bodyUsed) await drain(request.body.getReader());
      return response;
    }

    return json({ error: "Method not allowed." }, 405, origin);
  }

  // PUT /media/file (the photo or video itself) and PUT /media/thumb (its small JPEG preview).
  async upload(request, path, id, origin) {
    const storage = this.ctx.storage;
    if (path === "/media/file") {
      const item = await this.findMedia(id);
      if (!item) return json({ error: "That upload has expired. Please try again." }, 404, origin);
      if (item.status !== "pending" || this.uploads.has(item.id)) return json({ error: "This file was already uploaded." }, 409, origin);
      const kind = MEDIA_KINDS[item.kind];
      if (Number(request.headers.get("Content-Length")) > kind.maxSize) return json({ error: kind.tooBig }, 413, origin);
      if (!request.body) return json({ error: "The file is empty." }, 400, origin);

      this.uploads.add(item.id);
      try {
        let stored;
        try {
          stored = await storeChunks(storage, item.id, request.body, kind.maxSize);
        } catch (error) {
          return error.tooLarge
            ? json({ error: kind.tooBig }, 413, origin)
            : json({ error: "The upload was interrupted. Please try again." }, 400, origin);
        }
        if (stored.size === 0) return json({ error: "The file is empty." }, 400, origin);
        const result = await storage.transaction(async (txn) => {
          const list = (await txn.get(MEDIA_KEY)) || [];
          const media = list.find((entry) => entry.id === item.id);
          if (!media) return {};
          Object.assign(media, { size: stored.size, chunks: stored.chunks, status: "ready" });
          await txn.put(MEDIA_KEY, list);
          return { media };
        });
        if (!result.media) {
          // Deleted while it was uploading.
          await deleteMany(storage, chunkKeys(item.id, stored.chunks));
          return json({ error: "That photo or video was deleted." }, 404, origin);
        }
        return json({ media: result.media }, 200, origin);
      } finally {
        this.uploads.delete(item.id);
      }
    }

    if (!(await this.findMedia(id))) return json({ error: "That upload has expired. Please try again." }, 404, origin);
    const tooBig = { error: "That preview image is too big." };
    if (Number(request.headers.get("Content-Length")) > MAX_THUMB_LENGTH) return json(tooBig, 413, origin);
    let bytes;
    try { bytes = await readBody(request.body, MAX_THUMB_LENGTH); } catch (error) {
      return error.tooLarge ? json(tooBig, 413, origin) : json({ error: "The upload was interrupted. Please try again." }, 400, origin);
    }
    if (!bytes.byteLength) return json({ error: "The preview image is empty." }, 400, origin);
    const result = await storage.transaction(async (txn) => {
      const list = (await txn.get(MEDIA_KEY)) || [];
      const media = list.find((entry) => entry.id === id);
      if (!media) return {};
      await txn.put(thumbKey(id), bytes);
      media.hasThumb = true;
      await txn.put(MEDIA_KEY, list);
      return { media };
    });
    return result.media
      ? json({ media: result.media }, 200, origin)
      : json({ error: "That photo or video was deleted." }, 404, origin);
  }

  // The outfit vote for one date: photos, ratings, comments and each person's pick.
  async outfits(request, url, origin) {
    if (request.method === "GET") {
      const key = url.searchParams.get("key") || "";
      if (!ENTRY_KEY.test(key)) return json({ error: "Unknown date." }, 400, origin);
      return json(outfitState(await this.ctx.storage.get(outfitsKey(key))), 200, origin);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

    let change;
    try { change = normalizeOutfitAction(await request.json()); } catch (error) {
      return json({ error: error instanceof SyntaxError ? "Invalid request body." : error.message }, 400, origin);
    }
    const result = await this.ctx.storage.transaction((txn) => applyOutfitAction(txn, change));
    const state = outfitState(result.doc);
    return result.error ? json({ error: result.error, ...state }, result.status, origin) : json(state, 200, origin);
  }

  // One shared snack wishlist.
  async snacks(request, origin) {
    if (request.method === "GET") {
      return json({ snacks: sortSnacks((await this.ctx.storage.get(SNACKS_KEY)) || []) }, 200, origin);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

    let change;
    try { change = normalizeSnackAction(await request.json()); } catch (error) {
      return json({ error: error instanceof SyntaxError ? "Invalid request body." : error.message }, 400, origin);
    }
    const result = await this.ctx.storage.transaction(async (txn) => {
      const outcome = applySnackAction((await txn.get(SNACKS_KEY)) || [], change);
      if (outcome.changed) await txn.put(SNACKS_KEY, outcome.snacks);
      return outcome;
    });
    const snacks = sortSnacks(result.snacks);
    return result.error ? json({ error: result.error, snacks }, result.status, origin) : json({ snacks }, 200, origin);
  }

  // What each of us did lately, for the bell, plus a phone notification for the other person.
  async activity(request, url, origin) {
    const storage = this.ctx.storage;
    if (request.method === "GET") {
      const since = url.searchParams.get("since") || "";
      const sinceTime = since ? Date.parse(since) : -Infinity;
      if (Number.isNaN(sinceTime)) return json({ error: "Unknown time." }, 400, origin);
      const activity = ((await storage.get(ACTIVITY_KEY)) || [])
        .filter((item) => Date.parse(item.at) > sinceTime)
        .slice(0, MAX_ACTIVITY_RESPONSE);
      return json({ activity }, 200, origin);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

    let change;
    try { change = normalizeActivity(await request.json()); } catch (error) {
      return json({ error: error instanceof SyntaxError ? "Invalid request body." : error.message }, 400, origin);
    }
    await storage.transaction(async (txn) => {
      const list = (await txn.get(ACTIVITY_KEY)) || [];
      list.unshift(change.item);
      await txn.put(ACTIVITY_KEY, list.slice(0, MAX_ACTIVITY));
    });
    // A notification that can't be delivered never fails the activity itself.
    if (change.push && url.searchParams.get("store") !== "preview") await this.background(this.notifyOthers(change.item));
    return json({ item: change.item }, 201, origin);
  }

  // Lets a task finish after the response when the runtime supports that; otherwise waits a little for it.
  async background(task) {
    const settled = Promise.resolve(task).catch(() => {});
    if (typeof this.ctx.waitUntil === "function") {
      this.ctx.waitUntil(settled);
      return;
    }
    let timer;
    await Promise.race([settled, new Promise((resolve) => { timer = setTimeout(resolve, PUSH_WAIT); })]);
    clearTimeout(timer);
  }

  async notifyOthers(item) {
    const subscriptions = ((await this.ctx.storage.get(PUSH_KEY)) || []).filter((subscription) => subscription.author !== item.author);
    return this.pushTo(subscriptions, { ...activityPush(item), store: "live" });
  }

  // The Worker's own VAPID key pair: made on first need, then kept in storage.
  async vapid() {
    if (this.vapidKeys) return this.vapidKeys;
    let stored = await this.ctx.storage.get(VAPID_KEY);
    if (!stored) {
      const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
      const fresh = {
        privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
        publicKey: toBase64url(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey))),
        at: new Date().toISOString()
      };
      // When two first requests race, both keep the key that was saved first.
      stored = await this.ctx.storage.transaction(async (txn) => {
        const existing = await txn.get(VAPID_KEY);
        if (existing) return existing;
        await txn.put(VAPID_KEY, fresh);
        return fresh;
      });
    }
    const privateKey = await crypto.subtle.importKey("jwk", stored.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    this.vapidKeys = { publicKey: stored.publicKey, privateKey };
    return this.vapidKeys;
  }

  // Sends one notification to each subscription and forgets the phones that unsubscribed.
  async pushTo(subscriptions, payload) {
    if (!subscriptions.length) return { sent: 0, failed: 0 };
    let vapid;
    try { vapid = await this.vapid(); } catch { return { sent: 0, failed: subscriptions.length }; }
    const outcomes = await Promise.all(subscriptions.map((subscription) => sendPush(subscription, payload, vapid)));
    const gone = subscriptions.filter((_, index) => outcomes[index] === "gone");
    if (gone.length) {
      await this.ctx.storage.transaction(async (txn) => {
        const list = (await txn.get(PUSH_KEY)) || [];
        // Only the exact subscriptions we tried: a phone may have subscribed again meanwhile.
        const kept = list.filter((item) => !gone.some((dead) => dead.endpoint === item.endpoint && dead.at === item.at));
        if (kept.length !== list.length) await txn.put(PUSH_KEY, kept);
      });
    }
    const sent = outcomes.filter((outcome) => outcome === "sent").length;
    return { sent, failed: outcomes.length - sent };
  }

  // Phone notifications: the Worker's public key, each phone's subscription, and a test.
  async push(request, path, origin) {
    const storage = this.ctx.storage;
    if (path === "/push/key") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, origin);
      try {
        return json({ publicKey: (await this.vapid()).publicKey }, 200, origin);
      } catch {
        return json({ error: "Notifications aren't available right now." }, 500, origin);
      }
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid request body." }, 400, origin); }

    if (path === "/push/subscribe") {
      let subscription;
      try { subscription = await normalizeSubscription(input); } catch (error) { return json({ error: error.message }, 400, origin); }
      await storage.transaction(async (txn) => {
        // One entry per phone: subscribing again updates whose phone it is.
        const list = ((await txn.get(PUSH_KEY)) || []).filter((item) => item.endpoint !== subscription.endpoint);
        list.push(subscription);
        // The oldest subscriptions make room; they are the likeliest to be gone.
        await txn.put(PUSH_KEY, list.sort(byAt).slice(-MAX_PUSH_SUBSCRIPTIONS));
      });
      return json({ subscribed: true }, 201, origin);
    }

    if (path === "/push/unsubscribe") {
      const endpoint = input?.endpoint;
      if (typeof endpoint !== "string" || !endpoint || endpoint.length > 600) {
        return json({ error: "That notification address isn't valid." }, 400, origin);
      }
      await storage.transaction(async (txn) => {
        const list = (await txn.get(PUSH_KEY)) || [];
        const kept = list.filter((item) => item.endpoint !== endpoint);
        if (kept.length !== list.length) await txn.put(PUSH_KEY, kept);
      });
      return json({ unsubscribed: true }, 200, origin);
    }

    if (path === "/push/test") {
      if (!AUTHORS.includes(input?.author)) return json({ error: "Choose whose phone this is." }, 400, origin);
      const own = ((await storage.get(PUSH_KEY)) || []).filter((item) => item.author === input.author);
      return json(await this.pushTo(own, { ...TEST_PUSH, store: "live" }), 200, origin);
    }
    return json({ error: "Not found." }, 404, origin);
  }

  // Our movie list, the hearts on it and the movie the wheel picked.
  async movies(request, origin) {
    if (request.method === "GET") return json(movieState(await this.ctx.storage.get(MOVIES_KEY)), 200, origin);
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

    let change;
    try { change = normalizeMovieAction(await request.json()); } catch (error) {
      return json({ error: error instanceof SyntaxError ? "Invalid request body." : error.message }, 400, origin);
    }
    const result = await this.ctx.storage.transaction(async (txn) => {
      const doc = normalizeMovies(await txn.get(MOVIES_KEY));
      const outcome = applyMovieAction(doc, change);
      if (outcome.changed) await txn.put(MOVIES_KEY, doc);
      return { ...outcome, doc };
    });
    const state = movieState(result.doc);
    if (result.error) return json({ error: result.error, ...state }, result.status, origin);
    // Extras for the page: the movie that was already on the list, or the wheel's candidates.
    if (result.duplicate) state.duplicate = result.duplicate;
    if (result.candidates) state.candidates = result.candidates;
    return json(state, 200, origin);
  }

  // Date ideas we drop in the jar and pull out later.
  async ideas(request, origin) {
    if (request.method === "GET") {
      return json({ ideas: sortIdeas((await this.ctx.storage.get(IDEAS_KEY)) || []) }, 200, origin);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

    let change;
    try { change = normalizeIdeaAction(await request.json()); } catch (error) {
      return json({ error: error instanceof SyntaxError ? "Invalid request body." : error.message }, 400, origin);
    }
    const result = await this.ctx.storage.transaction(async (txn) => {
      const outcome = applyIdeaAction((await txn.get(IDEAS_KEY)) || [], change);
      if (outcome.changed) await txn.put(IDEAS_KEY, outcome.ideas);
      return outcome;
    });
    const ideas = sortIdeas(result.ideas);
    if (result.error) return json({ error: result.error, ideas }, result.status, origin);
    return json(result.duplicate ? { ideas, duplicate: result.duplicate } : { ideas }, 200, origin);
  }

  // One question a day for both of us; each answer shows to the other once they answered too.
  async question(request, url, origin) {
    const storage = this.ctx.storage;
    const path = url.pathname;
    if (path === "/question/custom") {
      if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, origin);
      const author = url.searchParams.get("author") || "";
      if (!AUTHORS.includes(author)) return json({ error: "Choose who is writing." }, 400, origin);
      return json(customQuestionView(normalizeQuestions(await storage.get(QUESTIONS_KEY)), author), 200, origin);
    }

    if (request.method === "GET") {
      const author = url.searchParams.get("author") || "";
      if (!AUTHORS.includes(author)) return json({ error: "Choose who is answering." }, 400, origin);
      let day;
      try { day = questionDay(url.searchParams.get("day") || todayInBern()); } catch (error) {
        return json({ error: error.message }, 400, origin);
      }
      const { doc, score } = await storage.transaction(async (txn) => {
        const value = normalizeQuestions(await txn.get(QUESTIONS_KEY));
        if (assignQuestion(value, day)) await txn.put(QUESTIONS_KEY, value);
        return { doc: value, score: await guessScore(txn) };
      });
      return json({ ...questionView(doc, day, author), guessScore: score }, 200, origin);
    }
    if (request.method !== "POST") return json({ error: "Method not allowed." }, 405, origin);

    let change;
    try { change = normalizeQuestionAction(await request.json()); } catch (error) {
      return json({ error: error instanceof SyntaxError ? "Invalid request body." : error.message }, 400, origin);
    }
    const result = await storage.transaction(async (txn) => {
      const doc = normalizeQuestions(await txn.get(QUESTIONS_KEY));
      const now = new Date().toISOString();
      let awarded = 0;
      if (change.action === "answer") {
        const entry = doc.days[change.day];
        if (!entry) return { status: 409, error: "Open that day's question first.", doc };
        // Answering again edits the answer. The guess can only change while their answer
        // is still hidden from me (I hadn't answered yet, or they haven't); else it stays.
        const previous = entry.answers?.[change.author] || null;
        const theirs = entry.answers?.[questionPartner(change.author)] || null;
        let guess = typeof previous?.guess === "string" ? previous.guess : "";
        if (change.guess !== undefined && (!previous || !theirs)) guess = change.guess;
        entry.answers = { ...entry.answers, [change.author]: { text: change.text, at: now, ...(guess ? { guess } : {}) } };
        // A heart for answering (once per day's question) and today counts for our streak.
        awarded += await award(txn, `question:${change.day}:${change.author}`, change.author, 1);
        // Only a first answer counts as playing today (editing an old answer doesn't).
        if (!previous) awarded += await markActive(txn, change.author);
      } else if (change.action === "judge") {
        // I judge their guess about my answer: hearts go to them (changing it replaces them).
        const entry = doc.days[change.day];
        const guesser = questionPartner(change.author);
        if (!entry?.answers?.[change.author] || !entry?.answers?.[guesser]) {
          return { status: 409, error: "You can judge once you've both answered.", doc };
        }
        if (!entry.answers[guesser].guess) return { status: 409, error: "There's no guess to judge for that day.", doc };
        entry.verdicts = { ...(entry.verdicts || {}), [guesser]: { verdict: change.verdict, at: now } };
        await award(txn, `guess:${change.day}:${guesser}`, guesser, GUESS_HEARTS[change.verdict]);
        awarded += await markActive(txn, change.author);
      } else if (change.action === "custom") {
        const text = change.text.toLowerCase();
        if (doc.custom.some((item) => !item.usedOn && String(item.text).toLowerCase() === text)) return { doc };
        if (doc.custom.length >= MAX_CUSTOM_QUESTIONS) {
          // Questions that were already asked make room (their day keeps the text).
          const asked = doc.custom.filter((item) => item.usedOn).sort((a, b) => String(a.usedOn).localeCompare(String(b.usedOn)))[0];
          if (!asked) return { status: 400, error: `There are already ${MAX_CUSTOM_QUESTIONS} questions waiting.`, doc };
          doc.custom = doc.custom.filter((item) => item !== asked);
        }
        doc.custom.push({ id: crypto.randomUUID(), text: change.text, author: change.author, at: now, usedOn: null });
      } else {
        const item = doc.custom.find((entry) => entry.id === change.id);
        if (!item) return { doc };
        if (item.author !== change.author) return { status: 403, error: "Only remove your own queued questions.", doc };
        if (item.usedOn) return { status: 409, error: "That question was already asked.", doc };
        doc.custom = doc.custom.filter((entry) => entry !== item);
      }
      await txn.put(QUESTIONS_KEY, doc);
      if (change.action === "answer" || change.action === "judge") return { doc, awarded, score: await guessScore(txn) };
      return { doc };
    });

    if (change.action === "answer" || change.action === "judge") {
      return result.error
        ? json({ error: result.error }, result.status, origin)
        : json({ ...questionView(result.doc, change.day, change.author), guessScore: result.score, awarded: result.awarded }, 200, origin);
    }
    const view = customQuestionView(result.doc, change.author);
    return result.error ? json({ error: result.error, ...view }, result.status, origin) : json(view, 200, origin);
  }

  // The games (worker/src/games/router.js routes them to their modules).
  async games(request, url, origin) {
    const { status, body } = await handleGame(this.ctx.storage, request, url);
    return json(body, status, origin);
  }
}
