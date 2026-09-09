import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = createRequire(new URL('../runtime/package.json', import.meta.url))('sharp');
const atlas = require("../runtime/flat-first-atlas.cjs");
const { resolveAtlasClaimGeometry } = require("../runtime/generation-worker.cjs");
const { loadBundledAtlasTeachingProof } = require("../runtime/flat-atlas-topology-examples.cjs");
const { DESIGNPANEL_AUTHORING_MODEL } = require("../runtime/designiq-prompt.cjs");
const { sha256, canonicalBytes, atlasRevisionIdentity } = atlas._test;
const ownerId = "11111111-1111-4111-8111-111111111111";
const generationId = "22222222-2222-4222-8222-222222222222";
const parentId = "33333333-3333-4333-8333-333333333333";
const requestId = "44444444-4444-4444-8444-444444444444";
const surfaces = atlas.SURFACE_KEYS.map(surfaceKey => ({
  surfaceKey, widthInches: 100, heightInches: 40, bleed: { top: 5, right: 5, bottom: 5, left: 5 },
}));
const manifest = atlas.buildAtlasManifest(surfaces, undefined, "car");
const context = {
  contractVersion: "designpro.atlas-revision-intake.v1",
  parentAtlasRevisionId: parentId,
  parentRequestId: "55555555-5555-4555-8555-555555555555",
  parentRevisionSequence: 1,
  parentMaster: { storagePath: "parent-master.png", contentHash: "a".repeat(64), byteSize: 1 },
  parentManifest: { storagePath: "parent-manifest.json", contentHash: sha256(canonicalBytes(manifest)), byteSize: canonicalBytes(manifest).length },
  instruction: "Move the existing driver logo clear of the wheel opening; retain the background artwork.",
  affectedSurfaces: ["driver"],
  history: { mode: "image-reference" },
};
const revision = {
  revisionSequence: 3, parentAtlasRevisionId: parentId,
  revisionContext: context, revisionContextHash: sha256(canonicalBytes(context)), parentManifest: manifest,
};
const input = { contractVersion: atlas.INPUT_CONTRACT, pipelineMode: atlas.PIPELINE_MODE,
  vehicle: { make: "Ford", model: "Focus", year: "2022", type: "car" }, brief: "Original approved artwork" };
const claim = { requestId, generationId, input, tenantKey: `user_${ownerId}`, ...revision };

test("edits keep the exact selected parent geometry without a new GENIE lookup", async () => {
  const calls = [];
  const executionInput = { ...input, brief: "The immutable input saved at revision intake" };
  const result = await resolveAtlasClaimGeometry({
    supabase: {}, claim, ownerId, provider: {},
    prepareRevision: async args => { calls.push(args); return { ...revision, executionInput }; },
    geniePrep: { readReadyPrep() { assert.fail("an edit cannot consume freshly resolved geometry"); } },
    resolveDimensions() { assert.fail("an edit cannot re-measure its selected parent"); },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].claim, claim);
  assert.equal(calls[0].ownerId, ownerId);
  assert.equal(result.revision.parentManifest, manifest);
  assert.equal(result.executionInput, executionInput);
  assert.deepEqual(result.surfaces, surfaces);
  assert.equal(result.geniePrepReceipt.source, "parent_revision_manifest");
  assert.equal(result.geniePrepReceipt.parentAtlasRevisionId, parentId);
  assert.equal(result.geniePrepReceipt.manifestContentHash, revision.revisionContext.parentManifest.contentHash);
  assert.equal(result.geniePrepReceipt.genieMs, 0);
});

test("a stale or invalid revision claim fails before any geometry or provider work", async () => {
  const expected = Object.assign(new Error("lease no longer owns this revision"), { code: "atlas_revision_lease_stale", retryable: false });
  await assert.rejects(resolveAtlasClaimGeometry({
    supabase: {}, claim, ownerId, provider: {}, prepareRevision: async () => { throw expected; },
    geniePrep: { readReadyPrep() { assert.fail("no downstream work after a rejected claim"); } },
    resolveDimensions() { assert.fail("no downstream work after a rejected claim"); },
  }), error => error === expected);
});

test("first generation retains READY prep consumption and the real inline fallback", async () => {
  const row = { side_width: 153, side_height: 56, passenger_width: 153, passenger_height: 56,
    hood_width: 71.5, hood_length: 56, roof_width: 74.3, roof_length: 54.8,
    front_width: 129, front_height: 34, rear_width: 76, rear_height: 54, resolvedVehicleClass: "truck" };
  const rootClaim = { requestId, generationId, input };
  let lookups = 0;
  const consumed = [];
  const run = prepared => resolveAtlasClaimGeometry({
    supabase: {}, claim: rootClaim, ownerId, provider: {}, prepareRevision: async () => null,
    geniePrep: { async readReadyPrep(args) { assert.equal(args.generationId, generationId); return prepared; },
      async consumePrep(...args) { consumed.push(args); } },
    async resolveDimensions() { lookups++; return row; },
  });
  const prepared = await run({ geometry: row, receipt: { prepId: "prep-1", durationMs: 80 } });
  assert.deepEqual(consumed, [["prep-1", requestId]]);
  assert.equal(lookups, 0);
  assert.equal(prepared.geniePrepReceipt.prepHit, true);
  assert.equal(prepared.executionInput.vehicle.type, "truck");
  const inline = await run(null);
  assert.equal(lookups, 1);
  assert.equal(inline.geniePrepReceipt.prepHit, false);
  assert.deepEqual(inline.surfaces, prepared.surfaces);
});

test("revision identity permits branching from saved history but refuses changed parents, contexts and retired layouts", () => {
  assert.equal(atlasRevisionIdentity({ ...revision, requestId }).revisionSequence, 3);
  assert.equal(atlasRevisionIdentity({ requestId }).revisionSequence, 1);
  for (const patch of [
    { revisionSequence: 1 }, { revisionSequence: 0 }, { revisionSequence: 1.5 },
    { parentAtlasRevisionId: "66666666-6666-4666-8666-666666666666" },
    { revisionContextHash: "b".repeat(64) },
    { parentManifest: { ...manifest, totalTrimSqFt: 1 } },
  ]) assert.throws(() => atlasRevisionIdentity({ ...revision, requestId, ...patch }), error => error.code === "flat_atlas_revision_identity_invalid");
  const rebound = (contextPatch, manifestValue = manifest) => {
    const next = { ...context, ...contextPatch, parentManifest: { ...context.parentManifest, contentHash: sha256(canonicalBytes(manifestValue)) } };
    return { ...revision, requestId, parentManifest: manifestValue, revisionContext: next, revisionContextHash: sha256(canonicalBytes(next)) };
  };
  for (const patch of [{ parentRevisionSequence: 3 }, { parentRevisionSequence: 0 },
    { parentRequestId: requestId }, { affectedSurfaces: ["driver", "driver"] }, { instruction: " " }]) {
    assert.throws(() => atlasRevisionIdentity(rebound(patch)), error => error.code === "flat_atlas_revision_identity_invalid");
  }
  assert.throws(() => atlasRevisionIdentity(rebound({}, { ...manifest, topology: "field-thirds-v2" })),
    error => error.code === "flat_atlas_revision_identity_invalid");
});

test("revision transport requires deployment capability and exact parent, teaching and history receipts", async t => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = "https://example.invalid";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "fixture-not-secret-".repeat(4);
  t.after(() => { oldUrl === undefined ? delete process.env.SUPABASE_URL : process.env.SUPABASE_URL = oldUrl;
    oldKey === undefined ? delete process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; });
  const teaching = loadBundledAtlasTeachingProof().identity;
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#438992' } }).png().toBuffer();
  const body = atlas._test.atlasEdgeRequestBody(input, manifest, {
    revisionContextHash: revision.revisionContextHash, teachingProofStoragePath: "atlas-call1-inputs/teaching.png",
    teachingProofIdentity: teaching, guideStoragePath: "atlas-call1-inputs/guide.png",
  });
  body.providerRequest = { requestId, attemptKey: "master:1", cacheOnly: false, claimToken: "77777777-7777-4777-8777-777777777777" };
  const provenance = { success: true, imageRequestCount: 1, model: DESIGNPANEL_AUTHORING_MODEL,
    masterStoragePath: "master.png", masterSha256: sha256(bytes),
    providerCacheContract: "designpro.gemini-provider-cache.v1", providerRequestKey: "c".repeat(64),
    revisionContextHash: revision.revisionContextHash, parentAtlasRevisionId: parentId,
    parentMasterContentHash: context.parentMaster.contentHash, revisionHistoryMode: context.history.mode,
    promptVersion: "atlas-artboard-designiq.20260901.v23-orthographic-restored",
    topologyContract: "designpro.atlas-normalized-topology.v1", modelInputImageCount: 3,
    teachingProofIdentity: teaching };
  const calls = [];
  const run = (patch = {}, supported = true) => atlas._test.callAtlasArtboardEdge(body, {
    ownerId, revisionContext: context,
    supabase: { storage: { from() { return { async download() { return { data: new Blob([bytes]), error: null }; } }; } } },
    fetchImpl: async (_url, request) => {
      calls.push(request.method);
      return { ok: true, status: 200, async json() { return request.method === "GET"
        ? { providerCacheContract: "designpro.gemini-provider-cache.v1", cacheOnly: true, modes: ["atlas-artboard"],
          ...(supported ? { revisionIntakeContract: context.contractVersion } : {}) }
        : { ...provenance, ...patch }; } };
    },
  });
  await assert.rejects(run({}, false), error => error.code === "flat_atlas_revision_intake_not_deployed");
  assert.deepEqual(calls, ["GET"], "an older deployment must never receive a revision-generating POST");
  for (const patch of [{ parentAtlasRevisionId: requestId }, { parentMasterContentHash: "d".repeat(64) },
    { revisionHistoryMode: "generate-content-replay" }, { teachingProofIdentity: null },
    { teachingProofIdentity: { ...teaching, flattenedTopViewContentHash: "e".repeat(64) } },
    { fieldContract: "retired" }, { modelInputImageCount: 15 }]) {
    await assert.rejects(run(patch), error => error.code === "flat_atlas_edge_revision_identity_mismatch");
  }
  const result = await run();
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.provenance.revisionContextHash, revision.revisionContextHash);
  assert.equal(result.provenance.parentAtlasRevisionId, parentId);
  assert.equal(result.provenance.revisionHistoryMode, "image-reference");
});
