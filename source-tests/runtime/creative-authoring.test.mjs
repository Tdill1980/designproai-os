// The authoring boundary: Calls 1-7 must record what they decided, and what
// they record must be something Call 8 accepts.
//
// Two things are being defended here. First, that the model contributes
// imagery and stacking order and NOTHING that carries identity — not the
// customer's strings, not a logo slot, not a single coordinate. Second, that
// the object this producer emits is the object the Phase 6 author consumes, so
// `call8_design_master_input_missing` cannot come back by drift.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const sharp = require("../../runtime/node_modules/sharp");
const { SURFACE_KEYS } = require("../../runtime/design-master.cjs");
const { authorDesignMaster, CREATIVE_BRIEF_CONTRACT } = require("../../runtime/design-master-author.cjs");
const { validateDesignMaster } = require("../../runtime/design-master.cjs");
const {
  authorCreativeInput, buildCreativeBrief, canonicalStringsFrom, nearestAspectRatio,
  validateSpecification, surfacesFromManifest, CREATIVE_AUTHORING_CONTRACT,
} = require("../../runtime/creative-authoring.cjs");

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const uuid = (n) => `${n.repeat(8)}-${n.repeat(4)}-4${n.repeat(3)}-8${n.repeat(3)}-${n.repeat(12)}`;

const TRIM = { driver: [153, 56], passenger: [153, 56], hood: [71.5, 56], roof: [74.3, 54.8], front: [129, 34], rear: [76, 54] };
const MANIFEST = {
  expectedSurfaces: SURFACE_KEYS.map((key) => ({
    surfaceKey: key, widthInches: TRIM[key][0], heightInches: TRIM[key][1],
    bleed: { top: 5, bottom: 5, left: 5, right: 5 },
  })),
};
const INPUT = {
  brief: "Bold desert sunrise for PrecisionClimateAZ.com, call 602-555-0147",
  businessName: "Precision Climate",
  industry: "HVAC",
  colors: ["deep blue", "sunrise orange"],
  style: "modern",
  vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" },
};
const BODY_TEXT = [{ string: "PrecisionClimateAZ.com" }, { string: "602-555-0147" }];

const SPEC = () => ({
  palette: [{ token: "deep-blue", srgb: "#123a6b" }, { token: "sunrise-orange", srgb: "#e8762c" }],
  assets: SURFACE_KEYS.map((key, index) => ({
    assetId: `${key}-field`, role: "background", surfaceKey: key,
    zOrder: index, opacity: 1, blend: "normal",
    prompt: "A deep blue to sunrise orange gradient over layered desert ridges",
  })),
});

async function pngBytes(width, height) {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 58, b: 107 } } }).png().toBuffer();
}

function fakeProvider(specification, { onImage } = {}) {
  return {
    contract: "designpro.generation-provider.v1",
    async generateSpecification() {
      return { specification, model: "gemini-2.5-flash", keyFingerprint: "abc123def456", attempts: [], contract: "designpro.generation-provider.v1" };
    },
    async generateImage({ aspectRatio }) {
      onImage?.(aspectRatio);
      return { bytes: await pngBytes(1024, 512), contentType: "image/png", model: "gemini-3-pro-image-preview", keyFingerprint: "abc123def456", attempts: [] };
    },
  };
}

const fakeStore = () => ({
  async putImmutableBytes({ storagePath, bytes }) {
    return { storagePath, contentHash: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length };
  },
});

const authored = (over = {}) => authorCreativeInput({
  provider: fakeProvider(SPEC()), store: fakeStore(), manifest: MANIFEST, input: INPUT,
  bodyText: BODY_TEXT, ownerId: uuid("a"), revisionId: uuid("b"), ...over,
});

test("the creative brief never carries a string the snapshot owns", () => {
  const canonical = canonicalStringsFrom({ bodyText: BODY_TEXT, input: INPUT });
  const brief = buildCreativeBrief({ input: INPUT, canonicalStrings: canonical });
  const serialised = JSON.stringify(brief).toLowerCase();
  for (const value of ["PrecisionClimateAZ.com", "602-555-0147", "Precision Climate"]) {
    assert.ok(!serialised.includes(value.toLowerCase()), `brief leaked ${value}`);
  }
  // The creative intent survives the redaction, and the brief is the shape the
  // Phase 6 author audits.
  assert.equal(brief.contract, CREATIVE_BRIEF_CONTRACT);
  assert.match(brief.intent, /desert sunrise/i);
  assert.equal(brief.industry, "HVAC");
  assert.deepEqual(brief.colours, ["deep blue", "sunrise orange"]);
});

test("a specification that asks for lettering is refused", () => {
  const spec = SPEC();
  spec.assets[0].prompt = "Desert ridges with the company name in bold lettering";
  assert.throws(() => validateSpecification(spec, { surfaces: surfacesFromManifest(MANIFEST), canonicalStrings: [] }),
    { code: "creative_prompt_requests_identity" });
});

test("a specification that echoes a canonical string is refused", () => {
  const spec = SPEC();
  spec.assets[0].prompt = "Desert ridges themed for PrecisionClimateAZ.com";
  assert.throws(() => validateSpecification(spec, {
    surfaces: surfacesFromManifest(MANIFEST),
    canonicalStrings: canonicalStringsFrom({ bodyText: BODY_TEXT, input: INPUT }),
  }), { code: "creative_prompt_carries_canonical_string" });
});

test("a creative asset may not occupy the reserved logo namespace", () => {
  const spec = SPEC();
  spec.assets[0].assetId = "logo-primary";
  assert.throws(() => validateSpecification(spec, { surfaces: surfacesFromManifest(MANIFEST), canonicalStrings: [] }),
    { code: "creative_asset_id_reserved" });
});

test("every production surface must be covered by artwork", () => {
  const spec = SPEC();
  spec.assets = spec.assets.filter((asset) => asset.surfaceKey !== "rear");
  assert.throws(() => validateSpecification(spec, { surfaces: surfacesFromManifest(MANIFEST), canonicalStrings: [] }),
    { code: "creative_surface_uncovered" });
});

test("geometry comes from the manifest, never from the model", async () => {
  const spec = SPEC();
  // The model tries to supply placement. It must be ignored outright.
  spec.assets[0].extent = { widthIn: 1, heightIn: 1 };
  spec.assets[0].transform = { x: 999, y: 999, scale: 12, rotate: 45 };
  const input = await authorCreativeInput({
    provider: fakeProvider(spec), store: fakeStore(), manifest: MANIFEST, input: INPUT,
    bodyText: BODY_TEXT, ownerId: uuid("a"), revisionId: uuid("b"),
  });
  const driver = input.composition.layers.find((layer) => layer.space === "driver");
  assert.deepEqual(driver.extent, { widthIn: TRIM.driver[0] + 10, heightIn: TRIM.driver[1] + 10 });
  assert.deepEqual(driver.transform, { x: 0, y: 0, scale: 1, rotate: 0 });
});

test("the authoring input records provenance and reads no rendered view", async () => {
  const input = await authored();
  assert.equal(input.contractVersion, CREATIVE_AUTHORING_CONTRACT);
  assert.equal(input.provenance.readsRenderedViews, false);
  assert.equal(input.provenance.authoredFrom, "customer-brief");
  assert.equal(input.creativeAssets.length, SURFACE_KEYS.length);
  for (const asset of input.creativeAssets) {
    assert.match(asset.contentHash, /^[0-9a-f]{64}$/);
    assert.ok(asset.storagePath.includes("/authoring/"));
    assert.ok(asset.generatedBy.includes("gemini-3-pro-image-preview"));
    assert.ok(asset.minPxPerInch > 0);
  }
});

test("what this producer emits is what the Phase 6 author accepts", async () => {
  const input = await authored();
  const snapshot = {
    contractVersion: "designpro.revision-snapshot.v1",
    designId: "DID-1C425383",
    bodyText: [], expectedLogoInventory: [],
  };
  const manifestHash = sha256("manifest");
  const { master, assetSources } = authorDesignMaster({
    identity: {
      masterId: uuid("1"), revisionId: uuid("2"), vehicleId: uuid("3"),
      dimensionManifestId: uuid("4"), manifestHash, designSpaceId: uuid("5"),
      surfaceMappings: Object.fromEntries(SURFACE_KEYS.map((key) => [key, { mappingId: uuid("6"), mappingHash: sha256(key) }])),
    },
    revisionSnapshot: snapshot,
    manifest: MANIFEST,
    creativeBrief: input.creativeBrief,
    creativeAssets: input.creativeAssets,
    composition: input.composition,
    palette: input.palette,
    fonts: [],
    typography: {},
    logoPlacements: [],
  });
  // The master validates on its own terms, which is the whole point: Call 8
  // consumes exactly this.
  const validated = validateDesignMaster(master);
  assert.match(validated.masterHash, /^[0-9a-f]{64}$/);
  assert.equal(validated.designSpace.surfaces.length, SURFACE_KEYS.length);
  // Every placed asset resolves to bytes the loader can fetch and hash-check.
  assert.equal(assetSources.length, input.creativeAssets.length);
  for (const source of assetSources) {
    const emitted = input.creativeAssets.find((asset) => asset.assetId === source.assetId);
    assert.ok(emitted, `master references ${source.assetId}, which the producer did not emit`);
    assert.equal(source.contentHash, emitted.contentHash);
  }
});

test("an asset is generated at the ratio of the surface it covers", () => {
  assert.equal(nearestAspectRatio(163, 66), "16:9");
  assert.equal(nearestAspectRatio(84, 64), "4:3");
  assert.equal(nearestAspectRatio(60, 60), "1:1");
});
