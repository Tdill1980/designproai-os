import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import * as cheerio from "https://esm.sh/cheerio@1.0.0-rc.12";
import { brandOverrides, supportedBrands } from "../_shared/color-extractor-overrides/index.ts";
import { fetchPage } from "../_shared/color-extractor-utils.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default URLs for each brand
const brandUrls: Record<string, string> = {
  hexis: "https://www.hexisamericas.com/skintac/",
  avery: "https://www.averydennison.com/en/home/products/graphics-materials/vinyl-films/supreme-wrapping-film.html",
  "3m": "https://www.3m.com/3M/en_US/p/c/graphics-signage/films/wrap-films/",
  oracal: "https://www.oracal.com/en/products/wrapping-films/",
  inozetek: "https://inozetek.com/collections/super-gloss",
  kpmf: "https://www.kpmf.com/products/vehicle-wrapping-films/",
  arlon: "https://www.arlon.com/products/slx-cast-wrap",
  teckwrap: "https://teckwrap.com/collections/all-products",
  vvivid: "https://vvividshop.com/collections/vinyl-car-wrap",
  stek: "https://www.stekautomotive.com/products/color-ppf",
  carlas: "https://carlaspremium.com/collections/color-ppf",
  flexishield: "https://www.flexishieldusa.com/color-ppf",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brand, url, dryRun = false } = await req.json();

    if (!brand) {
      return new Response(
        JSON.stringify({ error: "Missing 'brand' parameter" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const normalizedBrand = brand.toLowerCase();

    if (!brandOverrides[normalizedBrand]) {
      return new Response(
        JSON.stringify({ 
          error: `Unsupported brand: ${brand}`,
          supportedBrands 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetUrl = url || brandUrls[normalizedBrand];

    if (!targetUrl) {
      return new Response(
        JSON.stringify({ error: `No URL provided and no default URL for brand: ${brand}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[seed-brand-colors] Seeding ${brand} from ${targetUrl}`);

    // Fetch and parse the page
    const html = await fetchPage(targetUrl);
    const $ = cheerio.load(html);

    // Run brand-specific extractor
    const extractedColors = await brandOverrides[normalizedBrand].parse($, targetUrl);

    console.log(`[seed-brand-colors] Extracted ${extractedColors.length} colors for ${brand}`);

    if (extractedColors.length === 0) {
      return new Response(
        JSON.stringify({
          brand,
          url: targetUrl,
          extracted: 0,
          inserted: 0,
          skipped: 0,
          message: "No colors extracted from this URL"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // If dry run, just return extracted colors without inserting
    if (dryRun) {
      return new Response(
        JSON.stringify({
          brand,
          url: targetUrl,
          dryRun: true,
          extracted: extractedColors.length,
          colors: extractedColors.slice(0, 20), // Preview first 20
          message: "Dry run - no database writes"
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabase = createExternalClient();

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Process each color
    for (const color of extractedColors) {
      if (!color.name || !color.manufacturer) {
        skipped++;
        continue;
      }

      // Check for duplicates
      const { data: existing } = await supabase
        .from('vinyl_swatches')
        .select('id')
        .eq('manufacturer', color.manufacturer)
        .eq('name', color.name)
        .maybeSingle();

      if (existing) {
        skipped++;
        continue;
      }

      // Determine color properties from name
      const nameLower = color.name.toLowerCase();
      const isMetallic = nameLower.includes('metallic') || nameLower.includes('metal');
      const isPearl = nameLower.includes('pearl');
      const isChrome = nameLower.includes('chrome') || nameLower.includes('mirror');
      const isPPF = color.series?.toLowerCase().includes('ppf') || 
                   color.manufacturer === 'STEK' || 
                   color.manufacturer === 'Carlas' ||
                   color.manufacturer === 'FlexiShield';

      // Insert new color
      const { error: insertError } = await supabase
        .from('vinyl_swatches')
        .insert({
          manufacturer: color.manufacturer,
          name: color.name,
          code: color.code || null,
          series: color.series || null,
          finish: color.finish || 'Gloss',
          hex: color.hex || '#888888',
          color_type: color.colorType || 'solid',
          metallic: isMetallic,
          pearl: isPearl,
          chrome: isChrome,
          ppf: isPPF,
          media_url: color.swatchUrl || color.imageUrl || null,
          source: 'seeded',
          verified: true,
          ai_confidence: 0.9,
          last_verified_at: new Date().toISOString(),
        });

      if (insertError) {
        errors.push(`Failed to insert ${color.name}: ${insertError.message}`);
        skipped++;
      } else {
        inserted++;
      }
    }

    console.log(`[seed-brand-colors] Completed: ${inserted} inserted, ${skipped} skipped`);

    return new Response(
      JSON.stringify({
        brand,
        url: targetUrl,
        extracted: extractedColors.length,
        inserted,
        skipped,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        message: `Successfully seeded ${inserted} colors for ${brand}`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[seed-brand-colors] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
