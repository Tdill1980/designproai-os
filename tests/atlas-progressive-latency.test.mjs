import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const atlas = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const worker = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");

test("the customer path spends exactly one A.T.L.A.S. creative call", () => {
  assert.match(atlas, /const DEFAULT_MASTER_AUTHORING_ATTEMPTS = 1;/);
  assert.match(worker, /generateOrReuseFlatAtlas\(\{[\s\S]*?maxAuthoringAttempts: 1,/);
  assert.match(atlas, /geminiImageRequestCount: masterAuthoringAttempts/);
});

test("panel.ready is a non-blocking graph release with durable prerequisites", () => {
  const panelBranch = atlas.slice(
    atlas.indexOf("onPanel: async (panel) =>"),
    atlas.indexOf("const projectionStoragePath", atlas.indexOf("onPanel: async (panel) =>")),
  );
  assert.match(panelBranch, /const panelPersisted = store\.putImmutableBytes/);
  assert.match(panelBranch, /atlas: progressiveAtlas/);
  assert.match(panelBranch, /projectionReady: projectionPromise/);
  assert.match(panelBranch, /panelPersisted,/);
  assert.match(panelBranch, /panelStoragePath,/);
  assert.doesNotMatch(panelBranch, /await panelPersisted/,
    "later extraction must not wait for this panel upload");
  assert.doesNotMatch(panelBranch, /await onSurfaceReady/,
    "the 3D proof callback must never block the panel extraction stream");
});

test("the live worker connects the progressive callbacks before Call 1 returns", () => {
  const atlasCall = worker.slice(
    worker.indexOf("flatAtlas = await generateOrReuseFlatAtlas"),
    worker.indexOf("assertAtlasViewLineage", worker.indexOf("flatAtlas = await generateOrReuseFlatAtlas")),
  );
  assert.match(atlasCall, /onMasterReady: \(atlas\) =>/);
  assert.match(atlasCall, /onSurfaceReady: \(release\) =>/);
  assert.match(atlasCall, /launchAtlasProof\(\{ \.\.\.node, sourceViewType: "side" \}\)/);
  assert.match(atlasCall, /driverSurfaceRelease = node/);
  assert.ok(
    atlasCall.indexOf('sourceViewType: "side"') < atlasCall.indexOf('sourceViewType: "close-up"'),
    "Driver must be dispatched before the other proof sharing its panel",
  );
});

test("remaining proof nodes join without restarting an already released Driver", () => {
  const join = worker.slice(
    worker.indexOf("Reuse/resume paths do not emit progressive callbacks"),
    worker.indexOf("} else {", worker.indexOf("Reuse/resume paths do not emit progressive callbacks")),
  );
  assert.match(join, /if \(!progressiveProofRuns\.has\(slot\.sourceViewType\)\)/);
  assert.match(join, /Promise\.all\(claim\.viewPlan\.map/);
  assert.match(join, /combineAtlasProofRuns\(runs, claim\.viewPlan\)/);
});

test("receipts describe the scheduler that actually ran", () => {
  assert.match(atlas, /proofExecution: "panel-ready-driver-priority-parallel"/);
  assert.match(worker, /proofExecution: "panel-ready-driver-priority-parallel"/);
  assert.doesNotMatch(atlas, /proofExecution: "driver-first-sequential-generate-color-render"/);
  assert.doesNotMatch(worker, /proofExecution: "driver-first-sequential"/);
});
