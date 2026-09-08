import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { buildPanelProFileOutputHandoff: build, panelProFileOutputGraph: graph, SOURCE_APPS } = require('../runtime/panelpro-file-output-contract.cjs');
const asset = (name) => ({ storagePath: 'private/revision-1/' + name, contentHash: 'a'.repeat(64) });
function input(sourceApp = 'DesignPro') {
  return {
    sourceApp, tenantKey: 'tenant-1', sourceJobId: 'job-1', generationId: 'generation-1',
    designId: 'DID-12345678', orderId: 'order-1', revisionId: 'revision-1',
    master: asset('master.png'), dimensionManifestHash: 'b'.repeat(64), printableWidthInches: 59.5,
    template: { templateId: 'vehicle-1', version: 'v1', profileHash: 'c'.repeat(64), geometryHash: 'd'.repeat(64),
      display: asset('branded-template.png'), displayOrigin: 'generated-branded', geometryValidated: true, cutAreasReviewed: true },
    availableAssets: [{ assetId: 'logo', kind: 'vector', separable: true, ...asset('logo.pdf') }],
    pieces: [{ pieceId: 'driver', sourceSurfaceKey: 'driver', source: asset('driver.png'), widthInches: 159, heightInches: 48,
      protectedElements: [{ elementId: 'logo-1', assetId: 'logo', canTranslate: true, boundsInches: { x: 1, y: 2, width: 3, height: 4 } }],
      cutAreas: [{ areaId: 'wheel', pointsInches: [[0, 40], [20, 40], [20, 48], [0, 48]] }],
    }],
  };
}

test('all four source apps use the same boundary without reminting existing identity', () => {
  for (const sourceApp of SOURCE_APPS) {
    const request = build(input(sourceApp));
    assert.equal(request.sourceApp, sourceApp);
    assert.equal(request.generationId, 'generation-1');
    assert.equal(request.designId, 'DID-12345678');
    assert.equal(request.orderId, 'order-1');
    assert.equal(request.revisionId, 'revision-1');
    assert.equal(request.outputPolicy.approval, 'existing-human-qc');
    assert.equal(request.outputPolicy.releaseToCustomer, false);
  }
});

test('input identity is repeatable and changes with geometry, masks, assets or revision', () => {
  const base = input();
  const before = JSON.stringify(base);
  const initial = build(base);
  assert.equal(initial.inputHash, build(structuredClone(base)).inputHash);
  assert.equal(JSON.stringify(base), before, 'building the handoff must not mutate source state');
  for (const edit of [
    (x) => { x.revisionId = 'revision-2'; },
    (x) => { x.pieces[0].heightInches++; },
    (x) => { x.pieces[0].cutAreas[0].pointsInches[0][0]++; },
    (x) => { x.availableAssets[0].contentHash = 'e'.repeat(64); },
  ]) {
    const changed = structuredClone(base); edit(changed);
    assert.notEqual(build(changed).inputHash, initial.inputHash);
  }
});

test('physical pieces are distinct from canonical surfaces and include five inches on each edge', () => {
  const data = input();
  data.pieces.push({ ...structuredClone(data.pieces[0]), pieceId: 'trunk', sourceSurfaceKey: 'rear', widthInches: 52, heightInches: 30 });
  const request = build(data);
  assert.deepEqual(request.pieces.map((p) => [p.pieceId, p.outputWidthInches, p.outputHeightInches]), [['driver', 169, 58], ['trunk', 62, 40]]);
  assert.equal(request.outputPolicy.cutMaskPurpose, 'placement-and-review-only');
  assert.equal(request.outputPolicy.continuousRectangularArtwork, true);
});

test('baked artwork does not acquire permission to move as an independent asset', () => {
  const data = input(); data.availableAssets[0].separable = false;
  const request = build(data);
  assert.equal(request.pieces[0].protectedElements[0].canTranslate, false);
  assert.equal(request.outputPolicy.allowBackgroundFabrication, false);
  assert.equal(request.outputPolicy.allowCreativeRegeneration, false);
  assert.equal(request.outputPolicy.allowImplicitMirroring, false);
});

test('unvalidated display geometry, missing protected assets and invalid dimensions block the handoff', () => {
  for (const [edit, code] of [
    [(x) => { x.template.geometryValidated = false; }, 'panelprofile_template_validation_required'],
    [(x) => { x.template.displayOrigin = 'private-original'; }, 'panelprofile_branded_template_required'],
    [(x) => { x.availableAssets = []; }, 'panelprofile_protected_asset_missing'],
    [(x) => { x.pieces[0].widthInches = NaN; }, 'panelprofile_dimension_invalid'],
    [(x) => { x.master.storagePath = 'https://example.test/signed.png'; }, 'panelprofile_storage_identity_invalid'],
    [(x) => { x.pieces[0].cutAreas = undefined; }, 'panelprofile_coverage_review_required'],
  ]) {
    const data = input(); edit(data); assert.throws(() => build(data), { code });
  }
});

test('a cache miss waits for template validation/banking while a hit avoids recreation', () => {
  const miss = graph(); const hit = graph({ validatedTemplateCacheHit: true });
  assert.deepEqual(miss.find((n) => n.key === 'panelprofileoutput.fit').dependsOn, ['source.verify', 'template.bank']);
  assert.deepEqual(hit.find((n) => n.key === 'panelprofileoutput.fit').dependsOn, ['source.verify', 'template.lookup']);
  assert.equal(hit.some((n) => n.key === 'template.recreate'), false);
  const external = new Set(['manifest.resolve', 'source.verify']);
  for (const nodes of [miss, hit]) {
    const seen = new Set(external);
    for (const node of nodes) {
      assert.equal(node.dependsOn.every((key) => seen.has(key)), true, 'each prerequisite must precede its consumer');
      assert.equal(node.dependsOn.includes('proof.build'), false, 'template preparation does not wait for presentation proofs');
      seen.add(node.key);
    }
    assert.equal(nodes.at(-1).key, 'await_panelpro_preflight_qc');
  }
});

test('vehicle variant review is preserved and hashed as exact revision and geometry evidence', () => {
  const data = input();
  data.templateVehicleReview = { reviewId: 'vehicle-review-1', revisionId: data.revisionId,
    geometryHash: data.template.geometryHash, dimensionManifestHash: data.dimensionManifestHash,
    missingVariantsReviewed: true, reviewedBy: '11111111-1111-4111-8111-111111111111' };
  const request = build(data);
  assert.deepEqual(request.templateVehicleReview, data.templateVehicleReview);
  assert.deepEqual(build(JSON.parse(JSON.stringify(request))), request);
  const changed = structuredClone(data); changed.templateVehicleReview.reviewId = 'vehicle-review-2';
  assert.notEqual(build(changed).inputHash, request.inputHash);
  for (const mutate of [
    (review) => { review.missingVariantsReviewed = false; },
    (review) => { review.reviewedBy = 'unverified-actor'; },
    (review) => { review.unhashedExtra = 'silently-ignored-review'; },
  ]) {
    const invalid = structuredClone(data); mutate(invalid.templateVehicleReview);
    assert.throws(() => build(invalid), { code: 'panelprofile_template_vehicle_review_invalid' });
  }
});

test('the supported tenth-scale export is explicit and unsupported scales cannot silently change printing size', () => {
  const data = input(); data.outputScale = 0.1;
  assert.equal(build(data).outputPolicy.outputScale, 0.1);
  for (const scale of [1, 0.5, 0.05]) {
    data.outputScale = scale;
    assert.throws(() => build(data), { code: 'panelprofile_output_scale_unsupported' });
  }
});

test('existing business order labels retain spaces, hash and slash without broadening other identity fields', () => {
  const data = input(); data.orderId = 'ORDER / 2026 #42';
  const request = build(data);
  assert.equal(request.orderId, 'ORDER / 2026 #42');
  assert.deepEqual(build(JSON.parse(JSON.stringify(request))), request);
  for (const orderId of ['ORDER\n42', 'ORDER\t42', ' ORDER / 2026 #42', 'ORDER / 2026 #42 ', 'x'.repeat(121)]) {
    assert.throws(() => build({ ...data, orderId }), { code: 'panelprofile_order_identity_invalid' });
  }
  assert.throws(() => build({ ...data, designId: data.orderId }), { code: 'panelprofile_identity_invalid' });
  assert.throws(() => build({ ...data, revisionId: data.orderId }), { code: 'panelprofile_identity_invalid' });
});
