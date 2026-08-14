import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { MIGHTYMAIL_LANDING_SLOTS } from "@/lib/mightymail-landing-slots";

/**
 * Reads every `mightymail:*` row from homepage_showcase and returns a
 * lookup of slot key (e.g. "hero", "usp-analytics") to public URL.
 * Backs the public landing page at /mightymail-info and the admin
 * uploader at /admin/mightymail-landing.
 */

const db = supabase as never as { from: (t: string) => any };

export const mightymailLandingAssetsKey = ["mightymail-landing-assets"] as const;

export const useMightyMailLandingAssets = () => {
  return useQuery<Record<string, string>>({
    queryKey: mightymailLandingAssetsKey,
    queryFn: async () => {
      const { data, error } = await db
        .from("homepage_showcase")
        .select("name, image_url")
        .like("name", "mightymail:%")
        .eq("is_active", true);

      if (error || !data) return {};

      const map: Record<string, string> = {};
      for (const row of data as { name: string; image_url: string | null }[]) {
        if (!row.image_url) continue;
        const slot = MIGHTYMAIL_LANDING_SLOTS.find((s) => s.rowName === row.name);
        if (slot) map[slot.key] = row.image_url;
      }
      return map;
    },
    staleTime: 60 * 1000,
    retry: false,
  });
};
