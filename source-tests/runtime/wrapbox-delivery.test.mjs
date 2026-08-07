import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const closure = require("../../runtime/wrapbox-delivery.cjs");
const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const sql = readFileSync(join(root, "supabase/migrations/20260806181100_designpro_wrapbox_delivery_closure.sql"), "utf8");

const ids = Object.freeze({
  operator: "11111111-1111-4111-8111-111111111111",
  customer: "22222222-2222-4222-8222-222222222222",
  revision: "33333333-3333-4333-8333-333333333333",
  entice: "44444444-4444-4444-8444-444444444444",
  run: "55555555-5555-4555-8555-555555555555",
  zipStage: "66666666-6666-4666-8666-666666666666",
  deliveryStage: "77777777-7777-4777-8777-777777777777",
  notification: "88888888-8888-4888-8888-888888888888",
  lease: "99999999-9999-4999-8999-999999999999",
  pack: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  generation: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
});

const sha = (value) => createHash("sha256").update(value).digest("hex");

function deliverySnapshot() {
  return {
    contractVersion: "designpro.revision-snapshot.v1",
    generationId: ids.generation,
    designId: "DID-EEEEEEEE",
    orderNumber: "ORD-2026-0042",
    delivery: {
      contractVersion: closure.DELIVERY_CONTRACT,
      customerId: ids.customer,
      customerEmail: "customer@example.com",
      recipientIdentityHash: "a".repeat(64),
      designName: "Distressed Porsche Production Pack",
      orderNumber: "ORD-2026-0042",
    },
  };
}

test("missing immutable recipient fails closed and names every required input", () => {
  assert.throws(
    () => closure.assertDeliverySnapshot({ contractVersion: "designpro.revision-snapshot.v1" }),
    (error) => {
      assert.equal(error.code, "delivery_recipient_snapshot_required");
      assert.deepEqual(error.missingInput, [
        "revisionSnapshot.delivery.contractVersion",
        "revisionSnapshot.delivery.customerEmail",
        "revisionSnapshot.delivery.customerId",
        "revisionSnapshot.delivery.designName",
        "revisionSnapshot.delivery.orderNumber",
        "revisionSnapshot.delivery.recipientIdentityHash",
      ]);
      return true;
    },
  );
});

test("business customer remains distinct from authenticated workflow operator", () => {
  const recipient = closure.assertDeliverySnapshot(deliverySnapshot());
  assert.equal(recipient.customerId, ids.customer);
  assert.notEqual(recipient.customerId, ids.operator);
});

test("registered Order # is exact and colon is rejected across delivery and immutable identity", () => {
  const snapshot = deliverySnapshot();
  snapshot.orderNumber = "ORD:2026";
  snapshot.delivery.orderNumber = "ORD:2026";
  assert.throws(() => closure.assertDeliverySnapshot(snapshot), (error) => error.code === "delivery_order_number_invalid");
  assert.throws(() => closure.immutableBusinessIdentity({ generation_id: ids.generation, snapshot }), (error) => error.code === "delivery_business_identity_invalid");
});

test("repeated logo identity preserves each target surface", () => {
  const base = {
    identityKey: "acme-primary",
    displayName: "ACME",
    storagePath: `users/${ids.operator}/revisions/${ids.revision}/inputs/logo/${"b".repeat(64)}.svg`,
    contentHash: "b".repeat(64),
    byteSize: 812,
    contentType: "image/svg+xml",
  };
  const inventory = closure.normalizeLogoInventory([
    { ...base, placementKey: "passenger:acme-primary:1", targetSurfaceKey: "passenger" },
    { ...base, placementKey: "driver:acme-primary:0", targetSurfaceKey: "driver" },
  ]);
  assert.deepEqual(inventory.map(({ identityKey, targetSurfaceKey }) => ({ identityKey, targetSurfaceKey })), [
    { identityKey: "acme-primary", targetSurfaceKey: "driver" },
    { identityKey: "acme-primary", targetSurfaceKey: "passenger" },
  ]);
});

class FakeQuery {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
    this.max = null;
  }
  select() { return this; }
  eq(column, value) { this.filters.push([column, value]); return this; }
  order() { return this; }
  limit(value) { this.max = value; return this; }
  matches() {
    const found = this.rows.filter((row) => this.filters.every(([column, value]) => row[column] === value));
    return this.max == null ? found : found.slice(0, this.max);
  }
  async maybeSingle() {
    const found = this.matches();
    return found.length === 1 ? { data: found[0], error: null }
      : found.length === 0 ? { data: null, error: null }
        : { data: null, error: { message: "multiple rows" } };
  }
  then(resolve, reject) { return Promise.resolve({ data: this.matches(), error: null }).then(resolve, reject); }
}

function publicationFixture({ tamperDeliveredZip = false } = {}) {
  const sourceZip = Buffer.from("approved exact production ZIP");
  const deliveredZip = tamperDeliveredZip ? Buffer.from("tampered production ZIP") : sourceZip;
  const zipHash = sha(sourceZip);
  const logoHash = "b".repeat(64);
  const logos = [
    {
      placementKey: "driver:acme-primary:0",
      identityKey: "acme-primary",
      displayName: "ACME",
      targetSurfaceKey: "driver",
      storagePath: `users/${ids.operator}/revisions/${ids.revision}/inputs/logo/${logoHash}.svg`,
      contentHash: logoHash,
      byteSize: 812,
      contentType: "image/svg+xml",
    },
    {
      placementKey: "passenger:acme-primary:1",
      identityKey: "acme-primary",
      displayName: "ACME",
      targetSurfaceKey: "passenger",
      storagePath: `users/${ids.operator}/revisions/${ids.revision}/inputs/logo/${logoHash}.svg`,
      contentHash: logoHash,
      byteSize: 812,
      contentType: "image/svg+xml",
    },
  ];
  const prefix = `wrapbox/user_${ids.operator}/${ids.entice}/${ids.run}`;
  const deliveredZipPath = `${prefix}/production-pack.zip`;
  const manifestPath = `${prefix}/manifest.json`;
  const manifest = {
    contract: closure.MANIFEST_CONTRACT,
    workflowRunId: ids.run,
    operatorId: ids.operator,
    customerId: ids.customer,
    recipientIdentityHash: "a".repeat(64),
    tenantKey: `user_${ids.operator}`,
    enticePackId: ids.entice,
    revisionId: ids.revision,
    designId: "DID-EEEEEEEE",
    orderNumber: "ORD-2026-0042",
    businessIdentity: { designId: "DID-EEEEEEEE", orderNumber: "ORD-2026-0042" },
    zip: { storagePath: deliveredZipPath, contentHash: zipHash, byteSize: sourceZip.length },
    logos,
    deliveredAt: "2026-08-06T19:00:00.000Z",
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const manifestHash = sha(manifestBytes);
  const sourceZipPath = `designpro/user_${ids.operator}/${ids.run}/production-pack.zip`;
  const tableRows = {
    designpro_workflow_runs: [{
      id: ids.run, workflow_type: "designpro.production_pack", status: "completed",
      owner_id: ids.operator, tenant_key: `user_${ids.operator}`, revision_id: ids.revision,
      revision_snapshot_hash: "c".repeat(64), entice_pack_id: ids.entice,
    }],
    designpro_revision_sources: [{
      revision_id: ids.revision, owner_id: ids.operator, tenant_key: `user_${ids.operator}`,
      generation_id: ids.generation, snapshot: deliverySnapshot(), snapshot_hash: "c".repeat(64),
    }],
    designpro_stage_receipts: [
      { run_id: ids.run, receipt_kind: "zip", stage_id: ids.zipStage, receipt_hash: zipHash, receipt: { verified: true, receiptKind: "zip", zipHash } },
      { run_id: ids.run, receipt_kind: "wrapbox.delivery", stage_id: ids.deliveryStage, receipt_hash: manifestHash, receipt: { verified: true, receiptKind: "wrapbox.delivery", zipHash, deliveredZipPath, manifestPath, deliveredAt: manifest.deliveredAt, designId: "DID-EEEEEEEE", orderNumber: "ORD-2026-0042" } },
    ],
    designpro_artifacts: [
      { run_id: ids.run, artifact_kind: "zip", content_hash: zipHash, stage_id: ids.zipStage, storage_path: sourceZipPath, byte_size: sourceZip.length, surface_key: "", metadata: {} },
      { run_id: ids.run, artifact_kind: "wrapbox-manifest", content_hash: manifestHash, stage_id: ids.deliveryStage, storage_path: manifestPath, byte_size: manifestBytes.length, surface_key: "", metadata: { zipHash, designId: "DID-EEEEEEEE", orderNumber: "ORD-2026-0042" } },
      ...logos.map((logo) => ({
        run_id: ids.run, artifact_kind: "logo", stage_id: ids.zipStage,
        surface_key: logo.placementKey, storage_path: logo.storagePath,
        content_hash: logo.contentHash, byte_size: logo.byteSize,
        metadata: {
          placementKey: logo.placementKey, identityKey: logo.identityKey,
          displayName: logo.displayName, targetSurfaceKey: logo.targetSurfaceKey,
          contentType: logo.contentType,
        },
      })),
    ],
    designpro_wrapbox_packs: [],
  };
  const objects = new Map([
    [sourceZipPath, sourceZip],
    [deliveredZipPath, deliveredZip],
    [manifestPath, manifestBytes],
  ]);
  const rpcCalls = [];
  const supabase = {
    from(table) { return new FakeQuery(tableRows[table] || []); },
    storage: {
      from(bucket) {
        assert.equal(bucket, closure.BUCKET);
        return { async download(path) { return objects.has(path) ? { data: objects.get(path), error: null } : { data: null, error: { message: "missing" } }; } };
      },
    },
    async rpc(name, args) {
      rpcCalls.push({ name, args });
      return { data: { packId: ids.pack, customerId: ids.customer }, error: null };
    },
  };
  return { supabase, rpcCalls, zipHash, manifestHash, logos };
}

test("publisher verifies both ZIP copies, manifest, customer, and repeated logo placements before commit", async () => {
  const fixture = publicationFixture();
  const result = await closure.publishCompletedWrapboxDelivery({ supabase: fixture.supabase, runId: ids.run });
  assert.equal(result.packId, ids.pack);
  assert.equal(fixture.rpcCalls.length, 1);
  const call = fixture.rpcCalls[0];
  assert.equal(call.name, "commit_designpro_wrapbox_pack");
  assert.equal(call.args.p_observed_zip_hash, fixture.zipHash);
  assert.equal(call.args.p_observed_manifest_hash, fixture.manifestHash);
  assert.deepEqual(call.args.p_observed_logo_inventory.map((logo) => [logo.identityKey, logo.targetSurfaceKey]), [
    ["acme-primary", "driver"],
    ["acme-primary", "passenger"],
  ]);
});

test("publisher rejects changed delivered ZIP bytes before database commit", async () => {
  const fixture = publicationFixture({ tamperDeliveredZip: true });
  await assert.rejects(
    closure.publishCompletedWrapboxDelivery({ supabase: fixture.supabase, runId: ids.run }),
    (error) => error.code === "delivery_zip_bytes_changed",
  );
  assert.equal(fixture.rpcCalls.length, 0);
});

test("notification requires provider idempotency and completes the exact leased row", async () => {
  const calls = [];
  const sent = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "claim_designpro_wrapbox_notification") return { data: [{
        notification_id: ids.notification,
        lease_token: ids.lease,
        pack_id: ids.pack,
        operator_id: ids.operator,
        customer_id: ids.customer,
        recipient_email: "customer@example.com",
        template_payload: {
          contractVersion: closure.NOTIFICATION_CONTRACT,
          packId: ids.pack,
          designId: "DID-EEEEEEEE",
          orderNumber: "ORD-2026-0042",
          designName: "Distressed Porsche Production Pack",
          portalPath: `/app/wrapbox/${ids.pack}`,
          zipContentHash: "d".repeat(64),
        },
        idempotency_key: `designpro-wrapbox-email:${ids.pack}:${"e".repeat(64)}`,
      }], error: null };
      if (name === "complete_designpro_wrapbox_notification") return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  await assert.rejects(
    closure.dispatchOneWrapboxNotification({ supabase, workerId: "mailer-1", appOrigin: "https://os.designproai.com", emailTransport: { send() {} } }),
    (error) => error.code === "idempotent_email_transport_required",
  );
  const result = await closure.dispatchOneWrapboxNotification({
    supabase,
    workerId: "mailer-1",
    appOrigin: "https://os.designproai.com",
    emailTransport: {
      supportsIdempotency: true,
      async send(message) { sent.push(message); return { providerMessageId: "provider-123" }; },
    },
  });
  assert.equal(result.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].portalUrl, `https://os.designproai.com/app/wrapbox/${ids.pack}`);
  assert.match(sent[0].text, /DesignID: DID-EEEEEEEE/);
  assert.match(sent[0].text, /Order #: ORD-2026-0042/);
  assert.match(sent[0].idempotencyKey, /^designpro-wrapbox-email:/);
  assert.equal(calls.at(-1).name, "complete_designpro_wrapbox_notification");
  assert.deepEqual(calls.at(-1).args, {
    p_notification_id: ids.notification,
    p_lease_token: ids.lease,
    p_provider_message_id: "provider-123",
  });
});

test("notification failures are persisted without recipient or token leakage", async () => {
  const calls = [];
  const supabase = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "claim_designpro_wrapbox_notification") return { data: [{
        notification_id: ids.notification, lease_token: ids.lease, pack_id: ids.pack,
        operator_id: ids.operator, customer_id: ids.customer,
        recipient_email: "customer@example.com",
        template_payload: { contractVersion: closure.NOTIFICATION_CONTRACT, packId: ids.pack, designId: "DID-EEEEEEEE", orderNumber: "ORD-2026-0042", designName: "Pack", portalPath: `/app/wrapbox/${ids.pack}`, zipContentHash: "d".repeat(64) },
        idempotency_key: "stable-provider-key",
      }], error: null };
      if (name === "fail_designpro_wrapbox_notification") return { data: true, error: null };
      throw new Error(`unexpected RPC ${name}`);
    },
  };
  const providerError = new Error("customer@example.com Bearer super-secret token=abc123");
  providerError.retryable = true;
  await assert.rejects(closure.dispatchOneWrapboxNotification({
    supabase, workerId: "mailer-1", appOrigin: "https://os.designproai.com",
    emailTransport: { supportsIdempotency: true, async send() { throw providerError; } },
  }), providerError);
  const failure = calls.find((call) => call.name === "fail_designpro_wrapbox_notification");
  assert.ok(failure);
  assert.doesNotMatch(failure.args.p_error, /customer@example\.com|super-secret|abc123/);
  assert.match(failure.args.p_error, /\[redacted-email\]|\[redacted\]/);
});

test("migration is standalone, private-by-default, and binds exact delivery evidence", () => {
  const lower = sql.toLowerCase();
  for (const token of [
    "designpro_private.wrapbox_delivery_recipients",
    "public.designpro_wrapbox_packs",
    "designpro_private.wrapbox_notification_outbox",
    "register_designpro_wrapbox_recipient",
    "commit_designpro_wrapbox_pack",
    "claim_designpro_wrapbox_notification",
    "for update skip locked",
    "recipient_identity_hash",
    "customer_auth_user_id",
    "email_confirmed_at is not null",
    "p_observed_logo_inventory",
    "targetsurfacekey",
    "delivery_receipt_hash = manifest_content_hash",
    "designpro_customer_read_wrapbox_delivery",
  ]) assert.ok(lower.includes(token), `missing migration contract: ${token}`);
  assert.match(lower, /grant select on public\.designpro_wrapbox_packs to authenticated/);
  assert.match(lower, /revoke all on designpro_private\.wrapbox_notification_outbox[\s\S]*?from public, anon, authenticated, service_role/);
  assert.doesNotMatch(lower, /customer_id\s+is\s+distinct\s+from\s+v_run\.owner_id/);
  assert.doesNotMatch(lower, /https?:\/\//, "migration must not bind an external application or provider URL");
});
