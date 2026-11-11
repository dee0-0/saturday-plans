// Helpers for the doodle drawing helper (doodle-ai.js):
// - svgToSteps: reads the simple SVG that Claude draws (paths, circles, ellipses, lines,
//   polylines, polygons, groups, transforms) and turns it into pad steps: pen lines through
//   the shapes' outlines, and paint-bucket fills at a point well inside each filled shape.
// - Raster: replays pad strokes and fills on a small grid the way the page paints them, so a
//   fill that would leak can be dropped, and so the result can be shown back to Claude as a PNG.

/* ------------------------------- Colours -------------------------------- */
const NAMED = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff",
  yellow: "#ffff00", orange: "#ffa500", pink: "#ffc0cb", purple: "#800080", brown: "#a52a2a",
  grey: "#808080", gray: "#808080", lightpink: "#ffb6c1", hotpink: "#ff69b4", skyblue: "#87ceeb",
  lightblue: "#add8e6", lightgreen: "#90ee90", gold: "#ffd700", beige: "#f5f5dc", tan: "#d2b48c"
};

export function rgbOf(hex) {
  return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

// A CSS colour (hex, rgb(), a name, or one of the pad's names) → the nearest pad colour, or
// null for none / transparent.
export function padColour(value, palette, names) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text || text === "none" || text === "transparent") return null;
  if (names[text]) return names[text];
  let rgb = null;
  const hex = text.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    rgb = rgbOf(`#${digits}`);
  }
  const fn = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (fn) rgb = [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  if (!rgb && NAMED[text]) rgb = rgbOf(NAMED[text]);
  if (!rgb) return null;
  let best = palette[0];
  let bestDistance = Infinity;
  for (const colour of palette) {
    const [r, g, b] = rgbOf(colour);
    const mean = (rgb[0] + r) / 2;
    const distance = (2 + mean / 256) * (rgb[0] - r) ** 2 + 4 * (rgb[1] - g) ** 2 + (2 + (255 - mean) / 256) * (rgb[2] - b) ** 2;
    if (distance < bestDistance) { best = colour; bestDistance = distance; }
  }
  return best;
}

/* ------------------------------ Transforms ------------------------------ */
// 2D affine matrices as [a, b, c, d, e, f] (x' = a x + c y + e, y' = b x + d y + f).
const IDENTITY = [1, 0, 0, 1, 0, 0];
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]
];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

function parseTransform(text) {
  let matrix = IDENTITY;
  if (!text) return matrix;
  for (const [, name, args] of text.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const n = (args.match(/-?[\d.]+(?:e-?\d+)?/gi) || []).map(Number);
    let next = IDENTITY;
    if (name === "translate") next = [1, 0, 0, 1, n[0] || 0, n[1] || 0];
    else if (name === "scale") next = [n[0] ?? 1, 0, 0, n[1] ?? n[0] ?? 1, 0, 0];
    else if (name === "rotate") {
      const angle = ((n[0] || 0) * Math.PI) / 180;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      next = [cos, sin, -sin, cos, 0, 0];
      if (n.length >= 3) next = multiply(multiply([1, 0, 0, 1, n[1], n[2]], next), [1, 0, 0, 1, -n[1], -n[2]]);
    } else if (name === "matrix" && n.length >= 6) next = n.slice(0, 6);
    else if (name === "skewX") next = [1, 0, Math.tan(((n[0] || 0) * Math.PI) / 180), 1, 0, 0];
    else if (name === "skewY") next = [1, Math.tan(((n[0] || 0) * Math.PI) / 180), 0, 1, 0, 0];
    matrix = multiply(matrix, next);
  }
  return matrix;
}

/* ------------------------------ Path data ------------------------------- */
// Splits path data into subpaths of points (curves flattened to short straight pieces).
function flattenPath(d, step = 8) {
  const tokens = String(d).match(/[a-df-z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || [];
  const subpaths = [];
  let current = null;
  let x = 0; let y = 0; let startX = 0; let startY = 0;
  let lastControl = null; let lastCommand = "";
  let index = 0;
  const number = () => Number(tokens[index++]);
  const hasNumber = () => index < tokens.length && !/^[a-z]$/i.test(tokens[index]);
  const lineTo = (nx, ny) => { current.points.push([nx, ny]); x = nx; y = ny; };
  const pieces = (length) => Math.max(2, Math.min(60, Math.ceil(length / step)));
  const cubic = (x1, y1, x2, y2, ex, ey) => {
    const n = pieces(Math.hypot(x1 - x, y1 - y) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(ex - x2, ey - y2));
    const [sx, sy] = [x, y];
    for (let i = 1; i <= n; i += 1) {
      const t = i / n; const u = 1 - t;
      current.points.push([
        u * u * u * sx + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * ex,
        u * u * u * sy + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * ey
      ]);
    }
    x = ex; y = ey;
  };
  const quad = (x1, y1, ex, ey) => {
    const n = pieces(Math.hypot(x1 - x, y1 - y) + Math.hypot(ex - x1, ey - y1));
    const [sx, sy] = [x, y];
    for (let i = 1; i <= n; i += 1) {
      const t = i / n; const u = 1 - t;
      current.points.push([u * u * sx + 2 * u * t * x1 + t * t * ex, u * u * sy + 2 * u * t * y1 + t * t * ey]);
    }
    x = ex; y = ey;
  };
  const arc = (rx, ry, rotation, large, sweep, ex, ey) => {
    // Endpoint to centre parametrisation (SVG spec, appendix F.6).
    if (!rx || !ry) { lineTo(ex, ey); return; }
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (rotation * Math.PI) / 180;
    const cos = Math.cos(phi); const sin = Math.sin(phi);
    const dx = (x - ex) / 2; const dy = (y - ey) / 2;
    const x1 = cos * dx + sin * dy; const y1 = -sin * dx + cos * dy;
    const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
    const sign = large === sweep ? -1 : 1;
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const coef = sign * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cx1 = (coef * rx * y1) / ry; const cy1 = (-coef * ry * x1) / rx;
    const cx = cos * cx1 - sin * cy1 + (x + ex) / 2;
    const cy = sin * cx1 + cos * cy1 + (y + ey) / 2;
    const angle = (ux, uy, vx, vy) => {
      const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
      return a;
    };
    const start = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
    let delta = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
    if (!sweep && delta > 0) delta -= 2 * Math.PI;
    if (sweep && delta < 0) delta += 2 * Math.PI;
    const n = pieces(Math.abs(delta) * Math.max(rx, ry));
    for (let i = 1; i <= n; i += 1) {
      const t = start + (delta * i) / n;
      const px = rx * Math.cos(t); const py = ry * Math.sin(t);
      current.points.push([cos * px - sin * py + cx, sin * px + cos * py + cy]);
    }
    x = ex; y = ey;
  };
  while (index < tokens.length) {
    let command = tokens[index];
    if (/^[a-z]$/i.test(command)) index += 1;
    else if (lastCommand) command = lastCommand === "M" ? "L" : lastCommand === "m" ? "l" : lastCommand;
    else break;
    const rel = command === command.toLowerCase();
    const upper = command.toUpperCase();
    const ox = rel ? x : 0; const oy = rel ? y : 0;
    if (upper === "Z") {
      if (current) { current.points.push([startX, startY]); current.closed = true; }
      x = startX; y = startY;
      current = null;
      lastCommand = command; lastControl = null;
      continue;
    }
    if (!hasNumber()) { lastCommand = ""; continue; }
    if (upper === "M") {
      const nx = number() + ox; const ny = number() + oy;
      current = { points: [[nx, ny]], closed: false };
      subpaths.push(current);
      x = startX = nx; y = startY = ny;
      lastControl = null;
    } else {
      if (!current) { current = { points: [[x, y]], closed: false }; subpaths.push(current); startX = x; startY = y; }
      if (upper === "L") { lineTo(number() + ox, number() + oy); lastControl = null; }
      else if (upper === "H") { lineTo(number() + ox, y); lastControl = null; }
      else if (upper === "V") { lineTo(x, number() + (rel ? y : 0)); lastControl = null; }
      else if (upper === "C") {
        const x1 = number() + ox; const y1 = number() + oy; const x2 = number() + ox; const y2 = number() + oy;
        const ex = number() + ox; const ey = number() + oy;
        cubic(x1, y1, x2, y2, ex, ey); lastControl = ["C", x2, y2];
      } else if (upper === "S") {
        const [rx1, ry1] = lastControl?.[0] === "C" ? [2 * x - lastControl[1], 2 * y - lastControl[2]] : [x, y];
        const x2 = number() + ox; const y2 = number() + oy; const ex = number() + ox; const ey = number() + oy;
        cubic(rx1, ry1, x2, y2, ex, ey); lastControl = ["C", x2, y2];
      } else if (upper === "Q") {
        const x1 = number() + ox; const y1 = number() + oy; const ex = number() + ox; const ey = number() + oy;
        quad(x1, y1, ex, ey); lastControl = ["Q", x1, y1];
      } else if (upper === "T") {
        const [x1, y1] = lastControl?.[0] === "Q" ? [2 * x - lastControl[1], 2 * y - lastControl[2]] : [x, y];
        const ex = number() + ox; const ey = number() + oy;
        quad(x1, y1, ex, ey); lastControl = ["Q", x1, y1];
      } else if (upper === "A") {
        const rx = number(); const ry = number(); const rotation = number();
        const large = number() ? 1 : 0; const sweep = number() ? 1 : 0;
        arc(rx, ry, rotation, large, sweep, number() + ox, number() + oy); lastControl = null;
      } else { index += 1; }
    }
    lastCommand = command;
    if (subpaths.length > 600) break;
  }
  return subpaths.filter((sub) => sub.points.length >= 2 && sub.points.every(([px, py]) => Number.isFinite(px) && Number.isFinite(py)));
}

function ellipsePoints(cx, cy, rx, ry, step = 8) {
  const n = Math.max(12, Math.min(90, Math.ceil((2 * Math.PI * Math.max(rx, ry)) / step)));
  return Array.from({ length: n + 1 }, (_, i) => [cx + rx * Math.cos((i / n) * 2 * Math.PI), cy + ry * Math.sin((i / n) * 2 * Math.PI)]);
}

/* ------------------------------ Geometry ------------------------------- */
function insideAny(point, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
      if ((yi > point[1]) !== (yj > point[1]) && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

function distanceToRings(point, rings) {
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 1; i < ring.length; i += 1) {
      const [ax, ay] = ring[i - 1]; const [bx, by] = ring[i];
      const lx = bx - ax; const ly = by - ay;
      const t = Math.max(0, Math.min(1, ((point[0] - ax) * lx + (point[1] - ay) * ly) / (lx * lx + ly * ly || 1)));
      best = Math.min(best, Math.hypot(point[0] - (ax + t * lx), point[1] - (ay + t * ly)));
    }
  }
  return best;
}

// Candidate spots for the paint bucket inside a shape: points inside it, best first (the
// furthest from its outline). The caller skips spots that are on a line on the pad.
export function tapSpots(rings, n = 18) {
  const all = rings.flat();
  const xs = all.map((p) => p[0]); const ys = all.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const spots = [];
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      const p = [minX + ((maxX - minX) * (i + 0.5)) / (n + 1), minY + ((maxY - minY) * (j + 0.5)) / (n + 1)];
      if (insideAny(p, rings)) spots.push({ point: p, clearance: distanceToRings(p, rings) });
    }
  }
  return spots.sort((a, b) => b.clearance - a.clearance);
}

export { insideAny };

/* ------------------------------- SVG --------------------------------- */
function attributes(text) {
  const out = {};
  for (const [, name, , value1, value2] of text.matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) out[name.toLowerCase()] = value1 ?? value2 ?? "";
  // style="stroke: ...; fill: ..." wins over attributes, as in browsers.
  if (out.style) {
    for (const part of out.style.split(";")) {
      const [key, ...rest] = part.split(":");
      if (key && rest.length) out[key.trim().toLowerCase()] = rest.join(":").trim();
    }
  }
  return out;
}

const INHERITED = ["stroke", "fill", "stroke-width"];

// Returns pad steps in drawing order: { colour, width, closed, points } pen lines and
// { fill: true, colour, at } bucket taps, on the 1000 x 1000 pad.
export function svgToSteps(svg, { palette, names, widthFor }) {
  const text = String(svg || "");
  const open = text.match(/<svg\b[^>]*>/i);
  let view = [0, 0, 1000, 1000];
  if (open) {
    const vb = attributes(open[0]).viewbox?.split(/[\s,]+/).map(Number);
    if (vb?.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) view = vb;
  }
  // Fit the viewBox onto the pad, keeping its proportions.
  const fit = Math.min(1000 / view[2], 1000 / view[3]);
  const base = [fit, 0, 0, fit, (1000 - view[2] * fit) / 2 - view[0] * fit, (1000 - view[3] * fit) / 2 - view[1] * fit];

  const steps = [];
  const stack = [{ matrix: base, style: { stroke: "none", fill: "black", "stroke-width": "1" } }];
  for (const [whole, closing, rawName, rest] of text.matchAll(/<(\/?)([a-zA-Z]+)\b([^>]*)>/g)) {
    const name = rawName.toLowerCase();
    if (["defs", "clippath", "mask", "pattern", "lineargradient", "radialgradient", "style", "text", "title"].includes(name)) continue;
    if (closing) {
      if (name === "g" || name === "svg") { if (stack.length > 1) stack.pop(); }
      continue;
    }
    const attrs = attributes(rest);
    const parent = stack[stack.length - 1];
    const style = { ...parent.style };
    for (const key of INHERITED) if (attrs[key] !== undefined) style[key] = attrs[key];
    const matrix = multiply(parent.matrix, parseTransform(attrs.transform));
    const selfClosing = /\/\s*$/.test(rest) || whole.endsWith("/>");
    if (name === "g" || name === "svg") {
      if (!selfClosing) stack.push({ matrix, style });
      continue;
    }
    let subpaths = [];
    const num = (key, fallback = 0) => (Number.isFinite(parseFloat(attrs[key])) ? parseFloat(attrs[key]) : fallback);
    if (name === "path") subpaths = flattenPath(attrs.d);
    else if (name === "circle") subpaths = [{ points: ellipsePoints(num("cx"), num("cy"), num("r"), num("r")), closed: true }];
    else if (name === "ellipse") subpaths = [{ points: ellipsePoints(num("cx"), num("cy"), num("rx"), num("ry")), closed: true }];
    else if (name === "rect") {
      const x = num("x"); const y = num("y"); const w = num("width"); const h = num("height");
      subpaths = [{ points: [[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]], closed: true }];
    } else if (name === "line") subpaths = [{ points: [[num("x1"), num("y1")], [num("x2"), num("y2")]], closed: false }];
    else if (name === "polyline" || name === "polygon") {
      const n = (attrs.points || "").match(/-?[\d.]+(?:e-?\d+)?/gi)?.map(Number) || [];
      const points = [];
      for (let i = 0; i + 1 < n.length; i += 2) points.push([n[i], n[i + 1]]);
      if (name === "polygon" && points.length) points.push(points[0]);
      subpaths = [{ points, closed: name === "polygon" }];
    } else continue;

    const scale = Math.sqrt(Math.abs(matrix[0] * matrix[3] - matrix[1] * matrix[2])) || 1;
    const placed = subpaths
      .map((sub) => ({ closed: sub.closed, points: sub.points.map((p) => apply(matrix, p)) }))
      .filter((sub) => sub.points.length >= 2);
    if (!placed.length) continue;
    const strokeColour = padColour(style.stroke, palette, names);
    const fillColour = padColour(style.fill, palette, names);
    const strokeWidth = (parseFloat(style["stroke-width"]) || 1) * scale;
    const closedRings = placed.filter((sub) => sub.closed || (sub.points.length > 2
      && Math.hypot(sub.points[0][0] - sub.points.at(-1)[0], sub.points[0][1] - sub.points.at(-1)[1]) < 3)).map((sub) => sub.points);
    // A filled shape without a stroke still needs an edge for the bucket: its own colour, thin.
    const lineColour = strokeColour || (fillColour && closedRings.length ? fillColour : null);
    if (!lineColour) continue;
    const width = strokeColour ? widthFor(strokeWidth) : 0;
    for (const sub of placed) steps.push({ colour: lineColour, width, closed: closedRings.includes(sub.points), points: sub.points });
    // Where the bucket taps is chosen later, on the pad as drawn so far (see tapSpots).
    if (fillColour && closedRings.length) steps.push({ fill: true, colour: fillColour, rings: closedRings });
    if (steps.length > 900) break;
  }
  return steps;
}

/* ------------------------------- Raster ------------------------------- */
// The pad, replayed on a grid (2 pad units a cell) with the page's pen widths and paint
// bucket rules.
export class Raster {
  constructor(size = 500, penWidths = [9, 24, 60], tolerance = 64) {
    this.size = size;
    this.cell = 1000 / size;
    this.penWidths = penWidths;
    this.tolerance = tolerance;
    this.red = new Uint8Array(size * size).fill(255);
    this.green = new Uint8Array(size * size).fill(255);
    this.blue = new Uint8Array(size * size).fill(255);
    this.lines = new Uint8Array(size * size); // cells covered by a pen line
  }

  // Is the pad at (x, y) (pad units) under a pen line?
  onLine(x, y) {
    const cx = Math.min(this.size - 1, Math.max(0, Math.floor(x / this.cell)));
    const cy = Math.min(this.size - 1, Math.max(0, Math.floor(y / this.cell)));
    return this.lines[cy * this.size + cx] === 1;
  }

  paint(cell, [r, g, b]) { this.red[cell] = r; this.green[cell] = g; this.blue[cell] = b; }

  stamp(cx, cy, radius, colour, mark = true) {
    const { size } = this;
    const r2 = radius * radius;
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(size - 1, Math.ceil(cy + radius)); y += 1) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(size - 1, Math.ceil(cx + radius)); x += 1) {
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r2) {
          this.paint(y * size + x, colour);
          if (mark) this.lines[y * size + x] = 1;
        }
      }
    }
  }

  line(stroke) {
    const colour = rgbOf(stroke.c);
    const radius = Math.max(0.7, this.penWidths[stroke.w] / 2 / this.cell);
    const { cell } = this;
    for (let index = 0; index < stroke.p.length; index += 2) {
      const x = stroke.p[index] / cell;
      const y = stroke.p[index + 1] / cell;
      if (index === 0) { this.stamp(x, y, radius, colour); continue; }
      const px = stroke.p[index - 2] / cell;
      const py = stroke.p[index - 1] / cell;
      const pieces = Math.max(1, Math.ceil(Math.hypot(x - px, y - py)));
      for (let piece = 1; piece <= pieces; piece += 1) this.stamp(px + ((x - px) * piece) / pieces, py + ((y - py) * piece) / pieces, radius, colour);
    }
  }

  // Returns false (and paints nothing) when the fill would leak: reach the pad's edge, cover
  // more than `maxShare` of it, or (with `inside`, a test in pad units) spill noticeably
  // outside the shape it is meant for.
  fill(stroke, { maxShare = 1 / 3, inside = null } = {}) {
    const { size, red, green, blue, tolerance } = this;
    const colour = rgbOf(stroke.c);
    const x0 = Math.min(size - 1, Math.max(0, Math.floor(stroke.p[0] / this.cell)));
    const y0 = Math.min(size - 1, Math.max(0, Math.floor(stroke.p[1] / this.cell)));
    const seed = y0 * size + x0;
    const [sr, sg, sb] = [red[seed], green[seed], blue[seed]];
    if (Math.max(Math.abs(sr - colour[0]), Math.abs(sg - colour[1]), Math.abs(sb - colour[2])) <= 8) return false;
    const matches = (cell) => Math.abs(red[cell] - sr) <= tolerance && Math.abs(green[cell] - sg) <= tolerance && Math.abs(blue[cell] - sb) <= tolerance;
    const region = new Uint8Array(size * size);
    const stack = [seed];
    region[seed] = 1;
    let count = 0;
    let outside = 0;
    while (stack.length) {
      const cell = stack.pop();
      count += 1;
      const x = cell % size;
      const y = (cell - x) / size;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) return false;
      if (count > size * size * maxShare) return false;
      if (inside && (cell % 7 === 0) && !inside([(x + 0.5) * this.cell, (y + 0.5) * this.cell])) outside += 7;
      for (const next of [cell - 1, cell + 1, cell - size, cell + size]) {
        if (!region[next] && matches(next)) { region[next] = 1; stack.push(next); }
      }
    }
    if (inside && outside > count * 0.15 + 40) return false;
    // Like the page: one extra cell around the area covers the soft edges of the lines.
    for (let cell = 0; cell < region.length; cell += 1) {
      if (region[cell] !== 1) continue;
      for (const near of [cell - 1, cell + 1, cell - size, cell + size]) if (near >= 0 && near < region.length && !region[near]) region[near] = 2;
    }
    for (let cell = 0; cell < region.length; cell += 1) if (region[cell]) this.paint(cell, colour);
    return true;
  }

  // A PNG of the grid (zlib through CompressionStream, which Workers and Node both have).
  async png() {
    const { size } = this;
    const raw = new Uint8Array((size * 3 + 1) * size);
    for (let y = 0; y < size; y += 1) {
      const row = y * (size * 3 + 1);
      raw[row] = 0;
      for (let x = 0; x < size; x += 1) {
        const cell = y * size + x;
        raw[row + 1 + x * 3] = this.red[cell];
        raw[row + 2 + x * 3] = this.green[cell];
        raw[row + 3 + x * 3] = this.blue[cell];
      }
    }
    const compressed = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
    const chunk = (type, data) => {
      const out = new Uint8Array(12 + data.length);
      const view = new DataView(out.buffer);
      view.setUint32(0, data.length);
      for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8);
      view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
      return out;
    };
    const header = new Uint8Array(13);
    const hv = new DataView(header.buffer);
    hv.setUint32(0, size); hv.setUint32(4, size);
    header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
    const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", compressed), chunk("IEND", new Uint8Array(0))];
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const png = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { png.set(part, at); at += part.length; }
    return png;
  }
}

let CRC_TABLE = null;
function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function toBase64(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
