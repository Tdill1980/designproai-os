// BUYING THE WALL WRAP ON THE WALLPRO PAGE.
//
// Owner, 2026-09-14: "Buy wall wrap on the same page from x WePrintWraps.com."
// The page already knows the wall, so it should hand the customer a cart rather
// than send them off to find the product and work out their own footage.
//
// The mechanism is WePrintWraps' own, documented in wpw-cart.ts and already
// used by the estimator's "Checkout on WePrintWraps" button:
//
//   https://weprintwraps.com/cart/?add-to-cart=<wooId>&quantity=<n>
//
// THE PRODUCT ID IS NOT RE-TYPED HERE. It comes from WPW_CATALOG, which is the
// file reconciled against the live WooCommerce Store API (WPW_CATALOG_SYNCED_AT)
// and which already carried the wall SKU: id 70093, permalink
// our-products/wall-wrap-printed-vinyl/. Importing it means a future re-sync
// updates this automatically instead of leaving a stale number in a second
// place.
//
// ⚠️ THE UNIT IS THE WHOLE PROBLEM, AND IT IS WHY THIS FILE HAS A GUARD.
//
// The live Woo product is priced PER LINEAR FOOT at $3.25. The owner's launch
// pricing is PER SQUARE FOOT at $3.50 ("all printed wrap is priced by the sq ft
// only"). Those disagree in both unit and rate, so a naive
// `?add-to-cart=70093&quantity=<sqft>` would hand WooCommerce a square-footage
// number against a linear-foot price: on a 142 x 96 wall the page quotes
// $331.35 and the cart would charge $308.75, for the wrong quantity of the
// wrong unit. A customer who is quoted one number and charged another is a
// refund and a trust problem, and it would look like it worked.
//
// So the cart path is GATED on the catalog agreeing with the page. The moment
// the Woo product is changed to $3.50/sq ft and WPW_CATALOG is re-synced, the
// button becomes a one-click cart add with no code change. Until then it opens
// the product page and says so, which is honest and still useful.
//
// This is the same discipline as the gateway price test: two systems that both
// name a price must be compared, never assumed to match.

import { WPW_CATALOG } from './wpw-catalog';
import { WPW_WALL_FILM_RATE_PER_SQFT } from './wallpro-pricing';

/** The wall wrap SKU as the live-store-reconciled catalog records it. */
export const WPW_WALL_WRAP_PRODUCT =
  WPW_CATALOG.find(item => item.permalink.includes('wall-wrap-printed-vinyl')) ?? null;

/** The WooCommerce product id, from the catalog rather than re-typed. */
export const WPW_WALL_WRAP_WOO_ID: number | null =
  WPW_WALL_WRAP_PRODUCT?.wooProductId ?? null;

/** The live product page. */
export const WPW_WALL_WRAP_URL =
  WPW_WALL_WRAP_PRODUCT?.permalink ??
  'https://weprintwraps.com/our-products/wall-wrap-printed-vinyl/';

/**
 * Whether the store is configured the way this page prices.
 *
 * Both halves must agree: the unit (square feet, not linear feet) AND the rate.
 * Either one being off means a cart add charges something the customer was not
 * shown.
 */
export function storeMatchesLaunchPricing(): boolean {
  const p = WPW_WALL_WRAP_PRODUCT;
  return !!p && p.unit === 'sqft' && p.price === WPW_WALL_FILM_RATE_PER_SQFT;
}

export type WpwWallWrapBuy = {
  /** 'cart' adds it directly; 'product' opens the product page instead. */
  mode: 'cart' | 'product';
  url: string;
  /** Square feet being ordered — the wall's own area, rounded up. */
  sqFt: number;
  /** What the button should say. */
  label: string;
  /**
   * The honest caveat, when there is one. Null on the cart path.
   *
   * A button that quietly does something smaller than it looks is how trust is
   * lost, so the page is given the words to say what will happen.
   */
  note: string | null;
};

/**
 * Where "Buy the printed wrap" should send this customer.
 *
 * Square footage is rounded UP: WooCommerce quantities are whole units and a
 * wall short of film is a reprint, whereas a fraction of a square foot over is
 * a rounding error in the shop's favour by a few cents.
 */
export function wpwWallWrapBuy(wallSqFt: number): WpwWallWrapBuy | null {
  if (!Number.isFinite(wallSqFt) || wallSqFt <= 0) return null;
  const sqFt = Math.ceil(wallSqFt);

  if (WPW_WALL_WRAP_WOO_ID != null && storeMatchesLaunchPricing()) {
    return {
      mode: 'cart',
      url: `https://weprintwraps.com/cart/?add-to-cart=${WPW_WALL_WRAP_WOO_ID}&quantity=${sqFt}`,
      sqFt,
      label: `Add ${sqFt} sq ft to cart`,
      note: null,
    };
  }

  return {
    mode: 'product',
    url: WPW_WALL_WRAP_URL,
    sqFt,
    label: `Buy ${sqFt} sq ft on WePrintWraps`,
    note: `Opens the wall wrap product on WePrintWraps — enter ${sqFt} sq ft.`,
  };
}
