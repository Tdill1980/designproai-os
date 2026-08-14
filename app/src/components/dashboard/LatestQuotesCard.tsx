import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileText, ShoppingBag, ArrowRight, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useLatestQuotes, type LatestQuoteRow } from "@/hooks/useLatestQuotes";

/**
 * Dashboard LatestQuotesCard — sits next to QuickQuoteCard in row 2.
 *
 * Two-mode display via a tag-button toggle at the top:
 *   - Quotes  → latest quotes (any status)
 *   - Orders  → latest quotes that converted to a job
 *               (status IN 'won' | 'ordered' | 'converted' | 'paid')
 *
 * Each row shows customer name, vehicle, $ total, and relative date.
 * Click through to /quotes for the full list.
 */

type Mode = "quotes" | "orders";

const ORDER_STATUSES = new Set(["won", "ordered", "converted", "paid"]);

const money = (dollars: number | null | undefined): string => {
  if (dollars == null) return "$—";
  return `$${Math.round(dollars).toLocaleString()}`;
};

const formatRelative = (iso: string): string => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const vehicleLabel = (q: LatestQuoteRow): string =>
  [q.vehicle_year, q.vehicle_make, q.vehicle_model].filter(Boolean).join(" ") || "—";

export const LatestQuotesCard = () => {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("quotes");
  const { data: rows, isLoading } = useLatestQuotes(50);

  const filtered = useMemo(() => {
    if (!rows) return [];
    if (mode === "orders") {
      return rows.filter(
        (q) => q.status && ORDER_STATUSES.has(q.status.toLowerCase())
      );
    }
    return rows;
  }, [rows, mode]);

  // Show last 14 days of quotes, up to 15 rows
  const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000;
  const recent = filtered.filter((q) => new Date(q.created_at).getTime() >= twoWeeksAgo);
  const top5 = recent.slice(0, 15);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface flex flex-col">
      {/* ── Header row ── */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5 pb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-md bg-rp-elevated border border-[#48484a] flex items-center justify-center shrink-0">
            <FileText className="w-4 h-4 text-[#60A5FA]" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white font-montserrat tracking-tight">
              Latest{" "}
              <span className="bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
                {mode === "orders" ? "Orders" : "Quotes"}
              </span>
            </h3>
            <div className="text-[10px] text-white/40 font-inter mt-0.5">from QuickQuote Web Tool</div>
          </div>
        </div>

        {/* Tag-button toggle: Quotes / Orders */}
        <div className="flex items-center gap-1 p-0.5 rounded-full border border-[#48484a] bg-black shrink-0">
          <button
            type="button"
            onClick={() => setMode("quotes")}
            className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition",
              mode === "quotes"
                ? "bg-gradient-rp-pop text-white"
                : "text-white/60 hover:text-white"
            )}
          >
            <FileText className="w-3 h-3 inline mr-1" />
            Quotes
          </button>
          <button
            type="button"
            onClick={() => setMode("orders")}
            className={cn(
              "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide transition",
              mode === "orders"
                ? "bg-gradient-rp-pop text-white"
                : "text-white/60 hover:text-white"
            )}
          >
            <ShoppingBag className="w-3 h-3 inline mr-1" />
            Orders
          </button>
        </div>
      </div>

      {/* ── List ── */}
      <div className="flex-1 px-5 pb-3 min-h-0 overflow-y-auto max-h-[400px]">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full bg-rp-elevated rounded-xl" />
            ))}
          </div>
        ) : top5.length === 0 ? (
          <div className="h-full flex items-center justify-center py-8 text-center">
            <div>
              <div className="text-3xl mb-2">
                {mode === "orders" ? "🧾" : "📝"}
              </div>
              <div className="text-sm text-white/70 font-inter">
                {mode === "orders"
                  ? "No orders yet. Convert a quote to see it here."
                  : "No quotes yet. Hit the voice mic on the left to start your first one."}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {top5.map((q) => (
              <div
                key={q.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/quotes?id=${q.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    navigate(`/quotes?id=${q.id}`);
                  }
                }}
                aria-label={`Open quote ${q.quote_number}`}
                title={`Open quote ${q.quote_number}`}
                className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-rp-elevated border border-[#48484a] hover:border-white/30 transition cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
              >
                {/* Highlighted quote number chip */}
                <span
                  className="shrink-0 px-2 py-1 rounded-md bg-black border border-[#60A5FA]/60 text-[#60A5FA] text-[11px] font-bold tracking-tight"
                >
                  #{q.quote_number}
                </span>

                {/* Customer + vehicle row */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <div className="text-xs font-bold text-white truncate">
                      {q.customers?.name || "Unknown"}
                    </div>
                    {q.status && (
                      <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-black border border-[#48484a] text-white/80 shrink-0">
                        {q.status}
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-white/65 truncate font-inter mt-0.5">
                    {vehicleLabel(q)} · {formatRelative(q.created_at)}
                  </div>
                </div>

                {/* Total */}
                <div className="text-xs font-bold text-white font-montserrat shrink-0 mr-1">
                  {money(q.customer_total)}
                </div>

                {/* Contact actions */}
                <div className="flex items-center gap-1 shrink-0">
                  {q.customers?.email && (
                    <a
                      href={`mailto:${q.customers.email}`}
                      className="w-7 h-7 rounded-md border border-[#48484a] bg-black text-white/80 hover:text-white hover:bg-gradient-rp-pop hover:border-transparent flex items-center justify-center transition"
                      aria-label={`Email ${q.customers.name || "customer"}`}
                      title={`Email ${q.customers.email}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Mail className="w-3.5 h-3.5" />
                    </a>
                  )}
                  {q.customers?.phone && (
                    <a
                      href={`tel:${q.customers.phone}`}
                      className="w-7 h-7 rounded-md border border-[#48484a] bg-black text-white/80 hover:text-white hover:bg-gradient-rp-pop hover:border-transparent flex items-center justify-center transition"
                      aria-label={`Call ${q.customers.name || "customer"}`}
                      title={`Call ${q.customers.phone}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Phone className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Footer — view all ── */}
      <div className="border-t border-[#48484a] px-5 py-3">
        <Button
          variant="ghost"
          size="sm"
          asChild
          className="w-full justify-between text-white/80 hover:text-white hover:bg-rp-elevated h-8 text-xs font-semibold"
        >
          <Link to={mode === "orders" ? "/quotes?filter=orders" : "/quotes"}>
            View all {mode === "orders" ? "orders" : "quotes"}
            <ArrowRight className="w-3 h-3" />
          </Link>
        </Button>
      </div>
    </div>
  );
};
