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
    const { patternName, patternType, colors } = await req.json();
    
    if (!patternName) {
      return new Response(
        JSON.stringify({ error: "Missing patternName" }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error("GOOGLE_AI_API_KEY is not configured");
    }

    console.log(`Generating thumbnail for: ${patternName} (type: ${patternType})`);

    // Build prompt based on pattern type
    let prompt = "";
    if (patternType === "gradient" || patternType === "fade") {
      const colorList = colors?.join(" to ") || "black to transparent";
      prompt = `Generate a seamless gradient swatch tile showing a smooth ${colorList} gradient transition. The image should be a 512x512 square tile suitable for use as a design preview. Make it look like a professional vinyl wrap gradient sample with realistic texture.`;
    } else if (patternType === "camo" || patternType === "camouflage") {
      prompt = `Generate a seamless camouflage pattern tile named "${patternName}". Create a 512x512 square tile with realistic military-style camouflage pattern suitable for vehicle wraps. High quality, tileable texture.`;
    } else if (patternType === "carbon") {
      prompt = `Generate a seamless carbon fiber pattern tile. Create a 512x512 square tile showing realistic carbon fiber weave texture in dark colors. High quality automotive-grade appearance.`;
    } else if (patternType === "metallic" || patternType === "brushed") {
      prompt = `Generate a seamless brushed metal texture tile named "${patternName}". Create a 512x512 square tile showing realistic brushed aluminum or steel texture suitable for vehicle wraps.`;
    } else {
      prompt = `Generate a seamless pattern tile for a vehicle wrap design called "${patternName}". Create a 512x512 square tile that looks like a professional vinyl wrap pattern sample. Make it tileable and suitable for automotive applications.`;
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: prompt }]
        }],
        generationConfig: {
          responseModalities: ["TEXT", "IMAGE"],
          responseMimeType: "text/plain"
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API error:", response.status, errorText);
      return new Response(
        JSON.stringify({ error: "Failed to generate thumbnail" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const data = await response.json();

    // Extract image from Gemini response
    const parts = data.candidates?.[0]?.content?.parts;
    let imageUrl: string | null = null;

    if (parts && Array.isArray(parts)) {
      for (const part of parts) {
        if (part.inlineData) {
          const mimeType = part.inlineData.mimeType || 'image/png';
          imageUrl = `data:${mimeType};base64,${part.inlineData.data}`;
          break;
        }
      }
    }

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: "No image generated" }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Generated thumbnail for: ${patternName}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        imageUrl,
        patternName 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error("Error in generate-pattern-thumbnail:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
