/**
 * ISSUE 5: a claimant whose run-production-flow probe gets 404 (the function
 * is not deployed) must refuse to claim, and re-probe hourly rather than every
 * five minutes. Measured 2026-09-25: 576 POST run-production-flow -> 404 in
 * 24 h from the droplet (2 claimants x 288) and 34,371 claim_workflow_stage
 * RPCs a day, because "not 401/403" read a 404 as healthy.
 *
 * The REAL probe and claim gate are executed from both worker files (the
 * bundled .cjs files start timers and a Supabase client on require, so the
 * functions are lifted out and run against a fake fetch and a fake RPC).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const probe = require('../worker/edge-auth-probe.cjs');

test('verdicts: 404 and 5xx are not healthy; only 401/403 are credential failures', () => {
  const v = s => probe.authProbeVerdict(s);
  for (const s of [200, 202, 400, 409, 422]) assert.equal(v(s).ok, true, String(s));
  for (const s of [401, 403]) assert.deepEqual({ ...v(s) }, { ok: false, reason: 'credentials_rejected', ttlMs: probe.AUTH_PROBE_TTL_MS });
  assert.deepEqual({ ...v(404) }, { ok: false, reason: 'function_not_deployed', ttlMs: probe.NOT_DEPLOYED_TTL_MS });
  for (const s of [500, 502, 503, 546, 0, undefined, 'x']) assert.equal(v(s).ok, false, String(s));
  assert.equal(probe.NOT_DEPLOYED_TTL_MS, 60 * 60_000);
  assert.match(probe.authProbeRefusalMessage('T', v(404), 404), /not deployed \(HTTP 404\)/);
  assert.match(probe.authProbeRefusalMessage('T', v(401), 401), /rejected this runner's credentials \(HTTP 401\)/);
});

for (const [file, tag, claimLimit] of [
  ['designpro-workflow.cjs', 'DESIGNPRO-WORKFLOW', 'maxActiveClaims'],
  ['designpro-entice-workflow.cjs', 'DESIGNPRO-ENTICE', '1'],
]) {
  const src = readFileSync(new URL(`../worker/${file}`, import.meta.url), 'utf8');
  const start = src.indexOf('const { authProbeVerdict, authProbeRefusalMessage } = require("./edge-auth-probe.cjs");');
  const gate = src.indexOf('async function drainClaims(db, workerId) {', start);
  const gateEnd = src.indexOf('while (activeClaims <', gate);
  assert.ok(start > 0 && gate > start && gateEnd > gate, `${file}: probe/gate seams moved`);

  function harness(statuses) {
    const calls = { fetch: 0, rpc: 0, errors: [] };
    let clock = 1_000_000;
    const code = `${src.slice(start, gateEnd)}
        return "claimed"; } finally { pollBusy = false; } }
      ({ runnerCanAuthenticate, drainClaims, advance: ms => { clockRef.now += ms; } });`;
    const clockRef = { now: clock };
    const ctx = {
      require: name => { assert.equal(name, './edge-auth-probe.cjs'); return probe; },
      SUPABASE_URL: 'https://example.supabase.co', SERVICE_KEY: 'k', WORKER_SECRET: '',
      process: { env: {} }, clockRef, pollBusy: false, activeClaims: 0, maxActiveClaims: 1,
      Date: { now: () => clockRef.now },
      console: { error: (m) => calls.errors.push(String(m)), log() {} },
      fetch: async (url, init) => {
        assert.equal(url, 'https://example.supabase.co/functions/v1/run-production-flow');
        assert.equal(init.method, 'POST');
        const next = statuses[Math.min(calls.fetch, statuses.length - 1)];
        calls.fetch += 1;
        if (next instanceof Error) throw next;
        return { status: next };
      },
    };
    const api = runInNewContext(`let pollBusy = false; let activeClaims = 0; ${code}`, ctx, { timeout: 2000 });
    return { api, calls };
  }

  test(`${file}: a 404 probe refuses to claim and re-probes hourly, not every five minutes`, async () => {
    const { api, calls } = harness([404, 404, 200]);
    assert.equal(await api.drainClaims({}, 'w'), 0, 'refused: returns before claim_workflow_stage');
    assert.equal(calls.errors.length, 1);
    assert.match(calls.errors[0], new RegExp(`^\\[${tag}\\] refusing to claim: run-production-flow is not deployed \\(HTTP 404\\)`));
    api.advance(5 * 60_000 + 1);
    assert.equal(await api.drainClaims({}, 'w'), 0);
    assert.equal(calls.fetch, 1, 'the 404 verdict is cached past the old five-minute TTL');
    api.advance(55 * 60_000);
    assert.equal(await api.drainClaims({}, 'w'), 0);
    assert.equal(calls.fetch, 2, 're-probed after an hour');
    api.advance(60 * 60_000 + 1);
    assert.equal(await api.drainClaims({}, 'w'), 'claimed', 'a later deploy is picked up on its own');
  });

  test(`${file}: accepted credentials still claim; 401 still refuses; transport errors keep the prior verdict`, async () => {
    let h = harness([400]);
    assert.equal(await h.api.drainClaims({}, 'w'), 'claimed');
    h = harness([401]);
    assert.equal(await h.api.drainClaims({}, 'w'), 0);
    assert.match(h.calls.errors[0], /rejected this runner's credentials \(HTTP 401\)/);
    h = harness([503]);
    assert.equal(await h.api.drainClaims({}, 'w'), 0);
    h = harness([new Error('ECONNRESET')]);
    assert.equal(await h.api.drainClaims({}, 'w'), 'claimed', 'a network blip does not block a runner with no verdict yet');
  });

  test(`${file}: the claim loop is behind the probe gate`, () => {
    const body = src.slice(gate, gateEnd);
    assert.match(body, /if \(!\(await runnerCanAuthenticate\(\)\)\) return activeClaims;/);
    assert.ok(src.indexOf('claim_workflow_stage', gate) > gateEnd, 'claim RPC comes after the gate');
    assert.equal(src.includes('response.status !== 401 && response.status !== 403'), false, 'old 404-as-healthy check is gone');
    assert.ok(src.includes(`while (activeClaims < ${claimLimit})`));
  });
}

test('the worker image ships the helper and the runbook exists', () => {
  const dockerfile = readFileSync(new URL('../worker/Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY --chown=node:node worker\/ \./);
  const runbook = readFileSync(new URL('../docs/runbooks/stop-legacy-worker.md', import.meta.url), 'utf8');
  assert.match(runbook, /DESIGNPRO_PANEL_POLLER_ENABLED=false/);
  assert.match(runbook, /## Rollback/);
});
