import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { ATLAS_PROOF_RECOVERY_CONTRACT, runAtlasProofProvider, finalAtlasProofImage } from '../supabase/functions/_shared/atlas-proof-provider.mjs';
const { invokeAtlasProof, withinProofDeadline } = createRequire(import.meta.url)('../runtime/atlas-proof-transport.cjs');

const ownerId = '11111111-1111-4111-8111-111111111111';
const providerRequest = { contractVersion: ATLAS_PROOF_RECOVERY_CONTRACT,
  requestId: '22222222-2222-4222-8222-222222222222', generationId: '33333333-3333-4333-8333-333333333333',
  claimToken: '44444444-4444-4444-8444-444444444444' };
const payload = { candidates: [{ content: { role: 'model', parts: [
  { inlineData: { data: Buffer.from('private thought').toString('base64'), mimeType: 'image/png' }, thought: true },
  { inlineData: { data: Buffer.from('final proof').toString('base64'), mimeType: 'image/png' }, thoughtSignature: 'opaque-signature' },
] } }] };
function fixture() {
  const files = new Map();
  const bucket = {
    async upload(path, bytes) { if (files.has(path)) return { error: { statusCode: '400', message: 'The resource already exists' } };
      files.set(path, Buffer.from(bytes)); return { error: null }; },
    async download(path) { return files.has(path) ? { data: new Blob([files.get(path)]), error: null }
      : { error: { statusCode: '400', message: 'Object not found' } }; },
  };
  const row = { owner_id: ownerId, generation_id: providerRequest.generationId, state: 'leased',
    lease_token: providerRequest.claimToken, lease_expires_at: new Date(Date.now() + 600_000).toISOString() };
  const supabase = { storage: { from: () => bucket }, from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: row }) }) };
  return { files, row, options: { supabase, ownerId, providerRequest, shotKey: 'passenger-side',
    authority: { sourcePanelHash: 'a'.repeat(64) }, parts: [{ text: 'unchanged camera prompt' }],
    promptContract: 'pinned-presentation', models: ['pro', 'pro', 'flash'], wait: async () => {} } };
}

test('a lost proof acknowledgement recovers the exact native response without another image', async () => {
  const f = fixture(); let calls = 0;
  const invoke = async () => { calls += 1; return { status: 200, payload }; };
  const first = await runAtlasProofProvider({ ...f.options, invoke });
  const recovered = await runAtlasProofProvider({ ...f.options, invoke,
    providerRequest: { ...providerRequest, cacheOnly: true } });
  assert.equal(calls, 1); assert.equal(recovered.requestId, first.requestId);
  assert.equal(recovered.bytes.toString(), 'final proof');
  assert.equal(recovered.providerCacheHit, true); assert.deepEqual(recovered.payload, payload);
});

test('proof timeout or 5xx cannot advance the model ladder or buy another image after restart', async () => {
  for (const response of [null, { status: 503, payload: { error: 'unavailable' } }]) {
    const f = fixture(); let calls = 0;
    const invoke = async () => { calls += 1; if (!response) throw new Error('lost response'); return response; };
    for (let retry = 0; retry < 2; retry += 1) await assert.rejects(runAtlasProofProvider({ ...f.options, invoke }));
    assert.equal(calls, 1);
  }
});

test('explicit 429 uses only the existing bounded ladder and then replays it without calls', async () => {
  const f = fixture(); const models = [];
  const invoke = async ({ model }) => { models.push(model); return models.length < 3
    ? { status: 429, payload: {}, retryAfterSeconds: 0 } : { status: 200, payload }; };
  const first = await runAtlasProofProvider({ ...f.options, invoke });
  const replay = await runAtlasProofProvider({ ...f.options, invoke, providerRequest: { ...providerRequest, cacheOnly: true } });
  assert.deepEqual(models, ['pro', 'pro', 'flash']); assert.equal(first.requestId, replay.requestId);
  assert.equal(replay.imageRequestCount, 3);
});

test('wrong owner, expired lease and changed panel cannot reuse or generate a proof', async () => {
  const f = fixture(); let calls = 0;
  const invoke = async () => { calls += 1; return { status: 200, payload }; };
  await runAtlasProofProvider({ ...f.options, invoke });
  await assert.rejects(runAtlasProofProvider({ ...f.options, invoke, authority: { sourcePanelHash: 'b'.repeat(64) } }), { code: 'provider_request_identity_conflict' });
  await assert.rejects(runAtlasProofProvider({ ...f.options, invoke, ownerId: providerRequest.requestId }), { code: 'provider_claim_invalid' });
  f.row.lease_expires_at = '2020-01-01T00:00:00Z';
  await assert.rejects(runAtlasProofProvider({ ...f.options, invoke }), { code: 'provider_claim_invalid' });
  assert.equal(calls, 1);
});

test('missing final image and multiple final images are refused without choosing a thought image', () => {
  const thought = payload.candidates[0].content.parts[0]; const final = payload.candidates[0].content.parts[1];
  for (const parts of [[thought], [final, final]]) assert.throws(() => finalAtlasProofImage({ candidates: [{ content: { parts } }] }));
});

const body = { mode: 'atlas-proof', providerRequest, generationId: providerRequest.generationId,
  atlasRevisionId: '55555555-5555-4555-8555-555555555555', shotKey: 'side', surfaceKey: 'driver',
  sourcePanelStoragePath: 'panel.png', sourcePanelHash: 'a'.repeat(64), sourceMasterHash: 'b'.repeat(64) };
const ok = data => ({ ok: true, status: 200, json: async () => data });
const capability = () => ok({ proofRecoveryContract: ATLAS_PROOF_RECOVERY_CONTRACT, cacheOnly: true });
const success = () => ok({ ...body, success: true, proofRecoveryContract: ATLAS_PROOF_RECOVERY_CONTRACT });
const transport = fetchImpl => ({ url: 'https://example.supabase.co/functions/v1/persona-photographer-render',
  headers: {}, body, fetchImpl, wait: async () => {} });

test('runtime recovers a lost POST response with cache-only reads under the same identity', async () => {
  const posts = [];
  const result = await invokeAtlasProof(transport(async (url, init) => {
    if (init.method === 'GET') return capability();
    posts.push(JSON.parse(init.body)); if (posts.length === 1) throw new Error('response lost'); return success();
  }));
  assert.equal(result.payload.success, true); assert.equal(posts.length, 2);
  assert.equal(posts[1].providerRequest.cacheOnly, true);
  assert.deepEqual(posts[1].providerRequest, { ...posts[0].providerRequest, cacheOnly: true });
});

test('old Edge capability prevents all proof POSTs, including recovery', async () => {
  let posts = 0;
  await assert.rejects(invokeAtlasProof(transport(async (url, init) => {
    if (init.method === 'POST') posts += 1; return ok({});
  })), { code: 'atlas_proof_recovery_unavailable' }); assert.equal(posts, 0);
});

test('an uncertain proof stops after three cache lookups and never reposts a new operation', async () => {
  const posts = [];
  await assert.rejects(invokeAtlasProof(transport(async (url, init) => {
    if (init.method === 'GET') return capability(); posts.push(JSON.parse(init.body));
    return { ok: false, status: 409, json: async () => ({ error: 'provider_outcome_unknown' }) };
  })), { code: 'provider_outcome_unknown' });
  assert.equal(posts.length, 4); assert.equal(posts.filter(p => !p.providerRequest.cacheOnly).length, 1);
});

test('a foreign revision response is refused before its proof can be downloaded', async () => {
  await assert.rejects(invokeAtlasProof(transport(async (url, init) => init.method === 'GET' ? capability()
    : ok({ ...body, success: true, proofRecoveryContract: ATLAS_PROOF_RECOVERY_CONTRACT, atlasRevisionId: 'foreign' }))),
  { code: 'atlas_proof_response_identity_mismatch' });
});

test('deadline ends a hung response/storage promise even if the SDK ignores AbortSignal', async () => {
  const controller = new AbortController();
  const pending = withinProofDeadline(() => new Promise(() => {}), controller.signal);
  controller.abort(new Error('bounded deadline'));
  await assert.rejects(pending, /bounded deadline/);
});
