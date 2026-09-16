"use strict";

/**
 * PASSENGER IS THE DRIVER FLANK, MIRRORED — COMPOSED IN CODE, NOT REQUESTED.
 *
 * Owner directive 2026-08-27: "STOP RELYING ON GEMINI TO SOLVE PRODUCTION
 * LETTERING ORIENTATION ... exact text rendering/orientation for each ATLAS
 * surface must be deterministic after the creative call."
 *
 * The evidence that forced it, four live canaries on one vehicle:
 *
 *   6c1bfae6  "The 'Flamingo Pools' text on the passenger side is
 *              backward-reading."
 *   cad013e1  "The passenger side text 'FLAMINGO POOLS' is not forward-reading.
 *              The passenger side flamingo is facing the same direction..."
 *
 * Those two findings together say the model drew the passenger flank as a
 * SECOND, INDEPENDENT composition and got its lettering backward. No amount of
 * corrective prompting moved it, and the master QC was right to refuse every
 * attempt. Asking an image model to author one flattened multi-surface sheet
 * AND orient every piece of production text on it is brittle by construction.
 *
 * WHAT THIS DOES, AND WHY IT MATCHES THE CHECKER EXACTLY
 *
 * `passengerMirrorMae` in atlas-master-qc.cjs compares
 *   flop(rotate(extract(driver)))   against   rotate(extract(passenger))
 * so the passenger zone content this composes is, precisely:
 *   rotate⁻¹( flop( rotate( driverRegion ) ) )
 * which drives that metric to zero on the artwork.
 *
 * THE LETTERING IS THEN PUT BACK FORWARD. Each supplied brand band is lifted
 * from the driver panel and composited UN-FLIPPED at its mirrored position, so
 * a word reads left-to-right on both flanks. That is not a fudge against the
 * mirror check — it is the divergence the check was built to allow. Its own
 * comment says so: the trimmed mean "absorbs one text/logo band's worth of
 * legitimate divergence while a passenger zone that is not actually the
 * driver's twin still differs across nearly the whole zone and still fails".
 *
 * WHAT THIS IS NOT
 *
 * It is not a second design generation. No pixel here is invented: every pixel
 * of the passenger flank is a rearrangement of driver pixels the creative call
 * already authored, under one accepted A.T.L.A.S. revision. The master is never
 * mutated — callers get a new buffer and decide what to persist.
 */

const sharp = require("sharp");

const PNG_OPTIONS = Object.freeze({ compressionLevel: 9, adaptiveFiltering: false });

class AtlasMirrorError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AtlasMirrorError";
    this.code = code;
  }
}

/**
 * The rotation the QC applies before comparing, read the way the QC reads it.
 * `atlas-master-qc` uses `zone.extraction.outputRotationDegrees`;
 * `atlas-artwork-compose` uses `zone.rotationDegrees`. Accept either so a zone
 * shaped by one module is not silently mirrored on the other's convention.
 */
function zoneRotation(zone) {
  const value = Number(
    zone?.extraction?.outputRotationDegrees ?? zone?.rotationDegrees ?? 0,
  );
  if (!Number.isFinite(value)) return 0;
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360;
  return normalized;
}

function findZone(manifest, surfaceKey) {
  const zone = (manifest?.zones || []).find((item) => item?.surfaceKey === surfaceKey);
  if (!zone) {
    throw new AtlasMirrorError(
      "atlas_mirror_zone_missing",
      `The ${surfaceKey} zone is required to compose the passenger flank`,
    );
  }
  return zone;
}

/**
 * A located band is grown by this fraction of the panel on every side before it
 * is lifted. The reader boxes the glyphs tightly; a box that clips the top of a
 * word or the tail of its last letter re-drops a garbled word (live on the 911
 * canary 455b1723: "MARTIN" with a sheared "I"). The pad is small enough that
 * the mirrored artwork around the word still lines up with what the un-flipped
 * slice carries, so the seam stays invisible.
 */
const BAND_PAD_FRACTION = 0.03;
/**
 * The side pad is wider: a logo mark sits beside the lettering, the reader
 * boxes lettering only, and the flood key treats anything touching the rect's
 * border as background. With a 3% side pad the mark straddled the border on
 * the live 7c7bd633 panel and was keyed away, so its reverse stayed on the
 * composed flank beside a forward word. At 8% the mark is inside the rect and
 * survives the key as part of the lockup.
 */
const BAND_PAD_X_FRACTION = 0.08;

/** A band is only usable if it lands inside the panel with real area. */
function bandRect(band, width, height, pad = BAND_PAD_FRACTION, padXFraction = BAND_PAD_X_FRACTION) {
  const padX = Math.round(padXFraction * width);
  const padY = Math.round(pad * height);
  const left = Math.round(Number(band?.xPct) * width) - padX;
  const top = Math.round(Number(band?.yPct) * height) - padY;
  const bandWidth = Math.round(Number(band?.wPct) * width) + 2 * padX;
  const bandHeight = Math.round(Number(band?.hPct) * height) + 2 * padY;
  if (![left, top, bandWidth, bandHeight].every(Number.isFinite)) return null;
  if (bandWidth < 1 || bandHeight < 1) return null;
  const clampedLeft = Math.min(Math.max(0, left), Math.max(0, width - 1));
  const clampedTop = Math.min(Math.max(0, top), Math.max(0, height - 1));
  const clampedWidth = Math.min(bandWidth, width - clampedLeft);
  const clampedHeight = Math.min(bandHeight, height - clampedTop);
  if (clampedWidth < 1 || clampedHeight < 1) return null;
  return { left: clampedLeft, top: clampedTop, width: clampedWidth, height: clampedHeight };
}

/**
 * Bands whose padded rects touch are ONE lockup and move as one. A two-line
 * company lockup read as two bands used to be re-dropped as two slabs, each at
 * its own mirrored offset, so the lines slid apart and overlapped (911 canary
 * 7c7bd633, 2026-09-16: "Precision" and "Climate Solutions" landed 0.15 of the
 * panel apart with the second slab drawn over the first). Iterated to a
 * fixpoint so a chain of touching bands collapses to a single rect.
 */
function unionTouchingRects(rects) {
  const out = rects.map((r) => ({ ...r }));
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        const a = out[i];
        const b = out[j];
        const touches = a.left <= b.left + b.width && b.left <= a.left + a.width
          && a.top <= b.top + b.height && b.top <= a.top + a.height;
        if (!touches) continue;
        const left = Math.min(a.left, b.left);
        const top = Math.min(a.top, b.top);
        out[i] = {
          left, top,
          width: Math.max(a.left + a.width, b.left + b.width) - left,
          height: Math.max(a.top + a.height, b.top + b.height) - top,
        };
        out.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return out;
}

/**
 * RestylePro's cut-to-shape key (src/lib/cut-to-shape.ts, `keyBackgroundFromBorder`):
 * flood inward from every border pixel, comparing each step to the pixel it
 * came from, so a gradient stays background all the way across while a
 * lettering edge stops the walk. Returns a per-pixel background mask.
 */
const KEY_TOLERANCE = 28;
function keyBackgroundFromBorder(rgba, w, h, tolerance = KEY_TOLERANCE) {
  const isBg = new Uint8Array(w * h);
  if (w < 2 || h < 2) return isBg;
  const tol2 = tolerance * tolerance;
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  const push = (idx) => { if (!isBg[idx]) { isBg[idx] = 1; queue[tail++] = idx; } };
  for (let x = 0; x < w; x += 1) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y += 1) { push(y * w); push(y * w + (w - 1)); }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w;
    const y = (idx / w) | 0;
    const i = idx * 4;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    for (let d = 0; d < 4; d += 1) {
      const nx = x + (d === 0 ? -1 : d === 1 ? 1 : 0);
      const ny = y + (d === 2 ? -1 : d === 3 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const nIdx = ny * w + nx;
      if (isBg[nIdx]) continue;
      const ni = nIdx * 4;
      const dr = rgba[ni] - r;
      const dg = rgba[ni + 1] - g;
      const db = rgba[ni + 2] - b;
      if (dr * dr + dg * dg + db * db <= tol2) push(nIdx);
    }
  }
  return isBg;
}

/**
 * THE KEY CALIBRATES ITSELF ON EACH RECT. One tolerance does not fit every
 * wrap: on the live 7c7bd633 lockup, 28 walked from the ribbon into the flame
 * mark and the orange "Precision" fill (same hue) and keyed both away, so the
 * cut lost the mark and its reverse stayed on the flank; 14 and below could
 * not walk the ribbons' gradients, so the ribbons were "kept" out to the
 * rect's edge. 20 gave exactly flame-to-final-letter. The rule that picks 20
 * without being told: try tolerances from tight to loose and take the FIRST
 * at which the kept extent no longer reaches the rect's border -- the point
 * where every background gradient has become walkable and only crisp-edged
 * objects (lettering, marks) survive. Anything looser only eats more of the
 * lockup.
 */
const KEY_TOLERANCES = Object.freeze([10, 14, 20, 24, 28]);
/** Fraction of the panel width kept around the keyed lettering (past the feather) so edges are not clipped. */
const TIGHT_MARGIN_FRACTION = 0.008;
/** Fraction of the panel width over which a re-dropped slice's rim fades into the mirrored artwork. */
const EDGE_FEATHER_FRACTION = 0.006;
const featherPx = (panelWidth) => Math.max(2, Math.round(EDGE_FEATHER_FRACTION * panelWidth));
const marginPx = (panelWidth) => featherPx(panelWidth) + Math.max(2, Math.round(TIGHT_MARGIN_FRACTION * panelWidth));
/** A column (row) is lettering when this fraction of its height (width) survived the key. */
const LETTERING_PROFILE_FRACTION = 0.05;
/** The kept extent must stay this fraction of the rect away from its border for the key to count as calibrated. */
const BORDER_CLEARANCE_FRACTION = 0.02;

/**
 * THE READER'S BOX IS A HINT; THE PIXELS DECIDE THE CUT. Flash boxes are
 * loose: live 7c7bd633 boxed "Climate Solutions" out to x=0.93 where the word
 * ends at 0.76, and boxed the reversed lockup on the composed flank narrower
 * than it is. An opaque slab cut on a loose box lands offset (the lockup's
 * mirror position moves with the box) and leaves reversed glyphs peeking out
 * around a narrow one. Keying the generous rect from its border finds the
 * lockup's own bounding box, so the slice is exactly the lockup and its
 * mirror position is exactly where the flop put the reversed lockup.
 *
 * Projection profiles, not a raw bounding box: the flood cannot cross a
 * crisp one-pixel edge (an anti-aliased diagonal, a ribbon's rim, a hairline
 * of background pattern), and one stray line would pin the box open.
 * Lettering fills whole columns and rows; a stray line adds one pixel to
 * each. Falls back to the generous rect when no tolerance keys the
 * background out to the rect's edge -- the slab still covers every reversed
 * glyph inside it, only less tightly.
 */
async function tightenToLettering(driverPanel, rect, panelWidth = rect.width) {
  const { data, info } = await sharp(driverPanel, { limitInputPixels: false })
    .extract(rect)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  const colThreshold = Math.max(3, Math.round(LETTERING_PROFILE_FRACTION * h));
  const rowThreshold = Math.max(3, Math.round(LETTERING_PROFILE_FRACTION * w));
  for (const tolerance of KEY_TOLERANCES) {
    const isBg = keyBackgroundFromBorder(data, w, h, tolerance);
    const colKept = new Uint32Array(w);
    const rowKept = new Uint32Array(h);
    let kept = 0;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        if (isBg[y * w + x]) continue;
        kept += 1;
        colKept[x] += 1;
        rowKept[y] += 1;
      }
    }
    let minX = -1; let maxX = -1; let minY = -1; let maxY = -1;
    for (let x = 0; x < w; x += 1) if (colKept[x] >= colThreshold) { if (minX < 0) minX = x; maxX = x; }
    for (let y = 0; y < h; y += 1) if (rowKept[y] >= rowThreshold) { if (minY < 0) minY = y; maxY = y; }
    const keptFraction = kept / (w * h);
    if (maxX < 0 || maxY < 0 || keptFraction < 0.002) continue;
    // "Reaches the border" means within a couple of percent of it: a ribbon
    // the flood could not walk is kept right up to the last pixel or two.
    const clearX = Math.max(4, Math.round(BORDER_CLEARANCE_FRACTION * w));
    const clearY = Math.max(4, Math.round(BORDER_CLEARANCE_FRACTION * h));
    const clearOfBorder = minX >= clearX && maxX <= w - 1 - clearX && minY >= clearY && maxY <= h - 1 - clearY;
    if (!clearOfBorder) continue;
    const margin = marginPx(panelWidth);
    const left = Math.max(0, minX - margin);
    const top = Math.max(0, minY - margin);
    const right = Math.min(w - 1, maxX + margin);
    const bottom = Math.min(h - 1, maxY + margin);
    return {
      rect: { left: rect.left + left, top: rect.top + top, width: right - left + 1, height: bottom - top + 1 },
      tightened: true,
      tolerance,
      keptFraction,
    };
  }
  return { rect, tightened: false, tolerance: null, keptFraction: null };
}

/** Fade the outermost `feather` ring of a slice so its seam blends into the mirrored artwork. */
async function featherEdges(sliceBytes, feather = 2) {
  const { data, info } = await sharp(sliceBytes, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  if (w <= 2 * feather + 1 || h <= 2 * feather + 1) return sliceBytes;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      if (edge >= feather) continue;
      const i = (y * w + x) * 4 + 3;
      data[i] = Math.round(data[i] * ((edge + 1) / (feather + 1)));
    }
  }
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png(PNG_OPTIONS).toBuffer();
}

/**
 * One flank in PANEL space — the orientation a person reads it in, which is
 * the space every lettering band is expressed in. The driver panel is what the
 * mirror lifts bands from; the passenger panel, read back after composition,
 * is what the lettering verify inspects. Both go through this one transform so
 * a band measured on either panel lands on the same pixels.
 */
async function extractFlankPanel(masterBytes, manifest, surfaceKey) {
  if (!Buffer.isBuffer(masterBytes) || !masterBytes.length) {
    throw new AtlasMirrorError("atlas_mirror_master_required", "The master bytes are required");
  }
  const zone = findZone(manifest, surfaceKey);
  const rotation = zoneRotation(zone);
  const bytes = await sharp(masterBytes, { limitInputPixels: false })
    .extract({ left: Number(zone.x), top: Number(zone.y), width: Number(zone.w), height: Number(zone.h) })
    .rotate(rotation)
    .png(PNG_OPTIONS)
    .toBuffer();
  const meta = await sharp(bytes).metadata();
  return { bytes, widthPx: Number(meta.width), heightPx: Number(meta.height), rotation, surfaceKey };
}

/**
 * Compose the passenger flank from the driver flank.
 *
 * @param {Buffer} masterBytes  the authored A.T.L.A.S. master — never mutated
 * @param {object} manifest     the GENIE manifest, for the two flank zones
 * @param {Array}  brandBands   normalized rects IN DRIVER PANEL SPACE (after
 *                              the zone's own rotation), each
 *                              { xPct, yPct, wPct, hPct }, whose pixels are
 *                              re-dropped un-flipped so lettering reads forward
 * @returns {{ bytes: Buffer, changed: boolean, bandsApplied: number, rotation: number }}
 */
async function mirrorPassengerFromDriver({ masterBytes, manifest, brandBands = [] } = {}) {
  if (!Buffer.isBuffer(masterBytes) || !masterBytes.length) {
    throw new AtlasMirrorError("atlas_mirror_master_required", "The master bytes are required");
  }
  const driver = findZone(manifest, "driver");
  const passenger = findZone(manifest, "passenger");
  if (Number(driver.w) !== Number(passenger.w) || Number(driver.h) !== Number(passenger.h)) {
    // The QC compares the two zones pixel for pixel after a fixed resize, so
    // unequal zones are a manifest defect, not something to paper over here.
    throw new AtlasMirrorError(
      "atlas_mirror_zone_size_mismatch",
      `driver ${driver.w}x${driver.h} and passenger ${passenger.w}x${passenger.h} must match to be twins`,
    );
  }

  const rotation = zoneRotation(driver);
  const region = {
    left: Number(driver.x), top: Number(driver.y),
    width: Number(driver.w), height: Number(driver.h),
  };

  // Driver in PANEL space — the orientation a person reads the flank in, and
  // the space the supplied bands are expressed in.
  const driverFlank = await extractFlankPanel(masterBytes, manifest, "driver");
  const driverPanel = driverFlank.bytes;
  const panelWidth = driverFlank.widthPx;
  const panelHeight = driverFlank.heightPx;

  // THE FLOP IS ITS OWN PASS. sharp does not apply operations in call order —
  // chaining `.flop()` with a resize or rotate runs it in pipeline order, not
  // written order, which is the bug atlas-artwork-compose documents at length.
  let composed = await sharp(driverPanel, { limitInputPixels: false })
    .flop()
    .png(PNG_OPTIONS)
    .toBuffer();

  // Put the lettering back the right way round: one patch per lockup, cut to
  // the lettering's own extent, dropped un-flipped exactly where the flop put
  // its mirror image so the reversed glyphs are covered and the word reads.
  const overlays = [];
  const patches = [];
  let bandsApplied = 0;
  const rects = [];
  for (const band of brandBands || []) {
    const rect = bandRect(band, panelWidth, panelHeight);
    if (!rect) continue;
    bandsApplied += 1;
    rects.push(rect);
  }
  for (const lockup of unionTouchingRects(rects)) {
    const tight = await tightenToLettering(driverPanel, lockup, panelWidth);
    const rect = tight.rect;
    const slice = await featherEdges(await sharp(driverPanel, { limitInputPixels: false })
      .extract(rect)
      .png(PNG_OPTIONS)
      .toBuffer(), featherPx(panelWidth));
    overlays.push({
      input: slice,
      left: panelWidth - rect.left - rect.width,
      top: rect.top,
    });
    patches.push({ generous: lockup, rect, tightened: tight.tightened, tolerance: tight.tolerance, keptFraction: tight.keptFraction == null ? null : Number(tight.keptFraction.toFixed(4)) });
  }
  if (overlays.length) {
    composed = await sharp(composed, { limitInputPixels: false })
      .composite(overlays)
      .png(PNG_OPTIONS)
      .toBuffer();
  }

  // Back into sheet space, where the passenger zone lives.
  //
  // THE INVERSE BELONGS TO THE PASSENGER ZONE, NOT THE DRIVER'S.
  //
  // This used to undo `rotation` -- the DRIVER's -- on the way back in. The two
  // flanks sit on opposite sides of the sheet and carry opposite rotations
  // (`buildAtlasManifest` fits passenger at +90 and driver at -90), so the
  // checker reads driver with `outputRotationDegrees` +90 and passenger with
  // -90. Undoing the driver's rotation therefore landed the composed flank
  // exactly 180 degrees out, and the master QC -- which compares the passenger
  // zone against the mirrored driver zone after each zone's OWN rotation --
  // could never be satisfied by it.
  //
  // Measured on the live GENIE geometry for a 2018 Transit (zones 1153x2782,
  // driver -90 / passenger +90): the composed passenger panel came back as
  // `flop(rotate180(driver panel))` at MAE 0.000000 against that transform,
  // where the checker requires `flop(driver panel)`. Exactly one 180-degree
  // turn, exactly as the two rotations predict.
  //
  // Live cost: generations f72c10f0-8e36-489f-95c0-da6c55a75c5b and
  // 45f0ea61-0f65-4a30-98c8-f1a0e29f9591 (2026-08-28) both died at Call 1 on
  // `passengerMirrorMae` 0.37993 and 0.39117 -- the repair ran on both, and on
  // both it could not move the number, because the flank it wrote was upside
  // down relative to what the gate measures.
  const passengerInverse = (360 - zoneRotation(passenger)) % 360;
  const zoneBytes = passengerInverse
    ? await sharp(composed, { limitInputPixels: false }).rotate(passengerInverse).png(PNG_OPTIONS).toBuffer()
    : composed;
  const zoneMeta = await sharp(zoneBytes).metadata();
  if (Number(zoneMeta.width) !== region.width || Number(zoneMeta.height) !== region.height) {
    throw new AtlasMirrorError(
      "atlas_mirror_zone_shape_mismatch",
      `composed passenger flank is ${zoneMeta.width}x${zoneMeta.height}, expected ${region.width}x${region.height}`,
    );
  }

  const bytes = await sharp(masterBytes, { limitInputPixels: false })
    .composite([{ input: zoneBytes, left: Number(passenger.x), top: Number(passenger.y) }])
    .png(PNG_OPTIONS)
    .toBuffer();

  return {
    bytes,
    changed: true,
    bandsApplied,
    lockups: overlays.length,
    patches,
    rotation,
    panel: { widthPx: panelWidth, heightPx: panelHeight },
  };
}

module.exports = {
  AtlasMirrorError,
  MIRROR_CONTRACT: "designpro.atlas-passenger-mirror.v1",
  mirrorPassengerFromDriver,
  extractFlankPanel,
  BAND_PAD_FRACTION,
  BAND_PAD_X_FRACTION,
  _test: { bandRect, zoneRotation, unionTouchingRects, keyBackgroundFromBorder, tightenToLettering },
};
