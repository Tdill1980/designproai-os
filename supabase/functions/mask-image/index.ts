/**
 * mask-image — Fill rectangular regions with solid color on a stored PNG
 *
 * Uses Supabase Image Transform to resize large images before decoding,
 * avoiding WORKER_LIMIT crashes. Masking is done at reduced resolution
 * since Vectorizer.ai doesn't need full-res to know where photos are.
 *
 * Deploy: npx supabase functions deploy mask-image --no-verify-jwt --project-ref kfapjdyythzyvnpdeghu
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode as decodePng, encode as encodePng } from "https://deno.land/x/pngs@0.1.1/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "wrap-files";

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { storage_path, output_path, regions, fill_color } = await req.json();

    if (!storage_path || !output_path || !regions?.length) {
      return new Response(JSON.stringify({ error: "storage_path, output_path, and regions required" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hex = fill_color || "FF00FF";
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);

    // Download via Supabase Image Transform — resized to max 2048px wide
    // This avoids decoding a 50+ MB RGBA buffer from a 5+ MB PNG
    const MAX_W = 2048;
    const transformUrl = `${SUPABASE_URL}/storage/v1/render/image/public/${BUCKET}/${storage_path}?width=${MAX_W}&resize=contain&format=png`;

    console.log(`[MASK] Downloading resized (max ${MAX_W}px) from transform API`);
    const resp = await fetch(transformUrl);
    if (!resp.ok) {
      // Fallback: try direct download
      console.warn(`[MASK] Transform failed (${resp.status}), trying direct download`);
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
      const sb = createClient(SUPABASE_URL, SERVICE_KEY);
      const { data: blob } = await sb.storage.from(BUCKET).download(storage_path);
      if (!blob) throw new Error("Download failed");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      // If direct download works, try decoding
      const decoded = decodePng(bytes);
      return await processMask(decoded, regions, r, g, b, hex, output_path);
    }

    const imgBytes = new Uint8Array(await resp.arrayBuffer());
    console.log(`[MASK] Downloaded ${(imgBytes.byteLength / 1024).toFixed(0)} KB`);

    // Supabase transform may return JPEG even with format=png
    const ct = resp.headers.get("content-type") || "";
    let decoded: { image: Uint8Array; width: number; height: number };

    if (ct.includes("jpeg") || ct.includes("jpg")) {
      const { decode: decodeJpeg } = await import("https://deno.land/x/jpegts@1.1/mod.ts");
      const jpg = decodeJpeg(imgBytes);
      const rgba = new Uint8Array(jpg.width * jpg.height * 4);
      for (let i = 0; i < jpg.width * jpg.height; i++) {
        rgba[i * 4] = jpg.data[i * 3];
        rgba[i * 4 + 1] = jpg.data[i * 3 + 1];
        rgba[i * 4 + 2] = jpg.data[i * 3 + 2];
        rgba[i * 4 + 3] = 255;
      }
      decoded = { image: rgba, width: jpg.width, height: jpg.height };
    } else {
      decoded = decodePng(imgBytes);
    }

    return await processMask(decoded, regions, r, g, b, hex, output_path);
  } catch (err: any) {
    console.error("[MASK] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Mask failed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function processMask(
  decoded: { image: Uint8Array; width: number; height: number },
  regions: any[],
  r: number, g: number, b: number, hex: string,
  output_path: string,
) {
  const imgW = decoded.width;
  const imgH = decoded.height;
  const pixels = decoded.image;
  console.log(`[MASK] Decoded: ${imgW}x${imgH}px (${(pixels.byteLength / 1024 / 1024).toFixed(1)} MB)`);

  for (let i = 0; i < regions.length; i++) {
    const reg = regions[i];
    const rx = Math.max(0, Math.round((reg.x_percent / 100) * imgW));
    const ry = Math.max(0, Math.round((reg.y_percent / 100) * imgH));
    const rw = Math.min(Math.round((reg.width_percent / 100) * imgW), imgW - rx);
    const rh = Math.min(Math.round((reg.height_percent / 100) * imgH), imgH - ry);
    console.log(`[MASK] Region ${i + 1}: (${rx},${ry}) ${rw}x${rh}px → #${hex}`);

    for (let py = ry; py < ry + rh && py < imgH; py++) {
      const rowOffset = (py * imgW + rx) * 4;
      for (let px = 0; px < rw && rx + px < imgW; px++) {
        const idx = rowOffset + px * 4;
        pixels[idx] = r;
        pixels[idx + 1] = g;
        pixels[idx + 2] = b;
        pixels[idx + 3] = 255;
      }
    }
  }

  const masked = encodePng(pixels, imgW, imgH);
  console.log(`[MASK] Encoded: ${(masked.byteLength / 1024).toFixed(0)} KB`);

  const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { error } = await sb.storage.from(BUCKET).upload(output_path, masked, {
    contentType: "image/png", upsert: true,
  });
  if (error) throw new Error(`Upload failed: ${error.message}`);

  return new Response(JSON.stringify({
    success: true, path: output_path, width: imgW, height: imgH, regions_masked: regions.length,
  }), {
    status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
