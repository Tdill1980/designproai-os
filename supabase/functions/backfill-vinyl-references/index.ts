import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient, getExternalSupabaseUrl, getExternalServiceRoleKey } from "../_shared/external-db.ts";

// Declare EdgeRuntime for Supabase background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const FLIP_FILM_KEYWORDS = [
  'flip', 'chameleon', 'colorflow', 'color flow', 'iridescent', 
  'psychedelic', 'color shift', 'volcanic', 'flare', 'prism',
  'prismatic', 'dichroic', 'holographic', 'spectral'
];

function isFlipFilm(name: string): boolean {
  const lower = name.toLowerCase();
  return FLIP_FILM_KEYWORDS.some(keyword => lower.includes(keyword));
}

interface SearchResult {
  images: Array<{ url: string; source: string; title: string; isVehicle: boolean }>;
  filmDescription: string;
  baseColor: string;
  effect: string;
  hasMetallicFlake: boolean;
  isColorShift: boolean;
}

async function searchVinylImages(
  supabaseUrl: string,
  supabaseKey: string,
  manufacturer: string,
  colorName: string,
  productCode?: string | null
): Promise<SearchResult> {
  console.log(`Calling search-vinyl-product-images (Google Grounding) for: ${manufacturer} ${colorName}`);

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/search-vinyl-product-images`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        manufacturer,
        colorName,
        productCode
      }),
    });

    if (!response.ok) {
      console.error('search-vinyl-product-images failed:', response.status);
      return { images: [], filmDescription: '', baseColor: '', effect: '', hasMetallicFlake: false, isColorShift: false };
    }

    const data = await response.json();
    const photos = data.photos || [];

    console.log(`Found ${photos.length} images + description via Google Grounding`);

    const images = photos.map((photo: any) => ({
      url: photo.url || photo,
      source: photo.source || '',
      title: photo.title || `${manufacturer} ${colorName}`,
      isVehicle: photo.title?.toLowerCase().includes('wrap') ||
                 photo.title?.toLowerCase().includes('install') ||
                 photo.title?.toLowerCase().includes('vehicle') ||
                 data.photoType === 'vehicle_installation'
    }));

    return {
      images,
      filmDescription: data.filmDescription || '',
      baseColor: data.baseColor || '',
      effect: data.effect || '',
      hasMetallicFlake: data.hasMetallicFlake || false,
      isColorShift: data.isColorShift || false,
    };
  } catch (error) {
    console.error('Error in searchVinylImages:', error);
    return { images: [], filmDescription: '', baseColor: '', effect: '', hasMetallicFlake: false, isColorShift: false };
  }
}

async function processBackfill(
  supabaseUrl: string,
  supabaseServiceKey: string,
  batchSize: number,
  startFrom: number,
  manufacturerFilter: string | null,
  forceRefresh: boolean
) {
  const supabase = createExternalClient();

  console.log(`Starting backfill - batch: ${batchSize}, offset: ${startFrom}, manufacturer: ${manufacturerFilter || 'all'}`);

  // Get colors that need reference bundles
  let query = supabase
    .from('vinyl_swatches')
    .select('id, manufacturer, name, code, finish, series')
    .eq('verified', true);

  if (!forceRefresh) {
    query = query.eq('has_reference_bundle', false);
  }

  if (manufacturerFilter) {
    query = query.ilike('manufacturer', `%${manufacturerFilter}%`);
  }

  const { data: colors, error: fetchError } = await query
    .order('manufacturer', { ascending: true })
    .order('name', { ascending: true })
    .range(startFrom, startFrom + batchSize - 1);

  if (fetchError) {
    console.error('Error fetching colors:', fetchError);
    return;
  }

  if (!colors || colors.length === 0) {
    console.log('No colors found needing reference bundles');
    return;
  }

  console.log(`Processing ${colors.length} colors in background`);

  for (const color of colors) {
    try {
      console.log(`Processing: ${color.manufacturer} ${color.name}`);

      // Search for reference images + grounded film description
      const result = await searchVinylImages(
        supabaseUrl,
        supabaseServiceKey,
        color.manufacturer,
        color.name,
        color.code
      );

      // Determine if this is a flip film (from name keywords OR grounding result)
      const flipFilm = isFlipFilm(color.name) || result.isColorShift;

      if (result.images.length > 0) {
        // Store reference images
        const insertData = result.images.map(img => ({
          swatch_id: color.id,
          manufacturer: color.manufacturer,
          color_name: color.name,
          product_code: color.code,
          image_url: img.url,
          source_url: img.source,
          image_type: img.isVehicle ? 'vehicle_installation' : 'product_sheet',
          search_query: `${color.manufacturer} ${color.code || ''} ${color.name} vinyl wrap`,
          color_characteristics: {
            finish: color.finish,
            series: color.series,
            is_flip: flipFilm,
            baseColor: result.baseColor,
            effect: result.effect,
            hasMetallicFlake: result.hasMetallicFlake,
            filmDescription: result.filmDescription,
          }
        }));

        // Upsert to handle duplicates
        const { error: insertError } = await supabase
          .from('vinyl_reference_images')
          .upsert(insertData, {
            onConflict: 'swatch_id,image_url',
            ignoreDuplicates: true
          });

        if (insertError) {
          console.error(`Error inserting references for ${color.name}:`, insertError);
        }
      }

      // Update swatch with flags + grounded film description
      const updatePayload: Record<string, any> = {
        has_reference_bundle: result.images.length > 0 || !!result.filmDescription,
        is_flip_film: flipFilm,
        needs_reference_review: flipFilm,
        reference_image_count: result.images.length,
      };

      const { error: updateError } = await supabase
        .from('vinyl_swatches')
        .update(updatePayload)
        .eq('id', color.id);

      if (updateError) {
        console.error(`Error updating swatch ${color.name}:`, updateError);
      }

      // Also update manufacturer_colors with grounded description
      if (result.filmDescription) {
        const { error: mfcError } = await supabase
          .from('manufacturer_colors')
          .update({
            grounded_description: result.filmDescription,
            grounded_base_color: result.baseColor,
            grounded_effect: result.effect,
          })
          .eq('manufacturer', color.manufacturer)
          .ilike('official_name', color.name);

        if (mfcError) {
          console.log(`Note: Could not update manufacturer_colors for ${color.name} (columns may not exist yet)`);
        }
      }

      console.log(`✅ Completed: ${color.manufacturer} ${color.name} - ${result.images.length} images, description: ${result.filmDescription ? 'YES' : 'NO'}`);

      // Rate limit: 500ms between calls (Gemini grounding is heavier than DataForSEO)
      await new Promise(resolve => setTimeout(resolve, 500));

    } catch (colorError) {
      console.error(`Error processing ${color.manufacturer} ${color.name}:`, colorError);
    }
  }

  console.log(`✅ Backfill batch complete for ${manufacturerFilter || 'all manufacturers'}`);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('EXTERNAL_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('EXTERNAL_SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createExternalClient();

    // Parse request body for optional parameters
    let batchSize = 50;
    let startFrom = 0;
    let manufacturerFilter: string | null = null;
    let forceRefresh = false;

    try {
      const body = await req.json();
      batchSize = body.batchSize || 50;
      startFrom = body.startFrom || 0;
      manufacturerFilter = body.manufacturerFilter || body.manufacturer || null;
      forceRefresh = body.forceRefresh || false;
    } catch {
      // Use defaults if no body
    }

    // Get count of remaining colors before starting
    let countQuery = supabase
      .from('vinyl_swatches')
      .select('*', { count: 'exact', head: true })
      .eq('verified', true)
      .eq('has_reference_bundle', false);

    if (manufacturerFilter) {
      countQuery = countQuery.ilike('manufacturer', `%${manufacturerFilter}%`);
    }

    const { count: remainingCount } = await countQuery;

    // Start background processing
    EdgeRuntime.waitUntil(
      processBackfill(
        supabaseUrl,
        supabaseServiceKey,
        batchSize,
        startFrom,
        manufacturerFilter,
        forceRefresh
      )
    );

    // Return immediately
    return new Response(JSON.stringify({
      success: true,
      message: `Backfill started in background for ${manufacturerFilter || 'all manufacturers'}`,
      stats: {
        batchSize,
        startFrom,
        remainingColors: remainingCount || 0,
        manufacturer: manufacturerFilter || 'all'
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Backfill error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

// Handle shutdown gracefully
addEventListener('beforeunload', (ev: Event) => {
  console.log('Function shutting down, backfill may be incomplete:', (ev as any).detail?.reason);
});