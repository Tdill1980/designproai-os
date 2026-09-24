import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const source = readFileSync(new URL('../supabase/functions/production-panel-proof/index.ts', import.meta.url), 'utf8');
const match = source.match(/const flatProductionInstructions = (\[[\s\S]*?\n    \]);/);
assert.ok(match, 'real production instruction array must be extractable');
const instructions = runInNewContext(match[1], {}, { timeout: 1000 });
test('Call 1 retains master-first authoring, photography, brand and rectangular production instructions', () => {
  for (const prefix of ['MASTER WRAP AUTHORING:', 'SURFACE DERIVATION:', 'PHOTOGRAPHY FIDELITY:',
    'PRODUCTION GEOMETRY:', 'CONTINUOUS ARTWORK:', 'BRAND FIDELITY:']) {
    assert.ok(instructions.some(x => x.startsWith(prefix)), prefix);
  }
  assert.ok(instructions.some(x => x.includes('5-inch bleed')));
});
test('separated-artwork instruction count agrees with the real runtime guard', () => {
  const guard = source.match(/flatProductionInstructions\.length\s*===\s*(\d+)/);
  assert.ok(guard, 'inspect the actual guard, not a duplicated expected count');
  assert.equal(instructions.length, Number(guard[1]),
    'Runtime would reject the prompt before generation: instruction array and count guard differ');
});
test('function keeps its own source identity header for post-deploy invocation proof', () => {
  assert.match(source, /"X-DesignPro-Source-Sha": RELEASE_SOURCE_SHA/);
  assert.match(source, /resolveDesignProInternalCaller/);
});
