import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const { registerDesignProStandaloneClaimant } = require('./designpro-standalone-claimant.cjs');
const settle = () => new Promise((resolve) => setImmediate(resolve));

test('concurrent ticks reserve slots while database claims are still pending', async (t) => {
  const pending = [];
  let health;
  const sb = { rpc: (name) => name === 'claim_designpro_stage'
    ? new Promise((resolve) => pending.push(resolve)) : Promise.resolve({ data: null, error: null }) };
  const worker = registerDesignProStandaloneClaimant({
    app: { get: (_path, fn) => { health = fn; } }, supabase: sb,
    workerId: 'test-graph-capacity', port: 3001,
  });
  t.after(() => worker.stop());
  await settle();
  let state;
  health(null, { json: (value) => { state = value; } });
  const ticks = Array.from({ length: state.stageConcurrency + 3 }, () => worker.tick());
  await settle();
  assert.equal(pending.length, state.stageConcurrency, 'a slow claim must not over-admit work');
  health(null, { json: (value) => { state = value; } });
  assert.equal(state.pendingClaims, state.stageConcurrency);
  pending.forEach((resolve) => resolve({ data: null, error: null }));
  await Promise.all(ticks);
  await settle();
  health(null, { json: (value) => { state = value; } });
  assert.equal(state.pendingClaims, 0);
  assert.equal(state.inFlight, 0);
  await settle();
  assert.equal(pending.length, state.stageConcurrency, 'empty claims must not create a hot polling loop');
});

test('stopping during a database claim prevents the claimed stage from executing', async (t) => {
  let release;
  const failed = [];
  const sb = {
    rpc: (name, args) => {
      if (name === 'claim_designpro_stage') return new Promise((resolve) => { release = resolve; });
      if (name === 'fail_designpro_stage') failed.push(args);
      return Promise.resolve({ data: null, error: null });
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'run-1', workflow_type: 'designpro.production_pack' }, error: null }) }) }) }),
  };
  const worker = registerDesignProStandaloneClaimant({ app: { get() {} }, supabase: sb, workerId: 'test-stop' });
  t.after(() => worker.stop());
  await settle();
  worker.stop();
  release({ data: { id: 'stage-1', run_id: 'run-1', lease_token: 'lease-1', stage_key: 'output.build' }, error: null });
  await settle();
  assert.equal(failed.length, 1);
  assert.equal(failed[0].p_error_code, 'worker_stopping');
  assert.equal(failed[0].p_retryable, true);
});
