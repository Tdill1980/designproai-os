import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { ProductHero } from "@/components/ProductHero";
import { ImageCarousel } from "@/components/ImageCarousel";
import { FAQ } from "@/components/FAQ";
import { ApproveModeComponent } from "@/components/tools/modes/ApproveModeComponent";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { ToolContainer } from "@/components/layout/ToolContainer";
const ApproveMode = () => {
  const [userEmail, setUserEmail] = useState<string | null>(null);
  
  useEffect(() => {
    window.scrollTo(0, 0);
    
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const { showUpsell, setShowUpsell, limitStatus } = useRenderLimits(userEmail);
  // Fetch carousel images from database
  const { data: carouselImages } = useQuery({
    queryKey: ["approvemode_carousel"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("approvemode_carousel")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: false })
        .limit(10);
      
      if (error) {
        console.error("[approvemode_carousel] query error:", error.message, error.code);
        throw error;
      }
      return data;
    },
  });

  // Left carousel shows 2D design proofs (before_url), right shows 3D renders (media_url)
  const leftSlides = carouselImages?.filter(img => img.before_url).map(img => ({
    id: img.id,
    image: img.before_url!,
    title: img.vehicle_name || 'ApprovePro',
    subtitle: "BEFORE - 2D Proof"
  })) || [];

  const rightSlides = carouselImages?.map(img => ({
    id: img.id,
    image: img.media_url,
    title: img.vehicle_name || 'ApprovePro',
    subtitle: "AFTER - 3D Render"
  })) || [];

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>ApprovePro - Client Wrap Approval Workflow | RestyleProAI</title>
        <meta name="description" content="Streamline client approvals for vehicle wrap designs. Share renders, collect feedback, get sign-off. Design it. Panel it. Print it. The world's first prompt-to-production wrap platform." />
        <link rel="canonical" href="https://www.restyleproai.com/approvemode" />
        <meta property="og:title" content="ApprovePro - Client Wrap Approval Workflow | RestyleProAI" />
        <meta property="og:description" content="Streamline client approvals for vehicle wrap designs. Share renders, collect feedback, get sign-off - all in one place." />
        <meta property="og:url" content="https://www.restyleproai.com/approvemode" />
        <meta property="og:image" content="https://restyleproai.com/hero-mustang.jpg" />
      </Helmet>
      
      <main className="flex-1">
        {/* Product Hero */}
        <ProductHero
          productName="ApprovePro™"
          tagline="Upload your 2D design proof → See it rendered on any vehicle in seconds. Same vehicle, new vehicle, any vehicle. Instant client approval."
          leftSlides={leftSlides}
          rightSlides={rightSlides}
        />
        
        {/* Fleet Expansion USP Callout */}
        <section className="container mx-auto px-4 -mt-4 mb-8">
          <div className="max-w-4xl mx-auto">
            <div className="bg-gradient-to-r from-blue-500/10 to-blue-500/10 border border-blue-500/30 rounded-xl p-6">
              <h3 className="text-lg font-bold text-foreground mb-3">
                Perfect for Client Approvals
              </h3>
              <p className="text-muted-foreground mb-4">
                Need to show a client how their design will look? Upload your 2D proof and visualize it 
                on the same vehicle or a completely different one - <span className="text-blue-400 font-semibold">instant photorealistic renders</span>.
              </p>
              
              {/* How It Works Steps */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                <div className="text-center p-4 bg-background/50 rounded-lg border border-border/50">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <span className="text-blue-400 font-bold">1</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">Upload</p>
                  <p className="text-xs text-muted-foreground">Your 2D Design Proof</p>
                </div>
                <div className="text-center p-4 bg-background/50 rounded-lg border border-border/50">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <span className="text-blue-400 font-bold">2</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">Enter</p>
                  <p className="text-xs text-muted-foreground">Any Vehicle Details</p>
                </div>
                <div className="text-center p-4 bg-background/50 rounded-lg border border-border/50">
                  <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-blue-500/20 flex items-center justify-center">
                    <span className="text-blue-400 font-bold">3</span>
                  </div>
                  <p className="text-sm font-semibold text-foreground">Visualize</p>
                  <p className="text-xs text-muted-foreground">Photorealistic 3D Render</p>
                </div>
              </div>
            </div>
          </div>
        </section>
        
        {/* ApproveMode Tool - immediately after hero */}
        <section className="bg-background/50 py-8 overflow-x-hidden">
          <ToolContainer>
            <Card className="bg-secondary border-border/30 rounded-xl p-4 md:p-6">
              <ApproveModeComponent />
            </Card>
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
        <ImageCarousel productType="approvemode" />
        
        {/* FAQ */}
        <FAQ productName="ApprovePro" />
        
      </main>

    </div>
  );
};

export default ApproveMode;