/**
 * useTextMaskDetect — Detects text/logos in panel images via Gemini Vision,
 * manages mask regions, and sends confirmed regions to vectorize-it.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

// vectorize-it now proxies to the droplet vectorize-server (Topaz 4x upscale
// + VTracer + path simplification). Every consumer — frontend, ProductionFlow,
// run-production-flow, file-upload-output, quick-prep-vector-trace — goes
// through the same Supabase function so the algorithm stays canonical.
//
// The Vercel /api/vectorize-it route still exists and works (memory-only
// fix, no Topaz, no simplification) but is no longer the default. Override
// per-session with VITE_VECTORIZE_PROVIDER=vercel or ?vectorize=vercel for
// regression testing.
function resolveVectorizeProvider(): "vercel" | "supabase" {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search).get("vectorize");
    if (q === "vercel" || q === "supabase") return q;
  }
  const env = (import.meta as any).env?.VITE_VECTORIZE_PROVIDER;
  return env === "vercel" ? "vercel" : "supabase";
}

async function invokeVectorizeIt(
  payload: Record<string, unknown>,
): Promise<{ data: any; error: { message: string } | null }> {
  if (resolveVectorizeProvider() === "vercel") {
    try {
      const resp = await fetch("/api/vectorize-it", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await resp.json().catch(() => null);
      if (!resp.ok || !data?.success) {
        return { data: null, error: { message: data?.error || `HTTP ${resp.status}` } };
      }
      return { data, error: null };
    } catch (err: any) {
      return { data: null, error: { message: err?.message || String(err) } };
    }
  }
  return supabase.functions.invoke("vectorize-it", { body: payload });
}

export interface TextRegion {
  id: string;
  type: "logo" | "text" | "phone" | "url" | "graphic";
  label: string;
  content?: string;
  /** Bounding box as percent of image (0–100) */
  bbox: { x: number; y: number; width: number; height: number };
  confidence: number;
  confirmed: boolean;
  excluded: boolean;
}

interface VectorResult {
  regionId: string;
  label: string;
  svgUrl: string;
  storagePath: string;
}

interface UseTextMaskDetectOpts {
  jobId?: string;
  userId?: string;
}

export function useTextMaskDetect(opts: UseTextMaskDetectOpts) {
  const { jobId, userId } = opts;

  const [regions, setRegions] = useState<TextRegion[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [vectorizing, setVectorizing] = useState(false);
  const [vectorResults, setVectorResults] = useState<VectorResult[]>([]);
  const [summary, setSummary] = useState("");
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null);

  // Detect text/logos using extract-logo-elements edge function
  const detectRegions = useCallback(async (imageUrl: string) => {
    setDetecting(true);
    setRegions([]);
    setSummary("");
    try {
      const { data, error } = await supabase.functions.invoke("extract-logo-elements", {
        body: {
          job_id: jobId,
          approved_render_url: imageUrl,
          user_id: userId,
        },
      });

      if (error) throw new Error(error.message);

      const elements = data?.elements || [];
      const mapped: TextRegion[] = elements.map((el: any) => ({
        id: el.id,
        type: el.type,
        label: el.label,
        content: el.content || undefined,
        bbox: {
          x: (el.bounding_box?.x || 0) * 100,
          y: (el.bounding_box?.y || 0) * 100,
          width: (el.bounding_box?.width || 0) * 100,
          height: (el.bounding_box?.height || 0) * 100,
        },
        confidence: el.confidence || 0.5,
        confirmed: true,
        excluded: false,
      }));

      setRegions(mapped);
      setSummary(data?.summary || `Found ${mapped.length} elements`);
      return mapped;
    } finally {
      setDetecting(false);
    }
  }, [jobId, userId]);

  // Toggle confirm/exclude on a region
  const toggleRegion = useCallback((id: string, field: "confirmed" | "excluded") => {
    setRegions((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        if (field === "confirmed") return { ...r, confirmed: !r.confirmed, excluded: false };
        return { ...r, excluded: !r.excluded, confirmed: false };
      }),
    );
  }, []);

  // Update a region's bbox (after drag/resize on canvas)
  const updateRegionBbox = useCallback(
    (id: string, bbox: TextRegion["bbox"]) => {
      setRegions((prev) => prev.map((r) => (r.id === id ? { ...r, bbox } : r)));
    },
    [],
  );

  // Add a manual region
  const addManualRegion = useCallback(() => {
    const id = `manual-${Date.now()}`;
    setRegions((prev) => [
      ...prev,
      {
        id,
        type: "graphic",
        label: "Manual Region",
        bbox: { x: 10, y: 10, width: 20, height: 20 },
        confidence: 1,
        confirmed: true,
        excluded: false,
      },
    ]);
  }, []);

  // Remove a region
  const removeRegion = useCallback((id: string) => {
    setRegions((prev) => prev.filter((r) => r.id !== id));
  }, []);

  // Crop a region from the source image and upload to storage
  const cropAndUpload = useCallback(
    async (imageUrl: string, region: TextRegion): Promise<string> => {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.crossOrigin = "anonymous";
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = imageUrl;
      });

      const sx = (region.bbox.x / 100) * img.width;
      const sy = (region.bbox.y / 100) * img.height;
      const sw = (region.bbox.width / 100) * img.width;
      const sh = (region.bbox.height / 100) * img.height;

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(sw);
      canvas.height = Math.round(sh);
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      const bytes = new Uint8Array(await blob.arrayBuffer());

      const path = `qc-masks/${userId || "anon"}/${jobId || "manual"}/crop-${region.id}-${Date.now()}.png`;
      const { error } = await supabase.storage
        .from("wrap-files")
        .upload(path, bytes, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`Upload crop failed: ${error.message}`);

      const { data } = await supabase.storage
        .from("wrap-files")
        .createSignedUrl(path, 3600);
      return data?.signedUrl || "";
    },
    [userId, jobId],
  );

  // Vectorize all confirmed regions
  const vectorizeConfirmed = useCallback(
    async (imageUrl: string) => {
      const confirmed = regions.filter((r) => r.confirmed && !r.excluded);
      if (!confirmed.length) return;

      setVectorizing(true);
      setVectorResults([]);
      const results: VectorResult[] = [];

      try {
        for (const region of confirmed) {
          const cropUrl = await cropAndUpload(imageUrl, region);
          if (!cropUrl) continue;

          // Text/phone/url regions trace cleaner with the binary text-tuned
          // preset; logos and graphics use full-color detailed.
          const traceMode =
            region.type === "text" || region.type === "phone" || region.type === "url"
              ? "text"
              : "detailed";

          const payload = {
            user_id: userId,
            file_url: cropUrl,
            file_name: `${region.label}.png`,
            trace_mode: traceMode,
            color_count: 6,
            smoothing: 1.0,
          };
          const { data, error } = await invokeVectorizeIt(payload);

          if (error) {
            console.warn(`Vectorize failed for ${region.id}:`, error.message);
            continue;
          }

          if (data?.svg_url || data?.output_url) {
            results.push({
              regionId: region.id,
              label: region.label,
              svgUrl: data.svg_url || data.output_url,
              storagePath: data.storage_path || "",
            });
          }
        }

        setVectorResults(results);
        return results;
      } finally {
        setVectorizing(false);
      }
    },
    [regions, userId, cropAndUpload],
  );

  // Export mask data as JSON to storage
  const exportMaskData = useCallback(async () => {
    const confirmed = regions.filter((r) => r.confirmed && !r.excluded);
    const maskData = {
      jobId,
      regions: confirmed,
      exportedAt: new Date().toISOString(),
      imageSize,
    };
    const json = JSON.stringify(maskData, null, 2);
    const bytes = new TextEncoder().encode(json);
    const path = `qc-masks/${userId || "anon"}/${jobId || "manual"}/text-mask-${Date.now()}.json`;

    const { error } = await supabase.storage
      .from("wrap-files")
      .upload(path, bytes, { contentType: "application/json", upsert: true });

    if (error) throw new Error(`Export failed: ${error.message}`);
    return path;
  }, [regions, jobId, userId, imageSize]);

  return {
    regions,
    detecting,
    vectorizing,
    vectorResults,
    summary,
    imageSize,
    setImageSize,
    detectRegions,
    toggleRegion,
    updateRegionBbox,
    addManualRegion,
    removeRegion,
    vectorizeConfirmed,
    exportMaskData,
  };
}
