import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * WPW PrintPro Gateway — React hooks
 * Part of Phase 1 — see docs/OPERATION-EXPAND-THE-WRAP-INDUSTRY.md
 */

export interface WpwOrderItem {
  id: number;
  order_id: number;
  product_id: number | null;
  variation_id: number | null;
  name: string | null;
  sku: string | null;
  quantity: number;
  subtotal: number;
  total: number;
  image_url: string | null;
  meta: unknown;
}

export interface WpwOrder {
  id: number;
  woo_customer_id: number;
  user_id: string | null;
  order_number: string | null;
  status: string;
  currency: string | null;
  total: number;
  subtotal: number | null;
  shipping_total: number | null;
  tax_total: number | null;
  payment_method: string | null;
  date_created: string | null;
  date_modified: string | null;
  date_completed: string | null;
  customer_email: string | null;
  customer_name: string | null;
  tracking_number: string | null;
  tracking_carrier: string | null;
  tracking_url: string | null;
  order_key: string | null;
  pay_url: string | null;
  customer_note: string | null;
  billing: Record<string, unknown> | null;
  shipping: Record<string, unknown> | null;
  wpw_order_items?: WpwOrderItem[];
  /** "patternpro" = a Stripe-paid wbty_orders row shaped like a WPW order by
   *  _shared/shopflow-patternpro.ts. It has no Woo id, so it cannot be
   *  reordered through Woo — the cards link to /wbty instead. */
  source?: "woo" | "patternpro";
}

/**
 * Live WPLoyalty balance, pushed by wordpress/wpw-loyalty-webhook on every
 * point change (see that plugin + supabase/functions/wpw-loyalty-webhook).
 * `null` means no event has been pushed for this customer yet — never an
 * invented number; the UI must fall back to linking out to WPLoyalty's own
 * page in that case.
 */
export interface WpwLoyaltyPoints {
  points_balance: number;
  updated_at: string;
}

/**
 * A quote the customer saved, from `customer_quotes` — the same table
 * wpw-sync-orders matches a paid Woo order back to when it writes
 * `quote_converted_to_order`. So a quote surfaced here is measurable revenue
 * the moment it converts; the link already worked, the customer simply could
 * not see the quote they were meant to act on.
 */
export interface WpwQuote {
  id: string;
  quote_number: string | null;
  created_at: string;
  status: string | null;
  quote_total: number | string | null;
  total_sqft: number | string | null;
  film_name: string | null;
  film_manufacturer: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  notes: string | null;
  lead_source: string | null;
}

export interface MyOrdersResponse {
  ok: boolean;
  linked: boolean;
  /** True when these orders were opened with the email door rather than a
   *  RestylePro session — see useGuestWpwOrders. Actions that need an account
   *  (reorder, sync) are hidden for a guest rather than failing at the server. */
  guest?: boolean;
  email?: string;
  fromCache?: boolean;
  orders: WpwOrder[];
  loyalty?: WpwLoyaltyPoints | null;
  /** Saved quotes for this customer, newest first. Empty rather than absent
   *  when the lookup fails — a quote list must never break an order load. */
  quotes?: WpwQuote[];
  message?: string;
  error?: string;
}

/**
 * Returns the caller's WPW order history.
 * `linked` is false when the user hasn't connected a WPW account yet.
 */
export function useMyWpwOrders(options?: { refresh?: boolean; enabled?: boolean }) {
  return useQuery({
    queryKey: ["wpw-orders", options?.refresh ? "refresh" : "cached"],
    // `wpw-orders-read` requires a session. Run it for a signed-OUT visitor and
    // it fails, retries, and leaves `isLoading` true forever — which is exactly
    // what rendered an endless spinner on /shopflow under the guest email door
    // (2026-09-15). Callers that cannot yet know whether there is a session
    // pass `enabled: false` until they do. Default stays true so the dashboard
    // card and every existing caller are unchanged.
    enabled: options?.enabled ?? true,
    queryFn: async (): Promise<MyOrdersResponse> => {
      const { data, error } = await supabase.functions.invoke<MyOrdersResponse>(
        "wpw-orders-read",
        { body: { refresh: !!options?.refresh } },
      );
      if (error) throw error;
      if (!data) throw new Error("No response from wpw-orders-read");
      if (!data.ok) throw new Error(data.error || "Failed to load orders");
      return data;
    },
    staleTime: 60 * 1000,
  });
}

/**
 * THE GUEST DOOR — the same orders, for someone with no RestylePro account.
 *
 * `useMyWpwOrders` needs a session AND a linked Woo customer. Measured
 * 2026-09-14: of 809 distinct WePrintWraps customer emails, 8 users could
 * satisfy that. WPW customers check out on WordPress and never sign up here,
 * so the page they were meant to use had no door they could open.
 *
 * This one opens on an EMAIL — proven with any single order number belonging to
 * it — and returns rows in the same `WpwOrder` shape, so the page renders a
 * guest through the exact same card component. Never an order number alone:
 * that was the enumeration hole in the tracker this whole feature replaced.
 *
 * The token is held in localStorage so a revisit or a reload does not re-ask.
 * It is bound to the email, expires, and is dropped the moment the server
 * refuses it.
 */
export const SHOPFLOW_GUEST_TOKEN_KEY = "wpw.shopflow.token";
/** The job the guest actually asked about. The token proves the EMAIL; this
 *  remembers which single job to show, so a reload lands back on it instead of
 *  re-asking. It is a UI pointer, never authority — the server re-checks that
 *  the number belongs to the token's email on every read. */
export const SHOPFLOW_GUEST_ORDER_KEY = "wpw.shopflow.order";

export function readGuestShopflowToken(): string | null {
  try { return localStorage.getItem(SHOPFLOW_GUEST_TOKEN_KEY); } catch { return null; }
}
export function writeGuestShopflowToken(token: string | null) {
  try {
    if (token) localStorage.setItem(SHOPFLOW_GUEST_TOKEN_KEY, token);
    else {
      localStorage.removeItem(SHOPFLOW_GUEST_TOKEN_KEY);
      // A dropped token must drop its job pointer too, or the next visitor on
      // this browser is asked to unlock and then shown someone else's number.
      localStorage.removeItem(SHOPFLOW_GUEST_ORDER_KEY);
    }
  } catch { /* private mode — the token simply lasts for this page view */ }
}
export function readGuestShopflowOrder(): string | null {
  try { return localStorage.getItem(SHOPFLOW_GUEST_ORDER_KEY); } catch { return null; }
}
export function writeGuestShopflowOrder(orderNumber: string | null) {
  try {
    if (orderNumber) localStorage.setItem(SHOPFLOW_GUEST_ORDER_KEY, orderNumber);
    else localStorage.removeItem(SHOPFLOW_GUEST_ORDER_KEY);
  } catch { /* private mode — the pointer simply lasts for this page view */ }
}

export async function unlockGuestShopflow(
  email: string,
  orderNumber: string,
): Promise<{ ok: boolean; token?: string; orderNumber?: string; message?: string }> {
  const cleaned = orderNumber.trim().replace(/^#/, "");
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; token?: string; message?: string }>(
    "wpw-shopflow",
    { body: { action: "unlock", email, order_number: cleaned } },
  );
  if (error) return { ok: false, message: "We couldn't reach the order system just then. Try again in a moment." };
  if (data?.ok && data.token) {
    writeGuestShopflowToken(data.token);
    // Remember WHICH job, because the guest tier shows exactly that one.
    writeGuestShopflowOrder(cleaned);
    return { ok: true, token: data.token, orderNumber: cleaned };
  }
  return { ok: false, message: data?.message || "We couldn't open that. Check the order number and the email on the order." };
}

/**
 * THE GUEST TIER — the ONE job whose number was entered, and nothing else.
 *
 * Owner, 2026-09-15: "enter job number and see only that shopflow, then once in
 * it has the WPW ShopFlow log in to see your order history and points page."
 *
 * So this is deliberately narrower than `useGuestWpwOrders`, which returns the
 * whole history and is now the SIGNED-IN shape only. Two reasons, and both
 * matter: the history, the points, the rewards and the free WallPro designs are
 * what the sign-in is for — a guest tier that already showed them would leave
 * nothing behind the door — and showing one job is less exposure, not more.
 *
 * `orderNumber` is a pointer, not a permission. The server resolves the email
 * from the verified token and requires the order to match BOTH, so editing this
 * value in the browser reads nothing that the token did not already own.
 */
export function useGuestWpwOrder(token: string | null, orderNumber: string | null) {
  return useQuery({
    queryKey: ["wpw-order-guest", token, orderNumber],
    enabled: !!token && !!orderNumber,
    queryFn: async (): Promise<MyOrdersResponse> => {
      const { data, error } = await supabase.functions.invoke<MyOrdersResponse & { error?: string }>(
        "wpw-shopflow",
        { body: { action: "order", token, order_number: orderNumber } },
      );
      if (error) throw error;
      if (!data?.ok) {
        // A refused token must not leave someone staring at a locked page.
        if (data?.error === "expired" || data?.error === "unauthorized") writeGuestShopflowToken(null);
        throw new Error(data?.message || "Failed to load that order");
      }
      return data;
    },
    staleTime: 60 * 1000,
    // The page's live-status promise, kept honestly: refetch on an interval
    // rather than claiming a subscription the guest path cannot have.
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });
}

export function useGuestWpwOrders(token: string | null) {
  return useQuery({
    queryKey: ["wpw-orders-guest", token],
    enabled: !!token,
    queryFn: async (): Promise<MyOrdersResponse> => {
      const { data, error } = await supabase.functions.invoke<MyOrdersResponse & { error?: string }>(
        "wpw-shopflow",
        { body: { action: "orders", token } },
      );
      if (error) throw error;
      if (!data?.ok) {
        // A refused token must not leave someone staring at a locked page.
        if (data?.error === "expired" || data?.error === "unauthorized") writeGuestShopflowToken(null);
        throw new Error(data?.message || "Failed to load orders");
      }
      return data;
    },
    staleTime: 60 * 1000,
    // The page's live-status promise, kept honestly: refetch on an interval
    // rather than claiming a subscription the guest path cannot have.
    refetchInterval: 60 * 1000,
    refetchIntervalInBackground: false,
  });
}

export function useWpwOrder(orderId: number | null | undefined) {
  return useQuery({
    queryKey: ["wpw-order", orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<WpwOrder | null> => {
      if (!orderId) return null;
      const { data, error } = await supabase
        .from("wpw_orders")
        .select("*, wpw_order_items(*)")
        .eq("id", orderId)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as WpwOrder) || null;
    },
  });
}

/**
 * Past orders for a given Woo customer (excluding the current order).
 * Used by WpwOrderDetailModal to surface artwork the same customer
 * uploaded on previous orders.
 *
 * Read-only direct query, gated by RLS — staff (admin role) get rows
 * via the `admins read all wpw orders` policy. Paying customers viewing
 * their own order should pass `customerOrders` to the modal directly
 * (already loaded by `wpw-orders-read`) and leave this query disabled,
 * since direct queries return zero rows for non-admins.
 */
export function useCustomerPastWpwOrders(
  wooCustomerId: number | null | undefined,
  excludeOrderId: number | null | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["wpw-customer-past-orders", wooCustomerId, excludeOrderId],
    enabled: enabled && wooCustomerId != null && wooCustomerId > 0,
    queryFn: async (): Promise<WpwOrder[]> => {
      let q = supabase
        .from("wpw_orders")
        .select("id, order_number, date_created, wpw_order_items(meta)")
        .eq("woo_customer_id", wooCustomerId!)
        .order("date_created", { ascending: false })
        .limit(25);
      if (excludeOrderId != null) q = q.neq("id", excludeOrderId);
      const { data, error } = await q;
      if (error) throw error;
      return (data as unknown as WpwOrder[]) || [];
    },
    staleTime: 60_000,
  });
}

// Lance / Troy / Brice / Trish (per Trish's instruction). Used to gate
// the "Move to next stage" UI in WpwOrderDetailModal. Server-side
// allowlist in wpw-order-update-status is the source of truth — this
// is only a frontend hint to hide the button for everyone else.
const WPW_STATUS_WRITE_ALLOWLIST = new Set([
  "lance@weprintwraps.com",
  "troy@weprintwraps.com",
  "brice@weprintwraps.com",
  "trish@weprintwraps.com",
  "trish@restyleproai.com",
  "tdill@restyleproai.com",
]);

// Mirror of ALLOWED_TRANSITIONS in wpw-order-update-status. Server is
// the source of truth; this drives the UI's button label + visibility.
export const WPW_NEXT_STATUS: Record<string, string> = {
  "processing": "in-design",
  "in-design": "design-complete",
  "design-complete": "print-production",
  "print-production": "completed",
};

export function useCanUpdateWpwStatus() {
  return useQuery({
    queryKey: ["wpw-can-update-status"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const email = (user?.email || "").toLowerCase();
      return WPW_STATUS_WRITE_ALLOWLIST.has(email);
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateWpwStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      args: { orderId: number; fromStatus: string; toStatus: string },
    ): Promise<{
      ok: boolean;
      preview?: boolean;
      order_id?: number;
      new_status?: string;
      error?: string;
      actual_status?: string;
    }> => {
      const { data, error } = await supabase.functions.invoke(
        "wpw-order-update-status",
        {
          body: {
            order_id: args.orderId,
            from_status: args.fromStatus,
            to_status: args.toStatus,
          },
        },
      );
      if (error) throw new Error(error.message || "Status update failed");
      if (!data?.ok) throw new Error(data?.error || "Status update failed");
      return data;
    },
    onSuccess: (data) => {
      if (data.preview) {
        toast.success(`(Preview) Status set to ${data.new_status} — Woo not pushed yet`);
      } else {
        toast.success(`Status updated to ${data.new_status}`);
      }
      qc.invalidateQueries({ queryKey: ["wpw-order"] });
      qc.invalidateQueries({ queryKey: ["wpw-orders"] });
      qc.invalidateQueries({ queryKey: ["pillar-wpw-orders"] });
      qc.invalidateQueries({ queryKey: ["pillar-wpw-past-jobs"] });
      qc.invalidateQueries({ queryKey: ["pillar-recent-activity"] });
      qc.invalidateQueries({ queryKey: ["wpw-customer-past-orders"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Status update failed");
    },
  });
}

/**
 * Links the current RestylePro user to their WPW customer record by
 * email. Used by the "Sign in with WePrintWraps" button on /signup
 * and /login and by the "Connect your WPW orders" CTA on the
 * dashboard My Orders page.
 *
 * Pass `{ email }` to link via an alternate company billing address
 * (must be on the same domain as the auth user's email — enforced by
 * the wpw-oauth-link edge function).
 */
export function useLinkWpwAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      args?: { email?: string },
    ): Promise<{
      ok: boolean;
      linked: boolean;
      woo_customer_id?: number;
      message?: string;
      error?: string;
    }> => {
      const altEmail = args?.email?.trim();
      const body = altEmail
        ? { mode: "byEmail" as const, email: altEmail }
        : { mode: "lookup" as const };
      const { data, error } = await supabase.functions.invoke("wpw-oauth-link", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (result) => {
      if (result.linked) {
        toast.success("WePrintWraps account linked!");
        qc.invalidateQueries({ queryKey: ["wpw-orders"] });
        qc.invalidateQueries({ queryKey: ["user-subscription"] });
      } else {
        toast.message(
          result.message ||
            "We couldn't find a WePrintWraps account matching this email.",
        );
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to link WePrintWraps account");
    },
  });
}

/**
 * Request a 6-digit OTP code to a cross-domain alt email. Used when the
 * shop's RestylePro account is on a different domain than their WPW
 * customer email (e.g. signed up under their LLC, but ordered with a
 * personal gmail). Email-ownership of the alt inbox is the proof of
 * authorization.
 */
export function useRequestWpwLinkOtp() {
  return useMutation({
    mutationFn: async (
      email: string,
    ): Promise<{ ok: boolean; sent?: boolean; error?: string; expires_in_seconds?: number }> => {
      const { data, error } = await supabase.functions.invoke("wpw-oauth-link", {
        body: { mode: "requestOtp", email: email.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to send code");
    },
  });
}

/**
 * Verify the 6-digit OTP code and complete the WPW link. On success,
 * the alt email's WPW customer is linked to this RestylePro account.
 */
export function useVerifyWpwLinkOtp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      args: { email: string; code: string },
    ): Promise<{
      ok: boolean;
      linked: boolean;
      verified?: boolean;
      woo_customer_id?: number;
      message?: string;
      error?: string;
    }> => {
      const { data, error } = await supabase.functions.invoke("wpw-oauth-link", {
        body: { mode: "verifyOtp", email: args.email.trim(), code: args.code.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (result) => {
      if (result.linked) {
        toast.success("WePrintWraps account linked!");
        qc.invalidateQueries({ queryKey: ["wpw-orders"] });
        qc.invalidateQueries({ queryKey: ["user-subscription"] });
      } else if (result.verified) {
        toast.message(
          result.message ||
            "Email verified, but no WePrintWraps customer found for that address.",
        );
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to verify code");
    },
  });
}

/**
 * Reorders a previous WPW order. Returns the new pay_url — typically
 * opened in a new tab so the customer can pay on weprintwraps.com.
 */
export function useReorderWpw() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      orderId: number,
    ): Promise<{
      ok: boolean;
      order_id?: number;
      number?: string;
      status?: string;
      pay_url?: string | null;
      error?: string;
    }> => {
      const { data, error } = await supabase.functions.invoke(
        "wpw-orders-reorder",
        { body: { orderId } },
      );
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Reorder failed");
      return data;
    },
    onSuccess: (data) => {
      if (data.pay_url) {
        toast.success(`Reorder draft #${data.number || data.order_id} created — opening checkout…`);
        window.open(data.pay_url, "_blank", "noopener,noreferrer");
      } else {
        toast.success("Reorder draft created. Check WePrintWraps for the pay link.");
      }
      qc.invalidateQueries({ queryKey: ["wpw-orders"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Reorder failed");
    },
  });
}

/** Friendly copy for a Woo order status. */
export function wpwStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Pending payment";
    case "processing":
      return "In production";
    case "on-hold":
      return "On hold";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "refunded":
      return "Refunded";
    case "failed":
      return "Failed";
    default:
      return status.replace(/[-_]/g, " ");
  }
}

/** Tailwind color classes for a Woo status badge. */
export function wpwStatusClass(status: string): string {
  switch (status) {
    case "completed":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/40";
    case "processing":
      return "bg-cyan-500/20 text-cyan-400 border-cyan-500/40";
    case "pending":
      return "bg-amber-500/20 text-amber-400 border-amber-500/40";
    case "on-hold":
      return "bg-orange-500/20 text-orange-400 border-orange-500/40";
    case "cancelled":
      return "bg-muted text-muted-foreground border-border";
    case "refunded":
      return "bg-red-500/20 text-red-400 border-red-500/40";
    case "failed":
      return "bg-red-500/20 text-red-400 border-red-500/40";
    default:
      return "bg-muted text-muted-foreground border-border";
  }
}
