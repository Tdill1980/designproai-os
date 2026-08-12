/**
 * Hand a WpwOrder to the printable /wpw-orders/:id/print page via
 * sessionStorage so it renders instantly without a re-fetch. Important for
 * callers (ApprovePro) that already hold the full order: a deep-link fetch
 * on the print page can return nothing for orders outside the viewer's
 * direct-query scope, so stashing the row guarantees the print page has it.
 */
import type { WpwOrder } from "@/hooks/useWpwOrders";

const SESSION_KEY_PREFIX = "wpw-print-order:";
const SESSION_TTL_MS = 5 * 60 * 1000;

export function stashOrderForPrint(order: WpwOrder) {
  try {
    sessionStorage.setItem(
      `${SESSION_KEY_PREFIX}${order.id}`,
      JSON.stringify({ savedAt: Date.now(), order }),
    );
  } catch {
    /* sessionStorage full / disabled — print page falls back to direct query */
  }
}

export function readStashedOrder(orderId: number | null): WpwOrder | null {
  if (orderId == null) return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${orderId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { savedAt: number; order: WpwOrder };
    if (Date.now() - parsed.savedAt > SESSION_TTL_MS) return null;
    return parsed.order;
  } catch {
    return null;
  }
}
