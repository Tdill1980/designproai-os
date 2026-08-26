import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const atlas = require("../runtime/flat-first-atlas.cjs");
const {
  COMMERCIAL_AUTHORING_PERSONA, LOGO_REQUIREMENT, LOGO_AUTHORING_RULE, logoCondition,
} = require("../runtime/designiq-prompt.cjs");

const SURFACES = ["driver", "passenger", "hood", "roof", "front", "rear"].map((surfaceKey) => ({
  surfaceKey, widthInches: 100, heightInches: 60, surfaceSqFt: 41,
  bleed: { top: 5, right: 5, bottom: 5, left: 5 },
}));
const manifest = atlas.buildAtlasManifest(SURFACES);
const VEHICLE = { year: "2022", make: "Ford", model: "F250 Crew Cab", type: "truck" };
const authored = (input) => atlas._test.atlasPrompt({ vehicle: VEHICLE, finish: "Gloss", ...input }, manifest, {});

// THE LOGO CONDITION IS DECIDED BY THE INPUT.
//
// Owner persona contract: a business brief with no usable logo must AUTO-CREATE
// a professional mark; with one supplied, that logo is the authority. The
// branch may never be decided by prose, wording or luck — it is a function of
// the input, so it is asserted as one.
test("the logo condition is a function of the input, not of the prose", () => {
  assert.equal(logoCondition({ mode: "commercial" }), "auto");
  assert.equal(logoCondition({ mode: "commercial", companyName: "Acme" }), "auto");
  assert.equal(logoCondition({ mode: "commercial", logoAsset: { path: "l.png" } }), "supplied");
  assert.equal(logoCondition({ mode: "restyle" }), "none");
  assert.equal(logoCondition({ mode: "restyle", logoAsset: { path: "l.png" } }), "supplied");
});

// A BUSINESS BRIEF WITH NO LOGO GETS A DESIGNED MARK, NOT SET TYPE.
//
// Requiring that a logo EXIST does not rule out the degenerate way to satisfy
// it, and the reference's own history is the evidence: live 2026-08-03,
// Ridgeline Roofing & Exteriors came back with "company name set in a typeface,
// no logo mark anywhere on the vehicle". Both shapes of commercial brief are
// covered — the company name as a FIELD, and the company name only in the
// free-text brief — because 3 of the 11 real A.T.L.A.S. runs sent no
// companyName field at all.
test("a business brief with no supplied logo is told to design a real mark", () => {
  for (const input of [
    { mode: "commercial", brief: "Wrap for Harbor Point Electric", companyName: "Harbor Point Electric" },
    { mode: "commercial", brief: "Wrap for Harbor Point Electric, licensed contractor" },
  ]) {
    const prompt = authored(input);
    assert.ok(prompt.includes(LOGO_REQUIREMENT), "the reference's own logo requirement must fire");
    assert.ok(prompt.includes(LOGO_AUTHORING_RULE), "and the degenerate outcome must be refused");
    assert.match(prompt, /set in a typeface is not a logo/);
  }
});

// NO FORM IS PRESCRIBED, DELIBERATELY.
//
// Every version of this instruction that named a form converged — the reference
// deleted them all for that reason. The rule names the degenerate OUTCOME and
// hands the form back to the brief, which is the only input that varies between
// customers. If a later edit reintroduces a form or a menu of them, this fails.
test("the mark's form is left to the designer and the brief", () => {
  const prompt = authored({ mode: "commercial", brief: "Wrap for Acme Plumbing", companyName: "Acme Plumbing" });
  assert.match(prompt, /form, register and construction are your call/);
  for (const prescription of [/distinctive lettering/i, /monogram/i, /pictorial/i, /badge or/i, /emblem, crest/i]) {
    assert.doesNotMatch(prompt, prescription, `a form prescription reappeared: ${prescription}`);
  }
});

// A SUPPLIED LOGO IS THE AUTHORITY, AND SUPPRESSES THE AUTO-CREATE DEMAND.
test("a supplied logo is used faithfully and never asked to be redesigned", () => {
  const prompt = authored({
    mode: "commercial", brief: "Wrap for Harbor Point Electric",
    companyName: "Harbor Point Electric", logoAsset: { path: "logo.png" },
  });
  assert.match(prompt, /logo authority; preserve its form, spelling, proportions and palette exactly/);
  assert.ok(!prompt.includes(LOGO_AUTHORING_RULE), "do not also demand an invented mark");
  assert.ok(!prompt.includes(LOGO_REQUIREMENT), "do not also demand an invented mark");
});

// A RESTYLE BRIEF IS NOT A BUSINESS AND GETS NO LOGO DEMAND.
test("a non-commercial brief carries no logo demand at all", () => {
  const prompt = authored({ mode: "restyle", brief: "Distressed Martini racing livery" });
  assert.ok(!prompt.includes(LOGO_REQUIREMENT));
  assert.ok(!prompt.includes(LOGO_AUTHORING_RULE));
});

// THE PROFESSIONAL PERSONA ALWAYS FIRES.
//
// Owner contract: it must fire on every DesignProAI authoring call, not only
// when optional reference or style inputs happen to be populated. The bare
// brief is the case that matters — 0 of 11 real runs sent a reference image.
test("the professional designer persona and its elevation fire on every brief shape", () => {
  const shapes = [
    { mode: "commercial", brief: "Wrap for Acme Plumbing" },
    { mode: "commercial", brief: "Wrap for Acme", companyName: "Acme", industry: "Plumbing", phone: "555-0100" },
    { mode: "restyle", brief: "Distressed Martini racing livery" },
    { mode: "restyle", brief: "Sunset over a mountain lake, photographic" },
  ];
  for (const input of shapes) {
    const prompt = authored(input);
    assert.ok(prompt.includes(COMMERCIAL_AUTHORING_PERSONA), "the persona is not optional");
    // Elevation and depth, in whichever branch's words: commercial states them
    // as COMMERCIAL_DEPTH, restyle as DESIGN AMPLIFICATION. Both must promise
    // layered depth and texture rather than a flat generated background.
    assert.match(prompt, /layered elements|layered thematic elements/, "layered depth must be required");
    assert.match(prompt, /texture/, "texture must be required");
    assert.match(prompt, /amplif|elevat/i, "the brief must be elevated, not restated");
  }
});

// VISIONBOARDIQ IS PART OF THE PIPELINE, AND IT PRODUCES SOMETHING.
//
// The runtime consumed `styleDescriptors` in four places and produced it in
// none — across all 11 real A.T.L.A.S. runs it was populated on zero, so the
// STYLE INSPIRATION branch could never fire. The reference's pre-pass
// (design-panel-ai-generate/index.ts:661) is now ported; the six categories are
// verbatim and only the transport is adapted to the runtime's key pool.
test("VisionBoardIQ derives style DNA from the supplied references", async () => {
  const { analyzeVisionBoardStyles, ANALYSIS_PROMPT } = await import("../runtime/visionboard-iq.cjs")
    .then((m) => m.default ?? m);

  let sawImages = 0;
  let sawPrompt = "";
  const provider = {
    async generateSpecification({ parts }) {
      sawPrompt = parts.find((part) => part.text)?.text || "";
      sawImages = parts.filter((part) => part?.inlineData?.data).length;
      return {
        specification: {
          colorPalette: "#0d2f63, #e8621f", artStyle: "abstract geometric", mood: "confident",
          composition: "diagonal flow", texture: "smooth gradients", visualWeight: "bottom-anchored",
        },
      };
    },
  };
  const referenceParts = [
    { text: "VERIFIED CUSTOMER-OWNED STYLE REFERENCE. Reference 1 of 2." },
    { inlineData: { mimeType: "image/png", data: "AAAA" } },
    { text: "VERIFIED CUSTOMER-OWNED STYLE REFERENCE. Reference 2 of 2." },
    { inlineData: { mimeType: "image/png", data: "BBBB" } },
  ];
  const dna = await analyzeVisionBoardStyles({ provider, referenceParts });

  assert.equal(sawImages, 2, "every reference image must reach the pre-pass");
  assert.equal(sawPrompt, ANALYSIS_PROMPT, "the reference's own analysis prompt, verbatim");
  for (const label of ["COLOR PALETTE", "ART STYLE", "MOOD", "COMPOSITION", "TEXTURE", "VISUAL WEIGHT"]) {
    assert.match(dna, new RegExp(`^${label}: `, "m"), `${label} must survive into the style DNA`);
  }
});

// IT FAILS SOFT. A REFERENCE PRE-PASS IS NEVER A PRECONDITION FOR DESIGNING.
test("VisionBoardIQ failure leaves the design call to the brief, not broken", async () => {
  const { analyzeVisionBoardStyles } = await import("../runtime/visionboard-iq.cjs").then((m) => m.default ?? m);
  const parts = [{ inlineData: { mimeType: "image/png", data: "AAAA" } }];

  assert.equal(await analyzeVisionBoardStyles({ provider: {}, referenceParts: parts }), null, "no provider");
  assert.equal(await analyzeVisionBoardStyles({ provider: { generateSpecification: async () => { throw new Error("429"); } }, referenceParts: parts }), null, "a refusal");
  assert.equal(await analyzeVisionBoardStyles({ provider: { generateSpecification: async () => ({}) }, referenceParts: parts }), null, "an empty answer");
  assert.equal(await analyzeVisionBoardStyles({ provider: { generateSpecification: async () => ({ specification: {} }) }, referenceParts: parts }), null, "a blank specification");
  assert.equal(await analyzeVisionBoardStyles({ provider: { generateSpecification: async () => ({ specification: { artStyle: "x" } }) }, referenceParts: [] }), null, "no references at all");
});

// A REFERENCE NEVER TURNS THE DESIGNER OFF, AND ITS ABSENCE NEVER TURNS IT OFF.
//
// Both directions of the owner's rule. `exact_reference` used to skip the whole
// elevation block, so attaching one picture silently stripped COMMERCIAL_DEPTH
// and the professional judgment from a commercial brief.
test("neither the presence nor the absence of references changes the core design behaviour", () => {
  const { COMMERCIAL_DEPTH, PROFESSIONAL_JUDGMENT, LOGO_AUTHORING_RULE, LOGO_REQUIREMENT } =
    require("../runtime/designiq-prompt.cjs");
  const base = { mode: "commercial", brief: "Wrap for Harbor Point Electric", companyName: "Harbor Point Electric" };
  const intents = [
    ["none", {}],
    ["style_inspiration", { visionboardIntent: "style_inspiration", visionBoardImages: [{}] }],
    ["exact_reference", { visionboardIntent: "exact_reference", visionBoardImages: [{}] }],
  ];
  for (const [label, extra] of intents) {
    const prompt = authored({ ...base, ...extra });
    assert.ok(prompt.includes(COMMERCIAL_DEPTH), `${label}: layered depth must survive`);
    assert.ok(prompt.includes(PROFESSIONAL_JUDGMENT), `${label}: professional judgment must survive`);
    assert.ok(prompt.includes(LOGO_REQUIREMENT), `${label}: auto-logo must survive`);
    assert.ok(prompt.includes(LOGO_AUTHORING_RULE), `${label}: the mark rule must survive`);
  }
  // Style DNA travels under BOTH intents, and the intents stay distinct: style
  // inspiration composes from it, an exact reference reproduces the images and
  // carries the DNA only to the zones they do not show.
  const withRefs = (extra) => authored({ ...base, visionBoardImages: [{}], styleDescriptors: "ART STYLE: bold", ...extra });
  const inspiration = withRefs({ visionboardIntent: "style_inspiration" });
  assert.match(inspiration, /STYLE INSPIRATION: Create original artwork using this verified reference style DNA/);
  assert.match(inspiration, /ART STYLE: bold/);

  const exact = withRefs({ visionboardIntent: "exact_reference" });
  assert.match(exact, /EXACT CUSTOMER REFERENCE/, "the reproduction rule governs");
  assert.match(exact, /ART STYLE: bold/, "and the derived DNA still reaches the call");
  assert.match(exact, /the images win/, "subordinate to the reference, never competing with it");

  // Style DNA is derived FROM references, so it says nothing without them.
  assert.doesNotMatch(authored(base), /STYLE INSPIRATION|style DNA/);
});
