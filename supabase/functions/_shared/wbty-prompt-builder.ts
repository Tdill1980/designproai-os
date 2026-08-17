import { ASPECT_RATIO_REQUIREMENT } from "./aspect-ratio-requirement.ts";
import { PHOTOREALISM_REQUIREMENT } from "./photorealism-prompt.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "./forbidden-text-instructions.ts";
import { getFinishSpecification, STUDIO_ENVIRONMENT } from "./finish-specifications.ts";

export function buildWBTYPrompt(params: {
  vehicle: string;
  colorData: any;
  finish: string;
  patternScale: number;
  cameraAngle: string;
}): string {
  const { vehicle, colorData, finish, patternScale, cameraAngle } = params;
  
  const scalePercentage = (patternScale * 100).toFixed(0);
  const basePatternSize = 12;
  const scaledPatternSize = basePatternSize * patternScale;
  
  const glossFinish = getFinishSpecification(finish);
  
  const scaleInstructions = patternScale > 1.5 
    ? `🔴 EXTREME LARGE SCALE (${scalePercentage}%):
- Each pattern tile from the image should cover approximately ${scaledPatternSize} inches on the vehicle
- This is MUCH LARGER than normal - think OVERSIZED pattern elements
- On a typical hood (60 inches wide), you should see only ${Math.floor(60 / scaledPatternSize)} pattern repeats across
- Pattern elements should be DRAMATICALLY LARGER - almost billboard-sized
- FEWER tiles, BIGGER individual pattern elements
- Think: massive, bold, statement piece effect`
    : patternScale > 1 
    ? `🟡 LARGE SCALE (${scalePercentage}%):
- Each pattern tile should be ${scaledPatternSize} inches (LARGER than standard 12 inches)
- On a hood, expect only ${Math.floor(60 / scaledPatternSize)}-${Math.ceil(60 / scaledPatternSize)} pattern repeats instead of 5
- Pattern elements are NOTICEABLY BIGGER
- LESS tiling, LARGER individual elements`
    : patternScale < 0.7 
    ? `🔵 MICRO SCALE (${scalePercentage}%):
- Each pattern tile should be tiny - only ${scaledPatternSize} inches
- On a hood, you should see ${Math.floor(60 / scaledPatternSize)} or MORE pattern repeats
- Pattern elements are VERY SMALL and detailed
- MORE tiling, SMALLER individual elements`
    : `🟢 STANDARD SCALE (${scalePercentage}%):
- Each pattern tile is approximately 12 inches
- Standard repeating pattern size`;

  return `${ASPECT_RATIO_REQUIREMENT}

${PHOTOREALISM_REQUIREMENT}

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

Apply the provided seamless pattern as a vinyl wrap to this ${vehicle}.

PATTERN APPLICATION - CRITICAL SCALING REQUIREMENT:
⚠️ MANDATORY: The provided pattern image shows ONE SINGLE TILE. You MUST tile/repeat this pattern across the vehicle.

${scaleInstructions}

PATTERN EXTRACTION - CRITICAL SEPARATION:
✅ EXTRACT AND USE FROM SWATCH IMAGE:
- Visual pattern shapes, textures, and geometry ONLY
- Color palette, gradients, and material appearance
- Pattern flow direction and organic elements (marble veins, carbon weave, camo shapes)

❌ ABSOLUTELY DO NOT COPY FROM SWATCH IMAGE:
- ANY text, fonts, typography, or lettering (like "EGYPTIAN MARBLE", product names, labels)
- Manufacturer watermarks, logos, or brand names
- Sample codes, SKU numbers, or size indicators
- ANY visible words, letters, numbers, or symbols on the swatch

CLARIFICATION: "EXACT pattern" means the VISUAL TEXTURE ONLY.
If the swatch shows text overlays like "CARBON FIBER" or "EGYPTIAN MARBLE", that text is a LABEL - NOT part of the pattern. Render ONLY the underlying visual pattern, NEVER any text from the swatch.

- Use the EXACT visual pattern texture from the provided image (NOT any text overlays)
- Seamless tiling with NO visible seams between repeats
- NO distortion or stretching - maintain pattern integrity
- Pattern wraps around edges naturally following body geometry
- Show pattern details clearly on hood, fenders, doors, all visible panels
- Pattern texture visible and matches source image exactly
- NEVER wrap wheels, tires, or rims - these MUST remain original black
- NEVER wrap windshield, windows, or any glass surfaces - glass MUST remain transparent and clear
- NEVER wrap headlights, taillights, or any lighting elements

CAMERA ANGLE: ${cameraAngle}

${STUDIO_ENVIRONMENT}

${glossFinish}

WRAP INSTALLATION QUALITY:
- Professional installation - perfectly smooth, zero bubbles or wrinkles
- Wrap edges tucked and sealed perfectly
- Material follows every curve and body line precisely
- Pattern maintains consistency across all panels
- Realistic vinyl wrap texture visible up close
- ${finish === 'gloss' ? 'Clear glossy coat with depth and shine' : finish === 'satin' ? 'Silk-like satin surface' : 'Flat matte non-reflective surface'}

🚫🚫🚫 ABSOLUTE TEXT PROHIBITION - CRITICAL 🚫🚫🚫
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
GENERATE ZERO TEXT IN THIS IMAGE.
DO NOT ADD:
❌ Tool name badges (PatternPro™, etc.)
❌ Vehicle name text
❌ Pattern name text  
❌ ANY text overlays whatsoever
❌ Watermarks of any kind
❌ Text copied from swatch images (like "EGYPTIAN MARBLE", "CARBON FIBER", etc.)
❌ Any fonts, lettering, numbers, or symbols

The image must contain ONLY the wrapped vehicle - NO TEXT AT ALL.
Text overlays will be added CLIENT-SIDE with correct fonts after generation.
If you add ANY text to the image, the render FAILS quality review.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

OUTPUT: Ultra-photorealistic professional automotive photography showing ${vehicle} wrapped with custom pattern in ${finish} finish. MUST be EXACTLY 16:9 landscape (1792x1008 or 1920x1080). Must be indistinguishable from a real photograph. NO TEXT IN IMAGE.`;
}
