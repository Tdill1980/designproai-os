import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Package, Truck, ExternalLink, Repeat2, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useIsWpwInternalStaff } from "@/hooks/useIsWpwInternalStaff";
import {
  useMyWpwOrders, useReorderWpw, wpwStatusClass, wpwStatusLabel,
  type WpwOrder,
} from "@/hooks/useWpwOrders";

const db = supabase as never as { from: (t: string) => any };

const STEPS = ["Ordered", "Confirmed", "Production", "Delivered"];
const statusStep = (s: string | null): number =>
  ({ pending: 0, "on-hold": 0, processing: 1, "design-complete": 2, "print-production": 2, completed: 3, shipped: 3, reprint: 2 }[s || ""] ?? 1);

function MiniProgress({ status }: { status: string | null }) {
  const step = statusStep(status);
  return (
    <div className="flex items-center gap-0.5 w-full">
      {STEPS.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-0.5">
          <div className={`h-1 w-full rounded-full transition-all ${
            i <= step ? "bg-gradient-to-r from-[#3B82F6] to-[#D946EF]" : "bg-[#48484a]"
          }`} />
          <span className={`text-[7px] font-bold uppercase tracking-wider ${
            i <= step ? "text-white/70" : "text-white/25"
          }`}>{label}</span>
        </div>
      ))}
    </div>
  );
}

const formatDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const currency = (amount: number | null) => {
  if (amount == null) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount); }
  catch { return `$${(amount ?? 0).toFixed(2)}`; }
};

/** WPW internal team sees ALL recent orders across all customers. */
function useAllWpwOrders(enabled: boolean) {
  return useQuery<WpwOrder[]>({
    queryKey: ["wpw-all-orders-admin"],
    enabled,
    queryFn: async () => {
      const { data, error } = await db
        .from("wpw_orders")
        .select("*, wpw_order_items(*)")
        .order("date_created", { ascending: false })
        .limit(50);
      if (error) { console.warn("wpw all-orders query:", error.message); return []; }
      return (data || []) as WpwOrder[];
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
}

function OrderRow({ order, showCustomer }: { order: WpwOrder; showCustomer?: boolean }) {
  const reorder = useReorderWpw();
  const itemName = order.wpw_order_items?.[0]?.name;

  return (
    <div className="rounded-xl border border-[#48484a] bg-rp-elevated p-3 space-y-2">
      {/* Top line: order # + status + total */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[11px] font-bold text-white shrink-0">
            #{order.order_number || order.id}
          </span>
          <Badge className={`${wpwStatusClass(order.status)} text-[8px] font-bold uppercase tracking-wider px-1.5 py-0`}>
            {wpwStatusLabel(order.status)}
          </Badge>
        </div>
        <span className="text-[12px] font-bold bg-gradient-to-r from-[#3B82F6] to-[#D946EF] bg-clip-text text-transparent shrink-0">
          {currency(order.total)}
        </span>
      </div>

      {/* Customer name (admin view) + Item name + date */}
      <div className="flex items-center justify-between text-[10px] text-white/50">
        <span className="truncate mr-2">
          {showCustomer && order.customer_name ? `${order.customer_name} · ` : ""}
          {itemName || "—"}
        </span>
        <span className="shrink-0">{formatDate(order.date_created)}</span>
      </div>

      {/* Progress bar */}
      <MiniProgress status={order.status} />

      {/* Actions row */}
      <div className="flex items-center gap-1.5 pt-1">
        {order.tracking_url && (
          <a
            href={order.tracking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] text-[#3B82F6] hover:text-[#60A5FA] font-semibold transition-colors"
          >
            <Truck className="h-3 w-3" /> Track
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={reorder.isPending}
          onClick={() => reorder.mutate(order.id)}
          className="ml-auto h-6 px-2 text-[10px] text-white/50 hover:text-[#D946EF] hover:bg-transparent"
        >
          <Repeat2 className="h-3 w-3 mr-0.5" />
          {reorder.isPending ? "..." : "Reorder"}
        </Button>
      </div>
    </div>
  );
}

export function WpwOrderStatusCard() {
  const navigate = useNavigate();
  const { data: isWpwTenant = false } = useIsWpwTenant();
  const { data: isWpwInternalStaff = false } = useIsWpwInternalStaff();
  const { data, isLoading } = useMyWpwOrders();
  const linked = data?.linked ?? false;
  const personalOrders = data?.orders || [];

  // PRIVACY: only RestylePro/WPW internal staff see the cross-tenant admin
  // view. Onboarded WPW shop tenants must see ONLY their own orders, even
  // though they pass useIsWpwTenant. Internal staff is allowlist-only.
  const { data: allOrders = [], isLoading: allLoading } = useAllWpwOrders(isWpwInternalStaff);

  const isAdmin = isWpwInternalStaff;
  const orders = isAdmin ? allOrders : personalOrders;
  const loading = isAdmin ? allLoading : isLoading;

  // Latest 3 orders
  const latest = useMemo(() => {
    return [...orders]
      .sort((a, b) => new Date(b.date_created || 0).getTime() - new Date(a.date_created || 0).getTime())
      .slice(0, 3);
  }, [orders]);

  // Hide for non-WPW users who aren't linked
  if (!linked && !isWpwTenant) return null;

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#48484a] bg-rp-surface p-5 animate-pulse">
        <div className="h-5 w-32 bg-rp-elevated rounded mb-3" />
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 bg-rp-elevated rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#48484a] bg-rp-surface overflow-hidden h-full">
      <div className="h-[3px] bg-gradient-to-r from-[#3B82F6] to-[#D946EF]" />
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4 text-[#3B82F6]" />
            <span className="text-[10px] uppercase tracking-[0.15em] text-white/70 font-semibold">
              {isAdmin ? "WPW Order Status" : "Order Status"}
            </span>
            {isAdmin && (
              <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-[#D946EF]/20 text-[#D946EF] border border-[#D946EF]/30">
                Admin
              </span>
            )}
          </div>
          <span className="text-[10px] text-white/40">{orders.length} total</span>
        </div>

        {latest.length === 0 ? (
          <div className="text-center py-6">
            <Package className="w-8 h-8 text-white/20 mx-auto mb-2" />
            <p className="text-[11px] text-white/40">No orders yet</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {latest.map((o) => (
              <OrderRow key={o.id} order={o} showCustomer={isAdmin} />
            ))}
          </div>
        )}

        {/* View all CTA */}
        {orders.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => navigate("/my-orders")}
            className="w-full mt-4 text-[11px] text-white/60 hover:text-[#3B82F6] hover:bg-rp-elevated rounded-xl"
          >
            View All Orders <ChevronRight className="h-3.5 w-3.5 ml-1" />
          </Button>
        )}
      </div>
    </div>
  );
}
