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
 * panelizer-step-colorconvert — Step 9: RGB → CMYK TIFF with DPI metadata
 *
 * Input:  { inputPath, userId, jobId, panelKey, widthInches, heightInches }
 * Output: { storagePath } — CMYK TIFF at 150 DPI (10% scale) saved to temp storage
 *
 * Converts the final RGB PNG panel to a CMYK TIFF with embedded DPI
 * metadata. This is the same as ONYX's ICC profiling step.
 *
 * Uses a simple UCR (Under Color Removal) algorithm for RGB → CMYK:
 *   K = min(1-R, 1-G, 1-B)
 *   C = (1-R-K) / (1-K)
 *   M = (1-G-K) / (1-K)
 *   Y = (1-B-K) / (1-K)
 *
 * TIFF is written with Adobe Deflate compression and 150 DPI (PRINT_DPI).
 * No AI — pure color math + binary encoding.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { Image } from "https://deno.land/x/imagescript@1.2.15/mod.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { downloadFromStorage, uploadToStorage } from "../_shared/panelizer-os/storage.ts";
import { tempPath, PRINT_DPI, OUTPUT_SCALE, BLEED_INCHES } from "../_shared/panelizer-os/constants.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { inputPath, userId, jobId, panelKey, widthInches, heightInches } = await req.json();

    if (!inputPath || !userId || !jobId || !panelKey) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`[COLORCONVERT] Job ${jobId} — converting ${panelKey} to CMYK TIFF`);
    const startMs = Date.now();

    // Download PNG panel
    const inputBytes = await downloadFromStorage(inputPath);
    const img = await Image.decode(inputBytes);
    const width = img.width;
    const height = img.height;

    // ALWAYS embed 150 DPI in the TIFF metadata.
    // Files are at 10% scale — RIP software reads 150 DPI and scales to 1000%.
    const tiffDpi = PRINT_DPI; // 1500 at 10% scale = 150 DPI full size

    console.log(`[COLORCONVERT] Input: ${width}x${height} RGB PNG — embedding ${tiffDpi} DPI`);

    // Convert RGBA pixels to CMYK (4 channels, no alpha)
    const cmykData = new Uint8Array(width * height * 4);
    let idx = 0;

    for (let y = 1; y <= height; y++) {
      for (let x = 1; x <= width; x++) {
        const pixel = img.getPixelAt(x, y);
        // ImageScript pixel is RGBA as 0xRRGGBBAA
        const r = (pixel >>> 24) & 0xFF;
        const g = (pixel >>> 16) & 0xFF;
        const b = (pixel >>> 8) & 0xFF;

        // RGB → CMYK using UCR method
        const rn = r / 255;
        const gn = g / 255;
        const bn = b / 255;

        const k = Math.min(1 - rn, 1 - gn, 1 - bn);
        let c: number, m: number, yy: number;

        if (k >= 1) {
          c = 0;
          m = 0;
          yy = 0;
        } else {
          const inv = 1 / (1 - k);
          c = (1 - rn - k) * inv;
          m = (1 - gn - k) * inv;
          yy = (1 - bn - k) * inv;
        }

        // Scale to 0-255
        cmykData[idx++] = Math.round(c * 255);
        cmykData[idx++] = Math.round(m * 255);
        cmykData[idx++] = Math.round(yy * 255);
        cmykData[idx++] = Math.round(k * 255);
      }
    }

    console.log(`[COLORCONVERT] CMYK conversion done — ${(cmykData.byteLength / 1024).toFixed(0)} KB raw`);

    // Compress CMYK data with Deflate
    const compressedData = await zlibCompress(cmykData);
    console.log(`[COLORCONVERT] Compressed: ${(compressedData.byteLength / 1024).toFixed(0)} KB`);

    // Build TIFF file with CMYK data and DPI metadata
    const tiffBytes = buildCmykTiff(width, height, compressedData, tiffDpi);

    // Upload TIFF
    const storagePath = tempPath(userId, jobId, `step-9-cmyk-${panelKey}`, "tiff");
    await uploadToStorage(storagePath, tiffBytes, "image/tiff");

    console.log(`[COLORCONVERT] ${panelKey}: CMYK TIFF ${width}x${height} @ ${tiffDpi} DPI (${(tiffBytes.byteLength / 1024).toFixed(0)} KB) in ${Date.now() - startMs}ms`);

    return new Response(
      JSON.stringify({
        success: true,
        storagePath,
        panelKey,
        width,
        height,
        dpi: tiffDpi,
        colorSpace: "CMYK",
        compression: "deflate",
        sizeBytes: tiffBytes.byteLength,
        step: "colorconvert",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[COLORCONVERT] Error:", err);
    return new Response(
      JSON.stringify({ error: `Color convert step failed: ${err.message}` }),
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

// ── CMYK TIFF Builder ────────────────────────────────────────────

function buildCmykTiff(
  width: number,
  height: number,
  compressedData: Uint8Array,
  dpi: number,
): Uint8Array {
  // TIFF layout: [Header 8B] [Image Data] [IFD] [Extra Data]
  const samplesPerPixel = 4; // C, M, Y, K
  const headerSize = 8;
  const imageDataOffset = headerSize;
  const ifdOffset = imageDataOffset + compressedData.length;

  // IFD tags (must be in ascending tag order)
  const numTags = 14;
  const ifdSize = 2 + (numTags * 12) + 4; // count + tags + next-ifd-pointer

  const extraDataOffset = ifdOffset + ifdSize;
  const bpsOffset = extraDataOffset;         // BitsPerSample (4 × uint16 = 8 bytes)
  const xResOffset = bpsOffset + 8;          // XResolution (rational = 8 bytes)
  const yResOffset = xResOffset + 8;         // YResolution (rational = 8 bytes)
  const inkNamesOffset = yResOffset + 8;     // InkNames string
  const inkNames = "Cyan\0Magenta\0Yellow\0Black\0";
  const inkNamesLen = inkNames.length;

  const totalSize = headerSize + compressedData.length + ifdSize + 8 + 8 + 8 + inkNamesLen;

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
  writeTag(258, 3, 4, bpsOffset);                       // 0x102 BitsPerSample → offset to [8,8,8,8]
  writeTag(259, 3, 1, 8);                               // 0x103 Compression = Adobe Deflate
  writeTag(262, 3, 1, 5);                               // 0x106 PhotometricInterpretation = 5 (Separated/CMYK)
  writeTag(273, 4, 1, imageDataOffset);                 // 0x111 StripOffsets
  writeTag(277, 3, 1, samplesPerPixel);                 // 0x115 SamplesPerPixel = 4
  writeTag(278, 4, 1, height);                          // 0x116 RowsPerStrip = all
  writeTag(279, 4, 1, compressedData.length);           // 0x117 StripByteCounts
  writeTag(282, 5, 1, xResOffset);                      // 0x11A XResolution → rational
  writeTag(283, 5, 1, yResOffset);                      // 0x11B YResolution → rational
  writeTag(296, 3, 1, 2);                               // 0x128 ResolutionUnit = 2 (inches)
  writeTag(332, 3, 1, 1);                               // 0x14C InkSet = 1 (CMYK)
  writeTag(333, 2, inkNamesLen, inkNamesOffset);         // 0x14D InkNames → offset

  // Next IFD pointer = 0 (no more IFDs)
  view.setUint32(off, 0, true);

  // Extra data: BitsPerSample [8, 8, 8, 8]
  view.setUint16(bpsOffset, 8, true);
  view.setUint16(bpsOffset + 2, 8, true);
  view.setUint16(bpsOffset + 4, 8, true);
  view.setUint16(bpsOffset + 6, 8, true);

  // XResolution: rational (numerator/denominator)
  view.setUint32(xResOffset, dpi, true);
  view.setUint32(xResOffset + 4, 1, true);

  // YResolution: rational
  view.setUint32(yResOffset, dpi, true);
  view.setUint32(yResOffset + 4, 1, true);

  // InkNames
  const encoder = new TextEncoder();
  const inkNameBytes = encoder.encode(inkNames);
  bytes.set(inkNameBytes, inkNamesOffset);

  return bytes;
}
