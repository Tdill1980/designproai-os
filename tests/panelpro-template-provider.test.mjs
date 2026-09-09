import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { recreateBrandedTemplateCandidate, approveAndBankTemplateCandidate } = require('../runtime/panelpro-template-provider.cjs');
const sharp = require('../runtime/node_modules/sharp');
const ownerId = '11111111-1111-4111-8111-111111111111';
const requestId = '22222222-2222-4222-8222-222222222222';
const generationId = '33333333-3333-4333-8333-333333333333';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const piece = {
  pieceId: 'driver', widthInches: 20, heightInches: 10,
  outlineInches: [[0, 0], [20, 0], [20, 10], [0, 10]],
  cutAreas: [{ areaId: 'window', pointsInches: [[6, 2], [10, 2], [10, 5], [6, 5]] }],
};
async function fixture() {
  const files = new Map(), bank = new Map(), calls = [];
  const write = (bytes, role = 'input') => {
    const contentHash = sha(bytes), storagePath = `designpro/user_${ownerId}/${requestId}/${role}-${contentHash}.dat`;
    files.set(storagePath, bytes);
    return { storagePath, contentHash };
  };
  const png = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#ededed' } }).png().toBuffer();
  const logo = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#0066cc' } }).png().toBuffer();
  const geometry = { contractVersion: 'designpro.vehicle-template-geometry.v1', units: 'in', templateId: 'camaro', version: '1',
    vehicle: { make: 'Chevrolet', model: 'Camaro', year: '2020', bodyStyle: 'coupe' }, pieces: [structuredClone(piece)] };
  const geometryRef = write(Buffer.from(JSON.stringify(geometry)), 'geometry');
  const input = { ownerId, requestId, generationId, templateId: 'camaro', version: '1', enabled: true,
    geometry: geometryRef, geometryReview: { reviewId: 'geometry-review-1' }, sourceRaster: write(png, 'source'), brand: write(logo, 'brand') };
  const bucket = {
    async upload(path, bytes, options) {
      assert.equal(options.upsert, false);
      if (files.has(path)) return { error: { statusCode: 400, message: 'The resource already exists' } };
      files.set(path, Buffer.from(bytes)); return { error: null };
    },
    async download(path) { return files.has(path) ? { data: new Blob([files.get(path)]), error: null }
      : { data: null, error: { statusCode: 404 } }; },
  };
  const deps = {
    readBytes: async (ref) => { assert.ok(files.has(ref.storagePath)); return files.get(ref.storagePath); },
    authorize: async ({ ownerId: owner }) => {
      assert.equal(owner, ownerId);
      return { canReview: true, reviewerId: ownerId };
    },
    resolveGeometryReview: async () => ({ ownerId, reviewId: 'geometry-review-1', geometryHash: geometryRef.contentHash, geometryValidated: true, cutAreasReviewed: true }),
    providerCacheBucket: bucket,
    invoke: async (request) => {
      calls.push(request);
      return { status: 200, payload: { id: 'v1_template', model: 'gemini-3-pro-image', status: 'completed', steps: [
        { type: 'thought', signature: 'private-signature' },
        { type: 'model_output', content: [{ type: 'image', mime_type: 'image/png', data: png.toString('base64') }] },
      ] } };
    },
    persist: async (bytes, artifact) => {
      assert.equal(artifact.contentHash, sha(bytes));
      return write(bytes, artifact.role);
    },
    lookupValidatedTemplate: async ({ cacheKey }) => bank.get(cacheKey),
    bankTemplate: async (entry) => { bank.set(entry.cacheKey, entry); },
  };
  return { input, deps, files, bank, calls, write, geometry };
}
function reviewOf(candidate) {
  return { reviewId: 'display-review-1', approved: true, displayContentHash: candidate.display.contentHash,
    geometryHash: candidate.sourceGeometry.contentHash, cutGeometryReviewed: true, displayAlignmentReviewed: true,
    displayRegions: [{ pieceId: 'driver', displayRegionPixels: { x: 0, y: candidate.displayMetadata.headerHeight, width: 200, height: 100 } }] };
}

test('Gemini display creation and deterministic original branding stop at operator review', async () => {
  const f = await fixture();
  const candidate = await recreateBrandedTemplateCandidate(f.input, f.deps);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].model, 'gemini-3-pro-image');
  assert.equal(f.calls[0].response_format.image_size, '4K');
  assert.equal(candidate.status, 'requires_geometry_overlay_review');
  assert.equal(candidate.customerVisible, false);
  assert.equal(candidate.geometryValidated, false);
  assert.equal(candidate.releaseToCustomer, false);
  assert.deepEqual(candidate.geometry.pieces[0], piece);
  assert.equal(f.bank.size, 0);
  const meta = await sharp(f.files.get(candidate.display.storagePath)).metadata();
  assert.equal(meta.width, 200);
  assert.equal(meta.height, 100 + candidate.displayMetadata.headerHeight);
});

test('operator reviewed regions create renderer-compatible measured geometry with source provenance', async () => {
  const f = await fixture();
  const candidate = await recreateBrandedTemplateCandidate(f.input, f.deps);
  const bank = await approveAndBankTemplateCandidate({ ownerId, candidateRef: candidate.candidateRef, review: reviewOf(candidate) }, f.deps);
  assert.equal(bank.status, 'validated');
  assert.equal(bank.template.displayOrigin, 'generated-branded');
  assert.equal(bank.template.geometryHash, bank.template.geometry.contentHash);
  const geometry = JSON.parse(f.files.get(bank.template.geometry.storagePath));
  assert.equal(geometry.contractVersion, 'designpro.panelpro-file-output-geometry.v1');
  assert.equal(geometry.displayContentHash, candidate.display.contentHash);
  assert.equal(geometry.provenance.sourceGeometryHash, f.input.geometry.contentHash);
  const { displayRegionPixels, ...storedPiece } = geometry.pieces[0];
  assert.deepEqual(storedPiece, piece);
  assert.deepEqual(displayRegionPixels, reviewOf(candidate).displayRegions[0].displayRegionPixels);
});

test('bank hit performs no model request and durable candidate retries reuse the first image', async () => {
  const f = await fixture();
  const candidate = await recreateBrandedTemplateCandidate(f.input, f.deps);
  const retry = await recreateBrandedTemplateCandidate(f.input, f.deps);
  assert.equal(f.calls.length, 1);
  assert.equal(retry.providerImageRequestCount, 0);
  assert.deepEqual(retry.display, candidate.display);
  await approveAndBankTemplateCandidate({ ownerId, candidateRef: candidate.candidateRef, review: reviewOf(candidate) }, f.deps);
  const reused = await recreateBrandedTemplateCandidate(f.input, { ...f.deps, invoke: async () => assert.fail('banked display must be reused') });
  assert.equal(reused.cacheHit, true);
  assert.equal(reused.providerImageRequestCount, 0);
});

test('unreviewed or tampered geometry cannot reach Gemini', async () => {
  const f = await fixture();
  await assert.rejects(recreateBrandedTemplateCandidate(f.input, { ...f.deps, resolveGeometryReview: async () => null }), { code: 'template_geometry_review_required' });
  f.files.set(f.input.geometry.storagePath, Buffer.from('changed geometry'));
  await assert.rejects(recreateBrandedTemplateCandidate(f.input, f.deps), { code: 'template_source_hash_mismatch' });
  assert.equal(f.calls.length, 0);
});

test('PDF/EPS sources need a reviewed raster derivative instead of an assumed bitmap conversion', async () => {
  const f = await fixture();
  const input = { ...f.input, sourceRaster: f.write(Buffer.from('%PDF-1.7 source vector')) };
  await assert.rejects(recreateBrandedTemplateCandidate(input, f.deps), { code: 'template_reviewed_raster_derivative_required' });
  assert.equal(f.calls.length, 0);
});

test('invalid self-crossing installation polygons are rejected before display generation', async () => {
  const f = await fixture();
  f.geometry.pieces[0].cutAreas[0].pointsInches = [[1, 1], [8, 8], [1, 8], [8, 1]];
  const geometryRef = f.write(Buffer.from(JSON.stringify(f.geometry)), 'bad-geometry');
  await assert.rejects(recreateBrandedTemplateCandidate({ ...f.input, geometry: geometryRef }, f.deps), { code: 'template_geometry_polygon_invalid' });
  assert.equal(f.calls.length, 0);
});

test('approval requires a real reviewer and regions bound to this display and geometry', async () => {
  const f = await fixture();
  const candidate = await recreateBrandedTemplateCandidate(f.input, f.deps);
  const base = { ownerId, candidateRef: candidate.candidateRef, review: reviewOf(candidate) };
  await assert.rejects(approveAndBankTemplateCandidate(base, { ...f.deps, authorize: async () => ({ canReview: false }) }), { code: 'template_review_permission_required' });
  await assert.rejects(approveAndBankTemplateCandidate({ ...base, review: { ...base.review, geometryHash: 'b'.repeat(64) } }, f.deps), { code: 'template_display_review_required' });
  await assert.rejects(approveAndBankTemplateCandidate({ ...base, review: { ...base.review, displayRegions: [] } }, f.deps), { code: 'template_display_regions_required' });
  await assert.rejects(approveAndBankTemplateCandidate({ ...base, review: { ...base.review,
    displayRegions: [{ pieceId: 'driver', displayRegionPixels: { x: 0, y: 0, width: 200, height: 100 } }] } }, f.deps), { code: 'template_display_region_invalid' });
  assert.equal(f.bank.size, 0);
});
