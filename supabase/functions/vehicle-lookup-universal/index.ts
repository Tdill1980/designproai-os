/**
 * vehicle-lookup-universal — Dedicated lookup for non-standard vehicles.
 *
 * Separate from the car-only vehicle-lookup edge function. This is called by
 * the NonStandardVehicleLookup UI component when the user clicks Boat,
 * Motorcycle, Bus, or RV in the VehicleTypeSelector and hits "Look Up".
 *
 * Uses resolveUniversalVehicleSpecs() which has:
 *   - Class-specific Google-grounding prompts (asks for LOA/beam for boats, etc.)
 *   - Class-specific sanity ranges (boats can be 700" long, motorcycles 130", etc.)
 *   - Class-specific panel estimators (hull_side_sq_ft for boats, tank_sq_ft for bikes)
 *   - Caching in vehicle_specs_universal table with requires_validation flag
 *
 * Request:  { vehicleClass, make, model, year }
 * Response: { source, vehicle: { make, model, year, vehicle_class, sub_type,
 *             total_sq_ft, corr_sq_ft, dimensions, panels, confidence,
 *             requires_validation, source_urls } }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  resolveUniversalVehicleSpecs,
  type VehicleClass,
} from "../_shared/vehicle-specs-universal.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_CLASSES: VehicleClass[] = [
  "motorcycle",
  "boat",
  "bus",
  "rv",
];

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { vehicleClass, make, model, year } = await req.json();

    if (!vehicleClass || !ALLOWED_CLASSES.includes(vehicleClass)) {
      return new Response(
        JSON.stringify({
          error: `vehicleClass must be one of: ${ALLOWED_CLASSES.join(", ")}`,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!make || !model) {
      return new Response(
        JSON.stringify({ error: "make and model are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const sb = createClient(supabaseUrl, supabaseKey);

    const specs = await resolveUniversalVehicleSpecs(
      sb,
      vehicleClass as VehicleClass,
      (year || "").trim(),
      make.trim(),
      model.trim(),
    );

    return new Response(
      JSON.stringify({
        source: specs.cached ? "cache" : "lookup",
        vehicle: {
          make: specs.make,
          model: specs.model,
          year: specs.year,
          vehicle_class: specs.vehicle_class,
          sub_type: specs.sub_type,
          total_sq_ft: specs.panels.total_sq_ft,
          corr_sq_ft: Math.round(specs.panels.total_sq_ft * 1.1 * 10) / 10,
          dimensions: specs.dimensions,
          panels: specs.panels,
          confidence: specs.confidence,
          requires_validation: specs.requires_validation,
          source_urls: specs.source_urls,
          specs_id: specs.id,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("vehicle-lookup-universal error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Vehicle lookup failed. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
