import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const CAMPAIGN_SETTING_DEFAULTS = {
  wpw_video_horizontal_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  wpw_video_vertical_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  wpw_poster_horizontal: "/screenshots/porsche-distressed-hero.png",
  wpw_poster_vertical: "/screenshots/porsche-distressed-hero.png",
  launch_video_horizontal_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  launch_video_vertical_url: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  launch_poster_horizontal: "/screenshots/porsche-distressed-hero.png",
  launch_poster_vertical: "/screenshots/porsche-distressed-hero.png",
} as const;

export type CampaignSettingKey = keyof typeof CAMPAIGN_SETTING_DEFAULTS;
export type CampaignSettings = Record<CampaignSettingKey, string>;

const QUERY_KEY = ["campaign_settings"] as const;

async function fetchCampaignSettings(): Promise<CampaignSettings> {
  const { data, error } = await supabase
    .from("campaign_settings" as any)
    .select("key, value");

  // Table missing or RLS blocking → fall back to bundled defaults so the
  // landing pages still render correctly.
  if (error) {
    if (typeof console !== "undefined") {
      console.warn("[useCampaignSettings] falling back to defaults:", error.message);
    }
    return { ...CAMPAIGN_SETTING_DEFAULTS };
  }

  const map: CampaignSettings = { ...CAMPAIGN_SETTING_DEFAULTS };
  for (const row of (data || []) as { key: string; value: string }[]) {
    if (row.key in map) {
      (map as Record<string, string>)[row.key] = row.value;
    }
  }
  return map;
}

export function useCampaignSettings() {
  return useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchCampaignSettings,
    staleTime: 60_000,
    retry: 1,
    placeholderData: { ...CAMPAIGN_SETTING_DEFAULTS },
  });
}

/** Used by the admin page after a save to refresh consumers. */
export const CAMPAIGN_SETTINGS_QUERY_KEY = QUERY_KEY;
