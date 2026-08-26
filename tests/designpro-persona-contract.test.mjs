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
