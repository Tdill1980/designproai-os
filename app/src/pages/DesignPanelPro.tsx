import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { ProductHero } from "@/components/ProductHero";
import { DesignPanelProToolUI } from "@/components/designpanelpro/DesignPanelProToolUI";
import { Button } from "@/components/ui/button";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";

export default function DesignPanelPro() {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const { showUpsell, setShowUpsell, limitStatus } = useRenderLimits(userEmail);

  const { data: carouselImages } = useQuery({
    queryKey: ["designpanelpro_carousel"],
    queryFn: async () => {
      const { data } = await supabase
        .from("designpanelpro_carousel")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      return data || [];
    },
  });

  const { data: videos } = useQuery({
    queryKey: ["designpanelpro_videos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("designpanelpro_videos")
        .select("*")
        .eq("is_active", true)
        .order("sort_order");
      return data || [];
    },
  });

  // Distribute images evenly between left and right
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
        <title>DesignPanelPro™ - Custom Panel Design Visualizer | RestylePro Suite™</title>
        <meta name="description" content="Transform custom vinyl panels into photorealistic 3D vehicle renders with DesignPanelPro™. Upload designs or browse our curated library. Design it. Panel it. Print it." />
        <meta property="og:title" content="DesignPanelPro™ - Custom Panel Design Visualizer" />
        <meta property="og:description" content="Upload custom panel designs or choose from curated library. Photorealistic 3D vehicle proofs." />
      </Helmet>
      <main className="flex-1">
      <ProductHero 
        productName="DesignPanelPro™"
          tagline="Transform premium vinyl panels and FadeWraps into stunning, photorealistic 3D vehicle proofs. Upload custom designs or choose from our curated library."
          leftSlides={leftSlides}
          rightSlides={rightSlides}
        />
        
        <section id="tool" className="bg-background/50 pt-2 pb-6 md:pt-3 md:pb-8 overflow-x-hidden">
          <DesignPanelProToolUI />
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
