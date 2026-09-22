import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const claimant = readFileSync(new URL("../runtime/designpro-standalone-claimant.cjs", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../runtime/index.js", import.meta.url), "utf8");
const gateway = readFileSync(new URL("../gateway/src/server.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260818210000_designpro_purchase_entitlements.sql", import.meta.url), "utf8");
// The promotion-code layer relaxes amount_cents to >= 0 and adds the constraint
// that keeps a free order honest, so the purchase contract now spans two files.
const promoMigration = readFileSync(new URL("../supabase/migrations/20260824050000_designpro_promotion_codes.sql", import.meta.url), "utf8");
// The stage order is redefined by the GENIE-on-order migration, so the CURRENT
// production stage array lives there. Asserting it against the migration that
// introduced the gate would check an array the database has replaced.
const genieOnOrder = readFileSync(new URL("../supabase/migrations/20260824000000_designpro_genie_deploys_on_order.sql", import.meta.url), "utf8");
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
  // `amount_total || metadata.amount_cents` fell back to the LIST PRICE whenever
  // a promotion code brought the charge to zero, so a free pack would have been
  // recorded as a $299 payment that never happened. Zero is a real total.
  assert.doesNotMatch(gateway, /object\.amount_total \|\| metadata\.amount_cents/);
  assert.match(gateway, /object\.amount_total == null\s*\?\s*Number\(metadata\.amount_cents \|\| 0\)\s*:\s*Number\(object\.amount_total\)/,
    "the recorded amount must be what was actually charged, including zero");
  assert.match(gateway, /total_details\?\.amount_discount/);
  // The code itself is resolved from the id an unexpanded webhook carries; see
  // "the promotion code is resolved from the id a real webhook sends" below.
  assert.match(gateway, /resolveStripePromotionCode\(fetchImpl, cfg, object\)/);
});

test("a free order has to name the code that made it free", () => {
  // A fully-discounted purchase is legitimate -- it is how affiliate codes and
  // owner test runs work. What must stay impossible is a zero-value entitlement
  // appearing without the code that explains it, which is what a webhook missing
  // its total would otherwise produce.
  assert.match(gateway, /allow_promotion_codes: true/);
  assert.match(runtime, /body\.amountCents === 0 && !promotionCode/);
  assert.match(runtime, /\(body\.discountCents > 0\) !== Boolean\(promotionCode\)/);
  assert.match(promoMigration, /AND \(amount_cents > 0 OR promotion_code IS NOT NULL\)/);
  assert.match(promoMigration, /AND \(discount_cents = 0\) = \(promotion_code IS NULL\)/);
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
  // await_purchase leads, then GENIE. manifest.resolve used to sit in the FREE
  // entice run, where it parked every job before a proof or a panel existed;
  // resolving true production geometry is paid work and belongs behind the gate.
  assert.match(genieOnOrder, /ARRAY\['await_purchase','manifest\.resolve','source\.verify'/,
    "await_purchase must lead and GENIE must sit behind it");
  assert.match(claimant, /"await_purchase", "manifest\.resolve", "source\.verify"/);
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
  assert.match(claimant, /stageOutput\(sb, runId, "await_purchase"\)/);
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
  // This used to assert the ORDER of two branches -- the injected checkout
  // first, the legacy edge function after it. Ordering was the wrong property
  // to hold: a fallback that is merely second is still reachable, and it is the
  // one that runs whenever the injected source is absent for any reason. The
  // legacy branch is gone, so the assertion is now absence.
  assert.match(card, /await injected!?\.onOrderProductionPack!\(\)/);
  assert.match(card, /await injected\.onOrderLogoPack\(\)/);
  assert.doesNotMatch(card, /create-single-use-checkout/);
  assert.doesNotMatch(card, /submitProductionPack/);
  assert.doesNotMatch(card, /from "@\/lib\/designpro-file-output"/);
});


/* ── the manifest governs the ENTIRE back half ─────────────────────── */

test("every downstream stage consumes the one frozen manifest", () => {
  // Seven readers: upscale, output.build, output.verify, both QC gates, stamp,
  // zip, delivery. One authority, not seven product checks.
  assert.ok(claimant.includes("async function readAuthorizedAssets(sb, runId)"));
  assert.ok(claimant.match(/readAuthorizedAssets\(sb, run\.id\)/g).length >= 7,
    "each paid stage must read the manifest rather than re-deriving what was bought");
  for (const stage of ["enhance.upscale", "output.build", "output.verify", "stamp.build", "zip.build", "wrapbox.deliver"]) {
    assert.ok(claimant.includes(`stage.stage_key === "${stage}"`), `${stage} must still exist`);
  }
});

test("QC is product-aware, so a logo-only purchase cannot deadlock a panel gate", () => {
  const gate = claimant.slice(claimant.indexOf('stage.stage_key === "await_panelpro_preflight_qc"'));
  const body = gate.slice(0, gate.indexOf('stage.stage_key === "enhance.upscale"'));
  assert.match(body, /qcScope: authorized\.qcScope/);
  assert.match(body, /productionPackAuthorized: authorized\.productionPackAuthorized/);
  assert.match(body, /logoPackAuthorized: authorized\.logoPackAuthorized/);
  // One gate, scoped -- not a second QC pipeline.
  assert.equal(claimant.match(/request_designpro_human_gate/g).length, 1);
});

test("QC scope per purchase state", () => {
  assert.deepEqual(manifestFor([]).qcScope, []);
  assert.deepEqual(manifestFor(["logo_pack"]).qcScope, ["logo-assets"]);
  assert.deepEqual(manifestFor(["print_pack_entitlement"]).qcScope, ["production-panels"]);
  assert.deepEqual(manifestFor(["logo_pack", "print_pack_entitlement"]).qcScope,
    ["production-panels", "logo-assets"]);
});

test("output.verify proves the purchased set and only that", () => {
  assert.equal(manifestFor(["print_pack_entitlement"]).requiredOutputFiles, 30,
    "six surfaces times PNG, TIFF, EPS, PDF and JPG");
  assert.deepEqual([...manifestFor(["print_pack_entitlement"]).outputFormats], ["png", "tiff", "eps", "pdf", "jpg"]);
  assert.equal(manifestFor(["logo_pack"]).requiredOutputFiles, 0);
  assert.match(claimant, /if \(!authorized\.requiredOutputFiles\) \{/);
  assert.match(claimant, /output_unpurchased_present/,
    "outputs on a run that did not buy them is a fault, not something to verify");
  assert.match(claimant, /exactSurfaceFormatCount: authorized\.requiredOutputFiles/);
});

test("new paid builds require PDF while immutable completed legacy builds stay readable", () => {
  const current = manifestFor(["print_pack_entitlement"]);
  const legacy = { ...current, requiredOutputFiles: 18 };
  delete legacy.outputFormatContract;
  delete legacy.outputFormats;
  const built = { verified: true, outputCount: 18, outputSetHash: "a".repeat(64) };
  assert.equal(_test.authorizedOutputFormats(legacy, built).requiredOutputFiles, 18);
  assert.throws(() => _test.authorizedOutputFormats(current, built), /immutable completed build receipt/);
  const upgraded = { ...built, outputCount: 24, outputFormatContract: "designpro.production-formats.v2", outputFormats: ["png", "tiff", "eps", "pdf"] };
  assert.equal(_test.authorizedOutputFormats(legacy, upgraded).requiredOutputFiles, 24,
    "a pack completed under the v2 contract is verified as the twenty-four it was built as, not as thirty");
  assert.equal(_test.authorizedOutputFormats(legacy, upgraded).outputFormatContract, "designpro.production-formats.v2");
  const withJpg = { ...built, outputCount: 30, outputFormatContract: "designpro.production-formats.v3", outputFormats: ["png", "tiff", "eps", "pdf", "jpg"] };
  assert.equal(_test.authorizedOutputFormats(legacy, withJpg).requiredOutputFiles, 30,
    "a previously purchased but unbuilt run receives the JPG from the new builder");
  assert.throws(() => _test.authorizedOutputFormats(legacy, { ...withJpg, outputCount: 24 }), /immutable completed build receipt/);
  assert.throws(() => _test.authorizedOutputFormats(legacy, { ...withJpg, outputFormatContract: "designpro.production-formats.v9" }), /immutable completed build receipt/);
  assert.throws(() => _test.authorizedOutputFormats(legacy, { ...upgraded, outputCount: 18 }), /immutable completed build receipt/);
  assert.throws(() => _test.authorizedOutputFormats(legacy, { ...built, verified: false }), /immutable completed build receipt/);
  assert.throws(() => _test.authorizedOutputFormats(legacy, { ...built, outputSetHash: null }), /immutable completed build receipt/);
});

test("the certificate names what was actually approved", () => {
  assert.match(claimant, /approvedProducts: authorized\.products/);
  assert.match(claimant, /approvedDeliverables: authorized\.deliverables/);
});

test("the ZIP carries the purchased deliverable and not the other one", () => {
  const pack = manifestFor(["print_pack_entitlement"]);
  const logo = manifestFor(["logo_pack"]);
  assert.deepEqual(pack.zipKinds, ["flat-proof", "panel", "qc-panel", "output", "stamp"]);
  assert.ok(!pack.zipKinds.includes("logo"), "a Production Pack ZIP must not give away the $29 product");
  assert.deepEqual(logo.zipKinds, ["logo", "stamp"]);
  assert.ok(!logo.zipKinds.includes("output"), "a Logo Pack ZIP must not give away the $299 product");
  // The seven approved renders are the Production Pack's design proofs.
  assert.equal(pack.zipIncludesSourceViews, true);
  assert.equal(logo.zipIncludesSourceViews, false);
  assert.match(claimant, /const rows = await artifacts\(sb, run\.id, zipKinds\)/);
  assert.match(claimant, /authorized\.logoPackAuthorized && !counts\.logo/);
});

test("delivery ships only authorized artifacts and keeps the products distinct", () => {
  // THE LEDGER IS STATED; THE PRODUCT IS NOT DELIVERED. This used to pin
  // `authorized.logoPackAuthorized ? await artifacts(...) : []`, which kept the
  // separated logos OUT of the manifest on a Production-Pack-only run. Both
  // readers of the manifest -- `validateManifest` in wrapbox-delivery.cjs and
  // `commit_designpro_wrapbox_pack` -- require the full Call 10 ledger, so on the
  // first run whose brief carried a logo (de0cdc52, five logos, Production Pack
  // only) the reconciler refused with wrapbox_manifest_logo_mismatch and no
  // WrapBox pack row or customer email was ever created. The manifest names the
  // lineage; delivery of the logo BYTES is decided by `zipKinds`, which still
  // carries `logo` only when the Logo Pack was bought (asserted above).
  assert.match(claimant, /const logoRows = await artifacts\(sb, run\.id, \["logo"\]\);/,
    "the WrapBox manifest states the immutable Call 10 ledger regardless of purchase");
  assert.doesNotMatch(claimant, /authorized\.logoPackAuthorized \? await artifacts\(sb, run\.id, \["logo"\]\) : \[\]/,
    "a purchase-scoped ledger makes the publisher refuse every run with a logo");
  assert.match(claimant, /const expectedSourceViews = authorized\.zipIncludesSourceViews \? 7 : 0/);
  assert.match(claimant, /products: authorized\.products, deliverables: authorized\.deliverables/);
  const both = manifestFor(["logo_pack", "print_pack_entitlement"]);
  assert.deepEqual(both.deliverables.map((item) => item.product),
    ["print_pack_entitlement", "logo_pack"],
    "$328 of purchases must not collapse into one ambiguous entitlement");
  assert.equal(manifestFor(["print_pack_entitlement"]).deliverables.length, 1);
});

test("case 7: wrong product or amount fails closed", () => {
  assert.match(runtime, /\["print_pack_entitlement", "logo_pack"\]\.includes\(String\(body\.productType\)\)/);
  assert.match(runtime, /unknown_product_type/);
  assert.match(runtime, /!Number\.isInteger\(body\.amountCents\) \|\| body\.amountCents < 0/);
  assert.match(gateway, /skipped: "not_a_designpro_product"/);
  assert.match(migration, /prepared_pack_not_found/,
    "a payment naming a design with no prepared pack records nothing");
});

// A WEBHOOK DOES NOT CARRY THE CODE, IT CARRIES THE CODE'S ID.
//
// `stripePromotionCode` reads the shapes an EXPANDED session has. A
// `checkout.session.completed` delivery is not expanded: Stripe sends
// `discounts[0].promotion_code` as an ID string (`promo_1Abc...`), so `.code`
// is undefined and the resolved code is null. Combined with the two guards
// above -- which are correct and stay -- that made EVERY discounted order fail
// to record: the 100%-off demo code and the 10%-off affiliate codes alike.
//
// One retrieve closes it, and a failure throws rather than recording a discount
// with no attribution, so Stripe retries instead of the money and the
// entitlement disagreeing.
test("the promotion code is resolved from the id a real webhook sends", () => {
  assert.match(gateway, /async function stripeRetrieve\(fetchImpl, cfg, path\)/);
  assert.match(gateway, /method: "GET"/);
  assert.match(gateway, /async function resolveStripePromotionCode\(fetchImpl, cfg, session\)/);
  assert.match(gateway, /\/\^promo_\[A-Za-z0-9\]\+\$\/\.test\(id\)/,
    "only a real promotion-code id is retrieved, never an arbitrary path segment");
  assert.match(gateway, /promotion_codes\/\$\{encodeURIComponent\(id\)\}/);
  // The webhook must use the resolver, not the unexpanded reader.
  assert.match(gateway, /const promotionCode = await resolveStripePromotionCode\(fetchImpl, cfg, object\);/);
  assert.doesNotMatch(gateway, /const promotionCode = stripePromotionCode\(object\);/,
    "reading the unexpanded session directly is what dropped every discounted order");
});
