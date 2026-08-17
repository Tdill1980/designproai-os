import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { STUDIO_ENVIRONMENT, STUDIO_REINFORCEMENT } from "../_shared/studio-os.ts";
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
    const { vehicleYear, vehicleMake, vehicleModel, productData, viewType = 'hood_detail', userEmail } = await req.json();
    
    console.log('PrintPro render request:', { vehicleYear, vehicleMake, vehicleModel, viewType, productData, userEmail });

    if (!vehicleYear || !vehicleMake || !vehicleModel) {
      return new Response(
        JSON.stringify({ error: 'Missing vehicle details' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (!hasGeminiKey()) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    // Extract product data
    const {
      swatchColor,
      swatchName,
      finish = 'gloss',
      designUrl,
      designName = 'Custom Design'
    } = productData || {};

    // Build PrintPro-specific prompt
    const printProPrompt = buildPrintProPrompt({
      vehicleYear,
      vehicleMake,
      vehicleModel,
      swatchColor,
      swatchName,
      finish,
      designUrl,
      designName,
      viewType
    });

    console.log('Invoking Gemini API with PrintPro prompt...');

    const aiResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent?key=${getGeminiKey()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: printProPrompt }]
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          responseMimeType: 'text/plain'
        }
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Gemini API error:', errorText);
      throw new Error(`Gemini API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();

    // Extract image from Gemini response
    const parts = aiData.candidates?.[0]?.content?.parts;
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
      throw new Error('No image generated');
    }

    console.log('PrintPro render generated successfully');

    return new Response(
      JSON.stringify({ 
        renderUrl: imageUrl,
        viewType 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('PrintPro render error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

function buildPrintProPrompt({ 
  vehicleYear, 
  vehicleMake, 
  vehicleModel, 
  swatchColor, 
  swatchName, 
  finish, 
  designUrl, 
  designName,
  viewType 
}: {
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
  swatchColor?: string;
  swatchName?: string;
  finish: string;
  designUrl?: string;
  designName: string;
  viewType: string;
}): string {
  
  // Camera positioning (duplicated from DesignPanelPro parameters)
  const cameraAngle = viewType === 'hood_detail'
    ? 'HOOD DETAIL VIEW - Tight 3/4 front angle, hood fills 60-70% of frame, vehicle logo/badge clearly visible and in focus'
    : viewType === 'front'
    ? 'HERO FRONT 3/4 VIEW - Dynamic front-left angle showing full vehicle front with hood, grille, headlights'
    : viewType === 'side'
    ? 'TRUE SIDE PROFILE - Perfect 90 degree side view, camera 8 feet from vehicle at centerline height, showing full vehicle length from ground to roof'
    : viewType === 'rear'
    ? 'REAR 3/4 VIEW - Rear-left corner angle showing full rear end, bumper, trunk, quarter panels'
    : 'TOP VIEW - Overhead drone perspective looking straight down at vehicle roof and hood';

  // Finish characteristics
  const finishDetails = finish.toLowerCase() === 'gloss'
    ? 'ULTRA HIGH GLOSS finish with mirror-like reflections, deep wet shine, sharp crisp reflections of sky and surroundings'
    : finish.toLowerCase() === 'satin'
    ? 'SATIN finish with soft pearl sheen, subtle reflections, smooth silky appearance'
    : 'DEEP MATTE finish with zero reflections, flat uniform surface, no shine or gloss';

  return `You are a professional automotive wrap visualization AI generating photorealistic renders of printed vinyl film products installed on vehicles.

🚗 VEHICLE SPECIFICATIONS
${vehicleYear} ${vehicleMake} ${vehicleModel}

🎨 PRINTED PRODUCT SPECIFICATIONS
Product Type: InkFusion™ Premium Printed Film
${swatchColor ? `Base Color: ${swatchColor}` : ''}
${swatchName ? `Swatch Name: ${swatchName}` : ''}
${designUrl ? `Design Pattern: ${designName}` : 'Solid Color Film'}
Finish: ${finish.toUpperCase()} (${finishDetails})

📷 CAMERA POSITION & COMPOSITION
${cameraAngle}

🎯 CRITICAL RENDERING REQUIREMENTS

1. ASPECT RATIO (MANDATORY)
   - Generate image in STRICT 16:9 landscape aspect ratio
   - Resolution: 1920×1080px or 1792×1008px
   - NEVER generate square or portrait format

2. PRINTED FILM APPLICATION
   ${designUrl 
     ? `- Show custom printed design pattern seamlessly installed on vehicle panels
   - Pattern must wrap naturally around vehicle curves and body lines
   - NO visible seams, edges, or application marks
   - Design should appear professionally printed and installed`
     : `- Show solid color vinyl film (${swatchColor || 'selected color'}) professionally installed
   - Seamless coverage across all visible panels
   - No seams, edges, or application marks visible`}

3. FINISH ACCURACY
   ${finishDetails}
   - Finish must be consistent across all panels
   - Lighting must accurately represent ${finish} characteristics

4. PHOTOREALISM
   - ULTRA HIGH RESOLUTION, crystal clear, zero blur
   - Professional DSLR quality photography
   - Accurate vehicle proportions and panel alignment
   - Realistic shadows and ground contact shadow

5. BRANDING OVERLAY (REQUIRED)
   - Top-left corner: "PrintPro™" text only
   - Font: Inter, 10px size, pure black (#000000)
   - Position: 12px from top edge, 15px from left edge
   - NO italic, NO bold, NO effects, NO shadows
   - Text should appear nearly invisible like a watermark
   - Single instance only (no duplicate overlays)

6. STUDIO ENVIRONMENT
${STUDIO_ENVIRONMENT}

Generate a photorealistic render showing the ${vehicleYear} ${vehicleMake} ${vehicleModel} wrapped in InkFusion™ printed film. Must be 16:9 landscape. Must look like a real photograph taken in a professional photography studio with medium-dark gray smooth matte concrete floor and medium gray seamless backdrop. NO additional text or branding beyond the PrintPro™ watermark.

${STUDIO_REINFORCEMENT}`;
}
