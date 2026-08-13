// Phase 6 gate: the Design Master author divides authority mechanically.
//
// A model may generate imagery and recommend composition. Everything a customer
// could be harmed by getting wrong — their own spelling, which file their logo
// is, how big a panel is — is assembled from sources that were already
// authoritative. These tests are the difference between that being true and
// being a comment.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const { SURFACE_KEYS, GLOBAL_SPACE } = require("../../runtime/design-master.cjs");
const {
  authorDesignMaster, assertCreativeBriefIsClean, CREATIVE_BRIEF_CONTRACT, CREATIVE_ROLES, AUTHOR_CONTRACT,
} = require("../../runtime/design-master-author.cjs");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

const TRIM = { driver: [153, 56], passenger: [153, 56], hood: [71.5, 56], roof: [74.3, 54.8], front: [129, 34], rear: [76, 54] };
const URL_STRING = "PrecisionClimateAZ.com";

const MANIFEST = {
  totalSqFt: 234.05,
  expectedSurfaces: SURFACE_KEYS.map((key) => ({
    surfaceKey: key, widthInches: TRIM[key][0], heightInches: TRIM[key][1],
    surfaceSqFt: Math.round((TRIM[key][0] * TRIM[key][1] / 144) * 100) / 100,
  })),
};

const IDENTITY = {
  masterId: uuid("a"), revisionId: uuid("b"), vehicleId: uuid("c"),
  dimensionManifestId: uuid("d"), manifestHash: sha256("manifest"),
  designSpaceId: uuid("f"),
  surfaceMappings: Object.fromEntries(SURFACE_KEYS.map((key, index) => [key, {
    mappingId: uuid(String(index + 1)), mappingHash: sha256(key),
  }])),
};

const SNAPSHOT = {
  contractVersion: "designpro.revision-snapshot.v1",
  designId: "DID-PHASE6",
  bodyText: [
    { textId: "domain", string: URL_STRING, surfaceKey: "driver", sizeIn: 6, extent: { widthIn: 80, heightIn: 9 }, transform: { x: 20, y: 34 } },
    { textId: "domain", string: URL_STRING, surfaceKey: "passenger", sizeIn: 6, extent: { widthIn: 80, heightIn: 9 }, transform: { x: 20, y: 34 } },
  ],
  expectedLogoInventory: [
    { identityKey: "precision-mark", displayName: "Precision", surfaceKey: "driver", storagePath: "logos/mark.svg", contentHash: sha256("markfile") },
    { identityKey: "precision-mark", displayName: "Precision", surfaceKey: "passenger", storagePath: "logos/mark.svg", contentHash: sha256("markfile") },
  ],
};

const BRIEF = {
  contract: CREATIVE_BRIEF_CONTRACT,
  direction: "Cool teal-to-navy gradient with a sweeping wave, high-end HVAC feel",
  palette: ["#06131f", "#0d3f63", "#12a3a0"],
  mood: "clean, technical, premium",
};

const CREATIVE = [
  { assetId: "field", kind: "raster", contentHash: sha256("fieldbytes"), storagePath: "creative/field.png",
    role: "background", generatedBy: "image-model", intrinsic: { widthPx: 4000, heightPx: 1200 }, minPxPerInch: 1 },
  { assetId: "wave", kind: "vector", contentHash: sha256("wavebytes"), storagePath: "creative/wave.svg",
    role: "abstract", generatedBy: "image-model" },
];

const COMPOSITION = {
  layers: [
    { layerId: "field", assetId: "field", space: GLOBAL_SPACE, extent: { widthIn: 720, heightIn: 66 }, transform: { x: 0, y: 0 }, zOrder: 0 },
    { layerId: "wave", assetId: "wave", space: GLOBAL_SPACE, extent: { widthIn: 720, heightIn: 40 }, transform: { x: 0, y: 20 }, zOrder: 5, blend: "screen", opacity: 0.9 },
  ],
};

const BASE = () => ({
  identity: clone(IDENTITY),
  revisionSnapshot: clone(SNAPSHOT),
  manifest: clone(MANIFEST),
  creativeBrief: clone(BRIEF),
  creativeAssets: clone(CREATIVE),
  composition: clone(COMPOSITION),
  typography: { fontId: "sans", colorToken: "paper-white" },
  logoPlacements: {
    "precision-mark:driver": { widthIn: 24, heightIn: 24, x: 110, y: 8 },
    "precision-mark:passenger": { widthIn: 24, heightIn: 24, x: 110, y: 8 },
  },
  palette: [{ token: "brand-teal", srgb: "#12a3a0" }, { token: "paper-white", srgb: "#f4f6f8" }],
  fonts: [{ fontId: "sans", family: "DejaVu Sans", version: "2.37", contentHash: sha256("fontbytes"), license: "bitstream-vera", storagePath: "fonts/s.ttf" }],
});

const author = (over = {}) => authorDesignMaster({ ...BASE(), ...over });

test("GATE: the author assembles a valid master from canonical sources and creative input", () => {
  const { master, assetSources } = author();

  assert.equal(master.authorContract, AUTHOR_CONTRACT);
  assert.equal(master.designId, "DID-PHASE6");
  assert.match(master.masterHash, /^[0-9a-f]{64}$/);

  // Geometry is the manifest's, exactly.
  assert.deepEqual(master.designSpace.surfaces.map((s) => s.surfaceKey), SURFACE_KEYS);
  for (const surface of master.designSpace.surfaces) {
    assert.equal(surface.widthIn, TRIM[surface.surfaceKey][0]);
    assert.equal(surface.heightIn, TRIM[surface.surfaceKey][1]);
  }
  // Mirroring is a property of the vehicle, not a recommendation.
  assert.equal(master.designSpace.surfaces.find((s) => s.surfaceKey === "passenger").mirror, true);
  assert.equal(master.designSpace.surfaces.find((s) => s.surfaceKey === "driver").mirror, false);

  // The canonical string is copied from the snapshot, once, and marked as such.
  assert.equal(master.textObjects.length, 1);
  assert.equal(master.textObjects[0].string, URL_STRING);
  assert.equal(master.textObjects[0].spellingAuthority, "revision-snapshot");
  assert.equal(master.textObjects[0].neverMirror, true);
  // One string, placed on both flanks — not two strings that happen to match.
  assert.equal(master.layers.filter((l) => l.type === "text").length, 2);

  // The logo is the inventory's file, on both flanks, by one identity.
  assert.equal(master.logoObjects.length, 2);
  for (const logo of master.logoObjects) {
    assert.equal(logo.contentHash, sha256("markfile"));
    assert.equal(logo.neverMirror, true);
    assert.equal(logo.neverRasterizeIntoBase, true);
  }

  // Creative input is present, underneath, and recorded as generated.
  assert.equal(master.creativeProvenance.length, 2);
  assert.deepEqual(master.creativeProvenance.map((p) => p.role).sort(), ["abstract", "background"]);
  for (const entry of master.creativeProvenance) assert.equal(entry.generatedBy, "image-model");
  assert.equal(assetSources.length, 3, "two creative assets and one logo file");
});

test("GATE: creative layers cannot be composited over canonical text or logos", () => {
  const { master } = author();
  const top = (type) => Math.max(...master.layers.filter((l) => l.type === type).map((l) => l.zOrder));
  const bottom = (type) => Math.min(...master.layers.filter((l) => l.type === type).map((l) => l.zOrder));
  const creative = master.layers.filter((l) => !["text", "logo"].includes(l.type));

  assert.ok(Math.max(...creative.map((l) => l.zOrder)) < bottom("text"),
    "a creative layer sits above the type");
  assert.ok(top("text") < bottom("logo") || bottom("logo") > Math.max(...creative.map((l) => l.zOrder)),
    "a creative layer sits above a logo");

  // Even a recommendation that asks to be on top is clamped below type.
  const greedy = clone(COMPOSITION);
  greedy.layers[0].zOrder = 99999;
  assert.throws(() => author({ composition: greedy }), (e) => e.code === "author_number_invalid");
  greedy.layers[0].zOrder = 499;
  const { master: clamped } = author({ composition: greedy });
  assert.ok(clamped.layers.find((l) => l.layerId === "field").zOrder < 600);
});

test("GATE: the model is never briefed with canonical text, logo files or geometry", () => {
  // A brief carrying the customer's own string is refused, not scrubbed:
  // scrubbing would let the caller keep making the mistake and never find out.
  assert.throws(() => author({
    creativeBrief: { ...BRIEF, direction: `Big bold ${URL_STRING} across the doors` },
  }), (e) => e.code === "author_brief_carries_canonical_text");

  assert.throws(() => author({
    creativeBrief: { ...BRIEF, referenceLogo: sha256("markfile") },
  }), (e) => e.code === "author_brief_carries_logo");

  for (const field of ["widthInches", "expectedSurfaces", "dimensionManifestId"]) {
    assert.throws(() => author({ creativeBrief: { ...BRIEF, [field]: 153 } }),
      (e) => e.code === "author_brief_carries_geometry", `expected ${field} to be refused`);
  }

  assert.throws(() => author({ creativeBrief: { ...BRIEF, contract: "something.else" } }),
    (e) => e.code === "author_brief_contract_invalid");

  // The check is against the snapshot's own strings, not a caller-supplied list.
  assert.doesNotThrow(() => assertCreativeBriefIsClean(BRIEF, { textStrings: [URL_STRING], logoHashes: [sha256("markfile")] }));
});

test("GATE: a creative asset cannot promote itself to carrying identity", () => {
  for (const [mutation, code] of [
    [{ carriesText: true }, "author_creative_claims_identity"],
    [{ textId: "domain" }, "author_creative_claims_identity"],
    [{ logoIdentityKey: "precision-mark" }, "author_creative_claims_identity"],
    [{ carriesLogo: true }, "author_creative_claims_identity"],
    [{ role: "logo" }, "author_creative_role_unknown"],
    [{ role: "typography" }, "author_creative_role_unknown"],
    [{ generatedBy: "" }, "author_field_missing"],
    [{ contentHash: "nope" }, "author_hash_invalid"],
  ]) {
    const assets = clone(CREATIVE);
    Object.assign(assets[0], mutation);
    assert.throws(() => author({ creativeAssets: assets }), (e) => e.code === code,
      `expected ${code} for ${JSON.stringify(mutation)}`);
  }

  // And a creative asset cannot occupy a logo identity's asset slot.
  const shadow = clone(CREATIVE);
  shadow[0].assetId = "logo-precision-mark";
  assert.throws(() => author({ creativeAssets: shadow }), (e) => e.code === "author_creative_shadows_logo");

  // A creative layer may only be imagery.
  const typed = clone(COMPOSITION);
  typed.layers[0].type = "text";
  assert.throws(() => author({ composition: typed }), (e) => e.code === "author_composition_type_invalid");
  const logoish = clone(COMPOSITION);
  logoish.layers[0].type = "logo";
  assert.throws(() => author({ composition: logoish }), (e) => e.code === "author_composition_type_invalid");
});

test("GATE: geometry comes from the manifest and cannot be supplied by composition", () => {
  // A recommendation cannot exceed the space the manifest fixed.
  const oversized = clone(COMPOSITION);
  oversized.layers[0].extent.heightIn = 10000;
  assert.throws(() => author({ composition: oversized }), (e) => e.code === "author_number_invalid");

  // A surface-scoped layer is bounded by that surface plus its bleed.
  const perSurface = clone(COMPOSITION);
  perSurface.layers[0].space = "front";
  perSurface.layers[0].extent = { widthIn: 129 + 10, heightIn: 34 + 10 };
  assert.doesNotThrow(() => author({ composition: perSurface }));
  perSurface.layers[0].extent.widthIn = 129 + 11;
  assert.throws(() => author({ composition: perSurface }), (e) => e.code === "author_number_invalid");

  // A manifest missing a surface is refused rather than defaulted.
  const short = clone(MANIFEST);
  short.expectedSurfaces = short.expectedSurfaces.slice(0, 5);
  assert.throws(() => author({ manifest: short }), (e) => e.code === "author_manifest_incomplete");
  assert.throws(() => author({ manifest: {} }), (e) => e.code === "author_manifest_missing");

  // Every surface must declare a pinned mapping identity.
  const unmapped = clone(IDENTITY);
  delete unmapped.surfaceMappings.roof;
  assert.throws(() => author({ identity: unmapped }), (e) => e.code === "author_mapping_missing");
});

test("the author is deterministic, and identity moves with every authoritative input", () => {
  const first = author().master;
  const second = author().master;
  assert.equal(first.masterHash, second.masterHash);

  const respelled = clone(SNAPSHOT);
  respelled.bodyText[0].string = "PrecisionClimateAZ.com/hvac";
  respelled.bodyText[1].string = "PrecisionClimateAZ.com/hvac";
  assert.notEqual(author({ revisionSnapshot: respelled }).master.masterHash, first.masterHash);

  const recoloured = clone(COMPOSITION);
  recoloured.layers[1].opacity = 0.5;
  assert.notEqual(author({ composition: recoloured }).master.masterHash, first.masterHash);

  const newArt = clone(CREATIVE);
  newArt[0].contentHash = sha256("different imagery");
  assert.notEqual(author({ creativeAssets: newArt }).master.masterHash, first.masterHash);

  const bigger = clone(MANIFEST);
  bigger.expectedSurfaces[0].widthInches = 160;
  assert.notEqual(author({ manifest: bigger }).master.masterHash, first.masterHash);
});

test("one string declared two ways, and other assembly errors, fail closed", () => {
  const conflicting = clone(SNAPSHOT);
  conflicting.bodyText[1].string = "PrecisionsClimateAz.com";
  assert.throws(() => author({ revisionSnapshot: conflicting }), (e) => e.code === "author_text_identity_conflict");

  const offVehicle = clone(SNAPSHOT);
  offVehicle.bodyText[0].surfaceKey = "tailgate";
  assert.throws(() => author({ revisionSnapshot: offVehicle }), (e) => e.code === "author_text_surface_invalid");

  assert.throws(() => author({ revisionSnapshot: { ...SNAPSHOT, contractVersion: "v2" } }),
    (e) => e.code === "author_revision_snapshot_invalid");
  assert.throws(() => author({ revisionSnapshot: { ...SNAPSHOT, expectedLogoInventory: undefined } }),
    (e) => e.code === "author_logo_inventory_missing");
  assert.throws(() => author({ logoPlacements: {} }), (e) => e.code === "author_logo_placement_missing");
  assert.throws(() => author({ composition: { layers: [] } }), (e) => e.code === "author_composition_empty");
  assert.throws(() => author({ composition: { layers: [{ layerId: "x", assetId: "ghost", extent: { widthIn: 1, heightIn: 1 } }] } }),
    (e) => e.code === "author_composition_asset_unknown");
});

test("the closed creative role set is what it claims to be", () => {
  assert.deepEqual([...CREATIVE_ROLES].sort(), ["abstract", "background", "decorative", "pattern", "photography", "texture"]);
  // Every role is decoration. None of them names a thing that carries identity,
  // which is the property that lets the author place them under type and marks
  // without asking what they contain.
  for (const role of ["logo", "mark", "wordmark", "typography", "lettering", "text"]) {
    assert.equal(CREATIVE_ROLES.includes(role), false, `${role} must not be a creative role`);
  }
});
