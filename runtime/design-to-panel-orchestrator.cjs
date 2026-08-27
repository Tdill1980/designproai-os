"use strict";

/**
 * CANONICAL DESIGNPROAI DESIGN -> PANEL FILES ORCHESTRATION
 *
 * Owner contract, 2026-08-27.
 *
 * This module is deliberately small. It does NOT implement another prompt,
 * renderer, panelizer, QC engine or storage layer. It is the executable graph
 * contract that the existing producers must satisfy.
 *
 * Creative authority:
 *   design-panel-ai-generate / real DesignIQ -> ONE ATLAS source master.
 *
 * Production authority:
 *   accepted ATLAS master -> deterministic surface panels -> 5in bleed.
 *
 * Presentation authority:
 *   matching extracted panel + YMM + canonical view angle + Studio OS lighting
 *   -> one 3D proof. A proof is never design authority.
 *
 * Consumer rule:
 *   RevisionStudioIQ and PanelPro read the SAME persisted artifacts. Neither UI
 *   is allowed to manufacture, mirror, upload, re-cut or regenerate a panel.
 */

const CONTRACT = "designpro.design-to-panel-orchestrator.v1";
const BLEED_INCHES = 5;

const SURFACES = Object.freeze([
  "driver",
  "passenger",
  "hood",
  "front",
  "rear",
  "roof",
]);

const PROOF_VIEWS = Object.freeze([
  "side",
  "passenger-side",
  "hood_detail",
  "front",
  "rear",
  "close-up",
  "roof",
]);

const VIEW_TO_SURFACE = Object.freeze({
  side: "driver",
  "passenger-side": "passenger",
  hood_detail: "hood",
  front: "front",
  rear: "rear",
  "close-up": "driver",
  roof: "roof",
});

const STAGES = Object.freeze({
  AUTHOR: "author.call1",
  MASTER_ACCEPTED: "master.accepted",
  PANEL_READY: "panel.ready",
  ASSET_EXTRACT: "assets.extract",
  PROOF_START: "proof.start",
  PROOF_READY: "proof.ready",
  REVISIONSTUDIO_PUBLISH: "revisionstudio.publish",
  PANELPRO_PUBLISH: "panelpro.publish",
  UPSCALE: "production.upscale",
  OUTPUT: "production.output",
  PACK: "production.pack",
});

const AUTHORITIES = Object.freeze({
  creative: "design-panel-ai-generate",
  master: "atlas",
  geometry: "genie",
  proofCamera: "view-angles-os",
  proofStudioLighting: "studio-os",
  proofPresentation: "photographer-render",
});

function invariant(condition, code, message) {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    throw error;
  }
}

function hash64(value) {
  return /^[0-9a-f]{64}$/.test(String(value || "").toLowerCase());
}

function assertPanel(panel, master) {
  invariant(panel && typeof panel === "object", "orchestration_panel_missing", "Panel is required");
  invariant(SURFACES.includes(panel.surfaceKey), "orchestration_surface_invalid", `Unknown surface ${panel.surfaceKey}`);
  invariant(hash64(panel.contentHash), "orchestration_panel_hash_invalid", `${panel.surfaceKey} panel hash is invalid`);
  invariant(hash64(panel.sourceMasterHash), "orchestration_master_hash_invalid", `${panel.surfaceKey} source master hash is invalid`);
  invariant(panel.sourceMasterHash === master.contentHash, "orchestration_panel_master_mismatch", `${panel.surfaceKey} panel is not a child of the accepted master`);
  invariant(Number(panel.bleedInches) === BLEED_INCHES, "orchestration_bleed_invalid", `${panel.surfaceKey} must carry exactly 5in bleed`);
  invariant(Number(panel.printWidthIn) === Number(panel.trimWidthIn) + BLEED_INCHES * 2,
    "orchestration_print_width_invalid", `${panel.surfaceKey} print width must equal trim + 10in`);
  invariant(Number(panel.printHeightIn) === Number(panel.trimHeightIn) + BLEED_INCHES * 2,
    "orchestration_print_height_invalid", `${panel.surfaceKey} print height must equal trim + 10in`);
  return true;
}

function assertProof(proof, panel, lineage) {
  invariant(proof && typeof proof === "object", "orchestration_proof_missing", "Proof is required");
  invariant(PROOF_VIEWS.includes(proof.sourceViewType), "orchestration_view_invalid", `Unknown proof view ${proof.sourceViewType}`);
  const expectedSurface = VIEW_TO_SURFACE[proof.sourceViewType];
  invariant(expectedSurface === panel.surfaceKey, "orchestration_view_surface_mismatch",
    `${proof.sourceViewType} must use the ${expectedSurface} panel`);
  invariant(proof.generationId === lineage.generationId, "orchestration_generation_mismatch", "Proof generationId drifted");
  invariant(proof.atlasRevisionId === lineage.atlasRevisionId, "orchestration_revision_mismatch", "Proof atlasRevisionId drifted");
  invariant(proof.masterContentHash === lineage.masterContentHash, "orchestration_proof_master_mismatch", "Proof master hash drifted");
  invariant(proof.sourcePanelHash === panel.contentHash, "orchestration_proof_panel_mismatch", "Proof was not rendered from the matching extracted panel");
  return true;
}

function assertCompletePanelSet(panels, master) {
  invariant(Array.isArray(panels), "orchestration_panels_invalid", "Panels must be an array");
  invariant(panels.length === SURFACES.length, "orchestration_panel_count_invalid", `Expected 6 panels, found ${panels.length}`);
  const seen = new Set();
  for (const panel of panels) {
    assertPanel(panel, master);
    invariant(!seen.has(panel.surfaceKey), "orchestration_panel_duplicate", `Duplicate panel ${panel.surfaceKey}`);
    seen.add(panel.surfaceKey);
  }
  for (const surface of SURFACES) invariant(seen.has(surface), "orchestration_panel_missing", `Missing panel ${surface}`);
  return true;
}

function assertCompleteProofSet(proofs, panels, lineage) {
  invariant(Array.isArray(proofs), "orchestration_proofs_invalid", "Proofs must be an array");
  invariant(proofs.length === PROOF_VIEWS.length, "orchestration_proof_count_invalid", `Expected 7 proofs, found ${proofs.length}`);
  const panelBySurface = new Map(panels.map((panel) => [panel.surfaceKey, panel]));
  const seen = new Set();
  for (const proof of proofs) {
    invariant(!seen.has(proof.sourceViewType), "orchestration_proof_duplicate", `Duplicate proof ${proof.sourceViewType}`);
    seen.add(proof.sourceViewType);
    assertProof(proof, panelBySurface.get(VIEW_TO_SURFACE[proof.sourceViewType]), lineage);
  }
  for (const view of PROOF_VIEWS) invariant(seen.has(view), "orchestration_proof_missing", `Missing proof ${view}`);
  return true;
}

/**
 * Dependency graph. Nodes may start as soon as THEIR OWN dependencies exist.
 * There is intentionally no "wait for all proofs" or "wait for Driver" edge.
 */
function graph() {
  return {
    contract: CONTRACT,
    authoring: {
      node: STAGES.AUTHOR,
      producer: AUTHORITIES.creative,
      imageDesignCalls: 1,
      output: "one accepted flattened ATLAS source master",
    },
    masterAccepted: {
      node: STAGES.MASTER_ACCEPTED,
      dependsOn: [STAGES.AUTHOR],
      fansOutTo: [STAGES.PANEL_READY, STAGES.ASSET_EXTRACT],
    },
    panelReady: {
      node: STAGES.PANEL_READY,
      surfaces: [...SURFACES],
      orderPriority: [...SURFACES],
      deterministic: true,
      bleedInches: BLEED_INCHES,
      onEach: [STAGES.PROOF_START, STAGES.REVISIONSTUDIO_PUBLISH, STAGES.PANELPRO_PUBLISH],
    },
    proofStart: {
      node: STAGES.PROOF_START,
      views: [...PROOF_VIEWS],
      dependsOn: "matching panel only",
      artworkAuthority: "matching extracted ATLAS panel",
      cameraAuthority: AUTHORITIES.proofCamera,
      studioLightingAuthority: AUTHORITIES.proofStudioLighting,
      presentationProducer: AUTHORITIES.proofPresentation,
      designCalls: 0,
    },
    publish: {
      revisionStudio: STAGES.REVISIONSTUDIO_PUBLISH,
      panelPro: STAGES.PANELPRO_PUBLISH,
      rule: "same persisted panel/proof/logo artifacts; no UI-side production",
    },
    production: {
      sequence: [STAGES.UPSCALE, STAGES.OUTPUT, STAGES.PACK],
      source: "approved active panel derivative",
      preservesOriginal: true,
    },
  };
}

module.exports = {
  AUTHORITIES,
  BLEED_INCHES,
  CONTRACT,
  PROOF_VIEWS,
  STAGES,
  SURFACES,
  VIEW_TO_SURFACE,
  assertCompletePanelSet,
  assertCompleteProofSet,
  assertPanel,
  assertProof,
  graph,
};
