// BUYING THE WALL WRAP ON THE WALLPRO PAGE.
//
// Owner, 2026-09-14: "Buy wall wrap on the same page from x WePrintWraps.com."
// The customer should not have to leave to a catalog, find the product and work
// out their own square footage -- the page already knows the wall, so it should
// be able to hand them a cart.
//
// The mechanism is WePrintWraps' own, not a new one. wpw-cart.ts documents it:
//
//   https://weprintwraps.com/cart/?add-to-cart=<wooId>&quantity=<n>
//
// WooCommerce's stock add-to-cart query, already used by the estimator's
// "Checkout on WePrintWraps" button. This file is that pattern applied to the
// one wall SKU, with the quantity being square feet because that is the unit
// the product is sold in.
//
// ⚠️ THE WOOCOMMERCE PRODUCT ID IS NOT KNOWN YET, AND IS NOT GUESSED.
//
// The catalog row for wallpro-avery-2610 carries a wooProductUrl but no
// wooProductId -- every other WPW SKU in quote-product-catalog.ts has one
// (avery-1105 is 79, the contour cut is 108, custom wrap design is 234), this
// one simply was never recorded. Inventing a number here would silently add
// SOMEBODY ELSE'S PRODUCT to a customer's cart, which is worse than not having
// the button: a wrong cart looks like it worked.
//
// So until the id is supplied, `mode` is 'product' and the button goes to the
// real product page with the square footage stated next to it. Fill in
// WPW_WALL_WRAP_WOO_ID and it becomes a one-click cart add with no other
// change -- that is the whole reason this is a function and not a URL in JSX.

/**
 * The WooCommerce product id for the WePrintWraps wall wrap SKU.
 *
 * null until confirmed against the live store. See the warning above: this must
 * be the real id or stay null. Do not guess it from a neighbouring product.
 */
export const WPW_WALL_WRAP_WOO_ID: number | null = null;

/** The live product page, mirrored by the wallpro-avery-2610 catalog row. */
export const WPW_WALL_WRAP_URL =
  'https://weprintwraps.com/our-products/wall-wrap-printed-vinyl/';

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

  if (WPW_WALL_WRAP_WOO_ID != null) {
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
