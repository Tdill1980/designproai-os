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
    const { referenceImages, manufacturer, colorName, productCode, userProvidedHex } = await req.json();
    
    if (!referenceImages || !Array.isArray(referenceImages) || referenceImages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'referenceImages array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
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

    console.log(`Validating color from ${referenceImages.length} reference images`);

    // Construct AI prompt for color validation
    const prompt = `You are analyzing real professional vehicle wrap installation photos to extract TRUE vinyl color data.

VINYL PRODUCT:
- Manufacturer: ${manufacturer}
- Color Name: ${colorName}
${productCode ? `- Product Code: ${productCode}` : ''}
${userProvidedHex ? `- User Provided Hex: ${userProvidedHex}` : ''}

TASK:
Analyze these REAL professional installation photos and extract:
1. TRUE HEX COLOR as it appears on the actual wrapped vehicle
2. FINISH TYPE (Gloss, Satin, or Matte) - look at surface reflections and sheen
3. METALLIC detection - does it have visible metallic flakes/sparkle?
4. CONFIDENCE SCORE (0.0 to 1.0) - how confident are you in the color extraction?

CRITICAL RULES:
- Extract the ACTUAL color you see on the wrapped vehicle surface
- For bright colors (teal, cyan, neon, etc.), maintain FULL SATURATION and HIGH BRIGHTNESS
- For metallic finishes, confirm visible sparkle and flake presence
- The hex code MUST match what you actually see in the photos, not theoretical color names
- If photos show inconsistent colors, use the most common/dominant color across images

Return ONLY valid JSON:
{
  "hexCode": "#RRGGBB",
  "finish": "Gloss|Satin|Matte",
  "hasMetallicFlakes": true|false,
  "confidence": 0.0-1.0,
  "reasoning": "Explain what you see in the photos and why you chose this hex"
}`;

    // Convert images to base64 for Gemini
    const geminiParts: any[] = [{ text: prompt }];
    for (const img of referenceImages) {
      const imageData = await imageUrlToBase64(img.url);
      if (imageData) {
        geminiParts.push({ inlineData: { mimeType: imageData.mimeType, data: imageData.data } });
      }
    }

    // Call Gemini API
    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: geminiParts
        }],
        generationConfig: {
          temperature: 0.3
        }
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Gemini API error:', aiResponse.status, errorText);
      throw new Error(`AI validation failed: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiContent) {
      throw new Error('No response from AI');
    }

    console.log('AI validation response:', aiContent);

    // Parse JSON response
    let validatedData;
    try {
      // Remove markdown code blocks if present
      const cleanContent = aiContent.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      validatedData = JSON.parse(cleanContent);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiContent);
      throw new Error('AI returned invalid JSON format');
    }

    // Validate response structure
    if (!validatedData.hexCode || !validatedData.finish || typeof validatedData.confidence !== 'number') {
      throw new Error('AI response missing required fields');
    }

    return new Response(
      JSON.stringify({
        success: true,
        validated: {
          hexCode: validatedData.hexCode,
          finish: validatedData.finish,
          hasMetallicFlakes: validatedData.hasMetallicFlakes || false,
          confidence: validatedData.confidence,
          reasoning: validatedData.reasoning,
        },
        originalInput: {
          manufacturer,
          colorName,
          productCode,
          userProvidedHex,
        },
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in validate-vinyl-color-from-images:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
