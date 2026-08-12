/**
 * videoFanOutRun — the I/O half of the per-video fan-out.
 *
 * `videoFanOut.ts` decides WHAT one finished cut becomes; this makes it. Kept
 * apart so the plan stays unit-testable without a database (importing the
 * Supabase client needs `localStorage`, which node does not have — the same
 * split as `shotEditType.ts` and `kickMessages.ts`).
 *
 * ── WHAT IT ACTUALLY DOES ──────────────────────────────────────────────────
 * One finished render →
 *   a NARRATIVE (the topic, once, idempotent by brand + title)
 *   + the source cut adopted as its own artifact
 *   + longform / reel / Short / Canva graphic, each a real artifact
 *
 * Reuse pieces point at the SAME render job — no second render, no second file,
 * no cost. Only a genuine shape change enqueues `video-render`, and the plan
 * says how many of those there are before the button is pressed.
 *
 * ── IT NEVER PUBLISHES AND NEVER SCHEDULES ─────────────────────────────────
 * Every row it touches lands in a review state. A machine may draft; only a
 * human may send. Same rule `narrativeService` follows, and the reason the
 * Canva graphic is written as a DRAFT social post rather than a scheduled one.
 *
 * Locked by `tests/video-fan-out.test.ts`.
 */

import { supabase } from "@/integrations/supabase/client";
import { findOrCreateNarrative, attachArtifact } from "./narrativeService";
import { buildReformatBlueprint } from "./wraptvPublish";
import {
  canonicalCanvaBrandBoardBrand,
  createCanvaBrandBoardDraft,
  requestCanvaBrandBoardDesign,
} from "./canvaBrandBoard";
import {
  planVideoDeliverables,
  renderCost,
  type PlannedPiece,
  type SourceCut,
} from "./videoFanOut";

const db = supabase as any;

export interface FanOutVideoResult {
  narrativeId: string | null;
  /** Pieces that became real artifacts, with how each was produced. */
  made: Array<{ key: string; method: string; artifactKind: string; targetId: string | null }>;
  /** Pieces that could not be made, each with the reason from the plan. */
  blocked: Array<{ key: string; reason: string }>;
  /** New render jobs actually enqueued — the honest cost of this press. */
  rendersQueued: number;
  /** Anything that failed mid-way. Never thrown away silently. */
  errors: string[];
}

/** Read what the cut really is, from the job row rather than from the caller. */
export function cutFromJob(job: Record<string, any> | null | undefined): SourceCut {
  const bp = (job?.blueprint || {}) as Record<string, any>;
  const scenes = Array.isArray(bp.scenes) ? bp.scenes : [];
  // totalDuration is what the blueprint asked for; the scene spans are what it
  // actually cut. Prefer the blueprint, fall back to the sum, because a stated
  // 0 (stills) must not read as "unknown length" and unblock a Short check.
  const stated = Number(bp.totalDuration);
  const summed = scenes.reduce((t: number, s: any) => t + Math.max(0, Number(s?.end) - Number(s?.start) || 0), 0);
  return {
    aspectRatio: bp.aspectRatio || null,
    durationSeconds: Number.isFinite(stated) && stated > 0 ? stated : summed || null,
    title: bp.title || job?.source_ref || null,
    brand: job?.brand || null,
    finalUrl: job?.final_url || null,
    posterUrl: job?.thumbnail_url || null,
  };
}

/** Does this exact Canva brand have an image template mapped? */
async function canvaMappedFor(rawBrand: string): Promise<boolean> {
  const brand = canonicalCanvaBrandBoardBrand(rawBrand);
  if (!brand) return false;
  try {
    const { data, error } = await supabase.functions.invoke("canva-brandboard", {
      body: { action: "config" },
    });
    if (error || data?.ok !== true) return false;
    return (data.maps || []).some((row: Record<string, unknown>) =>
      canonicalCanvaBrandBoardBrand(row.brand) === brand && !!row.template_id
    );
  } catch {
    return false;
  }
}

/**
 * Plan the fan-out for a finished render, without making anything.
 *
 * The board calls this to render the confirm dialog, so the human sees the
 * render count and the crop warnings BEFORE pressing.
 */
export async function planFanOutForJob(jobId: string): Promise<{
  cut: SourceCut;
  pieces: PlannedPiece[];
  renderCost: number;
  error?: string;
}> {
  const { data: job, error } = await db
    .from("video_render_jobs")
    .select("id, brand, source_ref, blueprint, final_url, thumbnail_url, status")
    .eq("id", jobId)
    .maybeSingle();
  if (error || !job) {
    return { cut: {}, pieces: [], renderCost: 0, error: error?.message || "That render could not be found." };
  }
  const cut = cutFromJob(job);
  const canvaMapped = await canvaMappedFor(String(job.brand || ""));
  const pieces = planVideoDeliverables(cut, { canvaMapped });
  return { cut, pieces, renderCost: renderCost(pieces) };
}

/**
 * Make the pieces.
 *
 * `only` limits the run to specific keys — the dialog lets a human uncheck the
 * expensive reformat and still take the free ones, which is the difference
 * between a fan-out and a bill.
 */
export async function fanOutFinishedVideo(
  jobId: string,
  opts: { only?: string[]; producedBy?: string } = {},
): Promise<FanOutVideoResult> {
  const result: FanOutVideoResult = { narrativeId: null, made: [], blocked: [], rendersQueued: 0, errors: [] };

  const { data: job, error: jobErr } = await db
    .from("video_render_jobs")
    .select("id, brand, source_ref, blueprint, final_url, thumbnail_url, status")
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr || !job) {
    result.errors.push(jobErr?.message || "That render could not be found.");
    return result;
  }

  const cut = cutFromJob(job);
  const brand = String(job.brand || "").trim();
  const topic = String(cut.title || "").trim();
  if (!topic) {
    result.errors.push("This cut has no title — a narrative needs a topic, and inventing one would bury it.");
    return result;
  }

  const canvaMapped = await canvaMappedFor(brand);
  const wanted = new Set(opts.only || []);
  const pieces = planVideoDeliverables(cut, { canvaMapped })
    .filter((p) => (wanted.size ? wanted.has(p.key) : true));

  // The narrative first: without it there is nowhere for the artifacts to hang,
  // and a half-made fan-out with no spine is what the last six months looked
  // like.
  let narrativeId: string;
  try {
    const narrative = await findOrCreateNarrative({
      brand,
      topic,
      objective: "awareness",
      sourceTable: "video_render_jobs",
      sourceId: String(job.id),
      createdBy: opts.producedBy || "video-fan-out",
    });
    narrativeId = narrative.id;
    result.narrativeId = narrativeId;
  } catch (e) {
    result.errors.push(`narrative: ${e instanceof Error ? e.message : String(e)}`);
    return result;
  }

  for (const piece of pieces) {
    if (piece.method === "blocked") {
      result.blocked.push({ key: piece.key, reason: piece.blocked || "blocked" });
      continue;
    }

    try {
      if (piece.method === "reuse") {
        // The finished file already IS this piece. Point the artifact at the
        // same job — no render, no duplicate file, no cost.
        await attachArtifact({
          narrativeId,
          kind: piece.artifactKind,
          table: "video_render_jobs",
          id: String(job.id),
          title: `${piece.label} — ${topic}`,
          producedBy: opts.producedBy || "video-fan-out",
        });
        result.made.push({ key: piece.key, method: "reuse", artifactKind: piece.artifactKind, targetId: String(job.id) });
        continue;
      }

      if (piece.method === "render") {
        const target = piece.aspectRatio === "16:9" ? "longform" : "short";
        const blueprint = buildReformatBlueprint(
          (job.blueprint || {}) as Record<string, unknown>,
          target,
          `${piece.key}${Date.now().toString(36)}`,
        );
        const { data, error } = await supabase.functions.invoke("video-render", {
          body: { blueprint, brand, source_ref: `fanout_${piece.key}_${job.id}` },
        });
        if (error || data?.ok === false) {
          result.errors.push(`${piece.label}: ${error?.message || data?.error || "render failed to enqueue"}`);
          continue;
        }
        const newJobId = data?.render_job_id ? String(data.render_job_id) : null;
        result.rendersQueued++;
        if (newJobId) {
          await attachArtifact({
            narrativeId,
            kind: piece.artifactKind,
            table: "video_render_jobs",
            id: newJobId,
            title: `${piece.label} — ${topic}`,
            producedBy: opts.producedBy || "video-fan-out",
          });
        }
        result.made.push({ key: piece.key, method: "render", artifactKind: piece.artifactKind, targetId: newJobId });
        continue;
      }

      if (piece.method === "canva") {
        // BrandBoard is the transaction boundary: create the canonical draft
        // first, then let Canva attach output only to that exact post id.
        const draft = await createCanvaBrandBoardDraft({
          brand,
          kind: "image",
          caption: topic,
          createdBy: opts.producedBy || "video-fan-out",
          source: { table: "video_render_jobs", id: String(job.id), brand },
          fanoutPiece: piece.key,
          narrativeId,
        });
        const design = await requestCanvaBrandBoardDesign({
          postId: draft.id,
          brand,
          kind: "image",
          headline: topic,
        });
        if (design.state !== "exported_static" || !design.publishable || !design.url) {
          result.errors.push(`${piece.label}: Canva did not attach a stable static export to the BrandBoard draft`);
          continue;
        }
        await attachArtifact({
          narrativeId,
          kind: piece.artifactKind,
          table: "agent_social_posts",
          id: draft.id,
          title: `${piece.label} — ${topic}`,
          producedBy: opts.producedBy || "video-fan-out",
        });
        result.made.push({ key: piece.key, method: "canva", artifactKind: piece.artifactKind, targetId: draft.id });
      }
    } catch (e) {
      result.errors.push(`${piece.label}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return result;
}
