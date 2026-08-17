/**
 * V1 BULK IMPORT — Import legacy V1 design renders into neuralnetwork_design_dna
 *
 * Accepts a list of V1 render image URLs and creates DNA records for each one.
 * Source is set to 'v1_legacy' for filtering.
 *
 * POST body:
 * {
 *   "designs": [
 *     {
 *       "imageUrl": "https://...",            // Required: render image URL
 *       "vehicleYear": "2024",                // Optional
 *       "vehicleMake": "Ford",                // Optional
 *       "vehicleModel": "F-250",              // Optional
 *       "mode": "commercial",                 // Optional: restyle | commercial
 *       "industryType": "construction",       // Optional
 *       "companyName": "TimberBuilt",         // Optional
 *       "designName": "TimberWrap Elite",     // Optional
 *       "designTags": ["truck", "wood", "partial"] // Optional
 *     }
 *   ]
 * }
 *
 * Returns: { success: true, imported: number, errors: string[] }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createExternalClient();
    const { designs } = await req.json();

    if (!designs || !Array.isArray(designs)) {
      return new Response(
        JSON.stringify({ error: 'designs array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[V1 Bulk Import] Starting import of ${designs.length} designs`);

    let imported = 0;
    const errors: string[] = [];

    for (const design of designs) {
      try {
        if (!design.imageUrl) {
          errors.push(`Skipped design: no imageUrl provided`);
          continue;
        }

        // Check for duplicate by render URL
        const { data: existing } = await supabase
          .from('neuralnetwork_design_dna')
          .select('id')
          .eq('vehicle_render_url', design.imageUrl)
          .maybeSingle();

        if (existing) {
          console.log(`[V1 Import] Skipped duplicate: ${design.imageUrl.substring(0, 60)}...`);
          continue;
        }

        // Build all_render_urls array
        const allUrls = [{ type: 'hero', url: design.imageUrl }];
        if (design.additionalUrls && Array.isArray(design.additionalUrls)) {
          for (const extra of design.additionalUrls) {
            allUrls.push({ type: extra.type || 'additional', url: extra.url });
          }
        }

        const { error: insertError } = await supabase
          .from('neuralnetwork_design_dna')
          .insert({
            vehicle_year: design.vehicleYear || null,
            vehicle_make: design.vehicleMake || null,
            vehicle_model: design.vehicleModel || null,
            vehicle_render_url: design.imageUrl,
            all_render_urls: allUrls,
            mode: design.mode || 'commercial',
            industry_type: design.industryType || null,
            company_name: design.companyName || null,
            design_name: design.designName || null,
            design_tags: design.designTags || [],
            source: 'v1_legacy',
          });

        if (insertError) {
          errors.push(`Failed to import ${design.imageUrl.substring(0, 60)}: ${insertError.message}`);
          console.error('[V1 Import] Insert error:', insertError);
        } else {
          imported++;
          console.log(`[V1 Import] Imported: ${design.designName || design.imageUrl.substring(0, 60)}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        errors.push(`Error processing design: ${msg}`);
      }
    }

    console.log(`[V1 Bulk Import] Complete: ${imported} imported, ${errors.length} errors`);

    return new Response(
      JSON.stringify({
        success: true,
        imported,
        skippedDuplicates: designs.length - imported - errors.length,
        errors,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[V1 Bulk Import] Fatal error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
