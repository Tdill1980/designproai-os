/**
 * ─────────────────────────────────────────────────────────────
 *  restyle-pro-asset-harvester — STEP 2 of the Prompt-to-Production™
 *  prepress trio. ASSET ISOLATION ("lift-the-baked-logo").
 *
 *  © 2026 RestylePro / LoopMighty Software Development LLC.
 *
 *  Takes the source proof + the orchestrator's spatial JSON and produces
 *  CLEAN, math-based vector assets:
 *    1. Crop the logo bounding box from the high-res source (ImageScript).
 *    2. Background removal (ClipDrop when configured; otherwise the raw crop —
 *       a provided clean logoUrl is preferred and skips removal).
 *    3. Vectorize the clean raster (VTracer WASM → SVG).
 *    4. Upload PNG + SVG back to storage and return signed URLs.
 *
 *  Text is NOT vectorized from blurry proof crops — it is carried forward as
 *  live data (string + HEX) so the assembler can re-typeset it crisply. The
 *  harvester's job is the native-vector LOGO.
 * ─────────────────────────────────────────────────────────────
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  uploadToStorage,
  getSignedUrl,
  fetchImageBytes,
} from "../_shared/restyle-pro/storage.ts";
import { bytesToSvg, PRESET_LOGO } from "../_shared/vtracer/engine.ts";
import {
  jobPrefix,
  type SpatialMap,
  type HarvestedAsset,
  type RelBBox,
} from "../_shared/restyle-pro/lib.ts";

/** Crop a relative bbox out of a decoded image, with a small padding margin. */
function cropRel(img: Image, box: RelBBox, pad = 0.02): Image {
  const x = Math.max(0, Math.floor((box.x - pad) * img.width));
  const y = Math.max(0, Math.floor((box.y - pad) * img.height));
  const w = Math.min(img.width - x, Math.ceil((box.w + pad * 2) * img.width));
  const h = Math.min(img.height - y, Math.ceil((box.h + pad * 2) * img.height));
  return img.clone().crop(x, y, Math.max(1, w), Math.max(1, h));
}

/** ClipDrop background removal — returns alpha PNG bytes, or null if unavailable. */
async function removeBackground(pngBytes: Uint8Array): Promise<Uint8Array | null> {
  const key = Deno.env.get("CLIPDROP_API_KEY");
  if (!key) return null;
  try {
    const form = new FormData();
    form.append("image_file", new Blob([pngBytes], { type: "image/png" }), "asset.png");
    const resp = await fetch("https://clipdrop-api.co/remove-background/v1", {
      method: "POST",
      headers: { "x-api-key": key },
      body: form,
    });
    if (!resp.ok) {
      console.warn(`[RP-HARVEST] ClipDrop ${resp.status} — using raw crop`);
      return null;
    }
    return new Uint8Array(await resp.arrayBuffer());
  } catch (e: any) {
    console.warn(`[RP-HARVEST] ClipDrop error: ${e.message} — using raw crop`);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startMs = Date.now();

  try {
    const { jobId, proofUrl, logoUrl = null, spatialMap } = await req.json() as {
      jobId: string; proofUrl: string; logoUrl: string | null; spatialMap: SpatialMap;
    };
    if (!jobId || !proofUrl) return json({ error: "jobId and proofUrl are required" }, 400);

    const prefix = `${jobPrefix(jobId)}/assets`;
    const assets: HarvestedAsset[] = [];

    // ── Resolve the logo raster ──────────────────────────────────────
    // Preferred: a clean uploaded logoUrl (already alpha). Fallback: crop the
    // logo bbox out of the proof and run background removal.
    let logoPng: Uint8Array | null = null;
    let logoBox: RelBBox = spatialMap?.logo?.relBBox || { x: 0.05, y: 0.1, w: 0.4, h: 0.3 };

    if (logoUrl) {
      logoPng = await fetchImageBytes(logoUrl);
      const decoded = await Image.decode(logoPng);
      logoPng = await decoded.encode(); // normalise to PNG
      console.log(`[RP-HARVEST] using provided logoUrl (${decoded.width}×${decoded.height})`);
    } else if (spatialMap?.logo?.relBBox) {
      const proof = await Image.decode(await fetchImageBytes(proofUrl));
      const crop = cropRel(proof, logoBox);
      const cropPng = await crop.encode();
      const cleaned = await removeBackground(cropPng);
      logoPng = cleaned || cropPng;
      console.log(`[RP-HARVEST] cropped logo from proof (${crop.width}×${crop.height}), bg-removed=${!!cleaned}`);
    }

    if (logoPng) {
      const decoded = await Image.decode(logoPng);
      let svg = "";
      try {
        const v = await bytesToSvg(logoPng, PRESET_LOGO);
        svg = v.svg;
      } catch (e: any) {
        console.warn(`[RP-HARVEST] vectorize failed: ${e.message}`);
      }
      const pngPath = `${prefix}/logo.png`;
      const svgPath = `${prefix}/logo.svg`;
      await uploadToStorage(pngPath, logoPng, "image/png");
      if (svg) await uploadToStorage(svgPath, new TextEncoder().encode(svg), "image/svg+xml");
      assets.push({
        id: "logo",
        role: "logo",
        relBBox: logoBox,
        pngPath,
        pngUrl: await getSignedUrl(pngPath),
        svgPath: svg ? svgPath : "",
        svgUrl: svg ? await getSignedUrl(svgPath) : "",
        width: decoded.width,
        height: decoded.height,
      });
    }

    // ── Carry text layers forward as live data (re-typeset downstream) ──
    const textData = (spatialMap?.textLayers || []).map((t, i) => ({
      id: `text-${i}`,
      role: "text" as const,
      text: t.text,
      hexColor: t.hexColor,
      fontWeight: t.fontWeight,
      fontStyle: t.fontStyle,
      relBBox: t.relBBox,
    }));

    const totalMs = Date.now() - startMs;
    console.log(`[RP-HARVEST] job ${jobId} — ${assets.length} vector asset(s), ${textData.length} text layer(s) in ${totalMs}ms`);

    return json({ success: true, jobId, assets, textLayers: textData, timing: { totalMs } }, 200);
  } catch (err: any) {
    console.error(`[RP-HARVEST] ERROR:`, err);
    return json({ error: `restyle-pro-asset-harvester failed: ${err.message}` }, 500);
  }
});

function json(obj: unknown, status: number) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
