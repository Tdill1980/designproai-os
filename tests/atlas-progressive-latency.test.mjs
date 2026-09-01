import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const atlas = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
const worker = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");

test("a SUCCESSFUL A.T.L.A.S. authoring spends exactly one creative call", () => {
  // This is the invariant that protects the <60s / <90s SLA, and it is a
  // property of the LOOP, not of the budget: acceptance breaks out before a
  // second request body is ever built, so raising the ceiling cannot add a
  // millisecond to a healthy run. Asserting `maxAuthoringAttempts: 1` at the
  // call site only ever tested the ceiling, which is the weaker claim.
  assert.match(atlas, /const DEFAULT_MASTER_AUTHORING_ATTEMPTS = 1;/);
  assert.match(atlas, /geminiImageRequestCount: masterAuthoringAttempts/);

  const loop = atlas.slice(
    atlas.indexOf("for (let attempt = 1; attempt <= maxAuthoringAttempts"),
    atlas.indexOf("const masterStoragePath = atlasStoragePath("),
  );
  assert.ok(loop.length > 0, "the bounded authoring loop must still exist");
  // `stillBlocking` is tested TWICE in the loop -- first to decide whether the
  // output-class question is even worth asking, then to accept. Anchor on the
  // one that breaks, or this passes against the wrong branch.
  const acceptance = /if \(!stillBlocking\.length\) \{\s*break;\s*\}/;
  assert.match(
    loop,
    acceptance,
    "an accepted candidate must break immediately, never fall through to another attempt",
  );
  const accepted = loop.search(acceptance);
  const nextRequest = loop.indexOf("const attemptBody = atlasEdgeRequestBody(");
  assert.ok(
    nextRequest >= 0 && nextRequest < accepted,
    "the request body is built at the top of the iteration, so acceptance must break after it and before the next one",
  );
});

test("a REFUSED A.T.L.A.S. authoring gets exactly one re-roll, and no third", () => {
  // Owner ruling 2026-09-01. The call site is the real production switch --
  // resolveMaxAuthoringAttempts reads `explicit ?? env`, so the env var is
  // unreachable while a number is passed here. A run that takes this branch is
  // explicitly exempt from the normal SLA; the alternative is a failure page
  // for one stochastic refusal.
  assert.match(worker, /generateOrReuseFlatAtlas\(\{[\s\S]*?maxAuthoringAttempts: 2,/);
  assert.match(atlas, /const MAX_MASTER_AUTHORING_ATTEMPTS = 3;/);
  assert.match(
    atlas,
    /if \(attempt === maxAuthoringAttempts\) \{\s*throw new FlatAtlasError\(/,
    "exhausting the budget must surface the real refusal, never a silent retry",
  );
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
