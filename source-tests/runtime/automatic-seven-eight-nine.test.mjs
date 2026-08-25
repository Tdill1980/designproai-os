import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
const roles = ["driver", "passenger", "hood", "front", "rear", "closeup", "roof"];
const views = Object.fromEntries(roles.map((role, index) => {
  const contentHash = String(index + 1).padStart(64, "0");
  return [role, { bucket: "wrap-files", storagePath: `users/${ownerId}/revisions/${revisionId}/inputs/${role}/${contentHash}.png`, contentHash, byteSize: index + 1, contentType: "image/png" }];
}));
const historicalHero = {
  ...views.closeup,
  storagePath: views.closeup.storagePath.replace("/closeup/", "/hero3d/"),
};
const historicalViews = { ...views, hero3d: historicalHero };
delete historicalViews.closeup;

test("seven distinct views automatically precede flat proof, panels and logos", () => {
  // Call 11 (panels.delogo) sits between Call 10 and pack.verify so its
  // de-logoed duplicates exist before the pack is sealed and handed to the
  // PanelPro preflight gate.
  // GENIE is NOT here. manifest.resolve deploys only when the production pack is
  // ordered; the free half needs no validated production geometry, because Call
  // 1 resolved the design-time size of every side and cut the six panels to it.
  assert.deepEqual(STAGES.slice(0, 7), ["revision.freeze", "proof.build", "panels.build", "logos.extract", "panels.delogo", "pack.verify", "pack.activate"]);
  assert.equal(STAGES[7], "await_purchase", "the purchase gate leads the paid half");
  assert.equal(STAGES[8], "manifest.resolve", "GENIE deploys on order, behind the gate");
  assert.ok(
    STAGES.indexOf("manifest.resolve") > STAGES.indexOf("await_purchase"),
    "GENIE must never run before the pack is ordered",
  );
  assert.ok(
    STAGES.indexOf("manifest.resolve") < STAGES.indexOf("source.verify"),
    "every paid stage is cut and verified against the dimensions GENIE produces",
  );
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

test("revision freeze accepts exactly one Close-Up or historical Hero identity", () => {
  const resolvedCloseup = _test.exactSevenViews({ renderAssets: views }, tenantKey, revisionId);
  assert.deepEqual(Object.keys(resolvedCloseup), ["driver", "passenger", "hood", "roof", "front", "rear", "closeup"]);
  assert.equal("hero3d" in resolvedCloseup, false);

  const resolvedHistorical = _test.exactSevenViews({ renderAssets: historicalViews }, tenantKey, revisionId);
  assert.equal(Object.hasOwn(resolvedHistorical, "hero3d"), true);
  assert.equal(Object.hasOwn(resolvedHistorical, "closeup"), false);

  assert.throws(
    () => _test.exactSevenViews({ renderAssets: { ...views, hero3d: historicalHero } }, tenantKey, revisionId),
    /Exactly one Close-Up or immutable historical Hero proof/,
  );
  const neither = { ...views };
  delete neither.closeup;
  assert.throws(
    () => _test.exactSevenViews({ renderAssets: neither }, tenantKey, revisionId),
    /Exactly one Close-Up or immutable historical Hero proof/,
  );
});

test("Call 8 composes the proof from seven views and Call 9 gridslices six own-surface fields", async () => {
  assert.equal(typeof _test.call8ProofRequest, "function");
  const source = await readFile(fileURLToPath(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url)), "utf8");
  assert.match(source, /"\/compose-proof-sheet"/);
  assert.match(source, /gridSliceAll\(fieldSources, manifest\.expectedSurfaces/);
  assert.match(source, /sourceFieldHashes/);
  assert.doesNotMatch(source, /buildMasterCycle\(/);
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
    snapshot: {
      generationId, designId: "DID-EEEEEEEE", orderNumber: "ORD-2026-0042",
      delivery: {
        contractVersion: "designpro.wrapbox-recipient.v1",
        customerId: "ffffffff-ffff-4fff-8fff-ffffffffffff",
        customerEmail: "customer@example.test",
        recipientIdentityHash: "d".repeat(64),
        orderNumber: "ORD-2026-0042",
        designName: "Exact Design",
      },
    },
  };
  assert.deepEqual(_test.immutableBusinessIdentity(source, run), { designId: "DID-EEEEEEEE", orderNumber: "ORD-2026-0042" });
  const svg = _test.stampSvg("Trish", "DID-EEEEEEEE", "ORD-2026-0042", "2026-08-06").toString("utf8");
  // The ring caption is drawn as individually rotated glyphs, so the contiguous
  // string no longer appears in the markup. Asserting the string was exactly the
  // check that let the real defect through: it was a <textPath>, which librsvg
  // does not implement, so the caption matched here and rendered ZERO pixels on
  // every seal this server ever stamped. Assert the mechanism instead.
  assert.doesNotMatch(svg, /<textPath/, "librsvg renders no textPath -- the caption must not depend on one");
  // Both arcs, glyph by glyph: DesignProAI over the top and QUALITY APPROVAL
  // CHECK under the bottom. The property is that each glyph is its own rotated
  // <text>, because librsvg renders no <textPath> -- assert it on the wording
  // the seal actually carries rather than on a fixed alphabet.
  for (const glyph of ["D", "e", "s", "i", "g", "n", "P", "r", "o", "A", "I", "Q", "U", "L", "T", "Y", "V", "C", "H", "E", "K"]) {
    assert.match(svg, new RegExp(`<text[^>]*transform="rotate\\([^"]*"[^>]*>${glyph}</text>`),
      `ring caption is missing the glyph ${glyph}`);
  }
  assert.match(svg, /DID-EEEEEEEE/);
  assert.match(svg, /Order #ORD-2026-0042/);
  assert.match(svg, /Approved by Trish/);
  assert.match(svg, /<circle[^>]+fill="none"/);
  assert.doesNotMatch(svg, new RegExp(runId, "i"));
  assert.throws(() => _test.immutableBusinessIdentity({ ...source, snapshot: { ...source.snapshot, designId: `DID-${runId.slice(0, 8).toUpperCase()}` } }, run), /immutable revision/i);
  assert.throws(() => _test.immutableBusinessIdentity({ ...source, snapshot: { ...source.snapshot, delivery: { ...source.snapshot.delivery, orderNumber: "DIFFERENT-ORDER" } } }, run), /immutable revision/i);
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

/**
 * PANELPRO STUDIO IS SERVED THE PANELS CALL 1 CUT.
 *
 * The six panels RevisionStudio entices the buyer with are the ones A.T.L.A.S.
 * cut from the canonical master at Call 1. Call 9 PROMOTES those exact bytes; it
 * does not re-derive them, because a board showing different bytes than the
 * customer was shown is the failure this chain exists to prevent.
 *
 * They cross the seam on the immutable revision snapshot -- the interface
 * manufacturing is allowed to read -- never by reaching into the generation
 * tables, which standalone-claimant-contract.test.mjs pins.
 */
test("Call 9 promotes the Call-1 panels rather than re-cutting them", () => {
  const source = readFileSync(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");

  assert.match(source, /promotedFrom: "atlas-call1"/);
  assert.match(source, /source: "atlas-call1-panel"/);
  // Read from the snapshot, and only from a snapshot that still matches the run.
  const helper = source.slice(source.indexOf("async function callOnePanelSet"), source.indexOf("async function storageBytes"));
  assert.match(helper, /from\("designpro_revision_sources"\)/);
  assert.match(helper, /snapshot\?\.callOnePanels/);
  assert.match(helper, /call9_revision_source_drift/);
  assert.doesNotMatch(
    source,
    /designpro_flat_atlas_revisions/,
    "manufacturing must not reach into the generation tables for these panels",
  );
  // The promoted bytes are verified against their recorded identity, and six
  // distinct surfaces are still required.
  assert.match(source, /call9_call1_panel_changed/);
  assert.match(source, /call9_call1_panel_surface_missing/);
  assert.match(source, /call9_panel_identity_collision/);
  // A run with no atlas still reaches the existing gridslice path.
  assert.ok(
    source.indexOf('promotedFrom: "atlas-call1"') < source.indexOf('requiredObject(run.results?.dimensionManifest'),
    "the Call-1 promotion is tried before the GENIE-dimensioned gridslice fallback",
  );
});
