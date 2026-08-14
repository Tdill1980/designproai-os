/**
 * QuickQuote Estimator — portable line-item state.
 *
 * Phase 2 of the quote tool rebuild introduces a Thrive-style estimator
 * that lives BOTH on the dashboard /quick-quote page AND inside every
 * design tool (DesignPro, ColorPro, FadeWraps, PatternPro, GraphicsPro)
 * via the side drawer added in Phase 3.
 *
 * This module owns the data model:
 *   • EstimatorLineItem  — one row in the estimate
 *   • EstimatorState     — items + customer + vehicle + tax/deposit settings
 *   • DEFAULT_UPSELL_CATALOG — one-click add buttons (Chrome Delete, PPF,
 *                              Carbon Fiber, etc.) sourced from
 *                              SERVICE_PRODUCTS so prices stay in sync
 *                              with the rest of the catalog.
 *
 * The component (QuickQuoteEstimator.tsx) is a controlled component —
 * the parent owns EstimatorState, mutates it through these helpers when
 * a new render variant lands, and the UI re-renders. That's how the
 * "live total when user generates a carbon-fiber-hood variant" behavior
 * stays a one-line call from the parent without coupling the component
 * to any specific render pipeline.
 */

import {
  SERVICE_PRODUCTS,
  type QuoteProduct,
  type PriceUnit,
} from "@/lib/quote-product-catalog";

/** A single line in the estimator. */
export interface EstimatorLineItem {
  /** Stable id — used for React keys and update/remove ops. */
  id: string;
  /** Headline shown in the row (e.g. "Color Change — Gloss Black"). */
  label: string;
  /** Optional secondary line under the label (finish, dims, notes). */
  description?: string;
  qty: number;
  /** Price per unit in USD. */
  unitPrice: number;
  unit: PriceUnit;
  /**
   * Where this line came from — drives badges + dedupe behavior.
   *   • base    — primary wrap/print job (one per estimate, replaceable)
   *   • render  — auto-added when a new render variant is generated
   *   • upsell  — added by clicking an upsell button
   *   • manual  — typed in by the shop owner
   *   • catalog — added from the catalog dropdown
   */
  source: "base" | "render" | "upsell" | "manual" | "catalog";
  /** Catalog product id when source maps to a catalog row. */
  productId?: string;
  /**
   * Optional tag a render variant can set so subsequent identical
   * variants don't double-insert (e.g. "carbon-fiber-hood"). Parents
   * that drive the estimator from a render pipeline should set this.
   */
  variantKey?: string;
}

export interface EstimatorVehicle {
  year?: string;
  make?: string;
  model?: string;
  /** Total wrap surface area in sq ft, if known. */
  sqFt?: number;
}

export interface EstimatorCustomer {
  name?: string;
  email?: string;
  phone?: string;
  /** Business name — surfaces on the saved quote + customer CRM record. */
  company?: string;
}

/**
 * One stacked precision modification (Phase 5c) recorded for the
 * eventual saved quote. The shop owner stacks these in order:
 *   [chrome-delete -> carbon-fiber-roof -> racing-stripe]
 * The renderUrl is the image AFTER that mod was applied. The last
 * entry's renderUrl matches whatever the shop owner has on screen
 * at save time (the hero render).
 */
export interface EstimatorPrecisionMod {
  /** precision_modifications.key (e.g. "chrome_delete") */
  key: string;
  /** Customer-facing label for the admin viewer */
  label: string;
  /** Render after this mod was applied */
  renderUrl: string;
  /** EstimatorLineItem.id this mod created (for cross-reference) */
  lineItemId?: string;
}

export interface EstimatorState {
  items: EstimatorLineItem[];
  vehicle: EstimatorVehicle;
  customer: EstimatorCustomer;
  /** Notes shown to the customer on the quote. */
  notes: string;
  /**
   * Tax rate as a decimal (0.08 = 8%). 0 = no tax line. Shop owners
   * configure this on their org settings; the estimator just reads it.
   */
  taxRate: number;
  /**
   * Suggested deposit as a decimal of the total (0.5 = 50%). The
   * deposit is informational — actual deposit collection happens via
   * Stripe in a later phase.
   */
  depositRate: number;
  /**
   * Hero render the estimate was built on top of, BEFORE any precision
   * modifications were stacked. Captured by tool pages when a fresh
   * design renders. The admin viewer surfaces it as the "before".
   */
  baseRenderUrl: string | null;
  /**
   * Ordered list of precision modifications stacked on the render —
   * the visual story of how the customer's wrap was built. Latest
   * entry's renderUrl is what the customer would see on the proof.
   */
  precisionMods: EstimatorPrecisionMod[];
}

export interface EstimatorTotals {
  subtotal: number;
  tax: number;
  total: number;
  deposit: number;
}

export const EMPTY_ESTIMATOR: EstimatorState = {
  items: [],
  vehicle: {},
  customer: {},
  notes: "",
  taxRate: 0,
  depositRate: 0.5,
  baseRenderUrl: null,
  precisionMods: [],
};

// ── Helpers ────────────────────────────────────────────────────────

let counter = 0;
function nextId(prefix = "li"): string {
  counter += 1;
  // Time-based + monotonic counter keeps ids unique even if React batches
  // multiple add calls in the same tick.
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function lineItemFromProduct(
  product: QuoteProduct,
  opts: {
    qty?: number;
    source?: EstimatorLineItem["source"];
    description?: string;
    variantKey?: string;
  } = {},
): EstimatorLineItem {
  return {
    id: nextId(),
    label: product.name,
    description: opts.description ?? product.subName,
    qty: opts.qty ?? 1,
    unitPrice: product.price,
    unit: product.unit,
    source: opts.source ?? "catalog",
    productId: product.id,
    variantKey: opts.variantKey,
  };
}

/**
 * Build a base line item for a render. The parent owns the calculation
 * of price (per-yard for color change, per-sqft for print, flat for
 * services); we just package the result.
 */
export function lineItemFromRender(args: {
  label: string;
  description?: string;
  qty: number;
  unitPrice: number;
  unit: PriceUnit;
  variantKey?: string;
  productId?: string;
}): EstimatorLineItem {
  return {
    id: nextId("rv"),
    label: args.label,
    description: args.description,
    qty: args.qty,
    unitPrice: args.unitPrice,
    unit: args.unit,
    source: args.variantKey ? "render" : "base",
    productId: args.productId,
    variantKey: args.variantKey,
  };
}

export function blankLineItem(): EstimatorLineItem {
  return {
    id: nextId("custom"),
    label: "",
    qty: 1,
    unitPrice: 0,
    unit: "each",
    source: "manual",
  };
}

/**
 * Build an upsell line item from a shop-effective upsell (Phase 8b).
 * Source = "upsell" (no variantKey → each click stacks a new line).
 */
export function lineItemFromUpsell(opt: {
  label: string;
  description?: string;
  unit_price: number;
  unit: PriceUnit;
}): EstimatorLineItem {
  return {
    id: nextId("up"),
    label: opt.label,
    description: opt.description,
    qty: 1,
    unitPrice: opt.unit_price,
    unit: opt.unit,
    source: "upsell",
  };
}

export function addItem(
  state: EstimatorState,
  item: EstimatorLineItem,
): EstimatorState {
  // Variant dedupe — render variants with the same key replace the
  // previous one instead of stacking. Lets a parent fire add() on
  // every render without the estimator growing unbounded.
  if (item.variantKey) {
    const existingIdx = state.items.findIndex(
      (i) => i.variantKey === item.variantKey,
    );
    if (existingIdx >= 0) {
      const next = state.items.slice();
      next[existingIdx] = { ...item, id: state.items[existingIdx].id };
      return { ...state, items: next };
    }
  }
  return { ...state, items: [...state.items, item] };
}

export function updateItem(
  state: EstimatorState,
  id: string,
  patch: Partial<Omit<EstimatorLineItem, "id">>,
): EstimatorState {
  return {
    ...state,
    items: state.items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  };
}

export function removeItem(state: EstimatorState, id: string): EstimatorState {
  return { ...state, items: state.items.filter((i) => i.id !== id) };
}

/** Replace the single base line (used when the active render changes). */
export function setBaseItem(
  state: EstimatorState,
  item: EstimatorLineItem,
): EstimatorState {
  const withoutBase = state.items.filter((i) => i.source !== "base");
  return { ...state, items: [{ ...item, source: "base" }, ...withoutBase] };
}

export function computeTotals(state: EstimatorState): EstimatorTotals {
  const subtotal = state.items.reduce(
    (sum, i) => sum + i.qty * i.unitPrice,
    0,
  );
  const tax = subtotal * state.taxRate;
  const total = subtotal + tax;
  const deposit = total * state.depositRate;
  return { subtotal, tax, total, deposit };
}

// ── Default upsell catalog ─────────────────────────────────────────
// Sourced from SERVICE_PRODUCTS so prices stay in sync. The catalog
// drives the one-click upsell button strip in the estimator UI. Order
// matters — the most common upsells come first so they fit on screen
// without scrolling.

const UPSELL_PRODUCT_IDS = [
  "svc-chrome-delete",
  "svc-carbon-fiber",
  "svc-roof-wrap",
  "svc-window-tint",
  "svc-ppf-hood",
  "svc-ppf-full-front",
  "svc-accent-wrap",
  "svc-commercial-lettering",
  "svc-design-consult",
] as const;

export interface UpsellOption {
  product: QuoteProduct;
  /** Short label for the button (e.g. "Chrome Delete"). */
  short: string;
}

export const DEFAULT_UPSELL_CATALOG: UpsellOption[] = UPSELL_PRODUCT_IDS
  .map((id) => SERVICE_PRODUCTS.find((p) => p.id === id))
  .filter((p): p is QuoteProduct => Boolean(p))
  .map((product) => ({
    product,
    short: product.name.replace(/^Service[:\s—-]*/i, "").replace(/\s+Wrap$/i, ""),
  }));

export function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  });
}
