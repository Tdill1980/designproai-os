// Universal Color Extractor Edge Function
// Extracts vinyl wrap colors from manufacturer websites

import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";
import { brandOverrides, supportedBrands } from "../_shared/color-extractor-overrides/index.ts";
import { fetchPage } from "../_shared/color-extractor-utils.ts";
import { ExtractionResult } from "../_shared/color-extractor-types.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brand, url } = await req.json();

    console.log(`[color-extractor] Request received - brand: ${brand}, url: ${url}`);

    // Validate inputs
    if (!brand || !url) {
      return new Response(
        JSON.stringify({
          error: "Missing required fields: brand and url",
          supportedBrands,
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if brand override exists
    const brandKey = brand.toLowerCase();
    if (!brandOverrides[brandKey]) {
      return new Response(
        JSON.stringify({
          error: `No override exists for brand: ${brand}`,
          supportedBrands,
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[color-extractor] Fetching page: ${url}`);

    // Fetch the page HTML
    const html = await fetchPage(url);
    console.log(`[color-extractor] Fetched ${html.length} bytes of HTML`);

    // Parse with Cheerio
    const $ = cheerio.load(html);

    // Call brand-specific parser
    console.log(`[color-extractor] Running ${brand} parser...`);
    const rawColors = await brandOverrides[brandKey].parse($, url);

    console.log(`[color-extractor] Extracted ${rawColors.length} colors`);

    // Build result (NO database writes in Phase 1-2)
    const result: ExtractionResult = {
      brand,
      extracted: rawColors.length,
      rawColors,
      message: rawColors.length > 0 
        ? `Successfully extracted ${rawColors.length} colors from ${brand}`
        : `No colors found. This brand override may be a stub or the page structure changed.`,
    };

    return new Response(
      JSON.stringify(result),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[color-extractor] Error:`, errorMessage);
    return new Response(
      JSON.stringify({
        error: errorMessage,
        supportedBrands,
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
