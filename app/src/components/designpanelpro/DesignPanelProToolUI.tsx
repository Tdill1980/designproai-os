import { useState, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDesignPanelProLogic } from "@/hooks/useDesignPanelProLogic";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useFreemiumLimits } from "@/hooks/useFreemiumLimits";
import { useRevisionHistory } from "@/hooks/useRevisionHistory";
import { RevisionHistoryTimeline } from "@/components/tools/RevisionHistoryTimeline";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaywallModal } from "@/components/PaywallModal";
import { SocialEngagementModal } from "@/components/SocialEngagementModal";
import { LoginRequiredModal } from "@/components/LoginRequiredModal";
import { FreemiumCounter } from "@/components/FreemiumCounter";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { PanelUploader } from "./PanelUploader";
import { PanelLibrary } from "./PanelLibrary";
import { RenderQualityRating } from "@/components/RenderQualityRating";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { DesktopRenderModal } from "@/components/visualize/DesktopRenderModal";
import { DesignRevisionPrompt } from "@/components/tools/DesignRevisionPrompt";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Download, ChevronDown, Loader2, Image as ImageIcon, X, Car, RefreshCw, Layers, ShoppingCart, ClipboardSignature, Lightbulb, Check, Fingerprint, Copy, Info, Sparkles, Cog, FlipHorizontal2 } from "lucide-react";
import { GenerationWizard, DESIGNPANELPRO_TIPS } from "@/components/tools/GenerationWizard";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useNavigate } from "react-router-dom";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ProofPreviewCard } from "@/components/tools/ProofPreviewCard";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { MobileProofSheet } from "@/components/tools/MobileProofSheet";
import { TwoDProofSheet } from "@/components/tools/TwoDProofSheet";
import { RenderOverlay } from "@/components/tools/RenderOverlay";
import { DesignIDBadge } from "@/components/DesignIDBadge";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import { CoverageSelector } from "@/components/tools/CoverageSelector";
import { DesignIQExpectations } from "@/components/designpanelpro/DesignIQExpectations";
import { useStarredRenders } from "@/hooks/useStarredRenders";
import { StudioProofLayout } from "@/components/tools/StudioProofLayout";
import { VehicleTypeSelector, isNonStandardVehicle } from "@/components/tools/VehicleTypeSelector";
import { NonStandardVehicleWarning } from "@/components/tools/NonStandardVehicleWarning";
import { NonStandardVehicleLookup } from "@/components/tools/NonStandardVehicleLookup";
import { findVehicle, getPanelBreakdown } from "@/data/vehicle-measurements";
import { Ruler, Eye } from "lucide-react";
import { downloadAllWithOverlay, type OverlaySpec } from "@/lib/download-with-overlay";

export const DesignPanelProToolUI = () => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { subscription, checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const { 
    canGenerate: canGenerateFreemium, phase: freemiumPhase, isPrivileged, 
    totalRemaining, incrementGeneration: incrementFreemium, unlockBonus 
  } = useFreemiumLimits();
  const [socialModalOpen, setSocialModalOpen] = useState(false);
  const [paywallModalOpen, setPaywallModalOpen] = useState(false);
  
  // FadeWraps is now a separate standalone tool at /fadewraps
  const {
    vehicleType, setVehicleType, nonStandardSpecs,
    selectedPanel, setSelectedPanel, selectedFinish, setSelectedFinish, coverageType, setCoverageType,
    curatedPanels, isLoading,
    generateRender, isGenerating, generatedImageUrl, setGeneratedImageUrl, visualizationId, allViews,
    generateAdditionalViews, isGeneratingAdditional, uploadMode, setUploadMode,
    showUpgradeModal, setShowUpgradeModal,
    showLoginModal, setShowLoginModal,
    clearLastRender,
    flatProofUrl: hookFlatProofUrl,
    saveDesignJob,
    designName: hookDesignName,
    renderDid,
    renderPt,
    generationError,
    clearGenerationError,
  } = useDesignPanelProLogic();
  const { data: starredImageUrls } = useStarredRenders();
  const [isSavingDesign, setIsSavingDesign] = useState(false);
  const [recentPanels, setRecentPanels] = useState<any[]>([]);
  const [showProductionDialog, setShowProductionDialog] = useState(false);

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [yearError, setYearError] = useState(false);
  const [expandedImage, setExpandedImage] = useState<{ url: string; title: string } | null>(null);
  const [flippedViews, setFlippedViews] = useState<Record<string, boolean>>({});
  const yearInputRef = useRef<HTMLInputElement>(null);
  const [vehicleInputOpen, setVehicleInputOpen] = useState(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('designpanelpro-sidebar-collapsed');
    return saved ? JSON.parse(saved) : false;
  });
  const [pullToRefreshActive, setPullToRefreshActive] = useState(false);
  const [fullscreenIndex, setFullscreenIndex] = useState<number>(-1);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [showStudioProof, setShowStudioProof] = useState(false);
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  const [downloadingAll, setDownloadingAll] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const touchStartY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // Timer during generation + tip rotation + scroll to generation modal
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isGenerating || isRevising) {
      setElapsedSeconds(0);
      setCurrentTipIndex(0);
      // Scroll to the generation container so the progress UI is visible
      if (containerRef.current) {
        containerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
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
        setCurrentTipIndex(prev => (prev + 1) % DESIGNPANELPRO_TIPS.length);
      }, 5000);
      return () => clearInterval(tipInterval);
    }
  }, [isGenerating, isRevising]);

  // Revision history for DesignPanelPro
  const { revisionHistory, saveRevision } = useRevisionHistory('designpanelpro');

  // flatProofUrl comes from the hook — set by Phase 4 after all views complete

  // LOCKED PIPELINE: Auto-fire all views → 2D proof → artboard when hero render completes.
  // Phase 4 (proof + artboard) lives inside generateAdditionalViews and MUST fire
  // at render time — not as a separate user action. This is gospel.
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

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('designpanelpro-sidebar-collapsed', JSON.stringify(sidebarCollapsed));
  }, [sidebarCollapsed]);

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

  // Track recently viewed panels (last 5 selections)
  useEffect(() => {
    if (!selectedPanel) return;
    setRecentPanels((prev) => {
      const filtered = prev.filter((p) => p.id !== selectedPanel.id);
      return [selectedPanel, ...filtered].slice(0, 5);
    });
  }, [selectedPanel]);

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
    if (!selectedPanel) {
      toast({ title: "No panel selected", description: "Please select or upload a panel design first", variant: "destructive" });
      return;
    }
    
    if (!validateYear()) return;

    if (!make || !model) {
      toast({ title: "Vehicle required", description: "Please enter year, make, and model", variant: "destructive" });
      return;
    }

    // Check freemium limits first (unless privileged)
    if (!isPrivileged && !canGenerateFreemium) {
      if (freemiumPhase === 'engagement') {
        setSocialModalOpen(true);
      } else if (freemiumPhase === 'paywall') {
        setPaywallModalOpen(true);
      }
      return;
    }

    // Then check subscription limits for subscribed users
    if (subscription && !isPrivileged) {
      const canGenerate = await checkCanGenerate();
      if (!canGenerate) {
        return;
      }
    }

    await generateRender(year, make, model);
    
    // Track both freemium and subscription usage
    if (!isPrivileged) {
      incrementFreemium();
    }
    if (subscription) {
      await incrementRenderCount();
    }
  };

  const pendingRevisionRef = useRef<{ originalUrl: string; prompt: string } | null>(null);

  const handleRevisionSubmit = async (prompt: string) => {
    if (!selectedPanel || !year || !make || !model) return;
    const originalUrl = generatedImageUrl;
    if (!originalUrl) return;
    // Stash the pre-revision URL so we can save it to history once the new URL arrives.
    pendingRevisionRef.current = { originalUrl, prompt };
    setIsRevising(true);
    try {
      const result = await generateRender(year, make, model, prompt, originalUrl);
      if (result === null) {
        toast({ title: "Revision applied", description: "New render generated with your changes" });
      } else {
        // Generation failed — drop the pending save.
        pendingRevisionRef.current = null;
      }
    } finally {
      setIsRevising(false);
    }
  };

  // Persist the revision to history once the new render URL replaces the original.
  // generateRender updates state asynchronously, so the new URL is only available after re-render.
  useEffect(() => {
    const pending = pendingRevisionRef.current;
    if (!pending) return;
    if (generatedImageUrl && generatedImageUrl !== pending.originalUrl) {
      pendingRevisionRef.current = null;
      saveRevision({
        viewType: 'side',
        originalUrl: pending.originalUrl,
        revisedUrl: generatedImageUrl,
        revisionPrompt: pending.prompt,
        designId: visualizationId || undefined,
      });
    }
  }, [generatedImageUrl, saveRevision, visualizationId]);

  const handleRestoreRevision = (item: { original_url?: string; revised_url: string; revision_prompt: string }) => {
    // The "original_url" is the pre-revision render — restoring rolls back to that.
    const restoreUrl = item.original_url || item.revised_url;
    if (!restoreUrl) return;
    setGeneratedImageUrl(restoreUrl);
    toast({ title: "Reverted", description: "Restored the previous render" });
  };

  const handleGenerateAllViews = async () => {
    if (!generatedImageUrl) {
      toast({ title: "No render available", description: "Generate a 3D proof first", variant: "destructive" });
      return;
    }

    await generateAdditionalViews(year, make, model);
  };

  const handleDownloadAllViews = async () => {
    const designName = hookDesignName || selectedPanel?.ai_generated_name || selectedPanel?.name || "design";
    const baseName = `designpro-${designName}`.replace(/\s+/g, "-").replace(/[^a-z0-9-_]/gi, "");
    const seen = new Set<string>();
    const images: Array<{ url: string; filename: string }> = [];

    if (generatedImageUrl) {
      images.push({ url: generatedImageUrl, filename: `${baseName}-hero` });
      seen.add(generatedImageUrl);
    }
    for (const view of allViews || []) {
      if (view?.url && !seen.has(view.url)) {
        seen.add(view.url);
        images.push({ url: view.url, filename: `${baseName}-${view.type}` });
      }
    }
    if (images.length === 0) {
      toast({ title: "No views available", description: "Generate views first", variant: "destructive" });
      return;
    }

    const overlay: OverlaySpec = {
      toolName: "DesignProAI",
      colorOrDesignName: designName,
    };

    setDownloadingAll(true);
    toast({ title: "Preparing downloads", description: `Downloading ${images.length} views...` });
    try {
      await downloadAllWithOverlay(images, overlay);
      toast({ title: "Download complete", description: `${images.length} views downloaded` });
    } catch (err) {
      toast({ title: "Download all failed", description: "Please try again", variant: "destructive" });
    } finally {
      setDownloadingAll(false);
    }
  };


  return (
    <div ref={containerRef} className="container max-w-7xl mx-auto px-3 sm:px-4 py-2 pb-24 overflow-x-hidden relative">
      {/* Pull-to-refresh indicator */}
      {pullToRefreshActive && isMobile && (
        <div className="fixed top-0 left-0 right-0 z-50 bg-primary/90 text-primary-foreground py-3 flex items-center justify-center gap-2">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm font-medium">Release to refresh...</span>
        </div>
      )}
      
      <Card className="overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-background p-4 sm:p-6 border-b">
              <h2 className="text-xl sm:text-2xl font-bold mb-2">
                <span className="text-foreground">DesignPanel</span>
                <span className="text-gradient-blue">Pro™</span>
              </h2>
              <p className="text-sm text-muted-foreground mt-1 mb-2">
                Premium panel designs for professional wraps
              </p>
              <p className="text-xs text-muted-foreground/80 italic border-l-2 border-primary/30 pl-3">
                Transform any premium vinyl panel design (186" x 56") into stunning, photorealistic 3D vehicle proofs. Upload your own custom panels or select from our curated library of professional designs-instantly visualize how they'll look on any vehicle before printing.
              </p>
            </div>

        {/* Main Content */}
        <div className="flex flex-col xl:grid xl:grid-cols-[380px,1fr] gap-4 sm:gap-6 p-3 sm:p-4 lg:p-6">
          {/* Left Sidebar - Configuration */}
          <div className="space-y-4">
            {/* Vehicle Information - Collapsible */}
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
                  <p className="text-sm text-muted-foreground mb-3">Select Your Vehicle</p>
                  {/* Vehicle type — push-button per class */}
                  <div className="mb-3">
                    <VehicleTypeSelector value={vehicleType} onChange={setVehicleType} />
                  </div>
                  {isNonStandardVehicle(vehicleType) ? (
                    <NonStandardVehicleLookup
                      vehicleType={vehicleType}
                      onResult={(r) => {
                        setMake(r.make);
                        setModel(r.model);
                        if (r.year) setYear(r.year);
                      }}
                    />
                  ) : (
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
                  )}
                </CollapsibleContent>
              </Card>
            </Collapsible>

            {/* Panel Selection */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Select Panel</h3>
              <Tabs value={uploadMode} onValueChange={(v) => setUploadMode(v as 'curated' | 'custom')}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="curated">Curated Library</TabsTrigger>
                  <TabsTrigger value="custom">Upload Custom</TabsTrigger>
                </TabsList>
                <TabsContent value="curated" className="mt-4">
                  <PanelLibrary
                    panels={curatedPanels || []}
                    selectedPanel={selectedPanel}
                    onSelectPanel={setSelectedPanel}
                    isLoading={isLoading}
                  />
                </TabsContent>
                <TabsContent value="custom" className="mt-4">
                  <PanelUploader onPanelUploaded={setSelectedPanel} />
                </TabsContent>
              </Tabs>
            </div>

            {/* Finish Selector */}
            <div>
              <h3 className="text-lg font-semibold mb-4">Select Lamination Finish</h3>
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

            {/* Coverage Selector */}
            <CoverageSelector
              coverageType={coverageType}
              onCoverageChange={setCoverageType}
            />

            {/* Recently Viewed Designs */}
            {recentPanels.length > 0 && (
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Layers className="w-4 h-4" /> Recently Viewed Designs
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {recentPanels.map((panel) => (
                    <Card
                      key={panel.id}
                      className="cursor-pointer overflow-hidden border-border/60 hover:border-primary/60 hover:shadow-md transition-all"
                      onClick={() => setSelectedPanel(panel)}
                    >
                      <div className="relative" style={{ aspectRatio: '3.32 / 1' }}>
                        <img
                          src={panel.clean_display_url || panel.media_url}
                          alt={panel.ai_generated_name || panel.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-2 bg-background">
                        <p className="text-xs font-medium truncate">{panel.ai_generated_name || panel.name}</p>
                        <p className="text-[10px] text-muted-foreground">186" × 56"</p>
                      </div>
                    </Card>
                  ))}
                </div>
              </div>
            )}

           </div>

          {/* Right Side - Preview Window */}
          <div className="space-y-4">
            {/* Generate Buttons Above Preview */}
            <div className="space-y-2">
              <Button
                onClick={handleGenerate}
                disabled={isGenerating || !selectedPanel}
                className="w-full"
                size="lg"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate 3D Proof"
                )}
              </Button>

              <Button
                onClick={handleGenerateAllViews}
                disabled={isGeneratingAdditional || !selectedPanel || !year || !make || !model}
                variant="outline"
                className="w-full"
              >
                {isGeneratingAdditional ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating All Views...
                  </>
                ) : (
                  "Generate All Views"
                )}
              </Button>
            </div>

            {/* Generation Wizard for Panel Renders */}
            {isGenerating && (
              <GenerationWizard
                elapsedSeconds={elapsedSeconds}
                tips={DESIGNPANELPRO_TIPS}
                currentTipIndex={currentTipIndex}
                toolName="Panel Design"
                gradientFrom="from-cyan-500"
                gradientTo="to-blue-500"
                designIQShowcase
                starredImageUrls={starredImageUrls}
              />
            )}

            {/* Preview Window */}
            {(
              <Card className={cn(
                "bg-secondary/30 overflow-hidden relative",
                "aspect-video"
              )}>
                {generatedImageUrl ? (
                <div className="absolute inset-0 flex flex-col">
                  {/* Render Image */}
                  <div className="relative flex-1 min-h-0 group cursor-pointer" onClick={() => setExpandedImage({ url: generatedImageUrl, title: `${year} ${make} ${model} - Front View` })}>
                    <img
                      src={generatedImageUrl}
                      alt="Generated render"
                      className="w-full h-full object-contain"
                    />
                    {/* DesignID Badge overlay */}
                    <DesignIDBadge
                      toolName="DesignProAI™"
                      designName={hookDesignName || selectedPanel?.ai_generated_name || selectedPanel?.name}
                      did={renderDid || undefined}
                      pt={renderPt || undefined}
                      showPT={false}
                    />
                    <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <RenderQualityRating
                        renderId={visualizationId || generatedImageUrl || ''}
                        renderType="designpanelpro"
                        renderUrl={generatedImageUrl || ''}
                      />
                    </div>
                  </div>
                  {/* Info Card BELOW Image */}
                  {(() => {
                    const vehicleMeasure = findVehicle(make, model, year);
                    const breakdown = vehicleMeasure ? getPanelBreakdown(vehicleMeasure) : null;
                    const sqFt = breakdown?.corrected || breakdown?.total || null;
                    return (
                      <div className="bg-background/95 backdrop-blur-sm px-4 py-3 border-t border-border space-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">Last Design Generated</p>
                          <p className="text-sm font-semibold">{year} {make} {model}</p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-muted-foreground">
                              {selectedPanel?.ai_generated_name || selectedPanel?.name} • {selectedFinish}
                            </p>
                            {sqFt && (
                              <Badge variant="outline" className="text-[10px] gap-1 text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
                                <Ruler className="w-3 h-3" />
                                {Math.round(sqFt)} sq ft
                              </Badge>
                            )}
                          </div>
                        </div>
                        {/* Quick action buttons */}
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (allViews.length === 0) generateAdditionalViews();
                              else setExpandedImage({ url: generatedImageUrl!, title: `${year} ${make} ${model} — 3D Render` });
                            }}
                            disabled={isGeneratingAdditional}
                            className="flex-1 gap-1.5 text-xs h-8"
                          >
                            {isGeneratingAdditional ? <Loader2 className="w-3 h-3 animate-spin" /> : <Eye className="w-3 h-3" />}
                            {allViews.length > 0 ? `View 3D Render (${allViews.length + 1})` : "Generate 3D Views"}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setShow2DProofSheet(true)}
                            className="flex-1 gap-1.5 text-xs h-8"
                          >
                            <ClipboardSignature className="w-3 h-3" />
                            2D Proof{sqFt ? ` • ${Math.round(sqFt)} sq ft` : ""}
                          </Button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : generationError ? (
                /* Friendly error state with animated sprocket */
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-cyan-500/5 via-background to-purple-500/5 px-6">
                  <div className="relative mb-4">
                    <Cog className="w-16 h-16 text-cyan-400/60 animate-spin" style={{ animationDuration: '4s' }} />
                    <Cog className="w-8 h-8 text-purple-400/60 animate-spin absolute -top-1 -right-3" style={{ animationDuration: '3s', animationDirection: 'reverse' }} />
                  </div>
                  <p className="text-base font-semibold text-foreground mb-1">
                    Oops — hit a snag!
                  </p>
                  <p className="text-sm text-muted-foreground text-center mb-4 max-w-xs">
                    {generationError}
                  </p>
                  <Button
                    onClick={() => {
                      clearGenerationError();
                      handleGenerate();
                    }}
                    className="gap-2 bg-cyan-500 hover:bg-cyan-600 text-white"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Try Again
                  </Button>
                </div>
              ) : (
                <div className="absolute inset-0 flex flex-col bg-background">
                  {/* Selected panel thumbnail overlay */}
                  {selectedPanel && (
                    <div className="absolute top-3 right-3 z-10 flex items-center gap-2 bg-background/90 backdrop-blur-sm px-3 py-1.5 rounded-lg border border-border/50">
                      <img
                        src={selectedPanel.clean_display_url || selectedPanel.media_url}
                        alt={selectedPanel.ai_generated_name || selectedPanel.name}
                        className="w-8 h-8 rounded object-cover"
                      />
                      <span className="text-xs font-medium text-muted-foreground truncate max-w-[120px]">
                        {selectedPanel.ai_generated_name || selectedPanel.name}
                      </span>
                    </div>
                  )}
                  {/* ACE intro with system facts + star renders behind */}
                  <DesignIQExpectations starredImageUrls={starredImageUrls} />
                  {/* Idle state — show prompt to generate */}
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-sm text-muted-foreground text-center px-6">
                      Select a design panel above, then click <span className="font-semibold text-cyan-400">Create with DesignIQ™</span> to generate your wrap.
                    </p>
                  </div>
                </div>
              )}
              </Card>
            )}

              {/* Non-standard vehicle validation warning — blocks production until verified */}
              {nonStandardSpecs && generatedImageUrl && (
                <div className="mt-4">
                  <NonStandardVehicleWarning specs={nonStandardSpecs} />
                </div>
              )}

              {/* Customer Approval Proof Buttons */}
              {generatedImageUrl && (
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    onClick={() => setShow2DProofSheet(true)}
                    className="flex-1 gap-2"
                  >
                    <ClipboardSignature className="w-4 h-4" />
                    2D Proof
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setShowProofSheet(true)}
                    className="flex-1 gap-2"
                  >
                    <ClipboardSignature className="w-4 h-4" />
                    3D Proof
                  </Button>
                </div>
              )}

              {/* Download All Views — appears once at least one view is rendered */}
              {generatedImageUrl && (
                <Button
                  variant="outline"
                  onClick={handleDownloadAllViews}
                  disabled={downloadingAll || isGeneratingAdditional}
                  className="w-full gap-2 mt-2"
                >
                  {downloadingAll ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Preparing {Math.max(1, allViews.length)} Views...</>
                  ) : (
                    <><Download className="w-4 h-4" /> Download All {allViews.length > 0 ? allViews.length : 1} View{allViews.length === 1 ? "" : "s"}</>
                  )}
                </Button>
              )}

              {/* Design Revision Prompt - Always visible as selling point */}
              <div className="mt-4">
                <DesignRevisionPrompt
                  onRevisionSubmit={handleRevisionSubmit}
                  isGenerating={isRevising || isGenerating}
                  disabled={!generatedImageUrl || !selectedPanel || !year || !make || !model}
                  onPrecisionEdit={() => {
                    if (visualizationId) {
                      // Hand the saved render to Revision Studio — LayerLift,
                      // Precision Editor, and drag-to-place edit it in place
                      // instead of a full re-render (no background warp).
                      navigate(`/revision-studio?id=${visualizationId}`);
                    } else {
                      toast({
                        title: "Save your design first",
                        description: "Generate a proof, then use the precision editor to move logos and text.",
                        variant: "destructive",
                      });
                    }
                  }}
                />

                {/* Revision History Timeline */}
                {revisionHistory.length > 0 && (
                  <RevisionHistoryTimeline
                    history={revisionHistory}
                    onSelect={(item) => {
                      if (item.revised_url) {
                        setExpandedImage({ url: item.revised_url, title: `Revision: ${item.revision_prompt}` });
                      }
                    }}
                    onRestore={handleRestoreRevision}
                    className="mt-4"
                  />
                )}
              </div>

              {/* Order This Design CTA */}
              {generatedImageUrl && (
                <div className="mt-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg">
                  <p className="text-sm font-medium mb-3 text-center">Want to purchase this design?</p>
                  <div className="flex gap-2 flex-col sm:flex-row">
                    <Button
                      onClick={() => setShowProductionDialog(true)}
                      className="flex-1"
                      variant="default"
                    >
                      <ShoppingCart className="w-4 h-4 mr-2" />
                      Order Production Pack
                    </Button>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        setIsSavingDesign(true);
                        try {
                          const savedDesign = await saveDesignJob(year, make, model);
                          if (savedDesign?.id) {
                            navigate(`/printpro/design-packs?designId=${savedDesign.id}`);
                          } else {
                            const designContext = {
                              panelId: selectedPanel?.id,
                              panelName: selectedPanel?.ai_generated_name || selectedPanel?.name,
                              panelUrl: selectedPanel?.media_url,
                              vehicleYear: year,
                              vehicleMake: make,
                              vehicleModel: model,
                              finish: selectedFinish,
                              renderUrl: generatedImageUrl
                            };
                            localStorage.setItem('designpanelpro-purchase-context', JSON.stringify(designContext));
                            navigate(`/printpro/design-packs?panelId=${selectedPanel?.id}`);
                          }
                        } finally {
                          setIsSavingDesign(false);
                        }
                      }}
                      className="flex-1"
                      disabled={isSavingDesign}
                    >
                      Order Cut Logo Files
                    </Button>
                  </div>
                </div>
              )}

              {/* Additional Views */}
            {allViews.length > 0 && (
              <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                {allViews.map((view) => (
                  <Card
                    key={view.type}
                    className="overflow-hidden group relative aspect-video bg-secondary/30 cursor-pointer"
                    onClick={() => setExpandedImage({ url: view.url, title: `${year} ${make} ${model} - ${view.type.charAt(0).toUpperCase() + view.type.slice(1)} View` })}
                  >
                    <img
                      src={view.url}
                      alt={view.type}
                      className={cn("w-full h-full object-cover transition-transform", flippedViews[view.type] && "scale-x-[-1]")}
                    />
                    <DesignIDBadge
                      toolName="DesignProAI™"
                      did={renderDid || undefined}
                    />
                    <div className="absolute bottom-2 left-2 bg-background/90 px-2 py-1 rounded text-xs font-medium capitalize z-20">
                      {view.type}
                    </div>
                    {/* Flip/Mirror button */}
                    <div
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity z-30"
                      onClick={(e) => { e.stopPropagation(); setFlippedViews(prev => ({ ...prev, [view.type]: !prev[view.type] })); }}
                    >
                      <div className="bg-background/90 backdrop-blur-sm rounded-full p-2 hover:bg-background cursor-pointer">
                        <FlipHorizontal2 className="h-4 w-4 text-foreground" />
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            )}

            {/* 2D Proof + Production Pack — visible after all views render */}
            {allViews.length > 1 && (
              <div className="mt-4 space-y-3">
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
                    variant="secondary"
                    onClick={() => setShowProofSheet(true)}
                    className="flex-1 gap-2"
                  >
                    <ClipboardSignature className="w-4 h-4" />
                    3D Proof
                  </Button>
                </div>
                <div className="p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg">
                  <p className="text-sm font-medium mb-3 text-center">Ready to print this design?</p>
                  <Button
                    onClick={() => setShowProductionDialog(true)}
                    className="w-full"
                    variant="default"
                  >
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Order Production Pack
                  </Button>
                </div>
              </div>
            )}

            {/* Post-render expectations reminder */}
            {allViews.length > 0 && (
              <DesignIQExpectations compact className="mt-4" />
            )}
          </div>
        </div>

        {/* Footer - Product Branding */}
        <div className="border-t p-4 bg-secondary/30">
          <div className="text-sm">
            <span className="font-medium">
              <span className="text-foreground">DesignPanel</span>
              <span className="text-gradient-blue">Pro™</span>
            </span>
          </div>
        </div>

        {/* Prompt Thumbprint™ FAQ - Collapsible */}
        <div className="border-t border-border/50">
          <Collapsible>
            <CollapsibleTrigger className="w-full px-4 py-3 flex items-center justify-between hover:bg-secondary/20 transition-colors">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5" />
                <span className="font-medium">About Prompt Thumbprint™ & Design Provenance</span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="px-4 pb-4 space-y-3 text-xs text-muted-foreground">
                <div>
                  <p className="font-medium text-foreground mb-1">What is a Prompt Thumbprint™?</p>
                  <p>
                    Every design you generate receives a unique Prompt Thumbprint - a short identifier derived from your vehicle, design mode, and creative concept.
                    It's a digital thumbprint for your design session that helps you reference, track, and manage your creations.
                  </p>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">What the Prompt Thumbprint does</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Gives each generation a unique, trackable reference</li>
                    <li>Helps prevent accidental duplicate charges (double-clicks, page refreshes)</li>
                    <li>Links your render to your vehicle and design configuration</li>
                    <li>Makes it easy to reference a specific design with support or reorders</li>
                  </ul>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">What it does NOT mean</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>It is not a copyright registration or legal ownership certificate</li>
                    <li>It does not guarantee two designs will look visually identical</li>
                    <li>It does not prevent other users from generating similar concepts</li>
                    <li>AI-generated designs are unique each time - the same prompt can produce different visual results</li>
                  </ul>
                </div>

                <div>
                  <p className="font-medium text-foreground mb-1">Ownership & Production</p>
                  <p>
                    When you purchase a production pack for a design, that design is marked as <span className="font-medium text-foreground">owned</span> in
                    your account. You receive full print-ready production files for the vehicle and design you purchased.
                    Your Prompt Thumbprint stays linked to your production order for easy reorders and support.
                  </p>
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </Card>

      {/* Mobile Zoom Image Modal */}
      <MobileZoomImageModal
        imageUrl={expandedImage?.url || ''}
        title={expandedImage?.title}
        isOpen={!!expandedImage}
        onClose={() => setExpandedImage(null)}
      />
      
      <UpgradeRequired
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        requiredTier="complete"
        featureName="DesignPanelPro™"
      />

      <SocialEngagementModal
        open={socialModalOpen}
        onClose={() => setSocialModalOpen(false)}
        onUnlock={unlockBonus}
      />

      <PaywallModal
        open={paywallModalOpen}
        onClose={() => setPaywallModalOpen(false)}
      />

      <LoginRequiredModal
        open={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        message="Please log in to generate renders. Create a free account to get 2 free renders!"
      />

      {/* Professional Proof Sheet Dialog */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className={isMobile ? "max-w-[95vw] max-h-[95vh] overflow-y-auto p-0" : "max-w-[95vw] max-h-[95vh] overflow-y-auto p-0"}>
          {isMobile ? (
            <MobileProofSheet
              views={(() => {
                const viewLabels: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', hood_detail: 'Hood', front: 'Front', rear: 'Rear', 'close-up': 'Close-Up', roof: 'Roof' };
                const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
                return order
                  .map(t => allViews.find(v => v.type === t))
                  .filter((v): v is typeof allViews[number] => !!v && !!v.url)
                  .map(v => ({ type: v.type, url: v.url, label: viewLabels[v.type] || v.type }));
              })()}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolKey="designpanelpro"
              designName={selectedPanel?.ai_generated_name || selectedPanel?.name}
              finish={selectedFinish}
            />
          ) : (
            <ProfessionalProofSheet
              views={(() => {
                const viewLabels: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', hood_detail: 'Hood', front: 'Front', rear: 'Rear', 'close-up': 'Close-Up', roof: 'Roof' };
                const order = ['side', 'passenger-side', 'hood_detail', 'front', 'rear', 'close-up', 'roof'];
                return order
                  .map(t => allViews.find(v => v.type === t))
                  .filter((v): v is typeof allViews[number] => !!v && !!v.url)
                  .map(v => ({ type: v.type, url: v.url, label: viewLabels[v.type] || v.type }));
              })()}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolName="DesignPanelPro™"
              designName={selectedPanel?.ai_generated_name || selectedPanel?.name}
              finish={selectedFinish}
              initialProofUrl={hookFlatProofUrl}
            />
          )}
        </DialogContent>
      </Dialog>


      {/* 2D Proof Sheet Dialog */}
      <Dialog open={show2DProofSheet} onOpenChange={setShow2DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          <TwoDProofSheet
            views={(() => {
              const viewLabels: Record<string, string> = { side: 'Driver Side', 'passenger-side': 'Passenger Side', front: 'Front', rear: 'Rear', roof: 'Roof' };
              const order = ['side', 'passenger-side', 'front', 'rear', 'roof'];
              return order
                .map(t => allViews.find(v => v.type === t))
                .filter((v): v is typeof allViews[number] => !!v && !!v.url)
                .map(v => ({ type: v.type, url: v.url, label: viewLabels[v.type] || v.type }));
            })()}
            vehicleYear={year}
            vehicleMake={make}
            vehicleModel={model}
            toolKey="designpanelpro"
            designName={selectedPanel?.ai_generated_name || selectedPanel?.name}
            finish={selectedFinish}
            initialProofUrl={hookFlatProofUrl}
            generationId={visualizationId}
            serverOrchestrated
          />
        </DialogContent>
      </Dialog>

      {/* Studio Proof Layout - 3D proof viewer */}
      <StudioProofLayout
        toolName="DesignPanelPro™"
        designName={selectedPanel?.ai_generated_name || selectedPanel?.name}
        vehicleInfo={{ year, make, model }}
        views={allViews.map(v => ({
          type: v.type,
          url: v.url,
          label: {
            side: 'Driver Side', 'driver-side': 'Driver Side', 'passenger-side': 'Passenger Side',
            hood_detail: 'Hood', front: 'Front', rear: 'Rear', 'close-up': 'Close-Up', roof: 'Roof',
          }[v.type] || v.type,
        }))}
        isOpen={showStudioProof}
        onClose={() => setShowStudioProof(false)}
      />

      {/* ProductionPackDialog - Universal Panelizer with 4 sizes */}
      <ProductionPackDialog
        open={showProductionDialog}
        onOpenChange={setShowProductionDialog}
        render={generatedImageUrl ? {
          id: visualizationId || crypto.randomUUID(),
          render_urls: allViews.length > 0
            ? allViews.reduce((acc, v) => ({ ...acc, [v.type || 'side']: v.url }), {} as Record<string, string>)
            : { side: generatedImageUrl },
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          design_file_name: selectedPanel?.ai_generated_name || selectedPanel?.name || 'DesignProAI Design',
          finish_type: selectedFinish,
          custom_design_url: selectedPanel?.media_url,
        } : null}
      />
    </div>
  );
};
