import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('3M Swatch Generator started - Method:', req.method);
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!hasGeminiKey()) {
      throw new Error('No Gemini API key configured');
    }

    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();

    // Fetch all 3M colors that need official swatch images
    const { data: colors, error: fetchError } = await supabase
      .from('manufacturer_colors')
      .select('*')
      .eq('manufacturer', '3M')
      .is('official_swatch_url', null);

    if (fetchError) throw fetchError;

    console.log(`Generating swatches for ${colors?.length || 0} 3M colors`);

    const results = [];

    for (const color of colors || []) {
      try {
        // Generate swatch image using AI
        const prompt = `Create a realistic 3M 2080 vinyl wrap swatch chip image in ${color.finish} finish. 
Color: ${color.official_hex}
Style: Professional automotive vinyl swatch with diagonal metallic highlight streak across the surface.
Finish characteristics:
- Gloss/High Gloss: Shiny reflective surface with bright highlight
- Matte: Flat non-reflective surface with subtle highlight
- Satin: Semi-gloss with soft metallic sheen
- Brushed: Linear brushed metal texture pattern
- Specialty: Unique texture (carbon fiber, psychedelic, etc.)

Create a rectangular swatch (800x600px) showing the ${color.official_hex} color in ${color.finish} finish with a diagonal light reflection streak from top-right to bottom-left, matching professional 3M vinyl swatch photography style.`;

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [{ text: prompt }]
            }],
            generationConfig: {
              responseModalities: ['TEXT', 'IMAGE'],
              responseMimeType: 'text/plain'
            }
          }),
        });

        if (!aiResponse.ok) {
          console.error(`Gemini API generation failed for ${color.name}`);
          continue;
        }

        const aiData = await aiResponse.json();

        // Extract image from Gemini response
        const parts = aiData.candidates?.[0]?.content?.parts;
        let base64Data: string | null = null;

        if (parts && Array.isArray(parts)) {
          for (const part of parts) {
            if (part.inlineData) {
              base64Data = part.inlineData.data;
              break;
            }
          }
        }

        if (!base64Data) {
          console.error(`No image generated for ${color.name}`);
          continue;
        }

        // Convert base64 to blob
        const byteCharacters = atob(base64Data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: 'image/png' });

        // Upload to Supabase Storage
        const fileName = `3m-${color.official_name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.png`;
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('swatches')
          .upload(`3m-2080/${fileName}`, blob, {
            contentType: 'image/png',
            upsert: true
          });

        if (uploadError) {
          console.error(`Upload failed for ${color.official_name}:`, uploadError);
          continue;
        }

        // Get public URL
        const { data: { publicUrl } } = supabase.storage
          .from('swatches')
          .getPublicUrl(`3m-2080/${fileName}`);

        // Update manufacturer_colors table with official swatch URL
        const { error: updateError } = await supabase
          .from('manufacturer_colors')
          .update({ official_swatch_url: publicUrl })
          .eq('id', color.id);

        if (updateError) {
          console.error(`Database update failed for ${color.official_name}:`, updateError);
          continue;
        }

        results.push({
          name: color.official_name,
          status: 'success',
          url: publicUrl
        });

        console.log(`✓ Generated swatch for ${color.official_name}`);

      } catch (error) {
        console.error(`Error processing ${color.official_name}:`, error);
        results.push({
          name: color.official_name,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: colors?.length || 0,
        processed: results.length,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error: any) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
