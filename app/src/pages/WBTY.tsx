import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ProductHero } from "@/components/ProductHero";
import { ImageCarousel } from "@/components/ImageCarousel";
import { WBTYToolUI } from "@/components/productTools/WBTYToolUI";
import { FAQ } from "@/components/FAQ";
import { Button } from "@/components/ui/button";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { ToolContainer } from "@/components/layout/ToolContainer";
import { PATTERNPRO_EXAMPLE_RENDERS } from "@/data/patternpro-patterns";
const WBTY = () => {
  const [searchParams] = useSearchParams();
  const renderId = searchParams.get("renderId");
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const { showUpsell, setShowUpsell, limitStatus } = useRenderLimits(userEmail);

  const { data: carouselImages } = useQuery({
    queryKey: ["wbty_carousel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wbty_carousel")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: false })
        .limit(10);
      
      if (error) {
        console.error("[wbty_carousel] query error:", error.message, error.code);
        throw error;
      }
      return data;
    },
  });

  // Split carousel images into left and right — fall back to static examples if DB is empty
  const slides = (carouselImages && carouselImages.length > 0)
    ? carouselImages.map(img => ({
        id: img.id,
        image: img.media_url,
        title: img.pattern_name || 'WBTY Pattern',
        subtitle: "PatternPro™ Design"
      }))
    : PATTERNPRO_EXAMPLE_RENDERS;

  const leftSlides = slides.filter((_, index) => index % 2 === 0);
  const rightSlides = slides.filter((_, index) => index % 2 !== 0);

  return (
    <div className="min-h-screen flex flex-col bg-zinc-900">
      <Helmet>
        <title>PatternPro - Wrap By The Yard Pattern Designer | RestyleProAI</title>
        <meta name="description" content="Design premium wrap patterns by the yard with PatternPro. Metal & Marble, Camo & Carbon, and more with 3D renders. Design it. Panel it. Print it. The world's first prompt-to-production wrap platform." />
        <meta property="og:title" content="PatternPro - Wrap By The Yard Pattern Designer | RestyleProAI" />
        <meta property="og:description" content="Premium patterns by the yard. 3D renders with accurate yardage calculations." />
      </Helmet>
      
      <main className="flex-1">
        {/* Hero Section — matches GraphicsPro clean centered style */}
        <section className="bg-gradient-to-b from-purple-500/10 via-pink-500/5 to-background pt-8 pb-4">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-3xl md:text-5xl font-bold mb-4">
              <span className="text-foreground">Pattern</span>
              <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-purple-500 bg-clip-text text-transparent">Pro™</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Premium wrap patterns by the yard. 118 real WePrintWraps designs with photorealistic 3D proofs on your vehicle.
            </p>
          </div>
        </section>

        {/* WBTY Design Tool */}
        <section className="bg-zinc-900 pt-2 pb-6 md:pt-3 md:pb-8 overflow-x-hidden">
          <ToolContainer>
            <WBTYToolUI preloadRenderId={renderId} />
          </ToolContainer>
        </section>
        
        <RenderLimitUpsell
          isOpen={showUpsell}
          onClose={() => setShowUpsell(false)}
          currentPlan={limitStatus?.tier || 'none'}
          rendersUsed={limitStatus?.used || 0}
          renderLimit={limitStatus?.limit || 0}
        />

        {/* Example Design Generations Carousel */}
        <section className="bg-card/30 py-8 md:py-12">
          <div className="container mx-auto px-4">
            <div className="text-center mb-6">
              <h2 className="text-2xl md:text-3xl font-bold">
                <span className="text-white">Example </span>
                <span className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 bg-clip-text text-transparent">Designs</span>
              </h2>
              <p className="text-sm text-muted-foreground mt-2">
                Browse pattern designs available in PatternPro
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 md:gap-4 max-w-5xl mx-auto">
              {PATTERNPRO_EXAMPLE_RENDERS.map((render) => (
                <div
                  key={render.id}
                  className="group relative rounded-xl overflow-hidden border border-zinc-400 hover:border-primary transition-all hover:scale-[1.02] bg-zinc-600"
                >
                  <div className="aspect-square">
                    <img
                      src={render.image}
                      alt={render.title}
                      className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                      loading="lazy"
                    />
                  </div>
                  <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3">
                    <p className="text-sm font-semibold text-white leading-tight">{render.title}</p>
                    <p className="text-xs text-white/70">{render.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Image Carousel (DB-sourced) */}
        <ImageCarousel productType="wbty" />

        {/* FAQ */}
        <FAQ productName="PatternPro" />
        
      </main>

    </div>
  );
};

export default WBTY;