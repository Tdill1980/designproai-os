/**
 * send-render-to-board — the ONE route a finished render takes onto the board.
 *
 * A FINISHED AI-edited render (Auto-Build reels/shorts/long-form, BrandCast
 * Fast Cut / Story Edit, Content Finder builds, Cut Editor re-renders) lands on
 * the Marketing Approval Board the moment the worker marks it complete — no
 * human has to remember to click "Send to Board" first.
 *
 * Request: { render_job_id, shot_list_item_id?, origin? }
 * Response: { ok: true, taskId, refreshed } | { ok: false, error }
 *
 * shot_list_item_id (optional): when the render came from a Shot List item
 * (worker/video-renderer parses this off a `shotlist_<id>` source_ref), the
 * board card's metadata carries it back and the shot row is updated with
 * this card's id + status "ready_for_review" — the sync the Shot List tab
 * needs to know its footage made it onto the board.
 *
 * origin (optional): "video_studio" when a human sent it from Video Studio,
 * the worker otherwise. It changes provenance on the card and nothing else.
 *
 * ── IT USED TO BE A TWIN, AND THAT IS OVER (2026-08-12) ────────────────────
 * `src/lib/sendRenderToBoard.ts` performed the same two inserts in the browser,
 * with a header on both files asking the next person to keep them in sync. They
 * drifted, and once the CAPTION here is written by a model from the cut's own
 * transcript they could not be reconciled at all — the browser holds no API
 * key, so its twin could only ever produce the placeholder. The browser now
 * calls this function. There is one card shape because there is one writer.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { screenPieceCopy, surfaceBrief } from "../_shared/piece-copy.ts";
import { cutCorpus } from "../_shared/cut-corpus.ts";
import { brandFactsFor } from "../_shared/content-doctrine.ts";
import { writeSurfaceCopy } from "../_shared/piece-copy-writer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BOARD_LANE = "weprintwraps";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function targetFor(bp: any) {
  const ar = bp?.aspectRatio || "9:16";
  if (ar === "16:9") return { platform: "youtube", postType: "video", channel: "youtube" };
  if (ar === "1:1") return { platform: "instagram", postType: "feed", channel: "instagram_feed" };
  return { platform: "instagram", postType: "reel", channel: "instagram_reel" };
}

function startingCaption(bp: any): string {
  const cap = typeof bp?.caption === "string" ? bp.caption.trim() : "";
  if (cap) return cap;
  const title = typeof bp?.title === "string" ? bp.title.trim() : "";
  return title ? `${title}\n\n(Caption not written yet — edit before approving.)` : "";
}

function attachmentNameFor(bp: any): string {
  const fmt = bp?.aspectRatio === "16:9" ? "YouTube 16:9"
    : bp?.aspectRatio === "1:1" ? "Square 1:1"
    : "Reel 9:16";
  const dur = Number(bp?.totalDuration);
  return Number.isFinite(dur) && dur > 0 ? `${fmt} · ${Math.round(dur)}s` : fmt;
}

function boardBlocker(job: { status?: string | null; final_url?: string | null }): string | null {
  if (!job?.final_url) return "That render has no file yet — wait for it to finish.";
  if (job.status && job.status !== "complete") return `That render is ${job.status}, not complete.`;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { render_job_id, shot_list_item_id, origin } = await req.json();
    if (!render_job_id) return json({ ok: false, error: "render_job_id required" }, 400);

    // WHO SENT IT. The worker sends automatically the moment a render
    // completes; Video Studio sends when a human clicks. Same card either way —
    // this only keeps the provenance on the row honest, and an unrecognised
    // value falls back to the worker rather than inventing a sender.
    const fromStudio = String(origin || "") === "video_studio";
    const sender = fromStudio ? "video_studio_board" : "video_renderer_worker";
    const senderSource = fromStudio ? "video_studio" : "video_renderer_worker";
    const senderLine = fromStudio
      ? "Finished render sent from Video Studio."
      : "AI-edited render finished and queued for approval.";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: job, error: jobErr } = await supabase
      .from("video_render_jobs")
      .select("id, brand, status, final_url, thumbnail_url, blueprint, source_ref, created_at")
      .eq("id", render_job_id)
      .maybeSingle();
    if (jobErr) return json({ ok: false, error: jobErr.message }, 500);
    if (!job) return json({ ok: false, error: "render job not found" }, 404);

    // Fall back to parsing the shot id off source_ref (shotlist_<uuid>) so a
    // worker-side call always links even if the id wasn't passed explicitly.
    const shotId: string | null = shot_list_item_id
      || (typeof job.source_ref === "string" ? job.source_ref.match(/^shotlist_([0-9a-f-]{36})/i)?.[1] ?? null : null);

    async function syncShotRow(taskId: string) {
      if (!shotId) return;
      await supabase.from("shot_list_items")
        .update({ board_task_id: taskId, status: "ready_for_review", updated_at: new Date().toISOString() })
        .eq("id", shotId);
    }

    const blocked = boardBlocker(job);
    if (blocked) return json({ ok: false, error: blocked });

    const bp = job.blueprint || {};
    const brand = job.brand || bp.brand || "weprintwraps";
    const group = `render_${job.id}`;
    const { platform, postType, channel } = targetFor(bp);
    const title = bp.title || bp.id || `Render ${String(job.id).slice(0, 8)}`;
    const attachment = { url: job.final_url, type: "video", name: attachmentNameFor(bp) };

    const { data: existing } = await supabase
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
      meta.shot_list_item_id = shotId || meta.shot_list_item_id || null;
      const { error } = await supabase
        .from("slack_agent_tasks")
        .update({ metadata: meta, due_date: null, updated_at: new Date().toISOString() })
        .eq("id", card.id);
      if (error) return json({ ok: false, error: error.message }, 500);
      if (meta.social_post_id) {
        await supabase.from("agent_social_posts")
          .update({ media_urls: [job.final_url], status: "draft", scheduled_date: null, updated_at: new Date().toISOString() })
          .eq("id", meta.social_post_id);
      }
      await syncShotRow(card.id);
      return json({ ok: true, taskId: card.id, refreshed: true });
    }

    // ── THE CAPTION IS WRITTEN, NOT PLACEHELD ────────────────────────────
    //
    // Every one of the 45 cards this path produced in 60 days carried the same
    // string: "(Caption not written yet — edit before approving.)". A finished
    // render arriving on the approval board with no copy is not a draft, it is
    // a to-do, and it is what the owner was looking at.
    //
    // The blueprint's own caption still wins where one exists — that is a
    // human's words. Otherwise the copy is written FROM THE CUT'S OWN WORDS
    // (`cutCorpus`) and checked back against them, and the placeholder survives
    // only when the footage genuinely says nothing.
    const framed = startingCaption(bp);
    const blueprintCaption = typeof bp?.caption === "string" && bp.caption.trim();
    let caption = framed;
    let copyMeta: Record<string, unknown> = { method: blueprintCaption ? "blueprint" : "placeholder" };

    if (!blueprintCaption) {
      const corpus = await cutCorpus(supabase, bp);
      const brief = surfaceBrief(platform, postType, brand);
      if (corpus && brief) {
        const written = await writeSurfaceCopy(corpus, brand, [brief]);
        const screened = screenPieceCopy({
          written: written.byKey[`${brief.platform}:${brief.postType}`],
          framed,
          source: corpus,
          brief,
          brandLabel: brandFactsFor(brand)?.label,
        });
        caption = screened.caption;
        copyMeta = {
          method: screened.method,
          refused: screened.violations,
          writer_error: written.error,
          grounded_in: "cut transcript",
        };
      } else {
        copyMeta = { method: "placeholder", why: corpus ? "no doctrine rule for this surface" : "this cut has no spoken words to write from" };
      }
    }

    const { data: post, error: postErr } = await supabase.from("agent_social_posts").insert({
      brand,
      platform,
      post_type: postType,
      caption,
      hashtags: [],
      media_urls: [job.final_url],
      scheduled_date: null,
      status: "draft",
      created_by: sender,
      // WHICH PATH WROTE THIS CAPTION, on the row. A card that fell back to the
      // placeholder reads differently from one whose footage was silent, and a
      // human should be able to tell which without re-running anything.
      generation_meta: { source: senderSource, render_job_id: job.id, copy: copyMeta },
    }).select("id").single();
    if (postErr) console.warn("[send-render-to-board] draft insert failed:", postErr.message);

    const { data: task, error: taskErr } = await supabase.from("slack_agent_tasks").insert({
      brand: BOARD_LANE,
      task_type: "social_post",
      status: "pending",
      priority: "medium",
      title: `${brand === "weprintwraps" ? "" : `${brand}: `}${title}`.slice(0, 120),
      description:
        `${senderLine}\n\n` +
        `${bp.format || "video"} · ${bp.aspectRatio || "9:16"}` +
        (bp.totalDuration ? ` · ${Math.round(Number(bp.totalDuration))}s` : "") +
        ` · render ${String(job.id).slice(0, 8)}\n\n` +
        (post?.id
          ? `On approval this gets a calendar date and publishes to ${brand} via content-deploy.`
          : `NOTE: no publishable draft attached (draft insert failed) — create the post by hand on approval.`) +
        (caption ? `\n\nCaption on the draft:\n${caption}` : `\n\nNo caption yet — write one before approving.`) +
        (copyMeta.method === "placeholder"
          ? `\n\nNo caption was written: ${String(copyMeta.why || "this cut has no words to write from")}.`
          : ""),
      created_by: sender,
      category: "marketing",
      metadata: {
        source: senderSource,
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
        shot_list_item_id: shotId || null,
        copy: copyMeta,
      },
    }).select("id").single();
    if (taskErr) return json({ ok: false, error: taskErr.message }, 500);

    if (task?.id) await syncShotRow(task.id);
    return json({ ok: true, taskId: task?.id, refreshed: false });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
