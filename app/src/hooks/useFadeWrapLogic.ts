import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { saveArtboardUrlToViz } from "@/lib/save-artboard-url";
import { renderClient } from "@/integrations/supabase/renderClient";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import { saveProofUrlToViz } from "@/lib/save-proof-url";
import { FadeStyleId } from "@/lib/fadeStyles";
import { withTimeout, VIEW_RENDER_TIMEOUT_MS } from "@/lib/invokeWithTimeout";
import { type VehicleType } from "@/components/tools/VehicleTypeSelector";

type KitSize = "small" | "medium" | "large" | "xl";
type RoofSize = "none" | "small" | "medium" | "large";
export type FadeStyle = FadeStyleId;

// Single deterministic entry point for every FadeWraps render.
// The wrapper edge fn forces fadeStyle='front_back' + a fixed FadeSpec and
// routes to the correct physical renderer (cars → generate-color-render,
// bikes → render-motorcycle, etc.) so every render uses identical inputs.
const FADEWRAPS_RENDER_FN = "fadewraps-render";
const LOCKED_FADE_STYLE: FadeStyle = "front_back";

// Strict hex validator - no silent fallbacks
function isValidHex(hex?: string): boolean {
  return typeof hex === 'string' && /^#[0-9A-Fa-f]{6}$/.test(hex);
}

// Helper to get user email with robust retry
const getUserEmail = async (): Promise<string | null> => {
  let { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.email) return session.user.email;
  
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.email) return user.email;
  
  const refreshResult = await supabase.auth.refreshSession();
  if (refreshResult.data?.session?.user?.email) return refreshResult.data.session.user.email;
  
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    const result = await supabase.auth.getSession();
    if (result.data?.session?.user?.email) return result.data.session.user.email;
  }
  
  console.warn('getUserEmail: All attempts failed');
  return null;
};

export const useFadeWrapLogic = () => {
  const { toast } = useToast();
  const { checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const [selectedPattern, setSelectedPattern] = useState<any>(null);
  const [selectedFinish, setSelectedFinish] = useState<'Gloss' | 'Satin' | 'Matte' | 'Sparkle'>('Gloss');
  const fadeStyle: FadeStyle = LOCKED_FADE_STYLE;
  const [kitSize, setKitSize] = useState<KitSize>("medium");
  const [addHood, setAddHood] = useState(false);
  const [addFrontBumper, setAddFrontBumper] = useState(false);
  const [addRearBumper, setAddRearBumper] = useState(false);
  const [roofSize, setRoofSize] = useState<RoofSize>("none");
  const [showFallback, setShowFallback] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [additionalViews, setAdditionalViews] = useState<any[]>([]);
  const [isGeneratingAdditional, setIsGeneratingAdditional] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');

  const clearLastRender = () => {
    setGeneratedImageUrl(null);
    setAdditionalViews([]);
  };

  const kitPrices = { small: 600, medium: 710, large: 825, xl: 990 };
  const addonPrices = { hood: 160, frontBumper: 200, rearBumper: 395 };
  const roofPrices = { none: 0, small: 160, medium: 225, large: 330 };

  const calculateTotal = () => {
    let total = kitPrices[kitSize];
    if (addHood) total += addonPrices.hood;
    if (addFrontBumper) total += addonPrices.frontBumper;
    if (addRearBumper) total += addonPrices.rearBumper;
    if (roofSize !== "none") total += roofPrices[roofSize];
    return total;
  };

  const generateRender = async (year: string, make: string, model: string, revisionPrompt?: string) => {
    if (!selectedPattern) return;
    
    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return;
    }
    
    // 🔧 V1 FIX: Clear cached renders BEFORE generating to prevent stale images
    clearLastRender();
    
    setIsGenerating(true);
    try {
      const userEmail = await getUserEmail();
      if (!userEmail) {
        setShowLoginModal(true);
        return;
      }
      
      // Resolve hex from InkFusion or pattern - NO FALLBACK
      const resolvedHex = selectedPattern.inkFusionColor?.hex || selectedPattern.hex;
      
      if (!isValidHex(resolvedHex)) {
        console.error('❌ INVALID COLOR HEX (FadeWraps)', { name: selectedPattern.name, resolvedHex });
        throw new Error(`Invalid color hex for ${selectedPattern.name}. Rendering blocked.`);
      }
      
      // Wrapper edge fn forces fadeStyle/fadeSpec server-side — no client guessing.
      console.log('🎯 FadeWraps Render Config:', { colorHex: resolvedHex, vehicleType });

      const { data, error } = await renderClient.functions.invoke(FADEWRAPS_RENDER_FN, {
        body: {
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          vehicleType,
          modeType: 'fadewraps',
          viewType: 'side',
          revisionPrompt,
          userEmail,
          tool: 'fadewraps',
          colorData: {
            colorName: selectedPattern.name,
            colorHex: resolvedHex,
            renderHex: selectedPattern.inkFusionColor?.renderHex || null,
            inkDensity: selectedPattern.inkFusionColor?.inkDensity || 1.0,
            fadeToHex: '#000000',
            finish: selectedPattern.inkFusionColor?.lamination?.toLowerCase() || selectedFinish.toLowerCase(),
            isInkFusion: selectedPattern.isInkFusion || false,
            addHood,
            addFrontBumper,
            addRearBumper,
            kitSize,
            roofSize,
            manufacturer: selectedPattern.isInkFusion ? 'InkFusion' : 'FadeWraps',
            colorLibrary: 'fadewraps'
          }
        }
      });

      if (error) throw error;
      
      if (data?.renderUrl) {
        const cacheBustedUrl = `${data.renderUrl}${data.renderUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
        
        // 🔍 AUTO-VALIDATE GRADIENT QUALITY
        let finalUrl = cacheBustedUrl;
        let wasRegenerated = false;
        let regenRenderId: string | null = null;
        
        try {
          console.log('🔍 Validating FadeWraps gradient quality...');
          const { data: validationResult, error: validationError } = await renderClient.functions.invoke('validate-fade-quality', {
            body: { renderUrl: data.renderUrl, renderId: data.renderId }
          });
          
          if (!validationError && validationResult) {
            console.log('📊 Gradient validation result:', validationResult);
            
            // Auto-regenerate if score <=3 or hard line detected (increased threshold, up to 2 attempts)
            const isAutoRegen = revisionPrompt?.includes('[AUTO-REGEN]');
            const regenCount = isAutoRegen ? parseInt(revisionPrompt.match(/\[AUTO-REGEN-(\d+)\]/)?.[1] || '1') : 0;
            
            if ((validationResult.score <= 3 || validationResult.hasHardLine) && regenCount < 2) {
              console.log(`⚠️ Poor gradient quality detected (score: ${validationResult.score}), auto-regenerating (attempt ${regenCount + 1}/2)...`);
              toast({ title: "Optimizing gradient...", description: "Auto-improving fade smoothness" });
              
              // Call regenerate with a hint to improve gradient
              const { data: regenData, error: regenError } = await renderClient.functions.invoke(FADEWRAPS_RENDER_FN, {
                body: {
                  vehicleYear: year,
                  vehicleMake: make,
                  vehicleModel: model,
                  vehicleType,
                  modeType: 'fadewraps',
                  viewType: 'side',
                  revisionPrompt: `[AUTO-REGEN-${regenCount + 1}] CRITICAL: Previous render had ${validationResult.hasHardLine ? 'HARD LINE' : `poor gradient (score: ${validationResult.score}/5)`}. Ensure PERFECTLY SMOOTH FLOWING gradient transition with NO visible seam or hard edge. The fade must be IMPERCEPTIBLE like airbrush spray paint - colors MIST into each other. EXTEND the transition zone to at least 50% of vehicle length.`,
                  userEmail,
                  tool: 'fadewraps',
                  skipCache: true, // Force fresh generation
                  colorData: {
                    colorName: selectedPattern.name,
                    colorHex: resolvedHex,
                    renderHex: selectedPattern.inkFusionColor?.renderHex || null,
                    inkDensity: selectedPattern.inkFusionColor?.inkDensity || 1.0,
                    fadeToHex: '#000000',
                    finish: selectedPattern.inkFusionColor?.lamination?.toLowerCase() || selectedFinish.toLowerCase(),
                    isInkFusion: selectedPattern.isInkFusion || false,
                    addHood,
                    addFrontBumper,
                    addRearBumper,
                    kitSize,
                    roofSize,
                    manufacturer: selectedPattern.isInkFusion ? 'InkFusion' : 'FadeWraps',
                    colorLibrary: 'fadewraps'
                  }
                }
              });
              
              if (!regenError && regenData?.renderUrl) {
                finalUrl = `${regenData.renderUrl}${regenData.renderUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
                regenRenderId = regenData.renderId || null;
                wasRegenerated = true;
                console.log('✅ Auto-regeneration complete');
              }
            }
          }
        } catch (validationErr) {
          console.warn('Gradient validation skipped:', validationErr);
        }
        
        setGeneratedImageUrl(finalUrl);
        setVisualizationId(wasRegenerated ? (regenRenderId || data.renderId) : data.renderId);
        await incrementRenderCount();
        toast({ 
          title: wasRegenerated ? "Gradient Optimized" : "3D Proof Generated", 
          description: wasRegenerated ? "Auto-improved fade smoothness" : "Your FadeWraps preview is ready!" 
        });
      }
    } catch (error: any) {
      console.error('Generation error:', error);
      if (error.message?.includes('userEmail') || error.message?.includes('anonymous')) {
        setShowLoginModal(true);
        return;
      }
      toast({ title: "Generation failed", description: error.message || "Please try again", variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const generateAdditionalViews = async (year: string, make: string, model: string) => {
    if (!selectedPattern) return;

    setIsGeneratingAdditional(true);
    try {
      const userEmail = await getUserEmail();
      if (!userEmail) {
        setShowLoginModal(true);
        return;
      }

      const resolvedHex = selectedPattern.inkFusionColor?.hex || selectedPattern.hex;
      if (!isValidHex(resolvedHex)) {
        throw new Error(`Invalid color hex for ${selectedPattern.name}. Rendering blocked.`);
      }

      // Render a single view — extracted for parallel use
      const renderView = async (viewType: string): Promise<{ type: string; url: string | null }> => {
        try {
          const { data, error } = await withTimeout(
            renderClient.functions.invoke(FADEWRAPS_RENDER_FN, {
              body: {
                vehicleYear: year,
                vehicleMake: make,
                vehicleModel: model,
                vehicleType,
                modeType: 'fadewraps',
                viewType,
                userEmail,
                tool: 'fadewraps',
                colorData: {
                  colorName: selectedPattern.name,
                  colorHex: resolvedHex,
                  renderHex: selectedPattern.inkFusionColor?.renderHex || null,
                  inkDensity: selectedPattern.inkFusionColor?.inkDensity || 1.0,
                  fadeToHex: '#000000',
                  finish: selectedPattern.inkFusionColor?.lamination?.toLowerCase() || selectedFinish.toLowerCase(),
                  isInkFusion: selectedPattern.isInkFusion || false,
                  addHood,
                  addFrontBumper,
                  addRearBumper,
                  kitSize,
                  roofSize,
                  manufacturer: selectedPattern.isInkFusion ? 'InkFusion' : 'FadeWraps',
                  colorLibrary: 'fadewraps'
                }
              }
            }),
            VIEW_RENDER_TIMEOUT_MS,
            `FadeWraps ${viewType} view`
          );

          if (error) throw error;
          if (data?.renderUrl) {
            const cacheBustedUrl = `${data.renderUrl}${data.renderUrl.includes('?') ? '&' : '?'}cb=${Date.now()}`;
            return { type: viewType, url: cacheBustedUrl };
          }
          return { type: viewType, url: null };
        } catch (viewError) {
          console.error(`Failed to generate FadeWraps ${viewType} view:`, viewError);
          return { type: viewType, url: null };
        }
      };

      // PARALLEL BATCH execution (2 at a time with 2s stagger)
      // Matches DesignPro pattern — halves total wait vs sequential
      const viewBatches: string[][] = [
        ['passenger-side', 'rear'],   // Batch 1 — passenger is mirror-flip candidate
        ['hood_detail', 'front'],     // Batch 2
        ['close-up', 'roof'],         // Batch 3
      ];

      const generatedViews: { type: string; url: string }[] = [];

      for (let batchIdx = 0; batchIdx < viewBatches.length; batchIdx++) {
        const batch = viewBatches[batchIdx];
        if (batchIdx > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        console.log(`[FadeWraps] Batch ${batchIdx + 1}/${viewBatches.length}: [${batch.join(', ')}]`);

        const batchResults = await Promise.allSettled(
          batch.map(viewType => renderView(viewType))
        );

        for (const settled of batchResults) {
          if (settled.status === 'fulfilled' && settled.value.url) {
            generatedViews.push({ type: settled.value.type, url: settled.value.url });
          }
        }

        // Update views progressively after each batch
        setAdditionalViews([...generatedViews]);
      }

      if (generatedViews.length === 6) {
        toast({ title: "All views generated", description: "All 6 additional views are ready!" });

        // ── LOCKED SEQUENTIAL: 2D Proof FIRST → Artboard FROM proof ──
        // DO NOT CHANGE without Trish approval. Artboard MUST use 2D proof
        // as source — proof has dimensions. Without it, artboard drifts.
        if (visualizationId && generatedImageUrl) {
          const allViewUrls: Record<string, string> = { side: generatedImageUrl };
          for (const view of generatedViews) allViewUrls[view.type] = view.url;
          const vehicleName = `${year} ${make} ${model}`.trim();
          const proofBody = { allViewUrls, vehicleYear: year, vehicleMake: make, vehicleModel: model, designName: selectedPattern?.name || 'FadeWrap Design', finish: selectedFinish };

          console.log(`[FadeWraps] Phase 4a: 2D proof from ${Object.keys(allViewUrls).length} locked views...`);
          (async () => {
            try {
              const { data: proofData, error: proofErr } = await renderClient.functions.invoke('generate-2d-proof', { body: proofBody });
              const proofUrl = proofData?.proofUrl || proofData?.url;
              if (proofErr || !proofUrl) { console.warn('[FadeWraps] 2D proof failed:', proofErr?.message || 'no URL'); return; }
              await saveProofUrlToViz(visualizationId, proofUrl);
              console.log('[FadeWraps] Phase 4a complete — 2D proof saved');

              console.log('[FadeWraps] Phase 4b: artboard from 2D proof (deterministic)...');
              const { data: artData } = await renderClient.functions.invoke('auto-generate-artboard', {
                body: {
                  ...proofBody,
                  allViewUrls: Object.fromEntries(['side', 'front', 'rear'].filter(k => allViewUrls[k]).map(k => [k, allViewUrls[k]])),
                  visualizationId,
                  skipProofGeneration: true,
                  flatProofUrl: proofUrl,
                },
              });
              const artUrl = artData?.artboard_url || artData?.artboardUrl || artData?.url;
              if (artUrl) {
                const abRes = await saveArtboardUrlToViz(visualizationId, artUrl);
                if (!abRes.ok) console.warn('[FadeWraps] artboard cache write failed:', abRes.vizError);
                else console.log('[FadeWraps] Phase 4b complete — artboard saved');
              }
            } catch (e) { console.warn('[FadeWraps] Phase 4 error (non-fatal):', e); }
          })();
        }
      } else if (generatedViews.length > 0) {
        toast({ title: `${generatedViews.length} of 6 views generated`, description: "Some views failed. You can try again." });
      } else {
        toast({ title: "Views generation failed", description: "Could not generate additional views. Please try again.", variant: "destructive" });
      }
    } catch (error: any) {
      console.error('Additional views error:', error);
      toast({ title: "Generation failed", description: error.message || "Please try again", variant: "destructive" });
    } finally {
      setIsGeneratingAdditional(false);
    }
  };

  const totalPrice = calculateTotal();
  const productId = "58391";

  const saveDesignJob = async (vehicleYear: string, vehicleMake: string, vehicleModel: string) => {
    if (!generatedImageUrl || !selectedPattern) return null;

    try {
      const { data: user } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('fadewrap_designs')
        .insert({
          user_id: user?.user?.id || null,
          pattern_id: selectedPattern?.id || null,
          fade_name: selectedPattern.name,
          fade_category: selectedPattern.category || 'Gradient',
          vehicle_year: vehicleYear,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          finish: selectedFinish,
          preview_image_url: generatedImageUrl,
          gradient_settings: {
            fadeStyle,
            addHood,
            addFrontBumper,
            addRearBumper,
            kitSize,
            roofSize,
            additionalViews: additionalViews.map(v => ({ type: v.type, url: v.url })),
            heroUrl: generatedImageUrl
          }
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Failed to save design job:', error);
      return null;
    }
  };

  return {
    selectedPattern,
    setSelectedPattern,
    selectedFinish,
    setSelectedFinish,
    fadeStyle,
    kitSize,
    setKitSize,
    addHood,
    setAddHood,
    addFrontBumper,
    setAddFrontBumper,
    addRearBumper,
    setAddRearBumper,
    roofSize,
    setRoofSize,
    totalPrice,
    productId,
    showFallback,
    setShowFallback,
    generateRender,
    isGenerating,
    generatedImageUrl,
    visualizationId,
    additionalViews,
    generateAdditionalViews,
    isGeneratingAdditional,
    showUpgradeModal,
    setShowUpgradeModal,
    showLoginModal,
    setShowLoginModal,
    clearLastRender,
    saveDesignJob,
    vehicleType,
    setVehicleType,
  };
};
