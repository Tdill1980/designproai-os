/**
 * upscale-production-panel — Per-panel print-resolution upscaler.
 *
 * Takes ONE panel image URL and returns an upscaled version. Engine selection:
 *   1. Topaz Image Enhance (TOPAZ_API_KEY)   — PRIMARY (Jumbo access, big panels)
 *   2. Replicate Real-ESRGAN (REPLICATE_API_TOKEN) — fallback
 *   3. Neither configured → success:false + fallback:"original_resolution"
 *      (caller keeps the inline sharp-upscaled crop — NEVER blocks delivery).
 *
 * Two request modes (back-compatible):
 *   • scale: N                       → integer N× upscale (legacy callers)
 *   • target_width / target_height   → drive the engine to the TRUE print pixel
 *                                      size (realInches × dpi). The function
 *                                      derives the scale factor from the source
 *                                      dimensions and clamps it to each engine's
 *                                      safe cap (Topaz 6× / GPU-fit for Replicate).
 *
 * ANTI-BLOWUP: this function ONLY upscales a single per-panel crop. The caller
 * (api/process-production-pack.js) must NEVER send the full true-size artboard.
 * Each engine already caps output: Topaz caps at 6× and TOPAZ_MAX_OUTPUT_PX;
 * Replicate downscales-and-swaps the source if it exceeds the GPU memory cap.
 * When a panel can't reach the requested target, it ships at the MAX ACHIEVED
 * resolution and `achieved_scale` reports it so the caller records actual DPI.
 *
 * CRITICAL: This function must NEVER block delivery. On ANY failure it returns
 * success:false so the caller falls back to the original-resolution panel.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { upscaleImageBytes } from "../_shared/topaz-upscale.ts";
// NOTE: deno.land imports were removed — Supabase's edge bundler was timing out
// fetching deno.land, which blocked every deploy. Use the native Deno.serve and
// lazy-load imagescript only inside the Replicate branch that needs it.
const serve = (handler: (req: Request) => Response | Promise<Response>) => Deno.serve(handler);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");
const TOPAZ_API_KEY = Deno.env.get("TOPAZ_API_KEY");
const MAX_POLL_ATTEMPTS = 60; // 60 seconds max
const POLL_INTERVAL_MS = 1000;
// Hard ceiling on the requested scale regardless of target — a single panel
// crop never needs more than this and bigger factors only bloat the file.
const MAX_REQUESTED_SCALE = 6;

// Replicate's Real-ESRGAN runs on a ~14.5 GiB GPU. The model weights
// already consume ~6 GiB, leaving ~8 GiB for activations + input + output
// tensors. Peak memory scales with OUTPUT pixels (~scale²), not input — at
// 8x a 2M-pixel input becomes 128M output pixels, which OOMs even though
// the input fits.
//
// Empirical caps that hold on the 14.56 GiB Replicate GPU:
//   scale 2 → 2.0M input → 8M output    (proven baseline)
//   scale 4 → 2.0M input → 32M output   (the "2,096,704" original cap)
//   scale 6 → 0.8M input → 28.8M output
//   scale 8 → 0.5M input → 32M output   (peaks during the 2-pass internal
//                                        upscale Replicate runs at 8x)
function maxInputPixelsForScale(scale: number): number {
  if (scale >= 8) return 500_000;
  if (scale >= 6) return 800_000;
  if (scale >= 4) return 2_000_000;
  return 2_000_000;
}
const RESIZE_BUCKET = "wrap-files";

interface UpscaleRequest {
  image_url: string;       // Signed/public URL to the panel image from storage
  panel_id?: string;       // Optional: production_panel_files.id
  production_pack_id?: string;
  scale?: number;          // Integer N× upscale (legacy). Default 2.
  target_width?: number;   // TRUE print width  (realInches × dpi) — preferred
  target_height?: number;  // TRUE print height (realInches × dpi) — preferred
  input_dpi?: number;      // DPI of the input image (for response metadata)
  engine?: "topaz" | "replicate" | "esrgan-a100" | "auto"; // override engine selection (default auto)
}

/** Read intrinsic pixel dimensions from PNG/JPEG bytes (no full decode). */
function readPngJpegDims(bytes: Uint8Array): { width: number; height: number } | null {
  if (
    bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 &&
    bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i < bytes.length - 8) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      i += 2;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) continue;
      if (i + 1 >= bytes.length) break;
      const segLen = (bytes[i] << 8) | bytes[i + 1];
      const isSOF = marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSOF && i + 6 < bytes.length) {
        return { height: (bytes[i + 3] << 8) | bytes[i + 4], width: (bytes[i + 5] << 8) | bytes[i + 6] };
      }
      if (segLen < 2) break;
      i += segLen;
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body: UpscaleRequest & { model?: string; output_format?: string } = await req.json();
    const {
      image_url, panel_id, production_pack_id, scale = 2,
      target_width, target_height, input_dpi, engine = "auto",
    } = body;

    if (!image_url) {
      return new Response(
        JSON.stringify({ success: false, error: "image_url is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Fetch the source bytes once (needed for dims + Topaz; reused for GPU-fit).
    // GUARD: a big file (e.g. an already-print-size 200MB panel) OOM-kills this
    // 256MB worker the moment we buffer it (HTTP 546). So we (a) check the size
    // first, and (b) for oversized Supabase-storage sources, pull a bounded
    // 4096px copy through the storage image-transform instead of the raw file.
    const SAFE_FETCH_BYTES = 25_000_000; // 25MB — safely under the worker limit
    let srcBytes: Uint8Array | null = null;
    let srcDims: { width: number; height: number } | null = null;
    let fetchUrl = image_url;
    try {
      let contentLen = 0;
      try {
        const head = await fetch(image_url, { method: "HEAD" });
        contentLen = Number(head.headers.get("content-length") || "0");
      } catch (_) { /* HEAD unsupported — fall through */ }

      // Oversized: try a bounded transform of the Supabase-storage object.
      if (contentLen > SAFE_FETCH_BYTES) {
        const transformed = image_url.replace(
          "/storage/v1/object/public/",
          "/storage/v1/render/image/public/",
        );
        if (transformed !== image_url) {
          const sep = transformed.includes("?") ? "&" : "?";
          fetchUrl = `${transformed}${sep}width=4096&quality=90&resize=contain`;
        }
      }

      const srcResp = await fetch(fetchUrl);
      if (srcResp.ok && (srcResp.headers.get("content-type") || "").startsWith("image")) {
        const buf = await srcResp.arrayBuffer();
        if (buf.byteLength <= SAFE_FETCH_BYTES) {
          srcBytes = new Uint8Array(buf);
          srcDims = readPngJpegDims(srcBytes);
        }
      }
      // Still too big to process safely → graceful message, never a 546 crash.
      if (!srcBytes && contentLen > SAFE_FETCH_BYTES) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "Source image is too large to upscale — it is already at/near print pixel size. Upscale a smaller, cleaner working image (e.g. a fresh AI edit) instead.",
            fallback: "original_resolution",
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } catch (_) { /* non-fatal — engines handle missing dims */ }

    // Resolve the requested scale. If target pixels were supplied, derive the
    // factor from the source dimensions; else use the integer `scale`.
    let requestedScale = scale;
    if (target_width && target_height && srcDims && srcDims.width > 0 && srcDims.height > 0) {
      const needed = Math.max(target_width / srcDims.width, target_height / srcDims.height);
      requestedScale = Math.max(1, needed);
    }
    // The A100 engine exists precisely for 8–10× — exempt from the 6× clamp.
    requestedScale = engine === "esrgan-a100"
      ? Math.min(requestedScale, 10)
      : Math.min(requestedScale, MAX_REQUESTED_SCALE);

    // Guard the 256MB worker: topaz-upscale buffers the FULL output in memory,
    // so a big PNG (~scale² pixels, ~200MB) OOM-kills the worker and the client
    // sees a non-2xx crash (the Studio Board "Upscale unavailable" bug). When the
    // estimated output is large, emit JPEG (~10× smaller, print-shop safe)
    // regardless of the requested format.
    let effFormat: "png" | "jpeg" = (body as any)?.output_format === "jpeg" ? "jpeg" : "png";
    if (effFormat === "png" && srcDims && srcDims.width > 0) {
      const outPx = srcDims.width * requestedScale * srcDims.height * requestedScale;
      if (outPx > 40_000_000) {
        console.warn(`[UPSCALE] forcing jpeg output: est ${(outPx / 1e6).toFixed(0)}MP png would OOM the worker`);
        effFormat = "jpeg";
      }
    }

    // ---- REAL-ESRGAN A100 (engine:"esrgan-a100") -----------------------------
    // The big-panel path: daanelson/real-esrgan-a100 on an 80GB GPU does the
    // 8–10× generative edge-smoothing blow-ups raster print files need (the
    // proven "spa wrap" recipe). The output (150MP+ PNG) NEVER enters this
    // worker's memory — Replicate's response body is STREAMED straight into
    // Storage, so the 256MB ceiling does not apply.
    if (engine === "esrgan-a100") {
      if (!REPLICATE_API_TOKEN) {
        return new Response(JSON.stringify({ success: false, error: "REPLICATE_API_TOKEN not set" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const aScale = Math.min(10, Math.max(2, Math.round(requestedScale > 1 ? requestedScale : Number(scale) || 8)));
      // daanelson/real-esrgan-a100 first (80GB GPU); nightmareai/real-esrgan
      // as automatic fallback (the account's other proven ESRGAN).
      let pred = await fetch("https://api.replicate.com/v1/models/daanelson/real-esrgan-a100/predictions", {
        method: "POST",
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ input: { image: image_url, scale: aScale } }),
      });
      if (!pred.ok) {
        console.warn(`[UPSCALE] a100 create ${pred.status} — falling back to nightmareai/real-esrgan`);
        pred = await fetch("https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions", {
          method: "POST",
          headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}`, "Content-Type": "application/json" },
          body: JSON.stringify({ input: { image: image_url, scale: aScale, face_enhance: false } }),
        });
      }
      if (!pred.ok) {
        const t = await pred.text();
        return new Response(JSON.stringify({ success: false, error: `replicate esrgan create ${pred.status}: ${t.slice(0, 200)}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      let p = await pred.json();
      for (let i = 0; i < 180 && (p.status === "starting" || p.status === "processing"); i++) {
        await new Promise((r) => setTimeout(r, 1500));
        const poll = await fetch(`https://api.replicate.com/v1/predictions/${p.id}`, {
          headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
        });
        if (poll.ok) p = await poll.json();
      }
      const outUrl = typeof p.output === "string" ? p.output : (Array.isArray(p.output) ? p.output[0] : "");
      if (p.status !== "succeeded" || !outUrl) {
        return new Response(JSON.stringify({ success: false, error: `replicate a100 ${p.status}: ${p.error || "no output"}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // Stream replicate.delivery → Storage REST (no buffering).
      const outPath = `panels/upscaled/${Date.now()}_${Math.random().toString(36).slice(2, 8)}_a100x${aScale}.png`;
      const dl = await fetch(outUrl);
      if (!dl.ok || !dl.body) {
        return new Response(JSON.stringify({ success: false, error: `a100 output fetch ${dl.status}`, replicate_url: outUrl }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      // New-format sb_secret keys are NOT JWTs — storage rejects them in
      // Authorization ("Invalid Compact JWS"); they belong in apikey. Legacy
      // JWT keys (start with "ey") still go in Authorization.
      const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const authHeaders: Record<string, string> = svcKey.startsWith("ey")
        ? { Authorization: `Bearer ${svcKey}`, apikey: svcKey }
        : { apikey: svcKey };
      const up = await fetch(`${Deno.env.get("SUPABASE_URL")}/storage/v1/object/${RESIZE_BUCKET}/${outPath}`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "image/png", "x-upsert": "true" },
        body: dl.body,
      });
      if (!up.ok) {
        const t = await up.text();
        // Streaming refused — hand back the (1-hour) Replicate URL so the
        // caller can still grab the file rather than losing the run.
        return new Response(JSON.stringify({ success: false, error: `storage stream ${up.status}: ${t.slice(0, 150)}`, replicate_url: outUrl }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const publicOut = supabase.storage.from(RESIZE_BUCKET).getPublicUrl(outPath).data.publicUrl;
      console.log(`[UPSCALE] a100 OK ×${aScale} → ${outPath}`);
      return new Response(JSON.stringify({
        success: true, engine: "esrgan-a100", upscaled_url: publicOut,
        requested_scale: aScale, achieved_scale: aScale, method: `real-esrgan-a100-${aScale}x`,
        elapsed_ms: Date.now() - startTime, panel_id, production_pack_id,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Engine selection: Topaz primary (Jumbo access), Replicate fallback.
    const useTopaz = engine !== "replicate" && !!TOPAZ_API_KEY;
    const useReplicate = !useTopaz && engine !== "topaz" && !!REPLICATE_API_TOKEN;

    if (!useTopaz && !useReplicate) {
      console.warn("[UPSCALE] No upscale key configured (TOPAZ_API_KEY/REPLICATE_API_TOKEN) — original resolution");
      return new Response(
        JSON.stringify({ success: false, error: "No upscale engine configured", fallback: "original_resolution" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ---- TOPAZ (primary) -----------------------------------------------------
    if (useTopaz) {
      if (!srcBytes) {
        return new Response(
          JSON.stringify({ success: false, error: "Could not fetch source for Topaz", fallback: "original_resolution" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const mime = srcBytes[0] === 0xff && srcBytes[1] === 0xd8 ? "image/jpeg" : "image/png";
      // topaz-upscale derives total = scale^passes (capped 6×). Pass the resolved
      // factor as a single pass so the request maps directly to our target.
      const result = await upscaleImageBytes(srcBytes, mime, supabase, {
        scale: requestedScale,
        passes: 1,
        userId: production_pack_id || panel_id || "production-pack",
        label: `panel ${panel_id || "?"}`,
        // Giant outputs (24k-px CGI panels) as PNG are ~200MB and OOM this
        // worker's buffered download — jpeg keeps them ~20MB. Print shops
        // accept JPEG; callers opt in via output_format.
        outputFormat: effFormat,
        // "CGI" redraws graphic/rendered-art edges instead of magnifying
        // their flaws — the right model for hard-edge wrap designs.
        model: (body as any)?.model || undefined,
      });

      if (!result.upscaled) {
        // Topaz declined/failed — try Replicate if available, else give up gracefully.
        if (REPLICATE_API_TOKEN && engine !== "topaz") {
          console.warn("[UPSCALE] Topaz did not upscale; falling through to Replicate");
        } else {
          return new Response(
            JSON.stringify({ success: false, error: `Topaz upscale unavailable — ${result.error || "unknown"}`, fallback: "original_resolution", elapsed_ms: Date.now() - startTime }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
      } else {
        // Persist the upscaled bytes and return their public URL.
        const outExt = effFormat === "jpeg" ? "jpg" : "png";
        const outPath = `panels/upscaled/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${outExt}`;
        const { error: upErr } = await supabase.storage
          .from(RESIZE_BUCKET)
          .upload(outPath, result.imageBytes, { contentType: outExt === "jpg" ? "image/jpeg" : "image/png", upsert: true });
        if (upErr) {
          return new Response(
            JSON.stringify({ success: false, error: `Topaz upload failed: ${upErr.message}`, fallback: "original_resolution" }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }
        const upscaledUrl = supabase.storage.from(RESIZE_BUCKET).getPublicUrl(outPath).data.publicUrl;
        const outDims = readPngJpegDims(result.imageBytes);
        const achievedScale = srcDims && outDims && srcDims.width > 0
          ? outDims.width / srcDims.width
          : requestedScale;
        console.log(`[UPSCALE] Topaz OK panel ${panel_id} — ${result.method} achieved ${achievedScale.toFixed(2)}×`);
        return new Response(
          JSON.stringify({
            success: true,
            engine: "topaz",
            upscaled_url: upscaledUrl,
            requested_scale: requestedScale,
            achieved_scale: achievedScale,
            method: result.method,
            elapsed_ms: Date.now() - startTime,
            panel_id,
            production_pack_id,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // ---- REPLICATE (fallback) ------------------------------------------------
    // Real-ESRGAN takes an INTEGER scale; round the resolved factor up so we never
    // fall short of the target, clamped to the GPU-safe ladder (2/4/6/8).
    let replicateScale = Math.min(8, Math.max(2, Math.ceil(requestedScale)));
    if (replicateScale > 6) replicateScale = 8;
    else if (replicateScale > 4) replicateScale = 6;
    else if (replicateScale > 2) replicateScale = 4;

    // GPU-fit guard: if the source exceeds Replicate's per-scale memory cap,
    // downscale + re-upload + swap the URL before sending to Real-ESRGAN.
    const cap = maxInputPixelsForScale(replicateScale);
    let replicateImageUrl = image_url;
    try {
      if (srcBytes) {
        const { Image } = await import("https://deno.land/x/imagescript@1.2.15/mod.ts");
        const srcImg = await Image.decode(srcBytes);
        const srcPixels = srcImg.width * srcImg.height;
        if (srcPixels > cap) {
          const factor = Math.sqrt(cap / srcPixels);
          const newW = Math.max(1, Math.floor(srcImg.width * factor));
          const newH = Math.max(1, Math.floor(srcImg.height * factor));
          srcImg.resize(newW, newH);
          const resizedBytes = await srcImg.encode();
          const path = `panels/upscale-gpu-fit/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
          const { error: upErr } = await supabase.storage
            .from(RESIZE_BUCKET)
            .upload(path, resizedBytes, { contentType: "image/png", upsert: true });
          if (upErr) {
            console.warn(`[UPSCALE] GPU-fit re-upload failed; sending original: ${upErr.message}`);
          } else {
            replicateImageUrl = supabase.storage.from(RESIZE_BUCKET).getPublicUrl(path).data.publicUrl;
            console.log(`[UPSCALE] scale=${replicateScale} → cap ${cap}; resized ${srcImg.width}×${srcImg.height} ← from ${srcPixels} px`);
          }
        }
      }
    } catch (fitErr) {
      console.warn(`[UPSCALE] GPU-fit step failed; sending original URL:`, fitErr);
    }

    const createResponse = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
        Prefer: "wait",
      },
      body: JSON.stringify({
        version: "f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa",
        input: { image: replicateImageUrl, scale: replicateScale, face_enhance: false },
      }),
    });

    if (!createResponse.ok) {
      const errText = await createResponse.text();
      console.error(`[UPSCALE] Replicate API error (${createResponse.status}):`, errText.slice(0, 500));
      return new Response(
        JSON.stringify({ success: false, error: `Replicate API error: ${createResponse.status}`, fallback: "original_resolution" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let result = await createResponse.json();
    let pollAttempts = 0;
    while (
      result.status !== "succeeded" && result.status !== "failed" &&
      result.status !== "canceled" && pollAttempts < MAX_POLL_ATTEMPTS
    ) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      pollAttempts++;
      const pollResponse = await fetch(result.urls.get, {
        headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
      });
      if (!pollResponse.ok) { console.error(`[UPSCALE] Poll failed (${pollResponse.status})`); break; }
      result = await pollResponse.json();
    }

    const elapsedMs = Date.now() - startTime;

    if (result.status !== "succeeded") {
      console.error(`[UPSCALE] Replicate ${result.status} for panel ${panel_id}:`, result.error);
      return new Response(
        JSON.stringify({ success: false, error: result.error || `Upscale ${result.status}`, fallback: "original_resolution", elapsed_ms: elapsedMs }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[UPSCALE] Replicate OK panel ${panel_id} in ${elapsedMs}ms (scale ${replicateScale}×)`);
    return new Response(
      JSON.stringify({
        success: true,
        engine: "replicate",
        upscaled_url: result.output,
        requested_scale: requestedScale,
        achieved_scale: replicateScale,
        scale: replicateScale,
        ...(input_dpi ? { new_dpi: Math.round(input_dpi * replicateScale) } : {}),
        elapsed_ms: elapsedMs,
        panel_id,
        production_pack_id,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    const elapsedMs = Date.now() - startTime;
    console.error("[UPSCALE] Unexpected error:", err);
    return new Response(
      JSON.stringify({ success: false, error: err.message || "Unexpected upscale error", fallback: "original_resolution", elapsed_ms: elapsedMs }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
