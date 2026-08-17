/**
 * twilio-subaccount-provision — Onboard a shop with a dedicated Twilio number
 *
 * Creates a Twilio sub-account, buys a local number in the requested area code,
 * wires Voice + SMS webhooks back to RestylePro, and persists the mapping.
 * Idempotent: if the shop already has a sub-account row, returns it.
 *
 * Request (POST, service-role or admin JWT):
 *   { shopId, areaCode?, friendlyName?, forwardingPhone?, voiceAgentEnabled? }
 *
 * voiceAgentEnabled = true (NML Pro) flips voice_agent_enabled on the
 * subaccount row so missed calls route to the AI receptionist instead of
 * voicemail.
 *
 * Response:
 *   { subaccountSid, phoneNumber, phoneNumberSid }
 */

import { createExternalClient } from "../_shared/external-db.ts";
import { corsHeaders } from "../_shared/cors.ts";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function twilioApi(path: string, method: string, body?: Record<string, string>) {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
  const token = Deno.env.get("TWILIO_AUTH_TOKEN")!;
  const auth = btoa(`${sid}:${token}`);

  const opts: RequestInit = {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
  };
  if (body) {
    opts.body = new URLSearchParams(body).toString();
  }

  const res = await fetch(`https://api.twilio.com/2010-04-01${path}`, opts);
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Twilio ${method} ${path}: ${data.message || res.status}`);
  }
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  try {
    const { shopId, areaCode, friendlyName, forwardingPhone, voiceAgentEnabled } =
      await req.json();
    if (!shopId) return json(400, { ok: false, error: "shopId required" });

    const supabase = createExternalClient();

    // Idempotent: check if shop already provisioned
    const { data: existing } = await supabase
      .from("shop_twilio_subaccounts")
      .select("subaccount_sid, phone_number, phone_number_sid")
      .eq("shop_id", shopId)
      .eq("is_active", true)
      .maybeSingle();

    if (existing) {
      console.log(`[provision] Shop ${shopId} already provisioned`);
      return json(200, {
        ok: true,
        alreadyExists: true,
        subaccountSid: (existing as any).subaccount_sid,
        phoneNumber: (existing as any).phone_number,
        phoneNumberSid: (existing as any).phone_number_sid,
      });
    }

    const masterSid = Deno.env.get("TWILIO_ACCOUNT_SID")!;
    const label = friendlyName || `RestylePro-${shopId.slice(0, 8)}`;

    // 1. Create sub-account
    console.log(`[provision] Creating sub-account for ${shopId}`);
    const subAccount = await twilioApi(`/Accounts.json`, "POST", {
      FriendlyName: label,
    });
    const subSid = subAccount.sid;
    console.log(`[provision] Sub-account created: ${subSid}`);

    // 2. Buy a local number
    const searchParams: Record<string, string> = {
      VoiceEnabled: "true",
      SmsEnabled: "true",
      Limit: "1",
    };
    if (areaCode) searchParams.AreaCode = areaCode;

    const available = await twilioApi(
      `/Accounts/${masterSid}/AvailablePhoneNumbers/US/Local.json?${new URLSearchParams(searchParams)}`,
      "GET",
    );

    if (!available.available_phone_numbers?.length) {
      return json(422, { ok: false, error: `No numbers available for area code ${areaCode || "any"}` });
    }

    const chosenNumber = available.available_phone_numbers[0].phone_number;

    // Build webhook URLs
    const baseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("EXTERNAL_SUPABASE_URL") || "";
    const voiceUrl = `${baseUrl}/functions/v1/twilio-voice-webhook`;
    const smsUrl = `${baseUrl}/functions/v1/twilio-sms-inbound`;

    // Buy the number on the sub-account
    const purchased = await twilioApi(
      `/Accounts/${subSid}/IncomingPhoneNumbers.json`,
      "POST",
      {
        PhoneNumber: chosenNumber,
        VoiceUrl: voiceUrl,
        VoiceMethod: "POST",
        SmsUrl: smsUrl,
        SmsMethod: "POST",
        FriendlyName: label,
      },
    );

    const phoneNumberSid = purchased.sid;
    console.log(`[provision] Number purchased: ${chosenNumber} (${phoneNumberSid})`);

    // 3. Save forwarding phone to shop_profiles
    if (forwardingPhone) {
      await supabase
        .from("shop_profiles")
        .update({ phone: forwardingPhone })
        .eq("id", shopId);
    }

    // 4. Persist the mapping
    await supabase.from("shop_twilio_subaccounts").insert({
      shop_id: shopId,
      subaccount_sid: subSid,
      phone_number: chosenNumber,
      phone_number_sid: phoneNumberSid,
      friendly_name: label,
      forwarding_phone: forwardingPhone || null,
      voice_webhook_url: voiceUrl,
      sms_webhook_url: smsUrl,
      voice_agent_enabled: voiceAgentEnabled === true,
    });

    // 5. Text the owner their new number
    if (forwardingPhone) {
      const masterAuth = Deno.env.get("TWILIO_AUTH_TOKEN")!;
      const auth = btoa(`${masterSid}:${masterAuth}`);
      await fetch(`https://api.twilio.com/2010-04-01/Accounts/${subSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          To: forwardingPhone,
          From: chosenNumber,
          Body: `Your RestylePro lead line is live: ${chosenNumber}. Missed calls get auto-transcribed and texted to your customers with a quote link. 🚀`,
        }).toString(),
      }).catch((e) => console.warn("[provision] Welcome SMS failed:", e));
    }

    return json(200, {
      ok: true,
      subaccountSid: subSid,
      phoneNumber: chosenNumber,
      phoneNumberSid,
    });
  } catch (err: any) {
    console.error("[provision] Error:", err);
    return json(500, { ok: false, error: err.message });
  }
});
