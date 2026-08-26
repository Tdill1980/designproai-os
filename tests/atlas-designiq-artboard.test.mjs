import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  COMMERCIAL_AUTHORING_PERSONA,
  COMMERCIAL_BRAND_COMPOSITION,
  COMMERCIAL_DEPTH,
  DESIGNPANEL_AUTHORING_MODEL,
  COMMERCIAL_TRANSLATION,
  LOGO_REQUIREMENT,
  PHOTO_REALISM_LOCK,
  buildAtlasArtboardDesignIQDirection,
  buildFlatDesignIQDirection,
} = require("../runtime/designiq-prompt.cjs");
const {
  PROMPT_VERSION,
  PROOF_DEPENDENCIES,
  PROOF_VIEWS,
  buildAtlasManifest,
} = require("../runtime/flat-first-atlas.cjs");

const edgeSource = readFileSync(
  new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url),
  "utf8",
);

test("Atlas reuses the DesignPanelAI artboard quality contract with its guide as topology authority", () => {
  const prompt = buildAtlasArtboardDesignIQDirection({
    brief: "Angular navy and silver fleet graphics",
    companyName: "Northstar Electric",
    finish: "Satin",
    vehicle: { year: "2025", make: "Ford", model: "Transit" },
  });

  const sourceParityPhrases = [
    // The opening sentence is now the reference's COMMERCIAL authoring persona,
    // not its artboard branch's. Under RULE 0.20 this call is the design origin
    // rather than a projection of one, so it takes the designer's framing --
    // approved 2026-08-25 and pinned byte-for-byte to the vendored source in
    // the persona parity test below.
    COMMERCIAL_AUTHORING_PERSONA,
    "The output is flat print artwork on a 2D sheet.",
    "the SAME cohesive design",
    "Gallery-grade custom artwork with real depth, movement, and a wow factor — never generic AI filler, never a template.",
    "Output ONE flat 2D artboard sheet",
  ];
  for (const phrase of sourceParityPhrases) {
    assert.match(edgeSource, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
    assert.match(prompt, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }

  assert.match(prompt, /FIRST attached deterministic A\.T\.L\.A\.S\. guide is the sole authority/);
  assert.match(prompt, /Fill every supplied exterior-panel zone edge-to-edge/);
  assert.match(prompt, /FINISH LOCK: SATIN — SATIN/);
  assert.doesNotMatch(prompt, /bare factory bedliner/);
});

// THE FLAT CALL IS TOLD ABOUT THE SHEET. THE 3D CALLS ARE TOLD ABOUT THE
// VEHICLE.
//
// This used to assert the opposite of its last four lines: that the A.T.L.A.S.
// master prompt carried "downstream 3D proof projection only", "windows, glass,
// lights, wheels and trim stay factory", truckBedClause()'s bare-bedliner
// sentence, and a restatement of its bed half. Three sentences describing a
// VEHICLE, handed to the one call that draws no vehicle.
//
// They were not merely inert. They contradicted the sentence directly above
// them, which is asserted here and is the whole point of RULE 0.15: paint the
// livery straight THROUGH every window, wheel arch, lamp and bed opening,
// because the installer cuts them out of the printed vinyl afterwards. A flat
// atlas has no window, lamp or bed-interior ZONE for the removed sentences to
// describe — the six zones are driver, passenger, hood, roof, front and rear,
// and every one of them is a solid rectangle.
//
// Nothing downstream lost the rule, which is what the second half of this test
// now proves: buildDesignIQPrompt and buildRestylePrompt — the builders that
// actually render a vehicle — each still carry the factory-glass line and call
// truckBedClause() themselves, so Calls 2-7 are unchanged.
test("the flat master call is told to paint through openings, and only the 3D builders are told about factory glass", () => {
  const input = {
    brief: "A true-to-life photographic pool and patio scene",
    companyName: "Flamingo Pools",
    finish: "Gloss",
    vehicle: { year: "2024", make: "Ford", model: "F250", type: "Crew Cab" },
  };
  const prompt = buildAtlasArtboardDesignIQDirection(input);

  assert.match(prompt, /2024 Ford F-250 Crew Cab/);
  assert.match(prompt, /master stays FULL-BLEED inside every supplied exterior-panel zone/);
  // Positive framing, not a negation: Gemini over-indexes on negated words, so
  // the rule that keeps wheels filled in is stated as what to paint.
  assert.match(prompt, /Paint the livery continuously THROUGH every place a window, glass panel, pickup-bed opening, wheel, wheel arch, lamp or trim piece will later sit/);
  assert.match(prompt, /the installer cuts them out of the printed vinyl afterwards/);
  assert.match(prompt, /Keep essential logos, lettering and contact copy anchored to solid painted body area rather than to an opening/);
  assert.doesNotMatch(prompt, /punch out/i);

  // The vehicle-coverage half must be gone from the FLAT call.
  assert.doesNotMatch(prompt, /downstream 3D proof projection/);
  assert.doesNotMatch(prompt, /lights, wheels and trim stay factory/);
  assert.doesNotMatch(prompt, /bare factory bedliner/);
  assert.doesNotMatch(prompt, /open bed interior/);

  assert.match(prompt, new RegExp(PHOTO_REALISM_LOCK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(buildFlatDesignIQDirection(input), prompt, "the shipped compatibility API must use the same builder");

  // …and must still reach the calls that render the vehicle, unchanged.
  const { buildDesignIQPrompt } = require("../runtime/designiq-prompt.cjs");
  const vehicleFields = {
    viewType: "side", vehicleYear: "2024", vehicleMake: "Ford", vehicleModel: "F250 Crew Cab",
  };
  for (const [name, proof] of Object.entries({
    commercial: buildDesignIQPrompt({
      prompt: input.brief, mode: "commercial", companyName: input.companyName, ...vehicleFields,
    }),
    restyle: buildDesignIQPrompt({ prompt: input.brief, mode: "restyle", ...vehicleFields }),
  })) {
    assert.match(proof, /Windows, lights, wheels, and trim stay factory/, `${name} keeps the factory-glass rule`);
    assert.match(proof, /bare factory bedliner/, `${name} keeps the open-bed rule`);
  }
});

// THE QUALITY BAR MAY NOT CITE ATTACHMENTS THAT ARE NOT IN THE REQUEST.
//
// The closing line said "Match the production quality of the provided
// gold-standard DesignPanel artboards" on every brief. On the live droplet,
// 2026-08-26, loadDesignPanelArtboardExamples returned ZERO — the bucket the
// reference reads them from is not populated on this project, and it fails soft
// by design. So the one sentence that sets the sheet's quality bar pointed at
// images that were never sent, on every run.
//
// The bar is still stated when there is nothing to cite; only the dangling
// reference goes.
test("the gold-standard quality bar follows the attachments", () => {
  const input = {
    brief: "Bold commercial HVAC wrap, deep blue with sunrise-orange airflow ribbons",
    mode: "commercial",
    vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab" },
  };
  const withExamples = buildAtlasArtboardDesignIQDirection(input, { artboardQualityExampleCount: 2 });
  const without = buildAtlasArtboardDesignIQDirection(input);

  assert.match(withExamples, /Match the production quality of the provided gold-standard DesignPanel artboards/);
  assert.doesNotMatch(without, /gold-standard DesignPanel artboards/);
  assert.doesNotMatch(without, /provided/);

  for (const prompt of [withExamples, without]) {
    assert.match(prompt, /Gallery-grade custom artwork with real depth, movement, and a wow factor/);
    assert.match(prompt, /deterministic A\.T\.L\.A\.S\. guide alone controls this sheet's topology/);
    assert.match(prompt, /Output ONE flat 2D artboard sheet/);
  }
  assert.equal(
    buildFlatDesignIQDirection(input, { artboardQualityExampleCount: 2 }),
    withExamples,
    "the compatibility API must pass the options through",
  );
});

// THE AUTHORING CALL PINS ITS MODEL BY NAME, LIKE THE AUTHORITY DOES.
//
// design-panel-ai-generate builds one model id into its endpoint and carries no
// fallback (index.ts:1320). Call 1 passed `lockModel: true`, which pins the
// FIRST of whatever GOOGLE_IMAGE_MODEL configures — on the droplet, the GA id.
//
// Measured 2026-08-26, the SAME assembled request and key sent to both ids: the
// GA id returned a three-quarter van in three views with mirrored roof
// lettering and no relationship to the deterministic guide; the authority's
// -preview id returned the guide's six-zone layout with forward-reading text on
// both flanks. "The first configured model" is not a pin.
test("Call 1 authors on the authority's model, by name and not by position", () => {
  assert.equal(DESIGNPANEL_AUTHORING_MODEL, "gemini-3-pro-image-preview");
  assert.ok(
    edgeSource.includes(`models/${DESIGNPANEL_AUTHORING_MODEL}:generateContent`),
    "the reference must still build this exact model id into its endpoint",
  );
  const atlasSource = readFileSync(new URL("../runtime/flat-first-atlas.cjs", import.meta.url), "utf8");
  assert.match(
    atlasSource,
    /model: DESIGNPANEL_AUTHORING_MODEL,\s*\n\s*lockModel: true,/,
    "the master authoring call must name its model and keep the no-fallback contract",
  );
});

// THE BRANDING LAYOUT IS THE DESIGNER'S CALL, AND THE REFERENCE SAYS SO.
//
// design-panel-ai-generate's commercial scene sentence ends on this literal
// (index.ts:475, and again in its wantsPhoto twin). It is the only place in the
// reference that hands the branding LAYOUT decision back to the designer: it
// states the one hard requirement — the name reads at a glance — and then
// explicitly declines to say where the name goes, how big it is, or what sits
// beside it.
//
// It did not survive the port. The A.T.L.A.S. branch replaced the whole scene
// sentence with "Design ONE flat vehicle-wrap ARTBOARD for a <vehicle>", which
// is a format instruction, and nothing took over the half that was creative
// direction — so the call that authors the design was told the output shape,
// the topology, the zone geometry and every contact-field lock, and was never
// told that composing the identity is its own call to make.
//
// Asserted against the vendored reference AND the generated prompt, like every
// other creative literal in this file, so neither copy can drift alone.
test("Atlas keeps the reference's branding-composition freedom", () => {
  const prompt = buildAtlasArtboardDesignIQDirection({
    brief: "Bold commercial HVAC wrap, deep blue with sunrise-orange airflow ribbons",
    mode: "commercial",
    vehicle: { year: "2022", make: "Ford", model: "F250 Crew Cab" },
  });

  assert.equal(
    COMMERCIAL_BRAND_COMPOSITION,
    "The company name reads clearly at a glance; how the branding is composed is your creative call.",
  );
  assert.ok(
    edgeSource.includes(COMMERCIAL_BRAND_COMPOSITION),
    "the reference must still carry the branding-composition sentence",
  );
  assert.ok(
    prompt.includes(COMMERCIAL_BRAND_COMPOSITION),
    "Atlas must hand the branding layout decision back to the designer",
  );
  // It belongs to the commercial register, exactly as it does in the reference:
  // the restyle scene sentence there has no equivalent.
  assert.ok(
    !buildAtlasArtboardDesignIQDirection({
      brief: "distressed martini livery", mode: "restyle",
      vehicle: { make: "Porsche", model: "911" },
    }).includes(COMMERCIAL_BRAND_COMPOSITION),
    "restyle must not acquire a commercial branding instruction",
  );
});

test("Atlas exact-reference mode remains reproduction-only", () => {
  const prompt = buildAtlasArtboardDesignIQDirection({
    brief: "Use the approved livery",
    vehicle: { make: "GMC", model: "Sierra" },
    visionBoardImages: [{ storagePath: "verified/reference.png" }],
    visionboardIntent: "exact_reference",
  });

  assert.match(prompt, /Do not redesign, restyle, recolor, simplify, correct, or invent/);
  assert.match(prompt, /verified customer reference images .* are the artwork authority/i);
  assert.doesNotMatch(prompt, /DESIGN AMPLIFICATION/);
});

test("Atlas freezes Close-Up as proof seven without reintroducing a hero view", () => {
  const surfaces = ["driver", "passenger", "hood", "roof", "front", "rear"]
    .map((surfaceKey) => ({
      surfaceKey,
      widthInches: ["driver", "passenger"].includes(surfaceKey) ? 240 : 72,
      heightInches: ["driver", "passenger"].includes(surfaceKey) ? 72 : 60,
    }));
  const manifest = buildAtlasManifest(surfaces);

  assert.equal(PROMPT_VERSION, "designpro-flat-first-atlas-20260826.v8");
  assert.deepEqual(PROOF_VIEWS, [
    "side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof",
  ]);
  assert.deepEqual(manifest.proofViews, PROOF_VIEWS);
  assert.deepEqual(manifest.proofOnlyViews, ["close-up"]);
  assert.match(JSON.stringify(PROOF_DEPENDENCIES), /close-up/);
  assert.doesNotMatch(JSON.stringify({ manifest, dependencies: PROOF_DEPENDENCIES }), /hero-3d/);
});

// THE CREATIVE HALF IS HELD TO THE SAME SOURCE PARITY AS THE QUALITY CONTRACT.
//
// A.T.L.A.S. topology is protected and is NOT what these assert. They cover the
// branding/logo/mascot intelligence that the port had quietly weakened while
// the topology half stayed correct - the regression that made a commercial
// sheet come back with set type and a template-grade mark instead of a designed
// identity. Each phrase is asserted against the vendored reference AND the
// generated prompt, so neither copy can drift alone.
test("Atlas keeps the proven branding, logo and mascot creative intelligence", () => {
  const prompt = buildAtlasArtboardDesignIQDirection({
    brief: "Rugged mountain graphics for a roofing fleet",
    companyName: "Ridgeline Roofing",
    phone: "555-0142",
    mascot: "a granite ram",
    finish: "Gloss",
    vehicle: { year: "2024", make: "Ford", model: "Transit" },
  });

  // The BRAND line is a DESIGN instruction, not a spelling lock. Losing it is
  // what left the master call with nothing asking for a composed identity.
  const brandComposition =
    "integrate the company name + logo + a clean contact bar into the design, legible at a glance";
  assert.ok(edgeSource.includes(brandComposition), "the reference must still carry the BRAND composition line");
  assert.ok(prompt.includes(brandComposition), "Atlas must ask for a composed brand identity, not just correct spelling");

  // ONE literal, shared by both producers, matching the reference exactly. The
  // port had re-added a form prescription and a negative here; both are the
  // wording the reference deleted after logos converged on one look.
  assert.equal(
    LOGO_REQUIREMENT,
    "This business needs its own logo — decide its form from this brief alone.",
  );
  assert.ok(edgeSource.includes(LOGO_REQUIREMENT), "the logo requirement must stay identical to the reference");
  assert.ok(prompt.includes(LOGO_REQUIREMENT));
  assert.doesNotMatch(prompt, /must not look like a generic template mark/);
  assert.doesNotMatch(prompt, /professionally art-directed and distinctive/);

  // A mascot is a logo, and the master call is the only call that draws it.
  for (const phrase of [
    "premium mascot logo in the spirit of a pro sports or esports emblem",
    "clean bold shapes, a dynamic heroic pose, confident personality, on-brand colors, instantly readable at a glance",
    "bespoke illustration a top studio would charge for",
  ]) {
    assert.ok(edgeSource.includes(phrase), `the reference must still carry: ${phrase}`);
    assert.ok(prompt.includes(phrase), `Atlas must carry the proven mascot craft bar: ${phrase}`);
  }
  // Placement is A.T.L.A.S. zone topology and is not this file's to direct.
  assert.doesNotMatch(prompt, /rear quarter panel, sized to complement/);

  // The spelling instruction appeared twice in a row before this. Duplication
  // carries no creative value and dilutes the sentence that does.
  assert.equal(prompt.match(/[Ss]pell (?:it|the business name) exactly/g)?.length, 1);
});

// THE NO-INVENT CONTACT RULE IS UNCONDITIONAL, IN BOTH BUILDERS.
//
// It was gated on `!phone && !website`, so a brief that supplied a website but
// no phone reached the model with nothing forbidding an invented number — while
// the proof judge is handed "Exact phone: none supplied" and rejects any number
// it sees. Nothing forbade it and the judge refused it, so the run could not
// converge and simply burned every attempt.
//
// Live proof, generation 2c0fc9f4 (2026-08-24 21:18, a dental brief with a
// website and no phone): four `side` attempts, every one carrying the same
// invented 602-555-0184, every one rejected on customerTextPass, then
// provider_attempts_exhausted. No control guard may decide whether this rule
// ships.
test("The contact no-invent rule reaches the model on every brief shape", () => {
  const { buildDesignIQPrompt } = require("../runtime/designiq-prompt.cjs");
  const PHONE_GUARD = /do NOT invent, fabricate, or display any phone number|invent no phone number/;
  const WEBSITE_GUARD = /invent no website/;

  const shapes = [
    { label: "website only (the shape that failed live)", website: "www.DesertBloomDental.com" },
    { label: "phone only", phone: "602-555-0184" },
    { label: "both supplied", phone: "602-555-0184", website: "www.DesertBloomDental.com" },
    { label: "neither supplied" },
  ];

  for (const shape of shapes) {
    const { label, ...contact } = shape;
    const atlas = buildAtlasArtboardDesignIQDirection({
      brief: "Bright modern dental wrap",
      mode: "commercial",
      companyName: "Desert Bloom Dental",
      vehicle: { make: "Ford", model: "Transit" },
      ...contact,
    });
    const standard = buildDesignIQPrompt({
      prompt: "Bright modern dental wrap",
      mode: "commercial",
      companyName: "Desert Bloom Dental",
      viewType: "side",
      vehicleMake: "Ford",
      vehicleModel: "Transit",
      ...contact,
    });

    // Paired per field: a missing field always gets its own guard, and no other
    // field's presence can suppress it.
    if (!contact.phone) {
      assert.match(atlas, PHONE_GUARD, `Atlas must forbid inventing a phone: ${label}`);
      assert.match(standard, PHONE_GUARD, `The commercial builder must forbid inventing a phone: ${label}`);
    }
    if (!contact.website) {
      assert.match(atlas, WEBSITE_GUARD, `Atlas must forbid inventing a website: ${label}`);
      assert.match(standard, WEBSITE_GUARD, `The commercial builder must forbid inventing a website: ${label}`);
    }

    // A supplied value is still stated exactly; the rule closes the set, it
    // never suppresses a contact the customer actually gave.
    if (contact.phone) {
      assert.ok(atlas.includes(contact.phone), `Atlas must still state the supplied phone: ${label}`);
      assert.ok(standard.includes(contact.phone), `The commercial builder must still state the supplied phone: ${label}`);
    }
    if (contact.website) {
      assert.ok(atlas.includes(contact.website), `Atlas must still state the supplied website: ${label}`);
      assert.ok(standard.includes(contact.website), `The commercial builder must still state the supplied website: ${label}`);
    }
  }
});

// THE AUTHORING PERSONA IS PINNED TO THE PROVEN COMMERCIAL SOURCE.
//
// The A.T.L.A.S. branch opened with the reference's ARTBOARD persona -- "You are
// a Custom Vehicle Wrap Designer at WePrintWraps.com." -- which was right in the
// architecture it came from, where the artboard was a PROJECTION of a design the
// commercial branch had already authored. Under RULE 0.20 Call 1 IS the design
// origin, so it was doing the designer's job with the projection helper's
// framing, and the sentence that sets the standard for the work was the one that
// did not travel.
//
// Live evidence 2026-08-25, generation 02e83eb3 (Pro-Tech Automotive): master QC
// confidence 1.0, 7/7 proofs, 6 panels -- and generic template-feeling work with
// no brand system beyond a centred wordmark and a phone number.
//
// This asserts parity against the vendored source itself rather than a copy of
// the string, so the two cannot drift: if the reference is ever re-ported, this
// fails until the runtime follows it.
test("the A.T.L.A.S. authoring persona is the proven commercial designer, byte for byte", () => {
  const reference = readFileSync(
    new URL("../supabase/functions/design-panel-ai-generate/index.ts", import.meta.url),
    "utf8",
  );
  assert.ok(
    reference.includes(COMMERCIAL_AUTHORING_PERSONA),
    "the persona must exist verbatim in design-panel-ai-generate/index.ts",
  );
  assert.match(COMMERCIAL_AUTHORING_PERSONA, /senior graphic designer at a sign and wrap company/);
  assert.match(COMMERCIAL_AUTHORING_PERSONA, /20 years of \$5,000-per-vehicle commercial fleet graphics/);
  assert.match(COMMERCIAL_AUTHORING_PERSONA, /readable at a glance from across a parking lot/);

  const atlas = buildAtlasArtboardDesignIQDirection({
    brief: "masculine wrap for an automotive business",
    companyName: "Pro-Tech Automotive",
    mode: "commercial",
  });
  assert.ok(
    atlas.startsWith(COMMERCIAL_AUTHORING_PERSONA),
    "the design call must OPEN with the designer persona, not carry it later",
  );
  assert.equal(
    atlas.includes("You are a Custom Vehicle Wrap Designer at WePrintWraps.com."),
    false,
    "the projection-helper persona must not remain on the authoring path",
  );

  // Parity restoration only. Nothing was invented for typography, negative
  // space, focal point or colour strategy, because the proven source carries no
  // such block to restore -- inventing one is what RULE 0.1 forbids.
  for (const invented of [
    /negative space/i, /focal point/i, /kerning/i, /leading/i,
    /colou?r strategy/i, /rule of thirds/i, /golden ratio/i,
  ]) {
    assert.doesNotMatch(atlas, invented, `no invented creative direction: ${invented}`);
  }

  // The blocks that were already at parity stay exactly as they were. The
  // reference is TypeScript source, so its literals carry escaped quotes
  // (\"stealth bomber\") that the runtime value does not -- unescape before
  // comparing, or a correct block reads as drifted purely on backslashes.
  const referenceText = reference.replace(/\\"/g, '"');
  for (const [name, proven] of Object.entries({
    LOGO_REQUIREMENT, COMMERCIAL_DEPTH, COMMERCIAL_TRANSLATION,
  })) {
    assert.ok(referenceText.includes(proven), `${name} drifted from the reference`);
  }
});
