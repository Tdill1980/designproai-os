/**
 * wpw-sync-wpw-products
 *
 * Idempotently creates / updates the WePrintWraps.com WooCommerce products
 * that pair with RestyleProAI's DesignPro flow:
 *
 *   1. Production Pack — $299 (real-team output, template-correct print files,
 *      QC checked, production-ready panels, customer owns print files).
 *   2. RestyleProAI subscription products — the four live /pricing-page tiers
 *      at the WPW partner rate ($50/mo off). EXTERNAL products published so
 *      they appear on WPW; the buy button deep-links into RestyleProAI's
 *      Stripe checkout (?priceId=<wpw price>) — billing runs through
 *      RestyleProAI, not WooCommerce.
 *   3. Price drop: existing Custom Vehicle Wrap Design (Woo product 234)
 *      lowered from $975 → $500.
 *
 * Upsert by SKU: existing SKUs are updated in place (so re-running repairs
 * earlier drafts); new SKUs created. Deprecated subscription SKUs from an
 * earlier guessed-tier pass are trashed.
 *
 * POST body (all optional):
 *   { status?: "draft" | "publish", dryRun?: boolean }
 *
 * Env: WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Where buyers go to start / manage their work after purchase.
const DESIGNPRO_URL = "https://www.restyleproai.com/designpro";
const PRICING_URL = "https://www.restyleproai.com/pricing";
// RestyleProAI pay-first checkout. The no-auth create-wpw-sub-checkout
// edge function GET-redirects straight into Stripe at the WPW partner
// price — no signup wall. The account is provisioned post-payment by
// stripe-webhook (purchase_type=wpw_subscription).
const CHECKOUT_URL =
  "https://kfapjdyythzyvnpdeghu.supabase.co/functions/v1/create-wpw-sub-checkout";

// Existing Custom Vehicle Wrap Design product on weprintwraps.com.
const CUSTOM_WRAP_WOO_ID = 234;
const CUSTOM_WRAP_NEW_PRICE = "500.00";

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  status: string;
  permalink: string;
  price: string;
  regular_price: string;
}

interface ProductSpec {
  sku: string;
  name: string;
  regular_price: string;
  short_description: string;
  description: string;
  categories: { name: string }[];
  tags: { name: string }[];
  meta_data: { key: string; value: string }[];
  /** "simple" (default) or "external" — external products link out to
   *  RestyleProAI for checkout instead of adding to the Woo cart. */
  type?: "simple" | "external";
  /** For external products: the off-site checkout URL. */
  external_url?: string;
  /** For external products: the buy-button label. */
  button_text?: string;
  /** Per-product publish state. Overrides the request-level status. */
  status?: "draft" | "publish";
}

// Old subscription SKUs from an earlier draft pass that used guessed tier
// names/prices. They're replaced by the real pricing-page tiers below, so
// trash them on sync to avoid duplicate/misleading listings.
const DEPRECATED_SUB_SKUS = ["WPW-RP-SUB-PRO", "WPW-RP-SUB-DESIGNPRO"];

const PRODUCTION_PACK: ProductSpec = {
  sku: "WPW-PRODUCTION-PACK-299",
  status: "publish",
  name: "Production Pack — $299",
  regular_price: "299.00",
  short_description: `
<p><strong>Turn your approved DesignPro proof into real, print-ready files.</strong> Our graphic-design team outputs your design on the correct vehicle templates, QC-checks every panel, and hands you production-ready files you own.</p>
<ul>
  <li>✅ Output by a real graphic-design team</li>
  <li>✅ Template-correct print files</li>
  <li>✅ QC checked</li>
  <li>✅ Production-ready panels</li>
  <li>✅ You own the print files</li>
</ul>
`.trim(),
  description: `
<h2>Production Pack — $299</h2>
<p>Designed your wrap in <strong>RestyleProAI's DesignPro</strong>? The Production Pack is how you take an approved proof to print. A real graphic-design team rebuilds your design on the exact vehicle templates, runs a full quality-control pass, and delivers production-ready panels — and the print files are yours to keep.</p>

<h3>What's included</h3>
<ul>
  <li><strong>Output by a real graphic-design team</strong> — not an automated export. A human builds your final production art.</li>
  <li><strong>Template-correct print files</strong> sized and laid out to the correct vehicle templates.</li>
  <li><strong>QC checked</strong> — every panel reviewed for bleed, alignment, color, and resolution before release.</li>
  <li><strong>Production-ready panels</strong> ready to send to any printer.</li>
  <li><strong>You own the print files</strong> — print with WePrintWraps or take them anywhere.</li>
</ul>

<p><strong>Start with a design first:</strong> <a href="${DESIGNPRO_URL}">Open DesignPro on RestyleProAI →</a></p>
`.trim(),
  categories: [{ name: "Design Services" }],
  tags: [{ name: "Production Pack" }, { name: "Print Ready" }, { name: "DesignPro" }],
  meta_data: [
    { key: "_wpw_production_pack", value: "yes" },
    { key: "_wpw_customer_owns_files", value: "yes" },
    { key: "_wpw_designpro_url", value: DESIGNPRO_URL },
    { key: "_wpw_source", value: "restylepro-os" },
  ],
};

// $25 AI custom wrap design (DesignPro). External product: billed by
// RestyleProAI via /try-design (Stripe guest checkout, no signup wall),
// then a magic link delivers 3 design credits. Distinct from the $500
// full custom-design service (Woo product 234).
const CUSTOM_DESIGN_25: ProductSpec = {
  sku: "WPW-RP-CUSTOM-DESIGN-25",
  type: "external",
  external_url: "https://www.restyleproai.com/try-design?ref=wpw",
  button_text: "Buy Custom Wrap Design",
  status: "publish",
  name: "Custom Wrap Design — $250",
  regular_price: "250.00",
  short_description: `
<p><strong>One custom full vehicle wrap design — $250.</strong> You design it yourself in <strong>DesignPro by RestyleProAI</strong> — prompt-based design software. Describe the wrap you want and get a finished custom full wrap design in under 5 minutes.</p>
<p><strong>A $500–$975 custom design — yours for $250.</strong></p>
<ul>
  <li>✅ One custom full wrap design — a $500+ value</li>
  <li>✅ Includes 3 revisions</li>
  <li>✅ 7 view angles + a 3D proof</li>
  <li>✅ Prompt-based — finished design in under 5 minutes</li>
</ul>
`.trim(),
  description: `
<h2>Custom Wrap Design — $250</h2>
<p>Design <strong>one custom full vehicle wrap</strong> yourself in <strong>DesignPro by RestyleProAI</strong> — prompt-based design software. Describe the wrap you want and DesignPro generates a finished custom full wrap design in under 5 minutes. No design skills needed.</p>
<p><strong>The value:</strong> a custom full wrap design from a designer normally runs <strong>$500–$975</strong> (see our Custom Vehicle Wrap Design service). With DesignPro you get the same custom full wrap design for <strong>$250</strong>.</p>
<ul>
  <li><strong>You design it in DesignPro</strong> — simply prompt it</li>
  <li><strong>3 revisions included</strong> to dial it in</li>
  <li><strong>7 view angles</strong> and a <strong>3D proof</strong></li>
  <li><strong>Under 5 minutes</strong> from prompt to finished design</li>
</ul>
<p>One-time $250. No subscription, no recurring charges.</p>
`.trim(),
  categories: [{ name: "Design Services" }],
  tags: [{ name: "RestyleProAI" }, { name: "DesignPro" }, { name: "Custom Design" }],
  meta_data: [
    { key: "_rp_billing", value: "restyleproai-stripe-onetime" },
    { key: "_rp_try_design_url", value: "https://www.restyleproai.com/try-design?ref=wpw" },
    { key: "_wpw_source", value: "restylepro-os" },
  ],
};

interface SubTier {
  sku: string;
  label: string;
  publicPrice: number;
  wpwPrice: number;
  /** RestyleProAI WPW-partner Stripe price ID (recurring monthly). */
  priceId: string;
  tagline: string;
}

// Live RestyleProAI pricing-page tiers and their existing WPW-partner
// Stripe prices ($50/mo off each public price). These are real, active
// recurring Stripe prices — the source of truth is the /pricing page.
const WPW_SUB_DISCOUNT = 50;
const SUB_TIERS: SubTier[] = [
  { sku: "WPW-RP-SUB-STARTER",          label: "Starter",          publicPrice: 350, wpwPrice: 300, priceId: "price_1TTTzhH1V6OhfCAP8VEk52tv", tagline: "ColorPro color-change visualizer + AI renders" },
  { sku: "WPW-RP-SUB-DESIGNPRO-LITE",   label: "DesignPro Lite",   publicPrice: 499, wpwPrice: 449, priceId: "price_1TTUyvH1V6OhfCAPddCu27xk", tagline: "AI wrap design + renders" },
  { sku: "WPW-RP-SUB-DESIGNPRO-STUDIO", label: "DesignPro Studio", publicPrice: 699, wpwPrice: 649, priceId: "price_1TTTzoH1V6OhfCAPqcDURY6T", tagline: "Full design suite + real human designer" },
  { sku: "WPW-RP-SUB-DESIGNPRO-PLUS",   label: "DesignPro Plus",   publicPrice: 995, wpwPrice: 945, priceId: "price_1TTTzuH1V6OhfCAP9zEqAlBh", tagline: "Top-tier suite + agency features" },
];

function buildSubscriptionSpec(tier: SubTier): ProductSpec {
  const wpwPrice = tier.wpwPrice;
  // External product: the recurring subscription is billed by RestyleProAI
  // (Stripe), NOT WooCommerce. The buy button deep-links into RestyleProAI's
  // Stripe checkout at the WPW partner price for this exact tier.
  const subscribeUrl = `${CHECKOUT_URL}?priceId=${tier.priceId}&ref=wpw`;
  return {
    sku: tier.sku,
    type: "external",
    external_url: subscribeUrl,
    button_text: "Subscribe on RestyleProAI",
    status: "publish",
    name: `RestyleProAI ${tier.label} — WPW Partner Rate ($${wpwPrice}/mo)`,
    regular_price: `${wpwPrice}.00`,
    short_description: `
<p><strong>RestyleProAI ${tier.label} subscription at the WePrintWraps partner rate — $${wpwPrice}/mo (save $${WPW_SUB_DISCOUNT}/mo off the $${tier.publicPrice} public price).</strong></p>
<p>${tier.tagline}. AI wrap design + renders with a real human designer on output.</p>
<p><strong>Billed securely through RestyleProAI</strong> — tap "Subscribe on RestyleProAI" to start.</p>
`.trim(),
    description: `
<h2>RestyleProAI ${tier.label} — WePrintWraps Partner Rate</h2>
<p>As a WePrintWraps customer you get RestyleProAI's <strong>${tier.label}</strong> plan for <strong>$${wpwPrice}/mo</strong> — that's <strong>$${WPW_SUB_DISCOUNT}/mo off</strong> the $${tier.publicPrice} public price.</p>
<p>${tier.tagline}. Design wraps with DesignPro AI, iterate with revisions, and have a real RestylePro graphic-design team sign off on your output.</p>
<p><strong>This is a monthly subscription billed by RestyleProAI</strong> (not WePrintWraps). Tapping subscribe takes you to RestyleProAI, where your recurring plan is set up and managed:</p>
<p><a href="${subscribeUrl}">Subscribe on RestyleProAI →</a></p>
<p><a href="${DESIGNPRO_URL}">Or explore DesignPro first →</a></p>
`.trim(),
    categories: [{ name: "Design Services" }],
    tags: [{ name: "RestyleProAI" }, { name: "Subscription" }, { name: tier.label }],
    meta_data: [
      { key: "_rp_subscription_tier", value: tier.label },
      { key: "_rp_public_price", value: String(tier.publicPrice) },
      { key: "_rp_wpw_discount", value: String(WPW_SUB_DISCOUNT) },
      { key: "_rp_billing", value: "restyleproai-stripe-monthly" },
      { key: "_rp_stripe_price_id", value: tier.priceId },
      { key: "_rp_subscribe_url", value: subscribeUrl },
      { key: "_wpw_source", value: "restylepro-os" },
    ],
  };
}

function authHeader(ck: string, cs: string): string {
  return "Basic " + btoa(`${ck}:${cs}`);
}

async function findBySku(wooBase: string, auth: string, sku: string): Promise<WooProduct | null> {
  const res = await fetch(`${wooBase}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) return null;
  const products = (await res.json()) as WooProduct[];
  return products.length > 0 ? products[0] : null;
}

function buildPayload(spec: ProductSpec, status: "draft" | "publish") {
  const type = spec.type ?? "simple";
  const payload: Record<string, unknown> = {
    name: spec.name,
    type,
    status: spec.status ?? status,
    catalog_visibility: "visible",
    sku: spec.sku,
    regular_price: spec.regular_price,
    description: spec.description,
    short_description: spec.short_description,
    virtual: true,
    downloadable: false,
    manage_stock: false,
    sold_individually: false,
    tax_status: "taxable",
    categories: spec.categories,
    tags: spec.tags,
    meta_data: spec.meta_data,
  };
  if (type === "external") {
    payload.external_url = spec.external_url ?? "";
    payload.button_text = spec.button_text ?? "Buy";
  }
  return payload;
}

async function createProduct(
  wooBase: string,
  auth: string,
  spec: ProductSpec,
  status: "draft" | "publish",
): Promise<WooProduct> {
  const res = await fetch(`${wooBase}/wp-json/wc/v3/products`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(buildPayload(spec, status)),
  });
  if (!res.ok) {
    throw new Error(`create ${spec.sku} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as WooProduct;
}

async function updateProduct(
  wooBase: string,
  auth: string,
  productId: number,
  spec: ProductSpec,
  status: "draft" | "publish",
): Promise<WooProduct> {
  // If the spec pins a status (e.g. subscriptions → publish), honor it.
  // Otherwise preserve the product's existing publish state on update.
  const payload = buildPayload(spec, status);
  if (!spec.status) delete (payload as Record<string, unknown>).status;
  const res = await fetch(`${wooBase}/wp-json/wc/v3/products/${productId}`, {
    method: "PUT",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`update ${spec.sku} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as WooProduct;
}

async function updatePrice(
  wooBase: string,
  auth: string,
  productId: number,
  regularPrice: string,
): Promise<WooProduct> {
  const res = await fetch(`${wooBase}/wp-json/wc/v3/products/${productId}`, {
    method: "PUT",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ regular_price: regularPrice }),
  });
  if (!res.ok) {
    throw new Error(`update price for ${productId} failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as WooProduct;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const wooBase = (Deno.env.get("WOOCOMMERCE_URL") || "https://weprintwraps.com").replace(/\/$/, "");
    const ck = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY");
    const cs = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET");
    if (!ck || !cs) {
      return new Response(
        JSON.stringify({ error: "WooCommerce credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: { status?: "draft" | "publish"; dryRun?: boolean; onlySku?: string } = {};
    if (req.method === "POST") {
      try {
        body = await req.json();
      } catch {
        body = {};
      }
    }
    const status = body.status === "publish" ? "publish" : "draft";
    const dryRun = body.dryRun === true;
    // Optional surgical mode: sync ONLY one product by SKU, leaving every
    // other live product (and the deprecated-trash sweep) untouched. Used
    // for one-off price changes without risking collisions with manual edits.
    const onlySku = typeof body.onlySku === "string" ? body.onlySku.trim() : "";
    const auth = authHeader(ck, cs);

    const allSpecs: ProductSpec[] = [PRODUCTION_PACK, CUSTOM_DESIGN_25, ...SUB_TIERS.map(buildSubscriptionSpec)];
    const specs: ProductSpec[] = onlySku ? allSpecs.filter((s) => s.sku === onlySku) : allSpecs;
    const results: Record<string, unknown>[] = [];

    // 1 + 2: upsert products by SKU (update existing in place so re-running
    // repairs any earlier drafts; create if the SKU is new).
    for (const spec of specs) {
      const existing = await findBySku(wooBase, auth, spec.sku);
      if (dryRun) {
        results.push({
          sku: spec.sku,
          action: existing ? "would_update" : "would_create",
          id: existing?.id,
          name: spec.name,
          type: spec.type ?? "simple",
          regular_price: spec.regular_price,
          status: existing ? existing.status : status,
        });
        continue;
      }
      const result = existing
        ? await updateProduct(wooBase, auth, existing.id, spec, status)
        : await createProduct(wooBase, auth, spec, status);
      results.push({
        sku: spec.sku,
        action: existing ? "updated" : "created",
        id: result.id,
        name: result.name,
        status: result.status,
        price: result.price,
        permalink: result.permalink,
      });
    }

    // 2b: trash deprecated subscription drafts from the earlier guessed-tier
    // pass so they don't linger as duplicate listings. Skipped in onlySku
    // mode so a targeted price change never touches other listings.
    for (const sku of onlySku ? [] : DEPRECATED_SUB_SKUS) {
      const stale = await findBySku(wooBase, auth, sku);
      if (!stale) continue;
      if (dryRun) {
        results.push({ sku, action: "would_trash", id: stale.id });
        continue;
      }
      await fetch(`${wooBase}/wp-json/wc/v3/products/${stale.id}`, {
        method: "DELETE",
        headers: { Authorization: auth, "Content-Type": "application/json" },
      });
      results.push({ sku, action: "trashed", id: stale.id });
    }

    // 3: drop the existing Custom Vehicle Wrap Design to $500. Skipped in
    // onlySku mode so a targeted sync never touches product 234.
    if (!onlySku) {
      if (dryRun) {
        results.push({ sku: "WOO-234", action: "would_update_price", id: CUSTOM_WRAP_WOO_ID, regular_price: CUSTOM_WRAP_NEW_PRICE });
      } else {
        const updated = await updatePrice(wooBase, auth, CUSTOM_WRAP_WOO_ID, CUSTOM_WRAP_NEW_PRICE);
        results.push({
          sku: "WOO-234",
          action: "price_updated",
          id: updated.id,
          name: updated.name,
          regular_price: updated.regular_price,
          price: updated.price,
        });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, dryRun, status, results }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[wpw-sync-wpw-products]", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
