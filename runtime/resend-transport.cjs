"use strict";

const RESEND_EMAILS_ENDPOINT = "https://api.resend.com/emails";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class ResendConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ResendConfigurationError";
    this.code = code;
    this.retryable = false;
  }
}

function senderEmail(value) {
  const text = String(value || "").trim();
  const angle = text.match(/<([^<>]+)>$/);
  const email = String(angle ? angle[1] : text).trim().toLowerCase();
  return { text, email };
}

function resendReadiness(env = process.env) {
  const mode = String(env.DESIGNPRO_OUTBOUND_EMAIL_ENABLED || "").trim().toLowerCase();
  const providerKeys = ["RESEND_API_KEY", "RESEND_FROM", "RESEND_FROM_VERIFIED"];
  const unexpected = providerKeys.filter((key) => String(env[key] || "").trim());
  if (mode !== "true" && mode !== "false") {
    return Object.freeze({
      enabled: null,
      configurationValid: false,
      available: false,
      publicGoLiveReady: false,
      provider: "resend",
      missing: ["DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true|false"],
      unexpected,
      detail: "Outbound WrapBox email mode must be explicitly enabled or disabled",
    });
  }
  if (mode === "false") {
    return Object.freeze({
      enabled: false,
      configurationValid: unexpected.length === 0,
      available: false,
      publicGoLiveReady: false,
      provider: "resend",
      missing: [],
      unexpected,
      detail: unexpected.length
        ? "Outbound WrapBox email is disabled; provider credentials must be omitted"
        : "Outbound WrapBox email is explicitly disabled for dark deployment",
    });
  }
  const missing = [];
  const apiKey = String(env.RESEND_API_KEY || "").trim();
  const from = senderEmail(env.RESEND_FROM);
  if (!apiKey) missing.push("RESEND_API_KEY");
  if (!from.text || !EMAIL_RE.test(from.email)) missing.push("RESEND_FROM");
  if (String(env.RESEND_FROM_VERIFIED || "").trim().toLowerCase() !== "true") {
    missing.push("RESEND_FROM_VERIFIED=true");
  }
  return Object.freeze({
    enabled: true,
    configurationValid: missing.length === 0,
    available: missing.length === 0,
    publicGoLiveReady: missing.length === 0,
    provider: "resend",
    missing,
    unexpected: [],
    detail: missing.length
      ? "WrapBox mail is unavailable until a Resend key and verified FROM sender are configured"
      : "WrapBox mail is configured with an explicitly attested verified FROM sender",
  });
}

function createResendTransport({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const readiness = resendReadiness(env);
  if (readiness.enabled === false && readiness.configurationValid) {
    throw new ResendConfigurationError(
      "outbound_email_disabled",
      "Outbound WrapBox email is explicitly disabled",
    );
  }
  if (!readiness.available) {
    throw new ResendConfigurationError(
      "resend_mail_unavailable",
      `Resend configuration incomplete: ${readiness.missing.join(", ")}`,
    );
  }
  if (typeof fetchImpl !== "function") {
    throw new ResendConfigurationError("resend_fetch_unavailable", "HTTPS fetch implementation is required");
  }
  const apiKey = String(env.RESEND_API_KEY).trim();
  const from = senderEmail(env.RESEND_FROM).text;
  if (/\s/.test(apiKey) || apiKey.length < 8 || apiKey.length > 500) {
    throw new ResendConfigurationError("resend_api_key_invalid", "RESEND_API_KEY format is invalid");
  }

  return Object.freeze({
    supportsIdempotency: true,
    provider: "resend",
    async send({ to, subject, text, idempotencyKey }) {
      const recipient = String(to || "").trim().toLowerCase();
      const safeSubject = String(subject || "").trim();
      const safeText = String(text || "");
      const key = String(idempotencyKey || "").trim();
      if (!EMAIL_RE.test(recipient) || recipient.length > 320
        || !safeSubject || safeSubject.length > 998 || !safeText
        || !key || key.length > 256 || /[^\x21-\x7e]/.test(key)) {
        const error = new Error("Resend message identity is incomplete or invalid");
        error.code = "resend_message_invalid";
        error.retryable = false;
        throw error;
      }

      const response = await fetchImpl(RESEND_EMAILS_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Idempotency-Key": key,
        },
        body: JSON.stringify({ from, to: [recipient], subject: safeSubject, text: safeText }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(`Resend email request failed with HTTP ${response.status}`);
        error.code = "resend_send_failed";
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      const providerMessageId = String(payload?.id || "").trim();
      if (!providerMessageId || providerMessageId.length > 500) {
        const error = new Error("Resend response did not include a durable email ID");
        error.code = "resend_message_id_missing";
        error.retryable = true;
        throw error;
      }
      return { providerMessageId };
    },
  });
}

module.exports = {
  RESEND_EMAILS_ENDPOINT,
  ResendConfigurationError,
  createResendTransport,
  resendReadiness,
};

