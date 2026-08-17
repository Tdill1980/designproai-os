import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_base64, vehicle_name, side_width_inches, roll_width_inches, bleed_inches } =
      await req.json();

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    if (!image_base64 || !vehicle_name || !side_width_inches) {
      throw new Error("Missing required fields: image_base64, vehicle_name, side_width_inches");
    }

    const rollW = roll_width_inches ?? 59.5;
    const dpi = 150;
    const scale = 0.1;
    const pxW = Math.round((side_width_inches + 1) * dpi * scale);
    const pxH = Math.round((rollW + 1) * dpi * scale);

    const systemPrompt = `You are a wrap production engineer. Decompose vehicle renders into ZONES for mathematical recomposition.
Panel: ${side_width_inches}" × ${rollW}" for ${vehicle_name}.
Pixels: ${pxW}×${pxH}.
Return ONLY valid JSON, no markdown, no backticks.`;

    const userPrompt = `Break this vehicle wrap design into zones (BACKGROUND, ACCENT_BAND, LOGO_ZONE, TEXT_ZONE, IMAGE_ZONE) with precise inch coordinates. A math engine will create a blank canvas at the exact pixel dimensions and composite these zones in order.

Coordinate system:
- x=0 is front of vehicle, x=${side_width_inches} is rear
- y=0 is roofline, y=${rollW} is rocker panel

Return this exact JSON structure:
{
  "panel_inches": { "w": ${side_width_inches}, "h": ${rollW} },
  "zones": [
    {
      "type": "BACKGROUND|ACCENT_BAND|LOGO_ZONE|TEXT_ZONE|IMAGE_ZONE",
      "description": "what it contains",
      "bounds_inches": { "x": 0, "y": 0, "w": 0, "h": 0 },
      "style": { "colors": ["#hex"], "type": "solid|gradient" },
      "text_content": "if text zone",
      "z_index": 1
    }
  ],
  "composition_order": ["zone_1", "zone_2"],
  "color_extraction": {
    "dominant": "#hex",
    "palette": ["#hex1", "#hex2", "#hex3"]
  }
}`;

    let mimeType = "image/png";
    let base64Data = image_base64;
    if (image_base64.startsWith("data:")) {
      const matches = image_base64.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`;

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt + "\n\n" + userPrompt },
              { inlineData: { mimeType, data: base64Data } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1 },
      }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      throw new Error(`Gemini API returned ${response.status}`);
    }

    const data = await response.json();
    const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      throw new Error("No text response from Gemini");
    }

    console.log("Approach 3 raw response length:", aiText.length);

    let panelData;
    try {
      const jsonMatch =
        aiText.match(/```json\n([\s\S]*?)\n```/) ||
        aiText.match(/```\n([\s\S]*?)\n```/) ||
        [null, aiText];
      panelData = JSON.parse(jsonMatch[1] || aiText);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", parseError);
      console.error("Raw text:", aiText.substring(0, 500));
      throw new Error("AI response was not valid JSON");
    }

    return new Response(
      JSON.stringify({ success: true, approach: "hybrid-zones", data: panelData }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in panel-lab-approach-3:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  }
});
