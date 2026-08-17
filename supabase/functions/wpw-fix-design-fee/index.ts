/**
 * wpw-fix-design-fee
 *
 * One-shot, self-diagnosing fix for the "Custom Vehicle Wrap Design"
 * product (Woo id 234) on weprintwraps.com showing $1,475 in the cart
 * instead of $500.
 *
 * Root cause family: the WooCommerce base price was lowered to $500, but
 * a legacy $975 design fee still lives in a "Themecomplete / TM Extra
 * Product Options" form field (meta key `tm_meta`). With both active the
 * cart charges base ($500) + form field ($975) = $1,475.
 *
 * The FIRST fix only flipped `tmfbuilder.textfield_price`. If the 975
 * actually lives in a different field type (select / radio / checkbox /
 * a second text field) it was never touched — which is why the cart can
 * still read $1,475. This version DEEP-SCANS the entire Extra Product
 * Options structure and zeroes every priced entry equal to 975, across
 * ALL field types, then writes the whole tm_meta back and re-reads to
 * confirm.
 *
 * Browser-friendly (Trish can just paste a URL):
 *   GET  /wpw-fix-design-fee?id=234            → DRY RUN diagnostic only
 *   GET  /wpw-fix-design-fee?id=234&apply=1    → APPLY the fix
 *   POST { "id": 234, "dryRun": true }         → dry run
 *   POST { "id": 234 }                          → apply
 *
 * It always returns:
 *   - the base price (regular/sale/price/price_html)
 *   - EVERY JSON path inside tm_meta where "975" appears
 *   - which priced entries were (or would be) zeroed
 *   - after applying, the re-read live price
 *
 * Env: WOOCOMMERCE_URL, WOOCOMMERCE_CONSUMER_KEY, WOOCOMMERCE_CONSUMER_SECRET
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const OLD_FEE = "975";
const NEW_FEE = "0";

function authHeader(ck: string, cs: string): string {
  return "Basic " + btoa(`${ck}:${cs}`);
}

async function wc(
  wooBase: string,
  auth: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; json: any }> {
  const res = await fetch(`${wooBase}/wp-json/wc/v3/${path}`, {
    ...init,
    headers: { Authorization: auth, "Content-Type": "application/json", ...(init?.headers || {}) },
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

/**
 * Walk any nested value and record every location where `OLD_FEE` (975)
 * appears, as a dotted/indexed path. Used purely for diagnostics so we
 * can SEE where the fee is hiding even if it's not in a *_price key.
 */
function findFee(value: unknown, path: string, hits: string[]): void {
  if (value == null) return;
  if (typeof value === "string" || typeof value === "number") {
    if (String(value) === OLD_FEE) hits.push(path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => findFee(v, `${path}[${i}]`, hits));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      findFee(v, path ? `${path}.${k}` : k, hits);
    }
  }
}

/**
 * Zero every priced entry equal to OLD_FEE anywhere in the tmfbuilder
 * object. A "priced entry" is any array under a key ending in `_price`
 * (that's how TM Extra Product Options stores per-field prices for every
 * field type: textfield_price, select_price, radio_price, checkbox_price,
 * etc.). Returns the list of changes made.
 */
function zeroAllFeePrices(
  builder: Record<string, any>,
  changes: { key: string; index: number; from: string; to: string }[],
): void {
  for (const [key, arr] of Object.entries(builder)) {
    if (!key.endsWith("_price") || !Array.isArray(arr)) continue;
    arr.forEach((p: unknown, i: number) => {
      if (String(p) === OLD_FEE) {
        changes.push({ key, index: i, from: String(p), to: NEW_FEE });
        arr[i] = NEW_FEE;
      }
    });
  }
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

    // Resolve id + apply flag from query string (browser) or POST body.
    let id = 234;
    let apply = false;
    const url = new URL(req.url);
    const qid = url.searchParams.get("id");
    if (qid && /^\d+$/.test(qid)) id = parseInt(qid, 10);
    const qApply = url.searchParams.get("apply");
    if (qApply === "1" || qApply === "true") apply = true;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        if (body && typeof body.id === "number") id = body.id;
        // POST applies by default unless dryRun:true is sent.
        apply = body?.dryRun === true ? false : true;
      } catch {
        /* GET-style empty POST → leave apply as query-derived */
      }
    }

    // 1. Read current product.
    const get = await wc(wooBase, auth, `products/${id}`);
    if (!get.ok) {
      return jsonResponse({ error: "Failed to fetch product", id, detail: get.json }, get.status);
    }
    const product = get.json as Record<string, any>;
    const metaArr: any[] = Array.isArray(product.meta_data) ? product.meta_data : [];

    const basePrice = {
      regular_price: product.regular_price,
      sale_price: product.sale_price,
      price: product.price,
      price_html: product.price_html,
      type: product.type,
    };

    // 2. Locate the tm_meta entry (Extra Product Options).
    const tmMetaEntry = metaArr.find((m) => m && m.key === "tm_meta");

    // Diagnostic: where does 975 appear ANYWHERE on the product?
    const feeLocationsProduct: string[] = [];
    findFee(product.meta_data, "meta_data", feeLocationsProduct);
    if (String(product.regular_price) === OLD_FEE) feeLocationsProduct.push("regular_price");
    if (String(product.sale_price) === OLD_FEE) feeLocationsProduct.push("sale_price");

    if (!tmMetaEntry) {
      return jsonResponse(
        {
          ok: false,
          note:
            "No tm_meta (Extra Product Options) on this product. The 975 is NOT in a form field — check the locations below and the base price.",
          id,
          base_price: basePrice,
          fee_975_locations: feeLocationsProduct,
        },
        200,
      );
    }

    const builder = tmMetaEntry.value?.tmfbuilder;
    const feeLocationsBuilder: string[] = [];
    findFee(tmMetaEntry.value, "tm_meta", feeLocationsBuilder);

    if (!builder || typeof builder !== "object") {
      return jsonResponse(
        {
          ok: false,
          note: "tm_meta exists but tmfbuilder structure is missing/changed; aborting to be safe.",
          id,
          base_price: basePrice,
          fee_975_locations: feeLocationsBuilder,
          tm_meta_value: tmMetaEntry.value,
        },
        200,
      );
    }

    // 3. Plan: zero every *_price entry equal to 975 across ALL field types.
    const changes: { key: string; index: number; from: string; to: string }[] = [];
    zeroAllFeePrices(builder, changes);

    const plan = {
      id,
      product_name: product.name,
      base_price: basePrice,
      fee_975_locations_in_options: feeLocationsBuilder,
      priced_fields_zeroed: changes,
      will_change: changes.length > 0,
      expected_cart_total_after: `$${product.regular_price} (base) + $0 (form fields) = $${product.regular_price}`,
    };

    if (changes.length === 0) {
      return jsonResponse({
        ok: true,
        applied: false,
        note:
          feeLocationsBuilder.length > 0
            ? "Found 975 in the options structure but NOT in a priced (*_price) field — it's likely a label/default-value, not a charge. See fee_975_locations_in_options. The cart charge is elsewhere; check base_price."
            : "No priced field equal to 975 found in the options — already fixed, or the 975 charge lives outside Extra Product Options (check base_price).",
        plan,
      });
    }

    if (!apply) {
      return jsonResponse({
        ok: true,
        applied: false,
        dryRun: true,
        note: "DRY RUN — nothing written. Re-run with &apply=1 to apply.",
        plan,
      });
    }

    // 4. Apply: write back the WHOLE tm_meta entry (by id) with prices zeroed.
    const put = await wc(wooBase, auth, `products/${id}`, {
      method: "PUT",
      body: JSON.stringify({
        meta_data: [{ id: tmMetaEntry.id, key: "tm_meta", value: tmMetaEntry.value }],
      }),
    });
    if (!put.ok) {
      return jsonResponse({ error: "PUT failed", id, detail: put.json, plan }, put.status);
    }

    // 5. Verify by re-reading and re-scanning for any surviving 975.
    const verify = await wc(wooBase, auth, `products/${id}`);
    const vMeta: any[] = Array.isArray(verify.json?.meta_data) ? verify.json.meta_data : [];
    const vTm = vMeta.find((m) => m && m.key === "tm_meta");
    const survivingFees: string[] = [];
    if (vTm) findFee(vTm.value, "tm_meta", survivingFees);

    return jsonResponse({
      ok: true,
      applied: true,
      plan,
      verified_base_price: verify.json?.regular_price,
      verified_price: verify.json?.price,
      surviving_975_locations: survivingFees,
      note:
        survivingFees.length > 0
          ? "Applied, but 975 still appears in the options (likely a label/default, not a price). If the cart is now $500 you're done; the remaining 975 is cosmetic text."
          : "Applied — no 975 remains anywhere in the options. Cart should now be the base price. If your store uses a page/object cache, clear it to see the change.",
    });
  } catch (err) {
    return jsonResponse({ error: String(err) }, 500);
  }
});
