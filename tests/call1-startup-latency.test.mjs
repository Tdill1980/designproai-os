import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { loadDesignIQ, ATLAS_PANELS } from './helpers/load-designiq.mjs';
import { resolveEsbuild } from '../scripts/build-control-prompt.mjs';

const require = createRequire(import.meta.url);
const { buildPanelProofPrompt, panelProofCreativeHead, SYSTEM_JOB, SHEET_LAYOUT } = require('../runtime/atlas-panel-proof-contract.cjs');
const source = readFileSync(new URL('../supabase/functions/production-panel-proof/index.ts', import.meta.url), 'utf8');
const start = source.indexOf('    const customerAssets =');
const end = source.indexOf('    const parts: Array<Record<string, unknown>> = [{ text: prompt }];', start);
assert.ok(start > 0 && end > start, 'execute the real edge request assembly, not a duplicate');
const section = source.slice(start, end);

function compile(inject = '') {
  const code = section.replace('    const phase1Audit = {', `${inject}\n    const phase1Audit = {`);
  // Deno modules are strict. Sloppy VM tests concealed an undeclared prompt
  // assignment by creating a global, while production threw ReferenceError.
  return execFileSync(resolveEsbuild(), ['--loader=ts', '--format=cjs'], {
    input: `(() => { "use strict"; ${code}\nreturn {prompt, creativeHead, phase1Audit, customerAssets}; })()`,
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}
const compiled = compile();
const fixture = {
  separatedArtwork: true, mode: 'commercial',
  prompt: 'Create a wrap for Juniper Cycle Works. Make a logo and include a photo of a bicycle mechanic. No neon colors.',
  companyName: 'Juniper Cycle Works', phone: '(520) 555-0192', website: 'junipercycle.example',
  finish: 'Gloss', vehicleYear: '2022', vehicleMake: 'Ford', vehicleModel: 'Transit', vehicleType: 'van',
};

async function assemble(overrides = {}, code = compiled, transformHead = value => value) {
  const body = { ...fixture, ...overrides };
  const { buildDesignIQPrompt } = await loadDesignIQ();
  const context = {
    body, field: name => String(body[name] ?? '').trim(), customerPrompt: '', intake: null, panelRows: [],
    buildDesignIQPrompt, buildPanelProofPrompt,
    panelProofCreativeHead: value => transformHead(panelProofCreativeHead(value)),
    SYSTEM_JOB, SHEET_LAYOUT, ATLAS_PANELS,
  };
  const output = runInNewContext(code, context, { timeout: 2000 });
  assert.equal(Object.hasOwn(context, 'prompt'), false, 'each request keeps its own prompt; no global mutation');
  return output;
}

for (const mode of ['commercial', 'restyle']) {
  for (const separatedArtwork of [true, false]) {
    test(`${mode}, separated=${separatedArtwork}: reaches provider boundary without ReferenceError or stale audit`, async () => {
      const result = await assemble({ mode, separatedArtwork });
      assert.ok(result.prompt.startsWith(result.creativeHead + '\n\n'), 'retain the exact selected designer head');
      assert.ok(result.prompt.includes(fixture.prompt), 'preserve raw client wording including negative preferences');
      assert.match(result.prompt, /FLAT PRODUCTION DESTINATION:/);
      assert.match(result.prompt, /5-inch bleed/);
      for (const [key, value] of Object.entries(result.phase1Audit)) {
        if (key !== 'contract') assert.equal(value, true, key);
      }
    });
  }
}

test('audit still rejects a dropped designer head', async () => {
  const broken = compile('prompt = prompt.replace(creativeHead, "");');
  await assert.rejects(assemble({}, broken), /panel_proof_phase1_contract_missing:.*graphicDesignerPersonaInjected/);
});

test('audit still rejects missing native-knowledge or amplification guidance', async () => {
  const removeKnowledge = head => head.split('\n').filter(line => !/\bnative\b.*\bknowledge\b|DESIGN AMPLIFICATION:/i.test(line)).join('\n');
  await assert.rejects(assemble({}, compiled, removeKnowledge), /panel_proof_phase1_contract_missing:.*nativeGeminiImageKnowledgeInjected/);
});

test('audit still rejects a missing flat output instruction', async () => {
  const broken = compile('prompt = prompt.replace(flatProductionInstructions[0], "");');
  await assert.rejects(assemble({}, broken), /panel_proof_phase1_contract_missing:.*flatPanelProductionProofInjected/);
});

test('audit still rejects a missing geometry instruction', async () => {
  const broken = compile('prompt = prompt.replace(flatProductionInstructions[1], "");');
  await assert.rejects(assemble({}, broken), /panel_proof_phase1_contract_missing:.*templateLayoutLocked/);
});

test('request preparation is local: this harness does not call Gemini or storage', async () => {
  assert.doesNotMatch(section, /await\s+(?:fetch|runDurableImageProviderRequest)\s*\(/);
  const a = await assemble({ prompt: 'Juniper Cycle Works, a 1980s BMX racing style.' });
  const b = await assemble({ prompt: 'Orchid Dental, a calm contemporary photographic design.' });
  assert.notEqual(a.prompt, b.prompt);
  assert.ok(!b.prompt.includes('1980s BMX'));
});
