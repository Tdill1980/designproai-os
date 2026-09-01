/**
 * A.T.L.A.S. PROOF PRESENTATION — RECOVERED, NOT REWRITTEN.
 *
 * This module is the presentation half of `design-panel-ai-generate`, and it is
 * recovered verbatim from the proven historical behaviour: the LIBRARY PANEL
 * branch of `restylepro-os` `generate-color-render/index.ts` (~line 2013), which
 * is the exact job an A.T.L.A.S. proof does — take FLAT 2D panel artwork and
 * render it installed on the vehicle from one locked camera angle.
 *
 * It is NOT adapted from `persona-photographer-prompt.ts`. That file arrived
 * with RULE 0.29 as "the REAL RestylePro photographer stage", but
 * `grep -rn "persona-photographer-render" src/` in restylepro-os returns
 * NOTHING and its own CLAUDE.md records the persona pipeline as bypassed --
 * every render went through `design-panel-ai-generate` / `generate-color-render`.
 * Those two are the proven stack; this file carries their words.
 *
 * ZERO ARTWORK AUTHORITY. This module may not contain, and must never grow:
 * a designer identity, the customer brief, an elevation rule, design
 * translation, COMMERCIAL_TRANSLATION, COMMERCIAL_DEPTH, logo architecture,
 * VisionBoard handling, or a design-name request. The canonical panel is the
 * artwork; this module decides only how it is photographed.
 *
 * Presentation authority it DOES carry, per the Restoration Contract §6B:
 * getCameraAngle() -- view-specific framing -- STUDIO_ENVIRONMENT --
 * finish/material -- 16:9 / 4K -- temperature 1.0 (set by the caller) --
 * complete factory vehicle geometry including wheels and tires.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHERE THIS IS **NOT** VERBATIM. Three deltas, each named so a later reader
 * does not have to diff it against the legacy file to find them:
 *
 * 1. `Panel Design: ${panelName}` is replaced by the ARTWORK IS LOCKED
 *    paragraph. The legacy line named a library panel; A.T.L.A.S. has no
 *    panel name, and the Restoration Contract §7 requires this exact
 *    model-facing principle instead -- artwork is locked, camera / geometry /
 *    lighting / finish / studio may change. Same slot, contract-required text.
 *
 * 2. The wheels-and-tires sentence is ADDED. DID-134FC3CA came back with
 *    wheels and no tires on multiple views; the contract names complete
 *    factory vehicle geometry INCLUDING wheels and tires as presentation
 *    authority this module must carry. The legacy prompt never said it
 *    because the legacy renders never lost it.
 *
 * 3. On a PICKUP only, one sentence is ADDED: the TRUCK BED clause RULE 0.0
 *    requires -- exterior bed sides and tailgate wrapped, open bed interior
 *    bare. The legacy DPP prompt never said it, and its one-line coverage
 *    sentence (kept verbatim below) names glass, lights, wheels and trim but
 *    never an open cargo bed.
 *
 *    It is SLICED from `WRAP_COVERAGE_RULES` rather than restated, exactly as
 *    `persona-photographer-render` already does, so the two homes cannot
 *    drift and a pin edit that removes the line fails the module load instead
 *    of silently dropping the rule from every pickup proof. Only that one
 *    clause is taken: the other fifteen lines of the block restate what the
 *    legacy sentence already says in one line, and ~900 characters of
 *    duplication is exactly the prompt bloat this file must not accumulate.
 *
 * The finish table is DPAG's own five-entry FINISH_SPECS, not the legacy DPP
 * three-entry one, which had no chrome and no brushed at all. A proof and its
 * Call-1 panel must describe the same material.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { getCameraAngle, WRAP_COVERAGE_RULES } from "./view-angles-os.ts";

/**
 * The pickup bed clause, DERIVED from the pinned coverage block, never
 * re-typed. Same slice `persona-photographer-render` takes, for the same
 * reason: two copies of a rule drift, and a pin edit that drops the line
 * should break the module rather than quietly stop reaching pickup proofs.
 */
const TRUCK_BED_RULE = (() => {
  const line = WRAP_COVERAGE_RULES.split("\n").map((l) => l.trim()).find((l) => l.startsWith("TRUCK BED:"));
  if (!line) throw new Error("atlas_proof_truck_bed_rule_missing_from_pin");
  return line;
})();

export const ATLAS_PROOF_PRESENTATION_CONTRACT = "designpro.atlas-proof-presentation.v1";

/**
 * The finish table, identical to the one the creative branch reads. A proof and
 * its panel must describe the same material or the customer sees two finishes
 * for one design.
 */
const FINISH_SPECS: Record<string, string> = {
  gloss: 'GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the body panels.',
  matte: 'MATTE — flat, light-absorbing, no reflections or shine; soft diffuse shading only, chalky and velvety like a matte print.',
  satin: 'SATIN — soft feathered sheen between matte and gloss; low reflection, studio lights show as soft glowing patches, never mirror-bright.',
  chrome: 'CHROME — mirror-like reflections, maximum specularity, the body panel reflects the surroundings like a polished mirror.',
  brushed: 'BRUSHED METAL — directional grain texture, anisotropic reflections that stretch along the brush direction.',
};

export interface AtlasProofPresentationInput {
  /** Canonical year/make/model, server-resolved. */
  vehicle: string;
  /** A `view-angles-os` key: side, passenger-side, hood_detail, front, rear, roof, close-up. */
  viewType: string;
  /** The A.T.L.A.S. surface whose canonical panel is attached. */
  surfaceKey: string;
  /** Customer-selected finish; falls through to gloss exactly as the legacy path does. */
  finish?: string | null;
  /** Vehicle CONFIG. On a pickup the bed clause is appended; nothing else changes. */
  isPickup?: boolean;
}

/**
 * The camera spec, recovered as-is. Close-up alone gets the 85mm shallow-depth
 * variant; every other view gets the 35mm f/8 spec the golden renders used.
 */
function cameraSpecFor(viewType: string): string {
  return viewType === "close-up"
    ? "Canon EOS R5, 85mm f/2.8, shallow depth of field with rich bokeh. Razor-sharp focus on vinyl surface texture showing depth, material quality, and fine detail. Vibrant colors."
    : "Canon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.";
}

/**
 * Build the proof prompt for ONE surface.
 *
 * The camera angle is stated first and repeated near the end -- that repetition
 * is in the proven prompt and is deliberate, so the angle survives the studio
 * block between the two statements.
 */
export function buildAtlasProofPresentationPrompt(input: AtlasProofPresentationInput): string {
  const { vehicle, viewType, surfaceKey } = input;
  const cameraAngle = getCameraAngle(viewType || "side");
  const finish = (input.finish || "Gloss").toString();
  const rawSpec = FINISH_SPECS[finish.toLowerCase()] || FINISH_SPECS.gloss;
  // THE TABLE ALREADY OPENS WITH ITS OWN LABEL, SO THE CALLER MUST NOT ADD ONE.
  //
  // The legacy DPP table did not ("High-gloss laminate — …"), which is why the
  // legacy line prefixed `Finish: ${FINISH} — `. This table is DPAG's, whose
  // entries begin "GLOSS — …", so prefixing again prints
  // `Finish: SATIN — SATIN — soft feathered sheen…` -- the exact stutter
  // `atlasFinishSpec()` exists to stop on the Call-1 side.
  //
  // Matching on the finish NAME is not enough: `brushed` selects
  // "BRUSHED METAL — …", so a name-based strip leaves
  // `Finish: BRUSHED — BRUSHED METAL — …`. Detect the label the table itself
  // wrote -- a leading run of capitals before an em dash -- and let it stand,
  // which also prints the truer material name. A table without labels still
  // gets the legacy prefix.
  const tableWritesItsOwnLabel = /^[A-Z][A-Z ]*—\s/.test(rawSpec);
  const finishLine = tableWritesItsOwnLabel
    ? `Finish: ${rawSpec}`
    : `Finish: ${finish.toUpperCase()} — ${rawSpec}`;

  return `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

A photorealistic studio photograph of a ${vehicle} with a professionally installed vinyl wrap. The attached panel artwork has been physically printed on cast vinyl, laminated, and hand-installed on this vehicle. Render this EXACT artwork on the vehicle body — the wrap follows every body line, fender curve, and wheel arch contour.

ARTWORK IS LOCKED. The attached image is the approved production artwork for the ${surfaceKey.toUpperCase()} surface of this vehicle. Reproduce that artwork faithfully — its colors, patterns, graphics, composition, lettering, weathering and surface treatment all appear exactly as they do in the attachment. Camera position, vehicle geometry, lighting, reflections, finish and studio presentation are yours to render. The artwork is not.

${finishLine} The vinyl finish is ${finish.toLowerCase()} across ALL body panels — consistent finish on every surface.

${STUDIO_ENVIRONMENT}

${cameraAngle}

The vehicle is complete and factory-correct: all four wheels mounted with full rubber tires, correct ride height, and every panel present.
The wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${input.isPickup === true ? `\n${TRUCK_BED_RULE}` : ""}
${cameraSpecFor(viewType)}`;
}

/**
 * THE SEVEN CANONICAL A.T.L.A.S. SHOTS, AND THE SURFACE THAT AUTHORS EACH.
 *
 * This is the SAME routing contract `persona-photographer-render` enforces in
 * its own `ATLAS_SHOT_SURFACES`. It is re-declared here rather than imported
 * from that function because `persona-photographer-render/index.ts` is a
 * byte-pinned adaptation (RULE 0.29) and adding an export to it would change
 * bytes the pin test asserts. Two homes CAN drift, so
 * `tests/atlas-proof-presentation-branch.test.mjs` parses the photographer's
 * literal and fails if the two maps stop agreeing.
 *
 * `null` for close-up means the caller must NAME its artwork surface -- it may
 * never silently inherit Driver (owner, 2026-08-28).
 */
export const ATLAS_SHOT_SURFACES: Record<string, string | null> = {
  "side": "driver",
  "passenger-side": "passenger",
  "hood_detail": "hood",
  "front": "front",
  "rear": "rear",
  "roof": "roof",
  "close-up": null,
};

export const ATLAS_REAL_SURFACES = ["driver", "passenger", "hood", "front", "rear", "roof"];
