"use strict";

/**
 * Standalone DesignProAI OS claimant.
 *
 * This is the only queue conductor.  Browser code may enqueue work and approve
 * the two explicit human gates, but it cannot execute or complete a stage.
 * Every durable completion is fenced by the database lease and contains
 * byte-hashed evidence persisted in designpro_artifacts.
 */
const { createHash } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const sharp = require("sharp");
const { canonicalTenantKey, immutableStorageUpload, normalizeLogoAsset, normalizeSourceAsset, safeStoragePath, verifySourceBytes } = require("./runtime-contract.cjs");
const { resolveOrQueueUniversalDimensions } = require("./genie-universal-resolver.cjs");
const {
  normalizeTextLock,
  sourceViewKeys,
  SURFACE_KEYS,
  VIEW_KEYS,
} = require("./gemini-flat-surface.cjs");
// Call 8's identity is DETERMINISTIC and carries no model. `flatSurfaceInputHash`
// and `gridSliceAll` are gone from this file with the Gemini flattener they
// served -- see `buildCall8Proof` and the fail-closed arm in `panels.build`.
const { call8ProofMaterialHash, normalizeCallOnePanelSet } = require("./call8-proof-material.cjs");
const { assertRunProductionAncestry } = require("./production-provenance.cjs");
const { PANEL_DATA_SLUG, buildDeterministicRasterEps, createDeterministicZip64Stream, verifyProductionOutputSet } = require("./output-qc.cjs");
const { assertDeliverySnapshot, MANIFEST_CONTRACT } = require("./wrapbox-delivery.cjs");
const { MAX_STANDARD_UPLOAD_BYTES, removeCommittedSpool, spoolDeterministicZip64, spoolImmutableBuffer, uploadSpoolWithTus, verifyStoredArtifact, verifyStoredZip } = require("./zip-spool.cjs");
const { TOPAZ_CONTRACT, enhancePanel, topazReadiness } = require("./topaz-upscale.cjs");
const { CERTIFICATE_CONTRACT, buildQcCertificatePng } = require("./qc-certificate.cjs");
const { isHonestNoOp, locateLogoElements, logoBoxesToPixelRects } = require("./logo-removal.cjs");
// THE PANEL MAP AND THE PANEL DATA SLUG (owner, 2026-09-02). The map is the one
// mapped-metadata record every consumer reads; the slug is the strip rendered
// from it onto every production file and every QC duplicate. docs/PANEL-DATA-SLUG.md.
const { PANEL_MAP_CONTRACT, buildPanelMap, panelMapBytes, parsePanelMap, slugRows } = require("./panel-map.cjs");
const { OUTPUT_SLUG_PIXELS, QC_SLUG_PIXELS, SLUG_INCHES, applyPanelDataSlug, slugMetadata } = require("./panel-data-slug.cjs");

const CLAIM_SECONDS = 900;
const HEARTBEAT_MS = 30_000;
const BUCKET = "wrap-files";
const HASH_RE = /^[0-9a-f]{64}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const stageLeaseContext = new AsyncLocalStorage();
const STAGES = Object.freeze([
  // THE EXTRACTION BRANCH RUNS AHEAD OF THE 2D PROOF.
  //
  // `proof.build` sat second, so `panels.build` -- a pure byte promotion of
  // panels Call 1 already cut and hashed, with no AI in it -- was queued behind
  // an AI proof-sheet render, and `logos.extract` behind them both.
  // `claim_designpro_stage` admits a stage only when every LOWER-sequence stage
  // has completed, and the claimant is single-flight, so that ordering was a
  // hard barrier: every panel and every logo in PanelPro waited on a
  // documentation artifact (owner 2026-08-27: "Nothing in Branch A waits for
  // Branch B... PanelPro updates on each extraction").
  //
  // The real dependencies are preserved exactly. Call 8 needs the frozen
  // revision, which it still has; `pack.verify` is the first stage that reads
  // its receipt, and it still runs after it. See
  // 20260827100000_designpro_panels_do_not_wait_for_the_proof.sql for why this
  // does not weaken RULE 0.25 -- and for the numbering tension it does create.
  "revision.freeze", "panels.build",
  // Call 11 sits between Call 10 and the PanelPro gate: its de-logoed
  // duplicates are what that gate validates against vehicle templates.
  "logos.extract", "panels.delogo", "proof.build", "pack.verify", "pack.activate",
  // The purchase gate leads production. Everything after it is paid work, so
  // nothing expensive sits ahead of it.
  //
  // GENIE DEPLOYS ONLY WHEN THE PRODUCTION PACK IS ORDERED. manifest.resolve
  // used to sit second, in the FREE half, where it parked every run on
  // genie_dimension_validation_required before Call 8 or a single panel
  // existed -- a run sat there sixteen hours on 2026-08-23 and that, not a code
  // bug, is why RevisionStudio had nothing to show. The free half needs no
  // validated production geometry: Call 1 resolves the design-time size of each
  // side and cuts the six panels to it. GENIE resolves the true production
  // dimensions and drives the progress page, and it is paid work, so it belongs
  // behind the gate with the rest of the paid work.
  "await_purchase", "manifest.resolve", "source.verify",
  "await_panelpro_preflight_qc", "enhance.upscale", "output.build", "output.verify",
  "await_final_human_qc", "stamp.build", "zip.build", "wrapbox.deliver",
]);
const RECEIPTS = Object.freeze([
  // A deferred Call 8 is its own kind and never "call8.flat-proof", so no later
  // reader can mistake a recorded failure for a proof that was built.
  "views.seven-source", "call8.flat-proof", "call8.flat-proof-deferred",
  "call9.surface-panels", "call10.logo-inventory",
  "call11.qc-panels",
  "call12.topaz-upscale", "output.verified", "final.human-qc", "stamp", "zip", "wrapbox.delivery",
]);
const ARTIFACT_KINDS = Object.freeze([
  // "qc-panel" is the Call 11 de-logoed duplicate. It is deliberately NOT
  // "panel": the branded six stay the only "panel" artifacts, so source.verify's
  // exactly-six-distinct-surface_key assertion keeps working untouched, and no
  // downstream consumer can mistake a QC instrument for production artwork.
  "flat-proof", "panel", "qc-panel", "corrected-panel", "upscaled-panel", "logo", "output", "stamp", "zip", "wrapbox-manifest",
  // "panel-map" is the run's mapped metadata: one JSON per phase (design at
  // Call 9, production at output.build) naming every surface's identity,
  // geometry, lineage and file. It is the source of the panel data slug and
  // travels in the ZIP and to WrapBox. It carries no artwork and no surface.
  "panel-map",
]);
const CLAIMANT_CONTRACT = "designpro.server-claimant.v2";
// The Call 9 rule the database enforces. Every output is the deterministic
// gridslice of that side's own immutable Call 8 field. No shared artboard, no
// neighbouring tile, and no driver field reused for the passenger.
const PANEL_SOURCE_RULE = "one-own-surface-region-per-output-side";

class StageError extends Error {
  constructor(code, message, retryable = true) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

function hashBytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hashJson(value) {
  return hashBytes(Buffer.from(JSON.stringify(canonical(value))));
}

function assertStageLeaseActive() {
  const context = stageLeaseContext.getStore();
  if (context?.lost || context?.controller?.signal?.aborted) {
    throw new StageError("stage_lease_lost", "Stage lease was lost; current work is aborted before persistence", true);
  }
}

const REQUIRED_REVISION_VIEWS = Object.freeze({
  driver: ["driver", "driver_side", "driver-side", "side"],
  passenger: ["passenger", "passenger_side", "passenger-side", "opposite_side"],
  hood: ["hood", "hood_detail"],
  roof: ["roof", "top"],
  front: ["front"],
  rear: ["rear", "back"],
});
const SEVENTH_REVISION_VIEWS = Object.freeze({
  closeup: ["closeup", "close-up", "detail"],
  hero3d: ["hero3d", "hero_3d", "hero", "angle", "three_quarter"],
});

function tenantKey(value) {
  try { return canonicalTenantKey(value); }
  catch (error) { throw new StageError("unsafe_tenant_key", error.message, false); }
}

// EVERY ARTIFACT LIVES UNDER ITS OWN RUN. (designpro_artifacts trigger)
//
// `designpro_private.enforce_artifact_storage_identity` refuses any artifact
// row whose storage_path is not `designpro/<tenant_key>/<run_id>/…` (bar the
// wrapbox and logo-input shapes it names separately). That is what stops one
// run's artifact row pointing at another run's bytes, so every stage that
// registers an artifact builds its path here rather than restating the shape.
//
// Built by concatenation on purpose. `source-tests/runtime/resumable-producer-
// paths.test.mjs` scrapes the claimant for the literal
// `designpro/${tenantKey(run.tenant_key)}/${run.id}/…` template to enumerate
// every run subdirectory that can reach the resumable transport, and checks
// each against `zip-spool.cjs`'s allowlist. A helper spelling that template
// would hand the scraper this function's own interpolation as a directory name.
function runScopedStoragePath(run, relativePath) {
  const tail = String(relativePath).replace(/^\/+/, "");
  return "designpro/" + tenantKey(run.tenant_key) + "/" + run.id + "/" + tail;
}

function sourceAsset(value, tenant, revisionId) {
  try { return normalizeSourceAsset(value, tenant, revisionId); }
  catch (error) { throw new StageError("invalid_source_asset", error.message, false); }
}

function exactSevenViews(snapshot, tenantValue, revisionId) {
  const set = revisionViewSet(snapshot, tenantValue, revisionId);
  if (!set.complete) throw set.shortfall;
  return set.views;
}

/**
 * THE VIEWS THAT LANDED, AND AN HONEST ACCOUNT OF THE ONES THAT DID NOT.
 *
 * `exactSevenViews` throws `seven_views_incomplete` NON-RETRYABLY, and
 * `revision.freeze` is the first stage of the entice run -- so a single refused
 * proof killed the workflow before it began, and with it every artifact the
 * workflow publishes: the six A.T.L.A.S. panels Call 1 had ALREADY cut, hashed
 * and stored, and the whole Logo Pack.
 *
 * That is the owner's rule inverted: "A failed Hood 3D proof cannot prevent the
 * Hood production panel from existing. A failed Close-Up cannot cancel
 * Driver/Passenger/Front/Rear/Roof artifacts." The four predicates fixed in
 * #214 made a short set READABLE -- canary 2d918868's six accepted proofs
 * display -- while this one still meant that same run published zero panels and
 * zero logos, permanently.
 *
 * So the shortfall is DESCRIBED rather than thrown, and the caller decides. The
 * error object is built here, once, so a caller that still requires seven
 * raises exactly what it raised before.
 */
function revisionViewSet(snapshot, tenantValue, revisionId) {
  const tenant = tenantKey(tenantValue);
  const assets = requiredObject(snapshot?.renderAssets, "revision snapshot renderAssets");
  const normalized = Object.fromEntries(Object.entries(assets).map(([key, value]) => [String(key).toLowerCase(), value]));
  const resolved = {};
  const missing = [];
  const missingRequired = [];
  for (const [role, aliases] of Object.entries(REQUIRED_REVISION_VIEWS)) {
    const key = aliases.find((candidate) => normalized[candidate] && typeof normalized[candidate] === "object");
    if (!key) { missing.push(role); missingRequired.push(role); continue; }
    resolved[role] = sourceAsset(normalized[key], tenant, revisionId);
  }
  const seventh = Object.entries(SEVENTH_REVISION_VIEWS)
    .map(([role, aliases]) => ({
      role,
      key: aliases.find((candidate) => normalized[candidate] && typeof normalized[candidate] === "object"),
    }))
    .filter((item) => item.key);
  // MORE than one seventh view is a malformed snapshot, not a short set: the
  // Close-Up and the immutable historical Hero occupy the same slot, so two of
  // them means the snapshot cannot say which proof that slot holds. That stays
  // fatal for every caller.
  if (seventh.length > 1) {
    throw new StageError(
      "seven_views_incomplete",
      "Exactly one Close-Up or immutable historical Hero proof is required",
      false,
    );
  }
  const missingSeventh = seventh.length !== 1;
  if (!missingSeventh) resolved[seventh[0].role] = sourceAsset(normalized[seventh[0].key], tenant, revisionId);
  else missing.push("closeup");

  // DISTINCTNESS IS NEVER RELAXED. It is what makes an implicit mirror
  // impossible (RULE 0.5), and it holds over whatever landed: two views sharing
  // a byte identity is a defect at any count, not a consequence of a short set.
  const present = Object.values(resolved);
  if (new Set(present.map((item) => item.storagePath)).size !== present.length
    || new Set(present.map((item) => item.contentHash)).size !== present.length) {
    throw new StageError("seven_views_not_distinct", "All required views must have distinct paths and byte identities", false);
  }

  const unclaimed = Object.keys(assets).length !== present.length;
  const complete = missing.length === 0 && Object.keys(assets).length === 7;
  return {
    views: resolved,
    presentRoles: Object.keys(resolved).sort(),
    missingRoles: missing.sort(),
    complete,
    // THE SHORTFALL REPRODUCES THE ORIGINAL MESSAGES, IN THE ORIGINAL ORDER.
    // `exactSevenViews` is still the strict form and still raises exactly what
    // it raised before -- a caller that requires seven must not be able to tell
    // that the check was refactored underneath it.
    shortfall: complete ? null : new StageError(
      "seven_views_incomplete",
      missingRequired.length
        ? `Required ${missingRequired[0]} view is missing`
        : missingSeventh
          ? "Exactly one Close-Up or immutable historical Hero proof is required"
          : "Exactly seven revision source views are required",
      false,
    ),
    // Recorded so a later reader can tell a short set from a snapshot carrying
    // assets under names no role claims.
    declaredAssetCount: Object.keys(assets).length,
    unclaimedAssets: unclaimed,
  };
}

function uuidFromHash(hash) {
  const text = hash.slice(0, 32).split("");
  text[12] = "5"; text[16] = ["8", "9", "a", "b"][parseInt(text[16], 16) % 4];
  const value = text.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function round2(value) { return Math.round((Number(value) + Number.EPSILON) * 100) / 100; }

/**
 * Fingerprints WHATEVER LANDED. The count assertion is relative to what was
 * handed in, not hardcoded to seven -- the seven-ness is decided by
 * `revisionViewSet` and enforced by whoever requires it. What never relaxes is
 * REUSE: two views sharing a byte identity is how an implicit mirror would slip
 * through (RULE 0.5), and that is a defect at four views as much as at seven.
 */
async function fingerprintRevisionViews(views, sb, tenantValue, revisionId) {
  const tenant = tenantKey(tenantValue);
  const identities = [];
  for (const [viewKey, rawAsset] of Object.entries(views)) {
    const asset = sourceAsset(rawAsset, tenant, revisionId);
    const bytes = await storageBytes(sb, asset.storagePath);
    try { verifySourceBytes(asset, bytes); }
    catch (error) { throw new StageError("view_fingerprint_failed", `${viewKey}: ${error.message}`, false); }
    identities.push({ viewKey, storagePath: asset.storagePath, contentHash: asset.contentHash, byteSize: asset.byteSize, contentType: asset.contentType });
  }
  if (!identities.length || new Set(identities.map((item) => item.contentHash)).size !== identities.length) {
    throw new StageError("seven_view_identity_reuse", "Every present view must have a unique byte identity", false);
  }
  return identities;
}

/**
 * Exact customer strings frozen for Call 8.
 *
 * Standard DesignPanel generations carry commercial identity separately from
 * bodyText. Both are frozen sources; neither is parsed back out of a rendered
 * image. The clean-artboard producer is allowed to preserve only these exact
 * strings and must omit anything it cannot reproduce exactly.
 */
function call8TextLock(snapshot) {
  if (!snapshot || snapshot.bodyText == null || !Array.isArray(snapshot.expectedLogoInventory)) {
    throw new StageError("call8_text_lock_missing", "Revision must freeze bodyText and expected logo placements", false);
  }
  const brand = snapshot.brandIdentity && typeof snapshot.brandIdentity === "object"
    ? snapshot.brandIdentity
    : {};
  const bodyText = {
    frozenBodyText: snapshot.bodyText,
    companyName: brand.companyName || null,
    phone: brand.phone || null,
    website: brand.website || null,
  };
  try {
    return normalizeTextLock({
      bodyText,
      logoPlacements: snapshot.expectedLogoInventory.map((item) => ({
        identityKey: requiredString(item?.identityKey, "logo identityKey"),
        displayName: requiredString(item?.displayName, "logo displayName"),
        targetSurfaceKey: requiredString(item?.surfaceKey, "logo target surface"),
        contentHash: requiredString(item?.contentHash, "logo contentHash").toLowerCase(),
      })),
    });
  } catch (error) {
    throw new StageError("call8_text_lock_invalid", String(error?.message || error), false);
  }
}

/**
 * Server Call 8 request: the SIX deterministic Call-1 panels + exact GENIE
 * geometry -> one dimensioned customer proof, assembled by code.
 *
 * ⛔ THE SIX SURFACE INPUTS ARE PANELS. THEY ARE NOT THE 3D PROOFS. (Trish
 * 2026-08-29.)
 *
 * This used to take `viewLineage` -- the seven persona-photographer renders --
 * and pass them to the server as `sourceAssets`, where a Gemini pass flattened
 * each PHOTOGRAPH into a "surface field" and those fields became both the
 * proof-sheet tiles and, through `panels.build`'s fallback arm, the print
 * panels. Traced on Northgate: all six Call-8 inputs joined by hash straight
 * back to `designpro_generation_views`, 6/6, every one produced by
 * `persona-photographer-render`.
 *
 * That is backwards. The authority chain runs ONE way:
 *
 *   Call-1 flattened A.T.L.A.S. master
 *     -> exact deterministic container crop
 *       -> Call-1 panel            <- the ONLY production artwork
 *         -> 3D proof              <- presentation, downstream, terminal
 *
 * A 3D proof is a photograph of a vehicle wearing the design. Flattening it
 * back into a rectangle recovers a picture of a truck, not artwork, and GENIE
 * dimensions stamped around it do not make it a print file.
 *
 * `viewLineage` still rides the RECEIPT: those seven proofs are real, they
 * belong to this design, and the stage contract joins them to the frozen view
 * set. What it no longer does is contribute a pixel.
 */
function call8ProofRequest(run, manifest, callOnePanels, viewLineage, textLock, proofMeta) {
  const tenant = tenantKey(run.tenant_key);
  const surfaces = manifest.expectedSurfaces || [];
  if (surfaces.length !== SURFACE_KEYS.length) {
    throw new StageError("call8_surface_set_invalid", "Exactly six production surfaces are required", false);
  }
  if (!Array.isArray(viewLineage) || viewLineage.length !== VIEW_KEYS.length) {
    throw new StageError("call8_view_lineage_invalid", "Call 8 requires all seven immutable source identities", false);
  }
  try { sourceViewKeys(viewLineage); }
  catch (error) { throw new StageError("call8_view_lineage_invalid", error.message, false); }
  const totalSqFt = round2(surfaces.reduce(
    (total, item) => total + Number(item.widthInches) * Number(item.heightInches), 0,
  ) / 144);
  if (round2(Number(manifest.totalSqFt)) !== totalSqFt) {
    throw new StageError("genie_total_square_feet_mismatch", "GENIE total square footage does not match raw per-surface dimensions", false);
  }
  const productionSurfaces = surfaces.map(({ sourceAsset: _sourceAsset, ...surface }) => surface);
  let panelAssets;
  let materialHash;
  try {
    panelAssets = normalizeCallOnePanelSet(callOnePanels, tenant);
    materialHash = call8ProofMaterialHash({
      panels: panelAssets, surfaces: productionSurfaces,
      revisionId: run.revision_id, textLock, tenantKey: tenant,
    });
  } catch (error) {
    throw new StageError("call8_panel_source_invalid", String(error?.message || error), false);
  }
  return {
    request: {
      tenantKey: tenant, workflowRunId: run.id, revisionId: run.revision_id,
      surfaces: productionSurfaces,
      panelAssets, textLock, flatMaterialHash: materialHash,
      vehicle: manifest.vehicle, proofMeta: proofMeta || {},
    },
    totalSqFt, materialHash, panelAssets,
  };
}

async function resolveGenieManifest(sb, run, stage) {
  const { data: source, error: sourceError } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
  if (sourceError || !source || source.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("revision_source_drift", "Immutable revision source is missing or changed", false);
  // GENIE'S DIMENSIONS COME FROM THE VEHICLE, NOT FROM THE PROOFS.
  //
  // This called `exactSevenViews`, so a refused proof raised here too -- in the
  // FREE half via Call 8, and in the PAID half at `manifest.resolve`, where it
  // would have killed a run the customer had already paid for. Neither needed
  // seven views to resolve a dimension: every width and height below comes from
  // the measured GENIE row, and each surface's `sourceAsset` is consumed by
  // exactly one caller, `call8ProofRequest`. That caller does its own
  // all-seven check (`call8_view_lineage_invalid`) and `proof.build` turns it
  // into a recorded deferral, so the missing view is still refused where it
  // actually matters -- once, with an honest reason, instead of everywhere.
  const viewSet = revisionViewSet(source.snapshot, run.tenant_key, run.revision_id);
  const views = viewSet.views;
  const vehicle = requiredObject(source.snapshot.vehicle, "revision vehicle");
  const make = requiredString(vehicle.make, "vehicle make"); const model = requiredString(vehicle.model, "vehicle model"); const year = Number(vehicle.year);
  // Legacy designpro_vehicle_dimensions rows do not carry validator identity or
  // exact six-surface evidence. They are never print authority. Every vehicle,
  // known or unknown, resolves through the validated Universal GENIE gate.
  const row = await resolveOrQueueUniversalDimensions(sb, vehicle, stage, run.id);
  const dim = (width, height, surfaceKey, sourceAssetValue) => {
    const widthInches = Number(width); const heightInches = Number(height);
    if (!(widthInches > 0 && heightInches > 0)) throw new StageError("genie_surface_dimensions_missing", `GENIE dimensions missing for ${surfaceKey}`, false);
    return { surfaceKey, sourceAsset: sourceAssetValue, widthInches, heightInches, surfaceSqFt: round2(widthInches * heightInches / 144), bleed: { top: 5, right: 5, bottom: 5, left: 5 } };
  };
  const expectedSurfaces = [
    dim(row.side_width, row.side_height, "driver", views.driver),
    dim(row.passenger_width || row.side_width, row.passenger_height || row.side_height, "passenger", views.passenger),
    dim(row.hood_width, row.hood_length, "hood", views.hood),
    dim(row.roof_width, row.roof_length, "roof", views.roof),
    dim(row.front_width, row.front_height, "front", views.front),
    dim(row.rear_width, row.rear_height, "rear", views.rear),
  ];
  const dimensionBasis = { recordId: row.id, make: row.make, model: row.model, year, universalValidation: row.universalValidation || null, expectedSurfaces: expectedSurfaces.map(({ sourceAsset, ...item }) => item) };
  const dimensionBasisHash = hashJson(dimensionBasis);
  const totalSqFt = round2(expectedSurfaces.reduce((total, item) => total + (item.widthInches * item.heightInches / 144), 0));
  const manifest = { contract: "designpro.genie-dimension-manifest.v1", genieVerified: true, sevenViewsVerified: viewSet.complete, requiredViewCount: 7, presentViewRoles: viewSet.presentRoles, missingViewRoles: viewSet.missingRoles, dimensionsAuthority: "genie-universal-panelizer", vehicle: { type: vehicle.type || vehicle.vehicleClass, year, make, model }, bleedInches: 5, totalSqFt, squareFootRounding: "nearest-0.01-after-raw-sum", dimensionBasisHash, expectedSurfaces };
  return { source, views, manifest, dimensionBasisHash, dimensionManifestId: uuidFromHash(dimensionBasisHash) };
}

function requiredObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StageError("invalid_stage_input", `${label} is required`, false);
  }
  return value;
}

function requiredString(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new StageError("invalid_stage_input", `${label} is required`, false);
  return text;
}

function safePath(value, label) {
  try { return safeStoragePath(requiredString(value, label)); }
  catch (error) { throw new StageError("unsafe_storage_path", `${label}: ${error.message}`, false); }
}

function identity(run) {
  const result = {
    workflowRunId: run.id,
    revisionId: run.revision_id,
    enticePackId: run.entice_pack_id,
    dimensionManifestId: run.dimension_manifest_id,
    sourceContractHash: run.source_contract_hash,
    manifestHash: run.manifest_hash,
    artifactSetHash: run.artifact_set_hash,
  };
  for (const [key, value] of Object.entries(result)) {
    if (value == null) delete result[key];
  }
  return result;
}

function artifact(kind, storagePath, contentHash, bytes, surfaceKey = "", metadata = {}) {
  if (!ARTIFACT_KINDS.includes(kind) || !HASH_RE.test(contentHash) || !(bytes > 0)) {
    throw new StageError("invalid_artifact_evidence", `Invalid ${kind} artifact evidence`, false);
  }
  return { kind, storagePath: safePath(storagePath, "artifact storagePath"), contentHash, byteSize: bytes, surfaceKey, metadata };
}

/**
 * The immutable revision source this run was frozen from, with the columns the
 * panel map and the business identity read. Refused if it is not the snapshot
 * the run was created against.
 */
async function revisionSnapshotFor(sb, run) {
  const { data, error } = await sb.from("designpro_revision_sources")
    .select("generation_id,snapshot,snapshot_hash,owner_id,tenant_key").eq("revision_id", run.revision_id).maybeSingle();
  if (error || !data) throw new StageError("revision_source_missing", error?.message || "Immutable revision source is missing", false);
  if (data.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("revision_source_drift", "Immutable revision source changed", false);
  return data;
}

function revisionSequenceFromPath(storagePath) {
  const match = /\/revisions\/(\d+)\//.exec(String(storagePath || ""));
  return match ? Number(match[1]) : null;
}

/**
 * THE DESIGN-PHASE PANEL MAP. Built from the six Call-1 panels the snapshot
 * carries and this run's promoted copies. Marked NOT production-validated,
 * because until manifest.resolve the inches are calls-1-7-layout-only, and the
 * order number is whatever the snapshot has bound (null before purchase).
 */
function designPanelMap({ run, revisionSource, callOnePanels, promoted, builtAt }) {
  const snapshot = revisionSource.snapshot || {};
  const generationId = String(snapshot.generationId || revisionSource.generation_id || "").toLowerCase();
  const byKey = new Map(callOnePanels.map((panel) => [String(panel.surfaceKey), panel]));
  const masterHashes = new Set(callOnePanels.map((panel) => String(panel.sourceMasterHash || "").toLowerCase()));
  if (masterHashes.size !== 1) throw new StageError("panel_map_master_split", "Call 1 panels do not name exactly one master", false);
  const masterHash = [...masterHashes][0];
  const first = callOnePanels[0];
  const masterPath = String(first.storagePath || "").replace(/\/panels\/[0-9a-f]{64}\.png$/, `/master/${masterHash}.png`);
  try {
    return buildPanelMap({
      phase: "design",
      generationId,
      revisionId: run.revision_id,
      revisionSequence: revisionSequenceFromPath(first.storagePath),
      designId: canonicalDesignId(generationId),
      orderNumber: snapshot.orderNumber || null,
      customerName: snapshot.delivery?.customerName || snapshot.brandIdentity?.companyName || null,
      vehicle: snapshot.vehicle || {},
      genie: { manifestId: first.genieManifestId || null, manifestHash: first.genieManifestHash || null },
      master: { sha256: masterHash, storagePath: masterPath !== first.storagePath ? masterPath : null, px: null },
      geometrySource: first.geometryAuthorityState || null,
      productionSizingValidated: false,
      builtAt,
      surfaces: promoted.map((row) => {
        const source = byKey.get(row.surfaceKey) || {};
        return {
          surfaceKey: row.surfaceKey,
          contentHash: row.contentHash,
          storagePath: row.storagePath,
          pixelWidth: source.pixelWidth, pixelHeight: source.pixelHeight,
          trimWidthIn: row.trimWidthIn, trimHeightIn: row.trimHeightIn,
          printWidthIn: row.printWidthIn, printHeightIn: row.printHeightIn,
          bleedInches: row.bleedInches, surfaceSqFt: row.surfaceSqFt,
          nativePpi: source.effectivePpi, sourceMasterHash: source.sourceMasterHash,
          fileRole: "atlas-call1-panel-promoted",
        };
      }),
    });
  } catch (error) {
    if (error instanceof StageError) throw error;
    throw new StageError(error.code || "panel_map_invalid", error.message, false);
  }
}

/**
 * The stored panel map for a phase, hash-verified. Null when none was stored --
 * a run that passed Call 9 before the map existed rebuilds a design map in
 * memory from the same inputs rather than failing.
 */
async function storedPanelMap(sb, run, phase) {
  const rows = (await artifacts(sb, run.id, ["panel-map"])).filter((row) => row.metadata?.phase === phase);
  if (!rows.length) return null;
  const row = rows[0];
  const bytes = await storageBytes(sb, row.storage_path);
  if (hashBytes(bytes) !== String(row.content_hash).toLowerCase()) throw new StageError("panel_map_changed", `${phase} panel map changed after it was written`, false);
  try { return parsePanelMap(bytes); }
  catch (error) { throw new StageError(error.code || "panel_map_invalid", error.message, false); }
}

/**
 * The six panels A.T.L.A.S. cut at Call 1, or null for a run with no atlas.
 *
 * Read off the immutable revision snapshot -- the interface this side of the
 * seam is allowed to read -- so a resumed run promotes the same bytes the
 * customer was already shown.
 */
async function callOnePanelSet(sb, run) {
  const { data, error } = await sb
    .from("designpro_revision_sources")
    .select("snapshot,snapshot_hash")
    .eq("revision_id", run.revision_id)
    .maybeSingle();
  if (error || !data) return null;
  if (data.snapshot_hash !== run.revision_snapshot_hash) {
    throw new StageError("call9_revision_source_drift", "Immutable revision source changed before Call 9", false);
  }
  const panels = Array.isArray(data.snapshot?.callOnePanels) ? data.snapshot.callOnePanels : [];
  if (!panels.length) return null;
  if (panels.length !== SURFACE_KEYS.length) {
    throw new StageError("call9_call1_panel_set_invalid", `Call 1 recorded ${panels.length} panels, expected ${SURFACE_KEYS.length}`, false);
  }
  const keys = panels.map((panel) => String(panel?.surfaceKey || ""));
  if (SURFACE_KEYS.some((key) => !keys.includes(key))) {
    throw new StageError("call9_call1_panel_surface_missing", "Call 1 panels do not cover the six canonical surfaces", false);
  }
  for (const panel of panels) {
    if (!HASH_RE.test(String(panel?.contentHash || ""))
      || !(Number(panel?.printWidthIn) > 0) || !(Number(panel?.printHeightIn) > 0)) {
      throw new StageError("call9_call1_panel_identity_invalid", `${panel?.surfaceKey || "unknown"} has no immutable identity or size`, false);
    }
  }
  return panels;
}

/**
 * The design-time dimension manifest, built from the panels Call 1 cut.
 *
 * Same shape the GENIE manifest binds, so every consumer reads one structure --
 * but marked genieVerified:false, because these are the design-time sizes
 * (calls-1-7-layout-only) rather than validated production geometry. Nothing
 * downstream of the purchase gate is allowed to run on them.
 */
async function designTimeManifest(sb, run) {
  const panels = await callOnePanelSet(sb, run);
  if (!panels) {
    throw new StageError(
      "call8_dimensions_unavailable",
      "No GENIE manifest is bound and Call 1 recorded no panel dimensions for this run",
      false,
    );
  }
  const expectedSurfaces = SURFACE_KEYS.map((surfaceKey) => {
    const panel = panels.find((item) => item.surfaceKey === surfaceKey);
    if (!panel) {
      throw new StageError(
        "call8_dimensions_unavailable",
        `Call 1 recorded no panel for ${surfaceKey}`,
        false,
      );
    }
    const widthInches = round2(panel.trimWidthIn);
    const heightInches = round2(panel.trimHeightIn);
    return {
      surfaceKey,
      widthInches,
      heightInches,
      bleed: { top: 5, right: 5, bottom: 5, left: 5 },
      surfaceSqFt: round2((widthInches * heightInches) / 144),
    };
  });
  return {
    contract: "designpro.design-time-dimension-manifest.v1",
    genieVerified: false,
    geometryPurpose: "calls-1-7-layout-only",
    expectedSurfaces,
    // Keep the same area contract as the validated GENIE manifest: add the
    // raw rectangular areas, then round the total once. Summing each
    // surface's already-rounded display value can drift by a cent (the live
    // DCA was 305.54 vs 305.53), which made Call 8 reject geometry that was in
    // fact identical to its six Call-1 panels.
    totalSqFt: round2(expectedSurfaces.reduce(
      (total, surface) => total + (surface.widthInches * surface.heightInches / 144),
      0,
    )),
    squareFootRounding: "nearest-0.01-after-raw-sum",
  };
}

async function storageBytes(sb, storagePath) {
  const path = safePath(storagePath, "storagePath");
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) throw new StageError("artifact_download_failed", `Unable to download ${path}: ${error?.message || "empty object"}`);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (!bytes.length) throw new StageError("artifact_empty", `${path} is empty`, false);
  return bytes;
}

async function upload(sb, storagePath, bytes, contentType) {
  assertStageLeaseActive();
  const path = safePath(storagePath, "storagePath");
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (body.length > MAX_STANDARD_UPLOAD_BYTES) throw new StageError("artifact_requires_resumable_transport", `${path} exceeds the explicit standard-upload threshold`, false);
  try {
    const stored = await immutableStorageUpload(sb.storage, BUCKET, path, body, contentType);
    return { storagePath: stored.storagePath, bytes: stored.byteSize, hash: stored.contentHash };
  } catch (error) {
    const drift = /different bytes/.test(String(error.message || error));
    throw new StageError(drift ? "artifact_immutable_path_drift" : "artifact_upload_failed", `${path}: ${error.message}`, !drift);
  }
}

async function uploadProducedBytes(sb, run, stage, runtimeConfig, storagePath, bytes, contentType) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (body.length <= MAX_STANDARD_UPLOAD_BYTES) return { ...(await upload(sb, storagePath, body, contentType)), spool: null };
  const path = safePath(storagePath, "resumable storagePath");
  const contentHash = hashBytes(body);
  const materialHash = hashJson({ storagePath: path, contentHash, byteSize: body.length, contentType });
  const signal = stageLeaseContext.getStore()?.controller?.signal;
  const spool = await spoolImmutableBuffer({ spoolDir: runtimeConfig.spoolDir, runId: run.id, materialHash, bytes: body, signal });
  const stored = await uploadSpoolWithTus({
    supabase: sb, supabaseUrl: runtimeConfig.supabaseUrl, serviceRoleKey: runtimeConfig.serviceRoleKey,
    endpoint: runtimeConfig.tusEndpoint, spoolDir: runtimeConfig.spoolDir, spool, storagePath: path,
    contentType, signal,
  });
  return { storagePath: stored.storagePath, bytes: stored.byteSize, hash: stored.contentHash, spool };
}

async function exactStoredArtifact(sb, candidate, expectedKind) {
  const item = requiredObject(candidate, `${expectedKind} artifact`);
  const bytes = await storageBytes(sb, item.storagePath);
  const observed = hashBytes(bytes);
  const expected = String(item.contentHash || observed).toLowerCase();
  if (!HASH_RE.test(expected) || observed !== expected || (item.byteSize != null && Number(item.byteSize) !== bytes.length)) {
    throw new StageError("artifact_hash_mismatch", `${item.storagePath} changed`, false);
  }
  return artifact(expectedKind, item.storagePath, observed, bytes.length, String(item.surfaceKey || ""), item.metadata || {});
}

async function callTool(baseUrl, secret, route, body) {
  assertStageLeaseActive();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 14 * 60_000);
  const stageSignal = stageLeaseContext.getStore()?.controller?.signal;
  try {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: stageSignal ? AbortSignal.any([controller.signal, stageSignal]) : controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      throw new StageError("tool_execution_failed", `${route}: ${result.error || `HTTP ${response.status}`}`, response.status >= 500 || response.status === 429);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

async function getRun(sb, runId) {
  const { data, error } = await sb.from("designpro_workflow_runs").select("*").eq("id", runId).maybeSingle();
  if (error || !data) throw new StageError("workflow_missing", error?.message || "Workflow missing", false);
  return data;
}

async function stageOutput(sb, runId, stageKey) {
  const { data, error } = await sb.from("designpro_workflow_stages")
    .select("status,output,verification,output_hash").eq("run_id", runId).eq("stage_key", stageKey).maybeSingle();
  if (error || !data || data.status !== "completed" || data.verification?.verified !== true) {
    throw new StageError("prior_stage_unverified", `${stageKey} is not verified`, false);
  }
  return data.output || {};
}

async function receipt(sb, runId, kind) {
  if (!RECEIPTS.includes(kind)) throw new StageError("receipt_kind_invalid", kind, false);
  const { data, error } = await sb.from("designpro_stage_receipts")
    .select("receipt,receipt_hash,identity").eq("run_id", runId).eq("receipt_kind", kind).maybeSingle();
  if (error || !data || !HASH_RE.test(String(data.receipt_hash || ""))) {
    throw new StageError("receipt_missing", `${kind} receipt is missing`, false);
  }
  return data;
}

async function artifacts(sb, runId, kinds) {
  const { data, error } = await sb.from("designpro_artifacts").select("artifact_kind,surface_key,storage_path,content_hash,byte_size,metadata")
    .eq("run_id", runId).in("artifact_kind", kinds);
  if (error) throw new StageError("artifact_ledger_read_failed", error.message);
  return data || [];
}

async function complete(sb, stage, run, receiptValue, receiptHash = null, produced = []) {
  assertStageLeaseActive();
  const finalHash = receiptHash || hashJson(receiptValue);
  const { data, error } = await sb.rpc("complete_designpro_stage", {
    p_stage_id: stage.id,
    p_lease_token: stage.lease_token,
    p_identity: identity(run),
    p_receipt: receiptValue,
    p_receipt_hash: finalHash,
    p_artifacts: produced,
  });
  if (error) throw new StageError("stage_completion_rejected", error.message, false);
  if (data !== true) throw new StageError("stage_lease_lost", `Lease lost for ${stage.stage_key}`);
}

/**
 * Open the production workflow for a prepared pack.
 *
 * KEPT, DELIBERATELY. This is the working downstream conductor and it is still
 * the only one -- rebuilding it would be the second fulfillment chain nobody
 * wants. What changed is who calls it. It is no longer invoked by pack.activate
 * merely because preparation finished; the same call now lives in
 * confirm_designpro_purchase, so production opens when a customer pays for this
 * exact prepared pack. The reconciler below still repairs a crash between the
 * payment and the run, which is why both stay.
 */
// The two products, by the proven identifiers. print_production_pack is
// deliberately absent: its own source calls it the path that kicks the old
// re-slice pipeline.
const PURCHASABLE_PRODUCTS = Object.freeze(["print_pack_entitlement", "logo_pack"]);

/**
 * WHAT A PURCHASE AUTHORIZES, enumerated once.
 *
 * Written here rather than scattered as product checks through every stage,
 * because a rule repeated in six places is six rules. Each stage asks this
 * manifest what it may touch; none of them asks what was bought.
 *
 *   print_pack_entitlement  the six branded panels and the clean duplicates
 *                           PanelPro validates against, their upscale, the
 *                           production outputs, the QC certificate, the ZIP and
 *                           the WrapBox production delivery.
 *   logo_pack               the separated logo and lettering assets, their
 *                           upscale, their QC, and their own delivery.
 *
 * Neither implies the other. A customer who paid $29 for logos has not bought
 * $299 of production files, and the reverse is equally wrong -- so buying both
 * is two entitlements sharing one run, not one bigger purchase.
 */
function authorizedAssetManifest(paidProducts) {
  const products = [...new Set((paidProducts || []).map(String))].sort();
  const production = products.includes("print_pack_entitlement");
  const logos = products.includes("logo_pack");
  return Object.freeze({
    contract: "designpro.authorized-assets.v1",
    products,
    productionPackAuthorized: production,
    logoPackAuthorized: logos,
    // Artifact kinds each stage may read. Absent means UNAUTHORIZED, which is
    // not the same as missing -- the difference decides whether a stage fails
    // or completes as inapplicable.
    upscale: Object.freeze([...(production ? ["panel", "qc-panel"] : []), ...(logos ? ["logo"] : [])]),
    output: Object.freeze(production ? ["upscaled-panel"] : []),
    // The complete production output set is six sides x three formats. A run
    // that did not buy it must not be asked to prove it; a run that did must
    // fail closed without it.
    requiredOutputFiles: production ? 18 : 0,
    // What the humans are asked to check. QC validates the purchased asset
    // classes and is never handed a class the customer did not buy.
    qcScope: Object.freeze([
      ...(production ? ["production-panels"] : []),
      ...(logos ? ["logo-assets"] : []),
    ]),
    // What the archive carries. The stamp is in both: it is the QC evidence for
    // whatever was approved, and each product needs its own.
    zipKinds: Object.freeze([
      ...(production ? ["flat-proof", "panel", "output", "panel-map"] : []),
      ...(logos ? ["logo"] : []),
      "stamp",
    ]),
    // The seven approved renders are the Production Pack's design proofs. A
    // Logo Pack buys separated assets, not the design's proof set.
    zipIncludesSourceViews: production,
    delivery: Object.freeze([
      ...(production ? ["output", "stamp", "flat-proof", "panel-map"] : []),
      ...(logos ? ["logo"] : []),
    ]),
    // What the customer bought, named so WrapBox can tell one from the other
    // rather than showing an ambiguous single pack.
    deliverables: Object.freeze([
      ...(production ? [{ product: "print_pack_entitlement", label: "Production Pack" }] : []),
      ...(logos ? [{ product: "logo_pack", label: "Logo Pack" }] : []),
    ]),
  });
}

/**
 * The frozen manifest for this run, read once from the gate that created it.
 *
 * Every downstream stage asks this rather than asking what was bought. A rule
 * repeated in six stages is six rules, and the sixth is the one that drifts.
 */
async function readAuthorizedAssets(sb, runId) {
  const gate = await stageOutput(sb, runId, "await_purchase");
  return requiredObject(gate.authorizedAssetManifest, "authorized asset manifest");
}

async function ensureAutomaticProduction(sb, enticeRunId) {
  const { data, error } = await sb.rpc("create_designpro_production_workflow", {
    p_entice_run_id: enticeRunId,
    p_idempotency_key: `auto-production:${enticeRunId}`,
    p_input: { trigger: "designpro.os.auto" },
  });
  if (error) throw new StageError("automatic_production_enqueue_failed", error.message, true);
  return data;
}

async function reconcilePurchaseGates(sb) {
  const { data, error } = await sb.rpc("reconcile_designpro_purchase_gates");
  if (error) throw new StageError("purchase_gate_reconciliation_failed", error.message, true);
  return data;
}

async function reconcileAutomaticProduction(sb) {
  const { data, error } = await sb.rpc("reconcile_designpro_automatic_production");
  if (error) throw new StageError("automatic_production_reconciliation_failed", error.message, true);
  return data;
}

async function withHeavyOutputLease(sb, stage, work) {
  assertStageLeaseActive();
  const payload = {
    p_stage_id: stage.id,
    p_lease_token: stage.lease_token,
    p_worker: requiredString(stage.lease_owner, "heavy lease worker"),
    p_lease_seconds: 120,
  };
  const acquired = await sb.rpc("acquire_designpro_heavy_lease", payload);
  if (acquired.error) throw new StageError("heavy_output_lease_failed", acquired.error.message, true);
  if (acquired.data !== true) throw new StageError("heavy_output_capacity_busy", "Another worker is using the bounded high-resolution output slot", true);
  const context = stageLeaseContext.getStore();
  const renew = setInterval(async () => {
    const result = await sb.rpc("acquire_designpro_heavy_lease", payload);
    if (result.error || result.data !== true) {
      if (context) {
        context.lost = true;
        context.controller.abort(new Error(result.error?.message || "heavy output lease expired"));
      }
    }
  }, 30_000);
  renew.unref?.();
  try {
    return await work();
  } finally {
    clearInterval(renew);
    // Do not release here: the caller must still durably complete or fail the
    // stage. The database stage transition releases the exact slot atomically,
    // so there is no gap in which a heartbeat can lose the heavy-work fence.
  }
}

/**
 * Draw the 2D Production Proof for this run, from the six Call-1 panels.
 *
 * DETERMINISTIC ASSEMBLY. NO GENERATIVE STEP. (Trish 2026-08-29, fix order
 * step 3: "Call 8 becomes deterministic proof-sheet assembly from those six
 * artifacts -- labels/grid/dimensions can be presentation metadata, but no
 * Gemini flattening.")
 *
 * Everything on the sheet that is not a panel -- the header, the trim and print
 * tables, the dimension callouts, the approval block, the provenance line -- is
 * DRAWN by `runtime/proof-sheet.cjs`, so it cannot be hallucinated, and the six
 * tiles are the exact bytes the customer's print files are made of. Same
 * inputs, same sheet, on any worker.
 *
 * It is a separate function so its caller can decide what a failure MEANS,
 * which differs by run: fatal where nothing else can manufacture, recorded-and-
 * deferred where A.T.L.A.S. has already cut the panels.
 */
async function buildCall8Proof(sb, baseUrl, secret, run, stage, runtimeConfig, input) {
    const rebound = await getRun(sb, run.id);
    // GENIE deploys on order, so the free run has no bound production manifest.
    // Call 8 draws a dimensioned proof either way: pre-purchase it uses the
    // design-time sizes Call 1 already resolved and cut the panels to, which is
    // exactly what the proof's trim table reports. GENIE replaces them with the
    // validated production sizes once the pack is ordered.
    const manifest = rebound.results?.dimensionManifest
      || await designTimeManifest(sb, run);
    const frozenViews = await stageOutput(sb, run.id, "revision.freeze");
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource || revisionSource.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("call8_revision_source_drift", "Frozen Call 8 text source changed", false);
    const snapshot = revisionSource.snapshot || {};
    const textLock = call8TextLock(snapshot);

    // THE SIX SURFACE INPUTS, AND THE ONLY PLACE THEY MAY COME FROM.
    //
    // Call 8 runs BEFORE `panels.build`, so the promoted run-scoped panels do
    // not exist yet -- and they are only a copy in any case. The authority is
    // the Call-1 panel set on the immutable revision snapshot: six geometric
    // crops of the accepted A.T.L.A.S. master, each already at its GENIE trim
    // with the five-inch bleed. No panel set means no production proof, and
    // that is a fatal, honest outcome rather than a sheet of photographs.
    const callOnePanels = await callOnePanelSet(sb, run);
    if (!callOnePanels) {
      throw new StageError(
        "call8_production_panels_not_created",
        "No deterministic Call-1 panel set exists for this revision, so there is nothing to proof. The 2D Production Proof is assembled from the six Call-1 panels; it is never composed out of the 3D proofs.",
        false,
      );
    }
    // Re-read and re-hash every panel before it is proofed. The snapshot states
    // the identity; storage has to still agree with it.
    const panelSources = [];
    for (const panel of callOnePanels) {
      const bytes = await storageBytes(sb, panel.storagePath);
      const contentHash = String(panel.contentHash || "").toLowerCase();
      if (hashBytes(bytes) !== contentHash || bytes.length !== Number(panel.byteSize)) {
        throw new StageError("call8_call1_panel_changed", `${panel.surfaceKey} Call 1 panel changed before the proof was drawn`, false);
      }
      panelSources.push({
        surfaceKey: panel.surfaceKey,
        bucket: BUCKET,
        storagePath: panel.storagePath,
        contentHash,
        byteSize: bytes.length,
        contentType: "image/png",
        trimWidthIn: Number(panel.trimWidthIn),
        trimHeightIn: Number(panel.trimHeightIn),
        printWidthIn: Number(panel.printWidthIn),
        printHeightIn: Number(panel.printHeightIn),
        sourceMasterHash: panel.sourceMasterHash || null,
      });
    }

    const spec = call8ProofRequest(rebound, manifest, panelSources, frozenViews.viewReceipts, textLock, {
      designName: snapshot.designName || snapshot.delivery?.designName || "",
      finish: snapshot.finish || "",
      designId: snapshot.designId || "",
      orderNumber: snapshot.orderNumber || "",
    });
    const result = await callTool(baseUrl, secret, "/compose-proof-sheet", spec.request);
    // v4 IS THE FENCE, NOT A VERSION BUMP. A v3 server returns `surfaceFields`
    // and `surfacePanels` -- the Gemini-flattened photographs and their
    // gridslices -- and refusing that contract by name is what stops a
    // half-rolled droplet quietly proofing the old way.
    if (result.contract !== "designpro.call8-panel-proof.v4"
      || result.flatMaterialHash !== spec.materialHash
      || result.imageRequestCount !== 0
      || !Array.isArray(result.surfaceTiles)
      || result.surfaceTiles.length !== SURFACE_KEYS.length
      || result.surfaceFields !== undefined
      || result.surfacePanels !== undefined) {
      throw new StageError("call8_result_invalid", "Call 8 did not return a deterministic six-panel proof sheet", false);
    }
    const proofSheet = requiredObject(result.proof, "Call 8 2D production proof");
    const dimensionByKey = new Map((manifest.expectedSurfaces || []).map((surface) => [String(surface.surfaceKey), surface]));
    const panelByKey = new Map(panelSources.map((panel) => [panel.surfaceKey, panel]));
    const tileKeys = result.surfaceTiles.map((item) => String(item?.surfaceKey || ""));
    if (new Set(tileKeys).size !== SURFACE_KEYS.length || SURFACE_KEYS.some((key) => !tileKeys.includes(key))) {
      throw new StageError("call8_surface_tile_identity_invalid", "Call 8 must place one tile per canonical surface", false);
    }
    const surfaceTiles = [];
    for (const tile of result.surfaceTiles) {
      const key = String(tile.surfaceKey || "");
      const dims = dimensionByKey.get(key);
      const panel = panelByKey.get(key);
      // EVERY TILE IS THE PANEL. Bound by hash to the exact Call-1 artifact,
      // and dimensioned by the same GENIE row the panel was cut to, so the
      // callout on the sheet and the size of the print file cannot disagree.
      if (!dims || !panel
        || String(tile.sourcePanelHash || "").toLowerCase() !== panel.contentHash
        || tile.sourcePanelPath !== panel.storagePath
        || round2(tile.trimWidthIn) !== round2(dims.widthInches)
        || round2(tile.trimHeightIn) !== round2(dims.heightInches)) {
        throw new StageError("call8_surface_tile_binding_invalid", `${key || "unknown"} tile is not its own Call-1 panel at GENIE geometry`, false);
      }
      surfaceTiles.push({
        surfaceKey: key,
        sourcePanelPath: safePath(panel.storagePath, `${key} Call 1 panel`),
        sourcePanelHash: panel.contentHash,
        sourceMasterHash: panel.sourceMasterHash,
        trimWidthIn: Number(tile.trimWidthIn), trimHeightIn: Number(tile.trimHeightIn),
        printWidthIn: Number(panel.printWidthIn), printHeightIn: Number(panel.printHeightIn),
        placement: tile.placement,
      });
    }
    const proofArtifact = await exactStoredArtifact(sb, {
      storagePath: proofSheet.storagePath,
      contentHash: String(proofSheet.contentHash).toLowerCase(),
      byteSize: Number(proofSheet.byteSize),
      surfaceKey: "",
      metadata: {
        role: "customer-2d-production-proof", contract: proofSheet.contract,
        widthPx: proofSheet.width, heightPx: proofSheet.height,
        totalSqFt: proofSheet.totalSqFt, bleedInches: 5,
        dimensionsAuthority: "genie-universal-panelizer",
        // PROVENANCE, ON THE ARTIFACT ITSELF. A reader must be able to answer
        // "what is this made of" without joining three tables.
        producer: "designpro.call8-panel-proof.v4",
        deterministic: true,
        assembledFrom: "atlas-call1-panels",
        sourcePanelHashes: Object.fromEntries(surfaceTiles.map((tile) => [tile.surfaceKey, tile.sourcePanelHash])),
      },
    }, "flat-proof");
    return complete(sb, stage, await getRun(sb, run.id), {
      verified: true, receiptKind: "call8.flat-proof", call: 8,
      proofKind: "flattened-2d-proof",
      dimensionsAuthority: "genie-universal-panelizer", bleedInches: 5,
      sourceProofHash: proofArtifact.contentHash,
      storagePath: proofArtifact.storagePath,
      totalSqFt: manifest.totalSqFt,
      dimensionManifestId: rebound.dimension_manifest_id,
      manifestHash: rebound.manifest_hash,
      perSurfaceDimensions: manifest.expectedSurfaces.map(({ sourceAsset: _sourceAsset, ...surface }) => surface),
      // LINEAGE, NOT SOURCE. The seven proofs are this design's proofs and the
      // stage contract joins them to the frozen view set -- but not one of their
      // pixels is on the sheet. `proofPixelsUsed: false` says so in a field a
      // query can read, because the absence of a field proves nothing.
      viewLineage: frozenViews.viewReceipts,
      viewLineageRole: "presentation-only",
      proofPixelsUsed: false,
      flatMaterialHash: spec.materialHash,
      textLock: result.textLock,
      requiresPanelProTextReview: true,
      // No `imageModel`: nothing generated. No `surfaceFields`: nothing was
      // flattened. No `surfacePanels`: Call 8 does not cut panels, Call 1 did.
      producer: "designpro.call8-panel-proof.v4",
      deterministic: true,
      imageRequestCount: 0,
      assembledFrom: "atlas-call1-panels",
      surfaceTiles,
    }, null, [proofArtifact]);
}

async function executeEntice(sb, baseUrl, secret, supabaseUrl, stage, run, runtimeConfig) {
  const input = requiredObject(run.input, "workflow input");
  if (stage.stage_key === "revision.freeze") {
    const { data, error } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
    if (error || !data || data.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("revision_source_drift", "Immutable revision source does not match workflow", false);
    // A REFUSED PROOF MUST NOT CANCEL THE PANELS CALL 1 ALREADY CUT.
    //
    // This threw `seven_views_incomplete` NON-RETRYABLY on the FIRST stage of
    // the entice run, so one refused view killed the workflow before it began
    // -- and with it every artifact the workflow publishes: the six A.T.L.A.S.
    // panels, already cut and hashed and sitting in storage, and the Logo Pack.
    //
    // On an A.T.L.A.S. run the views are not the manufacturing source. The
    // accepted master is, and Call 1 cut the panels from it before any proof
    // rendered. So a short set is recorded and production continues -- the same
    // shape `proof.build` already uses for a deferred Call 8, for the same
    // reason: a documentation artifact must not hold the manufacturing chain
    // hostage.
    //
    // A run with NO A.T.L.A.S. panel set still fails hard. There the views
    // genuinely are what Call 9 cuts from, and a run missing one has nothing to
    // manufacture for that surface.
    const viewSet = revisionViewSet(data.snapshot, run.tenant_key, run.revision_id);
    const atlasPanels = viewSet.complete ? null : await callOnePanelSet(sb, run).catch(() => null);
    if (!viewSet.complete && !atlasPanels) throw viewSet.shortfall;
    const views = viewSet.views;
    const viewIdentities = await fingerprintRevisionViews(views, sb, run.tenant_key, run.revision_id);
    if (!viewSet.complete) {
      console.error(`[DESIGNPRO-OS] run ${run.id} froze a short view set: missing ${viewSet.missingRoles.join(", ")}`);
    }
    return complete(sb, stage, run, {
      verified: true,
      receiptKind: "views.seven-source",
      revisionSnapshotHash: data.snapshot_hash,
      requiredViewCount: 7,
      viewReceipts: viewIdentities,
      distinctViewsVerified: true,
      // STATED, NEVER INFERRED. `pack.verify` copies these onto the pack
      // receipt, so a pack assembled over a short set says so instead of
      // claiming seven views it never had.
      presentViewCount: viewSet.presentRoles.length,
      presentViewRoles: viewSet.presentRoles,
      ...(viewSet.complete ? {} : {
        sevenViewsVerified: false,
        missingViewRoles: viewSet.missingRoles,
        productionAuthority: "atlas-master",
        note: "One or more 3D proofs were refused. A.T.L.A.S. is the manufacturing authority and Call 1 had already cut the six panels, so the refused view is recorded and the panels and Logo Pack still publish.",
      }),
    });
  }
  if (stage.stage_key === "proof.build") {
    // CALL 8 IS A VALUE-ADD ARTIFACT, NOT THE MANUFACTURING AUTHORITY.
    //
    // A.T.L.A.S. is the single design and production authority: the accepted
    // master is cut into the six panels at Call 1, and those panels -- bound to
    // that master's hash, at GENIE dimensions with the five-inch bleed -- are
    // what gets printed. The 2D Production Proof is drawn LATER, from that same
    // accepted lineage, as documentation the customer signs.
    //
    // It sat second in the stage list, so it gated everything. In production it
    // failed 8 of its 11 attempts -- call8_design_master_input_missing,
    // call8_proof_font_missing, render_master_invalid -- and because a failed
    // stage stops the run, NOTHING downstream had ever executed: not the
    // PanelPro gate, not the enhancement, not one output file, not a ZIP, not a
    // WrapBox delivery. A documentation artifact was holding the entire
    // manufacturing chain hostage.
    //
    // So on a run whose panels came from A.T.L.A.S., a Call 8 failure is
    // RECORDED and the stage completes as deferred. The failure is not hidden:
    // the receipt says the proof is missing and why, PanelPro shows it, and the
    // proof can be rebuilt. What it no longer does is stop production.
    //
    // A run with no A.T.L.A.S. panel set still fails hard, because there the 2D
    // proof genuinely is the source Call 9 cuts from and a run without one has
    // nothing to manufacture.
    const atlasPanels = await callOnePanelSet(sb, run).catch(() => null);
    if (atlasPanels) {
      try {
        return await buildCall8Proof(sb, baseUrl, secret, run, stage, runtimeConfig, input);
      } catch (error) {
        // A lost lease is not a Call 8 defect -- the stage was aborted before
        // it could persist anything, and swallowing it would record a deferral
        // that never happened.
        if (error?.code === "stage_lease_lost" || error?.retryable === true) throw error;
        // A DEFECT IN THIS STAGE IS NOT A PROOF-SERVICE OUTAGE. (2026-08-28)
        //
        // The deferral above exists so a proof the tool cannot draw does not
        // hold manufacturing hostage. It is not a place to launder OUR bugs:
        // `buildCall8Proof` was extracted out of `executeEntice` and left
        // `baseUrl` and `secret` behind, so every entice run since threw
        // `ReferenceError: baseUrl is not defined` and recorded it as
        // `call8_proof_unavailable` -- a business-sounding receipt saying
        // "production continues" over a stage that could never run. Live on run
        // 8e9fab59-d282-4f92-a8aa-86b2f4e1d09e: the 2D Production Proof the
        // owner requires in the ZIP was never once produced, and nothing said
        // so in those words.
        //
        // A native error carries no `code`, which is exactly what distinguishes
        // it from every failure this stage raises deliberately. Still deferred,
        // because the policy above is right, but named as ours.
        const nativeDefect = !error?.code && !error?.stageCode
          && (error instanceof ReferenceError || error instanceof TypeError || error instanceof RangeError);
        const code = nativeDefect
          ? "call8_stage_defect"
          : String(error?.code || error?.stageCode || "call8_proof_unavailable");
        const message = String(error?.message || error);
        console.error(`[DESIGNPRO-OS] Call 8 deferred for run ${run.id}: ${code}: ${message}`);
        return complete(sb, stage, await getRun(sb, run.id), {
          verified: false,
          deferred: true,
          receiptKind: "call8.flat-proof",
          call: 8,
          proofKind: "flattened-2d-proof",
          productionAuthority: "atlas-master",
          note: "The 2D Production Proof is a later value-add artifact. A.T.L.A.S. is the manufacturing authority, so this failure is recorded and production continues.",
          failure: { code, message },
        }, null, []);
      }
    }
    return buildCall8Proof(sb, baseUrl, secret, run, stage, runtimeConfig, input);
  }
  if (stage.stage_key === "panels.build") {
    // ⚠️ READ THIS STAGE AS `panels.verify_and_promote`. (Trish 2026-08-28.)
    //
    // "Call 9 does not create these panels. `panels.build` is
    // verification/promotion of the already-created Call-1 bytes and must throw
    // on byte drift. Rename mentally/architecturally: panels.build =
    // panels.verify_and_promote."
    //
    // The stage_key itself stays `panels.build`: it is written into the
    // DesignProAI stage-run rows that already exist, seeded by migrations, and
    // referenced by `stageOutput(...)` lookups elsewhere in this file.
    // Renaming the key is a migration with a live-window risk
    // (CLAUDE.md: the runner must ship in an EARLIER PR than the migration that
    // schedules its stage), and it would buy nothing the comment does not.
    //
    // What matters is that nobody reads the word "build" as "produce". This
    // stage creates no artwork. It re-reads the exact Call-1 storage paths,
    // re-hashes the bytes, and throws `call9_call1_panel_changed` if they moved
    // even one byte.
    //
    // CALL 1 ALREADY CUT THESE PANELS. Promote those exact bytes.
    //
    // The panels RevisionStudio entices the buyer with, and the panels PanelPro
    // Studio is served, are the six A.T.L.A.S. cut from the canonical master at
    // Call 1, each sized to its own side with the five-inch bleed already in the
    // layout. Re-deriving them here would hand the board a different set of
    // bytes than the customer was shown.
    //
    // They arrive on the immutable revision snapshot, which is the interface
    // this side of the seam is allowed to read. Manufacturing never reaches back
    // into the generation tables to find them.
    const callOnePanels = await callOnePanelSet(sb, run);
    if (callOnePanels) {
      const spools = [];
      const panelArtifacts = [];
      const produced = [];
      const panelHashes = {};
      for (const panel of callOnePanels) {
        const bytes = await storageBytes(sb, panel.storagePath);
        const observed = hashBytes(bytes);
        if (observed !== String(panel.contentHash || "").toLowerCase() || bytes.length !== Number(panel.byteSize)) {
          throw new StageError("call9_call1_panel_changed", `${panel.surfaceKey} Call 1 panel changed before promotion`, false);
        }
        panelHashes[panel.surfaceKey] = observed;
        const dims = {
          trimWidthIn: Number(panel.trimWidthIn),
          trimHeightIn: Number(panel.trimHeightIn),
          printWidthIn: Number(panel.printWidthIn),
          printHeightIn: Number(panel.printHeightIn),
          surfaceSqFt: Number(panel.surfaceSqFt),
          bleedInches: Number(panel.bleedInches),
        };

        // PROMOTION COPIES THE BYTES; IT NEVER ALIASES CALL 1'S PATH.
        //
        // `designpro_artifacts` carries a BEFORE INSERT trigger,
        // `designpro_private.enforce_artifact_storage_identity`, that requires
        // every artifact to live under `designpro/<tenant_key>/<run_id>/…`.
        // Call 1 wrote these panels long before this run existed, under the
        // generation's own owner-scoped prefix, so registering that path as the
        // artifact raised `artifact_storage_identity_mismatch` and killed
        // `panels.build` half a second in -- live on run
        // 8e9fab59-d282-4f92-a8aa-86b2f4e1d09e, generation 8555be2f, whose six
        // Call-1 panels were all present and correct.
        //
        // Copying is the honest repair, not relaxing the trigger: that
        // invariant is what stops one run's artifact row pointing at another
        // run's bytes. And it costs nothing the owner cares about -- the bytes
        // are IDENTICAL ("the panels should just be the exact panels from the
        // ATLAS container design generation"). Nothing is re-cut, no AI runs,
        // and the copy is refused unless it hashes to the Call-1 panel it came
        // from. The Call-1 path and hash ride along as `sourceStoragePath` /
        // `sourceContentHash`, so the lineage is still one lineage published
        // twice (RULE 0.27 §3) rather than two representations.
        const storagePath = runScopedStoragePath(run, `panels/${panel.surfaceKey}.png`);
        const stored = await uploadProducedBytes(sb, run, stage, runtimeConfig, storagePath, bytes, "image/png");
        if (stored.spool) spools.push(stored.spool);
        if (String(stored.hash).toLowerCase() !== observed || Number(stored.bytes) !== bytes.length) {
          throw new StageError("call9_call1_panel_promotion_drift", `${panel.surfaceKey} promoted copy is not the Call 1 panel`, false);
        }

        produced.push({
          surfaceKey: panel.surfaceKey,
          storagePath: stored.storagePath,
          contentHash: observed,
          byteSize: bytes.length,
          sourceStoragePath: panel.storagePath,
          ...dims,
        });
        panelArtifacts.push(artifact("panel", stored.storagePath, observed, bytes.length, panel.surfaceKey, {
          source: "atlas-call1-panel",
          promotedFrom: "atlas-call1",
          deterministic: true,
          sourceStoragePath: panel.storagePath,
          sourceContentHash: observed,
          sourceMasterHash: panel.sourceMasterHash,
          geometryPurpose: panel.geometryPurpose,
          revisionId: run.revision_id,
          revisionSnapshotHash: run.revision_snapshot_hash || null,
          ...dims,
        }));
      }
      if (new Set(Object.values(panelHashes)).size !== SURFACE_KEYS.length) {
        throw new StageError("call9_panel_identity_collision", "Call 1 panels are not six distinct surfaces", false);
      }
      // THE DESIGN-PHASE PANEL MAP, written once beside the six promoted panels.
      // Call 11 renders the QC panels' data slug from it, and PanelPro shows it
      // beside the strip so the designer reads one against the other.
      const panelMap = designPanelMap({ run, revisionSource: await revisionSnapshotFor(sb, run), callOnePanels, promoted: produced, builtAt: new Date().toISOString() });
      const mapBytes = panelMapBytes(panelMap);
      const mapStored = await uploadProducedBytes(sb, run, stage, runtimeConfig, runScopedStoragePath(run, "panel-map.design.json"), mapBytes, "application/json");
      if (mapStored.spool) spools.push(mapStored.spool);
      panelArtifacts.push(artifact("panel-map", mapStored.storagePath, mapStored.hash, mapStored.bytes, "", {
        contract: PANEL_MAP_CONTRACT, phase: "design", productionSizingValidated: false,
        masterHash: panelMap.master.sha256, revisionId: run.revision_id, surfaceCount: SURFACE_KEYS.length,
      }));
      const completed = await complete(sb, stage, run, {
        verified: true,
        receiptKind: "call9.surface-panels",
        call: 9,
        panelSourceRule: PANEL_SOURCE_RULE,
        promotedFrom: "atlas-call1",
        deterministic: true,
        panels: produced,
        panelHashes,
        // CALL 10 READS THIS, AND ONLY THE DELETED ARM USED TO WRITE IT.
        //
        // `logos.extract` binds every separated logo to the verified source
        // REGION it was lifted from -- `requiredString(regionHashes[surface])`,
        // fatal when absent. That map was only ever emitted by the proof-derived
        // arm below, so with that arm gone a run with a listed logo inventory
        // would die at Call 10 with `call10_..._verified source region is
        // required`, and a run with an empty inventory would pass while the
        // field silently meant nothing.
        //
        // On the A.T.L.A.S. path the source region IS the promoted panel: the
        // logo sits on that surface, in those exact bytes. So the region hash is
        // the panel hash, stated rather than left missing. It is the same value
        // as `panelHashes` and deliberately not a second derivation of it.
        sourceRegionHashes: panelHashes,
        panelMapHash: mapStored.hash,
        panelMapContract: PANEL_MAP_CONTRACT,
      }, null, panelArtifacts);
      for (const spool of spools) await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed Call 1 panel promotion spool cleanup failed: ${error.message}`));
      return completed;
    }

    // FAIL CLOSED. NO CALL-1 PANEL SET MEANS NO PRODUCTION PANELS.
    //
    // Owner, 2026-08-29, after tracing the six "production panels" on Northgate
    // back to their source bytes: "No pixel originating from a 3D proof may ever
    // become a Call-8 surface, production panel, print file, or ZIP asset."
    //
    // WHAT USED TO BE HERE. A second arm that, when the revision carried no
    // `callOnePanels`, read `proof.build`'s `surfaceFields` -- six images
    // Gemini FLATTENED OUT OF THE SIX 3D PROOF PHOTOGRAPHS -- and gridsliced
    // them into `panel` artifacts. It was added by 2eb62f3 (#123, 2026-08-21)
    // when that was the only panel source there was; f2620290 (#143,
    // 2026-08-23) put the Call-1 promotion in front of it and left it standing
    // as a fallback. So the stage FAILED OPEN: a run that lost its Call-1
    // panels for any reason silently shipped print files descended from
    // photographs of a vehicle, correctly dimensioned by GENIE and wrong in
    // every pixel. GENIE dimensions around an image do not make the image
    // production artwork.
    //
    // The only legal production artwork source is the Call-1 flattened
    // A.T.L.A.S. master -> exact deterministic container crop -> Call-1 panel.
    // The photographer stack is strictly downstream of that (RULE 0.29:
    // "the extracted panel is ARTWORK authority; the photographer/view/studio
    // stack is PRESENTATION authority only"), and information never flows back
    // up it.
    //
    // REMOVING IT BREAKS NOTHING LIVE. Every `panel` artifact this system has
    // ever written came from one of two shapes, and neither is that arm:
    // `source: atlas-call1-panel` (six, one run, 2026-08-28) and a pre-#123
    // shape carrying no `extractionContract` (six, one run, 2026-08-18).
    // The proof-derived arm has produced a production panel exactly zero times.
    //
    // A Standard (non-A.T.L.A.S.) run reaches this too, and it is meant to:
    // there is no master, so there is nothing deterministic to cut, and the
    // honest outcome is that the panels were not created. The UI reports
    // PRODUCTION PANELS NOT CREATED rather than showing six pictures of a
    // truck under a print-file heading.
    throw new StageError(
      "production_panels_not_created",
      "No deterministic Call-1 panel set exists for this revision. Production panels are only ever a geometric crop of the accepted A.T.L.A.S. master; nothing is derived from a 3D proof.",
      false,
    );
  }
  if (stage.stage_key === "logos.extract") {
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("snapshot,snapshot_hash").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource || revisionSource.snapshot_hash !== run.revision_snapshot_hash) throw new StageError("call10_revision_source_drift", "Immutable logo inventory source changed", false);
    if (!Array.isArray(revisionSource.snapshot?.expectedLogoInventory)) throw new StageError("call10_inventory_not_frozen", "Revision snapshot must freeze expectedLogoInventory", false);
    const expected = revisionSource.snapshot.expectedLogoInventory;
    const attestation = revisionSource.snapshot.logoInventoryAttestation;
    if (!attestation || attestation.attested !== true || !["none", "listed"].includes(attestation.mode)
      || (attestation.mode === "none" && expected.length !== 0) || (attestation.mode === "listed" && expected.length === 0)) {
      throw new StageError("call10_inventory_attestation_invalid", "Logo inventory must be explicitly attested as none or listed", false);
    }
    const call9 = await stageOutput(sb, run.id, "panels.build");
    const regionHashes = call9.sourceRegionHashes || {};
    // WHICH DESIGN THESE LOGOS BELONG TO.
    //
    // A logo was separated from a panel, and that panel records the A.T.L.A.S.
    // master it was cut from. Without carrying that hash forward the logo is
    // unattributable: PanelPro can tell which surface it sits on but not which
    // VERSION of the design it came from, so selecting V1 would still show V3's
    // brand assets. Reading it off the panel rather than restating it keeps one
    // statement of the lineage instead of two that can disagree.
    const panelRows = await artifacts(sb, run.id, ["panel"]);
    const masterBySurface = new Map(panelRows.map((row) => [
      String(row.surface_key), String(row.metadata?.sourceMasterHash || ""),
    ]));
    const produced = [];
    for (let index = 0; index < expected.length; index++) {
      const identityKey = requiredString(expected[index]?.identityKey, `expectedInventory[${index}].identityKey`);
      const displayName = requiredString(expected[index]?.displayName, `${identityKey}.displayName`);
      const targetSurfaceKey = requiredString(expected[index]?.surfaceKey, `${identityKey}.surfaceKey`);
      if (!SURFACE_KEYS.includes(targetSurfaceKey)) throw new StageError("call10_logo_surface_invalid", `${identityKey}: ${targetSurfaceKey}`, false);
      const sourceRegionHash = requiredString(regionHashes[targetSurfaceKey], `${identityKey} verified source region`).toLowerCase();
      const placementKey = `${targetSurfaceKey}:${identityKey}:${index}`;
      let logoAsset;
      try { logoAsset = normalizeLogoAsset(expected[index], run.tenant_key, run.revision_id); }
      catch (error) { throw new StageError("call10_logo_asset_invalid", `${identityKey}: ${error.message}`, false); }
      produced.push(await exactStoredArtifact(sb, { ...logoAsset, surfaceKey: placementKey, metadata: { placementKey, identityKey, displayName, targetSurfaceKey, contentType: logoAsset.contentType, sourceRegionHash, sourceMasterHash: masterBySurface.get(targetSurfaceKey) || null, separationContract: "designpro.deterministic-stored-overlay.v1" } }, "logo"));
    }
    const inventory = expected.map((item, index) => ({ placementKey: produced[index]?.metadata?.placementKey, identityKey: item.identityKey, targetSurfaceKey: item.surfaceKey, contentHash: produced[index]?.contentHash || null }));
    const inventoryHash = hashJson(inventory);
    return complete(sb, stage, run, { verified: true, receiptKind: "call10.logo-inventory", call: 10, inventoryContract: "designpro.expected-logo-inventory.v1", exactSetVerified: true, inventoryHash, inventory }, null, produced);
  }
  // Vision bridge for Call 11. The ported detector takes an injected geminiJson
// so its re-ask loop and box parsing are provable without a provider; this is
// the live implementation it is given in production.
const LOGO_LOCATE_MODEL = "gemini-2.5-flash";

async function locateLogosForPanel(panelBytes, surfaceKey) {
  const apiKey = String(process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) throw new StageError("call11_logo_locate_key_missing", "Call 11 logo location requires GOOGLE_AI_API_KEY", true);
  // The detector is fed a bounded copy: a 1280px long edge is ample for locating
  // a mark, and it keeps a 4K production panel from being base64'd whole.
  const locateB64 = (await sharp(panelBytes, { limitInputPixels: false })
    .resize(1280, 1280, { fit: "inside", withoutEnlargement: true })
    .png().toBuffer()).toString("base64");
  const geminiJson = async (parts) => {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${LOGO_LOCATE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 8192 },
      }),
    });
    if (!response.ok) throw new Error(`logo_locate_http_${response.status}`);
    const payload = await response.json();
    const text = (payload?.candidates?.[0]?.content?.parts || []).map((part) => part?.text || "").join("").trim();
    if (!text) throw new Error("logo locate returned no text");
    return JSON.parse(text);
  };
  try {
    return await locateLogoElements(locateB64, { geminiJson, log: (message) => console.warn(`${message} (${surfaceKey})`) });
  } catch (error) {
    // Detection failure is retryable: a QC duplicate built from an unverified
    // detection would claim to be de-logoed without being so.
    throw new StageError("call11_logo_locate_failed", `${surfaceKey}: ${error?.message || error}`, true);
  }
}

// CALL 11 — DE-LOGO DUPLICATE SET.
  //
  // Duplicate the six immutable Call 9 branded panels, remove logos from the
  // duplicates ONLY, and emit six qc-panel artifacts for PanelPro sizing and
  // template QC. The branded set is production artwork and is never touched:
  // every source panel's bytes are re-hashed after the edit and the stage fails
  // closed if any moved.
  //
  // These derivatives are non-authoritative. They are never printed and never
  // enter Topaz, the output set or the ZIP.
  if (stage.stage_key === "panels.delogo") {
    const call9 = await stageOutput(sb, run.id, "panels.build");
    const brandedPanels = await artifacts(sb, run.id, ["panel"]);
    if (brandedPanels.length !== SURFACE_KEYS.length || new Set(brandedPanels.map((row) => row.surface_key)).size !== SURFACE_KEYS.length) {
      throw new StageError("call11_branded_set_incomplete", "Call 11 requires the exact six branded Call 9 panels", false);
    }
    const spools = [];
    const produced = [];
    const removals = {};
    // THE PANEL DATA SLUG ON EVERY QC PANEL (owner, 2026-09-02). The team reads
    // it on the PanelPro board at preflight, before Topaz and output exist, so
    // it is rendered here at a fixed legible height from the design-phase map.
    // A run promoted before the map existed rebuilds the same map from the
    // same inputs rather than failing; the metadata records which it was.
    let qcMap = await storedPanelMap(sb, run, "design");
    let qcMapSource = "panel-map-artifact";
    if (!qcMap) {
      const callOnePanels = await callOnePanelSet(sb, run);
      if (!callOnePanels) throw new StageError("call11_panel_map_source_missing", "Call 11 needs the Call-1 panel set to render the panel data slug", false);
      const promoted = SURFACE_KEYS.map((surfaceKey) => {
        const row = brandedPanels.find((item) => item.surface_key === surfaceKey);
        const source = callOnePanels.find((panel) => panel.surfaceKey === surfaceKey) || {};
        return { surfaceKey, storagePath: row.storage_path, contentHash: String(row.content_hash).toLowerCase(), trimWidthIn: source.trimWidthIn, trimHeightIn: source.trimHeightIn, printWidthIn: source.printWidthIn, printHeightIn: source.printHeightIn, bleedInches: source.bleedInches, surfaceSqFt: source.surfaceSqFt };
      });
      qcMap = designPanelMap({ run, revisionSource: await revisionSnapshotFor(sb, run), callOnePanels, promoted, builtAt: new Date().toISOString() });
      qcMapSource = "rebuilt-from-call1-panels";
    }
    for (const surface of SURFACE_KEYS) {
      const row = brandedPanels.find((item) => item.surface_key === surface);
      if (!row) throw new StageError("call11_branded_panel_missing", surface, false);
      const expectedHash = String(call9.panelHashes?.[surface] || "").toLowerCase();
      if (!HASH_RE.test(expectedHash) || String(row.content_hash).toLowerCase() !== expectedHash) {
        throw new StageError("call11_branded_receipt_mismatch", `${surface} branded panel does not match the Call 9 receipt`, false);
      }
      const branded = await storageBytes(sb, row.storage_path);
      if (hashBytes(branded) !== expectedHash) {
        throw new StageError("call11_branded_panel_changed", `${surface} branded panel changed before duplication`, false);
      }

      // The duplicate is an independent buffer. The branded bytes are only ever
      // read, so there is no path by which this stage can write over Call 9.
      const duplicate = Buffer.from(branded);
      const image = sharp(duplicate, { limitInputPixels: false });
      const { width, height } = await image.metadata();
      if (!width || !height) throw new StageError("call11_panel_not_decodable", surface, false);

      const located = await locateLogosForPanel(duplicate, surface);
      const rects = logoBoxesToPixelRects(located, width, height);
      // HONEST NO-OP: a panel with no logo mark still produces its duplicate so
      // the side is present for template QC, and records removedCount 0 so "no
      // logos found" is never read as "removal succeeded".
      const edited = isHonestNoOp(rects)
        ? await sharp(duplicate, { limitInputPixels: false }).png().toBuffer()
        : await sharp(duplicate, { limitInputPixels: false })
            .composite(rects.map((rect) => ({
              input: { create: { width: rect.w, height: rect.h, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } },
              left: rect.x, top: rect.y,
            })))
            .png().toBuffer();

      const qcSlugRows = slugRows(qcMap, surface, { fileName: `${surface}-qc-panel.png` });
      let slugged;
      try { slugged = await applyPanelDataSlug(edited, { rows: qcSlugRows, heightPx: QC_SLUG_PIXELS }); }
      catch (error) { throw new StageError(error.code || "call11_panel_data_slug_failed", error.message, false); }
      const storagePath = `designpro/${tenantKey(run.tenant_key)}/${run.id}/qc-panels/${surface}.png`;
      const stored = await uploadProducedBytes(sb, run, stage, runtimeConfig, storagePath, slugged.bytes, "image/png");
      if (stored.spool) spools.push(stored.spool);
      removals[surface] = rects.length;
      produced.push(artifact("qc-panel", stored.storagePath, stored.hash, stored.bytes, surface, {
        call: 11, role: "panelpro-qc-duplicate", authoritative: false, printable: false,
        // Step 5 of the contract: every duplicate binds to the branded panel it
        // came from, by hash and by surface_key.
        sourcePanelHash: expectedHash, sourcePanelPath: row.storage_path, surfaceKey: surface,
        removedLogoCount: rects.length, removedLabels: rects.map((rect) => rect.label),
        removalContract: "designpro.call11-delogo-duplicate.v1",
        trimWidthInches: row.metadata?.trimWidthInches ?? null,
        trimHeightInches: row.metadata?.trimHeightInches ?? null,
        bleed: { top: 5, right: 5, bottom: 5, left: 5 },
        // The strip below the artwork, declared so the board can crop it at 1:1
        // and the attestation names what was read.
        ...slugMetadata({ heightPx: QC_SLUG_PIXELS, inches: null, rows: qcSlugRows }),
        artworkHeightPixels: slugged.artworkHeight,
        pixelWidth: slugged.width, pixelHeight: slugged.height,
        panelMapContract: PANEL_MAP_CONTRACT, panelMapSource: qcMapSource,
      }));
    }

    // Step 3, proven rather than asserted: re-read every branded panel and
    // confirm it is byte-for-byte what Call 9 published.
    for (const surface of SURFACE_KEYS) {
      const row = brandedPanels.find((item) => item.surface_key === surface);
      const after = hashBytes(await storageBytes(sb, row.storage_path));
      if (after !== String(call9.panelHashes?.[surface] || "").toLowerCase()) {
        throw new StageError("call11_branded_panel_mutated", `${surface} branded panel was modified by Call 11`, false);
      }
    }
    const qcHashes = Object.fromEntries(produced.map((item) => [item.surfaceKey, item.contentHash]));
    if (new Set(Object.values(qcHashes)).size !== produced.length) {
      throw new StageError("call11_qc_panel_reuse", "Every QC duplicate must be its own image", false);
    }
    const completed = await complete(sb, stage, run, {
      verified: true, receiptKind: "call11.qc-panels", call: 11,
      role: "panelpro-qc-duplicate", authoritative: false,
      sides: produced.map((item) => item.surfaceKey),
      qcPanelHashes: qcHashes, sourcePanelHashes: call9.panelHashes || {},
      removedLogoCounts: removals, brandedSetPreserved: true,
      removalContract: "designpro.call11-delogo-duplicate.v1",
    }, null, produced);
    for (const spool of spools) await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed Call 11 QC panel spool cleanup failed: ${error.message}`));
    return completed;
  }
  if (stage.stage_key === "pack.verify") {
    const views = await receipt(sb, run.id, "views.seven-source");
    // Call 8 is either a built proof or a recorded deferral, and the pack's
    // identity binds whichever actually happened. Asking only for the proof
    // kind made a deferred A.T.L.A.S. run die here on receipt_missing --
    // the same class of defect as proof.build's, one stage further along.
    const call8 = await receipt(sb, run.id, "call8.flat-proof")
      .catch(() => receipt(sb, run.id, "call8.flat-proof-deferred"));
    const call9 = await receipt(sb, run.id, "call9.surface-panels");
    const call10 = await receipt(sb, run.id, "call10.logo-inventory");
    const call8Deferred = call8.receipt?.deferred === true;
    const sourceContract = { revisionSnapshotHash: run.revision_snapshot_hash, manifestHash: run.manifest_hash, views: views.receipt_hash, call8: call8.receipt_hash, call9: call9.receipt_hash, call10: call10.receipt_hash };
    // THE PACK REPORTS WHAT THE FREEZE ACTUALLY FROZE.
    //
    // `sevenViewsVerified: true` used to be a literal, so a pack assembled over
    // a short view set asserted seven views it never had -- the "do not report
    // READY while an artifact is missing" failure, written into the pack's own
    // immutable identity. It now reads the freeze receipt, which states the
    // count and names the refused roles.
    const shortViewSet = views.receipt?.sevenViewsVerified === false;
    const packReceipt = {
      verified: true, exactCallSet: [8, 9, 10], sevenViewsVerified: !shortViewSet, sourceContract,
      ...(shortViewSet ? {
        missingViewRoles: views.receipt?.missingViewRoles || [],
        presentViewCount: views.receipt?.presentViewCount ?? null,
        productionAuthority: "atlas-master",
      } : {}),
      // Stated, so the pack's own record says whether the 2D Production Proof
      // exists rather than leaving a later reader to infer it from a hash.
      ...(call8Deferred ? {
        call8Deferred: true,
        productionAuthority: "atlas-master",
        call8Failure: call8.receipt?.failure || null,
      } : {}),
    };
    const { data, error } = await sb.rpc("finalize_designpro_entice_identity", { p_run_id: run.id, p_stage_id: stage.id, p_lease_token: stage.lease_token, p_source_contract_hash: null, p_artifact_set_hash: null, p_pack_receipt: packReceipt });
    if (error) throw new StageError("pack_identity_finalize_failed", error.message, false);
    return complete(sb, stage, await getRun(sb, run.id), { verified: true, ...packReceipt, ...data });
  }
  if (stage.stage_key === "pack.activate") {
    await stageOutput(sb, run.id, "pack.verify");
    // PREPARATION ENDS HERE. THE CUSTOMER HAS NOT PAID YET.
    //
    // Calls 1-11 run automatically and are cheap on purpose: they exist so the
    // customer can see the six branded panels, their clean duplicates and the
    // separated logos before deciding. Everything after this stage -- Topaz,
    // the output build, the ZIP, delivery -- is expensive, and the existence of
    // a preview does not authorize any of it.
    //
    // The production workflow IS created here, and it is still the only one --
    // rebuilding it elsewhere would be the second conductor. What changed is
    // that its first stage is await_purchase, so it exists, reaches the gate,
    // and stops. Preparation no longer flows into Topaz; a customer who never
    // buys leaves a run parked at a gate, which costs nothing.
    await complete(sb, stage, run, {
      verified: true, active: true, activatedAt: new Date().toISOString(),
      // Stated on the receipt so no later reader has to infer why production
      // has not started: it is waiting on a purchase, not stalled.
      awaitingPurchase: true,
      purchasableProducts: ["print_pack_entitlement", "logo_pack"],
    });
    return ensureAutomaticProduction(sb, run.id);
  }
  throw new StageError("unsupported_entice_stage", stage.stage_key, false);
}

async function buildPrintOutputs(sb, run, input, stage, runtimeConfig) {
  const sourceRunId = requiredString(run.results?.sourceEnticeRunId || input.sourceEnticeRunId, "sourceEnticeRunId");
  // Production files are rendered from the Call 12 enhanced masters, which are
  // already at full print geometry. The Call 9 panels stay bound as lineage but
  // are never the raster source here: stretching them would discard the
  // enhancement the customer is paying for.
  const call12 = await receipt(sb, run.id, "call12.topaz-upscale");
  const panels = await artifacts(sb, run.id, ["upscaled-panel"]);
  if (panels.length !== SURFACE_KEYS.length || new Set(panels.map((item) => item.surface_key)).size !== SURFACE_KEYS.length) throw new StageError("enhanced_panels_missing", "Exact six Call 12 enhanced panels are required", false);
  for (const panel of panels) {
    if (String(panel.content_hash).toLowerCase() !== String(call12.receipt?.enhancedHashes?.[panel.surface_key] || "").toLowerCase()) {
      throw new StageError("enhanced_panel_receipt_mismatch", `Call 12 ${panel.surface_key} receipt and stored enhanced panel differ`, false);
    }
  }
  const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
  const dimensions = new Map((dimensionManifest.expectedSurfaces || []).map((item) => [String(item.surfaceKey), item]));
  const produced = [];
  const spools = [];
  // THE PRODUCTION-PHASE PANEL MAP, written once before any file, from the
  // validated GENIE inches, the enhanced panels and the bound order. Every
  // output's slug is rendered from it and every output names its hash.
  const revisionSource = await revisionSnapshotFor(sb, run);
  const callOnePanels = await callOnePanelSet(sb, run);
  if (!callOnePanels) throw new StageError("output_panel_map_source_missing", "Production outputs need the Call-1 panel set to build the panel map", false);
  let orderNumber = null;
  try { orderNumber = immutableBusinessIdentity(revisionSource, run).orderNumber; } catch { orderNumber = null; }
  const snapshot = revisionSource.snapshot || {};
  const generationId = String(snapshot.generationId || revisionSource.generation_id || "").toLowerCase();
  const masterHashes = new Set(callOnePanels.map((panel) => String(panel.sourceMasterHash || "").toLowerCase()));
  if (masterHashes.size !== 1) throw new StageError("panel_map_master_split", "Call 1 panels do not name exactly one master", false);
  let productionMap;
  try {
    productionMap = buildPanelMap({
      phase: "production",
      generationId,
      revisionId: run.revision_id,
      revisionSequence: revisionSequenceFromPath(callOnePanels[0].storagePath),
      designId: canonicalDesignId(generationId),
      orderNumber,
      customerName: snapshot.delivery?.customerName || snapshot.brandIdentity?.companyName || null,
      vehicle: snapshot.vehicle || {},
      genie: { manifestId: dimensionManifest.manifestId || callOnePanels[0].genieManifestId || null, manifestHash: dimensionManifest.manifestHash || dimensionManifest.dimensionBasisHash || callOnePanels[0].genieManifestHash || null },
      master: { sha256: [...masterHashes][0], storagePath: null, px: null },
      geometrySource: dimensionManifest.source || dimensionManifest.derivationContract || "genie-manifest",
      productionSizingValidated: true,
      builtAt: new Date().toISOString(),
      surfaces: panels.map((panel) => {
        const dims = dimensions.get(String(panel.surface_key)) || {};
        const source = callOnePanels.find((item) => item.surfaceKey === panel.surface_key) || {};
        return {
          surfaceKey: panel.surface_key,
          contentHash: panel.content_hash, storagePath: panel.storage_path,
          pixelWidth: Number(panel.metadata?.widthPx), pixelHeight: Number(panel.metadata?.heightPx),
          trimWidthIn: Number(dims.widthInches), trimHeightIn: Number(dims.heightInches),
          printWidthIn: Number(dims.widthInches) + 10, printHeightIn: Number(dims.heightInches) + 10,
          bleedInches: 5, surfaceSqFt: dims.surfaceSqFt,
          nativePpi: Number(panel.metadata?.widthPx) > 0 ? Math.round(Number(panel.metadata.widthPx) / (Number(dims.widthInches) + 10) * 100) / 100 : undefined,
          sourceMasterHash: source.sourceMasterHash,
          fileRole: "call12-enhanced-panel",
        };
      }),
    });
  } catch (error) {
    if (error instanceof StageError) throw error;
    throw new StageError(error.code || "panel_map_invalid", error.message, false);
  }
  const mapBytes = panelMapBytes(productionMap);
  const mapStored = await uploadProducedBytes(sb, run, stage, runtimeConfig, `designpro/${tenantKey(run.tenant_key)}/${run.id}/outputs/panel-map.production.json`, mapBytes, "application/json");
  if (mapStored.spool) spools.push(mapStored.spool);
  produced.push(artifact("panel-map", mapStored.storagePath, mapStored.hash, mapStored.bytes, "", {
    contract: PANEL_MAP_CONTRACT, phase: "production", productionSizingValidated: true,
    masterHash: productionMap.master.sha256, revisionId: run.revision_id, orderNumber, surfaceCount: SURFACE_KEYS.length,
  }));
  for (const panel of panels) {
    const dims = dimensions.get(String(panel.surface_key));
    if (!dims || !Object.values(dims.bleed || {}).every((value) => Number(value) === 5)) throw new StageError("output_dimensions_missing", `GENIE dimensions missing for ${panel.surface_key}`, false);
    const source = await storageBytes(sb, panel.storage_path);
    if (hashBytes(source) !== panel.content_hash) throw new StageError("source_panel_changed", panel.surface_key, false);
    const width = Math.round((Number(dims.widthInches) + 10) * 150);
    const height = Math.round((Number(dims.heightInches) + 10) * 150);
    if (!(width > 0 && height > 0 && width * height <= 650_000_000)) throw new StageError("output_geometry_invalid", panel.surface_key, false);
    let contained = await sharp(source, { limitInputPixels: false }).resize(width, height, { fit: "inside", kernel: "lanczos3" }).flatten().png().toBuffer();
    const containedMeta = await sharp(contained).metadata();
    const left = Math.floor((width - containedMeta.width) / 2); const right = width - containedMeta.width - left;
    const top = Math.floor((height - containedMeta.height) / 2); const bottom = height - containedMeta.height - top;
    if (left || right || top || bottom) contained = await sharp(contained).extend({ left, right, top, bottom, extendWith: "mirror" }).png().toBuffer();
    // THE PANEL DATA SLUG: 1.5" at the file's full-scale 150 PPI on the bottom
    // edge, outside the bleed. The artwork above it is exactly `contained`;
    // the file is 225 px taller and says so in every format.
    const slug = String(panel.surface_key).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const rows = slugRows(productionMap, panel.surface_key, { fileName: `${slug}.tiff`, outputPpi: 150 });
    let slugged;
    try { slugged = await applyPanelDataSlug(contained, { rows, heightPx: OUTPUT_SLUG_PIXELS }); }
    catch (error) { throw new StageError(error.code || "output_panel_data_slug_failed", error.message, false); }
    contained = null;
    const fileHeight = slugged.height;
    if (slugged.width !== width || slugged.artworkHeight !== height || fileHeight !== height + OUTPUT_SLUG_PIXELS) throw new StageError("output_panel_data_slug_geometry_invalid", panel.surface_key, false);
    const outputMetadata = (format, extra = {}) => ({
      format, width, height: fileHeight, artworkHeightPixels: height, dpi: 1500, outputScale: 0.1, fullScaleBleedInches: 5, colorMode: "sRGB",
      physicalWidthInches: width / 1500, physicalHeightInches: fileHeight / 1500,
      productionWidthInches: Number(dims.widthInches) + 10, productionHeightInches: Number(dims.heightInches) + 10,
      panelMapHash: mapStored.hash, panelMapContract: PANEL_MAP_CONTRACT,
      ...slugMetadata({ heightPx: OUTPUT_SLUG_PIXELS, inches: SLUG_INCHES, rows }),
      ...extra,
    });
    const raster = await sharp(slugged.bytes).removeAlpha().toColourspace("srgb").png({ compressionLevel: 6 }).withMetadata({ density: 1500 }).toBuffer();
    const base = `designpro/${tenantKey(run.tenant_key)}/${run.id}/outputs/${slug}`;
    const png = await uploadProducedBytes(sb, run, stage, runtimeConfig, `${base}.png`, raster, "image/png");
    if (png.spool) spools.push(png.spool);
    produced.push(artifact("output", png.storagePath, png.hash, png.bytes, panel.surface_key, outputMetadata("png")));
    const tiffBytes = await sharp(slugged.bytes).removeAlpha().toColourspace("srgb").tiff({ compression: "lzw", predictor: "horizontal", bitdepth: 8 }).withMetadata({ density: 1500 }).toBuffer();
    const tiff = await uploadProducedBytes(sb, run, stage, runtimeConfig, `${base}.tiff`, tiffBytes, "image/tiff");
    if (tiff.spool) spools.push(tiff.spool);
    produced.push(artifact("output", tiff.storagePath, tiff.hash, tiff.bytes, panel.surface_key, outputMetadata("tiff")));
    const { data: rgb, info } = await sharp(slugged.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== width || info.height !== fileHeight || info.channels !== 3) throw new StageError("eps_raster_geometry_invalid", panel.surface_key, false);
    const epsBytes = buildDeterministicRasterEps({
      rgb,
      widthPixels: width,
      heightPixels: fileHeight,
      trimWidthInches: Number(dims.widthInches),
      trimHeightInches: Number(dims.heightInches),
      slug: PANEL_DATA_SLUG,
    });
    const eps = await uploadProducedBytes(sb, run, stage, runtimeConfig, `${base}.eps`, epsBytes, "application/postscript");
    if (eps.spool) spools.push(eps.spool);
    produced.push(artifact("output", eps.storagePath, eps.hash, eps.bytes, panel.surface_key, outputMetadata("eps", { rasterSha256: hashBytes(rgb) })));
  }
  return { produced, spools };
}

function canonicalDesignId(generationId) {
  const value = String(generationId || "").trim().toLowerCase();
  if (!UUID_RE.test(value)) throw new StageError("stamp_generation_identity_invalid", "Immutable generationId is not a canonical UUID", false);
  return `DID-${value.replaceAll("-", "").slice(0, 8).toUpperCase()}`;
}

function resolvedFulfillmentSnapshot(revisionSource, run) {
  const snapshot = requiredObject(revisionSource?.snapshot, "immutable revision snapshot");
  const frozen = run?.input?.fulfillment;
  const snapshotBound = snapshot.delivery && typeof snapshot.delivery === "object"
    && !Array.isArray(snapshot.delivery) && String(snapshot.orderNumber || "");

  if (snapshotBound) {
    const delivery = assertDeliverySnapshot(snapshot);
    if (frozen != null && (!frozen || typeof frozen !== "object" || Array.isArray(frozen)
      || frozen.contractVersion !== "designpro.fulfillment-binding.v1"
      || frozen.revisionId !== run.revision_id
      || !HASH_RE.test(String(frozen.bindingHash || ""))
      || frozen.orderNumber !== snapshot.orderNumber
      || JSON.stringify(canonical(frozen.delivery)) !== JSON.stringify(canonical(delivery)))) {
      throw new StageError("production_fulfillment_binding_drift", "Frozen production fulfillment differs from the immutable bound revision", false);
    }
    return Object.freeze({ ...snapshot, delivery, orderNumber: snapshot.orderNumber });
  }

  const exactKeys = ["bindingHash", "contractVersion", "delivery", "orderNumber", "revisionId"];
  // v3/A.T.L.A.S. and v2 are both design-first: neither carries a WrapBox
  // recipient at generation time, so both reach the late fulfillment binding
  // here. Only v2 was named, which would have refused every atlas production
  // run at the delivery leg even after the handoff itself admitted them.
  if (!["designpro.calls-1-7-input.v2", "designpro.calls-1-7-input.v3"].includes(snapshot.sourceInputContract)
    || snapshot.fulfillment?.contractVersion !== "designpro.fulfillment-state.v1"
    || snapshot.fulfillment?.state !== "unbound"
    || snapshot.orderNumber != null || snapshot.delivery != null
    || !frozen || typeof frozen !== "object" || Array.isArray(frozen)
    || JSON.stringify(Object.keys(frozen).sort()) !== JSON.stringify(exactKeys)
    || frozen.contractVersion !== "designpro.fulfillment-binding.v1"
    || frozen.revisionId !== run.revision_id
    || !HASH_RE.test(String(frozen.bindingHash || ""))) {
    throw new StageError("production_fulfillment_binding_missing", "The paid production run is not frozen to an exact late fulfillment binding", false);
  }
  const delivery = assertDeliverySnapshot({ delivery: frozen.delivery });
  const orderNumber = requiredString(frozen.orderNumber, "fulfillment.orderNumber");
  if (delivery.orderNumber !== orderNumber || delivery.designName !== snapshot.designName) {
    throw new StageError("production_fulfillment_binding_drift", "Late fulfillment does not match the frozen design identity", false);
  }
  return Object.freeze({ ...snapshot, delivery, orderNumber });
}

function immutableBusinessIdentity(revisionSource, run) {
  const snapshot = resolvedFulfillmentSnapshot(revisionSource, run);
  const generationId = requiredString(snapshot.generationId, "revisionSnapshot.generationId").toLowerCase();
  const designId = canonicalDesignId(generationId);
  const orderNumber = requiredString(snapshot.orderNumber, "revisionSnapshot.orderNumber");
  if (String(revisionSource.generation_id || "").toLowerCase() !== generationId || snapshot.designId !== designId || snapshot.delivery?.orderNumber !== orderNumber
    || orderNumber !== orderNumber.trim() || orderNumber.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._/# -]*$/.test(orderNumber)
    || revisionSource.snapshot_hash !== run.revision_snapshot_hash || revisionSource.owner_id !== run.owner_id || revisionSource.tenant_key !== run.tenant_key) {
    throw new StageError("stamp_business_identity_drift", "DesignID or Order # is missing, noncanonical, or no longer bound to the immutable revision", false);
  }
  return { designId, orderNumber };
}

/**
 * The seal's curved ring caption, drawn as individually rotated glyphs.
 *
 * It used to be a <textPath>, which librsvg -- the renderer sharp uses -- does
 * not implement. It emitted no error and no pixels, so every seal this server has
 * ever stamped carried a bare ring with the caption silently missing. Measured
 * both ways: `href` and `xlink:href` each render exactly zero ink.
 *
 * Placing each character on the arc is plain SVG that librsvg does support, so
 * the caption survives rendering instead of depending on a feature the renderer
 * lacks.
 */
function ringCaption(text, centre, radius, size, fill, arc = "top", span = 170) {
  const characters = [...String(text)];
  // The lower arc sweeps the other way so its glyphs read left to right
  // along the bottom of the seal instead of upside down.
  const start = arc === "bottom" ? -180 + (180 - span) / 2 : 180 - (180 - span) / 2;
  // Advance by approximate glyph width rather than by slot. Equal slots give a
  // narrow "I" the same arc as a wide "W", which reads as ragged spacing on a
  // seal that appears on every delivered pack.
  const widthOf = (character) => {
    if (character === " ") return 0.5;
    if ("Il.·'".includes(character)) return 0.45;
    if ("JT".includes(character)) return 0.8;
    if ("MW".includes(character)) return 1.3;
    return 1;
  };
  const widths = characters.map(widthOf);
  const total = widths.reduce((sum, width) => sum + width, 0);
  let advanced = 0;
  return characters.map((character, index) => {
    const centreOffset = advanced + widths[index] / 2;
    advanced += widths[index];
    const angle = arc === "bottom"
      ? start + (centreOffset / total) * span
      : start - (centreOffset / total) * span;
    const radians = angle * Math.PI / 180;
    const x = (centre + radius * Math.cos(radians)).toFixed(1);
    const y = (centre - radius * Math.sin(radians)).toFixed(1);
    const glyph = character.replace(/[&<>"']/g, (value) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[value]);
    const rotation = arc === "bottom" ? -90 - angle : 90 - angle;
    return `<text x="${x}" y="${y}" transform="rotate(${rotation.toFixed(1)} ${x} ${y})" text-anchor="middle" font-family="Arial" font-size="${size}" font-weight="700" fill="${fill}">${glyph}</text>`;
  }).join("");
}

function stampSvg(verifiedBy, designId, orderNumber, date) {
  const escape = (text) => String(text).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
  // The DesignProAI Quality Approval Check seal, drawn to the owner's stamp:
  // a scalloped teal rosette, DesignProAI arced over the top, QUALITY APPROVAL
  // CHECK arced under the bottom, a star either side of the centre panel.
  //
  // It is drawn rather than embedded so the identity it carries is the run's
  // own: the DesignID, the Order #, who approved it and when. A seal that is a
  // fixed image says only that SOMETHING was approved -- this one says which
  // design, which order, by whom, on what date, and it appears on the delivered
  // proof and in the pack.
  const teal = "#2f8f97";
  const paper = "#f3efe6";
  // 48 scallops around the rim, the rosette edge of a rubber stamp.
  const scallops = Array.from({ length: 48 }, (unused, index) => {
    const radians = (index / 48) * Math.PI * 2;
    const x = (500 + 470 * Math.cos(radians)).toFixed(1);
    const y = (500 + 470 * Math.sin(radians)).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="17" fill="${teal}"/>`;
  }).join("");
  const star = (x, y, size) => {
    const points = Array.from({ length: 10 }, (unused, index) => {
      const radius = index % 2 === 0 ? size : size * 0.42;
      const radians = (Math.PI / 5) * index - Math.PI / 2;
      return `${(x + radius * Math.cos(radians)).toFixed(1)},${(y + radius * Math.sin(radians)).toFixed(1)}`;
    }).join(" ");
    return `<polygon points="${points}" fill="${paper}"/>`;
  };
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1000" viewBox="0 0 1000 1000">`
    + `<rect width="1000" height="1000" fill="${paper}"/>`
    + scallops
    + `<circle cx="500" cy="500" r="470" fill="${teal}"/>`
    + `<circle cx="500" cy="500" r="432" fill="none" stroke="${paper}" stroke-width="9"/>`
    + `<circle cx="500" cy="500" r="404" fill="none" stroke="${paper}" stroke-width="4" stroke-dasharray="14 12"/>`
    + ringCaption("DesignProAI", 500, 392, 72, paper, "top", 76)
    + ringCaption("QUALITY APPROVAL CHECK", 500, 392, 47, paper, "bottom", 150)
    + star(500, 336, 34) + star(500, 754, 30)
    + `<rect x="196" y="392" width="608" height="176" fill="none" stroke="${paper}" stroke-width="7"/>`
    + `<text x="500" y="472" text-anchor="middle" font-family="Arial" font-size="66" font-weight="700" fill="${paper}">DesignProAI</text>`
    + `<text x="500" y="528" text-anchor="middle" font-family="Arial" font-size="36" font-weight="700" fill="${paper}">Quality Approval Check</text>`
    + `<text x="500" y="624" text-anchor="middle" font-family="Arial" font-size="44" font-weight="700" fill="${paper}">${escape(designId)}</text>`
    + `<text x="500" y="668" text-anchor="middle" font-family="Arial" font-size="32" font-weight="700" fill="${paper}">Order #${escape(orderNumber)}</text>`
    + `<text x="500" y="706" text-anchor="middle" font-family="Arial" font-size="25" fill="${paper}">Approved by ${escape(verifiedBy).slice(0, 90)} · ${escape(date)}</text>`
    + `</svg>`);
}

async function storageStream(sb, storagePath) {
  const path = safePath(storagePath, "storagePath");
  const builder = sb.storage.from(BUCKET).download(path);
  const { data, error } = await (typeof builder?.asStream === "function" ? builder.asStream() : builder);
  if (error || !data) throw new StageError("artifact_download_failed", `Unable to stream ${path}: ${error?.message || "empty object"}`);
  if (Buffer.isBuffer(data) || data instanceof Uint8Array) return [data];
  if (typeof data[Symbol.asyncIterator] === "function") return data;
  if (typeof data.stream === "function") return data.stream();
  throw new StageError("artifact_stream_invalid", `${path} did not return a readable byte stream`);
}

async function* verifiedArtifactChunks(sb, row) {
  const hash = createHash("sha256");
  let byteSize = 0;
  const source = await storageStream(sb, row.storage_path);
  for await (const value of source) {
    assertStageLeaseActive();
    if (!(Buffer.isBuffer(value) || value instanceof Uint8Array)) throw new StageError("artifact_stream_chunk_invalid", row.storage_path, false);
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    byteSize += chunk.length;
    hash.update(chunk);
    yield chunk;
  }
  if (byteSize !== Number(row.byte_size) || hash.digest("hex") !== String(row.content_hash).toLowerCase()) {
    throw new StageError("zip_source_changed", row.storage_path, false);
  }
}

function zipArtifactEntries(sb, rows) {
  const names = new Set();
  const entries = [];
  const ordered = [...rows].sort((left, right) => {
    const leftKey = `${left.artifact_kind}/${left.surface_key}/${left.storage_path}`;
    const rightKey = `${right.artifact_kind}/${right.surface_key}/${right.storage_path}`;
    return leftKey.localeCompare(rightKey);
  });
  for (const row of ordered) {
    if (!HASH_RE.test(String(row.content_hash || "")) || !Number.isSafeInteger(Number(row.byte_size)) || Number(row.byte_size) < 1) throw new StageError("zip_source_identity_invalid", row.storage_path, false);
    const leaf = String(row.storage_path).split("/").pop() || "file";
    const safeSurface = String(row.surface_key || "artifact").replace(/[^A-Za-z0-9_-]+/g, "-");
    const name = `${row.artifact_kind}/${safeSurface}-${row.content_hash.slice(0, 12)}-${leaf}`;
    if (names.has(name)) throw new StageError("zip_entry_collision", name, false);
    names.add(name);
    entries.push({ name, byteSize: Number(row.byte_size), open: () => verifiedArtifactChunks(sb, row) });
  }
  return entries;
}

function bufferZipEntry(name, bytes) {
  const body = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  return {
    name,
    byteSize: body.length,
    open: async function* open() { yield body; },
  };
}

function sourceViewZipEntries(sb, viewReceipts) {
  if (!Array.isArray(viewReceipts) || viewReceipts.length !== VIEW_KEYS.length) {
    throw new StageError("zip_source_views_incomplete", "ZIP requires all seven immutable source views", false);
  }
  let requiredViewKeys;
  try { requiredViewKeys = sourceViewKeys(viewReceipts); }
  catch (error) { throw new StageError("zip_source_views_incomplete", error.message, false); }
  const seen = new Set();
  return [...viewReceipts].sort((left, right) => String(left.viewKey).localeCompare(String(right.viewKey))).map((item) => {
    const viewKey = requiredString(item.viewKey, "source view key");
    if (!requiredViewKeys.includes(viewKey) || seen.has(viewKey)) throw new StageError("zip_source_view_identity_invalid", viewKey, false);
    seen.add(viewKey);
    const storagePath = safePath(item.storagePath, `${viewKey} source storagePath`);
    const contentHash = requiredString(item.contentHash, `${viewKey} source hash`).toLowerCase();
    const byteSize = Number(item.byteSize);
    if (!HASH_RE.test(contentHash) || !Number.isSafeInteger(byteSize) || byteSize < 1) throw new StageError("zip_source_view_identity_invalid", viewKey, false);
    const extension = String(storagePath).split(".").pop().toLowerCase();
    if (!/^(png|jpe?g|webp)$/.test(extension)) throw new StageError("zip_source_view_extension_invalid", viewKey, false);
    const row = { storage_path: storagePath, content_hash: contentHash, byte_size: byteSize };
    return { name: `source-views/${viewKey}-${contentHash.slice(0, 12)}.${extension}`, byteSize, open: () => verifiedArtifactChunks(sb, row) };
  });
}

async function copyVerifiedZip(sb, sourcePath, targetPath, contentHash, byteSize) {
  assertStageLeaseActive();
  const client = sb.storage.from(BUCKET);
  const { error } = await client.copy(safePath(sourcePath, "source ZIP"), safePath(targetPath, "delivered ZIP"));
  if (error && !/already exists|duplicate|conflict|resourcealreadyexists/i.test(`${error.code || ""} ${error.message || ""}`)) {
    throw new StageError("delivery_zip_copy_failed", error.message);
  }
  try {
    const observed = await verifyStoredZip({ supabase: sb, storagePath: targetPath, contentHash, byteSize, signal: stageLeaseContext.getStore()?.controller?.signal });
    if (!observed) throw new StageError("delivery_zip_copy_missing", "Server-side ZIP copy is not readable");
    return observed;
  } catch (errorValue) {
    if (errorValue instanceof StageError) throw errorValue;
    throw new StageError(errorValue.code || "delivery_zip_copy_invalid", errorValue.message, errorValue.retryable !== false);
  }
}

async function copyPinnedSourceArtifact(sb, run, row, kind, relativePath, contentType, metadata = {}) {
  const target = `designpro/${tenantKey(run.tenant_key)}/${run.id}/source/${relativePath}`;
  const client = sb.storage.from(BUCKET);
  const { error } = await client.copy(safePath(row.storage_path, "source artifact"), safePath(target, "copied artifact"));
  if (error && !/already exists|duplicate|conflict|resourcealreadyexists/i.test(`${error.code || ""} ${error.message || ""}`)) throw new StageError("production_source_copy_failed", error.message);
  const observed = await verifyStoredArtifact({ supabase: sb, storagePath: target, contentHash: String(row.content_hash).toLowerCase(), byteSize: Number(row.byte_size), signal: stageLeaseContext.getStore()?.controller?.signal });
  if (!observed) throw new StageError("production_source_copy_missing", target, true);
  return artifact(kind, observed.storagePath, observed.contentHash, observed.byteSize, String(row.surface_key || ""), {
    ...row.metadata, ...metadata, sourceEnticeRunId: run.results?.sourceEnticeRunId || run.input?.sourceEnticeRunId,
    sourceStoragePath: row.storage_path, sourceContentHash: row.content_hash,
  });
}

async function executeProduction(sb, stage, run, runtimeConfig) {
  const input = requiredObject(run.input, "workflow input");
  const sourceRunId = requiredString(run.results?.sourceEnticeRunId || input.sourceEnticeRunId, "sourceEnticeRunId");
  // GENIE deploys here, on order -- never in the free run. It resolves the true
  // production dimensions every paid stage below is cut and verified against,
  // and it is what the customer's progress page reports.
  if (stage.stage_key === "manifest.resolve") {
    const resolved = await resolveGenieManifest(sb, run, stage);
    const spec = resolved.manifest;
    const manifestId = resolved.dimensionManifestId;
    const basisHash = resolved.dimensionBasisHash;
    const { data, error } = await sb.rpc("bind_designpro_dimension_manifest", {
      p_run_id: run.id, p_stage_id: stage.id, p_lease_token: stage.lease_token,
      p_dimension_manifest_id: manifestId, p_manifest: spec, p_manifest_hash: null,
      p_dimension_basis_hash: basisHash,
    });
    if (error) throw new StageError("manifest_bind_failed", error.message, false);
    const rebound = await getRun(sb, run.id);
    return complete(sb, stage, rebound, { verified: true, ...data, dimensionBasisHash: basisHash });
  }
  if (stage.stage_key === "source.verify") {
    // WHAT "PRODUCTION SOURCE COMPLETE" MEANS UNDER A.T.L.A.S.
    //
    // This gate used to demand the 2D Production Proof, the six Call 9 cuts and
    // the Call 10 inventory, and refuse without all three. That was right when
    // the proof WAS the source -- Call 9 cropped its regions, so a run without
    // one had nothing to cut from.
    //
    // A.T.L.A.S. inverted that. The accepted master is the manufacturing
    // authority; Call 1 cuts the six panels straight from it at GENIE
    // dimensions with the five-inch bleed, each stamped with the master hash it
    // came from. The 2D proof is drawn afterwards, from that same lineage, as
    // documentation. Requiring documentation to verify the thing it documents
    // is backwards, and in production it was fatal: this stage failed
    // `production_source_set_incomplete` on the only run that ever reached it,
    // and nothing past it has ever executed.
    //
    // So for an A.T.L.A.S. run the requirement is the actual authority --
    // an accepted master, six panels, correct surface keys, every one bound to
    // that master's hash, GENIE trim and print inches, exactly five inches of
    // bleed on all four edges, and bytes that still hash to what was recorded.
    // The proof is carried when it exists and its absence is stated, never
    // fatal.
    const call9 = await receipt(sb, sourceRunId, "call9.surface-panels");
    const call10 = await receipt(sb, sourceRunId, "call10.logo-inventory");
    const sourceProofs = await artifacts(sb, sourceRunId, ["flat-proof"]);
    const sourcePanels = await artifacts(sb, sourceRunId, ["panel"]);
    const sourceLogos = await artifacts(sb, sourceRunId, ["logo"]);
    const customerProof = sourceProofs.find((item) => String(item.surface_key || "") === "") || null;
    const atlasRun = String(call9.receipt?.promotedFrom || "") === "atlas-call1";

    if (sourcePanels.length !== SURFACE_KEYS.length
      || new Set(sourcePanels.map((item) => item.surface_key)).size !== SURFACE_KEYS.length) {
      throw new StageError("production_source_set_incomplete", "The exact six own-surface production panels are required", false);
    }

    // ⛔ THE ANCESTRY GATE. NOTHING DESCENDED FROM A 3D PROOF PASSES HERE.
    //    (Trish 2026-08-29.)
    //
    // Every other assertion in this stage was already passing on the Northgate
    // run whose six "production panels" were flattened photographs: they were
    // six, distinct, correctly keyed, correctly dimensioned by GENIE, correctly
    // hashed. Dimensions around an image do not make the image artwork, so none
    // of those checks could see it. This one asks the only question that
    // separates a print file from a picture of a truck -- what is it descended
    // from -- and it asks it at the boundary into the PAID half, before a single
    // byte is upscaled, packed or delivered.
    //
    // It runs for every run, A.T.L.A.S. or not. A non-A.T.L.A.S. run has no
    // accepted master and therefore no legal production artwork, which is
    // exactly what `panels.build` now says by refusing to create any.
    try {
      assertRunProductionAncestry({
        panels: sourcePanels.map((row) => ({ surfaceKey: row.surface_key, metadata: row.metadata })),
        proof: customerProof ? { metadata: customerProof.metadata } : null,
        acceptedPanels: await callOnePanelSet(sb, run).catch(() => null),
      });
    } catch (error) {
      throw new StageError(
        String(error?.code || "production_ancestry_invalid"),
        String(error?.message || error),
        false,
      );
    }
    for (const surface of SURFACE_KEYS) {
      const row = sourcePanels.find((item) => item.surface_key === surface);
      if (!row || row.content_hash !== call9.receipt?.panelHashes?.[surface]) throw new StageError("production_call9_receipt_mismatch", `Call 9 ${surface} receipt differs`, false);
    }

    if (atlasRun) {
      // Every panel has to name the SAME master, and it has to be the master
      // this revision accepted. Six panels from two masters would be six
      // panels of two different designs.
      const masters = new Set(sourcePanels.map((row) => String(row.metadata?.sourceMasterHash || "").toLowerCase()));
      if (masters.size !== 1 || !HASH_RE.test([...masters][0])) {
        throw new StageError("production_atlas_master_binding_invalid", "The six panels are not all bound to one A.T.L.A.S. master", false);
      }
      const boundMaster = [...masters][0];
      // WHICH MASTER THIS REVISION ACCEPTED, READ ACROSS THE SEAM.
      //
      // Not from the generation-side revision table: manufacturing never reaches
      // across into the generation tables, and the seam freeze is what keeps the
      // two halves independently changeable. The immutable revision snapshot is the
      // interface, and it already carries every Call 1 panel with the master it
      // was cut from -- so comparing the artifacts against the snapshot is both
      // the sanctioned read and the stronger check: it proves the stored panels
      // still agree with what the customer was shown, not merely with a row.
      const snapshotPanels = await callOnePanelSet(sb, run);
      const acceptedMasters = new Set((snapshotPanels || [])
        .map((panel) => String(panel?.sourceMasterHash || "").toLowerCase())
        .filter((hash) => HASH_RE.test(hash)));
      if (acceptedMasters.size === 1 && ![...acceptedMasters][0].startsWith(boundMaster.slice(0, 64))) {
        throw new StageError("production_atlas_master_mismatch", "The panels were cut from a different master than this revision accepted", false);
      }
      for (const row of sourcePanels) {
        const meta = row.metadata || {};
        const trimW = Number(meta.trimWidthIn ?? meta.trimWidthInches);
        const trimH = Number(meta.trimHeightIn ?? meta.trimHeightInches);
        const printW = Number(meta.printWidthIn ?? meta.printWidthInches);
        const printH = Number(meta.printHeightIn ?? meta.printHeightInches);
        if (!(trimW > 0 && trimH > 0 && printW > 0 && printH > 0)) {
          throw new StageError("production_atlas_dimensions_missing", `${row.surface_key} carries no GENIE trim and print dimensions`, false);
        }
        // Five inches on every edge, stated two ways in the artifact record.
        const bleed = meta.bleed && typeof meta.bleed === "object" ? meta.bleed : null;
        const bleedInches = Number(meta.bleedInches);
        const edgesFive = bleed
          ? ["top", "right", "bottom", "left"].every((edge) => Number(bleed[edge]) === 5)
          : bleedInches === 5;
        if (!edgesFive) throw new StageError("production_atlas_bleed_invalid", `${row.surface_key} does not carry exactly 5 inches of bleed on all four edges`, false);
        if (Math.abs((printW - trimW) - 10) > 0.51 || Math.abs((printH - trimH) - 10) > 0.51) {
          throw new StageError("production_atlas_bleed_geometry_invalid", `${row.surface_key} print size is not its trim plus 5 inches per edge`, false);
        }
      }
      // The bytes still are what the record says they are.
      for (const row of sourcePanels) {
        const bytes = await storageBytes(sb, row.storage_path);
        if (hashBytes(bytes) !== row.content_hash) {
          throw new StageError("production_atlas_panel_changed", `${row.surface_key} panel bytes changed since Call 9`, false);
        }
      }
    } else if (!customerProof || sourceProofs.length !== 1) {
      // A non-A.T.L.A.S. run still cuts from the proof, so it is still required.
      throw new StageError("production_source_set_incomplete", "The dimensioned 2D proof and exact six own-surface Call 9 gridslices are required", false);
    }

    const call8 = customerProof ? await receipt(sb, sourceRunId, "call8.flat-proof").catch(() => null) : null;
    if (customerProof && call8?.receipt?.sourceProofHash && customerProof.content_hash !== call8.receipt.sourceProofHash) {
      throw new StageError("production_call8_receipt_mismatch", "Call 8 receipt and 2D production proof differ", false);
    }
    const receiptPlacements = Array.isArray(call10.receipt?.inventory) ? [...call10.receipt.inventory].sort((a, b) => String(a.placementKey).localeCompare(String(b.placementKey))) : [];
    const observedPlacements = sourceLogos.map((row) => ({ placementKey: row.metadata?.placementKey, identityKey: row.metadata?.identityKey, targetSurfaceKey: row.metadata?.targetSurfaceKey, contentHash: row.content_hash })).sort((a, b) => String(a.placementKey).localeCompare(String(b.placementKey)));
    if (JSON.stringify(receiptPlacements) !== JSON.stringify(observedPlacements)) throw new StageError("production_logo_evidence_mismatch", "Call 10 logo placement receipt and immutable logo bytes differ", false);

    const produced = [];
    // Carried when it exists. Its absence on an A.T.L.A.S. run is stated in the
    // receipt below rather than pretended away, and it is not a reason to hold
    // the panels back -- they are the thing that prints.
    if (customerProof) {
      produced.push(await copyPinnedSourceArtifact(sb, run, customerProof, "flat-proof", "call8-2d-production-proof.png", "image/png", { sourceReceiptHash: call8?.receipt_hash || null }));
    }
    for (const row of [...sourcePanels].sort((a, b) => a.surface_key.localeCompare(b.surface_key))) {
      produced.push(await copyPinnedSourceArtifact(sb, run, row, "panel", `panels/${row.surface_key}.png`, "image/png", { sourceReceiptHash: call9.receipt_hash }));
    }
    for (const row of [...sourceLogos].sort((a, b) => String(a.surface_key).localeCompare(String(b.surface_key)))) {
      const extension = String(row.storage_path).split(".").pop().toLowerCase();
      const contentType = row.metadata?.contentType || ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf" })[extension];
      const slug = String(row.surface_key).replace(/[^A-Za-z0-9_-]+/g, "-");
      produced.push(await copyPinnedSourceArtifact(sb, run, row, "logo", `logos/${slug}.${extension}`, contentType, { sourceReceiptHash: call10.receipt_hash }));
    }
    return complete(sb, stage, run, {
      verified: true,
      productionAuthority: atlasRun ? "atlas-master" : "call8-2d-proof",
      call8: customerProof
        ? { receiptKind: "call8.flat-proof", receiptHash: call8?.receipt_hash || null }
        : { present: false, note: "The 2D Production Proof is a later value-add artifact and does not gate production source verification on an A.T.L.A.S. run." },
      call9: { receiptKind: "call9.surface-panels", receiptHash: call9.receipt_hash },
      call10: { receiptKind: "call10.logo-inventory", receiptHash: call10.receipt_hash },
      sourceArtifactCount: produced.length, logoPlacements: receiptPlacements,
    }, null, produced);
  }
  if (stage.stage_key === "await_purchase") {
    // THE PURCHASE GATE. Nothing here spends anything; it reads what was paid
    // for and either parks or authorizes.
    const sourceRunId = requiredString(run.results?.sourceEnticeRunId || input.sourceEnticeRunId, "sourceEnticeRunId");
    const { data: paid, error } = await sb.rpc("designpro_paid_products", { p_entice_run_id: sourceRunId });
    if (error) throw new StageError("purchase_entitlement_read_failed", error.message, true);
    const products = Array.isArray(paid) ? paid.map(String) : [];
    if (!products.length) {
      // Park. The reconciler releases this the moment an entitlement lands, so
      // a paid run never waits on a button this product does not have.
      const { error: waitError } = await sb.rpc("request_designpro_purchase_gate", {
        p_run_id: run.id, p_details: { requestedAt: new Date().toISOString(), awaiting: PURCHASABLE_PRODUCTS },
      });
      if (waitError) throw new StageError("purchase_gate_request_failed", waitError.message, false);
      return;
    }
    if (!input.fulfillment || typeof input.fulfillment !== "object" || Array.isArray(input.fulfillment)) {
      const { error: waitError } = await sb.rpc("request_designpro_purchase_gate", {
        p_run_id: run.id,
        p_details: { requestedAt: new Date().toISOString(), awaiting: ["fulfillment_binding"] },
      });
      if (waitError) throw new StageError("fulfillment_gate_request_failed", waitError.message, false);
      return;
    }
    // AUTHORIZED ASSETS, FROZEN HERE. Every stage after this consumes this
    // manifest instead of whatever happens to be in storage, so an unpaid
    // product's preview assets can never be upscaled, packaged or delivered.
    const manifest = authorizedAssetManifest(products);
    return complete(sb, stage, run, {
      verified: true, receiptKind: "purchase.authorized",
      paidProducts: products, authorizedAssetManifest: manifest,
    });
  }
  if (stage.stage_key === "await_panelpro_preflight_qc" || stage.stage_key === "await_final_human_qc") {
    // QC RECEIVES EXACTLY WHAT WAS PURCHASED.
    //
    // A $29 Logo Pack contains no production panels, so a gate that assumes six
    // of them would deadlock a purchase that is complete. The gate is one gate;
    // its SCOPE is what changes. Handing a reviewer a class the customer never
    // bought is asking them to approve something that does not exist.
    const authorized = await readAuthorizedAssets(sb, run.id);
    const { error } = await sb.rpc("request_designpro_human_gate", {
      p_run_id: run.id, p_stage_key: stage.stage_key,
      p_details: {
        requestedBy: "designpro-standalone-claimant", requestedAt: new Date().toISOString(),
        qcScope: authorized.qcScope, products: authorized.products,
        productionPackAuthorized: authorized.productionPackAuthorized,
        logoPackAuthorized: authorized.logoPackAuthorized,
      },
    });
    if (error) throw new StageError("human_gate_request_failed", error.message, false);
    return;
  }
  if (stage.stage_key === "enhance.upscale") {
    // Call 12. Every approved panel is enhanced to full print geometry before a
    // single production file is rendered, so the PNG/TIFF/EPS are built FROM
    // the enhanced master rather than from an interpolated stretch.
    const readiness = topazReadiness(process.env);
    if (!readiness.configurationValid) throw new StageError("topaz_configuration_invalid", readiness.detail, false);
    if (!readiness.enabled) throw new StageError("topaz_disabled", "Call 12 is disabled; a production pack cannot be built without the approved enhancement", false);
    // WHAT THIS RUN MAY ENHANCE. Read from the frozen gate receipt rather than
    // from storage: a preview asset exists for everything, so "it is there" has
    // never been the same question as "it was paid for".
    const authorized = await readAuthorizedAssets(sb, run.id);
    const mayUpscale = new Set(authorized.upscale || []);
    if (!mayUpscale.size) {
      throw new StageError("enhance_nothing_authorized", "No purchased asset class authorizes enhancement on this run", false);
    }
    // The Logo Pack alone buys the separated assets, not the panel set. Skipping
    // the panels here is the entitlement working, not a missing input.
    if (!mayUpscale.has("panel")) {
      return complete(sb, stage, run, {
        verified: true, receiptKind: "call12.topaz-upscale", call: 12,
        authorizedAssetManifest: authorized, enhancedSurfaces: [],
        skippedUnpurchased: ["panel"],
      });
    }
    const brandedPanels = await artifacts(sb, run.id, ["panel"]);
    if (brandedPanels.length !== SURFACE_KEYS.length || new Set(brandedPanels.map((item) => item.surface_key)).size !== SURFACE_KEYS.length) {
      throw new StageError("enhance_source_panels_missing", "Exact six approved source panels are required", false);
    }
    // THE ACTIVE ARTIFACT PER SURFACE, WHICH IS NOT ALWAYS THE CALL 9 PANEL.
    //
    // PanelPro's QC is a physical check against the real vehicle template, and
    // when a panel does not fit, a designer corrects the file and uploads it
    // against that surface. The correction is a separate artifact bound to the
    // panel it replaces -- the branded Call 9 set is never touched, still hashes
    // the same, and is still what source.verify counts.
    //
    // But it is the corrected file that has to reach print. Enhancing the panel
    // the team rejected, while the correction sat unused in the vault, would
    // make the human QC decorative: the gate would pass and the wrong artwork
    // would ship. So the enhancement source is the newest correction for a
    // surface when one exists, and the branded panel otherwise, and the receipt
    // records which was used for every side.
    const corrections = await artifacts(sb, run.id, ["corrected-panel"]);
    const activeBySurface = new Map();
    for (const correction of corrections) {
      const key = String(correction.surface_key);
      const current = activeBySurface.get(key);
      if (!current || String(correction.created_at || "") > String(current.created_at || "")) {
        activeBySurface.set(key, correction);
      }
    }
    const panels = brandedPanels.map((branded) => {
      const correction = activeBySurface.get(String(branded.surface_key));
      return correction ? { ...correction, brandedPanel: branded } : { ...branded, brandedPanel: branded };
    });
    const correctedSurfaces = [...activeBySurface.keys()].filter(
      (key) => SURFACE_KEYS.includes(key),
    ).sort();
    const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
    const dimensions = new Map((dimensionManifest.expectedSurfaces || []).map((item) => [String(item.surfaceKey), item]));
    const produced = [];
    const spools = [];
    const enhancedHashes = {};
    const plans = {};
    const enhanced = await withHeavyOutputLease(sb, stage, async () => {
      const results = [];
      for (const panel of [...panels].sort((a, b) => String(a.surface_key).localeCompare(String(b.surface_key)))) {
        assertStageLeaseActive();
        const key = String(panel.surface_key);
        const dims = dimensions.get(key);
        if (!dims || !Object.values(dims.bleed || {}).every((value) => Number(value) === 5)) throw new StageError("enhance_dimensions_missing", `GENIE dimensions missing for ${key}`, false);
        const source = await storageBytes(sb, panel.storage_path);
        if (hashBytes(source) !== panel.content_hash) throw new StageError("enhance_source_panel_changed", key, false);
        const targetWidthPx = Math.round((Number(dims.widthInches) + 10) * 150);
        const targetHeightPx = Math.round((Number(dims.heightInches) + 10) * 150);
        // An immutable winner at a material-addressed path. Topaz is not
        // reproducible, so a retry reuses the approved bytes instead of
        // authoring a second, different enhancement.
        const storagePath = `designpro/${tenantKey(run.tenant_key)}/${run.id}/enhanced/${key}-${String(panel.content_hash).slice(0, 24)}.png`;
        const existing = await storageBytes(sb, storagePath).catch(() => null);
        if (existing && existing.length) {
          const metadata = await sharp(existing, { limitInputPixels: false }).metadata();
          if (metadata.width !== targetWidthPx || metadata.height !== targetHeightPx) throw new StageError("enhance_winner_geometry_drift", key, false);
          results.push({ key, bytes: existing, reused: true, dims, targetWidthPx, targetHeightPx, detail: null });
          continue;
        }
        // A panel that already carries the print target's pixels does not need
        // enhancing, and sending it to Topaz would resample it for nothing. The
        // comparison is against the exact GENIE target, so this can only skip a
        // panel that is already at or above print geometry -- never one that is
        // short. Conforming it to the target is a pure resize.
        //
        // At today's 4K master this rarely fires: six surfaces share one
        // 4096-pixel canvas, so a long side arrives near 20 PPI against a
        // 150-PPI target. It exists so that a surface which IS already big
        // enough is not paid for twice, and so the receipt says which is which.
        const sourceMeta = await sharp(source, { limitInputPixels: false }).metadata();
        if (Number(sourceMeta.width) >= targetWidthPx && Number(sourceMeta.height) >= targetHeightPx) {
          const conformed = await sharp(source, { limitInputPixels: false })
            .resize(targetWidthPx, targetHeightPx, { fit: "fill" })
            .flatten({ background: "#ffffff" })
            .removeAlpha()
            .toColourspace("srgb")
            .png()
            .toBuffer();
          results.push({
            key, bytes: conformed, reused: false, dims, targetWidthPx, targetHeightPx,
            detail: null,
            enhancement: "not-required",
            sourcePixels: { widthPx: Number(sourceMeta.width), heightPx: Number(sourceMeta.height) },
          });
          continue;
        }
        let outcome;
        try {
          outcome = await enhancePanel({
            readiness, surfaceKey: key, bytes: source, mimeType: "image/png",
            targetWidthPx, targetHeightPx, signal: stageLeaseContext.getStore()?.controller?.signal,
          });
        } catch (error) { throw new StageError(error.code || "topaz_enhance_failed", error.message, error.retryable === true); }
        results.push({ key, bytes: outcome.bytes, reused: false, dims, targetWidthPx, targetHeightPx, detail: outcome, storagePath, enhancement: "topaz" });
      }
      return results;
    });

    for (const item of enhanced) {
      const key = item.key;
      const storagePath = `designpro/${tenantKey(run.tenant_key)}/${run.id}/enhanced/${key}-${String(panels.find((p) => p.surface_key === key).content_hash).slice(0, 24)}.png`;
      // Material-addressed by the ACTIVE source, so a correction gets its own
      // enhanced object rather than colliding with the rejected panel's.
      const stored = await uploadProducedBytes(sb, run, stage, runtimeConfig, storagePath, item.bytes, "image/png");
      if (stored.spool) spools.push(stored.spool);
      enhancedHashes[key] = stored.hash;
      plans[key] = item.detail ? item.detail.plan : { reusedImmutableWinner: true };
      const activeSource = panels.find((p) => p.surface_key === key);
      produced.push(artifact("upscaled-panel", stored.storagePath, stored.hash, stored.bytes, key, {
        call: 12, contract: TOPAZ_CONTRACT, engine: "topaz-image-enhance", model: readiness.model,
        sourcePanelPath: activeSource.storage_path,
        sourcePanelHash: activeSource.content_hash,
        // Which artifact this side was actually enhanced from, and the branded
        // Call 9 panel it descends from either way. A corrected side must be
        // readable as corrected from the artifact alone, not only from the
        // stage receipt.
        sourceArtifactKind: activeSource.artifact_kind,
        humanCorrected: activeSource.artifact_kind === "corrected-panel",
        brandedPanelHash: activeSource.brandedPanel.content_hash,
        enhancedSha256: item.detail?.enhancedSha256 || stored.hash,
        reusedImmutableWinner: item.reused === true,
        // "topaz" | "not-required" | "reused-immutable-winner". A panel that was
        // never enhanced must never read as though it was.
        enhancement: item.reused === true ? "reused-immutable-winner" : (item.enhancement || "topaz"),
        sourcePixels: item.sourcePixels || null,
        plan: item.detail?.plan || null,
        clampedByEngineCeiling: item.detail?.plan?.clampedByEngineCeiling === true,
        widthPx: item.targetWidthPx, heightPx: item.targetHeightPx,
        trimWidthInches: item.dims.widthInches, trimHeightInches: item.dims.heightInches,
        bleed: { top: 5, right: 5, bottom: 5, left: 5 },
        surfaceSqFt: item.dims.surfaceSqFt, dpi: 1500, outputScale: 0.1,
      }));
    }
    if (new Set(Object.values(enhancedHashes)).size !== SURFACE_KEYS.length) throw new StageError("enhance_surface_reuse", "Every enhanced panel must be distinct", false);
    const completed = await complete(sb, stage, run, {
      verified: true, receiptKind: "call12.topaz-upscale", call: 12,
      contract: TOPAZ_CONTRACT, engine: "topaz-image-enhance", model: readiness.model,
      // Which sides went to print from a human-corrected file. This is the audit
      // trail the correction path exists for -- a receipt that did not say so
      // would leave "the team fixed the hood" true but unprovable.
      humanCorrectedSurfaces: correctedSurfaces,
      enhancedHashes, plans, surfaces: Object.keys(enhancedHashes).sort(),
      enhancement: Object.fromEntries(enhanced.map((item) => [
        item.key,
        item.reused === true ? "reused-immutable-winner" : (item.enhancement || "topaz"),
      ])),
      authoredWinner: true, deterministic: false,
      note: "Topaz output is not reproducible; downstream stages bind these exact hashes.",
    }, null, produced);
    for (const spool of spools) await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed Call 12 spool cleanup failed: ${error.message}`));
    return completed;
  }
  if (stage.stage_key === "output.build") {
    // PNG/TIFF/EPS are the Production Pack's deliverable. A run that bought only
    // the Logo Pack builds none of them -- and says so, rather than producing an
    // empty set that reads as a failure.
    const authorized = await readAuthorizedAssets(sb, run.id);
    if (!(authorized.output || []).length) {
      return complete(sb, stage, run, {
        verified: true, outputCount: 0, outputSetHash: null,
        authorizedAssetManifest: authorized, skippedUnpurchased: ["output"],
      });
    }
    const built = await withHeavyOutputLease(sb, stage, () => buildPrintOutputs(sb, run, input, stage, runtimeConfig));
    const completed = await complete(sb, stage, run, { verified: true, outputCount: built.produced.length, outputSetHash: hashJson(built.produced.map((item) => ({ path: item.storagePath, hash: item.contentHash }))) }, null, built.produced);
    for (const spool of built.spools) await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed output spool cleanup failed: ${error.message}`));
    return completed;
  }
  if (stage.stage_key === "output.verify") {
    // Prove the purchased output set and no other. A Production Pack still
    // fails closed without its complete eighteen; a Logo Pack is never asked
    // for panel outputs it did not buy.
    const authorized = await readAuthorizedAssets(sb, run.id);
    const rows = await artifacts(sb, run.id, ["output"]);
    if (!authorized.requiredOutputFiles) {
      if (rows.length) throw new StageError("output_unpurchased_present", "Production outputs exist on a run that did not buy them", false);
      return complete(sb, stage, run, {
        verified: true, receiptKind: "output.verified", exactSurfaceFormatCount: 0,
        authorizedAssetManifest: authorized, notApplicable: ["output"],
      }, null, []);
    }
    const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
    let verified;
    try {
      verified = await withHeavyOutputLease(sb, stage, () => verifyProductionOutputSet({
          artifacts: rows,
          dimensionManifest,
          readBytes: async (row) => storageBytes(sb, row.storage_path ?? row.storagePath),
        }));
    } catch (error) {
      throw new StageError(error.code || "output_verification_failed", error.message, false);
    }
    return complete(sb, stage, run, {
      ...verified,
      verified: true,
      receiptKind: "output.verified",
      exactSurfaceFormatCount: authorized.requiredOutputFiles,
      authorizedAssetManifest: authorized,
      structuralVerification: verified.files,
    }, null, []);
  }
  if (stage.stage_key === "stamp.build") {
    // The certificate states what was approved. Stamping "Production Pack
    // approved" on a run that only bought the $29 Logo Pack would be a claim
    // about work nobody paid for or reviewed.
    const authorized = await readAuthorizedAssets(sb, run.id);
    const finalQc = await receipt(sb, run.id, "final.human-qc");
    const verifiedBy = requiredString(finalQc.receipt?.verifiedBy, "final QC verifiedBy");
    const approvalRef = requiredString(finalQc.receipt?.approvalRef, "final QC approvalRef");
    const approvedAt = requiredString(finalQc.receipt?.approvedAt, "final QC approvedAt");
    const approvalDate = new Date(approvedAt);
    if (!Number.isFinite(approvalDate.getTime())) throw new StageError("final_qc_time_invalid", "final QC approvedAt is invalid", false);
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("generation_id,snapshot,snapshot_hash,owner_id,tenant_key").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource) throw new StageError("stamp_revision_source_missing", revisionError?.message || "Immutable revision source is missing", false);
    const { designId, orderNumber } = immutableBusinessIdentity(revisionSource, run);
    if (finalQc.receipt?.qc?.designId !== designId || finalQc.receipt?.qc?.orderNumber !== orderNumber) {
      throw new StageError("final_qc_business_identity_drift", "Final QC did not approve this immutable DesignID and Order #", false);
    }
    const svg = stampSvg(verifiedBy, designId, orderNumber, approvalDate.toISOString().slice(0, 10));
    const png = await sharp(svg).png().toBuffer();
    const sealStored = await upload(sb, `designpro/${tenantKey(run.tenant_key)}/${run.id}/qc-approval-stamp.png`, png, "image/png");
    // THE PAGE THAT SAYS WHAT WAS CHECKED. The seal proves a permitted human
    // signed; it carries no checklist and no dimensions, so the pack shipped with
    // nothing a shop could read to see which checks passed or how big each panel
    // is. The checks come from the two receipts those humans actually signed and
    // the sizes from the bound GENIE manifest -- nothing here is defaulted, so the
    // page can only ever state what the run really recorded.
    const preflightReceipt = await receipt(sb, run.id, "panelpro.preflight");
    const certificateSurfaces = SURFACE_KEYS.map((surfaceKey) => {
      const surface = (input.dimensionManifest?.expectedSurfaces || [])
        .find((item) => String(item.surfaceKey) === surfaceKey) || {};
      const width = Number(surface.widthInches);
      const height = Number(surface.heightInches);
      return {
        surfaceKey,
        label: surfaceKey.charAt(0).toUpperCase() + surfaceKey.slice(1),
        trimWidthIn: width, trimHeightIn: height,
        printWidthIn: Number.isFinite(width) ? width + 10 : null,
        printHeightIn: Number.isFinite(height) ? height + 10 : null,
        surfaceSqFt: surface.surfaceSqFt,
      };
    });
    const certificateBytes = await buildQcCertificatePng({
      designId, orderNumber,
      designName: revisionSource.snapshot?.designName || "",
      vehicle: revisionSource.snapshot?.vehicle || {},
      verifiedBy,
      approvedAtIso: approvalDate.toISOString(),
      preflightQc: preflightReceipt.receipt?.qc || {},
      finalQc: finalQc.receipt?.qc || {},
      surfaces: certificateSurfaces,
    });
    const certificateStored = await upload(sb, `designpro/${tenantKey(run.tenant_key)}/${run.id}/qc-certificate.png`, certificateBytes, "image/png");
    const proofRows = await artifacts(sb, run.id, ["flat-proof"]);
    if (proofRows.length !== 1) throw new StageError("stamp_source_proof_missing", "Exact copied Call 8 proof is required for stamping", false);
    const proofBytes = await storageBytes(sb, proofRows[0].storage_path);
    if (hashBytes(proofBytes) !== proofRows[0].content_hash) throw new StageError("stamp_source_proof_changed", "Call 8 proof changed before stamp", false);
    const proofMeta = await sharp(proofBytes).metadata();
    if (!proofMeta.width || !proofMeta.height) throw new StageError("stamp_source_proof_invalid", "Call 8 proof has no pixel geometry", false);
    const sealSize = Math.max(120, Math.min(360, Math.round(Math.min(proofMeta.width, proofMeta.height) * 0.24)));
    const sealOverlay = await sharp(png).resize(sealSize, sealSize).png().toBuffer();
    const stampedProof = await sharp(proofBytes).composite([{ input: sealOverlay, gravity: "southeast" }]).png().toBuffer();
    const stampedStored = await uploadProducedBytes(sb, run, stage, runtimeConfig, `designpro/${tenantKey(run.tenant_key)}/${run.id}/stamped-call8-proof.png`, stampedProof, "image/png");
    const seal = artifact("stamp", sealStored.storagePath, sealStored.hash, sealStored.bytes, "seal", { designId, orderNumber, verifiedBy, approvalRef, approvedAt: approvalDate.toISOString(), source: "server-svg-port-of-frozen-canvas-stamp", approvedProducts: authorized.products, approvedDeliverables: authorized.deliverables });
    const certificate = artifact("stamp", certificateStored.storagePath, certificateStored.hash, certificateStored.bytes, "certificate", { contract: CERTIFICATE_CONTRACT, designId, orderNumber, verifiedBy, approvalRef, approvedAt: approvalDate.toISOString(), preflightQc: preflightReceipt.receipt?.qc || {}, finalQc: finalQc.receipt?.qc || {}, surfaces: certificateSurfaces, approvedProducts: authorized.products });
    const stamped = artifact("stamp", stampedStored.storagePath, stampedStored.hash, stampedStored.bytes, "stamped-proof", { designId, orderNumber, verifiedBy, approvalRef, approvedAt: approvalDate.toISOString(), sourceProofHash: proofRows[0].content_hash, sealHash: sealStored.hash, composition: "deterministic-southeast-overlay.v1" });
    const completed = await complete(sb, stage, run, { verified: true, receiptKind: "stamp", designId, orderNumber, verifiedBy, approvalRef, approvedAt: approvalDate.toISOString(), stampHash: stampedStored.hash, sealHash: sealStored.hash, sourceProofHash: proofRows[0].content_hash, certificateHash: certificateStored.hash, approvedProducts: authorized.products, approvedDeliverables: authorized.deliverables }, stampedStored.hash, [seal, stamped, certificate]);
    if (stampedStored.spool) await removeCommittedSpool(stampedStored.spool).catch((error) => console.error(`[DESIGNPRO-OS] committed stamped-proof spool cleanup failed: ${error.message}`));
    return completed;
  }
  if (stage.stage_key === "zip.build") {
    const stampReceipt = await receipt(sb, run.id, "stamp");
    const designId = requiredString(stampReceipt.receipt?.designId, "stamp DesignID");
    const orderNumber = requiredString(stampReceipt.receipt?.orderNumber, "stamp Order #");
    // THE ARCHIVE CARRIES WHAT WAS BOUGHT.
    //
    // Both products can be fulfilled in one run, so the ZIP cannot simply take
    // everything that exists: a Production Pack archive containing separated
    // logos would give away the $29 product, and a Logo Pack archive containing
    // the panel output set would give away the $299 one.
    const authorized = await readAuthorizedAssets(sb, run.id);
    const zipKinds = [...new Set(authorized.zipKinds || [])];
    const rows = await artifacts(sb, run.id, zipKinds);
    const counts = Object.fromEntries(zipKinds.map((kind) => [kind, rows.filter((item) => item.artifact_kind === kind).length]));
    if (counts.stamp !== 3) throw new StageError("zip_artifacts_incomplete", "Every delivered pack carries its seal, its stamped proof and its QC certificate", false);
    if (authorized.productionPackAuthorized
      && (counts["flat-proof"] !== 1 || counts.panel !== SURFACE_KEYS.length || counts.output !== authorized.requiredOutputFiles)) {
      throw new StageError("zip_artifacts_incomplete", "The Production Pack ZIP requires the Call 8 proof, six Call 9 masters and the complete output set", false);
    }
    if (authorized.logoPackAuthorized && !counts.logo) {
      throw new StageError("zip_artifacts_incomplete", "The Logo Pack ZIP requires the separated logo assets that were purchased", false);
    }
    // The seven approved renders are the Production Pack's design proofs; a
    // Logo Pack buys separated assets, not the design's proof set.
    const sourceViews = authorized.zipIncludesSourceViews
      ? (await receipt(sb, sourceRunId, "views.seven-source")).receipt?.viewReceipts
      : [];
    const viewEntries = authorized.zipIncludesSourceViews ? sourceViewZipEntries(sb, sourceViews) : [];
    const dimensionManifest = requiredObject(input.dimensionManifest, "production dimensionManifest");
    const dimensionManifestBytes = Buffer.from(JSON.stringify(canonical(dimensionManifest)));
    const dimensionManifestHash = hashBytes(dimensionManifestBytes);
    const dimensionArchivePath = "dimension-manifest/designpro-genie-dimension-manifest.json";
    const businessIdentityBytes = Buffer.from(JSON.stringify(canonical({ contract: "designpro.business-identity.v1", designId, orderNumber })));
    const businessIdentityHash = hashBytes(businessIdentityBytes);
    const businessIdentityArchivePath = "identity/design-order.json";
    const entries = [
      ...zipArtifactEntries(sb, rows),
      ...viewEntries,
      bufferZipEntry(dimensionArchivePath, dimensionManifestBytes),
      bufferZipEntry(businessIdentityArchivePath, businessIdentityBytes),
    ];
    const archivedSourceViews = [...sourceViews].sort((left, right) => String(left.viewKey).localeCompare(String(right.viewKey))).map((item, index) => ({
      viewKey: item.viewKey,
      storagePath: item.storagePath,
      contentHash: item.contentHash,
      byteSize: item.byteSize,
      contentType: item.contentType,
      archivePath: viewEntries[index].name,
    }));
    const materialHash = hashJson({
      artifacts: rows.map((row) => ({ kind: row.artifact_kind, surfaceKey: row.surface_key, storagePath: row.storage_path, contentHash: row.content_hash, byteSize: row.byte_size })).sort((left, right) => `${left.kind}/${left.surfaceKey}/${left.storagePath}`.localeCompare(`${right.kind}/${right.surfaceKey}/${right.storagePath}`)),
      sourceViews: archivedSourceViews,
      dimensionManifest: { archivePath: dimensionArchivePath, contentHash: dimensionManifestHash, byteSize: dimensionManifestBytes.length, workflowManifestHash: run.manifest_hash },
      businessIdentity: { archivePath: businessIdentityArchivePath, contentHash: businessIdentityHash, byteSize: businessIdentityBytes.length, designId, orderNumber },
    });
    const includedKinds = { ...counts, "source-view": viewEntries.length, "dimension-manifest": 1, "design-order-identity": 1 };

    // THE ZIP SAYS WHAT IS IN IT, FILE BY FILE. (Trish 2026-08-28)
    //
    // "All ZIP assets must have a container next to ZIP so we know what's in
    // ZIP." The receipt carried `includedKinds` -- six panels, eighteen
    // outputs, three stamps -- which is a census, not a manifest: it cannot
    // tell you WHICH six, at what path inside the archive, or whether the file
    // you are holding is the one that got packed. So the archive now publishes
    // its own table of contents, one row per entry, with the archive path it
    // was written to and the sha256 of the bytes that went in.
    //
    // Read straight off `entries` and `rows` rather than re-derived, so the
    // list is the archive by construction. RULE 0.22: do not hide files behind
    // only a final ZIP -- and a reader who cannot see inside it is in exactly
    // that position even when every file is downloadable elsewhere.
    // zipArtifactEntries sorts its input by kind/surface/path; sorting the rows
    // the same way once is what lets entry[i] and row[i] be the same file.
    const orderedRows = [...rows].sort((left, right) =>
      `${left.artifact_kind}/${left.surface_key}/${left.storage_path}`
        .localeCompare(`${right.artifact_kind}/${right.surface_key}/${right.storage_path}`));
    const archiveManifest = [
      ...zipArtifactEntries(sb, rows).map((entry, index) => ({
        archivePath: entry.name,
        kind: orderedRows[index].artifact_kind,
        surfaceKey: orderedRows[index].surface_key || null,
        contentHash: orderedRows[index].content_hash,
        byteSize: Number(orderedRows[index].byte_size),
      })),
      ...archivedSourceViews.map((view) => ({
        archivePath: view.archivePath, kind: "source-view", surfaceKey: view.viewKey,
        contentHash: view.contentHash, byteSize: Number(view.byteSize) || null,
      })),
      { archivePath: dimensionArchivePath, kind: "dimension-manifest", surfaceKey: null, contentHash: dimensionManifestHash, byteSize: dimensionManifestBytes.length },
      { archivePath: businessIdentityArchivePath, kind: "design-order-identity", surfaceKey: null, contentHash: businessIdentityHash, byteSize: businessIdentityBytes.length },
    ];
    if (archiveManifest.length !== entries.length) {
      throw new StageError("zip_manifest_incomplete", `${archiveManifest.length} listed, ${entries.length} archived`, false);
    }

    const signal = stageLeaseContext.getStore()?.controller?.signal;
    let spool;
    try {
      const stored = await withHeavyOutputLease(sb, stage, async () => {
        spool = await spoolDeterministicZip64({ spoolDir: runtimeConfig.spoolDir, runId: run.id, materialHash, createStream: () => createDeterministicZip64Stream(entries), signal });
        const storagePath = `designpro/${tenantKey(run.tenant_key)}/${run.id}/production-pack.zip`;
        return uploadSpoolWithTus({ supabase: sb, supabaseUrl: runtimeConfig.supabaseUrl, serviceRoleKey: runtimeConfig.serviceRoleKey, endpoint: runtimeConfig.tusEndpoint, spoolDir: runtimeConfig.spoolDir, spool, storagePath, signal });
      });
      const zip = artifact("zip", stored.storagePath, stored.contentHash, stored.byteSize, "", { entries: entries.length, compression: "store", zipFormat: "ZIP64", deterministicDate: "1980-01-01T00:00:00.000Z", mode: "100644", materialHash, includedKinds, archiveManifest, designId, orderNumber });
      const result = await complete(sb, stage, run, {
        verified: true, receiptKind: "zip", zipHash: stored.contentHash, zipByteSize: stored.byteSize,
        materialHash, entryCount: entries.length, includedKinds, archiveManifest,
        authorizedAssetManifest: authorized, deliverables: authorized.deliverables,
        sourceViews: archivedSourceViews,
        dimensionManifest: { archivePath: dimensionArchivePath, contentHash: dimensionManifestHash, byteSize: dimensionManifestBytes.length, workflowManifestHash: run.manifest_hash },
        businessIdentity: { archivePath: businessIdentityArchivePath, contentHash: businessIdentityHash, byteSize: businessIdentityBytes.length, designId, orderNumber },
        designId, orderNumber,
      }, stored.contentHash, [zip]);
      await removeCommittedSpool(spool).catch((error) => console.error(`[DESIGNPRO-OS] committed ZIP spool cleanup failed: ${error.message}`));
      return result;
    } catch (error) {
      if (error instanceof StageError) throw error;
      throw new StageError(error.code || "zip_build_failed", error.message, error.retryable !== false);
    }
  }
  if (stage.stage_key === "wrapbox.deliver") {
    // Delivery carries only what was authorized, and says which product each
    // part belongs to. An artifact reaching the customer because it happened to
    // be in storage is the same defect as an unpaid upscale, one step later.
    const authorized = await readAuthorizedAssets(sb, run.id);
    const zipReceipt = await receipt(sb, run.id, "zip");
    const finalQc = await receipt(sb, run.id, "final.human-qc");
    const approvedAt = requiredString(finalQc.receipt?.approvedAt, "final QC approvedAt");
    const zipRows = await artifacts(sb, run.id, ["zip"]);
    const zipRow = zipRows.find((row) => row.content_hash === zipReceipt.receipt_hash);
    if (!zipRow) throw new StageError("delivery_zip_missing", "Exact verified ZIP is missing", false);
    const tenant = tenantKey(run.tenant_key);
    const target = `wrapbox/${tenant}/${run.entice_pack_id}/${run.id}/production-pack.zip`;
    const deliveredZip = await copyVerifiedZip(sb, zipRow.storage_path, target, zipRow.content_hash, Number(zipRow.byte_size));
    const { data: revisionSource, error: revisionError } = await sb.from("designpro_revision_sources").select("generation_id,snapshot,snapshot_hash,owner_id,tenant_key").eq("revision_id", run.revision_id).maybeSingle();
    if (revisionError || !revisionSource || revisionSource.snapshot_hash !== run.revision_snapshot_hash || revisionSource.owner_id !== run.owner_id || revisionSource.tenant_key !== run.tenant_key) throw new StageError("delivery_revision_source_drift", "Immutable delivery recipient source is missing or changed", false);
    let deliverySnapshot;
    try { deliverySnapshot = resolvedFulfillmentSnapshot(revisionSource, run); }
    catch (error) { throw new StageError(error.code || "delivery_recipient_snapshot_invalid", error.message, error.retryable !== false); }
    const delivery = deliverySnapshot.delivery;
    const businessIdentity = immutableBusinessIdentity(revisionSource, run);
    if (zipReceipt.receipt?.designId !== businessIdentity.designId || zipReceipt.receipt?.orderNumber !== businessIdentity.orderNumber
      || zipReceipt.receipt?.businessIdentity?.designId !== businessIdentity.designId || zipReceipt.receipt?.businessIdentity?.orderNumber !== businessIdentity.orderNumber) {
      throw new StageError("delivery_business_identity_drift", "ZIP DesignID or Order # no longer matches the immutable revision", false);
    }
    // Separated logos are the Logo Pack's deliverable. On a Production-Pack-only
    // run they exist -- Call 10 produced them for the entice preview -- and must
    // not be delivered.
    const logoRows = authorized.logoPackAuthorized ? await artifacts(sb, run.id, ["logo"]) : [];
    const logos = logoRows.map((row) => ({ placementKey: row.metadata?.placementKey, identityKey: row.metadata?.identityKey, displayName: row.metadata?.displayName, targetSurfaceKey: row.metadata?.targetSurfaceKey, storagePath: safePath(row.storage_path, "logo storagePath"), contentHash: row.content_hash, byteSize: row.byte_size, contentType: row.metadata?.contentType || null })).sort((left, right) => String(left.placementKey).localeCompare(String(right.placementKey)));
    const packRows = await artifacts(sb, run.id, [...new Set([...(authorized.delivery || []), ...(authorized.zipKinds || []), "zip"])]);
    const files = packRows.map((row) => ({ kind: row.artifact_kind, surfaceKey: row.surface_key, storagePath: safePath(row.storage_path, "pack storagePath"), contentHash: row.content_hash, byteSize: row.byte_size })).sort((left, right) => `${left.kind}/${left.surfaceKey}/${left.storagePath}`.localeCompare(`${right.kind}/${right.surfaceKey}/${right.storagePath}`));
    // The Production Pack's evidence is its seven archived design proofs. A Logo
    // Pack has no such set to prove, so requiring one would fail a delivery that
    // is complete.
    const expectedSourceViews = authorized.zipIncludesSourceViews ? 7 : 0;
    if (!Array.isArray(zipReceipt.receipt?.sourceViews) || zipReceipt.receipt.sourceViews.length !== expectedSourceViews
      || !zipReceipt.receipt?.dimensionManifest || !zipReceipt.receipt?.businessIdentity) {
      throw new StageError("delivery_source_package_evidence_missing", "WrapBox delivery requires the purchased pack's archived evidence, the GENIE dimension manifest, and business identity", false);
    }
    const manifest = { contract: MANIFEST_CONTRACT, workflowRunId: run.id, operatorId: run.owner_id, customerId: delivery.customerId, recipientIdentityHash: delivery.recipientIdentityHash, tenantKey: run.tenant_key, enticePackId: run.entice_pack_id, revisionId: run.revision_id, sourceEnticeRunId, designId: zipReceipt.receipt.designId, orderNumber: zipReceipt.receipt.orderNumber, approvedAt, deliveredAt: approvedAt, zip: { storagePath: deliveredZip.storagePath, contentHash: deliveredZip.contentHash, byteSize: deliveredZip.byteSize }, sourceViews: zipReceipt.receipt.sourceViews, dimensionManifest: zipReceipt.receipt.dimensionManifest, businessIdentity: zipReceipt.receipt.businessIdentity, logos, files, products: authorized.products, deliverables: authorized.deliverables };
    const manifestBytes = Buffer.from(JSON.stringify(canonical(manifest)));
    const stored = await upload(sb, `wrapbox/${tenant}/${run.entice_pack_id}/${run.id}/manifest.json`, manifestBytes, "application/json");
    const manifestArtifact = artifact("wrapbox-manifest", stored.storagePath, stored.hash, stored.bytes, "", { zipHash: deliveredZip.contentHash, customerId: delivery.customerId, recipientIdentityHash: delivery.recipientIdentityHash, designId: businessIdentity.designId, orderNumber: businessIdentity.orderNumber, products: authorized.products, deliverables: authorized.deliverables });
    return complete(sb, stage, run, { verified: true, receiptKind: "wrapbox.delivery", contract: MANIFEST_CONTRACT, products: authorized.products, deliverables: authorized.deliverables, zipHash: zipReceipt.receipt_hash, manifestPath: stored.storagePath, manifestHash: stored.hash, deliveredZipPath: deliveredZip.storagePath, deliveredAt: approvedAt, designId: businessIdentity.designId, orderNumber: businessIdentity.orderNumber, publicationPending: true }, stored.hash, [manifestArtifact]);
  }
  throw new StageError("unsupported_production_stage", stage.stage_key, false);
}

// Retained as a recognised historical blocker value. The active seventh slot
// is the source-locked close-up proof and is never relabelled as a hero view.
const CALLS_1_7_HANDOFF_BLOCKER = "source_close_up_has_no_verified_hero3d_role_mapping";
const CALLS_1_7_VIEW_PLAN = Object.freeze([
  Object.freeze({ sourceViewType: "side", consumerRole: "driver" }),
  Object.freeze({ sourceViewType: "passenger-side", consumerRole: "passenger" }),
  Object.freeze({ sourceViewType: "hood_detail", consumerRole: "hood" }),
  Object.freeze({ sourceViewType: "front", consumerRole: "front" }),
  Object.freeze({ sourceViewType: "rear", consumerRole: "rear" }),
  Object.freeze({ sourceViewType: "close-up", consumerRole: "closeup" }),
  Object.freeze({ sourceViewType: "roof", consumerRole: "roof" }),
]);

function acceptedCalls1To7ViewPlan(value) {
  const serialized = JSON.stringify(canonical(value));
  if (serialized === JSON.stringify(canonical(CALLS_1_7_VIEW_PLAN))) return CALLS_1_7_VIEW_PLAN;
  throw new StageError(
    "generation_contract_drift",
    "Calls 1-7 requires the active Close-Up seven-view plan",
    false,
  );
}
// Calls 1-7 produce the seven immutable source renders and nothing else. The
// 2D production proof is Call 8 and this system authors it. 'generate-2d-proof'
// was sanctioned here from the period when the historical pipeline owned the
// proof; while it stayed in this contract a legacy runner carrying that
// function could present a valid claim and consume generation attempts. It is
// retired, and the version bump makes a stale runner fail with a legible
// mismatch rather than an opaque hash difference.
const CALLS_1_7_ENGINE_CONTRACT = Object.freeze({
  contractVersion: "designpro.calls-1-7-engine.v2",
  sourceCommit: "bdb26365904e91be446894e84b01b4a24f64aac0",
  sourceBlobs: Object.freeze({
    "design-panel-ai-generate": "4df3a9741c4f0721afb00b4db823fe7022147aa6",
    "generate-color-render": "0eda353a80eb3e60b293d9a99ba3e7d69ab9f065",
    "generate-pattern-render": "8114c56cbb1934569bf659a5f6957c680b9bf868",
    "design-on-vehicle-photo": "a962133b04c335754cf3df307505ed2da652bdda",
    "edit-vehicle-photo": "3843e2b66a8583e16e514a545b7827cf77fade17",
    "studio-os": "6870eaebab4d43ef8605d812416f86621727d3e9",
    "view-angles-os": "03d6282d71faeec37d0fd304f3bc234d9a3cf0a4",
  }),
  // This is the immutable source-blob contract stored by the database. The
  // later Hero-era database changed only its view plan, not this fingerprint.
  sourceViewOrder: Object.freeze(CALLS_1_7_VIEW_PLAN.map((item) => item.sourceViewType)),
  freezePolicy: "exact-source-blob-behavior",
  retiredBlobs: Object.freeze(["generate-2d-proof"]),
  proofAuthority: "designpro-os-call8",
});
const CALLS_1_7_SERVER_CONTROL_KEYS = new Set([
  "prompt", "systemprompt", "negativeprompt", "model", "imagemodel", "seed",
  "temperature", "topk", "topp", "viewangle", "viewangles", "cameraangle",
  "cameraangles", "enginecontract", "sourcecommit", "sourceblobs",
]);
const CALLS_1_7_CONTENT_EXTENSIONS = Object.freeze({
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
});
const CALLS_1_7_VEHICLE_CLASSES = new Set([
  "car", "truck", "suv", "van", "motorcycle", "boat", "bus", "rv",
  "trailer", "aircraft", "heavy_equipment",
]);
const MAX_CALLS_1_7_VIEW_BYTES = 512 * 1024 * 1024;

function generationInputHasServerControls(value, path = []) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((child) =>
    generationInputHasServerControls(child, [...path, "[]"]));
  return Object.entries(value).some(([key, child]) => {
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    const requiredVehicleModel = normalized === "model"
      && path.length === 1 && path[0] === "vehicle";
    return CALLS_1_7_SERVER_CONTROL_KEYS.has(normalized) && !requiredVehicleModel
      || generationInputHasServerControls(child, [...path, key]);
  });
}

function assertCalls1To7Claim(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 claim is missing", false);
  }
  const exactKeys = [
    "attempt", "claimToken", "engineContract", "engineContractHash", "generationId",
    "input", "inputHash", "leaseExpiresAt", "requestId", "tenantKey", "viewPlan",
  ].sort();
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(exactKeys)) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 claim shape changed", false);
  }
  const requestId = String(value.requestId || "").toLowerCase();
  const generationIdValue = String(value.generationId || "").toLowerCase();
  const claimToken = String(value.claimToken || "").toLowerCase();
  if (!UUID_RE.test(requestId) || !UUID_RE.test(generationIdValue) || !UUID_RE.test(claimToken)
    || !HASH_RE.test(String(value.inputHash || ""))
    || !HASH_RE.test(String(value.engineContractHash || ""))
    || !Number.isInteger(Number(value.attempt)) || Number(value.attempt) < 1 || Number(value.attempt) > 12
    || !Number.isFinite(Date.parse(String(value.leaseExpiresAt || "")))) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 claim identity is invalid", false);
  }
  const tenant = tenantKey(value.tenantKey);
  const input = value.input;
  const vehicle = input?.vehicle;
  const delivery = input?.delivery;
  const orderNumber = String(input?.orderNumber || "");
  const recipientIdentityHash = String(delivery?.recipientIdentityHash || "");
  if (!input || typeof input !== "object" || Array.isArray(input)
    || input.contractVersion !== "designpro.calls-1-7-input.v1"
    || orderNumber !== orderNumber.trim()
    || !/^[A-Za-z0-9][A-Za-z0-9._/# -]{0,119}$/.test(orderNumber)
    || !delivery || typeof delivery !== "object" || Array.isArray(delivery)
    || Object.keys(delivery).sort().join(",") !== "contractVersion,orderNumber,recipientIdentityHash"
    || delivery.contractVersion !== "designpro.wrapbox-recipient.v1"
    || recipientIdentityHash !== recipientIdentityHash.toLowerCase()
    || !HASH_RE.test(recipientIdentityHash)
    || delivery.orderNumber !== orderNumber
    || !vehicle || typeof vehicle !== "object" || Array.isArray(vehicle)
    || [vehicle.year, vehicle.make, vehicle.model, vehicle.type].some((item) => !String(item || "").trim())
    || !CALLS_1_7_VEHICLE_CLASSES.has(String(vehicle.type || ""))
    || generationInputHasServerControls(input)
    || Buffer.byteLength(JSON.stringify(input), "utf8") > 262_144) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 input contract is invalid", false);
  }
  if (JSON.stringify(canonical(value.engineContract)) !== JSON.stringify(canonical(CALLS_1_7_ENGINE_CONTRACT))) {
    throw new StageError("generation_contract_drift", "Frozen Calls 1-7 source contract changed", false);
  }
  const viewPlan = acceptedCalls1To7ViewPlan(value.viewPlan);
  return Object.freeze({ ...value, viewPlan, requestId, generationId: generationIdValue, claimToken, tenantKey: tenant });
}

function normalizeCalls1To7Views(claim, rawViews) {
  const viewPlan = acceptedCalls1To7ViewPlan(claim?.viewPlan);
  if (!Array.isArray(rawViews) || rawViews.length !== viewPlan.length) {
    throw new StageError("exact_seven_generation_views_required", "Exactly seven Calls 1-7 outputs are required", false);
  }
  const bySource = new Map();
  const paths = new Set();
  const hashes = new Set();
  for (const raw of rawViews) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)
      || Object.keys(raw).sort().join(",") !== "byteSize,consumerRole,contentHash,contentType,metadata,sourceViewType,storagePath") {
      throw new StageError("generation_view_identity_invalid", "Calls 1-7 view identity shape changed", false);
    }
    const plan = viewPlan.find((item) => item.sourceViewType === raw.sourceViewType);
    const contentHash = String(raw.contentHash || "").toLowerCase();
    const contentType = String(raw.contentType || "").toLowerCase();
    const byteSize = Number(raw.byteSize);
    const extension = CALLS_1_7_CONTENT_EXTENSIONS[contentType];
    const expectedPath = `designpro/${claim.tenantKey}/${claim.generationId}/calls-1-7/`
      + `${raw.sourceViewType}/${contentHash}.${extension}`;
    let storagePath;
    try { storagePath = safeStoragePath(raw.storagePath); }
    catch (error) { throw new StageError("generation_view_identity_invalid", error.message, false); }
    if (!plan || raw.consumerRole !== plan.consumerRole || !HASH_RE.test(contentHash)
      || !Number.isSafeInteger(byteSize) || byteSize < 1 || byteSize > MAX_CALLS_1_7_VIEW_BYTES
      || !extension || storagePath !== expectedPath
      || !raw.metadata || typeof raw.metadata !== "object" || Array.isArray(raw.metadata)
      || bySource.has(raw.sourceViewType) || paths.has(storagePath) || hashes.has(contentHash)) {
      throw new StageError("generation_view_identity_invalid", "Calls 1-7 view identity is invalid", false);
    }
    const normalized = Object.freeze({
      sourceViewType: raw.sourceViewType, consumerRole: raw.consumerRole, storagePath,
      contentHash, byteSize, contentType, metadata: raw.metadata,
    });
    bySource.set(raw.sourceViewType, normalized);
    paths.add(storagePath);
    hashes.add(contentHash);
  }
  return viewPlan.map((item) => bySource.get(item.sourceViewType));
}

async function claimCalls1To7Generation(sb, workerId, leaseSeconds = CLAIM_SECONDS) {
  const id = requiredString(workerId, "Calls 1-7 workerId");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) {
    throw new StageError("generation_claim_invalid", "Calls 1-7 lease is invalid", false);
  }
  const { data, error } = await sb.rpc("claim_designpro_generation_request", {
    p_worker_id: id, p_lease_seconds: leaseSeconds,
  });
  if (error) throw new StageError("generation_claim_failed", error.message || "Generation claim failed", true);
  const claim = Array.isArray(data) ? data[0] : data;
  return claim ? assertCalls1To7Claim(claim) : null;
}

async function heartbeatCalls1To7Generation(sb, claim, leaseSeconds = CLAIM_SECONDS) {
  const normalized = assertCalls1To7Claim(claim);
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 1800) {
    throw new StageError("generation_heartbeat_invalid", "Calls 1-7 lease is invalid", false);
  }
  const { data, error } = await sb.rpc("heartbeat_designpro_generation_request", {
    p_request_id: normalized.requestId,
    p_claim_token: normalized.claimToken,
    p_lease_seconds: leaseSeconds,
  });
  if (error) throw new StageError("generation_heartbeat_failed", error.message || "Generation heartbeat failed", true);
  return data === true;
}

async function completeCalls1To7Generation(sb, rawClaim, rawViews) {
  const claim = assertCalls1To7Claim(rawClaim);
  const views = normalizeCalls1To7Views(claim, rawViews);
  for (const view of views) {
    const { data, error } = await sb.storage.from(BUCKET).download(view.storagePath);
    if (error || !data) {
      throw new StageError("generation_view_download_failed", `${view.sourceViewType}: ${error?.message || "empty object"}`, true);
    }
    const observedType = String(data.type || "").toLowerCase().split(";", 1)[0].trim();
    if (observedType !== view.contentType) {
      throw new StageError("generation_view_content_type_mismatch", `${view.sourceViewType} content type changed`, false);
    }
    try { verifySourceBytes(view, Buffer.from(await data.arrayBuffer())); }
    catch (errorValue) {
      throw new StageError("generation_view_byte_identity_mismatch", `${view.sourceViewType}: ${errorValue.message}`, false);
    }
  }
  const receipt = {
    contractVersion: "designpro.calls-1-7-receipt.v1",
    sourceCommit: CALLS_1_7_ENGINE_CONTRACT.sourceCommit,
    frozenContractHash: claim.engineContractHash,
    inputHash: claim.inputHash,
    byteVerified: true,
    callsCompleted: 7,
  };
  const { data, error } = await sb.rpc("complete_designpro_generation_request", {
    p_request_id: claim.requestId,
    p_claim_token: claim.claimToken,
    p_views: views,
    p_engine_receipt: receipt,
  });
  if (error) throw new StageError("generation_completion_failed", error.message || "Generation completion failed", true);
  // handoffReady is now evidence, not a constant: true once the seven persisted
  // views cover exactly the planned roles with distinct bytes. A blocker may
  // still arrive, but a ready handoff must never carry one.
  if (!data || data.state !== "outputs_ready" || typeof data.handoffReady !== "boolean"
    || (data.handoffReady === true && data.handoffBlocker)) {
    throw new StageError("generation_completion_response_invalid", "Calls 1-7 completion response changed", false);
  }
  return data;
}

async function failCalls1To7Generation(sb, rawClaim, errorValue) {
  const claim = assertCalls1To7Claim(rawClaim);
  const code = String(errorValue?.code || "generation_failed").slice(0, 160);
  const message = String(errorValue?.message || errorValue || "Generation failed").slice(0, 1000);
  const retryable = errorValue?.retryable !== false;
  const { data, error } = await sb.rpc("fail_designpro_generation_request", {
    p_request_id: claim.requestId, p_claim_token: claim.claimToken,
    p_error_code: code, p_error_message: message, p_retryable: retryable,
  });
  if (error) throw new StageError("generation_failure_record_failed", error.message || "Generation failure was not recorded", true);
  return data === true;
}

function registerDesignProStandaloneClaimant({ app, supabase, supabaseUrl, serviceRoleKey, workerSecret, workerId, port, spoolDir, tusEndpoint }) {
  const id = requiredString(workerId, "workerId");
  const baseUrl = `http://127.0.0.1:${Number(port || 3001)}`;
  // INDEPENDENT NODES EXECUTE CONCURRENTLY. (Owner, 2026-08-27.)
  //
  // `busy` was a single boolean, so a worker ran exactly ONE stage at a time --
  // and with the global predecessor chain gone (20260827110000), that guard
  // becomes the next thing implementing a linear state machine over a
  // dependency graph. Two runnable siblings on one worker would still have run
  // one after the other.
  //
  // The cap is deliberate and small. Every guard the chain removal preserves is
  // still doing its job underneath this: the shared `production-heavy` lease
  // keeps output.build / output.verify / zip.build mutually exclusive across
  // the whole fleet however many slots exist here, the human gates are
  // unclaimable, and `SKIP LOCKED` means two workers never contend for one row.
  // What this bounds is memory: the container is capped at 6g and a stage can
  // hold a 4K master, so slots are cheap to add and expensive to get wrong.
  const stageConcurrency = Math.min(4, Math.max(1,
    Number.parseInt(process.env.DESIGNPRO_STAGE_CONCURRENCY || "2", 10) || 2));
  const inFlight = new Set();
  let timer = null;
  let lastReconcileAt = 0;
  let reconciling = false;
  let stopped = false;

  // The reconcile is a whole-fleet sweep, not a node. It stays single-flight:
  // running two of them concurrently would have them race to enqueue the same
  // production workflow.
  async function reconcileIfDue() {
    if (reconciling || Date.now() - lastReconcileAt < 15_000) return;
    reconciling = true;
    lastReconcileAt = Date.now();
    try {
      try { await reconcileAutomaticProduction(supabase); }
      catch (error) { console.error(`[DESIGNPRO-OS] automatic production reconciliation failed: ${error.message}`); }
      // The worker's half of the purchase: an entitlement recorded while this
      // process was down, or delivered twice, is noticed here rather than
      // needing to be caught as it happens.
      try { await reconcilePurchaseGates(supabase); }
      catch (error) { console.error(`[DESIGNPRO-OS] purchase gate reconciliation failed: ${error.message}`); }
    } finally {
      reconciling = false;
    }
  }

  async function tick() {
    if (stopped || inFlight.size >= stageConcurrency) return;
    let stage = null;
    let heartbeat = null;
    let stageGuard = null;
    try {
      await reconcileIfDue();
      const { data, error } = await supabase.rpc("claim_designpro_stage", { p_worker: id, p_lease_seconds: CLAIM_SECONDS });
      if (error) throw error;
      stage = Array.isArray(data) ? data[0] : data;
      if (!stage) return;
      const run = await getRun(supabase, stage.run_id);
      stageGuard = { lost: false, controller: new AbortController(), stageId: stage.id, leaseToken: stage.lease_token };
      inFlight.add(stageGuard);
      heartbeat = setInterval(async () => {
        const { data: current, error: beatError } = await supabase.rpc("heartbeat_designpro_stage", { p_stage_id: stage.id, p_lease_token: stage.lease_token, p_lease_seconds: CLAIM_SECONDS });
        if (beatError || current !== true) {
          stageGuard.lost = true;
          stageGuard.controller.abort(new Error(beatError?.message || "stage lease expired"));
          console.error(`[DESIGNPRO-OS] heartbeat lost ${stage.id}; aborting current work: ${beatError?.message || "lease expired"}`);
        }
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      await stageLeaseContext.run(stageGuard, async () => {
        if (run.workflow_type === "designpro.entice_pack") await executeEntice(supabase, baseUrl, workerSecret, supabaseUrl, stage, run, { supabaseUrl, serviceRoleKey, spoolDir, tusEndpoint });
        else if (run.workflow_type === "designpro.production_pack") await executeProduction(supabase, stage, run, { supabaseUrl, serviceRoleKey, spoolDir, tusEndpoint });
        else throw new StageError("unsupported_workflow", run.workflow_type, false);
        assertStageLeaseActive();
      });
    } catch (error) {
      console.error(`[DESIGNPRO-OS] ${stage?.stage_key || "claim"} failed: ${error.message}`);
      if (stage?.id && stage?.lease_token && error.stageHandled !== true) {
        await supabase.rpc("fail_designpro_stage", { p_stage_id: stage.id, p_lease_token: stage.lease_token, p_error_code: error.code || "stage_execution_failed", p_error_message: String(error.message || error).slice(0, 2000), p_retryable: error.retryable !== false });
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (stageGuard && !stageGuard.controller.signal.aborted) stageGuard.controller.abort(new Error("stage work ended"));
      if (stageGuard) inFlight.delete(stageGuard);
    }
  }

  app.get("/designpro-os/claimant", (_req, res) => res.json({
    ready: true, contract: CLAIMANT_CONTRACT, workerId: id, stages: STAGES,
    // Observable, so "why did only one node run" is a query rather than a guess.
    stageConcurrency, inFlight: inFlight.size,
  }));
  timer = setInterval(() => void tick(), 1_000);
  timer.unref?.();
  void tick();
  return {
    tick,
    stop: () => {
      stopped = true;
      clearInterval(timer);
      // Every in-flight node, not just the newest one. A single `activeStageGuard`
      // slot silently abandoned the others the moment concurrency existed.
      for (const guard of inFlight) {
        if (!guard.controller.signal.aborted) guard.controller.abort(new Error("claimant stopped because runtime readiness was lost"));
      }
    },
  };
}

module.exports = { registerDesignProStandaloneClaimant, CLAIMANT_CONTRACT, STAGES, RECEIPTS, ARTIFACT_KINDS, CALLS_1_7_ADAPTER: Object.freeze({ engineContract: CALLS_1_7_ENGINE_CONTRACT, viewPlan: CALLS_1_7_VIEW_PLAN, closeupViewPlan: CALLS_1_7_VIEW_PLAN, handoffBlocker: CALLS_1_7_HANDOFF_BLOCKER, claim: claimCalls1To7Generation, heartbeat: heartbeatCalls1To7Generation, complete: completeCalls1To7Generation, fail: failCalls1To7Generation }), _test: { tenantKey, runScopedStoragePath, exactSevenViews, revisionViewSet, fingerprintRevisionViews, call8ProofRequest, call8TextLock, designTimeManifest, ensureAutomaticProduction, reconcileAutomaticProduction, reconcilePurchaseGates, authorizedAssetManifest, PURCHASABLE_PRODUCTS, sourceViewZipEntries, bufferZipEntry, copyPinnedSourceArtifact, canonicalDesignId, resolvedFulfillmentSnapshot, immutableBusinessIdentity, stampSvg, round2, generationInputHasServerControls, acceptedCalls1To7ViewPlan, assertCalls1To7Claim, normalizeCalls1To7Views } };
