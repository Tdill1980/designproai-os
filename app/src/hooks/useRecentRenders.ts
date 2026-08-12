import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RecentRenderItem {
  id: string;
  imageUrl: string;
  toolType: string;
  vehicleLabel: string;
  createdAt: string;
}

const db = supabase as any;

const TOOL_NAMES: Record<string, string> = {
  colorpro: "ColorPro",
  ColorPro: "ColorPro",
  inkfusion: "ColorPro",
  designpanelpro: "DesignPro",
  designpro: "DesignPro",
  fadewraps: "FadeWraps",
  wbty: "WrapByTheYard",
  graphicspro: "GraphicsPro",
  patternpro: "PatternPro",
  myvehicle_colorpro: "MyVehiclePro",
  myvehicle_designpanelpro: "MyVehiclePro",
  myvehicle_fadewraps: "MyVehiclePro",
  myvehicle_graphicspro: "MyVehiclePro",
};

/**
 * Pulls the user's most recent renders from `color_visualizations`.
 * The table stores per-view URLs inside a `render_urls` jsonb column, so we
 * pick the first non-spin view URL we find for the thumbnail.
 */
const pickHeroUrl = (renderUrls: unknown): string | null => {
  if (!renderUrls || typeof renderUrls !== "object") return null;
  const entries = Object.entries(renderUrls as Record<string, unknown>);
  for (const [key, value] of entries) {
    if (key === "spin_views" || key === "top" || key === "detail") continue;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
};

export const useRecentRenders = (limit = 8) => {
  return useQuery<RecentRenderItem[]>({
    queryKey: ["dashboard-recent-renders", limit],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;
      if (!email) return [];

      const { data, error } = await db
        .from("color_visualizations")
        .select(
          "id, render_urls, mode_type, vehicle_year, vehicle_make, vehicle_model, created_at, generation_status"
        )
        .eq("customer_email", email)
        .eq("generation_status", "completed")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        console.warn("Recent renders query failed:", error.message);
        return [];
      }

      return ((data as any[]) || [])
        .map((row) => {
          const hero = pickHeroUrl(row.render_urls);
          if (!hero) return null;
          return {
            id: row.id,
            imageUrl: hero,
            toolType: TOOL_NAMES[row.mode_type || ""] || row.mode_type || "Render",
            vehicleLabel: [row.vehicle_year, row.vehicle_make, row.vehicle_model]
              .filter(Boolean)
              .join(" "),
            createdAt: row.created_at,
          };
        })
        .filter((row): row is RecentRenderItem => row !== null);
    },
    staleTime: 60 * 1000,
    retry: false,
  });
};
