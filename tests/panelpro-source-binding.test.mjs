import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createPanelProfileTestAdapter, OWNER, OTHER } from './helpers/panelprofile-service-fixture.mjs';
const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const { PGlite } = require('@electric-sql/pglite');
const { verifyDesignProPieceSources, verifyDesignProTemplateVehicle } = require('../runtime/panelpro-source-binding.cjs');
const REVISION = '44444444-4444-4444-8444-444444444444';
const GENERATION = '55555555-5555-4555-8555-555555555555';
const RUN = '66666666-6666-4666-8666-666666666666';
const STAGE = '77777777-7777-4777-8777-777777777777';
const MASTER = 'a'.repeat(64), MANIFEST = 'b'.repeat(64), ENHANCED = 'c'.repeat(64);

function inputs() {
  const panels = ['driver', 'passenger', 'hood', 'roof', 'front', 'rear'].map((surfaceKey, i) => ({
    surfaceKey, storagePath: `designpro/user_${OWNER}/${GENERATION}/flat-first/${surfaceKey}.png`,
    contentHash: String(i + 1).repeat(64), sourceMasterHash: MASTER,
  }));
  const revision = { revision_id: REVISION, generation_id: GENERATION, owner_id: OWNER, snapshot: { callOnePanels: panels } };
  const input = { revisionId: REVISION, generationId: GENERATION, dimensionManifestHash: MANIFEST,
    master: { contentHash: MASTER }, pieces: [{ pieceId: 'driver-door', sourceSurfaceKey: 'driver', source: {
      storagePath: `designpro/user_${OWNER}/${RUN}/enhanced/driver.png`, contentHash: ENHANCED } }] };
  return { input, revision };
}

function vehicleBinding() {
  const { input, revision } = inputs();
  revision.snapshot.vehicle = { year: '2020', make: 'Ford', model: 'F-250', type: 'truck',
    bodyStyle: 'crew cab', wheelbaseInches: 160, roofHeight: 'standard' };
  input.template = { geometryHash: ENHANCED, geometry: { contentHash: ENHANCED } };
  const geometry = { vehicle: { year: '2020', make: 'Ford', model: 'F-250',
    bodyStyle: 'crew cab', wheelbaseInches: 160, roofHeight: 'standard' } };
  return { input, revision, geometry, reviewerId: OWNER, canReview: true };
}

test('vehicle identity matches measured templates without changing the immutable source', () => {
  const args = vehicleBinding(), before = structuredClone(args.revision);
  args.geometry.vehicle.year = 2020;
  args.geometry.vehicle.make = ' FORD ';
  args.geometry.vehicle.wheelbase_in = '160.0';
  delete args.geometry.vehicle.wheelbaseInches;
  const result = verifyDesignProTemplateVehicle(args);
  assert.deepEqual(result.missingSourceVariants, []);
  assert.equal(result.templateVehicleReview, null);
  assert.deepEqual(args.revision, before);
});

test('a different make, model, year or supplied physical variant cannot borrow an approved template', () => {
  for (const [key, value, code] of [
    ['make', 'Buick', 'panelprofile_template_vehicle_mismatch'],
    ['model', 'F-350', 'panelprofile_template_vehicle_mismatch'],
    ['year', '2021', 'panelprofile_template_vehicle_mismatch'],
    ['bodyStyle', 'regular cab', 'panelprofile_template_vehicle_variant_mismatch'],
    ['wheelbaseInches', 176, 'panelprofile_template_vehicle_variant_mismatch'],
    ['roofHeight', 'high', 'panelprofile_template_vehicle_variant_mismatch'],
  ]) {
    const args = vehicleBinding(); args.geometry.vehicle[key] = value;
    assert.throws(() => verifyDesignProTemplateVehicle(args), { code });
  }
});

test('missing template variants and conflicting aliases are never guessed from the source', () => {
  const missing = vehicleBinding(); delete missing.geometry.vehicle.wheelbaseInches;
  assert.throws(() => verifyDesignProTemplateVehicle(missing), { code: 'panelprofile_template_vehicle_variant_missing' });
  const ambiguous = vehicleBinding(); ambiguous.geometry.vehicle.wheelbase_in = 176;
  assert.throws(() => verifyDesignProTemplateVehicle(ambiguous), { code: 'panelprofile_vehicle_variant_alias_conflict' });
  const units = vehicleBinding(); units.geometry.vehicle.wheelbaseInches = '4.064 m';
  assert.throws(() => verifyDesignProTemplateVehicle(units), { code: 'panelprofile_vehicle_identity_invalid' });
});

test('legacy missing variants need an authenticated exact-bound review, with no source mutation', () => {
  const args = vehicleBinding();
  args.revision.snapshot.vehicle = { year: '2020', make: 'Ford', model: 'F-250', type: 'truck' };
  const before = structuredClone(args.revision);
  assert.throws(() => verifyDesignProTemplateVehicle(args), { code: 'panelprofile_template_vehicle_review_required' });
  args.input.templateVehicleReview = { reviewId: 'vehicle-fit-1', revisionId: REVISION, geometryHash: ENHANCED,
    dimensionManifestHash: MANIFEST, missingVariantsReviewed: true, reviewedBy: OTHER };
  const result = verifyDesignProTemplateVehicle(args);
  assert.deepEqual(result.missingSourceVariants, ['bodyStyle', 'wheelbaseInches', 'roofHeight']);
  assert.equal(result.templateVehicleReview.reviewedBy, OWNER, 'the authenticated staff member is the reviewer');
  assert.deepEqual(args.revision, before, 'review never retrofits an inferred variant into old revision history');
  assert.throws(() => verifyDesignProTemplateVehicle({ ...args, canReview: false }), { code: 'panelprofile_qc_permission_required' });
  for (const key of ['revisionId', 'geometryHash', 'dimensionManifestHash']) {
    const stale = structuredClone(args); stale.input.templateVehicleReview[key] = 'f'.repeat(64);
    assert.throws(() => verifyDesignProTemplateVehicle(stale), { code: 'panelprofile_template_vehicle_review_mismatch' });
  }
  const wrongVehicle = structuredClone(args); wrongVehicle.geometry.vehicle.make = 'Buick';
  assert.throws(() => verifyDesignProTemplateVehicle(wrongVehicle), { code: 'panelprofile_template_vehicle_mismatch' }, 'review cannot override a real conflict');
});

test('missing required vehicle identity and unverified geometry cannot be approved by a generic review', () => {
  const missing = vehicleBinding(); delete missing.revision.snapshot.vehicle;
  assert.throws(() => verifyDesignProTemplateVehicle(missing), { code: 'panelprofile_vehicle_identity_required' });
  const args = vehicleBinding(); delete args.revision.snapshot.vehicle.bodyStyle;
  args.input.templateVehicleReview = { reviewId: 'fit-1', revisionId: REVISION, geometryHash: ENHANCED,
    dimensionManifestHash: MANIFEST, missingVariantsReviewed: true };
  args.input.template.geometry.contentHash = 'f'.repeat(64);
  assert.throws(() => verifyDesignProTemplateVehicle(args), { code: 'panelprofile_template_vehicle_review_mismatch' });
  args.input.template.geometry.contentHash = ENHANCED;
  args.input.templateVehicleReview.ignoreMismatches = true;
  assert.throws(() => verifyDesignProTemplateVehicle(args), { code: 'panelprofile_template_vehicle_review_mismatch' });
});

test('exact canonical crops remain admissible without requiring an enhancement run', async () => {
  const { input, revision } = inputs();
  const panel = revision.snapshot.callOnePanels[0];
  input.pieces[0].source = { storagePath: panel.storagePath, contentHash: panel.contentHash };
  const result = await verifyDesignProPieceSources({ input, revision, supabase: { from() { throw new Error('no lookup needed'); } } });
  assert.equal(result.bindings[0].kind, 'canonical-panel');
  assert.equal(result.nativeDetailVerified, false, 'lineage alone never certifies source image detail');
  assert.equal(result.generationId, GENERATION);
});

test('enhancement admission executes owner, revision, manifest and Call12 receipt predicates against PostgreSQL', async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    CREATE TABLE designpro_artifacts(id uuid,run_id uuid,stage_id uuid,artifact_kind text,surface_key text,storage_path text,content_hash text,byte_size bigint,metadata jsonb);
    CREATE TABLE designpro_workflow_runs(id uuid,owner_id uuid,tenant_key text,revision_id uuid,manifest_hash text,workflow_type text);
    CREATE TABLE designpro_stage_receipts(run_id uuid,stage_id uuid,receipt_kind text,identity jsonb,receipt jsonb);
  `);
  const { input, revision } = inputs(), canonical = revision.snapshot.callOnePanels[0];
  const metadata = { sourcePanelHash: canonical.contentHash, brandedPanelHash: canonical.contentHash,
    sourceArtifactKind: 'panel', humanCorrected: false, dpi: 1500 };
  const identity = { workflowRunId: RUN, revisionId: REVISION, manifestHash: MANIFEST };
  const receipt = { verified: true, receiptKind: 'call12.topaz-upscale', call: 12,
    contract: 'designpro.call12-topaz-enhance.v1', enhancedHashes: { driver: ENHANCED }, humanCorrectedSurfaces: [] };
  await db.query('INSERT INTO designpro_artifacts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    ['88888888-8888-4888-8888-888888888888', RUN, STAGE, 'upscaled-panel', 'driver', input.pieces[0].source.storagePath, ENHANCED, 8000, JSON.stringify(metadata)]);
  await db.query('INSERT INTO designpro_workflow_runs VALUES($1,$2,$3,$4,$5,$6)', [RUN, OWNER, `user_${OWNER}`, REVISION, MANIFEST, 'designpro.production_pack']);
  await db.query('INSERT INTO designpro_stage_receipts VALUES($1,$2,$3,$4,$5)', [RUN, STAGE, 'call12.topaz-upscale', JSON.stringify(identity), JSON.stringify(receipt)]);
  const adapter = createPanelProfileTestAdapter(db);
  const verify = (overrides = {}) => verifyDesignProPieceSources({ supabase: adapter.supabase, input, revision, ...overrides });
  const result = await verify();
  assert.equal(result.bindings[0].kind, 'verified-call12-upscaled-panel');
  assert.equal(result.bindings[0].manufacturingRunId, RUN);
  assert.equal(result.generationId, GENERATION);
  assert.notEqual(RUN, GENERATION, 'manufacturing identity is not the GenerationID');
  assert.equal(result.nativeDetailVerified, false, 'even a verified Topaz receipt still needs geometry and human detail checks');
  assert.equal(result.bindings[0].canonicalPanelHash, canonical.contentHash);

  const rejected = [
    ['wrong owner', 'UPDATE designpro_workflow_runs SET owner_id=$1', [OTHER]],
    ['wrong revision', 'UPDATE designpro_workflow_runs SET revision_id=$1', [OTHER]],
    ['wrong GENIE dimensions', 'UPDATE designpro_workflow_runs SET manifest_hash=$1', ['f'.repeat(64)]],
    ['wrong enhancement stage', 'UPDATE designpro_stage_receipts SET stage_id=$1', [OTHER]],
    ['substituted enhanced hash', "UPDATE designpro_stage_receipts SET receipt=jsonb_set(receipt,'{enhancedHashes,driver}',to_jsonb($1::text))", ['f'.repeat(64)]],
    ['wrong canonical source', "UPDATE designpro_artifacts SET metadata=jsonb_set(metadata,'{sourcePanelHash}',to_jsonb($1::text))", ['f'.repeat(64)]],
    ['wrong original brand source', "UPDATE designpro_artifacts SET metadata=jsonb_set(metadata,'{brandedPanelHash}',to_jsonb($1::text))", ['f'.repeat(64)]],
    ['unaccepted human correction', "UPDATE designpro_artifacts SET metadata=metadata||'{\"sourceArtifactKind\":\"corrected-panel\",\"humanCorrected\":true}'::jsonb", []],
    ['mismatched receipt manifest', "UPDATE designpro_stage_receipts SET identity=jsonb_set(identity,'{manifestHash}',to_jsonb($1::text))", ['f'.repeat(64)]],
    ['different surface', 'UPDATE designpro_artifacts SET surface_key=$1', ['passenger']],
    ['no enhancement receipt', 'DELETE FROM designpro_stage_receipts', []],
  ];
  for (const [name, sql, args] of rejected) await t.test(name, async () => {
    await db.exec('BEGIN');
    try {
      await db.query(sql, args);
      await assert.rejects(verify(), error => /^panelprofile_(?:enhanced_source|canonical_panel)/.test(error.code) && error.retryable === false);
    } finally { await db.exec('ROLLBACK'); }
  });
  await t.test('a large arbitrary same-owner image has no special admission', async () => {
    const modified = structuredClone(input);
    modified.pieces[0].source.storagePath = `designpro/user_${OWNER}/arbitrary-1500dpi.png`;
    await assert.rejects(verify({ input: modified }), { code: 'panelprofile_enhanced_source_not_verified', retryable: false });
  });
  await t.test('an unrelated generation cannot borrow this revision', async () => {
    await assert.rejects(verify({ input: { ...input, generationId: OTHER } }), { code: 'panelprofile_canonical_panel_mismatch', retryable: false });
  });
  await t.test('a database outage remains recoverable without admitting the source', async () => {
    const unavailable = { from() { return { select() { return this; }, eq() { return this; }, in() { return this; },
      limit: async () => ({ data: null, error: { message: 'temporary outage' } }) }; } };
    await assert.rejects(verify({ supabase: unavailable }), { code: 'panelprofile_source_binding_lookup_failed', retryable: true });
  });
});
