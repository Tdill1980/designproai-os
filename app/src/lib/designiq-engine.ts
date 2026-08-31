/**
 * DesignIQ Engine v1.1
 *
 * Prompt intelligence layer that silently enhances a user's raw creative
 * prompt with wrap-industry fundamentals.  The user types something simple
 * like "Japanese dragon with fire" - the engine wraps it with everything a
 * 20-year wrap veteran knows matters for printable vinyl: print fidelity,
 * visual flow, tiling, panel-zone focus, viewing distance, and more.
 *
 * The user's original prompt stays the creative heart.  The intelligence
 * layer just makes it print-ready, install-friendly, and vehicle-aware
 * without the user ever seeing the scaffolding.
 *
 * Two context modes:
 *   ReStyle    - artistic / aesthetic
 *   Commercial - brand-focused with fleet and billboard considerations
 *
 * NOTE: The edge function contains its own copy of buildDesignIQPrompt
 * because Deno edge functions cannot import from src/.  Keep both in sync.
 */

// ---------------------------------------------------------------------------
// TrueSpec - metadata fingerprint embedded with every generation
// ---------------------------------------------------------------------------

export const DESIGNIQ_ENGINE_VERSION = '1.1.0';

export interface TrueSpec {
  creatorId: string;
  generatedAt: string;
  engineVersion: string;
  mode: 'restyle' | 'commercial';
  preset: string;
  finish: string;
}

export function buildTrueSpec(
  creatorId: string,
  mode: 'restyle' | 'commercial',
  preset: string,
  finish: string,
): TrueSpec {
  return {
    creatorId,
    generatedAt: new Date().toISOString(),
    engineVersion: DESIGNIQ_ENGINE_VERSION,
    mode,
    preset,
    finish,
  };
}

// ---------------------------------------------------------------------------
// Industry presets (label + key only - intelligence lives in the
// prompt builder, not in per-preset config objects)
// ---------------------------------------------------------------------------

export type VisionBoardIntent = 'style_inspiration' | 'exact_reference';

export interface VisionBoardImage {
  slotLabel: string;
  storageUrl: string;
}

export interface IndustryPreset {
  label: string;
  key: string;
}

export const COMMERCIAL_INDUSTRIES: IndustryPreset[] = [
  { label: 'Food and Beverage', key: 'food-beverage' },
  { label: 'Construction', key: 'construction' },
  { label: 'Automotive', key: 'automotive' },
  { label: 'Healthcare', key: 'healthcare' },
  { label: 'Real Estate', key: 'real-estate' },
  { label: 'Landscaping', key: 'landscaping' },
  { label: 'Delivery', key: 'delivery' },
  { label: 'Entertainment', key: 'entertainment' },
  { label: 'Other', key: 'other' },
];

// ---------------------------------------------------------------------------
// Prompt builder params
// ---------------------------------------------------------------------------

export type PrintSubstrate =
  | 'standard'           // White cast vinyl (default)
  | 'color_change_film'  // Print on metallic/pearl/color-shift base film
  | 'chrome_film'        // Print on chrome/mirror base film
  | 'satin_film';        // Print on satin/silk base film

export const SUBSTRATE_SPECS: Record<PrintSubstrate, { label: string; shortLabel: string; description: string; promptContext: string }> = {
  standard: {
    label: 'Standard Print Vinyl',
    shortLabel: 'Standard',
    description: 'Printed on white cast vinyl — WYSIWYG color accuracy',
    promptContext: 'This design is printed on standard white cast vinyl film and laminated. Colors render exactly as designed — solid, opaque, and true to the color values. The vinyl surface should look like professional laminated print vinyl, not automotive paint.',
  },
  color_change_film: {
    label: 'Print on Color-Change Film',
    shortLabel: 'Color-Change',
    description: 'Printed on metallic, pearl, or color-shift base film — base film shows through',
    promptContext: 'This design is printed on a color-change specialty base film (metallic, pearl, or color-shift vinyl). The metallic/pearl base film shows through the printed ink layer, creating a luminous, color-shifting effect under the printed design. Lighter print areas reveal more of the pearl/metallic base. Dark print areas remain opaque. The result is a premium printed wrap where the base film adds depth and shimmer to the printed artwork. This is NOT chrome paint — it is printed vinyl with a specialty base layer visible through the ink.',
  },
  chrome_film: {
    label: 'Print on Chrome Film',
    shortLabel: 'Chrome Base',
    description: 'Printed on mirror chrome base — reflective chrome shows through design',
    promptContext: 'This design is printed on a mirror chrome base film. The chrome/mirror substrate shows through lighter and transparent areas of the printed design, creating a striking chrome-through-ink effect. Dark printed areas remain opaque over the chrome. The result is a high-impact printed wrap where selective areas reveal mirror-like chrome underneath the printed artwork. This is printed vinyl on chrome film, not chrome paint.',
  },
  satin_film: {
    label: 'Print on Satin Film',
    shortLabel: 'Satin Base',
    description: 'Printed on satin base film — soft pearl sheen under the design',
    promptContext: 'This design is printed on a satin base film. The satin substrate provides a soft, silk-like sheen underneath the printed design. The result is a premium wrap with subtle luminosity and depth, where the satin base gives the printed artwork an elevated, sophisticated appearance. This is printed vinyl on satin film, not satin automotive paint.',
  },
};

export interface DesignIQParams {
  /** Canonical identity minted by the explicit Enter-vehicle Design Prep. */
  generationId?: string;
  mode: 'restyle' | 'commercial';
  prompt: string;
  finish: string;
  substrate?: PrintSubstrate;
  companyName?: string;
  phone?: string;
  mascot?: string;
  bulletPoints?: string[];
  industryType?: string;
  brandColors?: string;
  fontStyle?: string;
  qrEnabled?: boolean;
  qrUrl?: string;
  visionBoardImages?: VisionBoardImage[];
  visionboard_intent?: VisionBoardIntent;
  /**
   * Two-layer design (new flow). `prompt` above is the Layer 1 BACKGROUND
   * brief (kept text-free so the AI never bakes lettering into the artwork).
   * These describe Layer 2 — the editable text & logo layer that is composited
   * on top in RevisionStudio rather than rendered into the background.
   */
  textLayerPrompt?: string;
  textLayerVisionBoardImages?: VisionBoardImage[];
}

// ---------------------------------------------------------------------------
// buildDesignIQPrompt
//
// Takes the user's raw creative prompt and silently wraps it with the full
// DesignIQ intelligence layer.  The output is a single constructed string
// that the AI model receives - the user never sees the scaffolding.
// ---------------------------------------------------------------------------

export function buildDesignIQPrompt(params: DesignIQParams): string {
  const {
    mode,
    prompt,
    finish,
    companyName,
    mascot,
    bulletPoints,
    industryType,
  } = params;

  const industryLabel =
    COMMERCIAL_INDUSTRIES.find((i) => i.key === industryType)?.label ||
    industryType ||
    'General';

  // -- ReStyle mode ----------------------------------------------------------
  if (mode === 'restyle') {
    return `You are DesignIQ - a proprietary vehicle wrap design engine built by and for the vinyl wrap industry.

A wrap professional has given you this creative direction:
"${prompt}"

Lamination finish: ${finish}

Generate a single flat 2D rectangular panel image that brings this vision to life. The panel must be production-ready vinyl wrap art at an exact 5:1 aspect ratio (186 inches wide by 56 inches tall). This is not a vehicle render - it is the raw panel artwork that will be printed on vinyl and physically applied to a vehicle.

As you design, silently apply these wrap-industry production fundamentals - they are non-negotiable for real-world print output:

The image must be a flat 2D rectangle with zero 3D perspective, zero depth cues, and no shadows that imply a curved surface. No vehicle shapes, silhouettes, or outlines anywhere. No text, lettering, watermarks, logos, or branding of any kind. No borders, frames, or margins - the design bleeds edge to edge across the full panel.

Concentrate the design energy on flat body panel zones where cast vinyl lays smooth against sheet metal. The visual flow must read naturally from front to rear - left to right - mirroring how the eye tracks a vehicle in motion. Bold graphic transitions are always favored over fine gradients because fine gradients break down at production print scale and show banding on laminated vinyl.

The pattern must tile seamlessly along the horizontal axis so it can span multiple vehicle zones without visible seams. Position the highest-detail focal points toward the center of the panel height where they will land on doors and quarter panels - away from the top and bottom edges where vinyl stretches around compound curves and detail gets lost.

Design with color density and contrast that delivers viewing impact at 10 feet and beyond. A wrap that only reads up close fails on the street. The ${finish} lamination will be applied over this print - let the surface character of ${finish.toLowerCase()} vinyl influence how you render texture, sheen, and highlight behavior in the artwork.

The design fills the entire rectangle. Solid or seamlessly integrated background - never transparent. Generate only the panel image, nothing else.`;
  }

  // -- Commercial mode -------------------------------------------------------
  const brandLines = [
    companyName ? `Company: ${companyName}` : null,
    mascot ? `Mascot / Character Motif: ${mascot}` : null,
    `Industry: ${industryLabel}`,
    bulletPoints && bulletPoints.filter(Boolean).length > 0
      ? `Brand Keywords: ${bulletPoints.filter(Boolean).join(', ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  // Build commercial-specific brand rendering directives
  const brandDirectives: string[] = [];

  if (companyName) {
    brandDirectives.push(
      `COMPANY NAME: Render "${companyName}" as bold, prominent, professionally styled typography. The company name must be clearly readable and integrated into the panel design. Use creative lettering styles that match the industry and brand feel. The name should be sized to be readable from 15+ feet away on a vehicle.`
    );
  }

  if (mascot) {
    brandDirectives.push(
      `MASCOT/LOGO: Generate an illustrated character or logo-style graphic featuring a ${mascot}. Make it prominent and memorable - this is the brand's visual identity. The mascot should be a custom illustrated character, NOT just the concept used as a pattern element.`
    );
  }

  if (bulletPoints && bulletPoints.filter(Boolean).length > 0) {
    brandDirectives.push(
      `BRAND KEYWORDS: Use these to guide color palette, design energy, and visual mood: ${bulletPoints.filter(Boolean).join(', ')}`
    );
  }

  brandDirectives.push(
    `INDUSTRY CONTEXT: This is a ${industryLabel} business. The wrap design should look like a professional commercial fleet wrap for this industry - customers need to immediately understand what this business does when they see the vehicle.`
  );

  brandDirectives.push(
    `LAYOUT: Commercial wraps prioritize brand visibility. The company name and mascot should occupy prominent positions. Supporting design elements (patterns, graphics, color blocks) should frame and enhance the branding, not compete with it.`
  );

  const commercialRules = brandDirectives.map((d, i) => `${i + 1}. ${d}`).join('\n\n');

  return `You are DesignIQ - a proprietary vehicle wrap design engine built by and for the vinyl wrap industry.

A business owner has given you this creative direction for a commercial vehicle wrap:
"${prompt}"

Brand identity:
${brandLines}

Lamination finish: ${finish}

Generate a single flat 2D rectangular panel image that embodies this brand on vinyl. The panel must be production-ready commercial wrap art at an exact 5:1 aspect ratio (186 inches wide by 56 inches tall). This is not a vehicle render - it is the raw panel artwork that will be printed on vinyl and physically applied to a fleet vehicle.

COMMERCIAL WRAP DESIGN RULES:
${commercialRules}

This is still a flat 2D panel at 5:1 aspect ratio for vinyl printing. All other wrap production rules still apply (seamless edges, print-friendly, no fine gradients, etc.)

As you design, silently apply these wrap-industry production fundamentals - they are non-negotiable for real-world print and commercial fleet output:

The image must be a flat 2D rectangle with zero 3D perspective, zero depth cues, and no shadows that imply a curved surface. No vehicle shapes, silhouettes, or outlines anywhere. No borders, frames, or margins - the design bleeds edge to edge across the full panel.

Concentrate the design energy on flat body panel zones where cast vinyl lays smooth against sheet metal. The visual flow must read naturally from front to rear - left to right - mirroring how the eye tracks a vehicle in motion. Bold graphic transitions are always favored over fine gradients because fine gradients break down at production print scale and show banding on laminated vinyl.

The pattern must tile seamlessly along the horizontal axis so it can span multiple vehicle zones without visible seams. Position the highest-detail focal points toward the center of the panel height where they will land on doors and quarter panels - away from the top and bottom edges where vinyl stretches around compound curves and detail gets lost.

Design with color density and contrast that delivers viewing impact at 10 feet and beyond. A wrap that only reads up close fails on the street. The ${finish} lamination will be applied over this print - let the surface character of ${finish.toLowerCase()} vinyl influence how you render texture, sheen, and highlight behavior in the artwork.

Build the composition with passenger-side billboard priority - weight the visual impact toward the right half of the panel, because that is the side facing the sidewalk, storefronts, and pedestrian traffic on most roads. The brand colors provided above should dominate at least 60 percent of the panel area so the vehicle is unmistakably on-brand from any angle. Maintain a professional, premium polish appropriate for ${industryLabel} - this wrap represents the company to every person who sees it on the road.

The design fills the entire rectangle. Solid or seamlessly integrated background - never transparent. Generate only the panel image, nothing else.`;
}
