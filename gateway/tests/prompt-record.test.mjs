import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/server.mjs';

const generationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const requestId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const originalPrompt = '  Original customer words\nexactly preserved.  ';
const record = {
  generationId, originalRequestId: requestId, originalPrompt,
  createdAt: '2026-09-20T12:00:00Z',
  versions: [{version: 1, requestId, revisionId: null, prompt: originalPrompt,
    createdAt: '2026-09-20T12:00:00Z', state: 'queued', privateSecret: 'must not leak'}],
  privateSecret: 'must not leak',
};

async function fixture(t, data = record) {
  const calls = [];
  const server = createGateway({env: {
    NODE_ENV: 'test', SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', DESIGNPRO_RELEASE_SHA: 'c'.repeat(40),
  }, fetchImpl: async (url, init) => {
    calls.push({url: String(url), init});
    if (String(url).endsWith('/auth/v1/user')) return Response.json({id: generationId});
    assert.ok(String(url).endsWith('/rest/v1/rpc/designpro_generation_prompt_record'));
    assert.deepEqual(JSON.parse(init.body), {p_generation_id: generationId});
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer customer-token');
    return Response.json(data);
  }});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return {base: `http://127.0.0.1:${server.address().port}`, calls};
}
const headers = {Authorization: 'Bearer customer-token'};

test('prompt record requires authentication before reading customer history', async t => {
  const {base, calls} = await fixture(t);
  assert.equal((await fetch(`${base}/api/jobs/${generationId}/prompt-record`)).status, 401);
  assert.equal(calls.length, 0);
});

test('prompt record forwards customer identity and projects exact text without private fields', async t => {
  const {base} = await fixture(t);
  const response = await fetch(`${base}/api/jobs/${generationId}/prompt-record`, {headers});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.originalPrompt, originalPrompt);
  assert.equal(data.designId, 'DID-AAAAAAAA');
  assert.equal(data.versions[0].prompt, originalPrompt);
  assert.equal(JSON.stringify(data).includes('must not leak'), false);
});

for (const [description, data, status] of [
  ['inaccessible generation', null, 404],
  ['mismatched generation identity', {...record, generationId: requestId}, 502],
]) test(description, async t => {
  const {base} = await fixture(t, data);
  assert.equal((await fetch(`${base}/api/jobs/${generationId}/prompt-record`, {headers})).status, status);
});

test('gateway health reports the full deployed SHA without authentication', async t => {
  const {base, calls} = await fixture(t);
  assert.equal((await (await fetch(`${base}/healthz`)).json()).sourceSha, 'c'.repeat(40));
  assert.equal(calls.length, 0);
});
