import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import {
  handoffGeneration,
  listDesignPanelViews,
  regenerateDesignPanelView,
  startStandaloneGeneration,
  waitForGeneration,
} from "@/lib/designpanelpro-standalone-adapter";
import { selectCustomerProof } from "@/lib/designpro-artifact-selectors";
import {
  dpApi,
  FLAT_FIRST_ATLAS_PIPELINE_MODE,
  RENDER_ROLES,
  ROLE_FOR_SOURCE_VIEW_TYPE,
  type AssetIdentity,
  type GenerationPipelineMode,
  type GenerationRequestState,
  type RenderRole,
} from "@/lib/designpro-api";
import { useOrganization } from "@/contexts/OrganizationContext";
import type { DesignIQParams } from "@/lib/designiq-engine";
import { classifyDesignIqCombinedContact } from "@/lib/designpro-input-normalization";

import type { PersonaPipelinePhase } from "@/components/designpanelpro/PersonaPipelineProgress";
import type { CoverageType } from "@/components/tools/CoverageSelector";
import { type VehicleType } from "@/components/tools/VehicleTypeSelector";
import { normalizeDesignProVehicleTypeForIdentity } from "@/lib/designpro-flat-first";
import type { VehicleSpecsPreview } from "@/components/tools/NonStandardVehicleWarning";

type KitSize = "small" | "medium" | "large" | "xl";
type RoofSize = "none" | "small" | "medium" | "large";

/**
 * COVERAGE NO LONGER SELECTS THE VIEW SET.
 *
 * These helpers used to translate the kit options into "which angles do we
 * render", because the browser decided that. The frozen seam does not leave it
 * open: SURFACE_KEYS is exactly six surfaces and Calls 1-7 always produce all
 * seven views, so a design is never missing the side someone later orders. The
 * kit controls still price the job -- they simply stop deciding what exists.
 */

type GenerationError = 'auth_required' | 'limit_reached' | 'generation_failed';

const ATLAS_NEW_RUN_REQUIRED_MESSAGE =
  "This saved A.T.L.A.S. proof set cannot be reused. Start a new A.T.L.A.S. run.";
const atlasNewRunRequired = (error: unknown) => {
  const code = String((error as any)?.code || (error as any)?.message || error || "");
  return code.includes("flat_first_atlas_new_run_required")
    || code.includes("generation_atlas_lineage_invalid");
};

const RUNTIME_VISIONBOARD_IMAGE_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const RUNTIME_LOGO_TYPES = new Map([
  ...RUNTIME_VISIONBOARD_IMAGE_TYPES,
  ["image/svg+xml", "svg"],
]);

type SignedDesignPanelView = {
  sourceViewType: string;
  consumerRole: string;
  signedUrl?: string;
};

/**
 * Driver Side is the primary customer proof in both compatible seven-view
 * plans. Close-Up and historical Hero remain seventh-slot proofs; neither may
 * displace Driver merely because it completed first.
 */
export function pickPrimaryProofView<T extends SignedDesignPanelView>(
  views: T[],
): T | undefined {
  const rendered = views.filter((view) => view.signedUrl);
  return rendered.find((view) =>
    view.consumerRole === "driver" && view.sourceViewType === "side" && view.signedUrl);
}

/** Convert browser-displayable image formats outside the runtime allowlist. */
const normalizeVisionBoardImage = async (blob: Blob, label: string): Promise<File> => {
  const contentType = String(blob.type || "").toLowerCase();
  const allowedExtension = RUNTIME_VISIONBOARD_IMAGE_TYPES.get(contentType);
  if (allowedExtension) {
    return new File([blob], `${label}.${allowedExtension}`, { type: contentType });
  }
  if (!contentType.startsWith("image/")) {
    throw new Error("A VisionBoard reference is not a supported image file.");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const candidate = new Image();
      candidate.onload = () => resolve(candidate);
      candidate.onerror = () => reject(new Error("A VisionBoard reference could not be converted to PNG."));
      candidate.src = objectUrl;
    });
    if (!image.naturalWidth || !image.naturalHeight) {
      throw new Error("A VisionBoard reference has no readable image dimensions.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("A VisionBoard reference could not be converted to PNG.");
    context.drawImage(image, 0, 0);
    const png = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (result) => result ? resolve(result) : reject(new Error("A VisionBoard reference could not be converted to PNG.")),
        "image/png",
      );
    });
    return new File([png], `${label}.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const normalizeLogoAsset = async (blob: Blob): Promise<File> => {
  const contentType = String(blob.type || "").toLowerCase();
  const allowedExtension = RUNTIME_LOGO_TYPES.get(contentType);
  return allowedExtension
    ? new File([blob], `logo.${allowedExtension}`, { type: contentType })
    : normalizeVisionBoardImage(blob, "logo");
};

export const useDesignPanelProLogic = (initialVehicleType: VehicleType = "car") => {
  const { toast } = useToast();
  const { checkCanGenerate } = useSubscriptionLimits();
  const { currentShop } = useOrganization();

  // Vehicle type routing — cars stay on locked generate-color-render;
  // motorcycle/boat/bus/rv route to dedicated render-<type> edge functions
  const [vehicleType, setVehicleType] = useState<VehicleType>(initialVehicleType);
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
  const [activePipelineMode, setActivePipelineMode] = useState<GenerationPipelineMode>("legacy");
  /** The standalone request behind the design on screen. */
  const [standaloneRequestId, setStandaloneRequestId] = useState<string | null>(null);
  /** Latest server state; used for honest status instead of elapsed-time guesses. */
  const [generationRequestState, setGenerationRequestState] = useState<GenerationRequestState | null>(null);
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
    // The A.T.L.A.S. before/after query is keyed by the accepted request.
    // Clearing it before a new launch prevents the previous canonical master
    // from being displayed while the next request is still in preflight.
    setStandaloneRequestId(null);
    setGenerationRequestState(null);
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

  // THE CUSTOMER'S 2D PRODUCTION PROOF, FROM CALL 8.
  //
  // Bound by role, never by kind: Call 8 emits seven "flat-proof" artifacts and
  // only one of them is the sheet the customer approves. selectCustomerProof is
  // where that rule lives, and it refuses to guess between two.
  //
  // Polling continues after the proof is found because these URLs are signed
  // for five minutes. A page left open would otherwise show a proof that had
  // silently expired into a broken image, which reads as "the design is gone".
  //
  // Both pipelines poll here. A.T.L.A.S. used to be excluded because it stopped
  // before the production handoff; now that its button reaches the same Calls
  // 8+ chain, excluding it would hide the very artifact the run exists to
  // validate -- the customer 2D Production Proof.
  const { data: customerProofUrl } = useQuery({
    queryKey: ["designpro-customer-proof", visualizationId],
    enabled: !!visualizationId,
    retry: false,
    queryFn: async () => {
      const artifacts = await dpApi.listArtifacts(String(visualizationId)).catch(() => []);
      return selectCustomerProof(artifacts)?.signedUrl ?? null;
    },
    refetchInterval: (query) => (query.state.data ? 240_000 : 5_000),
  });

  const { data: productionJobStatus = null } = useQuery({
    queryKey: ["designpro-production-job", visualizationId],
    enabled: !!visualizationId,
    retry: false,
    queryFn: () => dpApi.getStatus(String(visualizationId)).catch(() => null),
    refetchInterval: (query) => query.state.data?.state === "complete" ? 240_000 : 5_000,
  });

  useEffect(() => {
    if (customerProofUrl) setFlatProofUrl(customerProofUrl);
  }, [customerProofUrl]);

  // The atlas before/after pair owned by the gateway: the deterministic guide
  // and the Gemini-painted canonical master. This is the flattened top-view
  // design the designer reviews, and it stays on screen alongside the seven
  // proofs and the Call 8 sheet the same run now produces. Signed image URLs
  // are refreshed before their five-minute expiry just like proof URLs.
  const {
    data: flatAtlasRevisions = [],
    error: flatAtlasLoadError,
  } = useQuery({
    queryKey: ["designpro-flat-atlas-revisions", standaloneRequestId],
    enabled:
      activePipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE &&
      !!standaloneRequestId,
    retry: false,
    queryFn: () => dpApi.listFlatAtlasRevisions(String(standaloneRequestId)),
    refetchInterval: (query) => {
      const revisions = query.state.data || [];
      const latest = revisions[revisions.length - 1];
      // A metadata row is not display-ready. Keep asking until the gateway can
      // sign the canonical master, then refresh before the five-minute URL
      // expires. This prevents a silent four-minute blank Atlas window.
      return latest?.masterUrl ? 240_000 : 2_000;
    },
  });

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

  // A completed legacy A.T.L.A.S. row can carry seven signed images while
  // lacking the current immutable-master lineage, provider audit or semantic
  // QC. Once the owner-read boundary reports that condition, remove every
  // display identity for that request. In particular, never let the generic
  // terminal-error recovery below put those old images back on screen.
  const clearUntrustedAtlasProofState = () => {
    setGeneratedImageUrl(null);
    setVisualizationId(null);
    setAllViews([]);
    setFailedViews([]);
    setDesignAnchorText(null);
    setDesignName(null);
    setDesignDnaId(null);
    setRenderDid(null);
    setRenderPt(null);
    setFlatProofUrl(null);
    setStandaloneRequestId(null);
    setGenerationRequestState(null);
    setIsDesignIQRender(false);
    setPersonaHeroUrl(null);
    setPersonaDesignAnchor(null);
    setPersonaDesignName(null);
    setPersonaGenerationId(null);
    setPersonaAllViews({});
    setPersonaFailedShots([]);
    setPersonaPhotographerProgress({ completed: 0, total: RENDER_ROLES.length });
  };

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

  /* ── CALLS 1-7, SERVER-OWNED ────────────────────────────────────────────
   *
   * Every control above this line is unchanged. What changed is who does the
   * work. The browser used to conduct the pipeline: one invoke for the hero,
   * six more for the other angles, a mirror computed locally, then rows written
   * into color_visualizations and designiq_generations by hand. A backgrounded
   * tab stalled a paid design mid-run, and the identity of a design depended on
   * whether those writes landed.
   *
   * Now the browser submits one request and reports what the server produced.
   * The runtime owns the seven views, their order, their retries and their
   * identity; the generationId it returns is the same id Calls 8-12, the
   * production layers, the pack and WrapBox are all keyed by. There is nothing
   * left here to get out of step with them.
   */

  /**
   * The customer's uploaded logo, carried into the runtime as identity.
   *
   * The page stages logos as public URLs while the customer is still editing.
   * The runtime will not take a URL: it wants a storage path and a content hash
   * it verified itself, so that the bytes composited into the wrap are provably
   * the bytes the customer supplied and a file swapped afterwards fails closed
   * instead of printing. So the staged bytes are re-uploaded through
   * upload-intents -> signed PUT -> verify, and identity is what travels.
   *
   * A logo that cannot be fetched is reported, not skipped: the customer asked
   * for their logo, and a design generated silently without it is a wrong design
   * that looks finished.
   */
  const verifyLogoAsset = async (
    params: DesignIQParams,
    generationId: string,
  ): Promise<AssetIdentity | undefined> => {
    const staged = (params.textLayerVisionBoardImages || []).find((image) => image?.storageUrl);
    if (!staged?.storageUrl) return undefined;
    const response = await fetch(staged.storageUrl);
    if (!response.ok) {
      throw new Error(`Your logo could not be read back for verification (${response.status}).`);
    }
    const blob = await response.blob();
    const uploadFile = await normalizeLogoAsset(blob);
    return dpApi.uploadRevisionAsset(
      generationId,
      "logo",
      uploadFile,
    );
  };

  /**
   * VisionBoardIQ images travel to the runtime as byte-verified identities,
   * never as public or expiring URLs. Uploads run in parallel and are bounded
   * by the same six-reference ceiling enforced at the gateway.
   */
  const verifyVisionBoardAssets = async (
    params: DesignIQParams,
    generationId: string,
  ): Promise<AssetIdentity[]> => {
    const unique = Array.from(
      new Map(
        (params.visionBoardImages || [])
          .filter((image) => image?.storageUrl)
          .map((image) => [image.storageUrl, image]),
      ).values(),
    ).slice(0, 6);

    return Promise.all(unique.map(async (image, index) => {
      const response = await fetch(image.storageUrl);
      if (!response.ok) {
        throw new Error(
          `VisionBoard image ${index + 1} could not be read back for verification (${response.status}).`,
        );
      }
      const blob = await response.blob();
      const safeLabel = String(image.slotLabel || `visionboard-${index + 1}`)
        .replace(/[^a-z0-9._-]+/gi, "-")
        .replace(/^-+|-+$/g, "") || `visionboard-${index + 1}`;
      const uploadFile = await normalizeVisionBoardImage(blob, safeLabel);
      return dpApi.uploadRevisionAsset(
        generationId,
        "attachment",
        uploadFile,
      );
    }));
  };

  const explicitWebsite = (params: DesignIQParams): string | undefined => {
    const line = String(params.textLayerPrompt || "")
      .split(/\r?\n/)
      .find((value) => /^\s*(?:website|web|url)\s*:/i.test(value));
    return line?.replace(/^\s*(?:website|web|url)\s*:\s*/i, "").trim() || undefined;
  };

  /** The seven views, as the UI has always shaped them. */
  const applyGeneratedViews = (
    views: Array<{ sourceViewType: string; consumerRole: string; signedUrl?: string }>,
  ) => {
    const rendered = views.filter((view) => view.signedUrl);
    setAllViews(rendered.map((view) => ({ type: view.sourceViewType, url: view.signedUrl! })));
    const primary = pickPrimaryProofView(rendered);
    if (primary?.signedUrl) setGeneratedImageUrl(primary.signedUrl);
    setFailedViews(
      views.filter((view) => !view.signedUrl).map((view) => view.sourceViewType),
    );
  };

  /** Server-reported progress, mirrored into the state the UI already renders. */
  const applyGenerationState = (state: GenerationRequestState) => {
    setGenerationRequestState(state);
    setPersonaPhase(
      state.phase === "photographer" || state.phase === "complete" ? "photographer" : "designer",
    );
    setPersonaPhotographerProgress({
      completed: state.shotsComplete ?? 0,
      total: state.shotsTotal ?? RENDER_ROLES.length,
    });
    setPersonaFailedShots((state.failedShots || []).map((shot) => shot.sourceViewType));
    if (state.designName) {
      setDesignName(state.designName);
      setPersonaDesignName(state.designName);
    }
    if (state.designAnchor) {
      setDesignAnchorText(state.designAnchor);
      setPersonaDesignAnchor(state.designAnchor);
    }
  };

  /**
   * Submit one design and wait for the whole approved view set.
   *
   * Both entry points below run through here, so the persona surface and the
   * standard surface observe the same run rather than two pipelines that can
   * disagree about what the design is.
   */
  const runStandaloneGeneration = async (
    params: DesignIQParams,
    vehicleInfo?: { year: string; make: string; model: string },
    pipelineMode: GenerationPipelineMode = "legacy",
  ): Promise<{ generationId: string | null; directRender: boolean; renderUrl?: string; error?: string }> => {
    clearLastRender();
    setActivePipelineMode(pipelineMode);
    setAllViews([]);
    setFailedViews([]);
    setGenerationError(null);

    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return { generationId: null, directRender: false, error: "limit_reached" };
    }

    // The id is minted here and never changes. The runtime treats a generationId
    // as naming exactly one design -- resubmitting it with a different brief is
    // a 409, not a retry -- because every Call 8 proof region and Call 9 panel
    // points back at it.
    const generationId = crypto.randomUUID().toLowerCase();
    const promptPrefix = (params.prompt || "").trim().split(/\s+/).slice(0, 6).join(" ");
    let acceptedRequest: GenerationRequestState | null = null;

    try {
      const [logoAsset, visionBoardImages] = await Promise.all([
        verifyLogoAsset(params, generationId),
        verifyVisionBoardAssets(params, generationId),
      ]);
      const combinedContact = classifyDesignIqCombinedContact(params.phone);
      const request = await startStandaloneGeneration({
        generationId,
        // The customer's own words, unrewritten. No pre-pass stands between the
        // brief and the design brain.
        brief: (params.prompt || "").trim(),
        designName: params.companyName?.trim() || promptPrefix || "DesignProAI",
        vehicle: {
          year: String(vehicleInfo?.year || "").trim(),
          make: String(vehicleInfo?.make || "").trim(),
          model: String(vehicleInfo?.model || "").trim(),
          type: normalizeDesignProVehicleTypeForIdentity(
            vehicleType,
            vehicleInfo?.make,
            vehicleInfo?.model,
          ),
        },
        // A company name means commercial whatever the toggle says -- the rule
        // the proven intake has always applied.
        mode: params.companyName?.trim() ? "commercial" : params.mode,
        companyName: params.companyName?.trim() || undefined,
        phone: combinedContact.phone,
        industry: params.industryType || undefined,
        colors: String(params.brandColors || "")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
        finish: params.finish || selectedFinish,
        substrate: params.substrate,
        mascot: params.mascot?.trim() || undefined,
        bulletPoints: (params.bulletPoints || []).map((value) => value.trim()).filter(Boolean),
        brandColors: params.brandColors?.trim() || undefined,
        fontStyle: params.fontStyle?.trim() || undefined,
        qrEnabled: params.qrEnabled,
        qrUrl: params.qrUrl?.trim() || undefined,
        visionBoardImages,
        visionboardIntent: params.visionboard_intent,
        textLayerPrompt: params.textLayerPrompt?.trim() || undefined,
        website: explicitWebsite(params) || combinedContact.website,
        logoAsset,
        pipelineMode,
      });
      acceptedRequest = request;
      const acceptedPipelineMode = request.pipelineMode || "legacy";
      setActivePipelineMode(acceptedPipelineMode);
      if (acceptedPipelineMode !== pipelineMode) {
        throw new Error("generation_pipeline_mode_mismatch");
      }

      setStandaloneRequestId(request.requestId);
      // The design's id everywhere downstream: production layers, the pack, the
      // QC certificate and WrapBox all key by this one value.
      setVisualizationId(request.generationId);
      setIsDesignIQRender(true);
      applyGenerationState(request);

      const finished = await waitForGeneration(request.requestId, {
        onState: applyGenerationState,
        // Both modes reveal each immutable view as it lands. This observer only
        // performs signed GETs; closing or sleeping the browser cannot start,
        // cancel, repeat, or spend a generation call.
        onViews: async (progressiveViews) => {
          applyGeneratedViews(progressiveViews);
          const progressivePrimary = pickPrimaryProofView(progressiveViews);
          setPersonaHeroUrl(progressivePrimary?.signedUrl || null);
          setPersonaGenerationId(request.generationId);
          setPersonaAllViews(Object.fromEntries(
            progressiveViews
              .filter((view) => view.signedUrl)
              .map((view) => [view.sourceViewType, view.signedUrl!]),
          ));
        },
      });
      applyGenerationState(finished);

      const views = await listDesignPanelViews(request.requestId);
      applyGeneratedViews(views);
      const primary = pickPrimaryProofView(views);
      setPersonaHeroUrl(primary?.signedUrl || null);
      setPersonaGenerationId(request.generationId);
      setPersonaAllViews(
        Object.fromEntries(
          views.filter((view) => view.signedUrl).map((view) => [view.sourceViewType, view.signedUrl!]),
        ),
      );

      // The customer-facing DesignPanel page is the front door to the ONE
      // production chain, not a seven-image dead end. Once the server proves
      // the view set is complete, freeze those exact immutable views into the
      // existing Calls 8+ workflow. The endpoint is idempotent, owns the Call 8
      // proof/panel sequence, and cannot create a second producer.
      //
      // BOTH pipelines hand off here. A.T.L.A.S. was previously excluded as a
      // proof-only experiment, which made its run a dead end: a canonical
      // master, six separated surfaces and seven proofs, and then nothing to
      // validate downstream. Trish promoted the split path on 2026-08-23 -- the
      // A.T.L.A.S. button must reach the existing file-output pipeline. It
      // enters through this same idempotent endpoint, behind the same
      // seven-view readiness check, and the server's own flat-first gate still
      // refuses a run whose canonical master never passed acceptance.
      if (finished.handoffReady !== true) {
        throw new Error(
          `generation_handoff_blocked:${finished.handoffBlocker || "unknown"}`,
        );
      }
      const handoff = await handoffGeneration(request.requestId);
      if (handoff.generationId !== request.generationId) {
        throw new Error("generation_handoff_identity_mismatch");
      }

      toast({
        title: finished.designName || "Design Rendered",
        description:
          pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE
            ? "Your A.T.L.A.S. master and seven vehicle views are saved. The server started Call 8 and the production job now reports its real status."
            : "Your seven DesignProAI™ views are saved. The server started Call 8 and the production job now reports its real status.",
      });
      return { generationId: request.generationId, directRender: true, renderUrl: primary?.signedUrl };
    } catch (error: any) {
      const code = String(error?.code || error?.message || "");
      const requiresNewAtlasRun = atlasNewRunRequired(error);
      const freshAtlasMasterQcFailure =
        acceptedRequest?.pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE
        && code.includes("flat_atlas_master_qc_failed");
      if (requiresNewAtlasRun || freshAtlasMasterQcFailure) clearUntrustedAtlasProofState();
      // A terminal request can still own byte-verified views. The legacy
      // worker used to discover a missing production manifest only after all
      // seven calls; hiding those saved images behind the error screen made a
      // paid proof set look deleted. Recover owner-scoped signed views before
      // reporting the failure. They remain explicitly legacy and are never
      // represented as an A.T.L.A.S. master.
      let recoveredViews: Awaited<ReturnType<typeof listDesignPanelViews>> = [];
      if (acceptedRequest && !requiresNewAtlasRun) {
        try {
          recoveredViews = await listDesignPanelViews(acceptedRequest.requestId);
          if (recoveredViews.some((view) => view.signedUrl)) {
            applyGeneratedViews(recoveredViews);
            const primary = pickPrimaryProofView(recoveredViews);
            setPersonaHeroUrl(primary?.signedUrl || null);
            setPersonaGenerationId(acceptedRequest.generationId);
            setPersonaAllViews(Object.fromEntries(
              recoveredViews
                .filter((view) => view.signedUrl)
                .map((view) => [view.sourceViewType, view.signedUrl!]),
            ));
          }
        } catch {
          recoveredViews = [];
        }
      }
      const friendly =
        requiresNewAtlasRun
          ? ATLAS_NEW_RUN_REQUIRED_MESSAGE
          : freshAtlasMasterQcFailure
          ? "A.T.L.A.S. rejected the new flattened master during visual quality inspection. No proof set was saved. Start a new A.T.L.A.S. run."
          : code === "generation_pipeline_mode_mismatch"
          ? "This design mode is temporarily unavailable. No production order was created."
          : code === "generation_input_conflict"
          ? "That design id already holds a different brief. Start a new design rather than overwriting it."
          : /genie_dimension_validation_required/.test(code)
            ? "We could not prepare this vehicle layout. Check the year, make, model, and vehicle type, then try again."
          : /generation_timeout/.test(code)
            ? "The design is taking longer than expected. You can safely return to this page later."
            : error?.message || "Something went wrong — let's try again!";
      console.error("[DesignPro] standalone generation failed:", error);
      setGenerationError(friendly);
      const recoveredPrimary = pickPrimaryProofView(recoveredViews);
      return {
        generationId: requiresNewAtlasRun || freshAtlasMasterQcFailure
          ? null
          : acceptedRequest?.generationId || null,
        directRender: Boolean(recoveredPrimary?.signedUrl),
        renderUrl: recoveredPrimary?.signedUrl,
        error: friendly,
      };
    }
  };

  const generateRender = async (
    _year?: string,
    _make?: string,
    _model?: string,
    _revisionPrompt?: string,
    _originalRenderUrl?: string,
  ): Promise<GenerationError | null> => {
    // The library-panel render has no standalone counterpart. Calls 1-7 take a
    // brief and produce a design; there is no server path that lays a chosen
    // pattern tile onto a vehicle, and inventing one here would be a second
    // producer of approved views. Saying so is the honest outcome -- silently
    // routing it at the brief path would generate a DIFFERENT design from the
    // one the customer picked.
    if (!selectedPanel) return 'generation_failed';
    setGenerationError(
      "Library panels are not part of the DesignProAI production path yet. Describe the wrap you want and generate from the brief.",
    );
    return 'generation_failed';
  };

  /**
   * "All views" -- now a read, not a build.
   *
   * The runtime produced all seven under one request. Re-rendering them from
   * the browser is what used to let the passenger side drift from the driver,
   * so this refreshes what the server already froze.
   */
  const generateAdditionalViews = async (
    _year?: string,
    _make?: string,
    _model?: string,
  ): Promise<GenerationError | null> => {
    if (!standaloneRequestId) return 'generation_failed';
    setIsGeneratingAdditional(true);
    try {
      const state = await dpApi.getGenerationRequest(standaloneRequestId);
      applyGenerationState(state);
      applyGeneratedViews(await listDesignPanelViews(standaloneRequestId));
      return null;
    } catch (error: any) {
      if (atlasNewRunRequired(error)) {
        clearUntrustedAtlasProofState();
        setGenerationError(ATLAS_NEW_RUN_REQUIRED_MESSAGE);
      } else {
        setGenerationError(error?.message || "The views could not be refreshed.");
      }
      return 'generation_failed';
    } finally {
      setIsGeneratingAdditional(false);
    }
  };

  /**
   * Regenerate one angle.
   *
   * The old view is superseded on the server, never mutated, so anything Call 8
   * has already hashed stays trustworthy.
   */
  const retryFailedView = async (
    viewType: string,
    _year?: string,
    _make?: string,
    _model?: string,
  ): Promise<boolean> => {
    if (!standaloneRequestId) return false;
    if (activePipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE) {
      setGenerationError(
        "A.T.L.A.S. proof views are locked to one master. Start a new A.T.L.A.S. run to regenerate the proof set.",
      );
      return false;
    }
    const role = ROLE_FOR_SOURCE_VIEW_TYPE[viewType] as RenderRole | undefined;
    if (!role) return false;
    setIsRetryingView(viewType);
    try {
      await regenerateDesignPanelView({ requestId: standaloneRequestId, role });
      const finished = await waitForGeneration(standaloneRequestId, { onState: applyGenerationState });
      applyGenerationState(finished);
      const views = await listDesignPanelViews(standaloneRequestId);
      applyGeneratedViews(views);
      // Read the answer off the views just fetched. `failedViews` is the state
      // captured when this handler was created, so it still describes the run
      // BEFORE the regenerate -- reporting from it would call every retry a
      // failure and every second retry a success.
      return views.some((view) => view.sourceViewType === viewType && !!view.signedUrl);
    } catch (error: any) {
      setGenerationError(error?.message || `The ${viewType} view could not be regenerated.`);
      return false;
    } finally {
      setIsRetryingView(null);
    }
  };

  /**
   * The design's saved record.
   *
   * The runtime persists the design when it accepts the request, so there is
   * nothing for the browser to insert. This reports the identity the customer's
   * purchase, pack and delivery are all keyed by.
   */
  const saveDesignJob = async (_year?: string, _make?: string, _model?: string) => {
    if (!visualizationId) return null;
    return { id: visualizationId, generation_id: visualizationId, preview_image_url: generatedImageUrl };
  };

  const generateFromPrompt = async (
    params: DesignIQParams,
    vehicleInfo?: { year: string; make: string; model: string },
    pipelineMode: GenerationPipelineMode = "legacy",
  ) => {
    setIsGeneratingPanel(true);
    try {
      return await runStandaloneGeneration(params, vehicleInfo, pipelineMode);
    } finally {
      setIsGeneratingPanel(false);
    }
  };

  /**
   * THE PERSONA SURFACE, READING THE SERVER'S OWN PHASES.
   *
   * The four-persona pipeline used to be a second orchestration living beside
   * the standard one: its own designer invoke, its own six photographer
   * invokes, its own idea of which shots failed. Two browser pipelines for one
   * product is two ways for a design to exist, and they could disagree about
   * which one the customer approved.
   *
   * The standalone runtime already runs exactly this shape and reports it --
   * `phase`, `shotsComplete`, `shotsTotal`, `failedShots`, `designAnchor` are
   * fields on the request itself. So the persona surface keeps every control
   * and every progress readout it had, and observes the one real run instead of
   * conducting a parallel one.
   */
  const runPersonaDesigner = async (
    _approvedBrief: string,
    params: DesignIQParams,
    vehicleInfo?: { year: string; make: string; model: string },
    modeOverride?: string,
    pipelineMode: GenerationPipelineMode = "legacy",
  ): Promise<boolean> => {
    setIsPersonaPipelineActive(true);
    setPersonaPhase("designer");
    setPersonaHeroUrl(null);
    setPersonaAllViews({});
    setPersonaFailedShots([]);
    try {
      const result = await runStandaloneGeneration(
        modeOverride === "commercial" ? { ...params, mode: "commercial" } : params,
        vehicleInfo,
        pipelineMode,
      );
      return !!result.generationId;
    } finally {
      setIsPersonaPipelineActive(false);
    }
  };

  /**
   * The photographer phase is not separately startable any more: one request
   * carries the design through both phases, and the shots are already frozen
   * against the approved design by the time the browser can ask about them.
   * This refreshes what the server has, which is what the surface displays.
   */
  const runPersonaPhotographer = async (
    ..._ignored: unknown[]
  ): Promise<boolean> => {
    if (!standaloneRequestId) return false;
    setIsPersonaPipelineActive(true);
    try {
      const state = await dpApi.getGenerationRequest(standaloneRequestId);
      applyGenerationState(state);
      const views = await listDesignPanelViews(standaloneRequestId);
      applyGeneratedViews(views);
      setPersonaAllViews(
        Object.fromEntries(
          views.filter((view) => view.signedUrl).map((view) => [view.sourceViewType, view.signedUrl!]),
        ),
      );
      return state.state === "outputs_ready";
    } catch (error) {
      if (atlasNewRunRequired(error)) {
        clearUntrustedAtlasProofState();
        setGenerationError(ATLAS_NEW_RUN_REQUIRED_MESSAGE);
      }
      return false;
    } finally {
      setIsPersonaPipelineActive(false);
    }
  };

  const runPersonaPipeline = async (
    params: DesignIQParams,
    vehicleInfo?: { year: string; make: string; model: string },
    pipelineMode: GenerationPipelineMode = "legacy",
  ) => {
    // A company name means commercial whatever the toggle says.
    const effectiveMode =
      params.mode !== "commercial" && params.companyName ? "commercial" : params.mode;
    await runPersonaDesigner(params.prompt, params, vehicleInfo, effectiveMode, pipelineMode);
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
    productionJobStatus,
    activePipelineMode,
    flatAtlasRevisions,
    flatAtlasLoadError,
    coverageType,
    setCoverageType,
    generationError,
    generationRequestState,
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
