import { useState, useRef, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown, RefreshCw, Upload, Database, Lightbulb, Check, Sparkles,
  Camera, X, FileText, Download, Loader2, Grid3X3, CheckCircle2, AlertTriangle,
  Send, Mail,
} from "lucide-react";
import { ColorRevisionModal } from "@/components/myvehicle/ColorRevisionModal";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMyVehicleLogic } from "@/hooks/useMyVehicleLogic";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { UpgradeRequired } from "@/components/UpgradeRequired";
import { ManufacturerColorBrowser } from "@/components/colorpro/ManufacturerColorBrowser";
import { VinylInputMode } from "@/components/tools/modes/VinylInputMode";
import { MyVehicleUploader } from "@/components/colorpro/MyVehicleUploader";
import { MultiViewUploader } from "@/components/colorpro/MultiViewUploader";
import { BeforeAfterViewer } from "@/components/colorpro/BeforeAfterViewer";
import type { InkFusionColor } from "@/lib/restyleproai-colors";
import type { FinishType } from "@/hooks/useColorProLogic";
import { loadAllVinylSwatches, type VinylSwatch } from "@/lib/vinyl-intelligence";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { fireMyVehicleProSeries, fireRetargetingSeries } from "@/lib/mightymail-orchestration";

export const MyVehicleToolCore = () => {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { subscription } = useSubscriptionLimits();

  // My Vehicle logic
  const {
    photoPreviewUrl,
    detectedVehicleInfo,
    isAnalyzing,
    isGenerating,
    editedImageUrl,
    errorMessage,
    showUpgradeModal,
    setShowUpgradeModal,
    handlePhotoUpload,
    updateVehicleInfo,
    generateEdit,
    clearPhoto,
    // Multi-view
    multiViewPhotos,
    multiViewResults,
    multiViewProgress,
    handleMultiViewPhotoUpload,
    removeMultiViewPhoto,
    generateAllViewEdits,
    // First-view approval gate
    firstViewApprovalPending,
    firstViewUrl,
    groundingData,
    showRevisionModal,
    setShowRevisionModal,
    approveFirstView,
    submitColorCorrection,
    // PDF
    isGeneratingPdf,
    proofPdfUrl,
    generateProofPdf,
  } = useMyVehicleLogic();

  // Color selection state (local to My Vehicle tab)
  const [selectedSwatch, setSelectedSwatch] = useState<InkFusionColor | null>(null);
  const [selectedFinish, setSelectedFinish] = useState<FinishType>("Gloss");
  const [isColorSectionOpen, setIsColorSectionOpen] = useState(true);
  const [selectedColorMode, setSelectedColorMode] = useState<"upload" | "manual" | "database">("database");
  const [vinylSwatches, setVinylSwatches] = useState<VinylSwatch[]>([]);
  const [highlightColorSection, setHighlightColorSection] = useState(false);
  const colorSectionRef = useRef<HTMLDivElement>(null);

  // Upload mode toggle (single vs multi-view) — default to multi so all angles can be uploaded at once
  const [uploadMode, setUploadMode] = useState<"single" | "multi">("multi");

  // Proof PDF form state
  const [showProofForm, setShowProofForm] = useState(false);
  const [proofCustomerName, setProofCustomerName] = useState("");
  const [proofShopName, setProofShopName] = useState("");
  const [proofPrice, setProofPrice] = useState("");

  // Email proof state
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // Generation progress
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Load vinyl swatches
  useEffect(() => {
    loadAllVinylSwatches()
      .then(setVinylSwatches)
      .catch((err) => console.error("Failed to load vinyl swatches:", err));
  }, []);

  // Live elapsed timer during generation
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isGenerating) {
      setElapsedSeconds(0);
      interval = setInterval(() => setElapsedSeconds((prev) => prev + 1), 1000);
    } else {
      setElapsedSeconds(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isGenerating]);

  // Progress steps
  const getProgressSteps = () => {
    if (uploadMode === "multi" && multiViewPhotos.length > 1) {
      return [
        { label: "Photos uploaded", completed: elapsedSeconds >= 1 },
        { label: `Editing view ${multiViewProgress.current}/${multiViewProgress.total}`, completed: multiViewProgress.current > 0 },
        { label: "Applying wrap colors", completed: multiViewProgress.current > 1 },
        { label: "All views complete", completed: !isGenerating && multiViewResults.length > 0 },
      ];
    }
    return [
      { label: "Photo uploaded", completed: elapsedSeconds >= 1 },
      { label: "Vehicle detected", completed: elapsedSeconds >= 4 },
      { label: "Applying wrap color", completed: elapsedSeconds >= 10 },
      { label: "Rendering final image", completed: elapsedSeconds >= 18 },
    ];
  };

  const getStatusMessage = () => {
    if (uploadMode === "multi" && multiViewProgress.total > 1) {
      return `Editing view ${multiViewProgress.current} of ${multiViewProgress.total}...`;
    }
    if (elapsedSeconds < 3) return "Uploading photo to AI...";
    if (elapsedSeconds < 10) return "Analyzing vehicle body panels...";
    if (elapsedSeconds < 20) return "Applying wrap color...";
    if (elapsedSeconds < 35) return "Rendering photorealistic edit...";
    return "Almost done, hang tight...";
  };

  const generationTips = [
    "Pro Tip: Clear, well-lit photos give the best results",
    "Fun Fact: A full wrap can increase vehicle resale value",
    "Pro Tip: Side-angle photos show the most body panels",
    "Did you know? 3M 2080 is the industry standard for color change",
    "Pro Tip: Avoid photos with heavy shadows for best accuracy",
  ];

  const getCurrentTip = () => {
    return generationTips[Math.floor(elapsedSeconds / 5) % generationTips.length];
  };

  const handleGenerate = async () => {
    if (uploadMode === "single" && !photoPreviewUrl) {
      toast({ title: "Upload a photo first", description: "Please upload a photo of your vehicle before generating.", variant: "destructive" });
      return;
    }

    if (uploadMode === "multi" && multiViewPhotos.length === 0) {
      toast({ title: "Upload photos first", description: "Please upload at least one vehicle photo.", variant: "destructive" });
      return;
    }

    if (!selectedSwatch) {
      toast({ title: "Pick a Color First!", description: "Select a manufacturer film color to visualize on your vehicle.", variant: "destructive", duration: 5000 });
      setHighlightColorSection(true);
      setTimeout(() => setHighlightColorSection(false), 3000);
      setIsColorSectionOpen(true);
      setSelectedColorMode("database");
      colorSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    if (uploadMode === "multi" && multiViewPhotos.length > 1) {
      // Multi-view generation
      const result = await generateAllViewEdits({ selectedSwatch, selectedFinish });
      if (result.success) {
        toast({ title: "All Views Ready!", description: "Scroll down to see your wrap previews.", duration: 4000 });
        document.getElementById("myvehicle-result-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } else {
      // Single photo generation
      const result = await generateEdit({ selectedSwatch, selectedFinish });
      if (result.success) {
        toast({ title: "Wrap Preview Ready!", description: "Scroll down to see the before/after comparison.", duration: 4000 });
        document.getElementById("myvehicle-result-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }
  };

  const handleDownloadProof = async () => {
    if (!selectedSwatch) return;

    const url = await generateProofPdf({
      selectedSwatch,
      selectedFinish,
      customerName: proofCustomerName || undefined,
      shopName: proofShopName || undefined,
      price: proofPrice || undefined,
      includeTerms: true,
    });

    if (url) {
      window.open(url, "_blank");
    }
  };

  const handleClearAll = () => {
    clearPhoto();
    setShowProofForm(false);
    setProofCustomerName("");
    setProofShopName("");
    setProofPrice("");
    setShowEmailForm(false);
    setEmailTo("");
    setEmailMessage("");
    setEmailSent(false);
    toast({ title: "Cleared", description: "Ready to upload a new photo.", duration: 2000 });
  };

  const handleSendEmail = async () => {
    if (!emailTo || !emailTo.includes("@")) {
      toast({ title: "Enter a valid email", description: "Please enter the customer's email address.", variant: "destructive" });
      return;
    }

    // Generate proof PDF first if not already generated
    let pdfUrl = proofPdfUrl;
    if (!pdfUrl && selectedSwatch) {
      pdfUrl = await generateProofPdf({
        selectedSwatch,
        selectedFinish,
        customerName: proofCustomerName || undefined,
        shopName: proofShopName || undefined,
        price: proofPrice || undefined,
        includeTerms: true,
      });
    }

    // Build views for email
    const emailViews = multiViewResults.length > 0
      ? multiViewResults.map((r) => ({ type: r.viewType, url: r.afterUrl, label: r.viewType.replace("-", " ") }))
      : editedImageUrl
      ? [{ type: "front", url: editedImageUrl, label: "Wrapped" }]
      : [];

    if (emailViews.length === 0) {
      toast({ title: "No renders", description: "Generate a wrap preview first.", variant: "destructive" });
      return;
    }

    setIsSendingEmail(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const vehicleStr = [detectedVehicleInfo?.year, detectedVehicleInfo?.make, detectedVehicleInfo?.model].filter(Boolean).join(" ") || "Vehicle";
      const colorStr = `${(selectedSwatch as any)?.manufacturer || ""} ${selectedSwatch?.name || ""} ${selectedFinish}`.trim();

      const { error } = await renderClient.functions.invoke("send-client-proof-email", {
        body: {
          to: emailTo,
          cc: user?.email || undefined,
          clientName: proofCustomerName || emailTo.split("@")[0],
          subject: `Your Wrap Proof — ${vehicleStr} in ${colorStr}`,
          body: emailMessage || `Here is your wrap visualization proof for your ${vehicleStr}. Please review the images and let us know if you'd like to proceed or request any changes.`,
          emailType: "proof",
          vehicleInfo: detectedVehicleInfo || {},
          views: emailViews,
          proofPdfUrl: pdfUrl || undefined,
          shopName: proofShopName || undefined,
        },
      });

      if (error) throw new Error(error.message || "Email send failed");

      setEmailSent(true);
      toast({ title: "Email Sent!", description: `Proof emailed to ${emailTo}` });

      // ── Fire MightyMail drip series (MyVehiclePro 12-month + Retargeting). ──
      // Resolve shop_profiles.id from the auth user so send-templated-email
      // can auto-inject shop branding into every drip email. Both series are
      // idempotent by source_ref — re-sending the same proof is a no-op.
      try {
        const emailLower = emailTo.trim().toLowerCase();
        const customerName = proofCustomerName?.trim() || emailTo.split("@")[0];
        const { data: shopProfile } = await supabase
          .from("shop_profiles")
          .select("id, website")
          .eq("user_id", user?.id ?? "")
          .maybeSingle();
        const shopId = shopProfile?.id ?? null;
        const shopWebsite = shopProfile?.website || "https://restyleproai.com";

        const merge = {
          customer_name: customerName,
          vehicle_name: vehicleStr,
          preview_url: shopWebsite,
          booking_url: shopWebsite,
        };

        // Fire and forget — failures shouldn't block the success toast.
        Promise.allSettled([
          fireMyVehicleProSeries({
            myVehicleId: `${shopId ?? "anon"}:${emailLower}`,
            customerEmail: emailTo,
            customerName,
            bookingUrl: shopWebsite,
            shopId,
          }),
          fireRetargetingSeries({
            quoteOrPreviewId: `mvp:${shopId ?? "anon"}:${emailLower}`,
            customerEmail: emailTo,
            customerName,
            previewUrl: shopWebsite,
            bookingUrl: shopWebsite,
            shopId,
          }),
        ]).then((results) => {
          for (const r of results) {
            if (r.status === "rejected") console.error("MightyMail enqueue failed:", r.reason);
          }
        });
        void merge; // referenced for future per-email overrides
      } catch (mmErr) {
        console.error("MightyMail orchestration failed (non-fatal):", mmErr);
      }
    } catch (err: any) {
      console.error("Email send error:", err);
      toast({ title: "Email Failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSendingEmail(false);
    }
  };

  return (
    <>
      <div className="max-w-7xl mx-auto px-3 sm:px-4 pb-24">
        {/* ─── MyVehiclePro™ Hero Header ─────────────────────── */}
        <div className="text-center mb-6 sm:mb-8">
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight leading-tight">
            <span className="text-white">MyVehicle</span>
            <span className="text-gradient-blue">Pro™</span>
          </h1>
          <p className="mt-2 text-base sm:text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Upload any vehicle photo - just click upload & render
          </p>
        </div>

        <div className="flex flex-col lg:grid lg:grid-cols-[320px_1fr] gap-3 sm:gap-4 md:gap-6">
          {/* ─── LEFT SIDEBAR: Upload + Color Selection ─────────── */}
          <div className="space-y-3 sm:space-y-4">
            {/* Upload Mode Toggle */}
            <Card className="p-3 bg-secondary/20 border-border">
              <Label className="text-xs sm:text-sm font-semibold mb-2 block">Upload Mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setUploadMode("single")}
                  className={cn(
                    "px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                    uploadMode === "single"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background/50 text-foreground hover:bg-background"
                  )}
                >
                  <Camera className="h-3.5 w-3.5" />
                  Single Photo
                </button>
                <button
                  onClick={() => setUploadMode("multi")}
                  className={cn(
                    "px-3 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5",
                    uploadMode === "multi"
                      ? "bg-blue-500/20 text-blue-300 border border-blue-500/50"
                      : "bg-background/50 text-foreground hover:bg-background"
                  )}
                >
                  <Grid3X3 className="h-3.5 w-3.5" />
                  Multi-View
                </button>
              </div>
            </Card>

            {/* Photo Uploader */}
            {uploadMode === "single" ? (
              <MyVehicleUploader
                photoPreviewUrl={photoPreviewUrl}
                isAnalyzing={isAnalyzing}
                detectedVehicleInfo={detectedVehicleInfo}
                onPhotoUpload={handlePhotoUpload}
                onClear={handleClearAll}
                onVehicleInfoUpdate={updateVehicleInfo}
              />
            ) : (
              <MultiViewUploader
                photos={multiViewPhotos.map((p) => ({
                  viewType: p.viewType,
                  file: null as any,
                  previewUrl: p.previewUrl,
                  base64: p.base64,
                  mimeType: p.mimeType,
                }))}
                isAnalyzing={isAnalyzing}
                onPhotoUpload={handleMultiViewPhotoUpload}
                onRemovePhoto={removeMultiViewPhoto}
                onClearAll={handleClearAll}
              />
            )}

            {/* Color Mode Selector */}
            <Card
              ref={colorSectionRef}
              className={cn(
                "p-3 sm:p-4 bg-secondary/20 border-border transition-all duration-500",
                highlightColorSection && "ring-2 ring-blue-500 border-blue-500"
              )}
            >
              <Label className="text-xs sm:text-sm font-semibold mb-2 sm:mb-3 block">
                Color Selection Mode
              </Label>
              <div className="grid grid-cols-1 gap-2">
                <button
                  onClick={() => setSelectedColorMode("upload")}
                  className={cn(
                    "px-4 py-3 rounded-lg text-sm font-medium transition-all text-left border-2 relative",
                    selectedColorMode === "upload"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background/50 text-foreground hover:bg-background border-primary/50 hover:border-primary hover:shadow-md hover:shadow-primary/30"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4" />
                    <div>
                      <div className="font-semibold">Upload Vinyl Swatch (AI Auto-Detect)</div>
                      <div className="text-xs opacity-80 mt-0.5">
                        AI detects manufacturer, color & finish automatically
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setSelectedColorMode("database")}
                  className={cn(
                    "px-4 py-3 rounded-lg text-sm font-medium transition-all text-left border-2 relative",
                    selectedColorMode === "database"
                      ? "bg-blue-500/20 text-foreground border-blue-500"
                      : "bg-background/50 text-foreground hover:bg-background border-blue-500/30 hover:border-blue-500/50"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-blue-400" />
                    <div>
                      <div className="font-semibold flex items-center gap-2">
                        Choose Manufacturer Film Color
                        <Badge
                          variant="secondary"
                          className="bg-blue-500/20 text-blue-300 text-xs"
                        >
                          {vinylSwatches?.length || 368}
                        </Badge>
                      </div>
                      <div className="text-xs opacity-80 mt-0.5">
                        3M, Avery, KPMF, Oracal & more
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => setSelectedColorMode("manual")}
                  className={cn(
                    "px-4 py-3 rounded-lg text-sm font-medium transition-all text-left",
                    selectedColorMode === "manual"
                      ? "bg-primary text-primary-foreground"
                      : "bg-background/50 text-foreground hover:bg-background"
                  )}
                >
                  <div className="font-semibold">Manual Vinyl Entry</div>
                  <div className="text-xs opacity-80 mt-0.5">
                    Type manufacturer name & color manually
                  </div>
                </button>
              </div>
            </Card>

            {/* Collapsible Color Selection */}
            <Collapsible open={isColorSectionOpen} onOpenChange={setIsColorSectionOpen}>
              <Card className="p-4 bg-secondary/20 border-border">
                <CollapsibleTrigger className="w-full">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold">
                      {selectedColorMode === "upload"
                        ? "Upload Vinyl Swatch"
                        : selectedColorMode === "manual"
                        ? "Manual Vinyl Entry"
                        : "Choose Manufacturer Film Color"}
                    </h4>
                    <span className="text-xs text-muted-foreground">
                      {isColorSectionOpen ? "Click to collapse" : "Click to expand"}
                    </span>
                  </div>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {selectedColorMode === "database" ? (
                    <ManufacturerColorBrowser
                      selectedSwatch={selectedSwatch}
                      onSwatchSelect={(swatch) => {
                        const swatchFinish = swatch.finish || selectedFinish;
                        setSelectedSwatch({
                          ...swatch,
                          finish: swatchFinish,
                          // Map media_url → swatchImageUrl so the swatch image is always sent to Gemini
                          swatchImageUrl: swatch.media_url || (swatch as any).swatchImageUrl,
                        } as any);
                        if (swatch.finish) {
                          setSelectedFinish(swatch.finish as typeof selectedFinish);
                        }
                      }}
                    />
                  ) : (
                    <VinylInputMode
                      selectedMode={selectedColorMode as "upload" | "manual"}
                      onSwatchSelect={(swatch) => {
                        setSelectedSwatch({ ...swatch, finish: selectedFinish });
                      }}
                    />
                  )}
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </div>

          {/* ─── RIGHT: Results + Generate Button ──────────────── */}
          <div id="myvehicle-result-section" className="space-y-4">
            {/* Clear button */}
            {editedImageUrl && (
              <Card className="p-4 bg-secondary/20 border-border">
                <Button
                  onClick={handleClearAll}
                  variant="destructive"
                  size="lg"
                  className="w-full"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear & Start New
                </Button>
              </Card>
            )}

            {/* Before/After Viewer (single photo or multi with 1 photo) */}
            {editedImageUrl && photoPreviewUrl && multiViewResults.length === 0 && (
              <BeforeAfterViewer
                beforeUrl={photoPreviewUrl}
                afterUrl={editedImageUrl}
                beforeLabel="Original"
                afterLabel={`${selectedSwatch?.name || "Wrapped"} ${selectedFinish}`}
                swatchHex={selectedSwatch?.hex}
                swatchImageUrl={(selectedSwatch as any)?.swatchImageUrl || (selectedSwatch as any)?.media_url}
                swatchName={selectedSwatch?.name}
              />
            )}

            {/* First-View Approval Gate */}
            {firstViewApprovalPending && firstViewUrl && (
              <Card
                ref={(el) => { if (el) el.scrollIntoView({ behavior: "smooth", block: "center" }); }}
                className="p-4 bg-amber-500/10 border-2 border-amber-400 shadow-[0_0_24px_rgba(251,191,36,0.35)] animate-pulse-slow"
              >
                <div className="space-y-3">
                  <h3 className="text-base font-bold flex items-center gap-2 text-amber-300">
                    <AlertTriangle className="h-5 w-5 text-amber-400" />
                    ACTION NEEDED — Approve to render remaining {Math.max(multiViewPhotos.length - 1, 0)} view{multiViewPhotos.length - 1 === 1 ? "" : "s"}
                  </h3>
                  <p className="text-xs text-amber-100/90">
                    We rendered the first view so you can check the color before spending renders on the rest.
                    Click <span className="font-semibold text-emerald-300">Color Correct</span> to render the remaining views,
                    or <span className="font-semibold text-amber-300">Color Wrong</span> to fix the film color first.
                  </p>
                  <img
                    src={firstViewUrl}
                    alt="First view render"
                    className="w-full max-h-64 object-contain rounded-lg border border-border"
                  />
                  <div className="flex gap-3">
                    <Button
                      onClick={approveFirstView}
                      size="lg"
                      className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white font-semibold"
                    >
                      <CheckCircle2 className="h-4 w-4 mr-2" />
                      Color Correct — Render All Views
                    </Button>
                    <Button
                      onClick={() => setShowRevisionModal(true)}
                      variant="outline"
                      size="lg"
                      className="flex-1 border-amber-500/50 text-amber-400 hover:bg-amber-500/10"
                    >
                      <AlertTriangle className="h-4 w-4 mr-2" />
                      Color Wrong — Correct It
                    </Button>
                  </div>
                </div>
              </Card>
            )}

            {/* Multi-View Results Grid */}
            {multiViewResults.length > 0 && (
              <Card className="p-4 bg-secondary/20 border-border">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <Grid3X3 className="h-4 w-4 text-blue-400" />
                  Multi-View Results ({multiViewResults.length} of {multiViewPhotos.length} views
                  {firstViewApprovalPending ? " — approve above to render the rest" : ""})
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {multiViewResults.map((result) => (
                    <div key={result.viewType} className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground capitalize">
                        {result.viewType.replace("-", " ")}
                      </span>
                      <BeforeAfterViewer
                        beforeUrl={result.beforeUrl}
                        afterUrl={result.afterUrl}
                        beforeLabel="Original"
                        afterLabel={selectedSwatch?.name || "Wrapped"}
                        swatchHex={selectedSwatch?.hex}
                        swatchImageUrl={(selectedSwatch as any)?.swatchImageUrl || (selectedSwatch as any)?.media_url}
                        swatchName={selectedSwatch?.name}
                      />
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Proof & Email Section */}
            {editedImageUrl && (
              <Card className="p-4 bg-secondary/20 border-border">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="h-4 w-4 text-blue-400" />
                    Proof & Quote
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowProofForm(!showProofForm)}
                    className="h-7 text-xs"
                  >
                    {showProofForm ? "Hide Details" : "Customize"}
                  </Button>
                </div>

                {showProofForm && (
                  <div className="space-y-2 mb-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Customer Name</Label>
                      <Input
                        value={proofCustomerName}
                        onChange={(e) => setProofCustomerName(e.target.value)}
                        placeholder="John Doe"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Shop Name</Label>
                      <Input
                        value={proofShopName}
                        onChange={(e) => setProofShopName(e.target.value)}
                        placeholder="Your Wrap Shop"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Quoted Price</Label>
                      <Input
                        value={proofPrice}
                        onChange={(e) => setProofPrice(e.target.value)}
                        placeholder="2,500.00"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                )}

                {/* Download + Email buttons side by side */}
                <div className="flex gap-2">
                  <Button
                    onClick={handleDownloadProof}
                    disabled={isGeneratingPdf}
                    className="flex-1 bg-gradient-to-r from-blue-600 to-blue-500 text-white"
                  >
                    {isGeneratingPdf ? (
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Generating...
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Download className="h-4 w-4" />
                        Download PDF
                      </div>
                    )}
                  </Button>
                  <Button
                    onClick={() => setShowEmailForm(!showEmailForm)}
                    variant={showEmailForm ? "default" : "outline"}
                    className={cn(
                      "flex-1",
                      !showEmailForm && "border-blue-500/40 text-blue-400 hover:bg-blue-500/10"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <Mail className="h-4 w-4" />
                      Email Proof
                    </div>
                  </Button>
                </div>

                {proofPdfUrl && (
                  <p className="text-xs text-blue-400 mt-2 text-center">
                    PDF ready!{" "}
                    <a href={proofPdfUrl} target="_blank" rel="noopener noreferrer" className="underline">
                      Open in new tab
                    </a>
                  </p>
                )}

                {/* Email form */}
                {showEmailForm && (
                  <div className="mt-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20 space-y-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Customer Email</Label>
                      <Input
                        type="email"
                        value={emailTo}
                        onChange={(e) => setEmailTo(e.target.value)}
                        placeholder="customer@email.com"
                        className="h-8 text-sm"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Message (optional)</Label>
                      <Textarea
                        value={emailMessage}
                        onChange={(e) => setEmailMessage(e.target.value)}
                        placeholder="Here is your wrap visualization proof..."
                        className="min-h-[60px] text-sm resize-none"
                      />
                    </div>
                    <Button
                      onClick={handleSendEmail}
                      disabled={isSendingEmail || emailSent}
                      className="w-full bg-gradient-to-r from-emerald-600 to-emerald-500 text-white"
                    >
                      {isSendingEmail ? (
                        <div className="flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Sending...
                        </div>
                      ) : emailSent ? (
                        <div className="flex items-center gap-2">
                          <Check className="h-4 w-4" />
                          Sent to {emailTo}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Send className="h-4 w-4" />
                          Send Proof Email
                        </div>
                      )}
                    </Button>
                    {emailSent && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => { setEmailSent(false); setEmailTo(""); setEmailMessage(""); }}
                        className="w-full h-7 text-xs text-muted-foreground"
                      >
                        Send to another email
                      </Button>
                    )}
                  </div>
                )}
              </Card>
            )}

            {/* Error message */}
            {errorMessage && !isGenerating && (
              <Card className="p-4 bg-destructive/10 border-destructive/30">
                <p className="text-sm text-destructive">{errorMessage}</p>
              </Card>
            )}

            {/* Generate Button */}
            <Card className="p-4 bg-secondary/20 border-border">
              <div className="flex flex-col gap-3">
                {/* Missing-color warning banner */}
                {!selectedSwatch && (uploadMode === "single" ? photoPreviewUrl : multiViewPhotos.length > 0) && !isGenerating && (
                  <div
                    className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/15 border border-amber-500/40 cursor-pointer hover:bg-amber-500/25 transition-all"
                    onClick={() => {
                      setIsColorSectionOpen(true);
                      setSelectedColorMode("database");
                      setHighlightColorSection(true);
                      setTimeout(() => setHighlightColorSection(false), 3000);
                      colorSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                    }}
                  >
                    <Sparkles className="h-4 w-4 text-amber-400 flex-shrink-0" />
                    <p className="text-sm text-amber-300 font-medium">
                      Pick a wrap color below to enable rendering
                    </p>
                  </div>
                )}

                <Button
                  onClick={handleGenerate}
                  disabled={isGenerating || (uploadMode === "single" ? !photoPreviewUrl : multiViewPhotos.length === 0)}
                  size="lg"
                  className={cn(
                    "w-full bg-gradient-blue text-white transition-all",
                    !isGenerating && (uploadMode === "single" ? photoPreviewUrl : multiViewPhotos.length > 0) && selectedSwatch &&
                      "",
                    isGenerating && "opacity-90"
                  )}
                >
                  {isGenerating ? (
                    <div className="flex items-center gap-2">
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>
                        {uploadMode === "multi" && multiViewProgress.total > 1
                          ? `Editing View ${multiViewProgress.current}/${multiViewProgress.total}...`
                          : `Editing Photo... ${elapsedSeconds}s`}
                      </span>
                    </div>
                  ) : editedImageUrl ? (
                    "Try Another Color"
                  ) : (
                    <div className="flex items-center gap-2">
                      <Camera className="h-4 w-4" />
                      {uploadMode === "multi" && multiViewPhotos.length > 1
                        ? `Visualize Wrap on All ${multiViewPhotos.length} Views`
                        : "Visualize Wrap on MyVehiclePro™"}
                    </div>
                  )}
                </Button>

                {/* Generation progress */}
                {isGenerating && (
                  <div className="space-y-4 p-4 bg-card/50 rounded-lg border border-border/50">
                    {/* Progress bar */}
                    <div>
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{getStatusMessage()}</span>
                        <span>
                          {uploadMode === "multi" && multiViewProgress.total > 1
                            ? `${Math.round((multiViewProgress.current / multiViewProgress.total) * 100)}%`
                            : `${Math.min(Math.round((elapsedSeconds / 40) * 100), 95)}%`}
                        </span>
                      </div>
                      <div className="w-full bg-secondary/50 rounded-full h-2.5 overflow-hidden">
                        <div
                          className="bg-gradient-to-r from-blue-500 via-blue-500 to-blue-400 h-full rounded-full transition-all duration-1000 animate-pulse"
                          style={{
                            width: uploadMode === "multi" && multiViewProgress.total > 1
                              ? `${Math.min((multiViewProgress.current / multiViewProgress.total) * 100, 95)}%`
                              : `${Math.min((elapsedSeconds / 40) * 100, 95)}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Progress checkmarks */}
                    <div className="grid grid-cols-2 gap-2">
                      {getProgressSteps().map((step, index) => (
                        <div
                          key={index}
                          className={cn(
                            "flex items-center gap-2 text-xs transition-all duration-500",
                            step.completed ? "text-blue-400" : "text-muted-foreground/50"
                          )}
                        >
                          {step.completed ? (
                            <Check className="h-3.5 w-3.5 text-blue-400" />
                          ) : (
                            <div className="h-3.5 w-3.5 rounded-full border border-muted-foreground/30" />
                          )}
                          <span>{step.label}</span>
                        </div>
                      ))}
                    </div>

                    {/* Rotating tips */}
                    <div className="flex items-start gap-2 p-3 bg-secondary/30 rounded-md border border-border/30">
                      <Lightbulb className="h-4 w-4 text-blue-400 flex-shrink-0 mt-0.5" />
                      <p className="text-xs text-muted-foreground animate-fade-in">
                        {getCurrentTip()}
                      </p>
                    </div>
                  </div>
                )}

                {/* Status text */}
                <div className="pt-3 border-t border-border">
                  <p className={cn(
                    "text-xs text-center",
                    !selectedSwatch && (uploadMode === "single" ? photoPreviewUrl : multiViewPhotos.length > 0)
                      ? "text-amber-400 font-semibold"
                      : "text-muted-foreground"
                  )}>
                    {uploadMode === "single" && !photoPreviewUrl
                      ? "Upload a vehicle photo to get started"
                      : uploadMode === "multi" && multiViewPhotos.length === 0
                      ? "Upload vehicle photos from different angles"
                      : !selectedSwatch
                      ? "⚠ Select a wrap color to visualize"
                      : subscription && subscription.tier !== "free"
                      ? "Unlimited previews included with your plan"
                      : "Photo edits count toward your render limit"}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <UpgradeRequired
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        requiredTier="starter"
        featureName="MyVehiclePro™ Photo Editing"
      />

      <ColorRevisionModal
        open={showRevisionModal}
        onOpenChange={setShowRevisionModal}
        firstViewUrl={firstViewUrl}
        colorName={selectedSwatch?.name || ""}
        manufacturer={(selectedSwatch as any)?.manufacturer || ""}
        onSubmit={submitColorCorrection}
      />
    </>
  );
};
