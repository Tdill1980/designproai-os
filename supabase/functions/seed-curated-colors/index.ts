// Seed Curated Colors - Seeds all 12 brand datasets to vinyl_swatches table
// This function uses hardcoded curated data instead of web scraping

import { createExternalClient } from "../_shared/external-db.ts";
import { brandDatasets, getAllColors, getColorsByBrand, getDatasetStats, SeedColorEntry } from "../_shared/seed-data/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brand, dryRun = false, seedAll = false } = await req.json();

    // Initialize Supabase client
    const supabase = createExternalClient();

    let colorsToSeed: SeedColorEntry[] = [];

    // Get colors based on request type
    if (seedAll) {
      colorsToSeed = getAllColors();
      console.log(`[seed-curated-colors] Seeding ALL brands: ${colorsToSeed.length} colors`);
    } else if (brand) {
      colorsToSeed = getColorsByBrand(brand);
      console.log(`[seed-curated-colors] Seeding brand "${brand}": ${colorsToSeed.length} colors`);
      
      if (colorsToSeed.length === 0) {
        return new Response(
          JSON.stringify({
            success: false,
            error: `Brand "${brand}" not found. Supported brands: ${Object.keys(brandDatasets).join(", ")}`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Return stats if no brand specified
      const stats = getDatasetStats();
      return new Response(
        JSON.stringify({
          success: true,
          message: "No brand specified. Provide 'brand' or 'seedAll: true'",
          supportedBrands: Object.keys(brandDatasets),
          stats,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Dry run mode - return preview without inserting
    if (dryRun) {
      return new Response(
        JSON.stringify({
          success: true,
          dryRun: true,
          totalColors: colorsToSeed.length,
          preview: colorsToSeed.slice(0, 20),
          brands: [...new Set(colorsToSeed.map(c => c.manufacturer))],
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Seed to database
    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const color of colorsToSeed) {
      try {
        // Check if color already exists (by manufacturer + name + code)
        const { data: existing } = await supabase
          .from("vinyl_swatches")
          .select("id")
          .eq("manufacturer", color.manufacturer)
          .eq("name", color.name)
          .maybeSingle();

        if (existing) {
          skipped++;
          continue;
        }

        // Insert new color
        const { error: insertError } = await supabase
          .from("vinyl_swatches")
          .insert({
            manufacturer: color.manufacturer,
            series: color.series,
            name: color.name,
            code: color.code,
            finish: color.finish,
            color_type: color.color_type,
            metallic: color.metallic,
            pearl: color.pearl,
            chrome: color.chrome,
            ppf: color.ppf,
            hex: color.hex || "#000000", // Default hex required by schema
            verified: true,
            source: "seeded",
          });

        if (insertError) {
          errors.push(`${color.manufacturer} ${color.name}: ${insertError.message}`);
        } else {
          inserted++;
        }
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${color.manufacturer} ${color.name}: ${errMsg}`);
      }
    }

    console.log(`[seed-curated-colors] Complete: ${inserted} inserted, ${skipped} skipped, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        totalProcessed: colorsToSeed.length,
        inserted,
        skipped,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
        errorCount: errors.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[seed-curated-colors] Error:", errMsg);
    return new Response(
      JSON.stringify({ success: false, error: errMsg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
