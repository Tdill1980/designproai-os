import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Inbound email -> ApprovePro thread.
//
// An inbound-email provider (Resend Inbound / SendGrid Inbound Parse /
// Cloudflare Email Worker, etc.) is configured to POST the customer's reply
// here. We match it to the right proof (by the "Order #NNNNN" in the subject,
// else by the sender's email) and log it as a "customer_reply" event so the
// design team sees the message + any attachments in the job's Messages thread.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Pull the best-effort fields out of whatever shape the provider sends.
function parse(payload: any) {
  const p = payload?.data ?? payload ?? {};
  const from: string =
    (typeof p.from === "string" ? p.from : p.from?.email || p.from?.address) ||
    p.sender || p.envelope?.from || "";
  const subject: string = p.subject || p.Subject || "";
  const text: string =
    p.text || p["body-plain"] || p.TextBody || p.stripped_text ||
    (typeof p.body === "string" ? p.body : "") || "";
  // Attachments: collect any URLs we can find; providers vary widely.
  const rawAtt = p.attachments || p.Attachments || [];
  const attachments = (Array.isArray(rawAtt) ? rawAtt : [])
    .map((a: any) => ({
      name: a?.filename || a?.name || a?.Name || null,
      url: a?.url || a?.URL || a?.content_url || null,
    }))
    .filter((a: any) => a.url || a.name);
  const emailMatch = from.match(/[^<>\s]+@[^<>\s]+/);
  return {
    fromEmail: (emailMatch ? emailMatch[0] : from).toLowerCase().trim(),
    subject,
    text: String(text).slice(0, 8000),
    attachments,
  };
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(url, serviceKey);

    const payload = await req.json().catch(() => ({}));
    const { fromEmail, subject, text, attachments } = parse(payload);

    // 1) Match by order number in the subject (our outbound subject carries it).
    let proofId: string | null = null;
    const orderMatch = subject.match(/#?\s*(\d{4,7})/);
    if (orderMatch) {
      const ord = orderMatch[1];
      const { data } = await db
        .from("proof_approvals")
        .select("id")
        .or(`metadata->>wpw_order_number.eq.${ord},metadata->>wpw_woo_order_id.eq.${ord},metadata->>woo_order_number.eq.${ord}`)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) proofId = (data as any).id;
    }

    // 2) Fall back to the sender's email -> their most recent active proof.
    if (!proofId && fromEmail) {
      const { data } = await db
        .from("proof_approvals")
        .select("id")
        .ilike("customer_email", fromEmail)
        .neq("status", "revoked")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data) proofId = (data as any).id;
    }

    if (!proofId) {
      // Nothing to attach it to — accept it so the provider doesn't retry.
      console.warn("[inbound-proof-email] no matching proof", { fromEmail, subject });
      return new Response(JSON.stringify({ ok: true, matched: false }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await db.from("proof_events").insert({
      proof_id: proofId,
      event_type: "customer_reply",
      actor_role: "customer",
      payload: {
        from: fromEmail,
        subject,
        message: text || "(no message body)",
        attachments,
        channel: "email",
      },
    });
    // Bump the proof so it surfaces as freshly-updated for the team.
    await db.from("proof_approvals").update({ updated_at: new Date().toISOString() }).eq("id", proofId);

    return new Response(JSON.stringify({ ok: true, matched: true, proof_id: proofId }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[inbound-proof-email] error:", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
