/**
 * helper-ticket-action — admin actions on Sprocket helper tickets.
 *
 * Admin/tester only (verified from the caller's JWT). Actions:
 *   - "status"   : set status (open|in_progress|wont_fix)
 *   - "resolve"  : mark resolved + notify the user by email (Resend) and SMS
 *                  (Twilio) that the fix is live; stamps notified_at.
 *   - "handoff"  : create a GitHub issue (label "claude-autofix") so the Claude
 *                  Code fix pipeline picks it up. Approval gate = a human merges
 *                  the resulting PR; nothing deploys automatically from chat.
 *
 * Request: { ticketId, action, status?, resolution_notes? }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const DEFAULT_REPO = "Tdill1980/restylepro-os";
const APP_URL = "https://app.restylepro.com"; // notification link base

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // ── Auth: admin/tester JWT, OR the CI hook secret (used by the
    //    auto-notify-on-merge workflow) ───────────────────────────────────
    const hookSecret = Deno.env.get("SPROCKET_HOOK_SECRET");
    const viaHook = !!hookSecret && req.headers.get("x-hook-secret") === hookSecret;

    if (!viaHook) {
      const authHeader = req.headers.get("Authorization") ?? "";
      if (!authHeader.startsWith("Bearer ")) return json({ error: "Missing Authorization" }, 401);
      const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
      const { data: { user }, error: userErr } = await userClient.auth.getUser();
      if (userErr || !user) return json({ error: "Not authenticated" }, 401);
      const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id).in("role", ["admin", "tester"]);
      if (!roles || roles.length === 0) return json({ error: "Forbidden — admin only" }, 403);
    }

    // Allow resolving by GitHub issue number (CI path) as well as ticketId.
    const reqBody = await req.json().catch(() => ({}));
    let { ticketId, action, status, resolution_notes } = reqBody;
    if (!ticketId && reqBody.issue_number) {
      const { data: byIssue } = await admin
        .from("helper_tickets").select("id").eq("github_issue_number", reqBody.issue_number).maybeSingle();
      ticketId = byIssue?.id;
    }
    if (!ticketId || !action) return json({ error: "ticketId (or issue_number) and action are required" }, 400);

    const { data: ticket, error: tErr } = await admin.from("helper_tickets").select("*").eq("id", ticketId).maybeSingle();
    if (tErr) return json({ error: `DB: ${tErr.message}` }, 500);
    if (!ticket) return json({ error: "Ticket not found" }, 404);

    // ───────────────────────────────────────────────────────────── status
    if (action === "status") {
      await admin.from("helper_tickets").update({ status: status || "in_progress", updated_at: new Date().toISOString() }).eq("id", ticketId);
      return json({ ok: true, status: status || "in_progress" });
    }

    // ──────────────────────────────────────────────────────────── resolve
    if (action === "resolve") {
      // Resolved via the CI hook = an auto-shipped "hot fix"; via admin JWT = a
      // manual resolve. This drives the hot-fix vs. open split on the dashboard.
      await admin.from("helper_tickets").update({
        status: "resolved",
        resolution_notes: resolution_notes || null,
        auto_shipped: viaHook,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", ticketId);

      const notes = resolution_notes ? `  What we did: ${resolution_notes}` : "";
      let emailed = false, texted = false;

      // Email via Resend
      const resendKey = Deno.env.get("RESEND_API_KEY");
      if (resendKey && ticket.user_email && ticket.notify_email) {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "RestylePro Support <Design@weprintwraps.com>",
              to: ticket.user_email,
              subject: "✅ Your RestylePro issue is fixed — it's live",
              html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:520px">
                <h2 style="margin:0 0 8px">Good news — it's fixed and live 🎉</h2>
                <p>The issue you reported${ticket.summary ? ` (“${ticket.summary}”)` : ""} has been resolved and deployed.${notes}</p>
                <p>Just do a quick refresh (or it'll auto-update) and you're good to go.</p>
                <p><a href="${APP_URL}${ticket.page || ""}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none">Open RestylePro</a></p>
                <p style="color:#888;font-size:12px">— Sprocket & the RestylePro team</p>
              </div>`,
            }),
          });
          emailed = r.ok;
        } catch (_) { /* ignore */ }
      }

      // SMS via Twilio
      const tSid = Deno.env.get("TWILIO_ACCOUNT_SID");
      const tTok = Deno.env.get("TWILIO_AUTH_TOKEN");
      const tFrom = Deno.env.get("TWILIO_PHONE_NUMBER");
      if (tSid && tTok && tFrom && ticket.contact_phone && ticket.notify_sms) {
        try {
          const form = new URLSearchParams();
          form.append("To", ticket.contact_phone);
          form.append("From", tFrom);
          form.append("Body", `RestylePro: the issue you reported is fixed and live 🎉 Refresh the app and you're set. — Sprocket`);
          const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tSid}/Messages.json`, {
            method: "POST",
            headers: { Authorization: `Basic ${btoa(`${tSid}:${tTok}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: form.toString(),
          });
          texted = r.ok;
        } catch (_) { /* ignore */ }
      }

      // Team copy — also email you/the team so there's a record that it shipped.
      let teamed = false;
      const teamTo = (Deno.env.get("TEAM_NOTIFY_EMAILS") || "").split(",").map((s) => s.trim()).filter(Boolean);
      if (resendKey && teamTo.length) {
        try {
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Sprocket <Design@weprintwraps.com>",
              to: teamTo,
              subject: `✅ Sprocket fix shipped: ${ticket.summary || "ticket"}`,
              html: `<div style="font-family:system-ui,Arial,sans-serif;max-width:560px">
                <h3 style="margin:0 0 8px">A Sprocket ticket was resolved & deployed</h3>
                <p><b>Issue:</b> ${ticket.summary || "(none)"}<br/>
                <b>Page:</b> ${ticket.page || "—"}<br/>
                <b>Customer:</b> ${ticket.user_email || ticket.user_id || "anonymous"} ${ticket.contact_phone ? "· " + ticket.contact_phone : ""}<br/>
                <b>Resolved:</b> ${new Date().toLocaleString()}</p>
                ${resolution_notes ? `<p><b>Fix:</b> ${resolution_notes}</p>` : ""}
                ${ticket.github_issue_url ? `<p><a href="${ticket.github_issue_url}">View the fix issue/PR →</a></p>` : ""}
                <p>Customer notified: email ${emailed ? "✓" : "—"}, text ${texted ? "✓" : "—"}.</p>
              </div>`,
            }),
          });
          teamed = r.ok;
        } catch (_) { /* ignore */ }
      }

      await admin.from("helper_tickets").update({ notified_at: new Date().toISOString() }).eq("id", ticketId);
      return json({ ok: true, emailed, texted, teamed });
    }

    // ──────────────────────────────────────────────────────────── handoff
    if (action === "handoff") {
      const ghToken = Deno.env.get("GITHUB_PAT") ?? Deno.env.get("GITHUB_TOKEN");
      const repo = Deno.env.get("GITHUB_REPO") ?? DEFAULT_REPO;
      if (!ghToken) return json({ error: "GITHUB_PAT not configured" }, 500);

      const transcript = Array.isArray(ticket.transcript)
        ? ticket.transcript.map((m: any) => `**${m.role}:** ${m.content}`).join("\n\n")
        : "(no transcript)";
      const title = `[Sprocket] ${ticket.summary || "Customer-reported issue"}`.slice(0, 120);
      const body = [
        `Reported via the Sprocket in-app helper.`,
        ``,
        `- **Page:** ${ticket.page || "unknown"}`,
        `- **User:** ${ticket.user_email || ticket.user_id || "anonymous"}`,
        `- **Category:** ${ticket.category}`,
        `- **Ticket id:** ${ticket.id}`,
        ``,
        `### Conversation`,
        transcript,
        ``,
        `---`,
        `_Approval gate: a human reviews & merges the fix PR — nothing deploys automatically. When merged + live, resolve the ticket to auto-notify the customer._`,
      ].join("\n");

      const ghHeaders = {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "restylepro-sprocket",
        "Content-Type": "application/json",
      };
      await fetch(`https://api.github.com/repos/${repo}/labels`, {
        method: "POST", headers: ghHeaders,
        body: JSON.stringify({ name: "claude-autofix", color: "7c3aed", description: "Auto-fix dispatched from Sprocket" }),
      }).catch(() => {});

      const ghRes = await fetch(`https://api.github.com/repos/${repo}/issues`, {
        method: "POST", headers: ghHeaders,
        body: JSON.stringify({ title, body, labels: ["claude-autofix", "sprocket"] }),
      });
      const issue = await ghRes.json();
      if (!ghRes.ok) return json({ error: `GitHub: ${issue?.message || ghRes.status}` }, 502);

      await admin.from("helper_tickets").update({
        status: "in_progress",
        github_issue_url: issue.html_url,
        github_issue_number: issue.number,
        dispatched_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", ticketId);

      return json({ ok: true, issue_url: issue.html_url, issue_number: issue.number });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
