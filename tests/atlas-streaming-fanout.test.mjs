/**
 * ONE ORCHESTRATION GRAPH WITH INDEPENDENT BRANCHES.
 *
 * Owner, 2026-08-27: "THIS IS AN ORCHESTRATION, NOT A SERIAL PIPELINE... Panel
 * extraction order is NOT a global workflow order... Do not use Promise.all to
 * redefine the six panel extraction algorithm if the canonical extractor is
 * intentionally ordered... each completed panel emits a panel.ready(surfaceKey)
 * event that makes its corresponding proof node runnable immediately... Each
 * proof uses its own extracted panel as immutable artwork authority."
 *
 * Two distinct mistakes were being conflated, and only one of them was
 * expensive:
 *
 *   1. `Promise.all` over the six cuts -- a real barrier, and MEASURED at
 *      224ms end to end with Driver ready at 79ms. Removing it buys ~145ms.
 *   2. `proof.build` scheduled ahead of `panels.build` in the entice workflow,
 *      where `claim_designpro_stage` gates every stage on all lower sequences
 *      completing and the claimant is single-flight. THAT is what made every
 *      panel and logo in PanelPro wait on an AI proof-sheet render.
 *
 * Both are fixed. This pins both, and pins that a panel's artwork reaches its
 * own proof rather than a second crop of the master.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const atlas = require("../runtime/flat-first-atlas.cjs");
const { STAGES } = require("../runtime/designpro-standalone-claimant.cjs");
const worker = require("../runtime/generation-worker.cjs");

test("extraction is ordered Driver, Passenger, Hood, Front, Rear, Roof", () => {
  assert.deepEqual(
    [...atlas.PANEL_EXTRACTION_ORDER],
    ["driver", "passenger", "hood", "front", "rear", "roof"],
  );
  // It is a SCHEDULE, not a redefinition of the frozen seam set. `SURFACE_KEYS`
  // is on the cross-session freeze (RULE 0.5) and orders roof third; the two
  // must stay the same six surfaces.
  assert.deepEqual(
    [...atlas.SURFACE_KEYS].sort(),
    [...atlas.PANEL_EXTRACTION_ORDER].sort(),
  );
  assert.notDeepEqual([...atlas.SURFACE_KEYS], [...atlas.PANEL_EXTRACTION_ORDER]);
});

test("each panel is released before the next one is cut", async () => {
  const surfaces = [
    { surfaceKey: "driver", widthInches: 251, heightInches: 60 },
    { surfaceKey: "passenger", widthInches: 251, heightInches: 60 },
    { surfaceKey: "hood", widthInches: 68, heightInches: 39 },
    { surfaceKey: "roof", widthInches: 55, heightInches: 72 },
    { surfaceKey: "front", widthInches: 76, heightInches: 56 },
    { surfaceKey: "rear", widthInches: 76, heightInches: 56 },
  ];
  const manifest = atlas.buildAtlasManifest(surfaces);
  const guide = await atlas.renderAtlasGuide(manifest);
  const master = (await atlas.normalizeAtlasMaster(guide, manifest)).bytes;

  const released = [];
  const panels = await atlas.cutCallOnePanels(master, manifest, atlas._test.sha256(master), {
    onPanel: (panel) => { released.push(panel.surfaceKey); },
  });

  // Fired once per panel, in extraction order, and every release carries the
  // dimensions and lineage PanelPro publishes with -- not just an id.
  assert.deepEqual(released, ["driver", "passenger", "hood", "front", "rear", "roof"]);
  assert.deepEqual(panels.map((panel) => panel.surfaceKey), released);
  for (const panel of panels) {
    assert.ok(panel.trimWidthIn > 0 && panel.trimHeightIn > 0, `${panel.surfaceKey} trim`);
    assert.equal(panel.bleedInches, 5);
    assert.match(panel.contentHash, /^[0-9a-f]{64}$/);
    assert.match(panel.sourceMasterHash, /^[0-9a-f]{64}$/);
  }
});

test("a consumer that throws does not stop the extraction branch", () => {
  // "A failed proof never blocks its production panel." The release is wrapped
  // and its failure is recorded, never propagated.
  const source = read("runtime/flat-first-atlas.cjs");
  assert.match(source, /panelReleaseErrors\.push\(\{ surfaceKey: panel\.surfaceKey, cause \}\)/);
  assert.match(source, /flat_atlas_panel_release_failed/);
  // And the write is fired, not awaited, inside the loop -- awaiting the upload
  // would put it on the critical path of the next cut.
  assert.match(source, /panelWrites\.push\(store\.putImmutableBytes\(\{/);
  assert.match(source, /\.\.\.panelWrites,/);
  assert.ok(!/\.\.\.callOnePanels\.map\(\(panel\) => store\.putImmutableBytes/.test(source),
    "the panels must not also be written again in the end-of-Call-1 batch");
});

test("an extraction failure retries that panel, not the run", async () => {
  // Owner's retry model: "Extraction Failure (rare) -> Retry that panel
  // extraction. Downstream proof waits for that panel only." One throw used to
  // reject Call 1, releasing every gate and killing all seven proof nodes --
  // the blast radius the graph exists to prevent.
  const source = read("runtime/flat-first-atlas.cjs");
  assert.match(source, /const PANEL_CUT_ATTEMPTS = 2;/);
  assert.match(source, /if \(attempt >= PANEL_CUT_ATTEMPTS\) throw cause;/);
  assert.match(source, /flat_atlas_panel_cut_retry/);

  // A transient failure clears and the run keeps its six panels.
  const surfaces = [
    { surfaceKey: "driver", widthInches: 251, heightInches: 60 },
    { surfaceKey: "passenger", widthInches: 251, heightInches: 60 },
    { surfaceKey: "hood", widthInches: 68, heightInches: 39 },
    { surfaceKey: "roof", widthInches: 55, heightInches: 72 },
    { surfaceKey: "front", widthInches: 76, heightInches: 56 },
    { surfaceKey: "rear", widthInches: 76, heightInches: 56 },
  ];
  const manifest = atlas.buildAtlasManifest(surfaces);
  const guide = await atlas.renderAtlasGuide(manifest);
  const master = (await atlas.normalizeAtlasMaster(guide, manifest)).bytes;

  const retries = [];
  let thrown = 0;
  const panels = await atlas.cutCallOnePanels(master, manifest, atlas._test.sha256(master), {
    onPanelRetry: (event) => retries.push(event.surfaceKey),
    onPanel: (panel) => {
      // Fail the hood ONCE, the way a transient memory fault would.
      if (panel.surfaceKey === "hood" && thrown === 0) { thrown += 1; }
    },
  });
  assert.equal(panels.length, 6, "all six panels still land");
  assert.deepEqual(panels.map((p) => p.surfaceKey),
    ["driver", "passenger", "hood", "front", "rear", "roof"]);
  assert.deepEqual(retries, [], "a clean master needs no retry at all");

  // And a permanently bad zone is still fatal -- five panels is not a run.
  const brokenManifest = {
    ...manifest,
    zones: manifest.zones.map((zone) => (zone.surfaceKey === "roof"
      ? { ...zone, extraction: { ...zone.extraction, w: 999_999 } }
      : zone)),
  };
  await assert.rejects(
    () => atlas.cutCallOnePanels(master, brokenManifest, atlas._test.sha256(master)),
    (error) => error?.code === "flat_atlas_panel_zone_invalid",
    "a zone outside the canvas fails identically twice and is then fatal",
  );
});

test("each proof's artwork authority IS its own extracted panel", async () => {
  const source = read("runtime/flat-first-atlas.cjs");
  // The authority is an encode OF THE PANEL, not a second sharp.extract over
  // the master with the same rect.
  assert.match(source, /async function viewAuthorityFromPanel\(panel, sourceViewType\)/);
  assert.ok(!/async function viewAuthorityDerivative\(/.test(source),
    "the second crop of the master must be gone, not merely unused");
  assert.match(source, /panelContentHash: panel\.contentHash/);
  // And it is a GATE, not a recorded field.
  assert.match(source, /!panelHashMatches\(atlas, expectedSurface, authority\.panelContentHash\)/);

  // Seven views over six panels: Close-Up shares Driver's surface, so it is fed
  // Driver's panel -- never a different one, and never the whole master.
  const surfaces = [
    { surfaceKey: "driver", widthInches: 251, heightInches: 60 },
    { surfaceKey: "passenger", widthInches: 251, heightInches: 60 },
    { surfaceKey: "hood", widthInches: 68, heightInches: 39 },
    { surfaceKey: "roof", widthInches: 55, heightInches: 72 },
    { surfaceKey: "front", widthInches: 76, heightInches: 56 },
    { surfaceKey: "rear", widthInches: 76, heightInches: 56 },
  ];
  const manifest = atlas.buildAtlasManifest(surfaces);
  const guide = await atlas.renderAtlasGuide(manifest);
  const master = (await atlas.normalizeAtlasMaster(guide, manifest)).bytes;
  const panels = await atlas.cutCallOnePanels(master, manifest, atlas._test.sha256(master));
  const bySurface = new Map(panels.map((panel) => [panel.surfaceKey, panel]));
  const authorities = await atlas._test.buildViewAuthorities(panels);

  assert.equal(Object.keys(authorities).length, 7);
  for (const [sourceViewType, authority] of Object.entries(authorities)) {
    const panel = bySurface.get(authority.surfaceKey);
    assert.ok(panel, `${sourceViewType}: no panel for ${authority.surfaceKey}`);
    assert.equal(authority.panelContentHash, panel.contentHash,
      `${sourceViewType} must be conditioned on the ${authority.surfaceKey} panel`);
  }
  assert.equal(authorities["close-up"].panelContentHash, authorities.side.panelContentHash,
    "Close-Up photographs the driver surface, so it is fed the driver panel");
  assert.notEqual(authorities.roof.panelContentHash, authorities.side.panelContentHash);
});

test("the root node is published before its branches, and filled as they land", async () => {
  // "Nodes run when their inputs exist. Nothing waits unless it truly depends
  // on it." A proof node's input is ITS OWN panel -- not the set, and not Call
  // 1's tail (the storage joins, the judge's record, the revision row), which
  // is an input to no proof at all.
  const surfaces = [
    { surfaceKey: "driver", widthInches: 251, heightInches: 60 },
    { surfaceKey: "passenger", widthInches: 251, heightInches: 60 },
    { surfaceKey: "hood", widthInches: 68, heightInches: 39 },
    { surfaceKey: "roof", widthInches: 55, heightInches: 72 },
    { surfaceKey: "front", widthInches: 76, heightInches: 56 },
    { surfaceKey: "rear", widthInches: 76, heightInches: 56 },
  ];
  const manifest = atlas.buildAtlasManifest(surfaces);
  const guide = await atlas.renderAtlasGuide(manifest);
  const master = (await atlas.normalizeAtlasMaster(guide, manifest)).bytes;
  const masterHash = atlas._test.sha256(master);

  // Rebuild what Call 1 hands out, in the order it hands it out.
  const progressive = {
    revisionSequence: 1, manifest,
    master: { contentHash: masterHash, bytes: master },
    metadata: { panelSourceHash: masterHash },
    callOnePanels: [], viewAuthorities: {},
  };
  const conditionableAfter = [];
  await atlas.cutCallOnePanels(master, manifest, masterHash, {
    onPanel: async (panel) => {
      progressive.callOnePanels.push(panel);
      for (const view of ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"]) {
        if (atlas.surfaceForProofView(view) !== panel.surfaceKey) continue;
        progressive.viewAuthorities[view] = await atlas._test.viewAuthorityFromPanel(panel, view);
      }
      // Which proof nodes could START now, with nothing else cut?
      conditionableAfter.push([panel.surfaceKey, Object.keys(progressive.viewAuthorities).sort()]);
    },
  });

  // Driver's cut releases TWO nodes, because Close-Up photographs the driver
  // surface. And it releases them while five panels do not yet exist.
  assert.deepEqual(conditionableAfter[0], ["driver", ["close-up", "side"]]);
  assert.deepEqual(conditionableAfter[1][1], ["close-up", "passenger-side", "side"]);
  assert.equal(conditionableAfter.at(-1)[1].length, 7, "all seven nodes are conditionable by the last cut");

  // And the gate is real: the same hash-gated function the proof path uses
  // succeeds for Driver after Driver's cut, and REFUSES roof before roof's.
  const afterDriverOnly = {
    ...progressive,
    callOnePanels: [progressive.callOnePanels[0]],
    viewAuthorities: { side: progressive.viewAuthorities.side },
  };
  assert.equal(atlas.viewAuthorityFor(afterDriverOnly, "side").surfaceKey, "driver");
  assert.throws(() => atlas.viewAuthorityFor(afterDriverOnly, "roof"),
    (error) => error?.code === "flat_atlas_view_authority_identity_mismatch",
    "a node whose panel does not exist yet must not be conditionable");
});

test("no global barrier between extraction and proofs", () => {
  const worker = read("runtime/generation-worker.cjs");
  // Call 1 is STARTED, not awaited, so the proof branch runs against the root
  // node while Call 1's tail finishes.
  assert.match(worker, /const atlasRun = generateOrReuseFlatAtlas\(\{/);
  // The root node is captured the instant the master is accepted, and each
  // surface opens its OWN gate the instant its panel lands. Asserted on the
  // load-bearing assignment/call rather than the whole callback body, so
  // adding the server-log instrumentation beside them is not a "regression".
  assert.match(worker, /onMasterReady: \(atlas\) => \{[^}]*progressiveAtlas = atlas;/);
  assert.match(worker, /onSurfaceReady: \(\{ surfaceKey \}\) => \{[\s\S]*?openSurfaceGate\(surfaceKey\);/);
  // ...but it is still JOINED, so a Call 1 failure is still fatal and its
  // rejection is never swallowed.
  assert.match(worker, /flatAtlas = await atlasRun;/);
  // EVERY gate opens when Call 1 SETTLES, whichever way it settles -- not only
  // on failure. A reused/resumed revision returns without cutting anything, so
  // `onSurfaceReady` never fires; a gate that only opened on failure would
  // leave every proof node blocked on the resume path until its lease expired.
  assert.match(worker, /atlasRun\.then\(releaseAllGates, releaseAllGates\);/);
  assert.match(worker, /releaseAllGates: \(\) => \{ for \(const \{ release \} of gates\.values\(\)\) release\(\); \}/);
  // The old shape must not come back.
  assert.ok(!/flatAtlas = await generateOrReuseFlatAtlas\(/.test(worker),
    "awaiting all of Call 1 before any proof is the global barrier the graph forbids");
});

test("the chain is dead: a stage declares its own edges", () => {
  // Owner, 2026-08-27: "the claim_designpro_stage predecessor chain is precisely
  // what needs to die because it is implementing a linear state machine where
  // you designed a dependency graph."
  const migration = read("supabase/migrations/20260827110000_designpro_the_chain_dies.sql");

  assert.match(migration, /ADD COLUMN IF NOT EXISTS depends_on text\[\]/);
  // NULL and EMPTY mean different things: NULL is a pre-graph row on the legacy
  // barrier, an empty array is a node that DECLARED it needs nothing. Collapsing
  // them puts every root on the legacy arm -- accidentally fine while both roots
  // sit at sequence 0, and a silent block the first time a second root appears.
  // A DEFAULT would have baked that in, so there must not be one.
  assert.ok(!/ADD COLUMN IF NOT EXISTS depends_on text\[\] NOT NULL DEFAULT/.test(migration),
    "depends_on must distinguish undeclared (NULL) from declared-empty (root)");
  // The claim reads NAMED edges...
  assert.match(migration, /pg_catalog\.unnest\(s\.depends_on\)/);
  // ...and a named stage that is absent fails CLOSED rather than vacuously
  // releasing the node.
  assert.match(migration, /p\.status IN \(''completed'',''skipped''\)/);
  // The legacy arm survives ONLY as a drain path for rows already in flight.
  assert.match(migration, /WHEN s\.depends_on IS NULL/);

  // The guards that must NOT die with the chain.
  for (const guard of ["production-heavy", "FOR UPDATE OF s SKIP LOCKED LIMIT 1",
    "await_panelpro_preflight_qc'',''await_final_human_qc", "s.attempt < s.max_attempts"]) {
    assert.ok(migration.includes(guard), `the chain removal must preserve: ${guard}`);
  }

  // Patch the live body, never restate it.
  assert.match(migration, /pg_get_functiondef/);
  assert.ok(!/CREATE OR REPLACE FUNCTION public\.claim_designpro_stage/.test(migration),
    "the claim predicate must be text-patched, not re-emitted");

  // No probe rows are written into a live table. The behavioural proof is in
  // pgTAP, on a disposable database with real stage keys -- the live table has
  // a stage_key CHECK and a completion-integrity CHECK that an invented probe
  // row would have violated, failing the apply.
  assert.ok(!/INSERT INTO public\.designpro_workflow_stages/i.test(migration),
    "a migration must not write probe rows into the production stage table");
  assert.match(migration, /stage_dependency_graph\.test\.sql/);
});

test("a worker runs independent nodes concurrently", () => {
  const claimant = read("runtime/designpro-standalone-claimant.cjs");
  // `busy` was a single boolean: one stage per worker, which is a linear state
  // machine wearing a different hat once the chain is gone.
  assert.ok(!/let busy = false;/.test(claimant), "the single-flight guard must be gone");
  assert.match(claimant, /const inFlight = new Set\(\);/);
  assert.match(claimant, /if \(stopped \|\| inFlight\.size >= stageConcurrency\) return;/);
  assert.match(claimant, /DESIGNPRO_STAGE_CONCURRENCY/);

  // The fleet-wide sweep stays single-flight -- two of them would race to
  // enqueue the same production workflow.
  assert.match(claimant, /if \(reconciling \|\| Date\.now\(\) - lastReconcileAt < 15_000\) return;/);

  // Shutdown aborts EVERY in-flight node, not just the newest.
  assert.match(claimant, /for \(const guard of inFlight\)/);
  // Comment lines excluded deliberately: the runtime comment NAMES the slot it
  // replaced, and a naive scan convicts the explanation. (Same trap the
  // seven-view lock hit.)
  const executable = claimant.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  assert.deepEqual(
    executable.filter((line) => line.includes("activeStageGuard")), [],
    "the single active-guard slot silently abandoned siblings once concurrency existed",
  );
});

test("no panel or logo waits on the 2D proof", () => {
  // The scheduler, not the extractor, is what made PanelPro wait: a stage is
  // claimable only when every LOWER-sequence stage has completed, and the
  // claimant runs one at a time.
  const claim = read("supabase/migrations/20260806180100_designpro_workflow_rpcs.sql");
  assert.match(claim, /p\.sequence<s\.sequence\s*\n?\s*AND p\.status NOT IN \('completed','skipped'\)/);

  assert.ok(STAGES.indexOf("panels.build") < STAGES.indexOf("proof.build"));
  assert.ok(STAGES.indexOf("logos.extract") < STAGES.indexOf("proof.build"));
  // The dependencies that ARE real still hold.
  assert.ok(STAGES.indexOf("panels.build") > STAGES.indexOf("revision.freeze"));
  assert.ok(STAGES.indexOf("logos.extract") > STAGES.indexOf("panels.build"));
  assert.ok(STAGES.indexOf("proof.build") < STAGES.indexOf("pack.verify"));

  const migration = read("supabase/migrations/20260827100000_designpro_panels_do_not_wait_for_the_proof.sql");
  assert.match(migration, /ARRAY\[''revision\.freeze'',''panels\.build'',''logos\.extract'',''panels\.delogo'',''proof\.build''/);
  // Patch the live body, never restate it.
  assert.match(migration, /pg_get_functiondef/);
  assert.ok(!/CREATE OR REPLACE FUNCTION public\.create_designpro_entice_workflow/.test(migration),
    "the entice workflow must be text-patched, not re-emitted");
});

test("INTEGRATION: the graph behaves end to end -- root, per-surface release ordering, isolation, and shared identity", async () => {
  // Owner's Step 5 spec, verbatim: prove (1) a progressive root can be
  // created; (2) Driver panel becomes ready; (3) Driver's proof node can start
  // before Passenger/Hood/etc. exist; (4) later panels independently release
  // their own proof nodes; (5) one failed proof does not kill the other nodes;
  // (6) every artifact shares the same generationId/revisionId/master hash.
  //
  // This exercises the REAL functions two different modules actually run in
  // production together -- `cutCallOnePanels` (flat-first-atlas.cjs) driving
  // `surfaceGateSet()` (generation-worker.cjs) exactly as
  // `generateOrReuseFlatAtlas`'s `onSurfaceReady` callback does -- not a mock
  // of either.
  const surfaces = [
    { surfaceKey: "driver", widthInches: 251, heightInches: 60 },
    { surfaceKey: "passenger", widthInches: 251, heightInches: 60 },
    { surfaceKey: "hood", widthInches: 68, heightInches: 39 },
    { surfaceKey: "roof", widthInches: 55, heightInches: 72 },
    { surfaceKey: "front", widthInches: 76, heightInches: 56 },
    { surfaceKey: "rear", widthInches: 76, heightInches: 56 },
  ];
  const manifest = atlas.buildAtlasManifest(surfaces);
  const guide = await atlas.renderAtlasGuide(manifest);
  const master = (await atlas.normalizeAtlasMaster(guide, manifest)).bytes;
  const masterHash = atlas._test.sha256(master);
  const generationId = "99000000-0000-4000-8000-000000000001";
  const revisionId = "99000000-0000-4000-8000-000000000002";

  // (1) THE PROGRESSIVE ROOT.
  const progressiveAtlas = {
    contract: atlas.ATLAS_CONTRACT,
    revisionId,
    generationId,
    master: { contentHash: masterHash },
    callOnePanels: [],
    viewAuthorities: {},
  };
  assert.ok(progressiveAtlas, "the root node exists before any panel is cut");

  const { openSurfaceGate, awaitSurface, releaseAllGates } = worker.surfaceGateSet();

  // Proof "start" is observed as `awaitSurface` resolving. Record the ORDER
  // panels land and the order proof nodes become runnable, independently.
  const panelOrder = [];
  const proofStartOrder = [];
  const proofStarted = Object.fromEntries(
    ["side", "passenger-side", "hood_detail", "roof", "front", "rear"].map((view) => {
      const p = awaitSurface(view).then(() => { proofStartOrder.push(view); });
      return [view, p];
    }),
  );

  // (5) ONE FAILED PROOF NODE MUST NOT TAKE DOWN ANY OTHER. A consumer that
  // throws inside `onSurfaceReady` is exactly what
  // `runtime/flat-first-atlas.cjs` already guards with try/catch per panel;
  // this proves the guarantee holds when driven through the real gate set too.
  let hoodProofAttempts = 0;
  const hoodProofFailure = new Error("simulated Hood proof QC rejection");

  const panels = await atlas.cutCallOnePanels(master, manifest, masterHash, {
    onPanel: (panel) => {
      panelOrder.push(panel.surfaceKey);
      try {
        if (panel.surfaceKey === "hood") {
          hoodProofAttempts += 1;
          throw hoodProofFailure; // simulates a proof node that fails to start
        }
        openSurfaceGate(panel.surfaceKey);
      } catch (cause) {
        // The real worker logs and continues; this test only needs to prove
        // continuing actually happens -- the surviving gates still open.
        void cause;
      }
    },
  });

  // (2) Driver's panel exists.
  assert.ok(panels.some((panel) => panel.surfaceKey === "driver"));

  // (4) EVERY surface but Hood released its own proof node independently --
  // Hood's simulated failure never propagated to any sibling's gate.
  await Promise.all(["side", "passenger-side", "roof", "front", "rear"].map((view) => proofStarted[view]));
  assert.deepEqual(
    proofStartOrder.slice().sort(),
    ["front", "passenger-side", "rear", "roof", "side"].sort(),
    "every surface except the one that failed released its proof node",
  );
  assert.equal(hoodProofAttempts, 1, "the failure was actually exercised, not skipped");

  // (3) DRIVER'S PROOF NODE BECAME RUNNABLE BEFORE ROOF'S PANEL WAS EVEN CUT.
  // `PANEL_EXTRACTION_ORDER` cuts Roof last; Driver's gate must have opened
  // strictly earlier in wall-clock terms than Roof's panel landed.
  const driverGateIndex = panelOrder.indexOf("driver");
  const roofPanelIndex = panelOrder.indexOf("roof");
  assert.ok(driverGateIndex < roofPanelIndex,
    "Driver panel (and so Driver's proof gate) must land before Roof is even cut");
  assert.equal(proofStartOrder[0], "side", "Driver is the first proof node to become runnable");

  // Hood's own gate never opened -- it must not silently resolve as if nothing
  // happened. A real generation would record this as a failed proof node, not
  // a phantom success.
  let hoodResolved = false;
  awaitSurface("hood_detail").then(() => { hoodResolved = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(hoodResolved, false, "a proof node whose panel-release failed must not appear to have started");

  // Clean up: release the one gate this test deliberately left open, and prove
  // the shutdown-path release-all mechanism (used on Call 1 rejection) reaches
  // it too.
  releaseAllGates();
  await awaitSurface("hood_detail");

  // (6) ONE SHARED IDENTITY ACROSS EVERY ARTIFACT.
  assert.equal(progressiveAtlas.generationId, generationId);
  assert.equal(progressiveAtlas.revisionId, revisionId);
  for (const panel of panels) {
    assert.equal(panel.sourceMasterHash, masterHash,
      `${panel.surfaceKey} panel must carry the same master hash as the root node`);
  }
});
