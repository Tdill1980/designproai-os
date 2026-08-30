import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { createGenerationStore } = require("../runtime/generation-store.cjs");

const bytes = Buffer.from("verified atlas driver proof");
const contentHash = createHash("sha256").update(bytes).digest("hex");
const sourceStoragePath = "atlas-proof/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa_side.png";
const storagePath = `designpro/user_11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/calls-1-7/side/${contentHash}.png`;

function storageFixture() {
  const calls = { copy: [], upload: [], remove: [] };
  const bucket = {
    copy: async (from, to) => {
      calls.copy.push({ from, to });
      return { data: { path: to }, error: null };
    },
    upload: async (path) => {
      calls.upload.push(path);
      return { data: { path }, error: null };
    },
    download: async () => ({ data: new Blob([bytes]), error: null }),
    remove: async (paths) => {
      calls.remove.push(paths);
      return { data: paths, error: null };
    },
  };
  const supabase = { storage: { from: () => bucket } };
  return { calls, store: createGenerationStore({ supabase, workerId: "test-worker" }) };
}

test("an accepted A.T.L.A.S. proof is promoted inside Storage instead of uploaded twice", async () => {
  const { calls, store } = storageFixture();
  const result = await store.putImmutableBytes({
    storagePath,
    bytes,
    contentType: "image/png",
    sourceStoragePath,
    sourceContentHash: contentHash,
  });
  assert.deepEqual(calls.copy, [{ from: sourceStoragePath, to: storagePath }]);
  assert.deepEqual(calls.upload, []);
  assert.equal(result.contentHash, contentHash);
  assert.equal(result.byteSize, bytes.length);
});

test("a staging identity mismatch fails closed before copy or upload", async () => {
  const { calls, store } = storageFixture();
  await assert.rejects(
    () => store.putImmutableBytes({
      storagePath,
      bytes,
      contentType: "image/png",
      sourceStoragePath,
      sourceContentHash: "0".repeat(64),
    }),
    /staged proof identity does not match/,
  );
  assert.deepEqual(calls.copy, []);
  assert.deepEqual(calls.upload, []);
});

test("Standard proofs keep the create-only upload path", async () => {
  const { calls, store } = storageFixture();
  await store.putImmutableBytes({ storagePath, bytes, contentType: "image/png" });
  assert.deepEqual(calls.copy, []);
  assert.deepEqual(calls.upload, [storagePath]);
});

test("staging cleanup is bounded to photographer paths", async () => {
  const { calls, store } = storageFixture();
  assert.equal(await store.removeStagedBytes({ storagePath: sourceStoragePath }), true);
  assert.equal(await store.removeStagedBytes({ storagePath }), false);
  assert.deepEqual(calls.remove, [[sourceStoragePath]]);
});
