import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

// Execute the actual production modules. These tests construct metadata and
// prompts only; they may neither process an image nor invoke a provider.
// A fail-fast stub keeps this regression test independent of native sharp.
function loadMetadataModule(name) {
  const url = new URL(`../runtime/${name}`, import.meta.url);
  const filename = fileURLToPath(url);
  const module = { exports: {} };
  const realRequire = createRequire(url);
  runInNewContext(readFileSync(url, 'utf8'), {
    module, exports: module.exports, Buffer, console, process,
    require: id => id === 'sharp'
      ? () => { throw new Error('This metadata test must not process an image'); }
      : realRequire(id),
    __filename: filename,
    __dirname: fileURLToPath(new URL('../runtime/', import.meta.url)),
  }, { filename });
  return module.exports;
}
const { atlasProofRequestBody } = loadMetadataModule('designpanel-server-provider.cjs');
const { buildAtlasProofQcPrompt } = loadMetadataModule('atlas-proof-qc.cjs');
const variants = [
  ['reported ProMaster', { year: '2023', make: 'Dodge', model: 'Ram Promaster 2500', type: 'van' }, false],
  ['ProMaster without body type', { make: 'RAM', model: 'ProMaster 2500' }, false],
  ['ProMaster classified broadly as truck', { make: 'RAM', model: 'ProMaster 2500', type: 'truck' }, false],
  ['spaced Pro Master', { make: 'RAM', model: 'Pro Master 2500' }, false],
  ['ProMaster City', { make: 'RAM', model: 'ProMaster City' }, false],
  ['Dodge Ram van', { make: 'Dodge', model: 'Ram 3500', type: 'cargo van' }, false],
  ['Transit', { make: 'Ford', model: 'Transit 350', type: 'van' }, false],
  ['Sprinter', { make: 'Mercedes-Benz', model: 'Sprinter 2500', type: 'van' }, false],
  ['Express', { make: 'Chevrolet', model: 'Express 3500' }, false],
  ['Savana', { make: 'GMC', model: 'Savana 2500' }, false],
  ['box truck', { make: 'Ford', model: 'F450', type: 'box truck' }, false],
  ['cutaway', { make: 'Ford', model: 'F450', type: 'cutaway' }, false],
  ['make alone is not a body style', { make: 'RAM' }, false],
  ['Ram Express is a pickup trim, not an Express van', { make: 'RAM', model: '1500 Express', type: 'truck', trim: 'Express' }, true],
  ['Ram 1500 pickup', { make: 'RAM', model: '1500' }, true],
  ['Ram 2500 pickup', { make: 'RAM', model: '2500', type: 'truck' }, true],
  ['Dodge Ram 3500 pickup', { make: 'Dodge', model: 'Ram 3500' }, true],
  ['reported Sierra', { year: '2019', make: 'GMC', model: 'Sierra 1500 Crew Cab Short Bed', type: 'truck' }, true],
  ['Ford F-150', { make: 'Ford', model: 'F-150', type: 'pickup' }, true],
  ['Toyota Tacoma', { make: 'Toyota', model: 'Tacoma' }, true],
  ['Toyota Prius', { make: 'Toyota', model: 'Prius', type: 'car' }, false],
  ['unspecified', {}, false],
];
const authority = Object.freeze({
  surfaceKey: 'roof', surfaceSelection: 'fixed-by-surface',
  storagePath: 'test-only/roof.png', contentHash: 'a'.repeat(64),
  contentType: 'image/png', role: 'surface-panel',
  contract: 'designpro.atlas-panel-authority.v1',
  panel: Object.freeze({ printWidthIn: 91.2, printHeightIn: 66,
    trimWidthIn: 81.2, trimHeightIn: 56, bleedInches: 5,
    geometryPurpose: 'calls-1-7-layout-only', sourceMasterHash: 'b'.repeat(64) }),
});
const options = Object.freeze({ requestId: 'test-request', generationId: 'test-generation', claimToken: 'test-claim' });
for (const [name, vehicle, expected] of variants) {
  test(`${name}: renderer and QC agree on the supplied vehicle body`, () => {
    const input = Object.freeze({ vehicle: Object.freeze(vehicle), finish: 'Gloss' });
    const body = atlasProofRequestBody({ options, input, authority, sourceViewType: 'roof', revisionId: 'test-revision' });
    assert.equal(body.isPickup, expected, 'renderer must not turn a van into a pickup');
    assert.equal(Object.hasOwn(body, 'pickupRoofQualification'), expected, 'cab-only/open-bed rule belongs only to pickups');
    const prompt = buildAtlasProofQcPrompt({ sourceViewType: 'roof', input, atlas: {},
      proofHash: 'c'.repeat(64), atlasHash: 'b'.repeat(64), authorityHash: 'a'.repeat(64), authoritySurface: 'roof' });
    assert.ok(prompt.includes(`Pickup coverage rules active: ${expected ? 'YES' : 'NO'}`));
    assert.equal(prompt.includes('This pickup roof proof FAILS'), expected);
    assert.equal(body.sourcePanelHash, authority.contentHash);
    assert.equal(body.sourcePanelStoragePath, authority.storagePath);
    assert.equal(body.sourceMasterHash, authority.panel.sourceMasterHash);
    assert.equal(body.panelPrintWidthIn, 91.2);
    assert.equal(body.panelPrintHeightIn, 66);
    assert.equal(body.panelBleedIn, 5);
    assert.equal(body.vehicleModel, vehicle.model || '');
    assert.equal(body.atlasRevisionId, 'test-revision');
  });
}
test('driver and passenger keep distinct immutable surface bindings', () => {
  const input = { vehicle: variants[0][1], finish: 'Gloss' };
  const surfaces = [['side', 'driver', 'd'], ['passenger-side', 'passenger', 'e']];
  for (const [view, surface, hashDigit] of surfaces) {
    const own = { ...authority, surfaceKey: surface, contentHash: hashDigit.repeat(64), storagePath: `test-only/${surface}.png` };
    const body = atlasProofRequestBody({ options, input, authority: own, sourceViewType: view, revisionId: 'test-revision' });
    assert.equal(body.isPickup, false);
    assert.equal(body.shotKey, view);
    assert.equal(body.surfaceKey, surface);
    assert.equal(body.sourcePanelHash, hashDigit.repeat(64));
    assert.equal(body.sourcePanelStoragePath, own.storagePath);
    assert.equal(Object.hasOwn(body, 'pickupRoofQualification'), false);
  }
});
