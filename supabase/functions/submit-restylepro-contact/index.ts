// ──────────────────────────────────────────────────────────────────────
// submit-restylepro-contact
//
// PUBLIC endpoint (verify_jwt = false). Backs the site-wide "Questions /
// Instant Answers" widget and the above-the-fold entry on the marketing
// landing page. A visitor can ask a question or request a callback about a
// subscription tier — no account required.
//
// On submit we:
//   1. Insert the request into public.restylepro_contact_requests (service
//      role, so anonymous browsers never need to authenticate).
//   2. Email trish@weprintwraps.com via Resend with Reply-To set to the
//      customer's address, so a reply goes straight back to the customer.
//
// Request:  POST { name?, email, message?, topic?, tierInterest?, pagePath? }
// Response: { ok: true, id } | { ok: false, error }
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { corsHeaders } from "../_shared/cors.ts";

const NOTIFY_TO = "trish@weprintwraps.com";

const TIER_LABELS: Record<string, string> = {
  starter: "Starter",
  designpro_lite: "DesignPro Lite",
  designpro_studio: "DesignPro Studio",
  designpro_plus: "DesignPro Plus",
  not_sure: "Not sure — help me choose",
};

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "method not allowed" });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid json" });
  }

  const email = String(body?.email || "").trim().toLowerCase();
  const name = String(body?.name || "").trim().slice(0, 120);
  const message = String(body?.message || "").trim().slice(0, 4000);
  const topic = body?.topic === "tier_inquiry" ? "tier_inquiry" : "question";
  const tierInterest = TIER_LABELS[body?.tierInterest] ? String(body.tierInterest) : null;
  const pagePath = String(body?.pagePath || "").slice(0, 200);
  const userAgent = (req.headers.get("user-agent") || "").slice(0, 400);

  if (!isEmail(email)) return json(400, { ok: false, error: "A valid email is required." });
  if (!message && !tierInterest) {
    return json(400, { ok: false, error: "Please include a question or select a tier." });
  }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: inserted, error: insErr } = await sb
    .from("restylepro_contact_requests")
    .insert({
      name: name || null,
      email,
      message: message || null,
      topic,
      tier_interest: tierInterest,
      page_path: pagePath || null,
      user_agent: userAgent || null,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("[submit-restylepro-contact] insert failed:", insErr?.message);
    return json(500, { ok: false, error: insErr?.message || "Could not save your message." });
  }

  // Email the owner. Best-effort — a delivery failure must not fail the
  // submission the customer already completed.
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const tierLabel = tierInterest ? TIER_LABELS[tierInterest] : null;
      const subject =
        topic === "tier_inquiry"
          ? `New tier inquiry${tierLabel ? ` — ${tierLabel}` : ""} (${name || email})`
          : `New RestylePro question — ${name || email}`;

      const rows: Array<[string, string]> = [
        ["Name", name || "—"],
        ["Email", email],
        ["Topic", topic === "tier_inquiry" ? "Tier inquiry" : "Question"],
        ["Tier of interest", tierLabel || "—"],
        ["Message", message || "—"],
        ["Page", pagePath || "—"],
      ];
      const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="height:4px;border-radius:4px;background:linear-gradient(90deg,#3b82f6,#ec4899);margin-bottom:18px;"></div>
    <h2 style="margin:0 0 4px;font-size:20px;">${topic === "tier_inquiry" ? "New tier inquiry" : "New question"} from RestyleProAI</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 16px;">Reply to this email to respond to the customer directly.</p>
    <table style="border-collapse:collapse;font-size:14px;width:100%;">
      ${rows
        .map(
          ([k, v]) =>
            `<tr><td style="padding:6px 16px 6px 0;color:#64748b;vertical-align:top;white-space:nowrap;">${k}</td><td style="padding:6px 0;">${esc(v).replace(/\n/g, "<br>")}</td></tr>`,
        )
        .join("")}
    </table>
  </div>
</body></html>`;
      const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");

      const resend = new Resend(resendKey);
      const emailRes = await resend.emails.send({
        from: "RestylePro <noreply@restyleproai.com>",
        to: [NOTIFY_TO],
        reply_to: email,
        subject,
        html,
        text,
      });
      if (emailRes.error) console.error("[submit-restylepro-contact] Resend error:", emailRes.error);
    } else {
      console.warn("[submit-restylepro-contact] RESEND_API_KEY not set — saved without email notify");
    }
  } catch (e) {
    console.error("[submit-restylepro-contact] notify failed (non-fatal):", e);
  }

  return json(200, { ok: true, id: inserted.id });
});
