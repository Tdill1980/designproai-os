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
// Unit-test the real exclusion parser: compile it from the edge request
// section (between its markers) rather than a copy.
const parserStart = source.indexOf('// BEGIN excludedSurfacesFromBrief');
const parserEnd = source.indexOf('// END excludedSurfacesFromBrief', parserStart);
assert.ok(parserStart > start && parserEnd > parserStart && parserEnd < end, 'the parser lives inside the executed request section');
const excludedSurfacesFromBrief = runInNewContext(execFileSync(resolveEsbuild(), ['--loader=ts', '--format=cjs'], {
  input: `(() => { "use strict"; ${source.slice(parserStart, parserEnd)}\nreturn excludedSurfacesFromBrief; })()`,
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
}), {}, {timeout: 2000});

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
      if (separatedArtwork) assert.match(result.prompt, /MASTER WRAP AUTHORING:/);
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

// Regression from real request 65aec7ec: the early copyist check passed but
// the final provider-bound phase1 audit refused the missing designer role and
// native-knowledge instructions. Execute the actual endpoint section above.
const recreateReference = {
  storagePath: 'atlas-call1-inputs/' + 'a'.repeat(64) + '.png',
  contentHash: 'a'.repeat(64), contentType: 'image/png',
};
const recreateEdits = 'Only the driver side is available. Keep the same wrap and change the phone to 623-555-0174.';
for (const mode of ['commercial', 'restyle']) {
  for (const path of ['exact', 'complete', 'transfer']) {
    for (const separatedArtwork of [true, undefined]) {
      test(`RecreatePro ${mode}/${path}/separated=${separatedArtwork}: actual provider request satisfies phase1`, async () => {
        const task = `RecreatePro / ${path}. Preserve supplied artwork. Complete only requested missing surfaces; adapt only to the selected vehicle. Customer edits override named details only.`;
        const result = await assemble({ mode, separatedArtwork, anchorTurns: false,
          prompt: recreateEdits, customerPrompt: recreateEdits, companyName: '', phone: '', website: '',
          customerAssets: [recreateReference], visionboard_intent: 'exact_reference', styleDescriptors: task,
          panelRows: livePanels });
        assert.ok(result.prompt.startsWith(result.creativeHead + '\n\n'));
        assert.ok(result.prompt.includes(recreateEdits));
        assert.ok(result.creativeHead.includes(task));
        assert.match(result.creativeHead.split(/\n\s*\n/)[0], /\bdesigner\b/i);
        assert.match(result.creativeHead, /native image-generation and graphic-design knowledge/);
        assert.match(result.creativeHead, /explicit requested edits supersede exact-copy instructions/);
        assert.equal(result.customerAssets.length, 1);
        assert.equal(result.customerAssets[0].storagePath, recreateReference.storagePath);
        for (const [key, value] of Object.entries(result.phase1Audit)) {
          if (key !== 'contract') assert.equal(value, true, key);
        }
        if (separatedArtwork !== true) {
          for (const zone of ['ZONE 1', 'ZONE 2', 'ZONE 3']) assert.ok(result.prompt.includes(zone));
          assert.match(result.prompt, /same continuous background artwork beneath/);
        }
      });
    }
  }
}

test('RecreatePro still fails the actual audit when native knowledge is removed', async () => {
  const removeKnowledge = head => head.split('\n').filter(line => !/\bnative\b.*\bknowledge\b|DESIGN AMPLIFICATION:/i.test(line)).join('\n');
  await assert.rejects(assemble({ mode: 'restyle', separatedArtwork: undefined,
    prompt: recreateEdits, customerAssets: [recreateReference], visionboard_intent: 'exact_reference',
    styleDescriptors: 'RecreatePro / complete. Continue only the missing sides.' }, compiled, removeKnowledge),
    /panel_proof_phase1_contract_missing:.*nativeGeminiImageKnowledgeInjected/);
});

test('RecreatePro still fails the actual audit when its graphic designer role is removed', async () => {
  const removeRole = head => head.replace(/ As the reproduction graphic designer,[^\n]*?(?= Reproduce| Your job)/, '');
  await assert.rejects(assemble({ mode: 'restyle', separatedArtwork: undefined,
    prompt: recreateEdits, customerAssets: [recreateReference], visionboard_intent: 'exact_reference',
    styleDescriptors: 'RecreatePro / exact. Keep the supplied design.' }, compiled, removeRole),
    /panel_proof_phase1_contract_missing:.*graphicDesignerPersonaInjected/);
});


// ---------------------------------------------------------------------------
// Issue 4 (2026-09-25, job 9999ec65, WPW order #30292): the Phone field was
// empty and the brief asked for "the business Phone number under the Logo";
// the sheet came back with 555-0199. The brief said "full wrap except for the
// hood and roof"; the hood and roof were wrapped. Synthetic brief with the same
// operative phrases (no customer data in this public repo).
const order30292Brief = 'Hello, I need a full wrap except for the hood and roof for my 2010 Ram 1500 crew cab. '
  + 'Black and silver with a bold modern look. Please put the logo big on both doors, '
  + 'and I would like the business Phone number under the Logo. List our services on the tailgate.';
const order30292 = { separatedArtwork: undefined, anchorTurns: false, mode: 'commercial',
  prompt: order30292Brief, customerPrompt: order30292Brief,
  companyName: 'Mesa Line Hauling', phone: '', website: '', email: '',
  vehicleYear: '2010', vehicleMake: 'Ram', vehicleModel: '1500', vehicleType: 'truck', panelRows: livePanels };
const CONTACT_LOCK = /SUPPLIED CONTACT ONLY:/;
const COVERAGE_LOCK = /WRAP COVERAGE \(the customer's brief\):/;

test('issue 4 parser: exclusion wording names only the excluded surfaces', () => {
  const cases = [
    ['full wrap except for the hood and roof', ['hood', 'roof']],
    ['Full wrap, except the roof.', ['roof']],
    ['everything but the hood', ['hood']],
    ['Excluding the hood, roof and tailgate', ['hood', 'roof', 'rear']],
    ["Please don't wrap the hood", ['hood']],
    ['do not wrap the roof or the bonnet', ['hood', 'roof']],
    ['no wrap on the roof', ['roof']],
    ['The hood stays factory paint.', ['hood']],
    ['roof will remain unwrapped', ['roof']],
    ['The roof is not wrapped', ['roof']],
    ['leave the hood bare', ['hood']],
    ['Leave the roof alone please', ['roof']],
    ['full wrap without the roof, please', ['roof']],
    ['Wrap it all apart from the front bumper', ['front']],
    ["Don’t wrap the hood", ['hood']],
  ];
  for (const [text, expected] of cases) assert.deepEqual([...excludedSurfacesFromBrief(text)], expected, text);
});

test('issue 4 parser: ordinary mentions of a surface exclude nothing', () => {
  for (const text of [
    'Put the logo on the hood', 'Big flames across the hood and roof', 'hood scoop in matte black',
    'We have a roof rack', 'Leave room on the rear for a QR code', 'No neon colors.',
    'List our services on the tailgate.', 'Full wrap, all six sides', 'front and center logo',
    'Driver side is the hero; passenger side mirrors it', 'except make the text bigger',
    order30292Brief.replace('except for the hood and roof ', ''), '',
  ]) assert.deepEqual([...excludedSurfacesFromBrief(text)], [], text);
  assert.deepEqual([...excludedSurfacesFromBrief('except the driver side and the passenger side')], [],
    'a TriZone design always keeps both flanks');
});

test('issue 4: order #30292 locks out invented contact and wraps only the included surfaces', async () => {
  const result = await assemble(order30292);
  const coverage = result.prompt.split('\n').find(line => COVERAGE_LOCK.test(line));
  assert.ok(coverage, 'the excluded surfaces reach the provider-bound prompt');
  assert.match(coverage, /Hood and Roof stay unwrapped, in the vehicle's own factory paint/);
  assert.match(coverage, /no artwork, pattern, photograph, lettering, logo or contact detail/);
  assert.match(coverage, /Driver, Passenger, Front, Rear carry the whole design/);
  const derivation = result.prompt.split('\n').find(line => line.startsWith('SURFACE DERIVATION:'));
  assert.equal(derivation.includes('Roof, Hood'), false, 'hood and roof are not derived from the master');
  assert.match(derivation, /Derive Driver, Passenger, Front, Rear from that one master concept; Hood and Roof are unwrapped factory paint/);
  const contact = result.prompt.split('\n').find(line => CONTACT_LOCK.test(line));
  assert.ok(contact, 'the missing phone is locked by code');
  assert.match(contact, /no phone number, no email address, no web address/);
  assert.match(contact, /even where the brief asks for one/);
  assert.doesNotMatch(result.prompt, /555/, 'no placeholder number anywhere in the request');
  // The six production rectangles are unchanged: topology, cut and QC still see six cells.
  for (const row of livePanels) assert.ok(result.prompt.includes(row), row);
  for (const [key, value] of Object.entries(result.phase1Audit)) {
    if (key !== 'contract') assert.equal(value, true, key);
  }
  assert.equal(result.phase1Audit.suppliedContactLocked, true);
  assert.equal(result.phase1Audit.excludedSurfacesLocked, true);
});

test('issue 4: a supplied phone is never locked out and is carried verbatim', async () => {
  const result = await assemble({ ...order30292, phone: '(602) 555-0142' });
  const contact = result.prompt.split('\n').find(line => CONTACT_LOCK.test(line));
  assert.match(contact, /the customer supplied no email address, no web address\. /);
  assert.equal(/supplied no phone number/.test(contact), false);
  assert.ok(result.prompt.includes('(602) 555-0142'));
});

test('issue 4: a phone, address or domain typed in the brief counts as supplied', async () => {
  const brief = 'Logo big, then call 480-555-0110, email ops@mesaline.example and visit mesaline.com';
  const result = await assemble({ ...order30292, prompt: brief, customerPrompt: brief });
  assert.doesNotMatch(result.prompt, CONTACT_LOCK);
  assert.doesNotMatch(result.prompt, COVERAGE_LOCK);
});

test('issue 4: full contact and no exclusion leave the TriZone prompt byte-identical', async () => {
  const baseline = compile().replace(/\.\.\.\[coverageLock, contactLock\]\.filter\(Boolean\)/, '');
  const full = { separatedArtwork: undefined, anchorTurns: false, email: 'hello@junipercycle.example', panelRows: livePanels };
  const withLocks = await assemble(full);
  assert.doesNotMatch(withLocks.prompt, CONTACT_LOCK);
  assert.doesNotMatch(withLocks.prompt, COVERAGE_LOCK);
  assert.match(withLocks.prompt, /SURFACE DERIVATION: Derive Driver, Passenger, Roof, Hood, Front, and Rear/);
  assert.equal(withLocks.prompt, (await assemble(full, baseline)).prompt);
});

test('issue 4: separated artwork and RecreatePro are untouched by the locks', async () => {
  const separated = await assemble({ ...order30292, separatedArtwork: true });
  assert.doesNotMatch(separated.prompt, CONTACT_LOCK);
  assert.doesNotMatch(separated.prompt, COVERAGE_LOCK);
  const recreate = await assemble({ ...order30292, visionboard_intent: 'exact_reference',
    customerAssets: [recreateReference], styleDescriptors: 'RecreatePro / exact. Keep the supplied design.' });
  assert.doesNotMatch(recreate.prompt, CONTACT_LOCK);
  assert.doesNotMatch(recreate.prompt, COVERAGE_LOCK);
});

test('issue 4: the audit refuses a request whose locks were dropped', async () => {
  await assert.rejects(assemble(order30292, compile('prompt = prompt.replace(contactLock, "");')),
    /panel_proof_phase1_contract_missing:.*suppliedContactLocked/);
  await assert.rejects(assemble(order30292, compile('prompt = prompt.replace(coverageLock, "");')),
    /panel_proof_phase1_contract_missing:.*excludedSurfacesLocked/);
});

test('issue 4: the receipt records what code locked, without colliding with brand fields', () => {
  assert.ok(source.includes('{ contract: INTAKE_CONTRACT, ...intake, briefSource, flashSkipped, contactSupplied, excludedSurfaces }'));
  assert.ok(source.includes('{ briefSource, flashSkipped: false, contactSupplied, excludedSurfaces }'));
});
