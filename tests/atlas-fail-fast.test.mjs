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

test("only flat-first uses provisional geometry; legacy and production remain strict", () => {
  const worker = read("runtime/generation-worker.cjs");
  const claimant = read("runtime/designpro-standalone-claimant.cjs");
  const flatFirstBranch = worker.match(/if \(isFlatFirst\) \{[\s\S]*?\n      \}/)?.[0] || "";
  assert.match(flatFirstBranch, /resolveFlatAtlasPreviewDimensions/);
  assert.doesNotMatch(flatFirstBranch, /resolveOrQueueUniversalDimensions/);
  assert.match(worker, /if \(!isFlatFirst\) \{[\s\S]*?resolveOrQueueUniversalDimensions/);
  assert.match(claimant, /resolveOrQueueUniversalDimensions\(sb, vehicle, stage, run\.id\)/);
});

test("the browser stops an old retrying request on fail-closed geometry", () => {
  const adapter = read("app/src/lib/designpanelpro-standalone-adapter.ts");
  assert.match(adapter, /NON_RETRYABLE_GENERATION_CODES/);
  assert.match(adapter, /genie_dimension_validation_required/);
  assert.match(adapter, /terminalGenerationFailureCode\(state/);
});

test("the dedicated test URL and server acknowledgement keep the A.T.L.A.S. banner honest", () => {
  const premium = read("app/src/pages/DesignPanelProPremium.tsx");
  const hook = read("app/src/hooks/useDesignPanelProLogic.ts");
  const gateway = read("gateway/src/server.mjs");
  assert.match(premium, /initialDesignProPipelineMode\(briefState\?\.pipelineMode, location\.search\)/);
  assert.match(premium, /Server accepted A\.T\.L\.A\.S\. v3/);
  assert.match(hook, /generation_pipeline_mode_mismatch/);
  assert.match(hook, /setStandaloneRequestId\(null\)/);
  assert.match(gateway, /requiredPipelineMode !== "flat-first-atlas-v1"/);
  assert.match(gateway, /pipelineMode: acceptedPipelineMode/);
});

test("the guarded create page defaults to A.T.L.A.S. with an explicit legacy rollback", () => {
  const selector = read("app/src/lib/designpro-flat-first.ts");
  const home = read("app/src/pages/DesignProAIHome.tsx");
  assert.match(selector, /if \(!FLAT_FIRST_ATLAS_UI_ENABLED\) return "legacy"/);
  assert.match(selector, /legacyRequestedBySearch\(search\)/);
  assert.match(selector, /return FLAT_FIRST_ATLAS_PIPELINE_MODE;\s*\n}/);
  assert.match(home, /initialDesignProPipelineMode\(/);
  assert.match(home, /setPipelineMode\("legacy"\)/);
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
  assert.match(hook, /onViews: pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE/);
  assert.match(hook, /applyGeneratedViews\(progressiveViews, true\)/);
  assert.match(premium, /const atlasMasterPreviewUrl/);
  assert.match(premium, /pipelineActive && !renderError && !baseDisplayUrl/);
  assert.match(premium, /Canonical A\.T\.L\.A\.S\. master locked/);
  assert.match(premium, /previewDisplayUrl = mainDisplayUrl \|\| atlasMasterPreviewUrl/);
  assert.match(premium, /atlasReady=\{Boolean\(latestFlatAtlas\)\}/);
  assert.match(premium, /paid ProductionPack slicing stays locked/);
});

test("the progress surface reports server state instead of a fake elapsed percentage", () => {
  const progress = read("app/src/components/designpanelpro/DesignPipelineProgress.tsx");
  assert.doesNotMatch(progress, /96 \* \(1 - Math\.exp/);
  assert.match(progress, /requestState\?: GenerationRequestState/);
  assert.match(progress, /proof views complete/);
  assert.match(progress, /safely leave this tab/);
  assert.match(progress, /Painting your canonical flattened A\.T\.L\.A\.S\. master/);
  assert.match(progress, /atlasProofStatus/);
  assert.doesNotMatch(progress, /renders here in your browser/);
});
