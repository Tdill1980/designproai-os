/**
 * SHOPFLOW — the seven customer-facing stages, in one place.
 *
 * WHY THIS EXISTS. ShopFlow is the shop's real job tracker. Two WrapGenius
 * surfaces answer "where is my order?" and until now only ONE of them spoke
 * ShopFlow's language:
 *
 *   · the EMBED (the shipping product) called `wpw-order-lookup`, which mapped
 *     WooCommerce statuses onto the seven stages — the same mapping
 *     CustomerProgressBar uses in WrapCommandAI.
 *   · the CHAT (`wpw-sales-chat`'s order_status tool) returned the RAW Woo
 *     status, so a customer asking the assistant heard "w-o-printed" while the
 *     same order on the widget and the tracker read "Files Sent to Print".
 *
 * One shop, one job, three different answers is how a customer stops trusting
 * the tracker. This module is the single source both surfaces read, so the
 * stage WrapGenius shows is the stage ShopFlow shows — by construction, not by
 * two lists someone remembers to keep in sync.
 *
 * WRAPGENIUS *IS* THE TRACKER NOW (2026-09-13). It used to hand the customer a
 * link to wrapcommandai.com/track/<order#>. That link could not work, two ways
 * over, and both were measured before this was changed:
 *
 *   1. WRONG DATABASE, STALE SINCE FEBRUARY. The tracker page reads
 *      `shopflow_orders` on the WrapCommand project (qxllysilzonrlyoaomce):
 *      246 rows, newest 2026-02-17. WrapGenius reads `wpw_orders` on RestylePro
 *      (kfapjdyythzyvnpdeghu): 2,320 rows, newest the day this was written. So
 *      every order placed since February answered "Order not found".
 *   2. NO ANON READ. `shopflow_orders` carries ZERO RLS policies, so the
 *      anonymous fetch the tracker page makes is denied outright. The page only
 *      ever resolved for a signed-in admin.
 *
 * The tracker also looked orders up by ORDER NUMBER ALONE — no email — which is
 * a walk-the-numbers leak of customer names, totals and uploaded files. The chat
 * already verifies order number AND the email on the order before it says a
 * word, so rendering the stage rail inside the conversation is both the working
 * path and the safe one. Do NOT reintroduce an outbound tracker link without
 * first fixing the sync and the RLS; a link to "Order not found" is worse than
 * no link, and it is what customers have been clicking all year.
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
 * occur in `wpw_orders` (19 distinct values measured) plus ShopFlow's own
 * spellings, because the two systems name a few states differently
 * ("w-o-printed" here, "work-order-printed" there).
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

