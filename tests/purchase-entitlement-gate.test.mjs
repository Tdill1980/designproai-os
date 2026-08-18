import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260818210000_designpro_purchase_entitlements.sql", import.meta.url), "utf8");
const card = readFileSync(new URL("../app/src/components/revisioniq/ProductionFlowLayersCard.tsx", import.meta.url), "utf8");

/**
 * Calls 1-11 run automatically and cheaply so the customer can see what they
 * would be buying. Everything after is expensive, and a preview is not a
 * purchase. pack.activate used to end by opening production, which meant
 * finishing a free preview started paid fulfillment.
 */
test("pack.activate prepares the pack and stops", () => {
  const stage = claimant.slice(claimant.indexOf('stage.stage_key === "pack.activate"'));
  const body = stage.slice(0, stage.indexOf("throw new StageError(\"unsupported_entice_stage\""));
  assert.doesNotMatch(body, /return ensureAutomaticProduction/, "preparation must not start paid production");
  assert.match(body, /awaitingPurchase: true/, "the receipt must say why production has not started");
  assert.match(body, /purchasableProducts: \["production_pack", "logo_pack"\]/);
});

/** The conductor is kept. Only its trigger moved. */
test("the production conductor is preserved, not rebuilt", () => {
  assert.match(claimant, /async function ensureAutomaticProduction\(sb, enticeRunId\)/);
  assert.match(claimant, /create_designpro_production_workflow/);
  assert.match(migration, /public\.create_designpro_production_workflow\(/,
    "payment confirmation must call the SAME conductor, never a second chain");
});

test("the two products stay two products", () => {
  assert.match(migration, /CHECK \(product IN \('production_pack','logo_pack'\)\)/);
  assert.match(gateway, /amountCents: 29900/);
  assert.match(gateway, /amountCents: 2900/);
  // One row per product per pack: buying logos can never be read as having
  // bought production files.
  assert.match(migration, /designpro_entitlement_run_product_uidx[\s\S]{0,200}\(entice_run_id, product\)/);
});

test("only a confirmed payment authorizes fulfillment", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.confirm_designpro_purchase/);
  assert.match(migration, /IF v_row\.status = 'paid' THEN[\s\S]{0,400}'idempotent', true/, "a redelivered webhook must not open a second run");
  assert.match(migration, /status = 'paid', paid_at = now\(\)/);
  // Both purchases on one pack share a fulfillment cycle without duplicating it.
  assert.match(migration, /SELECT production_run_id INTO v_existing/);
  assert.match(migration, /prepared_pack_not_ready/, "nothing may be sold before the panels exist");
});

test("a browser can read an entitlement and never write one", () => {
  assert.match(migration, /CREATE POLICY designpro_owner_read_entitlements[\s\S]{0,200}FOR SELECT TO authenticated/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.designpro_purchase_entitlements FROM authenticated, anon/);
  assert.match(migration, /service_role_required/);
});

/** The gateway is browser-facing, so it holds no service role -- ever. */
test("the gateway proves the payment and the runtime records it", () => {
  assert.doesNotMatch(gateway, /SUPABASE_SERVICE_ROLE/);
  assert.match(gateway, /function verifiedStripeEvent\(rawBody, signatureHeader, secret, nowSeconds\)/);
  assert.match(gateway, /timingSafeEqual/, "a signature compared byte-by-byte leaks its own answer");
  assert.match(gateway, /Math\.abs\(nowSeconds - Number\(timestamp\)\) > 300/, "a captured delivery must not replay");
  assert.match(gateway, /payment_status \|\| ""\) !== "paid"/, "an unpaid session authorizes nothing");
  assert.match(gateway, /purchaseThroughRuntime\(fetchImpl, cfg, "confirm"/);
  assert.match(runtime, /app\.post\("\/internal\/purchases\/confirm", authMiddleware/);
  assert.match(runtime, /app\.post\("\/internal\/purchases\/open", authMiddleware/);
});

test("the price is the server's, never the caller's", () => {
  assert.match(gateway, /const spec = PURCHASE_PRODUCTS\[String\(body\.product \|\| ""\)\]/);
  assert.match(gateway, /if \(!spec\) return json\(res, 400, \{ error: "unknown_product" \}\)/);
  assert.doesNotMatch(gateway, /body\.amountCents|body\.unitAmount|body\.price/);
});

test("the customer path reaches checkout through dpApi, not a legacy function", () => {
  assert.match(card, /source\?: ProductionLayersSource \| null/);
  assert.match(card, /await injected\.onOrderProductionPack!\(\)/);
  assert.match(card, /await injected\.onOrderLogoPack\(\)/);
  // The legacy call survives for the path that still uses it, but the injected
  // path returns before reaching it.
  const logoHandler = card.slice(card.indexOf("const handleOrderLogoPack"));
  assert.ok(logoHandler.indexOf("if (injected)") < logoHandler.indexOf("create-single-use-checkout"),
    "the standalone path must return before the edge-function call");
});
