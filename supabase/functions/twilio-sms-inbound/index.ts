/**
 * twilio-sms-inbound — Multi-tenant inbound SMS handler
 *
 * Routes by the "To" number → shop_twilio_subaccounts to find the shop,
 * then creates a lead and notifies the shop owner.
 */

import { lookupShopByInboundNumber } from "../_shared/shop-twilio.ts";
import { createExternalClient } from "../_shared/external-db.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const formData = await req.formData();
    const from = formData.get("From")?.toString() || "";
    const to = formData.get("To")?.toString() || "";
    const body = formData.get("Body")?.toString() || "";
    const messageSid = formData.get("MessageSid")?.toString() || "";

    console.log(`[sms-inbound] From: ${from}, To: ${to}, Body: "${body.slice(0, 100)}"`);

    // Route to the correct shop by inbound number
    const shopResult = await lookupShopByInboundNumber(to);

    if (!shopResult) {
      console.warn(`[sms-inbound] No shop found for number ${to}`);
      return new Response("<Response></Response>", {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "text/xml" },
      });
    }

    const supabase = createExternalClient();
    const shopName = shopResult.shop_name || "RestyleProAI";

    // Create lead from SMS
    await supabase.from("leads").insert({
      caller_phone: from,
      source: "sms_inbound",
      status: "new",
      voicemail_transcript: body,
      metadata: {
        twilio_message_sid: messageSid,
        inbound_number: to,
        shop_id: shopResult.twilio.shop_id,
      },
    });

    // Notify shop owner via SMS if they have a forwarding phone
    if (shopResult.shop_phone && shopResult.shop_phone !== to) {
      const { sendSubaccountSms } = await import("../_shared/shop-twilio.ts");
      const siteUrl = Deno.env.get("SITE_URL") || "https://restylepro.ai";
      const notifyMsg = `NEW TEXT LEAD: ${from} says: "${body.slice(0, 120)}". Reply from your dashboard: ${siteUrl}/dashboard`;

      await sendSubaccountSms(shopResult.twilio, shopResult.shop_phone, notifyMsg);
    }

    // Auto-reply to customer
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>Thanks for texting ${shopName}! We got your message and will get back to you shortly. For an instant wrap estimate visit restylepro.ai/quick-quote</Message>
</Response>`;

    return new Response(twiml, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  } catch (error: any) {
    console.error("[sms-inbound] Error:", error);
    return new Response("<Response></Response>", {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  }
});
