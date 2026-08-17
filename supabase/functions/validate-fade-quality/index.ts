import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FadeQualityResult {
  score: 1 | 2 | 3 | 4 | 5;
  hasHardLine: boolean;
  transitionPercentage: number;
  failureReasons: string[];
  recommendation: 'approve' | 'regenerate' | 'manual_review';
  analysisDetails: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🔍 validate-fade-quality INVOKED');
    
    const { renderUrl, referenceUrl, renderId, userEmail } = await req.json();
    
    if (!renderUrl) {
      return new Response(
        JSON.stringify({ error: 'renderUrl is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasGeminiKey()) {
      console.error('❌ GOOGLE_AI_API_KEY not configured');
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

    // Build the analysis prompt
    const analysisPrompt = `You are a quality control expert for vehicle wrap renders. Analyze this FadeWraps render for gradient quality.

CRITICAL EVALUATION CRITERIA:

1. HARD LINE DETECTION (Most Important):
   - Look for ANY visible line, edge, or boundary where colors meet
   - A hard line means you can clearly see WHERE one color stops and another starts
   - This is a CRITICAL FAILURE if present

2. TRANSITION SMOOTHNESS:
   - The fade should be SEAMLESS like airbrush spray painting
   - Colors should MIST into each other imperceptibly
   - You should NOT be able to identify the exact point where colors change

3. TRANSITION WIDTH:
   - The fade should span at least 30-40% of the vehicle length
   - Short, abrupt transitions are a failure

4. OVERALL QUALITY:
   - Professional automotive photography quality
   - Colors should blend like a sunset sky or ombre hair dye

SCORING GUIDE:
- Score 5: PERFECT - Seamless airbrush-quality gradient, impossible to see where colors meet
- Score 4: EXCELLENT - Very smooth transition, only minor imperfections if any
- Score 3: ACCEPTABLE - Good fade but slightly visible transition area
- Score 2: POOR - Noticeable transition line or uneven blend
- Score 1: FAILURE - Hard line clearly visible, looks like two-tone split

Respond ONLY with valid JSON in this exact format:
{
  "score": <1-5>,
  "hasHardLine": <true/false>,
  "transitionPercentage": <estimated % of vehicle covered by fade transition>,
  "failureReasons": [<array of specific issues found, empty if none>],
  "recommendation": "<approve|regenerate|manual_review>",
  "analysisDetails": "<brief description of what you observed>"
}`;

    console.log('📸 Analyzing render:', renderUrl.substring(0, 80) + '...');

    // Convert image to base64 for Gemini
    const imageData = await imageUrlToBase64(renderUrl);
    if (!imageData) {
      return new Response(
        JSON.stringify({ error: 'Failed to fetch render image' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Call Gemini API to analyze the image
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
        }],
        generationConfig: {
          maxOutputTokens: 1000
        }
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('❌ Gemini API analysis failed:', aiResponse.status, errorText);

      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded, please try again later' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ error: 'AI analysis failed' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const aiData = await aiResponse.json();
    const analysisText = aiData.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('📝 AI Analysis response:', analysisText);

    // Parse the JSON response
    let result: FadeQualityResult;
    try {
      // Extract JSON from the response (handle markdown code blocks)
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      result = JSON.parse(jsonMatch[0]);
    } catch (parseError) {
      console.error('❌ Failed to parse AI response:', parseError);
      // Default to manual review if parsing fails
      result = {
        score: 3,
        hasHardLine: false,
        transitionPercentage: 0,
        failureReasons: ['AI analysis response could not be parsed'],
        recommendation: 'manual_review',
        analysisDetails: analysisText.substring(0, 500)
      };
    }

    // Log the result
    console.log('✅ Fade quality analysis complete:', JSON.stringify(result, null, 2));

    // If we have a renderId, save the quality rating to the EXTERNAL database
    if (renderId) {
      const supabase = createExternalClient();

      const { error: insertError } = await supabase
        .from('render_quality_ratings')
        .upsert({
          render_id: renderId,
          render_type: 'fadewraps',
          rating: result.score,
          is_flagged: result.hasHardLine || result.score <= 2,
          flag_reason: result.hasHardLine ? 'Hard line detected in gradient' : 
                       result.score <= 2 ? 'Low gradient quality score' : null,
          notes: result.analysisDetails,
          user_email: userEmail || null,
          gradient_quality_score: result.score,
          has_hard_line: result.hasHardLine,
          auto_regenerated: false,
          validation_details: result as unknown as Record<string, unknown>
        }, {
          onConflict: 'render_id'
        });

      if (insertError) {
        console.error('⚠️ Failed to save quality rating:', insertError);
      } else {
        console.log('✅ Quality rating saved to database');
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        result,
        shouldRegenerate: result.recommendation === 'regenerate' || result.hasHardLine
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ validate-fade-quality error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
