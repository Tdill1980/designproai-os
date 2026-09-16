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
//   4. end to end on synthetic sheets across TWO node workers: five image
//      requests, passenger a flop, one 4096² master, both workers held leases,
//      and a second author() of the same request spends nothing;
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
    const vehicleView = body.first === true && !body.heroViewStoragePath;
    const bytes = vehicleView
      ? await paint(1920, 1080, tint)
      : body.surfaceKey === refuse
        ? await paint(400, 400, tint)
        : await paint(Math.round(body.targetWidthPx * 0.97), body.targetHeightPx, tint);
    const contentHash = sha(bytes);
    const name = vehicleView ? "driver-view" : body.surfaceKey;
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
  // (the 3D vehicle render) and node 3 (the 2D flattener) are separate rows
  // with an edge between them, so a failed flatten retries alone.
  assert.deepEqual(deps[graph.DRIVER_VIEW_NODE], []);
  assert.deepEqual(deps["surface.driver"], [graph.DRIVER_VIEW_NODE]);
  assert.deepEqual(deps["surface.passenger"], ["surface.driver"]);
  for (const key of ["hood", "front", "rear"]) assert.deepEqual(deps[`surface.${key}`], ["surface.driver", "surface.passenger"], `${key} waits for driver + passenger only`);
  assert.deepEqual(deps["surface.roof"], ["surface.driver", "surface.passenger", "surface.hood", "surface.front", "surface.rear"]);
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
  assert.deepEqual(waves, [["driver.view"], ["driver"], ["passenger"], ["front", "hood", "rear"], ["roof"], ["master.assemble"]]);

  // THE KILL SWITCH IS THE GRAPH'S SHAPE, decided once when the run is created
  // and then stored — so a flag flipped mid-run cannot change what a claimed
  // node does. With hero-first off the graph is byte-for-byte the old one.
  const single = graph.compileHeroDriverGraph({ heroFirst: false });
  assert.equal(single.length, 7);
  assert.ok(!single.some((n) => n.key === graph.DRIVER_VIEW_NODE));
  assert.deepEqual(single.find((n) => n.key === "surface.driver").dependsOn, []);
  assert.throws(() => graph.validateGraph([{ key: "a", dependsOn: ["b"] }, { key: "b", dependsOn: ["a"] }]), { code: "designpro_atlas_call1_dependency_cycle" });
});

test("2+3. the database claims ready nodes in parallel, only for a leased request, with per-node retry and resume", async () => {
  const db = await createAtlasCall1Database();
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const created = await createRun(db, manifest);
  assert.equal(created.created, true);
  assert.equal(created.nodes.length, 8);
  const again = await createRun(db, manifest);
  assert.equal(again.created, false, "the same request + definition resumes its run");
  assert.equal(again.run.id, created.run.id);

  // NODE 1 first, alone: the flattener is not claimable until the render lands.
  let c = await claim(db, "w1");
  assert.equal(c.node.node_key, graph.DRIVER_VIEW_NODE);
  assert.equal(c.claimToken, CLAIM, "the claim carries the generation's current lease token");
  assert.equal(await claim(db, "w2"), null, "nothing else is ready while the vehicle view runs");
  await finish(db, c.node, "completed", { view: { storagePath: "v", contentHash: "1".repeat(64), byteSize: 1 } });

  c = await claim(db, "w1");
  assert.equal(c.node.node_key, "surface.driver");
  assert.equal(c.dependencies[0].nodeKey, graph.DRIVER_VIEW_NODE);
  assert.equal(c.dependencies[0].output.view.contentHash, "1".repeat(64), "node 3 is handed node 1's identity, never its bytes");
  assert.equal(await claim(db, "w2"), null, "nothing else is ready while driver runs");
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

  // THE PARALLEL WAVE: three claims in a row, three different workers, three different surfaces, then nothing.
  const wave = [await claim(db, "w1"), await claim(db, "w2"), await claim(db, "w1")];
  assert.deepEqual(wave.map((x) => x.node.node_key).sort(), ["surface.front", "surface.hood", "surface.rear"]);
  assert.equal(await claim(db, "w2"), null);
  assert.deepEqual(new Set(wave.map((x) => x.node.lease_owner)), new Set(["w1", "w2"]));

  // Lease gating: the generation lease lapses → nothing is claimable, even a ready node.
  await finish(db, wave[0].node, "completed", { sheet: { storagePath: "h", contentHash: "c".repeat(64), byteSize: 1 } });
  await finish(db, wave[1].node, "completed", { sheet: { storagePath: "f", contentHash: "d".repeat(64), byteSize: 1 } });
  await finish(db, wave[2].node, "completed", { sheet: { storagePath: "r", contentHash: "e".repeat(64), byteSize: 1 } });
  await db.query("UPDATE public.designpro_generation_requests SET state='retryable', lease_token=NULL");
  assert.equal(await claim(db, "w1"), null, "an unleased request's nodes are never handed out");
  await db.query(`UPDATE public.designpro_generation_requests SET state='leased', lease_token='${CLAIM}', lease_expires_at=now()+interval '10 minutes'`);
  c = await claim(db, "w1");
  assert.equal(c.node.node_key, "surface.roof");

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
  assert.equal(c.dependencies.length, 7);
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

test("4. end to end across two node workers: five image requests, passenger a flop, one assembled 4096² master, nothing spent twice", async () => {
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
    assert.equal(calls.length, 6, "driver view, driver flatten, hood, front, rear, roof — exactly as in-process");
    // NODE 1 -> NODE 3. Two DISTINCT node rows, two distinct requests, and the
    // handoff between them is the stored render's identity, never its bytes.
    assert.equal(calls[0].surfaceKey, "driver");
    assert.equal(calls[0].first, true);
    assert.equal(calls[0].heroViewStoragePath, undefined, "node 1 draws from scratch");
    assert.equal(calls[0].providerRequest.attemptKey, "author:driver-view:1");
    assert.equal(calls[1].surfaceKey, "driver");
    assert.equal(calls[1].first, true);
    assert.equal(calls[1].heroViewStoragePath, "atlas-author/driver-view.png", "node 3 consumes node 1 by storage path");
    assert.match(calls[1].heroViewContentHash, /^[0-9a-f]{64}$/, "…and by content hash — an immutable reference");
    assert.equal(calls[1].heroFlattenTier, 0);
    assert.deepEqual(calls.slice(2, 5).map((c) => c.surfaceKey).sort(), ["front", "hood", "rear"]);
    assert.equal(calls[5].surfaceKey, "roof");
    for (const call of calls.slice(2)) {
      assert.equal(call.priorTurns[1].parts[0].thoughtSignature, "sig-driver", `${call.surfaceKey} replays the driver FLANK's signature, not the vehicle view's`);
      assert.equal(call.providerRequest.claimToken, CLAIM, "the edge is authorised with the generation's lease token");
      assert.match(call.providerRequest.attemptKey, /^author:[a-z]+:\d$/);
    }
    for (const call of calls) assert.equal(call.providerRequest.claimToken, CLAIM);
    assert.deepEqual(calls[5].neighbours.map((n) => n.surfaceKey), ["driver", "passenger", "hood", "front", "rear"]);
    const meta = await sharp(result.bytes).metadata();
    assert.equal(meta.width, 4096); assert.equal(meta.height, 4096);
    assert.equal(sha(result.bytes), result.contentHash);
    assert.equal(result.imageRequestCount, 6, "node 1's request is SPENT and is counted");
    assert.equal(result.model, "gemini-3-pro-image");
    assert.equal(result.promptVersion, hero.HERO_DRIVER_PROMPT_VERSION);
    assert.equal(result.provenance.contract, hero.HERO_DRIVER_CONTRACT);
    assert.equal(result.provenance.execution, "graph");
    assert.equal(result.provenance.graph.contract, graph.GRAPH_CONTRACT);
    assert.equal(result.provenance.graph.nodes.length, 8, "6 surfaces + the driver vehicle view + the assemble node");
    assert.ok(result.provenance.graph.nodes.some((n) => n.nodeKey === graph.DRIVER_VIEW_NODE), "the ledger records who drew node 1");
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
    // again on every attempt.
    assert.equal(calls.filter((c) => !c.heroViewStoragePath).length, 1, "node 1 ran exactly once");
    assert.equal(calls.filter((c) => c.heroViewStoragePath).length, hero.AUTHOR_ATTEMPTS, "node 3 spent its own budget and no more");
    const rows = (await db.query("SELECT node_key,state,error_code FROM public.designpro_atlas_call1_nodes WHERE node_key IN ($1,'surface.driver') ORDER BY node_key", [graph.DRIVER_VIEW_NODE])).rows;
    assert.deepEqual(rows.map((r) => [r.node_key, r.state]), [["surface.driver", "failed"], [graph.DRIVER_VIEW_NODE, "completed"]]);
    // Node 1's output stayed a reference. No pixels were written into the row.
    const view = (await db.query("SELECT output FROM public.designpro_atlas_call1_nodes WHERE node_key=$1", [graph.DRIVER_VIEW_NODE])).rows[0].output;
    assert.equal(view.stage, "vehicle-view");
    assert.match(view.view.storagePath, /driver-view\.png$/);
    assert.match(view.view.contentHash, /^[0-9a-f]{64}$/);
    assert.ok(view.view.byteSize > 0);
    assert.ok(!JSON.stringify(view).includes("base64"), "the handoff is an identity, never a blob");
  } finally {
    worker.stop();
  }
});

test("5. a creative refusal on one node fails the run once and surfaces as HeroDriverRefusal, never a retry storm", async () => {
  const db = await createAtlasCall1Database();
  const adapter = createAtlasCall1Adapter(db);
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const calls = [];
  const worker = graph.createAtlasCall1NodeWorker({ supabase: adapter.supabase, workerId: "solo", callEdge: syntheticEdge(calls, { refuse: "hood" }), concurrency: 3, pollMs: 10_000, heartbeatMs: 200 });
  try {
    await assert.rejects(
      worker.author({ manifest, input: INPUT, requestId: REQUEST, generationId: GENERATION, ownerId: OWNER, providerRequest: { requestId: REQUEST, generationId: GENERATION }, pollMs: 20, timeoutMs: 60_000 }),
      (error) => error instanceof hero.HeroDriverRefusal && error.code === "flat_atlas_hero_driver_refused" && error.surfaceKey === "hood" && /aspect_drift/.test(error.reason),
    );
    // hood spent its bounded two attempts (the cascade's own budget) and no more; the node is not retried by the graph.
    assert.equal(calls.filter((c) => c.surfaceKey === "hood").length, hero.AUTHOR_ATTEMPTS);
    const { rows } = await db.query("SELECT node_key,state,attempt,error_code FROM public.designpro_atlas_call1_nodes WHERE node_key='surface.hood'");
    assert.equal(rows[0].state, "failed"); assert.equal(rows[0].attempt, 1); assert.equal(rows[0].error_code, "flat_atlas_hero_driver_refused");
    const run = (await db.query("SELECT state,error_code FROM public.designpro_atlas_call1_runs")).rows[0];
    assert.equal(run.state, "failed"); assert.equal(run.error_code, "flat_atlas_hero_driver_refused");
    // Resuming does nothing: the refusal is final and the caller fails over to six-surface.
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
