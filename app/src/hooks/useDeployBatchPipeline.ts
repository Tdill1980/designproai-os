/**
 * useDeployBatchPipeline
 *
 * Deploys past batch-rendered designs onto real vehicle photos
 * via the edit-vehicle-photo edge function (MyVehiclePro).
 *
 * Each job = 1 source design x 1 vehicle photo = 1 edit.
 * No views or proofs needed - the edit itself is the final output.
 */

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import type { Json } from "@/integrations/supabase/types";
import type { StockVehiclePhoto } from "@/data/stock-vehicle-photos";

/* ================================================================ */
/* CONSTANTS                                                         */
/* ================================================================ */

const DELAY_BETWEEN_MS = 3_000;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 4_000;
const SESSION_REFRESH_INTERVAL = 10;
const INVOKE_TIMEOUT_MS = 180_000; // edits can take longer than renders

/* ================================================================ */
/* TYPES                                                             */
/* ================================================================ */

export interface DeploySourceDesign {
  id: string;
  colorName: string;
  colorHex: string;
  finishType: string;
  modeType: string;
  toolSource: string;
  panelUrl: string | null;
  designName: string | null;
  renderUrl: string | null;
  originalPrompt: string | null;
  vehicleYear: string;
  vehicleMake: string;
  vehicleModel: string;
}

export interface DeployJob {
  id: string;
  sourceId: string;
  source: DeploySourceDesign;
  vehiclePhoto: StockVehiclePhoto;
  status: "queued" | "rendering" | "done" | "failed";
  renderUrl: string | null;
  error: string | null;
  startedAt: number | null;
  durationMs: number | null;
}

export interface DeployBatchConfig {
  designIds: string[];
  vehiclePhotos: StockVehiclePhoto[];
  concurrencyLimit?: number;
}

/* ================================================================ */
/* HELPERS                                                           */
/* ================================================================ */

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms,
      ),
    ),
  ]);
}

let _seq = 0;

/* ================================================================ */
/* HOOK                                                              */
/* ================================================================ */

export function useDeployBatchPipeline() {
  const [jobs, setJobs] = useState<DeployJob[]>([]);
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [phase, setPhase] = useState<"idle" | "rendering" | "complete">(
    "idle",
  );
  const [batchId, setBatchId] = useState<string | null>(null);
  const [sourceDesigns, setSourceDesigns] = useState<DeploySourceDesign[]>([]);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);

  /* ---- state helpers ---- */

  const patch = (id: string, fields: Partial<DeployJob>) =>
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
  /* FETCH SOURCE DESIGNS                                              */
  /* ================================================================ */

  const fetchSourceDesigns = useCallback(
    async (designIds: string[]): Promise<DeploySourceDesign[]> => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select(
          "id, color_name, color_hex, finish_type, mode_type, render_urls, admin_notes, vehicle_year, vehicle_make, vehicle_model, design_file_name, custom_design_url",
        )
        .in("id", designIds);

      if (error || !data) return [];

      return data.map((row: any) => {
        let adminNotes: any = {};
        try {
          adminNotes =
            typeof row.admin_notes === "string"
              ? JSON.parse(row.admin_notes)
              : row.admin_notes || {};
        } catch {}

        const renderUrls =
          (typeof row.render_urls === "string"
            ? JSON.parse(row.render_urls)
            : row.render_urls) || {};
        const heroUrl =
          renderUrls.side ||
          renderUrls.hero ||
          renderUrls.front ||
          Object.values(renderUrls)[0] ||
          null;

        const modeType = row.mode_type || "";
        const toolSource = modeType.includes("design")
          ? "DesignPanelPro"
          : modeType.includes("fade")
            ? "FadeWraps"
            : modeType.includes("graphic")
              ? "GraphicsPro"
              : modeType.includes("restyle")
                ? "DesignPanelPro"
                : "ColorPro";

        const panelUrl =
          adminNotes.panel_url ||
          renderUrls.panel ||
          row.custom_design_url ||
          null;

        return {
          id: row.id,
          colorName: row.color_name || "Design",
          colorHex: row.color_hex || "#808080",
          finishType: row.finish_type || "Gloss",
          modeType,
          toolSource,
          panelUrl,
          designName: row.design_file_name || row.color_name || "Design",
          renderUrl: (heroUrl as string) || null,
          originalPrompt: adminNotes.original_prompt || null,
          vehicleYear: String(row.vehicle_year || "2024"),
          vehicleMake: row.vehicle_make || "",
          vehicleModel: row.vehicle_model || "",
        };
      });
    },
    [],
  );

  /* ================================================================ */
  /* DEPLOY ONE JOB (call edit-vehicle-photo)                          */
  /* ================================================================ */

  const deployOne = async (
    job: DeployJob,
    email: string,
  ): Promise<Partial<DeployJob>> => {
    const t0 = Date.now();

    try {
      const colorData: Record<string, any> = {
        colorName: job.source.colorName,
        hex: job.source.colorHex,
        finish: job.source.finishType.toLowerCase(),
        manufacturer: "",
        colorLibrary: job.source.modeType || "colorpro",
        toolSource: job.source.toolSource,
      };

      if (job.source.panelUrl) {
        colorData.panelUrl = job.source.panelUrl;
        colorData.panelName =
          job.source.designName || job.source.colorName || "Design";
      }

      const { data, error } = await withTimeout(
        renderClient.functions.invoke("edit-vehicle-photo", {
          body: {
            userEmail: email,
            uploadedPhotoUrl: job.vehiclePhoto.url,
            colorData,
            vehicleInfo: {
              make: job.vehiclePhoto.make,
              model: job.vehiclePhoto.model,
              year: job.vehiclePhoto.year,
            },
          },
        }),
        INVOKE_TIMEOUT_MS,
        `Deploy ${job.source.colorName} -> ${job.vehiclePhoto.label}`,
      );

      if (error) {
        let detail = (data as any)?.message || (data as any)?.error;
        if (!detail && (error as any).context) {
          try {
            const b = await (error as any).context.json();
            detail = b?.message || b?.error || JSON.stringify(b);
          } catch {}
        }
        throw new Error(detail || error.message);
      }

      const renderUrl = (data as any)?.renderUrl || null;
      if (!renderUrl)
        throw new Error("No image returned from edit-vehicle-photo");

      return {
        status: "done",
        renderUrl,
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
  /* PERSIST DEPLOY RESULT                                             */
  /* ================================================================ */

  const persistDeploy = async (
    job: DeployJob,
    currentBatchId: string,
    email: string,
  ): Promise<string | null> => {
    try {
      const renderUrls: Record<string, string> = {};
      if (job.renderUrl) renderUrls.side = job.renderUrl;

      const adminNotes = JSON.stringify({
        batch: true,
        batch_id: currentBatchId,
        tool: "myvehicle_deploy",
        source_design_id: job.sourceId,
        source_design_name: job.source.designName,
        vehicle_photo_url: job.vehiclePhoto.url,
        vehicle_photo_label: job.vehiclePhoto.label,
        duration_ms: job.durationMs,
        deploy_pipeline: true,
      });

      const { data } = await supabase
        .from("color_visualizations")
        .insert({
          customer_email: email,
          vehicle_year: parseInt(job.vehiclePhoto.year) || 2024,
          vehicle_make: job.vehiclePhoto.make,
          vehicle_model: job.vehiclePhoto.model,
          color_name: job.source.colorName,
          color_hex: job.source.colorHex,
          finish_type: job.source.finishType,
          mode_type: "myvehicle_deploy",
          render_urls: renderUrls as Json,
          admin_notes: adminNotes,
          design_file_name: `${job.source.colorName} on ${job.vehiclePhoto.make} ${job.vehiclePhoto.model} [Deploy ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}]`,
          generation_status: "completed",
          subscription_tier: "admin",
          source_photo_url: job.vehiclePhoto.url,
        })
        .select("id")
        .single();

      return data?.id || null;
    } catch (err) {
      console.error("[DeployPipeline] Failed to persist:", err);
      return null;
    }
  };

  /* ================================================================ */
  /* FETCH AVAILABLE DESIGNS (for selection UI)                        */
  /* ================================================================ */

  const fetchAvailableDesigns = useCallback(
    async (): Promise<DeploySourceDesign[]> => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select(
          "id, color_name, color_hex, finish_type, mode_type, render_urls, admin_notes, vehicle_year, vehicle_make, vehicle_model, design_file_name, custom_design_url, created_at",
        )
        .like("admin_notes", '%"batch":true%')
        .eq("generation_status", "completed")
        .order("created_at", { ascending: false })
        .limit(200);

      if (error || !data) return [];

      const designs: DeploySourceDesign[] = [];
      for (const row of data) {
        let adminNotes: any = {};
        try {
          adminNotes =
            typeof row.admin_notes === "string"
              ? JSON.parse(row.admin_notes)
              : row.admin_notes || {};
        } catch {
          continue;
        }

        if (!adminNotes.batch) continue;

        const renderUrls =
          (typeof row.render_urls === "string"
            ? JSON.parse(row.render_urls)
            : row.render_urls) || {};
        const heroUrl =
          renderUrls.side ||
          renderUrls.hero ||
          renderUrls.front ||
          Object.values(renderUrls)[0] ||
          null;
        if (!heroUrl) continue;

        const modeType = row.mode_type || "";
        const toolSource = modeType.includes("design")
          ? "DesignPanelPro"
          : modeType.includes("fade")
            ? "FadeWraps"
            : modeType.includes("graphic")
              ? "GraphicsPro"
              : modeType.includes("restyle")
                ? "DesignPanelPro"
                : "ColorPro";

        const panelUrl =
          adminNotes.panel_url ||
          renderUrls.panel ||
          row.custom_design_url ||
          null;

        designs.push({
          id: row.id,
          colorName: row.color_name || "Design",
          colorHex: row.color_hex || "#808080",
          finishType: row.finish_type || "Gloss",
          modeType,
          toolSource,
          panelUrl,
          designName: row.design_file_name || row.color_name || "Design",
          renderUrl: heroUrl as string,
          originalPrompt: adminNotes.original_prompt || null,
          vehicleYear: String(row.vehicle_year || "2024"),
          vehicleMake: row.vehicle_make || "",
          vehicleModel: row.vehicle_model || "",
        });
      }

      return designs;
    },
    [],
  );

  /* ================================================================ */
  /* MAIN PIPELINE                                                     */
  /* ================================================================ */

  const startPipeline = useCallback(
    async (config: DeployBatchConfig) => {
      const {
        designIds,
        vehiclePhotos,
        concurrencyLimit: concurrency = 2,
      } = config;
      const currentBatchId = `batch_deploy_${Date.now()}`;
      setBatchId(currentBatchId);

      // Fetch full design data
      const designs = await fetchSourceDesigns(designIds);
      if (designs.length === 0) {
        console.error("[DeployPipeline] No valid designs found");
        return;
      }
      setSourceDesigns(designs);

      // Build cross-product: design x photo
      const queue: DeployJob[] = [];
      for (const design of designs) {
        for (const photo of vehiclePhotos) {
          queue.push({
            id: `dj_${Date.now()}_${++_seq}`,
            sourceId: design.id,
            source: design,
            vehiclePhoto: photo,
            status: "queued",
            renderUrl: null,
            error: null,
            startedAt: null,
            durationMs: null,
          });
        }
      }

      setJobs(queue);
      setRunning(true);
      setPaused(false);
      setPhase("rendering");
      setCurrentIdx(0);
      abortRef.current = false;
      pauseRef.current = false;

      // Force-refresh the session BEFORE starting - prevents "Invalid JWT" errors
      const freshEmail = await refreshSession();
      let email = freshEmail;
      if (!email) {
        const session = await getSession();
        email = session?.user?.email || null;
      }
      if (!email) {
        setRunning(false);
        setPhase("idle");
        return;
      }

      /* ---- Process all jobs ---- */

      const processJob = async (
        i: number,
        currentEmail: { value: string },
      ) => {
        const job = queue[i];

        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? {
                  ...j,
                  status: "rendering" as const,
                  startedAt: Date.now(),
                }
              : j,
          ),
        );

        let result = await deployOne(job, currentEmail.value);

        // Retry with exponential backoff
        for (
          let attempt = 1;
          attempt < MAX_RETRIES && result.status === "failed";
          attempt++
        ) {
          if (abortRef.current) break;
          const backoffMs = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, backoffMs));
          result = await deployOne(job, currentEmail.value);
        }

        queue[i] = { ...queue[i], ...result } as DeployJob;
        patch(job.id, result);

        // Persist successful deploys immediately
        if (result.status === "done" && result.renderUrl) {
          const updatedJob = { ...queue[i], ...result } as DeployJob;
          await persistDeploy(updatedJob, currentBatchId, currentEmail.value);
        }
      };

      const emailRef = { value: email };

      if (concurrency <= 1) {
        for (let i = 0; i < queue.length; i++) {
          if (abortRef.current) break;
          const canContinue = await waitWhilePaused();
          if (!canContinue) break;

          setCurrentIdx(i);

          if (i > 0 && i % SESSION_REFRESH_INTERVAL === 0) {
            const refreshedEmail = await refreshSession();
            if (refreshedEmail) emailRef.value = refreshedEmail;
          }

          await processJob(i, emailRef);

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
            if (refreshedEmail) emailRef.value = refreshedEmail;
          }

          setCurrentIdx(batchStart);

          const batchEnd = Math.min(batchStart + concurrency, queue.length);
          const batchPromises: Promise<void>[] = [];

          for (let i = batchStart; i < batchEnd; i++) {
            batchPromises.push(processJob(i, emailRef));
          }

          await Promise.all(batchPromises);

          if (batchEnd < queue.length && !abortRef.current) {
            await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
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

  /* ---- Stats ---- */

  const stats = {
    total: jobs.length,
    done: jobs.filter((j) => j.status === "done").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    rendering: jobs.filter((j) => j.status === "rendering").length,
    uniqueDesigns: new Set(jobs.map((j) => j.sourceId)).size,
    uniquePhotos: new Set(jobs.map((j) => j.vehiclePhoto.id)).size,
  };

  return {
    jobs,
    running,
    paused,
    currentIdx,
    phase,
    stats,
    batchId,
    sourceDesigns,
    startPipeline,
    stop,
    pause,
    resume,
    fetchAvailableDesigns,
  };
}
