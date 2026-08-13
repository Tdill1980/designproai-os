"use strict";

/**
 * Phase 5: immutable Design Master revisions, and the approval that freezes one.
 *
 * Phases 1-4 built a canonical master, a deterministic renderer, and two proofs
 * derived from the surfaces those produce. What was still missing is the part
 * that makes any of it binding: a customer approves a *particular* design, and
 * production must be unable to print anything else.
 *
 * Two rules carry that.
 *
 * A REVISION IS NEW, NEVER AN EDIT. A revision request never mutates the master
 * it came from. It derives a new one, records what it superseded, and is
 * re-validated from scratch against the Phase 1 contract — so a revision cannot
 * carry a design out of the rules the original had to satisfy. The base master
 * remains exactly as approved, which matters because it may already have been
 * approved and printed.
 *
 * APPROVAL FREEZES AN IDENTITY, NOT A ROW. What a customer approves is one
 * master, rendered to one set of six surfaces, shown as one 2D proof and one 3D
 * proof, against one dimension manifest and one plate set. The approval records
 * the digest of that whole tuple. Production recomputes it and refuses to run
 * on anything that does not match — so a surface re-rendered at a different
 * resolution, a proof rebuilt from a newer master, or a plate set re-cut after
 * the fact all fail closed rather than printing quietly.
 *
 * That is the property the retired path could not have had. Its proof was a
 * generated picture, so there was nothing an approval could be *of*: the
 * artwork did not exist independently of the render, and re-running the same
 * request produced a different design.
 *
 * PHASE 5 SCOPE. Revision lineage, approval and the production gate. Phase 6
 * wires this to the stages and retires Call 8.
 */

const { createHash } = require("node:crypto");
const {
  DESIGN_MASTER_CONTRACT, SURFACE_KEYS, TRANSFORM_KEYS,
  canonical, validateDesignMaster,
} = require("./design-master.cjs");

const REVISION_REQUEST_CONTRACT = "designpro.design-revision-request.v1";
const REVISION_CONTRACT = "designpro.design-master-revision.v1";
const APPROVAL_CONTRACT = "designpro.design-revision-approval.v1";

/**
 * The closed set of things a revision may change.
 *
 * Closed deliberately. An open edit language would let a revision reach parts
 * of the master that are not the customer's to change — surface geometry, seam
 * correspondence, mirroring, spelling authority — and those are exactly the
 * fields manufacturing correctness rests on. Creative direction is expressed
 * through these operations; it does not get an escape hatch.
 */
const REVISION_OPERATIONS = Object.freeze([
  "set-text",            // respell or rewrite a canonical string
  "set-palette",         // recolour a token
  "set-layer-transform", // move, scale, rotate or skew a placed layer
  "set-layer-opacity",
  "set-layer-visible",
  "replace-asset",       // swap the file behind an asset, keeping its identity
]);

// A master's place in the lineage, as opposed to the design it describes.
const REVISION_METADATA_KEYS = Object.freeze([
  "masterHash", "revisionId", "supersedesRevisionId", "revisionSequence", "revisionRequestId",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
const SRGB_RE = /^#[0-9a-f]{6}$/;

class RevisionError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "RevisionError";
  }
}

function fail(code, message) {
  throw new RevisionError(code, message);
}

function sha256(text) {
  return createHash("sha256").update(Buffer.from(text)).digest("hex");
}

function requireUuid(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!UUID_RE.test(text)) fail("revision_uuid_invalid", `${label} must be a UUID`);
  return text;
}

function requireHash(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (!HASH_RE.test(text)) fail("revision_hash_invalid", `${label} must be a sha256 hex digest`);
  return text;
}

/** A deep copy that cannot alias the master it came from. */
function detach(value) {
  return JSON.parse(JSON.stringify(value));
}

// ------------------------------------------------------------------ requests

function validateOperation(operation, index) {
  const label = `request.operations[${index}]`;
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    fail("revision_operation_invalid", `${label} must be an object`);
  }
  const op = String(operation.op || "").trim();
  if (!REVISION_OPERATIONS.includes(op)) {
    fail("revision_operation_unknown", `${label}.op must be one of ${REVISION_OPERATIONS.join(", ")}`);
  }
  return { ...operation, op };
}

function validateRevisionRequest(input) {
  const request = input && typeof input === "object" && !Array.isArray(input) ? input : null;
  if (!request) fail("revision_request_invalid", "a revision request object is required");
  if (request.contract !== REVISION_REQUEST_CONTRACT) {
    fail("revision_request_contract_invalid", `request.contract must be ${REVISION_REQUEST_CONTRACT}`);
  }
  const operations = Array.isArray(request.operations) ? request.operations : null;
  if (!operations || !operations.length) fail("revision_request_empty", "a revision must change something");
  return Object.freeze({
    contract: REVISION_REQUEST_CONTRACT,
    requestId: requireUuid(request.requestId, "request.requestId"),
    revisionId: requireUuid(request.revisionId, "request.revisionId"),
    reason: String(request.reason || "").trim(),
    operations: Object.freeze(operations.map(validateOperation)),
  });
}

// ----------------------------------------------------------------- deriving

function applyOperation(draft, operation, index) {
  const label = `operations[${index}]`;
  switch (operation.op) {
    case "set-text": {
      const textId = String(operation.textId || "").trim();
      const target = draft.textObjects.find((item) => item.textId === textId);
      if (!target) fail("revision_text_unknown", `${label} names ${textId || "an unnamed string"}, which this design does not carry`);
      if (typeof operation.string !== "string" || !operation.string.trim()) {
        fail("revision_text_empty", `${label} would leave ${textId} blank`);
      }
      // Spelling authority stays with the revision snapshot: the new string is
      // canonical from here on, exactly as the old one was.
      target.string = operation.string;
      return;
    }
    case "set-palette": {
      const token = String(operation.token || "").trim();
      const target = draft.palette.find((item) => item.token === token);
      if (!target) fail("revision_palette_unknown", `${label} names colour token ${token || "(none)"}, which this design does not carry`);
      const srgb = String(operation.srgb || "").trim().toLowerCase();
      if (!SRGB_RE.test(srgb)) fail("revision_palette_invalid", `${label} must set an #rrggbb value`);
      target.srgb = srgb;
      return;
    }
    case "set-layer-transform": {
      const layer = layerFor(draft, operation, label);
      const transform = operation.transform && typeof operation.transform === "object" ? operation.transform : null;
      if (!transform) fail("revision_transform_invalid", `${label} must carry a transform`);
      for (const key of Object.keys(transform)) {
        if (!TRANSFORM_KEYS.includes(key)) fail("revision_transform_key_unknown", `${label}.transform.${key} is not a transform field`);
      }
      layer.transform = { ...layer.transform, ...transform };
      return;
    }
    case "set-layer-opacity": {
      const layer = layerFor(draft, operation, label);
      const opacity = Number(operation.opacity);
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) fail("revision_opacity_invalid", `${label}.opacity must be between 0 and 1`);
      layer.opacity = opacity;
      return;
    }
    case "set-layer-visible": {
      const layer = layerFor(draft, operation, label);
      if (typeof operation.visible !== "boolean") fail("revision_visible_invalid", `${label}.visible must be true or false`);
      // Visibility is per surface in this contract, and the operation says so
      // rather than setting a layer-level flag the renderer would ignore. A
      // revision that silently does nothing is worse than one that is refused:
      // the customer asked for a change and would be shown the old design.
      const surfaceKey = String(operation.surfaceKey || "").trim();
      if (!SURFACE_KEYS.includes(surfaceKey)) {
        fail("revision_visible_surface_required", `${label} must name which surface to hide ${layer.layerId} on`);
      }
      if (!draft.designSpace.surfaces.some((surface) => surface.surfaceKey === surfaceKey)) {
        fail("revision_visible_surface_unknown", `${label} names surface ${surfaceKey}, which this design space does not carry`);
      }
      const overrides = layer.surfaceOverrides && typeof layer.surfaceOverrides === "object" ? layer.surfaceOverrides : {};
      overrides[surfaceKey] = { ...(overrides[surfaceKey] || {}), visible: operation.visible };
      layer.surfaceOverrides = overrides;
      return;
    }
    case "replace-asset": {
      const assetId = String(operation.assetId || "").trim();
      const target = draft.assets.find((item) => item.assetId === assetId);
      if (!target) fail("revision_asset_unknown", `${label} names asset ${assetId || "(none)"}, which this design does not carry`);
      target.contentHash = requireHash(operation.contentHash, `${label}.contentHash`);
      if (operation.storagePath) target.storagePath = String(operation.storagePath);
      if (operation.intrinsic) target.intrinsic = detach(operation.intrinsic);
      // A logo's identity is its file. Replacing the file behind a logo asset
      // has to move the logo object's hash with it, or the two would disagree
      // and the proof would refuse the design it was asked to show.
      for (const logo of draft.logoObjects) {
        if (logo.assetId === assetId) logo.contentHash = target.contentHash;
      }
      return;
    }
    default:
      fail("revision_operation_unknown", `${label}.op is not a revision operation`);
  }
}

function layerFor(draft, operation, label) {
  const layerId = String(operation.layerId || "").trim();
  const layer = draft.layers.find((item) => item.layerId === layerId);
  if (!layer) fail("revision_layer_unknown", `${label} names layer ${layerId || "(none)"}, which this design does not carry`);
  return layer;
}

/**
 * Derive a new immutable Design Master from an approved one plus a request.
 *
 * The base is never touched. The result is re-validated in full, so a revision
 * that would breach any Phase 1 rule — a string too long for its extent, a logo
 * whose identity no longer matches its file, a seam that stopped being
 * invertible — fails here rather than reaching a renderer.
 */
function deriveRevision({ base, request }) {
  if (!base || base.contract !== DESIGN_MASTER_CONTRACT) {
    fail("revision_base_invalid", `a validated ${DESIGN_MASTER_CONTRACT} master is required as the base`);
  }
  const validated = validateRevisionRequest(request);
  if (validated.revisionId === base.revisionId) {
    fail("revision_id_reused", "a revision must carry its own revisionId, not the one it supersedes");
  }

  const draft = detach(base);
  validated.operations.forEach((operation, index) => applyOperation(draft, operation, index));

  draft.revisionId = validated.revisionId;
  draft.supersedesRevisionId = base.revisionId;
  draft.revisionSequence = Number.isInteger(base.revisionSequence) ? base.revisionSequence + 1 : 1;
  draft.revisionRequestId = validated.requestId;
  // Derived, never carried over: the base's identity is not this one's.
  draft.masterHash = undefined;

  const master = validateDesignMaster(draft);
  // Compared on design content, not on masterHash. Lineage is part of the
  // master's identity, so a revision that changed nothing would still hash
  // differently purely because it carries a new revisionId — and would then be
  // approvable as if it were a new design, asking the customer to accept the
  // same artwork twice under two frozen identities.
  if (designContentHash(master) === designContentHash(base)) {
    fail("revision_changed_nothing", "the revision produced the design it started from");
  }
  return master;
}

/**
 * The design a master describes, with its place in the lineage removed.
 *
 * Two masters with the same content hash would print identically; they differ
 * only in which revision they are.
 */
function designContentHash(master) {
  const content = { ...master };
  for (const key of REVISION_METADATA_KEYS) delete content[key];
  return sha256(JSON.stringify(canonical(content)));
}

// ---------------------------------------------------------------- identity

/**
 * The identity a customer approves.
 *
 * Every hash that could change what prints is in here. Approval is a statement
 * about this exact tuple, so anything regenerated afterwards — at a different
 * resolution, from a newer master, against re-cut plates — produces a different
 * identity and stops being approved.
 */
function bundleIdentity(bundle) {
  return sha256(JSON.stringify(canonical({
    contract: REVISION_CONTRACT,
    designId: bundle.designId,
    revisionId: bundle.revisionId,
    supersedesRevisionId: bundle.supersedesRevisionId ?? null,
    revisionSequence: bundle.revisionSequence,
    masterHash: bundle.masterHash,
    renderHash: bundle.renderHash,
    surfaceHashes: bundle.surfaceHashes,
    pxPerInch: bundle.pxPerInch,
    bleedIn: bundle.bleedIn,
    proof2dHash: bundle.proof2dHash,
    proof3dHash: bundle.proof3dHash,
    plateSetId: bundle.plateSetId,
    plateSetHash: bundle.plateSetHash,
    dimensionManifestId: bundle.dimensionManifestId,
    manifestHash: bundle.manifestHash,
  })));
}

/**
 * A revision bundle is one master and everything derived from it, checked for
 * agreement before anyone is asked to approve it.
 *
 * The checks are the point: each artefact independently records where it came
 * from, so a bundle assembled from mismatched parts is detectable here rather
 * than at the printer.
 */
function validateRevisionBundle(input) {
  const bundle = input && typeof input === "object" ? input : fail("revision_bundle_invalid", "a revision bundle is required");
  const { master, render, proof2d, proof3d } = bundle;
  if (!master || master.contract !== DESIGN_MASTER_CONTRACT) fail("revision_bundle_master_invalid", "the bundle must carry a validated Design Master");
  if (!render || render.contract !== "designpro.production-surface-render.v1") fail("revision_bundle_render_invalid", "the bundle must carry a completed production render");
  if (!proof2d || proof2d.contract !== "designpro.master-derived-2d-proof.v1") fail("revision_bundle_proof2d_invalid", "the bundle must carry the master-derived 2D proof");
  if (!proof3d || proof3d.contract !== "designpro.master-derived-3d-proof.v1") fail("revision_bundle_proof3d_invalid", "the bundle must carry the master-derived 3D proof");

  if (render.masterHash !== master.masterHash) {
    fail("revision_bundle_render_drift", "the surfaces were rendered from a different master than the bundle carries");
  }
  for (const [name, proof] of [["2D", proof2d], ["3D", proof3d]]) {
    if (proof.masterHash !== master.masterHash || proof.renderHash !== render.renderHash) {
      fail("revision_bundle_proof_drift", `the ${name} proof was built from different surfaces than the bundle carries`);
    }
  }
  // Both proofs must be showing the same six surfaces, not merely the same
  // render identity: a customer who approves one is approving the other.
  const bySurface = new Map(render.surfaces.map((surface) => [surface.surfaceKey, surface.contentHash]));
  for (const [name, proof] of [["2D", proof2d], ["3D", proof3d]]) {
    for (const entry of proof.surfaceHashes) {
      if (bySurface.get(entry.surfaceKey) !== entry.contentHash) {
        fail("revision_bundle_surface_drift", `the ${name} proof shows a ${entry.surfaceKey} surface the render did not produce`);
      }
    }
  }
  // And they must be showing the same canonical strings. Two proofs of one
  // design that disagree on a string is the exact failure that retired Call 8.
  const strings = (proof) => proof.textIdentities.map((item) => `${item.textId}=${item.string}`).sort().join("\n");
  if (strings(proof2d) !== strings(proof3d)) {
    fail("revision_bundle_text_disagreement", "the 2D and 3D proofs of this revision carry different canonical text");
  }

  const identity = {
    contract: REVISION_CONTRACT,
    designId: String(master.designId),
    revisionId: master.revisionId,
    supersedesRevisionId: master.supersedesRevisionId ?? null,
    revisionSequence: Number.isInteger(master.revisionSequence) ? master.revisionSequence : 0,
    masterHash: master.masterHash,
    renderHash: render.renderHash,
    surfaceHashes: SURFACE_KEYS.map((surfaceKey) => ({ surfaceKey, contentHash: bySurface.get(surfaceKey) })),
    pxPerInch: render.pxPerInch,
    bleedIn: render.bleedIn,
    proof2dHash: proof2d.contentHash,
    proof3dHash: proof3d.proofHash,
    plateSetId: proof3d.plateSetId,
    plateSetHash: proof3d.plateSetHash,
    dimensionManifestId: master.dimensionManifestId,
    manifestHash: master.manifestHash,
  };
  return Object.freeze({ ...identity, bundleIdentity: bundleIdentity(identity) });
}

// ---------------------------------------------------------------- approval

/**
 * Freeze a revision at the identity the customer saw.
 *
 * The approval is not a flag on a row. It is a statement that this exact tuple
 * of hashes was shown and accepted, and it is checkable forever without
 * trusting any mutable state.
 */
function freezeApproval({ bundle, approvedBy, approvalRef, approvedAt }) {
  const identity = bundle && bundle.bundleIdentity ? bundle : validateRevisionBundle(bundle);
  const actor = requireUuid(approvedBy, "approvedBy");
  const reference = String(approvalRef || "").trim();
  if (!reference) fail("approval_reference_required", "an approval must record what the customer accepted and where");
  const at = String(approvedAt || "").trim();
  if (!at || Number.isNaN(Date.parse(at))) fail("approval_timestamp_invalid", "approvedAt must be an ISO-8601 instant");

  const frozen = {
    contract: APPROVAL_CONTRACT,
    bundleIdentity: identity.bundleIdentity,
    designId: identity.designId,
    revisionId: identity.revisionId,
    revisionSequence: identity.revisionSequence,
    masterHash: identity.masterHash,
    renderHash: identity.renderHash,
    surfaceHashes: identity.surfaceHashes,
    proof2dHash: identity.proof2dHash,
    proof3dHash: identity.proof3dHash,
    plateSetHash: identity.plateSetHash,
    dimensionManifestId: identity.dimensionManifestId,
    manifestHash: identity.manifestHash,
    approvedBy: actor,
    approvalRef: reference,
    approvedAt: new Date(at).toISOString(),
  };
  return Object.freeze({ ...frozen, approvalHash: sha256(JSON.stringify(canonical(frozen))) });
}

/**
 * The production gate.
 *
 * Production consumes an approved frozen revision or it does not run. The
 * bundle handed to it is re-identified from its own artefacts and compared, so
 * this cannot be satisfied by a row that merely says "approved" beside a
 * design that has since moved.
 */
function assertProductionEligible({ approval, bundle }) {
  if (!approval || approval.contract !== APPROVAL_CONTRACT) {
    fail("production_not_approved", "production requires a frozen customer approval");
  }
  // The record's own integrity first. Every comparison below reads a field off
  // the approval, so a record that does not hash to its own contents must be
  // rejected before any of those fields is believed.
  if (approval.approvalHash !== sha256(JSON.stringify(canonical({ ...approval, approvalHash: undefined })))) {
    fail("production_approval_tampered", "the frozen approval does not hash to its own contents");
  }
  const identity = bundle && bundle.bundleIdentity ? bundle : validateRevisionBundle(bundle);
  if (approval.revisionId !== identity.revisionId) {
    fail("production_revision_mismatch", `the approval is for revision ${approval.revisionId}, not ${identity.revisionId}`);
  }
  if (approval.bundleIdentity !== identity.bundleIdentity) {
    fail("production_identity_drift",
      `revision ${identity.revisionId} no longer matches what was approved: approved ${approval.bundleIdentity.slice(0, 16)}, offered ${identity.bundleIdentity.slice(0, 16)}`);
  }
  return identity;
}

module.exports = {
  REVISION_REQUEST_CONTRACT,
  REVISION_CONTRACT,
  APPROVAL_CONTRACT,
  REVISION_OPERATIONS,
  RevisionError,
  validateRevisionRequest,
  deriveRevision,
  validateRevisionBundle,
  bundleIdentity,
  freezeApproval,
  assertProductionEligible,
  _test: { applyOperation, detach, sha256 },
};
