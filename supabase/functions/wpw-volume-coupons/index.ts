// wpw-volume-coupons — make the advertised fleet/bulk ladder REDEEMABLE.
//
// The CommercialPro quote tool advertises automatic volume discounts and
// WrapGuru now quotes them, but nothing existed on the WooCommerce side to
// honour the price: the customer landed on the product page and paid list.
// A quoted discount nobody can redeem is worse than no discount at all —
// it's a broken promise at checkout, on a fleet buyer.
//
// This owns the four coupons in Woo, idempotently.
//
// POST { action: "ensure" }  -> create/update all four, return their state
// POST { action: "list" }    -> read them back from Woo (verification)
//
// MINIMUM SPEND — set from the WRAP FILM rate, and here is why that matters:
// the ladder is written in SQ FT while Woo coupons gate on CART DOLLARS, and
// our per-sq-ft rates run $3.25 (wall vinyl) to $6.92 (3M contour).
// The first cut of this file derived the minimum from the CHEAPEST rate so no
// wall-wrap customer could ever be rejected. That was wrong, and expensively
// so: at a $3.25-derived minimum, a WRAP FILM order cleared each tier far
// early — FLEET20 (advertised at 2,500 sq ft) unlocked at 1,542 sq ft of
// film, handing 20% to an order that had earned 15%. Across the four tiers it
// discounted 192-958 sq ft sooner than advertised, on the flagship product
// that is most of the qualifying volume.
// So the minimum is tier_sqft x $5.27 — the rate the published ladder is
// written against (its own "$4.22/sq ft at the top tier" is 20% off $5.27).
// A film order now qualifies at exactly the advertised square footage.
// Consequence, accepted deliberately: a wall-vinyl or perf order reaches the
// dollar minimum at more square footage than the sign says. Those are a small
// share of volume and they route to a human, which is the safe direction to
// be wrong — an over-strict coupon is a conversation, an over-generous one is
// margin gone before anyone notices.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** The rate the ladder is WRITTEN AGAINST — printed wrap film. See below. */
const LADDER_RATE = 5.27;

/** Cap total redemptions per code, and one use per customer email. A public
 *  percentage code with no ceiling is an unbounded liability if it leaks. */
const USAGE_LIMIT = 100;
const USAGE_LIMIT_PER_USER = 5;

// SELF-SERVE ONLY WHERE THE MARGIN SURVIVES IT.
// Owner, 2026-08-12: gross margin on printed wrap film is ~20%. A percentage
// coupon comes straight out of that, so the published ladder does not survive
// being self-serve at the top:
//     5% off  -> ~15% margin left   OK
//    10% off  -> ~10% margin left   OK, thin
//    15% off  -> ~5%  margin left   not viable unattended
//    20% off  -> ~0%  margin        SELLS AT COST
// So only the two lower rungs are redeemable codes. The 15% and 20% tiers stay
// ADVERTISED — they are real, and a big fleet program can still get there —
// but they are priced by a human who can look at the freight, the release
// schedule and the actual material cost on that job. A code cannot do that,
// and an unattended code that zeroes margin is the one mistake here that
// cannot be walked back after it is redeemed.
// `selfServe: false` keeps the coupon in Woo but EXPIRED, so it is rejected at
// checkout and stays available to re-enable if the margin picture changes.
export const VOLUME_COUPONS = [
  { code: "FLEET5", pct: 5, minSqft: 500, tier: "500–999 sq ft", selfServe: true },
  { code: "FLEET10", pct: 10, minSqft: 1000, tier: "1,000–1,499 sq ft", selfServe: true },
  { code: "FLEET15", pct: 15, minSqft: 1500, tier: "1,500–2,499 sq ft", selfServe: false },
  { code: "FLEET20", pct: 20, minSqft: 2500, tier: "2,500+ sq ft", selfServe: false },
] as const;

/** A date safely in the past — Woo rejects any coupon past its expiry. */
const DISABLED_EXPIRY = "2020-01-01T00:00:00";

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function wooEnv() {
  const base = (Deno.env.get("WOOCOMMERCE_URL") || "https://weprintwraps.com").replace(/\/$/, "");
  const key = Deno.env.get("WOOCOMMERCE_CONSUMER_KEY");
  const secret = Deno.env.get("WOOCOMMERCE_CONSUMER_SECRET");
  if (!key || !secret) throw new Error("WOOCOMMERCE_CONSUMER_KEY / _SECRET not configured");
  return { base, auth: "Basic " + btoa(`${key}:${secret}`) };
}

async function findCoupon(base: string, auth: string, code: string) {
  const res = await fetch(`${base}/wp-json/wc/v3/coupons?code=${encodeURIComponent(code)}`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) return null;
  const rows = await res.json();
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const action = body?.action || "list";
    const { base, auth } = wooEnv();

    if (action === "list") {
      const out = [];
      for (const c of VOLUME_COUPONS) {
        const found = await findCoupon(base, auth, c.code);
        out.push({
          code: c.code,
          exists: !!found,
          id: found?.id ?? null,
          amount: found?.amount ?? null,
          discount_type: found?.discount_type ?? null,
          minimum_amount: found?.minimum_amount ?? null,
        });
      }
      return json({ success: true, coupons: out });
    }

    if (action === "ensure") {
      const results = [];
      for (const c of VOLUME_COUPONS) {
        const minimumAmount = (c.minSqft * LADDER_RATE).toFixed(2);
        const payload = {
          code: c.code,
          discount_type: "percent",
          amount: String(c.pct),
          description:
            `Fleet / bulk volume discount — ${c.pct}% off at ${c.tier}. ` +
            `Minimum spend $${minimumAmount} (= ${c.minSqft} sq ft of printed wrap film at $${LADDER_RATE}/sq ft).`,
          minimum_amount: minimumAmount,
          // individual_use blocks stacking — notably with WPLoyalty point
          // redemptions, which are also coupons. Volume pricing is a tier, not
          // a promo; 20% plus points on a five-figure order is not intended.
          individual_use: true,
          exclude_sale_items: true,
          free_shipping: false,
          usage_limit: USAGE_LIMIT,
          usage_limit_per_user: USAGE_LIMIT_PER_USER,
          // Margin gate: a non-self-serve tier is expired on purpose, so the
          // code exists (and can be revived) but cannot be redeemed today.
          date_expires: c.selfServe ? null : DISABLED_EXPIRY,
        };
        const existing = await findCoupon(base, auth, c.code);
        const url = existing
          ? `${base}/wp-json/wc/v3/coupons/${existing.id}`
          : `${base}/wp-json/wc/v3/coupons`;
        const res = await fetch(url, {
          method: existing ? "PUT" : "POST",
          headers: { Authorization: auth, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        results.push({
          code: c.code,
          self_serve: c.selfServe,
          redeemable: c.selfServe,
          action: existing ? "updated" : "created",
          ok: res.ok,
          id: data?.id ?? null,
          amount: data?.amount ?? null,
          minimum_amount: data?.minimum_amount ?? null,
          date_expires: data?.date_expires ?? null,
          error: res.ok ? null : String(data?.message || res.status).slice(0, 200),
        });
      }
      return json({ success: results.every((r) => r.ok), results });
    }

    throw new Error("Invalid action. Use: ensure, list");
  } catch (error) {
    return json({ success: false, error: (error as Error).message }, 500);
  }
});
