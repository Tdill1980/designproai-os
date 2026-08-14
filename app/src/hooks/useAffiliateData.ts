import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AffiliatePartner } from "@/types/affiliate";

export function useAffiliateProfile() {
  return useQuery({
    queryKey: ['affiliate-profile'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;

      // Try by user_id first
      const { data, error } = await supabase
        .from('affiliate_partners')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) {
        console.error('[affiliate-profile] user_id lookup error:', error.message);
      }

      if (data) return data as AffiliatePartner;

      // Fallback: try by email (handles cases where user_id wasn't linked yet)
      if (user.email) {
        const { data: emailData, error: emailError } = await supabase
          .from('affiliate_partners')
          .select('*')
          .eq('email', user.email)
          .maybeSingle();

        if (emailError) {
          console.error('[affiliate-profile] email lookup error:', emailError.message);
        }

        if (emailData) {
          // Auto-link user_id for future lookups
          if (!emailData.user_id) {
            await supabase
              .from('affiliate_partners')
              .update({ user_id: user.id })
              .eq('id', emailData.id);
          }
          return emailData as AffiliatePartner;
        }
      }

      return null;
    },
  });
}

export function useAffiliateReferrals(affiliateId: string | undefined) {
  return useQuery({
    queryKey: ['affiliate-referrals', affiliateId],
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

export function useAffiliateCommissions(affiliateId: string | undefined) {
  return useQuery({
    queryKey: ['affiliate-commissions', affiliateId],
    queryFn: async () => {
      if (!affiliateId) return [];
      const { data, error } = await supabase
        .from('affiliate_commissions')
        .select('*')
        .eq('affiliate_id', affiliateId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!affiliateId,
  });
}

export function useAffiliatePayouts(affiliateId: string | undefined) {
  return useQuery({
    queryKey: ['affiliate-payouts', affiliateId],
    queryFn: async () => {
      if (!affiliateId) return [];
      const { data, error } = await supabase
        .from('affiliate_payouts')
        .select('*')
        .eq('affiliate_id', affiliateId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
    },
    enabled: !!affiliateId,
  });
}

export function useAffiliateSignup() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (formData: {
      full_name: string;
      email: string;
      company_name?: string;
      tax_id?: string;
      country?: string;
      phone?: string;
      website?: string;
      instagram_handle?: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Please log in first');

      const { data, error } = await supabase.functions.invoke('affiliate-signup', {
        body: formData,
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['affiliate-profile'] });
    },
  });
}

export function useUpdateAffiliateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: Partial<AffiliatePartner>) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('affiliate_partners')
        .update(updates)
        .eq('user_id', user.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['affiliate-profile'] });
    },
  });
}

export function useMonthlyEarnings(affiliateId: string | undefined) {
  return useQuery({
    queryKey: ['affiliate-monthly-earnings', affiliateId],
    queryFn: async () => {
      if (!affiliateId) return [];
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const { data, error } = await supabase
        .from('affiliate_commissions')
        .select('amount, created_at, status')
        .eq('affiliate_id', affiliateId)
        .gte('created_at', sixMonthsAgo.toISOString())
        .order('created_at', { ascending: true });

      if (error) throw error;

      // Group by month
      const monthlyMap = new Map<string, number>();
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthlyMap.set(key, 0);
        months.push(key);
      }

      (data || []).forEach((c) => {
        const d = new Date(c.created_at);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (monthlyMap.has(key)) {
          monthlyMap.set(key, (monthlyMap.get(key) || 0) + (c.amount || 0));
        }
      });

      return months.map(key => {
        const [year, month] = key.split('-');
        const date = new Date(parseInt(year), parseInt(month) - 1);
        return {
          month: date.toLocaleString('default', { month: 'short' }),
          earnings: monthlyMap.get(key) || 0,
        };
      });
    },
    enabled: !!affiliateId,
  });
}
