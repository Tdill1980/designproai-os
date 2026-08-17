/**
 * panel-extract-v2 — Per-Render Panel Extraction (NO AI GENERATION)
 *
 * Takes ONE 3D render → crops to panel region → removes background →
 * outputs the ACTUAL render pixels as a clean panel.
 *
 * NO Gemini image generation. The render IS the design.
 * AI is only used for background removal (remove.bg) — nothing creative.
 *
 * Pipeline:
 *   1. Fetch render (via Supabase image transforms for memory safety)
 *   2. Crop to panel region (deterministic — based on view type)
 *   3. Remove background via remove.bg API (isolate vehicle from studio)
 *   4. Auto-trim transparent edges to tight bounding box
 *   5. Upload & return clean panel — ACTUAL pixels from the render
 *
 * POST /panel-extract-v2
 * {
 *   renderUrl: string,       // ONE render image URL
 *   viewType: "side" | "passenger-side" | "front" | "rear" | "hood" | "roof",
 *   widthInches?: number,    // target panel width (optional, for metadata)
 *   heightInches?: number,   // target panel height
 *   designName?: string,
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

const BUCKET = "wrap-files";

// ── Crop regions per view type ──────────────────────────────────
// What % of the render contains the wrappable body panel.
// Tuned for our studio camera angles from view-angles-os.ts.
const CROP_REGIONS: Record<string, { top: number; bottom: number; left: number; right: number }> = {
  "side":           { top: 0.12, bottom: 0.72, left: 0.02, right: 0.98 },
  "driver-side":    { top: 0.12, bottom: 0.72, left: 0.02, right: 0.98 },
  "driver_side":    { top: 0.12, bottom: 0.72, left: 0.02, right: 0.98 },
  "passenger-side": { top: 0.12, bottom: 0.72, left: 0.02, right: 0.98 },
  "passenger_side": { top: 0.12, bottom: 0.72, left: 0.02, right: 0.98 },
  "front":          { top: 0.08, bottom: 0.75, left: 0.12, right: 0.88 },
  "rear":           { top: 0.08, bottom: 0.75, left: 0.12, right: 0.88 },
  "back":           { top: 0.08, bottom: 0.75, left: 0.12, right: 0.88 },
  "hood":           { top: 0.03, bottom: 0.92, left: 0.08, right: 0.92 },
  "hood_detail":    { top: 0.03, bottom: 0.92, left: 0.08, right: 0.92 },
  "roof":           { top: 0.03, bottom: 0.95, left: 0.10, right: 0.90 },
};

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Step 1: Fetch & Crop ────────────────────────────────────────

async function fetchAndCrop(
  renderUrl: string,
  viewType: string,
) {
  const { Image } = await import("https://deno.land/x/imagescript@1.2.15/mod.ts");

  // Fetch render (use Supabase transforms for memory safety)
  let fetchUrl = renderUrl;
  if (renderUrl.includes("/storage/v1/object/")) {
    fetchUrl = renderUrl.replace("/storage/v1/object/", "/storage/v1/render/image/") +
      "?width=2000&resize=contain";
  }

  let resp = await fetch(fetchUrl, { signal: AbortSignal.timeout(15_000) });
  if (!resp.ok && fetchUrl !== renderUrl) {
    resp = await fetch(renderUrl, { signal: AbortSignal.timeout(15_000) });
  }
  if (!resp.ok) return { error: `Failed to fetch render: ${resp.status}` };

  const bytes = new Uint8Array(await resp.arrayBuffer());
  const img = await Image.decode(bytes);
  const w = img.width;
  const h = img.height;

  const region = CROP_REGIONS[viewType] || CROP_REGIONS["side"];
  const cropX = Math.round(w * region.left);
  const cropY = Math.round(h * region.top);
  const cropW = Math.round(w * (region.right - region.left));
  const cropH = Math.round(h * (region.bottom - region.top));

  console.log(`[EXTRACT-V2] Render: ${w}×${h} → Crop: ${cropX},${cropY} ${cropW}×${cropH}`);

  const cropped = img.crop(cropX, cropY, cropW, cropH);
  const croppedPng = await cropped.encode();

  return {
    croppedBytes: croppedPng,
    croppedBase64: arrayBufferToBase64(croppedPng.buffer),
    croppedWidth: cropW,
    croppedHeight: cropH,
    Image, // pass through for auto-trim step
  };
}

// ── Step 2: Background Removal ──────────────────────────────────

async function removeBackground(
  imageBase64: string,
): Promise<{ cleanBytes: Uint8Array; mimeType: string } | { error: string } | null> {
  const removeBgKey = Deno.env.get("REMOVEBG_API_KEY");

  if (!removeBgKey) {
    console.log("[EXTRACT-V2] No REMOVEBG_API_KEY — skipping bg removal");
    return null; // Signal to use cropped image as-is
  }

  console.log("[EXTRACT-V2] Using remove.bg API");
  try {
    const binaryStr = atob(imageBase64);
    const binaryArr = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      binaryArr[i] = binaryStr.charCodeAt(i);
    }

    const formData = new FormData();
    formData.append("image_file", new Blob([binaryArr], { type: "image/png" }), "panel.png");
    formData.append("size", "full");
    formData.append("format", "png");

    const resp = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": removeBgKey },
      body: formData,
      signal: AbortSignal.timeout(30_000),
    });

    if (resp.ok) {
      const buf = await resp.arrayBuffer();
      const cleanBytes = new Uint8Array(buf);
      console.log(`[EXTRACT-V2] remove.bg success: ${Math.round(cleanBytes.length / 1024)} KB`);
      return { cleanBytes, mimeType: "image/png" };
    }

    console.warn(`[EXTRACT-V2] remove.bg failed: ${resp.status}`);
    return null;
  } catch (e) {
    console.warn(`[EXTRACT-V2] remove.bg error:`, e);
    return null;
  }
}

// ── Step 3: Auto-trim transparent edges ─────────────────────────
// After bg removal, trim to tight bounding box of non-transparent pixels.

async function autoTrim(
  imageBytes: Uint8Array,
  ImageClass: any,
): Promise<{ trimmedBytes: Uint8Array; width: number; height: number }> {
  try {
    const img = await ImageClass.decode(imageBytes);
    const w = img.width;
    const h = img.height;

    // Find bounding box of non-transparent pixels
    let minX = w, minY = h, maxX = 0, maxY = 0;

    for (let y = 1; y <= h; y++) {
      for (let x = 1; x <= w; x++) {
        const pixel = img.getPixelAt(x, y);
        const alpha = pixel & 0xFF;
        if (alpha > 20) { // Threshold for "not transparent"
          const px = x - 1;
          const py = y - 1;
          if (px < minX) minX = px;
          if (py < minY) minY = py;
          if (px > maxX) maxX = px;
          if (py > maxY) maxY = py;
        }
      }
    }

    if (maxX <= minX || maxY <= minY) {
      console.log("[EXTRACT-V2] Auto-trim: no opaque pixels found, returning original");
      return { trimmedBytes: imageBytes, width: w, height: h };
    }

    // Add small padding (2%)
    const padX = Math.round((maxX - minX) * 0.02);
    const padY = Math.round((maxY - minY) * 0.02);
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(w - 1, maxX + padX);
    maxY = Math.min(h - 1, maxY + padY);

    const trimW = maxX - minX + 1;
    const trimH = maxY - minY + 1;

    console.log(`[EXTRACT-V2] Auto-trim: ${w}×${h} → ${trimW}×${trimH} (trimmed ${Math.round((1 - (trimW * trimH) / (w * h)) * 100)}%)`);

    const trimmed = img.crop(minX, minY, trimW, trimH);
    const trimmedPng = await trimmed.encode();
    return { trimmedBytes: trimmedPng, width: trimW, height: trimH };
  } catch (e) {
    console.warn("[EXTRACT-V2] Auto-trim failed, returning original:", e);
    return { trimmedBytes: imageBytes, width: 0, height: 0 };
  }
}

// ── Main Handler ────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      renderUrl,
      viewType = "side",
      widthInches,
      heightInches,
      designName = "Custom Design",
    } = body;

    if (!renderUrl) {
      return jsonResponse({ error: "renderUrl is required" }, 400);
    }

    const start = Date.now();
    console.log(`[EXTRACT-V2] Starting: ${viewType} | Design: ${designName}`);

    // Step 1: Fetch & crop to panel region
    console.log("[EXTRACT-V2] Step 1: Crop to panel region");
    const cropResult = await fetchAndCrop(renderUrl, viewType);
    if ("error" in cropResult) {
      return jsonResponse({ success: false, error: cropResult.error }, 400);
    }

    // Step 2: Background removal (if API key available)
    console.log("[EXTRACT-V2] Step 2: Background removal");
    const bgResult = await removeBackground(cropResult.croppedBase64);

    let finalBytes: Uint8Array;
    let finalWidth = cropResult.croppedWidth;
    let finalHeight = cropResult.croppedHeight;
    let bgRemoved = false;

    if (bgResult && "cleanBytes" in bgResult) {
      // BG was removed — auto-trim transparent edges
      bgRemoved = true;
      console.log("[EXTRACT-V2] Step 3: Auto-trim transparent edges");
      const trimResult = await autoTrim(bgResult.cleanBytes, cropResult.Image);
      finalBytes = trimResult.trimmedBytes;
      if (trimResult.width > 0) {
        finalWidth = trimResult.width;
        finalHeight = trimResult.height;
      }
    } else {
      // No bg removal — use cropped image directly (still useful!)
      finalBytes = cropResult.croppedBytes;
      console.log("[EXTRACT-V2] Using cropped render directly (no bg removal)");
    }

    // Upload result
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const authHeader = req.headers.get("Authorization");
    let userId = "anonymous";
    if (authHeader) {
      const { data: { user } } = await sb.auth.getUser(
        authHeader.replace("Bearer ", ""),
      );
      if (user) userId = user.id;
    }

    const timestamp = Date.now();
    const storagePath = `panels/${userId}/${viewType}-${timestamp}.png`;

    const { error: uploadError } = await sb.storage
      .from(BUCKET)
      .upload(storagePath, finalBytes, {
        contentType: "image/png",
        upsert: true,
      });

    if (uploadError) {
      console.error("[EXTRACT-V2] Upload error:", uploadError);
      return jsonResponse({ success: false, error: "Upload failed" }, 500);
    }

    const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(storagePath);

    const ms = Date.now() - start;
    console.log(`[EXTRACT-V2] Done: ${viewType} ${finalWidth}×${finalHeight} in ${(ms / 1000).toFixed(1)}s — ${Math.round(finalBytes.length / 1024)} KB`);

    return jsonResponse({
      success: true,
      panelUrl: publicUrl,
      storagePath,
      viewType,
      dimensions: widthInches && heightInches ? { widthInches, heightInches } : undefined,
      outputSize: { width: finalWidth, height: finalHeight },
      bgRemoved,
      pipeline: bgRemoved ? "crop → bg-remove → auto-trim" : "crop-only",
      ms,
    });

  } catch (err: any) {
    console.error("[EXTRACT-V2] Error:", err);
    return jsonResponse({ error: err.message || "Extraction failed" }, 500);
  }
});
