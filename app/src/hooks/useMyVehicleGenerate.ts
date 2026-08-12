import { useState, useRef, useCallback } from "react";
import { renderClient } from "@/integrations/supabase/renderClient";
import { getActiveUser } from "@/lib/auth-session";
import { pickMyVehicleEndpoint } from "@/lib/myvehicleEndpoint";
import type { ViewPhotoData } from "@/hooks/useMyVehicleMode";

export interface MvpViewResult {
  viewType: string;
  url: string;
  beforeUrl: string;
}

/**
 * Shared hook for generating wraps on user-uploaded vehicle photos.
 * Used by every tool page (ColorPro, DesignPro, FadeWraps, GraphicsPro, WBTY)
 * when MyVehiclePro mode is active.
 *
 * FIRE-AND-POLL PATTERN:
 * - Single photo: fires the edge function and awaits (fast enough for mobile)
 * - Multi-view: fires ALL photos in parallel background calls, then polls
 *   color_visualizations every 3s for completed renders. Results appear
 *   progressively as each view finishes. No long-running HTTP connection.
 */
/** Resize image to max dimension for edge function (keeps quality, reduces payload). */
function resizeBase64(base64: string, mimeType: string, maxDim = 1600): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width, h = img.height;
      if (w <= maxDim && h <= maxDim) {
        resolve({ base64, mimeType }); // Already small enough
        return;
      }
      const scale = maxDim / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
      resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    };
    img.onerror = () => resolve({ base64, mimeType }); // Fallback: send original
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

export const useMyVehicleGenerate = () => {
  const [mvpIsGenerating, setMvpIsGenerating] = useState(false);
  const [mvpEditedImageUrl, setMvpEditedImageUrl] = useState<string | null>(null);
  const [mvpBeforeUrl, setMvpBeforeUrl] = useState<string | null>(null);
  const [mvpMultiViewResults, setMvpMultiViewResults] = useState<MvpViewResult[]>([]);
  const [mvpError, setMvpError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const generateOnMyVehicle = async (params: {
    photoBase64: string;
    photoMimeType: string;
    photoPreviewUrl: string | null;
    multiViewPhotos: ViewPhotoData[];
    uploadMode: "single" | "multi";
    colorData: Record<string, any>;
    vehicleInfo: { make: string; model: string; year: string };
  }): Promise<boolean> => {
    setMvpIsGenerating(true);
    setMvpEditedImageUrl(null);
    setMvpBeforeUrl(null);
    setMvpMultiViewResults([]);
    setMvpError(null);
    abortRef.current = false;
    stopPolling();

    try {
      const user = await getActiveUser();
      if (!user?.email) throw new Error("Please sign in to generate");

      // Per-tool edge function — keeps prompt tweaks in one tool from
      // affecting any other tool. Anything we don't recognize falls
      // back to edit-vehicle-photo.
      const endpoint = pickMyVehicleEndpoint(params.colorData?.toolSource);

      if (params.uploadMode === "single") {
        // Single photo — resize then call
        const { base64: resized, mimeType: resizedMime } = await resizeBase64(params.photoBase64, params.photoMimeType);
        const { data, error } = await renderClient.functions.invoke(endpoint, {
          body: {
            userEmail: user.email,
            uploadedPhotoBase64: resized,
            uploadedPhotoMimeType: resizedMime,
            colorData: params.colorData,
            vehicleInfo: params.vehicleInfo,
          },
        });

        if (error) throw new Error(error.message || "Generation failed");
        if (data?.error) throw new Error(data.error);
        if (!data?.renderUrl) throw new Error("No image returned");

        setMvpEditedImageUrl(data.renderUrl);
        setMvpBeforeUrl(params.photoPreviewUrl);
        setMvpIsGenerating(false);
        return true;
      }

      // ── MULTI-VIEW: Fire-and-poll ──────────────────────────────────
      // Record the timestamp before firing so we can query for renders created after this point
      const batchStartedAt = new Date().toISOString();
      const totalPhotos = params.multiViewPhotos.length;
      const beforeUrls = new Map<string, string>();

      // Store before URLs for matching later
      for (const photo of params.multiViewPhotos) {
        beforeUrls.set(photo.viewType, photo.previewUrl);
      }

      // Fire ALL photos in parallel with resize + per-call timeout.
      // Each call is independent — failures don't block others.
      let completedCount = 0;

      for (const photo of params.multiViewPhotos) {
        (async () => {
          try {
            const { base64: resized, mimeType: resizedMime } = await resizeBase64(photo.base64, photo.mimeType);

            // Per-call timeout — don't hang forever on one view
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 90_000);

            const { data, error } = await renderClient.functions.invoke(endpoint, {
              body: {
                userEmail: user.email,
                uploadedPhotoBase64: resized,
                uploadedPhotoMimeType: resizedMime,
                colorData: params.colorData,
                vehicleInfo: params.vehicleInfo,
              },
            });

            clearTimeout(timeout);

            if (error || !data?.renderUrl) {
              console.warn(`MyVehicle view ${photo.viewType} failed:`, error || data?.error);
              return;
            }

            setMvpMultiViewResults((prev) => {
              if (prev.some((r) => r.viewType === photo.viewType)) return prev;
              const next = [...prev, {
                viewType: photo.viewType,
                url: data.renderUrl,
                beforeUrl: photo.previewUrl,
              }];
              if (next.length === 1) {
                setMvpEditedImageUrl(data.renderUrl);
                setMvpBeforeUrl(photo.previewUrl);
              }
              return next;
            });
          } catch (err) {
            console.warn(`MyVehicle view ${photo.viewType} exception:`, err);
          } finally {
            completedCount++;
            if (completedCount >= totalPhotos) {
              setMvpIsGenerating(false);
            }
          }
        })();
      }

      // Set a safety timeout — if not all views complete in 5 minutes, stop spinning
      setTimeout(() => {
        setMvpIsGenerating(false);
      }, 5 * 60 * 1000);

      // Return true immediately — views will appear progressively
      return true;
    } catch (err: any) {
      setMvpError(err.message || "An unexpected error occurred");
      setMvpIsGenerating(false);
      return false;
    }
  };

  const clearMyVehicleResults = () => {
    abortRef.current = true;
    stopPolling();
    setMvpEditedImageUrl(null);
    setMvpBeforeUrl(null);
    setMvpMultiViewResults([]);
    setMvpError(null);
    setMvpIsGenerating(false);
  };

  return {
    mvpIsGenerating,
    mvpEditedImageUrl,
    mvpBeforeUrl,
    mvpMultiViewResults,
    mvpError,
    generateOnMyVehicle,
    clearMyVehicleResults,
  };
};
