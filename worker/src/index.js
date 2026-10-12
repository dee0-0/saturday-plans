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
  "/media", "/media/file", "/media/thumb", "/outfits", "/snacks", "/reset"
];
// <img> and <video> load these directly, without an Origin header, so they are public.
const PUBLIC_ROUTES = ["/media/file", "/media/thumb"];
const EXPOSED_HEADERS = "Content-Range, Accept-Ranges, Content-Length";
// Photos and videos are stored in 1 MiB pieces (a single stored value is capped at about 2 MB).
const CHUNK_SIZE = 1024 * 1024;
const MAX_THUMB_LENGTH = 300 * 1024;
// Uploads that never finished are dropped after a day.
const PENDING_MEDIA_TTL = 24 * 60 * 60 * 1000;
const MEDIA_SCOPES = ["journal", "outfit"];
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
    Object.assign(snack, snack.done ? { done: false, doneBy: null, doneAt: null } : { done: true, doneBy: change.author, doneAt: now });
    return { snacks, changed: true };
  }
  const kept = snacks.filter((snack) => (change.action === "remove" ? snack.id !== change.id : !snack.done));
  return { snacks: kept, changed: kept.length !== snacks.length };
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
  }

  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/reset" && request.method === "POST") {
      await this.ctx.storage.deleteAll();
      return json({ reset: true }, 200, origin);
    }

    if (path === "/media" || path.startsWith("/media/")) return this.media(request, url, origin);
    if (path === "/outfits") return this.outfits(request, url, origin);
    if (path === "/snacks") return this.snacks(request, origin);

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
        const result = await this.ctx.storage.transaction(async (txn) => {
          const existing = await txn.get(PLAN_KEY);
          if (existing?.status === "confirmed" && !planStarted(existing)) return { conflict: true, plan: existing };
          const plan = normalizePlan(input, null);
          if (planStarted(existing)) {
            const key = entryKey(existing);
            const history = (await txn.get(HISTORY_KEY)) || [];
            if (!history.some((item) => item.key === key)) {
              history.push({ key, id: existing.id, ...planDetails(existing) });
              history.sort((a, b) => b.key.localeCompare(a.key));
              await txn.put(HISTORY_KEY, history.slice(0, MAX_HISTORY));
            }
          }
          await txn.put(PLAN_KEY, plan);
          return { plan };
        });
        return result.conflict
          ? json({ error: "Your current date hasn't happened yet.", plan: result.plan }, 409, origin)
          : json({ plan: result.plan }, 201, origin);
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
}
