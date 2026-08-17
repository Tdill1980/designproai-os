// Update Swatch Media URLs Edge Function
// Generates swatch placeholder images based on hex colors and uploads to Supabase storage

import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Manufacturer display names
const brandDisplayNames: Record<string, string> = {
  hexis: 'Hexis',
  kpmf: 'KPMF',
  teckwrap: 'TeckWrap',
  vvivid: 'VViViD',
  arlon: 'Arlon',
  '3m': '3M',
  avery: 'Avery Dennison',
  oracal: 'Oracal',
  inozetek: 'Inozetek',
  carlas: 'Carlas',
  flexishield: 'FlexiShield',
  stek: 'STEK',
  gswf: 'GSWF',
};

// Generate a simple SVG swatch image
function generateSwatchSVG(hex: string, name: string, manufacturer: string, finish: string): string {
  // Ensure hex has # prefix
  const hexColor = hex.startsWith('#') ? hex : `#${hex}`;
  
  // Determine text color based on background brightness
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  const textColor = brightness > 128 ? '#000000' : '#FFFFFF';
  
  // Add finish effect
  let finishOverlay = '';
  const finishLower = (finish || '').toLowerCase();
  
  if (finishLower.includes('metallic') || finishLower.includes('metal')) {
    finishOverlay = `
      <defs>
        <linearGradient id="metallic" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(255,255,255,0.3)"/>
          <stop offset="50%" style="stop-color:rgba(255,255,255,0)"/>
          <stop offset="100%" style="stop-color:rgba(255,255,255,0.2)"/>
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill="url(#metallic)"/>
    `;
  } else if (finishLower.includes('matte') || finishLower.includes('satin')) {
    finishOverlay = `<rect width="200" height="200" fill="rgba(0,0,0,0.05)"/>`;
  } else if (finishLower.includes('gloss')) {
    finishOverlay = `
      <defs>
        <linearGradient id="gloss" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" style="stop-color:rgba(255,255,255,0.4)"/>
          <stop offset="30%" style="stop-color:rgba(255,255,255,0)"/>
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill="url(#gloss)"/>
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="${hexColor}"/>
  ${finishOverlay}
  <text x="100" y="180" text-anchor="middle" font-family="Arial, sans-serif" font-size="10" fill="${textColor}" opacity="0.7">${manufacturer}</text>
</svg>`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { brand, limit = 20, mode = 'generate' } = await req.json();
    
    const supportedBrands = Object.keys(brandDisplayNames);
    
    if (!brand) {
      return new Response(
        JSON.stringify({ error: 'Missing brand parameter', supportedBrands }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const brandKey = brand.toLowerCase();
    const brandDisplayName = brandDisplayNames[brandKey];
    
    if (!brandDisplayName) {
      return new Response(
        JSON.stringify({ error: `Unsupported brand: ${brand}`, supportedBrands }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Supabase client
    const supabase = createExternalClient();

    console.log(`[update-swatch-media-urls] Processing ${brandDisplayName} (limit: ${limit}, mode: ${mode})`);

    // Get existing swatches for this manufacturer that need media_url
    const { data: existingSwatches, error: fetchError } = await supabase
      .from('vinyl_swatches')
      .select('id, name, code, hex, finish, media_url')
      .ilike('manufacturer', `%${brandKey}%`)
      .or('media_url.is.null,media_url.eq.')
      .not('hex', 'is', null)
      .limit(limit);

    if (fetchError) {
      throw new Error(`Database fetch error: ${fetchError.message}`);
    }

    console.log(`[update-swatch-media-urls] Found ${existingSwatches?.length || 0} swatches needing media_url for ${brandDisplayName}`);

    const results = {
      brand: brandDisplayName,
      total: existingSwatches?.length || 0,
      updated: 0,
      skipped: 0,
      errors: [] as string[],
      matches: [] as { name: string; imageUrl: string }[]
    };

    // Process each swatch - generate SVG and upload to storage
    for (const swatch of existingSwatches || []) {
      if (!swatch.hex || swatch.hex === '#000000' || swatch.hex === '#000' || swatch.hex.length < 4) {
        results.skipped++;
        console.log(`[update-swatch-media-urls] ⏭️ Skipped ${swatch.name}: invalid hex (${swatch.hex})`);
        continue;
      }

      try {
        // Generate SVG swatch
        const svg = generateSwatchSVG(swatch.hex, swatch.name, brandDisplayName, swatch.finish);
        const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
        
        // Create a unique filename
        const fileName = `${brandKey}/${swatch.id}.svg`;
        
        // Upload to Supabase storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('swatches')
          .upload(fileName, svgBlob, {
            contentType: 'image/svg+xml',
            upsert: true
          });

        if (uploadError) {
          results.errors.push(`Upload failed for ${swatch.name}: ${uploadError.message}`);
          results.skipped++;
          continue;
        }

        // Get the public URL
        const { data: urlData } = supabase.storage
          .from('swatches')
          .getPublicUrl(fileName);

        const publicUrl = urlData.publicUrl;

        // Update the swatch with the uploaded image URL
        const { error: updateError } = await supabase
          .from('vinyl_swatches')
          .update({ 
            media_url: publicUrl, 
            media_type: 'image',
            updated_at: new Date().toISOString() 
          })
          .eq('id', swatch.id);

        if (updateError) {
          results.errors.push(`DB update failed for ${swatch.name}: ${updateError.message}`);
        } else {
          results.updated++;
          results.matches.push({ name: swatch.name, imageUrl: publicUrl });
          console.log(`[update-swatch-media-urls] ✅ Generated swatch for ${swatch.name}`);
        }
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        results.errors.push(`Error processing ${swatch.name}: ${errMsg}`);
        results.skipped++;
      }
    }

    console.log(`[update-swatch-media-urls] Results for ${brandDisplayName}: updated=${results.updated}, skipped=${results.skipped}`);

    return new Response(
      JSON.stringify(results),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error(`[update-swatch-media-urls] Error:`, errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
