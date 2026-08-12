import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pulls every "section:tool-*" row from homepage_showcase and returns a
 * lookup of tool key → image URL. Used by ToolCard + AppSidebar to render
 * full-bleed card images admins upload from /admin/homepage-images.
 *
 * Returns {} if the table is empty or the query fails — cards fall back to
 * their icon tile cleanly.
 */

const db = supabase as never as { from: (t: string) => any };

const sectionKeyToToolKey = (sectionKey: string): string | null => {
  const match = /^section:tool-(.+)$/.exec(sectionKey);
  return match ? match[1] : null;
};

export const useToolImages = () => {
  return useQuery<Record<string, string>>({
    queryKey: ["tool-card-images"],
    queryFn: async () => {
      const { data, error } = await db
        .from("homepage_showcase")
        .select("name, image_url")
        .like("name", "section:tool-%")
        .eq("is_active", true);

      if (error || !data) return {};

      const map: Record<string, string> = {};
      for (const row of data as { name: string; image_url: string | null }[]) {
        const key = sectionKeyToToolKey(row.name);
        if (key && row.image_url) map[key] = row.image_url;
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
};
