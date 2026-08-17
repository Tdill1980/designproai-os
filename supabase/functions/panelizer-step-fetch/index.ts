/**
 * ─────────────────────────────────────────────────────────────
 *  GENIE™ Universal Panelizer
 *  Part of the LiftIQ Engine™ / Prompt-to-Production™ architecture.
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *  Proprietary & confidential. Contains trade-secret methods
 *  (layer-separated generative render & panel synthesis).
 *  Trademarks: GENIE™, DesignIQ™, LiftIQ™ — see /NOTICE and
 *  docs/TRADEMARKS.md. Not legal advice.
 * ─────────────────────────────────────────────────────────────
 */
/**
 * panelizer-step-fetch — Step 1: Fetch render image from URL → storage
 *
 * Input:  { renderUrl, userId, jobId }
 * Output: { storagePath } — the render image saved to temp storage
 *
 * This function downloads the source render image and saves it to the
 * temp working area. Handles expired Supabase signed URLs by extracting
 * the storage path and downloading via service-role client directly.
 * Memory is freed as soon as the upload completes.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  fetchImageBytes,
  uploadToStorage,
  downloadFromStorage,
} from "../_shared/panelizer-os/storage.ts";
import { tempPath } from "../_shared/panelizer-os/constants.ts";

/**
 * Extract the storage path from a Supabase storage URL.
 * Handles both signed URLs (/object/sign/bucket/path?token=...)
 * and public URLs (/object/public/bucket/path).
 * Returns null if the URL is not a Supabase storage URL.
 */
function extractStoragePath(url: string): string | null {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    if (!supabaseUrl || !url.includes(supabaseUrl)) return null;

    const u = new URL(url);
    const pathname = u.pathname;

    // Signed URL: /storage/v1/object/sign/<bucket>/<path>
    const signMatch = pathname.match(/\/storage\/v1\/object\/sign\/[^/]+\/(.+)/);
    if (signMatch) return decodeURIComponent(signMatch[1]);

    // Public URL: /storage/v1/object/public/<bucket>/<path>
    const pubMatch = pathname.match(/\/storage\/v1\/object\/public\/[^/]+\/(.+)/);
    if (pubMatch) return decodeURIComponent(pubMatch[1]);

    // Render URL: /storage/v1/render/image/public/<bucket>/<path>
    const renderMatch = pathname.match(/\/storage\/v1\/render\/image\/public\/[^/]+\/(.+)/);
    if (renderMatch) return decodeURIComponent(renderMatch[1]);

    return null;
  } catch {
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { renderUrl, userId, jobId } = await req.json();

    if (!renderUrl || !userId || !jobId) {
      return new Response(
        JSON.stringify({ error: "Missing renderUrl, userId, or jobId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[FETCH] Job ${jobId} — downloading render from URL...`);
    const startMs = Date.now();

    // Try direct URL fetch first, then fall back to storage API for expired signed URLs
    let imageBytes: Uint8Array;
    const sourceStoragePath = extractStoragePath(renderUrl);

    try {
      imageBytes = await fetchImageBytes(renderUrl);
      console.log(`[FETCH] Downloaded via URL: ${(imageBytes.byteLength / 1024).toFixed(0)} KB in ${Date.now() - startMs}ms`);
    } catch (urlErr) {
      // If URL fetch fails AND it's a Supabase storage URL, try service-role download
      if (sourceStoragePath) {
        console.warn(`[FETCH] URL fetch failed (${urlErr.message}) — retrying via storage API path: ${sourceStoragePath}`);
        imageBytes = await downloadFromStorage(sourceStoragePath);
        console.log(`[FETCH] Downloaded via storage API: ${(imageBytes.byteLength / 1024).toFixed(0)} KB in ${Date.now() - startMs}ms`);
      } else {
        throw urlErr; // Not a Supabase URL — re-throw
      }
    }

    // Basic quality gate — reject tiny/corrupt images
    if (imageBytes.byteLength < 10_000) {
      return new Response(
        JSON.stringify({ error: `Image too small (${imageBytes.byteLength} bytes) — likely corrupt` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Save to temp storage
    const storagePath = tempPath(userId, jobId, "step-1-render");
    await uploadToStorage(storagePath, imageBytes, "image/png");

    console.log(`[FETCH] Saved to ${storagePath} — done in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        sizeBytes: imageBytes.byteLength,
        step: "fetch",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[FETCH] Error:", err);
    return new Response(
      JSON.stringify({ error: `Fetch step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
