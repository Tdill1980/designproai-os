import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendCampaignRequest {
  campaignId: string;
}

function getTrackingPixel(projectUrl: string, campaignId: string, sendId: string): string {
  const trackUrl = `${projectUrl}/functions/v1/track-email-event?c=${campaignId}&s=${sendId}&t=open`;
  return `<img src="${trackUrl}" width="1" height="1" style="display:none" alt="" />`;
}

function wrapClickTracking(html: string, projectUrl: string, campaignId: string, sendId: string): string {
  // Replace href links with tracked redirect links
  return html.replace(
    /href="(https?:\/\/[^"]+)"/g,
    (match, url) => {
      const trackUrl = `${projectUrl}/functions/v1/track-email-event?c=${campaignId}&s=${sendId}&t=click&url=${encodeURIComponent(url)}`;
      return `href="${trackUrl}"`;
    }
  );
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { campaignId }: SendCampaignRequest = await req.json();

    if (!campaignId) {
      return new Response(
        JSON.stringify({ error: "campaignId is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createExternalClient();
    const projectUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("EXTERNAL_SUPABASE_URL") || "";

    // Fetch the campaign
    const { data: campaign, error: campaignError } = await supabase
      .from("email_campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();

    if (campaignError || !campaign) {
      return new Response(
        JSON.stringify({ error: "Campaign not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (campaign.status === "sent" || campaign.status === "sending") {
      return new Response(
        JSON.stringify({ error: `Campaign is already ${campaign.status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build recipient list based on audience
    let recipients: { email: string; user_id?: string; name?: string }[] = [];

    if (campaign.audience === "all_users") {
      const { data: users } = await supabase
        .from("auth.users")
        .select("id, email, raw_user_meta_data");

      // Fallback: query auth.users via RPC or direct SQL
      const { data: authUsers, error: authError } = await supabase.rpc("get_all_user_emails");

      if (authError) {
        // Direct query fallback
        const { data: directUsers } = await supabase
          .from("email_subscribers")
          .select("email")
          .eq("unsubscribed", false);

        // Also get auth users via admin API
        const { data: { users: adminUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });

        if (adminUsers) {
          recipients = adminUsers.map(u => ({
            email: u.email!,
            user_id: u.id,
            name: u.user_metadata?.full_name || u.user_metadata?.name || "",
          }));
        }
      } else if (authUsers) {
        recipients = authUsers.map((u: any) => ({
          email: u.email,
          user_id: u.id,
          name: u.name || "",
        }));
      }
    } else if (campaign.audience === "subscribers") {
      let subsQuery = supabase
        .from("email_subscribers")
        .select("email")
        .eq("unsubscribed", false);

      // Filter by source segment if specified
      if (campaign.subscriber_source && campaign.subscriber_source !== "all") {
        subsQuery = subsQuery.eq("source", campaign.subscriber_source);
      }

      const { data: subs } = await subsQuery;
      recipients = (subs || []).map(s => ({ email: s.email }));
    } else if (campaign.audience === "custom" && campaign.custom_emails?.length) {
      recipients = campaign.custom_emails.map((e: string) => ({ email: e }));
    }

    // Deduplicate by email
    const seen = new Set<string>();
    recipients = recipients.filter(r => {
      if (!r.email || seen.has(r.email.toLowerCase())) return false;
      seen.add(r.email.toLowerCase());
      return true;
    });

    if (recipients.length === 0) {
      return new Response(
        JSON.stringify({ error: "No recipients found for this audience" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Mark campaign as sending
    await supabase
      .from("email_campaigns")
      .update({
        status: "sending",
        total_recipients: recipients.length,
        sent_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    // Create send records for each recipient
    const sendRecords = recipients.map(r => ({
      campaign_id: campaignId,
      recipient_email: r.email,
      recipient_user_id: r.user_id || null,
      status: "pending",
    }));

    const { data: sends, error: sendInsertError } = await supabase
      .from("email_campaign_sends")
      .insert(sendRecords)
      .select("id, recipient_email, recipient_user_id");

    if (sendInsertError) {
      console.error("Failed to create send records:", sendInsertError);
      await supabase
        .from("email_campaigns")
        .update({ status: "failed" })
        .eq("id", campaignId);

      return new Response(
        JSON.stringify({ error: "Failed to create send records" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send emails with tracking
    let sentCount = 0;
    let failedCount = 0;

    for (const send of (sends || [])) {
      try {
        // Personalize content
        let html = campaign.html_content;
        const recipientData = recipients.find(r => r.email === send.recipient_email);

        html = html.replace(/\{\{customer_name\}\}/g, recipientData?.name || "there");
        html = html.replace(/\{\{customer_email\}\}/g, send.recipient_email);
        html = html.replace(/\{\{current_year\}\}/g, new Date().getFullYear().toString());
        html = html.replace(/\{\{unsubscribe_url\}\}/g,
          `${projectUrl}/functions/v1/track-email-event?c=${campaignId}&s=${send.id}&t=unsubscribe`
        );

        // Add click tracking to links
        html = wrapClickTracking(html, projectUrl, campaignId, send.id);

        // Append tracking pixel before closing </body> or at end
        const pixel = getTrackingPixel(projectUrl, campaignId, send.id);
        if (html.includes("</body>")) {
          html = html.replace("</body>", `${pixel}</body>`);
        } else {
          html += pixel;
        }

        const emailResult = await resend.emails.send({
          from: `${campaign.from_name || "RestylePro"} <${campaign.from_email || "onboarding@resend.dev"}>`,
          to: [send.recipient_email],
          subject: campaign.subject,
          html: html,
        });

        await supabase
          .from("email_campaign_sends")
          .update({
            status: "sent",
            resend_message_id: emailResult.data?.id || null,
          })
          .eq("id", send.id);

        sentCount++;

        // Rate limit: small delay between sends to avoid hitting Resend limits
        if (sentCount % 10 === 0) {
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (sendError: any) {
        console.error(`Failed to send to ${send.recipient_email}:`, sendError);

        await supabase
          .from("email_campaign_sends")
          .update({
            status: "failed",
            error_message: sendError.message || "Unknown error",
          })
          .eq("id", send.id);

        failedCount++;
      }
    }

    // Update campaign with final stats
    await supabase
      .from("email_campaigns")
      .update({
        status: "sent",
        total_sent: sentCount,
        total_failed: failedCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", campaignId);

    return new Response(
      JSON.stringify({
        success: true,
        campaignId,
        totalRecipients: recipients.length,
        sent: sentCount,
        failed: failedCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in send-email-campaign:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
