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

test("the A.T.L.A.S. banner reports customer progress without implementation details", () => {
  const premium = read("app/src/pages/DesignPanelProPremium.tsx");
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const gateway = read("gateway/src/server.mjs");
  assert.match(premium, /initialDesignProPipelineMode\(briefState\?\.pipelineMode, location\.search\)/);
  assert.match(premium, /A\.T\.L\.A\.S\. Preview/);
  assert.match(premium, /Preview started/);
  assert.doesNotMatch(premium, /Server accepted A\.T\.L\.A\.S\. v3/);
  assert.doesNotMatch(premium, /Google-grounded vehicle proportions/);
  assert.doesNotMatch(premium, /Gemini paints one canonical/);
  assert.match(hook, /generation_pipeline_mode_mismatch/);
  assert.match(hook, /setStandaloneRequestId\(null\)/);
  assert.match(gateway, /requiredPipelineMode !== "flat-first-atlas-v1"/);
  assert.match(gateway, /pipelineMode: acceptedPipelineMode/);
});

test("the guarded create page defaults to DesignPanel and opens A.T.L.A.S. only explicitly", () => {
  const selector = read("app/src/lib/designpro-flat-first.ts");
  const home = read("app/src/pages/DesignProAIHome.tsx");
  assert.match(selector, /if \(!FLAT_FIRST_ATLAS_UI_ENABLED\) return "legacy"/);
  assert.match(selector, /flatFirstAtlasRequestedBySearch\(search\)/);
  assert.match(selector, /return "legacy";\s*\n}/);
  assert.match(home, /initialDesignProPipelineMode\(/);
  assert.match(home, /setPipelineMode\("legacy"\)/);
});

test("the customer DesignPanel page enters the one production chain but A.T.L.A.S. stays isolated", () => {
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const standardHandoff = hook.match(
    /if \(acceptedPipelineMode !== FLAT_FIRST_ATLAS_PIPELINE_MODE\) \{[\s\S]*?\n      \}/,
  )?.[0] || "";

  assert.match(standardHandoff, /finished\.handoffReady !== true/);
  assert.match(standardHandoff, /await handoffGeneration\(request\.requestId\)/);
  assert.match(standardHandoff, /handoff\.generationId !== request\.generationId/);
  assert.doesNotMatch(
    hook.match(/if \(acceptedPipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE\) \{[\s\S]*?\n      \}/)?.[0] || "",
    /handoffGeneration/,
  );
});

test("A.T.L.A.S. reveals the immutable master and streams signed proof views without new generation calls", () => {
  const adapter = read("app/src/lib/designpanelpro-standalone-adapter.ts");
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const premium = read("app/src/pages/DesignPanelProPremium.tsx");
  assert.match(adapter, /onViews\?: \(views: GenerationView\[\]\)/);
  assert.match(adapter, /viewCount > observedViewCount/);
  assert.match(adapter, /dpApi\.listGenerationViews\(requestId\)/);
  assert.match(adapter, /signedUrlsNeedRefresh/);
  assert.match(adapter, /4 \* 60_000/);
  assert.match(hook, /onViews: async \(progressiveViews\)/);
  assert.match(hook, /applyGeneratedViews\(progressiveViews, true\)/);
  assert.match(premium, /const atlasMasterPreviewUrl/);
  assert.match(premium, /pipelineActive && !renderError && !savedDriverDisplayUrl/);
  assert.match(premium, /savedDriverDisplayUrl \|\| \(!isFlatFirstDiagnostic \? baseDisplayUrl : null\)/);
  assert.match(premium, /latestFlatAtlas\?\.masterUrl/);
  assert.match(premium, /Your A\.T\.L\.A\.S\. flattened top-view design is ready/);
  assert.match(premium, /Flattened top-view design/);
  assert.match(premium, /previewDisplayUrl = mainDisplayUrl \|\| atlasMasterPreviewUrl/);
  assert.match(premium, /atlasReady=\{Boolean\(latestFlatAtlas\)\}/);
  assert.match(premium, /Production ordering is unavailable in Preview mode/);
  assert.doesNotMatch(premium, /paid ProductionPack slicing stays locked/);
});

test("the progress surface reports server state instead of a fake elapsed percentage", () => {
  const progress = read("app/src/components/designpanelpro/DesignPipelineProgress.tsx");
  assert.doesNotMatch(progress, /96 \* \(1 - Math\.exp/);
  assert.match(progress, /requestState\?: GenerationRequestState/);
  assert.match(progress, /proof views complete/);
  assert.match(progress, /safely return to this page later/);
  assert.match(progress, /Creating your A\.T\.L\.A\.S\. design/);
  assert.doesNotMatch(progress, /Gemini is painting/);
  assert.doesNotMatch(progress, /canonical flattened A\.T\.L\.A\.S\. master/);
  assert.match(progress, /atlasProofStatus/);
  assert.doesNotMatch(progress, /renders here in your browser/);
});
