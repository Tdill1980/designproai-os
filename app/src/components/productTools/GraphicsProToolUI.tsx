import { useState, useRef, useEffect } from "react";
import { usePreloadRender } from "@/hooks/usePreloadRender";
import { useToast } from "@/hooks/use-toast";
import { useGraphicsProLogic } from "@/hooks/useGraphicsProLogic";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useRevisionHistory } from "@/hooks/useRevisionHistory";
import { useProductionFiles } from "@/hooks/useProductionFiles";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PaywallModal } from "@/components/PaywallModal";
import { LoginRequiredModal } from "@/components/LoginRequiredModal";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { ProfessionalProofSheet } from "@/components/tools/ProfessionalProofSheet";
import { QuickQuoteCard } from "@/components/dashboard/QuickQuoteCard";
import { QuickQuoteSidePanel } from "@/components/quote/QuickQuoteSidePanel";
import { PrecisionModButtons } from "@/components/quote/PrecisionModButtons";
import type {
  PrecisionModResult,
  PrecisionModification,
} from "@/hooks/usePrecisionModifications";
import { MobileProofSheet } from "@/components/tools/MobileProofSheet";
import { TwoDProofSheet } from "@/components/tools/TwoDProofSheet";
import { StudioProofLayout } from "@/components/tools/StudioProofLayout";
import { VehicleTypeSelector, isNonStandardVehicle } from "@/components/tools/VehicleTypeSelector";
import { NonStandardVehicleWarning } from "@/components/tools/NonStandardVehicleWarning";
import { NonStandardVehicleLookup } from "@/components/tools/NonStandardVehicleLookup";
import { DesignRevisionPrompt } from "@/components/tools/DesignRevisionPrompt";
import { BeforeAfterSlider } from "@/components/gallery/BeforeAfterSlider";
import { RevisionHistoryTimeline } from "@/components/tools/RevisionHistoryTimeline";
import { ProductionFilesPanel } from "@/components/graphicspro/ProductionFilesPanel";
import { ProductionUpgradePrompt } from "@/components/graphicspro/ProductionUpgradePrompt";
import { CutGraphicsProofSheet } from "@/components/graphicspro/CutGraphicsProofSheet";
import { useCutGraphicsProof } from "@/hooks/useCutGraphicsProof";
import { MarkAsPerfectButton } from "@/components/MarkAsPerfectButton";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  X, ChevronDown, RefreshCw, Car,
  Wand2, Loader2, Eye, Download, ClipboardSignature, History, Lightbulb, Check, FileCode, Package, Scissors, Edit3, Settings, Upload, ImagePlus, Trash2, Layers, Calculator, Copy, Ruler, RotateCw, Send
} from "lucide-react";
import { useCutFiles } from "@/hooks/useCutFiles";
import { ProductionPackDialog } from "@/components/designpanelpro/ProductionPackDialog";
import { SendToApproveProDialog } from "@/components/proof/SendToApproveProDialog";
import { cn } from "@/lib/utils";
import { GenerationWizard, GRAPHICSPRO_TIPS } from "@/components/tools/GenerationWizard";
import { useIsMobile } from "@/hooks/use-mobile";
import { useNavigate } from "react-router-dom";
import { RenderOverlay } from "@/components/tools/RenderOverlay";
import { downloadWithOverlay, downloadAllWithOverlay, OverlaySpec } from "@/lib/download-with-overlay";
import { supabase } from "@/integrations/supabase/client";
import { MyVehicleProToggle } from "@/components/tools/MyVehicleProToggle";
import { MyVehicleProInline } from "@/components/tools/MyVehicleProInline";
import { useMyVehicleMode } from "@/hooks/useMyVehicleMode";
import { useMyVehicleGenerate } from "@/hooks/useMyVehicleGenerate";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import { Camera } from "lucide-react";

// V1 Preset images - only the 8 we need
import presetRacingStripes from "@/assets/presets/racing-stripes.png";
import presetChromeDelete from "@/assets/presets/chrome-delete.png";
import presetBlackedOut from "@/assets/presets/blacked-out.png";
import presetCarbonHood from "@/assets/presets/carbon-hood.png";
import presetRoofWrap from "@/assets/presets/roof-wrap.png";
import presetFullBlackout from "@/assets/presets/full-blackout.png";
import rockerGlow from "/assets/stripes/rocker_glow.png";
import beltlineGlow from "/assets/stripes/beltline_glow.png";
import { DesignProductsCompareCard } from "@/components/quote/DesignProductsCompareCard";

// Preset type definition
interface Preset {
  id?: string;
  label: string;
  prompt: string;
  preview: string;
  locked?: boolean; // V1: locked presets cannot be edited
}

// V1 PRESETS - 8 predictable, tested presets only
const V1_PRESETS: Preset[] = [
  { 
    id: "racing_stripes",
    label: "Racing Stripes", 
    prompt: "dual white racing stripes from hood to trunk on gloss black body", 
    preview: presetRacingStripes,
    locked: true 
  },
  { 
    id: "chrome_delete",
    label: "Chrome Delete", 
    prompt: "chrome delete matte black on all chrome trim", 
    preview: presetChromeDelete,
    locked: true 
  },
  { 
    id: "blacked_out",
    label: "Blacked Out", 
    prompt: "murdered out gloss black with matte black chrome delete", 
    preview: presetBlackedOut,
    locked: true 
  },
  { 
    id: "carbon_hood",
    label: "Carbon Hood", 
    prompt: "gloss carbon fiber hood with black weave pattern", 
    preview: presetCarbonHood,
    locked: true 
  },
  { 
    id: "roof_wrap",
    label: "Roof Wrap", 
    prompt: "gloss carbon fiber roof wrap only", 
    preview: presetRoofWrap,
    locked: true 
  },
  { 
    id: "full_blackout",
    label: "Full Blackout", 
    prompt: "full blackout package gloss black roof, mirror caps, chrome delete, window trim, all badges", 
    preview: presetFullBlackout,
    locked: true 
  },
  { 
    id: "rocker_stripe",
    label: "Rocker Stripe", 
    prompt: "clean vinyl rocker stripe along lower body, solid vinyl only", 
    preview: rockerGlow,
    locked: true 
  },
  { 
    id: "beltline_stripe",
    label: "Beltline Stripe", 
    prompt: "clean vinyl beltline stripe along mid-body crease, solid vinyl only", 
    preview: beltlineGlow,
    locked: true 
  },
];

export const GraphicsProToolUI = ({ preloadRenderId, autoOpenQuickQuote }: { preloadRenderId?: string | null; autoOpenQuickQuote?: boolean }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { subscription, checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();
  const {
    vehicleType, setVehicleType, nonStandardSpecs,
    year, setYear,
    make, setMake,
    model, setModel,
    stylingPrompt, setStylingPrompt,
    referenceImageUrl, setReferenceImageUrl,
    referenceImageUrls, setReferenceImageUrls,
    selectedViewType, setSelectedViewType,
    isGenerating,
    generatedImageUrl,
    setGeneratedImageUrl,
    visualizationId,
    allViews,
    isGeneratingAdditional,
    pendingViews,
    showUpgradeModal, setShowUpgradeModal,
    showLoginModal, setShowLoginModal,
    presetCategory: hookPresetCategory,
    setPresetCategory: setHookPresetCategory,
    wrapMethod, setWrapMethod,
    finishOverride, setFinishOverride,
    isCloning,
    cloneDesign,
    vehicleDims,
    isFetchingDims,
    fetchVehicleDims,
    generateRender,
    generateAdditionalViews,
    clearLastRender,
  } = useGraphicsProLogic();

  // MyVehiclePro state
  const mvp = useMyVehicleMode();
  const { mvpIsGenerating, mvpEditedImageUrl, mvpBeforeUrl, mvpMultiViewResults, mvpError, generateOnMyVehicle, clearMyVehicleResults } = useMyVehicleGenerate();

  // Production pipeline
  const {
    productionData,
    isGeneratingProduction,
    subscriptionRequired,
    generateProductionFiles,
    clearProductionFiles
  } = useProductionFiles();

  // Revision system — pass visualizationId so TanStack Query auto-fetches when it changes
  const { revisionHistory, saveRevision } = useRevisionHistory("graphicspro", visualizationId);
  const [previousImageUrl, setPreviousImageUrl] = useState<string | null>(null);
  const [isRevising, setIsRevising] = useState(false);
  const [showRevisionHistory, setShowRevisionHistory] = useState(false);

  const [vehicleInputOpen, setVehicleInputOpen] = useState(true);
  const [yearError, setYearError] = useState(false);
  const [isUploadingReference, setIsUploadingReference] = useState(false);
  const [showProofSheet, setShowProofSheet] = useState(false);
  const [show2DProofSheet, setShow2DProofSheet] = useState(false);
  const [showStudioProof, setShowStudioProof] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [currentTipIndex, setCurrentTipIndex] = useState(0);
  const yearInputRef = useRef<HTMLInputElement>(null);
  const [showProductionDialog, setShowProductionDialog] = useState(false);
  const [showQuickQuote, setShowQuickQuote] = useState(!!autoOpenQuickQuote);

  // Precision mods stack on the displayed render and accumulate as
  // upsell line items. Clicking Chrome Delete / Carbon Accent / Window
  // Tint hits the apply-precision-modification edge function which
  // returns a new render URL with the change visually applied (the
  // existing design is NOT discarded). Each click also adds a row to
  // `precisionUpsellItems` which we forward into QuickQuoteCard so
  // the price moves in lock-step with the design.
  const [precisionRenderUrl, setPrecisionRenderUrl] = useState<string | null>(null);
  const [precisionUpsellItems, setPrecisionUpsellItems] = useState<
    Array<{ key: string; label: string; price: number }>
  >([]);
  useEffect(() => {
    setPrecisionRenderUrl(null);
    setPrecisionUpsellItems([]);
  }, [generatedImageUrl]);
  const handlePrecisionApplied = (
    result: PrecisionModResult,
    mod: PrecisionModification,
  ) => {
    setPrecisionRenderUrl(result.newRenderUrl);
    setPrecisionUpsellItems((prev) => [
      ...prev,
      {
        key: `${mod.key}_${Date.now().toString(36)}`,
        label: result.lineItem.label,
        price: result.lineItem.unitPrice,
      },
    ]);
  };
  const handlePrecisionError = (err: Error, mod: PrecisionModification) => {
    toast({
      title: `Couldn't apply ${mod.label}`,
      description: err.message,
      variant: "destructive",
    });
  };
  const { isGeneratingCutFiles, handleGenerateCutFiles } = useCutFiles();

  // Cut Graphics Proof (Phase 3a) — specs each cut graphic to real scale
  // (W x H + letter height) against GENIE side dims, with 54" plotter nesting.
  const {
    proof: cutGraphicsProof,
    isGenerating: isGeneratingCutProof,
    generateProof: generateCutGraphicsProof,
  } = useCutGraphicsProof();
  const [showCutGraphicsProof, setShowCutGraphicsProof] = useState(false);
  const [showSendToApprove, setShowSendToApprove] = useState(false);

  const handleCutGraphicsProof = async () => {
    // Use the freshest dims — fetchVehicleDims RETURNS them (state won't have
    // updated yet inside this same call).
    let dims = vehicleDims;
    if (!dims?.sideW || !dims?.sideH) {
      toast({
        title: "Resolving vehicle dimensions…",
        description: "Hang tight — GENIE is sizing this vehicle so graphics can be specced to scale.",
      });
      dims = await fetchVehicleDims();
    }
    // Spec from the driver-side view (where cut graphics live); fall back to hero.
    const sideUrl = allViews.find(v => v.type === 'side')?.url || generatedImageUrl;
    if (!sideUrl) {
      toast({ title: "No design available", description: "Generate a design first.", variant: "destructive" });
      return;
    }
    setShowCutGraphicsProof(true);
    await generateCutGraphicsProof({
      renderUrl: sideUrl,
      sideWidthInches: dims?.sideW,
      sideHeightInches: dims?.sideH,
      plotterMaxHeightInches: 59,
      designName: stylingPrompt?.slice(0, 50) || 'Custom Graphics',
      vehicleYear: year,
      vehicleMake: make,
      vehicleModel: model,
    });
  };

  // Preload render from "See in Studio" link
  const { data: preloadRender } = usePreloadRender(preloadRenderId ?? null);
  useEffect(() => {
    if (!preloadRender) return;
    if (preloadRender.vehicle_year) setYear(preloadRender.vehicle_year);
    if (preloadRender.vehicle_make) setMake(preloadRender.vehicle_make);
    if (preloadRender.vehicle_model) setModel(preloadRender.vehicle_model);
    if (preloadRender.prompt) setStylingPrompt(preloadRender.prompt);
    const urls = preloadRender.render_urls ?? {};
    const heroUrl = urls.hero || urls.side || Object.values(urls)[0];
    if (heroUrl) setGeneratedImageUrl(heroUrl);
    toast({ title: "Render loaded", description: "Preloaded from render history" });
  }, [preloadRender]); // eslint-disable-line react-hooks/exhaustive-deps

  // V1: Simplified preset system - no categories, locked presets only
  const [selectedPreset, setSelectedPreset] = useState<Preset | null>(null);
  
  // V1: Simplified preset click handler - just set the locked prompt
  const handlePresetClick = (preset: Preset) => {
    setSelectedPreset(preset);
    setStylingPrompt(preset.prompt);
    
    toast({
      title: "Preset Selected",
      description: preset.label,
      duration: 2000
    });
  };

  // Multi-photo upload handler
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleReferenceUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsUploadingReference(true);
    try {
      const uploadedUrls: string[] = [...referenceImageUrls];
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const fileExt = file.name.split('.').pop() || 'png';
        const filePath = `graphicspro-refs/${Date.now()}-${Math.random().toString(36).slice(2)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('wrap-files')
          .upload(filePath, file, { contentType: file.type });
        if (uploadError) {
          console.error('Upload error:', uploadError);
          continue;
        }
        const { data: urlData } = supabase.storage
          .from('wrap-files')
          .getPublicUrl(filePath);
        if (urlData?.publicUrl) {
          uploadedUrls.push(urlData.publicUrl);
        }
      }
      setReferenceImageUrls(uploadedUrls);
      if (uploadedUrls.length > 0) {
        setReferenceImageUrl(uploadedUrls[0]);
      }
      toast({
        title: "Photos Uploaded",
        description: `${uploadedUrls.length} reference image${uploadedUrls.length !== 1 ? 's' : ''} ready`,
        duration: 3000
      });
    } catch (err) {
      console.error('Reference upload failed:', err);
      toast({ title: "Upload Failed", description: "Please try again", variant: "destructive" });
    } finally {
      setIsUploadingReference(false);
    }
  };

  const removeReferenceImage = (index: number) => {
    const updated = referenceImageUrls.filter((_, i) => i !== index);
    setReferenceImageUrls(updated);
    setReferenceImageUrl(updated.length > 0 ? updated[0] : null);
  };

  // Overlay spec for branded downloads
  const getOverlaySpec = (): OverlaySpec => ({
    toolName: 'GraphicsPro',
    colorOrDesignName: stylingPrompt ? stylingPrompt.slice(0, 60) : undefined,
  });

  // Download individual view
  const handleDownload = async (url: string, viewType: string) => {
    try {
      const overlay = getOverlaySpec();
      const filename = `GraphicsPro-${year}-${make}-${model}-${viewType}`.replace(/\s+/g, '-');
      await downloadWithOverlay(url, filename, overlay);
      toast({ title: "Download started", description: `Downloading ${viewType} view` });
    } catch (error) {
      console.error('Download failed:', error);
      toast({ title: "Download failed", description: "Please try again", variant: "destructive" });
    }
  };

  // Download all views
  const handleDownloadAll = async () => {
    const completedViews = allViews.filter(v => v.url);
    if (completedViews.length === 0) return;
    try {
      const overlay = getOverlaySpec();
      const images = completedViews.map(view => ({
        url: view.url,
        filename: `GraphicsPro-${year}-${make}-${model}-${view.type}`.replace(/\s+/g, '-')
      }));
      await downloadAllWithOverlay(images, overlay);
      toast({ title: "Downloads complete", description: `Downloaded ${images.length} views` });
    } catch (error) {
      console.error('Download all failed:', error);
      toast({ title: "Download failed", description: "Please try again", variant: "destructive" });
    }
  };

  // Generation tips for countdown wizard
  const generationTips = [
    "Pro Tip: Two-tone designs use darker color as base layer",
    "Did you know? Chrome accents require hard-light studio rendering",
    "Pro Tip: Racing stripes should flow hood → roof → trunk continuously",
    "Fun Fact: Proper chrome delete adds 8-12 hours to install time",
    "Pro Tip: OEM stripes follow factory-correct geometry and proportions",
    "Did you know? Multi-layer vinyl creates depth with stacked colors",
    "Pro Tip: Satin finishes hide imperfections better than gloss",
    "Fun Fact: A full wrap can increase vehicle resale value"
  ];

  // Progress steps for wizard - 11 detailed steps for demo-safe filming
  const getProgressSteps = () => [
    { label: "Detecting vehicle model…", completed: elapsedSeconds >= 2 },
    { label: "Reading wrap instructions…", completed: elapsedSeconds >= 4 },
    { label: "Calculating segmentation zones…", completed: elapsedSeconds >= 7 },
    { label: "Locking top/bottom boundaries…", completed: elapsedSeconds >= 9 },
    { label: "Applying upper-zone wrap…", completed: elapsedSeconds >= 11 },
    { label: "Applying lower-zone wrap…", completed: elapsedSeconds >= 14 },
    { label: "Aligning graphics across views…", completed: elapsedSeconds >= 18 },
    { label: "Rendering angle 1…", completed: elapsedSeconds >= 21 },
    { label: "Rendering angle 2…", completed: elapsedSeconds >= 24 },
    { label: "Rendering angle 3…", completed: elapsedSeconds >= 27 },
    { label: "Finalizing details…", completed: elapsedSeconds >= 30 }
  ];

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
        setCurrentTipIndex(prev => (prev + 1) % generationTips.length);
      }, 5000);
      return () => clearInterval(tipInterval);
    }
  }, [isGenerating, isRevising, generationTips.length]);

  // Revision handler
  const handleRevisionSubmit = async (revisionPrompt: string) => {
    if (!generatedImageUrl) return;
    
    const previousUrl = generatedImageUrl;
    setPreviousImageUrl(previousUrl);
    setIsRevising(true);
    
    try {
      const result = await generateRender(revisionPrompt);
      
      if (result.success && result.imageUrl) {
        await saveRevision({
          viewType: selectedViewType,
          originalUrl: previousUrl,
          revisedUrl: result.imageUrl,
          revisionPrompt,
          designId: visualizationId || undefined
        });
        
        toast({
          title: "Revision Applied",
          description: "Your design has been updated.",
          duration: 3000
        });
      }
    } finally {
      setIsRevising(false);
    }
  };

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
      generateAdditionalViews();
    }
    if (!generatedImageUrl) {
      autoFireRef.current = false;
    }
  }, [generatedImageUrl, allViews.length, isGeneratingAdditional]);

  // Resolve GENIE vehicle dimensions for designs that arrive WITHOUT a fresh
  // render (preloaded "See in Studio", cloned design). The render path already
  // fires fetchVehicleDims; this covers the gap without double-firing.
  const dimsFetchRef = useRef(false);
  useEffect(() => {
    if (generatedImageUrl && make && model && !vehicleDims && !isFetchingDims && !dimsFetchRef.current) {
      dimsFetchRef.current = true;
      fetchVehicleDims();
    }
    if (!generatedImageUrl) {
      dimsFetchRef.current = false;
    }
  }, [generatedImageUrl, make, model, vehicleDims, isFetchingDims]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!validateYear()) return;

    // ─── MyVehiclePro Mode: render on the customer's uploaded photo(s) AND
    //     then fall through to the studio render so the full 7-angle set still
    //     shows in studio view (the on-photo proof + the studio angles). ───
    if (mvp.isMyVehicleMode) {
      if (!mvp.hasPhotos) {
        toast({ title: "No photo uploaded", description: "Upload a photo of your vehicle first", variant: "destructive" });
        return;
      }
      if (!make || !model) {
        toast({ title: "Vehicle required", description: "Please enter year, make, and model", variant: "destructive" });
        return;
      }

      const colorData: Record<string, any> = {
        colorName: stylingPrompt || "Custom Graphics",
        hex: "#808080",
        finish: "gloss",
        toolSource: "GraphicsPro",
        customStylingPrompt: stylingPrompt,
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
        toast({ title: "Applied to your vehicle!", description: "Graphics on your photo — also building the studio angles.", duration: 4000 });
        document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        toast({ title: "Generation Failed", description: mvpError || "Please try again", variant: "destructive" });
      }
      // DON'T return — keep the design on the customer's provided photo(s) AND
      // fall through to the studio render so the full 7-angle set is generated
      // (studio fills in every angle the uploaded photos don't cover). The
      // on-photo proof (mvpMultiViewResults) and the studio angles (allViews)
      // live in separate state, so both show.
    }

    // ─── Studio Mode: generate studio render (also runs after MyVehiclePro so
    //     studio covers any angles the uploaded photos are missing) ───
    const result = await generateRender();

    if (result.success) {
      toast({
        title: "Design Generated!",
        description: "Your custom wrap design is ready. Generate more views for additional angles.",
        duration: 4000
      });
      document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (result.error === 'print_required') {
      toast({
        title: "This Design Requires Printing",
        description: "GraphicsPro handles color-change film only. Redirecting to DesignPro...",
        duration: 5000
      });
      setTimeout(() => navigate('/designpro'), 2000);
    }
  };

  const handleGenerateAdditional = async () => {
    const result = await generateAdditionalViews();
    if (result.success) {
      toast({
        title: "All Views Complete",
        description: `Generated ${result.views?.length || 0} total views!`,
        duration: 3000
      });
    }
  };

  // Duplicate the current design into a new editable copy. Pure DB copy —
  // no regeneration, no render credits — so the user can branch off the
  // design they like and revise the copy while keeping the original.
  const handleCloneDesign = async () => {
    const result = await cloneDesign();
    if (result.success) {
      // Scroll back to the preview so the (identical) duplicate is in view.
      document.getElementById('preview-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <>
      <div className="w-full bg-background overflow-x-hidden">
        <div className="bg-background">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 py-2">
            {/* Wide hero banner with tool name overlay */}
            <div className="relative rounded-xl overflow-hidden border border-blue-500/30">
              <img
                src="/hero-mustang.jpg"
                alt="GraphicsPro banner"
                className="w-full h-32 sm:h-40 md:h-48 object-cover object-center"
              />
              {/* Dark gradient overlay for text readability */}
              <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />
              {/* Tool name + info overlay */}
              <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-6">
                <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-2">
                  <div className="flex items-center gap-3">
                    <div className="relative flex-shrink-0">
                      <Settings className="w-8 h-8 sm:w-10 sm:h-10 text-blue-400 drop-shadow-lg" />
                      <ClipboardSignature className="w-5 h-5 sm:w-6 sm:h-6 text-fuchsia-400 absolute -bottom-1 -right-1 drop-shadow-lg" />
                    </div>
                    <div>
                      <h2 className="text-2xl sm:text-3xl md:text-4xl tracking-wide drop-shadow-lg">
                        <span className="text-white font-bold">Graphics</span>
                        <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent font-bold">Pro™</span>
                      </h2>
                      <p className="text-xs sm:text-sm md:text-base text-white/70 italic drop-shadow-md">
                        Multi-Zone Wraps • Two-Tone • Racing Stripes • Chrome Delete
                      </p>
                    </div>
                  </div>
                  <p className="text-xs sm:text-sm text-white/60 drop-shadow-md">
                    Powered by{" "}
                    <span className="font-bold">
                      <span className="text-white/90">Wrap</span>
                      <span className="bg-gradient-to-r from-blue-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent">Command AI®</span>
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-3 sm:px-4">
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
              <Card className="bg-secondary border-border/30 rounded-xl p-3 mb-3">
                <div className="flex items-center justify-between mb-2">
                  <CollapsibleTrigger className="flex-1">
                    <div className="flex items-center gap-2">
                      <Car className="w-4 h-4" />
                      <span className="text-sm font-semibold">Vehicle Details</span>
                      <ChevronDown className={cn("w-4 h-4 transition-transform", vehicleInputOpen && "rotate-180")} />
                    </div>
                  </CollapsibleTrigger>
                  {(year || make || model) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setYear('');
                        setMake('');
                        setModel('');
                        toast({
                          title: "Vehicle Cleared",
                          description: "Click an OEM preset to autofill a suggested vehicle.",
                          duration: 3000
                        });
                      }}
                      className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Clear
                    </Button>
                  )}
                </div>

                <CollapsibleContent>
                  {/* Vehicle type — push-button per class */}
                  <div className="mt-2 mb-3">
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
                      className="mt-2"
                    />
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-2">
                      <div>
                        <Label htmlFor="year" className="text-xs text-muted-foreground mb-1">Year</Label>
                        <Input
                          ref={yearInputRef}
                          id="year"
                          placeholder="2024"
                          value={year}
                          onChange={(e) => { setYear(e.target.value); setYearError(false); }}
                          className={cn("bg-background border-2 text-foreground", yearError && "border-red-500 animate-pulse")}
                        />
                      </div>
                      <div>
                        <Label htmlFor="make" className="text-xs text-muted-foreground mb-1">Make</Label>
                        <Input
                          id="make"
                          placeholder="Tesla"
                          value={make}
                          onChange={(e) => setMake(e.target.value)}
                          className="bg-background border-2 text-foreground"
                        />
                      </div>
                      <div>
                        <Label htmlFor="model" className="text-xs text-muted-foreground mb-1">Model</Label>
                        <Input
                          id="model"
                          placeholder="Model S"
                          value={model}
                          onChange={(e) => setModel(e.target.value)}
                          className="bg-background border-2 text-foreground"
                        />
                      </div>
                    </div>
                  )}
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </MyVehicleProToggle>
        </div>

        <div className="max-w-7xl mx-auto px-3 sm:px-4 pb-24">
          <div className="flex flex-col lg:grid lg:grid-cols-[400px_1fr] gap-4">
            {/* Left Panel - Design Input */}
            <div className="space-y-4">
              {/* V1 Quick Presets - 8 locked presets, no categories */}
              <Card className="p-4 bg-secondary/20 border-border">
                <Label className="text-sm font-semibold mb-3 block">Select a Style</Label>
                
                {/* V1 Preset Grid - All 8 presets in one view */}
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2">
                  {V1_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => handlePresetClick(preset)}
                      className={cn(
                        "rounded-lg text-xs font-medium transition-all flex flex-col items-center border overflow-hidden min-h-[44px]",
                        selectedPreset?.id === preset.id
                          ? "border-blue-500 ring-2 ring-blue-500/30"
                          : "border-border/50 hover:border-blue-500/50"
                      )}
                    >
                      <img src={preset.preview} alt={preset.label} className="w-full h-16 object-cover" />
                      <span className="text-center py-2 px-1 text-foreground/80">{preset.label}</span>
                    </button>
                  ))}
                </div>
                
                {/* Selected preset indicator */}
                {selectedPreset && (
                  <div className="mt-3 p-2 bg-blue-500/10 rounded-lg border border-blue-500/30">
                    <p className="text-xs text-blue-400">
                      <span className="font-semibold">Active: </span>{selectedPreset.label}
                    </p>
                  </div>
                )}
              </Card>

              {/* V1: Prompt is read-only from preset selection */}
              {selectedPreset && (
                <Card className="p-4 bg-blue-500/5 border-blue-500/30">
                  <Label className="text-sm font-semibold mb-2 block">Design Description</Label>
                  <p className="text-sm text-foreground/80 italic p-3 bg-background/50 rounded-lg border border-border/30">
                    "{selectedPreset.prompt}"
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Custom prompts coming soon
                  </p>
                </Card>
              )}

              {/* Reference Photo Upload (multi) */}
              <Card className="p-4 bg-secondary/20 border-border">
                <Label className="text-sm font-semibold mb-3 block">Reference Photos (Optional)</Label>
                <p className="text-xs text-muted-foreground mb-3">
                  Upload one or more reference images to guide the AI design.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleReferenceUpload(e.target.files)}
                />
                <Button
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isUploadingReference}
                  className="w-full gap-2 border-dashed border-2"
                >
                  {isUploadingReference ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</>
                  ) : (
                    <><ImagePlus className="h-4 w-4" /> Add Reference Photos</>
                  )}
                </Button>
                {referenceImageUrls.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    {referenceImageUrls.map((url, idx) => (
                      <div key={idx} className="relative group rounded-lg overflow-hidden border border-border">
                        <img src={url} alt={`Reference ${idx + 1}`} className="w-full h-16 object-cover" />
                        <button
                          onClick={() => removeReferenceImage(idx)}
                          className="absolute top-1 right-1 bg-black/70 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3 w-3 text-white" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Wrap Method + Finish — explicit user choice so the AI
                  doesn't default to chrome or pick a manufacturer film
                  based on a stray keyword in the prompt. */}
              <Card className="p-4 bg-secondary/20 border-border space-y-4">
                <div>
                  <Label className="text-sm font-semibold mb-2 block">Wrap Method</Label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {([
                      { value: 'cut', label: 'Cut Vinyl Film', hint: 'Solid color / two-tone' },
                      { value: 'printed', label: 'Printed & Cut', hint: 'Full-color graphics' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setWrapMethod(opt.value)}
                        className={cn(
                          "px-3 py-3 rounded-lg text-xs font-medium transition-all min-h-[48px] flex flex-col items-center justify-center",
                          wrapMethod === opt.value
                            ? "bg-blue-500 text-white"
                            : "bg-background/50 text-foreground hover:bg-background"
                        )}
                      >
                        <span>{opt.label}</span>
                        <span className={cn("text-[10px] mt-0.5", wrapMethod === opt.value ? "text-white/80" : "text-muted-foreground")}>
                          {opt.hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-semibold mb-2 block">Finish</Label>
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      { value: 'auto', label: 'Auto' },
                      { value: 'gloss', label: 'Gloss' },
                      { value: 'satin', label: 'Satin' },
                      { value: 'matte', label: 'Matte' },
                      { value: 'metallic', label: 'Metallic' },
                      { value: 'carbon', label: 'Carbon' },
                      { value: 'chrome', label: 'Chrome' },
                    ] as const).map(opt => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setFinishOverride(opt.value)}
                        className={cn(
                          "px-2 py-2 rounded-lg text-xs font-medium transition-all min-h-[40px]",
                          finishOverride === opt.value
                            ? "bg-blue-500 text-white"
                            : "bg-background/50 text-foreground hover:bg-background"
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-2">
                    Chrome is only used when you pick it here. "Auto" reads finish from your prompt.
                  </p>
                </div>
              </Card>

              {/* View Type Selector */}
              <Card className="p-4 bg-secondary/20 border-border">
                <Label className="text-sm font-semibold mb-3 block">Initial View Angle</Label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                  {(['hood_detail', 'side', 'front', 'rear', 'top'] as const).map((view) => (
                    <button
                      key={view}
                      onClick={() => setSelectedViewType(view)}
                      className={cn(
                        "px-2 py-3 rounded-lg text-xs font-medium transition-all min-h-[44px]",
                        selectedViewType === view
                          ? "bg-blue-500 text-white"
                          : "bg-background/50 text-foreground hover:bg-background"
                      )}
                    >
                      {view === 'hood_detail' ? 'Hood' : view.charAt(0).toUpperCase() + view.slice(1)}
                    </button>
                  ))}
                </div>
              </Card>

              {/* Generate Button */}
              <Button
                onClick={handleGenerate}
                disabled={
                  (isGenerating || mvpIsGenerating) ||
                  !stylingPrompt?.trim() ||
                  (!year || !make || !model)
                }
                className={cn(
                  "w-full bg-gradient-to-r from-blue-500 to-purple-500 hover:from-blue-600 hover:to-purple-600 text-white font-bold py-6 text-lg",
                  !(isGenerating || mvpIsGenerating) && "animate-pulse-glow hover:shadow-[0_0_40px_rgba(56,189,248,0.9)]",
                  (isGenerating || mvpIsGenerating) && "opacity-90"
                )}
              >
                {(isGenerating || mvpIsGenerating) ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    {mvpIsGenerating ? "Visualizing on My Vehicle..." : `Generating... (${elapsedSeconds}s)`}
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-5 w-5" />
                    {mvp.isMyVehicleMode && mvp.hasPhotos
                      ? "Visualize on My Vehicle"
                      : (generatedImageUrl ? "Generate NEW Design" : "Generate Design")}
                  </>
                )}
              </Button>

              {/* QuickQuote — sq-ft pricing handoff. Same structure as
                  before (price logic + design-products compare lives in
                  QuickQuoteCard) — just relocated up here so the rep
                  can reach it without scrolling past the render, matching
                  ColorPro/DesignPro placement. Gated until vehicle +
                  render exist so the sq-ft estimator has its inputs. */}
              {year && make && model && generatedImageUrl && (
                <>
                  <DesignProductsCompareCard className="my-2" />
                  <Button
                    onClick={() => setShowQuickQuote(true)}
                    className="w-full bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90 text-white font-bold"
                  >
                    <Calculator className="w-4 h-4 mr-2" />
                    Open QuickQuote — Sq Ft Pricing & Quote
                  </Button>
                </>
              )}

              {generatedImageUrl && (
                <Button
                  onClick={clearLastRender}
                  variant="outline"
                  className="w-full"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Clear & Start New Design
                </Button>
              )}
            </div>

            {/* Right Panel - Preview */}
            <div id="preview-section" className="space-y-4">
              {/* Non-standard vehicle validation warning — blocks production until verified */}
              {nonStandardSpecs && generatedImageUrl && (
                <NonStandardVehicleWarning specs={nonStandardSpecs} />
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
                            swatchName={stylingPrompt ? stylingPrompt.slice(0, 30) : "Graphics"}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <BeforeAfterViewer
                      beforeUrl={mvpBeforeUrl}
                      afterUrl={mvpEditedImageUrl}
                      beforeLabel="Your Vehicle"
                      afterLabel={stylingPrompt ? stylingPrompt.slice(0, 40) : "Graphics"}
                      swatchName={stylingPrompt ? stylingPrompt.slice(0, 30) : "Graphics"}
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

              {isGenerating && (
                <GenerationWizard
                  elapsedSeconds={elapsedSeconds}
                  tips={GRAPHICSPRO_TIPS}
                  currentTipIndex={currentTipIndex}
                  toolName="GraphicsPro"
                  gradientFrom="from-blue-500"
                  gradientTo="to-purple-500"
                />
              )}

              {!isGenerating && generatedImageUrl && (
                <>
                  <Card className="overflow-hidden border-border relative group">
                    <img
                      src={precisionRenderUrl ?? generatedImageUrl}
                      alt="Generated wrap design"
                      className="w-full h-auto"
                    />
                    {/* Tool branding overlay */}
                    <RenderOverlay
                      toolName="GraphicsPro"
                      colorOrDesignName={`${year} ${make} ${model}`}
                    />
                    {/* Download on hover */}
                    <div className="absolute bottom-3 right-3 flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                      <div
                        onClick={() => handleDownload(generatedImageUrl, selectedViewType)}
                        className="bg-background/90 backdrop-blur-sm rounded-full p-2.5 hover:bg-background cursor-pointer"
                        title="Download this view"
                      >
                        <Download className="h-5 w-5 text-foreground" />
                      </div>
                    </div>
                  </Card>

                  {/* Additional Views Grid with Skeletons */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                    {/* Rendered views */}
                    {allViews.map((view) => (
                      <Card key={view.type} className="overflow-hidden border-border relative group">
                        <img src={view.url} alt={view.type} className="w-full h-auto" />
                        {/* Download on hover */}
                        <div className="absolute bottom-8 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity z-30">
                          <div
                            onClick={() => handleDownload(view.url, view.type)}
                            className="bg-background/90 backdrop-blur-sm rounded-full p-2 hover:bg-background cursor-pointer"
                            title={`Download ${view.type} view`}
                          >
                            <Download className="h-4 w-4 text-foreground" />
                          </div>
                        </div>
                        <div className="p-2 text-center text-xs font-medium capitalize bg-secondary/50">
                          {view.type.replace('_', ' ')}
                        </div>
                      </Card>
                    ))}
                    
                    {/* Skeleton placeholders for pending views */}
                    {pendingViews.map((viewType) => (
                      <Card key={viewType} className="overflow-hidden border-border">
                        <div className="aspect-video bg-muted animate-pulse flex items-center justify-center">
                          <div className="text-center">
                            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                            <span className="text-xs text-muted-foreground mt-1 block capitalize">
                              {viewType}...
                            </span>
                          </div>
                        </div>
                        <div className="p-2 text-center text-xs font-medium capitalize bg-secondary/50">
                          {viewType.replace('_', ' ')}
                        </div>
                      </Card>
                    ))}
                  </div>

                  {/* Download All Views */}
                  {allViews.filter(v => v.url).length > 1 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-border">
                      <p className="text-sm text-muted-foreground">
                        {allViews.filter(v => v.url).length} views generated
                      </p>
                      <Button
                        onClick={handleDownloadAll}
                        size="lg"
                        className="min-w-[200px] bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white"
                      >
                        <Download className="mr-2 h-4 w-4" />
                        Download All Views
                      </Button>
                    </div>
                  )}

                  {/* MyVehiclePro inline — try this graphic on YOUR vehicle */}
                  {generatedImageUrl && !mvp.isMyVehicleMode && (
                    <MyVehicleProInline
                      modeType="graphicspro"
                      finishType="Gloss"
                      vehicleYear={year}
                      vehicleMake={make}
                      vehicleModel={model}
                      renderUrl={generatedImageUrl}
                    />
                  )}

                  {/* Vehicle Dimensions — resolved by the GENIE Universal
                      Panelizer (real per-surface inches). Unknown vehicles are
                      Google-grounded and cached server-side, so these match the
                      print panels / 2D proof and feed the Cut Graphics Proof. */}
                  {(vehicleDims || isFetchingDims) && (
                    <Card className="p-4 bg-secondary/20 border-blue-500/20">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <Ruler className="w-4 h-4 text-blue-400" />
                          <span className="text-sm font-semibold">Vehicle Dimensions</span>
                          <span className="text-[10px] text-muted-foreground hidden sm:inline">GENIE Universal Panelizer</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {vehicleDims && (
                            <span className={cn(
                              "text-[10px] px-2 py-0.5 rounded-full border",
                              vehicleDims.source === 'google_search'
                                ? "border-amber-500/40 text-amber-500 bg-amber-500/10"
                                : vehicleDims.found
                                  ? "border-emerald-500/40 text-emerald-500 bg-emerald-500/10"
                                  : "border-border text-muted-foreground"
                            )}>
                              {vehicleDims.source === 'google_search' ? 'Google-grounded'
                                : vehicleDims.source === 'trailer' ? 'Trailer spec'
                                : vehicleDims.found ? 'Internal DB'
                                : 'Estimated'}
                            </span>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground"
                            disabled={isFetchingDims || !make || !model}
                            onClick={() => fetchVehicleDims()}
                            title="Re-resolve dimensions from GENIE"
                          >
                            <RotateCw className={cn("w-3 h-3", isFetchingDims && "animate-spin")} />
                          </Button>
                        </div>
                      </div>

                      {isFetchingDims && !vehicleDims ? (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="w-3 h-3 animate-spin" /> Resolving real vehicle dimensions…
                        </div>
                      ) : vehicleDims ? (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                            {([
                              ['Side', vehicleDims.sideW, vehicleDims.sideH],
                              ['Hood', vehicleDims.hoodW, vehicleDims.hoodL],
                              ['Roof', vehicleDims.roofW, vehicleDims.roofL],
                              ['Rear', vehicleDims.backW, vehicleDims.backH],
                            ] as const).filter(([, w, h]) => w && h).map(([label, w, h]) => (
                              <div key={label} className="rounded-lg bg-background/50 border border-border/40 p-2">
                                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
                                <div className="font-semibold text-foreground">{Math.round(Number(w))}″ × {Math.round(Number(h))}″</div>
                              </div>
                            ))}
                          </div>
                          {vehicleDims.totalSqFt ? (
                            <p className="text-[11px] text-muted-foreground mt-2">
                              Total coverage ≈ <span className="font-semibold text-foreground">{Math.round(vehicleDims.totalSqFt)} sq ft</span>
                            </p>
                          ) : null}
                        </>
                      ) : null}
                    </Card>
                  )}

                  {/* Action Buttons - Mobile responsive */}
                  <div className="grid grid-cols-2 md:flex md:flex-wrap gap-2">

                    {visualizationId && (
                      <Button
                        onClick={() => navigate(`/revision-studio?id=${visualizationId}`)}
                        className="md:flex-1 gap-2 bg-purple-600 hover:bg-purple-700 text-white"
                      >
                        <Edit3 className="h-4 w-4" />
                        <span className="hidden md:inline">Revise in RevisionStudio IQ™</span>
                        <span className="md:hidden">Revise</span>
                      </Button>
                    )}
                    {visualizationId && (
                      <Button
                        onClick={handleCloneDesign}
                        disabled={isCloning}
                        variant="outline"
                        className="md:flex-1 gap-2 border-blue-500/30 hover:bg-blue-500/10"
                        title="Duplicate this design into a new editable copy"
                      >
                        {isCloning ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                        <span className="hidden md:inline">Clone Design</span>
                        <span className="md:hidden">Clone</span>
                      </Button>
                    )}
                    <Button
                      onClick={() => setShow2DProofSheet(true)}
                      variant="outline"
                      className="md:flex-1"
                      disabled={!year || !make || !model}
                    >
                      <ClipboardSignature className="h-4 w-4 md:mr-2" />
                      <span className="hidden md:inline">2D Proof</span>
                      <span className="md:hidden">2D</span>
                    </Button>
                    <Button
                      onClick={() => setShowProofSheet(true)}
                      variant="outline"
                      className="md:flex-1"
                      disabled={!year || !make || !model}
                    >
                      <ClipboardSignature className="h-4 w-4 md:mr-2" />
                      <span className="hidden md:inline">3D Proof</span>
                      <span className="md:hidden">3D</span>
                    </Button>
                    <Button
                      onClick={() => setShowStudioProof(true)}
                      variant="outline"
                      className="md:flex-1"
                      disabled={!year || !make || !model}
                    >
                      <Camera className="h-4 w-4 md:mr-2" />
                      <span className="hidden md:inline">Studio Proof</span>
                      <span className="md:hidden">Studio</span>
                    </Button>

                    <Button
                      onClick={() => setShowRevisionHistory(!showRevisionHistory)}
                      variant="outline"
                      className={cn("md:w-auto", showRevisionHistory && "bg-purple-500/10 border-purple-500/30")}
                    >
                      <History className="h-4 w-4 md:mr-2" />
                      <span className="md:hidden">History</span>
                      <span className="hidden md:inline sr-only">Revision History</span>
                    </Button>

                    <Button
                      onClick={() => {
                        if (!generatedImageUrl) {
                          toast({ title: "No render available", description: "Generate a design first", variant: "destructive" });
                          return;
                        }
                        generateProductionFiles(generatedImageUrl, stylingPrompt);
                      }}
                      disabled={isGeneratingProduction || !generatedImageUrl}
                      variant="outline"
                      className="md:flex-1 border-blue-500/30 hover:bg-blue-500/10"
                    >
                      {isGeneratingProduction ? (
                        <>
                          <Loader2 className="h-4 w-4 md:mr-2 animate-spin" />
                          <span className="hidden md:inline">Generating...</span>
                        </>
                      ) : (
                        <>
                          <FileCode className="h-4 w-4 md:mr-2" />
                          <span className="hidden md:inline">Production Files</span>
                          <span className="md:hidden">Files</span>
                        </>
                      )}
                    </Button>
                    {/* Mark as Perfect Button */}
                    <MarkAsPerfectButton
                      promptSignature={stylingPrompt || ''}
                      vehicleSignature={`${year} ${make} ${model}`}
                      renderUrls={allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {})}
                      sourceVisualizationId={visualizationId || undefined}
                      className="flex-1"
                    />
                  </div>

                  {/* ═══ OUTPUT FILES SECTION ═══ */}
                  <Card className="p-4 bg-gradient-to-br from-blue-500/10 via-purple-500/5 to-background border-blue-500/30">
                    <div className="flex items-center gap-2 mb-4">
                      <FileCode className="w-5 h-5 text-blue-500" />
                      <h3 className="text-lg font-bold text-foreground">Output Files</h3>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      {/* Download All Renders */}
                      <Button
                        variant="outline"
                        onClick={handleDownloadAll}
                        disabled={allViews.filter(v => v.url).length === 0}
                        className="flex flex-col h-auto py-4 border-blue-500/30 hover:bg-blue-500/10"
                      >
                        <Download className="w-6 h-6 mb-2 text-blue-500" />
                        <span className="text-sm font-semibold">Render Images</span>
                        <span className="text-[10px] text-muted-foreground">{allViews.filter(v => v.url).length} PNG views</span>
                      </Button>

                      {/* Production Files */}
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (!generatedImageUrl) {
                            toast({ title: "No render available", description: "Generate a design first", variant: "destructive" });
                            return;
                          }
                          generateProductionFiles(generatedImageUrl, stylingPrompt);
                        }}
                        disabled={isGeneratingProduction || !generatedImageUrl}
                        className="flex flex-col h-auto py-4 border-blue-500/30 hover:bg-blue-500/10"
                      >
                        {isGeneratingProduction ? (
                          <Loader2 className="w-6 h-6 mb-2 text-blue-500 animate-spin" />
                        ) : (
                          <Layers className="w-6 h-6 mb-2 text-blue-500" />
                        )}
                        <span className="text-sm font-semibold">Production Files</span>
                        <span className="text-[10px] text-muted-foreground">Vectors, masks, guide</span>
                      </Button>

                      {/* Cut Files */}
                      <Button
                        variant="outline"
                        onClick={() => {
                          if (!generatedImageUrl || allViews.length === 0) {
                            toast({ title: "No render available", description: "Generate a design first", variant: "destructive" });
                            return;
                          }
                          handleGenerateCutFiles({
                            id: visualizationId || "",
                            mode_type: "graphicspro",
                            render_urls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
                            vehicle_year: year,
                            vehicle_make: make,
                            vehicle_model: model,
                            design_file_name: stylingPrompt?.slice(0, 50),
                          });
                        }}
                        disabled={isGeneratingCutFiles || !generatedImageUrl}
                        className="flex flex-col h-auto py-4 border-purple-500/30 hover:bg-purple-500/10"
                      >
                        {isGeneratingCutFiles ? (
                          <Loader2 className="w-6 h-6 mb-2 text-purple-500 animate-spin" />
                        ) : (
                          <Scissors className="w-6 h-6 mb-2 text-purple-500" />
                        )}
                        <span className="text-sm font-semibold">Cut Files</span>
                        <span className="text-[10px] text-muted-foreground">SVG + PNG ZIP</span>
                      </Button>

                      {/* Production Pack */}
                      <Button
                        variant="outline"
                        onClick={() => setShowProductionDialog(true)}
                        disabled={!generatedImageUrl}
                        className="flex flex-col h-auto py-4 border-blue-500/30 hover:bg-blue-500/10"
                      >
                        <Package className="w-6 h-6 mb-2 text-blue-500" />
                        <span className="text-sm font-semibold">Production Pack</span>
                        <span className="text-[10px] text-muted-foreground">Full print package</span>
                      </Button>

                      {/* Cut Graphics Proof — dimensioned per-graphic spec */}
                      <Button
                        variant="outline"
                        onClick={handleCutGraphicsProof}
                        disabled={isGeneratingCutProof || !generatedImageUrl}
                        className="flex flex-col h-auto py-4 border-purple-500/30 hover:bg-purple-500/10"
                      >
                        {isGeneratingCutProof ? (
                          <Loader2 className="w-6 h-6 mb-2 text-purple-500 animate-spin" />
                        ) : (
                          <Ruler className="w-6 h-6 mb-2 text-purple-500" />
                        )}
                        <span className="text-sm font-semibold">Cut Graphics Proof</span>
                        <span className="text-[10px] text-muted-foreground">Sizes + letter height</span>
                      </Button>

                      {/* Send to ApprovePro — load this design into an existing
                          order (enter the order number) or create a new one. */}
                      <Button
                        variant="outline"
                        onClick={() => setShowSendToApprove(true)}
                        disabled={!generatedImageUrl || allViews.length === 0}
                        className="flex flex-col h-auto py-4 border-emerald-500/30 hover:bg-emerald-500/10"
                      >
                        <Send className="w-6 h-6 mb-2 text-emerald-500" />
                        <span className="text-sm font-semibold">Send to ApprovePro</span>
                        <span className="text-[10px] text-muted-foreground">Into an order #</span>
                      </Button>
                    </div>
                  </Card>

                  {/* Precision modifications — chrome delete / carbon
                      accent / window tint, etc. Each click stacks the
                      mod on the displayed render (the existing design
                      stays) and accumulates an upsell line item that
                      flows into QuickQuote. */}
                  {generatedImageUrl && (
                    <PrecisionModButtons
                      tool="graphicspro"
                      currentRenderUrl={precisionRenderUrl ?? generatedImageUrl}
                      onApplied={handlePrecisionApplied}
                      onError={handlePrecisionError}
                    />
                  )}

                  {/* QuickQuote button moved up to sit right under the
                      Generate button (same row as ColorPro/DesignPro);
                      pricing structure (sq-ft estimator + DesignProducts
                      compare card) is unchanged — only placement moved. */}

                  {/* Production Upgrade Prompt */}
                  {subscriptionRequired && (
                    <ProductionUpgradePrompt />
                  )}

                  {/* Production Files Panel (expanded results) */}
                  {productionData && (
                    <ProductionFilesPanel productionData={productionData} views={allViews} />
                  )}

                  {/* Revision System */}
                  <DesignRevisionPrompt
                    onRevisionSubmit={handleRevisionSubmit}
                    isGenerating={isRevising}
                    disabled={!generatedImageUrl}
                  />

                  {/* Before/After Comparison */}
                  {previousImageUrl && generatedImageUrl && previousImageUrl !== generatedImageUrl && (
                    <Card className="p-4 bg-secondary/10 border-border">
                      <Label className="text-sm font-semibold mb-3 block">Revision Comparison</Label>
                      <BeforeAfterSlider
                        beforeUrl={previousImageUrl}
                        afterUrl={precisionRenderUrl ?? generatedImageUrl}
                        altText="Design revision comparison"
                      />
                    </Card>
                  )}

                  {/* Revision History */}
                  {showRevisionHistory && revisionHistory.length > 0 && (
                    <Card className="p-4 bg-secondary/10 border-border">
                      <Label className="text-sm font-semibold mb-3 block">Revision History</Label>
                      <RevisionHistoryTimeline
                        history={revisionHistory.map(r => ({
                          id: r.id,
                          view_type: r.view_type || 'side',
                          revision_prompt: r.revision_prompt,
                          original_url: r.original_url || '',
                          revised_url: r.revised_url,
                          created_at: r.created_at || ''
                        }))}
                        onSelect={(rev) => {
                          if (rev.revised_url) {
                            setGeneratedImageUrl(rev.revised_url);
                            toast({
                              title: "Revision Selected",
                              description: "View restored from history",
                            });
                          }
                        }}
                      />
                    </Card>
                  )}
                </>
              )}

              {!isGenerating && !generatedImageUrl && (
                <Card className="p-12 bg-secondary/10 border-dashed border-2 border-border flex flex-col items-center justify-center min-h-[400px] text-center">
                  <Car className="h-16 w-16 text-muted-foreground/30 mb-4" />
                  <h3 className="text-xl font-semibold text-muted-foreground mb-2">
                    Design Your Custom Wrap
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Select a preset or describe your design. GraphicsPro™ creates two-tone wraps, racing stripes, chrome deletes, and multi-zone designs.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Persistent floating QuickQuote button — always reachable
          regardless of scroll position so the rep can open quote
          pricing at any point in the design flow. Branded "QuickQuote
          × GraphicsPro" on mobile so the rep sees at a glance that
          they can design and quote in the same flow. */}
      {!showQuickQuote && (
        <button
          type="button"
          onClick={() => setShowQuickQuote(true)}
          aria-label="Open QuickQuote × GraphicsPro"
          className="fixed right-4 sm:right-6 z-40 flex items-center gap-2 rounded-full px-4 sm:px-5 py-3 text-sm font-bold text-white shadow-[0_8px_24px_rgba(168,85,247,0.45)] hover:opacity-95 active:scale-95 transition max-w-[calc(100vw-2rem)]"
          style={{
            background: "linear-gradient(135deg, #2563eb, #a855f7)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)",
          }}
        >
          <Calculator className="w-4 h-4 flex-shrink-0" />
          <span className="whitespace-nowrap">
            QuickQuote
            <span className="text-cyan-300 mx-1 font-black">×</span>
            GraphicsPro
          </span>
        </button>
      )}

      {/* QuickQuote — same card the dashboard uses, in a left side
          panel so the render stays visible and interactive on the
          right. Pre-seeded with vehicle + render + any precision-mod
          upsells the user already stacked. */}
      <QuickQuoteSidePanel
        open={showQuickQuote}
        onClose={() => setShowQuickQuote(false)}
        toolName="GraphicsPro"
      >
        <QuickQuoteCard
          initial={{
            year: year || undefined,
            make: make || undefined,
            model: model || undefined,
            finish: "Gloss",
            designName: stylingPrompt || "Custom Graphics",
            renderUrl: precisionRenderUrl ?? generatedImageUrl ?? undefined,
            extraCustomLines: precisionUpsellItems.map((u) => ({
              label: u.label,
              price: u.price,
            })),
          }}
        />
      </QuickQuoteSidePanel>

      {/* Proof Sheet Dialog */}
      <Dialog open={showProofSheet} onOpenChange={setShowProofSheet}>
        <DialogContent className={isMobile ? "max-w-[95vw] max-h-[95vh] overflow-y-auto p-0" : "max-w-4xl max-h-[90vh] overflow-auto"}>
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
              toolKey="graphicspro"
              designName={stylingPrompt.slice(0, 50) + (stylingPrompt.length > 50 ? '...' : '')}
              manufacturer="GraphicsPro™"
              colorName={stylingPrompt.slice(0, 50) + (stylingPrompt.length > 50 ? '...' : '')}
              finish="Custom"
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
              colorName={stylingPrompt.slice(0, 50) + (stylingPrompt.length > 50 ? '...' : '')}
              finish="Custom"
              manufacturer="GraphicsPro™"
              toolName="GraphicsPro™"
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 2D Proof Sheet Dialog */}
      <Dialog open={show2DProofSheet} onOpenChange={setShow2DProofSheet}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] overflow-auto p-0">
          <TwoDProofSheet
            views={(() => {
              // Pass the full canonical angle set to the 2D proof (matching
              // the 3D / Studio / Mobile proofs above). Previously this list
              // omitted hood_detail, so the 2D production proof was built from
              // only 5 views and the HOOD panel never appeared — even though
              // generate-2d-proof has a hood panel slot. close-up is included
              // for parity; the edge function ignores it (QC-only, not a print
              // panel), so the proof renders the 6 canonical print panels.
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
            toolKey="graphicspro"
            designName={stylingPrompt.slice(0, 50) + (stylingPrompt.length > 50 ? '...' : '')}
            finish="Custom"
            manufacturer="GraphicsPro"
          />
        </DialogContent>
      </Dialog>

      {/* Cut Graphics Proof Dialog */}
      <Dialog open={showCutGraphicsProof} onOpenChange={setShowCutGraphicsProof}>
        <DialogContent className="max-w-[95vw] md:max-w-4xl max-h-[92vh] overflow-y-auto p-0">
          <CutGraphicsProofSheet
            proof={cutGraphicsProof}
            isGenerating={isGeneratingCutProof}
            onRegenerate={handleCutGraphicsProof}
            totalSqFt={vehicleDims?.totalSqFt}
          />
        </DialogContent>
      </Dialog>

      {/* Send to ApprovePro — load into an existing order # or create a new one */}
      <SendToApproveProDialog
        open={showSendToApprove}
        onOpenChange={setShowSendToApprove}
        context={{
          visualizationId,
          renderUrls: allViews.reduce((acc, v) => ({ ...acc, [v.type]: v.url }), {} as Record<string, string>),
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          designName: stylingPrompt?.slice(0, 50),
          finishType: finishOverride,
        }}
      />

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <PaywallModal
          open={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
        />
      )}

      {/* Login Required Modal */}
      <LoginRequiredModal
        open={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        message="Please log in to generate renders. Create a free account to get 2 free renders!"
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
          design_file_name: stylingPrompt?.slice(0, 50),
        } : null}
      />

      {/* Studio Proof Layout */}
      <StudioProofLayout
        toolName="GraphicsPro™"
        designName={stylingPrompt.slice(0, 50) + (stylingPrompt.length > 50 ? '...' : '')}
        vehicleInfo={{ year, make, model }}
        views={allViews.filter(v => v.url).map(v => ({
          type: v.type,
          url: v.url,
          label: ({
            side: 'Driver Side',
            'driver-side': 'Driver Side',
            'passenger-side': 'Passenger Side',
            hood_detail: 'Hood',
            front: 'Front',
            rear: 'Rear',
            'close-up': 'Close-Up',
            roof: 'Roof',
          } as Record<string, string>)[v.type] || v.type,
        }))}
        isOpen={showStudioProof}
        onClose={() => setShowStudioProof(false)}
        finish="Custom"
      />
    </>
  );
};
