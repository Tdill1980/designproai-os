import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { saveArtboardUrlToViz } from "@/lib/save-artboard-url";
import { renderClient } from "@/integrations/supabase/renderClient";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import { saveProofUrlToViz } from "@/lib/save-proof-url";
import { withTimeout, VIEW_RENDER_TIMEOUT_MS } from "@/lib/invokeWithTimeout";
import { STATIC_PATTERNS } from "@/data/patternpro-patterns";
import { type VehicleType } from "@/components/tools/VehicleTypeSelector";
import { getRenderFunctionForType } from "@/components/tools/legacyRenderFunctions";

const STORAGE_KEY = "wbty-generations";
const FREE_LIMIT = 2;

/** Resilient email retrieval - falls back through getSession and refreshSession
 *  when getUser fails (common on mobile private browsers with stale localStorage). */
const getUserEmail = async (): Promise<string | undefined> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email) return user.email;

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.email) return session.user.email;

  const refreshResult = await supabase.auth.refreshSession();
  if (refreshResult.data?.session?.user?.email) return refreshResult.data.session.user.email;

  console.warn('[WBTY] getUserEmail: all attempts failed - edge function JWT fallback will be used');
  return undefined;
};

export const useWBTYLogic = () => {
  const { toast } = useToast();
  const { checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [yardsNeeded, setYardsNeeded] = useState(2);
  const [generationCount, setGenerationCount] = useState(0);
  const [hasReachedLimit, setHasReachedLimit] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [selectedFinish, setSelectedFinish] = useState<"gloss" | "satin" | "matte">("gloss");
  const [patternScale, setPatternScale] = useState(1.0);
  const [additionalViews, setAdditionalViews] = useState<Record<string, string> | null>(null);
  const [isGeneratingAdditional, setIsGeneratingAdditional] = useState(false);
  const [calculatedSquareFeet, setCalculatedSquareFeet] = useState<number | null>(null);
  const [isCalculatingSquareFeet, setIsCalculatingSquareFeet] = useState(false);
  const [uploadMode, setUploadMode] = useState<'curated' | 'custom'>('curated');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [designAnchorText, setDesignAnchorText] = useState<string | null>(null);
  const [designName, setDesignName] = useState<string | null>(null);
  const [vehicleType, setVehicleType] = useState<VehicleType>("car");

  // Each call to generateRender bumps this. Async work captures the value at
  // start; if the user kicks off a new render before the old batches finish,
  // stale results are discarded instead of overwriting the new render.
  const renderSessionRef = useRef(0);

  useEffect(() => {
    const count = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
    setGenerationCount(count);
    setHasReachedLimit(false); // Always allow generation
  }, []);

  const clearLastRender = () => {
    setGeneratedImageUrl(null);
    setAdditionalViews(null);
    setDesignAnchorText(null);
    setDesignName(null);
  };

  const { data: dbProducts, isLoading } = useQuery({
    queryKey: ["wbty_products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wbty_products")
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;

      return data?.filter(product =>
        product.media_url &&
        !product.media_url.includes('placeholder')
      ) || [];
    },
  });

  // Use DB products if available, otherwise fall back to static patterns
  const products = (dbProducts && dbProducts.length > 0) ? dbProducts : STATIC_PATTERNS;

  const pricePerYard = 95.50;
  const totalPrice = yardsNeeded * pricePerYard;

  // Product ID mapping based on pattern families
  const getProductId = (category: string) => {
    const productIdMap: Record<string, string> = {
      "Camo & Carbon": "1726",
      "Metal & Marble": "39698",
      "Wicked & Wild": "4181",
      "Bape Camo": "42809",
      "Modern & Trippy": "52489",
    };
    return productIdMap[category] || "42809";
  };

  const incrementGeneration = () => {
    const newCount = generationCount + 1;
    localStorage.setItem(STORAGE_KEY, newCount.toString());
    setGenerationCount(newCount);
  };

  // Uses same render pipeline as DesignPro: modeType 'designpanelpro', hero = driver side
  const generateRender = async (vehicleYear: string, vehicleMake: string, vehicleModel: string, revisionPrompt?: string) => {
    if (!selectedProduct) {
      toast({ title: "No pattern selected", description: "Please select a WBTY pattern first", variant: "destructive" });
      return false;
    }

    // Check subscription limits
    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return false;
    }

    // Snapshot the pattern + scale + finish + vehicleType at the moment Generate
    // was clicked. The user may switch patterns or vehicle type while the render
    // is in flight; we must keep using what they had when they pressed the
    // button so the render matches the click.
    const session = ++renderSessionRef.current;
    const product = selectedProduct;
    const scale = patternScale;
    const finish = selectedFinish;
    const vType = vehicleType;

    try {
      setIsGenerating(true);
      setShowFallback(false);
      setAdditionalViews(null);
      setDesignAnchorText(null);
      setDesignName(null);

      const userEmail = await getUserEmail();

      // Route through the vehicle-type-specific edge function.
      // Standard vehicles use generate-pattern-render (dedicated PatternPro function)
      // instead of generate-color-render (which is for ColorPro only).
      // Non-standard vehicles (motorcycle/boat/bus/rv) keep their dedicated functions.
      // ALL PatternPro renders go through generate-pattern-render regardless
      // of vehicle type. Vehicle-specific functions (render-motorcycle, etc.)
      // lack pattern fidelity enforcement and let Gemini reinterpret the design.
      const renderFunction = "generate-pattern-render";
      console.log(`[PatternPro] Render call — viewType: "side" (Driver Side ${revisionPrompt ? 'REVISION' : 'initial'}), edge: ${renderFunction}`);
      const { data: heroData, error: heroError } = await withTimeout(
        renderClient.functions.invoke(renderFunction, {
          body: {
            vehicleYear,
            vehicleMake,
            vehicleModel,
            vehicleType: vType,
            modeType: 'designpanelpro',
            viewType: 'side',
            userEmail,
            ...(revisionPrompt ? { revisionPrompt } : {}),
            colorData: {
              panelName: product.ai_generated_name || product.name,
              panelUrl: product.media_url,
              finish,
              manufacturer: 'PatternPro Patterns',
              colorLibrary: 'designpanelpro',
              patternScale: scale,
              coverageType: 'full',
            },
            customDesignUrl: product.media_url,
            useCustomDesign: true,
          },
        }),
        VIEW_RENDER_TIMEOUT_MS,
        `PatternPro hero render`,
      );

      if (heroError) throw heroError;

      // If the user kicked off a newer render while we were waiting, drop this
      // result on the floor — its hero would clobber the newer one's UI.
      if (session !== renderSessionRef.current) {
        console.log(`[PatternPro] Hero render session ${session} stale (current ${renderSessionRef.current}) — discarding`);
        return false;
      }

      if (heroData?.renderUrl) {
        setGeneratedImageUrl(heroData.renderUrl);
        setVisualizationId(heroData.renderId);

        // Capture design anchor text for cross-view continuity (same as DesignPro)
        if (heroData?.designAnchorText) {
          setDesignAnchorText(heroData.designAnchorText);
          console.log('[PatternPro] Design anchor captured for cross-view continuity');
        }
        if (heroData?.designName) setDesignName(heroData.designName);

        // Flip the freshly-created color_visualizations row to mode_type='wbty'
        // so this render appears as PatternPro in Gallery / MyRenders / RevisionStudio
        // instead of being labeled as DesignPro.
        try {
          const { data: vizRecord } = await supabase
            .from('color_visualizations')
            .select('id')
            .eq('customer_email', userEmail || '')
            .eq('mode_type', 'designpanelpro')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (vizRecord) {
            await supabase
              .from('color_visualizations')
              .update({
                mode_type: 'wbty',
                render_urls: { side: heroData.renderUrl },
                updated_at: new Date().toISOString(),
              })
              .eq('id', vizRecord.id);
            console.log(`[PatternPro] Flipped record ${vizRecord.id} to mode_type=wbty`);
          }
        } catch (flipErr) {
          console.error('[PatternPro] Could not flip mode_type:', flipErr);
        }

        incrementGeneration();
        await incrementRenderCount();

        toast({ title: "3D Proof Generated", description: "Your PatternPro preview is ready!" });
        return true;
      }

      return false;
    } catch (error: any) {
      console.error("Generation error:", error);
      toast({
        title: "Generation failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
      return false;
    } finally {
      setIsGenerating(false);
    }
  };

  // Render a single view with retry logic — matches DesignPro pattern.
  // product/scale/finish/vType/heroUrl are passed in (not read from closure)
  // so that batches launched by generateAdditionalViews always render the
  // pattern that was active when the batch started, even if the user clicks
  // a different swatch mid-flight.
  const renderSingleView = async (
    viewType: string,
    vehicleYear: string,
    vehicleMake: string,
    vehicleModel: string,
    userEmail: string | undefined,
    anchorTextOverride: string | null | undefined,
    product: any,
    scale: number,
    finish: "gloss" | "satin" | "matte",
    vType: VehicleType,
    heroUrl: string | null,
  ): Promise<{ type: string; url: string | null }> => {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 3000;

    // ALL PatternPro renders use generate-pattern-render for exact pattern fidelity.
    const renderFunction = "generate-pattern-render";

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`[PatternPro] View "${viewType}" attempt ${attempt}/${MAX_RETRIES + 1} (edge: ${renderFunction})`);

        const { data, error } = await withTimeout(
          renderClient.functions.invoke(renderFunction, {
            body: {
              vehicleYear,
              vehicleMake,
              vehicleModel,
              vehicleType: vType,
              modeType: 'designpanelpro',
              viewType,
              userEmail,
              // heroReferenceUrl MUST be top-level — the edge function reads
              // it from the root body, not from colorData. Nesting it here
              // silently broke cross-view consistency for every non-hero view.
              heroReferenceUrl: heroUrl,
              colorData: {
                panelName: product.ai_generated_name || product.name,
                panelUrl: product.media_url,
                finish,
                manufacturer: 'PatternPro Patterns',
                colorLibrary: 'designpanelpro',
                patternScale: scale,
                designAnchorText: anchorTextOverride ?? null,
                coverageType: 'full',
              },
              customDesignUrl: product.media_url,
              useCustomDesign: true,
            }
          }),
          VIEW_RENDER_TIMEOUT_MS,
          `PatternPro ${viewType} view`
        );

        if (error) throw new Error(error.message || 'Edge function error');
        if (data?.renderUrl) {
          console.log(`[PatternPro] View "${viewType}" OK on attempt ${attempt}`);
          return { type: viewType, url: data.renderUrl };
        }
        throw new Error('No renderUrl in response');
      } catch (viewError: any) {
        console.error(`[PatternPro] View "${viewType}" attempt ${attempt} failed:`, viewError.message);
        if (attempt <= MAX_RETRIES) {
          console.log(`[PatternPro] Retrying "${viewType}" in ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    console.error(`[PatternPro] View "${viewType}" FAILED after ${MAX_RETRIES + 1} attempts`);
    return { type: viewType, url: null };
  };

  // Parallel batch execution matching DesignPro (2 at a time)
  const generateAdditionalViews = async (vehicleYear: string, vehicleMake: string, vehicleModel: string) => {
    if (!selectedProduct || !generatedImageUrl) {
      toast({ title: "Generate hero view first", description: "Please generate the main view before additional views", variant: "destructive" });
      return false;
    }

    // Snapshot state for this batch. If the user picks a different pattern or
    // hits Generate again mid-batch, the in-flight batch keeps using what it
    // started with and the staleness check below skips the final state write.
    const session = renderSessionRef.current;
    const product = selectedProduct;
    const scale = patternScale;
    const finish = selectedFinish;
    const vType = vehicleType;
    const heroUrl = generatedImageUrl;
    const capturedAnchorText = designAnchorText;
    const capturedVizId = visualizationId;

    try {
      setIsGeneratingAdditional(true);
      toast({ title: "Generating additional views...", description: "This will take a few moments" });

      const userEmail = await getUserEmail();

      // Same view batches as DesignPro — parallel 2-at-a-time
      const viewBatches: string[][] = [
        ['passenger-side', 'hood_detail'],  // Batch 1
        ['front', 'rear'],                  // Batch 2
        ['close-up', 'roof'],               // Batch 3
      ];

      const allResults: Array<{ type: string; url: string | null }> = [];
      // Driver side already rendered as hero
      allResults.push({ type: 'side', url: heroUrl });

      for (let batchIdx = 0; batchIdx < viewBatches.length; batchIdx++) {
        // Bail early if the user kicked off a new render — no point burning
        // Gemini calls on a pattern they've already moved past.
        if (session !== renderSessionRef.current) {
          console.log(`[PatternPro] Additional views session ${session} stale (current ${renderSessionRef.current}) — aborting batch ${batchIdx + 1}`);
          return false;
        }

        const batch = viewBatches[batchIdx];
        // Stagger batches by 3s to avoid Gemini rate limits
        if (batchIdx > 0) {
          console.log(`[PatternPro] Waiting 3s before batch ${batchIdx + 1} to avoid rate limits...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        console.log(`[PatternPro] Batch ${batchIdx + 1}/${viewBatches.length}: [${batch.join(', ')}]`);

        const batchResults = await Promise.allSettled(
          batch.map(viewType => renderSingleView(
            viewType, vehicleYear, vehicleMake, vehicleModel, userEmail,
            capturedAnchorText, product, scale, finish, vType, heroUrl,
          ))
        );

        for (let i = 0; i < batchResults.length; i++) {
          const settled = batchResults[i];
          if (settled.status === 'fulfilled') {
            allResults.push(settled.value);
          } else {
            const viewType = batch[i];
            console.error(`[PatternPro] View "${viewType}" unexpected rejection:`, settled.reason);
            allResults.push({ type: viewType, url: null });
          }
        }
      }

      // Final stale-check before we write any state. This is the critical one:
      // it stops a stale batch from clobbering the new render's UI with the
      // old pattern's view URLs (the original PatternPro symptom).
      if (session !== renderSessionRef.current) {
        console.log(`[PatternPro] Additional views session ${session} stale (current ${renderSessionRef.current}) — discarding ${allResults.length} results`);
        return false;
      }

      // Build views record
      const views: Record<string, string> = {};
      for (const result of allResults) {
        if (result.url) {
          views[result.type] = result.url;
        }
      }

      const successCount = Object.keys(views).length;
      const totalViews = 7; // side + 6 additional

      // Save all 7 view URLs to the color_visualizations record so this render
      // appears in RevisionStudio, Gallery, and MyRenders with all views. Also
      // flip mode_type to 'wbty' so the pages filter/label it as PatternPro.
      if (successCount > 0) {
        try {
          const { data: vizRecord } = await supabase
            .from('color_visualizations')
            .select('id, render_urls')
            .eq('customer_email', userEmail || '')
            .eq('mode_type', 'designpanelpro')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (vizRecord) {
            const mergedUrls = { ...(vizRecord.render_urls as Record<string, string> || {}), ...views };
            const { error: updateError } = await supabase
              .from('color_visualizations')
              .update({
                render_urls: mergedUrls,
                mode_type: 'wbty',
                updated_at: new Date().toISOString(),
              })
              .eq('id', vizRecord.id);
            if (updateError) {
              console.error('[PatternPro] Failed to save render_urls + flip mode_type:', updateError.message);
            } else {
              console.log(`[PatternPro] Saved ${Object.keys(mergedUrls).length} view URLs to color_visualizations ${vizRecord.id} and set mode_type=wbty`);
            }
          }
        } catch (dbErr) {
          console.error('[PatternPro] Error saving render_urls:', dbErr);
        }
      }

      if (successCount >= totalViews) {
        setAdditionalViews(views);
        toast({ title: "All Views Generated!", description: "All additional views are ready" });

        // ── LOCKED SEQUENTIAL: 2D Proof FIRST → Artboard FROM proof ──
        // DO NOT CHANGE without Trish approval. Artboard MUST use 2D proof
        // as source — proof has dimensions. Without it, artboard drifts.
        if (capturedVizId && heroUrl) {
          const proofBody = { allViewUrls: views, vehicleYear, vehicleMake, vehicleModel, designName: product?.name || 'PatternPro Design', finish: 'Gloss' };

          console.log(`[PatternPro] Phase 4a: 2D proof from ${successCount} locked views...`);
          (async () => {
            try {
              const { data: proofData, error: proofErr } = await renderClient.functions.invoke('generate-2d-proof', { body: proofBody });
              const proofUrl = proofData?.proofUrl || proofData?.url;
              if (proofErr || !proofUrl) { console.warn('[PatternPro] 2D proof failed:', proofErr?.message || 'no URL'); return; }
              await saveProofUrlToViz(capturedVizId, proofUrl);
              console.log('[PatternPro] Phase 4a complete — 2D proof saved');

              console.log('[PatternPro] Phase 4b: artboard from 2D proof (deterministic)...');
              const { data: artData } = await renderClient.functions.invoke('auto-generate-artboard', {
                body: {
                  ...proofBody,
                  allViewUrls: Object.fromEntries(['side', 'front', 'rear'].filter(k => views[k]).map(k => [k, views[k]])),
                  visualizationId: capturedVizId,
                  skipProofGeneration: true,
                  flatProofUrl: proofUrl,
                },
              });
              const artUrl = artData?.artboard_url || artData?.artboardUrl || artData?.url;
              if (artUrl) {
                const abRes = await saveArtboardUrlToViz(capturedVizId, artUrl);
                if (!abRes.ok) console.warn('[PatternPro] artboard cache write failed:', abRes.vizError);
                else console.log(`[PatternPro] Phase 4b complete — artboard saved`);
              }
            } catch (e) { console.warn('[PatternPro] Phase 4 error (non-fatal):', e); }
          })();
        }

        return true;
      } else if (successCount > 1) {
        setAdditionalViews(views);
        toast({ title: `${successCount} of ${totalViews} views generated`, description: "Some views failed. You can try again." });
        return true;
      }

      toast({ title: "Views generation failed", description: "Could not generate additional views. Please try again.", variant: "destructive" });
      return false;
    } catch (error: any) {
      console.error("Additional views generation error:", error);
      toast({
        title: "Additional views failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
      return false;
    } finally {
      setIsGeneratingAdditional(false);
    }
  };

  const calculateSquareFeet = async (vehicleYear: string, vehicleMake: string, vehicleModel: string) => {
    if (!vehicleYear || !vehicleMake || !vehicleModel) {
      toast({ title: "Vehicle required", description: "Please enter year, make, and model", variant: "destructive" });
      return;
    }

    try {
      setIsCalculatingSquareFeet(true);
      const { data, error } = await renderClient.functions.invoke('calculate-film-yards', {
        body: { vehicleYear, vehicleMake, vehicleModel }
      });

      if (error) throw error;

      if (data?.squareFeet) {
        setCalculatedSquareFeet(data.squareFeet);
        toast({
          title: "Square Footage Calculated",
          description: `~${data.squareFeet} sq ft needed for ${vehicleYear} ${vehicleMake} ${vehicleModel}`
        });
      }
    } catch (error: any) {
      console.error("Square footage calculation error:", error);
      toast({
        title: "Calculation failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsCalculatingSquareFeet(false);
    }
  };

  const productId = selectedProduct ? getProductId(selectedProduct.category) : "42809";
  const remainingGenerations = Math.max(0, FREE_LIMIT - generationCount);

  // Save design job to database for PrintPro integration
  const saveDesignJob = async (vehicleYear: string, vehicleMake: string, vehicleModel: string) => {
    if (!generatedImageUrl || !selectedProduct) return null;

    try {
      const { data: user } = await supabase.auth.getUser();

      const allViewsArray = [];
      if (generatedImageUrl) {
        allViewsArray.push({ type: 'side', url: generatedImageUrl });
      }
      if (additionalViews) {
        for (const [type, url] of Object.entries(additionalViews)) {
          if (url && type !== 'side') allViewsArray.push({ type, url });
        }
      }

      const { data, error } = await supabase
        .from('pattern_designs')
        .insert({
          user_id: user?.user?.id || null,
          product_id: selectedProduct?.id || null,
          pattern_image_url: selectedProduct.media_url,
          pattern_name: selectedProduct.ai_generated_name || selectedProduct.name,
          pattern_category: selectedProduct.category || 'Custom',
          pattern_scale: patternScale,
          vehicle_year: vehicleYear,
          vehicle_make: vehicleMake,
          vehicle_model: vehicleModel,
          finish: selectedFinish,
          preview_image_url: generatedImageUrl,
          texture_profile: {
            allViews: allViewsArray,
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
    selectedProduct,
    setSelectedProduct,
    yardsNeeded,
    setYardsNeeded,
    products,
    isLoading,
    pricePerYard,
    totalPrice,
    productId,
    hasReachedLimit,
    remainingGenerations,
    incrementGeneration,
    showFallback,
    setShowFallback,
    generateRender,
    isGenerating,
    generatedImageUrl,
    visualizationId,
    selectedFinish,
    setSelectedFinish,
    patternScale,
    setPatternScale,
    additionalViews,
    generateAdditionalViews,
    isGeneratingAdditional,
    calculatedSquareFeet,
    calculateSquareFeet,
    isCalculatingSquareFeet,
    uploadMode,
    setUploadMode,
    showUpgradeModal,
    setShowUpgradeModal,
    clearLastRender,
    saveDesignJob,
    designAnchorText,
    designName,
    vehicleType,
    setVehicleType,
  };
};
