/**
 * sourceFootage — "find me the video that fits this narrative", with an honest
 * answer within seconds.
 *
 * Owner, 2026-08-06: "it's gonna ask me to upload or I can choose for the AI to
 * source from Google Drive or source from past content or source from library.
 * I would then click for instance source from library and the AI gets to work
 * finding the video that'll fit the narrative. If it doesn't find it, it comes
 * back within seconds and says, upload a video."
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────
 * Every source returns one of exactly two things:
 *
 *   found    — a real clip, WITH the terms it matched on, so a human can see
 *              why this clip and disagree if it is wrong
 *   not_found — and the exact next step, in seconds, never a spinner
 *
 * "Within seconds" is a design constraint, not a nice-to-have. This does a
 * single indexed read per source and scores in memory with `pickFootage`. It
 * does not call a model, because a model call is the thing that turns a
 * two-second answer into a thirty-second one and buys nothing: the matching
 * signal is the TRANSCRIPT the parser already wrote and the tags already on the
 * row. The intelligence is in having transcribed everything, not in re-reading
 * it now.
 *
 * ── IT NEVER ATTACHES SOMETHING THAT DOES NOT FIT ──────────────────────────
 * `pickFootage` returns null rather than the nearest thing, and this preserves
 * that. Quietly attaching last week's reel because it was the closest match is
 * how a feed fills with footage that has nothing to do with the copy — and the
 * person approving it cannot tell, because the card looks complete.
 *
 * The scoring itself lives in `footageMatch.ts` and is locked by
 * `tests/footage-match.test.ts`; this module is the I/O half around it and is
 * exercised through the Content Director card rather than in isolation.
 */

import { supabase } from "@/integrations/supabase/client";
import { pickFootage, machineTagsOf, clipLabel, cuttableMedia, type FootageCandidate, type FootageMatch } from "./footageMatch";
import { toFetchableMediaUrl } from "./mediaLinks";

const db = supabase as any;

/** Where footage can come from. Named as the buttons the operator sees. */
export type FootageSource = "library" | "past_content" | "drive";

export const SOURCE_LABEL: Record<FootageSource, string> = {
  library: "Source from library",
  past_content: "Source from past content",
  drive: "Source from Google Drive",
};

export const SOURCE_BLURB: Record<FootageSource, string> = {
  library: "Raw footage and photos already ingested and transcribed.",
  past_content: "Finished cuts we have already made — reuse beats re-render.",
  drive: "Clips queued from Drive that the parser has transcribed.",
};

export interface SourceResult {
  status: "found" | "not_found";
  source: FootageSource;
  match?: FootageMatch;
  /** Why, in plain language. Always set — including on success. */
  message: string;
  /** How many candidates were actually searched — the honest denominator. */
  searched: number;
  /**
   * How many of those candidates carried a real transcript.
   *
   * The second honest denominator. "Searched 427 clips" and "searched 427
   * clips, 160 of which we have actually heard" are different claims, and the
   * gap between them is the part of the library that is still matched on its
   * filename alone.
   */
  withTranscript?: number;
  /**
   * Set when the transcript index could not be read.
   *
   * The search still runs — on filenames, tags and folder paths — because a
   * degraded search is worth more than an error. But it says so, because
   * "none is about this" means something very different when the transcripts
   * were not in the room.
   */
  transcriptWarning?: string;
}

/**
 * ── WHERE THE TRANSCRIPTS ACTUALLY LIVE ───────────────────────────────────
 *
 * NOT on the asset row. Measured on production 2026-08-07:
 *
 *   agent_media_assets.transcript   NULL on all 761 rows
 *   media_sources.transcript        281 real transcripts, 257 KB in total
 *
 * The parser writes the transcript to `media_sources` and the scored moments
 * to `content_moments`; `agent_media_assets` is the LIBRARY row and has always
 * been an empty column. So `candidateFromAsset` reading `a.transcript` meant
 * the single richest matching signal in the system — the thing this module's
 * own header calls the whole point ("the intelligence is in having transcribed
 * everything") — was never once seen by the matcher. Every search this module
 * has ever run was a search over filenames, tags and Drive folder paths.
 *
 * The join is the same three-rung ladder `asset-intelligence/index.ts` uses,
 * in the same order, because there is exactly one right answer to "which
 * media_sources row is this asset" and two implementations of it would drift:
 *
 *   1. media_sources.storage_url = agent_media_assets.storage_url   (261 rows)
 *   2. media_sources.filename    = agent_media_assets.original_filename
 *   3. media_sources.dedupe_key  = agent_media_assets.original_filename
 *
 * Two additions, both evidence-led rather than invented:
 *   • rungs 2–3 match case-INSENSITIVELY, because the parser lowercases
 *     `filename` (`dji_20260803143339_0751_d.mp4`) while the library keeps the
 *     camera's own casing (`DJI_20260803143339_0751_D.MP4`). It changes
 *     nothing today (261 either way) and can only ever add matches.
 *   • a fourth rung matches `dedupe_key` against the asset's storage_url,
 *     because for URL-ingested clips the parser writes the media URL into
 *     `dedupe_key` — Jackson's eight Dropbox rows are exactly this shape.
 */
export interface MediaSourceRow {
  storage_url?: string | null;
  filename?: string | null;
  dedupe_key?: string | null;
  transcript?: string | null;
  vehicles?: string[] | null;
  people?: string[] | null;
  brands?: string[] | null;
}

/** Lookup tables built once per search — never a query per row. */
export interface TranscriptIndex {
  byUrl: Map<string, string>;
  byName: Map<string, string>;
  byDedupe: Map<string, string>;
  /**
   * Parsed BEATS per storage_url — the only property that decides whether an
   * edit can be built at all. Populated for EVERY source row, including ones
   * with no transcript: b-roll carries moments without a word being spoken.
   */
  beatsByUrl: Map<string, number>;
  /** How many transcript-bearing rows went in. 0 means filenames-only matching. */
  size: number;
}

const EMPTY_INDEX: TranscriptIndex = {
  byUrl: new Map(), byName: new Map(), byDedupe: new Map(), beatsByUrl: new Map(), size: 0,
};

const key = (v: unknown) => String(v ?? "").trim().toLowerCase();

/**
 * Fold the transcript-bearing media_sources rows into three lookup maps.
 *
 * Pure — no I/O, no clock. The searchable text is the transcript plus the
 * entities the parser resolved from it (vehicles / people / brands), which
 * ride on the same row and therefore cost nothing extra to carry.
 */
export function buildTranscriptIndex(
  rows: MediaSourceRow[] | null | undefined,
  /** source id → parsed beat count, from `content_moments`. */
  beatsBySource?: Map<string, number> | null,
): TranscriptIndex {
  const idx: TranscriptIndex = {
    byUrl: new Map(), byName: new Map(), byDedupe: new Map(), beatsByUrl: new Map(), size: 0,
  };
  for (const r of rows || []) {
    // BEFORE the transcript gate below. A clip with beats and no transcript is
    // still editable — gating this on text would hide every b-roll clip from
    // the one signal that decides whether a cut is possible.
    const surl = String((r as Record<string, unknown>)?.storage_url ?? "").trim();
    if (surl) {
      const sid = String((r as Record<string, unknown>)?.id ?? "");
      idx.beatsByUrl.set(surl, (beatsBySource?.get(sid) ?? 0));
    }
    const text = [
      String(r?.transcript ?? "").trim(),
      (r?.vehicles || []).join(" "),
      (r?.people || []).join(" "),
      (r?.brands || []).join(" "),
    ].filter(Boolean).join(" ").trim();
    // A row with no transcript is not an index entry. Storing it would let a
    // later, richer row be shadowed by an empty one.
    if (!text) continue;
    idx.size++;
    if (r.storage_url) idx.byUrl.set(String(r.storage_url).trim(), text);
    if (r.filename) idx.byName.set(key(r.filename), text);
    if (r.dedupe_key) idx.byDedupe.set(key(r.dedupe_key), text);
  }
  return idx;
}

/** The transcript for one asset, walking the ladder. Empty string when none. */
export function transcriptForAsset(a: Record<string, any>, idx: TranscriptIndex): string {
  const url = String(a?.storage_url ?? "").trim();
  const name = key(a?.original_filename);
  return (
    (url ? idx.byUrl.get(url) : undefined) ??
    (name ? idx.byName.get(name) : undefined) ??
    (name ? idx.byDedupe.get(name) : undefined) ??
    (url ? idx.byDedupe.get(key(url)) : undefined) ??
    ""
  );
}

/**
 * Everything searchable about one media row.
 *
 * The field list is the REAL `agent_media_assets` schema. The first version of
 * this asked for `description`, `hook_score` and `source` — none of which are
 * columns on that table — so PostgREST rejected the whole query and BOTH the
 * library and Drive buttons failed on every press, silently, via the catch
 * below. Verified against the live schema on 2026-08-06.
 *
 * `original_filename`, `source_folder` and `content_category` are included
 * deliberately: they are the only signal for the ~two-thirds of the library
 * that nobody has ever spoken on camera.
 *
 * `a.transcript` stays in the text on purpose even though it is NULL on every
 * row today — the column exists, and if a future ingest path ever fills it the
 * matcher should read it rather than silently prefer the joined copy. The
 * joined transcript is what actually carries the signal.
 */
export function candidateFromAsset(
  a: Record<string, any>,
  idx: TranscriptIndex = EMPTY_INDEX,
): FootageCandidate {
  const joined = transcriptForAsset(a, idx);
  // A stored `drive.google.com/file/d/<id>/view` is a WEB PAGE — 139 video
  // rows are that shape. Handing one back as "the clip" gives the draft
  // something that cannot play. One converter, shared with the shot list.
  const link = toFetchableMediaUrl(a.storage_url);
  return {
    url: link.ok ? link.url : String(a.storage_url || ""),
    text: [
      a.title, a.original_filename, a.transcript, joined, a.source_folder,
      (a.tags || []).join(" "), a.content_type,
      // EVERY use, not just the label. A clip typed `documentary` that is also
      // an install has "install" in its haystack now, so an idea about
      // installing can reach it. Falls back to nothing extra on rows the
      // classify pass has not augmented yet, so no match is lost.
      (Array.isArray(a.content_types) ? a.content_types : []).join(" "),
      a.content_category,
      // WHAT THE VISION PASS SAW. Written on every parsed clip and, until
      // 2026-08-08, read by nothing — so selection could only ever match words
      // a person typed. Included in the haystack so a clip is findable by its
      // contents, and passed separately as `seenOnScreen` so the scorer can
      // weight a frame above a filename.
      machineTagsOf(a).join(" "),
    ].filter(Boolean).join(" "),
    createdAt: a.created_at ?? null,
    isFinishedCut: false,
    seenOnScreen: machineTagsOf(a),
    // Selection was blind to this and kept choosing clips the editor brain
    // then refused. See the tier in `scoreCandidate`.
    beatCount: idx.beatsByUrl.get(String(a.storage_url || "").trim()) ?? 0,
    brand: a.brand ?? null,
    // NOT `a.title || a.original_filename`. On 151 of the 427 video rows the
    // parser recorded the extracted audio track's name, so the label read
    // `…_reel.mp3` for a file that is `…_reel.mp4` — a real, highly editable
    // clip presented as if it were a song. See `clipLabel`'s header.
    label: clipLabel(a.title || a.original_filename, a.storage_url),
  };
}

/** The columns that actually exist on agent_media_assets. */
const ASSET_COLUMNS =
  "id, brand, title, original_filename, transcript, tags, content_type, content_types, content_category, visual_tags, storage_url, drive_file_id, source_folder, ingest_source, created_at";

/** The columns the join needs. Kept narrow — this read happens on every press. */
export const MEDIA_SOURCE_COLUMNS =
  "id, storage_url, filename, dedupe_key, transcript, vehicles, people, brands";

/**
 * ONE read, for the whole search.
 *
 * Not one per asset: 500 candidates would be 500 round trips and the module's
 * "within seconds" promise would be gone. Not an `.in(storage_url, [...500])`
 * either — PostgREST selects are GET requests, and 500 Dropbox URLs in a query
 * string is a 414 rather than a result.
 *
 * So it reads the transcript-bearing rows outright and joins in memory. That
 * is affordable because the whole corpus is small and bounded: 481
 * media_sources rows, 281 with a transcript, 257 KB of text in total
 * (measured 2026-08-07) — one small read whose cost does not grow with the
 * number of candidates being searched.
 *
 * Never throws. A failure here degrades the search to filenames-only and says
 * so; it does not turn a full library into "no footage".
 */
async function loadTranscriptIndex(): Promise<{ index: TranscriptIndex; warning?: string }> {
  try {
    // EVERY source row, not just transcript-bearing ones. The filter used to be
    // `.not("transcript","is",null)`, which was right when this index carried
    // only transcripts and wrong the moment it also carries BEATS: a b-roll
    // clip has moments and no speech, so filtering on transcript hid exactly
    // the clips a visual cut is built from. `media_sources` is hundreds of
    // rows, so reading all of them costs nothing.
    const [{ data, error }, { data: momentRows }] = await Promise.all([
      db.from("media_sources").select(MEDIA_SOURCE_COLUMNS).limit(5000),
      // The default PostgREST page is 1000 and there are ~11,675 moments live;
      // without an explicit ceiling most clips would report as beatless.
      db.from("content_moments").select("source_id").limit(100000),
    ]);
    if (error) {
      return {
        index: EMPTY_INDEX,
        warning: `Transcripts could not be read (${error.message}) — this searched filenames and tags only.`,
      };
    }
    const beatsBySource = new Map<string, number>();
    for (const m of (momentRows || []) as { source_id?: string }[]) {
      const id = String(m?.source_id || "");
      if (id) beatsBySource.set(id, (beatsBySource.get(id) || 0) + 1);
    }
    const index = buildTranscriptIndex(data as MediaSourceRow[], beatsBySource);
    if (!index.size) {
      return { index, warning: "No transcripts are indexed yet — this searched filenames and tags only." };
    }
    return { index };
  } catch (e) {
    return {
      index: EMPTY_INDEX,
      warning: `Transcripts could not be read (${e instanceof Error ? e.message : String(e)}) — this searched filenames and tags only.`,
    };
  }
}

function candidateFromRender(j: Record<string, any>): FootageCandidate {
  const bp = j.blueprint || {};
  return {
    url: String(j.final_url || ""),
    text: [bp.title, bp.topic, bp.caption, bp.hook, j.source_ref].filter(Boolean).join(" "),
    createdAt: j.created_at ?? null,
    isFinishedCut: true,
    brand: j.brand ?? null,
    label: bp.title || j.source_ref || null,
  };
}

/**
 * Find footage for one narrative from one source.
 *
 * `narrative` is the idea text — the Director card's copy, or the narrative
 * topic. The terms come from it, so a vague idea legitimately matches nothing,
 * and that is the correct answer rather than a random clip.
 */
export async function sourceFootageFor(
  narrative: string,
  brand: string,
  source: FootageSource,
  /**
   * Clips already chosen for THIS idea, so each channel gets a different one.
   *
   * `pickFootage` is deterministic and returns the single best match, so
   * without this every channel on one idea receives the identical clip —
   * eleven pieces built on one video, which is a cross-post wearing eleven
   * hats rather than a content set. Passing what is already taken makes each
   * pick reach for the next-best clip.
   */
  exclude: Iterable<string> = [],
): Promise<SourceResult> {
  const idea = String(narrative || "").trim();
  if (idea.length < 8) {
    return {
      status: "not_found", source, searched: 0,
      message: "This idea has no real copy yet — there is nothing to match footage against. Write the angle first.",
    };
  }

  let candidates: FootageCandidate[] = [];
  let withTranscript = 0;
  let transcriptWarning: string | undefined;

  try {
    if (source === "past_content") {
      // Finished cuts. Reuse beats re-render, and a finished cut is watchable.
      const { data } = await db
        .from("video_render_jobs")
        .select("id, brand, source_ref, blueprint, final_url, created_at")
        .eq("status", "complete")
        .not("final_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(300);
      candidates = (data || []).map(candidateFromRender);
    } else {
      // Library and Drive are the same table — Drive clips ARE library rows
      // once the parser has them. The distinction the operator cares about is
      // provenance, so it is filtered, not faked.
      let q = db
        .from("agent_media_assets")
        .select(ASSET_COLUMNS)
        .eq("asset_type", "video")
        .not("storage_url", "is", null)
        .order("created_at", { ascending: false })
        .limit(500);
      // DRIVE = a row that carries a Drive file id. The first version filtered
      // `source ilike '%drive%'` against a column that does not exist, which
      // failed the query outright rather than narrowing it. `drive_file_id` is
      // the real provenance marker — 43 rows carry one today.
      if (source === "drive") q = q.not("drive_file_id", "is", null);
      // Two reads, both fixed-cost: the assets, and the transcripts they join
      // to. Issued together rather than in sequence — the transcript read does
      // not depend on the asset read, and serialising them would spend a whole
      // round trip for nothing.
      const [assetRes, tx] = await Promise.all([q, loadTranscriptIndex()]);
      const { data, error: qErr } = assetRes as { data: any[] | null; error: any };
      // A query error is NOT "no footage". Saying so would send the operator
      // off to upload a video when the library is full and the read is broken.
      if (qErr) {
        return {
          status: "not_found", source, searched: 0,
          message: `Could not read the ${SOURCE_LABEL[source].toLowerCase()} — ${qErr.message}. This is a read failure, not an empty library.`,
        };
      }
      transcriptWarning = tx.warning;
      candidates = (data || []).map((a: Record<string, any>) => {
        if (transcriptForAsset(a, tx.index)) withTranscript++;
        return candidateFromAsset(a, tx.index);
      });
    }
  } catch (e) {
    return {
      status: "not_found", source, searched: 0,
      message: `Could not read the ${SOURCE_LABEL[source].toLowerCase()} — ${e instanceof Error ? e.message : String(e)}. Upload a video instead.`,
    };
  }

  // A url that is positively AUDIO can never become a cut, whatever the row is
  // typed as. `asset_type = 'video'` is already in the query and is correct on
  // production today (0 audio urls among 427 video rows) — this is the guard
  // for the day it is not, which CLAUDE.md records happening three times. It
  // reads the url, never the filename: 151 of those 427 rows carry an `.mp3`
  // NAME over an `.mp4` FILE, and refusing on the name would drop the most
  // editable clips in the library. See `cuttableMedia`.
  candidates = candidates.filter((c) => cuttableMedia(c.url));
  const taken = new Set<string>();
  for (const u of exclude) taken.add(String(u || "").trim());
  const match = pickFootage(idea, candidates, { brand, exclude: taken });

  // How much of what was searched we have actually HEARD. Appended to the miss
  // message because "none of 427 is about this" reads as a verdict on the
  // library, when the real state is "we have transcripts for 160 of them and
  // the rest were matched on their filename".
  const heard = source === "past_content"
    ? ""
    : transcriptWarning
      ? ` ${transcriptWarning}`
      : ` ${withTranscript} of them carry a transcript; the rest were matched on filename and tags only.`;

  if (!match) {
    return {
      status: "not_found", source, searched: candidates.length, withTranscript, transcriptWarning,
      // The exact sentence the owner asked for, plus the denominator so the
      // answer is checkable rather than a shrug.
      message: candidates.length === 0
        ? `Nothing in ${SOURCE_LABEL[source].toLowerCase().replace("source from ", "")} for ${brand} yet — upload a video.`
        // Naming the already-taken count matters: "searched 214, none is about
        // this" and "searched 214, but the 3 that matched are already used on
        // other channels" are different problems with different fixes, and a
        // single message for both would send someone filming when they only
        // needed a wider library.
        : taken.size
          ? `Searched ${candidates.length} clips — nothing left that is about this and not already used on another channel (${taken.size} taken).${heard} Upload a video, or reuse one deliberately.`
          : `Searched ${candidates.length} clips and none is about this.${heard} Upload a video.`,
    };
  }

  return {
    status: "found", source, match, searched: candidates.length, withTranscript, transcriptWarning,
    message: `Matched a ${match.isFinishedCut ? "finished cut" : "raw clip"}${match.label ? ` — ${match.label}` : ""} on: ${match.matchedOn.join(", ")}.`,
  };
}

/**
 * Try the sources in order and return the first real hit.
 *
 * Order is deliberate: a finished cut first (watchable, no render), then the
 * library, then Drive. Reports every source it tried, so "nothing found" names
 * what was actually searched instead of implying the whole world was.
 */
export async function sourceFootageAnywhere(
  narrative: string,
  brand: string,
  order: FootageSource[] = ["past_content", "library", "drive"],
): Promise<{ result: SourceResult; tried: SourceResult[] }> {
  const tried: SourceResult[] = [];
  for (const s of order) {
    const r = await sourceFootageFor(narrative, brand, s);
    tried.push(r);
    if (r.status === "found") return { result: r, tried };
  }
  const searched = tried.reduce((n, t) => n + t.searched, 0);
  return {
    result: {
      status: "not_found",
      source: order[order.length - 1],
      searched,
      message: searched === 0
        ? "There is no footage for this brand in any source yet — upload a video."
        : `Searched ${searched} clips across ${order.length} sources and none is about this. Upload a video.`,
    },
    tried,
  };
}
