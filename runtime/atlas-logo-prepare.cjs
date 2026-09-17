"use strict";
/**
 * runtime/atlas-logo-prepare.cjs — the element graph's LOGO node producer.
 *
 * ARCHITECTURE_DAG.md §4.4. It prepares the customer's uploaded logo as Layer 1
 * artwork. **It never GENERATES a logo.** With no upload it says so, honestly,
 * and the typography lockup is the brand mark — which is what
 * `buildLogoArchitecture()` already directs on the prompt side.
 *
 * THE VERIFICATION IS `verifiedCustomerLogoPart`'s, DELIBERATELY UNCHANGED
 * (`runtime/flat-first-atlas.cjs`). Four checks, same order, same error codes:
 *
 *   1. a URL in the asset is refused outright -- `wrap-files` is private and an
 *      identity that can be re-pointed is not an identity;
 *   2. storagePath + 64-hex contentHash + a positive integer byteSize, or the
 *      identity is incomplete;
 *   3. the downloaded bytes must be exactly byteSize long;
 *   4. and must hash to contentHash.
 *
 * `tests/atlas-logo-prepare.test.mjs` reads flat-first-atlas's own source and
 * asserts these codes still match, because two homes for one rule drift -- this
 * file exists alongside that one, and CLAUDE.md records what that costs.
 *
 * WHAT IT DOES NOT DO: it does not key a white background to transparent. A
 * customer's JPEG logo has no alpha, and inventing one with a flood key is the
 * same fragile move CLAUDE.md already records failing on same-hue artwork (at
 * tolerance 28 it ate an orange mark touching an orange ribbon). The node
 * records `hasAlpha` honestly and lets the composite step and human QC decide.
 */

const { createHash } = require("node:crypto");
const sharp = require("sharp");

const CONTRACT = "designpro.atlas-logo-prepare.v1";
const BUCKET = "wrap-files";
const HASH_RE = /^[0-9a-f]{64}$/;
const URL_KEYS = Object.freeze(["url", "signedUrl", "publicUrl", "downloadUrl"]);
const MAX_PIXELS = 40_000_000;
const MAX_EDGE_PX = 1600;
const PNG_OPTIONS = Object.freeze({ compressionLevel: 6, adaptiveFiltering: false, palette: false, force: true });

class AtlasLogoError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.name = "AtlasLogoError";
    this.code = code;
    this.retryable = retryable;
  }
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** True when the brief carries a logo at all. Absence is a legal answer. */
function hasCustomerLogo(input) {
  return Boolean(input?.logoAsset);
}

/**
 * The identity checks, run WITHOUT touching storage, so the compile step can
 * refuse a malformed asset before a node is ever claimed.
 */
function verifyLogoIdentity(asset) {
  if (!asset) throw new AtlasLogoError("flat_atlas_logo_identity_invalid", "no logo asset");
  if (URL_KEYS.some((key) => asset?.[key] != null)) {
    throw new AtlasLogoError(
      "flat_atlas_logo_identity_invalid",
      "The customer logo must use immutable Storage identity, never a URL",
    );
  }
  const storagePath = String(asset.storagePath || "").trim();
  const contentHash = String(asset.contentHash || "").trim().toLowerCase();
  const byteSize = Number(asset.byteSize);
  if (!storagePath || !HASH_RE.test(contentHash) || !Number.isSafeInteger(byteSize) || byteSize < 1) {
    throw new AtlasLogoError("flat_atlas_logo_identity_invalid", "The customer logo identity is incomplete");
  }
  return { storagePath, contentHash, byteSize };
}

/**
 * Download, prove, condition. The conditioning is `verifiedCustomerLogoPart`'s:
 * EXIF rotate, fit inside 1600x1600 without enlarging, lanczos3, PNG — so alpha
 * survives when the customer's file has it.
 */
async function prepareCustomerLogo({ supabase, asset }) {
  const identity = verifyLogoIdentity(asset);

  const { data, error } = await supabase.storage.from(BUCKET).download(identity.storagePath);
  if (error || !data) {
    throw new AtlasLogoError("flat_atlas_logo_download_failed", error?.message || "Customer logo bytes are missing", true);
  }
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== identity.byteSize || sha256(bytes) !== identity.contentHash) {
    throw new AtlasLogoError(
      "flat_atlas_logo_hash_mismatch",
      "Customer logo bytes do not match the verified request identity",
    );
  }

  const conditioned = await sharp(bytes, { limitInputPixels: MAX_PIXELS, density: 300 })
    .rotate()
    .resize({ width: MAX_EDGE_PX, height: MAX_EDGE_PX, fit: "inside", withoutEnlargement: true, kernel: "lanczos3" })
    .png(PNG_OPTIONS)
    .toBuffer();

  const meta = await sharp(conditioned).metadata();
  return {
    contract: CONTRACT,
    bytes: conditioned,
    contentHash: sha256(conditioned),
    byteSize: conditioned.length,
    width: meta.width || null,
    height: meta.height || null,
    // Recorded, never manufactured. A logo with no alpha is a fact about the
    // customer's file, not a problem for this node to solve with a flood key.
    hasAlpha: Boolean(meta.hasAlpha),
    source: "customer",
    sourceIdentity: identity,
  };
}

module.exports = {
  CONTRACT,
  AtlasLogoError,
  hasCustomerLogo,
  verifyLogoIdentity,
  prepareCustomerLogo,
};
