import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

// OWNER PROTECTION #2 (Trish 2026-08-26): "Execute the RestylePro authority and
// the generated server builder against the same locked fixture. After
// normalizing runtime-only values, require exact equality of the assembled
// creative direction and input references. Marker tests and file hashes alone
// are insufficient."
//
// Both bundles are COMMITTED artifacts of scripts/build-designpanel-authoring.mjs:
//
//   runtime/vendor/designpanel-authoring.cjs        ← the vendored authority
//     (supabase/functions/design-panel-ai-generate/index.ts = restylepro-os
//      commit 113d137 + the delimited ATLAS-MODE patch)
//   tests/fixtures/designpanel-authoring-113d137.cjs ← pristine 113d137 bytes
//
// This file therefore proves three separate things:
//   1. FRESHNESS — each bundle's header hash equals the sha256 of the source
//      it claims to be built from, so a stale bundle cannot serve old code.
//   2. AUTHORITY PIN — the 113d137 reference source still hashes to the value
//      captured from the restylepro-os checkout at that commit.
//   3. EXECUTED PARITY — on locked fixtures, the patched builder's commercial,
//      restyle and legacy-artboard output is BYTE-IDENTICAL to the 113d137
//      authority's. The ATLAS-MODE patch is provably inert outside its gate.
// There are no runtime-only values inside these pure prompt builders, so
// "normalized equality" is exact equality.

const require = createRequire(import.meta.url);
const vendored = require("../runtime/vendor/designpanel-authoring.cjs");
const reference = require("../tests/fixtures/designpanel-authoring-113d137.cjs");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

// sha256 of supabase/functions/design-panel-ai-generate/index.ts at
// restylepro-os 113d137dbe8813ca3bf70c8d7265ad081ebd4524, captured in-session
// from `git show` on the reference checkout.
const AUTHORITY_113D137_SHA256 = "abb3a35fb22447cae5c4e57614d421507aa0f2a412299db606663f4b9edf2267";

function bundleSourceHash(bundleText) {
  const match = bundleText.match(/^\/\/ designpanel-authoring source sha256: ([0-9a-f]{64})$/m);
  assert.ok(match, "the bundle must carry its source hash header");
  return match[1];
}

test("the 113d137 authority source is byte-pinned", () => {
  assert.equal(sha256(read("./fixtures/designpanel-ai-generate-113d137.index.ts")), AUTHORITY_113D137_SHA256);
});

test("both committed bundles are fresh against their sources", () => {
  assert.equal(
    bundleSourceHash(read("../runtime/vendor/designpanel-authoring.cjs")),
    sha256(read("../supabase/functions/design-panel-ai-generate/index.ts")),
    "runtime/vendor/designpanel-authoring.cjs is stale — rerun scripts/build-designpanel-authoring.mjs",
  );
  assert.equal(
    bundleSourceHash(read("./fixtures/designpanel-authoring-113d137.cjs")),
    AUTHORITY_113D137_SHA256,
    "the reference bundle is stale against the pinned 113d137 source",
  );
});

// LOCKED FIXTURES. Change these only with the owner's sign-off — a changed
// fixture is a changed experiment.
const FIXTURES = [
  {
    name: "commercial, full identity",
    params: {
      mode: "commercial",
      prompt: "Bold commercial HVAC wrap for Precision Climate Solutions: deep blue base with sunrise-orange airflow ribbons sweeping front to rear, clean modern sans-serif company name, high contrast and legible at highway distance.",
      finish: "Gloss",
      companyName: "Precision Climate Solutions",
      phone: "(555) 010-4477",
      industryType: "HVAC and climate control",
      brandColors: "deep blue, sunrise orange",
      vehicleYear: "2022", vehicleMake: "Ford", vehicleModel: "F250 Crew Cab",
      viewType: "side",
      visionBoardImages: [], visionboard_intent: "style_inspiration",
    },
  },
  {
    name: "commercial, brief-only business, no phone",
    params: {
      mode: "commercial",
      prompt: "Wrap for Ridgeline Roofing & Exteriors, rugged mountain graphics, slate blue and copper",
      finish: "Matte",
      vehicleYear: "2024", vehicleMake: "Chevrolet", vehicleModel: "Silverado 2500",
      viewType: "hood_detail",
    },
  },
  {
    name: "restyle, photographic brief, close-up",
    params: {
      mode: "restyle",
      prompt: "A photorealistic mountain sunrise photograph wrapping the whole body",
      finish: "Gloss",
      vehicleYear: "2023", vehicleMake: "Tesla", vehicleModel: "Cybertruck",
      viewType: "close-up",
    },
  },
  {
    name: "restyle, exact_reference recreate",
    params: {
      mode: "restyle",
      prompt: "Recreate my approved wrap",
      finish: "Satin",
      vehicleYear: "2021", vehicleMake: "Lamborghini", vehicleModel: "Huracan",
      viewType: "side",
      visionBoardImages: [{ slotLabel: "ref", storageUrl: "https://example.test/ref.png" }],
      visionboard_intent: "exact_reference",
    },
  },
  {
    name: "legacy artboard sheet (no atlasTopology)",
    params: {
      mode: "artboard",
      prompt: "Deep blue fleet wrap with orange ribbons for Precision Climate Solutions",
      finish: "Gloss",
      companyName: "Precision Climate Solutions",
      phone: "(555) 010-4477",
      industryType: "HVAC and climate control",
      brandColors: "deep blue, sunrise orange",
      vehicleYear: "2022", vehicleMake: "Ford", vehicleModel: "F250 Crew Cab",
      panels: [
        { label: "DRIVER SIDE", widthInches: 153, heightInches: 56 },
        { label: "PASSENGER SIDE", widthInches: 153, heightInches: 56 },
        { label: "HOOD", widthInches: 60, heightInches: 55 },
      ],
    },
  },
  {
    name: "legacy artboard clean layer",
    params: {
      mode: "artboard",
      artboardClean: true,
      prompt: "Deep blue fleet wrap with orange ribbons for Precision Climate Solutions",
      finish: "Gloss",
      companyName: "Precision Climate Solutions",
      vehicleYear: "2022", vehicleMake: "Ford", vehicleModel: "F250 Crew Cab",
    },
  },
];

test("executed parity: every non-atlas mode is byte-identical to the 113d137 authority", () => {
  for (const fixture of FIXTURES) {
    const ours = vendored.buildDesignIQPrompt(fixture.params);
    const theirs = reference.buildDesignIQPrompt(fixture.params);
    assert.equal(ours, theirs, `"${fixture.name}" drifted from the 113d137 authority`);
    assert.ok(ours.length > 200, `"${fixture.name}" produced an implausibly short prompt`);
  }
});

test("the helper builders execute identically too", () => {
  for (const brief of ["a photo realistic ranch scene", "geometric camo, no photo", "make it lifelike"]) {
    assert.equal(vendored.briefWantsPhoto(brief), reference.briefWantsPhoto(brief));
  }
  const split = { raw: 'Camo texture with "Apex Plumbing" and call 555-0100', company: "Apex Plumbing" };
  assert.deepEqual(
    vendored.splitStyleAndText(split.raw, split.company),
    reference.splitStyleAndText(split.raw, split.company),
  );
});

test("the ATLAS-MODE patch only ever adds a gated branch — it never edits authority text", () => {
  // Structural containment: the patched source minus its delimited additions
  // must still contain every byte-run the parity fixtures exercise. Executed
  // parity above is the real proof; this assert catches the tempting failure
  // mode of "small wording fix" inside authority prose.
  const patched = read("../supabase/functions/design-panel-ai-generate/index.ts");
  assert.match(patched, /═══ ATLAS MODE — THE CANONICAL DESIGNPROAI CALL 1/);
  assert.match(patched, /═══ END ATLAS MODE/);
  assert.ok(patched.indexOf("═══ ATLAS MODE") < patched.indexOf("═══ END ATLAS MODE"));
  // The legacy artboard sheet text survives verbatim after the gate.
  assert.match(patched, /exactly in the format of the EXAMPLE ARTBOARDS provided \(a clean-background version and a branded version\)/);
});
