/**
 * proof-send-sms — text the customer their proof link so they can approve /
 * revise-with-AI straight from their phone (the proof page is mobile-first).
 *
 * Shop-owner action from ApprovePro. Resolves the customer's phone (passed by
 * the client, which already shows it from the linked order, or falls back to
 * the WooCommerce order's billing phone), ensures the proof is sent (a draft is
 * flipped to `sent` so the link works), and texts the /approve/{view_token}
 * link via the master Twilio account (same creds as send-sms-campaign).
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function baseUrl(): string {
  return Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
}

// Normalise a US/CA number to E.164 (+1XXXXXXXXXX). Returns null if unusable.
function toE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = String(raw).replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d.length >= 11 ? d : null;
  d = d.replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return d.length >= 11 ? `+${d}` : null;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);
    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await authClient.auth.getUser();
    if (authErr || !user) return jsonResponse({ error: "Invalid auth token" }, 401);

    let body: { proof_id?: string; phone?: string };
    try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
    if (!body.proof_id) return jsonResponse({ error: "proof_id required" }, 400);

    const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhone = Deno.env.get("TWILIO_PHONE_NUMBER");
    if (!twilioSid || !twilioAuth || !twilioPhone) {
      return jsonResponse({ error: "Twilio not configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER)" }, 500);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("*")
      .eq("id", body.proof_id)
      .eq("shop_id", user.id)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);
    if (["revoked", "expired"].includes(proof.status)) {
      return jsonResponse({ error: `Proof is ${proof.status}` }, 409);
    }

    // Resolve phone: client-provided, else the linked Woo order's billing phone.
    let phone = toE164(body.phone);
    if (!phone) {
      const wooId = Number((proof.metadata as any)?.wpw_woo_order_id);
      if (Number.isFinite(wooId)) {
        const { data: wo } = await db.from("wpw_orders").select("raw").eq("id", wooId).maybeSingle();
        phone = toE164((wo?.raw as any)?.billing?.phone);
      }
    }
    if (!phone) return jsonResponse({ error: "No usable phone number on file for this customer" }, 422);

    // Ensure the link is live — flip a draft to sent (mirrors the email send).
    if (proof.status === "draft") {
      await db.from("proof_approvals")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", proof.id);
    }

    let shopName = user.user_metadata?.shop_name || "Your wrap shop";
    try {
      const { data: sp } = await db.from("shop_profiles").select("shop_name").eq("user_id", user.id).maybeSingle();
      if (sp?.shop_name) shopName = sp.shop_name;
    } catch { /* non-fatal */ }

    const link = `${baseUrl()}/approve/${proof.view_token}`;
    const designName = proof.design_name || "your wrap design";
    const message = `${shopName}: Your proof for ${designName} is ready. Review, revise with AI, or approve from your phone: ${link}`;

    // Send via master Twilio account (same path as send-sms-campaign).
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
    const form = new URLSearchParams();
    form.append("To", phone);
    form.append("From", twilioPhone);
    form.append("Body", message);
    const res = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${twilioSid}:${twilioAuth}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });
    const tw = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("proof-send-sms: twilio error", res.status, JSON.stringify(tw).slice(0, 300));
      return jsonResponse({ error: tw?.message || "Failed to send text", detail: tw?.code }, 502);
    }

    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "sms_sent",
      actor_role: "shop",
      actor_user_id: user.id,
      payload: { to: phone, twilio_sid: tw?.sid || null, link },
    });

    return jsonResponse({ success: true, to: phone, sid: tw?.sid || null });
  } catch (err: any) {
    console.error("proof-send-sms: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: err?.message }, 500);
  }
});
