/**
 * backfill-grounded-hex — Replaces AI-guessed / missing manufacturer_colors
 * hexes with REAL values from Gemini + Google Search grounding.
 *
 * The render (generate-color-render) treats manufacturer_colors as the
 * authoritative color source and overrides with official_hex. Today 557 rows
 * are hex_source='ai_guessed' (literally invented) and 144 verified rows have
 * no hex at all — so the render renders a guessed color. This function drains
 * those rows in batches, grounding each via the manufacturer's color card /
 * product page, and writes:
 *   - found:    official_hex + hex_source='gemini_grounded' + hex_confidence
 *               + grounded_description / grounded_base_color / grounded_effect
 *   - not found: hex_source='gemini_unverified' (so it's excluded next run and
 *               distinguishable from a trusted value) — official_hex untouched.
 *
 * Same grounding contract as grounded-hex-lookup: never fabricates a hex.
 *
 * Trigger server-side (Gemini is reachable from the edge runtime):
 *   select net.http_post(
 *     url := '.../functions/v1/backfill-grounded-hex',
 *     headers := jsonb_build_object('Content-Type','application/json','apikey',<anon>),
 *     body := '{"limit":8}'::jsonb);
 *
 * Body params (all optional):
 *   limit            number  rows per invocation (default 8)
 *   dryRun           boolean ground + report, do NOT write (default false)
 *   includeGuessed   boolean also re-ground hex_source='ai_guessed' (default true)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-2.5-pro";

function confidenceToInt(c: string | null | undefined): number {
  switch ((c || "").toLowerCase()) {
    case "high": return 100;
    case "medium": return 70;
    case "low": return 40;
    default: return 0;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface GroundResult {
  hex: string | null;
  confidence: string | null;
  description: string;
  baseColor: string;
  effect: string;
}

async function groundColor(manufacturer: string, name: string, series?: string, productCode?: string): Promise<GroundResult> {
  const apiKey = getGeminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const tags = [series ? `series: ${series}` : "", productCode ? `product code: ${productCode}` : ""].filter(Boolean).join(", ");
  const prompt = `Find the official hex color code for this REAL vinyl wrap film by searching the web for the manufacturer's color card or product page.

Manufacturer: ${manufacturer}
Color:        ${name}${tags ? ` (${tags})` : ""}

If the manufacturer publishes CMYK or RGB instead of hex, convert to hex. If the provided series/code does not match the color name on the manufacturer's site, prefer the name match. Do NOT invent a value — return hex as null with confidence "low" when you cannot find an authoritative color. Keep reasoning to ONE short sentence.

Return ONLY this JSON (no markdown fences):
{"hex":"#RRGGBB"|null,"confidence":"high"|"medium"|"low","description":"2-3 sentences on the film's exact color, finish, and any metallic/pearl/color-shift effect on a vehicle","baseColor":"primary color","effect":"gloss|matte|satin|metallic|chrome|pearl|color-shift|carbon-fiber|brushed-metal"}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || "").join("") || "";
  const jsonMatch = text.replace(/```(?:json)?/gi, "").match(/\{[\s\S]*\}/);
  let parsed: any = {};
  if (jsonMatch) { try { parsed = JSON.parse(jsonMatch[0]); } catch { /* ignore */ } }

  const hex = parsed?.hex && /^#[0-9A-Fa-f]{6}$/.test(parsed.hex) ? parsed.hex.toUpperCase() : null;
  return {
    hex,
    confidence: parsed?.confidence ?? null,
    description: parsed?.description || "",
    baseColor: parsed?.baseColor || "",
    effect: parsed?.effect || "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(parseInt(body.limit, 10) || 8, 1), 25);
    const dryRun = body.dryRun === true;
    const includeGuessed = body.includeGuessed !== false;

    if (!hasGeminiKey()) {
      return new Response(JSON.stringify({ error: "GOOGLE_AI_API_KEY not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Rows the render trusts but that aren't real: missing hex, or AI-guessed.
    // Exclude anything already processed by grounding (grounded / unverified).
    const sources = includeGuessed ? ["ai_guessed"] : [];
    let query = supabase
      .from("manufacturer_colors")
      .select("id, manufacturer, official_name, series, product_code")
      .eq("is_verified", true)
      .not("hex_source", "in", "(gemini_grounded,gemini_unverified)");

    if (includeGuessed) {
      query = query.or(`official_hex.is.null,hex_source.in.(${sources.join(",")})`);
    } else {
      query = query.is("official_hex", null);
    }

    const { data: rows, error } = await query.limit(limit);
    if (error) {
      return new Response(JSON.stringify({ error: error.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { count: remainingBefore } = await supabase
      .from("manufacturer_colors")
      .select("id", { count: "exact", head: true })
      .eq("is_verified", true)
      .not("hex_source", "in", "(gemini_grounded,gemini_unverified)")
      .or(includeGuessed ? `official_hex.is.null,hex_source.in.(${sources.join(",")})` : "official_hex.is.null");

    const results: any[] = [];
    let grounded = 0, unverified = 0, failed = 0;

    for (const row of rows || []) {
      try {
        const g = await groundColor(row.manufacturer, row.official_name, row.series, row.product_code);
        const found = !!g.hex;

        if (!dryRun) {
          const update: any = found
            ? {
                official_hex: g.hex,
                hex_source: "gemini_grounded",
                hex_confidence: confidenceToInt(g.confidence),
                updated_at: new Date().toISOString(),
              }
            : {
                hex_source: "gemini_unverified",
                hex_confidence: 0,
                updated_at: new Date().toISOString(),
              };
          if (g.description) update.grounded_description = g.description;
          if (g.baseColor) update.grounded_base_color = g.baseColor;
          if (g.effect) update.grounded_effect = g.effect;

          const { error: upErr } = await supabase.from("manufacturer_colors").update(update).eq("id", row.id);
          if (upErr) { failed++; results.push({ id: row.id, name: `${row.manufacturer} ${row.official_name}`, error: upErr.message }); continue; }
        }

        if (found) grounded++; else unverified++;
        results.push({
          id: row.id,
          name: `${row.manufacturer} ${row.official_name}`,
          hex: g.hex,
          confidence: g.confidence,
          effect: g.effect,
          action: found ? "grounded" : "unverified",
        });
      } catch (e) {
        failed++;
        results.push({ id: row.id, name: `${row.manufacturer} ${row.official_name}`, error: (e as Error).message });
      }
      await sleep(500); // ease Gemini grounding rate limits
    }

    return new Response(JSON.stringify({
      success: true,
      dryRun,
      batch: rows?.length || 0,
      grounded,
      unverified,
      failed,
      remaining_before_run: remainingBefore ?? null,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
