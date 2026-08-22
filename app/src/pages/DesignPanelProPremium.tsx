import { useState, useRef, useEffect, useCallback } from "react";
import { Helmet } from "react-helmet-async";
import { AiPanelGenerator } from "@/components/designpanelpro/AiPanelGenerator";
import { DesignIQProgressBar } from "@/components/designpanelpro/DesignIQProgressBar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useFreemiumLimits } from "@/hooks/useFreemiumLimits";
import { useDesignPanelProLogic } from "@/hooks/useDesignPanelProLogic";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { RenderOverlay } from "@/components/tools/RenderOverlay";
import { DesignIDBadge } from "@/components/DesignIDBadge";
import { RenderQualityRating } from "@/components/RenderQualityRating";
import { PaywallModal } from "@/components/PaywallModal";
import { TryForTwentyFiveModal } from "@/components/TryForTwentyFiveModal";
import { SocialEngagementModal } from "@/components/SocialEngagementModal";
import { LoginRequiredModal } from "@/components/LoginRequiredModal";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { ToolContainer } from "@/components/layout/ToolContainer";
import { MyVehicleProToggle } from "@/components/tools/MyVehicleProToggle";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { useMyVehicleMode } from "@/hooks/useMyVehicleMode";
import { useMyVehicleGenerate } from "@/hooks/useMyVehicleGenerate";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import { renderClient } from "@/integrations/supabase/renderClient";
import { PremiumRevisionPrompt, type RevisionRequest } from "@/components/designpanelpro/PremiumRevisionPrompt";
import { LayerLiftRevisionStudio, type OverlayElement } from "@/components/LayerLiftCanvas";
import { cn, toUuidOrNull } from "@/lib/utils";
import type { DesignIQParams, VisionBoardImage } from "@/lib/designiq-engine";
import { setLayer2Handoff, parseTextBriefToPieces } from "@/lib/designLayer2Handoff";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import {
  VehicleTypeSelector,
  isNonStandardVehicle,
  type VehicleType,
} from "@/components/tools/VehicleTypeSelector";
import { PrintProCTAButton } from "@/components/PrintProCTAButton";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { ClipboardSignature as ClipboardSignatureIcon } from "lucide-react";
import { EstimatorDrawer, OpenEstimatorButton } from "@/components/quote/EstimatorDrawer";
import { QuickQuoteSidePanel } from "@/components/quote/QuickQuoteSidePanel";
import { QuickQuoteCard } from "@/components/dashboard/QuickQuoteCard";
import { useEstimator } from "@/hooks/useEstimator";
import { lineItemFromProduct, lineItemFromUpsell, type EstimatorState } from "@/lib/quote-estimator";
import { findProductById } from "@/lib/quote-product-catalog";
import { PrecisionModButtons } from "@/components/quote/PrecisionModButtons";
import {
  usePrecisionModifications,
  type PrecisionModification,
  type PrecisionModResult,
} from "@/hooks/usePrecisionModifications";
import { useQuickQuoteUpsellApply } from "@/hooks/useQuickQuoteUpsellApply";
import type { EffectiveUpsell } from "@/hooks/useEffectiveUpsellCatalog";
import { saveQuote } from "@/lib/quickquote-db";
import { nextOrderNumber } from "@/lib/bulk-prompt-generator";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import {
  Car,
  ChevronDown,
  Loader2,
  Image as ImageIcon,
  ShoppingCart,
  Sparkles,
  Calculator,
  ClipboardSignature,
  Layers,
  RefreshCw,
  AlertTriangle,
  Scissors,
  Package,
  ChevronLeft,
  ChevronRight,
  Plus,
} from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { PersonaPipelineProgress } from "@/components/designpanelpro/PersonaPipelineProgress";
import { DesignPipelineProgress, type PipelineStage } from "@/components/designpanelpro/DesignPipelineProgress";
import { useStarredRenders } from "@/hooks/useStarredRenders";
import { DesignIQShowcase, GenerationWizard, DESIGNPANELPRO_TIPS } from "@/components/tools/GenerationWizard";
import { formatDid } from "@/lib/designId";
import { BuildTag } from "@/components/BuildTag";
import {
  FLAT_FIRST_ATLAS_PIPELINE_MODE,
  type GenerationPipelineMode,
} from "@/lib/designpro-api";
import {
  FLAT_FIRST_ATLAS_UI_ENABLED,
  flatFirstAtlasSupportedVehicleType,
  initialDesignProPipelineMode,
  inlineRevisionEnabledForPipeline,
  myVehiclePhotoFlowEnabledForPipeline,
  normalizeDesignProVehicleType,
} from "@/lib/designpro-flat-first";

/* ── Sprocket wrap design facts for the wizard during view generation ── */
const SPROCKET_DESIGN_FACTS = [
  { fact: "A full vehicle wrap uses 50-75 feet of vinyl material.", pose: "/characters/sproket/sproket-tips.png" },
  { fact: "Printed wraps should be laminated with UV laminate to last 5-7 years outdoors.", pose: "/characters/sproket/sproket-starred.png" },
  { fact: "Glossy lamination makes colors pop. Matte lamination gives a stealth look.", pose: "/characters/sproket/sproket-presenting.png" },
  { fact: "Professional wrap installs take 2-5 days depending on the vehicle and design complexity.", pose: "/characters/sproket/sproket-camera.png" },
  { fact: "Panel designs are printed on 54\" or 60\" wide rolls and tiled across the vehicle.", pose: "/characters/sproket/sproket-clipboard.png" },
  { fact: "Design wraps require precise color profiling - ICC profiles match screen to print.", pose: "/characters/sproket/sproket-laptop.png" },
  { fact: "A design wrap can increase the perceived value of a vehicle by $3,000-$8,000.", pose: "/characters/sproket/sproket-vault-cash.png" },
  { fact: "Bleed and overlap zones on panels prevent white edges at seam lines.", pose: "/characters/sproket/sproket-pencil.png" },
  { fact: "Wrap shops charge $2,500-$8,000 for a custom printed design wrap.", pose: "/characters/sproket/sproket-moneybag.png" },
  { fact: "Chrome delete, roof wraps, and accent kits are the most popular partial wraps.", pose: "/characters/sproket/sproket-rocket-wave.png" },
  { fact: "Every DesignIQ render is designed for real-world production at 150+ DPI.", pose: "/characters/sproket/sproket-worlds-first.png" },
  { fact: "Post-heat all edges at 200\u00b0F+ after install for long-term adhesion.", pose: "/characters/sproket/sproket-jetpack.png" },
];

/* ── ACE typewriter greeting — types in, holds, erases, repeats ── */
const ACE_GREETING = "Hi I'm ACE your Graphic Designer AKA the";
function AceTypewriterGreeting() {
  const [charIdx, setCharIdx] = useState(0);
  const [phase, setPhase] = useState<"typing" | "holding" | "erasing">("typing");

  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    if (phase === "typing") {
      if (charIdx < ACE_GREETING.length) {
        t = setTimeout(() => setCharIdx((p) => p + 1), 45);
      } else {
        t = setTimeout(() => setPhase("holding"), 2200);
      }
    } else if (phase === "holding") {
      t = setTimeout(() => setPhase("erasing"), 400);
    } else {
      if (charIdx > 0) {
        t = setTimeout(() => setCharIdx((p) => p - 1), 25);
      } else {
        t = setTimeout(() => setPhase("typing"), 600);
      }
    }
    return () => clearTimeout(t);
  }, [charIdx, phase]);

  const fullyTyped = phase === "holding" || charIdx >= ACE_GREETING.length;

  return (
    <>
      <p className="text-base font-semibold text-foreground leading-tight min-h-[1.5rem]">
        {ACE_GREETING.slice(0, charIdx).split("ACE").map((part, i, arr) =>
          i < arr.length - 1
            ? <span key={i}>{part}<span className="text-cyan-400">ACE</span></span>
            : <span key={i}>{part}</span>
        )}
        <span className="animate-pulse text-cyan-400">|</span>
      </p>
      <p className={cn(
        "text-sm text-muted-foreground flex items-center gap-1.5 leading-tight transition-opacity duration-500",
        fullyTyped ? "opacity-100" : "opacity-0"
      )}>
        (<span className="text-cyan-400 font-medium">AI Creative Engine</span>)
        <span className="w-2 h-2 rounded-full bg-green-400 inline-block shrink-0" />
      </p>
    </>
  );
}

/* HOW-IT-WORKS showcase pieces (DesignPro Page Assets bucket) — cycled in the
   idle center box so people see how powerful it is: 2D proof, 3D proof, single
   3D, and design highlights. (GENIE + Production Proof appear here too once
   uploaded to their bucket folders.) */
const HOWITWORKS_SHOWCASE = [
  // NOTE: the idle carousel must NEVER show a 2D proof sheet — only on-vehicle
  // 3D wrap examples. The "2 D Proof Example/..." entry was intentionally removed.
  "3D%20Proof/APEX.png",
  "Single%203D%20Example%20Logo%20Quality/designpanelpro_1780328318041.jpg",
  "DesignHighLights/DodgeRestyle.png",
  "DesignHighLights/ForgedFitness.jpg",
  "DesignHighLights/StreetfireFoodTruck.jpg",
  "DesignHighLights/1773948618569_commercial%20%281%29.jpg",
].map((p) => `https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/object/public/DesignPro%20Page%20Assets/${p}`);

export default function DesignPanelProPremium({ embedded = false, embeddedBrief = null }: { embedded?: boolean; embeddedBrief?: any } = {}) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  // When rendered inline on the DesignProAI home (no navigation), the brief comes
  // in as a prop instead of router location.state — so designing stays on one page.
  const briefState: any = embeddedBrief || (location.state as any) || null;
  const [pipelineMode, setPipelineModeState] = useState<GenerationPipelineMode>(() =>
    initialDesignProPipelineMode(briefState?.pipelineMode, location.search),
  );
  // Keep the launch authority in a ref as well as React state. The selector and
  // the nested DesignIQ submit button live in different components; a callback
  // retained across their render boundary must never submit yesterday's
  // `legacy` value while the page visibly says A.T.L.A.S. Updating the ref in
  // the selector's click handler makes the chosen mode synchronous, and the
  // server echoes it back before the UI accepts the request.
  const pipelineModeRef = useRef<GenerationPipelineMode>(pipelineMode);
  pipelineModeRef.current = pipelineMode;
  const setPipelineMode = (next: GenerationPipelineMode) => {
    pipelineModeRef.current = next;
    setPipelineModeState(next);
  };
  const pushedRenderFromState = briefState?.previewRender || null;
  // Capture pushed render in a ref so it survives history.replaceState clearing location.state
  const pushedRenderRef = useRef<any>(null);
  if (pushedRenderFromState && !pushedRenderRef.current) {
    pushedRenderRef.current = pushedRenderFromState;
  }
  const pushedRender = pushedRenderRef.current;
  // ONE-PROMPT HANDOFF: the DesignProAIHome "Generate Designs" box navigates here
  // with { acePrompt }. Capture it in a ref so it survives the location-state
  // clearing below, then auto-kick the pipeline once the generator mounts.
  const acePromptFromState = briefState?.acePrompt || null;
  const acePromptRef = useRef<string | null>(null);
  if (acePromptFromState && !acePromptRef.current) {
    acePromptRef.current = acePromptFromState;
  }
  const acePrompt = acePromptRef.current;
  // Vehicle from the home "Start Your Design" brief — captured so the auto-generate
  // uses the vehicle the user already picked (no re-entry). Survives state clearing.
  const briefVehicleRef = useRef<{
    make?: string;
    model?: string;
    year?: string;
    vehicleType?: VehicleType;
  } | null>(null);
  if (!briefVehicleRef.current && (
    briefState?.make || briefState?.model || briefState?.year || briefState?.vehicleType || acePromptFromState
  )) {
    const st = briefState;
    briefVehicleRef.current = {
      make: st?.make,
      model: st?.model,
      year: st?.year,
      vehicleType: st?.vehicleType
        ? normalizeDesignProVehicleType(st.vehicleType)
        : undefined,
    };
  }
  // VisionBoard reference images from the home brief → seed the studio's VisionBoard.
  // Background examples → Layer 1; logo/overlay examples → Layer 2 (text/logo).
  const briefVisionRef = useRef<string[] | null>(null);
  if (!briefVisionRef.current && briefState?.visionBoardUrls) {
    briefVisionRef.current = briefState.visionBoardUrls;
  }
  const briefVisionUrls = briefVisionRef.current;
  const briefOverlayRef = useRef<string[] | null>(null);
  if (!briefOverlayRef.current && briefState?.overlayUrls) {
    briefOverlayRef.current = briefState.overlayUrls;
  }
  const briefOverlayUrls = briefOverlayRef.current;
  // Commercial brief from the home (Business & Fleet mode) → seed the studio's
  // commercial generator so a real Layer-2 text extraction runs. Home sends
  // "Commercial"/"Restyle"; the generator wants lowercase.
  const briefCommercialRef = useRef<{ mode?: "restyle" | "commercial"; companyName?: string; phone?: string; website?: string } | null>(null);
  if (!briefCommercialRef.current && briefState && (briefState.mode || briefState.companyName)) {
    briefCommercialRef.current = {
      mode: briefState.mode === "Commercial" ? "commercial" : briefState.mode === "Restyle" ? "restyle" : undefined,
      companyName: briefState.companyName?.trim() || undefined,
      phone: briefState.phone?.trim() || undefined,
      website: briefState.website?.trim() || undefined,
    };
  }
  const briefCommercial = briefCommercialRef.current;
  const { subscription, checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const {
    canGenerate: canGenerateFreemium,
    phase: freemiumPhase,
    isPrivileged,
    incrementGeneration: incrementFreemium,
    unlockBonus,
  } = useFreemiumLimits();
  const { data: starredImageUrls } = useStarredRenders();

  const {
    selectedPanel,
    setSelectedPanel,
    selectedFinish,
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
    showUpgradeModal,
    setShowUpgradeModal,
    showLoginModal,
    setShowLoginModal,
    saveDesignJob,
    isGeneratingPanel,
    generateFromPrompt,
    designName,
    designDnaId,
    renderDid,
    renderPt,
    // Persona pipeline
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
    vehicleType,
    setVehicleType,
    generationError,
    generationRequestState,
    clearGenerationError,
    flatProofUrl,
    activePipelineMode,
    flatAtlasRevisions,
    flatAtlasLoadError,
  } = useDesignPanelProLogic(briefVehicleRef.current?.vehicleType);

  // PAST JOBS — the live `flatProofUrl` is only populated during a fresh
  // generation run. When a previously-generated design is opened (pushed from
  // RevisionStudio, etc.) it's null, so the inline 2D proof wouldn't show even
  // though the proof IS stored. Resolve it from the DB (canonical-id pattern):
  // color_visualizations.admin_notes.flat_proof_url → the linked
  // designiq_generations.flat_proof_url. The inline card renders
  // `flatProofUrl || storedProofUrl`, so the proof shows for past jobs too.
  // THE 2D PROOF COMES FROM CALL 8, OR IT IS NOT SHOWN.
  //
  // This used to fall back to a stored URL recovered from
  // color_visualizations.admin_notes and then designiq_generations. Two
  // producers for one proof means the customer can be shown a sheet the
  // standalone runtime never made and cannot re-issue, with nothing on screen
  // to say which one it is. `flatProofUrl` is the Call 8 artifact selected by
  // role; absent it, the honest state is that the proof is still building.
  const proofToShow = flatProofUrl || null;
  const isFlatFirstDiagnostic = activePipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE;
  const latestFlatAtlas = flatAtlasRevisions[flatAtlasRevisions.length - 1];
  const inlineRevisionEnabled = inlineRevisionEnabledForPipeline(activePipelineMode);
  const showFlatFirstDiagnostic = isFlatFirstDiagnostic ||
    (!generationRequestState && !generatedImageUrl && pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE);

  // --- Feature flag: persona pipeline ---
  const [searchParams] = useSearchParams();
  const isPersonaMode = searchParams.get("pipeline") === "persona";

  // Preserve the exact customer brief for GENIE trailer dimension grounding when
  // the admin later opens the Production Pack dialog.
  const lastDesignBriefRef = useRef<string>("");

  // --- Vehicle state ---
  const [year, setYear] = useState(() => briefVehicleRef.current?.year || "");
  const [make, setMake] = useState(() => briefVehicleRef.current?.make || "");
  const [model, setModel] = useState(() => briefVehicleRef.current?.model || "");
  const [yearError, setYearError] = useState(false);
  // QuickQuote × DesignPro side panel — branded sidebar consistent
  // with ColorPro / GraphicsPro. Hosts the dashboard QuickQuoteCard
  // pre-seeded with the active vehicle + render so the rep can build
  // a price alongside the design without leaving the tool.
  // Auto-opens when arriving via `?quickQuote=1` (e.g. Push from
  // RevisionStudioIQ) so the rep lands directly on the upsell flow.
  const [showQuickQuote, setShowQuickQuote] = useState(() => {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("quickQuote") === "1";
  });
  const [vehicleInputOpen, setVehicleInputOpen] = useState(true);
  const yearInputRef = useRef<HTMLInputElement>(null);

  // --- MyVehiclePro state ---
  const mvp = useMyVehicleMode();
  // Shared multi-angle generator (same one ColorPro/FadeWraps/GraphicsPro use).
  // Renders the wrap onto EVERY uploaded angle, progressively.
  const {
    mvpIsGenerating,
    mvpEditedImageUrl,
    mvpBeforeUrl,
    mvpMultiViewResults,
    generateOnMyVehicle,
    clearMyVehicleResults,
  } = useMyVehicleGenerate();

  // Effective vehicle info (resolved from MVP detection or manual input)
  // Used by handleGenerateAllViews so additional views use the correct vehicle
  const [effectiveVehicle, setEffectiveVehicle] = useState<{ year: string; make: string; model: string }>({ year: "", make: "", model: "" });

  // --- UI state ---
  const [expandedImage, setExpandedImage] = useState<{ url: string; title: string } | null>(null);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [socialModalOpen, setSocialModalOpen] = useState(false);
  const [paywallModalOpen, setPaywallModalOpen] = useState(false);
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  const [sendForApprovalOpen, setSendForApprovalOpen] = useState(false);

  // --- Try-for-$25 modal state ---
  // Auto-opens when the URL carries ?try=1, ?ref=<slug>, or ?promo=<code>.
  // The rep params persist to checkout via the modal so 20% commission
  // and the 10% coupon both flow through Stripe.
  const tryFlag = searchParams.get("try");
  const tryRef = searchParams.get("ref") ?? undefined;
  const tryPromo = searchParams.get("promo") ?? undefined;
  const [tryModalOpen, setTryModalOpen] = useState(
    tryFlag === "1" || Boolean(tryRef) || Boolean(tryPromo),
  );
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();
  const [revisionCount, setRevisionCount] = useState(0);
  const [showSprocketWizard, setShowSprocketWizard] = useState(false);
  const [sprocketFactIndex, setSprocketFactIndex] = useState(0);

  // 3-column workspace collapse state — left (controls) + right (production)
  // collapse to narrow pills so the center Konva canvas gets max real estate.
  // Brief column stays MOUNTED on open (collapsing it unmounts the AI generator,
  // which kills auto-generate + the prompt box). It auto-collapses to the big
  // KONVA canvas once a design has generated (effect below).
  const [leftColOpen, setLeftColOpen] = useState(true);
  const [rightColOpen, setRightColOpen] = useState(false);
  // LayerLiftIQ edit mode — off until the user clicks Revise on the first view,
  // which turns the deterministic move/scale/delete/draw tools on.
  const [revising, setRevising] = useState(false);

  // Once the first design lands: shrink the left brief (now irrelevant) so the
  // KONVA canvas + LayerLiftIQ tools dominate, and OPEN the right production deck
  // (Revise → RevisionStudio, all-7 renders + 2D proof, Order Production Pack).
  useEffect(() => {
    if (generatedImageUrl) { setLeftColOpen(false); setRightColOpen(true); setRevising(false); }
  }, [generatedImageUrl]);

  // LayerLiftIQ revision lightbox — Layer 1 clean background (locked floor) +
  // the AI-generated Layer 2 overlays as draggable/scalable Konva nodes.
  const [layerLiftBg, setLayerLiftBg] = useState<string | null>(null);
  // CLEAN, text/logo-SCRUBBED per-view backgrounds from designpro-clean-views
  // (view_urls). These are the ONLY images where the baked branding has been
  // healed off — so the customer canvas floors on THESE (not the baked render)
  // and the editable PNG overlay is the only branding. Keyed by view angle.
  const [cleanViewUrls, setCleanViewUrls] = useState<Record<string, string>>({});
  // Freshly generated AI overlays — the starting set for a view that has no saved
  // layout yet.
  const [layerLiftElements, setLayerLiftElements] = useState<OverlayElement[]>([]);

  // Load the CLEAN, text/logo-free Layer-1 as the canvas FLOOR (+ persisted
  // overlays) for the current generation. Without this the canvas floored the
  // overlays on the text-baked HERO, so the logo appeared TWICE and the baked
  // one couldn't be removed (it isn't a layer). Flooring on the clean Layer-1
  // makes the overlay the ONLY branding — movable AND removable. Retries a few
  // times because the clean-bg + overlays persist asynchronously after the hero.
  useEffect(() => {
    const genId = generationIdRef.current;
    if (!genId) return;
    let cancelled = false;
    let tries = 0;
    const load = async () => {
      const { data } = await supabase
        .from("design_generation_assets")
        .select("background_url, overlay_pngs, view_urls")
        .eq("generation_id", genId)
        .eq("is_current", true)
        .order("iteration_index", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled || !data) {
        if (!cancelled && tries < 4) { tries++; setTimeout(load, 2500); }
        return;
      }
      if ((data as any).background_url) setLayerLiftBg((data as any).background_url as string);
      // The clean (branding-scrubbed) per-view set — populated by clean-views.
      // Once present, the canvas floors on these so no baked logo shows.
      const cv = (data as any).view_urls;
      if (cv && typeof cv === "object" && !Array.isArray(cv)) {
        const map: Record<string, string> = {};
        for (const [k, v] of Object.entries(cv)) {
          const u = typeof v === "string" ? v : (v as any)?.url;
          if (u) map[k] = String(u);
        }
        if (Object.keys(map).length) setCleanViewUrls(map);
      }
      const ov = Array.isArray((data as any).overlay_pngs) ? ((data as any).overlay_pngs as any[]) : [];
      if (ov.length) {
        setLayerLiftElements((prev) =>
          prev.length
            ? prev
            : ov.map((o: any, i: number): OverlayElement => ({
                id: o.id || `l2-${i}`,
                url: o.url,
                x: 280,
                y: 220 + i * 150,
                text: o.text || o.role,
                isLogo: o.kind === "logo",
              })),
        );
      }

      // Keep polling until the SCRUBBED clean views + overlays have landed.
      // clean-views (the branding scrub) runs back-of-house and can take ~30-60s
      // after the hero, so be patient (up to ~60s) — otherwise the canvas is
      // stuck flooring on the baked render and the logo shows doubled.
      const hasCleanViews = cv && typeof cv === "object" && Object.keys(cv).length > 0;
      if ((!(data as any).background_url || !ov.length || !hasCleanViews) && tries < 20) {
        tries++;
        setTimeout(load, 3000);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [generatedImageUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // NOTE: the frontend strip effect was REMOVED. The baked-branding strip now
  // runs BACK OF HOUSE via designpro-clean-views (service-role ClipDrop), kicked
  // deterministically right after the hero saves (see handleGenerate). It writes
  // the clean V1 background to view_urls.side; the loader above polls that and
  // floors the canvas on the clean base, with the golden-config PNG logos on top.

  // PER-VIEW persisted layouts, keyed by view angle (driver/passenger/hood/roof…)
  // so adjusting one side never overwrites another. Each view stores the EXACT
  // Konva stage size it was captured at, so the slicer scales coords into print
  // space pixel-exact. Mirrors design_generation_assets.layer_layout =
  // { [viewKey]: { stageWidth, stageHeight, overlays: OverlayElement[] } }.
  type ViewLayout = { stageWidth: number; stageHeight: number; overlays: OverlayElement[] };
  const [layerLayoutByView, setLayerLayoutByView] = useState<Record<string, ViewLayout>>({});

  // Persist one VIEW's canvas edits → design_generation_assets.layer_layout map.
  // Functional setState merge avoids stale-closure clobber across rapid edits.
  const persistViewLayout = (viewKey: string, updated: OverlayElement[], stage: { width: number; height: number }) => {
    setLayerLayoutByView((prev) => {
      const nextMap = {
        ...prev,
        [viewKey]: { stageWidth: stage.width, stageHeight: stage.height, overlays: updated },
      };
      // Normalize view keys to the slicer's panel ids before persisting: the
      // canvas labels the main view "side" but api/process-production-pack.js
      // looks up layer_layout["driver-side"], so without this the primary panel
      // gets ZERO overlays composited. React state stays keyed by viewKey (reads);
      // only the DB copy is remapped.
      const SLICER_VIEW_KEY: Record<string, string> = {
        side: "driver-side", "driver-side": "driver-side", "passenger-side": "passenger-side",
        front: "front", hood: "hood", hood_detail: "hood", rear: "rear", roof: "roof", "close-up": "close-up",
      };
      const dbLayout: Record<string, ViewLayout> = {};
      for (const [k, v] of Object.entries(nextMap)) dbLayout[SLICER_VIEW_KEY[k] || k] = v;

      const genId = generationIdRef.current;
      if (genId) {
        supabase
          .from("design_generation_assets")
          .update({
            layer_layout: dbLayout,
            qc_status: "revised",
            qc_stamped_by: "customer-revision",
            qc_stamped_at: new Date().toISOString(),
          })
          .eq("generation_id", genId)
          .eq("is_current", true)
          .then(({ error }) => {
            if (error) console.warn("[LayerLiftIQ] persist layout failed (non-fatal):", error.message);
          });
      }
      return nextMap;
    });
  };

  // Optional logo hand-off into AiPanelGenerator (cleared via
  // onInjectedLogoConsumed). The embedded LogoPro launcher has been removed
  // from Design Pro AI, so this stays null today but the plumbing is retained.
  const [injectedLogo, setInjectedLogo] = useState<{ storageUrl: string } | null>(null);

  const lastPipelineParamsRef = useRef<DesignIQParams | null>(null);

  // --- QuickQuote Estimator ---
  // The estimator is its own workspace the shop owner builds while
  // designing. Two kinds of items land in it:
  //
  //   1. The BASE design — auto-added when the shop owner picks a
  //      panel from the library. Uses variantKey: "designpro-base"
  //      so picking a DIFFERENT panel REPLACES the base line (still
  //      one wrap design per vehicle). Renders themselves don't
  //      touch the estimator — only deliberate panel selections do.
  //
  //   2. PRECISION ADDITIONS (chrome delete, carbon fiber roof,
  //      racing stripe, …) — added by the shop owner via the upsell
  //      buttons inside the drawer. These have NO variantKey, so
  //      each click appends its own line. The base wrap design is
  //      never deleted by these — they STACK on top.
  //
  // We destructure the stable callback refs out of the hook because
  // the returned API object is rebuilt every render — putting the
  // whole `estimator` in a useEffect dep array would loop.
  const estimator = useEstimator();
  const {
    setVehicle: setEstimatorVehicle,
    add: addEstimatorItem,
    setBaseRender: setEstimatorBaseRender,
    pushPrecisionMod: pushEstimatorPrecisionMod,
    clearPrecisionMods: clearEstimatorPrecisionMods,
  } = estimator;
  const designBaseVariantKey = "designpro-base";

  useEffect(() => {
    setEstimatorVehicle({
      year: year || undefined,
      make: make || undefined,
      model: model || undefined,
    });
  }, [year, make, model, setEstimatorVehicle]);

  // Capture the unmodified hero render as the estimator's baseline so
  // the admin viewer can show it as the "before" alongside the
  // stacked precision mods. Picking a different design auto-clears
  // the precision-mod stack inside useEstimator.
  useEffect(() => {
    setEstimatorBaseRender(generatedImageUrl ?? null);
  }, [generatedImageUrl, setEstimatorBaseRender]);

  // --- Precision modifications (Phase 5c) ---
  // When the shop owner clicks a precision-add button (chrome delete,
  // carbon fiber roof, racing stripe, …), the edge function returns
  // a Gemini-edited render. We swap the displayed image to the new
  // URL so the next click STACKS on top of the modified image.
  const [precisionRenderUrl, setPrecisionRenderUrl] = useState<string | null>(null);

  // Whenever a fresh design renders, drop the precision overlay so
  // the shop owner sees the new design (not the previous render with
  // mods stacked on it).
  useEffect(() => {
    setPrecisionRenderUrl(null);
  }, [generatedImageUrl]);

  const handlePrecisionApplied = useCallback(
    (result: PrecisionModResult, mod: PrecisionModification) => {
      setPrecisionRenderUrl(result.newRenderUrl);
      const lineItemId = `pm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      addEstimatorItem({
        id: lineItemId,
        label: result.lineItem.label,
        description: result.lineItem.description,
        qty: 1,
        unitPrice: result.lineItem.unitPrice,
        unit: result.lineItem.unit,
        source: result.lineItem.source,
      });
      pushEstimatorPrecisionMod({
        key: mod.key,
        label: mod.label,
        renderUrl: result.newRenderUrl,
        lineItemId,
      });
    },
    [addEstimatorItem, pushEstimatorPrecisionMod],
  );

  // Drawer-side upsell wiring (Phase: QuickQuote-driven precision mods).
  // The "Pitch an upsell" buttons inside the QuickQuote drawer route
  // through this handler when the upsell key matches a precision_mod.
  // We hit a SEPARATE edge function (apply-quickquote-upsell) so the
  // existing tool-side PrecisionModButtons path on DesignPro / ColorPro
  // stays untouched. Falls back to a plain line-item add when there's
  // no current render to edit or no matching precision mod.
  const { modifications: precisionMods } = usePrecisionModifications("designpro");
  const { apply: applyQuickQuoteUpsell, pendingKey: upsellPendingKey } =
    useQuickQuoteUpsellApply();
  const currentRenderForUpsell =
    precisionRenderUrl ?? generatedImageUrl ?? mvpEditedImageUrl ?? null;

  const handleEstimatorUpsellApply = useCallback(
    async (upsell: EffectiveUpsell): Promise<boolean> => {
      const matchedMod = precisionMods.find(
        (m) => m.key === upsell.service_key,
      );
      if (!matchedMod || !currentRenderForUpsell) {
        // Parent did NOT handle the upsell — let the estimator add a
        // plain line item (no visual edit) so the upsell still lands.
        return false;
      }
      try {
        const result = await applyQuickQuoteUpsell(
          matchedMod.key,
          currentRenderForUpsell,
        );
        if (result.unsupported || !result.newRenderUrl || !result.lineItem) {
          return false;
        }
        handlePrecisionApplied(
          {
            newRenderUrl: result.newRenderUrl,
            lineItem: result.lineItem,
          },
          matchedMod,
        );
        toast({
          title: `${matchedMod.label} applied`,
          description: "Stacked on the current render — line item added to the estimate.",
        });
        return true;
      } catch (err: any) {
        toast({
          title: `Couldn't apply ${upsell.label}`,
          description: err?.message ?? "Try again in a moment.",
          variant: "destructive",
        });
        // Soft fallback so the upsell still lands as a line item.
        return false;
      }
    },
    [
      precisionMods,
      currentRenderForUpsell,
      applyQuickQuoteUpsell,
      handlePrecisionApplied,
      toast,
    ],
  );

  const handlePrecisionError = useCallback(
    (err: Error, mod: PrecisionModification) => {
      toast({
        title: `Couldn't apply ${mod.label}`,
        description: err.message,
        variant: "destructive",
      });
    },
    [toast],
  );

  // Auto-add / auto-replace the base wrap design line when the shop
  // owner picks a panel. Fires on selection, NOT on render.
  useEffect(() => {
    if (!selectedPanel) return;
    const fullWrapDesign = findProductById("pp-custom-design");
    if (!fullWrapDesign) return;
    const label =
      selectedPanel.ai_generated_name || selectedPanel.name || "Custom Wrap Design";
    const finishLine = selectedFinish ? `${selectedFinish} finish` : fullWrapDesign.subName;
    const item = lineItemFromProduct(fullWrapDesign, {
      source: "render",
      description: finishLine,
      variantKey: designBaseVariantKey,
    });
    addEstimatorItem({ ...item, label: `Wrap Design — ${label}` });
    // selectedPanel object identity changes when a different panel is
    // picked; selectedFinish toggles independently. Both are precision
    // design choices that should sync the base line.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPanel?.id, selectedFinish, addEstimatorItem]);

  // Phase 6a — Save draft / Send estimate both write to public.quotes
  // via the existing saveQuote helper. The estimator state carries the
  // base render + the precision-mod stack so the admin viewer can show
  // the full visual history of how the quote was built.
  const persistEstimate = useCallback(
    async (state: EstimatorState, intent: "draft" | "send") => {
      const vehicleMake = state.vehicle.make;
      const vehicleModel = state.vehicle.model;
      if (!vehicleMake || !vehicleModel) {
        toast({
          title: "Vehicle required",
          description: "Enter year, make, and model before saving the estimate.",
          variant: "destructive",
        });
        return;
      }
      if (state.items.length === 0) {
        toast({
          title: "Add at least one line",
          description: "An empty estimate can't be saved.",
          variant: "destructive",
        });
        return;
      }

      const subtotal = state.items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
      const total = subtotal * (1 + state.taxRate);
      const quoteNumber = nextOrderNumber();
      const heroRenderUrl = precisionRenderUrl ?? generatedImageUrl ?? null;

      const result = await saveQuote({
        quoteNumber,
        vehicle: {
          year: state.vehicle.year,
          make: vehicleMake,
          model: vehicleModel,
        },
        finish: selectedFinish || undefined,
        toolSource: "designpro",
        sqFt: state.vehicle.sqFt,
        shopCost: subtotal,
        customerTotal: total,
        lineItems: state.items.map((i) => {
          const cat = i.productId ? findProductById(i.productId) : undefined;
          return {
            label: i.label,
            detail: i.description ?? `${i.qty} ${i.unit} × $${i.unitPrice}`,
            amount: i.qty * i.unitPrice,
            quantity: i.qty,
            wooProductId: cat?.wooProductId,
          };
        }),
        renderUrl: heroRenderUrl,
        baseRenderUrl: state.baseRenderUrl,
        precisionMods: state.precisionMods,
        customer: {
          name: state.customer.name,
          email: state.customer.email,
          phone: state.customer.phone,
          company: state.customer.company,
        },
        visualizationId: visualizationId ?? null,
      });

      if (!result) {
        toast({
          title: "Couldn't save the estimate",
          description: "Please try again. If this keeps failing, capture a screenshot and ping support.",
          variant: "destructive",
        });
        return null;
      }

      // For "send", await the email so the toast accurately reflects
      // delivery. For "draft", we're done after persistence.
      if (intent === "draft") {
        toast({
          title: `Saved draft ${quoteNumber}`,
          description: "Quote held in /quotes. Send when you're ready.",
        });
        return result.quoteId;
      }

      const customerEmail = state.customer.email?.trim();
      if (!customerEmail) {
        toast({
          title: `Saved ${quoteNumber} — but no customer email`,
          description:
            "Add the customer's email to the estimator and click Send again to dispatch.",
          variant: "destructive",
        });
        return result.quoteId;
      }

      const { error: sendErr } = await supabase.functions.invoke(
        "send-estimate-email",
        { body: { quoteId: result.quoteId } },
      );
      if (sendErr) {
        toast({
          title: `Saved ${quoteNumber}, but email send failed`,
          description: sendErr.message ?? "Resend rejected the message.",
          variant: "destructive",
        });
        return result.quoteId;
      }

      toast({
        title: `Sent ${quoteNumber} to ${customerEmail}`,
        description: "Customer also gets a link to /q/<share_token> for the live estimate.",
      });
      return result.quoteId;
    },
    [toast, generatedImageUrl, precisionRenderUrl, selectedFinish, visualizationId],
  );

  const handleEstimatorSaveDraft = useCallback(
    (state: EstimatorState) => { void persistEstimate(state, "draft"); },
    [persistEstimate],
  );

  const handleEstimatorSend = useCallback(
    (state: EstimatorState) => { void persistEstimate(state, "send"); },
    [persistEstimate],
  );

  // Phase 7 / Path B — only WPW shops see the "Preview WPW cart" button.
  // Non-WPW shops use Save draft + Send estimate; the customer pays the
  // shop directly via whatever channel the shop runs (no in-app deposit).
  const { data: isWpwShop = false } = useIsWpwTenant();

  const handleEstimatorCheckoutOnWpw = useCallback(
    (_state: EstimatorState, cartUrl: string) => {
      window.open(cartUrl, "_blank", "noopener,noreferrer");
      toast({
        title: "WPW cart opened",
        description: "Pre-loaded with the WPW print products from this estimate.",
      });
    },
    [toast],
  );

  // --- Pipeline state ---
  const [pipelineActive, setPipelineActive] = useState(false);
  const [pipelinePhase, setPipelinePhase] = useState<1 | 2>(1);
  const [pipelineElapsed, setPipelineElapsed] = useState(0);
  // Granular live stage so the customer is never blind while edge functions run.
  // Mirrors the real steps of handlePipelineStart (analyze → GENIE enhance →
  // render → finish). Presentational only; drives DesignPipelineProgress.
  const [pipelineStage, setPipelineStage] = useState<PipelineStage | null>(null);
  const autoRenderRef = useRef(false);
  const prevPanelRef = useRef<any>(null);
  const generationIdRef = useRef<string | null>(null);

  // --- Pushed render from RevisionStudioIQ ---
  const [pushedImageUrl, setPushedImageUrl] = useState<string | null>(null);
  const [pushedAllViews, setPushedAllViews] = useState<{ type: string; url: string }[]>([]);
  const pushedInitialized = useRef(false);
  const demoConsumedRef = useRef(false); // Ensures demo hero fires only once per push
  const demoViewsConsumedRef = useRef(false); // Ensures demo all-views fires only once
  const [activeViewIndex, setActiveViewIndex] = useState(0);
  // The server may finish Views 2-7 while the customer is reviewing View 1,
  // but those saved sides stay out of the presentation until this explicit
  // reveal is chosen. This is display state only; it never changes production
  // identity or starts a second generation pipeline.
  const [allViewsRevealed, setAllViewsRevealed] = useState(false);

  useEffect(() => {
    if (pushedRender && !pushedInitialized.current) {
      pushedInitialized.current = true;
      // Pre-populate vehicle fields
      if (pushedRender.vehicleYear) setYear(pushedRender.vehicleYear);
      if (pushedRender.vehicleMake) setMake(pushedRender.vehicleMake);
      if (pushedRender.vehicleModel) setModel(pushedRender.vehicleModel);
      setVehicleInputOpen(false);
      // Set pushed render image
      setPushedImageUrl(pushedRender.heroUrl || "");
      // Build all views from renderUrls
      if (pushedRender.renderUrls && typeof pushedRender.renderUrls === "object") {
        const views = Object.entries(pushedRender.renderUrls as Record<string, string>).map(
          ([type, url]) => ({ type, url })
        );
        setPushedAllViews(views);
      }
      toast({
        title: "View pushed from RevisionStudioIQ",
        description: `${pushedRender.vehicleYear} ${pushedRender.vehicleMake} ${pushedRender.vehicleModel} - ${pushedRender.designName || "Design"}`,
      });
      // Clear location state so refresh doesn't re-trigger
      window.history.replaceState({}, document.title);
    }
  }, [pushedRender]);

  // THE ?demo= PRELOAD IS GONE.
  //
  // It hydrated the whole page from a color_visualizations row -- hero, views,
  // vehicle, design name -- so a link could put a design on screen that the
  // standalone runtime has no record of. Everything downstream then keyed off
  // an id Calls 8-12 cannot resolve. A design is opened by its generationId
  // from the jobs list, which is the only id that means anything here.
  const demoInitialized = useRef(false);

  // --- ACE welcome modal ---
  const [aceWelcomeOpen, setAceWelcomeOpen] = useState(() => {
    try {
      return !localStorage.getItem("ace-welcome-dismissed-designpro");
    } catch { return true; }
  });
  const dismissAceWelcome = () => {
    setAceWelcomeOpen(false);
    try { localStorage.setItem("ace-welcome-dismissed-designpro", "1"); } catch {}
  };

  // --- Cosmo states ---
  const [successFlash, setSuccessFlash] = useState(false);
  const [renderError, setRenderError] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);

  // Pipeline timer
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (pipelineActive) {
      setPipelineElapsed(0);
      setRenderError(false);
      interval = setInterval(() => setPipelineElapsed((p) => p + 1), 1000);
    } else {
      setPipelineElapsed(0);
      setPipelineStage(null);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pipelineActive]);

  // Starred renders carousel auto-advance
  useEffect(() => {
    if (!starredImageUrls || starredImageUrls.length <= 1) return;
    const interval = setInterval(() => {
      setCarouselIndex((p) => (p + 1) % starredImageUrls.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [starredImageUrls]);

  // Success flash when render completes
  const prevGeneratedUrl = useRef<string | null>(null);
  useEffect(() => {
    if (generatedImageUrl && generatedImageUrl !== prevGeneratedUrl.current) {
      prevGeneratedUrl.current = generatedImageUrl;
      setSuccessFlash(true);
      // Clear pushed render once a new design is generated
      if (pushedImageUrl) {
        setPushedImageUrl(null);
        setPushedAllViews([]);
      }
      const timer = setTimeout(() => setSuccessFlash(false), 1500);
      return () => clearTimeout(timer);
    }
  }, [generatedImageUrl]);

  // Auto-trigger render when panel generation completes during pipeline
  useEffect(() => {
    if (
      autoRenderRef.current &&
      selectedPanel &&
      selectedPanel !== prevPanelRef.current &&
      !isGeneratingPanel
    ) {
      autoRenderRef.current = false;
      setPipelinePhase(2);
      // Fire render - branch for MyVehiclePro mode
      (async () => {
        if (mvp.isMyVehicleMode && mvp.hasPhotos) {
          // MyVehiclePro library-panel path: transfer the flat panel onto
          // EVERY uploaded angle via the shared multi-angle generator.
          await generateOnMyVehicle({
            photoBase64: mvp.photoBase64!,
            photoMimeType: mvp.photoMimeType,
            photoPreviewUrl: mvp.photoPreviewUrl,
            multiViewPhotos: mvp.multiViewPhotos,
            uploadMode: mvp.uploadMode,
            colorData: {
              panelUrl: selectedPanel?.media_url,
              panelName: selectedPanel?.ai_generated_name || selectedPanel?.name,
              finish: selectedFinish?.toLowerCase() || "gloss",
              colorLibrary: "designpanelpro",
              toolSource: "DesignPanelProPremium",
            },
            vehicleInfo: {
              year: mvp.detectedVehicleInfo?.year || year,
              make: mvp.detectedVehicleInfo?.make || make,
              model: mvp.detectedVehicleInfo?.model || model,
            },
          });
        } else {
          await generateRender(year, make, model);
        }
        if (!isPrivileged) incrementFreemium();
        if (subscription) await incrementRenderCount();
        setPipelineActive(false);
      })();
    }
    prevPanelRef.current = selectedPanel;
  }, [selectedPanel, isGeneratingPanel]);

  // NO CLIENT-SIDE TRACKING WRITES.
  //
  // Two effects here mirrored the hero and then the whole view set into
  // designiq_generations and color_visualizations as the browser produced them.
  // The runtime persists views when it produces them, under the generationId
  // that names the design everywhere downstream. A browser writing the same
  // facts into different tables gives one design two records that can disagree
  // -- and the one the customer is looking at is not the one Calls 8-12 read.


  const validateYear = useCallback(() => {
    if (!year || year.trim() === "") {
      setYearError(true);
      setVehicleInputOpen(true);
      yearInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      yearInputRef.current?.focus();
      setTimeout(() => setYearError(false), 2000);
      return false;
    }
    return true;
  }, [year]);

  // Pipeline entry point - called when user clicks "Create with DesignIQ"
  const handlePipelineStart = async (params: DesignIQParams) => {
    const requestedPipelineMode = pipelineModeRef.current;
    if (params.prompt?.trim()) lastDesignBriefRef.current = params.prompt.trim();
    if (
      mvp.isMyVehicleMode &&
      mvp.hasPhotos &&
      !myVehiclePhotoFlowEnabledForPipeline(requestedPipelineMode)
    ) {
      toast({
        title: "MyVehicle is unavailable in A.T.L.A.S. Preview",
        description: "Turn off MyVehicle or choose Production mode before starting.",
        variant: "destructive",
      });
      return;
    }
    // Validate vehicle BEFORE starting the pipeline
    if (mvp.isMyVehicleMode && mvp.hasPhotos) {
      // MyVehiclePro mode - photos replace year/make/model
    } else {
      if (!validateYear()) return;
      if (!make || !model) {
        toast({
          title: "Vehicle required",
          description: "Enter year, make, and model before creating a design",
          variant: "destructive",
        });
        return;
      }
    }

    if (mvp.isMyVehicleMode && !mvp.hasPhotos) {
      toast({
        title: "Photo required",
        description: "Upload a photo of your vehicle to use MyVehiclePro mode",
        variant: "destructive",
      });
      return;
    }

    // Check freemium limits
    if (!isPrivileged && !canGenerateFreemium) {
      if (freemiumPhase === "engagement") setSocialModalOpen(true);
      else if (freemiumPhase === "paywall") setPaywallModalOpen(true);
      return;
    }

    // Check subscription limits
    if (subscription && !isPrivileged) {
      const canGen = await checkCanGenerate();
      if (!canGen) return;
    }

    setAllViewsRevealed(false);
    setActiveViewIndex(0);

    // Light the progress UI from the FIRST step so the customer is never blind
    // while the edge functions run (GENIE enhance can take a few seconds before
    // the render even starts). The demo/persona/MyVehicle branches below re-assert
    // pipelineActive as needed; this is idempotent.
    setPipelineActive(true);
    setPipelineStage("analyzing");
    // Scroll to the render area the INSTANT they press — otherwise the viewport
    // "just stays" on the brief while GENIE enhance runs (a few seconds) and the
    // customer never sees it move up to the live progress. (The later
    // scrollToPreview() calls remain as a re-assert once the render actually starts.)
    setTimeout(() => {
      document.getElementById('render-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);

    // GENIE REMOVED — the elevate-prompt "enhancer" was pre-rewriting every brief
    // through canned commercial/trade templates ("(NOT photos)" HVAC rule, invented
    // logos, placeholder phones) and overriding what the customer actually asked for.
    // The customer's RAW brief now goes straight to design-panel-ai-generate, which
    // does its own elevation with full context. Do NOT reintroduce a pre-render
    // elevate-prompt pass here.

    // AUTO-COMMERCIAL ROUTING — a business/logo brief MUST use the commercial
    // design brain (which designs a real logo), never the restyle art path. The
    // restyle path has no logo architecture: it bakes text into the render and the
    // 2D-proof flatten SMEARS it (ghosted duplicate wordmark). The mode toggle
    // defaults to restyle, so a customer typing "commercial wrap for <company>,
    // create a logo" while the toggle sits on restyle silently gets the smeary,
    // logo-less path. Detect clear commercial intent from the brief and upgrade to
    // commercial here, before any downstream branch reads params.mode. The company
    // name is read from the brief inside design-panel-ai-generate when the field is
    // empty, so no fragile client-side name extraction is needed. A pure artistic
    // brief (no company/logo/contact signals) is untouched and stays restyle.
    if (params.mode !== "commercial") {
      const brief = (params.prompt || "").toLowerCase();
      const commercialSignal =
        /\b(commercial|fleet|logo|business|compan|brand|est\.?\s*\d{4}|since\s*\d{4}|llc|\binc\b|\.com|\d{3}[-.\s]?\d{3}[-.\s]?\d{4})\b/.test(brief) ||
        /\bwrap\s+for\s+\w/.test(brief);
      if (commercialSignal) {
        console.log("[DesignIQ] Commercial intent detected in brief — routing to commercial design brain (was:", params.mode, ")");
        params = { ...params, mode: "commercial" };
      }
    }

    // Auto-collapse the left Design Brief panel the moment generation starts so
    // the KONVA canvas immediately gets the extra width. The thin gradient
    // "Design Brief" tab (below) lets the user re-open it any time.
    setLeftColOpen(false);

    // ── DEMO MODE: If pushed from RevisionStudio, fake the render with existing images ──
    // Only fires ONCE — clears itself so subsequent generates use the real pipeline.
    if (pushedRender && pushedAllViews.length > 0 && !demoConsumedRef.current) {
      console.log('[DesignIQ] Demo mode — faking pipeline with preloaded renders');
      demoConsumedRef.current = true; // Prevent demo from firing again
      setPipelineActive(true);
      setPipelinePhase(1);
      setPipelineStage("rendering");

      // Scroll to preview
      setTimeout(() => {
        document.getElementById('render-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);

      // Simulate render time (3 seconds)
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Set the hero render
      const heroUrl = pushedImageUrl || pushedAllViews[0]?.url;
      if (heroUrl) {
        setGeneratedImageUrl(heroUrl);
        setVisualizationId(pushedRender.visualizationId || crypto.randomUUID());
        if (pushedRender.designName) setDesignName(pushedRender.designName);
        // Set a synthetic panel so additional views work
        setSelectedPanel({
          id: pushedRender.visualizationId || crypto.randomUUID(),
          name: pushedRender.designName || 'Demo Render',
          ai_generated_name: pushedRender.designName || 'Demo Render',
          media_url: heroUrl,
        });
      }

      setPipelineActive(false);
      setSuccessFlash(true);
      setTimeout(() => setSuccessFlash(false), 2000);
      toast({ title: "3D Proof Generated", description: "Design ready for review!" });
      return;
    }

    // Start pipeline - fresh design, reset revision counter
    setRenderError(false);
    clearGenerationError();
    setPipelineActive(true);
    setPipelinePhase(1);
    setRevisionCount(0);

    // Derive vehicle info - prefer detected info in MyVehiclePro mode
    const effectiveYear = mvp.isMyVehicleMode && mvp.detectedVehicleInfo?.year ? mvp.detectedVehicleInfo.year : year;
    const effectiveMake = mvp.isMyVehicleMode && mvp.detectedVehicleInfo?.make ? mvp.detectedVehicleInfo.make : make;
    const effectiveModel = mvp.isMyVehicleMode && mvp.detectedVehicleInfo?.model ? mvp.detectedVehicleInfo.model : model;

    // Store effective vehicle info for additional views
    setEffectiveVehicle({ year: effectiveYear, make: effectiveMake, model: effectiveModel });

    // MyVehiclePro → VisionBoard bridge:
    // Upload vehicle photos to storage and inject as VisionBoard images so
    // Gemini can SEE the actual vehicle when designing the wrap.
    let enrichedParams = { ...params };
    lastPipelineParamsRef.current = params;

    // FAITHFUL UPLOAD WIRE: thread the customer's uploaded logo (briefOverlayUrls,
    // the Layer-2 upload) into textLayerVisionBoardImages so the already-built
    // faithful-upload path fires (uploadedLogos/hasUpload at generateFromPrompt) —
    // seeding the REAL logo as the movable Layer-2 overlay AND persisting it as
    // overlay_pngs — instead of letting the AI re-invent the logo.
    if (!enrichedParams.textLayerVisionBoardImages?.length && briefOverlayUrls?.length) {
      enrichedParams = {
        ...enrichedParams,
        textLayerVisionBoardImages: briefOverlayUrls.map((url, i) => ({
          storageUrl: url,
          slotLabel: i === 0 ? "Logo" : `Logo ${i + 1}`,
        })),
      } as any;
    }

    // The MAIN render is ALWAYS the golden baked hero (buildDesignIQPrompt) — the
    // $5K WePrintWraps persona with the company name, trade logo emblem, and the
    // anti-cartoon guard. The clean-first / Layer-1 split was removed: routing the
    // customer to the text-free manufacturing layer produced unbranded AI-cartoon
    // slop. Branding stays a movable Layer-2 overlay composited on top of the hero.
    const restyleFocalText: string | null = null;
    if (mvp.isMyVehicleMode && mvp.hasPhotos) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const userId = user?.id || "anonymous";
        const timestamp = Date.now();
        const mvpImages: VisionBoardImage[] = [];

        if (mvp.uploadMode === "single" && mvp.photoBase64) {
          const ext = mvp.photoMimeType === "image/png" ? "png" : "jpg";
          const filePath = `vision-board-refs/${userId}/mvp-${timestamp}.${ext}`;
          const binaryString = atob(mvp.photoBase64);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const { error } = await supabase.storage.from("patterns").upload(filePath, bytes, {
            contentType: mvp.photoMimeType,
            upsert: true,
          });
          if (!error) {
            const { data: { publicUrl } } = supabase.storage.from("patterns").getPublicUrl(filePath);
            mvpImages.push({ slotLabel: "My Vehicle Photo", storageUrl: publicUrl });
          }
        } else if (mvp.uploadMode === "multi" && mvp.multiViewPhotos.length > 0) {
          // Upload first 2 photos (Gemini max payload)
          for (const photo of mvp.multiViewPhotos.slice(0, 2)) {
            const ext = photo.mimeType === "image/png" ? "png" : "jpg";
            const filePath = `vision-board-refs/${userId}/mvp-${photo.viewType}-${timestamp}.${ext}`;
            const binaryString = atob(photo.base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const { error } = await supabase.storage.from("patterns").upload(filePath, bytes, {
              contentType: photo.mimeType,
              upsert: true,
            });
            if (!error) {
              const { data: { publicUrl } } = supabase.storage.from("patterns").getPublicUrl(filePath);
              mvpImages.push({ slotLabel: `My Vehicle (${photo.viewType})`, storageUrl: publicUrl });
            }
          }
        }

        if (mvpImages.length > 0) {
          enrichedParams = {
            ...enrichedParams,
            visionBoardImages: [...(enrichedParams.visionBoardImages || []), ...mvpImages],
            visionboard_intent: enrichedParams.visionboard_intent || "exact_reference",
          };
          console.log(`[MyVehiclePro] Injected ${mvpImages.length} vehicle photo(s) as VisionBoard references`);
        }
      } catch (err) {
        console.warn("[MyVehiclePro] Photo upload for VisionBoard failed (non-fatal):", err);
      }
    }

    // Scroll to render preview after generation starts
    const scrollToPreview = () => {
      setTimeout(() => {
        document.getElementById('render-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    };

    // ── PERSONA PIPELINE MODE ─────────────────────────────────
    if (isPersonaMode) {
      if (!isPrivileged) incrementFreemium();
      if (subscription) await incrementRenderCount();
      setPipelineStage("rendering");
      scrollToPreview();
      await runPersonaPipeline(
        enrichedParams,
        { year: effectiveYear, make: effectiveMake, model: effectiveModel },
        requestedPipelineMode,
      );
      setPipelineActive(false);
      return;
    }

    // ── MYVEHICLEPRO DIRECT PATH ─────────────────────────────
    // When the customer has uploaded a real vehicle photo, skip the
    // studio render entirely and ask Gemini to design + apply the wrap
    // straight onto their photograph in a single call. This replaces
    // the old two-step (studio render -> edit-vehicle-photo transfer)
    // flow that produced a generic studio image first and a transfer
    // copy second.
    if (mvp.isMyVehicleMode && mvp.hasPhotos && mvp.photoBase64) {
      setPipelineStage("rendering");
      scrollToPreview();
      // Design the wrap onto EVERY uploaded angle via the shared multi-angle
      // generator (same path ColorPro uses). The brief + brand context travel
      // in colorData; design-on-vehicle-photo reads them and renders each photo.
      const ok = await generateOnMyVehicle({
        photoBase64: mvp.photoBase64,
        photoMimeType: mvp.photoMimeType,
        photoPreviewUrl: mvp.photoPreviewUrl,
        multiViewPhotos: mvp.multiViewPhotos,
        uploadMode: mvp.uploadMode,
        colorData: {
          toolSource: "DesignProAI",
          prompt: params.prompt,
          finish: selectedFinish || params.finish || "Gloss",
          mode: params.mode,
          companyName: params.companyName,
          phone: params.phone,
          mascot: params.mascot,
          industryType: params.industryType,
          bulletPoints: params.bulletPoints,
          // Only the user's real VisionBoardIQ references — the uploaded
          // vehicle photos are already the per-angle canvases.
          visionBoardImages: params.visionBoardImages
            ?.filter((v) => v.storageUrl)
            .map((v) => ({ storageUrl: v.storageUrl, slotLabel: v.slotLabel })),
          visionboardIntent: params.visionboard_intent,
        },
        vehicleInfo: {
          year: effectiveYear,
          make: effectiveMake,
          model: effectiveModel,
        },
      });

      if (!ok) {
        setRenderError(true);
      } else {
        if (!isPrivileged) incrementFreemium();
        if (subscription) await incrementRenderCount();
      }
      setPipelineActive(false);
      return;
    }

    // ── CALLS 1-7 ─────────────────────────────────────────────
    //
    // One request. The runtime renders the seven views and hands off to Call 8.
    //
    // WHAT USED TO RUN HERE, AND WHY IT DOES NOT. A LayerLiftIQ pass ran
    // alongside the render: designpro-parse-brief split the customer's brief
    // into logo and text pieces, designpro-text-layer-generate drew each one on
    // transparent RGBA, designpro-clean-views produced logo-free views, and
    // designpro-persist-assets wrote all of it into design_generation_assets as
    // overlay_pngs for the Konva canvas to seed from.
    //
    // Every one of those is the RestylePro production backend, invoked from the
    // customer's browser, writing a design's assets into a table the standalone
    // runtime neither owns nor reads. That alone ends it. But the shape is also
    // the thing the frozen seam forbids: Calls 1-8 emit one composited raster
    // per surface and there is no pre-branding base artwork, so a separately
    // authored overlay set is separability that does not exist -- and once it is
    // on screen beside the panels, somebody downstream treats it as the layer
    // the design can be rebuilt from.
    //
    // The uploaded logo is not lost. It goes into the generation request as a
    // verified asset, so A.C.E. composes the real logo into the design instead
    // of the browser pasting it on afterwards.
    setPipelineStage("rendering");
    scrollToPreview();
    const result = await generateFromPrompt(
      enrichedParams,
      { year: effectiveYear, make: effectiveMake, model: effectiveModel },
      requestedPipelineMode,
    );
    generationIdRef.current = result?.generationId || null;
    if (result && !result.error) setPipelineStage("finishing");

    // generateFromPrompt always resolves. When the edge function throws, the
    // hook sets generationError and returns { error }. Without this check the
    // library-panel branch below would flip autoRenderRef.current = true and
    // leave pipelineActive stuck on forever with no visible feedback.
    if (!result || result.error) {
      setRenderError(true);
      setPipelineActive(false);
      return;
    }

    if (result?.directRender) {
      // V1 path: render is already done
      if (!isPrivileged) incrementFreemium();
      if (subscription) await incrementRenderCount();
      setPipelineActive(false);
    } else {
      // Library panel path: auto-trigger projection render via useEffect
      autoRenderRef.current = true;
    }
  };

  const handleGenerateAllViews = async () => {
    // Reveal immediately. The one server request is already producing/saving
    // the approved view set, and its progressive observer will append each side
    // here as it lands. The refresh below only reads those server-owned rows.
    setAllViewsRevealed(true);
    setActiveViewIndex(0);
    if (!generatedImageUrl) return;

    // ── DEMO MODE: If pushed from RevisionStudio, stagger-reveal preloaded views ──
    // Only fires if hero demo already ran (demoConsumedRef) and views not yet revealed
    if (pushedRender && pushedAllViews.length > 0 && demoConsumedRef.current && !demoViewsConsumedRef.current) {
      console.log(`[DesignIQ] Demo mode — revealing ${pushedAllViews.length} preloaded views`);
      demoViewsConsumedRef.current = true;
      setIsGeneratingAdditional(true);
      setAllViews([{ type: 'side', url: generatedImageUrl! }]);

      for (const view of pushedAllViews) {
        if (view.type === 'side' || view.url === generatedImageUrl) continue;
        await new Promise(resolve => setTimeout(resolve, 1500));
        setAllViews(prev => [...prev, { type: view.type, url: view.url }]);
      }

      setIsGeneratingAdditional(false);
      toast({ title: "All Views Ready", description: `${pushedAllViews.length} views generated` });
      return;
    }

    // Use effective vehicle info (from MVP detection or manual input)
    const viewYear = effectiveVehicle.year || year;
    const viewMake = effectiveVehicle.make || make;
    const viewModel = effectiveVehicle.model || model;

    // In persona mode, use persona photographer for progressive per-shot rendering
    if (isPersonaMode && personaDesignAnchor) {
      setIsGeneratingAdditional(true);
      try {
        await runPersonaPhotographer(
          personaDesignAnchor,
          generatedImageUrl,
          personaGenerationId,
          { year: viewYear, make: viewMake, model: viewModel },
          selectedFinish
        );
      } finally {
        setIsGeneratingAdditional(false);
      }
      return;
    }

    await generateAdditionalViews(viewYear, viewMake, viewModel);
  };

  // ── MULTI-VIEW PRESENTATION GATE ──────────────────────────────────────────
  // Calls 1-7 remain one resumable server request. The page first presents only
  // Driver Side; "See All Views" reveals the already-saved/progressive sides.
  // It is a reveal/read control, never a second browser-side producer.
  const autoBoatViewsRef = useRef(false); // retained (referenced elsewhere); no auto-fire

  // 24/7 "Order Print-Ready Production Pack" — guest-capable $299 checkout.
  // No design yet → tell them to design first. Otherwise → Stripe ($299),
  // returns to /designpro; the webhook opens an admin Print Production Request.
  const handleOrderProductionPack = async () => {
    const heroUrl = generatedImageUrl || mvpEditedImageUrl || "";
    if (!heroUrl) {
      toast({
        title: "Design your wrap first",
        description: "Create a wrap design, then order your print-ready production pack.",
      });
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("create-single-use-checkout", {
        body: {
          tool: "production_pack",
          return_path: "/productionflow",
          generation_id: generationIdRef.current || "",
          render_url: heroUrl,
          vehicle_year: year || "",
          vehicle_make: make || "",
          vehicle_model: model || "",
        },
      });
      if (error || !data?.url) throw new Error(error?.message || "Could not start checkout");
      window.location.href = data.url;
    } catch (e: any) {
      toast({ title: "Checkout error", description: e?.message || "Please try again", variant: "destructive" });
    }
  };

  // Persona pipeline: user approved CSR brief → continue to Designer + Photographer
  const handleSaveAndNavigate = async (target: string) => {
    setIsSavingDesign(true);
    try {
      const savedDesign = await saveDesignJob(year, make, model);
      if (savedDesign?.id) {
        navigate(`${target}?designId=${savedDesign.id}`);
      } else {
        const ctx = {
          panelId: selectedPanel?.id,
          panelName: selectedPanel?.ai_generated_name || selectedPanel?.name,
          panelUrl: selectedPanel?.media_url,
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          finish: selectedFinish,
          renderUrl: generatedImageUrl,
          allViews: allViews.map(v => ({ type: v.type, url: v.url })).filter(v => v.url && !v.url.startsWith('data:')),
        };
        localStorage.setItem("designpanelpro-purchase-context", JSON.stringify(ctx));
        navigate(`${target}?panelId=${selectedPanel?.id}`);
      }
    } finally {
      setIsSavingDesign(false);
    }
  };

  // ── Manual pipeline steps ──────────────────────────────────


  // Revision handler - triggers a new render with the revision text
  const handleRevisionSubmit = async (request: RevisionRequest) => {
    if (!request.revisionText.trim()) return;
    if (!inlineRevisionEnabledForPipeline(activePipelineMode)) {
      toast({
        title: "Revisions are unavailable in A.T.L.A.S. Preview",
        description: "Your design and vehicle views remain saved. Start a new design to explore another direction.",
        variant: "destructive",
      });
      return;
    }
    // Re-trigger the pipeline with revision context appended to the original prompt
    // For now, we feed the revision text as a new prompt variation
    // Future: link to Design DNA via revision_parent_id
    console.log("[Revision] Submitting revision:", {
      text: request.revisionText,
      parentId: request.revisionParentId,
      depth: request.revisionDepth,
    });

    setAllViewsRevealed(false);
    setActiveViewIndex(0);
    setPipelineActive(true);
    setPipelinePhase(1);

    // Scroll up to the progress bar / render area
    setTimeout(() => {
      document.getElementById('render-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);

    const effectiveYear = mvp.isMyVehicleMode && mvp.detectedVehicleInfo?.year ? mvp.detectedVehicleInfo.year : year;
    const effectiveMake = mvp.isMyVehicleMode && mvp.detectedVehicleInfo?.make ? mvp.detectedVehicleInfo.make : make;
    const effectiveModel = mvp.isMyVehicleMode && mvp.detectedVehicleInfo?.model ? mvp.detectedVehicleInfo.model : model;

    // Build revision params - include the original design context + revision instruction
    const revisionParams = {
      mode: "restyle" as const,
      prompt: request.revisionText,
      finish: selectedFinish || "Gloss",
      originalRenderUrl: generatedImageUrl || undefined,
    } as any;

    const result = await generateFromPrompt(revisionParams, {
      year: effectiveYear,
      make: effectiveMake,
      model: effectiveModel,
    }, pipelineModeRef.current);
    generationIdRef.current = result?.generationId || null;

    if (result?.directRender) {
      if (!isPrivileged) incrementFreemium();
      if (subscription) await incrementRenderCount();
      setPipelineActive(false);
    } else {
      autoRenderRef.current = true;
    }

    setRevisionCount((prev) => prev + 1);
  };

  // Whether any generation is in progress (panel or render)
  const isBusy = pipelineActive || isGeneratingPanel || isGenerating || mvpIsGenerating || isPersonaPipelineActive;

  // Whether additional views are still being generated (used for sparkle + Sprocket wizard)
  const isViewsStillGenerating = isGeneratingAdditional || isPersonaPipelineActive;

  // Live elapsed-seconds counter while additional views are generating.
  // Resets to 0 when generation starts. Stops at the final value when it
  // ends. Used by the prominent Sprocket header above the views grid so
  // the shop can see exactly how long it's been running.
  const [additionalViewsElapsed, setAdditionalViewsElapsed] = useState(0);
  useEffect(() => {
    if (!isViewsStillGenerating) return;
    setAdditionalViewsElapsed(0);
    const t0 = Date.now();
    const interval = setInterval(() => {
      setAdditionalViewsElapsed(Math.floor((Date.now() - t0) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isViewsStillGenerating]);

  // Rotate Sprocket facts every 5 seconds while the wizard is open
  useEffect(() => {
    if (!showSprocketWizard) return;
    const interval = setInterval(() => {
      setSprocketFactIndex((prev) => (prev + 1) % SPROCKET_DESIGN_FACTS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, [showSprocketWizard]);

  // Auto-close Sprocket wizard when views finish generating
  useEffect(() => {
    if (!isViewsStillGenerating && showSprocketWizard) {
      setShowSprocketWizard(false);
    }
  }, [isViewsStillGenerating, showSprocketWizard]);

  // Primary display: in MyVehiclePro mode, show the user's actual photo
  // wrapped (the deliverable they care about). Otherwise, show the studio
  // render or pushed render. The studio render is still the design source
  // — it just becomes a behind-the-scenes step once MVP edit completes.
  const showMvpHero = mvp.isMyVehicleMode && !!mvpEditedImageUrl;
  const baseDisplayUrl = showMvpHero
    ? mvpEditedImageUrl
    : (generatedImageUrl || pushedImageUrl);

  // Sort/filter against the vehicle-class contract. Trailers have five
  // validation views; standard vehicles retain the locked seven-view order.
  const effectiveAllViews = allViews.length > 0 ? allViews : pushedAllViews;
  const HISTORICAL_HERO_VIEW_ORDER = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'hero-3d', 'roof'] as const;
  const CLOSEUP_VIEW_ORDER = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'] as const;
  const TRAILER_VIEW_ORDER = ['side', 'passenger-side', 'front', 'rear', 'close-up'] as const;
  const hasCloseupSeventh = effectiveAllViews.some((view) =>
    view.type === 'close-up' || view.type === 'closeup' || view.type === 'detail');
  const hasHistoricalHeroSeventh = effectiveAllViews.some((view) =>
    view.type === 'hero-3d' || view.type === 'hero3d');
  const hasConflictingSeventh = hasCloseupSeventh && hasHistoricalHeroSeventh;
  // Close-Up is the only active seventh view. An immutable historical Hero set
  // keeps its own identity when read, and is never relabelled as Close-Up.
  const standardViewOrder = hasHistoricalHeroSeventh && !hasCloseupSeventh
    ? HISTORICAL_HERO_VIEW_ORDER
    : CLOSEUP_VIEW_ORDER;
  const requiredViewTypes: readonly string[] =
    isFlatFirstDiagnostic
      ? standardViewOrder
      : vehicleType === 'trailer' ? TRAILER_VIEW_ORDER : standardViewOrder;
  const requiredViewCount = requiredViewTypes.length;
  const findViewByType = (type: string) => {
    const direct = effectiveAllViews.find(v => v.type === type);
    if (direct) return direct;
    // Legacy key aliases
    if (type === 'side') return effectiveAllViews.find(v => v.type === 'driver-side' || v.type === 'driver_side');
    if (type === 'hood_detail') return effectiveAllViews.find(v => v.type === 'hood');
    if (type === 'close-up') return effectiveAllViews.find(v => v.type === 'closeup' || v.type === 'detail');
    if (type === 'hero-3d') return effectiveAllViews.find(v => v.type === 'hero3d');
    return undefined;
  };
  const sortedAllViews = requiredViewTypes
    .map(findViewByType)
    .filter((v): v is NonNullable<typeof v> => Boolean(v));
  const displayedAllViews = allViewsRevealed ? sortedAllViews : [];
  const VIEW_LABEL_MAP: Record<string, string> = {
    side: 'Driver Side', 'driver-side': 'Driver Side',
    'passenger-side': 'Passenger Side',
    front: 'Front',
    hood_detail: 'Hood', hood: 'Hood',
    rear: 'Rear',
    roof: 'Roof Plan',
    'close-up': 'Close-Up',
    'hero-3d': 'Historical 3D Hero',
    hero3d: 'Historical 3D Hero',
  };

  // Active view for arrow navigation in main preview
  const clampedViewIndex = displayedAllViews.length > 0 ? Math.min(activeViewIndex, displayedAllViews.length - 1) : 0;
  const savedDriverDisplayUrl = findViewByType('side')?.url || null;
  // Standard generation is side-first, so its legacy base URL is the Driver
  // result. A.T.L.A.S. keeps its flat master separate; never let another saved
  // angle impersonate Driver Side.
  const driverDisplayUrl = savedDriverDisplayUrl || (!isFlatFirstDiagnostic ? baseDisplayUrl : null);
  // Driver Side stays pinned until the customer explicitly asks to see the
  // other angles. After reveal, the chosen thumbnail owns the canvas even while
  // later server views continue arriving.
  const mainDisplayUrl = !allViewsRevealed
    ? driverDisplayUrl
    : (displayedAllViews[clampedViewIndex]?.url || baseDisplayUrl);
  // The canonical flat master is the first visual result in A.T.L.A.S. mode.
  // It may occupy the customer viewport while the seven downstream projection
  // slots run, but it is deliberately kept separate from `mainDisplayUrl` so a
  // proof image, revision source, order gate, or production identity can never
  // mistake the atlas sheet for a 3D vehicle view.
  const atlasMasterPreviewUrl = isFlatFirstDiagnostic && pipelineActive && !renderError && !savedDriverDisplayUrl
    ? latestFlatAtlas?.masterUrl || null
    : null;
  const previewDisplayUrl = mainDisplayUrl || atlasMasterPreviewUrl;
  const atlasNewRunRequired = isFlatFirstDiagnostic
    && Boolean(generationError?.includes("Start a new A.T.L.A.S. run"));
  // When a precision modification has been stacked on the render,
  // show the modified image instead. Other workflows (PDF proof,
  // All Views, etc.) keep using mainDisplayUrl as the unmodified base.
  const effectiveDisplayUrl = precisionRenderUrl ?? previewDisplayUrl;
  // Gate by exact required identities, not only count (duplicates cannot pass).
  const allViewsDone =
    !!mainDisplayUrl &&
    !hasConflictingSeventh &&
    !isViewsStillGenerating &&
    requiredViewTypes.every((type) => Boolean(findViewByType(type)));
  const activeViewLabel = displayedAllViews.length > 1 && displayedAllViews[clampedViewIndex]
    ? (VIEW_LABEL_MAP[displayedAllViews[clampedViewIndex].type] || displayedAllViews[clampedViewIndex].type)
    : "Driver Side";

  return (
    <div className={cn("flex flex-col", embedded ? "min-h-0 bg-transparent" : "min-h-screen bg-background")}>
      <Helmet>
        <title>DesignProAI™ - The World's First AI Design to Print System | DesignProAI Suite™</title>
        <meta
          name="description"
          content="DesignProAI™ - AI designs custom wraps, renders them on vehicles, and generates production-ready print panels. The world's first AI Design to Print system."
        />
      </Helmet>
      <main className="flex-1">
        {/* Hero Banner — white, matches the DesignProAI™ banner: gradient wordmark
            + tagline on the left, a crisp design render on the right.
            Hidden when embedded inline on the DesignProAI home (no duplicate bar). */}
        {false && (
        <div className="bg-white border-b border-gray-200">
          <div className="container max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
            <h1 className="text-xl sm:text-2xl font-extrabold leading-none tracking-tight">
              <span className="text-gray-900">Design</span><span className="bg-gradient-to-r from-blue-600 to-pink-500 bg-clip-text text-transparent">ProAI™</span>
            </h1>
            <Button
              onClick={() => { window.location.href = "/designpro/create"; }}
              className="bg-gradient-to-r from-blue-600 to-pink-500 text-white border-0 font-bold text-sm h-10 px-5 rounded-lg gap-2 shadow hover:opacity-90 transition-opacity shrink-0"
            >
              <Sparkles className="w-4 h-4" />
              Start New Design
            </Button>
          </div>
        </div>
        )}

        <section className="bg-black pt-0 pb-8 overflow-x-hidden">
          <ToolContainer fullWidth>
            <div className="w-full max-w-[1920px] mx-auto px-3 sm:px-4 pt-2 pb-24">
              <Card className="overflow-hidden bg-black border-white/10">

                {/* Main Content — 3-column collapsible workspace (dark DesignProAI):
                    LEFT controls (collapsible) · CENTER Konva canvas (dominant) ·
                    RIGHT production deck (collapsible). On mobile it stacks. */}
                <div className="flex flex-col lg:flex-row gap-4 p-3 sm:p-4 lg:p-6 items-start">
                  {/* ── LEFT COLUMN — Controls ── On the unified home page this is
                      MOUNTED but hidden (the home's Start Your Design brief is the
                      only brief and drives auto-generate); standalone keeps it. */}
                  {(embedded || leftColOpen) ? (
                    <div className={cn("w-full lg:w-[420px] shrink-0 rounded-xl border border-white/10 bg-black/40 p-4 space-y-4", embedded && "hidden")}>
                      {/* DesignPro™ wordmark — blue→magenta gradient + magenta subtitle
                          (mirrors the DesignProAI™ wordmark pattern in Header.tsx). */}
                      <div className="flex flex-col leading-none px-1">
                        <span className="text-2xl font-bold tracking-tight whitespace-nowrap">
                          <span className="text-white">Design</span><span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Pro</span>
                          <span className="text-zinc-400 text-xs align-super ml-0.5">&#8482;</span>
                        </span>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#ec4899] mt-0.5">
                          Vehicle Wrap Design System
                        </span>
                      </div>
                      <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-bold uppercase tracking-wider text-white">Design Brief</span>
                        <button
                          type="button"
                          onClick={() => setLeftColOpen(false)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
                          aria-label="Collapse controls"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                      </div>
                      {FLAT_FIRST_ATLAS_UI_ENABLED && (
                        <div className="rounded-xl border border-cyan-400/30 bg-cyan-400/5 p-3">
                          <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-300">
                            Design mode
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              aria-pressed={pipelineMode === "legacy"}
                              disabled={isBusy || !!mainDisplayUrl}
                              onClick={() => setPipelineMode("legacy")}
                              className={cn(
                                "rounded-lg border px-2 py-2 text-[10px] font-bold transition disabled:opacity-50",
                                pipelineMode === "legacy"
                                  ? "border-white/30 bg-white/10 text-white"
                                  : "border-white/10 text-white/50 hover:bg-white/5",
                              )}
                            >
                              Production
                            </button>
                            <button
                              type="button"
                              aria-pressed={pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE}
                              disabled={isBusy || !!mainDisplayUrl || !flatFirstAtlasSupportedVehicleType(vehicleType)}
                              onClick={() => setPipelineMode(FLAT_FIRST_ATLAS_PIPELINE_MODE)}
                              className={cn(
                                "rounded-lg border px-2 py-2 text-[10px] font-bold transition disabled:opacity-50",
                                pipelineMode === FLAT_FIRST_ATLAS_PIPELINE_MODE
                                  ? "border-cyan-400 bg-cyan-400/15 text-cyan-200"
                                  : "border-white/10 text-white/50 hover:bg-white/5",
                              )}
                            >
                              A.T.L.A.S. Preview
                            </button>
                          </div>
                          <p className="mt-2 text-[10px] leading-4 text-white/55">
                            {flatFirstAtlasSupportedVehicleType(vehicleType)
                              ? "Creates the flattened master design, then Driver Side. Use See All Views to reveal Driver, Passenger, Hood, Front, Rear, Close-Up, and Roof as each saved proof becomes ready. Production ordering is unavailable in Preview mode."
                              : "Preview mode is available for car, truck, SUV and van. Production mode will be used for this vehicle."}
                          </p>
                        </div>
                      )}
                      {/* Input area */}
                      <div className="space-y-4">
                    {/* ACE Character Header — typewriter intro (spans full width) */}
                    <div className="flex items-center gap-2 px-3 py-2">
                      <div className="flex-1 min-w-0">
                        <AceTypewriterGreeting />
                      </div>
                      <img
                        src="/characters/ace-v2.png"
                        alt="ACE - AI Creative Engine"
                        className="max-w-[100px] sm:max-w-[120px] h-auto object-contain"
                      />
                    </div>

                    {/* AI Panel Generator — two-column brief. Vehicle Details is
                        injected into the LEFT control column via leftColumnHeader
                        so it doesn't span full width like a banner. */}
                    <AiPanelGenerator
                      onPanelGenerated={setSelectedPanel}
                      isGenerating={isGeneratingPanel}
                      onGenerate={handlePipelineStart}
                      initialPrompt={pushedRender?.originalPrompt || acePrompt || undefined}
                      autoGenerate={!!acePrompt && !pushedRender}
                      initialVisionBoardUrls={pushedRender?.visionBoardUrls || briefVisionUrls}
                      initialTextLayerUrls={briefOverlayUrls || undefined}
                      initialMode={briefCommercial?.mode}
                      initialCompanyName={briefCommercial?.companyName}
                      initialPhone={briefCommercial?.phone}
                      initialWebsite={briefCommercial?.website}
                      injectedLogo={injectedLogo}
                      onInjectedLogoConsumed={() => setInjectedLogo(null)}
                      onExactReproHandoff={(refs) => {
                        // APPROPRIATE-TOOL HANDOFF: reproducing an uploaded design
                        // belongs in RecreatePro (exact recreate + edit box). Carry
                        // the uploaded reference(s) + this vehicle over so the
                        // customer lands ready to hit "Create Exact" — no re-upload,
                        // no re-typing the vehicle. ProductionFlow reads this stash
                        // on mount (tab=prep) and clears it.
                        try {
                          sessionStorage.setItem(
                            "recreatepro_handoff",
                            JSON.stringify({ refs: refs || [], year, make, model, savedAt: Date.now() }),
                          );
                        } catch { /* non-fatal — RecreatePro still opens, just empty */ }
                        navigate("/productionflow?tab=prep");
                      }}
                      leftColumnHeader={(<>

                    {/* Vehicle Entry - wrapped with MyVehicleProToggle.
                        /designpro itself requires the `complete` tier, which
                        is strictly above MV's `advanced` minimum — paid
                        customers reaching this page are already entitled, so
                        bypass the toggle's own gate to skip the redundant
                        upsell prompt. */}
                    <MyVehicleProToggle
                      isMyVehicleMode={mvp.isMyVehicleMode}
                      onToggle={mvp.setIsMyVehicleMode}
                      uploadMode={mvp.uploadMode}
                      onUploadModeChange={mvp.setUploadMode}
                      photoPreviewUrl={mvp.photoPreviewUrl}
                      multiViewPhotos={mvp.multiViewPhotos}
                      isAnalyzing={mvp.isAnalyzing}
                      detectedVehicleInfo={mvp.detectedVehicleInfo}
                      onPhotoUpload={mvp.handlePhotoUpload}
                      onMultiViewPhotoUpload={mvp.handleMultiViewPhotoUpload}
                      onRemoveMultiViewPhoto={mvp.removeMultiViewPhoto}
                      onClearPhotos={mvp.clearPhotos}
                      bypassTierGate
                    >
                    <Collapsible open={vehicleInputOpen} onOpenChange={setVehicleInputOpen}>
                      <Card className="bg-[#1c1c1e] border border-white/10 p-3">
                        <CollapsibleTrigger className="w-full min-h-[44px]">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <Car className="w-4 h-4" />
                              <span className="text-sm font-semibold">Vehicle Details</span>
                            </div>
                            <ChevronDown
                              className={cn(
                                "w-4 h-4 transition-transform",
                                vehicleInputOpen && "rotate-180"
                              )}
                            />
                          </div>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="text-sm text-muted-foreground mb-3">Select Your Vehicle</p>
                          {/* Vehicle type — push-button per class */}
                          <div className="mb-3">
                            <VehicleTypeSelector value={vehicleType} onChange={(next) => {
                              setVehicleType(next);
                              if (!flatFirstAtlasSupportedVehicleType(next)) setPipelineMode("legacy");
                            }} />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <div>
                              <Label htmlFor="premium-year" className="text-xs text-muted-foreground mb-1">
                                Year
                              </Label>
                              <Input
                                ref={yearInputRef}
                                id="premium-year"
                                type="text"
                                placeholder="2024"
                                value={year}
                                onChange={(e) => {
                                  setYear(e.target.value);
                                  setYearError(false);
                                }}
                                className={cn(
                                  "bg-background border-2 border-border/50 transition-all",
                                  yearError && "border-red-500 animate-pulse"
                                )}
                              />
                            </div>
                            <div>
                              <Label htmlFor="premium-make" className="text-xs text-muted-foreground mb-1">
                                {isNonStandardVehicle(vehicleType) ? "Manufacturer" : "Make"}
                              </Label>
                              <Input
                                id="premium-make"
                                type="text"
                                placeholder={isNonStandardVehicle(vehicleType) ? "Kawasaki" : "Ford"}
                                value={make}
                                onChange={(e) => setMake(e.target.value)}
                                className="bg-background border-2 border-border/50"
                              />
                            </div>
                            <div>
                              <Label htmlFor="premium-model" className="text-xs text-muted-foreground mb-1">
                                {isNonStandardVehicle(vehicleType) ? "Model Name" : "Model"}
                              </Label>
                              <Input
                                id="premium-model"
                                type="text"
                                placeholder={isNonStandardVehicle(vehicleType) ? "Ninja 650" : "Mustang"}
                                value={model}
                                onChange={(e) => setModel(e.target.value)}
                                className="bg-background border-2 border-border/50"
                              />
                            </div>
                          </div>
                        </CollapsibleContent>
                      </Card>
                    </Collapsible>
                    </MyVehicleProToggle>
                      </>)}
                    />
                      </div>
                    </div>
                  ) : (
                    /* Collapsed LEFT pill */
                    <button
                      type="button"
                      onClick={() => setLeftColOpen(true)}
                      className="hidden lg:flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl border border-white/10 bg-gradient-to-b from-blue-500 to-pink-500 py-3 text-white shadow-[0_0_14px_rgba(236,72,153,0.45)] hover:brightness-110"
                      aria-label="Expand Design Brief"
                    >
                      <ChevronRight className="h-4 w-4" />
                      <span className="text-[10px] font-bold uppercase tracking-wider [writing-mode:vertical-rl]">Design Brief</span>
                    </button>
                  )}

                  {/* ── CENTER COLUMN — Konva workspace (dominant) ──
                      w-full on mobile: the parent flex row uses items-start, which
                      does NOT stretch children on the cross axis. In the mobile
                      flex-col layout the cross axis is horizontal, so without an
                      explicit width this column collapsed to ~0px and the KONVA
                      canvas rendered as a black sliver. lg:w-auto hands sizing back
                      to flex-1 on desktop. */}
                  <div id="render-area" className="min-w-0 flex-1 space-y-4 w-full lg:w-auto">
                    {/* Progress now lives INSIDE the Konva window (GeneratingFloor)
                        — the old DesignIQProgressBar was a duplicate second bar. */}

                    {showFlatFirstDiagnostic && (
                      <Card className="border-cyan-400/35 bg-cyan-400/5 p-3 text-sm text-cyan-50">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
                          <div>
                            <p className="font-semibold">A.T.L.A.S. Preview</p>
                            <p className="mt-1 text-xs leading-5 text-cyan-100/70">
                              Your flattened A.T.L.A.S. master appears first, followed by Driver Side. Select See All Views to reveal Driver, Passenger, Hood, Front, Rear, Close-Up, and Roof as each saved proof becomes ready from that same design.
                            </p>
                            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-300/80">
                              {generationRequestState
                                ? "Preview started"
                                : "Ready to start"}
                            </p>
                          </div>
                        </div>
                      </Card>
                    )}

                    {/* Persona Pipeline Progress */}
                    {isPersonaMode && isPersonaPipelineActive && (
                      <PersonaPipelineProgress
                        phase={personaPhase}
                        elapsedSeconds={personaElapsed}
                        photographerProgress={personaPhotographerProgress}
                      />
                    )}

                    {/* Render Preview */}
                    {(
                      <Card
                        id="preview-section"
                        className={cn(
                          "bg-black overflow-hidden relative border-white/10 mx-auto w-full aspect-video transition-all duration-500 ease-out",
                          // Bound the 16:9 KONVA window by WIDTH (not height) so the
                          // aspect ratio is ALWAYS preserved. A max-h clamp squashed
                          // the box into a short, wide strip on wide screens, which
                          // cover-cropped the render (vehicle top/bottom cut off).
                          // max-w in vh keeps the box true 16:9 and never taller than
                          // the old height cap (78vh*16/9≈138vh, 55vh*16/9≈97vh).
                          (previewDisplayUrl || pipelineActive || embedded)
                            ? "max-w-[138vh]"
                            : "max-w-[97vh]"
                        )}
                      >
                        {/* Success flash overlay */}
                        {successFlash && (
                          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/80 animate-in fade-in duration-300">
                            <p className="text-white text-lg font-semibold animate-pulse">
                              Your design is ready.
                            </p>
                          </div>
                        )}

                        {/* Error state */}
                        {(renderError || atlasNewRunRequired) && !previewDisplayUrl && !pipelineActive ? (
                          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-red-500/5 via-background to-red-500/10 px-6">
                            <img src="/characters/ace-v2.png" alt="ACE" className="w-20 h-20 rounded-full border-2 border-red-400/50 object-cover" />
                            <p className="text-white text-base font-semibold text-center">
                              Something went wrong.
                            </p>
                            {generationError && (
                              <p className="text-sm text-red-300 text-center max-w-md">
                                {generationError}
                              </p>
                            )}
                            <p className="text-sm text-gray-400 text-center">Let's try that again.</p>
                            <Button
                              onClick={() => { setRenderError(false); clearGenerationError(); }}
                              size="sm"
                              className="bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-600 hover:to-purple-600 text-white gap-2"
                            >
                              <RefreshCw className="w-4 h-4" />
                              Relaunch
                            </Button>
                          </div>
                        ) : previewDisplayUrl ? (
                          <div className="absolute inset-0 flex flex-col">
                            <div className="relative flex-1 min-h-0 group">
                              {/* LayerLiftIQ Konva canvas IS the center workspace viewport.
                                  Layer 1 floor = the selected view's render; Layer 2 = the
                                  draggable AI transparent PNG overlays. The thumbnails/arrows
                                  below switch the view and hot-swap the background floor. */}
                              {(() => {
                                const activeViewKey =
                                  displayedAllViews[clampedViewIndex]?.type || "side";
                                // CONDITIONAL CANVAS — kills the "two logos" bug. Only show the
                                // decomposed layer stack (clean background + editable overlays) when a
                                // REAL editable brand asset exists: a LIFTED cutout (id "lift-") or the
                                // customer's UPLOAD (id "upload-"), AND we have a clean per-view
                                // background to floor on. A regenerated text-layer overlay (id "txt_…")
                                // is NOT a real lift — showing it on top of the still-branded hero is
                                // exactly the doubled-logo bug. Otherwise show the cohesive FLAT branded
                                // hero with NO overlays, so the logo renders from exactly ONE source.
                                const overlaysHere = layerLayoutByView[activeViewKey]?.overlays ?? layerLiftElements;
                                // The SCRUBBED (branding-removed) background for this view: the clean
                                // per-view URL (clean-views view_urls) → the clean hero background
                                // (background_url, loaded into layerLiftBg). The editable overlay rides
                                // on THIS scrubbed base — NEVER the baked branded hero — so the logo is
                                // never doubled.
                                const scrubbedBg =
                                  cleanViewUrls[activeViewKey] ||
                                  ((activeViewKey === "side" || activeViewKey === "driver-side") ? layerLiftBg : "");
                                // Show the editable layer ON the scrubbed background whenever it exists
                                // (~97%). Only when NO scrubbed background is available yet do we fall
                                // back to the flat branded hero — and then with NO overlays, so there's
                                // never a doubled logo before the scrub lands.
                                const haveScrubbed = !!scrubbedBg;
                                // LOGO-VISIBLE FIX: the customer's UPLOADED logo (id "upload-") is the
                                // ONLY brand mark and the hero is kept clean of it (logo-wins), so there
                                // is NO doubled-logo risk — show it immediately, even before a scrubbed
                                // background lands. Previously ALL overlays were gated on haveScrubbed, so
                                // an uploaded logo never appeared until/unless the async scrub completed
                                // (often never) — that's why "the logo didn't show up on the design".
                                // When NOT scrubbed we show ONLY the uploaded logo(s) (safe); AI text
                                // overlays still wait for the scrub so they never double a baked line.
                                const uploadedOverlays = (overlaysHere || []).filter(
                                  (o: any) => typeof o?.id === "string" && o.id.startsWith("upload-")
                                );
                                // SMEAR FIX: the "clean" scrub (designpro-clean-views) plaid-inpaints
                                // the area where it erases baked text — that plaid band IS the smear.
                                // Never display the scrubbed view; always show the REAL branded render.
                                // Only the customer's uploaded logo rides on top (the render already has
                                // the design baked in) so there's no doubled branding. This is the
                                // faithful "LayerLift-gone" view the owner asked for.
                                // LAYERLIFT UI REMOVED — the design viewport is now a plain
                                // image of the real branded render. No Konva canvas, no
                                // transform/drag handles, no editable overlay layers. The
                                // render already has the full design (and logo) baked in, so
                                // a flat image is the faithful single-source view the owner
                                // wants across every angle.
                                void uploadedOverlays;
                                return (
                                  <img
                                    src={effectiveDisplayUrl}
                                    alt={designName || selectedPanel?.ai_generated_name || "Design"}
                                    className="absolute inset-0 h-full w-full object-contain"
                                    draggable={false}
                                  />
                                );
                              })()}
                              {atlasMasterPreviewUrl && !mainDisplayUrl && (
                                <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 rounded-xl border border-cyan-300/35 bg-black/80 px-3 py-2.5 shadow-[0_0_24px_rgba(34,211,238,0.2)] backdrop-blur-sm">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-bold text-cyan-100">Your A.T.L.A.S. flattened top-view design is ready</p>
                                      <p className="mt-0.5 text-[10px] text-cyan-100/65">Creating the seven projected 3D proof views.</p>
                                    </div>
                                    <span className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold text-cyan-200">
                                      {generationRequestState?.shotsComplete ?? 0} of {generationRequestState?.shotsTotal ?? 7} 3D proofs ready
                                    </span>
                                  </div>
                                </div>
                              )}
                              {/* Arrow navigation for cycling through views */}
                              {displayedAllViews.length > 1 && (
                                <>
                                  <button
                                    type="button"
                                    className="absolute left-2 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-opacity opacity-0 group-hover:opacity-100"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveViewIndex((prev) => (prev - 1 + displayedAllViews.length) % displayedAllViews.length);
                                    }}
                                  >
                                    <ChevronLeft className="w-5 h-5" />
                                  </button>
                                  <button
                                    type="button"
                                    className="absolute right-2 top-1/2 -translate-y-1/2 z-30 w-9 h-9 rounded-full bg-black/60 hover:bg-black/80 flex items-center justify-center text-white transition-opacity opacity-0 group-hover:opacity-100"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveViewIndex((prev) => (prev + 1) % displayedAllViews.length);
                                    }}
                                  >
                                    <ChevronRight className="w-5 h-5" />
                                  </button>
                                  {/* Thumbnail filmstrip */}
                                  <div className={cn("absolute bottom-0 inset-x-0 z-30 bg-gradient-to-t from-black/70 to-transparent px-2", isMobile ? "pt-3 pb-1" : "pt-6 pb-2")}>
                                    <div className="flex gap-1.5 justify-center">
                                      {displayedAllViews.map((view, i) => (
                                        <button
                                          key={view.type}
                                          type="button"
                                          className={cn(
                                            "rounded overflow-hidden border-2 transition-all shrink-0",
                                            isMobile ? "w-10 h-6" : "w-14 h-9",
                                            i === clampedViewIndex
                                              ? "border-pink-500 shadow-[0_0_8px_rgba(236,72,153,0.4)]"
                                              : "animate-thumbnail-sparkle border-pink-500/50 hover:opacity-100"
                                          )}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setActiveViewIndex(i);
                                          }}
                                        >
                                          <img
                                            src={view.url}
                                            alt={VIEW_LABEL_MAP[view.type] || view.type}
                                            className="w-full h-full object-cover"
                                          />
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                </>
                              )}
                              {/* Hide DesignIDBadge on mobile — info bar below shows same data */}
                              {!isMobile && (
                                <DesignIDBadge
                                  toolName={showMvpHero ? "MyVehiclePro™" : "DesignProAI™"}
                                  designName={designName || selectedPanel?.ai_generated_name || selectedPanel?.name}
                                  did={formatDid(generationIdRef.current) || renderDid || undefined}
                                  pt={renderPt || undefined}
                                  showPT={true}
                                />
                              )}
                              <div className={cn("absolute top-4 right-4 flex gap-2 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity", isMobile && "hidden")}>
                                <RenderQualityRating
                                  renderId={visualizationId || pushedRender?.visualizationId || mainDisplayUrl || ""}
                                  renderType="designpanelpro"
                                  renderUrl={mainDisplayUrl || ""}
                                  designDnaId={designDnaId}
                                />
                              </div>
                            </div>
                            {/* Info Bar removed \u2014 it added a black text strip below the
                                KONVA canvas that ate vertical space and made the render
                                look condensed. The DesignIDBadge overlay on the canvas
                                already shows tool name, design name, and DID. */}
                          </div>
                        ) : (
                          // Idle + generating BOTH live INSIDE the Konva window:
                          // ACE prompt invite when idle; ACE's moving progress bar
                          // + cycling status text (floor → desk) while generating.
                          <div className="absolute inset-0 min-h-[400px] flex items-center justify-center bg-black/30">
                            {/* LAYERLIFT UI REMOVED — plain idle/generating state, no Konva canvas. */}
                            {(pipelineActive || pipelineStage) ? (
                              // Live pipeline progress — the customer sees each real
                              // stage (analyze → GENIE enhance → render → finish) and
                              // is never left staring at a bare spinner.
                              <DesignPipelineProgress
                                stage={pipelineStage}
                                elapsed={pipelineElapsed}
                                requestState={generationRequestState}
                                isAtlas={isFlatFirstDiagnostic}
                                atlasReady={Boolean(latestFlatAtlas)}
                              />
                            ) : (
                              <div className="flex flex-col items-center gap-3 text-white/70">
                                <RefreshCw className="h-8 w-8" />
                                <p className="text-sm">Your design will appear here.</p>
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                    )}

                    {/* Existing all-views action, restored at the point where
                        Driver Side first becomes visible. It remains clickable
                        while the server is finishing later sides because this
                        action reveals/reads them; it does not start a producer. */}
                    {mainDisplayUrl && !allViewsRevealed && (
                      <Button
                        onClick={handleGenerateAllViews}
                        variant="outline"
                        className="w-full gap-2 border-cyan-400/50 bg-cyan-400/5 text-cyan-100 hover:bg-cyan-400/10"
                      >
                        <Layers className="w-4 h-4" />
                        See All Views
                      </Button>
                    )}

                    {/* Sprocket Generation Header — pinned DIRECTLY beneath the
                        canvas so the live timer + progress bar is visible the moment
                        "All Views" is clicked, with NO scrolling. Sprocket's rotating
                        wrap facts sit underneath as engagement content during the wait. */}
                    {allViewsRevealed && mainDisplayUrl && (
                      isViewsStillGenerating || (pipelineActive && sortedAllViews.length < requiredViewCount)
                    ) && (() => {
                      const totalViews = requiredViewCount;
                      const doneViews = Math.min(sortedAllViews.length, totalViews);
                      const pct = Math.round((doneViews / totalViews) * 100);
                      const viewElapsed = pipelineActive ? pipelineElapsed : additionalViewsElapsed;
                      const mm = Math.floor(viewElapsed / 60).toString().padStart(2, '0');
                      const ss = (viewElapsed % 60).toString().padStart(2, '0');
                      // All 7 views are in, but isGeneratingAdditional stays true through
                      // Call 8 (generate-2d-proof) + the deterministic panel gridslice —
                      // so without this the card sat frozen on "7/7 views ready" while it
                      // was actually building the 2D proof, reading as stuck.
                      const viewsComplete = doneViews >= totalViews;
                      return (
                        <Card className="overflow-hidden border-cyan-500/40 bg-gradient-to-br from-cyan-500/10 via-background to-purple-500/10 animate-thumbnail-sparkle">
                          <div className="p-5 sm:p-6">
                            {/* Top row: Sprocket + headline + timer */}
                            <div className="flex items-center gap-4 sm:gap-5">
                              <img
                                src={SPROCKET_DESIGN_FACTS[sprocketFactIndex % SPROCKET_DESIGN_FACTS.length].pose}
                                alt="Sprocket"
                                className="w-20 h-20 sm:w-24 sm:h-24 object-contain animate-sproket-bob shrink-0"
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
                                  <span className="text-xs sm:text-sm font-bold text-cyan-400 uppercase tracking-wider">
                                    {viewsComplete ? "Building Your 2D Production Proof" : "Generating Additional Views"}
                                  </span>
                                </div>
                                <div className="flex items-baseline gap-3 flex-wrap">
                                  {viewsComplete ? (
                                    <span className="text-sm sm:text-base font-semibold text-foreground/90">
                                      All 7 views ready — dimensioning &amp; packaging your print files
                                    </span>
                                  ) : (
                                    <>
                                      <span className="text-2xl sm:text-3xl font-bold text-foreground tabular-nums">
                                        {doneViews}<span className="text-muted-foreground/60">/{totalViews}</span>
                                      </span>
                                      <span className="text-xs text-muted-foreground uppercase tracking-wider">views ready</span>
                                    </>
                                  )}
                                  <span className="ml-auto text-xl sm:text-2xl font-bold text-cyan-300 tabular-nums">
                                    {mm}:{ss}
                                  </span>
                                </div>
                              </div>
                            </div>

                            {/* Progress bar — indeterminate pulse once views are done, since
                                Call 8 + gridslice have no granular % to report. */}
                            <div className="mt-4 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
                              <div
                                className={cn(
                                  "h-full bg-gradient-to-r from-cyan-400 to-purple-400 transition-all duration-700 ease-out",
                                  viewsComplete && "animate-pulse",
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>

                            {/* Sprocket's fact (rotates every 5s) */}
                            <div className="mt-4 pt-4 border-t border-cyan-500/20 flex items-start gap-2">
                              <Sparkles className="w-4 h-4 text-cyan-400 mt-0.5 shrink-0" />
                              <div className="flex-1 min-w-0">
                                <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider">
                                  Sprocket's Wrap Facts
                                </span>
                                <p className="text-sm text-foreground/90 font-medium leading-relaxed mt-1 animate-sproket-fade-up" key={sprocketFactIndex}>
                                  {SPROCKET_DESIGN_FACTS[sprocketFactIndex % SPROCKET_DESIGN_FACTS.length].fact}
                                </p>
                              </div>
                            </div>
                          </div>
                        </Card>
                      );
                    })()}

                    {/* Bottom view FILMSTRIP — labeled angle thumbnails (driver
                        side, passenger, hood, front, rear, close-up, roof) shown
                        below the canvas, above the page scroll. Click to switch
                        the canvas view; the Add View tile generates more angles. */}
                    {displayedAllViews.length > 0 && (
                      <div className="overflow-x-auto pb-1">
                        <div className="flex gap-2">
                          {displayedAllViews.map((view, i) => (
                            <button
                              key={view.type}
                              type="button"
                              onClick={() => setActiveViewIndex(i)}
                              className={cn(
                                "shrink-0 w-28 rounded-xl overflow-hidden border-2 transition-all",
                                i === clampedViewIndex
                                  ? "border-pink-500 shadow-[0_0_14px_rgba(236,72,153,0.45)]"
                                  : "border-white/10 hover:border-pink-500/50"
                              )}
                            >
                              <div className="aspect-video bg-zinc-900">
                                <img src={view.url} alt={VIEW_LABEL_MAP[view.type] || view.type} className="w-full h-full object-cover" />
                              </div>
                              <div className={cn(
                                "px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wider",
                                i === clampedViewIndex ? "bg-gradient-to-r from-blue-500/20 to-pink-500/20 text-pink-200" : "bg-black/60 text-white/55"
                              )}>
                                {VIEW_LABEL_MAP[view.type] || view.type}
                              </div>
                            </button>
                          ))}
                          {/* REMOVED 2026-07-31 — the "Add View" tile was a
                              DESTRUCTIVE REGENERATE mislabelled as additive. It
                              called handleGenerateAllViews, which re-runs the
                              whole seven-view set and replaces the existing
                              renders. Live: an owner with all 7 views complete
                              clicked it expecting an eighth angle and lost the
                              set to a full regeneration. A control that discards
                              finished work must never read as "add", and there
                              is no additive single-view generator behind it to
                              rename it to — the per-view retry lives on the view
                              itself (retryFailedView). */}
                        </div>
                      </div>
                    )}

                    {/* Pushed Render Context - shows original prompt & VisionBoard from RevisionStudioIQ */}
                    {pushedImageUrl && !generatedImageUrl && pushedRender && (
                      <Card className="p-4 bg-zinc-900 border-cyan-500/20 space-y-3">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-cyan-400" />
                          <p className="text-xs font-semibold text-cyan-400">Pushed from RevisionStudioIQ&#8482;</p>
                        </div>
                        {pushedRender.originalPrompt && (
                          <div className="space-y-1">
                            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Original Prompt</p>
                            <p className="text-sm text-foreground bg-background/50 rounded-md px-3 py-2 border border-border/50">
                              {pushedRender.originalPrompt}
                            </p>
                          </div>
                        )}
                        {pushedRender.visionBoardUrls?.length > 0 && (
                          <div className="space-y-1.5">
                            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">VisionBoardIQ&#8482; References</p>
                            <div className="grid grid-cols-4 gap-2">
                              {pushedRender.visionBoardUrls.map((url: string, i: number) => (
                                <div
                                  key={i}
                                  className="aspect-square rounded-lg overflow-hidden border border-blue-500/30 cursor-pointer"
                                  onClick={() => setExpandedImage({ url, title: `VisionBoard Reference ${i + 1}` })}
                                >
                                  <img src={url} alt={`VisionBoard ref ${i + 1}`} className="w-full h-full object-cover" />
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </Card>
                    )}

                    {/* MyVehiclePro Before/After Viewer — one per uploaded angle */}
                    {mvp.isMyVehicleMode && mvpMultiViewResults.length > 1 ? (
                      <div className="space-y-3">
                        {mvpIsGenerating && (
                          <p className="text-xs text-blue-400 font-medium animate-pulse text-center">
                            {mvpMultiViewResults.length} of {mvp.multiViewPhotos?.length || "?"} angles designed...
                          </p>
                        )}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {mvpMultiViewResults.map((r) => (
                            <BeforeAfterViewer
                              key={r.viewType}
                              beforeUrl={r.beforeUrl}
                              afterUrl={r.url}
                              beforeLabel="Your Vehicle"
                              afterLabel="With DesignProAI™"
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      mvp.isMyVehicleMode && mvpEditedImageUrl && (mvpBeforeUrl || mvp.photoPreviewUrl) && (
                        <BeforeAfterViewer
                          beforeUrl={mvpBeforeUrl || mvp.photoPreviewUrl!}
                          afterUrl={mvpEditedImageUrl}
                          beforeLabel="Your Vehicle"
                          afterLabel="With DesignProAI™"
                        />
                      )
                    )}

                    {/* MyVehiclePro Inline — for users who rendered with year/make/model,
                        lets them apply the generated design to a customer photo after the fact. */}
                    {!mvp.isMyVehicleMode && generatedImageUrl && !isFlatFirstDiagnostic && (
                      <MyVehicleProInline
                        modeType="designpro"
                        vehicleYear={year}
                        vehicleMake={make}
                        vehicleModel={model}
                        panelUrl={generatedImageUrl}
                        designName={designName || selectedPanel?.name || null}
                        renderUrl={generatedImageUrl}
                        finishType={selectedFinish}
                      />
                    )}

                    {/* Inline Revision Prompt - one quick revision after first driver view */}
                    {mainDisplayUrl && !pipelineActive && inlineRevisionEnabled && revisionCount < 1 && (
                      <PremiumRevisionPrompt
                        onRevisionSubmit={handleRevisionSubmit}
                        isGenerating={isBusy}
                        currentDesignId={generationIdRef.current}
                        revisionCount={revisionCount}
                      />
                    )}

                    {/* LayerLiftIQ canvas is embedded as the center viewport above —
                        no modal trigger needed. */}

                    {/* After first inline revision, direct to RevisionStudioIQ for precision edits */}
                    {mainDisplayUrl && !pipelineActive && inlineRevisionEnabled && revisionCount >= 1 && (
                      <Card className="p-4 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border-cyan-500/30 space-y-3">
                        <div className="flex items-center gap-3">
                          <img
                            src="/characters/sproket/sproket-revision.png"
                            alt="Sprocket"
                            className="w-10 h-10 object-contain shrink-0"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-foreground">
                              Need more precision edits?
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Use RevisionStudioIQ&#8482; to dial in specific zones, lock your selected view, and make targeted revisions.
                            </p>
                          </div>
                        </div>
                        <Button
                          onClick={() => {
                            const id = generationIdRef.current;
                            navigate(id ? `/revision-studio?id=${id}` : '/revision-studio');
                          }}
                          className="w-full gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold"
                        >
                          <RefreshCw className="w-4 h-4" />
                          Open RevisionStudioIQ&#8482;
                        </Button>
                      </Card>
                    )}

                    {/* Advanced Revision Studio link (shown before first revision) */}
                    {mainDisplayUrl && !pipelineActive && inlineRevisionEnabled && revisionCount < 1 && (
                      <Button
                        onClick={() => {
                          const id = generationIdRef.current;
                          navigate(id ? `/revision-studio?id=${id}` : '/revision-studio');
                        }}
                        variant="ghost"
                        size="sm"
                        className="w-full gap-2 text-muted-foreground hover:text-blue-400 text-xs"
                      >
                        <RefreshCw className="w-3 h-3" />
                        Open RevisionStudioIQ&#8482; for precision edits
                      </Button>
                    )}

                    {mainDisplayUrl && !pipelineActive && isFlatFirstDiagnostic && (
                      <Card className="border-amber-400/30 bg-amber-400/10 p-4">
                        <p className="text-sm font-semibold text-amber-100">Revisions are unavailable in A.T.L.A.S. Preview.</p>
                        <p className="mt-1 text-xs leading-5 text-amber-100/70">
                          Your design and vehicle views remain saved. Start a new design to explore another direction.
                        </p>
                      </Card>
                    )}

                    {/* Post-Render Action Buttons */}
                    {mainDisplayUrl && !pipelineActive && (
                      <div className="space-y-3">
                        {!isFlatFirstDiagnostic && (
                          <div className="grid grid-cols-1 gap-2">
                            <Button
                              onClick={() => setShowProofSheet(true)}
                              className="gap-2"
                            >
                              <ClipboardSignature className="w-4 h-4" />
                              PDF Proof Sheet
                            </Button>
                          </div>
                        )}

                        {/* Order CTAs */}
                        {isFlatFirstDiagnostic ? (
                          <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-xs leading-5 text-amber-100/80">
                            Production ordering is unavailable in Preview mode. Choose Production mode when you need production files.
                          </div>
                        ) : (
                        <div className="p-4 bg-gradient-to-r from-blue-500/10 to-purple-500/10 border border-blue-500/30 rounded-lg space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold">Ready to bring this to life?</p>
                            <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]">
                              Created with DesignIQ&#8482;
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Order a production pack to get flattened, print-ready panel files for your wrap shop.
                            Download your proof sheet or order production files from your wrap shop.
                          </p>
                          {/* Post-all-views Order Production Pack button removed — the
                              $299 order lives in the top banner + ProductionFlow rail. */}

                          {/* PrintPro — WPW-priced quote + order */}
                          <PrintProCTAButton
                            width="full"
                            className="h-11"
                            context={{
                              toolSource: "designpro",
                              renderUrl: generatedImageUrl,
                              renderUrls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
                              vehicleYear: year,
                              vehicleMake: make,
                              vehicleModel: model,
                              designName: designName || selectedPanel?.ai_generated_name || selectedPanel?.name,
                              finish: selectedFinish,
                              designId: generationIdRef.current,
                            }}
                          />

                          {/* Send for Client Approval — Proof Approval System Phase 2 */}
                          <Button
                            onClick={() => setSendForApprovalOpen(true)}
                            variant="outline"
                            className="w-full h-11 gap-2 border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/5"
                            disabled={!mainDisplayUrl}
                          >
                            <ClipboardSignatureIcon className="w-4 h-4" />
                            Send for Client Approval
                          </Button>
                        </div>
                        )}
                      </div>
                    )}


                    {/* Cut Contour Logo Pack */}
                    {mainDisplayUrl && !isFlatFirstDiagnostic && (
                      <Button
                        className="w-full bg-purple-600 hover:bg-purple-700 text-white h-11"
                        onClick={() => handleGenerateCutFiles({
                          id: generationIdRef.current || "",
                          mode_type: "designpanelpro",
                          render_urls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
                          vehicle_year: year,
                          vehicle_make: make,
                          vehicle_model: model,
                          design_file_name: selectedPanel?.ai_generated_name || selectedPanel?.name,
                        })}
                        disabled={isGeneratingCutFiles}
                      >
                        {isGeneratingCutFiles ? (
                          <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating Cut Files...</>
                        ) : (
                          <><Scissors className="w-4 h-4 mr-2" /> Generate Cut Contour Logo Pack</>
                        )}
                      </Button>
                    )}

                    {/* Failed Views Banner */}
                    {allViewsRevealed && failedViews.length > 0 && (
                      <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
                        <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                        <p className="text-sm text-amber-200">
                          {isFlatFirstDiagnostic
                            ? `${allViews.length} of ${requiredViewCount} views generated. The A.T.L.A.S. proof set is incomplete. Start a new A.T.L.A.S. run; individual views cannot be retried.`
                            : `${allViews.length} of ${requiredViewCount} views generated. ${failedViews.length} view${failedViews.length > 1 ? 's' : ''} failed - retry below or regenerate all.`}
                        </p>
                      </div>
                    )}

                    {/* Additional Views Grid - sorted to match locked VIEW_ORDER */}
                    {allViewsRevealed && (displayedAllViews.length > 0 || failedViews.length > 0) && (
                      <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                        {/* Successful views */}
                        {displayedAllViews.map((view) => (
                          <Card
                            key={view.type}
                            className={cn(
                              "overflow-hidden group relative aspect-video bg-secondary/30 cursor-pointer",
                              "animate-thumbnail-sparkle"
                            )}
                            onClick={() =>
                              setExpandedImage({
                                url: view.url,
                                title: `${year} ${make} ${model} - ${VIEW_LABEL_MAP[view.type] || view.type} View`,
                              })
                            }
                          >
                            <img src={view.url} alt={VIEW_LABEL_MAP[view.type] || view.type} className="w-full h-full object-cover" />
                            <DesignIDBadge
                              toolName="DesignProAI™"
                              did={formatDid(generationIdRef.current) || renderDid || undefined}
                            />
                            <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 rounded text-xs font-medium z-20">
                              {VIEW_LABEL_MAP[view.type] || view.type}
                            </div>
                            {/* Tap-to-enlarge indicator */}
                            <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-20">
                              <div className="bg-black/60 backdrop-blur-sm rounded-full px-2 py-1 flex items-center gap-1">
                                <Sparkles className="w-3 h-3 text-cyan-400" />
                                <span className="text-[9px] text-white/90 font-medium">Tap to enlarge</span>
                              </div>
                            </div>
                          </Card>
                        ))}
                        {/* Failed view retry slots */}
                        {failedViews.map((viewType) => (
                          <Card
                            key={viewType}
                            className="overflow-hidden relative aspect-video bg-secondary/20 border-dashed border-amber-500/30 flex items-center justify-center"
                          >
                            <div className="text-center space-y-2">
                              <p className="text-sm text-muted-foreground">{VIEW_LABEL_MAP[viewType] || viewType}</p>
                              {isFlatFirstDiagnostic ? (
                                <p className="text-xs text-amber-300">Start a new A.T.L.A.S. run.</p>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                                  disabled={isRetryingView === viewType}
                                  onClick={() => retryFailedView(viewType, year, make, model)}
                                >
                                  {isRetryingView === viewType ? (
                                    <><Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> Retrying...</>
                                  ) : (
                                    <><RefreshCw className="w-3 h-3 mr-1.5" /> Retry This View</>
                                  )}
                                </Button>
                              )}
                            </div>
                          </Card>
                        ))}
                      </div>
                    )}

                    {isFlatFirstDiagnostic && (
                      <Card className="overflow-hidden border-cyan-400/35 bg-cyan-400/5">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-400/20 px-4 py-3">
                          <div>
                            <p className="text-sm font-bold text-cyan-100">A.T.L.A.S. flattened top-view master</p>
                            <p className="mt-0.5 text-[11px] text-cyan-100/60">
                              Master design and seven vehicle views
                            </p>
                          </div>
                          <Badge className="border-amber-400/30 bg-amber-400/10 text-amber-200">
                            Preview mode
                          </Badge>
                        </div>

                        {flatAtlasLoadError ? (
                          <div className="p-4 text-xs text-red-300">
                            Your saved A.T.L.A.S. design could not be loaded. Please refresh this page.
                          </div>
                        ) : latestFlatAtlas ? (
                          <div className="grid gap-3 p-4 sm:grid-cols-2">
                            {[
                              { label: "Vehicle layout", signedUrl: latestFlatAtlas.guideUrl },
                              { label: "Flattened top-view design", signedUrl: latestFlatAtlas.masterUrl },
                            ].map(({ label, signedUrl }) => (
                              <div key={label} className="overflow-hidden rounded-lg border border-white/10 bg-black/40">
                                <div className="border-b border-white/10 px-3 py-2 text-[11px] font-semibold text-white/75">
                                  {label}
                                </div>
                                {signedUrl ? (
                                  <button
                                    type="button"
                                    className="block w-full"
                                    onClick={() => setExpandedImage({ url: signedUrl, title: label })}
                                  >
                                    <img src={signedUrl} alt={label} className="aspect-[4/3] w-full bg-white object-contain" />
                                  </button>
                                ) : (
                                  <div className="flex aspect-[4/3] items-center justify-center px-4 text-center text-xs text-white/40">
                                    Preparing preview…
                                  </div>
                                )}
                              </div>
                            ))}
                            <div className="sm:col-span-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-3 text-[10px] text-white/55">
                              <span>Revision {latestFlatAtlas.revisionSequence}</span>
                              <span>{flatAtlasRevisions.length} saved version{flatAtlasRevisions.length === 1 ? "" : "s"}</span>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 p-4 text-xs text-cyan-100/65">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Preparing your saved A.T.L.A.S. design…
                          </div>
                        )}
                      </Card>
                    )}

                    {/* ── 2D PRODUCTION PROOF (the "8th call") ──
                        Composited from the 7 locked views by the DesignIQ pipeline
                        (Phase 4a → designiq_generations.flat_proof_url). Surfaced
                        INLINE here the moment it's ready so the customer sees the
                        approval proof right after the views finish — not hidden
                        behind the PDF Proof Sheet dialog. */}
                    {proofToShow && (
                      <Card className="overflow-hidden border-cyan-500/30 bg-secondary/20 animate-thumbnail-sparkle">
                        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/10">
                          <div className="flex items-center gap-2">
                            <ClipboardSignature className="w-4 h-4 text-cyan-400" />
                            <span className="text-sm font-bold">2D Production Proof</span>
                          </div>
                          <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[10px]">
                            DesignIQ&#8482;
                          </Badge>
                        </div>
                        <button
                          type="button"
                          className="block w-full cursor-pointer"
                          onClick={() =>
                            setExpandedImage({
                              url: proofToShow,
                              title: `${year} ${make} ${model} — 2D Production Proof`,
                            })
                          }
                        >
                          <img
                            src={proofToShow}
                            alt="2D Production Proof"
                            className="w-full object-contain bg-white"
                            loading="lazy"
                          />
                        </button>
                      </Card>
                    )}
                  </div>

                  {/* ── RIGHT COLUMN — Production deck (collapsible) ── */}
                  {rightColOpen ? (
                    <div className="w-full lg:w-[300px] shrink-0 rounded-xl border border-white/10 bg-black/40 p-3 space-y-3">
                      <div className="flex items-center justify-between px-1">
                        <span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-xs font-bold uppercase tracking-wider text-transparent">ProductionFlow™</span>
                        <button
                          type="button"
                          onClick={() => setRightColOpen(false)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white"
                          aria-label="Collapse production"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>

                      {/* LAYERLIFT UI REMOVED — the "Revise with LayerLiftIQ" button and the
                          "Layer Stack" overlay panel are gone. Editing is no longer done via the
                          Konva overlay tools; the design viewport is a flat image. */}

                      {/* Coordinate table (per-view saved layouts) */}
                      <div className="rounded-lg border border-white/10 bg-black/30 p-2">
                        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/40">Saved Views</p>
                        {Object.keys(layerLayoutByView).length === 0 ? (
                          <p className="text-xs text-white/30">No saved placements.</p>
                        ) : (
                          <div className="space-y-1">
                            {Object.entries(layerLayoutByView).map(([vk, v]) => (
                              <div key={vk} className="flex items-center justify-between text-xs text-white/60">
                                <span className="truncate">{vk}</span>
                                <span className="text-white/30">{v.overlays?.length ?? 0} pcs</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Order Production Pack — always shown once a design exists.
                          If the required vehicle-class views aren't done yet, clicking PROMPTS the user
                          to finish the remaining views first (and kicks off the
                          all-views generation). Highlighted once it's truly ready. */}
                      {mainDisplayUrl && !isFlatFirstDiagnostic && (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              if (allViewsDone) {
                                // THE PACK IS ORDERED ON THE JOB, NOT HERE.
                                //
                                // This used to open ProductionPackDialog, which
                                // sized the vehicle through panelizer-step-validate,
                                // wrote a panelizer_jobs row and submitted the pack
                                // through designpro-file-output-api -- the whole
                                // legacy purchase path, started from the design
                                // screen. Production Layers on the job page is where
                                // the pack is bought now: it can only offer the
                                // button once Calls 9-11 have actually produced a
                                // verified, production-eligible set, so a customer
                                // cannot pay for a pack that does not exist.
                                navigate(
                                  generationIdRef.current
                                    ? `/designpro/jobs/${generationIdRef.current}`
                                    : "/designpro/jobs",
                                );
                              } else {
                                toast({
                                  title: `Finish all ${requiredViewCount} design views first`,
                                  description: "Generate the remaining vehicle views, then order your Production Pack.",
                                });
                                if (!isViewsStillGenerating) handleGenerateAllViews();
                                document.getElementById("preview-section")?.scrollIntoView({ behavior: "smooth", block: "center" });
                              }
                            }}
                            className={cn(
                              "w-full rounded-lg px-3 py-2.5 text-sm font-bold text-white shadow-lg transition",
                              allViewsDone
                                ? "bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 shadow-cyan-900/40 ring-2 ring-cyan-400/60 animate-pulse"
                                : "bg-gradient-to-r from-blue-600/60 to-cyan-500/60 hover:from-blue-600 hover:to-cyan-500 shadow-blue-900/30"
                            )}
                          >
                            Order Production Pack
                          </button>
                          {!allViewsDone && (
                            <p className="text-center text-[10px] text-amber-300/80">
                              {isViewsStillGenerating
                                ? `Generating all ${requiredViewCount} views…`
                                : `Finish all ${requiredViewCount} design views to order.`}
                            </p>
                          )}
                        </>
                      )}
                      {mainDisplayUrl && isFlatFirstDiagnostic && (
                        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100/75">
                          Production ordering is unavailable in A.T.L.A.S. Preview. Your design and seven vehicle views remain saved.
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Collapsed RIGHT pill — blue→magenta gradient */
                    <button
                      type="button"
                      onClick={() => setRightColOpen(true)}
                      className="hidden lg:flex w-10 shrink-0 flex-col items-center gap-2 rounded-xl bg-gradient-to-b from-blue-600 to-pink-600 py-3 text-white shadow-lg shadow-pink-900/30 hover:from-blue-500 hover:to-pink-500"
                      aria-label="Expand ProductionFlow"
                    >
                      <ChevronLeft className="h-4 w-4" />
                      <span className="text-[10px] font-bold uppercase tracking-wider [writing-mode:vertical-rl]">ProductionFlow™</span>
                    </button>
                  )}
                </div>

                {/* Footer Branding bar removed — the black "DesignProAI™ / DesignIQ™"
                    strip at the bottom of the tool card. */}
              </Card>
            </div>
          </ToolContainer>
        </section>
      </main>

      {/* Modals */}
      <MobileZoomImageModal
        imageUrl={expandedImage?.url || ""}
        title={expandedImage?.title}
        isOpen={!!expandedImage}
        onClose={() => setExpandedImage(null)}
      />

      <UpgradeRequired
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        requiredTier="complete"
        featureName="DesignProAI™"
      />

      <SocialEngagementModal
        open={socialModalOpen}
        onClose={() => setSocialModalOpen(false)}
        onUnlock={unlockBonus}
      />

      <PaywallModal open={paywallModalOpen} onClose={() => setPaywallModalOpen(false)} />

      <TryForTwentyFiveModal
        open={tryModalOpen}
        onClose={() => setTryModalOpen(false)}
        refSlug={tryRef}
        promo={tryPromo}
      />

      <LoginRequiredModal
        open={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        message="Please log in to generate renders. Create a free account to get started!"
      />

      {/* Proof Approval System (Phase 2) — Send design to client for e-signature */}
      <SendForApprovalDialog
        open={sendForApprovalOpen}
        onOpenChange={setSendForApprovalOpen}
        context={{
          visualizationId: generationIdRef.current,
          renderUrls: allViews.reduce(
            (acc, v) => ({ ...acc, [v.type]: v.url }),
            {} as Record<string, string>,
          ),
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          vehicleType,
          designName: designName || selectedPanel?.ai_generated_name || selectedPanel?.name,
          finishType: selectedFinish,
          defaultMode: "revision_loop",
        }}
      />

      {/* THE 2D PRODUCTION PROOF IS CALL 8's ARTIFACT, SHOWN FULL SIZE.
          It used to be ProfessionalProofSheet, which composed a proof sheet in
          the browser out of the view images -- a second producer of the one
          document the customer approves and manufacturing is cut from. Two
          proofs for one design is the failure the whole frozen seam exists to
          prevent: the sheet on screen would not be the sheet Call 9 read, and
          nothing would say so. */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-y-auto p-0 bg-white">
          {proofToShow ? (
            <img
              src={proofToShow}
              alt="DesignProAI 2D Production Proof"
              className="w-full h-auto"
            />
          ) : (
            <div className="p-10 text-center text-sm text-gray-500">
              {isFlatFirstDiagnostic
                ? "The production proof is unavailable in A.T.L.A.S. Preview."
                : "The 2D Production Proof is still building and will appear here when it is ready."}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ACE Welcome Modal - auto-plays on first visit */}
      <Dialog open={aceWelcomeOpen} onOpenChange={(open) => { if (!open) dismissAceWelcome(); }}>
        <DialogContent className="w-[90vw] max-w-sm bg-gray-900/80 backdrop-blur-xl border border-cyan-500/20 shadow-[0_0_40px_rgba(0,210,210,0.1)]">
          <div className="flex flex-col items-center text-center space-y-4 py-4">
            <img
              src="/characters/ace-v2.png"
              alt="ACE - AI Creative Engine"
              className="max-w-[120px] h-auto object-contain animate-ace-bounce"
            />
            <div className="space-y-2">
              <h3 className="text-lg font-bold text-white">
                Hi, I'm <span className="text-cyan-400">ACE</span> — your AI Creative Engine
              </h3>
              <p className="text-sm text-gray-400 leading-relaxed">
                I design vehicle wraps from your vision. Pick a style, describe your idea, and I'll create a photorealistic wrap in seconds.
              </p>
            </div>
            <Button
              onClick={dismissAceWelcome}
              className="btn-designiq text-white font-semibold border-0 px-8"
            >
              <Sparkles className="w-4 h-4 mr-2" />
              Let's Design
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Legacy upsell estimator pill — left side, kept for the upsell /
          catalog / manual-line workflow that the shop owner already uses. */}
      <div className="fixed bottom-6 left-6 z-40">
        <EstimatorDrawer
          value={estimator.state}
          onChange={estimator.setState}
          onSaveDraft={handleEstimatorSaveDraft}
          onSend={handleEstimatorSend}
          onCheckoutOnWpw={isWpwShop ? handleEstimatorCheckoutOnWpw : undefined}
          onUpsellApply={handleEstimatorUpsellApply}
          upsellPendingKey={upsellPendingKey}
          trigger={
            <OpenEstimatorButton
              state={estimator.state}
              label="Estimator"
              className="h-12 px-5 shadow-xl shadow-fuchsia-500/20 backdrop-blur-sm border-fuchsia-500/40 bg-gradient-to-r from-fuchsia-500/15 via-purple-500/10 to-blue-500/15 text-white font-semibold hover:border-fuchsia-400/60"
            />
          }
        />
      </div>

      {/* Persistent floating QuickQuote pill — opens the branded
          "QuickQuote × DesignPro" sidebar (matches ColorPro /
          GraphicsPro). Lives bottom-right so it doesn't collide with
          the legacy Estimator pill on the left. */}
      {!showQuickQuote && (
        <button
          type="button"
          onClick={() => setShowQuickQuote(true)}
          aria-label="Open QuickQuote"
          className="fixed right-4 sm:right-6 z-40 flex items-center gap-2 rounded-full px-4 sm:px-5 py-3 text-sm font-bold text-white shadow-[0_8px_24px_rgba(168,85,247,0.45)] hover:opacity-95 active:scale-95 transition"
          style={{
            background: "linear-gradient(135deg, #2563eb, #a855f7)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)",
          }}
        >
          <Calculator className="w-4 h-4" />
          <span className="hidden sm:inline">QuickQuote</span>
        </button>
      )}

      {/* QuickQuote × DesignPro side panel — same dashboard QuickQuoteCard
          the other tools use, pre-seeded with vehicle + render so price
          tracks the design. */}
      <QuickQuoteSidePanel
        open={showQuickQuote}
        onClose={() => setShowQuickQuote(false)}
        toolName="DesignPro"
      >
        <QuickQuoteCard
          initial={{
            year: year || undefined,
            make: make || undefined,
            model: model || undefined,
            finish: selectedFinish || "Gloss",
            designName: designName || undefined,
            renderUrl: precisionRenderUrl ?? generatedImageUrl ?? undefined,
            // Forward every upsell line item the rep has stacked on the
            // active render (chrome delete, carbon fiber, racing stripe…)
            // so they appear immediately in the QuickQuote panel as
            // pre-priced custom lines. Without this, clicks on the
            // PrecisionModButtons strip updated the design + the local
            // estimator but never made it into the visible quote.
            extraCustomLines: estimator.state.items
              .filter((i) => i.source === "upsell")
              .map((i) => ({
                label: i.label,
                price: (Number(i.unitPrice) || 0) * (Number(i.qty) || 1),
              })),
          }}
        />
      </QuickQuoteSidePanel>

      {/* Which build am I looking at? Fixed to the viewport so it survives the
          page's own scrolling and is reachable on a phone, where there is no
          console to ask. Turns amber and becomes tappable when a newer build is
          live. Hidden in embedded mode — this is a workbench instrument, not
          chrome for a page hosted inside something else. */}
      {!embedded && (
        <BuildTag className="fixed bottom-3 right-3 z-50 shadow-sm" />
      )}
    </div>
  );
}
