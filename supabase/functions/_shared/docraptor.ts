/**
 * docraptor.ts
 *
 * Thin wrapper around the DocRaptor HTML-to-PDF API. Used by proof-sign to
 * generate the tamper-evident signed proof PDF.
 *
 * Why DocRaptor:
 *   - SOC2 compliant
 *   - Unlimited retries / predictable output
 *   - No Puppeteer / Chromium dependency in edge functions (Deno can't run
 *     Chromium reliably — this is why panelizer-step-fill has memory crashes)
 *
 * API docs: https://docraptor.com/documentation/api
 *
 * Graceful fallback:
 *   If DOCRAPTOR_API_KEY is not set, this module returns { ok: false,
 *   reason: "missing_key" } instead of throwing. proof-sign treats that as
 *   a soft failure — the approval still succeeds, the signed record is still
 *   stored, but no PDF is generated. Allows Phase 2 to deploy + be tested
 *   before the DocRaptor account is provisioned.
 */

const DOCRAPTOR_ENDPOINT = "https://docraptor.com/docs";

export interface PdfGenerateResult {
  ok: boolean;
  pdfBytes?: Uint8Array;
  reason?: "missing_key" | "http_error" | "network_error";
  status?: number;
  error?: string;
}

interface DocRaptorRequest {
  html: string;
  name?: string;
  test?: boolean; // true in non-prod — free & unthrottled but stamped "TEST"
  prince_options?: {
    media?: "screen" | "print";
    page_size?: string;
    javascript?: boolean;
  };
}

function getApiKey(): string | null {
  const key = Deno.env.get("DOCRAPTOR_API_KEY");
  return key && key.length > 0 ? key : null;
}

function isProduction(): boolean {
  // Treat anything that isn't explicitly marked dev/test as prod
  const env = (Deno.env.get("DEPLOY_ENV") || "production").toLowerCase();
  return env === "production" || env === "prod";
}

export async function generatePdfFromHtml(
  html: string,
  options: { name?: string; timeoutMs?: number } = {},
): Promise<PdfGenerateResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.warn("docraptor: DOCRAPTOR_API_KEY not set — skipping PDF generation");
    return { ok: false, reason: "missing_key" };
  }

  const body: DocRaptorRequest = {
    html,
    name: options.name || `proof-${Date.now()}`,
    test: !isProduction(),
    prince_options: {
      media: "print",
      page_size: "Letter",
      javascript: false,
    },
  };

  const timeoutMs = options.timeoutMs ?? 45_000;
  let resp: Response;
  try {
    resp = await fetch(DOCRAPTOR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // DocRaptor uses HTTP basic auth with the key as the username
        Authorization: `Basic ${btoa(`${apiKey}:`)}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err: any) {
    console.error("docraptor: network error:", err?.message || err);
    return {
      ok: false,
      reason: "network_error",
      error: err?.message || "fetch failed",
    };
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    console.error(`docraptor: HTTP ${resp.status}`, text.slice(0, 500));
    return {
      ok: false,
      reason: "http_error",
      status: resp.status,
      error: text.slice(0, 500),
    };
  }

  const buf = new Uint8Array(await resp.arrayBuffer());
  return { ok: true, pdfBytes: buf };
}

/**
 * SHA-256 hex digest of bytes. Used for content-addressed audit storage +
 * tamper detection.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
