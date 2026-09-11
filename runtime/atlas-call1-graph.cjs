"use strict";

/**
 * A.T.L.A.S. CALL 1 AS A DURABLE NODE GRAPH.
 *
 * Owner, 2026-09-11: "Graph orchestration in parallel wherever you can improve
 * latency." The hero-driver cascade (atlas-hero-driver.cjs) first shipped as
 * one in-process function -- a Promise.all inside the generation worker, no
 * node rows, no cross-worker claims, no per-surface retry -- which is exactly
 * what the other session called out: "the half that is failing is the one that
 * is not a graph." This module makes it one.
 *
 * Every surface of the cascade is a NODE ROW (designpro_atlas_call1_nodes) with
 * `depends_on`, claimed through SKIP LOCKED by whichever runtime worker is
 * free, leased and heartbeaten while it runs, retried per node on transport
 * failure, and recorded in an events ledger. The dependency edges are the
 * owner's cascade, expressed as a DAG instead of a stage list:
 *
 *   surface.driver ──▶ surface.passenger ──▶ surface.hood  ─┐
 *          │                    │        ──▶ surface.front ─┼──▶ surface.roof ──▶ master.assemble
 *          │                    │        ──▶ surface.rear  ─┘          ▲
 *          └────────────────────┴───────────────────────────────────────┘
 *
 * so hood, front and rear become claimable in the same instant passenger
 * completes and run on up to three workers/slots at once. The generation
 * worker that owns the request creates the run, ticks its own node slots
 * inline, and awaits master.assemble while its generation lease heartbeats.
 *
 * WHAT DOES NOT CHANGE: every node runs the SAME primitives the in-process
 * cascade runs (authorSurface / composePassengerPlaceholder /
 * assembleHeroMaster), through the SAME edge transport, with the SAME provider
 * cache attempt keys, so a retried node re-reads its own earlier image request
 * instead of spending another. The assembled sheet faces the SAME master
 * gates. Nothing here calls Gemini, publishes a master, or heals a pixel.
 *
 * WHAT IT HONESTLY DOES NOT DO: shorten the critical path. Driver → hood/front/
 * rear → roof is three sequential model calls whichever process runs them.
 * Nodes buy durability (a dead worker loses one node, not five sheets),
 * parallelism across BOTH workers, per-node retry and a queryable timeline.
 */

const { createHash } = require("node:crypto");
const hero = require("./atlas-hero-driver.cjs");
const { createGenerationStore, BUCKET } = require("./generation-store.cjs");

const GRAPH_CONTRACT = "designpro.atlas-call1-graph.v1";
const MASTER_NODE = "master.assemble";
const NODE_LEASE_SECONDS = 600;
const HEARTBEAT_MS = 30_000;
const POLL_MS = 2_000;
const AWAIT_POLL_MS = 1_000;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000;
const SURFACE_STORAGE_PREFIX = "atlas-call1-graph";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
const hashJson = (value) => sha256(JSON.stringify(canonical(value)));
const surfaceNode = (surfaceKey) => `surface.${surfaceKey}`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class AtlasCall1GraphError extends Error {
  constructor(code, message, retryable = false, details = {}) {
    super(message);
    this.code = code;
    this.retryable = retryable;
    Object.assign(this, details);
  }
}

/** Kill switch. The graph runs unless the deploy says `off`; then the in-process cascade runs. */
function graphEnabled(env = process.env) {
  return String(env.DESIGNPRO_ATLAS_CALL1_GRAPH || "").trim().toLowerCase() !== "off";
}

function validateGraph(nodes) {
  if (!Array.isArray(nodes) || !nodes.length || nodes.length > 40) throw new AtlasCall1GraphError("designpro_atlas_call1_graph_invalid", "graph must have 1-40 nodes");
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  if (byKey.size !== nodes.length) throw new AtlasCall1GraphError("designpro_atlas_call1_duplicate_node", "duplicate node key");
  const visiting = new Set(), visited = new Set();
  const visit = (key) => {
    if (visiting.has(key)) throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_cycle", `cycle through ${key}`);
    if (visited.has(key)) return;
    const node = byKey.get(key);
    if (!node || !Array.isArray(node.dependsOn)) throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_missing", `missing ${key}`);
    visiting.add(key);
    for (const dependency of node.dependsOn) visit(dependency);
    visiting.delete(key);
    visited.add(key);
  };
  for (const key of byKey.keys()) visit(key);
  return nodes;
}

/**
 * The owner's cascade as edges. A surface depends on every surface it is
 * SHOWN (AUTHOR_NEIGHBOURS) and every exchange it REPLAYS (AUTHOR_HISTORY);
 * passenger depends on the driver it flops. Nothing else orders the graph, so
 * whatever is not an edge runs in parallel.
 */
function compileHeroDriverGraph() {
  const nodes = [];
  for (const stage of hero.AUTHOR_CASCADE) {
    for (const surfaceKey of stage) {
      const deps = surfaceKey === "passenger" ? ["driver"]
        : [...new Set([...(hero.AUTHOR_NEIGHBOURS[surfaceKey] || []), ...(hero.AUTHOR_HISTORY[surfaceKey] || [])])];
      nodes.push({ key: surfaceNode(surfaceKey), dependsOn: deps.map(surfaceNode), input: { surfaceKey }, maxAttempts: 3 });
    }
  }
  nodes.push({ key: MASTER_NODE, dependsOn: nodes.map((n) => n.key), input: {}, maxAttempts: 3 });
  return validateGraph(nodes);
}

function readyNodes(nodes) {
  const states = new Map(nodes.map((n) => [n.node_key || n.key, n.state]));
  return nodes.filter((n) => n.state === "pending" && (n.depends_on || n.dependsOn || []).every((d) => states.get(d) === "completed"));
}

async function downloadVerified(supabase, ref) {
  const { data, error } = await supabase.storage.from(BUCKET).download(ref.storagePath);
  if (error || !data) throw new AtlasCall1GraphError("designpro_atlas_call1_artifact_download_failed", `${ref.storagePath}: ${error?.message || "missing"}`, true);
  const bytes = Buffer.from(await data.arrayBuffer());
  if (bytes.length !== Number(ref.byteSize) || sha256(bytes) !== ref.contentHash) {
    throw new AtlasCall1GraphError("designpro_atlas_call1_artifact_identity_mismatch", `${ref.storagePath} does not match its recorded identity`);
  }
  return bytes;
}

function zoneOf(manifest, surfaceKey) {
  const zone = (manifest?.zones || []).find((z) => z.surfaceKey === surfaceKey);
  if (!zone) throw new AtlasCall1GraphError("flat_atlas_hero_zone_invalid", `${surfaceKey} zone missing from the run's manifest`);
  return zone;
}

/**
 * Execute ONE claimed node. Surface nodes run the cascade primitive for their
 * surface against the already-completed dependency sheets; master.assemble
 * composes the six into the manifest zones. Returns the finish payload.
 */
async function executeNode({ claim, supabase, store, callEdge, logger = () => {}, signal }) {
  const { node, run, claimToken } = claim;
  const definition = run.definition || {};
  const manifest = definition.manifest;
  if (!manifest?.zones) throw new AtlasCall1GraphError("designpro_atlas_call1_definition_invalid", "run definition carries no manifest");
  const deps = new Map((claim.dependencies || []).map((d) => [d.nodeKey, d]));
  for (const key of node.depends_on || []) {
    if (deps.get(key)?.state !== "completed") throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_incomplete", `${key} is not completed`, true);
  }
  const startedAt = Date.now();
  const loaded = new Map();
  const loadSurface = async (surfaceKey) => {
    if (loaded.has(surfaceKey)) return loaded.get(surfaceKey);
    const output = deps.get(surfaceNode(surfaceKey))?.output;
    if (!output?.sheet) throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_incomplete", `${surfaceKey} sheet missing`, true);
    const bytes = await downloadVerified(supabase, output.sheet);
    const surface = Object.freeze({ ...(output.receipt || {}), surfaceKey, bytes, contentHash: output.sheet.contentHash, exchange: output.exchange || null });
    loaded.set(surfaceKey, surface);
    return surface;
  };
  const abortIf = () => { if (signal?.aborted) throw new AtlasCall1GraphError("designpro_atlas_call1_lease_lost", "node lease lost", true); };

  if (node.node_key === MASTER_NODE) {
    const authored = new Map();
    for (const zone of manifest.zones) authored.set(zone.surfaceKey, await loadSurface(zone.surfaceKey));
    abortIf();
    const stageTimings = hero.AUTHOR_CASCADE.map((stage) => ({
      surfaces: [...stage],
      durationMs: Math.max(...stage.map((key) => Number(deps.get(surfaceNode(key))?.output?.durationMs || 0))),
    }));
    const graph = {
      contract: GRAPH_CONTRACT, runId: run.id,
      nodes: [...deps.values()].map((d) => ({ nodeKey: d.nodeKey, leaseOwner: d.output?.leaseOwner || null, attempt: d.output?.attempt || null, durationMs: d.output?.durationMs || null }))
        .concat([{ nodeKey: MASTER_NODE, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: null }]),
    };
    const assembled = await hero.assembleHeroMaster({
      manifest, authored, stageTimings, startedAt: Date.parse(run.created_at) || startedAt, execution: "graph", graph,
    });
    const stored = await store.putImmutableBytes({
      storagePath: `${SURFACE_STORAGE_PREFIX}/${run.id}/master-${assembled.contentHash}.png`, bytes: assembled.bytes, contentType: "image/png",
    });
    const { bytes: _bytes, ...receipt } = assembled;
    receipt.provenance.masterStoragePath = stored.storagePath;
    logger(`atlas call 1 graph ${run.id}: master assembled (${assembled.contentHash.slice(0, 12)}, ${assembled.imageRequestCount} image requests)`);
    return { state: "completed", output: { contract: GRAPH_CONTRACT, master: stored, ...receipt, retryable: false,
      leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
  }

  const surfaceKey = String(node.input?.surfaceKey || node.node_key.replace(/^surface\./, ""));
  const zone = zoneOf(manifest, surfaceKey);
  let result;
  if (surfaceKey === "passenger") {
    result = await hero.composePassengerPlaceholder(await loadSurface("driver"), zone);
  } else {
    const neighbours = await Promise.all((hero.AUTHOR_NEIGHBOURS[surfaceKey] || []).map(loadSurface));
    const priorExchanges = (await Promise.all((hero.AUTHOR_HISTORY[surfaceKey] || []).map(loadSurface))).map((s) => s.exchange).filter(Boolean);
    abortIf();
    result = await hero.authorSurface({
      surfaceKey, zone, first: surfaceKey === "driver", neighbours, priorExchanges,
      heroRequest: hero.heroRequestBody(definition.input), creativeContext: String(definition.creativeContext || ""),
      store, logger,
      callEdge: (body, meta) => callEdge(body, { ...(meta || {}), ownerId: run.owner_id }),
      // The claim carries the generation's CURRENT lease token: the edge
      // authorises the provider request against it (RULE 0.26).
      providerRequest: definition.providerRequest ? { ...definition.providerRequest, claimToken } : null,
    });
  }
  abortIf();
  const stored = await store.putImmutableBytes({
    storagePath: `${SURFACE_STORAGE_PREFIX}/${run.id}/${surfaceKey}-${result.contentHash}.png`, bytes: result.bytes, contentType: "image/png",
  });
  const { bytes: _bytes, exchange, ...receipt } = result;
  return { state: "completed", output: { contract: GRAPH_CONTRACT, surfaceKey, sheet: stored, receipt, exchange: exchange || null,
    retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
}

function failurePayload(error) {
  const code = String(error?.code || "designpro_atlas_call1_node_failed");
  const retryable = error?.retryable === true;
  return {
    state: retryable ? "pending" : "failed",
    output: {
      contract: GRAPH_CONTRACT, errorCode: code, retryable,
      message: String(error?.message || error).slice(0, 600),
      ...(error?.surfaceKey ? { surfaceKey: error.surfaceKey } : {}),
      ...(error?.reason ? { reason: String(error.reason).slice(0, 400) } : {}),
      ...(error?.details && typeof error.details === "object" ? { details: error.details } : {}),
    },
  };
}

function rpcError(name, error) {
  const code = String(error?.code || "");
  const missing = code === "42883" || code === "PGRST202" || /could not find the function|does not exist/i.test(String(error?.message || ""));
  return new AtlasCall1GraphError(missing ? "designpro_atlas_call1_graph_unavailable" : "designpro_atlas_call1_rpc_failed",
    `${name}: ${String(error?.message || "rpc failed").slice(0, 300)}`, !missing);
}

/**
 * The node worker: one per runtime process, polling for ready nodes of ANY
 * run, up to `concurrency` at once. Also handed to the generation worker so
 * the request's owner ticks it inline while it awaits its run.
 */
function createAtlasCall1NodeWorker({
  supabase, workerId, callEdge, concurrency = DEFAULT_CONCURRENCY, pollMs = POLL_MS,
  leaseSeconds = NODE_LEASE_SECONDS, heartbeatMs = HEARTBEAT_MS, logger = () => {}, enabled = true, store = null,
}) {
  if (!supabase) throw new Error("atlas call 1 node worker requires a Supabase client");
  if (typeof callEdge !== "function") throw new Error("atlas call 1 node worker requires the atlas-author edge transport");
  const nodeStore = store || createGenerationStore({ supabase, workerId });
  const inFlight = new Map();
  let timer = null, stopped = false, claiming = false, lastError = null, lastClaimAt = null, completed = 0, failed = 0;

  async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw rpcError(name, error);
    return data;
  }

  async function runClaim(claim) {
    const nodeId = claim.node.id, token = claim.node.lease_token;
    const controller = new AbortController();
    inFlight.set(nodeId, { controller, nodeKey: claim.node.node_key, runId: claim.run.id, startedAt: Date.now() });
    const heartbeat = setInterval(() => {
      rpc("heartbeat_designpro_atlas_call1_node", { p_node_id: nodeId, p_token: token, p_lease_seconds: leaseSeconds })
        .then((held) => { if (held !== true) controller.abort(); })
        .catch(() => controller.abort());
    }, heartbeatMs);
    heartbeat.unref?.();
    let result;
    try {
      result = await executeNode({ claim, supabase, store: nodeStore, callEdge, logger, signal: controller.signal });
      if (controller.signal.aborted) throw new AtlasCall1GraphError("designpro_atlas_call1_lease_lost", "node lease lost", true);
    } catch (error) {
      result = failurePayload(error);
      logger(`atlas call 1 graph ${claim.run.id}: ${claim.node.node_key} attempt ${claim.node.attempt} ${result.state} (${result.output.errorCode})`);
    } finally {
      clearInterval(heartbeat);
    }
    try {
      if (!controller.signal.aborted) {
        await rpc("finish_designpro_atlas_call1_node", {
          p_node_id: nodeId, p_token: token, p_state: result.state, p_output: result.output, p_output_hash: hashJson(result.output),
        });
        if (result.state === "completed") completed += 1; else if (result.state === "failed") failed += 1;
        lastError = result.state === "completed" ? null : result.output.errorCode;
      }
    } catch (error) {
      lastError = error.code || "designpro_atlas_call1_finish_failed";
      logger(`atlas call 1 graph ${claim.run.id}: finishing ${claim.node.node_key} failed (${lastError}); the lease will expire and the node re-run`);
    } finally {
      inFlight.delete(nodeId);
      // A completed node may have made its children ready: claim again now
      // rather than at the next poll, so the chain never waits on the timer.
      if (!stopped) void tick();
    }
  }

  /** Claim ready nodes until the slots are full or nothing is ready. Executions run in the background. */
  async function tick() {
    if (!enabled || stopped || claiming) return 0;
    claiming = true;
    let claimed = 0;
    try {
      while (inFlight.size < concurrency && !stopped) {
        const claim = await rpc("claim_designpro_atlas_call1_node", { p_worker: workerId, p_lease_seconds: leaseSeconds });
        if (!claim?.node) break;
        lastClaimAt = new Date().toISOString();
        claimed += 1;
        void runClaim(claim);
      }
    } catch (error) {
      lastError = error.code || "designpro_atlas_call1_claim_failed";
      if (error.code !== "designpro_atlas_call1_graph_unavailable") logger(`atlas call 1 graph: claim failed (${lastError})`);
    } finally {
      claiming = false;
    }
    return claimed;
  }

  function start() {
    stopped = false;
    if (!enabled || timer) return;
    timer = setInterval(() => void tick(), pollMs);
    timer.unref?.();
    void tick();
  }
  function stop() {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    for (const entry of inFlight.values()) entry.controller.abort();
  }
  function health() {
    return {
      contract: GRAPH_CONTRACT, enabled, started: Boolean(timer), concurrency, inFlight: inFlight.size,
      running: [...inFlight.values()].map((e) => ({ nodeKey: e.nodeKey, runId: e.runId, forMs: Date.now() - e.startedAt })),
      completed, failed, lastError, lastClaimAt,
    };
  }

  /**
   * THE GENERATION WORKER'S DOOR. Same argument shape as authorHeroDriverMaster
   * plus the request identity; same return shape; same refusal class on a
   * creative refusal, so flat-first-atlas's fail-over is untouched.
   */
  async function author({
    manifest, input, requestId, generationId, ownerId, creativeContext = "", providerRequest = null,
    logger: log = logger, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs: awaitPollMs = AWAIT_POLL_MS,
  }) {
    if (!manifest?.zones || !requestId || !generationId || !ownerId) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_author_invalid", "graph authoring requires the manifest and the request identity");
    }
    const { claimToken: _never, ...providerBase } = providerRequest || {};
    const definition = { contract: GRAPH_CONTRACT, manifest, input, creativeContext: String(creativeContext || "").slice(0, 600),
      providerRequest: providerRequest ? providerBase : null, promptVersion: hero.HERO_DRIVER_PROMPT_VERSION };
    const definitionHash = hashJson(definition);
    const created = await rpc("create_designpro_atlas_call1_run", {
      p_request_id: requestId, p_generation_id: String(generationId), p_owner_id: ownerId, p_contract: GRAPH_CONTRACT,
      p_definition_hash: definitionHash, p_definition: definition, p_nodes: compileHeroDriverGraph(),
    });
    let run = created?.run;
    if (!run?.id) throw new AtlasCall1GraphError("designpro_atlas_call1_rpc_failed", "create returned no run", true);
    log(`atlas call 1 graph: ${created.created ? "created" : "resumed"} run ${run.id} for request ${requestId}`);
    if (run.state === "failed") run = await rpc("resume_designpro_atlas_call1_run", { p_run_id: run.id });
    const startedAt = Date.now();
    const seen = new Set();
    for (;;) {
      if (run.state === "completed") break;
      if (run.state === "failed") throw await failureOf(run);
      if (Date.now() - startedAt > timeoutMs) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_graph_timeout", `run ${run.id} did not complete within ${timeoutMs}ms`, true);
      }
      await tick();
      await sleep(awaitPollMs);
      const { data, error } = await supabase.from("designpro_atlas_call1_runs").select("*").eq("id", run.id).single();
      if (error || !data) throw new AtlasCall1GraphError("designpro_atlas_call1_rpc_failed", `run read failed: ${error?.message || "missing"}`, true);
      run = data;
      const { data: nodes } = await supabase.from("designpro_atlas_call1_nodes").select("node_key,state,attempt,lease_owner").eq("run_id", run.id);
      for (const n of nodes || []) {
        if (n.state === "completed" && !seen.has(n.node_key)) { seen.add(n.node_key); log(`atlas call 1 graph ${run.id}: ${n.node_key} completed on ${n.lease_owner || "?"} (attempt ${n.attempt})`); }
      }
    }
    const { data: master } = await supabase.from("designpro_atlas_call1_nodes").select("output").eq("run_id", run.id).eq("node_key", MASTER_NODE).single();
    const output = master?.output;
    if (!output?.master?.storagePath || run.master_content_hash !== output.master.contentHash) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_master_missing", `run ${run.id} completed without a master`);
    }
    const bytes = await downloadVerified(supabase, { storagePath: run.master_storage_path, contentHash: run.master_content_hash, byteSize: run.master_byte_size });
    const { contract: _c, master: _m, retryable: _r, leaseOwner: _l, attempt: _a, durationMs: _d, ...receipt } = output;
    return { bytes, contentHash: run.master_content_hash, ...receipt,
      timings: { ...(receipt.timings || {}), heroCascadeMs: Number(receipt.timings?.heroCascadeMs || 0), graphAwaitMs: Date.now() - startedAt } };
  }

  async function failureOf(run) {
    const { data: nodes } = await supabase.from("designpro_atlas_call1_nodes").select("node_key,state,output,error_code,attempt").eq("run_id", run.id);
    const node = (nodes || []).find((n) => n.state === "failed");
    const output = node?.output || {};
    if (output.errorCode === "flat_atlas_hero_driver_refused") {
      return new hero.HeroDriverRefusal(output.surfaceKey || String(node.node_key).replace(/^surface\./, ""), output.reason || "refused",
        { ...(output.details || {}), runId: run.id, nodeKey: node.node_key });
    }
    return new AtlasCall1GraphError(output.errorCode || node?.error_code || run.error_code || "designpro_atlas_call1_graph_failed",
      `run ${run.id} failed on ${node?.node_key || "?"}: ${output.message || output.errorCode || run.error_code || "unknown"}`,
      output.retryable === true || node?.error_code === "attempts_exhausted", { runId: run.id, nodeKey: node?.node_key || null });
  }

  return { start, stop, tick, health, author, executeNode: (claim, extra = {}) => executeNode({ claim, supabase, store: nodeStore, callEdge, logger, ...extra }), workerId };
}

module.exports = {
  GRAPH_CONTRACT, MASTER_NODE, NODE_LEASE_SECONDS, DEFAULT_CONCURRENCY,
  AtlasCall1GraphError, graphEnabled, validateGraph, compileHeroDriverGraph, readyNodes, hashJson,
  createAtlasCall1NodeWorker, executeNode, failurePayload,
};
