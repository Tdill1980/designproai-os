/**
 * cron-ingest-wpw — make WPW order ingestion AUTOMATIC (no dashboard needed).
 *
 * Today orders only sync into ApprovePro when a staffer opens the dashboard
 * (which calls approvepro-sync-wpw with their JWT). The WooCommerce order
 * webhook isn't delivering, so freshly-placed orders sit unsynced. This
 * function — driven by a cron — calls approvepro-sync-wpw server-side as the
 * WPW shop, using the service-role key (which carries role=service_role, the
 * bypass approvepro-sync-wpw already supports). That refreshes orders from
 * WooCommerce + creates the draft proofs, so the downstream intake email
 * (proof-intake-sweep) and auto-design have something to act on.
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

// Canonical WePrintWraps shop (internal staff — sees every WPW design order).
const WPW_SHOP_ID = "61cc6c1c-554c-440c-8e07-a64469f1f4eb";
const WPW_SHOP_EMAIL = "trish@weprintwraps.com";

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

    // Call approvepro-sync-wpw as the WPW shop via the service-role bypass.
    // approvepro-sync-wpw refreshes WooCommerce orders (wpw-sync-orders) and
    // creates the draft proofs in one pass.
    const res = await fetch(`${supabaseUrl}/functions/v1/approvepro-sync-wpw`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: anonKey,
      },
      body: JSON.stringify({ shop_id: WPW_SHOP_ID, user_email: WPW_SHOP_EMAIL }),
    });
    const result = await res.json().catch(() => ({}));

    // ── AUTO-DESIGN SWEEP ──────────────────────────────────────────────────
    // The whole point: orders DESIGN THEMSELVES, then a human validates →
    // approves → sends. Sync alone only creates the draft; this fires A.C.E
    // auto-design for eligible NEW design orders server-side, so it happens
    // even when nobody has the dashboard open.
    //
    // Safety rails so the back catalog is never mass-rendered or double-billed:
    //   • one-shot — skip anything with an autogen_status already set (the
    //     autogen fn stamps running/done/failed/needs_brief, so each order
    //     fires at most once until a human re-runs it);
    //   • design-ready only — must have a real brief or uploaded reference;
    //   • recent only — created within the last 14 days;
    //   • deduped by order number (so revoked/duplicate rows can't double-fire);
    //   • capped at 5 per run — the rest drain on later cron ticks.
    let autoDesigned = 0;
    try {
      const db = createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const sinceIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
      const { data: candidates } = await db
        .from("proof_approvals")
        .select("id, metadata, created_at, status, source_visualization_id")
        .eq("status", "draft")
        .is("source_visualization_id", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(60);

      // Group candidate rows by WPW order. An order is ELIGIBLE only if NONE of
      // its rows has already been designed or attempted (a duplicate sibling row
      // may already carry the design / an autogen_status), so we never fire a
      // second design for the same order. Then pick its design-ready row.
      const isBriefReady = (m: any): boolean => {
        const hasArt = Array.isArray(m?.customer_uploads) && m.customer_uploads.length > 0;
        const text = `${m?.line_item_brief || ""} ${m?.customer_note || ""} ${m?.order_customer_note || ""}`;
        return hasArt ||
          text.replace(/\s+/g, " ").trim().split(" ").filter((w: string) => w.length > 2).length >= 3;
      };
      const byOrder = new Map<string, any[]>();
      for (const p of (candidates || []) as any[]) {
        const m = p?.metadata || {};
        if (m.auto_ingested !== "wpw") continue;
        const key = String(m.wpw_order_number || m.wpw_woo_order_id || p.id);
        if (!byOrder.has(key)) byOrder.set(key, []);
        byOrder.get(key)!.push(p);
      }
      const eligible: string[] = [];
      for (const rowsForOrder of byOrder.values()) {
        if (eligible.length >= 5) break;
        // skip the whole order if any row is designed or already attempted
        if (rowsForOrder.some((r) => r?.metadata?.autogen_status || r?.source_visualization_id)) continue;
        const ready = rowsForOrder.find((r) => isBriefReady(r?.metadata || {}));
        if (ready) eligible.push(ready.id);
      }

      // AUTO-DESIGN DISABLED (Trish) — A.C.E no longer auto-generates "first
      // designs" on freshly-ingested WPW orders (it produced unsolicited AI
      // slop on the ApprovePro cards). A design is created ONLY when staff
      // explicitly click GO / Regenerate. Set ACE_AUTO_DESIGN=true to restore.
      const AUTO_DESIGN_ENABLED = Deno.env.get("ACE_AUTO_DESIGN") === "true";
      for (const proofId of AUTO_DESIGN_ENABLED ? eligible : []) {
        try {
          await fetch(`${supabaseUrl}/functions/v1/approvepro-autogen-design`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: anonKey },
            body: JSON.stringify({ proof_id: proofId }),
          });
          autoDesigned++;
        } catch (e) {
          console.warn("cron-ingest-wpw: auto-design fire failed", proofId, (e as any)?.message || e);
        }
      }
      if (autoDesigned) console.log(`cron-ingest-wpw: fired auto-design for ${autoDesigned} order(s)`);
    } catch (e) {
      console.warn("cron-ingest-wpw: auto-design sweep failed (non-fatal):", (e as any)?.message || e);
    }

    return new Response(JSON.stringify({ ok: res.ok, status: res.status, autoDesigned, result }), {
      status: res.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("cron-ingest-wpw: error", err?.message || err);
    return new Response(JSON.stringify({ error: err?.message || "error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
