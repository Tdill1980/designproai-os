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

/** The same synthetic edge the in-process cascade test uses: the model returns at the requested shape. */
function syntheticEdge(calls, { refuse = null } = {}) {
  return async (body) => {
    calls.push(body);
    const tint = { driver: "#2255aa", hood: "#3366bb", front: "#4477cc", rear: "#5588dd", roof: "#6699ee" }[body.surfaceKey];
    const bytes = body.surfaceKey === refuse
      ? await paint(400, 400, tint)
      : await paint(Math.round(body.targetWidthPx * 0.97), body.targetHeightPx, tint);
    const contentHash = sha(bytes);
    return {
      bytes, imageRequestCount: 1, providerCacheHit: false, providerRequestKey: "a".repeat(64),
      panelStoragePath: `atlas-author/${body.surfaceKey}.png`, panelSha256: contentHash, panelBytes: bytes.length,
      userTurn: { role: "user", parts: [{ text: `exact ${body.surfaceKey} instructions` }] },
      modelTurn: { role: "model", parts: [{ imageRef: { storagePath: `atlas-author/${body.surfaceKey}.png`, contentHash }, thoughtSignature: `sig-${body.surfaceKey}` }] },
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
  assert.deepEqual(deps["surface.driver"], []);
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
  assert.deepEqual(waves, [["driver"], ["passenger"], ["front", "hood", "rear"], ["roof"], ["master.assemble"]]);
  assert.throws(() => graph.validateGraph([{ key: "a", dependsOn: ["b"] }, { key: "b", dependsOn: ["a"] }]), { code: "designpro_atlas_call1_dependency_cycle" });
});

test("2+3. the database claims ready nodes in parallel, only for a leased request, with per-node retry and resume", async () => {
  const db = await createAtlasCall1Database();
  const manifest = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
  const created = await createRun(db, manifest);
  assert.equal(created.created, true);
  assert.equal(created.nodes.length, 7);
  const again = await createRun(db, manifest);
  assert.equal(again.created, false, "the same request + definition resumes its run");
  assert.equal(again.run.id, created.run.id);

  let c = await claim(db, "w1");
  assert.equal(c.node.node_key, "surface.driver");
  assert.equal(c.claimToken, CLAIM, "the claim carries the generation's current lease token");
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
  assert.equal(c.dependencies.length, 6);
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
    assert.equal(calls.length, 5, "driver, hood, front, rear, roof — exactly as in-process");
    assert.equal(calls[0].surfaceKey, "driver");
    assert.equal(calls[0].first, true);
    assert.deepEqual(calls.slice(1, 4).map((c) => c.surfaceKey).sort(), ["front", "hood", "rear"]);
    assert.equal(calls[4].surfaceKey, "roof");
    for (const call of calls.slice(1)) {
      assert.equal(call.priorTurns[1].parts[0].thoughtSignature, "sig-driver", `${call.surfaceKey} replays the driver's signature`);
      assert.equal(call.providerRequest.claimToken, CLAIM, "the edge is authorised with the generation's lease token");
      assert.match(call.providerRequest.attemptKey, /^author:[a-z]+:\d$/);
    }
    assert.deepEqual(calls[4].neighbours.map((n) => n.surfaceKey), ["driver", "passenger", "hood", "front", "rear"]);
    const meta = await sharp(result.bytes).metadata();
    assert.equal(meta.width, 4096); assert.equal(meta.height, 4096);
    assert.equal(sha(result.bytes), result.contentHash);
    assert.equal(result.imageRequestCount, 5);
    assert.equal(result.model, "gemini-3-pro-image");
    assert.equal(result.promptVersion, hero.HERO_DRIVER_PROMPT_VERSION);
    assert.equal(result.provenance.contract, hero.HERO_DRIVER_CONTRACT);
    assert.equal(result.provenance.execution, "graph");
    assert.equal(result.provenance.graph.contract, graph.GRAPH_CONTRACT);
    assert.equal(result.provenance.graph.nodes.length, 7);
    const passenger = result.surfaces.find((s) => s.surfaceKey === "passenger");
    assert.equal(passenger.method, "hero_driver_passenger_flop"); assert.equal(passenger.deterministic, true);
    assert.equal(result.surfaces.filter((s) => s.deterministic === false).length, 5);
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
