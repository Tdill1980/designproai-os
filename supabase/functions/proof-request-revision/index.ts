/**
 * proof-request-revision — Phase 3.
 *
 * Customer action. Accepts:
 *   - token                    (HMAC view token)
 *   - notes                    (required — what they want changed, min 3 chars)
 *   - reference_image_paths    (optional — array of storage paths already
 *                               uploaded via proof-upload-revision-ref)
 *   - idempotency_key header
 *
 * Flow:
 *   1. Verify HMAC + load proof.
 *   2. Confirm proof is in a non-terminal state that can transition into
 *      `revising` (viewed / sent / revising).
 *   3. Append `revision_requested` event with notes + ref paths.
 *   4. Flip status → revising (state machine validates).
 *   5. Generate signed URLs for the shop notification email.
 *   6. Send the shop revision-requested email (non-blocking on failure).
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";
import { notifyShopRevisionRequested, recordProofEmail } from "../_shared/proof-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

interface RevisionRequest {
  token: string;
  notes: string;
  reference_image_paths?: string[];
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
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: RevisionRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.token) return jsonResponse({ error: "token required" }, 400);
    if (!body.notes || body.notes.trim().length < 3) {
      return jsonResponse(
        { error: "notes required (min 3 chars) — tell the shop what to change" },
        400,
      );
    }
    const refPaths = Array.isArray(body.reference_image_paths)
      ? body.reference_image_paths.filter((p) => typeof p === "string" && p.length > 0).slice(0, 4)
      : [];

    const idempotencyKey =
      req.headers.get("idempotency-key") ||
      req.headers.get("Idempotency-Key") || "";
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return jsonResponse({ error: "Idempotency-Key header required" }, 400);
    }

    let verifiedUuid: string | null;
    try {
      verifiedUuid = await verifyProofToken(body.token, "view");
    } catch (err) {
      console.error("proof-request-revision: token verify threw:", err);
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

    if (proof.mode !== "revision_loop") {
      return jsonResponse(
        { error: "This proof is sign-only — revisions are not enabled for it" },
        409,
      );
    }
    if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse({ error: `Proof is ${proof.status}` }, 409);
    }
    if (proof.expires_at && new Date(proof.expires_at) < new Date()) {
      return jsonResponse({ error: "Proof has expired" }, 410);
    }

    // Idempotency check — was this exact key already processed?
    const { data: priorEvent } = await db
      .from("proof_events")
      .select("id, created_at")
      .eq("proof_id", proof.id)
      .eq("event_type", "revision_requested")
      .contains("payload", { idempotency_key: idempotencyKey })
      .limit(1)
      .maybeSingle();
    if (priorEvent) {
      return jsonResponse({
        success: true,
        already_requested: true,
        requested_at: priorEvent.created_at,
      });
    }

    // ── Get current active version number (used for the shop email) ──
    const { data: activeVersion } = await db
      .from("proof_versions")
      .select("version_number")
      .eq("proof_id", proof.id)
      .eq("is_active", true)
      .maybeSingle();
    const currentVersionNumber = activeVersion?.version_number ?? 1;

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    // ── Log event first (cannot be undone, preserves audit even if the
    //    status update fails) ──
    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "revision_requested",
      actor_role: "customer",
      ip,
      user_agent: userAgent,
      payload: {
        idempotency_key: idempotencyKey,
        notes: body.notes.trim(),
        reference_image_paths: refPaths,
        against_version: currentVersionNumber,
      },
    });

    // ── Persist notes + refs on proof_approvals for quick shop access ──
    // Stored in change_request (latest notes only — full history lives in
    // proof_events).
    const { error: updateErr } = await db
      .from("proof_approvals")
      .update({
        status: "revising",
        change_request: body.notes.trim(),
      })
      .eq("id", proof.id)
      .not("status", "in", "(approved,declined,revoked,expired)");

    if (updateErr) {
      console.error("proof-request-revision: status update failed:", updateErr);
      // Event is already logged — shop can still see what happened via audit
      return jsonResponse(
        {
          error: "Failed to update proof status",
          detail: updateErr.message,
        },
        500,
      );
    }

    // ── Generate signed URLs for refs (shop email preview) ──
    const signedRefUrls: string[] = [];
    if (refPaths.length > 0) {
      for (const path of refPaths) {
        const { data } = await db.storage
          .from("proof-uploads")
          .createSignedUrl(path, 60 * 60 * 24 * 14); // 14 days
        if (data?.signedUrl) signedRefUrls.push(data.signedUrl);
      }
    }

    // ── Notify shop (non-blocking) ──
    try {
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
        // non-fatal
      }

      if (shopEmail) {
        const baseUrl = getPublicProofBaseUrl();
        const manageUrl = `${baseUrl}/approve/manage/${proof.manage_token}`;
        const emailResult = await notifyShopRevisionRequested({
          shopEmail,
          shopName,
          customerName: proof.customer_name,
          customerEmail: proof.customer_email,
          designName: proof.design_name || "Vehicle Wrap Design",
          vehicleSummary:
            [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
              .filter(Boolean)
              .join(" "),
          revisionNotes: body.notes.trim(),
          referenceImageUrls: signedRefUrls,
          manageUrl,
          workbenchUrl: `${baseUrl}/approvepro?id=${proof.id}`,
          viewUrl: `${baseUrl}/approve/${proof.view_token}`,
          proofId: proof.id,
          versionNumber: currentVersionNumber,
          ccEmails,
        });
        if (!emailResult.ok) {
          console.warn("proof-request-revision: shop notification failed:", emailResult.reason);
        }
        await recordProofEmail(db, {
          proofId: proof.id,
          direction: "to_shop",
          kind: "revision_requested",
          to: shopEmail,
          result: emailResult,
          actorRole: "system",
          ip,
          userAgent,
        });
      }
    } catch (notifyErr) {
      console.warn("proof-request-revision: notify path threw (non-fatal):", notifyErr);
    }

    return jsonResponse({
      success: true,
      status: "revising",
      requested_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("proof-request-revision: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
