/**
 * MY VEHICLE PROMPT BUILDER
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Builds the AI prompt for the "My Vehicle" photo editing flow.
 * This takes a REAL customer photo and recolors the vehicle body panels
 * to show a vinyl wrap in the selected color/finish.
 *
 * IMPORTANT: This is SEPARATE from colorpro-prompt-builder.ts which
 * generates vehicles from scratch in a studio environment.
 *
 * @file myvehicle-prompt-builder.ts
 */

import { buildPanelLock, buildFinishLock } from "./hard-enforcement-blocks.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "./forbidden-text-instructions.ts";

const RESTYLEPRO_HEADER = `
═══════════════════════════════════════════════════════════════════════════════
🏢 RESTYLEPRO™ MY VEHICLE — PHOTO EDITING MODE
═══════════════════════════════════════════════════════════════════════════════

You are editing a REAL CUSTOMER PHOTOGRAPH for the RestylePro™ platform.
This is a professional automotive wrap visualization tool.

🚨 CRITICAL BRANDING RULES:
- NEVER reference any other brand, company, tool, watermark, or competitor label
- NEVER generate text such as "WRAPSTOCK", "DESIGN TOOL", or any third-party names
- NEVER place ANY text inside the rendered image
- Output ONLY the edited photograph with the wrap color applied

Your output must be a clean photograph with NO watermarks, NO text, NO logos.
═══════════════════════════════════════════════════════════════════════════════
`;

const PHOTO_EDIT_CORE_INSTRUCTIONS = `
═══════════════════════════════════════════════════════════════════════════════
📸 PHOTO EDITING MODE — RECOLOR VEHICLE BODY PANELS
═══════════════════════════════════════════════════════════════════════════════

You are a professional vehicle wrap visualization specialist.
You have been given a REAL PHOTOGRAPH of a customer's actual vehicle.

YOUR TASK: Recolor ONLY the vehicle's exterior body panels to visualize
a vinyl wrap in the specified color and finish. Everything else in the
photo must remain EXACTLY as it is.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔒 PRESERVATION RULES (NON-NEGOTIABLE):

1. PRESERVE the original photo EXACTLY — same background, environment,
   surroundings, parked location, driveway, street, building, sky, trees
2. PRESERVE the original lighting conditions — do NOT change time of day,
   shadow direction, ambient light color temperature, or brightness
3. PRESERVE the exact camera angle, perspective, and framing
4. PRESERVE all non-body-panel elements of the vehicle (see panel lock below)
5. PRESERVE the original image resolution and aspect ratio
6. PRESERVE any people, objects, or scenery visible in the photo

🎨 MODIFICATION RULES:

1. ONLY modify the paintable exterior body panels of the vehicle
2. Apply the specified wrap color as it would ACTUALLY APPEAR under the
   lighting conditions present in the original photograph
3. Maintain all panel gaps, body lines, creases, and contours from original
4. Preserve shadows ON the vehicle panels — shadows change shape with color
   but their position and direction stay the same
5. Adjust specular highlights to match the specified finish type
   (gloss = sharp reflections, matte = no reflections, satin = soft sheen)
6. The result MUST look like a real photograph of an actually wrapped vehicle,
   NOT a digital color overlay or tinted filter

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌤️ LIGHTING ADAPTATION (CRITICAL FOR REALISM):

The wrap color must be rendered AS IT WOULD APPEAR under the actual lighting
conditions in this specific photograph:

- If the photo was taken in DIRECT SUNLIGHT: wrap color appears brighter,
  more saturated on surfaces facing the sun. Shadows are harder.
- If the photo was taken on an OVERCAST day: wrap color appears more even,
  slightly desaturated. Soft diffused shadows.
- If the photo was taken at GOLDEN HOUR: wrap color takes on warm tones
  where light hits directly. Cool blue tones in shadows.
- If the photo was taken INDOORS/GARAGE: wrap color under artificial light.
  May have yellow/white cast depending on light type.
- If the photo was taken at NIGHT: wrap color appears darker, lit by
  available light sources (street lights, building lights).

DO NOT apply "studio lighting" to this photo. The wrap must look natural
within the EXISTING lighting environment of the photograph.

═══════════════════════════════════════════════════════════════════════════════
`;

/**
 * Builds the complete prompt for My Vehicle photo editing.
 *
 * COLOR IDENTITY: Film name + SKU + reference images are the authority.
 * Hex is kept in DB for legacy UI swatches only — it is NOT sent to Gemini.
 */
export function buildMyVehiclePrompt(params: {
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

  // ── Film identity block (replaces hex/LAB color lock) ──
  const filmIdentity = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 FILM COLOR IDENTITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANUFACTURER: ${manufacturer || 'Vinyl Film'}
FILM: ${colorName}
${sku ? `SKU: ${sku}` : ''}
FINISH: ${finish}

${groundingContext || `Apply ${manufacturer || 'manufacturer'} ${colorName}${sku ? ` (SKU ${sku})` : ''} — the actual manufactured vinyl film. Match the reference images provided. Do not interpret color numerically.`}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  // Build finish lock
  const finishBlock = buildFinishLock({
    finish,
    reflectivity,
    metallic_flake,
    finish_profile,
    metallic,
    pearl,
    chrome,
  });

  // Build panel lock (reuse existing — same wrap zone rules)
  const panelBlock = buildPanelLock();

  // Image input guide — adapted for film-grounded references
  const imageCount = hasReferenceImages ? 'IMAGE 3+ (if provided): Real-world reference photos of this film on vehicles — match the visual appearance' : '';
  const imageGuideBlock = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 IMAGE INPUT GUIDE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IMAGE 1: The customer's REAL vehicle photograph — THIS is what you are editing
IMAGE 2 (if provided): The manufacturer vinyl swatch — THIS is the color to apply
${imageCount}

COLOR AUTHORITY HIERARCHY:
1. REFERENCE IMAGES (swatch + vehicle examples) — highest authority, these show the REAL film
2. FILM NAME + MANUFACTURER — use your knowledge of this specific product
3. Visual appearance takes priority over any numerical color values

When applying the color from references to the photo:
- Account for the difference between reference lighting and the photo's lighting
- Maintain the film's characteristic HUE but adjust BRIGHTNESS for the photo's exposure
- Preserve any metallic flake, pearl shift, or color-shift properties of the film
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  // Vehicle info block (optional, for context)
  const vehicleBlock = vehicleInfo
    ? `
VEHICLE CONTEXT:
${vehicleInfo.year ? `Year: ${vehicleInfo.year}` : ''}
${vehicleInfo.make ? `Make: ${vehicleInfo.make}` : ''}
${vehicleInfo.model ? `Model: ${vehicleInfo.model}` : ''}
`
    : '';

  // Final quality check — no hex references
  const qualityCheck = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ QUALITY CHECKLIST — ALL MUST PASS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Does the background look IDENTICAL to the original photo? (same scene, same objects)
2. Are ONLY the body panels recolored? (no windows, wheels, trim, lights changed)
3. Does the wrap color visually match the reference images under the photo's actual lighting?
4. Is the ${finish} finish correctly represented? (gloss=reflective, matte=flat, satin=soft sheen)
5. Are panel gaps and body lines preserved from the original?
6. Do shadows and highlights look physically correct for the wrap color?
7. Is the result indistinguishable from a real photograph of a wrapped vehicle?
8. Is there ZERO text, watermarks, or branding in the output?

If ANY answer is NO, the edit FAILS.

OUTPUT: A photorealistic edited version of the customer's vehicle photo showing
${manufacturer || ''} ${colorName} ${finish} vinyl wrap applied to all exterior body panels.
The result must look like a REAL photograph, not a digital mockup.
`;

  // Assemble final prompt
  return `${RESTYLEPRO_HEADER}

${PHOTO_EDIT_CORE_INSTRUCTIONS}

${imageGuideBlock}

${filmIdentity}

${finishBlock}

${panelBlock}

${vehicleBlock}

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

${qualityCheck}`;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// DESIGN MODE PROMPT BUILDER
// Handles: DesignPanelPro, DesignPanelPro Premium, FadeWraps, ApproveMode, GraphicsPro
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const DESIGN_EDIT_HEADER = `
═══════════════════════════════════════════════════════════════════════════════
🏢 RESTYLEPRO™ MY VEHICLE — DESIGN APPLICATION MODE
═══════════════════════════════════════════════════════════════════════════════

You are editing a REAL CUSTOMER PHOTOGRAPH for the RestylePro™ platform.
You are applying a VINYL WRAP DESIGN to the vehicle body panels.

🚨 CRITICAL BRANDING RULES:
- NEVER reference any other brand, company, tool, watermark, or competitor label
- NEVER generate text such as "WRAPSTOCK", "DESIGN TOOL", or any third-party names
- NEVER place ANY text inside the rendered image (unless the design itself contains text)
- Output ONLY the edited photograph with the design applied

Your output must be a clean photograph with NO watermarks, NO added text, NO logos.
═══════════════════════════════════════════════════════════════════════════════
`;

/**
 * Builds a prompt for applying a design (panel, fade, 2D proof, or AI styling)
 * to a real customer vehicle photo.
 */
export function buildMyVehicleDesignPrompt(params: {
  toolSource: string;
  panelUrl?: string;
  panelName?: string;
  designUrl?: string;
  designName?: string;
  fadeStyle?: string;
  fadeSpec?: any;
  colorName?: string;
  colorHex?: string;
  customStylingPrompt?: string;
  finish?: string;
  vehicleInfo?: { make?: string; model?: string; year?: string };
}): string {
  const {
    toolSource, panelUrl, panelName, designUrl, designName,
    fadeStyle, fadeSpec, colorName, colorHex,
    customStylingPrompt, finish, vehicleInfo,
  } = params;

  // Vehicle context
  const vehicleBlock = vehicleInfo
    ? `
VEHICLE CONTEXT:
${vehicleInfo.year ? `Year: ${vehicleInfo.year}` : ''}
${vehicleInfo.make ? `Make: ${vehicleInfo.make}` : ''}
${vehicleInfo.model ? `Model: ${vehicleInfo.model}` : ''}
`
    : '';

  // Build tool-specific design instruction
  let designInstruction = '';

  if (toolSource === 'DesignPanelProPremium' || toolSource === 'DesignProAI') {
    // AI-generated 3D render → apply same wrap design to customer's real photo
    designInstruction = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 WRAP DESIGN TRANSFER — DesignIQ AI Render to Real Photo
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DESIGN NAME: ${panelName || designName || 'Custom Wrap Design'}
FINISH: ${finish || 'Gloss'}

IMAGE 1: The customer's REAL vehicle photograph — THIS is the vehicle you are editing.
         This is the ONLY vehicle that should appear in the output. Do NOT replace it.
IMAGE 2: A REFERENCE RENDER showing the EXACT wrap design that must appear on the
         customer's vehicle. The wrap visible on the studio vehicle in Image 2 IS the
         design — your job is to copy it verbatim onto the customer's car.

DESIGN FIDELITY — NON-NEGOTIABLE:
Reproduce the wrap design from IMAGE 2 with photographic fidelity. Every visible element
must carry over to the customer's vehicle:
  • Every color, gradient, and tone must match Image 2 exactly — no palette shifts,
    no recoloring, no "interpretation"
  • Every graphic, illustration, photograph, or pictorial element on Image 2's wrap
    (e.g. cakes, flowers, logos, characters, scenery) must appear on the customer's
    vehicle in the same positions, scale, and orientation relative to the body
  • Every word, letter, number, and typographic element visible on Image 2 must be
    reproduced character-for-character with the same font, weight, color, and layout
  • Every pattern, texture, stripe, splash, or graphic shape must be preserved
  • Do NOT invent new design elements, do NOT substitute a "similar style" wrap, do
    NOT generalize the theme. If Image 2 shows photographic wedding cakes with the
    text "WEDDING CAKES DELIVERED", the customer's vehicle MUST show photographic
    wedding cakes with the text "WEDDING CAKES DELIVERED" — not generic cake-themed
    graphics, not floral abstractions, not a new bakery design.

YOUR TASK:
Transfer the wrap design visible on the studio vehicle (Image 2) onto the customer's
ACTUAL vehicle (Image 1). You are editing the customer's photo, NOT creating a new image.

1. KEEP the customer's vehicle from Image 1 — same make, model, body shape, angle, scene
2. EXTRACT the wrap design from Image 2 — treat it as printed artwork wrapped around
   the studio vehicle's panels. Mentally "unwrap" it to understand the source design.
3. RE-WRAP that exact design onto the customer's vehicle body panels in Image 1,
   conforming to the customer vehicle's contours and panel shapes
4. PRESERVE every graphic, photograph, text element, color, and pattern from Image 2 —
   do not redesign, do not simplify, do not stylize differently
5. Account for the photo's ACTUAL lighting — the wrap should look natural in the scene
6. Apply proper ${finish} lamination finish (${finish === 'Gloss' ? 'sharp reflections, wet look' : finish === 'Matte' ? 'no reflections, flat surface' : 'soft sheen, subtle reflections'})
7. Maintain panel gaps, body lines, and contours from the original photo
8. DO NOT apply the design to windows, wheels, trim, lights, or bumpers
9. DO NOT change the vehicle make/model — the output vehicle MUST be the same as Image 1

The output is the customer's ORIGINAL PHOTO with ONLY the body panels changed to show
the EXACT wrap design from Image 2. Same vehicle, same scene, same angle — wrapped in
the identical artwork visible on the Image 2 studio vehicle.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  } else if (toolSource === 'DesignPanelPro' || toolSource === 'RestyleLibrary') {
    // Flat 2D panel from curated library → apply as wrap.
    // PatternPro (WBTY) also funnels through this branch, so wording must
    // enforce byte-accurate pattern reproduction — Gemini was drifting to
    // similar-looking patterns at default temperature (e.g. Pink Marble
    // rendering as Grecian Marble).
    designInstruction = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 DESIGN PANEL APPLICATION — Curated Library
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DESIGN NAME: ${panelName || 'Custom Design Panel'}
FINISH: ${finish || 'Gloss'}

IMAGE 1: The customer's REAL vehicle photograph — THIS is what you are editing
IMAGE 2: The vinyl wrap DESIGN PANEL (186" x 56" flat artwork) — THIS is the pattern/design to apply

PATTERN FIDELITY — NON-NEGOTIABLE:
Reproduce IMAGE 2 pixel-for-pixel on the body panels. Keep every color, shape,
vein, swirl, and texture byte-accurate to IMAGE 2. If IMAGE 2 is pink marble,
the wrap is pink marble. If IMAGE 2 is black carbon fiber, the wrap is black
carbon fiber. Never substitute a similar-looking pattern, never shift the
palette, never simplify the composition. Treat IMAGE 2 as a printed film you
are laying onto the customer's vehicle.

YOUR TASK:
Apply the design panel (Image 2) as a full vinyl wrap across ALL exterior body panels
of the vehicle in Image 1. The design should:

1. WRAP AROUND the vehicle body panels following the 3D contours and curvature
2. SCALE the design proportionally to cover the full vehicle body
3. PRESERVE the design's colors, patterns, gradients, and details EXACTLY as in IMAGE 2
4. Apply proper ${finish} lamination finish (${finish === 'Gloss' ? 'sharp reflections, wet look' : finish === 'Matte' ? 'no reflections, flat surface' : 'soft sheen, subtle reflections'})
5. Account for the photo's ACTUAL lighting — the design should appear as it would
   REALLY look under the photographed lighting conditions
6. Maintain panel gaps, body lines, and contours from the original photo
7. DO NOT apply the design to windows, wheels, trim, lights, or bumpers
8. The design wraps SEAMLESSLY across panels without visible seams
9. DO NOT change the vehicle make/model — the output vehicle MUST be the same as Image 1

The result must look like a REAL photograph of the customer's vehicle with IMAGE 2's
exact pattern professionally installed as a vinyl wrap.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  } else if (toolSource === 'FadeWraps') {
    // Fade/gradient wrap application
    designInstruction = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌊 FADE WRAP APPLICATION — FadeWraps
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FADE STYLE: ${fadeStyle || 'Standard Fade'}
COLOR: ${colorName || 'Custom'} (${colorHex || '#000000'})
FINISH: ${finish || 'Gloss'}
${fadeSpec ? `FADE SPEC: ${JSON.stringify(fadeSpec)}` : ''}

YOUR TASK:
Apply a fade/gradient vinyl wrap to the vehicle body panels. The wrap should:

1. Create a smooth gradient/fade effect using the specified color and style
2. Follow the fade pattern: the color is strongest at one end and fades to
   transparent/vehicle color at the other end
3. Apply proper ${finish} lamination finish
4. Account for the photo's ACTUAL lighting conditions
5. Maintain all panel gaps, body lines, and contours
6. DO NOT apply to windows, wheels, trim, lights, or chrome elements

The result must look like a REAL photograph of a vehicle with a professionally
installed fade wrap.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  } else if (toolSource === 'ApproveMode') {
    // 2D design proof application
    designInstruction = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 DESIGN PROOF APPLICATION — ApproveMode
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DESIGN NAME: ${designName || 'Custom Design Proof'}

IMAGE 1: The customer's REAL vehicle photograph — THIS is what you are editing
IMAGE 2: The 2D design proof/artwork — THIS is the wrap design to apply

YOUR TASK:
Apply the 2D design proof (Image 2) as a full vinyl wrap across the vehicle
body panels in Image 1. This is a customer's design proof that needs to be
visualized on their actual vehicle. The design should:

1. WRAP the 2D artwork around the vehicle's 3D body panels
2. PRESERVE all elements of the design (logos, text, graphics, colors)
3. SCALE and POSITION the design appropriately on the vehicle body
4. Account for the photo's ACTUAL lighting conditions
5. Maintain panel gaps, body lines, and contours
6. DO NOT apply to windows, wheels, trim, or lights unless the design
   explicitly includes those areas
7. Text and logos in the design should follow the vehicle's curvature

The result must look like a REAL photograph of the vehicle with this exact
design professionally installed as a vinyl wrap.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  } else if (toolSource === 'GraphicsPro') {
    // AI graphics styling application
    designInstruction = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 GRAPHICS STYLING APPLICATION — GraphicsPro
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

STYLING PROMPT: ${customStylingPrompt || 'Custom styling'}
FINISH: ${finish || 'Gloss'}

YOUR TASK:
Apply custom graphics/styling to the vehicle body panels based on the styling
prompt above. This is a creative AI-driven design application:

1. Interpret the styling prompt and create appropriate graphics on the vehicle
2. Apply the graphics to the exterior body panels only
3. Apply proper ${finish} lamination finish
4. Account for the photo's ACTUAL lighting conditions
5. Maintain panel gaps, body lines, and contours
6. DO NOT modify windows, wheels, trim, or lights
7. The styling should look professionally designed and installed

The result must look like a REAL photograph of a custom-styled vehicle.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  } else {
    // Fallback — generic design application
    designInstruction = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 DESIGN APPLICATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Apply the provided design to the vehicle body panels.
Preserve the original photo background, lighting, and non-panel elements.
The result must look like a real photograph of a wrapped vehicle.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;
  }

  // Preservation rules (shared across all design modes)
  const preservationRules = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔒 PRESERVATION RULES (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. PRESERVE the original photo EXACTLY — same background, environment, scene
2. PRESERVE the original lighting conditions — do NOT change lighting
3. PRESERVE the exact camera angle, perspective, and framing
4. PRESERVE all non-body-panel elements (wheels, windows, trim, lights, chrome)
5. PRESERVE the original image resolution and aspect ratio
6. PRESERVE any people, objects, or scenery visible in the photo
7. The ONLY change is the vehicle body panel appearance

🌤️ LIGHTING: The design must appear as it would under the ACTUAL lighting
conditions in this photograph. DO NOT apply studio lighting.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  // Quality check
  const qualityCheck = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ QUALITY CHECKLIST
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Background identical to original?
2. Only body panels modified?
3. Design properly wrapped around 3D contours?
4. Lighting conditions preserved from original photo?
5. No unwanted text, watermarks, or branding added?
6. Result looks like a real photograph (not a mockup)?

OUTPUT: A photorealistic edited version of the customer's vehicle photo
with the specified design applied as a professional vinyl wrap.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`;

  return `${DESIGN_EDIT_HEADER}

${designInstruction}

${preservationRules}

${vehicleBlock}

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

${qualityCheck}`;
}
