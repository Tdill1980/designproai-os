/**
 * crop-region — Deterministic image crop using Supabase Image Transforms
 *
 * Instead of decoding the full PNG in-memory (crashes on large artboards),
 * uses Supabase's server-side image transform to resize, then crops from
 * the resized version. No image decoding in the edge function at all.
 *
 * Input:  { storage_path, x_percent, y_percent, width_percent, height_percent, output_path }
 * Output: { success, path, width, height }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BUCKET = "wrap-files";

/** Read image dimensions from PNG or JPEG header bytes */
function imageDims(buf: Uint8Array): { w: number; h: number } {
  // PNG
  if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return {
      w: (buf[16] << 24) | (buf[17] << 16) | (buf[18] << 8) | buf[19],
      h: (buf[20] << 24) | (buf[21] << 16) | (buf[22] << 8) | buf[23],
    };
  }
  // JPEG — need more bytes, scan for SOF0/SOF2
  if (buf.length >= 10 && buf[0] === 0xFF && buf[1] === 0xD8) {
    for (let i = 2; i < buf.length - 10; i++) {
      if (buf[i] === 0xFF && (buf[i + 1] === 0xC0 || buf[i + 1] === 0xC2)) {
        return {
          w: (buf[i + 7] << 8) | buf[i + 8],
          h: (buf[i + 5] << 8) | buf[i + 6],
        };
      }
    }
  }
  return { w: 0, h: 0 };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { storage_path, x_percent, y_percent, width_percent, height_percent, output_path } = await req.json();

    if (!storage_path || !output_path) {
      return new Response(JSON.stringify({ error: "storage_path and output_path required" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get original image dimensions from the first 24 bytes (PNG header)
    // JPEG SOF marker can be 100KB+ deep (after EXIF/JFIF metadata)
    const pubUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storage_path}`;
    const headResp = await fetch(pubUrl, {
      headers: { Range: "bytes=0-131071" },
    });
    if (!headResp.ok) {
      return new Response(JSON.stringify({ error: `Cannot read ${storage_path}: ${headResp.status}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const headerBytes = new Uint8Array(await headResp.arrayBuffer());
    const { w: imgW, h: imgH } = imageDims(headerBytes);
    if (!imgW || !imgH) {
      return new Response(JSON.stringify({ error: "Cannot read PNG dimensions" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate crop region in pixels
    const x = Math.max(0, Math.round((x_percent / 100) * imgW));
    const y = Math.max(0, Math.round((y_percent / 100) * imgH));
    const w = Math.min(Math.round((width_percent / 100) * imgW), imgW - x);
    const h = Math.min(Math.round((height_percent / 100) * imgH), imgH - y);

    console.log(`[CROP] Image ${imgW}x${imgH} → crop (${x},${y}) ${w}x${h}`);

    if (w < 5 || h < 5) {
      return new Response(JSON.stringify({ error: `Crop region too small: ${w}x${h}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Download the full image (we need it for pixel-level crop)
    // But resize it down first if it's huge — use Supabase transform
    const MAX_DIM = 2048;
    let downloadUrl: string;
    let scale = 1;

    if (imgW > MAX_DIM || imgH > MAX_DIM) {
      // Use Supabase Image Transform to get a smaller version
      scale = Math.min(MAX_DIM / imgW, MAX_DIM / imgH);
      const resizedW = Math.round(imgW * scale);
      downloadUrl = `${SUPABASE_URL}/storage/v1/render/image/public/${BUCKET}/${storage_path}?width=${resizedW}&resize=contain`;
      console.log(`[CROP] Resizing ${imgW}x${imgH} → ${resizedW}px wide for processing`);
    } else {
      downloadUrl = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storage_path}`;
    }

    const imgResp = await fetch(downloadUrl);
    if (!imgResp.ok) {
      return new Response(JSON.stringify({ error: `Download failed: ${imgResp.status}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const imgBytes = new Uint8Array(await imgResp.arrayBuffer());
    console.log(`[CROP] Downloaded ${(imgBytes.byteLength / 1024).toFixed(0)} KB`);

    // Decode the (possibly resized) image
    const { decode: decodePng, encode: encodePng } = await import("https://deno.land/x/pngs@0.1.1/mod.ts");

    // For JPEG responses from Supabase transform, we need a different decoder
    const contentType = imgResp.headers.get("content-type") || "";
    let decoded: { image: Uint8Array; width: number; height: number };

    if (contentType.includes("jpeg") || contentType.includes("jpg")) {
      // Supabase transforms return JPEG — use jpeg decode
      const { decode: decodeJpeg } = await import("https://deno.land/x/jpegts@1.1/mod.ts");
      const jpg = decodeJpeg(imgBytes);
      // jpegts returns RGB, we need RGBA
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

    const actualW = decoded.width;
    const actualH = decoded.height;
    const pixels = decoded.image;

    // Adjust crop coordinates for the actual decoded dimensions
    const cropX = Math.max(0, Math.round((x_percent / 100) * actualW));
    const cropY = Math.max(0, Math.round((y_percent / 100) * actualH));
    const cropW = Math.min(Math.round((width_percent / 100) * actualW), actualW - cropX);
    const cropH = Math.min(Math.round((height_percent / 100) * actualH), actualH - cropY);

    console.log(`[CROP] Actual decoded: ${actualW}x${actualH} → crop (${cropX},${cropY}) ${cropW}x${cropH}`);

    // Extract cropped pixels
    const croppedPixels = new Uint8Array(cropW * cropH * 4);
    for (let row = 0; row < cropH; row++) {
      const srcOffset = ((cropY + row) * actualW + cropX) * 4;
      const dstOffset = row * cropW * 4;
      croppedPixels.set(pixels.subarray(srcOffset, srcOffset + cropW * 4), dstOffset);
    }

    const croppedBytes = encodePng(croppedPixels, cropW, cropH);
    console.log(`[CROP] Cropped: ${cropW}x${cropH}px (${(croppedBytes.byteLength / 1024).toFixed(0)} KB)`);

    // Upload
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    const { error: upErr } = await sb.storage.from(BUCKET).upload(output_path, croppedBytes, {
      contentType: "image/png", upsert: true,
    });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    // Get signed URL
    const { data: signedData } = await sb.storage.from(BUCKET).createSignedUrl(output_path, 3600);

    return new Response(JSON.stringify({
      success: true,
      path: output_path,
      url: signedData?.signedUrl || null,
      width: cropW,
      height: cropH,
      original_width: imgW,
      original_height: imgH,
      size_kb: Math.round(croppedBytes.byteLength / 1024),
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[CROP] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Crop failed" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
