/**
 * model-config.ts — Centralized Gemini model configuration
 *
 * PRIMARY: gemini-3-pro-image-preview (Nano Banana Pro — highest quality)
 * FALLBACK: gemini-3.1-flash-image-preview (Nano Banana 2 — 4K, fast)
 *
 * Per Google deprecation page (ai.google.dev/gemini-api/docs/deprecations):
 * - gemini-3-pro-image-preview has NO shutdown date announced
 * - gemini-3-pro-preview (TEXT model) shuts down March 9, 2026
 * - gemini-3.1-pro-preview is text-only, NOT an image model
 *
 * Render functions try PRIMARY first. On the final retry attempt,
 * they fall back to FALLBACK to avoid total failure.
 */

// ⛔ GA, NOT PREVIEW — AND THE SPLIT IS GONE. (Trish 2026-08-28: "use
// gemini-3-pro-image GA for Call 1 AND the 3D proof stack. Remove the GA/preview
// split.")
//
// Call 1 already pinned the GA id by name in the runtime
// (DESIGNPANEL_AUTHORING_MODEL), on eleven production masters' worth of
// measurement: every GA run held a border median of 135-177 across the centre
// four on every prompt version from v2 to v8, and the first `-preview` run
// dropped it to 18-23 with 63-83% of each border dark. The proof stack was still
// taking `-preview` from here, so one design was authored on one model and
// photographed under another.
export const PRIMARY_IMAGE_MODEL = "gemini-3-pro-image";
export const FALLBACK_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

/** Build the full Gemini generateContent URL for a given model and API key */
export function geminiImageUrl(apiKey: string, model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}
