/** Generic Slack incoming-webhook helper used for internal escalations. */
export type SlackSendResult =
  | { ok: true; ts?: string; permalink?: string }
  | { ok: false; reason: "missing_url" | "http_error" | "network_error"; error?: string };

export interface SlackBlock { [key: string]: unknown }
export interface SlackMessage {
  text: string;
  blocks?: SlackBlock[];
  username?: string;
  icon_emoji?: string;
}

const TIMEOUT_MS = 8_000;

function getWebhookUrl(envKey: string): string | null {
  const url = Deno.env.get(envKey);
  return url?.startsWith("https://hooks.slack.com/") ? url : null;
}

export async function sendSlackMessage(envKey: string, message: SlackMessage): Promise<SlackSendResult> {
  const url = getWebhookUrl(envKey);
  if (!url) {
    console.warn(`slack-webhook: ${envKey} not set — skipping send`);
    return { ok: false, reason: "missing_url" };
  }
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return { ok: false, reason: "http_error", error: body.slice(0, 400) };
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: "network_error", error: error instanceof Error ? error.message : String(error) };
  }
}
