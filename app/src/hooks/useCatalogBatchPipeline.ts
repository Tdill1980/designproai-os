/**
 * useCatalogBatchPipeline
 *
 * Renders every color in a manufacturer's catalog as a hood_detail shot
 * on a specific vehicle. One render per color — no extra views.
 *
 * Output: square-cropped hood detail with watermark overlay:
 *   Top-left:     "ColorPro™"
 *   Bottom-right:  "{Color Name}\n{Product Code}"
 *
 * Designed for cost-effective catalog generation (~$0.08/color).
 */

import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { stampOverlayOnImage } from "@/lib/overlay-stamper";

/* ================================================================ */
/* TYPES                                                             */
/* ================================================================ */

export interface CatalogColor {
  id: string;
  manufacturer: string;
  product_code: string;
  official_name: string;
  official_hex: string;
  finish: string;
  series?: string | null;
  /** CIE LAB values for hard enforcement color accuracy */
  lab_l?: number | null;
  lab_a?: number | null;
  lab_b?: number | null;
  /** Material flags */
  metallic?: boolean | null;
  pearl?: boolean | null;
  chrome?: boolean | null;
}

export interface CatalogJob {
  id: string;
  color: CatalogColor;
  vehicle: { year: string; make: string; model: string };
  status: "queued" | "rendering" | "cropping" | "done" | "failed";
  renderUrl: string | null;
  error: string | null;
  startedAt: number | null;
  durationMs: number | null;
}

export interface CatalogBatchConfig {
  manufacturer: string;
  vehicle: { year: string; make: string; model: string };
  /** Max colors to render (0 = all). Useful for test runs */
  limit?: number;
  /** Enable watermark overlay (default true) */
  watermark?: boolean;
}

export interface CatalogBatchStats {
  total: number;
  done: number;
  failed: number;
  manufacturer: string;
}

/** Fixed vehicle assignments per manufacturer */
export const MANUFACTURER_VEHICLES: Record<string, { year: string; make: string; model: string }> = {
  "Hexis":           { year: "2024", make: "McLaren",    model: "720S" },
  "Avery Dennison":  { year: "2024", make: "Chevrolet",  model: "Corvette C8" },
  "3M":              { year: "2024", make: "Ford",        model: "F-250 Super Duty" },
  "Inozetek":        { year: "2024", make: "Toyota",      model: "Supra" },
  "Oracal":          { year: "2024", make: "Porsche",     model: "Panamera" },
  "KPMF":            { year: "2024", make: "BMW",         model: "M4" },
  "TeckWrap":        { year: "2024", make: "Lamborghini", model: "Huracán" },
};

/** Human-readable display names */
const MANUFACTURER_DISPLAY: Record<string, string> = {
  "3M": "3M",
  "Avery Dennison": "Avery Dennison",
  "Hexis": "Hexis",
  "Inozetek": "Inozetek",
  "KPMF": "KPMF",
  "Oracal": "Oracal",
  "TeckWrap": "TeckWrap",
};

/* ================================================================ */
/* CONSTANTS                                                         */
/* ================================================================ */

const DELAY_BETWEEN_MS = 4000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 3000;
const SESSION_REFRESH_INTERVAL = 10;
const INVOKE_TIMEOUT_MS = 180_000;

/* ================================================================ */
/* EDGE FUNCTION INVOCATION WITH RETRY                               */
/* ================================================================ */

async function invokeWithRetry(
  functionName: string,
  body: Record<string, unknown>,
  timeoutMs = INVOKE_TIMEOUT_MS,
  label = functionName,
): Promise<{ data: any; error: any }> {
  const MAX_INVOKE_RETRIES = 3;
  for (let attempt = 0; attempt <= MAX_INVOKE_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body,
        // @ts-expect-error - signal support
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!error) return { data, error: null };

      const msg = error.message || "";
      const isRetryable =
        msg.includes("Failed to send") || msg.includes("FunctionsFetchError") ||
        msg.includes("Failed to fetch") || msg.includes("NetworkError") ||
        msg.includes("503") || msg.includes("429") || msg.includes("rate limit") ||
        msg.includes("JWT") || msg.includes("401");

      if (!isRetryable || attempt === MAX_INVOKE_RETRIES) return { data, error };

      if (msg.includes("JWT") || msg.includes("401")) {
        try { await supabase.auth.refreshSession(); } catch {}
      }

      const waitMs = msg.includes("JWT") ? 1000 : Math.pow(2, attempt + 2) * 1000;
      await new Promise((r) => setTimeout(r, waitMs));
    } catch (err: any) {
      clearTimeout(timer);
      if (attempt === MAX_INVOKE_RETRIES) {
        return { data: null, error: new Error(err?.name === "AbortError" ? `${label} timed out` : err?.message || "Unknown error") };
      }
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt + 2) * 1000));
    }
  }
  return { data: null, error: new Error(`${label} failed after retries`) };
}

/* ================================================================ */
/* SQUARE CROP UTILITY                                               */
/* ================================================================ */

/**
 * Crop a landscape image to a center square, then stamp with the official
 * overlay-stamper (same as ColorPro tool). Returns the uploaded URL.
 */
async function cropSquareStampAndUpload(
  imageUrl: string,
  manufacturer: string,
  colorName: string,
  productCode: string,
  doStamp: boolean,
): Promise<string> {
  // Step 1: Crop to square
  const response = await fetch(imageUrl, { mode: "cors" });
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const srcBlob = await response.blob();
  const srcUrl = URL.createObjectURL(srcBlob);

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Failed to load image for crop"));
    el.src = srcUrl;
  });

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const size = Math.min(w, h);
  const sx = Math.floor((w - size) / 2);
  const sy = Math.floor((h - size) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, sx, sy, size, size, 0, 0, size, size);
  URL.revokeObjectURL(srcUrl);

  const croppedBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/png", 1.0,
    );
  });

  // Step 2: Stamp with official overlay-stamper (if enabled)
  let finalBlob = croppedBlob;
  if (doStamp) {
    const croppedUrl = URL.createObjectURL(croppedBlob);
    try {
      const label = productCode ? `${colorName} ${productCode}` : colorName;
      finalBlob = await stampOverlayOnImage(croppedUrl, {
        toolKey: "colorpro",
        manufacturer,
        colorOrDesignName: label,
      });
    } finally {
      URL.revokeObjectURL(croppedUrl);
    }
  }

  // Step 3: Upload
  const fileName = `catalog-swatches/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`;
  const { error: uploadError } = await supabase.storage
    .from("color-renders")
    .upload(fileName, finalBlob, { contentType: "image/png", upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage.from("color-renders").getPublicUrl(fileName);
  return urlData.publicUrl;
}

/* ================================================================ */
/* HOOK                                                              */
/* ================================================================ */

let _seq = 0;

export function useCatalogBatchPipeline() {
  const [jobs, setJobs] = useState<CatalogJob[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "rendering" | "complete">("idle");
  const [batchId, setBatchId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);

  const patch = (id: string, fields: Partial<CatalogJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...fields } : j)));

  const waitWhilePaused = async (): Promise<boolean> => {
    while (pauseRef.current) {
      if (abortRef.current) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    return !abortRef.current;
  };

  const stats: CatalogBatchStats = {
    total: jobs.length,
    done: jobs.filter((j) => j.status === "done").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    manufacturer: jobs[0]?.color.manufacturer || "",
  };

  /* ================================================================ */
  /* FETCH COLORS FROM DB                                              */
  /* ================================================================ */

  const fetchManufacturerColors = async (manufacturer: string, limit?: number): Promise<CatalogColor[]> => {
    // Try manufacturer_colors first (authoritative)
    let query = supabase
      .from("manufacturer_colors")
      .select("id, manufacturer, product_code, official_name, official_hex, finish, series, lab_l, lab_a, lab_b")
      .eq("manufacturer", manufacturer)
      .or("is_verified.eq.true,is_verified.is.null")
      .eq("is_ppf", false)
      .order("official_name", { ascending: true });

    if (limit && limit > 0) {
      query = query.limit(limit);
    }

    const { data, error } = await query;

    if (!error && data && data.length > 0) {
      return data.map((row) => ({
        id: row.id,
        manufacturer: row.manufacturer,
        product_code: row.product_code,
        official_name: row.official_name,
        official_hex: row.official_hex,
        finish: row.finish,
        series: row.series,
        lab_l: row.lab_l,
        lab_a: row.lab_a,
        lab_b: row.lab_b,
      }));
    }

    // Fallback to vinyl_swatches
    let fallbackQuery = supabase
      .from("vinyl_swatches")
      .select("id, manufacturer, code, name, hex, finish, series, metallic, pearl, chrome")
      .eq("manufacturer", manufacturer)
      .eq("verified", true)
      .or("ppf.eq.false,ppf.is.null")
      .order("name", { ascending: true });

    if (limit && limit > 0) {
      fallbackQuery = fallbackQuery.limit(limit);
    }

    const { data: fbData, error: fbError } = await fallbackQuery;
    if (fbError || !fbData) return [];

    return fbData.map((row) => ({
      id: row.id,
      manufacturer: row.manufacturer,
      product_code: row.code || "",
      official_name: row.name,
      official_hex: row.hex,
      finish: row.finish,
      series: row.series,
      metallic: row.metallic,
      pearl: row.pearl,
      chrome: row.chrome,
    }));
  };

  /* ================================================================ */
  /* START CATALOG BATCH                                               */
  /* ================================================================ */

  const startCatalogBatch = useCallback(async (config: CatalogBatchConfig) => {
    const { manufacturer, vehicle, limit, watermark = true } = config;

    // Fetch colors from DB
    const colors = await fetchManufacturerColors(manufacturer, limit);
    if (colors.length === 0) {
      console.error(`[CatalogBatch] No colors found for manufacturer: ${manufacturer}`);
      return;
    }

    const currentBatchId = `batch_catalog_${manufacturer.replace(/\s+/g, "_")}_${Date.now()}`;
    const queue: CatalogJob[] = colors.map((color) => ({
      id: `cj_${Date.now()}_${++_seq}`,
      color,
      vehicle,
      status: "queued" as const,
      renderUrl: null,
      error: null,
      startedAt: null,
      durationMs: null,
    }));

    setBatchId(currentBatchId);
    setJobs(queue);
    setRunning(true);
    setPaused(false);
    setPhase("rendering");
    setCurrentIdx(0);
    abortRef.current = false;
    pauseRef.current = false;

    // Auth — toast + redirect on failure
    let email: string | undefined;
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (!error && data.session?.user?.email) {
        email = data.session.user.email;
      }
    } catch {}
    if (!email) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        email = session?.user?.email || undefined;
      } catch {}
    }
    if (!email) {
      toast.error("Session expired — please log in again", {
        action: { label: "Log In", onClick: () => window.location.assign("/login") },
        duration: 10000,
      });
      setRunning(false);
      setPhase("idle");
      return;
    }

    const mfrDisplay = MANUFACTURER_DISPLAY[manufacturer] || manufacturer;

    // Process each color
    for (let i = 0; i < queue.length; i++) {
      if (abortRef.current) break;
      const canContinue = await waitWhilePaused();
      if (!canContinue) break;

      setCurrentIdx(i);
      const job = queue[i];

      // Refresh session periodically
      if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
        try {
          const { data } = await supabase.auth.refreshSession();
          if (data.session?.user?.email) email = data.session.user.email;
        } catch {}
      }

      patch(job.id, { status: "rendering", startedAt: Date.now() });

      const t0 = Date.now();
      let renderUrl: string | null = null;
      let error: string | null = null;

      // Render with retries
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        if (abortRef.current) break;

        const { data, error: invokeErr } = await invokeWithRetry(
          "generate-color-render",
          {
            vehicleYear: vehicle.year,
            vehicleMake: vehicle.make,
            vehicleModel: vehicle.model,
            modeType: "colorpro",
            viewType: "hood_detail",
            userEmail: email,
            colorData: {
              // Pass the DB row ID so the edge function does a direct lookup
              // in manufacturer_colors — gets authoritative LAB, hex, finish, swatch
              id: job.color.id,
              swatchId: job.color.id,
              colorName: job.color.official_name,
              hex: job.color.official_hex,
              finish: job.color.finish,
              colorLibrary: job.color.manufacturer.toLowerCase().replace(/\s+/g, "-"),
              productCode: job.color.product_code,
              isVerifiedMatch: true,
              // Material flags for surface rendering
              ...(job.color.metallic != null ? { metallic: job.color.metallic } : {}),
              ...(job.color.pearl != null ? { pearl: job.color.pearl } : {}),
              ...(job.color.chrome != null ? { chrome: job.color.chrome } : {}),
            },
          },
          INVOKE_TIMEOUT_MS,
          `${mfrDisplay} ${job.color.official_name}`,
        );

        if (!invokeErr && data?.renderUrl) {
          renderUrl = data.renderUrl;
          error = null;
          break;
        }

        error = invokeErr?.message || data?.error || "No image returned";
        if (attempt < MAX_RETRIES - 1) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, attempt)));
        }
      }

      // Square crop + watermark
      if (renderUrl) {
        patch(job.id, { status: "cropping" });
        try {
          renderUrl = await cropSquareStampAndUpload(
            renderUrl,
            mfrDisplay,
            job.color.official_name,
            job.color.product_code,
            watermark,
          );
        } catch (err) {
          console.warn(`[CatalogBatch] Crop/stamp failed for ${job.color.official_name}, using original:`, err);
        }
      }

      const durationMs = Date.now() - t0;
      const finalStatus = renderUrl ? "done" : "failed";

      queue[i] = { ...queue[i], status: finalStatus, renderUrl, error, durationMs } as CatalogJob;
      patch(job.id, { status: finalStatus, renderUrl, error, durationMs });

      // Persist to DB
      if (renderUrl) {
        try {
          await supabase.from("color_visualizations").insert({
            customer_email: email,
            vehicle_year: parseInt(vehicle.year) || 2024,
            vehicle_make: vehicle.make,
            vehicle_model: vehicle.model,
            color_name: `${mfrDisplay} ${job.color.official_name}`,
            color_hex: job.color.official_hex,
            finish_type: job.color.finish,
            mode_type: "colorpro",
            render_urls: { hood_detail: renderUrl } as any,
            admin_notes: JSON.stringify({
              batch: true,
              batch_id: currentBatchId,
              tool: "catalog_swatch",
              manufacturer: manufacturer,
              product_code: job.color.product_code,
              color_name: job.color.official_name,
              view: "hood_detail",
              square_crop: true,
              duration_ms: durationMs,
            }),
            design_file_name: `${mfrDisplay} ${job.color.official_name} (${job.color.product_code}) - ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
            generation_status: "completed",
            subscription_tier: "admin",
          });
        } catch (err) {
          console.error(`[CatalogBatch] Persist failed for ${job.color.official_name}:`, err);
        }
      }

      // Delay between renders
      if (i < queue.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
      }
    }

    setPhase("complete");
    setRunning(false);
  }, []);

  const stop = useCallback(() => {
    abortRef.current = true;
    setRunning(false);
  }, []);

  const pause = useCallback(() => {
    pauseRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pauseRef.current = false;
    setPaused(false);
  }, []);

  return {
    jobs,
    running,
    paused,
    currentIdx,
    phase,
    stats,
    batchId,
    startCatalogBatch,
    fetchManufacturerColors,
    stop,
    pause,
    resume,
  };
}
