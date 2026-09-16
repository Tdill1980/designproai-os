// A 4.91 GB production pack was built, verified and then not delivered.
//
// Canary 35124251343 (2026-09-16) completed every production stage through
// zip.build -- six Topaz-upscaled masters, eighteen production outputs, seven
// stamped proofs, the QC certificate and the approval seal, 60 files in all --
// and died on `wrapbox.deliver` with `delivery_zip_copy_failed`. Supabase's
// server-side copy() is one request against the whole object; it does not
// survive a multi-gigabyte pack. The same bytes had been UPLOADED minutes
// earlier through the resumable transport, so the transport was never the
// problem: the delivery simply was not using it.
//
// These cases pin the two halves of that repair.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { spoolDeterministicZip64, spoolStoredZip, uploadSpoolWithTus } = require("../../runtime/zip-spool.cjs");

const RUN_ID = "77777777-7777-4777-8777-777777777777";
const TENANT = "user_11111111-1111-4111-8111-111111111111";
const PACK_ID = "22222222-2222-4222-8222-222222222222";
const DELIVERY_TARGET = `wrapbox/${TENANT}/${PACK_ID}/${RUN_ID}/production-pack.zip`;
const SOURCE_PATH = `designpro/${TENANT}/${RUN_ID}/production-pack.zip`;
const PACK_BYTES = Buffer.from("PK-production-pack-bytes");
const PACK_HASH = createHash("sha256").update(PACK_BYTES).digest("hex");

async function* chunked(bytes) {
  for (let offset = 0; offset < bytes.length; offset += 7) {
    await new Promise((resolve) => setImmediate(resolve));
    yield bytes.subarray(offset, offset + 7);
  }
}

function storageFixture(objects = new Map()) {
  return {
    objects,
    supabase: {
      storage: {
        from(bucket) {
          assert.equal(bucket, "wrap-files");
          return {
            download(path) {
              return {
                asStream: async () => objects.has(path)
                  ? { data: chunked(objects.get(path)), error: null }
                  : { data: null, error: { status: 404, message: "not found" } },
              };
            },
          };
        },
      },
    },
  };
}

function fakeUploadClass(fixture, uploads) {
  return class FakeUpload {
    constructor(input, options) { this.input = input; this.options = options; uploads.push(this); }
    async findPreviousUploads() { return []; }
    start() {
      void (async () => {
        const chunks = [];
        for await (const chunk of this.input) chunks.push(Buffer.from(chunk));
        fixture.objects.set(this.options.metadata.objectName, Buffer.concat(chunks));
        this.options.onSuccess();
      })().catch((error) => this.options.onError(error));
    }
    async abort() {}
  };
}

test("a verified stored pack re-streams into the spool at its exact recorded identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-delivery-spool-"));
  try {
    const fixture = storageFixture(new Map([[SOURCE_PATH, PACK_BYTES]]));
    const spool = await spoolStoredZip({
      supabase: fixture.supabase, storagePath: SOURCE_PATH, spoolDir: root,
      runId: RUN_ID, contentHash: PACK_HASH, byteSize: PACK_BYTES.length,
    });
    assert.equal(spool.contentHash, PACK_HASH);
    assert.equal(spool.byteSize, PACK_BYTES.length);
    // Second call reuses the material-addressed winner rather than re-reading
    // gigabytes out of Storage.
    const again = await spoolStoredZip({
      supabase: { storage: { from() { throw new Error("an existing spool winner must not be re-downloaded"); } } },
      storagePath: SOURCE_PATH, spoolDir: root, runId: RUN_ID, contentHash: PACK_HASH, byteSize: PACK_BYTES.length,
    });
    assert.equal(again.filePath, spool.filePath);
    assert.equal(again.idempotent, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// The delivery copies bytes; it never authors them. If what comes back off the
// source path is not what zip.build recorded, delivering it would put unproven
// bytes in front of the customer under an approved DesignID.
test("re-streaming refuses bytes that do not hash to the verified pack identity", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-delivery-drift-"));
  try {
    const fixture = storageFixture(new Map([[SOURCE_PATH, Buffer.from("different-bytes-entirely")]]));
    await assert.rejects(spoolStoredZip({
      supabase: fixture.supabase, storagePath: SOURCE_PATH, spoolDir: root,
      runId: RUN_ID, contentHash: PACK_HASH, byteSize: PACK_BYTES.length,
    }), (error) => error.code === "zip_spool_content_drift");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a missing source object fails as a read, not as a silent empty delivery", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-delivery-missing-"));
  try {
    const fixture = storageFixture();
    await assert.rejects(spoolStoredZip({
      supabase: fixture.supabase, storagePath: SOURCE_PATH, spoolDir: root,
      runId: RUN_ID, contentHash: PACK_HASH, byteSize: PACK_BYTES.length,
    }), (error) => error.code === "zip_storage_read_failed" || error.code === "zip_spool_write_failed");
  } finally { await rm(root, { recursive: true, force: true }); }
});

// THIS CASE FAILS AGAINST THE PRE-FIX ALLOWLIST. Before the repair the TUS
// path regex admitted only `designpro/...` and the two template shapes, so a
// delivery routed through the resumable transport died on
// `tus_storage_path_invalid` -- the transport was reachable and refused.
test("the WrapBox delivery ZIP is an admitted resumable target", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-delivery-tus-"));
  try {
    const spool = await spoolDeterministicZip64({
      spoolDir: root, runId: RUN_ID, materialHash: PACK_HASH, createStream: () => chunked(PACK_BYTES),
    });
    const fixture = storageFixture();
    const uploads = [];
    const stored = await uploadSpoolWithTus({
      supabase: fixture.supabase, supabaseUrl: "https://wozyamlnygaddievzuwn.supabase.co",
      serviceRoleKey: "s".repeat(40), spoolDir: root, spool, storagePath: DELIVERY_TARGET,
      contentType: "application/zip", Upload: fakeUploadClass(fixture, uploads), FileUrlStorage: class {},
    });
    assert.equal(stored.storagePath, DELIVERY_TARGET);
    assert.equal(stored.contentHash, PACK_HASH);
    assert.equal(stored.byteSize, PACK_BYTES.length);
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].options.headers["x-upsert"], "false");
    assert.equal(uploads[0].options.metadata.objectName, DELIVERY_TARGET);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// The delivery folder is admitted for exactly one filename. The manifest is
// small and goes through the standard upload; opening the whole prefix would
// make the resumable transport a general writer into customer-visible space.
test("the delivery allowlist admits the pack alone, not its whole folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "designpro-delivery-scope-"));
  try {
    const spool = await spoolDeterministicZip64({
      spoolDir: root, runId: RUN_ID, materialHash: PACK_HASH, createStream: () => chunked(PACK_BYTES),
    });
    const fixture = storageFixture();
    for (const rejected of [
      `wrapbox/${TENANT}/${PACK_ID}/${RUN_ID}/anything-else.zip`,
      `wrapbox/${TENANT}/${PACK_ID}/production-pack.zip`,
      `wrapbox/${TENANT}/${PACK_ID}/${RUN_ID}/nested/production-pack.zip`,
    ]) {
      await assert.rejects(uploadSpoolWithTus({
        supabase: fixture.supabase, supabaseUrl: "https://wozyamlnygaddievzuwn.supabase.co",
        serviceRoleKey: "s".repeat(40), spoolDir: root, spool, storagePath: rejected,
        contentType: "application/zip", Upload: class { constructor() { throw new Error("must not upload"); } }, FileUrlStorage: class {},
      }), (error) => error.code === "tus_storage_path_invalid", rejected);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
