/**
 * Cut-contour geometry — pure, dependency-free, deterministic.
 *
 * This is the part of Nate's WePrintWraps walkthrough ("How to output cut
 * contour graphics") that Illustrator does by hand, done on a raster:
 *
 *   Pathfinder → Unite        = the outer silhouette of every element   (traceBoundaries)
 *   swap fill/stroke, 0.25 pt = the cut line is a stroke, never a fill  (pdf.ts / svg)
 *   Object → Path → Offset    = the 1/4" bleed that extends the artwork  (dilate + bleedRing)
 *   nesting on one sheet      = every graphic packed within 51.5"        (shelfPack)
 *   Type → Create Outlines    = free: a traced silhouette IS vector shape
 *
 * Plain .mjs so the same code runs under Deno (the edge function) and under
 * node (tests/cut-contour-geometry.test.mjs) with no bundling. All pixel
 * buffers are typed arrays; nothing here allocates per pixel.
 */

const INF = 1e20;

// ── Mask ────────────────────────────────────────────────────────────────────

/**
 * Art pixels: opaque enough AND not the white background the flat artwork is
 * generated on. Returns a Uint8Array of 0/1.
 */
export function maskFromRgba(data, width, height, { alphaMin = 64, whiteMin = 238 } = {}) {
  const mask = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    const a = data[p + 3];
    if (a < alphaMin) continue;
    const r = data[p], g = data[p + 1], b = data[p + 2];
    if (r >= whiteMin && g >= whiteMin && b >= whiteMin) continue;
    mask[i] = 1;
  }
  return mask;
}

// ── Euclidean distance transform (Felzenszwalb & Huttenlocher, O(N)) ────────

function dt1d(f, n, d, src, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    src[q] = v[k];
  }
}

/**
 * Distance from every pixel to the nearest pixel where `mask` is 1, plus the
 * index of that nearest pixel. `dist` is Euclidean (not squared). Pixels that
 * are themselves 1 have dist 0 and nearest = self.
 */
export function edt(mask, width, height) {
  const n = width * height;
  const g = new Float64Array(n);          // squared column distance
  const rowNearest = new Int32Array(n);   // nearest feature row within the column
  // Phase 1: columns.
  for (let x = 0; x < width; x++) {
    let last = -1;
    for (let y = 0; y < height; y++) {
      const i = y * width + x;
      if (mask[i]) { last = y; g[i] = 0; rowNearest[i] = y; }
      else if (last >= 0) { const dy = y - last; g[i] = dy * dy; rowNearest[i] = last; }
      else { g[i] = INF; rowNearest[i] = -1; }
    }
    last = -1;
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x;
      if (mask[i]) { last = y; }
      else if (last >= 0) { const dy = last - y; const d2 = dy * dy; if (d2 < g[i]) { g[i] = d2; rowNearest[i] = last; } }
    }
  }
  // Phase 2: rows.
  const dist = new Float32Array(n);
  const nearest = new Int32Array(n);
  const f = new Float64Array(width), d = new Float64Array(width), src = new Int32Array(width);
  const v = new Int32Array(width), z = new Float64Array(width + 1);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) f[x] = g[row + x];
    dt1d(f, width, d, src, v, z);
    for (let x = 0; x < width; x++) {
      const i = row + x;
      dist[i] = d[x] >= INF ? Infinity : Math.sqrt(d[x]);
      const nx = src[x];
      const ny = rowNearest[row + nx];
      nearest[i] = ny < 0 ? -1 : ny * width + nx;
    }
  }
  return { dist, nearest };
}

export function invertMask(mask) {
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] ? 0 : 1;
  return out;
}

/** Grow the mask by `radius` pixels (Euclidean disc). */
export function dilate(mask, width, height, radius, precomputed) {
  const { dist } = precomputed || edt(mask, width, height);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = dist[i] <= radius ? 1 : 0;
  return out;
}

/** Shrink the mask by `radius` pixels. */
export function erode(mask, width, height, radius) {
  const { dist } = edt(invertMask(mask), width, height);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < out.length; i++) out[i] = mask[i] && dist[i] > radius ? 1 : 0;
  return out;
}

/** Morphological close: seals anti-alias gaps between letters' strokes. */
export function closeMask(mask, width, height, radius) {
  if (radius <= 0) return mask;
  return erode(dilate(mask, width, height, radius), width, height, radius);
}

// ── Connected components + grouping into elements ───────────────────────────

/**
 * 8-connected components. Returns { labels: Int32Array (0 = background),
 * components: [{ id, area, minX, minY, maxX, maxY }] } with specks below
 * `minArea` pixels removed from both.
 */
export function components(mask, width, height, minArea = 0) {
  const labels = new Int32Array(width * height);
  const comps = [];
  const stack = new Int32Array(width * height);
  let next = 0;
  for (let start = 0; start < labels.length; start++) {
    if (!mask[start] || labels[start]) continue;
    next++;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = next;
    let area = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    while (sp > 0) {
      const i = stack[--sp];
      const x = i % width, y = (i - x) / width;
      area++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const j = ny * width + nx;
          if (mask[j] && !labels[j]) { labels[j] = next; stack[sp++] = j; }
        }
      }
    }
    comps.push({ id: next, area, minX, minY, maxX, maxY });
  }
  if (minArea > 0) {
    const keep = new Uint8Array(next + 1);
    for (const c of comps) if (c.area >= minArea) keep[c.id] = 1;
    for (let i = 0; i < labels.length; i++) if (labels[i] && !keep[labels[i]]) labels[i] = 0;
    return { labels, components: comps.filter((c) => keep[c.id]) };
  }
  return { labels, components: comps };
}

/**
 * Letters of one word, or a logo and its wordmark, are separate components
 * that belong to one cut element. Components whose bounding boxes lie within
 * `gap` pixels of each other — or within `relative` × the smaller box height,
 * which is how letter spacing scales with type size — are grouped
 * (union-find, transitive).
 */
export function groupComponents(comps, gap, relative = 0) {
  const parent = comps.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const boxGap = (a, b) => {
    const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
    const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
    return Math.hypot(dx, dy);
  };
  for (let i = 0; i < comps.length; i++) {
    for (let j = i + 1; j < comps.length; j++) {
      const hi = comps[i].maxY - comps[i].minY + 1, hj = comps[j].maxY - comps[j].minY + 1;
      if (boxGap(comps[i], comps[j]) <= Math.max(gap, relative * Math.min(hi, hj))) {
        const a = find(i), b = find(j);
        if (a !== b) parent[a] = b;
      }
    }
  }
  const groups = new Map();
  comps.forEach((c, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { components: [], area: 0, minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY });
    const g = groups.get(r);
    g.components.push(c);
    g.area += c.area;
    g.minX = Math.min(g.minX, c.minX); g.minY = Math.min(g.minY, c.minY);
    g.maxX = Math.max(g.maxX, c.maxX); g.maxY = Math.max(g.maxY, c.maxY);
  });
  // Reading order: top-to-bottom, then left-to-right, so element numbering is stable.
  return [...groups.values()].sort((a, b) => (a.minY - b.minY) || (a.minX - b.minX));
}

/** Copy a rectangular window of a mask (or labels filtered to a set of ids). */
export function cropMask(mask, width, x0, y0, w, h, labels, ids) {
  const out = new Uint8Array(w * h);
  const allowed = ids ? new Set(ids) : null;
  for (let y = 0; y < h; y++) {
    const srcRow = (y0 + y) * width + x0;
    const dstRow = y * w;
    for (let x = 0; x < w; x++) {
      const i = srcRow + x;
      out[dstRow + x] = mask[i] && (!allowed || allowed.has(labels[i])) ? 1 : 0;
    }
  }
  return out;
}

// ── Boundary tracing (Pathfinder → Unite, on pixels) ────────────────────────

/**
 * Every closed boundary between art and non-art, as polygons on the pixel
 * grid: outer silhouettes AND holes (the counter of an "O" is cut too and
 * weeded out). Each loop is an array of [x, y] corner points with collinear
 * runs already collapsed. Loops are oriented so that art lies on the right of
 * the direction of travel in image (y-down) coordinates: outer boundaries run
 * clockwise on screen, holes counter-clockwise.
 */
export function traceBoundaries(mask, width, height) {
  const vw = width + 1;
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height) ? 0 : mask[y * width + x];
  // Outgoing segments per vertex: up to two (a saddle where two art pixels touch diagonally).
  const out1 = new Int32Array(vw * (height + 1)).fill(-1);
  const out2 = new Int32Array(vw * (height + 1)).fill(-1);
  const add = (from, to) => { if (out1[from] < 0) out1[from] = to; else out2[from] = to; };
  let segments = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!at(x, y)) continue;
      const tl = y * vw + x, tr = tl + 1, br = tr + vw, bl = tl + vw;
      if (!at(x, y - 1)) { add(tl, tr); segments++; }   // top edge, travelling +x
      if (!at(x + 1, y)) { add(tr, br); segments++; }   // right edge, travelling +y
      if (!at(x, y + 1)) { add(br, bl); segments++; }   // bottom edge, travelling -x
      if (!at(x - 1, y)) { add(bl, tl); segments++; }   // left edge, travelling -y
    }
  }
  const loops = [];
  const take = (from, prevDx, prevDy) => {
    const a = out1[from], b = out2[from];
    if (a < 0 && b < 0) return -1;
    if (a >= 0 && b >= 0) {
      // Saddle: keep the boundary of the region we are already on by turning
      // right (clockwise on screen) relative to the incoming direction.
      const want = [-prevDy, prevDx];
      const dirOf = (to) => [(to % vw) - (from % vw), Math.floor(to / vw) - Math.floor(from / vw)];
      const da = dirOf(a);
      const pick = (da[0] === want[0] && da[1] === want[1]) ? "a" : "b";
      if (pick === "a") { out1[from] = -1; return a; }
      out2[from] = -1; return b;
    }
    if (a >= 0) { out1[from] = -1; return a; }
    out2[from] = -1; return b;
  };
  for (let start = 0; start < out1.length && segments > 0; start++) {
    if (out1[start] < 0 && out2[start] < 0) continue;
    const pts = [];
    let cur = start, dx = 0, dy = 0;
    let lastDx = 2, lastDy = 2;
    for (;;) {
      const next = take(cur, dx, dy);
      if (next < 0) break;
      segments--;
      const cx = cur % vw, cy = (cur - cx) / vw;
      dx = (next % vw) - cx; dy = Math.floor(next / vw) - cy;
      // Collapse collinear runs: only emit a vertex when direction changes.
      if (dx !== lastDx || dy !== lastDy) pts.push([cx, cy]);
      lastDx = dx; lastDy = dy;
      cur = next;
      if (cur === start) break;
    }
    if (pts.length >= 3) loops.push(pts);
  }
  return loops;
}

/** Signed area (shoelace); positive = clockwise on screen (y down). */
export function polygonArea(pts) {
  let s = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

// ── Simplify + smooth ───────────────────────────────────────────────────────

function perpDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdpOpen(pts, eps) {
  if (pts.length < 3) return pts;
  let maxD = 0, idx = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpDist(pts[i], a, b);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD <= eps) return [a, b];
  const left = rdpOpen(pts.slice(0, idx + 1), eps);
  const right = rdpOpen(pts.slice(idx), eps);
  return left.slice(0, -1).concat(right);
}

/** Ramer–Douglas–Peucker for a closed polygon: split at the point farthest from pts[0]. */
export function simplifyClosed(pts, eps) {
  if (pts.length < 4) return pts;
  let far = 0, maxD = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > maxD) { maxD = d; far = i; }
  }
  const first = rdpOpen(pts.slice(0, far + 1), eps);
  const second = rdpOpen(pts.slice(far).concat([pts[0]]), eps);
  const out = first.slice(0, -1).concat(second.slice(0, -1));
  return out.length >= 3 ? out : pts;
}

/** Chaikin corner cutting on a closed polygon — the staircase becomes a curve. */
export function chaikinClosed(pts, iterations = 2) {
  let cur = pts;
  for (let it = 0; it < iterations; it++) {
    const next = [];
    for (let i = 0, n = cur.length; i < n; i++) {
      const p = cur[i], q = cur[(i + 1) % n];
      next.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
      next.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    cur = next;
  }
  return cur;
}

/**
 * The finishing pass Illustrator users do by eye: simplify the pixel
 * staircase, round it, then drop the vertices the rounding made redundant.
 */
export function cleanLoop(pts, { simplifyEps = 1.25, smoothIterations = 2, finalEps = 0.4 } = {}) {
  const a = simplifyClosed(pts, simplifyEps);
  const b = chaikinClosed(a, smoothIterations);
  return simplifyClosed(b, finalEps);
}

/** SVG / PDF-friendly path data for a set of loops, with an optional affine map. */
export function loopsToPathD(loops, { scale = 1, offsetX = 0, offsetY = 0, precision = 2 } = {}) {
  const f = (v) => Number(v.toFixed(precision));
  return loops.map((loop) =>
    loop.map((p, i) => `${i === 0 ? "M" : "L"}${f(p[0] * scale + offsetX)} ${f(p[1] * scale + offsetY)}`).join(" ") + " Z"
  ).join(" ");
}

// ── Bleed: extend the artwork's own colour past the cut line ────────────────

/**
 * Nate's Offset Path on the bleed layer: the colour at the edge of the art
 * runs `radius` pixels outward so a slightly-off blade never shows white
 * substrate. Returns an RGBA buffer containing ONLY the ring (transparent
 * elsewhere), coloured by the nearest art pixel.
 */
export function bleedRing(rgba, mask, width, height, radius, precomputed) {
  const { dist, nearest } = precomputed || edt(mask, width, height);
  const out = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] || dist[i] > radius || nearest[i] < 0) continue;
    const s = nearest[i] * 4, d = i * 4;
    out[d] = rgba[s]; out[d + 1] = rgba[s + 1]; out[d + 2] = rgba[s + 2]; out[d + 3] = 255;
  }
  return out;
}

// ── Thin-detail check (WPW manual-review trigger) ───────────────────────────

/**
 * The widest inscribed disc of each component, in pixels: a feature whose
 * widest point is thinner than the plotter can weed needs a human look.
 * Returns the smallest feature width (2 × max inside distance) across
 * components with the given labels.
 */
export function minFeatureWidth(mask, width, height, labels, componentIds) {
  const { dist } = edt(invertMask(mask), width, height);
  const maxInside = new Map(componentIds.map((id) => [id, 0]));
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const id = labels[i];
    if (!maxInside.has(id)) continue;
    if (dist[i] > maxInside.get(id)) maxInside.set(id, dist[i]);
  }
  let min = Infinity;
  for (const v of maxInside.values()) min = Math.min(min, 2 * v);
  return min;
}

// ── Colour separation for Manufacture Film Cut (one film per colour) ────────

/**
 * Reduce the art pixels to at most `maxColors` solid colours (bins at 5 bits
 * per channel, merged when closer than `mergeDistance`, dropped under
 * `minCoverage`). Returns the palette and a per-pixel palette index
 * (255 = not art).
 */
export function quantizeColors(rgba, mask, width, height, { maxColors = 4, minCoverage = 0.01, mergeDistance = 48 } = {}) {
  const bins = new Map();
  let art = 0;
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i]) continue;
    art++;
    const key = ((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3);
    const b = bins.get(key);
    if (b) { b.n++; b.r += rgba[p]; b.g += rgba[p + 1]; b.b += rgba[p + 2]; }
    else bins.set(key, { n: 1, r: rgba[p], g: rgba[p + 1], b: rgba[p + 2] });
  }
  let palette = [...bins.values()]
    .map((b) => ({ r: b.r / b.n, g: b.g / b.n, b: b.b / b.n, n: b.n }))
    .sort((a, b) => b.n - a.n);
  // Merge near-identical bins (anti-aliasing produces many shades of one film).
  const merged = [];
  for (const c of palette) {
    const near = merged.find((m) => Math.hypot(m.r - c.r, m.g - c.g, m.b - c.b) <= mergeDistance);
    if (near) {
      const n = near.n + c.n;
      near.r = (near.r * near.n + c.r * c.n) / n;
      near.g = (near.g * near.n + c.g * c.n) / n;
      near.b = (near.b * near.n + c.b * c.n) / n;
      near.n = n;
    } else merged.push({ ...c });
  }
  palette = merged.filter((c) => c.n / Math.max(1, art) >= minCoverage).slice(0, maxColors);
  const index = new Uint8Array(mask.length).fill(255);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (!mask[i] || palette.length === 0) continue;
    let best = 0, bestD = Infinity;
    for (let k = 0; k < palette.length; k++) {
      const c = palette[k];
      const d = (c.r - rgba[p]) ** 2 + (c.g - rgba[p + 1]) ** 2 + (c.b - rgba[p + 2]) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    index[i] = best;
  }
  const hex = (v) => Math.round(v).toString(16).padStart(2, "0");
  return {
    palette: palette.map((c) => ({
      r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b),
      hex: `#${hex(c.r)}${hex(c.g)}${hex(c.b)}`.toUpperCase(),
      coverage: c.n / Math.max(1, art),
    })),
    index,
  };
}

export function maskForPaletteIndex(index, k) {
  const out = new Uint8Array(index.length);
  for (let i = 0; i < index.length; i++) out[i] = index[i] === k ? 1 : 0;
  return out;
}

// ── Nesting: one compact sheet, never taller than the cut-contour max width ─

/**
 * Column packing: items (with bleed already included in w/h) stack down a
 * column no taller than `maxHeight`; when the next one will not fit, a new
 * column starts to the right. Tall items are rotated when that is the only
 * way they fit. `gap` is the breathing room between items. Returns the
 * placements and the sheet's used extent (Nate's "fit to artwork bounds").
 */
export function shelfPack(items, maxHeight, gap = 0) {
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => (b.h - a.h) || (b.w - a.w));
  const placements = [];
  let colX = 0, colW = 0, y = 0, sheetH = 0;
  for (const it of order) {
    let w = it.w, h = it.h, rotated = false;
    if (h > maxHeight && w <= maxHeight) { [w, h] = [h, w]; rotated = true; }
    if (h > maxHeight) {
      // Cannot fit even rotated: its own column; the caller flags it for tiling.
      if (colW > 0) { colX += colW + gap; colW = 0; y = 0; }
      placements.push({ id: it.id, i: it.i, x: colX, y: 0, w, h, rotated, oversize: true });
      colX += w + gap; colW = 0; y = 0;
      sheetH = Math.max(sheetH, h);
      continue;
    }
    if (y > 0 && y + h > maxHeight) { colX += colW + gap; colW = 0; y = 0; }
    placements.push({ id: it.id, i: it.i, x: colX, y, w, h, rotated, oversize: false });
    y += h + gap;
    colW = Math.max(colW, w);
    sheetH = Math.max(sheetH, y - gap);
  }
  const sheetW = colX + colW;
  placements.sort((a, b) => a.i - b.i);
  return { placements, sheetW, sheetH };
}
