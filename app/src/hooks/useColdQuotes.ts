import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Cold quotes = priced quotes with no follow-up email in the last 48h,
 * still in an open status (not won / not lost).
 *
 * Data source: public.quotes (+ customers join). RLS scopes to current shop.
 */

export interface ColdQuoteRow {
  id: string;
  quote_number: string;
  created_at: string;
  customer_total: number | null;
  last_email_at: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  status: string | null;
  customers: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
  } | null;
}

const db = supabase as any;

export const useColdQuotes = () => {
  return useQuery<ColdQuoteRow[]>({
    queryKey: ["dashboard-cold-quotes"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      const { data, error } = await db
        .from("quotes")
        .select(
          `id, quote_number, created_at, customer_total, last_email_at,
           vehicle_year, vehicle_make, vehicle_model, status,
           customers ( id, name, email, phone )`
        )
        .or(`last_email_at.is.null,last_email_at.lt.${cutoff}`)
        .not("status", "in", "(won,lost)")
        .not("quote_number", "like", "DEMO-%")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.warn("Cold quotes query failed (table may be empty):", error.message);
        return [];
      }
      return ((data || []) as ColdQuoteRow[]).filter((r) => {
        const name = r.customers?.name?.toLowerCase() || "";
        const email = r.customers?.email?.toLowerCase() || "";
        if (name.includes("demo") || name.includes("(sample)")) return false;
        if (email.startsWith("demo@") || email.includes("@example.")) return false;
        return true;
      });
    },
    staleTime: 60 * 1000,
    retry: false,
  });
};
