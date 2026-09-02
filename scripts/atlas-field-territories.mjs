#!/usr/bin/env node
/**
 * FIELD TERRITORIES — `field-bands-v1`. Harness-side. Not production.
 *
 * Owner ruling (2026-09-02): Gemini authors ONE uninterrupted full-bleed
 * vehicle-wrap composition and receives no containers, no panel objects, no
 * guide, no teaching sheet, no labels. GENIE/runtime owns the six canonical
 * surface territories and deterministic serialization AFTER the one image call.
 * Driver and Passenger are distinct territories; Passenger is never mirrored
 * Driver. Canonical identities live HERE, in the OS, never in the model request.
 *
 * This module takes the LEGACY manifest from `buildAtlasManifest` -- so surface
 * validation, inches, square feet, proof dependencies and the 5" bleed are
 * lifted from production code, never re-derived -- and replaces only the
 * geometry: where each territory sits on the 4096² field, at rotation 0.
 *
 * LAYOUT (§L of the recovery plan):
 *   band 1  DRIVER     full canvas width, installed (landscape) orientation
 *   band 2  PASSENGER  full canvas width, installed orientation
 *   band 3  row 1: ROOF · HOOD · FRONT abreast;  row 2: REAR under ROOF
 * Every territory keeps its own print aspect exactly (uniform scale per band).
 * The canvas area no territory covers is painted by the model and discarded by
 * the zone mask -- not a defect, only a resolution cost, and it is reported.
 *
 * With no containers the model has no reason to rotate flank lettering, which
 * is why both flanks sit landscape. The current production topology rotates
 * them ±90° -- RestylePro's proven path never rotated anything.
 */

export const FIELD_TOPOLOGY = "field-bands-v1";
export const FIELD_CONTRACT = "designpro.atlas-field-territories.v1";
/** Facing the driver side, the nose is at the viewer's LEFT; passenger, RIGHT. */
export const NOSE_EDGE = Object.freeze({ driver: "left", passenger: "right" });
export const BLEED_INCHES = 5;
/**
 * A territory's pixel aspect may differ from its print aspect by at most this,
 * OR by what integer pixel rounding on its own two axes can introduce
 * (half a pixel per axis: 0.5/w + 0.5/h, doubled for margin) -- whichever is
 * larger. A 700-px territory rounds to ~0.15%; that is rounding, not drift.
 */
export const MAX_ASPECT_ERROR = 0.001;
export function aspectTolerance(rect) {
  return Math.max(MAX_ASPECT_ERROR, 1 / rect.w + 1 / rect.h);
}

const CENTER_ROW_ONE = Object.freeze(["roof", "hood", "front"]);
const CENTER_ROW_TWO = Object.freeze(["rear"]);
const BAND_ORDER = Object.freeze(["driver", "passenger"]);
/**
 * The two flank bands may take at most this share of the canvas height, so a
 * short, tall-sided vehicle (a box body) still leaves the centre surfaces a
 * usable band. On the F250 (261:70) the flanks need 53.7% and this never binds.
 */
export const FLANK_MAX_HEIGHT_SHARE = 0.72;

const round2 = (v) => Math.round(v * 100) / 100;

function legacyZoneMap(manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  const byKey = new Map(zones.map((zone) => [zone.surfaceKey, zone]));
  for (const key of ["driver", "passenger", "hood", "roof", "front", "rear"]) {
    const zone = byKey.get(key);
    if (!zone || !(zone.printWidthIn > 0) || !(zone.printHeightIn > 0)) {
      throw new Error(`atlas_field_legacy_zone_missing:${key}`);
    }
  }
  return byKey;
}

/** trimRectangle for a rotation-0 territory -- the production formula, inlined. */
export function fieldTrimRectangle(rect, printWidthIn, printHeightIn) {
  const bleedX = Math.round(BLEED_INCHES * rect.w / printWidthIn);
  const bleedY = Math.round(BLEED_INCHES * rect.h / printHeightIn);
  return { x: rect.x + bleedX, y: rect.y + bleedY, w: Math.max(1, rect.w - bleedX * 2), h: Math.max(1, rect.h - bleedY * 2) };
}

/**
 * The shared borders between territories, derived from the rects themselves so
 * a layout change cannot leave a stale boundary list behind. Each is a segment
 * with an axis: `y` = a horizontal border at `at` spanning x∈[from,to];
 * `x` = a vertical border at `at` spanning y∈[from,to].
 */
export function internalBoundaries(zones) {
  const out = [];
  for (const a of zones) {
    for (const b of zones) {
      if (a === b) continue;
      if (a.y + a.h === b.y) {
        const from = Math.max(a.x, b.x);
        const to = Math.min(a.x + a.w, b.x + b.w);
        if (to - from > 0) out.push({ between: [a.surfaceKey, b.surfaceKey], axis: "y", at: b.y, from, to });
      }
      if (a.x + a.w === b.x) {
        const from = Math.max(a.y, b.y);
        const to = Math.min(a.y + a.h, b.y + b.h);
        if (to - from > 0) out.push({ between: [a.surfaceKey, b.surfaceKey], axis: "x", at: b.x, from, to });
      }
    }
  }
  return out;
}

/**
 * @param legacyManifest the production `buildAtlasManifest` output
 * @returns a manifest of the SAME zone shape `cutCallOnePanels` reads, with
 *   `topology: "field-bands-v1"`, rotation 0 everywhere, and a `fieldLayout`
 *   receipt (bands, extracted/unextracted area, boundaries).
 */
export function buildFieldTerritories(legacyManifest) {
  const canvas = legacyManifest?.canvas;
  const W = Number(canvas?.widthPx);
  const H = Number(canvas?.heightPx);
  if (!(W > 0 && H > 0)) throw new Error("atlas_field_canvas_unreadable");
  const legacy = legacyZoneMap(legacyManifest);

  // ── bands 1 and 2: the flanks, each at its own uniform scale ──────────────
  const rects = new Map();
  const flankHeightAtFullWidth = BAND_ORDER.reduce((t, key) => {
    const z = legacy.get(key);
    return t + z.printHeightIn * (W / z.printWidthIn);
  }, 0);
  const flankShare = Math.min(1, (H * FLANK_MAX_HEIGHT_SHARE) / flankHeightAtFullWidth);
  let y = 0;
  for (const key of BAND_ORDER) {
    const z = legacy.get(key);
    const scale = (W / z.printWidthIn) * flankShare;
    const w = Math.max(1, Math.round(z.printWidthIn * scale));
    const h = Math.max(1, Math.round(z.printHeightIn * scale));
    rects.set(key, { x: 0, y, w, h });
    y += h;
  }
  const centerTop = y;
  const R = H - centerTop;
  if (R < 64) throw new Error(`atlas_field_center_band_too_short:${R}`);

  // ── band 3: one uniform scale for the four centre surfaces ────────────────
  // Row 1 = roof · hood · front abreast; row 2 = rear, below whichever row-1
  // territories it horizontally overlaps (on the F250 that is the roof alone).
  // The overlap set depends on the scale and the scale on the overlap set, so
  // settle it by a short monotone iteration.
  const roof = legacy.get("roof");
  const hood = legacy.get("hood");
  const front = legacy.get("front");
  const rear = legacy.get("rear");
  const rowOne = [roof, hood, front];
  const rowOneWidthIn = rowOne.reduce((t, z) => t + z.printWidthIn, 0);
  let underRearHeightIn = roof.printHeightIn;
  let scaleCenter = 0;
  for (let pass = 0; pass < 4; pass += 1) {
    scaleCenter = Math.min(
      W / rowOneWidthIn,
      R / (underRearHeightIn + rear.printHeightIn),
      ...rowOne.map((z) => R / z.printHeightIn),
    );
    // which row-1 territories does the rear overlap horizontally at this scale?
    let x = 0; let tallest = 0;
    for (const z of rowOne) {
      if (x < rear.printWidthIn * scaleCenter) tallest = Math.max(tallest, z.printHeightIn);
      x += z.printWidthIn * scaleCenter;
    }
    if (tallest === underRearHeightIn) break;
    underRearHeightIn = tallest;
  }
  const px = (inches) => Math.max(1, Math.round(inches * scaleCenter));
  let x = 0;
  const rowOneRects = [];
  for (const z of rowOne) {
    let w = px(z.printWidthIn);
    if (x + w > W) w = W - x; // rounding guard, at most 1px
    const rect = { x, y: centerTop, w, h: px(z.printHeightIn) };
    rects.set(z.surfaceKey, rect);
    rowOneRects.push(rect);
    x += w;
  }
  {
    const w = px(rear.printWidthIn);
    const below = Math.max(...rowOneRects.filter((r) => r.x < w).map((r) => r.y + r.h));
    let h = px(rear.printHeightIn);
    if (below + h > H) h = H - below;
    rects.set("rear", { x: 0, y: below, w, h });
  }

  // ── the zone objects, same shape as production, rotation 0 ───────────────
  const zones = legacyManifest.zones.map((z) => {
    const rect = rects.get(z.surfaceKey);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > W || rect.y + rect.h > H || rect.w < 1 || rect.h < 1) {
      throw new Error(`atlas_field_zone_out_of_bounds:${z.surfaceKey}:${JSON.stringify(rect)}`);
    }
    const aspectError = Math.abs((rect.w / rect.h) / (z.printWidthIn / z.printHeightIn) - 1);
    if (aspectError > aspectTolerance(rect)) {
      throw new Error(`atlas_field_zone_aspect_drift:${z.surfaceKey}:${aspectError.toFixed(5)}:tolerance=${aspectTolerance(rect).toFixed(5)}`);
    }
    const effectivePpi = round2(Math.min(rect.w / z.printWidthIn, rect.h / z.printHeightIn));
    const placement = z.surfaceKey === "driver" ? "band-1"
      : z.surfaceKey === "passenger" ? "band-2"
        : CENTER_ROW_ONE.includes(z.surfaceKey) ? "band-3-row-1" : "band-3-row-2";
    return {
      ...z,
      placement,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      rotationDegrees: 0,
      extraction: { x: rect.x, y: rect.y, w: rect.w, h: rect.h, outputRotationDegrees: 0 },
      trim: fieldTrimRectangle(rect, z.printWidthIn, z.printHeightIn),
      effectivePpi,
      noseEdge: NOSE_EDGE[z.surfaceKey] || null,
    };
  });

  // ── non-overlap, by construction but asserted ─────────────────────────────
  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const a = zones[i]; const b = zones[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlap) throw new Error(`atlas_field_zones_overlap:${a.surfaceKey}:${b.surfaceKey}`);
    }
  }

  const extractedPx = zones.reduce((t, z) => t + z.w * z.h, 0);
  const canvasPx = W * H;
  const minimumEffectivePpi = Math.min(...zones.map((z) => z.effectivePpi));
  return {
    ...legacyManifest,
    contract: FIELD_CONTRACT,
    topology: FIELD_TOPOLOGY,
    legacyTopology: legacyManifest.topology,
    installerMap: {
      driver: "band-1",
      passenger: "band-2",
      centerRowOneLeftToRight: [...CENTER_ROW_ONE],
      centerRowTwo: [...CENTER_ROW_TWO],
      noseEdge: { ...NOSE_EDGE },
      flankRotationDegrees: 0,
    },
    zones,
    quality: {
      ...(legacyManifest.quality || {}),
      minimumEffectivePpi,
      upscalingRequiredBeforeAnyProductionExport: true,
    },
    fieldLayout: {
      contract: FIELD_CONTRACT,
      bands: [
        { band: 1, surfaces: ["driver"], y: rects.get("driver").y, h: rects.get("driver").h },
        { band: 2, surfaces: ["passenger"], y: rects.get("passenger").y, h: rects.get("passenger").h },
        { band: 3, surfaces: [...CENTER_ROW_ONE, ...CENTER_ROW_TWO], y: centerTop, h: R, scaleCenterPxPerIn: round2(scaleCenter) },
      ],
      canvasPx,
      extractedPx,
      extractedRatio: Number((extractedPx / canvasPx).toFixed(4)),
      paintedNotExtractedPx: canvasPx - extractedPx,
      paintedNotExtractedRatio: Number(((canvasPx - extractedPx) / canvasPx).toFixed(4)),
      boundaries: internalBoundaries(zones),
    },
  };
}
