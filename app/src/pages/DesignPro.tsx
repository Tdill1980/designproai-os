import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { ProductHero } from "@/components/ProductHero";
import { DesignProToolUI } from "@/components/productTools/DesignProToolUI";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { ToolContainer } from "@/components/layout/ToolContainer";
export default function DesignPro() {
  const [searchParams] = useSearchParams();
  const renderId = searchParams.get("renderId");
  const openQuickQuote = searchParams.get("quickQuote") === "1";
  const [userEmail, setUserEmail] = useState<string | null>(null);
  
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const { showUpsell, setShowUpsell, limitStatus } = useRenderLimits(userEmail);

  // Fetch carousel images from DesignPanelPro (primary)
  const { data: carouselImages } = useQuery({
    queryKey: ["designpro_carousel"],
    queryFn: async () => {
      const { data } = await supabase
        .from("designpanelpro_carousel")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      return data || [];
    },
  });

  const midPoint = Math.ceil((carouselImages?.length || 0) / 2);
  
  const leftSlides = carouselImages?.slice(0, midPoint).map(item => ({
    id: item.id,
    image: item.media_url,
    title: item.title || '',
    subtitle: item.subtitle || '',
  })) || [];
  
  const rightSlides = carouselImages?.slice(midPoint).map(item => ({
    id: item.id,
    image: item.media_url,
    title: item.title || '',
    subtitle: item.subtitle || '',
  })) || [];

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Helmet>
        <title>AI Wrap Design Generator - Create Vehicle Wraps in 60 Seconds | RestyleProAI</title>
        <meta name="description" content="Generate photorealistic vehicle wrap designs instantly. DesignIQ creates 4K renders across 7 views. From wrap design prompt to print-ready production. Design it. Panel it. Print it." />
        <meta property="og:title" content="AI Wrap Design Generator - Create Vehicle Wraps in 60 Seconds | RestyleProAI" />
        <meta property="og:description" content="Generate photorealistic vehicle wrap designs instantly with AI. DesignIQ creates 4K renders across 7 views with intelligent prompt enhancement." />
      </Helmet>
      <main className="flex-1">
        <ProductHero
          productName="RestyleLibrary™"
          tagline="Professional wrap design library with curated panels and FadeWraps. Create stunning 3D vehicle proofs and production packs."
          leftSlides={leftSlides}
          rightSlides={rightSlides}
        />
        
        <section id="tool" className="bg-background/50 pt-2 pb-6 md:pt-3 md:pb-8 overflow-x-hidden">
          <ToolContainer>
            <DesignProToolUI preloadRenderId={renderId} autoOpenQuickQuote={openQuickQuote} />
          </ToolContainer>
        </section>
        
        <RenderLimitUpsell
          isOpen={showUpsell}
          onClose={() => setShowUpsell(false)}
          currentPlan={limitStatus?.tier || 'none'}
          rendersUsed={limitStatus?.used || 0}
          renderLimit={limitStatus?.limit || 0}
        />


      </main>

    </div>
  );
}
