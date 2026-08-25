import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(import.meta.url);
const atlas = require("../../runtime/flat-first-atlas.cjs");
const ace = require("../../runtime/designiq-prompt.cjs");
const worker = require("../../runtime/generation-worker.cjs");
const studio = require("../../runtime/studio-os.cjs");
const gateway = readFileSync(join(root, "gateway", "src", "server.mjs"), "utf8");

const RICH_INPUT = Object.freeze({
  contractVersion: atlas.INPUT_CONTRACT,
  pipelineMode: atlas.PIPELINE_MODE,
  brief: "A vivid commercial pool-service wrap with a photographic desert resort scene",
  designName: "Flamingo Pools",
  mode: "commercial",
  companyName: "Flamingo Pools LLC",
  businessName: "wrong fallback name",
  industry: "pool construction",
  colors: ["#0ea5e9", "#f97316"],
  brandColors: "turquoise, coral, white",
  style: "premium dimensional",
  finish: "satin",
  substrate: "color_change_film",
  mascot: "a confident pink flamingo wearing safety glasses",
  bulletPoints: ["luxury pools", "licensed builder"],
  fontStyle: "bold condensed sans serif",
  phone: "(602) 555-0184",
  website: "flamingopools.example",
  qrEnabled: true,
  qrUrl: "https://flamingopools.example/quote",
  textLayerPrompt: "Use the exact tagline: Desert Luxury, Built to Last",
  logoAsset: {
    storagePath: "users/11111111-1111-4111-8111-111111111111/revisions/22222222-2222-4222-8222-222222222222/inputs/logo/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.svg",
    contentHash: "a".repeat(64),
    byteSize: 128,
    contentType: "image/svg+xml",
  },
  visionboardIntent: "exact_reference",
  styleDescriptors: "high contrast editorial photography",
  vehicle: { year: "2024", make: "Ford", model: "F-250", type: "truck" },
});

const SURFACES = [
  ["driver", 190, 66], ["passenger", 190, 66], ["hood", 68, 62],
  ["roof", 76, 96], ["front", 84, 34], ["rear", 82, 48],
].map(([surfaceKey, widthInches, heightInches]) => ({
  surfaceKey, widthInches, heightInches,
  bleed: { top: 5, right: 5, bottom: 5, left: 5 },
}));

test("gateway admits and bounds every existing DesignIQ control", () => {
  const declared = gateway.match(/const CALLS_1_7_V2_KEYS = \[([\s\S]*?)\];/);
  assert.ok(declared);
  const allowed = new Set([...declared[1].matchAll(/"([a-zA-Z0-9]+)"/g)].map((match) => match[1]));
  for (const key of [
    "finish", "substrate", "mascot", "bulletPoints", "brandColors", "fontStyle",
    "qrEnabled", "qrUrl", "visionBoardImages", "visionboardIntent",
    "styleDescriptors", "textLayerPrompt", "companyName", "phone", "website", "logoAsset",
  ]) assert.equal(allowed.has(key), true, `${key} is still refused by the closed gateway allowlist`);
  assert.match(gateway, /optionalDesignInputIsInvalid\(input, ownerId, generationIdValue\)/);
  assert.match(gateway, /REFERENCE_ASSET_URL_KEYS/);
  assert.match(gateway, /REFERENCE_IMAGE_TYPES, "attachment", ownerId, generationId/);
  assert.match(gateway, /JSON\.stringify\(actualKeys\) !== JSON\.stringify\(exactKeys\)/);
});

test("legacy A.C.E. gets both personas and every rich commercial control", () => {
  const commercial = worker.promptPartsFor(RICH_INPUT, "side")[0].text;
  assert.match(commercial, /senior graphic designer at a sign and wrap company/);
  assert.match(commercial, /Business: Flamingo Pools LLC/);
  assert.doesNotMatch(commercial, /Business: wrong fallback name/);
  assert.match(commercial, /color-change specialty base film/);
  assert.match(commercial, /confident pink flamingo wearing safety glasses/);
  assert.match(commercial, /luxury pools, licensed builder/);
  assert.match(commercial, /turquoise, coral, white/);
  assert.match(commercial, /bold condensed sans serif/);
  assert.match(commercial, /flamingopools\.example/);
  assert.match(commercial, /Desert Luxury, Built to Last/);
  assert.match(commercial, /Do not draw a QR code yourself/);
  assert.match(commercial, /attached verified customer-owned logo is the sole logo authority/i);
  assert.doesNotMatch(commercial, /needs its own logo/);

  const projectedCommercial = worker.promptPartsFor({
    ...RICH_INPUT,
    visionboardIntent: "artboard_projection",
    visionBoardImages: [RICH_INPUT.logoAsset],
  }, "passenger-side")[0].text;
  assert.match(projectedCommercial, /approved flat wrap artboard/);
  assert.match(projectedCommercial, /PASSENGER SIDE region as its exact artwork source/);

  const restyle = worker.promptPartsFor({
    ...RICH_INPUT, mode: "restyle", visionboardIntent: undefined, visionBoardImages: undefined,
  }, "side")[0].text;
  assert.match(restyle, /WePrintWraps\.com Lead Vehicle Wrap Designer/);
  assert.notEqual(restyle, commercial);
  const exactRestyle = worker.promptPartsFor({ ...RICH_INPUT, mode: "restyle" }, "side")[0].text;
  assert.match(exactRestyle, /vehicle wrap REPRODUCTION specialist/);
});

test("legacy reference bytes are hash-verified and sent as inlineData", async () => {
  const bytes = Buffer.from("verified-customer-reference");
  const asset = {
    storagePath: `users/11111111-1111-4111-8111-111111111111/revisions/22222222-2222-4222-8222-222222222222/inputs/attachment/${createHash("sha256").update(bytes).digest("hex")}.png`,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
    contentType: "image/png",
  };
  const supabase = { storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]), error: null }) }) } };
  const parts = await worker.referenceImageParts(supabase, { visionBoardImages: [asset] });
  assert.deepEqual(parts, [{ inlineData: { mimeType: "image/png", data: bytes.toString("base64") } }]);
  const promptParts = worker.promptPartsFor({ ...RICH_INPUT, visionBoardImages: [asset] }, "side", "", parts);
  assert.equal(promptParts.length, 2);
  assert.equal(promptParts[1].inlineData.data, bytes.toString("base64"));

  await assert.rejects(
    () => worker.referenceImageParts(supabase, {
      visionBoardImages: [{ ...asset, contentHash: "f".repeat(64) }],
    }),
    (error) => error.code === "generation_reference_hash_mismatch" && error.retryable === false,
  );
});

test("legacy SVG logos retain source identity but reach Gemini as bounded PNG", async () => {
  const bytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#f06"/></svg>');
  const asset = {
    storagePath: `users/11111111-1111-4111-8111-111111111111/revisions/22222222-2222-4222-8222-222222222222/inputs/logo/${createHash("sha256").update(bytes).digest("hex")}.svg`,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.length,
    contentType: "image/svg+xml",
  };
  const supabase = { storage: { from: () => ({ download: async () => ({ data: new Blob([bytes]), error: null }) }) } };
  const parts = await worker.referenceImageParts(supabase, { logoAsset: asset });
  assert.equal(parts.length, 1);
  assert.equal(parts[0].inlineData.mimeType, "image/png");
  const png = Buffer.from(parts[0].inlineData.data, "base64");
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.notEqual(createHash("sha256").update(png).digest("hex"), asset.contentHash);
});

test("A.T.L.A.S. master prompt honors rich controls and exact-reference intent", () => {
  const input = { ...RICH_INPUT, logoAsset: { storagePath: "x", contentHash: "a".repeat(64), byteSize: 1, contentType: "image/png" }, visionBoardImages: [{}] };
  const prompt = atlas._test.atlasPrompt(input, atlas.buildAtlasManifest(SURFACES));
  for (const expected of [
    "Flamingo Pools LLC", "(602) 555-0184", "flamingopools.example",
    "turquoise, coral, white", "color-change specialty base film",
    "confident pink flamingo wearing safety glasses", "bold condensed sans serif",
    "Desert Luxury, Built to Last", "EXACT CUSTOMER REFERENCE",
  ]) assert.match(prompt, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  // RULE 0.20: this call is the design ORIGIN, so it opens with the reference's
  // COMMERCIAL authoring persona, not the artboard branch's projection framing.
  assert.match(prompt, /senior graphic designer at a sign and wrap company/);
  assert.match(prompt, /verified approved artwork faithfully in one continuous FLAT unwrapped artboard/);
  assert.match(prompt, /FIRST attached deterministic A\.T\.L\.A\.S\. guide is the sole authority/);
  assert.match(prompt, /Do not redesign, restyle, recolor, simplify, correct, or invent/);
});

test("customer image conditioning retains a finite decompression pixel ceiling", () => {
  const source = readFileSync(join(root, "runtime", "flat-first-atlas.cjs"), "utf8");
  assert.ok(Number.isInteger(atlas.CUSTOMER_REFERENCE_MAX_PIXELS));
  assert.ok(atlas.CUSTOMER_REFERENCE_MAX_PIXELS > 0);
  for (const [name, nextName] of [
    ["verifiedCustomerLogoPart", "verifiedCustomerReferenceParts"],
    ["verifiedCustomerReferenceParts", "topologyExampleParts"],
  ]) {
    const block = source.match(new RegExp(
      `async function ${name}\\([\\s\\S]*?(?=async function ${nextName}\\()`,
    ));
    assert.ok(block, `${name} must remain a readable server-native conditioning path`);
    assert.match(
      block[0],
      /limitInputPixels: CUSTOMER_REFERENCE_MAX_PIXELS/,
      `${name} must retain the finite decompression pixel cap`,
    );
  }
});

test("flat DesignIQ carries the Edge artboard-mode quality contract without camera or studio language", () => {
  const direction = ace.buildAtlasArtboardDesignIQDirection({
    ...RICH_INPUT, visionBoardImages: undefined, visionboardIntent: undefined,
  });
  assert.match(direction, /senior graphic designer at a sign and wrap company/);
  assert.match(direction, /Design ONE flat vehicle-wrap ARTBOARD/);
  assert.match(direction, /Fill every supplied exterior-panel zone edge-to-edge/);
  assert.match(direction, /SAME cohesive design flowing across every zone/);
  assert.match(direction, /built from layered elements/);
  assert.match(direction, /Translate anything the brief names/);
  assert.match(direction, /rich photographic realism/);
  assert.match(direction, /master stays FULL-BLEED/);
  assert.match(direction, /Gallery-grade custom artwork with real depth, movement, and a wow factor/);
  assert.match(direction, /No camera, studio, vehicle photograph, mockup/);
  assert.doesNotMatch(
    direction,
    /CAMERA ANGLE|CAMERA SPECIFICATION|HIGH-END WRAP SHOP ENVIRONMENT|DARK EPOXY|Canon EOS/,
  );
});

test("A.T.L.A.S. projections carry exact studio constants but no customer reference bytes", async () => {
  const manifest = atlas.buildAtlasManifest(SURFACES);
  const guide = await atlas.renderAtlasGuide(manifest);
  const masterBytes = (await atlas.normalizeAtlasMaster(guide, manifest)).bytes;
  const projection = await atlas.projectionDerivative(masterBytes);
  const masterHash = atlas._test.sha256(masterBytes);
  const flatAtlas = {
    contract: atlas.ATLAS_CONTRACT,
    revisionId: "44444444-4444-4444-8444-444444444444",
    revisionSequence: 1,
    manifest,
    manifestAsset: { contentHash: atlas._test.sha256(Buffer.from("manifest")) },
    master: { bytes: masterBytes, contentType: "image/png", contentHash: masterHash },
    projection,
    viewAuthorities: await atlas._test.buildViewAuthorities(masterBytes, manifest),
  };
  const forbiddenReference = { inlineData: { mimeType: "image/png", data: "customer-reference-must-not-project" } };
  const slots = worker.slotsFrom(undefined, RICH_INPUT, {}, flatAtlas, [forbiddenReference]);
  assert.equal(slots.every((slot) => slot.promptParts.length === 3), true);
  assert.equal(slots.some((slot) => JSON.stringify(slot.promptParts).includes(forbiddenReference.inlineData.data)), false);
  for (const slot of slots) {
    const projectionPrompt = slot.promptParts[2].text;
    assert.ok(projectionPrompt.includes(studio.STUDIO_ENVIRONMENT.trim()));
    assert.ok(projectionPrompt.includes(studio.STUDIO_REINFORCEMENT.trim()));
  }
});
