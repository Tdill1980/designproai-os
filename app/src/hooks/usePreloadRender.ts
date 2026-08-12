/**
 * usePreloadRender — fetches a color_visualizations record by ID.
 *
 * Used by tool pages when opened via "See in Studio" from RevisionStudioIQ.
 * Returns the render data so the tool can populate its state (vehicle info,
 * color, views, prompt, uploaded photos, visionboard).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PreloadedRender {
  id: string;
  mode_type: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  color_name: string | null;
  color_hex: string | null;
  finish_type: string | null;
  render_urls: Record<string, string> | null;
  custom_design_url: string | null;
  custom_swatch_url: string | null;
  admin_notes: Record<string, any> | null;
  prompt: string | null;
}

export const usePreloadRender = (renderId: string | null) => {
  return useQuery<PreloadedRender | null>({
    queryKey: ["preload-render", renderId],
    enabled: !!renderId,
    queryFn: async () => {
      if (!renderId) return null;
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("id, mode_type, vehicle_year, vehicle_make, vehicle_model, color_name, color_hex, finish_type, render_urls, custom_design_url, custom_swatch_url, admin_notes, prompt")
        .eq("id", renderId)
        .single();
      if (error || !data) return null;
      return data as PreloadedRender;
    },
    staleTime: Infinity,
  });
};
