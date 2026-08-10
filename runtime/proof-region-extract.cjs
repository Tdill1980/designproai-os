"use strict";

/**
 * RUNG 0 of the DesignProAI panel ladder.
 *
 * A production panel is an exact, named, integer-pixel crop of the frozen
 * Call 8 flat 2D proof, rescaled once onto validated GENIE trim-plus-bleed
 * geometry. Nothing in this module talks to an image model, mirror-fills a
 * margin, heals an edge, or otherwise invents a production pixel: the same
 * frozen proof bytes and the same named region always produce the same panel
 * bytes.
 *
 * Byte hashes alone cannot detect the failure this module exists to stop.
 * Two independent repaints of the same driver flank are never byte-identical,
 * so SHA-256 uniqueness passes while six panels show one surface. Every tile
 * therefore also carries a structural + colour fingerprint, and its mirror,
 * so a repeated (or mirrored) driver surface fails closed.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const PROOF_REGION_MAP_CONTRACT = "designpro.call8-proof-region-map.v1";
const PROOF_TILE_CONTRACT = "designpro.call8-proof-tile.v1";
const PANEL_EXTRACT_CONTRACT = "designpro.call9-proof-region-extract.v1";
const PIXELS_PER_INCH = 150;
const BLEED_INCHES = 5;
const MAX_ASPECT_DRIFT_PPM = 2000;
const MAX_REGION_PIXELS = 650_000_000;
const FINGERPRINT_BITS = 320;
const FINGERPRINT_HEX_LENGTH = FINGERPRINT_BITS / 4;
const MIN_SURFACE_FINGERPRINT_DISTANCE = 16;
const HASH_RE = /^[0-9a-f]{64}$/;
const FINGERPRINT_RE = new RegExp(`^[0-9a-f]{${FINGERPRINT_HEX_LENGTH}}$`);
const POPCOUNT = Uint8Array.from({ length: 256 }, (_unused, value) => {
  let bits = 0;
  for (let index = 0; index < 8; index += 1) bits += (value >> index) & 1;
  return bits;
});

class ProofRegionError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

/**
 * The one named region of a flat proof source that carries this surface.
 *
 * The rect is the largest centred rectangle whose aspect matches the validated
 * trim-plus-bleed aspect, so the whole panel — trim and all four bleed inches —
 * is real artwork. No pixel is mirrored, padded, or generated to fill it.
 */
function namedRegionRect({ sourceWidth, sourceHeight, trimWidthIn, trimHeightIn, bleedIn = BLEED_INCHES, pixelsPerInch = PIXELS_PER_INCH }) {
  const width = positiveInteger(sourceWidth);
  const height = positiveInteger(sourceHeight);
  const trimWidth = Number(trimWidthIn);
  const trimHeight = Number(trimHeightIn);
  const bleed = Number(bleedIn);
  const ppi = positiveInteger(pixelsPerInch);
  if (!width || !height || !ppi || !(trimWidth > 0 && trimHeight > 0) || bleed !== BLEED_INCHES) {
    throw new ProofRegionError("proof_region_geometry_invalid", "A named proof region requires pixel source geometry, positive trim inches, and exactly 5 inches of bleed");
  }
  const targetWidth = Math.round((trimWidth + bleed * 2) * ppi);
  const targetHeight = Math.round((trimHeight + bleed * 2) * ppi);
  if (!(targetWidth > 0 && targetHeight > 0) || targetWidth * targetHeight > MAX_REGION_PIXELS) {
    throw new ProofRegionError("proof_region_geometry_invalid", "Validated GENIE geometry is outside the bounded region budget");
  }
  const targetAspect = targetWidth / targetHeight;
  let regionWidth = width;
  let regionHeight = Math.round(width / targetAspect);
  if (regionHeight > height) {
    regionHeight = height;
    regionWidth = Math.round(height * targetAspect);
  }
  regionWidth = Math.max(1, Math.min(width, regionWidth));
  regionHeight = Math.max(1, Math.min(height, regionHeight));
  const aspectDriftPpm = Math.round(Math.abs((regionWidth / regionHeight) - targetAspect) / targetAspect * 1_000_000);
  if (aspectDriftPpm > MAX_ASPECT_DRIFT_PPM) {
    throw new ProofRegionError("proof_region_aspect_drift", `Named region aspect drifts ${aspectDriftPpm}ppm from validated GENIE geometry`);
  }
  return Object.freeze({
    contract: PANEL_EXTRACT_CONTRACT,
    sourceWidth: width,
    sourceHeight: height,
    left: Math.floor((width - regionWidth) / 2),
    top: Math.floor((height - regionHeight) / 2),
    width: regionWidth,
    height: regionHeight,
    targetWidth,
    targetHeight,
    aspectDriftPpm,
    pixelsPerInch: ppi,
    resample: "lanczos3",
    fit: "exact-named-region-no-padding",
  });
}

/** The trim rectangle inside a finished panel, for PanelPro trim marks. */
function trimRectangle({ trimWidthIn, trimHeightIn, bleedIn = BLEED_INCHES, pixelsPerInch = PIXELS_PER_INCH }) {
  const inset = Math.round(Number(bleedIn) * Number(pixelsPerInch));
  return Object.freeze({
    left: inset,
    top: inset,
    width: Math.round(Number(trimWidthIn) * Number(pixelsPerInch)),
    height: Math.round(Number(trimHeightIn) * Number(pixelsPerInch)),
  });
}

function assertRegion(value) {
  const region = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const fields = region ? ["sourceWidth", "sourceHeight", "left", "top", "width", "height", "targetWidth", "targetHeight"]
    .map((key) => [key, Number(region[key])]) : [];
  if (!region || region.contract !== PANEL_EXTRACT_CONTRACT
    || fields.some(([key, number]) => !Number.isSafeInteger(number) || number < (key === "left" || key === "top" ? 0 : 1))
    || Number(region.left) + Number(region.width) > Number(region.sourceWidth)
    || Number(region.top) + Number(region.height) > Number(region.sourceHeight)) {
    throw new ProofRegionError("proof_region_invalid", "Named proof region is missing or outside its frozen source");
  }
  return region;
}

/**
 * Deterministic extraction. Same bytes plus same region always yield the same
 * panel bytes, on Call 8 authoring and on every later Call 9 verification.
 */
async function extractNamedRegion(bytes, region) {
  const rect = assertRegion(region);
  const metadata = await sharp(bytes, { limitInputPixels: false }).metadata();
  if (metadata.width !== rect.sourceWidth || metadata.height !== rect.sourceHeight) {
    throw new ProofRegionError("proof_region_source_geometry_drift", "The frozen flat proof source no longer has the geometry its region map recorded");
  }
  return sharp(bytes, { limitInputPixels: false })
    .extract({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
    .resize(rect.targetWidth, rect.targetHeight, { fit: "fill", kernel: "lanczos3" })
    .flatten({ background: "#ffffff" })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

function grayCode(value) {
  return value ^ (value >> 1);
}

function packBits(bits) {
  const bytes = Buffer.alloc(bits.length / 8);
  for (let index = 0; index < bits.length; index += 1) {
    if (bits[index]) bytes[index >> 3] |= 0x80 >> (index & 7);
  }
  return bytes.toString("hex");
}

/**
 * 320-bit surface fingerprint: 128 structural bits (horizontal and vertical
 * greyscale gradients) plus 192 colour bits (4x4 grid, Gray-coded so adjacent
 * tones differ by one bit). Structure alone treats two solid colours as equal;
 * colour alone treats two recolours of one design as different. Together they
 * answer the only question that matters here — is this the same artwork.
 */
async function surfaceFingerprint(bytes) {
  const opaque = sharp(bytes, { limitInputPixels: false }).flatten({ background: "#ffffff" }).removeAlpha();
  const gradient = await opaque.clone().greyscale().resize(9, 9, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const cells = await opaque.clone().resize(4, 4, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  if (gradient.length !== 81 || cells.length !== 48) {
    throw new ProofRegionError("surface_fingerprint_failed", "Surface fingerprint sampling returned unexpected geometry");
  }
  const bits = [];
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bits.push(gradient[y * 9 + x] > gradient[y * 9 + x + 1] ? 1 : 0);
  for (let y = 0; y < 8; y += 1) for (let x = 0; x < 8; x += 1) bits.push(gradient[y * 9 + x] > gradient[(y + 1) * 9 + x] ? 1 : 0);
  for (const sample of cells) {
    const code = grayCode(sample >> 4);
    for (let bit = 3; bit >= 0; bit -= 1) bits.push((code >> bit) & 1);
  }
  if (bits.length !== FINGERPRINT_BITS) throw new ProofRegionError("surface_fingerprint_failed", "Surface fingerprint width changed");
  return packBits(bits);
}

/** The same fingerprint for the mirrored surface, so flipped reuse is caught. */
async function mirroredSurfaceFingerprint(bytes) {
  return surfaceFingerprint(await sharp(bytes, { limitInputPixels: false }).flop().png().toBuffer());
}

function hammingDistance(left, right) {
  if (!FINGERPRINT_RE.test(String(left)) || !FINGERPRINT_RE.test(String(right))) {
    throw new ProofRegionError("surface_fingerprint_invalid", "A surface fingerprint is missing or malformed");
  }
  const a = Buffer.from(String(left), "hex");
  const b = Buffer.from(String(right), "hex");
  let distance = 0;
  for (let index = 0; index < a.length; index += 1) distance += POPCOUNT[a[index] ^ b[index]];
  return distance;
}

/**
 * The gate that stops "six panels, one driver side". Surfaces are compared as
 * images, directly and mirrored, not as byte hashes.
 */
function assertDistinctSurfaces(surfaces, minDistance = MIN_SURFACE_FINGERPRINT_DISTANCE) {
  const rows = Array.isArray(surfaces) ? surfaces : [];
  if (rows.length < 2) throw new ProofRegionError("surface_uniqueness_input_invalid", "Surface uniqueness needs the full surface set");
  const distances = [];
  for (let left = 0; left < rows.length; left += 1) {
    for (let right = left + 1; right < rows.length; right += 1) {
      const a = rows[left];
      const b = rows[right];
      const direct = hammingDistance(a.fingerprint, b.fingerprint);
      const mirrored = a.mirrorFingerprint ? hammingDistance(a.mirrorFingerprint, b.fingerprint) : Number.POSITIVE_INFINITY;
      const relationship = mirrored < direct ? "mirror" : "duplicate";
      const distance = Math.min(direct, mirrored);
      if (distance < minDistance) {
        const pair = `${a.surfaceKey} and ${b.surfaceKey}`;
        const isFlank = new Set([String(a.surfaceKey), String(b.surfaceKey)]).size === 2
          && ["driver", "passenger"].every((key) => [String(a.surfaceKey), String(b.surfaceKey)].includes(key));
        throw new ProofRegionError(
          isFlank ? "call9_driver_passenger_visual_reuse" : "call9_surface_visual_reuse",
          `${pair} carry the same artwork (${relationship}, fingerprint distance ${distance} < ${minDistance}); each surface must come from its own accepted flat source`,
        );
      }
      distances.push({ surfaces: [String(a.surfaceKey), String(b.surfaceKey)], direct, mirrored: Number.isFinite(mirrored) ? mirrored : null });
    }
  }
  return Object.freeze({ verified: true, minDistance, observedMinimum: Math.min(...distances.map((item) => Math.min(item.direct, item.mirrored ?? item.direct))), pairs: distances });
}

function assertProofTile(value, surfaceKey) {
  const tile = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  if (!tile || tile.contract !== PROOF_TILE_CONTRACT || String(tile.tileKey) !== String(surfaceKey)
    || !HASH_RE.test(String(tile.flatSourceSha256 || "")) || !HASH_RE.test(String(tile.masterSha256 || ""))
    || !HASH_RE.test(String(tile.ownSourceViewSha256 || "")) || !HASH_RE.test(String(tile.previewSha256 || ""))
    || !FINGERPRINT_RE.test(String(tile.fingerprint || "")) || !FINGERPRINT_RE.test(String(tile.mirrorFingerprint || ""))
    || String(tile.ownSourceViewKey) !== String(surfaceKey)
    || Number(tile.bleedIn) !== BLEED_INCHES || !(Number(tile.trimWidthIn) > 0 && Number(tile.trimHeightIn) > 0)
    || !String(tile.flatSourcePath || "").trim() || !String(tile.masterPath || "").trim()) {
    throw new ProofRegionError("call9_proof_tile_invalid", `The frozen Call 8 proof tile for ${surfaceKey} is missing or incomplete`);
  }
  assertRegion(tile.region);
  const preview = tile.previewRect;
  if (!preview || ["left", "top", "width", "height"].some((key) => !Number.isSafeInteger(Number(preview[key])) || Number(preview[key]) < 0)) {
    throw new ProofRegionError("call9_proof_tile_invalid", `The frozen Call 8 proof tile for ${surfaceKey} has no displayed proof rectangle`);
  }
  return tile;
}

function assertProofRegionMap(value, surfaceKeys) {
  const map = value && typeof value === "object" && !Array.isArray(value) ? value : null;
  const keys = Array.isArray(surfaceKeys) ? surfaceKeys : [];
  if (!map || map.contract !== PROOF_REGION_MAP_CONTRACT || !Array.isArray(map.tiles) || map.tiles.length !== keys.length
    || Number(map.pixelsPerInch) !== PIXELS_PER_INCH || !HASH_RE.test(String(map.flatMaterialHash || ""))) {
    throw new ProofRegionError("call9_proof_region_map_missing", "Call 9 requires the frozen Call 8 proof region map for exactly the six production surfaces");
  }
  const byKey = new Map();
  for (const key of keys) {
    const tile = map.tiles.find((item) => String(item?.tileKey) === key);
    byKey.set(key, assertProofTile(tile, key));
  }
  if (new Set([...byKey.values()].map((tile) => tile.flatSourceSha256)).size !== keys.length
    || new Set([...byKey.values()].map((tile) => tile.masterSha256)).size !== keys.length
    || new Set([...byKey.values()].map((tile) => tile.ownSourceViewSha256)).size !== keys.length) {
    throw new ProofRegionError("call9_proof_region_source_reuse", "Every proof tile must bind its own distinct flat source, master, and seven-view render");
  }
  assertDistinctSurfaces([...byKey.values()].map((tile) => ({ surfaceKey: tile.tileKey, fingerprint: tile.fingerprint, mirrorFingerprint: tile.mirrorFingerprint })));
  return Object.freeze({ ...map, byKey });
}

module.exports = {
  BLEED_INCHES,
  FINGERPRINT_BITS,
  MIN_SURFACE_FINGERPRINT_DISTANCE,
  PANEL_EXTRACT_CONTRACT,
  PIXELS_PER_INCH,
  PROOF_REGION_MAP_CONTRACT,
  PROOF_TILE_CONTRACT,
  ProofRegionError,
  assertDistinctSurfaces,
  assertProofRegionMap,
  assertProofTile,
  extractNamedRegion,
  hammingDistance,
  mirroredSurfaceFingerprint,
  namedRegionRect,
  sha256,
  surfaceFingerprint,
  trimRectangle,
  _test: { assertRegion, grayCode, packBits },
};
