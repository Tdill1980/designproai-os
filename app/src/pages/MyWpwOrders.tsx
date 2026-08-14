import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useNavigate } from "react-router-dom";
import {
  Package, RefreshCw, ExternalLink, Truck, CheckCircle2, Clock,
  ArrowLeft, Repeat2, Search, ShoppingBag, Palette, FileImage,
  ChevronRight, Star, Gift, Trophy, Zap, Crown, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useMyWpwOrders, wpwStatusClass, wpwStatusLabel, type WpwOrder } from "@/hooks/useWpwOrders";
import { useAutoSyncWpw } from "@/hooks/useAutoSyncWpw";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SignInWithWPWButton } from "@/components/SignInWithWPWButton";
import { WpwOrderDetailModal } from "@/components/dashboard/WpwOrderDetailModal";
import { orderMatchesType, type WpwOrderType } from "@/lib/wpw-order-types";
import { cn } from "@/lib/utils";

const currency = (amount: number | null, code?: string | null) => {
  if (amount == null) return "—";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(amount); }
  catch { return `$${amount.toFixed(2)}`; }
};
const formatDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};
const formatRelative = (iso: string | null) => {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

const STEPS = ["Ordered", "Confirmed", "Production", "Delivered"];
const statusStep = (s: string | null): number =>
  ({ pending: 0, "on-hold": 0, processing: 1, "design-complete": 2, "print-production": 2, completed: 3, shipped: 3, reprint: 2 }[s || ""] ?? 1);

function ProgressBar({ status }: { status: string | null }) {
  const step = statusStep(status);
  return (
    <div className="flex items-center gap-1 w-full">
      {STEPS.map((label, i) => (
        <div key={label} className="flex-1 flex flex-col items-center gap-1">
          <div className={`h-1.5 w-full rounded-full transition-all ${
            i <= step ? "bg-gradient-to-r from-[#3B82F6] to-[#D946EF]" : "bg-[#2a2a2a]"
          }`} />
          <span className={`text-[8px] font-bold uppercase tracking-wider ${
            i <= step ? "text-white/80" : "text-white/30"
          }`}>{label}</span>
        </div>
      ))}
    </div>
  );
}

// Rewards tier based on lifetime spend
function getRewardsTier(spend: number) {
  if (spend >= 10000) return { name: "Diamond", icon: Crown, color: "from-cyan-400 to-blue-500", progress: 100, next: null, nextAmount: 0 };
  if (spend >= 5000) return { name: "Gold", icon: Trophy, color: "from-amber-400 to-orange-500", progress: Math.round((spend / 10000) * 100), next: "Diamond", nextAmount: 10000 - spend };
  if (spend >= 2000) return { name: "Silver", icon: Star, color: "from-gray-300 to-gray-500", progress: Math.round((spend / 5000) * 100), next: "Gold", nextAmount: 5000 - spend };
  return { name: "Bronze", icon: Zap, color: "from-amber-600 to-amber-800", progress: Math.round((spend / 2000) * 100), next: "Silver", nextAmount: 2000 - spend };
}

function OrderCard({ order, onView }: { order: WpwOrder; onView: (id: number) => void }) {
  const items = order.wpw_order_items || [];
  const firstImage = items.find(it => it.image_url)?.image_url;
  const itemNames = items.map(it => it.name).filter(Boolean).join(", ");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onView(order.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onView(order.id);
        }
      }}
      className="group relative rounded-2xl border border-[#2a2a2a] bg-[#111111] hover:border-[#3B82F6]/40 transition-all duration-300 overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[#3B82F6]/60"
    >
      <div className="h-[2px] bg-gradient-to-r from-[#3B82F6] via-[#9b87f5] to-[#D946EF]" />
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl overflow-hidden bg-gradient-to-br from-[#3B82F6]/20 to-[#D946EF]/20 border border-[#2a2a2a] flex items-center justify-center shrink-0">
              {firstImage ? (
                <img src={firstImage} alt="" className="w-full h-full object-cover" loading="lazy" />
              ) : (
                <Palette className="w-6 h-6 text-[#D946EF]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-white">#{order.order_number || order.id}</span>
                <Badge className={`${wpwStatusClass(order.status)} text-[9px] font-bold uppercase tracking-wider`}>
                  {wpwStatusLabel(order.status)}
                </Badge>
              </div>
              <p className="text-[11px] text-white/50 mt-0.5">{formatDate(order.date_created)} · {formatRelative(order.date_created)}</p>
              {itemNames && <p className="text-[11px] text-white/60 mt-0.5 line-clamp-1">{itemNames}</p>}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#D946EF] bg-clip-text text-transparent">
              {currency(order.total, order.currency)}
            </div>
            {order.payment_method && <p className="text-[10px] text-white/40">{order.payment_method}</p>}
          </div>
        </div>

        <div className="mb-4"><ProgressBar status={order.status} /></div>

        {/* Items */}
        {items.length > 0 && (
          <div className="space-y-2 mb-4">
            {items.slice(0, 3).map((it) => (
              <div key={it.id} className="flex items-center gap-3 text-sm p-2.5 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a]">
                {it.image_url ? (
                  <img src={it.image_url} alt="" className="w-10 h-10 rounded-lg object-cover border border-[#2a2a2a]" loading="lazy" />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#3B82F6]/20 to-[#D946EF]/20 flex items-center justify-center">
                    <FileImage className="h-4 w-4 text-[#D946EF]" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="truncate font-medium text-white text-[12px]">{it.name || "Item"}</p>
                  {it.sku && <p className="text-[10px] text-white/40">SKU {it.sku}</p>}
                </div>
                <div className="text-right">
                  <span className="text-[12px] font-semibold text-white">{currency(it.total, order.currency)}</span>
                  {(Number(it.quantity) || 1) > 1 && <p className="text-[10px] text-white/40">x{it.quantity}</p>}
                </div>
              </div>
            ))}
            {items.length > 3 && <p className="text-[10px] text-white/40 text-center">+ {items.length - 3} more</p>}
          </div>
        )}

        {/* Tracking */}
        {(order.tracking_number || order.tracking_url) && (
          <div className="flex items-center gap-2 text-sm mb-4 p-3 rounded-xl bg-gradient-to-r from-[#3B82F6]/10 to-[#D946EF]/10 border border-[#3B82F6]/20">
            <Truck className="h-4 w-4 text-[#3B82F6]" />
            <span className="text-white/80 font-medium text-[12px]">
              {order.tracking_carrier ? `${order.tracking_carrier}: ` : ""}{order.tracking_number || "Shipped"}
            </span>
            {order.tracking_url && (
              <a href={order.tracking_url} target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="ml-auto text-[11px] text-[#3B82F6] hover:text-[#D946EF] font-bold flex items-center gap-1 transition-colors">
                Track <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            onClick={() => onView(order.id)}
            title="Open this order to review the items, artwork and customer note before reordering"
            className="bg-gradient-to-r from-[#3B82F6] to-[#D946EF] hover:brightness-110 text-white font-bold rounded-xl text-[11px]"
          >
            <Repeat2 className="h-3.5 w-3.5 mr-1" />
            Review &amp; Reorder
          </Button>
          {order.status === "pending" && order.pay_url && (
            <Button size="sm" asChild className="bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl text-[11px]">
              <a href={order.pay_url} target="_blank" rel="noopener noreferrer">
                <Clock className="h-3.5 w-3.5 mr-1" /> Pay Now
              </a>
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              onView(order.id);
            }}
            className="rounded-xl border-[#2a2a2a] text-white/60 hover:text-[#3B82F6] hover:border-[#3B82F6]/40 text-[11px]"
          >
            <Eye className="h-3.5 w-3.5 mr-1" />
            View Details <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

const TYPE_OPTIONS: { value: WpwOrderType; label: string }[] = [
  { value: "all", label: "All" },
  { value: "print", label: "Print" },
  { value: "design", label: "Design" },
];

export default function MyWpwOrders() {
  const navigate = useNavigate();
  const [refresh, setRefresh] = useState(false);
  const [search, setSearch] = useState("");
  const [orderType, setOrderType] = useState<WpwOrderType>("all");
  const [syncing, setSyncing] = useState(false);
  const [viewingOrderId, setViewingOrderId] = useState<number | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useMyWpwOrders({ refresh });

  // Background sync on first mount — same hook used by main dashboard.
  // This was missing on /dashboard/my-orders, which is why orders here
  // were stale (only the cached wpw_orders mirror was read).
  useAutoSyncWpw();

  // Manual sync — actually pulls from WooCommerce, not just refetches the cache
  const handleSync = async () => {
    setSyncing(true);
    setRefresh(true);
    try {
      const { data: syncData, error: syncErr } = await supabase.functions.invoke(
        "wpw-sync-orders",
        { body: { days_back: 90, per_page: 100 } }
      );
      if (syncErr) throw syncErr;
      const fetched = syncData?.orders_fetched ?? 0;
      const inserted = syncData?.orders_upserted ?? 0;
      toast.success(`Synced ${fetched} orders from WPW (${inserted} updated)`);
      await refetch();
    } catch (e: any) {
      console.error("[MyWpwOrders] sync failed:", e);
      toast.error(e?.message || "WPW sync failed");
    } finally {
      setSyncing(false);
    }
  };
  const orders = data?.orders || [];
  const linked = data?.linked ?? false;

  const filtered = useMemo(() => {
    let result = orders;
    if (orderType !== "all") {
      result = result.filter((o) => orderMatchesType(o.wpw_order_items, orderType));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((o) => [o.order_number, String(o.id), o.status, o.customer_name, o.tracking_number,
        ...(o.wpw_order_items || []).map(it => it.name), ...(o.wpw_order_items || []).map(it => it.sku),
      ].filter(Boolean).join(" ").toLowerCase().includes(q));
    }
    return result;
  }, [orders, search, orderType]);

  const typeCounts = useMemo(() => ({
    all: orders.length,
    print: orders.filter((o) => orderMatchesType(o.wpw_order_items, "print")).length,
    design: orders.filter((o) => orderMatchesType(o.wpw_order_items, "design")).length,
  }), [orders]);

  const summary = useMemo(() => {
    const t = { count: orders.length, completed: 0, inProgress: 0, spend: 0 };
    for (const o of orders) {
      if (o.status === "completed") t.completed++;
      else if (["processing", "print-production", "design-complete", "on-hold"].includes(o.status || "")) t.inProgress++;
      t.spend += Number(o.total || 0);
    }
    return t;
  }, [orders]);

  const tier = getRewardsTier(summary.spend);
  const TierIcon = tier.icon;

  return (
    <>
      <Helmet>
        <title>My Orders — WePrintWraps</title>
        <meta name="description" content="Your WePrintWraps order history — track, view files, reorder." />
      </Helmet>

      <main className="min-h-screen bg-black">
        {/* Hero header */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-r from-[#3B82F6] via-[#9b87f5] to-[#D946EF]" />
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
            <div className="flex items-center gap-2 mb-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}
                className="text-white/80 hover:text-white hover:bg-white/10 rounded-xl">
                <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
              </Button>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight font-['Montserrat']">
                  My Orders
                </h1>
                <p className="text-white/70 mt-1 text-sm">
                  Track orders, access files, and reorder in one click
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-0.5 bg-white/10 border border-white/20 rounded-xl p-0.5 backdrop-blur-sm">
                  {TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setOrderType(opt.value)}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold uppercase tracking-wider transition",
                        orderType === opt.value
                          ? "bg-white text-black"
                          : "text-white/70 hover:text-white",
                      )}
                    >
                      {opt.label}
                      <span
                        className={cn(
                          "text-[10px] font-mono px-1 rounded",
                          orderType === opt.value ? "text-black/60" : "text-white/40",
                        )}
                      >
                        {typeCounts[opt.value]}
                      </span>
                    </button>
                  ))}
                </div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                  <Input placeholder="Search orders..." value={search} onChange={(e) => setSearch(e.target.value)}
                    className="w-56 pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/40 rounded-xl" />
                </div>
                <Button size="sm" onClick={handleSync} disabled={syncing || isFetching}
                  className="bg-white/15 border border-white/30 text-white hover:bg-white/25 rounded-xl backdrop-blur-sm">
                  <RefreshCw className={`h-4 w-4 mr-1 ${syncing || isFetching ? "animate-spin" : ""}`} /> {syncing ? "Syncing…" : "Sync"}
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-6xl mx-auto px-4 sm:px-6 -mt-4 pb-12 relative z-10">
          {/* Unlinked */}
          {!isLoading && data && !linked && (
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-8 sm:p-12 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B82F6]/20 to-[#D946EF]/20 flex items-center justify-center mx-auto mb-6">
                <ShoppingBag className="h-10 w-10 text-[#D946EF]" />
              </div>
              <h2 className="text-2xl font-bold text-white mb-2">Link your WePrintWraps account</h2>
              <p className="text-white/60 mb-6 max-w-md mx-auto text-sm">
                See all past orders, track shipments, access design files, and reorder in one click. Free.
              </p>
              <SignInWithWPWButton onLinked={() => refetch()} />
            </div>
          )}

          {error && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 mb-6">
              <p className="text-sm text-red-400">Couldn't load orders: {(error as Error).message}</p>
            </div>
          )}

          {isLoading && (
            <div className="grid gap-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-6 animate-pulse">
                  <div className="h-[2px] bg-gradient-to-r from-[#3B82F6]/30 to-[#D946EF]/30 rounded-full mb-4" />
                  <div className="h-5 w-40 bg-[#1a1a1a] rounded mb-2" />
                  <div className="h-4 w-64 bg-[#1a1a1a]/60 rounded" />
                </div>
              ))}
            </div>
          )}

          {linked && !isLoading && orders.length > 0 && (
            <>
              {/* ── REWARDS TIER CARD ── */}
              <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] overflow-hidden mb-6">
                <div className={`h-[3px] bg-gradient-to-r ${tier.color}`} />
                <div className="p-6 flex flex-col sm:flex-row items-center gap-6">
                  <div className={`w-20 h-20 rounded-2xl bg-gradient-to-br ${tier.color} flex items-center justify-center shrink-0 shadow-lg`}>
                    <TierIcon className="w-10 h-10 text-white drop-shadow-md" />
                  </div>
                  <div className="flex-1 text-center sm:text-left">
                    <div className="flex items-center gap-2 justify-center sm:justify-start">
                      <span className={`text-2xl font-bold bg-gradient-to-r ${tier.color} bg-clip-text text-transparent font-['Montserrat']`}>
                        {tier.name} Member
                      </span>
                      <Gift className="w-5 h-5 text-[#D946EF]" />
                    </div>
                    <p className="text-white/60 text-sm mt-1">
                      Lifetime spend: <span className="text-white font-bold">{currency(summary.spend, "USD")}</span>
                      {tier.next && (
                        <> · <span className="text-[#3B82F6]">{currency(tier.nextAmount, "USD")}</span> to <span className="font-semibold text-white">{tier.next}</span></>
                      )}
                    </p>
                    {/* Progress bar to next tier */}
                    <div className="mt-3 w-full max-w-xs mx-auto sm:mx-0">
                      <div className="h-2 bg-[#2a2a2a] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full bg-gradient-to-r ${tier.color} transition-all duration-500`}
                          style={{ width: `${Math.min(tier.progress, 100)}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 shrink-0">
                    <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] p-3 text-center min-w-[80px]">
                      <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Orders</p>
                      <p className="text-xl font-bold text-white font-['Montserrat']">{summary.count}</p>
                    </div>
                    <div className="rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] p-3 text-center min-w-[80px]">
                      <p className="text-[10px] font-bold text-white/50 uppercase tracking-wider">Points</p>
                      <p className="text-xl font-bold bg-gradient-to-r from-[#3B82F6] to-[#D946EF] bg-clip-text text-transparent font-['Montserrat']">
                        {Math.round(summary.spend / 10)}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
                {[
                  { label: "Total Orders", value: summary.count, icon: Package, color: "text-[#3B82F6]" },
                  { label: "Completed", value: summary.completed, icon: CheckCircle2, color: "text-emerald-400" },
                  { label: "In Progress", value: summary.inProgress, icon: Clock, color: "text-amber-400" },
                  { label: "Lifetime Spend", value: currency(summary.spend, "USD"), icon: Star, color: "text-[#D946EF]" },
                ].map((s) => (
                  <div key={s.label} className="rounded-xl border border-[#2a2a2a] bg-[#111111] p-4">
                    <div className="flex items-center gap-1.5 mb-1">
                      <s.icon className={`w-3.5 h-3.5 ${s.color}`} />
                      <span className="text-[10px] font-bold text-white/50 uppercase tracking-wider">{s.label}</span>
                    </div>
                    <p className={`text-2xl font-bold ${s.color} font-['Montserrat']`}>{s.value}</p>
                  </div>
                ))}
              </div>

              {/* Orders list */}
              <div className="space-y-4">
                {filtered.map((o) => <OrderCard key={o.id} order={o} onView={setViewingOrderId} />)}
                {filtered.length === 0 && (
                  <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-8 text-center">
                    <Search className="w-8 h-8 text-white/20 mx-auto mb-3" />
                    <p className="text-white/50">
                      No {orderType === "all" ? "" : orderType + " "}orders
                      {search ? ` match "${search}"` : " in this view"}
                    </p>
                  </div>
                )}
              </div>

              {data?.fromCache === false && (
                <p className="text-[10px] text-white/30 text-center mt-6 flex items-center justify-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" /> Synced live from WePrintWraps
                </p>
              )}
            </>
          )}

          {linked && !isLoading && orders.length === 0 && (
            <div className="rounded-2xl border border-[#2a2a2a] bg-[#111111] p-8 sm:p-12 text-center">
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-[#3B82F6]/20 to-[#D946EF]/20 flex items-center justify-center mx-auto mb-6">
                <Package className="h-10 w-10 text-[#3B82F6]" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">No orders yet</h2>
              <p className="text-white/50 mb-6">Your account is linked. Place your first order to start earning rewards.</p>
              <Button asChild className="bg-gradient-to-r from-[#3B82F6] to-[#D946EF] hover:brightness-110 text-white rounded-xl">
                <a href="https://weprintwraps.com" target="_blank" rel="noopener noreferrer">
                  Browse WePrintWraps <ExternalLink className="h-4 w-4 ml-1.5" />
                </a>
              </Button>
            </div>
          )}
        </div>
      </main>
      <WpwOrderDetailModal
        orderId={viewingOrderId}
        onClose={() => setViewingOrderId(null)}
        initialOrder={
          viewingOrderId != null
            ? orders.find((o) => o.id === viewingOrderId) || null
            : null
        }
        customerOrders={orders}
      />
    </>
  );
}
