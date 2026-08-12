import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AffiliateTransaction } from "@/types/affiliate";

export function useAffiliateTransactions(filters?: {
  partnerId?: string;
  payoutPeriod?: string;
  payoutStatus?: string;
}) {
  return useQuery({
    queryKey: ["affiliate-transactions", filters],
    queryFn: async () => {
      let query = (supabase.from("affiliate_transactions" as any) as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.partnerId) {
        query = query.eq("partner_id", filters.partnerId);
      }
      if (filters?.payoutPeriod) {
        query = query.eq("payout_period", filters.payoutPeriod);
      }
      if (filters?.payoutStatus) {
        query = query.eq("payout_status", filters.payoutStatus);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AffiliateTransaction[];
    },
  });
}

export function useAffiliateTransactionsByPartner(partnerId: string | undefined) {
  return useQuery({
    queryKey: ["affiliate-transactions", "partner", partnerId],
    queryFn: async () => {
      if (!partnerId) return [];
      const { data, error } = await (supabase.from("affiliate_transactions" as any) as any)
        .select("*")
        .eq("partner_id", partnerId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as AffiliateTransaction[];
    },
    enabled: !!partnerId,
  });
}

export function useMonthlyCommissionTotal(period?: string) {
  return useQuery({
    queryKey: ["affiliate-monthly-commission", period],
    queryFn: async () => {
      const currentPeriod = period || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
      const { data, error } = await (supabase.from("affiliate_transactions" as any) as any)
        .select("commission_amount_cents")
        .eq("payout_period", currentPeriod);
      if (error) throw error;
      const total = (data || []).reduce((sum: number, t: any) => sum + (t.commission_amount_cents || 0), 0);
      return total as number;
    },
  });
}
