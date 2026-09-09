import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { selectFinalGenerateContentImage, decodeGenerateContentImage, captureImageTurn, replayImageTurn } from '../supabase/functions/_shared/gemini-image-history.mjs';
import { runDurableImageProviderRequest, putImmutableProviderArtifact } from '../supabase/functions/_shared/gemini-provider-cache.mjs';
const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const sharp = require('sharp');
const atlas = require('./flat-first-atlas.cjs');
const audit = require('./inspect-atlas-provider-cache.cjs');
const hash = value => createHash('sha256').update(value).digest('hex');
const identity = { ownerId: '11111111-1111-4111-8111-111111111111', requestId: '22222222-2222-4222-8222-222222222222', generationId: '33333333-3333-4333-8333-333333333333', mode: 'atlas-artboard', attemptKey: 'master:1' };
const outputRequestId = '44444444-4444-4444-8444-444444444444';
const formats = [['png', 'image/png', 'png'], ['jpeg', 'image/jpeg', 'jpg'], ['webp', 'image/webp', 'webp']];
const source = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#439b72' } }).png().toBuffer();
const images = new Map(await Promise.all(formats.map(async ([format, mime]) => [mime, await sharp(source).toFormat(format).toBuffer()])));
const native = mime => ({ candidates: [{ content: { role: 'model', parts: [
  { text: 'PRIVATE_THOUGHT', thought: true, thoughtSignature: 'PRIVATE_SIGNATURE' },
  { inlineData: { mimeType: 'image/png', data: images.get('image/png').toString('base64') }, thought: true },
  { inlineData: { mimeType: mime, data: images.get(mime).toString('base64') }, thoughtSignature: 'OPAQUE_FINAL_SIGNATURE' },
] } }] });

for (const [format, mime, extension] of formats) test(`${format}: native bytes, MIME and signed parts survive; canonical normalization remains PNG`, async () => {
  const payload = native(mime), original = structuredClone(payload);
  const selected = selectFinalGenerateContentImage(payload, 'atlas_artboard');
  const decoded = decodeGenerateContentImage(selected.imagePart.inlineData, 'atlas_artboard');
  assert.equal(decoded.mimeType, mime);
  assert.equal(decoded.extension, extension);
  assert.deepEqual(decoded.bytes, images.get(mime));
  const imageStore = new Map();
  const stored = await captureImageTurn(payload.candidates[0].content, async (inlineData, index) => {
    const bytes = Buffer.from(inlineData.data, 'base64');
    const path = `atlas-panel-history/${outputRequestId}/${index}.${inlineData.mimeType === 'image/png' ? 'png' : extension}`;
    imageStore.set(path, bytes);
    return { storagePath: path, contentHash: hash(bytes) };
  });
  assert.deepEqual(await replayImageTurn(stored, async (path, sha) => {
    const bytes = imageStore.get(path); assert.equal(hash(bytes), sha); return bytes.toString('base64');
  }), original.candidates[0].content);
  assert.deepEqual(payload, original);
  const surfaces = ['driver','passenger','hood','roof','front','rear'].map(surfaceKey => ({ surfaceKey, widthInches: 100, heightInches: 50, bleed: { top: 5, right: 5, bottom: 5, left: 5 } }));
  const normalized = await atlas.normalizeAtlasMaster(decoded.bytes, atlas.buildAtlasManifest(surfaces));
  assert.equal((await sharp(normalized.bytes).metadata()).format, 'png');
  assert.equal(normalized.deliveredWidthPx, 1024);
  assert.equal(normalized.nativelyFourK, false);
});

test('unsupported MIME, mislabeled bytes, truncated images, malformed base64 and thought-only responses are refused', () => {
  const inline = native('image/jpeg').candidates[0].content.parts[2].inlineData;
  for (const wrong of [
    { ...inline, mimeType: 'image/png' },
    { ...inline, mimeType: 'image/svg+xml' },
    { ...inline, mimeType: undefined },
    { ...inline, data: images.get('image/jpeg').subarray(0, -5).toString('base64') },
    { ...inline, data: '!!!!' },
    { ...inline, data: '' },
  ]) assert.throws(() => decodeGenerateContentImage(wrong, 'atlas_artboard'), /atlas_artboard_final_image_(mime|bytes)_invalid/);
  const payload = native('image/jpeg');
  payload.candidates[0].content.parts.pop();
  assert.throws(() => selectFinalGenerateContentImage(payload, 'atlas_artboard'), /atlas_artboard_no_image/);
});

test('a saved JPEG response recovers without another model call and read-only audit verifies it without leaking content', async () => {
  const files = new Map(); let calls = 0, writes = 0;
  const bucket = {
    async upload(path, bytes, options) { assert.equal(options.upsert, false); writes++; if (files.has(path)) return { error: { statusCode: 409, message: 'The resource already exists' } }; files.set(path, Buffer.from(bytes)); return { data: { path } }; },
    async download(path) { return files.has(path) ? { data: new Blob([files.get(path)]) } : { error: { status: 404 } }; },
    async list() { assert.fail('a complete receipt must use the production hash-verified reader'); },
  };
  const options = { bucket, identity, requestHash: 'a'.repeat(64), outputRequestId, privateRequest: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'PRIVATE_PROMPT' }] }] }), authorize: async () => {},
    invoke: async () => { calls++; return { status: 200, payload: native('image/jpeg') }; } };
  const original = await runDurableImageProviderRequest(options);
  // This is the production incident: response is complete, PNG-only selection fails afterward.
  assert.notEqual(original.payload.candidates[0].content.parts[2].inlineData.mimeType, 'image/png');
  const recovered = await runDurableImageProviderRequest({ ...options, cacheOnly: true, invoke: async () => assert.fail('cannot spend again') });
  assert.equal(recovered.providerCacheHit, true); assert.equal(calls, 1);
  const decoded = decodeGenerateContentImage(selectFinalGenerateContentImage(recovered.payload, 'atlas_artboard').imagePart.inlineData, 'atlas_artboard');
  await putImmutableProviderArtifact(bucket, `atlas-call1/${recovered.requestId}.${decoded.extension}`, decoded.bytes, decoded.mimeType);
  assert.deepEqual(files.get(`atlas-call1/${outputRequestId}.jpg`), images.get('image/jpeg'));
  const supabase = { storage: { from: () => bucket }, from() { return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { id: identity.requestId, generation_id: identity.generationId, owner_id: identity.ownerId, state: 'failed' } }; } }; } };
  const before = writes;
  const result = await audit.inspectAtlasProviderCache({ supabase, requestId: identity.requestId, generationId: identity.generationId });
  assert.equal(result.attempts[0].completeEnvelope, true);
  assert.equal(result.attempts[0].completeFinalImage, true);
  assert.equal(result.attempts[0].imageMimeType, 'image/jpeg');
  assert.equal(result.attempts[0].imageSha256, hash(images.get('image/jpeg')));
  assert.equal(result.attempts[0].width, 1024);
  assert.equal(result.writes, 0); assert.equal(writes, before); assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_|OPAQUE_/);
  const chunkPath = [...files.keys()].find(path => path.endsWith('.jsonpart'));
  files.get(chunkPath)[20] ^= 1;
  await assert.rejects(audit.inspectAtlasProviderCache({ supabase, requestId: identity.requestId, generationId: identity.generationId }), { code: 'provider_cache_invalid' });
});
