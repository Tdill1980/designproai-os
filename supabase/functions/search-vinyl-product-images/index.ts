/**
 * search-vinyl-product-images — Gemini + Google Search grounding lookup for a
 * real manufacturer vinyl film. Returns the GROUNDED appearance of the film
 * (accurate hex, finish, effect, description) plus the real web sources Gemini
 * used to ground the answer. No DataForSEO. No fabrication.
 *
 * Why grounding, not a guessed hex: Gemini's googleSearch tool answers from
 * live search results and returns the sources it relied on in
 * candidates[].groundingMetadata.groundingChunks. We surface that grounded
 * color data so the render reflects the ACTUAL film, and we return hex=null
 * (rather than inventing one) when no authoritative value can be found —
 * mirroring the no-fabrication contract of grounded-hex-lookup.
 *
 * Input:  { manufacturer, colorName, productCode? }
 * Output: {
 *   success, query,
 *   hex: "#RRGGBB" | null, confidence: "high"|"medium"|"low"|null,
 *   filmDescription, baseColor, effect, hasMetallicFlake, isColorShift,
 *   source_urls: string[],          // real grounding sources from Gemini
 *   photos: [{ url, title, source }],// grounding sources that look like images
 *   photoType, totalFound, searchGrounded
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GEMINI_MODEL = 'gemini-2.5-pro';

function looksLikeImageUrl(url: string): boolean {
  if (!url || typeof url !== 'string') return false;
  if (/\.(jpg|jpeg|png|webp|gif|bmp|tiff?)(\?.*)?$/i.test(url)) return true;
  return /googleusercontent\.com|cloudinary\.com|imgur\.com|\/images?\/|cdn\./i.test(url);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { manufacturer, colorName, productCode } = await req.json();

    if (!manufacturer || !colorName) {
      return new Response(
        JSON.stringify({ error: 'manufacturer and colorName are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: 'Google AI API key not configured', success: false, photos: [] }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const filmQuery = productCode
      ? `${manufacturer} ${productCode} ${colorName} vinyl wrap`
      : `${manufacturer} ${colorName} vinyl wrap`;

    console.log(`[search-vinyl] Gemini Google-grounded lookup: "${filmQuery}"`);

    const apiKey = getGeminiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

    const prompt = `Search the web for the REAL manufacturer vinyl wrap film below and describe exactly what it looks like on a vehicle. Use the manufacturer's color card / product page when possible.

Manufacturer: ${manufacturer}
Color/Product Name: ${colorName}${productCode ? `\nProduct Code: ${productCode}` : ''}

If the manufacturer publishes CMYK or RGB instead of hex, convert to hex. Do NOT invent a value — if you cannot find an authoritative color, return hex as null with confidence "low".

Return ONLY this JSON (no markdown fences):
{"hex":"#RRGGBB"|null,"confidence":"high"|"medium"|"low","filmDescription":"2-3 sentences on the exact color, finish, and any metallic flake / pearl / color-shift effect when applied to a vehicle","baseColor":"primary color","effect":"gloss|matte|satin|metallic|chrome|pearl|color-shift|carbon-fiber|brushed-metal","hasMetallicFlake":false,"isColorShift":false}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[search-vinyl] Gemini error ${res.status}: ${err.slice(0, 300)}`);
      return new Response(
        JSON.stringify({ error: `Grounded lookup failed: ${res.status}`, success: false, photos: [] }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const text = candidate?.content?.parts?.map((p: any) => p.text || '').join('') || '';

    // Real grounding sources Gemini relied on (proves the answer is grounded).
    const chunks = candidate?.groundingMetadata?.groundingChunks || [];
    const source_urls: string[] = chunks
      .map((c: any) => c?.web?.uri)
      .filter((u: any) => typeof u === 'string' && u.startsWith('http'));

    // Backward-compatible photos[]: grounding sources that resolve to images.
    const photos = source_urls
      .filter(looksLikeImageUrl)
      .slice(0, 3)
      .map((u) => ({ url: u, title: `${manufacturer} ${colorName}`, source: 'gemini_grounded' }));

    const jsonMatch = text.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
    let parsed: any = {};
    if (jsonMatch) {
      try { parsed = JSON.parse(jsonMatch[0]); } catch { /* fall through to raw text */ }
    }

    const hex = parsed?.hex && /^#[0-9A-Fa-f]{6}$/.test(parsed.hex) ? parsed.hex.toUpperCase() : null;

    console.log(`[search-vinyl] grounded hex=${hex || 'null'} (${parsed?.confidence || 'n/a'}), ${source_urls.length} sources, ${photos.length} image refs`);

    return new Response(
      JSON.stringify({
        success: true,
        query: filmQuery,
        hex,
        confidence: parsed?.confidence ?? null,
        filmDescription: parsed?.filmDescription || text.trim().slice(0, 600),
        baseColor: parsed?.baseColor || '',
        effect: parsed?.effect || '',
        hasMetallicFlake: parsed?.hasMetallicFlake || false,
        isColorShift: parsed?.isColorShift || false,
        source_urls,
        photos,
        photoType: photos.length > 0 ? 'product_sheet' : 'none',
        totalFound: photos.length,
        searchGrounded: true,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[search-vinyl] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
        photos: [],
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
