/**
 * wpw-inspect-product  (READ-ONLY)
 *
 * Diagnostic helper for debugging WooCommerce product pricing on
 * weprintwraps.com. It does NOT modify anything — it only GETs a
 * product and returns the fields that affect the cart total:
 *
 *   - regular_price / sale_price / price
 *   - type (simple / variable / etc.)
 *   - meta_data (this is where Product Add-Ons, Gravity Forms product
 *     fields, and "extra fee" plugins store their values — a $975 that
 *     stacks on top of a $500 base almost always lives here)
 *   - variations (if the product is variable, each variation's price)
 *
 * Used to diagnose the "Custom Vehicle Wrap Design shows $1,475 in cart"
 * bug, where $975 (old price) + $500 (new price) are both being charged.
 *
 * GET  /wpw-inspect-product?id=234
 * POST { "id": 234 }   (id optional, defaults to 234)
 *
 * Env: WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function authHeader(ck: string, cs: string): string {
  return "Basic " + btoa(`${ck}:${cs}`);
}

async function wcGet(wooBase: string, auth: string, path: string) {
  const res = await fetch(`${wooBase}/wp-json/wc/v3/${path}`, {
    headers: { Authorization: auth },
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { ok: res.ok, status: res.status, json };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body, null, 2), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const wooBase = (Deno.env.get("WOOCOMMERCE_URL") || "https://weprintwraps.com").replace(/\/$/, "");
    const ck = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY");
    const cs = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET");
    if (!ck || !cs) {
      return jsonResponse({ error: "WooCommerce credentials not configured" }, 500);
    }
    const auth = authHeader(ck, cs);

    // Resolve product id from query string or POST body (default 234).
    let id = 234;
    const url = new URL(req.url);
    const qid = url.searchParams.get("id");
    if (qid && /^\d+$/.test(qid)) id = parseInt(qid, 10);
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && typeof body.id === "number") id = body.id;
      } catch {
        /* ignore */
      }
    }

    const product = await wcGet(wooBase, auth, `products/${id}`);
    if (!product.ok) {
      return jsonResponse({ error: "Failed to fetch product", id, detail: product.json }, product.status);
    }

    const p = product.json as Record<string, unknown>;

    // Pull variations too, if it's a variable product — each variation
    // carries its own price that could explain a doubled cart total.
    let variations: unknown = null;
    if (p.type === "variable") {
      const v = await wcGet(wooBase, auth, `products/${id}/variations?per_page=100`);
      variations = v.ok ? v.json : { error: v.status, detail: v.json };
    }

    // Summarize the price-affecting fields up front, then include the
    // raw meta_data so add-on / fee plugin values are fully visible.
    const summary = {
      id: p.id,
      name: p.name,
      sku: p.sku,
      status: p.status,
      type: p.type,
      regular_price: p.regular_price,
      sale_price: p.sale_price,
      price: p.price,
      on_sale: p.on_sale,
      total_sales: p.total_sales,
      permalink: p.permalink,
      // meta_data holds Product Add-Ons / fee-plugin config. This is the
      // most likely home of the orphaned $975.
      meta_data: p.meta_data,
      // price_html sometimes reveals a "from $X" or fee suffix.
      price_html: p.price_html,
    };

    return jsonResponse({
      ok: true,
      diagnostic_for: "Custom Vehicle Wrap Design cart showing $1,475 ($975 + $500)",
      summary,
      variations,
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
