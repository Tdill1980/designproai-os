import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the worker preserves legacy retry contracts but never auto-requeues A.T.L.A.S.", () => {
  const worker = read("runtime/generation-worker.cjs");
  assert.match(worker, /let enteredFlatFirst = false/);
  assert.match(worker, /enteredFlatFirst = isFlatFirst/);
  assert.match(worker, /p_retryable:\s*enteredFlatFirst \? false : error\?\.retryable !== false/);
  assert.match(worker, /const retryable = result\.requiresExplicitResume !== true/);
  assert.match(worker, /generation_views_incomplete[\s\S]*?p_retryable:\s*false/);
  assert.doesNotMatch(worker, /generation_slots_failed[\s\S]{0,500}?p_retryable:\s*true/);
});

test("Calls 1-7 do not wait on production geometry; production remains strict", () => {
  const worker = read("runtime/generation-worker.cjs");
  const claimant = read("runtime/designpro-standalone-claimant.cjs");
  const flatFirstBranch = worker.match(/if \(isFlatFirst\) \{[\s\S]*?\n      \}/)?.[0] || "";
  assert.match(flatFirstBranch, /resolveFlatAtlasPreviewDimensions/);
  assert.doesNotMatch(flatFirstBranch, /resolveOrQueueUniversalDimensions/);
  assert.doesNotMatch(worker, /resolveOrQueueUniversalDimensions/);
  assert.match(claimant, /resolveOrQueueUniversalDimensions\(sb, vehicle, stage, run\.id\)/);
});

test("the browser stops an old retrying request on fail-closed geometry", () => {
  const adapter = read("app/src/lib/designpanelpro-standalone-adapter.ts");
  assert.match(adapter, /NON_RETRYABLE_GENERATION_CODES/);
  assert.match(adapter, /genie_dimension_validation_required/);
  assert.match(adapter, /terminalGenerationFailureCode\(state/);
});

test("A.T.L.A.S. per-view regeneration fails closed and tells the customer to start a new run", () => {
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const premium = read("app/src/pages/DesignPanelProPremium.tsx");
  const guardedPage = read("app/src/pages/designpro/GenerateDesign.tsx");
  const retry = hook.slice(
    hook.indexOf("const retryFailedView"),
    hook.indexOf("const saveDesignJob"),
  );

  assert.match(retry, /activePipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE/);
  assert.match(retry, /Start a new Precision run/);
  assert.ok(
    retry.indexOf("activePipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE")
      < retry.indexOf("regenerateDesignPanelView"),
    "the browser guard must run before its regeneration request",
  );
  assert.match(premium, /isFlatFirstDiagnostic \? \([\s\S]*Start a new Precision run\.[\s\S]*\) : \([\s\S]*Retry This View/);
  assert.match(guardedPage, /Start a new A\.T\.L\.A\.S\. run/);
  assert.doesNotMatch(guardedPage, /Edit the canonical master first/);
});

test("legacy Atlas owner-read failures clear every preview and never recover signed views", () => {
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const premium = read("app/src/pages/DesignPanelProPremium.tsx");
  const gateway = read("gateway/src/server.mjs");
  const failure = hook.slice(
    hook.indexOf("} catch (error: any) {", hook.indexOf("const runStandaloneGeneration")),
    hook.indexOf("const generateRender"),
  );

  assert.match(hook, /flat_first_atlas_new_run_required/);
  assert.match(hook, /generation_atlas_lineage_invalid/);
  assert.match(
    failure,
    /if \(requiresNewAtlasRun \|\| freshAtlasMasterQcFailure\) clearUntrustedAtlasProofState\(\)/,
  );
  // RECOVERY NOW RUNS FIRST, AND THE VERDICT DEPENDS ON WHAT IT FOUND.
  //
  // The guard used to read `if (acceptedRequest && !requiresNewAtlasRun)`,
  // which meant a lineage refusal wiped the design and then never looked for
  // the views. That was right for a genuinely untrusted lineage and wrong for a
  // run that COMPLETED with a short proof set: canary 990d4b62 (2026-08-27)
  // had an accepted master, six panels and five accepted views, and the
  // customer got "cannot be reused" over a blank card.
  //
  // The invariant this test exists to protect is unchanged and asserted below:
  // when the lineage really is untrusted, everything is cleared and NOTHING is
  // applied. What changed is that "untrusted" is now decided by whether this
  // generation owns any usable view, instead of assumed from the error alone.
  assert.match(failure, /if \(acceptedRequest && !freshAtlasMasterQcFailure\)/);
  assert.match(failure, /const requiresNewAtlasRun = atlasNewRunRequired\(error\) && !usableViews\.length;/);
  assert.match(failure, /if \(usableViews\.length && !requiresNewAtlasRun && acceptedRequest\)/);
  // A cleared lineage must never reach the preview setters.
  const applyBlock = failure.slice(
    failure.indexOf("if (usableViews.length && !requiresNewAtlasRun && acceptedRequest)"),
    failure.indexOf("const missingSides"),
  );
  assert.ok(applyBlock.includes("applyGeneratedViews(recoveredViews)"));
  assert.ok(
    !/requiresNewAtlasRun\s*\?/.test(applyBlock),
    "the apply block is gated by the flag, never branching inside it",
  );
  assert.match(hook, /This saved proof set cannot be reused\. Start a new Precision run\./);
  assert.match(hook, /freshAtlasMasterQcFailure/);
  assert.match(hook, /No proof set was saved\. Start a new Precision run\./);
  const clear = hook.slice(
    hook.indexOf("const clearUntrustedAtlasProofState"),
    hook.indexOf("// Persona pipeline timer"),
  );
  for (const reset of [
    "setGeneratedImageUrl(null)", "setVisualizationId(null)", "setAllViews([])",
    "setFailedViews([])", "setFlatProofUrl(null)", "setStandaloneRequestId(null)",
    "setGenerationRequestState(null)", "setPersonaHeroUrl(null)",
    "setPersonaAllViews({})", "setPersonaFailedShots([])",
  ]) assert.match(clear, new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(premium, /renderError \|\| atlasNewRunRequired/);
  assert.match(premium, /generationError\?\.includes\("Start a new Precision run"\)/);
  assert.match(premium, /Start New Precision Run/);
  assert.match(gateway, /request\.failureCode === ATLAS_NEW_RUN_REQUIRED[\s\S]*return json\(res, 409/);
  assert.match(gateway, /designpro_generation_view_paths[\s\S]*includes\(ATLAS_NEW_RUN_REQUIRED\)[\s\S]*status: 409/);
});

test("the customer page exposes the current A.T.L.A.S. graph without a legacy selector", () => {
  const premium = read("app/src/pages/DesignPanelProPremium.tsx");
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const gateway = read("gateway/src/server.mjs");
  assert.match(premium, /const pipelineMode: GenerationPipelineMode = FLAT_FIRST_ATLAS_PIPELINE_MODE/);
  assert.doesNotMatch(premium, /initialDesignProPipelineMode/);
  assert.doesNotMatch(premium, /setPipelineMode\("legacy"\)/);
  assert.match(premium, /A\.T\.L\.A\.S\. graph active/);
  assert.doesNotMatch(premium, /A\.T\.L\.A\.S\. Preview/);
  assert.doesNotMatch(premium, /Server accepted A\.T\.L\.A\.S\. v3/);
  assert.doesNotMatch(premium, /Google-grounded vehicle proportions/);
  assert.doesNotMatch(premium, /Gemini paints one canonical/);
  assert.match(hook, /generation_pipeline_mode_mismatch/);
  assert.match(hook, /setStandaloneRequestId\(null\)/);
  assert.match(gateway, /requiredPipelineMode !== "flat-first-atlas-v1"/);
  assert.match(gateway, /pipelineMode: acceptedPipelineMode/);
});

// Create Design sends A.T.L.A.S. This test used to assert the opposite --
// that the page "defaults to DesignPanel and opens A.T.L.A.S. only
// explicitly" -- which is the diagnostic framing RULE 0.17 and RULE 0.21
// retired. The cost was measurable: every live customer request on
// 2026-08-24/25 arrived as contract v2 with a null pipelineMode and died in
// `generation_slots_failed`, while all three atlas masters showed zero
// production runs. The default is the whole mechanism, so it is locked here.
test("every DesignProAI intake is current-only A.T.L.A.S. with no legacy fallback", () => {
  const premium = read("app/src/pages/DesignPanelProPremium.tsx");
  const home = read("app/src/pages/DesignProAIHome.tsx");
  assert.match(premium, /const pipelineMode: GenerationPipelineMode = FLAT_FIRST_ATLAS_PIPELINE_MODE/);
  assert.match(home, /const pipelineMode: GenerationPipelineMode = FLAT_FIRST_ATLAS_PIPELINE_MODE/);
  assert.doesNotMatch(premium, /initialDesignProPipelineMode|setPipelineMode\("legacy"\)/);
  assert.doesNotMatch(home, /initialDesignProPipelineMode|setPipelineMode\("legacy"\)|PipelineModeSelector/);
  const vehicleChoices = home.slice(home.indexOf("const VEHICLE_TYPES"), home.indexOf("const CAPABILITIES"));
  assert.doesNotMatch(vehicleChoices, /Motorcycle|Trailer|Bus|RV/);
});

// A.T.L.A.S. is no longer isolated from production (owner decision
// 2026-08-23): its button must reach the existing file-output pipeline so the
// Call 8 proof and Call 9 panels exist to validate. What stays isolated is
// per-view regeneration -- one master owns the whole proof set.
test("the customer DesignPanel page enters the one production chain on both pipelines", () => {
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");

  assert.match(hook, /finished\.handoffReady !== true/);
  assert.match(hook, /await handoffGeneration\(request\.requestId\)/);
  assert.match(hook, /handoff\.generationId !== request\.generationId/);
  assert.doesNotMatch(
    hook,
    /if \(acceptedPipelineMode !== FLAT_FIRST_ATLAS_PIPELINE_MODE\) \{[\s\S]*?handoffGeneration/,
    "the A.T.L.A.S. handoff exclusion must not come back",
  );
  // The Call 8 proof and the production job are what "validation of file
  // output" means on this page, so neither may be hidden by pipeline mode.
  assert.doesNotMatch(
    hook,
    /queryKey: \["designpro-customer-proof"[\s\S]{0,200}?activePipelineMode !== FLAT_FIRST_ATLAS_PIPELINE_MODE/,
  );
  assert.doesNotMatch(
    hook,
    /queryKey: \["designpro-production-job"[\s\S]{0,200}?activePipelineMode !== FLAT_FIRST_ATLAS_PIPELINE_MODE/,
  );
  // One master owns the A.T.L.A.S. proof set; a single view is never re-rolled.
  assert.match(hook, /Proof views are locked to one master/);
});

test("A.T.L.A.S. streams signed proof views without new generation calls, and never shows the customer the master", () => {
  const adapter = read("app/src/lib/designpanelpro-standalone-adapter.ts");
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const premium = read("app/src/pages/DesignPanelProPremium.tsx");
  assert.match(adapter, /onViews\?: \(views: GenerationView\[\]\)/);
  assert.match(adapter, /viewCount > observedViewCount/);
  assert.match(adapter, /dpApi\.listGenerationViews\(requestId\)/);
  assert.match(adapter, /signedUrlsNeedRefresh/);
  assert.match(adapter, /4 \* 60_000/);
  assert.match(hook, /onViews: async \(progressiveViews\)/);
  assert.match(hook, /applyGeneratedViews\(progressiveViews\)/);
  assert.match(hook, /pickPrimaryProofView\(progressiveViews\)/);
  assert.match(premium, /savedDriverDisplayUrl \|\| \(!isFlatFirstDiagnostic \? baseDisplayUrl : null\)/);
  assert.match(premium, /atlasReady=\{Boolean\(latestFlatAtlas\)\}/);
  // The customer sees the seven 3D proofs, and in RevisionStudio the six panels
  // cut from the master. The canonical master and the vehicle layout guide are
  // production instruments: they belong to the design team on the PanelPro
  // Studio board, with their version history, and never to the buyer.
  assert.doesNotMatch(premium, /atlasMasterPreviewUrl/);
  assert.doesNotMatch(premium, /latestFlatAtlas\?\.masterUrl/);
  assert.doesNotMatch(premium, /Your A\.T\.L\.A\.S\. flattened top-view design is ready/);
  assert.doesNotMatch(premium, /Flattened top-view design/);
  assert.doesNotMatch(premium, /A\.T\.L\.A\.S\. flattened top-view master/);
  assert.doesNotMatch(premium, /Vehicle layout/);
  assert.match(premium, /previewDisplayUrl = mainDisplayUrl;/);
  // An A.T.L.A.S. run is orderable. It produced the design and its six panels,
  // so refusing the order was the last thing making the path a dead end.
  assert.doesNotMatch(premium, /Production ordering is unavailable/);
  assert.doesNotMatch(
    premium,
    /mainDisplayUrl && !isFlatFirstDiagnostic/,
    "the Order Production Pack button must not be hidden from A.T.L.A.S. again",
  );
  assert.doesNotMatch(premium, /paid ProductionPack slicing stays locked/);
});

test("the progress surface reports server state instead of a fake elapsed percentage", () => {
  const progress = read("app/src/components/designpanelpro/DesignPipelineProgress.tsx");
  assert.doesNotMatch(progress, /96 \* \(1 - Math\.exp/);
  assert.match(progress, /requestState\?: GenerationRequestState/);
  assert.match(progress, /proof views complete/);
  assert.match(progress, /safely return to this page later/);
  assert.match(progress, /Creating your precision design/);
  assert.doesNotMatch(progress, /Gemini is painting/);
  assert.doesNotMatch(progress, /canonical flattened A\.T\.L\.A\.S\. master/);
  assert.doesNotMatch(progress, /A\.T\.L\.A\.S\./);
  assert.match(progress, /atlasProofStatus/);
  assert.doesNotMatch(progress, /renders here in your browser/);
});
