import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageData } = await req.json();

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log("Analyzing vehicle image with Gemini API...");

    const systemPrompt = `You are a vehicle identification expert. Analyze images of vehicles and extract:
- Vehicle Make (manufacturer brand)
- Vehicle Model (specific model name)
- Vehicle Year (if visible from body style/design, otherwise return empty string)
- Primary Color (the main wrap/paint color)
- Finish Type (gloss, matte, satin, or metallic)

Return ONLY valid JSON in this exact format:
{
  "make": "Ford",
  "model": "Raptor",
  "year": "2022",
  "color": "Blue",
  "finish": "gloss"
}

If you cannot identify something with confidence, use an empty string "". Be specific with make/model (e.g., "Ford F-150 Raptor" should be Make: "Ford", Model: "Raptor").`;

    const userPrompt = "Analyze this vehicle image and identify the make, model, year (if determinable), color, and finish type.";

    // Extract base64 from data URL if present
    let mimeType = 'image/png';
    let base64Data = imageData;
    if (imageData.startsWith('data:')) {
      const matches = imageData.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        mimeType = matches[1];
        base64Data = matches[2];
      }
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: systemPrompt + "\n\n" + userPrompt },
            { inlineData: { mimeType, data: base64Data } }
          ]
        }],
        generationConfig: {
          temperature: 0.1
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      throw new Error(`Gemini API returned ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const aiResponse = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    console.log("AI raw response:", aiResponse);

    // Parse the JSON response
    let vehicleData;
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = aiResponse.match(/```json\n([\s\S]*?)\n```/) || 
                       aiResponse.match(/```\n([\s\S]*?)\n```/) ||
                       [null, aiResponse];
      vehicleData = JSON.parse(jsonMatch[1] || aiResponse);
    } catch (parseError) {
      console.error("Failed to parse AI response as JSON:", parseError);
      throw new Error("AI response was not valid JSON");
    }

    console.log("Extracted vehicle data:", vehicleData);

    return new Response(
      JSON.stringify({ 
        success: true,
        data: {
          make: vehicleData.make || "",
          model: vehicleData.model || "",
          year: vehicleData.year || "",
          color: vehicleData.color || "",
          finish: vehicleData.finish || "gloss"
        }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error("Error in analyze-vehicle-image:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error occurred"
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
