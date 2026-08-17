/**
 * generate-cut-files — Cut File Generator v1.1
 *
 * Takes an existing branded vehicle render and produces print-ready cut files:
 *   1. Gemini isolates each text/logo element as a transparent PNG
 *   2. Each PNG is vectorized locally via imagetracerjs (pure JS, no external API)
 *   3. SVG cut paths get 1/4" bleed added
 *   4. All PNGs + SVGs are packaged into a downloadable ZIP
 *
 * PAID feature — invoked from render detail page.
 *
 * Required secrets:
 *   GOOGLE_AI_API_KEY   — Gemini API key (primary)
 *   GOOGLE_AI_API_KEY_2 — Gemini API key (pool)
 *   GOOGLE_AI_API_KEY_3 — Gemini API key (pool)
 *   GOOGLE_AI_API_KEY_4 — Gemini API key (pool)
 *   GOOGLE_AI_API_KEY_5 — Gemini API key (pool)
 *
 * Vectorization: Uses VTracer WASM (visioncortex/vtracer compiled to WebAssembly).
 * Same engine as the vtracer.visioncortex.org web app. No external API.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import JSZip from "https://esm.sh/jszip@3.10.1";
import { getGeminiKey, hasGeminiKey, geminiKeyCount } from "../_shared/gemini-key-pool.ts";
import { bytesToSvg, PRESET_LOGO } from "../_shared/vtracer/engine.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const BLEED_INCHES = 0.25; // 1/4 inch bleed for cut paths

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Base64 helpers
// ---------------------------------------------------------------------------

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// ---------------------------------------------------------------------------
// Step 1: Use Gemini to identify and extract text/logo elements
// Returns an array of { label, base64, mimeType } for each isolated element
// ---------------------------------------------------------------------------

interface ExtractedElement {
  label: string;
  base64: string;
  mimeType: string;
}

async function extractElements(
  renderImageBase64: string,
  renderMimeType: string,
): Promise<ExtractedElement[]> {
  const elements: ExtractedElement[] = [];
  const MAX_RETRIES = 4;
  const MAX_ELEMENTS = 6; // Cap to avoid hitting rate limits with many elements

  // Phase 1: Ask Gemini to identify all text/logo elements and their locations
  const identifyPrompt = `Analyze this vehicle wrap render. List every distinct text element and logo/graphic element visible on the vehicle wrap.

For each element, provide:
- label: A descriptive name (e.g., "Company Name - ACME Corp", "Phone Number", "Logo - Left Door", "Mascot Graphic")
- type: "text" or "logo"

Output ONLY a JSON array, no other text. Example:
[{"label": "Company Name", "type": "text"}, {"label": "Phone Number", "type": "text"}, {"label": "Logo Left Door", "type": "logo"}]

If there are no text or logo elements (pure artistic/restyle wrap), output: []`;

  const identifyResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: identifyPrompt },
            { inlineData: { mimeType: renderMimeType, data: renderImageBase64 } },
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 2048,
        },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!identifyResponse.ok) {
    console.error("Gemini identify elements failed:", identifyResponse.status);
    return [];
  }

  const identifyResult = await identifyResponse.json();
  const identifyText = identifyResult.candidates?.[0]?.content?.parts?.[0]?.text;

  let elementList: Array<{ label: string; type: string }> = [];
  try {
    elementList = JSON.parse(identifyText || "[]");
  } catch {
    console.error("Failed to parse element list:", identifyText?.slice(0, 200));
    return [];
  }

  if (!elementList.length) {
    console.log("No text/logo elements found on this render.");
    return [];
  }

  // Cap elements to avoid 429 rate limit cascade
  if (elementList.length > MAX_ELEMENTS) {
    console.log(`Capping from ${elementList.length} to ${MAX_ELEMENTS} elements to stay within rate limits`);
    elementList = elementList.slice(0, MAX_ELEMENTS);
  }

  console.log(`Found ${elementList.length} elements: ${elementList.map(e => e.label).join(", ")}`);
  console.log(`  Using ${geminiKeyCount()} API key(s) with round-robin rotation`);

  // Wait after identify call before starting extractions to spread API load
  await sleep(3000);

  // Phase 2: Extract each element as a transparent PNG via Gemini image generation
  // Uses round-robin key rotation + retry with exponential backoff for 429s
  for (const element of elementList) {
    let extracted = false;

    for (let attempt = 0; attempt < MAX_RETRIES && !extracted; attempt++) {
      try {
        const currentKey = getGeminiKey();

        const extractPrompt = `Look at this vehicle wrap render. Isolate ONLY the "${element.label}" element (${element.type}).

OUTPUT: A PNG image with TRANSPARENT background containing ONLY this single element — "${element.label}".

RULES:
1. The element must be extracted EXACTLY as it appears on the vehicle (same font, same size, same colors)
2. Background must be 100% transparent (alpha = 0)
3. Crop tightly to the element with minimal padding
4. Do NOT include any vehicle body, wrap background color, or other design elements
5. Do NOT include any other text or logos — ONLY "${element.label}"
6. Maintain the element's original orientation and proportions`;

        const extractResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${currentKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { text: extractPrompt },
                  { inlineData: { mimeType: renderMimeType, data: renderImageBase64 } },
                ],
              }],
              generationConfig: {
                responseModalities: ["IMAGE"],
                imageConfig: { imageSize: "4K" },
              },
            }),
            signal: AbortSignal.timeout(60_000),
          },
        );

        if (extractResponse.status === 429) {
          const backoffMs = Math.min(5000 * Math.pow(2, attempt), 60000);
          console.warn(`  ⏳ Rate limited on "${element.label}" (attempt ${attempt + 1}/${MAX_RETRIES}), waiting ${backoffMs}ms...`);
          await sleep(backoffMs);
          continue;
        }

        if (!extractResponse.ok) {
          console.warn(`  Extract failed for "${element.label}": HTTP ${extractResponse.status}`);
          break;
        }

        const extractResult = await extractResponse.json();
        const parts = extractResult.candidates?.[0]?.content?.parts;

        if (parts) {
          for (const part of parts) {
            if (part.inlineData?.data) {
              elements.push({
                label: element.label,
                base64: part.inlineData.data,
                mimeType: part.inlineData.mimeType || "image/png",
              });
              console.log(`  ✅ Extracted: "${element.label}" (${Math.round(part.inlineData.data.length * 0.75 / 1024)}KB)`);
              extracted = true;
              break;
            }
          }
        }
      } catch (err) {
        console.warn(`  Error extracting "${element.label}" (attempt ${attempt + 1}):`, err);
      }
    }

    if (!extracted) {
      console.warn(`  ❌ Skipped "${element.label}" after ${MAX_RETRIES} attempts`);
    }

    // Delay between elements — 5s spreads load across keys to avoid 429s
    await sleep(5000);
  }

  return elements;
}

// ---------------------------------------------------------------------------
// Step 2: Vectorize PNG to SVG locally via VTracer WASM
// Uses visioncortex/vtracer compiled to WebAssembly — same engine as the
// vtracer.visioncortex.org web app. Full-color, curve-fit spline output,
// vastly better than imagetracerjs for logos and text.
// ---------------------------------------------------------------------------

async function vectorizePng(pngBytes: Uint8Array, label: string): Promise<string | null> {
  try {
    const { svg, width, height } = await bytesToSvg(pngBytes, {
      ...PRESET_LOGO,
      cornerThreshold: 60,   // crisp corners for text/logos
      filterSpeckle: 4,      // drop noise, keep fine detail
      colorPrecision: 6,     // enough to preserve multi-color logos
    });
    console.log(`  ✅ Vectorized: "${label}" (${svg.length} chars SVG, ${width}x${height}px)`);
    return svg;
  } catch (err) {
    console.warn(`  Vectorize failed for "${label}":`, err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 3: Add 1/4" bleed to SVG cut paths
// Expands the SVG canvas by the bleed amount on all sides, shifting artwork
// to center. Adds a magenta dashed trim line at the original boundary.
// ---------------------------------------------------------------------------

function addBleedToSvg(svgContent: string, bleedInches: number): string {
  // Parse the SVG viewBox to get dimensions
  const viewBoxMatch = svgContent.match(/viewBox="([^"]+)"/);
  const widthMatch = svgContent.match(/width="([^"]+)"/);
  const heightMatch = svgContent.match(/height="([^"]+)"/);

  if (!viewBoxMatch) return svgContent;

  const [minX, minY, vbWidth, vbHeight] = viewBoxMatch[1].split(/\s+/).map(Number);

  // Calculate bleed in SVG units (72 DPI = standard PostScript points)
  const bleedUnits = bleedInches * 72;

  // Expand viewBox by bleed on all sides
  const newMinX = minX - bleedUnits;
  const newMinY = minY - bleedUnits;
  const newVbWidth = vbWidth + bleedUnits * 2;
  const newVbHeight = vbHeight + bleedUnits * 2;

  let result = svgContent;

  // Update viewBox
  result = result.replace(
    /viewBox="[^"]+"/,
    `viewBox="${newMinX} ${newMinY} ${newVbWidth} ${newVbHeight}"`,
  );

  // Update width/height attributes if present
  if (widthMatch) {
    const wNum = parseFloat(widthMatch[1]);
    if (!isNaN(wNum)) {
      const unit = widthMatch[1].replace(/[\d.]+/, "");
      result = result.replace(
        /width="[^"]+"/,
        `width="${wNum + bleedUnits * 2}${unit}"`,
      );
    }
  }
  if (heightMatch) {
    const hNum = parseFloat(heightMatch[1]);
    if (!isNaN(hNum)) {
      const unit = heightMatch[1].replace(/[\d.]+/, "");
      result = result.replace(
        /height="[^"]+"/,
        `height="${hNum + bleedUnits * 2}${unit}"`,
      );
    }
  }

  // Wrap all content in a group translated by the bleed offset
  result = result.replace(
    /(<svg[^>]*>)/,
    `$1\n<!-- Cut file with ${bleedInches}" bleed on all edges -->\n<g transform="translate(${bleedUnits}, ${bleedUnits})">`,
  );
  result = result.replace(/<\/svg>/, "</g>\n</svg>");

  // Add a dashed magenta cut line rectangle at the original element boundary
  const cutLine = `<rect x="${bleedUnits}" y="${bleedUnits}" width="${vbWidth}" height="${vbHeight}" fill="none" stroke="#FF00FF" stroke-width="0.5" stroke-dasharray="4,4" opacity="0.5"/>`;
  result = result.replace(
    /<\/g>\n<\/svg>/,
    `</g>\n${cutLine}\n</svg>`,
  );

  return result;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      renderUrl,
      designName,
      vehicleYear,
      vehicleMake,
      vehicleModel,
      visualizationId,
    } = body;

    if (!renderUrl) {
      return new Response(
        JSON.stringify({ error: "renderUrl is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- Authenticate ---
    const authHeader = req.headers.get("authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    let userId: string | null = null;
    if (authHeader) {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      userId = user?.id || null;
    }

    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Authentication required" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // --- API Keys (pool of up to 5 for rate-limit resilience) ---
    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "Gemini API key not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    console.log(`  API keys loaded: ${geminiKeyCount()}`);

    const vehicleStr = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");

    console.log("\n======================================================");
    console.log("  CUT FILE GENERATOR v1.2 (VTracer WASM)");
    console.log("======================================================");
    console.log(`  Vehicle: ${vehicleStr}`);
    console.log(`  Design: ${designName || "(unnamed)"}`);
    console.log(`  Render: ${renderUrl}`);
    console.log(`  Bleed: ${BLEED_INCHES}" on all edges`);
    console.log(`  Vectorizer: VTracer WASM (visioncortex, no external API)`);
    console.log("======================================================\n");

    // --- Fetch the branded render image ---
    // The render is only a Gemini REFERENCE (elements are re-rendered/vectorized,
    // not pixel-lifted from it), so pull storage sources through the image
    // transform at 2000px — a raw post-ESRGAN artwork base64s to a huge Gemini
    // payload and can OOM the worker. Raw URL stays the non-storage fallback.
    console.log("[STEP 1] Fetching branded render...");
    const renderFetchUrl = String(renderUrl).includes("/storage/v1/object/")
      ? String(renderUrl).replace("/storage/v1/object/", "/storage/v1/render/image/") + (String(renderUrl).includes("?") ? "&" : "?") + "width=2000&height=2000&resize=contain&quality=85"
      : renderUrl;
    let renderResponse = await fetch(renderFetchUrl, {
      headers: { "User-Agent": "Deno/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!renderResponse.ok && renderFetchUrl !== renderUrl) {
      renderResponse = await fetch(renderUrl, {
        headers: { "User-Agent": "Deno/1.0" },
        signal: AbortSignal.timeout(15_000),
      });
    }

    if (!renderResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to fetch render image: HTTP ${renderResponse.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const renderMimeType = renderResponse.headers.get("content-type") || "image/png";
    const renderBuffer = await renderResponse.arrayBuffer();
    const renderBase64 = uint8ArrayToBase64(new Uint8Array(renderBuffer));
    console.log(`  Render loaded: ${(renderBuffer.byteLength / 1024).toFixed(0)}KB (${renderMimeType})`);

    // --- Extract text/logo elements via Gemini ---
    console.log("\n[STEP 2] Extracting text/logo elements via Gemini...");
    const elements = await extractElements(renderBase64, renderMimeType);

    if (elements.length === 0) {
      return new Response(
        JSON.stringify({
          error: "No text or logo elements found on this render. Cut files are only available for commercial wraps with branding.",
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    console.log(`\n  Extracted ${elements.length} element(s)`);

    // --- Vectorize each element locally + add bleed ---
    console.log("\n[STEP 3] Vectorizing elements locally (VTracer WASM)...");
    const zip = new JSZip();
    const pngsFolder = zip.folder("pngs")!;
    const svgsFolder = zip.folder("svgs")!;
    const cutFilesFolder = zip.folder("cut-files-with-bleed")!;

    const manifest: Array<{
      label: string;
      pngFile: string;
      svgFile: string;
      cutFile: string;
      vectorized: boolean;
    }> = [];

    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const safeName = el.label.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
      const pngFileName = `${String(i + 1).padStart(2, "0")}_${safeName}.png`;
      const svgFileName = `${String(i + 1).padStart(2, "0")}_${safeName}.svg`;
      const cutFileName = `${String(i + 1).padStart(2, "0")}_${safeName}_cut.svg`;

      // Add PNG to ZIP
      const pngBytes = base64ToUint8Array(el.base64);
      pngsFolder.file(pngFileName, pngBytes);

      // Vectorize PNG → SVG (local VTracer WASM, no API call)
      const svgContent = await vectorizePng(pngBytes, el.label);

      let vectorized = false;
      if (svgContent) {
        svgsFolder.file(svgFileName, svgContent);

        // Add bleed to SVG for cut file
        const cutSvg = addBleedToSvg(svgContent, BLEED_INCHES);
        cutFilesFolder.file(cutFileName, cutSvg);
        vectorized = true;
      }

      manifest.push({
        label: el.label,
        pngFile: `pngs/${pngFileName}`,
        svgFile: vectorized ? `svgs/${svgFileName}` : "(vectorization failed)",
        cutFile: vectorized ? `cut-files-with-bleed/${cutFileName}` : "(vectorization failed)",
        vectorized,
      });
    }

    // --- Add manifest and instructions ---
    const metadata = {
      version: "1.2",
      generator: "RestylePro Cut File Generator",
      vectorizer: "VTracer WASM (visioncortex, local, no external API)",
      generatedAt: new Date().toISOString(),
      vehicle: vehicleStr,
      designName: designName || "Custom Design",
      bleedInches: BLEED_INCHES,
      sourceRenderUrl: renderUrl,
      elements: manifest,
      totalElements: elements.length,
      vectorizedCount: manifest.filter(m => m.vectorized).length,
    };

    zip.file("cut-files-manifest.json", JSON.stringify(metadata, null, 2));

    const instructions = `CUT FILES — ${designName || "Custom Design"}
================================================================
Vehicle: ${vehicleStr}
Generated: ${new Date().toISOString()}
================================================================

CONTENTS:
  pngs/          — Isolated text/logo elements as transparent PNGs
  svgs/          — Vector versions of each element (SVG format)
  cut-files-with-bleed/ — SVG cut paths with ${BLEED_INCHES}" bleed on all edges

ELEMENTS EXTRACTED:
${manifest.map((m, i) => `  ${i + 1}. ${m.label} ${m.vectorized ? "✓" : "✗ (PNG only)"}`).join("\n")}

CUT FILE INSTRUCTIONS:
  1. Cut files include ${BLEED_INCHES}" bleed on all edges (magenta dashed line = trim line)
  2. Import SVG cut files into your vinyl cutter software (Roland CutStudio, Graphtec, etc.)
  3. Align cut path registration marks with printed output
  4. Cut on the OUTSIDE of the dashed trim line for full bleed coverage
  5. Weed excess vinyl after cutting

PRINT + CUT WORKFLOW:
  1. Print the branded vehicle wrap using standard production files
  2. Use these cut files to contour-cut text and logo elements
  3. Layer cut elements on top of base wrap for dimensional effect
  4. Or use for standalone decal/sticker production

FILE FORMATS:
  PNG — Raster, transparent background, use for print or digital
  SVG — Vector paths, scalable without quality loss, use for cutting
  SVG (cut) — Same as SVG but with ${BLEED_INCHES}" bleed added to all edges
`;

    zip.file("CUT-FILE-INSTRUCTIONS.txt", instructions);

    // --- Generate ZIP + Upload ---
    console.log("\n[STEP 4] Packaging ZIP...");
    const zipBuffer = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    });
    console.log(`  ZIP: ${(zipBuffer.byteLength / 1024).toFixed(0)}KB`);

    const serviceClient = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const timestamp = Date.now();
    const storagePath = `cut-files/${userId}/${visualizationId || timestamp}/cut-files-${timestamp}.zip`;

    const { error: uploadError } = await serviceClient.storage
      .from("wrap-files")
      .upload(storagePath, zipBuffer, {
        contentType: "application/zip",
        upsert: true,
      });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: `Failed to upload: ${uploadError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: urlData } = serviceClient.storage
      .from("wrap-files")
      .getPublicUrl(storagePath);

    const downloadUrl = urlData?.publicUrl || "";
    console.log(`  Uploaded: ${downloadUrl}`);

    // ── Create panelizer_jobs entry so logo packs appear in ProductionFlow + QC ──
    try {
      const { data: logoJob, error: logoJobErr } = await serviceClient
        .from("panelizer_jobs")
        .insert({
          user_id: userId,
          generation_id: visualizationId || null,
          status: "ready",
          job_type: "logo_pack",
          approved_render_url: renderUrl,
          vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
          vehicle_make: vehicleMake || null,
          vehicle_model: vehicleModel || null,
          concept_json: {
            type: "logo_pack",
            elements_extracted: elements.length,
            vectorized_count: manifest.filter(m => m.vectorized).length,
            design_name: designName || "Custom Design",
          },
          zip_storage_path: storagePath,
          zip_signed_url: downloadUrl,
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (logoJobErr) {
        console.warn("Failed to create panelizer_jobs entry for logo pack:", logoJobErr.message);
      } else {
        console.log(`  Logo pack job created: ${logoJob.id} (${logoJob.order_number})`);
      }
    } catch (jobInsertErr) {
      console.warn("panelizer_jobs insert error (non-fatal):", jobInsertErr);
    }

    console.log("\n======================================================");
    console.log("  CUT FILE GENERATOR v1.1 COMPLETE");
    console.log(`  Elements: ${elements.length}`);
    console.log(`  Vectorized: ${manifest.filter(m => m.vectorized).length}`);
    console.log(`  ZIP: ${(zipBuffer.byteLength / 1024).toFixed(0)}KB`);
    console.log("======================================================\n");

    return new Response(
      JSON.stringify({
        success: true,
        downloadUrl,
        elementCount: elements.length,
        vectorizedCount: manifest.filter(m => m.vectorized).length,
        manifest,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error("generate-cut-files error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Cut file generation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
