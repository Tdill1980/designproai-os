import assert from 'node:assert/strict';
import test from 'node:test';
import { createGateway } from '../src/server.mjs';

const generationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const history = {
  contract: 'designpro.design-history.v1', audience: 'customer', designId: 'DID-AAAAAAAA', generationId,
  versions: [{ version: 1 }], prompts: [{ kind: 'original-brief', prompt: 'Bold teal' }], files: [], orders: [],
};

async function fixture(t, { enabled = true, rpc = {} } = {}) {
  const calls = [];
  const server = createGateway({ env: {
    NODE_ENV: 'test', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
    ...(enabled ? { DESIGNPRO_ARCHIVE_V1: 'true' } : {}),
  }, fetchImpl: async (url, init) => {
    const u = String(url);
    if (u.endsWith('/auth/v1/user')) return Response.json({ id: generationId });
    const name = u.split('/rest/v1/rpc/')[1];
    calls.push({ name, body: JSON.parse(init.body), auth: new Headers(init.headers).get('authorization') });
    const out = rpc[name];
    if (out instanceof Response) return out;
    return Response.json(typeof out === 'function' ? out(JSON.parse(init.body)) : out ?? null);
  } });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return { base: `http://127.0.0.1:${server.address().port}`, calls };
}
const headers = { Authorization: 'Bearer customer-token', 'content-type': 'application/json' };

test('the archive is off unless DESIGNPRO_ARCHIVE_V1 is set, and needs a session', async (t) => {
  const off = await fixture(t, { enabled: false });
  assert.equal((await fetch(`${off.base}/api/designs/search`, { headers })).status, 404);
  assert.equal(off.calls.length, 0);
  const on = await fixture(t);
  assert.equal((await fetch(`${on.base}/api/designs/search`)).status, 401);
});

test('search forwards every filter under the customer token and pages by keyset', async (t) => {
  const row = { design_id: 'DID-AAAAAAAA', generation_id: generationId, design_name: 'Ridgeline', vehicle_year: 2022,
    vehicle_make: 'Ford', vehicle_model: 'F-250', status: 'ready', created_at: '2026-09-25T20:00:00Z', created_year: 2026, order_numbers: ['30292'] };
  const { base, calls } = await fixture(t, { rpc: { designpro_design_search: [row] } });
  const res = await fetch(`${base}/api/designs/search?q=ridge&order=%2330292&make=Ford&model=F-250&year=2022&createdYear=2026&status=ready&limit=1`, { headers });
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(calls[0].auth, 'Bearer customer-token', 'RLS decides, with the caller\'s own identity');
  assert.deepEqual(calls[0].body, { p_query: 'ridge', p_order_number: '#30292', p_vehicle_make: 'Ford', p_vehicle_model: 'F-250',
    p_vehicle_year: 2022, p_created_year: 2026, p_from: null, p_to: null, p_status: 'ready', p_limit: 1,
    p_cursor_created_at: null, p_cursor_design_id: null });
  assert.deepEqual(data.designs[0].orderNumbers, ['30292']);
  assert.deepEqual(data.nextCursor, { cursorAt: '2026-09-25T20:00:00Z', cursorId: 'DID-AAAAAAAA' });
  for (const bad of ['year=20x', 'status=deleted', 'cursorId=robert', 'from=yesterday', `q=${'x'.repeat(201)}`]) {
    assert.equal((await fetch(`${base}/api/designs/search?${bad}`, { headers })).status, 400, bad);
  }
});

test('history: exact contract passes through; another customer\'s design is 404', async (t) => {
  const { base } = await fixture(t, { rpc: { designpro_design_history: ({ p_design_id }) => (p_design_id === 'DID-AAAAAAAA' ? history : null) } });
  const ok = await fetch(`${base}/api/designs/did-aaaaaaaa/history`, { headers });
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).prompts[0].prompt, 'Bold teal');
  assert.equal((await fetch(`${base}/api/designs/DID-BBBBBBBB/history`, { headers })).status, 404);
});

test('order binding: intake only, validated, exact body', async (t) => {
  const { base, calls } = await fixture(t, { rpc: { designpro_bind_design_order: { designId: 'DID-AAAAAAAA', orderNumber: '30292', source: 'intake' } } });
  const post = (body) => fetch(`${base}/api/designs/${generationId}/orders`, { method: 'POST', headers, body: JSON.stringify(body) });
  assert.equal((await post({ orderNumber: ' #30292 ' })).status, 200);
  assert.deepEqual(calls[0].body, { p_generation_id: generationId, p_order_number: '30292', p_source: 'intake', p_woo_order_id: null });
  assert.equal((await post({ orderNumber: '30292', source: 'woocommerce' })).status, 400, 'a customer cannot claim a Woo binding');
  assert.equal((await post({ orderNumber: '<script>' })).status, 400);
  assert.equal(calls.length, 1);
});
