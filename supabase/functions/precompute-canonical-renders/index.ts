import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient, getExternalSupabaseUrl, getExternalServiceRoleKey } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CANONICAL_VEHICLES = [
  { year: 2024, make: "Tesla", model: "Model Y" },
  { year: 2024, make: "Ford", model: "F-150" }
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = getExternalSupabaseUrl();
    const supabaseServiceKey = getExternalServiceRoleKey();
    const supabase = createExternalClient();

    // Parse request body for optional parameters
    let batchSize = 5;
    let startFrom = 0;
    let manufacturerFilter: string | null = null;
    let vehicleIndex = 0; // Which canonical vehicle to use

    try {
      const body = await req.json();
      batchSize = body.batchSize || 5;
      startFrom = body.startFrom || 0;
      manufacturerFilter = body.manufacturer || null;
      vehicleIndex = body.vehicleIndex || 0;
    } catch {
      // Use defaults if no body
    }

    const vehicle = CANONICAL_VEHICLES[vehicleIndex % CANONICAL_VEHICLES.length];
    console.log(`Starting canonical render precompute - vehicle: ${vehicle.year} ${vehicle.make} ${vehicle.model}, batch: ${batchSize}`);

    // Get colors that have reference bundles but no canonical demo renders
    let query = supabase
      .from('vinyl_swatches')
      .select('id, manufacturer, name, code, finish, hex, series, metallic, pearl, chrome, is_flip_film')
      .eq('verified', true)
      .eq('has_reference_bundle', true);

    if (manufacturerFilter) {
      query = query.ilike('manufacturer', `%${manufacturerFilter}%`);
    }

    const { data: colors, error: fetchError } = await query
      .order('manufacturer', { ascending: true })
      .order('name', { ascending: true })
      .range(startFrom, startFrom + batchSize - 1);

    if (fetchError) {
      console.error('Error fetching colors:', fetchError);
      throw fetchError;
    }

    if (!colors || colors.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        message: 'No colors found with reference bundles',
        processed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    console.log(`Processing ${colors.length} colors for canonical renders`);

    const results: Array<{
      colorId: string;
      manufacturer: string;
      colorName: string;
      renderUrl?: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const color of colors) {
      try {
        console.log(`Generating canonical render for: ${color.manufacturer} ${color.name}`);

        // Check if canonical demo already exists for this color + vehicle
        const vehicleKey = `${vehicle.year}_${vehicle.make}_${vehicle.model}`.toLowerCase().replace(/\s+/g, '_');
        
        const { data: existingRender } = await supabase
          .from('vehicle_renders')
          .select('id')
          .eq('color_data->>swatchId', color.id)
          .eq('vehicle_make', vehicle.make)
          .eq('vehicle_model', vehicle.model)
          .eq('is_canonical_demo', true)
          .limit(1);

        if (existingRender && existingRender.length > 0) {
          console.log(`Canonical render already exists for ${color.name}, skipping`);
          results.push({
            colorId: color.id,
            manufacturer: color.manufacturer,
            colorName: color.name,
            success: true,
            error: 'Already exists'
          });
          continue;
        }

        // Call generate-color-render to create the canonical demo
        const payload = {
          vehicleYear: vehicle.year,
          vehicleMake: vehicle.make,
          vehicleModel: vehicle.model,
          colorData: {
            swatchId: color.id,
            hex: color.hex,
            colorName: color.name,
            manufacturer: color.manufacturer,
            productCode: color.code,
            finish: color.finish,
            metallic: color.metallic,
            pearl: color.pearl,
            chrome: color.chrome,
            isFlipFilm: color.is_flip_film
          },
          finish: color.finish || 'gloss',
          viewType: 'hood_detail',
          modeType: 'colorpro',
          isCanonicalDemo: true // Flag to mark this as canonical
        };

        const renderResponse = await fetch(`${supabaseUrl}/functions/v1/generate-color-render`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${supabaseServiceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        if (!renderResponse.ok) {
          const errorText = await renderResponse.text();
          console.error(`Render failed for ${color.name}:`, errorText);
          results.push({
            colorId: color.id,
            manufacturer: color.manufacturer,
            colorName: color.name,
            success: false,
            error: `Render failed: ${renderResponse.status}`
          });
          continue;
        }

        const renderData = await renderResponse.json();

        // Mark the render as canonical demo in vehicle_renders
        if (renderData.renderUrl || renderData.render_url) {
          const { error: updateError } = await supabase
            .from('vehicle_renders')
            .update({ is_canonical_demo: true })
            .eq('render_url', renderData.renderUrl || renderData.render_url);

          if (updateError) {
            console.error(`Error marking render as canonical:`, updateError);
          }
        }

        results.push({
          colorId: color.id,
          manufacturer: color.manufacturer,
          colorName: color.name,
          renderUrl: renderData.renderUrl || renderData.render_url,
          success: true
        });

        // Rate limit - 2 seconds between AI calls
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (colorError) {
        console.error(`Error processing ${color.manufacturer} ${color.name}:`, colorError);
        results.push({
          colorId: color.id,
          manufacturer: color.manufacturer,
          colorName: color.name,
          success: false,
          error: colorError instanceof Error ? colorError.message : 'Unknown error'
        });
      }
    }

    const successCount = results.filter(r => r.success && !r.error?.includes('Already exists')).length;
    const skippedCount = results.filter(r => r.error?.includes('Already exists')).length;

    return new Response(JSON.stringify({
      success: true,
      message: `Processed ${colors.length} colors`,
      vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      stats: {
        processed: colors.length,
        newRenders: successCount,
        skipped: skippedCount,
        failed: results.filter(r => !r.success).length,
        nextOffset: startFrom + batchSize
      },
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Precompute error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
