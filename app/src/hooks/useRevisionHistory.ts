import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useOrganization } from "@/contexts/OrganizationContext";

export interface RevisionHistoryItem {
  id: string;
  user_id: string;
  tool: string;
  design_id: string | null;
  view_type: string;
  original_url: string | null;
  revised_url: string;
  revision_prompt: string;
  created_at: string;
}

export function useRevisionHistory(tool: string, designId?: string | null) {
  const queryClient = useQueryClient();
  const { currentShop } = useOrganization();
  const shopId = currentShop?.id ?? null;
  const queryKey = ['revisionHistory', tool, designId ?? null, shopId];

  const { data: revisionHistory = [], isLoading } = useQuery<RevisionHistoryItem[]>({
    queryKey,
    queryFn: async () => {
      if (!shopId) return [];

      let query = supabase
        .from('design_revision_history')
        .select('*')
        .eq('shop_id', shopId)
        .eq('tool', tool)
        .order('created_at', { ascending: false })
        .limit(20);

      if (designId) {
        query = query.eq('design_id', designId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Failed to load revision history:', error);
        return [];
      }

      return data || [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: shopId !== null && (designId !== undefined ? !!designId : true),
  });

  // Kept for backward compat — forces a refetch
  const loadHistory = useCallback(async (_designId?: string) => {
    if (_designId && _designId !== designId) {
      // If called with a different designId, invalidate that specific key
      await queryClient.invalidateQueries({ queryKey: ['revisionHistory', tool, _designId] });
    } else {
      await queryClient.invalidateQueries({ queryKey });
    }
  }, [tool, designId, queryClient, queryKey]);

  // Save a new revision to history. jobId + layerDeltas are Phase 2
  // Rank 2 additions — both are optional and only used by surfaces that
  // have the data on hand. See PHASE2.md + the matching SQL migration.
  const saveRevision = useCallback(async ({
    viewType,
    originalUrl,
    revisedUrl,
    revisionPrompt,
    designId: revDesignId,
    jobId,
    layerDeltas,
  }: {
    viewType: string;
    originalUrl: string | null;
    revisedUrl: string;
    revisionPrompt: string;
    designId?: string;
    jobId?: string | null;
    layerDeltas?: Record<string, unknown>;
  }) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData?.user?.id) {
        console.warn('No user logged in, cannot save revision');
        return null;
      }

      const { data, error } = await (supabase
        .from('design_revision_history') as any)
        .insert({
          user_id: userData.user.id,
          shop_id: shopId,
          tool,
          design_id: revDesignId || null,
          view_type: viewType,
          original_url: originalUrl,
          revised_url: revisedUrl,
          revision_prompt: revisionPrompt,
          job_id: jobId || null,
          layer_deltas: layerDeltas || {},
        })
        .select()
        .single();

      if (error) {
        console.error('Failed to save revision:', error);
        return null;
      }

      // Optimistically update the cache
      queryClient.setQueryData<RevisionHistoryItem[]>(queryKey, (old) =>
        old ? [data, ...old] : [data]
      );
      return data;
    } catch (error) {
      console.error('Error saving revision:', error);
      return null;
    }
  }, [tool, queryClient, queryKey]);

  // Clear local history (for UI reset)
  const clearHistory = useCallback(() => {
    queryClient.setQueryData(queryKey, []);
  }, [queryClient, queryKey]);

  return {
    revisionHistory,
    isLoading,
    loadHistory,
    saveRevision,
    clearHistory
  };
}
