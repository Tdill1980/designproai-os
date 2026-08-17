"use strict";

/**
 * The call site for the canonical Design Master producer.
 *
 * The producer, the renderer, the 2D proof and the approval gate were all built
 * already (design-master-author, design-master-renderer, master-proof-sheet,
 * design-revision-cycle). What was missing was the thing that runs them for a
 * workflow run: their only callers were the canary and their own tests. This
 * module is that caller, and nothing more. It does not re-implement any rule
 * those modules own, because a second implementation of a fail-closed check is
 * one implementation and one liability.
 *
 * WHAT THIS REPLACES. Call 9 used to cut six panels out of one authored atlas
 * -- a flat wrap layout image -- with a geometric crop. Every panel was a region
 * of one shared picture, so a panel was only ever as correct as the atlas's
 * layout, and a side whose region drifted shipped the wrong artwork at exactly
 * the right dimensions. The database already refuses that model: the Call 9
 * completion contract requires
 *
 *     sourceRule = 'one-own-surface-region-per-output-side'
 *
 * which the atlas cut could never satisfy. Each surface is now rendered from
 * the canonical master in its own right, and Call 9 consumes those six surfaces
 * directly. No atlas, no crop, no generative pass.
 *
 * ASSET BYTES ARE VERIFIED, NEVER TRUSTED. Every asset and font the master names
 * carries a digest. They are fetched by storage path and re-hashed here before
 * the renderer sees them, so a file swapped underneath an approved design fails
 * closed instead of printing.
 */

const { createHash } = require("node:crypto");
const { authorDesignMaster } = require("./design-master-author.cjs");
const { proceduralViewPlates } = require("./procedural-view-plates.cjs");
const { runOriginCycle } = require("./design-revision-cycle.cjs");

const MASTER_CYCLE_CONTRACT = "designpro.master-cycle-call-site.v1";

// The authoring input a design carries beyond its canonical strings and logos:
// creative direction and the placement of it. It is frozen into the revision
// snapshot with everything else, because it decides what prints.
const DESIGN_MASTER_INPUT_KEY = "designMaster";

class MasterCycleError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "MasterCycleError";
  }
}

function fail(code, message) {
  throw new MasterCycleError(code, message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A UUID derived from a digest.
 *
 * Identity fields the master requires but that a run does not carry -- the
 * design space, each surface mapping -- are derived from material the run DOES
 * carry, so re-running a stage produces the same master rather than a new one
 * that differs only in its identifiers.
 */
function uuidFromHash(hash) {
  const text = String(hash).slice(0, 32).split("");
  text[12] = "5";
  text[16] = ["8", "9", "a", "b"][parseInt(text[16], 16) % 4];
  const value = text.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

/**
 * The frozen authoring input, or a precise refusal.
 *
 * A run whose revision never froze one cannot be manufactured: there is no
 * canonical design to render. That is stated plainly rather than filled in with
 * a default, because a default here would be this system inventing the
 * customer's artwork.
 */
function designMasterInput(snapshot) {
  const input = snapshot?.[DESIGN_MASTER_INPUT_KEY];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("call8_design_master_input_missing",
      `the frozen revision snapshot carries no ${DESIGN_MASTER_INPUT_KEY} authoring input, so there is no canonical design to render`);
  }
  if (!Array.isArray(input.creativeAssets) || !input.creativeAssets.length) {
    fail("call8_design_master_creative_missing", "the frozen authoring input places no creative asset");
  }
  if (!input.composition || !Array.isArray(input.composition.layers) || !input.composition.layers.length) {
    fail("call8_design_master_composition_missing", "the frozen authoring input carries no composition");
  }
  return input;
}

/**
 * Author the canonical master for a run from its frozen sources.
 *
 * Identity comes from the run and the bound manifest; the design comes from the
 * frozen snapshot. Nothing is read from anywhere else, so two workers running
 * this stage for the same run author the identical master.
 */
function authorRunMaster({ run, manifest, snapshot }) {
  const input = designMasterInput(snapshot);
  const manifestHash = String(run.manifest_hash || "").toLowerCase();
  const surfaceMappings = Object.fromEntries((manifest.expectedSurfaces || []).map((surface) => {
    const material = sha256(Buffer.from(`${run.revision_id}:${manifestHash}:${surface.surfaceKey}`));
    return [surface.surfaceKey, { mappingId: uuidFromHash(material), mappingHash: material }];
  }));
  try {
    // authorDesignMaster returns { master, assetSources }; the master alone is
    // the canonical object every downstream consumer validates against
    // DESIGN_MASTER_CONTRACT, and its asset table already carries the
    // storagePath + contentHash the verified loaders fetch by. Returning the
    // wrapper undetected was live failure render_master_invalid (canary
    // 32070044230).
    return authorDesignMaster({
      identity: {
        masterId: uuidFromHash(sha256(Buffer.from(`master:${run.revision_id}:${manifestHash}`))),
        revisionId: run.revision_id,
        vehicleId: uuidFromHash(sha256(Buffer.from(`vehicle:${manifestHash}`))),
        dimensionManifestId: run.dimension_manifest_id,
        manifestHash,
        designSpaceId: uuidFromHash(sha256(Buffer.from(`space:${run.revision_id}:${manifestHash}`))),
        surfaceMappings,
      },
      revisionSnapshot: snapshot,
      manifest,
      creativeBrief: input.creativeBrief,
      creativeAssets: input.creativeAssets,
      composition: input.composition,
      typography: input.typography,
      logoPlacements: input.logoPlacements,
      palette: input.palette,
      fonts: input.fonts,
    }).master;
  } catch (error) {
    fail(String(error?.code || "call8_design_master_author_failed"), String(error?.message || error));
  }
}

/**
 * Fetch-and-verify for everything the renderer reads.
 *
 * The master names each asset by storage path AND digest. Bytes that do not
 * hash to what the design says they are never reach the renderer.
 */
function verifiedLoaders({ master, plateAssets, download }) {
  const byId = new Map((master.assets || []).map((asset) => [asset.assetId, asset]));
  const fontById = new Map((master.fonts || []).map((font) => [font.fontId, font]));

  const fetchVerified = async (storagePath, expectedHash, label) => {
    const bytes = await download(storagePath);
    const observed = sha256(bytes);
    if (observed !== String(expectedHash).toLowerCase()) {
      fail("call8_asset_bytes_drift", `${label} at ${storagePath} no longer hashes to what the design says it is`);
    }
    return bytes;
  };

  return {
    loadAsset: async (ref) => {
      const assetId = typeof ref === "string" ? ref : ref?.assetId;
      // The plate layers are presentation-only and are produced in-process, so
      // they are already bytes and have no storage identity to verify.
      if (plateAssets && plateAssets.has(assetId)) return plateAssets.get(assetId);
      const asset = byId.get(assetId);
      if (!asset) fail("call8_asset_unknown", `the design references asset ${assetId}, which its own asset table does not carry`);
      return fetchVerified(asset.storagePath, asset.contentHash, `asset ${assetId}`);
    },
    loadFont: async (ref) => {
      const fontId = typeof ref === "string" ? ref : ref?.fontId;
      const font = fontById.get(fontId) || (master.fonts || [])[0];
      if (!font) fail("call8_font_missing", "the design places text but pins no font file");
      return fetchVerified(font.storagePath, font.contentHash, `font ${font.fontId}`);
    },
  };
}

/**
 * Run the canonical chain for one workflow run:
 *   frozen snapshot + bound manifest
 *     -> canonical Design Master        (design-master-author)
 *     -> six deterministic surfaces     (design-master-renderer)
 *     -> 2D production proof            (master-proof-sheet)
 *
 * The 3D proof is attempted and is allowed to fail: it is presentation, and the
 * cycle records why it is absent rather than refusing to manufacture.
 */
async function buildMasterCycle({ run, manifest, snapshot, download, pxPerInch, bleedInches = 5, proofFont, vehicle, designName, finish, orderNumber }) {
  const master = authorRunMaster({ run, manifest, snapshot });

  let plateSet = null;
  let plateFailure = null;
  try {
    plateSet = await proceduralViewPlates({
      manifest,
      plateSetId: uuidFromHash(sha256(Buffer.from(`plates:${run.revision_id}:${master.masterHash}`))),
      vehicleId: uuidFromHash(sha256(Buffer.from(`vehicle:${String(run.manifest_hash || "").toLowerCase()}`))),
      dimensionManifestId: run.dimension_manifest_id,
      manifestHash: String(run.manifest_hash || "").toLowerCase(),
    });
  } catch (error) {
    // Presentation plates are not manufacturing authority and never were; a
    // plate set that will not build costs the 3D proof, not the print run.
    plateFailure = { code: String(error?.code || "plates_failed"), message: String(error?.message || error) };
  }

  const { loadAsset, loadFont } = verifiedLoaders({ master, plateAssets: plateSet?.assets || null, download });

  // The proof page is typeset from the same pinned file the artwork is, fetched
  // and verified the same way. A family name would resolve through fontconfig
  // and substitute, which is how a proof ends up showing letterforms the panels
  // do not carry.
  const pinnedFont = (master.fonts || [])[0];
  const proofFace = proofFont || (pinnedFont ? await loadFont(pinnedFont.fontId) : null);
  if (!Buffer.isBuffer(proofFace) || !proofFace.length) {
    fail("call8_proof_font_missing", "the design pins no font file for the 2D proof to be typeset from");
  }

  let cycle;
  try {
    cycle = await runOriginCycle({
      master,
      manifest,
      plates: plateSet?.plates || null,
      loadAsset,
      loadFont,
      proofFonts: { regular: proofFace },
      pxPerInch,
      bleedInches,
      vehicle,
      designName,
      finish,
      designId: master.designId,
      orderNumber,
    });
  } catch (error) {
    fail(String(error?.code || "call8_master_cycle_failed"), String(error?.message || error));
  }

  return {
    contract: MASTER_CYCLE_CONTRACT,
    master,
    cycle,
    surfaces: cycle.render.surfaces,
    proof2d: cycle.proof2d,
    presentation3d: cycle.presentation3d === true,
    presentationFailure: cycle.presentationFailure || plateFailure || null,
  };
}

module.exports = {
  MASTER_CYCLE_CONTRACT,
  DESIGN_MASTER_INPUT_KEY,
  MasterCycleError,
  authorRunMaster,
  buildMasterCycle,
  _test: { designMasterInput, uuidFromHash, verifiedLoaders },
};
