/**
 * TeamOrders — /orders
 *
 * Team-facing view of EVERY WePrintWraps order (active + past). Search by
 * customer email or order number, narrow by month/year, and open any order
 * to see the brief, uploaded artwork, past artwork from that customer, and
 * print the full work order PDF (all via WpwOrderDetailModal).
 *
 * White UI standard: black global nav (app shell) + white content; the
 * blue->magenta gradient is used only as an accent (hairline, logo tile,
 * wordmark). See docs/WHITE_UI_STANDARD.md.
 */

import { useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Package, Loader2, CalendarDays, ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { wpwStatusClass, wpwStatusLabel, type WpwOrder } from "@/hooks/useWpwOrders";
import { WpwOrderDetailModal } from "@/components/dashboard/WpwOrderDetailModal";
import { extractBriefAndUploads } from "@/lib/wpw-order-extract";
import { ImageIcon } from "lucide-react";

// Representative artwork = ONLY the customer's file uploaded to this order
// (from line-item meta). Never item.image_url (the generic product photo).
// null => show a "no artwork" placeholder.
function orderArtwork(o: WpwOrder): string | null {
  try {
    const { uploads } = extractBriefAndUploads(o, o.wpw_order_items || []);
    if (uploads && uploads.length > 0) return uploads[0];
  } catch { /* ignore */ }
  return null;
}
import { cn } from "@/lib/utils";

const currency = (amount: number | null, code?: string | null) => {
  if (amount == null) return "—";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code || "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
};

const formatDate = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
};

// "2026-05" key + "May 2026" label from a date.
const monthKey = (iso: string | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (key: string): string => {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
};

export default function TeamOrders() {
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState(() => searchParams.get("q") || "");
  const [month, setMonth] = useState<string>("all");
  const [detailOrder, setDetailOrder] = useState<WpwOrder | null>(null);

  const sortByNewest = (rows: WpwOrder[]) =>
    rows
      .slice()
      .sort((a, b) => new Date(b.date_created || 0).getTime() - new Date(a.date_created || 0).getTime());

  // Default view: every WePrintWraps order, preloaded so the whole team
  // just clicks /orders and sees them all — no linking, no filtering.
  const { data: orders, isLoading } = useQuery({
    queryKey: ["team_all_orders"],
    queryFn: async (): Promise<WpwOrder[]> => {
      const { data, error } = await supabase.functions.invoke("wpw-orders-read", { body: {} });
      if (error) throw error;
      return sortByNewest((data?.orders || data || []) as WpwOrder[]);
    },
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });

  // Server-side search by email / order number / customer name. Runs
  // against the whole order history (not just the preloaded page), so a
  // customer from years ago is still findable. Debounced to avoid a
  // request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);
  const searchActive = debouncedSearch.length >= 2;
  const { data: searchResults, isFetching: isSearching } = useQuery({
    queryKey: ["team_order_search", debouncedSearch],
    enabled: searchActive,
    queryFn: async (): Promise<WpwOrder[]> => {
      const { data, error } = await supabase.functions.invoke("wpw-orders-read", {
        body: { search: debouncedSearch },
      });
      if (error) throw error;
      return sortByNewest((data?.orders || []) as WpwOrder[]);
    },
    staleTime: 30_000,
  });

  // The list payload is lean (no line-item `meta`, no addresses) so the
  // edge function never has to serialize ~30 MB at once. When a row is
  // opened, pull that one order's FULL record (meta → artwork & options,
  // billing/shipping → addresses) through the same service-role function.
  const { data: fullOrder } = useQuery({
    queryKey: ["team_order_full", detailOrder?.id],
    enabled: detailOrder?.id != null,
    queryFn: async (): Promise<WpwOrder | null> => {
      const { data, error } = await supabase.functions.invoke("wpw-orders-read", {
        body: { orderId: detailOrder!.id },
      });
      if (error) throw error;
      return (data?.order || null) as WpwOrder | null;
    },
    staleTime: 60_000,
  });

  // Month options derived from the orders we actually have.
  const monthOptions = useMemo(() => {
    const keys = new Set<string>();
    for (const o of orders || []) {
      const k = monthKey(o.date_created);
      if (k) keys.add(k);
    }
    return Array.from(keys).sort().reverse();
  }, [orders]);

  // When the user is searching, show the server results (whole history);
  // otherwise show the full preloaded list. The client-side text filter
  // still applies on top so short (1-char) terms refine instantly before
  // the debounced server query lands.
  const source = searchActive ? (searchResults || []) : (orders || []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return source.filter((o) => {
      if (month !== "all" && monthKey(o.date_created) !== month) return false;
      if (!q) return true;
      const email = (o.customer_email || "").toLowerCase();
      const name = (o.customer_name || "").toLowerCase();
      const num = String(o.order_number || o.id || "").toLowerCase();
      return email.includes(q) || name.includes(q) || num.includes(q);
    });
  }, [source, search, month]);

  const listLoading = isLoading || (searchActive && isSearching);

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Helmet><title>Orders — RestyleProAI</title></Helmet>

      {/* Brand accent hairline */}
      <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm shrink-0">
            <Package className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold leading-none">
              <span className="text-gray-900">Orders</span>
              <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
              <span className="text-gray-400 text-[11px] ml-0.5 align-top">&trade;</span>
            </h1>
            <p className="text-[12px] text-gray-500 mt-1">All orders — active &amp; past. Open one to view artwork or print the work order.</p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by email or order #…"
              className="pl-9 h-10 bg-gray-50 border-gray-200 text-gray-900"
            />
          </div>
          <select
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="h-10 rounded-md border border-gray-200 bg-gray-50 px-3 text-sm text-gray-900 sm:w-52"
          >
            <option value="all">All months</option>
            {monthOptions.map((k) => (
              <option key={k} value={k}>{monthLabel(k)}</option>
            ))}
          </select>
        </div>

        {/* Count */}
        <p className="text-[12px] text-gray-500 mt-3">
          {listLoading ? "Loading orders…" : `${filtered.length} order${filtered.length === 1 ? "" : "s"}`}
          {month !== "all" && !listLoading ? ` in ${monthLabel(month)}` : ""}
        </p>

        {/* List */}
        <div className="mt-2 space-y-1.5">
          {listLoading ? (
            <Card className="p-6 flex items-center justify-center gap-2 text-gray-500 bg-white border-gray-200">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading orders…
            </Card>
          ) : filtered.length === 0 ? (
            <Card className="p-6 text-center text-sm text-gray-500 bg-white border-gray-200">
              No orders match your search.
            </Card>
          ) : (
            filtered.map((o) => {
              const itemName = o.wpw_order_items?.[0]?.name || "Order";
              const extra = (o.wpw_order_items?.length || 0) > 1 ? ` +${o.wpw_order_items!.length - 1}` : "";
              const art = orderArtwork(o);
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => setDetailOrder(o)}
                  className="w-full text-left rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100 transition-colors p-3"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-md bg-white border border-gray-200 overflow-hidden shrink-0 flex items-center justify-center">
                      {art ? (
                        <img src={art} alt="" className="w-full h-full object-cover" loading="lazy" />
                      ) : (
                        <ImageIcon className="w-5 h-5 text-gray-300" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-bold text-gray-900">#{o.order_number || o.id}</span>
                        <Badge className={cn(wpwStatusClass(o.status), "text-[9px] font-bold uppercase tracking-wider")}>
                          {wpwStatusLabel(o.status)}
                        </Badge>
                      </div>
                      <p className="text-[13px] text-gray-900 truncate">{itemName}{extra}</p>
                      <p className="text-[12px] text-gray-500 truncate">{o.customer_name || o.customer_email || "—"}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-sm font-semibold text-gray-900">{currency(o.total, o.currency)}</div>
                      <div className="text-[11px] text-gray-500 flex items-center gap-1 justify-end mt-0.5">
                        <CalendarDays className="w-3 h-3" />{formatDate(o.date_created)}
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[#3b82f6] shrink-0" />
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      <WpwOrderDetailModal
        orderId={detailOrder?.id ?? null}
        initialOrder={(fullOrder && fullOrder.id === detailOrder?.id) ? fullOrder : detailOrder}
        onClose={() => setDetailOrder(null)}
        staffActions
      />
    </div>
  );
}
