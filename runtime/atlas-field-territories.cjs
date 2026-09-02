"use strict";
/**
 * A.T.L.A.S. FIELD TERRITORIES — `field-thirds-v2`, the production port of
 * `scripts/atlas-field-territories-v2.mjs` (owner ruling 2026-09-02, unfrozen
 * the same day: "UNFREEZE GET ME A WORKING OS").
 *
 * Gemini authors ONE uninterrupted full-bleed vehicle-wrap composition and is
 * shown NO production topology — no six-region guide, no labeled teaching
 * sheet, no six named production objects. GENIE/runtime owns Driver,
 * Passenger, Hood, Roof, Front and Rear as CODE-ONLY territories on the 4096²
 * field and serializes them deterministically AFTER the one image call.
 * Passenger is its own territory and is never mirrored Driver.
 *
 * Geometry (proven on harness draw 33659500846, the only clean flanks this
 * product has produced without vehicle anatomy):
 *   third 1  DRIVER     centred in the top third, installed (landscape) orientation
 *   third 2  PASSENGER  centred in the middle third, installed orientation
 *   third 3  ROOF · HOOD · FRONT abreast; REAR under the shortest of them
 *
 * Inches, square feet, proof dependencies, `guideFill` and the 5" bleed are
 * lifted from the production `buildAtlasManifest` zones, never re-derived.
 * Only the geometry — where each territory sits on the field, at rotation 0 —
 * is replaced. The canvas area no territory covers is painted by the model and
 * discarded by the zone mask: a resolution cost, reported, not a defect.
 */

const FIELD_TOPOLOGY = "field-thirds-v2";
const FIELD_TERRITORIES_CONTRACT = "designpro.atlas-field-territories.v2";
const SURFACE_KEYS = Object.freeze(["driver", "passenger", "hood", "roof", "front", "rear"]);
const CENTER_ROW_ONE = Object.freeze(["roof", "hood", "front"]);
const CENTER_ROW_TWO = Object.freeze(["rear"]);
/** Facing the driver side, the nose is at the viewer's LEFT; passenger, RIGHT. */
const NOSE_EDGE = Object.freeze({ driver: "left", passenger: "right" });
const BLEED_INCHES = 5;
/**
 * A territory's pixel aspect may differ from its print aspect by at most this,
 * OR by what integer pixel rounding on its own two axes can introduce —
 * whichever is larger.
 */
const MAX_ASPECT_ERROR = 0.001;

const round2 = (v) => Math.round(v * 100) / 100;

class FieldTerritoryError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

function aspectTolerance(rect) {
  return Math.max(MAX_ASPECT_ERROR, 1 / rect.w + 1 / rect.h);
}

/** trimRectangle for a rotation-0 territory — the production formula, inlined. */
function fieldTrimRectangle(rect, printWidthIn, printHeightIn) {
  const bleedX = Math.round(BLEED_INCHES * rect.w / printWidthIn);
  const bleedY = Math.round(BLEED_INCHES * rect.h / printHeightIn);
  return { x: rect.x + bleedX, y: rect.y + bleedY, w: Math.max(1, rect.w - bleedX * 2), h: Math.max(1, rect.h - bleedY * 2) };
}

/** Shared borders between territories, derived from the rects themselves. */
function internalBoundaries(zones) {
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

function legacyZoneMap(manifest) {
  const zones = Array.isArray(manifest?.zones) ? manifest.zones : [];
  const byKey = new Map(zones.map((zone) => [zone.surfaceKey, zone]));
  for (const key of SURFACE_KEYS) {
    const zone = byKey.get(key);
    if (!zone || !(zone.printWidthIn > 0) || !(zone.printHeightIn > 0)) {
      throw new FieldTerritoryError(`atlas_field_legacy_zone_missing:${key}`);
    }
  }
  return byKey;
}

/**
 * Three horizontal thirds. The two flank bands share one exact height so the
 * Driver and Passenger files are the same pixel size; the centre band takes
 * the remainder (one pixel more on a 4096 canvas).
 */
function thirdBands(H) {
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
 * @returns a manifest of the SAME zone shape `cutCallOnePanels`,
 *   `normalizeAtlasMaster`, `deterministicMasterChecks` and the guide renderers
 *   read, with `topology: "field-thirds-v2"`, rotation 0 everywhere, and a
 *   `fieldLayout` receipt (thirds, extracted/unextracted area, boundaries).
 */
function buildFieldTerritories(legacyManifest) {
  const canvas = legacyManifest?.canvas;
  const W = Number(canvas?.widthPx);
  const H = Number(canvas?.heightPx);
  if (!(W > 0 && H > 0)) throw new FieldTerritoryError("atlas_field_canvas_unreadable");
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
  // them by a short monotone iteration.
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
  if (!placed) throw new FieldTerritoryError("atlas_field_center_band_unsettled");
  for (const [key, rect] of placed.rowRects) rects.set(key, rect);
  rects.set("rear", placed.rear);

  // ── the zone objects, same shape as production, rotation 0 ───────────────
  const zones = legacyManifest.zones.map((z) => {
    const rect = rects.get(z.surfaceKey);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.w > W || rect.y + rect.h > H || rect.w < 1 || rect.h < 1) {
      throw new FieldTerritoryError(`atlas_field_zone_out_of_bounds:${z.surfaceKey}:${JSON.stringify(rect)}`);
    }
    const aspectError = Math.abs((rect.w / rect.h) / (z.printWidthIn / z.printHeightIn) - 1);
    if (aspectError > aspectTolerance(rect)) {
      throw new FieldTerritoryError(`atlas_field_zone_aspect_drift:${z.surfaceKey}:${aspectError.toFixed(5)}:tolerance=${aspectTolerance(rect).toFixed(5)}`);
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
      if (overlap) throw new FieldTerritoryError(`atlas_field_zones_overlap:${a.surfaceKey}:${b.surfaceKey}`);
    }
  }
  const d = zones.find((z) => z.surfaceKey === "driver");
  const p = zones.find((z) => z.surfaceKey === "passenger");
  if (d.w !== p.w || d.h !== p.h) throw new FieldTerritoryError("atlas_field_flank_files_differ_in_size");

  const extractedPx = zones.reduce((t, z) => t + z.w * z.h, 0);
  const canvasPx = W * H;
  return {
    ...legacyManifest,
    contract: FIELD_TERRITORIES_CONTRACT,
    topology: FIELD_TOPOLOGY,
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
      contract: FIELD_TERRITORIES_CONTRACT,
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

module.exports = {
  FIELD_TOPOLOGY,
  FIELD_TERRITORIES_CONTRACT,
  NOSE_EDGE,
  BLEED_INCHES,
  SURFACE_KEYS,
  FieldTerritoryError,
  aspectTolerance,
  fieldTrimRectangle,
  internalBoundaries,
  thirdBands,
  buildFieldTerritories,
};
