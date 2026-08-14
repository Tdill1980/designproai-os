/**
 * brandBoardUpload — the BACK-CATALOG door into the Brand Board.
 *
 * Content Director / the agent pipeline remains THE tool for everything made
 * from here on. This is the other direction: content that already exists —
 * reels, photos, captions made before this system was built, or anything cut
 * by hand outside it — gets uploaded, lands on the Brand Board as a real card,
 * and a human reviews it there. If the copy is weak, the AI refine panel
 * rewrites the hook/caption (see `captionRefine.ts`) and the human accepts it.
 *
 * ── WHO DOES WHAT ──────────────────────────────────────────────────────────
 * Anyone on the team can UPLOAD. Only an approver (admin role, or the admin
 * allowlist — see `useContentApprover`) can APPROVE. So every upload lands in
 * ONE place, `needs_review`, and waits: uploading is never self-approving,
 * whatever the piece is. What approval MEANS travels with the row as
 * `generation_meta.intended_state`, and `buildLegacyApprovalPatch` applies it:
 * a piece that already ran becomes "posted" (history), one that never ran
 * becomes "approved" (ready to be scheduled deliberately, later).
 *
 * ── THE ONE SAFETY RULE ────────────────────────────────────────────────────
 * Uploading OLD content must never RE-PUBLISH it.
 *
 * `content-deploy`'s cron sweep publishes any row with
 *   status IN ('approved','scheduled') AND scheduled_date <= now()
 * so a back-catalog piece carrying its ORIGINAL post date would be due the
 * instant someone approved it — the system would re-post a year-old reel.
 *
 * So this module never produces a publishable row:
 *   - `scheduled_date` is ALWAYS null. The original run date is recorded in
 *     `generation_meta.original_posted_at` (a fact about the past, not a
 *     schedule). Scheduling happens later, through the normal approve flow,
 *     on a date a human picks.
 *   - `status` is only ever "posted" (archive — it already ran, terminal, the
 *     cron skips it) or "needs_review" (never ran — a human decides).
 * Locked by `tests/brand-board-upload.test.ts`.
 */

/** Marks every row this door creates, so the back catalog stays identifiable. */
export const LEGACY_UPLOAD_SOURCE = "brand-board-upload";

/** Storage prefix inside the public `wrap-files` bucket. */
export const LEGACY_UPLOAD_PREFIX = "brand-board/legacy";

/**
 * What the uploader says this piece IS. It does not change where the upload
 * lands (always `needs_review`) — only what approving it will mean.
 *  - archive → it already ran on the channel. Approving files it into history
 *    as "posted", which is terminal: the deploy cron filters on
 *    approved/scheduled, so a posted row can never be swept up again.
 *  - review → it was made but never published. Approving marks it "approved",
 *    still with no schedule attached.
 */
export type LegacyState = "archive" | "review";

/** A status the publish cron would act on. Never written on INSERT from here. */
export const PUBLISHABLE_STATUSES = ["approved", "scheduled"] as const;

/** Where every upload lands, no matter who uploads it or what it is. */
export const PENDING_STATUS = "needs_review";

/** Soft-reject — matches the Content Director's `director_reject` convention. */
export const REJECTED_STATUS = "rejected";

/**
 * Where the piece ran. One pick drives BOTH `platform` and `post_type`, which
 * is what the board's own classifier (`typeForSocialPost`) reads to file the
 * card under the right coloured tab — so an uploaded reel lands in Reels, not
 * in the grey "Other" bucket.
 */
export interface ChannelDef {
  label: string;
  platform: string;
  postType: string;
  /** `format` passed to content-studio-ai-copy so the copy fits the surface. */
  copyFormat: string;
}

export const LEGACY_CHANNELS: Record<string, ChannelDef> = {
  ig_reel: { label: "Instagram Reel", platform: "instagram", postType: "reel", copyFormat: "Reel" },
  ig_feed: { label: "Instagram Feed", platform: "instagram", postType: "feed", copyFormat: "Post" },
  ig_carousel: { label: "Instagram Carousel", platform: "instagram", postType: "carousel", copyFormat: "Carousel" },
  ig_story: { label: "Instagram Story", platform: "instagram", postType: "story", copyFormat: "Post" },
  fb_feed: { label: "Facebook Post", platform: "facebook", postType: "feed", copyFormat: "Post" },
  yt_short: { label: "YouTube Short", platform: "youtube", postType: "short", copyFormat: "Reel" },
  yt_long: { label: "YouTube Longform", platform: "youtube", postType: "video", copyFormat: "YouTube Thumbnail" },
  tiktok: { label: "TikTok", platform: "tiktok", postType: "reel", copyFormat: "Reel" },
  x_post: { label: "X / Twitter", platform: "x", postType: "feed", copyFormat: "Post" },
  linkedin: { label: "LinkedIn", platform: "linkedin", postType: "feed", copyFormat: "Post" },
  pinterest: { label: "Pinterest", platform: "pinterest", postType: "feed", copyFormat: "Post" },
  reddit: { label: "Reddit", platform: "reddit", postType: "feed", copyFormat: "Post" },
  text_only: { label: "Text / Copy only", platform: "instagram", postType: "text", copyFormat: "Post" },
};

export type ChannelKey = keyof typeof LEGACY_CHANNELS;
export const CHANNEL_ORDER = Object.keys(LEGACY_CHANNELS) as ChannelKey[];

export interface LegacyUploadInput {
  /** Board brand slug — weprintwraps | restylepro | designproai | … */
  brand: string;
  channel: ChannelKey;
  caption: string;
  hashtags?: string[];
  /** The scroll-stopper, kept separately so the refiner can rewrite just it. */
  hook?: string;
  mediaUrls: string[];
  state: LegacyState;
  /** ISO date the piece ORIGINALLY ran. A fact, never a schedule. */
  originalPostedAt?: string | null;
  /** Free-text note for the reviewer ("old shop reel, no logo on it"). */
  note?: string;
  /** Who uploaded it — email or name, for the card's provenance line. */
  uploadedBy?: string | null;
  /** True when the copy on this row came out of the AI refine panel. */
  aiAssisted?: boolean;
}

export interface LegacyPostRow {
  brand: string;
  platform: string;
  post_type: string;
  caption: string;
  hashtags: string[];
  media_urls: string[];
  /** Always pending. An upload is never self-approving. */
  status: typeof PENDING_STATUS;
  scheduled_date: null;
  posted_date: null;
  created_by: string;
  generation_meta: Record<string, unknown>;
}

/** Strip a leading # and any whitespace, drop the empties. */
export function normalizeHashtags(raw: string | string[] | undefined): string[] {
  const parts = Array.isArray(raw) ? raw : String(raw || "").split(/[\s,]+/);
  return parts
    .map((t) => String(t).trim().replace(/^#+/, ""))
    .filter(Boolean)
    .map((t) => `#${t}`);
}

/**
 * Build the `agent_social_posts` row for a back-catalog piece.
 *
 * Pure — no network, no Supabase — so the safety rule above is unit-testable
 * without a database.
 */
export function buildLegacyPostRow(input: LegacyUploadInput): LegacyPostRow {
  const channel = LEGACY_CHANNELS[input.channel] || LEGACY_CHANNELS.ig_feed;
  const originalPostedAt = input.originalPostedAt || null;

  return {
    brand: input.brand,
    platform: channel.platform,
    post_type: channel.postType,
    caption: (input.caption || "").trim(),
    hashtags: normalizeHashtags(input.hashtags),
    media_urls: (input.mediaUrls || []).filter(Boolean),
    // Always pending, for everyone. Never "approved"/"scheduled" — see THE ONE
    // SAFETY RULE. Even an already-ran piece waits for an approver, so the
    // board's queue is the single honest answer to "what needs looking at".
    status: PENDING_STATUS,
    // Never a schedule. Uploading the back catalog cannot queue a publish.
    scheduled_date: null,
    // Not posted-by-us. The date it originally ran is a fact in the metadata;
    // `posted_date` is set on approval, by the approver, not by the uploader.
    posted_date: null,
    created_by: LEGACY_UPLOAD_SOURCE,
    generation_meta: {
      source: LEGACY_UPLOAD_SOURCE,
      legacy: true,
      channel: input.channel,
      channel_label: channel.label,
      /** What approving this piece will mean. Applied by buildLegacyApprovalPatch. */
      intended_state: input.state,
      original_posted_at: originalPostedAt,
      uploaded_by: input.uploadedBy || null,
      uploaded_at: new Date().toISOString(),
      hook: input.hook || null,
      note: input.note || null,
      ai_assisted: !!input.aiAssisted,
      pending_approval: true,
      // Honest record of what this door did NOT do, for anyone auditing why an
      // old post never went out again.
      never_scheduled: true,
    },
  };
}

export interface LegacyApprovalPatch {
  status: "posted" | "approved";
  posted_date: string | null;
  scheduled_date: null;
  generation_meta: Record<string, unknown>;
}

/**
 * The patch an APPROVER applies to a pending back-catalog upload.
 *
 * `scheduled_date` stays null in both branches — approving says "this is good
 * content", not "send it". Publishing an approved piece still requires someone
 * to pick a date in the Director/calendar, which is the only place a publish
 * should ever be born.
 */
export function buildLegacyApprovalPatch(
  meta: Record<string, unknown> | null | undefined,
  approver: string | null,
  now = new Date().toISOString(),
): LegacyApprovalPatch {
  const m = (meta || {}) as Record<string, unknown>;
  const archived = m.intended_state === "archive";
  const originalPostedAt = typeof m.original_posted_at === "string" ? m.original_posted_at : null;

  return {
    // Already ran → file it in history. Never ran → approved, unscheduled.
    status: archived ? "posted" : "approved",
    posted_date: archived ? originalPostedAt || now : null,
    scheduled_date: null,
    generation_meta: {
      ...m,
      pending_approval: false,
      approved_by: approver,
      approved_at: now,
    },
  };
}

/** The patch for a soft-reject. The row is kept, so nothing is lost. */
export function buildLegacyRejectPatch(
  meta: Record<string, unknown> | null | undefined,
  approver: string | null,
  reason?: string,
  now = new Date().toISOString(),
): { status: string; generation_meta: Record<string, unknown> } {
  return {
    status: REJECTED_STATUS,
    generation_meta: {
      ...((meta || {}) as Record<string, unknown>),
      pending_approval: false,
      rejected_by: approver,
      rejected_at: now,
      rejected_reason: reason || null,
    },
  };
}

/** True when this card came in through the back-catalog door. */
export function isLegacyUpload(meta: Record<string, unknown> | null | undefined): boolean {
  return !!meta && (meta as Record<string, unknown>).source === LEGACY_UPLOAD_SOURCE;
}

/** True when it is still waiting on an approver. */
export function isPendingApproval(
  meta: Record<string, unknown> | null | undefined,
  status?: string | null,
): boolean {
  return isLegacyUpload(meta) && (status || "").toLowerCase() === PENDING_STATUS;
}

/** Storage path for one uploaded file. Kept stable + collision-free. */
export function legacyStoragePath(brand: string, fileName: string, index = 0, now = Date.now()): string {
  const safeBrand = (brand || "restylepro").toLowerCase().replace(/[^a-z0-9-]/g, "") || "restylepro";
  const ext = (fileName.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  return `${LEGACY_UPLOAD_PREFIX}/${safeBrand}/${now}-${index}.${ext}`;
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif)($|\?)/i;
const VIDEO_RE = /\.(mp4|mov|webm|m4v)($|\?)/i;

export function isImageUrl(url: string): boolean {
  return IMAGE_RE.test(url || "");
}
export function isVideoUrl(url: string): boolean {
  return VIDEO_RE.test(url || "");
}

/**
 * The still the AI can actually READ. A video has no frame to send, so
 * grounding must degrade honestly to text-only rather than pretending the
 * model saw the footage.
 */
export function readableStill(mediaUrls: string[]): string | null {
  return (mediaUrls || []).find(isImageUrl) || null;
}
