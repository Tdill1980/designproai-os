/**
 * social-sequence-run — the OWNED flow engine worker (docs/SOCIALIQ_SPEC.md).
 *
 * Klaviyo's social CRM sells cross-channel flows (welcome / browse /
 * abandoned cart) coordinating email and text off one profile. This is that,
 * in-house: it walks due enrollments, sends the next step through the
 * senders already in the stack (Resend for email, Twilio for SMS), logs the
 * send, and schedules the following step.
 *
 * Modes (POST JSON):
 *   { }                        — process everything due (cron default)
 *   { "enrollment_id": "..." } — run one enrollment now
 *   { "dry_run": true }        — report what WOULD send, send nothing
 *
 * Safety, because this sends to real people:
 *   - Service-role caller only. This is an outbound sender, like content-deploy.
 *   - DOUBLE-SEND GUARD: social_sequence_sends has a unique index on
 *     (enrollment_id, step_order) and the row is claimed BEFORE the send, so
 *     a concurrent/retried run cannot send the same step twice.
 *   - SUPPRESSION is re-checked immediately before every send, not just at
 *     enrollment — someone who unsubscribed between step 1 and step 2 must
 *     never receive step 2.
 *   - A send failure marks that enrollment and moves on; one bad address
 *     never stalls the queue.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "../_shared/cors.ts";
import { createExternalClient, getExternalServiceRoleKey } from "../_shared/external-db.ts";

const BATCH_LIMIT = 50;
const FROM_EMAIL = Deno.env.get("SOCIAL_FLOW_FROM") || "WePrintWraps <hello@weprintwraps.com>";
const QUOTE_URL = Deno.env.get("SOCIAL_FLOW_QUOTE_URL") || "https://www.weprintwraps.com";
// The unsubscribe link points at the social-unsubscribe FUNCTION (public GET),
// not a frontend route — one click, no app load, works from any mail client.
const UNSUB_BASE = `${Deno.env.get("SUPABASE_URL")}/functions/v1/social-unsubscribe`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface Enrollment {
  id: string;
  sequence_id: string;
  email: string;
  phone: string | null;
  brand: string;
  source_post_id: string | null;
  next_step: number;
  status: string;
}

interface Step {
  step_order: number;
  delay_hours: number;
  channel: string;
  subject: string | null;
  body: string;
}

/** Merge tags. Unknown tags are stripped, never left raw in a customer's inbox. */
function render(template: string, e: Enrollment): string {
  const first = (e.email.split("@")[0] || "").replace(/[^a-zA-Z]/g, "");
  const name = first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
  const unsub = `${UNSUB_BASE}?e=${encodeURIComponent(e.email)}&b=${encodeURIComponent(e.brand)}`;
  const map: Record<string, string> = {
    first_name: name,
    // "Hey{{first_name_comma}}" → "Hey Dana," or a clean "Hey," with no name.
    first_name_comma: name ? ` ${name},` : ",",
    quote_url: QUOTE_URL,
    unsubscribe_url: `Unsubscribe: ${unsub}`,
    unsubscribe_link: unsub,
    brand: e.brand,
    source_post_id: e.source_post_id || "",
  };
  return template
    .replace(/\{\{(\w+)\}\}/g, (_m, k: string) => map[k] ?? "")
    .trim();
}

/**
 * Is this contact still allowed to be messaged? Checked before EVERY send.
 * Any suppression signal wins; an error here fails CLOSED (skip the send) —
 * we would rather delay a marketing email than message someone who opted out.
 */
// deno-lint-ignore no-explicit-any
async function isSuppressed(db: any, email: string): Promise<boolean> {
  try {
    // Column is email_address (not email); any suppression row for the
    // address counts, whatever its type (bounce, complaint, unsubscribe).
    const { data, error } = await db
      .from("mightymail_suppressions")
      .select("id")
      .eq("email_address", email.toLowerCase())
      .limit(1);
    if (error) return true; // fail closed
    return Boolean(data?.length);
  } catch {
    return true; // fail closed
  }
}

async function sendEmail(to: string, subject: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [to],
      subject,
      text,
      html: text.split("\n\n").map((p) => `<p>${p.replace(/\n/g, "<br/>")}</p>`).join("\n"),
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body?.message as string) || `Resend ${res.status}` };
  return { ok: true, id: body?.id };
}

async function sendSms(to: string, text: string): Promise<{ ok: boolean; id?: string; error?: string }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_PHONE_NUMBER");
  if (!sid || !token || !from) return { ok: false, error: "Twilio secrets not set" };
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Body: text }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: (body?.message as string) || `Twilio ${res.status}` };
  return { ok: true, id: body?.sid };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Outbound sender — service-role only, same rule as content-deploy.
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!bearer || bearer !== getExternalServiceRoleKey()) {
    return json({ error: "social-sequence-run requires the service role key" }, 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const db = createExternalClient();
    const nowIso = new Date().toISOString();

    let q = db
      .from("social_sequence_enrollments")
      .select("id, sequence_id, email, phone, brand, source_post_id, next_step, status")
      .eq("status", "active");
    q = body.enrollment_id
      ? q.eq("id", body.enrollment_id)
      : q.lte("next_run_at", nowIso).order("next_run_at", { ascending: true }).limit(BATCH_LIMIT);

    const { data: due, error } = await q;
    if (error) throw new Error(`enrollment lookup failed: ${error.message}`);
    if (!due?.length) return json({ ok: true, processed: 0, message: "nothing due" });

    const results: Array<Record<string, unknown>> = [];

    for (const e of due as Enrollment[]) {
      try {
        const { data: step } = await db
          .from("social_sequence_steps")
          .select("step_order, delay_hours, channel, subject, body")
          .eq("sequence_id", e.sequence_id)
          .eq("step_order", e.next_step)
          .eq("active", true)
          .maybeSingle();

        // No step at this position = the flow is finished for them.
        if (!step) {
          await db.from("social_sequence_enrollments")
            .update({ status: "completed", updated_at: nowIso }).eq("id", e.id);
          results.push({ enrollment: e.id, done: true });
          continue;
        }
        const s = step as Step;
        const text = render(s.body, e);
        const destination = s.channel === "sms" ? (e.phone || "") : e.email;

        if (s.channel === "sms" && !destination) {
          // No phone on file — skip this step rather than stall the flow.
          await db.from("social_sequence_enrollments").update({
            next_step: e.next_step + 1, next_run_at: nowIso, updated_at: nowIso,
          }).eq("id", e.id);
          results.push({ enrollment: e.id, step: s.step_order, skipped: "no phone" });
          continue;
        }

        if (await isSuppressed(db, e.email)) {
          await db.from("social_sequence_enrollments")
            .update({ status: "stopped", last_error: "suppressed", updated_at: nowIso }).eq("id", e.id);
          results.push({ enrollment: e.id, stopped: "suppressed" });
          continue;
        }

        if (body.dry_run) {
          results.push({ enrollment: e.id, step: s.step_order, channel: s.channel, to: destination, dry_run: true });
          continue;
        }

        // CLAIM the step before sending. The unique index makes this the
        // double-send guard: if another run already claimed it, we skip.
        const { error: claimErr } = await db.from("social_sequence_sends").insert({
          enrollment_id: e.id,
          step_order: s.step_order,
          channel: s.channel,
          destination,
          ok: false,
        });
        if (claimErr) {
          results.push({ enrollment: e.id, step: s.step_order, skipped: "already claimed" });
          continue;
        }

        const sent = s.channel === "sms"
          ? await sendSms(destination, text)
          : await sendEmail(destination, s.subject || "A note from WePrintWraps", text);

        await db.from("social_sequence_sends")
          .update({ ok: sent.ok, provider_id: sent.id ?? null, error: sent.error ?? null })
          .eq("enrollment_id", e.id).eq("step_order", s.step_order);

        if (!sent.ok) {
          await db.from("social_sequence_enrollments")
            .update({ status: "failed", last_error: sent.error, updated_at: nowIso }).eq("id", e.id);
          results.push({ enrollment: e.id, step: s.step_order, ok: false, error: sent.error });
          continue;
        }

        // Schedule the following step by ITS delay.
        const { data: nextStep } = await db
          .from("social_sequence_steps")
          .select("delay_hours")
          .eq("sequence_id", e.sequence_id)
          .eq("step_order", e.next_step + 1)
          .eq("active", true)
          .maybeSingle();
        const nextAt = nextStep
          ? new Date(Date.now() + (nextStep.delay_hours || 0) * 3600_000).toISOString()
          : nowIso;

        await db.from("social_sequence_enrollments").update({
          next_step: e.next_step + 1,
          next_run_at: nextAt,
          status: nextStep ? "active" : "completed",
          updated_at: nowIso,
        }).eq("id", e.id);

        results.push({ enrollment: e.id, step: s.step_order, channel: s.channel, ok: true });
      } catch (err) {
        results.push({ enrollment: e.id, ok: false, error: (err as Error).message });
      }
    }

    const sent = results.filter((r) => r.ok === true).length;
    return json({ ok: true, processed: results.length, sent, results });
  } catch (e) {
    console.error("social-sequence-run error:", e);
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
