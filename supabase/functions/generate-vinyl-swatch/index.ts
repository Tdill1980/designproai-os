import "https://deno.land/x/xhr@0.1.0/mod.ts";
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
    const { colorName, finish, colorLibrary, swatchId } = await req.json();
    
    if (!colorName || !finish) {
      return new Response(
        JSON.stringify({ error: 'colorName and finish are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    // Fetch the actual hex color from the EXTERNAL database for accurate color matching
    const supabase = createExternalClient();

    let hexColor = null;
    if (swatchId || colorLibrary) {
      const query = supabase
        .from('inkfusion_swatches')
        .select('hex')
        .eq('name', colorName)
        .eq('finish', finish);
      
      if (colorLibrary) {
        query.eq('color_library', colorLibrary);
      }
      if (swatchId) {
        query.eq('id', swatchId);
      }
      
      const { data: swatchData } = await query.maybeSingle();
      if (swatchData?.hex) {
        hexColor = swatchData.hex;
        console.log(`Found hex color for ${colorName}: ${hexColor}`);
      }
    }

    console.log(`Generating swatch for: ${colorName} (${finish}) ${hexColor ? `with hex ${hexColor}` : ''}`);

    // Create detailed prompt based on finish type
    const finishDescriptions: Record<string, string> = {
      'Gloss': 'ultra high gloss wet-look finish with intense specular highlights and deep reflections',
      'Satin': 'semi-gloss satin finish with soft subtle sheen and gentle light reflection',
      'Matte': 'completely flat matte finish with zero shine or reflection, velvety smooth texture',
      'Metallic': 'metallic flake finish with sparkle and dimensional shimmer',
      'Flip': 'color-shifting chameleon finish that changes colors at different angles with iridescent shimmer',
      'brushed': 'brushed metal texture with directional grain and metallic sheen',
      'textured': 'textured surface with dimensional pattern and depth',
    };
    const finishDescription = finishDescriptions[finish] || 'professional automotive vinyl wrap finish';

    // Build color specification
    const colorSpec = hexColor 
      ? `EXACT COLOR MATCH REQUIRED: Use precise hex color ${hexColor} for ${colorName}. This is a ${colorLibrary === '3m_2080' ? '3M 2080' : colorLibrary === 'avery_sw900' ? 'Avery SW900' : ''} industry standard color that must match the exact specification.`
      : `Color: ${colorName}`;

    // Build film library display name
    const filmLibraryName = colorLibrary === '3m_2080' ? '3M 2080' : 
                           colorLibrary === 'avery_sw900' ? 'Avery SW900' :
                           colorLibrary === 'colorpro_premium' ? 'InkFusion' : 
                           'ColorPro';
    const fullColorName = `${filmLibraryName} ${finish} ${colorName}`;

    const prompt = `Professional automotive vinyl wrap material swatch sample.

CRITICAL COLOR REQUIREMENT:
${colorSpec}
DO NOT deviate from this color specification. The color must be scientifically accurate to the hex value provided.

FINISH SPECIFICATION:
- Pure ${finish} finish: ${finishDescription}

TEXT OVERLAYS (REQUIRED):
- TOP LEFT CORNER: "RestyleProAI" on first line, "ColorPro™" on second line. White text, small professional font, subtle drop shadow for readability.
- BOTTOM RIGHT CORNER: "${fullColorName}". White text, small professional font, subtle drop shadow for readability.

PRESENTATION REQUIREMENTS:
- Clean, flat rectangular vinyl material sample
- Professional product photography on pure white background
- Sharp focus showing material texture and finish quality
- Realistic vinyl wrap surface texture with appropriate grain and texture
- Studio lighting to showcase ${finish} finish characteristics
- High-resolution product photograph, commercial quality
- Text must be clearly legible but not dominating the swatch

The swatch must look like an actual physical vinyl wrap sample with professional labeling that would be used by automotive professionals to show customers the exact color and finish.`;

    console.log('Generating with prompt:', prompt);

    // Generate image using Google Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${getGeminiKey()}`, {
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

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log('Gemini API response received');

    // Extract base64 image from Gemini response
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      throw new Error('No content in Gemini response');
    }

    // Find the image part
    let base64Image: string | null = null;
    for (const part of parts) {
      if (part.inlineData) {
        base64Image = part.inlineData.data;
        break;
      }
    }

    if (!base64Image) {
      throw new Error('No image data in response');
    }
    
    // Upload to Supabase Storage
    // supabase client already initialized above

    // Convert base64 to blob
    const imageBuffer = Uint8Array.from(atob(base64Image), c => c.charCodeAt(0));
    
    // Create safe filename
    const safeColorName = colorName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const fileName = `${colorLibrary || '3m-2080'}/${safeColorName}-${finish.toLowerCase()}.png`;
    
    console.log('Uploading to storage:', fileName);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('swatches')
      .upload(fileName, imageBuffer, {
        contentType: 'image/png',
        upsert: true,
      });

    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from('swatches')
      .getPublicUrl(fileName);

    console.log('Swatch generated and uploaded:', publicUrl);

    return new Response(
      JSON.stringify({ 
        success: true,
        imageUrl: publicUrl,
        colorName,
        finish,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in generate-vinyl-swatch:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
