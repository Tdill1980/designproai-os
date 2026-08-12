import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const contract = require("../../runtime/runtime-contract.cjs");
const readiness = require("../../runtime/runtime-readiness.cjs");
const universal = require("../../runtime/genie-universal-resolver.cjs");
const claimantSource = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const runtimeEntrySource = readFileSync(new URL("../../runtime/index.js", import.meta.url), "utf8");
const workflowSql = readFileSync(new URL("../../supabase/migrations/20260806180100_designpro_workflow_rpcs.sql", import.meta.url), "utf8").toLowerCase();
const dimensionSql = readFileSync(new URL("../../supabase/migrations/20260806180500_designpro_vehicle_dimensions.sql", import.meta.url), "utf8").toLowerCase();
const migrationRoot = new URL("../../supabase/migrations/", import.meta.url);
const readinessSql = readdirSync(migrationRoot)
  .filter((name) => name.endsWith(".sql"))
  .sort()
  .map((name) => readFileSync(new URL(name, migrationRoot), "utf8"))
  .join("\n")
  .toLowerCase();

const ownerId = "12345678-1234-4123-8123-123456789abc";
const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const tenant = `user_${ownerId}`;
const bytes = Buffer.from("immutable-view");
const hash = createHash("sha256").update(bytes).digest("hex");

function sourceIdentity(overrides = {}) {
  return {
    storagePath: `users/${ownerId}/revisions/${revisionId}/inputs/driver/${hash}.png`,
    contentHash: hash,
    byteSize: bytes.length,
    contentType: "image/png",
    ...overrides,
  };
}

function storageMock() {
  const objects = new Map();
  const calls = [];
  return {
    calls,
    objects,
    from(bucket) {
      assert.equal(bucket, "wrap-files");
      return {
        async upload(path, body, options) {
          calls.push({ operation: "upload", path, options });
          if (objects.has(path)) return { error: { error: "Duplicate", statusCode: "409", message: "The resource already exists" } };
          objects.set(path, Buffer.from(body));
          return { error: null };
        },
        async download(path) {
          calls.push({ operation: "download", path });
          const body = objects.get(path);
          return body ? { data: new Blob([body]), error: null } : { data: null, error: { message: "not found" } };
        },
      };
    },
  };
}

test("gateway immutable object prefix exactly satisfies the runtime contract", () => {
  const normalized = contract.normalizeSourceAsset(sourceIdentity(), tenant, revisionId);
  assert.equal(normalized.storagePath, sourceIdentity().storagePath);
  assert.equal(contract.verifySourceBytes(normalized, bytes), bytes);
  assert.throws(() => contract.normalizeSourceAsset(sourceIdentity({ signedUrl: "https://example.test/expiring" }), tenant, revisionId), /must not contain.*URL/);
  assert.throws(() => contract.normalizeSourceAsset(sourceIdentity(), `user:${ownerId}`, revisionId), /canonical user_/);
  assert.throws(() => contract.safeStoragePath(`designpro/${tenant}/${runId}/../escape.png`), /unsafe path/);
  const logoHash = "a".repeat(64);
  const logo = contract.normalizeLogoAsset({ storagePath: `users/${ownerId}/revisions/${revisionId}/inputs/logo/${logoHash}.pdf`, contentHash: logoHash, byteSize: 40, contentType: "application/pdf" }, tenant, revisionId);
  assert.equal(logo.contentType, "application/pdf");
  assert.throws(() => contract.normalizeSourceAsset(logo, tenant, revisionId), /contentType is not allowed/);
});

test("derived Storage writes are create-only, exact-idempotent, and drift-failing", async () => {
  const storage = storageMock();
  const path = `designpro/${tenant}/${runId}/proof-masters/driver.png`;
  const first = await contract.immutableStorageUpload(storage, "wrap-files", path, bytes, "image/png");
  assert.equal(first.idempotent, false);
  const retry = await contract.immutableStorageUpload(storage, "wrap-files", path, bytes, "image/png");
  assert.equal(retry.idempotent, true);
  assert.ok(storage.calls.filter((call) => call.operation === "upload").every((call) => call.options.upsert === false));
  await assert.rejects(contract.immutableStorageUpload(storage, "wrap-files", path, Buffer.from("different"), "image/png"), /different bytes/);
});

test("readiness verifies RPC contract, seeds, and private bucket", async () => {
  const fake = {
    async rpc(name) {
      assert.equal(name, "designpro_runtime_readiness");
      return { data: { contract: readiness.READINESS_CONTRACT, ready: true, rpcCount: 17, dimensionSeedCount: 0, qcSeedCount: 0, groundedIdentityFence: true, heavyOutputLeaseFence: true, wrapboxFence: true, capabilities: { validatedGeometrySeeded: false, qcOperatorSeeded: false } }, error: null };
    },
    storage: { async listBuckets() { return { data: [{ id: "wrap-files", name: "wrap-files", public: false }], error: null }; } },
  };
  assert.deepEqual(await readiness.probeRuntimeDependencies(fake), {
    ready: true, contract: readiness.READINESS_CONTRACT, rpcCount: 17,
    dimensionSeedCount: 0, qcSeedCount: 0, groundedIdentityFence: true,
    heavyOutputLeaseFence: true, wrapboxFence: true,
    capabilities: { validatedGeometrySeeded: false, qcOperatorSeeded: false }, bucket: "wrap-files", bucketPrivate: true,
  });
  fake.rpc = async () => ({ data: { contract: "designpro.runtime-readiness.v1", ready: true }, error: null });
  await assert.rejects(readiness.probeRuntimeDependencies(fake), /contract is missing or incompatible/);
  fake.rpc = async () => ({ data: { contract: readiness.READINESS_CONTRACT, ready: true, groundedIdentityFence: true, heavyOutputLeaseFence: true, wrapboxFence: true }, error: null });
  fake.storage.listBuckets = async () => ({ data: [{ id: "wrap-files", public: true }], error: null });
  await assert.rejects(readiness.probeRuntimeDependencies(fake), /privacy could not be verified/);
});

test("final QC is readable and output.verify cannot reinsert artifacts", () => {
  assert.match(claimantSource, /"output\.verified", "final\.human-qc", "stamp"/);
  assert.match(claimantSource, /stage\.stage_key === "output\.verify"[\s\S]*?return complete\([\s\S]*?null, \[\]\);/);
  assert.ok(workflowSql.includes("verified_output_artifact_ledger_mismatch"));
  assert.ok(workflowSql.includes("coalesce(p_artifacts,'[]'::jsonb) is distinct from '[]'::jsonb"));
});

test("production artifact metadata matches the exact output and repeated-logo SQL contracts", () => {
  for (const key of ["format", "width", "height", "dpi", "outputScale", "fullScaleBleedInches"]) {
    assert.match(claimantSource, new RegExp(`artifact\\(\\"output\\"[\\s\\S]*?${key}:`), `output metadata is missing ${key}`);
  }
  for (const key of ["placementKey", "identityKey", "displayName", "targetSurfaceKey", "separationContract", "sourceRegionHash", "contentType"]) {
    assert.match(claimantSource, new RegExp(`metadata: \\{[\\s\\S]{0,300}${key}`), `Call 10 metadata is missing ${key}`);
  }
  assert.match(claimantSource, /surfaceKey: placementKey/);
});

test("production preserves Call 10 logos through source verify, ZIP, and WrapBox manifest", () => {
  assert.match(claimantSource, /stage\.stage_key === "source\.verify"[\s\S]*?sourceProofs[\s\S]*?sourcePanels[\s\S]*?sourceLogos[\s\S]*?copyPinnedSourceArtifact/);
  assert.match(claimantSource, /artifacts\(sb, run\.id, \["flat-proof", "panel", "logo", "output", "stamp"\]\)/);
  assert.match(claimantSource, /contract: MANIFEST_CONTRACT[\s\S]*?logos,[\s\S]*?files/);
  assert.match(claimantSource, /publicationPending: true/);
  assert.doesNotMatch(claimantSource, /deliver_designpro_wrapbox_pack/);
});

test("the final deterministic pack includes the seven source views and GENIE dimension manifest", () => {
  assert.match(claimantSource, /sourceViewZipEntries\(sb, sourceViews\)/);
  assert.match(claimantSource, /dimension-manifest\/designpro-genie-dimension-manifest\.json/);
  assert.match(claimantSource, /"source-view": 7, "dimension-manifest": 1/);
  assert.match(claimantSource, /sourceViews: zipReceipt\.receipt\.sourceViews, dimensionManifest: zipReceipt\.receipt\.dimensionManifest/);
});

test("visible stamp, ZIP identity file, and WrapBox bind immutable DesignID plus Order #", () => {
  assert.match(claimantSource, /DID-\$\{value\.replaceAll\("-", ""\)\.slice\(0, 8\)\.toUpperCase\(\)\}/);
  assert.match(claimantSource, /snapshot\.designId !== designId/);
  assert.match(claimantSource, /snapshot\.delivery\?\.orderNumber !== orderNumber/);
  assert.match(claimantSource, /DesignID: \$\{escape\(designId\)\}/);
  assert.match(claimantSource, /Order #: \$\{escape\(orderNumber\)\}/);
  assert.match(claimantSource, /finalQc\.receipt\?\.qc\?\.designId !== designId[\s\S]*?finalQc\.receipt\?\.qc\?\.orderNumber !== orderNumber/);
  assert.match(claimantSource, /identity\/design-order\.json/);
  assert.match(claimantSource, /manifest = \{[\s\S]*?designId: zipReceipt\.receipt\.designId, orderNumber: zipReceipt\.receipt\.orderNumber/);
  assert.match(claimantSource, /artifact\("wrapbox-manifest"[\s\S]*?designId: businessIdentity\.designId, orderNumber: businessIdentity\.orderNumber/);
  assert.doesNotMatch(claimantSource, /DesignID:.*run\.id|Order #:.*run\.id/);
});

test("Call 8 authors one flat wrap design and Call 9 only cuts it", () => {
  const entry = readFileSync(new URL("../../runtime/index.js", import.meta.url), "utf8");
  const wrapSource = readFileSync(new URL("../../runtime/gemini-flat-wrap.cjs", import.meta.url), "utf8");
  const layoutSource = readFileSync(new URL("../../runtime/flat-wrap-layout.cjs", import.meta.url), "utf8");
  assert.match(entry, /authorFlatWrapLayout/);
  assert.match(entry, /cutAllPanels/);
  assert.match(wrapSource, /gemini-3-pro-image|selectedImageModel/);
  assert.match(wrapSource, /imageSize: "4K"/);
  assert.match(wrapSource, /OUTPUT ONLY THE ARTWORK CANVAS/);
  // The hero anchor put driver artwork on every panel. It must stay deleted,
  // along with the per-surface generation calls that carried it.
  assert.doesNotMatch(wrapSource, /cross-vehicle design anchor/i);
  assert.doesNotMatch(wrapSource, /DESIGN ANCHOR/);
  assert.doesNotMatch(entry, /authorFlatSurfaceMasters/);
  assert.equal(existsSync(new URL("../../runtime/deterministic-artboard.cjs", import.meta.url)), false);
  // Call 9 cuts and verifies; it never regenerates.
  assert.match(claimantSource, /sourceRule: "deterministic-cut-of-approved-call8-flat-wrap-layout"/);
  assert.match(claimantSource, /call9_cut_hash_mismatch/);
  assert.match(claimantSource, /call9_layout_changed/);
  assert.match(layoutSource, /layout_surface_artwork_reused/);
});

test("heavy output, lease-loss abort, structural output QC, deterministic stamp and delivery are wired", () => {
  assert.match(claimantSource, /stageLeaseContext\.run\(stageGuard/);
  assert.match(claimantSource, /stageGuard\.controller\.abort/);
  assert.match(claimantSource, /acquire_designpro_heavy_lease/);
  assert.match(claimantSource, /p_stage_id: stage\.id,[\s\S]*?p_lease_token: stage\.lease_token,[\s\S]*?p_worker: requiredString\(stage\.lease_owner,[\s\S]*?p_lease_seconds: 120/);
  assert.doesNotMatch(claimantSource, /p_ttl_seconds/);
  assert.doesNotMatch(claimantSource, /sb\.rpc\("release_designpro_heavy_lease"/);
  assert.match(claimantSource, /database stage transition releases the exact slot atomically/);
  assert.match(claimantSource, /exactSurfaceFormatCount: 18/);
  assert.match(claimantSource, /createDeterministicZip64Stream/);
  assert.match(claimantSource, /uploadSpoolWithTus/);
  assert.match(claimantSource, /stamped-call8-proof\.png/);
  assert.doesNotMatch(claimantSource, /deliveredAt: new Date/);
});

test("every server-produced artifact above 6 MiB uses persistent create-only resumable transport", () => {
  assert.match(claimantSource, /body\.length > MAX_STANDARD_UPLOAD_BYTES[\s\S]*?artifact_requires_resumable_transport/);
  assert.match(claimantSource, /uploadProducedBytes[\s\S]*?spoolImmutableBuffer[\s\S]*?uploadSpoolWithTus/);
  assert.match(claimantSource, /outputs\/\$\{slug\}[\s\S]*?uploadProducedBytes/);
  assert.match(claimantSource, /stamped-call8-proof\.png[\s\S]*?stampedStored\.spool/);
  assert.match(runtimeEntrySource, /body\.length <= MAX_STANDARD_UPLOAD_BYTES[\s\S]*?spoolImmutableBuffer[\s\S]*?uploadSpoolWithTus/);
  assert.match(runtimeEntrySource, /persist: \(bytes\) => uploadBuffer/);
});

test("recipient registration remains worker-authenticated and strips service authority", () => {
  assert.match(runtimeEntrySource, /app\.post\("\/internal\/wrapbox\/recipient", authMiddleware/);
  assert.match(runtimeEntrySource, /register_designpro_operator_wrapbox_recipient/);
  assert.match(runtimeEntrySource, /p_operator_id: operatorId/);
  assert.match(runtimeEntrySource, /p_customer_email: customerEmail/);
  assert.match(runtimeEntrySource, /p_customer_reference: customerReference/);
  assert.match(runtimeEntrySource, /p_order_number: orderNumber/);
  assert.match(runtimeEntrySource, /customerId:[\s\S]*?customerEmail:[\s\S]*?recipientIdentityHash:[\s\S]*?emailVerifiedAt:[\s\S]*?orderNumber:/);
  assert.doesNotMatch(runtimeEntrySource, /customerAuthUserId, "customerAuthUserId"/);
  assert.doesNotMatch(runtimeEntrySource, /res\.json\([^)]*SUPABASE_SERVICE_ROLE_KEY/);
});

test("front and rear remain distinct through schema, claimant, and square-foot sum", () => {
  for (const field of ["front_width", "front_height", "rear_width", "rear_height"]) assert.ok(dimensionSql.includes(field));
  assert.match(claimantSource, /dim\(row\.front_width, row\.front_height, "front", views\.front\)/);
  assert.match(claimantSource, /dim\(row\.rear_width, row\.rear_height, "rear", views\.rear\)/);
  assert.match(claimantSource, /expectedSurfaces\.reduce\(\(total, item\) => total \+ \(item\.widthInches \* item\.heightInches \/ 144\), 0\)/);
  assert.doesNotMatch(claimantSource, /dim\(row\.back_width, row\.back_height, "(?:front|rear)"/);
});

test("Universal GENIE accepts only exact validated six-surface evidence", () => {
  const surfaces = Object.fromEntries(universal.SURFACES.map((key, index) => [key, { widthInches: 50 + index, heightInches: 20 + index }]));
  const row = { id: runId, make: "Porsche", model: "911", requires_validation: false, validated_by: ownerId, validated_at: "2026-08-06T00:00:00Z", validated_surfaces: { contractVersion: "designpro.genie-validated-surfaces.v1", surfaces } };
  const resolved = universal._test.validatedSurfaces(row);
  assert.equal(resolved.front_width, surfaces.front.widthInches);
  assert.equal(resolved.rear_width, surfaces.rear.widthInches);
  assert.equal(universal._test.validatedSurfaces({ ...row, validated_surfaces: { surfaces } }), null);
  assert.ok(readinessSql.includes("validate_designpro_vehicle_spec_universal(uuid,jsonb,text,jsonb)"));
  assert.ok(readinessSql.includes("request_designpro_universal_dimension_validation(uuid,uuid,uuid,uuid)"));
  assert.ok(readinessSql.includes("designpro_universal_grounded_identity_uidx"));
  assert.ok(readinessSql.includes("'contract','designpro.runtime-readiness.v2'"));
  assert.ok(readinessSql.includes("'heavyoutputleasefence',v_heavy_lease_fence"));
  assert.ok(readinessSql.includes("'wrapboxfence',v_wrapbox_fence"));
  assert.match(claimantSource, /error\.stageHandled !== true/);
});

test("an unvalidated Universal GENIE candidate parks the stage without invoking failure", async () => {
  const candidateId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const calls = [];
  const query = {
    select() { return this; }, eq() { return this; }, ilike() { return this; },
    limit() { return Promise.resolve({ data: [{ id: candidateId, requires_validation: true }], error: null }); },
  };
  const sb = {
    from(table) { assert.equal(table, "designpro_vehicle_specs_universal"); return query; },
    async rpc(name, payload) { calls.push({ name, payload }); return { error: null }; },
  };
  await assert.rejects(
    universal.resolveOrQueueUniversalDimensions(sb, { type: "car", year: 2024, make: "Porsche", model: "911" }, { id: runId, lease_token: revisionId }, runId),
    (error) => error.code === "genie_dimension_validation_required" && error.stageHandled === true && error.retryable === false,
  );
  assert.deepEqual(calls, [{ name: "request_designpro_universal_dimension_validation", payload: {
    p_run_id: runId, p_candidate_id: candidateId, p_stage_id: runId, p_lease_token: revisionId,
  } }]);
});
