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

// ONE DEFINITION OF "DARK". The gate's own exported threshold, for the same
// reason the cut-out fill imports it: two definitions would let this module
// call a pixel safe that the gate convicts.
const { FLAT_BLACK_CHANNEL_MAX } = require("./atlas-master-qc.cjs");

const CONTRACT = "designpro.atlas-master-composite.v1";
// A correct composite changes NOTHING outside its own element rectangles, so
// the bound is a rounding allowance, not a tolerance for damage.
const MAX_COMPOSITE_OUTSIDE_DELTA = 0.0001;

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

/**
 * Reading-space box -> sheet-space placement. See the header for the algebra.
 *
 * TWO SIZES COME BACK AND THEY ARE NOT THE SAME NUMBER ON A ROTATED ZONE.
 * `drawWidth`/`drawHeight` are READING space: the compositor resizes to them
 * and only THEN rotates, so they are what `.resize()` must be handed.
 * `sheetWidth`/`sheetHeight` are what the layer actually occupies ON THE SHEET
 * once rotated -- the transpose, for +/-90. Anything measuring, masking or
 * reporting the painted region wants the sheet pair; only the resize wants the
 * reading pair.
 *
 * This distinction was implicit before (the 90-degree branch already derives
 * `left` from `dh`, the post-rotation width) and `darkDeltaOutside` read the
 * reading pair as though it were the sheet pair -- masking the transpose of the
 * region the composite had just painted. On the two flanks, which are the only
 * surfaces the element graph ever touches and are always rotated, that made a
 * correct composite convict itself. Live: element run ac8ab0a0, 2026-09-18.
 */
function sheetPlacement(zone, box) {
  const { trim, rotation, rw, rh } = readingSize(zone);
  const dw = Math.max(1, Math.round(box.wPct * rw));
  const dh = Math.max(1, Math.round(box.hPct * rh));
  const rx = Math.round(box.xPct * rw);
  const ry = Math.round(box.yPct * rh);
  // A quarter turn swaps the axes; anything else here is refused below.
  const turned = Math.abs(rotation) === 90;
  const footprint = { sheetWidth: turned ? dh : dw, sheetHeight: turned ? dw : dh };

  if (rotation === 90) {
    return { left: trim.x + (trim.w - ry - dh), top: trim.y + rx, drawWidth: dw, drawHeight: dh, ...footprint, rotation };
  }
  if (rotation === -90) {
    return { left: trim.x + ry, top: trim.y + (trim.h - rx - dw), drawWidth: dw, drawHeight: dh, ...footprint, rotation };
  }
  if (rotation !== 0) {
    throw new AtlasCompositeError("atlas_composite_rotation_unsupported", `${zone.surfaceKey}: rotation ${rotation}`);
  }
  return { left: trim.x + rx, top: trim.y + ry, drawWidth: dw, drawHeight: dh, ...footprint, rotation };
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

  // THE COMPOSITE MAY NEVER TRIP THE HOLE GATE (owner, 2026-09-17: "assembles
  // them deterministically without tripping the hole gate").
  //
  // Layer 0 has already passed the gates when it arrives here. Layer 1 is dark
  // ink -- a company name set in black is exactly the shape the cut-out
  // detector convicts: a concentrated near-black component. So compositing
  // lettering onto an accepted sheet could, in principle, make an accepted
  // master read as holed, and the customer would lose a design that was fine.
  //
  // It is measured rather than assumed, on the SAME predicate the gate uses
  // (atlas-master-qc's exported thresholds -- one definition of "hole", the
  // standing rule in this repo). Ink ADDED inside a rectangle the system itself
  // placed is not missing artwork; it is the artwork. So the delta is computed
  // OUTSIDE every placed element, where a composite has no business changing
  // anything at all.
  //
  // A non-zero delta there means the composite damaged the base, which is a
  // defect in this module, not a refusal for the sheet -- so it fails closed to
  // Layer 0 rather than shipping a sheet it just broke. On every correct
  // composite the delta is exactly zero and this costs one measurement.
  const outsideDelta = await darkDeltaOutside(cleanMasterBytes, composited, applied);
  if (outsideDelta > MAX_COMPOSITE_OUTSIDE_DELTA) {
    throw new AtlasCompositeError(
      "atlas_composite_altered_base",
      `composite changed ${(outsideDelta * 100).toFixed(4)}% of the sheet outside its own elements`,
      false,
    );
  }

  return {
    contract: CONTRACT,
    bytes: composited,
    contentHash: sha256(composited),
    // PROVENANCE, and a floor. The clean sheet is not replaced by this.
    cleanMasterHash,
    byteSize: composited.length,
    applied,
    // THE RECEIPT THE GATE ARGUMENT RESTS ON. `elementRegions` is where Layer 1
    // legitimately darkened the sheet; `outsideDelta` is what it changed
    // anywhere else, which is zero on a correct composite.
    elementRegions: applied.map((item) => ({ surfaceKey: item.surfaceKey, role: item.role, ...item.sheet })),
    outsideDelta,
    changed: true,
  };
}

/**
 * The share of the sheet that became near-black OUTSIDE every placed element.
 *
 * Same predicate as the gate (`nearBlackAt` over atlas-master-qc's thresholds),
 * so "dark" means here exactly what it means where the refusal happens.
 */
async function darkDeltaOutside(beforeBytes, afterBytes, applied) {
  const read = (bytes) => sharp(bytes, { limitInputPixels: false })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [before, after] = await Promise.all([read(beforeBytes), read(afterBytes)]);
  if (before.info.width !== after.info.width || before.info.height !== after.info.height) {
    throw new AtlasCompositeError("atlas_composite_size_drift", "the composite changed the sheet's dimensions", false);
  }
  const { width, height, channels } = after.info;
  // One byte per pixel: inside a placed element, or not.
  const masked = new Uint8Array(width * height);
  for (const item of applied) {
    // THE SHEET FOOTPRINT, never the reading-space draw size. On a rotated
    // flank those are transposed, and masking the transpose makes the
    // composite's own ink read as damage to the base.
    const x0 = Math.max(0, Math.floor(item.sheet.left));
    const y0 = Math.max(0, Math.floor(item.sheet.top));
    const x1 = Math.min(width, Math.ceil(item.sheet.left + item.sheet.sheetWidth));
    const y1 = Math.min(height, Math.ceil(item.sheet.top + item.sheet.sheetHeight));
    for (let y = y0; y < y1; y += 1) masked.fill(1, y * width + x0, y * width + x1);
  }
  const dark = (data, offset) => data[offset] <= FLAT_BLACK_CHANNEL_MAX
    && data[offset + 1] <= FLAT_BLACK_CHANNEL_MAX
    && data[offset + 2] <= FLAT_BLACK_CHANNEL_MAX;
  let changed = 0, considered = 0;
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index]) continue;
    considered += 1;
    const offset = index * channels;
    if (dark(after.data, offset) !== dark(before.data, offset)) changed += 1;
  }
  return considered ? changed / considered : 0;
}

/** Compose the production panels from clean pixels and immutable overlay assets.
 * Source assets remain separate; only this display/print derivative is rasterized.
 * No provider call, inferred logo, background removal, or artwork mirroring.
 */
async function compositeProductionPanels({ backgrounds, assets, placements } = {}) {
  const expected = ["driver", "passenger", "hood", "roof", "front", "rear"];
  if (!Array.isArray(backgrounds) || backgrounds.length !== 6
    || expected.some(key => backgrounds.filter(p => p.surfaceKey === key).length !== 1)) {
    throw new AtlasCompositeError("atlas_composite_surface_set_invalid", "six identified backgrounds are required");
  }
  const originals = new Map();
  for (const asset of assets || []) {
    if (!asset.role || originals.has(asset.role) || !Buffer.isBuffer(asset.bytes)
      || asset.bytes.length !== asset.byteSize || sha256(asset.bytes) !== asset.contentHash) {
      throw new AtlasCompositeError("atlas_composite_asset_identity_mismatch", "overlay identity does not match original bytes");
    }
    originals.set(asset.role, asset);
  }
  if (!originals.size) throw new AtlasCompositeError("atlas_composite_assets_missing", "Zone 3 has no original artwork");
  if (!Array.isArray(placements) || !placements.length) {
    throw new AtlasCompositeError("atlas_composite_placements_missing", "overlay placement plan is required");
  }
  for (const p of placements) {
    if (!expected.includes(p.surfaceKey) || !originals.has(p.role)
      || p.contentHash !== originals.get(p.role).contentHash) {
      throw new AtlasCompositeError("atlas_composite_placement_identity_mismatch", "placement references unknown artwork or surface");
    }
  }
  const panels = [];
  for (const base of backgrounds) {
    const meta = await sharp(base.bytes).metadata();
    const layers = [], applied = [];
    for (const p of placements.filter(item => item.surfaceKey === base.surfaceKey)) {
      const b = p.box;
      if (!b || ![b.xPct,b.yPct,b.wPct,b.hPct].every(Number.isFinite)
        || b.xPct < 0 || b.yPct < 0 || b.wPct <= 0 || b.hPct <= 0
        || b.xPct+b.wPct > 1 || b.yPct+b.hPct > 1 || p.flipped === true) {
        throw new AtlasCompositeError("atlas_composite_bounds_invalid", "overlay leaves its panel or requests a mirror");
      }
      const asset = originals.get(p.role);
      const width = Math.max(1, Math.round(b.wPct * meta.width));
      const height = Math.max(1, Math.round(b.hPct * meta.height));
      const raster = await sharp(asset.bytes, { density: 300, limitInputPixels: 40000000 })
        .rotate().resize(width, height, { fit: "contain", background: {r:0,g:0,b:0,alpha:0} })
        .png().toBuffer();
      const left = Math.round(b.xPct*meta.width), top = Math.round(b.yPct*meta.height);
      if (left+width > meta.width || top+height > meta.height) {
        throw new AtlasCompositeError("atlas_composite_bounds_invalid", "rounded overlay leaves its panel");
      }
      layers.push({input:raster,left,top});
      applied.push({role:p.role,contentHash:asset.contentHash,box:b,flipped:false});
    }
    const bytes = layers.length ? await sharp(base.bytes).composite(layers).png().toBuffer() : base.bytes;
    panels.push({...base, bytes, byteSize:bytes.length, contentHash:sha256(bytes),
      backgroundContentHash:sha256(base.bytes), applied, zone:"zone1", role:"branded"});
  }
  return {contract:"designpro.production-zone-composite.v1", panels,
    placements, deterministic:true, sourceAssetsPreserved:true};
}

module.exports = {
  CONTRACT,
  compositeProductionPanels,
  AtlasCompositeError,
  readingSize,
  sheetPlacement,
  compositeElementsOntoMaster,
};
