// The drawing helper for the daily doodle (Dee's phone only): turns a few words or a photo
// into pen strokes that look like a quick finger drawing. The page draws them onto the pad
// stroke by stroke; from there it is an ordinary drawing (undo, add lines, send).
// Two ways to draw: Claude through the Anthropic SDK when the Worker secret ANTHROPIC_API_KEY
// is set, otherwise Cloudflare's own AI (the free daily allowance of Workers AI, binding AI).
import Anthropic from "@anthropic-ai/sdk";
import { GameError, zurichDay } from "./common.js";
import { PALETTE, MAX_STROKES, MAX_POINTS, CANVAS_SIZE, cleanStrokes } from "./doodle.js";

const KEY = "games:doodle:helper";
const MODEL = "claude-opus-5-5";
const CF_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct"; // reads photos too
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
  return { prompt, image };
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
  const { prompt, image } = parseInput(ctx.body);
  const apiKey = ctx.env?.ANTHROPIC_API_KEY;
  const ai = ctx.env?.AI;
  if (!apiKey && !ai) throw new GameError(503, "The drawing helper isn't set up yet.", { setup: true });

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
    const strokes = apiKey ? await ask(apiKey, image, text) : await askCloudflare(ai, image, text);
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

async function ask(apiKey, image, text) {
  const content = [];
  if (image) content.push({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.data } });
  content.push({ type: "text", text });
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 150_000 });
  let response;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
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

/* ----------------------- Cloudflare's Workers AI (free) ----------------------- */
// The free models are poor at placing hundreds of points, but good at naming simple shapes
// ("a circle here, a curve there"). So they answer with shapes; the Worker turns those into
// pen strokes, scales the drawing to fill the pad and gives it the same hand-drawn wobble.
// Free up to a daily allowance; past it the call fails until the next day (free plan).
const CF_TEXT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const SHAPE_KINDS = ["circle", "ellipse", "arc", "line", "curve", "polygon", "dot"];
const COLOUR_NAMES = Object.keys(COLOURS);
const SHAPES_SCHEMA = {
  type: "object",
  properties: {
    shapes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: SHAPE_KINDS },
          color: { type: "string", enum: COLOUR_NAMES },
          fill: { type: "string", enum: ["none", ...COLOUR_NAMES] },
          size: { type: "string", enum: ["thin", "thick"] },
          x: { type: "number" }, y: { type: "number" },
          r: { type: "number" }, rx: { type: "number" }, ry: { type: "number" },
          from: { type: "number" }, to: { type: "number" },
          points: { type: "array", items: { type: "array", items: { type: "number" } } }
        },
        required: ["kind", "color", "size"]
      }
    }
  },
  required: ["shapes"]
};

const CF_SYSTEM = `You draw cute, simple doodles for a phone drawing game, made of basic shapes.
Canvas 1000 x 1000: x goes right, y goes DOWN, (0,0) is the top-left, the centre is (500,500).
Shapes ("kind"):
- circle: x, y = centre, r = radius
- ellipse: x, y = centre, rx, ry = half width and half height
- arc: x, y, r, from, to = part of a circle in degrees (0 = right, 90 = down, 180 = left, 270 = up), e.g. a smile is from 20 to 160
- line: points = [[x1,y1],[x2,y2]]
- curve: points = 3 to 8 [x,y] points the line passes through, smoothly
- polygon: points = 3 to 10 corners, closed
- dot: x, y (a small round dot, e.g. an eye)
Each shape has color (outline), size (thin or thick) and fill (a colour to colour it in, or "none"). Fill works for circle, ellipse and polygon.
Rules: build the subject from 6 to 25 shapes. Big shapes first, details (eyes, smiles, patterns) last, placed INSIDE the shape they belong to. Make it big: the subject should span most of the canvas (about 150 to 850). Use ink for most outlines, a few cheerful fills. No text.
Example, "a cat": {"shapes":[
{"kind":"ellipse","x":500,"y":650,"rx":200,"ry":170,"color":"ink","size":"thick","fill":"orange"},
{"kind":"circle","x":500,"y":380,"r":150,"color":"ink","size":"thick","fill":"orange"},
{"kind":"polygon","points":[[380,300],[360,170],[460,250]],"color":"ink","size":"thick","fill":"orange"},
{"kind":"polygon","points":[[620,300],[640,170],[540,250]],"color":"ink","size":"thick","fill":"orange"},
{"kind":"dot","x":445,"y":370,"color":"ink","size":"thick","fill":"none"},
{"kind":"dot","x":555,"y":370,"color":"ink","size":"thick","fill":"none"},
{"kind":"polygon","points":[[485,410],[515,410],[500,428]],"color":"ink","size":"thin","fill":"pink"},
{"kind":"arc","x":500,"y":425,"r":40,"from":20,"to":160,"color":"ink","size":"thin","fill":"none"},
{"kind":"line","points":[[420,420],[330,400]],"color":"ink","size":"thin","fill":"none"},
{"kind":"line","points":[[580,420],[670,400]],"color":"ink","size":"thin","fill":"none"},
{"kind":"curve","points":[[690,700],[800,640],[820,520],[770,470]],"color":"ink","size":"thick","fill":"none"}]}
Answer with JSON only, in exactly that format.`;

// Numbers from the model, kept in a sane range (a wild value must never blow up the work).
const num = (value, fallback) => (Number.isFinite(Number(value)) ? Math.max(-3000, Math.min(4000, Number(value))) : fallback);
const pairs = (list) => (Array.isArray(list) ? list : [])
  .filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1])))
  .map(([x, y]) => [num(x, 500), num(y, 500)])
  .slice(0, 40);

function ring(cx, cy, rx, ry, from = 0, to = 360) {
  const span = Math.max(-360, Math.min(360, to - from));
  const count = Math.max(8, Math.round((48 * Math.abs(span)) / 360));
  return Array.from({ length: count + 1 }, (_, index) => {
    const angle = ((from + (span * index) / count) * Math.PI) / 180;
    return [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)];
  });
}

// Rounds the corners of a few points into a smooth line (Chaikin), keeping both ends.
function smooth(points, rounds = 3) {
  let out = points;
  for (let round = 0; round < rounds && out.length > 2; round += 1) {
    const next = [out[0]];
    for (let index = 0; index < out.length - 1; index += 1) {
      const [x0, y0] = out[index];
      const [x1, y1] = out[index + 1];
      next.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

// Colouring in like on a phone: back-and-forth brush strokes across the shape, row by row.
function scribble(outline, step = 34) {
  const ys = outline.map((point) => point[1]);
  const top = Math.min(...ys) + step * 0.45;
  const bottom = Math.max(...ys) - step * 0.45;
  const zigzag = [];
  let flip = false;
  for (let y = top; y <= bottom; y += step) {
    const crossings = [];
    for (let index = 0; index < outline.length; index += 1) {
      const [x0, y0] = outline[index];
      const [x1, y1] = outline[(index + 1) % outline.length];
      if ((y0 <= y && y1 > y) || (y1 <= y && y0 > y)) crossings.push(x0 + ((y - y0) / (y1 - y0)) * (x1 - x0));
    }
    if (crossings.length < 2) continue;
    const left = Math.min(...crossings) + 10;
    const right = Math.max(...crossings) - 10;
    if (right <= left) continue;
    zigzag.push(flip ? [right, y] : [left, y], flip ? [left, y] : [right, y]);
    flip = !flip;
  }
  return zigzag.length >= 2 ? zigzag : null;
}

// Shapes → strokes in the model format ({ color, size, points }) that handDrawn understands.
// The outlines are scaled to fill the pad first, so the colouring rows and dots keep their size.
export function shapesToStrokes(shapes) {
  const items = [];
  for (const shape of (Array.isArray(shapes) ? shapes : []).slice(0, 60)) {
    const color = COLOURS[shape?.color] ? shape.color : "ink";
    const size = shape?.size === "thin" ? "thin" : "thick";
    const fill = COLOURS[shape?.fill] ? shape.fill : null;
    const x = num(shape?.x, 500);
    const y = num(shape?.y, 500);
    let points = null;
    let closed = false;
    switch (shape?.kind) {
      case "circle": {
        const r = Math.max(4, Math.abs(num(shape.r, 60)));
        points = ring(x, y, r, r); closed = true; break;
      }
      case "ellipse": {
        const rx = Math.max(4, Math.abs(num(shape.rx, num(shape.r, 80))));
        const ry = Math.max(4, Math.abs(num(shape.ry, num(shape.r, 50))));
        points = ring(x, y, rx, ry); closed = true; break;
      }
      case "arc": {
        const r = Math.max(4, Math.abs(num(shape.r, 60)));
        points = ring(x, y, r, r, num(shape.from, 20), num(shape.to, 160)); break;
      }
      case "dot":
        points = [[x, y]]; break;
      case "line": {
        const list = pairs(shape.points);
        if (list.length >= 2) points = list; break;
      }
      case "curve": {
        const list = pairs(shape.points);
        if (list.length >= 2) points = smooth(list); break;
      }
      case "polygon": {
        const list = pairs(shape.points);
        if (list.length >= 3) { points = [...list, list[0]]; closed = true; } break;
      }
      default: break;
    }
    if (points) items.push({ kind: shape.kind, color, size, fill: closed ? fill : null, points });
  }
  const place = fitter(items.flatMap((item) => item.points));
  const out = [];
  for (const item of items) {
    const points = item.points.map(place);
    // Colouring goes right before its own outline, so the outline sits on top.
    const zigzag = item.fill ? scribble(points) : null;
    if (zigzag) out.push({ color: item.fill, size: "brush", points: zigzag });
    // A dot (an eye, a button) is a short dab of the thick pen.
    if (item.kind === "dot") out.push({ color: item.color, size: "thick", points: [[points[0][0] - 3, points[0][1] - 2], [points[0][0] + 3, points[0][1] + 2]] });
    else out.push({ color: item.color, size: item.size, points });
  }
  return out;
}

// Scales and centres the whole drawing to fill the pad (small models often draw tiny or off-centre).
function fitter(all) {
  if (!all.length) return (point) => point;
  const xs = all.map((point) => point[0]);
  const ys = all.map((point) => point[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  const scale = Math.min(800 / Math.max(width, height, 1), 3.5);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
  const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  return ([px, py]) => [500 + (px - cx) * scale, 500 + (py - cy) * scale];
}

// Finds the JSON object in a model's text answer: allows a code fence or words around it,
// // comments and trailing commas. Returns null when there is none.
export function looseJson(text) {
  if (text && typeof text === "object") return text;
  if (typeof text !== "string") return null;
  const start = text.indexOf("{");
  if (start < 0) return null;
  // The matching closing brace (strings respected), or the end when it was cut off.
  let depth = 0;
  let inString = false;
  let end = text.length;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) { end = index + 1; break; }
    }
  }
  const body = text.slice(start, end)
    .replace(/\/\/[^\n]*/g, "")
    .replace(/,\s*([}\]])/g, "$1");
  try { return JSON.parse(body); } catch { /* try once more below */ }
  // Cut off mid-way: keep the shapes that are complete.
  const cut = body.lastIndexOf("}");
  if (cut > 0) {
    try { return JSON.parse(`${body.slice(0, cut + 1)}]}`); } catch { /* give up */ }
  }
  return null;
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("The helper took too long.")), ms); })
  ]).finally(() => clearTimeout(timer));
}

async function askCloudflare(ai, image, text) {
  const messages = [{ role: "system", content: CF_SYSTEM }];
  if (image) {
    messages.push({ role: "user", content: [
      { type: "text", text: `${text} Look at the main subject, then draw it with simple shapes.` },
      { type: "image_url", image_url: { url: `data:${image.mediaType};base64,${image.data}` } }
    ] });
  } else {
    messages.push({ role: "user", content: text });
  }
  // A free model sometimes answers in a broken way: one more try costs nothing.
  let lastAnswer = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let result;
    try {
      result = await withTimeout(ai.run(image ? CF_MODEL : CF_TEXT_MODEL, {
        messages,
        response_format: { type: "json_schema", json_schema: SHAPES_SCHEMA },
        max_tokens: 1600,
        temperature: attempt ? 0.3 : 0.5
      }), 45_000);
    } catch (error) {
      const message = String(error?.message || error);
      if (/4006|daily free allocation|neurons/i.test(message)) throw new GameError(429, "Today's free drawings are used up. Try again tomorrow.");
      if (attempt === 0) continue;
      throw new GameError(502, "The helper couldn't draw right now. Try again.", { detail: message.slice(0, 200) });
    }
    const parsed = looseJson(result?.response);
    const shapes = Array.isArray(parsed?.shapes) ? parsed.shapes : Array.isArray(parsed) ? parsed : null;
    if (shapes?.length) return handDrawn(shapesToStrokes(shapes));
    lastAnswer = typeof result?.response === "string" ? result.response : JSON.stringify(result?.response ?? result);
  }
  throw new GameError(502, "The helper's drawing came back broken. Try again.", { detail: String(lastAnswer).slice(0, 300) });
}

export const routes = {
  "/games/doodle/ai": draw
};
