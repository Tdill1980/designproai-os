/**
 * DesignAssets page — white-UI viewer for a DesignPro generation's saved assets.
 *
 * Route: /design-assets/:generationId  → that design.
 * Route: /design-assets                → the current user's most recent design.
 */

import { useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DesignAssetsPanel } from "@/components/proof/DesignAssetsPanel";
import { LiftedAssetsCards } from "@/components/proof/LiftedAssetsCards";

export default function DesignAssets() {
  const { generationId } = useParams<{ generationId: string }>();
  const [searchParams] = useSearchParams();
  const autoBuild = searchParams.get("build") === "1";
  // Vehicle info passed from Revision Studio's Build Files button so the build
  // never bails when the re-queried row is missing make/model.
  const fallbackVehicle = {
    make: searchParams.get("make") || undefined,
    model: searchParams.get("model") || undefined,
    year: searchParams.get("year") || undefined,
  };

  const { data: latestId, isLoading } = useQuery({
    queryKey: ["latest_designiq_generation"],
    enabled: !generationId,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const uid = user?.id;
      const ts = (r: any) => new Date(r?.created_at || 0).getTime();

      // Candidate A: latest "main" generation that has a hero render OR a master
      // artboard (cars, and trailers once artboard-first has run). Skips the
      // all-views sub-records (they have neither).
      let qa = (supabase as any)
        .from("designiq_generations")
        .select("id, created_at")
        .or("hero_render_url.not.is.null,master_artboard_url.not.is.null")
        .order("created_at", { ascending: false })
        .limit(1);
      if (uid) qa = qa.eq("user_id", uid);
      const { data: a } = await qa;
      const candA = a?.[0] || null;

      // Candidate A2 (legacy / pre-server-save fallback): older generations stored
      // the hero only in panel_url (hero_render_url + master_artboard_url were null
      // because asset persistence used to be browser-side fire-and-forget). Surface
      // the latest such "main" render — but EXCLUDE view-clones and revisions, the
      // per-angle sub-records whose prompt is the "Reproduce … from a different
      // camera angle" clone text, NOT a design the admin should land on. Only runs
      // when Candidate A misses, so post-fix generations (which set hero_render_url)
      // are unaffected.
      let candA2: any = null;
      if (!candA) {
        let qa2 = (supabase as any)
          .from("designiq_generations")
          .select("id, created_at")
          .not("panel_url", "is", null)
          .not("raw_prompt", "ilike", "Reproduce%")
          .not("raw_prompt", "ilike", "%different camera angle%")
          .order("created_at", { ascending: false })
          .limit(1);
        if (uid) qa2 = qa2.eq("user_id", uid);
        const { data: a2 } = await qa2;
        candA2 = a2?.[0] || null;
      }

      // Candidate B: latest of this user's generations that has SAVED ASSETS
      // (clean background / separated layers). The trailer + RecreatePro flow
      // writes design_generation_assets even when hero_render_url is still null,
      // so without this those designs are hidden from /design-assets entirely.
      let candB: any = null;
      if (uid) {
        const { data: gens } = await (supabase as any)
          .from("designiq_generations")
          .select("id, created_at")
          .eq("user_id", uid)
          .order("created_at", { ascending: false })
          .limit(25);
        const ids = (gens || []).map((g: any) => g.id);
        if (ids.length) {
          const { data: assets } = await (supabase as any)
            .from("design_generation_assets")
            .select("generation_id, created_at")
            .in("generation_id", ids)
            .order("created_at", { ascending: false })
            .limit(1);
          if (assets?.[0]) candB = (gens || []).find((g: any) => g.id === assets[0].generation_id) || null;
        }
      }

      // Candidate C: ApprovePro / RecreatePro designs are stored as
      // color_visualizations rows (NOT designiq_generations), with their assets
      // saved in design_generation_assets keyed by the color_visualizations id.
      // Without this they never appear in the standalone /design-assets list.
      let candC: any = null;
      const email = user?.email;
      if (email) {
        const { data: vizes } = await (supabase as any)
          .from("color_visualizations")
          .select("id, created_at")
          .eq("customer_email", email)
          .order("created_at", { ascending: false })
          .limit(25);
        const vids = (vizes || []).map((v: any) => v.id);
        if (vids.length) {
          const { data: vassets } = await (supabase as any)
            .from("design_generation_assets")
            .select("generation_id, created_at")
            .in("generation_id", vids)
            .order("created_at", { ascending: false })
            .limit(1);
          if (vassets?.[0]) candC = (vizes || []).find((v: any) => v.id === vassets[0].generation_id) || null;
        }
      }

      const picks = [candA, candA2, candB, candC].filter(Boolean).sort((x, y) => ts(y) - ts(x));
      return (picks[0]?.id as string | undefined) || undefined;
    },
  });

  const id = generationId || latestId;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {id ? (
          <div className="space-y-5">
            <DesignAssetsPanel generationId={id} autoBuild={autoBuild} fallbackVehicle={fallbackVehicle} />
            <LiftedAssetsCards generationId={id} />
          </div>
        ) : isLoading ? (
          <p className="text-sm text-gray-500">Loading latest design…</p>
        ) : (
          <div className="rounded-2xl bg-white border border-gray-200 shadow-md p-6 text-center">
            <p className="text-sm text-gray-600">No designs found yet — generate one in DesignPro.</p>
          </div>
        )}
      </div>
    </div>
  );
}
