import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { buildPanelProFileOutputPlan } = createRequire(import.meta.url)('../runtime/panelpro-file-output-plan.cjs');
const ref = (name, c = 'a') => ({ storagePath: `tenant/job/${name}`, contentHash: c.repeat(64) });
function input() {
  return {
    sourceApp: 'DesignPro', tenantKey: 'tenant', sourceJobId: 'job', generationId: 'generation', designId: 'design', orderId: 'order', revisionId: 'revision-7',
    master: ref('master.png'), dimensionManifestHash: 'b'.repeat(64), printableWidthInches: 59.5, protectedClearanceInches: 0.5,
    template: { templateId: 'vehicle', version: '1', profileHash: 'c'.repeat(64), geometryHash: 'd'.repeat(64), display: ref('branded.png'),
      displayOrigin: 'generated-branded', geometryValidated: true, cutAreasReviewed: true },
    availableAssets: [{ assetId: 'original-logo', kind: 'vector', separable: true, ...ref('logo.svg') }],
    pieces: [{ pieceId: 'driver-piece-1', sourceSurfaceKey: 'driver', source: ref('driver.png'), widthInches: 100, heightInches: 40,
      composition: { background: ref('background.png'), layerSeparationVerified: true },
      protectedElements: [{ elementId: 'logo-1', assetId: 'original-logo', boundsInches: { x: 40, y: 10, width: 10, height: 5 }, canTranslate: true }],
      cutAreas: [{ areaId: 'install-cut', pointsInches: [[35, 0], [45, 0], [45, 30], [35, 30]] }] }],
  };
}

test('the planner moves an existing asset beyond a cut while preserving identity, size and orientation', () => {
  const request = input(), before = structuredClone(request);
  const plan = buildPanelProFileOutputPlan(request), piece = plan.pieces[0], logo = piece.placements[0];
  assert.equal(plan.status, 'ready_for_human_review');
  assert.equal(logo.moved, true);
  assert.ok(logo.after.x > 45.5, 'the complete logo and clearance must be beyond the cut');
  assert.equal(logo.assetId, 'original-logo');
  assert.equal(logo.after.width, 10);
  assert.equal(logo.after.height, 5);
  assert.equal(logo.transform.scale, 1);
  assert.equal(logo.transform.rotationDegrees, 0);
  assert.equal(logo.transform.mirror, false);
  assert.equal(plan.revisionId, 'revision-7');
  assert.equal(plan.qcApproved, false);
  assert.equal(plan.productionFilesCreated, false);
  assert.deepEqual(buildPanelProFileOutputPlan(request), plan, 'same measured inputs give the same placement');
  assert.deepEqual(request, before, 'planning never changes source assets or identity');
});

test('separable assets cannot be moved over an unverified baked background', () => {
  const request = input();
  request.pieces[0].composition.layerSeparationVerified = false;
  const plan = buildPanelProFileOutputPlan(request);
  assert.equal(plan.status, 'requires_human_correction');
  assert.equal(plan.pieces[0].placements[0].moved, false);
  assert.equal(plan.pieces[0].blockers[0].code, 'protected_art_requires_layer_separation');
  request.pieces[0].composition.layerSeparationVerified = true;
  request.availableAssets[0].separable = false;
  assert.equal(buildPanelProFileOutputPlan(request).status, 'requires_human_correction');
});

test('safe baked artwork stays where it is and never requires invented replacement pixels', () => {
  const request = input();
  request.pieces[0].composition = null;
  request.pieces[0].protectedElements[0].boundsInches.x = 70;
  request.availableAssets[0].separable = false;
  const plan = buildPanelProFileOutputPlan(request);
  assert.equal(plan.status, 'ready_for_human_review');
  assert.equal(plan.pieces[0].placements[0].moved, false);
});

test('a full-size asset that cannot fit is blocked rather than shrunk or clipped', () => {
  const request = input();
  request.pieces[0].protectedElements[0].boundsInches.width = 101;
  const piece = buildPanelProFileOutputPlan(request).pieces[0];
  assert.equal(piece.placementStatus, 'requires_human_correction');
  assert.equal(piece.placements[0].after.width, 101);
  assert.ok(piece.blockers.some((b) => b.code === 'protected_art_has_no_safe_candidate'));
});

test('intersecting cut edges are detected even when no cut vertex lies inside the logo', () => {
  const request = input();
  request.pieces[0].cutAreas[0].pointsInches = [[0, 11], [100, 11], [100, 12], [0, 12]];
  const logo = buildPanelProFileOutputPlan(request).pieces[0].placements[0];
  assert.equal(logo.moved, true);
  assert.ok(logo.after.y > 12.5 || logo.after.y + logo.after.height < 10.5);
});

test('invalid mask geometry or an absent clearance profile cannot pass by model assertion', () => {
  const request = input();
  request.pieces[0].cutAreas[0].pointsInches = [[10, 10], [30, 30], [10, 30], [30, 10]];
  assert.equal(buildPanelProFileOutputPlan(request).pieces[0].blockers[0].code, 'cut_polygon_invalid');
  request.pieces[0].cutAreas = [];
  delete request.protectedClearanceInches;
  assert.equal(buildPanelProFileOutputPlan(request).pieces[0].blockers[0].code, 'clearance_profile_required');
});

test('five-inch bleed, print pixels, drawing scale and roll fit remain distinct', () => {
  const request = input();
  const standard = buildPanelProFileOutputPlan(request).pieces[0].output;
  assert.equal(standard.widthInches, 110);
  assert.equal(standard.heightInches, 50);
  assert.equal(standard.targetPixelWidth, 16500);
  assert.equal(standard.targetPixelHeight, 7500);
  assert.equal(standard.drawingScale, 0.1);
  assert.equal(standard.drawingPpi, 1500);
  assert.equal(standard.rollRotationDegrees, 90, 'page feed rotation does not mirror the artwork');
  assert.equal(standard.sourceResolutionVerification, 'required', 'target pixels alone do not prove source detail');
  request.pieces[0].widthInches = 64;
  request.pieces[0].heightInches = 53;
  const hood = buildPanelProFileOutputPlan(request).pieces[0];
  assert.equal(hood.output.widthInches, 74);
  assert.equal(hood.output.heightInches, 63);
  assert.ok(hood.blockers.some((b) => b.code === 'physical_panel_split_required'));
});
