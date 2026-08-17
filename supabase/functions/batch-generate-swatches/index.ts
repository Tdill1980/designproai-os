import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient, getExternalSupabaseUrl, getExternalServiceRoleKey } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { colorLibrary, limit = 10 } = await req.json();

    // Connect to EXTERNAL database
    const supabase = createExternalClient();
    const supabaseUrl = getExternalSupabaseUrl();
    const supabaseKey = getExternalServiceRoleKey();

    console.log(`Batch generating swatches for ${colorLibrary}, limit: ${limit}`);

    // Get colors that need swatches generated (placeholder URLs)
    let query = supabase
      .from('inkfusion_swatches')
      .select('id, name, finish, color_library, hex')
      .like('media_url', 'https://placeholder%')
      .limit(limit);

    if (colorLibrary) {
      query = query.eq('color_library', colorLibrary);
    }

    const { data: colors, error: fetchError } = await query;

    if (fetchError) {
      throw fetchError;
    }

    if (!colors || colors.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No colors with placeholder URLs found',
          generated: 0,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${colors.length} colors to process`);

    const results = [];
    const errors = [];

    // Process colors sequentially to avoid rate limits
    for (const color of colors) {
      try {
        console.log(`Processing: ${color.name} (${color.finish})`);

        // Call the generate-vinyl-swatch function
        const generateResponse = await fetch(`${supabaseUrl}/functions/v1/generate-vinyl-swatch`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            colorName: color.name,
            finish: color.finish,
            colorLibrary: color.color_library,
            swatchId: color.id,
          }),
        });

        if (!generateResponse.ok) {
          const errorText = await generateResponse.text();
          throw new Error(`Generation failed: ${errorText}`);
        }

        const generateData = await generateResponse.json();

        // Update database with new URL
        const { error: updateError } = await supabase
          .from('inkfusion_swatches')
          .update({ media_url: generateData.imageUrl })
          .eq('id', color.id);

        if (updateError) {
          throw updateError;
        }

        results.push({
          id: color.id,
          name: color.name,
          imageUrl: generateData.imageUrl,
        });

        console.log(`✓ Generated swatch for ${color.name}`);

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`✗ Failed for ${color.name}:`, error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        errors.push({
          name: color.name,
          error: errorMessage,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        generated: results.length,
        failed: errors.length,
        results,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in batch-generate-swatches:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
