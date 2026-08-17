/**
 * proof-intake-submit — the customer's portal intake.
 *
 * Public, token-based (no login, NO gating). From the branded portal a customer
 * types what they want + attaches logos/photos/inspiration; this folds those
 * into the order's brief (metadata.line_item_brief + customer_uploads) and
 * re-arms auto-design so the AI generates from their actual request. Logs the
 * submission on the order thread for the design team.
 *
 * Body: { token, instructions, reference_image_paths?: string[] }
 *   reference_image_paths are proof-uploads storage paths from
 *   proof-upload-revision-ref. We copy them into the public wrap-files bucket so
 *   the design engine + Work Order can use durable URLs.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifyProofToken } from "../_shared/proof-tokens.ts";
import { runProofRevision, fanOutViewRevisions } from "../_shared/proof-ai-revise.ts";

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

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    let body: { token?: string; instructions?: string; reference_image_paths?: string[] };
    try { body = await req.json(); } catch { return jsonResponse({ error: "Invalid JSON body" }, 400); }
    if (!body.token) return jsonResponse({ error: "token required" }, 400);

    const instructions = (body.instructions || "").trim().slice(0, 4000);
    const refPaths = Array.isArray(body.reference_image_paths)
      ? body.reference_image_paths.filter((p) => typeof p === "string" && p).slice(0, 8)
      : [];
    if (!instructions && refPaths.length === 0) {
      return jsonResponse({ error: "Add a description or attach at least one image." }, 400);
    }

    let verifiedUuid: string | null;
    try { verifiedUuid = await verifyProofToken(body.token, "view"); }
    catch { return jsonResponse({ error: "Server misconfiguration" }, 500); }
    if (!verifiedUuid) return jsonResponse({ error: "Invalid token" }, 404);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: proof, error: fetchErr } = await db
      .from("proof_approvals")
      .select("id, status, metadata, customer_name, customer_email, vehicle_year, vehicle_make, vehicle_model, finish_type")
      .eq("view_token", body.token)
      .single();
    if (fetchErr || !proof) return jsonResponse({ error: "Proof not found" }, 404);
    if (["approved", "revoked", "expired"].includes(proof.status)) {
      return jsonResponse({ error: `This order is ${proof.status}.` }, 409);
    }

    // Copy uploaded references into the public wrap-files bucket for durable URLs.
    const uploadUrls: string[] = [];
    for (const path of refPaths) {
      try {
        const { data: blob } = await db.storage.from("proof-uploads").download(path);
        if (!blob) continue;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const safe = path.split("/").pop()?.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "ref.jpg";
        const dest = `intake/portal/${proof.id}/${Date.now()}-${safe}`;
        const { error: upErr } = await db.storage.from("wrap-files").upload(dest, bytes, {
          contentType: (blob as any).type || "image/jpeg", upsert: true,
        });
        if (!upErr) {
          const { data: pub } = db.storage.from("wrap-files").getPublicUrl(dest);
          if (pub?.publicUrl) uploadUrls.push(pub.publicUrl);
        }
      } catch { /* skip a bad file, keep going */ }
    }

    const meta = (proof.metadata as any) || {};
    const priorBrief = typeof meta.line_item_brief === "string" ? meta.line_item_brief : "";
    const mergedBrief = [priorBrief, instructions].filter(Boolean).join("\n\n").slice(0, 6000);
    const existingUploads = Array.isArray(meta.customer_uploads) ? meta.customer_uploads : [];
    const mergedUploads = [...existingUploads, ...uploadUrls].slice(0, 12);

    const newMeta: any = {
      ...meta,
      line_item_brief: mergedBrief || meta.line_item_brief,
      customer_uploads: mergedUploads,
      intake_submitted_at: new Date().toISOString(),
    };
    // Re-arm auto-design so the AI regenerates from the customer's actual brief
    // (unless it's already running). Only clear a non-running status.
    if (meta.autogen_status !== "running") delete newMeta.autogen_status;

    await db.from("proof_approvals").update({ metadata: newMeta, updated_at: new Date().toISOString() }).eq("id", proof.id);

    await db.from("proof_events").insert({
      proof_id: proof.id,
      event_type: "customer_comment",
      actor_role: "customer",
      payload: {
        source: "portal_intake",
        message: instructions || "(images only)",
        attachments: uploadUrls,
      },
    });

    // NOTIFY THE SHOP — a customer just requested a revision via the portal.
    // Without this the portal intake was silent: the team had no idea a revision
    // came in. Best-effort via send-team-email (Resend, staff-locked); never
    // blocks the customer's submission.
    try {
      const teamTo = (Deno.env.get("TEAM_NOTIFY_EMAILS") || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (teamTo.length) {
        const orderNo = meta.wpw_order_number || meta.wpw_woo_order_id || proof.id;
        const custName = (proof as any).customer_name || "Customer";
        const adminUrl = `https://app.restylepro.com/approvepro?id=${proof.id}`;
        const safeMsg = (instructions || "(images only)").replace(/[<>]/g, "");
        const attachHtml = uploadUrls.length
          ? `<p style="margin:8px 0 0;font-size:13px;color:#374151;">📎 ${uploadUrls.length} reference image(s) attached.</p>` : "";
        const inner = `
          <h2 style="margin:0 0 6px;font-size:18px;color:#111827;">Customer revision request</h2>
          <p style="margin:0 0 10px;font-size:13px;color:#6b7280;">Order #${orderNo} — ${custName}</p>
          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;font-size:14px;color:#111827;white-space:pre-wrap;">${safeMsg}</div>
          ${attachHtml}
          <p style="margin:14px 0 0;"><a href="${adminUrl}" style="display:inline-block;background:#3b82f6;color:#fff;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;">Open in ApprovePro →</a></p>
          <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">A new design version is regenerating automatically with this request.</p>`;
        await fetch(`${supabaseUrl}/functions/v1/send-team-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
          body: JSON.stringify({
            to: teamTo,
            subject: `Revision request — Order #${orderNo} (${custName})`,
            html: inner,
            replyTo: (proof as any).customer_email || undefined,
          }),
        });
      }
    } catch (e) {
      console.warn("proof-intake-submit: shop notify (non-fatal):", (e as any)?.message || e);
    }

    // FIRST DESIGN vs REVISION — the critical fork.
    //   • FIRST design (no version yet)  → run the full generator from scratch.
    //   • REVISION (a design exists)     → EDIT THE EXISTING design via the same
    //     RevisionStudio engine (runProofRevision: Gemini image-to-image on the
    //     active render). NEVER re-run the full generator on a revision — that
    //     rebuilds from scratch and blends the references into drift, throwing
    //     away the approved design.
    const { data: activeVersion } = await db
      .from("proof_versions")
      .select("id, version_number, render_urls")
      .eq("proof_id", proof.id)
      .eq("is_active", true)
      .maybeSingle();

    let revised = false;
    // AUTO-DESIGN DISABLED (Trish) — intake no longer auto-generates a "first
    // design" (it produced unsolicited AI slop). Staff generate designs manually
    // via GO / Regenerate. Customer-requested REVISIONS on an existing design
    // (the branch below) are unaffected. Set ACE_AUTO_DESIGN=true to restore.
    const AUTO_DESIGN_ENABLED = Deno.env.get("ACE_AUTO_DESIGN") === "true";
    if (AUTO_DESIGN_ENABLED && !activeVersion && meta.autogen_status !== "running") {
      // FIRST DESIGN — full generation.
      try {
        await fetch(`${supabaseUrl}/functions/v1/approvepro-autogen-design`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
          body: JSON.stringify({ proof_id: proof.id }),
        });
      } catch (e) {
        console.warn("proof-intake-submit: autogen trigger (non-fatal):", (e as any)?.message || e);
      }
    } else if (activeVersion && instructions) {
      // REVISION — targeted edit on the EXISTING design (no from-scratch rebuild).
      try {
        const ru = (activeVersion.render_urls as Record<string, string>) || {};
        const originalImageUrl = ru.hero || ru.side || ru.roof || Object.values(ru)[0] || null;
        if (originalImageUrl) {
          const vehicleSummary = [(proof as any).vehicle_year, (proof as any).vehicle_make, (proof as any).vehicle_model].filter(Boolean).join(" ");
          const result = await runProofRevision({
            originalImageUrl,
            customerPrompt: instructions,
            vehicleSummary,
            finishType: (proof as any).finish_type || undefined,
            referenceImageUrls: uploadUrls.length > 0 ? uploadUrls.slice(0, 3) : undefined,
          });
          if (result.ok) {
            const ts = Date.now();
            const newPath = `renders/proof-ai/${proof.id}/${ts}.png`;
            const { error: upErr } = await db.storage.from("wrap-files").upload(newPath, result.pngBytes, { contentType: result.mimeType, upsert: false });
            if (!upErr) {
              const { data: pub } = db.storage.from("wrap-files").getPublicUrl(newPath);
              const { data: maxRow } = await db.from("proof_versions").select("version_number").eq("proof_id", proof.id).order("version_number", { ascending: false }).limit(1).maybeSingle();
              const nextVer = (maxRow?.version_number ?? 0) + 1;
              await db.from("proof_versions").update({ is_active: false }).eq("proof_id", proof.id).eq("is_active", true);
              const { data: newVer } = await db.from("proof_versions").insert({
                proof_id: proof.id, version_number: nextVer, created_by_role: "customer", created_by_user_id: null,
                // Carry ALL prior angles forward + override hero with the revised
                // image, so the other 3D views never drop off on a revision.
                render_urls: { ...ru, hero: pub.publicUrl }, uploaded_file_paths: [], prompt_text: instructions.slice(0, 1500), is_active: true,
              }).select("id").maybeSingle();
              if (newVer) {
                revised = true;
                await db.from("proof_events").insert({
                  proof_id: proof.id, event_type: "ai_revise_completed", actor_role: "customer",
                  payload: { source: "portal_intake", engine: "edit_existing", new_version: nextVer, source_version_id: activeVersion.id },
                });
                // Fan the same edit out to every other 3D angle (parallel,
                // fire-and-forget; each patches into this new version atomically).
                try {
                  await fanOutViewRevisions({
                    supabaseUrl, authKey: serviceRoleKey,
                    proofId: proof.id, versionId: newVer.id,
                    priorRenderUrls: ru,
                    prompt: instructions,
                    vehicleSummary,
                    finishType: (proof as any).finish_type || undefined,
                  });
                } catch (e) { console.warn("proof-intake-submit: view fan-out (non-fatal):", (e as any)?.message || e); }
              }
            } else {
              console.warn("proof-intake-submit: revised render upload failed:", upErr.message);
            }
          } else {
            console.warn("proof-intake-submit: edit-existing revision failed:", result.reason, result.error);
          }
        }
      } catch (e) {
        console.warn("proof-intake-submit: revision edit (non-fatal):", (e as any)?.message || e);
      }
    }

    return jsonResponse({ success: true, attachments: uploadUrls.length, revised });
  } catch (err: any) {
    console.error("proof-intake-submit: unexpected error:", err);
    return jsonResponse({ error: "Unexpected server error", detail: err?.message }, 500);
  }
});
