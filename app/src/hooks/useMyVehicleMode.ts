import { useState } from "react";
import { renderClient } from "@/integrations/supabase/renderClient";
import { toast } from "@/hooks/use-toast";

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

    const waitMs = Math.pow(2, attempt + 1) * 1000;
    console.warn(`Edge function "${functionName}" network error, retrying in ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
    await new Promise((r) => setTimeout(r, waitMs));
  }

  return renderClient.functions.invoke(functionName, { body });
}

/**
 * Validate photo dimensions before sending to the renderer.
 *
 * Hard block (rejects upload): long edge < 600px — too small to upscale
 * cleanly to a 4K render, output will be blurry.
 *
 * Soft warning (allows upload, toasts a heads-up): aspect < 0.85 —
 * portrait/phone-screen-grab photos still render but may not look as good
 * as a landscape source.
 */
function validatePhotoQuality(file: File): Promise<{ ok: boolean; reason?: string; warning?: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width: w, height: h } = img;
      const longEdge = Math.max(w, h);
      const aspect = w / h;
      if (longEdge < 600) {
        resolve({ ok: false, reason: `Photo is too low quality (${w}×${h}). Use at least 600px on the long side for a sharp render.` });
        return;
      }
      const warning = aspect < 0.85
        ? "This is a portrait photo — landscape shots render best. We'll do our best, but the result may not look as sharp as a wide photo."
        : undefined;
      resolve({ ok: true, warning });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ ok: false, reason: "Couldn't read image. Try a different file." });
    };
    img.src = url;
  });
}

export interface VehicleInfo {
  make: string;
  model: string;
  year: string;
  color?: string;
  finish?: string;
}

export interface ViewPhotoData {
  viewType: string;
  base64: string;
  mimeType: string;
  previewUrl: string;
}

/**
 * Lightweight hook managing ONLY photo upload + vehicle detection state.
 * Does NOT include color selection, rendering, or PDF logic.
 * Used by every tool page that supports MyVehiclePro mode.
 */
export const useMyVehicleMode = () => {
  const [isMyVehicleMode, setIsMyVehicleMode] = useState(false);

  // Single photo state
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoMimeType, setPhotoMimeType] = useState<string>("image/jpeg");

  // Multi-view photo state
  const [multiViewPhotos, setMultiViewPhotos] = useState<ViewPhotoData[]>([]);

  // Vehicle detection state
  const [detectedVehicleInfo, setDetectedVehicleInfo] = useState<VehicleInfo | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Upload mode (single vs multi-view) — default to multi so all angles can be uploaded at once
  const [uploadMode, setUploadMode] = useState<"single" | "multi">("multi");

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
        toast({ title: "Couldn't identify vehicle", description: "Enter year, make & model manually below.", variant: "destructive", duration: 6000 });
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
      } else {
        toast({ title: "Couldn't identify vehicle", description: "Enter year, make & model manually below.", variant: "destructive", duration: 6000 });
      }
    } catch (err) {
      console.warn("Vehicle analysis error:", err);
      toast({ title: "Couldn't identify vehicle", description: "Enter year, make & model manually below.", variant: "destructive", duration: 6000 });
    } finally {
      setIsAnalyzing(false);
    }
  };

  /**
   * Handle single photo upload - reads the file and auto-analyzes it
   */
  const handlePhotoUpload = async (file: File) => {
    setDetectedVehicleInfo(null);

    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) {
      toast({ title: "Invalid file", description: "Please upload a JPEG, PNG, or WebP image.", variant: "destructive" });
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Image must be under 10MB.", variant: "destructive" });
      return;
    }

    const quality = await validatePhotoQuality(file);
    if (!quality.ok) {
      toast({ title: "Photo can't be used", description: quality.reason, variant: "destructive", duration: 7000 });
      return;
    }
    if (quality.warning) {
      toast({ title: "Heads up — quality may suffer", description: quality.warning, duration: 7000 });
    }

    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string;
      setPhotoPreviewUrl(dataUrl);
      setPhotoMimeType(file.type);

      const base64 = dataUrl.split(",")[1];
      setPhotoBase64(base64);

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

    const quality = await validatePhotoQuality(file);
    if (!quality.ok) {
      toast({ title: "Photo can't be used", description: quality.reason, variant: "destructive", duration: 7000 });
      return;
    }
    if (quality.warning) {
      toast({ title: "Heads up — quality may suffer", description: quality.warning, duration: 7000 });
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
  };

  /**
   * Clear all photos and detection state
   */
  const clearPhotos = () => {
    setPhotoPreviewUrl(null);
    setPhotoBase64(null);
    setPhotoMimeType("image/jpeg");
    setDetectedVehicleInfo(null);
    setMultiViewPhotos([]);
    setUploadMode("single");
  };

  /**
   * Check if user has uploaded at least one photo
   */
  const hasPhotos = uploadMode === "single" ? !!photoBase64 : multiViewPhotos.length > 0;

  return {
    // Mode
    isMyVehicleMode,
    setIsMyVehicleMode,
    uploadMode,
    setUploadMode,

    // Single photo state
    photoPreviewUrl,
    photoBase64,
    photoMimeType,

    // Multi-view state
    multiViewPhotos,

    // Detection state
    detectedVehicleInfo,
    isAnalyzing,

    // Computed
    hasPhotos,

    // Actions
    handlePhotoUpload,
    handleMultiViewPhotoUpload,
    removeMultiViewPhoto,
    clearPhotos,
  };
};
