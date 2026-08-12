import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { useWpwAnalytics } from "@/hooks/useWpwAnalytics";

/**
 * Latest priced quotes — most recent N rows.
 *
 * Three sources, merged + sorted by created_at desc:
 *   - public.quotes          (internal admin QuickQuote on this Supabase)
 *   - public.customer_quotes (public homepage / sub-account submissions)
 *   - WPW analytics endpoint (cross-project, only for WPW tenants)
 *
 * Used by the dashboard LatestQuotesCard. Different from useColdQuotes
 * which filters to cold/open only.
 */

export interface LatestQuoteRow {
  id: string;
  quote_number: string;
  created_at: string;
  customer_total: number | null;
  status: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  customers: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

const db = supabase as never as { from: (t: string) => any };

const useLocalMerged = (limit: number) => {
  return useQuery<LatestQuoteRow[]>({
    queryKey: ["dashboard-latest-quotes", limit],
    queryFn: async () => {
      const fetchLimit = Math.max(limit * 2, 10);

      const [internalRes, publicRes] = await Promise.all([
        db
          .from("quotes")
          .select(
            `id, quote_number, created_at, customer_total, status,
             vehicle_year, vehicle_make, vehicle_model,
             customers ( id, name, email, phone )`,
          )
          .not("quote_number", "like", "DEMO-%")
          .order("created_at", { ascending: false })
          .limit(fetchLimit),
        db
          .from("customer_quotes")
          .select(
            `id, created_at, quote_total, status,
             vehicle_year, vehicle_make, vehicle_model,
             customer_name, customer_email, customer_phone`,
          )
          .order("created_at", { ascending: false })
          .limit(fetchLimit),
      ]);

      if (internalRes?.error) console.warn("Latest quotes (internal) failed:", internalRes.error.message);
      if (publicRes?.error) console.warn("Latest quotes (public) failed:", publicRes.error.message);

      const internal: LatestQuoteRow[] = ((internalRes?.data as any[]) || []).map((r) => ({
        id: r.id,
        quote_number: r.quote_number || "—",
        created_at: r.created_at,
        customer_total: r.customer_total,
        status: r.status,
        vehicle_year: r.vehicle_year,
        vehicle_make: r.vehicle_make,
        vehicle_model: r.vehicle_model,
        customers: r.customers || null,
      }));

      const pub: LatestQuoteRow[] = ((publicRes?.data as any[]) || []).map((r) => ({
        id: r.id,
        quote_number: `RP-${String(r.id).slice(0, 6).toUpperCase()}`,
        created_at: r.created_at,
        customer_total: r.quote_total,
        status: r.status,
        vehicle_year: r.vehicle_year,
        vehicle_make: r.vehicle_make,
        vehicle_model: r.vehicle_model,
        customers: r.customer_name || r.customer_email || r.customer_phone
          ? { id: r.id, name: r.customer_name, email: r.customer_email, phone: r.customer_phone }
          : null,
      }));

      const isDemo = (r: LatestQuoteRow) => {
        const name = r.customers?.name?.toLowerCase() || "";
        const email = r.customers?.email?.toLowerCase() || "";
        return (
          name.includes("demo") ||
          name.includes("(sample)") ||
          email.startsWith("demo@") ||
          email.includes("@example.")
        );
      };

      return [...internal, ...pub]
        .filter((r) => !isDemo(r))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, fetchLimit);
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });
};

export const useLatestQuotes = (limit = 5): { data: LatestQuoteRow[] | undefined; isLoading: boolean } => {
  const { data: isWpw = false } = useIsWpwTenant();
  const { data: local, isLoading: localLoading } = useLocalMerged(limit);
  const { data: wpw, isLoading: wpwLoading } = useWpwAnalytics(30, { enabled: isWpw });

  const wpwMapped: LatestQuoteRow[] = (wpw?.latest_quotes || []).map((q) => ({
    id: q.id,
    quote_number: q.quote_number || `WPW-${String(q.id).slice(0, 6).toUpperCase()}`,
    created_at: q.created_at,
    customer_total: q.customer_total,
    status: q.status,
    vehicle_year: q.vehicle_year,
    vehicle_make: q.vehicle_make,
    vehicle_model: q.vehicle_model,
    customers: q.customer.name || q.customer.email || q.customer.phone
      ? { id: q.id, name: q.customer.name, email: q.customer.email, phone: q.customer.phone }
      : null,
  }));

  const merged = [...wpwMapped, ...(local || [])]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit);

  return {
    data: merged.length > 0 || (local && local.length > 0) ? merged : local,
    isLoading: isWpw ? wpwLoading || localLoading : localLoading,
  };
};
