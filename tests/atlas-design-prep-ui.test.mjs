import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync(new URL("../app/src/pages/designpro/GenerateDesign.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../app/src/pages/DesignPanelProPremium.tsx", import.meta.url), "utf8");
const homeUi = readFileSync(new URL("../app/src/pages/DesignProAIHome.tsx", import.meta.url), "utf8");
const vehicleSelector = readFileSync(new URL("../app/src/components/tools/VehicleTypeSelector.tsx", import.meta.url), "utf8");
const atlas = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");

/**
 * PREP IS BACKGROUND WORK. IT MAY NEVER GATE GENERATE. (Owner, 2026-08-31:
 * "Remove the mandatory button after vehicle entry it buys nothing. Bad ui.")
 *
 * These tests used to assert the opposite -- that each intake page REQUIRED a
 * click before it would generate. That gate bought nothing measurable: the
 * prepared dimensions were never carried into the generation request, and
 * `resolveFlatAtlasPreviewDimensions` re-resolves server-side
 * (generation-worker.cjs:898) because browser-supplied geometry may never be
 * production authority. Measured on generation 7a1062f4, the whole window
 * between the request landing and Call 1 starting -- lease pickup included --
 * was ~6s against a 232s Call 1.
 *
 * What prep genuinely contributes is kept and still asserted here: the
 * GenerationID exists before submit so a technical retry is not a new design,
 * and an unsupported vehicle is refused early. Do not restore the gate.
 */
const INTAKES = [
  { name: "operating UI", source: ui },
  { name: "customer DesignProAI UI", source: customerUi },
  { name: "DesignProAI front door", source: homeUi },
];

test("no intake page gates generation on Design Prep", () => {
  for (const { name, source } of INTAKES) {
    assert.doesNotMatch(source, /Enter vehicle — begin Design Prep/,
      `${name}: the mandatory Design Prep button must not come back`);
    assert.doesNotMatch(source, /Required: press Enter/,
      `${name}: prep must not be presented as required`);
    assert.doesNotMatch(source, /before generating the design|before creating the design/,
      `${name}: prep must never block submit`);
    assert.doesNotMatch(source, /disabled=\{!designPrepIsCurrent/,
      `${name}: prep state must not disable the generate control`);
  }
});

test("every intake page prepares the vehicle on its own, silently", () => {
  for (const { name, source } of INTAKES) {
    assert.match(source, /beginDesignPrep\(\{ silent: true \}\)/,
      `${name}: prep must run itself in the background`);
    assert.match(source, /window\.setTimeout\([\s\S]{0,120}?beginDesignPrep\(\{ silent: true \}\)[\s\S]{0,40}?\d{3}\)/,
      `${name}: the background pass must be debounced, not fired per keystroke`);
    assert.match(source, /dpApi\.previewGenieDimensions\(vehicle\)/,
      `${name}: prep still reads the GENIE catalog`);
    assert.match(source, /silent\s*=\s*false/,
      `${name}: a background prep failure must be suppressible`);
  }
});

test("an identity still exists before submit, on every intake page", () => {
  // The one thing prep was actually worth. A transport failure is a retry
  // against the same design, not a new one, so the id cannot be minted first
  // by the server.
  assert.match(customerUi, /generationIdRef\.current \|\|= crypto\.randomUUID\(\)\.toLowerCase\(\)/);
  assert.match(ui, /const generationIdentity = designPrepGenerationId \|\| crypto\.randomUUID\(\)\.toLowerCase\(\)/);
  assert.match(ui, /generationId: generationIdentity/);
  assert.match(homeUi, /const generationIdentity = designPrepGenerationId \|\| crypto\.randomUUID\(\)\.toLowerCase\(\)/);
  assert.match(homeUi, /generationId: generationIdentity/);

  const prep = customerUi.slice(customerUi.indexOf("const beginDesignPrep"), customerUi.indexOf("const dimensionsState"));
  assert.doesNotMatch(prep, /catch \{[\s\S]*?invalidateDesignPrep\(\)/,
    "a technical Design Prep retry clears the GenerationID");
});

test("an unsupported vehicle is still refused before the brief is written", () => {
  assert.match(customerUi, /allowedTypes=\{\["car", "truck", "suv", "van"\]\}/);
  assert.match(vehicleSelector, /allowedTypes\?: VehicleType\[\]/);
  assert.match(customerUi, /flatFirstAtlasSupportedVehicleType/);
  assert.doesNotMatch(customerUi, /onClick=\{\(\) => setPipelineMode\("legacy"\)\}/);
  assert.doesNotMatch(customerUi, /initialDesignProPipelineMode/);
  assert.match(homeUi, /const pipelineMode: GenerationPipelineMode = FLAT_FIRST_ATLAS_PIPELINE_MODE/);
  assert.doesNotMatch(homeUi, /PipelineModeSelector|setPipelineMode\("legacy"\)/);
});

test("the operating UI exposes only the current A.T.L.A.S. graph", () => {
  assert.match(ui, /One A\.T\.L\.A\.S\. artifact graph/);
  assert.match(ui, /const pipelineMode: GenerationPipelineMode = FLAT_FIRST_ATLAS_PIPELINE_MODE/);
  assert.doesNotMatch(ui, /Legacy production|Choose how this run starts|flat-first test/);
  assert.doesNotMatch(ui, /Diagnostic isolation|Proofs-only test/);
});

test("persisted Call-1 panels retain their GENIE prep and deterministic lineage", () => {
  const persisted = atlas.slice(atlas.indexOf("const callOnePanelRecords"), atlas.indexOf("const topologyExample"));
  for (const field of [
    "surfaceSourceHash", "method", "deterministic", "genieManifestId",
    "genieManifestHash", "geometryAuthorityState", "geometrySourceRowId",
  ]) assert.match(persisted, new RegExp(`${field}: panel\\.${field}`));
});
