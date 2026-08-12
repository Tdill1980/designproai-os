import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Scissors } from "lucide-react";
import { FAQ } from "@/components/FAQ";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { useQuery } from "@tanstack/react-query";
import { ToolContainer } from "@/components/layout/ToolContainer";
import { GraphicsProV1ToolUI } from "@/components/graphicspro-v1/GraphicsProV1ToolUI";

const GraphicsProV1 = () => {
  const [userEmail, setUserEmail] = useState<string | null>(null);

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
        <title>GraphicsPro - Cut Vinyl Graphics Design-to-Production | RestyleProAI</title>
        <meta name="description" content="Design cut vinyl graphics for any surface. AI-powered mockups on vehicles, walls, windows, floors. Get production-ready cut files with automatic pricing." />
        <link rel="canonical" href="https://www.restyleproai.com/graphics-pro" />
      </Helmet>

      <main className="flex-1">
        {/* Header — persistent (sticky) bright blue→magenta brand gradient bar
            with a big square logo + wordmark + clear subtitle. Sticks to the
            top of the content area while the tool scrolls beneath it. */}
        <div className="sticky top-0 z-40 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] shadow-md">
          <div className="container mx-auto px-4 py-5 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center shrink-0 shadow-sm">
                <Scissors className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold leading-tight flex items-baseline gap-2 flex-wrap">
                  <span className="flex items-baseline">
                    <span className="text-white">GraphicsPro</span>
                    <sup className="text-white/80 text-sm ml-0.5">™</sup>
                  </span>
                  <span className="text-white/80 font-normal text-sm sm:text-base">with</span>
                  <span className="inline-flex items-baseline px-2 py-0.5 rounded-md bg-white text-sm sm:text-base font-semibold">
                    <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">ZoneMasker</span>
                    <sup className="text-[#ec4899] text-[9px] sm:text-[10px] ml-0.5 font-semibold">™</sup>
                  </span>
                </h1>
                <p className="text-sm sm:text-base text-white mt-2 font-medium">
                  Cut contour vinyl graphics for vehicles, walls, and windows
                </p>
                <p className="text-xs sm:text-sm text-white/85 mt-0.5">
                  Upload your image or design via text prompt
                </p>
              </div>
            </div>
          </div>
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
