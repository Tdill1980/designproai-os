import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { healthyEdgeOptions } from '../scripts/edge-options-health.mjs';
const sha = 'a'.repeat(40);

test('WallPro keeps its existing 204 OPTIONS contract', () => {
  assert.equal(healthyEdgeOptions('render-wall-view', 204, null, sha, false), true);
  const handler = readFileSync(new URL('../supabase/functions/render-wall-view/handler.ts', import.meta.url), 'utf8');
  assert.match(handler, /req\.method === 'OPTIONS'\) return new Response\(null, \{ status: 204, headers: CORS \}\)/);
});
test('Call-1 retains its exact 200 plus source SHA requirement', () => {
  assert.equal(healthyEdgeOptions('production-panel-proof', 200, sha, sha, true), true);
  for (const actual of [null, '', 'b'.repeat(40)]) assert.equal(healthyEdgeOptions('production-panel-proof', 200, actual, sha, true), false);
  assert.equal(healthyEdgeOptions('production-panel-proof', 204, sha, sha, true), false);
});
test('neither function accepts error, redirect, pending or unexpected success statuses', () => {
  for (const fn of ['render-wall-view', 'production-panel-proof']) {
    for (const status of [0, 201, 202, 301, 302, 400, 401, 403, 404, 429, 500, 502, 503]) {
      assert.equal(healthyEdgeOptions(fn, status, sha, sha, true), false, fn + ':' + status);
    }
  }
  assert.equal(healthyEdgeOptions('render-wall-view', 200, null, sha, false), false);
});
test('unknown functions, malformed SHAs and absent stamp-policy flags fail closed', () => {
  for (const fn of ['all', '', 'constructor', undefined]) assert.equal(healthyEdgeOptions(fn, 204, null, sha, false), false);
  for (const expected of ['', 'main', 'abc123', undefined]) assert.equal(healthyEdgeOptions('render-wall-view', 204, null, expected, false), false);
  assert.equal(healthyEdgeOptions('render-wall-view', 204, null, sha, undefined), false);
  assert.equal(healthyEdgeOptions('render-wall-view', 204, null, sha, true), false);
  assert.equal(healthyEdgeOptions('render-wall-view', 204, sha, sha, true), true);
});
test('the production deployer uses the tested predicate after live readback', () => {
  const script = readFileSync(new URL('../scripts/deploy-edge-hotfix.mjs', import.meta.url), 'utf8');
  assert.ok(script.includes("import { healthyEdgeOptions } from './edge-options-health.mjs';"));
  assert.ok(script.includes('healthyEdgeOptions(FUNCTION, response.status, receipt.smoke.source_sha, sha, hasStamp)'));
  assert.ok(script.indexOf('DEPLOYED SOURCE MISMATCH') < script.indexOf('healthyEdgeOptions(FUNCTION'));
  assert.ok(script.includes('after.version <= before.version'));
  assert.ok(script.includes('after.verify_jwt !== before.verify_jwt'));
});
