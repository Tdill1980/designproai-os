import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetches starred (is_featured_hero) DesignProAI render URLs for the showcase.
 * Scoped to the DesignPro family only (designpanelpro + its MyVehicle variants)
 * so the carousel shows ONLY DesignPro designs — not ColorPro/ApproveMode/etc.
 * Returns up to 8 image URLs to rotate as slide backgrounds.
 */
const DESIGNPRO_MODE_TYPES = [
  "designpanelpro",
  "myvehicle_designpanelpro",
  "myvehicle_designpanelpropremium",
  "myvehicle_designpro_direct",
];

export const useStarredRenders = () => {
  return useQuery({
    queryKey: ["showcase-renders", "designpro"],
    queryFn: async () => {
      // Pull starred DesignPro renders from color_visualizations
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("render_urls")
        .eq("is_featured_hero", true)
        .in("mode_type", DESIGNPRO_MODE_TYPES)
        .order("created_at", { ascending: false })
        .limit(8);

      if (error) {
        console.warn("[ShowcaseRenders] Query failed:", error.message);
        return [];
      }

      console.log(`[ShowcaseRenders] Found ${data?.length || 0} starred renders`);

      // Extract the first available view URL from each render
      const urls: string[] = [];
      for (const row of data || []) {
        const renderUrls = row.render_urls as any;
        if (!renderUrls) continue;
        // Pick best view in priority order
        const url = renderUrls.side || renderUrls.front || renderUrls.hood_detail
          || renderUrls.rear || renderUrls.top || renderUrls.roof
          || (typeof renderUrls === "object" && Object.values(renderUrls).find((v: any) => typeof v === "string" && v.startsWith("http")));
        if (url) urls.push(url as string);
      }
      console.log(`[ShowcaseRenders] Extracted ${urls.length} image URLs`);
      return urls;
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });
};
