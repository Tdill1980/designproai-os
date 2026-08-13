// Phase 2 gate: deterministic production-surface rendering.
//
// The gate is reproducibility. Render one master twice and the six surfaces
// must be byte-identical, because manufacturing truth that cannot be reproduced
// is not truth. The retired path could not reproduce anything: its master did
// not exist until a model invented one, and a retry invented a different one.
//
// Geometry is asserted against the real F-250 numbers; pixels are rendered at a
// small vehicle and resolution so the suite stays fast.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const { DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE, validateDesignMaster } = require("../../runtime/design-master.cjs");
const { renderProductionSurfaces, DEFAULT_MAX_SURFACE_BYTES, PEAK_BYTES_PER_PIXEL, _test: internals } = require("../../runtime/design-master-renderer.cjs");

// Real, materially different TrueType files. The whole point of outlining is
// that these cannot produce the same glyphs.
const FONT_FILES = {
  sans: "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  serifBold: "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
};
const fontBytes = (which) => readFileSync(FONT_FILES[which]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

const BLEED = 5;
const PPI = 4;
// A deliberately asymmetric field: left half red, right half blue, so a mirror
// is visible in the pixels rather than merely asserted.
async function asymmetricField() {
  return sharp({ create: { width: 240, height: 120, channels: 3, background: "#c81e1e" } })
    .composite([{ input: await sharp({ create: { width: 120, height: 120, channels: 3, background: "#1e46c8" } }).png().toBuffer(), left: 120, top: 0 }])
    .png({ compressionLevel: 6, adaptiveFiltering: false, force: true }).toBuffer();
}
const MARK_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0b3d91"/><rect x="0" y="0" width="20" height="8" fill="#ffffff"/></svg>');
const CUTIN_SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#000"/><rect x="0" y="0" width="40" height="20" fill="#fff"/></svg>');

// Small surfaces laid out in one row so global artwork genuinely spans them.
const TRIM = { driver: [20, 12], passenger: [20, 12], hood: [10, 12], roof: [10, 12], front: [14, 8], rear: [12, 10] };
const SEAM = (edge, joins, joinEdge, orientation) => ({
  edge, span: [0, 1], joins, joinEdge, joinSpan: orientation === "same" ? [0, 1] : [1, 0], orientation, continuity: "exact",
});
const SEAMS = {
  driver: [SEAM("left", "hood", "left", "same")],
  passenger: [SEAM("left", "hood", "right", "reversed")],
  hood: [SEAM("left", "driver", "left", "same"), SEAM("right", "passenger", "left", "reversed")],
  roof: [], front: [], rear: [],
};

async function fixture() {
  const fieldBytes = await asymmetricField();
  const assets = {
    field: { bytes: fieldBytes, hash: sha256(fieldBytes) },
    mark: { bytes: MARK_SVG, hash: sha256(MARK_SVG) },
    cutin: { bytes: CUTIN_SVG, hash: sha256(CUTIN_SVG) },
  };
  let originX = 0;
  const master = validateDesignMaster({
    contract: DESIGN_MASTER_CONTRACT,
    masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
    dimensionManifestId: uuid("d"), manifestHash: sha256(Buffer.from("manifest")),
    designId: "DID-PHASE2",
    designSpace: {
      contract: DESIGN_SPACE_CONTRACT, designSpaceId: uuid("f"), unitsPerInch: 1,
      surfaces: SURFACE_KEYS.map((surfaceKey, index) => {
        const surface = {
          surfaceKey, originIn: [originX, 0],
          widthIn: TRIM[surfaceKey][0], heightIn: TRIM[surfaceKey][1],
          mirror: surfaceKey === "passenger",
          mapping: { kind: "planar-developable", mappingId: uuid(String(index + 1)), mappingHash: sha256(Buffer.from(surfaceKey)) },
          seams: SEAMS[surfaceKey],
        };
        originX += TRIM[surfaceKey][0] + BLEED * 2 + 2;
        return surface;
      }),
    },
    assets: [
      { assetId: "field", kind: "raster", contentHash: assets.field.hash, storagePath: "a/field.png",
        intrinsic: { widthPx: 240, heightPx: 120 }, minPxPerInch: 1 },
      { assetId: "mark", kind: "vector", contentHash: assets.mark.hash, storagePath: "a/mark.svg" },
      { assetId: "cutin", kind: "vector", contentHash: assets.cutin.hash, storagePath: "a/cutin.svg" },
    ],
    palette: [{ token: "brand-blue", srgb: "#0b3d91" }, { token: "paper-white", srgb: "#f4f6f8" }],
    fonts: [{ fontId: "brand-sans", family: "DejaVu Sans", version: "2.37", contentHash: sha256(fontBytes("sans")), license: "bitstream-vera", storagePath: "a/sans.ttf" }],
    layers: [
      { layerId: "base", type: "solid", space: GLOBAL_SPACE, colorTokens: ["paper-white"], extent: { widthIn: 182, heightIn: 22 },
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 0, opacity: 1, blend: "normal", mask: { type: "none" } },
      // One graphic painted once across the whole design space.
      { layerId: "field", type: "raster", space: GLOBAL_SPACE, assetId: "field", extent: { widthIn: 182, heightIn: 22 },
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 10, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "mark", type: "logo", space: "driver", logoIdentityKey: "precision-mark", extent: { widthIn: 6, heightIn: 6 },
        transform: { x: 2, y: 2, scale: 1, rotate: 0 }, zOrder: 50, opacity: 1, blend: "normal", mask: { type: "none" } },
    ],
    textObjects: [],
    logoObjects: [{ identityKey: "precision-mark", assetId: "mark", contentHash: assets.mark.hash, surfaceKey: "driver", neverMirror: true, neverRasterizeIntoBase: true }],
  });
  const loadAsset = async (asset) => assets[asset.assetId].bytes;
  const loadFont = async () => fontBytes("sans");
  return { master, loadAsset, loadFont, assets };
}

const render = async (over = {}) => {
  const { master, loadAsset, loadFont } = await fixture();
  return renderProductionSurfaces({ master, loadAsset, loadFont, pxPerInch: PPI, bleedInches: BLEED, ...over });
};

// ------------------------------------------------------------- the gate

test("GATE: the same master renders byte-identical six-surface output twice", async () => {
  const first = await render();
  const second = await render();

  assert.equal(first.surfaces.length, 6);
  assert.deepEqual(first.surfaces.map((s) => s.surfaceKey), SURFACE_KEYS);
  for (const [index, surface] of first.surfaces.entries()) {
    assert.equal(surface.contentHash, second.surfaces[index].contentHash, `${surface.surfaceKey} is not reproducible`);
    assert.equal(surface.byteSize, second.surfaces[index].byteSize);
  }
  assert.equal(first.renderHash, second.renderHash, "the render identity must be reproducible");
  assert.equal(first.masterHash, second.masterHash);
});

test("a changed master produces a different render identity", async () => {
  const base = await render();
  const { master, loadAsset } = await fixture();
  const moved = clone(master);
  moved.layers.find((layer) => layer.layerId === "mark").transform.x = 3;
  const changed = await renderProductionSurfaces({ master: validateDesignMaster({ ...moved, masterHash: undefined }), loadAsset, pxPerInch: PPI, bleedInches: BLEED });
  assert.notEqual(changed.renderHash, base.renderHash);
});

// ------------------------------------------------------------ geometry

test("geometry is GENIE trim plus five inches of bleed on every edge", async () => {
  const result = await render();
  for (const surface of result.surfaces) {
    const [trimW, trimH] = TRIM[surface.surfaceKey];
    assert.equal(surface.trimWidthIn, trimW);
    assert.equal(surface.trimHeightIn, trimH);
    assert.equal(surface.bleedIn, BLEED);
    assert.equal(surface.printWidthIn, trimW + BLEED * 2);
    assert.equal(surface.printHeightIn, trimH + BLEED * 2);
    assert.equal(surface.pixelWidth, Math.round((trimW + BLEED * 2) * PPI));
    assert.equal(surface.pixelHeight, Math.round((trimH + BLEED * 2) * PPI));
    const meta = await sharp(surface.bytes).metadata();
    assert.equal(meta.width, surface.pixelWidth, `${surface.surfaceKey} raster does not match its declared geometry`);
    assert.equal(meta.height, surface.pixelHeight);
  }
});

test("the real F-250 geometry resolves correctly at production resolution", () => {
  // 153 x 56 trim -> 163 x 66 print -> 24450 x 9900 at 150 px/in.
  const window = internals.surfaceWindow({ originIn: [0, 0], widthIn: 153, heightIn: 56 }, 5, 150);
  assert.equal(window.printWidthIn, 163);
  assert.equal(window.printHeightIn, 66);
  assert.equal(window.widthPx, 24450);
  assert.equal(window.heightPx, 9900);
  assert.deepEqual(window.originIn, [-5, -5]);
});

// --------------------------------------------------------------- bleed

test("bleed is sampled from the shared field, not generated at the edge", async () => {
  const result = await render();
  const driver = result.surfaces.find((s) => s.surfaceKey === "driver");
  // The bleed margin must carry artwork, not a manufactured edge colour. If it
  // were generated, the outer band would be flat white background.
  const bleedPx = Math.round(BLEED * PPI);
  const corner = await sharp(driver.bytes).extract({ left: 0, top: 0, width: bleedPx, height: bleedPx }).stats();
  const paperWhite = corner.channels.every((channel) => channel.mean > 243);
  assert.equal(paperWhite, false, "the bleed region is blank, so it was generated rather than sampled from the field");
});

// -------------------------------------------------------------- mirror

test("a mirrored surface is exactly the flip of the same surface unmirrored", async () => {
  const { master, loadAsset } = await fixture();
  const variant = async (mirror) => {
    const candidate = clone(master);
    candidate.designSpace.surfaces.find((s) => s.surfaceKey === "passenger").mirror = mirror;
    // The global field is uniform across this surface's window, so flipping it
    // is a no-op. Give the flank something asymmetric of its own to flip.
    candidate.layers.push({
      layerId: "flank-art", type: "vector", space: "passenger", assetId: "mark", extent: { widthIn: 8, heightIn: 8 },
      transform: { x: 1, y: 1, scale: 1, rotate: 0 }, zOrder: 30, opacity: 1, blend: "normal", mask: { type: "none" },
    });
    const result = await renderProductionSurfaces({ master: validateDesignMaster({ ...candidate, masterHash: undefined }), loadAsset, pxPerInch: PPI, bleedInches: BLEED });
    return result.surfaces.find((s) => s.surfaceKey === "passenger");
  };

  const mirrored = await variant(true);
  const plain = await variant(false);
  assert.equal(mirrored.mirror, true);
  assert.equal(plain.mirror, false);
  assert.notEqual(mirrored.contentHash, plain.contentHash);

  // The precise definition of mirroring: same window on the design space, flipped.
  const flippedPlain = await sharp(plain.bytes).flop().raw().toBuffer();
  const mirroredRaw = await sharp(mirrored.bytes).raw().toBuffer();
  assert.equal(Buffer.compare(mirroredRaw, flippedPlain), 0, "a mirrored surface must be the exact flip of the unmirrored one");
});

test("a neverMirror logo is not flipped, where the same asset as artwork would be", async () => {
  const { master, loadAsset } = await fixture();
  // Same asset, same place, on the mirrored flank — once as a protected logo,
  // once as ordinary artwork. Only the artwork may flip.
  const build = async (asProtectedLogo) => {
    const candidate = clone(master);
    const placed = {
      layerId: "badge", space: "passenger", extent: { widthIn: 6, heightIn: 6 },
      transform: { x: 2, y: 2, scale: 1, rotate: 0 }, zOrder: 50, opacity: 1, blend: "normal", mask: { type: "none" },
    };
    if (asProtectedLogo) {
      candidate.logoObjects.push({ identityKey: "precision-mark", assetId: "mark", contentHash: master.logoObjects[0].contentHash, surfaceKey: "passenger", neverMirror: true, neverRasterizeIntoBase: true });
      candidate.layers.push({ ...placed, type: "logo", logoIdentityKey: "precision-mark" });
    } else {
      candidate.layers.push({ ...placed, type: "vector", assetId: "mark" });
    }
    const result = await renderProductionSurfaces({ master: validateDesignMaster({ ...candidate, masterHash: undefined }), loadAsset, pxPerInch: PPI, bleedInches: BLEED });
    return result.surfaces.find((s) => s.surfaceKey === "passenger");
  };

  const asLogo = await build(true);
  const asArtwork = await build(false);
  assert.deepEqual(asLogo.logoIdentities, [{ identityKey: "precision-mark", contentHash: master.logoObjects[0].contentHash }]);
  assert.notEqual(asLogo.contentHash, asArtwork.contentHash,
    "the mark is asymmetric, so a protected logo and ordinary artwork must differ on a mirrored surface");
});

// -------------------------------------------------- spanning and overrides

test("one global graphic reaches every surface it crosses", async () => {
  const result = await render();
  for (const surface of result.surfaces) {
    assert.ok(surface.layerIds.includes("field"), `${surface.surfaceKey} did not receive the spanning graphic`);
    assert.ok(surface.layerIds.includes("base"));
  }
  // The driver-only logo appears exactly where it is declared and nowhere else.
  assert.deepEqual(result.surfaces.filter((s) => s.layerIds.includes("mark")).map((s) => s.surfaceKey), ["driver"]);
});

test("a surface override can hide a layer on one surface only", async () => {
  const { master, loadAsset } = await fixture();
  const hidden = clone(master);
  hidden.layers.find((layer) => layer.layerId === "field").surfaceOverrides = { rear: { visible: false } };
  const result = await renderProductionSurfaces({ master: validateDesignMaster({ ...hidden, masterHash: undefined }), loadAsset, pxPerInch: PPI, bleedInches: BLEED });
  const rear = result.surfaces.find((s) => s.surfaceKey === "rear");
  const front = result.surfaces.find((s) => s.surfaceKey === "front");
  assert.equal(rear.layerIds.includes("field"), false);
  assert.equal(front.layerIds.includes("field"), true);
});

// ------------------------------------------------------------ fail closed

test("an asset whose bytes do not match the master is refused", async () => {
  const { master } = await fixture();
  const tampered = async () => Buffer.from("not the declared bytes");
  await assert.rejects(
    renderProductionSurfaces({ master, loadAsset: tampered, pxPerInch: PPI, bleedInches: BLEED }),
    (error) => error.code === "render_asset_hash_mismatch",
  );
});

test("a raster below its declared resolution floor is refused before pixels are made", async () => {
  const { master, loadAsset } = await fixture();
  const starved = clone(master);
  // The field is 240px wide and spans the whole design space; demand more than
  // it can deliver at that size.
  starved.assets.find((asset) => asset.assetId === "field").minPxPerInch = 500;
  await assert.rejects(
    renderProductionSurfaces({ master: validateDesignMaster({ ...starved, masterHash: undefined }), loadAsset, pxPerInch: PPI, bleedInches: BLEED }),
    (error) => error.code === "render_resolution_below_floor",
  );
});

// Typography is cut from the pinned font file, never resolved by family name.
// libvips goes through fontconfig and substitutes silently: an embedded
// @font-face data URI is discarded, and DejaVu Serif Bold, DejaVu Sans Mono and
// a family that does not exist all rasterise byte-identically.
async function withText(fontKey) {
  const { master, loadAsset } = await fixture();
  const bytes = fontBytes(fontKey);
  const candidate = clone(master);
  candidate.fonts = [{ fontId: "brand-sans", family: "Pinned", version: "1", contentHash: sha256(bytes), license: "bitstream-vera", storagePath: "a/f.ttf" }];
  candidate.textObjects = [{ textId: "domain", string: "PrecisionClimateAZ.com", fontId: "brand-sans", sizeIn: 3, colorToken: "brand-blue", neverMirror: true, spellingAuthority: "revision-snapshot" }];
  candidate.layers.push({ layerId: "domain-type", type: "text", space: "driver", textId: "domain", extent: { widthIn: 24, heightIn: 5 },
    transform: { x: 1, y: 1, scale: 1, rotate: 0 }, zOrder: 60, opacity: 1, blend: "normal", mask: { type: "none" } });
  return { master: validateDesignMaster({ ...candidate, masterHash: undefined }), loadAsset, loadFont: async () => bytes };
}

test("GATE: the exact pinned font bytes govern the glyphs", async () => {
  const sans = await withText("sans");
  const serif = await withText("serifBold");
  const one = await renderProductionSurfaces({ ...sans, pxPerInch: 24, bleedInches: BLEED });
  const two = await renderProductionSurfaces({ ...serif, pxPerInch: 24, bleedInches: BLEED });
  const driverOf = (r) => r.surfaces.find((s) => s.surfaceKey === "driver");

  assert.notEqual(driverOf(one).contentHash, driverOf(two).contentHash,
    "two materially different pinned fonts must not produce the same glyph bytes");

  // Same pinned font, twice, byte-identical.
  const again = await renderProductionSurfaces({ ...(await withText("sans")), pxPerInch: 24, bleedInches: BLEED });
  assert.equal(driverOf(again).contentHash, driverOf(one).contentHash);

  // The canonical string survives into the receipt exactly as declared.
  assert.deepEqual(driverOf(one).textIdentities, [{ textId: "domain", string: "PrecisionClimateAZ.com" }]);
});

test("a substituted or missing font fails closed", async () => {
  const { master, loadAsset } = await withText("sans");
  await assert.rejects(
    renderProductionSurfaces({ master, loadAsset, loadFont: async () => fontBytes("serifBold"), pxPerInch: 24, bleedInches: BLEED }),
    (error) => error.code === "render_font_hash_mismatch", "a different font file must be refused");
  await assert.rejects(
    renderProductionSurfaces({ master, loadAsset, pxPerInch: 24, bleedInches: BLEED }),
    (error) => error.code === "render_font_loader_required", "no loader at all must be refused");
});

test("a glyph the pinned font does not contain fails closed rather than printing .notdef", async () => {
  const { master, loadAsset, loadFont } = await withText("sans");
  const exotic = clone(master);
  exotic.textObjects[0].string = "Precision \u{1F600} Climate";
  await assert.rejects(
    renderProductionSurfaces({ master: validateDesignMaster({ ...exotic, masterHash: undefined }), loadAsset, loadFont, pxPerInch: 24, bleedInches: BLEED }),
    (error) => error.code === "font_glyph_missing");
});

// ------------------------------------------------- production resource budget

test("GATE: the real F-250 driver surface is inside a declared production budget", () => {
  const window = internals.surfaceWindow({ originIn: [0, 0], widthIn: 153, heightIn: 56 }, 5, 150);
  assert.equal(window.widthPx, 24450);
  assert.equal(window.heightPx, 9900);

  const budget = internals.surfaceBudget(window, DEFAULT_MAX_SURFACE_BYTES);
  assert.equal(budget.peakBytes, 24450 * 9900 * PEAK_BYTES_PER_PIXEL);
  assert.equal(budget.withinBudget, true,
    `the F-250 driver surface needs ${(budget.peakBytes / 1e9).toFixed(2)} GB against a ${(DEFAULT_MAX_SURFACE_BYTES / 1e9).toFixed(2)} GB budget`);
});

// Measured, not assumed. A full six-surface F-250 render at 150 px/in — driver
// and passenger at 24450x9900 — completed in 160 s at 3.26 GB peak RSS. The
// first estimate predicted 2.90 GB and so was not a bound; the factor was
// raised until the prediction sits above what was actually observed.
test("the declared peak bounds the peak a real production render actually reached", () => {
  const MEASURED_F250_PEAK_BYTES = 3.26e9;
  const window = internals.surfaceWindow({ originIn: [0, 0], widthIn: 153, heightIn: 56 }, 5, 150);
  const budget = internals.surfaceBudget(window, DEFAULT_MAX_SURFACE_BYTES);
  assert.ok(budget.peakBytes >= MEASURED_F250_PEAK_BYTES,
    `predicted ${(budget.peakBytes / 1e9).toFixed(2)} GB must bound the measured ${(MEASURED_F250_PEAK_BYTES / 1e9).toFixed(2)} GB`);
  assert.ok(budget.withinBudget, "and must still sit inside the production budget");
});

test("a surface above the budget fails closed instead of finding the ceiling in production", async () => {
  const { master, loadAsset, loadFont } = await fixture();
  await assert.rejects(
    renderProductionSurfaces({ master, loadAsset, loadFont, pxPerInch: PPI, bleedInches: BLEED, maxSurfaceBytes: 1024 }),
    (error) => error.code === "render_surface_exceeds_budget");
});

test("the render reports the peak it expects, so a host can be sized for it", async () => {
  const result = await render();
  const widest = result.surfaces.reduce((max, s) => Math.max(max, s.pixelWidth * s.pixelHeight * PEAK_BYTES_PER_PIXEL), 0);
  assert.equal(result.peakBytesPerSurface, widest);
  assert.equal(result.maxSurfaceBytes, DEFAULT_MAX_SURFACE_BYTES);
});

test("layer order is by depth then identifier, never by array position", () => {
  const master = { layers: [
    { layerId: "b", zOrder: 10 }, { layerId: "a", zOrder: 10 }, { layerId: "c", zOrder: 0 },
  ] };
  assert.deepEqual(internals.orderedLayers(master).map((layer) => layer.layerId), ["c", "a", "b"]);
});
