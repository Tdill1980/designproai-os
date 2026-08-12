import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  LabelList,
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign, BarChart3, List, Film, Receipt, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useWpwAnalytics, type WpwRange } from "@/hooks/useWpwAnalytics";

interface DayPoint {
  date: string;
  iso: string;
  dollars: number;
  quoteCount: number;
}

interface QuoteRow {
  id: string;
  quote_number: string;
  customer_name: string | null;
  product: string | null;
  status: string | null;
  customer_total: number;
  created_at: string;
  date: string;
}

type RangeOption = 0 | 1 | 3 | 7 | 30 | 90 | 365;
type ViewMode = "graph" | "list";

const db = supabase as never as { from: (t: string) => any };

const normalizeDollars = (value: number | null | undefined): number => {
  if (!value && value !== 0) return 0;
  return value > 1000 && Number.isInteger(value) ? value / 100 : value;
};

const useRevenueActivity = (days: RangeOption) => {
  return useQuery<DayPoint[]>({
    queryKey: ["dashboard-revenue-activity", days],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return [];

      const lookback = days === 0 ? 1 : days; // "Today" = 1 day of data
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      if (days > 0) since.setDate(since.getDate() - days);

      // Revenue card shows ORDERS only (status = 'converted'), not open quotes.
      // Pull from BOTH pipelines:
      //   - quotes (internal admin) — has metadata.woo_order_total for actual revenue
      //   - customer_quotes (public + WPW webhook conversions) — uses quote_total
      const [internalRes, publicRes] = await Promise.all([
        db
          .from("quotes")
          .select("created_at, customer_total, status, metadata")
          .eq("status", "converted")
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: true }),
        db
          .from("customer_quotes")
          .select("created_at, quote_total, status")
          .eq("status", "converted")
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: true }),
      ]);

      if (internalRes.error && publicRes.error) return [];

      const data = [
        ...(internalRes.data || []).map((r: any) => ({
          created_at: r.created_at,
          customer_total: r.customer_total,
          metadata: r.metadata,
        })),
        ...(publicRes.data || []).map((r: any) => ({
          created_at: r.created_at,
          customer_total: r.quote_total,
          metadata: null,
        })),
      ];

      const bucketCount = Math.max(lookback, 1);
      const buckets: Record<string, { dollars: number; quoteCount: number }> = {};
      for (let i = 0; i < bucketCount; i++) {
        const d = new Date();
        d.setDate(d.getDate() - (bucketCount - 1 - i));
        d.setHours(0, 0, 0, 0);
        buckets[d.toISOString().slice(0, 10)] = { dollars: 0, quoteCount: 0 };
      }
      (data || []).forEach(
        (row: { created_at: string; customer_total: number | null; metadata?: any }) => {
          const key = row.created_at.slice(0, 10);
          if (key in buckets) {
            // Use WooCommerce order total (actual revenue) when available,
            // fall back to customer_total (quoted price)
            const wooTotal = row.metadata?.woo_order_total ? parseFloat(row.metadata.woo_order_total) : 0;
            const amount = wooTotal > 0 ? wooTotal : normalizeDollars(row.customer_total);
            buckets[key].dollars += amount;
            buckets[key].quoteCount += 1;
          }
        }
      );

      return Object.entries(buckets).map(([iso, { dollars, quoteCount }]) => {
        const d = new Date(iso + "T00:00:00Z");
        return {
          iso,
          date: d.toLocaleString("en-US", { month: "short", day: "numeric" }),
          dollars: Math.round(dollars),
          quoteCount,
        };
      });
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });
};

interface TopFilmData {
  topFilm: string | null;
  topManufacturer: string | null;
  totalProofs: number;
}

// Woo statuses that are NOT revenue — everything else (processing,
// completed, and WPW's 20+ custom fulfillment statuses) is a real order.
const NON_REVENUE_STATUSES = ["cancelled", "refunded", "failed", "pending", "checkout-draft", "trash"];

/**
 * Real store revenue, straight from the wpw_orders mirror (synced from
 * WooCommerce). This is the primary series for WPW tenants: it shows what
 * the store actually sold per day, independent of whether a quote existed.
 * Direct read gated by RLS — admins get rows via the "admins read all wpw
 * orders" policy; non-admins get zero rows and the card falls back to the
 * proxy/quotes pipelines.
 */
const useWpwOrdersRevenue = (days: RangeOption, enabled: boolean) => {
  return useQuery<DayPoint[] | null>({
    queryKey: ["dashboard-wpw-orders-revenue", days],
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return null;

      const lookback = days === 0 ? 1 : days;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      if (days > 0) since.setDate(since.getDate() - days);

      const { data, error } = await db
        .from("wpw_orders")
        .select("date_created, total, status")
        .gte("date_created", since.toISOString())
        .order("date_created", { ascending: true })
        .limit(5000);
      if (error || !data || data.length === 0) return null; // fall back

      const buckets: Record<string, { dollars: number; quoteCount: number }> = {};
      for (let i = 0; i < Math.max(lookback, 1); i++) {
        const d = new Date();
        d.setDate(d.getDate() - (Math.max(lookback, 1) - 1 - i));
        d.setHours(0, 0, 0, 0);
        buckets[d.toISOString().slice(0, 10)] = { dollars: 0, quoteCount: 0 };
      }
      (data as Array<{ date_created: string; total: number | null; status: string | null }>).forEach((row) => {
        if (NON_REVENUE_STATUSES.includes(String(row.status || "").toLowerCase())) return;
        const key = String(row.date_created || "").slice(0, 10);
        if (key in buckets) {
          buckets[key].dollars += Number(row.total) || 0;
          buckets[key].quoteCount += 1;
        }
      });

      return Object.entries(buckets).map(([iso, { dollars, quoteCount }]) => {
        const d = new Date(iso + "T00:00:00Z");
        return {
          iso,
          date: d.toLocaleString("en-US", { month: "short", day: "numeric" }),
          dollars: Math.round(dollars),
          quoteCount,
        };
      });
    },
  });
};

const useQuoteRows = (days: RangeOption) => {
  return useQuery<QuoteRow[]>({
    queryKey: ["dashboard-quote-rows", days],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];

      const lookback = days === 0 ? 1 : days;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      if (days > 0) since.setDate(since.getDate() - days);

      // Pull converted orders from BOTH pipelines.
      const [internalRes, publicRes] = await Promise.all([
        db
          .from("quotes")
          .select("id, quote_number, customer_total, color_name, status, customer_id, created_at")
          .eq("status", "converted")
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: false }),
        db
          .from("customer_quotes")
          .select("id, quote_total, film_name, status, customer_name, created_at")
          .eq("status", "converted")
          .gte("created_at", since.toISOString())
          .order("created_at", { ascending: false }),
      ]);

      const internalRows = (internalRes?.data || []) as any[];
      const publicRows = (publicRes?.data || []) as any[];

      // Resolve customer names for internal quotes (FK to customers table).
      const customerIds = [...new Set(internalRows.map((r: any) => r.customer_id).filter(Boolean))];
      let customerMap: Record<string, string> = {};
      if (customerIds.length > 0) {
        const { data: customers } = await supabase
          .from("customers")
          .select("id, name")
          .in("id", customerIds);
        if (customers) {
          customers.forEach((c: any) => { customerMap[c.id] = c.name; });
        }
      }

      const internal: QuoteRow[] = internalRows.map((row) => {
        const d = new Date(row.created_at);
        return {
          id: row.id,
          quote_number: row.quote_number || "—",
          customer_name: row.customer_id ? (customerMap[row.customer_id] || null) : null,
          product: row.color_name || null,
          status: row.status || null,
          customer_total: normalizeDollars(row.customer_total),
          created_at: row.created_at,
          date: d.toLocaleString("en-US", { month: "short", day: "numeric" }),
        };
      });

      // customer_quotes have denormalized customer_name and no quote_number,
      // so we synthesize a short id-based label for the row.
      const publicMapped: QuoteRow[] = publicRows.map((row) => {
        const d = new Date(row.created_at);
        return {
          id: row.id,
          quote_number: `WPW-${String(row.id).slice(0, 6).toUpperCase()}`,
          customer_name: row.customer_name || null,
          product: row.film_name || null,
          status: row.status || null,
          customer_total: normalizeDollars(row.quote_total),
          created_at: row.created_at,
          date: d.toLocaleString("en-US", { month: "short", day: "numeric" }),
        };
      });

      // Merge and sort by created_at desc.
      return [...internal, ...publicMapped].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });
};

const useTopSellingFilm = (days: RangeOption) => {
  return useQuery<TopFilmData>({
    queryKey: ["dashboard-top-film", days],
    queryFn: async () => {
      const empty = { topFilm: null, topManufacturer: null, totalProofs: 0 };
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return empty;

      const lookback = days === 0 ? 1 : days;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      if (days > 0) since.setDate(since.getDate() - days);

      const { data, error } = await supabase
        .from("proofs")
        .select("film_or_design_name, manufacturer")
        .gte("created_at", since.toISOString());

      if (error || !data || data.length === 0) return empty;

      const filmCounts: Record<string, number> = {};
      const mfgCounts: Record<string, number> = {};
      data.forEach((row: any) => {
        const film = row.film_or_design_name?.trim();
        const mfg = row.manufacturer?.trim();
        if (film) filmCounts[film] = (filmCounts[film] || 0) + 1;
        if (mfg) mfgCounts[mfg] = (mfgCounts[mfg] || 0) + 1;
      });

      const sortedFilms = Object.entries(filmCounts).sort((a, b) => b[1] - a[1]);
      const sortedMfg = Object.entries(mfgCounts).sort((a, b) => b[1] - a[1]);

      return {
        topFilm: sortedFilms.length > 0 ? sortedFilms[0][0] : null,
        topManufacturer: sortedMfg.length > 0 ? sortedMfg[0][0] : null,
        totalProofs: data.length,
      };
    },
    staleTime: 60 * 1000,
    retry: false,
  });
};

const formatMoney = (amount: number) => {
  return `$${amount.toLocaleString()}`;
};

const RANGE_OPTIONS: { value: RangeOption; label: string }[] = [
  { value: 0, label: "Today" },
  { value: 7, label: "7D" },
  { value: 30, label: "30D" },
  { value: 90, label: "90D" },
  { value: 365, label: "All" },
];

interface AnalyticsGraphCardProps {
  className?: string;
  /**
   * Compact mode: removes the outer card chrome (border, padding, bg)
   * and the fixed height so the card can be embedded inside another
   * card (e.g. the Profit pillar) without dictating its height.
   */
  compact?: boolean;
}

const renderDollarLabel = (props: any) => {
  const { x, y, value } = props;
  if (!value || value === 0) return null;
  return (
    <text
      x={x}
      y={y - 10}
      fill="#e4e4e7"
      fontSize={10}
      fontWeight={600}
      textAnchor="middle"
      fontFamily="Inter, sans-serif"
    >
      {formatMoney(value)}
    </text>
  );
};

export const AnalyticsGraphCard = ({ className, compact = false }: AnalyticsGraphCardProps) => {
  const [range, setRange] = useState<RangeOption>(90);
  const [viewMode, setViewMode] = useState<ViewMode>("graph");
  const { data: isWpw = false } = useIsWpwTenant();

  // Cross-project analytics: when the signed-in user is a WPW tenant,
  // pull the revenue chart + converted-orders list from WPW's
  // analytics-dashboard endpoint instead of the local quotes table.
  // Internal QuickQuote saves still come through local hooks for
  // non-WPW tabs / non-WPW users.
  const wpwRangeMap: Record<RangeOption, WpwRange> = {
    0: 1, 1: 1, 3: 7, 7: 7, 30: 30, 90: 90, 365: 365,
  };
  const { data: wpwData } = useWpwAnalytics(wpwRangeMap[range], { enabled: isWpw });

  // PRIMARY for WPW tenants: real order revenue from the synced wpw_orders
  // mirror. The proxy/quotes pipelines below remain as fallbacks so the
  // card never goes blank if the mirror is empty or RLS filters it out.
  const { data: ordersPoints } = useWpwOrdersRevenue(range, isWpw);

  const { data: localPoints, isLoading: localLoading } = useRevenueActivity(range);
  const { data: localQuoteRows } = useQuoteRows(range);
  const { data: filmData } = useTopSellingFilm(range);

  // Map WPW response into the existing DayPoint / QuoteRow shapes the
  // chart and table already render.
  const wpwPoints: DayPoint[] | undefined = wpwData?.daily?.map((d) => ({
    iso: d.iso,
    date: new Date(d.iso + "T00:00:00Z").toLocaleString("en-US", { month: "short", day: "numeric" }),
    dollars: Math.round(d.dollars),
    quoteCount: d.quote_count,
  }));

  const wpwQuoteRows: QuoteRow[] | undefined = wpwData?.converted_orders?.map((o) => {
    const d = new Date(o.created_at);
    return {
      id: o.id,
      quote_number: o.quote_number || "—",
      customer_name: o.customer_name,
      product: o.product,
      status: "converted",
      customer_total: o.customer_total,
      created_at: o.created_at,
      date: d.toLocaleString("en-US", { month: "short", day: "numeric" }),
    };
  });

  const points = (isWpw && ordersPoints) ? ordersPoints : (isWpw && wpwPoints ? wpwPoints : localPoints);
  const quoteRows = isWpw && wpwQuoteRows ? wpwQuoteRows : localQuoteRows;
  const isLoading = isWpw ? (!ordersPoints && !wpwData) : localLoading;

  // Total quotes in period (all statuses) for conversion rate
  const { data: totalQuotesInPeriod = 0 } = useQuery<number>({
    queryKey: ["dashboard-total-quotes-count", range],
    queryFn: async () => {
      const lookback = range === 0 ? 1 : range;
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      if (range > 0) since.setDate(since.getDate() - range);
      // Count quotes from BOTH pipelines so the conversion rate denominator
      // reflects every lead that came in (internal admin + public submissions).
      const [internal, pub] = await Promise.all([
        db
          .from("quotes")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since.toISOString()),
        db
          .from("customer_quotes")
          .select("id", { count: "exact", head: true })
          .gte("created_at", since.toISOString()),
      ]);
      return (internal?.count || 0) + (pub?.count || 0);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });
  const conversionRate = totalQuotesInPeriod > 0 && totalQuotes > 0
    ? Math.round((totalQuotes / totalQuotesInPeriod) * 1000) / 10
    : 0;

  // Use all date points so the area chart fills properly
  const graphPoints = useMemo(() => {
    if (!points) return [];
    return points;
  }, [points]);

  const { total, totalQuotes, avgQuote, trendLabel, trendPositive, hasData } = useMemo(() => {
    if (!points || points.length === 0) {
      return { total: 0, totalQuotes: 0, avgQuote: 0, trendLabel: "No orders yet", trendPositive: true, hasData: false };
    }
    const t = points.reduce((acc, p) => acc + p.dollars, 0);
    const q = points.reduce((acc, p) => acc + p.quoteCount, 0);
    const avg = q > 0 ? Math.round(t / q) : 0;
    const mid = Math.floor(points.length / 2);
    const firstHalf = points.slice(0, mid).reduce((a, p) => a + p.dollars, 0);
    const secondHalf = points.slice(mid).reduce((a, p) => a + p.dollars, 0);
    const delta = secondHalf - firstHalf;
    const label =
      t === 0
        ? "No orders yet"
        : delta === 0
        ? "Flat vs first half"
        : delta > 0
        ? `+${formatMoney(delta)} vs first half`
        : `${formatMoney(delta)} vs first half`;
    return { total: t, totalQuotes: q, avgQuote: avg, trendLabel: label, trendPositive: delta >= 0, hasData: t > 0 };
  }, [points]);

  const xInterval = range <= 3 ? 0 : range === 7 ? 1 : 5;

  return (
    <div
      className={cn(
        "relative overflow-hidden flex flex-col",
        compact
          ? // Inline inside another card: no chrome, fixed moderate height
            "h-[220px] max-h-[220px]"
          : // Standalone card: full chrome + taller height
            "rounded-2xl border border-[#48484a] bg-rp-surface p-4 sm:p-5 h-[340px] max-h-[340px] md:h-[320px] md:max-h-[320px] lg:h-[340px] lg:max-h-[340px]",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-rp-elevated border border-[#48484a] flex items-center justify-center shrink-0">
            <DollarSign className="w-4 h-4 text-[#3b82f6]" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-white uppercase tracking-[0.18em] leading-tight">
              Order Revenue
            </h3>
            <div className="text-[11px] text-white/50 leading-tight mt-0.5">
              {range === 0 ? "Today" : `Last ${range} day${range !== 1 ? "s" : ""}`}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-white leading-none tracking-tight">
            {formatMoney(total)}
          </div>
          <div
            className={cn(
              "text-[10px] font-semibold uppercase mt-1 flex items-center gap-1 justify-end",
              trendPositive ? "text-[#3b82f6]" : "text-[#F87171]"
            )}
          >
            {hasData && (trendPositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />)}
            {trendLabel}
          </div>
        </div>
      </div>

      {/* Controls row: Range + Top Film + View toggle */}
      <div className="flex items-center justify-between mb-2.5 gap-3">
        {/* Range selector pills */}
        <div className="flex items-center gap-0.5 bg-[#1c1c1e] rounded-lg p-1 border border-[#3a3a3c]">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setRange(opt.value)}
              className={cn(
                "px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md transition-all duration-200",
                range === opt.value
                  ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                  : "text-white/50 hover:text-white/80"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Quick stats strip */}
        <div className="flex items-center gap-4 min-w-0 flex-1 justify-center">
          {totalQuotesInPeriod > 0 && (
            <div className="flex items-center gap-1.5">
              <Receipt className="w-3 h-3 text-[#3b82f6] shrink-0" />
              <span className="text-[11px] text-white/60">{totalQuotes}/{totalQuotesInPeriod} converted</span>
            </div>
          )}
          {conversionRate > 0 && (
            <div className="flex items-center gap-1.5">
              <Target className="w-3 h-3 text-[#10b981] shrink-0" />
              <span className="text-[11px] font-bold text-[#10b981]">{conversionRate}% rate</span>
            </div>
          )}
          {avgQuote > 0 && (
            <div className="flex items-center gap-1.5">
              <Target className="w-3 h-3 text-[#8b5cf6] shrink-0" />
              <span className="text-[11px] text-white/60">Avg {formatMoney(avgQuote)}</span>
            </div>
          )}
          {filmData?.topFilm && (
            <div className="flex items-center gap-1.5 min-w-0">
              <Film className="w-3 h-3 text-[#ec4899] shrink-0" />
              <span className="text-[11px] font-semibold text-[#ec4899] truncate max-w-[140px]">
                {filmData.topFilm}
              </span>
            </div>
          )}
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-0.5 bg-[#1c1c1e] rounded-lg p-1 border border-[#3a3a3c]">
          <button
            onClick={() => setViewMode("graph")}
            className={cn(
              "p-1.5 rounded-md transition-all duration-200",
              viewMode === "graph"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                : "text-white/50 hover:text-white/80"
            )}
            title="Graph view"
          >
            <BarChart3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={cn(
              "p-1.5 rounded-md transition-all duration-200",
              viewMode === "list"
                ? "bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white"
                : "text-white/50 hover:text-white/80"
            )}
            title="List view"
          >
            <List className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content area — maximized */}
      <div className="flex-1 min-h-0 -mx-1">
        {isLoading ? (
          <div className="h-full rounded-lg bg-rp-elevated animate-pulse" />
        ) : viewMode === "graph" ? (
          /* ── Graph View ── */
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={graphPoints} margin={{ top: 16, right: 8, bottom: 0, left: -4 }}>
              <defs>
                <linearGradient id="rp-revenue-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3b82f6" stopOpacity={1} />
                  <stop offset="50%" stopColor="#8b5cf6" stopOpacity={1} />
                  <stop offset="100%" stopColor="#ec4899" stopOpacity={1} />
                </linearGradient>
                <linearGradient id="rp-revenue-stroke" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#ec4899" />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2e" vertical={false} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: "#a1a1aa" }}
                stroke="#2a2a2e"
                tickLine={false}
                axisLine={false}
                interval={xInterval}
              />
              <YAxis
                tick={{ fontSize: 10, fill: "#a1a1aa" }}
                stroke="#2a2a2e"
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                width={42}
                tickFormatter={(v: number) => formatMoney(v)}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1c1c1e",
                  border: "1px solid #3b82f6",
                  borderRadius: "8px",
                  fontSize: "12px",
                  color: "white",
                }}
                labelStyle={{ color: "#a1a1aa", marginBottom: 4 }}
                cursor={{ stroke: "#ec4899", strokeWidth: 1 }}
                formatter={(value: number, _name: string, props: any) => {
                  const quoteCount = props?.payload?.quoteCount ?? 0;
                  return [
                    <span key="v">
                      {formatMoney(value)}
                      <span style={{ color: "#71717a", marginLeft: 6 }}>
                        {quoteCount} quote{quoteCount !== 1 ? "s" : ""}
                      </span>
                    </span>,
                    "Revenue",
                  ];
                }}
              />
              <Area
                type="monotone"
                dataKey="dollars"
                stroke="url(#rp-revenue-stroke)"
                strokeWidth={2}
                fill="url(#rp-revenue-fill)"
                dot={false}
                activeDot={{
                  r: 4,
                  fill: "#ec4899",
                  stroke: "#ffffff",
                  strokeWidth: 1.5,
                }}
              >
                <LabelList
                  dataKey="dollars"
                  content={renderDollarLabel}
                />
              </Area>
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          /* ── List View ── */
          <div className="h-full overflow-y-auto px-2 custom-scrollbar">
            {/* Column headers */}
            <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto] gap-3 text-[10px] font-bold uppercase tracking-wider text-white/50 border-b border-[#3a3a3c] pb-1.5 mb-1 sticky top-0 bg-rp-surface">
              <span>Order #</span>
              <span>Customer</span>
              <span>Product</span>
              <span className="text-center">Status</span>
              <span className="text-right">Amount</span>
            </div>
            {(quoteRows || []).map((q) => (
              <div
                key={q.id}
                className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto] gap-3 py-1.5 border-b border-[#2c2c2e] last:border-0 group hover:bg-white/[0.03] transition-colors rounded items-center"
              >
                <span className="text-[11px] font-mono font-semibold text-[#3b82f6] truncate">
                  {q.quote_number}
                </span>
                <span className="text-[11px] text-white/80 truncate">
                  {q.customer_name || "—"}
                </span>
                <span className="text-[11px] text-white/60 truncate">
                  {q.product || "—"}
                </span>
                <span className="flex justify-center">
                  {q.status === "converted" ? (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      Install
                    </span>
                  ) : q.status === "sent" ? (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      Sent
                    </span>
                  ) : (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-white/10 text-white/50 border border-white/20">
                      Quoted
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-right font-mono font-semibold min-w-[56px]">
                  {q.customer_total > 0 ? (
                    <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
                      {formatMoney(Math.round(q.customer_total))}
                    </span>
                  ) : (
                    <span className="text-white/20">$0</span>
                  )}
                </span>
              </div>
            ))}
            {/* Totals footer */}
            {hasData && (
              <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto] gap-3 pt-2 mt-1 border-t border-[#48484a] items-center sticky bottom-0 bg-rp-surface">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/60">
                  {totalQuotes} quote{totalQuotes !== 1 ? "s" : ""}
                </span>
                <span /><span /><span />
                <span className="text-[11px] text-right font-mono font-bold bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent min-w-[56px]">
                  {formatMoney(total)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Empty state overlay */}
      {!isLoading && !hasData && (
        <div className="absolute inset-0 flex items-end justify-center pb-8 pointer-events-none">
          <div className="text-center bg-rp-surface/90 rounded-lg px-4 py-2.5 border border-[#48484a]">
            <div className="text-xs text-white/70">
              Convert a quote to an order to see revenue trends here.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
