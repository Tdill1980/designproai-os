/**
 * studio-reference.ts — Per-angle photorealistic studio references for all render tools.
 *
 * Gemini best practice: include a reference image showing the EXACT lighting and
 * photorealistic quality you want. This anchors every render to the correct style.
 *
 * Reference images stored at: render-references/ in Supabase Storage.
 * Per-angle references (matched to viewType):
 *   render-references/ref-side.png          — Driver side
 *   render-references/ref-passenger-side.png — Passenger side
 *   render-references/ref-hood.png          — Hood top-down
 *   render-references/ref-front.png         — Front straight-on
 *   render-references/ref-rear.png          — Rear straight-on
 *   render-references/ref-close-up.png      — Close-up macro
 *   render-references/ref-roof.png          — Roof top-down
 *
 * Falls back to render-references/studio-golden.png if no angle-specific ref exists.
 *
 * Used by: ColorPro, DesignPro, ApprovePro, FadeWraps, WBTY, GraphicsPro — all tools.
 */

const STORAGE_BUCKET = "wrap-files";
const REFERENCE_DIR = "render-references";

// Per-angle reference file names
const ANGLE_REFERENCE_FILES: Record<string, string> = {
  'side':           'ref-side.png',
  'driver-side':    'ref-side.png',
  'passenger-side': 'ref-passenger-side.png',
  'hood_detail':    'ref-hood.png',
  'front':          'ref-front.png',
  'rear':           'ref-rear.png',
  'close-up':       'ref-close-up.png',
  'roof':           'ref-roof.png',
};

const FALLBACK_REFERENCE = "studio-golden.png";

// Cache: keyed by filename
const cache: Map<string, { base64: string; expiry: number }> = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Download a file from storage and return as base64.
 * Returns null if not found.
 */
async function downloadAsBase64(supabase: any, path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached && Date.now() < cached.expiry) {
    return cached.base64;
  }

  try {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(path);

    if (error || !data) return null;

    const arrayBuffer = await data.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);

    cache.set(path, { base64, expiry: Date.now() + CACHE_TTL_MS });
    console.log(`[STUDIO-REF] Loaded ${path} (${(bytes.length / 1024).toFixed(0)}KB)`);
    return base64;
  } catch {
    return null;
  }
}

/**
 * Load the studio reference image for a specific view angle.
 * Tries angle-specific reference first, falls back to golden reference.
 * Returns null if no reference images exist yet (graceful fallback).
 */
export async function loadStudioReference(supabase: any, viewType?: string): Promise<string | null> {
  // Try angle-specific reference first
  if (viewType) {
    const angleFile = ANGLE_REFERENCE_FILES[viewType];
    if (angleFile) {
      const angleRef = await downloadAsBase64(supabase, `${REFERENCE_DIR}/${angleFile}`);
      if (angleRef) {
        console.log(`[STUDIO-REF] Using angle-specific reference for ${viewType}`);
        return angleRef;
      }
    }
  }

  // Fall back to general golden reference
  const fallback = await downloadAsBase64(supabase, `${REFERENCE_DIR}/${FALLBACK_REFERENCE}`);
  if (fallback) {
    console.log(`[STUDIO-REF] Using fallback golden reference${viewType ? ` (no ${viewType}-specific ref)` : ''}`);
  } else {
    console.log("[STUDIO-REF] No reference images found — renders will work without them");
  }
  return fallback;
}

/**
 * Build few-shot contents array for Gemini multi-turn call.
 * If a reference image exists, returns a 3-turn conversation:
 *   1. User: reference image + "This is the correct style"
 *   2. Model: "Understood, I will match this"
 *   3. User: actual render prompt + images
 *
 * If no reference image, returns single-turn (backwards compatible).
 */
export function buildContentsWithReference(
  referenceBase64: string | null,
  requestParts: any[],
): any[] {
  if (!referenceBase64) {
    // No reference — single turn, same as before
    return [{ role: "user", parts: requestParts }];
  }

  return [
    {
      role: "user",
      parts: [
        { inlineData: { mimeType: "image/png", data: referenceBase64 } },
        { text: "This is the EXACT photorealistic studio quality and bright lighting style required for every render. Study it: bright even illumination, clean white light, dark charcoal floor with subtle reflection, light gray walls, photorealistic vinyl wrap on the vehicle. Every render you produce must match this lighting and photorealism exactly." },
      ],
    },
    {
      role: "model",
      parts: [{ text: "Understood. I will match this exact studio lighting and photorealistic quality: bright even illumination with no visible fixtures, dark charcoal floor with subtle vehicle reflection, light neutral gray walls, and photorealistic vinyl wrap appearance. Every render will use this identical bright studio style." }],
    },
    {
      role: "user",
      parts: requestParts,
    },
  ];
}
