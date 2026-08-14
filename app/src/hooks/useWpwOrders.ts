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
}

export interface MyOrdersResponse {
  ok: boolean;
  linked: boolean;
  fromCache?: boolean;
  orders: WpwOrder[];
  message?: string;
  error?: string;
}

/**
 * Returns the caller's WPW order history.
 * `linked` is false when the user hasn't connected a WPW account yet.
 */
export function useMyWpwOrders(options?: { refresh?: boolean }) {
  return useQuery({
    queryKey: ["wpw-orders", options?.refresh ? "refresh" : "cached"],
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
