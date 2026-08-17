/**
 * generate-flat-panel-test — Standalone sandbox flat panel generator
 *
 * Takes an approved 3D vehicle render + vehicle dimensions, generates
 * flat print-ready panels via Gemini, mirrors passenger side, uploads all.
 *
 * Model: gemini-3-pro-image-preview (LOCKED)
 * This is a STANDALONE SANDBOX — no shared modules, no existing pipeline deps.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Gemini key (self-contained — no shared import)
// ---------------------------------------------------------------------------
function getGeminiKey(): string {
  const primary = Deno.env.get("GOOGLE_AI_API_KEY");
  if (primary) return primary;
  for (let i = 2; i <= 5; i++) {
    const k = Deno.env.get(`GOOGLE_AI_API_KEY_${i}`);
    if (k) return k;
  }
  throw new Error("No GOOGLE_AI_API_KEY configured");
}

const GEMINI_IMAGE_MODEL = "gemini-3-pro-image-preview";

// ---------------------------------------------------------------------------
// SKU mapping from side_width
// ---------------------------------------------------------------------------
interface SKUSize {
  label: string;
  width: number;
  height: number;
}

function getSKU(sideWidth: number): SKUSize {
  if (sideWidth <= 144) return { label: "Small", width: 144, height: 59.5 };
  if (sideWidth <= 172) return { label: "Medium", width: 172, height: 59.5 };
  if (sideWidth <= 200) return { label: "Large", width: 200, height: 59.5 };
  return { label: "XL", width: 240, height: 59.5 };
}

// ---------------------------------------------------------------------------
// Panel definition
// ---------------------------------------------------------------------------
interface PanelDef {
  name: string;
  w_in: number;
  h_in: number;
  w_px: number;
  h_px: number;
  mirror?: boolean;
  position: string;
}

// Scale factor: inches → pixels at 10% of 150 DPI (keeps Gemini under 2MP limit)
const SCALE = 150 * 0.10; // 15 px per inch

function buildPanelList(dims: {
  side_width: number; side_height: number;
  hood_width: number; hood_length: number;
  roof_width: number | null; roof_length: number | null;
  back_width: number; back_height: number;
}, sku: SKUSize): PanelDef[] {
  const panels: PanelDef[] = [];

  // Driver Side — uses SKU width (standardized)
  panels.push({
    name: "Driver Side",
    w_in: sku.width, h_in: sku.height,
    w_px: Math.round(sku.width * SCALE),
    h_px: Math.round(sku.height * SCALE),
    position: "driver side of the vehicle — runs from front fender to rear quarter panel",
  });

  // Passenger Side — mirror of driver
  panels.push({
    name: "Passenger Side",
    w_in: sku.width, h_in: sku.height,
    w_px: Math.round(sku.width * SCALE),
    h_px: Math.round(sku.height * SCALE),
    mirror: true,
    position: "passenger side — mirror of driver side",
  });

  // Hood
  panels.push({
    name: "Hood",
    w_in: dims.hood_width, h_in: dims.hood_length,
    w_px: Math.round(dims.hood_width * SCALE),
    h_px: Math.round(dims.hood_length * SCALE),
    position: "hood of the vehicle — top surface between windshield and front bumper",
  });

  // Roof (if dimensions exist)
  if (dims.roof_width && dims.roof_length) {
    panels.push({
      name: "Roof",
      w_in: dims.roof_width, h_in: dims.roof_length,
      w_px: Math.round(dims.roof_width * SCALE),
      h_px: Math.round(dims.roof_length * SCALE),
      position: "roof of the vehicle — top surface between windshield and rear window",
    });
  }

  // Rear
  panels.push({
    name: "Rear",
    w_in: dims.back_width, h_in: dims.back_height,
    w_px: Math.round(dims.back_width * SCALE),
    h_px: Math.round(dims.back_height * SCALE),
    position: "rear/tailgate of the vehicle — back surface between taillights",
  });

  return panels;
}

// ---------------------------------------------------------------------------
// Create a blank white PNG using canvas (Deno-compatible via OffscreenCanvas)
// Falls back to a simple raw PNG generator if OffscreenCanvas isn't available
// ---------------------------------------------------------------------------
function createBlankPNG(w: number, h: number): Uint8Array {
  // Minimal valid white PNG generator (no external deps)
  // Creates an uncompressed IDAT with raw white pixel rows
  const SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  function crc32(data: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      c ^= data[i];
      for (let j = 0; j < 8; j++) {
        c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
      }
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function makeChunk(type: string, payload: Uint8Array): Uint8Array {
    const typeBytes = new TextEncoder().encode(type);
    const len = payload.length;
    const chunk = new Uint8Array(4 + 4 + len + 4);
    const dv = new DataView(chunk.buffer);
    dv.setUint32(0, len);
    chunk.set(typeBytes, 4);
    chunk.set(payload, 8);
    const crcData = new Uint8Array(4 + len);
    crcData.set(typeBytes, 0);
    crcData.set(payload, 4);
    dv.setUint32(8 + len, crc32(crcData));
    return chunk;
  }

  // IHDR
  const ihdr = new Uint8Array(13);
  const ihdrDv = new DataView(ihdr.buffer);
  ihdrDv.setUint32(0, w);
  ihdrDv.setUint32(4, h);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // IDAT — raw deflate of white pixel rows
  // Each row: filter byte (0) + RGB(255,255,255) * w
  const rowLen = 1 + w * 3;
  const rawData = new Uint8Array(rowLen * h);
  for (let y = 0; y < h; y++) {
    const offset = y * rowLen;
    rawData[offset] = 0; // no filter
    for (let x = 0; x < w * 3; x++) {
      rawData[offset + 1 + x] = 255; // white
    }
  }

  // Wrap in zlib container (store blocks, no compression)
  // zlib header: CMF=0x78, FLG=0x01
  const maxBlock = 65535;
  const numBlocks = Math.ceil(rawData.length / maxBlock);
  const zlibSize = 2 + rawData.length + numBlocks * 5 + 4; // header + data + block headers + adler32
  const zlib = new Uint8Array(zlibSize);
  let pos = 0;
  zlib[pos++] = 0x78;
  zlib[pos++] = 0x01;

  let remaining = rawData.length;
  let srcPos = 0;
  while (remaining > 0) {
    const blockLen = Math.min(remaining, maxBlock);
    const isLast = remaining <= maxBlock;
    zlib[pos++] = isLast ? 1 : 0;
    zlib[pos++] = blockLen & 0xFF;
    zlib[pos++] = (blockLen >> 8) & 0xFF;
    zlib[pos++] = (~blockLen) & 0xFF;
    zlib[pos++] = ((~blockLen) >> 8) & 0xFF;
    zlib.set(rawData.subarray(srcPos, srcPos + blockLen), pos);
    pos += blockLen;
    srcPos += blockLen;
    remaining -= blockLen;
  }

  // Adler32
  let a = 1, b = 0;
  for (let i = 0; i < rawData.length; i++) {
    a = (a + rawData[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;
  zlib[pos++] = (adler >> 24) & 0xFF;
  zlib[pos++] = (adler >> 16) & 0xFF;
  zlib[pos++] = (adler >> 8) & 0xFF;
  zlib[pos++] = adler & 0xFF;

  const idatPayload = zlib.subarray(0, pos);

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", idatPayload);
  const iendChunk = makeChunk("IEND", new Uint8Array(0));

  const png = new Uint8Array(SIGNATURE.length + ihdrChunk.length + idatChunk.length + iendChunk.length);
  let offset = 0;
  png.set(SIGNATURE, offset); offset += SIGNATURE.length;
  png.set(ihdrChunk, offset); offset += ihdrChunk.length;
  png.set(idatChunk, offset); offset += idatChunk.length;
  png.set(iendChunk, offset);

  return png;
}

// ---------------------------------------------------------------------------
// Flip a PNG horizontally (simple pixel-level flop for RGB)
// ---------------------------------------------------------------------------
function flipPNGHorizontal(pngBytes: Uint8Array, width: number, height: number): Uint8Array {
  // For simplicity, we'll just call Gemini with a flipped prompt
  // Actually let's do a proper pixel flip on the raw image data
  // But we don't have the raw pixels easily from a Gemini-returned image...
  // We'll use a canvas-based approach via the returned base64

  // Since we're in Deno without DOM, we'll handle this by re-encoding
  // For the MVP, we store the driver side base64 and return it with a note
  // that it's mirrored. The frontend test page can do the canvas flip.
  return pngBytes; // Placeholder — actual mirror done in frontend
}

// ---------------------------------------------------------------------------
// Safe base64 encode (chunked — avoids call stack overflow on large arrays)
// ---------------------------------------------------------------------------
function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Fetch image as base64
// ---------------------------------------------------------------------------
async function fetchImageBase64(url: string): Promise<{ base64: string; mimeType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to fetch image: ${resp.status} ${url.slice(0, 100)}`);
  const blob = await resp.blob();
  const arrayBuf = await blob.arrayBuffer();
  const bytes = new Uint8Array(arrayBuf);
  const base64 = uint8ToBase64(bytes);
  const mimeType = blob.type || "image/png";
  return { base64, mimeType };
}

// ---------------------------------------------------------------------------
// Generate one flat panel via Gemini
// ---------------------------------------------------------------------------
async function generatePanel(
  panel: PanelDef,
  referenceBase64: string | null,
  referenceMime: string | null,
  blankBase64: string,
  rewrittenPrompt: string,
  finish: string,
  apiKey: string,
): Promise<{ imageBase64: string; mimeType: string; durationMs: number }> {
  const start = Date.now();

  // Build prompt — adapts based on whether we have a reference render
  const hasRef = !!referenceBase64;
  const prompt = hasRef
    ? `You are a professional vehicle wrap production artist. You create flat, print-ready vinyl wrap panel artwork.

I am showing you TWO images:

IMAGE 1 — DESIGN REFERENCE: This is a completed vehicle wrap design rendered on a 3D vehicle. This is the APPROVED design the customer wants printed.

IMAGE 2 — BLANK PANEL: This is a white rectangle at the exact pixel dimensions of one wrap panel. This panel will be printed on vinyl and installed on the vehicle.

YOUR TASK: Look at the design in Image 1. Now recreate that SAME design as flat artwork that fills Image 2 completely.

THIS PANEL: ${panel.name}
PANEL SIZE: ${panel.w_in} inches x ${panel.h_in} inches
POSITION ON VEHICLE: ${panel.position}

RULES:
- Recreate the EXACT same design, colors, imagery, style, and composition from the reference render
- Fill the ENTIRE rectangle edge to edge. Zero white space, zero margins, zero borders
- Flat artwork viewed from directly above — like vinyl on a print table
- NOT a photo of a car — just the design artwork itself, completely flat
- Do NOT include any vehicle body, wheels, windows, ground, shadows, or environment
- Photorealistic print quality, ${finish} finish
- This panel connects visually with other panels in the set when installed on the vehicle

DESIGN DIRECTION: ${rewrittenPrompt}

Fill the blank panel now.`
    : `You are a professional vehicle wrap production artist. You create flat, print-ready vinyl wrap panel artwork.

I am showing you a BLANK PANEL — a white rectangle at the exact pixel dimensions of one wrap panel. This panel will be printed on vinyl and installed on a vehicle.

YOUR TASK: Create a flat, print-ready wrap design that fills this rectangle completely based on the design direction below.

THIS PANEL: ${panel.name}
PANEL SIZE: ${panel.w_in} inches x ${panel.h_in} inches
POSITION ON VEHICLE: ${panel.position}

RULES:
- Fill the ENTIRE rectangle edge to edge. Zero white space, zero margins, zero borders
- Flat artwork viewed from directly above — like vinyl on a print table
- NOT a photo of a car — just the design artwork itself, completely flat
- Do NOT include any vehicle body, wheels, windows, ground, shadows, or environment
- Photorealistic print quality, ${finish} finish
- This panel connects visually with other panels in the set when installed on the vehicle
- Create a cohesive, professional $5,000 wrap design with depth, color flow, and visual impact

DESIGN DIRECTION: ${rewrittenPrompt}

Fill the blank panel now.`;

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${apiKey}`;

  // Build parts array — include reference image only if available
  const parts: any[] = [];
  if (hasRef) {
    parts.push({ inline_data: { mimeType: referenceMime, data: referenceBase64 } });
  }
  parts.push({ inline_data: { mimeType: "image/png", data: blankBase64 } });
  parts.push({ text: prompt });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["IMAGE"],
        temperature: 0.4,
      },
    }),
    signal: AbortSignal.timeout(120_000), // 2 min per panel
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini ${response.status}: ${errText.slice(0, 300)}`);
  }

  const result = await response.json();
  const candidate = result?.candidates?.[0];
  if (!candidate) throw new Error("No candidate in Gemini response");

  // Find image part in response
  const imagePart = candidate.content?.parts?.find((p: any) => p.inline_data);
  if (!imagePart?.inline_data?.data) {
    const finishReason = candidate.finishReason;
    throw new Error(`No image in response (finishReason: ${finishReason})`);
  }

  return {
    imageBase64: imagePart.inline_data.data,
    mimeType: imagePart.inline_data.mimeType || "image/png",
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      rewritten_prompt,
      finish = "Gloss",
      vehicle_make,
      vehicle_model,
      vehicle_year,
      render_url,
      generation_id,
    } = body;

    if (!rewritten_prompt) {
      return new Response(
        JSON.stringify({ error: "rewritten_prompt is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!vehicle_make || !vehicle_model) {
      return new Response(
        JSON.stringify({ error: "vehicle_make and vehicle_model are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Init Supabase client ---
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, supabaseServiceKey);
    const apiKey = getGeminiKey();

    // --- 3A: Get the 3D render reference (optional — prompt-only mode supported) ---
    let referenceUrl = render_url;
    if (!referenceUrl && generation_id) {
      const { data: gen } = await sb
        .from("designiq_generations")
        .select("hero_render_url, render_urls")
        .eq("id", generation_id)
        .maybeSingle();
      if (gen?.hero_render_url) {
        referenceUrl = gen.hero_render_url;
      }
    }

    let refBase64: string | null = null;
    let refMime: string | null = null;

    if (referenceUrl) {
      console.log(`[FLAT-PANEL-GEN] Reference render loaded: ${referenceUrl.slice(0, 80)}...`);
      const refData = await fetchImageBase64(referenceUrl);
      refBase64 = refData.base64;
      refMime = refData.mimeType;
    } else {
      console.log(`[FLAT-PANEL-GEN] No reference render — running in prompt-only mode`);
    }

    // --- 3B: Look up vehicle dimensions ---
    let dims: any = null;
    let dimSource = "fallback";

    // Exact match
    const { data: exactMatch } = await sb
      .from("vehicle_dimensions")
      .select("*")
      .ilike("make", vehicle_make)
      .ilike("model", `%${vehicle_model}%`)
      .order("year_end", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (exactMatch) {
      dims = exactMatch;
      dimSource = "database";
    } else {
      // Fuzzy: try base model name (first word, e.g., "F-150" from "F-150 SuperCrew")
      const baseModel = vehicle_model.split(/\s+/)[0];
      if (baseModel !== vehicle_model) {
        const { data: fuzzyMatch } = await sb
          .from("vehicle_dimensions")
          .select("*")
          .ilike("make", vehicle_make)
          .ilike("model", `%${baseModel}%`)
          .order("year_end", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle();
        if (fuzzyMatch) {
          dims = fuzzyMatch;
          dimSource = "database (fuzzy)";
        }
      }
    }

    // Last resort fallback — generic Medium
    if (!dims) {
      dims = {
        side_width: 172, side_height: 59.5,
        hood_width: 72, hood_length: 59.5,
        roof_width: 110, roof_length: 59.5,
        back_width: 59, back_height: 72.5,
        recommended_size: "M",
      };
      dimSource = "fallback (generic Medium)";
    }

    const sku = getSKU(Number(dims.side_width));
    console.log(`[FLAT-PANEL-GEN] Vehicle: ${vehicle_year || "?"} ${vehicle_make} ${vehicle_model}`);
    console.log(`[FLAT-PANEL-GEN] Source: ${dimSource}`);
    console.log(`[FLAT-PANEL-GEN] SKU: ${sku.label} (${sku.width}" x ${sku.height}")`);

    // Build panels
    const panels = buildPanelList({
      side_width: Number(dims.side_width),
      side_height: Number(dims.side_height),
      hood_width: Number(dims.hood_width),
      hood_length: Number(dims.hood_length),
      roof_width: dims.roof_width ? Number(dims.roof_width) : null,
      roof_length: dims.roof_length ? Number(dims.roof_length) : null,
      back_width: Number(dims.back_width),
      back_height: Number(dims.back_height),
    }, sku);

    console.log(`[FLAT-PANEL-GEN] Panels: ${panels.length} to generate`);

    // --- 3C: Generate blank rectangles & call Gemini for each ---
    const timestamp = Date.now();
    const folderPath = `flat-panel-tests/${generation_id || timestamp}`;
    const results: any[] = [];
    let driverBase64: string | null = null;
    let driverMime = "image/png";

    for (const panel of panels) {
      if (panel.mirror) {
        // Skip passenger — will mirror driver side later
        continue;
      }

      // Create blank white rectangle
      const blankPng = createBlankPNG(panel.w_px, panel.h_px);
      const blankBase64 = uint8ToBase64(blankPng);
      console.log(`[FLAT-PANEL-GEN] Blank rectangle: ${panel.name} ${panel.w_px}x${panel.h_px}px`);

      // Call Gemini
      console.log(`[FLAT-PANEL-GEN] Generating ${panel.name}...`);
      const genResult = await generatePanel(
        panel, refBase64, refMime, blankBase64,
        rewritten_prompt, finish, apiKey
      );

      const sizeKB = Math.round(genResult.imageBase64.length * 0.75 / 1024);
      console.log(`[FLAT-PANEL-GEN] ${panel.name}: generated ${genResult.durationMs}ms, ${sizeKB}KB`);

      // Save driver base64 for mirroring
      if (panel.name === "Driver Side") {
        driverBase64 = genResult.imageBase64;
        driverMime = genResult.mimeType;
      }

      // Upload to storage
      const ext = genResult.mimeType.includes("png") ? "png" : "jpg";
      const fileName = `${panel.name.toLowerCase().replace(/\s+/g, "-")}.${ext}`;
      const filePath = `${folderPath}/${fileName}`;

      const binaryStr = atob(genResult.imageBase64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const { error: uploadErr } = await sb.storage
        .from("wrap-files")
        .upload(filePath, bytes, { contentType: genResult.mimeType, upsert: true });

      if (uploadErr) {
        console.error(`[FLAT-PANEL-GEN] Upload failed for ${panel.name}:`, uploadErr.message);
      }

      const { data: { publicUrl } } = sb.storage.from("wrap-files").getPublicUrl(filePath);

      results.push({
        name: panel.name,
        url: publicUrl,
        width_inches: panel.w_in,
        height_inches: panel.h_in,
        width_px: panel.w_px,
        height_px: panel.h_px,
        method: "gemini",
        duration_ms: genResult.durationMs,
      });
    }

    // --- 3E: Mirror passenger side from driver ---
    if (driverBase64) {
      console.log(`[FLAT-PANEL-GEN] Passenger Side: mirroring from Driver Side (zero AI calls)`);
      // Upload driver image as passenger (frontend will flip visually)
      // Mark as mirrored so the test page knows to flip it
      const passengerPanel = panels.find(p => p.mirror);
      if (passengerPanel) {
        const ext = driverMime.includes("png") ? "png" : "jpg";
        const filePath = `${folderPath}/passenger-side.${ext}`;

        const binaryStr = atob(driverBase64);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const { error: uploadErr } = await sb.storage
          .from("wrap-files")
          .upload(filePath, bytes, { contentType: driverMime, upsert: true });

        if (uploadErr) {
          console.error(`[FLAT-PANEL-GEN] Passenger upload failed:`, uploadErr.message);
        }

        const { data: { publicUrl } } = sb.storage.from("wrap-files").getPublicUrl(filePath);

        results.push({
          name: "Passenger Side",
          url: publicUrl,
          width_inches: passengerPanel.w_in,
          height_inches: passengerPanel.h_in,
          width_px: passengerPanel.w_px,
          height_px: passengerPanel.h_px,
          method: "mirrored_from_driver",
          note: "Image is driver side — apply CSS scaleX(-1) to flip",
        });
      }
    }

    // --- Sort results in standard order ---
    const ORDER = ["Driver Side", "Passenger Side", "Hood", "Roof", "Rear"];
    results.sort((a, b) => ORDER.indexOf(a.name) - ORDER.indexOf(b.name));

    console.log(`[FLAT-PANEL-GEN] Complete: ${results.length} panels generated`);

    return new Response(
      JSON.stringify({
        success: true,
        vehicle: {
          make: vehicle_make,
          model: vehicle_model,
          year: vehicle_year || null,
          source: dimSource,
          sku: sku.label,
        },
        reference_render: referenceUrl,
        panels: results,
        artboard_url: null, // Artboard composition deferred to future iteration
        model: GEMINI_IMAGE_MODEL,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[FLAT-PANEL-GEN] Error:", err.message);
    return new Response(
      JSON.stringify({ error: err.message || "Generation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
