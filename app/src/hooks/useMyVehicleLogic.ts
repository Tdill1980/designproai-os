import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { saveArtboardUrlToViz } from "@/lib/save-artboard-url";
import { pickMyVehicleEndpoint } from "@/lib/myvehicleEndpoint";
import type { InkFusionColor } from "@/lib/restyleproai-colors";
import { useSubscriptionLimits } from "./useSubscriptionLimits";
import { saveProofUrlToViz } from "@/lib/save-proof-url";
import { getActiveUser } from "@/lib/auth-session";
import { toast } from "@/hooks/use-toast";
import type { FinishType } from "./useColorProLogic";
import { findVehicle, getPanelBreakdown } from "@/data/vehicle-measurements";

/** Maximum time (ms) before a single edge function invocation is considered hung. */
const INVOKE_TIMEOUT_MS = 120_000; // 2 minutes

/** Race a promise against a timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

/**
 * Invoke a Supabase edge function with retry logic for transient network failures.
 * Retries up to `maxRetries` times with exponential backoff on FunctionsFetchError
 * ("Failed to send a request to the Edge Function").
 * Each invocation is capped at INVOKE_TIMEOUT_MS to prevent infinite hangs.
 */
async function invokeWithRetry(
  functionName: string,
  body: Record<string, any>,
  maxRetries = 2,
): Promise<{ data: any; error: any }> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const { data, error } = await withTimeout(
      renderClient.functions.invoke(functionName, { body }),
      INVOKE_TIMEOUT_MS,
      functionName,
    );

    if (!error) return { data, error: null };

    const msg = error.message || "";
    const isNetworkError = msg.includes("Failed to send a request") || msg.includes("FunctionsFetchError");

    if (!isNetworkError || attempt === maxRetries) {
      return { data, error };
    }

    const waitMs = Math.pow(2, attempt + 1) * 1000; // 2s, 4s
    console.warn(`⏳ Edge function "${functionName}" network error, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  // Should never reach here, but satisfy TS
  return renderClient.functions.invoke(functionName, { body });
}

interface VehicleInfo {
  make: string;
  model: string;
  year: string;
  color?: string;
  finish?: string;
}

/** A single view photo with its base64 data */
export interface ViewPhotoData {
  viewType: string;
  base64: string;
  mimeType: string;
  previewUrl: string;
}

/** Result of editing a single view */
export interface ViewEditResult {
  viewType: string;
  beforeUrl: string;
  afterUrl: string;
}

export const useMyVehicleLogic = () => {
  const { checkCanGenerate, incrementRenderCount } = useSubscriptionLimits();

  // Single photo state (backwards-compatible)
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string>("image/jpeg");

  // Multi-view photo state
  const [multiViewPhotos, setMultiViewPhotos] = useState<ViewPhotoData[]>([]);
  const [multiViewResults, setMultiViewResults] = useState<ViewEditResult[]>([]);
  const [multiViewProgress, setMultiViewProgress] = useState<{ current: number; total: number }>({ current: 0, total: 0 });

  // Vehicle detection state
  const [detectedVehicleInfo, setDetectedVehicleInfo] = useState<VehicleInfo | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  /** Manual override for vehicle info (user typed year/make/model) */
  const updateVehicleInfo = (info: { make: string; model: string; year: string }) => {
    setDetectedVehicleInfo((prev) => ({
      make: info.make || prev?.make || "",
      model: info.model || prev?.model || "",
      year: info.year || prev?.year || "",
      color: prev?.color,
      finish: prev?.finish,
    }));
  };

  // Render state
  const [isGenerating, setIsGenerating] = useState(false);
  const [editedImageUrl, setEditedImageUrl] = useState<string | null>(null);
  const [visualizationId, setVisualizationId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // First-view approval gate state
  const [firstViewApprovalPending, setFirstViewApprovalPending] = useState(false);
  const [firstViewUrl, setFirstViewUrl] = useState<string | null>(null);
  const [groundingData, setGroundingData] = useState<any>(null);
  const [showRevisionModal, setShowRevisionModal] = useState(false);
  const [pendingMultiViewParams, setPendingMultiViewParams] = useState<any>(null);

  // PDF state
  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [proofPdfUrl, setProofPdfUrl] = useState<string | null>(null);

  // Shared color state (passed from parent)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  /**
   * Handle single photo upload - reads the file and optionally analyzes it
   */
  const handlePhotoUpload = async (file: File) => {
    setErrorMessage(null);
    setEditedImageUrl(null);
    setVisualizationId(null);
    setDetectedVehicleInfo(null);

    // Validate file type
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      setErrorMessage("Please upload a JPEG, PNG, or WebP image.");
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("Image must be under 10MB. Please compress or resize your photo.");
      return;
    }

    // Read file as data URL (for preview) and base64 (for API)
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPhotoPreviewUrl(dataUrl);
      setPhotoMimeType(file.type);

      // Extract base64 portion (strip "data:image/...;base64," prefix)
      const base64 = dataUrl.split(",")[1];
      setPhotoBase64(base64);

      // Auto-analyze the vehicle
      await analyzeVehicle(base64, file.type);
    };
    reader.readAsDataURL(file);
  };

  /**
   * Handle multi-view photo upload for a specific view slot
   */
  const handleMultiViewPhotoUpload = async (file: File, viewType: string) => {
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file", description: "Please upload a JPEG, PNG, or WebP image.", variant: "destructive" });
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Image must be under 10MB.", variant: "destructive" });
      return;
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      const base64 = dataUrl.split(",")[1];

      const newPhoto: ViewPhotoData = {
        viewType,
        base64,
        mimeType: file.type,
        previewUrl: dataUrl,
      };

      setMultiViewPhotos((prev) => {
        const filtered = prev.filter((p) => p.viewType !== viewType);
        return [...filtered, newPhoto];
      });

      // Also set as primary photo if it's the first one or the front view
      if (viewType === "front" || !photoBase64) {
        setPhotoPreviewUrl(dataUrl);
        setPhotoBase64(base64);
        setPhotoMimeType(file.type);

        // Auto-analyze
        if (!detectedVehicleInfo) {
          await analyzeVehicle(base64, file.type);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  /**
   * Remove a multi-view photo
   */
  const removeMultiViewPhoto = (viewType: string) => {
    setMultiViewPhotos((prev) => prev.filter((p) => p.viewType !== viewType));
    // Also remove result for that view
    setMultiViewResults((prev) => prev.filter((r) => r.viewType !== viewType));
  };

  /**
   * Analyze the uploaded photo to detect vehicle make/model/year
   */
  const analyzeVehicle = async (base64Data: string, mimeType: string) => {
    setIsAnalyzing(true);
    try {
      const { data, error } = await invokeWithRetry("analyze-vehicle-image", {
        imageData: `data:${mimeType};base64,${base64Data}`,
      });

      if (error) {
        console.warn("Vehicle analysis failed:", error);
        return;
      }

      if (data?.success && data.data) {
        const info: VehicleInfo = {
          make: data.data.make || "",
          model: data.data.model || "",
          year: data.data.year || "",
          color: data.data.color || "",
          finish: data.data.finish || "",
        };
        setDetectedVehicleInfo(info);
        console.log("🚗 Vehicle detected:", info);
      }
    } catch (err) {
      console.warn("Vehicle analysis error:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * Build the color data payload from a selected swatch
   */
  const buildColorPayload = (selectedSwatch: InkFusionColor, selectedFinish: FinishType, swatchImageBase64?: string | null, swatchImageMimeType?: string) => {
    let manufacturer = (selectedSwatch as any).manufacturer || "";
    if (!manufacturer && selectedSwatch.colorLibrary) {
      const lib = selectedSwatch.colorLibrary.toLowerCase();
      if (lib.includes("avery") || lib === "avery_sw900") manufacturer = "Avery Dennison";
      else if (lib.includes("3m") || lib === "3m_2080") manufacturer = "3M";
      else if (lib.includes("hexis")) manufacturer = "Hexis";
      else if (lib.includes("kpmf")) manufacturer = "KPMF";
      else if (lib.includes("oracal")) manufacturer = "Oracal";
      else if (lib.includes("inozetek")) manufacturer = "Inozetek";
      else if (lib.includes("arlon")) manufacturer = "Arlon";
      else if (lib.includes("teckwrap")) manufacturer = "TeckWrap";
      else if (lib.includes("vvivid")) manufacturer = "VViViD";
    }

    const payload: Record<string, any> = {
      colorName: selectedSwatch.name,
      hex: selectedSwatch.hex,
      finish: selectedFinish.toLowerCase(),
      manufacturer,
      colorLibrary: selectedSwatch.colorLibrary || "colorpro",
      swatchId: (selectedSwatch as any).swatchId || (selectedSwatch as any).id || null,
      isVerifiedMatch: (selectedSwatch as any).isVerifiedMatch || false,
      materialProfile: (selectedSwatch as any).materialProfile || null,
      metallic: (selectedSwatch as any).metallic || false,
      pearl: (selectedSwatch as any).pearl || false,
    };

    if (swatchImageBase64) {
      payload.swatchImageBase64 = swatchImageBase64;
      payload.swatchImageMimeType = swatchImageMimeType || "image/png";
    }

    return { payload, manufacturer };
  };

  /**
   * Generate the wrap edit - calls the edit-vehicle-photo edge function (single photo)
   */
  const generateEdit = async (params: {
    selectedSwatch: InkFusionColor;
    selectedFinish: FinishType;
    swatchImageBase64?: string | null;
    swatchImageMimeType?: string;
  }) => {
    const { selectedSwatch, selectedFinish, swatchImageBase64, swatchImageMimeType } = params;

    if (!photoBase64) {
      toast({ title: "No photo uploaded", description: "Please upload a photo of your vehicle first.", variant: "destructive" });
      return { success: false, error: "No photo" };
    }

    if (!selectedSwatch) {
      toast({ title: "No color selected", description: "Please select a wrap color.", variant: "destructive" });
      return { success: false, error: "No color" };
    }

    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return { success: false, error: "Subscription limit reached" };
    }

    setIsGenerating(true);
    setEditedImageUrl(null);
    setErrorMessage(null);

    try {
      const user = await getActiveUser();
      const userEmail = user?.email;
      if (!userEmail) throw new Error("Please sign in to generate renders.");

      const { payload: colorDataPayload, manufacturer } = buildColorPayload(selectedSwatch, selectedFinish, swatchImageBase64, swatchImageMimeType);

      console.log("📸 Calling edit-vehicle-photo:", {
        color: colorDataPayload.colorName,
        finish: colorDataPayload.finish,
        manufacturer,
        hasSwatchImage: !!swatchImageBase64,
        vehicleInfo: detectedVehicleInfo,
      });

      const { data, error } = await invokeWithRetry(pickMyVehicleEndpoint(colorDataPayload?.toolSource), {
        userEmail,
        uploadedPhotoBase64: photoBase64,
        uploadedPhotoMimeType: photoMimeType,
        colorData: colorDataPayload,
        vehicleInfo: detectedVehicleInfo || undefined,
      });

      if (error) {
        console.error("Edge function error:", error);
        throw new Error(error.message || "Photo edit failed");
      }

      // Edge function can return { error: "..." } in the JSON body
      if (data?.error) {
        console.error("Edge function returned error:", data.error);
        throw new Error(data.error);
      }

      if (data?.renderUrl) {
        setEditedImageUrl(data.renderUrl);
        setVisualizationId(data.renderId);
        if (data.grounding) setGroundingData(data.grounding);
        await incrementRenderCount();

        toast({ title: "Wrap Preview Ready!", description: "Your vehicle photo has been edited with the selected wrap color." });
        return { success: true, imageUrl: data.renderUrl, grounding: data.grounding };
      }

      throw new Error("No image returned from the editor.");
    } catch (error: any) {
      console.error("🚨 Photo edit error:", error);
      const msg = error.message || "An unexpected error occurred.";
      setErrorMessage(msg);
      toast({ title: "Edit Failed", description: msg, variant: "destructive" });
      return { success: false, error: msg };
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Generate wrap edits for ALL uploaded multi-view photos.
   *
   * GATED FLOW:
   * 1. Render FIRST view only
   * 2. Pause — show approval gate (firstViewApprovalPending = true)
   * 3. User confirms "Color correct" → approveFirstView() → renders remaining views
   *    OR user clicks "Color wrong" → showRevisionModal → submitColorCorrection() → re-renders
   */
  const generateAllViewEdits = async (params: {
    selectedSwatch: InkFusionColor;
    selectedFinish: FinishType;
    swatchImageBase64?: string | null;
    swatchImageMimeType?: string;
  }) => {
    const { selectedSwatch, selectedFinish, swatchImageBase64, swatchImageMimeType } = params;

    if (multiViewPhotos.length === 0) {
      toast({ title: "No photos uploaded", description: "Please upload at least one vehicle photo.", variant: "destructive" });
      return { success: false, results: [] };
    }

    const canGenerate = await checkCanGenerate();
    if (!canGenerate) {
      setShowUpgradeModal(true);
      return { success: false, results: [] };
    }

    setIsGenerating(true);
    setErrorMessage(null);
    setMultiViewResults([]);
    setFirstViewApprovalPending(false);
    setFirstViewUrl(null);
    setMultiViewProgress({ current: 0, total: multiViewPhotos.length });

    try {
      const user = await getActiveUser();
      const userEmail = user?.email;
      if (!userEmail) throw new Error("Please sign in to generate renders.");

      const { payload: colorDataPayload } = buildColorPayload(selectedSwatch, selectedFinish, swatchImageBase64, swatchImageMimeType);

      // ── STEP 1: Render FIRST view only ──
      const firstPhoto = multiViewPhotos.find((p) => p.viewType === "front") || multiViewPhotos[0];
      setMultiViewProgress({ current: 1, total: multiViewPhotos.length });

      const { data, error } = await invokeWithRetry(pickMyVehicleEndpoint(colorDataPayload?.toolSource), {
        userEmail,
        uploadedPhotoBase64: firstPhoto.base64,
        uploadedPhotoMimeType: firstPhoto.mimeType,
        colorData: colorDataPayload,
        vehicleInfo: detectedVehicleInfo || undefined,
      });

      if (error || data?.error) {
        const msg = error?.message || data?.error || "First view render failed";
        setErrorMessage(msg);
        toast({ title: "Render Failed", description: msg, variant: "destructive" });
        return { success: false, results: [] };
      }

      if (!data?.renderUrl) {
        setErrorMessage("No image returned from the editor.");
        return { success: false, results: [] };
      }

      // Save first view result
      const firstResult: ViewEditResult = {
        viewType: firstPhoto.viewType,
        beforeUrl: firstPhoto.previewUrl,
        afterUrl: data.renderUrl,
      };
      setMultiViewResults([firstResult]);
      setFirstViewUrl(data.renderUrl);
      setEditedImageUrl(data.renderUrl);
      if (data.grounding) setGroundingData(data.grounding);
      await incrementRenderCount();

      // ── STEP 2: PAUSE — wait for user approval ──
      if (multiViewPhotos.length > 1) {
        setFirstViewApprovalPending(true);
        setPendingMultiViewParams({ selectedSwatch, selectedFinish, swatchImageBase64, swatchImageMimeType, userEmail, colorDataPayload });
        setIsGenerating(false);
        toast({ title: "First View Ready", description: "Check the color — approve to render remaining views, or correct if wrong." });
        return { success: true, results: [firstResult] };
      }

      // Only 1 photo — no gate needed
      toast({ title: "Wrap Preview Ready!", description: "Your vehicle has been wrapped." });
      return { success: true, results: [firstResult] };
    } catch (error: any) {
      console.error("Multi-view edit error:", error);
      const msg = error.message || "An unexpected error occurred.";
      setErrorMessage(msg);
      return { success: false, results: [] };
    } finally {
      if (!firstViewApprovalPending) setIsGenerating(false);
    }
  };

  /**
   * APPROVE first view — promote grounding reference to 'verified', then render remaining views
   */
  const approveFirstView = async () => {
    if (!pendingMultiViewParams) return;

    const { userEmail, colorDataPayload, selectedSwatch } = pendingMultiViewParams;

    // Promote reference to verified
    try {
      const user = await getActiveUser();
      await renderClient.functions.invoke("myvehicle-color-grounding", {
        body: {
          action: "approve",
          referenceId: groundingData?.referenceId || null,
          userId: user?.id || null,
          manufacturer: colorDataPayload.manufacturer || selectedSwatch?.manufacturer,
          filmName: colorDataPayload.colorName,
          sku: colorDataPayload.productCode || colorDataPayload.sku || null,
        },
      });
      console.log("✅ Film color reference promoted to verified");
    } catch (err) {
      console.warn("Non-fatal: approval write failed:", err);
    }

    setFirstViewApprovalPending(false);
    setPendingMultiViewParams(null);

    // ── STEP 3: Render remaining views ──
    await renderRemainingViews(userEmail, colorDataPayload);
  };

  /**
   * Render remaining views (after approval or correction)
   */
  const renderRemainingViews = async (userEmail: string, colorDataPayload: any) => {
    const firstPhoto = multiViewPhotos.find((p) => p.viewType === "front") || multiViewPhotos[0];
    const remainingPhotos = multiViewPhotos.filter((p) => p.viewType !== firstPhoto.viewType);

    if (remainingPhotos.length === 0) return;

    setIsGenerating(true);
    setMultiViewProgress({ current: 1, total: multiViewPhotos.length });

    const results: ViewEditResult[] = [...multiViewResults];
    const viewErrors: string[] = [];

    for (let i = 0; i < remainingPhotos.length; i++) {
      const photo = remainingPhotos[i];
      setMultiViewProgress({ current: i + 2, total: multiViewPhotos.length });

      try {
        const { data, error } = await invokeWithRetry(pickMyVehicleEndpoint(colorDataPayload?.toolSource), {
          userEmail,
          uploadedPhotoBase64: photo.base64,
          uploadedPhotoMimeType: photo.mimeType,
          colorData: colorDataPayload,
          vehicleInfo: detectedVehicleInfo || undefined,
        });

        if (error || data?.error) {
          viewErrors.push(`${photo.viewType}: ${error?.message || data?.error}`);
          continue;
        }

        if (data?.renderUrl) {
          const result: ViewEditResult = {
            viewType: photo.viewType,
            beforeUrl: photo.previewUrl,
            afterUrl: data.renderUrl,
          };
          results.push(result);
          setMultiViewResults((prev) => [...prev, result]);
          await incrementRenderCount();
        }
      } catch (viewErr: any) {
        viewErrors.push(`${photo.viewType}: ${viewErr.message}`);
      }
    }

    setIsGenerating(false);

    if (results.length > 1) {
      toast({ title: "All Views Rendered!", description: `${results.length}/${multiViewPhotos.length} views generated.` });

      // ── LOCKED SEQUENTIAL: 2D Proof FIRST → Artboard FROM proof ──
      // DO NOT CHANGE without Trish approval. Artboard MUST use 2D proof
      // as source — proof has dimensions. Without it, artboard drifts.
      if (visualizationId) {
        const allViewUrls: Record<string, string> = {};
        for (const r of results) allViewUrls[r.viewType] = r.afterUrl;
        const vYear = detectedVehicleInfo?.year || '';
        const vMake = detectedVehicleInfo?.make || '';
        const vModel = detectedVehicleInfo?.model || '';
        const vehicleName = `${vYear} ${vMake} ${vModel}`.trim();
        const proofBody = { allViewUrls, vehicleYear: vYear, vehicleMake: vMake, vehicleModel: vModel, designName: colorDataPayload.colorName || 'MyVehiclePro Design', finish: colorDataPayload.finish || 'Gloss' };

        console.log(`[MyVehiclePro] Phase 4a: 2D proof from ${results.length} locked views...`);
        (async () => {
          try {
            const { data: proofData, error: proofErr } = await renderClient.functions.invoke('generate-2d-proof', { body: proofBody });
            const proofUrl = proofData?.proofUrl || proofData?.url;
            if (proofErr || !proofUrl) { console.warn('[MyVehiclePro] 2D proof failed:', proofErr?.message || 'no URL'); return; }
            await saveProofUrlToViz(visualizationId, proofUrl);
            console.log('[MyVehiclePro] Phase 4a complete — 2D proof saved');

            console.log('[MyVehiclePro] Phase 4b: artboard from 2D proof (deterministic)...');
            const { data: artData } = await renderClient.functions.invoke('auto-generate-artboard', {
              body: {
                ...proofBody,
                allViewUrls: Object.fromEntries(['front', 'side', 'rear'].filter(k => allViewUrls[k]).map(k => [k, allViewUrls[k]])),
                visualizationId,
                skipProofGeneration: true,
                flatProofUrl: proofUrl,
              },
            });
            const artUrl = artData?.artboard_url || artData?.artboardUrl || artData?.url;
            if (artUrl) {
              const abRes = await saveArtboardUrlToViz(visualizationId, artUrl);
              if (!abRes.ok) console.warn('[MyVehiclePro] artboard cache write failed:', abRes.vizError);
              else console.log('[MyVehiclePro] Phase 4b complete — artboard saved');
            }
          } catch (e) { console.warn('[MyVehiclePro] Phase 4 error (non-fatal):', e); }
        })();
      }
    } else if (viewErrors.length > 0) {
      toast({ title: "Some Views Failed", description: viewErrors[0], variant: "destructive" });
    }
  };

  /**
   * Submit color correction — uploads references to film_color_references, then re-renders first view
   */
  const submitColorCorrection = async (correction: {
    swatchImageUrl?: string;
    vehicleExampleUrls?: string[];
    notes?: string;
  }) => {
    if (!pendingMultiViewParams) return;
    const { selectedSwatch, selectedFinish, swatchImageBase64, swatchImageMimeType, colorDataPayload } = pendingMultiViewParams;

    try {
      const user = await getActiveUser();

      // Write correction to film_color_references
      await renderClient.functions.invoke("myvehicle-color-grounding", {
        body: {
          action: "correct",
          manufacturer: colorDataPayload.manufacturer || "",
          filmName: colorDataPayload.colorName,
          sku: colorDataPayload.productCode || colorDataPayload.sku || null,
          swatchImageUrl: correction.swatchImageUrl || null,
          vehicleExampleUrls: correction.vehicleExampleUrls || [],
          userId: user?.id || null,
          notes: correction.notes || null,
        },
      });

      console.log("✅ Color correction saved");
      toast({ title: "Correction Saved", description: "Re-rendering with your reference images..." });

      // Re-render first view with corrected grounding
      setShowRevisionModal(false);
      setFirstViewApprovalPending(false);
      setMultiViewResults([]);
      setFirstViewUrl(null);

      // Re-trigger full gated flow (grounding will now pick up the user_upload references)
      await generateAllViewEdits({ selectedSwatch, selectedFinish, swatchImageBase64, swatchImageMimeType });
    } catch (err: any) {
      console.error("Correction submit error:", err);
      toast({ title: "Correction Failed", description: err.message, variant: "destructive" });
    }
  };

  /**
   * Generate proof PDF with before/after images
   */
  const generateProofPdf = async (params: {
    selectedSwatch: InkFusionColor;
    selectedFinish: FinishType;
    customerName?: string;
    shopName?: string;
    price?: string;
    includeTerms?: boolean;
    toolName?: string;
  }) => {
    const { selectedSwatch, selectedFinish, customerName, shopName, price, includeTerms, toolName } = params;

    // Build views from multi-view results or single photo
    let views: Array<{ viewType: string; beforeUrl: string; afterUrl: string }> = [];

    if (multiViewResults.length > 0) {
      views = multiViewResults;
    } else if (photoPreviewUrl && editedImageUrl) {
      views = [{ viewType: "roof", beforeUrl: photoPreviewUrl, afterUrl: editedImageUrl }];
    }

    if (views.length === 0) {
      toast({ title: "No renders available", description: "Generate a wrap preview before downloading the proof.", variant: "destructive" });
      return null;
    }

    setIsGeneratingPdf(true);
    try {
      let manufacturer = (selectedSwatch as any).manufacturer || "";
      if (!manufacturer && selectedSwatch.colorLibrary) {
        const lib = selectedSwatch.colorLibrary.toLowerCase();
        if (lib.includes("avery") || lib === "avery_sw900") manufacturer = "Avery Dennison";
        else if (lib.includes("3m") || lib === "3m_2080") manufacturer = "3M";
        else if (lib.includes("hexis")) manufacturer = "Hexis";
        else if (lib.includes("kpmf")) manufacturer = "KPMF";
        else if (lib.includes("oracal")) manufacturer = "Oracal";
      }

      // Lookup vehicle measurements for yardage calculation
      let yardage: { totalSqFt: number; linearYards: number; panels: any } | undefined;
      if (detectedVehicleInfo?.make && detectedVehicleInfo?.model) {
        const vehicle = findVehicle(detectedVehicleInfo.make, detectedVehicleInfo.model, detectedVehicleInfo.year);
        if (vehicle && vehicle.totalSqFt) {
          const breakdown = getPanelBreakdown(vehicle);
          // Standard vinyl roll is 60" wide → linear inches = totalSqFt * 144 / 60
          const linearInches = (vehicle.totalSqFt * 144) / 60;
          const linearYards = Math.ceil(linearInches / 36 * 1.15); // +15% waste factor
          yardage = { totalSqFt: vehicle.totalSqFt, linearYards, panels: breakdown };
        }
      }

      const { data, error } = await invokeWithRetry("generate-myvehicle-proof-pdf", {
        views,
        vehicleInfo: detectedVehicleInfo || {},
        colorInfo: {
          manufacturer,
          colorName: selectedSwatch.name,
          productCode: (selectedSwatch as any).productCode || (selectedSwatch as any).product_code || "",
          finish: selectedFinish,
          hex: selectedSwatch.hex,
        },
        customerName,
        shopName,
        price,
        includeTerms: includeTerms !== false,
        toolName: toolName || "My Vehicle",
        yardage,
      });

      if (error) throw new Error(error.message || "PDF generation failed");

      if (data?.url) {
        setProofPdfUrl(data.url);
        toast({ title: "Proof PDF Ready!", description: "Your design approval proof has been generated." });
        return data.url;
      }

      throw new Error("No PDF URL returned");
    } catch (error: any) {
      console.error("🚨 PDF generation error:", error);
      toast({ title: "PDF Failed", description: error.message, variant: "destructive" });
      return null;
    } finally {
      setIsGeneratingPdf(false);
    }
  };

  /**
   * Clear all photos and results
   */
  const clearPhoto = () => {
    setPhotoPreviewUrl(null);
    setPhotoBase64(null);
    setPhotoMimeType("image/jpeg");
    setDetectedVehicleInfo(null);
    setEditedImageUrl(null);
    setVisualizationId(null);
    setErrorMessage(null);
    setMultiViewPhotos([]);
    setMultiViewResults([]);
    setMultiViewProgress({ current: 0, total: 0 });
    setProofPdfUrl(null);
    setFirstViewApprovalPending(false);
    setFirstViewUrl(null);
    setGroundingData(null);
    setShowRevisionModal(false);
    setPendingMultiViewParams(null);
  };

  return {
    // Single photo state
    photoPreviewUrl,
    photoMimeType,
    detectedVehicleInfo,
    isAnalyzing,

    // Multi-view state
    multiViewPhotos,
    multiViewResults,
    multiViewProgress,

    // Render state
    isGenerating,
    editedImageUrl,
    visualizationId,
    errorMessage,

    // First-view approval gate
    firstViewApprovalPending,
    firstViewUrl,
    groundingData,
    showRevisionModal,
    setShowRevisionModal,

    // PDF state
    isGeneratingPdf,
    proofPdfUrl,

    // Upgrade modal
    showUpgradeModal,
    setShowUpgradeModal,

    // Actions
    handlePhotoUpload,
    handleMultiViewPhotoUpload,
    removeMultiViewPhoto,
    updateVehicleInfo,
    generateEdit,
    generateAllViewEdits,
    approveFirstView,
    submitColorCorrection,
    generateProofPdf,
    clearPhoto,
  };
};
