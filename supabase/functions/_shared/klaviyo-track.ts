/**
 * klaviyo-track — fire-and-forget Klaviyo event mirror (the MONITOR layer).
 *
 * Klaviyo (the real WPW account) is the single place all email/quote activity
 * is monitored and quantified. Any function that emails a customer via Resend
 * or takes a quote action calls klaviyoTrack() so the event lands on the
 * customer's Klaviyo profile (creating the profile if new).
 *
 * Guarantees: NEVER throws, never blocks the caller's happy path — tracking
 * failures are logged and swallowed. Skips silently when KLAVIYO_API_KEY is
 * unset. This sends metric EVENTS only; it never sends email and never
 * subscribes anyone to marketing.
 */

const KLAVIYO_EVENTS_URL = "https://a.klaviyo.com/api/events/";
const KLAVIYO_REVISION = "2024-10-15";

export interface KlaviyoTrackOpts {
  /** Metric name as it appears in Klaviyo, e.g. "Quote Sent" */
  metric: string;
  /** Recipient/customer email — required; without it there is no profile */
  email: string;
  name?: string;
  phone?: string;
  /** Event payload shown on the Klaviyo profile timeline */
  properties?: Record<string, unknown>;
  /** Monetary value of the event (revenue attribution) */
  value?: number;
  /** Idempotency key — same unique_id + metric is deduped by Klaviyo */
  uniqueId?: string;
}

export async function klaviyoTrack(opts: KlaviyoTrackOpts): Promise<boolean> {
  try {
    const key = Deno.env.get("KLAVIYO_API_KEY");
    const email = (opts.email || "").trim().toLowerCase();
    if (!key || !email || !email.includes("@")) return false;

    const profileAttrs: Record<string, string> = { email };
    if (opts.name) {
      const parts = opts.name.trim().split(/\s+/);
      profileAttrs.first_name = parts[0];
      if (parts.length > 1) profileAttrs.last_name = parts.slice(1).join(" ");
    }
    if (opts.phone) profileAttrs.phone_number = opts.phone;

    const res = await fetch(KLAVIYO_EVENTS_URL, {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${key}`,
        revision: KLAVIYO_REVISION,
        "Content-Type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        data: {
          type: "event",
          attributes: {
            properties: opts.properties || {},
            metric: { data: { type: "metric", attributes: { name: opts.metric } } },
            profile: { data: { type: "profile", attributes: profileAttrs } },
            time: new Date().toISOString(),
            ...(typeof opts.value === "number" ? { value: opts.value, value_currency: "USD" } : {}),
            ...(opts.uniqueId ? { unique_id: opts.uniqueId } : {}),
          },
        },
      }),
    });
    if (!res.ok) {
      console.warn(`[klaviyo-track] ${opts.metric} -> ${res.status}:`, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.warn("[klaviyo-track] swallowed error:", String(e).slice(0, 160));
    return false;
  }
}
