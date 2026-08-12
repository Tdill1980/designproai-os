import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { WPW_FOUNDER_SLOTS } from "@/lib/wpw-founder-slots";

/**
 * Reads every `wpw-founder:*` row from homepage_showcase and returns a
 * lookup of slot key (e.g. "video", "tool-designproai") to public URL.
 * Backs the founder invitation page at /from/weprintwraps and the
 * admin uploader at /admin/wpw-founder-assets.
 */

const db = supabase as never as { from: (t: string) => any };

export const wpwFounderAssetsKey = ["wpw-founder-assets"] as const;

export const useWpwFounderAssets = () => {
  return useQuery<Record<string, string>>({
    queryKey: wpwFounderAssetsKey,
    queryFn: async () => {
      const { data, error } = await db
        .from("homepage_showcase")
        .select("name, image_url")
        .or("name.like.wpw-founder:%,name.like.wpw-team:%")
        .eq("is_active", true);

      if (error || !data) return {};

      const map: Record<string, string> = {};
      for (const row of data as { name: string; image_url: string | null }[]) {
        if (!row.image_url) continue;
        const slot = WPW_FOUNDER_SLOTS.find((s) => s.rowName === row.name);
        if (slot) map[slot.key] = row.image_url;
      }
      return map;
    },
    staleTime: 60 * 1000,
    retry: false,
  });
};
