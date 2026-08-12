import { useToast } from "@/hooks/use-toast";
import { useColorProLogic } from "@/hooks/useColorProLogic";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ManufacturerColorBrowser } from "@/components/colorpro/ManufacturerColorBrowser";
import { VinylInputMode } from "@/components/tools/modes/VinylInputMode";
import { ColorProToolCore } from "@/components/tools/ColorProToolCore";
import { PaywallModal } from "@/components/PaywallModal";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { RenderQualityRating } from "@/components/RenderQualityRating";
import { MarkAsPerfectButton } from "@/components/MarkAsPerfectButton";
import { MobileZoomImageModal } from "@/components/visualize/MobileZoomImageModal";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { QuickQuoteCard } from "@/components/dashboard/QuickQuoteCard";
import { QuickQuoteSidePanel } from "@/components/quote/QuickQuoteSidePanel";
import { PrintProCTAButton } from "@/components/PrintProCTAButton";
import { SendForApprovalDialog } from "@/components/proof/SendForApprovalDialog";
import { EstimatorDrawer, OpenEstimatorButton } from "@/components/quote/EstimatorDrawer";
import { useEstimator } from "@/hooks/useEstimator";
import { lineItemFromProduct, type EstimatorState } from "@/lib/quote-estimator";
import { findProductById } from "@/lib/quote-product-catalog";
import { PrecisionModButtons } from "@/components/quote/PrecisionModButtons";
import type { PrecisionModification, PrecisionModResult } from "@/hooks/usePrecisionModifications";
import { saveQuote } from "@/lib/quickquote-db";
import { nextOrderNumber } from "@/lib/bulk-prompt-generator";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { MobileProofSheet } from "@/components/tools/MobileProofSheet";
import { TwoDProofSheet } from "@/components/tools/TwoDProofSheet";
import { DesignRevisionPrompt } from "@/components/tools/DesignRevisionPrompt";
import { useRevisionHistory } from "@/hooks/useRevisionHistory";
import { StudioProofLayout } from "@/components/tools/StudioProofLayout";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  SERVICE_CATEGORIES,
  ADD_ONS,
  type ServiceCategory,
  type AddOnId,
} from "@/lib/quick-quote";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Layers, X, ChevronDown, RefreshCw, Database, Lightbulb, ClipboardSignature, Car, Upload, Check, Sparkles, Palette, StretchHorizontal, Ban, Circle, Moon, Square, Camera, Mail, Scissors, Loader2, Calculator } from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import { EmailConfigurator } from "@/components/tools/EmailConfigurator";
import { QuickQuoteEditor } from "@/components/tools/QuickQuoteEditor";
import type { InkFusionColor } from "@/lib/restyleproai-colors";
import { cn } from "@/lib/utils";
import { GenerationWizard, COLORPRO_TIPS } from "@/components/tools/GenerationWizard";
import { VehicleAutocomplete } from "@/components/tools/VehicleAutocomplete";
import { VehicleTypeSelector, isNonStandardVehicle } from "@/components/tools/VehicleTypeSelector";
import { NonStandardVehicleWarning } from "@/components/tools/NonStandardVehicleWarning";
import { NonStandardVehicleLookup } from "@/components/tools/NonStandardVehicleLookup";
import { sqFtToYards } from "@/lib/quick-quote";
import { useIsMobile } from "@/hooks/use-mobile";
import { Badge } from "@/components/ui/badge";
import { ProofPreviewCard } from "@/components/tools/ProofPreviewCard";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { MyVehicleProToggle } from "@/components/tools/MyVehicleProToggle";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { useMyVehicleMode } from "@/hooks/useMyVehicleMode";
import { useMyVehicleGenerate } from "@/hooks/useMyVehicleGenerate";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";

interface ColorProToolUIProps {
  preloadRenderId?: string | null;
  autoOpenQuickQuote?: boolean;
}

export const ColorProToolUI = ({ preloadRenderId, autoOpenQuickQuote }: ColorProToolUIProps = {}) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const [vehicleSqFt, setVehicleSqFt] = useState(0);
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();
  const { subscription, checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const {
    selectedSwatch,
    setSelectedSwatch,
    selectedFinish,
    setSelectedFinish,
    vehicleType,
    setVehicleType,
    nonStandardSpecs,
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
    isGeneratingAdditional,
    clearLastRender,
    showUpgradeModal,
    setShowUpgradeModal,
    vinylSwatches,
    pendingViews,
    regenerateSingleView,
    loadRenderById,
  } = useColorProLogic();

  // Phase 2 Rank 2 — revision capture for the ColorPro pipeline (this
  // surface previously logged nothing; sister tools already do).
  const { saveRevision } = useRevisionHistory('colorpro');

  // MyVehiclePro state
  const mvp = useMyVehicleMode();
  const { mvpIsGenerating, mvpEditedImageUrl, mvpBeforeUrl, mvpMultiViewResults, mvpError, generateOnMyVehicle, clearMyVehicleResults } = useMyVehicleGenerate();

  // Load a specific render when preloadRenderId is provided via URL
  const [hasPreloaded, setHasPreloaded] = useState(false);
  useEffect(() => {
    if (preloadRenderId && !hasPreloaded) {
      setHasPreloaded(true);
      loadRenderById(preloadRenderId);
    }
  }, [preloadRenderId, hasPreloaded]);


  // Pre-fill year/make/model from vehicle detection
  useEffect(() => {
    if (mvp.detectedVehicleInfo) {
      if (mvp.detectedVehicleInfo.make && !make) setMake(mvp.detectedVehicleInfo.make);
      if (mvp.detectedVehicleInfo.model && !model) setModel(mvp.detectedVehicleInfo.model);
      if (mvp.detectedVehicleInfo.year && !year) setYear(mvp.detectedVehicleInfo.year);
    }
  }, [mvp.detectedVehicleInfo]);

  const [paywallOpen, setPaywallOpen] = useState(false);
  const [exampleImageUrl, setExampleImageUrl] = useState<string | null>(null);
  const [yearError, setYearError] = useState(false);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const [isColorSectionOpen, setIsColorSectionOpen] = useState(true);
  const [selectedColorMode, setSelectedColorMode] = useState<'upload' | 'manual' | 'database'>('database');
  const [selectedViewType] = useState<'side'>('side');
  const [expandedImage, setExpandedImage] = useState<{ url: string; title: string } | null>(null);
  const [vehicleInputOpen, setVehicleInputOpen] = useState(true);
  const [pullToRefreshActive, setPullToRefreshActive] = useState(false);
  const [highlightColorSection, setHighlightColorSection] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [showSendForApproval, setShowSendForApproval] = useState(false);
  const [showStudioProof, setShowStudioProof] = useState(false);
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  const [mvpHeroView, setMvpHeroView] = useState(0);
  const [headerBgIdx, setHeaderBgIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setHeaderBgIdx((i) => (i + 1) % 5), 5000);
    return () => clearInterval(t);
  }, []);
  const [showEstimatorPreview, setShowEstimatorPreview] = useState(false);
  const [showQuickQuote, setShowQuickQuote] = useState(!!autoOpenQuickQuote);

  // --- QuickQuote Estimator ---
  // Estimator is its own workspace. Two kinds of items land in it:
  //   1. The base color change line — auto-added when the shop owner
  //      picks a swatch (precision design choice). variantKey
  //      "colorpro-base" so re-picking REPLACES the base.
  //   2. Precision additions (chrome delete, carbon fiber roof, racing
  //      stripe, …) — added via upsell buttons inside the drawer.
  //      No variantKey, so they STACK without touching the base.
  // Renders themselves don't touch the estimator.
  const colorEstimator = useEstimator();
  const {
    setVehicle: setColorEstimatorVehicle,
    add: addColorEstimatorItem,
    setBaseRender: setColorEstimatorBaseRender,
    pushPrecisionMod: pushColorEstimatorPrecisionMod,
    clearPrecisionMods: clearColorEstimatorPrecisionMods,
  } = colorEstimator;
  const colorBaseVariantKey = "colorpro-base";

  useEffect(() => {
    setColorEstimatorVehicle({
      year: year || undefined,
      make: make || undefined,
      model: model || undefined,
      sqFt: vehicleSqFt || undefined,
    });
  }, [year, make, model, vehicleSqFt, setColorEstimatorVehicle]);

  useEffect(() => {
    setColorEstimatorBaseRender(generatedImageUrl ?? null);
  }, [generatedImageUrl, setColorEstimatorBaseRender]);

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
      addColorEstimatorItem({
        id: lineItemId,
        label: result.lineItem.label,
        description: result.lineItem.description,
        qty: 1,
        unitPrice: result.lineItem.unitPrice,
        unit: result.lineItem.unit,
        source: result.lineItem.source,
      });
      pushColorEstimatorPrecisionMod({
        key: mod.key,
        label: mod.label,
        renderUrl: result.newRenderUrl,
        lineItemId,
      });
    },
    [addColorEstimatorItem, pushColorEstimatorPrecisionMod],
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

  // Override the hero view URL with the precision-modified one. Other
  // views in allViews aren't touched — Phase 5c only stacks mods on
  // the active hero. ColorProToolCore renders allViews[0] as the hero.
  const effectiveAllViews = useMemo(() => {
    if (!precisionRenderUrl || !allViews || allViews.length === 0) return allViews;
    return [{ ...allViews[0], url: precisionRenderUrl }, ...allViews.slice(1)];
  }, [allViews, precisionRenderUrl]);

  // Auto-add / auto-replace the base color change line on swatch or
  // finish selection. Browsing through swatches updates the same line
  // (variantKey dedupe) — no estimator pollution.
  useEffect(() => {
    if (!selectedSwatch) return;
    const finishKey = (selectedFinish || "gloss")
      .toLowerCase()
      .replace(/[\s-]/g, "_");
    const finishProduct =
      findProductById(`cc-${finishKey}`) ?? findProductById("cc-gloss");
    if (!finishProduct) return;
    const colorName = selectedSwatch.name || "Custom Color";
    // Industry-average yards for a full vehicle color change. Shop
    // owner edits qty in the drawer for fleet jobs / partial wraps.
    const yards =
      vehicleSqFt > 0 ? Math.max(1, Math.ceil(vehicleSqFt / 25)) : 15;
    const item = lineItemFromProduct(finishProduct, {
      source: "render",
      qty: yards,
      description: `${colorName} · ${selectedFinish || "Gloss"} · ${yards} yd`,
      variantKey: colorBaseVariantKey,
    });
    addColorEstimatorItem({
      ...item,
      label: `Color Change — ${colorName}`,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSwatch?.id, selectedFinish, vehicleSqFt, addColorEstimatorItem]);

  const persistColorEstimate = useCallback(
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
        colorName: selectedSwatch?.name || undefined,
        manufacturer: ((selectedSwatch as Record<string, unknown>)?.manufacturer as string | undefined) ?? undefined,
        toolSource: "colorpro",
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
    [toast, precisionRenderUrl, generatedImageUrl, selectedFinish, selectedSwatch, visualizationId],
  );

  const handleColorEstimatorSaveDraft = useCallback(
    (state: EstimatorState) => { void persistColorEstimate(state, "draft"); },
    [persistColorEstimate],
  );
  const handleColorEstimatorSend = useCallback(
    (state: EstimatorState) => { void persistColorEstimate(state, "send"); },
    [persistColorEstimate],
  );
  // Phase 7 / Path B — only WPW shops see the WPW cart preview button.
  const { data: isWpwShop = false } = useIsWpwTenant();
  const handleColorCheckoutOnWpw = useCallback(
    (_state: EstimatorState, cartUrl: string) => {
      window.open(cartUrl, "_blank", "noopener,noreferrer");
      toast({
        title: "WPW cart opened",
        description: "Pre-loaded with the WPW print products from this estimate.",
      });
    },
    [toast],
  );

  const [showEmailConfigurator, setShowEmailConfigurator] = useState(false);
  const [emailQuoteData, setEmailQuoteData] = useState<any>(null);
  const [emailInitialType, setEmailInitialType] = useState<"proof" | "studio" | "quote" | "all">("proof");

  // QuickQuote pro state
  const [qqCategory, setQqCategory] = useState<ServiceCategory>("full_wraps");
  const [qqQuantity, setQqQuantity] = useState("1");
  const [qqAddOns, setQqAddOns] = useState<Set<AddOnId>>(new Set());
  const [qqIncludeLabor, setQqIncludeLabor] = useState(true);
  const [qqIncludeMargin, setQqIncludeMargin] = useState(true);
  const [qqMarginPercent, setQqMarginPercent] = useState(65);
  const [qqQuoteMode, setQqQuoteMode] = useState<"quick" | "full">("quick");
  const [qqCustomerName, setQqCustomerName] = useState("");
  const [qqCustomerEmail, setQqCustomerEmail] = useState("");
  const [qqCustomerPhone, setQqCustomerPhone] = useState("");
  const [qqCompanyName, setQqCompanyName] = useState("");

  const toggleQqAddOn = (id: AddOnId) => {
    setQqAddOns((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const [isRevising, setIsRevising] = useState(false);
  const touchStartY = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const colorSectionRef = useRef<HTMLDivElement>(null);
  const generationTimerRef = useRef<HTMLDivElement>(null);

  // Pull-to-refresh removed — was causing screen to jump back and forth on mobile scroll

  // Live elapsed timer during generation
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    if (isGenerating || mvpIsGenerating) {
      setElapsedSeconds(0);
      interval = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
      // On mobile, scroll down to the Sproket timer so the page doesn't jump around
      if (isMobile) {
        setTimeout(() => {
          generationTimerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
    } else {
      setElapsedSeconds(0);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating, mvpIsGenerating, isMobile]);

  // Rotating tips for during generation
  const generationTips = [
    "Pro Tip: Matte finishes hide imperfections better than gloss",
    "Did you know? 3M 2080 series is the industry standard for color change",
    "Fun Fact: A full wrap can increase vehicle resale value",
    "Pro Tip: Darker colors show dust more easily than lighter ones",
    "Did you know? Chrome wraps require more maintenance than standard vinyl",
    "Pro Tip: PPF can be combined with color change for ultimate protection",
    "Fun Fact: Vehicle wraps can last 5-7 years with proper care",
    "Pro Tip: Always have your wrap installed in a dust-free environment"
  ];

  // Get current tip based on elapsed time (rotate every 5 seconds)
  const getCurrentTip = () => {
    const tipIndex = Math.floor(elapsedSeconds / 5) % generationTips.length;
    return generationTips[tipIndex];
  };

  // Progress steps with checkmarks
  const getProgressSteps = () => [
    { label: "Vehicle identified", completed: elapsedSeconds >= 2 },
    { label: "Color matched", completed: elapsedSeconds >= 6 },
    { label: "Applying wrap finish", completed: elapsedSeconds >= 12 },
    { label: "Rendering photorealistic details", completed: elapsedSeconds >= 20 }
  ];

  // Get dynamic status message based on elapsed time
  const getGenerationStatusMessage = () => {
    if (elapsedSeconds < 5) return "Starting AI render...";
    if (elapsedSeconds < 15) return "Processing vehicle details...";
    if (elapsedSeconds < 25) return "Applying color wrap...";
    if (elapsedSeconds < 40) return "Rendering photorealistic details...";
    return "Almost done, hang tight...";
  };

  // LOCKED PIPELINE: Auto-fire all views → 2D proof → artboard when hero render completes.
  const autoFireRef = useRef(false);
  useEffect(() => {
    if (generatedImageUrl && allViews.length === 0 && !isGeneratingAdditional && !autoFireRef.current) {
      autoFireRef.current = true;
      generateAdditionalViews({ modeType: "ColorPro" });
    }
    if (!generatedImageUrl) {
      autoFireRef.current = false;
    }
  }, [generatedImageUrl, allViews.length, isGeneratingAdditional]);

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
    // ColorPro mode - swatch required
    if (!selectedSwatch) {
      toast({
        title: "Pick a Color First!",
        description: "Scroll down and choose a manufacturer film color to visualize",
        variant: "destructive",
        duration: 5000
      });

      setHighlightColorSection(true);
      setTimeout(() => setHighlightColorSection(false), 3000);
      setIsColorSectionOpen(true);
      setSelectedColorMode('database');

      if (colorSectionRef.current) {
        colorSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return;
    }

    if (!validateYear()) return;
    if (!make || !model) {
      toast({ title: "Vehicle required", description: "Please enter year, make, and model", variant: "destructive" });
      return;
    }

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
        colorName: (selectedSwatch as any)?.name || "Custom",
        hex: (selectedSwatch as any)?.hex || "#808080",
        finish: (selectedFinish || "Gloss").toLowerCase(),
        manufacturer: (selectedSwatch as any)?.manufacturer || "",
        toolSource: "ColorPro",
      };
      if ((selectedSwatch as any)?.media_url) {
        colorData.swatchImageUrl = (selectedSwatch as any).media_url;
      }
      if ((selectedSwatch as any)?.id) {
        colorData.swatchId = (selectedSwatch as any).id;
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
        incrementGeneration();
        toast({ title: "Applied to your vehicle!", description: "Your wrap has been visualized on your photo.", duration: 4000 });
        document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        toast({ title: "Generation Failed", description: mvpError || "Please try again", variant: "destructive" });
      }
      return;
    }

    // ─── Studio Mode: render on stock 3D model ───
    setShowFallback(false);
    setExampleImageUrl(null);

    const result = await generateRender({
      modeType: "ColorPro",
      viewType: selectedViewType,
    });

    if (result.success) {
      await incrementRenderCount();
      incrementGeneration();
      toast({
        title: "Hero View Generated",
        description: "Your 3D wrap preview is ready! Generate additional views for more angles.",
        duration: 4000
      });
      document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      toast({ title: "Generation Failed", description: result.error || "Please try again", variant: "destructive" });
    }
  };

  const handleGenerateAdditional = async () => {
    const result = await generateAdditionalViews({
      modeType: "ColorPro",
    });
    
    if (result.success) {
      toast({ 
        title: "All Views Complete", 
        description: `Generated ${result.views?.length || 0} total views of your wrapped vehicle!`, 
        duration: 3000 
      });
    } else {
      toast({ title: "Generation Failed", description: result.error || "Please try again", variant: "destructive" });
    }
  };

  const handleShowExample = async () => {
    if (!selectedSwatch) {
      toast({ title: "No color selected", description: "Please select a color first", variant: "destructive" });
      return;
    }
    
    const imageUrl = await getDefaultRenderForColor(selectedSwatch.id);
    if (imageUrl) {
      setExampleImageUrl(imageUrl);
      setShowFallback(true);
      toast({ title: "Example Loaded", description: "Showing sample vehicle render", duration: 2000 });
    } else {
      toast({ title: "No Example Available", description: "No example render found for this color", variant: "destructive" });
    }
  };

  const handleRevisionSubmit = async (prompt: string) => {
    if (!year || !make || !model) return;
    const originalUrl = generatedImageUrl;
    setIsRevising(true);
    try {
      await generateRender({
        modeType: "ColorPro",
        viewType: selectedViewType,
        revisionPrompt: prompt,
        originalRenderUrl: originalUrl || undefined,
      });
      // Phase 2 Rank 2 — log (before, prompt, after) for the corpus.
      // Fire-and-forget; a logging failure must not block the revision.
      if (generatedImageUrl) {
        saveRevision({
          viewType: selectedViewType || 'side',
          originalUrl,
          revisedUrl: generatedImageUrl,
          revisionPrompt: prompt,
        }).catch(err => console.warn('[ColorPro] saveRevision failed (non-fatal):', err));
      }
      toast({ title: "Revision applied", description: "New render generated with your changes" });
    } finally {
      setIsRevising(false);
    }
  };

  const handleViewOnVehicle = (color: InkFusionColor) => {
    const previewSection = document.getElementById('preview-section');
    if (previewSection) {
      previewSection.scrollIntoView({ behavior: 'smooth' });
    }
    toast({
      title: "Color Selected",
      description: `${color.name} ready to preview. Select vehicle and generate.`,
    });
  };

  return (
    <>
      <div ref={containerRef} className="w-full bg-background overflow-x-hidden relative">
        {/* Pull-to-refresh indicator */}
        {pullToRefreshActive && isMobile && (
          <div className="fixed top-0 left-0 right-0 z-50 bg-primary/90 text-primary-foreground py-3 flex items-center justify-center gap-2">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm font-medium">Release to refresh...</span>
          </div>
        )}
        
        <div className="bg-background">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2">
            <Card className="bg-black border-border/30 rounded-t-xl rounded-b-none p-0 overflow-hidden relative">
              {/* RIGHT side — one crisp rotating design (not faded, not over-zoomed) */}
              <div className="absolute inset-y-0 right-0 w-1/2 overflow-hidden">
                {[
                  "/colorpro-hero-closeup.png",
                  "/colorpro-hero-purple-merc.png",
                  "/colorpro-hero-bronze.png",
                  "/colorpro-hero-blue-genesis.png",
                  "/colorpro-hero-ferrari.png",
                ].map((src, i) => (
                  <img
                    key={src}
                    src={src}
                    alt=""
                    className={cn(
                      "absolute inset-0 w-full h-full object-cover object-center transition-opacity duration-1000",
                      headerBgIdx === i ? "opacity-100" : "opacity-0"
                    )}
                  />
                ))}
                {/* fade ONLY the left edge of the image into the black header */}
                <div className="absolute inset-0 bg-gradient-to-r from-black via-black/30 to-transparent" />
              </div>

              {/* Content (left) */}
              <div className="relative flex items-center py-3 px-3 sm:px-4">
                {/* Sproket holding laptop, on a black backing so it always reads */}
                <div className="flex-shrink-0 mr-3 hidden sm:flex items-center justify-center rounded-xl bg-black/60 backdrop-blur-sm p-1.5">
                  <img
                    src="/characters/sproket/sproket-laptop.png"
                    alt="SPROKET"
                    className="w-16 h-16 object-contain drop-shadow-[0_0_16px_rgba(99,102,241,0.65)]"
                  />
                </div>

                {/* Title + tagline on a black transparent rect so the bg image can't wash it out */}
                <div className="flex-1 rounded-lg bg-black/55 backdrop-blur-sm px-3 py-1.5">
                  <h2 className="text-xl sm:text-2xl tracking-wide flex items-center gap-1.5">
                    <span className="text-white font-bold">Color<span className="bg-gradient-to-r from-blue-400 via-purple-500 to-fuchsia-500 bg-clip-text text-transparent drop-shadow-[0_0_10px_rgba(168,85,247,0.6)]">Pro</span>™</span>
                    <Badge variant="outline" className="ml-1 text-[10px] bg-gradient-to-r from-amber-500/20 to-orange-500/20 border-amber-500/50 text-amber-400 hidden sm:inline-flex">
                      <Sparkles className="w-2.5 h-2.5 mr-0.5" />
                      AI-Calibrated
                    </Badge>
                  </h2>
                  <p className="text-[11px] sm:text-xs text-zinc-300 mt-0.5">
                    Real manufacturer film — studio lighting, specular highlights & material-accurate finish depth
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* ─── Main content area ─── */}
        <div className="pb-8">

        <div className="max-w-7xl mx-auto px-3 sm:px-4 pb-24">
          <div className="flex flex-col lg:grid lg:grid-cols-[380px_1fr] gap-3 sm:gap-4 md:gap-6">
            {/* On mobile, show the sidebar AFTER the preview when a render exists */}
            <div className={cn("space-y-3 sm:space-y-4", isMobile && generatedImageUrl && "order-2")}>
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
                {/* Vehicle type — push-button per class */}
                <div className="mb-3">
                  <VehicleTypeSelector value={vehicleType} onChange={setVehicleType} />
                </div>
                {isNonStandardVehicle(vehicleType) ? (
                  /* ── Non-standard vehicle: dedicated lookup ── */
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
                  /* ── Standard vehicle: car/truck/SUV/van fields ── */
                  <>
                    <div className="flex items-end gap-2">
                      <Car className="w-4 h-4 text-muted-foreground mb-2 flex-shrink-0" />
                      <div className="flex-1">
                        <Label htmlFor="year" className="text-[10px] text-muted-foreground">Year</Label>
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
                            "h-8 text-sm bg-background border border-border/50",
                            yearError && "border-red-500"
                          )}
                        />
                      </div>
                      <div className="flex-1">
                        <Label htmlFor="make" className="text-[10px] text-muted-foreground">Make</Label>
                        <Input
                          id="make"
                          type="text"
                          placeholder="Nissan"
                          value={make}
                          onChange={(e) => setMake(e.target.value)}
                          className="h-8 text-sm bg-background border border-border/50"
                        />
                      </div>
                      <div className="flex-1">
                        <Label htmlFor="model" className="text-[10px] text-muted-foreground">Model</Label>
                        <Input
                          id="model"
                          type="text"
                          placeholder="Z"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          className="h-8 text-sm bg-background border border-border/50"
                        />
                      </div>
                    </div>
                    {/* Vehicle Autocomplete — optional helper for sq ft lookup */}
                    <VehicleAutocomplete
                      initialValue={[make, model].filter(Boolean).join(" ")}
                      onSelect={(v) => {
                        setMake(v.make);
                        setModel(v.model);
                        if (v.year) setYear(v.year);
                        setVehicleSqFt(v.corrSqFt || v.sqFt || 0);
                      }}
                    />
                  </>
                )}
                {vehicleSqFt > 0 && (
                  <p className="text-[10px] text-muted-foreground mt-1">
                    <span className="font-semibold text-[#60A5FA]">{vehicleSqFt} sq ft</span>
                    {" · "}
                    <span className="font-semibold">{sqFtToYards(vehicleSqFt)} yards</span> of film needed
                  </p>
                )}
              </MyVehicleProToggle>

              {/* Color browser — always visible */}
              <div
                ref={colorSectionRef}
                className="transition-all duration-500"
              >
                <ManufacturerColorBrowser
                  selectedSwatch={selectedSwatch}
                  onSwatchSelect={(swatch) => {
                    const swatchFinish = swatch.finish || selectedFinish;
                    const swatchWithFinish = {
                      ...swatch,
                      finish: swatchFinish,
                      swatchImageUrl: swatch.media_url || (swatch as any).swatchImageUrl,
                    };
                    setSelectedSwatch(swatchWithFinish as any);
                    if (swatch.finish) {
                      setSelectedFinish(swatch.finish as typeof selectedFinish);
                    }
                    setExampleImageUrl(null);
                  }}
                />
              </div>

              {/* Color selection options displayed here - GraphicsPro moved above */}

            </div>

            <div id="preview-section" className={cn("space-y-3", isMobile && generatedImageUrl && "order-1")}>
              {/* ─── Uniform Button Stack ─── */}
              <div className="space-y-2">
                {/* Generate Render */}
                <Button
                  onClick={handleGenerate}
                  disabled={(isGenerating || mvpIsGenerating) || !selectedSwatch || (!(mvp.isMyVehicleMode && mvp.hasPhotos) && (!year || !make || !model))}
                  size="lg"
                  className={cn(
                    "w-full h-12 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold text-sm transition-all",
                    isGenerating && "opacity-90"
                  )}
                >
                  {(isGenerating || mvpIsGenerating) ? (
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>
                        {mvpIsGenerating && mvpMultiViewResults.length > 0
                          ? `${mvpMultiViewResults.length} of ${mvp.multiViewPhotos?.length || '?'} views... ${elapsedSeconds}s`
                          : `Generating... ${elapsedSeconds}s`
                        }
                      </span>
                    </div>
                  ) : !selectedSwatch ? "Select a Color to Generate" : (!year || !make || !model) ? "Enter Vehicle to Generate" : (allViews.length > 0 ? "Generate New Render" : "Generate Render")}
                </Button>

                {/* QuickQuote — same card the dashboard uses, in a left sheet */}
                <Button
                  onClick={() => setShowQuickQuote(true)}
                  size="lg"
                  className="w-full h-12 bg-gradient-to-r from-[#2563eb] to-[#a855f7] hover:from-[#1d4ed8] hover:to-[#9333ea] text-white font-bold text-sm"
                >
                  <Calculator className="w-4 h-4 mr-2" />
                  QuickQuote™ — Pricing & Quote
                </Button>

                {/* Generate Additional Views */}
                {generatedImageUrl && allViews.length === 1 && !isGeneratingAdditional && (
                  <Button
                    onClick={handleGenerateAdditional}
                    size="lg"
                    className="w-full h-12 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white font-bold text-sm"
                  >
                    <Layers className="mr-2 h-4 w-4" />
                    Generate All Views (3 more angles)
                  </Button>
                )}

                {/* Clear */}
                {allViews.length > 0 && (
                  <Button
                    onClick={() => {
                      clearLastRender();
                      toast({ title: "Cleared", description: "Ready for a new design", duration: 2000 });
                    }}
                    size="lg"
                    variant="outline"
                    className="w-full h-12 border-zinc-700 text-zinc-400 hover:bg-zinc-800 hover:text-white text-sm"
                  >
                    <X className="h-4 w-4 mr-2" />
                    Clear & Start New
                  </Button>
                )}
              </div>

              {/* Sproket generation wizard */}
              {isGenerating && (
                <div ref={generationTimerRef}>
                  <GenerationWizard
                    isGenerating={isGenerating}
                    elapsedSeconds={elapsedSeconds}
                    tips={COLORPRO_TIPS}
                    currentTipIndex={Math.floor(elapsedSeconds / 5) % COLORPRO_TIPS.length}
                    toolName="ColorPro"
                    gradientFrom="from-blue-500"
                    gradientTo="to-blue-500"
                    colorProShowcase
                  />
                </div>
              )}

              {!isGenerating && !generatedImageUrl && (
                <p className="text-xs text-muted-foreground text-center">
                  {subscription && subscription.tier !== 'free'
                    ? "Unlimited previews included with your plan"
                    : remainingGenerations > 0
                      ? `${remainingGenerations} free previews remaining`
                      : "Free limit reached - continue generating!"}
                </p>
              )}

              {/* MyVehiclePro Result Display — hero + swatch + thumbnail strip */}
              {(mvpEditedImageUrl && mvpBeforeUrl) && (() => {
                const allResults = mvpMultiViewResults.length > 0 ? mvpMultiViewResults : [{ viewType: "photo", url: mvpEditedImageUrl!, beforeUrl: mvpBeforeUrl! }];
                const [mvpHeroIdx, setMvpHeroIdx] = [mvpHeroView, setMvpHeroView];
                const hero = allResults[mvpHeroIdx] || allResults[0];
                const swatch = selectedSwatch as any;
                const VIEW_LABELS: Record<string, string> = { front: "Front", "driver-side": "Driver Side", "passenger-side": "Passenger Side", rear: "Rear", top: "Top", detail: "Detail", photo: "Your Vehicle" };

                return (
                  <Card className="overflow-hidden bg-zinc-900 border-blue-500/30 p-0">
                    {/* Header */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800">
                      <div className="flex items-center gap-2 text-sm font-bold">
                        <Camera className="w-4 h-4 text-blue-400" />
                        <span className="text-foreground">MyVehicle</span>
                        <span className="text-blue-400">Pro&#8482;</span>
                      </div>
                      {mvpIsGenerating && (
                        <span className="text-xs text-blue-400 font-medium animate-pulse">
                          {mvpMultiViewResults.length} of {mvp.multiViewPhotos?.length || '?'} views...
                        </span>
                      )}
                    </div>

                    {/* Hero: Before/After + Swatch side by side */}
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_200px] gap-0">
                      {/* Left — big before/after */}
                      <div className="relative">
                        <BeforeAfterViewer
                          beforeUrl={hero.beforeUrl}
                          afterUrl={hero.url}
                          beforeLabel="Original"
                          afterLabel="Wrapped"
                          swatchHex={swatch?.hex}
                          swatchImageUrl={swatch?.swatchImageUrl || swatch?.media_url}
                          swatchName={swatch?.name}
                        />
                        <div className="absolute top-2 left-2">
                          <span className="bg-black/60 backdrop-blur-sm text-white text-xs font-semibold px-2 py-1 rounded-md">
                            {VIEW_LABELS[hero.viewType] || hero.viewType}
                          </span>
                        </div>
                      </div>

                      {/* Right — large swatch card */}
                      <div className="bg-zinc-950 border-l border-zinc-800 p-4 flex flex-col items-center justify-center gap-3">
                        {(swatch?.media_url || swatch?.swatchImageUrl) ? (
                          <img
                            src={swatch.swatchImageUrl || swatch.media_url}
                            alt={swatch?.name}
                            className="w-28 h-28 rounded-xl object-cover border-2 border-zinc-700 shadow-lg"
                          />
                        ) : swatch?.hex ? (
                          <div
                            className="w-28 h-28 rounded-xl border-2 border-zinc-700 shadow-lg"
                            style={{ backgroundColor: swatch.hex }}
                          />
                        ) : null}
                        <div className="text-center">
                          <p className="text-sm font-bold text-white">{swatch?.name || "Custom Color"}</p>
                          {swatch?.manufacturer && (
                            <p className="text-[11px] text-zinc-400">{swatch.manufacturer}</p>
                          )}
                          <p className="text-[11px] text-zinc-500 mt-0.5">{selectedFinish || "Gloss"} Finish</p>
                          {swatch?.hex && (
                            <p className="text-[10px] text-zinc-600 font-mono mt-1">{swatch.hex}</p>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Thumbnail strip — click to swap hero */}
                    {allResults.length > 1 && (
                      <div className="flex gap-1.5 px-3 py-2.5 bg-zinc-950 border-t border-zinc-800 overflow-x-auto">
                        {allResults.map((result, i) => (
                          <button
                            key={result.viewType}
                            onClick={() => setMvpHeroView(i)}
                            className={cn(
                              "flex-shrink-0 rounded-lg overflow-hidden border-2 transition-all w-20 h-14",
                              i === mvpHeroIdx
                                ? "border-blue-500 ring-1 ring-blue-500/30"
                                : "border-zinc-700 hover:border-zinc-500 opacity-70 hover:opacity-100"
                            )}
                          >
                            <img src={result.url} alt={result.viewType} className="w-full h-full object-cover" />
                          </button>
                        ))}
                        {mvpIsGenerating && (
                          <div className="flex-shrink-0 w-20 h-14 rounded-lg border-2 border-dashed border-zinc-700 flex items-center justify-center">
                            <RefreshCw className="w-4 h-4 text-zinc-600 animate-spin" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="px-3 py-2 border-t border-zinc-800">
                      <Button
                        onClick={() => { clearMyVehicleResults(); setMvpHeroView(0); }}
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        <RefreshCw className="w-3 h-3 mr-1.5" /> Try Another Photo
                      </Button>
                    </div>
                  </Card>
                );
              })()}

              {/* Non-standard vehicle validation warning — blocks production until dimensions verified */}
              {nonStandardSpecs && generatedImageUrl && (
                <NonStandardVehicleWarning specs={nonStandardSpecs} />
              )}

              {/* STANDARD RENDER DISPLAY - ColorPro Mode */}
              {(generatedImageUrl || exampleImageUrl) && (
                <Card className="overflow-hidden bg-secondary/30 border-border/30">
                  <ColorProToolCore
                    allViews={effectiveAllViews}
                    isGenerating={isGenerating}
                    isGeneratingAdditional={isGeneratingAdditional}
                    selectedSwatch={selectedSwatch}
                    onGenerateAdditional={handleGenerateAdditional}
                    onClearLastRender={clearLastRender}
                    onRegenerateSingleView={regenerateSingleView}
                    pendingViews={pendingViews}
                  />
                  {generatedImageUrl && (
                    <div className="p-3 border-t border-border/30">
                      <RenderQualityRating
                        renderId={visualizationId || generatedImageUrl || ''}
                        renderType="colorpro"
                        renderUrl={generatedImageUrl || ''}
                      />
                    </div>
                  )}
                </Card>
              )}

              {/* Precision modifications — stack chrome delete /
                  carbon fiber roof / racing stripe / etc. on top of
                  the active render. Each click sends the displayed
                  image to Gemini and swaps in the result. */}
              {generatedImageUrl && (
                <PrecisionModButtons
                  tool="colorpro"
                  currentRenderUrl={precisionRenderUrl ?? generatedImageUrl}
                  onApplied={handlePrecisionApplied}
                  onError={handlePrecisionError}
                />
              )}

              {precisionRenderUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPrecisionRenderUrl(null);
                    clearColorEstimatorPrecisionMods();
                  }}
                  className="w-full text-xs text-muted-foreground hover:text-foreground"
                >
                  <RefreshCw className="w-3 h-3 mr-1.5" />
                  Reset to original render (estimate line items kept)
                </Button>
              )}

              {/* Render quality rating + Mark as Perfect - ColorPro */}
              {generatedImageUrl && selectedSwatch && visualizationId && (
                <Card className="p-4 bg-secondary/20 border-border space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <RenderQualityRating 
                      renderId={visualizationId}
                      renderType="colorpro"
                      renderUrl={generatedImageUrl}
                    />
                    <MarkAsPerfectButton
                      promptSignature={`${(selectedSwatch as any)?.manufacturer || ''} ${(selectedSwatch as any)?.name || ''} ${selectedFinish || ''}`}
                      vehicleSignature={`${year} ${make} ${model}`}
                      renderUrls={allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {})}
                      sourceVisualizationId={visualizationId}
                    />
                  </div>
                </Card>
              )}

              {/* MyVehiclePro inline — try this color on YOUR vehicle */}
              {generatedImageUrl && !mvp.isMyVehicleMode && (
                <MyVehicleProInline
                  modeType="colorpro"
                  colorName={(selectedSwatch as any)?.name}
                  colorHex={(selectedSwatch as any)?.hex}
                  finishType={selectedFinish}
                  manufacturer={(selectedSwatch as any)?.manufacturer}
                  vehicleYear={year}
                  vehicleMake={make}
                  vehicleModel={model}
                  renderUrl={generatedImageUrl}
                />
              )}

              {/* ─── ACTION BAR — Proof, Quote, Studio, Production ─── */}
              {generatedImageUrl && selectedSwatch && (
                <Card className="p-3 sm:p-4 bg-secondary/20 border-border space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Next Steps</p>
                  <div className="grid grid-cols-2 gap-2">
                    {/* 2D Proof — flat panel layout with sq ft */}
                    <Button
                      className="bg-gradient-to-r from-teal-600 to-cyan-600 hover:from-teal-500 hover:to-cyan-500 text-white h-auto py-3"
                      onClick={() => setShow2DProofSheet(true)}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <ClipboardSignature className="w-5 h-5" />
                        <span className="text-xs font-bold">2D Proof</span>
                      </div>
                    </Button>

                    {/* Studio Proof — available with 1+ views */}
                    <Button
                      className="bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white h-auto py-3"
                      onClick={() => setShowStudioProof(true)}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <Camera className="w-5 h-5" />
                        <span className="text-xs font-bold">3D Proof</span>
                      </div>
                    </Button>

                    {/* Customer Approval Proof — opens ApprovePro send flow */}
                    <Button
                      className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white h-auto py-3"
                      onClick={() => setShowSendForApproval(true)}
                      disabled={!year || !make || !model || !generatedImageUrl}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <ClipboardSignature className="w-5 h-5" />
                        <span className="text-xs font-bold">Send for Approval</span>
                      </div>
                    </Button>

                    {/* QuickQuote / Quote */}
                    {year && make && model && (
                      <Button
                        className="bg-gradient-to-r from-[#2563eb] to-[#a855f7] hover:from-[#1d4ed8] hover:to-[#9333ea] text-white h-auto py-3"
                        onClick={() => setShowQuickQuote(true)}
                      >
                        <div className="flex flex-col items-center gap-1">
                          <Calculator className="w-5 h-5" />
                          <span className="text-xs font-bold">Get Quote</span>
                        </div>
                      </Button>
                    )}

                    {/* Email Client */}
                    <Button
                      className="bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white h-auto py-3"
                      onClick={() => {
                        setEmailInitialType("proof");
                        setShowEmailConfigurator(true);
                      }}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <Mail className="w-5 h-5" />
                        <span className="text-xs font-bold">View / Edit Email</span>
                      </div>
                    </Button>
                  </div>

                  {/* Cut Files — secondary action */}
                  <Button
                    variant="outline"
                    className="w-full border-purple-500/30 text-purple-300 hover:bg-purple-500/10"
                    onClick={() => navigate("/productionflow", {
                      state: {
                        action: "run_cut_map",
                        renderData: {
                          render_urls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
                          vehicle_year: year,
                          vehicle_make: make,
                          vehicle_model: model,
                          design_name: selectedSwatch?.name || "Custom Color",
                        },
                      },
                    })}
                  >
                    <Scissors className="w-4 h-4 mr-2" /> Generate Cut Contour Logo Pack
                  </Button>

                  {/* PrintPro — WPW-priced quote + order */}
                  <PrintProCTAButton
                    width="full"
                    context={{
                      toolSource: "colorpro",
                      renderUrl: generatedImageUrl,
                      renderUrls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
                      vehicleYear: year,
                      vehicleMake: make,
                      vehicleModel: model,
                      designName: selectedSwatch?.name || "Custom Color",
                      finish: selectedFinish,
                      colorName: selectedSwatch?.name,
                      colorHex: (selectedSwatch as any)?.hex,
                    }}
                  />

                </Card>
              )}

              {/* Design Revision Prompt - Always visible as selling point */}
              <DesignRevisionPrompt
                onRevisionSubmit={handleRevisionSubmit}
                isGenerating={isRevising || isGenerating}
                disabled={!generatedImageUrl || !year || !make || !model}
              />

              {/* Generate button is at the TOP of preview-section */}
            </div>
          </div>
        </div>
      </div>
      </div>{/* end main content */}

      <PaywallModal
        open={paywallOpen} 
        onClose={() => setPaywallOpen(false)} 
        onShowExample={handleShowExample}
        productType="ColorPro™" 
      />

      {/* Fullscreen Image Modal */}
      <MobileZoomImageModal
        imageUrl={expandedImage?.url || ''}
        title={expandedImage?.title}
        isOpen={!!expandedImage}
        onClose={() => setExpandedImage(null)}
      />
      
      <UpgradeRequired
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        requiredTier="starter"
        featureName="ColorPro™ Color Rendering"
      />

      {/* Professional Proof Sheet Dialog — Mobile: 2D PNG, Desktop: full proof sheet */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className={isMobile ? "max-w-[95vw] max-h-[95vh] overflow-y-auto p-0" : "max-w-6xl max-h-[95vh] overflow-y-auto"}>
          {isMobile ? (
            <MobileProofSheet
              views={[
                ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof View' }] : []),
                ...(allViews?.find(v => v.type === 'side') ? [{ type: 'side', url: allViews.find(v => v.type === 'side')!.url, label: 'Driver Side' }] : []),
                ...(allViews?.find(v => v.type === 'passenger-side') ? [{ type: 'passenger-side', url: allViews.find(v => v.type === 'passenger-side')!.url, label: 'Passenger Side' }] : []),
                ...(allViews?.find(v => v.type === 'front') ? [{ type: 'front', url: allViews.find(v => v.type === 'front')!.url, label: 'Front View' }] : []),
                ...(allViews?.find(v => v.type === 'rear') ? [{ type: 'rear', url: allViews.find(v => v.type === 'rear')!.url, label: 'Rear View' }] : []),
                ...(allViews?.find(v => v.type === 'hood_detail') ? [{ type: 'hood_detail', url: allViews.find(v => v.type === 'hood_detail')!.url, label: 'Hood Detail' }] : []),
                ...(allViews?.find(v => v.type === 'close-up') ? [{ type: 'close-up', url: allViews.find(v => v.type === 'close-up')!.url, label: 'Close-Up' }] : []),
              ]}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolKey="colorpro"
              manufacturer={(() => {
                const mfr = (selectedSwatch as any)?.manufacturer;
                if (mfr && mfr !== 'Unknown' && mfr !== 'Custom') return mfr;
                const lib = (selectedSwatch as any)?.colorLibrary?.toLowerCase() || '';
                if (lib.includes('avery')) return 'Avery Dennison';
                if (lib.includes('3m')) return '3M';
                if (lib.includes('hexis')) return 'Hexis';
                if (lib.includes('kpmf')) return 'KPMF';
                if (lib.includes('oracal')) return 'Oracal';
                if (lib.includes('inozetek')) return 'Inozetek';
                if (lib.includes('arlon')) return 'Arlon';
                if (lib.includes('teckwrap')) return 'TeckWrap';
                if (lib.includes('vvivid')) return 'VViViD';
                return mfr || '';
              })()}
              colorName={selectedSwatch?.name && selectedSwatch.name !== 'Unknown' ? selectedSwatch.name : 'Custom Color'}
              productCode={(selectedSwatch as any)?.code || (selectedSwatch as any)?.productCode || ''}
              finish={selectedFinish}
              hex={selectedSwatch?.hex}
              coverageUnit="yards"
            />
          ) : (
            <ProfessionalProofSheet
              views={[
                ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof View' }] : []),
                ...(allViews?.find(v => v.type === 'side') ? [{ type: 'side', url: allViews.find(v => v.type === 'side')!.url, label: 'Driver Side' }] : []),
                ...(allViews?.find(v => v.type === 'passenger-side') ? [{ type: 'passenger-side', url: allViews.find(v => v.type === 'passenger-side')!.url, label: 'Passenger Side' }] : []),
                ...(allViews?.find(v => v.type === 'front') ? [{ type: 'front', url: allViews.find(v => v.type === 'front')!.url, label: 'Front View' }] : []),
                ...(allViews?.find(v => v.type === 'rear') ? [{ type: 'rear', url: allViews.find(v => v.type === 'rear')!.url, label: 'Rear View' }] : []),
                ...(allViews?.find(v => v.type === 'hood_detail') ? [{ type: 'hood_detail', url: allViews.find(v => v.type === 'hood_detail')!.url, label: 'Hood Detail' }] : []),
                ...(allViews?.find(v => v.type === 'close-up') ? [{ type: 'close-up', url: allViews.find(v => v.type === 'close-up')!.url, label: 'Close-Up' }] : []),
              ]}
              vehicleYear={year}
              vehicleMake={make}
              vehicleModel={model}
              toolKey="colorpro"
              manufacturer={(() => {
                const mfr = (selectedSwatch as any)?.manufacturer;
                if (mfr && mfr !== 'Unknown' && mfr !== 'Custom') return mfr;
                const lib = (selectedSwatch as any)?.colorLibrary?.toLowerCase() || '';
                if (lib.includes('avery')) return 'Avery Dennison';
                if (lib.includes('3m')) return '3M';
                if (lib.includes('hexis')) return 'Hexis';
                if (lib.includes('kpmf')) return 'KPMF';
                if (lib.includes('oracal')) return 'Oracal';
                if (lib.includes('inozetek')) return 'Inozetek';
                if (lib.includes('arlon')) return 'Arlon';
                if (lib.includes('teckwrap')) return 'TeckWrap';
                if (lib.includes('vvivid')) return 'VViViD';
                return mfr || '';
              })()}
              colorName={selectedSwatch?.name && selectedSwatch.name !== 'Unknown' ? selectedSwatch.name : 'Custom Color'}
              productCode={(selectedSwatch as any)?.code || (selectedSwatch as any)?.productCode || ''}
              finish={selectedFinish}
              hex={selectedSwatch?.hex}
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
              ...(allViews?.find(v => v.type === 'side') ? [{ type: 'side', url: allViews.find(v => v.type === 'side')!.url, label: 'Driver Side' }] : []),
              ...(allViews?.find(v => v.type === 'passenger-side') ? [{ type: 'passenger-side', url: allViews.find(v => v.type === 'passenger-side')!.url, label: 'Passenger Side' }] : []),
              ...(allViews?.find(v => v.type === 'front') ? [{ type: 'front', url: allViews.find(v => v.type === 'front')!.url, label: 'Front' }] : []),
              ...(allViews?.find(v => v.type === 'rear') ? [{ type: 'rear', url: allViews.find(v => v.type === 'rear')!.url, label: 'Rear' }] : []),
              ...(allViews?.find(v => v.type === 'hood_detail') ? [{ type: 'hood_detail', url: allViews.find(v => v.type === 'hood_detail')!.url, label: 'Hood' }] : []),
              ...(generatedImageUrl ? [{ type: 'roof', url: generatedImageUrl, label: 'Roof' }] : []),
            ].filter(v => v.url)}
            vehicleYear={year}
            vehicleMake={make}
            vehicleModel={model}
            toolKey="colorpro"
            designName={(selectedSwatch as any)?.name || 'Color Wrap'}
            manufacturer={(() => {
              const mfr = (selectedSwatch as any)?.manufacturer;
              if (mfr && mfr !== 'Unknown' && mfr !== 'Custom') return mfr;
              const lib = (selectedSwatch as any)?.colorLibrary?.toLowerCase() || '';
              if (lib.includes('avery')) return 'Avery Dennison';
              if (lib.includes('3m')) return '3M';
              if (lib.includes('hexis')) return 'Hexis';
              if (lib.includes('kpmf')) return 'KPMF';
              if (lib.includes('oracal')) return 'Oracal';
              if (lib.includes('inozetek')) return 'Inozetek';
              return mfr || '';
            })()}
            colorName={(selectedSwatch as any)?.name}
            finish={(selectedSwatch as any)?.finish || 'Gloss'}
            hex={(selectedSwatch as any)?.hex}
          />
        </DialogContent>
      </Dialog>

      {/* Persistent floating QuickQuote button — always reachable
          regardless of scroll position so the rep can open quote
          pricing at any point in the design flow. Stacked ABOVE the
          existing EstimatorDrawer pill (which sits at bottom-6) so
          the two floating actions don't overlap. */}
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

      {/* QuickQuote — same card the dashboard uses, mounted in a
          left side panel so the render stays visible and interactive
          on the right. Pre-seeded with vehicle, render, finish + any
          precision-mod upsells (chrome delete, carbon accent, window
          tint, …) the user already stacked, so the price moves in
          lock-step with the design. */}
      <QuickQuoteSidePanel
        open={showQuickQuote}
        onClose={() => setShowQuickQuote(false)}
        toolName="ColorPro"
      >
        <QuickQuoteCard
          initial={{
            year: year || undefined,
            make: make || undefined,
            model: model || undefined,
            finish: selectedFinish || undefined,
            designName: selectedSwatch?.name || undefined,
            renderUrl: precisionRenderUrl ?? generatedImageUrl ?? undefined,
            extraCustomLines: colorEstimator.state.items
              .filter((i) => i.source === "upsell")
              .map((i) => ({
                label: i.label,
                price: i.qty * i.unitPrice,
              })),
          }}
        />
      </QuickQuoteSidePanel>

      {/* Legacy QuickQuote Preview Dialog — kept for backwards-compat with
          the floating estimator's "Open quote editor" callback. */}
      <Dialog open={showEstimatorPreview} onOpenChange={setShowEstimatorPreview}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 bg-background border-border">
          {(!year || !make || !model) ? (
            <div className="p-6 text-center space-y-2">
              <Calculator className="w-8 h-8 mx-auto text-muted-foreground" />
              <p className="text-sm font-semibold text-foreground">Enter Vehicle Details First</p>
              <p className="text-xs text-muted-foreground">Fill in year, make, and model above to get an accurate wrap estimate.</p>
            </div>
          ) : (
            <div className="p-4">
              <QuickQuoteEditor
                year={year}
                make={make}
                model={model}
                finish={selectedFinish || "Gloss"}
                colorName={selectedSwatch?.name || ""}
                manufacturer={(() => {
                  if (!selectedSwatch) return "";
                  const mfr = (selectedSwatch as any)?.manufacturer;
                  if (mfr && mfr !== 'Unknown' && mfr !== 'Custom') return mfr;
                  const lib = (selectedSwatch as any)?.colorLibrary?.toLowerCase() || '';
                  if (lib.includes('avery')) return 'Avery Dennison';
                  if (lib.includes('3m')) return '3M';
                  return mfr || '';
                })()}
                colorHex={selectedSwatch?.hex || ""}
                productCode={(selectedSwatch as any)?.code || (selectedSwatch as any)?.productCode || ""}
                swatchImageUrl={(selectedSwatch as any)?.swatch_url || (selectedSwatch as any)?.media_url || ""}
                renderUrl={generatedImageUrl || null}
                visualizationId={visualizationId || null}
                quoteMode={qqQuoteMode}
                onQuoteModeChange={setQqQuoteMode}
                quantity={qqQuantity}
                onQuantityChange={setQqQuantity}
                category={qqCategory}
                onCategoryChange={setQqCategory}
                selectedAddOns={qqAddOns}
                onAddOnsChange={setQqAddOns}
                includeLabor={qqIncludeLabor}
                onIncludeLaborChange={setQqIncludeLabor}
                includeMargin={qqIncludeMargin}
                onIncludeMarginChange={setQqIncludeMargin}
                marginPercent={qqMarginPercent}
                onMarginPercentChange={setQqMarginPercent}
                customerName={qqCustomerName}
                onCustomerNameChange={setQqCustomerName}
                customerEmail={qqCustomerEmail}
                onCustomerEmailChange={setQqCustomerEmail}
                customerPhone={qqCustomerPhone}
                onCustomerPhoneChange={setQqCustomerPhone}
                companyName={qqCompanyName}
                onCompanyNameChange={setQqCompanyName}
                onQuoteUpdate={(data) => setEmailQuoteData(data)}
                onEmailQuote={() => {
                  setShowEstimatorPreview(false);
                  setEmailInitialType("quote");
                  setShowEmailConfigurator(true);
                }}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Email Configurator */}
      <EmailConfigurator
        isOpen={showEmailConfigurator}
        onClose={() => setShowEmailConfigurator(false)}
        year={year}
        make={make}
        model={model}
        finish={selectedFinish || "Gloss"}
        colorName={selectedSwatch?.name || "Custom Color"}
        manufacturer={(() => {
          const mfr = (selectedSwatch as any)?.manufacturer;
          if (mfr && mfr !== 'Unknown' && mfr !== 'Custom') return mfr;
          const lib = (selectedSwatch as any)?.colorLibrary?.toLowerCase() || '';
          if (lib.includes('avery')) return 'Avery Dennison';
          if (lib.includes('3m')) return '3M';
          if (lib.includes('hexis')) return 'Hexis';
          if (lib.includes('kpmf')) return 'KPMF';
          if (lib.includes('oracal')) return 'Oracal';
          if (lib.includes('inozetek')) return 'Inozetek';
          if (lib.includes('teckwrap')) return 'TeckWrap';
          if (lib.includes('vvivid')) return 'VViViD';
          return mfr || '';
        })()}
        colorHex={selectedSwatch?.hex || ""}
        productCode={(selectedSwatch as any)?.code || (selectedSwatch as any)?.productCode || ""}
        swatchImageUrl={(selectedSwatch as any)?.swatch_url || (selectedSwatch as any)?.media_url || ""}
        views={allViews.map(v => ({
          type: v.type,
          url: v.url,
          label: {
            side: 'Driver Side', 'driver-side': 'Driver Side', 'passenger-side': 'Passenger Side',
            hood_detail: 'Hood', front: 'Front', rear: 'Rear', 'close-up': 'Close-Up', roof: 'Roof',
          }[v.type] || v.type,
        }))}
        heroImageUrl={generatedImageUrl}
        renderUrl={generatedImageUrl}
        visualizationId={visualizationId}
        customerName={qqCustomerName}
        customerEmail={qqCustomerEmail}
        onOpenQuoteEditor={() => setShowEstimatorPreview(true)}
        externalQuoteData={emailQuoteData}
        initialEmailType={emailInitialType}
      />

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
          color_name: selectedSwatch?.name,
          finish_type: selectedFinish,
        } : null}
      />

      {/* ColorPro Studio - fullscreen branded experience */}
      <StudioProofLayout
        toolName="ColorPro™"
        designName={`${(() => {
          const mfr = (selectedSwatch as any)?.manufacturer;
          if (mfr && mfr !== 'Unknown' && mfr !== 'Custom') return mfr;
          const lib = (selectedSwatch as any)?.colorLibrary?.toLowerCase() || '';
          if (lib.includes('avery')) return 'Avery Dennison';
          if (lib.includes('3m')) return '3M';
          return mfr || '';
        })()} ${selectedSwatch?.name || 'Custom Color'} ${selectedFinish}`.trim()}
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
        manufacturer={(() => {
          const mfr = (selectedSwatch as any)?.manufacturer;
          if (mfr && mfr !== 'Unknown' && mfr !== 'Custom') return mfr;
          const lib = (selectedSwatch as any)?.colorLibrary?.toLowerCase() || '';
          if (lib.includes('avery')) return 'Avery Dennison';
          if (lib.includes('3m')) return '3M';
          if (lib.includes('hexis')) return 'Hexis';
          if (lib.includes('kpmf')) return 'KPMF';
          if (lib.includes('oracal')) return 'Oracal';
          if (lib.includes('inozetek')) return 'Inozetek';
          return mfr || '';
        })()}
        colorName={selectedSwatch?.name && selectedSwatch.name !== 'Unknown' ? selectedSwatch.name : undefined}
        finish={selectedFinish}
        productCode={(selectedSwatch as any)?.code || (selectedSwatch as any)?.productCode || undefined}
        hex={selectedSwatch?.hex}
        coverageUnit="yards"
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
          designName: selectedSwatch?.name,
          finishType: selectedFinish,
          defaultMode: "sign_only",
        }}
      />

      {/* Floating QuickQuote Estimator — always available during design.
          Pricing is built up by the shop owner via upsells / catalog
          adds / manual lines, not auto-derived from renders. Vehicle
          context auto-populates on the estimator header. */}
      <div className="fixed bottom-6 right-6 z-40">
        <EstimatorDrawer
          value={colorEstimator.state}
          onChange={colorEstimator.setState}
          onSaveDraft={handleColorEstimatorSaveDraft}
          onSend={handleColorEstimatorSend}
          onCheckoutOnWpw={isWpwShop ? handleColorCheckoutOnWpw : undefined}
          trigger={
            <OpenEstimatorButton
              state={colorEstimator.state}
              label="Estimator"
              className="h-11 px-4 shadow-lg shadow-black/40 backdrop-blur-sm"
            />
          }
        />
      </div>
    </>
  );
};
