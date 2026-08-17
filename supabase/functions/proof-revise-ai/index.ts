/**
 * proof-revise-ai — Phase 4: Customer-side DIY AI revision.
 *
 * Public endpoint (no shop auth — customer hits it directly from the proof
 * page). HMAC view token is the auth boundary.
 *
 * Flow:
 *   1. Verify HMAC → load proof.
 *   2. Gate: mode == 'revision_loop', status not terminal, not expired,
 *      ai_revisions_used < ai_revisions_allowed.
 *   3. Insert a proof_ai_jobs row (status=running) — audit trail + budget
 *      tracking + Phase 5 escalation context.
 *   4. Atomically increment proof.ai_revisions_used BEFORE the Gemini call
 *      so a concurrent double-submit can't burn two credits.
 *   5. Call runProofRevision() — Gemini 3 Pro Image Preview, image-to-image.
 *   6. On success:
 *       - Upload new render to wrap-files bucket.
 *       - Deactivate current active version, insert new one (created_by_role
 *         = 'customer'), flip active.
 *       - Update proof_ai_jobs → done, set result_version_id.
 *       - Log 'ai_revise_completed' event.
 *   7. On failure:
 *       - Refund the credit (decrement ai_revisions_used back).
 *       - Update proof_ai_jobs → failed, set error_message.
 *       - Log 'ai_revise_failed' event.
 *
 * Idempotency-Key required. Dedup within proof_ai_jobs by (proof_id, key).
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";
import { runProofRevision, fanOutViewRevisions } from "../_shared/proof-ai-revise.ts";
import { amplifyRevisionPrompt } from "../_shared/revision-prompt-amplifier.ts";
import { verifyRevisionChanged } from "../_shared/revision-change-verifier.ts";
import { notifyShopRevisionRequested, recordProofEmail } from "../_shared/proof-email.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, idempotency-key",
};

interface ReviseRequest {
  token: string;
  prompt: string;
  /** Customer-attached reference images (proof-uploads storage paths from
   *  proof-upload-revision-ref) supplied mid-conversation — "here's the look
   *  I want". Resolved to signed URLs and passed to Gemini as guidance. */
  reference_image_paths?: string[];
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: ReviseRequest;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    if (!body.token) return jsonResponse({ error: "token required" }, 400);
    if (!body.prompt || body.prompt.trim().length < 3) {
      return jsonResponse(
        { error: "prompt required (min 3 chars) — describe what to change" },
        400,
      );
    }
    if (body.prompt.length > 500) {
      return jsonResponse(
        { error: "prompt too long (max 500 chars)" },
        400,
      );
    }

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
      console.error("proof-revise-ai: token verify threw:", err);
      return jsonResponse({ error: "Server misconfiguration" }, 500);
    }
    if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── Load proof ──
    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("*")
      .eq("view_token", body.token)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);

    if (proof.mode !== "revision_loop") {
      return jsonResponse(
        { error: "AI revisions are not enabled for this proof" },
        409,
      );
    }
    if (["approved", "declined", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse({ error: `Proof is ${proof.status}` }, 409);
    }
    if (proof.expires_at && new Date(proof.expires_at) < new Date()) {
      return jsonResponse({ error: "Proof has expired" }, 410);
    }

    const allowed = Number(proof.ai_revisions_allowed ?? 0);
    const used = Number(proof.ai_revisions_used ?? 0);
    if (used >= allowed) {
      return jsonResponse(
        {
          error: "You've used all AI revisions for this proof",
          reason: "rate_limited",
          allowed,
          used,
        },
        429,
      );
    }

    // ── Idempotency check (match by key) ──
    const { data: priorJob } = await db
      .from("proof_ai_jobs")
      .select("id, status, result_version_id, error_message")
      .eq("proof_id", proof.id)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (priorJob) {
      return jsonResponse({
        success: priorJob.status === "done",
        already_processed: true,
        job_id: priorJob.id,
        job_status: priorJob.status,
        result_version_id: priorJob.result_version_id,
        error: priorJob.error_message,
      });
    }

    // ── Load active version for the source image ──
    const { data: activeVersion } = await db
      .from("proof_versions")
      .select("id, version_number, render_urls, uploaded_file_paths")
      .eq("proof_id", proof.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!activeVersion) {
      return jsonResponse({ error: "No active version to revise" }, 409);
    }

    const renderUrls = (activeVersion.render_urls as Record<string, string>) || {};
    const originalImageUrl =
      renderUrls.hero ||
      renderUrls.side ||
      renderUrls.roof ||
      Object.values(renderUrls)[0] ||
      (activeVersion.uploaded_file_paths as string[])?.[0] ||
      null;
    if (!originalImageUrl) {
      return jsonResponse({ error: "Active version has no image to revise" }, 409);
    }

    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
               req.headers.get("x-real-ip") || null;
    const userAgent = req.headers.get("user-agent") || null;

    // ── Create job row ──
    const { data: job, error: jobErr } = await db
      .from("proof_ai_jobs")
      .insert({
        proof_id: proof.id,
        source_version_id: activeVersion.id,
        status: "running",
        idempotency_key: idempotencyKey,
        attempts: 1,
        customer_prompt: body.prompt.trim(),
        customer_ip: ip,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (jobErr || !job) {
      console.error("proof-revise-ai: job insert failed:", jobErr);
      return jsonResponse(
        { error: "Failed to create AI job", detail: jobErr?.message },
        500,
      );
    }

    // ── Atomically increment ai_revisions_used (anti-doublespend) ──
    const { error: incErr } = await db
      .from("proof_approvals")
      .update({ ai_revisions_used: used + 1 })
      .eq("id", proof.id)
      .eq("ai_revisions_used", used);
    if (incErr) {
      // Race lost — another request claimed this credit first. Abort + fail job.
      await db
        .from("proof_ai_jobs")
        .update({
          status: "failed",
          error_message: "Credit race — try again",
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      return jsonResponse(
        { error: "Credit already claimed — try again", reason: "race" },
        409,
      );
    }

    // ── Audit: ai_revise_started ──
    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "ai_revise_started",
      actor_role: "customer",
      ip,
      user_agent: userAgent,
      payload: {
        idempotency_key: idempotencyKey,
        job_id: job.id,
        prompt: body.prompt.trim(),
        source_version_id: activeVersion.id,
        credits_remaining: allowed - (used + 1),
      },
    });

    // ── Run Gemini ──
    const vehicleSummary = [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model]
      .filter(Boolean)
      .join(" ");

    // Resolve any customer-attached reference images (proof-uploads storage
    // paths) to short-lived signed URLs Gemini can fetch. Cap at 3 to keep the
    // payload small (image bloat degrades quality — see CLAUDE.md).
    const explicitRefPaths = Array.isArray(body.reference_image_paths)
      ? body.reference_image_paths.filter((p) => typeof p === "string" && p)
      : [];

    // Auto-carry: if the customer didn't attach new references THIS round, reuse
    // the most recent references already on file for this proof. The text-only
    // "Revise Design" dialog sends none, so prior revisions silently dropped the
    // customer's "match this photo" samples — Gemini never saw them, which is the
    // #1 cause of repeated "it still doesn't look like my reference" complaints.
    // Carrying the latest known references forward keeps every regen anchored.
    let carriedRefPaths: string[] = [];
    if (explicitRefPaths.length === 0) {
      const { data: refRows } = await db
        .from("proof_versions")
        .select("reference_image_paths, uploaded_file_paths, version_number")
        .eq("proof_id", proof.id)
        .order("version_number", { ascending: false })
        .limit(30);
      for (const row of refRows || []) {
        const fromRef = Array.isArray(row.reference_image_paths) ? row.reference_image_paths : [];
        const fromUpload = Array.isArray(row.uploaded_file_paths) ? row.uploaded_file_paths : [];
        const found = [...fromRef, ...fromUpload].filter((p) => typeof p === "string" && p);
        if (found.length > 0) { carriedRefPaths = found; break; }
      }
    }

    const refPaths = (explicitRefPaths.length > 0 ? explicitRefPaths : carriedRefPaths).slice(0, 3);
    const referenceImageUrls: string[] = [];
    for (const path of refPaths) {
      const { data: signed } = await db.storage
        .from("proof-uploads")
        .createSignedUrl(path, 60 * 10);
      if (signed?.signedUrl) referenceImageUrls.push(signed.signedUrl);
    }

    // ── Amplify the request before generation ──
    // Same fail-open amplifier revise-render has used all along; this path
    // never had it, so bare spatial requests ("wildcat needs centered") went
    // to the model as-is — the exact unreliability the amplifier's rule 6
    // documents. The customer's ORIGINAL words stay on the job row, the
    // version row, and the verification below; only the generation prompt is
    // amplified. Fail-open: any amplifier error returns the original.
    const customerRequest = body.prompt.trim();
    const amp = await amplifyRevisionPrompt(customerRequest, {
      toolType: "approvemode",
      viewType: "hero",
    });

    const result = await runProofRevision({
      originalImageUrl,
      customerPrompt: amp.amplified,
      vehicleSummary,
      finishType: proof.finish_type || undefined,
      referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
    });

    if (!result.ok) {
      // Refund the credit
      await db
        .from("proof_approvals")
        .update({ ai_revisions_used: used })
        .eq("id", proof.id)
        .eq("ai_revisions_used", used + 1);

      await db
        .from("proof_ai_jobs")
        .update({
          status: "failed",
          error_message: `${result.reason}${result.error ? ": " + result.error : ""}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      await db.from("proof_events").insert({
        proof_id: proof.id,
        event_type: "ai_revise_failed",
        actor_role: "customer",
        ip,
        user_agent: userAgent,
        payload: {
          job_id: job.id,
          reason: result.reason,
          error: result.error,
          credit_refunded: true,
        },
      });

      const status = result.reason === "missing_key" ? 500 : 502;
      return jsonResponse(
        {
          error: "AI revision failed — we didn't charge you",
          reason: result.reason,
          detail: result.error,
        },
        status,
      );
    }

    // ── Verify the REQUESTED change actually happened ──
    // "done" used to mean "an image came back", not "the edit the customer
    // asked for happened" — so an ignored request shipped as success and BURNED
    // a metered revision credit (live: ten attempts in 30 minutes on proof
    // 463a3175, all marked done). Same fail-open BEFORE/AFTER judge
    // revise-render uses: it only reports changed:false when it is confident
    // the requested edit did not happen, so a verifier hiccup can never
    // suppress a real revision. Judged against the customer's ORIGINAL words —
    // their intent is the contract, not the amplified rewrite.
    {
      let afterB64 = "";
      for (let i = 0; i < result.pngBytes.length; i += 8192) {
        const chunk = result.pngBytes.subarray(i, Math.min(i + 8192, result.pngBytes.length));
        afterB64 += String.fromCharCode.apply(null, Array.from(chunk));
      }
      afterB64 = btoa(afterB64);
      const verdict = await verifyRevisionChanged(
        originalImageUrl,
        afterB64,
        result.mimeType,
        customerRequest,
      );
      if (!verdict.changed) {
        console.warn(`proof-revise-ai: NO_VISIBLE_CHANGE — refusing to claim success. note="${verdict.note}"`);
        // Refund the credit — the customer must not pay for an ignored edit.
        await db
          .from("proof_approvals")
          .update({ ai_revisions_used: used })
          .eq("id", proof.id)
          .eq("ai_revisions_used", used + 1);
        // Mark the job failed HONESTLY — no version is saved.
        await db
          .from("proof_ai_jobs")
          .update({
            status: "failed",
            error_message: `no_visible_change: ${verdict.note}`,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        await db.from("proof_events").insert({
          proof_id: proof.id,
          event_type: "ai_revise_failed",
          actor_role: "customer",
          ip,
          user_agent: userAgent,
          payload: {
            job_id: job.id,
            reason: "no_visible_change",
            verifier_note: verdict.note,
            credit_refunded: true,
          },
        });
        return jsonResponse(
          {
            error:
              `The AI didn't visibly make that change ("${customerRequest}"), so no new version was saved and your revision credit was returned. ` +
              `Try naming the exact panel and change (e.g. "move the mascot onto the door, clear of the wheel"), or attach a reference image showing what you want.`,
            reason: "no_visible_change",
          },
          422,
        );
      }
    }

    // ── Upload new render to wrap-files ──
    const timestamp = Date.now();
    const newPath = `renders/proof-ai/${proof.id}/${timestamp}.png`;
    const { error: uploadErr } = await db.storage
      .from("wrap-files")
      .upload(newPath, result.pngBytes, {
        contentType: result.mimeType,
        upsert: false,
      });

    if (uploadErr) {
      // Credit has already been burned — log it and fail out but keep the
      // refund path consistent since we never produced a version.
      await db
        .from("proof_approvals")
        .update({ ai_revisions_used: used })
        .eq("id", proof.id)
        .eq("ai_revisions_used", used + 1);

      await db
        .from("proof_ai_jobs")
        .update({
          status: "failed",
          error_message: `upload_failed: ${uploadErr.message}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      console.error("proof-revise-ai: upload failed:", uploadErr);
      return jsonResponse(
        { error: "Failed to store revised render", detail: uploadErr.message },
        500,
      );
    }

    const { data: { publicUrl } } = db.storage
      .from("wrap-files")
      .getPublicUrl(newPath);

    // ── Create new version ──
    // Compute next version number
    const { data: maxRow } = await db
      .from("proof_versions")
      .select("version_number")
      .eq("proof_id", proof.id)
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersionNumber = (maxRow?.version_number ?? 0) + 1;

    // Deactivate current active
    await db
      .from("proof_versions")
      .update({ is_active: false })
      .eq("proof_id", proof.id)
      .eq("is_active", true);

    const { data: newVersion, error: insertErr } = await db
      .from("proof_versions")
      .insert({
        proof_id: proof.id,
        version_number: nextVersionNumber,
        created_by_role: "customer",
        created_by_user_id: null,
        // Carry ALL prior angles forward and override the hero with the revised
        // image — so the proof never loses its other 3D views on a revision. The
        // remaining angles get the same edit via the fan-out below (they upgrade
        // in place over the next minute or two; worst case they stay on the prior
        // image rather than disappearing).
        render_urls: { ...renderUrls, hero: publicUrl },
        uploaded_file_paths: refPaths,
        // Persist the references actually used so they survive on the version row
        // and auto-carry to the next regen (previously left empty — the wiring
        // gap that let customer uploads disappear between revisions).
        reference_image_paths: refPaths,
        prompt_text: body.prompt.trim(),
        ai_cost_estimate: 0.15, // rough Gemini 3 Pro Image estimate
        is_active: true,
      })
      .select("id, version_number")
      .single();

    if (insertErr || !newVersion) {
      // Re-activate prior version
      if (activeVersion.id) {
        await db
          .from("proof_versions")
          .update({ is_active: true })
          .eq("id", activeVersion.id);
      }
      await db
        .from("proof_ai_jobs")
        .update({
          status: "failed",
          error_message: `version_insert: ${insertErr?.message}`,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      console.error("proof-revise-ai: version insert failed:", insertErr);
      return jsonResponse(
        { error: "Failed to save new version", detail: insertErr?.message },
        500,
      );
    }

    // ── Mark job done ──
    await db
      .from("proof_ai_jobs")
      .update({
        status: "done",
        result_version_id: newVersion.id,
        completed_at: new Date().toISOString(),
      })
      .eq("id", job.id);

    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "ai_revise_completed",
      actor_role: "customer",
      ip,
      user_agent: userAgent,
      payload: {
        job_id: job.id,
        version_id: newVersion.id,
        version_number: newVersion.version_number,
        render_url: publicUrl,
      },
    });

    // ── Fan out the SAME edit to every other 3D angle ──
    // The hero is revised above; this dispatches one independent proof-revise-view
    // worker per remaining angle (parallel, fire-and-forget) to apply the same
    // change and atomically patch it into this new version. One credit covers the
    // whole multi-view revision. Non-fatal — angles already carried forward.
    try {
      const fanned = await fanOutViewRevisions({
        supabaseUrl, authKey: serviceRoleKey,
        proofId: proof.id, versionId: newVersion.id,
        priorRenderUrls: renderUrls,
        prompt: body.prompt.trim(),
        vehicleSummary, finishType: proof.finish_type || undefined,
        referenceImagePaths: refPaths,
      });
      if (fanned > 0) console.log(`proof-revise-ai: fanned out edit to ${fanned} other angle(s)`);
    } catch (e: any) {
      console.warn("proof-revise-ai: view fan-out (non-fatal):", e?.message || e);
    }

    // ── Notify the shop (email + cc team) that the customer revised ──
    // Without this, customer "Revise Design" edits were SILENT to the shop —
    // the #1 reported gap. Mirrors proof-request-revision's notify path.
    try {
      const { data: shopUser } = await db.auth.admin.getUserById(proof.shop_id);
      const shopEmail = shopUser?.user?.email;
      let shopName = shopUser?.user?.user_metadata?.shop_name || shopEmail?.split("@")[0] || "Your Wrap Shop";
      let ccEmails: string[] = [];
      try {
        const { data: shopProfile } = await db
          .from("shop_profiles")
          .select("shop_name, notification_emails")
          .eq("user_id", proof.shop_id)
          .maybeSingle();
        if (shopProfile?.shop_name) shopName = shopProfile.shop_name;
        if (Array.isArray(shopProfile?.notification_emails)) ccEmails = shopProfile.notification_emails;
      } catch (_) { /* non-fatal */ }
      if (shopEmail) {
        const baseUrl = Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
        const emailResult = await notifyShopRevisionRequested({
          shopEmail, shopName,
          customerName: proof.customer_name, customerEmail: proof.customer_email,
          designName: proof.design_name || "Vehicle Wrap Design",
          vehicleSummary: [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" "),
          revisionNotes: body.prompt.trim(),
          referenceImageUrls: [],
          manageUrl: `${baseUrl}/approve/manage/${proof.manage_token}`,
          workbenchUrl: `${baseUrl}/approvepro?id=${proof.id}`,
          viewUrl: `${baseUrl}/approve/${proof.view_token}`,
          proofId: proof.id,
          versionNumber: newVersion.version_number,
          ccEmails,
        });
        await recordProofEmail(db, {
          proofId: proof.id, direction: "to_shop", kind: "revision_requested",
          to: shopEmail, result: emailResult, actorRole: "customer", ip, userAgent,
        });
      }
    } catch (notifyErr) {
      console.warn("proof-revise-ai: shop notify (non-fatal):", notifyErr);
    }

    return jsonResponse({
      success: true,
      job_id: job.id,
      version_id: newVersion.id,
      version_number: newVersion.version_number,
      render_url: publicUrl,
      credits_remaining: allowed - (used + 1),
    });
  } catch (err: any) {
    console.error("proof-revise-ai: unexpected error:", err);
    return jsonResponse(
      { error: "Unexpected server error", detail: err?.message },
      500,
    );
  }
});
