import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { STAGES, RECEIPTS, _test } = require("../../runtime/designpro-standalone-claimant.cjs");

const ownerId = "12345678-1234-4123-8123-123456789abc";
const revisionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const runId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const tenantKey = `user_${ownerId}`;
const roles = ["driver", "passenger", "hood", "roof", "front", "rear", "hero3d"];
const views = Object.fromEntries(roles.map((role, index) => {
  const contentHash = String(index + 1).padStart(64, "0");
  return [role, { bucket: "wrap-files", storagePath: `users/${ownerId}/revisions/${revisionId}/inputs/${role}/${contentHash}.png`, contentHash, byteSize: index + 1, contentType: "image/png" }];
}));

test("seven distinct views automatically precede flat proof, panels and logos", () => {
  assert.deepEqual(STAGES.slice(0, 7), ["revision.freeze", "manifest.resolve", "proof.build", "panels.build", "logos.extract", "pack.verify", "pack.activate"]);
  assert.deepEqual(RECEIPTS.slice(0, 4), ["views.seven-source", "call8.flat-proof", "call9.surface-panels", "call10.logo-inventory"]);
  assert.ok(RECEIPTS.includes("final.human-qc"));
  assert.equal(new Set(Object.values(_test.exactSevenViews({ renderAssets: views }, tenantKey, revisionId)).map((asset) => asset.contentHash)).size, 7);
});

test("missing or reused required view refuses the chain", () => {
  const missing = { ...views }; delete missing.roof;
  assert.throws(() => _test.exactSevenViews({ renderAssets: missing }, tenantKey, revisionId), /roof view is missing/);
  const reused = { ...views, passenger: { ...views.driver } };
  assert.throws(() => _test.exactSevenViews({ renderAssets: reused }, tenantKey, revisionId), /distinct paths and byte identities/);
});

test("Call 8 runs the canonical Design Master producer, and the atlas request builder is gone", async () => {
  // The retired model built ONE flat wrap layout per run and had Call 9 cut six
  // panels out of it, so a panel was only ever as correct as that layout's
  // regions. Call 8 now authors the canonical master and renders each side in
  // its own right.
  assert.equal(_test.call8ProofRequest, undefined, "the atlas request builder must not come back");
  const source = await readFile(fileURLToPath(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url)), "utf8");
  assert.match(source, /buildMasterCycle\(/);
  assert.doesNotMatch(source, /flatWrapLayout/);
  assert.doesNotMatch(source, /cutAllPanels/);
});

test("pack activation and periodic reconciliation create production without a browser", async () => {
  const calls = [];
  const sb = { async rpc(name, payload) { calls.push({ name, payload }); return { data: { ok: true }, error: null }; } };
  await _test.ensureAutomaticProduction(sb, runId);
  await _test.reconcileAutomaticProduction(sb);
  assert.deepEqual(calls, [
    { name: "create_designpro_production_workflow", payload: { p_entice_run_id: runId, p_idempotency_key: `auto-production:${runId}`, p_input: { trigger: "designpro.os.auto" } } },
    { name: "reconcile_designpro_automatic_production", payload: undefined },
  ]);
});

test("production archive carries all seven immutable source-view bytes and the deterministic dimension manifest", async () => {
  const bodies = new Map();
  const receipts = roles.map((viewKey, index) => {
    const body = Buffer.from(`source-view-${viewKey}`);
    const contentHash = createHash("sha256").update(body).digest("hex");
    const storagePath = `users/${ownerId}/revisions/${revisionId}/inputs/${viewKey}/${contentHash}.png`;
    bodies.set(storagePath, body);
    return { viewKey, storagePath, contentHash, byteSize: body.length, contentType: "image/png" };
  });
  const sb = { storage: { from(bucket) {
    assert.equal(bucket, "wrap-files");
    return { async download(path) { return { data: new Blob([bodies.get(path)]), error: null }; } };
  } } };
  const entries = _test.sourceViewZipEntries(sb, receipts);
  assert.equal(entries.length, 7);
  assert.deepEqual(entries.map((entry) => entry.name.split("/")[1].split("-")[0]).sort(), [...roles].sort());
  for (const entry of entries) {
    const chunks = [];
    for await (const chunk of entry.open()) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).length, entry.byteSize);
  }
  const manifestBytes = Buffer.from('{"contract":"designpro.genie-dimension-manifest.v1"}');
  const manifestEntry = _test.bufferZipEntry("dimension-manifest/designpro-genie-dimension-manifest.json", manifestBytes);
  const manifestChunks = [];
  for await (const chunk of manifestEntry.open()) manifestChunks.push(chunk);
  assert.deepEqual(Buffer.concat(manifestChunks), manifestBytes);
});

test("visible approval seal binds canonical immutable DesignID and Order #, never a run UUID", () => {
  const generationId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
  assert.equal(_test.canonicalDesignId(generationId), "DID-EEEEEEEE");
  const run = { id: runId, revision_snapshot_hash: "c".repeat(64), owner_id: ownerId, tenant_key: tenantKey };
  const source = {
    generation_id: generationId, snapshot_hash: run.revision_snapshot_hash,
    owner_id: ownerId, tenant_key: tenantKey,
    snapshot: { generationId, designId: "DID-EEEEEEEE", orderNumber: "ORD-2026-0042", delivery: { orderNumber: "ORD-2026-0042" } },
  };
  assert.deepEqual(_test.immutableBusinessIdentity(source, run), { designId: "DID-EEEEEEEE", orderNumber: "ORD-2026-0042" });
  const svg = _test.stampSvg("Trish", "DID-EEEEEEEE", "ORD-2026-0042", "2026-08-06").toString("utf8");
  assert.match(svg, /DESIGNPROAI · QUALITY CONTROL/);
  assert.match(svg, /DesignID: DID-EEEEEEEE/);
  assert.match(svg, /Order #: ORD-2026-0042/);
  assert.match(svg, /Quality Checked by Trish/);
  assert.match(svg, /<circle[^>]+fill="none"/);
  assert.doesNotMatch(svg, new RegExp(runId, "i"));
  assert.throws(() => _test.immutableBusinessIdentity({ ...source, snapshot: { ...source.snapshot, designId: `DID-${runId.slice(0, 8).toUpperCase()}` } }, run), /immutable revision/i);
  assert.throws(() => _test.immutableBusinessIdentity({ ...source, snapshot: { ...source.snapshot, delivery: { orderNumber: "DIFFERENT-ORDER" } } }, run), /immutable revision/i);
});

test("a copied Call 9 panel larger than 6 MiB uses exact server-side Storage copy, not standard upload", async () => {
  const body = Buffer.alloc(6 * 1024 * 1024 + 73, 0x31);
  const contentHash = createHash("sha256").update(body).digest("hex");
  const sourcePath = `designpro/${tenantKey}/cccccccc-cccc-4ccc-8ccc-cccccccccccc/panels/driver.png`;
  const objects = new Map([[sourcePath, body]]);
  const calls = [];
  const sb = { storage: { from(bucket) {
    assert.equal(bucket, "wrap-files");
    return {
      async copy(from, to) { calls.push({ operation: "copy", from, to }); objects.set(to, objects.get(from)); return { error: null }; },
      download(path) { return { asStream: async () => ({ data: (async function* () { yield objects.get(path); }()), error: null }) }; },
      async upload() { calls.push({ operation: "upload" }); throw new Error("standard upload must not be used"); },
    };
  } } };
  const run = { id: runId, tenant_key: tenantKey, results: { sourceEnticeRunId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } };
  const copied = await _test.copyPinnedSourceArtifact(sb, run, { storage_path: sourcePath, content_hash: contentHash, byte_size: body.length, surface_key: "driver", metadata: {} }, "panel", "panels/driver.png", "image/png");
  assert.equal(copied.contentHash, contentHash);
  assert.equal(copied.byteSize, body.length);
  assert.equal(calls.filter((call) => call.operation === "copy").length, 1);
  assert.equal(calls.filter((call) => call.operation === "upload").length, 0);
});
