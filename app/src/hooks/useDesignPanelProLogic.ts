import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import {
  getEnticeRevisionStatus,
  saveEnticeRevision,
} from "@/lib/designpro-file-output";
import { useOrganization } from "@/contexts/OrganizationContext";
import { producePassengerView, uploadMirrorToStorage } from "@/utils/passenger-mirror";
import type { DesignIQParams } from "@/lib/designiq-engine";

import type { PersonaPipelinePhase } from "@/components/designpanelpro/PersonaPipelineProgress";
import type { CoverageType } from "@/components/tools/CoverageSelector";
import { type VehicleType, getRenderFunctionForType, getDesignProFunctionForType, isNonStandardVehicle } from "@/components/tools/VehicleTypeSelector";
import type { VehicleSpecsPreview } from "@/components/tools/NonStandardVehicleWarning";

type KitSize = "small" | "medium" | "large" | "xl";
type RoofSize = "none" | "small" | "medium" | "large";

const SURFACE_TO_RENDER_VIEW: Record<string, string> = {
  "DRIVER SIDE": "side",
  "PASSENGER SIDE": "passenger-side",
  HOOD: "hood_detail",
  ROOF: "roof",
  FRONT: "front",
  REAR: "rear",
};

function resolveSelectedPanelSides(input: {
  vehicleType: VehicleType;
  coverageType: CoverageType;
  addHood: boolean;
  roofSize: RoofSize;
  addFrontBumper: boolean;
  addRearBumper: boolean;
}): string[] {
  if (input.vehicleType === "trailer") {
    return ["DRIVER SIDE", "PASSENGER SIDE", "FRONT", "REAR"];
  }
  if (String(input.coverageType).toLowerCase() === "full") {
    return ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];
  }
  return [
    "DRIVER SIDE",
    "PASSENGER SIDE",
    ...(input.addHood ? ["HOOD"] : []),
    ...(input.roofSize !== "none" ? ["ROOF"] : []),
    ...(input.addFrontBumper ? ["FRONT"] : []),
    ...(input.addRearBumper ? ["REAR"] : []),
  ];
}

function requiredRenderViewsForSurfaces(
  expectedPanelSides: unknown,
): string[] {
  if (!Array.isArray(expectedPanelSides) || expectedPanelSides.length === 0) {
    throw new Error(
      "The saved design has no authoritative production-surface selection",
    );
  }
  const normalizedSides = expectedPanelSides.map((side) =>
    String(side || "").trim().toUpperCase(),
  );
  const unsupportedSides = normalizedSides.filter(
    (side) => !SURFACE_TO_RENDER_VIEW[side],
  );
  if (unsupportedSides.length > 0) {
    throw new Error(
      `The saved production-surface selection is unsupported: ${unsupportedSides.join(", ")}`,
    );
  }
  return [
    ...new Set(normalizedSides.map((side) => SURFACE_TO_RENDER_VIEW[side])),
  ];
}

// Error types for better handling
type GenerationError = 'auth_required' | 'limit_reached' | 'generation_failed';

export const useDesignPanelProLogic = () => {
  const { toast } = useToast();
  const { checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const { currentShop } = useOrganization();

  // Vehicle type routing — cars stay on locked generate-color-render;
  // motorcycle/boat/bus/rv route to dedicated render-<type> edge functions
  const [vehicleType, setVehicleType] = useState<VehicleType>('car');
  const [nonStandardSpecs, setNonStandardSpecs] = useState<VehicleSpecsPreview | null>(null);

  const [selectedPanel, setSelectedPanel] = useState<any>(null);
  const [selectedFinish, setSelectedFinish] = useState<'Gloss' | 'Satin' | 'Matte'>('Gloss');
  const [kitSize, setKitSize] = useState<KitSize>("medium");
  const [addHood, setAddHood] = useState(false);
  const [addFrontBumper, setAddFrontBumper] = useState(false);
  const [addRearBumper, setAddRearBumper] = useState(false);
  const [roofSize, setRoofSize] = useState<RoofSize>("none");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [allViews, setAllViews] = useState<any[]>([]);
  const [isGeneratingAdditional, setIsGeneratingAdditional] = useState(false);
  const [failedViews, setFailedViews] = useState<string[]>([]);
  const [isRetryingView, setIsRetryingView] = useState<string | null>(null);
  const [designAnchorText, setDesignAnchorText] = useState<string | null>(null);
  const [uploadMode, setUploadMode] = useState<'curated' | 'custom'>('curated');
  const [isGeneratingPanel, setIsGeneratingPanel] = useState(false);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [coverageType, setCoverageType] = useState<CoverageType>("full");
  const [designName, setDesignName] = useState<string | null>(null);
  const [designDnaId, setDesignDnaId] = useState<string | null>(null);
  const [renderDid, setRenderDid] = useState<string | null>(null);
  const [renderPt, setRenderPt] = useState<string | null>(null);
  const [flatProofUrl, setFlatProofUrl] = useState<string | null>(null);
  // Tracks whether the current hero render came from DesignIQ (AI prompt + VisionBoard)
  // vs a library panel. When true, 360-views must clone view 1 via the
  // design-panel-ai-generate originalRenderUrl path — NOT re-feed VisionBoard refs
  // (which would let Gemini re-interpret the brief and drift on each view).
  // When false (library panel), views stay on generate-color-render with panelUrl.
  const [isDesignIQRender, setIsDesignIQRender] = useState(false);
  const clearLastRender = () => {
    setGeneratedImageUrl(null);
    setAllViews([]);
    setDesignAnchorText(null);
    setDesignName(null);
    setDesignDnaId(null);
    setRenderDid(null);
    setRenderPt(null);
    setIsDesignIQRender(false);
    setFlatProofUrl(null);
  };

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

  // Fetch all active panels (both curated and custom)
  // Excludes "AI Generated" category - those are direct 3D vehicle renders from
  // batch pipeline that should NOT appear in the curated panel library.
  const { data: curatedPanels, isLoading } = useQuery({
    queryKey: ["designpanelpro_patterns"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("designpanelpro_patterns")
        .select("*")
        .eq("is_active", true)
        .neq("category", "AI Generated")
        .order("sort_order", { ascending: true });
      
      if (error) {
        console.error("[designpanelpro_patterns] query error:", error.message, error.code);
        throw error;
      }

      return data || [];
    },
  });

  // Observe the server-authored active pack so the proof viewer never launches
  // a second browser proof while Entice is already building the canonical one.
  const { data: enticeWorkflowStatus } = useQuery({
    queryKey: ["designpanelpro-entice-status", visualizationId],
    enabled: !!visualizationId,
    queryFn: async () => {
      try {
        return await getEnticeRevisionStatus({
          visualizationId: String(visualizationId),
        });
      } catch (error: any) {
        if (/not found/i.test(String(error?.message || ""))) return null;
        throw error;
      }
    },
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data;
      const workflowStatus = String(
        status?.workflowRun?.workflow_status || "",
      );
      // A preview proof is intentionally visible before activation, but keep
      // polling while a replacement run is building. The prior pack remains
      // active by design and must not accidentally stop polling for its
      // revision-bound replacement.
      if (!workflowStatus) {
        return status?.activeEnticePack?.proof_artifact?.url
          ? false
          : 3_000;
      }
      return ["completed", "cancelled", "failed"].includes(workflowStatus)
        ? false
        : 3_000;
    },
  });

  useEffect(() => {
    const serverProofUrl = String(
      enticeWorkflowStatus?.previewProofUrl ||
        enticeWorkflowStatus?.activeEnticePack?.proof_artifact?.url ||
        "",
    );
    if (serverProofUrl) setFlatProofUrl(serverProofUrl);
  }, [enticeWorkflowStatus]);

  // FadeWraps pricing (exact copy)
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

  const generateRender = async (year: string, make: string, model: string, revisionPrompt?: string, originalRenderUrl?: string): Promise<GenerationError | null> => {
    if (!selectedPanel) return 'generation_failed';

    // Check subscription limits
    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return 'limit_reached';
    }

    // Clear previous render so old image doesn't persist if this generation fails
    setGeneratedImageUrl(null);
    setAllViews([]);
    setFailedViews([]);
    setDesignAnchorText(null);
    setGenerationError(null);
    setIsGenerating(true);
    try {
      // Get user email with retry logic
      const userEmail = await getUserEmail();

      if (!userEmail) {
        setShowLoginModal(true);
        return 'auth_required';
      }

      // Route library panel renders through the appropriate edge function.
      // Cars/trucks/SUVs/vans → generate-color-render (locked golden pipeline).
      // Motorcycle/boat/bus/rv → dedicated render-<type> with Google-grounded specs.
      const renderFunction = getRenderFunctionForType(vehicleType);
      console.log(`[DesignIQ] Render call - function: ${renderFunction}, vehicleType: ${vehicleType}, viewType: "side" (Driver Side initial)`);
      const { data, error } = await renderClient.functions.invoke(renderFunction, {
        body: {
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          modeType: 'designpanelpro',
          viewType: 'side',
          revisionPrompt,
          originalRenderUrl: originalRenderUrl || undefined,
          userEmail,
          colorData: {
            panelName: selectedPanel.ai_generated_name || selectedPanel.name,
            panelUrl: selectedPanel.media_url,
            finish: selectedFinish.toLowerCase(),
            manufacturer: 'DesignPanelPro Patterns',
            colorLibrary: 'designpanelpro',
            coverageType,
          }
        }
      });

      if (error) {
        // Check for auth-related errors from edge function
        if (error.message?.includes('userEmail') || error.message?.includes('anonymous')) {
          setShowLoginModal(true);
          return 'auth_required';
        }
        throw error;
      }

      if (data?.renderUrl) {
        const authoritativeVisualizationId = String(
          data.visualizationId || data.cacheId || "",
        ).trim();
        if (!authoritativeVisualizationId) {
          throw new Error(
            "The generated design was not bound to an authoritative saved visualization",
          );
        }
        setGeneratedImageUrl(data.renderUrl);
        setVisualizationId(authoritativeVisualizationId);
        // Library panel path — views 2-7 should use generate-color-render with panelUrl
        setIsDesignIQRender(false);
        // Capture design name from AI response (or fall back to panel name)
        const effectiveDesignName = data?.designName || selectedPanel?.ai_generated_name || selectedPanel?.name;
        if (effectiveDesignName) {
          setDesignName(effectiveDesignName);
          console.log(`[DesignIQ] Design name captured: "${effectiveDesignName}"`);
        }
        if (data?.did) setRenderDid(data.did);
        if (data?.pt) setRenderPt(data.pt);
        // Capture design anchor text for cross-view continuity
        if (data?.designAnchorText) {
          setDesignAnchorText(data.designAnchorText);
          console.log('[DesignIQ] Design anchor captured for cross-view continuity');
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

        // Increment render count after successful generation
        await incrementRenderCount();

        toast({
          title: data.designName || "3D Proof Generated",
          description: "Your DesignProAI™ preview is ready!"
        });
        return null;
      }
      return 'generation_failed';
    } catch (error: any) {
      console.error('Generate render error:', error);

      // Check for auth-related error messages
      if (error.message?.includes('userEmail') || error.message?.includes('anonymous') || error.message?.includes('SECURITY')) {
        setShowLoginModal(true);
        return 'auth_required';
      }

      const friendlyMsg = error.message?.includes('timed out')
        ? "The AI took too long on this one — give it another shot!"
        : error.message || "Something went wrong — let's try again!";
      setGenerationError(friendlyMsg);
      return 'generation_failed';
    } finally {
      setIsGenerating(false);
    }
  };

  // Render a single view with retry logic (used by both generateAdditionalViews and retryFailedView)
  //
  // Two routing paths depending on how the hero render was produced:
  //
  // 1. DesignIQ AI hero (isDesignIQRender === true):
  //    Routes to design-panel-ai-generate with originalRenderUrl: view 1 render.
  //    The edge function's 360-view path (index.ts:491-525) attaches view 1 as
  //    the PRIMARY image reference with an explicit "Clone this IDENTICAL wrap
  //    design — match every design element exactly, only the camera position
  //    changes" instruction. This is the approved hero as ground truth.
  //    CRITICAL: we do NOT re-send visionBoardImages here — re-feeding the
  //    source references would let Gemini re-interpret the brief on each view
  //    and drift. View 1 is the single source of truth from this point on.
  //
  // 2. Library panel hero (isDesignIQRender === false):
  //    Routes to generate-color-render with modeType 'designpanelpro' — the
  //    proven V3 DPP pipeline with the flat panel tile as the design reference.
  const renderSingleView = async (
    viewType: string, year: string, make: string, model: string, userEmail: string, panelUrl: string
  ): Promise<{ type: string; url: string | null }> => {
    const MAX_RETRIES = 2;
    const RETRY_DELAY_MS = 3000;
    // Tiered timeouts: be patient on later retries. First tier is 150s (was
    // 90s): the server holds a 140s wall budget with two 60s Gemini attempts,
    // so a 90s client abandon killed views the server was still legitimately
    // rendering — then re-fired a full duplicate render (wasted latency +
    // tokens on every slow view).
    const TIMEOUT_TIERS = [150_000, 150_000, 160_000];

    for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
      const REQUEST_TIMEOUT_MS = TIMEOUT_TIERS[attempt - 1] || 150_000;
      try {
        console.log(`[DesignIQ] View "${viewType}" attempt ${attempt}/${MAX_RETRIES + 1} (timeout: ${REQUEST_TIMEOUT_MS / 1000}s, route: ${isDesignIQRender ? 'design-panel-ai-generate (clone hero)' : 'generate-color-render'})`);

        // Specialty vehicles (trailer, boat, bus, RV, motorcycle) clone the
        // hero through their OWN vehicle-aware function so the extra angles get
        // the right framing (e.g. a trailer's real front wall / rear doors)
        // instead of car angles from the generic pipeline.
        const specialtyFn = isNonStandardVehicle(vehicleType) ? getDesignProFunctionForType(vehicleType) : null;

        // Build the edge-function call based on hero source
        const invokePromise = specialtyFn && generatedImageUrl
          ? supabase.functions.invoke(specialtyFn, {
              body: {
                mode: 'restyle',
                prompt: 'Reproduce the attached hero wrap design from a different camera angle.',
                finish: selectedFinish,
                vehicleYear: year,
                vehicleMake: make,
                vehicleModel: model,
                viewType,
                originalRenderUrl: generatedImageUrl,
              },
            })
          : isDesignIQRender && generatedImageUrl
          ? supabase.functions.invoke('design-panel-ai-generate', {
              body: {
                // mode + prompt are required by the edge function. The prompt
                // here is deliberately minimal — the real instructions come
                // from the originalRenderUrl 360-view branch (index.ts:515-525)
                // which adds "Clone this IDENTICAL wrap design..." and the
                // view-specific camera reinforcement.
                mode: 'restyle',
                prompt: 'Reproduce the attached wrap design from a different camera angle.',
                finish: selectedFinish,
                vehicleYear: year,
                vehicleMake: make,
                vehicleModel: model,
                viewType,
                originalRenderUrl: generatedImageUrl,
                // Intentionally NO visionBoardImages / visionboard_intent:
                // view 1 is the approved ground truth. Re-sending refs would
                // cause Gemini to re-interpret the brief and drift.
              },
            })
          : renderClient.functions.invoke('generate-color-render', {
              body: {
                vehicleYear: year,
                vehicleMake: make,
                vehicleModel: model,
                modeType: 'designpanelpro',
                viewType,
                userEmail,
                // Fresh model generation every view — never a cached render.
                skipCache: true,
                forceNew: true,
                colorData: {
                  panelName: selectedPanel.ai_generated_name || selectedPanel.name,
                  panelUrl: panelUrl,
                  finish: selectedFinish.toLowerCase(),
                  // Dynamic per-vehicle dimensions from the resolved GENIE/spec
                  // engine (length × height in inches) — replaces the old
                  // hardcoded '186x56'. Omitted when specs are not yet resolved
                  // so the server derives them rather than trusting a stale default.
                  panelDimensions: nonStandardSpecs?.dimensions
                    ? `${Math.round(nonStandardSpecs.dimensions.overall_length_in)}x${Math.round(nonStandardSpecs.dimensions.overall_height_in)}`
                    : undefined,
                  heroReferenceUrl: generatedImageUrl,
                  designAnchorText: designAnchorText,
                  coverageType,
                }
              }
            });

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`View "${viewType}" timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)), REQUEST_TIMEOUT_MS)
        );

        const { data, error } = await Promise.race([invokePromise, timeoutPromise]);

        if (error) {
          // Supabase functions.invoke returns generic "non-2xx" errors; real
          // details come from data.message/error on design-panel-ai-generate.
          const detail = (data as any)?.message || (data as any)?.error || error.message;
          throw new Error(detail || 'Edge function error');
        }
        if (data?.renderUrl) {
          console.log(`[DesignIQ] View "${viewType}" OK on attempt ${attempt}`);
          return { type: viewType, url: data.renderUrl };
        }
        throw new Error('No renderUrl in response');
      } catch (viewError: any) {
        console.error(`[DesignIQ] View "${viewType}" attempt ${attempt} failed:`, viewError.message);
        if (attempt <= MAX_RETRIES) {
          console.log(`[DesignIQ] Retrying "${viewType}" in ${RETRY_DELAY_MS}ms...`);
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    console.error(`[DesignIQ] View "${viewType}" FAILED after ${MAX_RETRIES + 1} attempts`);
    return { type: viewType, url: null };
  };

  const generateAdditionalViews = async (year: string, make: string, model: string): Promise<GenerationError | null> => {
    if (!selectedPanel) {
      toast({
        title: "No design loaded",
        description: "Generate a design first before creating additional views.",
        variant: "destructive",
      });
      return 'generation_failed';
    }

    setIsGeneratingAdditional(true);
    setFailedViews([]);
    try {
      const userEmail = await getUserEmail();
      if (!userEmail) {
        setShowLoginModal(true);
        return 'auth_required';
      }

      const panelUrl = selectedPanel.media_url.startsWith('http')
        ? selectedPanel.media_url
        : `${window.location.origin}${selectedPanel.media_url}`;

      const totalViews = vehicleType === 'trailer' ? 5 : 7; // trailer: side, passenger-side, front, rear, close-up
      const allResults: Array<{ type: string; url: string | null }> = [];
      const failed: string[] = [];

      // Trailers have no hood and no roof glamour shot, so those views produce
      // nonsense angles. Skip them — a trailer's set is side, passenger-side,
      // front, rear, close-up.
      const isTrailer = vehicleType === 'trailer';

      // Capture the design anchor text as a local before any async render call,
      // so every view (passenger + batched angles) reads the SAME value and a
      // late React state update can't change it mid-batch. Mirrors the
      // capture-before-batch pattern in useDesignProLogic.
      const capturedAnchorText = designAnchorText;

      // Start with driver side already rendered
      allResults.push({ type: 'side', url: generatedImageUrl });
      setAllViews([...allResults.filter(v => v.url) as Array<{ type: string; url: string }>]);

      // ── PHASE 2: Passenger side ──
      // THE DETERMINISTIC MIRROR IS THE PRODUCER, NOT A FALLBACK. Per CLAUDE.md's
      // A.C.E. architecture: "7 views (clone hero; passenger = mirror w/ readable
      // text)". A horizontal flip of the driver render CANNOT come back facing the
      // wrong way — the "passenger shows the driver" failure mode is removed by
      // construction instead of guarded against.
      //
      // WHY THIS REGRESSION KEPT COMING BACK (do not undo): the native AI
      // passenger render used to be primary, and its only safety check compared
      // the AI's returned URL to the driver's URL for equality. But every render
      // writes a NEW file, so a driver-facing result ALWAYS arrived under a fresh
      // URL, the equality test passed, and the wrong-facing image was accepted as
      // the passenger side. That check could only catch the AI echoing back the
      // identical URL — the rarest form — so every real occurrence sailed through.
      // Each previous "fix" hardened a check that tests the wrong thing.
      // NEVER reintroduce a URL-equality distinctness check here; it cannot detect
      // this bug. Cost of the mirror: lettering flips backwards, repaired by the
      // fixMirrorText pass below (same pass ColorPro and RevisionStudio use).

      // SPEED: run the passenger build CONCURRENTLY with the Phase 3 view wave
      // below. It only depends on the hero image, so kicking it off here (without
      // awaiting) keeps its AI text-direction repair off the critical path.
      const passengerPromise: Promise<string | null> = producePassengerView({
        driverUrl: generatedImageUrl!,
        uploadDataUrl: async (dataUrl) => {
          const { data: { user } } = await supabase.auth.getUser();
          return uploadMirrorToStorage(supabase, dataUrl, user?.id || 'anon');
        },
        textDetection: { modeType: 'designpanelpro', prompt: capturedAnchorText || '' },
        vehicleYear: year,
        vehicleMake: make,
        vehicleModel: model,
        toolType: 'DesignPro',
        invokeEdgeFunction: async (fnName, fnBody) => {
          const { data, error } = await renderClient.functions.invoke(fnName, { body: fnBody });
          return { data, error };
        },
        logLabel: 'DesignIQ',
      });

      // ── PHASE 3: Parallel-batch view rendering ──
      // Batches 1-3 fire angle views in pairs. Phase 4 fires proof +
      // artboard once all 7 views (including roof) are complete.
      console.log('[DesignIQ] Phase 3: Parallel-batch view rendering...');

      // Helper to process batch results
      const processBatchResults = (batchResults: PromiseSettledResult<any>[], batchTypes: string[]) => {
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
            const viewType = batchTypes[i];
            console.error(`[DesignIQ] View "${viewType}" unexpected rejection:`, settled.reason);
            allResults.push({ type: viewType, url: null });
            failed.push(viewType);
          }
        }
      };

      // SPEED: fire every remaining AI view in ONE parallel wave. The hero
      // (driver side) is already rendered above and passenger is a deterministic
      // mirror, so hood, front, rear, close-up and roof each clone the hero with
      // no ordering dependency on one another. Firing them together — instead of
      // the old three sequential batches (hood+front → rear+close-up → roof) —
      // collapses ~4 render waves into 2, the main render-time win. Trailers skip
      // hood and roof (they have neither).
      const parallelTypes = isTrailer
        ? ['front', 'rear', 'close-up']
        : ['hood_detail', 'front', 'rear', 'close-up', 'roof'];
      console.log(`[DesignIQ] Phase 3: firing ${parallelTypes.length} views in one parallel wave: [${parallelTypes.join(', ')}]`);
      const parallelResults = await Promise.allSettled(
        parallelTypes.map(vt => renderSingleView(vt, year, make, model, userEmail, panelUrl))
      );
      processBatchResults(parallelResults, parallelTypes);

      // Fold in the passenger render that has been running concurrently with the wave.
      const passengerUrl = await passengerPromise;
      if (passengerUrl) {
        allResults.push({ type: 'passenger-side', url: passengerUrl });
        setAllViews(prev => [...prev, { type: 'passenger-side', url: passengerUrl }]);
      } else {
        failed.push('passenger-side');
      }

      // Persist the authoritative view set for recovery. Only a complete
      // required manifest is frozen into an Entice revision; partial results
      // remain editable/retryable and never start production orchestration.
      const successfulViews = allResults
        .filter((view) => view.url)
        .map((view) => ({ type: view.type, url: view.url! }));

      if (!visualizationId || successfulViews.length === 0) {
        throw new Error("The generated views could not be bound to a saved design");
      }

      const { data: currentVisualization, error: currentVisualizationError } =
        await supabase
          .from("color_visualizations")
          .select("admin_notes, updated_at")
          .eq("id", visualizationId)
          .single();
      if (currentVisualizationError) throw currentVisualizationError;

      let notes: Record<string, any> = {};
      try {
        notes =
          typeof currentVisualization.admin_notes === "string"
            ? JSON.parse(currentVisualization.admin_notes)
            : currentVisualization.admin_notes || {};
      } catch {
        notes = {};
      }
      const generationId = String(notes.designiq_generation_id || "") || undefined;
      const expectedPanelSides = resolveSelectedPanelSides({
        vehicleType,
        coverageType,
        addHood,
        roofSize,
        addFrontBumper,
        addRearBumper,
      });
      const nextNotes = {
        ...notes,
        surface_options: {
          ...(notes.surface_options || {}),
          productType: "vehicle_wrap",
          coverage: coverageType,
          expectedPanelSides,
          addHood,
          addRoof: roofSize !== "none",
          roofSize,
          addFrontBumper,
          addRearBumper,
        },
      };
      const renderUrlsMap = Object.fromEntries(
        successfulViews.map((view) => [view.type, view.url]),
      );
      const requiredViewTypes =
        requiredRenderViewsForSurfaces(expectedPanelSides);
      const missingRequiredViews = requiredViewTypes.filter(
        (viewType) => !renderUrlsMap[viewType],
      );
      if (missingRequiredViews.length === 0) {
        const accepted = await saveEnticeRevision({
          visualizationId,
          expectedUpdatedAt: currentVisualization.updated_at,
          renderUrls: renderUrlsMap,
          adminNotesPatch: {
            surface_options: nextNotes.surface_options,
          },
          vehicleType,
          generationId,
          trigger: "initial_generation",
          change: {
            type: "generate",
            prompt: String(notes.original_prompt || designName || "") || null,
            viewKeys: Object.keys(renderUrlsMap).sort(),
          },
        });
        console.log(
          `[DesignIQ] durable Entice Pack accepted: ${accepted.workflowRun.id}`,
        );
      } else {
        // Partial internal view sets are recoverable drafts, not immutable
        // revisions. They may be written directly until the missing views
        // recover; the final complete set uses one atomic save+enqueue call.
        const { data: draftVisualization, error: updateError } =
          await supabase
            .from("color_visualizations")
            .update({
              render_urls: renderUrlsMap,
              vehicle_type: vehicleType,
              admin_notes: JSON.stringify(nextNotes),
              updated_at: new Date().toISOString(),
            })
            .eq("id", visualizationId)
            .eq("updated_at", currentVisualization.updated_at)
            .select("id, updated_at")
            .single();
        if (updateError || !draftVisualization?.updated_at) {
          throw updateError || new Error("The generated views were not saved");
        }
        console.warn(
          `[DesignIQ] Entice submission deferred; authoritative view set is missing: ${missingRequiredViews.join(", ")}`,
        );
      }

      setAllViews(successfulViews);
      setFailedViews(failed);
      if (failed.length > 0) {
        toast({
          title: `${successfulViews.length} of ${totalViews} views generated`,
          description: `${failed.length} view${failed.length > 1 ? 's' : ''} failed. You can retry individual views below.`,
          variant: "destructive"
        });
      } else {
        toast({
          title: "All views generated",
          description: `${totalViews} of ${totalViews} views ready!`
        });
      }
      return null;
    } catch (error: any) {
      console.error('Generate additional views error:', error);
      if (error.message?.includes('userEmail') || error.message?.includes('anonymous') || error.message?.includes('SECURITY')) {
        setShowLoginModal(true);
        return 'auth_required';
      }
      toast({
        title: "Generation failed",
        description: error.message,
        variant: "destructive"
      });
      return 'generation_failed';
    } finally {
      setIsGeneratingAdditional(false);
    }
  };

  // Retry a single failed view and update allViews in place
  const retryFailedView = async (viewType: string, year: string, make: string, model: string): Promise<boolean> => {
    if (!selectedPanel) return false;

    setIsRetryingView(viewType);
    let recoveredViewPersisted = false;
    try {
      const userEmail = await getUserEmail();
      if (!userEmail) {
        setShowLoginModal(true);
        return false;
      }

      const panelUrl = selectedPanel.media_url.startsWith('http')
        ? selectedPanel.media_url
        : `${window.location.origin}${selectedPanel.media_url}`;

      const result = await renderSingleView(viewType, year, make, model, userEmail, panelUrl);

      if (result.url) {
        if (!visualizationId) {
          throw new Error(
            "The recovered view has no authoritative saved visualization",
          );
        }
        const recoveredUrl = result.url;
        const { data: currentVisualization, error: currentError } =
          await supabase
            .from("color_visualizations")
            .select("render_urls, admin_notes, updated_at")
            .eq("id", visualizationId)
            .single();
        if (currentError || !currentVisualization?.updated_at) {
          throw currentError || new Error("The saved design could not be loaded");
        }

        const existingRenderUrls =
          currentVisualization.render_urls &&
          typeof currentVisualization.render_urls === "object"
            ? (currentVisualization.render_urls as Record<string, string>)
            : {};
        const mergedRenderUrls = {
          ...existingRenderUrls,
          [result.type]: recoveredUrl,
        };
        let notes: Record<string, any> = {};
        try {
          notes =
            typeof currentVisualization.admin_notes === "string"
              ? JSON.parse(currentVisualization.admin_notes)
              : currentVisualization.admin_notes || {};
        } catch {
          notes = {};
        }
        const requiredViewTypes = requiredRenderViewsForSurfaces(
          notes.surface_options?.expectedPanelSides,
        );
        const missingRequiredViews = requiredViewTypes.filter(
          (requiredView) => !mergedRenderUrls[requiredView],
        );

        if (missingRequiredViews.length === 0) {
          const generationId =
            String(notes.designiq_generation_id || "") || undefined;
          const accepted = await saveEnticeRevision({
            visualizationId,
            expectedUpdatedAt: currentVisualization.updated_at,
            renderUrls: mergedRenderUrls,
            generationId,
            trigger: "view_regenerated",
            change: {
              type: "revision",
              prompt:
                String(notes.original_prompt || designName || "") || null,
              viewKeys: Object.keys(mergedRenderUrls).sort(),
            },
          });
          console.log(
            `[DesignIQ] recovered-view Entice revision accepted: ${accepted.workflowRun.id}`,
          );
        } else {
          // Still incomplete: persist only a mutable recovery draft. The call
          // that lands the final required view performs the one atomic
          // save+enqueue transition.
          const { data: draftVisualization, error: saveError } =
            await supabase
              .from("color_visualizations")
              .update({
                render_urls: mergedRenderUrls,
                updated_at: new Date().toISOString(),
              })
              .eq("id", visualizationId)
              .eq("updated_at", currentVisualization.updated_at)
              .select("id, updated_at")
              .single();
          if (saveError || !draftVisualization?.updated_at) {
            throw saveError || new Error("The recovered view was not saved");
          }
          console.warn(
            `[DesignIQ] recovered view saved; Entice submission remains deferred until these views recover: ${missingRequiredViews.join(", ")}`,
          );
        }

        // Update browser state only after the authoritative save path accepted
        // the recovered URL.
        recoveredViewPersisted = true;
        setAllViews((prev) => [
          ...prev.filter((view) => view.type !== result.type),
          { type: result.type, url: recoveredUrl },
        ]);
        setFailedViews(prev => prev.filter(v => v !== viewType));

        toast({
          title: "View recovered",
          description:
            missingRequiredViews.length === 0
              ? `${viewType} was saved and the production-preview workflow was queued.`
              : `${viewType} was saved. ${missingRequiredViews.length} required view${missingRequiredViews.length === 1 ? "" : "s"} still need recovery.`,
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
    } catch (error: any) {
      toast({
        title: recoveredViewPersisted
          ? "View saved; pack update pending"
          : "Retry failed",
        description: recoveredViewPersisted
          ? `The view is safe, but the server workflow was not queued: ${error?.message || "unknown error"}`
          : error?.message || `${viewType} could not be recovered.`,
        variant: "destructive",
      });
      return recoveredViewPersisted;
    } finally {
      setIsRetryingView(null);
    }
  };

  // Save design job to database for purchase flow
  const saveDesignJob = async (year: string, make: string, model: string) => {
    try {
      const { data: authData } = await supabase.auth.getUser();
      
      const { data, error } = await supabase
        .from('panel_designs')
        .insert({
          user_id: authData?.user?.id || null,
          shop_id: currentShop?.id ?? null,
          panel_id: selectedPanel?.id || null,
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          finish: selectedFinish.toLowerCase(),
          preview_image_url: generatedImageUrl,
          prompt_state: {
            panelName: selectedPanel?.ai_generated_name || selectedPanel?.name,
            panelUrl: selectedPanel?.media_url,
            thumbnailUrl: selectedPanel?.thumbnail_url || selectedPanel?.clean_display_url || selectedPanel?.media_url,
            allViews: allViews.map(v => ({ type: v.type, url: v.url })),
            heroUrl: generatedImageUrl
          }
        })
        .select()
        .single();
      
      if (error) {
        console.error('Error saving design job:', error);
        throw error;
      }
      
      return data;
    } catch (error) {
      console.error('Failed to save design job:', error);
      return null;
    }
  };

  // DesignIQ: generate a design via the AI edge function
  // V1 direct render: AI generates the vehicle render directly (no intermediate flat panel)
  const generateFromPrompt = async (
    params: DesignIQParams,
    vehicleInfo?: { year: string; make: string; model: string }
  ): Promise<{ generationId: string | null; directRender: boolean; renderUrl?: string; error?: string }> => {
    // Clear previous render state so old image doesn't persist if this generation fails
    clearLastRender();
    setAllViews([]);
    setFailedViews([]);
    setGenerationError(null);
    setIsGeneratingPanel(true);
    try {
      // LOCK-SAFE PAYLOAD AUDIT: the render is CLEAN-FIRST — typography and text
      // placement belong on the editable LayerLiftIQ overlay, NOT baked into the
      // background paint. Strip the flat-typography directive (fontStyle) from the
      // payload so design-panel-ai-generate never assembles a "Typography: …" rule
      // into the artwork. We do NOT touch the locked render function — we simply
      // stop feeding it the variable that triggers the bake.
      const { fontStyle: _omitFontStyle, ...payloadParams } = params;
      const body: Record<string, unknown> = { ...payloadParams };
      if (vehicleInfo) {
        body.vehicleYear = vehicleInfo.year;
        body.vehicleMake = vehicleInfo.make;
        body.vehicleModel = vehicleInfo.model;
      }

      // EXACT-REFERENCE = FAITHFUL REPLICATION (RecreatePro's proven path):
      // When the customer uploads a design and chooses "Recreate Exactly", we must
      // REPRODUCE it — not reinterpret it. The upload is a PHOTO/RENDER of a finished
      // wrap, NOT a flat labeled multi-panel artboard, so the ONLY correct intent is
      // 'exact_reference' ("recreate this exact design faithfully").
      //
      // DO NOT use 'artboard_projection' here (the previous wiring did, and it is why
      // "Recreate Exactly" kept producing a NEW design). The edge function's
      // artboard_projection branch instructs Gemini that the input is "a FLAT 2D
      // production artboard with each side drawn as a LABELED panel" and to read the
      // "DRIVER SIDE"/"REAR" panel from it. A customer photo has no such labeled
      // panels, so the engine can't find them and INVENTS a similar design instead —
      // the #1 recreate bug. RecreatePro (ProductionFlow) hit this exact trap and
      // fixed it by using exact_reference; DesignPro must mirror that.
      //
      // This is a FRONTEND wiring fix, no edge function change: skip artboard-first,
      // force restyle mode (commercial mode has no faithful branch — it falls back to
      // style-inspiration), feed the UPLOADED image straight to the render as the
      // exact reference. Style-inspiration uploads are untouched (they still riff).
      const exactRefUpload =
        params.visionboard_intent === 'exact_reference' &&
        (params.visionBoardImages || []).some((v) => v?.storageUrl);
      // LOGO-WINS in the direct render too: when a logo is uploaded it is the brand
      // mark (editable overlay). Don't let the direct commercial/restyle render bake
      // the typed company name onto the wrap. (companyName stays in params for
      // records; we just don't feed it to the render body.) The website/phone still
      // flow as their own text overlays.
      const hasLogoUploadDirect = (params.textLayerVisionBoardImages || []).some((v) => v?.storageUrl);
      if (hasLogoUploadDirect) delete (body as any).companyName;

      if (exactRefUpload) {
        body.mode = 'restyle';
        body.visionBoardImages = (params.visionBoardImages || [])
          .filter((v) => v?.storageUrl)
          .map((v, i) => ({
            slotLabel: i === 0 ? 'Reference' : `Reference ${i + 1}`,
            storageUrl: v.storageUrl,
          }));
        // exact_reference (NOT artboard_projection) — the upload is a wrap photo,
        // not a labeled panel sheet. This is the RecreatePro-proven faithful path.
        body.visionboard_intent = 'exact_reference';
        console.log('[DesignIQ] Recreate Exactly → faithful replication via exact_reference (RecreatePro-proven path)');
      }

      // Route to separate edge function per vehicle type — keeps pipelines isolated.
      const designProFunction = getDesignProFunctionForType(vehicleType);
      console.log(`[DesignIQ] generateFromPrompt — function: ${designProFunction}, vehicleType: ${vehicleType}`);

      // ── STEP 2 (Option B — artboard-first): for the locked car/truck render
      // (design-panel-ai-generate) ONLY, build the master DesignPanelPro artboard
      // FIRST from the customer's prompt as the source of truth, then PROJECT it
      // onto the vehicle (artboard_projection intent) instead of free-rendering.
      // orchestratorMode = artboard only, no panelizer side effects. Other vehicle
      // types and ANY artboard failure fall straight through to the existing
      // render-first path, so the primary customer tool never hard-breaks. This
      // adds one call ahead of the driver-side first paint.
      let masterArtboardUrl: string | null = null;
      let masterArtboardDesignUrl: string | null = null; // clean artwork (no text/logos) = background layer
      // GATES DELETED. Artboard-first now runs for the car/truck render whenever
      // there's a prompt. Vehicle make/model are resolved from body OR params OR
      // vehicleInfo — body wasn't always populated, and that empty check silently
      // blocked the artboard step (generate-master-artboard never got called).
      const abMake = (body.vehicleMake as string) || (params as any).vehicleMake || vehicleInfo?.make || '';
      const abModel = (body.vehicleModel as string) || (params as any).vehicleModel || vehicleInfo?.model || '';
      const abYear = (body.vehicleYear as string) || (params as any).vehicleYear || vehicleInfo?.year || '2024';
      // ARTBOARD-FIRST RUNS FOR EVERY VEHICLE TYPE — cars, trucks AND specialty
      // vehicles (trailer/boat/bus/rv/motorcycle). The flat master artboard is
      // ALWAYS built first by design-panel-ai-generate mode:artboard, then the
      // per-type render function (designProFunction) PROJECTS it onto the vehicle
      // via visionboard_intent:'artboard_projection'. Previously this was gated to
      // design-panel-ai-generate only, so trailers skipped the artboard entirely
      // and free-rendered each side (the "no artboard first" bug).
      // ARTBOARD FOR BOTH MODES: build + save a flat artboard whether the design
      // came from a PROMPT (Style Inspiration) OR an EXACT REFERENCE upload
      // (match). Exact Reference feeds its uploaded design into PASS 1 with
      // visionboard_intent:'exact_reference', so the artboard REPRODUCES the
      // uploaded design faithfully AND we get a saved flat source to slice print
      // files from. Previously `!exactRefUpload` skipped the artboard entirely for
      // matched designs (the "no artboard / no print files on Exact Reference"
      // bug). Run whenever there's a prompt OR an exact-reference upload.
      // RecreatePro (exact_reference) recreates from ANY wrap image — even a
      // crappy photo — so the design must be REPRODUCED, never re-invented. The
      // AI artboard pass below REDRAWS the design (it reinterprets the reference),
      // then OVERWRITES the customer's uploaded image with that redrawn artboard
      // (see body.visionBoardImages reassignment ~40 lines down), so the 3D proof
      // and every downstream view/print ended up showing the WRONG design. For
      // exact-reference we therefore SKIP the AI artboard entirely: the uploaded
      // image stays the Master Artboard and is projected faithfully onto the
      // vehicle; the flat print files are built from the reproduced 2D proof at
      // pack time (qc-generate-flat-artboard). Prompt-only designs (Style
      // Inspiration / commercial) still build an artboard — there is no reference
      // to reproduce, so the artboard IS their source of truth.
      // DIRECT HERO RENDER (Trish 2026-07-24: "We aren't letting ACE design using
      // his native design brain" — re-applying #3593, which she also directed):
      // the pre-hero artboard-first PROJECTION is DISABLED. It made A.C.E. paint a
      // flat 2K sheet first and then re-interpret it onto the vehicle — the
      // customer's placement/persona/logo direction was consumed making the sheet,
      // and the projection softened + drifted the design. The hero now renders
      // DIRECTLY from the brief in ONE pass via design-panel-ai-generate (the full
      // golden designer prompt, native design intelligence, body-line composition).
      // The flat + clean artboard source for panels/editable layers is produced by
      // the 2D proof (generate-2d-proof — the sanctioned 8th/9th call that
      // dual-writes master_artboard_url + master_artboard_clean_url and emits the
      // continuous artboardClean the gridslice crops) — print files unaffected.
      // Production-canonical mode: prompt-created standard vehicles start from
      // one flat all-sides master. The hero is a projection of that exact
      // source, so Call 8/9 can code-crop the approved pixels instead of trying
      // to reverse-engineer artwork from a vehicle photo. Exact-reference
      // uploads remain preview/manual-QC because a single photographed vehicle
      // side cannot contain lossless artwork for every physical panel.
      // SANCTIONED DESIGNPRO ORDER:
      //   3D hero/views -> generate-2d-proof -> panel/logo extraction.
      //
      // `mode:"artboard"` was an experimental flat-first path that escaped into
      // the customer flow and became a hard precondition for the hero render.
      // It must not conduct DesignPro generation: an artboard failure cannot
      // prevent the 3D proof from being created. The existing post-view
      // `generate-2d-proof` call remains the sole producer of the proof/artboard
      // pair consumed by the protected panel extraction pipeline.
      const hasArtboardInput = false;
      if (
        abMake && abModel && hasArtboardInput
      ) {
        try {
          // Non-standard vehicles aren't in the PVO car table and have a different
          // set of flat sides (a trailer has NO hood/roof). Tell the artboard engine
          // which panels to lay out for this class. Cars/trucks pass nothing → the
          // engine resolves real per-side inches from vehicle_dimensions (PVO).
          const ARTBOARD_PANELS_BY_TYPE: Record<string, string[]> = {
            trailer: ['DRIVER SIDE', 'PASSENGER SIDE', 'FRONT', 'REAR'],
            bus: ['DRIVER SIDE', 'PASSENGER SIDE', 'FRONT', 'REAR'],
            rv: ['DRIVER SIDE', 'PASSENGER SIDE', 'FRONT', 'REAR'],
            boat: ['PORT SIDE', 'STARBOARD SIDE', 'TRANSOM'],
            motorcycle: ['LEFT SIDE', 'RIGHT SIDE', 'TANK', 'FRONT FENDER', 'REAR FENDER'],
          };
          const classPanels = ARTBOARD_PANELS_BY_TYPE[vehicleType as string];
          const abBase: Record<string, unknown> = {
            prompt: params.prompt,
            companyName: params.companyName,
            industryType: params.industryType,
            bulletPoints: params.bulletPoints,
            finish: params.finish,
            vehicleYear: abYear,
            vehicleMake: abMake,
            vehicleModel: abModel,
            ...(classPanels ? { panels: classPanels.map((label) => ({ label })) } : {}),
          };
          // LOGO-WINS RULE: when the customer uploaded their OWN logo, that logo is
          // the brand mark — it rides on top as the editable Layer-2 overlay. The
          // typed company name must NOT be baked into the wrap artwork (the customer
          // asked that an uploaded logo replace company-name branding on the design).
          // companyName is still saved for records/naming elsewhere; here we just
          // omit it from the branding bake so the AI never draws competing company
          // text onto the hero. No uploaded logo → unchanged golden baked hero.
          const hasLogoUpload = (params.textLayerVisionBoardImages || []).some((v) => v?.storageUrl);
          const { companyName: _omitCompanyForBake, ...abBaseNoCompany } = abBase;
          const brandingBase = hasLogoUpload ? abBaseNoCompany : abBase;
          // ── PASS 1: WITHOUT elements — the clean background artboard ──
          // REFERENCE-HONOR FIX: the clean artboard is the single source of truth
          // for every downstream view/proof/panel. The customer's uploaded STYLE
          // reference (params.visionBoardImages, e.g. "copy this design for the
          // background") was being dropped here — PASS 1 only ever got the text
          // prompt, so an uploaded reference was ignored in favor of an invented
          // design. Feed the reference into PASS 1 so the background actually
          // follows it; visionboard_intent governs how literally (exact_reference
          // vs style_inspiration). The edge function's artboard mode already
          // accepts these params (PASS 2 below uses them) — no edge change.
          // NOTE: only the DESIGN/style references ride here. The customer's logo
          // is a Layer-2 overlay (textLayerVisionBoardImages) and is intentionally
          // NOT fed to the clean background, so it never gets baked into the art.
          const userStyleRefs = (params.visionBoardImages || []).filter((v) => v?.storageUrl);
          console.log('[DesignIQ] Artboard pass 1 (clean, no text) for', abMake, abModel,
            userStyleRefs.length ? `— honoring ${userStyleRefs.length} uploaded style ref(s), intent=${params.visionboard_intent || 'style_inspiration'}` : '— no uploaded style ref');
          // RESILIENT ARTBOARD INVOKE: artboard-first is the ONLY path (no
          // render-first fallback), so a SINGLE transient hiccup on this call used
          // to fail the entire design — "Couldn't build the flat artboard (Failed
          // to send a request to the Edge Function)". That FunctionsFetchError +
          // non-2xx from a cold/overloaded worker + mobile-5G network drops are all
          // transient. Retry with backoff before giving up so one blip doesn't sink
          // a business wrap. Returns { url } ('' if it truly never produced one).
          const invokeArtboard = async (invokeBody: Record<string, unknown>): Promise<{ url: string; error: any; data: any }> => {
            let last: { data: any; error: any } = { data: null, error: null };
            for (let attempt = 1; attempt <= 3; attempt++) {
              const res = await supabase.functions.invoke('design-panel-ai-generate', { body: invokeBody });
              const url = res.data?.renderUrl || res.data?.artboardUrl || '';
              if (!res.error && url) return { url, error: null, data: res.data };
              last = res;
              const msg = String(res.error?.message || res.data?.error || res.data?.message || 'no artboard returned');
              const transient = /failed to send|failed to fetch|non-2xx|network|load failed|timeout|timed out|50[234]|429/i.test(msg) || !url;
              if (attempt < 3 && transient) {
                console.warn(`[DesignIQ] artboard invoke attempt ${attempt}/3 failed (${msg}) — retrying`);
                await new Promise((r) => setTimeout(r, attempt * 2000));
                continue;
              }
              break;
            }
            return { url: last.data?.renderUrl || last.data?.artboardUrl || '', error: last.error, data: last.data };
          };

          const clean = await invokeArtboard({
            mode: 'artboard',
            artboardClean: true,
            ...abBase,
            ...(userStyleRefs.length
              ? {
                  visionBoardImages: userStyleRefs,
                  visionboard_intent: params.visionboard_intent || 'style_inspiration',
                }
              : {}),
          });
          const cleanUrl = clean.url;
          if (!cleanUrl) throw new Error(clean.error?.message || clean.data?.error || clean.data?.message || 'no clean artboard returned');
          masterArtboardDesignUrl = cleanUrl; // background (without elements) → used by designpro-separate + saved

          // ── NO BRANDING PASS (Trish 2026-07-24: "there shouldn't be a branding
          // pass"). The committed Artboard-First architecture: the flat master
          // artboard is authored CLEAN and the hero renders with NO baked-in
          // branding — logo/text ride as the editable LayerLiftIQ overlay, never a
          // second AI pass that bakes a "combined" artboard (that pass also 546'd
          // constantly and produced the two-logo/slop failures). The CLEAN artboard
          // is the single source of truth; the projection carries the brief, so the
          // proof still presents the branding, and the overlay stays editable.
          masterArtboardUrl = cleanUrl; // single source of truth — the CLEAN artboard
          console.log('[DesignIQ] Artboard ready (clean, single-pass) — RecreatePro projects the CLEAN artboard to 3D');
          body.visionBoardImages = [{ slotLabel: 'Master Artboard', storageUrl: cleanUrl }];
          body.visionboard_intent = 'artboard_projection';
        } catch (abErr: any) {
          // ARTBOARD-FIRST IS THE ONLY PATH. The 3D proof is RecreatePro
          // projecting the master artboard — there is no render-first fallback,
          // because that is exactly the old clone-from-driver drift we removed.
          // On artboard failure we abort and let the customer retry; we never
          // generate the 3D a different way.
          console.error('[DesignIQ] Artboard-first FAILED — aborting (no render-first fallback):', abErr?.message || abErr);
          throw new Error(`Couldn't build the flat artboard (${abErr?.message || 'unknown'}). Please retry — the 3D proof is created from the artboard.`);
        }
      }

      const { data, error } = await supabase.functions.invoke(
        designProFunction,
        { body }
      );

      if (error) {
        // Supabase functions.invoke returns generic "non-2xx" errors.
        // The actual error details are in data (response body parsed from JSON).
        const detail = data?.message || data?.error || '';
        if (detail) {
          throw new Error(detail);
        }
        throw error;
      }

      const generationId: string | null = data?.generationId || null;

      // ── ARTBOARD PERSIST FIX (root "no artboard saved" bug) ──
      // This save was previously nested inside the directRender branch below, so
      // artboard-first PROJECTION renders (the normal path) never wrote
      // master_artboard_url → every row came back NULL → no flat source to slice
      // → downstream slop. Persist on EVERY path here, the moment we have the
      // generationId. Save the combined (with-branding) artboard, or fall back to
      // the clean background artwork if PASS 2 didn't return.
      const artboardToSave = masterArtboardUrl || masterArtboardDesignUrl;
      console.log('[DesignIQ] artboard persist check', { generationId, hasArtboard: !!artboardToSave, hasCombined: !!masterArtboardUrl, hasClean: !!masterArtboardDesignUrl });
      if (artboardToSave && generationId) {
        supabase
          .from('designiq_generations')
          .update({ master_artboard_url: artboardToSave } as any)
          .eq('id', generationId)
          .then(({ error: abPersistErr }) => {
            if (abPersistErr) console.warn('[DesignIQ] persist master_artboard_url FAILED:', abPersistErr.message);
            else console.log('[DesignIQ] master_artboard_url persisted on', generationId);
          });
        // CLEAN ORIGIN SHEET (dual-output panels): also persist the PASS-1
        // background-only artboard (zero text/logos) so the panel build can
        // slice a logo-free CLEAN panel per side (production_flow_assets.
        // background_url) alongside the standard branded print panel — the
        // canvas the design team re-composes on a vector vehicle template.
        // SEPARATE update on purpose: if the migration adding
        // master_artboard_clean_url hasn't run yet, only this write fails and
        // the branded persist above is untouched.
        if (masterArtboardDesignUrl) {
          supabase
            .from('designiq_generations')
            .update({ master_artboard_clean_url: masterArtboardDesignUrl } as any)
            .eq('id', generationId)
            .then(({ error: cleanPersistErr }) => {
              if (cleanPersistErr) console.warn('[DesignIQ] persist master_artboard_clean_url FAILED (migration not applied?):', cleanPersistErr.message);
              else console.log('[DesignIQ] master_artboard_clean_url persisted on', generationId);
            });
        }
      } else if (generationId && !artboardToSave) {
        console.warn('[DesignIQ] NO artboard to persist for', generationId, '— artboard-first produced no master artboard (gate skipped or a pass failed). master_artboard_url will be NULL.');
      }

      // ── background_url IS THE CONTINUOUS artboardClean — NOT the labeled sheet ──
      // The artboard-first PASS produces a LABELED multi-panel master sheet
      // (master_artboard_url) — useful as a human reference, but it is NOT a valid
      // print-slice source: the deterministic gridslice fitCovers ONE continuous,
      // text-free, full-bleed artwork. That continuous artboardClean is emitted by
      // the 8th call (generate-2d-proof) in the multi-view flow below and written to
      // design_generation_assets.background_url there. So we do NOT persist the
      // labeled sheet into background_url here (that was the wrong shape) — background_url
      // is left for the continuous artboardCleanUrl. master_artboard_url already holds
      // the labeled reference (persisted above); leave it untouched.

      // V1 direct render path - AI returned a vehicle render, not a flat panel
      if (data?.directRender && data?.renderUrl) {
        setGeneratedImageUrl(data.renderUrl);
        // `visualizationId` IS A color_visualizations ID — NEVER a designiq one.
        //
        // Every consumer of this state reads color_visualizations by it
        // (.from("color_visualizations").eq("id", visualizationId) at the view
        // save, render_urls merge, admin_notes patch and proof write) and the
        // Entice Pack is keyed by it — designpro_entice_packs.source_visualization_id
        // resolves to color_visualizations on 100% of rows and designiq_generations
        // on 0%.
        //
        // This line used to assign data.generationId, which is the DESIGNIQ
        // generation id, so the entice status poll ran
        // `.eq("source_visualization_id", <designiq id>)`, matched nothing, and
        // came back 404 "Entice Pack workflow not found". The hook swallows any
        // /not found/i as null, so enticeWorkflowStatus went null and
        // previewProofUrl — the server-side proof URL that is populated the
        // moment proof.build completes, well before pack activation — was never
        // read. A correct, finished 2D proof therefore never appeared on the
        // DesignPro page or in Revision Studio, and the paired
        // designpro-file-output-api / run-production-flow 404 flood in the edge
        // logs was this poll, retrying with an id that could never match.
        //
        // The crypto.randomUUID() fallback was worse: a missing generationId
        // minted an id matching nothing anywhere, silently and forever.
        //
        // The real id is set below from the color_visualizations record this
        // same path creates or reuses. Until then it stays null, which keeps the
        // entice status query disabled (`enabled: !!visualizationId`) instead of
        // firing a guaranteed-404 poll.

        // Persist the artboard as the design's source-of-truth so the
        // DesignPanelPro admin page (/design-assets) shows it. Without this the
        // artboard was generated then thrown away — the root "no artboard" bug.
        if (masterArtboardUrl && generationId) {
          supabase
            .from('designiq_generations')
            .update({ master_artboard_url: masterArtboardUrl } as any)
            .eq('id', generationId)
            .then(({ error: abPersistErr }) => {
              if (abPersistErr) console.warn('[DesignIQ] persist master_artboard_url failed:', abPersistErr.message);
              else console.log('[DesignIQ] master_artboard_url persisted on', generationId);
            });
        }

        // ── Parallel 2nd track (Option B): split the design into production
        // layers (clean background + transparent branding + depth) the MOMENT
        // the design is generated — NOT only when a production pack is ordered.
        // This is what populates RevisionStudio (fast edits) and the QC design
        // page so "all the elements" are ready immediately. Keyed by
        // generationId — the SAME job_id production_flow_assets / RevisionStudio
        // / QC read by. Prefer the flat master artboard (clean, all panels) when
        // artboard-first produced one; otherwise fall back to the hero render so
        // the layers ALWAYS exist. Fire-and-forget, never blocks the UI.
        // GOLDEN RULE: the deterministic layer split must read ONLY the pristine
        // flat 2D artboard — NEVER a 3D vehicle render (a render-derived split puts
        // tires/windows/ground shadows into the print panels). Prefer the clean
        // (text-free) artboard, then the combined; if neither exists we SKIP the
        // split rather than fall back to the hero render. Fire-and-forget, never
        // blocks the UI.
        // RETIRED (legacy production-flow-engine): this auto-fire fed the LABELED
        // master artboard into production-flow-engine's mode:'separate', which
        // "split" it into a labeled multi-panel SHEET (background) + a dimension-
        // labels PNG (overlay) under a single lowercase "driver" row with its OWN
        // wrong dims (e.g. 185.8″×65.5″ vs the GENIE proof's 181.8″×56″). That is
        // the wrong-looking "Production Layers" card. The deterministic Build Assets
        // gridslice (panel-artboard-generator → save-production-panels) is the ONE
        // producer of per-side print panels, and it matches the GENIE 2D proof. So
        // this legacy split no longer runs — the pre-panels come from Build Assets.
        const layerSourceUrl = masterArtboardDesignUrl || masterArtboardUrl;
        void layerSourceUrl; // retained for the separated-branding block below

        // ── Separated branding PNGs (clean-first / LayerLift): clean background
        // (the artboard's clean artwork) + logo/text as transparent overlay PNGs.
        // Fire-and-forget; persists background_url + overlay_pngs to
        // design_generation_assets so the admin "Separated Files" tab shows them.
        // GOLDEN RULE: separation runs ONLY off the flat 2D artboard — NEVER the 3D
        // render. A render-derived background_url would push the vehicle photo into
        // the print source. If no flat artboard exists we SKIP separation (the
        // flat-first persist above already seeded background_url); the overlay PNGs
        // are regenerated downstream rather than baked off a 3D render here.
        // FAITHFUL-PIPELINE FIX (RP-100974): LayerLift branding separation DISABLED —
        // the faithful output has overlay_pngs=0 (design baked into the render, not lifted).
        if (false && generationId && (masterArtboardDesignUrl || masterArtboardUrl) && (params.companyName || params.bulletPoints?.length)) {
          const tagline = Array.isArray(params.bulletPoints) ? params.bulletPoints.filter(Boolean).join(' · ') : '';
          supabase.functions
            .invoke('designpro-separate', {
              body: {
                generationId,
                backgroundUrl: masterArtboardDesignUrl || masterArtboardUrl,
                companyName: params.companyName || '',
                tagline,
                stylePrompt: params.style || '',
              },
            })
            .then(({ error: sepErr }) => {
              if (sepErr) console.warn('[DesignIQ] branding separation failed:', sepErr.message);
              else console.log('[DesignIQ] separated branding layers saved for', generationId);
            })
            .catch((e) => console.warn('[DesignIQ] branding separation threw:', e));
        }
        // DesignIQ AI render — views 2-7 must clone view 1 via
        // design-panel-ai-generate's originalRenderUrl path. This prevents
        // drift from re-feeding VisionBoard refs on each camera angle.
        setIsDesignIQRender(true);
        // Capture design name + anchor + DesignID from AI
        if (data.designName) setDesignName(data.designName);
        if (data.designDnaId) setDesignDnaId(data.designDnaId);
        if (data.did) setRenderDid(data.did);
        if (data.pt) setRenderPt(data.pt);
        // Design Anchor: structured text description for cross-view continuity
        if (data.designAnchorText) {
          setDesignAnchorText(data.designAnchorText);
          console.log('[DesignIQ] Design Anchor captured from DesignIQ hero render');
        }
        // Set panel record for tracking + additional views.
        // If DB insert failed, create a synthetic panel object so additional views work.
        const panel = data.panel || {
          id: data.generationId || crypto.randomUUID(),
          name: data.designName || 'DesignIQ Render',
          ai_generated_name: data.designName || 'DesignIQ Render',
          media_url: data.renderUrl,
        };
        setSelectedPanel(panel);

        // Create or reuse color_visualizations record so renders appear in the app.
        // Cache hits in design-panel-ai-generate return the same designiq_generation_id
        // as the original call — INSERTing blindly creates duplicate sibling rows where
        // one keeps the design name and the other is named "DesignIQ Render", and the
        // auto-fire then puts all 7 views on the wrong row. Upsert by gen_id instead.
        try {
          const userEmail = await getUserEmail();

          // Derive a real fallback name from the prompt instead of stranding the
          // design under "DesignIQ Render" when the edge function returns no name.
          const promptPrefix = (params.prompt || '').trim().split(/\s+/).slice(0, 6).join(' ');
          const fallbackName = promptPrefix || params.style || 'DesignIQ Render';
          const resolvedName = data.designName || fallbackName;

          const adminNotes = JSON.stringify({
            designiq_generation_id: generationId,
            designiq_mode: params.mode || 'restyle',
            vehicle_type: vehicleType,
            original_prompt: params.prompt || null,
            company_name: params.companyName || null,
            mascot: params.mascot || null,
            industry_type: params.industryType || null,
            brand_keywords: params.bulletPoints || null,
            style_preset: params.style || null,
          });

          // Look for an existing row for this generation (same user + same gen_id).
          // If found, update its hero in place — never create a sibling row.
          let existingVizId: string | null = null;
          if (generationId && userEmail) {
            const { data: existingRows } = await supabase
              .from('color_visualizations')
              .select('id, render_urls, design_file_name')
              .eq('customer_email', userEmail)
              .filter('admin_notes', 'ilike', `%${generationId}%`)
              .limit(5);
            const match = (existingRows || []).find((r: any) => {
              try {
                const notes = JSON.parse(r.admin_notes || '{}');
                return notes.designiq_generation_id === generationId;
              } catch {
                return false;
              }
            });
            if (match) existingVizId = match.id;
          }

          if (existingVizId) {
            // UPDATE path — preserve existing render_urls (auto-fire may have already
            // populated other views) and only refresh side + name.
            const { data: existing } = await supabase
              .from('color_visualizations')
              .select('render_urls, design_file_name')
              .eq('id', existingVizId)
              .single();
            const mergedUrls = {
              ...((existing?.render_urls as Record<string, string>) || {}),
              side: data.renderUrl,
            };
            // Don't downgrade a real design name to "DesignIQ Render"
            const keepName = (existing?.design_file_name && existing.design_file_name !== 'DesignIQ Render')
              ? existing.design_file_name
              : resolvedName;
            const { error: updateErr } = await supabase
              .from('color_visualizations')
              .update({
                render_urls: mergedUrls,
                custom_design_url: data.renderUrl,
                custom_swatch_url: data.renderUrl,
                color_name: keepName,
                design_file_name: keepName,
                vehicle_type: vehicleType,
                custom_styling_prompt_key: params.prompt || null,
                admin_notes: adminNotes,
                updated_at: new Date().toISOString(),
              })
              .eq('id', existingVizId);
            if (updateErr) {
              console.error('[DesignIQ] Failed to update existing color_visualizations:', updateErr.message);
            } else {
              console.log('[DesignIQ] Reused existing color_visualizations record:', existingVizId);
              setVisualizationId(existingVizId);
            }
          } else {
            const vizData: Record<string, unknown> = {
              customer_email: userEmail,
              vehicle_year: vehicleInfo?.year ? parseInt(vehicleInfo.year) : null,
              vehicle_make: vehicleInfo?.make?.trim().toLowerCase() || null,
              vehicle_model: vehicleInfo?.model?.trim().toLowerCase() || null,
              vehicle_type: vehicleType,
              mode_type: 'designpanelpro',
              color_name: resolvedName,
              color_hex: '#000000',
              finish_type: (params.finish as string) || 'gloss',
              render_urls: { side: data.renderUrl },
              generation_status: 'completed',
              is_saved: true,
              custom_design_url: data.renderUrl,
              custom_swatch_url: data.renderUrl,
              design_file_name: resolvedName,
              custom_styling_prompt_key: params.prompt || null,
              admin_notes: adminNotes,
            };

            const { data: vizRecord, error: vizError } = await supabase
              .from('color_visualizations')
              .insert(vizData)
              .select('id')
              .single();

            if (vizError) {
              console.error('[DesignIQ] Failed to create color_visualizations record:', vizError.message);
            } else {
              console.log('[DesignIQ] Created color_visualizations record:', vizRecord.id);
              setVisualizationId(vizRecord.id);
            }
          }
        } catch (vizErr) {
          console.error('[DesignIQ] Error creating color_visualizations:', vizErr);
        }

        // The durable Entice Pack workflow is submitted only after the complete
        // view set is saved. Do not start it from this hero-only path.

        toast({
          title: data.designName || "Design Rendered",
          description: "Your DesignProAI™ vehicle render is ready!",
        });
        return { generationId, directRender: true, renderUrl: data.renderUrl };
      }

      // Fallback: panel-only response (library panels, older flow)
      if (data?.success && data?.panel) {
        setSelectedPanel(data.panel);
        toast({
          title: "Panel Generated",
          description: "Your DesignIQ panel is ready - select it to render on a vehicle!",
        });
        return { generationId, directRender: false };
      }

      throw new Error("No render or panel returned from AI");
    } catch (error: any) {
      console.error("DesignIQ generation error:", error);
      const friendlyMsg = error.message?.includes('timed out')
        ? "The AI took too long on this one — give it another shot!"
        : error.message || "Something went wrong — let's try again!";
      setGenerationError(friendlyMsg);
      return { generationId: null, directRender: false, error: friendlyMsg };
    } finally {
      setIsGeneratingPanel(false);
    }
  };

  // ===========================================================================
  // PERSONA PIPELINE - 4-persona architecture (activated by ?pipeline=persona)
  // ===========================================================================

  const [personaPhase, setPersonaPhase] = useState<PersonaPipelinePhase>("designer");
  const [personaHeroUrl, setPersonaHeroUrl] = useState<string | null>(null);
  const [personaDesignAnchor, setPersonaDesignAnchor] = useState<string | null>(null);
  const [personaDesignName, setPersonaDesignName] = useState<string | null>(null);
  const [personaGenerationId, setPersonaGenerationId] = useState<string | null>(null);
  const [personaAllViews, setPersonaAllViews] = useState<Record<string, string>>({});
  const [personaFailedShots, setPersonaFailedShots] = useState<string[]>([]);
  const [personaPhotographerProgress, setPersonaPhotographerProgress] = useState<{ completed: number; total: number }>({ completed: 0, total: 6 });
  const [isPersonaPipelineActive, setIsPersonaPipelineActive] = useState(false);
  const [personaElapsed, setPersonaElapsed] = useState(0);

  // Persona pipeline timer
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isPersonaPipelineActive) {
      setPersonaElapsed(0);
      interval = setInterval(() => setPersonaElapsed((p) => p + 1), 1000);
    } else {
      setPersonaElapsed(0);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isPersonaPipelineActive]);

  /**
   * Persona 2: Call Designer edge function with user's prompt directly.
   * No CSR enrichment - user provides direction via VisionBoardIQ, notes, and mode toggle.
   */
  const runPersonaDesigner = async (
    approvedBrief: string,
    params: DesignIQParams,
    vehicleInfo?: { year: string; make: string; model: string },
    modeOverride?: string
  ): Promise<boolean> => {
    setIsPersonaPipelineActive(true);
    setPersonaPhase("designer");
    setPersonaHeroUrl(null);
    setPersonaAllViews({});
    setPersonaFailedShots([]);

    try {
      const { data, error } = await supabase.functions.invoke("design-panel-ai-generate", {
        body: {
          prompt: approvedBrief,
          mode: modeOverride || params.mode,
          finish: params.finish,
          companyName: params.companyName,
          phone: params.phone,
          mascot: params.mascot,
          industryType: params.industryType,
          bulletPoints: params.bulletPoints,
          visionBoardImages: params.visionBoardImages,
          visionboard_intent: params.visionboard_intent,
          vehicleYear: vehicleInfo?.year,
          vehicleMake: vehicleInfo?.make,
          vehicleModel: vehicleInfo?.model,
        },
      });

      if (error) {
        const detail = data?.message || data?.error || error.message;
        throw new Error(detail || "Designer render failed");
      }

      if (!data?.renderUrl) {
        throw new Error("No render returned from designer");
      }

      setPersonaHeroUrl(data.renderUrl);
      setPersonaDesignAnchor(data.designAnchorText || null);
      setPersonaDesignName(data.designName || null);
      setPersonaGenerationId(data.generationId || null);

      // Set as main display too
      setGeneratedImageUrl(data.renderUrl);
      if (data.designName) setDesignName(data.designName);
      if (data.did) setRenderDid(data.did);
      if (data.pt) setRenderPt(data.pt);

      toast({
        title: data.designName || "Design Rendered",
        description: "Hero shot ready! Click 'All Views' for 6 magazine-quality angles.",
      });

      // Don't auto-run photographer - let user click "All Views" when ready.
      // This keeps the first render fast (~30-60s) instead of blocking for 5+ min.
      setPersonaPhase("complete");
      setIsPersonaPipelineActive(false);

      return true;
    } catch (err: any) {
      console.error("Persona Designer error:", err);
      toast({
        title: "Design Generation Failed",
        description: err.message || "Designer render failed",
        variant: "destructive",
      });
      setIsPersonaPipelineActive(false);
      return false;
    }
  };

  /**
   * Persona 3: Photographer - renders 6 angles ONE AT A TIME.
   * Each shot appears in the UI as soon as it completes.
   * Runs AUTOMATICALLY after Persona 2 completes.
   */
  const PHOTOGRAPHER_SHOTS = [
    { key: "side", label: "Driver Side" },
    { key: "passenger-side", label: "Passenger Side (Mirror)" },
    { key: "hood_detail", label: "Hood Overhead" },
    { key: "front", label: "Front" },
    { key: "rear", label: "Rear" },
    { key: "close-up", label: "Close-Up" },
    { key: "roof", label: "Roof" },
  ];

  const runPersonaPhotographer = async (
    anchor: string,
    heroUrl: string,
    genId: string | null,
    vehicleInfo?: { year: string; make: string; model: string },
    finish?: string
  ): Promise<void> => {
    setIsPersonaPipelineActive(true);
    setPersonaPhase("photographer");
    setPersonaPhotographerProgress({ completed: 0, total: PHOTOGRAPHER_SHOTS.length });
    setPersonaAllViews({});
    setPersonaFailedShots([]);

    const completedUrls: Record<string, string> = {};
    const failed: string[] = [];

    // Phase 1: Driver side is the hero (already rendered)
    completedUrls['side'] = heroUrl;
    setPersonaAllViews({ ...completedUrls });
    setPersonaPhotographerProgress({ completed: 1, total: PHOTOGRAPHER_SHOTS.length });

    // Phase 2+3: AI generation for all remaining views (including passenger-side for correct text)
    console.log('[Persona 3] Phase 2: AI fan-out for remaining views (passenger-side AI-generated for text safety)...');
    const aiShots = PHOTOGRAPHER_SHOTS.filter(
      s => s.key !== 'side'
    );

    const parallelPromises = aiShots.map((shot, index) => {
      return new Promise<{ key: string; url: string | null }>((resolve) => {
        // 200ms stagger between calls to prevent 429 rate limiting
        setTimeout(async () => {
          try {
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Shot timeout')), 30000)
            );
            // Build a prompt that reproduces the hero design from a different angle.
            // The edge function requires `prompt` (returns 400 without it).
            // Include anchor text IN the prompt since the edge function doesn't
            // read `designAnchorText` from the body - it only reads DesignIQParams fields.
            const viewPrompt = anchor
              ? `Same wrap from a different angle. Match this driver-side design exactly:\n${anchor}`
              : 'Reproduce the attached wrap design from a different camera angle.';
            const result = await Promise.race([
              supabase.functions.invoke("design-panel-ai-generate", {
                body: {
                  prompt: viewPrompt,
                  originalRenderUrl: heroUrl,
                  vehicleYear: vehicleInfo?.year,
                  vehicleMake: vehicleInfo?.make,
                  vehicleModel: vehicleInfo?.model,
                  finish: finish || "Gloss",
                  viewType: shot.key,
                  mode: "restyle",
                },
              }),
              timeoutPromise,
            ]) as { data: any; error: any };

            const { data, error } = result;
            if (error || !data?.renderUrl) {
              const detail = data?.message || data?.error || error?.message || "Shot failed";
              console.error(`[Persona 3] ${shot.key} failed:`, detail);
              resolve({ key: shot.key, url: null });
            } else {
              console.log(`[Persona 3] ${shot.key} OK: ${data.renderUrl}`);
              resolve({ key: shot.key, url: data.renderUrl });
            }
          } catch (err: any) {
            console.error(`[Persona 3] ${shot.key} error:`, err?.message);
            resolve({ key: shot.key, url: null });
          }
        }, index * 200);
      });
    });

    // As each settles, update UI progressively
    for (const promise of parallelPromises) {
      const result = await promise;
      if (result.url) {
        completedUrls[result.key] = result.url;
      } else {
        failed.push(result.key);
      }
      setPersonaAllViews({ ...completedUrls });
      setPersonaFailedShots([...failed]);
      setPersonaPhotographerProgress({ completed: Object.keys(completedUrls).length, total: PHOTOGRAPHER_SHOTS.length });

      // Update allViews for proof sheets / existing UI
      const viewsArray = Object.entries(completedUrls).map(([type, url]) => ({ type, url }));
      setAllViews(viewsArray);
    }

    setPersonaPhase("complete");
    setIsPersonaPipelineActive(false);

    if (failed.length === 0) {
      toast({
        title: "Photo Shoot Complete",
        description: `All ${PHOTOGRAPHER_SHOTS.length} magazine-quality shots ready!`,
      });
    } else {
      toast({
        title: `${Object.keys(completedUrls).length} of ${PHOTOGRAPHER_SHOTS.length} shots complete`,
        description: `${failed.length} shot(s) failed: ${failed.join(", ")}`,
        variant: "destructive",
      });
    }
  };

  /**
   * Full persona pipeline entry point.
   * Called from DesignPanelProPremium when ?pipeline=persona is active.
   * Goes straight to Designer (Persona 2) - no CSR enrichment step.
   * User provides all direction via VisionBoardIQ, prompt, and mode toggle.
   */
  const runPersonaPipeline = async (
    params: DesignIQParams,
    vehicleInfo?: { year: string; make: string; model: string }
  ): Promise<void> => {
    // Determine effective mode: if company name provided in restyle mode, treat as commercial
    const effectiveMode = (params.mode !== "commercial" && params.companyName)
      ? "commercial"
      : params.mode;
    await runPersonaDesigner(params.prompt, params, vehicleInfo, effectiveMode);
  };

  return {
    vehicleType,
    setVehicleType,
    nonStandardSpecs,
    setNonStandardSpecs,
    selectedPanel,
    setSelectedPanel,
    selectedFinish,
    setSelectedFinish,
    curatedPanels,
    isLoading,
    generateRender,
    isGenerating,
    generatedImageUrl,
    setGeneratedImageUrl,
    visualizationId,
    allViews,
    generateAdditionalViews,
    isGeneratingAdditional,
    failedViews,
    retryFailedView,
    isRetryingView,
    designAnchorText,
    designName,
    designDnaId,
    renderDid,
    renderPt,
    uploadMode,
    setUploadMode,
    showUpgradeModal,
    setShowUpgradeModal,
    showLoginModal,
    setShowLoginModal,
    clearLastRender,
    flatProofUrl,
    coverageType,
    setCoverageType,
    generationError,
    clearGenerationError: () => setGenerationError(null),
    saveDesignJob,
    isGeneratingPanel,
    generateFromPrompt,
    // Persona pipeline exports
    runPersonaPipeline,
    runPersonaDesigner,
    runPersonaPhotographer,
    personaPhase,
    personaHeroUrl,
    personaDesignAnchor,
    personaDesignName,
    personaGenerationId,
    personaAllViews,
    personaFailedShots,
    personaPhotographerProgress,
    isPersonaPipelineActive,
    personaElapsed,
  };
};
