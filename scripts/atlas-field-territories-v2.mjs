#!/usr/bin/env node
/**
 * FIELD TERRITORIES v2 — `field-thirds-v2`. Harness-side. Not production.
 *
 * Owner ruling (2026-09-02, after anchor v1–v4 and Test 8): Gemini authors ONE
 * uninterrupted full-bleed vehicle-wrap composition and is shown NO production
 * topology — no six-region guide, no labeled sheet, no six named production
 * objects. GENIE/runtime owns Driver, Passenger, Hood, Roof, Front and Rear as
 * CODE-ONLY territories and serializes them deterministically AFTER the one
 * image call. Passenger is its own territory and is never mirrored Driver.
 *
 * What v2 changes against `field-bands-v1` (run 33603368628), from its record:
 *
 *   1. THIRDS. v1 asked for "top quarter / same height / bottom half" while its
 *      territories sat at 36% / 36% / 28%, and the model drew THIRDS
 *      (transitions at y≈1365 and y≈2731). v2 places the territories on the
 *      thirds the model actually draws and the prompt names thirds. Territory
 *      and composition now describe the same picture.
 *   2. FLANKS CENTRED in their band, so the discarded margin is symmetric and
 *      the passage's centre stays the file's centre.
 *   3. REAR UNDER THE SHORTEST ROW-ONE TERRITORY (front on the F250) instead of
 *      under the roof, which lifts the centre scale from 8.8 to ~12.6 px/in on
 *      the live geometry and extracts more of the canvas than v1.
 *
 * Inches, square feet, proof dependencies and the 5" bleed are lifted from the
 * production `buildAtlasManifest` zones, never re-derived. Only the geometry —
 * where each territory sits on the 4096² field, at rotation 0 — is replaced.
 * The canvas area no territory covers is painted by the model and discarded by
 * the zone mask: a resolution cost, reported, not a defect.
 */
import {
  aspectTolerance,
  fieldTrimRectangle,
  internalBoundaries,
  BLEED_INCHES,
  NOSE_EDGE,
} from "./atlas-field-territories.mjs";

export const FIELD_TOPOLOGY_V2 = "field-thirds-v2";
export const FIELD_CONTRACT_V2 = "designpro.atlas-field-territories.v2";
export const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const CENTER_ROW_ONE = Object.freeze(["roof", "hood", "front"]);
const CENTER_ROW_TWO = Object.freeze(["rear"]);
export { BLEED_INCHES, NOSE_EDGE };

const round2 = (v) => Math.round(v * 100) / 100;

function legacyZoneMap(manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  const byKey = new Map(zones.map((zone) => [zone.surfaceKey, zone]));
  for (const key of SURFACE_KEYS) {
    const zone = byKey.get(key);
    if (!zone || !(zone.printWidthIn > 0) || !(zone.printHeightIn > 0)) {
      throw new Error(`atlas_field_legacy_zone_missing:${key}`);
    }
  }
  return byKey;
}

/**
 * Three horizontal thirds. The two flank bands share one exact height so the
 * Driver and Passenger files are the same pixel size; the centre band takes
 * the remainder (one pixel more on a 4096 canvas).
 */
export function thirdBands(H) {
  const flank = Math.floor(H / 3);
  return [
    { third: 1, y: 0, h: flank },
    { third: 2, y: flank, h: flank },
    { third: 3, y: flank * 2, h: H - flank * 2 },
  ];
}

/** Largest rect of the given print aspect inside a band, centred in it. */
function centredFlank(z, W, band) {
  const scale = Math.min(W / z.printWidthIn, band.h / z.printHeightIn);
  const w = Math.min(W, Math.max(1, Math.round(z.printWidthIn * scale)));
  const h = Math.min(band.h, Math.max(1, Math.round(z.printHeightIn * scale)));
  return { x: Math.floor((W - w) / 2), y: band.y + Math.floor((band.h - h) / 2), w, h, scale };
}

/**
 * @param legacyManifest the production `buildAtlasManifest` output
 * @returns a manifest of the SAME zone shape `cutCallOnePanels` reads, with
 *   `topology: "field-thirds-v2"`, rotation 0 everywhere, and a `fieldLayout`
 *   receipt (thirds, extracted/unextracted area, boundaries).
 */
export function buildFieldTerritoriesV2(legacyManifest) {
  const canvas = legacyManifest?.canvas;
  const W = Number(canvas?.widthPx);
  const H = Number(canvas?.heightPx);
  if (!(W > 0 && H > 0)) throw new Error("atlas_field_canvas_unreadable");
  const legacy = legacyZoneMap(legacyManifest);
  const bands = thirdBands(H);
  const rects = new Map();

  // ── thirds 1 and 2: the flanks, each centred in its own third ─────────────
  const driver = centredFlank(legacy.get("driver"), W, bands[0]);
  const passenger = centredFlank(legacy.get("passenger"), W, bands[1]);
  rects.set("driver", driver);
  rects.set("passenger", passenger);

  // ── third 3: roof · hood · front abreast; rear under the SHORTEST of them ─
  const band = bands[2];
  const R = band.h;
  const roof = legacy.get("roof");
  const hood = legacy.get("hood");
  const front = legacy.get("front");
  const rear = legacy.get("rear");
  const rowOne = [roof, hood, front];
  const rowOneWidthIn = rowOne.reduce((t, z) => t + z.printWidthIn, 0);
  const host = rowOne.reduce((best, z) => (z.printHeightIn < best.printHeightIn ? z : best), rowOne[0]);
  // The rear may be wider than its host and then overhang a taller neighbour's
  // column; the scale and the overlapped set depend on each other, so settle
  // them by a short monotone iteration (as v1 did).
  let underRearHeightIn = host.printHeightIn;
  let scaleCenter = 0;
  let placed = null;
  for (let pass = 0; pass < 8; pass += 1) {
    scaleCenter = Math.min(
      W / rowOneWidthIn,
      R / (underRearHeightIn + rear.printHeightIn),
      ...rowOne.map((z) => R / z.printHeightIn),
    );
    const px = (inches) => Math.max(1, Math.round(inches * scaleCenter));
    const rowWidth = rowOne.reduce((t, z) => t + px(z.printWidthIn), 0);
    const offset = Math.max(0, Math.floor((W - Math.min(W, rowWidth)) / 2));
    let x = offset;
    const rowRects = new Map();
    for (const z of rowOne) {
      let w = px(z.printWidthIn);
      if (x + w > W) w = W - x; // rounding guard, at most 1px
      rowRects.set(z.surfaceKey, { x, y: band.y, w, h: px(z.printHeightIn) });
      x += w;
    }
    const rw = px(rear.printWidthIn);
    const hostRect = rowRects.get(host.surfaceKey);
    const rx = Math.max(0, Math.min(hostRect.x, W - rw));
    const overlapped = [...rowRects.values()].filter((r) => r.x < rx + rw && rx < r.x + r.w);
    const tallestIn = Math.max(...overlapped.map((r) => rowOne.find((z) => rowRects.get(z.surfaceKey) === r).printHeightIn));
    // Monotone: the stacking height only ever grows, so the scale only ever
    // shrinks and the loop terminates within the number of distinct heights.
    if (tallestIn > underRearHeightIn) { underRearHeightIn = tallestIn; continue; }
    const ry = Math.max(...overlapped.map((r) => r.y + r.h));
    let rh = px(rear.printHeightIn);
    if (ry + rh > H) rh = H - ry; // rounding guard, at most 1px
    placed = { rowRects, rear: { x: rx, y: ry, w: rw, h: rh } };
    break;
  }
  if (!placed) throw new Error("atlas_field_center_band_unsettled");
  for (const [key, rect] of placed.rowRects) rects.set(key, rect);
  rects.set("rear", placed.rear);

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
    const placement = z.surfaceKey === "driver" ? "third-1"
      : z.surfaceKey === "passenger" ? "third-2"
        : CENTER_ROW_ONE.includes(z.surfaceKey) ? "third-3-row-1" : "third-3-row-2";
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

  for (let i = 0; i < zones.length; i += 1) {
    for (let j = i + 1; j < zones.length; j += 1) {
      const a = zones[i]; const b = zones[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      if (overlap) throw new Error(`atlas_field_zones_overlap:${a.surfaceKey}:${b.surfaceKey}`);
    }
  }
  const d = zones.find((z) => z.surfaceKey === "driver");
  const p = zones.find((z) => z.surfaceKey === "passenger");
  if (d.w !== p.w || d.h !== p.h) throw new Error("atlas_field_flank_files_differ_in_size");

  const extractedPx = zones.reduce((t, z) => t + z.w * z.h, 0);
  const canvasPx = W * H;
  return {
    ...legacyManifest,
    contract: FIELD_CONTRACT_V2,
    topology: FIELD_TOPOLOGY_V2,
    legacyTopology: legacyManifest.topology,
    installerMap: {
      driver: "third-1",
      passenger: "third-2",
      centerRowOneLeftToRight: [...CENTER_ROW_ONE],
      centerRowTwo: [...CENTER_ROW_TWO],
      rearUnder: host.surfaceKey,
      noseEdge: { ...NOSE_EDGE },
      flankRotationDegrees: 0,
    },
    zones,
    quality: {
      ...(legacyManifest.quality || {}),
      minimumEffectivePpi: Math.min(...zones.map((z) => z.effectivePpi)),
      upscalingRequiredBeforeAnyProductionExport: true,
    },
    fieldLayout: {
      contract: FIELD_CONTRACT_V2,
      thirds: bands.map((b) => ({
        ...b,
        surfaces: b.third === 1 ? ["driver"] : b.third === 2 ? ["passenger"] : [...CENTER_ROW_ONE, ...CENTER_ROW_TWO],
        ...(b.third === 3 ? { scaleCenterPxPerIn: round2(scaleCenter), rearUnder: host.surfaceKey } : {}),
      })),
      canvasPx,
      extractedPx,
      extractedRatio: Number((extractedPx / canvasPx).toFixed(4)),
      paintedNotExtractedPx: canvasPx - extractedPx,
      paintedNotExtractedRatio: Number(((canvasPx - extractedPx) / canvasPx).toFixed(4)),
      boundaries: internalBoundaries(zones),
    },
  };
}
