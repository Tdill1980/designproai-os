/**
 * COLORPRO MyVehiclePro prompt builder.
 *
 * Owned by the colorpro-on-vehicle-photo edge function. Tune freely
 * without affecting FadeWraps / GraphicsPro / WBTY / DesignPro.
 */

import { buildPanelLock, buildFinishLock } from "../_shared/hard-enforcement-blocks.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "../_shared/forbidden-text-instructions.ts";

const HEADER = `
═══════════════════════════════════════════════════════════════════════════════
🏢 RESTYLEPRO™ MY VEHICLE — COLORPRO PHOTO EDIT
═══════════════════════════════════════════════════════════════════════════════

You are editing a REAL CUSTOMER PHOTOGRAPH. Recolor ONLY the vehicle's
exterior body panels to visualize a vinyl wrap in the specified color
and finish. Everything else in the photo must remain EXACTLY as it is.

🚨 BRANDING RULES:
- NEVER reference any other brand, company, tool, watermark, or competitor
- NEVER add ANY text, watermarks, or logos to the rendered image
- Output ONLY the edited photograph
═══════════════════════════════════════════════════════════════════════════════
`;

const CORE_INSTRUCTIONS = `
═══════════════════════════════════════════════════════════════════════════════
📸 PHOTO EDITING — RECOLOR BODY PANELS
═══════════════════════════════════════════════════════════════════════════════

🔒 PRESERVATION (NON-NEGOTIABLE):
1. Same background, environment, location, sky, trees, buildings
2. Same lighting conditions — do NOT change time of day, shadows, or color temp
3. Same camera angle, perspective, framing
4. Same wheels, tires, windows, glass, lights, mirrors, grille, badges, trim,
   bumpers, door handles, antennas, trailer (if present)
5. Same panel gaps, body lines, contours
6. Any people, objects, or scenery in the photo

🎨 MODIFY ONLY:
1. The paintable exterior body panels of the vehicle
2. Render the wrap color as it would ACTUALLY appear under the photo's lighting
3. Adjust specular highlights to match the finish (gloss = sharp reflections,
   matte = no reflections, satin = soft sheen)
4. Result must look like a real photograph of an actually wrapped vehicle —
   NOT a digital tint or color overlay

🌤️ LIGHTING AUTHORITY:
The wrap must look natural under the EXISTING lighting in the photo.
DO NOT apply studio lighting. Match sun direction, shadow length, ambient cast.
═══════════════════════════════════════════════════════════════════════════════
`;

export function buildColorProMyVehiclePrompt(params: {
  colorName: string;
  manufacturer: string;
  sku?: string;
  finish: string;
  vehicleInfo?: { make?: string; model?: string; year?: string };
  groundingContext?: string;
  hasReferenceImages?: boolean;
  reflectivity?: number;
  metallic_flake?: number;
  finish_profile?: {
    highlight_softness?: number;
    shadow_saturation_falloff?: number;
    anisotropy?: number;
    texture?: string;
  };
  metallic?: boolean;
  pearl?: boolean;
  chrome?: boolean;
}): string {
  const {
    colorName, manufacturer, sku, finish, vehicleInfo,
    groundingContext, hasReferenceImages,
    reflectivity, metallic_flake, finish_profile,
    metallic, pearl, chrome,
  } = params;

  const filmIdentity = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 FILM COLOR IDENTITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANUFACTURER: ${manufacturer || "Vinyl Film"}
FILM: ${colorName}
${sku ? `SKU: ${sku}` : ""}
FINISH: ${finish}

${groundingContext || `Apply ${manufacturer || "manufacturer"} ${colorName}${sku ? ` (SKU ${sku})` : ""} — the actual manufactured vinyl film. Match the reference images provided. Do not interpret color numerically.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const finishBlock = buildFinishLock({
    finish,
    reflectivity,
    metallic_flake,
    finish_profile,
    metallic,
    pearl,
    chrome,
  });

  const panelBlock = buildPanelLock();

  const refLine = hasReferenceImages
    ? "IMAGE 3+ (if provided): Real-world reference photos of this film on vehicles — match the visual appearance"
    : "";

  const imageGuide = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 IMAGE INPUT GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE 1: The customer's REAL vehicle photograph — THIS is what you are editing
IMAGE 2 (if provided): The manufacturer vinyl swatch — THIS is the color to apply
${refLine}

COLOR AUTHORITY HIERARCHY:
1. REFERENCE IMAGES (swatch + vehicle examples) — highest authority
2. FILM NAME + MANUFACTURER — use your knowledge of this specific product
3. Visual appearance takes priority over any numerical color values

When applying the color from references to the photo:
- Account for the difference between reference lighting and the photo's lighting
- Maintain the film's HUE but adjust BRIGHTNESS for the photo's exposure
- Preserve any metallic flake, pearl shift, or color-shift properties
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  const vehicleBlock = vehicleInfo
    ? `
VEHICLE CONTEXT:
${vehicleInfo.year ? `Year: ${vehicleInfo.year}` : ""}
${vehicleInfo.make ? `Make: ${vehicleInfo.make}` : ""}
${vehicleInfo.model ? `Model: ${vehicleInfo.model}` : ""}
`
    : "";

  const qualityCheck = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ QUALITY CHECKLIST — ALL MUST PASS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Background IDENTICAL to original photo? (same scene, same objects)
2. ONLY body panels recolored? (no windows, wheels, trim, lights changed)
3. Wrap color visually matches reference under the photo's actual lighting?
4. ${finish} finish correctly represented?
5. Panel gaps and body lines preserved?
6. Shadows and highlights physically correct for the wrap color?
7. Indistinguishable from a real photograph of a wrapped vehicle?
8. ZERO text, watermarks, or branding?

OUTPUT: A photorealistic edited version of the customer's vehicle photo
showing ${manufacturer || ""} ${colorName} ${finish} vinyl wrap applied to all
exterior body panels.
`;

  return `${HEADER}
${CORE_INSTRUCTIONS}
${imageGuide}
${filmIdentity}
${finishBlock}
${panelBlock}
${vehicleBlock}
${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}
${qualityCheck}`;
}
