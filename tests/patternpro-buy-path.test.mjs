import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PatternPro phase 2 — the paid path on DesignProAI.
 *
 * Owner, 2026-09-15: "Go". A buyer on /pattern-wrap pays through Stripe
 * Checkout (create-wbty-checkout), the webhook flips the order to paid and
 * sends the print order to WePrintWraps (wbty-stripe-webhook →
 * send-wbty-order-email), the buyer lands on /wbty/order-success and can
 * track the PP- reference in ShopFlow, and the design team runs the library
 * and the order board from /admin/wbty-manager and /admin/wbty-orders.
 *
 * Static, like the other shell contracts.
 */
const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const APP = read("app/src/App.tsx");
const CONFIG = read("supabase/config.toml");
const CHECKOUT = read("supabase/functions/create-wbty-checkout/index.ts");
const WEBHOOK = read("supabase/functions/wbty-stripe-webhook/index.ts");
const EMAIL = read("supabase/functions/send-wbty-order-email/index.ts");
const DEPLOY = read(".github/workflows/deploy-edge-functions.yml");
const MIGRATION = "supabase/migrations/20260915230000_patternpro_wbty_orders.sql";

test("the three paid-path functions exist and are registered", () => {
  for (const fn of ["create-wbty-checkout", "wbty-stripe-webhook", "send-wbty-order-email"]) {
    assert.ok(existsSync(resolve(root, `supabase/functions/${fn}/index.ts`)), fn);
    assert.ok(CONFIG.includes(`[functions.${fn}]\nverify_jwt = false`), `${fn} in config.toml`);
  }
});

test("checkout sends the buyer back to the host they started on, never to a foreign brand", () => {
  assert.ok(CHECKOUT.includes('"https://wallpro.weprintwraps.com"'));
  assert.ok(CHECKOUT.includes('"https://os.designproai.com"'));
  assert.ok(CHECKOUT.includes("const SITE_URL = siteUrlFor(req);"));
  assert.ok(CHECKOUT.includes("success_url: `${SITE_URL}/wbty/order-success?session_id={CHECKOUT_SESSION_ID}`"));
  assert.ok(CHECKOUT.includes("cancel_url: `${SITE_URL}/pattern-wrap?cancelled=1`"));
  assert.ok(!CHECKOUT.includes("restylepro.ai"));
});

test("the webhook verifies Stripe's signature and hands the paid order to the printer", () => {
  assert.ok(WEBHOOK.includes('Deno.env.get("STRIPE_WBTY_WEBHOOK_SECRET")'));
  assert.ok(WEBHOOK.includes("stripe.webhooks.constructEventAsync(body, signature, WEBHOOK_SECRET)"));
  assert.ok(WEBHOOK.includes('event.type === "checkout.session.completed"'));
  assert.ok(WEBHOOK.includes("/functions/v1/send-wbty-order-email"));
  assert.ok(WEBHOOK.includes('status: "fulfillment_emailed"'));
});

test("the print order goes to WePrintWraps under this platform's name, not the suite's", () => {
  assert.ok(EMAIL.includes('Deno.env.get("WPW_FULFILLMENT_EMAIL") || "lance@weprintwraps.com"'));
  assert.ok(EMAIL.includes('Deno.env.get("ORDER_FROM_EMAIL") || "orders@designproai.com"'));
  assert.ok(!/restylepro/i.test(EMAIL));
  // The code, not its comments — the comment is allowed to say what was removed.
  assert.ok(!/ship blind|white label/i.test(stripComments(EMAIL)), "WePrintWraps prints under its own name here");
});

test("the deploy passes the Stripe and Resend secrets to the functions", () => {
  for (const key of ["STRIPE_SECRET_KEY", "STRIPE_WBTY_WEBHOOK_SECRET", "RESEND_API_KEY"]) {
    assert.ok(DEPLOY.includes(`${key}: \${{ secrets.DESIGNPRO_${key} }}`), `${key} from repo secret`);
    assert.ok(DEPLOY.includes(`"${key}=\${${key}:-}"`), `${key} set on the project`);
  }
});

test("wbty_orders exists with the status set the stage table maps, read by its customer and admins", () => {
  assert.ok(existsSync(resolve(root, MIGRATION)));
  const sql = read(MIGRATION);
  assert.ok(sql.includes("CREATE TABLE IF NOT EXISTS public.wbty_orders"));
  assert.ok(sql.includes("REFERENCES public.wbty_products(id) ON DELETE SET NULL"));
  for (const status of ["pending", "paid", "fulfillment_emailed", "in_production", "shipped", "delivered", "refunded", "cancelled"]) {
    assert.ok(sql.includes(`'${status}'::text`), `status ${status}`);
  }
  assert.ok(sql.includes("stripe_session_id text UNIQUE"));
  assert.ok(sql.includes("CREATE POLICY wbty_orders_customer_read_own"));
  assert.ok(sql.includes("CREATE POLICY wbty_orders_admin_all"));
  // Every status the table admits has a ShopFlow stage, on both stage tables.
  const stages = read("app/src/lib/shopflowStages.ts") + read("supabase/functions/_shared/shopflow-stages.ts");
  for (const status of ["paid", "fulfillment_emailed", "in_production", "shipped", "refunded", "cancelled"]) {
    assert.ok(stages.includes(`"${status}"`), `stage for ${status}`);
  }
});

test("the buyer's return page, the admin pages and the old address are routed", () => {
  assert.ok(APP.includes('<Route path="/wbty/order-success" element={<WBTYOrderSuccess />} />'));
  assert.ok(APP.includes('<Route path="/wbty" element={<Navigate to="/printpro/patternpro" replace />} />'));
  assert.ok(APP.includes('<Route path="/admin/wbty-manager" element={<RequireAdmin><AdminWBTYManager /></RequireAdmin>} />'));
  assert.ok(APP.includes('<Route path="/admin/wbty-orders" element={<RequireAdmin><AdminWBTYOrders /></RequireAdmin>} />'));
  const success = read("app/src/pages/WBTYOrderSuccess.tsx");
  assert.ok(success.includes("to={`/shopflow?job=PP-${orderRefShort}&email=${encodeURIComponent(order.customer_email || \"\")}`}"));
  const shopflow = stripComments(read("app/src/pages/ShopFlow.tsx"));
  assert.ok(shopflow.includes('to="/pattern-wrap"'), "more yards go back to the partner page");
  assert.ok(!shopflow.includes('to="/wbty"'));
  for (const nav of ["app/src/components/layout/AppSidebar.tsx", "app/src/components/layout/AppTopBar.tsx"]) {
    const src = read(nav);
    assert.ok(src.includes('to="/admin/wbty-manager"'), `${nav} links the manager`);
    assert.ok(src.includes('to="/admin/wbty-orders"'), `${nav} links the orders`);
  }
});
