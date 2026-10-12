const ALLOWED_ORIGIN = "https://dee0-0.github.io";
const PLAN_KEY = "current-plan";
const COUPONS_KEY = "coupons";
const SECRETS_KEY = "secrets";
const SECRET_ID = /^[a-z]{1,24}$/;
const MAX_SECRETS = 64;
const JOURNAL_KEY = "journal";
const MAX_TEXT_LENGTH = 400;
const MAX_COUPONS = 100;
const MAX_JOURNAL_ENTRIES = 200;
const MAX_PHOTO_LENGTH = 700_000;
const COUPON_ID = /^[a-z0-9-]{1,40}$/;
const ENTRY_KEY = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const AUTHORS = ["her", "sender"];
const ROUTES = ["/plan", "/plan/late", "/coupons", "/journal", "/journal/photo", "/secrets", "/reset"];
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
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}

function cleanText(value, label, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return "";
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT_LENGTH) {
    throw new Error(`${label} is missing or too long.`);
  }
  return value.trim();
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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = isAllowedOrigin(origin, env);
    const withOrigin = (response) => {
      if (!allowed || origin === ALLOWED_ORIGIN) return response;
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", origin);
      return new Response(response.body, { status: response.status, headers });
    };
    if (request.method === "OPTIONS") return withOrigin(new Response(null, { status: 204, headers: corsHeaders(origin) }));
    if (!allowed) return json({ error: "Origin not allowed." }, 403, origin);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    if (!ROUTES.includes(path)) return withOrigin(json({ error: "Not found." }, 404, origin));
    if (!["GET", "POST", "PUT", "DELETE"].includes(request.method)) {
      return withOrigin(json({ error: "Method not allowed." }, 405, origin));
    }

    const store = url.searchParams.get("store") === "preview" ? "preview" : "live";
    if (path === "/reset" && (store !== "preview" || request.method !== "POST")) {
      return withOrigin(json({ error: "Not found." }, 404, origin));
    }
    const id = env.PLAN_STORE.idFromName(STORES[store]);
    return withOrigin(await env.PLAN_STORE.get(id).fetch(new Request(`https://plan-store${path}${url.search}`, request)));
  }
};

export class PlanStore {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/reset" && request.method === "POST") {
      await this.ctx.storage.deleteAll();
      return json({ reset: true }, 200, origin);
    }

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
      return json({ entries: (await this.ctx.storage.get(JOURNAL_KEY)) || [] }, 200, origin);
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
      return result.full
        ? json({ error: "The journal is full." }, 400, origin)
        : json({ entries: result.entries }, 200, origin);
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
}
