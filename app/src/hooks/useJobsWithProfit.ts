/**
 * useJobsWithProfit — joins wpw_orders to their linked customer_quotes
 * and computes per-job profit so the dashboard can show:
 *   • Real customer-paid total (revenue)
 *   • WPW order total (cost the shop paid for materials)
 *   • Profit ($) and Margin (%)
 *
 * Two profit paths:
 *   A) Linked: wpw_orders.quote_id → customer_quotes.customer_total used as
 *      true customer-paid revenue.
 *   B) Unlinked (past jobs imported before QuoteTool adoption):
 *      revenue is estimated from cost × (1 + markup_pct/100), where
 *      markup_pct comes from shop_pricing_config.default_markup_percentage
 *      captured during onboarding (default 65%).
 *
 * Returns rows tagged with `revenueSource: "actual" | "estimated"` so the
 * UI can show a small "est." badge on rows where we couldn't find a
 * linked quote.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type JobStage = "active" | "past" | "all";

const ACTIVE_STATUSES = [
  "in-design",
  "design-complete",
  "processing",
  "on-hold",
  "print-production",
  "reprint",
];
const PAST_STATUSES = ["completed", "shipped"];

export interface JobRow {
  id: number;
  order_number: string;
  status: string;
  customer_name: string | null;
  cost: number;
  revenue: number;
  profit: number;
  margin: number;
  revenueSource: "actual" | "estimated";
  date_created: string;
  date_completed: string | null;
  quote_id: string | null;
}

interface WpwOrderRaw {
  id: number;
  order_number: string;
  status: string;
  customer_name: string | null;
  total: number;
  date_created: string;
  date_completed: string | null;
  quote_id: string | null;
}

interface QuoteRaw {
  id: string;
  customer_total: number | null;
  metadata: Record<string, unknown> | null;
}

const STATUSES_FOR: Record<JobStage, string[]> = {
  active: ACTIVE_STATUSES,
  past: PAST_STATUSES,
  all: [...ACTIVE_STATUSES, ...PAST_STATUSES],
};

const normalizeDollars = (v: number | null | undefined): number => {
  if (!v && v !== 0) return 0;
  return v > 1000 && Number.isInteger(v) ? v / 100 : v;
};

/**
 * @param stage    Active / past / all status bucket.
 * @param daysWindow  null = all time. Otherwise filter wpw_orders to the
 *                    last N days (1 = today). Aligns the panel with the
 *                    7d/14d/30d/90d range pills the user expects.
 */
export function useJobsWithProfit(stage: JobStage = "all", daysWindow: number | null = null) {
  return useQuery<JobRow[]>({
    queryKey: ["jobs-with-profit", stage, daysWindow ?? "all"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return [];
      const db = supabase as unknown as {
        from: (t: string) => {
          select: (cols: string) => any;
        };
      };

      // Default markup % for estimating revenue on jobs without a linked quote.
      let markupPct = 65;
      const { data: pricing } = await db
        .from("shop_pricing_config")
        .select("default_markup_percentage")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (pricing?.default_markup_percentage != null) {
        markupPct = Number(pricing.default_markup_percentage) || 65;
      }

      // Pull WPW orders for the requested stage + optional date window.
      const statuses = STATUSES_FOR[stage];
      let q = db
        .from("wpw_orders")
        .select(
          "id, order_number, status, customer_name, total, date_created, date_completed, quote_id",
        )
        .in("status", statuses);
      if (daysWindow != null && daysWindow > 0) {
        const since = new Date(Date.now() - daysWindow * 24 * 60 * 60 * 1000).toISOString();
        q = q.gte("date_created", since);
      }
      const { data: orders, error: ordersErr } = await q
        .order("date_created", { ascending: false })
        .limit(200);
      if (ordersErr) return [];
      const ordersList = (orders || []) as WpwOrderRaw[];
      if (ordersList.length === 0) return [];

      // Bulk-fetch the linked quotes so we can attach real customer totals.
      const quoteIds = [
        ...new Set(ordersList.map((o) => o.quote_id).filter((q): q is string => !!q)),
      ];
      const quotesById = new Map<string, QuoteRaw>();
      if (quoteIds.length > 0) {
        const { data: quotes } = await db
          .from("customer_quotes")
          .select("id, customer_total, metadata")
          .in("id", quoteIds);
        for (const q of (quotes || []) as QuoteRaw[]) {
          quotesById.set(q.id, q);
        }
      }

      const markupMultiplier = 1 + markupPct / 100;

      return ordersList.map<JobRow>((o) => {
        const cost = Number(o.total || 0);
        const linkedQuote = o.quote_id ? quotesById.get(o.quote_id) : undefined;

        let revenue: number;
        let revenueSource: JobRow["revenueSource"];
        if (linkedQuote && linkedQuote.customer_total != null) {
          revenue = normalizeDollars(linkedQuote.customer_total);
          revenueSource = "actual";
        } else {
          revenue = Math.round(cost * markupMultiplier * 100) / 100;
          revenueSource = "estimated";
        }
        const profit = Math.round((revenue - cost) * 100) / 100;
        const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;

        return {
          id: o.id,
          order_number: o.order_number,
          status: o.status,
          customer_name: o.customer_name,
          cost,
          revenue,
          profit,
          margin,
          revenueSource,
          date_created: o.date_created,
          date_completed: o.date_completed,
          quote_id: o.quote_id,
        };
      });
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/** Aggregate the per-job rows into a single revenue/cost/profit/margin summary. */
export function summarizeJobs(rows: JobRow[]) {
  let revenue = 0;
  let cost = 0;
  let actualCount = 0;
  for (const r of rows) {
    revenue += r.revenue;
    cost += r.cost;
    if (r.revenueSource === "actual") actualCount++;
  }
  const profit = Math.round((revenue - cost) * 100) / 100;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0;
  return {
    revenue: Math.round(revenue * 100) / 100,
    cost: Math.round(cost * 100) / 100,
    profit,
    margin,
    jobCount: rows.length,
    actualCount,
    estimatedCount: rows.length - actualCount,
  };
}
