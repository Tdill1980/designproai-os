/**
 * WBTY (Wrap By The Yard / PatternPro) MyVehiclePro prompt builder.
 *
 * Owned by the wbty-on-vehicle-photo edge function. Tune freely
 * without affecting ColorPro / FadeWraps / GraphicsPro / DesignPro.
 *
 * The customer picks a curated pattern panel (Pink Marble, Black Carbon
 * Fiber, etc.) and the wrap is applied byte-accurate to that exact
 * pattern — Gemini was drifting to similar-looking patterns at default
 * temperature, so the prompt enforces pixel-fidelity reproduction.
 */

import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "../_shared/forbidden-text-instructions.ts";

const HEADER = `
═══════════════════════════════════════════════════════════════════════════════
🏢 RESTYLEPRO™ MY VEHICLE — WBTY PATTERN APPLICATION
═══════════════════════════════════════════════════════════════════════════════

You are editing a REAL CUSTOMER PHOTOGRAPH. Apply a curated vinyl
pattern panel to the vehicle body panels with pixel-perfect fidelity.
Everything else in the photo must stay exactly as it is.

🚨 BRANDING RULES:
- NEVER reference any other brand, company, tool, watermark, or competitor
- NEVER add text, watermarks, or logos to the rendered image
- Output ONLY the edited photograph
═══════════════════════════════════════════════════════════════════════════════
`;

export function buildWBTYMyVehiclePrompt(params: {
  panelName?: string;
  finish?: string;
  vehicleInfo?: { make?: string; model?: string; year?: string };
}): string {
  const { panelName, finish, vehicleInfo } = params;

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

  const patternBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 PATTERN APPLICATION — Curated WBTY Pattern
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATTERN NAME: ${panelName || "Custom Pattern"}
FINISH: ${finish || "Gloss"} — ${finishLine}

IMAGE 1: The customer's REAL vehicle photograph — THIS is what you are editing
IMAGE 2: The vinyl pattern panel (186" x 56" flat artwork) — THIS is the
         pattern to apply

PATTERN FIDELITY — NON-NEGOTIABLE:
Reproduce IMAGE 2 pixel-for-pixel on the body panels. Keep every color,
shape, vein, swirl, and texture byte-accurate to IMAGE 2. If IMAGE 2 is
pink marble, the wrap is pink marble. If IMAGE 2 is black carbon fiber,
the wrap is black carbon fiber. Never substitute a similar-looking
pattern, never shift the palette, never simplify the composition. Treat
IMAGE 2 as a printed film you are laying onto the customer's vehicle.

YOUR TASK:
Apply the pattern panel (Image 2) as a full vinyl wrap across ALL exterior
body panels of the vehicle in Image 1:

1. WRAP AROUND the vehicle body panels following the 3D contours and curvature
2. SCALE the design proportionally to cover the full vehicle body
3. PRESERVE the pattern's colors, textures, and details EXACTLY as in IMAGE 2
4. Apply proper ${finish || "Gloss"} lamination finish (${finishLine})
5. Account for the photo's ACTUAL lighting conditions
6. Maintain panel gaps, body lines, and contours from the original photo
7. DO NOT apply the pattern to windows, wheels, trim, lights, or bumpers
8. The pattern wraps SEAMLESSLY across panels without visible seams
9. DO NOT change the vehicle make/model — output vehicle MUST match IMAGE 1

The result must look like a REAL photograph of the customer's vehicle with
IMAGE 2's exact pattern professionally installed as a vinyl wrap.
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
3. Pattern reproduced byte-accurate from IMAGE 2?
4. Pattern wrapped seamlessly across 3D contours?
5. Lighting preserved from original photo?
6. Result looks like a real photograph (not a mockup)?

OUTPUT: A photorealistic edited version of the customer's vehicle photo
with IMAGE 2's pattern applied as a professional vinyl wrap.
`;

  return `${HEADER}
${patternBlock}
${preservation}
${vehicleBlock}
${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}
${qualityCheck}`;
}
