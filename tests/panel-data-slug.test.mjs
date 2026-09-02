// THE PANEL DATA SLUG AND THE PANEL MAP (owner, 2026-09-02).
//
// Brice's floor needs every printed panel to carry its data on one edge. These
// locks prove, on real bytes:
//   1. the strip is exactly the declared height on the bottom edge, and every
//      artwork pixel above it is untouched;
//   2. the strip is ink only -- white ground, black text and marks -- so it can
//      never be mistaken for artwork;
//   3. the panel map refuses a split lineage and a missing surface, and the
//      slug lines carry the surface, DID, sizes, hashes and validation state;
//   4. the production output contract: a full six-surface set built exactly as
//      output.build builds it verifies, a set without the strip declaration is
//      refused, and a raster whose height is not artwork + strip is refused;
//   5. the QC keys exist in the gateway, the app checklist, the certificate and
//      the migration, so the human gate and every list a designer sees agree.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const sharp = require("../runtime/node_modules/sharp");
const slugModule = require("../runtime/panel-data-slug.cjs");
const mapModule = require("../runtime/panel-map.cjs");
const outputQc = require("../runtime/output-qc.cjs");
const certificate = require("../runtime/qc-certificate.cjs");

const { applyPanelDataSlug, renderPanelDataSlug, slugMetadata, OUTPUT_SLUG_PIXELS, QC_SLUG_PIXELS, SLUG_INCHES, PANEL_DATA_SLUG_CONTRACT } = slugModule;
const { buildPanelMap, panelMapBytes, parsePanelMap, slugLines, PANEL_MAP_CONTRACT } = mapModule;
const { PANEL_DATA_SLUG, buildDeterministicRasterEps, verifyProductionOutputSet } = outputQc;
const byCode = (...codes) => (error) => codes.includes(error?.code) || codes.some((code) => String(error?.message || "").includes(code));

const MASTER = "e391c2cca6a730dde728c2514c055779c77b59ea56b7bd9874faec07a870091f";
const HASHES = {
  driver: "e0e19b53bfa7c01b8745e2be9d04f918e65712eaee58d921e4491c942624eb6c",
  passenger: "a0ec1e3bb33eba7ec11fc14160319281173922803328d062e68f7a9a5e66552e",
  hood: "d5845a9a009150192be0a59d5165631011712b9f786fcef1ad7a30a0eb4f6502",
  roof: "5749a6a8164ea2a885f43a9335e0803d1c2ce36ee8b912b1ef955fdc0f2cd892",
  front: "316484b30d9b488b79ce9074835e118fe66b3c36b93a660484be7250079478a3",
  rear: "ee766f590fa60c1fa0ebbc9c1d4f277df717bf052f35bbb6ede8f606502c028b",
};
const SIZES = { driver: [3371, 1365, 153, 56], passenger: [3371, 1365, 153, 56], hood: [1031, 835, 71.5, 56], roof: [1066, 820, 74.3, 54.8], front: [1758, 557, 129, 34], rear: [1088, 809, 76, 54] };

function fixtureSurfaces() {
  return Object.entries(SIZES).map(([surfaceKey, [pw, ph, tw, th]]) => ({
    surfaceKey, contentHash: HASHES[surfaceKey], storagePath: `designpro/t/run/panels/${surfaceKey}.png`,
    pixelWidth: pw, pixelHeight: ph, trimWidthIn: tw, trimHeightIn: th, printWidthIn: tw + 10, printHeightIn: th + 10,
    bleedInches: 5, sourceMasterHash: MASTER, noseEdge: surfaceKey === "driver" ? "left" : null,
  }));
}

function fixtureMap(overrides = {}) {
  return buildPanelMap({
    phase: "design",
    generationId: "1a0e6b70-272d-487c-b275-6b49206bc0ba",
    revisionId: "16154e4d-8545-4e3b-a831-fc9f2a6af786",
    revisionSequence: 1,
    designId: "DID-1A0E6B70",
    customerName: "Precision Climate Solutions",
    vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" },
    genie: { manifestId: "766258a022b2a2da16007affc37ade77", manifestHash: "766258a022b2a2da16007affc37ade77ee0af79f7b25f4f74a2039821de75b96" },
    master: { sha256: MASTER },
    productionSizingValidated: false,
    builtAt: "2026-09-02T21:28:38Z",
    surfaces: fixtureSurfaces(),
    ...overrides,
  });
}

async function artwork(width, height) {
  // Deterministic non-trivial artwork: a diagonal gradient with a hard stripe.
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const o = (y * width + x) * 3;
    raw[o] = (x * 7 + y * 3) & 255; raw[o + 1] = (x * 2 + y * 11) & 255; raw[o + 2] = (y % 40 < 8) ? 250 : (x ^ y) & 255;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

test("the strip is exactly the declared height on the bottom edge and the artwork above it is untouched", async () => {
  const width = 900; const height = 300;
  const source = await artwork(width, height);
  const map = fixtureMap();
  const lines = slugLines(map, "driver", { fileName: "driver-qc-panel.png" });
  const out = await applyPanelDataSlug(source, { lines, heightPx: QC_SLUG_PIXELS });
  assert.equal(out.width, width);
  assert.equal(out.height, height + QC_SLUG_PIXELS);
  assert.equal(out.artworkHeight, height);
  assert.equal(out.slug.edge, "bottom");
  const before = await sharp(source).raw().toBuffer({ resolveWithObject: true });
  const after = await sharp(out.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(after.info.width, width);
  assert.equal(after.info.channels, 3);
  const artworkBytes = width * height * 3;
  assert.ok(before.data.subarray(0, artworkBytes).equals(after.data.subarray(0, artworkBytes)), "artwork pixels above the strip are byte-identical");
  // The strip is ink only: every pixel is neutral (no chroma), and both black
  // and white are present -- ground, hairline, marks and text.
  let dark = 0; let light = 0;
  for (let i = artworkBytes; i < after.data.length; i += 3) {
    const [r, g, b] = [after.data[i], after.data[i + 1], after.data[i + 2]];
    assert.ok(Math.abs(r - g) <= 4 && Math.abs(g - b) <= 4, "strip pixels carry no colour");
    if (r < 40) dark += 1; else if (r > 240) light += 1;
  }
  assert.ok(dark > 200 && light > (width * QC_SLUG_PIXELS) * 0.5, "the strip is black ink on a white ground");
  // Hairline across the top of the strip.
  const stripTop = artworkBytes;
  let hairline = 0;
  for (let x = 0; x < width; x += 1) if (after.data[stripTop + x * 3] < 40) hairline += 1;
  assert.ok(hairline > width * 0.95, "a hairline runs the full width of the strip's top edge");
  const meta = slugMetadata({ heightPx: QC_SLUG_PIXELS, inches: null, lines });
  assert.equal(meta.slugContract, PANEL_DATA_SLUG_CONTRACT);
  assert.equal(meta.slugPixels, QC_SLUG_PIXELS);
  assert.equal(meta.slugLines.length, 7);
});

test("the slug refuses any edge but the contract's and any strip too small to read", async () => {
  const source = await artwork(200, 100);
  const lines = slugLines(fixtureMap(), "hood", {});
  await assert.rejects(applyPanelDataSlug(source, { lines, heightPx: 120, edge: "top" }), byCode("panel_data_slug_edge_unsupported"));
  await assert.rejects(applyPanelDataSlug(source, { lines, heightPx: 10 }), byCode("panel_data_slug_geometry_invalid"));
  await assert.rejects(renderPanelDataSlug({ lines: [], widthPx: 200, heightPx: 120 }), byCode("panel_data_slug_lines_invalid"));
});

test("the panel map refuses a split lineage and a missing surface, and its bytes round-trip", () => {
  const map = fixtureMap();
  assert.equal(map.contract, PANEL_MAP_CONTRACT);
  assert.equal(map.surfaces.driver.nativePpi, 20.68);
  assert.equal(map.surfaces.driver.upscaleFactorRequired, 7.25);
  assert.equal(map.surfaces.hood.sqFt, 27.81);
  const bytes = panelMapBytes(map);
  assert.deepEqual(parsePanelMap(bytes), map);
  assert.throws(() => fixtureMap({ master: { sha256: HASHES.driver } }), byCode("panel_map_master_split"));
  assert.throws(() => fixtureMap({ surfaces: fixtureSurfaces().slice(0, 5) }), byCode("panel_map_surface_missing"));
  assert.throws(() => fixtureMap({ phase: "production" }), byCode("panel_map_phase_invalid"), "a production map must carry validated sizing");
  const lines = slugLines(map, "driver", { fileName: "driver.tiff", outputPpi: 150 });
  assert.equal(lines.length, 7);
  assert.match(lines[0], /DRIVER SIDE/);
  assert.match(lines[0], /\[FRONT <-\]/);
  assert.match(lines[1], /DID-1A0E6B70/);
  assert.match(lines[1], /Order not assigned/);
  assert.match(lines[3], /Trim 153 x 56 in   Print 163 x 66 in \(5 in bleed all sides\)   59.5 sq ft   design-time sizing, NOT validated/);
  assert.match(lines[4], /sha256 e0e19b53bfa7\.\.\.   Master e391c2cca6a7\.\.\./);
  assert.match(lines[5], /Output 150 PPI full scale \(native 20.68 PPI, x7.25\)/);
  assert.match(lines[6], /blank until stamped/);
});

// The production contract, on real bytes, built exactly as output.build builds
// them: artwork = (trim + 10") x 150 px/in, then the strip, then PNG / TIFF at
// 1500 DPI (1:10 scale) and the deterministic EPS.
const TINY_TRIM = { driver: [2, 1], passenger: [2, 1], hood: [1, 1], roof: [1, 1], front: [1.5, 0.5], rear: [1, 1] };
function tinyManifest() {
  return { expectedSurfaces: Object.entries(TINY_TRIM).map(([surfaceKey, [w, h]]) => ({ surfaceKey, widthInches: w, heightInches: h, bleed: { top: 5, right: 5, bottom: 5, left: 5 } })) };
}
async function buildOutputSet({ withSlug = true, withDeclaration = true } = {}) {
  const map = fixtureMap({ phase: "production", productionSizingValidated: true, orderNumber: "RP-101204" });
  const artifacts = [];
  for (const [surfaceKey, [w, h]] of Object.entries(TINY_TRIM)) {
    const width = Math.round((w + 10) * 150); const height = Math.round((h + 10) * 150);
    const contained = await sharp(await artwork(width, height)).flatten().png().toBuffer();
    const lines = slugLines(map, surfaceKey, { fileName: `${surfaceKey}.tiff`, outputPpi: 150 });
    const slugged = withSlug ? await applyPanelDataSlug(contained, { lines, heightPx: OUTPUT_SLUG_PIXELS }) : { bytes: contained, height, artworkHeight: height };
    const fileHeight = slugged.height;
    const raster = await sharp(slugged.bytes).removeAlpha().toColourspace("srgb").png({ compressionLevel: 6 }).withMetadata({ density: 1500 }).toBuffer();
    const tiff = await sharp(slugged.bytes).removeAlpha().toColourspace("srgb").tiff({ compression: "lzw", predictor: "horizontal", bitdepth: 8 }).withMetadata({ density: 1500 }).toBuffer();
    const { data: rgb } = await sharp(slugged.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const eps = withSlug
      ? buildDeterministicRasterEps({ rgb, widthPixels: width, heightPixels: fileHeight, trimWidthInches: w, trimHeightInches: h, slug: PANEL_DATA_SLUG })
      : null;
    const meta = (format) => ({
      format, width, height: fileHeight, artworkHeightPixels: slugged.artworkHeight, dpi: 1500, outputScale: 0.1, fullScaleBleedInches: 5, colorMode: "sRGB",
      ...(withDeclaration ? slugMetadata({ heightPx: OUTPUT_SLUG_PIXELS, inches: SLUG_INCHES, lines }) : {}),
    });
    const push = (format, bytes) => artifacts.push({ kind: "output", surfaceKey, storagePath: `designpro/t/run/outputs/${surfaceKey}.${format}`, contentHash: outputQc.sha256(bytes), byteSize: bytes.length, metadata: meta(format), bytes });
    push("png", raster); push("tiff", tiff);
    if (eps) push("eps", eps);
  }
  return artifacts;
}

test("a production output set carrying the slug verifies, and the receipt declares it", async () => {
  const artifacts = await buildOutputSet();
  const verified = await verifyProductionOutputSet({ artifacts, dimensionManifest: tinyManifest() });
  assert.equal(verified.verified, true);
  assert.equal(verified.contract, "designpro.output-verification.v2");
  assert.deepEqual(verified.panelDataSlug, PANEL_DATA_SLUG);
  assert.equal(verified.files.length, 18);
  const driverPng = verified.files.find((file) => file.surfaceKey === "driver" && file.format === "png");
  assert.equal(driverPng.artworkHeightPixels, 11 * 150);
  assert.equal(driverPng.heightPixels, 11 * 150 + 225);
  assert.equal(driverPng.slugPixels, 225);
});

test("a production output without the strip declaration, and one whose file height is not artwork + strip, are refused", async () => {
  const undeclared = await buildOutputSet({ withDeclaration: false });
  await assert.rejects(verifyProductionOutputSet({ artifacts: undeclared, dimensionManifest: tinyManifest() }), byCode("output_artifact_slug_missing"));
  // No strip on the pixels: the EPS builder refuses first (it will not build a
  // raster of the wrong height), so build the rasters only and complete the set
  // with declared-but-dishonest metadata.
  const bare = await buildOutputSet({ withSlug: false, withDeclaration: true });
  assert.equal(bare.length, 12, "no EPS can be built without the strip");
  const honest = await buildOutputSet();
  const mixed = [...bare, ...honest.filter((a) => a.metadata.format === "eps")];
  for (const item of mixed) if (item.metadata.format !== "eps") item.metadata.height = item.metadata.artworkHeightPixels + 225;
  await assert.rejects(verifyProductionOutputSet({ artifacts: mixed, dimensionManifest: tinyManifest() }), byCode("output_raster_geometry_invalid", "output_artifact_metadata_geometry_invalid", "output_raster_header_geometry_invalid"));
  assert.throws(() => buildDeterministicRasterEps({ rgb: Buffer.alloc(30 * 10 * 3), widthPixels: 30, heightPixels: 10, trimWidthInches: 1, trimHeightInches: 1 }), byCode("output_eps_slug_required"));
});

test("the QC keys the human gates require agree across the gateway, the checklist, the certificate and the migration", () => {
  const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
  const stages = readFileSync(new URL("../app/src/lib/designpro-stages.ts", import.meta.url), "utf8");
  const api = readFileSync(new URL("../app/src/lib/designpro-api.ts", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260903000000_designpro_panel_data_slug.sql", import.meta.url), "utf8");
  for (const key of ["panelDataSlugVerified", "productionSlugVerified"]) {
    assert.match(gateway, new RegExp(`"${key}"`));
    assert.match(stages, new RegExp(`\\["${key}",`));
    assert.match(api, new RegExp(`${key}: boolean`));
    assert.match(migration, new RegExp(`"${key}":true`));
  }
  assert.ok(certificate.PREFLIGHT_LABELS.some(([key]) => key === "panelDataSlugVerified"));
  assert.ok(certificate.FINAL_LABELS.some(([key]) => key === "productionSlugVerified"));
  assert.match(migration, /'panel-map'/);
  // The live-body patch asserts uniqueness and re-reads the result.
  assert.match(migration, /pg_get_functiondef/);
  assert.match(migration, /designpro_human_gate_slug_patch_not_applied/);
});
