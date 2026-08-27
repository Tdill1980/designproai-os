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
  assert.match(b.prompt, /airflow ribbons/);
  assert.match(b.prompt, /deep blue, sunrise orange/);
});

test("contact data is never invented — absent fields stay absent", () => {
  const b = body({ ...BASE_INPUT, phone: "", website: "" });
  assert.equal(b.phone, undefined);
  assert.equal(b.website, undefined);
});

test("the six GENIE panels ride the request with their real inches", () => {
  const b = body();
  assert.equal(b.panels.length, 6);
  const driver = b.panels.find((p) => p.label === "DRIVER SIDE");
  assert.equal(driver.widthInches, 153);
  assert.equal(driver.heightInches, 56);
  const labels = b.panels.map((p) => p.label).sort();
  assert.deepEqual(labels, ["DRIVER SIDE", "FRONT", "HOOD", "PASSENGER SIDE", "REAR", "ROOF"]);
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

test("corrective notes and inputs ride only through extras", () => {
  const b = body(BASE_INPUT, {
    guideStoragePath: "atlas-call1-inputs/abc.png",
    structuralReferenceStoragePath: "atlas-call1-inputs/def.jpg",
    structuralReferenceMime: "image/jpeg",
    correctiveNote: "CORRECTION -- refused",
    referenceImagesBase64: ["YmF6"],
  });
  // The two large inputs travel as STORAGE PATHS — a 2.2MB inline-base64 body
  // killed the edge worker twice (2026-08-27).
  assert.equal(b.guideStoragePath, "atlas-call1-inputs/abc.png");
  assert.equal(b.structuralReferenceStoragePath, "atlas-call1-inputs/def.jpg");
  assert.equal(b.correctiveNote, "CORRECTION -- refused");
  assert.deepEqual(b.referenceImagesBase64, ["YmF6"]);
  // And no inline blob field survives on the request.
  assert.equal(b.guideImageBase64, undefined);
  assert.equal(b.structuralReferenceBase64, undefined);
});
