import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { saveArtboardUrlToViz } from "@/lib/save-artboard-url";
import { renderClient } from "@/integrations/supabase/renderClient";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import { saveProofUrlToViz } from "@/lib/save-proof-url";
import { withTimeout, VIEW_RENDER_TIMEOUT_MS } from "@/lib/invokeWithTimeout";
import { STATIC_PATTERNS, wbtyProductIdForCategory } from "@/data/patternpro-patterns";
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
  // Full-wrap estimate for the vehicle on screen: sq ft of wrap surface and
  // the linear yards of 60" film it takes. Feeds "Yards Needed" so the buyer
  // never sees the old hardcoded 2 yards for a full-size truck.
  const [fullWrapEstimate, setFullWrapEstimate] = useState<{
    vehicle: string; yards: number; squareFeet: number; category: string | null;
  } | null>(null);
  // Per-view progress for the batch after the hero, so the page can say
  // "3 of 7" instead of a bare "Generating Views..." that invites a re-click.
  const [viewProgress, setViewProgress] = useState<{ done: number; total: number; inFlight: string[] }>({
    done: 0, total: 7, inFlight: [],
  });
  const [uploadMode, setUploadMode] = useState<'curated' | 'custom'>('curated');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [designAnchorText, setDesignAnchorText] = useState<string | null>(null);
  const [designName, setDesignName] = useState<string | null>(null);
  // Approval captions belong to the rendered image, even if the buyer later
  // changes a vehicle field, finish, or selected library swatch.
  const [proofContext, setProofContext] = useState<{ year: string; make: string; model: string; design: string; finish: string } | null>(null);
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
    setProofContext(null);
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
        setProofContext({ year: vehicleYear, make: vehicleMake, model: vehicleModel, design: product.ai_generated_name || product.name || 'Custom Pattern', finish });

        // Capture design anchor text for cross-view continuity (same as DesignPro)
        if (heroData?.designAnchorText) {
          setDesignAnchorText(heroData.designAnchorText);
          console.log('[PatternPro] Design anchor captured for cross-view continuity');
        }
        if (heroData?.designName) setDesignName(heroData.designName);

        // generate-pattern-render inserts the color_visualizations row itself
        // (mode_type 'wbty', render_urls.side) and returns its id. The old
        // "find the latest designpanelpro row for this email and flip it"
        // relabeled whatever DesignPro render the user made last — and did
        // nothing at all while the function's insert was failing.
        if (!heroData.renderId) {
          console.warn('[PatternPro] Hero render returned no renderId — the row was not saved; views will not reach RevisionStudio/My Renders');
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

  /** The six views rendered after the driver-side hero, in batch order. */
  const ADDITIONAL_VIEW_TYPES = ['passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'] as const;

  // Parallel batch execution — 3 at a time (two batches). It was 2-at-a-time
  // over three batches with a 3 s stagger: ~2.5 minutes for a truck, with no
  // progress shown, which is exactly how the owner came to re-click Generate
  // mid-batch and have the finished batch discarded as stale (live 2026-09-15).
  // Views now land on screen as each batch completes, and `only` lets the
  // page re-render just the views that are missing.
  const generateAdditionalViews = async (vehicleYear: string, vehicleMake: string, vehicleModel: string, only?: string[]) => {
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

      const wanted = (only && only.length > 0
        ? ADDITIONAL_VIEW_TYPES.filter((v) => only.includes(v))
        : [...ADDITIONAL_VIEW_TYPES]) as string[];
      const viewBatches: string[][] = [];
      for (let i = 0; i < wanted.length; i += 3) viewBatches.push(wanted.slice(i, i + 3));

      const allResults: Array<{ type: string; url: string | null }> = [];
      // Driver side already rendered as hero
      allResults.push({ type: 'side', url: heroUrl });
      // Views already on screen that this call is not re-rendering count as done.
      const kept = Object.entries(additionalViews || {}).filter(([k, v]) => !!v && k !== 'side' && !wanted.includes(k));
      for (const [type, url] of kept) allResults.push({ type, url });
      setViewProgress({ done: 1 + kept.length, total: 7, inFlight: [] });

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
        setViewProgress((p) => ({ ...p, inFlight: batch }));

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

        // Show what has landed so far. Still session-guarded: a batch for a
        // pattern the user has moved past must not paint over the new one.
        if (session === renderSessionRef.current) {
          const landed: Record<string, string> = {};
          for (const r of allResults) if (r.url) landed[r.type] = r.url;
          setAdditionalViews((prev) => ({ ...(prev || {}), ...landed }));
          setViewProgress({ done: Object.keys(landed).length, total: 7, inFlight: [] });
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
      if (successCount > 0 && capturedVizId) {
        try {
          const { data: vizRecord } = await supabase
            .from('color_visualizations')
            .select('id, render_urls')
            .eq('id', capturedVizId)
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
              .eq('id', capturedVizId);
            if (updateError) {
              console.error('[PatternPro] Failed to save render_urls:', updateError.message);
            } else {
              console.log(`[PatternPro] Saved ${Object.keys(mergedUrls).length} view URLs to color_visualizations ${capturedVizId}`);
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

  const calculateSquareFeet = async (
    vehicleYear: string,
    vehicleMake: string,
    vehicleModel: string,
    opts: { silent?: boolean } = {},
  ) => {
    if (!vehicleYear || !vehicleMake || !vehicleModel) {
      if (!opts.silent) toast({ title: "Vehicle required", description: "Please enter year, make, and model", variant: "destructive" });
      return;
    }
    const vehicleKey = `${vehicleYear} ${vehicleMake} ${vehicleModel}`.trim();
    if (fullWrapEstimate?.vehicle === vehicleKey && !opts.silent) {
      setYardsNeeded(fullWrapEstimate.yards);
      return;
    }

    try {
      setIsCalculatingSquareFeet(true);
      const { data, error } = await renderClient.functions.invoke('calculate-film-yards', {
        body: { vehicleYear, vehicleMake, vehicleModel }
      });

      if (error) throw error;

      const yards = Math.max(1, Math.ceil(Number(data?.yards) || 0));
      const squareFeet = Math.round(Number(data?.squareFeet) || 0);
      if (yards > 0 && squareFeet > 0) {
        setCalculatedSquareFeet(squareFeet);
        setFullWrapEstimate({ vehicle: vehicleKey, yards, squareFeet, category: data?.category ?? null });
        // The estimate IS the default quantity. The buyer can still nudge it.
        setYardsNeeded(yards);
        if (!opts.silent) {
          toast({
            title: "Full wrap estimate",
            description: `${vehicleKey}: ~${squareFeet} sq ft → ${yards} yards of 60″ film`,
          });
        }
      }
    } catch (error: any) {
      console.error("Square footage calculation error:", error);
      if (!opts.silent) {
        toast({
          title: "Calculation failed",
          description: error.message || "Please try again",
          variant: "destructive"
        });
      }
    } finally {
      setIsCalculatingSquareFeet(false);
    }
  };

  // WooCommerce product for the cart link — null until a pattern with a
  // connected category is selected (see wbtyProductIdForCategory).
  const productId = wbtyProductIdForCategory(selectedProduct?.category);
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
    fullWrapEstimate,
    viewProgress,
    uploadMode,
    setUploadMode,
    showUpgradeModal,
    setShowUpgradeModal,
    clearLastRender,
    saveDesignJob,
    designAnchorText,
    designName,
    proofContext,
    vehicleType,
    setVehicleType,
  };
};
