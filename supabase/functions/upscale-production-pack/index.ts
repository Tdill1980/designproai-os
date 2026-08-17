/**
 * upscale-production-pack — Background orchestrator for sequential panel upscaling
 *
 * Called fire-and-forget by generate-production-files after base-res pack is delivered.
 * Processes each panel one at a time to stay within memory limits (~20MB per panel).
 *
 * For each panel:
 *   1. Get signed URL for the base-res panel in storage
 *   2. Call upscale-production-panel (Replicate Real-ESRGAN 2x)
 *   3. Download upscaled result
 *   4. Replace panel in storage at same path
 *   5. Update production_packs.upscale_progress (e.g. "2/4")
 *
 * On completion: upscale_status = "complete"
 * On failure: upscale_status = "failed" + upscale_error
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface PanelToUpscale {
  id: string;
  label: string;
  filename: string;
  storagePath: string;
  dpi?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceKey);

  let packId: string | null = null;

  try {
    const { production_pack_id, panels, storage_prefix } = await req.json();
    packId = production_pack_id;

    if (!production_pack_id || !panels || !Array.isArray(panels)) {
      throw new Error("Missing required fields: production_pack_id, panels");
    }

    console.log(`\n[UPSCALE-PACK] Starting background upscale for pack ${production_pack_id}`);
    console.log(`  Panels: ${panels.length}`);

    const totalPanels = panels.length;
    let completedPanels = 0;
    const functionsUrl = `${supabaseUrl}/functions/v1`;

    // Process panels sequentially to stay within memory limits
    for (const panel of panels as PanelToUpscale[]) {
      try {
        console.log(`\n  [${completedPanels + 1}/${totalPanels}] Upscaling: ${panel.label} (${panel.filename})`);

        // Get signed URL for the base-res panel
        const { data: signedData, error: signedError } = await supabase.storage
          .from("wrap-files")
          .createSignedUrl(panel.storagePath, 3600);

        if (signedError || !signedData?.signedUrl) {
          console.error(`    Failed to get signed URL: ${signedError?.message}`);
          continue;
        }

        // Call upscale-production-panel (existing function)
        const upscaleResp = await fetch(`${functionsUrl}/upscale-production-panel`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            image_url: signedData.signedUrl,
            panel_id: panel.id,
            production_pack_id,
            scale: 2,
            input_dpi: panel.dpi,
          }),
        });

        if (!upscaleResp.ok) {
          const errText = await upscaleResp.text();
          console.error(`    Upscale API error: ${errText.slice(0, 300)}`);
          continue;
        }

        const upscaleResult = await upscaleResp.json();

        if (!upscaleResult.success || !upscaleResult.upscaled_url) {
          console.error(`    Upscale returned no URL: ${upscaleResult.error || "unknown"}`);
          continue;
        }

        // Download the upscaled image
        const upscaledResp = await fetch(upscaleResult.upscaled_url);
        if (!upscaledResp.ok) {
          console.error(`    Failed to download upscaled image (${upscaledResp.status})`);
          continue;
        }

        const upscaledData = new Uint8Array(await upscaledResp.arrayBuffer());
        console.log(`    Downloaded upscaled: ${(upscaledData.byteLength / 1024).toFixed(0)} KB`);

        // Replace the base-res panel in storage with the upscaled version
        const { error: replaceError } = await supabase.storage
          .from("wrap-files")
          .upload(panel.storagePath, upscaledData, {
            upsert: true,
            contentType: "image/png",
          });

        if (replaceError) {
          console.error(`    Storage replace error: ${replaceError.message}`);
          continue;
        }

        completedPanels++;
        console.log(`    Done (${completedPanels}/${totalPanels})`);

        // Update progress in DB — client polls this
        await supabase
          .from("production_packs")
          .update({ upscale_progress: `${completedPanels}/${totalPanels}` })
          .eq("id", production_pack_id);

      } catch (panelErr) {
        console.error(`    Panel error: ${panelErr}`);
      }
    }

    // Final status
    const finalStatus = completedPanels === totalPanels ? "complete" : "failed";
    const updatePayload: Record<string, string> = {
      upscale_status: finalStatus,
      upscale_progress: `${completedPanels}/${totalPanels}`,
    };
    if (finalStatus === "failed") {
      updatePayload.upscale_error = `${completedPanels}/${totalPanels} panels upscaled`;
    }

    await supabase
      .from("production_packs")
      .update(updatePayload)
      .eq("id", production_pack_id);

    console.log(`\n[UPSCALE-PACK] Complete: ${finalStatus} (${completedPanels}/${totalPanels})`);

    return new Response(
      JSON.stringify({ status: finalStatus, completed: completedPanels, total: totalPanels }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[UPSCALE-PACK] Fatal error:", err);

    if (packId) {
      await supabase
        .from("production_packs")
        .update({
          upscale_status: "failed",
          upscale_error: err instanceof Error ? err.message : "Unknown error",
        })
        .eq("id", packId);
    }

    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
