import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { GraphicsProToolUI } from "@/components/productTools/GraphicsProToolUI";
import { FAQ } from "@/components/FAQ";
import { Button } from "@/components/ui/button";
import { RenderLimitUpsell } from "@/components/RenderLimitUpsell";
import { supabase } from "@/integrations/supabase/client";
import { useRenderLimits } from "@/hooks/useRenderLimits";
import { ToolContainer } from "@/components/layout/ToolContainer";
const GraphicsPro = () => {
  const [searchParams] = useSearchParams();
  const renderId = searchParams.get("renderId");
  const openQuickQuote = searchParams.get("quickQuote") === "1";
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo(0, 0);
    
    supabase.auth.getUser().then(({ data }) => {
      setUserEmail(data.user?.email || null);
    });
  }, []);

  const { showUpsell, setShowUpsell, limitStatus } = useRenderLimits(userEmail);

  return (
    <div className="min-h-screen flex flex-col">
      <Helmet>
        <title>GraphicsPro - AI Multi-Zone Wrap Designer | RestyleProAI</title>
        <meta name="description" content="Design custom multi-zone vehicle wraps with GraphicsPro. Two-tone designs, racing stripes, chrome deletes, and more. Design it. Panel it. Print it. The world's first prompt-to-production wrap platform." />
        <link rel="canonical" href="https://www.restyleproai.com/graphicspro" />
        <meta property="og:title" content="GraphicsPro - AI Multi-Zone Wrap Designer | RestyleProAI" />
        <meta property="og:description" content="Design complex multi-zone wraps: two-tone, racing stripes, chrome deletes, accent packages. AI-powered visualization." />
        <meta property="og:url" content="https://www.restyleproai.com/graphicspro" />
        <meta property="og:image" content="https://restyleproai.com/hero-mustang.jpg" />
      </Helmet>
      
      <main className="flex-1">
        {/* Hero Section */}
        <section className="bg-gradient-to-b from-blue-500/10 via-purple-500/5 to-background pt-8 pb-4">
          <div className="container mx-auto px-4 text-center">
            <h1 className="text-3xl md:text-5xl font-bold mb-4">
              <span className="text-foreground">Graphics</span>
              <span className="bg-gradient-to-r from-blue-400 via-blue-500 to-purple-500 bg-clip-text text-transparent">Pro™</span>
            </h1>
            <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
              Design complex multi-zone wraps with natural language. Two-tone, racing stripes, chrome deletes, accent packages-describe it, see it.
            </p>
          </div>
        </section>
        
        {/* GraphicsPro Design Tool */}
        <section className="bg-background/50 pt-2 pb-6 md:pt-3 md:pb-8 overflow-x-hidden">
          <ToolContainer>
            <GraphicsProToolUI preloadRenderId={renderId} autoOpenQuickQuote={openQuickQuote} />
          </ToolContainer>
        </section>
        
        <RenderLimitUpsell
          isOpen={showUpsell}
          onClose={() => setShowUpsell(false)}
          currentPlan={limitStatus?.tier || 'none'}
          rendersUsed={limitStatus?.used || 0}
          renderLimit={limitStatus?.limit || 0}
        />
        
        {/* FAQ */}
        <FAQ productName="GraphicsPro™" />
        
      </main>

    </div>
  );
};

export default GraphicsPro;
