import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

// THE CANONICAL CALL 1 — DESIGNPANELAI + ATLAS IN ONE AUTHORING CALL.
//
// Owner directive (Trish 2026-08-26): the creative half of A.T.L.A.S. Call 1
// is the REAL design-panel-ai-generate builder — the vendored source,
// mechanically transpiled — never a reconstructed port. This file locks:
//
//   1. ONE implementation: atlasCreativeRules() is exactly the vendored
//      builder's atlasTopology output; the reconstructed branch stays deleted.
//   2. CONTAMINATION (owner protection #3): the finished Call-1 prompt carries
//      no studio, no camera angle, no vehicle-on-stage presentation, no
//      photographic-viewpoint flank framing, no 3D-proof instructions.
//   3. BEHAVIOR: the professional-designer contract — auto-logo, exact
//      contact data, no invented phone/website, VisionBoardIQ intents that
//      never disable the persona, depth/translation/judgment, mascot, QR,
//      finish and substrate — all fire inside the same single call.
//
// RULE 0.15's topology blocks (SOLID PANELS, ONE COHESIVE WRAP, the paired
// Houdini lesson, MASTER APPLICATION BOUNDARY) live in the atlas half and are
// asserted on the assembled prompt.

const require = createRequire(import.meta.url);
const vendor = require("../runtime/vendor/designpanel-authoring.cjs");
const ace = require("../runtime/designiq-prompt.cjs");
const atlas = require("../runtime/flat-first-atlas.cjs");
const { atlasCreativeRules, atlasPrompt } = atlas._test;
const {
  PROMPT_VERSION, PROOF_VIEWS, PROOF_DEPENDENCIES, buildAtlasManifest,
} = atlas;

const edgeSource = readFileSync(
  new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url),
  "utf8",
);

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"].map((surfaceKey) => ({
  surfaceKey,
  widthInches: ["driver", "passenger"].includes(surfaceKey) ? 153 : 68,
  heightInches: ["driver", "passenger"].includes(surfaceKey) ? 56 : 50,
}));

const BASE_INPUT = {
  brief: "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with sunrise-orange airflow ribbons",
  mode: "commercial",
  companyName: "Precision Climate Solutions",
  industry: "HVAC and climate control",
  brandColors: "deep blue, sunrise orange",
  finish: "Satin",
  vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" },
};

function fullPrompt(input = BASE_INPUT, options = {}) {
  return atlasPrompt(input, buildAtlasManifest(SURFACES, null), options);
}

test("the creative half IS the vendored real builder — one canonical implementation", () => {
  const creative = atlasCreativeRules(BASE_INPUT, { artboardQualityExampleCount: 0 });
  const direct = vendor.buildDesignIQPrompt({
    mode: "artboard",
    atlasTopology: true,
    authoringMode: "commercial",
    artboardQualityExampleCount: 0,
    prompt: BASE_INPUT.brief,
    finish: "Satin",
    substrate: "standard",
    companyName: BASE_INPUT.companyName,
    industryType: BASE_INPUT.industry,
    brandColors: BASE_INPUT.brandColors,
    qrEnabled: false,
    logoSupplied: false,
    vehicleYear: "2022",
    vehicleMake: "Ford",
    vehicleModel: "F250 Crew Cab",
    visionBoardImages: [],
    visionboard_intent: "style_inspiration",
  });
  assert.equal(creative, direct, "atlasCreativeRules must be a pure input mapping over the vendored builder");

  // The reconstructed branch stays deleted — no second producer of the
  // creative direction, and no compatibility alias resurrecting it.
  assert.ok(!("buildAtlasArtboardDesignIQDirection" in ace));
  assert.ok(!("buildFlatDesignIQDirection" in ace));
  const runtimeSource = readFileSync(new URL("../runtime/designiq-prompt.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(runtimeSource, /function buildAtlasArtboardDesignIQDirection/);
});

test("the finished Call-1 prompt is free of studio, camera, vehicle-stage and 3D-proof contamination", () => {
  const prompt = fullPrompt();
  assert.ok(!prompt.includes(vendor.STUDIO_ENVIRONMENT), "STUDIO_ENVIRONMENT must not reach the flat call");
  for (const view of ["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"]) {
    const angle = String(vendor.getCameraAngle(view)).trim();
    assert.ok(!prompt.includes(angle.slice(0, 60)), `camera angle for ${view} must not reach the flat call`);
  }
  for (const marker of [
    "CAMERA ANGLE",
    "Canon EOS",
    "photorealistic studio photograph",
    "studio photograph",
    "photographic scene",
    "landmarks",
    "Windows, lights, wheels, and trim stay factory",
    "bare factory bedliner",
    "open bed interior",
    "HOOD/ROOF CONTINUITY",
  ]) {
    assert.ok(!prompt.includes(marker), `"${marker}" must not reach the flat call`);
  }
});

test("the persona, translation, depth and judgment fire inside the one call — and per mode", () => {
  const commercial = fullPrompt();
  assert.ok(commercial.includes(vendor.COMMERCIAL_PERSONA));
  assert.ok(commercial.includes(vendor.COMMERCIAL_TRANSLATION));
  assert.ok(commercial.includes(vendor.COMMERCIAL_DEPTH));
  assert.ok(commercial.includes(vendor.PROFESSIONAL_JUDGMENT));
  assert.doesNotMatch(commercial, /DESIGN AMPLIFICATION/);

  const restyle = fullPrompt({ ...BASE_INPUT, mode: "restyle", companyName: "", industry: "" });
  assert.ok(restyle.includes(vendor.COMMERCIAL_PERSONA));
  assert.match(restyle, /DESIGN AMPLIFICATION/);
  assert.ok(restyle.includes(vendor.PROFESSIONAL_JUDGMENT));
  assert.ok(!restyle.includes(vendor.COMMERCIAL_TRANSLATION));
});

test("auto-logo: a supplied name gets the composed identity; a brief-only business still gets a designed logo", () => {
  const named = fullPrompt();
  assert.match(named, /BRAND: Precision Climate Solutions — integrate the company name \+ logo \+ a clean contact bar/);
  assert.match(named, /Spell the business name exactly\./);

  const briefOnly = fullPrompt({ ...BASE_INPUT, companyName: "" });
  assert.match(briefOnly, /Identify the business name from the creative direction above\. Spell it exactly as written in the brief\./);
  assert.ok(briefOnly.includes(vendor.LOGO_REQUIREMENT));

  const supplied = fullPrompt({ ...BASE_INPUT, logoAsset: { storagePath: "x", contentHash: "0".repeat(64), byteSize: 10 } });
  assert.match(supplied, /attached verified customer-owned logo is the logo authority; preserve its form, spelling, proportions and palette exactly/);
  assert.match(supplied, /never invent a substitute/);
  assert.ok(!supplied.includes(vendor.LOGO_REQUIREMENT), 'a supplied logo must not also demand an invented mark');
  assert.ok(named.includes(vendor.ATLAS_LOGO_AUTHORING_RULE), 'auto path refuses set-type-as-logo');
});

test("exact contact data in, no invented contact data out — phone and website guarded independently", () => {
  const both = fullPrompt({ ...BASE_INPUT, phone: "(555) 010-4477", website: "precisionclimate.com" });
  assert.match(both, /\(555\) 010-4477 — display this EXACT number, digit for digit\. Never alter or invent any digits\./);
  assert.match(both, /precisionclimate\.com — display this EXACT URL, character for character\./);

  const neither = fullPrompt();
  assert.match(neither, /No phone number was provided — do NOT invent, fabricate, or display any phone number/);
  assert.match(neither, /No website was supplied — invent no website, email address or street address/);

  // A supplied website must not suppress the phone guard (the coupled-guard
  // defect), and vice versa.
  const webOnly = fullPrompt({ ...BASE_INPUT, website: "precisionclimate.com" });
  assert.match(webOnly, /No phone number was provided/);
  assert.match(webOnly, /precisionclimate\.com — display this EXACT URL/);
  const phoneOnly = fullPrompt({ ...BASE_INPUT, phone: "(555) 010-4477" });
  assert.match(phoneOnly, /No website was supplied/);
  assert.match(phoneOnly, /display this EXACT number/);
});

test("VisionBoardIQ stays inside the same call and never disables the designer", () => {
  const refs = [{ storagePath: "tenants/x/ref1.png", contentHash: "a".repeat(64), byteSize: 10 }];

  const exact = fullPrompt({ ...BASE_INPUT, visionBoardImages: refs, visionboardIntent: "exact_reference" });
  assert.match(exact, /EXACT REFERENCE: The provided reference is the customer's own approved wrap design/);
  assert.ok(exact.includes(vendor.COMMERCIAL_PERSONA), "a reference never turns the designer off");
  assert.match(exact, /BRAND: Precision Climate Solutions/, "a reference never disables auto-logo/brand behavior");

  const dna = fullPrompt({ ...BASE_INPUT, visionBoardImages: refs, visionboardIntent: "style_inspiration", styleDescriptors: "electric gradients, chrome linework" });
  assert.match(dna, /STYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design/);
  assert.match(dna, /electric gradients, chrome linework/);

  const plain = fullPrompt({ ...BASE_INPUT, visionBoardImages: refs, visionboardIntent: "style_inspiration" });
  assert.match(plain, /STYLE INSPIRATION: Transform the mood, colors, and artistic style/);

  // Storage identity is never interpolated into the prompt.
  for (const prompt of [exact, dna, plain]) assert.doesNotMatch(prompt, /tenants\/x\/ref1\.png/);
});

test("mascot, QR, keywords, colors, finish and substrate all ride the one call", () => {
  const prompt = fullPrompt({
    ...BASE_INPUT,
    mascot: "a granite ram",
    qrEnabled: true,
    bulletPoints: ["licensed", "24/7"],
    fontStyle: "bold condensed sans",
    substrate: "chrome_film",
  });
  assert.match(prompt, /BRAND MASCOT: Design an original, custom-illustrated brand character — a granite ram/);
  assert.match(prompt, /QR CODE ZONE: Reserve one clean, flat, evenly-lit rectangular area/);
  assert.match(prompt, /Brand keywords \(guide tone — not literal on-vehicle text\): licensed, 24\/7/);
  assert.match(prompt, /Typography preference: bold condensed sans\./);
  assert.match(prompt, /Brand colors: deep blue, sunrise orange — build the entire design from this palette/);
  assert.match(prompt, /Finish: SATIN — SATIN/);
  assert.match(prompt, /mirror chrome base film/);
});

test("photo realism fires only on an explicit photographic brief", () => {
  const photo = fullPrompt({ ...BASE_INPUT, brief: "A true-to-life photographic pool and patio scene, photorealistic" });
  assert.ok(photo.includes(vendor.PHOTO_REALISM_LOCK));
  assert.ok(!fullPrompt().includes(vendor.PHOTO_REALISM_LOCK));
});

test("the gold-standard quality bar follows the attachments", () => {
  const withExamples = fullPrompt(BASE_INPUT, { artboardQualityExampleCount: 2 });
  const without = fullPrompt(BASE_INPUT, { artboardQualityExampleCount: 0 });
  assert.match(withExamples, /Match the production quality of the provided gold-standard DesignPanel artboards/);
  assert.doesNotMatch(without, /gold-standard DesignPanel artboards/);
  for (const prompt of [withExamples, without]) {
    assert.match(prompt, /Gallery-grade custom artwork with real depth, movement, and a wow factor/);
  }
});

test("the atlas half keeps RULE 0.15's topology blocks, and paint-through beats punch-out", () => {
  const prompt = fullPrompt();
  assert.match(prompt, /SOLID PANELS -- THIS IS THE MOST IMPORTANT RULE OF THIS CALL/);
  assert.match(prompt, /ONE COHESIVE WRAP, FLATTENED FROM DIRECTLY ABOVE/);
  assert.match(prompt, /PAIRED FLAT-TO-FINISHED LESSON/);
  assert.match(prompt, /REFERENCE FIREWALL/);
  assert.match(prompt, /MASTER APPLICATION BOUNDARY: The A\.T\.L\.A\.S\. master stays FULL-BLEED/);
  assert.match(prompt, /Paint the livery continuously THROUGH every place a window, glass panel, pickup-bed opening, wheel, wheel arch, lamp or trim piece will later sit/);
  assert.match(prompt, /Keep essential logos, lettering and contact copy anchored to solid painted body area rather than to an opening/);
  assert.doesNotMatch(prompt, /punch out/i);

  // The flank twin rule survives WITHOUT the scene/landmarks framing — the
  // only flank-specific language that existed when the flanks broke at v4.
  assert.match(prompt, /mirror-compatible twin of DRIVER: the same flat artwork/);
  assert.match(prompt, /forward-reading on both zones/);

  // …and the vehicle-coverage sentences still reach the calls that render a
  // vehicle, unchanged.
  for (const [name, proof] of Object.entries({
    commercial: ace.buildDesignIQPrompt({ prompt: BASE_INPUT.brief, mode: "commercial", companyName: BASE_INPUT.companyName, viewType: "side", vehicleYear: "2022", vehicleMake: "Ford", vehicleModel: "F250 Crew Cab" }),
    restyle: ace.buildDesignIQPrompt({ prompt: BASE_INPUT.brief, mode: "restyle", viewType: "side", vehicleYear: "2022", vehicleMake: "Ford", vehicleModel: "F250 Crew Cab" }),
  })) {
    assert.match(proof, /Windows, lights, wheels, and trim stay factory/, `${name} keeps the factory-glass rule`);
    assert.match(proof, /bare factory bedliner/, `${name} keeps the pickup-bed rule`);
  }
});

test("Call 1 authors on a named model, and on the one the fleet actually works on", () => {
  assert.equal(ace.DESIGNPANEL_AUTHORING_MODEL, "gemini-3-pro-image");
  assert.ok(
    edgeSource.includes("models/gemini-3-pro-image-preview:generateContent"),
    "the reference must still build its own model id into its endpoint",
  );
  const atlasSource = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.match(
    atlasSource,
    /model: DESIGNPANEL_AUTHORING_MODEL,\s*\n\s*lockModel: true,/,
    "the master authoring call must name its model and keep the no-fallback contract",
  );
});

test("Atlas freezes Close-Up as proof seven without reintroducing a hero view", () => {
  const manifest = buildAtlasManifest(SURFACES, null);
  assert.equal(PROMPT_VERSION, "designpro-flat-first-atlas-20260826.v9-dpag");
  assert.deepEqual(PROOF_VIEWS, [
    "side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof",
  ]);
  assert.deepEqual(manifest.proofViews, PROOF_VIEWS);
  assert.deepEqual(manifest.proofOnlyViews, ["close-up"]);
  assert.match(JSON.stringify(PROOF_DEPENDENCIES), /close-up/);
  assert.doesNotMatch(JSON.stringify({ manifest, dependencies: PROOF_DEPENDENCIES }), /hero-3d/);
});

test("owner protection #5: the authoring re-roll budget can be pinned to exactly one", () => {
  const atlasSource = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.match(atlasSource, /attempt <= maxAuthoringAttempts/, "the loop honors the configurable budget");
  assert.match(atlasSource, /DESIGNPRO_ATLAS_MAX_AUTHORING_ATTEMPTS/, "the acceptance pin exists");
  assert.match(atlasSource, /geminiImageRequestCount: masterAuthoringAttempts/, "the exact request count is recorded on the revision");
});
