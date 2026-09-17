"use strict";
/**
 * runtime/atlas-master-composite.cjs — ARCHITECTURE_DAG.md §4.6.
 *
 * Layer 0 + Layer 1 = the sheet. Takes the assembled CLEAN master and the
 * lockup plan and composites each element onto the sheet with sharp. Zero AI,
 * zero network, one pass.
 *
 * THE CLEAN MASTER IS PRESERVED BYTE FOR BYTE. Same rule Call 11 already
 * follows for the branded panels: duplicate, modify the duplicate, keep the
 * original. `cleanMasterHash` is what PanelPro and a later element edit floor
 * on, and it is the reason a logo can be MOVED here without smearing — there is
 * nothing to heal, because the base underneath never had type on it.
 *
 * THE COORDINATE TRANSFORM IS THE WHOLE RISK, so it is stated explicitly.
 *
 * The plan's boxes are normalized to the surface's TRIM rectangle in the
 * PANEL'S READING orientation. The sheet stores a flank ROTATED: the manifest
 * says `rotationDegrees`, and extraction restores reading orientation by
 * rotating the crop by `-rotationDegrees`. Therefore reading -> sheet is a
 * rotation by `+rotationDegrees`, and the box must be transformed with it:
 *
 *   rot   0 : sheet = (trim.x + rx,                    trim.y + ry)          size (dw, dh)
 *   rot +90 : sheet = (trim.x + (trim.w - ry - dh),    trim.y + rx)          size (dh, dw)
 *   rot -90 : sheet = (trim.x + ry, trim.y + (trim.h - rx - dw))             size (dh, dw)
 *
 * with reading size (RW, RH) = rotated ? (trim.h, trim.w) : (trim.w, trim.h).
 *
 * Getting this wrong puts the company name in the wrong place, or mirrored,
 * which is the exact family of defect this whole port exists to end. It is
 * therefore proven by ROUND TRIP in the test: composite, then extract the panel
 * the way the runtime really extracts it, and assert the marker lands on the
 * planned box, un-mirrored.
 *
 * THE ELEMENT IS NEVER FLIPPED. The passenger's BOX is mirrored (the plan does
 * that); the artwork is rotated into sheet orientation and nothing else, so it
 * still reads left to right on the vehicle.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const CONTRACT = "designpro.atlas-master-composite.v1";

class AtlasCompositeError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "AtlasCompositeError";
    this.code = code;
    this.retryable = retryable;
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readingSize(zone) {
  const trim = zone?.trim;
  if (!trim || !(trim.w > 0) || !(trim.h > 0)) {
    throw new AtlasCompositeError("atlas_composite_zone_invalid", `${zone?.surfaceKey}: no usable trim rectangle`);
  }
  const rotation = Number(zone.rotationDegrees) || 0;
  const rotated = Math.abs(rotation) === 90;
  return { trim, rotation, rw: rotated ? trim.h : trim.w, rh: rotated ? trim.w : trim.h };
}

/** Reading-space box -> sheet-space placement. See the header for the algebra. */
function sheetPlacement(zone, box) {
  const { trim, rotation, rw, rh } = readingSize(zone);
  const dw = Math.max(1, Math.round(box.wPct * rw));
  const dh = Math.max(1, Math.round(box.hPct * rh));
  const rx = Math.round(box.xPct * rw);
  const ry = Math.round(box.yPct * rh);

  if (rotation === 90) {
    return { left: trim.x + (trim.w - ry - dh), top: trim.y + rx, drawWidth: dw, drawHeight: dh, rotation };
  }
  if (rotation === -90) {
    return { left: trim.x + ry, top: trim.y + (trim.h - rx - dw), drawWidth: dw, drawHeight: dh, rotation };
  }
  if (rotation !== 0) {
    throw new AtlasCompositeError("atlas_composite_rotation_unsupported", `${zone.surfaceKey}: rotation ${rotation}`);
  }
  return { left: trim.x + rx, top: trim.y + ry, drawWidth: dw, drawHeight: dh, rotation };
}

/**
 * @param {Buffer} cleanMasterBytes   Layer 0, the assembled sheet. NEVER mutated.
 * @param {object[]} zones            the run manifest's zones
 * @param {object} plan               element.lockup's placement manifest
 * @param {Map<string,Buffer>} artwork  role -> element PNG bytes
 */
async function compositeElementsOntoMaster({ cleanMasterBytes, zones = [], plan, artwork } = {}) {
  if (!Buffer.isBuffer(cleanMasterBytes) || !cleanMasterBytes.length) {
    throw new AtlasCompositeError("atlas_composite_master_invalid", "no clean master bytes");
  }
  const cleanMasterHash = sha256(cleanMasterBytes);
  const placements = Array.isArray(plan?.placements) ? plan.placements : [];
  if (!placements.length) {
    // Nothing to place is not a failure; it is a sheet with no elements. The
    // composited master IS the clean one, and both hashes agree.
    return {
      contract: CONTRACT, bytes: cleanMasterBytes, contentHash: cleanMasterHash,
      cleanMasterHash, byteSize: cleanMasterBytes.length, applied: [], changed: false,
    };
  }

  const zoneOf = (surfaceKey) => {
    const zone = zones.find((z) => z?.surfaceKey === surfaceKey);
    if (!zone) throw new AtlasCompositeError("atlas_composite_zone_invalid", `${surfaceKey} zone missing`);
    return zone;
  };

  const layers = [];
  const applied = [];
  for (const placement of placements) {
    const bytes = artwork instanceof Map ? artwork.get(placement.role) : artwork?.[placement.role];
    if (!Buffer.isBuffer(bytes) || !bytes.length) {
      throw new AtlasCompositeError("atlas_composite_element_missing", `${placement.role}: no artwork bytes`, true);
    }
    const zone = zoneOf(placement.surfaceKey);
    const spot = sheetPlacement(zone, placement.box);

    // Resize in READING space, then rotate into sheet orientation. Doing it in
    // this order keeps the element's own aspect the plan computed; rotating
    // first would swap the axes the resize is measured against.
    let prepared = sharp(bytes, { limitInputPixels: false })
      .resize({ width: spot.drawWidth, height: spot.drawHeight, fit: "fill" });
    if (spot.rotation !== 0) prepared = prepared.rotate(spot.rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
    const layer = await prepared.png().toBuffer();

    layers.push({ input: layer, left: spot.left, top: spot.top });
    applied.push({
      surfaceKey: placement.surfaceKey, role: placement.role, contentHash: placement.contentHash,
      box: placement.box, sheet: { ...spot },
      // The BOX is mirrored for the passenger; the artwork never is.
      mirroredFrom: placement.mirroredFrom || null, flipped: false,
    });
  }

  const composited = await sharp(cleanMasterBytes, { limitInputPixels: false })
    .composite(layers)
    .png()
    .toBuffer();

  return {
    contract: CONTRACT,
    bytes: composited,
    contentHash: sha256(composited),
    // PROVENANCE, and a floor. The clean sheet is not replaced by this.
    cleanMasterHash,
    byteSize: composited.length,
    applied,
    changed: true,
  };
}

module.exports = {
  CONTRACT,
  AtlasCompositeError,
  readingSize,
  sheetPlacement,
  compositeElementsOntoMaster,
};
