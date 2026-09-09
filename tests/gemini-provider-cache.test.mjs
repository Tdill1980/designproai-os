import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authorizeAtlasProviderRequest, providerSha256, putImmutableProviderArtifact,
  runDurableImageProviderRequest, captureGeminiHttpExchange,
} from '../supabase/functions/_shared/gemini-provider-cache.mjs';
import { selectFinalGenerateContentImage } from '../supabase/functions/_shared/gemini-image-history.mjs';

const identity = {
  ownerId: '11111111-1111-4111-8111-111111111111',
  requestId: '22222222-2222-4222-8222-222222222222',
  generationId: '33333333-3333-4333-8333-333333333333',
  mode: 'atlas-artboard', attemptKey: 'master:1',
};
const outputRequestId = '44444444-4444-4444-8444-444444444444';
const claimToken = '55555555-5555-4555-8555-555555555555';
const requestHash = 'a'.repeat(64);
const nativePayload = {
  candidates: [{ content: { role: 'model', parts: [
    { text: 'private planning', thought: true, thoughtSignature: 'first-opaque-signature' },
    { inlineData: { data: 'dGhvdWdodA==', mimeType: 'image/png' }, thought: true },
    { inlineData: { data: 'ZmluYWw=', mimeType: 'image/png' }, thoughtSignature: 'image-signature' },
  ] } }],
};
function bucketFixture() {
  const files = new Map();
  const writes = [];
  return {
    files, writes,
    async upload(path, bytes, options) {
      assert.equal(options.upsert, false);
      writes.push({ path, size: bytes.length, contentType: options.contentType });
      if (files.has(path)) return { error: { statusCode: '400', message: 'The resource already exists' } };
      files.set(path, new Uint8Array(bytes));
      return { data: { path }, error: null };
    },
    async download(path) {
      return files.has(path) ? { data: new Blob([files.get(path)]), error: null }
        : { data: null, error: { statusCode: '400', message: 'Object not found' } };
    },
  };
}
const options = (bucket, invoke, overrides = {}) => ({
  bucket, identity, requestHash, outputRequestId, authorize: async () => {}, invoke, ...overrides,
});

test('durable response resumes every native part after a lost caller response, without another invocation', async () => {
  const bucket = bucketFixture();
  let calls = 0;
  const invoke = async () => { calls += 1; return { status: 200, payload: nativePayload }; };
  const privateRequest = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Original private prompt' }] }] });
  const first = await runDurableImageProviderRequest(options(bucket, invoke, { privateRequest }));
  const resumed = await runDurableImageProviderRequest(options(bucket, invoke, {
    identity: { ...identity, claimToken: 'a-new-transport-token' }, cacheOnly: true,
    outputRequestId: '66666666-6666-4666-8666-666666666666',
  }));
  assert.equal(calls, 1);
  assert.equal(first.providerCacheHit, false);
  assert.equal(resumed.providerCacheHit, true);
  assert.equal(resumed.requestId, outputRequestId);
  assert.equal(resumed.providerRequestKey, first.providerRequestKey);
  assert.deepEqual(resumed.payload, nativePayload);
  assert.ok(!('privateRequest' in resumed));
  const chunkPath = [...bucket.files.keys()].find((path) => path.endsWith('.jsonpart'));
  const chunk = JSON.parse(new TextDecoder().decode(bucket.files.get(chunkPath)));
  assert.equal(JSON.parse(chunk.text).privateRequest, privateRequest);
  assert.ok(bucket.writes.every(({ path }) => path.startsWith('designpro-provider-private/')));
});

test('cache-only capability never reserves or calls a provider for a missing record', async () => {
  const bucket = bucketFixture();
  await assert.rejects(runDurableImageProviderRequest(options(bucket, async () => assert.fail('no provider call'), { cacheOnly: true })),
    (error) => error.code === 'provider_cache_miss' && error.status === 404);
  assert.equal(bucket.files.size, 0);
});

test('lost reservation acknowledgement does not grant permission for a provider call', async () => {
  const bucket = bucketFixture();
  const upload = bucket.upload.bind(bucket);
  bucket.upload = async (...args) => { await upload(...args); throw new Error('acknowledgement lost'); };
  await assert.rejects(runDurableImageProviderRequest(options(bucket, async () => assert.fail('uncertain reservation cannot call provider'))),
    (error) => error.code === 'provider_outcome_unknown' && error.providerRetryDisposition === 'operator_required' && !error.retryable);
});

test('racing workers have one provider winner and recover the identical receipt', async () => {
  const bucket = bucketFixture();
  let release;
  let entered;
  const gate = new Promise((resolve) => { release = resolve; });
  const started = new Promise((resolve) => { entered = resolve; });
  let calls = 0;
  const invoke = async () => { calls += 1; entered(); await gate; return { status: 200, payload: nativePayload }; };
  const first = runDurableImageProviderRequest(options(bucket, invoke));
  await started;
  await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)), { code: 'provider_outcome_unknown' });
  release();
  await first;
  assert.deepEqual((await runDurableImageProviderRequest(options(bucket, invoke))).payload, nativePayload);
  assert.equal(calls, 1);
});

test('ambiguous network outcome never automatically creates another image on restart', async () => {
  const bucket = bucketFixture();
  let calls = 0;
  const invoke = async () => { calls += 1; throw new Error('connection dropped after request accepted'); };
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)),
      (error) => error.code === 'provider_outcome_unknown' && error.imageRequestCount === 1 && error.providerOutcome === 'unknown');
  }
  assert.equal(calls, 1);
});

test('HTTP rejection survives an unreadable JSON body and is replayed without a second POST', async () => {
  for (const status of [400, 429, 503]) {
    const bucket = bucketFixture();
    let calls = 0;
    const invoke = () => captureGeminiHttpExchange(async () => {
      calls++;
      return new Response('<html>upstream failure</html>', { status, headers: { 'retry-after': '17' } });
    });
    for (let replay = 0; replay < 2; replay++) {
      await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)), error => {
        assert.equal(error.code, `provider_http_${status}`);
        assert.equal(error.providerStatus, status);
        assert.equal(error.retryAfterSeconds, '17');
        assert.equal(error.retryable, false);
        assert.equal(error.providerDiagnostic.phase, 'response_body');
        assert.equal(error.providerDiagnostic.httpStatus, status);
        assert.equal(error.providerDiagnostic.exceptionClass, 'SyntaxError');
        return true;
      });
    }
    assert.equal(calls, 1);
    assert.ok([...bucket.files.keys()].some(path => path.endsWith('/response.json')));
  }
});

test('truncated success records only safe diagnostics and remains an unknown outcome across restart', async () => {
  const bucket = bucketFixture();
  let calls = 0;
  const invoke = () => captureGeminiHttpExchange(async () => {
    calls++;
    return { status: 200, headers: new Headers(), async json() { throw new SyntaxError('private prompt and API key MUST NOT LEAK'); } };
  });
  for (let replay = 0; replay < 2; replay++) {
    await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)), error => {
      assert.equal(error.code, 'provider_outcome_unknown');
      assert.equal(error.providerOutcome, 'unknown');
      assert.equal(error.retryable, false);
      assert.equal(error.providerFailureRecorded, true);
      assert.deepEqual({ ...error.providerDiagnostic, elapsedMs: 0 }, {
        contractVersion: 'designpro.gemini-http-diagnostic.v1', phase: 'response_body',
        httpStatus: 200, exceptionClass: 'SyntaxError', elapsedMs: 0,
      });
      return true;
    });
  }
  assert.equal(calls, 1);
  const recordPath = [...bucket.files.keys()].find(path => path.endsWith('/failure.json'));
  const stored = Buffer.from(bucket.files.get(recordPath)).toString();
  assert.doesNotMatch(stored, /private prompt|API key|MUST NOT LEAK|stack/);
  assert.equal([...bucket.files.keys()].some(path => path.endsWith('/response.json')), false);
  const corrupt = JSON.parse(stored);
  corrupt.requestHash = 'b'.repeat(64);
  bucket.files.set(recordPath, Buffer.from(JSON.stringify(corrupt)));
  await assert.rejects(runDurableImageProviderRequest(options(bucket, async () => assert.fail('no retry'))), { code: 'provider_cache_invalid' });
});

test('no response headers is distinguished from body failure without assuming generation did not happen', async () => {
  const bucket = bucketFixture();
  let calls = 0;
  const invoke = () => captureGeminiHttpExchange(async () => {
    calls++;
    throw new DOMException('contains a sensitive URL', 'TimeoutError');
  });
  for (let replay = 0; replay < 2; replay++) {
    await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)), error =>
      error.code === 'provider_outcome_unknown' && error.providerDiagnostic.phase === 'request'
      && error.providerDiagnostic.httpStatus === null && error.providerDiagnostic.exceptionClass === 'TimeoutError'
      && error.providerRetryDisposition === 'operator_required');
  }
  assert.equal(calls, 1);
});

test('failed diagnostic persistence cannot remove the claim or authorize another paid request', async () => {
  const bucket = bucketFixture();
  const originalUpload = bucket.upload.bind(bucket);
  bucket.upload = (...args) => args[0].endsWith('/failure.json') ? { error: { statusCode: 503 } } : originalUpload(...args);
  let calls = 0;
  const invoke = () => captureGeminiHttpExchange(async () => { calls++; throw new TypeError('socket closed'); });
  await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)), error =>
    error.code === 'provider_outcome_unknown' && error.providerFailureRecorded === false);
  await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)), { code: 'provider_outcome_unknown' });
  assert.equal(calls, 1);
  assert.equal(bucket.files.size, 1);
});

test('same creative attempt with changed model/request digest fails closed', async () => {
  const bucket = bucketFixture();
  const invoke = async () => ({ status: 200, payload: nativePayload });
  await runDurableImageProviderRequest(options(bucket, invoke));
  await assert.rejects(runDurableImageProviderRequest(options(bucket, async () => assert.fail('no reroll'), { requestHash: 'b'.repeat(64) })),
    { code: 'provider_request_identity_conflict' });
});

test('corrupted persisted provider bytes cannot be published or cause regeneration', async () => {
  const bucket = bucketFixture();
  await runDurableImageProviderRequest(options(bucket, async () => ({ status: 200, payload: nativePayload })));
  const chunk = [...bucket.files.keys()].find((path) => path.endsWith('.jsonpart'));
  bucket.files.get(chunk)[0] ^= 1;
  await assert.rejects(runDurableImageProviderRequest(options(bucket, async () => assert.fail('no regeneration'))),
    { code: 'provider_cache_invalid' });
});

test('known 429 response is durable and retains a scheduler retry delay without hidden POST retries', async () => {
  const bucket = bucketFixture();
  let calls = 0;
  const invoke = async () => { calls += 1; return { status: 429, payload: { error: { code: 429 } }, retryAfterSeconds: 23 }; };
  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(runDurableImageProviderRequest(options(bucket, invoke)),
      (error) => error.providerStatus === 429 && error.retryAfterSeconds === 23 && error.providerOutcome === 'rejected'
        && error.retryable === false && error.providerRetryDisposition === 'operator_required');
  }
  assert.equal(calls, 1);
});

test('expired/foreign owner claims are refused before any cache read or provider call', async () => {
  const row = { id: identity.requestId, generation_id: identity.generationId, owner_id: identity.ownerId,
    state: 'leased', lease_token: claimToken, lease_expires_at: '2026-09-08T12:00:00Z' };
  const supabase = { from(table) {
    assert.equal(table, 'designpro_generation_requests');
    return { select() { return this; }, eq(key, value) { assert.equal(key, 'id'); assert.equal(value, identity.requestId); return this; },
      async maybeSingle() { return { data: row, error: null }; } };
  } };
  const request = { ...identity, claimToken };
  await authorizeAtlasProviderRequest(supabase, request, identity.ownerId, () => Date.parse('2026-09-08T11:00:00Z'));
  await assert.rejects(authorizeAtlasProviderRequest(supabase, request, identity.ownerId, () => Date.parse('2026-09-08T12:00:00Z')), { code: 'provider_claim_invalid' });
  await assert.rejects(authorizeAtlasProviderRequest(supabase, request, outputRequestId, () => 0), { code: 'provider_claim_invalid' });
  const bucket = bucketFixture();
  await assert.rejects(runDurableImageProviderRequest(options(bucket, async () => assert.fail('provider called'), {
    authorize: () => authorizeAtlasProviderRequest(supabase, request, identity.ownerId, () => Date.parse('2026-09-08T12:00:00Z')),
  })), { code: 'provider_claim_invalid' });
  assert.equal(bucket.files.size, 0);
});

test('identical artifact writes resume and different bytes never overwrite prior output', async () => {
  const bucket = bucketFixture();
  const bytes = new TextEncoder().encode('original image');
  const ref = await putImmutableProviderArtifact(bucket, 'atlas-panel/one.png', bytes, 'image/png');
  assert.equal(ref.contentHash, await providerSha256(bytes));
  assert.deepEqual(await putImmutableProviderArtifact(bucket, 'atlas-panel/one.png', bytes, 'image/png'), ref);
  await assert.rejects(putImmutableProviderArtifact(bucket, 'atlas-panel/one.png', new TextEncoder().encode('other image'), 'image/png'),
    { code: 'provider_artifact_write_failed' });
  assert.deepEqual(bucket.files.get('atlas-panel/one.png'), bytes);
});

test('large private histories use bounded hash-checked chunks and reassemble exactly', async () => {
  const bucket = bucketFixture();
  const payload = { signature: '界'.repeat(2 * 1024 * 1024) };
  const first = await runDurableImageProviderRequest(options(bucket, async () => ({ status: 200, payload })));
  assert.ok(bucket.writes.filter(({ path }) => path.endsWith('.jsonpart')).length > 1);
  assert.ok(bucket.writes.every(({ size, contentType }) => size < 6 * 1024 * 1024 && contentType === 'application/json'));
  for (const bytes of bucket.files.values()) assert.doesNotThrow(() => JSON.parse(new TextDecoder().decode(bytes)));
  const cached = await runDurableImageProviderRequest(options(bucket, async () => assert.fail('already generated')));
  assert.deepEqual(cached.payload, first.payload);
});

test('generateContent final-image selection excludes thought images/text and rejects ambiguity', () => {
  const selected = selectFinalGenerateContentImage(nativePayload, 'atlas_artboard');
  assert.equal(selected.imagePart.inlineData.data, 'ZmluYWw=');
  assert.equal(selected.textOut, '');
  assert.equal(selected.imagePart.thoughtSignature, 'image-signature');
  assert.throws(() => selectFinalGenerateContentImage({ candidates: [nativePayload.candidates[0], nativePayload.candidates[0]] }, 'atlas_artboard'),
    /atlas_artboard_ambiguous_candidates/);
  const noFinal = structuredClone(nativePayload);
  noFinal.candidates[0].content.parts.pop();
  assert.throws(() => selectFinalGenerateContentImage(noFinal, 'atlas_panel'), /atlas_panel_no_image/);
  const twoFinals = structuredClone(nativePayload);
  twoFinals.candidates[0].content.parts.push(twoFinals.candidates[0].content.parts[2]);
  assert.throws(() => selectFinalGenerateContentImage(twoFinals, 'atlas_panel'), /atlas_panel_ambiguous_final_images/);
});
