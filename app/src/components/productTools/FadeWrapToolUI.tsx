import { useToast } from "@/hooks/use-toast";
import { usePreloadRender } from "@/hooks/usePreloadRender";
import { VehicleAutocomplete } from "@/components/tools/VehicleAutocomplete";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { VehicleTypeSelector, isNonStandardVehicle } from "@/components/tools/VehicleTypeSelector";
import { NonStandardVehicleLookup } from "@/components/tools/NonStandardVehicleLookup";
import { sqFtToYards } from "@/lib/quick-quote";
import { useFadeWrapLogic } from "@/hooks/useFadeWrapLogic";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useRevisionHistory } from "@/hooks/useRevisionHistory";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FadeColorSelector, FadeColor } from "@/components/fadewraps/FadeColorSelector";
import { FinishSelector } from "@/components/fadewraps/FinishSelector";
import { KitConfigSelector } from "@/components/fadewraps/KitConfigSelector";
import { Dialog, DialogContent } from "@/components/ui/dialog";

import { PaywallModal } from "@/components/PaywallModal";
import { LoginRequiredModal } from "@/components/LoginRequiredModal";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { RenderQualityRating } from "@/components/RenderQualityRating";
import { MarkAsPerfectButton } from "@/components/MarkAsPerfectButton";
import { DesignRevisionPrompt } from "@/components/tools/DesignRevisionPrompt";
import { RevisionHistoryTimeline } from "@/components/tools/RevisionHistoryTimeline";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { MobileProofSheet } from "@/components/tools/MobileProofSheet";
import { TwoDProofSheet } from "@/components/tools/TwoDProofSheet";
import { StudioProofLayout } from "@/components/tools/StudioProofLayout";
import { useState, useRef, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Package, Download, ChevronDown, X, Car, RefreshCw, Lightbulb, Check, FileDown, ClipboardSignature, Scissors, Loader2, Edit3, Calculator } from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import { GenerationWizard, FADEWRAPS_TIPS } from "@/components/tools/GenerationWizard";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigate } from "react-router-dom";
import { RenderOverlay } from "@/components/tools/RenderOverlay";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { MyVehicleProToggle } from "@/components/tools/MyVehicleProToggle";
import { useMyVehicleMode } from "@/hooks/useMyVehicleMode";
import { useMyVehicleGenerate } from "@/hooks/useMyVehicleGenerate";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import { Camera } from "lucide-react";
import { downloadWithOverlay, downloadAllWithOverlay, OverlaySpec } from "@/lib/download-with-overlay";
import { supabase } from "@/integrations/supabase/client";
import { DesignProductsCompareCard } from "@/components/quote/DesignProductsCompareCard";

export const FadeWrapToolUI = ({ preloadRenderId }: { preloadRenderId?: string | null }) => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { subscription, checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const { revisionHistory, saveRevision } = useRevisionHistory('fadewraps');
  const {
    selectedPattern, setSelectedPattern, selectedFinish, setSelectedFinish,
    fadeStyle,
    kitSize, setKitSize, addHood, setAddHood, addFrontBumper, setAddFrontBumper,
    addRearBumper, setAddRearBumper, roofSize, setRoofSize,
    totalPrice, productId,
    generateRender, isGenerating, generatedImageUrl, visualizationId, additionalViews,
    generateAdditionalViews, isGeneratingAdditional,
    showUpgradeModal, setShowUpgradeModal,
    showLoginModal, setShowLoginModal,
    clearLastRender,
    vehicleType, setVehicleType,
  } = useFadeWrapLogic();

  // MyVehiclePro state
  const mvp = useMyVehicleMode();
  const { mvpIsGenerating, mvpEditedImageUrl, mvpBeforeUrl, mvpMultiViewResults, mvpError, generateOnMyVehicle, clearMyVehicleResults } = useMyVehicleGenerate();

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [vehicleSqFt, setVehicleSqFt] = useState(0);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [yearError, setYearError] = useState(false);
  const [showAdditionalViews, setShowAdditionalViews] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(true);
  const [expandedImage, setExpandedImage] = useState<{ url: string; title: string } | null>(null);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const [vehicleInputOpen, setVehicleInputOpen] = useState(true);
  const [pullToRefreshActive, setPullToRefreshActive] = useState(false);
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();
  const [isRevising, setIsRevising] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const touchStartY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [showSendForApproval, setShowSendForApproval] = useState(false);
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  const [showStudioProof, setShowStudioProof] = useState(false);

  // Preload render from "See in Studio" link
  const { data: preloadRender } = usePreloadRender(preloadRenderId ?? null);
  useEffect(() => {
    if (!preloadRender) return;
    if (preloadRender.vehicle_year) setYear(preloadRender.vehicle_year);
    if (preloadRender.vehicle_make) setMake(preloadRender.vehicle_make);
    if (preloadRender.vehicle_model) setModel(preloadRender.vehicle_model);
    if (preloadRender.finish_type) {
      const f = preloadRender.finish_type.charAt(0).toUpperCase() + preloadRender.finish_type.slice(1).toLowerCase();
      if (f === "Gloss" || f === "Satin" || f === "Matte") setSelectedFinish(f);
    }
    toast({ title: "Vehicle loaded", description: "Preloaded from render history — select a fade style and generate" });
  }, [preloadRender]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch a recent completed FadeWrap render as showcase image
  const { data: showcaseImage } = useQuery({
    queryKey: ["fadewraps-showcase"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("id, color_name, color_hex, vehicle_year, vehicle_make, vehicle_model, render_urls")
        .eq("generation_status", "completed")
        .eq("mode_type", "fadewraps")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (error || !data || data.length === 0) return null;
      const row = data[0];
      const urls = row.render_urls as Record<string, string> | null;
      if (!urls) return null;
      const imageUrl = urls.hero || urls.side || urls.front || Object.values(urls)[0];
      if (!imageUrl) return null;
      return {
        imageUrl,
        colorName: row.color_name,
        vehicleName: `${row.vehicle_year} ${row.vehicle_make} ${row.vehicle_model}`,
      };
    },
    staleTime: 10 * 60 * 1000,
  });

  // Timer during generation + tip rotation
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isGenerating || isRevising) {
      setElapsedSeconds(0);
      setCurrentTipIndex(0);
      interval = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => { if (interval) clearInterval(interval); };
  }, [isGenerating, isRevising]);

  // Rotate tips every 5 seconds
  useEffect(() => {
    if (isGenerating || isRevising) {
      const tipInterval = setInterval(() => {
        setCurrentTipIndex(prev => (prev + 1) % FADEWRAPS_TIPS.length);
      }, 5000);
      return () => clearInterval(tipInterval);
    }
  }, [isGenerating, isRevising]);

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
    if (generatedImageUrl && additionalViews.length === 0 && !isGeneratingAdditional && !autoFireRef.current) {
      autoFireRef.current = true;
      generateAdditionalViews(year, make, model);
    }
    if (!generatedImageUrl) {
      autoFireRef.current = false;
    }
  }, [generatedImageUrl, additionalViews.length, isGeneratingAdditional]);

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
      toast({ title: "No pattern selected", description: "Please select a FadeWraps pattern first", variant: "destructive" });
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

      const colorData: Record<string, any> = {
        colorName: selectedPattern?.name || "Custom Fade",
        hex: selectedPattern?.hex || selectedPattern?.inkFusionColor?.hex || "#808080",
        finish: (selectedFinish || "Gloss").toLowerCase(),
        toolSource: "FadeWraps",
        fadeStyle: fadeStyle,
      };

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
        toast({ title: "Applied to your vehicle!", description: "Fade wrap visualized on your photo.", duration: 4000 });
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
    await incrementRenderCount();
  };

  const handleRevisionSubmit = async (prompt: string) => {
    if (!selectedPattern || !year || !make || !model) return;
    const originalUrl = generatedImageUrl;
    setIsRevising(true);
    try {
      await generateRender(year, make, model, prompt);
      // Save revision to history after successful generation
      if (generatedImageUrl) {
        await saveRevision({
          viewType: 'side',
          originalUrl,
          revisedUrl: generatedImageUrl,
          revisionPrompt: prompt
        });
      }
      toast({ title: "Revision applied", description: "New render generated with your changes" });
    } finally {
      setIsRevising(false);
    }
  };

  const handleGenerateAdditionalViews = async () => {
    if (!generatedImageUrl) {
      toast({ title: "No render available", description: "Generate a 3D proof first", variant: "destructive" });
      return;
    }
    
    if (!year || !make || !model) {
      toast({ title: "Vehicle required", description: "Please enter year, make, and model", variant: "destructive" });
      return;
    }
    
    await generateAdditionalViews(year, make, model);
    setShowAdditionalViews(true);
  };

  // Build overlay spec for FadeWraps downloads
  const getFadeWrapsOverlay = (): OverlaySpec => ({
    toolName: 'FadeWraps',
    manufacturer: selectedPattern?.inkFusionColor?.manufacturer || undefined,
    colorOrDesignName: selectedPattern?.name || undefined,
  });

  const handleDownload = async (imageUrl: string, filename: string) => {
    try {
      const overlay = getFadeWrapsOverlay();
      // Remove .png extension from filename if present (downloadWithOverlay adds it)
      const cleanFilename = filename.replace(/\.png$/i, '');
      await downloadWithOverlay(imageUrl, cleanFilename, overlay);
      toast({ title: "Download started", description: `Downloading ${cleanFilename}.png` });
    } catch (error) {
      toast({ title: "Download failed", description: "Please try again", variant: "destructive" });
    }
  };

  const [downloadingAll, setDownloadingAll] = useState(false);

  const handleDownloadAllViews = async () => {
    const designName = selectedPattern?.name || "fadewrap";
    const baseName = `fadewraps-${designName}`.replace(/\s+/g, "-");
    const images: Array<{ url: string; filename: string }> = [];
    if (generatedImageUrl) {
      images.push({ url: generatedImageUrl, filename: `${baseName}-hero` });
    }
    for (const view of additionalViews) {
      if (view?.url) images.push({ url: view.url, filename: `${baseName}-${view.type}` });
    }
    if (images.length === 0) {
      toast({ title: "No views available", description: "Generate views first", variant: "destructive" });
      return;
    }
    setDownloadingAll(true);
    toast({ title: "Preparing downloads", description: `Downloading ${images.length} views...` });
    try {
      await downloadAllWithOverlay(images, getFadeWrapsOverlay());
      toast({ title: "Download complete", description: `${images.length} views downloaded` });
    } catch (error) {
      toast({ title: "Download all failed", description: "Please try again", variant: "destructive" });
    } finally {
      setDownloadingAll(false);
    }
  };

  const { saveDesignJob } = useFadeWrapLogic();

  const handleSaveAndContinue = async () => {
    if (!generatedImageUrl || !selectedPattern) {
      toast({ title: "No render available", description: "Generate a 3D proof first", variant: "destructive" });
      return;
    }
    
    const savedJob = await saveDesignJob(year, make, model);
    if (savedJob) {
      toast({ title: "Design saved", description: "Redirecting to PrintPro..." });
      window.location.href = `/printpro?designId=${savedJob.id}&type=fadewrap`;
    } else {
      toast({ title: "Save failed", description: "Please try again", variant: "destructive" });
    }
  };

  const handleAddToCart = () => {
    if (!selectedPattern) {
      toast({ title: "No pattern selected", description: "Please select a pattern first", variant: "destructive" });
      return;
    }
    
    // Save design context for purchase flow
    const fadeContext = {
      patternId: selectedPattern.id,
      fadeName: selectedPattern.name,
      patternUrl: selectedPattern.media_url,
      category: selectedPattern.category,
      vehicleYear: year,
      vehicleMake: make,
      vehicleModel: model,
      finish: selectedFinish,
      fadeStyle,
      kitSize,
      renderUrl: generatedImageUrl,
      additionalViews: additionalViews
    };
    localStorage.setItem('fadewrap-purchase-context', JSON.stringify(fadeContext));
    
    window.open(`https://weprintwraps.com/cart/?add-to-cart=${productId}`, '_blank');
    toast({ title: "Added to Cart", description: `${selectedPattern.name} FadeWraps kit added to cart` });
  };

  return (
    <div ref={containerRef} className="w-full max-w-[1400px] mx-auto px-3 sm:px-4 py-2 pb-24 overflow-x-hidden relative">
      {/* Pull-to-refresh indicator */}
      {pullToRefreshActive && isMobile && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-primary/90 text-primary-foreground py-3 flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">Release to refresh...</span>
        </div>
      )}

      {/* MyVehiclePro Toggle + Vehicle Input */}
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
          <Card className="p-3 mb-3">
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
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <Label htmlFor="year" className="text-xs">Year *</Label>
                      <Input
                        ref={yearInputRef}
                        id="year"
                        type="text"
                        placeholder="2024"
                        value={year}
                        onChange={(e) => setYear(e.target.value)}
                        className={cn("mt-1", yearError && "border-destructive animate-pulse")}
                      />
                    </div>
                    <div>
                      <Label htmlFor="make" className="text-xs">Make *</Label>
                      <Input
                        id="make"
                        type="text"
                        placeholder="Corvette"
                        value={make}
                        onChange={(e) => setMake(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                    <div>
                      <Label htmlFor="model" className="text-xs">Model *</Label>
                      <Input
                        id="model"
                        type="text"
                        placeholder="C8"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="mt-1"
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
                        <span className="font-semibold text-[#60A5FA]">{vehicleSqFt} sq ft</span>
                        {" · "}
                        <span className="font-semibold">{sqFtToYards(vehicleSqFt)} yards</span> of film needed
                      </p>
                    )}
                  </div>
                </>
              )}
            </CollapsibleContent>
          </Card>
        </Collapsible>
      </MyVehicleProToggle>

      {/* Main 2-Column Layout */}
      <Card className="bg-secondary border-border/30 rounded-xl overflow-hidden">
        <div className="flex flex-col lg:grid lg:grid-cols-[350px_1fr] gap-0">
          {/* LEFT SIDEBAR - Configuration & Pricing */}
          <div className="bg-card lg:border-r border-border p-3 sm:p-4 space-y-4 lg:max-h-[800px] lg:overflow-y-auto">
            {/* Fade Color Selector - replaces old tabs */}
            <Card className="p-4 bg-secondary/20 border-border">
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
            </Card>

            {/* Finish Selector */}
            <Card className="p-4 bg-secondary/20 border-border">
              <FinishSelector
                selectedFinish={selectedFinish}
                onFinishChange={setSelectedFinish}
              />
            </Card>

            {/* Kit Configuration */}
            <Card className="p-4 bg-secondary/20 border-border">
              <KitConfigSelector
                kitSize={kitSize}
                onKitSizeChange={setKitSize}
                addHood={addHood}
                onAddHoodChange={setAddHood}
                addFrontBumper={addFrontBumper}
                onAddFrontBumperChange={setAddFrontBumper}
                addRearBumper={addRearBumper}
                onAddRearBumperChange={setAddRearBumper}
                roofSize={roofSize}
                onRoofSizeChange={setRoofSize}
              />
            </Card>


            {/* Pricing Summary */}
            <Collapsible open={pricingOpen} onOpenChange={setPricingOpen}>
              <Card className="p-4 bg-secondary/20 border-border">
                <CollapsibleTrigger className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2">
                    <Package className="w-5 h-5" />
                    <h3 className="text-sm font-semibold">Pricing Summary</h3>
                  </div>
                  <ChevronDown className={cn("w-5 h-5 transition-transform", pricingOpen && "rotate-180")} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-4">
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between py-2 border-b border-border">
                      <span className="font-semibold">Total Price:</span>
                      <span className="text-xl font-bold text-primary">${totalPrice.toFixed(2)}</span>
                    </div>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Save & Continue to PrintPro */}
            {generatedImageUrl && (
              <Button
                onClick={handleSaveAndContinue}
                className="w-full bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700"
                size="lg"
              >
                Save & Continue to PrintPro
              </Button>
            )}

            {/* Add to Cart */}
            <Button
              onClick={handleAddToCart}
              disabled={!selectedPattern}
              className="w-full"
              size="lg"
              variant="outline"
            >
              Add to Cart - ${totalPrice.toFixed(2)}
            </Button>
          </div>

          {/* RIGHT SIDE - Large Preview */}
          <div id="preview-section" className="p-6 bg-background min-h-[300px] space-y-4 relative">
            {/* Generate Button - always at top */}
            <Button
              onClick={handleGenerate}
              disabled={
                (isGenerating || mvpIsGenerating) ||
                !selectedPattern ||
                (!year || !make || !model)
              }
              className="w-full bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600"
              size="lg"
            >
              {(isGenerating || mvpIsGenerating) ? (
                <div className="flex items-center gap-2">
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Generating... {elapsedSeconds}s</span>
                </div>
              ) : mvp.isMyVehicleMode
                ? "Visualize on My Vehicle"
                : "Generate 3D Proof"}
            </Button>

            {/* Generation Wizard with Sproket showcase */}
            {isGenerating && (
              <GenerationWizard
                isGenerating={isGenerating}
                elapsedSeconds={elapsedSeconds}
                tips={FADEWRAPS_TIPS}
                currentTipIndex={currentTipIndex}
                toolName="FadeWrap"
                gradientFrom="from-pink-500"
                gradientTo="to-purple-500"
                colorProShowcase
              />
            )}

            {/* MyVehiclePro Result Display — progressive loading */}
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
                          afterLabel="Wrapped"
                          swatchImageUrl={selectedPattern?.media_url}
                          swatchName={selectedPattern?.name}
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <BeforeAfterViewer
                    beforeUrl={mvpBeforeUrl}
                    afterUrl={mvpEditedImageUrl}
                    beforeLabel="Your Vehicle"
                    afterLabel={selectedPattern?.name || "Fade Wrap"}
                    swatchImageUrl={selectedPattern?.media_url}
                    swatchName={selectedPattern?.name}
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

            {/* Hero Preview - only shown when a render exists */}
            {!isGenerating && generatedImageUrl && (
              <div className="aspect-video bg-secondary/20 rounded-lg flex items-center justify-center border border-border overflow-hidden">
                <div
                  className="relative w-full h-full group cursor-pointer"
                  onClick={() =>
                    setExpandedImage({
                      url: generatedImageUrl,
                      title: `${year} ${make} ${model} - ${selectedPattern?.name} - Hero View`,
                    })
                  }
                >
                  <img
                    src={generatedImageUrl}
                    alt="Generated render"
                    className="w-full h-full object-cover"
                  />
                  <RenderOverlay
                    toolName="FadeWraps"
                    manufacturer={selectedPattern?.isInkFusion ? "InkFusion" : undefined}
                    colorOrDesignName={selectedPattern?.name}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() =>
                      handleDownload(
                        generatedImageUrl,
                        `fadewraps-${selectedPattern?.name}-hero.png`,
                      )
                    }
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                </div>
              </div>
            )}

            {/* Feedback Rating & Mark as Perfect - Bottom Right */}
            {generatedImageUrl && selectedPattern && visualizationId && (
              <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
                <MarkAsPerfectButton
                  promptSignature={`fadewraps-${selectedPattern.name}-${fadeStyle}-${selectedFinish}`}
                  vehicleSignature={`${year}-${make}-${model}`}
                  renderUrls={additionalViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), { roof: generatedImageUrl })}
                  sourceVisualizationId={visualizationId}
                />
                <RenderQualityRating 
                  renderId={visualizationId}
                  renderType="fadewraps"
                  renderUrl={generatedImageUrl}
                />
              </div>
            )}

            {/* Design Revision Prompt - Always visible as selling point */}
            <DesignRevisionPrompt
              onRevisionSubmit={handleRevisionSubmit}
              isGenerating={isRevising || isGenerating}
              disabled={!generatedImageUrl || !selectedPattern || !year || !make || !model}
            />

            {/* MyVehiclePro — brand differentiator: apply this fade wrap to a customer's actual vehicle photo */}
            {generatedImageUrl && selectedPattern && (
              <MyVehicleProInline
                colorName={selectedPattern.name}
                finishType={selectedFinish}
                manufacturer={selectedPattern.isInkFusion ? "InkFusion" : undefined}
                modeType="fadewraps"
                vehicleYear={year}
                vehicleMake={make}
                vehicleModel={model}
                renderUrl={generatedImageUrl}
              />
            )}

            {/* Revision History Timeline */}
            {generatedImageUrl && revisionHistory.length > 0 && (
              <RevisionHistoryTimeline
                history={revisionHistory}
                onSelect={(item) => {
                  // Navigate to PrintPro with revision context
                  navigate('/printpro/fadewrap', {
                    state: {
                      designUrl: item.revised_url,
                      revisionPrompt: item.revision_prompt,
                      revisionHistory,
                      sourceTool: 'fadewraps',
                      designName: selectedPattern?.name || 'FadeWrap Design'
                    }
                  });
                }}
              />
            )}

            {/* Generate Additional Views Button */}
            {generatedImageUrl && (
              <div className="flex flex-col gap-2">
                <Button
                  onClick={handleGenerateAdditionalViews}
                  disabled={isGeneratingAdditional}
                  className="w-full"
                  variant="outline"
                >
                  {isGeneratingAdditional ? "Generating Views..." : "Generate All 7 Views"}
                </Button>
                
                {/* Revise in RevisionStudioIQ - appears after first render */}
                {visualizationId && (
                  <Button
                    onClick={() => navigate(`/revision-studio?id=${visualizationId}`)}
                    className="w-full gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    <Edit3 className="w-4 h-4" />
                    Revise in RevisionStudio IQ™
                  </Button>
                )}

                {/* Proof Sheet Buttons - appear after views are generated */}
                {additionalViews.length > 0 && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setShow2DProofSheet(true)}
                      className="flex-1 gap-2"
                    >
                      <ClipboardSignature className="w-4 h-4" />
                      2D Proof
                    </Button>
                    <Button
                      variant="default"
                      onClick={() => setShowProofSheet(true)}
                      className="flex-1 gap-2"
                    >
                      <ClipboardSignature className="w-4 h-4" />
                      3D Proof
                    </Button>
                  </div>
                )}

                {/* ApprovePro — Send for Client Approval */}
                {generatedImageUrl && (
                  <Button
                    variant="outline"
                    onClick={() => setShowSendForApproval(true)}
                    className="w-full gap-2 border-blue-500/40 hover:border-blue-500 hover:bg-blue-500/5"
                    disabled={!year || !make || !model}
                  >
                    <ClipboardSignature className="w-4 h-4" />
                    Send for Client Approval
                  </Button>
                )}

                {/* QuickQuote — pricing by sq ft */}
                {year && make && model && (
                  <>
                    <DesignProductsCompareCard className="my-2" />
                    <Button
                    onClick={() => {
                      // Mirror the price tables in useFadeWrapLogic so each
                      // selected option becomes its own quote line. Per
                      // request: NO render attached and NO designName seed
                      // (which would auto-add a Print Wrap line) — every
                      // priced item lands as an explicit custom line.
                      const KIT_PRICES = { small: 600, medium: 710, large: 825, xl: 990 } as const;
                      const KIT_LABEL = { small: "Small", medium: "Medium", large: "Large", xl: "XL" } as const;
                      const ROOF_PRICES = { none: 0, small: 160, medium: 225, large: 330 } as const;
                      const ROOF_LABEL = { none: "", small: "Small", medium: "Medium", large: "Large" } as const;

                      const patternName = selectedPattern?.name || "FadeWrap";
                      const finishLabel = selectedFinish;
                      // Each FadeWrap option is selected as a single unit, so
                      // qty is implicitly 1 — embed "1×" in the label so qty
                      // shows up alongside the price on the saved quote.
                      const extraCustomLines: Array<{ label: string; price: number }> = [
                        {
                          label: `1× FadeWrap Kit (${KIT_LABEL[kitSize]}) — ${patternName}, ${finishLabel}`,
                          price: KIT_PRICES[kitSize],
                        },
                      ];
                      if (addHood) extraCustomLines.push({ label: "1× Hood Add-on", price: 160 });
                      if (addFrontBumper) extraCustomLines.push({ label: "1× Front Bumper Add-on", price: 200 });
                      if (addRearBumper) extraCustomLines.push({ label: "1× Rear Bumper Add-on", price: 395 });
                      if (roofSize !== "none") {
                        extraCustomLines.push({
                          label: `1× Roof (${ROOF_LABEL[roofSize]})`,
                          price: ROOF_PRICES[roofSize],
                        });
                      }

                      const noteLines = [
                        `Color: ${patternName}`,
                        `Finish: ${finishLabel}`,
                        `Kit size: ${KIT_LABEL[kitSize]}`,
                      ];
                      if (addHood) noteLines.push("Add-on: Hood");
                      if (addFrontBumper) noteLines.push("Add-on: Front Bumper");
                      if (addRearBumper) noteLines.push("Add-on: Rear Bumper");
                      if (roofSize !== "none") noteLines.push(`Roof: ${ROOF_LABEL[roofSize]}`);

                      // Stash the prefill in sessionStorage so the dashboard
                      // QuickQuote tile picks it up too (it mounts the card
                      // without props and can't see location.state). The
                      // QuickQuoteCard consumes + clears the key on mount.
                      try {
                        window.sessionStorage.setItem(
                          "restylepro_quickquote_prefill",
                          JSON.stringify({
                            year, make, model,
                            finish: selectedFinish,
                            extraCustomLines,
                            notes: noteLines.join("\n"),
                          }),
                        );
                      } catch {
                        /* sessionStorage unavailable — fall through to state */
                      }

                      navigate("/quick-quote", {
                        state: {
                          year, make, model,
                          finish: selectedFinish,
                          extraCustomLines,
                          notes: noteLines.join("\n"),
                        },
                      });
                    }}
                    className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90 text-white font-bold"
                  >
                    <Calculator className="w-4 h-4 mr-2" />
                    Open QuickQuote — Sq Ft Pricing & Quote
                  </Button>
                  </>
                )}

                {/* Production Pack & Cut Files - route to ProductionFlow */}
                <Button
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                  onClick={() => setShowProductionDialog(true)}
                >
                  <Package className="w-4 h-4 mr-2" />
                  Generate Production Pack
                </Button>
                <Button
                  className="w-full bg-purple-600 hover:bg-purple-700 text-white"
                  onClick={() => navigate("/productionflow", {
                    state: {
                      action: "run_cut_map",
                      renderData: {
                        render_urls: { roof: generatedImageUrl || "", ...(additionalViews || {}) },
                        vehicle_year: year,
                        vehicle_make: make,
                        vehicle_model: model,
                        design_name: selectedPattern?.name || "FadeWrap Design",
                      },
                    },
                  })}
                >
                  <Scissors className="w-4 h-4 mr-2" /> Generate Cut Contour Logo Pack
                </Button>
              </div>
            )}

            {/* 7-View Grid Display (Hero + 6 Additional) */}
            {showAdditionalViews && additionalViews.length > 0 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h4 className="font-semibold">7-View Proof</h4>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleDownloadAllViews}
                    disabled={downloadingAll || isGeneratingAdditional}
                    className="gap-2"
                  >
                    {downloadingAll ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Preparing...</>
                    ) : (
                      <><Download className="w-4 h-4" /> Download All {1 + additionalViews.length} Views</>
                    )}
                  </Button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Hero View (Rear 3/4) */}
                  {generatedImageUrl && (
                    <div 
                      className="relative aspect-video bg-secondary/20 rounded-lg overflow-hidden border border-border group cursor-pointer"
                      onClick={() => setExpandedImage({ url: generatedImageUrl, title: `${year} ${make} ${model} - ${selectedPattern?.name} - Rear (Hero)` })}
                    >
                      <img 
                        src={generatedImageUrl} 
                        alt="Hero rear view"
                        className="w-full h-full object-cover"
                      />
                      <RenderOverlay
                        toolName="FadeWraps"
                        manufacturer={selectedPattern?.isInkFusion ? "InkFusion" : undefined}
                        colorOrDesignName={selectedPattern?.name}
                      />
                      <span className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">Rear (Hero)</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); handleDownload(generatedImageUrl, `fadewraps-${selectedPattern?.name}-hero.png`); }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  )}
                  {/* Additional Views (Top, Front, Side) */}
                  {additionalViews.map((view) => (
                    <div 
                      key={view.type} 
                      className="relative aspect-video bg-secondary/20 rounded-lg overflow-hidden border border-border group cursor-pointer" 
                      onClick={() => setExpandedImage({ url: view.url, title: `${year} ${make} ${model} - ${selectedPattern?.name} - ${view.type} View` })}
                    >
                      <img 
                        src={view.url} 
                        alt={`${view.type} view`}
                        className="w-full h-full object-cover"
                      />
                      <RenderOverlay
                        toolName="FadeWraps"
                        manufacturer={selectedPattern?.isInkFusion ? "InkFusion" : undefined}
                        colorOrDesignName={selectedPattern?.name}
                      />
                      <span className="absolute top-2 left-2 bg-black/70 text-white text-xs px-2 py-1 rounded">{view.type}</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={(e) => { e.stopPropagation(); handleDownload(view.url, `fadewraps-${selectedPattern?.name}-${view.type}.png`); }}
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Card>

      <PaywallModal 
        open={paywallOpen} 
        onClose={() => setPaywallOpen(false)}
        onShowExample={() => {}}
        productType="fadewraps"
      />

      {/* Fullscreen Image Modal */}
      {expandedImage && (
        <div 
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4"
          onClick={() => setExpandedImage(null)}
        >
          <div className="relative max-w-7xl max-h-[90vh] w-full h-full">
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-4 right-4 z-10 bg-background/80 hover:bg-background"
              onClick={() => setExpandedImage(null)}
            >
              <X className="h-4 w-4" />
            </Button>
            <img 
              src={expandedImage.url} 
              alt={expandedImage.title}
              className="w-full h-full object-contain pb-20"
            />
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-background/95 px-6 py-3 rounded-lg border border-border shadow-lg">
              <p className="text-sm font-medium text-center">{expandedImage.title}</p>
            </div>
          </div>
        </div>
      )}
      
      <UpgradeRequired
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        requiredTier="advanced"
        featureName="FadeWraps™"
      />

      <LoginRequiredModal
        open={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        message="Please log in to generate renders. Create a free account to get 2 free renders!"
      />

      {/* Professional Proof Sheet Dialog */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className={isMobile ? "max-w-[95vw] max-h-[95vh] overflow-y-auto p-0" : "max-w-[95vw] max-h-[95vh] overflow-auto p-0"}>
          {isMobile ? (
            <MobileProofSheet
              views={[
                ...additionalViews.filter(v => v.type === 'side').map(v => ({ type: 'side', url: v.url, label: 'Driver Side' })),
                ...additionalViews.filter(v => v.type === 'passenger-side').map(v => ({ type: 'passenger-side', url: v.url, label: 'Passenger Side' })),
                ...additionalViews.filter(v => v.type === 'hood_detail').map(v => ({ type: 'hood_detail', url: v.url, label: 'Hood' })),
                ...additionalViews.filter(v => v.type === 'front').map(v => ({ type: 'front', url: v.url, label: 'Front' })),
                ...additionalViews.filter(v => v.type === 'rear').map(v => ({ type: 'rear', url: v.url, label: 'Rear' })),
                ...additionalViews.filter(v => v.type === 'close-up').map(v => ({ type: 'close-up', url: v.url, label: 'Close-Up' })),
                ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
              ].filter(v => v.url)}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolKey="fadewraps"
              designName={selectedPattern?.name || 'FadeWrap Design'}
              manufacturer={selectedPattern?.isInkFusion ? 'InkFusion' : 'FadeWraps'}
              colorName={selectedPattern?.name}
              finish={selectedFinish}
              hex={selectedPattern?.inkFusionColor?.hex || selectedPattern?.hex}
            />
          ) : (
            <ProfessionalProofSheet
              views={[
                ...additionalViews.filter(v => v.type === 'side').map(v => ({ type: 'side', url: v.url, label: 'Driver Side' })),
                ...additionalViews.filter(v => v.type === 'passenger-side').map(v => ({ type: 'passenger-side', url: v.url, label: 'Passenger Side' })),
                ...additionalViews.filter(v => v.type === 'hood_detail').map(v => ({ type: 'hood_detail', url: v.url, label: 'Hood' })),
                ...additionalViews.filter(v => v.type === 'front').map(v => ({ type: 'front', url: v.url, label: 'Front' })),
                ...additionalViews.filter(v => v.type === 'rear').map(v => ({ type: 'rear', url: v.url, label: 'Rear' })),
                ...additionalViews.filter(v => v.type === 'close-up').map(v => ({ type: 'close-up', url: v.url, label: 'Close-Up' })),
                ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
              ].filter(v => v.url)}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolName="FadeWraps™"
              designName={selectedPattern?.name || 'FadeWrap Design'}
              manufacturer={selectedPattern?.isInkFusion ? 'InkFusion' : 'FadeWraps'}
              colorName={selectedPattern?.name}
              finish={selectedFinish}
              hex={selectedPattern?.inkFusionColor?.hex || selectedPattern?.hex}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 2D Proof Sheet Dialog */}
      <Dialog open={show2DProofSheet} onOpenChange={setShow2DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          <TwoDProofSheet
            views={[
              ...additionalViews.filter(v => v.type === 'side').map(v => ({ type: 'side', url: v.url, label: 'Driver Side' })),
              ...additionalViews.filter(v => v.type === 'passenger-side').map(v => ({ type: 'passenger-side', url: v.url, label: 'Passenger Side' })),
              ...additionalViews.filter(v => v.type === 'front').map(v => ({ type: 'front', url: v.url, label: 'Front' })),
              ...additionalViews.filter(v => v.type === 'rear').map(v => ({ type: 'rear', url: v.url, label: 'Rear' })),
              ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
            ].filter(v => v.url)}
            vehicleYear={year}
            vehicleMake={make}
            vehicleModel={model}
            toolKey="fadewraps"
            designName={selectedPattern?.name || 'FadeWrap Design'}
            manufacturer={selectedPattern?.isInkFusion ? 'InkFusion' : 'FadeWraps'}
            colorName={selectedPattern?.name}
            finish={selectedFinish}
            hex={selectedPattern?.inkFusionColor?.hex || selectedPattern?.hex}
          />
        </DialogContent>
      </Dialog>

      {/* Production Pack Dialog */}
      <ProductionPackDialog
        open={showProductionDialog}
        onOpenChange={setShowProductionDialog}
        render={visualizationId ? {
          id: visualizationId,
          render_urls: { roof: generatedImageUrl || "", ...(additionalViews || {}) },
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          design_file_name: selectedPattern?.name,
          finish_type: selectedFinish,
        } : null}
      />

      {/* Studio Proof Layout (3D Proof Viewer) */}
      <StudioProofLayout
        toolName="FadeWraps™"
        designName={selectedPattern?.name || 'FadeWrap Design'}
        vehicleInfo={{ year, make, model }}
        views={[
          ...additionalViews.filter(v => v.type === 'side').map(v => ({ type: 'side', url: v.url, label: 'Driver Side' })),
          ...additionalViews.filter(v => v.type === 'driver-side').map(v => ({ type: 'driver-side', url: v.url, label: 'Driver Side' })),
          ...additionalViews.filter(v => v.type === 'passenger-side').map(v => ({ type: 'passenger-side', url: v.url, label: 'Passenger Side' })),
          ...additionalViews.filter(v => v.type === 'hood_detail').map(v => ({ type: 'hood_detail', url: v.url, label: 'Hood' })),
          ...additionalViews.filter(v => v.type === 'front').map(v => ({ type: 'front', url: v.url, label: 'Front' })),
          ...additionalViews.filter(v => v.type === 'rear').map(v => ({ type: 'rear', url: v.url, label: 'Rear' })),
          ...additionalViews.filter(v => v.type === 'close-up').map(v => ({ type: 'close-up', url: v.url, label: 'Close-Up' })),
          ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
        ].filter(v => v.url)}
        isOpen={showStudioProof}
        onClose={() => setShowStudioProof(false)}
        finish={selectedFinish}
      />

      {/* ApprovePro — Phase 8A */}
      <SendForApprovalDialog
        open={showSendForApproval}
        onOpenChange={setShowSendForApproval}
        context={{
          visualizationId: visualizationId || undefined,
          renderUrls: additionalViews.reduce(
            (acc: Record<string, string>, v: any) => ({ ...acc, [v.type]: v.url }),
            generatedImageUrl ? { hero: generatedImageUrl } : {},
          ),
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          designName: selectedPattern?.name || "FadeWrap Design",
          finishType: selectedFinish,
          defaultMode: "revision_loop",
        }}
      />
    </div>
  );
};
