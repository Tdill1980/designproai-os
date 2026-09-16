/**
 * SHOPFLOW — the seven customer-facing stages, in one place.
 *
 * This is the BROWSER twin of `supabase/functions/_shared/shopflow-stages.ts`.
 * The Deno edge functions (`wpw-order-lookup`, `wpw-sales-chat`) import that
 * copy directly; this file exists only because the Vite client bundle does
 * not pull code out of `supabase/functions/`. Same rule as
 * `worker/video-renderer/brandAliases.js` mirroring `src/lib/brandAliases.ts`
 * for a runtime that can't import the other's module — a restatement that
 * isn't pinned drifts, so `tests/shopflow-dashboard.test.ts` diffs the two
 * tables on every run and fails the moment they disagree.
 *
 * Keep this file's exports byte-for-byte identical in VALUE to the edge
 * function's (comments may differ). If you change one, change both.
 *
 * Backstory (why the RestylePro dashboard reads this and not WrapCommandAI):
 * a customer-facing tracker used to live on the WrapCommand project and read
 * a table (`shopflow_orders`) that stopped syncing in February and carried no
 * RLS policy for an anonymous read. RestylePro's own `wpw_orders` (synced
 * live from WooCommerce) is the current, correct source — see the edge
 * function file for the full incident writeup.
 */

/** ShopFlow's seven customer-facing stages, in order. */
export const SHOPFLOW_STAGES = [
  "Order Received",
  "Dropbox Link Sent",
  "Files Received",
  "Files Sent to Print",
  "Print Production",
  "Being Quality Checked",
  "Completed/Shipped",
] as const;

export type ShopflowStage = typeof SHOPFLOW_STAGES[number];

/**
 * WooCommerce status → ShopFlow stage. Keys cover the statuses that actually
 * occur in `wpw_orders` plus ShopFlow's own spellings, because the two
 * systems name a few states differently ("w-o-printed" here, "work-order-
 * printed" there).
 */
export const SHOPFLOW_STATUS_TO_STAGE: Record<string, ShopflowStage> = {
  "pending": "Order Received",
  "processing": "Order Received",
  // PatternPro (wbty_orders, Stripe): paid, waiting for the print order to go out.
  "paid": "Order Received",
  "on-hold": "Order Received",
  "checkout-draft": "Order Received",
  "add-on": "Order Received",
  "credit": "Order Received",
  "lance": "Order Received",
  "waiting-on-email": "Order Received",
  "waiting-on-email-response": "Order Received",
  "waiting-to-place-order": "Order Received",

  "dropbox-link-sent": "Dropbox Link Sent",

  "in-design": "Files Received",
  "file-error": "Files Received",
  "missing-file": "Files Received",

  "design-complete": "Files Sent to Print",
  "w-o-printed": "Files Sent to Print",
  "work-order-printed": "Files Sent to Print",
  // PatternPro: the by-the-yard print order has been emailed to fulfillment.
  "fulfillment_emailed": "Files Sent to Print",

  "ready-for-print": "Print Production",
  "pre-press": "Print Production",
  "print-production": "Print Production",
  "in-production": "Print Production",
  "in_production": "Print Production",
  "lamination": "Print Production",
  "finishing": "Print Production",

  "shipped": "Completed/Shipped",
  "ready-for-pickup": "Completed/Shipped",
  "shipping-cost": "Completed/Shipped",
  "complete": "Completed/Shipped",
  "completed": "Completed/Shipped",
};

/**
 * Statuses that are not a point on the progress bar at all. Showing "Order
 * Received" for a refunded order would be a lie told with a progress bar.
 */
export const SHOPFLOW_TERMINAL_STATUSES: Record<string, string> = {
  "cancelled": "This order was cancelled.",
  "refunded": "This order was refunded.",
  "failed": "This order's payment did not go through.",
};

export type ShopflowProgress = {
  stage: ShopflowStage | null;
  stage_index: number;
  total_stages: number;
  terminal_note: string | null;
};

/** The stage, its index, and whether the bar applies at all. */
export function shopflowStageFor(status: unknown): ShopflowProgress {
  const key = String(status || "").trim().toLowerCase();
  const terminal = SHOPFLOW_TERMINAL_STATUSES[key];
  if (terminal) {
    return {
      stage: null,
      stage_index: -1,
      total_stages: SHOPFLOW_STAGES.length,
      terminal_note: terminal,
    };
  }
  const stage = SHOPFLOW_STATUS_TO_STAGE[key] || "Order Received";
  return {
    stage,
    stage_index: SHOPFLOW_STAGES.indexOf(stage),
    total_stages: SHOPFLOW_STAGES.length,
    terminal_note: null,
  };
}
