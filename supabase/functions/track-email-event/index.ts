import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

// 1x1 transparent GIF pixel
const TRACKING_PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), c => c.charCodeAt(0));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const campaignId = url.searchParams.get("c");
    const sendId = url.searchParams.get("s");
    const eventType = url.searchParams.get("t"); // open, click, unsubscribe
    const redirectUrl = url.searchParams.get("url");

    if (!campaignId || !sendId || !eventType) {
      return new Response("Missing parameters", { status: 400 });
    }

    const supabase = createExternalClient();
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "";
    const userAgent = req.headers.get("user-agent") || "";

    // Record the event
    await supabase.from("email_campaign_events").insert({
      campaign_id: campaignId,
      send_id: sendId,
      event_type: eventType,
      metadata: redirectUrl ? { url: redirectUrl } : {},
      ip_address: ipAddress,
      user_agent: userAgent,
    });

    // Update the send record
    if (eventType === "open") {
      // Only set opened_at if not already set (first open)
      const { data: send } = await supabase
        .from("email_campaign_sends")
        .select("opened_at")
        .eq("id", sendId)
        .single();

      if (send && !send.opened_at) {
        await supabase
          .from("email_campaign_sends")
          .update({ opened_at: new Date().toISOString() })
          .eq("id", sendId);

        // Increment campaign open count
        await supabase.rpc("increment_campaign_stat", {
          p_campaign_id: campaignId,
          p_stat: "total_opened",
        }).catch(() => {
          // Fallback: manual increment
          supabase
            .from("email_campaigns")
            .select("total_opened")
            .eq("id", campaignId)
            .single()
            .then(({ data }) => {
              if (data) {
                supabase
                  .from("email_campaigns")
                  .update({ total_opened: (data.total_opened || 0) + 1 })
                  .eq("id", campaignId);
              }
            });
        });
      }
    } else if (eventType === "click") {
      const { data: send } = await supabase
        .from("email_campaign_sends")
        .select("clicked_at")
        .eq("id", sendId)
        .single();

      if (send && !send.clicked_at) {
        await supabase
          .from("email_campaign_sends")
          .update({ clicked_at: new Date().toISOString() })
          .eq("id", sendId);

        await supabase
          .from("email_campaigns")
          .select("total_clicked")
          .eq("id", campaignId)
          .single()
          .then(({ data }) => {
            if (data) {
              supabase
                .from("email_campaigns")
                .update({ total_clicked: (data.total_clicked || 0) + 1 })
                .eq("id", campaignId);
            }
          });
      }
    } else if (eventType === "unsubscribe") {
      // Get the recipient email from the send record
      const { data: send } = await supabase
        .from("email_campaign_sends")
        .select("recipient_email")
        .eq("id", sendId)
        .single();

      if (send) {
        await supabase
          .from("email_subscribers")
          .update({ unsubscribed: true, unsubscribed_at: new Date().toISOString() })
          .eq("email", send.recipient_email);
      }
    }

    // Return appropriate response based on event type
    if (eventType === "open") {
      // Return tracking pixel
      return new Response(TRACKING_PIXEL, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          "Pragma": "no-cache",
          "Expires": "0",
        },
      });
    } else if (eventType === "click" && redirectUrl) {
      // Redirect to the original URL
      return new Response(null, {
        status: 302,
        headers: { Location: redirectUrl },
      });
    } else if (eventType === "unsubscribe") {
      // Show a simple unsubscribe confirmation page
      const html = `<!DOCTYPE html><html><head><title>Unsubscribed</title>
        <style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#0a0a0a;color:#fff;margin:0}
        .card{background:#1a1a1a;padding:48px;border-radius:16px;text-align:center;max-width:400px}
        h1{color:#06b6d4;margin:0 0 16px}p{color:#999}</style></head>
        <body><div class="card"><h1>Unsubscribed</h1><p>You have been successfully unsubscribed from RestylePro emails.</p></div></body></html>`;
      return new Response(html, {
        headers: { "Content-Type": "text/html" },
      });
    }

    return new Response("OK", { status: 200 });

  } catch (error: any) {
    console.error("Error in track-email-event:", error);
    // For tracking, always return 200 to not break email rendering
    return new Response(TRACKING_PIXEL, {
      headers: { "Content-Type": "image/gif" },
    });
  }
};

serve(handler);
