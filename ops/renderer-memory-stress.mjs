// Owed before Phase 6 cutover: worst-case LAYERED renderer memory stress test.
//
// Phase 2's ceiling was calibrated on a simple master (one global raster, a
// little type). The accepted limitation was that this is an empirical guard,
// not a proof, and that a worst-case layered run was required before cutover.
// This is that run: the real F-250 trim at production resolution, with the
// layer stack deep enough to exercise masks, blends and per-surface overrides.
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const require = createRequire("file:///home/user/designproai-os/x.mjs");
const sharp = require("/home/user/designproai-os/runtime/node_modules/sharp");
const { DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE, validateDesignMaster } = require("/home/user/designproai-os/runtime/design-master.cjs");
const { renderProductionSurfaces, PEAK_BYTES_PER_PIXEL } = require("/home/user/designproai-os/runtime/design-master-renderer.cjs");

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const FONT = readFileSync("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
const PNG = { compressionLevel: 6, adaptiveFiltering: false, force: true };

// The real F-250 GENIE trim.
const TRIM = { driver: [153, 56], passenger: [153, 56], hood: [71.5, 56], roof: [74.3, 54.8], front: [129, 34], rear: [76, 54] };
const PPI = Number(process.env.PPI || 150);
const BLEED = 5;
const LAYERS = Number(process.env.LAYERS || 24);

const field = await sharp({ create: { width: 4000, height: 1200, channels: 3, background: "#0d3f63" } })
  .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="1200"><path d="M0,800 C1000,600 1800,1000 4000,560 L4000,1200 L0,1200 Z" fill="#12a3a0"/></svg>`), left: 0, top: 0 }])
  .png(PNG).toBuffer();
const maskPng = await sharp(Buffer.alloc(2000 * 800, 128), { raw: { width: 2000, height: 800, channels: 1 } }).png(PNG).toBuffer();
const markSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><circle cx="120" cy="120" r="112" fill="#f4b942"/><path d="M64 152 L120 52 L176 152 Z" fill="#06131f"/></svg>`);
const bytesFor = { field, maskraster: maskPng, mark: markSvg };

const BLENDS = ["normal", "multiply", "screen", "overlay", "soft-light", "hard-light", "darken", "lighten"];
let x = 0;
const surfaces = SURFACE_KEYS.map((surfaceKey, index) => {
  const s = { surfaceKey, originIn: [x, 0], widthIn: TRIM[surfaceKey][0], heightIn: TRIM[surfaceKey][1],
    mirror: surfaceKey === "passenger",
    mapping: { kind: "planar-developable", mappingId: uuid(String(index + 1)), mappingHash: sha256(Buffer.from(surfaceKey)) }, seams: [] };
  x += TRIM[surfaceKey][0] + BLEED * 2 + 2;
  return s;
});
const spaceWidth = x;

// Worst case: every layer is global, so every layer is a candidate on every
// surface; alternating blends and masks so no compositing fast path applies.
const layers = [];
for (let i = 0; i < LAYERS; i += 1) {
  layers.push({
    layerId: `art-${i}`, type: "raster", space: GLOBAL_SPACE, assetId: "field",
    extent: { widthIn: spaceWidth, heightIn: 60 },
    transform: { x: 0, y: i * 0.05, scale: 1, rotate: 0 },
    zOrder: 10 + i, opacity: i % 3 === 0 ? 0.85 : 1, blend: BLENDS[i % BLENDS.length],
    mask: i % 2 === 0 ? { type: "raster", assetId: "maskraster" } : { type: "none" },
    surfaceOverrides: i % 5 === 0 ? { roof: { opacity: 0.5 }, front: { visible: false } } : undefined,
  });
}
layers.push({ layerId: "url-d", type: "text", space: "driver", textId: "domain", extent: { widthIn: 90, heightIn: 12 },
  transform: { x: 6, y: 40, scale: 1, rotate: 0 }, zOrder: 200, opacity: 1, blend: "normal", mask: { type: "none" } });
layers.push({ layerId: "url-p", type: "text", space: "passenger", textId: "domain", extent: { widthIn: 90, heightIn: 12 },
  transform: { x: 6, y: 40, scale: 1, rotate: 0 }, zOrder: 200, opacity: 1, blend: "normal", mask: { type: "none" } });
layers.push({ layerId: "mark-d", type: "logo", space: "driver", logoIdentityKey: "mark", extent: { widthIn: 20, heightIn: 20 },
  transform: { x: 120, y: 8, scale: 1, rotate: 0 }, zOrder: 210, opacity: 1, blend: "normal", mask: { type: "none" } });
layers.push({ layerId: "mark-p", type: "logo", space: "passenger", logoIdentityKey: "mark", extent: { widthIn: 20, heightIn: 20 },
  transform: { x: 120, y: 8, scale: 1, rotate: 0 }, zOrder: 210, opacity: 1, blend: "normal", mask: { type: "none" } });

const master = validateDesignMaster({
  contract: DESIGN_MASTER_CONTRACT, masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
  dimensionManifestId: uuid("d"), manifestHash: sha256(Buffer.from("f250")), designId: "STRESS-F250",
  designSpace: { contract: DESIGN_SPACE_CONTRACT, designSpaceId: uuid("f"), unitsPerInch: 1, surfaces },
  assets: [
    { assetId: "field", kind: "raster", contentHash: sha256(field), storagePath: "s/field.png", intrinsic: { widthPx: 4000, heightPx: 1200 }, minPxPerInch: 1 },
    { assetId: "maskraster", kind: "raster", contentHash: sha256(maskPng), storagePath: "s/mask.png", intrinsic: { widthPx: 2000, heightPx: 800 }, minPxPerInch: 1 },
    { assetId: "mark", kind: "vector", contentHash: sha256(markSvg), storagePath: "s/mark.svg" },
  ],
  palette: [{ token: "paper", srgb: "#ffffff" }],
  fonts: [{ fontId: "sans", family: "DejaVu Sans", version: "2.37", contentHash: sha256(FONT), license: "bitstream-vera", storagePath: "s/s.ttf" }],
  layers,
  textObjects: [{ textId: "domain", string: "PrecisionClimateAZ.com", fontId: "sans", sizeIn: 7, colorToken: "paper", neverMirror: true, spellingAuthority: "revision-snapshot" }],
  logoObjects: [
    { identityKey: "mark", assetId: "mark", contentHash: sha256(markSvg), surfaceKey: "driver", neverMirror: true, neverRasterizeIntoBase: true },
    { identityKey: "mark", assetId: "mark", contentHash: sha256(markSvg), surfaceKey: "passenger", neverMirror: true, neverRasterizeIntoBase: true },
  ],
  masterHash: undefined,
});

let peak = 0;
const watch = setInterval(() => { const r = process.memoryUsage.rss(); if (r > peak) peak = r; }, 40);
const started = Date.now();
const render = await renderProductionSurfaces({ master, loadAsset: async (a) => bytesFor[a.assetId], loadFont: async () => FONT, pxPerInch: PPI, bleedInches: BLEED });
clearInterval(watch);
const seconds = (Date.now() - started) / 1000;
const biggest = render.surfaces.reduce((m, s) => Math.max(m, s.pixelWidth * s.pixelHeight), 0);
console.log(JSON.stringify({
  ppi: PPI, layers: layers.length,
  largestSurfacePx: render.surfaces.map((s) => `${s.surfaceKey} ${s.pixelWidth}x${s.pixelHeight}`),
  megapixels: Math.round(biggest / 1e6),
  predictedPeakGB: +(render.peakBytesPerSurface / 2 ** 30).toFixed(2),
  observedPeakGB: +(peak / 2 ** 30).toFixed(2),
  boundHolds: peak <= render.peakBytesPerSurface,
  seconds: Math.round(seconds),
  renderHash: render.renderHash.slice(0, 16),
}, null, 2));

// RECORDED RESULT — 2026-08-13, before Phase 6 cutover. Do not rerun unless the
// renderer's compositing or budget changes.
//
//   ppi 150, 28 layers, real F-250 GENIE trim
//   driver/passenger 24450x9900 (242 megapixels each)
//   predicted peak 3.61 GB, observed peak 3.24 GB, bound holds
//   2134 s
//
// This discharges the Phase 2 limitation: the memory ceiling was an empirical
// guard calibrated on a simple master, and a worst-case layered run was owed
// before cutover. Twenty-four global rasters cycling all eight blend modes,
// half raster-masked, per-surface overrides on every fifth, plus type and
// logos on both flanks, stayed inside the declared budget.
