/**
 * wpw-founder-campaign
 *
 * Pulls a contact list from Klaviyo (by list ID OR segment ID) and sends
 * the WPW Founder Invitation email through Resend. Two actions:
 *
 *   { action: "preview", source: "list"|"segment", id: string }
 *     -> { count, sample: [{ email, first_name }] }
 *
 *   { action: "send",    source: "list"|"segment", id: string,
 *     subject?: string, fromName?: string, fromEmail?: string,
 *     dryRun?: boolean }
 *     -> { sent, failed, errors: [...] }
 *
 * Env required:
 *   KLAVIYO_API_KEY   (Klaviyo private API key)
 *   RESEND_API_KEY    (Resend API key)
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (for auth + admin role check)
 *
 * Auth: caller must be admin or tester. Bearer token in Authorization
 * header is verified server-side; this prevents anyone from blasting
 * the founder email by hitting the function directly.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const KLAVIYO_BASE = "https://a.klaviyo.com/api";
const KLAVIYO_REVISION = "2024-10-15";

interface KlaviyoProfile {
  email: string;
  first_name: string;
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface AudienceOption {
  id: string;
  name: string;
  source: "list" | "segment" | "wpw";
}

// Built-in local segments backed by the wpw_outreach_segments table
// (built from WePrintWraps order history). Surfaced alongside Klaviyo
// audiences in the same picker.
const WPW_LOCAL_SEGMENTS: Array<{ id: string; name: string }> = [
  { id: "whale", name: "WPW · Whales (top spenders, most likely to buy)" },
  { id: "repeat", name: "WPW · Repeat customers" },
  { id: "recent", name: "WPW · Recent customers" },
  { id: "all", name: "WPW · All segmented customers" },
];

async function fetchWpwLocalSegment(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<KlaviyoProfile[]> {
  const builder = supabase
    .from("wpw_outreach_segments")
    .select("email, name");
  const query = id === "all" ? builder : builder.eq("segment", id);
  const { data, error } = await query;
  if (error) throw new Error(`wpw_outreach_segments fetch failed: ${error.message}`);

  const profiles: KlaviyoProfile[] = [];
  for (const row of data ?? []) {
    if (!row?.email) continue;
    const fullName = (row.name as string | null)?.trim() ?? "";
    const firstName = fullName ? fullName.split(/\s+/)[0] : "";
    profiles.push({ email: row.email, first_name: firstName });
  }
  return profiles;
}

async function fetchKlaviyoAudiences(apiKey: string): Promise<AudienceOption[]> {
  const audiences: AudienceOption[] = [];
  for (const source of ["list", "segment"] as const) {
    let url: string | null =
      `${KLAVIYO_BASE}/${source}s/?page[size]=100&fields[${source}]=name`;
    while (url) {
      const res = await fetch(url, {
        headers: {
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          accept: "application/json",
          revision: KLAVIYO_REVISION,
        },
      });
      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Klaviyo ${source}s fetch failed (${res.status}): ${body.slice(0, 300)}`,
        );
      }
      const json = (await res.json()) as {
        data?: Array<{ id?: string; attributes?: { name?: string } }>;
        links?: { next?: string | null };
      };
      for (const row of json.data ?? []) {
        if (row?.id) {
          audiences.push({
            id: row.id,
            name: row.attributes?.name ?? row.id,
            source,
          });
        }
      }
      url = json.links?.next ?? null;
    }
  }
  // Lists first, then segments; alphabetical inside each.
  audiences.sort((a, b) => {
    if (a.source !== b.source) return a.source === "list" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return audiences;
}

async function fetchKlaviyoProfiles(
  apiKey: string,
  source: "list" | "segment",
  id: string,
): Promise<KlaviyoProfile[]> {
  // Klaviyo paginates with cursor links; we walk until exhausted.
  const profiles: KlaviyoProfile[] = [];
  // 100 per page is the max; profiles include attributes we care about.
  let url: string | null = `${KLAVIYO_BASE}/${source}s/${id}/profiles/?page[size]=100`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        accept: "application/json",
        revision: KLAVIYO_REVISION,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `Klaviyo ${source} fetch failed (${res.status}): ${body.slice(0, 300)}`,
      );
    }

    const json = (await res.json()) as {
      data?: Array<{
        attributes?: { email?: string; first_name?: string | null };
      }>;
      links?: { next?: string | null };
    };

    for (const row of json.data ?? []) {
      const email = row?.attributes?.email;
      if (!email) continue;
      profiles.push({
        email,
        first_name: row?.attributes?.first_name ?? "",
      });
    }

    url = json.links?.next ?? null;
  }

  return profiles;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderFounderEmail(firstName: string): { html: string; text: string } {
  const greetingName = firstName?.trim() ? escapeHtml(firstName.trim()) : "there";
  const offerUrl =
    "https://restyleproai.com/from/weprintwraps?utm_source=resend&utm_medium=email&utm_campaign=wpw-founder";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>You're Invited — RestyleProAI</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 8px 24px 8px;text-align:center;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(17,17,17,.5);margin-bottom:16px;">
            A note from the founder
          </div>
          <h1 style="font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:34px;line-height:1.1;font-weight:700;margin:0 0 16px 0;color:#111;">
            You're Invited to the
            <span style="background:linear-gradient(90deg,#2563eb,#c026d3);-webkit-background-clip:text;background-clip:text;color:transparent;">Future of Vehicle Wrap Design</span>
          </h1>
        </td></tr>

        <tr><td style="padding:0 8px;font-size:16px;line-height:1.6;color:rgba(17,17,17,.8);">
          <p style="margin:0 0 16px 0;">Hey ${greetingName},</p>
          <p style="margin:0 0 16px 0;">Over the years, one thing became very clear to me — the wrap industry still struggles with the same problems:</p>
          <ul style="margin:0 0 20px 18px;padding:0;">
            <li>Design delays</li>
            <li>Customers unable to visualize</li>
            <li>Endless revisions</li>
            <li>Shops needing stronger sales tools</li>
            <li>Not enough designers</li>
            <li>Not enough available wrap designs</li>
            <li>Disconnected systems</li>
          </ul>
          <p style="margin:0 0 24px 0;">So for the last year, I've been building something to help fundamentally change that.</p>
        </td></tr>

        <tr><td style="padding:24px 8px;background:#fafafa;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;text-align:center;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(17,17,17,.5);margin-bottom:8px;">Introducing</div>
          <div style="font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:34px;font-weight:700;background:linear-gradient(90deg,#2563eb,#c026d3);-webkit-background-clip:text;background-clip:text;color:transparent;">RestyleProAI&trade;</div>
          <p style="margin:16px 0 0 0;font-size:15px;line-height:1.6;color:rgba(17,17,17,.75);">A revenue-generating design and visualization system built specifically for wrap shops, sign companies, and restyle businesses.</p>
        </td></tr>

        <tr><td style="padding:24px 8px;font-size:15px;line-height:1.6;color:rgba(17,17,17,.85);">
          <p style="margin:0 0 12px 0;font-weight:700;color:#111;">Your ShopEngine&trade; Dashboard includes:</p>
          <ul style="margin:0 0 20px 18px;padding:0;">
            <li>DesignProAI&trade; — Full custom wrap design tools</li>
            <li>WallPro&trade; — Wall wrap &amp; environmental graphic tools</li>
            <li>GraphicsPro&trade; — Cut contour graphics for vehicles, windows, walls &amp; flat surfaces</li>
            <li>MyVehiclePro&trade; — Show designs on customer vehicle photos</li>
            <li>ColorPro&trade; — Visualize real manufacturer wrap films</li>
            <li>QuickQuote&trade; — Design and quote at the same time</li>
            <li>RevisionStudioIQ&trade; — Manage revisions &amp; proofs</li>
            <li>ProductionFlow&trade; — From proof to print workflow</li>
          </ul>
        </td></tr>

        <tr><td style="padding:24px 8px;text-align:center;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(17,17,17,.5);margin-bottom:8px;">Exclusive Invitation</div>
          <h2 style="font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:24px;line-height:1.2;font-weight:700;margin:0 0 12px 0;color:#111;">
            As part of this invitation, receive
            <span style="background:linear-gradient(90deg,#2563eb,#c026d3);-webkit-background-clip:text;background-clip:text;color:transparent;">$50 OFF</span>
            your membership.
          </h2>
          <p style="margin:0 0 8px 0;font-size:14px;color:rgba(17,17,17,.65);">
            DesignPro&trade; memberships start at <strong style="color:#111;">$399/mo</strong>.
          </p>
          <p style="margin:0 0 24px 0;font-size:13px;color:rgba(17,17,17,.55);">
            Need finalized production-ready output? ProductionPacks&trade; are <strong style="color:#111;">$299</strong> and finalized by a real human design team.
          </p>
          <a href="${offerUrl}" style="display:inline-block;background:linear-gradient(90deg,#2563eb,#c026d3);color:#fff;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:10px;font-size:15px;">
            Claim Your Dashboard &rarr;
          </a>
        </td></tr>

        <tr><td style="padding:32px 8px 8px 8px;text-align:center;font-size:14px;color:rgba(17,17,17,.7);">
          <p style="margin:0 0 6px 0;">This is just <strong>the beginning</strong>.</p>
          <p style="margin:0;font-weight:700;color:#111;">Trish Dill</p>
          <p style="margin:0;font-size:13px;color:rgba(17,17,17,.55);">Founder, WePrintWraps&trade; &amp; RestyleProAI&trade;</p>
        </td></tr>

        <tr><td style="padding:24px 8px 0 8px;text-align:center;font-size:11px;color:rgba(17,17,17,.4);">
          You're receiving this because you've ordered with WePrintWraps. <br/>
          <a href="${offerUrl}" style="color:rgba(17,17,17,.55);">View this invitation in your browser</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hey ${firstName?.trim() || "there"},

Over the years, one thing became very clear to me — the wrap industry still struggles with the same problems:

• Design delays
• Customers unable to visualize
• Endless revisions
• Shops needing stronger sales tools
• Not enough designers
• Not enough available wrap designs
• Disconnected systems

So for the last year, I've been building something to help fundamentally change that.

Introducing RestyleProAI™ — a revenue-generating design and visualization system built specifically for wrap shops, sign companies, and restyle businesses.

Your ShopEngine™ Dashboard includes:
- DesignProAI™ — Full custom wrap design tools
- WallPro™ — Wall wrap & environmental graphic tools
- GraphicsPro™ — Cut contour graphics for vehicles, windows, walls & flat surfaces
- MyVehiclePro™ — Show designs on customer vehicle photos
- ColorPro™ — Visualize real manufacturer wrap films
- QuickQuote™ — Design and quote at the same time
- RevisionStudioIQ™ — Manage revisions & proofs
- ProductionFlow™ — From proof to print workflow

Exclusive Invitation — As part of this invitation, receive $50 OFF your membership.

DesignPro™ memberships start at $399/mo.
Need finalized production-ready output? ProductionPacks™ are $299 and finalized by a real human design team.

Claim your dashboard: ${offerUrl}

This is just the beginning.

— Trish Dill
Founder, WePrintWraps™ & RestyleProAI™
`;

  return { html, text };
}

function renderConnectPortalEmail(firstName: string): { html: string; text: string } {
  const greetingName = firstName?.trim() ? escapeHtml(firstName.trim()) : "there";
  const offerUrl =
    "https://restyleproai.com/wpw-connect?utm_source=resend&utm_medium=email&utm_campaign=wpw-connect-portal";

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Your free WePrintWraps dashboard is waiting</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fff;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr><td style="padding:0 8px 20px 8px;text-align:center;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:rgba(17,17,17,.5);margin-bottom:14px;">
            For active WePrintWraps customers
          </div>
          <h1 style="font-family:Montserrat,Helvetica,Arial,sans-serif;font-size:32px;line-height:1.15;font-weight:700;margin:0 0 12px 0;color:#111;">
            Your free <span style="background:linear-gradient(90deg,#2563eb,#c026d3);-webkit-background-clip:text;background-clip:text;color:transparent;">RestyleProAI dashboard</span> is waiting
          </h1>
        </td></tr>

        <tr><td style="padding:0 8px 6px 8px;font-size:16px;line-height:1.65;color:rgba(17,17,17,.85);">
          <p style="margin:0 0 14px 0;">Hey ${greetingName},</p>
          <p style="margin:0 0 14px 0;">You've been ordering wraps from us for years. Your RestyleProAI dashboard is <strong>already built and waiting</strong> &mdash; free for every active WPW customer.</p>
          <p style="margin:0 0 22px 0;">Sign in with the email you use for WPW orders and you're <strong>auto-linked</strong>. No code, no card, nothing to enter.</p>
        </td></tr>

        <tr><td style="padding:0 8px 28px 8px;text-align:center;">
          <a href="${offerUrl}" style="display:inline-block;background:linear-gradient(90deg,#2563eb,#c026d3);color:#fff;font-weight:700;text-decoration:none;padding:16px 36px;border-radius:12px;font-size:17px;">
            Claim my dashboard &rarr;
          </a>
          <div style="margin-top:10px;font-size:12px;color:rgba(17,17,17,.55);">restyleproai.com/wpw-connect</div>
        </td></tr>

        <tr><td style="padding:8px 8px 0 8px;font-size:15px;line-height:1.7;color:rgba(17,17,17,.85);">
          <p style="margin:0 0 10px 0;font-weight:700;color:#111;">What's inside:</p>
          <ul style="margin:0 0 8px 18px;padding:0;">
            <li>Every WPW order you've placed &mdash; <strong>one-click reorder</strong></li>
            <li><strong>QuickQuote</strong> &mdash; instant wrap pricing, no token cost</li>
            <li>Your own <strong>branded customer quote tool</strong></li>
            <li><strong>3 free render tokens</strong> ($75 value) to test the rest of the platform</li>
            <li><strong>$50/mo off</strong> any paid tier, auto-applied</li>
          </ul>
        </td></tr>

        <tr><td style="padding:28px 8px 8px 8px;text-align:center;font-size:14px;color:rgba(17,17,17,.7);">
          <p style="margin:0;font-weight:700;color:#111;">Trish Dill</p>
          <p style="margin:0;font-size:13px;color:rgba(17,17,17,.55);">Founder, WePrintWraps&trade; &amp; RestyleProAI&trade;</p>
        </td></tr>

        <tr><td style="padding:24px 8px 0 8px;text-align:center;font-size:11px;color:rgba(17,17,17,.4);">
          You're receiving this because you've ordered with WePrintWraps.<br/>
          <a href="${offerUrl}" style="color:rgba(17,17,17,.55);">View this invitation in your browser</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hey ${firstName?.trim() || "there"},

You've been ordering wraps from us for years. Your RestyleProAI dashboard is already built and waiting — free for every active WPW customer.

Sign in with the email you use for WPW orders and you're auto-linked. No code, no card, nothing to enter.

What's inside:
• Every WPW order you've placed — one-click reorder
• QuickQuote — instant wrap pricing, no token cost
• Your own branded customer quote tool
• 3 free render tokens ($75 value) to test the rest of the platform
• $50/mo off any paid tier, auto-applied

Claim my dashboard: ${offerUrl}

— Trish Dill
Founder, WePrintWraps™ & RestyleProAI™
`;

  return { html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const klaviyoKey = Deno.env.get("KLAVIYO_API_KEY");
    const resendKey = Deno.env.get("RESEND_API_KEY");

    if (!resendKey) {
      return jsonResponse(
        { error: "RESEND_API_KEY is not set in edge function secrets." },
        500,
      );
    }

    const requireKlaviyo = () => {
      if (!klaviyoKey) {
        return jsonResponse(
          {
            error:
              "KLAVIYO_API_KEY is not set. Add it under Supabase project settings → Edge Functions → Secrets.",
          },
          500,
        );
      }
      return null;
    };

    const supabase = createClient(supabaseUrl, serviceKey);

    const body = await req.json() as {
      action?: "list_audiences" | "preview" | "send";
      source?: "list" | "segment" | "wpw";
      id?: string;
      subject?: string;
      fromName?: string;
      fromEmail?: string;
      dryRun?: boolean;
      template?: "founder" | "connect-portal";
      testEmail?: string;
    };

    const WPW_TEAM_EMAILS = [
      "tdill@restyleproai.com",
      "trish@restyleproai.com",
      "trish@weprintwraps.com",
      "lance@weprintwraps.com",
      "brice@weprintwraps.com",
      "jackson@weprintwraps.com",
      "troy@weprintwraps.com",
      "amanda@restyleproai.com",
      "amandakinz1111@gmail.com",
    ];

    // ── Test-only bypass: allow unauthenticated single-email sends to
    // members of the internal WPW team. Locked to that allowlist so this
    // can never be abused to mass-mail customers. Used by automated tools
    // (and Claude in MCP sessions) to preview rendered emails in real
    // Gmail before pulling the trigger on the full audience.
    const testEmailNormalized = body.testEmail?.trim().toLowerCase();
    const isInternalTest = !!testEmailNormalized &&
      WPW_TEAM_EMAILS.includes(testEmailNormalized) &&
      body.action === "send";

    if (!isInternalTest) {
      // ── Auth: admin or tester only ──
      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return jsonResponse({ error: "Missing authorization" }, 401);

      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(
        token,
      );
      if (authError || !user) {
        return jsonResponse(
          { error: "Unauthorized", detail: authError?.message },
          401,
        );
      }

      // Auth: admin/tester role OR a member of the WPW internal team
      // (Trish, Lance, Brice, Jackson, Troy, Amanda, tdill). Jackson uses
      // this page to send the founder invitation to his customer segments.
      const isWpwTeamMember = !!user.email &&
        WPW_TEAM_EMAILS.includes(user.email.toLowerCase());

      let hasRole = false;
      if (!isWpwTeamMember) {
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user.id)
          .in("role", ["admin", "tester"]);
        hasRole = !!roleData && roleData.length > 0;
      }
      if (!isWpwTeamMember && !hasRole) {
        return jsonResponse(
          { error: "Admin role or WPW team membership required" },
          403,
        );
      }
    }

    const template = body.template === "connect-portal" ? "connect-portal" : "founder";
    const renderEmail = template === "connect-portal"
      ? renderConnectPortalEmail
      : renderFounderEmail;
    const defaultSubject = template === "connect-portal"
      ? "Your free WePrintWraps dashboard is waiting"
      : "You're invited — your RestyleProAI Founder Dashboard";

    const action = body.action ?? "preview";

    // ── list_audiences: enumerate Klaviyo lists/segments + WPW local segments ──
    if (action === "list_audiences") {
      const klaviyoErr = requireKlaviyo();
      if (klaviyoErr) return klaviyoErr;
      const local: AudienceOption[] = [];
      try {
        for (const seg of WPW_LOCAL_SEGMENTS) {
          const builder = supabase
            .from("wpw_outreach_segments")
            .select("email", { count: "exact", head: true });
          const { count } = seg.id === "all"
            ? await builder
            : await builder.eq("segment", seg.id);
          const c = count ?? 0;
          local.push({
            id: seg.id,
            name: `${seg.name} · ${c}`,
            source: "wpw",
          });
        }
      } catch (_e) {
        // If the table is missing, just skip the local segments silently.
      }

      let klaviyo: AudienceOption[] = [];
      try {
        klaviyo = await fetchKlaviyoAudiences(klaviyoKey);
      } catch (err: any) {
        // Klaviyo error: still return local segments so the page is useful.
        return jsonResponse({
          audiences: local,
          klaviyoError: err?.message || "Klaviyo audience fetch failed",
        });
      }

      return jsonResponse({ audiences: [...local, ...klaviyo] });
    }

    let profiles: KlaviyoProfile[];
    if (testEmailNormalized) {
      profiles = [{ email: testEmailNormalized, first_name: "" }];
    } else {
      const source = body.source ?? "list";
      const id = body.id?.trim();
      if (!id) {
        return jsonResponse({ error: "Missing audience id" }, 400);
      }
      if (source !== "list" && source !== "segment" && source !== "wpw") {
        return jsonResponse(
          { error: "source must be 'list', 'segment', or 'wpw'" },
          400,
        );
      }
      if (source !== "wpw") {
        const klaviyoErr = requireKlaviyo();
        if (klaviyoErr) return klaviyoErr;
      }
      try {
        profiles = source === "wpw"
          ? await fetchWpwLocalSegment(supabase, id)
          : await fetchKlaviyoProfiles(klaviyoKey!, source, id);
      } catch (err: any) {
        return jsonResponse(
          { error: err?.message || "Audience fetch failed" },
          502,
        );
      }
    }

    if (action === "preview") {
      return jsonResponse({
        count: profiles.length,
        sample: profiles.slice(0, 5),
      });
    }

    // ── Send via Resend ──
    const resend = new Resend(resendKey);
    const subject = body.subject || defaultSubject;
    const fromName = body.fromName || "Trish Dill — WePrintWraps";
    const fromEmail = body.fromEmail || "trish@weprintwraps.com";
    const fromHeader = `${fromName} <${fromEmail}>`;
    const dryRun = !!body.dryRun;

    if (dryRun) {
      return jsonResponse({
        dryRun: true,
        count: profiles.length,
        sample: profiles.slice(0, 5),
        from: fromHeader,
        subject,
      });
    }

    let sent = 0;
    let failed = 0;
    const errors: Array<{ email: string; error: string }> = [];

    // Resend free tier rate-limits to ~10 req/sec; we throttle to 8/sec.
    for (let i = 0; i < profiles.length; i++) {
      const p = profiles[i];
      try {
        const { html, text } = renderEmail(p.first_name);
        await resend.emails.send({
          from: fromHeader,
          to: p.email,
          subject,
          html,
          text,
        });
        sent++;
      } catch (err: any) {
        failed++;
        errors.push({
          email: p.email,
          error: err?.message?.slice(0, 200) || "send failed",
        });
      }
      if ((i + 1) % 8 === 0) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    return jsonResponse({ sent, failed, errors: errors.slice(0, 25) });
  } catch (err: any) {
    return jsonResponse(
      { error: err?.message || "Internal error" },
      500,
    );
  }
});
