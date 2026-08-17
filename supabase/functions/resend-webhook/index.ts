/**
 * resend-webhook — Resend delivery event receiver.
 *
 * Receives webhook events from Resend (configured at
 * https://resend.com/webhooks) and updates the matching email_log
 * row keyed off resend_message_id (set by send-estimate-email when
 * the email is handed to Resend).
 *
 * Events handled:
 *   - email.sent              → no-op (we already record this on send)
 *   - email.delivered         → email_log.delivered_at
 *   - email.delivery_delayed  → metadata only
 *   - email.opened            → email_log.opened_at (first open wins)
 *   - email.clicked           → metadata only (we don't column-track clicks yet)
 *   - email.bounced           → email_log.bounced_at + status='bounced'
 *   - email.complained        → email_log.complained_at + status='complained'
 *
 * Security: Resend signs webhooks with Svix HMAC. The signing secret
 * lives in env var RESEND_WEBHOOK_SECRET (set in Supabase function
 * secrets). When the secret is missing we accept events but log a
 * warning — letting the user wire up Resend → Supabase before
 * configuring the secret without breaking the receive flow.
 *
 * verify_jwt = false (config.toml) — Resend doesn't send a Supabase
 * JWT; we authenticate the request via the Svix signature instead.
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { klaviyoTrack } from "../_shared/klaviyo-track.ts";

interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    bounce?: { type?: string; message?: string };
    [k: string]: unknown;
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Verify a Svix signature header.
 *
 * Header format (svix-signature): `v1,<base64-hmac> v1,<base64-hmac>`
 * Signed payload: `${svix_id}.${svix_timestamp}.${rawBody}`
 *
 * Returns true if any of the supplied signatures matches our HMAC of
 * the canonical payload using the shared secret. Returns false on
 * any failure (missing headers, decode error, no match).
 */
async function verifySvix(
  rawBody: string,
  svixId: string | null,
  svixTimestamp: string | null,
  svixSignature: string | null,
  secret: string,
): Promise<boolean> {
  if (!svixId || !svixTimestamp || !svixSignature) return false;
  // Svix secrets are prefixed `whsec_` followed by base64.
  const secretPart = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try {
    keyBytes = Uint8Array.from(atob(secretPart), (c) => c.charCodeAt(0));
  } catch {
    return false;
  }
  const signedPayload = `${svixId}.${svixTimestamp}.${rawBody}`;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBytes = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(signedPayload),
  );
  const expected = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));
  // Header may carry multiple space-separated `v1,<sig>` pairs.
  return svixSignature
    .split(" ")
    .map((s) => s.split(",")[1] ?? "")
    .some((sig) => sig === expected);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase env missing" });

  const rawBody = await req.text();

  // Verify Svix signature when a secret is configured.
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  if (secret) {
    const ok = await verifySvix(
      rawBody,
      req.headers.get("svix-id"),
      req.headers.get("svix-timestamp"),
      req.headers.get("svix-signature"),
      secret,
    );
    if (!ok) {
      console.warn("[resend-webhook] svix signature verification failed");
      return json(401, { error: "invalid signature" });
    }
  } else {
    console.warn(
      "[resend-webhook] RESEND_WEBHOOK_SECRET not set — accepting unsigned event",
    );
  }

  let event: ResendEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "invalid json" });
  }

  const messageId = event?.data?.email_id;
  const eventType = event?.type;
  if (!messageId || !eventType) {
    console.warn("[resend-webhook] event missing email_id or type", { eventType, messageId });
    return json(200, { ok: true, ignored: true });
  }

  const sb = createClient(supabaseUrl, serviceKey);
  const eventAt = event.created_at || new Date().toISOString();

  // Build the patch based on event type. Use null for "don't touch."
  const patch: Record<string, unknown> = {
    last_event_type: eventType,
    last_event_at: eventAt,
  };
  switch (eventType) {
    case "email.sent":
      // Already logged on send — nothing to update beyond last_event_*.
      break;
    case "email.delivered":
      patch.delivered_at = eventAt;
      patch.status = "delivered";
      break;
    case "email.opened":
      // First-open wins — only set if not already opened.
      patch.opened_at = eventAt;
      break;
    case "email.bounced":
      patch.bounced_at = eventAt;
      patch.status = "bounced";
      break;
    case "email.complained":
      patch.complained_at = eventAt;
      patch.status = "complained";
      break;
    case "email.clicked":
    case "email.delivery_delayed":
      // Tracked via last_event_* only.
      break;
    default:
      console.log("[resend-webhook] unknown event type:", eventType);
      break;
  }

  // Mirror EVERY Resend event into Klaviyo (the monitor layer) so all email
  // activity across every sender function shows up on the customer's Klaviyo
  // profile. Fires before the email_log lookup on purpose — even messages with
  // no matching log row still get monitored. Fire-and-forget; never blocks.
  let klaviyoMirrored = false;
  if (eventType !== "email.delivery_delayed") {
    const toRaw = event.data?.to;
    const recipient = Array.isArray(toRaw) ? toRaw[0] : toRaw;
    if (recipient) {
      const metricName = "Resend Email " +
        eventType.replace("email.", "").replace(/^./, (c) => c.toUpperCase());
      klaviyoMirrored = await klaviyoTrack({
        metric: metricName, // e.g. "Resend Email Delivered"
        email: String(recipient),
        properties: {
          subject: event.data?.subject || "",
          from: event.data?.from || "",
          resend_message_id: messageId,
          ...(event.data?.bounce?.type ? { bounce_type: event.data.bounce.type } : {}),
        },
        uniqueId: `${messageId}-${eventType}`,
      });
    }
  }

  // Look up the row to enforce first-open semantics and to log
  // matches/misses for debugging.
  const { data: existing, error: lookupErr } = await sb
    .from("email_log")
    .select("id, opened_at, status")
    .eq("resend_message_id", messageId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lookupErr) {
    console.error("[resend-webhook] lookup error:", lookupErr.message);
    return json(500, { error: "db lookup failed" });
  }
  if (!existing) {
    console.warn(
      "[resend-webhook] no email_log row for resend_message_id:",
      messageId,
      "event:",
      eventType,
    );
    // Still return 200 so Resend doesn't retry forever.
    return json(200, { ok: true, matched: false, klaviyoMirrored });
  }

  // First-open wins.
  if (eventType === "email.opened" && existing.opened_at) {
    delete patch.opened_at;
  }
  // Don't downgrade a bounced/complained status to delivered if a
  // delayed delivered event arrives after the bounce.
  if (
    patch.status === "delivered" &&
    (existing.status === "bounced" || existing.status === "complained")
  ) {
    delete patch.status;
  }

  const { error: updErr } = await sb
    .from("email_log")
    .update(patch)
    .eq("id", existing.id);

  if (updErr) {
    console.error("[resend-webhook] update error:", updErr.message);
    return json(500, { error: "db update failed" });
  }

  console.log("[resend-webhook] applied", eventType, "to email_log", existing.id);
  return json(200, { ok: true, matched: true, eventType, klaviyoMirrored });
});
