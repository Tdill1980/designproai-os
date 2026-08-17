/**
 * notify-engineroom-report
 *
 * Fires Slack + email notifications when a new EngineRoom Report is filed.
 * Called fire-and-forget from the ReportIssueWidget after the report row
 * is inserted. Never blocks the report from being saved — every failure
 * here is logged and swallowed.
 *
 * Slack: posts to SLACK_WEBHOOK_URL_ENGINEROOM (Incoming Webhook).
 * Email: sends via Resend to trish@weprintwraps.com (or NOTIFY_ENGINEROOM_EMAIL).
 *
 * Body shape:
 *   { report_id: string }
 *
 * The function reads the full report from engineroom_reports using the
 * service-role client so it doesn't depend on the caller's RLS context.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendSlackMessage } from "../_shared/slack-webhook.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Team recipients for new-report alerts. Override via NOTIFY_ENGINEROOM_EMAIL
// (comma-separated) if the roster changes.
const NOTIFY_EMAILS = (
  Deno.env.get("NOTIFY_ENGINEROOM_EMAIL") ||
  "trish@weprintwraps.com,jackson@weprintwraps.com,carley@restyleproai.com"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const SEVERITY_EMOJI: Record<string, string> = {
  blocker: "🔥",
  high: "⚠️",
  medium: "🛠️",
  low: "💡",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { report_id } = await req.json();
    if (!report_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "report_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: report, error } = await supabase
      .from("engineroom_reports")
      .select("*")
      .eq("id", report_id)
      .maybeSingle();

    if (error || !report) {
      console.warn("[notify-engineroom-report] report not found:", report_id, error?.message);
      return new Response(
        JSON.stringify({ ok: false, error: "report not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const emoji = SEVERITY_EMOJI[report.severity] || "🐞";
    const title = `${emoji} ${String(report.severity).toUpperCase()} · ${String(report.category).toUpperCase()}`;
    const summary = String(report.description).slice(0, 280);
    const queueUrl = `https://www.restyleproai.com/admin/engineroom-reports`;

    // ── Slack ────────────────────────────────────────────────────────
    const slackResult = await sendSlackMessage("SLACK_WEBHOOK_URL_ENGINEROOM", {
      text: `${title} — new EngineRoom report from ${report.reporter_email}`,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: `${emoji} New EngineRoom report` },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*Severity:*\n${report.severity}` },
            { type: "mrkdwn", text: `*Category:*\n${report.category}` },
            { type: "mrkdwn", text: `*Reporter:*\n${report.reporter_email}` },
            { type: "mrkdwn", text: `*Page:*\n${report.page_title || "(unknown)"}` },
          ],
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: `*Description*\n${summary}${report.description.length > 280 ? "…" : ""}` },
        },
        ...(report.screenshot_url
          ? [{
              type: "image" as const,
              image_url: report.screenshot_url,
              alt_text: "Reporter screenshot",
            }]
          : []),
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "Open in EngineRoom →" },
              url: `${queueUrl}?id=${report.id}`,
            },
            ...(report.page_url
              ? [{
                  type: "button" as const,
                  text: { type: "plain_text", text: "Visit reported page" },
                  url: report.page_url,
                }]
              : []),
          ],
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `Filed at ${new Date(report.created_at).toLocaleString()} · id \`${report.id}\`` }],
        },
      ],
    });

    // ── Email ────────────────────────────────────────────────────────
    let emailOk = false;
    try {
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (!resendKey) {
        console.warn("[notify-engineroom-report] RESEND_API_KEY not set — skipping email");
      } else {
        const resend = new Resend(resendKey);
        const subject = `[EngineRoom · ${report.severity}] ${report.category}: ${summary.slice(0, 60)}${summary.length > 60 ? "…" : ""}`;
        const consoleErrorsHtml =
          report.console_errors && Array.isArray(report.console_errors) && report.console_errors.length > 0
            ? `<h3 style="font-size:13px;margin:18px 0 6px">Recent console errors (${report.console_errors.length})</h3>
               <pre style="background:#f4f4f5;border-radius:4px;padding:8px;font-size:11px;overflow-x:auto;max-height:200px">${
                 escapeHtml(JSON.stringify(report.console_errors, null, 2))
               }</pre>`
            : "";
        const screenshotHtml = report.screenshot_url
          ? `<p style="margin:12px 0"><a href="${report.screenshot_url}" target="_blank"><img src="${report.screenshot_url}" alt="screenshot" style="max-width:100%;border:1px solid #e4e4e7;border-radius:4px"/></a></p>`
          : "";

        const html = `
<div style="font-family:Inter,system-ui,sans-serif;color:#18181b;max-width:640px;margin:0 auto">
  <h2 style="font-size:18px;margin:0 0 6px">${emoji} EngineRoom Report — ${escapeHtml(String(report.severity))} ${escapeHtml(String(report.category))}</h2>
  <p style="font-size:12px;color:#52525b;margin:0 0 16px">
    From <strong>${escapeHtml(String(report.reporter_email))}</strong> · ${new Date(report.created_at).toLocaleString()}
  </p>

  <h3 style="font-size:13px;margin:0 0 6px">Description</h3>
  <p style="font-size:14px;line-height:1.5;white-space:pre-wrap;margin:0 0 14px">${escapeHtml(String(report.description))}</p>

  ${screenshotHtml}

  <h3 style="font-size:13px;margin:18px 0 6px">Page</h3>
  <p style="font-size:13px;margin:0">
    ${escapeHtml(String(report.page_title || "(no title)"))}<br/>
    ${report.page_url ? `<a href="${report.page_url}" style="color:#2563eb;font-size:12px">${escapeHtml(String(report.page_url))}</a>` : ""}
  </p>

  ${consoleErrorsHtml}

  <p style="margin:24px 0 0">
    <a href="${queueUrl}?id=${report.id}"
       style="display:inline-block;padding:10px 16px;background:#f59e0b;color:#000;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">
      Open in EngineRoom →
    </a>
  </p>

  <p style="font-size:10px;color:#a1a1aa;margin-top:24px">
    Report ID: <code>${report.id}</code>
  </p>
</div>`;

        const { error: emailErr } = await resend.emails.send({
          from: "RestylePro EngineRoom <noreply@notifications.restyleproai.com>",
          to: NOTIFY_EMAILS,
          subject,
          html,
        });
        if (emailErr) {
          console.warn("[notify-engineroom-report] resend error:", emailErr);
        } else {
          emailOk = true;
        }
      }
    } catch (emailEx) {
      console.warn("[notify-engineroom-report] email threw:", emailEx);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        slack: slackResult,
        email: emailOk,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[notify-engineroom-report] unexpected error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: err?.message || "Unexpected" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
