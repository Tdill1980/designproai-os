// THE PROFESSIONAL DESIGNER CONTRACT, ASSERTED ON THE REAL DPAG ASSEMBLY.
//
// Owner directive (Trish 2026-08-27): Call 1 executes design-panel-ai-generate's
// OWN buildDesignIQPrompt commercial/restyle branch with atlasFlatMaster:true.
// This file transpiles and EXECUTES that exact deployed assembly (never a
// re-description) and asserts the creative contract fires inside the one call.
import assert from "node:assert/strict";
import test from "node:test";
import { loadDesignIQ, ATLAS_PANELS } from "./helpers/load-designiq.mjs";

const { buildDesignIQPrompt } = await loadDesignIQ();
const VEHICLE = { year: "2022", make: "Ford", model: "F250 Crew Cab" };

const authored = (input = {}) => buildDesignIQPrompt({
  mode: input.mode === "restyle" ? "restyle" : "commercial",
  prompt: String(input.brief || ""),
  finish: "Gloss",
  substrate: "standard",
  companyName: input.companyName,
  phone: input.phone,
  industryType: input.industry,
  brandColors: input.brandColors,
  mascot: input.mascot,
  bulletPoints: input.bulletPoints,
  vehicleYear: VEHICLE.year,
  vehicleMake: VEHICLE.make,
  vehicleModel: VEHICLE.model,
  viewType: "side",
  visionBoardImages: Array.isArray(input.visionBoardImages) ? input.visionBoardImages : undefined,
  visionboard_intent: input.visionboardIntent === "exact_reference" ? "exact_reference" : "style_inspiration",
  styleDescriptors: input.styleDescriptors,
  atlasFlatMaster: true,
  atlasPanels: ATLAS_PANELS,
});

// AUTO-LOGO FIRES ON BOTH COMMERCIAL SHAPES. 3 of 11 real A.T.L.A.S. runs sent
// no companyName field at all, so the free-text branch matters as much as the
// field branch — and both interpolate the SAME LOGO_REQUIREMENT const.
test("a business brief with no supplied logo is told to design a real logo", () => {
  const withField = authored({ mode: "commercial", brief: "Wrap for Harbor Point Electric", companyName: "Harbor Point Electric" });
  assert.match(withField, /Spell the business name exactly\./);
  assert.match(withField, /This business needs its own logo — decide its form from this brief alone\./);

  const briefOnly = authored({ mode: "commercial", brief: "Wrap for Harbor Point Electric, licensed contractor" });
  assert.match(briefOnly, /Identify the business name from the creative direction above\./);
  assert.match(briefOnly, /This business needs its own logo — decide its form from this brief alone\./);
});

// NO FORM IS PRESCRIBED, DELIBERATELY. Every version that named a form
// converged — the reference deleted them all for that reason.
test("the logo requirement names no form", () => {
  const prompt = authored({ mode: "commercial", brief: "Wrap for Acme Plumbing", companyName: "Acme Plumbing" });
  for (const prescription of [/distinctive lettering/i, /monogram/i, /pictorial/i, /badge or/i, /emblem, crest/i, /wordmark/i]) {
    assert.doesNotMatch(prompt, prescription, `a form prescription reappeared: ${prescription}`);
  }
});

// A RESTYLE BRIEF IS NOT A BUSINESS AND GETS NO LOGO DEMAND.
test("a non-commercial brief carries no logo demand at all", () => {
  const prompt = authored({ mode: "restyle", brief: "Distressed Martini racing livery" });
  assert.doesNotMatch(prompt, /needs its own logo/);
});

// THE CREATIVE BLOCKS THE OWNER NAMED MUST ALL FIRE IN THE ONE CALL.
test("persona, depth, translation and professional judgment fire on every commercial brief", () => {
  for (const input of [
    { mode: "commercial", brief: "Wrap for Acme Plumbing" },
    { mode: "commercial", brief: "Wrap for Acme", companyName: "Acme", industry: "Plumbing", phone: "555-0100" },
  ]) {
    const prompt = authored(input);
    // PERSONA — DPAG's own sign-and-wrap-company designer.
    assert.match(prompt, /senior graphic designer at a sign and wrap company/);
    assert.match(prompt, /You amplify each brief into an original design built for this one business/);
    // COMMERCIAL_DEPTH.
    assert.match(prompt, /built from layered elements — background color and texture flowing across the body lines, mid-ground graphic motion, and foreground accent detail/);
    // COMMERCIAL_TRANSLATION.
    assert.match(prompt, /Translate anything the brief names into concrete design/);
    // PROFESSIONAL_JUDGMENT.
    assert.match(prompt, /When the brief names a real subject/);
    // THE CONCEPT header keeps the customer's words the heart of the design.
    assert.match(prompt, /THE CONCEPT — the heart of this design/);
  }
});

// RESTYLE KEEPS ITS OWN ELEVATION AND DEPTH.
test("the restyle branch keeps its layered-depth elevation in flat-master mode", () => {
  const prompt = authored({ mode: "restyle", brief: "Distressed Martini racing livery" });
  assert.match(prompt, /layered thematic elements/);
  assert.match(prompt, /depth and texture/);
  assert.match(prompt, /ONE FLAT print-production master/);
});

// EXACT CUSTOMER DATA IN; NOTHING INVENTED WHEN ABSENT.
test("contact data is exact when supplied and never invented when not", () => {
  const withPhone = authored({ mode: "commercial", brief: "Wrap for Acme", companyName: "Acme", phone: "(520) 555-0192" });
  assert.match(withPhone, /\(520\) 555-0192 — display this EXACT number, digit for digit/);

  const none = authored({ mode: "commercial", brief: "Wrap for Acme", companyName: "Acme" });
  assert.match(none, /No phone number was provided — do NOT invent, fabricate, or display any phone number, website, email, or address anywhere/);
});

// BRAND, INDUSTRY AND FINISH ALL RIDE THE ONE CALL.
test("brand colours, industry and finish reach the same request", () => {
  const prompt = authored({
    mode: "commercial", brief: "Wrap for Acme", companyName: "Acme",
    industry: "HVAC and climate control", brandColors: "deep blue, sunrise orange",
  });
  assert.match(prompt, /Industry: HVAC and climate control/);
  assert.match(prompt, /Brand colors: deep blue, sunrise orange — build the entire design from this palette/);
  assert.match(prompt, /Finish: GLOSS/);
});

// VISIONBOARD NEVER DISABLES THE DESIGNER.
test("references never turn the persona or the auto-logo off", () => {
  const base = { mode: "commercial", brief: "Wrap for Harbor Point Electric", companyName: "Harbor Point Electric" };
  for (const extra of [
    {},
    { visionboardIntent: "style_inspiration", visionBoardImages: [{}] },
    { visionboardIntent: "exact_reference", visionBoardImages: [{}] },
  ]) {
    const prompt = authored({ ...base, ...extra });
    assert.match(prompt, /senior graphic designer at a sign and wrap company/);
    assert.match(prompt, /This business needs its own logo/);
  }
  const inspiration = authored({ ...base, visionBoardImages: [{}], visionboardIntent: "style_inspiration", styleDescriptors: "ART STYLE: bold" });
  assert.match(inspiration, /STYLE INSPIRATION: Transform the visual style from the client's reference images into an ORIGINAL wrap design/);
  assert.match(inspiration, /ART STYLE: bold/);
  const exact = authored({ ...base, visionBoardImages: [{}], visionboardIntent: "exact_reference" });
  assert.match(exact, /EXACT REFERENCE: The provided reference is the customer's own approved wrap design/);
  assert.doesNotMatch(authored(base), /STYLE INSPIRATION|EXACT REFERENCE/);
});

// THE FLAT CALL CARRIES NO 3D PRESENTATION — THAT BELONGS TO CALLS 2-7.
test("camera, studio and the photograph framing stay out of the flat master", () => {
  const flat = authored({ mode: "commercial", brief: "Wrap for Acme", companyName: "Acme" });
  assert.doesNotMatch(flat, /CAMERA ANGLE \(LOCKED/);
  assert.doesNotMatch(flat, /Canon EOS R5/);
  assert.doesNotMatch(flat, /epoxy floor|LED strip/);
  assert.match(flat, /ONE FLAT print-production master/);
  assert.match(flat, /OUTPUT FORMAT — ONE FLAT A.T.L.A.S. MASTER/);

  // And the 3D path is untouched: same assembly, atlasFlatMaster off.
  const threeD = buildDesignIQPrompt({
    mode: "commercial", prompt: "Wrap for Acme", companyName: "Acme", finish: "Gloss",
    vehicleYear: VEHICLE.year, vehicleMake: VEHICLE.make, vehicleModel: VEHICLE.model, viewType: "side",
  });
  assert.match(threeD, /CAMERA ANGLE \(LOCKED/);
  assert.match(threeD, /Canon EOS R5/);
  assert.match(threeD, /epoxy floor/);
});
