/**
 * approvepro-followup-sweep — the AP Task Manager's follow-up engine.
 *
 * Runs on a daily cron (and can be called for one proof_id on demand). For each
 * ACTIVE WPW design order it picks the right friendly nudge and emails the
 * customer, with cadence guards so we never spam:
 *
 *   • revised_not_approved — they've revised but not approved:
 *       "We noticed you haven't approved yet — how can we design to your specs?"
 *   • no_response          — proof sent/viewed but silent for 2+ days:
 *       "Did you get a chance to see your wrap design?"
 *   • brief_missing        — intake sent but no brief after 2+ days:
 *       "Ready when you are — add your design details."
 *   • progress_update      — PROACTIVE (opt-in): brief is in and we're
 *       designing, proof not out yet — "we're on it, proof coming soon." Auto
 *       sends ONLY when APPROVEPRO_PROGRESS_UPDATES="on" (or body.enableProgress);
 *       always available via manual single-proof mode (kind:"progress_update").
 *
 * Cadence: wait 2 days before the first nudge of a kind, then min 3 days
 * between nudges of the same kind, max 3 per kind. Stamped on
 * metadata.followups so it's idempotent and never naggy.
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
function baseUrl(): string {
  return Deno.env.get("PROOF_PUBLIC_BASE_URL") || "https://restyleproai.com";
}
function esc(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const SPROCKET_IMG = "https://restyleproai.com/characters/sproket/sproket-clipboard.png";
const AGE_DAYS = 2;        // wait this long before the first nudge of a kind
const MIN_GAP_DAYS = 3;    // min gap between nudges of the same kind
const MAX_PER_KIND = 3;    // never nudge the same kind more than this

type Kind = "revised_not_approved" | "no_response" | "brief_missing" | "convert_3d" | "progress_update";

function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity;
  return (Date.now() - new Date(iso).getTime()) / 86_400_000;
}

function shell(inner: string): string {
  return `
  <div style="max-width:560px;margin:0 auto;font-family:Inter,Arial,sans-serif;background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#3b82f6" style="background:#3b82f6;background:linear-gradient(90deg,#3b82f6,#ec4899);">
      <tr>
        <td valign="middle" style="padding:16px 14px 16px 20px;width:60px;">
          <img src="${SPROCKET_IMG}" width="48" height="48" alt="Sprocket" style="display:block;width:48px;height:48px;object-fit:contain;" />
        </td>
        <td valign="middle" style="padding:16px 20px 16px 4px;">
          <div style="font-size:17px;font-weight:800;color:#fff;line-height:1.15;">ApprovePro&trade; <span style="font-weight:600;opacity:.9;">&times;</span> WePrintWraps.com</div>
          <div style="font-size:12px;color:#fff;opacity:.95;margin-top:2px;">Vehicle Wrap Design &amp; Approval System</div>
        </td>
      </tr>
    </table>
    <div style="padding:24px 28px;color:#374151;font-size:15px;line-height:1.6;">${inner}</div>
    <div style="padding:14px 24px;border-top:1px solid #e5e7eb;text-align:center;font-size:11px;color:#9ca3af;">
      Approve<span style="color:#ec4899;">Pro</span>&trade; &times; <span style="color:#3b82f6;">WePrint</span><span style="color:#ec4899;">Wraps</span>.com
    </div>
  </div>`;
}
function cta(url: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:18px 0 4px;"><tr>
    <td bgcolor="#3b82f6" style="border-radius:10px;background:#3b82f6;background:linear-gradient(90deg,#3b82f6,#ec4899);">
      <a href="${url}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:800;color:#fff;text-decoration:none;border-radius:10px;">${label} &rarr;</a>
    </td></tr></table>`;
}

function buildEmail(kind: Kind, name: string, portalUrl: string, design: string): { subject: string; html: string } {
  const hi = `Hi ${esc(name) || "there"},`;
  if (kind === "revised_not_approved") {
    return {
      subject: `How can we get your ${design} just right?`,
      html: shell(`<h2 style="margin:0 0 6px;font-size:20px;color:#111827;font-weight:800;">Let's make it perfect 🎨</h2>
        <p style="margin:14px 0 8px;color:#111827;">${hi}</p>
        <p style="margin:0 0 6px;">We noticed you've been working on your design but haven't approved it yet — totally fine! We want it exactly how you picture it.</p>
        <p style="margin:0 0 6px;"><strong>How can we design it to your specifications?</strong> Reply here, or jump back in and revise it with AI in seconds. When it's right, just hit approve.</p>
        ${cta(portalUrl, "Open my design")}`),
    };
  }
  if (kind === "no_response") {
    return {
      subject: `Did you get a chance to see your ${design}?`,
      html: shell(`<h2 style="margin:0 0 6px;font-size:20px;color:#111827;font-weight:800;">Your design is waiting 👀</h2>
        <p style="margin:14px 0 8px;color:#111827;">${hi}</p>
        <p style="margin:0 0 6px;">Just checking in — your wrap design is ready to review. Take a look when you have a minute; you can approve, revise it with AI, or tell us what you'd change.</p>
        ${cta(portalUrl, "Review my design")}`),
    };
  }
  if (kind === "convert_3d") {
    return {
      subject: `Close more approvals — turn your ${design} into a 3D render`,
      html: shell(`<h2 style="margin:0 0 6px;font-size:20px;color:#111827;font-weight:800;">Bring your proof to life in 3D ✨</h2>
        <p style="margin:14px 0 8px;color:#111827;">${hi}</p>
        <p style="margin:0 0 6px;">Your flat 2D proof is ready — and our <strong>new 3D render system</strong> can show it <strong>photorealistically on the actual vehicle from every angle</strong>. Clients approve faster when they can see the wrap come to life.</p>
        <div style="margin:14px 0;padding:14px 16px;background:#eff6ff;border-left:3px solid #3b82f6;border-radius:6px;">
          <p style="margin:0;font-size:14px;color:#111;line-height:1.6;">
            <strong>Add the 3D render for just $20</strong> — or go unlimited with a <strong>RecreatePro X</strong> membership and turn every proof into a 3D presentation to win more client approvals.
          </p>
        </div>
        ${cta(portalUrl, "Get my 3D render")}`),
    };
  }
  if (kind === "progress_update") {
    return {
      subject: `Your ${design} is in the works ✏️`,
      html: shell(`<h2 style="margin:0 0 6px;font-size:20px;color:#111827;font-weight:800;">We're on it 🛠️</h2>
        <p style="margin:14px 0 8px;color:#111827;">${hi}</p>
        <p style="margin:0 0 6px;">Quick update — our design team has everything we need and your <strong>${design}</strong> is actively being created. We'll email you the moment your proof is ready to review and approve.</p>
        <p style="margin:0 0 6px;">No action needed right now. If you'd like to add anything or have a question, just reply to this email or open your portal.</p>
        ${cta(portalUrl, "View my order")}`),
    };
  }
  return {
    subject: `Ready when you are — add your ${design} details`,
    html: shell(`<h2 style="margin:0 0 6px;font-size:20px;color:#111827;font-weight:800;">We're holding your spot ✨</h2>
      <p style="margin:14px 0 8px;color:#111827;">${hi}</p>
      <p style="margin:0 0 6px;">Whenever you're ready, add a few details about what you'd like and we'll get your design started. You can type it and upload any logos or inspiration right in your portal.</p>
      ${cta(portalUrl, "Add my details")}`),
  };
}

async function sendResend(payload: Record<string, unknown>, idempotencyKey: string): Promise<{ ok: boolean; id?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return { ok: false };
    const j = await r.json().catch(() => ({}));
    return { ok: true, id: j?.id };
  } catch { return { ok: false }; }
}

// Decide which nudge (if any) an order needs right now.
function pickKind(p: any): Kind | null {
  const status = String(p.status || "").toLowerCase();
  const md = p.metadata || {};
  if (["approved", "declined", "revoked", "expired"].includes(status)) return null;

  // Real brief = relevant design instructions or uploaded art; form
  // scaffolding ("Other | Please note in box below…") does NOT count, so those
  // orders correctly fall into brief_missing and get the portal invite.
  const hasBrief = classifyIntake(md).hasBrief;
  const revised = Number(p.ai_revisions_used || 0) > 0 || status === "revising";

  if (revised && status !== "draft") return "revised_not_approved";
  if (["sent", "viewed", "delivery_failed"].includes(status) && daysSince(p.sent_at) >= AGE_DAYS) return "no_response";
  // Auto-GO "request info": any no-brief draft (whether or not an intake email
  // already went out) gets the missing-instructions + portal nudge once it's
  // aged a bit. Uses created_at so never-contacted orders are caught too.
  if (status === "draft" && !hasBrief && daysSince(md.instructions_requested_at || p.created_at || p.sent_at) >= AGE_DAYS) return "brief_missing";
  // PROACTIVE progress update — the brief is in, so we're designing, but the
  // proof hasn't gone out yet. Keep the customer warm with a "we're on it"
  // note. Gated OFF by default at the sweep level (see progressEnabled) so this
  // never auto-emails until it's explicitly switched on; manual single-proof
  // mode (kind:"progress_update") can always send it for testing.
  if (status === "draft" && hasBrief && daysSince(md.instructions_requested_at || p.created_at) >= AGE_DAYS) return "progress_update";
  return null;
}

// Cadence guard: returns true if we may send this kind now.
function maySend(md: any, kind: Kind): boolean {
  const f = (md.followups || {})[kind] || { count: 0, last_at: null };
  if ((f.count || 0) >= MAX_PER_KIND) return false;
  if (f.last_at && daysSince(f.last_at) < MIN_GAP_DAYS) return false;
  return true;
}

async function processOne(db: any, p: any, force: boolean, kindOverride?: Kind | null): Promise<string | null> {
  const kind = kindOverride || pickKind(p);
  if (!kind) return null;
  const md = p.metadata || {};
  if (!force && !maySend(md, kind)) return null;
  if (!p.customer_email || !p.view_token) return null;

  const portalUrl = `${baseUrl()}/approve/${p.view_token}`;
  const design = (p.design_name || "wrap design").replace(/[<>]/g, "");
  const { subject, html } = buildEmail(kind, p.customer_name, portalUrl, design);

  // Claim the next logical follow-up before calling the provider. The unique
  // (proof_id, kind, sequence) constraint makes concurrent cron/webhook/retry
  // invocations collapse to one sender. A claimed row is intentionally not
  // deleted on provider ambiguity: suppressing a reminder is safer than
  // emailing a customer twice.
  const prev = (md.followups || {})[kind] || { count: 0, last_at: null };
  const sequence = (prev.count || 0) + 1;
  const idempotencyKey = `approvepro:${p.id}:${kind}:${sequence}`;
  const { data: claim, error: claimError } = await db
    .from("approvepro_followup_deliveries")
    .insert({
      proof_id: p.id,
      kind,
      sequence,
      idempotency_key: idempotencyKey,
      recipient_email: p.customer_email,
      subject,
      status: "claimed",
    })
    .select("id")
    .single();
  if (claimError) {
    if (claimError.code === "23505" || String(claimError.message || "").toLowerCase().includes("duplicate")) return null;
    throw new Error(`follow-up claim failed: ${claimError.message}`);
  }

  const res = await sendResend({
    from: "WePrintWraps Design <Design@weprintwraps.com>",
    to: [p.customer_email],
    reply_to: "Design@weprintwraps.com",
    subject,
    html,
  }, idempotencyKey);
  if (!res.ok) {
    await db.from("approvepro_followup_deliveries")
      .update({ status: "provider_error", updated_at: new Date().toISOString() })
      .eq("id", claim.id);
    return null;
  }

  await db.from("approvepro_followup_deliveries")
    .update({ status: "sent", provider_message_id: res.id || null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", claim.id);

  // Stamp cadence + log.
  const followups = { ...(md.followups || {}), [kind]: { count: (prev.count || 0) + 1, last_at: new Date().toISOString() } };
  await db.from("proof_approvals").update({ metadata: { ...md, followups }, updated_at: new Date().toISOString() }).eq("id", p.id);
  await db.from("proof_events").insert({
    proof_id: p.id,
    event_type: "followup_sent",
    actor_role: "system",
    payload: { kind, to: p.customer_email, subject, html, resend_id: res.id || null },
  });
  return kind;
}

serve(async (req) => {
  if (!isApproveProLive()) return approveProDisabledResponse();
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Single-proof mode (manual / testing).
    if (body?.proof_id) {
      const { data: p } = await db.from("proof_approvals").select("*").eq("id", body.proof_id).maybeSingle();
      if (!p) return json({ error: "Proof not found" }, 404);
      const kind = await processOne(db, p, body.force === true, body.kind || null);
      return json({ ok: true, proof_id: body.proof_id, sent: kind });
    }

    // Sweep mode is fail-closed. Manual single-proof mode remains separate,
    // but no cron/queue/webhook may email customers unless the owner explicitly
    // enables this secret after review.
    const automatedSendsEnabled = Deno.env.get("APPROVEPRO_AUTOMATED_SENDS") === "on";
    if (!automatedSendsEnabled) {
      return json({ ok: true, disabled: true, reason: "APPROVEPRO_AUTOMATED_SENDS is not on", sent: 0 });
    }

    // Sweep mode — active WPW design orders.
    const { data: proofs } = await db
      .from("proof_approvals")
      .select("*")
      .not("status", "in", "(approved,declined,revoked,expired)")
      .eq("metadata->>auto_ingested", "wpw")
      .limit(500);

    // Global per-run caps so a big backlog never blasts everyone in one day —
    // the queue is worked down gradually. Total cap + a tighter cap on the
    // cold "brief_missing" invites (the highest-volume kind).
    const MAX_PER_RUN = Number(body?.maxPerRun) || 40;
    const MAX_BRIEF_MISSING_PER_RUN = Number(body?.maxBriefMissing) || 20;
    // Proactive progress updates are OPT-IN: they only auto-send when explicitly
    // enabled (env APPROVEPRO_PROGRESS_UPDATES="on" or body.enableProgress).
    // Deploying this code alone changes NOTHING about what customers receive.
    const progressEnabled = body?.enableProgress === true || Deno.env.get("APPROVEPRO_PROGRESS_UPDATES") === "on";

    let sent = 0;
    const byKind: Record<string, number> = {};
    for (const p of (proofs || [])) {
      if (sent >= MAX_PER_RUN) break;
      // Pre-check the kind so we can enforce the brief_missing sub-cap without
      // sending. processOne re-derives it, but maySend/cadence still apply.
      const wantKind = pickKind(p);
      if (wantKind === "progress_update" && !progressEnabled) continue;
      if (wantKind === "brief_missing" && (byKind["brief_missing"] || 0) >= MAX_BRIEF_MISSING_PER_RUN) continue;
      const kind = await processOne(db, p, false);
      if (kind) { sent++; byKind[kind] = (byKind[kind] || 0) + 1; }
    }
    return json({ ok: true, scanned: (proofs || []).length, sent, byKind, capped: sent >= MAX_PER_RUN });
  } catch (e: any) {
    console.error("approvepro-followup-sweep:", e);
    return json({ error: String(e?.message || e) }, 500);
  }
});
