import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import { saveProofUrlToViz } from "@/lib/save-proof-url";
import { saveArtboardUrlToViz } from "@/lib/save-artboard-url";
import { FadeStyleId } from "@/lib/fadeStyles";
import { withTimeout, VIEW_RENDER_TIMEOUT_MS } from "@/lib/invokeWithTimeout";
import type { CoverageType } from "@/components/tools/CoverageSelector";
import { type VehicleType, getRenderFunctionForType } from "@/components/tools/VehicleTypeSelector";
import type { VehicleSpecsPreview } from "@/components/tools/NonStandardVehicleWarning";
// INSTANT_MIRROR disabled — passenger side now always uses AI render

type KitSize = "small" | "medium" | "large" | "xl";
type RoofSize = "none" | "small" | "medium" | "large";
type DesignProMode = "panels" | "gradients";

export const useDesignProLogic = () => {
  const { toast } = useToast();
  const { checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();

  // Mode toggle
  const [mode, setMode] = useState<DesignProMode>("panels");

  // Vehicle type routing (car/truck/suv/van stay on locked pipeline;
  // motorcycle/boat/bus/rv route to dedicated render-<type> edge functions)
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [nonStandardSpecs, setNonStandardSpecs] = useState<VehicleSpecsPreview | null>(null);

  // Shared state
  const [selectedPattern, setSelectedPattern] = useState<any>(null);
  const [selectedFinish, setSelectedFinish] = useState<'Gloss' | 'Satin' | 'Matte'>('Gloss');
  const [kitSize, setKitSize] = useState<KitSize>("medium");
  const [addHood, setAddHood] = useState(false);
  const [addFrontBumper, setAddFrontBumper] = useState(false);
  const [addRearBumper, setAddRearBumper] = useState(false);
  const [roofSize, setRoofSize] = useState<RoofSize>("none");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [allViews, setAllViews] = useState<any[]>([]);
  const [isGeneratingAdditional, setIsGeneratingAdditional] = useState(false);
  const [failedViews, setFailedViews] = useState<string[]>([]);
  const [isRetryingView, setIsRetryingView] = useState<string | null>(null);
  const [designAnchorText, setDesignAnchorText] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<'curated' | 'custom'>('curated');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [lastError, setLastError] = useState<{ type: 'auth' | 'limit' | 'general'; message: string } | null>(null);
  const [coverageType, setCoverageType] = useState<CoverageType>("full");
  const [renderDid, setRenderDid] = useState<string | null>(null);
  const [renderPt, setRenderPt] = useState<string | null>(null);
  const [designName, setDesignName] = useState<string | null>(null);

  // FadeWraps-specific state
  const [gradientScale, setGradientScale] = useState(1.0);
  const [gradientDirection, setGradientDirection] = useState<'front-to-back' | 'back-to-front' | 'top-to-bottom' | 'bottom-to-top' | 'diagonal-front' | 'diagonal-rear'>('front-to-back');
  const [fadeStyle, setFadeStyle] = useState<FadeStyleId>('front_back');

  const clearLastRender = () => {
    setGeneratedImageUrl(null);
    setAllViews([]);
    setDesignAnchorText(null);
    setRenderDid(null);
    setRenderPt(null);
    setDesignName(null);
  };

  // Hydrate state from an existing render (e.g. preview from Revision Studio IQ)
  const hydrateFromPreview = (preview: {
    heroUrl: string;
    renderUrls: Record<string, string>;
    designName?: string;
    visualizationId?: string;
  }) => {
    setGeneratedImageUrl(preview.heroUrl);
    setVisualizationId(preview.visualizationId || null);
    setDesignName(preview.designName || null);

    // Build allViews from render_urls
    const viewOrder = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
    const views: { type: string; url: string }[] = [];
    for (const key of viewOrder) {
      if (preview.renderUrls[key]) {
        views.push({ type: key, url: preview.renderUrls[key] });
      }
    }
    // Add any extra keys not in the standard order
    for (const [key, url] of Object.entries(preview.renderUrls)) {
      if (url && !viewOrder.includes(key)) {
        views.push({ type: key, url });
      }
    }
    setAllViews(views);
  };

  // Helper to get user email with robust retry (matches useDesignPanelProLogic)
  const getUserEmail = async (): Promise<string | null> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user?.email) return session.user.email;

    const { data: { user } } = await supabase.auth.getUser();
    if (user?.email) return user.email;

    const refreshResult = await supabase.auth.refreshSession();
    if (refreshResult.data?.session?.user?.email) return refreshResult.data.session.user.email;

    for (let i = 0; i < 3; i++) {
      await new Promise(resolve => setTimeout(resolve, 300));
      const result = await supabase.auth.getSession();
      if (result.data?.session?.user?.email) return result.data.session.user.email;
    }

    console.warn('[DesignPro] getUserEmail: All attempts failed');
    return null;
  };

  // Fetch patterns based on mode
  const { data: patterns, isLoading } = useQuery({
    queryKey: ["designpro_patterns", mode],
    queryFn: async () => {
      const tableName = mode === "panels" ? "designpanelpro_patterns" : "fadewraps_patterns";
      const { data, error } = await supabase
        .from(tableName)
        .select("*")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });

      if (error) throw error;

      // For fadewraps, filter to only show uploaded patterns
      if (mode === "gradients") {
        return data?.filter(pattern =>
          pattern.media_url &&
          pattern.media_url.includes('supabase.co/storage')
        ) || [];
      }

      return data || [];
    },
  });

  // Pricing (same for both modes)
  const kitPrices = {
    small: 600,
    medium: 710,
    large: 825,
    xl: 990,
  };

  const addonPrices = {
    hood: 160,
    frontBumper: 200,
    rearBumper: 395,
  };

  const roofPrices = {
    none: 0,
    small: 160,
    medium: 225,
    large: 330,
  };

  const calculateTotal = () => {
    let total = kitPrices[kitSize];
    if (addHood) total += addonPrices.hood;
    if (addFrontBumper) total += addonPrices.frontBumper;
    if (addRearBumper) total += addonPrices.rearBumper;
    if (roofSize !== "none") total += roofPrices[roofSize];
    return total;
  };

  const generateRender = async (year: string, make: string, model: string, revisionPrompt?: string, originalRenderUrl?: string) => {
    if (!selectedPattern) {
      toast({
        title: "Select a design first",
        description: "Please select a panel design from the library.",
        variant: "destructive",
      });
      return;
    }

    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setLastError({ type: 'limit', message: 'Monthly render limit reached.' });
      setShowUpgradeModal(true);
      return;
    }

    const userEmail = await getUserEmail();
    if (!userEmail) {
      setLastError({ type: 'auth', message: 'Please log in to generate renders.' });
      return;
    }

    setLastError(null);
    setIsGenerating(true);
    // Only clear previous render if this is NOT a revision (keep current image visible during revision)
    if (!revisionPrompt) {
      setGeneratedImageUrl(null);
      setAllViews([]);
      setDesignAnchorText(null);
    }

    try {
      if (mode === "panels") {
        // Panels mode — route through generate-pattern-render (dedicated panel function)
        // instead of generate-color-render, so the pattern is reproduced exactly.
        // Non-standard vehicles (motorcycle/boat/bus/rv) keep their dedicated functions.
        const baseFunction = getRenderFunctionForType(vehicleType);
        const renderFunction = baseFunction === "generate-color-render"
          ? "generate-pattern-render"
          : baseFunction;
        console.log(`[DesignPro] Render call — function: ${renderFunction}, vehicleType: ${vehicleType}, viewType: "side" (${revisionPrompt ? 'REVISION' : 'initial'})`);
        const { data, error } = await renderClient.functions.invoke(renderFunction, {
          body: {
            vehicleYear: year,
            vehicleMake: make,
            vehicleModel: model,
            modeType: 'designpanelpro',
            viewType: 'side',
            userEmail,
            ...(revisionPrompt ? { revisionPrompt } : {}),
            ...(originalRenderUrl ? { originalRenderUrl } : {}),
            colorData: {
              panelName: selectedPattern.ai_generated_name || selectedPattern.name,
              panelUrl: selectedPattern.media_url,
              finish: selectedFinish.toLowerCase(),
              manufacturer: 'DesignPanelPro Patterns',
              colorLibrary: 'designpanelpro',
              coverageType,
            }
          }
        });

        if (error) throw error;

        if (data?.renderUrl) {
          setGeneratedImageUrl(data.renderUrl);
          setVisualizationId(data.renderId);

          // Capture DesignID + Prompt Thumbprint
          if (data?.did) setRenderDid(data.did);
          if (data?.pt) setRenderPt(data.pt);
          if (data?.designName) setDesignName(data.designName);

          // Capture design anchor text for cross-view continuity
          if (data?.designAnchorText) {
            setDesignAnchorText(data.designAnchorText);
            console.log('[DesignPro] Design anchor captured for cross-view continuity');
          }

          // Capture non-standard vehicle specs for proof-stage validation banner
          if (data.requiresValidation && data.dimensions) {
            setNonStandardSpecs({
              vehicleSpecsId: data.vehicleSpecsId,
              vehicleClass: data.vehicleClass,
              vehicleSubType: data.vehicleSubType,
              dimensions: data.dimensions,
              panels: data.panels,
              confidence: data.confidence,
              sourceUrls: data.sourceUrls,
            });
          } else {
            setNonStandardSpecs(null);
          }

          await incrementRenderCount();
          toast({
            title: "3D Proof Generated",
            description: "Your RestyleLibrary™ preview is ready!"
          });
        } else if (data?.error) {
          throw new Error(data.error);
        }
      } else {
        // FadeWraps mode — generate-color-render
        const { data, error } = await renderClient.functions.invoke('generate-color-render', {
          body: {
            vehicleYear: year,
            vehicleMake: make,
            vehicleModel: model,
            modeType: "fadewraps",
            viewType: "side",
            ...(revisionPrompt ? { revisionPrompt } : {}),
            ...(originalRenderUrl ? { originalRenderUrl } : {}),
            colorData: {
              // Use InkFusion lamination if available, otherwise use selectedFinish
              finish: (selectedPattern as any).inkFusionColor?.lamination?.toLowerCase() || selectedFinish.toLowerCase(),
              colorName: selectedPattern.name,
              // Extract hex from inkFusionColor first (for InkFusion selections), then fallback
              colorHex: (selectedPattern as any).inkFusionColor?.hex || (selectedPattern as any).hex || '#000000',
              patternUrl: selectedPattern.media_url,
              isInkFusion: !selectedPattern.media_url || (selectedPattern as any).isInkFusion === true,
              gradientScale,
              gradientDirection,
              fadeStyle, // Pass exact styleId to backend
              addHood,
              addFrontBumper,
              addRearBumper,
              kitSize,
              roofSize,
              manufacturer: (selectedPattern as any).isInkFusion ? 'InkFusion' : 'FadeWraps Gradients',
              colorLibrary: (selectedPattern as any).isInkFusion ? 'inkfusion' : 'fadewraps'
            },
            userEmail,
          }
        });

        if (error) throw error;

        if (data?.renderUrl) {
          setGeneratedImageUrl(data.renderUrl);
          setVisualizationId(data.renderId);

          // Capture DesignID + Prompt Thumbprint
          if (data?.did) setRenderDid(data.did);
          if (data?.pt) setRenderPt(data.pt);
          if (data?.designName) setDesignName(data.designName);

          await incrementRenderCount();
          toast({
            title: "3D Proof Generated",
            description: "Your FadeWraps™ preview is ready!"
          });
        }
      }
    } catch (error: any) {
      console.error('Generate render error:', error);
      setLastError({ type: 'general', message: error.message || 'Generation failed. Please try again.' });
      toast({
        title: "Generation failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsGenerating(false);
    }
  };

  // Render a single view with retry logic
  // anchorTextOverride: pass the anchor text directly from the View 1 response
  // to avoid a React state race condition where designAnchorText hasn't updated yet.
  const renderSingleView = async (
    viewType: string,
    year: string,
    make: string,
    model: string,
    userEmail: string,
    anchorTextOverride?: string | null
  ): Promise<{ type: string; url: string | null }> => {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 3000;

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      try {
        console.log(`[DesignPro] View "${viewType}" attempt ${attempt}/${MAX_RETRIES + 1}`);

        if (mode === "panels") {
          // Panels mode — route through generate-pattern-render with design anchor
          const panelUrl = selectedPattern.media_url;
          const { data, error } = await withTimeout(
            renderClient.functions.invoke('generate-pattern-render', {
              body: {
                vehicleYear: year,
                vehicleMake: make,
                vehicleModel: model,
                modeType: 'designpanelpro',
                viewType,
                userEmail,
                colorData: {
                  panelName: selectedPattern.ai_generated_name || selectedPattern.name,
                  panelUrl: panelUrl,
                  finish: selectedFinish.toLowerCase(),
                  panelDimensions: '186x56',
                  heroReferenceUrl: generatedImageUrl,
                  designAnchorText: anchorTextOverride ?? designAnchorText,
                  coverageType,
                }
              }
            }),
            VIEW_RENDER_TIMEOUT_MS,
            `DesignPro ${viewType} view`
          );
          if (error) throw new Error(error.message || 'Edge function error');
          if (data?.renderUrl) {
            console.log(`[DesignPro] View "${viewType}" OK on attempt ${attempt}`);
            return { type: viewType, url: data.renderUrl };
          }
          throw new Error('No renderUrl in response');
        } else {
          // FadeWraps mode
          const resolvedHex = (selectedPattern as any).inkFusionColor?.hex || (selectedPattern as any).hex;
          const isInkFusion = !!(selectedPattern as any).isInkFusion || !!(selectedPattern as any).inkFusionColor;

          const { data, error } = await withTimeout(
            renderClient.functions.invoke('generate-color-render', {
              body: {
                vehicleYear: year,
                vehicleMake: make,
                vehicleModel: model,
                modeType: "fadewraps",
                viewType,
                colorData: {
                  finish: (selectedPattern as any).inkFusionColor?.lamination?.toLowerCase() || selectedFinish.toLowerCase(),
                  colorName: selectedPattern.name,
                  colorHex: resolvedHex,
                  renderHex: (selectedPattern as any).inkFusionColor?.renderHex || null,
                  inkDensity: (selectedPattern as any).inkFusionColor?.inkDensity || 1.0,
                  patternUrl: selectedPattern.media_url,
                  isInkFusion,
                  fadeStyle,
                  gradientScale,
                  gradientDirection,
                  addHood,
                  addFrontBumper,
                  addRearBumper,
                  kitSize,
                  roofSize,
                  manufacturer: isInkFusion ? 'InkFusion' : 'FadeWraps Gradients',
                  colorLibrary: isInkFusion ? 'inkfusion' : 'fadewraps'
                },
                userEmail,
              }
            }),
            VIEW_RENDER_TIMEOUT_MS,
            `DesignPro ${viewType} view`
          );
          if (error) throw new Error(error.message || 'Edge function error');
          if (data?.renderUrl) {
            console.log(`[DesignPro] View "${viewType}" OK on attempt ${attempt}`);
            return { type: viewType, url: data.renderUrl };
          }
          throw new Error('No renderUrl in response');
        }
      } catch (viewError: any) {
        console.error(`[DesignPro] View "${viewType}" attempt ${attempt} failed:`, viewError.message);
        if (attempt <= MAX_RETRIES) {
          console.log(`[DesignPro] Retrying "${viewType}" in ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    console.error(`[DesignPro] View "${viewType}" FAILED after ${MAX_RETRIES + 1} attempts`);
    return { type: viewType, url: null };
  };

  const generateAdditionalViews = async (year: string, make: string, model: string) => {
    if (!selectedPattern) return;

    setIsGeneratingAdditional(true);
    setFailedViews([]);
    try {
      const userEmail = await getUserEmail();
      if (!userEmail) {
        setLastError({ type: 'auth', message: 'Please log in to generate additional views.' });
        toast({
          title: "Authentication required",
          description: "Please log in to generate additional views.",
          variant: "destructive",
        });
        return;
      }

      // Production view order (driver side already rendered as initial = 7 total)
      const totalViews = 7; // side + 6 additional

      // Capture anchor text as a local variable to avoid React state race condition.
      const capturedAnchorText = designAnchorText;

      // Start with driver side already rendered
      const allResults: Array<{ type: string; url: string | null }> = [];
      const failed: string[] = [];
      allResults.push({ type: 'side', url: generatedImageUrl });
      setAllViews([...allResults.filter(v => v.url) as Array<{ type: string; url: string }>]);

      // ── INSTANT MIRROR DISABLED ──
      // Passenger side now always gets its own AI render via design-panel-ai-generate.
      // Mirroring caused duplicate driver-side images and backwards text on wraps.

      // PARALLEL BATCH execution (2 at a time) — matches RecreatePro pattern
      // Each view is a separate edge-function call. Batching 2-at-a-time
      // keeps Gemini API rate limits happy while halving total wait.
      const viewBatches: string[][] = [
            ['passenger-side', 'hood_detail'],  // Batch 1
            ['front', 'rear'],                  // Batch 2
            ['close-up', 'roof'],               // Batch 3
          ];

      for (let batchIdx = 0; batchIdx < viewBatches.length; batchIdx++) {
        const batch = viewBatches[batchIdx];
        // Stagger batches by 3s to avoid Gemini rate limits (429s)
        if (batchIdx > 0) {
          console.log(`[DesignPro] Waiting 3s before batch ${batchIdx + 1} to avoid rate limits...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
        console.log(`[DesignPro] Batch ${batchIdx + 1}/${viewBatches.length}: [${batch.join(', ')}]`);
        const batchResults = await Promise.allSettled(
          batch.map(viewType => renderSingleView(viewType, year, make, model, userEmail, capturedAnchorText))
        );

        for (let i = 0; i < batchResults.length; i++) {
          const settled = batchResults[i];
          if (settled.status === 'fulfilled') {
            const result = settled.value;
            allResults.push(result);
            if (result.url) {
              setAllViews(prev => [...prev, { type: result.type, url: result.url! }]);
            } else {
              failed.push(result.type);
            }
          } else {
            const viewType = batch[i];
            console.error(`[DesignPro] View "${viewType}" unexpected rejection:`, settled.reason);
            allResults.push({ type: viewType, url: null });
            failed.push(viewType);
          }
        }
      }

      // Build final view set
      const views = allResults
        .filter(v => v.url)
        .map(v => ({ type: v.type, url: v.url! }));
      console.log(`[DesignPro] All views complete: ${views.length}/${totalViews} succeeded${failed.length > 0 ? ` (failed: ${failed.join(', ')})` : ''}`);

      // ── 2D Proof — kicked HERE, as part of the seven-view pass ──
      // DO NOT CHANGE without Trish approval. Artboard MUST use 2D proof
      // as source — proof has dimensions. Without it, artboard drifts.
      //
      // Phase 2 (Trish-approved 2026-05-22): the proof now generates as
      // part of THIS generation pass (kicked the moment all views are
      // ready, running concurrently with the render-URL DB save below)
      // and is AWAITED before generateAdditionalViews resolves. It used
      // to be fire-and-forget, which deferred it to "a later time" and
      // raced the user — they could reach production/QC before the proof
      // saved, so QC's deterministic crop found no stored proof and fell
      // back to the 3D render (distorted / reinterpreted panel = the
      // inconsistent misses). Awaiting guarantees the proof is persisted
      // to color_visualizations.admin_notes, which the production-pack
      // bridge then carries into panelizer_jobs.concept_json where the
      // deterministic flat-proof crop reads it. Consistent every time.
      let proofPromise: Promise<void> | null = null;
      if (visualizationId && generatedImageUrl && views.length > 1) {
        const allViewUrls: Record<string, string> = {};
        for (const view of views) allViewUrls[view.type] = view.url;
        const dName = mode === 'panels' ? (selectedPattern?.name || 'DesignPro Panel') : 'FadeWrap Design';
        const proofBody = { allViewUrls, vehicleYear: year, vehicleMake: make, vehicleModel: model, designName: dName, finish: selectedPattern?.finish || 'Gloss' };

        console.log(`[DesignPro] Phase 4a: 2D proof from ${views.length} locked views (${mode}) — in parallel with view-URL save...`);
        proofPromise = (async () => {
          try {
            const { data: proofData, error: proofErr } = await renderClient.functions.invoke('generate-2d-proof', { body: proofBody });
            const proofUrl = proofData?.proofUrl || proofData?.url;
            if (proofErr || !proofUrl) { console.warn('[DesignPro] 2D proof failed:', proofErr?.message || 'no URL'); return; }
            await saveProofUrlToViz(visualizationId, proofUrl);
            console.log(`[DesignPro] Phase 4a complete — 2D proof saved (${mode})`);

            console.log(`[DesignPro] Phase 4b: artboard from 2D proof (deterministic, ${mode})...`);
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
              if (!abRes.ok) console.warn('[DesignPro] artboard cache write failed:', abRes.vizError);
              else console.log(`[DesignPro] Phase 4b complete — artboard saved (${mode})`);
            }
          } catch (e) { console.warn('[DesignPro] Phase 4 error (non-fatal):', e); }
        })();
      }

      // Save all successful view URLs to the color_visualizations record
      // This ensures hood_detail, close-up, and all other views persist in the DB.
      // Runs concurrently with the 2D proof generation kicked above.
      if (visualizationId && views.length > 0) {
        try {
          const renderUrlsMap: Record<string, string> = {};
          for (const view of views) {
            renderUrlsMap[view.type] = view.url;
          }
          // Find the color_visualizations record to update (visualizationId is from vehicle_renders)
          // Query by vehicle + mode to find the right record
          const { data: vizRecord } = await supabase
            .from('color_visualizations')
            .select('id, render_urls')
            .eq('customer_email', await getUserEmail())
            .eq('mode_type', mode === 'panels' ? 'designpanelpro' : 'fadewraps')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (vizRecord) {
            const mergedUrls = { ...(vizRecord.render_urls as Record<string, string> || {}), ...renderUrlsMap };
            const { error: updateError } = await supabase
              .from('color_visualizations')
              .update({ render_urls: mergedUrls, updated_at: new Date().toISOString() })
              .eq('id', vizRecord.id);
            if (updateError) {
              console.error('[DesignPro] Failed to save render_urls to DB:', updateError.message);
            } else {
              console.log(`[DesignPro] Saved ${Object.keys(mergedUrls).length} view URLs to DB record ${vizRecord.id}`);
            }
          }
        } catch (dbErr) {
          console.error('[DesignPro] Error saving render_urls:', dbErr);
        }
      }

      setAllViews(views);
      setFailedViews(failed);

      // Await the 2D proof so it is reliably persisted before this flow
      // resolves — the whole point of Phase 2's consistency fix.
      if (proofPromise) {
        console.log('[DesignPro] Awaiting 2D proof completion before finishing view generation...');
        await proofPromise;
      }

      if (failed.length > 0) {
        toast({
          title: `${views.length} of ${totalViews} views generated`,
          description: `${failed.length} view${failed.length > 1 ? 's' : ''} failed. You can retry individual views below.`,
          variant: "destructive"
        });
      } else {
        toast({
          title: "All views generated",
          description: `${totalViews} of ${totalViews} views ready!`
        });
      }
    } catch (error: any) {
      console.error('Generate additional views error:', error);
      toast({
        title: "Generation failed",
        description: error.message || "Please try again",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingAdditional(false);
    }
  };

  // Retry a single failed view and update allViews in place
  const retryFailedView = async (viewType: string, year: string, make: string, model: string): Promise<boolean> => {
    if (!selectedPattern) return false;

    setIsRetryingView(viewType);
    try {
      const userEmail = await getUserEmail();
      if (!userEmail) {
        setLastError({ type: 'auth', message: 'Please log in to retry views.' });
        return false;
      }

      const result = await renderSingleView(viewType, year, make, model, userEmail, designAnchorText);

      if (result.url) {
        setAllViews(prev => [...prev, { type: result.type, url: result.url! }]);
        setFailedViews(prev => prev.filter(v => v !== viewType));
        toast({
          title: "View recovered",
          description: `${viewType} generated successfully on retry.`
        });
        return true;
      } else {
        toast({
          title: "Retry failed",
          description: `${viewType} could not be generated. Try again later.`,
          variant: "destructive"
        });
        return false;
      }
    } finally {
      setIsRetryingView(null);
    }
  };

  const productId = mode === "panels" ? 'DESIGNPANELPRO_PLACEHOLDER' : "58391";

  return {
    mode,
    setMode,
    vehicleType,
    setVehicleType,
    nonStandardSpecs,
    setNonStandardSpecs,
    selectedPattern,
    setSelectedPattern,
    selectedFinish,
    setSelectedFinish,
    gradientScale,
    setGradientScale,
    gradientDirection,
    setGradientDirection,
    fadeStyle,
    setFadeStyle,
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
    patterns,
    isLoading,
    totalPrice: calculateTotal(),
    productId,
    generateRender,
    isGenerating,
    generatedImageUrl,
    visualizationId,
    allViews,
    generateAdditionalViews,
    isGeneratingAdditional,
    failedViews,
    retryFailedView,
    isRetryingView,
    designAnchorText,
    uploadMode,
    setUploadMode,
    showUpgradeModal,
    setShowUpgradeModal,
    clearLastRender,
    hydrateFromPreview,
    lastError,
    setLastError,
    coverageType,
    setCoverageType,
    renderDid,
    renderPt,
    designName,
  };
};
