import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Decision-policy integration tests, not visual or native-codec acceptance.
// Execute the actual validator with a controlled inspector response. Image
// metadata is read from a fixed PNG fixture; no image/provider is generated.
const url = new URL('../runtime/atlas-proof-qc.cjs', import.meta.url);
const filename = fileURLToPath(url);
const realRequire = createRequire(url);
const module = { exports: {} };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jAZsAAAAASUVORK5CYII=', 'base64');
const hash = createHash('sha256').update(png).digest('hex');
const metadataOnly = bytes => ({ metadata: async () => {
  assert.ok(bytes.equals(png), 'only the fixed fixture reaches the metadata stub');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
} });
runInNewContext(readFileSync(url, 'utf8'), {
  module, exports: module.exports, Buffer, console, process,
  require: id => id === 'sharp' ? metadataOnly : realRequire(id),
}, { filename });
const { createAtlasProofValidator } = module.exports;
const atlas = Object.freeze({
  master: Object.freeze({ contentHash: hash }),
  projection: Object.freeze({ bytes: png, contentType: 'image/png', contentHash: hash }),
  viewAuthorities: Object.freeze({ side: Object.freeze({
    contract: 'designpro.flat-first-atlas-view-authority.v1', sourceViewType: 'side',
    surfaceKey: 'driver', sourceMasterHash: hash, bytes: png,
    contentType: 'image/png', contentHash: hash,
  }) }),
});
const baseReview = Object.freeze({
  contract: 'designpro.atlas-proof-semantic-qc.v1', proofSha256: hash,
  atlasSha256: hash, authoritySha256: hash, expectedView: 'Driver', observedView: 'Driver',
  cameraContract: 'pass', framingContract: 'pass', orientationContract: 'pass',
  roofBoundaryContract: 'not_applicable', photorealismContract: 'pass',
  studioLightingContract: 'pass', atlasContinuityContract: 'pass',
  vehicleContinuityContract: 'pass', artifactFreeContract: 'pass',
  confidence: 0.99, reasons: [],
});
function harness(patch = {}, artifact = atlas) {
  let reviewCalls = 0;
  const provider = { generateRaw: async () => {
    reviewCalls += 1;
    return { payload: { candidates: [{ finishReason: 'STOP', content: {
      parts: [{ text: JSON.stringify({ ...baseReview, ...patch }) }],
    } }] } };
  } };
  const validate = createAtlasProofValidator({ provider, atlas: artifact,
    input: { vehicle: { make: 'GMC', model: 'Sierra', type: 'truck' } } });
  return { validate: () => validate({ bytes: png, contentType: 'image/png', sourceViewType: 'side' }),
    calls: () => reviewCalls };
}
const findings = [
  ['none', {}],
  ['wrong view', { observedView: 'Passenger' }],
  ['camera failure', { cameraContract: 'fail' }],
  ['framing failure', { framingContract: 'fail' }],
  ['orientation failure', { orientationContract: 'fail' }],
  ['roof-boundary failure', { roofBoundaryContract: 'fail' }],
  ['vehicle failure', { vehicleContinuityContract: 'fail' }],
  ['lighting failure', { studioLightingContract: 'fail' }],
];
for (const continuity of ['pass', 'uncertain', 'fail']) {
  for (const [name, finding] of findings) {
    test(`continuity ${continuity} with ${name}: existing blocking policy is preserved`, async () => {
      const run = harness({ ...finding, atlasContinuityContract: continuity });
      const result = await run.validate();
      const blocked = continuity === 'fail';
      assert.equal(result.accepted, !blocked);
      assert.equal(run.calls(), 1, 'one inspection, never a render');
      if (blocked) {
        assert.equal(result.code, 'atlas_qc_design_drift');
        assert.equal(result.metadata.semanticCode, 'atlas_qc_design_drift');
        assert.equal(result.metadata.semanticDisposition, 'blocked');
        assert.equal(result.metadata.continuityAttempt, 1);
        assert.equal(result.terminal, false);
        assert.match(result.correction, /atlas_qc_design_drift/);
        assert.equal(result.review.atlasContinuityContract, 'fail');
        for (const [field, value] of Object.entries(finding)) assert.equal(result.review[field], value);
      } else {
        assert.equal(result.code, null);
        assert.equal(result.metadata.semanticDisposition,
          continuity === 'pass' && name === 'none' ? 'pass' : 'review_required');
      }
      assert.equal(result.metadata.authorityHash, hash);
      assert.equal(result.metadata.proofHash, hash);
    });
  }
}
test('coexisting camera failure does not reset the two-verdict continuity budget', async () => {
  const run = harness({ atlasContinuityContract: 'fail', cameraContract: 'fail' });
  const first = await run.validate(), second = await run.validate();
  assert.equal(first.accepted, false);
  assert.equal(first.terminal, false);
  assert.equal(second.accepted, false);
  assert.equal(second.terminal, true);
  assert.equal(second.metadata.continuityAttempt, 2);
  assert.equal(run.calls(), 2);
});
test('broken source identity is still rejected before any optional inspection', async () => {
  const run = harness({}, { ...atlas, master: { contentHash: 'a'.repeat(64) } });
  const result = await run.validate();
  assert.equal(result.accepted, false);
  assert.equal(result.structuralInvalid, true);
  assert.equal(result.code, 'atlas_qc_view_authority_invalid');
  assert.equal(run.calls(), 0);
});
