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

    const bleed = bleed_inches ?? 0.5;
    const rollW = roll_width_inches ?? 59.5;
    const panelW = side_width_inches + bleed * 2;
    const panelH = rollW + bleed * 2;
    const dpi = 150;
    const scale = 0.1;
    const pxW = Math.round(panelW * dpi * scale);
    const pxH = Math.round(panelH * dpi * scale);

    // Compute simplified aspect ratio
    function gcd(a: number, b: number): number {
      a = Math.round(a * 10);
      b = Math.round(b * 10);
      while (b) { const t = b; b = a % b; a = t; }
      return a;
    }
    const g = gcd(side_width_inches, rollW);
    const ratioW = Math.round(side_width_inches * 10) / g;
    const ratioH = Math.round(rollW * 10) / g;

    const systemPrompt = `You are a vehicle wrap production specialist. Convert 3D vehicle renders into FLAT panel specs.
Panel: ${side_width_inches}" × ${rollW}" for ${vehicle_name}.
Aspect ratio: ${ratioW}:${ratioH}.
Pixels: ${pxW}×${pxH} at ${dpi}DPI ${scale * 100}% scale.
Return ONLY valid JSON, no markdown, no backticks.`;

    const userPrompt = `Analyze this vehicle wrap render image. List every visible design element with precise inch positions on the flat production panel.

Coordinate system:
- x=0 is front of vehicle, x=${side_width_inches} is rear
- y=0 is roofline, y=${rollW} is rocker panel

Return this exact JSON structure:
{
  "panel_width_inches": ${side_width_inches},
  "panel_height_inches": ${rollW},
  "background": {
    "colors": ["#hex1", "#hex2"],
    "direction": "left-to-right"
  },
  "elements": [
    {
      "type": "logo|text|shape|stripe|image_area",
      "description": "what it is",
      "content": "actual text if text element",
      "x_inches": 0,
      "y_inches": 0,
      "w_inches": 0,
      "h_inches": 0,
      "color": "#hex"
    }
  ],
  "color_palette": {
    "primary": "#hex",
    "secondary": "#hex",
    "accent": "#hex",
    "palette": ["#hex1", "#hex2", "#hex3"]
  }
}`;

    // Handle base64 data URL
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

    console.log("Approach 1 raw response length:", aiText.length);

    // Parse JSON from response (handle markdown fences)
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
      JSON.stringify({ success: true, approach: "ai-flat-panel", data: panelData }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Error in panel-lab-approach-1:", error);
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
