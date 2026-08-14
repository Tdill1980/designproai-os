/**
 * useBulkRenderQueue
 *
 * Full production pipeline:
 * 1. Fires hero renders one-at-a-time through design-panel-ai-generate
 * 2. Persists star ratings to neuralnetwork_design_dna + neuralnetwork_feedback
 * 3. Supports revision re-renders and VisionBoardIQ pass-through
 * 4. Generates 6 views sequentially via design-panel-ai-generate (fresh 3D renders per angle) (same DesignPro pipeline)
 *    - all 6 fired simultaneously, no delays between views
 * 5. Triggers UniversalPanelizer production packs (generate-production-files)
 * 6. Self-healing: auto-retry failed renders, enhanced prompt recovery,
 *    low-rating pattern detection, dev_agent_events logging
 */

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { VIEW_ORDER, VIEW_LABELS, type RenderJob } from "@/lib/bulk-prompt-generator";
import type { VisionBoardImage, VisionBoardIntent } from "@/lib/designiq-engine";

const DELAY_BETWEEN_MS = 3000;
const RATE_LIMIT_COOLDOWN_MS = 30000; // 30s cooldown after a rate-limit failure
const MAX_HEAL_ATTEMPTS = 2;
const RETRY_DELAY_MS = 3000;
const INVOKE_TIMEOUT_MS = 120_000; // 2 min max per render - prevents infinite hang
const SESSION_REFRESH_INTERVAL = 15; // refresh session every N renders

/** Wrap a promise with a timeout so batch never freezes */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

export function useBulkRenderQueue() {
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [running, setRunning] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [healingActive, setHealingActive] = useState(false);
  const abortRef = useRef(false);

  /* ---- helpers ---- */

  const patch = (id: string, fields: Partial<RenderJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...fields } : j)));

  const appendHealLog = (id: string, msg: string) =>
    setJobs((prev) =>
      prev.map((j) =>
        j.id === id ? { ...j, healLog: [...j.healLog, `[${new Date().toLocaleTimeString()}] ${msg}`] } : j,
      ),
    );

  /* ---- get session helper with retry ---- */

  const getSession = async () => {
    for (let i = 0; i < 3; i++) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.email) return session;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  };

  /** Refresh the Supabase session to prevent token expiration during long batches */
  const refreshSession = async (): Promise<string | null> => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.warn("[BulkRenderQueue] Session refresh failed, trying getSession:", error.message);
        const session = await getSession();
        return session?.user?.email || null;
      }
      return data.session?.user?.email || null;
    } catch (err) {
      console.warn("[BulkRenderQueue] Session refresh error:", err);
      const session = await getSession();
      return session?.user?.email || null;
    }
  };

  /* ---- persist star rating to Supabase ---- */

  const rateJob = useCallback(async (id: string, rating: number) => {
    patch(id, { rating });

    const job = jobs.find((j) => j.id === id) || null;
    const heroUrl = job?.renderUrl || "";
    if (!heroUrl) return;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let dnaId: string | null = null;

      const { data: existing } = await supabase
        .from("neuralnetwork_design_dna" as any)
        .select("id")
        .eq("vehicle_render_url", heroUrl)
        .maybeSingle();

      if ((existing as any)?.id) {
        dnaId = (existing as any).id;
      } else {
        const { data: created } = await supabase
          .from("neuralnetwork_design_dna" as any)
          .insert({
            creator_id: user.id,
            vehicle_year: job?.vehicle.year || null,
            vehicle_make: job?.vehicle.make || null,
            vehicle_model: job?.vehicle.model || null,
            vehicle_render_url: heroUrl,
            mode: job?.prompt.category || "restyle",
            source: "bulk_test",
          } as any)
          .select("id")
          .single();
        dnaId = (created as any)?.id || null;
      }

      if (!dnaId) return;

      // Upsert feedback
      const { data: existingFb } = await supabase
        .from("neuralnetwork_feedback" as any)
        .select("id")
        .eq("design_dna_id", dnaId)
        .eq("user_id", user.id)
        .maybeSingle();

      if ((existingFb as any)?.id) {
        await supabase
          .from("neuralnetwork_feedback" as any)
          .update({ rating, feedback_type: "admin" } as any)
          .eq("id", (existingFb as any).id);
      } else {
        await supabase.from("neuralnetwork_feedback" as any).insert({
          design_dna_id: dnaId,
          user_id: user.id,
          rating,
          feedback_type: "admin",
        } as any);
      }

      // If low rating (<=2), log to dev_agent_events for pattern detection
      if (rating <= 2) {
        await supabase.from("dev_agent_events" as any).insert({
          event_type: "low_rating_pattern",
          severity: "warning",
          payload: {
            job_id: id,
            rating,
            vehicle: `${job?.vehicle.year} ${job?.vehicle.make} ${job?.vehicle.model}`,
            prompt_category: job?.prompt.category,
            prompt_snippet: job?.prompt.prompt?.slice(0, 120),
            render_url: heroUrl,
            source: "bulk_admin_tool",
          },
        } as any);
      }
    } catch {
      /* non-blocking */
    }
  }, [jobs]);

  /* ---- execute one job with retry support ---- */

  const runOne = async (
    job: RenderJob,
    visionBoardImages?: VisionBoardImage[],
    visionBoardIntent?: VisionBoardIntent,
    attempt = 1,
  ): Promise<Partial<RenderJob>> => {
    const t0 = Date.now();
    try {
      const session = await getSession();
      const email = session?.user?.email;
      if (!email) throw new Error("Not logged in");

      const body: Record<string, unknown> = {
        mode: job.prompt.category,
        prompt: job.prompt.prompt,
        finish: job.finish,
        vehicleYear: job.vehicle.year,
        vehicleMake: job.vehicle.make,
        vehicleModel: job.vehicle.model,
      };

      if (visionBoardImages?.length) {
        body.visionBoardImages = visionBoardImages;
        body.visionboard_intent = visionBoardIntent || "style_inspiration";
      }

      const { data, error } = await withTimeout(
        supabase.functions.invoke("design-panel-ai-generate", { body }),
        INVOKE_TIMEOUT_MS,
        "design-panel-ai-generate",
      );

      if (error) {
        const detail = data?.message || data?.error || error.message;
        throw new Error(detail || "Generation failed");
      }

      const renderUrl = data?.renderUrl || data?.panel?.media_url || null;
      if (!renderUrl) throw new Error("No image returned");

      // Log to render_usage (non-blocking)
      supabase.from("render_usage").insert({
        user_id: session?.user?.id,
        email,
        tier: "admin",
        render_type: "designpro",
        billing_cycle_start: new Date().toISOString(),
      }).then(() => {});

      return {
        status: "done",
        renderUrl,
        panelUrl: data?.panel?.media_url || null,
        generationId: data?.generationId || null,
        durationMs: Date.now() - t0,
      };
    } catch (err: any) {
      return {
        status: "failed",
        error: err.message || String(err),
        durationMs: Date.now() - t0,
      };
    }
  };

  /* ================================================================ */
  /* SELF-HEALING LAYER                                                */
  /* ================================================================ */

  /** Auto-retry a failed job with exponential backoff + enhanced prompt */
  const healJob = async (
    job: RenderJob,
    visionBoardImages?: VisionBoardImage[],
    visionBoardIntent?: VisionBoardIntent,
  ): Promise<Partial<RenderJob>> => {
    const attempt = job.healAttempts + 1;

    appendHealLog(job.id, `Heal attempt ${attempt}/${MAX_HEAL_ATTEMPTS} - analyzing failure: ${job.error}`);
    patch(job.id, {
      healAttempts: attempt,
      healStatus: "retrying",
      status: "running",
      error: null,
    });

    // Wait with exponential backoff
    const waitMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
    appendHealLog(job.id, `Waiting ${waitMs / 1000}s before retry...`);
    await new Promise((r) => setTimeout(r, waitMs));

    // Build enhanced prompt with healing hints
    const healedPrompt = buildHealedPrompt(job);
    const healedJob: RenderJob = {
      ...job,
      prompt: { ...job.prompt, prompt: healedPrompt },
    };

    appendHealLog(job.id, "Re-rendering with enhanced prompt...");

    const result = await runOne(healedJob, visionBoardImages, visionBoardIntent, attempt);

    if (result.status === "done") {
      appendHealLog(job.id, `Healed successfully on attempt ${attempt}!`);

      // Log success to dev_agent_events
      logAgentEvent("system_health", "info", {
        action: "self_heal_success",
        job_id: job.id,
        attempt,
        original_error: job.error,
        vehicle: `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`,
      });

      return {
        ...result,
        healStatus: "healed" as const,
        healAttempts: attempt,
        version: job.version + 1,
      };
    }

    // Still failed
    if (attempt >= MAX_HEAL_ATTEMPTS) {
      appendHealLog(job.id, `Gave up after ${attempt} attempts. Flagging for manual review.`);

      // Log failure to dev_agent_events
      logAgentEvent("generation_failure", "critical", {
        action: "self_heal_gave_up",
        job_id: job.id,
        attempts: attempt,
        final_error: result.error,
        vehicle: `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`,
        prompt_category: job.prompt.category,
      });

      return {
        ...result,
        healStatus: "gave_up" as const,
        healAttempts: attempt,
      };
    }

    appendHealLog(job.id, `Attempt ${attempt} failed: ${result.error}`);
    return {
      ...result,
      healAttempts: attempt,
      healStatus: "retrying" as const,
    };
  };

  /** Build a healing-enhanced prompt based on the failure type */
  const buildHealedPrompt = (job: RenderJob): string => {
    const base = job.prompt.prompt;
    const err = (job.error || "").toLowerCase();

    // Rate limit / timeout → simplify prompt
    if (err.includes("rate") || err.includes("timeout") || err.includes("429")) {
      return `${base}\n\n[SIMPLIFIED: Keep design clean and minimal for faster generation]`;
    }
    // Content filter → soften language
    if (err.includes("safety") || err.includes("blocked") || err.includes("filter")) {
      return base
        .replace(/aggressive/gi, "bold")
        .replace(/killer/gi, "striking")
        .replace(/insane/gi, "impressive")
        .replace(/crazy/gi, "creative")
        + "\n\n[STYLE: Professional automotive wrap design, clean and tasteful]";
    }
    // Generic failure → add quality hints
    return `${base}\n\n[AUTO-REGEN-${job.healAttempts + 1}] Ensure high-quality, photorealistic vehicle wrap render with full vehicle visibility and professional finish.`;
  };

  /** Run self-healing sweep across all failed jobs */
  const runHealingSweep = useCallback(
    async (
      visionBoardImages?: VisionBoardImage[],
      visionBoardIntent?: VisionBoardIntent,
    ) => {
      setHealingActive(true);

      // Refresh session before healing sweep
      await refreshSession();

      const failedJobs = jobs.filter(
        (j) => j.status === "failed" && j.healAttempts < MAX_HEAL_ATTEMPTS,
      );

      for (const job of failedJobs) {
        if (abortRef.current) break;

        const result = await healJob(job, visionBoardImages, visionBoardIntent);
        patch(job.id, result);

        // If still failed and can retry, recurse
        if (result.status === "failed" && (result.healAttempts || 0) < MAX_HEAL_ATTEMPTS) {
          const updatedJob = { ...job, ...result } as RenderJob;
          const retry = await healJob(updatedJob, visionBoardImages, visionBoardIntent);
          patch(job.id, retry);
        }

      }

      setHealingActive(false);
    },
    [jobs],
  );

  /** Log low-rating patterns and trigger events */
  const detectLowRatingPatterns = useCallback(async () => {
    const ratedJobs = jobs.filter((j) => j.rating != null && j.rating <= 2);
    if (ratedJobs.length < 3) return;

    // Group by category
    const byCategory: Record<string, number> = {};
    for (const j of ratedJobs) {
      const cat = j.prompt.category;
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    }

    for (const [cat, count] of Object.entries(byCategory)) {
      if (count >= 3) {
        await logAgentEvent("quality_degradation", "warning", {
          action: "bulk_low_rating_pattern",
          category: cat,
          low_rated_count: count,
          total_jobs: jobs.length,
          avg_rating:
            ratedJobs
              .filter((j) => j.prompt.category === cat)
              .reduce((s, j) => s + (j.rating || 0), 0) / count,
          source: "bulk_admin_tool",
        });
      }
    }
  }, [jobs]);

  /* ---- helper: log to dev_agent_events (non-blocking) ---- */

  const logAgentEvent = async (
    eventType: string,
    severity: string,
    payload: Record<string, unknown>,
  ) => {
    try {
      await supabase.from("dev_agent_events" as any).insert({
        event_type: eventType,
        severity,
        payload,
      } as any);
    } catch {
      /* non-blocking */
    }
  };

  /* ================================================================ */
  /* REVISION                                                          */
  /* ================================================================ */

  const reviseJob = useCallback(
    async (
      id: string,
      revisedPrompt: string,
      visionBoardImages?: VisionBoardImage[],
      visionBoardIntent?: VisionBoardIntent,
    ) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id
            ? {
                ...j,
                status: "running" as const,
                renderUrl: null,
                error: null,
                rating: null,
                startedAt: Date.now(),
                durationMs: null,
                prompt: { ...j.prompt, prompt: revisedPrompt },
              }
            : j,
        ),
      );

      const job = jobs.find((j) => j.id === id);
      if (!job) return;

      const patched: RenderJob = { ...job, prompt: { ...job.prompt, prompt: revisedPrompt } };
      const result = await runOne(patched, visionBoardImages, visionBoardIntent);
      patch(id, result);
    },
    [jobs],
  );

  /* ================================================================ */
  /* MY VEHICLE PRO                                                    */
  /* ================================================================ */

  const testOnVehiclePhoto = useCallback(
    async (
      photoBase64: string,
      photoMimeType: string,
      designUrl: string,
      finish: string,
    ): Promise<{ renderUrl: string | null; error: string | null }> => {
      try {
        const session = await getSession();
        if (!session?.user?.email) throw new Error("Not logged in");

        const { data, error } = await withTimeout(
          supabase.functions.invoke("edit-vehicle-photo", {
            body: {
              userEmail: session.user.email,
              uploadedPhotoBase64: photoBase64,
              uploadedPhotoMimeType: photoMimeType,
              designOverlayUrl: designUrl,
              colorData: { finish, colorLibrary: "designpanelpro" },
            },
          }),
          INVOKE_TIMEOUT_MS,
          "edit-vehicle-photo",
        );

        if (error) throw new Error(data?.message || error.message);
        return { renderUrl: data?.renderUrl || null, error: null };
      } catch (err: any) {
        return { renderUrl: null, error: err.message };
      }
    },
    [],
  );

  /* ================================================================ */
  /* GENERATE VIEWS (sequential - 2s delays between views)             */
  /* ================================================================ */

  const generateViews = useCallback(
    async (id: string) => {
      const job = jobs.find((j) => j.id === id);
      if (!job || !job.renderUrl) return;

      patch(id, { viewsStatus: "running", viewsProgress: 0 });

      // Refresh session before starting view generation to avoid mid-batch expiry
      const refreshedEmail = await refreshSession();
      const email = refreshedEmail || (await getSession())?.user?.email;
      if (!email) {
        patch(id, { viewsStatus: "partial" });
        return;
      }

      const newViews: Record<string, string> = {};
      let completed = 0;

      // Pass hero render as a reference image so Gemini renders the SAME design from each angle.
      // Without this, each view generates a completely independent design.
      const heroReference = job.renderUrl
        ? [{ slotLabel: "Hero Render (approved design)", storageUrl: job.renderUrl }]
        : [];

      for (const viewType of VIEW_ORDER) {
        let viewUrl: string | null = null;

        // Try up to 2 times per view
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            // Keep prompt SHORT - the edge function adds studio, camera angle, and reinforcement.
            // We only need to tell Gemini to match the reference image's design.
            const viewLabel = VIEW_LABELS[viewType] || viewType;
            const viewPrompt = `Replicate the EXACT wrap design from the reference image. Same design, same colors, same layout. ${viewLabel} angle.\n\n${job.prompt.prompt}`;

            const { data, error } = await withTimeout(
              supabase.functions.invoke("design-panel-ai-generate", {
                body: {
                  mode: job.prompt.category,
                  prompt: viewPrompt,
                  finish: job.finish,
                  vehicleYear: job.vehicle.year,
                  vehicleMake: job.vehicle.make,
                  vehicleModel: job.vehicle.model,
                  viewType,
                  visionBoardImages: heroReference,
                  visionboard_intent: "exact_reference",
                },
              }),
              INVOKE_TIMEOUT_MS,
              `design-panel-ai-generate (${viewType})`,
            );

            const url = data?.renderUrl || data?.panel?.media_url;
            if (!error && url) {
              viewUrl = url;
              break;
            }
          } catch {
            /* retry */
          }

          if (attempt < 2) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
          }
        }

        if (viewUrl) {
          newViews[viewType] = viewUrl;
        }

        completed++;
        patch(id, { views: { ...newViews }, viewsProgress: completed });

        if (completed < VIEW_ORDER.length) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      patch(id, {
        views: newViews,
        viewsStatus: Object.keys(newViews).length === VIEW_ORDER.length ? "done" : "partial",
      });
    },
    [jobs],
  );

  /* ================================================================ */
  /* PRODUCTION PACK (UniversalPanelizer)                              */
  /* ================================================================ */

  const generateProductionPack = useCallback(
    async (id: string) => {
      const job = jobs.find((j) => j.id === id);
      if (!job) return;

      // V4 pipeline: renderUrl (3D render) is the PRIMARY creative input
      const panelUrl = job.panelUrl || job.renderUrl;
      if (!panelUrl) {
        patch(id, { packStatus: "failed", packError: "No render image available" });
        return;
      }

      patch(id, { packStatus: "running", packError: null });

      try {
        // Build renderUrls map from views
        const renderUrls: Record<string, string> = {};
        for (const [key, url] of Object.entries(job.views)) {
          if (url) renderUrls[key] = url;
        }

        // V4: prefer side view render as primary input for master texture extraction
        const primaryRenderUrl = renderUrls.side || renderUrls["driver-side"] || job.renderUrl || panelUrl;

        const { data, error } = await withTimeout(
          supabase.functions.invoke("generate-production-files", {
            body: {
              generationId: job.generationId || job.id,
              renderUrl: primaryRenderUrl,
              panelUrl,
              renderUrls: Object.keys(renderUrls).length > 0 ? renderUrls : undefined,
              sideSize: "medium",
              addHood: true,
              addFrontBumper: false,
              addRearBumper: true,
              roofSize: "none",
              finish: job.finish,
              vehicleYear: job.vehicle.year,
              vehicleMake: job.vehicle.make,
              vehicleModel: job.vehicle.model,
              designName: job.prompt.prompt.slice(0, 60),
            },
          }),
          INVOKE_TIMEOUT_MS,
          "generate-production-files",
        );

        if (error) {
          const detail = data?.message || data?.error || error.message;
          throw new Error(detail || "Production pack failed");
        }

        const packUrl = data?.packUrl || null;
        if (!packUrl) throw new Error("No pack URL returned");

        patch(id, { packUrl, packStatus: "done", packError: null });

        // Log success
        logAgentEvent("system_health", "info", {
          action: "production_pack_generated",
          job_id: id,
          pack_url: packUrl,
          file_count: data?.fileCount || 0,
          vehicle: `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`,
        });
      } catch (err: any) {
        patch(id, {
          packStatus: "failed",
          packError: err.message || "Production pack generation failed",
        });

        logAgentEvent("generation_failure", "warning", {
          action: "production_pack_failed",
          job_id: id,
          error: err.message,
          vehicle: `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`,
        });
      }
    },
    [jobs],
  );

  /* ================================================================ */
  /* BATCH EXECUTION (with inline self-healing)                        */
  /* ================================================================ */

  const startBatch = useCallback(
    async (
      queue: RenderJob[],
      visionBoardImages?: VisionBoardImage[],
      visionBoardIntent?: VisionBoardIntent,
    ) => {
      setJobs(queue);
      setRunning(true);
      setCurrentIdx(0);
      abortRef.current = false;

      for (let i = 0; i < queue.length; i++) {
        if (abortRef.current) break;
        setCurrentIdx(i);

        // Periodic session refresh to prevent token expiration during long batches
        if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
          await refreshSession();
        }

        const job = queue[i];
        patch(job.id, { status: "running", startedAt: Date.now() });

        const result = await runOne(job, visionBoardImages, visionBoardIntent);
        patch(job.id, result);
        let lastJobError = result.error || '';

        // SELF-HEALING: if failed, auto-retry up to MAX_HEAL_ATTEMPTS
        if (result.status === "failed") {
          let currentJob = { ...job, ...result } as RenderJob;
          for (let h = 0; h < MAX_HEAL_ATTEMPTS; h++) {
            if (abortRef.current) break;

            appendHealLog(job.id, `Auto-heal attempt ${h + 1}: ${currentJob.error}`);
            patch(job.id, {
              healAttempts: h + 1,
              healStatus: "retrying",
              status: "running",
              error: null,
            });

            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * Math.pow(2, h)));

            const healedPrompt = buildHealedPrompt(currentJob);
            const healedJob = { ...currentJob, prompt: { ...currentJob.prompt, prompt: healedPrompt } };
            const healResult = await runOne(healedJob, visionBoardImages, visionBoardIntent, h + 2);

            if (healResult.status === "done") {
              appendHealLog(job.id, `Healed on attempt ${h + 1}!`);
              patch(job.id, {
                ...healResult,
                healStatus: "healed",
                healAttempts: h + 1,
                version: job.version + 1,
              });

              logAgentEvent("system_health", "info", {
                action: "inline_self_heal_success",
                job_id: job.id,
                attempt: h + 1,
                original_error: currentJob.error,
              });
              break;
            }

            currentJob = { ...currentJob, ...healResult, healAttempts: h + 1 } as RenderJob;
            lastJobError = healResult.error || lastJobError;
            patch(job.id, { ...healResult, healAttempts: h + 1 });

            if (h === MAX_HEAL_ATTEMPTS - 1) {
              appendHealLog(job.id, "All heal attempts exhausted. Flagging for review.");
              patch(job.id, { healStatus: "gave_up" });

              logAgentEvent("generation_failure", "critical", {
                action: "inline_self_heal_gave_up",
                job_id: job.id,
                attempts: MAX_HEAL_ATTEMPTS,
                final_error: healResult.error,
                vehicle: `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`,
              });
            }
          }
        }

        if (i < queue.length - 1 && !abortRef.current) {
          // If job failed with rate limit, add extra 30s cooldown so Gemini resets
          const errLower = (lastJobError || '').toLowerCase();
          const isRateLimited = errLower.includes('rate') || errLower.includes('429');
          const delay = isRateLimited ? RATE_LIMIT_COOLDOWN_MS : DELAY_BETWEEN_MS;
          if (isRateLimited) console.log(`[BulkRenderQueue] Rate limit detected - cooling down ${delay / 1000}s before next job`);
          await new Promise((r) => setTimeout(r, delay));
        }
      }

      setRunning(false);
    },
    [],
  );

  const stop = useCallback(() => {
    abortRef.current = true;
  }, []);

  /* ================================================================ */
  /* PUBLISH TO CREATORMARKET                                          */
  /* ================================================================ */

  /**
   * Insert a finished render job into marketplace_listings so it
   * shows up on /creatormarket. Admin-curated rows (no creator_id) are
   * already supported by the public browse query — see the comment in
   * CreatorMarket.tsx about "admin-curated rows that have no creator_id
   * still show up." We pass `featured_creator_name` so the card still
   * reads "Created by DesignProAI Team" instead of an empty label.
   *
   * Returns the inserted row id on success, or null on failure (toast
   * is shown by the caller — this hook stays UI-free).
   */
  const publishToCreatorMarket = useCallback(
    async (
      id: string,
      opts: {
        trade_category: string | null;
        featured_creator_name?: string;
        industry_title?: string;
        price?: number;
        status?: "listed" | "pending_review" | "draft";
      },
    ): Promise<{ id: string } | { error: string }> => {
      const job = jobs.find((j) => j.id === id);
      if (!job) return { error: "Job not found" };
      if (!job.renderUrl) return { error: "Hero render is empty" };

      // Collect every available view URL — the detail viewer reads
      // render_urls as either an array of {type,url} or a plain object,
      // so we use the object form (smaller payload for the browse query).
      const renderUrls: Record<string, string> = {};
      for (const [k, v] of Object.entries(job.views)) {
        if (typeof v === "string" && v) renderUrls[k] = v;
      }
      if (!renderUrls.hero && job.renderUrl) renderUrls.hero = job.renderUrl;

      const insertRow: Record<string, unknown> = {
        title: `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model} - ${job.prompt.name || job.prompt.subcategory}`,
        industry_title: opts.industry_title?.trim() || job.prompt.name || null,
        featured_creator_name: opts.featured_creator_name?.trim() || "DesignProAI Team",
        trade_category: opts.trade_category,
        // design_style flags branded / commercial templates on the UI.
        design_style: opts.trade_category ? "branded" : "commercial",
        price: opts.price ?? 350,
        thumbnail_url: job.renderUrl,
        panel_2d_url: job.panelUrl || null,
        render_urls: renderUrls,
        vehicle_year: String(job.vehicle.year || ""),
        vehicle_make: job.vehicle.make,
        vehicle_model: job.vehicle.model,
        production_pack_url: job.packUrl || null,
        offers_printed_wrap: false,
        is_hidden: false,
        status: opts.status || "listed",
        listed_at: (opts.status ?? "listed") === "listed" ? new Date().toISOString() : null,
      };

      try {
        const { data, error } = await (supabase as any)
          .from("marketplace_listings")
          .insert(insertRow)
          .select("id")
          .single();
        if (error) {
          logAgentEvent("generation_failure", "warning", {
            action: "creatormarket_publish_failed",
            job_id: id,
            error: error.message,
          });
          return { error: error.message };
        }
        logAgentEvent("system_health", "info", {
          action: "creatormarket_publish",
          job_id: id,
          listing_id: data?.id,
          trade_category: opts.trade_category,
          vehicle: `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`,
        });
        return { id: data?.id };
      } catch (err: any) {
        return { error: err.message || "Insert failed" };
      }
    },
    [jobs],
  );

  /* ---- stats ---- */

  const done = jobs.filter((j) => j.status === "done").length;
  const failed = jobs.filter((j) => j.status === "failed").length;
  const healed = jobs.filter((j) => j.healStatus === "healed").length;
  const packsReady = jobs.filter((j) => j.packStatus === "done").length;
  const avgTime = (() => {
    const finished = jobs.filter((j) => j.durationMs);
    if (!finished.length) return 0;
    return Math.round(
      finished.reduce((s, j) => s + j.durationMs!, 0) / finished.length / 1000,
    );
  })();

  return {
    jobs,
    running,
    currentIdx,
    healingActive,
    startBatch,
    stop,
    rateJob,
    reviseJob,
    generateViews,
    generateProductionPack,
    publishToCreatorMarket,
    testOnVehiclePhoto,
    runHealingSweep,
    detectLowRatingPatterns,
    done,
    failed,
    healed,
    packsReady,
    avgTime,
  };
}
