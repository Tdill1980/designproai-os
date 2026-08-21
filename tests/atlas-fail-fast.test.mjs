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

test("the progress surface reports server state instead of a fake elapsed percentage", () => {
  const progress = read("app/src/components/designpanelpro/DesignPipelineProgress.tsx");
  assert.doesNotMatch(progress, /96 \* \(1 - Math\.exp/);
  assert.match(progress, /requestState\?: GenerationRequestState/);
  assert.match(progress, /proof views complete/);
  assert.match(progress, /safely leave this tab/);
  assert.doesNotMatch(progress, /renders here in your browser/);
});
