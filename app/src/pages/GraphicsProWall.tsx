import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { FAQ } from "@/components/FAQ";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { OS_TOOLS } from "@/lib/os-brand";
import { ToolHeader } from "@/components/layout/ToolHeader";
import { ToolContainer } from "@/components/layout/ToolContainer";
import { GraphicsProV1ToolUI } from "@/components/graphicspro-v1/GraphicsProV1ToolUI";

const GraphicsProWall = () => {
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const { showUpsell, setShowUpsell, limitStatus } = useRenderLimits(userEmail);

  return (
    <div className="min-h-screen flex flex-col bg-background overflow-x-hidden">
      <Helmet>
        <title>CutPro Wall — Prompt-Based Cut Graphics Design + Production-Ready File Output | DesignProAI</title>
        <meta name="description" content="Design cut vinyl wall graphics for indoor and outdoor walls. AI-powered mockups with production-ready cut files and automatic pricing." />
        <link rel="canonical" href="https://designproai.com/graphics-pro-wall" />
      </Helmet>

      {/* THE ONE STICKY BAR CUTPRO OWNS (Trish 2026-09-16) — same shared
          header as CutPro's other two surfaces, WallPro and VehiclePro. */}
      <ToolHeader
        id="cutpro-wall-header"
        theme={{
          logo: null,
          logoAlt: "",
          eyebrow: "",
          wordmarkLead: OS_TOOLS.cutpro.wordmark.base,
          wordmarkAccent: `${OS_TOOLS.cutpro.wordmark.suffix} Wall`,
          tagline: OS_TOOLS.cutpro.tagline,
        }}
      />
      <main className="flex-1">
        {/* The Wall/Window-specific description, under the shared ToolHeader. */}
        <div className="border-b border-slate-200 bg-white px-4 py-3 text-center text-xs text-slate-600 sm:text-sm">
          Prompt-Based Cut Graphics Design + Production-Ready File Output for indoor and outdoor walls. Photorealistic mockups on any wall texture, production-ready cut files with pricing.
        </div>

        {/* Tool — pre-selects Wall surface type */}
        <section className="bg-background/50 pt-2 pb-6 md:pt-3 md:pb-8 overflow-x-hidden">
          <ToolContainer>
            <GraphicsProV1ToolUI initialSurfaceType="wall" />
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

export default GraphicsProWall;
