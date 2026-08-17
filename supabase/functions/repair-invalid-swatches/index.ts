import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

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

    const { manufacturer, limit = 10, fix_type = 'all' } = await req.json() || {};

    console.log('🔧 Starting swatch repair job:', { manufacturer, limit, fix_type });

    // Find swatches that need repair
    let query = supabase
      .from('vinyl_swatches')
      .select('id, manufacturer, name, code, hex, finish, media_url, material_validated')
      .eq('verified', true);

    // Filter by fix type
    if (fix_type === 'hex' || fix_type === 'all') {
      query = query.or('hex.eq.#000000,hex.is.null,hex.eq.');
    }

    if (fix_type === 'material' || fix_type === 'all') {
      query = query.eq('material_validated', false);
    }

    if (manufacturer) {
      query = query.eq('manufacturer', manufacturer);
    }

    const { data: invalidSwatches, error: fetchError } = await query.limit(limit);

    if (fetchError) {
      console.error('Error fetching swatches:', fetchError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch swatches' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!invalidSwatches || invalidSwatches.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No swatches need repair',
          repaired: 0 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 Found ${invalidSwatches.length} swatches to repair`);

    const results: Array<{
      id: string;
      manufacturer: string;
      name: string;
      status: string;
      error?: string;
    }> = [];

    for (const swatch of invalidSwatches) {
      try {
        console.log(`\n🔧 Repairing: ${swatch.manufacturer} ${swatch.name}`);
        let repaired = false;

        // Step 1: Check if we need to search for reference images
        const { data: existingRefs } = await supabase
          .from('vinyl_reference_images')
          .select('id, image_url, is_verified, score')
          .eq('swatch_id', swatch.id)
          .order('score', { ascending: false })
          .limit(5);

        // If no references, try to search for them
        if (!existingRefs || existingRefs.length === 0) {
          console.log('🔍 No references found, searching web...');
          
          const searchResponse = await supabase.functions.invoke('search-vinyl-product-images', {
            body: {
              manufacturer: swatch.manufacturer,
              colorName: swatch.name,
              productCode: swatch.code
            }
          });

          if (searchResponse.data?.photos && searchResponse.data.photos.length > 0) {
            console.log(`✅ Found ${searchResponse.data.photos.length} web images`);
            
            // Store the found images
            for (const photo of searchResponse.data.photos.slice(0, 5)) {
              await supabase.from('vinyl_reference_images').upsert({
                swatch_id: swatch.id,
                manufacturer: swatch.manufacturer,
                color_name: swatch.name,
                product_code: swatch.code,
                image_url: photo.url,
                source_url: photo.source,
                image_type: 'web_search',
                search_query: `${swatch.manufacturer} ${swatch.code || ''} ${swatch.name} vinyl wrap`
              }, { 
                onConflict: 'swatch_id,image_url',
                ignoreDuplicates: true 
              });
            }
            repaired = true;
          }
        }

        // Step 2: Validate and score reference images
        const validateResponse = await supabase.functions.invoke('validate-swatch-images', {
          body: { swatch_id: swatch.id }
        });

        if (validateResponse.data?.success) {
          console.log(`✅ Validated images, best score: ${validateResponse.data.best_image?.score}`);
          repaired = true;
        }

        // Step 3: Extract material profile if we have a good image
        if (validateResponse.data?.best_image?.score >= 0.5) {
          const profileResponse = await supabase.functions.invoke('extract-material-profile', {
            body: { 
              swatch_id: swatch.id,
              image_url: validateResponse.data.best_image.url
            }
          });

          if (profileResponse.data?.success) {
            console.log(`✅ Extracted material profile`);
            repaired = true;
          }
        }

        results.push({
          id: swatch.id,
          manufacturer: swatch.manufacturer,
          name: swatch.name,
          status: repaired ? 'repaired' : 'no_changes'
        });

      } catch (swatchError) {
        console.error(`Error repairing swatch ${swatch.id}:`, swatchError);
        results.push({
          id: swatch.id,
          manufacturer: swatch.manufacturer,
          name: swatch.name,
          status: 'error',
          error: swatchError instanceof Error ? swatchError.message : 'Unknown error'
        });
      }
    }

    const repairedCount = results.filter(r => r.status === 'repaired').length;
    const errorCount = results.filter(r => r.status === 'error').length;

    console.log(`\n✅ Repair job complete: ${repairedCount} repaired, ${errorCount} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        total_processed: results.length,
        repaired: repairedCount,
        errors: errorCount,
        results
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in repair-invalid-swatches:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
