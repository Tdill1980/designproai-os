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

    const systemPrompt = `You are a vehicle wrap designer working FLAT FIRST.
Design directly on a flat canvas: ${side_width_inches}" × ${rollW}" for ${vehicle_name}.
Pixels: ${pxW}×${pxH}.
X-axis: 0" = front of vehicle, ${side_width_inches}" = rear.
Y-axis: 0" = roofline, ${rollW}" = rocker panel.
Return ONLY valid JSON, no markdown, no backticks.`;

    const userPrompt = `Analyze this vehicle wrap reference image and lay out every design element in INCHES on the flat canvas. Think about where door seams, wheel wells, and body lines are on this specific ${vehicle_name}.

Return this exact JSON structure:
{
  "canvas_width_inches": ${side_width_inches},
  "canvas_height_inches": ${rollW},
  "background_layers": [
    { "colors": ["#hex"], "region": { "x": 0, "y": 0, "w": ${side_width_inches}, "h": ${rollW} } }
  ],
  "design_elements": [
    {
      "type": "logo|text|shape|stripe|decorative",
      "description": "what it is",
      "content": "text if applicable",
      "position": { "x_inches": 0, "y_inches": 0 },
      "size": { "w_inches": 0, "h_inches": 0 },
      "color": "#hex"
    }
  ],
  "color_palette": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "palette": ["#hex1", "#hex2"]
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

    console.log("Approach 2 raw response length:", aiText.length);

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
      JSON.stringify({ success: true, approach: "flat-first", data: panelData }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in panel-lab-approach-2:", error);
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
