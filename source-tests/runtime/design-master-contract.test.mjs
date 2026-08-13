// Phase 1 gate: the Design Master contract.
//
// The fixture is the real job the retired architecture failed on — the
// Precision Climate Solutions wrap on the 2022 F-250 Crew Cab, with the GENIE
// trim dimensions that run 40b51db4 actually resolved. Testing against the
// design that broke the old path is the point: every defect observed in that
// run should be unrepresentable here, not merely detectable.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DESIGN_MASTER_CONTRACT, UNWRAP_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE,
  canonical, designMasterHash, validateDesignMaster, placedResolution,
} = require("../../runtime/design-master.cjs");

const hash = (seed) => seed.repeat(64).slice(0, 64);
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;

// GENIE trim, in inches, exactly as resolved for this vehicle.
const TRIM = {
  driver: [153, 56], passenger: [153, 56], hood: [71.5, 56],
  roof: [74.3, 54.8], front: [129, 34], rear: [76, 54],
};

// A minimal but honest seam graph, in surface-local edge names: both flanks
// meet the hood along their forward edge, and the hood returns both claims.
// This is the adjacency the retired atlas had no way to express at all.
const SEAMS = {
  driver:    [{ edge: "left", joins: "hood", joinEdge: "left", continuity: "exact" }],
  passenger: [{ edge: "left", joins: "hood", joinEdge: "right", continuity: "exact" }],
  hood:      [{ edge: "left", joins: "driver", joinEdge: "left", continuity: "exact" },
              { edge: "right", joins: "passenger", joinEdge: "left", continuity: "exact" }],
  roof: [], front: [], rear: [],
};

function master(overrides = {}) {
  const base = {
    contract: DESIGN_MASTER_CONTRACT,
    masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
    dimensionManifestId: uuid("d"), manifestHash: hash("e"),
    designId: "DID-8C23C640",
    unwrap: {
      contract: UNWRAP_CONTRACT, unwrapId: uuid("f"), unitsPerInch: 1,
      surfaces: SURFACE_KEYS.map((surfaceKey, index) => ({
        surfaceKey,
        originUV: [index * 200, 0],
        widthIn: TRIM[surfaceKey][0], heightIn: TRIM[surfaceKey][1],
        // The passenger flank is the driver flank mirrored. This is a design
        // property, expressed once, not a second generative pass.
        mirror: surfaceKey === "passenger",
        seams: SEAMS[surfaceKey],
      })),
    },
    assets: [
      { assetId: "swoosh-field", kind: "raster", contentHash: hash("1"), storagePath: "users/x/assets/swoosh.png",
        intrinsic: { widthPx: 24450, heightPx: 9900 }, minPxPerInch: 150 },
      { assetId: "tech-photo", kind: "raster", contentHash: hash("2"), storagePath: "users/x/assets/tech.png",
        intrinsic: { widthPx: 6000, heightPx: 6000 }, minPxPerInch: 150 },
      { assetId: "logo-mark", kind: "vector", contentHash: hash("3"), storagePath: "users/x/assets/logo.svg" },
    ],
    palette: [
      { token: "brand-blue", srgb: "#0b3d91", cmyk: [96, 74, 0, 20] },
      { token: "paper-white", srgb: "#f4f6f8" },
    ],
    fonts: [{ fontId: "brand-sans", family: "Precision Sans", version: "2.1.0", contentHash: hash("4"), license: "commercial-embed" }],
    layers: [
      // One graphic running across the whole vehicle in shared coordinates.
      { layerId: "swoosh", type: "raster", space: GLOBAL_SPACE, assetId: "swoosh-field",
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 10, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "tech", type: "raster", space: "driver", assetId: "tech-photo",
        transform: { x: 96, y: 8, scale: 0.5, rotate: 0 }, zOrder: 20, opacity: 1, blend: "normal",
        mask: { type: "path", ref: "tech-cutin" }, clipTo: ["driver", "passenger"] },
      { layerId: "base", type: "solid", space: GLOBAL_SPACE, colorTokens: ["brand-blue"],
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 0, opacity: 1, blend: "normal", mask: { type: "none" } },
    ],
    textObjects: [
      { textId: "domain", string: "PrecisionClimateAZ.com", fontId: "brand-sans", sizeIn: 4.5, colorToken: "paper-white",
        space: GLOBAL_SPACE, transform: { x: 24, y: 40, scale: 1, rotate: 0 },
        neverMirror: true, spellingAuthority: "revision-snapshot" },
      { textId: "phone", string: "(602) 555-1842", fontId: "brand-sans", sizeIn: 6, colorToken: "paper-white",
        space: GLOBAL_SPACE, transform: { x: 24, y: 32, scale: 1, rotate: 0 },
        neverMirror: true, spellingAuthority: "revision-snapshot" },
    ],
    logoObjects: [
      { identityKey: "precision-mark", assetId: "logo-mark", contentHash: hash("3"), surfaceKey: "driver",
        transform: { x: 12, y: 18, scale: 1, rotate: 0 }, neverRasterizeIntoBase: true },
    ],
  };
  return { ...base, ...overrides };
}

test("a well-formed master validates and carries a computed identity", () => {
  const validated = validateDesignMaster(master());
  assert.match(validated.masterHash, /^[0-9a-f]{64}$/);
  assert.equal(validated.masterHash, designMasterHash(master()));
  assert.throws(() => { validated.designId = "mutated"; }, TypeError, "a validated master must be frozen");
});

test("identity is stable under key order and changes with any authoritative value", () => {
  const original = master();
  // Rebuild every object with its keys reversed, values untouched.
  const reverseKeys = (value) => {
    if (Array.isArray(value)) return value.map(reverseKeys);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.keys(value).reverse().map((key) => [key, reverseKeys(value[key])]));
    }
    return value;
  };
  assert.equal(designMasterHash(reverseKeys(original)), designMasterHash(original), "canonical form must ignore key order");
  assert.deepEqual(canonical({ b: 1, a: 2 }), { a: 2, b: 1 });

  // The exact defect that shipped: one character in the customer's domain.
  const mutated = master();
  mutated.textObjects[0].string = "PrecisionsClimateAz.com";
  assert.notEqual(designMasterHash(mutated), designMasterHash(original));
});

test("a stated masterHash that disagrees with the canonical form is refused", () => {
  assert.throws(() => validateDesignMaster(master({ masterHash: hash("9") })), (error) => error.code === "master_hash_mismatch");
});

// The invariant reversal. The retired architecture hard-failed when two
// surfaces shared artwork (assertSurfacesAreDistinct, and the Call 9 distinct
// source-region clause that killed run 7). On a real wrap the flanks are
// routinely mirrors and are often identical. Surface IDENTITY is unique;
// surface APPEARANCE carries no contract at all.
test("two surfaces may carry byte-identical artwork; only their identity must differ", () => {
  const shared = master();
  shared.layers.push(
    { layerId: "flank-a", type: "raster", space: "driver", assetId: "swoosh-field",
      transform: { x: 4, y: 4, scale: 1, rotate: 0 }, zOrder: 30, opacity: 1, blend: "normal", mask: { type: "none" } },
    { layerId: "flank-b", type: "raster", space: "passenger", assetId: "swoosh-field",
      transform: { x: 4, y: 4, scale: 1, rotate: 0 }, zOrder: 30, opacity: 1, blend: "normal", mask: { type: "none" } },
  );
  assert.ok(validateDesignMaster(shared).masterHash, "identical artwork on two surfaces is legal");

  const duplicated = master();
  duplicated.unwrap.surfaces[1].surfaceKey = "driver";
  assert.throws(() => validateDesignMaster(duplicated), (error) => error.code === "unwrap_surface_duplicate");
});

test("the mirror relationship is expressed once and never applies to type", () => {
  const validated = validateDesignMaster(master());
  const passenger = validated.unwrap.surfaces.find((surface) => surface.surfaceKey === "passenger");
  const driver = validated.unwrap.surfaces.find((surface) => surface.surfaceKey === "driver");
  assert.equal(passenger.mirror, true);
  assert.equal(driver.mirror, false);

  const mirroredType = master();
  mirroredType.textObjects[0].neverMirror = false;
  assert.throws(() => validateDesignMaster(mirroredType), (error) => error.code === "text_never_mirror_required");
});

test("seams must be claimed by both surfaces", () => {
  const oneSided = master();
  oneSided.unwrap.surfaces.find((s) => s.surfaceKey === "hood").seams = [];
  assert.throws(() => validateDesignMaster(oneSided), (error) => error.code === "unwrap_seam_not_reciprocal");

  const selfSeam = master();
  selfSeam.unwrap.surfaces[0].seams = [{ edge: "top", joins: "driver", joinEdge: "bottom", continuity: "exact" }];
  assert.throws(() => validateDesignMaster(selfSeam), (error) => error.code === "unwrap_seam_self");
});

test("logos are stored identities that overlay, never artwork drawn into the base", () => {
  const drawn = master();
  drawn.logoObjects[0].neverRasterizeIntoBase = false;
  assert.throws(() => validateDesignMaster(drawn), (error) => error.code === "logo_never_rasterize_required");

  const drifted = master();
  drifted.logoObjects[0].contentHash = hash("7");
  assert.throws(() => validateDesignMaster(drifted), (error) => error.code === "logo_asset_hash_mismatch");
});

test("every reference must resolve to something the master itself declares", () => {
  const cases = [
    [(m) => { m.layers[0].assetId = "ghost"; }, "layer_asset_unknown"],
    [(m) => { m.layers[2].colorTokens = ["ghost"]; }, "layer_color_unknown"],
    [(m) => { m.textObjects[0].fontId = "ghost"; }, "text_font_unknown"],
    [(m) => { m.textObjects[0].colorToken = "ghost"; }, "text_color_unknown"],
    [(m) => { m.layers[1].clipTo = ["tailgate"]; }, "layer_clip_invalid"],
    [(m) => { m.layers[1].space = "tailgate"; }, "layer_space_invalid"],
    [(m) => { m.logoObjects[0].assetId = "ghost"; }, "logo_asset_unknown"],
  ];
  for (const [mutate, code] of cases) {
    const candidate = master();
    mutate(candidate);
    assert.throws(() => validateDesignMaster(candidate), (error) => error.code === code, `expected ${code}`);
  }
});

test("global layers span surfaces so one graphic can cross driver, hood and front", () => {
  const validated = validateDesignMaster(master());
  const spanning = validated.layers.filter((layer) => layer.space === GLOBAL_SPACE);
  assert.ok(spanning.length >= 1, "the contract must admit artwork placed in shared coordinates");
  assert.ok(spanning.some((layer) => layer.type === "raster"), "spanning artwork must be able to be arbitrary raster, not only flat colour");
});

// A structurally perfect master can still be unprintable. This is the check
// that stops a 2048px texture being stretched across 153 inches — the failure
// that made the retired path produce 27 px/in masters.
test("placed resolution is measured against the placed size, not the intrinsic size", () => {
  const validated = validateDesignMaster(master());
  const swoosh = validated.assets.find((asset) => asset.assetId === "swoosh-field");
  const wide = placedResolution(swoosh, 163);
  assert.equal(wide.ok, true);
  assert.ok(wide.pxPerInch >= 150, `expected >=150 px/in, got ${wide.pxPerInch.toFixed(1)}`);

  const stretched = placedResolution(swoosh, 400);
  assert.equal(stretched.ok, false, "the same asset across 400in must fail its own resolution contract");

  const vector = placedResolution(validated.assets.find((asset) => asset.assetId === "logo-mark"), 400);
  assert.deepEqual(vector, { vector: true, ok: true }, "vector assets are resolution-independent");
});

test("the six GENIE surfaces are required, and unknown surfaces are refused", () => {
  const short = master();
  short.unwrap.surfaces = short.unwrap.surfaces.slice(0, 5);
  assert.throws(() => validateDesignMaster(short), (error) => error.code === "master_array_invalid" || error.code === "unwrap_surface_set_incomplete");

  const alien = master();
  alien.unwrap.surfaces[0].surfaceKey = "tailgate";
  assert.throws(() => validateDesignMaster(alien), (error) => error.code === "master_enum_invalid");
});

test("fonts carry an exact file, not a family name", () => {
  const unpinned = master();
  delete unpinned.fonts[0].contentHash;
  assert.throws(() => validateDesignMaster(unpinned), (error) => error.code === "master_hash_invalid");

  const unlicensed = master();
  unlicensed.fonts[0].license = "";
  assert.throws(() => validateDesignMaster(unlicensed), (error) => error.code === "font_field_missing");
});

test("the colour contract admits CMYK without requiring it", () => {
  assert.ok(validateDesignMaster(master()).masterHash, "sRGB-only tokens are legal while the pipeline decision is open");
  const bad = master();
  bad.palette[0].cmyk = [96, 74, 0];
  assert.throws(() => validateDesignMaster(bad), (error) => error.code === "palette_cmyk_invalid");
});
