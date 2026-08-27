// CALLS 2-8 ARE PRESENTATION, NEVER A SECOND DESIGN GENERATION.
//
// Owner directive (Trish 2026-08-27): "3D proofs must not re-enter creative
// authoring. ONE DESIGN GENERATION = Call 1 only." The A.T.L.A.S. proof path
// uses buildAtlasProjectionPrompt — the presentation branch of the same
// canonical implementation — never buildDesignIQPrompt's commercial/restyle
// creative assembly. This file holds that line.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const provider = readFileSync(join(ROOT, "runtime", "designpanel-server-provider.cjs"), "utf8");
const atlasRuntime = readFileSync(join(ROOT, "runtime", "flat-first-atlas.cjs"), "utf8");
const proofPrompt = provider.slice(
  provider.indexOf("function buildAtlasProjectionPrompt"),
  provider.indexOf("async function buildAtlasProjectionRequest"),
);

test("the proof prompt carries NO creative authoring block", () => {
  assert.ok(proofPrompt.length > 500, "the projection prompt builder must exist");
  for (const creative of [
    "LOGO_REQUIREMENT",
    "buildLogoArchitecture",
    "COMMERCIAL_DEPTH",
    "COMMERCIAL_TRANSLATION",
    "PROFESSIONAL_JUDGMENT",
    "needs its own logo",
    "Translate anything the brief names",
    "THE CONCEPT",
    "CLIENT BRIEF",
    "Brand colors",
    "buildDesignIQPrompt",
    "buildRestylePrompt",
    "atlasFlatMaster",
  ]) {
    assert.ok(!proofPrompt.includes(creative), `a proof must never carry ${creative}`);
  }
});

test("the accepted A.T.L.A.S. surface crop is the sole artwork authority", () => {
  assert.match(proofPrompt, /ARTWORK AUTHORITY — NON-NEGOTIABLE/);
  assert.match(proofPrompt, /SOLE artwork authority for this proof/);
  assert.match(proofPrompt, /NOT another design call/);
  assert.match(proofPrompt, /The artwork is LOCKED/);
  // The explicit prohibition list — no new logos, text, motifs, colours or layout.
  assert.match(proofPrompt, /Never redraw hidden content from Driver, borrow another master zone, redesign, reimagine, beautify, simplify, restyle, recolor, mirror, move, resize, substitute, autocomplete or invent/);
});

test("the proof applies the real RestylePro view-angle and studio authorities", () => {
  assert.match(proofPrompt, /CAMERA ANGLE \(LOCKED — read this FIRST\)/);
  assert.match(proofPrompt, /angles\.cameraAngle\(sourceViewType\)/);
  assert.match(proofPrompt, /\$\{STUDIO_ENVIRONMENT\}/);
  assert.match(proofPrompt, /\$\{PHOTOREALISM_REQUIREMENT\}/);
  assert.match(proofPrompt, /\$\{WRAP_COVERAGE_RULES\}/);
  // And it renders the real YMM, not a generic vehicle.
  assert.match(proofPrompt, /vehicleDescription\(input\)/);
});

test("the per-view conditioning crop is hash-bound to the accepted master", () => {
  const parts = atlasRuntime.slice(
    atlasRuntime.indexOf("function atlasProjectionParts"),
    atlasRuntime.indexOf("module.exports = {"),
  );
  assert.match(parts, /EXACT A\.T\.L\.A\.S\. VIEW AUTHORITY/);
  assert.match(parts, /sole artwork authority for this proof/);
  assert.match(parts, /never redesign, simplify, beautify, restyle, replace, mirror, recolor, move, resize, autocomplete or invent artwork/);
  // viewAuthorityFor throws when the authority is not bound to this master's
  // surface — a presentation example can never pass that gate.
  assert.match(atlasRuntime, /flat_atlas_view_authority_identity_mismatch/);
});

test("only Call 1 sets atlasFlatMaster; the proof path never does", () => {
  const edge = readFileSync(join(ROOT, "supabase", "functions", "design-panel-ai-generate", "index.ts"), "utf8");
  // Exactly one caller sets it, and it is the atlas-artboard (Call 1) handler.
  const setters = edge.match(/atlasFlatMaster: true/g) || [];
  assert.equal(setters.length, 1, "atlasFlatMaster is set exactly once, by Call 1");
  const handler = edge.slice(edge.indexOf("async function handleAtlasArtboard"));
  assert.match(handler, /atlasFlatMaster: true/);
  // The runtime's proof path does not reach the creative assembly at all.
  assert.ok(!provider.includes("buildDesignIQPrompt("), "the proof provider never calls the creative assembly");
});
