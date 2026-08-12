/**
 * WPW Design Products — the three WooCommerce SKUs WePrintWraps charges
 * customers for design work that RestylePro tenants get bundled into
 * their monthly subscription.
 *
 * Used by the DesignProductsCompareCard on the QuickQuote/DesignPro
 * estimators to show WPW shops how much they'd be paying their print
 * partner for the same work, and to "Add to WPW cart" any design lines
 * that don't fit RestylePro's bundled allotment.
 */

export interface WpwDesignProduct {
  /** WooCommerce product id on weprintwraps.com */
  wooProductId: number;
  /** Internal stable identifier */
  slug: "hourly_design" | "full_wrap_design" | "design_setup_output";
  /** Customer-facing label */
  label: string;
  /** Per-unit price in dollars */
  price: number;
  /** Unit shown next to the price */
  unit: string;
  /** Optional minimum-quantity rule (e.g. hourly design has 2-hr min) */
  minQuantity?: number;
  /** Sub-label / fine print rendered under the price */
  fineprint?: string;
}

export const WPW_DESIGN_PRODUCTS: WpwDesignProduct[] = [
  {
    wooProductId: 290,
    slug: "hourly_design",
    label: "Hourly Design",
    price: 90,
    unit: "/ hour",
    minQuantity: 2,
    fineprint: "2-hour minimum ($180 floor)",
  },
  {
    wooProductId: 234,
    slug: "full_wrap_design",
    label: "Custom Vehicle Wrap Design",
    price: 500,
    unit: "flat",
    fineprint:
      "Files stay with WPW — used only if you order the wrap. No print-ready files released.",
  },
  {
    wooProductId: 289,
    slug: "design_setup_output",
    label: "Design Setup / File Output",
    price: 190,
    unit: "flat",
    fineprint: "Production-ready file output",
  },
];

/**
 * Build a WePrintWraps cart URL pre-loaded with one design product.
 * WooCommerce's stock add-to-cart query accepts a comma-separated id
 * list, so multiple products can be batched if needed.
 */
export function buildWpwDesignCartUrl(productIds: number[]): string {
  const ids = productIds.filter(Boolean).join(",");
  return `https://weprintwraps.com/cart/?add-to-cart=${ids}`;
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic recognition — "a true Custom Vehicle Wrap Design order that
// needs design configuration." This is keyed on the WooCommerce PRODUCT ID,
// NOT a name/keyword heuristic. Two product IDs are the same product on
// weprintwraps.com: the original (234) and a WooCommerce duplicate (58160,
// "Custom Vehicle Wrap Design (Copy)"). Hourly Design (290) and Design
// Setup/File Output (289) are design products but do NOT need the
// configuration intake — they are excluded here on purpose.
// ────────────────────────────────────────────────────────────────────────────

export const CUSTOM_WRAP_DESIGN_PRODUCT_IDS: number[] = [234, 58160];

export function isCustomWrapDesignProductId(
  id: number | string | null | undefined,
): boolean {
  if (id == null) return false;
  const n = Number(id);
  return Number.isFinite(n) && CUSTOM_WRAP_DESIGN_PRODUCT_IDS.includes(n);
}

interface RecognizableLineItem {
  product_id?: number | string | null;
  name?: string | null;
  sku?: string | null;
}

/**
 * True if an order's line items include the Custom Vehicle Wrap Design product.
 * Prefers the deterministic product-id match; falls back to SKU/name for rows
 * synced before product_id was persisted on the proof metadata.
 */
export function lineItemsAreCustomWrapDesign(
  items: RecognizableLineItem[] | undefined | null,
): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  // Deterministic: WooCommerce product id.
  if (items.some((li) => isCustomWrapDesignProductId(li?.product_id))) return true;
  // Fallback (legacy rows without product_id): SKU CHWD or a name that is
  // clearly the Custom Vehicle Wrap Design product (incl. the "(Copy)").
  return items.some((li) => {
    const name = String(li?.name || "").toLowerCase();
    const sku = String(li?.sku || "").toUpperCase();
    return sku === "CHWD" || (name.includes("custom") && name.includes("wrap design"));
  });
}

// ────────────────────────────────────────────────────────────────────────────
// ApprovePro QUEUE recognition — the full set of paid DESIGN work the team
// handles, broader than the Custom-Wrap-Design intake set above. Per Trish,
// the design queue must show ALL design orders:
//   234 / 58160  CHWD  Custom / Full Wrap Design ($500 / $975 — one product,
//                      variable price)
//   290          HD    Hourly Design (~$90)
//   289          DSFO  Design Setup / File Output (the "Output fee")
// Pure print / material lines (printed wrap film, UV lamination, contour-cut
// vinyl) are NOT design work and must stay OUT of ApprovePro.
// ────────────────────────────────────────────────────────────────────────────

export const DESIGN_ORDER_PRODUCT_IDS: number[] = [234, 58160, 290, 289];
export const DESIGN_ORDER_SKUS: string[] = ["CHWD", "HD", "DSFO"];

/** Name-based fallback for legacy rows whose line_items lack product_id/sku. */
export function nameLooksLikeDesignOrder(name: string | null | undefined): boolean {
  const n = String(name || "").toLowerCase();
  return (
    n.includes("wrap design") ||
    n.includes("hourly design") ||
    (n.includes("design") && (n.includes("setup") || n.includes("output") || n.includes("file output")))
  );
}

/**
 * True if an order is a DESIGN order for the ApprovePro queue — Custom/Full
 * Wrap Design, Hourly Design, or Design Setup/Output. Deterministic on
 * product_id/SKU, with a name fallback for legacy rows.
 */
export function lineItemsAreDesignOrder(
  items: RecognizableLineItem[] | undefined | null,
): boolean {
  if (!Array.isArray(items) || items.length === 0) return false;
  return items.some((li) => {
    const n = Number(li?.product_id);
    if (Number.isFinite(n) && DESIGN_ORDER_PRODUCT_IDS.includes(n)) return true;
    const sku = String(li?.sku || "").toUpperCase();
    if (DESIGN_ORDER_SKUS.includes(sku)) return true;
    return nameLooksLikeDesignOrder(li?.name);
  });
}
