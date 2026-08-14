/**
 * QuoteToolSelfServeTable — admin view of customer self-serve QuoteTool
 * submissions (from public.customer_quotes).
 *
 * Distinct from SavedQuotesTable (which reads from public.quotes —
 * staff-entered quotes). This component is the admin tab for the
 * customer-facing QuoteTool stream, with its own analytics row.
 *
 * Conversion tracking: wpw-sync-orders matches incoming Woo orders back
 * to customer_quotes via the 3-tier matcher (email + total / email +
 * vehicle / fuzzy total) and flips status to "converted" + writes a
 * quote_events row of type "quote_converted_to_order". This component
 * surfaces those conversions as concrete counts + revenue + the matched
 * WPW order number per row, not just a single percentage. That's what
 * lets the team prove the QuoteTool is actually generating revenue
 * vs the old "designer types a price into an email" workflow.
 *
 * Analytics tiles:
 *   - Total submissions
 *   - Total quote value (sum of quote_total)
 *   - Converted (X of Y) — absolute count alongside the percentage
 *   - Converted revenue (sum of quote_total where status='converted')
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Globe,
  DollarSign,
  CheckCircle2,
  Package,
  ArrowRight,
  Mail,
  Phone,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SelfServeQuote {
  id: string;
  created_at: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  vehicle_year: string | null;
  vehicle_make: string;
  vehicle_model: string;
  film_finish: string | null;
  film_name: string | null;
  film_manufacturer: string | null;
  total_sqft: number;
  quote_total: number;
  status: string | null;
  shop_id: string | null;
}

interface ConvertedOrder {
  quote_id: string;
  order_number: string | null;
  total: number | null;
}

const db = supabase as any;

const formatMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents);

const formatRelative = (iso: string | null) => {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

export function QuoteToolSelfServeTable() {
  const { data: quotes, isLoading } = useQuery<SelfServeQuote[]>({
    queryKey: ["admin-quotetool-self-serve"],
    queryFn: async () => {
      const { data, error } = await db
        .from("customer_quotes")
        .select(
          "id, created_at, customer_name, customer_email, customer_phone, vehicle_year, vehicle_make, vehicle_model, film_finish, film_name, film_manufacturer, total_sqft, quote_total, status, shop_id"
        )
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) {
        console.warn("QuoteTool self-serve query failed:", error.message);
        return [];
      }
      return (data || []) as SelfServeQuote[];
    },
    staleTime: 30 * 1000,
  });

  // Pull WPW orders that wpw-sync-orders has linked back to a quote so
  // we can render the actual order number on each converted row. Read-
  // only — no schema or business-logic changes.
  const quoteIds = useMemo(
    () => (quotes || []).map((q) => q.id),
    [quotes],
  );
  const { data: convertedOrders } = useQuery<ConvertedOrder[]>({
    queryKey: ["admin-quotetool-self-serve-orders", quoteIds.join(",")],
    enabled: quoteIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db
        .from("wpw_orders")
        .select("quote_id, order_number, total")
        .in("quote_id", quoteIds);
      if (error) {
        console.warn("QuoteTool linked-orders query failed:", error.message);
        return [];
      }
      return (data || []).filter((r: ConvertedOrder) => r.quote_id);
    },
    staleTime: 60 * 1000,
  });
  const orderByQuoteId = useMemo(() => {
    const m = new Map<string, ConvertedOrder>();
    for (const o of convertedOrders || []) {
      if (o.quote_id) m.set(o.quote_id, o);
    }
    return m;
  }, [convertedOrders]);

  const stats = useMemo(() => {
    const list = quotes || [];
    const total = list.length;
    const totalValue = list.reduce((s, q) => s + (Number(q.quote_total) || 0), 0);
    const wonList = list.filter((q) =>
      q.status === "booked" ||
      q.status === "won" ||
      q.status === "converted",
    );
    const won = wonList.length;
    const conv = total > 0 ? Math.round((won / total) * 100) : 0;
    // Converted revenue = sum of quote_total on converted rows. Falls
    // back to the matched WPW order total when present (more accurate
    // — that's what the customer actually paid).
    const convertedRevenue = wonList.reduce((s, q) => {
      const order = orderByQuoteId.get(q.id);
      const orderTotal = Number(order?.total) || 0;
      const quoteTotal = Number(q.quote_total) || 0;
      return s + (orderTotal > 0 ? orderTotal : quoteTotal);
    }, 0);
    return { total, totalValue, won, conv, convertedRevenue };
  }, [quotes, orderByQuoteId]);

  return (
    <div className="space-y-4 pt-2">
      {/* Header strip explaining the stream */}
      <div className="rounded-xl border border-[#cffafe] bg-[#ecfeff] px-4 py-3 flex items-start gap-3">
        <Globe className="w-5 h-5 text-[#0891b2] flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-[#111]">Customer Self-Serve QuoteTool</p>
          <p className="text-xs text-[#6b7280]">
            Quotes submitted by customers from the public QuoteTool —{" "}
            <span className="font-mono text-[#0891b2]">/quote/:shopSlug</span> or{" "}
            <span className="font-mono text-[#0891b2]">/quick-quote</span>.
            Separate from staff-entered quotes (see "Saved Quotes" tab).
          </p>
        </div>
      </div>

      {/* Analytics tiles — concrete numbers so the team can prove the
          QuoteTool is generating real revenue (vs the old "designer
          types a price into an email" workflow). */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          {
            label: "Self-Serve Submissions",
            value: String(stats.total),
            sublabel: "All time",
            icon: Globe,
            color: "#0891b2",
          },
          {
            label: "Total Quote Value",
            value: formatMoney(stats.totalValue),
            sublabel: "Pipeline",
            icon: DollarSign,
            color: "#16a34a",
          },
          {
            label: "Converted",
            value: `${stats.won} of ${stats.total}`,
            sublabel: `${stats.conv}% conversion`,
            icon: CheckCircle2,
            color: "#7c3aed",
          },
          {
            label: "Converted Revenue",
            value: formatMoney(stats.convertedRevenue),
            sublabel: "Booked WPW orders",
            icon: Package,
            color: "#dc2626",
          },
        ].map(({ label, value, sublabel, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-xl border border-[#e5e7eb] p-3.5">
            <div className="flex items-start justify-between gap-2 mb-1">
              <Icon className="w-4 h-4" style={{ color }} />
            </div>
            <p className="text-2xl font-bold tabular-nums" style={{ color }}>
              {value}
            </p>
            <p className="text-xs text-[#6b7280] mt-0.5">{label}</p>
            <p className="text-[10px] text-[#9ca3af] mt-0.5">{sublabel}</p>
          </div>
        ))}
      </div>

      {/* Quotes list */}
      <div className="bg-white rounded-xl border border-[#e5e7eb] overflow-hidden">
        <div className="px-4 py-3 bg-[#f9fafb] border-b border-[#e5e7eb] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-[#0891b2]" />
            <span className="text-sm font-bold text-[#111]">Recent QuoteTool submissions</span>
          </div>
          <Button variant="ghost" size="sm" asChild className="text-xs h-8">
            <Link to="/quotetool">
              View public QuoteTool <ArrowRight className="w-3 h-3 ml-1" />
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : (quotes || []).length === 0 ? (
          <div className="text-center py-12 px-4">
            <p className="text-sm text-[#9ca3af]">No self-serve submissions yet</p>
            <p className="text-xs text-[#d1d5db] mt-1 max-w-md mx-auto">
              Share your branded QuoteTool link on Google Business, Instagram,
              or your shop's website. Submissions land here.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[#e5e7eb]">
            {(quotes || []).map((q) => {
              const vehicle = [q.vehicle_year, q.vehicle_make, q.vehicle_model].filter(Boolean).join(" ");
              const status = q.status || "new";
              const matchedOrder = orderByQuoteId.get(q.id);
              const isConverted =
                status === "booked" || status === "won" || status === "converted";
              return (
                <div key={q.id} className="px-4 py-3 hover:bg-[#f9fafb] transition-colors flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-sm font-semibold text-[#111] truncate">
                        {q.customer_name || "Anonymous"}
                      </span>
                      <span
                        className={cn(
                          "text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider",
                          status === "new" && "bg-[#dbeafe] text-[#1d4ed8]",
                          status === "quoted" && "bg-[#fef3c7] text-[#b45309]",
                          isConverted && "bg-[#dcfce7] text-[#15803d]",
                          status === "lost" && "bg-[#fee2e2] text-[#b91c1c]",
                        )}
                      >
                        {status}
                      </span>
                      {matchedOrder?.order_number && (
                        <a
                          href={`/admin/wpw-orders?q=${encodeURIComponent(matchedOrder.order_number)}`}
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-mono font-semibold bg-[#ecfdf5] text-[#15803d] border border-[#bbf7d0] hover:bg-[#d1fae5] transition-colors"
                          title="Matched WePrintWraps order — click to open"
                        >
                          <Package className="w-2.5 h-2.5" />
                          {matchedOrder.order_number}
                          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
                        </a>
                      )}
                    </div>
                    <div className="text-xs text-[#6b7280] flex items-center gap-2">
                      {vehicle && <span className="truncate">{vehicle}</span>}
                      {q.film_finish && (
                        <>
                          <span>·</span>
                          <span>{q.film_finish}</span>
                        </>
                      )}
                      <span>·</span>
                      <span>{formatRelative(q.created_at)}</span>
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-sm font-bold text-[#16a34a]">
                      {formatMoney(Number(q.quote_total) || 0)}
                    </div>
                    <div className="text-[10px] text-[#9ca3af]">
                      {Number(q.total_sqft || 0).toFixed(0)} sq ft
                    </div>
                    {matchedOrder?.total != null && Number(matchedOrder.total) > 0 && (
                      <div className="text-[10px] font-semibold text-[#15803d] mt-0.5">
                        Paid {formatMoney(Number(matchedOrder.total))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {q.customer_phone && (
                      <a
                        href={`tel:${q.customer_phone}`}
                        className="w-7 h-7 rounded-md border border-[#e5e7eb] text-[#6b7280] hover:text-[#0891b2] hover:border-[#0891b2] flex items-center justify-center transition"
                        aria-label="Call"
                      >
                        <Phone className="w-3.5 h-3.5" />
                      </a>
                    )}
                    {q.customer_email && (
                      <a
                        href={`mailto:${q.customer_email}`}
                        className="w-7 h-7 rounded-md border border-[#e5e7eb] text-[#6b7280] hover:text-[#0891b2] hover:border-[#0891b2] flex items-center justify-center transition"
                        aria-label="Email"
                      >
                        <Mail className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
