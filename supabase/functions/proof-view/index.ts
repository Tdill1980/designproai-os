/**
 * proof-view — Phase 1 of the Proof Approval System.
 *
 * Public, no-auth endpoint that the customer hits when they open the proof
 * link. Verifies the HMAC view token, fetches client-safe fields via the
 * SECURITY DEFINER `get_proof_by_view_token()` function, logs a 'viewed'
 * event for the audit trail, and bumps status from 'sent' → 'viewed' the
 * first time.
 *
 * Verifies HMAC BEFORE the DB lookup to:
 *   1. block enumeration of `view_token` values
 *   2. give attackers a constant-time signature failure path
 *
 * verify_jwt is set to false in supabase/config.toml per JWT.md §1.
 *
 * Response shape (200):
 *   {
 *     proof_id, customer_name, customer_email, vehicle_*, design_name,
 *     finish_type, mode, status, expires_at, message_to_customer,
 *     white_label_logo_url, ai_revisions_allowed, ai_revisions_used,
 *     active_version: { id, version_number, render_urls, ... },
 *     version_history: [...]
 *   }
 *
 * Response shape (404 / 410):
 *   { error: "Proof not found or expired" }
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    // Accept token from JSON body (POST) or `?token=` query (GET).
    let token: string | null = null;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        token = body?.token || null;
      } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
      }
    } else {
      const url = new URL(req.url);
      token = url.searchParams.get("token");
    }

    if (!token || typeof token !== "string") {
      return jsonResponse({ error: "Missing token" }, 400);
    }

    // HMAC verification BEFORE any DB lookup.
    let verifiedUuid: string | null;
    try {
      verifiedUuid = await verifyProofToken(token, "view");
    } catch (err) {
      console.error("proof-view: token verify threw:", err);
      return jsonResponse(
        {
          error:
            "Server misconfiguration: PROOF_TOKEN_SECRET not set or too short",
        },
        500,
      );
    }
    if (!verifiedUuid) {
      // Generic message — do not reveal whether the UUID format or signature
      // failed. Constant time per attacker request.
      return jsonResponse({ error: "Invalid token" }, 404);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Fetch via SECURITY DEFINER — only returns client-safe fields and
    // automatically excludes revoked / expired proofs.
    const { data: rows, error: fetchErr } = await db.rpc(
      "get_proof_by_view_token",
      { p_token: token },
    );
    if (fetchErr) {
      console.error("proof-view: rpc failed:", fetchErr);
      return jsonResponse({ error: "Failed to load proof" }, 500);
    }
    if (!rows || rows.length === 0) {
      return jsonResponse({ error: "Proof not found or expired" }, 404);
    }
    const proof = rows[0];

    // Forensics for the event log
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    // Append to audit log (non-blocking on errors — viewing must not fail
    // because logging hiccupped)
    db.from("proof_events")
      .insert({
        proof_id: proof.id,
        event_type: "viewed",
        actor_role: "customer",
        ip,
        user_agent: userAgent,
        payload: {
          status_before: proof.status,
        },
      })
      .then(({ error }: { error: { message?: string } | null }) => {
        if (error) {
          console.warn(
            "proof-view: event log insert failed (non-fatal):",
            error.message,
          );
        }
      });

    // Bump status sent → viewed on first view. Also stamp viewed_at the
    // first time. The state-machine trigger validates this is allowed.
    if (proof.status === "sent") {
      const { error: updateErr } = await db
        .from("proof_approvals")
        .update({
          status: "viewed",
          viewed_at: new Date().toISOString(),
        })
        .eq("id", proof.id)
        .eq("status", "sent"); // idempotent — only the first concurrent view wins
      if (updateErr) {
        console.warn(
          "proof-view: status bump failed (non-fatal):",
          updateErr.message,
        );
      } else {
        proof.status = "viewed";
      }
    }

    // Fetch activity timeline (events visible to customer)
    const { data: events } = await db
      .from("proof_events")
      .select("event_type, actor_role, payload, created_at")
      .eq("proof_id", proof.id)
      .in("event_type", ["sent", "viewed", "signed", "declined", "revision_requested", "version_saved", "shop_reply", "customer_comment", "ai_revise_completed"])
      .order("created_at", { ascending: true });

    // Look up shop_id + shop branding so the customer page can show
    // "From <Shop Name>" even when the shop hasn't uploaded a white-label
    // logo. Falls back gracefully if shop_profiles is missing.
    let shopName: string | null = null;
    let shopLogoUrl: string | null = proof.white_label_logo_url || null;
    try {
      const { data: ownerRow } = await db
        .from("proof_approvals")
        .select("shop_id")
        .eq("id", proof.id)
        .maybeSingle();
      const shopId = ownerRow?.shop_id;
      if (shopId) {
        const { data: shopProfile } = await db
          .from("shop_profiles")
          .select("shop_name, logo_url")
          .eq("user_id", shopId)
          .maybeSingle();
        if (shopProfile?.shop_name) shopName = shopProfile.shop_name;
        if (!shopLogoUrl && shopProfile?.logo_url) shopLogoUrl = shopProfile.logo_url;
      }
    } catch {
      // shop_profiles may not exist on older deployments — non-fatal
    }

    // Original customer request ("source of truth") — what they asked for + the
    // reference images they uploaded. Service-role read of metadata so the
    // customer sees, on their own portal, exactly what they requested. Light
    // scaffolding strip so WooCommerce form defaults don't render as a "request".
    let originalRequest: string | null = null;
    let referenceUploads: string[] = [];
    // Which proofs the team chose to show this customer (set in the Send dialog).
    let portalIncludes: { twoD?: boolean; threeD?: boolean; views?: string[] } | null = null;
    try {
      const { data: metaRow } = await db
        .from("proof_approvals")
        .select("metadata")
        .eq("id", proof.id)
        .maybeSingle();
      const m = (metaRow?.metadata as any) || {};
      const strip = (t: unknown) =>
        String(t || "")
          .replace(/^\s*[a-z][a-z /]{0,20}\|/i, " ")
          .replace(/please note in (the )?box below[^|]*/gi, " ")
          .replace(/how you will provide (the )?files[^|]*/gi, " ")
          .replace(/[|]+/g, " ")
          .trim();
      const parts: string[] = [];
      for (const t of [m.order_customer_note, m.line_item_brief, m.customer_note]) {
        const s = strip(t);
        const words = s.split(/\s+/).filter((w) => /[a-z]{2,}/i.test(w));
        if (words.length >= 3 && !parts.some((p) => p.includes(s) || s.includes(p))) parts.push(s);
      }
      if (parts.length) originalRequest = parts.join("\n\n").slice(0, 2000);
      if (Array.isArray(m.customer_uploads)) {
        referenceUploads = m.customer_uploads.filter((u: any) => typeof u === "string" && u).slice(0, 12);
      }
      if (m.portal_includes && typeof m.portal_includes === "object") {
        portalIncludes = {
          twoD: m.portal_includes.twoD !== false,
          threeD: m.portal_includes.threeD !== false,
          views: Array.isArray(m.portal_includes.views) ? m.portal_includes.views : undefined,
        };
      }
    } catch (e) {
      console.warn("proof-view: original request fetch (non-fatal):", (e as any)?.message || e);
    }

    return jsonResponse({
      success: true,
      proof_id: proof.id,
      customer_name: proof.customer_name,
      customer_email: proof.customer_email,
      vehicle: {
        year: proof.vehicle_year,
        make: proof.vehicle_make,
        model: proof.vehicle_model,
        type: proof.vehicle_type,
      },
      design_name: proof.design_name,
      finish_type: proof.finish_type,
      mode: proof.mode,
      status: proof.status,
      has_line_items: proof.has_line_items === true,
      expires_at: proof.expires_at,
      message_to_customer: proof.message_to_customer,
      shop_name: shopName,
      shop_logo_url: shopLogoUrl,
      white_label_logo_url: proof.white_label_logo_url,
      original_request: originalRequest,
      reference_uploads: referenceUploads,
      portal_includes: portalIncludes,
      ai_revisions: {
        allowed: proof.ai_revisions_allowed,
        used: proof.ai_revisions_used,
        remaining: Math.max(
          0,
          (proof.ai_revisions_allowed ?? 0) - (proof.ai_revisions_used ?? 0),
        ),
      },
      active_version: proof.active_version,
      version_history: proof.version_history || [],
      line_items: proof.line_items || [],
      activity: (events || []).map((e: any) => ({
        type: e.event_type,
        role: e.actor_role,
        message: e.payload?.message || null,
        created_at: e.created_at,
      })),
    });
  } catch (err) {
    console.error("proof-view: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error" }, 500);
  }
});
