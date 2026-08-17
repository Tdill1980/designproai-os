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

    const { swatch_id, manufacturer, color_name } = await req.json();

    if (!swatch_id && (!manufacturer || !color_name)) {
      return new Response(
        JSON.stringify({ error: 'Either swatch_id OR manufacturer + color_name required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('🔍 Validating swatch images for:', { swatch_id, manufacturer, color_name });

    // Get swatch info first
    let swatchData: any = null;
    if (swatch_id) {
      const { data } = await supabase
        .from('vinyl_swatches')
        .select('*')
        .eq('id', swatch_id)
        .single();
      swatchData = data;
    } else {
      const { data } = await supabase
        .from('vinyl_swatches')
        .select('*')
        .eq('manufacturer', manufacturer)
        .ilike('name', color_name)
        .limit(1)
        .single();
      swatchData = data;
    }

    if (!swatchData) {
      return new Response(
        JSON.stringify({ error: 'Swatch not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch reference images for this swatch
    let refQuery = supabase
      .from('vinyl_reference_images')
      .select('*');

    if (swatch_id) {
      refQuery = refQuery.eq('swatch_id', swatch_id);
    } else {
      refQuery = refQuery
        .eq('manufacturer', swatchData.manufacturer)
        .ilike('color_name', swatchData.name);
    }

    const { data: refs, error: refError } = await refQuery;

    if (refError) {
      console.error('Error fetching references:', refError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch reference images' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!refs || refs.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'No reference images found for this swatch',
          swatch_id: swatchData.id,
          manufacturer: swatchData.manufacturer,
          color_name: swatchData.name
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📸 Found ${refs.length} reference images to validate`);

    const scoredImages: Array<{ id: string; image_url: string; score: number; analysis: any }> = [];

    // Score each reference image using AI
    for (const ref of refs) {
      try {
        console.log(`🤖 Analyzing image: ${ref.image_url.substring(0, 60)}...`);

        const analysisPrompt = `Analyze this image for use as a vinyl wrap color reference.

EVALUATE (score each 0-1):
1. Is this a true vinyl wrap swatch photo (not a car photo)? 
2. Is the lighting neutral/white-balanced?
3. Is the finish clearly visible (gloss/satin/matte/chrome)?
4. Is the resolution acceptable (512px+ minimum)?
5. Is the color representation accurate?

Expected finish: ${swatchData.finish || 'gloss'}
Expected hex: ${swatchData.hex}

Respond ONLY with JSON:
{
  "is_swatch": <true/false>,
  "lighting_neutral": <0-1>,
  "finish_visible": <0-1>,
  "resolution_ok": <0-1>,
  "color_accurate": <0-1>,
  "overall_score": <0-1>,
  "reasoning": "<brief explanation>"
}`;

        // Convert image to base64
        const imageData = await imageUrlToBase64(ref.image_url);
        if (!imageData) {
          console.error(`Failed to fetch image ${ref.id}`);
          continue;
        }

        const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: analysisPrompt },
                { inlineData: { mimeType: imageData.mimeType, data: imageData.data } }
              ]
            }]
          }),
        });

        if (!aiResponse.ok) {
          console.error(`Gemini API request failed for image ${ref.id}`);
          continue;
        }

        const aiData = await aiResponse.json();
        const content = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        
        // Extract JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);
          
          // Calculate final score (penalize non-swatches heavily)
          let finalScore = analysis.overall_score || 0;
          if (!analysis.is_swatch) {
            finalScore *= 0.3; // Heavy penalty for non-swatch images
          }

          scoredImages.push({
            id: ref.id,
            image_url: ref.image_url,
            score: finalScore,
            analysis
          });

          console.log(`✅ Scored image ${ref.id}: ${finalScore.toFixed(2)}`);
        }
      } catch (e) {
        console.error(`Error analyzing image ${ref.id}:`, e);
      }
    }

    if (scoredImages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Failed to score any reference images' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Sort by score and select best
    scoredImages.sort((a, b) => b.score - a.score);
    const bestImage = scoredImages[0];

    console.log(`🏆 Best image: ${bestImage.id} with score ${bestImage.score.toFixed(2)}`);

    // Update all scored images with their scores
    for (const scored of scoredImages) {
      await supabase
        .from('vinyl_reference_images')
        .update({ 
          score: scored.score,
          is_verified: scored.id === bestImage.id && scored.score >= 0.5
        })
        .eq('id', scored.id);
    }

    // Update vinyl_swatches with best image
    if (bestImage.score >= 0.5) {
      await supabase
        .from('vinyl_swatches')
        .update({ 
          media_url: bestImage.image_url,
          verified: true
        })
        .eq('id', swatchData.id);

      console.log('✅ Updated swatch media_url with validated image');
    }

    return new Response(
      JSON.stringify({
        success: true,
        swatch_id: swatchData.id,
        images_scored: scoredImages.length,
        best_image: {
          id: bestImage.id,
          url: bestImage.image_url,
          score: bestImage.score,
          analysis: bestImage.analysis
        },
        all_scores: scoredImages.map(s => ({ id: s.id, score: s.score }))
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in validate-swatch-images:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
