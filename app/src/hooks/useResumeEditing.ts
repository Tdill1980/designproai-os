import { supabase } from "@/integrations/supabase/client";
import { useCallback } from "react";

export interface ResumedDesignState {
  id: string;
  tool: 'panel' | 'pattern' | 'fadewrap';
  vehicle: {
    year?: string;
    make?: string;
    model?: string;
  };
  heroUrl?: string;
  renderUrls?: Record<string, string>;
  metadata?: Record<string, unknown>;
  finish?: string;
}

export function useResumeEditing() {
  const loadDesign = useCallback(async (
    designId: string, 
    tool: 'panel' | 'pattern' | 'fadewrap'
  ): Promise<ResumedDesignState | null> => {
    try {
      if (tool === 'panel') {
        const { data, error } = await supabase
          .from('panel_designs')
          .select('*')
          .eq('id', designId)
          .maybeSingle();

        if (error || !data) return null;

        const promptState = data.prompt_state as Record<string, unknown> | null;
        return {
          id: data.id,
          tool: 'panel',
          vehicle: {
            year: data.vehicle_year || undefined,
            make: data.vehicle_make || undefined,
            model: data.vehicle_model || undefined,
          },
          heroUrl: (promptState?.heroUrl as string) || data.preview_image_url || undefined,
          renderUrls: (promptState?.renderUrls as Record<string, string>) || undefined,
          metadata: promptState || undefined,
          finish: data.finish || undefined,
        };
      }

      if (tool === 'pattern') {
        const { data, error } = await supabase
          .from('pattern_designs')
          .select('*')
          .eq('id', designId)
          .maybeSingle();

        if (error || !data) return null;

        const textureProfile = data.texture_profile as Record<string, unknown> | null;
        return {
          id: data.id,
          tool: 'pattern',
          vehicle: {
            year: data.vehicle_year || undefined,
            make: data.vehicle_make || undefined,
            model: data.vehicle_model || undefined,
          },
          heroUrl: (textureProfile?.heroUrl as string) || data.preview_image_url || undefined,
          renderUrls: (textureProfile?.renderUrls as Record<string, string>) || undefined,
          metadata: {
            patternUrl: data.pattern_image_url,
            patternName: data.pattern_name,
            ...textureProfile,
          },
          finish: data.finish || undefined,
        };
      }

      if (tool === 'fadewrap') {
        const { data, error } = await supabase
          .from('fadewrap_designs')
          .select('*')
          .eq('id', designId)
          .maybeSingle();

        if (error || !data) return null;

        const gradientSettings = data.gradient_settings as Record<string, unknown> | null;
        return {
          id: data.id,
          tool: 'fadewrap',
          vehicle: {
            year: data.vehicle_year || undefined,
            make: data.vehicle_make || undefined,
            model: data.vehicle_model || undefined,
          },
          heroUrl: (gradientSettings?.heroUrl as string) || data.preview_image_url || undefined,
          renderUrls: (gradientSettings?.renderUrls as Record<string, string>) || undefined,
          metadata: {
            fadeName: data.fade_name,
            ...gradientSettings,
          },
          finish: data.finish || undefined,
        };
      }

      return null;
    } catch (error) {
      console.error('Failed to load design:', error);
      return null;
    }
  }, []);

  return { loadDesign };
}
