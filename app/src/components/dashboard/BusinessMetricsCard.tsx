/**
 * BusinessMetricsCard — three-tab analytics for the Profit pillar.
 *
 * Tab 1: "WPW Orders" — real WooCommerce order totals from wpw_orders
 * Tab 2: "QuoteTool"  — public QuickQuote Web Tool quote funnel
 * Tab 3: "Reg Quotes" — internally-entered admin QuickQuote funnel
 *
 * Each tab has its own data source and stat layout. The orders tab shows
 * actual revenue totals; the two quote tabs show funnel + conversion.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Receipt,
  Target,
  Percent,
  Send,
  Globe,
  Keyboard,
  Package,
  ShoppingBag,
  Clock,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useWpwAnalytics, type WpwRange } from "@/hooks/useWpwAnalytics";

type RangeOption = 0 | 7 | 30 | 90 | 365;
type SourceTab = "orders" | "webtool" | "internal" | "all";

const COMPLETED_STATUSES = new Set(["completed", "shipped"]);
const IN_PROGRESS_STATUSES = new Set([
  "processing",
  "in-design",
  "design-complete",
  "print-production",
  "on-hold",
  "reprint",
]);

const db = supabase as never as { from: (t: string) => any };

const normalizeDollars = (value: number | null | undefined): number => {
  if (!value && value !== 0) return 0;
  return value > 1000 && Number.isInteger(value) ? value / 100 : value;
};

const formatMoney = (amount: number) => `$${amount.toLocaleString()}`;

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: 0, label: "Daily" },
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
];

// Web Tool quotes come from the WPW website integration
const WEB_TOOL_SOURCES = ["WPW"];

interface MetricsData {
  revenue: number;
  orderCount: number;
  totalQuotes: number;
  sentCount: number;
  conversionRate: number;
  trendLabel: string;
  trendPositive: boolean;
}

interface RegQuoteRepRow {
  key: string;
  label: string;
  total: number;
  converted: number;
  revenue: number;
  conversionRate: number;
}

/**
 * Per-rep breakdown for the "Reg Quotes" tab. Pulls internal quotes
 * (public.quotes only — customer_quotes is anonymous public-tool input)
 * and groups by created_by so the shop can see which rep is converting.
 *
 * `status === 'converted'` is set either by the rep clicking "Convert
 * to Order" in SavedQuotesTable, or by wpw-sync-orders when it matches
 * a real WooCommerce order back to the quote — so converted = real Woo
 * order in both cases.
 */
const useRegQuoteRepBreakdown = (days: RangeOption) => {
  return useQuery<RegQuoteRepRow[]>({
    queryKey: ["dashboard-reg-quote-reps", days],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];

      const lookback = days === 0 ? 1 : days;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      if (days > 0) since.setDate(since.getDate() - days);
      const sinceIso = since.toISOString();

      const { data, error } = await db
        .from("quotes")
        .select("created_by, status, customer_total, metadata")
        .not("quote_number", "like", "DEMO-%")
        .gte("created_at", sinceIso);

      if (error || !data) return [];

      const byRep = new Map<string, RegQuoteRepRow>();
      let untaggedCount = 0;
      let untaggedConverted = 0;
      let untaggedRevenue = 0;

      for (const r of data as any[]) {
        const isConverted = r.status === "converted";
        const wooTotal = r.metadata?.woo_order_total ? parseFloat(r.metadata.woo_order_total) : 0;
        const rev = isConverted ? (wooTotal > 0 ? wooTotal : normalizeDollars(r.customer_total)) : 0;

        if (!r.created_by) {
          untaggedCount++;
          if (isConverted) untaggedConverted++;
          untaggedRevenue += rev;
          continue;
        }

        const meta = r.metadata || {};
        const label = (meta.created_by_name as string | undefined)
          || (meta.created_by_email as string | undefined)
          || "Team";

        const existing = byRep.get(r.created_by);
        if (existing) {
          existing.total++;
          if (isConverted) existing.converted++;
          existing.revenue += rev;
          if (existing.label === "Team" && label !== "Team") existing.label = label;
        } else {
          byRep.set(r.created_by, {
            key: r.created_by,
            label,
            total: 1,
            converted: isConverted ? 1 : 0,
            revenue: rev,
            conversionRate: 0,
          });
        }
      }

      const rows = Array.from(byRep.values()).map((r) => ({
        ...r,
        revenue: Math.round(r.revenue),
        conversionRate: r.total > 0 ? Math.round((r.converted / r.total) * 1000) / 10 : 0,
      }));

      if (untaggedCount > 0) {
        rows.push({
          key: "__untagged__",
          label: "Untagged",
          total: untaggedCount,
          converted: untaggedConverted,
          revenue: Math.round(untaggedRevenue),
          conversionRate: untaggedCount > 0 ? Math.round((untaggedConverted / untaggedCount) * 1000) / 10 : 0,
        });
      }

      rows.sort((a, b) => b.converted - a.converted || b.total - a.total);
      return rows;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });
};

interface WpwOrderMetricsData {
  revenue: number;
  orderCount: number;
  completedCount: number;
  inProgressCount: number;
  pendingCount: number;
  avgOrderValue: number;
  trendLabel: string;
  trendPositive: boolean;
}

/**
 * Pulls real WooCommerce order totals from the local wpw_orders mirror.
 * Sums `total` across all orders in the lookback window. Trend compares
 * the 2nd half of the window against the 1st half.
 */
const useWpwOrderMetrics = (days: RangeOption) => {
  return useQuery<WpwOrderMetricsData>({
    queryKey: ["dashboard-wpw-order-metrics", days],
    queryFn: async () => {
      const empty: WpwOrderMetricsData = {
        revenue: 0, orderCount: 0, completedCount: 0, inProgressCount: 0,
        pendingCount: 0, avgOrderValue: 0, trendLabel: "No orders yet", trendPositive: true,
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return empty;

      const lookback = days === 0 ? 1 : days;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      if (days > 0) since.setDate(since.getDate() - days);
      const sinceIso = since.toISOString();

      const { data, error } = await db
        .from("wpw_orders")
        .select("id, status, total, date_created")
        .gte("date_created", sinceIso)
        .order("date_created", { ascending: true });

      if (error || !data) return empty;
      const rows: { status: string | null; total: number | null; date_created: string }[] = data;

      let revenue = 0;
      let completedCount = 0;
      let inProgressCount = 0;
      let pendingCount = 0;
      for (const r of rows) {
        const t = typeof r.total === "number" ? r.total : 0;
        revenue += t;
        const s = r.status || "";
        if (COMPLETED_STATUSES.has(s)) completedCount++;
        else if (IN_PROGRESS_STATUSES.has(s)) inProgressCount++;
        else pendingCount++;
      }
      const orderCount = rows.length;
      const avgOrderValue = orderCount > 0 ? revenue / orderCount : 0;

      // Trend: 2nd half revenue minus 1st half (rows already sorted asc)
      const mid = Math.floor(rows.length / 2);
      const firstHalf = rows.slice(0, mid).reduce((a, r) => a + (r.total || 0), 0);
      const secondHalf = rows.slice(mid).reduce((a, r) => a + (r.total || 0), 0);
      const delta = secondHalf - firstHalf;
      const trendLabel = revenue === 0
        ? "No orders yet"
        : delta === 0 ? "Flat"
        : delta > 0 ? `+${formatMoney(Math.round(delta))}`
        : `${formatMoney(Math.round(delta))}`;

      return {
        revenue: Math.round(revenue),
        orderCount,
        completedCount,
        inProgressCount,
        pendingCount,
        avgOrderValue: Math.round(avgOrderValue),
        trendLabel,
        trendPositive: delta >= 0,
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });
};

const useTabMetrics = (days: RangeOption, tab: SourceTab) => {
  return useQuery<MetricsData>({
    queryKey: ["dashboard-business-metrics", days, tab],
    queryFn: async () => {
      const empty: MetricsData = {
        revenue: 0, orderCount: 0, totalQuotes: 0, sentCount: 0,
        conversionRate: 0, trendLabel: "No orders yet", trendPositive: true,
      };

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return empty;

      const lookback = days === 0 ? 1 : days;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      if (days > 0) since.setDate(since.getDate() - days);
      const sinceIso = since.toISOString();

      // Fetch from BOTH quote pipelines:
      //   - public.quotes        — internal admin QuickQuote tool
      //   - public.customer_quotes — public homepage / sub-account quote tool
      //                              (includes WPW webhook conversions)
      // Then normalize into a single shape and split by source. RLS scopes
      // each query to the user's shop automatically.
      const [internalRes, publicRes] = await Promise.all([
        db
          .from("quotes")
          .select("status, customer_total, metadata, tool_source, created_at")
          .gte("created_at", sinceIso),
        db
          .from("customer_quotes")
          .select("status, quote_total, created_at, notes")
          .gte("created_at", sinceIso),
      ]);

      const internalRows = (internalRes?.data || []).map((r: any) => ({
        status: r.status,
        customer_total: r.customer_total,
        metadata: r.metadata,
        tool_source: r.tool_source,
        created_at: r.created_at,
        _origin: "internal" as const,
      }));

      // customer_quotes are anonymous public submissions → treat as web-tool source.
      const publicRows = (publicRes?.data || []).map((r: any) => ({
        status: r.status === "new" ? "quoted" : r.status,
        customer_total: r.quote_total,
        metadata: null,
        tool_source: "WPW",
        created_at: r.created_at,
        _origin: "public" as const,
      }));

      const rows = [...internalRows, ...publicRows];

      // Split by source — "all" shows everything (for non-WPW tenants)
      const filtered = tab === "all" ? rows : rows.filter((r) => {
        const isWebTool = WEB_TOOL_SOURCES.includes(r.tool_source) || r._origin === "public";
        return tab === "webtool" ? isWebTool : !isWebTool;
      });

      const totalQuotes = filtered.length;
      const sentCount = filtered.filter((r) => r.status === "sent").length;
      const converted = filtered.filter((r) => r.status === "converted");
      const orderCount = converted.length;

      let revenue = 0;
      converted.forEach((row: any) => {
        const wooTotal = row.metadata?.woo_order_total ? parseFloat(row.metadata.woo_order_total) : 0;
        revenue += wooTotal > 0 ? wooTotal : normalizeDollars(row.customer_total);
      });

      const conversionRate = totalQuotes > 0 && orderCount > 0
        ? Math.round((orderCount / totalQuotes) * 1000) / 10
        : 0;

      // Trend
      const mid = Math.floor(converted.length / 2);
      const firstHalf = converted.slice(0, mid).reduce((a: number, r: any) => {
        const wt = r.metadata?.woo_order_total ? parseFloat(r.metadata.woo_order_total) : 0;
        return a + (wt > 0 ? wt : normalizeDollars(r.customer_total));
      }, 0);
      const secondHalf = converted.slice(mid).reduce((a: number, r: any) => {
        const wt = r.metadata?.woo_order_total ? parseFloat(r.metadata.woo_order_total) : 0;
        return a + (wt > 0 ? wt : normalizeDollars(r.customer_total));
      }, 0);
      const delta = secondHalf - firstHalf;
      const trendLabel = revenue === 0
        ? "No orders yet"
        : delta === 0 ? "Flat"
        : delta > 0 ? `+${formatMoney(Math.round(delta))}`
        : `${formatMoney(Math.round(delta))}`;

      return {
        revenue: Math.round(revenue),
        orderCount,
        totalQuotes,
        sentCount,
        conversionRate,
        trendLabel,
        trendPositive: delta >= 0,
      };
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });
};

/** Upsell shown to non-WPW tenants — case study numbers from WePrintWraps. */
const WebToolUpsell = () => (
  <div className="flex-1 flex flex-col gap-2 py-1">
    <div className="rounded-lg border border-[#3b82f6]/20 bg-[#3b82f6]/5 px-3 py-2">
      <div className="text-[9px] font-bold uppercase tracking-wider text-[#3b82f6] mb-1.5">
        Case study: WePrintWraps · 90d
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center">
          <div className="text-sm font-bold text-white">1,375</div>
          <div className="text-[8px] text-white/40 uppercase font-bold">Quotes</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-white">641</div>
          <div className="text-[8px] text-white/40 uppercase font-bold">Sent</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-[#10b981]">131</div>
          <div className="text-[8px] text-white/40 uppercase font-bold">Converted</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold text-[#ec4899]">9.5%</div>
          <div className="text-[8px] text-white/40 uppercase font-bold">Rate</div>
        </div>
      </div>
    </div>
    <div className="text-center">
      <div className="text-[10px] text-white/50 mb-1.5 leading-snug">
        Add QuickQuote Web Tool to your site. Capture leads 24/7.
      </div>
      <a
        href="/pricing"
        className="inline-block px-5 py-1.5 rounded-lg bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white text-[10px] font-bold uppercase tracking-wider hover:brightness-110 transition pointer-events-auto"
      >
        Get Web Tool for Your Site
      </a>
    </div>
  </div>
);

interface BusinessMetricsCardProps {
  className?: string;
  compact?: boolean;
}

export const BusinessMetricsCard = ({ className, compact = false }: BusinessMetricsCardProps) => {
  const [range, setRange] = useState<RangeOption>(90);
  const { data: isWpw = false } = useIsWpwTenant();
  const [tab, setTab] = useState<SourceTab>("orders");
  const isOrdersTab = tab === "orders";
  // Non-WPW on "internal" tab → show all their quotes. On "webtool" → upsell.
  const activeTab = isWpw ? tab : (tab === "internal" ? "all" : "webtool");
  const showUpsell = !isWpw && tab === "webtool";
  const { data: localMetrics, isLoading: localLoading } = useTabMetrics(
    range,
    showUpsell ? "all" : (activeTab as Exclude<SourceTab, "orders">),
  );

  // WPW Orders tab — real WooCommerce totals from wpw_orders.
  const { data: orderMetrics, isLoading: orderLoading } = useWpwOrderMetrics(range);

  // Reg Quotes tab — per-rep breakdown (Lance / Jackson / etc.)
  const isRegTab = tab === "internal";
  const { data: repRows = [], isLoading: repLoading } = useRegQuoteRepBreakdown(range);

  // For WPW tenants viewing the "QuoteTool" tab, replace local metrics with
  // cross-project data from the WPW analytics-dashboard endpoint (which
  // sees all 1,288 historical quotes that don't live on this Supabase).
  // The "Reg Quotes" tab still uses local data — internal QuickQuote saves
  // do live on this project. "Today" maps to range=1 on WPW's API.
  const wpwRangeMap: Record<RangeOption, WpwRange> = { 0: 1, 7: 7, 30: 30, 90: 90, 365: 365 };
  const useWpwView = isWpw && tab === "webtool";
  const { data: wpwData, isLoading: wpwLoading } = useWpwAnalytics(wpwRangeMap[range], {
    enabled: useWpwView,
  });

  const m = useWpwView && wpwData?.metrics
    ? {
        revenue: wpwData.metrics.revenue,
        orderCount: wpwData.metrics.order_count,
        totalQuotes: wpwData.metrics.total_quotes,
        sentCount: wpwData.metrics.sent_count,
        conversionRate: wpwData.metrics.conversion_rate,
        trendLabel: wpwData.metrics.trend_label,
        trendPositive: wpwData.metrics.trend_positive,
      }
    : localMetrics;
  const quoteLoading = useWpwView ? wpwLoading : localLoading;
  const isLoading = isOrdersTab
    ? orderLoading
    : isRegTab
      ? (repLoading || quoteLoading)
      : quoteLoading;

  // Header revenue + trend pull from whichever tab is active
  const headerRevenue = isOrdersTab ? (orderMetrics?.revenue ?? 0) : (m?.revenue ?? 0);
  const headerTrendLabel = isOrdersTab ? (orderMetrics?.trendLabel ?? "") : (m?.trendLabel ?? "");
  const headerTrendPositive = isOrdersTab ? (orderMetrics?.trendPositive ?? true) : (m?.trendPositive ?? true);

  const quoteStats = useMemo(() => {
    if (!m) return [];
    return [
      { icon: Receipt, label: "Quotes", value: String(m.totalQuotes), color: "text-[#60a5fa]" },
      { icon: Send, label: "Sent", value: String(m.sentCount), color: "text-[#a78bfa]" },
      { icon: Target, label: "Converted", value: String(m.orderCount), color: "text-[#10b981]" },
      { icon: Percent, label: "Conv. rate", value: `${m.conversionRate}%`, color: "text-[#ec4899]" },
    ];
  }, [m]);

  const orderStats = useMemo(() => {
    if (!orderMetrics) return [];
    return [
      { icon: ShoppingBag, label: "Orders", value: String(orderMetrics.orderCount), color: "text-[#60a5fa]" },
      { icon: DollarSign, label: "AOV", value: formatMoney(orderMetrics.avgOrderValue), color: "text-[#a78bfa]" },
      { icon: Clock, label: "In progress", value: String(orderMetrics.inProgressCount), color: "text-[#f59e0b]" },
      { icon: CheckCircle2, label: "Completed", value: String(orderMetrics.completedCount), color: "text-[#10b981]" },
    ];
  }, [orderMetrics]);

  const stats = isOrdersTab ? orderStats : quoteStats;

  const tabLabel = isOrdersTab
    ? "WPW Orders (live)"
    : showUpsell ? "QuoteTool Web"
    : !isWpw ? "Reg Quotes"
    : tab === "webtool" ? "QuoteTool Web"
    : "Reg Quotes";

  return (
    <div
      className={cn(
        "relative overflow-hidden flex flex-col",
        compact
          ? "h-[220px] max-h-[220px]"
          : "rounded-2xl border border-[#48484a] bg-rp-surface p-4 sm:p-5 h-[340px] max-h-[340px]",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-md bg-rp-elevated border border-[#48484a] flex items-center justify-center shrink-0">
            <DollarSign className="w-3.5 h-3.5 text-[#3b82f6]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-white uppercase tracking-[0.15em] leading-tight">
              Revenue
            </h3>
            <div className="text-[10px] text-white/40 leading-tight">
              {tabLabel} · {range === 0 ? "Daily" : `${range}d`}
            </div>
          </div>
        </div>
        {(isOrdersTab ? orderMetrics : m) && (
          <div className="text-right shrink-0">
            <div className="text-xl font-bold bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent leading-none">
              {formatMoney(headerRevenue)}
            </div>
            <div
              className={cn(
                "text-[9px] font-semibold uppercase mt-0.5 flex items-center gap-0.5 justify-end",
                headerTrendPositive ? "text-[#3b82f6]" : "text-[#F87171]"
              )}
            >
              {headerRevenue > 0 && (headerTrendPositive ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />)}
              {headerTrendLabel}
            </div>
          </div>
        )}
      </div>

      {/* Source tabs (WPW only) + Range pills.
          flex-wrap so the range pills drop to a second row on narrow
          mobile columns where they would otherwise be clipped by the
          card's overflow-hidden boundary. */}
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5 mb-2">
        {/* Source tabs: WPW Orders (real Woo totals) | QuoteTool (web) | Reg Quotes (internal) */}
        <div className="flex items-center gap-0.5 bg-[#1c1c1e] rounded-lg p-0.5 border border-[#3a3a3c]">
          <button
            onClick={() => setTab("orders")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all",
              tab === "orders"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                : "text-white/50 hover:text-white/80"
            )}
            title="Real WooCommerce order totals"
          >
            <Package className="w-2.5 h-2.5" />
            WPW Orders
          </button>
          <button
            onClick={() => setTab("webtool")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all",
              tab === "webtool"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                : "text-white/50 hover:text-white/80"
            )}
            title="Public QuickQuote Web Tool funnel"
          >
            <Globe className="w-2.5 h-2.5" />
            QuoteTool
          </button>
          <button
            onClick={() => setTab("internal")}
            className={cn(
              "flex items-center gap-1 px-2 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all",
              tab === "internal"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                : "text-white/50 hover:text-white/80"
            )}
            title="Internal admin QuickQuote funnel"
          >
            <Keyboard className="w-2.5 h-2.5" />
            Reg Quotes
          </button>
        </div>

        {/* Range pills */}
        <div className="flex items-center gap-0.5 bg-[#1c1c1e] rounded-lg p-0.5 border border-[#3a3a3c]">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={cn(
                "px-1.5 py-1 text-[9px] font-bold uppercase tracking-wider rounded-md transition-all",
                range === opt.value
                  ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                  : "text-white/40 hover:text-white/70"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {showUpsell ? (
        <WebToolUpsell />
      ) : isLoading ? (
        <div className="flex-1 rounded-lg bg-rp-elevated animate-pulse" />
      ) : isOrdersTab ? (
        <div className="flex-1 flex flex-col gap-1.5">
          {/* Status distribution bar */}
          {orderMetrics && orderMetrics.orderCount > 0 && (() => {
            const total = orderMetrics.orderCount;
            const completedPct = (orderMetrics.completedCount / total) * 100;
            const inProgressPct = (orderMetrics.inProgressCount / total) * 100;
            const pendingPct = Math.max(0, 100 - completedPct - inProgressPct);
            return (
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">
                    {orderMetrics.completedCount}/{total} completed
                  </span>
                  <span className="text-[9px] font-bold text-[#10b981]">
                    {Math.round(completedPct)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-[#1c1c1e] border border-[#3a3a3c] overflow-hidden flex">
                  <div className="h-full bg-[#10b981]" style={{ width: `${completedPct}%` }} />
                  <div className="h-full bg-[#f59e0b]" style={{ width: `${inProgressPct}%` }} />
                  <div className="h-full bg-white/10" style={{ width: `${pendingPct}%` }} />
                </div>
              </div>
            );
          })()}

          {/* Stats grid */}
          <div className="grid grid-cols-4 gap-1.5 flex-1">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-md bg-[#1c1c1e] border border-[#3a3a3c] px-2 py-1.5 flex flex-col items-center justify-center"
              >
                <s.icon className={cn("w-3 h-3 mb-0.5", s.color)} />
                <div className="text-sm font-bold text-white leading-tight">
                  {s.value}
                </div>
                <div className="text-[8px] font-bold uppercase tracking-wider text-white/35 leading-tight">
                  {s.label}
                </div>
              </div>
            ))}
          </div>

          {orderMetrics && orderMetrics.orderCount === 0 && (
            <div className="text-center py-1">
              <div className="text-[10px] text-white/40">No WPW orders in this window.</div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-1.5 min-h-0">
          {/* Conversion bar — shared across QuoteTool + Reg Quotes */}
          {m && m.totalQuotes > 0 && (
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[9px] font-bold uppercase tracking-wider text-white/50">
                  {m.orderCount}/{m.totalQuotes} converted to WPW orders
                </span>
                <span className="text-[9px] font-bold text-[#10b981]">
                  {m.conversionRate}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-[#1c1c1e] border border-[#3a3a3c] overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#3b82f6] via-[#8b5cf6] to-[#ec4899] transition-all duration-500"
                  style={{ width: `${Math.min(100, m.conversionRate)}%` }}
                />
              </div>
            </div>
          )}

          {isRegTab ? (
            /* Per-rep breakdown — Lance / Jackson / Trish etc. */
            repRows.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-center">
                <div className="text-[10px] text-white/40">
                  No team-entered quotes in this window.
                </div>
              </div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto pr-0.5">
                <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 gap-y-0.5 items-center">
                  <div className="text-[8px] font-bold uppercase tracking-wider text-white/35 px-1">Rep</div>
                  <div className="text-[8px] font-bold uppercase tracking-wider text-white/35 text-right">Quotes</div>
                  <div className="text-[8px] font-bold uppercase tracking-wider text-white/35 text-right">Conv.</div>
                  <div className="text-[8px] font-bold uppercase tracking-wider text-white/35 text-right">Rate</div>
                  {repRows.map((r) => (
                    <div key={r.key} className="contents">
                      <div className="text-[10px] font-semibold text-white truncate px-1 py-0.5 rounded-md bg-[#1c1c1e] border border-[#3a3a3c]">
                        {r.label}
                      </div>
                      <div className="text-[10px] font-bold text-white/80 text-right px-1.5">
                        {r.total}
                      </div>
                      <div className="text-[10px] font-bold text-[#10b981] text-right px-1.5">
                        {r.converted}
                      </div>
                      <div className="text-[10px] font-bold text-[#ec4899] text-right px-1.5">
                        {r.conversionRate}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )
          ) : (
            <>
              {/* Stats grid (QuoteTool tab) */}
              <div className="grid grid-cols-4 gap-1.5 flex-1">
                {stats.map((s) => (
                  <div
                    key={s.label}
                    className="rounded-md bg-[#1c1c1e] border border-[#3a3a3c] px-2 py-1.5 flex flex-col items-center justify-center"
                  >
                    <s.icon className={cn("w-3 h-3 mb-0.5", s.color)} />
                    <div className="text-sm font-bold text-white leading-tight">
                      {s.value}
                    </div>
                    <div className="text-[8px] font-bold uppercase tracking-wider text-white/35 leading-tight">
                      {s.label}
                    </div>
                  </div>
                ))}
              </div>

              {/* Empty state */}
              {m && m.revenue === 0 && m.totalQuotes === 0 && (
                <div className="text-center py-1">
                  <div className="text-[10px] text-white/40">
                    No QuoteTool quotes yet.
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};
