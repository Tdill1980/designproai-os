"use strict";
/**
 * DESIGNPRO PIPELINE V2 — the owner's target pipeline (2026-09-25), declared.
 *
 *   Call 1  TriZone Production Panel Proof  → shown to the customer at once
 *   (suite) custom design edge functions between Call 1 and Call 2
 *   Call 2  seven 3D vehicle views, IN PARALLEL, each streamed as it lands
 *   ∥       ATLAS topology proof from the Call-1 proof, 5" bleed
 *   QC      Atlas + proof + 3D views → PanelPro Studio (human)
 *   LATER   Topaz upscale · vectorize · vector template by year/make/model
 *
 * THIS FILE PRODUCES NOTHING. It is the declared graph, the resolution gate
 * and the prompt pin, so the pipeline can be checked, reported and flagged
 * without adding a second producer (CLAUDE.md "ZONE 1 IS CUT FROM THE
 * TEMPLATE": no second panel producer, no re-author pass). Every node names
 * the file that already does the work, or says it is a disabled hook.
 *
 * Off unless DESIGNPRO_PIPELINE_V2 is exactly "true".
 */
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const PIPELINE_V2_CONTRACT = "designpro.pipeline-v2.v1";

function pipelineV2Enabled(env = process.env) {
  return String(env.DESIGNPRO_PIPELINE_V2 || "").trim().toLowerCase() === "true";
}

/**
 * The graph. `impl` is where the work already happens (file:symbol); a node
 * with `enabled: false` is a HOOK: its inputs/outputs are fixed now so it can
 * be switched on later without reshaping anything, and `needs` says what
 * access it is waiting for.
 */
const PIPELINE_V2_DAG = Object.freeze([
  { id: "call1.trizone_proof", after: [], enabled: true, customerVisible: true,
    impl: "supabase/functions/production-panel-proof (two-turn 3:2 4K); shown by app DesignPanelProPremium AtlasPanelProofSheetLoader",
    outputs: ["panel-proof-sheet", "panel-refs"] },
  { id: "design.suite", after: ["call1.trizone_proof"], enabled: true, customerVisible: false,
    impl: "deployed edge functions, see docs/PIPELINE-V2-JOURNEY-MAP.md inventory (designpro-text-layer-generate, extract-logo-elements, designpro-separate, vectorize-it …)",
    outputs: ["design-suite-receipts"], optional: true },
  ...["side", "passenger-side", "front", "rear", "hood_detail", "roof", "close-up"].map((view) => ({
    id: `call2.view.${view}`, after: ["call1.trizone_proof"], enabled: true, customerVisible: true, parallelGroup: "call2.views",
    impl: "runtime/designpanel-server-provider.cjs prefetchAtlasProofsFromPanelProof → edge persona-photographer-render; streamed by app waitForGeneration onViews",
    outputs: [`view:${view}`],
  })),
  { id: "atlas.topology", after: ["call1.trizone_proof"], enabled: true, customerVisible: false, parallelGroup: "call2.views",
    impl: "runtime/atlas-panel-proof-topology.cjs (zone bleedIn, 5\" per CLAUDE.md §5\" BLEED)", outputs: ["atlas-topology-proof"], bleedIn: 5 },
  { id: "qc.panelpro", after: ["atlas.topology", "call2.views"], enabled: true, customerVisible: false,
    impl: "app AdminGeminiCompareStudio preflight/final checks; runtime claimant await_panelpro_preflight_qc / await_final_human_qc", outputs: ["qc-verdict"] },
  { id: "enhance.upscale", after: ["qc.panelpro"], enabled: false, hook: true,
    impl: "runtime/topaz-upscale.cjs upscalePlan/enhance (claimant enhance.upscale)", needs: ["TOPAZ_API_KEY", "DESIGNPRO_TOPAZ_ENABLED=true"],
    outputs: ["panel-upscaled"] },
  { id: "vectorize.layers", after: ["qc.panelpro"], enabled: false, hook: true,
    impl: "runtime/layerize.cjs (vtracer) / edge vectorize-it", needs: ["owner decision: which layers are vector (text/logo/cut)"],
    outputs: ["vector-layers"] },
  { id: "template.vector", after: [], enabled: false, hook: true,
    impl: "designpro_designs.template_ref (jsonb) — Dropbox vector template by year/make/model",
    needs: ["Dropbox app (OAuth, files.content.read) + shared folder access", "folder naming convention year/make/model"],
    outputs: ["vector-template"] },
]);

/** Nodes that start together once their shared predecessor lands. */
function parallelGroups(dag = PIPELINE_V2_DAG) {
  const groups = {};
  for (const node of dag) if (node.parallelGroup) (groups[node.parallelGroup] ||= []).push(node.id);
  return groups;
}

/**
 * THE RESOLUTION GATE. Native pixels over the panel's printed inches, compared
 * with a threshold, and what Topaz could add (its plan, clamped by the
 * provider's 6× / 32,000 px / 96 MP ceilings). Pure: it reports, it does not
 * resize. `targetPpi` defaults to the owner's 150 PPI print rule.
 */
function resolutionGate({ widthPx, heightPx, printWidthIn, printHeightIn, minNativePpi = 150, targetPpi = 150 }) {
  const w = Number(widthPx), h = Number(heightPx), wi = Number(printWidthIn), hi = Number(printHeightIn);
  if (![w, h, wi, hi].every((v) => Number.isFinite(v) && v > 0)) {
    throw Object.assign(new Error("resolution_gate_geometry_invalid"), { code: "resolution_gate_geometry_invalid" });
  }
  const nativePpi = Math.min(w / wi, h / hi);
  const targetWidthPx = Math.ceil(wi * targetPpi), targetHeightPx = Math.ceil(hi * targetPpi);
  let topaz = null;
  if (targetWidthPx > w || targetHeightPx > h) {
    const { upscalePlan } = require("./topaz-upscale.cjs");
    const plan = upscalePlan({ sourceWidthPx: Math.round(w), sourceHeightPx: Math.round(h), targetWidthPx, targetHeightPx });
    topaz = { ...plan, ppiAfterTopaz: Math.round(Math.min(plan.outputWidth / wi, plan.outputHeight / hi) * 100) / 100 };
  }
  return {
    contract: `${PIPELINE_V2_CONTRACT}.resolution-gate`,
    nativePpi: Math.round(nativePpi * 100) / 100,
    minNativePpi, targetPpi,
    eligible: nativePpi >= minNativePpi,
    topaz,
    reachesTargetWithTopaz: topaz ? topaz.ppiAfterTopaz >= targetPpi : true,
  };
}

/**
 * THE PROMPT PIN. Call 1's prompt sources are hashed; the pin records the
 * contract string they ship under. Changing a prompt file without bumping the
 * pin fails the lock test, so every prompt change is a deliberate, versioned
 * event instead of a silent edit (the audit counted ~30 prompt revisions
 * shipped under one contract string).
 */
const PROMPT_SOURCES = Object.freeze([
  "supabase/functions/_shared/atlas-panel-proof-prompt.ts",
  "supabase/functions/_shared/atlas-proof-container-template.ts",
]);

function promptSourceHashes(root = join(__dirname, "..")) {
  return Object.fromEntries(PROMPT_SOURCES.map((file) => [
    file, createHash("sha256").update(readFileSync(join(root, file))).digest("hex"),
  ]));
}

function verifyPromptPin(pin, root) {
  const actual = promptSourceHashes(root);
  const drift = PROMPT_SOURCES.filter((file) => pin?.sources?.[file] !== actual[file]);
  return { ok: drift.length === 0, drift, actual, promptVersion: pin?.promptVersion || null };
}

module.exports = {
  PIPELINE_V2_CONTRACT, PIPELINE_V2_DAG, PROMPT_SOURCES,
  pipelineV2Enabled, parallelGroups, resolutionGate, promptSourceHashes, verifyPromptPin,
};
