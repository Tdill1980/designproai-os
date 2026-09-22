/**
 * THE PANEL PRODUCTION PROOF IS THE ONLY CALL 1.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner ruling, Trish 2026-09-22, verbatim: "There isn't any other Call 1 —
 * the only call is panel pro production proof, which is source for all
 * print-ready files and assets." "Revisions should auto generate edits
 * directly to panel pro production proof." "System must not issue fails
 * because of no atlas." "Nothing may block orchestration."
 *
 * What this file locks, by EXECUTION wherever the seam allows it:
 *
 *   1. the live router selects the panel proof for revision sequence 1 AND
 *      for sequence > 1 -- a revision carries its parent's accepted proof as
 *      a staged reference and the instruction folded into the brief;
 *   2. `failOverToSixSurface` is not reachable from a panel-proof run: a
 *      refused budget is terminal, and the six-surface / hero edges are never
 *      called;
 *   3. the six-surface master gates are ADVISORY on the panel proof -- their
 *      verdicts are recorded, and a checkpoint carrying those findings
 *      resumes instead of throwing;
 *   4. Zone 3 degrades (no assets / opaque generated mark) instead of refusing,
 *      while a supplied logo that cannot be verified still refuses.
 *
 * The routing probe below does not build a whole master: it hands the pass a
 * proof edge that throws a SENTINEL, which proves which Call 1 the router
 * reached (the six-surface pass would call `callEdge`; the hero cascade would
 * call `callAuthorEdge`; only the panel proof calls `callProofEdge`).
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const runtimeRequire = createRequire(new URL("../runtime/package.json", import.meta.url));
const sharp = runtimeRequire("sharp");
const atlas = require("../runtime/flat-first-atlas.cjs");
const proof = require("../runtime/atlas-panel-proof-topology.cjs");
const container = require("../runtime/atlas-proof-container-template.cjs");
const checkpoint = require("../runtime/atlas-accepted-checkpoint.cjs");
const { assembleFinishedMaster } = require("../runtime/atlas-finished-master.cjs");
const { sha256, canonicalBytes } = atlas._test;

const atlasSrc = fs.readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");

const SURFACES = [["driver", 153, 56], ["passenger", 153, 56], ["hood", 71.5, 56],
  ["roof", 74.3, 54.8], ["front", 129, 34], ["rear", 76, 54]]
  .map(([surfaceKey, widthInches, heightInches]) => ({
    surfaceKey, widthInches, heightInches, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
  }));
const MANIFEST = atlas.buildAtlasManifest(SURFACES, undefined, "truck");
const INPUT = { contractVersion: atlas.INPUT_CONTRACT, pipelineMode: atlas.PIPELINE_MODE, mode: "commercial",
  companyName: "Only Call One", phone: "(520) 555-0100", brief: "Blue and orange test artwork",
  vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" } };
const IDS = { requestId: "11111111-1111-4111-8111-111111111111", generationId: "22222222-2222-4222-8222-222222222222",
  ownerId: "33333333-3333-4333-8333-333333333333", tenantKey: "user_33333333-3333-4333-8333-333333333333",
  claimToken: "44444444-4444-4444-8444-444444444444" };

/** The smallest stand-in for Supabase + the artifact store the pass needs to reach Call 1. */
function probeHarness() {
  const bytes = new Map();
  const rows = new Map();
  let inserted = null, pendingRow = null;
  const queryFor = (table) => { const eqs = {}; const q = { select() { return q; }, eq(k, v) { eqs[k] = v; return q; },
    order() { return q; }, limit() { return q; },
    async maybeSingle() {
      if (table === "designpro_flat_atlas_revisions" && eqs.id !== undefined) return { data: rows.get(eqs.id) || null, error: null };
      return { data: inserted, error: null };
    },
    insert(row) { pendingRow = row; return q; },
    async single() { inserted = pendingRow; if (inserted?.id) rows.set(inserted.id, inserted); return { data: inserted, error: null }; } };
    return q; };
  const supabase = { from(table) { return queryFor(table); }, async rpc() { return { data: true, error: null }; },
    storage: { from() { return { async download(path) {
      if (!bytes.has(path)) return { data: null, error: { statusCode: "404", message: "Object not found" } };
      return { data: new Blob([bytes.get(path)]), error: null };
    } }; } } };
  const store = { async putImmutableBytes({ storagePath, bytes: body }) {
    bytes.set(storagePath, Buffer.from(body)); return { storagePath, contentHash: sha256(body), byteSize: body.length }; } };
  const sixSurfaceCalls = [], heroCalls = [], proofCalls = [];
  const run = (extra = {}) => atlas.generateOrReuseFlatAtlas({
    input: INPUT, surfaces: SURFACES, ...IDS, provider: {}, supabase, store,
    callEdge: async (body) => { sixSurfaceCalls.push(body); throw Object.assign(new Error("six-surface edge reached"), { code: "probe_reached_six_surface" }); },
    callAuthorEdge: async (body) => { heroCalls.push(body); throw Object.assign(new Error("hero edge reached"), { code: "probe_reached_hero" }); },
    callProofEdge: async (body) => { proofCalls.push(body); throw Object.assign(new Error("panel-proof edge reached"), { code: "probe_reached_panel_proof" }); },
    ...extra,
  });
  return { run, bytes, rows, sixSurfaceCalls, heroCalls, proofCalls, get inserted() { return inserted; } };
}

test("1. the live router selects the panel proof for a FIRST generation (sequence 1)", async () => {
  const h = probeHarness();
  await assert.rejects(h.run(), (error) => error.code === "probe_reached_panel_proof");
  assert.equal(h.proofCalls.length, 1, "the panel-proof edge is the one Call 1 reached");
  assert.equal(h.proofCalls[0].attemptKey, "panel-proof:1:1");
  assert.equal(h.proofCalls[0].revisionSequence, 1);
  assert.equal(h.sixSurfaceCalls.length, 0, "the six-surface edge is never called");
  assert.equal(h.heroCalls.length, 0, "the hero edge is never called");
  // The flag is not a router: with it explicitly OFF the routing is identical.
  const previous = process.env.DESIGNPRO_ATLAS_PANEL_PROOF;
  process.env.DESIGNPRO_ATLAS_PANEL_PROOF = "off";
  try {
    const off = probeHarness();
    await assert.rejects(off.run(), (error) => error.code === "probe_reached_panel_proof");
    assert.equal(off.sixSurfaceCalls.length + off.heroCalls.length, 0, "DESIGNPRO_ATLAS_PANEL_PROOF=off cannot select another contract");
  } finally {
    if (previous === undefined) delete process.env.DESIGNPRO_ATLAS_PANEL_PROOF; else process.env.DESIGNPRO_ATLAS_PANEL_PROOF = previous;
  }
});

test("1b. the live router selects the panel proof for a REVISION (sequence > 1), with the parent proof staged and the instruction folded in", async () => {
  const h = probeHarness();
  const parentMasterBytes = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#14345a" } }).png().toBuffer();
  const parentMaster = { storagePath: `designpro/${IDS.tenantKey}/${IDS.generationId}/flat-first/v1/revisions/1/master/${sha256(parentMasterBytes)}.png`,
    contentHash: sha256(parentMasterBytes), byteSize: parentMasterBytes.length };
  h.bytes.set(parentMaster.storagePath, parentMasterBytes);
  const parentRevisionId = "55555555-5555-4555-8555-555555555555";
  const revisionContext = {
    contractVersion: "designpro.atlas-revision-intake.v1",
    parentAtlasRevisionId: parentRevisionId, parentRequestId: "66666666-6666-4666-8666-666666666666", parentRevisionSequence: 1,
    parentMaster, parentManifest: { contentHash: sha256(canonicalBytes(MANIFEST)) },
    affectedSurfaces: ["driver"], instruction: "Enlarge the logo and move the phone number to the rear door.",
    history: { mode: "image-reference" },
  };
  await assert.rejects(h.run({
    requestId: "77777777-7777-4777-8777-777777777777", revisionSequence: 2, parentAtlasRevisionId: parentRevisionId,
    revisionContext, revisionContextHash: sha256(canonicalBytes(revisionContext)), parentManifest: MANIFEST,
  }), (error) => error.code === "probe_reached_panel_proof");
  assert.equal(h.sixSurfaceCalls.length + h.heroCalls.length, 0, "a revision never leaves the panel proof");
  const body = h.proofCalls[0];
  assert.equal(body.attemptKey, "panel-proof:2:1", "V2 is its own durable operation");
  assert.equal(body.revisionSequence, 2);
  assert.equal(body.revisionInstruction, revisionContext.instruction);
  assert.match(body.customerPrompt, /REVISION V2[\s\S]*Enlarge the logo/);
  assert.ok(body.customerPrompt.startsWith(INPUT.brief));
  assert.equal(body.parentAtlasRevisionId, parentRevisionId);
  assert.deepEqual(body.affectedSurfaces, ["driver"]);
  // THE PARENT REFERENCE IS STAGED WHERE THE EDGE ADMITS IT, as an identity.
  assert.match(body.parentProof.storagePath, proof.CALL1_INPUT_PATH);
  const staged = h.bytes.get(body.parentProof.storagePath);
  assert.ok(staged, "the parent reference bytes are really in the store");
  assert.equal(sha256(staged), body.parentProof.contentHash);
  assert.equal(body.parentProof.role, "parent-production-proof");
  // No edit guard refused it.
  assert.ok(!atlasSrc.includes('"flat_atlas_panel_proof_edit_unsupported"'));
});

test("2. failOverToSixSurface is not reachable from a panel-proof run: two refused candidates are terminal", async () => {
  const h = probeHarness();
  let calls = 0;
  await assert.rejects(h.run({
    callProofEdge: async () => { calls += 1; throw new proof.PanelProofRefusal(`the model drew a vehicle (${calls})`, { status: 200,
      sheet: { storagePath: `atlas-panel-proof/refused-${calls}.png`, contentHash: sha256(Buffer.from(`r${calls}`)), byteSize: 2 } }); },
  }), (error) => error.code === "flat_atlas_panel_proof_refused" && error.retryable === false
    && /refused 2 times/.test(error.message) && /drew a vehicle \(2\)/.test(error.message));
  assert.equal(calls, 2, "exactly two candidates, then terminal");
  assert.equal(h.sixSurfaceCalls.length, 0);
  assert.equal(h.heroCalls.length, 0);
  // And by source: the panel-proof branch and the exhausted-budget tail never
  // name the fail-over; the six retained doors sit behind hero/field passes.
  const branch = atlasSrc.slice(atlasSrc.indexOf("} else if (panelProof) {"), atlasSrc.indexOf("generated = { bytes: proof.bytes"));
  assert.doesNotMatch(branch, /failOverToSixSurface|failOverToField/);
  const tail = atlasSrc.slice(atlasSrc.indexOf("      if (panelProof) {\n        // THE PANEL PROOF NEVER ENTERS A FALLBACK CONTRACT"),
    atlasSrc.indexOf("      if (!failoverEnabled) {"));
  assert.match(tail, /refusal\.retryable = false;\s*\n\s*throw refusal;/);
  // An infrastructure fault before the edge was reached is NOT re-rolled.
  const infra = probeHarness();
  let infraCalls = 0;
  await assert.rejects(infra.run({
    callProofEdge: async () => { infraCalls += 1; throw new proof.PanelProofRefusal("SUPABASE_URL / service key are required for the proof edge"); },
  }), (error) => error.code === "flat_atlas_panel_proof_refused");
  assert.equal(infraCalls, 1, "a second candidate is never spent against a wall");
});

test("3. the six-surface master gates are advisory on the panel proof, and a checkpoint carrying their findings RESUMES", async () => {
  const advisory = atlas._test.panelProofGateAdvisory({
    candidate: 1,
    deterministic: { accepted: false, blockingFailures: ["rear: edgeHoleRatio 0.42 exceeds 0.35"], cutoutFindings: [],
      zones: [{ surfaceKey: "rear", edgeHoleRatio: 0.42, nonBlackFraction: 0.91, opaqueRatio: 1 }] },
    outputClass: { contract: "designpro.atlas-output-class-gate.v1", disposition: "vehicle_depiction", blocking: true,
      confidence: 1, evidence: "a truck", candidateSha256: "a".repeat(64) },
  });
  assert.equal(advisory.contract, atlas._test.MASTER_GATE_ADVISORY_CONTRACT);
  assert.equal(advisory.advisory, true);
  assert.equal(advisory.refused, false);
  assert.equal(advisory.findings.length, 2);
  assert.match(advisory.findings[0].finding, /rear: edgeHoleRatio 0\.42/);

  // The checkpoint round trip, executed against the real module.
  const bytes = new Map();
  const store = { async putImmutableBytes({ storagePath, bytes: body }) {
    if (bytes.has(storagePath) && sha256(bytes.get(storagePath)) !== sha256(body)) throw new Error("Immutable object already holds different bytes");
    bytes.set(storagePath, Buffer.from(body)); return { storagePath, contentHash: sha256(body), byteSize: body.length }; } };
  const supabase = { storage: { from() { return { async download(path) {
    if (!bytes.has(path)) return { data: null, error: { statusCode: "404", message: "Object not found" } };
    return { data: new Blob([bytes.get(path)]), error: null }; } }; } } };
  const master = await sharp({ create: { width: 16, height: 16, channels: 4, background: "#14345a" } }).png().toBuffer();
  const raw = await sharp({ create: { width: 8, height: 8, channels: 4, background: "#0f766e" } }).png().toBuffer();
  const identityFor = (topology) => ({
    tenantKey: IDS.tenantKey, generationId: IDS.generationId, requestId: IDS.requestId, ownerId: IDS.ownerId,
    inputHash: "b".repeat(64), manifestHash: "c".repeat(64), promptVersion: "fixture", masterQcContract: "fixture-qc",
    finishingMode: topology === "panel-proof" ? "panel-proof" : "off", checkpointKind: "accepted",
    revisionSequence: 1, parentRevisionId: null, revisionContextHash: null,
  });
  const write = (topology, state) => checkpoint.writeAcceptedCheckpoint({
    store, supabase, bucket: "wrap-files", identity: identityFor(topology), revisionId: "88888888-8888-4888-8888-888888888888",
    promptHash: "d".repeat(64), authoringInput: INPUT, masterBytes: master,
    masterStoragePath: `designpro/${IDS.tenantKey}/${IDS.generationId}/flat-first/v1/revisions/1/master/${sha256(master)}.png`,
    rawBytes: raw,
    state: { authoringTopology: topology, masterAuthoringAttempts: 1, maxAuthoringAttemptsAllowed: 2,
      masterDeterministic: { accepted: false, blockingFailures: ["rear: edgeHoleRatio 0.42 exceeds 0.35"], cutoutFindings: [],
        zones: SURFACES.map(({ surfaceKey }) => ({ surfaceKey })) },
      outputClassReceipt: { contract: "designpro.atlas-output-class-gate.v1", disposition: "vehicle_depiction", blocking: true, candidateSha256: sha256(master) },
      ...state },
  });
  // A panel-proof acceptance with advisory findings: written, then READ BACK.
  await write("panel-proof", { masterGateAdvisory: advisory });
  const read = await checkpoint.readAcceptedCheckpoint({ supabase, bucket: "wrap-files", identity: identityFor("panel-proof") });
  assert.equal(read.state.masterGateAdvisory.findings.length, 2);
  assert.equal(sha256(read.masterBytes), sha256(master));
  // The SAME findings on six-surface are still an invalid acceptance -- the
  // gates did not move for the topology they were built for.
  await assert.rejects(write("six-surface", {}), (error) => error.code === "flat_atlas_checkpoint_acceptance_invalid"
    && /blockingFailures=/.test(error.message));
  // And a panel-proof state with NO advisory receipt falls through to those terms.
  await assert.rejects(write("panel-proof", {}), (error) => error.code === "flat_atlas_checkpoint_acceptance_invalid");
  // The receipt reaches the revision row beside masterQcPassed.
  assert.match(atlasSrc, /masterQcPassed: true,[\s\S]{0,600}masterGateAdvisory: masterGateAdvisory \|\| null,/);
  assert.match(atlasSrc, /outputClassReceipt, masterGateAdvisory, edgeProvenance/, "and the checkpoint state");
});

async function paintedSheet({ width = 3072, height = 2048 } = {}) {
  const layout = container.containerLayout(container.parsePanelRows(proof.panelRowsFromManifest(MANIFEST)));
  const sx = width / layout.width, sy = height / layout.height;
  const rects = [];
  for (const [zone, colour] of [["zone1", "#1d4ed8"], ["zone2", "#0f766e"], ["zone3", "#b91c1c"]]) {
    for (const cell of layout[zone] || []) {
      rects.push(`<rect x="${Math.round(cell.x * sx)}" y="${Math.round(cell.y * sy)}" width="${Math.round(cell.w * sx)}" height="${Math.round(cell.h * sy)}" fill="${colour}"/>`);
    }
  }
  return sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${height}" fill="#ffffff"/>${rects.join("")}</svg>`)).png().toBuffer();
}
function memoryStore() {
  const objects = new Map();
  return { objects, async putImmutableBytes({ storagePath, bytes, contentType }) {
    objects.set(storagePath, { bytes, contentType }); return { storagePath, contentHash: sha256(bytes), byteSize: bytes.length }; } };
}

test("4. Zone 3 degrades instead of refusing; a supplied logo that cannot be verified still refuses", async () => {
  const sheet = await paintedSheet();
  const edge = (overrides = {}) => async () => ({ bytes: sheet, contentHash: sha256(sheet), storagePath: "atlas-panel-proof/a.png",
    byteSize: sheet.length, model: "gemini-3-pro-image", contract: "designpro.atlas-panel-proof.v1", ...overrides });
  const base = { manifest: MANIFEST, sharp, assembleFinishedMaster, store: memoryStore(),
    input: { brief: "a clean blue wave wrap", vehicle: { year: "2012", make: "Toyota", model: "Prius" } } };

  // No assets, no customer text: an EMPTY band, recorded, and the master still leaves.
  const empty = await proof.authorPanelProofMaster({ ...base, callProofEdge: edge() });
  assert.ok(empty.contentHash);
  assert.equal(empty.provenance.threeZoneLayout.graphics, 0);
  assert.equal(empty.provenance.threeZoneLayout.graphicsFormat, "none");
  assert.equal(empty.provenance.composition.omitted.find((o) => o.zone === "zone3")?.reason, "no_original_assets_or_customer_text");
  assert.equal(empty.provenance.quadrants.branded.length, 6);
  assert.equal(empty.provenance.quadrants.clean.length, 6);

  // A generated mark with no alpha: dropped from Zone 3, named, not refused.
  const opaque = await sharp({ create: { width: 120, height: 40, channels: 3, background: "#123456" } }).png().toBuffer();
  const logo = { role: "logo", storagePath: `atlas-elements/${sha256(opaque)}.png`, contentHash: sha256(opaque), byteSize: opaque.length, contentType: "image/png" };
  const dropped = await proof.authorPanelProofMaster({ ...base, store: memoryStore(), callProofEdge: edge({ generatedElements: [logo] }),
    input: { ...base.input, companyName: "Only Call One", phone: "(520) 555-0100" }, downloadAsset: async () => opaque });
  assert.ok(dropped.contentHash);
  assert.ok(!dropped.provenance.quadrants.cutGraphics.some((a) => a.surfaceKey === "logo"));
  assert.equal(dropped.provenance.composition.omitted.find((o) => o.role === "logo")?.reason, "generated_logo_has_no_transparent_channel");

  // A SUPPLIED logo that fails its hash is the customer's own file: still refused.
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  const logoAsset = { storagePath: `users/x/revisions/x/inputs/logo/${sha256(svg)}.svg`, contentHash: sha256(svg), byteSize: svg.length, contentType: "image/svg+xml" };
  await assert.rejects(() => proof.authorPanelProofMaster({ ...base, store: memoryStore(), callProofEdge: edge(),
    input: { ...base.input, logoAsset }, downloadAsset: async () => Buffer.from(svg.toString() + " ") }),
  (error) => error.code === "flat_atlas_panel_proof_refused" && /original logo identity mismatch/.test(error.reason));
  // And the refusing sentence for an empty Zone 3 is gone from the runtime.
  const topologySrc = fs.readFileSync(new URL("../runtime/atlas-panel-proof-topology.cjs", import.meta.url), "utf8");
  assert.ok(!topologySrc.includes('throw refuse("Zone 3 requires original assets or customer text")'));
  assert.ok(!topologySrc.includes('throw refuse("generated logo has no transparent channel")'));
});
