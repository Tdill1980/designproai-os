import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { AffiliatePartner, AffiliatePartnerInsert, AffiliatePartnerUpdate } from "@/types/affiliate";

export function useAffiliatePartners(filters?: { status?: string }) {
  return useQuery({
    queryKey: ["affiliate-partners", filters],
    queryFn: async () => {
      let query = (supabase.from("affiliate_partners" as any) as any)
        .select("*")
        .order("created_at", { ascending: false });

      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as AffiliatePartner[];
    },
  });
}

export function useAffiliatePartner(id: string | undefined) {
  return useQuery({
    queryKey: ["affiliate-partner", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await (supabase.from("affiliate_partners" as any) as any)
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as AffiliatePartner;
    },
    enabled: !!id,
  });
}

export function useAffiliatePartnerCount() {
  return useQuery({
    queryKey: ["affiliate-partner-count"],
    queryFn: async () => {
      const { count } = await (supabase.from("affiliate_partners" as any) as any)
        .select("*", { count: "exact", head: true });
      return count || 0;
    },
  });
}

export function useCreateAffiliatePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (partner: AffiliatePartnerInsert) => {
      const { data, error } = await (supabase.from("affiliate_partners" as any) as any)
        .insert(partner)
        .select()
        .single();
      if (error) throw error;
      return data as AffiliatePartner;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-partners"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-partner-count"] });
    },
  });
}

export function useUpdateAffiliatePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: AffiliatePartnerUpdate }) => {
      const { data, error } = await (supabase.from("affiliate_partners" as any) as any)
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AffiliatePartner;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-partners"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-partner", variables.id] });
    },
  });
}

export function useDeleteAffiliatePartner() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase.from("affiliate_partners" as any) as any)
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["affiliate-partners"] });
      queryClient.invalidateQueries({ queryKey: ["affiliate-partner-count"] });
    },
  });
}
