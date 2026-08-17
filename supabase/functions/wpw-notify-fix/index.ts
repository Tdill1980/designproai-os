/**
 * wpw-notify-fix
 *
 * One-off notification sender for the "Custom Wrap Design $1,475 → $500"
 * cart fix. Sends a short "it's fixed" email to Lance and Troy and CCs
 * Trish, via Resend.
 *
 * Browser-clickable (no curl needed):
 *   GET  /wpw-notify-fix?send=1     → actually sends the email
 *   GET  /wpw-notify-fix            → preview the email JSON, sends nothing
 *
 * Recipients default to the WPW team addresses but can be overridden:
 *   ?to=a@x.com,b@y.com&cc=c@z.com
 *
 * Env: RESEND_API_KEY
 */

import { Resend } from "https://esm.sh/resend@2.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const FROM = "RestylePro <noreply@restyleproai.com>";
const DEFAULT_TO = ["lance@weprintwraps.com", "troy@weprintwraps.com"];
const DEFAULT_CC = ["trish@weprintwraps.com"];
const SUBJECT = "Fixed — Custom Wrap Design now $500 in cart";

const HTML = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.6;max-width:560px">
  <p>Hey Lance, Troy,</p>
  <p>
    Quick heads-up: the <strong>Custom Vehicle Wrap Design</strong> product on
    weprintwraps.com was incorrectly charging <strong>$1,475</strong> in the cart.
    The base price had been lowered to $500, but a leftover $975 design fee was
    still attached as a hidden product option, so the two were stacking.
  </p>
  <p>
    That's now <strong>fixed — the cart shows $500.</strong> No further action
    needed on your end. Flag me if you spot it reading anything other than $500.
  </p>
  <p>Thanks,<br/>Trish</p>
</div>
`.trim();

const TEXT = `Hey Lance, Troy,

Quick heads-up: the Custom Vehicle Wrap Design product on weprintwraps.com was incorrectly charging $1,475 in the cart. The base price had been lowered to $500, but a leftover $975 design fee was still attached as a hidden product option, so the two were stacking.

That's now fixed — the cart shows $500. No further action needed on your end. Flag me if you spot it reading anything other than $500.

Thanks,
Trish`;

function parseList(v: string | null, fallback: string[]): string[] {
  if (!v) return fallback;
  return v.split(",").map((s) => s.trim()).filter(Boolean);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const apiKey = Deno.env.get("RESEND_API_KEY");
    if (!apiKey) return jsonResponse({ error: "RESEND_API_KEY not configured" }, 500);

    const url = new URL(req.url);
    const to = parseList(url.searchParams.get("to"), DEFAULT_TO);
    const cc = parseList(url.searchParams.get("cc"), DEFAULT_CC);
    const send = url.searchParams.get("send") === "1" || req.method === "POST";

    const envelope = { from: FROM, to, cc, subject: SUBJECT };

    if (!send) {
      return jsonResponse({
        ok: true,
        sent: false,
        note: "PREVIEW only — add ?send=1 to actually send.",
        envelope,
        text_preview: TEXT,
      });
    }

    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.send({
      ...envelope,
      html: HTML,
      text: TEXT,
    });

    if (error) {
      return jsonResponse({ ok: false, sent: false, error, envelope }, 502);
    }

    return jsonResponse({ ok: true, sent: true, id: data?.id, envelope });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
