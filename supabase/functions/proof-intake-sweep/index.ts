/**
 * proof-intake-sweep — the AUTOMATIC half of order intake email.
 *
 * Runs on a cron. For each recently-synced WPW Custom/Full Wrap Design order
 * (product 234 / 58160) that hasn't had an intake email yet, it sends ONE of:
 *   - GREETING  — when the order already includes a brief / uploads
 *                 ("Thanks, your design is underway — reply with more any time").
 *   - REQUEST   — when the order has no instructions yet
 *                 ("We need a few details to start your design").
 * via request-order-instructions, which is idempotent (stamps the proof) and
 * logs the email on the order's thread.
 *
 * SAFETY: only orders created in the last INTAKE_WINDOW_HOURS are considered, so
 * deploying this never mass-emails the back catalog — only genuinely new orders.
 * Staff can still trigger the same email manually from the dashboard ("both
 * ways"). Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INTAKE_WINDOW_HOURS = 6;
const FULL_WRAP_DESIGN_IDS = new Set([234, 58160]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isFullWrapDesign(lineItems: any): boolean {
  if (!Array.isArray(lineItems)) return false;
  return lineItems.some((li) => {
    const pid = Number(li?.product_id);
    if (Number.isFinite(pid) && FULL_WRAP_DESIGN_IDS.has(pid)) return true;
    return String(li?.sku || "").toUpperCase() === "CHWD";
  });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const cutoff = new Date(Date.now() - INTAKE_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
    const { data: proofs, error } = await db
      .from("proof_approvals")
      .select("id, customer_email, customer_name, vehicle_year, vehicle_make, vehicle_model, metadata, created_at, status")
      .eq("metadata->>auto_ingested", "wpw")
      .gte("created_at", cutoff)
      .in("status", ["draft", "sent"])
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return jsonResponse({ error: "query failed", detail: error.message }, 500);

    let sent = 0, skipped = 0, errors = 0;

    for (const p of (proofs || [])) {
      const m: any = p.metadata || {};
      // Only real Custom/Full Wrap Design orders, only if not already emailed.
      if (!isFullWrapDesign(m.line_items)) { skipped++; continue; }
      if (m.instructions_requested_at || m.welcome_sent_at) { skipped++; continue; }
      if (!p.customer_email) { skipped++; continue; }

      const hasInstructions = !!(
        (typeof m.line_item_brief === "string" && m.line_item_brief.trim()) ||
        (typeof m.customer_note === "string" && m.customer_note.trim()) ||
        (Array.isArray(m.customer_uploads) && m.customer_uploads.length > 0) ||
        (Array.isArray(m.customer_documents) && m.customer_documents.length > 0)
      );
      const vehicle = [p.vehicle_year, p.vehicle_make, p.vehicle_model].filter(Boolean).join(" ");

      try {
        const { error: invErr } = await db.functions.invoke("request-order-instructions", {
          body: {
            to: p.customer_email,
            customerName: p.customer_name || undefined,
            orderNumber: m.wpw_order_number || undefined,
            vehicle: vehicle || undefined,
            shopName: "WePrintWraps",
            isWpw: true,
            kind: hasInstructions ? "greeting" : "request",
            wooOrderId: m.wpw_woo_order_id ?? undefined,
          },
        });
        if (invErr) { errors++; console.warn("intake-sweep: send failed", p.id, invErr.message); }
        else sent++;
      } catch (e: any) {
        errors++; console.warn("intake-sweep: send threw", p.id, e?.message || e);
      }
    }

    return jsonResponse({ ok: true, scanned: proofs?.length ?? 0, sent, skipped, errors });
  } catch (err: any) {
    console.error("proof-intake-sweep: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: err?.message }, 500);
  }
});
