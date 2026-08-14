import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { ProductHero } from "@/components/ProductHero";
import { ImageCarousel } from "@/components/ImageCarousel";
import { ColorProToolUI } from "@/components/productTools/ColorProToolUI";
import { FAQ } from "@/components/FAQ";
import { Button } from "@/components/ui/button";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { ToolContainer } from "@/components/layout/ToolContainer";
import { useSearchParams } from "react-router-dom";
const ColorPro = () => {
  const [searchParams] = useSearchParams();
  const renderId = searchParams.get("renderId");
  const openQuickQuote = searchParams.get("quickQuote") === "1";
  const [userEmail, setUserEmail] = useState<string | null>(null);
  
  useEffect(() => {
    window.scrollTo(0, 0);
    
    // Get user email
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const { showUpsell, setShowUpsell, limitStatus } = useRenderLimits(userEmail);
  // Fetch carousel images from database (latest first)
  const { data: carouselImages } = useQuery({
    queryKey: ["inkfusion_carousel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inkfusion_carousel")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: false })
        .limit(10);
      
      if (error) throw error;
      return data;
    },
  });

  // Split carousel images into left and right
  const leftSlides = carouselImages
    ?.filter((_, index) => index % 2 === 0)
    .map(img => ({
      id: img.id,
      image: img.media_url,
      title: `${img.vehicle_name || 'Vehicle'} shown in ${img.color_name || ''}`,
      subtitle: "ColorPro™ Visualization"
    })) || [];

  const rightSlides = carouselImages
    ?.filter((_, index) => index % 2 !== 0)
    .map(img => ({
      id: img.id,
      image: img.media_url,
      title: `${img.vehicle_name || 'Vehicle'} shown in ${img.color_name || ''}`,
      subtitle: "ColorPro™ Visualization"
    })) || [];

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>ColorPro - AI Vehicle Color Change Visualizer | RestyleProAI</title>
        <meta name="description" content="See any vehicle in any color instantly with AI. Professional color-change renders for client presentations. Design it. Panel it. Print it. The world's first prompt-to-production wrap platform." />
        <link rel="canonical" href="https://www.restyleproai.com/colorpro" />
        <meta property="og:title" content="ColorPro - AI Vehicle Color Change Visualizer | RestyleProAI" />
        <meta property="og:description" content="See any vehicle in any color instantly with AI. Professional color-change renders for client presentations." />
        <meta property="og:url" content="https://www.restyleproai.com/colorpro" />
        <meta property="og:image" content="https://restyleproai.com/hero-mustang.jpg" />
      </Helmet>
      
      <main className="flex-1">
        {/* ColorPro Design Tool - starts immediately, no hero block */}
        <section className="bg-background/50 pt-2 pb-6 md:pt-3 md:pb-8 overflow-x-hidden">
          <ToolContainer>
            <ColorProToolUI preloadRenderId={renderId} autoOpenQuickQuote={openQuickQuote} />
          </ToolContainer>
        </section>
        
        <RenderLimitUpsell
          isOpen={showUpsell}
          onClose={() => setShowUpsell(false)}
          currentPlan={limitStatus?.tier || 'none'}
          rendersUsed={limitStatus?.used || 0}
          renderLimit={limitStatus?.limit || 0}
        />
        
        {/* Image Carousel */}
        <ImageCarousel productType="inkfusion" />
        
        {/* FAQ */}
        <FAQ productName="ColorPro™" />
        
      </main>

    </div>
  );
};

export default ColorPro;