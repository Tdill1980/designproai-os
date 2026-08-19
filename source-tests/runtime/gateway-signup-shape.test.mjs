/**
 * SIGNUP MUST ACCEPT BOTH SHAPES GoTrue ACTUALLY RETURNS.
 *
 * ── WHAT WAS WRONG ─────────────────────────────────────────────────────────
 * The gateway read the created user as `payload.user?.id`. GoTrue returns the
 * user that way only when it ALSO mints a session, which happens only where
 * email confirmation is off. With confirmation ON there is no session to
 * return, so it answers 200 with the user object BARE at the top level:
 *
 *   {"id":"dc1297d3-…","aud":"authenticated","email":"…",
 *    "confirmation_sent_at":"2026-08-19T15:47:28Z", …}
 *
 * This project has confirmation on, so `payload.user` was undefined on every
 * real signup and every customer was told signup_failed.
 *
 * The failure was silent and inverted. The account WAS created and the email
 * WAS sent -- live-verified, trish+dpcanary@weprintwraps.com is in auth.users,
 * created by the very request that answered signup_failed. So the customer was
 * told it failed, never went looking for the confirmation email, and a retry
 * hit "user already registered". There was no way through the front door.
 *
 * It also answered HTTP 200 while saying signup_failed, because the upstream
 * status was passed straight through. A failure carrying a success status is
 * worse than the failure: no client can branch on it.
 *
 * ── WHAT THESE TESTS HOLD ──────────────────────────────────────────────────
 * · the bare/confirmation-required shape is accepted and reported as
 *   confirmationRequired, which is what tells the UI to say "check your email";
 * · the nested/session shape still works and still sets cookies;
 * · a genuine upstream refusal keeps its own status and message;
 * · an unreadable upstream success is a 502, never a 200.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { createGateway } from "../../gateway/src/server.mjs";

const APP_ORIGIN = "https://os.designproai.com";
const EMAIL = "canary.signup.shape@example.com";
const PASSWORD = "Ridgeline!Weld2026";

const ENV = {
  NODE_ENV: "production",
  SUPABASE_URL: "https://wozyamlnygaddievzuwn.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  DESIGNPRO_APP_ORIGIN: APP_ORIGIN,
  DESIGNPRO_RUNTIME_INTERNAL_URL: "http://runtime-1:3001",
  WORKER_SECRET: "w".repeat(64),
};

// The exact body GoTrue returns for a confirm-enabled project, trimmed to the
// fields the gateway reads. Captured from the live project, not invented.
const BARE_USER = {
  id: "dc1297d3-e1fb-4ebc-a207-43fb139394e3",
  aud: "authenticated",
  role: "authenticated",
  email: EMAIL,
  confirmation_sent_at: "2026-08-19T15:47:28.579947539Z",
  identities: [{ provider: "email" }],
  is_anonymous: false,
};

// And the shape it returns when confirmation is off: tokens plus a nested user.
const SESSION_PAYLOAD = {
  access_token: "access-token-value",
  refresh_token: "refresh-token-value",
  user: { id: BARE_USER.id, email: EMAIL },
};

function upstream(status, payload) {
  return async () => new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function signup(fetchImpl) {
  const server = createGateway({ env: ENV, fetchImpl });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/signup`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: APP_ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
    return {
      status: response.status,
      cookies: response.headers.getSetCookie?.() ?? [],
      body: await response.json().catch(() => ({})),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("the confirmation-required shape is a SUCCESS, and says so", async () => {
  const result = await signup(upstream(200, BARE_USER));
  assert.equal(result.status, 201);
  assert.equal(result.body.ok, true);
  // This flag is what lets the UI say "check your email" instead of leaving the
  // customer staring at a form that appeared to do nothing.
  assert.equal(result.body.confirmationRequired, true);
});

test("the session shape still works and still sets cookies", async () => {
  const result = await signup(upstream(200, SESSION_PAYLOAD));
  assert.equal(result.status, 201);
  assert.equal(result.body.confirmationRequired, false);
  assert.ok(result.cookies.some((cookie) => cookie.startsWith("dp_session=")), "no session cookie was set");
});

test("a real upstream refusal keeps its own status and message", async () => {
  const result = await signup(upstream(422, { msg: "User already registered" }));
  assert.equal(result.status, 422);
  assert.equal(result.body.error, "User already registered");
});

test("an unreadable upstream success is a 502, never a 200", async () => {
  // The specific regression: a failure must not carry a success status, or no
  // client can tell the difference.
  const result = await signup(upstream(200, { unexpected: "shape" }));
  assert.notEqual(result.status, 200);
  assert.equal(result.status, 502);
  assert.equal(result.body.error, "signup_failed");
});
