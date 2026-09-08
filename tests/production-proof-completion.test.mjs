import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const { _test: worker, renderStampedProof, stampSvg } = require("../runtime/designpro-standalone-claimant.cjs");
const { renderProofSheet, _test: proof } = require("../runtime/proof-sheet.cjs");
const { call8ProofMaterialHash, normalizeCallOnePanelSet } = require("../runtime/call8-proof-material.cjs");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined).map((key) => [key, canonical(value[key])])) : value;
const hashJson = (value) => hash(JSON.stringify(canonical(value)));
const keys = ["driver", "passenger", "hood", "roof", "front", "rear"];
const viewKeys = [...keys, "closeup"];
const tenant = "user_b940320d-cb5a-4b60-b280-32d12ef4d6a6";
const revisionId = "8499ab58-0c00-40c3-a3c5-9fe2b73cb236";
const generationId = "083d2a70-edac-4e75-9caa-1336542baf7c";
const runId = "f041f306-f4da-4283-8b37-ea07a4bc50a9";
const surfaces = keys.map((surfaceKey, i) => ({ surfaceKey, widthInches: i === 2 ? 64 : 150 + i, heightInches: i === 2 ? 53 : 50 + i }));

async function panelFixture() {
  const panels = {}; const assets = [];
  for (const [index, surface] of surfaces.entries()) {
    const bytes = await sharp({ create: {
      width: (surface.widthInches + 10) * 4, height: (surface.heightInches + 10) * 4,
      channels: 3, background: { r: 20 + index * 25, g: 110, b: 180 },
    } }).png().toBuffer();
    panels[surface.surfaceKey] = bytes;
    const contentHash = hash(bytes);
    assets.push({ surfaceKey: surface.surfaceKey, contentHash, byteSize: bytes.length, bucket: "wrap-files", contentType: "image/png",
      storagePath: `designpro/${tenant}/${generationId}/flat-first/v1/revisions/1/panels/${contentHash}.png`,
      sourceMasterHash: "a".repeat(64), trimWidthIn: surface.widthInches, trimHeightIn: surface.heightInches,
      printWidthIn: surface.widthInches + 10, printHeightIn: surface.heightInches + 10 });
  }
  return { panels, assets };
}

function sheetInput(panels) {
  return { panels, surfaces, vehicle: { year: 2026, make: "Test", model: "Measured Fixture" }, designName: "Dimension verification fixture", finish: "gloss", designId: "DID-083D2A70", orderNumber: "TEST-1", proofBinding: "f".repeat(64), masterHash: "a".repeat(64) };
}

test("Call 8 64x53 hood shows 74x63 print, all four five-inch insets and dimension arrows on trim", async () => {
  const { panels } = await panelFixture();
  const before = Object.fromEntries(Object.entries(panels).map(([key, bytes]) => [key, hash(bytes)]));
  const sheet = await renderProofSheet(sheetInput(panels));
  const hood = sheet.tiles.find((tile) => tile.surfaceKey === "hood");
  assert.equal(hood.printWidthIn, 74); assert.equal(hood.printHeightIn, 63);
  for (const tile of sheet.tiles) {
    const { print, trim, bleed } = tile;
    const scaleX = print.w / tile.printWidthIn; const scaleY = print.h / tile.printHeightIn;
    assert.ok(Math.abs((trim.x - print.x) / scaleX - 5) < 1e-8);
    assert.ok(Math.abs((print.x + print.w - trim.x - trim.w) / scaleX - 5) < 1e-8);
    assert.ok(Math.abs((trim.y - print.y) / scaleY - 5) < 1e-8);
    assert.ok(Math.abs((print.y + print.h - trim.y - trim.h) / scaleY - 5) < 1e-8);
    assert.equal(bleed.left, bleed.right); assert.equal(bleed.top, bleed.bottom);
    assert.equal(tile.dimensionRuleBasis, "trim-boundary");
    assert.equal(tile.sourceAspectPreserved, true);
    // The code actually draws the rule at the reported trim endpoints.
    const markup = proof.cellMarkup(sheet.layout.cells[tile.surfaceKey], sheet.surfaces.find((row) => row.surfaceKey === tile.surfaceKey), tile.placement);
    assert.ok(markup.includes(`x1="${trim.x}"`) && markup.includes(`x2="${trim.x + trim.w}"`));
    // A bleed interior remains the same nonessential source colour, not a hole.
    const sample = await sharp(sheet.bytes).extract({ left: Math.round(print.x + bleed.left / 2), top: Math.round(print.y + print.h / 2), width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.deepEqual([...sample], [20 + keys.indexOf(tile.surfaceKey) * 25, 110, 180]);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(panels).map(([key, bytes]) => [key, hash(bytes)])), before);
});

test("Call 8 refuses a transparent cut area, wrong-aspect panel and duplicate or nonfinite dimensions", async () => {
  const { panels } = await panelFixture();
  const original = panels.hood;
  panels.hood = await sharp(original).ensureAlpha().composite([{ input: await sharp({ create: { width: 12, height: 12, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(), left: 40, top: 40, blend: "dest-out" }]).png().toBuffer();
  await assert.rejects(renderProofSheet(sheetInput(panels)), { code: "proof_sheet_panel_has_cutouts" });
  panels.hood = await sharp(original).resize(300, 300, { fit: "fill" }).png().toBuffer();
  await assert.rejects(renderProofSheet(sheetInput(panels)), { code: "proof_sheet_panel_geometry_mismatch" });
  panels.hood = original;
  await assert.rejects(renderProofSheet({ ...sheetInput(panels), surfaces: [...surfaces, surfaces[0]] }), { code: "proof_sheet_surface_invalid" });
  await assert.rejects(renderProofSheet({ ...sheetInput(panels), surfaces: surfaces.map((s, i) => i ? s : { ...s, widthInches: Infinity }) }), { code: "proof_sheet_surface_invalid" });
});

test("Call 8 material preserves master identity and refuses bleed or GENIE relabeling", async () => {
  const { assets } = await panelFixture();
  assert.equal(normalizeCallOnePanelSet(assets, tenant)[0].sourceMasterHash, "a".repeat(64));
  const spec = { panels: assets, surfaces, revisionId, tenantKey: tenant, textLock: { bodyText: {}, logoPlacements: [] } };
  const identity = call8ProofMaterialHash(spec);
  assert.equal(identity, call8ProofMaterialHash({ ...spec, panels: [...assets].reverse() }));
  assert.notEqual(identity, call8ProofMaterialHash({ ...spec, panels: assets.map((a) => ({ ...a, sourceMasterHash: "b".repeat(64) })) }));
  assert.throws(() => call8ProofMaterialHash({ ...spec, panels: assets.map((a, i) => i ? a : { ...a, printWidthIn: a.printWidthIn + 1 }) }), /five inches/);
  assert.throws(() => call8ProofMaterialHash({ ...spec, surfaces: surfaces.map((a, i) => i ? a : { ...a, widthInches: a.widthInches + 1 }) }), /differs.*GENIE/);
  assert.throws(() => call8ProofMaterialHash({ ...spec, panels: assets.map((a, i) => i ? a : { ...a, sourceMasterHash: "b".repeat(64) }) }), /multiple/);
});

test("Call 8 can run before any seven-view proof while its material remains unchanged", async () => {
  const { assets } = await panelFixture();
  const run = { id: runId, tenant_key: tenant, revision_id: revisionId };
  const manifest = { expectedSurfaces: surfaces, totalSqFt: worker.round2(surfaces.reduce((sum, s) => sum + s.widthInches * s.heightInches / 144, 0)) };
  const lock = { bodyText: {}, logoPlacements: [] };
  const early = worker.call8ProofRequest(run, manifest, assets, [], lock, {});
  const complete = worker.call8ProofRequest(run, manifest, assets, viewKeys.map((viewKey) => ({ viewKey })), lock, {});
  assert.equal(early.materialHash, complete.materialHash);
  assert.throws(() => worker.call8ProofRequest(run, manifest, assets, [{ viewKey: "driver" }, { viewKey: "driver" }], lock, {}), { code: "call8_view_lineage_invalid" });
});

async function releaseFixture() {
  const { assets } = await panelFixture();
  const viewBytes = new Map(); const sourceViews = [];
  for (const [index, viewKey] of viewKeys.entries()) {
    const bytes = await sharp({ create: { width: 240, height: 160, channels: 3, background: { r: 20 + index * 20, g: 60, b: 130 } } }).png().toBuffer();
    const contentHash = hash(bytes); const storagePath = `designpro/${tenant}/${generationId}/proofs/${contentHash}.png`;
    viewBytes.set(storagePath, bytes); sourceViews.push({ viewKey, storagePath, contentHash, byteSize: bytes.length, contentType: "image/png" });
  }
  const manifestHash = "e".repeat(64);
  const built = { verified: true, receiptKind: "call8.flat-proof", producer: "designpro.call8-panel-proof.v4", deterministic: true, imageRequestCount: 0, proofPixelsUsed: false, manifestHash, sourceProofHash: "f".repeat(64), surfaceTiles: assets.map((asset) => ({ ...asset, sourcePanelHash: asset.contentHash, dimensionRuleBasis: "trim-boundary", continuousArtwork: true, sourceAspectPreserved: true, bleedInches: { top: 5, right: 5, bottom: 5, left: 5 } })) };
  const call8 = { receiptKind: "call8.flat-proof", receiptHash: hashJson(built), receipt: built };
  const proofRows = [{ artifact_kind: "flat-proof", surface_key: "", storage_path: `designpro/${tenant}/${runId}/source/call8-2d-production-proof.png`, content_hash: built.sourceProofHash, metadata: { sourceReceiptHash: call8.receiptHash, manifestHash } }];
  return { call8, proofRows, sourceViews, manifestHash, viewBytes };
}

test("final QC readiness joins actual Call 8 and seven unique proofs; missing one or deferred proof blocks", async () => {
  const fixture = await releaseFixture();
  const joined = worker.assertProductionProofJoin(fixture);
  assert.equal(joined.sevenViewsVerified, true); assert.equal(joined.sourceViews.length, 7);
  assert.throws(() => worker.assertProductionProofJoin({ ...fixture, sourceViews: fixture.sourceViews.slice(1) }), { code: "zip_source_views_incomplete" });
  assert.throws(() => worker.assertProductionProofJoin({ ...fixture, call8: { ...fixture.call8, receipt: { ...fixture.call8.receipt, deferred: true } } }), { code: "production_call8_release_evidence_invalid" });
  assert.throws(() => worker.assertProductionProofJoin({ ...fixture, proofRows: [] }), { code: "production_call8_release_evidence_invalid" });
  assert.throws(() => worker.assertProductionProofJoin({ ...fixture, manifestHash: "d".repeat(64) }), { code: "production_call8_release_evidence_invalid" });
  const reused = fixture.sourceViews.map((v, i) => i === 1 ? { ...v, contentHash: fixture.sourceViews[0].contentHash } : v);
  assert.throws(() => worker.assertProductionProofJoin({ ...fixture, sourceViews: reused }), { code: "zip_source_view_identity_reused" });
});

test("all seven approved proof stamps are deterministic immutable derivatives and ZIP refuses missing/misbound stamps", async () => {
  const { sourceViews, viewBytes } = await releaseFixture();
  const sealBytes = await sharp(stampSvg("QC Fixture", "DID-083D2A70", "TEST-1", "2026-09-08")).png().toBuffer();
  const stampReceipt = { sealHash: hash(sealBytes), approvalRef: "fixture-approval", approvedAt: "2026-09-08T12:00:00.123456Z", designId: "DID-083D2A70", orderNumber: "TEST-1", stampedViews: [] };
  const rows = [];
  for (const view of sourceViews) {
    const sourceBytes = viewBytes.get(view.storagePath);
    const input = { sourceBytes, sourceHash: view.contentHash, sourceByteSize: view.byteSize, sealBytes };
    const derived = await renderStampedProof(input);
    assert.deepEqual(derived.bytes, (await renderStampedProof(input)).bytes);
    assert.equal(hash(sourceBytes), view.contentHash); assert.notEqual(derived.contentHash, view.contentHash);
    const sourcePixel = await sharp(sourceBytes).extract({ left: 20, top: 20, width: 1, height: 1 }).raw().toBuffer();
    const copiedPixel = await sharp(derived.bytes).extract({ left: 20, top: 20, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
    assert.deepEqual(copiedPixel, sourcePixel);
    const storagePath = `designpro/${tenant}/${runId}/proof/stamped-view-${view.viewKey}-${view.contentHash.slice(0, 24)}.png`;
    rows.push({ artifact_kind: "stamp", surface_key: `stamped-view-${view.viewKey}`, storage_path: storagePath, content_hash: derived.contentHash, byte_size: derived.bytes.length, metadata: { ...stampReceipt, stampedViews: undefined, sourceViewKey: view.viewKey, sourceProofHash: view.contentHash, sourceProofPath: view.storagePath } });
    stampReceipt.stampedViews.push({ viewKey: view.viewKey, storagePath, contentHash: derived.contentHash, byteSize: derived.bytes.length, sourceProofHash: view.contentHash, sourceProofPath: view.storagePath });
  }
  assert.equal(worker.assertStampedViewSet({ sourceViews, rows, stampReceipt }).length, 7);
  assert.throws(() => worker.assertStampedViewSet({ sourceViews, rows: rows.slice(1), stampReceipt }), { code: "zip_stamped_views_incomplete" });
  assert.throws(() => worker.assertStampedViewSet({ sourceViews, rows: rows.map((row, i) => i === 1 ? { ...row, content_hash: rows[0].content_hash } : row), stampReceipt }), { code: "zip_stamped_view_identity_reused" });
  assert.throws(() => worker.assertStampedViewSet({ sourceViews, rows: rows.map((row, i) => i ? row : { ...row, metadata: { ...row.metadata, sourceProofHash: sourceViews[1].contentHash } }), stampReceipt }), { code: "zip_stamped_view_binding_invalid" });
  await assert.rejects(renderStampedProof({ sourceBytes: viewBytes.get(sourceViews[0].storagePath), sourceHash: "0".repeat(64), sourceByteSize: sourceViews[0].byteSize, sealBytes }), { code: "stamp_source_proof_changed" });
});

test("print export refuses transparent installation cutouts and missing pixels instead of adding white or mirrored fill", async () => {
  const bytes = await sharp({ create: { width: 64, height: 32, channels: 3, background: { r: 20, g: 60, b: 100 } } }).png().toBuffer();
  assert.deepEqual(await worker.verifyPrintRasterSource(bytes, 64, 32, "driver"), { width: 64, height: 32, opaque: true, sourcePixelsPreserved: true });
  await assert.rejects(worker.verifyPrintRasterSource(bytes, 66, 32, "driver"), { code: "output_source_geometry_mismatch" });
  const transparent = await sharp({ create: { width: 64, height: 32, channels: 4, background: { r: 20, g: 60, b: 100, alpha: 0.8 } } }).png().toBuffer();
  await assert.rejects(worker.verifyPrintRasterSource(transparent, 64, 32, "driver"), { code: "output_source_cutouts" });
});

const flatAtlas = require("../runtime/flat-first-atlas.cjs");
const photographer = require("../runtime/designpanel-server-provider.cjs");
const proofQc = require("../runtime/atlas-proof-qc.cjs");
const viewPlan = require("../runtime/designpro-standalone-claimant.cjs").CALLS_1_7_ADAPTER.viewPlan;

function memoryDb({ tables = {}, bytes = new Map() } = {}) {
  const calls = []; const reads = [];
  const sb = {
    tables, calls, reads, bytes,
    from(table) {
      const filters = []; let maximum = Infinity;
      const query = {
        select() { return query; },
        eq(key, value) { filters.push((row) => row[key] === value); return query; },
        is(key, value) { filters.push((row) => value === null ? row[key] == null : row[key] === value); return query; },
        in(key, values) { filters.push((row) => values.includes(row[key])); return query; },
        limit(value) { maximum = value; return query; },
        result(single) {
          reads.push(table);
          const rows = (tables[table] || []).filter((row) => filters.every((accept) => accept(row))).slice(0, maximum);
          return { data: single ? rows[0] || null : rows, error: null };
        },
        async maybeSingle() { return query.result(true); },
        then(resolve, reject) { return Promise.resolve(query.result(false)).then(resolve, reject); },
      };
      return query;
    },
    storage: { from() { return {
      async download(path) { reads.push(path); return bytes.has(path) ? { data: new Blob([bytes.get(path)]), error: null } : { data: null, error: { message: "Missing fixture object" } }; },
      async upload(path, body) {
        if (bytes.has(path)) return { error: { message: "already exists", statusCode: "409" } };
        bytes.set(path, Buffer.from(body)); return { error: null };
      },
      async copy(source, target) {
        if (!bytes.has(source)) return { error: { message: "Missing fixture source" } };
        if (bytes.has(target)) return { error: { message: "already exists", statusCode: "409" } };
        bytes.set(target, Buffer.from(bytes.get(source))); return { error: null };
      },
    }; } },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "complete_designpro_stage") {
        if (args.p_receipt.receiptKind) (tables.designpro_stage_receipts ||= []).push({ run_id: args.p_identity.workflowRunId, receipt_kind: args.p_receipt.receiptKind, receipt: args.p_receipt, receipt_hash: args.p_receipt_hash, identity: args.p_identity });
        for (const item of args.p_artifacts || []) (tables.designpro_artifacts ||= []).push({ run_id: args.p_identity.workflowRunId, artifact_kind: item.kind, surface_key: item.surfaceKey, storage_path: item.storagePath, content_hash: item.contentHash, byte_size: item.byteSize, metadata: item.metadata });
      }
      return { data: true, error: null };
    },
  };
  return sb;
}

async function lateProofFixture() {
  const release = await releaseFixture(); const { assets } = await panelFixture();
  const ownerId = tenant.slice(5); const requestId = "8d029269-d68d-4d07-814b-5e3d6f8b0b7c";
  const run = { id: runId, owner_id: ownerId, tenant_key: tenant, revision_id: revisionId, revision_snapshot_hash: "c".repeat(64), manifest_hash: release.manifestHash, input: { sourceEnticeRunId: "entice-fixture" } };
  const source = { revision_id: revisionId, owner_id: ownerId, tenant_key: tenant, generation_id: generationId, visualization_id: requestId, snapshot_hash: run.revision_snapshot_hash, snapshot: { visualizationId: requestId, generationId, callOnePanels: assets } };
  const atlas = { id: revisionId, owner_id: ownerId, tenant_key: tenant, generation_id: generationId, request_id: requestId, revision_sequence: 1, master_content_hash: "a".repeat(64), projection_content_hash: "b".repeat(64), manifest_content_hash: "d".repeat(64), metadata: { masterQcPassed: true, panelSourceHash: "a".repeat(64) } };
  const bytes = new Map();
  const rows = viewPlan.map((plan) => {
    const view = release.sourceViews.find((item) => item.viewKey === plan.consumerRole);
    const panel = assets.find((item) => item.surfaceKey === flatAtlas.surfaceForProofView(plan.sourceViewType));
    const zoneHash = hash(`view-authority:${plan.sourceViewType}`);
    const path = `designpro/${tenant}/${generationId}/calls-1-7/${plan.sourceViewType}/${view.contentHash}.png`;
    bytes.set(path, release.viewBytes.get(view.storagePath));
    return { request_id: requestId, source_view_type: plan.sourceViewType, consumer_role: plan.consumerRole, storage_path: path, content_hash: view.contentHash, byte_size: view.byteSize, content_type: view.contentType, superseded_at: null, metadata: {
      providerContract: photographer.ATLAS_SERVER_PROVIDER_CONTRACT,
      provider: { stage: photographer.ATLAS_PROOF_STAGE, execution: photographer.ATLAS_PROOF_EXECUTION, anchoredToFlatAtlas: true, atlasConditioningVerified: true, anchoredToView1: false,
        proofProducer: photographer.ATLAS_PROOF_STAGE, proofContract: photographer.ATLAS_PHOTOGRAPHER_PROOF_CONTRACT, proofSourceCommit: "a".repeat(40), proofRequestId: requestId, proofProvider: "google", proofModel: "gemini-3-pro-image-preview", proofImageRequestCount: 1,
        atlasRevisionId: atlas.id, atlasRevisionSequence: 1, atlasMasterContentHash: atlas.master_content_hash, atlasProjectionContentHash: atlas.projection_content_hash, atlasManifestContentHash: atlas.manifest_content_hash,
        atlasZoneContract: photographer.ATLAS_PANEL_AUTHORITY_CONTRACT, atlasZoneSurfaceKey: panel.surfaceKey, atlasZoneContentHash: panel.contentHash, sourcePanelHash: panel.contentHash },
      validation: { contract: proofQc.QC_CONTRACT, expectedView: proofQc.VIEW_CONTRACTS[plan.sourceViewType].label, proofHash: view.contentHash, atlasHash: atlas.projection_content_hash,
        authorityHash: zoneHash, zoneHash, zoneSurfaceKey: panel.surfaceKey, policyContract: proofQc.ADVISORY_POLICY_CONTRACT, semanticDisposition: "pass" },
      authority: { contract: flatAtlas.ATLAS_CONTRACT, zoneContract: flatAtlas.VIEW_AUTHORITY_CONTRACT, revisionId: atlas.id, revisionSequence: 1, masterContentHash: atlas.master_content_hash,
        manifestContentHash: atlas.manifest_content_hash, projectionContentHash: atlas.projection_content_hash, projectionSourceMasterHash: atlas.master_content_hash, zoneSurfaceKey: panel.surfaceKey, zoneContentHash: zoneHash },
    } };
  });
  const frozen = { run_id: "entice-fixture", receipt_kind: "views.seven-source", receipt_hash: "8".repeat(64), receipt: { verified: true, sevenViewsVerified: false, viewReceipts: [] } };
  const tables = {
    designpro_revision_sources: [source], designpro_flat_atlas_revisions: [atlas], designpro_generation_views: rows,
    designpro_generation_requests: [{ id: requestId, owner_id: ownerId, tenant_key: tenant, state: "leased" }],
    designpro_stage_receipts: [frozen],
    designpro_workflow_stages: [{ run_id: runId, stage_key: "source.verify", status: "completed", verification: { verified: true }, output: { call8: release.call8 } }],
    designpro_artifacts: release.proofRows.map((row) => ({ ...row, run_id: runId })),
  };
  return { release, source, run, atlas, rows, frozen, bytes, tables, sb: memoryDb({ tables, bytes }) };
}

test("late seven-view reconciliation only admits the same owner, accepted master and each own surface", async () => {
  const fixture = await lateProofFixture();
  const joined = worker.lateAtlasViewSet(fixture);
  assert.equal(joined.views.length, 7);
  assert.equal(joined.binding.masterContentHash, fixture.atlas.master_content_hash);
  for (const change of [
    { run: { ...fixture.run, owner_id: "other-owner" } },
    { atlas: { ...fixture.atlas, master_content_hash: "0".repeat(64) } },
    { rows: fixture.rows.map((row, i) => i ? row : { ...row, metadata: { ...row.metadata, provider: { ...row.metadata.provider, sourcePanelHash: fixture.source.snapshot.callOnePanels[1].contentHash } } }) },
    { rows: fixture.rows.map((row, i) => i ? row : { ...row, metadata: { ...row.metadata, provider: { ...row.metadata.provider, atlasRevisionId: "different-revision" } } }) },
  ]) assert.throws(() => worker.lateAtlasViewSet({ ...fixture, ...change }));
  assert.throws(() => worker.lateAtlasViewSet({ ...fixture, rows: fixture.rows.slice(1) }), (error) => error.code === "production_proofs_pending" && error.retryable === true);
});

test("output verification pins the complete late set without overwriting the early receipt; approval never rereads mutable views", async () => {
  const fixture = await lateProofFixture();
  const originalFrozen = structuredClone(fixture.frozen);
  const authorized = worker.authorizedAssetManifest(["print_pack_entitlement"]);
  const pinned = await worker.pinProductionProofJoin(fixture.sb, fixture.run, "entice-fixture", authorized);
  assert.equal(pinned.sourceViews.length, 7);
  assert.equal(pinned.viewBinding.contract, "designpro.late-atlas-proof-join.v1");
  assert.deepEqual(fixture.frozen, originalFrozen);
  assert.equal(fixture.sb.calls.length, 0);
  assert.equal(pinned.sourceViewSetHash, hashJson(pinned.sourceViews));
  fixture.tables.designpro_stage_receipts.push({ run_id: runId, receipt_kind: "output.verified", receipt_hash: hashJson({ proofJoin: pinned }), receipt: { proofJoin: pinned } });
  // A subsequent generation row cannot silently replace what final QC saw.
  fixture.tables.designpro_generation_views = [];
  const beforeReads = fixture.sb.reads.length;
  assert.deepEqual(await worker.approvedProductionProofJoin(fixture.sb, fixture.run), pinned);
  assert.ok(!fixture.sb.reads.slice(beforeReads).includes("designpro_generation_views"));
});

test("a short active producer waits, a stopped producer needs repair, and a changed seventh image cannot pin", async () => {
  const fixture = await lateProofFixture();
  fixture.tables.designpro_generation_views = fixture.rows.slice(1);
  await assert.rejects(worker.resolveProductionProofViews(fixture.sb, fixture.run, "entice-fixture"), (error) => error.code === "production_proofs_pending" && error.retryable === true);
  // Six current views plus a predecessor do not count as the new revision's seven.
  fixture.tables.designpro_generation_views = fixture.rows.map((row, i) => i ? row : { ...row, metadata: { ...row.metadata, provider: { ...row.metadata.provider, atlasRevisionId: "previous-revision" } } });
  await assert.rejects(worker.resolveProductionProofViews(fixture.sb, fixture.run, "entice-fixture"), (error) => error.code === "production_proofs_pending" && error.retryable === true);
  fixture.tables.designpro_generation_requests[0].state = "failed";
  await assert.rejects(worker.resolveProductionProofViews(fixture.sb, fixture.run, "entice-fixture"), (error) => error.code === "production_proofs_need_repair" && error.retryable === false);
  fixture.tables.designpro_generation_views = fixture.rows;
  fixture.bytes.set(fixture.rows[6].storage_path, Buffer.from("tampered seventh image"));
  await assert.rejects(worker.resolveProductionProofViews(fixture.sb, fixture.run, "entice-fixture"), (error) => error.code === "production_proof_bytes_changed" && error.retryable === false);
  assert.equal(fixture.sb.calls.length, 0);
});

async function logoOnlyExecutionFixture() {
  const sourceBytes = await sharp({ create: { width: 500, height: 330, channels: 3, background: { r: 35, g: 80, b: 130 } } }).png().toBuffer();
  const sourcePath = `designpro/${tenant}/${runId}/source/call8-2d-production-proof.png`;
  const bytes = new Map([[sourcePath, sourceBytes]]);
  const dimensionManifest = { expectedSurfaces: surfaces.map((row) => ({ ...row, surfaceSqFt: worker.round2(row.widthInches * row.heightInches / 144) })) };
  const run = { id: runId, revision_id: revisionId, tenant_key: tenant, owner_id: tenant.slice(5), revision_snapshot_hash: "d".repeat(64), input: { sourceEnticeRunId: "entice-fixture" }, results: { dimensionManifest } };
  const designId = worker.canonicalDesignId(generationId); const orderNumber = "FIXTURE-LOGO-1";
  const snapshot = { generationId, designId, orderNumber, designName: "Logo execution fixture", delivery: { contractVersion: "designpro.wrapbox-recipient.v1", customerId: generationId, customerEmail: "fixture@example.test", recipientIdentityHash: "e".repeat(64), designName: "Logo execution fixture", orderNumber } };
  const tables = {
    designpro_revision_sources: [{ revision_id: revisionId, generation_id: generationId, snapshot_hash: run.revision_snapshot_hash, owner_id: run.owner_id, tenant_key: tenant, snapshot }],
    designpro_workflow_stages: [{ run_id: runId, stage_key: "await_purchase", status: "completed", verification: { verified: true }, output: { authorizedAssetManifest: worker.authorizedAssetManifest(["logo_pack"]) } }],
    designpro_stage_receipts: [
      { run_id: runId, receipt_kind: "final.human-qc", receipt_hash: "a".repeat(64), receipt: { verifiedBy: "Fixture QC", approvalRef: "fixture-human-approval", approvedAt: "2026-09-08T14:00:00.123456Z", qc: { designId, orderNumber } } },
      { run_id: runId, receipt_kind: "panelpro.preflight", receipt_hash: "b".repeat(64), receipt: { qc: { logoInventoryVerified: true, textLockVerified: true } } },
    ],
    designpro_artifacts: [{ run_id: runId, artifact_kind: "flat-proof", surface_key: "", storage_path: sourcePath, content_hash: hash(sourceBytes), byte_size: sourceBytes.length, metadata: {} }],
  };
  return { run, sourceBytes, sourcePath, sb: memoryDb({ tables, bytes }) };
}

test("logo-only output verification, final gate and three-stamp execution keep their purchased scope", async () => {
  const { sb, run, sourceBytes, sourcePath } = await logoOnlyExecutionFixture();
  const stage = (key) => ({ id: `fixture:${key}`, stage_key: key, lease_token: "fixture-lease", run_id: runId });
  await worker.executeProduction(sb, stage("output.verify"), run, {});
  const output = sb.calls.at(-1).args.p_receipt;
  assert.equal(output.exactSurfaceFormatCount, 0);
  assert.equal(output.proofJoin, null);
  await worker.executeProduction(sb, stage("await_final_human_qc"), run, {});
  assert.equal(sb.calls.at(-1).name, "request_designpro_human_gate");
  assert.equal(sb.calls.at(-1).args.p_details.productionPackAuthorized, false);
  assert.equal(sb.calls.at(-1).args.p_details.logoPackAuthorized, true);
  assert.equal(sb.calls.at(-1).args.p_details.proofJoin, undefined);
  await worker.executeProduction(sb, stage("stamp.build"), run, {});
  const stamped = sb.calls.at(-1).args;
  assert.equal(stamped.p_receipt.stampedViews.length, 0);
  assert.deepEqual(stamped.p_artifacts.map((item) => item.surfaceKey).sort(), ["certificate", "seal", "stamped-proof"]);
  assert.deepEqual(sb.bytes.get(sourcePath), sourceBytes);
  assert.equal(sb.reads.includes("designpro_generation_views"), false);
  assert.equal(sb.reads.includes("designpro_flat_atlas_revisions"), false);
});

test("Production Pack stage execution stamps Call 8 and all seven pinned proofs after QC, and never mutates originals", async () => {
  const fixture = await logoOnlyExecutionFixture(); const release = await releaseFixture();
  const { sb, run } = fixture;
  run.manifest_hash = release.manifestHash;
  sb.tables.designpro_workflow_stages[0].output.authorizedAssetManifest = worker.authorizedAssetManifest(["print_pack_entitlement"]);
  const proofRow = sb.tables.designpro_artifacts[0];
  const receipt = { ...release.call8.receipt, sourceProofHash: proofRow.content_hash };
  const call8 = { receiptKind: "call8.flat-proof", receiptHash: hashJson(receipt), receipt };
  proofRow.metadata = { sourceReceiptHash: call8.receiptHash, manifestHash: run.manifest_hash };
  sb.tables.designpro_workflow_stages.push({ run_id: runId, stage_key: "source.verify", status: "completed", verification: { verified: true }, output: { call8 } });
  const proofJoin = worker.assertProductionProofJoin({ call8, proofRows: [proofRow], sourceViews: release.sourceViews, manifestHash: run.manifest_hash });
  sb.tables.designpro_stage_receipts.push({ run_id: runId, receipt_kind: "output.verified", receipt_hash: hashJson({ proofJoin }), receipt: { proofJoin } });
  for (const [path, bytes] of release.viewBytes) sb.bytes.set(path, bytes);
  const originalHashes = [...sb.bytes].map(([path, bytes]) => [path, hash(bytes)]);
  const stage = (key) => ({ id: `fixture:${key}`, stage_key: key, lease_token: "fixture-lease", run_id: runId });
  await worker.executeProduction(sb, stage("await_final_human_qc"), run, {});
  assert.deepEqual(sb.calls.at(-1).args.p_details.proofJoin, proofJoin);
  await worker.executeProduction(sb, stage("stamp.build"), run, {});
  const stamped = sb.calls.at(-1).args;
  assert.equal(stamped.p_artifacts.length, 10);
  assert.equal(stamped.p_receipt.stampedViews.length, 7);
  assert.equal(stamped.p_receipt.sourceProofHash, proofRow.content_hash);
  assert.deepEqual(stamped.p_receipt.proofJoin, proofJoin);
  assert.equal(worker.assertStampedViewSet({ sourceViews: release.sourceViews, rows: sb.tables.designpro_artifacts, stampReceipt: stamped.p_receipt }).length, 7);
  for (const [path, contentHash] of originalHashes) assert.equal(hash(sb.bytes.get(path)), contentHash);
  for (const item of stamped.p_artifacts) assert.equal(hash(sb.bytes.get(item.storagePath)), item.contentHash);
});

test("the final human gate refuses a six-view pinned set before requesting an approval", async () => {
  const fixture = await lateProofFixture(); const { sb, run } = fixture;
  const authorized = worker.authorizedAssetManifest(["print_pack_entitlement"]);
  sb.tables.designpro_workflow_stages.push({ run_id: runId, stage_key: "await_purchase", status: "completed", verification: { verified: true }, output: { authorizedAssetManifest: authorized } });
  const good = await worker.pinProductionProofJoin(sb, run, "entice-fixture", authorized);
  const damaged = { ...good, sourceViews: good.sourceViews.slice(1) };
  sb.tables.designpro_stage_receipts.push({ run_id: runId, receipt_kind: "output.verified", receipt_hash: hashJson({ proofJoin: damaged }), receipt: { proofJoin: damaged } });
  await assert.rejects(worker.executeProduction(sb, { id: "fixture-final", stage_key: "await_final_human_qc", lease_token: "fixture-lease" }, run, {}), { code: "zip_source_views_incomplete" });
  assert.equal(sb.calls.length, 0);
});

test("production Call 8 recovers from the unchanged early zero-view freeze using the production lease and GENIE geometry", async (t) => {
  const { sb, run } = await logoOnlyExecutionFixture(); const { panels, assets } = await panelFixture();
  run.workflow_type = "designpro.production_pack";
  run.manifest_hash = "9".repeat(64);
  run.results.dimensionManifest.totalSqFt = worker.round2(surfaces.reduce((sum, row) => sum + row.widthInches * row.heightInches / 144, 0));
  run.results.dimensionManifest.vehicle = { year: 2026, make: "Fixture", model: "Measured" };
  const source = sb.tables.designpro_revision_sources[0];
  Object.assign(source.snapshot, { callOnePanels: assets, bodyText: "Frozen customer copy", expectedLogoInventory: [], vehicle: run.results.dimensionManifest.vehicle });
  sb.tables.designpro_workflow_runs = [run];
  const freeze = { run_id: "entice-fixture", stage_key: "revision.freeze", status: "completed", verification: { verified: true }, output: { viewReceipts: [], sevenViewsVerified: false } };
  sb.tables.designpro_workflow_stages.push(freeze);
  const frozenBefore = structuredClone(freeze);
  for (const item of assets) sb.bytes.set(item.storagePath, panels[item.surfaceKey]);
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://fixture.invalid/compose-proof-sheet");
    const body = JSON.parse(options.body); requests.push(body);
    assert.equal(body.workflowRunId, run.id);
    assert.equal(body.panelAssets.length, 6);
    assert.equal(body.views, undefined);
    const sheet = await renderProofSheet({ panels, surfaces: body.surfaces, vehicle: body.vehicle, ...body.proofMeta, proofBinding: body.flatMaterialHash, masterHash: assets[0].sourceMasterHash });
    const path = `designpro/${tenant}/${runId}/proof/flat-proof-${body.flatMaterialHash}.png`;
    sb.bytes.set(path, sheet.bytes);
    return Response.json({ success: true, contract: "designpro.call8-panel-proof.v4", imageRequestCount: 0, flatMaterialHash: body.flatMaterialHash, textLock: body.textLock,
      proof: { contract: sheet.contract, storagePath: path, contentHash: hash(sheet.bytes), byteSize: sheet.bytes.length, width: sheet.width, height: sheet.height, totalSqFt: sheet.totalSqFt },
      surfaceTiles: sheet.tiles.map((tile) => ({ ...tile, sourcePanelHash: assets.find((item) => item.surfaceKey === tile.surfaceKey).contentHash, sourcePanelPath: assets.find((item) => item.surfaceKey === tile.surfaceKey).storagePath })),
    });
  });
  const recovered = await worker.composeCall8Proof(sb, "http://fixture.invalid", "fixture-secret", run, { id: "source-stage", lease_token: "source-lease" }, {}, run.input, { lineageRunId: "entice-fixture" });
  assert.equal(requests.length, 1);
  assert.equal(recovered.receipt.imageRequestCount, 0);
  assert.equal(recovered.receipt.surfaceTiles.length, 6);
  assert.equal(recovered.receipt.manifestHash, run.manifest_hash);
  assert.equal(recovered.receiptHash, hashJson(recovered.receipt));
  assert.equal(hash(sb.bytes.get(recovered.artifact.storagePath)), recovered.artifact.contentHash);
  assert.equal(recovered.receipt.viewLineage.length, 0);
  assert.deepEqual(freeze, frozenBefore);
  assert.equal(sb.calls.length, 0, "composition cannot complete or rewrite the original entice stage");
  for (const panel of assets) assert.equal(hash(sb.bytes.get(panel.storagePath)), panel.contentHash);
});
