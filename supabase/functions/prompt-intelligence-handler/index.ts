/**
 * prompt-intelligence-handler
 *
 * Pre-render middleware that enriches user prompts before passing them
 * to design-panel-ai-generate. When the user provides a short/vague prompt
 * and no VisionBoard images, this handler:
 *
 *   1. Uses Gemini Flash to interpret the concept and expand it into
 *      specific wrap design language (colors, elements, composition, mood).
 *   2. Searches the web for 2-3 visual reference images matching the concept.
 *   3. Passes the enriched prompt + reference images into
 *      design-panel-ai-generate via its existing `prompt` and
 *      `visionBoardImages` fields.
 *
 * If enrichment fails for ANY reason, the original prompt passes through
 * unchanged — same behavior as today.
 *
 * DOES NOT modify any locked render pipeline files.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ---------------------------------------------------------------------------
// Prompt enrichment via Gemini Flash — interprets concept, expands to wrap spec
// ---------------------------------------------------------------------------

interface EnrichmentResult {
  enrichedPrompt: string;
  searchQueries: string[];
  conceptBreakdown: string;
}

async function enrichPromptWithFlash(
  rawPrompt: string,
  vehicle: string,
  finish: string
): Promise<EnrichmentResult | null> {
  try {
    const systemPrompt = `You are a senior vehicle wrap designer interpreting a client's creative brief. The client typed a short description and you need to expand it into specific, actionable wrap design language.

RULES:
- Output ONLY valid JSON, no markdown fences, no explanation
- Keep the enriched prompt under 400 characters
- Translate pop culture references into VISUAL DESIGN ELEMENTS (shapes, colors, textures, patterns, composition)
- NEVER use trademarked names, character names, or brand names in the enriched prompt
- NEVER use phrases like "award-winning", "car magazine", "DUB", "Super Street", "indistinguishable from a photograph"
- Focus on: color palette, design elements, composition flow, mood/atmosphere, texture, background environment
- Add 1-2 creative elements the client didn't mention but would elevate the design
- Provide 2-3 short web search queries to find visual reference images of similar wrap styles or art concepts

Example input: "two faced joker wrap"
Example output:
{
  "enrichedPrompt": "A dramatic split-design wrap — left side sleek dark purple with clean lines, right side chaotic acid green with cracked texture and paint splatter effects. Scattered hand-scrawled 'HA HA HA' text in scratchy graffiti style across the chaotic half. Gothic cityscape silhouette along the rocker panels. Playing card suit motifs as subtle repeating pattern. Split-face motif centered on the door panel. Dark atmospheric mood with neon accent highlights.",
  "searchQueries": ["joker themed vehicle wrap design", "split design car wrap purple green", "gothic comic style vehicle wrap"],
  "conceptBreakdown": "Split duality theme, purple/green palette, comic villain energy, urban gothic atmosphere"
}`;

    const userMessage = `Client vehicle: ${vehicle}
Finish: ${finish}
Client prompt: "${rawPrompt}"

Expand this into specific wrap design language and provide search queries for visual references. Output JSON only.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: systemPrompt + "\n\n" + userMessage }] },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            maxOutputTokens: 512,
            temperature: 0.7,
          },
        }),
        signal: AbortSignal.timeout(10_000), // 10s hard cap
      }
    );

    if (!response.ok) {
      console.warn(`[PIH] Flash enrichment HTTP ${response.status}`);
      return null;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      console.warn("[PIH] Flash returned no text");
      return null;
    }

    const parsed = JSON.parse(text);
    if (!parsed.enrichedPrompt || !parsed.searchQueries) {
      console.warn("[PIH] Flash JSON missing required fields");
      return null;
    }

    console.log(`[PIH] Enriched prompt: ${parsed.enrichedPrompt.length} chars`);
    console.log(`[PIH] Search queries: ${parsed.searchQueries.join(" | ")}`);
    console.log(`[PIH] Concept: ${parsed.conceptBreakdown || "n/a"}`);

    return {
      enrichedPrompt: parsed.enrichedPrompt.substring(0, 500), // Hard cap
      searchQueries: (parsed.searchQueries as string[]).slice(0, 3),
      conceptBreakdown: parsed.conceptBreakdown || "",
    };
  } catch (err) {
    console.warn("[PIH] Enrichment failed (non-fatal):", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Web image search via Google Custom Search API
// Falls back gracefully if no API key or no results
// ---------------------------------------------------------------------------

interface FoundImage {
  url: string;
  title: string;
}

async function searchForReferenceImages(
  queries: string[],
  maxImages: number = 3
): Promise<FoundImage[]> {
  const googleApiKey = Deno.env.get("GOOGLE_SEARCH_API_KEY");
  const searchEngineId = Deno.env.get("GOOGLE_SEARCH_ENGINE_ID");

  if (!googleApiKey || !searchEngineId) {
    console.log("[PIH] No Google Search API key — skipping image search");
    return [];
  }

  const found: FoundImage[] = [];

  for (const query of queries) {
    if (found.length >= maxImages) break;

    try {
      const params = new URLSearchParams({
        key: googleApiKey,
        cx: searchEngineId,
        q: query,
        searchType: "image",
        num: "3",
        safe: "active",
        imgSize: "large",
        imgType: "photo",
      });

      const response = await fetch(
        `https://www.googleapis.com/customsearch/v1?${params}`,
        { signal: AbortSignal.timeout(8_000) }
      );

      if (!response.ok) {
        console.warn(`[PIH] Image search HTTP ${response.status} for "${query}"`);
        continue;
      }

      const data = await response.json();
      const items = data.items || [];

      for (const item of items) {
        if (found.length >= maxImages) break;
        if (item.link && item.link.startsWith("http")) {
          found.push({ url: item.link, title: item.title || query });
        }
      }
    } catch (err) {
      console.warn(`[PIH] Image search error for "${query}":`, err);
    }
  }

  console.log(`[PIH] Found ${found.length} reference images`);
  return found;
}

// ---------------------------------------------------------------------------
// Fetch and convert images to base64 for Gemini multimodal input
// Reuses the same pattern as VisionBoard image fetching in design-panel-ai-generate
// ---------------------------------------------------------------------------

interface ImagePart {
  slotLabel: string;
  storageUrl: string;
  base64Data?: string;
  mimeType?: string;
}

async function fetchAndEncodeImages(
  images: FoundImage[]
): Promise<ImagePart[]> {
  const encoded: ImagePart[] = [];

  for (const img of images) {
    try {
      const response = await fetch(img.url, {
        headers: { "User-Agent": "RestylePro/1.0" },
        signal: AbortSignal.timeout(8_000),
        redirect: "follow",
      });

      if (!response.ok) {
        console.warn(`[PIH] Image fetch failed (${response.status}): ${img.url.substring(0, 80)}`);
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.startsWith("image/")) {
        console.warn(`[PIH] Not an image (${contentType}): ${img.url.substring(0, 80)}`);
        continue;
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // Skip images larger than 1MB to keep payload reasonable
      if (bytes.length > 1_048_576) {
        console.warn(`[PIH] Image too large (${(bytes.length / 1024).toFixed(0)}KB), skipping`);
        continue;
      }

      // Convert to base64
      let binaryString = "";
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
        binaryString += String.fromCharCode.apply(null, Array.from(chunk));
      }

      encoded.push({
        slotLabel: `ref_${encoded.length + 1}: ${img.title.substring(0, 50)}`,
        storageUrl: img.url,
        base64Data: btoa(binaryString),
        mimeType: contentType,
      });

      console.log(`[PIH] Encoded reference image (${(bytes.length / 1024).toFixed(0)}KB): ${img.title.substring(0, 60)}`);
    } catch (err) {
      console.warn(`[PIH] Image encode error:`, err);
    }
  }

  return encoded;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const body = await req.json();
    const {
      prompt,
      mode,
      finish = "Gloss",
      vehicleYear,
      vehicleMake,
      vehicleModel,
      visionBoardImages,
      skipEnrichment,
    } = body;

    // --- Pass-through conditions: skip enrichment, call design-panel-ai-generate directly ---
    const hasVisionBoard = Array.isArray(visionBoardImages) && visionBoardImages.length > 0;
    const promptIsLong = (prompt || "").length > 300;
    const shouldSkip = skipEnrichment === true || hasVisionBoard || promptIsLong || !prompt;

    if (shouldSkip) {
      const reason = !prompt
        ? "no prompt"
        : skipEnrichment
        ? "skipEnrichment flag"
        : hasVisionBoard
        ? "user uploaded VisionBoard images"
        : "prompt already detailed (>300 chars)";
      console.log(`[PIH] Skipping enrichment (${reason}) — passing through to design-panel-ai-generate`);
      return await callDesignPanelAiGenerate(req, body);
    }

    // --- Enrichment pipeline ---
    console.log(`[PIH] Starting prompt intelligence for: "${prompt.substring(0, 100)}..."`);

    if (!hasGeminiKey()) {
      console.warn("[PIH] No Gemini key — passing through raw prompt");
      return await callDesignPanelAiGenerate(req, body);
    }

    const vehicle = [vehicleYear, vehicleMake, vehicleModel]
      .filter(Boolean)
      .join(" ");

    // Step 1: Enrich prompt via Flash (~2-4s)
    const enrichment = await enrichPromptWithFlash(
      prompt,
      vehicle || "vehicle",
      finish
    );

    if (!enrichment) {
      console.log("[PIH] Enrichment failed — passing through raw prompt");
      return await callDesignPanelAiGenerate(req, body);
    }

    // Step 2: Search for reference images (~2-4s)
    const foundImages = await searchForReferenceImages(
      enrichment.searchQueries,
      3
    );

    // Step 3: Fetch and encode reference images (~1-3s)
    let referenceImageParts: ImagePart[] = [];
    if (foundImages.length > 0) {
      referenceImageParts = await fetchAndEncodeImages(foundImages);
    }

    // Step 4: Build enriched payload for design-panel-ai-generate
    const enrichedBody = { ...body };

    // Combine: user's original prompt + enriched design direction
    // Keep original intent visible, add the enrichment as design direction
    enrichedBody.prompt = `${prompt}\n\nDesign direction: ${enrichment.enrichedPrompt}`;

    // If we found reference images, inject them as VisionBoard images
    // design-panel-ai-generate already handles visionBoardImages array
    if (referenceImageParts.length > 0) {
      // Upload reference images to temp storage so they have URLs
      // that design-panel-ai-generate can fetch
      const tempRefs = await uploadTempReferences(referenceImageParts);
      if (tempRefs.length > 0) {
        enrichedBody.visionBoardImages = tempRefs;
        enrichedBody.visionboard_intent = "style_inspiration";
        console.log(`[PIH] Injected ${tempRefs.length} reference images as VisionBoard style_inspiration`);
      }
    }

    const enrichmentMs = Date.now() - startTime;
    console.log(`[PIH] Enrichment complete in ${enrichmentMs}ms — calling design-panel-ai-generate`);
    console.log(`[PIH] Original prompt: ${prompt.length} chars → Enriched: ${enrichedBody.prompt.length} chars`);
    console.log(`[PIH] Reference images: ${referenceImageParts.length}`);

    return await callDesignPanelAiGenerate(req, enrichedBody);
  } catch (err) {
    console.error("[PIH] Handler error:", err);

    // On any failure, try to pass through to design-panel-ai-generate
    try {
      const body = await req.clone().json();
      return await callDesignPanelAiGenerate(req, body);
    } catch {
      return new Response(
        JSON.stringify({ code: "SYSTEM_ERROR", message: "Prompt intelligence handler failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }
});

// ---------------------------------------------------------------------------
// Upload reference images to Supabase temp storage so design-panel-ai-generate
// can fetch them via URL (matching its existing VisionBoard image flow)
// ---------------------------------------------------------------------------

async function uploadTempReferences(
  images: ImagePart[]
): Promise<Array<{ slotLabel: string; storageUrl: string }>> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceKey) return [];

  const supabase = createClient(supabaseUrl, serviceKey);
  const refs: Array<{ slotLabel: string; storageUrl: string }> = [];

  for (const img of images) {
    if (!img.base64Data || !img.mimeType) continue;

    try {
      const ext =
        img.mimeType === "image/png"
          ? "png"
          : img.mimeType === "image/webp"
          ? "webp"
          : "jpg";
      const fileName = `temp/pih-refs/${Date.now()}_${refs.length}.${ext}`;

      // Decode base64 to binary
      const binaryString = atob(img.base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { error } = await supabase.storage
        .from("wrap-files")
        .upload(fileName, bytes, {
          contentType: img.mimeType,
          upsert: true,
        });

      if (error) {
        console.warn(`[PIH] Temp upload failed: ${error.message}`);
        continue;
      }

      const { data: urlData } = supabase.storage
        .from("wrap-files")
        .getPublicUrl(fileName);

      refs.push({
        slotLabel: img.slotLabel,
        storageUrl: urlData.publicUrl,
      });
    } catch (err) {
      console.warn("[PIH] Temp upload error:", err);
    }
  }

  return refs;
}

// ---------------------------------------------------------------------------
// Call design-panel-ai-generate internally (server-to-server)
// Forwards auth headers so the user session passes through
// ---------------------------------------------------------------------------

async function callDesignPanelAiGenerate(
  originalReq: Request,
  body: Record<string, unknown>
): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    return new Response(
      JSON.stringify({ code: "SYSTEM_ERROR", message: "Missing SUPABASE_URL" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const targetUrl = `${supabaseUrl}/functions/v1/design-panel-ai-generate`;

  // Forward auth headers from original request
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const authHeader = originalReq.headers.get("authorization");
  if (authHeader) headers["Authorization"] = authHeader;
  const apiKeyHeader = originalReq.headers.get("apikey");
  if (apiKeyHeader) headers["apikey"] = apiKeyHeader;

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000), // 2min — enough for 4-tier Gemini retry
    });

    // Stream the response back with CORS headers
    const responseBody = await response.text();
    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...corsHeaders,
        "Content-Type": response.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    console.error(`[PIH] design-panel-ai-generate ${isTimeout ? "timed out" : "failed"}:`, err);
    return new Response(
      JSON.stringify({
        code: "SYSTEM_ERROR",
        message: isTimeout
          ? "Render timed out — try again"
          : "Failed to reach render service",
      }),
      { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}
