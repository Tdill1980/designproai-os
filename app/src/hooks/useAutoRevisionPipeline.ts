/**
 * useAutoRevisionPipeline
 *
 * Scans batch renders rated ≤2 stars, clones them, and auto-submits
 * revision renders through the same edge functions RevisionStudioIQ uses.
 *
 * Flow:
 * 1. Query neuralnetwork_feedback for low-rated designs (≤2 stars)
 * 2. Match back to color_visualizations to get render details
 * 3. Clone the record with version increment
 * 4. Re-render with improved prompt (original prompt + auto-fix instructions)
 * 5. Update cloned record with new render URL
 */

import { useState, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { recordVersionCommit } from "@/lib/revision-commits";

/* ================================================================ */
/* TYPES                                                             */
/* ================================================================ */

export interface RevisionJob {
  id: string;
  /** Original color_visualizations ID */
  sourceId: string;
  /** Cloned record ID */
  clonedId: string | null;
  designName: string;
  vehicle: { year: string; make: string; model: string };
  modeType: string;
  originalPrompt: string;
  revisionPrompt: string;
  originalRating: number;
  feedbackText: string | null;
  status: "queued" | "cloning" | "rendering" | "done" | "failed";
  newRenderUrl: string | null;
  error: string | null;
}

export interface AutoRevisionStats {
  total: number;
  done: number;
  failed: number;
  queued: number;
  rendering: number;
}

const REVISION_TIMEOUT_MS = 120_000;
const DELAY_BETWEEN_MS = 3000;

/** Wrap a promise with a timeout */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms),
    ),
  ]);
}

/** Build an auto-revision prompt from the original prompt + feedback */
function buildAutoRevisionPrompt(
  originalPrompt: string,
  feedbackText: string | null,
  rating: number,
): string {
  const issues: string[] = [];

  if (rating <= 1) {
    issues.push("Complete redesign needed - the previous render was rejected.");
    issues.push("Focus on photorealistic quality, professional $5K wrap design level.");
    issues.push("Ensure the vehicle looks real, not like a cheap 3D template.");
  } else if (rating <= 2) {
    issues.push("Quality improvement needed - the previous render scored poorly.");
    issues.push("Improve photorealism, ensure proper lighting and material finish.");
  }

  if (feedbackText?.trim()) {
    issues.push(`Specific feedback: ${feedbackText.trim()}`);
  }

  // Combine original prompt with revision instructions
  return [
    originalPrompt,
    "",
    "--- AUTO-REVISION INSTRUCTIONS ---",
    ...issues,
    "Maintain the same design concept but dramatically improve render quality.",
    "The vehicle must look like a real photograph, not a 3D mockup.",
    "Proper studio lighting, correct material finish, sharp detail.",
  ].join("\n");
}

/* ================================================================ */
/* HOOK                                                              */
/* ================================================================ */

export function useAutoRevisionPipeline() {
  const [jobs, setJobs] = useState<RevisionJob[]>([]);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<"idle" | "scanning" | "revising" | "complete">("idle");
  const abortRef = useRef(false);

  const patch = (id: string, fields: Partial<RevisionJob>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...fields } : j)));

  /* ================================================================ */
  /* SCAN FOR LOW-RATED BATCH RENDERS                                  */
  /* ================================================================ */

  const scanLowRated = useCallback(async (): Promise<RevisionJob[]> => {
    // Get all feedback records with low ratings
    const { data: lowFeedback, error: fbError } = await supabase
      .from("neuralnetwork_feedback" as any)
      .select("design_dna_id, rating, feedback_text")
      .lte("rating", 2);

    if (fbError || !lowFeedback || (lowFeedback as any[]).length === 0) {
      return [];
    }

    // Get the DNA records for these feedback entries
    const dnaIds = (lowFeedback as any[]).map((f: any) => f.design_dna_id).filter(Boolean);
    if (dnaIds.length === 0) return [];

    const { data: dnaRecords } = await supabase
      .from("neuralnetwork_design_dna" as any)
      .select("id, vehicle_render_url, vehicle_year, vehicle_make, vehicle_model, mode")
      .in("id", dnaIds);

    if (!dnaRecords || (dnaRecords as any[]).length === 0) return [];

    // Build a map of DNA ID → render URL for matching
    const dnaMap = new Map<string, any>();
    for (const dna of dnaRecords as any[]) {
      dnaMap.set(dna.id, dna);
    }

    // Get all render URLs from DNA records to match against color_visualizations
    const renderUrls = (dnaRecords as any[]).map((d: any) => d.vehicle_render_url).filter(Boolean);

    // Find matching color_visualizations (batch renders)
    const { data: vizRecords } = await supabase
      .from("color_visualizations")
      .select("*")
      .like("admin_notes", '%"batch":true%')
      .eq("generation_status", "completed");

    if (!vizRecords || vizRecords.length === 0) return [];

    // Match renders to their low feedback
    const revisionJobs: RevisionJob[] = [];
    let seq = 0;

    for (const fb of lowFeedback as any[]) {
      const dna = dnaMap.get(fb.design_dna_id);
      if (!dna) continue;

      // Find the color_visualization that matches this DNA record
      const matchingViz = vizRecords.find((v: any) => {
        const urls = v.render_urls as Record<string, string> | null;
        if (!urls) return false;
        return urls.hero === dna.vehicle_render_url ||
               urls.side === dna.vehicle_render_url;
      });

      if (!matchingViz) continue;

      // Check if this render was already auto-revised
      let adminNotes: any = {};
      try {
        adminNotes = JSON.parse(matchingViz.admin_notes || "{}");
      } catch {}

      if (adminNotes.auto_revised) continue;

      // Extract original prompt from admin_notes
      const originalPrompt = adminNotes.original_prompt || "";
      if (!originalPrompt) continue;

      revisionJobs.push({
        id: `rev_${Date.now()}_${++seq}`,
        sourceId: matchingViz.id,
        clonedId: null,
        designName: matchingViz.color_name || matchingViz.design_file_name || "Unknown",
        vehicle: {
          year: String(matchingViz.vehicle_year || "2024"),
          make: matchingViz.vehicle_make || "Unknown",
          model: matchingViz.vehicle_model || "Unknown",
        },
        modeType: matchingViz.mode_type || "designpanelpro",
        originalPrompt,
        revisionPrompt: buildAutoRevisionPrompt(originalPrompt, fb.feedback_text, fb.rating),
        originalRating: fb.rating,
        feedbackText: fb.feedback_text || null,
        status: "queued",
        newRenderUrl: null,
        error: null,
      });
    }

    return revisionJobs;
  }, []);

  /* ================================================================ */
  /* CLONE & REVISE ONE RENDER                                         */
  /* ================================================================ */

  const reviseOne = async (job: RevisionJob): Promise<Partial<RevisionJob>> => {
    try {
      // Step 1: Fetch the source record
      const { data: source, error: fetchError } = await supabase
        .from("color_visualizations")
        .select("*")
        .eq("id", job.sourceId)
        .single();

      if (fetchError || !source) {
        throw new Error("Source render not found");
      }

      // Step 2: Clone the record with version increment
      const baseName = (source.design_file_name || job.designName).replace(/\s*\(V\d+\)\s*$/, "");
      const existingVersion = (source.design_file_name || "").match(/\(V(\d+)\)/);
      const newVersion = existingVersion ? parseInt(existingVersion[1]) + 1 : 2;

      const versionMeta = {
        parent_id: job.sourceId,
        version: newVersion,
        auto_revised: true,
        auto_revision_reason: `Low rating (${job.originalRating}/5)`,
        auto_revision_date: new Date().toISOString(),
        original_prompt: job.originalPrompt,
        revision_prompt: job.revisionPrompt,
      };

      // Merge with existing batch metadata
      let existingNotes: any = {};
      try { existingNotes = JSON.parse(source.admin_notes || "{}"); } catch {}

      const mergedNotes = { ...existingNotes, ...versionMeta };

      const { data: cloned, error: cloneError } = await supabase
        .from("color_visualizations")
        .insert({
          customer_email: source.customer_email,
          vehicle_year: source.vehicle_year,
          vehicle_make: source.vehicle_make,
          vehicle_model: source.vehicle_model,
          color_hex: source.color_hex,
          color_name: source.color_name,
          finish_type: source.finish_type,
          mode_type: source.mode_type,
          render_urls: source.render_urls,
          design_file_name: `${baseName} (V${newVersion})`,
          generation_status: "completed",
          subscription_tier: source.subscription_tier,
          admin_notes: JSON.stringify(mergedNotes),
        } as any)
        .select()
        .single();

      if (cloneError || !cloned) {
        throw new Error(`Clone failed: ${cloneError?.message || "No data returned"}`);
      }

      const clonedId = (cloned as any).id;

      // Step 3: Re-render based on tool type
      let newRenderUrl: string | null = null;

      const isDesignPro = job.modeType === "designpanelpro" || job.modeType === "designpro";

      if (isDesignPro) {
        // BUG 1 FIX: Read mode from admin_notes, not prompt text
        let mode: "commercial" | "restyle" = "restyle";
        let commercial: Record<string, unknown> = {};
        try {
          const notes = JSON.parse(source.admin_notes || "{}");
          if (notes.designiq_mode === "commercial") {
            mode = "commercial";
            commercial = {
              companyName: notes.company_name,
              phone: notes.phone,
              mascot: notes.mascot,
              industryType: notes.industry_type,
              bulletPoints: notes.brand_keywords,
            };
          }
        } catch {}
        const { data: renderData, error: renderError } = await withTimeout(
          supabase.functions.invoke("design-panel-ai-generate", {
            body: {
              mode,
              prompt: job.revisionPrompt,
              finish: source.finish_type || "Gloss",
              vehicleYear: String(source.vehicle_year || "2024"),
              vehicleMake: source.vehicle_make,
              vehicleModel: source.vehicle_model,
              ...commercial,
            },
          }),
          REVISION_TIMEOUT_MS,
          `Auto-revision ${job.designName}`,
        );

        if (renderError) {
          let detail = renderData?.message || renderData?.error;
          if (!detail && (renderError as any).context) {
            try { const b = await (renderError as any).context.json(); detail = b?.message || b?.error; } catch {}
          }
          throw new Error(detail || renderError.message);
        }

        newRenderUrl = renderData?.renderUrl || renderData?.panel?.media_url || null;
      } else {
        // ColorPro, FadeWraps, WBTY, ApprovePro
        const session = await supabase.auth.getSession();
        const email = session.data.session?.user?.email || source.customer_email || "";

        const { data: renderData, error: renderError } = await withTimeout(
          supabase.functions.invoke("generate-color-render", {
            body: {
              vehicleYear: String(source.vehicle_year || "2024"),
              vehicleMake: source.vehicle_make,
              vehicleModel: source.vehicle_model,
              modeType: job.modeType,
              viewType: "side",
              userEmail: email,
              customStylingPrompt: job.revisionPrompt,
              colorData: {
                colorName: source.color_name || job.designName,
                hex: source.color_hex || "#000000",
                finish: source.finish_type || "Gloss",
              },
            },
          }),
          REVISION_TIMEOUT_MS,
          `Auto-revision ${job.designName}`,
        );

        if (renderError) {
          let detail = renderData?.message || renderData?.error;
          if (!detail && (renderError as any).context) {
            try { const b = await (renderError as any).context.json(); detail = b?.message || b?.error; } catch {}
          }
          throw new Error(detail || renderError.message);
        }

        newRenderUrl = renderData?.renderUrl || null;
      }

      if (!newRenderUrl) {
        throw new Error("No render URL returned from edge function");
      }

      // Step 4: Update cloned record with new render
      const existingUrls = ((cloned as any).render_urls || {}) as Record<string, string>;
      const updatedUrls = { ...existingUrls, hero: newRenderUrl, side: newRenderUrl };

      await supabase
        .from("color_visualizations")
        .update({
          render_urls: updatedUrls as Json,
          admin_notes: JSON.stringify({
            ...mergedNotes,
            revised: true,
            revision_render_date: new Date().toISOString(),
          }),
        } as any)
        .eq("id", clonedId);

      // Revision Studio: append an auto-revision commit to the shared timeline,
      // keyed by the lineage's DesignIQ generation id (carried in admin_notes) so
      // it joins the same v1/v2/v3 history. Fire-and-forget.
      {
        const { data: { user: revUser } } = await supabase.auth.getUser();
        const commitJobId = existingNotes.designiq_generation_id || job.sourceId;
        recordVersionCommit({
          jobId: commitJobId,
          userId: revUser?.id ?? null,
          userPrompt: job.revisionPrompt || null,
          heroRenderUrl: newRenderUrl,
          changeType: "revision",
        }).catch(() => {});
      }

      // Step 5: Mark original as auto-revised (so it doesn't get picked up again)
      await supabase
        .from("color_visualizations")
        .update({
          admin_notes: JSON.stringify({ ...existingNotes, auto_revised: true }),
        } as any)
        .eq("id", job.sourceId);

      return {
        status: "done",
        clonedId,
        newRenderUrl,
      };
    } catch (err) {
      return {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };

  /* ================================================================ */
  /* MAIN PIPELINE EXECUTION                                           */
  /* ================================================================ */

  const startAutoRevision = useCallback(async () => {
    setRunning(true);
    setPhase("scanning");
    abortRef.current = false;

    // Phase 1: Scan for low-rated renders
    const revisionJobs = await scanLowRated();

    if (revisionJobs.length === 0) {
      setPhase("complete");
      setRunning(false);
      return { revised: 0, message: "No low-rated batch renders found to revise." };
    }

    setJobs(revisionJobs);
    setPhase("revising");

    // Phase 2: Process each revision
    for (let i = 0; i < revisionJobs.length; i++) {
      if (abortRef.current) break;

      const job = revisionJobs[i];
      patch(job.id, { status: "cloning" });

      // Brief delay before rendering
      await new Promise((r) => setTimeout(r, 500));
      patch(job.id, { status: "rendering" });

      const result = await reviseOne(job);
      patch(job.id, result);

      // Update local array for tracking
      revisionJobs[i] = { ...revisionJobs[i], ...result } as RevisionJob;

      if (i < revisionJobs.length - 1 && !abortRef.current) {
        await new Promise((r) => setTimeout(r, DELAY_BETWEEN_MS));
      }
    }

    setPhase("complete");
    setRunning(false);

    const doneCount = revisionJobs.filter((j) => j.status === "done").length;
    return { revised: doneCount, message: `Auto-revised ${doneCount} of ${revisionJobs.length} low-rated renders.` };
  }, [scanLowRated]);

  const stopAutoRevision = useCallback(() => {
    abortRef.current = true;
  }, []);

  /* ---- stats ---- */
  const stats: AutoRevisionStats = {
    total: jobs.length,
    done: jobs.filter((j) => j.status === "done").length,
    failed: jobs.filter((j) => j.status === "failed").length,
    queued: jobs.filter((j) => j.status === "queued").length,
    rendering: jobs.filter((j) => j.status === "rendering" || j.status === "cloning").length,
  };

  return {
    jobs,
    running,
    phase,
    stats,
    startAutoRevision,
    stopAutoRevision,
  };
}
