import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey } from "../_shared/gemini-key-pool.ts";

/**
 * MYVEHICLE COLOR GROUNDING — Edge Function
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 *
 * Grounds a film color selection with real-world reference data.
 *
 * Lookup priority:
 *   1. film_color_references (verified)   — trusted, fast, free
 *   2. film_color_references (user_upload) — trusted, fast, free
 *   3. manufacturer_colors.official_swatch_url — already in DB
 *   4. Google grounding search            — last resort
 *
 * Endpoints (via `action` field):
 *   "ground"    — lookup / search for a film color (default)
 *   "correct"   — write user correction (swatch + vehicle examples)
 *   "approve"   — promote a reference to 'verified'
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const action = body.action || "ground";

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    if (action === "ground") {
      return await handleGround(supabase, body);
    } else if (action === "correct") {
      return await handleCorrect(supabase, body);
    } else if (action === "approve") {
      return await handleApprove(supabase, body);
    }

    return new Response(
      JSON.stringify({ error: `Unknown action: ${action}` }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("myvehicle-color-grounding error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// ─── GROUND: Lookup or search for film color references ─────────────────────

async function handleGround(supabase: any, body: any) {
  const { manufacturer, filmName, sku, swatchId } = body;

  if (!filmName && !sku) {
    return new Response(
      JSON.stringify({ error: "filmName or sku required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("🔍 Grounding film color:", { manufacturer, filmName, sku });

  // ── Priority 1: film_color_references (verified first, then user_upload) ──
  const { data: refs } = await supabase
    .from("film_color_references")
    .select("*")
    .or(
      sku
        ? `sku.eq.${sku},film_name.ilike.%${filmName || ""}%`
        : `film_name.ilike.%${filmName}%`
    )
    .order("source", { ascending: false }); // 'verified' > 'user_upload' > 'google_grounding'

  // Sort: verified first, then user_upload, then google_grounding
  const sorted = (refs || []).sort((a: any, b: any) => {
    const priority: Record<string, number> = { verified: 0, user_upload: 1, google_grounding: 2 };
    return (priority[a.source] ?? 3) - (priority[b.source] ?? 3);
  });

  if (sorted.length > 0) {
    const best = sorted[0];
    console.log("✅ Found in film_color_references:", best.source, best.film_name);
    return new Response(
      JSON.stringify({
        source: best.source,
        filmName: best.film_name,
        manufacturer: best.manufacturer,
        sku: best.sku,
        swatchImageUrl: best.swatch_image_url,
        vehicleExampleUrls: best.vehicle_example_urls || [],
        referenceId: best.id,
        promptContext: `Apply ${best.manufacturer} ${best.film_name} (SKU ${best.sku || "N/A"}) — the actual manufactured vinyl film. Match the reference images provided. Do not interpret color numerically.`,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // ── Priority 2: manufacturer_colors official swatch ──
  if (swatchId) {
    const { data: mfgColor } = await supabase
      .from("manufacturer_colors")
      .select("official_swatch_url, name, manufacturer, product_code")
      .eq("id", swatchId)
      .maybeSingle();

    if (mfgColor?.official_swatch_url) {
      console.log("✅ Using manufacturer_colors official swatch:", mfgColor.name);
      return new Response(
        JSON.stringify({
          source: "manufacturer_swatch",
          filmName: mfgColor.name || filmName,
          manufacturer: mfgColor.manufacturer || manufacturer,
          sku: mfgColor.product_code || sku,
          swatchImageUrl: mfgColor.official_swatch_url,
          vehicleExampleUrls: [],
          referenceId: null,
          promptContext: `Apply ${mfgColor.manufacturer || manufacturer} ${mfgColor.name || filmName} (SKU ${mfgColor.product_code || sku || "N/A"}) — the actual manufactured vinyl film. Match the swatch reference image provided.`,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // ── Priority 3: Google grounding search (last resort) ──
  console.log("🌐 Falling back to Google grounding search...");
  const searchQuery = `${manufacturer || ""} ${filmName || ""} ${sku || ""} vinyl wrap on vehicle`;
  let referenceImageUrls: string[] = [];
  let promptContext = `Apply ${manufacturer || "manufacturer"} ${filmName || "film"} (SKU ${sku || "N/A"}) — the actual manufactured vinyl film.`;

  try {
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`;

    const geminiResponse = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `Find reference images of "${searchQuery}". Return a JSON object with: { "description": "brief visual description of this film color on a vehicle", "filmCharacteristics": "finish type, color shift properties, metallic/pearl notes" }. Be concise.` }],
        }],
        tools: [{ googleSearch: {} }],
        generationConfig: { responseMimeType: "text/plain" },
      }),
    });

    if (geminiResponse.ok) {
      const geminiData = await geminiResponse.json();
      const parts = geminiData.candidates?.[0]?.content?.parts || [];
      const groundingMeta = geminiData.candidates?.[0]?.groundingMetadata;

      // Extract text description
      let description = "";
      for (const part of parts) {
        if (part.text) description += part.text;
      }

      // Extract grounding source URLs as reference image candidates
      if (groundingMeta?.groundingChunks) {
        for (const chunk of groundingMeta.groundingChunks) {
          if (chunk.web?.uri) {
            referenceImageUrls.push(chunk.web.uri);
          }
        }
      }

      // Parse description for prompt context
      try {
        const jsonMatch = description.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          promptContext = `Apply ${manufacturer || "manufacturer"} ${filmName || "film"} (SKU ${sku || "N/A"}) — ${parsed.description || ""}. ${parsed.filmCharacteristics || ""}. Match the reference images provided. Do not interpret color numerically.`;
        }
      } catch {
        promptContext += ` ${description.slice(0, 200)}. Match the reference images provided.`;
      }

      console.log("✅ Google grounding returned", referenceImageUrls.length, "URLs");

      // Cache the grounding result in film_color_references
      if (filmName) {
        await supabase.from("film_color_references").insert({
          manufacturer: manufacturer || "Unknown",
          film_name: filmName,
          sku: sku || null,
          vehicle_example_urls: referenceImageUrls.slice(0, 5),
          source: "google_grounding",
        }).then(({ error }: any) => {
          if (error) console.warn("Failed to cache grounding result:", error.message);
          else console.log("✅ Cached grounding result for future lookups");
        });
      }
    }
  } catch (searchErr) {
    console.warn("Google grounding search failed:", searchErr);
  }

  return new Response(
    JSON.stringify({
      source: "google_grounding",
      filmName: filmName || null,
      manufacturer: manufacturer || null,
      sku: sku || null,
      swatchImageUrl: null,
      vehicleExampleUrls: referenceImageUrls.slice(0, 5),
      referenceId: null,
      promptContext,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ─── CORRECT: Write user correction (swatch + vehicle examples) ─────────────

async function handleCorrect(supabase: any, body: any) {
  const { manufacturer, filmName, sku, swatchImageUrl, vehicleExampleUrls, userId, notes } = body;

  if (!filmName) {
    return new Response(
      JSON.stringify({ error: "filmName required for correction" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("📝 Writing color correction:", { manufacturer, filmName, sku });

  // Upsert: if same manufacturer+film_name+sku exists, update it
  const matchConditions: any = { film_name: filmName };
  if (manufacturer) matchConditions.manufacturer = manufacturer;
  if (sku) matchConditions.sku = sku;

  // Check for existing
  let query = supabase.from("film_color_references").select("id").eq("film_name", filmName);
  if (manufacturer) query = query.eq("manufacturer", manufacturer);
  if (sku) query = query.eq("sku", sku);
  const { data: existing } = await query.maybeSingle();

  let result;
  if (existing) {
    // Update existing
    const updateData: any = { source: "user_upload" };
    if (swatchImageUrl) updateData.swatch_image_url = swatchImageUrl;
    if (vehicleExampleUrls) updateData.vehicle_example_urls = vehicleExampleUrls;
    if (userId) updateData.approved_by = userId;

    result = await supabase
      .from("film_color_references")
      .update(updateData)
      .eq("id", existing.id)
      .select("id")
      .single();
  } else {
    // Insert new
    result = await supabase
      .from("film_color_references")
      .insert({
        manufacturer: manufacturer || "Unknown",
        film_name: filmName,
        sku: sku || null,
        swatch_image_url: swatchImageUrl || null,
        vehicle_example_urls: vehicleExampleUrls || [],
        source: "user_upload",
        approved_by: userId || null,
      })
      .select("id")
      .single();
  }

  if (result.error) {
    console.error("Failed to write correction:", result.error);
    return new Response(
      JSON.stringify({ error: result.error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("✅ Correction saved:", result.data.id);
  return new Response(
    JSON.stringify({ success: true, referenceId: result.data.id }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

// ─── APPROVE: Promote reference to 'verified' ──────────────────────────────

async function handleApprove(supabase: any, body: any) {
  const { referenceId, userId, manufacturer, filmName, sku } = body;

  // Can approve by referenceId or by film identity
  if (referenceId) {
    const { error } = await supabase
      .from("film_color_references")
      .update({ source: "verified", approved_by: userId || null })
      .eq("id", referenceId);

    if (error) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ Reference promoted to verified:", referenceId);
  } else if (filmName) {
    // Find and promote by film identity
    let query = supabase.from("film_color_references").select("id").eq("film_name", filmName);
    if (manufacturer) query = query.eq("manufacturer", manufacturer);
    if (sku) query = query.eq("sku", sku);

    const { data: ref } = await query.maybeSingle();
    if (ref) {
      await supabase
        .from("film_color_references")
        .update({ source: "verified", approved_by: userId || null })
        .eq("id", ref.id);
      console.log("✅ Reference promoted to verified by film identity:", ref.id);
    } else {
      // No existing reference — create a verified one (user confirmed the render was good)
      await supabase.from("film_color_references").insert({
        manufacturer: manufacturer || "Unknown",
        film_name: filmName,
        sku: sku || null,
        source: "verified",
        approved_by: userId || null,
        vehicle_example_urls: [],
      });
      console.log("✅ Created new verified reference for:", filmName);
    }
  }

  return new Response(
    JSON.stringify({ success: true }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}
