import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const sharp = require('../../runtime/node_modules/sharp');
const { GEOMETRY_CONTRACT } = require('../../runtime/panelpro-file-output-render.cjs');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// A reviewed, measured synthetic fixture. These are not claimed to be the
// owner's vehicle templates or a live Gemini/production acceptance run.
export async function createPanelProFixture({ move = true, sourceApp = 'DesignPro', ownerPath = 'tenant/revision',
  tenantKey = 'tenant', sourceJobId = 'job', generationId = 'generation', designId = 'design', orderId = 'order', revisionId = 'revision' } = {}) {
  const files = new Map(), output = new Map(), progress = [];
  const put = (name, bytes) => {
    const ref = { storagePath: `${ownerPath}/${name}`, contentHash: hash(bytes) };
    files.set(ref.storagePath, bytes); return ref;
  };
  const background = await sharp({ create: { width: 2700, height: 2400, channels: 3, background: '#1a80ba' } }).png().toBuffer();
  const logoBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150"><rect width="300" height="150" fill="#e00000"/></svg>');
  const source = await sharp(background).composite([{ input: logoBytes, left: 1200, top: 1050 }]).png().toBuffer();
  const display = put('branded.png', await sharp({ create: { width: 800, height: 600, channels: 3, background: '#eeeeee' } }).png().toBuffer());
  const piece = { pieceId: 'driver-piece', sourceSurfaceKey: 'driver', source: put('source.png', source), widthInches: 8, heightInches: 6,
    sourceMapping: { boundsInches: { x: -5, y: -5, width: 18, height: 16 } },
    outlineInches: [[0, 0], [8, 0], [8, 6], [0, 6]],
    protectedElements: [{ elementId: 'logo-1', assetId: 'logo', canTranslate: move, boundsInches: { x: 3, y: 2, width: 2, height: 1 } }],
    cutAreas: move ? [{ areaId: 'window', pointsInches: [[3, 1], [4, 1], [4, 4], [3, 4]] }] : [],
    composition: { background: put('background.png', background), layerSeparationVerified: true, nonessentialBackgroundVerified: true,
      backgroundMapping: { boundsInches: { x: -5, y: -5, width: 18, height: 16 } } },
  };
  piece.coverageReview = { reviewId: 'coverage-1', sourceContentHash: piece.source.contentHash, continuousArtworkVerified: true, nonessentialCutFillVerified: true };
  const geometry = { contractVersion: GEOMETRY_CONTRACT, templateId: 'fixture', version: '1', displayContentHash: display.contentHash,
    vehicle: { year: '2020', make: 'Chevrolet', model: 'Camaro', bodyStyle: 'coupe' },
    pieces: [{ pieceId: piece.pieceId, widthInches: 8, heightInches: 6, outlineInches: piece.outlineInches, cutAreas: piece.cutAreas,
      displayRegionPixels: { x: 0, y: 0, width: 800, height: 600 } }] };
  const geometryRef = put('geometry.json', Buffer.from(JSON.stringify(geometry)));
  const input = { sourceApp, tenantKey, sourceJobId, generationId, designId, orderId, revisionId,
    master: put('master.png', source), dimensionManifestHash: 'b'.repeat(64), printableWidthInches: 59.5, protectedClearanceInches: 0.25,
    template: { templateId: 'fixture', version: '1', profileHash: 'c'.repeat(64), geometryHash: geometryRef.contentHash,
      geometry: geometryRef, display, displayOrigin: 'generated-branded', geometryValidated: true, cutAreasReviewed: true },
    availableAssets: [{ assetId: 'logo', kind: 'vector', separable: true, ...put('logo.svg', logoBytes) }], pieces: [piece] };
  return { input, files, output, progress, put, geometry,
    options: { readBytes: async (ref) => { assert.ok(files.has(ref.storagePath)); return files.get(ref.storagePath); },
      writeArtifact: async (artifact) => { output.set(artifact.name, { ...artifact, bytes: Buffer.from(artifact.bytes) }); return { storagePath: `private/output/${artifact.name}`, contentHash: artifact.contentHash }; },
      onProgress: async (event) => { progress.push(event); } } };
}
