// CALL 1 AS A FLAT PANEL PRODUCTION PROOF (owner ruling, Trish 2026-09-18).
//
// "Gemini image pro 3's newest model has no issues generating text we need to
//  rely on our custom design persona edge functions and Gemini's own brain and
//  test a flat panel production proof ... it must be fed a real flat panel
//  production proof and given the base prompt system engineering so it knows
//  its job on call 1 and has a clear example and done with thought multi modal
//  best practices."
//
// TWO HOMES, ONE CONTRACT. The runtime module and the edge module carry the
// same words, exactly as atlas-artboard-prompt.ts is locked against
// designiq-prompt.cjs -- because a fix applied to one home and not the other is
// how this repo's prompt contracts keep coming undone. Change both or neither.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const runtime = require("../runtime/atlas-panel-proof-contract.cjs");
const edgeSource = readFileSync(
  new URL("../supabase/functions/_shared/atlas-panel-proof-prompt.ts", import.meta.url), "utf8");

test("the runtime and the edge carry the SAME contract words", () => {
  // The job statement and the installation fact are the whole conditioning.
  // If they drift, one half of the system is asking for a different object.
  for (const line of runtime.SYSTEM_JOB.split("\n").filter(Boolean)) {
    assert.ok(edgeSource.includes(line),
      `the edge is missing a line of the system job: ${line.slice(0, 60)}`);
  }
  for (const line of runtime.INSTALLATION_FACT.split("\n").filter(Boolean)) {
    assert.ok(edgeSource.includes(line),
      `the edge is missing a line of the installation fact: ${line.slice(0, 60)}`);
  }
  assert.ok(edgeSource.includes(runtime.PANEL_PROOF_CONTRACT),
    "the edge must name the same contract version");
  for (const version of runtime.VERSIONS) {
    assert.ok(edgeSource.includes(version.label), `the edge is missing ${version.key}`);
    assert.ok(edgeSource.includes(version.instruction.slice(0, 50)),
      `the edge's ${version.key} instruction drifted`);
  }
});

test("the ask is for a PROOF, and the installation fact is POSITIVE", () => {
  // The object class is the whole point of this contract: every previous
  // experiment changed the ask while keeping the object a bare artboard.
  assert.match(runtime.SYSTEM_JOB, /VEHICLE WRAP PANEL PRODUCTION PROOF/);
  assert.match(runtime.SYSTEM_JOB, /the document a print shop receives/);

  // A positive physical fact, never a prohibition. "Do not draw wheel arches"
  // is the negative shape CLAUDE.md warns about in four places and which has
  // failed 4/4 on the field map.
  assert.match(runtime.INSTALLATION_FACT, /ONE CONTINUOUS PANEL/);
  assert.match(runtime.INSTALLATION_FACT, /trims the wheel openings, handles and glass afterwards/);
  assert.doesNotMatch(runtime.INSTALLATION_FACT, /\bdo not\b/i,
    "the installation fact must state what IS, never what is forbidden");
});

test("three versions, in one pass, and the clean base is one of them", () => {
  const keys = runtime.VERSIONS.map((v) => v.key);
  assert.deepEqual(keys, ["branded", "artwork", "elements"]);
  // V2 is the clean base -- cohesive because the SAME designer drew it, which
  // is the thing no compositor can reproduce. v28 builds it mechanically and
  // the measured result (34613569) is a slate slab at 1.95:1 contrast over
  // mid-blue artwork, clipped mid-word, in a font that knows nothing about the
  // design underneath.
  const artwork = runtime.VERSIONS.find((v) => v.key === "artwork");
  assert.match(artwork.instruction, /artwork continued through where they sat/);
  assert.match(artwork.instruction, /Not erased or blanked/);
});

test("every literal string is stated ONCE and marked exact", () => {
  // The element graph's justification was that a diffusion model cannot be
  // trusted with a phone number -- RestylePro measured exactly that. This
  // contract retests that premise, so the strings must be unambiguous.
  const prompt = runtime.buildPanelProofPrompt({
    input: { companyName: "Bright Smiles Dental", phone: "(520) 555-0192", website: "brightsmiles.com" },
    manifest: { zones: [] }, creativeDirection: "blue wave",
  });
  assert.match(prompt, /reproduce each of these character for character/);
  assert.match(prompt, /Invent no other words/);
  assert.equal((prompt.match(/\(520\) 555-0192/g) || []).length, 1,
    "a literal must appear exactly once -- twice is two chances to diverge");
});

test("INCHES, never normalized fractions", () => {
  // RULE 0.33 removed the [0,1] topology table from Call 1 on measured
  // evidence, and the field contract's bare four-decimal rows are what FOUR
  // consecutive runs painted onto the artwork (map_drawn). Trim inches are what
  // a proof legitimately carries.
  const prompt = runtime.buildPanelProofPrompt({
    input: {}, creativeDirection: "x",
    manifest: { zones: [{ surfaceKey: "driver", trimInches: { widthIn: 165.7, heightIn: 49.6 } }] },
  });
  assert.match(prompt, /DRIVER: 165\.7" wide x 49\.6" high/);
  assert.doesNotMatch(prompt, /0\.\d{4}/, "no normalized fractions may reach Call 1");
});

test("it stays inside the prompt budget that CLAUDE.md measured", () => {
  // v19: creative conditioning held at 2,490 chars through the last known-good
  // master; the 4K ceiling is the persona stack's own stated quality limit.
  const prompt = runtime.buildPanelProofPrompt({
    input: {
      companyName: "Bright Smiles Dental", phone: "(520) 555-0192", website: "brightsmiles.com",
      vehicle: { year: "2012", make: "Toyota", model: "Prius" },
    },
    manifest: {
      zones: ["driver", "passenger", "hood", "roof", "front", "rear"].map((surfaceKey) => ({
        surfaceKey, trimInches: { widthIn: 165.7, heightIn: 49.6 },
      })),
    },
    creativeDirection: "Bright Smiles Dental — clean blue wave design with a photo of a dental patient "
      + "in a chair on the 3/4 of each side, custom tooth logo, tagline HEALTHY SMILES BRIGHTER LIVES.",
  });
  assert.ok(prompt.length < 4000, `assembled prompt is ${prompt.length} chars; the ceiling is 4000`);
});
