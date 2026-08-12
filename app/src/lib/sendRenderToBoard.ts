/**
 * sendRenderToBoard — put a FINISHED render on the Content Review board.
 *
 * A render sitting in video_render_jobs is invisible to the approval flow: the
 * board (AdminApprovalBoard) reads slack_agent_tasks, and publishing reads
 * agent_social_posts. BrandCast writes both when it builds a pack, but a render
 * made any other way (Auto-Build, a Cut Editor re-render, an older batch like
 * the WrapTVWorld installer music videos) had no route onto the board at all —
 * it had to be inserted by hand. This is that route.
 *
 * What it writes, matching the BrandCast pattern exactly so both kinds of card
 * behave identically:
 *   1. agent_social_posts DRAFT on the REAL target brand — draft never
 *      auto-posts, and content-deploy publishes to the right account once the
 *      approve → calendar trigger schedules it.
 *   2. slack_agent_tasks CARD in the `weprintwraps` lane (the lane the board
 *      displays) with metadata.target_brand set, stage `needs_approval`, the
 *      render attached, and metadata.thumbnail_url so the card shows a picture
 *      instead of an empty box.
 *
 * IDEMPOTENT: keyed on metadata.render_group = `render_<jobId>`. Sending the
 * same render twice REFRESHES the existing card (new file URL after a
 * re-render, stage back to needs_approval) instead of stacking duplicates.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  BOARD_LANE, targetFor, startingCaption, attachmentNameFor, renderGroupKey, boardBlocker,
} from "@/lib/boardCard";

const db = supabase as any;

export interface RenderRow {
  id: string;
  brand?: string | null;
  status?: string | null;
  final_url?: string | null;
  thumbnail_url?: string | null;
  blueprint?: any;
  created_at?: string | null;
}

export interface SendToBoardResult {
  ok: boolean;
  taskId?: string;
  /** true when an existing card was refreshed rather than a new one created. */
  refreshed?: boolean;
  error?: string;
}

export async function sendRenderToBoard(job: RenderRow): Promise<SendToBoardResult> {
  const blocked = boardBlocker(job);
  if (blocked) return { ok: false, error: blocked };

  const bp = job.blueprint || {};
  const brand = job.brand || bp.brand || "weprintwraps";
  const group = renderGroupKey(job.id);
  const { platform, postType, channel } = targetFor(bp);
  const title = bp.title || bp.id || `Render ${job.id.slice(0, 8)}`;
  const attachment = { url: job.final_url, type: "video", name: attachmentNameFor(bp) };

  // Already on the board? Refresh it — a re-render changes the file, and the
  // card must point at the CURRENT one or a human approves stale pixels.
  const { data: existing } = await db
    .from("slack_agent_tasks")
    .select("id, metadata")
    .eq("brand", BOARD_LANE)
    .contains("metadata", { render_group: group })
    .limit(1);

  if (existing?.length) {
    const card = existing[0];
    const meta = { ...(card.metadata || {}) };
    meta.attachments = [attachment];
    meta.thumbnail_url = job.thumbnail_url || meta.thumbnail_url || null;
    meta.approval_stage = "needs_approval";
    const { error } = await db
      .from("slack_agent_tasks")
      .update({ metadata: meta, due_date: null, updated_at: new Date().toISOString() })
      .eq("id", card.id);
    if (error) return { ok: false, error: error.message };
    if (meta.social_post_id) {
      await db.from("agent_social_posts")
        .update({ media_urls: [job.final_url], status: "draft", scheduled_date: null, updated_at: new Date().toISOString() })
        .eq("id", meta.social_post_id);
    }
    return { ok: true, taskId: card.id, refreshed: true };
  }

  // Publishable draft on the REAL brand (draft = can never auto-post).
  const caption = startingCaption(bp);
  const { data: post, error: postErr } = await db.from("agent_social_posts").insert({
    brand,
    platform,
    post_type: postType,
    caption,
    hashtags: [],
    media_urls: [job.final_url],
    scheduled_date: null,
    status: "draft",
    created_by: "video_studio_board",
  }).select("id").single();
  // Worth a card even without the draft — but the card must SAY so rather than
  // implying an auto-publish that isn't wired.
  if (postErr) console.warn("[sendRenderToBoard] draft insert failed:", postErr.message);

  const { data: task, error: taskErr } = await db.from("slack_agent_tasks").insert({
    brand: BOARD_LANE,
    task_type: "social_post",
    status: "pending",
    priority: "medium",
    title: `${brand === "weprintwraps" ? "" : `${brand}: `}${title}`.slice(0, 120),
    description:
      `Finished render sent from Video Studio.\n\n` +
      `${bp.format || "video"} · ${bp.aspectRatio || "9:16"}` +
      (bp.totalDuration ? ` · ${Math.round(Number(bp.totalDuration))}s` : "") +
      ` · render ${job.id.slice(0, 8)}\n\n` +
      (post?.id
        ? `On approval this gets a calendar date and publishes to ${brand} via content-deploy.`
        : `NOTE: no publishable draft attached (draft insert failed) — create the post by hand on approval.`) +
      (caption ? `\n\nCaption on the draft:\n${caption}` : `\n\nNo caption yet — write one before approving.`),
    created_by: "video_studio_board",
    category: "marketing",
    metadata: {
      source: "video_studio",
      approval_stage: "needs_approval",
      target_brand: brand,
      render_group: group,
      render_job_id: job.id,
      asset_kind: "video",
      primary_channel: channel,
      formats: [bp.format || "reel"],
      thumbnail_url: job.thumbnail_url || null,
      social_post_id: post?.id || null,
      attachments: [attachment],
    },
  }).select("id").single();
  if (taskErr) return { ok: false, error: taskErr.message };

  return { ok: true, taskId: task?.id };
}
