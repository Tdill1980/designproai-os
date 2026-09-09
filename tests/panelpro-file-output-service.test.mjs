import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPanelProFixture } from './helpers/panelprofile-fixture.mjs';
import { createPanelProfileDatabase, createPanelProfileTestAdapter, readStoredZip64, OWNER, OTHER, OUTSIDER, sha } from './helpers/panelprofile-service-fixture.mjs';
const require = createRequire(import.meta.url);
const sharp = require('../runtime/node_modules/sharp');
const { createPanelProFileOutputService } = require('../runtime/panelpro-file-output-service.cjs');
const { hashJson, verifyPieceArtifactJoin } = require('../runtime/panelpro-file-output-graph.cjs');
const { buildPanelProFileOutputHandoff } = require('../runtime/panelpro-file-output-contract.cjs');
const CHECKS = { template: true, fit: true, essentialArtworkSafe: true, backgroundContinuous: true, fiveInchBleed: true, resolution: true, physicalPieces: true, filesInspected: true };

async function setup(t, fixtureOptions = {}) {
  const db = await createPanelProfileDatabase();
  const fixture = await createPanelProFixture({ sourceApp: 'GraphicsPro', ownerPath: `designpro/user_${OWNER}/fixture`,
    tenantKey: `user_${OWNER}`, sourceJobId: 'graphics-job', generationId: 'generation-7', designId: 'design-7', orderId: 'order-7', revisionId: 'revision-7', ...fixtureOptions });
  const adapter = createPanelProfileTestAdapter(db, fixture.files);
  const spoolDir = await mkdtemp(join(tmpdir(), 'panelprofile-service-test-'));
  const services = [];
  const newService = () => {
    const service = createPanelProFileOutputService({ supabase: adapter.supabase, workerId: `service-test-${services.length}`, enabled: true,
      spoolDir, supabaseUrl: 'https://test-project.supabase.co', serviceRoleKey: 'test-service-token-never-a-real-key-000000000',
      tusUploadOptions: adapter.tusUploadOptions, schedule: () => {} });
    services.push(service); return service;
  };
  t.after(async () => { services.forEach((s) => s.stop()); await db.close(); await rm(spoolDir, { recursive: true, force: true }); });
  return { db, fixture, adapter, newService, service: newService() };
}
async function drive(service, owner, runId, target) {
  for (let step = 0; step < 20; step += 1) {
    const state = await service.getRun(owner, runId);
    if (state.status === target) return state;
    assert.notEqual(state.status, 'failed', JSON.stringify({ health: service.health(), blockers: state.blockers }));
    await service.tick();
  }
  assert.fail(`did not reach ${target}: ${JSON.stringify(await service.getRun(owner, runId))}`);
}

test('service runs the real SQL graph, renderer, human gate, ZIP64 pack and signed preview projection end to end', async (t) => {
  const { service, fixture, adapter, db } = await setup(t, { orderId: 'ORDER / 2026 #42' });
  await assert.rejects(service.registerSource(OTHER, fixture.input), { code: 'panelprofile_qc_permission_required' });
  const source = await service.registerSource(OWNER, fixture.input);
  assert.deepEqual(await service.registerSource(OWNER, fixture.input), source, 'registration retry returns the immutable source');
  const run = await service.createRun(OWNER, source);
  assert.equal((await service.createRun(OWNER, source)).id, run.id, 'create retry returns the same durable run');
  await assert.rejects(service.getRun(OUTSIDER, run.id), { code: 'panelprofile_run_not_found' });
  assert.deepEqual(run.stages.filter((n) => !n.dependsOn.length).map((n) => n.key).sort(), ['source.verify', 'template.lookup']);
  const waiting = await drive(service, OWNER, run.id, 'waiting');
  assert.match(waiting.artifactSetHash, /^[a-f0-9]{64}$/);
  assert.ok(waiting.previews.some((p) => p.role === 'branded-template'));
  assert.ok(waiting.previews.some((p) => p.role === 'template-overlay'));
  assert.ok(waiting.previews.some((p) => p.role === 'production-panel-proof'));
  assert.ok(waiting.previews.every((p) => p.signedUrl.startsWith('https://storage.example.test/signed/') && p.geometryValidated && p.approvedDisplay));
  assert.equal([...adapter.files.keys()].some((path) => path.endsWith('.zip')), false, 'nothing is packaged before the human gate');
  assert.ok(waiting.stages.every((node) => !('output' in node) && !('input' in node)), 'public progress exposes fixed narration, not private orchestration inputs');

  const handoffInput = buildPanelProFileOutputHandoff((await db.query('SELECT handoff FROM public.panelprofile_source_handoffs WHERE id=$1', [source.sourceId])).rows[0].handoff);
  const realNodes = (await db.query('SELECT * FROM public.panelprofile_nodes WHERE run_id=$1', [run.id])).rows;
  const realArtifacts = (await db.query('SELECT * FROM public.panelprofile_artifacts WHERE run_id=$1', [run.id])).rows;
  assert.equal(verifyPieceArtifactJoin(handoffInput, realNodes, realArtifacts).artifactSetHash, waiting.artifactSetHash);
  const productionPng = realArtifacts.find((a) => a.role === 'production-png');
  assert.throws(() => verifyPieceArtifactJoin(handoffInput, realNodes, [...realArtifacts,
    { ...productionPng, storage_path: `${productionPng.storage_path}-extra.png` }]), /panelprofile_piece_formats_missing/,
  'an extra unreviewed format cannot join a complete production section');
  for (const mutate of [
    (node) => { node.output.artifacts[0].contentHash = 'e'.repeat(64); },
    (node) => { node.output.artifacts[0].byteSize += 1; },
    (node) => { node.output.artifacts[0].mimeType = 'application/octet-stream'; },
    (node) => { node.output.artifacts[1] = structuredClone(node.output.artifacts[0]); },
  ]) {
    const altered = structuredClone(realNodes); mutate(altered.find((node) => node.node_key.startsWith('panelprofileoutput.render:')));
    assert.throws(() => verifyPieceArtifactJoin(handoffInput, altered, realArtifacts), /panelprofile_piece_receipt_mismatch/,
      'the durable artifact registry must match the actual immutable renderer receipt');
  }
  const duplicateSections = structuredClone(realNodes), renderedPiece = duplicateSections.find((node) => node.node_key.startsWith('panelprofileoutput.render:')).output.pieces[0];
  renderedPiece.sections.push(structuredClone(renderedPiece.sections[0]));
  assert.throws(() => verifyPieceArtifactJoin(handoffInput, duplicateSections, realArtifacts), /panelprofile_piece_formats_missing/);

  for (const body of [
    { artifactSetHash: 'f'.repeat(64), checks: CHECKS, approvalRef: 'review-one' },
    { artifactSetHash: null, checks: CHECKS, approvalRef: 'review-one' },
    { artifactSetHash: waiting.artifactSetHash, checks: CHECKS, approvalRef: null },
    { artifactSetHash: waiting.artifactSetHash, checks: {}, approvalRef: 'review-one' },
  ]) await assert.rejects(service.approve(OWNER, run.id, body));
  assert.equal((await service.getRun(OWNER, run.id)).status, 'waiting');

  await db.query('UPDATE public.designpro_qc_members SET can_preflight=false WHERE user_id=$1', [OWNER]);
  assert.deepEqual(await service.capabilities(OWNER), {canPrepare:false,canReview:false,enabled:true});
  const customer = await service.getRun(OWNER, run.id);
  assert.equal(customer.canReview, false); assert.deepEqual(customer.files, []);
  assert.equal(customer.previews.length, waiting.previews.length);
  await assert.rejects(service.approve(OWNER, run.id, { artifactSetHash: waiting.artifactSetHash, checks: CHECKS, approvalRef: 'review-one' }), { code: 'panelprofile_qc_permission_required' });
  await db.query('UPDATE public.designpro_qc_members SET can_preflight=true WHERE user_id=$1', [OWNER]);
  assert.deepEqual(await service.capabilities(OWNER), {canPrepare:true,canReview:true,enabled:true});
  await service.approve(OWNER, run.id, { artifactSetHash: waiting.artifactSetHash, checks: CHECKS, approvalRef: 'review-one' });
  const complete = await drive(service, OWNER, run.id, 'completed');
  const zipFile = complete.files.find((a) => a.role === 'reviewed-package'); assert.ok(zipFile);
  const row = (await db.query("SELECT * FROM public.panelprofile_artifacts WHERE run_id=$1 AND role='reviewed-package'", [run.id])).rows[0];
  const zip = adapter.files.get(row.storage_path); assert.equal(sha(zip), row.content_hash);
  const entries = readStoredZip64(zip), manifest = JSON.parse(entries.get('manifest.json').toString());
  assert.equal(manifest.sourceApp, 'GraphicsPro'); assert.equal(manifest.sourceJobId, 'graphics-job');
  assert.equal(manifest.generationId, 'generation-7'); assert.equal(manifest.designId, 'design-7');
  assert.equal(manifest.orderId, 'ORDER / 2026 #42'); assert.equal(manifest.revisionId, 'revision-7');
  assert.equal(manifest.artifactSetHash, waiting.artifactSetHash); assert.equal(manifest.approval.qcApproved, true);
  assert.equal(manifest.approval.actorId, OWNER); assert.equal(manifest.customerReleaseApproved, false);
  for (const artifact of manifest.files) assert.equal(sha(entries.get(artifact.name)), artifact.contentHash);
  assert.deepEqual([...entries.keys()].sort(), [...manifest.files.map(file=>file.name),'manifest.json'].sort(), 'every ZIP entry is disclosed in the exact reviewed inventory');
  for(const asset of fixture.input.availableAssets) assert.ok(manifest.files.some(file=>file.assetId===asset.assetId && file.contentHash===asset.contentHash && file.sourceStoragePath===asset.storagePath), 'each available original is retained and bound before QC');
  const png = manifest.files.find((a) => a.role === 'production-png');
  const metadata = await sharp(entries.get(png.name)).metadata();
  assert.equal(metadata.width, 2700); assert.equal(metadata.height, 2400); assert.equal(metadata.density, 1500);
  assert.ok(manifest.files.some((a) => a.role === 'production-tiff')); assert.ok(manifest.files.some((a) => a.role === 'production-pdf'));
  const originalProof=manifest.files.find(file=>file.role==='production-panel-proof');
  const approvedProof=manifest.files.find(file=>file.role==='qc-approved-panel-proof');
  assert.ok(originalProof && approvedProof);assert.notEqual(originalProof.contentHash,approvedProof.contentHash);
  assert.ok(complete.previews.some(preview=>preview.role==='qc-approved-panel-proof'));
  assert.ok(manifest.files.filter((a) => a.role === 'production-pdf').every((a) => a.name.endsWith(`_TENTH_SCALE-${a.contentHash}.pdf`)));
  assert.ok([...entries.keys()].some((name) => name.startsWith('assets/') && name.endsWith('.svg')));
  const handoff = (await db.query("SELECT output FROM public.panelprofile_nodes WHERE run_id=$1 AND node_key='panelprofileoutput.handoff'", [run.id])).rows[0].output;
  assert.equal(handoff.requiresProofRefresh, true, 'moving artwork requires downstream visual proofs to refresh');
  assert.equal(handoff.customerReleaseApproved, false);
  assert.equal((await service.listRuns(OWNER, { sourceApp: 'GraphicsPro', sourceJobId: source.sourceJobId })).length, 1);
  assert.equal(adapter.rpcCalls.filter((c) => c.name === 'acquire_panelprofile_heavy_lease').length, 4, 'plan, render, verify and package use the shared heavy slot');
});

test('a transient finish failure retries after restart without duplicate production objects or artifact rows', async (t) => {
  const { fixture, adapter, db, service, newService } = await setup(t, { move: false });
  const source = await service.registerSource(OWNER, fixture.input), run = await service.createRun(OWNER, source);
  await service.tick(); await service.tick(); await service.tick(); // Both independent roots and real plan.
  const renderId = (await db.query("SELECT id FROM public.panelprofile_nodes WHERE run_id=$1 AND node_key LIKE 'panelprofileoutput.render:%'", [run.id])).rows[0].id;
  adapter.failures.push({ type: 'rpc', name: 'finish_panelprofile_node', when: (args) => args.p_node_id === renderId && args.p_state === 'completed' });
  await service.tick();
  const pending = (await db.query('SELECT state,attempt FROM public.panelprofile_nodes WHERE id=$1', [renderId])).rows[0];
  assert.equal(pending.state, 'pending'); assert.equal(pending.attempt, 1);
  const firstRender = adapter.rpcCalls.find((call) => call.name === 'finish_panelprofile_node' && call.args.p_node_id === renderId && call.args.p_state === 'completed').args.p_output;
  const paths = new Map(adapter.uploads.map((u) => [u.path, u.hash]));
  service.stop();
  await db.query('UPDATE public.panelprofile_nodes SET available_at=now() WHERE id=$1', [renderId]);
  const recovered = newService();
  const waiting = await drive(recovered, OWNER, run.id, 'waiting');
  assert.ok(waiting.artifactSetHash);
  const retried = (await db.query('SELECT state,attempt,output FROM public.panelprofile_nodes WHERE id=$1', [renderId])).rows[0];
  assert.equal(retried.state, 'completed'); assert.equal(retried.attempt, 2);
  assert.ok(adapter.uploads.some((u) => u.duplicate), 'storage conflicts are verified and reused');
  for (const upload of adapter.uploads) if (paths.has(upload.path)) assert.equal(upload.hash, paths.get(upload.path));
  const artifacts = (await db.query('SELECT storage_path FROM public.panelprofile_artifacts WHERE run_id=$1', [run.id])).rows;
  assert.equal(new Set(artifacts.map((a) => a.storage_path)).size, artifacts.length);
  assert.equal(adapter.uploads.filter((u) => !u.duplicate).length, artifacts.length);
  assert.deepEqual(retried.output.artifacts.map((a) => [a.storagePath, a.contentHash]), firstRender.artifacts.map((a) => [a.storagePath, a.contentHash]));
  assert.equal(retried.output.receiptHash, firstRender.receiptHash, 'transport retry metadata must not change an immutable piece receipt');
});

test('expired claims are fenced, and only the new worker can commit the same source-verified stage', async (t) => {
  const { service, fixture, adapter, db, newService } = await setup(t, { move: false });
  const source = await service.registerSource(OWNER, fixture.input), run = await service.createRun(OWNER, source);
  const claimed = await adapter.supabase.rpc('claim_panelprofile_node', { p_worker: 'stale-worker', p_lease_seconds: 180 });
  assert.equal(claimed.data.node.node_key, 'source.verify');
  const result = await service.execute(claimed.data, new AbortController().signal);
  await db.query("UPDATE public.panelprofile_nodes SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [claimed.data.node.id]);
  service.stop(); const recovered = newService(); await recovered.tick();
  const staleFinish = await adapter.supabase.rpc('finish_panelprofile_node', { p_node_id: claimed.data.node.id,
    p_token: claimed.data.node.lease_token, p_state: result.state, p_output: result.output, p_output_hash: hashJson(result.output), p_artifacts: result.artifacts });
  assert.match(staleFinish.error.message, /lease_lost/);
  const current = (await db.query('SELECT state,attempt,output FROM public.panelprofile_nodes WHERE id=$1', [claimed.data.node.id])).rows[0];
  assert.equal(current.state, 'completed'); assert.equal(current.attempt, 2); assert.equal(current.output.verified, true);
  assert.equal((await recovered.getRun(OWNER, run.id)).status, 'running');
});

test('DesignPro source admission preserves distinct revision IDs and rejects substituted master, panel or ownership', async (t) => {
  const revisionId = '44444444-4444-4444-8444-444444444444', atlasRevisionId = '55555555-5555-4555-8555-555555555555';
  const { service, fixture, db } = await setup(t, { sourceApp: 'DesignPro', ownerPath: `designpro/user_${OTHER}/fixture`, tenantKey: `user_${OTHER}`, revisionId, orderId: 'ORDER / 2026 #42' });
  const panels = [];
  for (const [index, surfaceKey] of ['driver', 'passenger', 'hood', 'roof', 'front', 'rear'].entries()) {
    const ref = index === 0 ? fixture.input.pieces[0].source
      : fixture.put(`${surfaceKey}.png`, await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: index * 25, g: 10, b: 20 } } }).png().toBuffer());
    panels.push({ surfaceKey, ...ref, sourceMasterHash: fixture.input.master.contentHash });
  }
  await db.query('INSERT INTO public.designpro_revision_sources VALUES($1,$2,$3,$4)', [revisionId, fixture.input.generationId, OTHER,
    JSON.stringify({ callOnePanels: panels, designId: fixture.input.designId, orderId: fixture.input.orderId, vehicle: fixture.geometry.vehicle })]);
  await db.query('INSERT INTO public.designpro_flat_atlas_revisions VALUES($1,$2,$3,$4,$5)',
    [atlasRevisionId, fixture.input.generationId, OTHER, fixture.input.master.contentHash, fixture.input.master.storagePath]);
  for (const mutate of [
    (input) => { input.master.contentHash = 'f'.repeat(64); },
    (input) => { input.pieces[0].source = input.master; },
    (input) => { input.pieces[0].source.storagePath = `designpro/user_${OWNER}/other.png`; },
    (input) => { input.atlasRevisionId = revisionId; },
    (input) => { input.designId = 'substituted-design'; },
    (input) => { input.orderId = 'substituted-order'; },
  ]) {
    const invalid = structuredClone(fixture.input); mutate(invalid);
    await assert.rejects(service.registerSource(OWNER, invalid));
  }
  for (const [editVehicle, code] of [
    [(vehicle) => { vehicle.year = '2021'; }, 'panelprofile_template_vehicle_mismatch'],
    [(vehicle) => { vehicle.make = 'Ford'; }, 'panelprofile_template_vehicle_mismatch'],
    [(vehicle) => { vehicle.model = 'Mustang'; }, 'panelprofile_template_vehicle_mismatch'],
    [(vehicle) => { vehicle.bodyStyle = 'convertible'; }, 'panelprofile_template_vehicle_variant_mismatch'],
    [(vehicle) => { delete vehicle.bodyStyle; }, 'panelprofile_template_vehicle_variant_missing'],
  ]) {
    const invalid = structuredClone(fixture.input), geometry = structuredClone(fixture.geometry); editVehicle(geometry.vehicle);
    const ref = fixture.put(`vehicle-${sha(Buffer.from(JSON.stringify(geometry)))}.json`, Buffer.from(JSON.stringify(geometry)));
    invalid.template.geometry = ref; invalid.template.geometryHash = ref.contentHash;
    await assert.rejects(service.registerSource(OWNER, invalid), { code });
  }
  const source = await service.registerSource(OWNER, fixture.input);
  const stored = (await db.query('SELECT * FROM public.panelprofile_source_handoffs WHERE id=$1', [source.sourceId])).rows[0];
  assert.equal(stored.owner_id, OTHER); assert.equal(stored.registered_by, OWNER);
  assert.equal(stored.revision_id, revisionId); assert.equal(stored.handoff.atlasRevisionId, atlasRevisionId);
  const run = await service.createRun(OTHER, source);
  assert.equal(run.canReview, false); assert.equal(run.revisionId, revisionId);
  await assert.rejects(service.getRun(OUTSIDER, run.id), { code: 'panelprofile_run_not_found' });
  await db.query('INSERT INTO public.designpro_flat_atlas_revisions VALUES($1,$2,$3,$4,$5)',
    ['66666666-6666-4666-8666-666666666666',fixture.input.generationId,OTHER,fixture.input.master.contentHash,`${fixture.input.master.storagePath}-other-version`]);
  await assert.rejects(service.registerSource(OWNER,fixture.input),{code:'panelprofile_canonical_revision_mismatch'});
  assert.deepEqual(await service.registerSource(OWNER,{...fixture.input,atlasRevisionId}),source,
    'an explicit saved revision still resolves when a different history entry has identical master pixels');
});

test('package retries preserve exact ZIP bytes when the database returns unordered artifacts differently', async (t) => {
  const { service, fixture, adapter } = await setup(t, { move: false });
  fixture.input.pieces[0].composition.rebuildFromSeparatedAssets = true;
  const source = await service.registerSource(OWNER, fixture.input), run = await service.createRun(OWNER, source);
  const waiting = await drive(service, OWNER, run.id, 'waiting');
  await service.approve(OWNER, run.id, { artifactSetHash: waiting.artifactSetHash, checks: CHECKS, approvalRef: 'pack-retry-review' });
  const claim = (await adapter.supabase.rpc('claim_panelprofile_node', { p_worker: 'package-worker', p_lease_seconds: 180 })).data;
  assert.equal(claim.node.node_key, 'panelprofileoutput.package');
  const first = await service.execute(claim, new AbortController().signal);
  adapter.reverseUnorderedArtifacts = true;
  const retry = await service.execute(claim, new AbortController().signal);
  assert.equal(retry.output.zip.contentHash, first.output.zip.contentHash);
  assert.equal(retry.output.zip.storagePath, first.output.zip.storagePath);
  assert.equal(adapter.uploads.filter((u) => u.path.endsWith('.zip') && !u.duplicate).length, 1);
  const finished = await adapter.supabase.rpc('finish_panelprofile_node', { p_node_id: claim.node.id, p_token: claim.node.lease_token,
    p_state: retry.state, p_output: retry.output, p_output_hash: hashJson(retry.output), p_artifacts: retry.artifacts });
  assert.equal(finished.error, null);
  await service.tick();
  const handoffClaim = adapter.rpcCalls.find((c) => c.name === 'finish_panelprofile_node' && c.args.p_output.status === 'ready_for_source_app_review');
  assert.equal(handoffClaim.args.p_output.requiresProofRefresh, true, 'layer rebuilds refresh proofs even when no protected element moves');
});

test('an artifact changed after verification cannot be packaged under the human-approved hash set', async (t) => {
  const { service, fixture, adapter, db } = await setup(t, { move: false });
  const source = await service.registerSource(OWNER, fixture.input), run = await service.createRun(OWNER, source);
  const waiting = await drive(service, OWNER, run.id, 'waiting');
  await service.approve(OWNER, run.id, { artifactSetHash: waiting.artifactSetHash, checks: CHECKS, approvalRef: 'tamper-review' });
  const artifact = (await db.query("SELECT storage_path FROM public.panelprofile_artifacts WHERE run_id=$1 AND role='production-png'", [run.id])).rows[0];
  const changed = Buffer.from(adapter.files.get(artifact.storage_path)); changed[100] ^= 1; adapter.files.set(artifact.storage_path, changed);
  await service.tick();
  assert.equal((await service.getRun(OWNER, run.id)).status, 'failed');
  assert.equal([...adapter.files.keys()].some((path) => path.endsWith('.zip')), false);
  assert.equal(service.health().lastError, 'panelprofile_output_hash_mismatch');
});

test('two prepared handoffs for the same revision require an exact source selection', async (t) => {
  const { service, fixture, db } = await setup(t, { move: false });
  const first = await service.registerSource(OWNER, fixture.input);
  const changed = structuredClone(fixture.input); changed.printableWidthInches = 60;
  const second = await service.registerSource(OWNER, changed);
  assert.notEqual(first.sourceId, second.sourceId); assert.notEqual(first.inputHash, second.inputHash);
  await assert.rejects(service.createRun(OWNER, { sourceApp: first.sourceApp, sourceJobId: first.sourceJobId, revisionId: first.revisionId }));
  const firstRun = await service.createRun(OWNER, first), secondRun = await service.createRun(OWNER, second);
  assert.equal(firstRun.inputHash, first.inputHash); assert.equal(secondRun.inputHash, second.inputHash);
  assert.notEqual(firstRun.id, secondRun.id);
  assert.equal((await db.query('SELECT source_id FROM public.panelprofile_runs WHERE id=$1', [firstRun.id])).rows[0].source_id, first.sourceId);
  assert.equal((await db.query('SELECT source_id FROM public.panelprofile_runs WHERE id=$1', [secondRun.id])).rows[0].source_id, second.sourceId);
  await assert.rejects(service.createRun(OWNER, { ...first, inputHash: second.inputHash }));
});

test('a transient Storage outage during preflight retries instead of becoming a permanent human-correction wait', async (t) => {
  const { service, fixture, adapter, db } = await setup(t, { move: false });
  const source = await service.registerSource(OWNER, fixture.input), run = await service.createRun(OWNER, source);
  await service.tick(); await service.tick();
  adapter.failures.push({ type: 'download', path: fixture.input.template.geometry.storagePath });
  await service.tick();
  const pending = (await db.query("SELECT id,state,attempt FROM public.panelprofile_nodes WHERE run_id=$1 AND node_key='panelprofileoutput.plan'", [run.id])).rows[0];
  assert.equal(pending.state, 'pending'); assert.equal(pending.attempt, 1);
  assert.equal((await service.getRun(OWNER, run.id)).status, 'running');
  await db.query('UPDATE public.panelprofile_nodes SET available_at=now() WHERE id=$1', [pending.id]);
  const waiting = await drive(service, OWNER, run.id, 'waiting');
  assert.equal(waiting.stages.find((n) => n.key === 'panelprofileoutput.plan').state, 'completed');
  assert.equal(waiting.stages.find((n) => n.key === 'await_panelpro_preflight_qc').state, 'waiting');
  assert.equal(waiting.blockers.length, 0);
});

test('colon-bearing piece and asset identities survive deterministic safe Storage naming and packaging', async (t) => {
  const { service, fixture, adapter, db } = await setup(t, { move: false });
  fixture.input.pieces[0].pieceId = 'driver:panel_1';
  fixture.input.availableAssets[0].assetId = 'logo:brand';
  fixture.input.pieces[0].protectedElements[0].assetId = 'logo:brand';
  fixture.geometry.pieces[0].pieceId = 'driver:panel_1';
  const geometryRef = fixture.put('geometry-colon.json', Buffer.from(JSON.stringify(fixture.geometry)));
  fixture.input.template.geometry = geometryRef; fixture.input.template.geometryHash = geometryRef.contentHash;
  const source = await service.registerSource(OWNER, fixture.input), run = await service.createRun(OWNER, source);
  const waiting = await drive(service, OWNER, run.id, 'waiting');
  assert.ok(waiting.previews.some((p) => p.pieceId === 'driver:panel_1'));
  const artifacts = (await db.query('SELECT * FROM public.panelprofile_artifacts WHERE run_id=$1', [run.id])).rows;
  assert.ok(artifacts.some((a) => a.storage_path.includes('/driver~3apanel_1/')));
  assert.ok(artifacts.some((a) => a.storage_path.includes('/logo~3abrand/')));
  assert.ok(artifacts.every((a) => !a.storage_path.includes(':')));
  await service.approve(OWNER, run.id, { artifactSetHash: waiting.artifactSetHash, checks: CHECKS, approvalRef: 'colon-identities-review' });
  await drive(service, OWNER, run.id, 'completed');
  const packageRow = (await db.query("SELECT * FROM public.panelprofile_artifacts WHERE run_id=$1 AND role='reviewed-package'", [run.id])).rows[0];
  const entries = readStoredZip64(adapter.files.get(packageRow.storage_path)), manifest = JSON.parse(entries.get('manifest.json'));
  assert.ok(manifest.files.some((a) => a.pieceId === 'driver:panel_1' && a.role === 'production-png'));
  assert.ok(manifest.files.some((a) => a.name.includes('/driver~3apanel_1/')));
});

test('a missing vehicle variant needs exact staff review whose actor and identity remain bound on restart', async (t) => {
  const revisionId = '44444444-4444-4444-8444-444444444444', atlasRevisionId = '55555555-5555-4555-8555-555555555555';
  const { service, fixture, db, newService } = await setup(t, { sourceApp: 'DesignPro', ownerPath: `designpro/user_${OTHER}/fixture`, tenantKey: `user_${OTHER}`, revisionId });
  const panels = [];
  for (const [index, surfaceKey] of ['driver', 'passenger', 'hood', 'roof', 'front', 'rear'].entries()) {
    const ref = index === 0 ? fixture.input.pieces[0].source : fixture.put(`${surfaceKey}.png`,
      await sharp({ create: { width: 8, height: 8, channels: 3, background: { r: index * 25, g: 10, b: 20 } } }).png().toBuffer());
    panels.push({ surfaceKey, ...ref, sourceMasterHash: fixture.input.master.contentHash });
  }
  const vehicle = { year: '2020', make: ' Chevrolet ', model: 'camaro' };
  await db.query('INSERT INTO public.designpro_revision_sources VALUES($1,$2,$3,$4)', [revisionId, fixture.input.generationId, OTHER,
    JSON.stringify({ callOnePanels: panels, designId: fixture.input.designId, orderId: fixture.input.orderId, vehicle })]);
  await db.query('INSERT INTO public.designpro_flat_atlas_revisions VALUES($1,$2,$3,$4,$5)',
    [atlasRevisionId, fixture.input.generationId, OTHER, fixture.input.master.contentHash, fixture.input.master.storagePath]);
  await assert.rejects(service.registerSource(OWNER, fixture.input), { code: 'panelprofile_template_vehicle_review_required' });
  const review = { reviewId: 'missing-body-style-reviewed', revisionId,
    geometryHash: fixture.input.template.geometryHash, dimensionManifestHash: fixture.input.dimensionManifestHash,
    missingVariantsReviewed: true, reviewedBy: OUTSIDER };
  for (const edit of [
    (value) => { value.revisionId = atlasRevisionId; },
    (value) => { value.geometryHash = 'e'.repeat(64); },
    (value) => { value.dimensionManifestHash = 'f'.repeat(64); },
  ]) {
    const invalid = structuredClone(review); edit(invalid);
    await assert.rejects(service.registerSource(OWNER, { ...fixture.input, templateVehicleReview: invalid }), { code: 'panelprofile_template_vehicle_review_mismatch' });
  }
  const source = await service.registerSource(OWNER, { ...fixture.input, templateVehicleReview: review });
  const stored = (await db.query('SELECT handoff,input_hash FROM public.panelprofile_source_handoffs WHERE id=$1', [source.sourceId])).rows[0];
  assert.equal(stored.handoff.templateVehicleReview.reviewedBy, OWNER, 'the API binds its authenticated reviewer, never the supplied actor');
  assert.equal(stored.handoff.templateVehicleReview.revisionId, revisionId);
  assert.equal(buildPanelProFileOutputHandoff(stored.handoff).inputHash, stored.input_hash);
  const savedSnapshot = (await db.query('SELECT snapshot FROM public.designpro_revision_sources WHERE revision_id=$1', [revisionId])).rows[0].snapshot;
  assert.equal(savedSnapshot.vehicle.bodyStyle, undefined, 'review does not rewrite the immutable source vehicle');
  service.stop(); const recovered = newService();
  const run = await recovered.createRun(OTHER, source), waiting = await drive(recovered, OTHER, run.id, 'waiting');
  assert.equal(waiting.inputHash, source.inputHash);
  assert.equal(waiting.stages.find((stage) => stage.key === 'await_panelpro_preflight_qc').state, 'waiting');
});
