import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Pulls 3 starred renders from color_visualizations to populate the
 * /pricing landing hero. Trish stars renders inside RevisionStudioIQ
 * (or via /admin/hero-render-picker) — they show up here on next refresh.
 *
 *   Slot 1 → most recent is_featured_hero where mode_type = 'colorpro'
 *   Slot 2 → most recent is_featured_hero where mode_type = 'designpanelpro'
 *   Slot 3 → 2nd most recent designpanelpro (so RevisionStudio slot
 *            shows a different design than the anchor)
 *
 * is_featured_hero is publicly readable (Gallery uses the same flag),
 * so this works without auth.
 */

const VIEW_ORDER = [
  "side",
  "driver-side",
  "passenger-side",
  "hood_detail",
  "front",
  "rear",
  "close-up",
  "roof",
  "top",
];

function pickBestImage(renderUrls: any): string | null {
  if (!renderUrls || typeof renderUrls !== "object") return null;
  for (const v of VIEW_ORDER) {
    if (renderUrls[v] && typeof renderUrls[v] === "string") {
      return renderUrls[v];
    }
  }
  for (const k of Object.keys(renderUrls)) {
    if (typeof renderUrls[k] === "string") return renderUrls[k];
  }
  return null;
}

function vehicleLabel(row: any): string | null {
  if (!row) return null;
  const make = (row.vehicle_make || "").trim();
  const model = (row.vehicle_model || "").trim();
  const both = `${make} ${model}`.trim();
  if (row.color_name && row.color_name !== "Untitled") return row.color_name;
  return both || null;
}

export interface LandingHeroSlot {
  src: string | null;
  label: string;
  caption: string;
  vehicle: string | null;
}

export const useLandingHeroRenders = () => {
  return useQuery<LandingHeroSlot[]>({
    queryKey: ["landing-hero-renders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select(
          "id, mode_type, color_name, vehicle_make, vehicle_model, render_urls, created_at"
        )
        .eq("is_featured_hero", true)
        .not("render_urls", "is", null)
        .in("generation_status", ["completed", "complete"])
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) throw error;
      const rows = data || [];

      const colorpro = rows.find((r) => r.mode_type === "colorpro");
      const designpros = rows.filter(
        (r) => r.mode_type === "designpanelpro" || r.mode_type === "designpro"
      );
      const myvehiclepros = rows.filter((r) =>
        typeof r.mode_type === "string" && r.mode_type.startsWith("myvehicle_")
      );
      const designpro = designpros[0];

      // Slot 3 must NEVER duplicate slot 2. Walk the candidates in
      // priority order (MyVehiclePro starred first, then unused
      // DesignPros) and pick the first that isn't the slot-2 row.
      const slot3Candidates = [...myvehiclepros, ...designpros.slice(1)];
      const myvehiclepro = slot3Candidates.find((r) => r.id !== designpro?.id) ?? null;

      return [
        {
          src: pickBestImage(colorpro?.render_urls),
          label: "ColorPro™",
          caption: "Show real film colors before you print",
          vehicle: vehicleLabel(colorpro),
        },
        {
          src: pickBestImage(designpro?.render_urls),
          label: "DesignProAI™",
          caption: "Real custom wrap designs · fast",
          vehicle: vehicleLabel(designpro),
        },
        {
          src: pickBestImage(myvehiclepro?.render_urls),
          label: "MyVehiclePro™",
          caption: "Their car. Their truck. Their fleet.",
          vehicle: vehicleLabel(myvehiclepro),
        },
      ];
    },
    staleTime: 5 * 60 * 1000,
  });
};
