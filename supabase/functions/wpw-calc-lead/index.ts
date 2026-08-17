// ──────────────────────────────────────────────────────────────────────
// wpw-calc-lead
//
// PUBLIC endpoint (verify_jwt = false). Backs the "Email me this quote" button
// on the WPW Wrap Calculator embed (weprintwraps.com). CORS-open so the
// WordPress page can POST cross-origin.
//
// On submit we:
//   1. Save the lead + quote to public.wpw_calculator_leads (service role).
//   2. Email the customer their quote (from noreply@restyleproai.com).
//   3. Notify trish@weprintwraps.com of the new lead (reply-to the customer).
//
// Request:  POST { email, quote: { vehicle, area_sqft, roll_width, quantity,
//                  waste_pct, material, total_sqft, linear_ft, linear_yd,
//                  est_cost }, pagePath? }
// Response: { ok:true, id } | { ok:false, error }
// ──────────────────────────────────────────────────────────────────────

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NOTIFY_TO = "trish@weprintwraps.com";
// "WPW Quote Tool Leads (homepage calculator)". A list id is not a secret, and
// hardcoding it keeps the lead path from depending on another env var that can
// silently go missing — a lead that lands nowhere is worse than a wrong name.
const QUOTE_LIST_ID = "W8spra";
const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

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
  try { body = await req.json(); } catch { return json(400, { ok: false, error: "invalid json" }); }

  const email = String(body?.email || "").trim().toLowerCase();
  if (!isEmail(email)) return json(400, { ok: false, error: "A valid email is required." });

  const q = body?.quote || {};
  // File-check leads get upload instructions instead of an estimate email.
  // New embeds send intent:"filecheck"; older payloads are detected by the
  // marker the instant-quote page writes into quote.vehicle.
  const isFileCheck = body?.intent === "filecheck" ||
    /FILE.?CHECK/i.test(String(q.vehicle || ""));
  const lead = {
    email,
    vehicle: q.vehicle ? String(q.vehicle).slice(0, 120) : null,
    area_sqft: num(q.area_sqft),
    roll_width: num(q.roll_width),
    quantity: num(q.quantity),
    waste_pct: num(q.waste_pct),
    material: q.material ? String(q.material).slice(0, 160) : null,
    total_sqft: num(q.total_sqft),
    linear_ft: num(q.linear_ft),
    linear_yd: num(q.linear_yd),
    est_cost: num(q.est_cost),
    page_path: String(body?.pagePath || "").slice(0, 200) || null,
    user_agent: (req.headers.get("user-agent") || "").slice(0, 400) || null,
  };

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: inserted, error: insErr } = await sb
    .from("wpw_calculator_leads")
    .insert(lead)
    .select("id")
    .single();

  if (insErr || !inserted) {
    console.error("[wpw-calc-lead] insert failed:", insErr?.message);
    return json(500, { ok: false, error: "Could not save your quote." });
  }

  // AI Workforce event bus — best-effort. The Customer Success agent turns
  // this into a first-touch draft + follow-up card for Troy instead of the
  // lead dying as a single notification email. Dedupe: one event per lead row.
  try {
    await sb.from("workforce_events").insert({
      event_type: "lead.captured",
      dedupe_key: `calc_lead_${inserted.id}`,
      source: "wpw-calc-lead",
      payload: {
        lead_id: inserted.id,
        email,
        intent: isFileCheck ? "filecheck" : "quote",
        vehicle: lead.vehicle,
        material: lead.material,
        total_sqft: lead.total_sqft,
        est_cost: lead.est_cost,
        page_path: lead.page_path,
      },
    });
  } catch (e) {
    console.error("[wpw-calc-lead] event emit failed (non-fatal):", e);
  }

  // Klaviyo sync — best-effort, never fails the save.
  //
  // Before this, a homepage quote lead existed ONLY in Postgres and in a
  // Resend transactional send. Resend has no segmentation or flows, so these
  // leads could not be followed up, flowed, or retargeted — the person told us
  // the vehicle they want wrapped and then heard from us exactly once.
  //
  // We upsert the profile with the quote as profile properties (so a flow can
  // say "your Sprinter quote" rather than "your quote") and add it to the
  // quote-tool list.
  //
  // NOTE ON CONSENT: this deliberately does NOT set marketing consent to
  // SUBSCRIBED. Someone asking for a quote asked for a quote, not a
  // newsletter. Adding them to the list makes them reachable by flows and
  // segments without us inventing an opt-in they never gave. If the calculator
  // form grows an explicit marketing checkbox, that is when this should start
  // sending a subscription payload.
  try {
    const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
    if (klaviyoKey) {
      const kHeaders = {
        Authorization: `Klaviyo-API-Key ${klaviyoKey}`,
        "Content-Type": "application/json",
        accept: "application/json",
        revision: "2024-10-15",
      };

      const profileRes = await fetch("https://a.klaviyo.com/api/profile-import/", {
        method: "POST",
        headers: kHeaders,
        body: JSON.stringify({
          data: {
            type: "profile",
            attributes: {
              email,
              properties: {
                wpw_quote_intent: isFileCheck ? "filecheck" : "quote",
                wpw_quote_vehicle: lead.vehicle,
                wpw_quote_material: lead.material,
                wpw_quote_total_sqft: lead.total_sqft,
                wpw_quote_est_cost: lead.est_cost,
                wpw_quote_page: lead.page_path,
                wpw_quote_last_at: new Date().toISOString(),
                wpw_lead_source: "homepage_calculator",
              },
            },
          },
        }),
      });

      if (!profileRes.ok) {
        console.error("[wpw-calc-lead] klaviyo profile upsert failed:", profileRes.status,
          (await profileRes.text().catch(() => "")).slice(0, 300));
      } else {
        const profileId = (await profileRes.json())?.data?.id;
        if (profileId) {
          const listRes = await fetch(
            `https://a.klaviyo.com/api/lists/${QUOTE_LIST_ID}/relationships/profiles/`,
            {
              method: "POST",
              headers: kHeaders,
              body: JSON.stringify({ data: [{ type: "profile", id: profileId }] }),
            },
          );
          if (!listRes.ok) {
            console.error("[wpw-calc-lead] klaviyo list add failed:", listRes.status,
              (await listRes.text().catch(() => "")).slice(0, 300));
          }
        }
      }
    } else {
      console.warn("[wpw-calc-lead] KLAVIYO_API_KEY not set — lead saved without Klaviyo sync");
    }
  } catch (e) {
    console.error("[wpw-calc-lead] klaviyo sync failed (non-fatal):", e);
  }

  // Emails are best-effort — a delivery failure must not fail the save.
  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (resendKey) {
      const money = (n: number | null) =>
        n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const qty = (n: number | null, u: string) =>
        n == null ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: 1 }) + " " + u;

      const rows: Array<[string, string]> = [
        ["Vehicle / project", lead.vehicle || "—"],
        ["Material", lead.material || "—"],
        ["Total square feet", qty(lead.total_sqft, "sq ft")],
        ["Linear feet", qty(lead.linear_ft, "ft")],
        ["Linear yards", qty(lead.linear_yd, "yd")],
        ["Estimated material cost", money(lead.est_cost)],
      ];
      const table = rows
        .map(([k, v]) => `<tr><td style="padding:8px 16px 8px 0;color:#64748b;white-space:nowrap;">${k}</td><td style="padding:8px 0;font-weight:600;text-align:right;">${esc(v)}</td></tr>`)
        .join("");

      const customerHtml = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0d1220;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="height:5px;border-radius:5px;background:linear-gradient(90deg,#00C7FF,#7E5BEC 55%,#FF2DC8);margin-bottom:20px;"></div>
    <h2 style="margin:0 0 4px;font-size:22px;">Your WPW wrap estimate</h2>
    <p style="color:#64748b;font-size:14px;margin:0 0 18px;">Here's the quote you built with the WPW Wrap Calculator.</p>
    <table style="border-collapse:collapse;font-size:15px;width:100%;">${table}</table>
    <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;">Estimate only — actual material depends on vehicle, panel layout, roll width and install method.</p>
    <div style="margin-top:24px;padding:18px;border-radius:14px;background:#0b0d14;color:#fff;">
      <div style="font-weight:800;font-size:16px;">Need us to print it? Save 10% this week.</div>
      <div style="margin-top:6px;font-size:14px;color:#d7dbe4;">Use code <b style="color:#FF2DC8;">FADE10</b> on any fade wrap. Premium Avery Dennison or 3M film.</div>
      <a href="https://weprintwraps.com/shop" style="display:inline-block;margin-top:14px;padding:11px 22px;border-radius:10px;background:linear-gradient(90deg,#00C7FF,#FF2DC8);color:#fff;text-decoration:none;font-weight:700;font-size:14px;">Order your wrap →</a>
    </div>
  </div>
</body></html>`;

      const fileCheckHtml = `<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0d1220;">
  <div style="max-width:560px;margin:0 auto;padding:32px 24px;">
    <div style="height:5px;border-radius:5px;background:linear-gradient(90deg,#3b82f6,#ec4899);margin-bottom:20px;"></div>
    <h2 style="margin:0 0 4px;font-size:22px;">Send us your print file — free check</h2>
    <p style="font-size:15px;line-height:1.6;margin:0 0 14px;">Thanks for reaching out! Here's how to get your free print-ready check:</p>
    <ol style="font-size:15px;line-height:1.7;margin:0 0 16px;padding-left:20px;">
      <li><b>Reply to this email</b> with your file attached, or paste a Dropbox / Google Drive / WeTransfer link.</li>
      <li>Tell us the vehicle (year, make, model) or the print size you need.</li>
      <li>We'll check resolution, bleed, and paneling and reply with a straight answer — print-ready or what to fix.</li>
    </ol>
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">No charge, no obligation. If it's ready, we can print and ship it in 48 hours.</p>
    <p style="color:#94a3b8;font-size:12px;margin:18px 0 0;">We Print Wraps · genuine 3M &amp; Avery film · printed in the USA · 549-622-4678</p>
  </div>
</body></html>`;

      const resend = new Resend(resendKey);

      // 1) Customer email — upload instructions for file checks, estimate otherwise
      const r1 = await resend.emails.send({
        from: "WePrintWraps <noreply@restyleproai.com>",
        to: [email],
        reply_to: NOTIFY_TO,
        subject: isFileCheck ? "Your free print-file check — send us the file" : "Your WPW wrap estimate",
        html: isFileCheck ? fileCheckHtml : customerHtml,
      });
      if (r1.error) console.error("[wpw-calc-lead] customer email error:", r1.error);

      // 2) Lead notification to Trish
      const r2 = await resend.emails.send({
        from: "WPW Calculator <noreply@restyleproai.com>",
        to: [NOTIFY_TO],
        reply_to: email,
        subject: isFileCheck
          ? `🗂 FILE CHECK lead — ${email} (they're sending a file — watch for their reply)`
          : `New wrap-calculator lead — ${email}`,
        html: `<!doctype html><html><body style="font-family:-apple-system,sans-serif;color:#0d1220;">
  <h3>New WPW Wrap Calculator lead</h3>
  <p><b>Email:</b> ${esc(email)}</p>
  <table style="border-collapse:collapse;font-size:14px;">${table}</table>
  <p style="color:#94a3b8;font-size:12px;">Page: ${esc(lead.page_path || "—")}</p>
</body></html>`,
      });
      if (r2.error) console.error("[wpw-calc-lead] notify email error:", r2.error);
    } else {
      console.warn("[wpw-calc-lead] RESEND_API_KEY not set — lead saved without email");
    }
  } catch (e) {
    console.error("[wpw-calc-lead] email failed (non-fatal):", e);
  }

  return json(200, { ok: true, id: inserted.id });
});
