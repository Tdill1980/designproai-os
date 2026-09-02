#!/usr/bin/env node
/**
 * COLOUR-BLIND FULL-BLEED METRICS — harness only. Not a gate, not production.
 *
 * `holeAt` (shared by the production gate, the cut-out detector and the fill) is
 * *near-black or transparent*. Test 2 proved that makes it colour-conditional:
 * arm A left a 33-53% near-black field and blocked; arm B left a 25-56% field of
 * rgb(92,92,92) and passed 3/3 — the SAME structural defect, convicted only when
 * it happened to be dark. Any acceptance-rate claim measured that way is
 * measuring the background's colour, not the panel's validity.
 *
 * So this asks the question directly, with no colour in it:
 *
 *   Does each canonical zone contain full-bleed artwork across the ENTIRE
 *   rectangle, with no large uniform non-artwork field and no contoured
 *   silhouette shape?
 *
 * HOW. A wrap panel is a solid rectangle: artwork runs off all four sides, so
 * nothing on the border is background. A silhouette or a die-cut template sits
 * on a field that touches the border and surrounds the shape. So the field is
 * exactly "what is reachable from the zone's edge without crossing into
 * artwork" — flood the zone inward from its whole border, growing only through
 * pixels that stay within tolerance of the region's running mean. Uniform field
 * floods and is measured; artwork stops the flood at the first pixel.
 *
 * Colour never enters it. A black surround, a grey surround and a white surround
 * all read identically, which is the entire point.
 *
 * Interior flat blobs (a punched wheel arch fully enclosed by artwork) are
 * caught separately as uniform components that the edge flood never reached.
 *
 * MEASURED AT REDUCED RESOLUTION. Each zone is sampled to at most 1024px on its
 * long edge: the question is "is there a large field", not "where is this edge
 * to the pixel", and 6 zones x 6 draws of 4096-square flood fill is minutes of
 * wall clock for no extra answer. Ratios are scale-invariant; the sample factor
 * is reported so a number can be re-derived.
 */
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const require_ = createRequire(join(resolve(HERE, ".."), "runtime/"));

export const MAX_SAMPLE_EDGE = 1024;
// Two pixels belong to the same uniform field when every channel stays within
// this of the region's running mean. Loose enough for PNG/JPEG noise and a very
// gentle vignette, far tighter than any artwork gradient that carries detail.
export const FIELD_TOLERANCE = 10;
// A uniform region only counts as a non-artwork FIELD at this share of the zone.
// Below it, a flat passage is design (a solid colour block inside a livery).
export const MIN_FIELD_RATIO = 0.01;
// Full-bleed compliance thresholds for the experiment's primary endpoint.
export const MIN_BORDER_ARTWORK_RATIO = 0.98;
export const MAX_NON_ARTWORK_RATIO = 0.02;

/**
 * @returns per-zone metrics plus a sheet-level roll-up. Every ratio is a share
 * of that zone's own area unless named otherwise.
 */
export async function fullBleedMetrics(masterBytes, manifest, { sharp = require_("sharp") } = {}) {
  const zones = [];
  for (const zone of manifest.zones) {
    zones.push(await measureZone(masterBytes, zone, sharp));
  }
  const compliant = zones.filter((z) => z.fullBleedCompliant);
  return {
    contract: "designpro.atlas-fullbleed-colourblind.v1",
    zones: Object.fromEntries(zones.map((z) => [z.surfaceKey, z])),
    fullBleedCompliantSurfaces: compliant.map((z) => z.surfaceKey),
    fullBleedCompliantCount: compliant.length,
    worstNonArtworkRatio: Math.max(0, ...zones.map((z) => z.nonArtworkRatio)),
    worstContourScore: Math.max(0, ...zones.map((z) => z.contourScore)),
  };
}

/**
 * A manifest zone is `{ surfaceKey, x, y, w, h, … }`. `width`/`height` are
 * accepted too, but only as an alias -- and an unreadable rect FAILS rather than
 * producing NaN. The first live run of this module died at
 * "Expected integer for width but received NaN" after spending an image call,
 * because it read `width`/`height` and the fixtures it was tested against had
 * been written to match that assumption instead of the real manifest.
 */
export function zoneRect(zone) {
  const source = zone?.rect || zone || {};
  const x = Number(source.x);
  const y = Number(source.y);
  const w = Number(source.w ?? source.width);
  const h = Number(source.h ?? source.height);
  if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1) {
    throw new Error(
      `atlas_fullbleed_zone_rect_unreadable:${zone?.surfaceKey || "?"}:`
      + `${JSON.stringify({ x: source.x, y: source.y, w: source.w, h: source.h, width: source.width, height: source.height })}`,
    );
  }
  return { x, y, width: w, height: h };
}

async function measureZone(masterBytes, zone, sharp) {
  const { x, y, width, height } = zoneRect(zone);
  const factor = Math.max(1, Math.max(width, height) / MAX_SAMPLE_EDGE);
  const w = Math.max(8, Math.round(width / factor));
  const h = Math.max(8, Math.round(height / factor));
  const { data, info } = await sharp(masterBytes, { limitInputPixels: false })
    .extract({ left: Math.round(x), top: Math.round(y), width: Math.round(width), height: Math.round(height) })
    .resize(w, h, { fit: "fill", kernel: "nearest" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const C = info.channels;
  const N = W * H;

  // ── THE EDGE FLOOD ────────────────────────────────────────────────────────
  // Seeded from every border pixel, grown only while the candidate stays within
  // FIELD_TOLERANCE of the region's running mean. One region per seed cluster,
  // so two different-coloured fields on opposite edges are measured separately
  // rather than merged through a gradient.
  const label = new Int32Array(N).fill(-1);
  const regions = [];
  const stack = new Int32Array(N);
  const at = (p) => p * C;

  const seeds = [];
  for (let px = 0; px < W; px += 1) { seeds.push(px); seeds.push((H - 1) * W + px); }
  for (let py = 0; py < H; py += 1) { seeds.push(py * W); seeds.push(py * W + W - 1); }

  for (const seed of seeds) {
    if (label[seed] !== -1) continue;
    const id = regions.length;
    let sum0 = 0; let sum1 = 0; let sum2 = 0; let size = 0;
    let top = 0;
    stack[top++] = seed;
    label[seed] = id;
    while (top > 0) {
      const p = stack[--top];
      const i = at(p);
      sum0 += data[i]; sum1 += data[i + 1]; sum2 += data[i + 2]; size += 1;
      const m0 = sum0 / size; const m1 = sum1 / size; const m2 = sum2 / size;
      const px = p % W; const py = (p / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = px + dx; const ny = py + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (label[q] !== -1) continue;
        const j = at(q);
        if (Math.abs(data[j] - m0) > FIELD_TOLERANCE) continue;
        if (Math.abs(data[j + 1] - m1) > FIELD_TOLERANCE) continue;
        if (Math.abs(data[j + 2] - m2) > FIELD_TOLERANCE) continue;
        label[q] = id;
        stack[top++] = q;
      }
    }
    regions.push({ id, size, edgeReachable: true });
  }

  // ── INTERIOR UNIFORM BLOBS ────────────────────────────────────────────────
  // A punched opening fully enclosed by artwork is never reached from the edge,
  // and is the same defect one step inward.
  for (let p = 0; p < N; p += 1) {
    if (label[p] !== -1) continue;
    const id = regions.length;
    let sum0 = 0; let sum1 = 0; let sum2 = 0; let size = 0;
    let top = 0;
    stack[top++] = p;
    label[p] = id;
    while (top > 0) {
      const q = stack[--top];
      const i = at(q);
      sum0 += data[i]; sum1 += data[i + 1]; sum2 += data[i + 2]; size += 1;
      const m0 = sum0 / size; const m1 = sum1 / size; const m2 = sum2 / size;
      const qx = q % W; const qy = (q / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = qx + dx; const ny = qy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const r = ny * W + nx;
        if (label[r] !== -1) continue;
        const j = at(r);
        if (Math.abs(data[j] - m0) > FIELD_TOLERANCE) continue;
        if (Math.abs(data[j + 1] - m1) > FIELD_TOLERANCE) continue;
        if (Math.abs(data[j + 2] - m2) > FIELD_TOLERANCE) continue;
        label[r] = id;
        stack[top++] = r;
      }
    }
    regions.push({ id, size, edgeReachable: false });
  }

  const fieldFloor = N * MIN_FIELD_RATIO;
  const fields = regions.filter((r) => r.size >= fieldFloor);
  const fieldIds = new Set(fields.map((r) => r.id));
  const nonArtwork = fields.reduce((n, r) => n + r.size, 0);
  const largestField = fields.reduce((n, r) => Math.max(n, r.size), 0);
  const edgeField = fields.filter((r) => r.edgeReachable).reduce((n, r) => n + r.size, 0);
  const interiorField = nonArtwork - edgeField;

  // Border ring: on a solid rectangle every border pixel is artwork.
  let borderTotal = 0;
  let borderArtwork = 0;
  const countBorder = (p) => { borderTotal += 1; if (!fieldIds.has(label[p])) borderArtwork += 1; };
  for (let px = 0; px < W; px += 1) { countBorder(px); countBorder((H - 1) * W + px); }
  for (let py = 1; py < H - 1; py += 1) { countBorder(py * W); countBorder(py * W + W - 1); }

  // ── CONTOUR / SILHOUETTE SCORE ────────────────────────────────────────────
  // How far the artwork is from filling its own bounding box. A full-bleed
  // rectangle fills it exactly (0). A die-cut body shape leaves the corners and
  // the arch bites empty (high). Colour plays no part.
  let ax0 = W; let ay0 = H; let ax1 = -1; let ay1 = -1; let artworkArea = 0;
  for (let py = 0; py < H; py += 1) {
    for (let px = 0; px < W; px += 1) {
      if (fieldIds.has(label[py * W + px])) continue;
      artworkArea += 1;
      if (px < ax0) ax0 = px;
      if (px > ax1) ax1 = px;
      if (py < ay0) ay0 = py;
      if (py > ay1) ay1 = py;
    }
  }
  const bboxArea = artworkArea > 0 ? (ax1 - ax0 + 1) * (ay1 - ay0 + 1) : 0;
  const contourScore = bboxArea > 0 ? Math.max(0, 1 - artworkArea / bboxArea) : 1;

  const nonArtworkRatio = nonArtwork / N;
  const borderArtworkRatio = borderTotal ? borderArtwork / borderTotal : 0;
  const round = (v) => Number(v.toFixed(5));

  return {
    surfaceKey: zone.surfaceKey,
    sampledAt: `${W}x${H}`,
    sampleFactor: round(factor),
    artworkRatio: round(artworkArea / N),
    nonArtworkRatio: round(nonArtworkRatio),
    largestNonArtworkComponentRatio: round(largestField / N),
    edgeReachableFieldRatio: round(edgeField / N),
    interiorFieldRatio: round(interiorField / N),
    nonArtworkComponentCount: fields.length,
    borderArtworkRatio: round(borderArtworkRatio),
    contourScore: round(contourScore),
    fullBleedCompliant: borderArtworkRatio >= MIN_BORDER_ARTWORK_RATIO && nonArtworkRatio <= MAX_NON_ARTWORK_RATIO,
  };
}
