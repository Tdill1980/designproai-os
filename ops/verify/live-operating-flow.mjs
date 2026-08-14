/**
 * Exercise the live operating flow using the exact request shapes the shell's
 * gateway client builds (app/src/lib/designpro-api.ts), against the real
 * standalone gateway, authenticated with a real supabase-js session token —
 * the same bearer the browser sends.
 */
import { createHash, randomUUID } from "node:crypto";

const BASE = "https://os.designproai.com";
const SUPABASE = "https://wozyamlnygaddievzuwn.supabase.co";
const PUBKEY = "sb_publishable_fXHc8sn8AgTY56RKa6zyvQ_5Dt2eDR3";
const EMAIL = process.env.OP_EMAIL;
const PASSWORD = process.env.OP_PASSWORD;
const CUSTOMER = process.env.CUSTOMER_EMAIL || "canary-customer@weprintwraps.com";
const ORDER = process.env.ORDER || `LIVE-${Date.now().toString(36).toUpperCase()}`;

const sha256Hex = (s) => createHash("sha256").update(s).digest("hex");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// The shell mints its session through supabase-js; this is the same grant.
const authRes = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: PUBKEY, "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const auth = await authRes.json();
if (!auth.access_token) { log("sign-in FAILED", JSON.stringify(auth).slice(0, 200)); process.exit(1); }
log("1. signed in as", auth.user?.email);

async function api(path, init) {
  const res = await fetch(`${BASE}/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${auth.access_token}`,
      origin: BASE,
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

const session = await api("/auth/session");
log("2. gateway accepted the supabase session:", session.status, JSON.stringify(session.body).slice(0, 90));

log("3. registering the confirmed WrapBox recipient, order", ORDER);
const reg = await api("/wrapbox/recipients/register", {
  method: "POST",
  body: JSON.stringify({
    customerEmail: CUSTOMER,
    customerReference: process.env.CUSTOMER_REFERENCE || "WPW-JUL24-PRODUCTION-CANARY",
    verificationReference: `live-verify-${ORDER}`,
    orderNumber: ORDER,
    designName: `Live verification ${ORDER}`,
  }),
});
log("   ->", reg.status, JSON.stringify(reg.body).slice(0, 240));
if (reg.status >= 400) process.exit(1);
const delivery = reg.body.delivery;

log("4. creating the Calls 1-7 generation request");
const generationId = randomUUID().toLowerCase();
const idempotencyKey = `calls17:${generationId}:${delivery.recipientIdentityHash}:${sha256Hex(delivery.orderNumber)}`;
const created = await api("/generation/requests", {
  method: "POST",
  body: JSON.stringify({
    generationId,
    idempotencyKey,
    input: {
      contractVersion: "designpro.calls-1-7-input.v1",
      orderNumber: delivery.orderNumber,
      vehicle: { year: "2021", make: "Ford", model: "Transit 250", type: "van" },
      delivery: {
        contractVersion: "designpro.wrapbox-recipient.v1",
        orderNumber: delivery.orderNumber,
        recipientIdentityHash: delivery.recipientIdentityHash,
      },
      brief: "Bold commercial wrap, clean geometric shapes, large legible phone number",
      designName: delivery.designName,
      businessName: "WePrintWraps",
      industry: "vehicle wraps",
      colors: ["dark blue", "ice blue", "white"],
      style: "bold modern commercial",
    },
  }),
});
log("   ->", created.status, JSON.stringify(created.body).slice(0, 300));
if (created.status >= 400) process.exit(1);
const requestId = created.body.requestId;

log("5. polling the runtime for the seven views (request", requestId + ")");
let last = null;
for (let i = 0; i < 60; i++) {
  await new Promise((r) => setTimeout(r, 10000));
  const st = await api(`/generation/requests/${requestId}`);
  if (st.status >= 400) { log("   status read failed:", st.status, JSON.stringify(st.body).slice(0, 200)); break; }
  const s = st.body;
  const line = `${s.state} phase=${s.phase} shots=${s.shotsComplete}/${s.shotsTotal} failed=${(s.failedShots || []).length} handoffReady=${s.handoffReady} blocker=${s.handoffBlocker || "-"}`;
  if (line !== last) { log("   " + line); last = line; }
  if ((s.failedShots || []).length) log("   failedShots:", JSON.stringify(s.failedShots).slice(0, 300));
  if (["outputs_ready", "failed", "cancelled"].includes(s.state)) {
    log("   terminal:", s.state, "failureCode:", s.failureCode || "-");
    const views = await api(`/generation/requests/${requestId}/views`);
    log("   views route:", views.status, Array.isArray(views.body) ? `${views.body.length} views` : JSON.stringify(views.body).slice(0, 200));
    if (Array.isArray(views.body)) {
      for (const v of views.body) log(`     ${v.consumerRole.padEnd(10)} ${v.contentHash.slice(0, 16)}… signed=${Boolean(v.signedUrl)}`);
    }
    if (s.state === "outputs_ready" && s.handoffReady) {
      log("6. handing off to Calls 8-12");
      const ho = await api(`/generation/requests/${requestId}/handoff`, { method: "POST" });
      log("   ->", ho.status, JSON.stringify(ho.body).slice(0, 240));
    }
    break;
  }
}
log("ORDER:", ORDER, "GENERATION:", generationId, "REQUEST:", requestId);
