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

// A CANARY THAT DOES NOT RUN A.T.L.A.S. PROVES NOTHING ABOUT PRODUCTION.
//
// It submitted `designpro.calls-1-7-input.v1` -- the legacy replay contract that
// hands the runtime seven pre-existing render URLs -- and then asserted
// `receipt.designMaster`. No master was authored, no zone cut, no proof
// projected, and the assertion could never pass because the v1 path records no
// design master at all. Live run 32886592846 (2026-08-25) died exactly there,
// after reporting green through every stage before it, while every real
// generation on the server was running v3.
test("the canary exercises the A.T.L.A.S. v3 contract, not the legacy replay", () => {
  assert.match(canary, /contractVersion: "designpro\.calls-1-7-input\.v3"/);
  assert.match(canary, /pipelineMode: "flat-first-atlas-v1"/);
  assert.match(canary, /"create_designpro_flat_first_generation_request"/);
  assert.doesNotMatch(canary, /contractVersion: "designpro\.calls-1-7-input\.v1"/,
    "the canary must not submit the legacy replay contract");
  assert.doesNotMatch(canary, /"create_designpro_generation_request"/,
    "the v1 intake RPC cannot create a flat-first request");
  // v3 authors from a brief and rejects the input outright without one.
  assert.match(canary, /brief: DESIGN_BRIEF/);
  assert.match(canary, /designName: DESIGN_NAME/);
});

test("the canary proves a persisted A.T.L.A.S. master, not just a receipt field", () => {
  // The receipt is written by the worker under test, so a canary that trusted it
  // alone would let a run assert its own success. The revision row is the
  // durable artifact every downstream consumer reads, and it exists only after
  // the master passed acceptance.
  assert.match(canary, /from\("designpro_flat_atlas_revisions"\)/);
  assert.match(canary, /no A\.T\.L\.A\.S\. revision was persisted/);
  assert.match(canary, /master_content_hash !== flatAtlas\.master\.contentHash/);
  assert.match(canary, /prompt_version !== flatAtlas\.promptVersion/);
  // The master QC gate is the reason a defective sheet never reaches a panel.
  // Accepting a revision without it would report green on the one failure this
  // whole path exists to prevent.
  assert.match(canary, /masterQcPassed !== true/);
  // The v1 gate itself, not the comment recording why it was removed.
  assert.doesNotMatch(canary, /designMaster\?\.creativeAssets/,
    "the v1 design-master assertion can never pass on the flat-first path");
  assert.doesNotMatch(canary, /^\s*designMaster,$/m,
    "the flat-first snapshot carries no designMaster to freeze");
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
