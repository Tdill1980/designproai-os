import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { manufacturer, colorName } = await req.json();
    
    if (!manufacturer || !colorName) {
      return new Response(
        JSON.stringify({ error: "Missing manufacturer or colorName" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log(`Fetching hex for: ${manufacturer} - ${colorName}`);

    const systemPrompt = `You are a vinyl wrap film color database expert. Your job is to return the EXACT official hex color code that represents a specific vinyl wrap film color from a manufacturer's color chart.

RULES:
- Only return colors from ACTUAL manufacturer color charts (3M, Avery Dennison, Hexis, KPMF, Oracal, Arlon, VViViD, TeckWrap, Inozetek, etc.)
- DO NOT GUESS or approximate colors
- If you are not 100% certain of the exact hex code, return "NOT_FOUND"
- Respond ONLY with a hex code like #RRGGBB - no extra text, no explanation
- Consider the full color name including any finish descriptors (Gloss, Matte, Satin, Metallic, etc.)`;

    const userPrompt = `What is the exact hex color code for this vinyl wrap film?

Manufacturer: ${manufacturer}
Film Color Name: ${colorName}

Return ONLY the hex code (e.g., #1A2B3C) or "NOT_FOUND" if you cannot determine the exact color.`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: systemPrompt + "\n\n" + userPrompt }]
        }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 20
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ hex: "NOT_FOUND", error: "Gemini API error" }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    
    console.log(`AI returned: ${content} for ${manufacturer} - ${colorName}`);

    // Validate hex format
    const hexMatch = content.match(/^#[0-9A-Fa-f]{6}$/);
    if (hexMatch) {
      return new Response(
        JSON.stringify({ hex: hexMatch[0].toUpperCase() }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ hex: "NOT_FOUND" }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in get-vinyl-hex:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ hex: "NOT_FOUND", error: errorMessage }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
