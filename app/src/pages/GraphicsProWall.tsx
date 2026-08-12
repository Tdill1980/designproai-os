import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { FAQ } from "@/components/FAQ";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";
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
        <title>GraphicsPro Wall - Wall Graphics Design-to-Production | RestyleProAI</title>
        <meta name="description" content="Design cut vinyl wall graphics for indoor and outdoor walls. AI-powered mockups with production-ready cut files and automatic pricing." />
        <link rel="canonical" href="https://www.restyleproai.com/graphics-pro-wall" />
      </Helmet>

      <main className="flex-1">
        {/* Hero Banner */}
        <section className="relative w-full overflow-hidden bg-gradient-to-r from-slate-900 via-purple-900/60 to-slate-900">
          <div className="container mx-auto px-4 py-8 sm:py-12">
            <h1 className="text-2xl md:text-4xl font-bold mb-1 drop-shadow-lg">
              <span className="text-white">Graphics</span>
              <span className="bg-gradient-to-r from-blue-400 via-purple-500 to-fuchsia-500 bg-clip-text text-transparent">Pro</span>
              <span className="text-white ml-2">Wall</span>
            </h1>
            <p className="text-xs md:text-sm text-white/70 max-w-lg drop-shadow-md">
              Wall graphics design-to-production. Indoor or outdoor. Photorealistic mockups on any wall texture. Production-ready cut files with pricing.
            </p>
          </div>
        </section>

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
