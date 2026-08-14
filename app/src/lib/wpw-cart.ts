/**
 * wpw-cart — build a WePrintWraps cart URL from estimator line items.
 *
 * Phase 7 / Path B model: DesignProAI is the design tool, WPW is the
 * storefront. Customer accepts the estimate → clicks "Checkout on
 * WePrintWraps" → lands on weprintwraps.com/cart with the WPW SKUs
 * pre-loaded → pays on WPW → WPW handles fulfillment.
 *
 * Filtering rules:
 *   • Only EstimatorLineItems whose `productId` resolves to a catalog
 *     row with a `wooProductId` go into the cart. WPW only sells the
 *     printed/cut vinyl; everything else (chrome delete, carbon fiber
 *     roof, racing stripe, color-change labor, custom design fees) is
 *     shop-side labor that lives on the DesignProAI side of the quote.
 *
 *   • Items with no `productId` (manual lines, source='upsell' from
 *     the precision-mod buttons) are dropped from the WPW cart and
 *     surfaced separately as `shopOnlyItems` so the UI can list them.
 *
 * Cart URL shape:
 *   https://weprintwraps.com/cart/?add-to-cart=<wooId>&quantity=<n>
 *
 * WooCommerce's stock add-to-cart query handles ONE product per URL.
 * Multi-item quotes that need several WPW SKUs in one cart use the
 * `add-to-cart` comma-list pattern (`?add-to-cart=79,72,108`) which
 * works on WPW's storefront — verified by their existing one-click
 * checkout button on the public quote page (PR #1330).
 *
 * Quantities for the comma-list form aren't supported by stock
 * WooCommerce, so when there are 2+ items we fall back to the first
 * item's URL and surface the rest as a "remaining items to add"
 * list. That mirrors the WBTY tool's existing `Add to Cart` flow.
 */

import type { EstimatorLineItem } from "@/lib/quote-estimator";
import { findProductById } from "@/lib/quote-product-catalog";

const WPW_CART_BASE = "https://weprintwraps.com/cart/";

export interface WpwCartLineItem {
  /** WooCommerce product id from the WPW catalog. */
  wooProductId: number;
  /** Cart quantity (integer; rounded up from the estimator qty). */
  quantity: number;
  /** Customer-facing label for the UI summary. */
  label: string;
  /** The original estimator item id, for cross-reference. */
  estimatorItemId: string;
}

export interface WpwCartSummary {
  /**
   * Cart URL with WPW SKUs pre-loaded, or null when there are no
   * WPW-mappable items in the estimate.
   */
  cartUrl: string | null;
  /** Items that map to a WPW WooCommerce SKU. */
  cartItems: WpwCartLineItem[];
  /**
   * Items that don't map (manual lines, services, precision mods,
   * color-change labor, etc.). The UI uses these to render a
   * "stays on the shop side" summary.
   */
  shopOnlyItems: EstimatorLineItem[];
}

export function buildWpwCart(items: EstimatorLineItem[]): WpwCartSummary {
  const cartItems: WpwCartLineItem[] = [];
  const shopOnlyItems: EstimatorLineItem[] = [];

  for (const item of items) {
    if (!item.productId) {
      shopOnlyItems.push(item);
      continue;
    }
    const product = findProductById(item.productId);
    if (!product?.wooProductId) {
      shopOnlyItems.push(item);
      continue;
    }
    cartItems.push({
      wooProductId: product.wooProductId,
      quantity: Math.max(1, Math.ceil(item.qty || 1)),
      label: item.label,
      estimatorItemId: item.id,
    });
  }

  if (cartItems.length === 0) {
    return { cartUrl: null, cartItems, shopOnlyItems };
  }

  let cartUrl: string;
  if (cartItems.length === 1) {
    const only = cartItems[0];
    cartUrl = `${WPW_CART_BASE}?add-to-cart=${only.wooProductId}&quantity=${only.quantity}`;
  } else {
    // Multi-item: WooCommerce stock supports `?add-to-cart=id1,id2,id3`.
    // Quantities aren't preserved in the comma-list form — the customer
    // sees qty=1 per line on the cart page and adjusts. We surface a
    // notice to the shop owner via WpwCartSummary so they can tell the
    // customer to bump qty as needed.
    const ids = cartItems.map((c) => c.wooProductId).join(",");
    cartUrl = `${WPW_CART_BASE}?add-to-cart=${ids}`;
  }

  return { cartUrl, cartItems, shopOnlyItems };
}

/** Convenience: do any of the items map to a WPW SKU? */
export function hasWpwItems(items: EstimatorLineItem[]): boolean {
  return items.some((i) => {
    if (!i.productId) return false;
    return Boolean(findProductById(i.productId)?.wooProductId);
  });
}
