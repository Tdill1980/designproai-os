/**
 * production-prep-hybrid — Hybrid Vector + Upscale Production Pipeline
 *
 * One-button production prep. No ImageScript (too much memory).
 *
 * Pipeline:
 *   1. VECTORIZE — Full artboard → Vectorizer.ai → SVG + EPS
 *   2. UPSCALE   — Each user-marked photo region → Clarity (Replicate) 4x → hi-res PNG
 *   3. COMPOSITE — Overlay upscaled photos on top of vectorized SVG
 *   4. OUTPUT    — Production SVG + EPS + separate photo PNGs
 *
 * Upscale runs via Replicate (philz1337x/clarity-upscaler) — same model the
 * team trusted via Fal, but tiling is handled server-side so jumbo artboards
 * no longer OOM the Edge Function. REPLICATE_API_TOKEN is the required secret.
 * FAL_KEY is optional (used only by CodeFormer face-restore, non-blocking).
 *
 * Deploy: npx supabase functions deploy production-prep-hybrid --no-verify-jwt --project-ref kfapjdyythzyvnpdeghu
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { bytesToSvg, PRESET_LOGO } from "../_shared/vtracer/engine.ts";
import { svgToEps } from "../_shared/svg-to-eps.ts";

const GEMINI_VISION_MODEL = "gemini-2.5-flash"; // gemini-2.0-flash retired by Google
const BUCKET = "wrap-files";

// ── Inlined from _shared/cors.ts ─────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ── Inlined from _shared/gemini-key-pool.ts ──────────────────────
const _geminiPool: string[] = [];
let _geminiLoaded = false;
let _geminiIdx = 0;
function _loadGemini(): void {
  if (_geminiLoaded) return;
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) _geminiPool.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) _geminiPool.push(k);
  }
  _geminiLoaded = true;
}
function getGeminiKey(): string {
  _loadGemini();
  if (_geminiPool.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");
  const key = _geminiPool[_geminiIdx % _geminiPool.length];
  _geminiIdx++;
  return key;
}

// ── Inlined from _shared/panelizer-os/storage.ts ─────────────────
function _serviceClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}
async function uploadToStorage(path: string, bytes: Uint8Array, contentType = "image/png"): Promise<string> {
  const { error } = await _serviceClient().storage.from(BUCKET).upload(path, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload failed [${path}]: ${error.message}`);
  return path;
}
async function getSignedUrl(path: string): Promise<string> {
  const { data, error } = await _serviceClient().storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw new Error(`Signed URL failed [${path}]: ${error.message}`);
  return data.signedUrl;
}
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function log(msg: string, data?: unknown) {
  if (data !== undefined) console.log(`[HYBRID] ${msg}`, JSON.stringify(data));
  else console.log(`[HYBRID] ${msg}`);
}
function errLog(msg: string, err?: unknown) {
  console.error(`[HYBRID] ${msg}`, err);
}
function jsonResp(body: Record<string, unknown>) {
  return new Response(JSON.stringify({ success: !body.error, ...body }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Read PNG width+height from first 24 bytes without decoding the full image */
function pngDimensions(bytes: Uint8Array): { width: number; height: number } {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    const w = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const h = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    return { width: w, height: h };
  }
  return { width: 0, height: 0 };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { job_id, photo_regions: manualRegions, skip_vectorize, skip_eps, vectorize_only } = body;
    if (!job_id) return jsonResp({ error: "job_id is required" });

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: job, error: jobErr } = await sb.from("panelizer_jobs").select("*").eq("id", job_id).single();
    if (jobErr || !job) return jsonResp({ error: "Job not found" });

    log(`Starting hybrid production prep for job ${job_id}`);

    // Clarity upscale now runs through Replicate (tiling handled server-side,
    // no local OOM) so REPLICATE_API_TOKEN is the required secret. FAL_KEY is
    // optional — only used by CodeFormer face-restore, which is non-blocking.
    const REPLICATE_KEY = Deno.env.get("REPLICATE_API_TOKEN");
    if (!REPLICATE_KEY) return jsonResp({ error: "Missing REPLICATE_API_TOKEN" });
    const FAL_KEY = Deno.env.get("FAL_KEY") || "";

    // ── Download artboard ───────────────────────────────────────
    const artboardPath = `artboards/${job_id}/artboard.png`;
    const { data: artboardBlob, error: dlErr } = await sb.storage.from("wrap-files").download(artboardPath);
    if (dlErr || !artboardBlob) return jsonResp({ error: `No artboard found at ${artboardPath}` });

    const artboardBytes = new Uint8Array(await artboardBlob.arrayBuffer());
    const { width: imgW, height: imgH } = pngDimensions(artboardBytes);
    log(`Artboard: ${imgW}x${imgH}px (${(artboardBytes.byteLength / 1024).toFixed(0)} KB)`);

    // Get public URL for Clarity (needs URL, not bytes)
    const { data: { publicUrl: artboardPublicUrl } } = sb.storage.from("wrap-files").getPublicUrl(artboardPath);

    const startMs = Date.now();

    // ════════════════════════════════════════════════════════════════
    // FAST PATH: SKIP VECTORIZE
    // Just upscale the full artboard with Clarity and wrap as raster EPS.
    // No Gemini analysis, no masking, no vectorize, no overlay.
    // ════════════════════════════════════════════════════════════════
    if (skip_vectorize) {
      log(`skip_vectorize=true${skip_eps ? " skip_eps=true" : ""} → raster upscale${skip_eps ? " only (no EPS)" : " + EPS"}`);

      const upRes = await clarityUpscale(REPLICATE_KEY, artboardPublicUrl, 4);
      if ("error" in upRes) return jsonResp({ error: `Upscale failed: ${upRes.error}` });

      const upResp = await fetch(upRes.url);
      if (!upResp.ok) return jsonResp({ error: `Upscaled fetch failed: ${upResp.status}` });
      const upscaledPngBytes = new Uint8Array(await upResp.arrayBuffer());
      const { width: upW, height: upH } = pngDimensions(upscaledPngBytes);
      log(`Upscaled artboard: ${upW}x${upH}px (${(upscaledPngBytes.byteLength / 1024).toFixed(0)} KB)`);

      // Save upscaled PNG (always)
      const upscaledPath = `artboards/${job_id}/production/artboard-upscaled.png`;
      await uploadToStorage(upscaledPath, upscaledPngBytes, "image/png");
      const upscaledUrl = await getSignedUrl(upscaledPath);

      // Also save to the legacy path the QC UI watches for the green
      // "Upscaled PNG" download button next to the artboard preview.
      const legacyUpscaledPath = `artboards/${job_id}/artboard-upscaled.png`;
      await uploadToStorage(legacyUpscaledPath, upscaledPngBytes, "image/png");

      let epsUrl: string | null = null;
      let epsPath: string | null = null;
      let epsSizeKb = 0;

      if (!skip_eps) {
        // Decode → re-encode as JPEG for compact embedding in EPS
        let jpegBytes: Uint8Array;
        try {
          const img = await Image.decode(upscaledPngBytes);
          jpegBytes = await img.encodeJPEG(90);
        } catch (e: any) {
          return jsonResp({ error: `JPEG encode failed: ${e?.message || e}` });
        }
        log(`JPEG for EPS: ${(jpegBytes.byteLength / 1024).toFixed(0)} KB`);

        const epsBytes = buildRasterEps(jpegBytes, upW || imgW, upH || imgH);
        epsPath = `artboards/${job_id}/production/artboard-vector.eps`;
        await uploadToStorage(epsPath, epsBytes, "application/postscript");
        epsUrl = await getSignedUrl(epsPath);
        epsSizeKb = Math.round(epsBytes.byteLength / 1024);
        log(`Raster EPS: ${epsSizeKb} KB`);
      }

      const mode = skip_eps ? "upscale_only" : "raster_only";

      // Persist on the job so the existing UI download buttons light up
      const existingCj = (job.concept_json || {}) as Record<string, any>;
      await sb.from("panelizer_jobs").update({
        concept_json: {
          ...existingCj,
          production_prep: {
            status: "complete",
            mode,
            is_pure_graphic: false,
            ...(epsUrl ? { eps_url: epsUrl, eps_path: epsPath, eps_size_kb: epsSizeKb } : {}),
            upscaled_png_url: upscaledUrl,
            upscaled_png_path: upscaledPath,
            upscaled_width: upW,
            upscaled_height: upH,
            generated_at: new Date().toISOString(),
          },
        },
      }).eq("id", job_id);

      const elapsed = Date.now() - startMs;
      return jsonResp({
        success: true,
        mode,
        ...(epsUrl ? { eps_url: epsUrl, eps_path: epsPath, eps_size_kb: epsSizeKb } : {}),
        upscaled_png_url: upscaledUrl,
        upscaled_png_path: upscaledPath,
        upscaled_width: upW,
        upscaled_height: upH,
        message: skip_eps
          ? `Upscaled to ${upW}x${upH}. ${(elapsed / 1000).toFixed(1)}s.`
          : `Raster upscale + EPS ready (no vectorize). ${(elapsed / 1000).toFixed(1)}s.`,
      });
    }

    // ── Resolve photo regions ───────────────────────────────────
    let photoRegions: Array<{ description: string; x_percent: number; y_percent: number; width_percent: number; height_percent: number }> = [];

    if (vectorize_only) {
      log("vectorize_only=true — skipping photo region detection, pure CutPath vector trace");
      // photoRegions stays empty so hasPhotos=false and the upscale/composite branches are skipped
    } else if (manualRegions && Array.isArray(manualRegions) && manualRegions.length > 0) {
      log(`Using ${manualRegions.length} user-marked photo region(s)`);
      photoRegions = manualRegions;
    } else {
      log("No manual regions — running Gemini analysis");
      const artboardBase64 = uint8ArrayToBase64(artboardBytes);
      const analysis = await analyzeWithGemini(artboardBase64);
      photoRegions = analysis.photo_regions;
      log("Gemini analysis", { pure_graphic: analysis.is_pure_graphic, photos: photoRegions.length });
    }

    const hasPhotos = photoRegions.length > 0;

    // ══════════════════════════════════════════════════════════════
    // STEP 1: MASK photo regions (if any) then VECTORIZE
    // Mask with magenta so Vectorizer.ai only traces the graphics.
    // Photo regions become simple magenta rectangles in the vector output.
    // ══════════════════════════════════════════════════════════════
    let vectorizeBytes = artboardBytes;
    const maskedPath = `artboards/${job_id}/production/artboard-masked.png`;

    if (hasPhotos) {
      log(`Step 1a: MASK — ${photoRegions.length} photo region(s) with magenta`);
      const maskResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/mask-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          storage_path: artboardPath,
          output_path: maskedPath,
          regions: photoRegions.map(r => ({
            x_percent: r.x_percent, y_percent: r.y_percent,
            width_percent: r.width_percent, height_percent: r.height_percent,
          })),
          fill_color: "FF00FF",
        }),
        signal: AbortSignal.timeout(60_000),
      });

      const maskResult = await maskResp.json();
      if (maskResult.success) {
        log(`Masked artboard saved to ${maskedPath}`);
        // Download masked version for vectorization
        const { data: maskedBlob } = await sb.storage.from("wrap-files").download(maskedPath);
        if (maskedBlob) {
          vectorizeBytes = new Uint8Array(await maskedBlob.arrayBuffer());
          log(`Masked artboard: ${(vectorizeBytes.byteLength / 1024).toFixed(0)} KB`);
        }
      } else {
        errLog(`Masking failed: ${maskResult.error} — vectorizing full artboard`);
      }
    }

    log("Step 1b+1c: VECTORIZE → SVG (VTracer WASM) + EPS (svg-to-eps)");
    // Downscale input to max 1200px on longest side before VTracer. Vector
    // output is resolution-independent so logo quality is identical at print
    // size; the only thing this sacrifices is tracing extremely fine details.
    // 1800 was still crashing WORKER_LIMIT (546) on complex artboards — 1200
    // gives ~2.25x less memory pressure in the WASM tracer.
    const MAX_TRACE_DIM = 1200;
    let traceBytes = vectorizeBytes;
    try {
      const srcImg = await Image.decode(vectorizeBytes);
      const longest = Math.max(srcImg.width, srcImg.height);
      if (longest > MAX_TRACE_DIM) {
        const scale = MAX_TRACE_DIM / longest;
        const newW = Math.round(srcImg.width * scale);
        const newH = Math.round(srcImg.height * scale);
        srcImg.resize(newW, newH);
        traceBytes = new Uint8Array(await srcImg.encode());
        log(`Downscaled for VTracer: ${srcImg.width}x${srcImg.height} -> ${newW}x${newH} (${(traceBytes.byteLength / 1024).toFixed(0)} KB)`);
      } else {
        log(`Source within limit (${srcImg.width}x${srcImg.height}), tracing at native resolution`);
      }
    } catch (e: any) {
      log(`Resize skipped (${e?.message || e}), tracing original bytes`);
    }

    // PRESET_LOGO instead of PRESET_DETAILED: fewer color layers + bigger
    // layer steps = significantly less memory in the WASM tracer. PRESET_DETAILED
    // is tuned for photo-traced artwork (colorPrecision=7, layerDifference=12)
    // which is exactly what blows memory. Artboards with real photo regions
    // should use skip_vectorize anyway — vectorizing photos produces garbage.
    const { svg: svgText, width: artW, height: artH } = await bytesToSvg(traceBytes, PRESET_LOGO);
    // Free the downscaled buffer now that VTracer has it
    traceBytes = null as any;
    log(`SVG: ${(svgText.length / 1024).toFixed(0)} KB (${artW}x${artH})`);
    const epsPath = `artboards/${job_id}/production/artboard-vector.eps`;
    const epsFinalBytes = svgToEps(svgText, {
      widthPts: artW,
      heightPts: artH,
      dscHeaders: [
        `%%Creator: RestylePro production-prep-hybrid (VTracer)`,
        `%%Title: artboard-vector.eps`,
        `%%CreationDate: ${new Date().toISOString()}`,
      ],
      creator: "RestylePro production-prep-hybrid (VTracer)",
      title: "artboard-vector.eps",
    });
    await uploadToStorage(epsPath, epsFinalBytes, "application/postscript");
    const epsUrl = await getSignedUrl(epsPath);
    log(`EPS: ${(epsFinalBytes.byteLength / 1024).toFixed(0)} KB`);

    // Free vectorize bytes to reduce memory pressure
    vectorizeBytes = null as any;
    // Clean up masked file
    if (hasPhotos) {
      await sb.storage.from("wrap-files").remove([maskedPath]);
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 2: CROP + UPSCALE photo regions
    // Deterministic crop via crop-region function, then Clarity 4x.
    // ══════════════════════════════════════════════════════════════
    const upscaledRegions: Array<{
      idx: number; description: string;
      path: string; url: string; base64: string;
      width: number; height: number;
      placement: { x_pct: number; y_pct: number; w_pct: number; h_pct: number };
    }> = [];

    if (hasPhotos) {
      log(`Step 2: UPSCALE — ${photoRegions.length} photo region(s)`);

      for (let i = 0; i < photoRegions.length; i++) {
        const r = photoRegions[i];
        log(`  Photo ${i + 1}: "${r.description}" at (${r.x_percent.toFixed(1)}%, ${r.y_percent.toFixed(1)}%) ${r.width_percent.toFixed(1)}%x${r.height_percent.toFixed(1)}%`);

        try {
          // Deterministic crop via crop-region edge function
          const cropPath = `artboards/${job_id}/production/photo-${i}-crop.png`;
          const cropResp = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/crop-region`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              storage_path: artboardPath,
              x_percent: r.x_percent,
              y_percent: r.y_percent,
              width_percent: r.width_percent,
              height_percent: r.height_percent,
              output_path: cropPath,
            }),
            signal: AbortSignal.timeout(60_000),
          });

          const cropResult = await cropResp.json();
          if (!cropResult.success) {
            errLog(`  Crop failed: ${cropResult.error}`);
            continue;
          }

          log(`  Cropped: ${cropResult.width}x${cropResult.height}px (${cropResult.size_kb} KB)`);
          const cropUrl = await getSignedUrl(cropPath);

          // Upscale
          log(`  Upscaling via Clarity 4x...`);
          const upResult = await clarityUpscale(REPLICATE_KEY, cropUrl, 4);

          let finalPath: string, finalUrl: string, finalBase64: string;
          let finalW: number, finalH: number;

          if ("error" in upResult) {
            errLog(`  Clarity failed: ${upResult.error} — using original crop`);
            // Download crop to get base64 for SVG embedding
            const { data: cropBlob } = await sb.storage.from("wrap-files").download(cropPath);
            const cropBytes = cropBlob ? new Uint8Array(await cropBlob.arrayBuffer()) : new Uint8Array();
            finalPath = cropPath;
            finalUrl = cropUrl;
            finalBase64 = uint8ArrayToBase64(cropBytes);
            finalW = cropResult.width;
            finalH = cropResult.height;
          } else {
            let photoUrl = upResult.url;
            let photoW = upResult.width;
            let photoH = upResult.height;
            log(`  Upscaled: ${photoW}x${photoH}px`);

            // Face restoration via CodeFormer (optional — skipped if FAL_KEY unset)
            if (FAL_KEY) {
              log(`  Restoring faces via CodeFormer...`);
              const faceResult = await faceRestore(FAL_KEY, photoUrl);
              if (!("error" in faceResult)) {
                photoUrl = faceResult.url;
                photoW = faceResult.width;
                photoH = faceResult.height;
                log(`  Faces restored: ${photoW}x${photoH}px`);
              } else {
                log(`  Face restore skipped: ${faceResult.error}`);
              }
            } else {
              log(`  Face restore skipped: FAL_KEY not configured`);
            }

            const upResp = await fetch(photoUrl);
            const upBytes = new Uint8Array(await upResp.arrayBuffer());
            finalPath = `artboards/${job_id}/production/photo-${i}-upscaled.png`;
            await uploadToStorage(finalPath, upBytes, "image/png");
            finalUrl = await getSignedUrl(finalPath);
            finalBase64 = uint8ArrayToBase64(upBytes);
            finalW = photoW;
            finalH = photoH;
            // Clean up crop
            await sb.storage.from("wrap-files").remove([cropPath]);
          }

          upscaledRegions.push({
            idx: i, description: r.description,
            path: finalPath, url: finalUrl, base64: finalBase64,
            width: finalW, height: finalH,
            placement: { x_pct: r.x_percent, y_pct: r.y_percent, w_pct: r.width_percent, h_pct: r.height_percent },
          });
        } catch (e: any) {
          errLog(`  Photo ${i + 1} failed: ${e.message}`);
        }
      }
    }

    // ══════════════════════════════════════════════════════════════
    // STEP 3: COMPOSITE — Overlay upscaled photos on SVG
    // The vectorized photos are underneath; upscaled photos go on top.
    // ══════════════════════════════════════════════════════════════
    let compositeSvg = svgText;

    if (upscaledRegions.length > 0) {
      log("Step 3: COMPOSITE — Overlaying photos on SVG");

      const vbMatch = compositeSvg.match(/viewBox="([^"]+)"/);
      const svgWMatch = compositeSvg.match(/width="([^"]+)"/);
      const svgHMatch = compositeSvg.match(/height="([^"]+)"/);

      let svgW = imgW, svgH = imgH;
      if (vbMatch) {
        const parts = vbMatch[1].split(/\s+/).map(Number);
        svgW = parts[2] || imgW;
        svgH = parts[3] || imgH;
      } else if (svgWMatch && svgHMatch) {
        svgW = parseFloat(svgWMatch[1]) || imgW;
        svgH = parseFloat(svgHMatch[1]) || imgH;
      }

      const imageElements: string[] = [];
      for (const ur of upscaledRegions) {
        const x = (ur.placement.x_pct / 100) * svgW;
        const y = (ur.placement.y_pct / 100) * svgH;
        const w = (ur.placement.w_pct / 100) * svgW;
        const h = (ur.placement.h_pct / 100) * svgH;
        imageElements.push(
          `<image x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="data:image/png;base64,${ur.base64}" preserveAspectRatio="none" />`
        );
      }

      compositeSvg = compositeSvg.replace(/<\/svg>\s*$/, `\n${imageElements.join("\n")}\n</svg>`);
    }

    // Upload SVG
    const svgPath = `artboards/${job_id}/production/artboard-production.svg`;
    const svgBytes = new TextEncoder().encode(compositeSvg);
    await uploadToStorage(svgPath, svgBytes, "image/svg+xml");
    const svgUrl = await getSignedUrl(svgPath);

    // ── Update job ──────────────────────────────────────────────
    const conceptJson = (job.concept_json as Record<string, unknown>) || {};
    const elapsed = Date.now() - startMs;

    await sb.from("panelizer_jobs").update({
      concept_json: {
        ...conceptJson,
        production_prep: {
          status: "complete",
          completed_at: new Date().toISOString(),
          processing_time_ms: elapsed,
          is_pure_graphic: !hasPhotos,
          svg_path: svgPath,
          svg_size_kb: Math.round(svgBytes.byteLength / 1024),
          eps_path: epsPath,
          eps_size_kb: Math.round(epsFinalBytes.byteLength / 1024),
          photo_regions: upscaledRegions.map(r => ({
            description: r.description, path: r.path, url: r.url,
            width: r.width, height: r.height, placement: r.placement,
          })),
        },
      },
    }).eq("id", job_id);

    log(`Done in ${(elapsed / 1000).toFixed(1)}s`);

    return jsonResp({
      success: true,
      processing_time_ms: elapsed,
      is_pure_graphic: !hasPhotos,
      svg_url: svgUrl,
      svg_path: svgPath,
      svg_size_kb: Math.round(svgBytes.byteLength / 1024),
      eps_url: epsUrl,
      eps_path: epsPath,
      eps_size_kb: Math.round(epsFinalBytes.byteLength / 1024),
      photo_regions: upscaledRegions.map(r => ({
        description: r.description, url: r.url, path: r.path,
        width: r.width, height: r.height, placement: r.placement,
      })),
      message: hasPhotos
        ? `Hybrid — SVG with ${upscaledRegions.length} upscaled photo(s) overlaid on vectors. ${(elapsed / 1000).toFixed(1)}s.`
        : `Pure vector — SVG + EPS. Infinite resolution.`,
    });
  } catch (err: any) {
    errLog("Unhandled", err?.message || err);
    return jsonResp({ error: err?.message || "Internal server error" });
  }
});

// ═══════════════════════════════════════════════════════════════════
// ANALYZE — Gemini Vision (fallback when no manual regions)
// ═══════════════════════════════════════════════════════════════════

interface PhotoRegion { description: string; x_percent: number; y_percent: number; width_percent: number; height_percent: number; }
interface AnalysisResult { is_pure_graphic: boolean; summary: string; photo_regions: PhotoRegion[]; }

async function analyzeWithGemini(imageBase64: string): Promise<AnalysisResult> {
  const key = getGeminiKey();
  const prompt = `Look at this vehicle wrap design. Find ALL areas containing people, human figures, faces, bodies, athletes, models, animals, or any photorealistic imagery (real OR AI-generated).

Return JSON:
{"is_pure_graphic": false, "summary": "description", "photo_regions": [{"description": "what", "x_percent": 0-100, "y_percent": 0-100, "width_percent": 0-100, "height_percent": 0-100}]}

Set is_pure_graphic true ONLY if there are absolutely ZERO photorealistic elements. When in doubt, mark it as a photo region. JSON only.`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: "image/png", data: imageBase64 } }] }],
          generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) return { is_pure_graphic: true, summary: "Analysis failed", photo_regions: [] };
    const data = await response.json();
    const parsed = JSON.parse(data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}");
    return { is_pure_graphic: !!parsed.is_pure_graphic, summary: parsed.summary || "", photo_regions: Array.isArray(parsed.photo_regions) ? parsed.photo_regions : [] };
  } catch {
    return { is_pure_graphic: true, summary: "Analysis failed", photo_regions: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════
// RASTER EPS — wrap a JPEG in a minimal PostScript Level 2 EPS
// Uses /DCTDecode (native JPEG) + /ASCIIHexDecode for portability.
// Result opens directly in Illustrator, Photoshop, RIP software, etc.
// ═══════════════════════════════════════════════════════════════════
function buildRasterEps(jpegBytes: Uint8Array, widthPx: number, heightPx: number): Uint8Array {
  // Hex-encode the JPEG payload, 64 hex chars (= 32 bytes) per line
  const HEX = "0123456789ABCDEF";
  const lineLen = 64;
  let hex = "";
  for (let i = 0; i < jpegBytes.length; i++) {
    const b = jpegBytes[i];
    hex += HEX[b >> 4] + HEX[b & 0x0f];
    if (((i + 1) * 2) % lineLen === 0) hex += "\n";
  }
  if (!hex.endsWith("\n")) hex += "\n";

  const W = Math.max(1, widthPx);
  const H = Math.max(1, heightPx);

  const header =
    `%!PS-Adobe-3.0 EPSF-3.0\n` +
    `%%Creator: RestylePro QC Artboard (raster)\n` +
    `%%Title: artboard-raster.eps\n` +
    `%%BoundingBox: 0 0 ${W} ${H}\n` +
    `%%HiResBoundingBox: 0 0 ${W} ${H}\n` +
    `%%Pages: 1\n` +
    `%%DocumentData: Clean7Bit\n` +
    `%%LanguageLevel: 2\n` +
    `%%EndComments\n` +
    `%%Page: 1 1\n` +
    `gsave\n` +
    `0 0 translate\n` +
    `${W} ${H} scale\n` +
    `/DeviceRGB setcolorspace\n` +
    `<<\n` +
    `  /ImageType 1\n` +
    `  /Width ${W}\n` +
    `  /Height ${H}\n` +
    `  /BitsPerComponent 8\n` +
    `  /Decode [0 1 0 1 0 1]\n` +
    `  /ImageMatrix [${W} 0 0 -${H} 0 ${H}]\n` +
    `  /DataSource currentfile /ASCIIHexDecode filter /DCTDecode filter\n` +
    `>>\n` +
    `image\n`;
  const footer = `>\n` + `grestore\n` + `showpage\n` + `%%EOF\n`;

  return new TextEncoder().encode(header + hex + footer);
}

// ═══════════════════════════════════════════════════════════════════
// UPSCALE — Clarity via Replicate
// ═══════════════════════════════════════════════════════════════════
// philz1337x/clarity-upscaler is the SAME Clarity (ControlNet Tile) model
// the team trusted via Fal — same face-preserving quality. Running it via
// Replicate means tiling is handled server-side, avoiding the 256 MB Edge
// Function OOM that was crashing Fal-based upscales at ~6s. Model string
// is env-overridable via CLARITY_REPLICATE_MODEL. REPLICATE_API_TOKEN is
// the only secret required.

const CLARITY_REPLICATE_MODEL =
  Deno.env.get("CLARITY_REPLICATE_MODEL") || "philz1337x/clarity-upscaler";

async function clarityUpscale(
  replicateKey: string, imageUrl: string, scale: number,
): Promise<{ url: string; width: number; height: number } | { error: string }> {
  const clarityScale = Math.min(4, Math.max(2, Math.round(scale)));
  try {
    const predResp = await fetch(
      `https://api.replicate.com/v1/models/${CLARITY_REPLICATE_MODEL}/predictions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${replicateKey}`,
          "Content-Type": "application/json",
          Prefer: "wait=60",
        },
        body: JSON.stringify({
          input: {
            image: imageUrl,
            scale_factor: clarityScale,
            prompt: "high resolution, sharp details, professional print quality, preserve all faces and fine details exactly as original",
            negative_prompt: "(worst quality, low quality, blurry, noise, artifacts, distorted face, warped eyes, melted skin:2)",
            creativity: 0.05,
            resemblance: 0.95,
            dynamic: 6,
            handfix: "disabled",
            sharpen: 0,
            downscaling: false,
            num_inference_steps: 18,
            output_format: "png",
          },
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!predResp.ok) {
      const errText = await predResp.text().catch(() => "");
      return { error: `Replicate Clarity create HTTP ${predResp.status}: ${errText.slice(0, 200)}` };
    }

    let prediction = await predResp.json();
    const startMs = Date.now();
    // Clarity at 4x on a 4 MP+ artboard can take 2-4 minutes; poll up to ~5 min.
    if (!["succeeded", "failed", "canceled"].includes(prediction.status)) {
      for (let i = 0; i < 300; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (Date.now() - startMs > 290_000) break;
        const s = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { Authorization: `Bearer ${replicateKey}` },
        });
        if (!s.ok) continue;
        prediction = await s.json();
        if (["succeeded", "failed", "canceled"].includes(prediction.status)) break;
      }
    }

    if (prediction.status !== "succeeded") {
      return { error: `Replicate Clarity ${prediction.status}: ${prediction.error || "timeout"}` };
    }

    const outputUrl: string | undefined =
      typeof prediction.output === "string" ? prediction.output :
      Array.isArray(prediction.output) ? prediction.output[0] :
      undefined;
    if (!outputUrl) return { error: "Replicate Clarity returned no output URL" };

    // Replicate prediction metadata doesn't reliably expose width/height; the
    // downstream code uses them only for logging. Downstream re-reads the PNG
    // header if it needs exact dims.
    return { url: outputUrl, width: 0, height: 0 };
  } catch (err: any) {
    return { error: err?.message || "unknown" };
  }
}

// ═══════════════════════════════════════════════════════════════════
// FACE RESTORE — CodeFormer via Fal.ai
// ═══════════════════════════════════════════════════════════════════

async function faceRestore(
  falKey: string, imageUrl: string,
): Promise<{ url: string; width: number; height: number } | { error: string }> {
  try {
    const res = await fetch("https://fal.run/fal-ai/codeformer", {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        fidelity: 0.7,
        face_upscale: true,
        only_center_face: false,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return { error: `CodeFormer ${res.status}` };
    const data = await res.json();
    const img = data.image as { url?: string; width?: number; height?: number } | undefined;
    if (img?.url) return { url: img.url, width: img.width || 0, height: img.height || 0 };
    return { error: "No image returned" };
  } catch (err: any) {
    return { error: err?.message || "unknown" };
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function base64ToUint8Array(base64: string): Uint8Array {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
