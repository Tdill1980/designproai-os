import { useState, useRef, useEffect } from "react";
import { usePreloadRender } from "@/hooks/usePreloadRender";
import { VehicleAutocomplete } from "@/components/tools/VehicleAutocomplete";
import { PrintProCTAButton } from "@/components/PrintProCTAButton";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { VehicleTypeSelector, isNonStandardVehicle } from "@/components/tools/VehicleTypeSelector";
import { NonStandardVehicleLookup } from "@/components/tools/NonStandardVehicleLookup";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDesignProLogic } from "@/hooks/useDesignProLogic";
import { useRevisionHistory } from "@/hooks/useRevisionHistory";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { QuickQuoteCard } from "@/components/dashboard/QuickQuoteCard";
import { QuickQuoteSidePanel } from "@/components/quote/QuickQuoteSidePanel";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { RenderQualityRating } from "@/components/RenderQualityRating";
import { MarkAsPerfectButton } from "@/components/MarkAsPerfectButton";
import { PanelUploader } from "@/components/designpanelpro/PanelUploader";
import { PanelLibrary } from "@/components/designpanelpro/PanelLibrary";
import { FadeColorSelector, FadeColor } from "@/components/fadewraps/FadeColorSelector";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { DesignProductsCompareCard } from "@/components/quote/DesignProductsCompareCard";
import { MobileProofSheet } from "@/components/tools/MobileProofSheet";
import { TwoDProofSheet } from "@/components/tools/TwoDProofSheet";
import { ChevronDown, X, Car, RefreshCw, Palette, Grid3x3, ShoppingBag, FileText, ClipboardSignature, AlertCircle, LogIn, Scissors, Loader2, Edit3, Maximize2, FlipHorizontal2, Calculator } from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { cn, toUuidOrNull } from "@/lib/utils";
import { Link, useNavigate, useLocation } from "react-router-dom";
// PanelizerConfigurator moved to DesignPanelProPremium with manual step pipeline
import { type PanelSelection } from "@/lib/panelizer-config";
import { CoverageSelector } from "@/components/tools/CoverageSelector";
import { DesignIDBadge } from "@/components/DesignIDBadge";
import { supabase } from "@/integrations/supabase/client";
import { DesignRevisionPrompt } from "@/components/tools/DesignRevisionPrompt";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import { DesignIQExpectations } from "@/components/designpanelpro/DesignIQExpectations";
import { StudioProofLayout } from "@/components/tools/StudioProofLayout";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { MyVehicleProToggle } from "@/components/tools/MyVehicleProToggle";
import { useMyVehicleMode } from "@/hooks/useMyVehicleMode";
import { useMyVehicleGenerate } from "@/hooks/useMyVehicleGenerate";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import { Camera } from "lucide-react";

export const DesignProToolUI = ({ preloadRenderId, autoOpenQuickQuote }: { preloadRenderId?: string | null; autoOpenQuickQuote?: boolean }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const [showSendForApproval, setShowSendForApproval] = useState(false);
  const { subscription, checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const {
    mode, setMode,
    selectedPattern, setSelectedPattern,
    selectedFinish, setSelectedFinish,
    coverageType, setCoverageType,
    gradientDirection, setGradientDirection,
    fadeStyle, setFadeStyle,
    patterns, isLoading,
    generateRender, isGenerating,
    generatedImageUrl, visualizationId,
    allViews, generateAdditionalViews, isGeneratingAdditional,
    uploadMode, setUploadMode,
    showUpgradeModal, setShowUpgradeModal,
    clearLastRender,
    hydrateFromPreview,
    lastError, setLastError,
    renderDid, renderPt, designName: hookDesignName,
    vehicleType, setVehicleType,
  } = useDesignProLogic();

  // Phase 2 Rank 2 — revision capture for the DesignPro pipeline (this
  // surface previously logged nothing; sister tools already do).
  const { saveRevision } = useRevisionHistory('designpro', visualizationId);

  // MyVehiclePro state
  const mvp = useMyVehicleMode();
  const { mvpIsGenerating, mvpEditedImageUrl, mvpBeforeUrl, mvpMultiViewResults, mvpError, generateOnMyVehicle, clearMyVehicleResults } = useMyVehicleGenerate();

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [yearError, setYearError] = useState(false);
  const [vehicleSqFt, setVehicleSqFt] = useState(0);
  const [expandedImage, setExpandedImage] = useState<{ url: string; title: string } | null>(null);
  const [showStudioGallery, setShowStudioGallery] = useState(false);
  const [zoomViewIndex, setZoomViewIndex] = useState(0);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  // Parallel 2D-proof pre-render. As soon as all-sides views complete we
  // fire generate-2d-proof in the background so the proof is ready (and
  // can be previewed inline on the page) by the time the rep clicks the
  // 2D Proof button — no spinner wait, no on-demand kickoff.
  const [twoDProofUrl, setTwoDProofUrl] = useState<string | null>(null);
  const [twoDProofGenerating, setTwoDProofGenerating] = useState(false);
  const twoDProofKickedRef = useRef<string | null>(null);
  const [showQuickQuote, setShowQuickQuote] = useState(!!autoOpenQuickQuote);
  const [isGeneratingPack, setIsGeneratingPack] = useState(false);
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();
  const [productionPackUrl, setProductionPackUrl] = useState<string | null>(null);
  const [isRevising, setIsRevising] = useState(false);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const [vehicleInputOpen, setVehicleInputOpen] = useState(true);
  const [pullToRefreshActive, setPullToRefreshActive] = useState(false);
  const [flippedViews, setFlippedViews] = useState<Record<string, boolean>>({});
  const touchStartY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Preload render from "See in Studio" link
  const { data: preloadRender } = usePreloadRender(preloadRenderId ?? null);
  useEffect(() => {
    if (!preloadRender) return;
    if (preloadRender.vehicle_year) setYear(preloadRender.vehicle_year);
    if (preloadRender.vehicle_make) setMake(preloadRender.vehicle_make);
    if (preloadRender.vehicle_model) setModel(preloadRender.vehicle_model);
    const urls = preloadRender.render_urls ?? {};
    const heroUrl = urls.hero || urls.side || Object.values(urls)[0] || "";
    if (heroUrl) {
      hydrateFromPreview({
        heroUrl,
        renderUrls: urls,
        visualizationId: preloadRender.id,
      });
    }
    if (preloadRender.finish_type) {
      const f = preloadRender.finish_type.charAt(0).toUpperCase() + preloadRender.finish_type.slice(1).toLowerCase();
      if (f === "Gloss" || f === "Satin" || f === "Matte") setSelectedFinish(f);
    }
    toast({ title: "Render loaded", description: "Preloaded from render history" });
  }, [preloadRender]); // eslint-disable-line react-hooks/exhaustive-deps

  // Hydrate from Revision Studio IQ preview (no regeneration needed)
  useEffect(() => {
    const state = location.state as any;
    if (state?.previewRender) {
      const p = state.previewRender;
      hydrateFromPreview({
        heroUrl: p.heroUrl,
        renderUrls: p.renderUrls || {},
        designName: p.designName,
        visualizationId: p.visualizationId,
      });
      setYear(p.vehicleYear || "");
      setMake(p.vehicleMake || "");
      setModel(p.vehicleModel || "");
      if (p.finishType) {
        const finish = p.finishType.charAt(0).toUpperCase() + p.finishType.slice(1).toLowerCase();
        if (finish === "Gloss" || finish === "Satin" || finish === "Matte") {
          setSelectedFinish(finish);
        }
      }
      // Clear location state so refresh doesn't re-hydrate
      window.history.replaceState({}, document.title);
      toast({ title: "Render loaded", description: "Preview loaded from Revision Studio IQ" });
    }
  }, []); // Run once on mount

  // Pull-to-refresh for mobile
  useEffect(() => {
    if (!isMobile) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (window.scrollY === 0) {
        touchStartY.current = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (window.scrollY !== 0) return;
      
      const touchY = e.touches[0].clientY;
      const pullDistance = touchY - touchStartY.current;
      
      if (pullDistance > 80) {
        setPullToRefreshActive(true);
      }
    };

    const handleTouchEnd = () => {
      if (pullToRefreshActive) {
        window.location.reload();
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('touchstart', handleTouchStart, { passive: true });
      container.addEventListener('touchmove', handleTouchMove, { passive: true });
      container.addEventListener('touchend', handleTouchEnd);
    }

    return () => {
      if (container) {
        container.removeEventListener('touchstart', handleTouchStart);
        container.removeEventListener('touchmove', handleTouchMove);
        container.removeEventListener('touchend', handleTouchEnd);
      }
    };
  }, [isMobile, pullToRefreshActive]);

  // Pre-fill year/make/model from MyVehiclePro detection
  useEffect(() => {
    if (mvp.detectedVehicleInfo) {
      if (mvp.detectedVehicleInfo.make && !make) setMake(mvp.detectedVehicleInfo.make);
      if (mvp.detectedVehicleInfo.model && !model) setModel(mvp.detectedVehicleInfo.model);
      if (mvp.detectedVehicleInfo.year && !year) setYear(mvp.detectedVehicleInfo.year);
    }
  }, [mvp.detectedVehicleInfo]);

  // LOCKED PIPELINE: Auto-fire all views → 2D proof → artboard when hero render completes.
  const autoFireRef = useRef(false);
  useEffect(() => {
    if (generatedImageUrl && allViews.length === 0 && !isGeneratingAdditional && !autoFireRef.current) {
      autoFireRef.current = true;
      generateAdditionalViews(year, make, model);
    }
    if (!generatedImageUrl) {
      autoFireRef.current = false;
    }
  }, [generatedImageUrl, allViews.length, isGeneratingAdditional]);

  // Pre-render the 2D proof in parallel as soon as the all-sides views land.
  // Fingerprint by vehicle + sorted view URLs so we don't re-fire on every
  // re-render, and so switching vehicles correctly re-kicks generation.
  useEffect(() => {
    if (!generatedImageUrl) return;
    if (isGeneratingAdditional) return;
    if (twoDProofGenerating) return;
    if (allViews.length < 4) return; // need at least driver/passenger/front/rear
    if (!year || !make || !model) return;

    const fingerprint = [
      year, make, model,
      ...allViews.map((v) => v.url).filter(Boolean).sort(),
    ].join("|");
    if (twoDProofKickedRef.current === fingerprint) return;
    twoDProofKickedRef.current = fingerprint;

    const allViewUrls: Record<string, string> = {};
    for (const v of allViews) {
      if (v?.url) allViewUrls[v.type] = v.url;
    }
    const sideUrl =
      allViews.find((v) => v.type === "side" || v.type === "driver-side")?.url ||
      generatedImageUrl;

    setTwoDProofGenerating(true);
    (async () => {
      try {
        const { findVehicle } = await import("@/data/vehicle-measurements");
        const vehicle = findVehicle(make, model, year);
        const dimensions = vehicle
          ? {
              sideW: vehicle.sideW, sideH: vehicle.sideH,
              hoodW: vehicle.hoodW, hoodL: vehicle.hoodL,
              roofW: vehicle.roofW, roofL: vehicle.roofL,
              backW: vehicle.backW, backH: vehicle.backH,
              totalSqFt: vehicle.totalSqFt, corrSqFt: vehicle.corrSqFt,
            }
          : null;

        const res = await supabase.functions.invoke("generate-2d-proof", {
          body: {
            allViewUrls,
            sideUrl,
            vehicleYear: year,
            vehicleMake: make,
            vehicleModel: model,
            designName: hookDesignName || selectedPattern?.name || "Custom Design",
            finish: selectedFinish || "Gloss",
            dimensions,
          },
        });
        const proofUrl = (res?.data as any)?.proofUrl;
        if (proofUrl) setTwoDProofUrl(proofUrl);
      } catch (err) {
        console.warn("[DesignPro] background 2D proof failed", err);
        twoDProofKickedRef.current = null; // allow retry on next view change
      } finally {
        setTwoDProofGenerating(false);
      }
    })();
  }, [
    generatedImageUrl,
    isGeneratingAdditional,
    allViews,
    year,
    make,
    model,
    selectedFinish,
    hookDesignName,
    selectedPattern?.name,
    twoDProofGenerating,
  ]);

  const validateYear = () => {
    if (!year || year.trim() === '') {
      setYearError(true);
      setVehicleInputOpen(true);
      yearInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      yearInputRef.current?.focus();
      setTimeout(() => setYearError(false), 2000);
      return false;
    }
    return true;
  };

  const handleGenerate = async () => {
    if (!selectedPattern) {
      toast({
        title: "No design selected",
        description: `Please select a ${mode === "panels" ? "panel design" : "gradient pattern"} first`,
        variant: "destructive"
      });
      return;
    }

    if (!validateYear()) return;

    if (!make || !model) {
      toast({ title: "Vehicle required", description: "Please enter year, make, and model", variant: "destructive" });
      return;
    }

    // Subscription check only applies if user has subscription
    if (subscription) {
      const canGen = await checkCanGenerate();
      if (!canGen) {
        setShowUpgradeModal(true);
        return;
      }
    }

    // ─── MyVehiclePro Mode: render ONLY on customer's uploaded photo ───
    if (mvp.isMyVehicleMode) {
      if (!mvp.hasPhotos) {
        toast({ title: "No photo uploaded", description: "Upload a photo of your vehicle first", variant: "destructive" });
        return;
      }

      // For DesignPro panels mode, the "wrap design" is the AI-generated
      // 3D studio render — DesignIQ elevates the flat library panel into
      // a finished creative design (e.g. "Bakery Wedding Cake" panel art
      // is a generic pattern, the studio render is the actual cake-themed
      // wrap). Falling back to the flat panel here applies the raw library
      // artwork to the customer photo, which is NOT what was created.
      // Require a studio render first.
      if (mode === "panels" && !generatedImageUrl) {
        toast({
          title: "Generate a studio proof first",
          description: "Click Generate 3D Proof with MyVehiclePro off to create your design, then turn MyVehiclePro on to transfer it to your photo.",
          variant: "destructive",
        });
        return;
      }

      const designReferenceUrl =
        mode === "panels" ? generatedImageUrl : selectedPattern?.media_url;

      // Panels mode sends the studio design as `panelUrl` (an IMAGE), not a
      // text prompt — so it must route to edit-vehicle-photo (the design-image
      // transfer function), NOT design-on-vehicle-photo (which requires a text
      // prompt and otherwise drops the design, leaving an empty studio vehicle).
      // "DesignPanelPro" → pickMyVehicleEndpoint → edit-vehicle-photo.
      const mvpToolSource =
        mode === "gradients" ? "FadeWraps"
        : mode === "panels" ? "DesignPanelPro"
        : "DesignProAI";

      const colorData: Record<string, any> = {
        colorName: selectedPattern?.name || "Custom Design",
        hex: selectedPattern?.hex || "#808080",
        finish: (selectedFinish || "Gloss").toLowerCase(),
        toolSource: mvpToolSource,
      };
      if (mode === "panels" && designReferenceUrl) {
        colorData.panelUrl = designReferenceUrl;
        colorData.panelName = selectedPattern?.name;
      }
      if (mode === "gradients") {
        colorData.fadeStyle = fadeStyle;
      }

      const success = await generateOnMyVehicle({
        photoBase64: mvp.photoBase64!,
        photoMimeType: mvp.photoMimeType,
        photoPreviewUrl: mvp.photoPreviewUrl,
        multiViewPhotos: mvp.multiViewPhotos,
        uploadMode: mvp.uploadMode,
        colorData,
        vehicleInfo: { make, model, year },
      });

      if (success) {
        await incrementRenderCount();
        toast({ title: "Applied to your vehicle!", description: "Design visualized on your photo.", duration: 4000 });
        document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        toast({ title: "Generation Failed", description: mvpError || "Please try again", variant: "destructive" });
      }
      return;
    }

    // ─── Studio Mode: render on stock 3D model ───
    setTimeout(() => {
      document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
    await generateRender(year, make, model);
  };

  const handleGenerateAllViews = async () => {
    if (!generatedImageUrl) {
      toast({ title: "No render available", description: "Generate a 3D proof first", variant: "destructive" });
      return;
    }
    
    await generateAdditionalViews(year, make, model);
  };

  // Revision handler - re-renders the driver side with the current image as reference
  const handleRevisionSubmit = async (revisionPrompt: string) => {
    if (!selectedPattern || !year || !make || !model) return;
    const originalUrl = generatedImageUrl;
    setIsRevising(true);
    try {
      await generateRender(year, make, model, revisionPrompt, originalUrl || undefined);
      // Phase 2 Rank 2 — log (before, prompt, after) for the corpus.
      // Fire-and-forget; never block the revision UX on a logging failure.
      if (generatedImageUrl) {
        saveRevision({
          viewType: 'side',
          originalUrl,
          revisedUrl: generatedImageUrl,
          revisionPrompt,
          designId: visualizationId || undefined,
        }).catch(err => console.warn('[DesignPro] saveRevision failed (non-fatal):', err));
      }
      toast({ title: "Revision applied", description: "Your design has been updated." });
    } catch (err: any) {
      toast({ title: "Revision failed", description: err.message || "Could not apply revision.", variant: "destructive" });
    } finally {
      setIsRevising(false);
    }
  };

  // Clear selections when switching modes
  const handleModeChange = (newMode: "panels" | "gradients") => {
    setMode(newMode);
    setSelectedPattern(null);
    clearLastRender();
    clearMyVehicleResults();
  };

  // When the user picks a different panel/color, the previous MyVehiclePro
  // render no longer matches the new design — clear it so the UI doesn't
  // show stale "after" art from the prior selection.
  const lastPatternIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentId = selectedPattern?.id ?? null;
    if (lastPatternIdRef.current && lastPatternIdRef.current !== currentId) {
      clearLastRender();
      clearMyVehicleResults();
    }
    lastPatternIdRef.current = currentId;
  }, [selectedPattern?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Production pack generation - requires All Views to be completed first
  const handleGenerateProductionPack = async (selection: PanelSelection) => {
    if (!selectedPattern?.media_url) {
      console.error("[Panelizer V2] No panel media_url - cannot generate production pack");
      toast({ title: "No panel selected", description: "Generate a design first.", variant: "destructive" });
      return;
    }

    if (allViews.length < 2) {
      console.error("[Panelizer V2] All Views not generated - panelizer requires 3D renders");
      toast({ title: "All Views required", description: "Generate All Views first - the panelizer uses the 3D renders to create section-specific panels.", variant: "destructive" });
      return;
    }

    // Build renderUrls map from allViews: { side: url, 'passenger-side': url, ... }
    const renderUrls: Record<string, string> = {};
    for (const view of allViews) {
      if (view.url) {
        renderUrls[view.type] = view.url;
      }
    }

    // V4 pipeline: renderUrl is the PRIMARY creative input (3D render from Phase 1)
    // The side view is the best source for master texture extraction
    const primaryRenderUrl = renderUrls.side || renderUrls["driver-side"] || Object.values(renderUrls)[0];

    console.log("[Panelizer V4] Starting production pack generation:", {
      renderUrl: primaryRenderUrl,
      panelUrl: selectedPattern.media_url,
      designName: selectedPattern.name,
      generationId: visualizationId,
      renderUrls: Object.keys(renderUrls),
      selection,
    });

    setIsGeneratingPack(true);
    setProductionPackUrl(null);

    try {
      const { supabase: sb } = await import("@/integrations/supabase/client");
      const { buildPanelList } = await import("@/lib/panelizer-config");
      const { data: { user } } = await sb.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const panels = buildPanelList(selection);

      // Create panelizer_jobs record - pipeline runs in steps, not one call
      const { data: newJob, error: jobErr } = await sb
        .from("panelizer_jobs" as any)
        .insert({
          user_id: user.id,
          generation_id: toUuidOrNull(visualizationId),
          approved_render_url: primaryRenderUrl,
          all_view_urls: renderUrls,
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          panels: panels.map(p => ({ id: p.id, label: p.label, widthInches: p.widthInches, heightInches: p.heightInches, mirrored: p.mirrored })),
          status: "queued",
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (jobErr) throw jobErr;

      const jobId = (newJob as any).id;
      const orderNumber = (newJob as any).order_number;

      // Initialize AND run the pipeline. "init_only" used to park the job in
      // 'queued' forever (nothing auto-advanced it — no cron, and ProductionFlow
      // has no run path), which is why every built pack sat stuck. payment_confirmed
      // mints the design-equity fingerprint, sets up stage_progress, then falls
      // through to the self-advancing run_all loop so the pack actually builds.
      const { error: pipeErr } = await sb.functions.invoke("run-production-flow", {
        body: { job_id: jobId, trigger: "payment_confirmed", mode: "project" },
      });
      if (pipeErr) console.error("Pipeline run error (non-blocking):", pipeErr);

      toast({ title: "Production Job Created", description: `${orderNumber} - opening ProductionFlow...` });
      navigate(`/productionflow/${jobId}`);
    } catch (err: any) {
      console.error("[Panelizer V4] Production job error:", err);
      toast({
        title: "Generation failed",
        description: err.message || "Could not create production job",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingPack(false);
    }
  };

  return (
    <div ref={containerRef} className="container max-w-7xl mx-auto px-3 sm:px-4 py-2 pb-24 overflow-x-hidden relative">
      {pullToRefreshActive && isMobile && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-primary/90 text-primary-foreground py-3 flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">Release to refresh...</span>
        </div>
      )}

      <Card className="overflow-hidden">
        {/* Header with Mode Toggle */}
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-background p-4 sm:p-6 border-b space-y-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold mb-2">
            <span className="text-foreground">Restyle</span>
            <span className="text-gradient-blue">Library™</span>
            </h2>
            <p className="text-sm text-muted-foreground">
              Professional wrap design library with curated panels and production packs
            </p>
          </div>

          {/* Mode Toggle */}
          <div className="flex gap-2">
            <Button
              variant={mode === "panels" ? "default" : "outline"}
              onClick={() => handleModeChange("panels")}
              className="flex-1 sm:flex-initial"
            >
              <Grid3x3 className="w-4 h-4 mr-2" />
              Panel Designs
            </Button>
            <Button
              variant={mode === "gradients" ? "default" : "outline"}
              onClick={() => handleModeChange("gradients")}
              className="flex-1 sm:flex-initial"
            >
              <Palette className="w-4 h-4 mr-2" />
              FadeWraps
            </Button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex flex-col xl:grid xl:grid-cols-[380px,1fr] gap-4 sm:gap-6 p-3 sm:p-4 lg:p-6">
          {/* Left Sidebar */}
          <div className="space-y-4">
            {/* MyVehiclePro Toggle + Vehicle Information */}
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
            >
              <Collapsible open={vehicleInputOpen} onOpenChange={setVehicleInputOpen}>
                <Card className="bg-secondary border-border/30 p-3">
                  <CollapsibleTrigger className="w-full min-h-[44px]">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Car className="w-4 h-4" />
                        <span className="text-sm font-semibold">Vehicle Details</span>
                      </div>
                      <ChevronDown className={cn("w-4 h-4 transition-transform", vehicleInputOpen && "rotate-180")} />
                    </div>
                  </CollapsibleTrigger>

                  <CollapsibleContent>
                    {/* Vehicle type — push-button per class */}
                    <div className="mb-3">
                      <VehicleTypeSelector value={vehicleType} onChange={setVehicleType} />
                    </div>
                    {isNonStandardVehicle(vehicleType) ? (
                      <NonStandardVehicleLookup
                        vehicleType={vehicleType}
                        onFieldsChange={(f) => {
                          setYear(f.year);
                          setMake(f.make);
                          setModel(f.model);
                        }}
                        onResult={(r) => {
                          setMake(r.make);
                          setModel(r.model);
                          if (r.year) setYear(r.year);
                          setVehicleSqFt(r.corrSqFt || r.sqFt || 0);
                        }}
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <Label htmlFor="year" className="text-xs text-muted-foreground mb-1">Year</Label>
                            <Input
                              ref={yearInputRef}
                              id="year"
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
                            <Label htmlFor="make" className="text-xs text-muted-foreground mb-1">Make</Label>
                            <Input
                              id="make"
                              type="text"
                              placeholder="Ford"
                              value={make}
                              onChange={(e) => setMake(e.target.value)}
                              className="bg-background border-2 border-border/50"
                            />
                          </div>
                          <div>
                            <Label htmlFor="model" className="text-xs text-muted-foreground mb-1">Model</Label>
                            <Input
                              id="model"
                              type="text"
                              placeholder="Mustang"
                              value={model}
                              onChange={(e) => setModel(e.target.value)}
                              className="bg-background border-2 border-border/50"
                            />
                          </div>
                        </div>
                        {/* Vehicle Autocomplete — optional helper for sq ft lookup */}
                        <div className="mt-2">
                          <VehicleAutocomplete
                            initialValue={[make, model].filter(Boolean).join(" ")}
                            onSelect={(v) => {
                              setMake(v.make);
                              setModel(v.model);
                              if (v.year) setYear(v.year);
                              setVehicleSqFt(v.corrSqFt || v.sqFt || 0);
                            }}
                          />
                          {vehicleSqFt > 0 && (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              <span className="font-semibold text-[#60A5FA]">{vehicleSqFt} sq ft</span> of printable wrap area
                            </p>
                          )}
                        </div>
                      </>
                    )}
                  </CollapsibleContent>
                </Card>
              </Collapsible>
            </MyVehicleProToggle>

            {/* Coverage Selector - above panel library so it's always visible */}
            <CoverageSelector
              coverageType={coverageType}
              onCoverageChange={setCoverageType}
            />

            {/* Finish Selector */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Lamination Finish</h3>
              <div className="grid grid-cols-3 gap-3">
                {(['Gloss', 'Satin', 'Matte'] as const).map((finish) => (
                  <button
                    key={finish}
                    onClick={() => setSelectedFinish(finish)}
                    className={cn(
                      "py-3 px-4 rounded-lg border-2 font-medium transition-all min-h-[44px]",
                      selectedFinish === finish
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border hover:border-primary/50'
                    )}
                  >
                    {finish}
                  </button>
                ))}
              </div>
            </div>

            {/* Pattern/Panel Selection */}
            <div>
              <h3 className="text-lg font-semibold mb-4">
                {mode === "panels" ? "Select Panel" : "Select Fade Color"}
              </h3>
              
              {mode === "panels" ? (
                <Tabs value={uploadMode} onValueChange={(v) => setUploadMode(v as 'curated' | 'custom')}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="curated">Curated Library</TabsTrigger>
                    <TabsTrigger value="custom">Upload Custom</TabsTrigger>
                  </TabsList>
                  <TabsContent value="curated" className="mt-4">
                    <PanelLibrary
                      panels={patterns || []}
                      selectedPanel={selectedPattern}
                      onSelectPanel={setSelectedPattern}
                      isLoading={isLoading}
                    />
                  </TabsContent>
                  <TabsContent value="custom" className="mt-4">
                    <PanelUploader onPanelUploaded={setSelectedPattern} />
                  </TabsContent>
                </Tabs>
              ) : (
                <FadeColorSelector
                  selectedColor={selectedPattern ? {
                    id: selectedPattern.id,
                    name: selectedPattern.name,
                    hex: selectedPattern.inkFusionColor?.hex || selectedPattern.hex || '#000000',
                    isInkFusion: selectedPattern.isInkFusion || false,
                    inkFusionColor: selectedPattern.inkFusionColor
                  } : null}
                  onColorSelect={(color) => setSelectedPattern({
                    id: color.id,
                    name: color.name,
                    hex: color.hex,
                    category: color.isInkFusion ? 'InkFusion' : 'Standard',
                    inkFusionColor: color.inkFusionColor,
                    isInkFusion: color.isInkFusion
                  })}
                />
              )}
            </div>

          </div>

          {/* Right Side - Preview */}
          <div className="space-y-3">
            <Button
              onClick={handleGenerate}
              disabled={
                (isGenerating || mvpIsGenerating) ||
                !selectedPattern ||
                (!year || !make || !model) ||
                (mvp.isMyVehicleMode && !mvp.hasPhotos)
              }
              className="w-full"
            >
              {(isGenerating || mvpIsGenerating)
                ? (mvpIsGenerating ? "Applying to your vehicle..." : "Generating...")
                : mvp.isMyVehicleMode
                  ? "Visualize on My Vehicle"
                  : "Generate 3D Proof"}
            </Button>

            {/* QuickQuote — always available so reps can build a price + upsell
                even before a render is generated. Opens left side panel. */}
            <Button
              onClick={() => setShowQuickQuote(true)}
              size="lg"
              className="w-full h-12 bg-gradient-to-r from-[#2563eb] to-[#a855f7] hover:from-[#1d4ed8] hover:to-[#9333ea] text-white font-bold text-sm"
            >
              <Calculator className="w-4 h-4 mr-2" />
              QuickQuote™ — Pricing & Quote
            </Button>

            {/* Inline Error Banner */}
            {lastError && (
              <div className={cn(
                "rounded-lg p-3 flex items-start gap-3 border",
                lastError.type === 'auth' && "bg-amber-500/10 border-amber-500/30 text-amber-200",
                lastError.type === 'limit' && "bg-purple-500/10 border-purple-500/30 text-purple-200",
                lastError.type === 'general' && "bg-destructive/10 border-destructive/30 text-destructive"
              )}>
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="flex-1 space-y-2">
                  <p className="text-sm font-medium">{lastError.message}</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Button 
                      size="sm" 
                      variant="outline" 
                      onClick={() => {
                        setLastError(null);
                        handleGenerate();
                      }}
                      className="h-7 text-xs"
                    >
                      <RefreshCw className="w-3 h-3 mr-1" />
                      Retry
                    </Button>
                    {lastError.type === 'auth' && (
                      <Button 
                        size="sm" 
                        variant="outline" 
                        asChild
                        className="h-7 text-xs"
                      >
                        <Link to="/login">
                          <LogIn className="w-3 h-3 mr-1" />
                          Log In
                        </Link>
                      </Button>
                    )}
                    {lastError.type === 'limit' && (
                      <Button 
                        size="sm" 
                        variant="default" 
                        asChild
                        className="h-7 text-xs"
                      >
                        <Link to="/pricing">
                          Upgrade Plan
                        </Link>
                      </Button>
                    )}
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => setLastError(null)}
                      className="h-7 text-xs ml-auto"
                    >
                      Dismiss
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {/* Studio render hero image — primary design display, shown
                first so the customer sees the wrap they created at full size.
                MyVehiclePro transfer (if any) renders below as a follow-up. */}
            {generatedImageUrl && (
              <div id="preview-section" className="relative w-full bg-secondary/20 rounded-lg overflow-hidden border border-border flex items-center justify-center group max-h-[600px] lg:max-h-[720px]">
                <img
                  src={generatedImageUrl}
                  alt="Generated render"
                  className={cn("w-full max-w-full object-contain cursor-pointer transition-transform max-h-[600px] lg:max-h-[720px]", flippedViews["hero"] && "scale-x-[-1]")}
                  onClick={() => setExpandedImage({ url: generatedImageUrl, title: "Hero View" })}
                />
                <div
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-30"
                  onClick={(e) => { e.stopPropagation(); setFlippedViews(prev => ({ ...prev, hero: !prev.hero })); }}
                >
                  <div className="bg-background/90 backdrop-blur-sm rounded-full p-2 hover:bg-background cursor-pointer">
                    <FlipHorizontal2 className="h-4 w-4 text-foreground" />
                  </div>
                </div>
                <DesignIDBadge
                  toolName={mode === "panels" ? "DesignProAI™" : "FadeWraps™"}
                  designName={hookDesignName || selectedPattern?.name}
                  did={renderDid || undefined}
                  pt={renderPt || undefined}
                  showPT={true}
                />
              </div>
            )}

            {/* MyVehiclePro Result Display — progressive loading, shown
                BELOW the studio render so the design stays the focal point. */}
            {(mvpEditedImageUrl && mvpBeforeUrl) && (
              <Card className="overflow-hidden bg-secondary/30 border-blue-500/30 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm font-bold">
                  <Camera className="w-4 h-4 text-blue-400" />
                  <span className="text-foreground">MyVehicle</span>
                  <span className="text-blue-400">Pro&#8482;</span>
                  {mvpIsGenerating && mvpMultiViewResults.length > 0 && (
                    <span className="text-xs text-muted-foreground font-normal ml-2 animate-pulse">
                      {mvpMultiViewResults.length} view{mvpMultiViewResults.length !== 1 ? 's' : ''} ready — generating more...
                    </span>
                  )}
                  {!mvpIsGenerating && (
                    <span className="text-muted-foreground font-normal text-xs ml-auto">
                      {mvpMultiViewResults.length > 1 ? `${mvpMultiViewResults.length} views` : 'Your vehicle photo'}
                    </span>
                  )}
                </div>
                {mvpMultiViewResults.length > 1 ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {mvpMultiViewResults.map((result) => (
                      <div key={result.viewType} className="space-y-1">
                        <p className="text-xs text-muted-foreground capitalize">{result.viewType}</p>
                        <BeforeAfterViewer
                          beforeUrl={result.beforeUrl}
                          afterUrl={result.url}
                          beforeLabel="Original"
                          afterLabel={hookDesignName || selectedPattern?.name || "Wrapped"}
                          swatchImageUrl={generatedImageUrl || selectedPattern?.media_url}
                          swatchName={hookDesignName || selectedPattern?.name}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <BeforeAfterViewer
                    beforeUrl={mvpBeforeUrl}
                    afterUrl={mvpEditedImageUrl}
                    beforeLabel="Your Vehicle"
                    afterLabel={hookDesignName || selectedPattern?.name || "Wrapped"}
                    swatchImageUrl={generatedImageUrl || selectedPattern?.media_url}
                    swatchName={hookDesignName || selectedPattern?.name}
                  />
                )}
                <Button
                  onClick={() => { clearMyVehicleResults(); }}
                  variant="outline"
                  size="sm"
                  className="w-full"
                >
                  <RefreshCw className="w-3 h-3 mr-1.5" /> Try Another Photo
                </Button>
              </Card>
            )}

            {/* ─── Action buttons — visible after ANY render (studio OR MyVehiclePro) ─── */}
            {(generatedImageUrl || mvpEditedImageUrl) && (
              <>
                {/* Revision: on-page for hero only, RevisionStudio after all views */}
                <div id="revision-prompt-section">
                {allViews.length > 1 ? (
                  <Button
                    onClick={() => navigate(`/revision-studio?id=${visualizationId}`)}
                    variant="outline"
                    className="w-full gap-2 border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                    disabled={!visualizationId}
                  >
                    <Edit3 className="w-4 h-4" />
                    Revise in RevisionStudio
                  </Button>
                ) : (
                  <DesignRevisionPrompt
                    onRevisionSubmit={handleRevisionSubmit}
                    isGenerating={isRevising || isGenerating}
                    disabled={!generatedImageUrl || !selectedPattern || !year || !make || !model}
                  />
                )}
                </div>

                {/* MyVehiclePro inline upsell — only when in studio mode */}
                {generatedImageUrl && !mvp.isMyVehicleMode && (
                  <MyVehicleProInline
                    modeType={mode === "panels" ? "designpro" : "fadewraps"}
                    colorName={selectedPattern?.name}
                    finishType={selectedFinish}
                    vehicleYear={year}
                    vehicleMake={make}
                    vehicleModel={model}
                    panelUrl={mode === "panels" ? generatedImageUrl : null}
                    designName={hookDesignName || selectedPattern?.name || null}
                    renderUrl={generatedImageUrl}
                  />
                )}

                {/* Generate Additional Views — studio mode only */}
                {generatedImageUrl && (
                  <Button
                    onClick={handleGenerateAllViews}
                    disabled={isGeneratingAdditional}
                    variant="outline"
                    className="w-full"
                  >
                    {isGeneratingAdditional ? "Generating..." : "Generate Additional Views"}
                  </Button>
                )}

                {allViews.length > 0 && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      {allViews.map((view, idx) => (
                        <div key={view.type} className="relative aspect-video bg-secondary/20 rounded-lg overflow-hidden border border-border group">
                          <img
                            src={view.url}
                            alt={`${view.type} view`}
                            className={cn("w-full h-full object-cover cursor-pointer transition-transform", flippedViews[view.type] && "scale-x-[-1]")}
                            onClick={() => { setZoomViewIndex(idx); setExpandedImage({ url: view.url, title: `${view.type} View` }); }}
                          />
                          <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 rounded text-xs font-medium capitalize z-20">
                            {view.type.replace(/-/g, " ")}
                          </div>
                          <div
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-30"
                            onClick={(e) => { e.stopPropagation(); setFlippedViews(prev => ({ ...prev, [view.type]: !prev[view.type] })); }}
                          >
                            <div className="bg-background/90 backdrop-blur-sm rounded-full p-2 hover:bg-background cursor-pointer">
                              <FlipHorizontal2 className="h-4 w-4 text-foreground" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <Button
                      className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white h-12 text-base font-semibold"
                      onClick={() => setShowStudioGallery(true)}
                    >
                      <Maximize2 className="w-5 h-5 mr-2" />
                      Open Studio View
                    </Button>
                  </>
                )}

                <div className="flex items-center gap-3 flex-wrap">
                  {generatedImageUrl && (
                    <RenderQualityRating
                      renderId={visualizationId || ""}
                      renderType={mode === "panels" ? "designpanelpro" : "fadewraps"}
                      renderUrl={generatedImageUrl}
                    />
                  )}
                  {generatedImageUrl && (
                    <MarkAsPerfectButton
                      promptSignature={`${mode}-${selectedPattern?.name || 'custom'}-${selectedFinish}`}
                      vehicleSignature={`${year}-${make}-${model}`}
                      renderUrls={allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), { roof: generatedImageUrl })}
                      sourceVisualizationId={visualizationId || undefined}
                    />
                  )}
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => { clearLastRender(); clearMyVehicleResults(); }}
                    className="rounded-full border-fuchsia-500/50 text-fuchsia-400 hover:bg-fuchsia-500/10 hover:text-fuchsia-300"
                    title="Clear & Start New"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>

                {/* Revise Design - scroll to inline revision prompt */}
                {(visualizationId || mvpEditedImageUrl) && (
                  <Button
                    onClick={() => {
                      const el = document.getElementById('revision-prompt-section');
                      if (el) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        el.classList.add('ring-2', 'ring-purple-500', 'rounded-lg');
                        setTimeout(() => el.classList.remove('ring-2', 'ring-purple-500', 'rounded-lg'), 2000);
                      }
                    }}
                    className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    <Edit3 className="w-4 h-4" />
                    Revise This Design
                  </Button>
                )}

                {/* Generate Customer Proof Buttons */}
                <div className="flex gap-2">
                  <Button
                    onClick={() => setShow2DProofSheet(true)}
                    variant="outline"
                    className="flex-1 gap-2"
                    disabled={!year || !make || !model}
                  >
                    <ClipboardSignature className="w-4 h-4" />
                    2D Proof
                    {twoDProofGenerating && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin opacity-70" />
                    )}
                    {twoDProofUrl && !twoDProofGenerating && (
                      <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wide">Ready</span>
                    )}
                  </Button>
                  <Button
                    onClick={() => setShowProofSheet(true)}
                    variant="secondary"
                    className="flex-1 gap-2"
                    disabled={!year || !make || !model}
                  >
                    <ClipboardSignature className="w-4 h-4" />
                    3D Proof
                  </Button>
                </div>

                {/* Inline 2D-proof preview — populated by the parallel pre-render
                    so the rep sees the flat orthographic proof on the page
                    without opening the dialog. Click expands the full sheet. */}
                {(twoDProofUrl || twoDProofGenerating) && (
                  <button
                    type="button"
                    onClick={() => twoDProofUrl && setShow2DProofSheet(true)}
                    className="group relative w-full overflow-hidden rounded-lg border border-[#48484a] bg-black/60 hover:border-cyan-400 transition"
                    aria-label="Open 2D proof"
                  >
                    {twoDProofUrl ? (
                      <img
                        src={twoDProofUrl}
                        alt="2D Proof preview"
                        className="w-full max-h-72 object-contain bg-white"
                      />
                    ) : (
                      <div className="flex items-center justify-center gap-2 py-10 text-xs text-white/70">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Pre-rendering 2D proof in parallel…
                      </div>
                    )}
                    <span className="absolute top-2 left-2 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-cyan-500/90 text-black">
                      2D Proof
                    </span>
                  </button>
                )}

                {/* Want to Purchase? CTA */}
                <Card className="p-4 bg-gradient-to-r from-primary/10 via-primary/5 to-background border-primary/20">
                  <h3 className="text-lg font-semibold mb-3">Want to Purchase?</h3>
                  <div className="space-y-3">
                    <Button
                      variant="outline"
                      className="w-full justify-between h-auto py-3"
                      onClick={() => window.location.href = mode === "panels"
                        ? "/printpro/designpanelpro"
                        : "/printpro/fadewrap"}
                    >
                      <div className="flex items-center gap-2">
                        <ShoppingBag className="w-4 h-4" />
                        <span>Vinyl Wrap Panels</span>
                      </div>
                      <span className="text-primary font-semibold">Starting at $600</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="w-full justify-between h-auto py-3"
                      onClick={() => setShowProductionDialog(true)}
                      disabled={!visualizationId}
                    >
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        <span>Print Production Files</span>
                      </div>
                      <span className="text-primary font-semibold">Generate</span>
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3 text-center">
                    Pricing & ordering handled in PrintPro™ Suite
                  </p>
                </Card>

                {/* Cut Contour Logo Pack */}
                {generatedImageUrl && (
                  <Button
                    className="w-full bg-purple-600 hover:bg-purple-700 text-white h-11"
                    onClick={() => handleGenerateCutFiles({
                      id: visualizationId || "",
                      mode_type: "designpro",
                      render_urls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
                      vehicle_year: year,
                      vehicle_make: make,
                      vehicle_model: model,
                      design_file_name: selectedPattern?.name,
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

                {/* ApprovePro — Send for Client Approval (Phase 8A) */}
                {generatedImageUrl && (
                  <Button
                    onClick={() => setShowSendForApproval(true)}
                    variant="outline"
                    className="w-full h-11 gap-2 border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/5"
                  >
                    <ClipboardSignature className="w-4 h-4" />
                    Send for Client Approval
                  </Button>
                )}

                {/* PrintPro — WPW-priced quote + order */}
                {generatedImageUrl && (
                  <PrintProCTAButton
                    width="full"
                    className="h-11"
                    context={{
                      toolSource: "restylelibrary",
                      renderUrl: generatedImageUrl,
                      renderUrls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
                      vehicleYear: year,
                      vehicleMake: make,
                      vehicleModel: model,
                      designName: hookDesignName || selectedPattern?.name,
                      finish: selectedFinish,
                      designId: visualizationId || null,
                    }}
                  />
                )}

                {/* WPW vs RP design pricing comparison — gated to WPW tenants */}
                <DesignProductsCompareCard className="my-2" />

                {/* QuickQuote handoff — printed-wrap pricing.
                    Opens the same QuickQuoteCard the dashboard / /quick-quote
                    use, prefilled with the design's vehicle + render, in a
                    left-side sheet so the design stays visible. */}
                <Button
                  className="w-full h-11 text-white font-bold shadow-[0_0_14px_rgba(168,85,247,0.3)] hover:opacity-90"
                  style={{ background: "linear-gradient(135deg, #2563eb, #a855f7)" }}
                  onClick={() => setShowQuickQuote(true)}
                >
                  <Calculator className="w-4 h-4 mr-2" />
                  Open QuickQuote — Printed Wrap Pricing
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Persistent floating QuickQuote button — always reachable
          regardless of scroll position so the rep can open quote
          pricing at any point in the design flow. */}
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

      {/* QuickQuote — same card the dashboard uses, mounted in a
          left side panel so the render stays visible and interactive
          on the right while the user builds the quote. */}
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
            finish: "Gloss",
            designName: hookDesignName || selectedPattern?.name || undefined,
            renderUrl: generatedImageUrl || mvpEditedImageUrl || undefined,
          }}
        />
      </QuickQuoteSidePanel>

      {/* Expanded Image with Zoom */}
      <MobileZoomImageModal
        imageUrl={expandedImage?.url || ''}
        title={expandedImage?.title}
        isOpen={!!expandedImage}
        onClose={() => setExpandedImage(null)}
        showNavigation={allViews.length > 1}
        currentIndex={zoomViewIndex}
        totalCount={allViews.length}
        onPrev={() => {
          const prevIdx = zoomViewIndex === 0 ? allViews.length - 1 : zoomViewIndex - 1;
          setZoomViewIndex(prevIdx);
          setExpandedImage({ url: allViews[prevIdx].url, title: `${allViews[prevIdx].type} View` });
        }}
        onNext={() => {
          const nextIdx = zoomViewIndex === allViews.length - 1 ? 0 : zoomViewIndex + 1;
          setZoomViewIndex(nextIdx);
          setExpandedImage({ url: allViews[nextIdx].url, title: `${allViews[nextIdx].type} View` });
        }}
      />

      <UpgradeRequired
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        requiredTier="advanced"
      />

      {/* Professional Proof Sheet Dialog */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className={isMobile ? "max-w-[95vw] max-h-[95vh] overflow-y-auto p-0" : "max-w-[95vw] max-h-[95vh] overflow-auto p-0"}>
          {isMobile ? (
            <MobileProofSheet
              views={[
                ...(allViews?.find(v => v.type === 'side') ? [{ type: 'side', url: allViews.find(v => v.type === 'side')!.url, label: 'Driver Side' }] : []),
                ...(allViews?.find(v => v.type === 'passenger-side' || v.type === 'passenger') ? [{ type: 'passenger-side', url: (allViews.find(v => v.type === 'passenger-side' || v.type === 'passenger'))!.url, label: 'Passenger Side' }] : []),
                ...(allViews?.find(v => v.type === 'hood_detail') ? [{ type: 'hood_detail', url: allViews.find(v => v.type === 'hood_detail')!.url, label: 'Hood' }] : []),
                ...(allViews?.find(v => v.type === 'front') ? [{ type: 'front', url: allViews.find(v => v.type === 'front')!.url, label: 'Front' }] : []),
                ...(allViews?.find(v => v.type === 'rear') ? [{ type: 'rear', url: allViews.find(v => v.type === 'rear')!.url, label: 'Rear' }] : []),
                ...(allViews?.find(v => v.type === 'close-up') ? [{ type: 'close-up', url: allViews.find(v => v.type === 'close-up')!.url, label: 'Close-Up' }] : []),
                ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
              ]}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolKey="designpanelpro"
              designName={hookDesignName || selectedPattern?.name || 'Custom Design'}
              finish={selectedFinish}
            />
          ) : (
            <ProfessionalProofSheet
              views={[
                ...(allViews?.find(v => v.type === 'side') ? [{ type: 'side', url: allViews.find(v => v.type === 'side')!.url, label: 'Driver Side' }] : []),
                ...(allViews?.find(v => v.type === 'passenger-side' || v.type === 'passenger') ? [{ type: 'passenger-side', url: (allViews.find(v => v.type === 'passenger-side' || v.type === 'passenger'))!.url, label: 'Passenger Side' }] : []),
                ...(allViews?.find(v => v.type === 'hood_detail') ? [{ type: 'hood_detail', url: allViews.find(v => v.type === 'hood_detail')!.url, label: 'Hood' }] : []),
                ...(allViews?.find(v => v.type === 'front') ? [{ type: 'front', url: allViews.find(v => v.type === 'front')!.url, label: 'Front' }] : []),
                ...(allViews?.find(v => v.type === 'rear') ? [{ type: 'rear', url: allViews.find(v => v.type === 'rear')!.url, label: 'Rear' }] : []),
                ...(allViews?.find(v => v.type === 'close-up') ? [{ type: 'close-up', url: allViews.find(v => v.type === 'close-up')!.url, label: 'Close-Up' }] : []),
                ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
              ]}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolName={mode === "panels" ? "RestyleLibrary™" : "FadeWraps™"}
              designName={hookDesignName || selectedPattern?.name || 'Custom Design'}
              finish={selectedFinish}
              initialProofUrl={twoDProofUrl}
            />
          )}
        </DialogContent>
      </Dialog>
      {/* 2D Proof Sheet Dialog */}
      <Dialog open={show2DProofSheet} onOpenChange={setShow2DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          <TwoDProofSheet
            views={[
              ...(allViews?.find(v => v.type === 'side') ? [{ type: 'side', url: allViews.find(v => v.type === 'side')!.url, label: 'Driver Side' }] : []),
              ...(allViews?.find(v => v.type === 'passenger-side' || v.type === 'passenger') ? [{ type: 'passenger-side', url: (allViews.find(v => v.type === 'passenger-side' || v.type === 'passenger'))!.url, label: 'Passenger Side' }] : []),
              ...(allViews?.find(v => v.type === 'front') ? [{ type: 'front', url: allViews.find(v => v.type === 'front')!.url, label: 'Front' }] : []),
              ...(allViews?.find(v => v.type === 'rear') ? [{ type: 'rear', url: allViews.find(v => v.type === 'rear')!.url, label: 'Rear' }] : []),
              ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
            ]}
            vehicleYear={year}
            vehicleMake={make}
            vehicleModel={model}
            toolKey="designpanelpro"
            designName={hookDesignName || selectedPattern?.name || 'Custom Design'}
            finish={selectedFinish}
            initialProofUrl={twoDProofUrl}
            onProofGenerated={(url) => setTwoDProofUrl(url)}
          />
        </DialogContent>
      </Dialog>
      {/* Production Pack Dialog */}
      <ProductionPackDialog
        open={showProductionDialog}
        onOpenChange={setShowProductionDialog}
        render={visualizationId ? {
          id: visualizationId,
          render_urls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          design_file_name: selectedPattern?.name,
          finish_type: selectedFinish,
        } : null}
      />

      {/* Studio Proof Viewer - shows uploaded design proof → 3D render transformation */}
      <StudioProofLayout
        toolName={mode === "panels" ? "DesignProAI™" : "FadeWraps™"}
        proofSectionLabel="Original Design Proof"
        designProofUrl={mode === "panels" && selectedPattern?.media_url ? selectedPattern.media_url : undefined}
        designName={hookDesignName || selectedPattern?.name || "Custom Design"}
        vehicleInfo={{ year, make, model }}
        views={allViews.map(v => ({
          type: v.type,
          url: v.url,
          label: ({
            side: "Driver Side", "driver-side": "Driver Side", "passenger-side": "Passenger Side",
            hood_detail: "Hood", front: "Front", rear: "Rear", "close-up": "Close-Up", roof: "Roof",
          } as Record<string, string>)[v.type] || v.type,
        }))}
        isOpen={showStudioGallery}
        onClose={() => setShowStudioGallery(false)}
        finish={selectedFinish}
      />

      {/* ApprovePro — Phase 8A */}
      <SendForApprovalDialog
        open={showSendForApproval}
        onOpenChange={setShowSendForApproval}
        context={{
          visualizationId: visualizationId || undefined,
          renderUrls: allViews.reduce(
            (acc, v) => ({ ...acc, [v.type]: v.url }),
            generatedImageUrl ? { hero: generatedImageUrl } : {},
          ),
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          designName: hookDesignName || selectedPattern?.name || "RestyleLibrary Design",
          finishType: selectedFinish,
          defaultMode: "revision_loop",
        }}
      />
    </div>
  );
};
