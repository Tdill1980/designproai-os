/**
 * FADEWRAPS MyVehiclePro prompt builder.
 *
 * Owned by the fadewraps-on-vehicle-photo edge function. Tune freely
 * without affecting ColorPro / GraphicsPro / WBTY / DesignPro.
 */

import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "../_shared/forbidden-text-instructions.ts";

const HEADER = `
═══════════════════════════════════════════════════════════════════════════════
🏢 RESTYLEPRO™ MY VEHICLE — FADEWRAPS APPLICATION
═══════════════════════════════════════════════════════════════════════════════

You are editing a REAL CUSTOMER PHOTOGRAPH. Apply a fade/gradient
vinyl wrap to the vehicle body panels. Everything else in the photo
must stay exactly as it is.

🚨 BRANDING RULES:
- NEVER reference any other brand, company, tool, watermark, or competitor
- NEVER add text, watermarks, or logos to the rendered image
- Output ONLY the edited photograph
═══════════════════════════════════════════════════════════════════════════════
`;

export function buildFadeWrapsMyVehiclePrompt(params: {
  fadeStyle?: string;
  fadeSpec?: any;
  colorName?: string;
  colorHex?: string;
  finish?: string;
  vehicleInfo?: { make?: string; model?: string; year?: string };
}): string {
  const { fadeStyle, fadeSpec, colorName, colorHex, finish, vehicleInfo } = params;

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

  const fadeBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌊 FADE WRAP APPLICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FADE STYLE: ${fadeStyle || "Standard Fade"}
COLOR: ${colorName || "Custom"} (${colorHex || "#000000"})
FINISH: ${finish || "Gloss"} — ${finishLine}
${fadeSpec ? `FADE SPEC: ${JSON.stringify(fadeSpec)}` : ""}

YOUR TASK:
Apply a fade/gradient vinyl wrap to the vehicle body panels (Image 1).
The wrap should:

1. Create a smooth gradient/fade effect using the specified color and style
2. Follow the fade pattern: color is strongest at one end and fades to
   transparent / vehicle color at the other end
3. Apply proper ${finish || "Gloss"} lamination finish (${finishLine})
4. Account for the photo's ACTUAL lighting conditions
5. Maintain all panel gaps, body lines, and contours
6. DO NOT apply to windows, wheels, trim, lights, or chrome elements
7. The result must look like a REAL photograph of a vehicle with a
   professionally installed fade wrap
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
6. Same people, objects, scenery in the photo
7. ONLY the vehicle body panels change
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const qualityCheck = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ QUALITY CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Background identical to original?
2. Only body panels modified?
3. Fade gradient smooth and natural across panels?
4. Lighting preserved from original photo?
5. No unwanted text, watermarks, or branding?
6. Result looks like a real photograph (not a mockup)?

OUTPUT: A photorealistic edited version of the customer's vehicle photo
with the specified fade wrap applied.
`;

  return `${HEADER}
${fadeBlock}
${preservation}
${vehicleBlock}
${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}
${qualityCheck}`;
}
