/**
 * get-vehicle-recommendation — Vehicle Size Recommendation API
 *
 * Looks up a vehicle's dimensions from the vehicle_dimensions table and
 * returns the recommended WePrintWraps universal panel size plus pricing.
 *
 * POST /get-vehicle-recommendation
 * Body: { make: "Ford", model: "F-150", year?: 2022 }
 *
 * Response: {
 *   found: true,
 *   vehicle: "2006-2011 Ford F-150",
 *   total_sqft: 310,
 *   side_width: 218,
 *   recommended_size: "XL",
 *   recommended_size_label: "Extra Large",
 *   side_dimensions: { width: 240, height: 59.5 },
 *   price_cents: 99000,
 *   hood_dimensions: { width: 72, height: 59.5 },
 *   hood_sqft: 18.3,
 *   roof_dimensions: { width: 110, height: 59.5, recommended_roof_size: "M" },
 *   roof_sqft: 34,
 *   all_sizes: [ ... ],
 *   roof_sizes: [ ... ],
 *   message: "Based on your Ford F-150, we recommend XL for full coverage."
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Size mapping: side_width → recommended universal panel size
const SIZE_TIERS = [
  { code: "S", label: "Small", maxWidth: 144, panelWidth: 144, panelHeight: 59.5, priceCents: 60000 },
  { code: "M", label: "Medium", maxWidth: 172, panelWidth: 172, panelHeight: 59.5, priceCents: 71000 },
  { code: "L", label: "Large", maxWidth: 200, panelWidth: 200, panelHeight: 59.5, priceCents: 82500 },
  { code: "XL", label: "Extra Large", maxWidth: 999, panelWidth: 240, panelHeight: 59.5, priceCents: 99000 },
];

const ROOF_TIERS = [
  { code: "S", label: "Roof Small", maxLength: 72, panelWidth: 72, panelHeight: 59.5, priceCents: 16000 },
  { code: "M", label: "Roof Medium", maxLength: 110, panelWidth: 110, panelHeight: 59.5, priceCents: 22500 },
  { code: "L", label: "Roof Large", maxLength: 999, panelWidth: 160, panelHeight: 59.5, priceCents: 33000 },
];

function getRecommendedSize(sideWidth: number) {
  for (const tier of SIZE_TIERS) {
    if (sideWidth <= tier.maxWidth) return tier;
  }
  return SIZE_TIERS[SIZE_TIERS.length - 1]; // XL fallback
}

function getRecommendedRoofSize(roofLength: number | null) {
  if (!roofLength || roofLength <= 0) return null;
  for (const tier of ROOF_TIERS) {
    if (roofLength <= tier.maxLength) return tier;
  }
  return ROOF_TIERS[ROOF_TIERS.length - 1]; // Large fallback
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { make, model, year } = await req.json();

    if (!make || !model) {
      return new Response(
        JSON.stringify({ error: "make and model are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Try exact match on make + model
    let query = supabase
      .from("vehicle_dimensions")
      .select("*")
      .ilike("make", make.trim())
      .ilike("model", model.trim());

    const { data: vehicles, error } = await query;

    if (error) {
      console.error("DB query error:", error);
      throw new Error("Failed to look up vehicle dimensions");
    }

    let match = null;

    if (vehicles && vehicles.length > 0) {
      // If year provided, find best match within year range
      if (year) {
        const yearNum = parseInt(year);
        match = vehicles.find(
          (v: any) =>
            v.year_start && v.year_end &&
            yearNum >= v.year_start && yearNum <= v.year_end
        );
        // If no year range match, take the closest
        if (!match) {
          match = vehicles[0];
        }
      } else {
        // No year — take first match (most common)
        match = vehicles[0];
      }
    }

    // 2. If no exact match, try fuzzy (ILIKE with %)
    if (!match) {
      const { data: fuzzy } = await supabase
        .from("vehicle_dimensions")
        .select("*")
        .ilike("make", `%${make.trim()}%`)
        .ilike("model", `%${model.trim()}%`)
        .limit(5);

      if (fuzzy && fuzzy.length > 0) {
        if (year) {
          const yearNum = parseInt(year);
          match = fuzzy.find(
            (v: any) =>
              v.year_start && v.year_end &&
              yearNum >= v.year_start && yearNum <= v.year_end
          ) || fuzzy[0];
        } else {
          match = fuzzy[0];
        }
      }
    }

    // 3. Not found
    if (!match) {
      return new Response(
        JSON.stringify({
          found: false,
          message: `We don't have dimensions for the ${year ? year + " " : ""}${make} ${model} yet. Please select a size manually based on your vehicle's side length, or contact support for help.`,
          all_sizes: SIZE_TIERS.map((t) => ({
            code: t.code,
            label: t.label,
            panel_width: t.panelWidth,
            panel_height: t.panelHeight,
            price_cents: t.priceCents,
          })),
          roof_sizes: ROOF_TIERS.map((t) => ({
            code: t.code,
            label: t.label,
            panel_width: t.panelWidth,
            price_cents: t.priceCents,
          })),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Build recommendation
    const sideWidth = match.side_width || 172; // Default to medium if null
    const recommended = getRecommendedSize(sideWidth);
    const roofRec = getRecommendedRoofSize(match.roof_length);
    const vehicleLabel = `${match.year_range ? match.year_range + " " : ""}${match.make} ${match.model}`;

    return new Response(
      JSON.stringify({
        found: true,
        vehicle: vehicleLabel,
        total_sqft: match.total_sqft || match.corrected_sqft,
        corrected_sqft: match.corrected_sqft,
        side_width: sideWidth,
        side_height: match.side_height,
        side_sqft: match.side_sqft,
        recommended_size: recommended.code,
        recommended_size_label: recommended.label,
        side_dimensions: {
          width: recommended.panelWidth,
          height: recommended.panelHeight,
        },
        price_cents: recommended.priceCents,
        hood_sqft: match.hood_sqft,
        hood_dimensions: { width: 72, height: 59.5 },
        hood_price_cents: 16000,
        front_bumper_dimensions: { width: 120.5, height: 38 },
        front_bumper_price_cents: 20000,
        rear_plus_bumper_dimensions: {
          rear: { width: 72.5, height: 59 },
          bumper: { width: 120, height: 38 },
        },
        rear_plus_bumper_price_cents: 39500,
        roof_sqft: match.roof_sqft,
        roof_length: match.roof_length,
        roof_dimensions: roofRec
          ? {
              width: roofRec.panelWidth,
              height: roofRec.panelHeight,
              recommended_roof_size: roofRec.code,
              recommended_roof_label: roofRec.label,
              price_cents: roofRec.priceCents,
            }
          : null,
        all_sizes: SIZE_TIERS.map((t) => ({
          code: t.code,
          label: t.label,
          panel_width: t.panelWidth,
          panel_height: t.panelHeight,
          price_cents: t.priceCents,
          is_recommended: t.code === recommended.code,
        })),
        roof_sizes: ROOF_TIERS.map((t) => ({
          code: t.code,
          label: t.label,
          panel_width: t.panelWidth,
          price_cents: t.priceCents,
          is_recommended: roofRec ? t.code === roofRec.code : false,
        })),
        message: `Based on your ${vehicleLabel}, we recommend ${recommended.label} (${recommended.panelWidth}" × ${recommended.panelHeight}") for full side coverage.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("get-vehicle-recommendation error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
