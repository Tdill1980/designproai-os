import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { saveArtboardUrlToViz } from "@/lib/save-artboard-url";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import { saveProofUrlToViz } from "@/lib/save-proof-url";
import { toast } from "@/hooks/use-toast";
import { parseGraphicsProLabel, detectFinishFromPrompt, detectManufacturerFromPrompt } from "@/lib/graphicspro-label-parser";
import { withTimeout, VIEW_RENDER_TIMEOUT_MS } from "@/lib/invokeWithTimeout";
import { buildProductionPanels } from "@/lib/buildProductionPanels";
import { producePassengerView, uploadMirrorToStorage } from "@/utils/passenger-mirror";
import { type VehicleType } from "@/components/tools/VehicleTypeSelector";
import { getRenderFunctionForType } from "@/components/tools/legacyRenderFunctions";
import type { VehicleSpecsPreview } from "@/components/tools/NonStandardVehicleWarning";

const STORAGE_KEY = "graphicspro-generations";

/** Canonical view display order - driver side first */
const VIEW_ORDER = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];

export type ViewType = 'hood_detail' | 'side' | 'front' | 'rear' | 'roof';

/** Real per-surface vehicle dimensions (inches) resolved by the GENIE
 *  Universal Panelizer (`panelizer-step-validate`, estimateOnly mode).
 *  `source` records where the numbers came from — `google_search` means the
 *  vehicle wasn't in the internal DB and GENIE grounded it via Google, then
 *  wrote it back to `vehicle_dimensions` for next time. */
export interface VehicleDims {
  source: string;        // database | csv | google_search | trailer | default
  found: boolean;
  sideW?: number; sideH?: number;
  hoodW?: number; hoodL?: number;
  roofW?: number; roofL?: number;
  backW?: number; backH?: number;
  totalSqFt?: number;
}

/** Wrap method controls how the AI interprets the design.
 *  - 'cut'     → solid-color cut vinyl film (single/two-tone, racing stripes,
 *                chrome delete, etc). What GraphicsPro V1 has always done.
 *  - 'printed' → digitally printed full-color graphic on vinyl with cut
 *                contour (logos, multi-color art, business graphics like
 *                Mike's Mobile Detailing). NOT a manufacturer film. */
export type WrapMethod = 'cut' | 'printed';

/** Finish override — when set to anything other than 'auto' the user is
 *  explicitly choosing the film finish, and the prompt parser stops
 *  trying to guess it from prompt text. */
export type FinishOverride = 'auto' | 'gloss' | 'satin' | 'matte' | 'chrome' | 'carbon' | 'metallic';

// Helper to get user email with robust retry
const getUserEmail = async (): Promise<string | null> => {
  // First attempt - check current session
  let { data: { session } } = await supabase.auth.getSession();
  if (session?.user?.email) {
    return session.user.email;
  }

  // Second attempt - try getUser
  let { data: { user } } = await supabase.auth.getUser();
  if (user?.email) {
    return user.email;
  }

  // Third attempt - refresh session
  const refreshResult = await supabase.auth.refreshSession();
  if (refreshResult.data?.session?.user?.email) {
    return refreshResult.data.session.user.email;
  }

  // Final attempts with delays (3 retries, 300ms apart)
  for (let i = 0; i < 3; i++) {
    await new Promise(resolve => setTimeout(resolve, 300));
    const result = await supabase.auth.getSession();
    if (result.data?.session?.user?.email) {
      return result.data.session.user.email;
    }
  }

  console.warn('getUserEmail: All attempts failed to get user email');
  return null;
};

export const useGraphicsProLogic = () => {
  const { checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [nonStandardSpecs, setNonStandardSpecs] = useState<VehicleSpecsPreview | null>(null);
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [stylingPrompt, setStylingPrompt] = useState("");
  const [referenceImageUrl, setReferenceImageUrl] = useState<string | null>(null);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [selectedViewType, setSelectedViewType] = useState<ViewType>('side');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [allViews, setAllViews] = useState<Array<{ type: string; url: string }>>([]);
  const [isGeneratingAdditional, setIsGeneratingAdditional] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [pendingViews, setPendingViews] = useState<string[]>([]);
  const [isCloning, setIsCloning] = useState(false);
  const [vehicleDims, setVehicleDims] = useState<VehicleDims | null>(null);
  const [isFetchingDims, setIsFetchingDims] = useState(false);
  const [selectedPreset, setSelectedPreset] = useState<string | null>(null);
  const [styleDescription, setStyleDescription] = useState<string | null>(null);
  const [presetCategory, setPresetCategory] = useState<string | null>(null);
  // Default to cut vinyl (the existing GraphicsPro V1 behavior). Switching
  // to 'printed' tells the prompt builder to render full-color printed
  // graphics with cut contour, not a single-color manufacturer film.
  const [wrapMethod, setWrapMethod] = useState<WrapMethod>('cut');
  // 'auto' = let the parser guess finish from prompt text (legacy behavior,
  // now sane after the chrome auto-default fix). Anything else = explicit
  // user choice that overrides parser detection.
  const [finishOverride, setFinishOverride] = useState<FinishOverride>('auto');

  /** Resolves the finish the renderer should treat as authoritative.
   *  Explicit user choice always wins; only fall back to prompt sniffing
   *  when the user picked 'auto'. */
  const resolveFinish = (): string => {
    if (finishOverride !== 'auto') return finishOverride;
    return detectFinishFromPrompt(stylingPrompt);
  };

  /** Builds the final styling prompt sent to the edge function. Prepends
   *  explicit method + finish directives so the locked render pipeline
   *  doesn't have to infer them from free-text. We keep the user's prompt
   *  intact below the directive line so any creative intent is preserved. */
  const buildEffectiveStylingPrompt = (): string => {
    const finish = resolveFinish();
    const userText = stylingPrompt.trim();
    if (wrapMethod === 'printed') {
      // Printed-and-cut wrap: full-color digitally printed graphics with
      // a cut contour. This is the path for business/commercial wraps
      // like logos, multi-color art, fleet graphics — NOT a single
      // manufacturer film. Explicitly forbid chrome unless requested.
      const directives = [
        'Wrap method: digitally printed full-color graphic on vinyl with cut contour (printed-and-cut wrap, NOT single-color manufacturer film).',
        `Finish: ${finish}.`,
        'Do not render chrome film unless the user explicitly asks for chrome.',
      ].join(' ');
      return `${directives}\n\n${userText}`;
    }
    // Cut vinyl film: solid-color plotter-cut vinyl, no full-color print.
    const directives = [
      'Wrap method: solid-color cut vinyl film (single color or two-tone, plotter-cut, no printed graphics).',
      `Finish: ${finish}.`,
      'Do not render chrome film unless the user explicitly asks for chrome.',
    ].join(' ');
    return `${directives}\n\n${userText}`;
  };

  const generateRender = async (revisionPrompt?: string) => {
    if (!stylingPrompt?.trim()) {
      toast({
        title: "Enter a Style Prompt",
        description: "Describe your wrap design, e.g. 'top half gold chrome, bottom half satin black'",
        variant: "destructive"
      });
      return { success: false, error: "Missing styling prompt" };
    }

    if (!year || !make || !model) {
      toast({
        title: "Vehicle Required",
        description: "Please enter year, make, and model",
        variant: "destructive"
      });
      return { success: false, error: "Missing vehicle details" };
    }

    // Check subscription limits
    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return { success: false, error: "Subscription limit reached" };
    }

    setIsGenerating(true);

    // Don't clear views if this is a revision
    if (!revisionPrompt) {
      setGeneratedImageUrl(null);
      setAllViews([]);
    }

    try {
      const userEmail = await getUserEmail();

      if (!userEmail) {
        setShowLoginModal(true);
        return { success: false, error: "auth_required" };
      }

      console.log('🎨 GraphicsPro render request:', {
        prompt: stylingPrompt,
        vehicle: `${year} ${make} ${model}`,
        viewType: selectedViewType,
        revision: revisionPrompt ? 'YES' : 'NO'
      });

      const renderFunction = getRenderFunctionForType(vehicleType);
      const effectiveFinish = resolveFinish();
      const effectivePrompt = buildEffectiveStylingPrompt();
      const { data, error } = await renderClient.functions.invoke(renderFunction, {
        body: {
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          colorData: {
            colorName: parseGraphicsProLabel(stylingPrompt),
            finish: effectiveFinish,
            colorLibrary: 'graphicspro',
            manufacturer: detectManufacturerFromPrompt(stylingPrompt),
            customStylingPrompt: effectivePrompt,
            wrapMethod,
            ...(referenceImageUrl && { referenceImageUrl }),
            ...(referenceImageUrls.length > 0 && { referenceImageUrls }),
          },
          modeType: 'GraphicsPro',
          viewType: selectedViewType,
          userEmail,
          customStylingPrompt: effectivePrompt,
          wrapMethod,
          selectedPreset,
          styleDescription,
          presetCategory, // Pass to backend for stripe mode detection
          ...(revisionPrompt && { revisionPrompt }),
        }
      });

      if (error) {
        console.error("Edge function error:", error);
        toast({
          title: "Generation Failed",
          description: error.message || "Edge function returned an error.",
          variant: "destructive"
        });
        throw error;
      }

      // Handle print-required redirect
      if (data?.error === 'print_required') {
        return { success: false, error: 'print_required', message: data.message };
      }

      if (data?.renderUrl) {
        const newViews = [{ type: selectedViewType, url: data.renderUrl }];
        setGeneratedImageUrl(data.renderUrl);
        setVisualizationId(data.renderId);
        setAllViews(newViews);

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

        localStorage.setItem(STORAGE_KEY + '_last_render', JSON.stringify({
          views: newViews,
          timestamp: Date.now()
        }));

        await incrementRenderCount();

        toast({
          title: "Render Generated!",
          description: "Generating additional views...",
        });

        // Auto-generate additional views after initial render
        if (!revisionPrompt) {
          // Set pending views immediately for skeleton display
          const additionalViewTypes = ['passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'].filter(v => v !== selectedViewType);
          setPendingViews(additionalViewTypes);

          // Resolve real vehicle dimensions from the GENIE Universal Panelizer
          // in the background (Google-grounds + caches unknown vehicles). Pass
          // the fresh viz id so the dims persist onto the new row.
          fetchVehicleDims(data.renderId);

          // Trigger additional views generation (don't await - let it run in background)
          setTimeout(() => {
            generateAdditionalViewsInternal(userEmail, additionalViewTypes);
          }, 500);
        }

        return { success: true, imageUrl: data.renderUrl };
      }

      toast({
        title: "Generation Failed",
        description: "No image URL was returned.",
        variant: "destructive"
      });
      return { success: false, error: "No image URL returned" };
    } catch (error: any) {
      console.error("🚨 Generation error:", error);

      // Check for auth-related error messages
      if (error.message?.includes('userEmail') || error.message?.includes('anonymous') || error.message?.includes('SECURITY')) {
        setShowLoginModal(true);
        return { success: false, error: "auth_required" };
      }

      toast({
        title: "Generation Failed",
        description: error.message || "An unexpected error occurred.",
        variant: "destructive"
      });
      return { success: false, error: error.message };
    } finally {
      setIsGenerating(false);
    }
  };

  // Internal function for auto-generating additional views (called automatically after first render)
  const generateAdditionalViewsInternal = async (userEmail: string, requestedViewTypes: string[]) => {
    setIsGeneratingAdditional(true);

    // PASSENGER SIDE IS NEVER AN AI VIEW — it has exactly ONE producer,
    // producePassengerView (a deterministic flip of the driver side), run after
    // this fan-out. GraphicsPro used to ask generate-color-render for the
    // passenger angle with no check at all, so an AI result facing the driver
    // direction was accepted silently ("two driver sides"). A geometric flip
    // cannot face the wrong way. Do not put the passenger back in this array.
    const viewTypes = requestedViewTypes.filter(v => v !== 'passenger-side');
    const wantsPassenger = requestedViewTypes.includes('passenger-side');

    try {
      const generatedViews: Array<{ type: string; url: string }> = [...allViews];

      // Render ONE additional view. On success it pushes the view into state
      // (sorted) and clears its skeleton; on failure it returns null and LEAVES
      // the skeleton so the retry pass can keep trying. This is what makes the
      // full 7-view set actually land — a single parallel attempt drops views
      // whenever Gemini rate-limits/times out (the "only 3 views" bug).
      const renderOneView = async (viewType: string): Promise<{ type: string; url: string } | null> => {
        try {
          const { data, error } = await withTimeout(
            renderClient.functions.invoke('generate-color-render', {
              body: {
                vehicleYear: year,
                vehicleMake: make,
                vehicleModel: model,
                colorData: {
                  colorName: parseGraphicsProLabel(stylingPrompt),
                  finish: resolveFinish(),
                  colorLibrary: 'graphicspro',
                  manufacturer: detectManufacturerFromPrompt(stylingPrompt),
                  customStylingPrompt: buildEffectiveStylingPrompt(),
                  wrapMethod,
                  ...(referenceImageUrl && { referenceImageUrl }),
                  ...(referenceImageUrls.length > 0 && { referenceImageUrls }),
                },
                modeType: 'GraphicsPro',
                viewType,
                userEmail,
                customStylingPrompt: buildEffectiveStylingPrompt(),
                wrapMethod,
                skipLookups: true,
              }
            }),
            VIEW_RENDER_TIMEOUT_MS,
            `GraphicsPro ${viewType} view`
          );

          if (error) {
            console.error(`❌ GraphicsPro view ${viewType} failed:`, error.message || error);
            return null;
          }

          if (data?.renderUrl) {
            const newView = { type: viewType, url: data.renderUrl };
            generatedViews.push(newView);
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
          return null;
        } catch (viewError) {
          console.error(`❌ GraphicsPro view ${viewType} threw:`, viewError);
          return null;
        }
      };

      // Pass 1 — fire all additional views in parallel (fast when healthy).
      await Promise.all(viewTypes.map(renderOneView));

      // Pass 2 — RETRY whatever didn't land, sequentially with a small gap so we
      // don't re-trigger the same rate-limit burst. Up to 2 retry rounds. The
      // skeletons for failed views are still showing, so they fill in live.
      const stillMissing = () => viewTypes.filter(vt => !generatedViews.some(v => v.type === vt));
      for (let round = 0; round < 2; round++) {
        const missing = stillMissing();
        if (missing.length === 0) break;
        setPendingViews(missing);
        for (const vt of missing) {
          const ok = await renderOneView(vt);
          if (!ok) await new Promise(res => setTimeout(res, 500));
        }
      }

      // ── PASSENGER SIDE — the one producer: deterministic flip of the driver ──
      if (wantsPassenger) {
        const driverUrl =
          generatedViews.find(v => v.type === 'side')?.url ||
          (selectedViewType === 'side' ? generatedImageUrl : undefined);
        const passengerUrl = driverUrl
          ? await producePassengerView({
              driverUrl,
              uploadDataUrl: async (dataUrl) => {
                const { data: { user } } = await supabase.auth.getUser();
                return uploadMirrorToStorage(supabase, dataUrl, user?.id || 'anonymous');
              },
              textDetection: { modeType: 'graphicspro', prompt: buildEffectiveStylingPrompt() },
              vehicleYear: year,
              vehicleMake: make,
              vehicleModel: model,
              toolType: 'GraphicsPro',
              invokeEdgeFunction: async (fnName, body) => {
                const { data, error } = await renderClient.functions.invoke(fnName, { body });
                return { data, error };
              },
              logLabel: 'GraphicsPro',
            })
          : null;
        if (passengerUrl) {
          const passengerView = { type: 'passenger-side', url: passengerUrl };
          generatedViews.push(passengerView);
          setAllViews(prev => {
            if (prev.some(v => v.type === 'passenger-side')) return prev;
            const updated = [...prev, passengerView];
            updated.sort((a, b) => {
              const aIdx = VIEW_ORDER.indexOf(a.type);
              const bIdx = VIEW_ORDER.indexOf(b.type);
              return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
            });
            return updated;
          });
        }
        setPendingViews(prev => prev.filter(v => v !== 'passenger-side'));
      }

      // Clear skeletons for any views that ultimately couldn't be generated.
      const finalMissing = stillMissing();
      setPendingViews(prev => prev.filter(v => !finalMissing.includes(v)));

      const failCount = finalMissing.length;

      // ── PERSIST ALL VIEWS TO THE DB ──
      // generate-color-render only stores the FIRST (hero) view on the
      // color_visualizations row when it creates it. The other 6 angles were
      // living ONLY in this session's state + localStorage, so RevisionStudio
      // (which reads color_visualizations.render_urls) showed "1 of 7" and then
      // failed to regenerate them. Merge every completed angle back onto the row
      // so all 7 views flow into RevisionStudio, proofs, and panels — no
      // regeneration required. Also save the effective styling prompt so any
      // later "Generate Missing Views" can faithfully reproduce the design.
      if (visualizationId && generatedViews.length > 0) {
        try {
          const { data: existingRow } = await supabase
            .from('color_visualizations')
            .select('render_urls')
            .eq('id', visualizationId)
            .maybeSingle();
          const mergedUrls: Record<string, string> = {
            ...(((existingRow as any)?.render_urls as Record<string, string>) || {}),
          };
          for (const v of generatedViews) if (v?.url) mergedUrls[v.type] = v.url;
          await supabase
            .from('color_visualizations')
            .update({
              render_urls: mergedUrls,
              custom_styling_prompt_key: buildEffectiveStylingPrompt(),
              updated_at: new Date().toISOString(),
            } as any)
            .eq('id', visualizationId);
          console.log(`[GraphicsPro] Persisted ${Object.keys(mergedUrls).length} view(s) to color_visualizations.render_urls`);
        } catch (persistErr) {
          console.warn('[GraphicsPro] Failed to persist views to render_urls (non-fatal):', persistErr);
        }
      }

      localStorage.setItem(STORAGE_KEY + '_last_render', JSON.stringify({
        views: generatedViews,
        timestamp: Date.now()
      }));

      toast({
        title: failCount === 0 ? "All Views Ready!" : "Views Generated",
        description: failCount === 0 ? `${viewTypes.length} view renders completed.` : `${viewTypes.length - failCount} of ${viewTypes.length} views completed. ${failCount} failed.`,
        variant: failCount === viewTypes.length ? "destructive" : "default",
      });

      // ── LOCKED SEQUENTIAL: 2D Proof FIRST → Artboard FROM proof ──
      // DO NOT CHANGE without Trish approval. Artboard MUST use 2D proof
      // as source — proof has dimensions. Without it, artboard drifts.
      if (visualizationId && generatedImageUrl) {
        const allViewUrls: Record<string, string> = {};
        for (const view of generatedViews) allViewUrls[view.type] = view.url;
        const vehicleName = `${year} ${make} ${model}`.trim();
        const proofBody = { allViewUrls, vehicleYear: year, vehicleMake: make, vehicleModel: model, designName: parseGraphicsProLabel(stylingPrompt), finish: resolveFinish() };

        console.log(`[GraphicsPro] Phase 4a: 2D proof from ${generatedViews.length} locked views...`);
        (async () => {
          try {
            const { data: proofData, error: proofErr } = await renderClient.functions.invoke('generate-2d-proof', { body: proofBody });
            const proofUrl = proofData?.proofUrl || proofData?.url;
            if (proofErr || !proofUrl) { console.warn('[GraphicsPro] 2D proof failed:', proofErr?.message || 'no URL'); return; }
            await saveProofUrlToViz(visualizationId, proofUrl);
            console.log('[GraphicsPro] Phase 4a complete — 2D proof saved');

            // ── SHARED VAULT CONNECTION (2026-07-22): route GraphicsPro's per-side
            // print panels through the ONE sanctioned chain (buildProductionPanels →
            // production_flow_assets), the same wiring RecreatePro uses. The 8th call
            // above emits the CONTINUOUS branded/clean flat artboards — previously
            // dropped on the floor here — which the shared builder gridslices at
            // GENIE dims + 5" mirror bleed (PNG, provenance-stamped), so PanelPro
            // Studio Board / QC / the 1500-DPI print worker see GraphicsPro jobs
            // like every other tool's. Cut/contour files remain GraphicsPro-native.
            // Fire-and-forget and additive: it never touches the LOCKED proof →
            // artboard sequence below, and with no artboard it honestly builds 0
            // (never AI-invents one).
            const abBranded: string | null = proofData?.artboardBrandedUrl || null;
            const abClean: string | null = proofData?.artboardCleanUrl || null;
            if (abBranded || abClean) {
              void buildProductionPanels({
                gid: visualizationId, make, model, year, allViewUrls,
                artboardBrandedUrl: abBranded, artboardCleanUrl: abClean,
                finish: resolveFinish(),
              })
                .then((r) => console.log(`[GraphicsPro] shared-vault panels: built ${r.built}${r.reason ? ` (${r.reason})` : ''}`))
                .catch((e) => console.warn('[GraphicsPro] shared-vault panel build failed (non-fatal):', e?.message));
            } else {
              console.warn('[GraphicsPro] 2D proof emitted no continuous artboard — no vault panels this run (honest gap, nothing invented)');
            }

            console.log('[GraphicsPro] Phase 4b: artboard from 2D proof (deterministic)...');
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
              if (!abRes.ok) console.warn('[GraphicsPro] artboard cache write failed:', abRes.vizError);
              else console.log('[GraphicsPro] Phase 4b complete — artboard saved');
            }
          } catch (e) { console.warn('[GraphicsPro] Phase 4 error (non-fatal):', e); }
        })();
      }

      return { success: true, views: generatedViews };
    } catch (error: any) {
      console.error("Additional views generation error:", error);
      toast({
        title: "Some Views Failed",
        description: "Primary view is ready. Try generating additional views manually.",
        variant: "destructive"
      });
      return { success: false, error: error.message };
    } finally {
      setIsGeneratingAdditional(false);
      setPendingViews([]);
    }
  };

  // Manual trigger for generating additional views (if needed)
  const generateAdditionalViews = async () => {
    if (!stylingPrompt?.trim() || !year || !make || !model) {
      return { success: false, error: "Missing required fields" };
    }

    const userEmail = await getUserEmail();
    if (!userEmail) {
      setShowLoginModal(true);
      return { success: false, error: "auth_required" };
    }

    const additionalViewTypes = ['passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'].filter(v => v !== selectedViewType);
    setPendingViews(additionalViewTypes);

    return generateAdditionalViewsInternal(userEmail, additionalViewTypes);
  };

  /**
   * Resolve REAL vehicle dimensions from the GENIE Universal Panelizer.
   *
   * Calls `panelizer-step-validate` (estimateOnly) — the SAME source the
   * print panels and 2D proof use — so GraphicsPro's dims match downstream
   * production. GENIE's internal cascade is DB → embedded CSV → trailer →
   * Google-search grounding. When a vehicle isn't in the internal DB, GENIE
   * grounds it via Google and writes the result back to `vehicle_dimensions`,
   * so the next lookup is instant — no extra work needed on our side.
   *
   * Stashes the resolved dims in `admin_notes.vehicle_dimensions` on the
   * visualization row so the Cut Graphics Proof / production pack can spec
   * graphics against true measurements.
   */
  const fetchVehicleDims = async (vizId?: string): Promise<VehicleDims | null> => {
    if (!make || !model) return null;
    setIsFetchingDims(true);
    try {
      const { data, error } = await renderClient.functions.invoke('panelizer-step-validate', {
        body: {
          vehicleMake: make,
          vehicleModel: model,
          vehicleYear: year ? Number(year) : null,
          estimateOnly: true,
        },
      });

      if (error || !data) {
        console.warn('[GraphicsPro] GENIE dims lookup failed:', error?.message || 'no data');
        return null;
      }

      const d = (data.estimatedDimensions || {}) as Record<string, number>;
      const dims: VehicleDims = {
        source: data.source || 'unknown',
        found: !!data.found,
        sideW: d.bodyLengthInches,
        sideH: d.bodyHeightInches,
        hoodW: d.hoodWidthInches,
        hoodL: d.hoodLengthInches,
        roofW: d.roofWidthInches,
        roofL: d.roofLengthInches,
        backW: d.backWidthInches,
        backH: d.backHeightInches,
        totalSqFt: d.totalSqFt,
      };
      setVehicleDims(dims);

      if (data.found && data.source === 'google_search') {
        console.log(`[GraphicsPro] GENIE grounded ${make} ${model} via Google and cached it to vehicle_dimensions.`);
      }

      // Persist onto the viz row so downstream production reads true dims.
      const targetId = vizId || visualizationId;
      if (targetId && dims.found) {
        try {
          const { data: existing } = await supabase
            .from('color_visualizations')
            .select('admin_notes')
            .eq('id', targetId)
            .maybeSingle();
          let notes: Record<string, any> = {};
          try { notes = (existing as any)?.admin_notes ? JSON.parse((existing as any).admin_notes) : {}; } catch { notes = {}; }
          notes = { ...notes, vehicle_dimensions: dims };
          await supabase
            .from('color_visualizations')
            .update({ admin_notes: JSON.stringify(notes) } as any)
            .eq('id', targetId);
        } catch (persistErr) {
          console.warn('[GraphicsPro] Failed to persist vehicle_dimensions (non-fatal):', persistErr);
        }
      }

      return dims;
    } catch (err: any) {
      console.warn('[GraphicsPro] GENIE dims lookup threw:', err?.message || err);
      return null;
    } finally {
      setIsFetchingDims(false);
    }
  };

  const clearLastRender = () => {
    localStorage.removeItem(STORAGE_KEY + '_last_render');
    setAllViews([]);
    setGeneratedImageUrl(null);
    setVisualizationId(null);
    setVehicleDims(null);
  };

  /**
   * Duplicate the current design.
   *
   * Copies the active `color_visualizations` row (the single source of
   * truth for a GraphicsPro design — render_urls for all 7 views, the
   * effective styling prompt, the master artboard, proof urls, vehicle
   * info, finish, etc.) into a brand-new row, then repoints the live
   * session at the copy. Subsequent revisions / proofs / panels operate
   * on the duplicate, leaving the original untouched so the user can
   * branch a design without losing the version they liked.
   *
   * It is a pure DB copy — NO regeneration, so it never touches the
   * locked render pipeline and costs zero render credits.
   */
  const cloneDesign = async (): Promise<{ success: boolean; newId?: string; error?: string }> => {
    if (!visualizationId) {
      toast({
        title: "Nothing to Clone",
        description: "Generate a design first, then you can duplicate it.",
        variant: "destructive",
      });
      return { success: false, error: "no_design" };
    }

    setIsCloning(true);
    try {
      const userEmail = await getUserEmail();
      if (!userEmail) {
        setShowLoginModal(true);
        return { success: false, error: "auth_required" };
      }

      // Pull the full source row so the copy is faithful — every column
      // (render_urls, master_artboard_path, custom_styling_prompt_key,
      // proof urls in admin_notes, etc.) carries over verbatim.
      const { data: source, error: fetchErr } = await supabase
        .from('color_visualizations')
        .select('*')
        .eq('id', visualizationId)
        .single();

      if (fetchErr || !source) {
        throw new Error(fetchErr?.message || 'Original design not found');
      }

      // Strip auto-managed columns so the DB mints fresh ones; keep the rest.
      const src: Record<string, any> = { ...(source as any) };
      delete src.id;
      delete src.created_at;
      delete src.updated_at;

      // Record lineage so the duplicate is traceable back to its origin.
      let notes: Record<string, any> = {};
      try { notes = src.admin_notes ? JSON.parse(src.admin_notes) : {}; } catch { notes = {}; }
      notes = { ...notes, cloned_from: visualizationId, cloned_at: new Date().toISOString() };

      const insertRow = {
        ...src,
        customer_email: userEmail,        // owned by the current user
        is_featured_hero: false,          // never duplicate the hero flag
        emailed_at: null,                 // fresh copy, not yet emailed
        admin_notes: JSON.stringify(notes),
        design_file_name: src.design_file_name
          ? `${src.design_file_name} (Copy)`
          : `${[src.vehicle_year, src.vehicle_make, src.vehicle_model].filter(Boolean).join(' ')} (Copy)`.trim() || null,
      };

      const { data: cloned, error: cloneErr } = await supabase
        .from('color_visualizations')
        .insert(insertRow as any)
        .select()
        .single();

      if (cloneErr || !cloned) {
        throw new Error(cloneErr?.message || 'Clone insert failed');
      }

      const newId = (cloned as any).id as string;

      // Repoint the session at the duplicate. The visible render + views
      // are identical, so we only swap the id the downstream tools key on.
      setVisualizationId(newId);

      toast({
        title: "Design Cloned",
        description: "A duplicate was created — your revisions now apply to the copy. The original is untouched.",
        duration: 4000,
      });

      return { success: true, newId };
    } catch (err: any) {
      console.error('[GraphicsPro] Clone failed:', err);
      toast({
        title: "Clone Failed",
        description: err?.message || "Couldn't duplicate the design. Please try again.",
        variant: "destructive",
      });
      return { success: false, error: err?.message };
    } finally {
      setIsCloning(false);
    }
  };


  return {
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
    stylingPrompt,
    setStylingPrompt,
    referenceImageUrl,
    setReferenceImageUrl,
    referenceImageUrls,
    setReferenceImageUrls,
    selectedViewType,
    setSelectedViewType,
    isGenerating,
    generatedImageUrl,
    setGeneratedImageUrl,
    visualizationId,
    allViews,
    isGeneratingAdditional,
    pendingViews,
    isCloning,
    cloneDesign,
    vehicleDims,
    isFetchingDims,
    fetchVehicleDims,
    showUpgradeModal,
    setShowUpgradeModal,
    showLoginModal,
    setShowLoginModal,
    selectedPreset,
    setSelectedPreset,
    styleDescription,
    setStyleDescription,
    presetCategory,
    setPresetCategory,
    wrapMethod,
    setWrapMethod,
    finishOverride,
    setFinishOverride,
    generateRender,
    generateAdditionalViews,
    clearLastRender,
  };
};
