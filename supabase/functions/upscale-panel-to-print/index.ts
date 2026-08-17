/**
 * upscale-panel-to-print — Handler 2: Upscale + TIFF Export
 *
 * Upscales the composited panel via Replicate Real-ESRGAN 4x, then builds
 * an RGB TIFF with 150 DPI metadata. Two outputs: high-res PNG + print TIFF.
 *
 * Input:  { inputPath, panelKey, widthInches, heightInches, userId, jobId, targetDpi }
 * Output: { pngPath, tiffPath, pngSignedUrl, tiffSignedUrl }
 *
 * TIFF is built from the PRE-upscale image (working resolution) because the
 * 4x upscaled image can exceed edge function memory limits. RIP software
 * scales the print to correct physical dimensions using DPI + panel spec.
 *
 * No placement logic. No graphic manipulation. Pure upscale + export.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import {
  downloadFromStorage,
  uploadToStorage,
  getSignedUrl,
} from "../_shared/panelizer-os/storage.ts";
import {
  tempPath,
  REPLICATE_MODEL_VERSION,
  REPLICATE_POLL_MAX,
  REPLICATE_POLL_INTERVAL_MS,
} from "../_shared/panelizer-os/constants.ts";

const STEP_TIMEOUT_MS = 45_000;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      inputPath, panelKey, widthInches, heightInches,
      userId, jobId, targetDpi = 150,
    } = await req.json();

    if (!inputPath || !panelKey || !userId || !jobId) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[UPSCALE-PRINT] Job ${jobId} — processing ${panelKey}`);
    const startMs = Date.now();

    const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN");

    // ── Step 1: ESRGAN 4x Upscale ────────────────────────────────
    let pngPath = inputPath;
    let upscaled = false;
    let pngWidth = 0;
    let pngHeight = 0;

    if (REPLICATE_API_TOKEN) {
      const controller = new AbortController();
      const stepTimeout = setTimeout(() => controller.abort(), STEP_TIMEOUT_MS);

      try {
        const signedUrl = await getSignedUrl(inputPath);

        const createResponse = await fetch("https://api.replicate.com/v1/predictions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${REPLICATE_API_TOKEN}`,
            "Content-Type": "application/json",
            Prefer: "wait",
          },
          body: JSON.stringify({
            version: REPLICATE_MODEL_VERSION,
            input: { image: signedUrl, scale: 4, face_enhance: false },
          }),
          signal: controller.signal,
        });

        let result = await createResponse.json();
        let pollAttempts = 0;

        while (
          result.status !== "succeeded" &&
          result.status !== "failed" &&
          result.status !== "canceled" &&
          pollAttempts < REPLICATE_POLL_MAX
        ) {
          await new Promise((r) => setTimeout(r, REPLICATE_POLL_INTERVAL_MS));
          pollAttempts++;
          if (!result.urls?.get) break;
          const pollResponse = await fetch(result.urls.get, {
            headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` },
            signal: controller.signal,
          });
          result = await pollResponse.json();
        }

        clearTimeout(stepTimeout);

        if (result.status === "succeeded" && result.output) {
          const upscaledUrl = typeof result.output === "string"
            ? result.output
            : result.output[0];
          const upscaledResp = await fetch(upscaledUrl);

          if (upscaledResp.ok) {
            const upscaledBytes = new Uint8Array(await upscaledResp.arrayBuffer());
            pngPath = tempPath(userId, jobId, `upscale-${panelKey}`);
            await uploadToStorage(pngPath, upscaledBytes, "image/png");
            upscaled = true;

            // Decode to get dimensions
            const upImg = await Image.decode(upscaledBytes);
            pngWidth = upImg.width;
            pngHeight = upImg.height;

            console.log(`[UPSCALE-PRINT] ${panelKey}: ESRGAN 4x → ${pngWidth}x${pngHeight} (${(upscaledBytes.byteLength / 1024).toFixed(0)} KB)`);
          } else {
            console.warn(`[UPSCALE-PRINT] ${panelKey}: download failed — using original`);
          }
        } else {
          console.warn(`[UPSCALE-PRINT] ${panelKey}: Replicate ${result.status} — using original`);
        }
      } catch (err) {
        clearTimeout(stepTimeout);
        const isTimeout = err.name === "AbortError";
        console.warn(`[UPSCALE-PRINT] ${panelKey}: ${isTimeout ? "45s TIMEOUT" : err.message} — using original`);
      }
    } else {
      console.warn("[UPSCALE-PRINT] REPLICATE_API_TOKEN not configured — skipping upscale");
    }

    // If upscale didn't produce dimensions, get from original
    if (!pngWidth || !pngHeight) {
      const origBytes = await downloadFromStorage(inputPath);
      const origImg = await Image.decode(origBytes);
      pngWidth = origImg.width;
      pngHeight = origImg.height;
    }

    // ── Step 2: Build RGB TIFF from pre-upscale composite ─────────
    console.log(`[UPSCALE-PRINT] ${panelKey}: Building RGB TIFF @ ${targetDpi} DPI`);

    const compositeBytes = await downloadFromStorage(inputPath);
    const img = await Image.decode(compositeBytes);
    const tiffW = img.width;
    const tiffH = img.height;

    // Extract RGB pixel data (drop alpha)
    const rgbData = new Uint8Array(tiffW * tiffH * 3);
    let idx = 0;
    for (let y = 1; y <= tiffH; y++) {
      for (let x = 1; x <= tiffW; x++) {
        const pixel = img.getPixelAt(x, y);
        rgbData[idx++] = (pixel >>> 24) & 0xFF; // R
        rgbData[idx++] = (pixel >>> 16) & 0xFF; // G
        rgbData[idx++] = (pixel >>> 8) & 0xFF;  // B
      }
    }

    // Compress with Deflate
    const compressedData = await zlibCompress(rgbData);
    console.log(`[UPSCALE-PRINT] ${panelKey}: RGB ${(rgbData.byteLength / 1024).toFixed(0)} KB → compressed ${(compressedData.byteLength / 1024).toFixed(0)} KB`);

    // Build TIFF binary
    const tiffBytes = buildRgbTiff(tiffW, tiffH, compressedData, targetDpi);

    // Upload TIFF
    const tiffPath = tempPath(userId, jobId, `print-${panelKey}`, "tiff");
    await uploadToStorage(tiffPath, tiffBytes, "image/tiff");

    // Generate signed URLs for both outputs
    const pngSignedUrl = await getSignedUrl(pngPath);
    const tiffSignedUrl = await getSignedUrl(tiffPath);

    const elapsedMs = Date.now() - startMs;
    console.log(`[UPSCALE-PRINT] ${panelKey}: complete in ${elapsedMs}ms — PNG ${pngWidth}x${pngHeight}, TIFF ${tiffW}x${tiffH} @ ${targetDpi} DPI`);

    return new Response(
      JSON.stringify({
        success: true,
        pngPath,
        tiffPath,
        pngSignedUrl,
        tiffSignedUrl,
        panelKey,
        upscaled,
        pngWidth,
        pngHeight,
        tiffWidth: tiffW,
        tiffHeight: tiffH,
        tiffDpi: targetDpi,
        step: "upscale-print",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[UPSCALE-PRINT] Error:", err);
    return new Response(
      JSON.stringify({ error: `Upscale-print step failed: ${err.message}` }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Deflate compression via Deno CompressionStream ───────────────

async function zlibCompress(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const chunks: Uint8Array[] = [];
  const reader = cs.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  let totalLength = 0;
  for (const c of chunks) totalLength += c.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

// ── RGB TIFF Builder ─────────────────────────────────────────────
// Adapted from panelizer-step-colorconvert's CMYK builder for 3-channel RGB.

function buildRgbTiff(
  width: number,
  height: number,
  compressedData: Uint8Array,
  dpi: number,
): Uint8Array {
  // TIFF layout: [Header 8B] [Image Data] [IFD] [Extra Data]
  const samplesPerPixel = 3; // R, G, B
  const headerSize = 8;
  const imageDataOffset = headerSize;
  const ifdOffset = imageDataOffset + compressedData.length;

  // IFD: 12 tags (no InkSet/InkNames for RGB, but includes ResolutionUnit)
  const numTags = 12;
  const ifdSize = 2 + (numTags * 12) + 4; // count + tags + next-ifd-pointer

  const extraDataOffset = ifdOffset + ifdSize;
  const bpsOffset = extraDataOffset;         // BitsPerSample (3 x uint16 = 6 bytes, padded to 8)
  const xResOffset = bpsOffset + 8;          // XResolution (rational = 8 bytes)
  const yResOffset = xResOffset + 8;         // YResolution (rational = 8 bytes)

  const totalSize = headerSize + compressedData.length + ifdSize + 8 + 8 + 8;

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  // TIFF Header (little-endian)
  bytes[0] = 0x49; bytes[1] = 0x49; // "II" = little-endian
  view.setUint16(2, 42, true);       // Magic number
  view.setUint32(4, ifdOffset, true); // Offset to first IFD

  // Image data
  bytes.set(compressedData, imageDataOffset);

  // IFD
  let off = ifdOffset;
  view.setUint16(off, numTags, true); off += 2;

  const writeTag = (tag: number, type: number, count: number, value: number) => {
    view.setUint16(off, tag, true); off += 2;  // Tag
    view.setUint16(off, type, true); off += 2;  // Type
    view.setUint32(off, count, true); off += 4;  // Count
    view.setUint32(off, value, true); off += 4;  // Value/Offset
  };

  // Tags in ascending order (REQUIRED by TIFF spec)
  writeTag(256, 4, 1, width);                           // 0x100 ImageWidth (LONG)
  writeTag(257, 4, 1, height);                          // 0x101 ImageLength (LONG)
  writeTag(258, 3, 3, bpsOffset);                       // 0x102 BitsPerSample → offset to [8,8,8]
  writeTag(259, 3, 1, 8);                               // 0x103 Compression = Adobe Deflate
  writeTag(262, 3, 1, 2);                               // 0x106 PhotometricInterpretation = 2 (RGB)
  writeTag(273, 4, 1, imageDataOffset);                 // 0x111 StripOffsets
  writeTag(277, 3, 1, samplesPerPixel);                 // 0x115 SamplesPerPixel = 3
  writeTag(278, 4, 1, height);                          // 0x116 RowsPerStrip = all
  writeTag(279, 4, 1, compressedData.length);           // 0x117 StripByteCounts
  writeTag(282, 5, 1, xResOffset);                      // 0x11A XResolution → rational
  writeTag(283, 5, 1, yResOffset);                      // 0x11B YResolution → rational
  writeTag(296, 3, 1, 2);                               // 0x128 ResolutionUnit = 2 (inches)

  // Next IFD pointer = 0 (no more IFDs)
  view.setUint32(off, 0, true);

  // Extra data: BitsPerSample [8, 8, 8] (6 bytes, 2 bytes padding)
  view.setUint16(bpsOffset, 8, true);
  view.setUint16(bpsOffset + 2, 8, true);
  view.setUint16(bpsOffset + 4, 8, true);

  // XResolution: rational (numerator/denominator)
  view.setUint32(xResOffset, dpi, true);
  view.setUint32(xResOffset + 4, 1, true);

  // YResolution: rational
  view.setUint32(yResOffset, dpi, true);
  view.setUint32(yResOffset + 4, 1, true);

  return bytes;
}
