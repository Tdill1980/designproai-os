import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ui = readFileSync(new URL("../app/src/pages/designpro/GenerateDesign.tsx", import.meta.url), "utf8");
const customerUi = readFileSync(new URL("../app/src/pages/DesignPanelProPremium.tsx", import.meta.url), "utf8");
const homeUi = readFileSync(new URL("../app/src/pages/DesignProAIHome.tsx", import.meta.url), "utf8");
const vehicleSelector = readFileSync(new URL("../app/src/components/tools/VehicleTypeSelector.tsx", import.meta.url), "utf8");
const atlas = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");

test("the operating UI requires explicit vehicle Design Prep", () => {
  assert.match(ui, /Enter vehicle — begin Design Prep/);
  assert.match(ui, /Beginning Design Prep — pulling vehicle dimensions…/);
  assert.match(ui, /dpApi\.previewGenieDimensions\(vehicle\)/);
  assert.match(ui, /if \(!designPrepIsCurrent\)/);
  assert.match(ui, /Press “Enter vehicle — begin Design Prep” before generating the design/);
});

test("the customer DesignProAI UI requires the same explicit vehicle handoff", () => {
  assert.match(customerUi, /Enter vehicle — begin Design Prep/);
  assert.match(customerUi, /Beginning Design Prep — pulling vehicle dimensions…/);
  assert.match(customerUi, /if \(!designPrepIsCurrent\)/);
  assert.match(customerUi, /allowedTypes=\{\["car", "truck", "suv", "van"\]\}/);
  assert.match(vehicleSelector, /allowedTypes\?: VehicleType\[\]/);
  assert.doesNotMatch(customerUi, /onClick=\{\(\) => setPipelineMode\("legacy"\)\}/);
  assert.doesNotMatch(customerUi, /initialDesignProPipelineMode/);
});

test("the DesignProAI front door starts prep before opening the studio", () => {
  assert.match(homeUi, /Enter vehicle — begin Design Prep/);
  assert.match(homeUi, /Beginning Design Prep — pulling vehicle dimensions…/);
  assert.match(homeUi, /dpApi\.previewGenieDimensions\(vehicle\)/);
  assert.match(homeUi, /if \(!designPrepIsCurrent\)/);
  assert.match(homeUi, /disabled=\{!designPrepIsCurrent \|\| designPrepBusy\}/);
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
