/**
 * film-grounding — Uses Gemini + Google Search to look up a real vinyl film
 * by manufacturer name and color name, then returns a structured description
 * of what that film actually looks like (color, finish, effect, appearance).
 *
 * Called BEFORE the render — the grounded film description flows into the
 * design-panel-ai-generate prompt so Gemini knows exactly what base film
 * the printed design sits on.
 *
 * This function is 100% standalone. Zero coupling to any existing render
 * pipeline functions.
 *
 * Input:  { manufacturer: "Avery Dennison", colorName: "Gold Chrome" }
 * Output: { filmDescription: "...", searchGrounded: true }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { manufacturer, colorName } = await req.json();

    if (!manufacturer || !colorName) {
      return new Response(
        JSON.stringify({ error: "manufacturer and colorName are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: "Film lookup service unavailable" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const filmQuery = `${manufacturer} ${colorName}`;
    console.log(`[film-grounding] Looking up: "${filmQuery}"`);

    // ── Gemini Flash + Google Search grounding ──────────────────────
    const apiKey = getGeminiKey();
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const prompt = `You are a vinyl wrap film expert. Look up this REAL manufacturer vinyl wrap film:

Manufacturer: ${manufacturer}
Color/Product Name: ${colorName}

Using your search results, describe EXACTLY what this film looks like when applied to a vehicle. Return ONLY a JSON object with these keys:

{
  "filmName": "Full product name as sold by manufacturer",
  "manufacturer": "Manufacturer brand name",
  "appearance": "2-3 sentence description of what the film looks like on a vehicle — color, reflectivity, effect, how light interacts with it",
  "baseColor": "Primary base color (e.g., gold, green, purple, silver)",
  "effect": "The film effect type: chrome | metallic | pearl | color-shift | matte | satin | gloss | carbon-fiber | brushed-metal",
  "isReflective": true/false,
  "isColorShift": true/false,
  "colorShiftDescription": "If color-shift, describe the shift (e.g., 'shifts from gold to green depending on viewing angle'). Empty string if not color-shift.",
  "printCompatibility": "Description of how printed ink would look layered over this film — does the base show through? What effect does it create?",
  "promptContext": "A single paragraph written for an AI image generator: describe what a printed vinyl wrap design would look like on this specific base film. Be specific about how the metallic/chrome/pearl base interacts with printed ink. This will be injected into a vehicle render prompt."
}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[film-grounding] Gemini error ${res.status}: ${err}`);
      return new Response(
        JSON.stringify({ error: `Film lookup failed: ${res.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const data = await res.json();
    const text =
      data?.candidates?.[0]?.content?.parts
        ?.map((p: any) => p.text || "")
        .join("") || "";

    // Extract JSON from response (may have markdown fences)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error(`[film-grounding] Could not parse JSON from: ${text.slice(0, 300)}`);
      // Fallback: return the raw text as a description
      return new Response(
        JSON.stringify({
          filmDescription: text.trim(),
          promptContext: `This design is printed on ${manufacturer} ${colorName} vinyl film. ${text.trim().slice(0, 500)}`,
          searchGrounded: true,
          parsed: false,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[film-grounding] Found: ${parsed.filmName || filmQuery} — ${parsed.effect || 'unknown effect'}`);

    return new Response(
      JSON.stringify({
        ...parsed,
        searchGrounded: true,
        parsed: true,
        query: filmQuery,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    console.error(`[film-grounding] Error:`, error);
    return new Response(
      JSON.stringify({ error: error.message || "Film lookup failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
