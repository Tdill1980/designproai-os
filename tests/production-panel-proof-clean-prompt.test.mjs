import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { loadDesignIQ, ATLAS_PANELS } from './helpers/load-designiq.mjs';
import { resolveEsbuild } from '../scripts/build-control-prompt.mjs';

const require = createRequire(import.meta.url);
const proofSource = readFileSync(new URL('../supabase/functions/_shared/atlas-panel-proof-prompt.ts', import.meta.url), 'utf8');
const proofModule = { exports: {} };
const proofCode = execFileSync(resolveEsbuild(), ['--loader=ts', '--format=cjs'], {
  input: proofSource, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
runInNewContext(proofCode, {module: proofModule, exports: proofModule.exports}, {timeout: 2000});
const { buildPanelProofPrompt, panelProofCreativeHead, SYSTEM_JOB, SHEET_LAYOUT } = proofModule.exports;
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
    body, field: name => String(body[name] ?? '').trim(), customerPrompt: body.customerPrompt || '', intake: null, panelRows: body.panelRows || [],
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
      if (separatedArtwork) assert.match(result.prompt, /FLAT PRODUCTION DESTINATION:/);
      else {
        assert.ok(result.prompt.includes(SYSTEM_JOB));
        assert.ok(result.prompt.includes(SHEET_LAYOUT));
        for (const zone of ['ZONE 1', 'ZONE 2', 'ZONE 3']) assert.ok(result.prompt.includes(zone));
        assert.match(result.prompt, /ZONE 2 UNDERLAY:/);
        assert.doesNotMatch(result.prompt, /FLAT PRODUCTION DESTINATION:/);
      }
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


test('protected originals stay out of the image attachments; customer references remain', async () => {
  const reference = {storagePath: 'atlas-call1-inputs/' + 'a'.repeat(64) + '.png', contentHash: 'a'.repeat(64)};
  const logo = {storagePath: 'users/owner/revisions/revision/inputs/logo/' + 'b'.repeat(64) + '.svg', contentHash: 'b'.repeat(64), contentType: 'image/svg+xml'};
  const {customerAssets} = await assemble({logoAsset: logo, customerAssets: [reference, logo,
    {storagePath: 'atlas-call1-inputs/' + 'b'.repeat(64) + '.png', contentHash: logo.contentHash},
    {storagePath: 'atlas-call1-inputs/' + 'c'.repeat(64) + '.png', assetRole: 'logo'},
    {storagePath: 'atlas-call1-inputs/' + 'd'.repeat(64) + '.png', role: 'typography'},
    {storagePath: 'atlas-call1-inputs/' + 'e'.repeat(64) + '.png', contentType: 'application/pdf'},
  ]});
  assert.equal(customerAssets.length, 1);
  assert.equal(customerAssets[0].storagePath, reference.storagePath);
  assert.match(source, /for \(const asset of customerAssets\)/);
});

test('separated artwork cannot fall back to a labelled container or a full proof example', () => {
  assert.ok(source.includes('mode: body.separatedArtwork === true ? "artwork" : "template"'));
  assert.ok(source.includes('for (const pinned of (body.separatedArtwork === true ? [] : PINNED_INPUTS))'));
  assert.ok(source.includes('if (body.separatedArtwork === true) throw renderError'));
});


const livePanels = [
  'DRIVER: 233" wide x 67.5" high', 'PASSENGER: 233" wide x 67.5" high',
  'HOOD: 83.6" wide x 57.6" high', 'ROOF: 79.3" wide x 75.4" high',
  'FRONT: 142.5" wide x 44" high', 'REAR: 83.6" wide x 45.9" high',
];

test('the actual single-turn TriZone route keeps all bands, the raw BigFoot brief and supplied panel rows', async () => {
  const brief = "Make Raptor look like a 1980's style monster truck with BigFoot look. Custom distressed aged bright blue with pin striping";
  const result = await assemble({ separatedArtwork: undefined, anchorTurns: false,
    mode: 'restyle', customerPrompt: brief, prompt: brief,
    companyName: '', phone: '', website: '',
    vehicleYear: '2021', vehicleMake: 'Ford', vehicleModel: 'Raptor', vehicleType: 'truck',
    panelRows: livePanels });
  assert.ok(result.prompt.startsWith(result.creativeHead + '\n\n'));
  assert.ok(result.prompt.includes(brief));
  assert.ok(result.prompt.includes(SYSTEM_JOB));
  assert.ok(result.prompt.includes(SHEET_LAYOUT));
  for (const row of livePanels) assert.ok(result.prompt.includes(row), row);
  for (const band of ['ZONE 1', 'ZONE 2', 'ZONE 3']) assert.ok(result.prompt.includes(band));
  assert.match(result.prompt, /same continuous background artwork beneath/);
  assert.match(result.prompt, /fully opaque, edge-to-edge artwork/);
  assert.match(result.prompt, /5-inch bleed on all four edges/);
  assert.doesNotMatch(result.prompt, /FLAT PRODUCTION DESTINATION:/);
  assert.doesNotMatch(result.prompt, /BACKGROUND ARTWORK ONLY — NO LETTERING/);
});

test('the live route retains exact supplied services and promo text', async () => {
  const result = await assemble({ separatedArtwork: undefined, anchorTurns: false,
    services: ['Bicycle Repair', 'Mountain Bike Service'], promo: 'Weekend Service',
    tagline: 'Ride More', panelRows: livePanels });
  for (const value of ['Bicycle Repair', 'Mountain Bike Service', 'Weekend Service', 'Ride More',
    fixture.companyName, fixture.phone, fixture.website]) assert.ok(result.prompt.includes(value), value);
});

test('the live audit rejects missing three-zone output instead of accepting six-only output', async () => {
  const broken = compile('prompt = prompt.replace(SYSTEM_JOB, "");');
  await assert.rejects(assemble({ separatedArtwork: undefined, anchorTurns: false }, broken),
    /panel_proof_phase1_contract_missing:.*flatPanelProductionProofInjected/);
});

test('the live audit rejects a missing continuous underlay requirement', async () => {
  const broken = compile('prompt = prompt.replace(productionProofInstructions[0], "");');
  await assert.rejects(assemble({ separatedArtwork: undefined, anchorTurns: false }, broken),
    /panel_proof_phase1_contract_missing:.*templateLayoutLocked/);
});
