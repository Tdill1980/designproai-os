import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the worker preserves non-retryable GENIE validation errors", () => {
  const worker = read("runtime/generation-worker.cjs");
  assert.match(worker, /p_retryable:\s*error\?\.retryable !== false/);
  assert.doesNotMatch(
    worker.match(/catch \(error\) \{[\s\S]*?finally \{/)?.[0] || "",
    /p_retryable:\s*true/,
  );
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
