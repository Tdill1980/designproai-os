// ============================================================================
// RESTYLEPRO UNIFIED RENDER PROMPT BUILDER
//
// MODES SUPPORTED:
//   - "color"  (ColorPro strict manufacturer mode)
//   - "pattern" (PatternPro printed wrap mode)
//   - "panel" (DesignPanelPro flat panel visualization)
// ============================================================================

import { ASPECT_RATIO_REQUIREMENT } from "./aspect-ratio-requirement.ts";
import { PHOTOREALISM_REQUIREMENT } from "./photorealism-prompt.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "./forbidden-text-instructions.ts";
import { STUDIO_ENVIRONMENT, getFinishSpecification } from "./finish-specifications.ts";

// Environment presets
export const ENVIRONMENT_PRESETS: Record<string, string> = {
  studio: STUDIO_ENVIRONMENT,
  sunlight: `Outdoor setting with direct bright sunlight from upper-left. Clear blue sky. Light natural reflections on vehicle body. Subtle ground shadows. Clean asphalt surface.`,
  overcast: `Outdoor setting with soft diffused overcast lighting. Even illumination across vehicle. Muted reflections. Neutral gray sky gradient.`,
  garage: `Indoor garage/workshop setting. Overhead fluorescent lighting. Concrete floor with subtle oil stains. Industrial aesthetic.`,
  night: `Nighttime urban setting. Dramatic artificial lighting from streetlamps. Wet reflective asphalt. City ambient glow in background.`
};

// Type definitions
export type RenderMode = "color" | "pattern" | "panel";

export interface UnifiedRenderParams {
  mode: RenderMode;

  // SHARED
  vehicle: string;
  cameraPositioning: any;
  viewType?: string;
  environment?: keyof typeof ENVIRONMENT_PRESETS;
  branding?: boolean;
  debugMode?: boolean;

  // COLORPRO STRICT
  colorName?: string;
  manufacturer?: string;
  hex?: string;
  lab?: { L: number; a: number; b: number };
  finish?: string;
  reflectivity?: number;
  metallic_flake?: number;
  finish_profile?: any;
  isColorFlipFilm?: boolean;
  referenceImages?: string[];
  validatedColorData?: any;
  colorIntelligence?: any;
  groundedDescription?: string;

  // PATTERNPRO
  patternName?: string;
  patternScale?: number;
  patternCategory?: "marble" | "carbon" | "camo" | "geometric" | "abstract";
  textureProfile?: any;

  // DESIGNPANELPRO
  panelName?: string;
  panelUrl?: string;
  dpi?: number;
  bleedInches?: number;
  panels?: { name: string; widthInches: number; heightInches: number }[];
}

// Validation helper
function assert(condition: any, errorMessage: string): asserts condition {
  if (!condition) {
    throw new Error("❌ UnifiedBuilderError: " + errorMessage);
  }
}

// Base shared prompt section
function baseSection(params: UnifiedRenderParams): string {
  const env = params.environment || "studio";

  return `
${ASPECT_RATIO_REQUIREMENT}

${PHOTOREALISM_REQUIREMENT}

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚗 VEHICLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${params.vehicle}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📸 CAMERA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Required Positioning:
${JSON.stringify(params.cameraPositioning)}

View Type:
${params.viewType || "side"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌤️ ENVIRONMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${ENVIRONMENT_PRESETS[env] || STUDIO_ENVIRONMENT}
`;
}

// Strict ColorPro section (manufacturer-first mode)
function colorProSection(params: UnifiedRenderParams): string {
  assert(params.colorName, "ColorPro requires colorName");
  // Manufacturer may be empty for custom/InkFusion colors — default gracefully
  if (!params.manufacturer) {
    console.warn("⚠️ ColorPro: manufacturer not provided, defaulting to 'Unknown'");
    params.manufacturer = "Unknown";
  }
  // Hex is optional for manufacturer film colors — the color name + manufacturer is the real identifier
  if (!params.hex) {
    console.warn(`⚠️ ColorPro: hex not provided for ${params.manufacturer} ${params.colorName}, using fallback`);
    params.hex = "#808080";
  }
  assert(params.finish, "ColorPro requires finish type");

  const finishSpec = getFinishSpecification(params.finish);
  
  // Build LAB section if available
  let labSection = "";
  if (params.lab) {
    labSection = `
PRIMARY TRUTH — LAB VALUES:
L: ${params.lab.L}
a: ${params.lab.a}
b: ${params.lab.b}

NO color reinterpretation.
NO saturation adjustments.
NO hue shifting.
NO "AI creativity".`;
  }

  // Build material profile section if available
  let materialSection = "";
  if (params.finish_profile || params.reflectivity !== undefined || params.metallic_flake !== undefined) {
    materialSection = `
FINISH PROFILE:
${params.finish_profile ? JSON.stringify(params.finish_profile, null, 2) : "Not available"}

Reflectivity: ${params.reflectivity ?? "Not specified"}
Metallic Flake: ${params.metallic_flake ?? "Not specified"}`;
  }

  // Build reference images section
  let referenceSection = "";
  if (params.referenceImages && params.referenceImages.length > 0) {
    referenceSection = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANUFACTURER SWATCH — PRIMARY COLOR AUTHORITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
An official manufacturer swatch image is attached.
This is real ${params.manufacturer} ${params.colorName} vinyl film.

MATCH THIS SWATCH EXACTLY:
- The attached swatch image IS the real color — reproduce it precisely
- Vinyl films have depth, metallic flakes, pearlescence, and sheen
  that a hex code cannot capture — the image is the truth
- Match the exact hue, saturation, brightness, and material character
- The hex code (${params.hex}) is only a rough digital approximation
- If the swatch image and hex disagree, FOLLOW THE SWATCH IMAGE`;
  }

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT COLORPRO MODE — MANUFACTURER FIRST, PHOTO SECOND
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

COLOR NAME: ${params.colorName}
MANUFACTURER: ${params.manufacturer}
HEX (rough guide only — swatch image overrides): ${params.hex}
${params.groundedDescription ? `\nREAL-WORLD FILM APPEARANCE (from Google Search):\n${params.groundedDescription}\n` : ''}
${labSection}
${materialSection}

Finish Specification:
${JSON.stringify(finishSpec, null, 2)}

COLOR-FLIP:
${params.isColorFlipFilm ? "YES — angle-based shift required" : "NO"}
${referenceSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL RENDER REQUIREMENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Produce a photorealistic image of ${params.vehicle}
wrapped in EXACT ${params.manufacturer} ${params.colorName}
with finish: ${params.finish}.
The color MUST match the attached manufacturer swatch image.
${params.lab ? "LAB must match EXACTLY." : ""}
Finish behavior must match EXACTLY.
`;
}

// PatternPro section
function patternProSection(params: UnifiedRenderParams): string {
  assert(params.patternName, "PatternPro requires patternName");

  const category = params.patternCategory || "abstract";
  const scale = params.patternScale ?? 1;

  const categoryRules: Record<string, string> = {
    marble: `
- Natural vein flow following body curves
- Zero visible tiling or repetition seams
- Subtle depth and organic variation`,
    carbon: `
- Weave must align with body lines
- Sharp pattern definition
- Anisotropic highlight reflection required`,
    camo: `
- Irregular organic shapes
- No procedural repetition artifacts
- Smooth blending between tones`,
    geometric: `
- Sharp edges and exact symmetry
- No warping across curves
- Consistent scale on all panels`,
    abstract: `
- Preserve all artistic intent
- No AI modification of pattern colors or shapes`,
  };

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATTERNPRO MODE — PRINTED PATTERN WRAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATTERN NAME: ${params.patternName}
CATEGORY: ${category}
SCALE: ${scale}

CATEGORY RULES:
${categoryRules[category] || categoryRules.abstract}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SEAMLESS TILING REQUIREMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- ZERO visible seams
- Pattern flows naturally across doors, fenders, bumpers
- No stretching on tight curves
- Maintain exact pattern scale

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINAL OUTPUT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Photorealistic wrap of ${params.vehicle}
with printed pattern: ${params.patternName}
`;
}

// DesignPanelPro section
function panelProSection(params: UnifiedRenderParams): string {
  assert(params.panelUrl, "PanelPro requires panelUrl");

  const dpi = params.dpi ?? 150;
  const bleed = params.bleedInches ?? 0.125;

  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DESIGNPANELPRO MODE — PANEL VISUALIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PANEL IMAGE:
${params.panelUrl}

DPI: ${dpi}
BLEED: ${bleed}"

REQUIREMENTS:
- Apply panel design as full-body vehicle wrap
- Seamless coverage across all body panels
- No visible seams or discontinuities
- Scale design appropriately across surfaces
- Exclude windows, lights, wheels, trim from wrap

FINAL OUTPUT:
Photorealistic vehicle visualization with panel design applied as wrap.
`;
}

// Debug block
function debugSection(params: UnifiedRenderParams): string {
  if (!params.debugMode) return "";
  return `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟦 DEBUG MODE — INTERNAL ONLY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${JSON.stringify(params, null, 2)}
`;
}

// Main unified builder
export function buildRestyleProRenderPrompt(params: UnifiedRenderParams): string {
  const base = baseSection(params);

  let modeBlock = "";
  switch (params.mode) {
    case "color":
      modeBlock = colorProSection(params);
      break;
    case "pattern":
      modeBlock = patternProSection(params);
      break;
    case "panel":
      modeBlock = panelProSection(params);
      break;
    default:
      throw new Error("❌ Invalid mode passed to unified render builder");
  }

  const debug = debugSection(params);

  return `${base}\n${modeBlock}\n${debug}`;
}
