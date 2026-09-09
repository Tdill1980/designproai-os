import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const sharp = require('../runtime/node_modules/sharp');
const { preparePanelProFileOutput, renderPanelProFileOutput, renderPanelProFileOutputPiece } = require('../runtime/panelpro-file-output-render.cjs');
const { buildPanelProFileOutputHandoff } = require('../runtime/panelpro-file-output-contract.cjs');
const { buildPanelProFileOutputPlan } = require('../runtime/panelpro-file-output-plan.cjs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

import { createPanelProFixture as fixture } from './helpers/panelprofile-fixture.mjs';

async function pixel(bytes, x, y) {
  return [...await sharp(bytes).extract({ left: x, top: y, width: 1, height: 1 }).removeAlpha().raw().toBuffer()];
}

test('real files relocate an existing logo while retaining nonessential background in installation cuts', async () => {
  const f = await fixture(), immutable = Buffer.from(f.files.get(f.input.pieces[0].source.storagePath));
  const result = await renderPanelProFileOutput(f.input, f.options);
  assert.equal(result.status, 'awaiting_human_qc');
  assert.equal(result.qcApproved, false); assert.equal(result.releaseToCustomer, false);
  assert.equal(result.pieces[0].evidence.nativeDetailVerified, false);
  assert.equal(result.pieces[0].evidence.effectivePpiX, 150);
  assert.equal(result.pieces[0].placements[0].moved, true);
  const png = f.output.get('production/driver-piece/driver-piece_TENTH_SCALE.png').bytes;
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 2700); assert.equal(metadata.height, 2400);
  assert.equal(metadata.density, 1500); assert.equal(metadata.hasAlpha, false); assert.equal(metadata.hasProfile, true);
  assert.deepEqual(await pixel(png, 1260, 1110), [26, 128, 186], 'the old logo/window overlap is now the existing background, not a hole or placeholder');
  const after = result.pieces[0].placements[0].after;
  assert.deepEqual(await pixel(png, Math.round((after.x + 5.2) * 150), Math.round((after.y + 5.2) * 150)), [224, 0, 0]);
  assert.deepEqual(await pixel(png, 5, 5), [26, 128, 186], 'real source artwork covers the five-inch outer bleed');
  assert.equal(f.output.get('production/driver-piece/driver-piece_TENTH_SCALE.tiff').bytes.subarray(0, 2).toString(), 'II');
  const pdfArtifact = f.output.get('production/driver-piece/driver-piece_TENTH_SCALE.pdf');
  const pdf = pdfArtifact.bytes.toString('latin1');
  assert.ok(pdf.startsWith('%PDF-1.7')); assert.ok(pdf.includes('/MediaBox [0 0 129.6 115.2]'));
  assert.ok(pdf.includes('/TrimBox [36 36 93.6 79.2]')); assert.ok(pdf.includes('/ICCBased'));
  assert.ok(pdf.includes('/Title (driver-piece - TENTH SCALE)'));
  assert.ok(pdf.includes('1:10 drawing scale; enlarge to 1000 percent. Full-size print 18 x 16 inches'));
  assert.equal(pdfArtifact.metadata.drawingScaleRatio, '1:10'); assert.equal(pdfArtifact.metadata.printAtPercent, 1000);
  assert.equal(pdfArtifact.metadata.scaleLabel, 'TENTH SCALE');
  assert.deepEqual(pdfArtifact.metadata.fullSizePrintDimensionsInches, { width: 18, height: 16 });
  assert.equal(result.artifacts.filter((a) => a.mimeType === 'application/pdf').length, 1, 'overview and review masks are excluded from print PDFs');
  assert.equal(f.output.get('review/driver-piece/driver-piece-qc-copy.png').contentHash, hash(png));
  const reused = result.artifacts.find((a) => a.role === 'reused-asset');
  assert.equal(reused.contentHash, f.input.availableAssets[0].contentHash);
  assert.deepEqual(f.files.get(f.input.pieces[0].source.storagePath), immutable, 'input pixels were never changed');
  assert.deepEqual(result.artifacts.filter((a) => a.name.startsWith('previews/')).map((a) => a.role),
    ['branded-template', 'template-overlay', 'installation-mask', 'placement-comparison', 'bleed-preview', 'production-panel-proof']);
  assert.equal(f.progress.at(-1).stage, 'panelprofileoutput.proof');
});

test('canonical handoff survives durable JSON round trips and deterministic rendering repeats byte for byte', async () => {
  const f = await fixture({ move: false });
  f.input.atlasRevisionId = 'atlas-revision-41';
  const stored = buildPanelProFileOutputHandoff(f.input);
  assert.deepEqual(buildPanelProFileOutputHandoff(JSON.parse(JSON.stringify(stored))), stored);
  const first = await renderPanelProFileOutput(stored, f.options);
  assert.equal(first.status, 'awaiting_human_qc');
  assert.equal(first.revisionId, 'revision'); assert.equal(first.atlasRevisionId, 'atlas-revision-41');
  const hashes = first.artifacts.map((a) => [a.name, a.contentHash]);
  const second = await renderPanelProFileOutput(stored, f.options);
  assert.deepEqual(second.artifacts.map((a) => [a.name, a.contentHash]), hashes);
  assert.equal(first.receiptHash, second.receiptHash);
  const corrupted = JSON.parse(JSON.stringify(stored)); corrupted.pieces[0].widthInches = 10;
  assert.throws(() => buildPanelProFileOutputHandoff(corrupted), { code: 'panelprofile_handoff_hash_mismatch' });
});

test('missing bleed, insufficient PPI, unverified fill and mismatched geometry fail before any production write', async () => {
  for (const [mutate, expected] of [
    [(f) => { f.input.pieces[0].sourceMapping.boundsInches = { x: 0, y: 0, width: 18, height: 16 }; }, 'panelprofile_bleed_source_coverage_missing'],
    [(f) => { f.input.fullSizePpi = 300; }, 'panelprofile_source_effective_ppi_insufficient'],
    [(f) => { f.input.pieces[0].composition.nonessentialBackgroundVerified = false; }, 'panelprofile_verified_nonessential_background_required'],
    [(f) => { f.input.pieces[0].cutAreas = []; }, 'panelprofile_reviewed_geometry_mismatch'],
    [(f) => { f.input.template.geometry = null; }, 'panelprofile_reviewed_geometry_required'],
  ]) {
    const f = await fixture(); mutate(f);
    const result = await renderPanelProFileOutput(f.input, f.options);
    assert.equal(result.status, 'requires_human_correction');
    assert.ok(result.blockers.some((b) => b.code === expected), JSON.stringify(result.blockers));
    assert.equal(f.output.size, 0);
  }
});

test('one transparent cut pixel and tampered immutable bytes cannot pass opacity or identity checks', async () => {
  const f = await fixture({ move: false });
  const source = f.files.get(f.input.pieces[0].source.storagePath);
  const rgba = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  rgba.data[(1000 * rgba.info.width + 1000) * 4 + 3] = 0;
  f.input.pieces[0].source = f.put('hole.png', await sharp(rgba.data, { raw: rgba.info }).png().toBuffer());
  const result = await preparePanelProFileOutput(f.input, f.options);
  assert.ok(result.blockers.some((b) => b.code === 'panelprofile_continuous_artwork_has_transparency'));
  f.files.set(f.input.pieces[0].source.storagePath, source);
  const tampered = await preparePanelProFileOutput(f.input, f.options);
  assert.ok(tampered.blockers.some((b) => b.code === 'panelprofile_source_hash_mismatch'));
});

test('the reviewed body outline protects essential content outside a concave body region', async () => {
  const f = await fixture({ move: false });
  const piece = f.input.pieces[0];
  piece.outlineInches = [[0, 0], [8, 0], [8, 6], [4, 6], [4, 2.2], [3.5, 2.2], [3.5, 6], [0, 6]];
  const plan = buildPanelProFileOutputPlan(f.input);
  assert.equal(plan.status, 'requires_human_correction');
  assert.equal(plan.pieces[0].placements[0].moved, false);
  assert.ok(plan.pieces[0].blockers.some((b) => b.code === 'protected_art_requires_layer_separation'));
});

test('reviewed split policy creates overlapping roll sections and keeps essential assets clear of joins', async () => {
  const f = await fixture({ move: false });
  const piece = f.input.pieces[0];
  piece.widthInches = 64; piece.heightInches = 53; piece.outlineInches = [[0, 0], [64, 0], [64, 53], [0, 53]];
  piece.splitPolicy = { axis: 'x', overlapInches: 1, installerReviewed: true };
  piece.protectedElements[0].canTranslate = true;
  piece.protectedElements[0].boundsInches = { x: 31, y: 10, width: 5, height: 5 };
  const plan = buildPanelProFileOutputPlan(f.input).pieces[0];
  assert.equal(plan.blockers.length, 0); assert.equal(plan.sections.length, 2);
  assert.equal(plan.placements[0].moved, true);
  assert.equal(plan.sections[0].trimBoundsInches.width, 32.5);
  assert.equal(plan.sections[1].trimBoundsInches.x, 31.5);
  assert.ok(plan.sections.every((s) => s.trimBoundsInches.width + 10 <= 59.5));
  assert.equal(plan.sourceSurfaceKey, 'driver');
  piece.splitPolicy.installerReviewed = false;
  assert.ok(buildPanelProFileOutputPlan(f.input).pieces[0].blockers.some((b) => b.code === 'physical_panel_split_required'));
});

test('seven-way splitting distributes whole pixels without changing outer dimensions or overlap', async () => {
  const f = await fixture({ move: false });
  const piece = f.input.pieces[0]; piece.widthInches = 100; piece.heightInches = 90;
  piece.outlineInches = [[0, 0], [100, 0], [100, 90], [0, 90]]; piece.protectedElements = [];
  piece.splitPolicy = { axis: 'x', overlapInches: 0.5, installerReviewed: true }; f.input.printableWidthInches = 25;
  const plan = buildPanelProFileOutputPlan(f.input).pieces[0];
  assert.equal(plan.sections.length, 7);
  assert.equal(plan.sections.at(-1).trimBoundsInches.x + plan.sections.at(-1).trimBoundsInches.width, 100);
  for (let i = 0; i < plan.sections.length; i += 1) {
    const b = plan.sections[i].trimBoundsInches;
    assert.ok(Math.abs((b.width + 10) * 150 - Math.round((b.width + 10) * 150)) < 1e-7);
    assert.ok(b.width + 10 <= 25);
    if (i) assert.ok(Math.abs(plan.sections[i - 1].trimBoundsInches.x + plan.sections[i - 1].trimBoundsInches.width - b.x - 0.5) < 1e-7);
  }
});

test('per-piece durable work does not read unrelated large rasters and caller limits cannot raise hard caps', async () => {
  const f = await fixture({ move: false });
  const second = structuredClone(f.input.pieces[0]); second.pieceId = 'other-piece'; second.source.storagePath = 'tenant/revision/missing-other.png';
  f.input.pieces.push(second);
  const result = await renderPanelProFileOutputPiece(f.input, 'driver-piece', f.options);
  assert.equal(result.status, 'awaiting_human_qc'); assert.equal(result.pieces.length, 1);
  const blocked = await preparePanelProFileOutput(f.input, { ...f.options, pieceIds: ['driver-piece'], limits: { maxPiecePixels: 1 } });
  assert.ok(blocked.blockers.length > 0);
});

test('roll-feed rotation changes raster orientation explicitly and never mirrors the artwork', async () => {
  const f = await fixture({ move: false }); f.input.printableWidthInches = 17;
  const result = await renderPanelProFileOutput(f.input, f.options);
  assert.equal(result.status, 'awaiting_human_qc');
  assert.equal(result.pieces[0].sections[0].rollRotationDegrees, 90);
  const png = f.output.get('production/driver-piece/driver-piece_TENTH_SCALE.png').bytes;
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 2400); assert.equal(metadata.height, 2700);
  assert.deepEqual(await pixel(png, 2400 - 1100 - 1, 1250), [224, 0, 0]);
  const pdf = f.output.get('production/driver-piece/driver-piece_TENTH_SCALE.pdf');
  assert.ok(pdf.bytes.toString('latin1').includes('/MediaBox [0 0 115.2 129.6]'));
  assert.deepEqual(pdf.metadata.fullSizePrintDimensionsInches, { width: 16, height: 18 });
});

test('actual split files reuse the same continuous source and retain explicit overlap and five-inch bleed', async () => {
  const f = await fixture(); f.input.printableWidthInches = 15.5;
  f.input.pieces[0].splitPolicy = { axis: 'x', overlapInches: 0.4, installerReviewed: true };
  const result = await renderPanelProFileOutput(f.input, f.options);
  assert.equal(result.status, 'awaiting_human_qc');
  assert.equal(result.pieces[0].sections.length, 2);
  for (const section of result.pieces[0].sections) {
    const png = f.output.get(`production/driver-piece/${section.sectionId}_TENTH_SCALE.png`).bytes;
    const metadata = await sharp(png).metadata();
    assert.equal(metadata.width, 2130); assert.equal(metadata.height, 2400);
    assert.deepEqual(await pixel(png, 5, 5), [26, 128, 186]);
    assert.deepEqual(section.output.bleedInches, { top: 5, right: 5, bottom: 5, left: 5 });
  }
  const [left, right] = result.pieces[0].sections;
  assert.ok(Math.abs(left.trimBoundsInches.width - right.trimBoundsInches.x - 0.4) < 1e-7);
});

test('explicit verified layer rebuild can fill an old transparent cut using existing background without new artwork', async () => {
  const f = await fixture({ move: false });
  const piece = f.input.pieces[0];
  const rgba = await sharp(f.files.get(piece.source.storagePath)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  rgba.data[(1000 * rgba.info.width + 1000) * 4 + 3] = 0;
  piece.source = f.put('legacy-hole.png', await sharp(rgba.data, { raw: rgba.info }).png().toBuffer());
  piece.composition.rebuildFromSeparatedAssets = true;
  const result = await renderPanelProFileOutput(f.input, f.options);
  assert.equal(result.status, 'awaiting_human_qc');
  assert.equal(result.pieces[0].placements[0].moved, false);
  assert.deepEqual(await pixel(f.output.get('production/driver-piece/driver-piece_TENTH_SCALE.png').bytes, 1000, 1000), [26, 128, 186]);
  piece.composition.nonessentialBackgroundVerified = false;
  const blocked = await preparePanelProFileOutput(f.input, f.options);
  assert.ok(blocked.blockers.some((b) => b.code === 'panelprofile_verified_nonessential_background_required'));
});

test('reviewed solid black design fill remains valid continuous artwork through installation cuts and bleed', async () => {
  const f = await fixture(), piece = f.input.pieces[0];
  const black = await sharp({ create: { width: 2700, height: 2400, channels: 3, background: '#000000' } }).png().toBuffer();
  piece.composition.background = f.put('existing-black-background.png', black);
  piece.source = f.put('existing-black-design.png', await sharp(black).composite([
    { input: f.files.get(f.input.availableAssets[0].storagePath), left: 1200, top: 1050 },
  ]).png().toBuffer());
  piece.coverageReview.sourceContentHash = piece.source.contentHash;
  const result = await renderPanelProFileOutput(f.input, f.options);
  assert.equal(result.status, 'awaiting_human_qc'); assert.equal(result.pieces[0].placements[0].moved, true);
  const png = f.output.get('production/driver-piece/driver-piece_TENTH_SCALE.png').bytes;
  assert.deepEqual(await pixel(png, 1260, 1110), [0, 0, 0], 'a cut zone contains verified black design, never a transparent hole');
  assert.deepEqual(await pixel(png, 5, 5), [0, 0, 0], 'the original black background also supplies actual outer bleed');
  assert.equal((await sharp(png).metadata()).hasAlpha, false);
});

test('seven reviewed physical panels produce seven separate scale-labelled PDFs without redefining the six canonical surfaces', async () => {
  const f = await fixture({ move: false }), original = f.input.pieces[0], geometry = f.geometry.pieces[0];
  const panels = [['driver-side', 'driver'], ['passenger-side', 'passenger'], ['front-bumper', 'front'],
    ['rear-bumper', 'rear'], ['hood', 'hood'], ['roof', 'roof'], ['trunk', 'rear']];
  f.input.pieces = panels.map(([pieceId, sourceSurfaceKey]) => ({ ...structuredClone(original), pieceId, sourceSurfaceKey }));
  f.geometry.pieces = panels.map(([pieceId]) => ({ ...structuredClone(geometry), pieceId }));
  const geometryRef = f.put('seven-panel-geometry.json', Buffer.from(JSON.stringify(f.geometry)));
  f.input.template.geometry = geometryRef; f.input.template.geometryHash = geometryRef.contentHash;
  const result = await renderPanelProFileOutput(f.input, f.options);
  assert.equal(result.status, 'awaiting_human_qc'); assert.equal(result.pieces.length, 7);
  assert.equal(new Set(result.pieces.map((piece) => piece.sourceSurfaceKey)).size, 6);
  const pdfs = result.artifacts.filter((artifact) => artifact.role === 'production-pdf');
  assert.equal(pdfs.length, 7); assert.equal(new Set(pdfs.map((pdf) => pdf.name)).size, 7);
  assert.ok(pdfs.every((pdf) => pdf.name.endsWith('_TENTH_SCALE.pdf') && pdf.metadata.drawingScaleRatio === '1:10'));
  assert.equal(result.artifacts.filter((artifact) => artifact.name.endsWith('.pdf')).length, 7);
});
