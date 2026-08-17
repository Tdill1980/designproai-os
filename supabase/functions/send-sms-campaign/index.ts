import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendSmsRequest {
  recipients: { phone: string; name?: string }[];
  messageTemplate: string;
  campaignName?: string;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { recipients, messageTemplate, campaignName }: SendSmsRequest = await req.json();

    if (!recipients?.length || !messageTemplate) {
      return new Response(
        JSON.stringify({ error: "recipients and messageTemplate are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");

    if (!twilioSid || !twilioAuth || !twilioPhone) {
      return new Response(
        JSON.stringify({
          error: "Twilio credentials not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER in Supabase secrets."
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const authHeader = btoa(`${twilioSid}:${twilioAuth}`);

    let sentCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const recipient of recipients) {
      try {
        // Personalize the message
        let body = messageTemplate;
        body = body.replace(/\{\{customer_name\}\}/g, recipient.name || "there");
        body = body.replace(/\{\{current_year\}\}/g, new Date().getFullYear().toString());

        // Ensure message is under 160 chars for single SMS, or 1600 for MMS
        if (body.length > 1600) {
          body = body.substring(0, 1597) + "...";
        }

        const formData = new URLSearchParams();
        formData.append("To", recipient.phone);
        formData.append("From", twilioPhone);
        formData.append("Body", body);

        const response = await fetch(twilioUrl, {
          method: "POST",
          headers: {
            "Authorization": `Basic ${authHeader}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: formData.toString(),
        });

        if (response.ok) {
          sentCount++;
        } else {
          const errData = await response.json();
          failedCount++;
          errors.push(`${recipient.phone}: ${errData.message || response.statusText}`);
        }

        // Rate limit: delay every 10 messages
        if (sentCount % 10 === 0) {
          await new Promise(r => setTimeout(r, 1000));
        }
      } catch (sendError: any) {
        failedCount++;
        errors.push(`${recipient.phone}: ${sendError.message}`);
      }
    }

    // Log the campaign to the database (optional - for tracking)
    try {
      const supabase = createExternalClient();
      await supabase.from("email_campaigns").insert({
        name: campaignName || `SMS Campaign - ${new Date().toLocaleDateString()}`,
        subject: "SMS",
        html_content: messageTemplate,
        audience: "custom",
        status: "sent",
        total_recipients: recipients.length,
        total_sent: sentCount,
        total_failed: failedCount,
        sent_at: new Date().toISOString(),
      });
    } catch (logError) {
      console.error("Failed to log SMS campaign:", logError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sent: sentCount,
        failed: failedCount,
        total: recipients.length,
        errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("Error in send-sms-campaign:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
};

serve(handler);
