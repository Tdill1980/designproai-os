import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _test: { recordAtlasRefusal } } = require("../runtime/flat-first-atlas.cjs");

const row = {
  requestId: "bbb665ad-53cb-4e6c-919f-9bd338c7dfd0",
  generationId: "5d323c81-0451-4bd6-9cf4-1ae40b2e2835",
  ownerId: "61cc6c1c-554c-440c-8e07-a64469f1f4eb",
  tenantKey: "user_61cc6c1c-554c-440c-8e07-a64469f1f4eb",
  topology: "field",
  attempt: 1,
  code: "flat_atlas_master_output_class_invalid",
  reason: "output class vehicle_depiction (confidence 1): The image contains a side profile of a race car.",
  storagePath: "atlas-call1/a96dea87-492b-49dd-b3d3-a51432358707.jpg",
  sha256: "421F52B7D4EB749E4D738883BA27C4A7D1A354212769D4660D87BD0696841F63",
  byteSize: 11331524,
  contentType: "image/jpeg",
  model: "gemini-3-pro-image",
};

test("a refused candidate is written to the ledger with its verdict and exact Storage identity", async () => {
  const inserted = [];
  const supabase = { from(table) { return { async insert(payload) { inserted.push({ table, payload }); return { error: null }; } }; } };
  assert.equal(await recordAtlasRefusal(supabase, row), true);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0].table, "designpro_atlas_refusals");
  assert.deepEqual(inserted[0].payload, {
    request_id: row.requestId,
    generation_id: row.generationId,
    owner_id: row.ownerId,
    tenant_key: row.tenantKey,
    topology: "field",
    attempt: 1,
    code: row.code,
    reason: row.reason,
    storage_path: row.storagePath,
    sha256: row.sha256.toLowerCase(),
    byte_size: 11331524,
    content_type: "image/jpeg",
    model: "gemini-3-pro-image",
  });
});

test("the ledger never changes an authoring outcome: a missing table, a thrown client and a fake client all return false", async () => {
  const logs = [];
  const logger = (line) => logs.push(line);
  const missingTable = { from() { return { async insert() { return { error: { message: 'relation "designpro_atlas_refusals" does not exist' } }; } }; } };
  assert.equal(await recordAtlasRefusal(missingTable, row, logger), false);
  const throwing = { from() { throw new Error("network down"); } };
  assert.equal(await recordAtlasRefusal(throwing, row, logger), false);
  // The existing runtime harnesses stub `from()` with a query object that has
  // no insert(); the ledger must tolerate that shape without touching them.
  const harness = { from() { return {}; } };
  assert.equal(await recordAtlasRefusal(harness, row, logger), false);
  assert.equal(logs.length, 3);
  for (const line of logs) assert.match(line, /refusal ledger write skipped/);
});

test("a candidate without a Storage identity is not recorded", async () => {
  let inserts = 0;
  const supabase = { from() { return { async insert() { inserts += 1; return { error: null }; } }; } };
  assert.equal(await recordAtlasRefusal(supabase, { ...row, storagePath: "" }), false);
  assert.equal(await recordAtlasRefusal(supabase, { ...row, sha256: "not-a-hash" }), false);
  assert.equal(inserts, 0);
});
