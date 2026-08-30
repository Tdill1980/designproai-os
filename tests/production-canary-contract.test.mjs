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

test("the canary fails unless one-call A.T.L.A.S. and Driver meet their display SLOs", () => {
  assert.match(canary, /const ATLAS_SLO_SECONDS = 60/);
  assert.match(canary, /const DRIVER_SLO_SECONDS = 90/);
  assert.match(canary, /metadata\?\.geminiImageRequestCount\) !== 1/);
  assert.match(canary, /source_view_type,consumer_role,content_hash,byte_size,content_type,created_at/);
  assert.match(canary, /view\.source_view_type === "side"/);
  assert.match(canary, /basis: "request-created-to-durable-artifact"/);
  assert.match(canary, /latency SLO failed/);
});

test("production is server-created exactly once after Entice completes", () => {
  const wait = canary.indexOf("await waitForEntice(evidence.enticeRunId)");
  const resolve = canary.indexOf("await automaticProductionRun(evidence.enticeRunId)");
  assert.ok(wait > -1, "missing Entice completion wait");
  assert.ok(resolve > wait, "automatic Production workflow is resolved before Entice completes");
  assert.doesNotMatch(canary, /"create_designpro_production_workflow"/,
    "the canary must not duplicate the workflow pack.activate creates server-side");
  assert.match(canary, /expected exactly one automatic Production workflow/);
});

test("WrapBox recipient data is registered and bound only after the purchase entitlement", () => {
  const handoff = canary.indexOf('"handoff_designpro_generation_to_production"');
  const entice = canary.indexOf("await waitForEntice(evidence.enticeRunId)");
  const entitlement = canary.indexOf("await confirmOwnerPromotionEntitlement(generationId, evidence.enticeRunId)");
  const recipient = canary.indexOf("await registerRecipient(operatorId, generationId)");
  const binding = canary.indexOf('"bind_designpro_revision_fulfillment"');
  const production = canary.indexOf("await waitForProduction(operator, operatorId, evidence.productionRunId, designId)");
  assert.ok(handoff > -1 && entice > handoff, "Entice must use the unbound server handoff");
  assert.ok(entitlement > entice, "the entitlement must follow Entice completion");
  assert.ok(recipient > entitlement, "recipient registration must follow the entitlement");
  assert.ok(binding > recipient, "fulfillment binding must follow recipient registration");
  assert.ok(production > binding, "Production may run only after purchase and recipient binding");
  assert.doesNotMatch(canary, /save_designpro_revision_source/,
    "the canary must not replace the unbound handoff snapshot with early fulfillment data");
});

test("the canary crosses purchase with one real Generation-bound owner promotion entitlement", () => {
  const entitlement = canary.indexOf("await confirmOwnerPromotionEntitlement(generationId, evidence.enticeRunId)");
  const productionWait = canary.indexOf("await waitForProduction(operator, operatorId, evidence.productionRunId, designId)");
  assert.ok(entitlement > -1 && productionWait > entitlement,
    "the real entitlement must be persisted before the canary waits for paid production");
  assert.match(canary, /"confirm_designpro_purchase"/);
  assert.match(canary, /p_product_type: "print_pack_entitlement"/);
  assert.match(canary, /p_amount_cents: 0/);
  assert.match(canary, /p_promotion_code: OWNER_PROMOTION_CODE/);
  assert.match(canary, /p_discount_cents: OWNER_PROMOTION_DISCOUNT_CENTS/);
  assert.match(canary, /from\("designpro_purchase_entitlements"\)/);
  assert.match(canary, /row\.entice_run_id !== enticeRunId \|\| row\.generation_id !== generationId/);
  assert.match(canary, /without[\s\S]*a Stripe dependency/);
  assert.doesNotMatch(canary, /paid\s*=\s*true|paid:\s*true/);
});

test("the canary prepares geometry from the current GENIE catalog only", () => {
  assert.match(canary, /previewGenieDimensionsFromCatalog/);
  assert.match(canary, /genie-panelizer-catalog/);
  assert.match(canary, /current GENIE preparation returned no immutable manifest hash/);
  assert.match(canary, /A\.T\.L\.A\.S\. did not use the GENIE manifest prepared before Call 1/);
  assert.doesNotMatch(canary, /designpro_vehicle_specs_universal/);
  assert.doesNotMatch(canary, /source_urls|validated_surfaces|legacy-geometry-evidence/);
  assert.doesNotMatch(canary, /July 24|July24|kfapjdyythzyvnpdeghu/);
  assert.doesNotMatch(workflow, /views_json|VIEWS_B64|July 24|July24|kfapjdyythzyvnpdeghu/);
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
  assert.match(workflow, /atlas-canary-customer@designproai\.com/);
  assert.doesNotMatch(workflow, /inputs\.customer_email/);
  assert.match(workflow, /\[\[ \$sha == "\$EXPECTED_SHA" \]\]/);
});
