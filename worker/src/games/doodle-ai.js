// The drawing helper for the daily doodle (Dee's phone only): turns a few words or a photo
// into pen strokes that look like a quick finger drawing. The page draws them onto the pad
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

const SCHEMA = {
  type: "object",
  properties: {
    strokes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          color: { type: "string", enum: Object.keys(COLOURS) },
          size: { type: "string", enum: Object.keys(SIZES) },
          points: { type: "array", items: { type: "array", items: { type: "integer" } } }
        },
        required: ["color", "size", "points"],
        additionalProperties: false
      }
    }
  },
  required: ["strokes"],
  additionalProperties: false
};

const SYSTEM = `You draw doodles for a two-player drawing game on a phone. The other player must believe a person drew it with a finger, so it has to look hand-made, not computer-made.

Canvas: 1000 x 1000, x to the right, y down, origin top-left. Each stroke is one finger movement: a colour, a size (thin, thick, or brush for colouring in) and a list of [x, y] points that the pen passes through in order.

Style:
- Simple, cute and recognisable, like someone drew it in about two minutes. Slightly lopsided shapes, a bit wobbly, never perfectly straight or symmetric, no geometric precision.
- Outline the main shapes in ink (thin or thick), then add a few details.
- Colour some areas the way people colour on a phone: scribble back and forth inside the shape with the brush size, staying roughly (not perfectly) inside the outline. Draw those scribbles before the ink outline of that shape, so the outline sits on top.
- Use only a few colours. White only on top of other colours (for example a highlight).
- Keep the drawing large and centred, roughly between 80 and 920 on both axes.
- 15 to 70 strokes; 3 to 40 points per stroke, about 15 to 60 units apart. Close shapes by ending near where they started.
- No text, letters or numbers unless the subject itself is writing.`;

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

// Turns the model's strokes into the page's format, then makes them look drawn by hand:
// extra points along each line (so curves render smooth), a gentle wobble that drifts
// rather than jitters, and a little overshoot at the ends. Stays within the doodle limits.
export function handDrawn(raw, seed = Date.now()) {
  const random = randomFrom(seed);
  const strokes = [];
  for (const stroke of Array.isArray(raw) ? raw : []) {
    const colour = COLOURS[stroke?.color];
    const width = SIZES[stroke?.size];
    const points = (Array.isArray(stroke?.points) ? stroke.points : [])
      .filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]))
      .map(([x, y]) => [clamp(x), clamp(y)]);
    if (!colour || width === undefined || !points.length) continue;
    strokes.push({ colour, width, points });
    if (strokes.length >= MAX_STROKES) break;
  }
  if (!strokes.length) throw new GameError(502, "The helper drew nothing. Try different words.");
  const raws = strokes.reduce((sum, stroke) => sum + stroke.points.length, 0);
  // Point spacing that keeps the whole drawing under the point limit.
  const length = strokes.reduce((sum, stroke) => sum + stroke.points.reduce((acc, point, index) => (
    index ? acc + Math.hypot(point[0] - stroke.points[index - 1][0], point[1] - stroke.points[index - 1][1]) : acc
  ), 0), 0);
  const budget = Math.max(raws, MAX_POINTS - 200);
  const step = Math.max(10, length / Math.max(1, budget - raws));
  let total = 0;
  const out = [];
  for (const { colour, width, points } of strokes) {
    const amplitude = width === 2 ? 6 : 3.5;
    let drift = [0, 0];
    const p = [];
    const push = (x, y) => {
      drift = [drift[0] * 0.8 + (random() - 0.5) * amplitude, drift[1] * 0.8 + (random() - 0.5) * amplitude];
      p.push(clamp(x + drift[0]), clamp(y + drift[1]));
    };
    push(points[0][0], points[0][1]);
    for (let index = 1; index < points.length; index += 1) {
      const [x0, y0] = points[index - 1];
      const [x1, y1] = points[index];
      const pieces = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let piece = 1; piece <= pieces; piece += 1) push(x0 + ((x1 - x0) * piece) / pieces, y0 + ((y1 - y0) * piece) / pieces);
    }
    // A short overshoot past the last point, as a finger does when it lifts.
    if (points.length > 1) {
      const [xa, ya] = points[points.length - 2];
      const [xb, yb] = points[points.length - 1];
      const dist = Math.hypot(xb - xa, yb - ya) || 1;
      const over = 4 + random() * 8;
      push(xb + ((xb - xa) / dist) * over, yb + ((yb - ya) / dist) * over);
    }
    if (total + p.length / 2 > MAX_POINTS) break;
    total += p.length / 2;
    out.push({ w: width, c: colour, p });
  }
  return cleanStrokes(out);
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
    ? `Draw a simple doodle of this picture, as a person would draw it from looking at it.${prompt ? ` Notes: ${prompt}` : ""}`
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
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 150_000 });
  let response;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      // Opus: a declined drawing is retried on another model by the API itself.
      ...(model === MODELS.opus ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
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
