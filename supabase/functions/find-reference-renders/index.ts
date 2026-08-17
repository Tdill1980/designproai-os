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
    const { manufacturer, colorName, finish, hex, swatchId } = await req.json();
    
    console.log('🔍 Finding reference renders:', { manufacturer, colorName, finish, hex, swatchId });

    // Connect to EXTERNAL database for data operations
    const supabase = createExternalClient();
    const supabaseUrl = getExternalSupabaseUrl();
    const supabaseKey = getExternalServiceRoleKey();

    // ============= PRIORITY 1: CHECK STORED VINYL REFERENCE IMAGES (FASTEST) =============
    // These are pre-fetched real product photos stored in our database
    console.log('📸 Priority 1: Checking stored vinyl reference images...');
    
    let refQuery = supabase
      .from('vinyl_reference_images')
      .select('image_url, image_type, color_characteristics, is_verified, manufacturer, color_name')
      .order('is_verified', { ascending: false }) // Prefer verified
      .order('image_type', { ascending: true }) // Prefer vehicle_installation
      .limit(5);
    
    // Use swatchId if provided for exact match
    if (swatchId) {
      refQuery = refQuery.eq('swatch_id', swatchId);
    } else if (manufacturer && colorName) {
      refQuery = refQuery
        .eq('manufacturer', manufacturer)
        .ilike('color_name', colorName);
    }
    
    const { data: storedRefs, error: storedRefError } = await refQuery;
    
    if (storedRefs && storedRefs.length > 0 && !storedRefError) {
      console.log(`✅ Found ${storedRefs.length} STORED reference images (instant lookup)`);
      
      return new Response(
        JSON.stringify({ 
          references: storedRefs.slice(0, 3).map(ref => ({
            url: ref.image_url,
            colorData: { 
              manufacturer: ref.manufacturer, 
              colorName: ref.color_name, 
              finish,
              hex,
              ...ref.color_characteristics 
            },
            qualityVerified: ref.is_verified,
            isWebReference: false,
            isStoredReference: true
          })),
          source: 'stored_vinyl_references'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============= PRIORITY 2: SEARCH WEB FOR REAL PRODUCT IMAGES =============
    // Live web search if no stored references found
    console.log('🌐 Priority 2: Searching web for REAL product installation photos...');
    
    try {
      const searchResponse = await fetch(`${supabaseUrl}/functions/v1/search-vinyl-product-images`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          manufacturer,
          colorName,
          productCode: null, // Will be extracted from colorName if present
        }),
      });

      if (searchResponse.ok) {
        const searchData = await searchResponse.json();
        
        if (searchData.photos && searchData.photos.length > 0) {
          console.log(`✅ Found ${searchData.photos.length} REAL web images (${searchData.photoType})`);
          
          // Return web images as references (prioritized over our cached renders)
          return new Response(
            JSON.stringify({ 
              references: searchData.photos.slice(0, 3).map((photo: any) => ({
                url: photo.url || photo,
                colorData: { manufacturer, colorName, finish, hex },
                qualityVerified: true, // Web images are considered verified
                isWebReference: true // Flag to indicate this is from web search
              })),
              source: 'web_search'
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }
    } catch (webError) {
      console.error('⚠️ Web search failed, falling back to database:', webError);
    }

    // ============= PRIORITY 3: ONLY USE QUALITY-VERIFIED DATABASE RENDERS =============
    // Only return our own renders if they are explicitly quality_verified = true
    console.log('🔍 Priority 3: Searching for QUALITY-VERIFIED database renders only...');
    
    let query = supabase
      .from('vehicle_renders')
      .select('id, render_url, color_data, created_at, quality_verified, reference_count')
      .eq('quality_verified', true) // CRITICAL: Only return verified renders
      .order('reference_count', { ascending: false }) // Most-used first
      .order('created_at', { ascending: false })
      .limit(3);

    if (manufacturer) {
      query = query.ilike('color_data->>manufacturer', manufacturer);
    }
    if (colorName) {
      query = query.ilike('color_data->>colorName', colorName);
    }
    if (finish) {
      query = query.eq('color_data->>finish', finish);
    }

    const { data: verifiedMatches, error: dbError } = await query;

    if (dbError) {
      console.error('Error searching for verified matches:', dbError);
      return new Response(
        JSON.stringify({ references: [], source: 'none' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (verifiedMatches && verifiedMatches.length > 0) {
      console.log(`✅ Found ${verifiedMatches.length} QUALITY-VERIFIED database matches`);
      
      // Increment reference_count for each used render
      for (const match of verifiedMatches) {
        await supabase
          .from('vehicle_renders')
          .update({ reference_count: (match.reference_count || 0) + 1 })
          .eq('id', match.id);
      }

      return new Response(
        JSON.stringify({ 
          references: verifiedMatches.map(m => ({
            url: m.render_url,
            colorData: m.color_data,
            qualityVerified: m.quality_verified,
            isWebReference: false
          })),
          source: 'database_verified'
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // No verified references found - DO NOT return unverified renders
    // This forces the AI to generate from description only, which is better than bad references
    console.log('ℹ️ No verified reference renders found - generating from description only');
    return new Response(
      JSON.stringify({ references: [], source: 'none' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in find-reference-renders:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error', references: [], source: 'error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
