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

export const PRIMARY_IMAGE_MODEL = "gemini-3-pro-image-preview";
export const FALLBACK_IMAGE_MODEL = "gemini-3.1-flash-image-preview";

/** Build the full Gemini generateContent URL for a given model and API key */
export function geminiImageUrl(apiKey: string, model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
}
