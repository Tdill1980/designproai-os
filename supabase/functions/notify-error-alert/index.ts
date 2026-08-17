/**
 * notify-error-alert — emails the team when a NEW distinct error is captured.
 *
 * Invoked server-side by the `error_events_notify` AFTER INSERT trigger (via
 * pg_net) — so it fires once per new fingerprint, even for anonymous users,
 * and is never on the client's critical path. Idempotent: it stamps
 * `notified_at` on the row and no-ops if already set, so a replayed/duplicate
 * call can't double-email.
 *
 * Recipients: trish@ + jackson@weprintwraps.com + carley@restyleproai.com.
 * Override with the NOTIFY_ERROR_EMAIL env (comma-separated).
 *
 * Secrets: RESEND_API_KEY (shared with the other notify functions).
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are injected.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOTIFY_EMAILS = (
  Deno.env.get("NOTIFY_ERROR_EMAIL") ||
  "trish@weprintwraps.com,jackson@weprintwraps.com,carley@restyleproai.com"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SEVERITY_EMOJI: Record<string, string> = {
  fatal: "🔥",
  error: "⚠️",
  warning: "🛠️",
  info: "💡",
};

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { errorId } = await req.json().catch(() => ({}));
    if (!errorId) {
      return new Response(JSON.stringify({ ok: false, error: "errorId required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: ev, error } = await supabase
      .from("error_events")
      .select("*")
      .eq("id", errorId)
      .maybeSingle();
    if (error || !ev) {
      return new Response(JSON.stringify({ ok: false, error: "error event not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Idempotency: only alert once per error row.
    if (ev.notified_at) {
      return new Response(JSON.stringify({ ok: true, skipped: "already notified" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let emailOk = false;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      console.warn("[notify-error-alert] RESEND_API_KEY not set — skipping email");
    } else {
      const resend = new Resend(resendKey);
      const emoji = SEVERITY_EMOJI[ev.severity] || "🐞";
      const title = `${ev.error_name ? ev.error_name + ": " : ""}${ev.message}`;
      const subject = `${emoji} [Error · ${ev.severity}] ${title.slice(0, 70)}${title.length > 70 ? "…" : ""}`;
      const dashUrl = "https://restyleproai.com/admin/errors";

      const html = `
<div style="font-family:Inter,system-ui,sans-serif;color:#18181b;max-width:640px;margin:0 auto">
  <h2 style="font-size:18px;margin:0 0 6px">${emoji} New error captured — ${escapeHtml(String(ev.severity))}</h2>
  <p style="font-size:12px;color:#52525b;margin:0 0 16px">
    First seen ${new Date(ev.first_seen_at).toLocaleString()} · source <code>${escapeHtml(String(ev.source))}</code>
  </p>

  <pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:10px;font-size:13px;white-space:pre-wrap;color:#991b1b">${escapeHtml(title)}</pre>

  <table style="font-size:13px;border-collapse:collapse;margin:14px 0">
    <tr><td style="color:#71717a;padding:2px 12px 2px 0">Route</td><td><code>${escapeHtml(String(ev.route ?? "—"))}</code></td></tr>
    <tr><td style="color:#71717a;padding:2px 12px 2px 0">URL</td><td style="word-break:break-all">${escapeHtml(String(ev.url ?? "—"))}</td></tr>
    <tr><td style="color:#71717a;padding:2px 12px 2px 0">User</td><td>${escapeHtml(String(ev.user_email ?? (ev.user_id ? "authenticated" : "anonymous")))}</td></tr>
    <tr><td style="color:#71717a;padding:2px 12px 2px 0">App version</td><td><code>${escapeHtml(String(ev.app_version ?? "unknown"))}</code></td></tr>
    <tr><td style="color:#71717a;padding:2px 12px 2px 0">Fingerprint</td><td><code>${escapeHtml(String(ev.fingerprint))}</code></td></tr>
  </table>

  ${
    ev.stack
      ? `<h3 style="font-size:13px;margin:18px 0 6px">Stack</h3>
         <pre style="background:#f4f4f5;border-radius:4px;padding:8px;font-size:11px;overflow-x:auto;max-height:260px">${escapeHtml(String(ev.stack).slice(0, 4000))}</pre>`
      : ""
  }

  <p style="margin:24px 0 0">
    <a href="${dashUrl}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">
      Open Error Dashboard →
    </a>
  </p>
  <p style="font-size:10px;color:#a1a1aa;margin-top:24px">error_events id: <code>${escapeHtml(String(ev.id))}</code></p>
</div>`;

      const { error: emailErr } = await resend.emails.send({
        from: "RestylePro Errors <noreply@notifications.restyleproai.com>",
        to: NOTIFY_EMAILS,
        subject,
        html,
      });
      if (emailErr) console.warn("[notify-error-alert] resend error:", emailErr);
      else emailOk = true;
    }

    // Stamp notified_at regardless so we don't retry a hard email failure forever.
    await supabase
      .from("error_events")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", errorId);

    return new Response(JSON.stringify({ ok: true, email: emailOk }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.warn("[notify-error-alert] threw:", e);
    return new Response(JSON.stringify({ ok: false, error: String((e as Error)?.message ?? e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
