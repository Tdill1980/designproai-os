/**
 * proof-decline — Phase 2 of the Proof Approval System.
 *
 * Customer action. Accepts:
 *   - token (HMAC view token)
 *   - reason (required — at least 3 chars)
 *   - idempotency_key header
 *
 * Flips status → declined (terminal state). Logs 'declined' event. Notifies
 * shop via Resend (non-blocking).
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";
import { notifyShopOfOutcome, recordProofEmail } from "../_shared/proof-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

interface DeclineRequest {
  token: string;
  reason: string;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getPublicProofBaseUrl(): string {
  return Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    let body: DeclineRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.token) return jsonResponse({ error: "token required" }, 400);
    if (!body.reason || body.reason.trim().length < 3) {
      return jsonResponse(
        { error: "reason required (min 3 chars) — tell the shop why" },
        400,
      );
    }

    const idempotencyKey =
      req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key") || "";
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return jsonResponse({ error: "Idempotency-Key header required" }, 400);
    }

    let verifiedUuid: string | null;
    try {
      verifiedUuid = await verifyProofToken(body.token, "view");
    } catch (err) {
      console.error("proof-decline: token verify threw:", err);
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }
    if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("*")
      .eq("view_token", body.token)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);

    if (proof.status === "revoked" || proof.status === "expired") {
      return jsonResponse({ error: `Proof is ${proof.status}` }, 410);
    }

    // Idempotency check
    const { data: priorEvent } = await db
      .from("proof_events")
      .select("payload, created_at")
      .eq("proof_id", proof.id)
      .eq("event_type", "declined")
      .contains("payload", { idempotency_key: idempotencyKey })
      .limit(1)
      .maybeSingle();
    if (priorEvent) {
      return jsonResponse({
        success: true,
        already_declined: true,
        declined_at: priorEvent.created_at,
      });
    }

    if (["approved", "declined"].includes(proof.status)) {
      return jsonResponse({ error: `Proof already ${proof.status}` }, 409);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    const { error: updateErr } = await db
      .from("proof_approvals")
      .update({
        status: "declined",
        decline_reason: body.reason.trim(),
      })
      .eq("id", proof.id)
      .not("status", "in", "(approved,declined,revoked,expired)");
    if (updateErr) {
      console.error("proof-decline: update failed:", updateErr);
      return jsonResponse(
        { error: "Failed to record decline", detail: updateErr.message },
        500,
      );
    }

    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "declined",
      actor_role: "customer",
      ip,
      user_agent: userAgent,
      payload: {
        idempotency_key: idempotencyKey,
        reason: body.reason.trim(),
      },
    });

    // Cancel pending MightyMail ApprovePro chase emails — proof is now in a
    // terminal state, the customer doesn't need any more reminders.
    try {
      await fetch(`${supabaseUrl}/functions/v1/mightymail-cancel-series`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify({
          sourceRef: `approvepro:${proof.id}`,
          reason: "proof declined",
        }),
      });
    } catch (e) {
      console.error("proof-decline: mightymail-cancel-series failed (non-fatal):", e);
    }

    // Notify shop (non-blocking)
    const { data: shopUser } = await db.auth.admin.getUserById(proof.shop_id);
    const shopEmail = shopUser?.user?.email;
    let shopName = shopUser?.user?.user_metadata?.shop_name ||
                   shopEmail?.split("@")[0] || "Your Wrap Shop";
    let ccEmails: string[] = [];
    try {
      const { data: shopProfile } = await db
        .from("shop_profiles")
        .select("shop_name, notification_emails")
        .eq("user_id", proof.shop_id)
        .maybeSingle();
      if (shopProfile?.shop_name) shopName = shopProfile.shop_name;
      if (Array.isArray(shopProfile?.notification_emails)) {
        ccEmails = shopProfile!.notification_emails;
      }
    } catch (_) {
      // non-fatal — fall back to no Cc
    }

    if (shopEmail) {
      const baseUrl = getPublicProofBaseUrl();
      const emailResult = await notifyShopOfOutcome({
        shopEmail,
        shopName,
        customerName: proof.customer_name,
        customerEmail: proof.customer_email,
        designName: proof.design_name || "Vehicle Wrap Design",
        vehicleSummary:
          [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
            .filter(Boolean)
            .join(" "),
        outcome: "declined",
        declineReason: body.reason.trim(),
        signedAtIso: new Date().toISOString(),
        proofId: proof.id,
        workbenchUrl: `${baseUrl}/approvepro?id=${proof.id}`,
        viewUrl: `${baseUrl}/approve/${proof.view_token}`,
        ccEmails,
      });
      if (!emailResult.ok) {
        console.warn("proof-decline: shop notification failed (non-fatal):", emailResult.reason);
      }
      // Record the shop-notification email so it shows in ApprovePro's
      // "Emails sent" panel (delivered or failed). Non-blocking.
      await recordProofEmail(db, {
        proofId: proof.id,
        direction: "to_shop",
        kind: "outcome_declined",
        to: shopEmail,
        result: emailResult,
        actorRole: "system",
        ip,
        userAgent,
      });
    }

    return jsonResponse({
      success: true,
      status: "declined",
      declined_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("proof-decline: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error" }, 500);
  }
});
