import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGeminiKey, hasGeminiKey } from "../_shared/gemini-key-pool.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface VerifyRequest {
  manufacturer: string;
  colorName: string;
  colorType?: string;
  userProvidedHex?: string;
  swatchImageUrl?: string;
}

interface ColorVerificationResult {
  exists: boolean;
  verified: boolean;
  color: {
    id: string;
    manufacturer: string;
    name: string;
    hex: string;
    finish: string;
    color_type: string;
    series?: string;
    code?: string;
    metallic: boolean;
    pearl: boolean;
    chrome: boolean;
    popularity_score: number;
  } | null;
  confidence: number;
  message: string;
  source: 'database' | 'ai_verified' | 'rejected';
}

// Generate a stable product code from manufacturer + color name
function generateProductCode(manufacturer: string, colorName: string): string {
  const mfrSlug = manufacturer.replace(/\s+/g, '').toUpperCase().slice(0, 4);
  const colorSlug = colorName.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 8);
  const suffix = Date.now().toString(36).toUpperCase().slice(-4);
  return `${mfrSlug}-${colorSlug}-${suffix}`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { manufacturer, colorName, colorType, userProvidedHex, swatchImageUrl } = await req.json() as VerifyRequest;

    if (!manufacturer || !colorName) {
      return new Response(
        JSON.stringify({ error: 'Manufacturer and color name are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // STEP 1: Check manufacturer_colors first (authoritative source)
    console.log(`🔍 Checking manufacturer_colors for: ${manufacturer} - ${colorName}`);

    const { data: existingMfc } = await supabase
      .from('manufacturer_colors')
      .select('*')
      .ilike('manufacturer', `%${manufacturer}%`)
      .ilike('official_name', `%${colorName}%`)
      .eq('is_verified', true)
      .limit(1);

    if (existingMfc && existingMfc.length > 0) {
      const color = existingMfc[0];
      console.log(`✅ Found in manufacturer_colors: ${color.official_name} (${color.product_code})`);

      const result: ColorVerificationResult = {
        exists: true,
        verified: true,
        color: {
          id: color.id,
          manufacturer: color.manufacturer,
          name: color.official_name,
          hex: color.official_hex,
          finish: color.finish,
          color_type: colorType || color.finish?.toLowerCase() || 'gloss',
          series: color.series,
          code: color.product_code,
          metallic: color.finish?.toLowerCase().includes('metallic') || false,
          pearl: color.finish?.toLowerCase().includes('pearl') || false,
          chrome: color.finish?.toLowerCase().includes('chrome') || false,
          popularity_score: 0,
        },
        confidence: 1.0,
        message: 'Color found in verified manufacturer library',
        source: 'database',
      };

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // STEP 2: Not in manufacturer_colors — verify with AI + image search in parallel
    console.log(`🤖 Not found, verifying with AI + searching images: ${manufacturer} - ${colorName}`);

    if (!hasGeminiKey()) {
      throw new Error('No Gemini API key configured');
    }

    // Run AI verification and image search simultaneously
    const imageSearchPromise = fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/search-vinyl-product-images`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ manufacturer, colorName, productCode: null }),
      }
    ).then(r => r.ok ? r.json() : null).catch(() => null);

    const verificationPrompt = `You are a vinyl wrap color verification expert. Verify if this vinyl wrap color exists in real manufacturer catalogs.

MANUFACTURER: ${manufacturer}
COLOR NAME: ${colorName}
${userProvidedHex ? `USER PROVIDED HEX: ${userProvidedHex}` : ''}
${colorType ? `COLOR TYPE: ${colorType}` : ''}

CRITICAL RULES:
1. Only verify colors that ACTUALLY EXIST in real manufacturer catalogs
2. Do NOT invent or hallucinate colors
3. Be strict - if unsure, set confidence below 0.5
4. Common manufacturers: Avery Dennison (SW900, Conform Chrome), 3M (2080, 1080), Hexis (HX30, HX20), KPMF (K75400, K77000), Oracal (970RA), Inozetek, TeckWrap, VViViD, GSWF, STEK, Arlon

RESPOND WITH ONLY VALID JSON (no markdown, no explanation):
{
  "exists": boolean,
  "confidence": number (0.0 to 1.0),
  "correctedHex": "#XXXXXX",
  "finish": "Gloss" | "Matte" | "Satin" | "Chrome" | "Metallic" | "Brushed" | "Carbon" | "Iridescent",
  "colorType": "gloss" | "matte" | "satin" | "metallic" | "flip" | "iridescent" | "pearl" | "neon" | "chrome" | "color_ppf" | "matte_ppf" | "gloss_ppf",
  "series": "series name or null",
  "productCode": "product code or null",
  "isMetallic": boolean,
  "isPearl": boolean,
  "isChrome": boolean,
  "description": "1-2 sentence description of how this film looks on a vehicle",
  "baseColor": "primary base color word",
  "reasoning": "brief explanation"
}`;

    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${getGeminiKey()}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: verificationPrompt }] }],
          tools: [{ googleSearch: {} }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 1024 },
        }),
      }
    );

    if (!aiResponse.ok) {
      console.error('Gemini API verification failed:', await aiResponse.text());
      throw new Error('AI verification service unavailable');
    }

    const aiData = await aiResponse.json();
    const aiContent = aiData.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text || '')
      .join('') || '';

    console.log('AI response:', aiContent.slice(0, 300));

    let verification: any;
    try {
      const jsonMatch = aiContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');
      verification = JSON.parse(jsonMatch[0]);
    } catch {
      const result: ColorVerificationResult = {
        exists: false, verified: false, color: null, confidence: 0,
        message: 'Unable to verify color — AI response unparseable',
        source: 'rejected',
      };
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const confidence = verification.confidence || 0;
    console.log(`AI confidence: ${confidence}, exists: ${verification.exists}`);

    // STEP 3: Save to manufacturer_colors if confidence is sufficient
    if (verification.exists && confidence >= 0.50) {
      const isAutoVerified = confidence >= 0.85;
      const hex = verification.correctedHex || userProvidedHex || '#808080';
      const productCode = verification.productCode || generateProductCode(manufacturer, colorName);

      // Resolve image search (was running in parallel with AI verification)
      const imageSearchData = await imageSearchPromise;
      const foundSwatchUrl = swatchImageUrl
        || (imageSearchData?.photos?.[0]?.url ?? null);
      console.log(`🖼️ Swatch image: ${foundSwatchUrl ? 'found' : 'none'}`);

      console.log(`💾 Saving to manufacturer_colors (verified=${isAutoVerified}): ${manufacturer} - ${colorName} [${productCode}]`);

      const { data: newColor, error: insertError } = await supabase
        .from('manufacturer_colors')
        .insert({
          manufacturer,
          series: verification.series || null,
          product_code: productCode,
          official_name: colorName,
          official_hex: hex,
          finish: verification.finish || 'Gloss',
          is_ppf: ['color_ppf', 'matte_ppf', 'gloss_ppf'].includes(verification.colorType || ''),
          is_verified: isAutoVerified,
          official_swatch_url: foundSwatchUrl,
          hex_source: 'ai_grounded',
          hex_confidence: Math.round(confidence * 100),
          grounded_description: verification.description || null,
          grounded_base_color: verification.baseColor || null,
          grounded_effect: verification.colorType || null,
        })
        .select()
        .single();

      if (insertError) {
        // Handle duplicate product_code — retry with generated code
        if (insertError.code === '23505') {
          const fallbackCode = generateProductCode(manufacturer, colorName);
          const { data: retryColor, error: retryError } = await supabase
            .from('manufacturer_colors')
            .insert({
              manufacturer,
              series: verification.series || null,
              product_code: fallbackCode,
              official_name: colorName,
              official_hex: hex,
              finish: verification.finish || 'Gloss',
              is_ppf: ['color_ppf', 'matte_ppf', 'gloss_ppf'].includes(verification.colorType || ''),
              is_verified: isAutoVerified,
              hex_source: 'ai_grounded',
              hex_confidence: Math.round(confidence * 100),
              grounded_description: verification.description || null,
              grounded_base_color: verification.baseColor || null,
              grounded_effect: verification.colorType || null,
            })
            .select()
            .single();

          if (retryError) throw new Error('Failed to save verified color');

          const result: ColorVerificationResult = {
            exists: true,
            verified: isAutoVerified,
            color: {
              id: retryColor.id,
              manufacturer: retryColor.manufacturer,
              name: retryColor.official_name,
              hex: retryColor.official_hex,
              finish: retryColor.finish,
              color_type: verification.colorType || 'gloss',
              series: retryColor.series,
              code: retryColor.product_code,
              metallic: verification.isMetallic || false,
              pearl: verification.isPearl || false,
              chrome: verification.isChrome || false,
              popularity_score: 0,
            },
            confidence,
            message: isAutoVerified ? 'Color verified and added to library' : 'Color saved pending admin verification',
            source: 'ai_verified',
          };
          return new Response(JSON.stringify(result), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        console.error('Insert error:', insertError);
        throw new Error('Failed to save verified color');
      }

      const result: ColorVerificationResult = {
        exists: true,
        verified: isAutoVerified,
        color: {
          id: newColor.id,
          manufacturer: newColor.manufacturer,
          name: newColor.official_name,
          hex: newColor.official_hex,
          finish: newColor.finish,
          color_type: verification.colorType || 'gloss',
          series: newColor.series,
          code: newColor.product_code,
          metallic: verification.isMetallic || false,
          pearl: verification.isPearl || false,
          chrome: verification.isChrome || false,
          popularity_score: 0,
        },
        confidence,
        message: isAutoVerified ? 'Color verified and added to library' : 'Color saved pending admin verification',
        source: 'ai_verified',
      };

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // STEP 4: Reject low-confidence colors
    console.log(`❌ Rejected (confidence too low): ${confidence}`);

    const result: ColorVerificationResult = {
      exists: false,
      verified: false,
      color: null,
      confidence,
      message: `Color could not be verified (confidence: ${(confidence * 100).toFixed(0)}%). This may not be a real manufacturer color.`,
      source: 'rejected',
    };

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Verification error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
