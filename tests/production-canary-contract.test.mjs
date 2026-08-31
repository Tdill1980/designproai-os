import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const canary = readFileSync(new URL("../scripts/production-canary.mjs", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../.github/workflows/production-canary.yml", import.meta.url), "utf8");
const atlasGraph = readFileSync(new URL("../docs/ATLAS_ONE_ARTIFACT_GRAPH.md", import.meta.url), "utf8");
const repositoryContract = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");

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
  // Deterministic master acceptance is the blocking gate. Semantic visual
  // judgement remains advisory and is not a Call-1 blocker.
  assert.match(canary, /masterQcPassed !== true/);
  assert.match(canary, /Semantic review is[\s\S]*advisory and is not a Call-1 blocker/);
  // The v1 gate itself, not the comment recording why it was removed.
  assert.doesNotMatch(canary, /designMaster\?\.creativeAssets/,
    "the v1 design-master assertion can never pass on the flat-first path");
  assert.doesNotMatch(canary, /^\s*designMaster,$/m,
    "the flat-first snapshot carries no designMaster to freeze");
});

test("the canary records display latency and defers its hard SLO gate until the full graph is checked", () => {
  assert.match(canary, /const ATLAS_SLO_SECONDS = 60/);
  assert.match(canary, /const DRIVER_SLO_SECONDS = 90/);
  assert.match(canary, /metadata\?\.geminiImageRequestCount\) !== 1/);
  assert.match(canary, /source_view_type,consumer_role,content_hash,byte_size,content_type,created_at/);
  assert.match(canary, /callOneTimings/);
  assert.match(canary, /atlasEdgeProvenance/);
  assert.match(canary, /acceptedViews/);
  assert.match(canary, /refusedViews/);
  assert.match(canary, /view\.source_view_type === "side"/);
  assert.match(canary, /basis: "request-created-to-durable-artifact"/);
  assert.match(canary, /latency SLO failed/);
  assert.match(canary, /latency SLO missed; recording the miss and continuing through the full graph before final acceptance/);

  const latencyEvidence = canary.indexOf("evidence.latency = {");
  const renderAssets = canary.indexOf("const renderAssets = {}", latencyEvidence);
  const enticeArtifacts = canary.indexOf('collectArtifacts(evidence.enticeRunId, "entice")');
  const productionArtifacts = canary.indexOf('collectArtifacts(evidence.productionRunId, "production")');
  const outputGate = canary.indexOf("assertOutputSet();", productionArtifacts);
  const latencyGate = canary.indexOf("assertLatencySlo();", outputGate);
  assert.ok(latencyEvidence > -1 && renderAssets > latencyEvidence, "latency evidence must be recorded before render handoff");
  assert.doesNotMatch(canary.slice(latencyEvidence, renderAssets), /throw new Error\(`latency SLO failed/,
    "a latency miss must not abort Calls 1-7 before downstream execution");
  assert.ok(enticeArtifacts > -1 && productionArtifacts > enticeArtifacts,
    "both workflow artifact sets must be collected");
  assert.ok(outputGate > productionArtifacts && latencyGate > outputGate,
    "the hard latency gate must run only after the downstream artifact gate");
});

test("production is server-created exactly once after Entice completes, with a bounded visibility poll", () => {
  const wait = canary.indexOf("const completedEntice = await waitForEntice(evidence.enticeRunId)");
  const resolve = canary.indexOf("await automaticProductionRun(enticePackId, evidence.enticeRunId)");
  assert.ok(wait > -1, "missing Entice completion wait");
  assert.ok(resolve > wait, "automatic Production workflow is resolved before Entice completes");
  assert.doesNotMatch(canary, /"create_designpro_production_workflow"/,
    "the canary must not duplicate the workflow pack.activate creates server-side");
  assert.match(canary, /const MAX_AUTOMATIC_PRODUCTION_POLLS = 12/);
  assert.match(canary, /expected exactly one automatic Production workflow/);

  const lookupStart = canary.indexOf("async function automaticProductionRun(");
  const lookupEnd = canary.indexOf("async function confirmOwnerPromotionEntitlement(", lookupStart);
  const lookup = canary.slice(lookupStart, lookupEnd);
  const duplicateGate = lookup.indexOf("if (rows.length > 1)");
  const foundGate = lookup.indexOf("if (rows.length === 1)");
  const retryWait = lookup.indexOf("setTimeout(resolve, POLL_INTERVAL_MS)");
  const exhausted = lookup.lastIndexOf("found 0 after");
  assert.match(lookup, /for \(let poll = 0; poll < MAX_AUTOMATIC_PRODUCTION_POLLS; poll \+= 1\)/);
  assert.match(canary, /\.select\("id,workflow_type,status,results,error,entice_pack_id,updated_at"\)/);
  assert.match(canary, /const enticePackId = String\(completedEntice\?\.entice_pack_id \|\| ""\)/);
  assert.match(canary, /completed Entice workflow carries no canonical pack identity/);
  assert.match(lookup, /\.eq\("entice_pack_id", enticePackId\)/);
  assert.doesNotMatch(lookup, /\.eq\("entice_pack_id",\s*enticeRunId\)/,
    "the Production foreign key is the durable Entice pack ID, never the Entice workflow run ID");
  assert.match(lookup, /\.select\("id,workflow_type,status,entice_pack_id,results"\)/);
  assert.match(lookup, /rows\[0\]\.results\?\.sourceEnticeRunId/);
  assert.match(lookup, /sourceEnticeRunId !== String\(enticeRunId\)\.toLowerCase\(\)/);
  assert.match(lookup, /belongs to Entice run/);
  assert.ok(duplicateGate > -1 && duplicateGate < retryWait,
    "duplicate server-created workflows must fail before any retry sleep");
  assert.ok(foundGate > duplicateGate && foundGate < retryWait,
    "exactly one server-created workflow must return without sleeping again");
  assert.ok(retryWait > foundGate && exhausted > retryWait,
    "zero rows must retry before the bounded terminal failure");
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
  assert.match(canary, /productionFlatProofs: count\("production", "flat-proof"\)/);
  assert.match(canary, /Cardinality is counted BEFORE verification/);
  assert.match(canary, /const count = \(run, kind\) => rows\(run, kind\)\.length/);
  assert.match(canary, /hashVerified: false/,
    "an unreadable artifact must remain in total cardinality and fail verification");
  assert.match(canary, /checks\.enticeFlatProofs === 1/);
  assert.match(canary, /checks\.productionFlatProofs === 1/);
  assert.match(canary, /checks\.requiredHashesVerified/);
  assert.match(canary, /checks\.productionFlatProofExactCopy/);
  assert.match(canary, /productionProof\.contentHash === enticeProof\.contentHash/);
  assert.match(canary, /productionProof\.metadata\?\.sourceContentHash === enticeProof\.contentHash/);
  assert.match(canary, /productionProof\.metadata\?\.sourceStoragePath === enticeProof\.storagePath/);
  assert.match(canary, /productionProof\.metadata\?\.sourceEnticeRunId === evidence\.enticeRunId/);
  assert.match(canary, /productionOutputs === 18/);
  assert.match(canary, /productionUpscaledPanels === 6/);
  assert.match(workflow, /one Entice Call 8 proof and one exact Production copy/);
  assert.doesNotMatch(workflow, /customer 2D proof \+ immutable flat layout/);
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

test("canonical markdown records the explicit diagnostic-canary exception without replacing DCA", () => {
  for (const document of [atlasGraph, repositoryContract]) {
    assert.doesNotMatch(document, /No canary is permitted/i);
    assert.match(document, /do not run speculative canaries/i);
    assert.match(document, /owner\s+explicitly\s+authorized[\s\S]{0,120}(?:new|fresh|current)[\s\S]{0,40}production canary/i);
  }
  assert.match(atlasGraph, /33389124918/);
  assert.match(atlasGraph, /083d2a70-edac-4e75-9caa-1336542baf7c/);
  assert.match(atlasGraph, /(?:Earlier\s+)?owner-authorized diagnostic production canary #35/i);
  assert.match(atlasGraph, /33379526286/);
  assert.match(atlasGraph, /51ea0e06-2ceb-460a-8756-54888a7832a8/);
  assert.match(atlasGraph, /early latency acceptance gate, before Call 8/);
  assert.match(atlasGraph, /final acceptance still requires live[\s\S]{0,80}one customer-style production lineage/i);
});
