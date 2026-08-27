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
  assert.match(worker, /onMasterReady: \(atlas\) => \{ progressiveAtlas = atlas; \}/);
  assert.match(worker, /onSurfaceReady: \(\{ surfaceKey \}\) => \{ openSurfaceGate\(surfaceKey\); \}/);
  // ...but it is still JOINED, so a Call 1 failure is still fatal and its
  // rejection is never swallowed.
  assert.match(worker, /flatAtlas = await atlasRun;/);
  assert.match(worker, /atlasRun\.catch\(\(cause\) => \{/);
  // A rejected Call 1 releases every gate, so a node waiting on a panel that
  // will never exist fails with a reason instead of hanging to lease expiry.
  assert.match(worker, /for \(const \{ release \} of surfaceGates\.values\(\)\) release\(\);/);
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
  // The claim reads NAMED edges...
  assert.match(migration, /pg_catalog\.unnest\(s\.depends_on\)/);
  // ...and a named stage that is absent fails CLOSED rather than vacuously
  // releasing the node.
  assert.match(migration, /p\.status IN \(''completed'',''skipped''\)/);
  // The legacy arm survives ONLY as a drain path for rows already in flight.
  assert.match(migration, /array_length\(s\.depends_on,1\) IS NULL/);

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
