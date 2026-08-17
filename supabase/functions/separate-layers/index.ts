/**
 * separate-layers — PNG layer separation tool (no vectorizer)
 *
 * Input:  { job_id, regions: [{ x_percent, y_percent, width_percent,
 *                               height_percent, label? }, ...] }
 *
 * For each marked region, extracts TWO foreground variants:
 *   (1) rectangular crop at full resolution
 *   (2) Gemini cutout with transparent background (alpha around the logo/photo)
 *
 * And produces TWO background variants:
 *   (1) holes-only — original artboard with transparent rectangles
 *       where each foreground region was cut out
 *   (2) inpainted — same holes filled by Gemini with the surrounding
 *       pattern/color so the background stands alone as a complete wrap
 *
 * Packaged into a single ZIP:
 *   layer-pack-<jobId>-<timestamp>.zip
 *     background/
 *       00_background-holes.png         (alpha rectangles)
 *       00_background-inpainted.png     (holes filled by Gemini)
 *     foreground/
 *       01_<label>-rect.png              (simple rectangular crop)
 *       01_<label>-cutout.png            (Gemini transparent cutout)
 *       02_<label>-rect.png
 *       02_<label>-cutout.png
 *     preview.png                        (composite showing all layers stacked)
 *     layer-manifest.json
 *     README.txt
 *
 * Non-destructive — never modifies the source artboard. Zero VTracer.
 * Self-contained (no _shared imports) so MCP deploy ships in one call.
 *
 * Deploy: via MCP deploy_edge_function
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import JSZip from "https://esm.sh/jszip@3.10.1";

// ─────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BUCKET = "wrap-files";
const GEMINI_MODEL = "gemini-3-pro-image-preview";

// ─────────────────────────────────────────────────────────────
// Gemini key pool (round-robin)
// ─────────────────────────────────────────────────────────────

const _gpool: string[] = [];
let _gloaded = false;
let _gidx = 0;
function _loadGemini(): void {
  if (_gloaded) return;
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) _gpool.push(primary);
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) _gpool.push(k);
  }
  _gloaded = true;
}
function getGeminiKey(): string {
  _loadGemini();
  if (_gpool.length === 0) throw new Error("No GOOGLE_AI_API_KEY configured");
  const k = _gpool[_gidx % _gpool.length];
  _gidx++;
  return k;
}

// ─────────────────────────────────────────────────────────────
// Base64 helpers (chunk-safe)
// ─────────────────────────────────────────────────────────────

function bytesToB64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let bin = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    bin += String.fromCharCode(...slice);
  }
  return btoa(bin);
}
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

interface Region {
  x_percent: number;
  y_percent: number;
  width_percent: number;
  height_percent: number;
  label?: string;
}

interface ForegroundResult {
  index: number;
  label: string;
  rectPath: string;    // rectangular crop in storage
  cutoutPath: string;  // Gemini transparent cutout in storage
  rectOk: boolean;
  cutoutOk: boolean;
  width: number;       // crop dimensions
  height: number;
  placement: { x_pct: number; y_pct: number; w_pct: number; h_pct: number };
  errors: string[];
}

// ─────────────────────────────────────────────────────────────
// Main handler
// ─────────────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const body = await req.json();
    const { job_id, regions } = body as { job_id: string; regions: Region[] };

    if (!job_id) return jsonResp({ error: "job_id is required" }, 400);
    if (!Array.isArray(regions) || regions.length === 0) {
      return jsonResp({ error: "regions array required (at least one region)" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data: job, error: jobErr } = await sb
      .from("panelizer_jobs")
      .select("*")
      .eq("id", job_id)
      .single();
    if (jobErr || !job) return jsonResp({ error: "Job not found" }, 404);

    const userId = job.user_id || "anonymous";
    const startMs = Date.now();
    const artboardPath = `artboards/${job_id}/artboard.png`;

    console.log(`[SEPARATE-LAYERS] Job ${job_id} | ${regions.length} region(s)`);

    // ─── Download the source artboard ───
    const { data: artboardBlob, error: dlErr } = await sb.storage
      .from(BUCKET)
      .download(artboardPath);
    if (dlErr || !artboardBlob) {
      return jsonResp({ error: `Artboard not found at ${artboardPath}` }, 404);
    }
    const artboardBytes = new Uint8Array(await artboardBlob.arrayBuffer());
    console.log(`[SEPARATE-LAYERS] Artboard: ${(artboardBytes.byteLength / 1024).toFixed(0)} KB`);

    // ─── Decode once to get dimensions ───
    const artImg = await Image.decode(artboardBytes);
    const imgW = artImg.width;
    const imgH = artImg.height;
    console.log(`[SEPARATE-LAYERS] Artboard dimensions: ${imgW}x${imgH}`);

    const zip = new JSZip();
    const bgFolder = zip.folder("background")!;
    const fgFolder = zip.folder("foreground")!;

    // ══════════════════════════════════════════════════════════
    // BACKGROUND VARIANT 1: holes-only
    // Copy the artboard, set alpha=0 for each marked rectangle.
    // ══════════════════════════════════════════════════════════
    console.log(`[SEPARATE-LAYERS] Building holes-only background...`);
    const holesBg = artImg.clone();
    for (const r of regions) {
      const rx = Math.max(0, Math.round((r.x_percent / 100) * imgW));
      const ry = Math.max(0, Math.round((r.y_percent / 100) * imgH));
      const rw = Math.min(Math.round((r.width_percent / 100) * imgW), imgW - rx);
      const rh = Math.min(Math.round((r.height_percent / 100) * imgH), imgH - ry);

      // Set alpha=0 on every pixel inside the rectangle
      for (let py = ry; py < ry + rh; py++) {
        for (let px = rx; px < rx + rw; px++) {
          holesBg.setPixelAt(px + 1, py + 1, 0x00000000); // fully transparent black
        }
      }
    }
    const holesBgBytes = new Uint8Array(await holesBg.encode());
    bgFolder.file("00_background-holes.png", holesBgBytes);
    const holesBgPath = `layer-packs/${userId}/${job_id}/background-holes.png`;
    await sb.storage.from(BUCKET).upload(holesBgPath, holesBgBytes, {
      contentType: "image/png",
      upsert: true,
    });
    console.log(`[SEPARATE-LAYERS]   holes-bg ok: ${(holesBgBytes.byteLength / 1024).toFixed(0)} KB`);

    // ══════════════════════════════════════════════════════════
    // BACKGROUND VARIANT 2: inpainted via Gemini
    // Mask each region with magenta, then ask Gemini to fill the
    // magenta areas with the surrounding pattern/color so the
    // background looks like a complete standalone wrap.
    // ══════════════════════════════════════════════════════════
    console.log(`[SEPARATE-LAYERS] Building inpainted background via Gemini...`);
    const magentaBg = artImg.clone();
    const MAGENTA = 0xFF00FFFF; // full-alpha hot magenta
    for (const r of regions) {
      const rx = Math.max(0, Math.round((r.x_percent / 100) * imgW));
      const ry = Math.max(0, Math.round((r.y_percent / 100) * imgH));
      const rw = Math.min(Math.round((r.width_percent / 100) * imgW), imgW - rx);
      const rh = Math.min(Math.round((r.height_percent / 100) * imgH), imgH - ry);
      for (let py = ry; py < ry + rh; py++) {
        for (let px = rx; px < rx + rw; px++) {
          magentaBg.setPixelAt(px + 1, py + 1, MAGENTA);
        }
      }
    }
    const magentaBgBytes = new Uint8Array(await magentaBg.encode());

    let inpaintedBgBytes: Uint8Array | null = null;
    try {
      const inpainted = await geminiInpaintMagenta(magentaBgBytes);
      if (inpainted) {
        // Blend-back: Gemini regenerates the entire frame, so its output can't
        // be trusted to preserve the surrounding wrap design — a full
        // regeneration reconstructs the whole scene and routinely wipes/alters
        // everything outside the marked holes. Keep ONLY the marked regions
        // from Gemini's fill and composite them onto the pristine original, so
        // the rest of the artboard stays pixel-identical.
        let bgForUpload = inpainted;
        try {
          let genImg = await Image.decode(inpainted);
          if (genImg.width !== imgW || genImg.height !== imgH) {
            genImg = genImg.resize(imgW, imgH);
          }
          const blended = artImg.clone();
          for (const r of regions) {
            const rx = Math.max(0, Math.round((r.x_percent / 100) * imgW));
            const ry = Math.max(0, Math.round((r.y_percent / 100) * imgH));
            const rw = Math.min(Math.round((r.width_percent / 100) * imgW), imgW - rx);
            const rh = Math.min(Math.round((r.height_percent / 100) * imgH), imgH - ry);
            if (rw <= 0 || rh <= 0) continue;
            const patch = genImg.clone().crop(rx, ry, rw, rh);
            blended.composite(patch, rx, ry);
          }
          bgForUpload = new Uint8Array(await blended.encode());
          (genImg as any).bitmap = null;
          (blended as any).bitmap = null;
        } catch (e: any) {
          console.warn(`[SEPARATE-LAYERS]   region blend-back failed, using raw Gemini bg: ${e.message}`);
        }

        inpaintedBgBytes = bgForUpload;
        bgFolder.file("00_background-inpainted.png", inpaintedBgBytes);
        const inpaintedPath = `layer-packs/${userId}/${job_id}/background-inpainted.png`;
        await sb.storage.from(BUCKET).upload(inpaintedPath, inpaintedBgBytes, {
          contentType: "image/png",
          upsert: true,
        });
        console.log(`[SEPARATE-LAYERS]   inpainted-bg ok: ${(inpaintedBgBytes.byteLength / 1024).toFixed(0)} KB`);
      } else {
        console.warn(`[SEPARATE-LAYERS]   inpainted-bg FAIL: Gemini returned no image`);
      }
    } catch (e: any) {
      console.warn(`[SEPARATE-LAYERS]   inpainted-bg FAIL: ${e.message}`);
    }

    // Free the big intermediate buffers early
    (magentaBg as any).bitmap = null;
    (holesBg as any).bitmap = null;

    // ══════════════════════════════════════════════════════════
    // FOREGROUND: for each region, produce (a) rectangular crop
    // and (b) Gemini transparent cutout.
    // ══════════════════════════════════════════════════════════
    const results: ForegroundResult[] = [];

    for (let i = 0; i < regions.length; i++) {
      const r = regions[i];
      const idx = i + 1;
      const labelRaw = (r.label || `element-${idx}`).trim();
      const safeLabel = labelRaw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      const fileBase = `${String(idx).padStart(2, "0")}_${safeLabel}`;
      const errors: string[] = [];

      console.log(`[SEPARATE-LAYERS] → ${fileBase}: (${r.x_percent.toFixed(1)}%,${r.y_percent.toFixed(1)}%) ${r.width_percent.toFixed(1)}x${r.height_percent.toFixed(1)}%`);

      // ─── Rectangular crop ───
      const rx = Math.max(0, Math.round((r.x_percent / 100) * imgW));
      const ry = Math.max(0, Math.round((r.y_percent / 100) * imgH));
      const rw = Math.min(Math.round((r.width_percent / 100) * imgW), imgW - rx);
      const rh = Math.min(Math.round((r.height_percent / 100) * imgH), imgH - ry);

      let rectOk = false;
      let rectBytes: Uint8Array | null = null;
      let rectPath = "";
      try {
        const cropImg = artImg.clone().crop(rx, ry, rw, rh);
        rectBytes = new Uint8Array(await cropImg.encode());
        rectPath = `layer-packs/${userId}/${job_id}/${fileBase}-rect.png`;
        await sb.storage.from(BUCKET).upload(rectPath, rectBytes, {
          contentType: "image/png",
          upsert: true,
        });
        fgFolder.file(`${fileBase}-rect.png`, rectBytes);
        rectOk = true;
        console.log(`[SEPARATE-LAYERS]   rect ok: ${rw}x${rh}px (${(rectBytes.byteLength / 1024).toFixed(0)} KB)`);
      } catch (e: any) {
        errors.push(`rect: ${e.message}`);
        console.warn(`[SEPARATE-LAYERS]   rect FAIL: ${e.message}`);
      }

      // ─── Gemini transparent cutout ───
      let cutoutOk = false;
      let cutoutPath = "";
      if (rectOk && rectBytes) {
        try {
          const cutoutBytes = await geminiCutoutTransparent(rectBytes, labelRaw);
          if (cutoutBytes) {
            cutoutPath = `layer-packs/${userId}/${job_id}/${fileBase}-cutout.png`;
            await sb.storage.from(BUCKET).upload(cutoutPath, cutoutBytes, {
              contentType: "image/png",
              upsert: true,
            });
            fgFolder.file(`${fileBase}-cutout.png`, cutoutBytes);
            cutoutOk = true;
            console.log(`[SEPARATE-LAYERS]   cutout ok: ${(cutoutBytes.byteLength / 1024).toFixed(0)} KB`);
          } else {
            errors.push("cutout: Gemini returned no image");
            console.warn(`[SEPARATE-LAYERS]   cutout FAIL: no image`);
          }
        } catch (e: any) {
          errors.push(`cutout: ${e.message}`);
          console.warn(`[SEPARATE-LAYERS]   cutout FAIL: ${e.message}`);
        }
      }

      results.push({
        index: idx,
        label: labelRaw,
        rectPath,
        cutoutPath,
        rectOk,
        cutoutOk,
        width: rw,
        height: rh,
        placement: { x_pct: r.x_percent, y_pct: r.y_percent, w_pct: r.width_percent, h_pct: r.height_percent },
        errors,
      });
    }

    // ══════════════════════════════════════════════════════════
    // Manifest + README
    // ══════════════════════════════════════════════════════════
    const manifest = {
      version: "1.0",
      generator: "RestylePro Separate Layers",
      generated_at: new Date().toISOString(),
      job_id,
      vehicle: [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" "),
      artboard_dimensions: { width: imgW, height: imgH },
      region_count: regions.length,
      backgrounds: {
        holes: "background/00_background-holes.png",
        inpainted: inpaintedBgBytes ? "background/00_background-inpainted.png" : null,
      },
      foregrounds: results.map(r => ({
        index: r.index,
        label: r.label,
        width: r.width,
        height: r.height,
        placement_percent: r.placement,
        rect: r.rectOk ? `foreground/${String(r.index).padStart(2, "0")}_${r.label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}-rect.png` : null,
        cutout: r.cutoutOk ? `foreground/${String(r.index).padStart(2, "0")}_${r.label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}-cutout.png` : null,
        errors: r.errors.length ? r.errors : undefined,
      })),
      destructive: false,
    };
    zip.file("layer-manifest.json", JSON.stringify(manifest, null, 2));

    const readme =
`SEPARATE LAYERS
===============
Job:      ${job_id}
Vehicle:  ${manifest.vehicle || "(unknown)"}
Artboard: ${imgW}x${imgH}px
Regions:  ${regions.length}
Built:    ${manifest.generated_at}

CONTENTS
--------
background/
  00_background-holes.png         Original artboard with TRANSPARENT RECTANGLES where each
                                  marked region was cut out. Use this when you plan to print
                                  the background + each logo as separate vinyl pieces and
                                  stack them at install time.

  00_background-inpainted.png     Same artboard, but Gemini filled the holes with the
                                  surrounding pattern/color so the background stands alone
                                  as a complete wrap. Use this when you want the background
                                  to print as a finished wrap (logos become optional overlays).

foreground/
  NN_<label>-rect.png             Simple rectangular crop at full resolution (fastest,
                                  includes everything inside the box you drew).

  NN_<label>-cutout.png           Gemini-isolated PNG with a TRANSPARENT background
                                  around the logo/photo (removes everything that wasn't
                                  the subject). Best for logos on flat colors.

layer-manifest.json               Machine-readable manifest of every file, dimensions,
                                  and placement percentages.

WORKFLOW OPTIONS
----------------
A) Fully layered print-then-apply:
   1. Print background-holes.png on vinyl.
   2. Print each foreground/<label>-cutout.png on its own vinyl piece.
   3. Cut, weed, and apply the foregrounds on top of the background holes at install.

B) Inpainted background + optional overlays:
   1. Print background-inpainted.png as a complete standalone wrap.
   2. Optionally print individual foregrounds for high-impact decal accents.

C) Layered in Illustrator:
   1. Open background-holes.png as the base layer.
   2. Place each foreground/<label>-cutout.png above it using the placement
      percentages from layer-manifest.json.
   3. Export as a single flattened file for the printer.

This pack is NON-DESTRUCTIVE — the original artboard is unchanged.
`;
    zip.file("README.txt", readme);

    // ══════════════════════════════════════════════════════════
    // Build + upload ZIP
    // ══════════════════════════════════════════════════════════
    const zipBytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    const timestamp = Date.now();
    const zipPath = `layer-packs/${userId}/${job_id}/layer-pack-${timestamp}.zip`;
    await sb.storage.from(BUCKET).upload(zipPath, zipBytes, {
      contentType: "application/zip",
      upsert: true,
    });
    const { data: { publicUrl: zipUrl } } = sb.storage.from(BUCKET).getPublicUrl(zipPath);

    // ══════════════════════════════════════════════════════════
    // Build public URLs for every individual artifact so the QC
    // Artboard frontend can drop each cutout onto the canvas as a
    // draggable layer (and swap the inpainted background underneath)
    // — not just hand the user a ZIP. The files are already uploaded
    // above; this just exposes their public URLs.
    // ══════════════════════════════════════════════════════════
    const { data: { publicUrl: holesUrl } } = sb.storage.from(BUCKET).getPublicUrl(holesBgPath);
    let inpaintedUrl: string | null = null;
    if (inpaintedBgBytes) {
      const inpaintedPath = `layer-packs/${userId}/${job_id}/background-inpainted.png`;
      const { data: { publicUrl } } = sb.storage.from(BUCKET).getPublicUrl(inpaintedPath);
      inpaintedUrl = publicUrl;
    }
    const foregrounds = results.map(r => {
      const rectPublicUrl = r.rectOk
        ? sb.storage.from(BUCKET).getPublicUrl(r.rectPath).data.publicUrl
        : null;
      const cutoutPublicUrl = r.cutoutOk
        ? sb.storage.from(BUCKET).getPublicUrl(r.cutoutPath).data.publicUrl
        : null;
      return {
        index: r.index,
        label: r.label,
        width: r.width,
        height: r.height,
        placement: r.placement,
        rectUrl: rectPublicUrl,
        cutoutUrl: cutoutPublicUrl,
      };
    });

    // ══════════════════════════════════════════════════════════
    // Persist on job row so QC UI download panel can surface it
    // ══════════════════════════════════════════════════════════
    const cj = (job.concept_json as Record<string, unknown>) || {};
    const rectOkCount = results.filter(r => r.rectOk).length;
    const cutoutOkCount = results.filter(r => r.cutoutOk).length;

    await sb.from("panelizer_jobs").update({
      concept_json: {
        ...cj,
        separate_layers: {
          status: "complete",
          generated_at: new Date().toISOString(),
          region_count: regions.length,
          rect_ok: rectOkCount,
          cutout_ok: cutoutOkCount,
          has_inpainted_bg: !!inpaintedBgBytes,
          zip_path: zipPath,
          zip_url: zipUrl,
          holes_url: holesUrl,
          inpainted_url: inpaintedUrl,
          foregrounds,
          manifest,
        },
      },
    }).eq("id", job_id);

    const elapsed = Date.now() - startMs;
    console.log(`[SEPARATE-LAYERS] DONE: ${rectOkCount} rect + ${cutoutOkCount} cutout + 1 holes-bg + ${inpaintedBgBytes ? 1 : 0} inpainted-bg in ${elapsed}ms (${(zipBytes.byteLength / 1024).toFixed(0)} KB ZIP)`);

    return jsonResp({
      success: true,
      job_id,
      region_count: regions.length,
      rect_ok: rectOkCount,
      cutout_ok: cutoutOkCount,
      has_inpainted_bg: !!inpaintedBgBytes,
      zip_url: zipUrl,
      zip_path: zipPath,
      zip_size_kb: Math.round(zipBytes.byteLength / 1024),
      // Per-artifact public URLs so QC Artboard can hydrate elementLayers
      // for on-canvas reposition without unzipping client-side.
      holes_url: holesUrl,
      inpainted_url: inpaintedUrl,
      foregrounds,
      processing_time_ms: elapsed,
      manifest,
    });
  } catch (err: any) {
    console.error("[SEPARATE-LAYERS] Error:", err);
    return jsonResp({ error: err?.message || "Separate Layers failed" }, 500);
  }
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function jsonResp(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify({ success: !body.error, ...body }), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/**
 * Ask Gemini to inpaint the magenta-masked regions of an image with
 * the surrounding pattern/color so the background looks like a complete
 * standalone wrap.
 */
async function geminiInpaintMagenta(pngBytes: Uint8Array): Promise<Uint8Array | null> {
  const b64 = bytesToB64(pngBytes);
  const prompt = `You are an image inpainting specialist. The attached image has hot magenta (#FF00FF) rectangles masking areas that need to be filled in.

Your task: fill EVERY magenta rectangle with a seamless extension of the surrounding artwork (colors, patterns, gradients, shapes). The final image should look like the magenta areas were never there — as if the background were a complete standalone wrap design.

Rules:
- Output the ENTIRE image at the same dimensions as the input.
- Preserve every pixel OUTSIDE the magenta rectangles exactly as it is — do not touch non-magenta pixels.
- Inside the magenta rectangles, synthesize content that matches the surrounding pattern, color, gradient, or texture.
- Do NOT add new logos, text, photos, or design elements. Only extend the existing background.
- Do NOT leave ANY magenta pixels in the output.
- Keep the output edge-to-edge, flat 2D panel style, no 3D, no vehicle curves.`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const key = getGeminiKey();
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: "You inpaint masked areas of flat vehicle wrap artwork. You never introduce new elements; you only extend existing patterns." }] },
            contents: [{
              role: "user",
              parts: [
                { inlineData: { mimeType: "image/png", data: b64 } },
                { text: prompt },
              ],
            }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { aspectRatio: "16:9", imageSize: "4K" },
              temperature: 0.0,
              topP: 0.1,
            },
          }),
          signal: AbortSignal.timeout(90_000),
        },
      );
      if (!resp.ok) {
        console.warn(`[INPAINT] Gemini ${resp.status} on attempt ${attempt}`);
        continue;
      }
      const data = await resp.json();
      for (const candidate of data.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if (part.inlineData?.data) {
            return b64ToBytes(part.inlineData.data);
          }
        }
      }
    } catch (e: any) {
      console.warn(`[INPAINT] error on attempt ${attempt}: ${e.message}`);
    }
  }
  return null;
}

/**
 * Ask Gemini to remove the background from a cropped logo/photo and
 * return a transparent PNG with only the subject preserved.
 */
async function geminiCutoutTransparent(
  pngBytes: Uint8Array,
  label: string,
): Promise<Uint8Array | null> {
  const b64 = bytesToB64(pngBytes);
  const prompt = `Isolate the subject ("${label}") in this image. Remove everything around the subject and make that area fully transparent (alpha = 0).

Rules:
- Output a PNG with a TRANSPARENT background.
- Keep the subject (logo/photo/text/graphic) pixel-perfect — preserve its colors, edges, and shapes exactly.
- Do NOT redraw, stylize, reinterpret, or recolor the subject.
- Crop the output tightly to the subject's bounding box with a 4px transparent margin.
- If multiple candidate subjects are present, pick the most prominent/centered one.
- Output dimensions should match the subject's actual size, not the original crop.`;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const key = getGeminiKey();
    try {
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: "You isolate subjects from images and return transparent PNGs. You preserve the subject exactly and make all non-subject pixels transparent." }] },
            contents: [{
              role: "user",
              parts: [
                { inlineData: { mimeType: "image/png", data: b64 } },
                { text: prompt },
              ],
            }],
            generationConfig: {
              responseModalities: ["TEXT", "IMAGE"],
              imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
              temperature: 0.0,
              topP: 0.1,
            },
          }),
          signal: AbortSignal.timeout(60_000),
        },
      );
      if (!resp.ok) {
        console.warn(`[CUTOUT] Gemini ${resp.status} on attempt ${attempt}`);
        continue;
      }
      const data = await resp.json();
      for (const candidate of data.candidates || []) {
        for (const part of candidate.content?.parts || []) {
          if (part.inlineData?.data) {
            return b64ToBytes(part.inlineData.data);
          }
        }
      }
    } catch (e: any) {
      console.warn(`[CUTOUT] error on attempt ${attempt}: ${e.message}`);
    }
  }
  return null;
}
