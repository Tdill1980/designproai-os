import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
const atlas = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");

test("ATLAS keeps one canonical master and releases panel-bound proofs without a blocking gate", () => {
  assert.match(worker, /flatAtlas = await generateOrReuseFlatAtlas\(\{/);
  assert.doesNotMatch(worker, /surfaceGateSet\(/);
  assert.doesNotMatch(worker, /openSurfaceGate/);
  assert.doesNotMatch(worker, /awaitSurface/);
  assert.doesNotMatch(worker, /releaseAllGates/);
  assert.doesNotMatch(worker, /atlasRun/);
  assert.match(worker, /onMasterReady: \(atlas\) =>/);
  assert.match(worker, /onSurfaceReady: \(release\) =>/);
  assert.match(worker, /conditioningPartsFor: \(view\) => atlasProjectionParts\(atlas, view\)/);
  assert.match(worker, /conditioningIdentityFor: \(view\) => viewAuthorityFor\(atlas, view\)/);
  assert.match(worker, /panelFor: \(view\) => atlasPanelForProofView\(atlas, view\)/);
  assert.match(atlas, /const panelPersisted = store\.putImmutableBytes/);
  assert.match(atlas, /projectionReady: projectionPromise/);
  assert.doesNotMatch(atlas, /await onSurfaceReady/);
});
