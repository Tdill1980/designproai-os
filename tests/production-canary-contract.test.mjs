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
  assert.match(canary, /const ATLAS_FIRST_ATTEMPT_SLO_SECONDS = 60/);
  assert.match(canary, /const DRIVER_FIRST_ATTEMPT_SLO_SECONDS = 90/);
  assert.match(canary, /const ATLAS_FALLBACK_SLO_SECONDS = 120/);
  assert.match(canary, /const DRIVER_FALLBACK_SLO_SECONDS = 180/);
  // 2026-09-16: the Call-1 budget is per CONTRACT, not per run. `[1, 2]` was
  // written when six-surface was the only contract; a run that recovers exactly
  // as designed now spends up to two candidates on each of two contracts, and
  // the old total would have failed such a run -- discarding its master, its six
  // panels and every stage after them to convict a fail-over that worked. Both
  // halves of the real bound are still asserted, where they actually live.
  assert.match(canary, /const maxImageRequests = failedOver \? 4 : 2;/);
  assert.match(canary, /imageRequestCount < 1 \|\| imageRequestCount > maxImageRequests/);
  assert.match(canary, /Number\(atlasRow\.metadata\?\.masterAuthoringAttempts\) > 2/,
    "more than two candidates on ONE contract is still a budget that was never bounded");
  // The per-candidate allowance IS the step between the two constants above, so
  // n=1 and n=2 reproduce them exactly and a slow candidate is still convicted
  // at every n.
  assert.match(canary, /const ATLAS_SLO_SECONDS_PER_CANDIDATE = ATLAS_FALLBACK_SLO_SECONDS - ATLAS_FIRST_ATTEMPT_SLO_SECONDS;/);
  assert.match(canary, /const DRIVER_SLO_SECONDS_PER_CANDIDATE = DRIVER_FALLBACK_SLO_SECONDS - DRIVER_FIRST_ATTEMPT_SLO_SECONDS;/);
  assert.match(canary, /ATLAS_FIRST_ATTEMPT_SLO_SECONDS \+ extraCandidates \* ATLAS_SLO_SECONDS_PER_CANDIDATE/);
  assert.match(canary, /DRIVER_FIRST_ATTEMPT_SLO_SECONDS \+ extraCandidates \* DRIVER_SLO_SECONDS_PER_CANDIDATE/);
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

test("the canary binds the exact operator-validated GENIE row prepared before Call 1", () => {
  assert.match(canary, /previewGenieDimensionsFromCatalog/);
  assert.match(canary, /geometryAuthority\.operatorValidated !== true/);
  assert.match(canary, /geometryAuthority\.candidateId/);
  assert.match(canary, /evidence\.geniePrep\?\.sourceRowId/);
  assert.match(canary, /current GENIE preparation returned no immutable manifest hash/);
  assert.match(canary, /A\.T\.L\.A\.S\. did not use the GENIE manifest prepared before Call 1/);
  assert.doesNotMatch(canary, /designpro_vehicle_specs_universal/);
  assert.doesNotMatch(canary, /source_urls|validated_surfaces|legacy-geometry-evidence/);
  assert.doesNotMatch(canary, /July 24|July24|kfapjdyythzyvnpdeghu/);
  assert.doesNotMatch(workflow, /views_json|VIEWS_B64|July 24|July24|kfapjdyythzyvnpdeghu/);
  assert.match(canary, /DID-\$\{generationId\.replaceAll/);
});

test("the canary can resume one accepted request without spending another Calls 1-7 provider call", () => {
  assert.match(workflow, /resume_request_id:/);
  assert.match(workflow, /RESUME_REQUEST_ID='\$CANARY_RESUME_REQUEST_ID' bash -s/,
    "the workflow must forward the resume identity into the remote shell");
  assert.match(workflow, /--resume-request-id "\$RESUME_REQUEST_ID"/,
    "the remote command must consume the forwarded resume identity");
  assert.match(canary, /resuming accepted A\.T\.L\.A\.S\. request \$\{requestId\}; no provider call/);
  assert.match(canary, /resumable\.state !== "outputs_ready"/);
  assert.match(canary, /resumable\.owner_id/);
  assert.match(canary, /resumable\.request_input\?\.vehicle/);
  assert.match(canary, /resumeRequestId: RESUME_REQUEST_ID/);
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

// THE RUN SUCCEEDED; THE COURIER FAILED.
//
// The canary's evidence travels home as one base64 line on the remote step's
// stdout. A finished production run is ~5 GB -- six Topaz masters at 130-343 MB
// each, eighteen print outputs, the pack ZIP -- and pushing that through a
// single line is what produced "canary failed: data is too long" on a run whose
// artifacts all existed.
//
// The repair caps what is EXPORTED, never what is VERIFIED. Every artifact is
// still hashed from its real stored bytes, and every acceptance check keys on
// `hashVerified`, so nothing here makes the canary easier to pass.
test("the canary caps its export without weakening a single acceptance check", () => {
  assert.match(canary, /MAX_EXPORT_FILE_BYTES\s*=\s*48 \* 1024 \* 1024/);
  assert.match(canary, /MAX_EXPORT_TOTAL_BYTES\s*=\s*512 \* 1024 \* 1024/);
  // Bytes are hashed by STREAMING from the storage client's stream builder, not
  // from a Blob. Run 35134087621 wrote all 46 image artifacts and then threw
  // "data is too long" on the 4.91 GB pack, because `.download()` materialises
  // a Blob. The runtime hashes this same object the same streaming way.
  assert.match(canary, /function storageDownload\(client, storagePath\)/);
  assert.match(canary, /builder\?\.asStream === "function" \? builder\.asStream\(\) : builder/);
  assert.match(canary, /async function digestStorageBody\(data, keep\)/);
  assert.doesNotMatch(canary, /await blob\.arrayBuffer\(\)/,
    "the pack must never be materialised whole to be verified");
  // An omitted file says so, by name and reason, instead of going missing.
  assert.match(canary, /notExportedReason/);
  // The acceptance predicate still reads verified hashes, not exported files.
  assert.match(canary, /verifiedCount\("production", "output"\) === 18/);
  assert.match(canary, /verifiedCount\("production", "upscaled-panel"\) === 6/);
  assert.doesNotMatch(canary, /\.filter\(\(item\) => item\.exported === true\)/,
    "an acceptance count may never be computed from what happened to fit in the tarball");
});

test("a capped artifact is logged, never dereferenced -- the courier may not kill the run", () => {
  // Live: canary 35202369855 (2026-09-17) reached `wrapbox.deliver completed`,
  // wrote all 13 entice and 13 production files, and was then reported as a
  // FAILURE by its own logger -- "Cannot read properties of null (reading
  // 'length')" -- because the step() line read `bytes.length` unconditionally.
  // `bytes` is null for exactly the artifacts the export cap deliberately keeps
  // in storage, so the first print-resolution panel killed a successful run.
  //
  // Same shape as the "data is too long" note the cap itself was written for:
  // the run had succeeded; only the courier failed.
  const collect = canary.slice(
    canary.indexOf("async function collectArtifacts("),
    canary.indexOf("function assertOutputSet()"),
  );
  assert.ok(collect.length > 0, "collectArtifacts must be findable");

  // Every `bytes.` dereference inside the collector must sit behind a truth
  // test on `bytes` -- the ternary or the `if (bytes)` block.
  assert.doesNotMatch(collect, /^\s*step\(`wrote \$\{file\} \(\$\{\(bytes\.length/m,
    "step() must not dereference bytes unconditionally");
  assert.match(collect, /step\(bytes\s*\n?\s*\?\s*`wrote /,
    "the log line must branch on whether the artifact was exported");
  assert.match(collect, /not exported \(\$\{notExportedReason\}\)/,
    "a capped artifact must say so, with its reason, rather than going unmentioned");

  // And the acceptance evidence is untouched by which branch ran: the hash is
  // computed from the streamed bytes either way.
  assert.match(collect, /hashVerified: observedHash === artifact\.content_hash/);
});

test("the canary CONVICTS an element graph that never ran on a branded brief", () => {
  // Declaring the brand fields made the element subgraph COMPILE. It did not
  // make the canary notice when the subgraph then produced nothing -- so a null
  // elementGraph would have passed silently all over again, one layer up from
  // the defect that fix was written for.
  //
  // CLAUDE.md states the consequence: with the clean base on, Call 1 is asked
  // for a sheet with NO lettering, so `elementGraph: null` is a wrap that ships
  // with no company name. That is the state this must refuse.
  assert.match(canary, /const elementGraph = atlasRow\.metadata\?\.elementGraph;/,
    "the canary must read metadata.elementGraph");
  assert.match(canary, /if \(elementGraph === null \|\| elementGraph === undefined\) \{\s*\n\s*throw new Error\("the element graph never ran/,
    "a null element graph on a branded brief must THROW, not warn");

  // The three states are not interchangeable, and only the middle one is a
  // silent pass. A refusal back to Layer 0 is reported rather than thrown --
  // Layer 0 survived by design and the owner judges that sheet on pixels -- but
  // it may never go unmentioned.
  assert.match(canary, /step\(`WARNING: the element graph ran and its sheet was refused back to Layer 0/,
    "a refused composite must be reported, never silent");

  // Both flanks or the passenger ships bare. ELEMENT_SURFACES is exactly
  // driver and passenger, so a composite that placed on only one of them is a
  // half-branded wrap that every receipt would still call composited.
  assert.match(canary, /for \(const surface of \["driver", "passenger"\]\) \{/,
    "the composite must be asserted on BOTH flanks");
  assert.match(canary, /the element composite placed nothing on the \$\{surface\} flank/);

  // The assertion is scoped to a brief that actually declares branding, so a
  // dispatch that deliberately clears the fields still exercises the rest.
  assert.match(canary, /const declaredBranding = Boolean\(COMPANY_NAME \|\| COMPANY_PHONE \|\| COMPANY_WEBSITE\);/,
    "the element-graph assertion must be scoped to a branded brief");
});
