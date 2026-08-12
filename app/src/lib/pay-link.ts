/**
 * Pay-link helper — builds a one-click "Add to Cart" URL the customer
 * can tap from the quote PDF / email / public quote page.
 *
 * Shared by SavedQuotesTable, QuickQuoteEstimator, PublicQuotePage and
 * the send-estimate-email edge function (which keeps an inline copy
 * because Deno can't import from src/).
 *
 * Logic:
 *   - Any quote line whose `wooProductId` is populated is a WPW Woo
 *     product (those IDs only mean anything in the WePrintWraps Woo
 *     store). When at least one such line exists, return the Woo
 *     `?add-to-cart=…` URL — single id + qty for one line, comma-joined
 *     ids for multi-line carts.
 *   - When no line carries a wooProductId, return null. Caller falls
 *     back to the share-link CTA only.
 *
 * The `shopWebsite` argument is intentionally accepted but ignored for
 * non-WPW shops today — keeping the signature stable for when other
 * shops wire their own `?add-to-cart=` endpoint.
 */
export interface PayLinkLineItem {
  wooProductId?: number | null;
  quantity?: number | null;
}

const WPW_CART_ORIGIN = "https://weprintwraps.com/cart/";

export function buildPayUrl(
  _shopWebsite: string | null | undefined,
  lineItems: PayLinkLineItem[] | null | undefined,
): string | null {
  if (!lineItems || lineItems.length === 0) return null;
  const woo = lineItems.filter(
    (l) =>
      typeof l.wooProductId === "number" &&
      l.wooProductId !== null &&
      (l.wooProductId ?? 0) > 0,
  );
  if (woo.length === 0) return null;
  if (woo.length === 1) {
    const l = woo[0];
    const qty =
      l.quantity && l.quantity > 0 ? Math.round(l.quantity) : 1;
    return `${WPW_CART_ORIGIN}?add-to-cart=${l.wooProductId}&quantity=${qty}`;
  }
  const ids = woo.map((l) => l.wooProductId).join(",");
  return `${WPW_CART_ORIGIN}?add-to-cart=${ids}`;
}
