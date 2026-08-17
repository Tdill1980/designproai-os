import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
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
    const supabase = createExternalClient();

    if (!hasGeminiKey()) {
      return new Response(
        JSON.stringify({ error: 'AI service not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Helper to convert image URL to base64
    async function imageUrlToBase64(url: string): Promise<{ mimeType: string; data: string } | null> {
      try {
        if (url.startsWith('data:')) {
          const matches = url.match(/^data:([^;]+);base64,(.+)$/);
          if (matches) return { mimeType: matches[1], data: matches[2] };
          return null;
        }
        const response = await fetch(url);
        if (!response.ok) return null;
        const contentType = response.headers.get('content-type') || 'image/png';
        const arrayBuffer = await response.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        return { mimeType: contentType, data: base64 };
      } catch { return null; }
    }

    const { swatch_id, image_url, finish, hex } = await req.json();

    if (!swatch_id) {
      return new Response(
        JSON.stringify({ error: 'swatch_id is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔬 Extracting material profile for swatch:', swatch_id);

    // Get swatch data if not provided
    let swatchImageUrl = image_url;
    let swatchFinish = finish;
    let swatchHex = hex;

    if (!swatchImageUrl || !swatchFinish || !swatchHex) {
      const { data: swatchData, error: swatchError } = await supabase
        .from('vinyl_swatches')
        .select('*')
        .eq('id', swatch_id)
        .single();

      if (swatchError || !swatchData) {
        return new Response(
          JSON.stringify({ error: 'Swatch not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      swatchImageUrl = swatchImageUrl || swatchData.media_url;
      swatchFinish = swatchFinish || swatchData.finish;
      swatchHex = swatchHex || swatchData.hex;
    }

    if (!swatchImageUrl) {
      return new Response(
        JSON.stringify({ error: 'No image URL available for this swatch' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📸 Analyzing image: ${swatchImageUrl.substring(0, 60)}...`);

    const extractionPrompt = `You are an expert vinyl wrap color scientist. Analyze this vinyl wrap swatch image and extract precise material properties for accurate rendering.

Current data:
- Stated finish: ${swatchFinish}
- Stated hex: ${swatchHex}

Analyze the image and provide:

1. LAB COLOR VALUES - Convert the dominant color to CIE LAB color space:
   - L: Lightness (0-100)
   - a: Green-Red axis (-128 to +128)
   - b: Blue-Yellow axis (-128 to +128)

2. REFLECTIVITY (0-1):
   - 0.0 = completely matte, absorbs all light
   - 0.3 = satin, soft diffused reflection
   - 0.6 = semi-gloss, moderate reflection
   - 0.9 = high gloss, strong specular highlights
   - 1.0 = chrome/mirror, full reflection

3. METALLIC FLAKE DENSITY (0-1):
   - 0.0 = no metallic particles
   - 0.3 = subtle metallic shimmer
   - 0.6 = moderate metallic flake
   - 1.0 = heavy metallic/chrome particles

4. FINISH PROFILE object with:
   - highlight_softness (0-1): How soft/diffused are highlights
   - shadow_saturation_falloff (0-1): How much color desaturates in shadows
   - anisotropy (0-1): Directional reflection bias (brushed metal effect)
   - texture: Description of surface texture

Respond ONLY with valid JSON:
{
  "lab": { "L": <number>, "a": <number>, "b": <number> },
  "reflectivity": <number 0-1>,
  "metallic_flake": <number 0-1>,
  "finish_profile": {
    "highlight_softness": <number 0-1>,
    "shadow_saturation_falloff": <number 0-1>,
    "anisotropy": <number 0-1>,
    "texture": "<string description>"
  },
  "corrected_hex": "<hex if different from input>",
  "confidence": <number 0-1>,
  "notes": "<any observations about the material>"
}`;

    // Convert image to base64 for Gemini
    const imageData = await imageUrlToBase64(swatchImageUrl);
    if (!imageData) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch swatch image' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: extractionPrompt },
            { inlineData: { mimeType: imageData.mimeType, data: imageData.data } }
          ]
        }]
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Gemini API request failed:', errorText);
      return new Response(
        JSON.stringify({ error: 'AI analysis failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const content = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('Failed to extract JSON from AI response:', content);
      return new Response(
        JSON.stringify({ error: 'Invalid AI response format' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const materialProfile = JSON.parse(jsonMatch[0]);
    console.log('✅ Extracted material profile:', materialProfile);

    // Update vinyl_swatches with extracted data
    const updateData: any = {
      lab: materialProfile.lab,
      reflectivity: materialProfile.reflectivity,
      metallic_flake: materialProfile.metallic_flake,
      finish_profile: materialProfile.finish_profile,
      material_validated: true,
      updated_at: new Date().toISOString()
    };

    // Update hex if AI corrected it with high confidence
    if (materialProfile.corrected_hex && materialProfile.confidence >= 0.8) {
      updateData.hex = materialProfile.corrected_hex;
      console.log(`🎨 Correcting hex from ${swatchHex} to ${materialProfile.corrected_hex}`);
    }

    const { error: updateError } = await supabase
      .from('vinyl_swatches')
      .update(updateData)
      .eq('id', swatch_id);

    if (updateError) {
      console.error('Failed to update swatch:', updateError);
      return new Response(
        JSON.stringify({ error: 'Failed to save material profile' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ Material profile saved to database');

    return new Response(
      JSON.stringify({
        success: true,
        swatch_id,
        material_profile: materialProfile
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in extract-material-profile:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
