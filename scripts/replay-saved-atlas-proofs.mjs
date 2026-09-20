// Offline replay of the hash-verified final-image export. Native envelopes and
// semantic reviewer responses are not included in this export; do not invent
// either, contact a provider, or publish an acceptance result to production.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, extname, sep } from 'node:path';
import { finalAtlasProofImage } from '../supabase/functions/_shared/atlas-proof-provider.mjs';

const require = createRequire(import.meta.url);
const { createAtlasProofValidator } = require('../runtime/atlas-proof-qc.cjs');
const sharp = createRequire(new URL('../runtime/package.json', import.meta.url))('sharp');
const [directory, generationId] = process.argv.slice(2);
assert.ok(directory && generationId, 'usage: node scripts/replay-saved-atlas-proofs.mjs EXPORT_DIR GENERATION_ID');
globalThis.fetch = () => { throw new Error('offline replay cannot access the network'); };
const root = resolve(directory);
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.generationId, generationId);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = file => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[extname(file)];
function verified(entry) {
  assert.ok(entry?.file, 'required exported artifact missing');
  const path = resolve(root, entry.file);
  assert.ok(path.startsWith(root + sep), 'export path escapes directory');
  const bytes = readFileSync(path);
  assert.equal(hash(bytes), entry.recordedHash || entry.contentHash, `hash mismatch: ${entry.file}`);
  return { bytes, contentType: mime(entry.file), contentHash: hash(bytes) };
}
const master = verified(manifest.files.find(f => f.role === 'canonical-flattened-master'));
assert.equal(master.contentHash, manifest.canonicalMasterHash);
const atlas = {
  master,
  projection: verified(manifest.files.find(f => f.role === 'proof-conditioning-projection')),
  metadata: { panelSourceHash: manifest.panelSourceHash },
  viewAuthorities: {},
};
const surfaces = { side: 'driver', 'passenger-side': 'passenger', hood_detail: 'hood', roof: 'roof', front: 'front', rear: 'rear', 'close-up': 'driver' };
const proofs = manifest.files.filter(f => f.role === 'cached-final-image-NOT-accepted-proof');
assert.equal(proofs.length, 7, 'exactly seven exported final images required');
assert.deepEqual(proofs.map(p => p.sourceViewType).sort(), Object.keys(surfaces).sort());
for (const [shot, surface] of Object.entries(surfaces)) {
  const panel = manifest.files.find(f => f.role === 'call1-surface-panel' && f.surfaceKey === surface);
  assert.equal(panel?.sourceMasterHash, manifest.panelSourceHash);
  atlas.viewAuthorities[shot] = { ...verified(panel), contract: 'designpro.flat-first-atlas-view-authority.v1',
    sourceViewType: shot, surfaceKey: surface, sourceMasterHash: panel.sourceMasterHash };
}
// The production validator explicitly reports absent semantic review as
// unavailable after its blocking image/lineage checks. Never label that review
// as passed. This replay proves intake and deterministic acceptance only.
const validate = createAtlasProofValidator({ atlas });
console.log(`Generation: ${generationId}`);
console.log('Replay source: exported final-image bytes; native response envelopes not included');
let accepted = 0;
for (const proof of proofs) {
  const saved = verified(proof);
  // Reconstruct only the image field to exercise the production intake parser.
  const parsed = finalAtlasProofImage({ candidates: [{ content: { parts: [{
    inlineData: { data: saved.bytes.toString('base64'), mimeType: saved.contentType },
  }] } }] });
  assert.deepEqual(parsed.bytes, saved.bytes);
  // Decode the full image, beyond header-only dimension inspection.
  const { info } = await sharp(parsed.bytes, { failOn: 'error' }).raw().toBuffer({ resolveWithObject: true });
  const verdict = await validate({ ...parsed, sourceViewType: proof.sourceViewType });
  assert.equal(verdict.accepted, true, `${proof.sourceViewType}: ${verdict.code}`);
  assert.equal(verdict.metadata.semanticDisposition, 'unavailable');
  assert.equal(verdict.metadata.proofHash, saved.contentHash);
  accepted++;
  console.log(`PASS ${proof.sourceViewType}: ${info.width}x${info.height} ${parsed.contentType}; hash and lineage verified`);
}
console.log(`Offline intake/structural acceptance: ${accepted}/7`);
console.log('Semantic/visual acceptance: NOT REPLAYED (no saved reviewer responses)');
console.log('Remote generation calls: 0; production writes: 0');
