import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AffiliatePartner, AffiliateMarketingAsset } from "@/types/affiliate";

export function useAllAffiliates(statusFilter?: string) {
  return useQuery({
    queryKey: ['admin-affiliates', statusFilter],
    queryFn: async () => {
      let query = supabase
        .from('affiliate_partners')
        .select('*')
        .order('created_at', { ascending: false });

      if (statusFilter && statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AffiliatePartner[];
    },
  });
}

export function useAffiliateDetail(affiliateId: string | undefined) {
  return useQuery({
    queryKey: ['admin-affiliate-detail', affiliateId],
    queryFn: async () => {
      if (!affiliateId) return null;
      const { data, error } = await supabase
        .from('affiliate_partners')
        .select('*')
        .eq('id', affiliateId)
        .single();

      if (error) throw error;
      return data as AffiliatePartner;
    },
    enabled: !!affiliateId,
  });
}

export function useAdminAffiliateReferrals(affiliateId: string | undefined) {
  return useQuery({
    queryKey: ['admin-affiliate-referrals', affiliateId],
    queryFn: async () => {
      if (!affiliateId) return [];
      const { data, error } = await supabase
        .from('affiliate_referrals')
        .select('*')
        .eq('affiliate_id', affiliateId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!affiliateId,
  });
}

export function useUpdateAffiliateStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const updates: any = { status };
      if (status === 'approved') {
        updates.approved_at = new Date().toISOString();
      }
      if (status === 'active' || status === 'approved') {
        // Set next payout date
        const now = new Date();
        const day = now.getDate();
        if (day < 15) {
          updates.next_payout_date = new Date(now.getFullYear(), now.getMonth(), 15).toISOString();
        } else {
          updates.next_payout_date = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
        }
      }

      const { data, error } = await supabase
        .from('affiliate_partners')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-affiliates'] });
      queryClient.invalidateQueries({ queryKey: ['admin-affiliate-detail'] });
    },
  });
}

export function useMarketingAssets() {
  return useQuery({
    queryKey: ['marketing-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('affiliate_marketing_assets')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return (data || []) as AffiliateMarketingAsset[];
    },
  });
}

export function useUploadMarketingAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (asset: Omit<AffiliateMarketingAsset, 'id' | 'created_at'>) => {
      const { data, error } = await supabase
        .from('affiliate_marketing_assets')
        .insert(asset)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-assets'] });
    },
  });
}

export function useDeleteMarketingAsset() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('affiliate_marketing_assets')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-assets'] });
    },
  });
}

export function useUpdateCommissionRate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, commission_rate }: { id: string; commission_rate: number }) => {
      const { data, error } = await supabase
        .from('affiliate_partners')
        .update({ commission_rate })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-affiliates'] });
      queryClient.invalidateQueries({ queryKey: ['admin-affiliate-detail'] });
    },
  });
}

export function useAdminAdSubmissions() {
  return useQuery({
    queryKey: ['admin-ad-submissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('affiliate_ad_submissions')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
  });
}

export function useUpdateAdSubmissionStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status, admin_notes }: { id: string; status: string; admin_notes?: string }) => {
      const updates: any = { status };
      if (admin_notes !== undefined) updates.admin_notes = admin_notes;

      const { data, error } = await supabase
        .from('affiliate_ad_submissions')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-ad-submissions'] });
    },
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin-affiliate-stats'],
    queryFn: async () => {
      const { data: affiliates } = await supabase
        .from('affiliate_partners')
        .select('id, full_name, referral_code, status, total_earned, total_paid, total_referrals, pending_balance, commission_rate');

      const total = affiliates?.length || 0;
      const active = affiliates?.filter(a => a.status === 'active').length || 0;
      const pending = affiliates?.filter(a => a.status === 'pending').length || 0;
      const totalPaid = affiliates?.reduce((sum, a) => sum + (a.total_paid || 0), 0) || 0;
      const totalEarned = affiliates?.reduce((sum, a) => sum + (a.total_earned || 0), 0) || 0;
      const totalReferrals = affiliates?.reduce((sum, a) => sum + (a.total_referrals || 0), 0) || 0;

      // Top performers
      const topPerformers = [...(affiliates || [])]
        .sort((a, b) => (b.total_earned || 0) - (a.total_earned || 0))
        .slice(0, 10);

      return {
        total,
        active,
        pending,
        totalPaid,
        totalEarned,
        totalReferrals,
        topPerformers,
      };
    },
  });
}
