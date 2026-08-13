// Phase 4 gate: the 3D customer proof is derived from manufacturing truth.
//
// This is the artefact customers actually look at, and under the retired path
// it was the artefact production truth was reconstructed *from*. Now it is
// downstream of the panels: every artwork pixel is read out of an authoritative
// surface, and the vehicle contributes only shape and light.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const {
  DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE, validateDesignMaster,
} = require("../../runtime/design-master.cjs");
const { renderProductionSurfaces } = require("../../runtime/design-master-renderer.cjs");
const { VIEW_PLATE_CONTRACT, validateViewPlates } = require("../../runtime/vehicle-view-plate.cjs");
const {
  renderMasterDerived3dProof, PROOF_3D_CONTRACT,
} = require("../../runtime/master-derived-3d-proof.cjs");

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));
const FONT = readFileSync("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");

const BLEED = 5;
const PPI = 4;
const TRIM = { driver: [20, 12], passenger: [20, 12], hood: [10, 12], roof: [10, 12], front: [14, 8], rear: [12, 10] };
const MARK = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#0b3d91"/><rect width="20" height="8" fill="#fff"/></svg>');
const FRAME = { widthPx: 480, heightPx: 300 };

const MANIFEST_ID = uuid("d");
const MANIFEST_HASH = sha256(Buffer.from("manifest"));

// ------------------------------------------------------------------ fixtures

/**
 * Artwork with structure everywhere, not a flat field.
 *
 * A uniform colour warps to itself under any mesh, so a fixture without detail
 * would let a geometry regression pass every pixel comparison in this file. The
 * check pattern gives every surface features whose position a warp can move.
 */
function checkField(width, height) {
  const bytes = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3;
      const dark = ((x / 6 | 0) + (y / 6 | 0)) % 2 === 0;
      bytes[index] = dark ? 200 : 30 + ((x * 3) % 60);
      bytes[index + 1] = dark ? 30 : 90;
      bytes[index + 2] = dark ? 40 : 190;
    }
  }
  return bytes;
}

async function build(mutate = (m) => m) {
  const field = await sharp(checkField(240, 120), { raw: { width: 240, height: 120, channels: 3 } })
    .png({ compressionLevel: 6, adaptiveFiltering: false, force: true }).toBuffer();
  const bytesFor = { field, mark: MARK };
  let x = 0;
  const draft = {
    contract: DESIGN_MASTER_CONTRACT,
    masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
    dimensionManifestId: MANIFEST_ID, manifestHash: MANIFEST_HASH,
    designId: "DID-PHASE4",
    designSpace: {
      contract: DESIGN_SPACE_CONTRACT, designSpaceId: uuid("f"), unitsPerInch: 1,
      surfaces: SURFACE_KEYS.map((surfaceKey, index) => {
        const surface = {
          surfaceKey, originIn: [x, 0], widthIn: TRIM[surfaceKey][0], heightIn: TRIM[surfaceKey][1],
          mirror: surfaceKey === "passenger",
          mapping: { kind: "planar-developable", mappingId: uuid(String(index + 1)), mappingHash: sha256(Buffer.from(surfaceKey)) },
          seams: [],
        };
        x += TRIM[surfaceKey][0] + BLEED * 2 + 2;
        return surface;
      }),
    },
    assets: [
      { assetId: "field", kind: "raster", contentHash: sha256(field), storagePath: "a/field.png", intrinsic: { widthPx: 240, heightPx: 120 }, minPxPerInch: 1 },
      { assetId: "mark", kind: "vector", contentHash: sha256(MARK), storagePath: "a/mark.svg" },
    ],
    palette: [{ token: "brand-blue", srgb: "#0b3d91" }, { token: "paper-white", srgb: "#f4f6f8" }],
    fonts: [{ fontId: "sans", family: "DejaVu Sans", version: "2.37", contentHash: sha256(FONT), license: "bitstream-vera", storagePath: "a/s.ttf" }],
    layers: [
      { layerId: "field", type: "raster", space: GLOBAL_SPACE, assetId: "field", extent: { widthIn: 182, heightIn: 22 },
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 10, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "domain-type", type: "text", space: "passenger", textId: "domain", extent: { widthIn: 24, heightIn: 3 },
        transform: { x: 1, y: 1, scale: 1, rotate: 0 }, zOrder: 60, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "mark", type: "logo", space: "passenger", logoIdentityKey: "precision-mark", extent: { widthIn: 6, heightIn: 6 },
        transform: { x: 2, y: 5, scale: 1, rotate: 0 }, zOrder: 70, opacity: 1, blend: "normal", mask: { type: "none" } },
    ],
    textObjects: [{ textId: "domain", string: "PrecisionClimateAZ.com", fontId: "sans", sizeIn: 1.5, colorToken: "paper-white", neverMirror: true, spellingAuthority: "revision-snapshot" }],
    logoObjects: [{ identityKey: "precision-mark", assetId: "mark", contentHash: sha256(MARK), surfaceKey: "passenger", neverMirror: true, neverRasterizeIntoBase: true }],
  };
  const master = validateDesignMaster({ ...mutate(draft), masterHash: undefined });
  const render = await renderProductionSurfaces({
    master, loadAsset: async (a) => bytesFor[a.assetId], loadFont: async () => FONT, pxPerInch: PPI, bleedInches: BLEED,
  });
  return { master, render };
}

const PNG = { compressionLevel: 6, adaptiveFiltering: false, force: true };
const asPng = (pipeline) => pipeline.png(PNG).toBuffer();
const band = (bytes) => asPng(sharp(bytes, { raw: { width: FRAME.widthPx, height: FRAME.heightPx, channels: 1 } }));

/** A studio plate: bare vehicle body, a lit panel window, and its mask. */
async function plateAssets() {
  const assets = new Map();
  const put = (id, bytes) => { assets.set(id, bytes); return sha256(bytes); };

  const base = await bareVehicle();
  // Light falling across the body: a gradient, so the artwork picks up the
  // curvature of the panel instead of sitting on it like a decal.
  const shading = await band(gradientBand(140, 255));
  const specular = await band(gradientBand(0, 70));
  const maskBytes = Buffer.alloc(FRAME.widthPx * FRAME.heightPx, 0);
  for (let y = 80; y < 210; y += 1) maskBytes.fill(255, y * FRAME.widthPx + 110, y * FRAME.widthPx + 370);
  const mask = await band(maskBytes);

  return {
    assets,
    hashes: {
      base: put("base", base),
      shading: put("shading", shading),
      specular: put("specular", specular),
      mask: put("mask", mask),
    },
  };
}

const frameCreate = () => ({ width: FRAME.widthPx, height: FRAME.heightPx, channels: 3 });

function bareVehicle() {
  const body = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="160"><rect width="300" height="160" fill="#4a5160"/></svg>`);
  return asPng(sharp({ create: { ...frameCreate(), background: "#20242b" } })
    .composite([{ input: body, left: 90, top: 60 }]));
}

function gradientBand(low, high) {
  const bytes = Buffer.alloc(FRAME.widthPx * FRAME.heightPx);
  for (let y = 0; y < FRAME.heightPx; y += 1) {
    for (let x = 0; x < FRAME.widthPx; x += 1) {
      bytes[y * FRAME.widthPx + x] = Math.round(low + ((high - low) * x) / (FRAME.widthPx - 1));
    }
  }
  return bytes;
}

/**
 * The mask window is 110..370 x 80..210. The mesh must cover all of it, so the
 * panel is meshed slightly proud of the mask and the mask does the trimming.
 */
function mesh({ rows = 2, cols = 4, bow = 0 } = {}) {
  const box = { x: 105, y: 75, w: 270, h: 140 };
  const points = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const u = col / cols, v = row / rows;
      // A barrelled flank: the panel bulges away from its centre line, which is
      // what a vehicle side does and what makes the warp non-affine.
      points.push({ u, v, x: box.x + u * box.w, y: box.y + v * box.h + bow * (2 * v - 1) * Math.sin(u * Math.PI) });
    }
  }
  return { rows, cols, points };
}

function plateSet(hashes) {
  const image = (id, contentHash) => ({ assetId: id, contentHash });
  const view = (viewKey, handedness, surfaceKeys, meshOptions) => ({
    viewKey, handedness, label: viewKey.toUpperCase(),
    base: image("base", hashes.base),
    shading: image("shading", hashes.shading),
    specular: image("specular", hashes.specular),
    panels: surfaceKeys.map((surfaceKey) => ({
      surfaceKey, mask: image("mask", hashes.mask), mesh: mesh(meshOptions),
    })),
  });
  return {
    contract: VIEW_PLATE_CONTRACT,
    plateSetId: uuid("e"), vehicleId: uuid("c"),
    dimensionManifestId: MANIFEST_ID, manifestHash: MANIFEST_HASH,
    widthPx: FRAME.widthPx, heightPx: FRAME.heightPx,
    views: [
      // A bowed flank, because a real one is not flat.
      view("driver", "left", ["driver"], { bow: 14 }),
      view("passenger", "right", ["passenger"], { bow: 14 }),
      view("hood", "none", ["hood"]),
      view("roof", "none", ["roof"]),
      view("front", "none", ["front"]),
      view("rear", "none", ["rear"]),
    ],
  };
}

async function proofFor(built, over = {}) {
  const { assets, hashes } = over.plateAssets || await plateAssets();
  return renderMasterDerived3dProof({
    render: built.render,
    plates: over.plates || plateSet(hashes),
    loadAsset: over.loadAsset || (async (assetId) => assets.get(assetId)),
    proofFonts: over.proofFonts === undefined ? { regular: FONT } : over.proofFonts,
    ...(over.maxViewBytes ? { maxViewBytes: over.maxViewBytes } : {}),
  });
}

const viewOf = (proof, key) => proof.views.find((view) => view.viewKey === key);

// --------------------------------------------------------------------- gates

test("GATE: every view is built from the six surfaces, and nothing generates", async () => {
  const built = await build();
  const proof = await proofFor(built);

  assert.equal(proof.contract, PROOF_3D_CONTRACT);
  assert.equal(proof.generated, false);
  assert.equal(proof.views.length, 6);
  // Provenance runs the whole way back: view -> surfaces -> render -> master.
  assert.equal(proof.renderHash, built.render.renderHash);
  assert.equal(proof.masterHash, built.render.masterHash);
  for (const entry of proof.surfaceHashes) {
    const surface = built.render.surfaces.find((item) => item.surfaceKey === entry.surfaceKey);
    assert.equal(entry.contentHash, surface.contentHash);
  }
  for (const view of proof.views) {
    for (const panel of view.panels) {
      const surface = built.render.surfaces.find((item) => item.surfaceKey === panel.surfaceKey);
      assert.equal(panel.contentHash, surface.contentHash, `${view.viewKey} drew artwork that is not the ${panel.surfaceKey} surface`);
    }
  }

  // No provider, no model, no prompt anywhere on the 3D path.
  for (const module of ["master-derived-3d-proof", "vehicle-view-plate", "mesh-warp"]) {
    const source = readFileSync(new URL(`../../runtime/${module}.cjs`, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const forbidden of ["generativelanguage", "gemini", "generateContent", "apiKey", "prompt", "generation-provider", "generation-engine"]) {
      assert.equal(source.toLowerCase().includes(forbidden.toLowerCase()), false, `${module} must not reference ${forbidden}`);
    }
  }
});

test("GATE: rebuilding the same proof from the same render is byte-identical", async () => {
  const first = await proofFor(await build());
  const second = await proofFor(await build());
  assert.equal(first.proofHash, second.proofHash);
  for (const view of first.views) {
    const other = viewOf(second, view.viewKey);
    assert.equal(view.contentHash, other.contentHash, `${view.viewKey} is not reproducible`);
    assert.equal(view.byteSize, other.byteSize);
  }
});

test("GATE: changing the artwork changes the 3D proof, and so does changing the plate", async () => {
  const base = await proofFor(await build());

  // A different string is a different design, and the view that carries it must
  // say so. This is the check the retired path could not make: its renders were
  // the source, so nothing existed to compare them against.
  const respelled = await proofFor(await build((master) => {
    master.textObjects[0].string = "PrecisionClimateAZ.com/hvac";
    return master;
  }));
  assert.notEqual(respelled.proofHash, base.proofHash);
  assert.notEqual(viewOf(respelled, "passenger").contentHash, viewOf(base, "passenger").contentHash);

  // Moving the artwork changes the picture too.
  const moved = await proofFor(await build((master) => {
    master.layers[0].transform.x = 3;
    return master;
  }));
  assert.notEqual(moved.proofHash, base.proofHash);

  // And so does re-cutting the plate: the same design on different geometry is
  // a different picture, and its identity has to record that.
  const built = await build();
  const { assets, hashes } = await plateAssets();
  const recut = clone(plateSet(hashes));
  recut.views[0].panels[0].mesh = mesh({ bow: 30 });
  const warped = await proofFor(built, { plateAssets: { assets, hashes }, plates: recut });
  const flat = await proofFor(built, { plateAssets: { assets, hashes } });
  assert.notEqual(warped.proofHash, flat.proofHash);
  assert.notEqual(viewOf(warped, "driver").contentHash, viewOf(flat, "driver").contentHash);
  assert.equal(viewOf(warped, "rear").contentHash, viewOf(flat, "rear").contentHash, "an untouched view must not move");
});

test("GATE: the artwork on the passenger view is the passenger surface, read forward", async () => {
  const built = await build();
  const proof = await proofFor(built);
  const driver = viewOf(proof, "driver");
  const passenger = viewOf(proof, "passenger");

  // The two flanks are genuinely different pictures. The failure that started
  // this work was a passenger composition derived by mirroring the driver
  // composition, while its text was separately re-rendered and mutated.
  assert.notEqual(driver.contentHash, passenger.contentHash);
  assert.equal(driver.panels[0].surfaceKey, "driver");
  assert.equal(passenger.panels[0].surfaceKey, "passenger");
  assert.equal(driver.handedness, "left");
  assert.equal(passenger.handedness, "right");

  // A horizontal flip of the driver view is not the passenger view. If it were,
  // the passenger side would be the driver side reversed — with reversed type.
  const flipped = await sharp(driver.bytes).flop().raw().toBuffer();
  const actual = await sharp(passenger.bytes).raw().toBuffer();
  let differing = 0;
  for (let index = 0; index < actual.length; index += 3) {
    if (Math.abs(flipped[index] - actual[index]) > 6) differing += 1;
  }
  assert.ok(differing > actual.length / 3 * 0.02,
    `the passenger view is a mirror of the driver view (${differing} differing pixels)`);

  // The canonical string is carried once, unmutated, and reported flat so a
  // customer is never asked to read foreshortened type to check spelling.
  assert.deepEqual(proof.textIdentities, [{ textId: "domain", string: "PrecisionClimateAZ.com" }]);
  assert.equal(proof.logoIdentities.length, 1);
  assert.equal(proof.logoIdentities[0].identityKey, "precision-mark");
});

test("GATE: the proof declares that it is not a manufacturing source", async () => {
  const proof = await proofFor(await build());
  // A picture of the panels is not the panels. Saying so in the artefact is
  // what stops a later stage from measuring it, which is how Call 8 began.
  assert.equal(proof.manufacturingAuthority, false);
  assert.equal(proof.dimensionsAuthority, null);
  const serialised = JSON.stringify(proof);
  for (const field of ["totalSqFt", "printWidthIn", "printHeightIn", "trimWidthIn", "bleedIn"]) {
    assert.equal(serialised.includes(field), false, `the 3D proof must not restate ${field} as if it were authoritative`);
  }
});

// ------------------------------------------------------------- fail closed

test("plate images are re-hashed, and a substituted plate fails closed", async () => {
  const built = await build();
  const { assets, hashes } = await plateAssets();
  const swapped = new Map(assets);
  swapped.set("base", await asPng(sharp({ create: { ...frameCreate(), background: "#7a1f1f" } })));
  await assert.rejects(
    proofFor(built, { plateAssets: { assets: swapped, hashes } }),
    (error) => error.code === "proof3d_plate_asset_mismatch");

  const missing = new Map(assets);
  missing.delete("mask");
  await assert.rejects(
    proofFor(built, { plateAssets: { assets: missing, hashes } }),
    (error) => error.code === "proof3d_plate_asset_missing");
});

test("a mask asking for artwork the mesh never delivers fails closed", async () => {
  const built = await build();
  const { assets, hashes } = await plateAssets();
  const short = clone(plateSet(hashes));
  // A mesh that reaches only half the masked window would leave bare paint
  // where the wrap goes, and the customer would approve a hole in the design.
  short.views[2].panels[0].mesh = {
    rows: 1, cols: 1,
    points: [
      { u: 0, v: 0, x: 105, y: 75 }, { u: 1, v: 0, x: 240, y: 75 },
      { u: 0, v: 1, x: 105, y: 215 }, { u: 1, v: 1, x: 240, y: 215 },
    ],
  };
  await assert.rejects(
    proofFor(built, { plateAssets: { assets, hashes }, plates: short }),
    (error) => error.code === "proof3d_mask_uncovered");
});

test("the render, the plates and the manifest must describe one vehicle", async () => {
  const built = await build();
  const { assets, hashes } = await plateAssets();

  const foreign = clone(plateSet(hashes));
  foreign.dimensionManifestId = uuid("9");
  await assert.rejects(
    proofFor(built, { plateAssets: { assets, hashes }, plates: foreign }),
    (error) => error.code === "proof3d_plate_manifest_mismatch");

  const rehashed = clone(plateSet(hashes));
  rehashed.manifestHash = sha256(Buffer.from("a different manifest"));
  await assert.rejects(
    proofFor(built, { plateAssets: { assets, hashes }, plates: rehashed }),
    (error) => error.code === "proof3d_plate_manifest_mismatch");
});

test("surface bytes are re-hashed on the 3D path too, and a font is required", async () => {
  const built = await build();
  const { assets, hashes } = await plateAssets();

  const tampered = {
    ...built.render,
    surfaces: built.render.surfaces.map((surface, index) => (index === 0
      ? { ...surface, bytes: Buffer.concat([surface.bytes, Buffer.from([0])]) }
      : surface)),
  };
  await assert.rejects(
    renderMasterDerived3dProof({
      render: tampered, plates: plateSet(hashes),
      loadAsset: async (assetId) => assets.get(assetId), proofFonts: { regular: FONT },
    }),
    (error) => error.code === "proof_surface_hash_mismatch");

  await assert.rejects(proofFor(built, { proofFonts: null }), (error) => error.code === "proof3d_font_required");

  // Captions are outline geometry, not a family name resolved by fontconfig.
  const source = readFileSync(new URL("../../runtime/master-derived-3d-proof.cjs", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.equal(/font-family/.test(source), false);
  assert.equal(/<text\b/.test(source), false);
});

test("an invalid plate set is refused before any pixel is drawn", async () => {
  const built = await build();
  const { assets, hashes } = await plateAssets();
  const reversed = clone(plateSet(hashes));
  reversed.views[1].handedness = "left";
  await assert.rejects(
    proofFor(built, { plateAssets: { assets, hashes }, plates: reversed }),
    (error) => error.code === "plate_view_handedness_conflict");

  const oversized = clone(plateSet(hashes));
  oversized.widthPx = FRAME.widthPx + 40;
  await assert.rejects(
    proofFor(built, { plateAssets: { assets, hashes }, plates: oversized }),
    (error) => error.code === "proof3d_plate_size_mismatch");
});

test("a view larger than its memory ceiling is refused rather than attempted", async () => {
  const built = await build();
  const { assets, hashes } = await plateAssets();
  await assert.rejects(
    proofFor(built, { plateAssets: { assets, hashes }, maxViewBytes: 1024 }),
    (error) => error.code === "proof3d_view_over_budget");
});

// ------------------------------------------------------------------ quality

test("bleed is excluded, and the vehicle's light reaches the artwork", async () => {
  const built = await build();
  const { assets, hashes } = await plateAssets();
  // The plate set validates on its own, so the projector is being handed
  // something the contract already accepts.
  validateViewPlates(plateSet(hashes));
  const proof = await proofFor(built, { plateAssets: { assets, hashes } });
  const hood = viewOf(proof, "hood");

  // The panel sampled the trim rectangle, not the printed sheet: the source is
  // no wider than trim, and trim is narrower than print by two bleeds.
  const surface = built.render.surfaces.find((item) => item.surfaceKey === "hood");
  const trimWidthPx = surface.pixelWidth - BLEED * PPI * 2;
  assert.ok(hood.panels[0].sourceWidthPx <= trimWidthPx,
    `sampled ${hood.panels[0].sourceWidthPx}px from a ${trimWidthPx}px trim`);
  assert.ok(surface.pixelWidth > trimWidthPx, "the surface carries bleed the proof must not show");

  // Shading is a left-to-right ramp, so the same artwork colour must land
  // darker on the left of the panel than on the right. Without this the wrap
  // reads as a flat decal pasted onto a photograph.
  const raw = await sharp(hood.bytes).raw().toBuffer();
  const at = (x, y) => raw[(y * FRAME.widthPx + x) * 3];
  assert.ok(at(130, 140) < at(350, 140),
    `the panel is not lit by the vehicle (${at(130, 140)} vs ${at(350, 140)})`);

  // Outside the mask the plate is untouched: vinyl goes where the mask says and
  // nowhere else — never over glass, trim or tyres.
  // Sampled clear of both the mask window and the caption strip, which is drawn
  // deliberately and is not the plate.
  const bare = await sharp(assets.get("base")).removeAlpha().raw().toBuffer();
  for (const [x, y] of [[20, 20], [460, 40], [30, 150]]) {
    const index = (y * FRAME.widthPx + x) * 3;
    assert.equal(raw[index], bare[index], `the plate was altered at ${x},${y}, outside the wrap area`);
    assert.equal(raw[index + 1], bare[index + 1]);
    assert.equal(raw[index + 2], bare[index + 2]);
  }
});
