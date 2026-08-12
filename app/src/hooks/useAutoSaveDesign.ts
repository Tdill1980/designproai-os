import { supabase } from "@/integrations/supabase/client";
import { useCallback } from "react";
import { useOrganization } from "@/contexts/OrganizationContext";

interface AutoSaveParams {
  tool: 'panel' | 'pattern' | 'fadewrap';
  vehicle: {
    year?: string;
    make?: string;
    model?: string;
  };
  heroUrl: string;
  renderUrls?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export function useAutoSaveDesign() {
  const { currentShop } = useOrganization();
  const shopId = currentShop?.id ?? null;

  const autoSave = useCallback(async ({ tool, vehicle, heroUrl, renderUrls, metadata }: AutoSaveParams) => {
    if (!heroUrl) return null;

    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user?.id) return null;

    // shop_id is nullable today (Phase 1b); we populate it on writes so the
    // Phase 2 follow-up can NOT-NULL the column. Teammate RLS lets members
    // insert under the current shop's id via the *_team_access policy.
    const baseData = {
      user_id: userData.user.id,
      shop_id: shopId,
      vehicle_year: vehicle.year || null,
      vehicle_make: vehicle.make || null,
      vehicle_model: vehicle.model || null,
      preview_image_url: heroUrl,
    };

    try {
      if (tool === 'panel') {
        const { data, error } = await supabase.from('panel_designs').insert({
          ...baseData,
          prompt_state: {
            heroUrl,
            renderUrls,
            ...metadata,
          },
          finish: (metadata?.finish as string) || 'Gloss',
        }).select('id').single();
        
        if (error) throw error;
        return data?.id;
      }

      if (tool === 'pattern') {
        const { data, error } = await supabase.from('pattern_designs').insert({
          ...baseData,
          pattern_image_url: (metadata?.patternUrl as string) || heroUrl,
          pattern_name: (metadata?.patternName as string) || 'Custom Pattern',
          texture_profile: {
            heroUrl,
            renderUrls,
            ...metadata,
          },
          finish: (metadata?.finish as string) || 'Gloss',
        }).select('id').single();
        
        if (error) throw error;
        return data?.id;
      }

      if (tool === 'fadewrap') {
        const { data, error } = await supabase.from('fadewrap_designs').insert({
          ...baseData,
          fade_name: (metadata?.fadeName as string) || 'Custom Fade',
          gradient_settings: {
            heroUrl,
            renderUrls,
            ...metadata,
          },
          finish: (metadata?.finish as string) || 'Gloss',
        }).select('id').single();
        
        if (error) throw error;
        return data?.id;
      }

      return null;
    } catch (error) {
      console.error('Auto-save failed:', error);
      return null;
    }
  }, [shopId]);

  return { autoSave };
}
