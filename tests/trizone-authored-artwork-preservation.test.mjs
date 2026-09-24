import test from 'node:test';
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
