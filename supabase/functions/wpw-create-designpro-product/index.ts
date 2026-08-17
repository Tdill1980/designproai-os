/**
 * wpw-create-designpro-product
 *
 * Creates the new DesignPro Custom Wrap Design product on WePrintWraps.com
 * via the WooCommerce REST API.
 *
 * Product: $25, simple product, status=draft.
 * Includes 3 revisions + 3D design proof, described in product copy.
 *
 * Idempotent: if a product with the same SKU already exists, returns the
 * existing product ID instead of creating a duplicate.
 *
 * POST body (all optional):
 *   { status?: "draft" | "publish", dryRun?: boolean }
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRODUCT_SKU = "DESIGNPRO-CUSTOM-WRAP-25";

const PRODUCT_NAME = "DesignPro™ Custom Wrap Design — $25";

// Where buyers go to start designing after purchase.
const DESIGNPRO_URL = "https://www.restyleproai.com/designpro";

const SHORT_DESCRIPTION = `
<p><strong>Pro-grade custom vehicle wrap design for just $25.</strong> Designed in RestyleProAI's DesignPro tool — includes a 7-angle proof and a photorealistic 3D proof, with up to 3 revisions, so you can approve with confidence before you print.</p>
<ul>
  <li>✅ 1 custom design tailored to your vehicle</li>
  <li>✅ 3 revisions</li>
  <li>✅ 7-angle proof</li>
  <li>✅ 1 photorealistic 3D proof</li>
</ul>
<p><a href="${DESIGNPRO_URL}">Start your design in DesignPro →</a></p>
`.trim();

const LONG_DESCRIPTION = `
<h2>DesignPro™ Custom Wrap Design — $25</h2>
<p>DesignPro is the fastest way to get a professional custom vehicle wrap design without the agency price tag. For just <strong>$25</strong>, you create an original concept in <strong>RestyleProAI's DesignPro</strong> tool tailored to your vehicle, your brand, and your goals — then receive a full 7-angle proof and a photorealistic 3D proof so you can see exactly how it will look before you print.</p>

<h3>What's included</h3>
<ul>
  <li><strong>1 custom design</strong> created for your specific vehicle make and model</li>
  <li><strong>3 revisions</strong> — refine colors, layout, and graphics until you're approved</li>
  <li><strong>7-angle proof</strong> showing your design from all seven canonical vehicle views</li>
  <li><strong>1 photorealistic 3D proof</strong> rendered on your vehicle so you can see real depth, lighting, and panel layout</li>
</ul>

<h3>How it works</h3>
<ol>
  <li><strong>Order —</strong> Add DesignPro to your cart, then head to RestyleProAI's DesignPro tool to start.</li>
  <li><strong>Design —</strong> Create your original concept in DesignPro and receive your 7-angle and photorealistic 3D proofs.</li>
  <li><strong>Refine —</strong> Request up to 3 rounds of revisions until the design is exactly right.</li>
  <li><strong>Approve & print —</strong> Approve the final proof. Add a Production Pack to receive print-ready files, or send it straight to production with WePrintWraps.</li>
</ol>

<h3>Why DesignPro</h3>
<p>Traditional custom wrap design runs $500–$2,000 and takes weeks. DesignPro delivers the same caliber of original creative for <strong>$25</strong>, with a 7-angle proof and a photorealistic 3D proof so you never approve blind. It's the lowest-risk way to see your wrap before you commit.</p>

<p><strong>Ready to design?</strong> <a href="${DESIGNPRO_URL}">Open DesignPro on RestyleProAI →</a></p>

<p><em>Need print-ready files? Add a Production Pack — our real graphic-design team outputs template-correct, QC-checked print files you own.</em></p>
`.trim();

interface CreateOptions {
  status?: "draft" | "publish";
  dryRun?: boolean;
}

interface WooProduct {
  id: number;
  name: string;
  sku: string;
  status: string;
  permalink: string;
  price: string;
  regular_price: string;
}

function getAuthHeader(consumerKey: string, consumerSecret: string): string {
  return "Basic " + btoa(`${consumerKey}:${consumerSecret}`);
}

async function findExistingBySku(
  wooBase: string,
  auth: string,
  sku: string,
): Promise<WooProduct | null> {
  const url = `${wooBase}/wp-json/wc/v3/products?sku=${encodeURIComponent(sku)}`;
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) return null;
  const products = await res.json() as WooProduct[];
  return products.length > 0 ? products[0] : null;
}

async function createProduct(
  wooBase: string,
  auth: string,
  status: "draft" | "publish",
): Promise<WooProduct> {
  const payload = {
    name: PRODUCT_NAME,
    type: "simple",
    status,
    catalog_visibility: "visible",
    sku: PRODUCT_SKU,
    regular_price: "25.00",
    description: LONG_DESCRIPTION,
    short_description: SHORT_DESCRIPTION,
    virtual: true,
    downloadable: false,
    manage_stock: false,
    sold_individually: false,
    tax_status: "taxable",
    categories: [
      { name: "Design Services" },
    ],
    tags: [
      { name: "DesignPro" },
      { name: "Custom Wrap Design" },
      { name: "3D Proof" },
    ],
    meta_data: [
      { key: "_designpro_revisions_included", value: "3" },
      { key: "_designpro_includes_3d_proof", value: "yes" },
      { key: "_designpro_includes_7angle_proof", value: "yes" },
      { key: "_designpro_designpro_url", value: DESIGNPRO_URL },
      { key: "_designpro_source", value: "restylepro-os" },
    ],
  };

  const res = await fetch(`${wooBase}/wp-json/wc/v3/products`, {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Woo product create failed: ${res.status} ${errorText}`);
  }

  return await res.json() as WooProduct;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const wooBase = (Deno.env.get("WOOCOMMERCE_URL") || "https://weprintwraps.com").replace(/\/$/, "");
    const consumerKey = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY");
    const consumerSecret = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET");

    if (!consumerKey || !consumerSecret) {
      return new Response(
        JSON.stringify({ error: "WooCommerce credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let body: CreateOptions = {};
    if (req.method === "POST") {
      try {
        body = await req.json() as CreateOptions;
      } catch {
        body = {};
      }
    }

    const status = body.status === "publish" ? "publish" : "draft";
    const dryRun = body.dryRun === true;
    const auth = getAuthHeader(consumerKey, consumerSecret);

    const existing = await findExistingBySku(wooBase, auth, PRODUCT_SKU);
    if (existing) {
      return new Response(
        JSON.stringify({
          ok: true,
          action: "exists",
          message: "Product with this SKU already exists. Skipping create.",
          product: {
            id: existing.id,
            sku: existing.sku,
            name: existing.name,
            status: existing.status,
            permalink: existing.permalink,
            price: existing.price,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (dryRun) {
      return new Response(
        JSON.stringify({
          ok: true,
          action: "dry_run",
          message: "No existing SKU found. dryRun=true so nothing was created.",
          wouldCreate: {
            sku: PRODUCT_SKU,
            name: PRODUCT_NAME,
            regular_price: "25.00",
            status,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const created = await createProduct(wooBase, auth, status);

    return new Response(
      JSON.stringify({
        ok: true,
        action: "created",
        message: `DesignPro product created on WePrintWraps.com as ${status}.`,
        product: {
          id: created.id,
          sku: created.sku,
          name: created.name,
          status: created.status,
          permalink: created.permalink,
          price: created.price,
          regular_price: created.regular_price,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[wpw-create-designpro-product]", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
