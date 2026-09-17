import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { OS_TOOLS } from "@/lib/os-brand";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { FAQ } from "@/components/FAQ";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { useQuery } from "@tanstack/react-query";
import { ToolContainer } from "@/components/layout/ToolContainer";
import { GraphicsProV1ToolUI } from "@/components/graphicspro-v1/GraphicsProV1ToolUI";
import { WallProHeroProof } from "@/components/wallpro/WallProHeroProof";
import { useToolProofBand } from "@/hooks/useToolProofBand";

const GraphicsProV1 = () => {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const cutProProofs = useToolProofBand('cutpro');

  useEffect(() => {
    window.scrollTo(0, 0);
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const { data: heroImage } = useQuery({
    queryKey: ["graphicspro_hero"],
    queryFn: async () => {
      const { data } = await supabase
        .from("homepage_showcase")
        .select("image_url")
        .eq("name", "section:graphicspro-hero")
        .eq("is_active", true)
        .maybeSingle();
      return data?.image_url || null;
    },
  });

  const heroSrc = heroImage || "/hero-mustang.jpg";

  const { showUpsell, setShowUpsell, limitStatus } = useRenderLimits(userEmail);

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900 overflow-x-hidden">
      <Helmet>
        <title>CutPro — Prompt-Based Cut Graphics Design + Production-Ready File Output | DesignProAI</title>
        <meta name="description" content="CutPro, the cut graphics design environment inside DesignProAI: create professional cut graphics from a prompt and move directly toward production-ready artwork for vehicles, walls and windows." />
        <link rel="canonical" href="https://designproai.com/graphics-pro" />
      </Helmet>

      {/* THE ONE STICKY BAR CUTPRO OWNS — same pattern as WallPro and
          VehiclePro (Trish 2026-09-16). Replaces the old full-width gradient
          bar, which was CutPro's own third, unrelated header treatment and
          the concrete cause of "each page looks diff". The "with ZoneMasker™"
          sub-brand and the vehicles/walls/windows line move into the actions
          slot and the description below, so nothing said here is lost. */}
      <ToolHeader
        id="cutpro-header"
        theme={{
          logo: null,
          logoAlt: "",
          eyebrow: "",
          wordmarkLead: OS_TOOLS.cutpro.wordmark.base,
          wordmarkAccent: OS_TOOLS.cutpro.wordmark.suffix,
          tagline: OS_TOOLS.cutpro.tagline,
        }}
      />
      {/* THE SAME ABOVE-THE-SCROLL HERO WALLPRO AND VEHICLEPRO SHIP (Trish
          2026-09-17: "what about the wallpro redesign I gave you"). CutPro's
          page is still light (`bg-gray-50`), unlike WallPro/VehiclePro's dark
          UI -- that is a separate, larger theme decision this hero does not
          make for it, so it is themed for the light background it actually
          has rather than guessing at a dark rewrite. CutPro has no
          case-study or FAQ route to link the way WallPro links
          `/wall-wrap/how-it-works` -- its FAQ is the inline `<FAQ>` further
          down this same page, not a separate destination, so nothing is
          invented here. */}
      <section className="mx-auto mt-5 grid max-w-6xl items-center gap-5 px-4 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div>
          <h2 className="text-3xl font-extrabold leading-[1.05] tracking-tight text-gray-900 md:text-4xl">
            On-demand cut graphics<br />design &amp; file output
          </h2>
          <p className="mt-3 max-w-[42ch] text-sm text-gray-600">
            Describe the cut graphic, generate the design in minutes, and take
            the production-ready cut-contour files — a real print-and-cut PDF
            and layered vector film, ready for vehicles, walls and windows.
          </p>
        </div>
        {/* THE SAME CURATOR-MANAGED PROOF BAND WALLPRO USES (Trish
            2026-09-16: "do the admin page" -- for CutPro too). CutPro has no
            bundled fallback list -- this renders nothing until a curator
            publishes a first pair at /admin/wallpro-proofs. */}
        {cutProProofs.length > 0 && <WallProHeroProof proofs={cutProProofs} />}
      </section>
      <main className="flex-1">
        <div className="border-b border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-600 sm:text-sm">
          with <span className="font-semibold text-[#ec4899]">ZoneMasker™</span> — {OS_TOOLS.cutpro.description} Vehicles, walls and windows; upload your image or design from a prompt.
        </div>

        {/* Tool */}
        <section className="pt-3 pb-6 md:pt-4 md:pb-8 overflow-x-hidden">
          <ToolContainer>
            <GraphicsProV1ToolUI />
          </ToolContainer>
        </section>

        <RenderLimitUpsell
          isOpen={showUpsell}
          onClose={() => setShowUpsell(false)}
          currentPlan={limitStatus?.tier || 'none'}
          rendersUsed={limitStatus?.used || 0}
          renderLimit={limitStatus?.limit || 0}
        />

        <FAQ productName="GraphicsPro" />
      </main>
    </div>
  );
};

export default GraphicsProV1;
