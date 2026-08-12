import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AffiliatePayout } from "@/types/affiliate";

export function useAffiliatePayouts(filters?: { status?: string; period?: string }) {
  return useQuery({
    queryKey: ["affiliate-payouts", filters],
    queryFn: async () => {
      let query = (supabase.from("affiliate_payouts" as any) as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }
      if (filters?.period) {
        query = query.eq("period_label", filters.period);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AffiliatePayout[];
    },
  });
}

export function usePendingPayoutCount() {
  return useQuery({
    queryKey: ["affiliate-pending-payout-count"],
    queryFn: async () => {
      const { count } = await (supabase.from("affiliate_payouts" as any) as any)
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      return count || 0;
    },
  });
}

export function useGeneratePayouts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (period: string) => {
      // Get all pending transactions for the given period
      const { data: transactions, error: txError } = await (supabase.from("affiliate_transactions" as any) as any)
        .select("*")
        .eq("payout_period", period)
        .eq("payout_status", "pending");

      if (txError) throw txError;
      if (!transactions || transactions.length === 0) {
        throw new Error("No pending transactions found for this period");
      }

      // Group transactions by partner
      const grouped: Record<string, { total: number; count: number; ids: string[] }> = {};
      for (const tx of transactions) {
        if (!grouped[tx.partner_id]) {
          grouped[tx.partner_id] = { total: 0, count: 0, ids: [] };
        }
        grouped[tx.partner_id].total += tx.commission_amount_cents;
        grouped[tx.partner_id].count += 1;
        grouped[tx.partner_id].ids.push(tx.id);
      }

      // Create payout records and update transaction statuses
      for (const [partnerId, group] of Object.entries(grouped)) {
        const { data: payout, error: payoutError } = await (supabase.from("affiliate_payouts" as any) as any)
          .insert({
            partner_id: partnerId,
            period_label: period,
            total_amount_cents: group.total,
            transaction_count: group.count,
            status: "pending",
          })
          .select()
          .single();

        if (payoutError) {
          // UNIQUE constraint - payout already exists for this partner+period
          if (payoutError.code === "23505") continue;
          throw payoutError;
        }

        // Mark transactions as included_in_payout
        await (supabase.from("affiliate_transactions" as any) as any)
          .update({ payout_status: "included_in_payout", payout_id: (payout as any).id })
          .in("id", group.ids);
      }

      return Object.keys(grouped).length;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-pending-payout-count"] });
    },
  });
}

export function useMarkPayoutPaid() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      payoutId,
      paymentReference,
      adminNotes,
    }: {
      payoutId: string;
      paymentReference?: string;
      adminNotes?: string;
    }) => {
      // Get the payout to update partner stats
      const { data: payout, error: getError } = await (supabase.from("affiliate_payouts" as any) as any)
        .select("*")
        .eq("id", payoutId)
        .single();
      if (getError) throw getError;

      // Mark payout as paid
      const { error: updateError } = await (supabase.from("affiliate_payouts" as any) as any)
        .update({
          status: "paid",
          payment_reference: paymentReference || null,
          admin_notes: adminNotes || null,
          paid_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", payoutId);
      if (updateError) throw updateError;

      // Mark all transactions in this payout as paid
      await (supabase.from("affiliate_transactions" as any) as any)
        .update({ payout_status: "paid" })
        .eq("payout_id", payoutId);

      // Update partner's paid-out totals
      const p = payout as any;
      const { data: partner } = await (supabase.from("affiliate_partners" as any) as any)
        .select("total_paid_out_cents, pending_balance_cents")
        .eq("id", p.partner_id)
        .single();

      if (partner) {
        const pp = partner as any;
        await (supabase.from("affiliate_partners" as any) as any)
          .update({
            total_paid_out_cents: (pp.total_paid_out_cents || 0) + p.total_amount_cents,
            pending_balance_cents: Math.max(0, (pp.pending_balance_cents || 0) - p.total_amount_cents),
            updated_at: new Date().toISOString(),
          })
          .eq("id", p.partner_id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-partners"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-pending-payout-count"] });
    },
  });
}
