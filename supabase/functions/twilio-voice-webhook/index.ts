/**
 * Twilio Voice Webhook — Missed Call → Voicemail → Lead
 *
 * Twilio hits this endpoint when a call comes in.
 * Returns TwiML that:
 *   1. Rings the shop for 20s
 *   2. If no answer → plays voicemail greeting
 *   3. Records message + requests transcription
 *   4. Transcription callback → twilio-transcription-callback
 */

import { createExternalClient } from "../_shared/external-db.ts";
import { lookupShopByInboundNumber } from "../_shared/shop-twilio.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Twilio sends form-encoded data
    const formData = await req.formData();
    const callerPhone = formData.get("From")?.toString() || "";
    const callSid = formData.get("CallSid")?.toString() || "";
    const callStatus = formData.get("CallStatus")?.toString() || "";
    const toNumber = formData.get("To")?.toString() || "";

    console.log(`[twilio-voice] Incoming call from ${callerPhone} to ${toNumber}, SID: ${callSid}, status: ${callStatus}`);

    // Multi-tenant: route by the "To" number to find the shop
    const shopResult = await lookupShopByInboundNumber(toNumber);
    const supabase = createExternalClient();

    const shopPhone = shopResult?.shop_phone || null;
    const shopName = shopResult?.shop_name || "the shop";

    // Build the transcription callback URL
    const baseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("EXTERNAL_SUPABASE_URL") || "";
    const transcriptionCallback = `${baseUrl}/functions/v1/twilio-transcription-callback`;

    // Generate TwiML response
    let twiml: string;

    if (shopPhone) {
      // Try forwarding to shop first, then voicemail on no answer
      twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" action="${baseUrl}/functions/v1/twilio-voice-webhook?step=missed">
    <Number>${shopPhone}</Number>
  </Dial>
</Response>`;

      // If this is the "missed" callback (shop didn't answer)
      const url = new URL(req.url);
      const step = url.searchParams.get("step");
      const dialStatus = formData.get("DialCallStatus")?.toString();

      if (step === "missed" && dialStatus !== "completed") {
        // Create lead immediately as "new" with just phone number
        await supabase.from("leads").insert({
          caller_phone: callerPhone,
          source: "missed_call",
          twilio_call_sid: callSid,
          status: "new",
        });

        // Check if this shop has the AI voice agent enabled (NML Pro tier)
        const hasVoiceAgent = shopResult?.twilio?.voice_agent_enabled === true;

        if (hasVoiceAgent) {
          // Redirect to AI receptionist
          const ctx = btoa(JSON.stringify({
            shopName,
            shopId: shopResult?.twilio?.shop_id || null,
            shopPhone,
            callerPhone,
            callSid,
          }));
          twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect>${baseUrl}/functions/v1/twilio-voice-agent?ctx=${encodeURIComponent(ctx)}</Redirect>
</Response>`;
          console.log(`[twilio-voice] Shop didn't answer. Routing to AI voice agent for ${callerPhone}`);
        } else {
          // Standard voicemail flow
          twiml = buildVoicemailTwiml(shopName, transcriptionCallback);
          console.log(`[twilio-voice] Shop didn't answer. Recording voicemail for ${callerPhone}`);
        }
      }

      // Voicemail fallback — used when AI agent redirects to voicemail
      if (step === "voicemail-fallback") {
        const fallbackShopName = url.searchParams.get("shopName") || shopName;
        twiml = buildVoicemailTwiml(fallbackShopName, transcriptionCallback);
        console.log(`[twilio-voice] Voicemail fallback for ${callerPhone}`);
      }
    } else {
      // No shop phone configured — go straight to voicemail
      twiml = buildVoicemailTwiml(shopName, transcriptionCallback);

      await supabase.from("leads").insert({
        caller_phone: callerPhone,
        source: "voicemail",
        twilio_call_sid: callSid,
        status: "new",
      });

      console.log(`[twilio-voice] No shop phone. Recording voicemail for ${callerPhone}`);
    }

    return new Response(twiml, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  } catch (error: any) {
    console.error("[twilio-voice] Error:", error);

    // Return a safe TwiML error response
    const fallback = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Sorry, we're experiencing technical difficulties. Please try again later.</Say>
</Response>`;

    return new Response(fallback, {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "text/xml" },
    });
  }
});

function buildVoicemailTwiml(shopName: string, transcriptionCallback: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Hey, thanks for calling ${shopName}. We missed your call but want to get you a quote fast. After the beep, leave your name, the year make and model of your vehicle, and what you're looking for. We'll text you a price estimate right away.</Say>
  <Record
    maxLength="120"
    transcribe="true"
    transcribeCallback="${transcriptionCallback}"
    playBeep="true"
    action="${transcriptionCallback}?type=recording_complete"
    timeout="5"
  />
  <Say voice="alice">We didn't hear anything. Text us anytime or call back. Bye!</Say>
</Response>`;
}
