import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const orchestration = require("../runtime/design-to-panel-orchestrator.cjs");

const workerSource = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
const atlasSource = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const providerSource = readFileSync(new URL("../runtime/designpanel-server-provider.cjs", import.meta.url), "utf8");

test("canonical graph is one creative call then deterministic panel fan-out", () => {
  const graph = orchestration.graph();
  assert.equal(graph.authoring.producer, "design-panel-ai-generate");
  assert.equal(graph.authoring.imageDesignCalls, 1);
  assert.equal(graph.panelReady.deterministic, true);
  assert.equal(graph.panelReady.bleedInches, 5);
  assert.deepEqual(graph.panelReady.surfaces, ["driver", "passenger", "hood", "front", "rear", "roof"]);
  assert.equal(graph.proofStart.dependsOn, "matching panel only");
  assert.equal(graph.proofStart.designCalls, 0);
  assert.equal(graph.proofStart.cameraAuthority, "view-angles-os");
  assert.equal(graph.proofStart.studioLightingAuthority, "studio-os");
});

test("panel contract enforces master lineage and five-inch bleed", () => {
  const master = { contentHash: "a".repeat(64) };
  const panel = {
    surfaceKey: "driver",
    contentHash: "b".repeat(64),
    sourceMasterHash: master.contentHash,
    bleedInches: 5,
    trimWidthIn: 210,
    trimHeightIn: 70,
    printWidthIn: 220,
    printHeightIn: 80,
  };
  assert.equal(orchestration.assertPanel(panel, master), true);
  assert.throws(() => orchestration.assertPanel({ ...panel, bleedInches: 4 }, master), /exactly 5in bleed/);
  assert.throws(() => orchestration.assertPanel({ ...panel, sourceMasterHash: "c".repeat(64) }, master), /not a child/);
});

test("proof contract binds each view to its matching extracted panel", () => {
  const lineage = {
    generationId: "generation-1",
    atlasRevisionId: "revision-1",
    masterContentHash: "a".repeat(64),
  };
  const panel = { surfaceKey: "hood", contentHash: "b".repeat(64) };
  const proof = {
    sourceViewType: "hood_detail",
    generationId: lineage.generationId,
    atlasRevisionId: lineage.atlasRevisionId,
    masterContentHash: lineage.masterContentHash,
    sourcePanelHash: panel.contentHash,
  };
  assert.equal(orchestration.assertProof(proof, panel, lineage), true);
  assert.throws(() => orchestration.assertProof({ ...proof, sourceViewType: "rear" }, panel, lineage), /must use the rear panel/);
});

test("existing ATLAS runtime releases each panel immediately instead of batching the set", () => {
  assert.match(atlasSource, /const PANEL_EXTRACTION_ORDER = Object\.freeze\(\["driver", "passenger", "hood", "front", "rear", "roof"\]\)/);
  assert.match(atlasSource, /onSurfaceReady = null/);
  assert.match(atlasSource, /onPanel: async \(panel\) =>/);
  assert.match(atlasSource, /store\.putImmutableBytes/);
  assert.match(atlasSource, /onSurfaceReady\(\{/);
  assert.match(atlasSource, /A failed proof[\s\S]*never blocks its production panel/i);
});

test("worker runs ATLAS proof slots in parallel and gates only on the matching surface", () => {
  assert.match(workerSource, /function surfaceGateSet/);
  assert.match(workerSource, /surfaceForProofView\(sourceViewType\)/);
  assert.match(workerSource, /parallel: true/);
  assert.match(workerSource, /A failed Hood 3D proof cannot prevent the Hood production panel from[\s\S]*existing/);
});

test("3D presentation is locked to canonical angle, studio and lighting authorities", () => {
  assert.match(providerSource, /const angles = require\("\.\/view-angles\.cjs"\)/);
  assert.match(providerSource, /STUDIO_ENVIRONMENT/);
  assert.match(providerSource, /STUDIO_REINFORCEMENT/);
  assert.match(providerSource, /PHOTOREALISM_REQUIREMENT/);
  assert.match(workerSource, /viewAngleContractVersion/);
  assert.match(workerSource, /studioContractVersion/);
  assert.match(workerSource, /photographyContractVersion/);
});

test("RevisionStudio and PanelPro are consumers, never panel producers", () => {
  const graph = orchestration.graph();
  assert.equal(graph.publish.rule, "same persisted panel/proof/logo artifacts; no UI-side production");
  assert.deepEqual(graph.panelReady.onEach, [
    "proof.start",
    "revisionstudio.publish",
    "panelpro.publish",
  ]);
});
