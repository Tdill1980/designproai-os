/**
 * useRestyleBatchPipeline
 *
 * Dedicated batch pipeline for ReStyle (artistic/aesthetic) renders.
 * Pulls from the 100-prompt ReStyle library and drives design-panel-ai-generate
 * with mode="restyle" for each job, then generates 7 views + PDF proofs.
 *
 * Separate from useBatchTestPipeline to keep ReStyle batches isolated
 * with their own progress tracking and vehicle pool.
 */

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { getRandomPresets } from "@/data/prompt-presets";
import { generateAndSaveProof, type ProofView } from "@/lib/proof-service";

/* ================================================================ */
/* CONSTANTS                                                         */
/* ================================================================ */

const DELAY_BETWEEN_MS = 4_000;
const VIEW_DELAY_MS = 3_000;
const MAX_VIEW_RETRIES = 2;
const MAX_RENDER_RETRIES = 3;
const MAX_INVOKE_RETRIES = 3; // retries specifically for edge function network/503 errors
const RETRY_DELAY_MS = 3_000;
const SESSION_REFRESH_INTERVAL = 10;
const INVOKE_TIMEOUT_MS = 180_000; // 3 min - edge functions can take 50s+

export const VIEW_ORDER = [
  "side",
  "passenger-side",
  "hood_detail",
  "front",
  "rear",
  "close-up",
  "roof",
];

export const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up Detail",
  roof: "Roof",
};

// Camera angle descriptions - must match locked CAMERA_ANGLES from view-angles-os.ts
const VIEW_ANGLE_PROMPTS: Record<string, string> = {
  "side": "Camera position: perfectly level, straight-on driver side profile. Camera height: door handle height, perpendicular to vehicle body. Full vehicle in frame with 10% padding on all sides. Vehicle faces left in the frame. Show full vehicle length from front bumper to rear bumper, BOTH driver-side wheels visible.",
  "passenger-side": "Camera position: perfectly level, straight-on PASSENGER SIDE (RIGHT SIDE) profile. Camera is on the OPPOSITE side of the vehicle from the driver side - the camera sees the passenger door, NOT the driver door. Camera height: door handle height, perpendicular to vehicle body. Full vehicle in frame with 10% padding on all sides. Vehicle faces RIGHT in the frame (nose pointing right). This is the MIRROR IMAGE of the driver side view. Show full vehicle length from front bumper to rear bumper, BOTH passenger-side wheels visible.",
  "hood_detail": "Camera position: standing at the front of the vehicle, slightly elevated, looking back across the ENTIRE hood surface. Camera height: just above hood level - slightly elevated, angled gently downward (15-25 degrees). The ENTIRE HOOD is visible from front edge to windshield base - show the FULL hood wrap design. The hood panel fills the frame - this is a hood detail shot, not a front grille shot. Show the complete wrap artwork across the full hood surface from edge to edge.",
  "front": "Camera position: straight-on front view, centered on the grille. Camera height: bumper/grille height, looking straight at the front of the vehicle. See full front fascia: headlights, grille, hood edge, front bumper, windshield. NOT a 3/4 angle. Perfectly straight on. Symmetrical left-right.",
  "rear": "Camera position: straight-on rear view, centered on tailgate/hatch. Camera height: bumper height, looking straight at the back of the vehicle. See full rear: taillights, tailgate/hatch, rear bumper, rear window. NOT a 3/4 angle. Perfectly straight on. Symmetrical left-right.",
  "close-up": "Camera position: 18-24 inches from the vehicle body, waist height, angled obliquely along the bodyline curve. 85mm f/2.8, shallow depth of field. Door handle, window edge, and body curves visible for context. Body panels fill 90%+ of frame. NO full vehicle, NO wheels. Photorealistic vinyl wrap surface: ink depth, laminate sheen, specular highlights, material texture conforming to body curves, full resolution of printed design. Dramatic angled bodyline shot.",
  "roof": "Camera position: directly overhead top-down view, camera centered above the vehicle looking straight down. Show the full roof panel, A-pillars to trunk. The roof surface fills 90% of the frame.",
};

/** Vehicles well-suited for artistic / aesthetic wraps */
const RESTYLE_VEHICLES = [
  { year: "2024", make: "Porsche", model: "911 GT3" },
  { year: "2024", make: "McLaren", model: "720S" },
  { year: "2024", make: "Lamborghini", model: "Huracán" },
  { year: "2024", make: "BMW", model: "M4" },
  { year: "2024", make: "Ford", model: "Mustang GT" },
  { year: "2024", make: "Chevrolet", model: "Corvette C8" },
  { year: "2024", make: "Tesla", model: "Model S Plaid" },
  { year: "2024", make: "Audi", model: "RS e-tron GT" },
  { year: "2024", make: "Mercedes-AMG", model: "GT" },
  { year: "2024", make: "Nissan", model: "Z" },
  { year: "2024", make: "Porsche", model: "911 Turbo S" },
  { year: "2024", make: "Nissan", model: "GT-R R35" },
  { year: "2024", make: "Ford", model: "Raptor" },
  { year: "2024", make: "Dodge", model: "Challenger" },
  { year: "2024", make: "Toyota", model: "Supra" },
  { year: "2024", make: "Tesla", model: "Model Y" },
  { year: "2024", make: "Lamborghini", model: "Urus" },
  { year: "2024", make: "Porsche", model: "Cayenne" },
  { year: "2024", make: "Range Rover", model: "Sport" },
  { year: "2024", make: "Jeep", model: "Wrangler" },
  { year: "2024", make: "Ford", model: "Bronco" },
  { year: "2024", make: "Mazda", model: "RX-7" },
  { year: "2024", make: "Cadillac", model: "Escalade" },
  { year: "2024", make: "Dodge", model: "Charger" },
  { year: "2024", make: "Subaru", model: "WRX" },
  { year: "2024", make: "Honda", model: "Civic Type R" },
  { year: "2024", make: "Ferrari", model: "Roma" },
  { year: "2024", make: "Rolls-Royce", model: "Ghost" },
  { year: "2024", make: "Aston Martin", model: "DBX" },
  { year: "2024", make: "Lexus", model: "LC 500" },
];

const FINISHES: Array<"Gloss" | "Satin" | "Matte"> = [
  "Gloss",
  "Satin",
  "Matte",
];

/* ================================================================ */
/* TYPES                                                             */
/* ================================================================ */

export interface RestyleJob {
  id: string;
  prompt: string;
  designName: string;
  subcategory: string;
  vehicle: { year: string; make: string; model: string };
  finish: string;
  status: "queued" | "rendering" | "views" | "done" | "failed";
  renderUrl: string | null;
  views: Record<string, string>;
  viewsProgress: number;
  error: string | null;
  startedAt: number | null;
  durationMs: number | null;
  proofUrl: string | null;
  proofId: string | null;
  /** Design anchor text from persona-designer-generate for cross-view consistency */
  designAnchorText?: string | null;
  /** Generation ID from persona-designer-generate */
  generationId?: string | null;
}

export interface CustomRestyleJob {
  prompt: string;
  designName: string;
  vehicle: { year: string; make: string; model: string };
  finish: "Gloss" | "Satin" | "Matte";
}

export interface RestyleBatchConfig {
  quantity: number;
  concurrencyLimit?: number;
  customJobs?: CustomRestyleJob[];
}

/* ================================================================ */
/* HELPERS                                                           */
/* ================================================================ */

/**
 * Invoke a Supabase edge function with retry logic for transient failures.
 * Handles FunctionsFetchError (network), 503 (edge runtime busy), and
 * 429 (rate limited) with exponential backoff. Uses AbortController to
 * properly cancel timed-out requests and free browser connections.
 */
async function invokeWithRetry(
  functionName: string,
  body: Record<string, unknown>,
  timeoutMs = INVOKE_TIMEOUT_MS,
  label = functionName,
): Promise<{ data: any; error: any }> {
  for (let attempt = 0; attempt <= MAX_INVOKE_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const { data, error } = await supabase.functions.invoke(functionName, {
        body,
        // @ts-expect-error - Supabase JS v2.81+ supports signal option
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!error) return { data, error: null };

      const msg = error.message || "";
      const isNetworkError =
        msg.includes("Failed to send a request") ||
        msg.includes("FunctionsFetchError") ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError") ||
        msg.includes("network");

      // Detect JWT/auth errors (401) - refresh session and retry
      let isAuthError = false;
      if ((error as any).context) {
        try {
          const status = (error as any).context.status;
          isAuthError = status === 401 || status === 403;
        } catch {}
      }
      isAuthError = isAuthError ||
        msg.includes("Invalid JWT") ||
        msg.includes("JWT expired") ||
        msg.includes("invalid claim") ||
        msg.includes("token is expired") ||
        msg.includes("401");

      let isServerBusy = false;
      if ((error as any).context) {
        try {
          const status = (error as any).context.status;
          isServerBusy = status === 503 || status === 429;
        } catch {}
      }
      isServerBusy = isServerBusy ||
        msg.includes("503") ||
        msg.includes("Service Unavailable") ||
        msg.includes("boot") ||
        msg.includes("edge") ||
        msg.includes("429") ||
        msg.includes("rate limit");

      const isRetryable = isNetworkError || isServerBusy || isAuthError;

      if (!isRetryable || attempt === MAX_INVOKE_RETRIES) {
        return { data, error };
      }

      // On auth errors, force-refresh the session before retrying
      if (isAuthError) {
        console.warn(`🔑 [RestylePipeline] "${label}" JWT error - refreshing session before retry...`);
        try {
          await supabase.auth.refreshSession();
        } catch {
          console.warn(`🔑 [RestylePipeline] Session refresh failed`);
        }
      }

      const waitMs = isAuthError ? 1000 : Math.pow(2, attempt + 2) * 1000; // 1s for auth, 4s/8s/16s for others
      console.warn(
        `⏳ [RestylePipeline] "${label}" ${isAuthError ? "JWT" : isServerBusy ? "503/429" : "network"} error, ` +
        `retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_INVOKE_RETRIES})...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    } catch (err: any) {
      clearTimeout(timer);

      const isAbort = err?.name === "AbortError";
      const msg = err?.message || "";
      const isNetworkLevel =
        isAbort ||
        msg.includes("Failed to send") ||
        msg.includes("Failed to fetch") ||
        msg.includes("NetworkError");

      if (!isNetworkLevel || attempt === MAX_INVOKE_RETRIES) {
        return {
          data: null,
          error: new Error(
            isAbort
              ? `${label} timed out after ${timeoutMs / 1000}s`
              : msg || "Unknown edge function error",
          ),
        };
      }

      const waitMs = Math.pow(2, attempt + 2) * 1000;
      console.warn(
        `⏳ [RestylePipeline] "${label}" ${isAbort ? "timeout" : "fetch error"}, ` +
        `retrying in ${waitMs / 1000}s (attempt ${attempt + 1}/${MAX_INVOKE_RETRIES})...`,
      );
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }

  return { data: null, error: new Error(`${label} failed after ${MAX_INVOKE_RETRIES + 1} attempts`) };
}

let _seq = 0;

/* ================================================================ */
/* HOOK                                                              */
/* ================================================================ */

export function useRestyleBatchPipeline() {
  const [jobs, setJobs] = useState<RestyleJob[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<
    "idle" | "rendering" | "views" | "complete"
  >("idle");
  const [batchId, setBatchId] = useState<string | null>(null);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);

  /* ---- state helpers ---- */

  const patch = (id: string, fields: Partial<RestyleJob>) =>
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, ...fields } : j)),
    );

  const waitWhilePaused = async (): Promise<boolean> => {
    while (pauseRef.current) {
      if (abortRef.current) return false;
      await new Promise((r) => setTimeout(r, 500));
    }
    return !abortRef.current;
  };

  const getSession = async () => {
    for (let i = 0; i < 3; i++) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user?.email) return session;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };

  const refreshSession = async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        const session = await getSession();
        return session?.user?.email || null;
      }
      return data.session?.user?.email || null;
    } catch {
      const session = await getSession();
      return session?.user?.email || null;
    }
  };

  /* ================================================================ */
  /* RENDER ONE (design-panel-ai-generate, mode=restyle)               */
  /* ================================================================ */

  const renderOne = async (
    job: RestyleJob,
  ): Promise<Partial<RestyleJob>> => {
    const t0 = Date.now();

    try {
      // Call design-panel-ai-generate for hero render + design anchor
      const { data, error } = await invokeWithRetry(
        "design-panel-ai-generate",
        {
          prompt: job.prompt,
          mode: "restyle",
          finish: job.finish,
          vehicleYear: job.vehicle.year,
          vehicleMake: job.vehicle.make,
          vehicleModel: job.vehicle.model,
        },
        INVOKE_TIMEOUT_MS,
        `ReStyle render ${job.designName}`,
      );

      if (error) {
        let detail = data?.message || data?.error;
        if (!detail && (error as any).context) {
          try {
            const b = await (error as any).context.json();
            detail = b?.message || b?.error || JSON.stringify(b);
          } catch {}
        }
        throw new Error(detail || error.message);
      }

      if (!data?.renderUrl) throw new Error("No image returned from DesignProAI");

      return {
        status: "done",
        renderUrl: data.renderUrl,
        designAnchorText: data.designAnchorText || null,
        generationId: data.generationId || null,
        durationMs: Date.now() - t0,
      };
    } catch (err: unknown) {
      return {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - t0,
      };
    }
  };

  /* ================================================================ */
  /* GENERATE 7 VIEWS                                                  */
  /* ================================================================ */

  const generateViews = async (
    job: RestyleJob,
  ): Promise<Record<string, string>> => {
    patch(job.id, { status: "views", viewsProgress: 0 });

    const newViews: Record<string, string> = {};
    let completed = 0;

    for (const viewType of VIEW_ORDER) {
      let viewUrl: string | null = null;

      for (let attempt = 1; attempt <= MAX_VIEW_RETRIES; attempt++) {
        try {
          // Call design-panel-ai-generate with designAnchorText
          // for cross-view consistency via restyle mode
          const { data, error } = await invokeWithRetry(
            "design-panel-ai-generate",
            {
              designAnchorText: job.designAnchorText,
              originalRenderUrl: job.renderUrl,
              vehicleYear: job.vehicle.year,
              vehicleMake: job.vehicle.make,
              vehicleModel: job.vehicle.model,
              finish: job.finish,
              generationId: job.generationId,
              viewType: viewType,
              mode: "restyle",
            },
            INVOKE_TIMEOUT_MS,
            `${job.designName} view ${viewType}`,
          );

          if (!error && data?.renderUrl) {
            viewUrl = data.renderUrl;
            break;
          }
        } catch {
          /* retry */
        }

        if (attempt < MAX_VIEW_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }

      if (viewUrl) {
        newViews[viewType] = viewUrl;
      }

      completed++;
      patch(job.id, { views: { ...newViews }, viewsProgress: completed });

      if (completed < VIEW_ORDER.length) {
        await new Promise((r) => setTimeout(r, VIEW_DELAY_MS));
      }
    }

    patch(job.id, {
      views: newViews,
      status: "done",
      viewsProgress: VIEW_ORDER.length,
    });

    return newViews;
  };

  /* ================================================================ */
  /* PERSIST TO SUPABASE                                               */
  /* ================================================================ */

  const persistRender = async (
    job: RestyleJob,
    views: Record<string, string>,
    currentBatchId: string,
    email: string,
  ): Promise<string | null> => {
    try {
      const renderUrls: Record<string, string> = {};
      if (job.renderUrl) renderUrls.side = job.renderUrl;
      for (const [key, url] of Object.entries(views)) {
        renderUrls[key] = url;
      }

      const adminNotes = JSON.stringify({
        batch: true,
        batch_id: currentBatchId,
        tool: "restyle",
        original_prompt: job.prompt,
        design_name: job.designName,
        duration_ms: job.durationMs,
        views_generated: Object.keys(views).length,
        designiq_mode: "restyle",
        subcategory: job.subcategory,
      });

      const { data } = await supabase
        .from("color_visualizations")
        .insert({
          customer_email: email,
          vehicle_year: parseInt(job.vehicle.year) || 2024,
          vehicle_make: job.vehicle.make,
          vehicle_model: job.vehicle.model,
          color_name: job.designName,
          color_hex: "#000000",
          finish_type: job.finish,
          mode_type: "designpanelpro",
          render_urls: renderUrls as Json,
          admin_notes: adminNotes,
          design_file_name: `${job.designName} - ${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model} [ReStyle Batch ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}]`,
          generation_status: "completed",
          subscription_tier: "admin",
        })
        .select("id")
        .single();

      return data?.id || null;
    } catch (err) {
      console.error("[RestylePipeline] Failed to persist render:", err);
      return null;
    }
  };

  /* ================================================================ */
  /* MAIN PIPELINE                                                     */
  /* ================================================================ */

  const startPipeline = useCallback(
    async (config?: RestyleBatchConfig) => {
      const concurrency = config?.concurrencyLimit || 2;
      const currentBatchId = `batch_restyle_${Date.now()}`;
      setBatchId(currentBatchId);

      let queue: RestyleJob[];

      if (config?.customJobs && config.customJobs.length > 0) {
        // Custom prompt injector mode - use the exact prompts + vehicles provided
        queue = config.customJobs.map((cj) => ({
          id: `rsj_${Date.now()}_${++_seq}`,
          prompt: cj.prompt,
          designName: cj.designName,
          subcategory: "Custom",
          vehicle: cj.vehicle,
          finish: cj.finish,
          status: "queued" as const,
          renderUrl: null,
          views: {},
          viewsProgress: 0,
          error: null,
          startedAt: null,
          durationMs: null,
          proofUrl: null,
          proofId: null,
          designAnchorText: null,
          generationId: null,
        }));
      } else {
        // Random preset mode - pull from the library
        const quantity = config?.quantity || 5;
        const presets = getRandomPresets(quantity, "restyle");

        let finishIdx = 0;
        let vehicleIdx = 0;
        const shuffledVehicles = [...RESTYLE_VEHICLES].sort(
          () => Math.random() - 0.5,
        );

        queue = presets.map((preset) => {
          const vehicle = preset.vehicle ||
            shuffledVehicles[vehicleIdx % shuffledVehicles.length];
          vehicleIdx++;
          const finish = FINISHES[finishIdx % FINISHES.length];
          finishIdx++;

          return {
            id: `rsj_${Date.now()}_${++_seq}`,
            prompt: preset.prompt,
            designName: preset.name || preset.subcategory || preset.id,
            subcategory: preset.subcategory,
            vehicle,
            finish,
            status: "queued" as const,
            renderUrl: null,
            views: {},
            viewsProgress: 0,
            error: null,
            startedAt: null,
            durationMs: null,
            proofUrl: null,
            proofId: null,
            designAnchorText: null,
            generationId: null,
          };
        });
      }

      // Log all prompts to verify uniqueness
      const promptTexts = queue.map((j) => j.prompt.slice(0, 80));
      const uniquePrompts = new Set(promptTexts);
      console.log(
        `[RestylePipeline] Queue built: ${queue.length} jobs, ${uniquePrompts.size} unique prompts`,
        queue.map((j) => `${j.designName}: "${j.prompt.slice(0, 60)}…"`),
      );
      if (uniquePrompts.size < queue.length) {
        console.warn("[RestylePipeline] DUPLICATE PROMPTS DETECTED in queue!");
      }

      setJobs(queue);
      setRunning(true);
      setPaused(false);
      setPhase("rendering");
      setCurrentIdx(0);
      abortRef.current = false;
      pauseRef.current = false;

      // Force-refresh the session BEFORE starting - prevents "Invalid JWT" errors
      // when the token has expired since the page was loaded.
      // Try refresh first; if that fails, try getSession; then validate the token
      // by making a lightweight Supabase call to catch expired refresh tokens.
      let email: string | null = null;
      try {
        const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
        if (!refreshErr && refreshData.session?.user?.email) {
          email = refreshData.session.user.email;
        }
      } catch {}

      if (!email) {
        const session = await getSession();
        email = session?.user?.email || null;
      }

      if (!email) {
        console.error("[RestylePipeline] No authenticated session - cannot start batch");
        setRunning(false);
        setPhase("idle");
        return;
      }

      // Validate the token is actually usable with a lightweight DB call
      try {
        const { error: testErr } = await supabase.from("color_visualizations").select("id").limit(1);
        if (testErr && (testErr.message?.includes("JWT") || testErr.message?.includes("401"))) {
          console.error("[RestylePipeline] Session token is invalid after refresh - user must re-login");
          setRunning(false);
          setPhase("idle");
          return;
        }
      } catch {}
      console.log(`[RestylePipeline] Session validated for ${email}`);

      /* ---- Phase 1: Render all jobs ---- */

      const processJob = async (
        i: number,
        currentEmail: { value: string },
      ) => {
        const job = queue[i];

        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "rendering" as const, startedAt: Date.now() }
              : j,
          ),
        );

        let result = await renderOne(job);

        // Retry with exponential backoff
        for (
          let attempt = 1;
          attempt < MAX_RENDER_RETRIES && result.status === "failed";
          attempt++
        ) {
          if (abortRef.current) break;
          const backoffMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, backoffMs));
          result = await renderOne(job);
        }

        queue[i] = { ...queue[i], ...result } as RestyleJob;
        patch(job.id, result);
      };

      if (concurrency <= 1) {
        for (let i = 0; i < queue.length; i++) {
          if (abortRef.current) break;
          const canContinue = await waitWhilePaused();
          if (!canContinue) break;

          setCurrentIdx(i);

          if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
            const refreshedEmail = await refreshSession();
            if (refreshedEmail) email = refreshedEmail;
          }

          await processJob(i, { value: email });

          if (i < queue.length - 1 && !abortRef.current) {
            await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
          }
        }
      } else {
        for (
          let batchStart = 0;
          batchStart < queue.length;
          batchStart += concurrency
        ) {
          if (abortRef.current) break;
          const canContinue = await waitWhilePaused();
          if (!canContinue) break;

          if (
            batchStart > 0 &&
            batchStart % (SESSION_REFRESH_INTERVAL * concurrency) === 0
          ) {
            const refreshedEmail = await refreshSession();
            if (refreshedEmail) email = refreshedEmail;
          }

          setCurrentIdx(batchStart);

          const batchEnd = Math.min(batchStart + concurrency, queue.length);
          const batchPromises: Promise<void>[] = [];

          for (let i = batchStart; i < batchEnd; i++) {
            batchPromises.push(processJob(i, { value: email }));
          }

          await Promise.all(batchPromises);

          if (batchEnd < queue.length && !abortRef.current) {
            await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
          }
        }
      }

      /* ---- Phase 1.5: Persist initial renders ---- */

      const refreshedEmail1 = await refreshSession();
      if (refreshedEmail1) email = refreshedEmail1;

      const persistedIds: Record<string, string> = {};
      for (let i = 0; i < queue.length; i++) {
        const job = queue[i];
        if (job.status === "failed" || !job.renderUrl) continue;

        try {
          const vizId = await persistRender(
            job,
            {},
            currentBatchId,
            email,
          );
          if (vizId) persistedIds[job.id] = vizId;
        } catch (err) {
          console.error(
            `[RestylePipeline] Failed to persist initial render for ${job.id}:`,
            err,
          );
        }
      }

      /* ---- Phase 2: Generate 7 views per successful render ---- */

      if (!abortRef.current) {
        setPhase("views");

        const refreshedEmail2 = await refreshSession();
        if (refreshedEmail2) email = refreshedEmail2;

        for (let i = 0; i < queue.length; i++) {
          if (abortRef.current) break;

          const canContinue = await waitWhilePaused();
          if (!canContinue) break;

          setCurrentIdx(i);

          const job = queue[i];
          if (!job || job.status === "failed" || !job.renderUrl) continue;

          if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
            const refreshedViewEmail = await refreshSession();
            if (refreshedViewEmail) email = refreshedViewEmail;
          }

          const views = await generateViews(job);

          // Update persisted record with views
          const vizId = persistedIds[job.id];
          if (vizId && views && Object.keys(views).length > 0) {
            try {
              const renderUrls: Record<string, string> = {};
              if (job.renderUrl) renderUrls.side = job.renderUrl;
              for (const [key, url] of Object.entries(views)) {
                renderUrls[key] = url;
              }

              await supabase
                .from("color_visualizations")
                .update({ render_urls: renderUrls as Json })
                .eq("id", vizId);
            } catch (err) {
              console.error(
                `[RestylePipeline] Failed to update views for ${job.id}:`,
                err,
              );
            }
          }

          // Generate PDF proof
          if (views && Object.keys(views).length > 0) {
            try {
              const proofViews: ProofView[] = Object.entries(views).map(
                ([type, url]) => ({
                  type,
                  url,
                  label: VIEW_LABELS[type] || type,
                }),
              );
              if (job.renderUrl && !views.side) {
                proofViews.unshift({
                  type: "side",
                  url: job.renderUrl,
                  label: "Driver Side",
                });
              }

              const proofResult = await generateAndSaveProof({
                toolKey: "designpanelpro",
                views: proofViews,
                vehicleInfo: {
                  year: job.vehicle.year,
                  make: job.vehicle.make,
                  model: job.vehicle.model,
                },
                filmName: job.designName,
                finish: job.finish,
                customerName: `ReStyle Batch ${currentBatchId.replace("batch_restyle_", "")}`,
              });

              if (proofResult.success) {
                patch(job.id, {
                  proofUrl: proofResult.pdfUrl || null,
                  proofId: proofResult.proofId || null,
                });
              }
            } catch (err) {
              console.warn(
                `[RestylePipeline] Proof generation error for ${job.designName}:`,
                err,
              );
            }
          }

          if (i < queue.length - 1 && !abortRef.current) {
            await new Promise((r) => setTimeout(r, 1000));
          }
        }
      }

      setRunning(false);
      setPaused(false);
      setPhase("complete");
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current = true;
    pauseRef.current = false;
    setPaused(false);
  }, []);

  const pause = useCallback(() => {
    pauseRef.current = true;
    setPaused(true);
  }, []);

  const resume = useCallback(() => {
    pauseRef.current = false;
    setPaused(false);
  }, []);

  /* ---- stats ---- */

  const subcategories = [
    ...new Set(jobs.map((j) => j.subcategory).filter(Boolean)),
  ];

  const stats = {
    total: jobs.length,
    done: jobs.filter((j) => j.status === "done").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    rendering: jobs.filter((j) => j.status === "rendering").length,
    viewsInProgress: jobs.filter((j) => j.status === "views").length,
    totalViews: jobs.reduce(
      (sum, j) => sum + Object.keys(j.views).length,
      0,
    ),
    totalProofs: jobs.filter((j) => j.proofUrl).length,
    subcategories,
    bySubcategory: subcategories.reduce(
      (acc, sub) => {
        const subJobs = jobs.filter((j) => j.subcategory === sub);
        acc[sub] = {
          total: subJobs.length,
          done: subJobs.filter((j) => j.status === "done").length,
          failed: subJobs.filter((j) => j.status === "failed").length,
          views: subJobs.reduce(
            (s, j) => s + Object.keys(j.views).length,
            0,
          ),
        };
        return acc;
      },
      {} as Record<
        string,
        { total: number; done: number; failed: number; views: number }
      >,
    ),
  };

  return {
    jobs,
    running,
    paused,
    currentIdx,
    phase,
    stats,
    batchId,
    startPipeline,
    stop,
    pause,
    resume,
  };
}
