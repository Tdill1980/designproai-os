import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
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
    "You are a Custom Vehicle Wrap Designer at WePrintWraps.com.",
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

test("Atlas keeps a pickup master full-bleed but preserves factory glass and the open bed in 3D proofs", () => {
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
  assert.match(prompt, /downstream 3D proof projection only/);
  assert.match(prompt, /windows, glass, lights, wheels and trim stay factory/);
  assert.match(prompt, /open bed interior stays bare factory bedliner/);
  assert.match(prompt, /open bed interior is not an artwork surface/);
  assert.match(prompt, new RegExp(PHOTO_REALISM_LOCK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(buildFlatDesignIQDirection(input), prompt, "the shipped compatibility API must use the same builder");
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

  assert.equal(PROMPT_VERSION, "designpro-flat-first-atlas-20260825.v7");
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
