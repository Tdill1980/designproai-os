import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260818210000_designpro_purchase_entitlements.sql", import.meta.url), "utf8");
const card = readFileSync(new URL("../app/src/components/revisioniq/ProductionFlowLayersCard.tsx", import.meta.url), "utf8");
const { _test } = require0("../runtime/designpro-standalone-claimant.cjs");
function require0(rel) {
  return globalThis.process.getBuiltinModule
    ? globalThis.process.getBuiltinModule("module").createRequire(import.meta.url)(rel)
    : {};
}
const manifestFor = _test.authorizedAssetManifest;

/* ── the proven semantics ──────────────────────────────────────────── */

test("the identifiers, prices and metadata are the proven ones", () => {
  assert.match(gateway, /print_pack_entitlement: Object\.freeze/);
  assert.match(gateway, /amountCents: 29900/);
  assert.match(gateway, /logo_pack: Object\.freeze/);
  assert.match(gateway, /amountCents: 2900/);
  for (const field of ["product_type", "generation_id", "user_id", "user_email", "amount_cents"]) {
    assert.ok(gateway.includes(`"metadata[${field}]"`), `Stripe metadata must carry ${field}`);
  }
  // The path its own source calls the old re-slice kicker. Comments stripped:
  // both files name it in order to record that it is deliberately not used, and
  // a rule must not fail on its own statement.
  const gatewayCode = gateway.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const migrationCode = migration.replace(/^\s*--[^\n]*$/gm, "");
  assert.ok(!gatewayCode.includes("print_production_pack"));
  assert.ok(!migrationCode.includes("print_production_pack"));
});

test("the price is the server's and the charge is Stripe's", () => {
  assert.match(gateway, /const spec = PURCHASE_PRODUCTS\[String\(body\.product \|\| ""\)\]/);
  assert.doesNotMatch(gateway, /body\.amountCents|body\.unitAmount|body\.price/);
  assert.match(gateway, /Number\(object\.amount_total \|\| metadata\.amount_cents \|\| 0\)/,
    "the recorded amount must be what was actually charged");
});

test("nothing is recorded before payment", () => {
  assert.doesNotMatch(gateway, /purchaseThroughRuntime\(fetchImpl, cfg, "open"/);
  assert.doesNotMatch(runtime, /internal\/purchases\/open/);
  assert.doesNotMatch(migration, /open_designpro_purchase|pending_payment/);
  assert.match(migration, /designpro_entitlement_session_uidx/,
    "the Stripe session is the transaction identity that makes confirmation idempotent");
});

/* ── the gate ──────────────────────────────────────────────────────── */

test("one production workflow exists early and stops before paid work", () => {
  assert.match(claimant, /return ensureAutomaticProduction\(sb, run\.id\);/,
    "the prepared pack still gets its production workflow");
  assert.match(migration, /ARRAY\['await_purchase','source\.verify'/,
    "await_purchase must lead, so nothing expensive sits ahead of it");
  assert.match(claimant, /"await_purchase", "source\.verify"/);
  // One conductor, not two.
  assert.equal(claimant.match(/create_designpro_production_workflow/g)?.length, 1);
});

test("payment authorizes; the worker advances", () => {
  // The webhook records and returns.
  assert.doesNotMatch(migration, /confirm_designpro_purchase[\s\S]{0,2000}create_designpro_production_workflow/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.reconcile_designpro_purchase_gates/);
  assert.match(claimant, /await reconcilePurchaseGates\(supabase\)/, "the worker loop must run the reconciler");
  // Recoverable: worker down at payment time, or a redelivered webhook.
  assert.match(migration, /s\.stage_key = 'await_purchase'\s*\n\s*AND s\.status = 'waiting'/);
  assert.match(migration, /IF v_row\.id IS NOT NULL THEN[\s\S]{0,200}'idempotent', true/);
});

/* ── what each purchase authorizes ─────────────────────────────────── */

test("case: no purchase — the run waits and nothing is enhanced", () => {
  const none = manifestFor([]);
  assert.deepEqual(none.upscale, []);
  assert.deepEqual(none.output, []);
  assert.deepEqual(none.delivery, []);
  assert.equal(none.productionPackAuthorized, false);
  assert.equal(none.logoPackAuthorized, false);
  assert.match(claimant, /request_designpro_purchase_gate/, "an unpaid run parks rather than proceeding");
});

test("case: Logo Pack only — logos, and no production-panel output", () => {
  const logos = manifestFor(["logo_pack"]);
  assert.deepEqual(logos.upscale, ["logo"]);
  assert.deepEqual(logos.output, [], "PNG/TIFF belong to the Production Pack");
  assert.deepEqual(logos.delivery, ["logo"]);
  assert.equal(logos.productionPackAuthorized, false);
  assert.match(claimant, /if \(!mayUpscale\.has\("panel"\)\)/, "the panel set must be skipped, not failed");
  assert.match(claimant, /skippedUnpurchased: \["output"\]/);
});

test("case: Production Pack only — panels and outputs, no separated-logo delivery", () => {
  const pack = manifestFor(["print_pack_entitlement"]);
  assert.deepEqual(pack.upscale, ["panel", "qc-panel"]);
  assert.deepEqual(pack.output, ["upscaled-panel"]);
  assert.ok(!pack.delivery.includes("logo"), "logos ship only when the Logo Pack was bought");
  assert.ok(pack.delivery.includes("output") && pack.delivery.includes("stamp"));
});

test("case: both — both asset sets, one run, two entitlement identities", () => {
  const both = manifestFor(["logo_pack", "print_pack_entitlement"]);
  assert.deepEqual(both.upscale, ["panel", "qc-panel", "logo"]);
  assert.deepEqual(both.output, ["upscaled-panel"]);
  assert.ok(both.delivery.includes("logo") && both.delivery.includes("output"));
  assert.deepEqual(both.products, ["logo_pack", "print_pack_entitlement"]);
  // Separate rows: one workflow may serve both, the purchases stay distinct.
  assert.match(migration, /designpro_entitlement_run_product_uidx[\s\S]{0,200}\(entice_run_id, product_type\)/);
});

test("expensive stages read the manifest, not storage", () => {
  assert.match(claimant, /const mayUpscale = new Set\(authorized\.upscale \|\| \[\]\)/);
  assert.match(claimant, /if \(!\(authorized\.output \|\| \[\]\)\.length\)/);
  assert.match(claimant, /stageOutput\(sb, run\.id, "await_purchase"\)/);
  assert.match(claimant, /contract: "designpro\.authorized-assets\.v1"/);
});

/* ── boundaries ────────────────────────────────────────────────────── */

test("the gateway proves the payment and holds no service role", () => {
  assert.doesNotMatch(gateway, /SUPABASE_SERVICE_ROLE/);
  assert.match(gateway, /timingSafeEqual/);
  assert.match(gateway, /Math\.abs\(nowSeconds - Number\(timestamp\)\) > 300/);
  assert.match(gateway, /payment_status \|\| ""\) !== "paid"/);
  assert.match(runtime, /app\.post\("\/internal\/purchases\/confirm", authMiddleware/);
  assert.match(migration, /service_role_required/);
  assert.match(migration, /REVOKE INSERT, UPDATE, DELETE ON public\.designpro_purchase_entitlements FROM authenticated, anon/);
});

test("the customer reaches checkout through dpApi, not a legacy function", () => {
  assert.match(card, /source\?: ProductionLayersSource \| null/);
  assert.match(card, /await injected\.onOrderProductionPack!\(\)/);
  const logoHandler = card.slice(card.indexOf("const handleOrderLogoPack"));
  assert.ok(logoHandler.indexOf("if (injected)") < logoHandler.indexOf("create-single-use-checkout"));
});
