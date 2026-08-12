import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pulls rows for the dashboard Gallery slider card.
 *
 * Source priority:
 *   1. homepage_showcase rows tagged with name = "dashboard-gallery:*"
 *      (admin-curated)
 *   2. Latest completed rows from color_visualizations marked featured
 *   3. Empty — card shows friendly empty state
 */

export interface GallerySlide {
  id: string;
  imageUrl: string;
  title: string;
  tool?: string;
  href?: string;
}

const db = supabase as never as { from: (t: string) => any };

const pickHeroUrl = (renderUrls: unknown): string | null => {
  if (!renderUrls || typeof renderUrls !== "object") return null;
  for (const [key, value] of Object.entries(renderUrls as Record<string, unknown>)) {
    if (key === "spin_views" || key === "top" || key === "detail") continue;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
};

export const useGallerySlides = (limit = 12) => {
  return useQuery<GallerySlide[]>({
    queryKey: ["dashboard-gallery-slides", limit],
    queryFn: async () => {
      // 1. Admin-curated dashboard gallery slides
      try {
        const { data } = await db
          .from("homepage_showcase")
          .select("id, name, image_url, title, alt_text")
          .like("name", "dashboard-gallery:%")
          .eq("is_active", true)
          .order("name", { ascending: true });
        if (data && data.length > 0) {
          const mapped = data
            .filter((row: any) => row.image_url)
            .map((row: any) => ({
              id: row.id,
              imageUrl: row.image_url,
              title: row.title || row.alt_text || "Gallery",
              tool: undefined,
              href: "/gallery",
            }));
          if (mapped.length > 0) return mapped;
        }
      } catch {
        /* ignore */
      }

      // 2. Fallback: latest featured completed renders
      try {
        const { data } = await db
          .from("color_visualizations")
          .select(
            "id, render_urls, mode_type, vehicle_make, vehicle_model, is_featured_hero"
          )
          .eq("generation_status", "completed")
          .eq("is_featured_hero", true)
          .order("created_at", { ascending: false })
          .limit(limit);
        if (data && data.length > 0) {
          return data
            .map((row: any) => {
              const hero = pickHeroUrl(row.render_urls);
              if (!hero) return null;
              return {
                id: row.id,
                imageUrl: hero,
                title:
                  [row.vehicle_make, row.vehicle_model]
                    .filter(Boolean)
                    .join(" ") || "Render",
                tool: row.mode_type || undefined,
                href: "/gallery",
              } as GallerySlide;
            })
            .filter((row: GallerySlide | null): row is GallerySlide => row !== null);
        }
      } catch {
        /* ignore */
      }

      return [];
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
};
