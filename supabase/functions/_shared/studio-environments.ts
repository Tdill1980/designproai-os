/**
 * Studio Environment Presets for RestylePro Render Engine
 *
 * All presets import the base studio from studio-os.ts (single source of truth).
 * Each preset extends the base with mode-specific lighting and camera behavior.
 *
 * - HARD_LIGHT_STUDIO: For chrome, brushed, metallic, carbon (requires visible reflections)
 * - SOFT_DIFFUSION_STUDIO: For gloss, satin, matte (clean color-change film rendering)
 * - CINEMATIC_STUDIO: Optional user override for dramatic social media shots
 *
 * CRITICAL: Chrome/metallic finishes CANNOT render correctly in soft light studios.
 * The automatic selection logic ensures proper studio matching.
 */

import {
  STUDIO_ENVIRONMENT,
  STUDIO_REINFORCEMENT,
  LIGHT_STUDIO_ENVIRONMENT,
  LIGHT_STUDIO_REINFORCEMENT,
} from './studio-os.ts';

// Re-export for convenience
export {
  STUDIO_ENVIRONMENT,
  STUDIO_REINFORCEMENT,
  LIGHT_STUDIO_ENVIRONMENT,
  LIGHT_STUDIO_REINFORCEMENT,
};

export type StudioType = 'auto' | 'hard_light' | 'soft_diffusion' | 'cinematic';
export type StudioMode = 'dark' | 'light';

// ============================================================================
// HARD LIGHT STUDIO (CHROME-COMPATIBLE)
// ============================================================================
// This studio produces CORRECT rendering for:
// - Chrome/Mirror finishes (visible reflections of light panels)
// - Brushed metal (directional anisotropic reflections)
// - Metallic (sparkle particles catching hard light)
// - Carbon fiber (weave pattern with clearcoat reflections)
// ============================================================================
export const HARD_LIGHT_STUDIO = `
${STUDIO_ENVIRONMENT}

HARD LIGHT MODE — CHROME-COMPATIBLE ADDITIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ THE LIGHT SOURCES THEMSELVES ARE NEVER VISIBLE IN THE FRAME ⚠️
- Light panels exist ONLY as reflections IN the chrome surface
- Think: photographing chrome in a professional studio with lights positioned OFF-CAMERA
- Large softbox panels are positioned OFF-CAMERA (outside the frame)
- These panels CREATE reflections on chrome surfaces
- The reflections appear as elongated rectangular highlights on curved chrome
- But the actual light fixtures are NEVER visible in the photo itself
- STRONG contrast between studio environment and bright reflections on chrome

CHROME RENDERING REQUIREMENTS:
- Chrome MUST show mirror-like reflections (rectangular highlights from off-camera panels)
- Chrome surfaces reflect the studio environment + bright panel shapes
- HIGH contrast reflections
- Chrome should look like liquid gold/silver mirror, not glossy paint
- The REFLECTIONS are visible on chrome, NOT the light sources themselves

CAMERA:
- 50mm automotive studio perspective
- f/8 aperture for sharp depth of field
- 16:9 aspect ratio

DO NOT add ANY text, watermarks, logos, or branding to this image.
All branding is added AFTER generation via overlay.

${STUDIO_REINFORCEMENT}
`;

// ============================================================================
// SHARP STUDIO (COLOR-CHANGE FILM — NON-CHROME)
// ============================================================================
// Optimized for gloss, satin, and matte finishes with SHARP, CRISP output.
// Uses f/8 for maximum sharpness and higher contrast than the old soft studio.
//
// WARNING: This studio CANNOT render chrome correctly!
// ============================================================================
export const SOFT_DIFFUSION_STUDIO = `
${STUDIO_ENVIRONMENT}

SHARP STUDIO MODE — COLOR-CHANGE FILM:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADDITIONAL LIGHTING:
- Key light from above — bright, even illumination — light SOURCE is INVISIBLE, ceiling is EMPTY
- Fill light from front-right at 45° (eliminates harsh shadows) — light SOURCE is INVISIBLE
- Strong rim/edge light highlighting vehicle contours and wrap edges — light SOURCE is INVISIBLE
- Defined shadow fall 15-20° from vehicle base on dark floor
- ⚠️ NO visible ceiling lights, panels, or fixtures — EVER
- Neutral white balance (5500K-6500K)
- Medium-high contrast ratio for sharp, punchy tonal range

CAMERA:
- Professional DSLR 50mm lens characteristics
- f/8 aperture for MAXIMUM sharpness across entire vehicle (deep depth of field)
- 1/250s shutter speed frozen motion
- 16:9 aspect ratio framing
- Every detail razor-sharp from front bumper to rear — NO blur, NO soft focus

FINISH BEHAVIOR IN THIS STUDIO:
- GLOSS: Crisp reflections, wet-look appearance, sharp defined highlights
- SATIN: Subtle sheen, eggshell appearance, clean highlights
- MATTE: Zero reflections, fully flat, light absorbed completely

⚠️ WARNING: DO NOT use this studio for chrome, brushed, metallic, or carbon finishes.
Chrome requires visible light panels to reflect — this studio has none.

${STUDIO_REINFORCEMENT}
`;

// ============================================================================
// CINEMATIC STUDIO (SOCIAL MEDIA / DRAMATIC)
// ============================================================================
// Optional user override for promotional/advertising shots
// High contrast, dramatic lighting, social media ready
// ============================================================================
export const CINEMATIC_STUDIO = `
🎬 CINEMATIC STUDIO (SOCIAL MEDIA / DRAMATIC)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

FLOOR:
- Wet black reflective floor (#0a0a0a) with strong mirror reflection
- Light streaks visible in reflection
- Dramatic floor bounce

WALL/BACKGROUND:
- Very dark/black background (#0a0a0a to #050505)
- Minimal visibility - vehicle is the hero
- Optional subtle color accent in background

LIGHTING (DRAMATIC):
- Strong rim light from behind (dramatic silhouette edge)
- Single hard key light from 45° upper-left
- Deep shadows for mood and drama
- Strong contrast ratio (8:1 or higher)
- Optional accent lighting (cyan/magenta rim for style)
- Specular highlights intentionally hot

MOOD:
- Cinematic, moody, social media ready
- High contrast, dramatic shadows
- Perfect for advertising/promotional renders
- Eye-catching and shareable

CAMERA:
- 35mm-50mm cinematic lens
- Shallow depth of field (f/2.0-2.8)
- Dramatic framing
- 16:9 widescreen aspect

BEST FOR: Promotional shots, social media content, advertising renders.
`;

// ============================================================================
// LIGHT MODE STUDIOS — White environment for light-mode presentation
// ============================================================================

export const LIGHT_HARD_STUDIO = `
${LIGHT_STUDIO_ENVIRONMENT}

HARD LIGHT MODE — CHROME-COMPATIBLE ADDITIONS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ THE LIGHT SOURCES THEMSELVES ARE NEVER VISIBLE IN THE FRAME ⚠️
- Light panels exist ONLY as reflections IN the chrome surface
- Think: photographing chrome in a professional white studio with lights positioned OFF-CAMERA
- Large softbox panels are positioned OFF-CAMERA (outside the frame)
- These panels CREATE reflections on chrome surfaces
- The reflections appear as elongated rectangular highlights on curved chrome
- But the actual light fixtures are NEVER visible in the photo itself
- STRONG contrast between white studio environment and bright reflections on chrome

CHROME RENDERING REQUIREMENTS:
- Chrome MUST show mirror-like reflections (rectangular highlights from off-camera panels)
- Chrome surfaces reflect the white studio environment + bright panel shapes
- HIGH contrast reflections
- Chrome should look like liquid gold/silver mirror, not glossy paint
- The REFLECTIONS are visible on chrome, NOT the light sources themselves

CAMERA:
- 50mm automotive studio perspective
- f/8 aperture for sharp depth of field
- 16:9 aspect ratio

DO NOT add ANY text, watermarks, logos, or branding to this image.
All branding is added AFTER generation via overlay.

${LIGHT_STUDIO_REINFORCEMENT}
`;

export const LIGHT_SOFT_STUDIO = `
${LIGHT_STUDIO_ENVIRONMENT}

SHARP STUDIO MODE — COLOR-CHANGE FILM (LIGHT):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ADDITIONAL LIGHTING:
- Key light from above — bright, even illumination — light SOURCE is INVISIBLE, ceiling is EMPTY
- Fill light from front-right at 45° (eliminates harsh shadows) — light SOURCE is INVISIBLE
- Strong rim/edge light highlighting vehicle contours and wrap edges — light SOURCE is INVISIBLE
- Defined shadow fall 15-20° from vehicle base on white floor
- ⚠️ NO visible ceiling lights, panels, or fixtures — EVER
- Neutral white balance (5500K-6500K)
- Medium-high contrast ratio for sharp, punchy tonal range

CAMERA:
- Professional DSLR 50mm lens characteristics
- f/8 aperture for MAXIMUM sharpness across entire vehicle (deep depth of field)
- 1/250s shutter speed frozen motion
- 16:9 aspect ratio framing
- Every detail razor-sharp from front bumper to rear — NO blur, NO soft focus

FINISH BEHAVIOR IN THIS STUDIO:
- GLOSS: Crisp reflections, wet-look appearance, sharp defined highlights
- SATIN: Subtle sheen, eggshell appearance, clean highlights
- MATTE: Zero reflections, fully flat, light absorbed completely

${LIGHT_STUDIO_REINFORCEMENT}
`;

// ============================================================================
// AUTOMATIC STUDIO SELECTION LOGIC
// ============================================================================

/**
 * Finishes that REQUIRE hard light studio for correct rendering
 * Chrome especially cannot render in soft diffusion (no light panels to reflect)
 */
const HARD_LIGHT_FINISHES = [
  'chrome',
  'mirror',
  'brushed',
  'brushed metal',
  'metallic',
  'carbon',
  'carbon fiber'
];

/**
 * Automatically select the best studio based on a single finish type
 *
 * @param finish - The finish type (chrome, satin, matte, gloss, etc.)
 * @returns StudioType - 'hard_light' or 'soft_diffusion'
 */
export function selectStudioForFinish(finish: string): StudioType {
  // Hard light produces the sharpest, most professional renders and works for ALL finishes.
  // It's the preferred default — soft diffusion made renders look fuzzy.
  return 'hard_light';
}

/**
 * For multi-zone renders: if ANY zone needs hard light, use hard light for ALL
 *
 * CRITICAL: Hard light works acceptably for all finishes, but soft light BREAKS chrome.
 * When mixing finishes (e.g., "gold chrome top, satin black bottom"), we MUST use
 * the hard light studio or the chrome zone will render incorrectly.
 *
 * @param zones - Array of zones with finish_profile or finish properties
 * @returns StudioType - 'hard_light' if any zone needs it, otherwise 'soft_diffusion'
 */
export function selectStudioForZones(zones: Array<{
  finish_profile?: string;
  finish?: string
}>): StudioType {
  // Hard light is now the universal default — sharp, professional results for all finishes.
  return 'hard_light';
}

/**
 * Get the full studio environment string by type
 *
 * @param type - StudioType ('auto', 'hard_light', 'soft_diffusion', 'cinematic')
 * @param finish - Optional finish for 'auto' mode selection
 * @param zones - Optional zones array for 'auto' mode multi-zone selection
 * @returns string - The complete studio environment prompt block
 */
export function getStudioEnvironment(
  type: StudioType,
  finish?: string,
  zones?: Array<{ finish_profile?: string; finish?: string }>
): string {
  // Handle 'auto' mode
  if (type === 'auto') {
    // Multi-zone takes priority
    if (zones && zones.length > 0) {
      const selectedType = selectStudioForZones(zones);
      return selectedType === 'hard_light' ? HARD_LIGHT_STUDIO : SOFT_DIFFUSION_STUDIO;
    }
    // Single finish
    if (finish) {
      const selectedType = selectStudioForFinish(finish);
      return selectedType === 'hard_light' ? HARD_LIGHT_STUDIO : SOFT_DIFFUSION_STUDIO;
    }
    // Default to hard light (sharpest, most professional results)
    return HARD_LIGHT_STUDIO;
  }

  // Handle explicit selections
  switch (type) {
    case 'hard_light':
      return HARD_LIGHT_STUDIO;
    case 'cinematic':
      return CINEMATIC_STUDIO;
    case 'soft_diffusion':
    default:
      return SOFT_DIFFUSION_STUDIO;
  }
}

/**
 * Helper to determine if a finish requires hard light studio
 */
export function requiresHardLightStudio(finish: string): boolean {
  return HARD_LIGHT_FINISHES.includes((finish || '').toLowerCase().trim());
}

/**
 * Get studio environment string for a given mode (dark/light).
 * When studioMode is 'light', returns the white-background variant
 * of the appropriate studio type.
 */
export function getStudioForMode(
  studioMode: StudioMode,
  type?: StudioType,
  finish?: string,
  zones?: Array<{ finish_profile?: string; finish?: string }>
): string {
  if (studioMode === 'light') {
    // Light mode always returns the white-background variant
    return LIGHT_HARD_STUDIO;
  }
  // Dark mode (default) — use normal selection
  return getStudioEnvironment(type || 'auto', finish, zones);
}
