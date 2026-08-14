import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hero carousel source priority:
 *   1. User's own recent renders (from color_visualizations table, matched
 *      on customer_email = session email).
 *   2. Admin-uploaded dashboard hero images (homepage_showcase table,
 *      section:dashboard-hero-1 through section:dashboard-hero-5).
 *      Managed from /admin/homepage-images
 *   3. Nothing — the card gracefully shows the charcoal surface with
 *      only the brand wordmark on top.
 */

export interface HeroSlide {
  id: string;
  imageUrl: string;
  toolLabel: string;       // e.g. "ColorPro"
  vehicleLabel?: string;   // e.g. "2024 BMW M4"
  isFallback?: boolean;
}

const db = supabase as never as { from: (t: string) => any };

/** Map raw mode_type to the branded tool name shown on the carousel badge. */
const TOOL_NAMES: Record<string, string> = {
  colorpro: "ColorPro™",
  ColorPro: "ColorPro™",
  inkfusion: "ColorPro™",
  designpanelpro: "DesignProAI™",
  designpro: "DesignProAI™",
  fadewraps: "FadeWraps™",
  wbty: "PatternPro™",
  graphicspro: "GraphicsPro™",
  patternpro: "PatternPro™",
  myvehicle_colorpro: "MyVehiclePro™ + ColorPro™",
  myvehicle_designpanelpro: "MyVehiclePro™ + DesignProAI™",
  myvehicle_fadewraps: "MyVehiclePro™ + FadeWraps™",
  myvehicle_graphicspro: "MyVehiclePro™ + GraphicsPro™",
};

const friendlyToolName = (modeType: string | null): string =>
  TOOL_NAMES[modeType || ""] || modeType || "Render";

// View keys we never want on the dashboard hero — rear angles read flat
// in a marketing carousel, and spin/top/detail are non-hero crops.
const SKIP_VIEWS = new Set([
  "spin_views",
  "top",
  "detail",
  "rear",
  "rear-3/4",
  "rear_3_4",
  "rear-three-quarter",
  "back",
]);

// Preferred order — driver/passenger side profiles read as the strongest
// hero shot, then fall back to 3/4 angles before anything else.
const PREFERRED_VIEW_ORDER = [
  "side",
  "driver",
  "driver-side",
  "driver_side",
  "passenger-side",
  "passenger_side",
  "passenger",
  "profile",
  "front-3/4",
  "front_3_4",
  "front-three-quarter",
  "front",
  "hood_detail",
  "close-up",
];

const pickHeroUrl = (renderUrls: unknown): string | null => {
  if (!renderUrls || typeof renderUrls !== "object") return null;
  const entries = Object.entries(renderUrls as Record<string, unknown>).filter(
    ([key, value]) =>
      !SKIP_VIEWS.has(key) &&
      !key.toLowerCase().startsWith("rear") &&
      typeof value === "string" &&
      (value as string).length > 0
  );
  if (entries.length === 0) return null;

  for (const preferred of PREFERRED_VIEW_ORDER) {
    const hit = entries.find(([key]) => key === preferred);
    if (hit) return hit[1] as string;
  }
  // Last-resort fallback: any non-rear, non-skipped view.
  return entries[0][1] as string;
};

export const useHeroRenderCarousel = () => {
  return useQuery<HeroSlide[]>({
    queryKey: ["dashboard-hero-carousel"],
    queryFn: async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const email = session?.user?.email;

      // 1. Try the user's own recent completed visualizations first
      if (email) {
        const { data: mine } = await db
          .from("color_visualizations")
          .select(
            "id, render_urls, mode_type, vehicle_year, vehicle_make, vehicle_model"
          )
          .eq("customer_email", email)
          .eq("generation_status", "completed")
          .order("created_at", { ascending: false })
          .limit(12);

        const mapped = (mine || [])
          .map((row: any) => {
            const hero = pickHeroUrl(row.render_urls);
            if (!hero) return null;
            return {
              id: row.id,
              imageUrl: hero,
              toolLabel: friendlyToolName(row.mode_type),
              vehicleLabel: [row.vehicle_year, row.vehicle_make, row.vehicle_model]
                .filter(Boolean)
                .join(" "),
            } as HeroSlide;
          })
          .filter((row: HeroSlide | null): row is HeroSlide => row !== null);

        if (mapped.length >= 3) return mapped;
      }

      // 2. Admin-uploaded dashboard hero slots
      //    Managed from /admin/homepage-images under "Dashboard Hero 1-5"
      const { data: adminSlides } = await db
        .from("homepage_showcase")
        .select("id, name, image_url, title, alt_text")
        .like("name", "section:dashboard-hero-%")
        .eq("is_active", true)
        .order("name", { ascending: true });

      if (adminSlides && adminSlides.length > 0) {
        return adminSlides
          .filter((row: any) => row.image_url)
          .map((row: any) => ({
            id: row.id,
            imageUrl: row.image_url,
            toolLabel: "Featured",
            vehicleLabel: row.title || row.alt_text || "",
            isFallback: true,
          }));
      }

      // 3. Nothing — the HeroBrandCard handles the empty state
      //    (just charcoal + the wordmark, no broken images)
      return [];
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
};
