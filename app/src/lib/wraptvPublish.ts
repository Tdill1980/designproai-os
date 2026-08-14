/**
 * wraptvPublish — send a finished cut to the WrapTVWorld site, and write its
 * YouTube caption.
 *
 * Owner, 2026-08-05: "add a button for wraptvworld music video that says send
 * to wraptvworld website and a button also create youtube caption and
 * schedule" · "There should already be a path for this, see our website
 * weprintwraps.com/wraptvworld".
 *
 * There is. `content-deploy` has a real publisher — `publishWrapTVSite` —
 * which inserts into `wraptv_site_content` with a show slug, title, credit and
 * thumbnail, and the site renders from that table. It has been used ONCE
 * (one live row, 2026-07-25). The pipe was built and then had no button.
 *
 * ── WHAT THIS DOES AND DOES NOT DO ─────────────────────────────────────────
 * Site: creates an `agent_social_posts` row on platform `wraptv_site`, already
 * approved, because pressing "send to the website" IS the human approval. The
 * deploy cron picks it up within ~5 minutes and publishes.
 *
 * YouTube: writes the title + description ONLY. `content-deploy` has no
 * YouTube publisher — it supports instagram, facebook, wraptv_site and
 * wrapfeed and throws for anything else. So the draft is marked for MANUAL
 * upload and is never scheduled. A Schedule button that silently failed at 3am
 * would be worse than no button, and there are already 13 YouTube drafts and
 * one scheduled post that cannot publish.
 *
 * Locked by `tests/wraptv-publish.test.ts`.
 */

/** The two WrapTVWorld shows the site renders. */
export type WtwShow = "behind-the-install" | "wrap-of-the-week";

export interface CutLike {
  title?: string | null;
  /** blueprint.title / topic — whatever the cut calls itself. */
  blueprintTitle?: string | null;
  isVideo?: boolean;
  /** Ticker names, when the cut has them — the shops being credited. */
  tickerNames?: string[] | null;
}

/**
 * Which show a cut belongs to.
 *
 * Behind The Install is the video show; Wrap of the Week is the stills slot.
 * A cut that names itself BTI goes there regardless, because the title is a
 * stronger signal than the media type.
 */
export function showSlugFor(cut: CutLike): WtwShow {
  const t = `${cut?.title || ""} ${cut?.blueprintTitle || ""}`.toLowerCase();
  if (t.includes("behind the install") || t.includes("bti")) return "behind-the-install";
  if (t.includes("wrap of the week") || t.includes("wotw")) return "wrap-of-the-week";
  return cut?.isVideo === false ? "wrap-of-the-week" : "behind-the-install";
}

/** The credit line — the shops in the ticker, never invented. */
export function creditFor(cut: CutLike): string | null {
  const names = (cut?.tickerNames || []).map((n) => String(n).trim()).filter(Boolean);
  if (!names.length) return null;
  return names.join(" · ");
}

export interface SitePayload {
  platform: "wraptv_site";
  status: "approved";
  post_type: string;
  caption: string;
  media_urls: string[];
  engagement: Record<string, unknown>;
}

/**
 * The row that sends a cut to the site.
 *
 * `publishWrapTVSite` reads show/title/thumbnail/credit off `engagement`, so
 * they travel there rather than being guessed at publish time. Media is
 * REQUIRED — the publisher throws without it, and a post that fails the cron
 * three times raises a task card, which is noise for a mistake we can refuse
 * up front.
 */
export function buildSitePost(
  cut: CutLike & { mediaUrl?: string | null; thumbnailUrl?: string | null; caption?: string | null },
): SitePayload | { error: string } {
  const media = String(cut?.mediaUrl || "").trim();
  if (!media) return { error: "This cut has no finished file yet — nothing to send." };

  const title = String(cut.blueprintTitle || cut.title || "").trim();
  return {
    platform: "wraptv_site",
    // The human pressed send; that IS the approval, so the deploy cron may act.
    status: "approved",
    post_type: cut.isVideo === false ? "feed" : "reel",
    caption: String(cut.caption || title || "").trim(),
    media_urls: [media, ...(cut.thumbnailUrl ? [String(cut.thumbnailUrl)] : [])],
    engagement: {
      wtw_show: showSlugFor(cut),
      ...(title ? { wtw_title: title } : {}),
      ...(cut.thumbnailUrl ? { wtw_thumbnail: String(cut.thumbnailUrl) } : {}),
      ...(creditFor(cut) ? { wtw_credit: creditFor(cut) } : {}),
      sent_from: "brand_board",
    },
  };
}

/**
 * A YouTube draft — caption only, explicitly NOT scheduled.
 *
 * `scheduled_date` stays null and the status stays `draft`, so the deploy cron
 * never touches it. `engagement.manual_upload` says why in the data, not just
 * in a tooltip.
 */
export function buildYouTubeDraft(input: {
  title: string;
  description: string;
  mediaUrl?: string | null;
  tags?: string[];
}): {
  platform: "youtube";
  status: "draft";
  post_type: string;
  caption: string;
  hashtags: string[];
  media_urls: string[];
  scheduled_date: null;
  engagement: Record<string, unknown>;
} {
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  return {
    platform: "youtube",
    status: "draft",
    post_type: "longform",
    // Title first so the card reads as a YouTube entry at a glance.
    caption: [title, description].filter(Boolean).join("\n\n"),
    hashtags: input.tags || [],
    media_urls: input.mediaUrl ? [String(input.mediaUrl)] : [],
    scheduled_date: null,
    engagement: {
      yt_title: title,
      yt_description: description,
      // content-deploy CAN publish YouTube now (publishYouTube -> the
      // youtube-publish function), but only once the OAuth credentials exist.
      // Recorded in the row so a draft that cannot ship says why.
      needs_youtube_auth: true,
      manual_reason:
        "Publishes automatically once YouTube is connected (YOUTUBE_CLIENT_ID / " +
        "_SECRET / _REFRESH_TOKEN in Supabase). Until then, upload by hand.",
    },
  };
}

/** What the button says happened. Never claims a scheduled publish. */
export function youtubeNotice(connected = false): string {
  return connected
    ? "YouTube caption written. Approve it and it uploads — set a date to schedule the publish."
    : "YouTube caption written and saved as a draft. It uploads automatically once YouTube is connected; until then, upload it by hand.";
}

/**
 * ONE PIECE, BOTH FORMATS — 16:9 longform and 9:16 Shorts.
 *
 * Owner, 2026-08-05: "long form and shorts" · "this is one piece that will be
 * just reformatted for diff social as opposed to the other where we need all
 * new hooks and format".
 *
 * That distinction is the whole point. The six-angle slate writes a DIFFERENT
 * hook per surface because those are different arguments. Behind The Install
 * is the opposite case: one episode, reformatted. Same cut, same scenes, same
 * music — only the frame changes.
 *
 * So this re-enqueues the SAME blueprint at the other aspect rather than
 * planning a new edit. Nothing is re-decided; the renderer simply outputs the
 * other shape.
 *
 * ── WHAT THE CROP COSTS, SAID PLAINLY ──────────────────────────────────────
 * The worker scales to fill and CENTER-CROPS
 * (`force_original_aspect_ratio=increase` then `crop`). Going 16:9 -> 9:16
 * therefore throws away the left and right of frame. For a centred subject
 * that is fine; for a two-shot or a subject at the edge it will cut someone
 * out of the picture. It is a reformat, not a reframe — there is no
 * subject-tracking here, and pretending otherwise would ship silently bad
 * verticals.
 */
export type ReformatTarget = "longform" | "short";

export interface ReformatPlan {
  aspectRatio: "16:9" | "9:16";
  format: string;
  /** True when the source is wider than the target — the lossy direction. */
  cropsSides: boolean;
  note: string;
}

export function planReformat(fromAspect: string | null | undefined, to: ReformatTarget): ReformatPlan {
  const from = String(fromAspect || "").trim();
  if (to === "longform") {
    return {
      aspectRatio: "16:9",
      // format drives the shape in the worker (resolveAspect) — keep them
      // agreed, or a "reel" would be forced back to vertical.
      format: "youtube",
      cropsSides: false,
      note: from === "9:16"
        ? "Vertical source — the top and bottom of frame are cropped to make 16:9."
        : "Same shape as the source; nothing is cropped.",
    };
  }
  return {
    aspectRatio: "9:16",
    format: "reel",
    cropsSides: from === "16:9" || from === "1:1" || from === "4:5",
    note: from === "16:9"
      ? "Landscape source — the left and right of frame are cropped. Check anyone standing off-centre."
      : "Same shape as the source; nothing is cropped.",
  };
}

/**
 * The blueprint for the other format.
 *
 * A new id, because it is a new render — reusing the id would collide with the
 * original in the vault and on the board.
 */
export function buildReformatBlueprint(
  blueprint: Record<string, unknown>,
  to: ReformatTarget,
  stamp: string,
): Record<string, unknown> {
  const plan = planReformat(String(blueprint?.aspectRatio || ""), to);
  return {
    ...blueprint,
    id: `${String(blueprint?.id || "cut")}_${to}_${stamp}`,
    aspectRatio: plan.aspectRatio,
    format: plan.format,
    // A Short must stay short; YouTube classifies by the file, but a 12-minute
    // vertical is not a Short and should not be labelled one.
    ...(to === "short" ? { postType: "short" } : {}),
    source: "reformat",
  };
}
