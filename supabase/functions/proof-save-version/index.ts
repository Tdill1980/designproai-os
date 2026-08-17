/**
 * proof-save-version — Phase 3.
 *
 * Shop-owner action. Called from the shop's proof-management page after
 * they've revised the design (either uploaded a new file or pasted new
 * render URLs). Appends a new proof_versions row, flips the active flag,
 * transitions status back to `sent`, and re-emails the customer.
 *
 * Accepts one of:
 *   - render_urls: Record<string, string>   (newly-generated renders)
 *   - uploaded_file_paths: string[]         (shop uploaded artwork to
 *                                            proof-uploads/shop-versions/...)
 *
 * And optional:
 *   - shop_message        (shown in the new-version email)
 *   - prompt_text         (what prompt produced this version — audit trail)
 *
 * Idempotency via Idempotency-Key header — same key twice returns cached
 * result instead of creating a duplicate version.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyClientNewVersion, recordProofEmail } from "../_shared/proof-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

interface SaveVersionRequest {
  proof_id: string;
  render_urls?: Record<string, string>;
  uploaded_file_paths?: string[];
  shop_message?: string;
  prompt_text?: string;
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

    let body: SaveVersionRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }
    if (!body.proof_id) return jsonResponse({ error: "proof_id required" }, 400);

    const hasRenderUrls = body.render_urls && Object.keys(body.render_urls).length > 0;
    const hasUploads = Array.isArray(body.uploaded_file_paths) && body.uploaded_file_paths.length > 0;
    if (!hasRenderUrls && !hasUploads) {
      return jsonResponse(
        { error: "Provide render_urls or uploaded_file_paths" },
        400,
      );
    }

    const idempotencyKey =
      req.headers.get("idempotency-key") || req.headers.get("Idempotency-Key") || "";
    if (!idempotencyKey || idempotencyKey.length < 8) {
      return jsonResponse({ error: "Idempotency-Key header required" }, 400);
    }

    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Verify ownership + load proof
    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("*")
      .eq("id", body.proof_id)
      .eq("shop_id", shopId)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);
    if (proof.mode !== "revision_loop") {
      return jsonResponse(
        { error: "Versions can only be added to revision-loop proofs" },
        409,
      );
    }
    // "declined" is intentionally allowed: the shop's response to a customer
    // decline is to upload a revised version, which flips status back to "sent"
    // and re-notifies the customer (see status update below).
    if (["approved", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse({ error: `Proof is ${proof.status}` }, 409);
    }

    // Idempotency check — did this key already create a version?
    const { data: priorEvent } = await db
      .from("proof_events")
      .select("payload, created_at")
      .eq("proof_id", proof.id)
      .eq("event_type", "version_saved")
      .contains("payload", { idempotency_key: idempotencyKey })
      .limit(1)
      .maybeSingle();
    if (priorEvent) {
      return jsonResponse({
        success: true,
        already_saved: true,
        version_id: (priorEvent.payload as any)?.version_id,
        version_number: (priorEvent.payload as any)?.version_number,
      });
    }

    // Compute next version number
    const { data: maxRow } = await db
      .from("proof_versions")
      .select("version_number")
      .eq("proof_id", proof.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersionNumber = (maxRow?.version_number ?? 0) + 1;

    // ── Flip current active off ──
    const { error: deactivateErr } = await db
      .from("proof_versions")
      .update({ is_active: false })
      .eq("proof_id", proof.id)
      .eq("is_active", true);
    if (deactivateErr) {
      console.error("proof-save-version: deactivate failed:", deactivateErr);
      return jsonResponse(
        { error: "Failed to deactivate current version", detail: deactivateErr.message },
        500,
      );
    }

    // ── Insert new version ──
    const { data: newVersion, error: insertErr } = await db
      .from("proof_versions")
      .insert({
        proof_id: proof.id,
        version_number: nextVersionNumber,
        created_by_role: "shop",
        created_by_user_id: shopId,
        render_urls: body.render_urls || {},
        uploaded_file_paths: body.uploaded_file_paths || [],
        prompt_text: body.prompt_text || null,
        is_active: true,
      })
      .select("id, version_number")
      .single();

    if (insertErr || !newVersion) {
      console.error("proof-save-version: version insert failed:", insertErr);
      // Best-effort rollback — reactivate whatever was previously active
      await db
        .from("proof_versions")
        .update({ is_active: true })
        .eq("proof_id", proof.id)
        .eq("version_number", nextVersionNumber - 1);
      return jsonResponse(
        { error: "Failed to save new version", detail: insertErr?.message },
        500,
      );
    }

    // ── Auto-attach uploads to multi-item line items ──
    // For multi-item proofs, line items each have their own render_url.
    // proof-save-version historically only stored uploaded_file_paths on
    // the version row, so a customer viewing the proof saw "No preview"
    // on whatever line items were missing a URL. Now: when uploads are
    // provided AND the proof has line items AND any are missing
    // render_url, fill them in order using the public URL of each
    // uploaded file. Files are uploaded into the public wrap-files
    // bucket by proof-create-upload-url so the public URL is stable.
    if (hasUploads && proof.has_line_items) {
      const { data: pendingItems } = await db
        .from("proof_line_items")
        .select("id, line_number")
        .eq("proof_id", proof.id)
        .is("render_url", null)
        .order("line_number", { ascending: true });

      const queue = [...(body.uploaded_file_paths || [])];
      for (const li of (pendingItems || [])) {
        const path = queue.shift();
        if (!path) break;
        // The proof-create-upload-url function writes to the public
        // wrap-files bucket. If we ever see a legacy proof-uploads/
        // path here we'd need a signed URL — for now, public URL works.
        const { data: pub } = db.storage.from("wrap-files").getPublicUrl(path);
        const url = pub?.publicUrl;
        if (!url) continue;
        await db
          .from("proof_line_items")
          .update({ render_url: url })
          .eq("id", li.id);
      }
    }

    // ── Flip proof back to sent so state machine + UI treat it as a fresh sent ──
    const nowIso = new Date().toISOString();
    await db
      .from("proof_approvals")
      .update({
        status: "sent",
        sent_at: nowIso,
        // Clear prior change_request — the new version is the response
        change_request: null,
      })
      .eq("id", proof.id);

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "version_saved",
      actor_role: "shop",
      actor_user_id: shopId,
      ip,
      user_agent: userAgent,
      payload: {
        idempotency_key: idempotencyKey,
        version_id: newVersion.id,
        version_number: newVersion.version_number,
        has_render_urls: hasRenderUrls,
        has_uploads: hasUploads,
      },
    });

    // ── Notify client (non-blocking) ──
    const heroImageUrl =
      (body.render_urls?.hero) ||
      (body.render_urls?.side) ||
      (body.render_urls?.roof) ||
      (body.render_urls && Object.values(body.render_urls)[0]) ||
      null;

    let shopName = user.user_metadata?.shop_name || user.email?.split("@")[0] || "Your Wrap Shop";
    try {
      const { data: shopProfile } = await db
        .from("shop_profiles")
        .select("shop_name")
        .eq("user_id", shopId)
        .maybeSingle();
      if (shopProfile?.shop_name) shopName = shopProfile.shop_name;
    } catch {
      // non-fatal
    }

    const viewUrl = `${getPublicProofBaseUrl()}/approve/${proof.view_token}`;
    const emailResult = await notifyClientNewVersion({
      customerEmail: proof.customer_email,
      customerName: proof.customer_name,
      shopName,
      designName: proof.design_name || "Your Design",
      vehicleSummary:
        [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
          .filter(Boolean)
          .join(" "),
      heroImageUrl,
      viewUrl,
      shopMessage: body.shop_message || null,
      versionNumber: newVersion.version_number,
      expiresAtIso: proof.expires_at,
    });
    if (!emailResult.ok) {
      console.warn("proof-save-version: client notification failed:", emailResult.reason);
    }
    // Record the customer's new-version email in ApprovePro's "Emails sent"
    // ledger so the team sees the revision actually went out. Non-blocking.
    await recordProofEmail(db, {
      proofId: proof.id,
      direction: "to_customer",
      kind: "new_version",
      to: proof.customer_email,
      result: emailResult,
      actorRole: "shop",
      actorUserId: shopId,
      ip,
      userAgent,
    });

    return jsonResponse({
      success: true,
      status: "sent",
      version_id: newVersion.id,
      version_number: newVersion.version_number,
      view_url: viewUrl,
    });
  } catch (err: any) {
    console.error("proof-save-version: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
