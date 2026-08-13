"use strict";

/**
 * Phase 5: one revision cycle, end to end.
 *
 * A revision request comes in; a new immutable Design Master comes out, with
 * six surfaces, a 2D proof and a 3D proof regenerated from it and bound to it.
 * The customer approves that bundle, which freezes its identity. Production is
 * then allowed to consume the frozen revision and nothing else.
 *
 * Everything here is composition. The rules live in the modules underneath —
 * Phase 1's contract, Phase 2's renderer, Phase 3's flat proof, Phase 4's
 * vehicle views — and this file is the order they run in and the bookkeeping
 * that keeps them bound to one another. That is deliberate: a cycle that
 * reimplemented any of those checks would be a second place for them to be
 * wrong.
 *
 * WHY REGENERATE EVERYTHING. A revision that changed one string could in
 * principle re-render one surface. It does not, because partial regeneration
 * makes the bundle's identity depend on which parts were considered stale, and
 * that judgement is exactly the kind of thing that is right until the day it is
 * not. Rendering is deterministic, so regenerating is cheap in the only
 * currency that matters here: it cannot be wrong.
 *
 * PHASE 5 SCOPE. The cycle and the gate. Nothing is wired to a workflow stage
 * and Call 8 keeps production authority until Phase 6.
 */

const { renderProductionSurfaces } = require("./design-master-renderer.cjs");
const { renderMasterProof } = require("./master-proof-sheet.cjs");
const { renderMasterDerived3dProof } = require("./master-derived-3d-proof.cjs");
const {
  deriveRevision, validateRevisionBundle, freezeApproval, assertProductionEligible,
  RevisionError,
} = require("./design-master-revision.cjs");

const CYCLE_CONTRACT = "designpro.design-revision-cycle.v1";

function fail(code, message) {
  throw new RevisionError(code, message);
}

/**
 * Regenerate every derived artefact from one master.
 *
 * The order is the dependency order and the proofs are built from the render
 * rather than from the master, so neither proof can be showing artwork the
 * surfaces do not contain.
 */
async function regenerate({
  master, manifest, plates, loadAsset, loadFont, proofFonts,
  pxPerInch, bleedInches, vehicle, designName, finish, designId, orderNumber,
  maxSurfaceBytes, maxViewBytes,
}) {
  const render = await renderProductionSurfaces({
    master, loadAsset, loadFont, pxPerInch, bleedInches,
    ...(maxSurfaceBytes ? { maxSurfaceBytes } : {}),
  });
  const proof2d = await renderMasterProof({
    render, manifest, proofFonts, bleedInches,
    vehicle, designName, finish,
    designId: designId || master.designId,
    orderNumber,
  });
  const proof3d = await renderMasterDerived3dProof({
    render, plates, loadAsset, proofFonts,
    ...(maxViewBytes ? { maxViewBytes } : {}),
  });
  return { render, proof2d, proof3d };
}

/**
 * Run one revision: derive the new master, regenerate everything from it, and
 * return the bundle with the identity a customer would be approving.
 *
 * The base is returned untouched alongside it. A revision under review has not
 * replaced anything yet — the previously approved design is still the one
 * production may print, and will stay so until this bundle is approved.
 */
async function runRevisionCycle({ base, request, ...inputs }) {
  const master = deriveRevision({ base, request });
  const derived = await regenerate({ master, ...inputs });
  const identity = validateRevisionBundle({ master, ...derived });
  return Object.freeze({
    contract: CYCLE_CONTRACT,
    base,
    master,
    render: derived.render,
    proof2d: derived.proof2d,
    proof3d: derived.proof3d,
    identity,
    // What a customer is shown, and what an approval will be a statement about.
    approvalCandidate: Object.freeze({
      revisionId: identity.revisionId,
      supersedesRevisionId: identity.supersedesRevisionId,
      revisionSequence: identity.revisionSequence,
      bundleIdentity: identity.bundleIdentity,
      proof2dHash: identity.proof2dHash,
      proof3dHash: identity.proof3dHash,
      textIdentities: derived.proof2d.textIdentities,
      logoIdentities: derived.proof2d.logoIdentities,
      totalSqFt: derived.proof2d.totalSqFt,
    }),
  });
}

/**
 * Build the first bundle for a design, from a master that supersedes nothing.
 *
 * Separate from runRevisionCycle because an origin has no base to derive from,
 * and pretending otherwise would mean inventing a predecessor that was never
 * approved and never printed.
 */
async function runOriginCycle({ master, ...inputs }) {
  if (master.supersedesRevisionId) {
    fail("cycle_origin_supersedes", "an origin cycle must start from a master that supersedes nothing");
  }
  const derived = await regenerate({ master, ...inputs });
  const identity = validateRevisionBundle({ master, ...derived });
  return Object.freeze({
    contract: CYCLE_CONTRACT,
    base: null,
    master,
    render: derived.render,
    proof2d: derived.proof2d,
    proof3d: derived.proof3d,
    identity,
    approvalCandidate: Object.freeze({
      revisionId: identity.revisionId,
      supersedesRevisionId: null,
      revisionSequence: identity.revisionSequence,
      bundleIdentity: identity.bundleIdentity,
      proof2dHash: identity.proof2dHash,
      proof3dHash: identity.proof3dHash,
      textIdentities: derived.proof2d.textIdentities,
      logoIdentities: derived.proof2d.logoIdentities,
      totalSqFt: derived.proof2d.totalSqFt,
    }),
  });
}

/**
 * Approve a cycle's bundle, freezing exactly what was shown.
 *
 * The identity is recomputed from the artefacts rather than taken from the
 * cycle's own report, so an approval cannot be recorded against a summary that
 * has drifted from the artefacts it summarises.
 */
function approveCycle({ cycle, approvedBy, approvalRef, approvedAt }) {
  if (!cycle || cycle.contract !== CYCLE_CONTRACT) fail("approval_cycle_invalid", "approval requires a completed revision cycle");
  const identity = validateRevisionBundle({
    master: cycle.master, render: cycle.render, proof2d: cycle.proof2d, proof3d: cycle.proof3d,
  });
  if (identity.bundleIdentity !== cycle.identity.bundleIdentity) {
    fail("approval_cycle_drift", "the cycle's reported identity does not match its own artefacts");
  }
  return freezeApproval({ bundle: identity, approvedBy, approvalRef, approvedAt });
}

/**
 * What production is allowed to run on.
 *
 * Returns the six surfaces only after the frozen approval has been checked
 * against the bundle's recomputed identity. There is no path here that hands
 * back artwork without that check having passed.
 */
function approvedProductionSurfaces({ approval, cycle }) {
  if (!cycle || cycle.contract !== CYCLE_CONTRACT) fail("production_cycle_invalid", "production requires a completed revision cycle");
  const identity = assertProductionEligible({
    approval,
    bundle: { master: cycle.master, render: cycle.render, proof2d: cycle.proof2d, proof3d: cycle.proof3d },
  });
  return Object.freeze({
    bundleIdentity: identity.bundleIdentity,
    revisionId: identity.revisionId,
    masterHash: identity.masterHash,
    renderHash: identity.renderHash,
    dimensionManifestId: identity.dimensionManifestId,
    manifestHash: identity.manifestHash,
    pxPerInch: identity.pxPerInch,
    bleedIn: identity.bleedIn,
    surfaces: cycle.render.surfaces,
    approvalHash: approval.approvalHash,
    approvalRef: approval.approvalRef,
  });
}

module.exports = {
  CYCLE_CONTRACT,
  runOriginCycle,
  runRevisionCycle,
  approveCycle,
  approvedProductionSurfaces,
  _test: { regenerate },
};
