/**
 * proof-send — Phase 2 of the Proof Approval System.
 *
 * Shop owner action. Takes a proof_id (or view_token), emails the customer
 * the view URL via Resend, transitions status from draft → sent (state
 * machine trigger validates), stamps sent_at, and logs a 'sent' event.
 *
 * Idempotent: if status is already 'sent' (or 'viewed'), returns success
 * without re-sending.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendProofToClient } from "../_shared/proof-email.ts";
import { userTeamShopIds } from "../_shared/proof-team-access.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendProofRequest {
  proof_id: string;
  custom_message?: string;
  // Bypass the idempotency short-circuit and re-email the customer
  // even if the proof is already in sent/viewed/revising. Used by the
  // shop's Resend button after editing customer email or pushing a new
  // version. Approved/declined/revoked/expired still block.
  force?: boolean;
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("authorization");
    if (!authHeader) return jsonResponse({ error: "Authentication required" }, 401);

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await authClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "Invalid auth token" }, 401);
    const shopId = user.id;

    let body: SendProofRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    if (!body.proof_id) return jsonResponse({ error: "proof_id required" }, 400);

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Load proof + verify TEAM access (mirrors proof_approvals RLS: own id +
    // owners of accepted shop_members). Fails safe to owner-only. Lets a
    // teammate send a shared shop's proof, matching the workbench queue.
    const allowedShopIds = await userTeamShopIds(db, shopId);
    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("*")
      .eq("id", body.proof_id)
      .in("shop_id", allowedShopIds)
      .single();

    if (fetchErr || !proof) {
      return jsonResponse({ error: "Proof not found" }, 404);
    }

    // Terminal statuses always block — you don't email a closed deal.
    if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse(
        { error: `Cannot send proof from status '${proof.status}'` },
        409,
      );
    }

    // Idempotent by default: already sent / viewed / revising → return
    // current state without re-emailing. The shop's Resend button passes
    // force: true to bypass this and actually re-trigger the email.
    if (!body.force &&
        ["sent", "viewed", "revising", "escalated_shop", "escalated_support"]
          .includes(proof.status)) {
      return jsonResponse({
        success: true,
        already_sent: true,
        status: proof.status,
        view_url: `${getPublicProofBaseUrl()}/approve/${proof.view_token}`,
      });
    }

    // ── Hero image fallback chain ───────────────────────────────────
    // Pick the most "relevant design" we can find so every proof email
    // includes a visual. Order:
    //   1. proof_versions.render_urls (active version) — http(s) only,
    //      skip bare paths from the private proof-uploads bucket.
    //   2. proof_approvals.metadata.hero_render_url / render_url — stash
    //      a shop owner may have set when creating the proof.
    //   3. color_visualizations.render_urls via source_visualization_id —
    //      the original visualizer render the proof was spawned from.
    //   4. proof_versions.uploaded_file_paths — sign the first image
    //      attachment in the private proof-uploads bucket (14d expiry,
    //      easily covers the retarget window). PDFs / non-images skipped.
    const isLoadable = (url: unknown): url is string =>
      typeof url === "string" &&
      /^https?:\/\//.test(url) &&
      !/\/storage\/v1\/object\/public\/proof-uploads\//.test(url);

    const pickFromRenderUrls = (
      blob: Record<string, unknown> | null | undefined,
    ): string | null => {
      if (!blob) return null;
      const ordered = [
        blob.side, blob.hero, blob.roof, blob.front, blob.rear,
        ...Object.values(blob),
      ];
      return (ordered.find(isLoadable) as string | undefined) || null;
    };

    let heroImageUrl: string | null = null;

    // Step 1 — active proof_version.render_urls
    const { data: activeVersion } = await db
      .from("proof_versions")
      .select("render_urls, uploaded_file_paths")
      .eq("proof_id", proof.id)
      .eq("is_active", true)
      .maybeSingle();
    heroImageUrl = pickFromRenderUrls(
      (activeVersion?.render_urls || {}) as Record<string, unknown>,
    );

    // Step 2 — proof_approvals.metadata
    if (!heroImageUrl) {
      const meta = (proof.metadata || {}) as Record<string, unknown>;
      const fromMeta =
        (typeof meta.hero_render_url === "string" && meta.hero_render_url) ||
        (typeof meta.render_url === "string" && meta.render_url) ||
        null;
      if (isLoadable(fromMeta)) heroImageUrl = fromMeta;
    }

    // Step 3 — source visualization render_urls
    if (!heroImageUrl && proof.source_visualization_id) {
      const { data: viz } = await db
        .from("color_visualizations")
        .select("render_urls, custom_design_url")
        .eq("id", proof.source_visualization_id)
        .maybeSingle();
      heroImageUrl = pickFromRenderUrls(
        (viz?.render_urls || {}) as Record<string, unknown>,
      );
      if (!heroImageUrl && isLoadable(viz?.custom_design_url)) {
        heroImageUrl = viz!.custom_design_url as string;
      }
    }

    // Step 4 — first image in uploaded_file_paths, signed for 14 days
    if (!heroImageUrl && activeVersion?.uploaded_file_paths) {
      const paths = activeVersion.uploaded_file_paths as unknown;
      const list: string[] = Array.isArray(paths)
        ? paths.filter((p): p is string => typeof p === "string")
        : typeof paths === "object" && paths
          ? Object.values(paths as Record<string, unknown>).filter(
              (p): p is string => typeof p === "string",
            )
          : [];
      const firstImage = list.find((p) =>
        /\.(jpe?g|png|webp|gif)$/i.test(p),
      );
      if (firstImage) {
        // Strip a leading "proof-uploads/" prefix if a caller stored the
        // bucket-qualified path so createSignedUrl gets just the object key.
        const objectKey = firstImage.replace(/^proof-uploads\//, "");
        const { data: signed } = await db.storage
          .from("proof-uploads")
          .createSignedUrl(objectKey, 60 * 60 * 24 * 14);
        if (signed?.signedUrl) heroImageUrl = signed.signedUrl;
      }
    }

    // Look up shop profile for branding (graceful if not present)
    let shopName = user.user_metadata?.shop_name || user.email?.split("@")[0] || "Your Wrap Shop";
    try {
      const { data: shopProfile } = await db
        .from("shop_profiles")
        .select("shop_name")
        .eq("user_id", shopId)
        .maybeSingle();
      if (shopProfile?.shop_name) shopName = shopProfile.shop_name;
    } catch {
      // shop_profiles table may not exist yet — ignore
    }

    // Public client-facing approval page — separate URL namespace from the
    // legacy /proof/:token route.
    const viewUrl = `${getPublicProofBaseUrl()}/approve/${proof.view_token}`;
    const vehicleSummary = [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
      .filter(Boolean).join(" ");

    // Send the email. Required step — if it fails, we flip to delivery_failed.
    const emailResult = await sendProofToClient({
      customerEmail: proof.customer_email,
      customerName: proof.customer_name,
      shopName,
      designName: proof.design_name || "Your Design",
      vehicleSummary,
      heroImageUrl,
      viewUrl,
      customMessage: body.custom_message || proof.message_to_customer,
      expiresAtIso: proof.expires_at,
      mode: proof.mode,
    });

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    if (!emailResult.ok) {
      // Log the failure + flip status so shop owner can see it
      await db.from("proof_approvals").update({
        status: "delivery_failed",
      }).eq("id", proof.id);

      await db.from("proof_events").insert({
        proof_id: proof.id,
        event_type: "send_failed",
        actor_role: "shop",
        actor_user_id: shopId,
        ip,
        user_agent: userAgent,
        payload: {
          reason: emailResult.reason,
          error: emailResult.error,
        },
      });

      return jsonResponse(
        {
          error: "Email delivery failed",
          reason: emailResult.reason,
          detail: emailResult.error,
        },
        502,
      );
    }

    // Success — flip to sent, stamp sent_at, log event
    const sentAt = new Date().toISOString();
    const { error: updateErr } = await db
      .from("proof_approvals")
      .update({ status: "sent", sent_at: sentAt })
      .eq("id", proof.id)
      .in("status", ["draft", "delivery_failed"]);

    if (updateErr) {
      console.error("proof-send: status update failed:", updateErr);
    }

    // Persist subject + customer-visible message in the audit payload so
    // ApprovePro's "Sent emails" panel can replay what actually went out
    // (subject line, custom message, recipient) without needing a separate
    // mailbox view.
    const sentSubject = `Your ${proof.design_name || "design"} is ready for review`;
    const sentMessage = body.custom_message || proof.message_to_customer || null;
    const eventType: "sent" | "resent" = proof.sent_at ? "resent" : "sent";
    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: eventType,
      actor_role: "shop",
      actor_user_id: shopId,
      ip,
      user_agent: userAgent,
      payload: {
        to: proof.customer_email,
        resend_id: emailResult.id,
        subject: (emailResult as any).subject || sentSubject,
        // Exact HTML the customer received, for ApprovePro's "view exact email".
        html: (emailResult as any).html || null,
        message: sentMessage,
        view_url: viewUrl,
        shop_name: shopName,
      },
    });

    // ── Fire MightyMail ApprovePro Close-Rate series ──
    // Queues 24h / 48h / 72h chase emails. ap-05-approved is manualOnly
    // and fires only when the customer actually signs (proof-sign).
    // Cancellation: proof-sign + proof-decline call mightymail-cancel-series
    // by source_ref = "approvepro:<proof.id>".
    try {
      await fetch(`${supabaseUrl}/functions/v1/mightymail-enqueue-series`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify({
          seriesId: "approvepro",
          sourceRef: `approvepro:${proof.id}`,
          recipientEmail: proof.customer_email,
          shopId: proof.shop_id,
          mergeData: {
            customer_name: proof.customer_name,
            vehicle_name: vehicleSummary,
            proof_url: viewUrl,
          },
          // Resolved per src/lib/mightymail-series.ts → 'approvepro' series,
          // less manualOnly. Inlined to keep this edge fn standalone.
          // ap-01 (proof-sent) is omitted because sendProofToClient above
          // already delivered the canonical proof-ready email. ap-05
          // (on-approve) is fired by proof-sign instead.
          emails: [
            { slug: "ap-02-24h-reminder", delayDays: 1 },
            { slug: "ap-03-48h-revisions", delayDays: 2 },
            { slug: "ap-04-72h-decision", delayDays: 3 },
          ],
          anchorAt: sentAt,
        }),
      });
    } catch (e) {
      // Non-fatal — proof was already sent successfully. Log and move on.
      console.error("proof-send: mightymail-enqueue-series failed (non-fatal):", e);
    }

    return jsonResponse({
      success: true,
      status: "sent",
      sent_at: sentAt,
      view_url: viewUrl,
      resend_id: emailResult.id,
    });
  } catch (err) {
    console.error("proof-send: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error" }, 500);
  }
});
