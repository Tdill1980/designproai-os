import { createExternalClient, getExternalSupabaseUrl } from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";

const supabase = createExternalClient();

const MIN_CONFIDENCE = 0.75;
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1200;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function needsUpdate(swatch: any): boolean {
  return (
    !swatch.media_url ||
    !swatch.lab ||
    !swatch.material_validated ||
    (swatch.ai_confidence !== null && swatch.ai_confidence < MIN_CONFIDENCE) ||
    !swatch.reference_image_count ||
    swatch.reference_image_count === 0
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("🚀 Incremental Wrap Swatch Updater — START");

    const { data: swatches } = await supabase
      .from("vinyl_swatches")
      .select("*")
      .order("manufacturer")
      .order("name");

    if (!swatches || swatches.length === 0) {
      return new Response(JSON.stringify({ 
        status: "complete", 
        message: "No swatches found",
        success: 0,
        failed: 0 
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const toUpdate = swatches.filter(needsUpdate);

    console.log(`📊 Found ${toUpdate.length} swatches needing update out of ${swatches.length} total`);

    if (toUpdate.length === 0) {
      return new Response(JSON.stringify({ 
        status: "complete", 
        message: "All swatches are up to date",
        success: 0,
        failed: 0 
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let success = 0;
    let failed = 0;

    for (let i = 0; i < toUpdate.length; i += BATCH_SIZE) {
      const batch = toUpdate.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(toUpdate.length / BATCH_SIZE);
      
      console.log(`📦 Processing batch ${batchNum}/${totalBatches}`);

      const results = await Promise.all(
        batch.map(async (swatch) => {
          try {
            const response = await fetch(
              `${getExternalSupabaseUrl()}/functions/v1/ingest-all-wrap-swatch-colors`,
              {
                method: "POST",
                headers: { 
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`
                },
                body: JSON.stringify({
                  manufacturer: swatch.manufacturer,
                  limit: 1,
                  skipValidated: false,
                  onlyMissingMaterial: !swatch.lab,
                  onlyMissingMedia: !swatch.media_url
                })
              }
            );
            return response.ok;
          } catch (e) {
            console.error(`❌ Failed to update ${swatch.manufacturer} ${swatch.name}:`, e);
            return false;
          }
        })
      );

      results.forEach(ok => {
        if (ok) success++;
        else failed++;
      });

      if (i + BATCH_SIZE < toUpdate.length) {
        await sleep(BATCH_DELAY_MS);
      }
    }

    console.log(`🔥 Incremental update complete: ${success} success, ${failed} failed`);

    return new Response(JSON.stringify({
      status: "complete",
      totalSwatches: swatches.length,
      needingUpdate: toUpdate.length,
      success,
      failed,
    }), { 
      headers: { ...corsHeaders, "Content-Type": "application/json" } 
    });

  } catch (e: any) {
    console.error("❌ Incremental Updater Error:", e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
