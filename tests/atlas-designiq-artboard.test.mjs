import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
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

  assert.equal(PROMPT_VERSION, "designpro-flat-first-atlas-20260824.v6");
  assert.deepEqual(PROOF_VIEWS, [
    "side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof",
  ]);
  assert.deepEqual(manifest.proofViews, PROOF_VIEWS);
  assert.deepEqual(manifest.proofOnlyViews, ["close-up"]);
  assert.match(JSON.stringify(PROOF_DEPENDENCIES), /close-up/);
  assert.doesNotMatch(JSON.stringify({ manifest, dependencies: PROOF_DEPENDENCIES }), /hero-3d/);
});
