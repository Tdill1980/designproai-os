// THE RUNTIME'S HALF OF THE CANONICAL CALL 1 — the request mapping.
//
// Owner directive (Trish 2026-08-27, PASTE_TO_CLAUDE.md) superseded the v9
// vendored-builder contract this file used to lock: the creative prompt is now
// assembled ONLY inside the deployed design-panel-ai-generate edge function
// (see tests/atlas-artboard-edge-call1.test.mjs for that half). What remains
// the runtime's responsibility — and what this file locks — is the faithful,
// creative-text-free mapping of the verified v3 input and the GENIE manifest
// onto that function's request body.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { _test: atlas, buildAtlasManifest } = require("../runtime/flat-first-atlas.cjs");
const { atlasEdgeRequestBody } = atlas;

const SURFACES = [
  { surfaceKey: "driver", widthInches: 153, heightInches: 56 },
  { surfaceKey: "passenger", widthInches: 153, heightInches: 56 },
  { surfaceKey: "hood", widthInches: 71.5, heightInches: 56 },
  { surfaceKey: "roof", widthInches: 74.3, heightInches: 54.8 },
  { surfaceKey: "front", widthInches: 129, heightInches: 34 },
  { surfaceKey: "rear", widthInches: 76, heightInches: 54 },
];

const BASE_INPUT = {
  mode: "commercial",
  brief: "Bold commercial HVAC wrap: deep blue base with sunrise-orange airflow ribbons.",
  companyName: "Precision Climate Solutions",
  phone: "(520) 555-0192",
  website: "precisionclimate.com",
  industry: "HVAC and climate control",
  finish: "Gloss",
  brandColors: "deep blue, sunrise orange",
  vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" },
};

function body(input = BASE_INPUT, extras = {}) {
  return atlasEdgeRequestBody(input, buildAtlasManifest(SURFACES, null), extras);
}

test("the request targets the canonical mode and carries the exact customer data", () => {
  const b = body();
  assert.equal(b.mode, "atlas-artboard");
  assert.equal(b.authoringMode, "commercial");
  assert.equal(b.companyName, "Precision Climate Solutions");
  assert.equal(b.phone, "(520) 555-0192");
  assert.equal(b.website, "precisionclimate.com");
  assert.equal(b.vehicleYear, "2022");
  assert.equal(b.vehicleMake, "Ford");
  assert.equal(b.vehicleModel, "F250 Crew Cab");
  assert.equal(b.vehicleType, "truck");
  assert.match(b.prompt, /airflow ribbons/);
  assert.match(b.prompt, /deep blue, sunrise orange/);
});

test("contact data is never invented — absent fields stay absent", () => {
  const b = body({ ...BASE_INPUT, phone: "", website: "" });
  assert.equal(b.phone, undefined);
  assert.equal(b.website, undefined);
});

test("the six panels ride the request with identity and placement -- the inches stay with GENIE", () => {
  // Owner directive 2026-08-28 (the Call-1 authoring boundary): pixel and inch
  // Pixel and inch dimensions, trim/bleed and component topology remain
  // server-only. Short surface identity plus placement is the hardwired mapping
  // between the labeled top-view guide and the prompt.
  //
  // This test used to assert the opposite -- that `widthInches` rode the body --
  // which is exactly the contract that put technical inventory in front of the
  // image model. GENIE keeps the numbers; they reach the panels through
  // `manifest.zones`, which is what `cutCallOnePanels` crops to, and through the
  // guide geometry. They do not reach Gemini.
  const b = body();
  assert.equal(b.panels.length, 6);
  const labels = b.panels.map((p) => p.label).sort();
  // The owner's exact container names (2026-08-27): "Driver Side, Passenger
  // Side, Hood, Roof, Rear and Front."
  assert.deepEqual(labels, ["Driver Side", "Front", "Hood", "Passenger Side", "Rear", "Roof"]);
  for (const panel of b.panels) {
    assert.deepEqual(Object.keys(panel), ["label", "surfaceId", "placement"]);
    assert.ok(panel.surfaceId);
    assert.ok(["left-flank", "center-column", "right-flank"].includes(panel.placement));
  }
  // And the geometry the request no longer carries is still held by GENIE, at
  // full precision, where the deterministic crop reads it.
  const manifest = buildAtlasManifest(SURFACES, null);
  const driverZone = manifest.zones.find((z) => z.surfaceKey === "driver");
  assert.equal(driverZone.trimWidthIn, 153);
  assert.equal(driverZone.trimHeightIn, 56);
  assert.equal(driverZone.printWidthIn, 163, "GENIE still carries the 5\" bleed on both edges");
  assert.equal(driverZone.printHeightIn, 66);
});

test("restyle maps to restyle; unknown modes fall back to commercial", () => {
  assert.equal(body({ ...BASE_INPUT, mode: "restyle" }).authoringMode, "restyle");
  assert.equal(body({ ...BASE_INPUT, mode: "banana" }).authoringMode, "commercial");
});

test("visionboard intent maps exactly; artboard_projection counts as exact_reference", () => {
  assert.equal(body({ ...BASE_INPUT, visionboardIntent: "exact_reference" }).visionboard_intent, "exact_reference");
  assert.equal(body({ ...BASE_INPUT, visionboardIntent: "artboard_projection" }).visionboard_intent, "exact_reference");
  assert.equal(body().visionboard_intent, "style_inspiration");
});

test("the mapping contains zero creative language of its own", () => {
  const b = body();
  const serialized = JSON.stringify(b);
  // Every sentence in the request body must be traceable to the customer's
  // own input or to plain field labels — never to designer direction written
  // in this runtime.
  for (const forbidden of ["elite", "designer", "SEMA", "studio", "photorealistic", "SOLID RECTANGLE", "mirror twin"]) {
    assert.ok(!serialized.includes(forbidden), `runtime request must not carry creative text: ${forbidden}`);
  }
});

test("corrective notes, the guide and customer references ride only through extras", () => {
  const identity = { contract: "designpro.atlas-design-teaching-pair.v1" };
  const b = body(BASE_INPUT, {
    guideStoragePath: "atlas-call1-inputs/abc.png",
    cohesionExampleProofStoragePath: `atlas-call1-inputs/${"a".repeat(64)}.jpg`,
    cohesionExampleFlatStoragePath: `atlas-call1-inputs/${"b".repeat(64)}.jpg`,
    cohesionExampleVehicle: "2022 Ford F-250 Crew Cab",
    cohesionExampleIdentity: identity,
    correctiveNote: "CORRECTION -- refused",
    referenceImagesBase64: ["YmF6"],
  });
  // The deterministic guide travels as a STORAGE PATH — a 2.2MB inline-base64
  // body killed the edge worker twice (2026-08-27).
  assert.equal(b.guideStoragePath, "atlas-call1-inputs/abc.png");
  assert.match(b.cohesionExampleProofStoragePath, /^atlas-call1-inputs\/[a-f0-9]{64}\.jpg$/);
  assert.match(b.cohesionExampleFlatStoragePath, /^atlas-call1-inputs\/[a-f0-9]{64}\.jpg$/);
  assert.equal(b.cohesionExampleVehicle, "2022 Ford F-250 Crew Cab");
  assert.equal(b.cohesionExampleIdentity, identity);
  assert.equal(b.structuralReferenceStoragePath, undefined);
  assert.equal(b.structuralPairedProofStoragePath, undefined);
  assert.equal(b.correctiveNote, "CORRECTION -- refused");
  assert.deepEqual(b.referenceImagesBase64, ["YmF6"]);
  // And no inline blob field survives on the request.
  assert.equal(b.guideImageBase64, undefined);
  assert.equal(b.structuralReferenceBase64, undefined);
});

test("the human guide stays labeled while the model mask contains no printable furniture", async () => {
  // Identity remains exact request data and on the human installer guide. The
  // model sees neutral masks only; visual labels and outlines were copied into
  // candidate artwork and failed artifact-free QC.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  for (const label of ["Driver Side", "Passenger Side", "Hood", "Roof", "Front", "Rear"]) {
    assert.ok(source.includes(`"${label}"`), `the human guide label ${label} must remain declared`);
  }
  for (const id of ["DS", "PS", "HD", "RF", "FR", "RR"]) {
    assert.match(source, new RegExp(`"${id}"`), `the ${id} data identity must be declared`);
  }
  const authoringGuide = source.slice(
    source.indexOf("function authoringGuideSvg(manifest)"),
    source.indexOf("/** The human-readable installer map"),
  );
  assert.doesNotMatch(authoringGuide, /<text\\b|stroke=|stroke-dasharray|<line\\b|<path\\b|<polygon\\b/i);
  assert.match(source, /flat_atlas_authoring_guide_contains_technical_furniture/);
});
