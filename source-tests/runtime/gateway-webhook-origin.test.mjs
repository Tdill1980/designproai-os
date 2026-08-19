/**
 * STRIPE MUST BE ABLE TO REACH ITS OWN WEBHOOK.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * assertSameOrigin ran on every mutating request before routing, including
 * POST /api/webhooks/stripe. Stripe is not a browser and sends no Origin
 * header, so the rule read the empty string as a mismatch and answered 403
 * origin_rejected before the webhook handler ever ran.
 *
 * Live-verified on os.designproai.com before the fix:
 *
 *   POST /api/webhooks/stripe                    -> 403 origin_rejected
 *   POST /api/webhooks/stripe  Origin: <app>     -> 400 stripe_signature_invalid
 *
 * The consequence is the worst shape a payment bug can take: Stripe marks the
 * session paid, the delivery 403s, confirm_designpro_purchase is never called,
 * no entitlement row is written, and await_purchase never releases. The
 * customer is charged and receives nothing.
 *
 * ── WHY EXEMPTING IT IS SAFE ───────────────────────────────────────────────
 * The same-origin rule is CSRF defence: it stops a page the customer did not
 * open from spending their session cookie. This route consumes no cookie. Its
 * authentication is the HMAC signature over the raw body, which an attacker
 * cannot forge, while an Origin header is self-declared and any non-browser
 * client can set it to anything. The signature is strictly the stronger check.
 *
 * ── WHAT THESE TESTS HOLD ──────────────────────────────────────────────────
 * · Stripe's real request shape reaches the handler and is judged on its
 *   signature, not on its lack of an Origin;
 * · an unsigned delivery still grants nothing;
 * · the exemption is exactly one route -- every other mutating path still
 *   refuses a foreign or absent Origin, so the CSRF defence is intact.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGateway } from "../../gateway/src/server.mjs";

const APP_ORIGIN = "https://os.designproai.com";

const ENV = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://wozyamlnygaddievzuwn.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  DESIGNPRO_APP_ORIGIN: APP_ORIGIN,
  DESIGNPRO_RUNTIME_INTERNAL_URL: "http://runtime-1:3001",
  WORKER_SECRET: "w".repeat(64),
  STRIPE_SECRET_KEY: "sk_test_gateway_origin_case",
  STRIPE_WEBHOOK_SECRET: "whsec_gateway_origin_case",
};

// No network: a fetch that is called at all fails the test it is used by,
// because none of these requests should reach Supabase or Stripe.
const fetchImpl = async () => {
  throw new Error("no upstream call is expected in these cases");
};

async function request(path, { origin, body = "{}" } = {}) {
  const server = createGateway({ env: ENV, fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body,
    });
    return { status: response.status, body: await response.json().catch(() => ({})) };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("Stripe's own request shape reaches the webhook handler", async () => {
  // Exactly what Stripe sends: no Origin header at all.
  const result = await request("/api/webhooks/stripe");
  assert.notEqual(result.body.error, "origin_rejected");
  assert.notEqual(result.status, 403);
  // It got as far as signature verification, which is the proof it routed.
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "stripe_signature_invalid");
});

test("an unsigned delivery still grants nothing", async () => {
  // Reaching the handler must not be confused with being believed. A forged
  // delivery carrying a real-looking completed session is refused on the
  // signature, so the exemption cannot be used to mint an entitlement.
  const forged = JSON.stringify({
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_forged", payment_status: "paid", metadata: { product_type: "print_pack_entitlement" } } },
  });
  const result = await request("/api/webhooks/stripe", { body: forged });
  assert.equal(result.status, 400);
  assert.equal(result.body.error, "stripe_signature_invalid");
});

test("the exemption is one route: every other mutating path still checks origin", async () => {
  for (const path of ["/api/auth/login", "/api/auth/signup", "/api/checkout/sessions", "/api/production"]) {
    const missing = await request(path);
    assert.equal(missing.status, 403, `${path} accepted a request with no Origin`);
    assert.equal(missing.body.error, "origin_rejected", `${path} accepted a request with no Origin`);

    const foreign = await request(path, { origin: "https://attacker.example" });
    assert.equal(foreign.status, 403, `${path} accepted a foreign Origin`);
    assert.equal(foreign.body.error, "origin_rejected", `${path} accepted a foreign Origin`);
  }
});
