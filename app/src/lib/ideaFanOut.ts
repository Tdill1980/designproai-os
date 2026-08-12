/**
 * ideaFanOut — one approved idea becomes many pieces of social content.
 *
 * Owner, 2026-08-05:
 *   "THERE SHOULD BE SQUARE CARDS SHOWING IDEAS THEN WE APPROVE AND CONTENT
 *    GETS MADE. CONTENT DIRECTOR IS BROKEN."
 *   "ONE PIECE OF VIDEO SHOULD TURN INTO MANY PIECES OF SOCIAL CONTENT."
 *
 * Measured against production the same day, both halves were true:
 *
 *  1. NOTHING CONSUMED AN IDEA. `content_hooks` held 534 rows, 505 of them
 *     created in a single week. `hooks_to_drafts` — the only thing with
 *     "hooks" in its name — GENERATES fresh hooks from a shoot transcript and
 *     never reads that table. Content Director's queue reads social drafts and
 *     email campaigns only. So ideas accumulated with no surface and no action
 *     that could turn one into a piece of content.
 *
 *  2. ONE APPROVAL MADE ONE POST. Even where content was produced, a finished
 *     cut became a single Instagram draft. The reel, the short, the X post and
 *     the LinkedIn version — the whole reason you cut once and publish five
 *     times — had to be made by hand.
 *
 * This module is the rules half: given an idea and whatever media exists, what
 * pieces should exist, on which platform, with what copy. It does no I/O so it
 * stays testable. Locked by `tests/idea-fan-out.test.ts`.
 *
 * ── IT NEVER INVENTS FACTS ─────────────────────────────────────────────────
 * Every piece carries the idea's OWN words. The per-platform work is framing —
 * length, line breaks, a question or a CTA — never a new claim, a new number,
 * or a company detail the idea did not contain. A hook that says "we wrapped
 * 40 vans" must not become "we wrapped 400 vans" because LinkedIn wanted a
 * bigger number. Fabrication here reaches customers.
 */

import { hookForPiece, type IdeaHookBrief } from "@/lib/ideaHook";

/** X's published character limit. */
export const X_LIMIT = 280;

/**
 * The default operating contract for one master video.
 *
 * This is intentionally the only ordered registry for the core five. Keeping
 * the channel, format, copy limit and job together prevents the planner, UI and
 * tests from each carrying a slightly different version of "five platforms".
 */
export const CORE_VIDEO_PLATFORM_REGISTRY = Object.freeze([
  {
    platform: "instagram",
    label: "Instagram",
    postType: "reel",
    role: "The scroll-stopper. Same cut, vertical, where the wrap audience lives.",
    captionMax: null,
  },
  {
    platform: "facebook",
    label: "Facebook",
    postType: "feed",
    role: "The local, referral-driven half of the market — older, and it converts.",
    captionMax: null,
  },
  {
    platform: "youtube",
    label: "YouTube",
    postType: "short",
    role: "YouTube Short — the same cut, discoverable by search rather than feed.",
    captionMax: 100,
  },
  {
    platform: "linkedin",
    label: "LinkedIn",
    postType: "post",
    role: "Talks to shop owners as operators — process and margin, not the visual.",
    captionMax: null,
  },
  {
    platform: "x",
    label: "X",
    postType: "post",
    role: "Says it in public, in the open, where it can be argued with.",
    captionMax: X_LIMIT,
  },
] as const);

export type IdeaPlatform = (typeof CORE_VIDEO_PLATFORM_REGISTRY)[number]["platform"];

export interface IdeaPiece {
  platform: IdeaPlatform;
  /**
   * Identity of the one master video this platform plan was derived from.
   * Every child from a video fan-out carries the same value.
   */
  sourceVideoId: string | null;
  /** agent_social_posts.post_type */
  postType: string;
  caption: string;
  /** Does this piece want the video attached? */
  wantsMedia: boolean;
  /** Why this platform is in the set — shown on the card, not decoration. */
  role: string;
  /**
   * The channel + brand register this caption was framed for, carried out so
   * the model that writes final copy writes to it. Null when the doctrine has
   * no rule for the surface — an honest gap, never a guessed register.
   */
  hookBrief: IdeaHookBrief | null;
}

export interface IdeaInput {
  /** The idea's own text. The single source of every word below. */
  text: string;
  brand?: string | null;
  /** A finished render to attach, when one exists. */
  mediaUrl?: string | null;
  /** True when the media is a video rather than a still. */
  isVideo?: boolean;
  /** Stable asset/render identity for the master video, when the caller has it. */
  sourceVideoId?: string | null;
}

/** Trim to a limit on a word boundary — never mid-word, never with a broken tag. */
export function clip(text: string, max: number): string {
  const t = String(text || "").trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The set of pieces one idea should produce.
 *
 * VIDEO IDEAS get the full set — that is the "cut once, publish five times"
 * case the owner asked for. A TEXT-ONLY idea gets the text platforms only:
 * queueing a reel with no footage would create a draft nobody can publish,
 * which is the blank-card problem in a new costume.
 */
export function planIdeaPieces(idea: IdeaInput): IdeaPiece[] {
  const text = String(idea?.text || "").trim();
  if (!text) return [];

  const hasVideo = !!idea.mediaUrl && idea.isVideo !== false;
  const hasMedia = !!idea.mediaUrl;
  const brand = idea.brand;
  // Existing callers only have the render URL. Keep those traceable while new
  // callers supply the stable asset/render id explicitly.
  const sourceVideoId = hasVideo
    ? String(idea.sourceVideoId || idea.mediaUrl || "").trim() || null
    : null;

  /**
   * EVERY piece is framed for its own channel and brand.
   *
   * This used to assign the same `text` to all five platforms, so one idea
   * became five identical posts — measured at 100% duplication over every row
   * the path had ever produced. `hookForPiece` reshapes the idea's OWN words
   * for the channel's hook move and attaches the brief; it never adds a fact.
   * The X length limit is applied AFTER framing, or the clip would cut the
   * question mark that makes it a question.
   */
  const piece = (
    platform: IdeaPlatform,
    postType: string,
    wantsMedia: boolean,
    role: string,
    max?: number,
  ): IdeaPiece => {
    const { caption, brief } = hookForPiece(text, platform, postType, brand);
    return {
      platform,
      sourceVideoId,
      postType,
      caption: max ? clip(caption, max) : caption,
      wantsMedia,
      role,
      hookBrief: brief,
    };
  };

  if (hasVideo) {
    // Return directly: a master video has exactly five children — no hidden
    // sixth default can be appended below this contract.
    return CORE_VIDEO_PLATFORM_REGISTRY.map((definition) => piece(
      definition.platform,
      definition.postType,
      true,
      definition.role,
      definition.captionMax ?? undefined,
    ));
  }

  const pieces: IdeaPiece[] = [];

  if (hasMedia) {
    pieces.push(piece("instagram", "feed", true, "The still, in the feed."));
    pieces.push(piece("facebook", "feed", true,
      "The local, referral-driven half of the market."));
  }

  // Text platforms always work — they carry the argument with or without film.
  pieces.push(piece("x", "post", hasMedia,
    "Says it in public, in the open, where it can be argued with.", X_LIMIT));
  pieces.push(piece("linkedin", "post", hasMedia,
    "Talks to shop owners as operators — process and margin, not the visual."));

  return pieces;
}

/**
 * Every piece must be traceable to the idea it came from, or the board fills
 * with orphans nobody can explain — which is how 534 hooks became unusable.
 */
export function ideaProvenance(ideaId: string, brand?: string | null) {
  return {
    source: "idea_approve",
    idea_id: ideaId,
    brand: brand || null,
  };
}

/** A one-line summary for the toast — states the real number, never "done". */
export function fanOutSummary(pieces: IdeaPiece[], hadMedia: boolean): string {
  if (!pieces.length) return "That idea has no text to work from.";
  const names = pieces.map((p) => p.platform).join(", ");
  return hadMedia
    ? `${pieces.length} drafts made from one idea — ${names}. All carry the footage.`
    : `${pieces.length} drafts made — ${names}. No footage attached yet, so these are copy-only.`;
}
