/**
 * shop-twilio.ts — Multi-tenant Twilio helpers
 *
 * lookupShopByInboundNumber(to) — resolves an inbound phone number to the
 *   shop that owns it, plus the forwarding cell and shop name.
 *
 * sendSubaccountSms(shopRow, to, body) — sends an SMS using the master
 *   Twilio account but scoped to the sub-account SID (Twilio allows this
 *   pattern: master auth + sub-account in the URL path).
 */

import { createExternalClient } from "./external-db.ts";

export interface ShopTwilioRow {
  id: string;
  shop_id: string;
  subaccount_sid: string;
  phone_number: string;
  phone_number_sid: string;
  forwarding_phone: string | null;
  friendly_name: string | null;
  is_active: boolean;
  voice_agent_enabled: boolean;
}

export interface ShopLookupResult {
  twilio: ShopTwilioRow;
  shop_name: string | null;
  shop_phone: string | null;
  user_id: string;
}

/**
 * Given an inbound Twilio "To" number, find the shop that owns it.
 * Falls back to the first shop_profiles row if no sub-account match
 * (single-tenant backward compat).
 */
export async function lookupShopByInboundNumber(
  toNumber: string,
): Promise<ShopLookupResult | null> {
  const supabase = createExternalClient();

  // Try sub-account lookup first
  const { data: sub } = await supabase
    .from("shop_twilio_subaccounts")
    .select("*")
    .eq("phone_number", toNumber)
    .eq("is_active", true)
    .limit(1)
    .single();

  if (sub) {
    const { data: shop } = await supabase
      .from("shop_profiles")
      .select("shop_name, phone, user_id")
      .eq("id", (sub as any).shop_id)
      .single();

    return {
      twilio: sub as unknown as ShopTwilioRow,
      shop_name: (shop as any)?.shop_name || null,
      shop_phone: (sub as any).forwarding_phone || (shop as any)?.phone || null,
      user_id: (shop as any)?.user_id || "",
    };
  }

  // Fallback: single-tenant (no sub-account table row yet)
  const { data: fallbackShop } = await supabase
    .from("shop_profiles")
    .select("id, shop_name, phone, user_id")
    .limit(1)
    .single();

  if (!fallbackShop) return null;

  return {
    twilio: {
      id: "",
      shop_id: (fallbackShop as any).id,
      subaccount_sid: Deno.env.get("TWILIO_ACCOUNT_SID") || "",
      phone_number: toNumber,
      phone_number_sid: "",
      forwarding_phone: (fallbackShop as any).phone,
      friendly_name: (fallbackShop as any).shop_name,
      is_active: true,
      voice_agent_enabled: false,
    },
    shop_name: (fallbackShop as any).shop_name,
    shop_phone: (fallbackShop as any).phone,
    user_id: (fallbackShop as any).user_id || "",
  };
}

/**
 * Send SMS using master credentials scoped to a sub-account.
 * Twilio allows: POST /2010-04-01/Accounts/{SubAccountSid}/Messages.json
 * with master SID:Token auth.
 */
export async function sendSubaccountSms(
  shopRow: ShopTwilioRow,
  to: string,
  body: string,
): Promise<boolean> {
  const masterSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const masterAuth = Deno.env.get("TWILIO_AUTH_TOKEN");

  if (!masterSid || !masterAuth) {
    console.error("[shop-twilio] TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN missing");
    return false;
  }

  // Use sub-account SID in URL path if available, else master
  const accountSid = shopRow.subaccount_sid || masterSid;
  const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const authHeader = btoa(`${masterSid}:${masterAuth}`);

  const formData = new URLSearchParams();
  formData.append("To", to);
  formData.append("From", shopRow.phone_number);
  formData.append("Body", body);

  const res = await fetch(twilioUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authHeader}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[shop-twilio] SMS failed to ${to}: ${err}`);
    return false;
  }

  return true;
}
