import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setImmediate } from 'node:timers/promises';
import {
  GEMINI_PROVIDER_CACHE_CONTRACT, providerSha256, runDurableImageProviderRequest,
} from '../supabase/functions/_shared/gemini-provider-cache.mjs';

const MIB = 1024 * 1024;
const identity = {
  ownerId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  generationId: '33333333-3333-4333-8333-333333333333',
  mode: 'atlas-artboard', attemptKey: 'master:1',
};
const requestHash = 'a'.repeat(64);
const outputRequestId = '44444444-4444-4444-8444-444444444444';
const digest = value => createHash('sha256').update(value).digest('hex');

function fixture({ retainChunks = true } = {}) {
  const files = new Map();
  const writes = [];
  return {
    files, writes,
    async upload(path, bytes, options) {
      assert.equal(options.upsert, false);
      assert.equal(options.contentType, 'application/json');
      writes.push({ path, byteSize: bytes.length });
      if (files.has(path)) return { error: { statusCode: 409 } };
      if (retainChunks || !path.endsWith('.jsonpart')) files.set(path, Buffer.from(bytes));
      return { data: { path }, error: null };
    },
    async download(path) {
      return files.has(path) ? { data: new Blob([files.get(path)]), error: null }
        : { data: null, error: { statusCode: 404 } };
    },
  };
}

const options = (bucket, invoke, overrides = {}) => ({
  bucket, identity, requestHash, outputRequestId, authorize: async () => {}, invoke, ...overrides,
});

function exchange(bucket) {
  const path = [...bucket.files.keys()].find(key => key.endsWith('/response.json'));
  assert.ok(path, 'response receipt is present');
  const receipt = JSON.parse(bucket.files.get(path));
  const fragments = receipt.chunks.map(ref => {
    const bytes = bucket.files.get(ref.storagePath);
    assert.equal(bytes.length, ref.byteSize);
    assert.equal(digest(bytes), ref.contentHash);
    const { text } = JSON.parse(bytes);
    assert.equal(Buffer.byteLength(text), ref.rawByteSize);
    assert.ok(text.length <= MIB);
    assert.ok(bytes.length < 6 * MIB);
    return text;
  });
  const json = fragments.join('');
  assert.equal(Buffer.byteLength(json), receipt.byteSize);
  assert.equal(digest(json), receipt.responseHash);
  return { receipt, json };
}

test('bounded UTF-8 fragments equal native JSON.stringify bytes including all signed parts and request', async () => {
  const bucket = fixture();
  const privateRequest = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: 'Original customer brief — 界 🪶' },
      { inlineData: { mimeType: 'image/png', data: 'b'.repeat(2 * MIB) } }] }],
    generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { imageSize: '4K' } },
  });
  const nativePayload = {
    candidates: [{ content: { role: 'model', parts: [
      { thought: true, text: 'native reasoning', thoughtSignature: 'opaque-native-signature' },
      { thought: true, inlineData: { mimeType: 'image/png', data: 'c'.repeat(MIB) } },
      { inlineData: { mimeType: 'image/png', data: 'd'.repeat(5 * MIB) }, thoughtSignature: 'image-signature' },
    ] } }],
    unicode: 'x'.repeat(65535) + '💡' + '界'.repeat(MIB) + '\ud800\udc00\ud800\udc00\ud800',
    escapes: '\u0000\u0001\n\t\\"\u2028\u2029',
    optional: undefined,
    values: [null, undefined, true, false, 0, -0, 1.25, NaN, Infinity],
  };
  const providerResult = { status: 200, payload: nativePayload, retryAfterSeconds: null };
  let calls = 0;
  const first = await runDurableImageProviderRequest(options(bucket, async () => {
    calls += 1; return providerResult;
  }, { privateRequest }));
  const { receipt, json } = exchange(bucket);
  assert.equal(receipt.encoding, 'utf8-json-fragments.v1');
  assert.equal(receipt.contractVersion, GEMINI_PROVIDER_CACHE_CONTRACT);
  assert.equal(json, JSON.stringify({ ...providerResult, privateRequest }));
  assert.ok(receipt.chunks.length > 8);
  const recovered = await runDurableImageProviderRequest(options(bucket, async () => assert.fail('no repeated Gemini call'),
    { privateRequest, cacheOnly: true }));
  assert.equal(calls, 1);
  assert.equal(first.providerRequestKey, recovered.providerRequestKey);
  assert.equal(first.requestId, recovered.requestId);
  assert.deepEqual(recovered.payload, JSON.parse(JSON.stringify(nativePayload)));
});

test('legacy base64 chunk receipts remain readable without a provider call or receipt rewrite', async () => {
  const bucket = fixture();
  const key = digest(JSON.stringify({ contractVersion: GEMINI_PROVIDER_CACHE_CONTRACT, ...identity }));
  const prefix = `designpro-provider-private/v1/${identity.ownerId}/${identity.generationId}/${key}`;
  const claim = { contractVersion: GEMINI_PROVIDER_CACHE_CONTRACT, ...identity, requestHash, outputRequestId };
  const payload = { candidates: [{ content: { role: 'model', parts: [
    { thought: true, thoughtSignature: 'native-legacy-thought' },
    { inlineData: { data: 'a'.repeat(5 * MIB), mimeType: 'image/png' }, thoughtSignature: 'native-legacy-image' },
  ] } }] };
  const bytes = Buffer.from(JSON.stringify({ status: 200, payload, privateRequest: null }));
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 4 * MIB) {
    const raw = bytes.subarray(offset, offset + 4 * MIB);
    const stored = Buffer.from(JSON.stringify({ data: raw.toString('base64') }));
    const contentHash = digest(stored);
    const storagePath = `${prefix}/result/${chunks.length}-${contentHash}.jsonpart`;
    bucket.files.set(storagePath, stored);
    chunks.push({ storagePath, contentHash, byteSize: stored.length, rawByteSize: raw.length });
  }
  bucket.files.set(`${prefix}/claim.json`, Buffer.from(JSON.stringify(claim)));
  bucket.files.set(`${prefix}/response.json`, Buffer.from(JSON.stringify({
    contractVersion: GEMINI_PROVIDER_CACHE_CONTRACT, requestHash, outputRequestId,
    responseHash: digest(bytes), byteSize: bytes.length, chunks,
  })));
  const recovered = await runDurableImageProviderRequest(options(bucket, async () => assert.fail('legacy replay must not buy an image'), { cacheOnly: true }));
  assert.deepEqual(recovered.payload, payload);
  assert.equal(recovered.providerCacheHit, true);
  assert.equal(bucket.writes.length, 0);
});

test('interrupted fragment banking never publishes a manifest or dispatches again on lookup', async () => {
  const bucket = fixture();
  const upload = bucket.upload.bind(bucket);
  bucket.upload = async (path, bytes, settings) => {
    if (path.includes('/result/3-')) throw new Error('storage interrupted');
    return upload(path, bytes, settings);
  };
  let calls = 0;
  const invoke = async () => { calls += 1; return { status: 200, payload: { image: 'A'.repeat(6 * MIB) } }; };
  await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)), { code: 'provider_artifact_write_failed' });
  const completedChunks = [...bucket.files.keys()].filter(path => path.endsWith('.jsonpart')).length;
  assert.ok(completedChunks >= 3 && completedChunks <= 4, 'only a previously in-flight sibling may finish after the failure');
  assert.equal([...bucket.files.keys()].some(path => path.endsWith('/response.json')), false);
  await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke, { cacheOnly: true })), { code: 'provider_outcome_unknown' });
  assert.equal(calls, 1);
});

function controlledUploads() {
  const bucket = fixture();
  const upload = bucket.upload.bind(bucket);
  const started = [];
  const releases = new Map();
  const waiters = [];
  let active = 0;
  let maximum = 0;
  bucket.upload = async (path, bytes, settings) => {
    const match = /\/result\/(\d+)-/.exec(path);
    if (!match) return upload(path, bytes, settings);
    const index = Number(match[1]);
    active += 1;
    maximum = Math.max(maximum, active);
    const gate = new Promise((resolve, reject) => releases.set(index, error => error ? reject(error) : resolve()));
    started.push(index);
    for (const waiter of waiters) if (started.length >= waiter.count) waiter.resolve();
    try { await gate; return await upload(path, bytes, settings); }
    finally { active -= 1; }
  };
  return {
    bucket, started,
    get active() { return active; }, get maximum() { return maximum; },
    waitFor(count) { return started.length >= count ? Promise.resolve() : new Promise(resolve => waiters.push({ count, resolve })); },
    release(index, error) { assert.ok(releases.has(index)); releases.get(index)(error); },
  };
}

test('two Storage writes overlap and out-of-order completion preserves the exact exchange and manifest join', async () => {
  const gate = controlledUploads();
  const payload = { image: 'A'.repeat(3 * MIB), thoughtSignature: 'untouched-native-signature' };
  let calls = 0;
  let completed = false;
  const saving = runDurableImageProviderRequest(options(gate.bucket, async () => {
    calls += 1; return { status: 200, payload };
  })).then(result => { completed = true; return result; });
  await gate.waitFor(2);
  assert.deepEqual(gate.started, [0, 1]);
  assert.equal(gate.active, 2);
  gate.release(1);
  await gate.waitFor(3);
  assert.deepEqual(gate.started, [0, 1, 2]);
  assert.equal(gate.active, 2, 'a freed slot continues while the first chunk is still pending');
  gate.release(2);
  await gate.waitFor(4);
  gate.release(3);
  await setImmediate();
  assert.equal(completed, false);
  assert.equal([...gate.bucket.files.keys()].some(path => path.endsWith('/response.json')), false);
  gate.release(0);
  await saving;
  assert.equal(gate.maximum, 2);
  assert.equal(exchange(gate.bucket).json, JSON.stringify({ status: 200, payload, privateRequest: null }));
  const recovered = await runDurableImageProviderRequest(options(gate.bucket, async () => assert.fail('no repeated model dispatch'), { cacheOnly: true }));
  assert.deepEqual(recovered.payload, payload);
  assert.equal(calls, 1);
});

test('one failed parallel write drains its sibling and blocks the manifest without model retry', async () => {
  const gate = controlledUploads();
  let calls = 0;
  let finished = false;
  const invoke = async () => { calls += 1; return { status: 200, payload: { image: 'A'.repeat(3 * MIB) } }; };
  const saving = runDurableImageProviderRequest(options(gate.bucket, invoke))
    .then(() => { finished = true; return null; }, error => { finished = true; return error; });
  await gate.waitFor(2);
  gate.release(1, new Error('chunk upload failed'));
  await setImmediate();
  assert.equal(finished, false, 'the error waits for the in-flight first chunk');
  assert.deepEqual(gate.started, [0, 1]);
  assert.equal([...gate.bucket.files.keys()].some(path => path.endsWith('/response.json')), false);
  gate.release(0);
  const error = await saving;
  assert.equal(error.code, 'provider_artifact_write_failed');
  assert.equal(gate.maximum, 2);
  assert.equal(gate.active, 0);
  assert.equal([...gate.bucket.files.keys()].some(path => path.endsWith('/response.json')), false);
  await assert.rejects(runDurableImageProviderRequest(options(gate.bucket, invoke, { cacheOnly: true })), { code: 'provider_outcome_unknown' });
  assert.equal(calls, 1);
});

test('two failed parallel writes retain both errors and the original provider failure classification', async () => {
  const gate = controlledUploads();
  const saving = runDurableImageProviderRequest(options(gate.bucket, async () => ({
    status: 200, payload: { image: 'A'.repeat(3 * MIB) },
  }))).catch(error => error);
  await gate.waitFor(2);
  gate.release(0, new Error('first chunk storage failure'));
  gate.release(1, new Error('second chunk storage failure'));
  const error = await saving;
  assert.ok(error instanceof AggregateError);
  assert.equal(error.errors.length, 2);
  assert.ok(error.errors.every(item => item.code === 'provider_artifact_write_failed'));
  assert.equal(error.code, 'provider_artifact_write_failed');
  assert.equal(error.status, 503);
  assert.equal(error.providerOutcome, 'received');
  assert.equal(gate.active, 0);
  assert.equal([...gate.bucket.files.keys()].some(path => path.endsWith('/response.json')), false);
});

test('64 MiB total response limit includes private request and leaves oversized partial data unpublished', async () => {
  const bucket = fixture({ retainChunks: false });
  let calls = 0;
  const invoke = async () => { calls += 1; return { status: 200, payload: { image: 'a'.repeat(45 * MIB) } }; };
  await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke, { privateRequest: 'b'.repeat(20 * MIB) })),
    error => error.code === 'provider_response_too_large' && error.providerOutcome === 'received');
  assert.equal(bucket.writes.some(write => write.path.endsWith('/response.json')), false);
  assert.ok(bucket.writes.filter(write => write.path.endsWith('.jsonpart')).length <= 64);
  await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke, { cacheOnly: true })), { code: 'provider_outcome_unknown' });
  assert.equal(calls, 1);
});

test('bounded JSON input rejects cycles, deep nesting and executable/custom values without invoking getters', async () => {
  const cyclic = {}; cyclic.child = cyclic;
  let deep = null;
  for (let count = 0; count < 65; count += 1) deep = { child: deep };
  let getterCalled = false;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { getterCalled = true; return 'unsafe'; } });
  const serializer = Object.defineProperty([], 'toJSON', { enumerable: false, value() { getterCalled = true; return 'unsafe'; } });
  for (const payload of [cyclic, deep, getter, serializer, new Date(), { value: 1n }, { value: () => 1 }, { value: Symbol('bad') }]) {
    const bucket = fixture();
    await assert.rejects(runDurableImageProviderRequest(options(bucket, async () => ({ status: 200, payload }))), { code: 'provider_response_invalid' });
    assert.equal([...bucket.files.keys()].some(path => path.endsWith('/response.json')), false);
  }
  assert.equal(getterCalled, false);
});

test('new reader rejects tampered hashes, lengths, encoding and fragment count before publication', async () => {
  for (const mutate of [
    receipt => { receipt.encoding = 'unknown'; },
    receipt => { receipt.byteSize += 1; },
    receipt => { receipt.responseHash = '0'.repeat(64); },
    receipt => { receipt.chunks[0].rawByteSize += 1; },
    receipt => { receipt.chunks[0].storagePath += '.elsewhere'; },
    receipt => { receipt.chunks = Array.from({ length: 129 }, () => receipt.chunks[0]); },
  ]) {
    const bucket = fixture();
    await runDurableImageProviderRequest(options(bucket, async () => ({ status: 200, payload: { value: 'original', thoughtSignature: 'opaque' } })));
    const path = [...bucket.files.keys()].find(key => key.endsWith('/response.json'));
    const receipt = JSON.parse(bucket.files.get(path));
    mutate(receipt);
    bucket.files.set(path, Buffer.from(JSON.stringify(receipt)));
    await assert.rejects(runDurableImageProviderRequest(options(bucket, async () => assert.fail('no provider on corrupt replay'), { cacheOnly: true })), { code: 'provider_cache_invalid' });
  }
});

test('native digest matches the previous SHA-256 contract for Unicode and byte views', async () => {
  const bytes = Buffer.from('before\u0000界💡after');
  assert.equal(await providerSha256(bytes.subarray(6, 13)), digest(bytes.subarray(6, 13)));
  assert.equal(await providerSha256('界💡'), digest(Buffer.from('界💡')));
  assert.equal(await providerSha256(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), digest(bytes));
});
