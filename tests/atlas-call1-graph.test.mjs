// RULE 0.35 ADDENDUM — CALL 1 RUNS AS A DURABLE NODE GRAPH (owner, Trish
// 2026-09-11: "Graph orchestration in parallel wherever you can improve latency").
//
// Locks, against the real migration on PGlite and the runtime module:
//   1. the graph IS the owner's cascade: driver → passenger → {hood, front, rear}
//      → roof → master.assemble, with hood/front/rear becoming claimable in the
//      SAME instant passenger completes (three claims succeed back to back);
//   2. claims are lease-gated: a node of a run whose generation request is no
//      longer leased is never handed out, and the claim carries the current
//      lease token so the edge authorises exactly as before;
//   3. per-node retry with backoff, attempts exhausted → run failed, and a
//      resume that only re-arms retryable failures;
//   4. end to end on synthetic sheets across TWO node workers: seven image
//      requests (driver view+flatten, front view+flatten, hood, rear, roof),
//      passenger a flop, one 4096² master, both workers held leases, and a
//      second author() of the same request spends nothing;
//   5. a creative refusal surfaces as the SAME HeroDriverRefusal the in-process
//      cascade throws, so flat-first-atlas's fail-over is untouched;
//   6. the runtime seams: flat-first-atlas routes the hero branch through the
//      injected worker unless DESIGNPRO_ATLAS_CALL1_GRAPH=off, the generation
//      worker passes it, index.js starts it and reports its health.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createAtlasCall1Database, createAtlasCall1Adapter, OWNER, REQUEST, GENERATION, CLAIM } from "./helpers/atlas-call1-graph-fixture.mjs";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");

// HERO-FIRST IS OPT-IN NOW, so this file asks for it by name.
//
// The owner's Call-1 order is flat 2D first (`heroFirstEnabled`), so the
// DEFAULT graph is the seven-node single-call one and the view/flatten split
// only compiles when the flag says so. This file exists to hold that split's
// shape, retry isolation and reference handoff, so it pins the flag rather than
// leaning on a default — which is exactly how these tests silently stopped
// describing production the last time a default moved underneath them.
process.env.DESIGNPRO_ATLAS_HERO_FIRST = "on";
const graph = require("../runtime/atlas-call1-graph.cjs");
const hero = require("../runtime/atlas-hero-driver.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");
const { createHash } = require("node:crypto");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

const SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]].map(([surfaceKey, widthInches, heightInches]) => ({
  surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
}));
const INPUT = { mode: "commercial", brief: "test", vehicle: { year: "2022", make: "Ford", model: "F250", type: "truck" } };
const paint = async (w, h, tint) => sharp({ create: { width: w, height: h, channels: 3, background: tint } }).png().toBuffer();

/**
 * The same synthetic edge the in-process cascade test uses: the model returns
 * at the requested shape. HERO-FIRST: a `first` request carrying no hero-view
 * reference is NODE 1 and answers 16:9 with `heroStage: "vehicle-view"`; the
 * same surface asked again WITH that reference is NODE 3, the flatten, and
 * answers at the flank's own shape.
 */
function syntheticEdge(calls, { refuse = null } = {}) {
  return async (body) => {
    calls.push(body);
    const tint = { driver: "#2255aa", hood: "#3366bb", front: "#4477cc", rear: "#5588dd", roof: "#6699ee" }[body.surfaceKey];
    // THE EDGE'S OWN INPUT ALLOWLIST. `attach()` in design-panel-ai-generate
    // refuses any path outside the content-addressed prefix with
    // `atlas_author_input_path_invalid` -- which is exactly how node 3's first
    // live request died (generation 2099d17d, 2026-09-17, HTTP 500) while this
    // stub happily accepted the panel path node 1 used to return. A fake door
    // that is laxer than the real one cannot catch a door-shaped bug.
    // The edge refuses history on a from-scratch hero and ALLOWS it on a
    // flatten; a stub that permitted either would not catch a regression.
    if (body.first === true && !body.heroViewStoragePath && (body.priorTurns || []).length) {
      throw Object.assign(new Error("atlas_author_hero_takes_no_history"), { code: "flat_atlas_author_edge_call_failed" });
    }
    if (body.heroViewStoragePath && !/^atlas-call1-inputs\/[0-9a-f]{64}\.(?:png|jpg)$/.test(String(body.heroViewStoragePath))) {
      throw Object.assign(new Error(`atlas_author_input_path_invalid:${body.heroViewStoragePath}`), { code: "flat_atlas_author_edge_call_failed" });
    }
    const vehicleView = body.first === true && !body.heroViewStoragePath;
    const bytes = vehicleView
      ? await paint(1920, 1080, tint)
      : body.surfaceKey === refuse
        // A canvas the contain-fit sizer genuinely cannot rescue: a tall
        // portrait against a landscape panel, drift ~5.6, so the design would
        // occupy under a fifth of its own rectangle. This used to be a 400x400
        // square, which against a 1.607:1 hood is only drift 1.607 -- since
        // `containExtend` landed that is an ordinary accepted sheet with a
        // vertical bleed, not a refusal, so the old fixture stopped reproducing
        // the case this test is about.
        ? await paint(400, 1400, tint)
        : await paint(Math.round(body.targetWidthPx * 0.97), body.targetHeightPx, tint);
    const contentHash = sha(bytes);
    const name = vehicleView ? `${body.surfaceKey}-view` : body.surfaceKey;
    return {
      bytes, imageRequestCount: 1, providerCacheHit: false, providerRequestKey: "a".repeat(64),
      heroStage: body.first === true ? (vehicleView ? "vehicle-view" : "flatten") : null,
      aspectRatio: vehicleView ? "16:9" : "21:9",
      panelStoragePath: `atlas-author/${name}.png`, panelSha256: contentHash, panelBytes: bytes.length,
      userTurn: { role: "user", parts: [{ text: `exact ${name} instructions` }] },
      modelTurn: { role: "model", parts: [{ imageRef: { storagePath: `atlas-author/${name}.png`, contentHash }, thoughtSignature: `sig-${name}` }] },
      historyImageBytes: bytes.length, thoughtSignatureCount: 1,
      priorSignaturesReplayed: (body.priorTurns || []).flatMap((t) => t.parts).filter((p) => p.thoughtSignature).length,
    };
  };
}

const definition = (manifest) => ({ contract: graph.GRAPH_CONTRACT, manifest, input: INPUT, creativeContext: "", providerRequest: { requestId: REQUEST, generationId: GENERATION } });
async function createRun(db, manifest) {
  const def = definition(manifest);
  const { rows } = await db.query(
    "SELECT public.create_designpro_atlas_call1_run($1,$2,$3,$4,$5,$6,$7) AS r",
    [REQUEST, GENERATION, OWNER, graph.GRAPH_CONTRACT, graph.hashJson(def), JSON.stringify(def), JSON.stringify(graph.compileHeroDriverGraph())]);
  return rows[0].r;
}
const claim = async (db, worker = "w1") => (await db.query("SELECT public.claim_designpro_atlas_call1_node($1,$2) AS c", [worker, 120])).rows[0].c;
const finish = async (db, node, state, output = { ok: true }) => (await db.query(
  "SELECT public.finish_designpro_atlas_call1_node($1,$2,$3,$4,$5) AS r", [node.id, node.lease_token, state, JSON.stringify(output), graph.hashJson(output)])).rows[0].r;

test("1. the compiled graph is the owner's cascade as edges: nothing but a dependency orders it", () => {
  const nodes = graph.compileHeroDriverGraph();
  const deps = Object.fromEntries(nodes.map((n) => [n.key, n.dependsOn]));
  // HERO-FIRST IS A DAG, NOT A CALL THAT HAPPENS TO MAKE TWO REQUESTS. Node 1
  // (the vehicle-sheet render) and node 3 (the flattener) are separate rows
  // with an edge between them, so a failed flatten retries alone. Front is
  // hero-view-eligible on the SAME measured evidence as driver
  // (hero.HERO_VIEW_SURFACES) -- it gets its own view node, a second root.
  assert.deepEqual(deps[graph.DRIVER_VIEW_NODE], []);
  assert.deepEqual(deps["surface.driver"], [graph.DRIVER_VIEW_NODE]);
  assert.deepEqual(deps[graph.viewNode("front")], [], "front's view is a root -- claimable alongside driver's, not after it");
  assert.deepEqual(deps["surface.passenger"], ["surface.driver"]);
  // Front carries its OWN view node on top of the unchanged driver+passenger
  // reference set; hood and rear are untouched (never hero-view-eligible).
  assert.deepEqual(deps["surface.hood"], ["surface.driver", "surface.passenger"]);
  assert.deepEqual(deps["surface.rear"], ["surface.driver", "surface.passenger"]);
  assert.deepEqual(deps["surface.front"], ["surface.driver", "surface.passenger", graph.viewNode("front")]);
  // Roof is claimable in the SAME instant as hood/front/rear: it is shown the
  // two flanks and replays the driver, and depends on nothing else. The old
  // sibling edges bought no continuity the driver signature does not already
  // carry, and cost a whole sequential model call.
  assert.deepEqual(deps["surface.roof"], ["surface.driver", "surface.passenger"]);
  assert.deepEqual(deps[graph.MASTER_NODE].sort(), nodes.filter((n) => n.key !== graph.MASTER_NODE).map((n) => n.key).sort());
  // The stage list and the DAG agree: the set of surfaces ready after each stage is the next stage.
  const states = nodes.map((n) => ({ ...n, state: "pending" }));
  const waves = [];
  for (let guard = 0; guard < 6; guard += 1) {
    const ready = graph.readyNodes(states);
    if (!ready.length) break;
    waves.push(ready.map((n) => n.key.replace(/^surface\./, "")).sort());
    for (const n of ready) n.state = "completed";
  }
  // Wave 1 is BOTH view nodes -- front's is claimable the instant the run
  // starts, in parallel with driver's, and adds nothing to the critical path:
  // by the time surface.front is ready (wave 4) its view has long completed.
  // THREE STAGES. Roof joins hood/front/rear in ONE parallel wave -- it used to
  // hold a wave of its own purely because it replayed their exchanges, which
  // cost a full sequential model call (~45s) on every generation for continuity
  // the driver's signature already carries.
  assert.deepEqual(waves, [["driver.view", "front.view"], ["driver"], ["passenger"], ["front", "hood", "rear", "roof"], ["master.assemble"]]);

  // THE SHAPE IS THE SWITCH, decided once when the run is created and then
  // stored — so a flag flipped mid-run cannot change what a claimed node does.
  // Without hero-first the graph is the seven-node single-call one: no view
  // node for EITHER eligible surface, driver authored flat and from scratch.
  //
  // THAT IS NOW THE DEFAULT (owner: Call 1 authors the flat 2D design first),
  // so it is asserted through the real `heroFirstEnabled` with the flag absent,
  // not only through an explicit `heroFirst: false`.
  const heroFirstFlag = process.env.DESIGNPRO_ATLAS_HERO_FIRST;
  delete process.env.DESIGNPRO_ATLAS_HERO_FIRST;
  try {
    const byDefault = graph.compileHeroDriverGraph();
    assert.equal(byDefault.length, 7, "flat-first is the default Call 1 shape");
    assert.ok(!byDefault.some((n) => n.key === graph.DRIVER_VIEW_NODE),
      "no vehicle render stands in front of the design by default");
  } finally { process.env.DESIGNPRO_ATLAS_HERO_FIRST = heroFirstFlag; }

  const single = graph.compileHeroDriverGraph({ heroFirst: false });
  assert.equal(single.length, 7);
  assert.ok(!single.some((n) => n.key === graph.DRIVER_VIEW_NODE));
  assert.ok(!single.some((n) => n.key === graph.viewNode("front")));
  assert.deepEqual(single.find((n) => n.key === "surface.driver").dependsOn, []);
  assert.deepEqual(single.find((n) => n.key === "surface.front").dependsOn, ["surface.driver", "surface.passenger"]);
  assert.throws(() => graph.validateGraph([{ key: "a", dependsOn: ["b"] }, { key: "b", dependsOn: ["a"] }]), { code: "designpro_atlas_call1_dependency_cycle" });
});

test("2+3. the database claims ready nodes in parallel, only for a leased request, with per-node retry and resume", async () => {
  const db = await createAtlasCall1Database();
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const created = await createRun(db, manifest);
  assert.equal(created.created, true);
  assert.equal(created.nodes.length, 9, "driver.view + front.view + six surfaces + master.assemble");
  const again = await createRun(db, manifest);
  assert.equal(again.created, false, "the same request + definition resumes its run");
  assert.equal(again.run.id, created.run.id);

  // BOTH VIEW NODES ARE ROOTS: driver's and front's are claimable in the same
  // instant, on two different workers, before a single surface exists.
  const roots = [await claim(db, "w1"), await claim(db, "w2")];
  assert.deepEqual(roots.map((r) => r.node.node_key).sort(), [graph.DRIVER_VIEW_NODE, graph.viewNode("front")].sort());
  assert.equal(roots[0].claimToken, CLAIM, "the claim carries the generation's current lease token");
  assert.equal(await claim(db, "w1"), null, "nothing else is ready while both vehicle-sheet views run");
  const driverView = roots.find((r) => r.node.node_key === graph.DRIVER_VIEW_NODE);
  const frontView = roots.find((r) => r.node.node_key === graph.viewNode("front"));
  await finish(db, driverView.node, "completed", { view: { storagePath: "v", contentHash: "1".repeat(64), byteSize: 1 } });
  await finish(db, frontView.node, "completed", { view: { storagePath: "vf", contentHash: "2".repeat(64), byteSize: 1 } });

  let c = await claim(db, "w1");
  assert.equal(c.node.node_key, "surface.driver");
  assert.equal(c.dependencies[0].nodeKey, graph.DRIVER_VIEW_NODE);
  assert.equal(c.dependencies[0].output.view.contentHash, "1".repeat(64), "node 3 is handed node 1's identity, never its bytes");
  assert.equal(await claim(db, "w2"), null, "nothing else is ready while driver runs -- front's flatten still needs driver + passenger too");
  // A retryable failure re-arms the node with a backoff, attempt kept.
  await finish(db, c.node, "pending", { errorCode: "transport", retryable: true });
  let row = (await db.query("SELECT state,attempt,available_at>now() AS backoff FROM public.designpro_atlas_call1_nodes WHERE node_key='surface.driver'")).rows[0];
  assert.equal(row.state, "pending"); assert.equal(row.attempt, 1); assert.equal(row.backoff, true);
  await db.query("UPDATE public.designpro_atlas_call1_nodes SET available_at=now() WHERE node_key='surface.driver'");
  c = await claim(db, "w1");
  assert.equal(c.node.node_key, "surface.driver"); assert.equal(c.node.attempt, 2);
  await finish(db, c.node, "completed", { sheet: { storagePath: "x", contentHash: "a".repeat(64), byteSize: 1 } });
  c = await claim(db, "w2");
  assert.equal(c.node.node_key, "surface.passenger");
  assert.equal(c.dependencies.length, 1);
  assert.equal(c.dependencies[0].nodeKey, "surface.driver");
  assert.equal(c.dependencies[0].output.sheet.contentHash, "a".repeat(64), "the claim carries every dependency's output");
  await finish(db, c.node, "completed", { sheet: { storagePath: "y", contentHash: "b".repeat(64), byteSize: 1 } });

  // THE PARALLEL WAVE: FOUR claims in a row now -- roof joined hood/front/rear
  // instead of holding a sequential wave of its own -- then nothing.
  const wave = [await claim(db, "w1"), await claim(db, "w2"), await claim(db, "w1"), await claim(db, "w2")];
  assert.deepEqual(wave.map((x) => x.node.node_key).sort(), ["surface.front", "surface.hood", "surface.rear", "surface.roof"]);
  assert.equal(await claim(db, "w1"), null);
  assert.deepEqual(new Set(wave.map((x) => x.node.lease_owner)), new Set(["w1", "w2"]));

  // Lease gating: the generation lease lapses → nothing is claimable, even a ready node.
  await finish(db, wave[0].node, "completed", { sheet: { storagePath: "h", contentHash: "c".repeat(64), byteSize: 1 } });
  await finish(db, wave[1].node, "completed", { sheet: { storagePath: "f", contentHash: "d".repeat(64), byteSize: 1 } });
  await finish(db, wave[2].node, "completed", { sheet: { storagePath: "r", contentHash: "e".repeat(64), byteSize: 1 } });
  await db.query("UPDATE public.designpro_generation_requests SET state='retryable', lease_token=NULL");
  assert.equal(await claim(db, "w1"), null, "an unleased request's nodes are never handed out");
  await db.query(`UPDATE public.designpro_generation_requests SET state='leased', lease_token='${CLAIM}', lease_expires_at=now()+interval '10 minutes'`);
  c = wave[3];

  // Attempts exhausted: retryable failures stop at max_attempts and fail the run; resume re-arms them.
  await finish(db, c.node, "pending", { errorCode: "transport", retryable: true });
  await db.query("UPDATE public.designpro_atlas_call1_nodes SET available_at=now(), attempt=max_attempts-1 WHERE node_key='surface.roof'");
  c = await claim(db, "w2");
  const failedRun = await finish(db, c.node, "pending", { errorCode: "transport", retryable: true });
  assert.equal(failedRun.state, "failed");
  row = (await db.query("SELECT state,error_code FROM public.designpro_atlas_call1_nodes WHERE node_key='surface.roof'")).rows[0];
  assert.equal(row.state, "failed"); assert.equal(row.error_code, "attempts_exhausted");
  assert.equal(await claim(db, "w1"), null, "a failed run hands out nothing");
  const resumed = (await db.query("SELECT public.resume_designpro_atlas_call1_run($1) AS r", [failedRun.id])).rows[0].r;
  assert.equal(resumed.state, "running");
  c = await claim(db, "w1");
  assert.equal(c.node.node_key, "surface.roof"); assert.equal(c.node.attempt, 1);
  await finish(db, c.node, "completed", { sheet: { storagePath: "o", contentHash: "f".repeat(64), byteSize: 1 } });
  c = await claim(db, "w2");
  assert.equal(c.node.node_key, "master.assemble");
  assert.equal(c.dependencies.length, 8, "driver.view + front.view + six surfaces");
  const done = await finish(db, c.node, "completed", { master: { storagePath: "m", contentHash: "9".repeat(64), byteSize: 7 } });
  assert.equal(done.state, "completed");
  assert.equal(done.master_content_hash, "9".repeat(64));
  assert.equal(done.master_byte_size, 7);
  // A creative refusal is final: resume does not re-arm it.
  const refusal = { errorCode: "flat_atlas_hero_driver_refused", retryable: false, surfaceKey: "hood" };
  await db.query(`UPDATE public.designpro_atlas_call1_nodes SET state='failed',output=$1,error_code='flat_atlas_hero_driver_refused' WHERE node_key='surface.hood'`, [JSON.stringify(refusal)]);
  await db.query("UPDATE public.designpro_atlas_call1_runs SET state='failed'");
  const still = (await db.query("SELECT public.resume_designpro_atlas_call1_run($1) AS r", [failedRun.id])).rows[0].r;
  assert.equal(still.state, "failed");
  // The events ledger recorded every transition, with the worker that held each lease.
  const events = (await db.query("SELECT node_key,state,lease_owner FROM public.designpro_atlas_call1_events ORDER BY id")).rows;
  assert.ok(events.filter((e) => e.node_key === "surface.driver" && e.state === "running").length >= 2);
  assert.ok(events.some((e) => e.node_key === "surface.hood" && e.state === "running" && e.lease_owner));
  await assert.rejects(db.query("DELETE FROM public.designpro_atlas_call1_events"), /immutable_record/);
});

test("4. end to end across two node workers: seven image requests, passenger a flop, one assembled 4096² master, nothing spent twice", async () => {
  const db = await createAtlasCall1Database();
  const files = new Map();
  const adapter = createAtlasCall1Adapter(db, files);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const callEdge = syntheticEdge(calls);
  const log = [];
  const logger = (m) => log.push(m);
  // The request's owner: one slot, ticked inline while it awaits. The other
  // runtime process: two slots, polling fast. Hood/front/rear must spread.
  const owner = graph.createAtlasCall1NodeWorker({ supabase: adapter.supabase, workerId: "runtime-1-call1-graph", callEdge, concurrency: 1, pollMs: 10_000, heartbeatMs: 200, logger });
  const other = graph.createAtlasCall1NodeWorker({ supabase: adapter.supabase, workerId: "runtime-2-call1-graph", callEdge, concurrency: 2, pollMs: 25, heartbeatMs: 200, logger });
  other.start();
  try {
    const result = await owner.author({ manifest, input: INPUT, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER,
      creativeContext: "Test Co · trade", providerRequest: { requestId: REQUEST, generationId: GENERATION, claimToken: CLAIM }, logger, pollMs: 20, timeoutMs: 60_000 });
    // 7, not 6: front is hero-view-eligible on the same measured evidence as
    // driver, so it is ALSO two calls (view + flatten). Both view calls race as
    // graph roots, so they are identified by shape (first + no heroViewStoragePath),
    // never by array index -- only the SEQUENTIAL pairs (view before its own
    // flatten; driver's flatten before hood/front/rear; those before roof) are
    // load-bearing, and those are asserted as relative order, not position.
    assert.equal(calls.length, 7, "driver view, driver flatten, front view, front flatten, hood, rear, roof");
    const driverView = calls.find((c) => c.surfaceKey === "driver" && c.first === true && !c.heroViewStoragePath);
    const driverFlatten = calls.find((c) => c.surfaceKey === "driver" && Boolean(c.heroViewStoragePath));
    const frontView = calls.find((c) => c.surfaceKey === "front" && c.first === true && !c.heroViewStoragePath);
    const frontFlatten = calls.find((c) => c.surfaceKey === "front" && Boolean(c.heroViewStoragePath));
    const hood = calls.find((c) => c.surfaceKey === "hood");
    const rear = calls.find((c) => c.surfaceKey === "rear");
    const roof = calls.find((c) => c.surfaceKey === "roof");
    for (const c of [driverView, driverFlatten, frontView, frontFlatten, hood, rear, roof]) assert.ok(c, "every expected call landed");

    // NODE 1 -> NODE 3, for EACH eligible surface. Two distinct node rows, two
    // distinct requests, and the handoff between them is the stored render's
    // identity, never its bytes.
    assert.equal(driverView.heroViewStoragePath, undefined, "node 1 draws from scratch");
    assert.equal(driverView.providerRequest.attemptKey, "author:driver-view:1");
    assert.equal(frontView.heroViewStoragePath, undefined, "front's node 1 also draws from scratch");
    assert.equal(frontView.providerRequest.attemptKey, "author:front-view:1");
    // Node 1's render is a Call-1 INPUT for node 3, so it is staged like one --
    // the edge attaches only from this prefix. True for BOTH pairs.
    for (const flatten of [driverFlatten, frontFlatten]) {
      assert.match(flatten.heroViewStoragePath, /^atlas-call1-inputs\/[0-9a-f]{64}\.(?:png|jpg)$/,
        "node 3 consumes node 1 by a path the edge will actually attach");
      assert.match(flatten.heroViewContentHash, /^[0-9a-f]{64}$/, "…and by content hash — an immutable reference");
      assert.equal(flatten.heroViewStoragePath, `atlas-call1-inputs/${flatten.heroViewContentHash}.jpg`,
        "the path IS the hash: content-addressed, so the edge can verify what it read");
      assert.equal(flatten.heroFlattenTier, 0);
    }
    // THE FLATTEN CONTINUES ITS OWN VIEW'S CONVERSATION. Node 1's exchange is
    // replayed WITH its thought signature on the part it arrived on -- the
    // multi-turn spatial reasoning RULE 0.35 requires, on the hop that most
    // needs it. Asserted as ARRIVING at the edge, not merely as being stored.
    // Driver has no other history, so its flatten replays exactly one exchange.
    assert.ok(Array.isArray(driverFlatten.priorTurns) && driverFlatten.priorTurns.length === 2,
      "driver's flatten replays only its own view");
    assert.equal(driverFlatten.priorTurns[1].parts[0].thoughtSignature, "sig-driver-view",
      "…and the VIEW's signature rides on the model part it arrived on");
    assert.equal(driverFlatten.priorTurns[1].parts[0].imageRef.storagePath, "atlas-author/driver-view.png",
      "the replayed turn carries an image REFERENCE, never pixels");
    // A FLATTEN REPLAYS ONLY ITS OWN VIEW -- exactly what driver's flatten
    // does. It used to also replay driver's flank, and trimAuthoringHistory
    // PINS that exchange outside the byte budget, so the heaviest image in the
    // request was the one guaranteed never to be trimmed. Live 9c6008ec: HTTP
    // 546, the edge worker exhausted, on all eight attempts.
    assert.ok(Array.isArray(frontFlatten.priorTurns) && frontFlatten.priorTurns.length === 2,
      "front's flatten replays its own view and nothing else");
    assert.equal(frontFlatten.priorTurns[1].parts[0].thoughtSignature, "sig-front-view",
      "its own view's signature, on the part it arrived on");
    assert.equal(frontFlatten.priorTurns[1].parts[0].imageRef.storagePath, "atlas-author/front-view.png");
    assert.ok(!frontFlatten.priorTurns.some((t) => (t.parts || []).some((p) => p.thoughtSignature === "sig-driver")),
      "driver's flank is NOT replayed into a flatten: it is the pinned, unbudgeted image that OOM'd the worker");
    // A FLATTEN CARRIES NO NEIGHBOUR IMAGES. Live 9c6008ec returned HTTP 546
    // (edge worker OOM) on surface.front, eight attempts, because the flatten
    // sent its full-size view render PLUS driver PLUS passenger PLUS four
    // replayed turns in one invocation. Driver's flatten never hit it only
    // because driver's neighbour list is empty. Continuity is the replayed
    // exchange above; the view render is the subject.
    assert.deepEqual(frontFlatten.neighbours, [],
      "a flatten sends no neighbour images -- that combination OOM'd the edge worker on every attempt");
    // Node 1 itself still draws from scratch, for BOTH surfaces: a hero-view
    // with history would be a second creative authority.
    assert.deepEqual(driverView.priorTurns, [], "the driver vehicle view replays nothing");
    assert.deepEqual(frontView.priorTurns, [], "the front vehicle view replays nothing");
    assert.deepEqual([hood, rear].map((c) => c.surfaceKey).sort(), ["hood", "rear"]);
    for (const call of [hood, rear, roof]) {
      assert.equal(call.priorTurns[1].parts[0].thoughtSignature, "sig-driver", `${call.surfaceKey} replays the driver FLANK's signature, not a vehicle view's`);
      assert.equal(call.providerRequest.claimToken, CLAIM, "the edge is authorised with the generation's lease token");
      assert.match(call.providerRequest.attemptKey, /^author:[a-z]+:\d$/);
    }
    for (const call of calls) assert.equal(call.providerRequest.claimToken, CLAIM);
    assert.deepEqual(roof.neighbours.map((n) => n.surfaceKey), ["driver", "passenger"],
      "roof is shown the two flanks only -- five images exhausted the edge worker on live 194e8f17");
    // SEQUENTIAL PRECEDENCE, the only ordering that is actually load-bearing:
    // each view before its own flatten; driver's flatten before every surface
    // that replays it; hood/front/rear before roof.
    const at = (c) => calls.indexOf(c);
    assert.ok(at(driverView) < at(driverFlatten), "driver's view precedes its flatten");
    assert.ok(at(frontView) < at(frontFlatten), "front's view precedes its flatten");
    assert.ok(at(driverFlatten) < at(frontFlatten), "front's flatten waits for driver's flank");
    assert.ok(at(driverFlatten) < at(hood) && at(driverFlatten) < at(rear), "hood/rear wait for driver's flank");
    for (const c of [hood, frontFlatten, rear]) assert.ok(at(c) < at(roof), "roof waits for hood, front and rear");
    const meta = await sharp(result.bytes).metadata();
    assert.equal(meta.width, 4096); assert.equal(meta.height, 4096);
    assert.equal(sha(result.bytes), result.contentHash);
    assert.equal(result.imageRequestCount, 7, "both view requests are SPENT and are counted");
    assert.equal(result.model, "gemini-3-pro-image");
    assert.equal(result.promptVersion, hero.HERO_DRIVER_PROMPT_VERSION);
    assert.equal(result.provenance.contract, hero.HERO_DRIVER_CONTRACT);
    assert.equal(result.provenance.execution, "graph");
    assert.equal(result.provenance.graph.contract, graph.GRAPH_CONTRACT);
    assert.equal(result.provenance.graph.nodes.length, 9, "6 surfaces + driver's view + front's view + the assemble node");
    assert.ok(result.provenance.graph.nodes.some((n) => n.nodeKey === graph.DRIVER_VIEW_NODE), "the ledger records who drew node 1");
    assert.ok(result.provenance.graph.nodes.some((n) => n.nodeKey === graph.viewNode("front")), "…and who drew front's node 1");
    const passenger = result.surfaces.find((s) => s.surfaceKey === "passenger");
    assert.equal(passenger.method, "hero_driver_passenger_flop"); assert.equal(passenger.deterministic, true);
    assert.equal(result.surfaces.filter((s) => s.deterministic === false).length, 5);
    assert.equal(result.surfaces.find((s) => s.surfaceKey === "driver").method, "hero_first_flattened");
    const owners = new Set(result.provenance.graph.nodes.map((n) => n.leaseOwner));
    assert.ok(owners.has("runtime-1-call1-graph") && owners.has("runtime-2-call1-graph"), `both workers held leases: ${[...owners].join(", ")}`);
    // Every surface and the master are immutable, content-addressed artifacts of the run.
    const { rows } = await db.query("SELECT master_storage_path,state FROM public.designpro_atlas_call1_runs");
    assert.equal(rows[0].state, "completed");
    assert.match(rows[0].master_storage_path, /^atlas-call1-graph\/[0-9a-f-]{36}\/master-[0-9a-f]{64}\.png$/);
    assert.ok(files.has(rows[0].master_storage_path));
    assert.equal([...files.keys()].filter((p) => /^atlas-call1-graph\/.*\/(driver|passenger|hood|front|rear|roof)-[0-9a-f]{64}\.png$/.test(p)).length, 6);
    assert.ok(log.some((m) => /surface\.hood completed on runtime-\d-call1-graph/.test(m)));

    // RESUME: the same request authored again (a re-claimed generation) reads the completed run. Zero new image requests.
    const before = calls.length;
    const again = await owner.author({ manifest, input: INPUT, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER,
      creativeContext: "Test Co · trade", providerRequest: { requestId: REQUEST, generationId: GENERATION, claimToken: CLAIM }, logger, pollMs: 20 });
    assert.equal(calls.length, before);
    assert.equal(again.contentHash, result.contentHash);
    assert.deepEqual(other.health().running, []);
  } finally {
    other.stop(); owner.stop();
  }
});

test("4b. THE CUSTOMER IS HANDED THE COMPOSITED SHEET, not the clean base", async () => {
  // The defect this exists to prevent, named by the owner before a live run
  // found it: the panels are cut from what author() RETURNS and the Driver proof
  // is conditioned on it, so returning master.assemble's Layer 0 would show the
  // customer a wrap with no company name anywhere on it. The element graph
  // designs the lettering separately precisely so it can be composited back on
  // without healing; handing back the base throws that away at the last step.
  const before = process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
  process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = "on";
  const db = await createAtlasCall1Database();
  const files = new Map();
  const adapter = createAtlasCall1Adapter(db, files);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const branded = { ...INPUT, companyName: "Precision Climate Solutions", phone: "(520) 555-0192" };
  const worker = graph.createAtlasCall1NodeWorker({
    supabase: adapter.supabase, workerId: "runtime-1-elements", callEdge: syntheticEdge(calls),
    concurrency: 3, pollMs: 25, heartbeatMs: 200, logger: () => {},
  });
  try {
    const result = await worker.author({
      manifest, input: branded, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER,
      creativeContext: "Precision Climate Solutions · trade",
      providerRequest: { requestId: REQUEST, generationId: GENERATION, claimToken: CLAIM },
      logger: () => {}, pollMs: 20, timeoutMs: 60_000,
    });

    // The element nodes cost NOTHING at the model: still exactly the surface
    // authoring calls (7 -- driver + front are each two, hood/rear/roof one).
    assert.equal(calls.length, 7, "elements are deterministic — they add no image request");

    // Layer 0 is recorded and preserved; what came back is NOT it.
    assert.match(result.cleanMasterHash, /^[0-9a-f]{64}$/, "the clean base is kept as provenance");
    assert.notEqual(result.contentHash, result.cleanMasterHash,
      "the customer must not be handed the unbranded sheet");

    // Two elements across two flanks.
    assert.equal(result.elementsApplied.length, 4);
    assert.deepEqual([...new Set(result.elementsApplied.map((e) => e.surfaceKey))].sort(), ["driver", "passenger"]);
    assert.deepEqual([...new Set(result.elementsApplied.map((e) => e.role))].sort(), ["contact", "typography"]);
    for (const applied of result.elementsApplied) assert.equal(applied.flipped, false);

    // AND IT IS ACTUALLY ON THE PIXELS. Crop the driver flank out of the sheet
    // the customer receives and out of Layer 0, and prove they differ — a
    // receipt saying "4 applied" over an unchanged sheet is the shape of defect
    // CLAUDE.md warns about by name ("do not report status from receipts").
    const cleanPath = [...files.keys()].find((k) => k.includes(`master-${result.cleanMasterHash}`));
    assert.ok(cleanPath, "Layer 0 must be persisted in its own right");
    const zone = manifest.zones.find((z) => z.surfaceKey === "driver");
    const crop = async (bytes) => sharp(bytes)
      .extract({ left: zone.trim.x, top: zone.trim.y, width: zone.trim.w, height: zone.trim.h })
      .raw().toBuffer();
    const cleanFlank = await crop(files.get(cleanPath));
    const shownFlank = await crop(result.bytes);
    assert.notEqual(Buffer.compare(cleanFlank, shownFlank), 0,
      "the driver flank the customer sees must carry the lettering, not be the bare base");

    // The ink is the typeset colour, not noise.
    let dark = 0;
    for (let i = 0; i + 2 < shownFlank.length; i += 3) {
      if (shownFlank[i] < 80 && shownFlank[i + 1] < 90 && shownFlank[i + 2] < 100) dark += 1;
    }
    assert.ok(dark > 500, `expected real lettering on the driver flank, found ${dark} ink pixels`);
  } finally {
    worker.stop?.();
    if (before === undefined) delete process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
    else process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = before;
  }
});

test("5a. a refused FLATTEN never re-bills the vehicle view: node 1 completes once and node 3 fails alone", async () => {
  const db = await createAtlasCall1Database();
  const adapter = createAtlasCall1Adapter(db);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  // `refuse: "driver"` only reaches the FLATTEN — the vehicle view answers at
  // its own 16:9 shape and is never judged against the flank's aspect.
  const worker = graph.createAtlasCall1NodeWorker({ supabase: adapter.supabase, workerId: "solo", callEdge: syntheticEdge(calls, { refuse: "driver" }), concurrency: 3, pollMs: 10_000, heartbeatMs: 200 });
  try {
    await assert.rejects(
      worker.author({ manifest, input: INPUT, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER, providerRequest: { requestId: REQUEST, generationId: GENERATION }, pollMs: 20, timeoutMs: 60_000 }),
      (error) => error instanceof hero.HeroDriverRefusal && error.surfaceKey === "driver",
    );
    // THIS IS WHAT THE SPLIT BUYS. One vehicle-view request, the flatten's own
    // bounded two — in a single node the refusal would have spent the render
    // again on every attempt. Front's own view also fires (it is a root,
    // independent of driver's fate), but front's flatten never becomes
    // claimable -- it depends on surface.driver, which never completes -- so
    // it must not be confused with driver's calls here.
    assert.equal(calls.filter((c) => c.surfaceKey === "driver" && !c.heroViewStoragePath).length, 1, "node 1 ran exactly once");
    assert.equal(calls.filter((c) => c.surfaceKey === "driver" && c.heroViewStoragePath).length, hero.AUTHOR_ATTEMPTS, "node 3 spent its own budget and no more");
    assert.equal(calls.filter((c) => c.surfaceKey === "front").length, 1, "front's OWN view still ran -- it is a root, independent of driver's refusal");
    assert.ok(!calls.some((c) => c.surfaceKey === "front" && c.heroViewStoragePath), "front's flatten never became claimable: it depends on the driver flank that never completed");
    const rows = (await db.query("SELECT node_key,state,error_code FROM public.designpro_atlas_call1_nodes WHERE node_key IN ($1,'surface.driver') ORDER BY node_key", [graph.DRIVER_VIEW_NODE])).rows;
    assert.deepEqual(rows.map((r) => [r.node_key, r.state]), [["surface.driver", "failed"], [graph.DRIVER_VIEW_NODE, "completed"]]);
    // Node 1's output stayed a reference. No pixels were written into the row.
    const view = (await db.query("SELECT output FROM public.designpro_atlas_call1_nodes WHERE node_key=$1", [graph.DRIVER_VIEW_NODE])).rows[0].output;
    assert.equal(view.stage, "vehicle-view");
    assert.match(view.view.storagePath, /^atlas-call1-inputs\/[0-9a-f]{64}\.jpg$/);
    assert.match(view.view.contentHash, /^[0-9a-f]{64}$/);
    assert.ok(view.view.byteSize > 0);
    assert.ok(!JSON.stringify(view).includes("base64"), "the handoff is an identity, never a blob");
  } finally {
    worker.stop();
  }
});

// 5. ONE REFUSED PANEL MUST NOT DISCARD THE RUN.
//
// Measured 2026-09-17 across SIX consecutive live runs: master.assemble was
// `pending` on every one and has never once completed. Each had authored
// driver, passenger, hood and rear cleanly and had already produced the
// separated elements -- typeset.produce, contact.produce and element.lockup all
// `completed` -- and threw every bit of it away because ONE surface (front, a
// bumper fascia) was refused. The run then failed over to six-surface, which
// bakes lettering into pixels. So master.composite has never run, no customer
// has ever received the clean base + composited lockup, and every delivered
// sheet still looks exactly like it did before the DAG existed.
//
// A refused non-driver panel is now continued deterministically from this
// design's own authored artwork (no model call, no invented design) so the
// sheet assembles and the element composite can finally happen. Driver still
// fails the run: it is the design's origin, with nothing to continue from.
test("5. a refused NON-DRIVER panel continues deterministically and the sheet still assembles", async () => {
  const db = await createAtlasCall1Database();
  const adapter = createAtlasCall1Adapter(db);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const worker = graph.createAtlasCall1NodeWorker({ supabase: adapter.supabase, workerId: "solo", callEdge: syntheticEdge(calls, { refuse: "hood" }), concurrency: 3, pollMs: 10_000, heartbeatMs: 200 });
  try {
    const result = await worker.author({ manifest, input: INPUT, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER, providerRequest: { requestId: REQUEST, generationId: GENERATION }, pollMs: 20, timeoutMs: 60_000 });
    assert.ok(result?.contentHash, "the master assembles despite the refusal -- this is the whole point");

    // hood still spent its bounded budget and no more: the continuation is a
    // last resort, never a way to skip authoring.
    assert.equal(calls.filter((c) => c.surfaceKey === "hood").length, hero.AUTHOR_ATTEMPTS);
    const hood = result.surfaces.find((s) => s.surfaceKey === "hood");
    assert.equal(hood.method, "hero_driver_neighbour_continuation");
    assert.equal(hood.deterministic, true);
    assert.equal(hood.imageRequestCount, 0, "a continuation spends no image request");
    assert.match(hood.refusalReason, /aspect_drift/, "the refusal that caused it is recorded, never hidden");

    // master.assemble reached `completed` -- the state six live runs never saw.
    const assembled = (await db.query("SELECT state FROM public.designpro_atlas_call1_nodes WHERE node_key='master.assemble'")).rows[0];
    assert.equal(assembled.state, "completed");
  } finally { worker.stop(); }
});

test("5b. a refused DRIVER still fails the run: it is the origin, with nothing to continue from", async () => {
  const db = await createAtlasCall1Database();
  const adapter = createAtlasCall1Adapter(db);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const worker = graph.createAtlasCall1NodeWorker({ supabase: adapter.supabase, workerId: "solo", callEdge: syntheticEdge(calls, { refuse: "driver" }), concurrency: 3, pollMs: 10_000, heartbeatMs: 200 });
  try {
    await assert.rejects(
      worker.author({ manifest, input: INPUT, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER, providerRequest: { requestId: REQUEST, generationId: GENERATION }, pollMs: 20, timeoutMs: 60_000 }),
      (error) => error instanceof hero.HeroDriverRefusal && error.code === "flat_atlas_hero_driver_refused" && error.surfaceKey === "driver",
    );
    const run = (await db.query("SELECT state,error_code FROM public.designpro_atlas_call1_runs")).rows[0];
    assert.equal(run.state, "failed"); assert.equal(run.error_code, "flat_atlas_hero_driver_refused");
    // Resuming does nothing: the refusal is final and the caller fails over.
    await assert.rejects(worker.author({ manifest, input: INPUT, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER, providerRequest: { requestId: REQUEST, generationId: GENERATION }, pollMs: 20 }),
      (error) => error instanceof hero.HeroDriverRefusal);
  } finally { worker.stop(); }
});

test("6. the runtime seams: the hero branch runs through the injected graph unless switched off; the worker is started, passed and reported", () => {
  const runtimeSrc = fs.readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  const workerSrc = fs.readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
  const indexSrc = fs.readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");
  const graphSrc = fs.readFileSync(new URL("../runtime/atlas-call1-graph.cjs", import.meta.url), "utf8");
  const heroSrc = fs.readFileSync(new URL("../runtime/atlas-hero-driver.cjs", import.meta.url), "utf8");
  const seam = runtimeSrc.slice(runtimeSrc.indexOf("async function generateOrReuseFlatAtlasResolved("));
  assert.match(seam, /const graphWorker = options\.atlasCall1Graph && atlasCall1GraphEnabled\(\) \? options\.atlasCall1Graph : null;/);
  assert.match(seam, /hero = await graphWorker\.author\(\{ \.\.\.heroArgs, requestId, generationId, ownerId \}\);/);
  assert.match(seam, /if \(graphCause\?\.code !== "designpro_atlas_call1_graph_unavailable"\) throw graphCause;/);
  assert.match(seam, /hero = await authorHeroDriverMaster\(heroArgs\);/);
  // One transport, both executions.
  assert.match(seam, /callEdge: createAtlasAuthorTransport\(\{ supabase, callAuthorEdge, ownerId \}\)/);
  assert.match(indexSrc, /callEdge: createAtlasAuthorTransport\(\{ supabase \}\)/);
  assert.match(workerSrc, /atlasCall1Graph = null,/);
  assert.match(workerSrc, /provider: imageProvider,\n\s*atlasCall1Graph,\n\s*requestId,/);
  assert.match(indexSrc, /const atlasCall1Graph = createAtlasCall1NodeWorker\(\{/);
  assert.match(indexSrc, /atlasCall1Graph\.start\(\);/);
  assert.match(indexSrc, /atlasCall1Graph\.stop\(\);/);
  assert.match(indexSrc, /atlasCall1Graph: atlasCall1Graph\.health\(\),/);
  // The node executor runs the cascade's OWN primitives and nothing creative of its own.
  assert.match(graphSrc, /hero\.authorSurface\(\{/);
  assert.match(graphSrc, /hero\.composePassengerPlaceholder\(/);
  assert.match(graphSrc, /hero\.assembleHeroMaster\(\{/);
  assert.ok(!graphSrc.includes("generativelanguage.googleapis.com") && !/buildDesignIQPrompt/.test(graphSrc), "no model call, no prompt in the graph");
  const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/vertex|imagen|aiplatform|flash-image/i.test(codeOnly(graphSrc)));
  assert.match(heroSrc, /return assembleHeroMaster\(\{ manifest, authored, stageTimings, startedAt, execution: "in-process" \}\);/);
  // Kill switch semantics.
  const previous = process.env.DESIGNPRO_ATLAS_CALL1_GRAPH;
  try {
    delete process.env.DESIGNPRO_ATLAS_CALL1_GRAPH;
    assert.equal(graph.graphEnabled(), true, "on by default: the graph is the product");
    process.env.DESIGNPRO_ATLAS_CALL1_GRAPH = "OFF ";
    assert.equal(graph.graphEnabled(), false);
    process.env.DESIGNPRO_ATLAS_CALL1_GRAPH = "on";
    assert.equal(graph.graphEnabled(), true);
  } finally {
    if (previous === undefined) delete process.env.DESIGNPRO_ATLAS_CALL1_GRAPH; else process.env.DESIGNPRO_ATLAS_CALL1_GRAPH = previous;
  }
  // The migration is service-role only and joins the generation lease into the claim.
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260911170000_designpro_atlas_call1_graph.sql", import.meta.url), "utf8");
  assert.match(migration, /g\.state='leased' AND g\.lease_token IS NOT NULL AND g\.lease_expires_at>now\(\)/);
  assert.match(migration, /FOR UPDATE OF n SKIP LOCKED LIMIT 1/);
  assert.match(migration, /REVOKE ALL ON public\.%I FROM PUBLIC,anon,authenticated/);
});

/**
 * THE ELEMENT GRAPH MUST BE REACHABLE WITHOUT THE HERO CASCADE. (2026-09-18.)
 *
 * typeset.produce / contact.produce / logo.prepare / element.lockup /
 * master.composite were all built, deterministic and correct -- and compiled
 * ONLY inside compileHeroDriverGraph, so with hero-driver off (production) they
 * never ran. Live efca5e03 recorded zero graph runs and zero nodes; across all
 * history there are 6 master.composite rows and ONE completed. No customer has
 * ever received a clean base with a composited lockup, which is why lettering
 * is still diffusion paint. DESIGNPRO_ATLAS_ELEMENT_GRAPH=on was already live
 * on the droplet and inert for exactly that reason.
 */
test("the element subgraph compiles standalone, with no master node to wait for", () => {
  const nodes = graph.compileElementGraph({ input: { companyName: "Oasis Pools", phone: "555-0142", website: "oasispools.com" } });
  assert.deepEqual(nodes.map((n) => n.key),
    ["typeset.produce", "contact.produce", "element.lockup", "master.composite"]);
  // The producers are ROOTS -- they need the brief, never the sheet -- so they
  // are claimable immediately and by either worker.
  assert.deepEqual(nodes.find((n) => n.key === "typeset.produce").dependsOn, []);
  assert.deepEqual(nodes.find((n) => n.key === "contact.produce").dependsOn, []);
  // And the composite waits ONLY for the plan: its base is the already-accepted
  // master, which arrives on the run definition as a reference.
  assert.deepEqual(nodes.find((n) => n.key === "master.composite").dependsOn, ["element.lockup"]);
});

test("the hero cascade still makes the composite wait for the assembled sheet", () => {
  const previous = process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
  process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = "on";
  try {
    const nodes = graph.compileHeroDriverGraph({ heroFirst: false, input: { companyName: "Oasis Pools", phone: "555-0142" } });
    // One builder serves both shapes, so they cannot drift -- but the hero
    // composite must still depend on master.assemble, or it would composite
    // onto a sheet that does not exist yet.
    assert.deepEqual(nodes.find((n) => n.key === "master.composite").dependsOn,
      ["master.assemble", "element.lockup"]);
  } finally {
    if (previous === undefined) delete process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
    else process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = previous;
  }
});

test("a brief with nothing to place compiles no element nodes at all", () => {
  // Layer 0 IS the product here. validateGraph refuses a zero-node graph, and
  // correctly so -- the create RPC does too -- but an empty element set is an
  // answer, not a malformed graph, and it must not throw on the way out.
  assert.deepEqual(graph.compileElementGraph({ input: {} }), []);
  assert.deepEqual(graph.compileElementGraph({ input: { brief: "teal water, no branding" } }), []);
  // One field is enough to earn a lockup.
  assert.equal(graph.compileElementGraph({ input: { companyName: "Oasis Pools" } }).length, 3);
  assert.equal(graph.compileElementGraph({ input: { phone: "555-0142" } }).length, 3);
});

test("the contact node still cannot invent a line the customer never gave", () => {
  // The invention lock is structural, not prose: a node sets the strings it was
  // handed. A website with no phone produces a one-line bar, not a filled one.
  const nodes = graph.compileElementGraph({ input: { companyName: "Oasis Pools", website: "oasispools.com" } });
  assert.deepEqual(nodes.find((n) => n.key === "contact.produce").input.lines, ["oasispools.com"]);
  assert.equal(nodes.find((n) => n.key === "typeset.produce").input.text, "Oasis Pools");
});

// ---------------------------------------------------------------------------
// THE SIX-SURFACE DOOR, EXECUTED — not merely compiled.
//
// Everything above this line that RUNS the element nodes runs them through
// `author()`, the HERO cascade. Production does not route through that door:
// hero-driver is off, six-surface is the topology, and the door it uses is
// `authorElements()` — the standalone shape with no master.assemble, whose base
// arrives as the already-accepted sheet's `masterRef`. Until this test that door
// had only ever been COMPILE-checked (`compileElementGraph` shape assertions),
// so the code path every v28 generation takes had never once been executed.
//
// It also executes the only branch `20260918030000` exists for. An element-only
// run has no master.assemble, so nothing writes the run's master columns, and
// its final node sets state='completed' straight into
//
//   CHECK (state<>'completed' OR (... master_storage_path IS NOT NULL ...))
//
// — raising AFTER the work is done, which is the worst possible moment and the
// exact failure `authorElements` cannot recover from (with cleanBase on, Layer 0
// carries no company name, so neither shipping nor failing is acceptable). The
// fixture now applies both migrations, so this test proves the branch rather
// than assuming it.
test("6. authorElements: the six-surface door runs end to end and the run completes on master.composite", async () => {
  const previous = process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
  process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = "on";
  const db = await createAtlasCall1Database();
  const files = new Map();
  const adapter = createAtlasCall1Adapter(db, files);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const branded = { ...INPUT, companyName: "Oasis Pools", phone: "(520) 555-0142" };

  // The ALREADY-ACCEPTED sheet. Six-surface authors and accepts this before a
  // single element node is claimed, so it enters as an identity, never bytes.
  const acceptedBytes = await paint(manifest.canvas.widthPx, manifest.canvas.heightPx, "#1f6f4a");
  const masterRef = {
    storagePath: `atlas-call1/${REQUEST}/master-${sha(acceptedBytes)}.png`,
    contentHash: sha(acceptedBytes),
    byteSize: acceptedBytes.length,
  };
  files.set(masterRef.storagePath, acceptedBytes);

  const worker = graph.createAtlasCall1NodeWorker({
    supabase: adapter.supabase, workerId: "runtime-1-six-surface", callEdge: syntheticEdge(calls),
    concurrency: 3, pollMs: 25, heartbeatMs: 200, logger: () => {},
  });
  try {
    const result = await worker.authorElements({
      masterRef, manifest, input: branded,
      requestId: REQUEST, generationId: GENERATION, ownerId: OWNER,
      logger: () => {}, pollMs: 20, timeoutMs: 60_000,
    });

    assert.ok(result, "the six-surface door must return a composited sheet, not null");
    // NOT ONE IMAGE REQUEST. The elements are typeset and composited in code;
    // if this ever moves, the element graph has grown a second design authority.
    assert.equal(calls.length, 0, "the element subgraph is deterministic — zero image requests");

    // Layer 0 is preserved as provenance and is NOT what came back.
    assert.equal(result.cleanMasterHash, masterRef.contentHash,
      "Layer 0 is the accepted sheet that entered, recorded as its own hash");
    assert.notEqual(result.contentHash, masterRef.contentHash,
      "the customer must not be handed back the unbranded sheet");
    assert.equal(result.changed, true);
    assert.equal(result.applied.length, 4);
    assert.deepEqual([...new Set(result.applied.map((e) => e.surfaceKey))].sort(), ["driver", "passenger"]);
    assert.deepEqual([...new Set(result.applied.map((e) => e.role))].sort(), ["contact", "typography"]);

    // AND IT IS ON THE PIXELS. A receipt saying "4 applied" over an unchanged
    // sheet is the defect CLAUDE.md names by name — do not report status from
    // receipts — so the flank is cropped and compared.
    const zone = manifest.zones.find((z) => z.surfaceKey === "driver");
    const crop = async (bytes) => sharp(bytes)
      .extract({ left: zone.trim.x, top: zone.trim.y, width: zone.trim.w, height: zone.trim.h })
      .raw().toBuffer();
    const baseFlank = await crop(acceptedBytes);
    const shownFlank = await crop(result.bytes);
    assert.notEqual(Buffer.compare(baseFlank, shownFlank), 0,
      "the driver flank the customer sees must carry the lettering");
    let ink = 0;
    for (let i = 0; i + 2 < shownFlank.length; i += 3) {
      if (shownFlank[i] < 80 && shownFlank[i + 1] < 90 && shownFlank[i + 2] < 100) ink += 1;
    }
    assert.ok(ink > 500, `expected real lettering on the driver flank, found ${ink} ink pixels`);

    // THE MIGRATION'S OWN BRANCH. With no master.assemble in this graph, the run
    // can only reach 'completed' because master.composite is now allowed to name
    // the master while the columns are still NULL. Against the base migration
    // alone this assertion fails with the run's CHECK — which is precisely what
    // would have happened on the first live v28 generation.
    const { rows } = await db.query(
      "SELECT state,master_storage_path,master_content_hash,master_byte_size,completed_at FROM public.designpro_atlas_call1_runs WHERE id=$1",
      [result.runId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, "completed", "an element-only run must be able to complete");
    assert.equal(rows[0].master_content_hash, result.contentHash,
      "the run records the COMPOSITED sheet, because nothing else ever named a master");
    assert.equal(Number(rows[0].master_byte_size), result.byteSize);
    assert.ok(rows[0].completed_at);

    // Every node completed, and the composite is the one that closed the run.
    const nodes = await db.query(
      "SELECT node_key,state FROM public.designpro_atlas_call1_nodes WHERE run_id=$1 ORDER BY node_key", [result.runId]);
    assert.deepEqual(nodes.rows.map((n) => n.node_key).sort(),
      ["contact.produce", "element.lockup", "master.composite", "typeset.produce"]);
    assert.ok(nodes.rows.every((n) => n.state === "completed"), "no element node may be left behind");

    // RESUME. A re-claimed generation finds the completed run and spends nothing.
    const again = await worker.authorElements({
      masterRef, manifest, input: branded,
      requestId: REQUEST, generationId: GENERATION, ownerId: OWNER,
      logger: () => {}, pollMs: 20, timeoutMs: 60_000,
    });
    assert.equal(again.runId, result.runId, "the same definition must resume, never fork a second run");
    assert.equal(again.contentHash, result.contentHash);
    assert.equal(calls.length, 0);
  } finally {
    worker.stop?.();
    if (previous === undefined) delete process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH;
    else process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH = previous;
  }
});

// ════════════════════════════════════════════════════════════════════════════
// THE PANEL-PROOF PAIR — Call 1's own two durable nodes.
//
// Owner: "Connect Call 1 to the existing durable DAG." These cases run the REAL
// migration on PGlite, the REAL `requestProofSheet` and `assemblePanelProofMaster`,
// and the REAL master assembler, across TWO workers, so what is proven is that
// the durable route produces the same master the in-process route does and that
// the expensive half is never bought twice.
// ════════════════════════════════════════════════════════════════════════════

const panelProof = require("../runtime/atlas-panel-proof-topology.cjs");
const containerTemplate = require("../runtime/atlas-proof-container-template.cjs");
const { assembleFinishedMaster } = require("../runtime/atlas-finished-master.cjs");

/**
 * A sheet with every cell painted, at the container's own geometry — the same
 * fixture shape `atlas-panel-proof-topology.test.mjs` uses, because a sheet with
 * empty cells exercises the refusal and nothing else.
 */
async function paintedProofSheet(manifest, { width = 3072, height = 2048 } = {}) {
  const layout = containerTemplate.containerLayout(containerTemplate.parsePanelRows(
    panelProof.panelRowsFromManifest(manifest)));
  const sx = width / layout.width;
  const sy = height / layout.height;
  const rects = [];
  for (const [zone, colour] of [["zone1", "#1d4ed8"], ["zone2", "#0f766e"], ["zone3", "#b91c1c"]]) {
    for (const cell of layout[zone] || []) {
      rects.push(`<rect x="${Math.round(cell.x * sx)}" y="${Math.round(cell.y * sy)}" `
        + `width="${Math.round(cell.w * sx)}" height="${Math.round(cell.h * sy)}" fill="${colour}"/>`);
    }
  }
  return sharp(Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>${rects.join("")}</svg>`,
  )).png().toBuffer();
}

/**
 * A stand-in for `production-panel-proof` that stores its sheet the way the real
 * edge does — content-addressed under `atlas-panel-proof/` — and records the
 * owner id it was handed.
 *
 * IT RECORDS THE OWNER BECAUSE THAT WAS A REAL DEFECT. Both runtime processes
 * build ONE transport at start-up and then serve panel-proof nodes of ANY
 * customer's run, so a construction-time-only owner sends an EMPTY
 * `x-designpro-owner-id` on every graph-claimed node — which the live edge
 * rejects 403, and which is also the provider cache's isolation key.
 */
function proofEdgeStub(files, calls, { sheetBytes, refuse = false } = {}) {
  return async (body, meta = {}) => {
    calls.push({ body, ownerId: meta.ownerId ?? null });
    if (refuse) {
      throw new panelProof.PanelProofRefusal("the model drew a vehicle", { status: 200 });
    }
    const contentHash = sha(sheetBytes);
    const storagePath = `atlas-panel-proof/${contentHash}.png`;
    files.set(storagePath, sheetBytes);
    return {
      bytes: sheetBytes, contentHash, storagePath, byteSize: sheetBytes.length,
      model: "gemini-3-pro-image", contract: "designpro.atlas-panel-proof.v1",
      promptChars: 2400, sheetShape: { mime: "image/png", extension: "png" },
    };
  };
}

test("P1. the panel-proof graph is exactly two nodes: the image request, then the deterministic cut", () => {
  const nodes = graph.compilePanelProofGraph();
  assert.deepEqual(nodes.map((n) => n.key), [graph.PROOF_SHEET_NODE, graph.PROOF_ASSEMBLE_NODE]);
  // The sheet is a ROOT: nothing orders it, so it starts the instant it is claimable.
  assert.deepEqual(nodes[0].dependsOn, []);
  // And the assemble waits on exactly ONE thing — its own sheet. An extra edge
  // here would be an ordering nobody's data requires, which is the shape RULE
  // 0.5's amendment tells sessions to remove rather than add.
  assert.deepEqual(nodes[1].dependsOn, [graph.PROOF_SHEET_NODE]);
});

test("P2. authorPanelProof runs end to end across two workers, and a resume buys no second sheet", async () => {
  const db = await createAtlasCall1Database();
  const files = new Map();
  const adapter = createAtlasCall1Adapter(db, files);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const sheetBytes = await paintedProofSheet(manifest);
  const calls = [];
  const callProofEdge = proofEdgeStub(files, calls, { sheetBytes });

  // TWO WORKERS, as production runs them. The one that owns the request ticks
  // inline while it awaits; the other polls. Either may claim either node, which
  // is the entire reason the sheet crosses as an identity and not as bytes.
  const shared = {
    supabase: adapter.supabase, callEdge: syntheticEdge([]), callProofEdge,
    assembleFinishedMaster, heartbeatMs: 200, logger: () => {},
  };
  const owner = graph.createAtlasCall1NodeWorker({ ...shared, workerId: "runtime-1-call1-graph", concurrency: 1, pollMs: 10_000 });
  const other = graph.createAtlasCall1NodeWorker({ ...shared, workerId: "runtime-2-call1-graph", concurrency: 2, pollMs: 25 });
  try {
    other.start();
    const result = await owner.authorPanelProof({
      manifest, input: { ...INPUT, companyName: "Acme Fleet" }, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER,
      providerRequest: { requestId: REQUEST, generationId: GENERATION },
      logger: () => {}, pollMs: 20, timeoutMs: 90_000,
    });

    // ONE IMAGE REQUEST FOR THE WHOLE OF CALL 1. This is the claim the
    // three-quadrant contract rests on, and the graph must not change it.
    assert.equal(calls.length, 1, "the panel-proof contract is ONE image request");
    assert.equal(result.imageRequestCount, 1);
    // THE OWNER ID REACHED THE EDGE. A construction-time-only owner would send
    // "" here, the live edge answers 403, and the provider cache would lose the
    // key that keeps two customers' sheets apart.
    assert.equal(calls[0].ownerId, OWNER, "the claimed run's owner must reach the proof edge");

    // AN ORDINARY MASTER LEAVES, at the manifest's own canvas, so every gate
    // and every stage after Call 1 judges it exactly as before.
    const meta = await sharp(result.bytes).metadata();
    assert.equal(meta.width, manifest.canvas.widthPx);
    assert.equal(meta.height, manifest.canvas.heightPx);
    assert.equal(result.contentHash, sha(result.bytes));

    // THE RECEIPT KEEPS ONE SHAPE ON BOTH ROUTES. The sheet node's timing
    // travels forward, so the stage list reads as the in-process pass's does.
    assert.deepEqual(result.provenance.stageTimings.map((s) => s.stage),
      [graph.PROOF_SHEET_NODE, "panel.cut", "master.assemble"]);
    // ALL THREE QUADRANTS ARE ON THE RECEIPT, and the two siblings are stored.
    assert.equal(result.provenance.quadrants.branded.length, 6);
    assert.equal(result.provenance.quadrants.clean.length, 6);
    assert.equal(result.provenance.quadrants.cutGraphics.length, 1);
    for (const panel of [...result.provenance.quadrants.clean, ...result.provenance.quadrants.cutGraphics]) {
      assert.equal(panel.persisted, true, `${panel.role}:${panel.surfaceKey} must be stored, not described`);
      assert.match(panel.storagePath, panel.role === "cut-graphic"
        ? /^atlas-elements\/[0-9a-f]{64}\.svg$/
        : /^atlas-panel-proof\/quadrants\/[0-9a-f]{64}\.png$/);
    }
    // THE CUT SPENDS NO MODEL CALL, per surface.
    assert.equal(result.surfaces.length, 6);
    for (const surface of result.surfaces) assert.equal(surface.imageRequestCount, 0);

    // THE LEDGER ANSWERS "WHAT HAPPENED", which is the durability this buys.
    assert.equal(result.provenance.execution, "graph");
    assert.equal(result.provenance.graph.runId, (await db.query(
      "SELECT id FROM public.designpro_atlas_call1_runs ORDER BY created_at DESC LIMIT 1")).rows[0].id);
    const nodes = await db.query(
      "SELECT node_key,state,attempt,lease_owner FROM public.designpro_atlas_call1_nodes WHERE run_id=$1 ORDER BY node_key",
      [result.provenance.graph.runId]);
    assert.deepEqual(nodes.rows.map((n) => n.node_key), [graph.PROOF_ASSEMBLE_NODE, graph.PROOF_SHEET_NODE]);
    assert.ok(nodes.rows.every((n) => n.state === "completed"), "both nodes must complete");
    assert.ok(nodes.rows.every((n) => n.lease_owner), "every node records the worker that held it");
    // AND THE RECEIPT SAYS SO. "Which worker drew the sheet, on which try" is
    // the queryable timeline this graph exists to buy; a receipt that records
    // `null` for it has bought nothing. (`readNode` did not select those two
    // columns, so the provenance claimed not to know what the row plainly said.)
    for (const entry of result.provenance.graph.nodes) {
      assert.ok(entry.leaseOwner, `${entry.nodeKey} must record the worker that held it`);
      assert.ok(Number(entry.attempt) >= 1, `${entry.nodeKey} must record its attempt`);
    }

    // NO PIXELS CROSSED THE BOUNDARY — RULE 0.39. The sheet node's stored output
    // carries an identity and paperwork; a base64 blob in a node row is the
    // exact thing that rule forbids.
    const sheetRow = await db.query(
      "SELECT output FROM public.designpro_atlas_call1_nodes WHERE run_id=$1 AND node_key=$2",
      [result.provenance.graph.runId, graph.PROOF_SHEET_NODE]);
    const output = sheetRow.rows[0].output;
    assert.match(output.sheet.storagePath, /^atlas-panel-proof\/[0-9a-f]{64}\.png$/);
    assert.equal(output.sheet.contentHash, sha(sheetBytes));
    assert.equal(Number(output.sheet.byteSize), sheetBytes.length);
    const flat = JSON.stringify(output);
    assert.equal(flat.includes("base64"), false);
    assert.ok(flat.length < 20_000, `a node output carrying pixels would be far larger (${flat.length} B)`);

    // RESUME. A re-claimed generation finds the completed run and spends NOTHING
    // — not a second sheet, and not even the cache-read round trip the durable
    // provider module would otherwise make, because the node row already has it.
    const again = await owner.authorPanelProof({
      manifest, input: { ...INPUT, companyName: "Acme Fleet" }, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER,
      providerRequest: { requestId: REQUEST, generationId: GENERATION },
      logger: () => {}, pollMs: 20, timeoutMs: 90_000,
    });
    assert.equal(calls.length, 1, "a resumed run must not touch the proof edge again");
    assert.equal(again.contentHash, result.contentHash, "and it must return the same master");
    assert.equal(again.provenance.graph.runId, result.provenance.graph.runId,
      "the same definition resumes; it never forks a second run");
  } finally {
    owner.stop?.();
    other.stop?.();
  }
});

test("P3. a refused sheet arrives as a PanelProofRefusal, so the fail-over still happens", async () => {
  // RULE 0.38 — every Call-1 routing gets a second contract, and
  // flat-first-atlas decides that on the refusal's TYPE. A refused sheet that
  // reached the caller as a generic graph error would silently disable the
  // recovery and leave the customer with nothing, which is the exact defect
  // that rule was written for.
  const db = await createAtlasCall1Database();
  const files = new Map();
  const adapter = createAtlasCall1Adapter(db, files);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const worker = graph.createAtlasCall1NodeWorker({
    supabase: adapter.supabase, workerId: "solo", callEdge: syntheticEdge([]),
    callProofEdge: proofEdgeStub(files, calls, { refuse: true }),
    assembleFinishedMaster, concurrency: 2, pollMs: 25, heartbeatMs: 200, logger: () => {},
  });
  try {
    await assert.rejects(
      worker.authorPanelProof({
        manifest, input: INPUT, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER,
        logger: () => {}, pollMs: 20, timeoutMs: 60_000,
      }),
      (error) => {
        assert.equal(error.code, "flat_atlas_panel_proof_refused",
          "the refusal must keep the code flat-first-atlas's fail-over branches on");
        assert.ok(error instanceof panelProof.PanelProofRefusal);
        // And it must say it ONCE. `failurePayload` stores the already-prefixed
        // message, so reconstructing from `message` would read "panel proof
        // refused: panel proof refused: ...".
        assert.equal(error.message, "panel proof refused: the model drew a vehicle");
        return true;
      });

    // AND THE DEFECT'S EXACT SHAPE IS LOCKED. The refusal is on `proof.sheet`,
    // so `proof.assemble` NEVER BECAME READY and its row is still pending — which
    // is why waiting on the terminal node's own row timed out after the full
    // budget instead of raising the refusal. Watching the RUN is what fixes it,
    // and this is the state that proves the difference.
    const rows = await db.query(
      "SELECT node_key,state FROM public.designpro_atlas_call1_nodes ORDER BY node_key");
    const byKey = Object.fromEntries(rows.rows.map((r) => [r.node_key, r.state]));
    assert.equal(byKey[graph.PROOF_SHEET_NODE], "failed", "the sheet is what the model refused");
    assert.equal(byKey[graph.PROOF_ASSEMBLE_NODE], "pending",
      "the terminal node never became ready — so its own row could never have reported the refusal");
    const runRows = await db.query("SELECT state,error_code FROM public.designpro_atlas_call1_runs");
    assert.equal(runRows.rows[0].state, "failed", "the RUN is what carries the failure to the caller");
  } finally {
    worker.stop?.();
  }
});

test("P4. a worker built without the panel-proof seams fails the node by name, never half-executes", () => {
  // The two seams are optional so the cascade and the element subgraph are
  // unchanged by their existence. A worker without them must therefore REFUSE a
  // panel-proof node rather than run half of it — and both runtime processes are
  // given them in index.js, which is asserted below.
  const indexSrc = fs.readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");
  assert.match(indexSrc, /callProofEdge: createPanelProofTransport\(\{ supabase/);
  assert.match(indexSrc, /^\s*assembleFinishedMaster,$/m);
  const graphSrc = fs.readFileSync(new URL("../runtime/atlas-call1-graph.cjs", import.meta.url), "utf8");
  assert.match(graphSrc, /designpro_atlas_call1_transport_missing/);
  // AND THE CALLER ROUTES THROUGH IT, behind the same kill switch as the cascade.
  const atlasSrc = fs.readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.match(atlasSrc, /authorPanelProof\(\{/);
  assert.match(atlasSrc, /typeof options\.atlasCall1Graph\.authorPanelProof === "function"/);
  // Missing graph support must refuse; it cannot silently bypass durability.
  const branch = atlasSrc.slice(atlasSrc.indexOf("} else if (panelProof) {"), atlasSrc.indexOf("generated = { bytes: proof.bytes"));
  assert.match(branch, /designpro_atlas_call1_graph_unavailable/);
  assert.match(branch, /await recordAtlasRefusal/);
  assert.match(branch, /refusal\.retryable = false/);
  assert.doesNotMatch(branch, /failOverToSixSurface|authorPanelProofMaster/);
});

test("cache-only proof sheet reuses only matching hash-verified completed checkpoints without Edge", async () => {
  const {createHash}=await import("node:crypto");
  const bytes=Buffer.from("original saved provider image");
  const asset={storagePath:"original.png",byteSize:bytes.length,contentHash:createHash("sha256").update(bytes).digest("hex")};
  const output={contract:graph.GRAPH_CONTRACT,stage:"proof-sheet",sheet:{...asset,intake:{creativeDirection:"Original immutable parsed brief"},generatedElements:[asset]},panelRows:[],customerAssets:[]};
  const definition=graph.panelProofExecutionDefinition({manifest:{zones:[]},input:{brief:"Feature the RACING wordmark"},providerRequest:{requestId:REQUEST,generationId:GENERATION,cacheOnly:true}});
  for(const scenario of ["valid","brief","owner","output hash","image bytes"]){
    const priorDefinition=structuredClone(definition);delete priorDefinition.providerRequest.cacheOnly;delete priorDefinition.recoveryCheckpointVersion;
    if(scenario==="brief")priorDefinition.input.brief="Different customer brief";
    const prior={id:"prior",request_id:REQUEST,generation_id:GENERATION,owner_id:scenario==="owner"?"other":OWNER,definition:priorDefinition};
    let edgeCalls=0,downloads=0;
    const supabase={from(table){const q={select(){return q;},eq(){return q;},order(){return q;},
      async limit(){return{data:[prior],error:null};},async maybeSingle(){return{data:{output,output_hash:scenario==="output hash"?"bad":graph.hashJson(output)},error:null};}};return q;},
      storage:{from(){return{async download(){downloads++;return{data:new Blob([scenario==="image bytes"?Buffer.from("corrupt"):bytes]),error:null};}};}}};
    const invoke=()=>graph.executeNode({claim:{node:{node_key:"proof.sheet",depends_on:[]},run:{id:"recovery",request_id:REQUEST,generation_id:GENERATION,owner_id:OWNER,definition},claimToken:CLAIM},supabase,
      callProofEdge:async()=>{edgeCalls++;throw new Error("cache-only Edge refused unmatched identity");}});
    if(scenario==="valid"){
      const result=await invoke();assert.equal(result.state,"completed");assert.deepEqual(result.output,output);
      assert.equal(edgeCalls,0);assert.equal(downloads,2);
    }else{
      await assert.rejects(invoke);
      if(scenario==="output hash"||scenario==="image bytes")assert.equal(edgeCalls,0);
      else assert.equal(downloads,0,"unmatched checkpoint bytes are never reused");
    }
  }
});


test("cache-only checkpoint execution versions the graph without changing the provider definition", () => {
  const original={input:{brief:"immutable"},providerRequest:{requestId:REQUEST,generationId:GENERATION}};
  assert.deepEqual(graph.panelProofExecutionDefinition(original),original);
  const recovery={...original,providerRequest:{...original.providerRequest,cacheOnly:true}};
  const before=structuredClone(recovery);
  assert.notEqual(graph.hashJson(graph.panelProofExecutionDefinition(recovery)),graph.hashJson(recovery));
  assert.equal(graph.hashJson(graph.panelProofExecutionDefinition(recovery)),graph.hashJson(graph.panelProofExecutionDefinition(before)));
  assert.deepEqual(recovery,before);
});
