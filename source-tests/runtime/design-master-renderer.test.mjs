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

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const { DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE, validateDesignMaster } = require("../../runtime/design-master.cjs");
const { renderProductionSurfaces, _test: internals } = require("../../runtime/design-master-renderer.cjs");

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
    fonts: [{ fontId: "brand-sans", family: "Precision Sans", version: "2.1.0", contentHash: sha256(Buffer.from("font")), license: "commercial-embed" }],
    layers: [
      { layerId: "base", type: "solid", space: GLOBAL_SPACE, colorTokens: ["paper-white"],
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 0, opacity: 1, blend: "normal", mask: { type: "none" } },
      // One graphic painted once across the whole design space.
      { layerId: "field", type: "raster", space: GLOBAL_SPACE, assetId: "field",
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 10, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "mark", type: "logo", space: "driver", logoIdentityKey: "precision-mark",
        widthIn: 6, heightIn: 6,
        transform: { x: 2, y: 2, scale: 1, rotate: 0 }, zOrder: 50, opacity: 1, blend: "normal", mask: { type: "none" } },
    ],
    textObjects: [],
    logoObjects: [{ identityKey: "precision-mark", assetId: "mark", contentHash: assets.mark.hash, surfaceKey: "driver", neverMirror: true, neverRasterizeIntoBase: true }],
  });
  const loadAsset = async (asset) => assets[asset.assetId].bytes;
  return { master, loadAsset, assets };
}

const render = async (over = {}) => {
  const { master, loadAsset } = await fixture();
  return renderProductionSurfaces({ master, loadAsset, pxPerInch: PPI, bleedInches: BLEED, ...over });
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
      layerId: "flank-art", type: "vector", space: "passenger", assetId: "mark", widthIn: 8, heightIn: 8,
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
      layerId: "badge", space: "passenger", widthIn: 6, heightIn: 6,
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

// PHASE 2 FINDING. libvips resolves font-family through fontconfig and silently
// substitutes: an embedded @font-face data URI is discarded, and serif-bold,
// monospace and a nonexistent family all render byte-identically. Rasterising
// type that way would put glyphs into production that are not the glyphs the
// master specifies. The renderer therefore refuses rather than shipping type it
// cannot prove.
test("text refuses to render without a rasteriser that honours the pinned font", async () => {
  const { master, loadAsset } = await fixture();
  const withText = clone(master);
  withText.textObjects = [{ textId: "domain", string: "PrecisionClimateAZ.com", fontId: "brand-sans", sizeIn: 2, colorToken: "brand-blue", neverMirror: true, spellingAuthority: "revision-snapshot" }];
  withText.layers.push({ layerId: "domain-type", type: "text", space: "driver", textId: "domain",
    transform: { x: 2, y: 8, scale: 1, rotate: 0 }, zOrder: 60, opacity: 1, blend: "normal", mask: { type: "none" } });
  const validated = validateDesignMaster({ ...withText, masterHash: undefined });

  await assert.rejects(
    renderProductionSurfaces({ master: validated, loadAsset, pxPerInch: PPI, bleedInches: BLEED }),
    (error) => error.code === "render_text_rasterizer_required",
  );

  // With one supplied, the canonical string is carried into the surface receipt
  // exactly as the master declares it.
  const rasterizeText = async ({ text, widthPx, heightPx }) => ({
    bytes: await sharp({ create: { width: Math.max(1, widthPx), height: Math.max(1, heightPx), channels: 4, background: { r: 11, g: 61, b: 145, alpha: 1 } } }).png().toBuffer(),
    widthPx, heightPx, string: text.string,
  });
  const rendered = await renderProductionSurfaces({ master: validated, loadAsset, pxPerInch: PPI, bleedInches: BLEED, rasterizeText });
  const driver = rendered.surfaces.find((s) => s.surfaceKey === "driver");
  assert.deepEqual(driver.textIdentities, [{ textId: "domain", string: "PrecisionClimateAZ.com" }]);
});

test("layer order is by depth then identifier, never by array position", () => {
  const master = { layers: [
    { layerId: "b", zOrder: 10 }, { layerId: "a", zOrder: 10 }, { layerId: "c", zOrder: 0 },
  ] };
  assert.deepEqual(internals.orderedLayers(master).map((layer) => layer.layerId), ["c", "a", "b"]);
});
