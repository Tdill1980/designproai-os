import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SwatchCell {
  detectedCode: string | null;
  detectedName: string | null;
  row: number;
  col: number;
  confidence: number;
}

interface CropResult {
  success: boolean;
  swatches: SwatchCell[];
  gridInfo: {
    rows: number;
    cols: number;
    cellWidth: number;
    cellHeight: number;
  };
  error?: string;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, manufacturer } = await req.json();

    if (!imageUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing imageUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Processing poster for ${manufacturer || 'unknown'} manufacturer`);
    console.log(`Image URL: ${imageUrl}`);

    // Fetch the poster image
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }

    const imageBlob = await imageResponse.blob();
    const arrayBuffer = await imageBlob.arrayBuffer();
    const base64Image = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const mimeType = imageBlob.type || 'image/png';
    console.log(`Image size: ${arrayBuffer.byteLength} bytes, type: ${mimeType}`);

    // Use Google AI to analyze the poster and identify the grid structure
    const analysisPrompt = `You are analyzing a vinyl wrap manufacturer poster image that contains a grid of color swatches.

TASK: Analyze this poster and identify all individual swatch cells. Each swatch cell contains:
1. A color swatch area showing the actual color/texture
2. A product code (like "2080-G12" for 3M or "SW900-123-X" for Avery)
3. A color name (like "Gloss Black" or "Satin Red")

For this ${manufacturer === '3m' ? '3M 2080' : 'Avery Dennison'} poster, please:
1. Identify the grid layout (how many rows and columns of swatches)
2. For EACH visible swatch cell, extract:
   - The exact product code (alphanumeric, starts with "${manufacturer === '3m' ? '2080-' : 'SW900-'}" or similar)
   - The exact color name as printed
   - The position in the grid (row number starting from 1, column number starting from 1)

READ CAREFULLY - scan left to right, top to bottom through the entire poster.

Respond in this exact JSON format:
{
  "gridRows": <number>,
  "gridCols": <number>,
  "swatches": [
    {
      "productCode": "2080-G12",
      "colorName": "Gloss Black",
      "row": 1,
      "col": 1
    },
    {
      "productCode": "2080-M12",
      "colorName": "Matte Black",
      "row": 1,
      "col": 2
    }
  ]
}

Be thorough - extract ALL swatches visible on the poster. The product code is critical - read it exactly as printed.`;

    const googleApiKey = Deno.env.get('GOOGLE_AI_API_KEY');

    if (!googleApiKey) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    console.log('Calling Google AI for poster analysis...');

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: analysisPrompt },
              { inlineData: { mimeType, data: base64Image } },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 16000,
            temperature: 0.1,
          },
        }),
      },
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Google AI API error:', errorText);
      throw new Error(`AI analysis failed: ${aiResponse.status} - ${errorText}`);
    }

    const aiResult = await aiResponse.json();
    const content = aiResult.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text;

    if (!content) {
      console.error('Empty AI response:', JSON.stringify(aiResult));
      throw new Error('No response from AI');
    }

    console.log('AI response received, length:', content.length);
    console.log('First 1000 chars:', content.substring(0, 1000));

    // Parse the JSON from the AI response
    let parsed;
    try {
      // Extract JSON from potential markdown code blocks
      const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : content;
      
      // Clean up the JSON string
      const cleanedJson = jsonStr.trim().replace(/^[^{]*/, '').replace(/[^}]*$/, '');
      parsed = JSON.parse(cleanedJson);
    } catch (parseError) {
      console.error('Failed to parse AI response:', content);
      
      // Try to extract just the swatches array if full parse fails
      const swatchMatch = content.match(/"swatches"\s*:\s*\[([\s\S]*?)\]/);
      if (swatchMatch) {
        try {
          parsed = {
            gridRows: 0,
            gridCols: 0,
            swatches: JSON.parse(`[${swatchMatch[1]}]`)
          };
        } catch {
          throw new Error('Failed to parse AI grid analysis');
        }
      } else {
        throw new Error('Failed to parse AI grid analysis');
      }
    }

    const result: CropResult = {
      success: true,
      swatches: (parsed.swatches || []).map((s: any, idx: number) => ({
        detectedCode: s.productCode || s.product_code || null,
        detectedName: s.colorName || s.color_name || null,
        row: s.row || Math.floor(idx / 10) + 1,
        col: s.col || (idx % 10) + 1,
        confidence: 0.9,
      })),
      gridInfo: {
        rows: parsed.gridRows || parsed.grid_rows || 0,
        cols: parsed.gridCols || parsed.grid_cols || 0,
        cellWidth: 228,
        cellHeight: 168,
      },
    };

    console.log(`Detected ${result.swatches.length} swatches in ${result.gridInfo.rows}x${result.gridInfo.cols} grid`);

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in crop-poster-swatches:', error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        swatches: [],
        gridInfo: { rows: 0, cols: 0, cellWidth: 0, cellHeight: 0 }
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
