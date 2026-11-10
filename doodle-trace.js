/* Photo tracing for the daily doodle (Dee's phone only, used by doodle.js).
   Turns a photo into strokes that look drawn by a finger: it finds the outlines (edges),
   follows them as ink lines with a little wobble, and colours areas in with back-and-forth
   brush scribbles in the pad's own colours. Everything happens on the phone; nothing is sent.

   window.DoodleTrace.trace(image, options) → [{ w, c, p: [x, y, ...] }, ...] on a 1000 grid
     image:   { width, height, data } (ImageData, at most ~260 px on the long side)
     options: { detail: 0 | 1 | 2 (simple, normal, lots), colour: true | false, seed } */
(function () {
  const SIZE = 1000;
  const SPAN = 900;            // the drawing fills this much of the pad
  const MAX_STROKES = 390;     // a little under the Worker's limits
  const MAX_POINTS = 7600;
  const INK = "#29252f";
  // The pad's colours that colouring may use (ink and white are left out: dark areas are
  // shown by the outlines, white is the paper).
  const FILL_COLOURS = [
    "#8e8a96", "#e5483f", "#dc4f83", "#f7b5c8", "#f28b30", "#f2c641",
    "#8fd16a", "#2e9e83", "#9dd5f5", "#3f7fd8", "#8a5cd1", "#8b5a3c"
  ];
  const DETAIL = [
    { blur: 4, top: 0.035, minLength: 22, maxLines: 60, pen: 1 },   // simple
    { blur: 2, top: 0.075, minLength: 10, maxLines: 130, pen: 0 },  // normal
    { blur: 1, top: 0.11, minLength: 7, maxLines: 220, pen: 0 }     // lots
  ];

  
  function random(seed) {
    let state = (seed >>> 0) || 1;
    return () => {
      state ^= state << 13; state >>>= 0;
      state ^= state >>> 17;
      state ^= state << 5; state >>>= 0;
      return state / 4294967296;
    };
  }

  function gray(image) {
    const { width, height, data } = image;
    const out = new Float32Array(width * height);
    for (let i = 0; i < out.length; i += 1) {
      out[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    }
    return out;
  }

  // 1-2-1 blur, `rounds` times (softens noise and texture so only real outlines stay).
  function blur(values, width, height, rounds) {
    let src = values;
    for (let round = 0; round < rounds; round += 1) {
      const tmp = new Float32Array(src.length);
      const dst = new Float32Array(src.length);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const l = src[y * width + Math.max(0, x - 1)];
          const r = src[y * width + Math.min(width - 1, x + 1)];
          tmp[y * width + x] = (l + 2 * src[y * width + x] + r) / 4;
        }
      }
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const u = tmp[Math.max(0, y - 1) * width + x];
          const d = tmp[Math.min(height - 1, y + 1) * width + x];
          dst[y * width + x] = (u + 2 * tmp[y * width + x] + d) / 4;
        }
      }
      src = dst;
    }
    return src;
  }

  // Outlines: Sobel edges, thinned to one pixel, kept where strong (or weak but touching strong).
  function edges(values, width, height, settings) {
    const magnitude = new Float32Array(width * height);
    const direction = new Uint8Array(width * height);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const at = (dx, dy) => values[(y + dy) * width + x + dx];
        const gx = at(1, -1) + 2 * at(1, 0) + at(1, 1) - at(-1, -1) - 2 * at(-1, 0) - at(-1, 1);
        const gy = at(-1, 1) + 2 * at(0, 1) + at(1, 1) - at(-1, -1) - 2 * at(0, -1) - at(1, -1);
        const index = y * width + x;
        magnitude[index] = Math.hypot(gx, gy);
        const angle = ((Math.atan2(gy, gx) * 180) / Math.PI + 180) % 180;
        direction[index] = angle < 22.5 || angle >= 157.5 ? 0 : angle < 67.5 ? 1 : angle < 112.5 ? 2 : 3;
      }
    }
    // Thin: keep a pixel only where it is the strongest across the edge.
    const thin = new Float32Array(width * height);
    const across = [[1, 0], [1, 1], [0, 1], [-1, 1]];
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        const [dx, dy] = across[direction[index]];
        const value = magnitude[index];
        if (value >= magnitude[index + dy * width + dx] && value >= magnitude[index - dy * width - dx]) thin[index] = value;
      }
    }
    // Strong = the top share of all pixels (so it adapts to each photo), weak = less than half.
    const sorted = Array.from(thin).filter((value) => value > 0).sort((a, b) => b - a);
    const strongAt = Math.min(sorted.length - 1, Math.floor(width * height * settings.top));
    const high = Math.max(40, sorted[Math.max(0, strongAt)] || 0);
    const low = high * 0.45;
    const edge = new Uint8Array(width * height);
    const stack = [];
    for (let i = 0; i < thin.length; i += 1) {
      if (thin[i] >= high) { edge[i] = 1; stack.push(i); }
    }
    while (stack.length) {
      const index = stack.pop();
      const x = index % width;
      const y = (index - x) / width;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!edge[next] && thin[next] >= low) { edge[next] = 1; stack.push(next); }
        }
      }
    }
    return edge;
  }

  // Follows the edge pixels into lines (each pixel used once).
  function chains(edge, width, height) {
    const used = new Uint8Array(edge.length);
    const ring = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
    const walk = (start, line) => {
      let index = start;
      let last = -1;
      for (;;) {
        const x = index % width;
        const y = (index - x) / width;
        let best = -1;
        let bestK = -1;
        let bestTurn = 9;
        for (let k = 0; k < 8; k += 1) {
          const nx = x + ring[k][0];
          const ny = y + ring[k][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (!edge[next] || used[next]) continue;
          // Prefer going straight on.
          const turn = last < 0 ? 0 : Math.min((k - last + 8) % 8, (last - k + 8) % 8);
          if (turn < bestTurn) { best = next; bestK = k; bestTurn = turn; }
        }
        if (best < 0) return;
        last = bestK;
        used[best] = 1;
        line.push([best % width, Math.floor(best / width)]);
        index = best;
      }
    };
    const lines = [];
    for (let i = 0; i < edge.length; i += 1) {
      if (!edge[i] || used[i]) continue;
      used[i] = 1;
      const forward = [[i % width, Math.floor(i / width)]];
      walk(i, forward);
      const backward = [];
      walk(i, backward);
      lines.push([...backward.reverse(), ...forward]);
    }
    return lines;
  }

  // Ramer–Douglas–Peucker: fewer points, same shape.
  function simplify(points, epsilon) {
    if (points.length < 3) return points;
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
      for (let i = a + 1; i < b; i += 1) {
        const [px, py] = points[i];
        const distance = Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
        if (distance > farDistance) { far = i; farDistance = distance; }
      }
      if (far >= 0) {
        keep[far] = 1;
        stack.push([a, far], [far, b]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }

  // Rounds corners a little (one Chaikin pass), keeping both ends.
  function soften(points) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 0; i < points.length - 1; i += 1) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      out.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1], [0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
    }
    out.push(points[points.length - 1]);
    return out;
  }

  // Picks a pad colour the way a person would: by hue, with light and dark variants, and
  // brighter than the photo (doodles are cheerful). Returns an index into FILL_COLOURS, or -1
  // for paper (white, very light grey) and for very dark areas (the ink outlines show those).
  const PAD = Object.fromEntries(FILL_COLOURS.map((hex, index) => [hex, index]));
  const C = {
    grey: PAD["#8e8a96"], red: PAD["#e5483f"], pink: PAD["#dc4f83"], lightpink: PAD["#f7b5c8"],
    orange: PAD["#f28b30"], yellow: PAD["#f2c641"], lightgreen: PAD["#8fd16a"], green: PAD["#2e9e83"],
    skyblue: PAD["#9dd5f5"], blue: PAD["#3f7fd8"], purple: PAD["#8a5cd1"], brown: PAD["#8b5a3c"]
  };
  function padColour(r, g, b) {
    const max = Math.max(r, g, b) / 255;
    const min = Math.min(r, g, b) / 255;
    const light = (max + min) / 2;
    const chroma = max - min;
    const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * light - 1));
    if (light < 0.16) return -1;
    if (saturation < 0.2 || chroma < 0.1) {
      if (light > 0.72) return -1;
      return light > 0.3 ? C.grey : -1;
    }
    let hue;
    const R = r / 255; const G = g / 255; const B = b / 255;
    if (max === R) hue = 60 * (((G - B) / chroma) % 6);
    else if (max === G) hue = 60 * ((B - R) / chroma + 2);
    else hue = 60 * ((R - G) / chroma + 4);
    if (hue < 0) hue += 360;
    if (light > 0.86) return -1;
    if (hue < 14 || hue >= 340) return light > 0.72 ? C.lightpink : light < 0.3 ? C.brown : C.red;
    if (hue < 42) return light < 0.3 || (saturation < 0.3 && light < 0.45) ? C.brown : light > 0.75 ? C.yellow : C.orange;
    if (hue < 68) return light < 0.3 ? C.brown : C.yellow;
    if (hue < 105) return light > 0.45 ? C.lightgreen : C.green;
    if (hue < 170) return light > 0.6 ? C.lightgreen : C.green;
    if (hue < 205) return light > 0.5 ? C.skyblue : C.blue;
    if (hue < 255) return light > 0.65 ? C.skyblue : C.blue;
    if (hue < 290) return C.purple;
    return light > 0.7 ? C.lightpink : C.pink;
  }

  // Colouring in: one row of brush strokes every `rowStep` grid units. Each row is split into
  // runs of one colour; a run continues the stroke of the row above when they overlap, so the
  // colour goes back and forth like a scribble. Paper-white areas and the background are left.
  function colouring(image, place, scale, rand) {
    const { width, height, data } = image;
    const rowStep = 40;
    const colStep = 14;
    const rows = Math.max(1, Math.floor((height * scale) / rowStep));
    const cols = Math.max(1, Math.floor((width * scale) / colStep));
    // Average colour of each cell → a pad colour, or -1 for paper (very light or very grey-white).
    const cell = (cx, cy) => {
      const x0 = Math.floor((cx * colStep) / scale);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * colStep) / scale));
      const y0 = Math.floor((cy * rowStep) / scale);
      const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * rowStep) / scale));
      let r = 0; let g = 0; let b = 0; let n = 0;
      for (let y = y0; y < Math.min(height, y1); y += 1) {
        for (let x = x0; x < Math.min(width, x1); x += 1) {
          const i = (y * width + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
        }
      }
      if (!n) return -1;
      return padColour(r / n, g / n, b / n);
    };
    const grid = [];
    for (let cy = 0; cy < rows; cy += 1) {
      const row = [];
      for (let cx = 0; cx < cols; cx += 1) row.push(cell(cx, cy));
      // Smooth single odd cells away (noise).
      for (let cx = 1; cx < cols - 1; cx += 1) if (row[cx - 1] === row[cx + 1] && row[cx] !== row[cx - 1]) row[cx] = row[cx - 1];
      grid.push(row);
    }
    // The background: the most common colour along the border, when it covers most of it.
    const border = new Map();
    let borderCount = 0;
    const count = (value) => { borderCount += 1; if (value >= 0) border.set(value, (border.get(value) || 0) + 1); };
    for (let cx = 0; cx < cols; cx += 1) { count(grid[0][cx]); count(grid[rows - 1][cx]); }
    for (let cy = 0; cy < rows; cy += 1) { count(grid[cy][0]); count(grid[cy][cols - 1]); }
    // The background: colours that cover a good part of the photo's border are left out.
    const background = new Set();
    for (const [value, n] of border) if (n > borderCount * 0.28) background.add(value);

    const finished = [];
    let open = new Map(); // colour → { stroke, from, to } of the previous row
    for (let cy = 0; cy < rows; cy += 1) {
      const next = new Map();
      const y = (cy + 0.5) * rowStep;
      let cx = 0;
      while (cx < cols) {
        const value = grid[cy][cx];
        let end = cx;
        while (end + 1 < cols && grid[cy][end + 1] === value) end += 1;
        const from = cx * colStep + 12;
        const to = (end + 1) * colStep - 12;
        cx = end + 1;
        if (value < 0 || background.has(value) || to - from < 26) continue;
        const colour = FILL_COLOURS[value];
        const above = open.get(colour);
        const wobble = () => (rand() - 0.5) * 10;
        let stroke;
        if (above && from < above.to && to > above.from && !next.has(colour)) {
          stroke = above.stroke;
          // Continue from the side the last row ended on: back and forth.
          const goingRight = above.endedLeft;
          const [ax, bx] = goingRight ? [from, to] : [to, from];
          stroke.points.push(place(ax + wobble(), y + wobble(), true), place(bx + wobble(), y + wobble(), true));
          next.set(colour, { stroke, from, to, endedLeft: !goingRight });
          open.delete(colour);
        } else {
          stroke = { colour, points: [place(from + wobble(), y + wobble(), true), place(to + wobble(), y + wobble(), true)] };
          finished.push(stroke);
          if (!next.has(colour)) next.set(colour, { stroke, from, to, endedLeft: false });
        }
      }
      open = next;
    }
    return finished.map((stroke) => ({ w: 2, c: stroke.colour, points: stroke.points }));
  }

  function trace(image, options = {}) {
    const settings = DETAIL[Math.max(0, Math.min(2, Number(options.detail) || 0))] || DETAIL[1];
    const rand = random(options.seed ?? Date.now());
    const { width, height } = image;
    const scale = SPAN / Math.max(width, height);
    const offsetX = (SIZE - width * scale) / 2;
    const offsetY = (SIZE - height * scale) / 2;
    // `grid` true: x and y are already in grid units relative to the picture's corner.
    const place = (x, y, grid = false) => (grid
      ? [offsetX + x, offsetY + y]
      : [offsetX + x * scale, offsetY + y * scale]);

    // Outlines, longest first (the long ones carry the shape).
    const edge = edges(blur(gray(image), width, height, settings.blur), width, height, settings);
    const lines = chains(edge, width, height)
      .filter((line) => line.length >= settings.minLength)
      .sort((a, b) => b.length - a.length)
      .slice(0, settings.maxLines)
      .map((line) => soften(simplify(line, 0.9)).map(([x, y]) => place(x, y)));

    const fills = options.colour === false ? [] : colouring(image, place, scale, rand);

    // Hand-drawn feel: each point drifts a little, the drift changes slowly along the line.
    const out = [];
    let points = 0;
    const add = (w, c, list, amplitude) => {
      if (out.length >= MAX_STROKES || list.length < 2) return;
      if (points + list.length > MAX_POINTS) return;
      let dx = 0;
      let dy = 0;
      const p = [];
      for (const [x, y] of list) {
        dx = dx * 0.8 + (rand() - 0.5) * amplitude;
        dy = dy * 0.8 + (rand() - 0.5) * amplitude;
        p.push(Math.max(0, Math.min(SIZE, Math.round(x + dx))), Math.max(0, Math.min(SIZE, Math.round(y + dy))));
      }
      out.push({ w, c, p });
      points += list.length;
    };
    // Colouring first (under the lines), but never at the cost of the outlines.
    const linePoints = lines.reduce((sum, line) => sum + line.length, 0);
    const fillBudget = Math.max(0, MAX_POINTS - linePoints);
    let fillPoints = 0;
    for (const fill of fills) {
      if (fillPoints + fill.points.length > fillBudget || out.length >= MAX_STROKES - lines.length) continue;
      fillPoints += fill.points.length;
      add(2, fill.c, fill.points, 4);
    }
    // The longest lines with the chosen pen; short details always thin.
    lines.forEach((line, index) => add(index < 10 ? settings.pen : 0, INK, line, 2.5));
    return out;
  }

  window.DoodleTrace = { trace };
})();
