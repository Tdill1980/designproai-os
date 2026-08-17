/**
 * social-unsubscribe — the opt-out every flow email links to.
 *
 * Owning the nurture flows means owning the unsubscribe. This is a PUBLIC
 * GET (the link in an email must work in one click, no login, no JS) that:
 *   1. suppresses the address (mightymail_suppressions — the same list the
 *      sequence worker checks before every send),
 *   2. stops every active sequence enrollment for that address,
 *   3. records the opt-out in the consent ledger, so the audit trail shows
 *      both the opt-IN and the opt-OUT.
 *
 * Returns a small HTML confirmation. One click, honored immediately —
 * CAN-SPAM requires it and it is the right thing regardless.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient } from "../_shared/external-db.ts";

function page(title: string, message: string, status = 200) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1.5rem;color:#111827">
  <div style="height:4px;border-radius:9999px;background:linear-gradient(90deg,#3b82f6,#ec4899);margin-bottom:2rem"></div>
  <h1 style="font-size:1.5rem;margin:0 0 .75rem">${title}</h1>
  <p style="color:#4b5563;line-height:1.6;margin:0">${message}</p>
</div>`,
    { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
  );
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const email = (url.searchParams.get("e") || "").trim().toLowerCase();
    const brand = (url.searchParams.get("b") || "weprintwraps").toLowerCase();
    if (!email || !email.includes("@")) {
      return page("Link not recognized", "That unsubscribe link is missing an address. Reply to any of our emails and we'll remove you by hand.", 400);
    }

    const db = createExternalClient();
    const now = new Date().toISOString();

    // 1) Suppress — the list the sequence worker checks before every send.
    // Global suppression (shop_id NULL) is what the worker reads; the table's
    // unique index is partial on (email_address) WHERE shop_id IS NULL, so a
    // plain insert + duplicate tolerance is the correct shape here.
    const { error: supErr } = await db.from("mightymail_suppressions").insert({
      email_address: email,
      suppression_type: "unsubscribe",
      reason: "One-click unsubscribe from a SocialIQ flow email",
      source: "social_unsubscribe",
      suppressed_at: now,
    });
    // 23505 = already suppressed, which is success from the reader's view.
    if (supErr && supErr.code !== "23505") {
      throw new Error(`suppression write failed: ${supErr.message}`);
    }

    // 2) Stop every active flow for this address.
    await db.from("social_sequence_enrollments")
      .update({ status: "stopped", last_error: "unsubscribed", updated_at: now })
      .eq("email", email).eq("status", "active");

    // 3) Ledger the opt-out next to the opt-in.
    await db.from("marketing_consent_events").insert({
      email,
      brand,
      channel: "email",
      consent_text: "UNSUBSCRIBED via one-click link in a flow email",
      source: "social_unsubscribe:/social/unsubscribe",
      source_detail: { revoked: true },
    });

    return page("You're unsubscribed", "You won't get any more marketing emails from us. If this was a mistake, just reply to an old email and we'll switch it back on.");
  } catch (e) {
    console.error("social-unsubscribe error:", e);
    return page("Something went wrong", "We couldn't process that just now. Reply to any of our emails and a human will remove you.", 500);
  }
});
