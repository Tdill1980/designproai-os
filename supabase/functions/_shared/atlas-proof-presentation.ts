/**
 * THE CANONICAL 3D PROOF CONTRACT. (owner ruling, Trish 2026-09-01)
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OS AUTHORITIES              ARTWORK AUTHORITY
 *   Vehicle  — canonical GENIE vehicle       the canonical A.T.L.A.S.
 *   Surface  — canonical surface key         surface panel, supplied as
 *   Camera   — view-angle anchor             the image part
 *   Studio   — studio anchor
 *   Lighting — lighting anchor
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Owner, verbatim: "A.T.L.A.S. designs. GENIE maps. Anchors control
 * camera/studio/lighting. The proof renderer photographs." And: "Studio and
 * lighting are ANCHORS, not creative instructions."
 *
 * So the model-facing instruction is three sentences and never describes the
 * design. Repeating the panel's visual content in prose gives the model a
 * second interpretation channel that competes with the panel itself — which
 * is exactly how a proof ends up redesigning the wrap.
 *
 * NOTHING FROM CALL 1'S CREATIVE BRAIN FOLLOWS IT DOWNSTREAM. No customer
 * brief, designer persona, A.C.E. design language, design translation,
 * amplification, elevation, logo/colour/composition direction, distress
 * direction, VisionBoard, design-name request, or refusal list. If you are
 * about to add a sentence describing what the artwork looks like, the answer
 * is no: the panel is the description.
 *
 * The instruction is IDENTICAL for all seven proofs. Only the OS inputs
 * change — the surface's own panel and its matching view-angle anchor:
 *
 *   Driver panel    + Driver angle     -> Driver proof
 *   Passenger panel + Passenger angle  -> Passenger proof
 *   Hood panel      + Hood angle       -> Hood proof
 *   Roof panel      + Roof angle       -> Roof proof
 *   Front panel     + Front angle      -> Front proof
 *   Rear panel      + Rear angle       -> Rear proof
 *   Driver panel    + Close-Up angle   -> Close-Up proof
 *
 * `studio-os` and `view-angles-os` are byte-pinned (RULE 0.29) and are
 * CONSUMED here, never restated. Deleting them would not be simplification —
 * they are the deterministic presentation anchors this stage is built on.
 */

import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { getCameraAngle, WRAP_COVERAGE_RULES } from "./view-angles-os.ts";

/**
 * The pickup bed clause, SLICED from the pinned coverage block, never
 * re-typed. This is a STRUCTURED OS INPUT about which surfaces receive vinyl
 * — vehicle configuration, not a description of the artwork. It ships in the
 * deployed photographer today (PR #278, owner: "Like this but nothing inside
 * truck bed"), so dropping it would silently revert an owner-requested fix on
 * every pickup proof. A pin edit that removes the line fails the module load
 * rather than quietly dropping the rule.
 */
const TRUCK_BED_RULE = (() => {
  const line = WRAP_COVERAGE_RULES.split("\n").map((l) => l.trim()).find((l) => l.startsWith("TRUCK BED:"));
  if (!line) throw new Error("atlas_proof_truck_bed_rule_missing_from_pin");
  return line;
})();

/**
 * The PROMPT contract. Deliberately NOT the wire contract the edge stamps as
 * `contract` -- that one names the producer and artifact shape, is hardcoded
 * inside the database fence `designpro_private.flat_first_atlas_view_set_valid`
 * (migration 20260828100000), and changing it would make the fence refuse
 * every proof and no seven-view set could ever validate. This rides alongside
 * as `promptContract`, so a later reader can still tell which words produced a
 * given proof without a protected migration.
 */
export const ATLAS_PROOF_PROMPT_CONTRACT = "designpro.atlas-proof-anchors.v1";

/**
 * The finish table, identical to the one Call 1 reads. Finish is a STRUCTURED
 * OS INPUT, not prose: it is the material the customer bought, and CLAUDE.md
 * v19 requires it to ride through so the master and its proofs describe the
 * same surface. Without it a matte wrap photographs glossy.
 */
const FINISH_SPECS: Record<string, string> = {
  gloss: 'GLOSS — wet-look surface, mirror-sharp specular highlights, deep saturated color, visible reflections in the body panels.',
  matte: 'MATTE — flat, light-absorbing, no reflections or shine; soft diffuse shading only, chalky and velvety like a matte print.',
  satin: 'SATIN — soft feathered sheen between matte and gloss; low reflection, studio lights show as soft glowing patches, never mirror-bright.',
  chrome: 'CHROME — mirror-like reflections, maximum specularity, the body panel reflects the surroundings like a polished mirror.',
  brushed: 'BRUSHED METAL — directional grain texture, anisotropic reflections that stretch along the brush direction.',
};

/**
 * THE MODEL INSTRUCTION. Three sentences, identical for every proof.
 * Exported so a test can assert it verbatim and so no caller can vary it.
 */
export const ATLAS_PROOF_INSTRUCTION =
  `Apply the supplied canonical wrap panel exactly to its corresponding surface on the specified vehicle.

The supplied panel is finished, locked artwork. Preserve it exactly.

Render the wrapped vehicle as a photorealistic automotive photograph using the supplied camera, studio, and lighting anchors.`;

export interface AtlasProofPresentationInput {
  /** OS input: the exact canonical GENIE vehicle. Never inferred from the panel. */
  vehicle: string;
  /** OS input: the canonical surface key whose panel is attached. */
  surfaceKey: string;
  /** OS input: a `view-angles-os` key — side, passenger-side, hood_detail, front, rear, roof, close-up. */
  viewType: string;
  /** OS input: the customer's selected finish. Falls through to gloss. */
  finish?: string | null;
  /** OS input: vehicle configuration. On a pickup the bed clause is carried. */
  isPickup?: boolean;
}

/** The lens half of the camera anchor. Close-up alone gets the 85mm variant. */
function cameraSpecFor(viewType: string): string {
  return viewType === "close-up"
    ? "Canon EOS R5, 85mm f/2.8, shallow depth of field with rich bokeh. Razor-sharp focus on vinyl surface texture showing depth, material quality, and fine detail. Vibrant colors."
    : "Canon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.";
}

export function buildAtlasProofPresentationPrompt(input: AtlasProofPresentationInput): string {
  const finish = (input.finish || "Gloss").toString();
  const rawSpec = FINISH_SPECS[finish.toLowerCase()] || FINISH_SPECS.gloss;
  // The table writes its own label ("GLOSS — …", "BRUSHED METAL — …"), so a
  // caller-added prefix prints it twice. Matching on the finish NAME is not
  // enough: `brushed` selects "BRUSHED METAL — ".
  const finishSpec = /^[A-Z][A-Z ]*—\s/.test(rawSpec)
    ? rawSpec
    : `${finish.toUpperCase()} — ${rawSpec}`;

  return `VEHICLE: ${input.vehicle}
SURFACE: ${input.surfaceKey.toUpperCase()}
FINISH: ${finishSpec}${input.isPickup === true ? `\nCOVERAGE: ${TRUCK_BED_RULE}` : ""}

${ATLAS_PROOF_INSTRUCTION}

CAMERA ANCHOR:
${getCameraAngle(input.viewType || "side")}
${cameraSpecFor(input.viewType)}

STUDIO AND LIGHTING ANCHOR:
${STUDIO_ENVIRONMENT}`;
}

/**
 * THE SEVEN CANONICAL SHOTS AND THE SURFACE THAT AUTHORS EACH.
 *
 * `null` for close-up means the caller must NAME its artwork surface — it may
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
