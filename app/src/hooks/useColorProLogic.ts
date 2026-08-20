import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import type { InkFusionColor } from "@/lib/restyleproai-colors";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import { saveProofUrlToViz } from "@/lib/save-proof-url";
import { saveArtboardUrlToViz } from "@/lib/save-artboard-url";
import { loadAllVinylSwatches, convertVinylSwatchToInkFusionColor, type VinylSwatch } from "@/lib/vinyl-intelligence";
import { toast } from "@/hooks/use-toast";
import { withTimeout, VIEW_RENDER_TIMEOUT_MS } from "@/lib/invokeWithTimeout";
import { generatePassengerMirror, designLikelyHasText, uploadMirrorToStorage, fixMirrorText } from "@/utils/passenger-mirror";
import { type VehicleType, isNonStandardVehicle } from "@/components/tools/VehicleTypeSelector";
import { getRenderFunctionForType } from "@/components/tools/legacyRenderFunctions";
import type { VehicleSpecsPreview } from "@/components/tools/NonStandardVehicleWarning";

const STORAGE_KEY = "colorpro-generations";
const FREE_LIMIT = 2;

/** Resilient email retrieval — falls back through getSession and refreshSession
 *  when getUser fails (common on mobile private browsers with stale localStorage). */
const getUserEmail = async (): Promise<string | undefined> => {
  const { data: { user } } = await supabase.auth.getUser();
  if (user?.email) return user.email;

  const { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.email) return session.user.email;

  const refreshResult = await supabase.auth.refreshSession();
  if (refreshResult.data?.session?.user?.email) return refreshResult.data.session.user.email;

  console.warn('[ColorPro] getUserEmail: all attempts failed — edge function JWT fallback will be used');
  return undefined;
};

/** Canonical view display order — driver side first */
const VIEW_ORDER = ['side', 'driver-side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];

export type FinishType = 'Gloss' | 'Satin' | 'Matte' | 'Flip' | 'Brushed' | 'Textured' | 'Chrome' | 'Specialty' | 'All';

export const useColorProLogic = () => {
  const { checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const [selectedSwatch, setSelectedSwatch] = useState<InkFusionColor | null>(null);
  const [selectedFinish, setSelectedFinish] = useState<FinishType>('Gloss');
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [nonStandardSpecs, setNonStandardSpecs] = useState<VehicleSpecsPreview | null>(null);
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [generationCount, setGenerationCount] = useState(0);
  const [hasReachedLimit, setHasReachedLimit] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [allViews, setAllViews] = useState<Array<{ type: string; url: string }>>([]);
  const [isGeneratingAdditional, setIsGeneratingAdditional] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [vinylSwatches, setVinylSwatches] = useState<VinylSwatch[]>([]);

  const remainingGenerations = Math.max(0, FREE_LIMIT - generationCount);

  useEffect(() => {
    const count = parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10);
    setGenerationCount(count);
    setHasReachedLimit(false); // Always allow generation; limits handled by subscriptions

    // Load vinyl swatches from database
    loadAllVinylSwatches().then(swatches => {
      setVinylSwatches(swatches);
    }).catch(err => {
      console.error('Failed to load vinyl swatches:', err);
    });
  }, []);

  const generateRender = async (options?: { graphicsProPrompt?: string; modeType?: string; viewType?: string; referenceImageUrl?: string | null; revisionPrompt?: string; originalRenderUrl?: string }) => {
    // GraphicsPro mode allows generating without a swatch (AI selects based on prompt)
    const isGraphicsProMode = options?.modeType === 'GraphicsPro' && options?.graphicsProPrompt;

    if (!isGraphicsProMode && (!selectedSwatch || !year || !make || !model)) {
      return { success: false, error: "Missing required fields" };
    }

    if (isGraphicsProMode && (!year || !make || !model)) {
      return { success: false, error: "Missing vehicle details" };
    }

    // Use provided viewType or default to 'side' (driver side)
    const selectedViewType = options?.viewType || 'side';

    // Check subscription limits
    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return { success: false, error: "Subscription limit reached" };
    }

    setIsGenerating(true);
    setGeneratedImageUrl(null);
    setAllViews([]);

    try {
      // Get user email for gallery storage (resilient to mobile private browser)
      const userEmail = await getUserEmail();

      // GraphicsPro mode: prompt-based, swatch optional
      // ColorPro mode: swatch required
      const useGraphicsPro = options?.modeType === 'GraphicsPro' && options?.graphicsProPrompt;

      let colorDataPayload: Record<string, any> = {};
      let derivedManufacturer = '';

      if (selectedSwatch) {
        // Generate only the hood_detail view initially for color accuracy
        // Extract manufacturer - prioritize explicit manufacturer field, then derive from colorLibrary
        const swatchManufacturer = (selectedSwatch as any).manufacturer;
        derivedManufacturer = swatchManufacturer || '';

        if (!derivedManufacturer && selectedSwatch.colorLibrary) {
          const lib = selectedSwatch.colorLibrary.toLowerCase();
          if (lib.includes('avery') || lib === 'avery_sw900') derivedManufacturer = 'Avery Dennison';
          else if (lib.includes('3m') || lib === '3m_2080') derivedManufacturer = '3M';
          else if (lib.includes('hexis')) derivedManufacturer = 'Hexis';
          else if (lib.includes('kpmf')) derivedManufacturer = 'KPMF';
          else if (lib.includes('oracal')) derivedManufacturer = 'Oracal';
          else if (lib.includes('inozetek')) derivedManufacturer = 'Inozetek';
          else if (lib.includes('arlon')) derivedManufacturer = 'Arlon';
          else if (lib.includes('teckwrap')) derivedManufacturer = 'TeckWrap';
          else if (lib.includes('vvivid')) derivedManufacturer = 'VViViD';
        }

        // Check if this is a database-matched swatch (from upload with verified match)
        const swatchId = (selectedSwatch as any).swatchId || (selectedSwatch as any).id;
        const isVerifiedMatch = (selectedSwatch as any).isVerifiedMatch || false;

        console.log('🎨 ColorPro render request:', {
          colorName: selectedSwatch.name,
          hex: selectedSwatch.hex,
          colorLibrary: selectedSwatch.colorLibrary,
          manufacturer: derivedManufacturer,
          swatchManufacturer,
          swatchId,
          isVerifiedMatch
        });

        // Build colorData payload - conditionally include hex
        colorDataPayload = {
          colorName: selectedSwatch.name,
          finish: selectedFinish.toLowerCase(),
          colorLibrary: selectedSwatch.colorLibrary || 'colorpro',
          manufacturer: derivedManufacturer,
          productCode: (selectedSwatch as any).productCode || null,
          verified: (selectedSwatch as any).verified || false,
          swatchImageUrl: selectedSwatch.swatchImageUrl,
          // Critical: pass swatchId for database lookup of verified material profile
          swatchId: swatchId || null,
          isVerifiedMatch: isVerifiedMatch,
          materialProfile: (selectedSwatch as any).materialProfile || null,
        };

        // CRITICAL: Only include hex if NOT a verified manufacturer match
        // Verified matches must use materialProfile from database - hex causes fallback behavior
        if (!isVerifiedMatch) {
          colorDataPayload.hex = selectedSwatch.hex;
        } else {
          console.log('🎯 Verified manufacturer swatch - excluding hex from request payload');
        }
      } else if (useGraphicsPro) {
        // GraphicsPro mode without swatch - AI will auto-select films based on prompt
        console.log('🎨 GraphicsPro prompt-only mode:', options.graphicsProPrompt);
        colorDataPayload = {
          finish: selectedFinish.toLowerCase(),
          colorLibrary: 'colorpro',
        };
      }

      // Add GraphicsPro prompt to colorData if enabled
      if (useGraphicsPro) {
        colorDataPayload.customStylingPrompt = options.graphicsProPrompt;
        if (options.referenceImageUrl) {
          colorDataPayload.referenceImageUrl = options.referenceImageUrl;
        }
      }

      // Route non-standard vehicle types (motorcycle/boat/bus/rv) to their
      // dedicated edge functions. Cars/trucks/SUVs/vans stay on the locked
      // golden pipeline (generate-color-render).
      const renderFunction = getRenderFunctionForType(vehicleType);
      const { data, error } = await renderClient.functions.invoke(renderFunction, {
        body: {
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          colorData: colorDataPayload,
          modeType: useGraphicsPro ? 'GraphicsPro' : 'ColorPro',
          viewType: selectedViewType,
          userEmail, // Pass user email for gallery storage
          ...(options?.revisionPrompt ? { revisionPrompt: options.revisionPrompt } : {}),
          ...(options?.originalRenderUrl ? { originalRenderUrl: options.originalRenderUrl } : {})
        }
      });

      if (error) {
        console.error("Edge function error:", error);
        toast({
          title: "Generation Failed",
          description: error.message || "Edge function returned an error. Check console for details.",
          variant: "destructive"
        });
        throw error;
      }

      if (data?.renderUrl) {
        const newViews = [{ type: selectedViewType, url: data.renderUrl }];
        setGeneratedImageUrl(data.renderUrl);
        setVisualizationId(data.renderId);
        setAllViews(newViews);

        // Capture non-standard vehicle spec metadata for proof-stage validation banner
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

        // Persist to localStorage
        localStorage.setItem('inkfusion_last_render', JSON.stringify({
          views: newViews,
          timestamp: Date.now()
        }));

        // Increment render count after successful generation
        await incrementRenderCount();

        toast({
          title: "Render Generated!",
          description: "Your vehicle render is ready.",
        });

        return { success: true, imageUrl: data.renderUrl };
      }

      toast({
        title: "Generation Failed",
        description: "No image URL was returned from the render engine.",
        variant: "destructive"
      });
      return { success: false, error: "No image URL returned" };
    } catch (error: any) {
      console.error("🚨 Generation error:", error);
      toast({
        title: "Generation Failed",
        description: error.message || "An unexpected error occurred. Check console for details.",
        variant: "destructive"
      });
      return { success: false, error: error.message };
    } finally {
      setIsGenerating(false);
    }
  };

  const [pendingViews, setPendingViews] = useState<string[]>([]);

  const generateAdditionalViews = async (options?: { graphicsProPrompt?: string; modeType?: string; referenceImageUrl?: string | null }) => {
    const isGraphicsProMode = options?.modeType === 'GraphicsPro' && options?.graphicsProPrompt;

    // GraphicsPro mode: swatch is optional, but vehicle required
    // Standard mode: swatch AND vehicle required
    if (!isGraphicsProMode && !selectedSwatch) {
      return { success: false, error: "Missing required fields" };
    }
    if (!year || !make || !model) {
      return { success: false, error: "Missing vehicle details" };
    }

    setIsGeneratingAdditional(true);
    const additionalViewTypes = ['passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
    setPendingViews(additionalViewTypes);

    try {
      // Get user email for gallery storage (resilient to mobile private browser)
      const userEmail = await getUserEmail();

      // ── INSTANT MIRROR: passenger-side from driver side ──
      // Mirror is instant (canvas flip) and guarantees design consistency.
      // If the design has text, send the mirror through AI to fix text direction.
      const driverSideView = allViews.find((v) => v.type === "side" || v.type === "driver-side");
      let passengerMirrorDone = false;
      if (driverSideView?.url) {
        try {
          console.log("[ColorPro] Generating passenger-side via INSTANT_MIRROR of driver side");
          const mirrorDataUrl = await generatePassengerMirror(driverSideView.url);
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          const userId = currentUser?.id || "anonymous";
          let mirrorUrl = await uploadMirrorToStorage(supabase, mirrorDataUrl, userId);

          // If design likely has text, fix it via AI
          const hasText = designLikelyHasText({
            modeType: options?.modeType,
            prompt: isGraphicsProMode ? options?.graphicsProPrompt : undefined,
          });
          if (hasText) {
            console.log("[ColorPro] Design has text — sending mirror to AI for text correction");
            mirrorUrl = await fixMirrorText(mirrorUrl, {
              vehicleYear: year,
              vehicleMake: make,
              vehicleModel: model,
              toolType: isGraphicsProMode ? "GraphicsPro" : "ColorPro",
              invokeEdgeFunction: async (fnName, body) => {
                const { data, error } = await withTimeout(
                  renderClient.functions.invoke(fnName, { body }),
                  VIEW_RENDER_TIMEOUT_MS,
                  `${fnName} text-fix`
                );
                return { data, error };
              },
            });
          }

          const passengerView = { type: "passenger-side", url: mirrorUrl };
          setAllViews((prev) => {
            const exists = prev.some((v) => v.type === "passenger-side");
            if (exists) return prev;
            const updated = [...prev, passengerView];
            updated.sort((a, b) => {
              const aIdx = VIEW_ORDER.indexOf(a.type);
              const bIdx = VIEW_ORDER.indexOf(b.type);
              return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
            });
            return updated;
          });
          setPendingViews((prev) => prev.filter((v) => v !== "passenger-side"));
          passengerMirrorDone = true;
          console.log("[ColorPro] passenger-side mirror OK");
        } catch (mirrorErr) {
          console.error("[ColorPro] passenger-side mirror failed, falling back to AI:", mirrorErr);
        }
      }

      // Filter out passenger-side from AI views if mirror succeeded
      const aiViewTypes = passengerMirrorDone
        ? additionalViewTypes.filter((v) => v !== "passenger-side")
        : additionalViewTypes;

      // Use same manufacturer derivation as initial render (only for non-GraphicsPro mode)
      let derivedManufacturer = '';
      if (selectedSwatch) {
        const swatchManufacturer = (selectedSwatch as any).manufacturer;
        derivedManufacturer = swatchManufacturer || '';

        if (!derivedManufacturer && selectedSwatch.colorLibrary) {
          const lib = selectedSwatch.colorLibrary.toLowerCase();
          if (lib.includes('avery') || lib === 'avery_sw900') derivedManufacturer = 'Avery Dennison';
          else if (lib.includes('3m') || lib === '3m_2080') derivedManufacturer = '3M';
          else if (lib.includes('hexis')) derivedManufacturer = 'Hexis';
          else if (lib.includes('kpmf')) derivedManufacturer = 'KPMF';
          else if (lib.includes('oracal')) derivedManufacturer = 'Oracal';
          else if (lib.includes('inozetek')) derivedManufacturer = 'Inozetek';
          else if (lib.includes('arlon')) derivedManufacturer = 'Arlon';
          else if (lib.includes('teckwrap')) derivedManufacturer = 'TeckWrap';
          else if (lib.includes('vvivid')) derivedManufacturer = 'VViViD';
        }
      }

      const generatedViews: Array<{ type: string; url: string }> = [...allViews];

      // Check if this is a verified database match (only relevant for non-GraphicsPro mode)
      const swatchId = selectedSwatch ? ((selectedSwatch as any).swatchId || (selectedSwatch as any).id) : null;
      const isVerifiedMatch = selectedSwatch ? ((selectedSwatch as any).isVerifiedMatch || false) : false;

      // PARALLEL execution with retry per view
      const viewResults = await Promise.all(
        aiViewTypes.map(async (viewType) => {
          // Build colorDataPayload - handle both GraphicsPro and standard modes
          let colorDataPayload: Record<string, any>;
          let useModeType: string;

          if (isGraphicsProMode) {
            colorDataPayload = {
              colorName: 'GraphicsPro Custom',
              finish: 'custom',
              colorLibrary: 'colorpro',
              manufacturer: '',
              customStylingPrompt: options?.graphicsProPrompt,
              ...(options?.referenceImageUrl && { referenceImageUrl: options.referenceImageUrl }),
            };
            useModeType = 'GraphicsPro';
          } else {
            colorDataPayload = {
              colorName: selectedSwatch!.name,
              finish: selectedFinish.toLowerCase(),
              colorLibrary: selectedSwatch!.colorLibrary || 'colorpro',
              manufacturer: derivedManufacturer,
              swatchImageUrl: selectedSwatch!.swatchImageUrl,
              swatchId: swatchId || null,
              isVerifiedMatch: isVerifiedMatch,
              materialProfile: (selectedSwatch as any)?.materialProfile || null,
              // Hero render from driver-side is passed so the edge function can
              // anchor color/lighting across the remaining views and stop Gemini
              // from drifting to a different shade on each angle.
              ...(driverSideView?.url ? { heroReferenceUrl: driverSideView.url } : {}),
            };

            if (!isVerifiedMatch) {
              colorDataPayload.hex = selectedSwatch!.hex;
            } else {
              console.log(`🎯 Verified manufacturer swatch (${viewType} view) - excluding hex`);
            }
            useModeType = 'ColorPro';
          }

          try {
            const { data, error } = await withTimeout(
              renderClient.functions.invoke('generate-color-render', {
                body: {
                  vehicleYear: year,
                  vehicleMake: make,
                  vehicleModel: model,
                  colorData: colorDataPayload,
                  modeType: useModeType,
                  viewType,
                  userEmail,
                  skipLookups: true,
                  ...(isGraphicsProMode && { customStylingPrompt: options?.graphicsProPrompt }),
                }
              }),
              VIEW_RENDER_TIMEOUT_MS,
              `${viewType} view`
            );

            if (error) {
              console.error(`❌ View ${viewType} failed:`, error.message || error);
              setPendingViews(prev => prev.filter(v => v !== viewType));
              return null;
            }

            if (data?.renderUrl) {
              const newView = { type: viewType, url: data.renderUrl };
              generatedViews.push(newView);
              // Update views progressively — sort in canonical order
              setAllViews(prev => {
                const exists = prev.some(v => v.type === viewType);
                if (exists) return prev;
                const updated = [...prev, newView];
                updated.sort((a, b) => {
                  const aIdx = VIEW_ORDER.indexOf(a.type);
                  const bIdx = VIEW_ORDER.indexOf(b.type);
                  return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
                });
                return updated;
              });
              setPendingViews(prev => prev.filter(v => v !== viewType));
              return newView;
            }
            setPendingViews(prev => prev.filter(v => v !== viewType));
            return null;
          } catch (viewError) {
            console.error(`❌ View ${viewType} threw:`, viewError);
            setPendingViews(prev => prev.filter(v => v !== viewType));
            return null;
          }
        })
      );

      const successCount = viewResults.filter(v => v !== null).length;
      const failCount = additionalViewTypes.length - successCount;
      if (failCount > 0 && successCount > 0) {
        toast({
          title: `${successCount} of ${additionalViewTypes.length} views generated`,
          description: `${failCount} view(s) failed. You can try generating again.`,
        });
      } else if (successCount === 0) {
        toast({
          title: "Views generation failed",
          description: "Could not generate additional views. Please try again.",
          variant: "destructive",
        });
      }

      // Sort final views in canonical order
      generatedViews.sort((a, b) => {
        const aIdx = VIEW_ORDER.indexOf(a.type);
        const bIdx = VIEW_ORDER.indexOf(b.type);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
      });

      // Persist to localStorage
      localStorage.setItem('inkfusion_last_render', JSON.stringify({
        views: generatedViews,
        timestamp: Date.now()
      }));

      // ── LOCKED SEQUENTIAL: 2D Proof FIRST → Artboard FROM proof ──
      // DO NOT CHANGE without Trish approval. Artboard MUST use 2D proof
      // as source — proof has dimensions. Without it, artboard drifts.
      if (visualizationId && generatedImageUrl) {
        const allViewUrls: Record<string, string> = {};
        for (const view of generatedViews) allViewUrls[view.type] = view.url;
        const vehicleName = `${year} ${make} ${model}`.trim();
        const colorName = (selectedSwatch as any)?.name || 'Custom Color';
        const proofBody = { allViewUrls, vehicleYear: year, vehicleMake: make, vehicleModel: model, designName: colorName, finish: selectedFinish };

        console.log(`[ColorPro] Phase 4a: 2D proof from ${generatedViews.length} locked views...`);
        (async () => {
          try {
            const { data: proofData, error: proofErr } = await renderClient.functions.invoke('generate-2d-proof', { body: proofBody });
            const proofUrl = proofData?.proofUrl || proofData?.url;
            if (proofErr || !proofUrl) { console.warn('[ColorPro] 2D proof failed:', proofErr?.message || 'no URL'); return; }
            await saveProofUrlToViz(visualizationId, proofUrl);
            console.log('[ColorPro] Phase 4a complete — 2D proof saved');

            console.log('[ColorPro] Phase 4b: artboard from 2D proof (deterministic)...');
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
              if (!abRes.ok) console.warn('[ColorPro] artboard cache write failed:', abRes.vizError);
              else console.log('[ColorPro] Phase 4b complete — artboard saved');
            }
          } catch (e) { console.warn('[ColorPro] Phase 4 error (non-fatal):', e); }
        })();
      }

      return { success: true, views: generatedViews };
    } catch (error: any) {
      console.error("Additional views generation error:", error);
      return { success: false, error: error.message };
    } finally {
      setIsGeneratingAdditional(false);
      setPendingViews([]);
    }
  };

  // Regenerate a single view (e.g., if AI messed up one angle)
  const regenerateSingleView = async (viewType: string) => {
    if (!selectedSwatch || !year || !make || !model) return;

    setPendingViews([viewType]);
    try {
      const userEmail = await getUserEmail();
      const swatchManufacturer = (selectedSwatch as any).manufacturer || '';
      let derivedManufacturer = swatchManufacturer;
      if (!derivedManufacturer && selectedSwatch.colorLibrary) {
        const lib = selectedSwatch.colorLibrary.toLowerCase();
        if (lib.includes('avery') || lib === 'avery_sw900') derivedManufacturer = 'Avery Dennison';
        else if (lib.includes('3m') || lib === '3m_2080') derivedManufacturer = '3M';
        else if (lib.includes('hexis')) derivedManufacturer = 'Hexis';
        else if (lib.includes('kpmf')) derivedManufacturer = 'KPMF';
        else if (lib.includes('oracal')) derivedManufacturer = 'Oracal';
        else if (lib.includes('inozetek')) derivedManufacturer = 'Inozetek';
        else if (lib.includes('arlon')) derivedManufacturer = 'Arlon';
        else if (lib.includes('teckwrap')) derivedManufacturer = 'TeckWrap';
        else if (lib.includes('vvivid')) derivedManufacturer = 'VViViD';
      }

      const swatchId = (selectedSwatch as any).swatchId || (selectedSwatch as any).id || null;
      const isVerifiedMatch = (selectedSwatch as any).isVerifiedMatch || false;

      const colorDataPayload: Record<string, any> = {
        colorName: selectedSwatch.name,
        finish: selectedFinish.toLowerCase(),
        colorLibrary: selectedSwatch.colorLibrary || 'colorpro',
        manufacturer: derivedManufacturer,
        swatchImageUrl: selectedSwatch.swatchImageUrl,
        swatchId,
        isVerifiedMatch,
        materialProfile: (selectedSwatch as any)?.materialProfile || null,
      };
      if (!isVerifiedMatch) colorDataPayload.hex = selectedSwatch.hex;

      const { data, error } = await withTimeout(
        renderClient.functions.invoke('generate-color-render', {
          body: {
            vehicleYear: year,
            vehicleMake: make,
            vehicleModel: model,
            colorData: colorDataPayload,
            modeType: 'ColorPro',
            viewType,
            userEmail,
            skipCache: true,
          }
        }),
        VIEW_RENDER_TIMEOUT_MS,
        `${viewType} retry`
      );

      if (!error && data?.renderUrl) {
        setAllViews(prev => {
          const updated = prev.map(v => v.type === viewType ? { type: viewType, url: data.renderUrl } : v);
          return updated;
        });
        toast({ title: `${viewType} view regenerated` });
      } else {
        toast({ title: `Failed to regenerate ${viewType}`, variant: "destructive" });
      }
    } catch (err: any) {
      console.error(`Retry ${viewType} failed:`, err);
      toast({ title: `Failed to regenerate ${viewType}`, variant: "destructive" });
    } finally {
      setPendingViews([]);
    }
  };

  const getDefaultRenderForColor = async (colorId: string): Promise<string | null> => {
    try {
      const { data, error } = await supabase
        .from('vehicle_render_images')
        .select('image_url')
        .eq('swatch_id', colorId)
        .eq('vehicle_type', 'roof')
        .eq('is_active', true)
        .limit(1);

      if (error || !data || data.length === 0) return null;
      return data[0].image_url;
    } catch {
      return null;
    }
  };

  const incrementGeneration = () => {
    const newCount = generationCount + 1;
    localStorage.setItem(STORAGE_KEY, newCount.toString());
    setGenerationCount(newCount);
    setHasReachedLimit(false);
  };


  const clearLastRender = () => {
    localStorage.removeItem('inkfusion_last_render');
    setAllViews([]);
    setGeneratedImageUrl(null);
  };

  /** Load a previously saved render by its color_visualizations ID */
  const loadRenderById = async (renderId: string) => {
    try {
      const { data, error } = await supabase
        .from('color_visualizations')
        .select('*')
        .eq('id', renderId)
        .single();

      if (error || !data) {
        console.error('[ColorPro] loadRenderById failed:', error);
        return;
      }

      // Populate vehicle info
      if (data.vehicle_year) setYear(String(data.vehicle_year));
      if (data.vehicle_make) setMake(data.vehicle_make);
      if (data.vehicle_model) setModel(data.vehicle_model);
      if (data.finish_type) setSelectedFinish(data.finish_type as FinishType);

      // Build swatch from stored color data
      if (data.color_name || data.color_hex) {
        setSelectedSwatch({
          name: data.color_name || 'Custom',
          hex: data.color_hex || '#000000',
          colorLibrary: (data as any).color_library || 'colorpro',
          swatchImageUrl: '',
        } as InkFusionColor);
      }

      // Build views from render_urls
      const renderUrls = data.render_urls as Record<string, string> | null;
      if (renderUrls && typeof renderUrls === 'object') {
        const views = Object.entries(renderUrls)
          .filter(([, url]) => typeof url === 'string' && url.startsWith('http'))
          .map(([type, url]) => ({ type, url }));

        if (views.length > 0) {
          setAllViews(views);
          // Pick hero or side as the primary display image
          const hero = views.find(v => v.type === 'hero') || views.find(v => v.type === 'side') || views[0];
          setGeneratedImageUrl(hero.url);
          setVisualizationId(data.id);
        }
      }
    } catch (err) {
      console.error('[ColorPro] loadRenderById error:', err);
    }
  };

  return {
    selectedSwatch,
    setSelectedSwatch,
    selectedFinish,
    setSelectedFinish,
    vehicleType,
    setVehicleType,
    nonStandardSpecs,
    setNonStandardSpecs,
    year,
    setYear,
    make,
    setMake,
    model,
    setModel,
    hasReachedLimit,
    remainingGenerations,
    incrementGeneration,
    showFallback,
    setShowFallback,
    isGenerating,
    generatedImageUrl,
    visualizationId,
    generateRender,
    getDefaultRenderForColor,
    allViews,
    generateAdditionalViews,
    regenerateSingleView,
    isGeneratingAdditional,
    clearLastRender,
    showUpgradeModal,
    setShowUpgradeModal,
    vinylSwatches,
    pendingViews,
    loadRenderById,
  };
};
