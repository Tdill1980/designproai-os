/**
 * THE DETERMINISTIC A.T.L.A.S. ASSEMBLY PATH, END TO END, OFFLINE.
 *
 * Tests 12 and 13 established that natural language is not a control surface
 * for canonical geometry: asked in words for GENIE proportions, the model
 * returned a 25/50/25 grid with four equal centre quarters, twice, and every
 * production panel was rejected both times. The conclusion drawn from them is
 * that the flattened A.T.L.A.S. topology has to be CONSTRUCTED rather than
 * requested.
 *
 * Everything needed to construct it already shipped, in two halves that had
 * never been joined:
 *
 *   the Design Master cluster  authors a validated design and renders six
 *                              correctly proportioned GENIE surfaces
 *   flat-first-atlas           computes the canonical zone geometry and cuts
 *                              six panels out of a flattened 4096x4096 master
 *
 * What was missing between them was the composition step -- placing the six
 * renders into the manifest's zones -- which is why the flattened master still
 * had to come from Gemini. `atlas-surface-compose` is that step, and this test
 * runs the whole chain across the seam with a stubbed provider so the
 * deterministic half is proven without a network call.
 *
 * WHAT THIS DOES NOT PROVE. The provider here is a stub. That the live model
 * returns a specification of this shape is pinned by creative-authoring's own
 * tests; that it returns creative material worth printing is not a property any
 * offline test can assert.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const R = "../../runtime/";
const { authorCreativeInput } = require(`${R}creative-authoring.cjs`);
const { authorRunMaster } = require(`${R}designpro-master-cycle.cjs`);
const { renderProductionSurfaces } = require(`${R}design-master-renderer.cjs`);
const { buildAtlasManifest, cutCallOnePanels } = require(`${R}flat-first-atlas.cjs`);
const compose = require(`${R}atlas-surface-compose.cjs`);
const sharp = require("../../runtime/node_modules/sharp");

const sha256 = (b) => createHash("sha256").update(b).digest("hex");
const SURFACE_KEYS = ["driver", "passenger", "hood", "roof", "front", "rear"];

/** The recorded Precision Climate Solutions F-250 geometry. */
const TRIM = {
  driver: [153, 56], passenger: [153, 56], hood: [71.5, 56],
  roof: [74.3, 54.8], front: [129, 34], rear: [76, 54],
};
const BLEED_IN = 5;
const PPI = 18;

const uuid = (seed) => {
  const t = sha256(Buffer.from(seed)).slice(0, 32).split("");
  t[12] = "5"; t[16] = ["8", "9", "a", "b"][parseInt(t[16], 16) % 4];
  const v = t.join("");
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
};

const MANIFEST = {
  contractVersion: "designpro.genie-manifest.v1",
  expectedSurfaces: SURFACE_KEYS.map((surfaceKey) => ({
    surfaceKey, widthInches: TRIM[surfaceKey][0], heightInches: TRIM[surfaceKey][1],
  })),
};
const MANIFEST_HASH = sha256(Buffer.from(JSON.stringify(MANIFEST)));

const INPUT = {
  brief: "Cool layered field for PrecisionClimate.com, call 555-0142",
  businessName: "Precision Climate Solutions",
  industry: "HVAC",
  colors: ["deep blue", "ice white"],
  style: "modern",
  vehicle: { year: "2022", make: "Ford", model: "F-250 Crew Cab", type: "truck" },
};
const BODY_TEXT_STRINGS = [{ string: "PrecisionClimate.com" }, { string: "555-0142" }];

const SPEC = () => ({
  palette: [{ token: "deep-blue", srgb: "#123a6b" }, { token: "ice-white", srgb: "#eef6ff" }],
  assets: SURFACE_KEYS.map((key, index) => ({
    assetId: `${key}-field`, role: "background", surfaceKey: key,
    zOrder: index, opacity: 1, blend: "normal",
    prompt: "A deep blue field with layered diagonal energy",
  })),
});

/** A seeded, non-uniform image, so a full-bleed check cannot pass on flat colour. */
async function paintedBytes(width, height, seed) {
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const band = Math.sin((x * 0.05) + (y * 0.11) + seed) * 0.5 + 0.5;
      raw[i] = Math.round(16 + band * 30);
      raw[i + 1] = Math.round(58 + band * 40);
      raw[i + 2] = Math.round(107 + band * 60);
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

const FONT_PATH = "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf";

/** Runs the whole chain once and returns every artifact it produced. */
async function assemble() {
  const bytesByPath = new Map();
  let seed = 0;

  const provider = {
    contract: "designpro.generation-provider.v1",
    async generateSpecification() {
      return { specification: SPEC(), model: "stub-spec", keyFingerprint: "stub", attempts: [], contract: "designpro.generation-provider.v1" };
    },
    async generateImage() {
      seed += 1;
      return { bytes: await paintedBytes(1280, 640, seed), contentType: "image/png", model: "stub-image", keyFingerprint: "stub", attempts: [] };
    },
  };
  const store = {
    async putImmutableBytes({ storagePath, bytes }) {
      bytesByPath.set(storagePath, bytes);
      return { storagePath, contentHash: sha256(bytes), byteSize: bytes.length };
    },
  };

  const ownerId = uuid("owner");
  const revisionId = uuid("revision");

  // --- Call 1, creative half: direction and imagery only, no geometry.
  const creative = await authorCreativeInput({
    provider, store, manifest: MANIFEST, input: INPUT,
    bodyText: BODY_TEXT_STRINGS, ownerId, revisionId,
  });

  // The approved logo is a file, and its bytes are its identity.
  const logoBytes = await sharp({
    create: { width: 900, height: 300, channels: 4, background: { r: 11, g: 47, b: 107, alpha: 1 } },
  }).png().toBuffer();
  const logoPath = `users/${ownerId}/revisions/${revisionId}/logo.png`;
  bytesByPath.set(logoPath, logoBytes);
  const fontBytes = readFileSync(FONT_PATH);
  const fontPath = `users/${ownerId}/revisions/${revisionId}/brand.ttf`;
  bytesByPath.set(fontPath, fontBytes);

  const textSpec = (textId, string, surfaceKey, sizeIn, widthIn, yFrac) => ({
    textId, string, surfaceKey, sizeIn, fontId: "brand", colorToken: "ice-white",
    extent: { widthIn, heightIn: sizeIn * 1.35 },
    transform: { x: BLEED_IN + TRIM[surfaceKey][0] * 0.05, y: BLEED_IN + TRIM[surfaceKey][1] * yFrac, rotate: 0 },
  });
  const bodyText = [
    textSpec("company", "Precision Climate Solutions", "driver", 10, 145, 0.36),
    textSpec("company", "Precision Climate Solutions", "passenger", 10, 145, 0.36),
    textSpec("domain", "PrecisionClimate.com", "rear", 5, 72, 0.70),
  ];

  const expectedLogoInventory = ["driver", "passenger", "hood"].map((surfaceKey) => ({
    identityKey: "primary-mark", surfaceKey, kind: "raster",
    contentHash: sha256(logoBytes), storagePath: logoPath,
    intrinsic: { widthPx: 900, heightPx: 300 },
  }));

  const logoPlacements = {};
  for (const surfaceKey of ["driver", "passenger", "hood"]) {
    logoPlacements[`primary-mark:${surfaceKey}`] = {
      widthIn: Math.min(30, TRIM[surfaceKey][0] * 0.25),
      heightIn: Math.min(10, TRIM[surfaceKey][0] * 0.25 / 3),
      x: BLEED_IN + TRIM[surfaceKey][0] * 0.05,
      y: BLEED_IN + TRIM[surfaceKey][1] * 0.08,
    };
  }

  // --- The frozen revision snapshot, carrying the design master input.
  const snapshot = {
    contractVersion: "designpro.revision-snapshot.v1",
    designId: uuid("design"),
    bodyText,
    expectedLogoInventory,
    designMaster: {
      creativeBrief: creative.creativeBrief,
      creativeAssets: creative.creativeAssets,
      composition: creative.composition,
      typography: { fontId: "brand", colorToken: "ice-white" },
      logoPlacements,
      palette: creative.palette,
      fonts: [{
        fontId: "brand", family: "Liberation Sans", version: "2.1.5",
        license: "SIL Open Font License 1.1",
        storagePath: fontPath, contentHash: sha256(fontBytes),
      }],
    },
  };

  // --- The real production authoring entry point.
  const master = authorRunMaster({
    run: { revision_id: revisionId, manifest_hash: MANIFEST_HASH, dimension_manifest_id: uuid("dim") },
    manifest: MANIFEST, snapshot,
  });

  const rendered = await renderProductionSurfaces({
    master, pxPerInch: PPI, bleedInches: BLEED_IN,
    loadAsset: async (asset) => {
      const b = bytesByPath.get(asset.storagePath);
      if (!b) throw new Error(`no bytes for ${asset.storagePath}`);
      return b;
    },
    loadFont: async (font) => bytesByPath.get(font.storagePath),
  });

  // --- Geometry, composition, extraction: all deterministic.
  const manifest = buildAtlasManifest(MANIFEST.expectedSurfaces, null, "truck");
  const genieManifestHash = sha256(Buffer.from(`genie:${MANIFEST_HASH}`));
  manifest.geometryResolution = {
    contract: "designpro.genie-manifest.v1",
    genieManifestId: genieManifestHash.slice(0, 32),
    genieManifestHash, state: "validated",
  };

  const composed = await compose.composeAtlasFromSurfaces(
    new Map(rendered.surfaces.map((s) => [s.surfaceKey, s.bytes])), manifest,
  );
  const panels = await cutCallOnePanels(composed.bytes, manifest, composed.masterContentHash);

  return { creative, master, rendered, manifest, composed, panels };
}

let ONCE;
const once = async () => (ONCE ||= assemble());

test("the creative half returns direction and imagery, never production geometry", async () => {
  const { creative } = await once();
  assert.equal(creative.provenance.readsRenderedViews, false);
  assert.equal(creative.provenance.surfaceSource, "genie.dimension-manifest");
  assert.ok(creative.creativeAssets.length >= 1);
  // The customer's own strings were never shown to the model.
  const brief = JSON.stringify(creative.creativeBrief).toLowerCase();
  for (const leak of ["precisionclimate.com", "555-0142", "precision climate solutions"]) {
    assert.ok(!brief.includes(leak), `the creative brief leaked ${leak}`);
  }
  // No creative asset may claim to carry canonical identity.
  for (const asset of creative.creativeAssets) {
    assert.equal(asset.textId, undefined);
    assert.equal(asset.logoIdentityKey, undefined);
  }
});

test("six surfaces render at exact GENIE trim plus the contracted bleed", async () => {
  const { rendered } = await once();
  assert.equal(rendered.surfaces.length, 6);
  assert.equal(rendered.bleedIn, BLEED_IN);
  for (const surface of rendered.surfaces) {
    const [wIn, hIn] = TRIM[surface.surfaceKey];
    assert.equal(surface.pixelWidth, Math.round((wIn + BLEED_IN * 2) * PPI), `${surface.surfaceKey} width`);
    assert.equal(surface.pixelHeight, Math.round((hIn + BLEED_IN * 2) * PPI), `${surface.surfaceKey} height`);
  }
});

test("the flattened A.T.L.A.S. master is composed by code from those six renders", async () => {
  const { composed, rendered } = await once();
  assert.equal(composed.contract, compose.COMPOSE_CONTRACT);
  assert.equal(composed.canvas.widthPx, 4096);
  assert.equal(composed.canvas.heightPx, 4096);
  assert.equal(composed.placements.length, 6);

  // Every placement's source is one of the six surface renders, by digest.
  const renderHashes = new Set(rendered.surfaces.map((s) => sha256(s.bytes)));
  for (const placement of composed.placements) {
    assert.ok(renderHashes.has(placement.sourceHash), `${placement.surfaceKey} was not placed from its own render`);
    // Geometry agreement, not a stretch to fit.
    assert.ok(placement.aspectDrift <= compose.MAX_ASPECT_DRIFT, `${placement.surfaceKey} drifted ${placement.aspectDrift}`);
  }
});

test("the six canonical panels carry exact GENIE geometry and bind to the master", async () => {
  const { panels, composed } = await once();
  assert.equal(panels.length, 6);
  for (const panel of panels) {
    const [wIn, hIn] = TRIM[panel.surfaceKey];
    assert.equal(panel.trimWidthIn, wIn, `${panel.surfaceKey} trim width`);
    assert.equal(panel.trimHeightIn, hIn, `${panel.surfaceKey} trim height`);
    assert.equal(panel.bleedInches, BLEED_IN, `${panel.surfaceKey} bleed`);
    // Lineage: the panel names the canonical master it was cut from.
    assert.equal(panel.sourceMasterHash, composed.masterContentHash, `${panel.surfaceKey} lineage`);
    assert.equal(panel.deterministic, true, `${panel.surfaceKey} determinism flag`);
  }
  assert.deepEqual(new Set(panels.map((p) => p.surfaceKey)), new Set(SURFACE_KEYS));
});

test("every printable pixel is authored artwork -- no gutter, no transparency", async () => {
  const { panels } = await once();
  for (const panel of panels) {
    const { data, info } = await sharp(panel.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let transparent = 0, ground = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 255) transparent += 1;
      else if (data[i] === 12 && data[i + 1] === 12 && data[i + 2] === 14) ground += 1;
    }
    assert.equal(transparent, 0, `${panel.surfaceKey} has ${transparent} transparent pixels`);
    assert.equal(ground, 0, `${panel.surfaceKey} shows ${ground} pixels of composer ground -- a gutter reached a panel`);
    assert.equal(info.width * info.height > 0, true);
  }
});

test("driver and passenger are distinct surfaces, and both flanks come out upright", async () => {
  const { panels } = await once();
  const driver = panels.find((p) => p.surfaceKey === "driver");
  const passenger = panels.find((p) => p.surfaceKey === "passenger");
  assert.notEqual(driver.contentHash, passenger.contentHash,
    "passenger is a byte-mirror of driver; it must be its own surface of one cohesive design");
  // A flank's print rectangle is landscape; upright means it stayed that way.
  assert.ok(driver.pixelWidth > driver.pixelHeight, "driver panel is not upright");
  assert.ok(passenger.pixelWidth > passenger.pixelHeight, "passenger panel is not upright");
});

test("the composer refuses a surface whose geometry disagrees with its zone", async () => {
  const { manifest, rendered } = await once();
  const wrong = new Map(rendered.surfaces.map((s) => [s.surfaceKey, s.bytes]));
  // A square stands in for a surface rendered from different geometry.
  wrong.set("hood", await sharp({ create: { width: 800, height: 800, channels: 3, background: "#123a6b" } }).png().toBuffer());
  await assert.rejects(
    () => compose.composeAtlasFromSurfaces(wrong, manifest),
    (error) => error.code === "atlas_compose_aspect_mismatch",
    "a geometry disagreement must be refused, never scaled away",
  );
});

test("the composer never upsamples a production surface", async () => {
  const { manifest, rendered } = await once();
  const small = new Map(rendered.surfaces.map((s) => [s.surfaceKey, s.bytes]));
  const roof = rendered.surfaces.find((s) => s.surfaceKey === "roof");
  small.set("roof", await sharp(roof.bytes).resize(Math.round(roof.pixelWidth / 6), Math.round(roof.pixelHeight / 6)).png().toBuffer());
  await assert.rejects(
    () => compose.composeAtlasFromSurfaces(small, manifest),
    (error) => error.code === "atlas_compose_surface_underscale",
  );
});

test("composition is a pure function of its inputs", async () => {
  const { manifest, rendered, composed } = await once();
  const again = await compose.composeAtlasFromSurfaces(
    new Map(rendered.surfaces.map((s) => [s.surfaceKey, s.bytes])), manifest,
  );
  assert.equal(again.masterContentHash, composed.masterContentHash);
  assert.equal(again.compositionHash, composed.compositionHash);
});
