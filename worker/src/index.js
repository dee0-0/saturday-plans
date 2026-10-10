const ALLOWED_ORIGIN = "https://dee0-0.github.io";
const PLAN_KEY = "current-plan";
const MAX_TEXT_LENGTH = 400;

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

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (origin !== ALLOWED_ORIGIN) return json({ error: "Origin not allowed." }, 403, origin);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");
    if (!['/plan', '/plan/late'].includes(path)) return json({ error: "Not found." }, 404, origin);
    if (!["GET", "POST", "PUT", "DELETE"].includes(request.method)) {
      return json({ error: "Method not allowed." }, 405, origin);
    }

    const id = env.PLAN_STORE.idFromName("one-plan-for-this-invitation");
    return env.PLAN_STORE.get(id).fetch(new Request(`https://plan-store${path}`, request));
  }
};

export class PlanStore {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const path = new URL(request.url).pathname;
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
