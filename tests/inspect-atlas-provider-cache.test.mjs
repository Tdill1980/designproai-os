import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import audit from '../runtime/inspect-atlas-provider-cache.cjs';
const hash = value => createHash('sha256').update(value).digest('hex');
const requestId = '22222222-2222-4222-8222-222222222222';
const generationId = '33333333-3333-4333-8333-333333333333';
const ownerId = '11111111-1111-4111-8111-111111111111';

test('partial envelope inspection distinguishes complete payload from truncated image without manufacturing a result', () => {
  const payload = { candidates: [{ content: { parts: [{ text: 'braces } escaped " backslash \\ and 🌙' }] } }] };
  const prefix = JSON.stringify({ status: 200, payload }).slice(0, -1) + ',"privateRequest":"missing tail';
  assert.deepEqual(audit.completePayloadPrefix(prefix), payload);
  assert.equal(audit.completePayloadPrefix(prefix.slice(0, 50)), null);
  assert.equal(audit.completePayloadPrefix('arbitrary data'), null);
});

test('read-only inspection is bound to the exact request and reports a incomplete signed payload without disclosing it', async () => {
  const identity = { ownerId, requestId, generationId, mode: 'atlas-artboard', attemptKey: 'master:1' };
  const claim = { contractVersion: 'designpro.gemini-provider-cache.v1', ...identity, requestHash: 'a'.repeat(64) };
  const key = hash(JSON.stringify({ contractVersion: claim.contractVersion, ...identity }));
  const prefix = `designpro-provider-private/v1/${ownerId}/${generationId}/${key}`;
  const native = JSON.stringify({ status: 200, payload: { candidates: [{ content: { parts: [{ text: 'PRIVATE_VALUE', thoughtSignature: 'OPAQUE_SECRET' }] } }] } }).slice(0, -1) + ',"privateRequest":"incomplete';
  const stored = Buffer.from(JSON.stringify({ data: Buffer.from(native).toString('base64') }));
  const name = `0-${hash(stored)}.jsonpart`;
  const files = new Map([[`${prefix}/claim.json`, Buffer.from(JSON.stringify(claim))], [`${prefix}/result/${name}`, stored]]);
  const calls = [];
  const bucket = {
    async download(path) { calls.push(['download', path]); return files.has(path) ? { data: new Blob([files.get(path)]) } : { error: { status: 404 } }; },
    async list(path) { calls.push(['list', path]); assert.equal(path, `${prefix}/result`); return { data: [{ name }] }; },
  };
  const supabase = {
    from(table) { assert.equal(table, 'designpro_generation_requests'); return {
      select() { return this; }, eq(k,v) { assert.equal(v, k === 'id' ? requestId : generationId); return this; },
      async maybeSingle() { return { data: { id: requestId, generation_id: generationId, owner_id: ownerId, state: 'failed', error: { code: 'provider_outcome_unknown' } } }; },
    }; },
    storage: { from(bucketName) { assert.equal(bucketName, 'wrap-files'); return bucket; } },
  };
  const result = await audit.inspectAtlasProviderCache({ supabase, requestId, generationId });
  assert.equal(result.attempts[0].completionRecordPresent, false);
  assert.equal(result.attempts[0].completeEnvelope, false);
  assert.equal(result.attempts[0].completeNativePayload, true);
  assert.equal(result.attempts[0].completeFinalImage, false);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.writes, 0);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_VALUE|OPAQUE_SECRET|privateRequest|61cc/);
  files.get(`${prefix}/result/${name}`)[0] ^= 1;
  await assert.rejects(audit.inspectAtlasProviderCache({ supabase, requestId, generationId }), /audit_chunk_hash_mismatch/);
  await assert.rejects(audit.inspectAtlasProviderCache({ supabase, requestId: 'bad', generationId }), /audit_identity_invalid/);
});
