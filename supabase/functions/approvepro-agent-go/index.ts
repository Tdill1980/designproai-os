/**
 * approvepro-agent-go — the "GO" button's brain. One press runs the A.C.E
 * (AI Creative Engine) agent on a design order:
 *
 *   1. Parse the order — does it have a brief / uploaded examples? a design yet?
 *   2. If there's NO design and there IS a brief → trigger the REAL design in
 *      DesignPro (approvepro-autogen-design, forwarding the user's session so
 *      the render pipeline has auth).
 *   3. If there's NO design and the brief is MISSING → send the customer the
 *      branded missing-instructions email with their portal link
 *      (request-order-instructions, force) so they can add details.
 *   4. If a design already exists → report the next human step (send / awaiting).
 *
 * It never touches the locked render pipeline directly — it only routes to the
 * existing functions. Returns { action, message } so the UI shows the result.
 *
 * Per JWT.md §1: verify_jwt = false in supabase/config.toml.
 */

import { approveProDisabledResponse, isApproveProLive } from "../_shared/approvepro-runtime.ts";
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { classifyIntake } from "../_shared/approvepro-brief.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function hasRealRender(v: any): boolean {
  if (!v) return false;
  const urls = (v.render_urls && typeof v.render_urls === "object") ? Object.values(v.render_urls) : [];
  if (urls.some((u) => typeof u === "string" && u && !u.includes("weprintwraps.com"))) return true;
  return Array.isArray(v.uploaded_file_paths) && v.uploaded_file_paths.length > 0;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const { proof_id, force } = await req.json().catch(() => ({}));
    if (!proof_id) return json({ error: "proof_id required" }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("authorization") || "";
    const db = createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data: proof } = await db.from("proof_approvals").select("*").eq("id", proof_id).maybeSingle();
    if (!proof) return json({ error: "Proof not found" }, 404);

    const md = (proof.metadata as any) || {};
    const status = String(proof.status || "").toLowerCase();
    if (["approved", "declined", "revoked", "expired"].includes(status)) {
      return json({ ok: true, action: "none", message: `Order is ${status} — nothing for A.C.E to do.` });
    }

    // A real brief = RELEVANT design instructions or uploaded art. WooCommerce
    // form scaffolding ("Other | Please note in box below…") does NOT count.
    let hasBrief = classifyIntake(md).hasBrief;

    const { data: activeVer } = await db
      .from("proof_versions")
      .select("render_urls, uploaded_file_paths")
      .eq("proof_id", proof.id)
      .eq("is_active", true)
      .maybeSingle();
    const hasDesign = hasRealRender(activeVer);

    // A PENDING EDIT = a typed instruction (or attached change request) waiting to
    // be applied to the EXISTING design — e.g. "add the three sponsor logos to the
    // doors". This must run a SURGICAL revision, not report "already done". Without
    // this the typed brief was saved but the agent short-circuited and nothing ran
    // ("A.C.E is parsing… yet nothing happens").
    const pendingEdit = String(md.manual_prompt || "").trim() ||
      String((proof as any).change_request || "").trim();
    // A pending edit IS something to act on — don't fall into the "no brief, ask
    // the customer for details" path; route straight to the surgical revision.
    if (pendingEdit) hasBrief = true;

    // ── A design already exists → report the next human step. ──
    // EXCEPT when force=true (explicit Save & GO with new context) OR there's a
    // pending typed edit to apply: fall through and (re)design / surgically revise.
    if (hasDesign && !force && !pendingEdit) {
      if (status === "draft") return json({ ok: true, action: "ready", message: "Design is ready — send the proof to the customer." });
      return json({ ok: true, action: "sent", message: "Proof is already with the customer — awaiting their response." });
    }

    // ── No brief yet? Auto-search the design inbox for THIS customer FIRST. ──
    // Many customers email design@weprintwraps.com instead of filling the
    // checkout box. intake-graph-poll (search mode) scans the mailbox by the
    // client's email + order #, and folds any instructions + image examples it
    // finds straight into THIS order's brief + uploads (dated, source=email),
    // saved right here in ApprovePro. Then we re-check. No-op until MS_GRAPH_*.
    if (!hasBrief) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/intake-graph-poll`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
          body: JSON.stringify({ mode: "search", proof_id: proof.id }),
        });
        const { data: fresh } = await db.from("proof_approvals").select("metadata").eq("id", proof.id).maybeSingle();
        if (fresh?.metadata) hasBrief = classifyIntake(fresh.metadata).hasBrief;
      } catch (e) {
        console.warn("agent-go: inbox search failed (non-fatal)", (e as any)?.message || e);
      }
    }

    // ── Still no design, no brief → send the missing-instructions email + portal. ──
    // NOTE: force is intentionally FALSE here. request-order-instructions skips
    // if this order was already invited (instructions_requested_at set), so
    // pressing GO repeatedly never re-emails the customer. The human "Resend
    // invite" button is the explicit force-resend.
    if (!hasBrief) {
      // Belt-and-suspenders: if we already invited this order, don't even call.
      if (md.instructions_requested_at || md.welcome_sent_at) {
        return json({
          ok: true, action: "already_requested",
          message: `Already invited ${proof.customer_email} — waiting on their details. Use "Resend invite" to send again.`,
        });
      }
      const wooOrderId = md.wpw_woo_order_id || md.wpw_order_number || md.woo_order_id || md.woo_order_number;
      const orderNumber = md.wpw_order_number || md.wpw_woo_order_id || undefined;
      const res = await fetch(`${supabaseUrl}/functions/v1/request-order-instructions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify({
          to: proof.customer_email,
          customerName: proof.customer_name || undefined,
          orderNumber,
          vehicle: [proof.vehicle_year, proof.vehicle_make, proof.vehicle_model].filter(Boolean).join(" ") || undefined,
          isWpw: md.auto_ingested === "wpw",
          kind: "request",
          wooOrderId,
        }),
      });
      const out = await res.json().catch(() => ({}));
      const skipped = !!(out as any)?.skipped;
      await db.from("proof_events").insert({
        proof_id: proof.id, event_type: "agent_go", actor_role: "system",
        payload: { decision: skipped ? "already_requested" : "requested_info", emailed: res.ok && !skipped, to: proof.customer_email },
      });
      return json({
        ok: true,
        action: skipped ? "already_requested" : "requested_info",
        message: skipped
          ? `Already invited ${proof.customer_email} — waiting on their details.`
          : res.ok
            ? `Brief was missing — A.C.E emailed ${proof.customer_email} the portal link to add their design details.`
            : `Brief is missing, but the email couldn't send — check logs.`,
      });
    }

    // ── No design, brief present → trigger the REAL design in DesignPro. ──
    // Clear any stale autogen flag first so a stuck 'done'/'failed' from a prior
    // run that produced no real design can't block a fresh re-fire.
    if (md.autogen_status) {
      await db.from("proof_approvals").update({ metadata: { ...md, autogen_status: null } }).eq("id", proof.id);
    }
    const res = await fetch(`${supabaseUrl}/functions/v1/approvepro-autogen-design`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the user's session so the locked render pipeline has auth;
        // fall back to the service key.
        Authorization: authHeader || `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
      body: JSON.stringify({ proof_id: proof.id }),
    });
    const ok = res.ok || res.status === 202;
    // A surgical edit (existing design + a typed instruction) reads differently
    // from a first-time design — be honest about which one is running.
    const isEdit = hasDesign && !!pendingEdit && !force;
    await db.from("proof_events").insert({
      proof_id: proof.id, event_type: "agent_go", actor_role: "system",
      payload: { decision: isEdit ? "revising" : "designing", triggered: ok },
    });
    return json({
      ok: true,
      action: ok ? (isEdit ? "revising" : "designing") : "design_failed",
      message: ok
        ? (isEdit
            ? "A.C.E is applying your change to every view — the updated design + 2D proof will appear here shortly."
            : "A.C.E is parsing the brief and creating the design in DesignPro — it'll appear here shortly.")
        : "Couldn't start the design — try again or upload manually.",
    });
  } catch (e: any) {
    console.error("approvepro-agent-go:", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
