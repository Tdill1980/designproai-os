/**
 * Supabase Storage image helpers.
 *
 * downscaleStorageImage — rewrite a PUBLIC Supabase Storage object URL to the
 * on-the-fly image-transform endpoint at a bounded width. Use this whenever a
 * large render is handed to an edge function as a *reference* image (e.g. the
 * driver hero passed as `originalRenderUrl` to design-panel-ai-generate for the
 * 360/view-clone camera lock).
 *
 * WHY THIS EXISTS (546 WORKER_RESOURCE_LIMIT): a 4K restyle render is ~8MB. The
 * view-clone path in design-panel-ai-generate fetches `originalRenderUrl` RAW and
 * base64-encodes it; firing 5 angles at once meant ~5×8MB decoded + inflated in a
 * single 256MB worker, which OOM'd (HTTP 546) so every extra angle failed and only
 * the driver side landed. The reference only needs enough detail to clone the
 * design, so 2048px (~0.5–1MB) removes the OOM with no meaningful fidelity loss —
 * the SAME mechanism the VisionBoard reference path already uses inside the edge
 * function. Non-storage / already-transformed URLs are returned unchanged.
 */
// NOTE: this only bounds the REFERENCE/anchor image handed to the render worker,
// NOT the rendered output. Every generated view is still produced at full 4K, and
// the print pipeline (upscale-panel-to-print Real-ESRGAN 4× + the Railway hi-res
// worker) runs on the sliced panels — never on this thumbnail. width=3000 is the
// effective max Supabase's image transform returns (~1.45MB); larger widths return
// the same bytes. That's ample design detail to clone from and stays far under the
// 256MB worker limit (the 8MB raw fetch × 5 concurrent was what OOM'd, HTTP 546).
export function downscaleStorageImage(url: string | null | undefined, width = 3000, quality = 90): string {
  if (!url || typeof url !== "string") return url || "";
  // Only rewrite public Supabase Storage object URLs; leave anything else as-is.
  if (!url.includes("/storage/v1/object/public/")) return url;
  // Already a transform URL — don't double-wrap.
  if (url.includes("/render/image/public/")) return url;
  const base = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}width=${width}&quality=${quality}`;
}
