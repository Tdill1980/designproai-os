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
  // THE EXTRACTION BRANCH RUNS AHEAD OF THE 2D PROOF (owner 2026-08-27).
  // `panels.build` promotes bytes Call 1 already cut and hashed -- no AI at all
  // -- and it used to sit behind `proof.build`, an AI proof-sheet render,
  // because `claim_designpro_stage` gates on every lower sequence completing and
  // the claimant is single-flight. Every panel and logo in PanelPro waited on a
  // documentation artifact. Call 8 now runs where its receipt is first needed.
  assert.deepEqual(STAGES.slice(0, 7), ["revision.freeze", "panels.build", "logos.extract", "panels.delogo", "proof.build", "pack.verify", "pack.activate"]);
  // The dependencies that are REAL, asserted as relations rather than positions
  // so a future reorder has to keep meaning them.
  assert.ok(STAGES.indexOf("panels.build") > STAGES.indexOf("revision.freeze"));
  assert.ok(STAGES.indexOf("logos.extract") > STAGES.indexOf("panels.build"),
    "Call 10 separates logos from the Call 9 panels");
  assert.ok(STAGES.indexOf("panels.delogo") > STAGES.indexOf("logos.extract"));
  assert.ok(STAGES.indexOf("proof.build") > STAGES.indexOf("revision.freeze"),
    "Call 8 is drawn from the frozen revision");
  assert.ok(STAGES.indexOf("proof.build") < STAGES.indexOf("pack.verify"),
    "pack.verify is the first stage that reads the Call 8 receipt");
  assert.ok(STAGES.indexOf("panels.build") < STAGES.indexOf("proof.build"),
    "no panel or logo may wait on the 2D proof");
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
  // A deferred Call 8 is its OWN receipt kind and never "call8.flat-proof", so
  // no later reader can mistake a recorded failure for a proof that was built.
  assert.deepEqual(RECEIPTS.slice(0, 5), [
    "views.seven-source", "call8.flat-proof", "call8.flat-proof-deferred",
    "call9.surface-panels", "call10.logo-inventory",
  ]);
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

test("a refused proof is described, not thrown -- the panels it never touched still publish", () => {
  // THE SIXTH ALL-OR-NOTHING SEVEN, and the most expensive of them.
  //
  // `revision.freeze` is the FIRST stage of the entice run and it threw
  // `seven_views_incomplete` NON-RETRYABLY, so one refused proof killed the
  // workflow before it began -- and with it the six A.T.L.A.S. panels Call 1
  // had already cut, hashed and written to storage, and the whole Logo Pack.
  // Owner: "A failed Hood 3D proof cannot prevent the Hood production panel
  // from existing."
  //
  // `revisionViewSet` DESCRIBES the shortfall so the caller decides; the strict
  // `exactSevenViews` still raises, byte for byte, what it always raised.
  const short = { ...views };
  delete short.roof;
  const set = _test.revisionViewSet({ renderAssets: short }, tenantKey, revisionId);

  assert.equal(set.complete, false);
  assert.deepEqual(set.missingRoles, ["roof"]);
  assert.deepEqual(set.presentRoles, ["closeup", "driver", "front", "hood", "passenger", "rear"]);
  assert.equal(set.presentRoles.length, 6, "every view that DID land is resolved and returned");
  assert.ok(!("roof" in set.views), "a refused view is absent, never substituted");
  // The strict form is unchanged for anyone who still requires seven.
  assert.equal(set.shortfall.code, "seven_views_incomplete");
  assert.equal(set.shortfall.retryable, false);
  assert.throws(() => _test.exactSevenViews({ renderAssets: short }, tenantKey, revisionId), /roof view is missing/);

  // A COMPLETE SET IS UNAFFECTED IN EVERY OBSERVABLE WAY.
  const whole = _test.revisionViewSet({ renderAssets: views }, tenantKey, revisionId);
  assert.equal(whole.complete, true);
  assert.equal(whole.shortfall, null);
  assert.deepEqual(whole.missingRoles, []);
  assert.deepEqual(whole.views, _test.exactSevenViews({ renderAssets: views }, tenantKey, revisionId));

  // DISTINCTNESS IS NEVER RELAXED. It is what makes an implicit passenger
  // mirror impossible (RULE 0.5), and a short set is not a licence to reuse a
  // byte identity -- so it convicts over WHATEVER landed, not only over seven.
  const shortAndReused = { ...short, passenger: { ...short.driver } };
  assert.throws(
    () => _test.revisionViewSet({ renderAssets: shortAndReused }, tenantKey, revisionId),
    /distinct paths and byte identities/,
  );

  // TWO SEVENTH VIEWS IS A MALFORMED SNAPSHOT, NOT A SHORT SET -- the Close-Up
  // and the historical Hero share one slot, so two of them means the snapshot
  // cannot say which proof that slot holds. Still fatal for every caller.
  assert.throws(
    () => _test.revisionViewSet({ renderAssets: { ...views, hero3d: historicalHero } }, tenantKey, revisionId),
    /Exactly one Close-Up or immutable historical Hero proof/,
  );
});

test("the freeze and the pack report the view count they actually had", async () => {
  const source = await readFile(fileURLToPath(new URL("../../runtime/designpro-standalone-claimant.cjs", import.meta.url)), "utf8");

  // A short set is admitted ONLY when A.T.L.A.S. panels exist. On a Standard
  // run the views genuinely are what Call 9 cuts from, so a missing one still
  // means there is nothing to manufacture for that surface.
  assert.match(source, /const atlasPanels = viewSet\.complete \? null : await callOnePanelSet\(sb, run\)\.catch\(\(\) => null\);/);
  assert.match(source, /if \(!viewSet\.complete && !atlasPanels\) throw viewSet\.shortfall;/);

  // AND THE RECEIPT MUST NOT CLAIM SEVEN. `pack.verify` wrote
  // `sevenViewsVerified: true` as a literal, so a pack assembled over a short
  // set asserted seven views it never had -- straight into the pack's own
  // immutable identity.
  // Comment lines are excluded deliberately: the comments in the runtime QUOTE
  // the literal they replaced, and a naive scan convicts the explanation.
  const codeLines = source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line));
  assert.deepEqual(
    codeLines.filter((line) => line.includes("sevenViewsVerified: true")), [],
    "no executable line may hardcode the seven-view claim -- it is read from what actually froze",
  );
  assert.match(source, /sevenViewsVerified: !shortViewSet/);
  assert.match(source, /const shortViewSet = views\.receipt\?\.sevenViewsVerified === false;/);
  assert.match(source, /missingViewRoles: viewSet\.missingRoles/);

  // GENIE resolves dimensions from the measured vehicle row, so it never needed
  // seven proofs -- and requiring them there would have killed a run the
  // customer had already PAID for, at manifest.resolve.
  assert.match(source, /const viewSet = revisionViewSet\(source\.snapshot, run\.tenant_key, run\.revision_id\);/);
  assert.match(source, /sevenViewsVerified: viewSet\.complete/,
    "the GENIE manifest asserted seven views too, and now resolves without them");
  assert.doesNotMatch(source, /= exactSevenViews\(source\.snapshot/);
  assert.doesNotMatch(source, /= exactSevenViews\(data\.snapshot/);
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
