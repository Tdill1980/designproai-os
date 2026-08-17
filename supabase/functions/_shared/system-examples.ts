/**
 * SYSTEM-LEVEL EXAMPLE IMAGES — RestylePro Quality Baseline
 *
 * These are the 3 best V1 commercial renders that Gemini sees on EVERY
 * DesignPanelPro / ApproveMode / commercial render call. They teach the AI
 * what a $5K wrap looks like: composition, hierarchy, photo placement,
 * breathing room, and professional installation quality.
 *
 * Images are stored in Supabase Storage bucket: "system-examples"
 * Upload path: system-examples/{filename}
 *
 * BUCKET SETUP:
 *   1. Create bucket "system-examples" in Supabase Dashboard -> Storage
 *   2. Set bucket to PUBLIC (read-only)
 *   3. Upload the 3 images with the exact filenames below
 */

import { createExternalClient, getExternalSupabaseUrl } from './external-db.ts';

// ============================================================================
// SYSTEM EXAMPLE DEFINITIONS
// ============================================================================

export interface SystemExample {
  /** Storage path within the "system-examples" bucket */
  storagePath: string;
  /** Short label for logging */
  label: string;
  /** WHY this render is excellent — injected into the prompt */
  analysis: string;
  /** Which render modes benefit from this example */
  applicableModes: string[];
}

export const SYSTEM_EXAMPLES: SystemExample[] = [
  {
    storagePath: 'profinish-impact-silverado.png',
    label: 'ProFinish Impact — Silverado',
    analysis: `EXAMPLE 1: ProFinish Impact — Painting Company Silverado
WHY THIS IS A PERFECT COMMERCIAL WRAP:
- Photo placement inside swoosh graphic is seamless — the photo blends into the vehicle contour
- Logo positioned on both doors at eye-level — maximum visibility from street
- Color hierarchy: dark base with bright accent swoosh creates visual pop
- Clean negative space on hood and roof — lets the design breathe
- Text is minimal and readable at 30mph drive-by speed
- Wrap follows body lines — swoosh flows WITH the fender curve, not against it
- Professional laminate finish — no bubbles, no wrinkles, no lifting edges`,
    applicableModes: ['designpanelpro', 'approvemode', 'commercial'],
  },
  {
    storagePath: 'timberwrap-elite-f250.png',
    label: 'TimberWrap Elite — F-250',
    analysis: `EXAMPLE 2: TimberWrap Elite — Construction F-250
WHY THIS IS A PERFECT COMMERCIAL WRAP:
- White base color PRESERVED on cab — clean, professional, not overwhelming
- Wood graphic confined to truck bed and tailgate — strategic placement, not full-body chaos
- Design hierarchy is clear: company name largest, phone number second, services smallest
- Breathing room between elements — nothing is cramped or overlapping
- The wood texture graphic is photorealistic, not clip-art
- Color palette limited to 3 colors max (white, brown/wood, dark accent)
- Logo on doors is proportional to panel size — not stretched or distorted`,
    applicableModes: ['designpanelpro', 'approvemode', 'commercial'],
  },
  {
    storagePath: 'sipco-juicebar-sprinter.png',
    label: 'SipCo Juice Bar — Sprinter',
    analysis: `EXAMPLE 3: SipCo Juice Bar — Sprinter Van
WHY THIS IS A PERFECT COMMERCIAL WRAP:
- PARTIAL WRAP — not every inch is covered, and that's what makes it premium
- Lime green accent color is bold but used sparingly — only on key graphic elements
- Logo is the HERO — prominently placed, properly sized, impossible to miss
- White base preserved across 60%+ of the vehicle — breathing room everywhere
- Product imagery (juice bottles/fruit) is crisp and appetizing
- The design has a clear visual flow: logo -> product -> contact info
- Contour-cut graphics on the Sprinter's flat panels look factory-installed
- No visual clutter — a viewer knows what this company does in 2 seconds`,
    applicableModes: ['designpanelpro', 'approvemode', 'commercial'],
  },
];

// ============================================================================
// PROMPT INJECTION — Text block that tells Gemini HOW to use the examples
// ============================================================================

export const SYSTEM_EXAMPLES_PROMPT_BLOCK = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RESTYLERO QUALITY BASELINE — SYSTEM REFERENCE EXAMPLES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The following ${SYSTEM_EXAMPLES.length} images are PROFESSIONAL COMMERCIAL WRAPS
that represent the RestylePro quality standard. Study them carefully.

YOUR RENDER MUST MATCH THIS QUALITY LEVEL:
- Clean composition with clear visual hierarchy
- Breathing room — not every surface covered
- Logo placement at eye-level, proportional to panel
- Photo/graphic integration follows vehicle body lines
- Professional vinyl installation — zero bubbles, zero wrinkles
- Limited color palette (3-4 colors max)
- Text readable at drive-by speed
- Design serves the business — viewer knows the company in 2 seconds

${SYSTEM_EXAMPLES.map(ex => ex.analysis).join('\n\n')}

IMPORTANT: These examples show the QUALITY STANDARD, not the specific design.
Apply the USER'S uploaded design with this same level of professionalism.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;

// ============================================================================
// RUNTIME — Fetch system example image URLs from Supabase Storage
// ============================================================================

/**
 * Get public URLs for system example images.
 * Returns URLs for all applicable examples for the given render mode.
 * Images that don't exist in storage are silently skipped.
 */
export async function getSystemExampleImageUrls(
  modeType: string
): Promise<{ url: string; label: string }[]> {
  const supabaseUrl = getExternalSupabaseUrl();
  const results: { url: string; label: string }[] = [];

  for (const example of SYSTEM_EXAMPLES) {
    // Check if this example applies to the current mode
    if (!example.applicableModes.includes(modeType) && !example.applicableModes.includes('commercial')) {
      continue;
    }

    // Build the public URL for the storage object
    const publicUrl = `${supabaseUrl}/storage/v1/object/public/system-examples/${example.storagePath}`;
    results.push({ url: publicUrl, label: `system-example-${example.label}` });
  }

  console.log(`[SystemExamples] Resolved ${results.length} example image URLs for mode: ${modeType}`);
  return results;
}

/**
 * Check if a render mode should receive system examples.
 * Only commercial wrap modes benefit from these — ColorPro color-change does not.
 */
export function shouldInjectSystemExamples(modeType: string): boolean {
  const COMMERCIAL_MODES = ['designpanelpro', 'approvemode'];
  return COMMERCIAL_MODES.includes(modeType);
}
