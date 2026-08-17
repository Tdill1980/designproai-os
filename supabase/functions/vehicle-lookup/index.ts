/**
 * vehicle-lookup — Gemini + Google Search grounding for unknown vehicles.
 *
 * Flow:
 *   1. Client sends { make, model, year }
 *   2. Function checks vehicle_measurements_custom table first (cache)
 *   3. If cached → return immediately
 *   4. If not → call Gemini with Google Search grounding to find:
 *      - wheelbase, overall length, width, height (inches)
 *   5. Scale from those dimensions to panel sq ft using ratios derived
 *      from the 1,664-vehicle measurement database
 *   6. Insert into vehicle_measurements_custom (cache for next time)
 *   7. Return the measurements
 *
 * Scaling algorithm:
 *   From analysis of the CSV database, typical ratios are:
 *     side_sq_ft  ≈ (length × height) / 144 × 0.42   (two sides counted separately)
 *     back_sq_ft  ≈ (width × height) / 144 × 0.55
 *     hood_sq_ft  ≈ (width × 0.30 × length_hood) / 144   (hood ~30% of overall length for sedans)
 *     roof_sq_ft  ≈ (width × 0.55 × roof_length) / 144   (roof ~55% of width, ~35% of length)
 *     total_sq_ft = sides×2 + back + hood + roof
 *     corr_sq_ft  = total × 1.10  (10% for bumpers, mirrors, trim)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Scaling algorithm ──────────────────────────────────────────────

interface VehicleDimensions {
  wheelbase_in: number;
  overall_length_in: number;
  overall_width_in: number;
  overall_height_in: number;
}

interface PanelEstimate {
  side_w: number;
  side_h: number;
  side_sq_ft: number;
  back_w: number;
  back_h: number;
  back_sq_ft: number;
  hood_w: number;
  hood_l: number;
  hood_sq_ft: number;
  roof_w: number;
  roof_l: number;
  roof_sq_ft: number;
  total_sq_ft: number;
  corr_sq_ft: number;
}

function estimatePanels(d: VehicleDimensions): PanelEstimate {
  const { overall_length_in: L, overall_width_in: W, overall_height_in: H } = d;

  // Side panel: length × usable height (~75% of overall height above wheel wells)
  const side_w = Math.round(L * 0.92); // visible side ≈ 92% of overall length
  const side_h = Math.round(H * 0.52); // wrappable area ≈ 52% of height (above rocker, below roof)
  const side_sq_ft = Math.round((side_w * side_h) / 144 * 10) / 10;

  // Back panel: width × back height
  const back_w = Math.round(W * 0.88); // wrappable width ≈ 88%
  const back_h = Math.round(H * 0.58);
  const back_sq_ft = Math.round((back_w * back_h) / 144 * 10) / 10;

  // Hood: width × hood length (~25% of overall length)
  const hood_w = Math.round(W * 0.82);
  const hood_l = Math.round(L * 0.25);
  const hood_sq_ft = Math.round((hood_w * hood_l) / 144 * 10) / 10;

  // Roof: width × roof length (~33% of overall length)
  const roof_w = Math.round(W * 0.78);
  const roof_l = Math.round(L * 0.33);
  const roof_sq_ft = Math.round((roof_w * roof_l) / 144 * 10) / 10;

  // Total: sides × 2 + back + hood + roof
  const total_sq_ft = Math.round((side_sq_ft * 2 + back_sq_ft + hood_sq_ft + roof_sq_ft) * 10) / 10;
  // Corrected: +10% for bumpers, mirrors, door jambs, trim
  const corr_sq_ft = Math.round(total_sq_ft * 1.10 * 10) / 10;

  return {
    side_w, side_h, side_sq_ft,
    back_w, back_h, back_sq_ft,
    hood_w, hood_l, hood_sq_ft,
    roof_w, roof_l, roof_sq_ft,
    total_sq_ft, corr_sq_ft,
  };
}

// ── Gemini grounding call ──────────────────────────────────────────

async function lookupVehicleDimensions(
  make: string,
  model: string,
  year: string,
  apiKey: string,
): Promise<{ dims: VehicleDimensions; raw: unknown }> {
  const prompt = `Find the exact exterior dimensions for a ${year || "latest model year"} ${make} ${model}.

I need these measurements in INCHES (convert from mm if needed):
1. Wheelbase (inches)
2. Overall length (inches)
3. Overall width WITHOUT mirrors (inches)
4. Overall height (inches)

Return ONLY a JSON object with these exact keys, no other text:
{"wheelbase_in": NUMBER, "overall_length_in": NUMBER, "overall_width_in": NUMBER, "overall_height_in": NUMBER}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 2048,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || "")
      .join("") || "";

  // Extract JSON from the response (may have markdown fences)
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (!jsonMatch) {
    throw new Error(`Could not parse dimensions from Gemini response: ${text.slice(0, 200)}`);
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const dims: VehicleDimensions = {
    wheelbase_in: Number(parsed.wheelbase_in) || 0,
    overall_length_in: Number(parsed.overall_length_in) || 0,
    overall_width_in: Number(parsed.overall_width_in) || 0,
    overall_height_in: Number(parsed.overall_height_in) || 0,
  };

  // Sanity check — reject obviously wrong values
  if (dims.overall_length_in < 100 || dims.overall_length_in > 350) {
    throw new Error(`Implausible length: ${dims.overall_length_in}in for ${make} ${model}`);
  }
  if (dims.overall_width_in < 50 || dims.overall_width_in > 100) {
    throw new Error(`Implausible width: ${dims.overall_width_in}in for ${make} ${model}`);
  }

  return { dims, raw: data };
}

// ── Main handler ───────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { make, model, year } = await req.json();

    if (!make || !model) {
      return new Response(
        JSON.stringify({ error: "make and model are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const makeTrimmed = make.trim();
    const modelTrimmed = model.trim();
    const yearTrimmed = (year || "").trim();

    // Supabase client (service role for writes)
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://kfapjdyythzyvnpdeghu.supabase.co";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const sb = createClient(supabaseUrl, supabaseKey);

    // 1. Check cache first
    const { data: cached } = await sb
      .from("vehicle_measurements_custom")
      .select("*")
      .ilike("make", makeTrimmed)
      .ilike("model", modelTrimmed)
      .limit(1)
      .maybeSingle();

    if (cached) {
      // Strip internal fields
      const safeCached = { ...cached };
      delete safeCached.raw_response;
      delete safeCached.wheelbase_in;
      delete safeCached.overall_length_in;
      delete safeCached.overall_width_in;
      delete safeCached.overall_height_in;
      delete safeCached.source;
      return new Response(
        JSON.stringify({ source: "cache", vehicle: safeCached }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // 2. Not cached — call Gemini with Google Search grounding
    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "Vehicle lookup service unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const apiKey = getGeminiKey();
    const { dims, raw } = await lookupVehicleDimensions(
      makeTrimmed,
      modelTrimmed,
      yearTrimmed,
      apiKey,
    );

    // 3. Scale dimensions to panel sq ft
    const panels = estimatePanels(dims);

    // 4. Save to cache
    const row = {
      make: makeTrimmed,
      model: modelTrimmed,
      year: yearTrimmed,
      ...panels,
      wheelbase_in: dims.wheelbase_in,
      overall_length_in: dims.overall_length_in,
      overall_width_in: dims.overall_width_in,
      overall_height_in: dims.overall_height_in,
      source: "lookup",
      raw_response: raw,
    };

    const { data: inserted, error: insertErr } = await sb
      .from("vehicle_measurements_custom")
      .upsert(row, { onConflict: "make,model,year" })
      .select()
      .single();

    if (insertErr) {
      console.error("Failed to cache vehicle:", insertErr.message);
    }

    // Strip internal fields before returning to client
    const safeVehicle = { ...(inserted || row) };
    delete safeVehicle.raw_response;
    delete safeVehicle.wheelbase_in;
    delete safeVehicle.overall_length_in;
    delete safeVehicle.overall_width_in;
    delete safeVehicle.overall_height_in;

    return new Response(
      JSON.stringify({
        source: "lookup",
        vehicle: safeVehicle,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("vehicle-lookup error:", err);
    return new Response(
      JSON.stringify({ error: "Vehicle lookup failed. Please try again." }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
