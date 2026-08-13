import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canary = readFileSync(new URL("../scripts/production-canary.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/production-canary.yml", import.meta.url), "utf8");

test("production canary uses the live standalone auth and schema contracts", () => {
  assert.match(canary, /auth\.admin\.createUser/);
  assert.match(canary, /signInWithPassword/);
  assert.match(canary, /designpro_qc_members/);
  assert.doesNotMatch(canary, /DESIGNPRO_CANARY_TENANT/);
  assert.match(canary, /stage_key,status/);
  assert.doesNotMatch(canary, /\.select\("stage,state/);
  assert.match(canary, /artifact_kind,surface_key,storage_path/);
  assert.doesNotMatch(canary, /\.select\("kind,storage_path/);
});

test("production workflow cannot start until Entice has actually completed", () => {
  const wait = canary.indexOf("await waitForEntice(evidence.enticeRunId)");
  const create = canary.indexOf('"create_designpro_production_workflow"');
  assert.ok(wait > -1, "missing Entice completion wait");
  assert.ok(create > wait, "production is created before Entice completes");
});

test("the July 24 canary carries the exact recovered F-250 trim geometry", () => {
  for (const literal of [
    "driver: { widthInches: 153, heightInches: 56 }",
    "passenger: { widthInches: 153, heightInches: 56 }",
    "hood: { widthInches: 71.5, heightInches: 56 }",
    "roof: { widthInches: 74.3, heightInches: 54.8 }",
    "front: { widthInches: 129, heightInches: 34 }",
    "rear: { widthInches: 76, heightInches: 54 }",
  ]) assert.ok(canary.includes(literal), literal);
  assert.match(canary, /DID-\$\{generationId\.replaceAll/);
});

test("canary uses the real QC gates and returns both Entice and Production artifacts", () => {
  assert.match(canary, /approve_designpro_human_gate/);
  assert.match(canary, /await_panelpro_preflight_qc/);
  assert.match(canary, /await_final_human_qc/);
  assert.match(canary, /collectArtifacts\(evidence\.enticeRunId, "entice"\)/);
  assert.match(canary, /collectArtifacts\(evidence\.productionRunId, "production"\)/);
  assert.match(canary, /productionOutputs === 18/);
  assert.match(canary, /productionUpscaledPanels === 6/);
});

test("workflow no longer accepts an old-project owner UUID as the new-project tenant", () => {
  assert.doesNotMatch(workflow, /tenant_key:/);
  assert.doesNotMatch(workflow, /CANARY_TENANT/);
  assert.match(workflow, /RUN_PRODUCTION_CANARY/);
  assert.match(workflow, /ServerAliveInterval=30/);
  assert.match(workflow, /designproai-runtime:\$sha/);
});
