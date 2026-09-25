import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APPROVED, classify, FAST_PATHS, SOURCE, parseDiff, requireSha, releaseIgnorePaths } from '../scripts/edge-hotfix-policy.mjs';
const change = (path, status = 'M') => ({ path, status });
test('each approved function and its focused tests use fast lane', () => {
  for (const [fn, spec] of Object.entries(APPROVED)) {
    const result = classify([...spec.sources, ...spec.tests].map(p => change(p)));
    assert.equal(result.lane, 'fast-edge');
    assert.equal(result.function_name, fn);
  }
});
for (const path of ['runtime/index.js', 'gateway/src/server.mjs', 'supabase/migrations/20260924100000.sql',
  'supabase/functions/_shared/cors.ts', 'supabase/functions/_shared/release-source.ts',
  'supabase/functions/_shared/atlas-panel-proof-prompt.ts', 'supabase/functions/other/index.ts',
  'supabase/functions/production-panel-proof/deno.json', 'supabase/config.toml', 'ops/compose.yaml',
  '.github/workflows/deploy-edge-hotfix.yml', 'scripts/deploy-edge-hotfix.mjs', 'package-lock.json',
  'app/src/auth.ts', 'README.md']) {
  test(`mixed change forces full release: ${path}`, () => {
    assert.equal(classify([change(SOURCE), change(path)]).lane, 'full');
  });
}
for (const status of ['D', 'R100', 'C100', 'T', 'A']) test(`source status ${status} is not a hotfix`, () => {
  assert.equal(classify([change(SOURCE, status)]).lane, 'full');
});
test('empty diff is full and malformed input fails closed', () => {
  assert.equal(classify([]).lane, 'full');
  assert.throws(() => parseDiff('M\0'));
  assert.deepEqual(parseDiff(`M\0${SOURCE}\0`), [change(SOURCE)]);
});
test('large diff cannot hide protected files', () => {
  assert.equal(classify([change(SOURCE), ...Array.from({ length: 1000 }, (_, i) => change(`runtime/${i}.js`))]).lane, 'full');
  assert.ok(FAST_PATHS.length < 300);
  for (const path of FAST_PATHS) assert.doesNotMatch(path, /[*!?\[\]{}\\\n]/);
});
test('SHA input rejects short values, refs, options and shell syntax', () => {
  for (const value of ['', 'main', 'abc123', '--help', 'a'.repeat(40) + ';']) assert.throws(() => requireSha(value));
  assert.equal(requireSha('a'.repeat(40)), 'a'.repeat(40));
});
test('full-release push and PR exclusions exactly match the reviewed allowlist', () => {
  const yaml = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
  const blocks = releaseIgnorePaths(yaml);
  assert.equal(blocks.length, 2);
  for (const block of blocks) assert.deepEqual(block, FAST_PATHS);
  for (const key of ['executable-contracts:', 'supabase-shadow:', 'immutable-archive:', 'production-migrate:']) assert.ok(yaml.includes(key));
});
test('hotfix workflow has exact intent, production isolation and shared deploy mutex', () => {
  const yaml = readFileSync(new URL('../.github/workflows/deploy-edge-hotfix.yml', import.meta.url), 'utf8');
  for (const text of ['name: Deploy Edge Hotfix', 'exact_main_sha:', 'function_name:', 'confirmation:',
    'DEPLOY_EDGE_TO_DESIGNPROAI_PRODUCTION', 'designproai-production', 'designproai-production-dark-deploy',
    'cancel-in-progress: false', 'persist-credentials: false']) assert.ok(yaml.includes(text), text);
  assert.doesNotMatch(yaml, /secrets set|db push|docker build|ssh |deploy all|\[skip ci\]/i);
});
