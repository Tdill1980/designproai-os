import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

/**
 * Cron worker — picks up email_campaigns where status='scheduled'
 * and scheduled_at <= now(), then invokes send-email-campaign for each.
 *
 * Meant to be called on a ~1 minute interval via pg_cron (see
 * sql/setup-scheduled-campaigns-cron.sql).
 *
 * Also callable directly via POST for manual triggering.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createExternalClient();
    const projectUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("EXTERNAL_SUPABASE_URL") || "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("EXTERNAL_SUPABASE_SERVICE_ROLE_KEY") || "";

    const nowIso = new Date().toISOString();

    // Find due scheduled campaigns
    const { data: due, error: fetchError } = await supabase
      .from("email_campaigns")
      .select("id, name, scheduled_at, status")
      .eq("status", "scheduled")
      .lte("scheduled_at", nowIso)
      .order("scheduled_at", { ascending: true })
      .limit(25);

    if (fetchError) {
      console.error("process-scheduled-campaigns fetch error:", fetchError);
      return new Response(
        JSON.stringify({ error: fetchError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!due || due.length === 0) {
      return new Response(
        JSON.stringify({ success: true, processed: 0, message: "No scheduled campaigns due" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Processing ${due.length} scheduled campaign(s)`);

    const results: Array<{ id: string; status: string; error?: string }> = [];

    for (const campaign of due) {
      try {
        // Claim the campaign — flip to 'sending' so concurrent cron ticks don't double-send
        const { data: claimed, error: claimError } = await supabase
          .from("email_campaigns")
          .update({ status: "sending", updated_at: new Date().toISOString() })
          .eq("id", campaign.id)
          .eq("status", "scheduled")
          .select("id")
          .maybeSingle();

        if (claimError || !claimed) {
          results.push({ id: campaign.id, status: "skipped", error: "claim failed or already processing" });
          continue;
        }

        // Invoke send-email-campaign as a sub-request
        const sendResp = await fetch(`${projectUrl}/functions/v1/send-email-campaign`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ campaignId: campaign.id }),
        });

        const sendBody = await sendResp.json().catch(() => ({}));

        if (!sendResp.ok || !sendBody?.success) {
          console.error(`Send failed for campaign ${campaign.id}:`, sendBody);
          // Mark back to failed so it doesn't get stuck in 'sending'
          await supabase
            .from("email_campaigns")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", campaign.id);
          results.push({ id: campaign.id, status: "failed", error: sendBody?.error || "send failed" });
        } else {
          results.push({ id: campaign.id, status: "sent" });
        }
      } catch (err: any) {
        console.error(`Error processing campaign ${campaign.id}:`, err);
        await supabase
          .from("email_campaigns")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", campaign.id);
        results.push({ id: campaign.id, status: "failed", error: err.message });
      }
    }

    return new Response(
      JSON.stringify({ success: true, processed: results.length, results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("process-scheduled-campaigns error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
