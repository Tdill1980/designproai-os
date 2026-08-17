import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageDataUrl, manufacturer } = await req.json();

    if (!imageDataUrl) {
      return new Response(
        JSON.stringify({ error: 'Missing imageDataUrl' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const googleApiKey = Deno.env.get('GOOGLE_AI_API_KEY');
    if (!googleApiKey) {
      throw new Error('GOOGLE_AI_API_KEY not configured');
    }

    // Simple OCR prompt - just read the text on the swatch
    const ocrPrompt = `This is a cropped swatch cell from a ${manufacturer === '3m' ? '3M 2080' : 'Avery Dennison SW900'} vinyl wrap poster.

Read the text printed on this swatch. Look for:
1. Product code (like "2080-G12" for 3M or "SW900-123-X" for Avery)
2. Color name (like "Gloss Black" or "Satin Red")

Respond ONLY with valid JSON, no markdown:
{"productCode": "THE_CODE", "colorName": "THE_NAME"}

If you cannot read the text clearly, respond with:
{"productCode": null, "colorName": null}`;

    // Extract base64 data and mime type from data URL
    const dataUrlMatch = imageDataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!dataUrlMatch) {
      throw new Error('Invalid imageDataUrl format — expected data:mime;base64,...');
    }
    const [, mimeType, base64Data] = dataUrlMatch;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [
              { text: ocrPrompt },
              { inlineData: { mimeType, data: base64Data } },
            ],
          }],
          generationConfig: {
            maxOutputTokens: 2048,
            temperature: 0.1,
          },
        }),
      },
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Google AI API error:', errorText);
      throw new Error(`AI OCR failed: ${aiResponse.status}`);
    }

    const aiResult = await aiResponse.json();
    const content = aiResult.candidates?.[0]?.content?.parts?.find((p: any) => p.text)?.text || '';

    // Parse the JSON response
    let result = { productCode: null, colorName: null };
    try {
      // Clean up response - remove markdown if present
      let jsonStr = content.trim();
      if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.replace(/```json?\s*/g, '').replace(/```\s*$/g, '');
      }
      result = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse OCR response:', content);
    }

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in ocr-swatch-cell:', error);
    return new Response(
      JSON.stringify({ 
        productCode: null, 
        colorName: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
