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

/** A band is only usable if it lands inside the panel with real area. */
function bandRect(band, width, height) {
  const left = Math.round(Number(band?.xPct) * width);
  const top = Math.round(Number(band?.yPct) * height);
  const bandWidth = Math.round(Number(band?.wPct) * width);
  const bandHeight = Math.round(Number(band?.hPct) * height);
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
  const driverPanel = await sharp(masterBytes, { limitInputPixels: false })
    .extract(region)
    .rotate(rotation)
    .png(PNG_OPTIONS)
    .toBuffer();
  const panelMeta = await sharp(driverPanel).metadata();
  const panelWidth = Number(panelMeta.width);
  const panelHeight = Number(panelMeta.height);

  // THE FLOP IS ITS OWN PASS. sharp does not apply operations in call order —
  // chaining `.flop()` with a resize or rotate runs it in pipeline order, not
  // written order, which is the bug atlas-artwork-compose documents at length.
  let composed = await sharp(driverPanel, { limitInputPixels: false })
    .flop()
    .png(PNG_OPTIONS)
    .toBuffer();

  // Put the lettering back the right way round.
  const overlays = [];
  for (const band of brandBands || []) {
    const rect = bandRect(band, panelWidth, panelHeight);
    if (!rect) continue;
    const slice = await sharp(driverPanel, { limitInputPixels: false })
      .extract(rect)
      .png(PNG_OPTIONS)
      .toBuffer();
    overlays.push({
      input: slice,
      // Where this band's own mirror image landed, so the word sits exactly
      // where the flipped composition put it — just readable.
      left: panelWidth - rect.left - rect.width,
      top: rect.top,
    });
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
    bandsApplied: overlays.length,
    rotation,
    panel: { widthPx: panelWidth, heightPx: panelHeight },
  };
}

module.exports = {
  AtlasMirrorError,
  MIRROR_CONTRACT: "designpro.atlas-passenger-mirror.v1",
  mirrorPassengerFromDriver,
  _test: { bandRect, zoneRotation },
};
