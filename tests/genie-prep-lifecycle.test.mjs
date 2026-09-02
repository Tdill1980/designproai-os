// GENIE PREP — THE EARLY LIFECYCLE. Locks, no provider call, no database.
//
// Owner ruling 2026-09-02: vehicle complete / Enter → server acknowledges the
// GenerationID → GENIE prep starts → immutable geometry persists → Generate
// consumes it if READY for the same owner + GenerationID + vehicle identity +
// GENIE contract, else the existing inline resolver runs. Prepared geometry is
// private OS state and never enters the Gemini model-facing request.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const genie = require("../runtime/genie-universal-resolver.cjs");
const prep = require("../runtime/genie-prep.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const GENERATION = "33333333-3333-4333-8333-333333333333";
const REQUEST = "44444444-4444-4444-8444-444444444444";
const F250 = { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" };

/** The live-shape resolver return for the F250 (measured row), as the worker sees it. */
function dimensionRowFixture(overrides = {}) {
  const row = {
    id: "row-f250", make: "Ford", model: "F250 Crew Cab", year_range: "2022",
    side_width: "153", side_height: "56", passenger_width: "153", passenger_height: "56",
    hood_width: "71.5", hood_length: "56", roof_width: "74.3", roof_length: "54.8",
    front_width: "129", front_height: "34", rear_width: "76", rear_height: "54",
    proofGeometryAuthority: { contract: "designpro.proof-geometry.v1", surfaces: {} },
    resolvedVehicleClass: "truck",
    ...overrides,
  };
  return genie._test.stampGeometryResolution(row, { state: "measured", productionEligible: true, operatorValidated: true, geometrySourceRowId: "row-f250" });
}

/** An in-memory stand-in for the six RPCs, faithful to the migration's state machine. */
function fakeSupabase({ rows = new Map() } = {}) {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    const key = (a) => `${a.p_generation_id}|${a.p_vehicle_identity_hash}|${a.p_genie_contract_version}`;
    switch (name) {
      case "request_designpro_genie_prep": {
        for (const row of rows.values()) {
          if (row.generation_id === args.p_generation_id && row.owner_id !== args.p_owner_id) return { data: null, error: { message: "genie_prep_owner_conflict" } };
        }
        for (const row of rows.values()) {
          if (row.generation_id === args.p_generation_id && row.vehicle_identity_hash !== args.p_vehicle_identity_hash && ["queued", "ready", "failed"].includes(row.status)) row.status = "superseded";
        }
        let row = rows.get(key(args));
        const idempotent = Boolean(row);
        if (!row) {
          row = { id: `prep-${rows.size + 1}`, generation_id: args.p_generation_id, owner_id: args.p_owner_id, vehicle: args.p_vehicle, vehicle_identity_hash: args.p_vehicle_identity_hash, genie_contract_version: args.p_genie_contract_version, status: "queued", attempt: 0, requested_at: "2026-09-02T17:00:00Z" };
          rows.set(key(args), row);
        }
        return { data: { prepId: row.id, generationId: row.generation_id, vehicleIdentityHash: row.vehicle_identity_hash, status: row.status, attempt: row.attempt, requestedAt: row.requested_at, idempotent }, error: null };
      }
      case "claim_designpro_genie_prep": {
        const row = [...rows.values()].find((r) => (args.p_prep_id ? r.id === args.p_prep_id : true) && r.attempt < 3 && (r.status === "queued" || (r.status === "resolving" && r.lease_expired)));
        if (!row) return { data: null, error: null };
        row.status = "resolving"; row.attempt += 1; row.lease_token = `lease-${row.attempt}`; row.started_at ||= "2026-09-02T17:00:01Z"; row.lease_expired = false;
        return { data: { prepId: row.id, generationId: row.generation_id, status: row.status, attempt: row.attempt, startedAt: row.started_at, leaseToken: row.lease_token, vehicle: row.vehicle, ownerId: row.owner_id }, error: null };
      }
      case "complete_designpro_genie_prep": {
        const row = [...rows.values()].find((r) => r.id === args.p_prep_id);
        if (!row || row.lease_token !== args.p_lease_token || row.status !== "resolving") return { data: null, error: { message: "genie_prep_lease_stale" } };
        Object.assign(row, { status: "ready", geometry: args.p_geometry, geometry_manifest_hash: args.p_geometry_manifest_hash, geometry_state: args.p_geometry_state, production_eligible: args.p_production_eligible, duration_ms: args.p_duration_ms, prepared_at: "2026-09-02T17:00:05Z", lease_token: null });
        return { data: { prepId: row.id, status: "ready", durationMs: row.duration_ms, preparedAt: row.prepared_at }, error: null };
      }
      case "fail_designpro_genie_prep": {
        const row = [...rows.values()].find((r) => r.id === args.p_prep_id);
        if (!row || row.lease_token !== args.p_lease_token || row.status !== "resolving") return { data: null, error: { message: "genie_prep_lease_stale" } };
        row.status = args.p_retryable && row.attempt < 3 ? "queued" : "failed"; row.error_code = args.p_error_code; row.lease_token = null;
        return { data: { prepId: row.id, status: row.status, errorCode: row.error_code }, error: null };
      }
      case "read_designpro_genie_prep": {
        const row = rows.get(key(args));
        if (!row || row.owner_id !== args.p_owner_id) return { data: null, error: null };
        return { data: { prepId: row.id, generationId: row.generation_id, status: row.status, geometryManifestHash: row.geometry_manifest_hash || null, requestedAt: row.requested_at, preparedAt: row.prepared_at || null, durationMs: row.duration_ms ?? null, geometry: row.geometry || null }, error: null };
      }
      case "consume_designpro_genie_prep": {
        const row = [...rows.values()].find((r) => r.id === args.p_prep_id);
        if (!row || row.status !== "ready") return { data: null, error: { message: "genie_prep_not_ready" } };
        row.consumed_at ||= "2026-09-02T17:01:00Z"; row.consumed_by_request_id ||= args.p_request_id;
        return { data: { prepId: row.id, consumedAt: row.consumed_at }, error: null };
      }
      default: return { data: null, error: { message: `unknown rpc ${name}` } };
    }
  };
  return { rpc, rows, calls };
}

test("vehicle identity hash: one implementation, normalization-stable, changes with identity", () => {
  const a = genie.vehicleIdentityHash(F250);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(genie.vehicleIdentityHash({ year: " 2022 ", make: "ford", model: "f250  crew cab", type: "car" }), a, "whitespace, case and the F-Series class correction normalize away");
  assert.notEqual(genie.vehicleIdentityHash({ ...F250, year: "2023" }), a);
  assert.notEqual(genie.vehicleIdentityHash({ ...F250, model: "F350 Crew Cab" }), a);
  assert.notEqual(genie.vehicleIdentityHash({ ...F250, make: "Ram" }), a);
  assert.throws(() => genie.vehicleIdentityHash({ year: "22", make: "Ford", model: "F250", type: "truck" }), (error) => error.code === "genie_vehicle_identity_invalid");
  assert.equal(prep.GENIE_PREP_CONTRACT, genie.GENIE_PREP_CONTRACT);
  assert.ok(prep.GENIE_PREP_CONTRACT.includes(genie.GENIE_MANIFEST_CONTRACT), "the prep contract folds in the manifest contract so a manifest bump retires every prep");
});

test("requestPrep acknowledges, claims and resolves in the background with the SAME resolver; a retry is idempotent", async () => {
  const sb = fakeSupabase();
  const resolverCalls = [];
  const service = prep.createGeniePrepService({
    supabase: sb, provider: { fake: true }, workerId: "w1", logger: () => {},
    resolver: async (_sb, vehicle, provider) => { resolverCalls.push({ vehicle, provider }); return dimensionRowFixture(); },
  });
  const first = await service.requestPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: F250, clientEnteredAt: "2026-09-02T16:59:59Z" });
  assert.equal(first.receipt.status, "resolving");
  assert.equal(first.receipt.generationId, GENERATION);
  assert.ok(!("geometry" in first.receipt), "the receipt never carries the inches");
  const done = await first.settled;
  assert.equal(done.status, "ready");
  assert.equal(resolverCalls.length, 1);
  assert.deepEqual(resolverCalls[0].vehicle, F250);
  assert.equal(resolverCalls[0].provider.fake, true, "the prep uses the worker's own provider");
  const row = [...sb.rows.values()][0];
  assert.equal(row.status, "ready");
  assert.equal(row.geometry_manifest_hash, row.geometry.geometryResolution.genieManifestHash);
  assert.equal(row.geometry_state, "measured");
  assert.ok(row.duration_ms >= 0);
  // Retry for the same triple: no second row, no second resolver call.
  const again = await service.requestPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: F250 });
  assert.equal(again.receipt.status, "ready");
  assert.equal(again.receipt.idempotent, true);
  assert.equal(sb.rows.size, 1);
  assert.equal(resolverCalls.length, 1);
});

test("a failing resolver records failure (retryable → queued, else failed) and never throws out of the lifecycle", async () => {
  const sb = fakeSupabase();
  let attempt = 0;
  const service = prep.createGeniePrepService({
    supabase: sb, provider: {}, workerId: "w1", logger: () => {},
    resolver: async () => { attempt += 1; const e = new Error("grounding timed out"); e.code = "genie_grounding_timeout"; e.retryable = attempt === 1; throw e; },
  });
  const r1 = await service.requestPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: F250 });
  const f1 = await r1.settled;
  assert.equal(f1.status, "queued", "first failure is retryable → back to queued");
  const reclaimed = await service.reclaimOne();
  assert.equal(reclaimed.status, "resolving");
  await new Promise((r) => setTimeout(r, 5));
  const row = [...sb.rows.values()][0];
  assert.equal(row.status, "failed");
  assert.equal(row.error_code, "genie_grounding_timeout");
  assert.equal(attempt, 2);
});

test("readReadyPrep matches ONLY owner + GenerationID + vehicle identity + contract + READY; everything else is null (inline fallback)", async () => {
  const sb = fakeSupabase();
  const service = prep.createGeniePrepService({ supabase: sb, provider: {}, workerId: "w1", logger: () => {}, resolver: async () => dimensionRowFixture() });
  const { settled } = await service.requestPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: F250 });
  await settled;
  const hit = await service.readReadyPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: { ...F250, make: "FORD" } });
  assert.ok(hit, "same identity under normalization → hit");
  assert.equal(hit.geometry.geometryResolution.genieManifestHash, hit.receipt.geometryManifestHash);
  assert.equal(await service.readReadyPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: { ...F250, year: "2023" } }), null, "changed vehicle → no stale consumption");
  assert.equal(await service.readReadyPrep({ ownerId: OTHER_OWNER, generationId: GENERATION, vehicle: F250 }), null, "another owner → nothing");
  assert.equal(await service.readReadyPrep({ ownerId: OWNER, generationId: REQUEST, vehicle: F250 }), null, "another generation → nothing");
  assert.equal(await service.readReadyPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: { year: "x" } }), null, "an invalid vehicle never throws");
  // A prep whose contract differs is a different key and is never read.
  const stale = [...sb.rows.values()][0];
  stale.genie_contract_version = "designpro.genie-prep.v0+designpro.genie-manifest.v0";
  sb.rows.clear(); sb.rows.set(`${GENERATION}|${stale.vehicle_identity_hash}|${stale.genie_contract_version}`, stale);
  assert.equal(await service.readReadyPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: F250 }), null, "older GENIE contract → inline resolver");
  // A superseded / resolving / failed row is not READY.
  for (const status of ["superseded", "resolving", "failed", "queued"]) {
    stale.genie_contract_version = prep.GENIE_PREP_CONTRACT; stale.status = status;
    sb.rows.clear(); sb.rows.set(`${GENERATION}|${stale.vehicle_identity_hash}|${stale.genie_contract_version}`, stale);
    assert.equal(await service.readReadyPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: F250 }), null, `${status} → inline resolver`);
  }
});

test("a new vehicle for the same generation supersedes the older prep", async () => {
  const sb = fakeSupabase();
  const service = prep.createGeniePrepService({ supabase: sb, provider: {}, workerId: "w1", logger: () => {}, resolver: async () => dimensionRowFixture() });
  await (await service.requestPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: F250 })).settled;
  await (await service.requestPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: { ...F250, model: "F350 Crew Cab" } })).settled;
  const statuses = [...sb.rows.values()].map((r) => r.status).sort();
  assert.deepEqual(statuses, ["ready", "superseded"]);
  assert.equal(await service.readReadyPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: F250 }), null, "the superseded F250 prep is never consumed");
  assert.ok(await service.readReadyPrep({ ownerId: OWNER, generationId: GENERATION, vehicle: { ...F250, model: "F350 Crew Cab" } }));
});

test("the persisted geometry JSON round-trips to exactly what the inline resolver returns", () => {
  const row = dimensionRowFixture();
  const roundTripped = JSON.parse(JSON.stringify(row));
  assert.deepEqual(roundTripped, row);
  assert.deepEqual(genie.expectedSurfacesFromRow(roundTripped), genie.expectedSurfacesFromRow(row));
  assert.equal(roundTripped.geometryResolution.genieManifestHash, row.geometryResolution.genieManifestHash);
});

test("the worker consumes a READY prep and skips the resolver; otherwise it runs the inline resolver — and the receipt is persisted, never sent", () => {
  const src = readFileSync(new URL("../runtime/generation-worker.cjs", import.meta.url), "utf8");
  assert.ok(src.includes("const prepared = await geniePrep.readReadyPrep({"), "worker reads the prep before resolving");
  assert.ok(/if \(prepared\) \{\s*dimensionRow = prepared\.geometry;/.test(src), "a READY prep is consumed as the dimensionRow");
  assert.ok(/if \(!prepared\) \{\s*dimensionRow = await resolveFlatAtlasPreviewDimensions\(/.test(src), "the inline resolver remains the fallback");
  assert.ok(src.includes("geniePrep: geniePrepReceipt,"), "the lifecycle receipt is handed to Call 1 as metadata");
  assert.ok(src.includes("await geniePrep.reclaimOne().catch(() => null);"), "the idle tick recovers an expired lease");
  const flat = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.ok(flat.includes("genieMs: Number.isFinite(geniePrep?.genieMs) ? geniePrep.genieMs : null,"), "callOneTimings gains the GENIE segment");
  assert.ok(flat.includes('geniePrep: geniePrep && typeof geniePrep === "object" ? geniePrep : null,'), "metadata.geniePrep is persisted");
  const bodyStart = flat.indexOf("function atlasEdgeRequestBody(");
  const bodyEnd = flat.indexOf("\n}\n", bodyStart);
  assert.ok(bodyStart > 0 && bodyEnd > bodyStart);
  assert.ok(!flat.slice(bodyStart, bodyEnd).includes("geniePrep"), "prepared geometry never enters the model-facing request");
});

test("the Call-1 request body is byte-identical whether the geometry came from a prep hit or the inline resolver", () => {
  const surfaces = genie.expectedSurfacesFromRow(dimensionRowFixture());
  const manifest = atlas.buildAtlasManifest(surfaces, null, "truck");
  const input = { contractVersion: "designpro.calls-1-7-input.v3", pipelineMode: "flat-first-atlas-v1", vehicle: F250, brief: "b", designName: "d", mode: "commercial", industry: "HVAC", colors: ["blue"], style: "modern" };
  const inline = atlas._test.atlasEdgeRequestBody(input, manifest, {});
  const fromPrep = atlas._test.atlasEdgeRequestBody(input, JSON.parse(JSON.stringify(manifest)), {});
  const sha = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
  assert.equal(sha(inline), sha(fromPrep));
  assert.ok(!JSON.stringify(inline).includes("geniePrep"));
  assert.ok(!JSON.stringify(inline).includes("prepHit"));
});

test("the runtime route and the gateway routes exist, are worker-secret / session gated, and answer receipts only", () => {
  const index = readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");
  assert.ok(index.includes('app.post("/internal/genie/prep", authMiddleware,'));
  assert.ok(index.includes("generationWorker?.geniePrep"));
  const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
  const sessionGate = gateway.indexOf('return json(res, 401, { error: "authentication_required" });');
  assert.ok(gateway.indexOf('url.pathname === "/api/genie/prep"') > sessionGate, "prep request sits behind the session gate");
  assert.ok(gateway.includes("/internal/genie/prep"));
  assert.ok(gateway.includes("ownerId: user.id,"), "the owner is the session user, never the body");
  const at = gateway.indexOf("designpro_genie_preps?generation_id=eq.");
  const statusSelect = gateway.slice(at, at + 400);
  assert.ok(!/[,=]geometry[,&]/.test(statusSelect), "the status route never selects the geometry blob");
});
