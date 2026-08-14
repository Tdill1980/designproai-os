/**
 * WePrintWraps.com — authoritative product catalog (single source of truth).
 *
 * This module mirrors the LIVE weprintwraps.com storefront 1:1 so QuickQuote
 * line items, cart links, and retargeting emails always match what the
 * customer will actually be charged on WPW. Every field here was pulled from
 * the public WooCommerce Store API:
 *
 *   https://weprintwraps.com/wp-json/wc/store/products
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The quote UIs (quote-product-catalog.ts, QuickQuoteCard, QuickQuoteEstimator)
 * carry their own curated product rows with extra presentation fields
 * (id slugs, subNames, categories). Those rows had drifted from the live
 * store — wrong WooCommerce ids, stale prices, and missing SKUs — which meant
 * the "Add to WePrintWraps cart" link (pay-link.ts / wpw-cart.ts) and the
 * retargeting email could load the WRONG product or the WRONG price.
 *
 * `WPW_CATALOG` below is the reconciliation target: the quote catalog's
 * Woo-mapped rows are asserted against it in tests/wpw-catalog.test.ts, so any
 * future drift fails CI instead of silently shipping a bad cart link.
 *
 * ── Pricing rule (per product owner) ───────────────────────────────────────
 * Prices mirror the live WPW store EXACTLY. A `price` of `null` means the
 * product is variable / configured-at-checkout on WPW (e.g. the design
 * services and the custom fade-wrap printing SKU show $0 on the store because
 * the real charge is set per job). For those we keep a sensible `defaultRate`
 * for the estimator, but never claim it is the WPW list price.
 *
 * When re-syncing, re-run the Store API pull and update `WPW_CATALOG_SYNCED_AT`.
 */

export type WpwUnit =
  | "sqft"
  | "yard"
  | "linear_foot"
  | "each"
  | "hour"
  | "roll"
  | "month";

/**
 * How the product behaves in a quote:
 *   • print        — printed/cut wrap film sold by area (sqft/yard/lf)
 *   • pattern      — Wrap By The Yard pre-designed prints (per yard)
 *   • specialty    — InkFusion, perforated window vinyl, wall wrap
 *   • fade         — Custom Fade Wrap printing (configurator-driven)
 *   • pack         — DesignPanelPro / production print packs (flat)
 *   • design       — human design services (variable)
 *   • sample       — swatch books & color charts
 *   • subscription — DesignProAI plans WPW resells (NOT a quote line item)
 */
export type WpwKind =
  | "print"
  | "pattern"
  | "specialty"
  | "fade"
  | "pack"
  | "design"
  | "sample"
  | "subscription";

export interface WpwCatalogItem {
  /** WooCommerce product id — the value used in `?add-to-cart=`. */
  wooProductId: number;
  /** WooCommerce SKU when the store defines one. */
  sku?: string;
  /** Clean, customer-facing product name. */
  name: string;
  /** Live WPW price in USD, or null when the store price is variable/$0. */
  price: number | null;
  /** Estimator fallback rate when `price` is null (variable products). */
  defaultRate?: number;
  unit: WpwUnit;
  kind: WpwKind;
  permalink: string;
  /**
   * Whether this product can be added to a customer quote as a line item.
   * Subscriptions are the SHOP's own plan (surfaced on /pricing), never a
   * line item on a customer's wrap quote — so they're catalogued here for
   * completeness but excluded from the quote dropdowns.
   */
  quotable: boolean;
}

/** Last time this file was reconciled against the live Store API. */
export const WPW_CATALOG_SYNCED_AT = "2026-07-09";

const P = "https://weprintwraps.com/our-products/";

export const WPW_CATALOG: WpwCatalogItem[] = [
  // ── Printed wrap film (per sq ft) ────────────────────────────────────────
  {
    wooProductId: 79,
    sku: "AVERY-MPI1105-WRAP",
    name: "Avery 1105 EZRS Printed Wrap Film + UV Lamination",
    price: 5.27,
    unit: "sqft",
    kind: "print",
    permalink: `${P}avery-1105egrs-with-doz13607-lamination/`,
    quotable: true,
  },
  {
    wooProductId: 72,
    sku: "3M-IJ180CV3-WRAP",
    name: "3M IJ180 Printed Wrap Film",
    price: 5.27,
    unit: "sqft",
    kind: "print",
    permalink: `${P}3m-ij180-printed-wrap-film/`,
    quotable: true,
  },
  {
    wooProductId: 108,
    sku: "AVERY-CC",
    name: "Avery Contour-Cut Wrap Film — Weeded & Masked",
    price: 6.32,
    unit: "sqft",
    kind: "print",
    permalink: `${P}avery-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/`,
    quotable: true,
  },
  {
    wooProductId: 19420,
    sku: "3M-CC",
    name: "3M IJ180 Contour-Cut Wrap Film — Weeded & Masked",
    price: 6.92,
    unit: "sqft",
    kind: "print",
    permalink: `${P}3m-cut-contour-vinyl-graphics-54-roll-max-artwork-size-50/`,
    quotable: true,
  },

  // ── Specialty print media ────────────────────────────────────────────────
  {
    wooProductId: 80,
    sku: "PWV",
    name: 'Perforated Window Vinyl 50/50 Unlaminated 54" Roll',
    price: 5.95,
    unit: "sqft",
    kind: "specialty",
    permalink: `${P}perforated-window-vinyl-5050-unlaminated/`,
    quotable: true,
  },
  {
    wooProductId: 70093,
    name: "Wall Wrap Printing — Avery HP MPI 2610",
    price: 3.25,
    unit: "linear_foot",
    kind: "specialty",
    permalink: `${P}wall-wrap-printed-vinyl/`,
    quotable: true,
  },
  // NOTE: InkFusion (Woo 69439) intentionally omitted — not a valid/orderable
  // product per the WPW owner, despite appearing in the Store API feed.

  // ── Custom fade wrap (configurator-driven; store price is variable) ───────
  {
    wooProductId: 58391,
    name: "Custom Fade Wrap Printing | Avery Film",
    price: null,
    defaultRate: 600,
    unit: "each",
    kind: "fade",
    permalink: `${P}pre-designed-fade-wraps/`,
    quotable: true,
  },

  // ── Wrap By The Yard — pre-designed prints (per yard) ─────────────────────
  {
    wooProductId: 42809,
    sku: "WBTY-BAPE-CAMO",
    name: "Wrap By The Yard — Bape Camo",
    price: 95.5,
    unit: "yard",
    kind: "pattern",
    permalink: `${P}wrap-by-the-yard-bape-camo/`,
    quotable: true,
  },
  {
    wooProductId: 1726,
    sku: "WBTY-CAMO-CARBON",
    name: "Wrap By The Yard — Camo & Carbon",
    price: 95.5,
    unit: "yard",
    kind: "pattern",
    permalink: `${P}camo-carbon-wrap-by-the-yard/`,
    quotable: true,
  },
  {
    wooProductId: 39698,
    sku: "WBTY-METAL-MARBLE",
    name: "Wrap By The Yard — Metal & Marble",
    price: 95.5,
    unit: "yard",
    kind: "pattern",
    permalink: `${P}wrap-by-the-yard-metal-marble/`,
    quotable: true,
  },
  {
    wooProductId: 52489,
    sku: "WBTY-MODERN-TRIPPY",
    name: "Wrap By The Yard — Modern & Trippy",
    price: 95.5,
    unit: "yard",
    kind: "pattern",
    permalink: `${P}wrap-by-the-yard-modern-trippy/`,
    quotable: true,
  },
  {
    // NOTE: the WRAP is Woo id 4181. Id 4179 is the "Wicked & Wild Swatch
    // Book" (a $26.25 sample), NOT the wrap — the old mirror pointed the
    // wrap line at 4179, so its cart link loaded a swatch book. Fixed here.
    wooProductId: 4181,
    sku: "WBTY-WICKED-WILD",
    name: 'Wrap By The Yard — Wicked & Wild 60"',
    price: 95.5,
    unit: "yard",
    kind: "pattern",
    permalink: `${P}wrap-by-the-yard-wicked-wild-wrap-prints/`,
    quotable: true,
  },

  // ── Print production packs (flat) ────────────────────────────────────────
  {
    wooProductId: 69664,
    name: "DesignPanelPro™ — Small Print Production Pack",
    price: 119.99,
    unit: "each",
    kind: "pack",
    permalink: `${P}designpanelpro-small-print-production-pack/`,
    quotable: true,
  },
  {
    wooProductId: 69671,
    name: "DesignPanelPro™ — Medium Print Production Pack",
    price: 119,
    unit: "each",
    kind: "pack",
    permalink: `${P}designpanelpro-medium-print-production-pack/`,
    quotable: true,
  },
  {
    wooProductId: 69680,
    name: "DesignPanelPro™ — Large Print Production Pack",
    price: 119,
    unit: "each",
    kind: "pack",
    permalink: `${P}designpanelpro-large-print-production-pack/`,
    quotable: true,
  },
  {
    wooProductId: 69686,
    name: "DesignPanelPro™ — XL Print Production Pack",
    price: 119,
    unit: "each",
    kind: "pack",
    permalink: `${P}designpanelpro-xl-print-production-pack/`,
    quotable: true,
  },
  {
    wooProductId: 71964,
    sku: "WPW-PRODUCTION-PACK-299",
    name: "Production Pack — $299",
    price: 299,
    unit: "each",
    kind: "pack",
    permalink: `${P}production-pack-299/`,
    quotable: true,
  },

  // ── Human design services (store price variable / configured per job) ─────
  {
    wooProductId: 234,
    sku: "CHWD",
    name: "Custom Vehicle Wrap Design",
    price: 500,
    unit: "each",
    kind: "design",
    permalink: `${P}custom-wrap-design/`,
    quotable: true,
  },
  {
    wooProductId: 289,
    sku: "DSFO",
    name: "Design Setup / File Output",
    price: null,
    defaultRate: 190,
    unit: "each",
    kind: "design",
    permalink: `${P}design-setupfile-output/`,
    quotable: true,
  },
  {
    wooProductId: 290,
    sku: "HD",
    name: "Hourly Design",
    price: null,
    defaultRate: 90,
    unit: "hour",
    kind: "design",
    permalink: `${P}hourly-design/`,
    quotable: true,
  },

  // ── Samples & reference (per each) ───────────────────────────────────────
  {
    wooProductId: 475,
    sku: "SB-CC",
    name: "Camo & Carbon Sample Book",
    price: 26.25,
    unit: "each",
    kind: "sample",
    permalink: `${P}camo-carbon-sample-book/`,
    quotable: true,
  },
  {
    wooProductId: 39628,
    sku: "SB-MM",
    name: "Marble & Metals Swatch Book",
    price: 26.25,
    unit: "each",
    kind: "sample",
    permalink: `${P}marble-metals-swatch-book/`,
    quotable: true,
  },
  {
    wooProductId: 4179,
    sku: "SB-WW",
    name: "Wicked & Wild Swatch Book",
    price: 26.25,
    unit: "each",
    kind: "sample",
    permalink: `${P}wicked-wild-swatch-book/`,
    quotable: true,
  },
  {
    wooProductId: 15192,
    sku: "PCC-30X52",
    name: 'Pantone Color Chart 30" × 52"',
    price: 42,
    unit: "each",
    kind: "sample",
    permalink: `${P}pantone-color-chart/`,
    quotable: true,
  },

  // ── DesignProAI subscriptions WPW resells (NOT quote line items) ─────────
  {
    wooProductId: 71966,
    sku: "WPW-RP-SUB-STARTER",
    name: "DesignProAI Starter — WPW Partner Rate",
    price: 300,
    unit: "month",
    kind: "subscription",
    permalink: `${P}restyleproai-starter-wpw-partner-rate-300-mo/`,
    quotable: false,
  },
  {
    wooProductId: 71976,
    sku: "WPW-RP-SUB-DESIGNPRO-LITE",
    name: "DesignProAI DesignPro Lite — WPW Partner Rate",
    price: 449,
    unit: "month",
    kind: "subscription",
    permalink: `${P}restyleproai-designpro-lite-wpw-partner-rate-449-mo/`,
    quotable: false,
  },
  {
    wooProductId: 71977,
    sku: "WPW-RP-SUB-DESIGNPRO-STUDIO",
    name: "DesignProAI DesignPro Studio — WPW Partner Rate",
    price: 649,
    unit: "month",
    kind: "subscription",
    permalink: `${P}restyleproai-designpro-studio-wpw-partner-rate-649-mo/`,
    quotable: false,
  },
  {
    wooProductId: 71969,
    sku: "WPW-RP-SUB-DESIGNPRO-PLUS",
    name: "DesignProAI DesignPro Plus — WPW Partner Rate",
    price: 945,
    unit: "month",
    kind: "subscription",
    permalink: `${P}restyleproai-designpro-plus-wpw-partner-rate-945-mo/`,
    quotable: false,
  },
];

// ── Lookups ─────────────────────────────────────────────────────────────────

const BY_WOO_ID = new Map<number, WpwCatalogItem>(
  WPW_CATALOG.map((p) => [p.wooProductId, p]),
);

export function getWpwProduct(wooProductId: number): WpwCatalogItem | undefined {
  return BY_WOO_ID.get(wooProductId);
}

/** Products a shop can add to a customer quote (excludes subscriptions). */
export function quotableWpwProducts(): WpwCatalogItem[] {
  return WPW_CATALOG.filter((p) => p.quotable);
}

// ── Cart-link builder ────────────────────────────────────────────────────────

const WPW_CART_ORIGIN = "https://weprintwraps.com/cart/";

export interface WpwCartInput {
  wooProductId: number;
  quantity?: number;
}

/**
 * Build a WePrintWraps cart URL that pre-loads the given WooCommerce products.
 *
 * WooCommerce's stock `?add-to-cart=` query supports a single id with a
 * `quantity`, or a comma-separated id list (quantities not preserved in the
 * list form). Non-positive / unknown ids are dropped. Returns null when no
 * valid Woo id is present.
 *
 * This is the ONE cart-link builder — pay-link.ts and wpw-cart.ts feed the
 * same origin; keep them consistent by routing through here where practical.
 */
export function buildWpwCartUrl(
  items: WpwCartInput[] | null | undefined,
): string | null {
  if (!items || items.length === 0) return null;
  const valid = items.filter(
    (i) => typeof i.wooProductId === "number" && i.wooProductId > 0,
  );
  if (valid.length === 0) return null;
  if (valid.length === 1) {
    const only = valid[0];
    const qty =
      only.quantity && only.quantity > 0 ? Math.max(1, Math.round(only.quantity)) : 1;
    return `${WPW_CART_ORIGIN}?add-to-cart=${only.wooProductId}&quantity=${qty}`;
  }
  const ids = valid.map((i) => i.wooProductId).join(",");
  return `${WPW_CART_ORIGIN}?add-to-cart=${ids}`;
}
