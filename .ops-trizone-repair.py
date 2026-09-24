from pathlib import Path
import hashlib
import subprocess

BASE = 'c582a80b81de411db071dca2847b067c51e898e1'
def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    if text.count(old) != 1:
        raise RuntimeError(f'{path}: expected exactly one patch anchor, found {text.count(old)}')
    p.write_text(text.replace(old, new, 1))

# These are creative authority and must remain byte-identical in this repair.
protected = [
    'supabase/functions/design-panel-ai-generate/index.ts',
    'supabase/functions/_shared/designiq-assembly.ts',
    'supabase/functions/persona-photographer-render/index.ts',
    'supabase/functions/_shared/model-config.ts',
]
before = {p: hashlib.sha256(Path(p).read_bytes()).hexdigest() for p in protected}
edge = 'supabase/functions/production-panel-proof/index.ts'
replace_once(edge,
    '    let prompt = [creativeHead, ...flatProductionInstructions].join("\\n\\n");',
    '''    // The live caller requests the complete three-zone sheet, not the legacy
    // separated-background canvas. Keep that request paired with the template
    // and extractor. The designer head remains untouched and appears first.
    const productionProofInstructions = [
      "ZONE 2 UNDERLAY: Show the same continuous background artwork beneath the Zone 1 lettering and logos. Complete the underlying photography, illustration, color and texture through every covered area. Each panel is fully opaque, edge-to-edge artwork, including beneath every removed mark; transparency, checkerboards and logo-shaped blank patches are not background artwork.",
      "PRODUCTION GEOMETRY: Each supplied outer rectangle includes 5-inch bleed on all four edges. Carry the background to every outer edge; keep all complete logos, text and focal subjects inside the trim and safe area.",
    ];
    let prompt = body.separatedArtwork === true
      ? [creativeHead, ...flatProductionInstructions].join("\\n\\n")
      : [buildPanelProofPrompt({
          creativeHead,
          companyName: field("companyName"), tagline: field("tagline"),
          phone: field("phone"), website: field("website"),
          services: body?.services ?? intake?.services, promo: field("promo"),
          vehicleYear: field("vehicleYear"), vehicleMake: field("vehicleMake"),
          vehicleModel: field("vehicleModel"), creativeDirection, panelRows,
        }), ...productionProofInstructions].join("\\n\\n");''')
replace_once(edge,
    '''      flatPanelProductionProofInjected:
        flatProductionInstructions.length === 5 && prompt.includes(flatProductionInstructions[0]),
      templateLayoutLocked:
        flatProductionInstructions.slice(1).every(instruction => prompt.includes(instruction)),''',
    '''      flatPanelProductionProofInjected: body.separatedArtwork === true
        ? flatProductionInstructions.length === 5 && prompt.includes(flatProductionInstructions[0])
        : prompt.includes(SYSTEM_JOB)
          && ["ZONE 1", "ZONE 2", "ZONE 3"].every(zone => prompt.includes(zone)),
      templateLayoutLocked: body.separatedArtwork === true
        ? flatProductionInstructions.slice(1).every(instruction => prompt.includes(instruction))
        : prompt.includes(SHEET_LAYOUT)
          && productionProofInstructions.every(instruction => prompt.includes(instruction)),''')

# An opaque dark shape is artwork, not proof of missing pixels. New TriZone
# sources preserve the authored master, including on persisted-source recovery.
fill = 'runtime/atlas-cutout-fill.cjs'
replace_once(fill, 'const sharp = require("sharp");',
    '''const sharp = require("sharp");
// Explicit identity contract for authored TriZone panels. Old revisions keep
// their recorded v1/v2 repair behavior; new proof sheets never clone over ink.
const FILL_CONTRACT_PRESERVE = "designpro.atlas-cutout-fill.v3-preserve-authored";''')
replace_once(fill,
    '  if (contract !== FILL_CONTRACT_V1 && contract !== FILL_CONTRACT_V2) {',
    '  if (![FILL_CONTRACT_V1, FILL_CONTRACT_V2, FILL_CONTRACT_PRESERVE].includes(contract)) {')
replace_once(fill,
    '  const wanted = new Set((surfaceKeys || []).map(String));',
    '''  if (contract === FILL_CONTRACT_PRESERVE) {
    // Do not turn opaque black lettering, shading or a requested illustration
    // into a hole and then clone over it. Real defects stay visible for review.
    // Identity is recorded so a resumed job cannot silently apply legacy fill.
    return { bytes: masterBytes, contract, filled: [], changed: false };
  }
  const wanted = new Set((surfaceKeys || []).map(String));''')
replace_once(fill, '  FILL_CONTRACT_V2,\n', '  FILL_CONTRACT_V2,\n  FILL_CONTRACT_PRESERVE,\n')
flat = 'runtime/flat-first-atlas.cjs'
replace_once(flat,
    'const { FILL_CONTRACT, fillMasterCutouts, FILL_CONTRACT_V1 } = require("./atlas-cutout-fill.cjs");',
    'const { FILL_CONTRACT, fillMasterCutouts, FILL_CONTRACT_V1, FILL_CONTRACT_PRESERVE } = require("./atlas-cutout-fill.cjs");')
replace_once(flat,
    '  const cutoutFill = await fillMasterCutouts(masterBytes, manifest, masterCutoutSurfaces);',
    '''  // TriZone already contains the designer's complete rectangular panels.
  // Its dark ink is not a physical cutout mask. Preserve it, and persist the
  // identity contract for recovery instead of cloning over intentional artwork.
  const cutoutFill = await fillMasterCutouts(masterBytes, manifest, masterCutoutSurfaces, {
    contract: panelProof ? FILL_CONTRACT_PRESERVE : FILL_CONTRACT,
  });''')

# Update only the existing assertion that incorrectly required six-only output
# even on the customer's non-separated three-zone route. Keep strict execution,
# persona integrity, negative tests and legacy attachment tests.
test = 'tests/production-panel-proof-clean-prompt.test.mjs'
replace_once(test,
    'customerPrompt: \'\', intake: null, panelRows: [],',
    'customerPrompt: body.customerPrompt || \'\', intake: null, panelRows: body.panelRows || [],')
replace_once(test,
    '      assert.match(result.prompt, /FLAT PRODUCTION DESTINATION:/);',
    '''      if (separatedArtwork) assert.match(result.prompt, /FLAT PRODUCTION DESTINATION:/);
      else {
        assert.ok(result.prompt.includes(SYSTEM_JOB));
        assert.ok(result.prompt.includes(SHEET_LAYOUT));
        for (const zone of ['ZONE 1', 'ZONE 2', 'ZONE 3']) assert.ok(result.prompt.includes(zone));
        assert.match(result.prompt, /ZONE 2 UNDERLAY:/);
        assert.doesNotMatch(result.prompt, /FLAT PRODUCTION DESTINATION:/);
      }''')
with Path(test).open('a') as out:
    out.write(r'''

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
''')

Path('tests/trizone-authored-artwork-preservation.test.mjs').write_text(r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const require = createRequire(new URL('../runtime/package.json', import.meta.url));
const sharp = require('sharp');
const { fillMasterCutouts, FILL_CONTRACT, FILL_CONTRACT_PRESERVE } = require('./atlas-cutout-fill.cjs');
const { cutProofPanels, scaleCell } = require('./atlas-proof-panels.cjs');
const { containerLayout } = require('./atlas-proof-container-template.cjs');

const fixture = async () => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="240">
  <defs><linearGradient id="b"><stop stop-color="#000"/><stop offset="1" stop-color="#147dda"/></linearGradient></defs>
  <rect width="600" height="240" fill="url(#b)"/><circle cx="95" cy="125" r="72" fill="black"/>
  <path d="M 0 190 H 600 M 0 199 H 600" stroke="#eaaa20" stroke-width="5"/>
  <path d="M 220 40 H 285 V 195 H 220 Z" fill="black"/>
</svg>`)).png().toBuffer();
const manifest = { zones: [{ surfaceKey: 'driver', x: 0, y: 0, w: 600, h: 240 }] };

test('authored TriZone retains intentional black shapes, shading and colored stripes byte-for-byte', async () => {
  assert.equal(typeof FILL_CONTRACT_PRESERVE, 'string');
  const bytes = await fixture();
  const result = await fillMasterCutouts(bytes, manifest, ['driver'], { contract: FILL_CONTRACT_PRESERVE });
  assert.equal(result.bytes, bytes, 'identity returns the original buffer, not a re-encoded reconstruction');
  assert.equal(result.changed, false);
  assert.deepEqual(result.filled, []);
  assert.equal(result.contract, FILL_CONTRACT_PRESERVE);
});

test('recovery reuses the persisted preservation contract, not the legacy black-pixel repair', async () => {
  const bytes = await fixture();
  const saved = { panelSourceFillContract: FILL_CONTRACT_PRESERVE, masterCutoutSurfaces: ['driver'] };
  const result = await fillMasterCutouts(bytes, manifest, saved.masterCutoutSurfaces,
    { contract: saved.panelSourceFillContract });
  assert.deepEqual(result.bytes, bytes);
  assert.equal(result.changed, false);
});

test('unknown repair contracts and missing source bytes are still rejected', async () => {
  await assert.rejects(fillMasterCutouts(await fixture(), manifest, [], { contract: 'unknown' }),
    /Unknown fill contract/);
  await assert.rejects(fillMasterCutouts(Buffer.alloc(0), manifest, [], { contract: FILL_CONTRACT_PRESERVE }),
    /master bytes are required/);
});

test('the real runtime selects preservation for TriZone and leaves legacy routes unchanged', async () => {
  const source = readFileSync(new URL('../runtime/flat-first-atlas.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('  const repairStartedAt = Date.now();');
  const end = source.indexOf('\n  // ⛔ STRUCTURAL RE-VALIDATION', start);
  assert.ok(start > 0 && end > start);
  const code = source.slice(start, end);
  for (const panelProof of [true, false]) {
    let seen;
    await runInNewContext(`(async () => { "use strict"; ${code} })()`, {
      Date, panelProof, FILL_CONTRACT, FILL_CONTRACT_PRESERVE,
      masterBytes: await fixture(), manifest, masterCutoutSurfaces: ['driver'],
      masterHash: 'unchanged', timings: { repairMs: 0 }, sha256: () => 'unused',
      fillMasterCutouts: async (bytes, _manifest, _surfaces, options) => {
        seen = options.contract;
        return { bytes, changed: false, filled: [], contract: seen };
      },
    });
    assert.equal(seen, panelProof ? FILL_CONTRACT_PRESERVE : FILL_CONTRACT);
  }
});

test('Zone 2 is a direct opaque crop of its own authored band, never keyed or subtracted from Zone 1', async () => {
  const keys = ['driver', 'passenger', 'roof', 'hood', 'front', 'rear'];
  const proofManifest = { zones: keys.map(surfaceKey => ({ surfaceKey, trimInches: { widthIn: 80, heightIn: 40 } })) };
  const bytes = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: '#147dda' } })
    .composite([{ input: await fixture(), left: 100, top: 440 }]).png().toBuffer();
  const cut = await cutProofPanels({ proofBytes: bytes, manifest: proofManifest, zones: ['zone2'], sharp });
  assert.equal(cut.refused, null);
  assert.equal(cut.panels.length, 6);
  const layout = containerLayout(proofManifest);
  for (const panel of cut.panels) {
    const cell = layout.zone2.find(c => c.surfaceKey === panel.surfaceKey);
    const rect = scaleCell(cell, layout, cut.sheet);
    const expected = await sharp(bytes).extract(rect).ensureAlpha().raw().toBuffer();
    const actual = await sharp(panel.bytes).ensureAlpha().raw().toBuffer();
    assert.deepEqual(actual, expected, panel.surfaceKey);
    for (let at = 3; at < actual.length; at += 4) assert.equal(actual[at], 255);
  }
});
''')

for p, digest in before.items():
    assert hashlib.sha256(Path(p).read_bytes()).hexdigest() == digest, p
subprocess.run(['git', 'diff', '--check'], check=True)
print('Patch applied: live three-zone request restored; authored TriZone pixels preserved; golden persona files unchanged.')
