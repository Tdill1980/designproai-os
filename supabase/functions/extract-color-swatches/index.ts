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
    const { posterUrl, manufacturer } = await req.json();
    
    if (!posterUrl || !manufacturer) {
      return new Response(JSON.stringify({
        error: 'Missing posterUrl or manufacturer'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    if (!hasGeminiKey()) {
      throw new Error('GOOGLE_AI_API_KEY is not configured');
    }

    const supabase = createExternalClient();

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

    // Fetch existing colors for this manufacturer to get product codes
    const { data: existingColors, error: fetchError } = await supabase
      .from('manufacturer_colors')
      .select('id, product_code, official_name, official_hex')
      .eq('manufacturer', manufacturer);

    if (fetchError) {
      throw new Error(`Failed to fetch colors: ${fetchError.message}`);
    }

    if (!existingColors || existingColors.length === 0) {
      return new Response(JSON.stringify({
        error: `No colors found for manufacturer: ${manufacturer}. Run import first.`
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Build list of product codes to extract
    const productCodes = existingColors.map(c => ({
      product_code: c.product_code,
      official_name: c.official_name
    }));

    // Use Gemini Vision to analyze the poster and extract hex colors
    const prompt = `You are analyzing a vinyl wrap color chart poster from ${manufacturer}.

The poster contains color swatches arranged in a grid. Each swatch has a color name and product code.

I need you to identify the HEX color value for each of the following products by looking at the actual color swatch in the image:

${productCodes.map(p => `- ${p.product_code}: ${p.official_name}`).join('\n')}

For each color, sample the dominant color from the center of the swatch (not the border or text area).

Return a JSON array with this exact format:
[
  {"product_code": "SW900-190-O", "hex": "#1A1A1A"},
  {"product_code": "SW900-180-O", "hex": "#FFFFFF"}
]

IMPORTANT:
- Return ONLY the JSON array, no markdown or explanation
- Use proper 6-digit hex codes starting with #
- For metallic/pearl colors, use the base dominant color
- If a color cannot be found, omit it from the array`;

    // Convert poster image to base64
    const posterImageData = await imageUrlToBase64(posterUrl);
    if (!posterImageData) {
      throw new Error('Failed to fetch poster image');
    }

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inlineData: { mimeType: posterImageData.mimeType, data: posterImageData.data } }
          ]
        }],
        generationConfig: {
          maxOutputTokens: 8000
        }
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', response.status, errorText);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const aiResult = await response.json();
    const content = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    console.log('AI response:', content.substring(0, 500));

    // Parse the JSON response
    let extractedColors: Array<{ product_code: string; hex: string }> = [];
    try {
      // Remove any markdown formatting
      const jsonStr = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      extractedColors = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError);
      return new Response(JSON.stringify({
        error: 'Failed to parse AI color extraction response',
        raw: content.substring(0, 1000)
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Update database with extracted hex values
    let updated = 0;
    let errors: string[] = [];

    for (const color of extractedColors) {
      if (!color.product_code || !color.hex) continue;
      
      // Validate hex format
      if (!/^#[0-9A-Fa-f]{6}$/.test(color.hex)) {
        errors.push(`Invalid hex for ${color.product_code}: ${color.hex}`);
        continue;
      }

      const { error } = await supabase
        .from('manufacturer_colors')
        .update({
          official_hex: color.hex,
          hex_source: 'poster_extracted',
          hex_confidence: 85
        })
        .eq('manufacturer', manufacturer)
        .eq('product_code', color.product_code);

      if (error) {
        errors.push(`Update ${color.product_code}: ${error.message}`);
      } else {
        updated++;
      }
    }

    console.log(`Extraction complete for ${manufacturer}: ${updated} updated, ${errors.length} errors`);

    return new Response(JSON.stringify({
      success: true,
      manufacturer,
      extracted: extractedColors.length,
      updated,
      errors: errors.length > 0 ? errors : undefined
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Extraction error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
