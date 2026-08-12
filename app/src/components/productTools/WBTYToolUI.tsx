import { useToast } from "@/hooks/use-toast";
import { usePreloadRender } from "@/hooks/usePreloadRender";
import { useWBTYLogic } from "@/hooks/useWBTYLogic";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useFreemiumLimits } from "@/hooks/useFreemiumLimits";
import { use360SpinLogic } from "@/hooks/use360SpinLogic";
import { useRevisionHistory } from "@/hooks/useRevisionHistory";
import { RevisionHistoryTimeline } from "@/components/tools/RevisionHistoryTimeline";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WrapByTheYardMode } from "@/components/tools/modes/WrapByTheYardMode";
import { WBTYPatternUploader } from "@/components/productTools/WBTYPatternUploader";
import { BuyPatternModal } from "@/components/productTools/BuyPatternModal";
import { ShoppingCart } from "lucide-react";
import { PaywallModal } from "@/components/PaywallModal";
import { SocialEngagementModal } from "@/components/SocialEngagementModal";
import { FreemiumCounter } from "@/components/FreemiumCounter";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { RenderQualityRating } from "@/components/RenderQualityRating";
import { MarkAsPerfectButton } from "@/components/MarkAsPerfectButton";
import { Vehicle360Viewer } from "@/components/visualize/Vehicle360Viewer";
import { Vehicle360LoadingState } from "@/components/visualize/Vehicle360LoadingState";
import { DesignRevisionPrompt } from "@/components/tools/DesignRevisionPrompt";
import { useState, useRef, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { Package, Ruler, Download, X, Car, ChevronDown, RotateCw, Rotate3D, Sparkles, ClipboardSignature, Lightbulb, Check, Scissors, Loader2, Calculator, Edit3 } from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { MobileProofSheet } from "@/components/tools/MobileProofSheet";
import { TwoDProofSheet } from "@/components/tools/TwoDProofSheet";
import { StudioProofLayout } from "@/components/tools/StudioProofLayout";
import { GenerationWizard, PATTERNPRO_TIPS } from "@/components/tools/GenerationWizard";
import { RenderOverlay } from "@/components/tools/RenderOverlay";
import { Badge } from "@/components/ui/badge";
import { downloadWithOverlay, OverlaySpec } from "@/lib/download-with-overlay";
import { MyVehicleProToggle } from "@/components/tools/MyVehicleProToggle";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { useMyVehicleMode } from "@/hooks/useMyVehicleMode";
import { useMyVehicleGenerate } from "@/hooks/useMyVehicleGenerate";
import { VehicleTypeSelector, isNonStandardVehicle } from "@/components/tools/VehicleTypeSelector";
import { NonStandardVehicleLookup } from "@/components/tools/NonStandardVehicleLookup";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import { Camera } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { EstimatorDrawer, OpenEstimatorButton } from "@/components/quote/EstimatorDrawer";
import { QuickQuoteSidePanel } from "@/components/quote/QuickQuoteSidePanel";
import { QuickQuoteCard } from "@/components/dashboard/QuickQuoteCard";
import { useEstimator } from "@/hooks/useEstimator";
import type { EstimatorState } from "@/lib/quote-estimator";
import { PrecisionModButtons } from "@/components/quote/PrecisionModButtons";
import type { PrecisionModification, PrecisionModResult } from "@/hooks/usePrecisionModifications";
import { saveQuote } from "@/lib/quickquote-db";
import { nextOrderNumber } from "@/lib/bulk-prompt-generator";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { findProductById } from "@/lib/quote-product-catalog";
import { DesignProductsCompareCard } from "@/components/quote/DesignProductsCompareCard";

export const WBTYToolUI = ({ preloadRenderId }: { preloadRenderId?: string | null }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { subscription, checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const { 
    canGenerate: canGenerateFreemium, phase: freemiumPhase, isPrivileged, 
    totalRemaining, incrementGeneration: incrementFreemium, unlockBonus 
  } = useFreemiumLimits();
  const {
    selectedProduct, setSelectedProduct, yardsNeeded, setYardsNeeded,
    totalPrice, productId, hasReachedLimit, remainingGenerations,
    incrementGeneration, showFallback, setShowFallback, pricePerYard,
    generateRender, isGenerating, generatedImageUrl, visualizationId, selectedFinish, 
    setSelectedFinish, patternScale, setPatternScale, additionalViews,
    generateAdditionalViews, isGeneratingAdditional,
    calculatedSquareFeet, calculateSquareFeet, isCalculatingSquareFeet,
    uploadMode, setUploadMode,
    showUpgradeModal, setShowUpgradeModal,
    clearLastRender,
    saveDesignJob,
    designAnchorText,
    designName,
    vehicleType,
    setVehicleType,
  } = useWBTYLogic();

  // MyVehiclePro state
  const mvp = useMyVehicleMode();
  const { mvpIsGenerating, mvpEditedImageUrl, mvpBeforeUrl, mvpMultiViewResults, mvpError, generateOnMyVehicle, clearMyVehicleResults } = useMyVehicleGenerate();

  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [socialModalOpen, setSocialModalOpen] = useState(false);
  const [yearError, setYearError] = useState(false);
  // QuickQuote × PatternPro side panel — branded sidebar consistent
  // with the other tools. Hosts the dashboard QuickQuoteCard so the
  // rep can build a price alongside the WBTY pattern wrap.
  const [showQuickQuote, setShowQuickQuote] = useState(false);
  const [showAdditionalViews, setShowAdditionalViews] = useState(false);
  const [expandedImage, setExpandedImage] = useState<{ url: string; title: string } | null>(null);
  const [show360View, setShow360View] = useState(false);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const [vehicleInputOpen, setVehicleInputOpen] = useState(true);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  const [showStudioProof, setShowStudioProof] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const [showBuyModal, setShowBuyModal] = useState(false);
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();

  // --- QuickQuote Estimator ---
  // Estimator is its own workspace. Two kinds of items land in it:
  //   1. The base WBTY pattern line — auto-added when the shop owner
  //      picks a pattern + sets yards. variantKey "wbty-base" so
  //      re-picking REPLACES the base; tweaking yards updates qty.
  //   2. Precision additions (chrome delete, carbon fiber roof,
  //      racing stripe, …) — added via upsell buttons inside the
  //      drawer. No variantKey, so they STACK without touching the
  //      base. Renders themselves don't touch the estimator.
  const estimator = useEstimator();
  const {
    setVehicle: setEstimatorVehicle,
    add: addEstimatorItem,
    setBaseRender: setEstimatorBaseRender,
    pushPrecisionMod: pushEstimatorPrecisionMod,
    clearPrecisionMods: clearEstimatorPrecisionMods,
  } = estimator;
  const wbtyBaseVariantKey = "wbty-base";

  useEffect(() => {
    setEstimatorVehicle({
      year: year || undefined,
      make: make || undefined,
      model: model || undefined,
    });
  }, [year, make, model, setEstimatorVehicle]);

  useEffect(() => {
    setEstimatorBaseRender(generatedImageUrl ?? null);
  }, [generatedImageUrl, setEstimatorBaseRender]);

  // --- Precision modifications (Phase 5c) ---
  // Stack chrome delete / carbon fiber roof / racing stripe / etc. on
  // top of the active render. Each click sends the displayed image
  // back to Gemini so mods compound visually.
  const [precisionRenderUrl, setPrecisionRenderUrl] = useState<string | null>(null);

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

  const effectiveDisplayUrl = precisionRenderUrl ?? generatedImageUrl;

  // Auto-add / auto-replace the base WBTY pattern line on pattern,
  // yards, finish, or pricePerYard change.
  useEffect(() => {
    if (!selectedProduct) return;
    const yards = Math.max(1, yardsNeeded || 1);
    const unitPrice = pricePerYard || 95.5;
    const finishLine = selectedFinish
      ? `${selectedFinish} finish · ${yards} yd`
      : `${yards} yd`;
    addEstimatorItem({
      id: `wbty_${Date.now().toString(36)}`,
      label: `WBTY — ${selectedProduct.name || "Pattern"}`,
      description: finishLine,
      qty: yards,
      unitPrice,
      unit: "yard",
      source: "render",
      variantKey: wbtyBaseVariantKey,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedProduct?.id,
    yardsNeeded,
    pricePerYard,
    selectedFinish,
    addEstimatorItem,
  ]);

  const persistWbtyEstimate = useCallback(
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
        vehicle: { year: state.vehicle.year, make: vehicleMake, model: vehicleModel },
        finish: selectedFinish || undefined,
        colorName: selectedProduct?.name || undefined,
        toolSource: "wbty",
        yardsNeeded: yardsNeeded || undefined,
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
        },
        visualizationId: visualizationId ?? null,
      });

      if (!result) {
        toast({
          title: "Couldn't save the estimate",
          description: "Please try again.",
          variant: "destructive",
        });
        return null;
      }

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
          description: "Add the customer's email and click Send again to dispatch.",
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
        description: "Customer also gets a link to the live estimate.",
      });
      return result.quoteId;
    },
    [toast, precisionRenderUrl, generatedImageUrl, selectedFinish, selectedProduct, yardsNeeded, visualizationId],
  );

  const handleEstimatorSaveDraft = useCallback(
    (state: EstimatorState) => { void persistWbtyEstimate(state, "draft"); },
    [persistWbtyEstimate],
  );
  const handleEstimatorSend = useCallback(
    (state: EstimatorState) => { void persistWbtyEstimate(state, "send"); },
    [persistWbtyEstimate],
  );
  // Phase 7 / Path B — only WPW shops see the WPW cart preview button.
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
    toast({ title: "Vehicle loaded", description: "Preloaded from render history — select a pattern and generate" });
  }, [preloadRender]); // eslint-disable-line react-hooks/exhaustive-deps

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
        setCurrentTipIndex(prev => (prev + 1) % PATTERNPRO_TIPS.length);
      }, 5000);
      return () => clearInterval(tipInterval);
    }
  }, [isGenerating, isRevising]);

  // Revision history for PatternPro
  const { revisionHistory, saveRevision } = useRevisionHistory('patternpro');

  // 360° Spin View Logic
  const {
    isGenerating: is360Generating,
    currentAngle: current360Angle,
    has360Spin,
    totalAngles,
    generate360Spin,
    clear360Spin,
    getSpinImagesArray
  } = use360SpinLogic({
    visualizationId,
    vehicleData: {
      year: year || '',
      make: make || '',
      model: model || '',
    },
    colorData: selectedProduct ? {
      colorName: selectedProduct.name,
      colorHex: '#000000',
      finish: selectedFinish,
      patternUrl: selectedProduct.media_url,
      mode_type: 'wbty'
    } : {
      colorName: '',
      colorHex: '#000000',
      finish: selectedFinish,
      mode_type: 'wbty'
    }
  });

  // Auto-show 360° viewer when generation completes
  useEffect(() => {
    if (has360Spin) {
      setShow360View(true);
      // Auto-scroll to 360° viewer section
      setTimeout(() => {
        const spinSection = document.getElementById('spin-viewer-section');
        if (spinSection) {
          spinSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 500);
    }
  }, [has360Spin]);

  // Pre-fill year/make/model from MyVehiclePro detection
  useEffect(() => {
    if (mvp.detectedVehicleInfo) {
      if (mvp.detectedVehicleInfo.make && !make) setMake(mvp.detectedVehicleInfo.make);
      if (mvp.detectedVehicleInfo.model && !model) setModel(mvp.detectedVehicleInfo.model);
      if (mvp.detectedVehicleInfo.year && !year) setYear(mvp.detectedVehicleInfo.year);
    }
  }, [mvp.detectedVehicleInfo]);

  // LOCKED PIPELINE: Auto-fire all views → 2D proof → artboard when hero render completes.
  // Resetting on isGenerating lets a re-Generate fire a fresh batch — without
  // it the latched ref blocked auto-fire for every render after the first.
  const autoFireRef = useRef(false);
  const hasAdditionalViews = !!additionalViews && Object.keys(additionalViews).length > 0;
  useEffect(() => {
    if (isGenerating) {
      autoFireRef.current = false;
      return;
    }
    if (generatedImageUrl && !hasAdditionalViews && !isGeneratingAdditional && !autoFireRef.current) {
      autoFireRef.current = true;
      generateAdditionalViews(year, make, model);
    }
    if (!generatedImageUrl) {
      autoFireRef.current = false;
    }
  }, [generatedImageUrl, hasAdditionalViews, isGeneratingAdditional, isGenerating]);

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
    if (!selectedProduct) {
      toast({ title: "No pattern selected", description: "Please select a pattern first", variant: "destructive" });
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
        setPaywallOpen(true);
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

    // ─── MyVehiclePro Mode: render ONLY on customer's uploaded photo ───
    if (mvp.isMyVehicleMode) {
      if (!mvp.hasPhotos) {
        toast({ title: "No photo uploaded", description: "Upload a photo of your vehicle first", variant: "destructive" });
        return;
      }
      if (!selectedProduct?.media_url) {
        toast({ title: "No pattern selected", description: "Select a pattern first, then generate on your vehicle", variant: "destructive" });
        return;
      }

      const colorData: Record<string, any> = {
        colorName: selectedProduct.name || "Custom Pattern",
        hex: "#808080",
        finish: (selectedFinish || "gloss").toLowerCase(),
        toolSource: "DesignPanelPro",
        panelName: selectedProduct.name || "Pattern",
        panelUrl: selectedProduct.media_url,
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
        toast({ title: "Applied to your vehicle!", description: "Pattern visualized on your photo.", duration: 4000 });
        document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        toast({ title: "Generation Failed", description: mvpError || "Please try again", variant: "destructive" });
      }
      return;
    }

    // ─── Studio Mode: generate studio render ───
    await generateRender(year, make, model);

    // Track both freemium and subscription usage
    if (!isPrivileged) {
      incrementFreemium();
    }
    if (subscription) {
      await incrementRenderCount();
    }
  };

  const handleRevisionSubmit = async (prompt: string) => {
    if (!selectedProduct || !year || !make || !model) return;
    const originalUrl = generatedImageUrl;
    setIsRevising(true);
    try {
      await generateRender(year, make, model, prompt);
      // Save revision to history
      if (generatedImageUrl) {
        await saveRevision({
          viewType: 'main',
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

  // Build overlay spec for PatternPro downloads
  const getPatternProOverlay = (): OverlaySpec => ({
    toolName: 'PatternPro',
    colorOrDesignName: selectedProduct?.name || undefined,
  });

  const handleDownload = async (imageUrl: string, filename: string) => {
    try {
      const overlay = getPatternProOverlay();
      // Remove .png extension from filename if present (downloadWithOverlay adds it)
      const cleanFilename = filename.replace(/\.png$/i, '');
      await downloadWithOverlay(imageUrl, cleanFilename, overlay);
      toast({ title: "Download started", description: `Downloading ${cleanFilename}.png` });
    } catch (error) {
      toast({ title: "Download failed", description: "Please try again", variant: "destructive" });
    }
  };

  const handleCalculateSquareFeet = async () => {
    if (!year || !make || !model) {
      toast({ title: "Vehicle required", description: "Please enter year, make, and model first", variant: "destructive" });
      return;
    }
    await calculateSquareFeet(year, make, model);
  };

  const handleAddToCart = () => {
    if (!selectedProduct) {
      toast({ title: "No pattern selected", description: "Please select a pattern first", variant: "destructive" });
      return;
    }
    window.open(`https://weprintwraps.com/cart/?add-to-cart=${productId}&quantity=${yardsNeeded}`, '_blank');
    toast({ title: "Added to Cart", description: `${yardsNeeded} yard(s) of ${selectedProduct.name} added to cart` });
  };

  const handleOrderFromPrintPro = () => {
    if (!selectedProduct) {
      toast({ title: "No pattern selected", description: "Please select a pattern first", variant: "destructive" });
      return;
    }
    // Save pattern context for purchase flow
    const patternContext = {
      productId: selectedProduct.id,
      patternName: selectedProduct.name,
      patternUrl: selectedProduct.media_url,
      patternCategory: selectedProduct.category,
      vehicleYear: year,
      vehicleMake: make,
      vehicleModel: model,
      finish: selectedFinish,
      renderUrl: generatedImageUrl,
      additionalViews: additionalViews
    };
    localStorage.setItem('patternpro-purchase-context', JSON.stringify(patternContext));
    window.open(`/printpro/wbty?pattern_id=${selectedProduct.id}`, '_self');
  };

  const handleSaveAndContinue = async () => {
    if (!generatedImageUrl || !selectedProduct) {
      toast({ title: "No render available", description: "Generate a 3D proof first", variant: "destructive" });
      return;
    }
    
    const savedJob = await saveDesignJob(year, make, model);
    if (savedJob) {
      toast({ title: "Design saved", description: "Redirecting to PrintPro..." });
      window.location.href = `/printpro?designId=${savedJob.id}&type=patternpro`;
    } else {
      toast({ title: "Save failed", description: "Please try again", variant: "destructive" });
    }
  };

  const handleViewOnVehicle = (product: any) => {
    const previewSection = document.getElementById('preview-section');
    if (previewSection) {
      previewSection.scrollIntoView({ behavior: 'smooth' });
    }
    toast({
      title: "Pattern Selected",
      description: `${product.name} ready to preview. Select vehicle and generate.`,
    });
  };

  return (
    <>
      <div className="w-full bg-background">
        <div className="bg-background">
          <div className="max-w-7xl mx-auto px-4">
            {/* Compact header */}
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-lg md:text-2xl tracking-wide">
                <span className="text-white font-bold">Pattern</span>
                <span className="bg-gradient-to-r from-purple-500 via-pink-500 to-purple-600 bg-clip-text text-transparent font-bold">Pro™</span>
              </h2>
              <div className="flex items-center gap-2 px-3 py-1 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <Rotate3D className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-medium text-blue-300">360°</span>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4">
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
              <Card className="bg-zinc-700 border-zinc-400 rounded-xl p-3 mb-3">
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Car className="w-4 h-4" />
                      <span className="text-sm font-semibold">Vehicle Details</span>
                    </div>
                    <ChevronDown className={cn("w-4 h-4 transition-transform", vehicleInputOpen && "rotate-180")} />
                  </div>
                </CollapsibleTrigger>

                <CollapsibleContent>
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
                      }}
                    />
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground mb-3">Select Your Vehicle</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
                    </>
                  )}
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </MyVehicleProToggle>

          {/* Main 2-Column Layout */}
          <Card className="bg-zinc-700 border-zinc-400 rounded-xl overflow-hidden">
            <div className="flex flex-col md:grid md:grid-cols-[350px_1fr] gap-0">
              {/* LEFT SIDEBAR - Swatches & Pricing */}
              <div className="bg-zinc-800 md:border-r border-zinc-500 p-4 space-y-4 md:max-h-[800px] md:overflow-y-auto">
                {/* Pattern Selection */}
                <Tabs value={uploadMode} onValueChange={(v) => setUploadMode(v as 'curated' | 'custom')}>
                  <TabsList className="grid w-full grid-cols-2 mb-4">
                    <TabsTrigger value="curated">Curated Library (92 Patterns)</TabsTrigger>
                    <TabsTrigger value="custom">Upload Custom</TabsTrigger>
                  </TabsList>
                  <TabsContent value="curated">
                    <WrapByTheYardMode
                      selectedProduct={selectedProduct}
                      onProductSelect={(product) => {
                        setSelectedProduct(product);
                        handleViewOnVehicle(product);
                      }}
                      yardsNeeded={yardsNeeded}
                      onYardsChange={setYardsNeeded}
                      pricePerYard={pricePerYard}
                      patternScale={patternScale}
                      onPatternScaleChange={setPatternScale}
                    />
                  </TabsContent>
                  <TabsContent value="custom">
                    <WBTYPatternUploader onPatternUploaded={setSelectedProduct} />
                  </TabsContent>
                </Tabs>

                {/* Tech Specs */}
                <Collapsible defaultOpen={false}>
                  <Card className="p-4 bg-zinc-800 border-zinc-600">
                    <CollapsibleTrigger className="w-full">
                      <h4 className="text-sm font-semibold mb-3 flex items-center justify-between">
                        <span>Tech Specs</span>
                        <span className="text-primary font-bold text-lg">${pricePerYard.toFixed(2)}/yard</span>
                      </h4>
                    </CollapsibleTrigger>
                    
                    <CollapsibleContent>
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        <div className="text-center p-2 bg-background/50 rounded-lg">
                          <Package className="h-6 w-6 mx-auto mb-1 text-muted-foreground" />
                          <p className="text-[9px] text-muted-foreground mb-0.5">BASE FILM</p>
                          <p className="text-xs font-semibold">Cast Vinyl</p>
                          <p className="text-[9px]">Premium Print</p>
                        </div>
                        <div className="text-center p-2 bg-background/50 rounded-lg">
                          <Ruler className="h-6 w-6 mx-auto mb-1 text-muted-foreground" />
                          <p className="text-[9px] text-muted-foreground mb-0.5">WIDTH</p>
                          <p className="text-lg font-bold">60"</p>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>

                {/* Yards Guide */}
                <Card className="p-4 bg-zinc-800 border-zinc-600">
                  <h4 className="text-sm font-semibold mb-3">How Many Yards?</h4>
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        View Yards Guide
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-3xl">
                      <DialogHeader>
                        <DialogTitle>Wrap By The Yard - Yards Guide</DialogTitle>
                      </DialogHeader>
                      <div className="mt-4">
                        <img 
                          src="/wbty-yards-guide.jpg" 
                          alt="How Many Yards Do I Need Guide" 
                          className="w-full h-auto rounded-lg"
                        />
                      </div>
                    </DialogContent>
                  </Dialog>
                </Card>

                {/* Vehicle Selection Summary */}
                <Card className="p-4 bg-zinc-800 border-zinc-600">
                  <h4 className="text-sm font-semibold mb-3">Vehicle Selection</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Vehicle:</span>
                      <span className="text-sm font-medium">{year && make && model ? `${year} ${make} ${model}` : "Not selected"}</span>
                    </div>
                    <p className="text-xs text-muted-foreground pt-2 border-t border-border">
                      WBTY™ pricing is by the yard at $95.50/yard.
                    </p>
                  </div>
                </Card>

                {/* Quantity */}
                <Card className="p-4 bg-zinc-800 border-zinc-600">
                  <h4 className="text-sm font-semibold mb-3">Yards Needed</h4>
                  <div className="flex items-center gap-3">
                    <Button variant="outline" size="icon" onClick={() => setYardsNeeded(Math.max(1, yardsNeeded - 1))} className="h-11 w-11">-</Button>
                    <div className="flex-1 text-center">
                      <p className="text-2xl font-bold">{yardsNeeded}</p>
                      <p className="text-xs text-muted-foreground">yard{yardsNeeded !== 1 ? 's' : ''}</p>
                    </div>
                    <Button variant="outline" size="icon" onClick={() => setYardsNeeded(yardsNeeded + 1)} className="h-11 w-11">+</Button>
                  </div>
                </Card>

                {/* Pricing Summary */}
                <Card className="p-4 bg-primary/10 border-primary/20">
                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Product ID:</span>
                      <span className="font-semibold">{productId}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Price per Yard:</span>
                      <span className="font-semibold">${pricePerYard.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-sm text-muted-foreground">Yards Needed:</span>
                      <span className="font-semibold">{yardsNeeded}</span>
                    </div>
                    <div className="flex justify-between items-center text-lg font-bold border-t border-border pt-2 mt-2">
                      <span>Total Price:</span>
                      <span className="text-primary">${totalPrice.toFixed(2)}</span>
                    </div>
                  </div>
                </Card>

                {/* Action Buttons */}
                <div className="space-y-3">
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
                  
                  <Button 
                    onClick={handleAddToCart}
                    className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                    size="lg"
                    disabled={!selectedProduct}
                    variant={generatedImageUrl ? "outline" : "default"}
                  >
                    {generatedImageUrl ? "Add to Cart" : "Add to Cart"}
                  </Button>
                </div>

                {/* Generations info removed - unlimited generations */}
              </div>

              {/* RIGHT SIDE - Large Preview */}
              <div id="preview-section" className="p-6 bg-background min-h-[600px] space-y-4">
                {/* Finish Selection Buttons */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Select Lamination Finish</Label>
                  <div className="grid grid-cols-3 gap-2">
                    <Button
                      variant={selectedFinish === "gloss" ? "default" : "outline"}
                      onClick={() => setSelectedFinish("gloss")}
                      className="min-h-[44px]"
                    >
                      Gloss
                    </Button>
                    <Button
                      variant={selectedFinish === "satin" ? "default" : "outline"}
                      onClick={() => setSelectedFinish("satin")}
                      className="min-h-[44px]"
                    >
                      Satin
                    </Button>
                    <Button
                      variant={selectedFinish === "matte" ? "default" : "outline"}
                      onClick={() => setSelectedFinish("matte")}
                      className="min-h-[44px]"
                    >
                      Matte
                    </Button>
                  </div>
                </div>

                {/* Pattern Scale Control */}
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">Pattern Scale</Label>
                  <div className="space-y-2">
                    <input
                      type="range"
                      min="0.8"
                      max="1.2"
                      step="0.05"
                      value={patternScale}
                      onChange={(e) => setPatternScale(parseFloat(e.target.value))}
                      className="w-full"
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Smaller</span>
                      <span className="font-semibold">{((patternScale - 1) * 100).toFixed(0)}%</span>
                      <span>Larger</span>
                    </div>
                  </div>
                </div>

                {/* Generate Button Above Preview */}
                <Button
                  onClick={handleGenerate}
                  className="w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                  size="lg"
                  disabled={!selectedProduct || !year || !make || !model || (isGenerating || mvpIsGenerating)}
                >
                {(isGenerating || mvpIsGenerating)
                  ? mvpIsGenerating ? "Visualizing on My Vehicle..." : "Generating..."
                  : mvp.isMyVehicleMode && mvp.hasPhotos
                    ? "Visualize on My Vehicle"
                    : "Generate 3D Proof"}
                </Button>

                {/* Generation Wizard with Sproket — right after button so it's visible */}
                {(isGenerating || (mvpIsGenerating && mvpMultiViewResults.length === 0)) && (
                  <GenerationWizard
                    isGenerating={isGenerating || mvpIsGenerating}
                    elapsedSeconds={elapsedSeconds}
                    tips={PATTERNPRO_TIPS}
                    currentTipIndex={currentTipIndex}
                    toolName={mvpIsGenerating ? "MyVehiclePro" : "Pattern"}
                    gradientFrom="from-purple-500"
                    gradientTo="to-pink-500"
                    colorProShowcase
                  />
                )}

                {/* Buy CTA — visible after a render exists */}
                {generatedImageUrl && selectedProduct && (
                  <Button
                    onClick={() => setShowBuyModal(true)}
                    className="w-full bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 mt-2"
                    size="lg"
                  >
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    Buy This Wrap — Printed or Design File
                  </Button>
                )}

                {/* MyVehiclePro Result Display — progressive loading */}
                {(mvpEditedImageUrl && mvpBeforeUrl) && (
                  <Card className="overflow-hidden bg-zinc-800 border-blue-400 p-4 space-y-3">
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
                              swatchImageUrl={selectedProduct?.media_url}
                              swatchName={selectedProduct?.name}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <BeforeAfterViewer
                        beforeUrl={mvpBeforeUrl}
                        afterUrl={mvpEditedImageUrl}
                        beforeLabel="Your Vehicle"
                        afterLabel={selectedProduct?.name || "Pattern Wrap"}
                        swatchImageUrl={selectedProduct?.media_url}
                        swatchName={selectedProduct?.name}
                      />
                    )}
                    <Button
                      onClick={() => { clearMyVehicleResults(); }}
                      variant="outline"
                      size="sm"
                      className="w-full"
                    >
                      <RotateCw className="w-3 h-3 mr-1.5" /> Try Another Photo
                    </Button>
                  </Card>
                )}

                {/* Generation Wizard moved above preview — see after generate button */}
                {!has360Spin && generatedImageUrl && false && (
                  <div className="flex justify-center -mb-2">
                    <span className="text-xs text-blue-400 animate-bounce flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Export for Instagram Reels!
                    </span>
                  </div>
                )}

              {/* 360° Spin View Button - hidden */}
              {false && generatedImageUrl && (
                <Button
                  onClick={generate360Spin}
                  disabled={is360Generating || has360Spin}
                  className={cn(
                    "w-full gap-2 transition-all duration-300 relative",
                    is360Generating && "btn-360-glow-generating animate-pulse",
                    !has360Spin && !is360Generating && generatedImageUrl && "btn-360-glow border-0 animate-pulse shadow-lg shadow-blue-500/50"
                  )}
                  size="lg"
                >
                  <Rotate3D className={cn("w-5 h-5", !has360Spin && !is360Generating && "icon-360-glow")} />
                  <span className="font-semibold">
                    {is360Generating ? "Generating 360° Spin..." : has360Spin ? "✓ 360° View Ready" : "Generate 360° Spin View"}
                  </span>
                  {!has360Spin && !is360Generating && (
                    <Badge variant="secondary" className="absolute -top-2 -right-2 bg-blue-500 text-white text-xs px-2">NEW</Badge>
                  )}
                </Button>
              )}
                <p className="text-xs text-center text-muted-foreground -mt-1 hidden">
                  {!generatedImageUrl
                    ? "Generate a render first to enable 360°"
                    : has360Spin
                      ? "✓ 12 angles ready • Drag to rotate • Export for Reels"
                      : "12 angles • ~2 min • Export for Reels"
                  }
                </p>

                {/* Generate All Views Button - Always visible but disabled until first generation */}
                <Button
                  onClick={handleGenerateAdditionalViews}
                  variant="outline"
                  size="lg"
                  className="w-full"
                  disabled={!generatedImageUrl || isGenerating || isGeneratingAdditional || is360Generating}
                >
                  {isGeneratingAdditional ? "Generating Views..." : "Generate All Views (Side, Rear, Top, Close-Up)"}
                </Button>

                {/* 360° Loading State - hidden */}
                {false && is360Generating && (
                  <Vehicle360LoadingState
                    totalAngles={totalAngles}
                    currentAngle={current360Angle}
                    onCancel={clear360Spin}
                  />
                )}

                {/* 360° Viewer with Toggle - hidden */}
                {false && has360Spin && (
                  <Card id="spin-viewer-section" className="p-4 bg-zinc-800 border-zinc-600">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-semibold flex items-center gap-2">
                        <RotateCw className="w-4 h-4" />
                        360° Spin View
                      </h4>
                      <div className="flex gap-2">
                        <Button 
                          variant={show360View ? "default" : "outline"}
                          size="sm"
                          onClick={() => setShow360View(true)}
                        >
                          360° View
                        </Button>
                        <Button 
                          variant={!show360View ? "default" : "outline"}
                          size="sm"
                          onClick={() => setShow360View(false)}
                        >
                          Standard Views
                        </Button>
                      </div>
                    </div>
                    
                    {show360View && (
                      <Vehicle360Viewer
                        images={getSpinImagesArray()}
                        autoRotate={false}
                        showAngleIndicator={true}
                        vehicleName={`${year} ${make} ${model}`}
                        designName={selectedProduct?.name || 'Pattern'}
                      />
                    )}
                  </Card>
                )}
                
                {/* Status hints removed — tool controls are self-explanatory */}
                
                {/* Preview Section - only shown when render exists */}
                {selectedProduct && !show360View && generatedImageUrl && !isGenerating && (
                  <div>
                    <Card className="p-6 bg-zinc-700 border-zinc-400 h-full relative">
                  <div className="h-full flex flex-col gap-4">
                    {generatedImageUrl ? (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold">Hero View</p>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDownload(generatedImageUrl, `${selectedProduct?.name || 'wbty'}-hero-${selectedFinish}.png`)}
                            >
                              <Download className="w-4 h-4 mr-2" />
                              Download
                            </Button>
                          </div>
                          <div 
                            className="flex-1 flex items-center justify-center cursor-pointer rounded-lg overflow-hidden bg-black aspect-video relative"
                            onClick={() => setExpandedImage({ url: effectiveDisplayUrl ?? generatedImageUrl, title: `${year} ${make} ${model} - ${selectedProduct?.name} - Hero View` })}
                          >
                            <img
                              src={effectiveDisplayUrl ?? generatedImageUrl}
                              alt="Generated 3D Proof"
                              className="w-full h-full object-contain"
                            />
                            {/* Tool branding overlay */}
                            <RenderOverlay
                              toolName="PatternPro"
                              colorOrDesignName={selectedProduct?.name || 'Custom Pattern'}
                            />
                          </div>
                        </div>

                        {/* Precision modifications — stack chrome
                            delete / carbon fiber roof / racing stripe
                            / etc. on top of the active render. */}
                        <PrecisionModButtons
                          tool="wbty"
                          currentRenderUrl={effectiveDisplayUrl}
                          onApplied={handlePrecisionApplied}
                          onError={handlePrecisionError}
                        />

                        {precisionRenderUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setPrecisionRenderUrl(null);
                              clearEstimatorPrecisionMods();
                            }}
                            className="w-full text-xs text-muted-foreground hover:text-foreground"
                          >
                            <RotateCw className="w-3 h-3 mr-1.5" />
                            Reset to original render (estimate line items kept)
                          </Button>
                        )}
                        
                        {/* Feedback Rating & Mark as Perfect - Bottom Right */}
                        {selectedProduct && visualizationId && (
                          <div className="absolute bottom-4 right-4 z-10 flex items-center gap-2">
                            <MarkAsPerfectButton
                              promptSignature={`patternpro-${selectedProduct.name}-${patternScale}-${selectedFinish}`}
                              vehicleSignature={`${year}-${make}-${model}`}
                              renderUrls={additionalViews ? { roof: generatedImageUrl, ...additionalViews } : { roof: generatedImageUrl }}
                              sourceVisualizationId={visualizationId}
                            />
                            <RenderQualityRating 
                              renderId={visualizationId}
                              renderType="wbty"
                              renderUrl={generatedImageUrl}
                            />
                          </div>
                        )}
                        
                        {/* MyVehiclePro inline — try this pattern on YOUR vehicle */}
                        {!mvp.isMyVehicleMode && (
                          <MyVehicleProInline
                            modeType="wbty"
                            colorName={selectedProduct?.name}
                            finishType={selectedFinish}
                            vehicleYear={year}
                            vehicleMake={make}
                            vehicleModel={model}
                            renderUrl={generatedImageUrl}
                            compact
                          />
                        )}

                        {/* Generate Customer Approval Proof Buttons.
                            Each button surfaces the exact pattern name + yard
                            count that will be on the proof sheet, so the
                            installer sees what's about to print/share. */}
                        <div className="flex flex-col sm:flex-row gap-2 mt-4">
                          <Button
                            variant="outline"
                            onClick={() => setShow2DProofSheet(true)}
                            className="flex-1 h-auto py-2.5 flex-col items-center gap-0.5"
                            disabled={!year || !make || !model}
                          >
                            <span className="flex items-center gap-2 font-semibold">
                              <ClipboardSignature className="w-4 h-4" />
                              2D Proof
                            </span>
                            <span className="text-[11px] font-normal text-muted-foreground leading-tight">
                              {selectedProduct?.name || 'Custom Pattern'} · {yardsNeeded} yard{yardsNeeded !== 1 ? 's' : ''}
                            </span>
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setShowProofSheet(true)}
                            className="flex-1 h-auto py-2.5 flex-col items-center gap-0.5"
                            disabled={!year || !make || !model}
                          >
                            <span className="flex items-center gap-2 font-semibold">
                              <ClipboardSignature className="w-4 h-4" />
                              3D Proof
                            </span>
                            <span className="text-[11px] font-normal text-muted-foreground leading-tight">
                              {selectedProduct?.name || 'Custom Pattern'} · {yardsNeeded} yard{yardsNeeded !== 1 ? 's' : ''}
                            </span>
                          </Button>
                        </div>

                        {/* Revision: on-page for hero only, RevisionStudio after all views */}
                        {additionalViews ? (
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
                            disabled={!generatedImageUrl || !selectedProduct || !year || !make || !model}
                          />
                        )}

                        {/* QuickQuote — pricing by sq ft */}
                        {year && make && model && (
                          <>
                            <DesignProductsCompareCard className="my-2" />
                            <Button
                            onClick={() => navigate("/quick-quote", {
                              state: {
                                year, make, model,
                                finish: selectedFinish,
                                colorName: selectedProduct?.name || "",
                                manufacturer: "PatternPro",
                                colorHex: (selectedProduct as any)?.hex || "",
                                toolSource: "PatternPro",
                                renderUrl: generatedImageUrl,
                                visualizationId: visualizationId || null,
                              },
                            })}
                            className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90 text-white font-bold mt-3"
                          >
                            <Calculator className="w-4 h-4 mr-2" />
                            Open QuickQuote — Sq Ft Pricing & Quote
                          </Button>
                          </>
                        )}

                        {/* Production Pack & Cut Files - route to ProductionFlow */}
                        <div className="space-y-2 mt-3">
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
                                  render_urls: additionalViews ? { roof: generatedImageUrl || "", ...additionalViews } : { roof: generatedImageUrl || "" },
                                  vehicle_year: year,
                                  vehicle_make: make,
                                  vehicle_model: model,
                                  design_name: selectedProduct?.name || "WBTY Design",
                                },
                              },
                            })}
                          >
                            <Scissors className="w-4 h-4 mr-2" /> Generate Cut Contour Logo Pack
                          </Button>
                        </div>

                        {/* Revision History Timeline */}
                        {revisionHistory.length > 0 && (
                          <RevisionHistoryTimeline
                            history={revisionHistory}
                            onSelect={(item) => {
                              if (item.revised_url) {
                                setExpandedImage({ url: item.revised_url, title: `Revision: ${item.revision_prompt}` });
                              }
                            }}
                            className="mt-4"
                          />
                        )}
                        
                        {showAdditionalViews && additionalViews && (
                          <div className={cn("grid gap-4 mt-4", isMobile ? "grid-cols-1" : "grid-cols-2")}>
                            {[
                              { key: 'passenger-side', label: 'Passenger Side' },
                              { key: 'hood_detail', label: 'Hood Detail' },
                              { key: 'front', label: 'Front View' },
                              { key: 'rear', label: 'Rear View' },
                              { key: 'close-up', label: 'Close-Up Detail' },
                              { key: 'roof', label: 'Roof View' },
                            ].filter(v => (additionalViews as Record<string, string>)[v.key]).map(({ key, label }) => (
                              <div key={key} className="space-y-2">
                                <div className="flex items-center justify-between mb-1">
                                  <p className="text-xs text-muted-foreground">{label}</p>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleDownload((additionalViews as Record<string, string>)[key], `${selectedProduct?.name || 'wbty'}-${key}-${selectedFinish}.png`)}
                                    className="h-6 px-2"
                                  >
                                    <Download className="w-3 h-3" />
                                  </Button>
                                </div>
                                <div className="cursor-pointer" onClick={() => setExpandedImage({ url: (additionalViews as Record<string, string>)[key], title: `${year} ${make} ${model} - ${selectedProduct?.name} - ${label}` })}>
                                  <img
                                    src={(additionalViews as Record<string, string>)[key]}
                                    alt={label}
                                    className="w-full h-auto object-contain rounded-lg border border-border"
                                  />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    ) : selectedProduct ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="text-center">
                          <img 
                            src={selectedProduct.media_url} 
                            alt={selectedProduct.name}
                            className="max-w-full max-h-[500px] object-contain rounded-lg mb-4"
                          />
                          <p className="text-sm text-muted-foreground">Pattern preview - Generate to see on vehicle</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-center text-muted-foreground">
                        <div>
                          <p className="text-lg mb-2">No pattern selected</p>
                          <p className="text-sm">Select a pattern to preview it here</p>
                        </div>
                      </div>
                      )}
                    </div>
                  </Card>
                  </div>
                )}
              </div>
            </div>
          </Card>
        </div>
      </div>

      <PaywallModal 
        open={paywallOpen}
        onClose={() => setPaywallOpen(false)}
        onShowExample={() => setShowFallback(true)}
        productType="wbty"
      />

      <SocialEngagementModal
        open={socialModalOpen}
        onClose={() => setSocialModalOpen(false)}
        onUnlock={unlockBonus}
      />

      {/* Fullscreen Image Modal */}
      <MobileZoomImageModal
        imageUrl={expandedImage?.url || ''}
        title={expandedImage?.title}
        isOpen={!!expandedImage}
        onClose={() => setExpandedImage(null)}
      />

      {/* Professional Proof Sheet Dialog */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className={isMobile ? "max-w-[95vw] max-h-[95vh] overflow-y-auto p-0" : "max-w-6xl max-h-[95vh] overflow-y-auto"}>
          {isMobile ? (
            <MobileProofSheet
              views={[
                ...(additionalViews?.side ? [{ type: 'side', url: additionalViews.side, label: 'Driver Side' }] : []),
                ...((additionalViews as any)?.['passenger-side'] ? [{ type: 'passenger-side', url: (additionalViews as any)['passenger-side'], label: 'Passenger Side' }] : []),
                ...((additionalViews as any)?.hood_detail ? [{ type: 'hood_detail', url: (additionalViews as any).hood_detail, label: 'Hood' }] : []),
                ...((additionalViews as any)?.front ? [{ type: 'front', url: (additionalViews as any).front, label: 'Front' }] : []),
                ...(additionalViews?.rear ? [{ type: 'rear', url: additionalViews.rear, label: 'Rear View' }] : []),
                ...(additionalViews?.closeup ? [{ type: 'close-up', url: additionalViews.closeup, label: 'Close-Up' }] : []),
                ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof View' }] : []),
              ]}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolKey="wbty"
              designName={selectedProduct?.name || 'Custom Pattern'}
              finish={selectedFinish}
              coverageUnit="yards"
            />
          ) : (
            <ProfessionalProofSheet
              views={[
                ...(additionalViews?.side ? [{ type: 'side', url: additionalViews.side, label: 'Driver Side' }] : []),
                ...((additionalViews as any)?.['passenger-side'] ? [{ type: 'passenger-side', url: (additionalViews as any)['passenger-side'], label: 'Passenger Side' }] : []),
                ...((additionalViews as any)?.hood_detail ? [{ type: 'hood_detail', url: (additionalViews as any).hood_detail, label: 'Hood' }] : []),
                ...((additionalViews as any)?.front ? [{ type: 'front', url: (additionalViews as any).front, label: 'Front' }] : []),
                ...(additionalViews?.rear ? [{ type: 'rear', url: additionalViews.rear, label: 'Rear View' }] : []),
                ...(additionalViews?.closeup ? [{ type: 'close-up', url: additionalViews.closeup, label: 'Close-Up' }] : []),
                ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof View' }] : []),
              ]}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolName="PatternPro™"
              designName={selectedProduct?.name || 'Custom Pattern'}
              finish={selectedFinish}
              coverageUnit="yards"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 2D Proof Sheet Dialog */}
      <Dialog open={show2DProofSheet} onOpenChange={setShow2DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          <TwoDProofSheet
            views={[
              ...(additionalViews?.side ? [{ type: 'side', url: additionalViews.side, label: 'Driver Side' }] : []),
              ...((additionalViews as any)?.['passenger-side'] ? [{ type: 'passenger-side', url: (additionalViews as any)['passenger-side'], label: 'Passenger Side' }] : []),
              ...((additionalViews as any)?.front ? [{ type: 'front', url: (additionalViews as any).front, label: 'Front' }] : []),
              ...(additionalViews?.rear ? [{ type: 'rear', url: additionalViews.rear, label: 'Rear' }] : []),
              ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
            ]}
            vehicleYear={year}
            vehicleMake={make}
            vehicleModel={model}
            toolKey="wbty"
            designName={selectedProduct?.name || 'Custom Pattern'}
            finish={selectedFinish}
          />
        </DialogContent>
      </Dialog>

      {/* Sticky 360° Button for Mobile - hidden */}
      {false && isMobile && generatedImageUrl && !has360Spin && !is360Generating && (
        <div className="fixed bottom-0 left-0 right-0 z-40 p-4 bg-gradient-to-t from-background to-transparent">
          <Button
            onClick={generate360Spin}
            className="w-full btn-360-glow border-0 gap-2"
            size="lg"
          >
            <Rotate3D className="w-5 h-5" />
            Generate 360° Spin View
          </Button>
        </div>
      )}
      
      <UpgradeRequired
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        requiredTier="advanced"
        featureName="Wrap By The Yard™"
      />

      {/* Production Pack Dialog */}
      <ProductionPackDialog
        open={showProductionDialog}
        onOpenChange={setShowProductionDialog}
        render={visualizationId ? {
          id: visualizationId,
          render_urls: additionalViews ? { roof: generatedImageUrl || "", ...additionalViews } : { roof: generatedImageUrl || "" },
          vehicle_year: year,
          vehicle_make: make,
          vehicle_model: model,
          design_file_name: selectedProduct?.name,
          finish_type: selectedFinish,
        } : null}
      />

      <BuyPatternModal
        open={showBuyModal}
        onOpenChange={setShowBuyModal}
        pattern={selectedProduct ? {
          id: selectedProduct.id,
          name: selectedProduct.ai_generated_name || selectedProduct.name,
          media_url: selectedProduct.media_url,
          category: selectedProduct.category,
        } : null}
        vehicle={{ year, make, model }}
        finish={selectedFinish}
        renderUrl={generatedImageUrl}
        additionalViews={additionalViews}
      />

      {/* Studio Proof Layout (3D Proof Viewer) */}
      <StudioProofLayout
        toolName="WBTY™"
        designName={designName || selectedProduct?.name || 'Custom Pattern'}
        vehicleInfo={{ year, make, model }}
        views={[
          ...(additionalViews?.side ? [{ type: 'side', url: additionalViews.side, label: 'Driver Side' }] : []),
          ...((additionalViews as any)?.['passenger-side'] ? [{ type: 'passenger-side', url: (additionalViews as any)['passenger-side'], label: 'Passenger Side' }] : []),
          ...((additionalViews as any)?.hood_detail ? [{ type: 'hood_detail', url: (additionalViews as any).hood_detail, label: 'Hood' }] : []),
          ...((additionalViews as any)?.front ? [{ type: 'front', url: (additionalViews as any).front, label: 'Front' }] : []),
          ...(additionalViews?.rear ? [{ type: 'rear', url: additionalViews.rear, label: 'Rear' }] : []),
          ...(additionalViews?.closeup ? [{ type: 'close-up', url: additionalViews.closeup, label: 'Close-Up' }] : []),
          ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof View' }] : []),
        ]}
        isOpen={showStudioProof}
        onClose={() => setShowStudioProof(false)}
        finish={selectedFinish}
        coverageUnit="yards"
      />

      {/* Legacy upsell estimator pill — bottom-right corner, kept for
          the upsell / catalog / manual-line workflow. */}
      <div className="fixed bottom-6 right-6 z-40">
        <EstimatorDrawer
          value={estimator.state}
          onChange={estimator.setState}
          onSaveDraft={handleEstimatorSaveDraft}
          onSend={handleEstimatorSend}
          onCheckoutOnWpw={isWpwShop ? handleEstimatorCheckoutOnWpw : undefined}
          trigger={
            <OpenEstimatorButton
              state={estimator.state}
              label="Estimator"
              className="h-11 px-4 shadow-lg shadow-black/40 backdrop-blur-sm"
            />
          }
        />
      </div>

      {/* Persistent floating QuickQuote pill — opens the branded
          "QuickQuote × PatternPro" sidebar (matches the other tools).
          Stacked ABOVE the legacy Estimator pill so the two
          bottom-right floating actions don't overlap. */}
      {!showQuickQuote && (
        <button
          type="button"
          onClick={() => setShowQuickQuote(true)}
          aria-label="Open QuickQuote"
          className="fixed right-4 sm:right-6 z-40 flex items-center gap-2 rounded-full px-4 sm:px-5 py-3 text-sm font-bold text-white shadow-[0_8px_24px_rgba(168,85,247,0.45)] hover:opacity-95 active:scale-95 transition"
          style={{
            background: "linear-gradient(135deg, #2563eb, #a855f7)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)",
          }}
        >
          <Calculator className="w-4 h-4" />
          <span className="hidden sm:inline">QuickQuote</span>
        </button>
      )}

      {/* QuickQuote × PatternPro side panel — same dashboard QuickQuoteCard
          the other tools use, pre-seeded with vehicle + render. */}
      <QuickQuoteSidePanel
        open={showQuickQuote}
        onClose={() => setShowQuickQuote(false)}
        toolName="PatternPro"
      >
        <QuickQuoteCard
          initial={{
            year: year || undefined,
            make: make || undefined,
            model: model || undefined,
            finish: selectedFinish || "Gloss",
            designName: designName || undefined,
            renderUrl: precisionRenderUrl ?? generatedImageUrl ?? undefined,
          }}
        />
      </QuickQuoteSidePanel>
    </>
  );
};
