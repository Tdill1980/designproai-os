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
  DESIGN_MASTER_CONTRACT, DESIGN_SPACE_CONTRACT, SURFACE_KEYS, GLOBAL_SPACE,
  canonical, designMasterHash, validateDesignMaster, placedResolution, seamPoint,
} = require("../../runtime/design-master.cjs");

const hash = (seed) => seed.repeat(64).slice(0, 64);
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

// GENIE trim, in inches, exactly as resolved for this vehicle.
const TRIM = {
  driver: [153, 56], passenger: [153, 56], hood: [71.5, 56],
  roof: [74.3, 54.8], front: [129, 34], rear: [76, 54],
};

// Both flanks meet the hood along their forward edge. The driver join runs in
// the same direction; the passenger join is reversed, which is exactly the
// correspondence that surface-local edge names alone cannot express.
const SEAMS = {
  driver: [{ edge: "left", span: [0, 1], joins: "hood", joinEdge: "left", joinSpan: [0, 1], orientation: "same", continuity: "exact" }],
  passenger: [{ edge: "left", span: [0, 1], joins: "hood", joinEdge: "right", joinSpan: [1, 0], orientation: "reversed", continuity: "exact" }],
  hood: [
    { edge: "left", span: [0, 1], joins: "driver", joinEdge: "left", joinSpan: [0, 1], orientation: "same", continuity: "exact" },
    { edge: "right", span: [0, 1], joins: "passenger", joinEdge: "left", joinSpan: [1, 0], orientation: "reversed", continuity: "exact" },
  ],
  roof: [], front: [], rear: [],
};

// Deep-cloned on every call. SEAMS and TRIM are shared module constants, so a
// test that mutates one seam would otherwise poison every test after it.
function master() {
  return clone({
    contract: DESIGN_MASTER_CONTRACT,
    masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
    dimensionManifestId: uuid("d"), manifestHash: hash("e"),
    designId: "DID-8C23C640",
    designSpace: {
      contract: DESIGN_SPACE_CONTRACT, designSpaceId: uuid("f"), unitsPerInch: 1,
      surfaces: SURFACE_KEYS.map((surfaceKey, index) => ({
        surfaceKey,
        originIn: [index * 200, 0],
        widthIn: TRIM[surfaceKey][0], heightIn: TRIM[surfaceKey][1],
        // The passenger flank is the driver flank mirrored. A declared
        // relationship, not a second generative pass.
        mirror: surfaceKey === "passenger",
        mapping: { kind: "planar-developable", mappingId: uuid(String(index + 1)), mappingHash: hash(String(index + 1)) },
        seams: SEAMS[surfaceKey],
      })),
    },
    assets: [
      { assetId: "swoosh-field", kind: "raster", contentHash: hash("1"), storagePath: "users/x/assets/swoosh.png",
        intrinsic: { widthPx: 24450, heightPx: 9900 }, minPxPerInch: 150 },
      { assetId: "tech-photo", kind: "raster", contentHash: hash("2"), storagePath: "users/x/assets/tech.png",
        intrinsic: { widthPx: 6000, heightPx: 6000 }, minPxPerInch: 150 },
      { assetId: "logo-mark", kind: "vector", contentHash: hash("3"), storagePath: "users/x/assets/logo.svg" },
      { assetId: "tech-cutin", kind: "vector", contentHash: hash("8"), storagePath: "users/x/assets/cutin.svg" },
    ],
    palette: [
      { token: "brand-blue", srgb: "#0b3d91", cmyk: [96, 74, 0, 20] },
      { token: "paper-white", srgb: "#f4f6f8" },
    ],
    fonts: [{ fontId: "brand-sans", family: "Precision Sans", version: "2.1.0", contentHash: hash("4"), license: "commercial-embed" }],
    layers: [
      { layerId: "base", type: "solid", space: GLOBAL_SPACE, colorTokens: ["brand-blue"],
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 0, opacity: 1, blend: "normal", mask: { type: "none" } },
      // One graphic running across the whole vehicle in shared coordinates.
      { layerId: "swoosh", type: "raster", space: GLOBAL_SPACE, assetId: "swoosh-field",
        transform: { x: 0, y: 0, scale: 1, rotate: 0 }, zOrder: 10, opacity: 1, blend: "screen", mask: { type: "none" } },
      { layerId: "tech", type: "raster", space: "driver", assetId: "tech-photo",
        transform: { x: 96, y: 8, scale: 0.5, rotate: 0 }, zOrder: 20, opacity: 1, blend: "normal",
        mask: { type: "path", assetId: "tech-cutin" }, clipTo: ["driver", "passenger"],
        surfaceOverrides: { passenger: { transform: { x: 100 } } } },
      { layerId: "domain-type", type: "text", space: GLOBAL_SPACE, textId: "domain",
        transform: { x: 24, y: 40, scale: 1, rotate: 0 }, zOrder: 40, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "phone-type", type: "text", space: GLOBAL_SPACE, textId: "phone",
        transform: { x: 24, y: 32, scale: 1, rotate: 0 }, zOrder: 40, opacity: 1, blend: "normal", mask: { type: "none" } },
      { layerId: "mark", type: "logo", space: "driver", logoIdentityKey: "precision-mark",
        transform: { x: 12, y: 18, scale: 1, rotate: 0 }, zOrder: 50, opacity: 1, blend: "normal", mask: { type: "none" } },
    ],
    textObjects: [
      { textId: "domain", string: "PrecisionClimateAZ.com", fontId: "brand-sans", sizeIn: 4.5,
        colorToken: "paper-white", neverMirror: true, spellingAuthority: "revision-snapshot" },
      { textId: "phone", string: "(602) 555-1842", fontId: "brand-sans", sizeIn: 6,
        colorToken: "paper-white", neverMirror: true, spellingAuthority: "revision-snapshot" },
    ],
    logoObjects: [
      { identityKey: "precision-mark", assetId: "logo-mark", contentHash: hash("3"), surfaceKey: "driver",
        neverMirror: true, neverRasterizeIntoBase: true },
    ],
  });
}

const rejects = (mutate, code) => {
  const candidate = master();
  mutate(candidate);
  assert.throws(() => validateDesignMaster(candidate), (error) => error.code === code, `expected ${code}`);
};

test("a well-formed master validates and carries a computed identity", () => {
  const validated = validateDesignMaster(master());
  assert.match(validated.masterHash, /^[0-9a-f]{64}$/);
  assert.equal(validated.masterHash, designMasterHash(master()));
  assert.throws(() => { validated.designId = "mutated"; }, TypeError, "a validated master must be frozen");
});

test("identity is stable under key order and changes with any authoritative value", () => {
  const original = master();
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
  const stated = master();
  stated.masterHash = hash("9");
  assert.throws(() => validateDesignMaster(stated), (error) => error.code === "master_hash_mismatch");
});

// ------------------------------------------------------- 1. seam correspondence

test("a seam carries a correspondence, not merely a claim that two edges touch", () => {
  const validated = validateDesignMaster(master());
  const driver = validated.designSpace.surfaces.find((s) => s.surfaceKey === "driver").seams[0];
  const passenger = validated.designSpace.surfaces.find((s) => s.surfaceKey === "passenger").seams[0];

  // Same-direction join: 20% along driver's edge meets 20% along the hood's.
  assert.equal(seamPoint(driver, 0.2), 0.2);
  // Reversed join: 20% along passenger's edge meets 80% along the hood's. This
  // is the distinction that surface-local edge names alone cannot express.
  assert.equal(seamPoint(passenger, 0.2).toFixed(6), "0.800000");
});

test("seam orientation must agree with its own mapping and with its partner", () => {
  rejects((m) => { m.designSpace.surfaces[0].seams[0].orientation = "reversed"; }, "seam_orientation_mismatch");
  // A partner that flips direction unilaterally is caught by the round trip.
  rejects((m) => {
    m.designSpace.surfaces.find((s) => s.surfaceKey === "hood").seams[0].joinSpan = [1, 0];
  }, "seam_orientation_mismatch");
});

test("a partner span that does not invert the correspondence fails closed", () => {
  rejects((m) => {
    const hood = m.designSpace.surfaces.find((s) => s.surfaceKey === "hood");
    hood.seams[0].span = [0, 0.5];      // hood now claims half an edge...
    hood.seams[0].joinSpan = [0, 1];    // ...still mapping onto all of driver's
  }, "seam_mapping_not_invertible");
});

test("seams must be reciprocal, non-degenerate, and never self-joined", () => {
  rejects((m) => { m.designSpace.surfaces.find((s) => s.surfaceKey === "hood").seams = []; }, "seam_not_reciprocal");
  rejects((m) => { m.designSpace.surfaces[0].seams[0].joins = "driver"; }, "seam_self");
  rejects((m) => { m.designSpace.surfaces[0].seams[0].span = [0.4, 0.4]; }, "seam_span_invalid");
  rejects((m) => { m.designSpace.surfaces[0].seams[0].continuity = "tolerance"; }, "seam_continuity_disagrees");
});

// ------------------------------------------- 2. an atlas is not called a UV map

test("every surface declares how its rectangle reaches physical geometry", () => {
  const validated = validateDesignMaster(master());
  for (const surface of validated.designSpace.surfaces) {
    assert.equal(surface.mapping.kind, "planar-developable");
    assert.match(surface.mapping.mappingHash, /^[0-9a-f]{64}$/);
  }
  rejects((m) => { delete m.designSpace.surfaces[0].mapping; }, "master_object_invalid");
  rejects((m) => { m.designSpace.surfaces[0].mapping.kind = "spherical"; }, "master_enum_invalid");
  rejects((m) => { delete m.designSpace.surfaces[0].mapping.mappingHash; }, "master_hash_invalid");
});

// -------------------------------------------------- 3. text and logo binding

test("a text layer must name exactly one canonical string, and every string must be placed", () => {
  rejects((m) => { delete m.layers[3].textId; }, "master_token_invalid");
  rejects((m) => { m.layers[3].textId = "ghost"; }, "layer_text_unknown");
  rejects((m) => { m.layers[4].textId = "domain"; }, "layer_text_bound_twice");
  rejects((m) => { m.layers.splice(4, 1); }, "text_not_placed");
  rejects((m) => { m.layers[1].textId = "domain"; }, "layer_text_unexpected");
});

test("a logo layer must name exactly one canonical placement on its own surface", () => {
  rejects((m) => { delete m.layers[5].logoIdentityKey; }, "master_token_invalid");
  rejects((m) => { m.layers[5].logoIdentityKey = "ghost"; }, "layer_logo_unknown");
  rejects((m) => { m.layers[5].space = GLOBAL_SPACE; }, "layer_logo_space_invalid");
  // The placement key is surface-scoped, so moving the layer breaks the bind.
  rejects((m) => { m.layers[5].space = "rear"; }, "layer_logo_unknown");
  rejects((m) => { m.layers.splice(5, 1); }, "logo_not_placed");
  rejects((m) => { m.layers[1].logoIdentityKey = "precision-mark"; }, "layer_logo_unexpected");
});

// ------------------------------------------------- 4. surfaceOverrides closed

test("surfaceOverrides is a closed schema, not an escape hatch", () => {
  const validated = validateDesignMaster(master());
  assert.deepEqual(validated.layers[2].surfaceOverrides.passenger, { transform: { x: 100 } });

  rejects((m) => { m.layers[2].surfaceOverrides.passenger = { mirror: true }; }, "master_unknown_property");
  rejects((m) => { m.layers[2].surfaceOverrides.passenger = { blend: "multiply" }; }, "master_unknown_property");
  rejects((m) => { m.layers[2].surfaceOverrides.passenger = { zOrder: 99 }; }, "master_unknown_property");
  rejects((m) => { m.layers[2].surfaceOverrides.passenger = { assetId: "logo-mark" }; }, "master_unknown_property");
  rejects((m) => { m.layers[2].surfaceOverrides.passenger = {}; }, "layer_override_empty");
  rejects((m) => { m.layers[2].surfaceOverrides.passenger = { opacity: 4 }; }, "master_number_invalid");
  rejects((m) => { m.layers[2].surfaceOverrides.passenger = { visible: "yes" }; }, "layer_override_invalid");
  rejects((m) => { m.layers[2].surfaceOverrides.passenger = { transform: { warp: 3 } }; }, "master_unknown_property");
  rejects((m) => { m.layers[2].surfaceOverrides.tailgate = { visible: false }; }, "layer_override_surface_unknown");
});

// ------------------------------------------------ 5. both-axis placed resolution

test("placed resolution fails on the worst axis, not the width", () => {
  const validated = validateDesignMaster(master());
  const swoosh = validated.assets.find((asset) => asset.assetId === "swoosh-field");

  const exact = placedResolution(swoosh, { widthIn: 163, heightIn: 66 });
  assert.equal(exact.ok, true);
  assert.equal(Math.round(exact.ppiX), 150);
  assert.equal(Math.round(exact.ppiY), 150);

  // The failure width-only checking cannot see: adequate horizontally,
  // catastrophically under-resolved vertically.
  const anisotropic = { kind: "raster", intrinsic: { widthPx: 6000, heightPx: 1200 }, minPxPerInch: 150 };
  const squashed = placedResolution(anisotropic, { widthIn: 40, heightIn: 40 });
  assert.equal(Math.round(squashed.ppiX), 150, "width alone would have passed");
  assert.equal(Math.round(squashed.ppiY), 30);
  assert.equal(squashed.limitingAxis, "y");
  assert.equal(squashed.ok, false);
});

test("rotation and skew derate the effective resolution", () => {
  const validated = validateDesignMaster(master());
  const swoosh = validated.assets.find((asset) => asset.assetId === "swoosh-field");

  const square = placedResolution(swoosh, { widthIn: 163, heightIn: 66, rotate: 0 });
  const turned = placedResolution(swoosh, { widthIn: 163, heightIn: 66, rotate: 45 });
  assert.equal(square.derate, 1);
  assert.ok(Math.abs(turned.derate - Math.SQRT2) < 1e-9, "a 45 degree rotation derates by sqrt(2)");
  assert.ok(turned.effectivePpi < square.effectivePpi);
  assert.equal(turned.ok, false, "a placement that only just meets its contract must fail once rotated");

  const skewed = placedResolution(swoosh, { widthIn: 163, heightIn: 66, skew: 30 });
  assert.ok(skewed.derate > 1);

  const vector = placedResolution(validated.assets.find((asset) => asset.assetId === "logo-mark"), { widthIn: 400, heightIn: 400 });
  assert.deepEqual(vector, { vector: true, ok: true }, "vector assets are resolution-independent");
});

// ------------------------------------------------------------ 6. mirror authority

test("mirroring is never implicit for type or for logos", () => {
  const validated = validateDesignMaster(master());
  assert.equal(validated.designSpace.surfaces.find((s) => s.surfaceKey === "passenger").mirror, true);
  assert.equal(validated.designSpace.surfaces.find((s) => s.surfaceKey === "driver").mirror, false);

  rejects((m) => { m.textObjects[0].neverMirror = false; }, "text_never_mirror_required");
  // Not left to compositor ordering: a mirrored logo is a corrupted logo, and
  // that has to be contract, not implementation detail.
  rejects((m) => { m.logoObjects[0].neverMirror = false; }, "logo_never_mirror_required");
  rejects((m) => { delete m.logoObjects[0].neverMirror; }, "logo_never_mirror_required");
});

// -------------------------------------------------------------- 7. mask identity

test("a mask resolves to a declared hashed asset of the right kind", () => {
  rejects((m) => { m.layers[2].mask = { type: "path", assetId: "ghost" }; }, "layer_mask_asset_unknown");
  rejects((m) => { m.layers[2].mask = { type: "path" }; }, "master_token_invalid");
  // A path mask needs vector geometry; a raster mask needs raster coverage.
  rejects((m) => { m.layers[2].mask = { type: "path", assetId: "tech-photo" }; }, "layer_mask_kind_mismatch");
  rejects((m) => { m.layers[2].mask = { type: "raster", assetId: "tech-cutin" }; }, "layer_mask_kind_mismatch");
  rejects((m) => { m.layers[0].mask = { type: "none", assetId: "tech-cutin" }; }, "layer_mask_ref_unexpected");

  const rasterMask = master();
  rasterMask.layers[2].mask = { type: "raster", assetId: "tech-photo" };
  assert.ok(validateDesignMaster(rasterMask).masterHash);
});

// ------------------------------------------------------------ the reversal

// The retired architecture hard-failed when two surfaces shared artwork
// (assertSurfacesAreDistinct, and the Call 9 distinct source-region clause that
// killed run 7). On a real wrap the flanks are routinely mirrors and are often
// identical. Surface IDENTITY is unique; surface APPEARANCE carries no contract.
test("two surfaces may carry byte-identical artwork; only their identity must differ", () => {
  const shared = master();
  const twin = (layerId, space) => ({
    layerId, type: "raster", space, assetId: "swoosh-field",
    transform: { x: 4, y: 4, scale: 1, rotate: 0 }, zOrder: 30, opacity: 1, blend: "normal", mask: { type: "none" },
  });
  shared.layers.push(twin("flank-a", "driver"), twin("flank-b", "passenger"));
  assert.ok(validateDesignMaster(shared).masterHash, "identical artwork on two surfaces is legal");

  rejects((m) => { m.designSpace.surfaces[1].surfaceKey = "driver"; }, "design_space_surface_duplicate");
});

test("global layers span surfaces so one graphic can cross driver, hood and front", () => {
  const validated = validateDesignMaster(master());
  const spanning = validated.layers.filter((layer) => layer.space === GLOBAL_SPACE);
  assert.ok(spanning.some((layer) => layer.type === "raster"), "spanning artwork must be able to be arbitrary raster, not only flat colour");
});

// ------------------------------------------------------------------ closure

test("every reference must resolve to something the master itself declares", () => {
  rejects((m) => { m.layers[1].assetId = "ghost"; }, "layer_asset_unknown");
  rejects((m) => { m.layers[1].assetId = "logo-mark"; }, "layer_asset_kind_mismatch");
  rejects((m) => { m.layers[0].colorTokens = ["ghost"]; }, "layer_color_unknown");
  rejects((m) => { m.textObjects[0].fontId = "ghost"; }, "text_font_unknown");
  rejects((m) => { m.textObjects[0].colorToken = "ghost"; }, "text_color_unknown");
  rejects((m) => { m.layers[2].clipTo = ["tailgate"]; }, "layer_clip_invalid");
  rejects((m) => { m.layers[2].space = "tailgate"; }, "layer_space_invalid");
  rejects((m) => { m.logoObjects[0].assetId = "ghost"; }, "logo_asset_unknown");
  rejects((m) => { m.logoObjects[0].contentHash = hash("7"); }, "logo_asset_hash_mismatch");
  rejects((m) => { m.logoObjects[0].neverRasterizeIntoBase = false; }, "logo_never_rasterize_required");
});

test("the six GENIE surfaces are required, and unknown surfaces are refused", () => {
  rejects((m) => { m.designSpace.surfaces = m.designSpace.surfaces.slice(0, 5); }, "master_array_invalid");
  rejects((m) => { m.designSpace.surfaces[3].surfaceKey = "tailgate"; }, "master_enum_invalid");
});

test("fonts carry an exact file, not a family name", () => {
  rejects((m) => { delete m.fonts[0].contentHash; }, "master_hash_invalid");
  rejects((m) => { m.fonts[0].license = ""; }, "font_field_missing");
});

test("the colour contract admits CMYK without requiring it", () => {
  const srgbOnly = master();
  delete srgbOnly.palette[0].cmyk;
  assert.ok(validateDesignMaster(srgbOnly).masterHash, "sRGB-only tokens are legal while the pipeline decision is open");
  rejects((m) => { m.palette[0].cmyk = [96, 74, 0]; }, "palette_cmyk_invalid");
});

test("the fixture round-trips through JSON unchanged", () => {
  assert.equal(designMasterHash(clone(master())), designMasterHash(master()));
});
