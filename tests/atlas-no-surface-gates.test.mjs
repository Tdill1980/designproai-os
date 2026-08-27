import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");

test("ATLAS waits for one canonical master and has no per-surface proof gates", () => {
  assert.match(worker, /flatAtlas = await generateOrReuseFlatAtlas\(\{/);
  assert.doesNotMatch(worker, /surfaceGateSet\(/);
  assert.doesNotMatch(worker, /openSurfaceGate/);
  assert.doesNotMatch(worker, /awaitSurface/);
  assert.doesNotMatch(worker, /releaseAllGates/);
  assert.doesNotMatch(worker, /progressiveAtlas/);
  assert.doesNotMatch(worker, /atlasRun/);
  assert.match(worker, /conditioningPartsFor: \(sourceViewType\) => atlasProjectionParts\(flatAtlas, sourceViewType\)/);
  assert.match(worker, /conditioningIdentityFor: \(sourceViewType\) => viewAuthorityFor\(flatAtlas, sourceViewType\)/);
});
