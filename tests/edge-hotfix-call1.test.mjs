import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { execFileSync } from 'node:child_process';
import { loadDesignIQ, ATLAS_PANELS } from './helpers/load-designiq.mjs';
import { resolveEsbuild } from '../scripts/build-control-prompt.mjs';
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

// A string existing in the file is not evidence that the provider receives it.
// Execute the real assembly, turn selection and BOTH JSON request builders.
// Only image responses/attachments are controlled fixtures; no network occurs.
function section(from, to, text = source) {
  const start = text.indexOf(from), end = text.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `locate actual request section: ${from}`);
  return text.slice(start, end);
}
function ts(code) {
  return execFileSync(resolveEsbuild(), ['--loader=ts', '--format=cjs'], {
    input: code, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
}
const proofModule = { exports: {} };
runInNewContext(ts(readFileSync(new URL('../supabase/functions/_shared/atlas-panel-proof-prompt.ts', import.meta.url), 'utf8')),
  { module: proofModule, exports: proofModule.exports }, { timeout: 2000 });
const fixture = {
  mode: 'commercial', companyName: 'Juniper Cycle Works', phone: '(520) 555-0192',
  website: 'junipercycle.example', finish: 'Gloss',
  prompt: 'Juniper Cycle Works: a custom logo and a photographic image of a bicycle mechanic. No neon colors.',
  vehicleYear: '2023', vehicleMake: 'Dodge', vehicleModel: 'Ram ProMaster 2500', vehicleType: 'van',
};
const rows = [
  'DRIVER: 233" wide x 67.5" high', 'PASSENGER: 233" wide x 67.5" high',
  'ROOF: 79.3" wide x 75.4" high', 'HOOD: 83.6" wide x 57.6" high',
  'FRONT: 142.5" wide x 44" high', 'REAR: 83.6" wide x 45.9" high',
];
function compileWire(mutation = '') {
  const assembly = section('    const customerAssets =', '    const parts: Array<Record<string, unknown>> = [{ text: prompt }];');
  const turns = section('    const anchorTurns =', '    let designTurnRequestId:');
  const design = section('      const designUser =', '      // ITS OWN CACHE KEY.');
  const model = section('    const modelRequest = JSON.stringify({', '    // ═══ THE RECOVERY CONTRACT');
  const code = `(() => { "use strict";
    ${assembly}
    const parts = [{ text: prompt }];
    const creativeParts = [{ text: 'TEST CREATIVE REFERENCE' }];
    const structuralParts = [{ text: 'TEST STRUCTURAL REFERENCE' }];
    ${turns}
    ${mutation}
    let designExchange = null, designPayload = null;
    if (turns) {
      ${design}
      designPayload = JSON.parse(designRequest);
      designExchange = { user: designUser, model: { role: 'model', parts: [
        { inlineData: { mimeType: 'image/png', data: 'TEST_ONLY' }, thoughtSignature: 'TEST_SIGNATURE' }
      ] } };
    }
    ${model}
    return { prompt, creativeHead, phase1Audit, authoringPayloadAudit,
      sheetDesignInstructions, productionProofInstructions, designPayload,
      payload: JSON.parse(modelRequest) };
  })()`;
  assert.doesNotMatch(code, /await\s+(?:fetch|runDurableImageProviderRequest)\s*\(/);
  return ts(code);
}
const wireCode = compileWire();
async function wire(overrides = {}, code = wireCode) {
  const body = { ...fixture, ...overrides };
  const { buildDesignIQPrompt } = await loadDesignIQ();
  return runInNewContext(code, { body, buildDesignIQPrompt, ...proofModule.exports,
    field: name => String(body[name] ?? '').trim(), customerPrompt: body.prompt,
    intake: null, panelRows: rows, ATLAS_PANELS }, { timeout: 2000 });
}
function assertCampaign(text) {
  for (const instruction of instructions.slice(0, -1)) {
    assert.ok(text.includes(instruction), `not sent to provider: ${instruction.split(':')[0]}`);
  }
  assert.ok(!text.includes(instructions.at(-1)), 'clean-only output contract must not contradict TriZone');
}
for (const mode of ['commercial', 'restyle']) {
  for (const separatedArtwork of [false, undefined]) {
    for (const anchorTurns of [false, true, undefined]) {
      test(`${mode}, separated=${separatedArtwork}, anchor=${anchorTurns}: actual outbound requests carry authoring and underlay`, async () => {
        const out = await wire({ mode, separatedArtwork, anchorTurns });
        const first = (out.designPayload || out.payload).contents[0].parts[0].text;
        assertCampaign(first);
        assert.ok(first.startsWith(out.creativeHead + '\n\n'), 'original persona is still first, unchanged');
        assert.ok(first.includes(fixture.prompt), 'raw customer brief survives');
        for (const row of rows) assert.ok(first.includes(row), row);
        const layout = out.payload.contents.at(-1).parts[0].text;
        for (const instruction of out.productionProofInstructions) assert.ok(layout.includes(instruction));
        for (const zone of ['ZONE 1', 'ZONE 2', 'ZONE 3']) assert.ok(layout.includes(zone));
        assert.equal(out.authoringPayloadAudit.masterCampaignInjected, true);
        assert.equal(out.authoringPayloadAudit.productionUnderlayInjected, true);
        assert.equal(out.payload.generationConfig.imageConfig.imageSize, '4K');
        assert.equal(out.payload.contents.length, anchorTurns === false ? 1 : 3);
        if (out.designPayload) {
          assert.deepEqual(out.payload.contents[0], out.designPayload.contents[0]);
          assert.equal(out.payload.contents[1].parts[0].thoughtSignature, 'TEST_SIGNATURE');
        }
      });
    }
  }
}
for (const mode of ['commercial', 'restyle']) {
  test(`${mode}: separated request keeps the original one-turn contract`, async () => {
    const out = await wire({ mode, separatedArtwork: true, anchorTurns: true });
    assert.equal(out.designPayload, null);
    assert.equal(out.payload.contents.length, 1);
    assert.equal(out.payload.contents[0].parts[0].text,
      [out.creativeHead, ...instructions].join('\n\n'));
    assert.equal(out.sheetDesignInstructions.length, 0);
  });
  test(`${mode}: exact-reference sheet keeps reproduction authority rather than a new master brief`, async () => {
    const out = await wire({ mode, anchorTurns: false, visionboard_intent: 'exact_reference',
      styleDescriptors: 'RecreatePro / exact. Preserve supplied artwork; change only the requested details.',
      customerAssets: [{ storagePath: 'atlas-call1-inputs/' + 'a'.repeat(64) + '.png' }] });
    assert.equal(out.sheetDesignInstructions.length, 0);
    assert.ok(!out.payload.contents[0].parts[0].text.includes(instructions[0]));
    assert.ok(out.payload.contents[0].parts[0].text.startsWith(out.creativeHead + '\n\n'));
  });
}
test('payload tests convict detached photography even when it still exists in the file and audit', async () => {
  const broken = compileWire('if (turns) turns.design = turns.design.replace(sheetDesignInstructions[2], "");');
  const out = await wire({ anchorTurns: true }, broken);
  assert.throws(() => assertCampaign(out.designPayload.contents[0].parts[0].text), /PHOTOGRAPHY FIDELITY/);
});
