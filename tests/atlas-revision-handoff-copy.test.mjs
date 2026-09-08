import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { completeGenerationWithSources } = require("../runtime/generation-worker.cjs");

const ownerId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const views = ["driver", "passenger", "hood", "roof", "front", "rear", "closeup"].map((consumerRole, index) => {
  const bytes = Buffer.from(`accepted-${consumerRole}-proof-bytes`);
  return { consumerRole, contentHash: sha(bytes), byteSize: bytes.length,
    contentType: ["image/png", "image/jpeg", "image/webp"][index % 3],
    storagePath: `designpro/user_${ownerId}/generation/accepted/${consumerRole}.png` };
});
const destination = view => `users/${ownerId}/revisions/${revisionId}/inputs/${view.consumerRole}/${view.contentHash}.${extensions[view.contentType]}`;

function harness() {
  const files = new Map(views.map(view => [view.storagePath, Buffer.from(`accepted-${view.consumerRole}-proof-bytes`)]));
  const events = [];
  let failRole = null, failRead = false, completions = 0;
  const bucket = {
    async copy(source, target) {
      events.push(`copy:${target}`);
      if (target.includes(`/inputs/${failRole}/`)) throw new Error("temporary storage interruption");
      if (files.has(target)) return { error: { statusCode: "409", message: "The resource already exists" } };
      files.set(target, Buffer.from(files.get(source)));
      return { error: null };
    },
    async download(target) {
      events.push(`verify:${target}`);
      return failRead ? { data: null, error: { statusCode: "503" } } : { data: new Blob([files.get(target)]), error: null };
    },
  };
  const completionArgs = { p_request_id: "33333333-3333-4333-8333-333333333333", p_claim_token: "44444444-4444-4444-8444-444444444444",
    p_views: views, p_engine_receipt: { handoffRevisionId: revisionId } };
  const supabase = { storage: { from(name) { assert.equal(name, "wrap-files"); return bucket; } },
    async rpc(name, args) {
      assert.equal(name, "complete_designpro_generation_request");
      assert.equal(args, completionArgs);
      for (const view of views) {
        assert.deepEqual(files.get(destination(view)), files.get(view.storagePath), "all SQL handoff paths must already contain their exact accepted proof bytes");
      }
      completions++;
      events.push("outputs_ready");
      return { data: { handoffReady: true }, error: null };
    } };
  return { files, events,
    run: () => completeGenerationWithSources({ supabase, ownerId, revisionId, views, completionArgs }),
    get completions() { return completions; },
    set failRole(value) { failRole = value; }, set failRead(value) { failRead = value; } };
}

test("seven exact role/hash/MIME input paths exist before outputs_ready can start the handoff", async () => {
  const h = harness();
  assert.deepEqual(await h.run(), { handoffReady: true });
  assert.equal(h.completions, 1);
  assert.equal(h.events.at(-1), "outputs_ready");
  assert.equal(h.events.filter(event => event.startsWith("copy:")).length, 7);
  for (const view of views) assert.equal(sha(h.files.get(destination(view))), view.contentHash);
});

test("interrupted copies remain recoverable and verify existing destinations before publishing", async () => {
  const h = harness(); h.failRole = "hood";
  await assert.rejects(h.run(), error => error.code === "handoff_copy_failed" && error.retryable === true);
  assert.equal(h.completions, 0, "a failed copy must not leave the request outputs_ready and unclaimable");
  h.failRole = null;
  await h.run();
  assert.equal(h.completions, 1);
  for (const view of views.slice(0, 2)) assert.ok(h.events.includes(`verify:${destination(view)}`));
  assert.equal(h.events.at(-1), "outputs_ready");
});

test("an existing input with incorrect bytes is not accepted as an idempotent copy", async () => {
  const h = harness();
  const wrong = Buffer.alloc(views[0].byteSize, 7);
  h.files.set(destination(views[0]), wrong);
  await assert.rejects(h.run(), error => error.code === "handoff_copy_hash_mismatch" && error.retryable === false);
  assert.equal(h.completions, 0);
  assert.deepEqual(h.files.get(destination(views[0])), wrong, "the conflicting destination cannot be overwritten");
});

test("an unavailable duplicate readback cannot be reported as verified completion", async () => {
  const h = harness(); h.files.set(destination(views[0]), h.files.get(views[0].storagePath)); h.failRead = true;
  await assert.rejects(h.run(), error => error.code === "handoff_copy_readback_failed" && error.retryable === true);
  assert.equal(h.completions, 0);
});
