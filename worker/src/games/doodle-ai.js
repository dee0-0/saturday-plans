// The drawing helper for the daily doodle (Dee's phone only): turns a few words or a photo
// into a clean, cute drawing. Claude draws it as simple SVG line art; the Worker turns that
// into pad strokes and paint-bucket fills (doodle-svg.js), shows Claude how it came out on the
// pad, and Claude fixes what looks off in a second pass. The page then draws it onto the pad
// stroke by stroke; from there it is an ordinary drawing (undo, add lines, send).
// Uses Claude (Opus or Sonnet, picked on the page) through the Anthropic SDK, with the Worker
// secret ANTHROPIC_API_KEY.
import Anthropic from "@anthropic-ai/sdk";
import { GameError, zurichDay } from "./common.js";
import { PALETTE, MAX_STROKES, MAX_POINTS, CANVAS_SIZE, cleanStrokes } from "./doodle.js";
import { svgToSteps, Raster, toBase64, tapSpots, insideAny } from "./doodle-svg.js";

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
const PEN_WIDTHS = [9, 24, 60]; // the page's pen widths, in pad units
const NAMES = { ...COLOURS, black: COLOURS.ink };
const COLOUR_LIST = Object.entries(COLOURS).map(([name, hex]) => `${hex} (${name})`).join(", ");

const SYSTEM = `You are a professional illustrator. You draw the requested subject as clean, cute (kawaii) line art, like a page from a high-quality children's colouring book or a sticker: smooth confident curves, consistent line weight, an appealing character design and charming details.

Reply with one SVG and nothing else: <svg viewBox="0 0 1000 1000" xmlns="http://www.w3.org/2000/svg"> ... </svg>.
- Use only path (any commands, curves encouraged), circle, ellipse, line, polyline, polygon and g (with transform if you like). No text, gradients, filters, masks, clip paths, images, classes or CSS.
- Give every shape stroke and fill attributes. Lines are ink, #29252f, stroke-width 9 (the pad's fine pen): one even line weight everywhere gives the clean colouring-book look. Use stroke-width 24 (the bold pen) only for a simple, chunky subject that needs it, and 60 only for a soft wide accent. Other widths are rounded to these.
- Colours, only these: ${COLOUR_LIST}.

How the drawing is made on the pad, which matters for fills: every shape's outline is drawn as a pen line, and its fill is then poured in with a paint bucket, which colours the area enclosed by lines (like colouring in a colouring book). So:
- A filled shape must be closed. Areas are separated by lines, not by painting over: do not rely on a later shape hiding an earlier one. Draw only what is visible (for a character sitting in a cup, draw the cup in front and only the visible part of the body above and around it).
- Keep it mostly line art on white, with a few soft fills for charm (pink cheeks, a coloured heart, dark pupils with white highlight circles on top) — unless the request asks for a fully coloured picture.

Quality bar: it should look like a polished illustration a person would be proud to post. Plan the composition first. One clear main subject, large and centred (about 80 to 920 on both axes), good proportions (big head, large glossy eyes with highlights, small nose and mouth), a clean silhouette, and a few details that suit the theme (little hearts, sparkles, steam curls, spots, a texture line). Typically 40 to 150 shapes.

With a photo: draw its main subject in this style, keeping the pose, the key features and the feel, simplified; leave out the background clutter.`;

const REVIEW = `Here is your drawing as it came out on the drawing pad: your SVG drawn with the pad's pens, and the fills poured in with the paint bucket (a fill that would have leaked out through a gap was left out). Look at it critically, like an art director: fix anything that looks wrong, messy or off: gaps in outlines, missing or leaked fills, lines crossing through faces, parts in the wrong place or size, weak proportions, clutter, anything that doesn't read clearly. Keep what already works. Reply with the complete improved SVG only.`;

const widthFor = (strokeWidth) => (strokeWidth >= 40 ? 2 : strokeWidth >= 15 ? 1 : 0);

// Ramer–Douglas–Peucker: fewer points, same line (used only when a drawing is too detailed).
function simplify(points, epsilon) {
  if (points.length < 3 || epsilon <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const length = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1;
    let farDistance = epsilon;
    for (let index = a + 1; index < b; index += 1) {
      const [px, py] = points[index];
      const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (distance > farDistance) { far = index; farDistance = distance; }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([a, far], [far, b]);
    }
  }
  return points.filter((_, index) => keep[index]);
}

// Pad steps → the page's strokes: within the stroke and point limits (simplifying lines only
// when needed), a very light wobble so it still looks hand-made, closed shapes closed exactly,
// and fills replayed on the grid so any that would leak are dropped. Returns the strokes and
// the replayed grid (for the picture shown back to Claude).
export function finishDrawing(steps, seed = Date.now()) {
  const random = randomFrom(seed);
  let lines = steps.filter((step) => !step.fill).slice(0, MAX_STROKES - 20);
  if (!lines.length) throw new GameError(502, "The helper drew nothing. Try different words.");
  const budget = MAX_POINTS - 400;
  let epsilon = 0;
  const count = () => lines.reduce((sum, line) => sum + line.points.length, 0);
  while (count() > budget && epsilon < 40) {
    epsilon = epsilon ? epsilon * 1.6 : 0.6;
    lines = lines.map((line) => ({ ...line, points: simplify(line.original || line.points, epsilon), original: line.original || line.points }));
  }
  const kept = new Set(lines.map((line) => line.original || line.points));
  const raster = new Raster(500, PEN_WIDTHS);
  const out = [];
  let total = 0;
  for (const step of steps) {
    if (out.length >= MAX_STROKES) break;
    if (step.fill) {
      if (total + 1 > MAX_POINTS) continue;
      // Tap where the shape is open paper (or an earlier colour), never on a line; keep the
      // first spot whose paint stays inside the shape.
      const inside = (point) => insideAny(point, step.rings);
      let tries = 0;
      for (const spot of tapSpots(step.rings)) {
        if (spot.clearance < 6 || raster.onLine(spot.point[0], spot.point[1])) continue;
        const stroke = { f: 1, c: step.colour, p: [clamp(spot.point[0]), clamp(spot.point[1])] };
        if (raster.fill(stroke, { inside })) { out.push(stroke); total += 1; break; }
        if (++tries >= 4) break;
      }
      continue;
    }
    const line = lines.find((item) => (item.original || item.points) === step.points);
    if (!line || !kept.has(step.points)) continue;
    const amplitude = step.width === 2 ? 1.5 : 0.7;
    let drift = [0, 0];
    const p = [];
    for (const [x, y] of line.points) {
      drift = [drift[0] * 0.85 + (random() - 0.5) * amplitude, drift[1] * 0.85 + (random() - 0.5) * amplitude];
      p.push(clamp(x + drift[0]), clamp(y + drift[1]));
    }
    if (p.length === 2) p.push(p[0], p[1]);
    if (step.closed && p.length >= 4) { p[p.length - 2] = p[0]; p[p.length - 1] = p[1]; }
    if (total + p.length / 2 > MAX_POINTS) continue;
    const stroke = { w: step.width, c: step.colour, p };
    raster.line(stroke);
    out.push(stroke);
    total += p.length / 2;
  }
  return { strokes: cleanStrokes(out), raster };
}

export function drawingFromSvg(svg, seed) {
  const steps = svgToSteps(svg, { palette: PALETTE, names: NAMES, widthFor });
  return finishDrawing(steps, seed);
}

const svgIn = (response) => {
  const text = response.content.filter((block) => block.type === "text").map((block) => block.text).join("");
  return text.match(/<svg\b[\s\S]*<\/svg>/i)?.[0] || "";
};

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
  const request = (messages, effort) => client.beta.messages.create({
    model,
    max_tokens: 20000, // under the SDK's limit for a request without streaming
    // Opus: a declined drawing is retried on another model by the API itself.
    ...(model === MODELS.opus ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } : {}),
    output_config: { effort },
    system: SYSTEM,
    messages
  });
  const failure = (error) => {
    if (error instanceof GameError) return error;
    if (error instanceof Anthropic.AuthenticationError) return new GameError(503, "The drawing helper's key doesn't work.", { setup: true });
    if (error instanceof Anthropic.RateLimitError) return new GameError(429, "The helper is busy. Try again in a minute.");
    if (error instanceof Anthropic.BadRequestError) return new GameError(400, "The helper couldn't use that. Try a different photo or words.");
    if (error instanceof Anthropic.APIError) return new GameError(502, "The helper couldn't draw right now. Try again.");
    return new GameError(502, "The helper couldn't be reached. Try again.");
  };

  // First pass: plan and draw (high effort).
  const messages = [{ role: "user", content }];
  let first;
  try { first = await request(messages, "high"); } catch (error) { throw failure(error); }
  if (first.stop_reason === "refusal") throw new GameError(422, "The helper won't draw that one. Try something else.");
  if (first.stop_reason === "max_tokens") throw new GameError(502, "That got too detailed. Try something simpler.");
  let drawing;
  try { drawing = drawingFromSvg(svgIn(first)); } catch { throw new GameError(502, "The helper's drawing came back broken. Try again."); }

  // Second pass: it sees the drawing as it came out on the pad and fixes what looks off.
  // If that goes wrong, the first drawing is still good to use.
  try {
    const png = toBase64(await drawing.raster.png());
    const second = await request([
      ...messages,
      { role: "assistant", content: first.content },
      { role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
        { type: "text", text: REVIEW }
      ] }
    ], "medium");
    if (second.stop_reason === "end_turn") {
      const better = drawingFromSvg(svgIn(second));
      if (better.strokes.length >= Math.min(8, drawing.strokes.length)) drawing = better;
    }
  } catch { /* keep the first drawing */ }
  return drawing.strokes;
}

export const routes = {
  "/games/doodle/ai": draw
};
