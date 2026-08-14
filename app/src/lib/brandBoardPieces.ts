/**
 * brandBoardPieces — the Brand Board's view of the narrative spine.
 *
 * Owner, 2026-08-06: "Brand board missing all the content it's supposed to
 * make from injected video uploaded."
 *
 * Measured against production the same day. The spine HAD run — `spine.js`
 * created 6 narratives and 14 drafted artifacts at 04:27 from the shot-list
 * uploads. Nothing was lost. The Brand Board simply could not show any of it,
 * for two independent reasons:
 *
 *   1. The board loads 18 tables and NEITHER of them is `content_artifacts` or
 *      `content_narratives`. Every piece the fan-out declares lived in tables
 *      the board never read. Only the Narrative Board tab did.
 *   2. Even reading them would not have been enough. Three of the four pieces
 *      are `reuse` — a 9:16 cut IS the Reel and IS the YouTube Short, so both
 *      artifacts point at the SAME `video_render_jobs` row. The board renders
 *      one card per job row, hardcoded to `type: "reels"`. One video in, one
 *      card out, filed under Reels only. The Short existed in the database and
 *      had nowhere to appear; a 16:9 longform was mislabelled a Reel.
 *
 * So this module answers, per render job: which of the four pieces this cut IS,
 * and which the narrative still has NOT got. The board then renders one card
 * per real piece, on the right tab, and states the gaps instead of hiding them.
 *
 * ── MISSING IS COUNTED PER NARRATIVE, NOT PER JOB ──────────────────────────
 * A narrative's longform frequently lives on a DIFFERENT render job than its
 * Reel (live example: "Behind The Install" — youtube on b35410f6, reel and
 * short on 0fdbe455). Counting gaps per job would report the longform missing
 * while it sits finished one card over. The narrative is the unit of "what did
 * this story produce", so that is where the gap is measured.
 *
 * ── IT NEVER INVENTS A PIECE ────────────────────────────────────────────────
 * Only artifacts that actually exist and are past `planned` become cards. A
 * `planned` row is the spine's empty checklist slot, not content — rendering
 * those as cards would refill the board with the blank cards `brandBoardFinished`
 * was written to remove. Gaps are stated in words, with what would close them.
 *
 * Pure by design: no database, no network, no clock. Locked by
 * `tests/brand-board-pieces.test.ts`.
 */

/**
 * The four pieces one finished video becomes.
 *
 * Same artifact kinds `planVideoDeliverables` emits, in the order a human
 * reads them: the anchor first, then the verticals, then the static.
 */
export const VIDEO_PIECE_KINDS = ["youtube", "reel", "youtube_short", "instagram"] as const;
export type VideoPieceKind = (typeof VIDEO_PIECE_KINDS)[number];

const PIECE_KIND_SET = new Set<string>(VIDEO_PIECE_KINDS);

/** What each piece is called on a card. Matches the fan-out dialog's wording. */
export const PIECE_LABEL: Record<VideoPieceKind, string> = {
  youtube: "Longform (16:9)",
  reel: "Reel (9:16)",
  youtube_short: "YouTube Short (9:16)",
  instagram: "Canva graphic (feed post)",
};

/**
 * The spine slot a card belongs in — `planned` means the checklist has the
 * slot but nothing has been made for it.
 */
export const PLANNED_STATUS = "planned";

/** Which of the board's coloured tabs a spine artifact belongs on. */
export function boardTypeForKind(kind: string): "youtube" | "reels" | "shorts" | "ig" | null {
  switch (kind) {
    case "youtube":
      return "youtube";
    case "reel":
      return "reels";
    case "youtube_short":
      return "shorts";
    case "instagram":
      return "ig";
    default:
      return null;
  }
}

/** Which template shape the piece is, for the Template tab. */
export function boardTemplateForKind(kind: string): "longform" | "reel916" | "feed" {
  if (kind === "youtube") return "longform";
  if (kind === "reel" || kind === "youtube_short") return "reel916";
  return "feed";
}

export interface SpineArtifactRow {
  narrative_id?: string | null;
  kind?: string | null;
  target_table?: string | null;
  target_id?: string | null;
  title?: string | null;
  status?: string | null;
  produced_by?: string | null;
}

export interface SpineNarrativeRow {
  id?: string | null;
  brand?: string | null;
  topic?: string | null;
}

/** One missing piece, and the specific thing that would produce it. */
export interface MissingPiece {
  kind: VideoPieceKind;
  label: string;
  reason: string;
}

/** What one render job is, on the spine. */
export interface JobSpine {
  narrativeId: string | null;
  /** The narrative's topic — the real headline, not `shotlist_<uuid>`. */
  topic: string | null;
  /** Pieces this job IS, in `VIDEO_PIECE_KINDS` order. Never `planned`. */
  made: VideoPieceKind[];
  /** Titles the spine gave each piece, so a card can use the real one. */
  titles: Partial<Record<VideoPieceKind, string>>;
  /** Pieces the whole narrative still has not got, each with a reason. */
  missing: MissingPiece[];
}

export interface SpineIndexOptions {
  /**
   * Brands with a row in `brand_canva_templates`.
   *
   * `undefined` means NOT KNOWN, and is different from an empty list. RLS on
   * `brand_canva_templates` grants `service_role` only — there is no policy for
   * `authenticated` — so a browser read comes back empty whether or not a
   * template is mapped. Treating that empty read as "nothing is mapped" would
   * print a confident falsehood on every card the moment a template WAS
   * mapped, and the owner would have no way to tell the claim was unfounded.
   * So the board passes `undefined` and the reason stays honest about not
   * knowing. (Measured 2026-08-06 with service credentials: the table really
   * is empty — but the CARD must not assert what it cannot see.)
   */
  canvaMappedBrands?: Iterable<string>;
}

function ordered(kinds: Iterable<VideoPieceKind>): VideoPieceKind[] {
  const have = new Set(kinds);
  return VIDEO_PIECE_KINDS.filter((k) => have.has(k));
}

/**
 * Why a piece does not exist, said so a human knows what to press.
 *
 * The three video pieces are produced by a reformat render, which costs money
 * and therefore stays behind the human "Make all formats" press — the spine
 * cron deliberately does the free half only. The Canva graphic additionally
 * needs a mapped brand template, and without one it cannot be made at any
 * price, so that gap names the mapping rather than the button.
 */
function reasonFor(kind: VideoPieceKind, brandHasCanva: boolean | null, brand: string): string {
  if (kind === "instagram") {
    if (brandHasCanva === null) {
      // Unknown, and said so. See SpineIndexOptions.canvaMappedBrands.
      return `Not made yet — press "Make all formats". If it reports no Canva template, map one for ${brand || "this brand"} in Marketing Agent → Canva Brand Templates.`;
    }
    return brandHasCanva
      ? 'Not made yet — press "Make all formats" on this video to build it from the brand template.'
      : `No Canva brand template is mapped for ${brand || "this brand"} — map one in Marketing Agent → Canva Brand Templates, then this becomes a real on-brand graphic.`;
  }
  const shape = kind === "youtube" ? "16:9" : "9:16";
  return `The cut is not ${shape} yet — press "Make all formats" on this video to queue the reformat (costs one render).`;
}

/**
 * Index the spine by render job.
 *
 * One pass over the artifacts, so the board can decorate 300 video rows without
 * a query per card.
 */
export function indexSpineByJob(
  artifacts: SpineArtifactRow[] | null | undefined,
  narratives: SpineNarrativeRow[] | null | undefined,
  opts: SpineIndexOptions = {},
): Map<string, JobSpine> {
  // null = the caller could not see the mapping table at all (the usual case
  // from the browser), which must not be reported as "nothing is mapped".
  const canvaMapped = opts.canvaMappedBrands === undefined ? null : new Set<string>();
  if (canvaMapped) {
    for (const b of opts.canvaMappedBrands || []) canvaMapped.add(String(b || "").trim().toLowerCase());
  }

  const topicById = new Map<string, string>();
  const brandById = new Map<string, string>();
  for (const n of narratives || []) {
    const id = String(n?.id || "").trim();
    if (!id) continue;
    topicById.set(id, String(n?.topic || "").trim());
    brandById.set(id, String(n?.brand || "").trim().toLowerCase());
  }

  // What each NARRATIVE has actually produced — the denominator for "missing".
  const madeByNarrative = new Map<string, Set<VideoPieceKind>>();
  // What each JOB is. A job can be two pieces at once (9:16 reuse).
  const byJob = new Map<string, { narrativeId: string; kinds: Set<VideoPieceKind>; titles: Partial<Record<VideoPieceKind, string>> }>();

  for (const a of artifacts || []) {
    const kind = String(a?.kind || "").trim();
    if (!PIECE_KIND_SET.has(kind)) continue;
    // A planned slot is an empty checklist line, not a piece. Counting it as
    // made would report a narrative complete while it produced nothing.
    if (String(a?.status || "").trim().toLowerCase() === PLANNED_STATUS) continue;
    const narrativeId = String(a?.narrative_id || "").trim();
    if (!narrativeId) continue;

    const k = kind as VideoPieceKind;
    if (!madeByNarrative.has(narrativeId)) madeByNarrative.set(narrativeId, new Set());
    madeByNarrative.get(narrativeId)!.add(k);

    // Only video-backed artifacts become video cards. The Canva graphic lives
    // in `agent_social_posts` and the board already renders that row itself —
    // claiming it here too would show the same graphic twice.
    if (String(a?.target_table || "").trim() !== "video_render_jobs") continue;
    const jobId = String(a?.target_id || "").trim();
    if (!jobId) continue;

    if (!byJob.has(jobId)) byJob.set(jobId, { narrativeId, kinds: new Set(), titles: {} });
    const entry = byJob.get(jobId)!;
    entry.kinds.add(k);
    const title = String(a?.title || "").trim();
    if (title) entry.titles[k] = title;
  }

  const out = new Map<string, JobSpine>();
  for (const [jobId, entry] of byJob) {
    const narrativeMade = madeByNarrative.get(entry.narrativeId) || new Set<VideoPieceKind>();
    const brand = brandById.get(entry.narrativeId) || "";
    const brandHasCanva = canvaMapped === null ? null : canvaMapped.has(brand);
    out.set(jobId, {
      narrativeId: entry.narrativeId,
      topic: topicById.get(entry.narrativeId) || null,
      made: ordered(entry.kinds),
      titles: entry.titles,
      missing: VIDEO_PIECE_KINDS.filter((k) => !narrativeMade.has(k)).map((kind) => ({
        kind,
        label: PIECE_LABEL[kind],
        reason: reasonFor(kind, brandHasCanva, brand),
      })),
    });
  }
  return out;
}

/**
 * One line for the card: what this story has produced, out of four.
 *
 * Leads with the count because "2 of 4" is the thing that was invisible — the
 * board showed one card and gave no way to tell whether that was everything.
 */
export function piecesSummary(spine: JobSpine | null | undefined): string {
  if (!spine) return "Not on the narrative spine yet.";
  const made = spine.made.length;
  const total = VIDEO_PIECE_KINDS.length;
  const missing = spine.missing.length;
  const head = `${made === 0 ? "No pieces" : made === 1 ? "1 piece" : `${made} pieces`} from this cut`;
  if (missing === 0) return `${head} · all ${total} formats made`;
  return `${head} · ${missing} of ${total} formats still missing`;
}
