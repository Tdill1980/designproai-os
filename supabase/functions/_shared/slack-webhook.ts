/**
 * slack-webhook.ts
 *
 * Generic Slack incoming-webhook helper. Used by proof-escalate-support
 * (Phase 5) to post Tier-3 support escalations to the
 * #proof-escalations channel.
 *
 * Env: SLACK_WEBHOOK_URL_PROOF_SUPPORT (set via Supabase secrets)
 *
 * Graceful fallback: if the URL is not set, the function logs a warning
 * and returns { ok: false, reason: "missing_url" } so the caller can
 * still complete the primary flow. The escalation row is created + the
 * shop flow works even without Slack; only the team notification is
 * missed, and the escalation will show up in /admin/proof-support.
 */

export type SlackSendResult =
  | { ok: true; ts?: string; permalink?: string }
  | { ok: false; reason: "missing_url" | "http_error" | "network_error"; error?: string };

export interface SlackBlock {
  // Deliberately loose — we build blocks inline in the caller. Supabase edge
  // runtime serializes JSON regardless.
  [k: string]: unknown;
}

export interface SlackMessage {
  text: string; // fallback for notifications
  blocks?: SlackBlock[];
  username?: string;
  icon_emoji?: string;
}

const TIMEOUT_MS = 8_000;

function getWebhookUrl(envKey: string): string | null {
  const url = Deno.env.get(envKey);
  if (!url || !url.startsWith("https://hooks.slack.com/")) return null;
  return url;
}

export async function sendSlackMessage(
  envKey: string,
  message: SlackMessage,
): Promise<SlackSendResult> {
  const url = getWebhookUrl(envKey);
  if (!url) {
    console.warn(`slack-webhook: ${envKey} not set — skipping send`);
    return { ok: false, reason: "missing_url" };
  }

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err: any) {
    console.error("slack-webhook: network error:", err?.message || err);
    return { ok: false, reason: "network_error", error: err?.message };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`slack-webhook: HTTP ${resp.status}`, text.slice(0, 400));
    return { ok: false, reason: "http_error", error: text.slice(0, 400) };
  }

  // Standard incoming webhooks return "ok" (plain text), not JSON with ts/permalink.
  // Apps API would give us ts/permalink but that requires a bot token. Phase 7 can
  // upgrade if we want threaded responses; for now fire-and-forget is enough.
  return { ok: true };
}
