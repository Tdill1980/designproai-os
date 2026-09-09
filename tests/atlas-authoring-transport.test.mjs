import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { invokeAtlasAuthoring, providerFailureDetails, providerFailureSummary } = require('../runtime/atlas-authoring-transport.cjs');
const atlas = require('../runtime/flat-first-atlas.cjs');

const providerRequest = { requestId: '11111111-1111-4111-8111-111111111111',
  generationId: '22222222-2222-4222-8222-222222222222', claimToken: '33333333-3333-4333-8333-333333333333',
  attemptKey: 'panel:roof:1' };
const response = (status, payload) => ({ status, ok: status >= 200 && status < 300, json: async () => payload });
const diagnostic = { contractVersion: 'designpro.gemini-http-diagnostic.v1', phase: 'response_body',
  exceptionClass: 'SyntaxError', httpStatus: 200, elapsedMs: 29_000 };
const options = (fetchImpl, mode = 'atlas-panel') => ({ url: 'https://example.invalid/edge', headers: {},
  body: { mode, providerRequest: { ...providerRequest, attemptKey: mode === 'atlas-panel' ? 'panel:roof:1' : 'master:1' },
    sourcePanelHash: 'a'.repeat(64), priorTurns: [{ role: 'model', parts: [{ thoughtSignature: 'opaque-original-part' }] }] },
  probe: async () => {}, fetchImpl, wait: async () => {} });

test('Call 1 and finishing recover lost acknowledgements using the same artwork and attempt', async () => {
  for (const mode of ['atlas-artboard', 'atlas-panel']) {
    for (const failure of ['fetch', 'body', 'pending']) {
      const posts = [];
      const result = await invokeAtlasAuthoring(options(async (_url, init) => {
        posts.push(JSON.parse(init.body));
        if (posts.length === 1) {
          if (failure === 'fetch') throw new TypeError('lost response');
          if (failure === 'body') return { ...response(200, null), json: async () => { throw new SyntaxError(); } };
          return response(409, { error: 'provider_outcome_unknown', retryable: false });
        }
        return response(200, { success: true, providerCacheHit: true });
      }, mode));
      assert.equal(result.payload.success, true);
      assert.equal(posts.length, 2);
      assert.deepEqual(posts[1], { ...posts[0], providerRequest: { ...posts[0].providerRequest, cacheOnly: true } });
      assert.equal(posts.filter(p => p.providerRequest.cacheOnly !== true).length, 1);
    }
  }
});

test('an incomplete old response stops after three reads without buying another panel', async () => {
  const posts = [];
  const result = await invokeAtlasAuthoring(options(async (_url, init) => {
    posts.push(JSON.parse(init.body));
    return response(409, { error: 'provider_outcome_unknown', providerOutcome: 'unknown' });
  }));
  assert.equal(posts.length, 4);
  assert.equal(posts.filter(p => !p.providerRequest.cacheOnly).length, 1);
  assert.equal(result.payload.retryable, false);
  assert.equal(result.payload.providerRetryDisposition, 'operator_required');
});

test('an already cache-only request remains nonspending on every recovery read', async () => {
  const posts = [];
  const opts = options(async (_url, init) => {
    posts.push(JSON.parse(init.body));
    return response(404, { error: 'provider_cache_miss' });
  });
  opts.body.providerRequest.cacheOnly = true;
  await invokeAtlasAuthoring(opts);
  assert.equal(posts.length, 4);
  assert.ok(posts.every(p => p.providerRequest.cacheOnly === true));
});

test('known provider failures and identity/permission refusals are not repeated', async () => {
  for (const [status, payload] of [
    [429, { error: 'provider_http_429' }],
    [502, { error: 'provider_http_503' }],
    [409, { error: 'provider_request_identity_conflict' }],
    [403, null],
    [409, { error: 'provider_outcome_unknown', providerFailureRecorded: true, providerDiagnostic: diagnostic }],
  ]) {
    let posts = 0;
    const result = await invokeAtlasAuthoring(options(async () => { posts++; return response(status, payload); }));
    assert.equal(posts, 1);
    if (payload?.providerDiagnostic) assert.deepEqual(result.payload.providerDiagnostic, diagnostic);
  }
});

test('a permission refusal during recovery stops further lookups even without a JSON body', async () => {
  let posts = 0;
  const result = await invokeAtlasAuthoring(options(async () => {
    posts++;
    if (posts === 1) throw new TypeError();
    return { ...response(403, null), json: async () => { throw new SyntaxError(); } };
  }));
  assert.equal(posts, 2);
  assert.equal(result.response.status, 403);
  assert.equal(result.payload.error, 'provider_authorization_failed');
});

test('capability failure never submits a request, even when the probe throws an untyped error', async () => {
  let posts = 0;
  const opts = options(async () => { posts++; return response(200, { success: true }); });
  opts.probe = async () => { throw new TypeError('connection lost'); };
  await assert.rejects(invokeAtlasAuthoring(opts), { code: 'flat_atlas_provider_cache_probe_failed' });
  assert.equal(posts, 0);
});

test('deadline releases hung capability and response-body waits even if fetch ignores cancellation', async () => {
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    let posts = 0;
    const probe = options(async () => { posts++; return response(200, {}); });
    probe.timeoutMs = 20;
    probe.probe = () => new Promise(() => {});
    await assert.rejects(invokeAtlasAuthoring(probe), { code: 'flat_atlas_provider_cache_probe_failed' });
    assert.equal(posts, 0);
    const body = options(async () => { posts++; return { ...response(200, null), json: () => new Promise(() => {}) }; });
    body.timeoutMs = 20;
    const result = await invokeAtlasAuthoring(body);
    assert.equal(posts, 1);
    assert.equal(result.payload.error, 'provider_outcome_unknown');
    assert.equal(result.payload.retryable, false);
  } finally { clearTimeout(keepAlive); }
});

test('the persisted error includes only validated provider evidence', () => {
  const payload = { providerDiagnostic: { ...diagnostic, message: 'private prompt', stack: 'private stack', signature: 'private signature' },
    providerFailureRecorded: true };
  assert.deepEqual(providerFailureDetails(payload).providerDiagnostic, diagnostic);
  assert.equal(providerFailureDetails(payload).providerFailureRecorded, true);
  assert.match(providerFailureSummary(payload), /phase=response_body; exception=SyntaxError; status=200; elapsedMs=29000/);
  assert.ok(!providerFailureSummary(payload).includes('private'));
  for (const invalid of [{ ...diagnostic, exceptionClass: 'private text' }, { ...diagnostic, elapsedMs: Infinity },
    { ...diagnostic, httpStatus: 999 }, { ...diagnostic, phase: 'private text' }]) {
    assert.equal(providerFailureDetails({ providerDiagnostic: invalid }).providerDiagnostic, null);
    assert.equal(providerFailureSummary({ providerDiagnostic: invalid }), '');
  }
});

test('the panel consumer keeps a saved diagnostic and does not advance to another candidate', async t => {
  const oldUrl = process.env.SUPABASE_URL, oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.invalid'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-not-secret-'.repeat(4);
  t.after(() => { oldUrl === undefined ? delete process.env.SUPABASE_URL : process.env.SUPABASE_URL = oldUrl;
    oldKey === undefined ? delete process.env.SUPABASE_SERVICE_ROLE_KEY : process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey; });
  let posts = 0;
  const fetchImpl = async (_url, init) => {
    if (init.method === 'GET') return response(200, { providerCacheContract: 'designpro.gemini-provider-cache.v1',
      cacheOnly: true, modes: ['atlas-panel'] });
    posts++;
    return response(409, { error: 'provider_outcome_unknown', retryable: false, providerFailureRecorded: true,
      providerDiagnostic: diagnostic, providerRetryDisposition: 'operator_required', providerOutcome: 'unknown' });
  };
  await assert.rejects(atlas._test.callAtlasPanelEdge(options(fetchImpl).body, { fetchImpl, wait: async () => {} }), error => {
    assert.equal(error.code, 'provider_outcome_unknown');
    assert.equal(error.retryable, false);
    assert.deepEqual(error.providerDiagnostic, diagnostic);
    assert.match(error.message, /phase=response_body/);
    return true;
  });
  assert.equal(posts, 1);
});
