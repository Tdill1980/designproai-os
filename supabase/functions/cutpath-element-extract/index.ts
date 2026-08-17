/**
 * cutpath-element-extract — Per-element cut-ready file producer (vector + raster)
 *
 * TWO input modes:
 *
 *   ELEMENTS mode  { elements: [{ url, label }], owner_id?, job_id? }
 *     The Logo Pack producer. Each element is an already-extracted, transparent
 *     PNG (a real-pixel lifted logo / lettering). It is downloaded as-is and
 *     traced directly — NO crop-from-artboard (the cut-out already exists) and
 *     NO Clarity raster pass (an upscaler flattens the alpha and bakes a
 *     background behind the cut, which is exactly the ghosted rectangle the
 *     Logo Pack must avoid). The transparent PNG IS the raster; VTracer gives
 *     the contour vector. This is the sanctioned producer for the Logo Pack.
 *
 *   REGIONS mode  { job_id, regions: [{ x_percent, y_percent, width_percent,
 *                                       height_percent, label? }, ...] }
 *     Operator flow. Each marked region is cropped off the job's artboard, then
 *     runs BOTH pipelines below (vector + Clarity 4x raster).
 *
 *   VECTOR PATH  (both modes)
 *     VTracer WASM → SVG (curve-fit Bézier) → svg-to-eps → PostScript L2 EPS.
 *
 *   RASTER PATH
 *     ELEMENTS: the original transparent PNG, alpha preserved (no upscale).
 *     REGIONS:  Clarity AI 4x upscale via Fal.ai.
 *
 * Both outputs ship inside a single ZIP per call:
 *
 *   element-pack-<packId>-<timestamp>.zip
 *     ├── vector/   01_<label>.svg, 01_<label>.eps, ...
 *     ├── raster/   01_<label>.png, ...
 *     ├── crops/    original 1x element/crop, for reference
 *     └── extract-manifest.json
 *
 * Non-destructive: the source artboard / render is never modified.
 *
 * Deploy: npx supabase functions deploy cutpath-element-extract \
 *           --project-ref kfapjdyythzyvnpdeghu
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { corsHeaders } from "../_shared/cors.ts";
import { bytesToSvg, PRESET_LOGO } from "../_shared/vtracer/engine.ts";
import { svgToEps } from "../_shared/svg-to-eps.ts";

const BUCKET = "wrap-files";

interface ExtractRegion {
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
  label?: string;
}

interface ExtractElement {
  url: string;
  label?: string;
}

interface ElementResult {
  index: number;
  label: string;
  cropPath: string;
  vectorSvgPath: string;
  vectorEpsPath: string;
  rasterPngPath: string;
  vectorSvgUrl: string;
  vectorEpsUrl: string;
  rasterPngUrl: string;
  vectorOk: boolean;
  rasterOk: boolean;
  errors: string[];
  cropWidth: number;
  cropHeight: number;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json();
    const { job_id, regions, elements, owner_id } = body as {
      job_id?: string;
      regions?: ExtractRegion[];
      elements?: ExtractElement[];
      owner_id?: string;
    };

    // ELEMENTS mode wins when a non-empty elements array is supplied: the Logo
    // Pack feeds already-lifted transparent PNGs, so there is nothing to crop.
    const elementsMode = Array.isArray(elements) && elements.length > 0;

    if (!elementsMode) {
      if (!job_id) return jsonResp({ error: "job_id is required" }, 400);
      if (!Array.isArray(regions) || regions.length === 0) {
        return jsonResp({ error: "regions array required (at least one region)" }, 400);
      }
    } else {
      const bad = elements!.find((e) => !e || typeof e.url !== "string" || !e.url.trim());
      if (bad !== undefined) return jsonResp({ error: "every element needs a url" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const FAL_KEY = Deno.env.get("FAL_KEY");
    // Clarity only runs in REGIONS mode — never gate a Logo Pack cut on it.
    if (!elementsMode && !FAL_KEY) return jsonResp({ error: "FAL_KEY not configured" }, 500);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // The job is REQUIRED for regions mode (it owns the artboard) and OPTIONAL
    // for elements mode (the Logo Pack lives on a color_visualizations row).
    let job: Record<string, any> | null = null;
    if (job_id) {
      const { data: jobRow } = await sb
        .from("panelizer_jobs")
        .select("*")
        .eq("id", job_id)
        .maybeSingle();
      job = jobRow || null;
    }
    if (!elementsMode && !job) return jsonResp({ error: "Job not found" }, 404);

    const userId = job?.user_id || owner_id || "logopack";
    const packId = job_id || `logopack-${Date.now()}`;
    const startMs = Date.now();
    const artboardPath = job_id ? `artboards/${job_id}/artboard.png` : "";
    const itemCount = elementsMode ? elements!.length : regions!.length;

    console.log(`[CUTPATH-ELEMENT] ${elementsMode ? "elements" : "regions"} mode | ${packId} | ${itemCount} item(s)`);

    const results: ElementResult[] = [];
    const zip = new JSZip();
    const vectorFolder = zip.folder("vector")!;
    const rasterFolder = zip.folder("raster")!;
    const cropsFolder = zip.folder("crops")!;

    for (let i = 0; i < itemCount; i++) {
      const idx = i + 1;
      const r = elementsMode ? undefined : regions![i];
      const el = elementsMode ? elements![i] : undefined;
      const labelRaw = ((elementsMode ? el!.label : r!.label) || `element-${idx}`).trim();
      const label = labelRaw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      const fileBase = `${String(idx).padStart(2, "0")}_${label}`;
      const errors: string[] = [];

      if (elementsMode) {
        console.log(`[CUTPATH-ELEMENT] → ${fileBase}: ${el!.url.slice(0, 80)}`);
      } else {
        console.log(`[CUTPATH-ELEMENT] → ${fileBase}: (${r!.x_percent.toFixed(1)}%, ${r!.y_percent.toFixed(1)}%) ${r!.width_percent.toFixed(1)}%x${r!.height_percent.toFixed(1)}%`);
      }

      // ─── 1. Acquire the source bytes for this item ───
      const cropPath = `artboards/${packId}/elements/${fileBase}-crop.png`;
      let cropOk = false;
      let cropWidth = 0;
      let cropHeight = 0;
      let cropBytes: Uint8Array | null = null;

      if (elementsMode) {
        // Download the already-extracted transparent element directly.
        try {
          const resp = await fetch(el!.url, { signal: AbortSignal.timeout(60_000) });
          if (!resp.ok) throw new Error(`fetch element: ${resp.status}`);
          cropBytes = new Uint8Array(await resp.arrayBuffer());
          if (!cropBytes.byteLength) throw new Error("element is empty");
          cropsFolder.file(`${fileBase}.png`, cropBytes);
          cropOk = true;
          console.log(`[CUTPATH-ELEMENT]   element ok: ${(cropBytes.byteLength / 1024).toFixed(0)} KB`);
        } catch (e: any) {
          errors.push(`fetch: ${e.message}`);
          console.warn(`[CUTPATH-ELEMENT]   fetch FAIL: ${e.message}`);
        }
      } else {
        // Crop the region from the artboard.
        try {
          const cropResp = await fetch(`${SUPABASE_URL}/functions/v1/crop-region`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SERVICE_KEY}`,
            },
            body: JSON.stringify({
              storage_path: artboardPath,
              x_percent: r!.x_percent,
              y_percent: r!.y_percent,
              width_percent: r!.width_percent,
              height_percent: r!.height_percent,
              output_path: cropPath,
            }),
            signal: AbortSignal.timeout(60_000),
          });
          const cropResult = await cropResp.json();
          if (!cropResult.success) throw new Error(cropResult.error || "crop failed");
          cropOk = true;
          cropWidth = cropResult.width || 0;
          cropHeight = cropResult.height || 0;

          const { data: cropBlob } = await sb.storage.from(BUCKET).download(cropPath);
          if (!cropBlob) throw new Error("crop downloaded blob is empty");
          cropBytes = new Uint8Array(await cropBlob.arrayBuffer());
          cropsFolder.file(`${fileBase}.png`, cropBytes);
          console.log(`[CUTPATH-ELEMENT]   crop ok: ${cropWidth}x${cropHeight}px`);
        } catch (e: any) {
          errors.push(`crop: ${e.message}`);
          console.warn(`[CUTPATH-ELEMENT]   crop FAIL: ${e.message}`);
        }
      }

      // ─── 2. VECTOR pipeline (VTracer + svg-to-eps) ───
      let vectorOk = false;
      let vectorSvgPath = "";
      let vectorEpsPath = "";
      if (cropOk && cropBytes) {
        try {
          const { svg, width, height } = await bytesToSvg(cropBytes, {
            ...PRESET_LOGO,
            cornerThreshold: 60,
            filterSpeckle: 4,
            colorPrecision: 6,
          });
          // Regions mode already has crop dims; elements mode learns them here.
          if (!cropWidth) cropWidth = width;
          if (!cropHeight) cropHeight = height;

          const svgBytes = new TextEncoder().encode(svg);
          vectorSvgPath = `artboards/${packId}/elements/${fileBase}.svg`;
          await sb.storage.from(BUCKET).upload(vectorSvgPath, svgBytes, {
            contentType: "image/svg+xml",
            upsert: true,
          });
          vectorFolder.file(`${fileBase}.svg`, svgBytes);

          // EPS sized to the element in PostScript points (1px -> 1pt baseline).
          const epsBytes = svgToEps(svg, {
            widthPts: cropWidth || 1000,
            heightPts: cropHeight || 1000,
            dscHeaders: [
              `%%Creator: RestylePro CutPath Element Extract (VTracer)`,
              `%%Title: ${labelRaw}`,
              `%%ElementIndex: ${idx}`,
              `%%SourceJob: ${packId}`,
              `%%CreationDate: ${new Date().toISOString()}`,
            ],
            creator: "RestylePro CutPath Element Extract (VTracer)",
            title: labelRaw,
          });
          vectorEpsPath = `artboards/${packId}/elements/${fileBase}.eps`;
          await sb.storage.from(BUCKET).upload(vectorEpsPath, epsBytes, {
            contentType: "application/postscript",
            upsert: true,
          });
          vectorFolder.file(`${fileBase}.eps`, epsBytes);

          vectorOk = true;
          console.log(`[CUTPATH-ELEMENT]   vector ok: ${(svgBytes.byteLength / 1024).toFixed(0)} KB SVG, ${(epsBytes.byteLength / 1024).toFixed(0)} KB EPS`);
        } catch (e: any) {
          errors.push(`vector: ${e.message}`);
          console.warn(`[CUTPATH-ELEMENT]   vector FAIL: ${e.message}`);
        }
      }

      // ─── 3. RASTER pipeline ───
      let rasterOk = false;
      let rasterPngPath = "";
      if (cropOk) {
        if (elementsMode && cropBytes) {
          // The lifted transparent PNG IS the raster. No upscaler: Clarity (and
          // any diffusion upscaler) flattens alpha and paints a background
          // behind the cut, re-creating the ghosted rectangle we lift to avoid.
          try {
            rasterPngPath = `artboards/${packId}/elements/${fileBase}-raster.png`;
            await sb.storage.from(BUCKET).upload(rasterPngPath, cropBytes, {
              contentType: "image/png",
              upsert: true,
            });
            rasterFolder.file(`${fileBase}.png`, cropBytes);
            rasterOk = true;
            console.log(`[CUTPATH-ELEMENT]   raster ok: alpha-preserved original`);
          } catch (e: any) {
            errors.push(`raster: ${e.message}`);
            console.warn(`[CUTPATH-ELEMENT]   raster FAIL: ${e.message}`);
          }
        } else if (!elementsMode) {
          try {
            const { data: { publicUrl: cropPublicUrl } } = sb.storage
              .from(BUCKET)
              .getPublicUrl(cropPath);

            const upRes = await clarityUpscale(FAL_KEY!, cropPublicUrl, 4);
            if ("error" in upRes) throw new Error(upRes.error);

            const upResp = await fetch(upRes.url);
            if (!upResp.ok) throw new Error(`fetch upscaled: ${upResp.status}`);
            const upBytes = new Uint8Array(await upResp.arrayBuffer());

            rasterPngPath = `artboards/${packId}/elements/${fileBase}-upscaled.png`;
            await sb.storage.from(BUCKET).upload(rasterPngPath, upBytes, {
              contentType: "image/png",
              upsert: true,
            });
            rasterFolder.file(`${fileBase}.png`, upBytes);

            rasterOk = true;
            console.log(`[CUTPATH-ELEMENT]   raster ok: ${upRes.width}x${upRes.height}px (${(upBytes.byteLength / 1024).toFixed(0)} KB)`);
          } catch (e: any) {
            errors.push(`raster: ${e.message}`);
            console.warn(`[CUTPATH-ELEMENT]   raster FAIL: ${e.message}`);
          }
        }
      }

      const pub = (p: string) => (p ? sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl : "");
      results.push({
        index: idx,
        label: labelRaw,
        cropPath,
        vectorSvgPath,
        vectorEpsPath,
        rasterPngPath,
        vectorSvgUrl: pub(vectorSvgPath),
        vectorEpsUrl: pub(vectorEpsPath),
        rasterPngUrl: pub(rasterPngPath),
        vectorOk,
        rasterOk,
        errors,
        cropWidth,
        cropHeight,
      });
    }

    // ── Manifest ──
    const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
    const manifest = {
      version: "1.0",
      generator: "RestylePro CutPath Element Extract",
      generatedAt: new Date().toISOString(),
      job_id: packId,
      mode: elementsMode ? "elements" : "regions",
      vehicle: job ? [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") : "",
      regionCount: itemCount,
      vectorEngine: "VTracer WASM (visioncortex)",
      rasterEngine: elementsMode ? "original transparent PNG (alpha preserved)" : "Clarity 4x via Fal.ai",
      destructive: false,
      elements: results.map(r => ({
        index: r.index,
        label: r.label,
        cropDimensions: `${r.cropWidth}x${r.cropHeight}`,
        vector: r.vectorOk
          ? { svg: `vector/${String(r.index).padStart(2, "0")}_${safe(r.label)}.svg`, eps: `vector/${String(r.index).padStart(2, "0")}_${safe(r.label)}.eps` }
          : null,
        raster: r.rasterOk
          ? { png: `raster/${String(r.index).padStart(2, "0")}_${safe(r.label)}.png` }
          : null,
        errors: r.errors.length ? r.errors : undefined,
      })),
      vectorOkCount: results.filter(r => r.vectorOk).length,
      rasterOkCount: results.filter(r => r.rasterOk).length,
    };
    zip.file("extract-manifest.json", JSON.stringify(manifest, null, 2));

    const readme =
`CUTPATH ELEMENT EXTRACT
=======================
Pack: ${packId}
Mode: ${manifest.mode}
Vehicle: ${manifest.vehicle || "(unknown)"}
Generated: ${manifest.generatedAt}
Elements: ${itemCount}

CONTENTS
--------
  vector/   Standalone SVG + EPS for each element. Drop into the plotter
            (Onyx, Caldera, Flexi, Roland, Graphtec, Summa) to contour-cut
            it as a standalone vinyl piece. Best for logos, text, geometry.

  raster/   ${elementsMode
    ? "The lifted transparent PNG for each element (alpha preserved,\n            print at native size — the SVG is the infinite-scale master)."
    : "Clarity 4x upscaled PNG for each element. Use when the element\n            has gradients / photo content that shouldn't be vectorized."}

  crops/    Original 1x element, for reference.

  extract-manifest.json   Full machine-readable manifest of every file.

VECTOR vs RASTER
----------------
- Logo or text on a flat color  -> use vector/ (smaller file, infinite scale)
- Logo with photo or gradients  -> use raster/ (preserved fidelity)
- Plotter that requires raster   -> use raster/

This pack is non-destructive. The source artwork is unchanged.
`;
    zip.file("README.txt", readme);

    // ── Build + upload the ZIP ──
    const zipBytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const timestamp = Date.now();
    const zipPath = `cutpath-elements/${userId}/${packId}/element-pack-${timestamp}.zip`;
    await sb.storage.from(BUCKET).upload(zipPath, zipBytes, {
      contentType: "application/zip",
      upsert: true,
    });
    const { data: { publicUrl: zipUrl } } = sb.storage.from(BUCKET).getPublicUrl(zipPath);

    // ── Persist on the panelizer job so the QC UI download button lights up.
    //    Elements mode has no such job — the caller (Logo Pack UI) persists the
    //    returned zip_url onto its own color_visualizations row. ──
    if (job) {
      const cj = (job.concept_json as Record<string, unknown>) || {};
      await sb.from("panelizer_jobs").update({
        concept_json: {
          ...cj,
          cutpath_elements: {
            status: "complete",
            generated_at: new Date().toISOString(),
            region_count: itemCount,
            vector_ok: manifest.vectorOkCount,
            raster_ok: manifest.rasterOkCount,
            zip_path: zipPath,
            zip_url: zipUrl,
            manifest,
          },
        },
      }).eq("id", job_id);
    }

    const elapsed = Date.now() - startMs;
    console.log(`[CUTPATH-ELEMENT] DONE: ${manifest.vectorOkCount} vector + ${manifest.rasterOkCount} raster in ${elapsed}ms (${(zipBytes.byteLength / 1024).toFixed(0)} KB ZIP)`);

    return jsonResp({
      success: true,
      job_id: packId,
      mode: manifest.mode,
      region_count: itemCount,
      item_count: itemCount,
      vector_ok: manifest.vectorOkCount,
      raster_ok: manifest.rasterOkCount,
      zip_url: zipUrl,
      zip_path: zipPath,
      zip_size_kb: Math.round(zipBytes.byteLength / 1024),
      processing_time_ms: elapsed,
      items: results.map(r => ({
        index: r.index,
        label: r.label,
        vector_ok: r.vectorOk,
        raster_ok: r.rasterOk,
        svg_url: r.vectorSvgUrl,
        eps_url: r.vectorEpsUrl,
        raster_url: r.rasterPngUrl,
        errors: r.errors.length ? r.errors : undefined,
      })),
      manifest,
    });
  } catch (err: any) {
    console.error("[CUTPATH-ELEMENT] Error:", err);
    return jsonResp({ error: err?.message || "CutPath element extract failed" }, 500);
  }
});

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ success: !body.error, ...body }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function clarityUpscale(
  falKey: string,
  imageUrl: string,
  scale: number,
): Promise<{ url: string; width: number; height: number } | { error: string }> {
  try {
    const res = await fetch("https://fal.run/fal-ai/clarity-upscaler", {
      method: "POST",
      headers: { Authorization: `Key ${falKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        upscale_factor: Math.min(4, Math.max(2, Math.round(scale))),
        prompt: "high resolution logo, sharp edges, crisp text, preserve colors exactly",
        negative_prompt: "(worst quality, low quality, blurry, noise, artifacts:2)",
        creativity: 0.05,
        resemblance: 0.95,
        guidance_scale: 4,
        num_inference_steps: 20,
        enable_safety_checker: false,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) return { error: `Clarity ${res.status}` };
    const data = await res.json();
    const img = data.image as { url?: string; width?: number; height?: number } | undefined;
    if (img?.url) return { url: img.url, width: img.width || 0, height: img.height || 0 };
    return { error: "Clarity returned no image" };
  } catch (err: any) {
    return { error: err?.message || "unknown" };
  }
}
