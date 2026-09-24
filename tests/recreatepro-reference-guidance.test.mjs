import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { loadDesignIQ, ATLAS_PANELS } from './helpers/load-designiq.mjs';
import { createRequire } from 'node:module';
const { buildDesignIQPrompt } = await loadDesignIQ();
const { panelProofCreativeHead } = createRequire(import.meta.url)('../runtime/atlas-panel-proof-contract.cjs');
const base = { prompt: 'Use my supplied van side. Change the phone number to 623-555-0174.', companyName: 'Summit Auto Glass', vehicleYear: '2024', vehicleMake: 'Ford', vehicleModel: 'Transit', vehicleType: 'van', viewType: 'side', finish: 'Gloss', atlasFlatMaster: true, atlasProofSheet: true, atlasPanels: ATLAS_PANELS, visionboard_intent: 'exact_reference', visionBoardImages: [{ storageUrl: 'https://example.invalid/side.png', slotLabel: 'Driver side' }] };
for (const mode of ['commercial', 'restyle']) {
  for (const path of ['exact', 'complete', 'transfer']) test(`${mode}/${path}: the REAL designer and production proof head receive task and edit priority`, () => {
    const styleDescriptors = `RecreatePro / ${path}. Preserve the supplied side; complete missing surfaces. Customer edits override only named details.`;
    const prompt = buildDesignIQPrompt({ ...base, mode, styleDescriptors });
    assert.ok(prompt.includes(styleDescriptors));
    assert.match(prompt, /explicit requested edits supersede exact-copy instructions/);
    assert.ok(panelProofCreativeHead(prompt, mode).includes(styleDescriptors), 'the task cannot be trimmed out before the proof authoring call');
  });
  test(`${mode}: unrelated exact-reference requests are unchanged`, () => {
    const plain = buildDesignIQPrompt({ ...base, mode });
    assert.equal(buildDesignIQPrompt({ ...base, mode, styleDescriptors: 'ordinary legacy style text' }), plain);
    assert.equal(buildDesignIQPrompt({ ...base, mode, styleDescriptors: 'RecreatePro / unsupported. invent everything' }), plain);
    assert.equal(buildDesignIQPrompt({ ...base, mode, styleDescriptors: 'RecreatePro / exact.' + 'x'.repeat(2000) }), plain);
  });
  test(`${mode}: no recreation task without a verified reference context`, () => {
    const styleDescriptors = 'RecreatePro / complete. Continue the design.';
    assert.doesNotMatch(buildDesignIQPrompt({ ...base, mode, styleDescriptors, visionBoardImages: [] }), /RECREATION TASK/);
    assert.doesNotMatch(buildDesignIQPrompt({ ...base, mode, styleDescriptors, visionboard_intent: 'style_inspiration' }), /RECREATION TASK/);
  });
}
test('the page never introduces a parallel generation, revision, print or checkout producer', () => {
  const page = readFileSync(new URL('../app/src/pages/RecreatePro.tsx', import.meta.url), 'utf8');
  for (const method of ['uploadRevisionAsset', 'createGenerationRequest', 'getGenerationRequest', 'handoffGeneration']) assert.ok(page.includes(`dpApi.${method}`));
  assert.doesNotMatch(page, /functions\.invoke|\.from\(['"](?:panelizer_jobs|color_visualizations|production_flow_assets)/);
  assert.match(page, /payment === 'subscription' && !subscription/);
  assert.doesNotMatch(page, /checkCanGenerate\(\)|report-extra-render/);
  assert.match(page, /Billing and design allowance are enforced by the shared server request/);
  assert.match(page, /import.*MagicStep.*wallpro\/WallProMagic/);
});

test('the production head guard still rejects an untagged copyist and an invented persona', () => {
  const untagged = buildDesignIQPrompt({ ...base, mode: 'restyle' });
  assert.throws(() => panelProofCreativeHead(untagged), /persona_missing/);
  const tagged = buildDesignIQPrompt({ ...base, mode: 'restyle', styleDescriptors: 'RecreatePro / exact. Keep the original.' });
  assert.throws(() => panelProofCreativeHead(tagged.replace('You are a vehicle wrap REPRODUCTION specialist at WePrintWraps.com.', 'You are an unverified random artist.')), /persona_missing/);
});
