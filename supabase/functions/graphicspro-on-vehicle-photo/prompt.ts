/**
 * GRAPHICSPRO MyVehiclePro prompt builder.
 *
 * Owned by the graphicspro-on-vehicle-photo edge function. Tune freely
 * without affecting ColorPro / FadeWraps / WBTY / DesignPro.
 *
 * Two shapes of request reach this builder:
 *
 *   1. DESIGN TRANSFER (the GraphicsPro product path). The customer already
 *      approved a cut-contour mockup; IMAGE 2 is that mockup and the job is
 *      to reproduce the SAME graphic on the customer's real vehicle photo.
 *      This is the fidelity contract MyVehiclePro's DesignProAI transfer
 *      branch proved (myvehicle-prompt-builder.ts, buildMyVehicleDesignPrompt):
 *      copy verbatim, never redesign.
 *   2. STYLING PROMPT ONLY (legacy). No reference image; the model designs
 *      from the text prompt alone.
 */

import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "../_shared/forbidden-text-instructions.ts";

const HEADER = `
═══════════════════════════════════════════════════════════════════════════════
🏢 DESIGNPROAI™ MY VEHICLE — GRAPHICSPRO APPLICATION
═══════════════════════════════════════════════════════════════════════════════

You are editing a REAL CUSTOMER PHOTOGRAPH. Apply cut vinyl graphics to the
vehicle body panels. Everything else in the photo must stay exactly as it is.

🚨 BRANDING RULES:
- NEVER reference any other brand, company, tool, watermark, or competitor
- NEVER add unintended text or logos (text that is part of the graphic design is allowed)
- Output ONLY the edited photograph
═══════════════════════════════════════════════════════════════════════════════
`;

export function buildGraphicsProMyVehiclePrompt(params: {
  customStylingPrompt?: string;
  finish?: string;
  vehicleInfo?: { make?: string; model?: string; year?: string };
  /** True when the customer's approved mockup rides along as IMAGE 2. */
  hasDesignReference?: boolean;
  designName?: string;
}): string {
  const { customStylingPrompt, finish, vehicleInfo, hasDesignReference, designName } = params;

  const vehicleBlock = vehicleInfo
    ? `
VEHICLE CONTEXT:
${vehicleInfo.year ? `Year: ${vehicleInfo.year}` : ""}
${vehicleInfo.make ? `Make: ${vehicleInfo.make}` : ""}
${vehicleInfo.model ? `Model: ${vehicleInfo.model}` : ""}
`
    : "";

  const finishKey = (finish || "Gloss").toLowerCase();
  const finishLine = finishKey === "matte"
    ? "no reflections, flat surface"
    : finishKey === "satin"
      ? "soft sheen, subtle reflections"
      : finishKey === "reflective"
        ? "high-visibility reflective film, bright return under direct light"
        : "sharp reflections, wet look";

  const stylingBlock = hasDesignReference
    ? `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 CUT VINYL GRAPHIC TRANSFER — Approved Mockup to Real Photo
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DESIGN NAME: ${designName || "Custom cut vinyl graphic"}
FINISH: ${finish || "Gloss"} — ${finishLine}
${customStylingPrompt ? `CUSTOMER NOTES: ${customStylingPrompt}` : ""}

IMAGE 1: The customer's REAL vehicle photograph — THIS is the vehicle you are editing.
         This is the ONLY vehicle that should appear in the output. Do NOT replace it.
IMAGE 2: The APPROVED MOCKUP of the cut vinyl graphic. The graphic visible on the
         vehicle in Image 2 IS the design — copy it verbatim onto the customer's vehicle.

DESIGN FIDELITY — NON-NEGOTIABLE:
  • Every letter, number, logo, stripe and shape on Image 2 must appear on the
    customer's vehicle in the same position, scale and orientation relative to the body
  • Every word must be reproduced character-for-character — same font, weight, colour
  • Every colour must match Image 2 exactly — no palette shifts, no recolouring
  • Do NOT invent new elements, do NOT substitute a "similar style" graphic, do NOT
    redesign, simplify, modernise or re-letter anything
  • Cut vinyl reads as flat solid-colour film with crisp plotter-cut edges; keep that look

YOUR TASK:
1. KEEP the customer's vehicle from Image 1 — same make, model, body shape, angle, scene
2. EXTRACT the graphic from Image 2 and RE-APPLY it onto the customer's vehicle body
   panels in Image 1, conforming to the customer vehicle's contours and panel shapes
3. Apply proper ${finish || "Gloss"} vinyl finish (${finishLine})
4. Account for the photo's ACTUAL lighting conditions
5. Maintain panel gaps, body lines, and contours
6. DO NOT modify windows, wheels, trim, or lights

The result must look like a REAL photograph of the customer's vehicle with the
exact graphic from Image 2 professionally installed.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
    : `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 GRAPHICS STYLING APPLICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STYLING PROMPT: ${customStylingPrompt || "Custom styling"}
FINISH: ${finish || "Gloss"} — ${finishLine}

YOUR TASK:
Apply custom graphics / styling to the vehicle body panels in IMAGE 1
based on the styling prompt above. This is a creative AI-driven design:

1. Interpret the styling prompt and create appropriate graphics on the vehicle
2. Apply the graphics to the exterior body panels only
3. Apply proper ${finish || "Gloss"} lamination finish (${finishLine})
4. Account for the photo's ACTUAL lighting conditions
5. Maintain panel gaps, body lines, and contours
6. DO NOT modify windows, wheels, trim, or lights
7. The styling should look professionally designed and installed

The result must look like a REAL photograph of a custom-styled vehicle.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const preservation = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 PRESERVATION RULES (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Same background, environment, scene
2. Same lighting conditions — DO NOT apply studio lighting
3. Same camera angle, perspective, framing
4. Same wheels, windows, trim, lights, chrome
5. Same image resolution and aspect ratio
6. ONLY the vehicle body panels change
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const qualityCheck = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ QUALITY CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Background identical to original?
2. Only body panels modified?
3. ${hasDesignReference ? "Graphic identical to Image 2 — every word, colour and shape?" : "Graphics professionally styled across panels?"}
4. Lighting preserved from original photo?
5. Result looks like a real photograph (not a mockup)?

OUTPUT: A photorealistic edited version of the customer's vehicle photo
with the ${hasDesignReference ? "approved cut vinyl graphic" : "requested graphics styling"} applied.
`;

  return `${HEADER}
${stylingBlock}
${preservation}
${vehicleBlock}
${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}
${qualityCheck}`;
}
