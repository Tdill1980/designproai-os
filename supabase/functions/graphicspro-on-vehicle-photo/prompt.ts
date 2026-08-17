/**
 * GRAPHICSPRO MyVehiclePro prompt builder.
 *
 * Owned by the graphicspro-on-vehicle-photo edge function. Tune freely
 * without affecting ColorPro / FadeWraps / WBTY / DesignPro.
 */

import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "../_shared/forbidden-text-instructions.ts";

const HEADER = `
═══════════════════════════════════════════════════════════════════════════════
🏢 RESTYLEPRO™ MY VEHICLE — GRAPHICSPRO APPLICATION
═══════════════════════════════════════════════════════════════════════════════

You are editing a REAL CUSTOMER PHOTOGRAPH. Apply custom AI-driven
graphics/styling to the vehicle body panels. Everything else in the
photo must stay exactly as it is.

🚨 BRANDING RULES:
- NEVER reference any other brand, company, tool, watermark, or competitor
- NEVER add unintended text or logos (text inside the styling prompt is allowed)
- Output ONLY the edited photograph
═══════════════════════════════════════════════════════════════════════════════
`;

export function buildGraphicsProMyVehiclePrompt(params: {
  customStylingPrompt?: string;
  finish?: string;
  vehicleInfo?: { make?: string; model?: string; year?: string };
}): string {
  const { customStylingPrompt, finish, vehicleInfo } = params;

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
      : "sharp reflections, wet look";

  const stylingBlock = `
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
3. Graphics professionally styled across panels?
4. Lighting preserved from original photo?
5. Result looks like a real photograph (not a mockup)?

OUTPUT: A photorealistic edited version of the customer's vehicle photo
with the requested graphics styling applied.
`;

  return `${HEADER}
${stylingBlock}
${preservation}
${vehicleBlock}
${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}
${qualityCheck}`;
}
