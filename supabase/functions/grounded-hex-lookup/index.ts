// grounded-hex-lookup — Gemini + Google Search grounded hex lookup for vinyl films.
//
// Targets the manufacturer_colors table. Use when a row has finish/name correct
// but official_hex is NULL (or wrong) and you want a real value from the
// manufacturer's color card or a reputable shop reference.
//
// Input (JSON body):
//   { manufacturer: string,
//     official_name: string,
//     series?: string,                  // optional — helps Gemini find the right SKU
//     row_id?: string,                  // manufacturer_colors.id (required if update=true)
//     update?: boolean (default false)  // when true, writes official_hex back to the row
//   }
//
// Output (JSON body):
//   { hex: "#RRGGBB" | null,
//     confidence: "high"|"medium"|"low"|null,
//     confidence_int: 100|70|40|0,
//     reasoning: string,
//     source_urls: string[],
//     model: string,
//     updated: boolean,
//     update_error: string | null }
//
// Model: gemini-2.5-pro (better grounded reasoning than 2.5-flash for niche
// product lookups). Returns hex=null with confidence=null when Gemini cannot
// find an authoritative value — no fabrication.
//
// DB write uses service role; hex_source is tagged "gemini_grounded" so these
// rows are distinguishable from manually-curated hexes. hex_confidence is
// stored as integer (100/70/40/0).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-pro";

function stripFences(text: string): string {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, "");
  t = t.replace(/\s*```\s*$/i, "");
  return t.trim();
}

function confidenceToInt(c: string | null | undefined): number {
  switch ((c || "").toLowerCase()) {
    case "high":   return 100;
    case "medium": return 70;
    case "low":    return 40;
    default:       return 0;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const { manufacturer, official_name, series, row_id, update = false } = body;
  if (!manufacturer || !official_name) {
    return new Response(JSON.stringify({ error: "manufacturer and official_name required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const apiKey = Deno.env.get("GOOGLE_AI_API_KEY");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const seriesTag = series ? ` (series: ${series})` : "";
  const prompt = `Find the official hex color code for this real vinyl wrap film by searching the web for the manufacturer's color card or product page.

Manufacturer: ${manufacturer}
Color:        ${official_name}${seriesTag}

If the manufacturer publishes CMYK or RGB instead of hex, convert to hex.
If the provided series number does not match the color name on the manufacturer's site, prefer the name match and ignore the wrong series.
Keep the reasoning to ONE short sentence so the response fits the token budget.

Return ONLY this JSON — no markdown fences:
{"hex":"#RRGGBB"|null,"confidence":"high"|"medium"|"low"|null,"reasoning":"one short sentence","source_urls":["url1","url2"]}`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  let geminiText: string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 2048 },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return new Response(JSON.stringify({ error: `Gemini ${res.status}`, detail: errText.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const data = await res.json();
    geminiText = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
  } catch (e) {
    return new Response(JSON.stringify({ error: `Gemini fetch failed: ${(e as Error).message}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const cleaned = stripFences(geminiText);
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return new Response(JSON.stringify({ error: "Could not parse Gemini response", raw: geminiText.slice(0, 1500) }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  let parsed: any;
  try { parsed = JSON.parse(jsonMatch[0]); }
  catch (e) {
    return new Response(JSON.stringify({ error: "Invalid JSON from Gemini", raw: jsonMatch[0].slice(0, 1500), parseError: (e as Error).message }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const hex = parsed?.hex && /^#[0-9A-Fa-f]{6}$/.test(parsed.hex) ? parsed.hex.toUpperCase() : null;
  const confidenceStr: string | null = parsed?.confidence ?? null;
  let updated = false;
  let updateError: string | null = null;

  if (update && row_id && hex) {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceKey) {
      updateError = "missing SUPABASE_URL or SERVICE_ROLE_KEY in fn env";
    } else {
      const supabase = createClient(supabaseUrl, serviceKey);
      const { error } = await supabase
        .from("manufacturer_colors")
        .update({
          official_hex: hex,
          hex_source: "gemini_grounded",
          hex_confidence: confidenceToInt(confidenceStr),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row_id);
      if (error) updateError = error.message;
      else updated = true;
    }
  }

  return new Response(JSON.stringify({
    hex,
    confidence: confidenceStr,
    confidence_int: confidenceToInt(confidenceStr),
    reasoning: parsed?.reasoning ?? "",
    source_urls: Array.isArray(parsed?.source_urls) ? parsed.source_urls : [],
    model: GEMINI_MODEL,
    updated,
    update_error: updateError,
  }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
