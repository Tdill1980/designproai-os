import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { carouselRowNames } from "@/lib/product-image-slots";

/**
 * Reads the up-to-3 carousel images for a product page from
 * homepage_showcase (rows named `product-carousel:<slug>:<n>`), returned
 * in slot order with empty slots dropped. Backs <ProductImageCarousel>
 * and the admin uploader at /admin/product-images.
 */

const db = supabase as never as { from: (t: string) => any };

export const productCarouselKey = (slug: string) => ["product-carousel", slug] as const;

export function useProductCarousel(slug: string) {
  return useQuery<string[]>({
    queryKey: productCarouselKey(slug),
    queryFn: async () => {
      const names = carouselRowNames(slug);
      const { data, error } = await db
        .from("homepage_showcase")
        .select("name, image_url")
        .in("name", names)
        .eq("is_active", true);
      if (error || !data) return [];
      const byName: Record<string, string> = {};
      for (const row of data as { name: string; image_url: string | null }[]) {
        if (row.image_url) byName[row.name] = row.image_url;
      }
      // Preserve slot order (1,2,3); drop blanks.
      return names.map((n) => byName[n]).filter(Boolean) as string[];
    },
    staleTime: 60 * 1000,
    retry: false,
  });
}
