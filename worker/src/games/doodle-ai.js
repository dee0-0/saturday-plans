// The drawing helper for the daily doodle (Dee's phone only): turns a few words or a photo
// into a cute, clean doodle: pen strokes and paint-bucket fills, like a finger drawing. The page draws them onto the pad
// stroke by stroke; from there it is an ordinary drawing (undo, add lines, send).
// Uses Claude (Opus or Sonnet, picked on the page) through the Anthropic SDK, with the Worker
// secret ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import { GameError, zurichDay } from "./common.js";
import { PALETTE, MAX_STROKES, MAX_POINTS, CANVAS_SIZE, cleanStrokes } from "./doodle.js";

const KEY = "games:doodle:helper";
// The page offers both: Opus draws best, Sonnet costs about half.
const MODELS = { opus: "claude-opus-5-5", sonnet: "claude-sonnet-5-5" };
const PER_DAY = 20;
const MAX_PROMPT = 200;
const MAX_IMAGE_CHARS = 1_500_000; // base64 of a phone photo scaled down on the page (~1.1 MB)
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const OWNER = "sender";

// Names the model picks from, in the page's palette order.
const COLOURS = {
  ink: PALETTE[0], grey: PALETTE[1], white: PALETTE[2], red: PALETTE[3], pink: PALETTE[4],
  lightpink: PALETTE[5], orange: PALETTE[6], yellow: PALETTE[7], lightgreen: PALETTE[8],
  green: PALETTE[9], skyblue: PALETTE[10], blue: PALETTE[11], purple: PALETTE[12], brown: PALETTE[13]
};
const SIZES = { thin: 0, thick: 1, brush: 2 };

// Each step is a pen stroke (a colour, a size, the points it passes through) or a tap with the
// paint bucket (tool "fill", one point inside an outlined area).
const SCHEMA = {
  type: "object",
  properties: {
    strokes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          tool: { type: "string", enum: ["pen", "fill"] },
          color: { type: "string", enum: Object.keys(COLOURS) },
          size: { type: "string", enum: Object.keys(SIZES) },
          points: { type: "array", items: { type: "array", items: { type: "integer" } } }
        },
        required: ["tool", "color", "size", "points"],
        additionalProperties: false
      }
    }
  },
  required: ["strokes"],
  additionalProperties: false
};

const SYSTEM = `You are a skilled illustrator drawing a polished, cute, sticker-style doodle with your finger in a phone drawing game. It should look clean and pretty, like good hand-drawn cartoon art: confident smooth lines, appealing shapes and nice flat colours.

The pad: 1000 x 1000, x to the right, y down, origin top-left. Paper is white. Your tools, in the order you use them:
- pen: a colour, a size (thin = fine line, thick = bold line, brush = very wide soft marker) and the [x, y] points the finger passes through. The app smooths the line through your points, so give points along curves about 20 to 40 units apart (4 to 30 points per stroke) and only a couple on straight parts.
- fill: the paint bucket. One point, well inside an area. It colours everything connected to that point that has the same colour as the point (like a paint app), stopping at lines of another colour.

How to draw it well:
1. Plan the composition first: one clear main subject, large and centred (roughly 100 to 900 on both axes), with good proportions. Cute character design: slightly big head, big round eyes.
2. Draw the outlines in ink. The outer silhouette of each part in thick; inner details in thin. Every area you want to colour must be a CLOSED shape: end the stroke exactly on its starting point, and where shapes touch, make the lines meet or cross with no gaps. A gap lets the colour leak into the background (such fills are removed).
3. Colour with fill: tap inside each closed area with its colour. Pick a pleasant, harmonious palette (2 to 5 colours besides ink). Leave the background white.
4. Then the details on top: eyes as small filled ink shapes with a white highlight dot, rosy cheeks (pink or lightpink brush dabs), shading or pattern with thin lines or small brush strokes, a few motion or sparkle lines if they suit.
5. 25 to 80 steps in all. No text, letters or numbers unless the subject itself is writing.

With a photo: draw its main subject in this cute illustrated style, keeping its pose, key features and colours, simplified. Ignore clutter in the background.`;

function normalizeUsage(value, day) {
  return value?.day === day ? { day, count: Number(value.count) || 0 } : { day, count: 0 };
}

function parseInput(body) {
  if (body.author !== OWNER) throw new GameError(403, "Not available.");
  const prompt = typeof body.prompt === "string" ? body.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt.length > MAX_PROMPT) throw new GameError(400, `Keep it under ${MAX_PROMPT} characters.`);
  let image = null;
  if (body.image !== undefined && body.image !== null) {
    const { media_type: mediaType, data } = body.image || {};
    if (!IMAGE_TYPES.includes(mediaType) || typeof data !== "string" || !data || data.length > MAX_IMAGE_CHARS || !/^[A-Za-z0-9+/]+=*$/.test(data)) {
      throw new GameError(400, "That photo couldn't be read. Try a smaller JPEG or PNG.");
    }
    image = { mediaType, data };
  }
  if (!prompt && !image) throw new GameError(400, "Say what to draw, or pick a photo.");
  const model = MODELS[body.model] || MODELS.opus;
  return { prompt, image, model };
}

// Small seeded random numbers, so the same answer is wobbled the same way in tests.
function randomFrom(seed) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

const clamp = (value) => Math.max(0, Math.min(CANVAS_SIZE, Math.round(value)));

// Rounds the corners of a line (Chaikin), `rounds` times. A closed line stays closed.
function smoothLine(points, closed, rounds = 2) {
  let out = points;
  for (let round = 0; round < rounds && out.length > 2; round += 1) {
    const ring = closed ? out.slice(0, -1) : out;
    const next = closed ? [] : [ring[0]];
    const count = closed ? ring.length : ring.length - 1;
    for (let index = 0; index < count; index += 1) {
      const [x0, y0] = ring[index];
      const [x1, y1] = ring[(index + 1) % ring.length];
      next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    if (closed) next.push(next[0]);
    else next.push(ring[ring.length - 1]);
    out = next;
  }
  return out;
}

// Turns the model's steps into the page's strokes: lines smoothed through the given points,
// closed shapes closed exactly, a very light wobble (it should still look hand-made), and
// paint-bucket fills kept only where they stay inside their outline (see fillsThatStayInside).
// Stays within the doodle limits.
export function handDrawn(raw, seed = Date.now()) {
  const random = randomFrom(seed);
  const steps = [];
  for (const stroke of Array.isArray(raw) ? raw : []) {
    const colour = COLOURS[stroke?.color];
    const points = (Array.isArray(stroke?.points) ? stroke.points : [])
      .filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .slice(0, 200)
      .map(([x, y]) => [clamp(x), clamp(y)]);
    if (!colour || !points.length) continue;
    if (stroke.tool === "fill") {
      steps.push({ fill: true, colour, at: points[0] });
    } else {
      const width = SIZES[stroke?.size];
      if (width === undefined) continue;
      const first = points[0];
      const last = points[points.length - 1];
      const closed = points.length >= 3 && Math.hypot(first[0] - last[0], first[1] - last[1]) <= 40;
      if (closed) points[points.length - 1] = [...first];
      steps.push({ colour, width, closed, points: points.length > 2 ? smoothLine(points, closed) : points });
    }
    if (steps.length >= MAX_STROKES) break;
  }
  if (!steps.some((step) => !step.fill)) throw new GameError(502, "The helper drew nothing. Try different words.");
  const lines = steps.filter((step) => !step.fill);
  const raws = lines.reduce((sum, stroke) => sum + stroke.points.length, 0);
  // Point spacing that keeps the whole drawing under the point limit.
  const length = lines.reduce((sum, stroke) => sum + stroke.points.reduce((acc, point, index) => (
    index ? acc + Math.hypot(point[0] - stroke.points[index - 1][0], point[1] - stroke.points[index - 1][1]) : acc
  ), 0), 0);
  const budget = Math.max(raws, MAX_POINTS - 300);
  const step = Math.max(8, length / Math.max(1, budget - raws));
  let total = 0;
  const out = [];
  for (const item of steps) {
    if (item.fill) {
      if (total + 1 > MAX_POINTS) break;
      total += 1;
      out.push({ f: 1, c: item.colour, p: item.at });
      continue;
    }
    const { colour, width, points, closed } = item;
    const amplitude = width === 2 ? 2.5 : 1.2;
    let drift = [0, 0];
    const p = [];
    const push = (x, y) => {
      drift = [drift[0] * 0.85 + (random() - 0.5) * amplitude, drift[1] * 0.85 + (random() - 0.5) * amplitude];
      p.push(clamp(x + drift[0]), clamp(y + drift[1]));
    };
    push(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
      const [x0, y0] = points[index - 1];
      const [x1, y1] = points[index];
      const pieces = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let piece = 1; piece <= pieces; piece += 1) push(x0 + ((x1 - x0) * piece) / pieces, y0 + ((y1 - y0) * piece) / pieces);
    }
    // A closed shape ends exactly where it started, so no colour leaks out.
    if (closed && p.length >= 4) { p[p.length - 2] = p[0]; p[p.length - 1] = p[1]; }
    if (total + p.length / 2 > MAX_POINTS) break;
    total += p.length / 2;
    out.push({ w: width, c: colour, p });
  }
  return cleanStrokes(fillsThatStayInside(out));
}

// The page's paint bucket floods everything of the tapped colour that is connected to the tap.
// If an outline has a gap, that's the whole background: a ruined drawing. So the drawing is
// replayed here on a small grid (2 units a cell, pens as round brushes of their real width,
// the same colour tolerance as the page), and a fill that would reach the edge of the pad or
// cover more than a third of it is left out.
const GRID = 500;
const CELL = CANVAS_SIZE / GRID;
const PEN_WIDTHS = [9, 24, 60]; // the page's widths, in grid units of the 1000 pad
const FILL_TOLERANCE = 64;

export function fillsThatStayInside(strokes) {
  const red = new Uint8Array(GRID * GRID).fill(255);
  const green = new Uint8Array(GRID * GRID).fill(255);
  const blue = new Uint8Array(GRID * GRID).fill(255);
  const rgbOf = (hex) => [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
  const paint = (cell, [r, g, b]) => { red[cell] = r; green[cell] = g; blue[cell] = b; };
  const stamp = (cx, cy, radius, colour) => {
    const r2 = radius * radius;
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(GRID - 1, Math.ceil(cy + radius)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(GRID - 1, Math.ceil(cx + radius)); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) paint(y * GRID + x, colour);
      }
    }
  };
  const kept = [];
  for (const stroke of strokes) {
    const colour = rgbOf(stroke.c);
    if (stroke.f === 1) {
      const x0 = Math.min(GRID - 1, Math.floor(stroke.p[0] / CELL));
      const y0 = Math.min(GRID - 1, Math.floor(stroke.p[1] / CELL));
      const seed = y0 * GRID + x0;
      const [sr, sg, sb] = [red[seed], green[seed], blue[seed]];
      if (Math.max(Math.abs(sr - colour[0]), Math.abs(sg - colour[1]), Math.abs(sb - colour[2])) <= 8) continue;
      const matches = (cell) => Math.abs(red[cell] - sr) <= FILL_TOLERANCE && Math.abs(green[cell] - sg) <= FILL_TOLERANCE && Math.abs(blue[cell] - sb) <= FILL_TOLERANCE;
      const region = new Uint8Array(GRID * GRID);
      const stack = [seed];
      region[seed] = 1;
      let size = 0;
      let leaks = false;
      while (stack.length) {
        const cell = stack.pop();
        size += 1;
        const x = cell % GRID;
        const y = (cell - x) / GRID;
        if (x === 0 || y === 0 || x === GRID - 1 || y === GRID - 1) leaks = true;
        for (const next of [x > 0 ? cell - 1 : -1, x < GRID - 1 ? cell + 1 : -1, y > 0 ? cell - GRID : -1, y < GRID - 1 ? cell + GRID : -1]) {
          if (next >= 0 && !region[next] && matches(next)) { region[next] = 1; stack.push(next); }
        }
      }
      if (leaks || size > (GRID * GRID) / 3) continue;
      for (let cell = 0; cell < region.length; cell += 1) if (region[cell]) paint(cell, colour);
      kept.push(stroke);
      continue;
    }
    const radius = PEN_WIDTHS[stroke.w] / 2 / CELL;
    for (let index = 0; index < stroke.p.length; index += 2) {
      const x = stroke.p[index] / CELL;
      const y = stroke.p[index + 1] / CELL;
      if (index === 0) { stamp(x, y, radius, colour); continue; }
      const px = stroke.p[index - 2] / CELL;
      const py = stroke.p[index - 1] / CELL;
      const pieces = Math.max(1, Math.ceil(Math.hypot(x - px, y - py)));
      for (let piece = 1; piece <= pieces; piece += 1) stamp(px + ((x - px) * piece) / pieces, py + ((y - py) * piece) / pieces, radius, colour);
    }
    kept.push(stroke);
  }
  return kept;
}

async function draw(ctx) {
  if (ctx.method !== "POST") throw new GameError(405, "Method not allowed.");
  const { prompt, image, model } = parseInput(ctx.body);
  const apiKey = ctx.env?.ANTHROPIC_API_KEY;
  if (!apiKey) throw new GameError(503, "The drawing helper isn't set up yet.", { setup: true });

  // A few drawings a day are plenty (each one costs a little).
  const day = zurichDay();
  const used = await ctx.storage.transaction(async (txn) => {
    const usage = normalizeUsage(await txn.get(KEY), day);
    if (usage.count >= PER_DAY) throw new GameError(429, "That's enough magic for today. Try again tomorrow.");
    usage.count += 1;
    await txn.put(KEY, usage);
    return usage.count;
  });

  const text = image
    ? `Draw the main subject of this photo as a cute illustrated doodle.${prompt ? ` Notes: ${prompt}` : ""}`
    : `Draw: ${prompt}`;

  try {
    const strokes = await ask(apiKey, model, image, text);
    return { strokes, left: Math.max(0, PER_DAY - used) };
  } catch (error) {
    // A drawing that failed doesn't count toward today's limit.
    await ctx.storage.transaction(async (txn) => {
      const usage = normalizeUsage(await txn.get(KEY), day);
      usage.count = Math.max(0, usage.count - 1);
      await txn.put(KEY, usage);
    });
    throw error;
  }
}

async function ask(apiKey, model, image, text) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  content.push({ type: "text", text });
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 240_000 });
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 20000, // under the SDK's limit for a request without streaming
      // Opus: a declined drawing is retried on another model by the API itself.
      ...(model === MODELS.opus ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      // High effort: it plans the drawing before it draws (prettier, takes a little longer).
      output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
      system: SYSTEM,
      messages: [{ role: "user", content }]
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new GameError(503, "The drawing helper's key doesn't work.", { setup: true });
    if (error instanceof Anthropic.RateLimitError) throw new GameError(429, "The helper is busy. Try again in a minute.");
    if (error instanceof Anthropic.BadRequestError) throw new GameError(400, "The helper couldn't use that. Try a different photo or words.");
    if (error instanceof Anthropic.APIError) throw new GameError(502, "The helper couldn't draw right now. Try again.");
    throw new GameError(502, "The helper couldn't be reached. Try again.");
  }
  if (response.stop_reason === "refusal") throw new GameError(422, "The helper won't draw that one. Try something else.");
  if (response.stop_reason === "max_tokens") throw new GameError(502, "That got too detailed. Try something simpler.");
  const answer = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  let parsed;
  try { parsed = JSON.parse(answer); } catch { throw new GameError(502, "The helper's drawing came back broken. Try again."); }
  return handDrawn(parsed?.strokes);
}

export const routes = {
  "/games/doodle/ai": draw
};
