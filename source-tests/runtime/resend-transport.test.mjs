import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  RESEND_EMAILS_ENDPOINT,
  createResendTransport,
  resendReadiness,
} = require("../../runtime/resend-transport.cjs");

const configuredEnv = Object.freeze({
  DESIGNPRO_OUTBOUND_EMAIL_ENABLED: "true",
  RESEND_API_KEY: "re_test_0123456789abcdef",
  RESEND_FROM: "DesignProAI WrapBox <delivery@designpro.example>",
  RESEND_FROM_VERIFIED: "true",
});

test("email mode is explicit and enabled mode fails closed without every provider setting", () => {
  assert.deepEqual(resendReadiness({}), {
    enabled: null,
    configurationValid: false,
    available: false,
    publicGoLiveReady: false,
    provider: "resend",
    missing: ["DESIGNPRO_OUTBOUND_EMAIL_ENABLED=true|false"],
    unexpected: [],
    detail: "Outbound WrapBox email mode must be explicitly enabled or disabled",
  });
  assert.deepEqual(resendReadiness({ DESIGNPRO_OUTBOUND_EMAIL_ENABLED: "true" }), {
    enabled: true,
    configurationValid: false,
    available: false,
    publicGoLiveReady: false,
    provider: "resend",
    missing: ["RESEND_API_KEY", "RESEND_FROM", "RESEND_FROM_VERIFIED=true"],
    unexpected: [],
    detail: "WrapBox mail is unavailable until a Resend key and verified FROM sender are configured",
  });
  assert.deepEqual(resendReadiness(configuredEnv), {
    enabled: true,
    configurationValid: true,
    available: true,
    publicGoLiveReady: true,
    provider: "resend",
    missing: [],
    unexpected: [],
    detail: "WrapBox mail is configured with an explicitly attested verified FROM sender",
  });
});

test("dark mode is usable only when email is explicitly disabled and provider secrets are absent", () => {
  const dark = { DESIGNPRO_OUTBOUND_EMAIL_ENABLED: "false" };
  assert.deepEqual(resendReadiness(dark), {
    enabled: false,
    configurationValid: true,
    available: false,
    publicGoLiveReady: false,
    provider: "resend",
    missing: [],
    unexpected: [],
    detail: "Outbound WrapBox email is explicitly disabled for dark deployment",
  });
  assert.throws(
    () => createResendTransport({ env: dark, fetchImpl: async () => { throw new Error("network must not run"); } }),
    (error) => error.code === "outbound_email_disabled" && error.retryable === false,
  );

  const stale = resendReadiness({ ...dark, RESEND_API_KEY: "must-not-be-reused" });
  assert.equal(stale.configurationValid, false);
  assert.deepEqual(stale.unexpected, ["RESEND_API_KEY"]);
  assert.match(stale.detail, /credentials must be omitted/);
});

test("adapter posts only to Resend HTTPS emails endpoint with exact idempotency header", async () => {
  const requests = [];
  const transport = createResendTransport({
    env: configuredEnv,
    async fetchImpl(url, options) {
      requests.push({ url, options });
      return { ok: true, status: 200, async json() { return { id: "email_123" }; } };
    },
  });
  assert.equal(transport.supportsIdempotency, true);
  const result = await transport.send({
    to: "customer@example.com",
    subject: "Your pack is ready",
    text: "Open the standalone WrapBox portal.",
    idempotencyKey: "designpro-wrapbox:pack-1:hash-1",
  });
  assert.deepEqual(result, { providerMessageId: "email_123" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, RESEND_EMAILS_ENDPOINT);
  assert.equal(new URL(requests[0].url).protocol, "https:");
  assert.equal(requests[0].options.method, "POST");
  assert.equal(requests[0].options.headers["Idempotency-Key"], "designpro-wrapbox:pack-1:hash-1");
  assert.equal(requests[0].options.headers.Authorization, `Bearer ${configuredEnv.RESEND_API_KEY}`);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    from: configuredEnv.RESEND_FROM,
    to: ["customer@example.com"],
    subject: "Your pack is ready",
    text: "Open the standalone WrapBox portal.",
  });
});

test("adapter fails closed before network for unverified sender or overlong provider key", async () => {
  let fetched = false;
  assert.throws(
    () => createResendTransport({ env: { ...configuredEnv, RESEND_FROM_VERIFIED: "false" }, fetchImpl: async () => { fetched = true; } }),
    (error) => error.code === "resend_mail_unavailable",
  );
  const transport = createResendTransport({
    env: configuredEnv,
    fetchImpl: async () => { fetched = true; return { ok: true, async json() { return { id: "unexpected" }; } }; },
  });
  await assert.rejects(
    transport.send({ to: "customer@example.com", subject: "Ready", text: "Ready", idempotencyKey: "x".repeat(257) }),
    (error) => error.code === "resend_message_invalid" && error.retryable === false,
  );
  assert.equal(fetched, false);
});

test("adapter classifies provider retryability without persisting response content", async () => {
  const transport = createResendTransport({
    env: configuredEnv,
    fetchImpl: async () => ({ ok: false, status: 429, async json() { return { message: "provider-private-details" }; } }),
  });
  await assert.rejects(
    transport.send({ to: "customer@example.com", subject: "Ready", text: "Ready", idempotencyKey: "stable-key" }),
    (error) => {
      assert.equal(error.code, "resend_send_failed");
      assert.equal(error.retryable, true);
      assert.doesNotMatch(error.message, /provider-private-details/);
      return true;
    },
  );
});

