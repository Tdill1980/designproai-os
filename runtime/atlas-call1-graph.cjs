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
const typeset = require("./atlas-typeset-layer.cjs");
const logo = require("./atlas-logo-prepare.cjs");
const lockup = require("./atlas-element-lockup.cjs");
const composite = require("./atlas-master-composite.cjs");
const panelProof = require("./atlas-panel-proof-topology.cjs");
const { createGenerationStore, BUCKET } = require("./generation-store.cjs");

const GRAPH_CONTRACT = "designpro.atlas-call1-graph.v1";
const MASTER_NODE = "master.assemble";
// NODE 1 of a hero-view surface: the vehicle-sheet render at an achievable
// aspect. NODE 3 is `surface.<key>`, the flattener that consumes it. They are
// separate node rows so a failed flatten retries WITHOUT re-billing the view,
// and so the ledger can say which worker drew which half. Driver is always
// hero-view-eligible; front joined it on the same measured evidence
// (hero.HERO_VIEW_SURFACES) -- a real, measured aspect_drift refusal, twice,
// on the live F250 canary (`front: aspect_drift:1.342`/`1.354`).
const viewNode = (surfaceKey) => `surface.${surfaceKey}.view`;
const DRIVER_VIEW_NODE = viewNode("driver");
// ARCHITECTURE_DAG.md §4.2 -- the element graph's first node. A ROOT: it depends
// only on the run's frozen brief, so it is claimable in the same instant as
// surface.driver.view and adds nothing to the critical path.
const TYPESET_NODE = "typeset.produce";
// ARCHITECTURE_DAG.md §4.3 -- the contact bar. Same producer, same envelope,
// its own node, so a design that carries a phone number but no company name
// still gets its element, and vice versa.
const CONTACT_NODE = "contact.produce";
// ARCHITECTURE_DAG.md §4.4 -- the customer's uploaded logo, prepared as Layer 1
// artwork. It NEVER generates one; absence is an honest answer, not a gap.
const LOGO_NODE = "logo.prepare";
// The generated mark. `node_key`'s CHECK is a regex that already admits a
// dotted key, so this needs no migration — the same way `proof.assemble` and
// `surface.driver.view` were added.
const LOGO_GENERATE_NODE = "logo.generate";
// ARCHITECTURE_DAG.md §4.5 -- the placement manifest. The ONE node in the
// element graph that is not a root: it needs the finished elements' dimensions.
const LOCKUP_NODE = "element.lockup";
// ARCHITECTURE_DAG.md §4.6 -- Layer 0 + Layer 1. The ONLY element node that
// consumes the assembled sheet, and the only one after master.assemble.
const COMPOSITE_NODE = "master.composite";
// THE PANEL-PROOF PAIR. Call 1 on the panel-proof contract is one image request
// followed by a wholly deterministic cut-and-place, and the boundary is drawn
// exactly where the fallible, billable work is -- the same reasoning RULE 0.39
// gives for splitting surface.driver.view from surface.driver ("a refused
// flatten re-spent the 3D render on every attempt").
//
// `proof.sheet` is the ONE image request. Its row is what a re-claimed worker
// reads instead of asking the edge again -- not even a cache-read round trip.
// `proof.assemble` is cut -> gate -> place -> assemble -> store the two sibling
// quadrants: ~17 sharp operations, zero model calls, and the reason it is ONE
// node rather than three is that a split would force six extra stores of the
// Zone-1 panels across a boundary purely to make a second-long deterministic
// step independently retryable. Honest statement of value: these two nodes buy
// durability, a per-node retry of the expensive half, and a queryable timeline.
// They do not shorten Call 1 -- the critical path is still one image call.
const PROOF_SHEET_NODE = "proof.sheet";
const PROOF_ASSEMBLE_NODE = "proof.assemble";
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
const PROOF_CHECKPOINT_VERSION = "verified-completed-proof-sheet.v1";
const panelProofExecutionDefinition = definition => definition.providerRequest?.cacheOnly === true
  ? {...definition,recoveryCheckpointVersion:PROOF_CHECKPOINT_VERSION} : definition;
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
/**
 * ARCHITECTURE_DAG.md §4.2. Resolved at COMPILE time, like heroFirst, so the
 * stored node rows are the decision and a flag flipped mid-run cannot change
 * what an already-claimed node does.
 *
 * Unset means OFF, deliberately: this port is unproven on a live run, and the
 * flag that defaulted the other way (DESIGNPRO_ATLAS_FIELD_FIRST) is recorded in
 * CLAUDE.md as weeks of routing nobody could see.
 */
function elementGraphEnabled() {
  return String(process.env.DESIGNPRO_ATLAS_ELEMENT_GRAPH || "").trim().toLowerCase() === "on";
}

/**
 * The node carries the EXACT strings it will set, resolved from the frozen
 * brief at compile time, so the ledger row answers "what was asked for" without
 * re-reading the brief -- and so a node can never invent a line the customer
 * did not supply.
 */
function typesetNodeFor(input) {
  const text = String(input?.companyName || input?.businessName || "").trim();
  if (!text) return null;
  return {
    key: TYPESET_NODE,
    dependsOn: [],
    input: { role: "typography", text, fontKey: typeset.DEFAULT_NAME_FONT, widthPx: 1600 },
    maxAttempts: 3,
  };
}

/**
 * THE CONTACT-INVENTION LOCK, MOVED FROM PROSE INTO STRUCTURE.
 *
 * Today that lock is a sentence in the Call-1 prompt asking the model not to
 * invent a phone number or a web address, and it has needed fixing before
 * (the phone-missing/website-supplied hole). A node cannot hallucinate: it sets
 * the exact strings it was handed and nothing else, so a line the customer did
 * not supply has no way to exist.
 *
 * `phone` and `website` are the only contact fields the input contract carries
 * (`designpro.calls-1-7-input.v3`). A city line is NOT invented to fill the bar.
 */
function contactLinesFrom(input) {
  return [String(input?.phone || "").trim(), String(input?.website || "").trim()].filter(Boolean);
}

function contactNodeFor(input) {
  const lines = contactLinesFrom(input);
  if (!lines.length) return null;
  return {
    key: CONTACT_NODE,
    dependsOn: [],
    input: { role: "contact", lines, fontKey: typeset.DEFAULT_CONTACT_FONT, widthPx: 1600 },
    maxAttempts: 3,
  };
}

/**
 * Compiled only when the brief actually carries a logo. With no upload there is
 * no node -- and the typography lockup is the brand mark, which is what
 * `buildLogoArchitecture()` already directs on the prompt side.
 *
 * The identity is verified HERE, at compile time, so a malformed asset refuses
 * the run before a node is ever claimed and a worker ever spends a lease.
 */
function logoNodeFor(input) {
  if (logo.hasCustomerLogo(input)) {
    const identity = logo.verifyLogoIdentity(input.logoAsset);
    return {
      key: LOGO_NODE,
      dependsOn: [],
      input: { role: "logo", source: "customer", asset: identity },
      maxAttempts: 3,
    };
  }
  // ⚠️ THIS USED TO `return null` AND THAT IS HOW THE LOGO WENT MISSING.
  //
  // Owner, 2026-09-21: "if they didn't [upload] it auto created a logo." It
  // did — inside `production-panel-proof`, which was the Call-1 bypass. With
  // that removed, a customer who typed a company name and uploaded nothing got
  // a typeset wordmark and no mark at all, on a clean base that has no drawn
  // lettering either.
  //
  // `logo.generate` is that generator given a door: the SAME `authorProofLogo`,
  // the SAME `designpro-text-layer-prompt` builder, the SAME `chromaKeyToAlpha`
  // that `designpro-text-layer-generate` and `production-panel-proof` share.
  // Recovered, not rebuilt (RULE 1). It emits the identical
  // `{role, element:{storagePath, contentHash, byteSize}}` shape, so
  // `element.lockup` and `master.composite` consume it without knowing which
  // branch produced it.
  //
  // No company name means nothing to draw a mark FOR, and no node — which is
  // the same honest no-op the customer branch makes when there is no asset.
  const companyName = String(input?.companyName || input?.businessName || "").trim();
  if (!companyName) return null;
  return {
    key: LOGO_GENERATE_NODE,
    dependsOn: [],
    input: {
      role: "logo", source: "designpro-text-layer-art", companyName,
      brief: String(input?.brief || input?.prompt || "").slice(0, 2000),
      industryType: String(input?.industry || input?.industryType || "").trim(),
      brandColors: String(input?.brandColors || "").trim(),
      style: String(input?.style || "").trim(),
    },
    maxAttempts: 3,
  };
}

/**
 * The element subgraph, independent of whatever authored the sheet.
 *
 * typeset / contact / logo are ROOTS -- they need no master, only the brief --
 * so the only thing that ever coupled them to the hero cascade was the graph
 * they happened to be appended to. `masterNode` names the node the composite
 * waits for, or null when the master is already accepted and arrives as a
 * reference on the run definition (the six-surface case).
 *
 * Returns [] when the brief carries no name, no contact and no logo: there is
 * nothing to place, and an empty manifest is not a plan.
 */
function elementNodes({ input, masterNode = null }) {
  const elements = [typesetNodeFor(input), contactNodeFor(input), logoNodeFor(input)].filter(Boolean);
  if (!elements.length) return [];
  return [
    ...elements,
    { key: LOCKUP_NODE, dependsOn: elements.map((e) => e.key), input: {}, maxAttempts: 3 },
    // The element producers are already the lockup's dependencies, so naming
    // them again would only duplicate edges.
    { key: COMPOSITE_NODE, dependsOn: masterNode ? [masterNode, LOCKUP_NODE] : [LOCKUP_NODE], input: {}, maxAttempts: 3 },
  ];
}

/**
 * THE SIX-SURFACE AND FIELD DOOR. (2026-09-18.)
 *
 * The element nodes compiled only inside `compileHeroDriverGraph`, so with
 * hero-driver off -- which is production -- they never ran at all. Measured on
 * live efca5e03: zero graph runs, zero nodes; across all history 6
 * `master.composite` rows and ONE completed, so no customer has ever received
 * a clean base with a composited lockup, and every sheet still has its
 * lettering painted by the diffusion model.
 *
 * Here the sheet is ALREADY authored and accepted, so there is no master node
 * to wait for: the accepted master arrives on the run definition as
 * `{storagePath, contentHash, byteSize}` and the composite reads it from
 * there. A reference, never bytes -- RULE 0.39 across every node boundary,
 * and the same rule that lets either worker claim this node.
 */
/**
 * THE PANEL-PROOF DOOR — Call 1's own two nodes.
 *
 * Owner: "Connect Call 1 to the existing durable DAG." This is that, for the
 * contract Call 1 actually runs on the panel-proof route, and it lands in the
 * SAME `designpro_atlas_call1_runs` / `_nodes` tables the cascade and the
 * element subgraph already use — no new tables and no migration, because
 * `node_key`'s CHECK is a regex that already admits a dotted key.
 *
 * Two nodes, one edge, and the handoff is the stored sheet's IDENTITY:
 * `proof.sheet` completes with `{storagePath, contentHash, byteSize}` and
 * nothing else, and `proof.assemble` re-reads and hash-verifies those bytes
 * before it cuts them. RULE 0.39 across the boundary, which is also what lets
 * either runtime process claim the assemble half of a sheet the other one drew.
 */
function compilePanelProofGraph() {
  return validateGraph([
    { key: PROOF_SHEET_NODE, dependsOn: [], input: {}, maxAttempts: 2 },
    // maxAttempts 2, not 3. An assemble failure is a REFUSAL of the sheet in
    // all but the storage cases — a blank cell, a transposed crop, a cut that
    // did not yield six panels — and a deterministic function re-run against
    // the same bytes reaches the same verdict. Retrying it three times only
    // delays the fail-over that RULE 0.38 says is the actual recovery.
    { key: PROOF_ASSEMBLE_NODE, dependsOn: [PROOF_SHEET_NODE], input: {}, maxAttempts: 2 },
  ]);
}

function compileElementGraph({ input = null } = {}) {
  const nodes = elementNodes({ input, masterNode: null });
  // EMPTY IS AN ANSWER, NOT AN ERROR. `validateGraph` refuses a zero-node graph
  // -- correctly, because the create RPC does too -- but a brief with no name,
  // no contact and no logo legitimately compiles nothing, and that is Layer 0
  // being the whole product rather than a malformed graph. The caller reads the
  // empty array and keeps the authored master.
  return nodes.length ? validateGraph(nodes) : [];
}

function compileHeroDriverGraph({ heroFirst = hero.heroFirstEnabled(), input = null } = {}) {
  const nodes = [];
  // HERO-FIRST SPLITS EACH ELIGIBLE SURFACE IN TWO. Node 1 draws the sheet in
  // its own 16:9 frame; node 3 flattens that render into the true zone. The
  // handoff is the stored render's IDENTITY -- storage path plus sha256 --
  // never a blob and never an in-memory buffer, so either half can re-run on
  // the other worker. Driver is always eligible; front joined it on the same
  // measured aspect-drift evidence (hero.HERO_VIEW_SURFACES). Both view nodes
  // are ROOTS -- dependsOn: [] -- so front's view is claimable in the same
  // instant as driver's, in parallel with driver's own authoring, and adds
  // nothing to the critical path by the time front's flatten is ready.
  if (heroFirst) {
    for (const surfaceKey of hero.HERO_VIEW_SURFACES) {
      nodes.push({ key: viewNode(surfaceKey), dependsOn: [], input: { surfaceKey, stage: "vehicle-view" }, maxAttempts: 3 });
    }
  }
  for (const stage of hero.AUTHOR_CASCADE) {
    for (const surfaceKey of stage) {
      const deps = surfaceKey === "passenger" ? ["driver"]
        : [...new Set([...(hero.AUTHOR_NEIGHBOURS[surfaceKey] || []), ...(hero.AUTHOR_HISTORY[surfaceKey] || [])])];
      const dependsOn = deps.map(surfaceNode);
      const hasHeroView = heroFirst && hero.HERO_VIEW_SURFACES.has(surfaceKey);
      if (hasHeroView) dependsOn.push(viewNode(surfaceKey));
      nodes.push({ key: surfaceNode(surfaceKey), dependsOn, input: { surfaceKey, ...(hasHeroView ? { stage: "flatten" } : {}) }, maxAttempts: 3 });
    }
  }
  nodes.push({ key: MASTER_NODE, dependsOn: nodes.map((n) => n.key), input: {}, maxAttempts: 3 });
  // APPENDED AFTER master.assemble ON PURPOSE. master's depends_on is
  // `nodes.map(...)` at the moment it is pushed, so appending here leaves that
  // array byte-for-byte identical whether the element graph is on or off --
  // the surfaces do not wait on an element, and chunk 8's master.composite is
  // what will consume it.
  // It depends on exactly the elements that EXIST, and the composite waits for
  // the assembled CLEAN master as well as the plan. Same builder the standalone
  // six-surface graph uses, so the two shapes cannot drift apart.
  if (elementGraphEnabled()) {
    for (const node of elementNodes({ input, masterNode: MASTER_NODE })) nodes.push(node);
  }
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
async function executeNode({ claim, supabase, store, callEdge, callProofEdge, callLogoEdge, assembleFinishedMaster, logger = () => {}, signal }) {
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

  // ── THE PANEL-PROOF PAIR ────────────────────────────────────────────────
  //
  // `proof.sheet` is the ONE image request of this contract. A re-claimed run
  // finds this row COMPLETED and reads the sheet's identity off it, so the
  // recovery costs nothing at all -- not a second sheet, and not even the
  // cache-read round trip the durable provider module would otherwise make.
  if (node.node_key === PROOF_SHEET_NODE) {
    if (definition.providerRequest?.cacheOnly === true) {
      // Intake is model-derived. Rebuilding it can change an otherwise identical
      // provider request. Reuse the durable completed sheet before calling Edge.
      if (!run.owner_id || !run.request_id || !run.generation_id) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_checkpoint_identity_mismatch","checkpoint recovery requires owner, request and generation");
      }
      const comparable = value => {
        const copy = structuredClone(value);
        if (copy.providerRequest) delete copy.providerRequest.cacheOnly;
        if (copy.recoveryCheckpointVersion === PROOF_CHECKPOINT_VERSION) delete copy.recoveryCheckpointVersion;
        return hashJson(copy);
      };
      const { data: priorRuns, error: readError } = await supabase.from("designpro_atlas_call1_runs")
        .select("id,owner_id,request_id,generation_id,definition").eq("request_id",run.request_id)
        .eq("generation_id",run.generation_id).eq("owner_id",run.owner_id).order("created_at",{ascending:false}).limit(20);
      if (readError) throw new AtlasCall1GraphError("designpro_atlas_call1_checkpoint_read_failed",String(readError.message),true);
      for (const prior of priorRuns || []) {
        if (prior.id === run.id || prior.owner_id !== run.owner_id || prior.request_id !== run.request_id
          || prior.generation_id !== run.generation_id || comparable(prior.definition) !== comparable(definition)) continue;
        const { data: saved, error } = await supabase.from("designpro_atlas_call1_nodes")
          .select("output,output_hash").eq("run_id",prior.id).eq("node_key",PROOF_SHEET_NODE).eq("state","completed").maybeSingle();
        if (error) throw new AtlasCall1GraphError("designpro_atlas_call1_checkpoint_read_failed",String(error.message),true);
        if (!saved) continue;
        if (!saved.output?.sheet || hashJson(saved.output) !== saved.output_hash) {
          throw new AtlasCall1GraphError("designpro_atlas_call1_checkpoint_identity_mismatch","completed proof sheet output hash mismatch");
        }
        await downloadVerified(supabase,saved.output.sheet);
        for (const asset of saved.output.sheet.generatedElements || []) await downloadVerified(supabase,asset);
        abortIf();
        logger(`atlas call 1 graph ${run.id}: reused verified proof.sheet from ${prior.id}`);
        return {state:"completed",output:saved.output};
      }
    }
    if (typeof callProofEdge !== "function") {
      throw new AtlasCall1GraphError("designpro_atlas_call1_transport_missing",
        `${PROOF_SHEET_NODE} needs the panel-proof transport; this worker was built without one`);
    }
    abortIf();
    // THE SAME FUNCTION THE IN-PROCESS PASS CALLS. Not a re-implementation of
    // it: a second producer of this sheet is what RULE 0.21 forbids by name,
    // and the drift it causes is what RULE 0.29 spent a session measuring.
    const { sheet, panelRows, customerAssets } = await panelProof.requestProofSheet({
      manifest, input: definition.input, store, logger,
      customerImageParts: definition.customerImageParts || [],
      providerRequest: definition.providerRequest ? { ...definition.providerRequest, claimToken } : {},
      callProofEdge: (body, meta) => callProofEdge(body, { ...(meta || {}), ownerId: run.owner_id }),
      // The revision (parent proof identity + instruction) and the candidate
      // index ride the run DEFINITION, so whichever worker claims this node
      // sends the same request and the same attemptKey.
      revision: definition.revision || null,
      candidate: Number(definition.candidate || 1),
    });
    if (!sheet?.storagePath || !sheet?.contentHash) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_proof_sheet_unaddressed",
        `${PROOF_SHEET_NODE} produced a sheet with no stored identity to hand across the node boundary`);
    }
    logger(`atlas call 1 graph ${run.id}: ${PROOF_SHEET_NODE} ${sheet.contentHash.slice(0, 12)} (${sheet.byteSize || sheet.bytes?.length} B)`);
    // THE OUTPUT CARRIES NO PIXELS. An identity plus the paperwork the assemble
    // half needs; the bytes are re-read from storage and hash-verified there.
    return { state: "completed", output: { contract: GRAPH_CONTRACT, stage: "proof-sheet",
      sheet: {
        storagePath: sheet.storagePath, contentHash: sheet.contentHash,
        byteSize: Number(sheet.byteSize || sheet.bytes?.length || 0),
        model: sheet.model || null, proofContract: sheet.contract || null,
        promptChars: Number(sheet.promptChars || 0), sheetShape: sheet.sheetShape || null,
        generatedElements: sheet.generatedElements || [], imageRequestCount: Number(sheet.imageRequestCount || 1),
        intake: sheet.intake || null, containerSource: sheet.containerSource || null,
      },
      panelRows, customerAssets,
      retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
  }

  // `proof.assemble` is cut -> gate -> place -> assemble -> store the two
  // sibling quadrants. Deterministic, zero model calls, and it reads its
  // dependency's sheet as a REFERENCE that `downloadVerified` hash-checks --
  // which is exactly what lets the other runtime process claim this half of a
  // sheet this one did not draw.
  if (node.node_key === PROOF_ASSEMBLE_NODE) {
    if (typeof assembleFinishedMaster !== "function") {
      throw new AtlasCall1GraphError("designpro_atlas_call1_transport_missing",
        `${PROOF_ASSEMBLE_NODE} needs the master assembler; this worker was built without one`);
    }
    const sheetOutput = deps.get(PROOF_SHEET_NODE)?.output;
    if (!sheetOutput?.sheet?.storagePath || !sheetOutput?.sheet?.contentHash) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_incomplete",
        `${PROOF_SHEET_NODE} carries no sheet reference`, true);
    }
    abortIf();
    const bytes = await downloadVerified(supabase, sheetOutput.sheet);
    const assembled = await panelProof.assemblePanelProofMaster({
      sheet: { ...sheetOutput.sheet, bytes, contract: sheetOutput.sheet.proofContract },
      panelRows: sheetOutput.panelRows, customerAssets: sheetOutput.customerAssets || [],
      input: definition.input, downloadAsset: identity => downloadVerified(supabase, identity),
      manifest, store, logger, assembleFinishedMaster,
      // The run row already holds the identity Call 1 minted; the sheet prints
      // it as DID-XXXXXXXX when no shop order number was supplied.
      generationId: run.generation_id,
      startedAt: Date.parse(run.created_at) || startedAt,
      // The sheet node's own timing travels forward, so the receipt keeps ONE
      // shape whether Call 1 ran as a graph or in process.
      stageTimings: [{ stage: PROOF_SHEET_NODE, ms: Number(sheetOutput.durationMs || 0) }],
    });
    const stored = await store.putImmutableBytes({
      storagePath: `${SURFACE_STORAGE_PREFIX}/${run.id}/panel-proof-master-${assembled.contentHash}.png`,
      bytes: assembled.bytes, contentType: "image/png",
    });
    const { bytes: _pixels, ...receipt } = assembled;
    receipt.provenance.masterStoragePath = stored.storagePath;
    logger(`atlas call 1 graph ${run.id}: ${PROOF_ASSEMBLE_NODE} -> master ${assembled.contentHash.slice(0, 12)}`);
    return { state: "completed", output: { contract: GRAPH_CONTRACT, stage: "proof-assemble",
      master: stored, ...receipt,
      retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
  }

  // ARCHITECTURE_DAG.md §4.6 -- Layer 0 + Layer 1. Zero model calls. The CLEAN
  // master is preserved byte for byte as cleanMasterHash: duplicate, modify the
  // duplicate, keep the original -- the same rule Call 11 follows, and the
  // reason an element can later be MOVED without healing anything.
  if (node.node_key === COMPOSITE_NODE) {
    // TWO WAYS IN, ONE SHAPE. The hero cascade assembles the sheet as a node,
    // so the base is that node's output. Six-surface and field author and
    // ACCEPT the sheet before any element node is claimed, so the base is the
    // accepted master's identity on the run definition. Either way it is a
    // {storagePath, contentHash, byteSize} reference that `downloadVerified`
    // re-reads and hash-checks -- never bytes across the node boundary.
    const masterOutput = deps.get(MASTER_NODE)?.output
      || (definition.masterRef ? { master: definition.masterRef } : null);
    const planOutput = deps.get(LOCKUP_NODE)?.output;
    if (!masterOutput?.master) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_incomplete",
        `no master reference: ${MASTER_NODE} did not run and the run definition carries no masterRef`, true);
    }
    if (!planOutput?.lockup) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_incomplete", `${LOCKUP_NODE} carries no plan`, true);
    }
    abortIf();
    const cleanMasterBytes = await downloadVerified(supabase, masterOutput.master);
    const artwork = new Map();
    for (const placement of planOutput.lockup.placements || []) {
      if (artwork.has(placement.role)) continue;
      // The WHOLE identity, or downloadVerified refuses it: path, hash AND
      // byte length. Rebuilding a partial ref here is how a correct artifact
      // reads as a corrupted one.
      artwork.set(placement.role, await downloadVerified(supabase, {
        storagePath: placement.storagePath, contentHash: placement.contentHash, byteSize: placement.byteSize,
      }));
    }
    abortIf();
    const result = await composite.compositeElementsOntoMaster({
      cleanMasterBytes, zones: manifest.zones, plan: planOutput.lockup, artwork,
    });
    const stored = await store.putImmutableBytes({
      storagePath: `${SURFACE_STORAGE_PREFIX}/${run.id}/master-composited-${result.contentHash}.png`,
      bytes: result.bytes, contentType: "image/png",
    });
    logger(`atlas call 1 graph ${run.id}: composited ${result.applied.length} elements onto ${result.cleanMasterHash.slice(0, 12)} -> ${result.contentHash.slice(0, 12)}`);
    return { state: "completed", output: { contract: GRAPH_CONTRACT, role: "composite",
      master: stored,
      // PROVENANCE AND A FLOOR. Layer 0 is not replaced; a later element edit
      // re-composites onto THIS hash rather than healing painted pixels.
      cleanMasterHash: result.cleanMasterHash,
      applied: result.applied, changed: result.changed,
      retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
  }

  // ARCHITECTURE_DAG.md §4.5 -- where each element sits, as normalized boxes.
  // Zero AI, zero network, zero pixels: it reads its dependencies' recorded
  // dimensions and the manifest's zones, and returns a plan.
  if (node.node_key === LOCKUP_NODE) {
    abortIf();
    const elements = (node.depends_on || []).map((key) => {
      const output = deps.get(key)?.output;
      // A COMPLETED NODE THAT DREW NOTHING IS NOT AN INCOMPLETE DEPENDENCY.
      // `logo.generate` answers `element: null` when the brief asked for no
      // mark, the customer supplied their own, or an explicit "no logo" was
      // read. That is a decision, and the lockup simply places one fewer
      // element — the exact state it was in before that node existed. Only a
      // node that produced NO OUTPUT AT ALL is the incomplete case.
      if (!output) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_incomplete", `${key} carries no output`, true);
      }
      if (output.element === null) return null;
      if (!output.element) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_incomplete", `${key} carries no element reference`, true);
      }
      return { role: output.role, ...output.element };
    }).filter(Boolean);
    const plan = lockup.planElementLockup({ zones: manifest.zones, elements });
    logger(`atlas call 1 graph ${run.id}: lockup planned (${plan.placements.length} placements across ${plan.surfaces.join(", ")})`);
    return { state: "completed", output: { contract: GRAPH_CONTRACT, role: "lockup", lockup: plan,
      retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
  }

  // ARCHITECTURE_DAG.md §4.4 -- the customer's own logo, verified and
  // conditioned. ZERO model calls: this node prepares artwork the customer
  // already owns and never invents a mark.
  if (node.node_key === LOGO_NODE) {
    abortIf();
    const prepared = await logo.prepareCustomerLogo({ supabase, asset: node.input?.asset });
    const stored = await store.putImmutableBytes({
      storagePath: typeset.elementStoragePath(prepared.contentHash),
      bytes: prepared.bytes,
      contentType: "image/png",
    });
    logger(`atlas call 1 graph ${run.id}: logo prepared ${prepared.contentHash.slice(0, 12)} (${prepared.width}x${prepared.height}, alpha ${prepared.hasAlpha})`);
    return { state: "completed", output: { contract: GRAPH_CONTRACT, role: "logo", source: "customer",
      element: { storagePath: stored.storagePath, contentHash: prepared.contentHash, byteSize: prepared.byteSize,
        width: prepared.width, height: prepared.height },
      // Recorded, never manufactured. See atlas-logo-prepare.cjs on why a white
      // background is not keyed to transparent here.
      hasAlpha: prepared.hasAlpha,
      sourceIdentity: prepared.sourceIdentity, deterministic: true,
      retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
  }

  // THE GENERATED BRAND MARK. The ONE element node that makes a model call,
  // and it is the recovered `authorProofLogo` reached through the edge — not a
  // second producer. Idempotent by construction: the provider cache keys on
  // `attemptKey: brand-logo:1`, and the mark is stored content-addressed, so a
  // re-claimed node re-reads its own earlier request rather than buying a
  // second mark.
  //
  // A NULL LOGO IS A COMPLETED NODE, NOT A FAILURE. The edge answers null for a
  // supplied asset, an explicit "no logo", or a brief that never asked for one.
  // `element.lockup` then has one fewer element to place, which is exactly the
  // state it was in before this node existed.
  if (node.node_key === LOGO_GENERATE_NODE) {
    abortIf();
    // A WORKER WITHOUT THE TRANSPORT COMPLETES WITH NO MARK — IT DOES NOT FAIL
    // THE RUN. The panel-proof node fails closed because the proof IS the
    // design; a generated mark is an enhancement on top of one, and destroying
    // an accepted wrap over a missing seam is the blast radius RULE 0.15 and
    // the 2026-09-09 finishing rule both forbid. Recorded, never silent:
    // `transportUnavailable` makes "why has this run no mark" a query.
    if (typeof callLogoEdge !== "function") {
      logger(`atlas call 1 graph ${run.id}: no brand mark — the atlas-logo transport is not configured on this worker`);
      return { state: "completed", output: { contract: GRAPH_CONTRACT, role: "logo",
        source: "designpro-text-layer-art", element: null, generated: false, transportUnavailable: true,
        retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
    }
    // THE CONTINUATION, READ OFF THE RUN DEFINITION. Both halves or neither:
    // a signature without the sheet it belongs to is a token with no context,
    // and the master is what carries the palette. Absent is legitimate -- the
    // model does not always emit a signature -- and the mark is then drawn the
    // way it was before this existed.
    const definition = run.definition || {};
    const continuation = definition.callOneExchange?.thoughtSignature && definition.masterRef?.storagePath
      ? { thoughtSignature: definition.callOneExchange.thoughtSignature, master: definition.masterRef }
      : null;
    const generated = await callLogoEdge({
      providerRequest: { requestId: run.generation_request_id, generationId: run.generation_id,
        claimToken: run.claim_token, attemptKey: `brand-logo:${node.attempt || 1}` },
      ...(continuation ? { continuation } : {}),
      companyName: node.input?.companyName,
      prompt: node.input?.brief,
      industryType: node.input?.industryType,
      brandColors: node.input?.brandColors,
      style: node.input?.style,
      generateLogo: true,
    }, { ownerId: run.owner_id });
    if (!generated) {
      logger(`atlas call 1 graph ${run.id}: no brand mark drawn (the brief did not ask for one)`);
      return { state: "completed", output: { contract: GRAPH_CONTRACT, role: "logo",
        source: "designpro-text-layer-art", element: null, generated: false,
        retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
    }
    logger(`atlas call 1 graph ${run.id}: brand mark drawn ${String(generated.contentHash).slice(0, 12)}`
      + ` (${generated.byteSize} B${generated.providerCacheHit ? ", cache hit" : ""}`
      + `${continuation ? ", continuing Call 1" : ", no continuation"})`);
    return { state: "completed", output: { contract: GRAPH_CONTRACT, role: "logo",
      source: "designpro-text-layer-art", generated: true,
      // Queryable: "did this mark see the design" must not be a guess.
      continuedCallOne: Boolean(continuation),
      element: { storagePath: generated.storagePath, contentHash: generated.contentHash,
        byteSize: generated.byteSize },
      providerCacheHit: generated.providerCacheHit === true,
      retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
  }

  // ARCHITECTURE_DAG.md §4.2 -- ZERO model calls, zero network. The producer
  // returns bytes; this node is what persists them, addressed by their own
  // sha256 so a re-claim re-reads instead of re-writing.
  if (node.node_key === TYPESET_NODE || node.node_key === CONTACT_NODE) {
    abortIf();
    const role = node.node_key === CONTACT_NODE ? "contact" : "typography";
    // The node sets what its row says and nothing else. There is no path from
    // the brief to the canvas that does not go through this input.
    const lines = role === "contact" ? (Array.isArray(node.input?.lines) ? node.input.lines : []) : [];
    const rendered = await typeset.renderLockup({
      name: role === "contact" ? "" : String(node.input?.text || ""),
      lines,
      width: Number(node.input?.widthPx) || 1600,
      nameFont: node.input?.fontKey || typeset.DEFAULT_NAME_FONT,
      contactFont: node.input?.fontKey || typeset.DEFAULT_CONTACT_FONT,
      color: node.input?.colorHex,
    });
    const stored = await store.putImmutableBytes({
      storagePath: typeset.elementStoragePath(rendered.contentHash),
      bytes: rendered.bytes,
      contentType: "image/png",
    });
    logger(`atlas call 1 graph ${run.id}: ${role} element ${rendered.contentHash.slice(0, 12)} (${rendered.width}x${rendered.height})`);
    return { state: "completed", output: { contract: GRAPH_CONTRACT, role,
      // A REFERENCE, never pixels -- RULE 0.39 across every node boundary.
      element: { storagePath: stored.storagePath, contentHash: rendered.contentHash, byteSize: rendered.byteSize,
        width: rendered.width, height: rendered.height },
      metrics: rendered.metrics, fonts: rendered.fonts, color: rendered.color, deterministic: true,
      retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
  }

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

  // NODE 1 -- the vehicle-sheet render, for any hero-view-eligible surface. It
  // persists through the edge and returns only its identity; nothing
  // downstream receives its pixels from this node.
  if (node.node_key.endsWith(".view") && node.node_key.startsWith("surface.")) {
    abortIf();
    const viewSurfaceKey = String(node.input?.surfaceKey || node.node_key.replace(/^surface\./, "").replace(/\.view$/, ""));
    const view = await hero.authorHeroVehicleView({
      surfaceKey: viewSurfaceKey,
      zone: zoneOf(manifest, viewSurfaceKey),
      heroRequest: hero.heroRequestBody(definition.input),
      creativeContext: String(definition.creativeContext || ""),
      callEdge: (body, meta) => callEdge(body, { ...(meta || {}), ownerId: run.owner_id }),
      providerRequest: definition.providerRequest ? { ...definition.providerRequest, claimToken } : null,
      store,
      logger,
    });
    logger(`atlas call 1 graph ${run.id}: ${viewSurfaceKey} vehicle view ${view.contentHash.slice(0, 12)}`);
    return { state: "completed", output: { contract: GRAPH_CONTRACT, surfaceKey: viewSurfaceKey, stage: "vehicle-view",
      view: { storagePath: view.storagePath, contentHash: view.contentHash, byteSize: view.byteSize,
        imageRequestCount: view.imageRequestCount, providerCacheHit: view.providerCacheHit },
      // The exchange travels as TURNS, which carry image REFERENCES (path +
      // hash) and the thought signature -- never pixels. Node 3 replays it, so
      // it must survive the node boundary and reach whichever worker claims the
      // flatten.
      exchange: view.exchange || null,
      retryable: false, leaseOwner: node.lease_owner, attempt: node.attempt, durationMs: Date.now() - startedAt } };
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
    // NODE 3 reads node 1's output as a REFERENCE. A missing or malformed
    // reference is a dependency failure, never a silent single-call driver.
    // Generalized over ANY hero-view-eligible surface (hero.HERO_VIEW_SURFACES),
    // not just driver -- front's flatten reads surface.front.view the same way.
    let heroView = null;
    const surfaceViewNode = viewNode(surfaceKey);
    if (hero.HERO_VIEW_SURFACES.has(surfaceKey) && (node.depends_on || []).includes(surfaceViewNode)) {
      const view = deps.get(surfaceViewNode)?.output?.view;
      if (!view?.storagePath || !view?.contentHash) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_dependency_incomplete", `${surfaceViewNode} carries no view reference`, true);
      }
      heroView = Object.freeze({ ...view, exchange: deps.get(surfaceViewNode)?.output?.exchange || null });
    }
    result = await hero.authorSurface({
      // Driver is ALWAYS `first` on the edge, split or not. A surface that is
      // hero-view-eligible only sometimes (front) is `first` only on the pass
      // that actually has a view to flatten.
      // A FLATTEN SENDS ONLY ITS OWN VIEW (live 9c6008ec, HTTP 546 edge OOM on
      // surface.front): the undownscaled view render plus driver + passenger
      // neighbours plus driver's PINNED flank exchange -- trimAuthoringHistory
      // keeps the driver head outside the byte budget -- exhausted the worker
      // on all eight attempts. A view is authored `first`, so the composition
      // never saw driver anyway and the flatten only re-aspects it.
      surfaceKey, zone, first: surfaceKey === "driver" || Boolean(heroView),
      neighbours: heroView ? [] : neighbours,
      priorExchanges: heroView ? [] : priorExchanges, heroView,
      heroRequest: hero.heroRequestBody(definition.input), creativeContext: String(definition.creativeContext || ""),
      store, logger,
      callEdge: (body, meta) => callEdge(body, { ...(meta || {}), ownerId: run.owner_id }),
      // The claim carries the generation's CURRENT lease token: the edge
      // authorises the provider request against it (RULE 0.26).
      providerRequest: definition.providerRequest ? { ...definition.providerRequest, claimToken } : null,
    }).catch(async (cause) => {
      // ONE REFUSED PANEL MUST NOT DISCARD THE RUN. Measured 2026-09-17 over
      // six consecutive live runs: master.assemble was `pending` on every one
      // and has NEVER completed. Each had authored driver, passenger, hood and
      // rear cleanly and had already produced the separated elements
      // (typeset.produce / contact.produce / element.lockup all completed) --
      // and threw all of it away because front, a bumper fascia, was refused.
      // The run then failed over to six-surface, which bakes lettering into
      // pixels. That is why master.composite has never run, why no customer has
      // ever received the clean base + composited lockup, and why every sheet
      // still looks pre-DAG.
      //
      // Driver still fails the run: it is the design's origin and there is
      // nothing to continue from without it.
      // A creative refusal is already bounded and final, so it continues at
      // once. ANY OTHER failure continues only once the node has spent every
      // retry it has -- live 194e8f17 lost the whole sheet to roof exhausting
      // on `flat_atlas_author_edge_call_failed`, which is not a refusal and so
      // slipped past a refusal-only guard. The rule that matters is the one
      // the sheet depends on: no single non-driver panel may bin the run.
      const terminal = cause instanceof hero.HeroDriverRefusal
        || Number(node.attempt || 1) >= Number(node.max_attempts || 3);
      if (!terminal || surfaceKey === "driver") throw cause;
      const donor = neighbours[0] || await loadSurface("driver");
      logger(`hero-driver ${surfaceKey} refused (${cause.reason}); continuing deterministically from ${donor.surfaceKey} so the sheet can assemble`);
      return hero.composeSurfaceFromNeighbour(surfaceKey, donor, zone, cause.reason);
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
  // The panel-proof pair's two seams. OPTIONAL on purpose: a worker built
  // without them still runs the cascade and the element subgraph exactly as
  // before, and a panel-proof node claimed by such a worker fails with a named
  // reason rather than half-executing. They are NOT defaulted to a require()
  // here -- the transport needs the same Supabase client this worker was handed,
  // and the assembler lives in flat-first-atlas, which requires this module.
  callProofEdge = null, callLogoEdge = null, assembleFinishedMaster = null,
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
      result = await executeNode({ claim, supabase, store: nodeStore, callEdge, callProofEdge, callLogoEdge, assembleFinishedMaster, logger, signal: controller.signal });
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
   * THE SIX-SURFACE AND FIELD DOOR — Layer 1 onto an already-accepted sheet.
   *
   * `author()` below owns the whole of Call 1 for the hero cascade. This owns
   * only the element half, because six-surface and field have already authored,
   * gated and ACCEPTED their master by the time it is called. So there is no
   * master.assemble here: the accepted sheet arrives as `masterRef`, a
   * {storagePath, contentHash, byteSize} identity that master.composite
   * re-reads and hash-verifies (RULE 0.39 -- a reference, never bytes).
   *
   * IT RETURNS NULL RATHER THAN THROWING ON EVERY PATH WHERE LAYER 0 IS STILL
   * A VALID PRODUCT. A brief with no name, no contact and no logo compiles no
   * nodes at all; a database without the migration cannot run them. Neither is
   * a reason to fail a design that is already accepted and already correct --
   * the caller keeps the authored master, exactly as it does today. What is NOT
   * swallowed is a composite that ran and failed: that is a real defect in work
   * that was supposed to happen, and it throws.
   */
  async function authorElements({
    masterRef, manifest, input, requestId, generationId, ownerId,
    // Call 1's own exchange. Rides the DEFINITION beside `masterRef`, which is
    // already there, so the generated mark can continue the design without a
    // new node, a new edge or any change to the orchestrator.
    callOneExchange = null,
    logger: log = logger, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs: awaitPollMs = AWAIT_POLL_MS,
  }) {
    if (!elementGraphEnabled()) return null;
    if (!masterRef?.storagePath || !masterRef?.contentHash || !Number.isFinite(Number(masterRef.byteSize))) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_author_invalid",
        "element authoring requires the accepted master's storagePath, contentHash and byteSize");
    }
    if (!manifest?.zones || !requestId || !generationId || !ownerId) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_author_invalid", "element authoring requires the manifest and the request identity");
    }
    const nodes = compileElementGraph({ input });
    // Nothing to place. The sheet is the product and Layer 0 IS the design --
    // a brief with no lettering at all is exactly the 9789762d case the
    // passenger rules already protect.
    if (!nodes.length) return null;

    // The definition hash keys the run, so it must move when the element
    // producers' own contract does -- a typeset change must not resume a run
    // whose elements were rendered by the previous one.
    const definition = { contract: GRAPH_CONTRACT, manifest, input, role: "elements", masterRef,
      // In the hash on purpose: a run whose mark continued the design is not
      // the same run as one whose mark guessed at it, so they must not resume
      // into each other.
      ...(callOneExchange?.thoughtSignature ? { callOneExchange } : {}),
      elementContracts: { typeset: typeset.CONTRACT, lockup: lockup.CONTRACT, composite: composite.CONTRACT } };
    const definitionHash = hashJson(definition);
    const created = await rpc("create_designpro_atlas_call1_run", {
      p_request_id: requestId, p_generation_id: String(generationId), p_owner_id: ownerId, p_contract: GRAPH_CONTRACT,
      p_definition_hash: definitionHash, p_definition: definition, p_nodes: nodes,
    });
    let run = created?.run;
    if (!run?.id) throw new AtlasCall1GraphError("designpro_atlas_call1_rpc_failed", "create returned no element run", true);
    log(`atlas element graph: ${created.created ? "created" : "resumed"} run ${run.id} for request ${requestId} (${nodes.length} nodes)`);
    if (run.state === "failed") run = await rpc("resume_designpro_atlas_call1_run", { p_run_id: run.id });

    // The composite is the LAST node, so waiting on its own row is waiting on
    // the whole graph -- and it is the row that carries the delivered sheet.
    const startedAt = Date.now();
    let compositeRow = await readNode(run.id, COMPOSITE_NODE);
    while (compositeRow && compositeRow.state !== "completed" && compositeRow.state !== "failed") {
      if (Date.now() - startedAt > timeoutMs) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_timeout", `element run ${run.id}: ${COMPOSITE_NODE} did not finish in time`, true);
      }
      await tick();
      await sleep(awaitPollMs);
      compositeRow = await readNode(run.id, COMPOSITE_NODE);
    }
    if (compositeRow?.state === "failed") {
      const failure = compositeRow.output || {};
      throw new AtlasCall1GraphError(failure.errorCode || compositeRow.error_code || "designpro_atlas_call1_composite_failed",
        `element run ${run.id}: ${COMPOSITE_NODE} failed: ${failure.message || failure.errorCode || compositeRow.error_code || "unknown"}`,
        failure.retryable === true, { runId: run.id, nodeKey: COMPOSITE_NODE });
    }
    const composited = compositeRow?.output;
    if (!composited?.master?.storagePath) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_master_missing", `element run ${run.id} completed without a composited sheet`);
    }
    // NOT `changed: false` -> null. A composite that legitimately applied
    // nothing still returns the base's own identity, and the caller compares
    // hashes; inventing a second "nothing happened" signal here would be a
    // second way to say the same thing and a second way to get it wrong.
    const bytes = await downloadVerified(supabase, composited.master);
    log(`atlas element graph ${run.id}: composited ${(composited.applied || []).length} elements -> ${composited.master.contentHash.slice(0, 12)}`);
    return {
      bytes,
      contentHash: composited.master.contentHash,
      storagePath: composited.master.storagePath,
      byteSize: composited.master.byteSize,
      cleanMasterHash: composited.cleanMasterHash || masterRef.contentHash,
      applied: composited.applied || [],
      changed: composited.changed === true,
      runId: run.id,
      elementGraphMs: Date.now() - startedAt,
    };
  }

  /**
   * THE PANEL-PROOF DOOR — Call 1's two nodes, durably.
   *
   * Owner: "Connect Call 1 to the existing durable DAG." Same tables, same
   * claim RPC, same lease and heartbeat as the cascade; two nodes with one
   * reference edge between them.
   *
   * It returns exactly what `authorPanelProofMaster` returns, so
   * flat-first-atlas consumes one shape however Call 1 was dispatched — and it
   * throws the SAME `PanelProofRefusal` on a creative refusal, so RULE 0.38's
   * fail-over into the other contracts is untouched by the graph existing.
   *
   * WHAT IT DOES NOT DO: shorten Call 1. The critical path is still the one
   * image request, and no arrangement of nodes changes that. What it buys is
   * durability (a lost lease re-runs ONE node, and a re-claim of a completed
   * sheet costs nothing), per-node retry of the half that can actually fail,
   * and a queryable timeline — "what happened to the sheet" becomes a row
   * rather than a stopwatch held against a browser tab.
   */
  async function authorPanelProof({
    manifest, input, requestId, generationId, ownerId, providerRequest = null,
    customerImageParts = [], onProofSheetReady = null,
    // THE REVISION AND THE CANDIDATE ARE PART OF THE RUN'S IDENTITY.
    //
    // Without them the definition hash was identical for V1 and V2 of one
    // request and for candidate 1 and candidate 2 of one budget, so "re-roll"
    // resumed the failed run and "revise" resumed the parent's -- the second
    // sheet was never bought. `revision` is identities and text only (the
    // parent proof's {storagePath, contentHash, byteSize} and the instruction),
    // never pixels (RULE 0.39). `candidate` is 1-based.
    revision = null, candidate = 1,
    logger: log = logger, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs: awaitPollMs = AWAIT_POLL_MS,
  }) {
    if (!manifest?.zones || !requestId || !generationId || !ownerId) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_author_invalid",
        "panel-proof graph authoring requires the manifest and the request identity");
    }
    const { claimToken: _never, ...providerBase } = providerRequest || {};
    // The definition hash keys the run, so the panel-proof CONTRACT belongs in
    // it: a prompt change must not resume a run whose sheet the previous
    // contract drew. The customer's own assets are in `input`, and the staged
    // parts ride the definition so whichever worker claims proof.sheet sends
    // the same references — never the pixels, which is why only their
    // identities are ever put in a node's input or output.
    const candidateIndex = Math.max(1, Number(candidate) || 1);
    const definition = panelProofExecutionDefinition({
      contract: GRAPH_CONTRACT, role: "panel-proof", manifest, input,
      providerRequest: providerRequest ? providerBase : null,
      customerImageParts,
      panelProofContract: panelProof.PANEL_PROOF_TOPOLOGY_CONTRACT,
      // `undefined` on a first generation's first candidate: canonical() drops
      // it, so an existing V1 run created before this field hashes as before
      // and a resume of it still finds its own row.
      ...(revision ? { revision } : {}),
      ...(candidateIndex > 1 ? { candidate: candidateIndex } : {}),
    });
    // A terminal pre-checkpoint recovery run stays immutable. Version only the
    // cache-only execution graph, never the original provider request identity.
    const definitionHash = hashJson(definition);
    const created = await rpc("create_designpro_atlas_call1_run", {
      p_request_id: requestId, p_generation_id: String(generationId), p_owner_id: ownerId, p_contract: GRAPH_CONTRACT,
      p_definition_hash: definitionHash, p_definition: definition, p_nodes: compilePanelProofGraph(),
    });
    let run = created?.run;
    if (!run?.id) throw new AtlasCall1GraphError("designpro_atlas_call1_rpc_failed", "create returned no panel-proof run", true);
    log(`atlas panel-proof graph: ${created.created ? "created" : "resumed"} run ${run.id} for request ${requestId}`);
    if (run.state === "failed") run = await rpc("resume_designpro_atlas_call1_run", { p_run_id: run.id });

    // WATCH THE RUN, NOT ONLY THE TERMINAL NODE.
    //
    // Waiting on `proof.assemble`'s own row looks equivalent -- it is the last
    // node and the one that carries the master -- and it is WRONG on the most
    // common failure there is. A refused SHEET fails `proof.sheet`, so
    // `proof.assemble` can never become ready and its row sits `pending`
    // forever: the caller would time out after the full budget and raise a
    // generic graph error instead of the typed refusal. flat-first-atlas
    // branches the fail-over on that type, so RULE 0.38's second contract would
    // have been silently disabled for the commonest case it exists to serve --
    // and the customer would get nothing after a twenty-minute wait.
    //
    // Measured exactly that way before this loop watched the run: a refusing
    // edge produced `designpro_atlas_call1_timeout` in 61.8 s of a test budget
    // rather than `flat_atlas_panel_proof_refused`.
    const startedAt = Date.now();
    let proofSheetPublished = false;
    const publishProofSheet = async () => {
      if (proofSheetPublished || typeof onProofSheetReady !== "function") return;
      const row = await readNode(run.id, PROOF_ASSEMBLE_NODE);
      const provenance = row?.output?.provenance;
      if (row?.state !== "completed" || !provenance?.proofStoragePath || !provenance?.proofSha256) return;
      proofSheetPublished = true;
      // CUSTOMER CALL 1 BEGINS HERE, AFTER deterministic composition. The raw
      // Gemini artwork staging canvas is never customer-visible and never sent
      // to Call 2. Fan out only the code-owned three-zone Production Panel Proof.
      void Promise.resolve(onProofSheetReady({
        graphRunId: run.id,
        sheet: {
          storagePath: provenance.proofStoragePath,
          contentHash: provenance.proofSha256,
          byteSize: provenance.proofByteSize,
          contentType: provenance.proofContentType || "image/png",
          proofContract: provenance.proofContract,
        },
        panelRows: [],
        customerAssets: provenance.customerAssets || [],
      })).catch((cause) => log(`atlas panel-proof graph ${run.id}: composed proof fan-out failed non-fatally: ${String(cause?.message || cause)}`));
    };
    const readRun = async () => {
      const { data, error } = await supabase.from("designpro_atlas_call1_runs").select("*").eq("id", run.id).single();
      if (error || !data) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_rpc_failed", `run read failed: ${error?.message || "missing"}`, true);
      }
      return data;
    };
    while (run.state !== "completed" && run.state !== "failed") {
      if (Date.now() - startedAt > timeoutMs) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_timeout",
          `panel-proof run ${run.id} did not finish in time`, true);
      }
      await tick();
      await publishProofSheet();
      await sleep(awaitPollMs);
      run = await readRun();
    }
    await publishProofSheet();
    if (run.state === "failed") {
      // A CREATIVE REFUSAL MUST ARRIVE AS ONE, from WHICHEVER node carried it.
      const { data: failedNodes } = await supabase.from("designpro_atlas_call1_nodes")
        .select("node_key,state,output,error_code,attempt").eq("run_id", run.id).eq("state", "failed");
      const failedRow = (failedNodes || [])[0] || null;
      const failure = failedRow?.output || {};
      const nodeKey = failedRow?.node_key || "(unknown node)";
      const message = failure.message || failure.errorCode || failedRow?.error_code || run.error_code || "unknown";
      if (String(failure.errorCode || failedRow?.error_code || "").startsWith("flat_atlas_panel_proof")) {
        // `reason`, not `message`: PanelProofRefusal's constructor prefixes
        // "panel proof refused: " itself, and `failurePayload` already stored
        // the prefixed message -- reconstructing from it says it twice. The
        // `details` it carries are the sheet's identity, which is what the
        // refusal ledger points a human at.
        throw new panelProof.PanelProofRefusal(String(failure.reason || message), failure.details || {});
      }
      throw new AtlasCall1GraphError(failure.errorCode || failedRow?.error_code || run.error_code || "designpro_atlas_call1_panel_proof_failed",
        `panel-proof run ${run.id}: ${nodeKey} failed: ${message}`,
        failure.retryable === true, { runId: run.id, nodeKey });
    }
    const assembleRow = await readNode(run.id, PROOF_ASSEMBLE_NODE);
    const assembled = assembleRow?.output;
    if (!assembled?.master?.storagePath) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_master_missing",
        `panel-proof run ${run.id} completed without a master`);
    }
    const sheetRow = await readNode(run.id, PROOF_SHEET_NODE);
    const bytes = await downloadVerified(supabase, assembled.master);
    const { master: _ref, contract: _c, stage: _s, retryable: _r, leaseOwner, attempt, durationMs: _d, ...receipt } = assembled;
    log(`atlas panel-proof graph ${run.id}: master ${assembled.master.contentHash.slice(0, 12)} (sheet on ${sheetRow?.lease_owner || "?"}, assemble on ${leaseOwner || "?"})`);
    return {
      ...receipt,
      bytes,
      contentHash: assembled.master.contentHash,
      provenance: {
        ...(receipt.provenance || {}),
        execution: "graph",
        graph: {
          contract: GRAPH_CONTRACT, runId: run.id,
          nodes: [
            { nodeKey: PROOF_SHEET_NODE, leaseOwner: sheetRow?.lease_owner || null, attempt: sheetRow?.attempt || null },
            { nodeKey: PROOF_ASSEMBLE_NODE, leaseOwner: leaseOwner || null, attempt: attempt || null },
          ],
        },
      },
      timings: { ...(receipt.timings || {}), panelProofGraphMs: Date.now() - startedAt },
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
      p_definition_hash: definitionHash, p_definition: definition, p_nodes: compileHeroDriverGraph({ input }),
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
    // THE RUN COMPLETES ON master.assemble, NOT ON THE LAST NODE. The RPC keys
    // the run's master columns -- and its completion -- on that node key, so a
    // node placed AFTER it is still in flight when the run reads `completed`.
    // Returning here would hand back Layer 0 while the composite was still
    // running, and would do the same SILENTLY if it had failed. Both are the
    // defect this node exists to prevent, so the composite is awaited on its own
    // row and a failure is fatal rather than a quiet fall-back to the base.
    let compositeRow = await readNode(run.id, COMPOSITE_NODE);
    while (compositeRow && compositeRow.state !== "completed" && compositeRow.state !== "failed") {
      if (Date.now() - startedAt > timeoutMs) {
        throw new AtlasCall1GraphError("designpro_atlas_call1_timeout", `run ${run.id}: ${COMPOSITE_NODE} did not finish in time`, true);
      }
      await sleep(awaitPollMs);
      compositeRow = await readNode(run.id, COMPOSITE_NODE);
    }
    if (compositeRow?.state === "failed") {
      const failure = compositeRow.output || {};
      throw new AtlasCall1GraphError(failure.errorCode || compositeRow.error_code || "designpro_atlas_call1_composite_failed",
        `run ${run.id}: ${COMPOSITE_NODE} failed: ${failure.message || failure.errorCode || compositeRow.error_code || "unknown"}`,
        failure.retryable === true, { runId: run.id, nodeKey: COMPOSITE_NODE });
    }

    const { data: masterRows } = await supabase.from("designpro_atlas_call1_nodes")
      .select("node_key,output").eq("run_id", run.id).in("node_key", [MASTER_NODE, COMPOSITE_NODE]);
    const output = (masterRows || []).find((r) => r.node_key === MASTER_NODE)?.output;
    if (!output?.master?.storagePath || run.master_content_hash !== output.master.contentHash) {
      throw new AtlasCall1GraphError("designpro_atlas_call1_master_missing", `run ${run.id} completed without a master`);
    }

    // WHAT THE CUSTOMER IS SHOWN IS THE COMPOSITED SHEET, NOT LAYER 0.
    //
    // The run row records master.assemble, because the RPC keys those columns on
    // that node -- and that is correct provenance: the row IS the clean master.
    // But the panels are cut from what this function RETURNS and the Driver
    // proof is conditioned on it, so returning Layer 0 would show the customer a
    // wrap with no company name on it at all. The element graph designs the
    // lettering separately precisely so it can be composited back on with no
    // healing; handing back the base would throw that away at the last step.
    //
    // With the element graph off there is no composite node and this is
    // byte-for-byte the previous behaviour.
    const composited = (masterRows || []).find((r) => r.node_key === COMPOSITE_NODE)?.output;
    const delivered = composited?.master?.storagePath ? composited.master : output.master;
    const bytes = await downloadVerified(supabase, delivered);
    const { contract: _c, master: _m, retryable: _r, leaseOwner: _l, attempt: _a, durationMs: _d, ...receipt } = output;
    const elements = composited
      ? { cleanMasterHash: composited.cleanMasterHash || null, elementsApplied: composited.applied || [] }
      : {};
    // ORDER MATTERS AND IS NOT COSMETIC. `receipt` is master.assemble's own
    // output, and it carries its own `contentHash` -- Layer 0's. Spreading it
    // after this key silently overwrote the composited hash with the clean one,
    // which is the same "customer sees the unbranded sheet" defect one layer
    // further in. The delivered identity is written LAST, deliberately.
    return { bytes, ...receipt, ...elements, contentHash: delivered.contentHash,
      timings: { ...(receipt.timings || {}), heroCascadeMs: Number(receipt.timings?.heroCascadeMs || 0), graphAwaitMs: Date.now() - startedAt } };
  }

  /** One node row by key, or null when the compiled graph never had it. */
  async function readNode(runId, nodeKey) {
    // `lease_owner` and `attempt` are selected because the whole point of the
    // graph is that "which worker drew this, on which try" is a QUERY. Without
    // them the panel-proof receipt records `null` for the sheet's own worker and
    // the provenance claims not to know something the row plainly says.
    const { data } = await supabase.from("designpro_atlas_call1_nodes")
      .select("node_key,state,output,error_code,attempt,lease_owner").eq("run_id", runId).eq("node_key", nodeKey).maybeSingle();
    return data || null;
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

  return { start, stop, tick, health, author, authorElements, authorPanelProof,
    executeNode: (claim, extra = {}) => executeNode({ claim, supabase, store: nodeStore, callEdge, callProofEdge, callLogoEdge, assembleFinishedMaster, logger, ...extra }), workerId };
}

module.exports = {
  GRAPH_CONTRACT, MASTER_NODE, DRIVER_VIEW_NODE, viewNode, TYPESET_NODE, CONTACT_NODE, LOGO_NODE, LOCKUP_NODE, COMPOSITE_NODE, NODE_LEASE_SECONDS, DEFAULT_CONCURRENCY,
  PROOF_SHEET_NODE, PROOF_ASSEMBLE_NODE,
  AtlasCall1GraphError, graphEnabled, elementGraphEnabled, contactLinesFrom, validateGraph, compileHeroDriverGraph, compileElementGraph, compilePanelProofGraph, elementNodes, readyNodes, hashJson, panelProofExecutionDefinition,
  createAtlasCall1NodeWorker, executeNode, failurePayload,
};
