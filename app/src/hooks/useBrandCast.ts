/**
 * useBrandCast — orchestration for BrandCast, the upload-first AI video
 * editor + multi-channel content creator ("upload the install, broadcast
 * everywhere").
 *
 * The flow (each stage rides the EXISTING pipeline, no new producers):
 *   1. UPLOAD    videos + photos → wrap-files storage + agent_media_assets,
 *                and each video queues a video_parse_jobs row (session-tagged)
 *                so the media-parser worker delivers transcripts + vision
 *                moments in the background.
 *   2. FAST CUT  instant deterministic cut from the uploads themselves
 *                (src/lib/brandcastPlanner) + AI captions (video-captions)
 *                + opt-in matched music (video-music) → video-render.
 *   3. STORY EDIT once parsed: recut from hook-scored content_moments —
 *                dead air is excluded by construction, natural audio kept.
 *   4. CONTENT PACK per selected ecosystem brand: OpenAI brain in
 *                video-captions {mode:"content_pack"} writes Blog, X,
 *                Substack, LinkedIn, IG, FB + YouTube metadata in the
 *                brand's voice, grounded in the real transcript.
 *
 * ── WHICH EDITOR CUTS IT (2026-08-06) ────────────────────────────────────────
 * THE SHOW DECIDES THE EDITOR. Pass `showFormat` (a key from `showFormats.ts`)
 * and `editorRouter.routeEditor` answers which of the two editors cuts the job,
 * with its reason — and REFUSES rather than cutting a show the footage cannot
 * carry. Nothing here picks an editor on its own.
 *
 *   • `behind_shop_doors` → MUSIC editor (`musicVideoEditor`), driven by
 *     `fastCut`. Below beat confidence it falls back to `planFastCutScenes`
 *     and flags `beatMatched:false` — that flag reaches the progress line, the
 *     result rows and `editorReport`, because a fallback nobody can see is a
 *     music editor that quietly is not one.
 *   • `behind_the_brand` → INTELLIGENCE editor (`editorCraft`), driven by
 *     `storyEdit`. Order: merge into beats → dedupe takes → `badTakes` →
 *     order/pace → the speech lock last (inside `paceScenes`).
 *
 * With NO show format the legacy paths run exactly as before (deterministic
 * Fast Cut; doc_edit brain → Story Edit planner). The old planners are kept on
 * purpose: they are the honest fallback, and every fallback is named.
 *
 * Captions and the hook overlay are timed against the OUTPUT timeline
 * (`outStart`/`outEnd`) via `buildCaptionTrack`'s `retimeToOutput` — never
 * source time, which lands cues on the wrong shot the moment beats move.
 *
 * ── TWO KINDS OF CAPTION, TWO DIFFERENT WIRES (2026-08-07) ───────────────────
 * They are not the same thing and neither replaces the other:
 *
 *   • SPEECH SUBTITLES — the words somebody actually said, verbatim, from the
 *     stored transcript. Built by `buildCaptionTrack` and carried on
 *     `blueprint.captionTrack`, which is the ONLY channel that survives the
 *     `video-render` edge function: it forwards `{blueprint, music_url,
 *     captions, brand, source_ref}` and there is no `caption_track` column on
 *     `video_render_jobs`, so the worker's `job.caption_track || bp.captionTrack`
 *     can only ever be satisfied by the blueprint half.
 *   • MARKETING COPY — written by `video-captions` (`fetchCaptions`), which is
 *     punch-up, not transcription. It rides the legacy `captions` body field
 *     (`job.captions`) exactly as it always has.
 *
 * THE SAME WORDS MUST NEVER GO DOWN BOTH WIRES. The worker draws `job.captions`
 * as drawtext AND `bp.captionTrack` as its own pass, so sending one cue set on
 * both stacks it on itself — the same defect `stripSceneHookText` exists to
 * prevent for the hook line. Speech cues therefore go to the blueprint and the
 * `captions` field is left empty; the AI writer is used only when NO spoken cue
 * survived, and then it is the only wire in play.
 *
 * ── THE EDITOR BRAIN IS REASONING, NOT TIMINGS ───────────────────────────────
 * On the intelligence path `editor-brain` is asked about each cut, and its
 * answer is persisted verbatim to `blueprint.editor_brain` — the key
 * `AdminBrandBoard` reads (`bp.editor_brain ?? bp.editorBrain`) before handing
 * it to `editorBrainAdapter` for `EditorBrainPanel`. The brain proposes an
 * ORDER; `editorCraft` re-roles, re-orders and re-paces it and
 * `enforceSpeechCraft` has the last word on bounds, so no brain response can
 * reach pixels unmediated and none can bypass the speech lock. A brain failure
 * never fails the cut — the cut is the deliverable and the reasoning is
 * commentary — but the failure IS recorded, because "the brain failed" and "the
 * brain was never run" are different situations with different next steps and
 * the panel renders them as different empty states.
 */
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { classifyAsset, resolveAssetType } from "@/lib/assetContentType";
import { musicPolicy, musicPolicyForClips, resolveAudioForCut } from "@/lib/musicPolicy";
import {
  planFastCutScenes,
  planStoryEditScenes,
  mergeMomentsIntoBeats,
  dedupeTakes,
  enforceSpeechCraft,
  type FastClip,
  type ParsedMoment,
  type PlannedScene,
} from "@/lib/brandcastPlanner";
import {
  applyTreatment,
  CAST_FORMATS,
  type BtiCredit,
  type CastFormat,
  type CastTreatment,
  type TreatmentScene,
} from "@/lib/castTreatments";
import { attachArtifact, fanOutPack, findOrCreateNarrative } from "@/lib/narrativeService";
import { kickParse } from "@/lib/kickParse";
// ── THE TWO EDITORS, and the router that chooses between them ────────────────
// The show decides the editor (showFormats.ts); the router turns that decision
// plus what the footage actually contains into a choice WITH ITS REASON, or a
// refusal. Nothing below ever picks an editor on its own.
import {
  footageFactsFrom,
  routeEditor,
  type EditorRoute,
  type DeclaredFacts,
} from "@/lib/editorRouter";
import { planCut, type EditOpts, type EditedScene, type IntelligentBeat } from "@/lib/editorCraft";
import { planMusicVideoScenes, type BeatGrid, type MusicClip, type MusicVideoCut } from "@/lib/musicVideoEditor";
import { cleanBeats, type BadTakeBeat } from "@/lib/badTakes";
import {
  buildCaptionTrack,
  type CaptionScene,
  type CaptionTrack,
  type CueGranularity,
  type TranscriptSegment,
} from "@/lib/captionTrack";
import { hookOverlayFilters, planHookOverlay, type HookOverlayPlan } from "@/lib/hookOverlay";
import type { ChannelKey } from "@/lib/contentDoctrine";

// ── formats ──────────────────────────────────────────────────────────────────
// Formats live in castTreatments.ts (pure, no Supabase import) so the
// treatment→format rules stay unit-testable. Re-exported so every existing
// `import { CAST_FORMATS } from "@/hooks/useBrandCast"` keeps working.
export { CAST_FORMATS };
export type { CastFormat };

// Footage longer than this unlocks the long-form option automatically.
export const LONGFORM_THRESHOLD_S = 240;

// ── ecosystem brands ─────────────────────────────────────────────────────────
export const CAST_BRANDS: Array<{ slug: string; label: string; site: string }> = [
  { slug: "weprintwraps", label: "WePrintWraps", site: "weprintwraps.com" },
  { slug: "restylepro", label: "DesignProAI", site: "restyleproai.com" },
  { slug: "designproai", label: "DesignProAI", site: "designproai.com" },
  { slug: "wraptvworld", label: "WrapTVWorld", site: "wraptvworld.com" },
  { slug: "inkandedge", label: "Ink & Edge Magazine", site: "inkandedgemagazine.com" },
  { slug: "creatormarket", label: "CreatorMarket", site: "restyleproai.com" },
];

// ── session ──────────────────────────────────────────────────────────────────
export interface CastUpload { base: string; url: string; kind: "video" | "image"; duration: number; name: string; contentType?: string | null; hasSpeech?: boolean }
export interface CastSession {
  /** Session tag — becomes tags[0] on parse jobs, so parsed media_sources are
   *  filename-prefixed `${tag}-…` and findable later. */
  tag: string;
  topic: string;
  uploads: CastUpload[];
  createdAt: string;
}

const SESSION_KEY = "brandcast_session";

function loadSession(): CastSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as CastSession) : null;
  } catch { return null; }
}

// ── content pack ─────────────────────────────────────────────────────────────
export interface BrandPack {
  brand: string;
  blog?: { title: string; body_markdown: string };
  x?: string;
  substack?: { subject: string; body_markdown: string };
  linkedin?: string;
  instagram?: string;
  facebook?: string;
  youtube?: { title: string; description: string; tags?: string[] };
  /** true when the OpenAI brain wrote it; false = deterministic fallback */
  ai: boolean;
}

export interface CastProgress { stage: string; detail: string; error?: string }

/** The ONE story the footage tells — extracted once, anchors every piece. */
export interface CoreStory {
  headline: string;
  hook: string;
  narrative: string;
  beats: string[];
  tension?: string;
  payoff: string;
  quotes?: string[];
  cta_angle?: string;
}

interface RendererCaption { text: string; time: number; duration: number; position?: "top" | "center" | "bottom" }

// ─── BEAT INTELLIGENCE — imported STRUCTURALLY, because it may not exist yet ──
//
// `src/lib/beatIntelligence.ts` attaches the asset parse's facts to beats so
// the intelligence editor cuts on CONTENT instead of its keyword fallback. It
// is being built in a parallel session, so a static `import` would fail the
// build until it lands. `import.meta.glob` resolves to an empty map when the
// file is absent and picks it up automatically the moment it exists — no
// second edit here, and no version of this file that only works one way.
//
// The JOIN (facts → beats) is deliberately NOT implemented here: whatever that
// module returns is passed straight to the editor. If its beats carry `facts`,
// the editor uses them; if they carry only an `intelligence` field it does not
// read, the editor falls back to language evidence and SAYS SO in its notes.
// Inventing the mapping here would be a second copy of a rule that has an
// owner.
type AttachIntelligence = (moments: ParsedMoment[], opts?: Record<string, unknown>) => IntelligentBeat[];
const BEAT_INTEL_MODULES = import.meta.glob("../lib/beatIntelligence.ts");

async function loadAttachIntelligence(): Promise<AttachIntelligence | null> {
  const load = BEAT_INTEL_MODULES["../lib/beatIntelligence.ts"];
  if (!load) return null;
  try {
    const mod = (await load()) as { attachIntelligence?: unknown };
    return typeof mod?.attachIntelligence === "function" ? (mod.attachIntelligence as AttachIntelligence) : null;
  } catch { return null; }
}

// ─── What the editors report back ────────────────────────────────────────────

/**
 * What the editor brain said about ONE cut — the inspectable summary.
 *
 * The VERBATIM response goes on the blueprint (`editor_brain`); this is the
 * same answer counted, so BrandCast's own panel can show it without refetching
 * a render row. Nothing here is flattened to a boolean: `refusals` keep their
 * `{what, why}` pairs and `notes` keep the function's own sentences, because a
 * refusal reduced to a count is a refusal nobody can act on.
 */
export interface CastBrainReport {
  /**
   * Did a response come back AT ALL? This is the field that separates "the
   * brain failed" from "the brain was never run" — the panel renders those as
   * two different empty states with two different next steps, and collapsing
   * them sends someone to fix the wrong thing.
   */
  answered: boolean;
  /** The function's own `ok`. False = the read broke; the cut still shipped. */
  ok: boolean;
  /** "cut" | "mismatch" | "refused" as the function said it. Null = no answer. */
  verdict: string | null;
  model?: string | null;
  decisions: number;
  cuts: number;
  hooks: number;
  tips: number;
  overrides: number;
  /** Refused REFERENCES, verbatim — an angle the footage does not carry, a beat that was never supplied. */
  refusals: Array<{ what: string; why: string }>;
  /** The function's own notes, verbatim. */
  notes: string[];
  /** Set when the call failed or the function refused. */
  error?: string | null;
  remedy?: string | null;
  /**
   * What actually happened to the brain's handoff. `applied` is a sentence, not
   * a flag: the honest answer is always partial, because `editorCraft` re-roles
   * and re-orders on top of whatever order arrives here.
   */
  handoff: {
    /** Beats in the brain's chosen order, as it returned them. */
    ordered: number;
    /** How many of those were matched back to a real beat and moved. */
    matched: number;
    /** Beats the brain never ordered — kept, never deleted (see `applyBrainOrder`). */
    unordered: number;
    /** Roles the brain assigned. Recorded; see `applied` for whether they reached the cut. */
    roles: number;
    applied: string;
  };
}

/** One format's cut, and everything about it a human might dispute. */
export interface CastFormatReport {
  format: CastFormat;
  /** Which editor actually cut it — including the legacy planners, by name. */
  editor: "intelligence" | "music" | "legacy_fast_cut" | "legacy_story_edit" | "doc_edit_brain";
  scenes: number;
  /**
   * MUSIC EDITOR ONLY. False means the cut is arithmetic, not beat-driven —
   * a music editor that quietly is not one. Never flattened away.
   */
  beatMatched?: boolean;
  fallback?: MusicVideoCut["fallback"];
  bpm?: number;
  confidence?: number;
  actionMatched?: number;
  captions: {
    source: "transcript" | "ai" | "none";
    /**
     * WHICH WIRE the renderer will read them off. Two different channels carry
     * two different things (see the header), and a report that says "24 cues"
     * without saying where they went cannot be checked against a render.
     */
    channel: "blueprint.captionTrack" | "job.captions" | "none";
    cues: number;
    dropped: number;
    /** Why there are no cues, when there are none. */
    reason: string | null;
    /**
     * What timing the transcript actually carried. "segment" means every cue
     * boundary INSIDE a segment was interpolated — true for every clip parsed
     * before word timings were turned on, which is all of them today. Surfaced
     * rather than hidden: interpolated timing is still honest timing, but only
     * if it says it is interpolated.
     */
    granularity?: CueGranularity;
    /** How many cues carry an interpolated boundary. The cost of `granularity`. */
    estimated?: number;
    /** Which representation the producer recommends the worker draw. */
    representation?: "ass" | "drawtext";
    representationReason?: string;
  };
  /** Planned against the OUTPUT timeline. See `hookOverlayRendered` below. */
  hookOverlay?: Pick<HookOverlayPlan, "rendered" | "reason" | "start" | "end" | "region" | "text" | "landsInWindow">;
  /**
   * INTELLIGENCE PATH ONLY. Absent means the brain was never asked about this
   * cut — which is a different thing from `answered: false`, and the panel that
   * reads the blueprint draws exactly that distinction.
   */
  editorBrain?: CastBrainReport;
  notes: string[];
}

export interface CastEditorReport {
  route: EditorRoute;
  formats: CastFormatReport[];
  /** badTakes' paperwork for the run — what was cut out of the speech, and why. */
  badTakes?: { removedSeconds: number; dropped: number; refused: number; notes: string[] };
  /** Was the beat-intelligence join available for this run? */
  intelligence: { available: boolean; note: string };
  /**
   * Does the renderer actually burn the planned overlay?
   *
   * This was hardcoded `false` with a comment reading "grep it, there is no
   * `hookOverlay` in the worker". That was TRUE when it was written and FALSE
   * an hour later — the worker's consumer landed in between (it reads
   * `bp.hookOverlay` and draws it in the post-concat pass). Two halves of one
   * feature were built in parallel against each other's absence.
   *
   * The consequence was live for exactly as long as both halves existed: the
   * hook line was passed to the planner as scene-0 `text` AND emitted as an
   * overlay, so it would have been drawn TWICE, stacked. Nothing would have
   * failed; the cut would just have looked wrong, and only to someone watching
   * it. See `stripSceneHookText` below for the fix.
   *
   * It is a real boolean now rather than a literal, because a hardcoded answer
   * to "is the other half wired yet" is a fact with an expiry date.
   */
  hookOverlayRendered: boolean;
}

/**
 * THE HOOK LINE MUST BE DRAWN ONCE.
 *
 * Both planners take `hookText` and stamp it on scene 0 as burned-in drawtext —
 * that is how the hook was shown before `hookOverlay.ts` existed, and it is
 * still the right behaviour when no overlay is planned. When an overlay IS
 * going to be drawn, that scene-level copy has to go, or the same words are
 * rendered twice in the same corner of the frame.
 *
 * Stripped AFTER planning rather than by withholding `hookText` beforehand,
 * because whether an overlay renders is only knowable once the scenes exist —
 * `planHookOverlay` needs the output timeline to decide. Withholding it up
 * front would mean a cut whose overlay was ultimately refused (no hook line,
 * outside the channel's window, nowhere to sit) would end up showing no hook
 * at all, which is the worse failure of the two.
 */
function stripSceneHookText<T extends { text?: string; textPosition?: unknown }>(scenes: T[]): T[] {
  return scenes.map((s) => {
    if (!s.text) return s;
    const { text: _t, textPosition: _p, ...rest } = s;
    return rest as T;
  });
}

/**
 * The channel a format publishes to — the format's own declared platform, which
 * is already a `ChannelKey`. The one adjustment: a YouTube SHORT is not a
 * YouTube video as far as a hook window is concerned, and the doctrine has a
 * separate channel for it.
 */
function channelForFormat(format: CastFormat): ChannelKey {
  if (format === "short") return "youtube_short";
  return CAST_FORMATS[format].platform as ChannelKey;
}

/** Parsed moments → the beat shape `badTakes` cleans. */
function momentsToBadTakeBeats(moments: ParsedMoment[]): BadTakeBeat[] {
  return moments.map((m, i) => ({
    id: `${m.sourceId}_${i}`,
    sourceId: m.sourceId,
    start: m.start,
    end: m.end,
    text: m.quote,
  }));
}

/**
 * Cleaned beats → moments the editor can order.
 *
 * A dropped beat is gone (that removal IS applied). An intra-beat removal is
 * NOT: a scene is one contiguous `start`/`end` pair, so a beat that survives in
 * two pieces cannot be represented without inventing a second scene the editor
 * never planned. Those beats are kept WHOLE and the gap is reported — the
 * alternative is silently deleting the middle of somebody's sentence, which is
 * the exact failure `badTakes`' own guards exist to prevent.
 *
 * In production today this is theoretical: Whisper is called without word
 * timings, so `badTakes` only ever removes whole beats and every kept range is
 * the beat itself.
 */
function cleanedToMoments(
  cleaned: Array<{ sourceId?: string; start: number; end: number; text?: string; keptRanges: Array<{ start: number; end: number }> }>,
  original: ParsedMoment[],
): { moments: ParsedMoment[]; notes: string[] } {
  const byKey = new Map(original.map((m) => [`${m.sourceId}|${m.start}|${m.end}`, m]));
  const notes: string[] = [];
  let split = 0;
  const moments = cleaned.map((b) => {
    const src = byKey.get(`${b.sourceId}|${b.start}|${b.end}`);
    const ranges = b.keptRanges?.length ? b.keptRanges : [{ start: b.start, end: b.end }];
    if (ranges.length > 1) split++;
    return {
      clipUrl: src?.clipUrl || "",
      sourceId: String(b.sourceId || src?.sourceId || ""),
      // Whole beat when it survives in pieces — see the note above.
      start: ranges.length > 1 ? b.start : ranges[0].start,
      end: ranges.length > 1 ? b.end : ranges[ranges.length - 1].end,
      hookScore: src?.hookScore ?? 0,
      quote: b.text ?? src?.quote,
    } as ParsedMoment;
  }).filter((m) => m.clipUrl);
  if (split) {
    notes.push(
      `${split} beat(s) had intra-beat removals that a single scene cannot carry — kept WHOLE rather than ` +
      "cutting the middle out of a sentence. Representing those needs a multi-range scene in the renderer.",
    );
  }
  return { moments, notes };
}

/**
 * The frame the worker will ACTUALLY render at, per aspect ratio.
 *
 * Mirrors `worker/video-renderer`'s `ASPECT_DIMS`. The caption producer needs
 * real pixels, not a ratio: `captionFilters` derives the line-wrap width from
 * `frameW` and stamps `PlayResX/PlayResY` into the ASS header, and libass
 * scales the whole style block off that. Getting it wrong does not fail — it
 * silently draws captions at the wrong size, which is worse.
 *
 * Safe to derive from `CAST_FORMATS[format].aspectRatio` because the worker's
 * `resolveAspect` only overrides an aspect that CONTRADICTS the blueprint's
 * format, and every format here declares the aspect its own name implies.
 */
const FRAME_FOR_ASPECT: Record<string, [number, number]> = {
  "9:16": [1080, 1920],
  "16:9": [1920, 1080],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};

/** Parsed moments → the timed segments the caption builder groups from. */
function captionSegmentsFrom(moments: ParsedMoment[]): TranscriptSegment[] {
  return moments
    .filter((m) => m.quote?.trim())
    .map((m) => ({ start: m.start, end: m.end, text: m.quote, source_id: m.sourceId }));
}

/**
 * Output-timed cues → the renderer's caption shape.
 *
 * `outStart`/`outEnd` are positions in the FINISHED cut. The renderer's `time`
 * is also finished-cut time, so this is a rename, not a conversion — and that
 * is the whole point: `buildCaptionTrack` ran `retimeToOutput` internally, so
 * no source timestamp reaches the renderer. A cue timed against source time
 * lands over the wrong shot the moment the editor rearranges a beat, and it
 * reads as a caption bug rather than an ordering one.
 */
function cuesToRendererCaptions(cues: Array<{ text: string; outStart: number; outEnd: number }>): RendererCaption[] {
  return cues.map((c) => ({
    text: c.text,
    time: c.outStart,
    duration: Math.max(0.3, c.outEnd - c.outStart),
    position: "center" as const,
  }));
}

/** Scenes as the caption + hook planners read them: the OUTPUT clock. */
function toCaptionScenes(scenes: Array<EditedScene | (PlannedScene & { outStart?: number; outEnd?: number })>): CaptionScene[] {
  return scenes.map((s: any) => ({
    sourceStart: Number(s.sourceStart ?? s.start) || 0,
    sourceEnd: Number(s.sourceEnd ?? s.end) || 0,
    outStart: Number(s.outStart) || 0,
    outEnd: Number(s.outEnd) || 0,
    clipId: s.clipId,
    sourceId: s.clipId,
    sceneId: s.sceneId,
    role: s.role,
  }));
}

// ═══ THE EDITOR BRAIN ════════════════════════════════════════════════════════
//
// `supabase/functions/editor-brain` is deployed and active and, until now, had
// no caller anywhere in `src/`, `api/` or `worker/` — which is why
// `EditorBrainPanel` correctly reported "the editor brain has never been run on
// this cut" for every cut ever made. This is the caller.
//
// THREE RULES GOVERN EVERYTHING BELOW:
//
//  1. THE BRAIN DECIDES; THE CRAFT LAYER ENFORCES. Its answer is an ORDER and a
//     set of roles, never timings. `editorCraft.planCut` re-roles, re-orders and
//     re-paces whatever arrives, and `enforceSpeechCraft` (inside `paceScenes`)
//     has the last word on bounds. The function's own handoff note says the same
//     thing. Nothing here lets a model bound reach a scene.
//  2. A BRAIN FAILURE MUST NOT FAIL THE CUT. The cut is the deliverable; the
//     reasoning is commentary. But the failure is RECORDED, because the panel
//     draws "failed" and "never run" as different empty states — one is an
//     outage, the other is a wiring gap, and they have different next steps.
//  3. NOTHING IS INVENTED TO COVER A GAP. A refusal keeps its own words, a
//     mismatch stays a mismatch, and a call that returned nothing says so.

/** Beat ids we mint, so the answer can be mapped back to the beat it names. */
const brainBeatId = (i: number) => `b${i}`;

/**
 * Beats in the shape `editor-brain.normalizeBeats` accepts.
 *
 * `id` is supplied deliberately: without one the function assigns its own, and
 * then `decisions[].beatId` cannot be resolved back to the beat object here —
 * only to a position, which stops being a position the moment the cap drops a
 * beat. A stable handle is the whole reason the function accepts one.
 */
function brainBeatsFrom(beats: IntelligentBeat[]) {
  return beats.map((b, i) => ({
    id: brainBeatId(i),
    sourceId: b.sourceId,
    clipUrl: b.clipUrl,
    start: b.start,
    end: b.end,
    hookScore: b.hookScore,
    ...(b.quote ? { quote: b.quote } : {}),
    ...((b as ParsedMoment & { visual?: string }).visual
      ? { visual: (b as ParsedMoment & { visual?: string }).visual }
      : {}),
  }));
}

interface BrainCall {
  /**
   * EXACTLY what the function returned, or an honest failure envelope when
   * nothing came back. This is what gets persisted to `blueprint.editor_brain`
   * — the raw response, not a summary, because `editorBrainAdapter` is the one
   * sanctioned translation and re-deriving it here would be a second copy.
   */
  raw: Record<string, unknown>;
  report: CastBrainReport;
  /** Beat ids in the brain's chosen order. Empty when it did not give one. */
  order: string[];
  /** beatId → role, as the function's `handoff.roles` gave them. */
  roles: Record<string, string>;
  /** Anything a human should read about this call, in sentences. */
  notes: string[];
}

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);

/**
 * Ask the editor brain about one cut.
 *
 * Never throws. A transport failure, a non-2xx refusal and an empty body all
 * resolve to a `raw` envelope carrying `ok: false` and the reason — which
 * `editorBrainAdapter.panelStatusFor` maps to the panel's "failed" state, so a
 * broken read is never displayed as an edit made without reasoning.
 */
async function runEditorBrain(args: {
  beats: IntelligentBeat[];
  topic: string;
  brand: string;
  channel: ChannelKey;
  contentType?: string | null;
  targetDuration: number;
  maxScenes: number;
  transcript: string;
}): Promise<BrainCall> {
  const notes: string[] = [];
  let res: Record<string, unknown> | null = null;
  let callError: string | null = null;

  try {
    const { data, error } = await supabase.functions.invoke("editor-brain", {
      body: {
        beats: brainBeatsFrom(args.beats),
        // The angle the operator actually asked for. Passing it ARMS the
        // function's mismatch gate (an empty angle is "supported" by
        // definition, so withholding it would disable the one check that
        // catches a cut being made about something the footage does not show).
        angle: args.topic,
        brand: args.brand,
        channel: args.channel,
        ...(args.contentType ? { content_type: args.contentType } : {}),
        target_duration: args.targetDuration,
        max_scenes: args.maxScenes,
        transcript: args.transcript.slice(0, 8000),
      },
    });
    if (error) {
      callError = error.message || String(error);
      // A refusal comes back as a non-2xx with a JSON body carrying `error`,
      // `remedy` and `notes`. supabase-js surfaces only "non-2xx status code"
      // unless the Response is read off the error, and losing the remedy turns
      // an actionable refusal into a shrug.
      try {
        const ctx = (error as { context?: Response }).context;
        const body = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
        if (body && typeof body === "object") res = body as Record<string, unknown>;
      } catch { /* the transport message is all there is */ }
    } else if (!data || typeof data !== "object") {
      callError = "editor-brain returned no body";
    } else {
      res = data as Record<string, unknown>;
    }
  } catch (e: unknown) {
    callError = (e as Error)?.message || String(e);
  }

  if (!res) {
    const why = callError || "editor-brain returned nothing";
    notes.push(
      `EDITOR BRAIN: the call FAILED (${why}). The cut was made and rendered anyway — the brain explains an ` +
      "edit, it does not make one — but this cut carries no reasoning. Re-run the brain on it.",
    );
    return {
      // Only two things are asserted here and both are facts about THIS call:
      // it did not succeed, and this is the error it failed with. No verdict is
      // invented — `ok: false` alone is what the adapter reads as "failed".
      raw: { ok: false, error: why, notes: [...notes] },
      report: {
        answered: false, ok: false, verdict: null,
        decisions: 0, cuts: 0, hooks: 0, tips: 0, overrides: 0,
        refusals: [], notes: [...notes], error: why,
        handoff: { ordered: 0, matched: 0, unordered: args.beats.length, roles: 0, applied: "Nothing — no answer came back." },
      },
      order: [],
      roles: {},
    };
  }

  const decisions = Array.isArray(res.decisions) ? (res.decisions as Array<Record<string, unknown>>) : [];
  const handoff = (res.handoff && typeof res.handoff === "object" ? res.handoff : {}) as Record<string, unknown>;
  const handoffBeats = Array.isArray(handoff.beats) ? handoff.beats : [];
  const roles: Record<string, string> = {};
  if (handoff.roles && typeof handoff.roles === "object" && !Array.isArray(handoff.roles)) {
    for (const [k, v] of Object.entries(handoff.roles as Record<string, unknown>)) {
      const role = String(v ?? "").trim();
      if (role) roles[k] = role;
    }
  }

  // THE ORDER COMES FROM `decisions`, CHECKED AGAINST `handoff.beats`.
  // `handoff.beats` IS the chosen order, but it is `decisions.map(...)` with the
  // ids stripped, so it cannot be matched back to a beat on its own. The two are
  // the same list, so `decisions[i].beatId` names `handoff.beats[i]` — and if
  // the lengths ever disagree that assumption has broken, so nothing is
  // reordered and the disagreement is reported rather than papered over.
  let order: string[] = [];
  if (decisions.length && handoffBeats.length === decisions.length) {
    order = decisions.map((d) => String(d?.beatId ?? "").trim()).filter(Boolean);
  } else if (decisions.length) {
    notes.push(
      `EDITOR BRAIN: it returned ${decisions.length} decision(s) but ${handoffBeats.length} handoff beat(s). ` +
      "Those two are supposed to be the same list, so its order was NOT applied — the cut is the craft layer's own.",
    );
  }

  const verdict = typeof res.verdict === "string" ? res.verdict : null;
  const fnNotes = strList(res.notes);
  const refusals = (Array.isArray(res.refusals) ? res.refusals : [])
    .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
    .map((r) => ({ what: String(r.what ?? "").trim(), why: String(r.why ?? "").trim() }));

  if (verdict === "mismatch") {
    notes.push(
      `EDITOR BRAIN: MISMATCH — it refused to reason about "${args.topic}" because this footage does not carry ` +
      `that angle${refusals[0]?.why ? ` (${refusals[0].why})` : ""}. The cut was still made; judge it against what ` +
      "the footage actually shows, not against the topic.",
    );
  } else if (verdict === "refused") {
    notes.push(
      `EDITOR BRAIN: REFUSED — ${String(res.error ?? "").trim() || "it produced no usable decision"}. ` +
      "Nothing was invented to fill the gap; this cut is unexplained.",
    );
  } else if (res.ok === false) {
    notes.push(
      `EDITOR BRAIN: the function answered but reported a failure (${String(res.error ?? "no error text").trim()}). ` +
      "The cut shipped; the reasoning did not.",
    );
  }

  return {
    raw: res,
    report: {
      answered: true,
      ok: res.ok === true,
      verdict,
      model: (res.model as string | null) ?? null,
      decisions: decisions.length,
      cuts: countOf(res.cuts),
      hooks: countOf(res.hooks),
      tips: countOf(res.tips),
      overrides: countOf(res.overrides),
      refusals,
      notes: fnNotes,
      error: (res.error as string | null) ?? null,
      remedy: (res.remedy as string | null) ?? null,
      handoff: {
        ordered: order.length,
        matched: 0,           // filled in by applyBrainOrder — nothing has moved yet
        unordered: args.beats.length,
        roles: Object.keys(roles).length,
        applied: "not applied yet",
      },
    },
    order,
    roles,
    notes,
  };
}

/**
 * Put the beats in the brain's chosen order — and NOTHING else.
 *
 * A beat the brain did not order is KEPT, appended in its original order. The
 * brain's `cuts[]` is a proposal, and deleting footage on the strength of it
 * would let one model response silently shrink the pool the craft layer selects
 * from — including on a response that hallucinated. Selection stays with
 * `editorCraft`; this only changes what it sees first.
 *
 * Pure: no clock, no network, no mutation of the input array.
 */
function applyBrainOrder(
  beats: IntelligentBeat[],
  order: string[],
): { beats: IntelligentBeat[]; matched: number; unordered: number } {
  if (!order.length) return { beats, matched: 0, unordered: beats.length };
  const byId = new Map<string, IntelligentBeat>();
  beats.forEach((b, i) => byId.set(brainBeatId(i), b));
  const taken = new Set<string>();
  const ordered: IntelligentBeat[] = [];
  for (const id of order) {
    const beat = byId.get(id);
    if (!beat || taken.has(id)) continue;
    taken.add(id);
    ordered.push(beat);
  }
  const rest = beats.filter((_, i) => !taken.has(brainBeatId(i)));
  return { beats: [...ordered, ...rest], matched: ordered.length, unordered: rest.length };
}

// Probe a local file's real duration in the browser — no server round-trip.
function probeDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (n: number) => { if (!done) { done = true; URL.revokeObjectURL(url); resolve(n); } };
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => finish(0);
    setTimeout(() => finish(0), 8000);
    v.src = url;
  });
}

const IS_VIDEO = /\.(mp4|mov|webm|m4v|avi|mts)$/i;
const IS_IMAGE = /\.(jpe?g|png|webp|gif|heic)$/i;

// Probe a REMOTE clip's duration (library items already sit in storage) —
// metadata-only load, no CORS requirement for duration.
function probeRemoteDuration(url: string): Promise<number> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (n: number) => { if (!done) { done = true; v.src = ""; resolve(n); } };
    const v = document.createElement("video");
    v.preload = "metadata";
    v.onloadedmetadata = () => finish(Number.isFinite(v.duration) ? v.duration : 0);
    v.onerror = () => finish(0);
    setTimeout(() => finish(0), 8000);
    v.src = url;
  });
}

/** A pickable clip-library row (agent_media_assets with a hydrated URL). */
export interface LibraryPick { id: string; url: string; name: string; kind: "video" | "image"; contentType?: string | null; thumbnailUrl?: string | null; driveFileId?: string | null; assetType?: string | null; hasSpeech?: boolean }

async function fetchCaptions(topic: string, hook: string, cta: string, duration: number, style: string): Promise<RendererCaption[]> {
  try {
    const { data } = await supabase.functions.invoke("video-captions", {
      body: { prompt: `${topic}. Hook: ${hook}. CTA: ${cta}`, concept: topic, hook, cta, duration: Math.round(duration), style },
    });
    return (data?.captions || []).map((c: any) => ({
      text: `${c.emoji ? c.emoji + " " : ""}${c.text}`,
      time: Number(c.start || 0),
      duration: Math.max(0.8, Number(c.end || 0) - Number(c.start || 0)),
      position: "center" as const,
    }));
  } catch { return []; } // captions are additive — never block the build
}

export function useBrandCast() {
  const [session, setSession] = useState<CastSession | null>(() => loadSession());
  const [progress, setProgress] = useState<CastProgress>({ stage: "idle", detail: "" });
  const [busy, setBusy] = useState(false);
  // The editor choice and its reason, kept as state so the panel can render it
  // — reasons, overrides and refusals, not a boolean. Set on every cut, and
  // available before one via `previewRoute`.
  const [route, setRoute] = useState<EditorRoute | null>(null);
  const [editorReport, setEditorReport] = useState<CastEditorReport | null>(null);

  useEffect(() => {
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch { /* storage full/blocked — session just won't survive reload */ }
  }, [session]);

  // ── 1. UPLOAD + PARSE-ENQUEUE ─────────────────────────────────────────────
  const uploadFootage = useCallback(async (files: File[], topic: string, brand: string) => {
    const tag = session?.tag || `brandcast-${Date.now().toString(36)}`;
    const uploads: CastUpload[] = [...(session?.uploads || [])];
    let n = 0;
    for (const file of files) {
      // `kind` is the CUT-TIMELINE concept (moving footage vs a still) and is
      // not the library's `asset_type`. Keeping them separate matters: this
      // ladder ended `: "image"`, so an mp3 dropped here was registered in the
      // library as an IMAGE — and `image` is SILENTLY excluded from the Clip
      // Library query, so the track did not show up wrong, it vanished. That
      // is the documented three-time song-catalogue bug, live in this file.
      // The library row is typed by the ONE resolver below; `kind` still
      // decides only what the timeline does with it.
      const kind: CastUpload["kind"] = IS_VIDEO.test(file.name) ? "video"
        : IS_IMAGE.test(file.name) ? "image"
        : file.type.startsWith("video/") ? "video" : "image";
      const { assetType } = resolveAssetType({ filename: file.name, mimeType: file.type });
      n++;
      setProgress({ stage: "upload", detail: `Uploading ${n}/${files.length} — ${file.name}` });
      const duration = kind === "video" ? await probeDuration(file) : 0;
      const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      const base = safe.replace(/\.[^.]+$/, "");
      const path = `content-uploads/${tag}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upErr) throw new Error(`upload failed for ${file.name}: ${upErr.message}`);
      const { data: urlData } = supabase.storage.from("wrap-files").getPublicUrl(path);
      const url = urlData.publicUrl;

      // Register in the clip library (same shape as VideoStudio's uploader).
      await (supabase as any).from("agent_media_assets").insert({
        asset_type: assetType,
        storage_url: url,
        title: base.replace(/-/g, " "),
        original_filename: file.name,
        source_folder: "brandcast",
        file_size_bytes: file.size,
        brand,
        tags: [tag, "brandcast"],
      });

      // Background enrichment: the media-parser worker transcribes + vision-
      // scores each VIDEO into media_sources/content_moments. tags[0] = the
      // session tag → parsed sources are filename-prefixed `${tag}-…`.
      if (kind === "video") {
        await (supabase as any).from("video_parse_jobs").insert({
          kind: "url", media_url: url, filename: safe, tags: [tag, "brandcast"],
        });
      }
      uploads.push({
        base, url, kind, duration, name: file.name,
        // Classify with the ONE classifier so the music rule can see what this
        // footage IS (documentary/UGC keep their own sound).
        contentType: classifyAsset({ filename: file.name, kind: kind === "image" ? "image" : "video" }).type,
      });
    }
    const next: CastSession = { tag, topic, uploads, createdAt: session?.createdAt || new Date().toISOString() };
    setSession(next);
    const kick = await kickParse();
    setProgress({
      stage: "uploaded",
      detail: `${uploads.length} file(s) staged — ${kick.kicked ? "parsing now" : "parse queued for the next scheduled run"}`,
    });
    return next;
  }, [session]);

  // ── 1b. PICK FROM LIBRARY — pull existing clip-library assets into the
  // session (no re-upload; they already live in storage). Videos still queue
  // a session-tagged parse job so Story Edit + the core story can use them.
  const addFromLibrary = useCallback(async (picks: LibraryPick[], topic: string) => {
    if (!picks.length) return session;
    const tag = session?.tag || `brandcast-${Date.now().toString(36)}`;
    const uploads: CastUpload[] = [...(session?.uploads || [])];
    const have = new Set(uploads.map((u) => u.url));
    let n = 0;
    for (const pick of picks) {
      if (have.has(pick.url)) continue;
      n++;
      setProgress({ stage: "upload", detail: `Adding from library ${n}/${picks.length} — ${pick.name}` });
      const duration = pick.kind === "video" ? await probeRemoteDuration(pick.url) : 0;
      const base = pick.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
      if (pick.kind === "video") {
        await (supabase as any).from("video_parse_jobs").insert({
          kind: "url", media_url: pick.url,
          filename: `${base}.mp4`, tags: [tag, "brandcast", "library"],
        });
      }
      uploads.push({ base, url: pick.url, kind: pick.kind, duration, name: pick.name, contentType: pick.contentType ?? null, hasSpeech: pick.hasSpeech ?? false });
    }
    const next: CastSession = { tag, topic, uploads, createdAt: session?.createdAt || new Date().toISOString() };
    setSession(next);
    // Start the parser rather than filing a row and waiting on cron. One kick
    // drains the whole queue, so it is called once per batch, not per file.
    const kick = await kickParse();
    setProgress({
      stage: "uploaded",
      detail: `${uploads.length} file(s) in the session — ${kick.kicked ? "parsing now" : "parse queued for the next scheduled run"}`,
    });
    return next;
  }, [session]);

  const clearSession = useCallback(() => {
    setSession(null);
    setProgress({ stage: "idle", detail: "" });
    setRoute(null);
    setEditorReport(null);
  }, []);

  // ── WHICH EDITOR CUTS THIS ────────────────────────────────────────────────
  // The UI asks this to SHOW the choice before cutting; the two cut functions
  // below ask the identical question to ROUTE it. One implementation, so the
  // preview and the cut can never disagree — which is the entire reason
  // `editorRouter.ts` is a module and not an `if` in here.
  const previewRoute = useCallback((opts: {
    showFormat?: string | null; brand?: string | null;
    contentType?: string | null; declared?: DeclaredFacts;
    overrideEditor?: "intelligence" | "music" | null; overrideBy?: string | null;
  } = {}) => {
    const reading = footageFactsFrom(
      (session?.uploads || []).map((u) => ({ contentType: u.contentType, hasSpeech: u.hasSpeech })),
      opts.declared,
    );
    const decision = routeEditor({
      showFormatKey: opts.showFormat,
      brand: opts.brand,
      contentType: opts.contentType,
      footage: reading.facts,
      overrideEditor: opts.overrideEditor,
      overrideBy: opts.overrideBy,
    });
    return { route: decision, reading };
  }, [session]);

  // ── shared render helper ──────────────────────────────────────────────────
  const queueRender = useCallback(async (opts: {
    scenes: PlannedScene[]; format: CastFormat; brand: string; topic: string;
    hook: string; style: "standard" | "wpw_dark_clean"; captions: RendererCaption[];
    musicUrl?: string | null; keepNativeAudio?: boolean; sourceRef: string;
    /** Documentary color grade (worker GRADE_PRESETS): cinematic | gritty | golden */
    grade?: string;
    /** What the cut is FOR — organic house cut, Behind The Install, or a paid ad. */
    treatment?: CastTreatment;
    /**
     * Brand bug. The renderer has always supported logo:false / logoUrl /
     * logoPosition per cut, and the Cut Editor exposes all three — but
     * BrandCast never did, so a NEW cut always got the brand default top-right
     * and the only way to change it was to render first and re-edit after.
     */
    logo?: "brand" | "none" | "custom";
    logoUrl?: string;
    logoPosition?: "tr" | "tl" | "br" | "bl";
    /** Real strings for the BTI furniture. Nothing here is ever invented. */
    credit?: BtiCredit;
    /** WHICH EDITOR cut this, recorded on the job so a render can be traced. */
    editor?: string;
    /** MUSIC EDITOR ONLY. False = arithmetic cut, not beat-driven. */
    beatMatched?: boolean;
    /** Track time that output t=0 corresponds to (phrase-snapped). */
    musicStart?: number;
    /**
     * The output-timed hook overlay PLAN, carried on the blueprint.
     *
     * The renderer DOES consume this — `hookOverlayForRender` reads
     * `bp.hookOverlay` and draws it in the post-concat pass, on the same
     * output clock this was planned against. When it is set, the scene-level
     * hook text is stripped first (`stripSceneHookText`) so the line is drawn
     * once rather than stacked on itself.
     */
    hookOverlay?: HookOverlayPlan | null;
    /**
     * SPEECH SUBTITLES, output-timed, from `buildCaptionTrack`.
     *
     * `blueprint.captionTrack` is the ONLY channel that reaches the worker: the
     * `video-render` edge function forwards `{blueprint, music_url, captions,
     * brand, source_ref}` into `video_render_jobs`, and that table has no
     * `caption_track` column — so the worker's `job.caption_track ||
     * bp.captionTrack` can only ever be satisfied by the blueprint half.
     *
     * Whenever this is set, `captions` MUST be empty: the worker draws both,
     * and the same words on both wires are drawn twice, stacked.
     */
    captionTrack?: CaptionTrack | null;
    /**
     * The editor brain's VERBATIM answer, under the key the panel reads.
     *
     * `AdminBrandBoard` resolves `bp.editor_brain ?? bp.editorBrain` and hands
     * it to `editorBrainAdapter`; the adapter is the one sanctioned translation
     * between the function's schema and the panel's, so what is stored here is
     * the raw response and never a summary of it.
     */
    editorBrain?: Record<string, unknown> | null;
  }) => {
    const spec = CAST_FORMATS[opts.format];
    const site = CAST_BRANDS.find((b) => b.slug === opts.brand)?.site || "weprintwraps.com";
    // The treatment decorates the scene list (BTI title card + shop lower
    // third) and contributes blueprint furniture (credits roll, NOW PLAYING,
    // end-card QR). organic/ad pass straight through.
    const treatment = opts.treatment || "organic";
    const applied = applyTreatment(treatment, opts.scenes as unknown as TreatmentScene[], opts.credit || {});
    const scenes = applied.scenes as unknown as PlannedScene[];
    const { endCardQrUrl, suppressEndCard, ...treatmentBlueprint } =
      applied.blueprint as { endCardQrUrl?: string; suppressEndCard?: boolean } & Record<string, unknown>;
    const totalDuration = scenes.reduce(
      (t, s: PlannedScene & { duration?: number }) =>
        t + (Number(s.duration) || Math.max(0.5, (s.end || 0) - (s.start || 0))),
      0,
    );
    const blueprint = {
      id: `brandcast_${opts.format}_${Date.now()}`,
      platform: spec.platform,
      totalDuration,
      aspectRatio: spec.aspectRatio,
      format: opts.format === "longform" ? "youtube" : opts.format,
      source: "auto_assemble",
      brand: opts.brand,
      treatment,
      title: opts.topic,
      scenes,
      ...(opts.style === "wpw_dark_clean" ? { stylePack: "wpw_dark_clean" } : {}),
      // Brand default unless told otherwise; `logo:false` is the renderer's
      // explicit opt-out and an empty custom URL must never become one.
      ...(opts.logo === "none" ? { logo: false } : {}),
      ...(opts.logo === "custom" && opts.logoUrl?.trim() ? { logoUrl: opts.logoUrl.trim() } : {}),
      ...(opts.logoPosition ? { logoPosition: opts.logoPosition } : {}),
      keepNativeAudio: opts.keepNativeAudio !== false,
      ...(opts.grade && opts.grade !== "raw" ? { grade: opts.grade } : {}),
      // Provenance, on the job row itself: which editor cut it, whether the
      // music editor actually landed on the beat, and where in the track the
      // cut starts. A render nobody can trace back to an editor is how "is
      // this beat-matched?" becomes a screenshot argument.
      ...(opts.editor ? { editor: opts.editor } : {}),
      ...(opts.beatMatched !== undefined ? { beatMatched: opts.beatMatched } : {}),
      ...(Number.isFinite(opts.musicStart as number) ? { musicStart: opts.musicStart } : {}),
      ...(opts.hookOverlay?.rendered
        ? { hookOverlay: { ...opts.hookOverlay, filters: hookOverlayFilters(opts.hookOverlay).filters, renderedByWorker: true } }
        : {}),
      // Speech subtitles. Carried whole (`{cues, dropped, granularity, plan,
      // reason}`) because the worker's `normalizeCaptionTrack` reads the plan
      // for the ASS document AND the cues for its overlay-collision map, and
      // because `dropped`/`reason` are the paperwork for every line that did
      // NOT get captioned — the honest half, and the half nobody can
      // reconstruct later from a finished mp4.
      ...(opts.captionTrack?.cues?.length ? { captionTrack: opts.captionTrack } : {}),
      // The brain's reasoning, under the key `AdminBrandBoard` reads.
      ...(opts.editorBrain ? { editor_brain: opts.editorBrain } : {}),
      ...treatmentBlueprint,
      // A treatment that opens and closes on the footage gets no end card at
      // all — not an empty one, which would still render a black tail.
      ...(opts.format !== "story" && !suppressEndCard
        ? {
            endCard: {
              duration: 2.5,
              text: opts.topic,
              cta: site,
              // The submission QR only exists on a BTI cut, and only when a
              // real URL was given.
              ...(endCardQrUrl ? { qrUrl: endCardQrUrl } : {}),
            },
          }
        : {}),
    };
    const { data, error } = await supabase.functions.invoke("video-render", {
      body: {
        blueprint,
        music_url: opts.musicUrl || null,
        captions: opts.captions,
        brand: opts.brand,
        source_ref: opts.sourceRef,
      },
    });
    if (error) throw new Error(`render enqueue failed: ${error.message}`);
    if (data?.ok === false) throw new Error(data?.error || "render failed");
    return data;
  }, []);

  // ── 2. FAST CUT (instant, deterministic plan from the uploads) ────────────
  const fastCut = useCallback(async (opts: {
    formats: CastFormat[]; brand: string; topic: string; hook?: string;
    style?: "standard" | "wpw_dark_clean"; withMusic?: boolean;
    keepNativeAudio?: boolean; captionStyle?: string;
    treatment?: CastTreatment; credit?: BtiCredit;
    logo?: "brand" | "none" | "custom"; logoUrl?: string; logoPosition?: "tr" | "tl" | "br" | "bl";
    /**
     * A key from `SHOW_FORMATS`. Supply it and the SHOW decides the editor —
     * "Behind Shop Doors" is cut by the music editor, and footage that cannot
     * honestly carry the show is REFUSED rather than cut anyway. Omit it and
     * this stays the legacy deterministic Fast Cut it has always been, with
     * the router's "no show chosen" refusal recorded for the panel to surface.
     */
    showFormat?: string | null;
    /** What the operator can vouch for that no clip row records (a tour). */
    declared?: DeclaredFacts;
    overrideEditor?: "intelligence" | "music" | null; overrideBy?: string | null;
    contentType?: string | null;
    /**
     * The beat grid from `worker/video-renderer/beatGrid.js` `analyzePcm`.
     * The browser cannot produce one, so without it the music editor honestly
     * falls back to arithmetic and flags `beatMatched: false`.
     */
    beatGrid?: BeatGrid | null;
    /** Seconds into the track where the cut begins; snapped to a phrase. */
    musicStart?: number;
  }) => {
    if (!session?.uploads.length) throw new Error("Upload footage first");
    setBusy(true);
    try {
      const clips: FastClip[] = session.uploads.map((u) => ({ url: u.url, duration: u.duration, kind: u.kind, id: u.base, name: u.name }));
      const totalFootage = clips.reduce((t, c) => t + c.duration, 0);
      const hook = (opts.hook || opts.topic).slice(0, 60);
      const site = CAST_BRANDS.find((b) => b.slug === opts.brand)?.site || "weprintwraps.com";
      const cta = `More at ${site}`;
      // Default CLEAN — the dark_clean pack lays a 45% black scrim over the
      // whole frame (a promo-poster look). It buried faces ("too dark");
      // it's opt-in now, never the documentary default.
      const style = opts.style || "standard";

      // Music: opt-in only (house doctrine — never auto-applied) AND gated by
      // the content type. Owner rule: documentary/UGC keep their own sound;
      // music is for Behind-The-Install footage only.
      const cutTypes = session.uploads.map((u) => u.contentType);
      // SPEECH BEATS THE LABEL. Owner rule 2026-08-05: anything with talking is
      // original content, never a music video. A transcript is evidence Whisper
      // heard words; content_type is a label that, measured today, is NULL on
      // all 419 raw videos — so the label alone could never have caught this.
      const policy = musicPolicyForClips(
        session.uploads.map((u) => ({ contentType: u.contentType, hasSpeech: u.hasSpeech })),
      );
      let musicUrl: string | null = null;
      if (opts.withMusic && !policy.allowMusic) {
        setProgress({ stage: "music", detail: policy.reason });
      }
      if (opts.withMusic && policy.allowMusic) {
        setProgress({ stage: "music", detail: "Matching a track…" });
        try {
          const { data: m } = await supabase.functions.invoke("video-music", {
            body: { transcript: opts.topic, duration_seconds: Math.max(...opts.formats.map((f) => CAST_FORMATS[f].duration)) },
          });
          musicUrl = m?.top_pick?.storage_url || m?.top_pick?.file_url || null;
        } catch { /* music degrades silently */ }
      }

      // ── WHICH EDITOR CUTS THIS ──────────────────────────────────────────
      // The track that will actually reach the cut (the policy can block one),
      // because "a music track" is a requirement of the Cribs show and a
      // blocked track is not a track.
      const trackForCut = resolveAudioForCut({ contentTypes: cutTypes, requestedMusicUrl: musicUrl }).musicUrl;
      const reading = footageFactsFrom(
        session.uploads.map((u) => ({ contentType: u.contentType, hasSpeech: u.hasSpeech })),
        { ...opts.declared, musicTrack: opts.declared?.musicTrack ?? !!trackForCut },
      );
      const decision = routeEditor({
        showFormatKey: opts.showFormat,
        brand: opts.brand,
        contentType: opts.contentType,
        footage: reading.facts,
        overrideEditor: opts.overrideEditor,
        overrideBy: opts.overrideBy,
      });
      setRoute(decision);

      // A show was named. Honour its refusals — a show whose footage is missing
      // is not cut worse, it is not cut. Nothing is rendered, nothing is spent.
      if (opts.showFormat) {
        if (!decision.ok) throw new Error(decision.refusal || "This footage cannot honestly be cut as that show.");
        if (decision.editor !== "music") {
          throw new Error(
            `${decision.format?.label} is cut by the ${decision.editor} editor, which reads the parsed ` +
            "transcript — Fast Cut only drives the music editor. Run Story Edit for this show.",
          );
        }
      }
      const useMusicEditor = !!opts.showFormat && decision.editor === "music";

      const formatReports: CastFormatReport[] = [];
      const results: Array<{
        format: CastFormat; ok: boolean; render_job_id?: string; error?: string;
        editor?: CastFormatReport["editor"]; beatMatched?: boolean;
        fallback?: MusicVideoCut["fallback"]; notes?: string[];
      }> = [];
      for (const format of opts.formats) {
        const spec = CAST_FORMATS[format];
        const target = format === "longform"
          ? Math.min(Math.max(totalFootage * 0.8, 120), 480)
          : spec.duration;
        setProgress({ stage: "cut", detail: `Cutting the ${spec.label}…` });

        // ── THE MUSIC EDITOR, or the legacy planner. Never a silent swap.
        let musicCut: MusicVideoCut | null = null;
        let scenes: PlannedScene[];
        const notes: string[] = [];
        if (useMusicEditor) {
          musicCut = planMusicVideoScenes(
            clips.map((c) => {
              const up = session.uploads.find((u) => u.url === c.url);
              return { ...c, contentType: up?.contentType ?? null } as MusicClip;
            }),
            opts.beatGrid ?? null,
            {
              targetDuration: target, maxScenes: spec.maxScenes,
              hookText: hook, minSeg: spec.minSeg, maxSeg: spec.maxSeg,
              musicStart: opts.musicStart,
            },
          );
          scenes = musicCut.scenes as unknown as PlannedScene[];
          notes.push(...musicCut.notes);
          // THE FALLBACK IS VISIBLE. `planMusicVideoScenes` falls back to
          // `planFastCutScenes` below beat confidence and flags it; a fallback
          // the operator cannot see is a music editor that quietly is not one,
          // so it reaches the progress line, the result row and the report.
          setProgress({
            stage: "cut",
            detail: musicCut.beatMatched
              ? `Cut to the beat — ${Math.round(musicCut.bpm)} BPM, ${musicCut.actionMatched}/${musicCut.scenes.length} shot(s) landing on an accent…`
              : `NOT cut to the beat (${musicCut.fallback}) — ${musicCut.notes[0] || "arithmetic cut"}`,
          });
        } else {
          scenes = planFastCutScenes(clips, {
            targetDuration: target, maxScenes: spec.maxScenes,
            hookText: hook, minSeg: spec.minSeg, maxSeg: spec.maxSeg,
          });
          if (!opts.showFormat) notes.push(decision.reason);
        }

        if (!scenes.length) {
          results.push({ format, ok: false, error: musicCut?.notes[0] || "no usable clips", notes });
          continue;
        }
        setProgress({ stage: "captions", detail: `Writing captions for the ${spec.label}…` });
        const captions = format === "longform" ? [] : await fetchCaptions(opts.topic, hook, cta, target, opts.captionStyle || "sabri");

        // ── THE HOOK OVERLAY — planned against the OUTPUT timeline.
        // The music editor stamps `outStart`/`outEnd`; the legacy planner does
        // not, so the overlay is only planned when there is a real output
        // clock to plan against. The renderer burns it from the blueprint.
        const hookPlan = musicCut
          ? planHookOverlay({
              hookLine: opts.hook || null,
              channel: channelForFormat(format),
              brand: opts.brand,
              scenes: toCaptionScenes(musicCut.scenes),
              captionCues: captions.map((c) => ({ start: c.time, end: c.time + c.duration, what: "caption" })),
            })
          : null;
        // ONE HOOK LINE, NOT TWO. The planner already stamped it on scene 0;
        // if the overlay is going to be drawn, that copy comes off.
        if (hookPlan?.rendered) {
          scenes = stripSceneHookText(scenes);
          notes.push(
            `Hook overlay drawn on the output timeline (${hookPlan.start.toFixed(1)}s\u2013${hookPlan.end.toFixed(1)}s). ` +
            "The scene-level hook text was removed so the line is not drawn twice.",
          );
        }

        formatReports.push({
          format,
          editor: useMusicEditor ? "music" : "legacy_fast_cut",
          scenes: scenes.length,
          ...(musicCut ? {
            beatMatched: musicCut.beatMatched,
            fallback: musicCut.fallback,
            bpm: musicCut.bpm,
            confidence: musicCut.confidence,
            actionMatched: musicCut.actionMatched,
          } : {}),
          // Fast Cut cuts from raw uploads, so there are no parsed moments and
          // therefore no transcript to caption FROM. Its captions are the AI
          // writer's marketing copy on the legacy `job.captions` wire — a
          // different product from speech subtitles, and labelled as one.
          captions: {
            source: captions.length ? "ai" : "none",
            channel: captions.length ? "job.captions" : "none",
            cues: captions.length,
            dropped: 0,
            reason: captions.length ? null : "No captions were written for this format.",
          },
          ...(hookPlan ? { hookOverlay: { rendered: hookPlan.rendered, reason: hookPlan.reason, start: hookPlan.start, end: hookPlan.end, region: hookPlan.region, text: hookPlan.text, landsInWindow: hookPlan.landsInWindow } } : {}),
          notes,
        });

        setProgress({ stage: "render", detail: `Queuing the ${spec.label} render…` });
        try {
          const data = await queueRender({
            scenes, format, brand: opts.brand, topic: opts.topic, hook, style, captions,
            treatment: opts.treatment, credit: opts.credit,
            editor: useMusicEditor ? "music" : "legacy_fast_cut",
            ...(musicCut ? { beatMatched: musicCut.beatMatched, musicStart: musicCut.musicStart } : {}),
            ...(hookPlan ? { hookOverlay: hookPlan } : {}),
            // Long-form is documentary by default; other formats keep natural
            // sound unless a track was deliberately picked.
            // Long-form is documentary by construction; short formats still
            // pass through the policy (a doc/UGC clip anywhere blocks the bed).
            musicUrl: format === "longform" ? null
              : resolveAudioForCut({ contentTypes: cutTypes, requestedMusicUrl: musicUrl }).musicUrl,
            // ORIGINAL AUDIO ALWAYS (unless explicitly turned off). Picking a
            // track no longer silences the footage — the worker ducks music to
            // a low bed UNDER the real sound instead of replacing it.
            keepNativeAudio: opts.keepNativeAudio !== false,
            sourceRef: `brandcast_${format}_${session.tag}`,
          });
          results.push({
            format, ok: true, render_job_id: data?.render_job_id,
            editor: useMusicEditor ? "music" : "legacy_fast_cut",
            ...(musicCut ? { beatMatched: musicCut.beatMatched, fallback: musicCut.fallback } : {}),
            notes,
          });
        } catch (e: any) {
          results.push({
            format, ok: false, error: e?.message || String(e),
            editor: useMusicEditor ? "music" : "legacy_fast_cut",
            ...(musicCut ? { beatMatched: musicCut.beatMatched, fallback: musicCut.fallback } : {}),
            notes,
          });
        }
      }
      // MEASURED FROM THE REPORTS, not asserted. Whether the overlay was
      // actually drawn is a property of what each format planned, and a run
      // where every overlay was refused (no hook line, or nowhere in frame to
      // put it) genuinely drew none.
      const hookOverlayDrawn = formatReports.some((f) => f.hookOverlay?.rendered === true);
      setEditorReport({
        route: decision,
        formats: formatReports,
        intelligence: { available: false, note: "Fast Cut cuts from the uploads themselves — there are no parsed beats to attach intelligence to." },
        hookOverlayRendered: hookOverlayDrawn,
      });
      const okCount = results.filter((r) => r.ok).length;
      // The fallback flag survives all the way to the operator: a music cut
      // that did not land on the beat says so here, not only in the report.
      const offBeat = formatReports.filter((f) => f.beatMatched === false).length;
      setProgress({
        stage: "queued",
        detail: `${okCount}/${results.length} render(s) queued — track them in Renders` +
          (offBeat ? ` · ${offBeat} cut NOT on the beat (no usable beat grid)` : ""),
      });
      return results;
    } catch (err: any) {
      setProgress({ stage: "error", detail: "", error: err?.message || String(err) });
      throw err;
    } finally { setBusy(false); }
  }, [session, queueRender]);

  // ── session parse state (sources + moments for THIS session's uploads) ────
  const fetchParsed = useCallback(async () => {
    if (!session) return { sources: [], moments: [] as ParsedMoment[], transcript: "" };
    // `media_sources` HAS NO `media_url` COLUMN. Verified against production
    // 2026-08-11: the REST call carrying it returns 400 `42703 column
    // media_sources.media_url does not exist` — column resolution happens
    // BEFORE RLS, so no amount of auth got past it. The error was discarded
    // here (only `data` was destructured), so `srcList` came back empty and
    // every Story Edit died on "No parsed moments yet", blaming the parser for
    // a schema mistake. Story Edit could not run for ANY session — live
    // evidence: 4 long-form renders exist and all 4 are the music editor, and
    // the intelligence editor has never cut a long-form piece.
    // The clip URL comes from `storage_url` (the real .mp4; the row is named
    // for the extracted .mp3) with our own session upload as the fallback.
    const { data: sources, error: sourcesError } = await (supabase as any)
      .from("media_sources")
      .select("id, filename, storage_url, transcript, duration_seconds")
      .ilike("filename", `${session.tag}-%`)
      .limit(50);
    // Never swallow this again — a schema/permission failure must read as
    // itself, not as "the parser is still working".
    if (sourcesError) {
      throw new Error(`Could not read the parsed footage: ${sourcesError.message}`);
    }
    const srcList = sources || [];
    if (!srcList.length) return { sources: [], moments: [] as ParsedMoment[], transcript: "" };
    const byId: Record<string, any> = Object.fromEntries(srcList.map((s: any) => [s.id, s]));
    const { data: moments, error: momentsError } = await (supabase as any)
      .from("content_moments")
      // THE SELECTION WAS INVERTED. Verified against production 2026-08-07:
      // 3,378 of 3,653 quote-carrying moments have a NULL `hook_score`, and
      // Postgres DESC defaults to NULLS FIRST — so "the top 60 hook-scored
      // moments" was 60 UNSCORED rows, with the 275 genuinely scored ones
      // pushed off the end of the limit. Every Story Edit of a speech clip was
      // cutting from arbitrary moments while reporting that it cut from the
      // best ones. `nullsFirst: false` is the fix.
      //
      // `soundbite_score` is added because it is the column that is actually
      // populated for speech (275 rows, versus 275 for hook_score and equal
      // where both exist), and `visual_description` / `install_stage` /
      // `broll_score` because a VISION-parsed clip has no quote at all: quote
      // rows and visual rows are provably DISJOINT (0 of 11,675 carry both),
      // so without these a vision-parsed clip produced beats with no text and
      // no signal whatsoever, and the planner had nothing to rank.
      .select("source_id, start_time, end_time, verbatim_quote, hook_score, soundbite_score, visual_description, install_stage, broll_score")
      .in("source_id", srcList.map((s: any) => s.id))
      .order("hook_score", { ascending: false, nullsFirst: false })
      .order("soundbite_score", { ascending: false, nullsFirst: false })
      .order("broll_score", { ascending: false, nullsFirst: false })
      .limit(60);
    if (momentsError) {
      throw new Error(`Could not read the scored moments: ${momentsError.message}`);
    }
    const uploadByBase: Record<string, string> = Object.fromEntries(
      session.uploads.map((u) => [u.base.toLowerCase(), u.url]),
    );
    const resolved: ParsedMoment[] = (moments || [])
      .map((m: any) => {
        const src = byId[m.source_id];
        // Prefer the hydrated renderable video; fall back to our own upload
        // matched by base filename (the source filename is `${tag}-${base}…`).
        const base = String(src?.filename || "").replace(`${session.tag}-`, "").replace(/(-part\d+)?\.[^.]*$/, "");
        const clipUrl = src?.storage_url || uploadByBase[base.toLowerCase()];
        return clipUrl ? {
          clipUrl,
          sourceId: String(m.source_id),
          start: Number(m.start_time || 0),
          end: Number(m.end_time || Number(m.start_time || 0) + 4),
          // Rank from whichever score this row actually carries. A speech beat
          // is scored in `soundbite_score` and a visual beat in `broll_score`;
          // reading only `hook_score` scored 93% of speech beats as zero and
          // made the ordering meaningless even once the NULLS placement was
          // fixed. First real number wins — never summed, since they are three
          // scales measuring different things, and never defaulted upward.
          hookScore: Number(
            m.hook_score ?? m.soundbite_score ?? m.broll_score ?? 0,
          ) || 0,
          // A vision-parsed row has no quote; its `visual_description` is the
          // only text it has. Passing it as `quote` would be a lie — the beat
          // would read as something somebody SAID — so it travels beside it and
          // `mergeMomentsIntoBeats` still only merges on real speech.
          quote: m.verbatim_quote || undefined,
          ...(m.visual_description ? { visual: String(m.visual_description) } : {}),
          ...(m.install_stage ? { stage: String(m.install_stage) } : {}),
        } : null;
      })
      .filter(Boolean) as ParsedMoment[];
    const transcript = srcList.map((s: any) => s.transcript).filter(Boolean).join("\n\n");
    return { sources: srcList, moments: resolved, transcript };
  }, [session]);

  // ── 3. STORY EDIT (parsed moments → dead-air-free narrative recut) ────────
  const storyEdit = useCallback(async (opts: {
    formats: CastFormat[]; brand: string; topic: string; hook?: string;
    style?: "standard" | "wpw_dark_clean"; captionStyle?: string;
    treatment?: CastTreatment; credit?: BtiCredit;
    logo?: "brand" | "none" | "custom"; logoUrl?: string; logoPosition?: "tr" | "tl" | "br" | "bl";
    /**
     * A key from `SHOW_FORMATS`. Supply it and the SHOW decides the editor —
     * "Behind the Brand" is cut by the INTELLIGENCE editor (`editorCraft`),
     * which classifies each beat by narrative function, rearranges for
     * retention and paces to the content type. Omit it and this stays the
     * existing doc_edit-brain ladder, unchanged, with the router's "no show
     * chosen" refusal recorded for the panel.
     */
    showFormat?: string | null;
    declared?: DeclaredFacts;
    overrideEditor?: "intelligence" | "music" | null; overrideBy?: string | null;
    /** `editorCraft.CutType` — the recut knob. Same beats, different film. */
    contentType?: string | null;
  }) => {
    if (!session) throw new Error("Upload footage first");
    setBusy(true);
    try {
      setProgress({ stage: "parse", detail: "Reading the parsed moments…" });
      const { moments, transcript } = await fetchParsed();
      if (!moments.length) throw new Error("No parsed moments yet — the parser lands transcripts within ~10 minutes of upload");

      // SCRIPT PASS FIRST (the editor reads everything before cutting):
      // the core_story brain reads the FULL transcript and writes the
      // script — the story, the tension, the drama hook, the payoff. The
      // cutter below is then REQUIRED to serve this script.
      let script: CoreStory | null = null;
      if (transcript) {
        setProgress({ stage: "cut", detail: "Reading the full transcript — writing the script…" });
        try {
          const { data: st } = await supabase.functions.invoke("video-captions", {
            body: { mode: "core_story", topic: opts.topic, transcript: transcript.slice(0, 12000),
              moments: moments.filter((m) => m.quote).slice(0, 20).map((m) => m.quote as string) },
          });
          if (st?.success && st?.story) script = st.story as CoreStory;
        } catch { /* cutter still works from beats alone */ }
      }
      const images: FastClip[] = session.uploads.filter((u) => u.kind === "image")
        .map((u) => ({ url: u.url, duration: 0, kind: "image" as const, id: u.base }));
      const hook = (opts.hook || moments[0]?.quote || opts.topic).slice(0, 60);
      const site = CAST_BRANDS.find((b) => b.slug === opts.brand)?.site || "weprintwraps.com";

      // ── WHICH EDITOR CUTS THIS ──────────────────────────────────────────
      // Speech is asserted from the PARSE, not from a label: a moment with a
      // verbatim quote is Whisper's own evidence that somebody said something.
      // `content_type` is NULL on every raw video in production, so the label
      // alone could never carry this.
      const spoken = moments.filter((m) => m.quote?.trim()).length;
      const reading = footageFactsFrom(
        session.uploads.map((u) => ({ contentType: u.contentType, hasSpeech: u.hasSpeech })),
        opts.declared,
      );
      const facts = { ...reading.facts, hasSpeech: reading.facts.hasSpeech || spoken > 0 };
      const decision = routeEditor({
        showFormatKey: opts.showFormat,
        brand: opts.brand,
        contentType: opts.contentType,
        footage: facts,
        overrideEditor: opts.overrideEditor,
        overrideBy: opts.overrideBy,
      });
      setRoute(decision);
      if (opts.showFormat) {
        if (!decision.ok) throw new Error(decision.refusal || "This footage cannot honestly be cut as that show.");
        if (decision.editor !== "intelligence") {
          throw new Error(
            `${decision.format?.label} is cut by the ${decision.editor} editor, which cuts to the track — ` +
            "Story Edit only drives the intelligence editor. Run Fast Cut for this show.",
          );
        }
      }
      const useIntelligenceEditor = !!opts.showFormat && decision.editor === "intelligence";

      // ── THE DOCUMENTED ORDER: beats → badTakes → order/pace → speech lock.
      // `mergeMomentsIntoBeats` makes each beat a whole spoken thought,
      // `dedupeTakes` keeps one take of a repeated line, `cleanBeats` edits the
      // bad parts OUT (before anything is ordered — cutting a flub after the
      // order is decided would change every downstream timing), and the speech
      // lock is applied LAST, inside `paceScenes`.
      //
      // Only the intelligence path is cleaned. The legacy doc_edit ladder below
      // is left byte-identical on purpose: it has been running in production and
      // this is not the change that should alter what it cuts.
      const runNotes: string[] = [];
      let intelBeats: IntelligentBeat[] = [];
      let badTakeReport: CastEditorReport["badTakes"] | undefined;
      let intelligenceAvailable = false;
      if (useIntelligenceEditor) {
        const merged = dedupeTakes(mergeMomentsIntoBeats(moments));
        const cleaned = cleanBeats(momentsToBadTakeBeats(merged));
        const back = cleanedToMoments(cleaned.beats as any, merged);
        runNotes.push(...cleaned.notes, ...back.notes);
        badTakeReport = {
          removedSeconds: cleaned.removedSeconds,
          dropped: merged.length - cleaned.beats.length,
          refused: cleaned.refused.length,
          notes: cleaned.notes,
        };
        // The beat-intelligence join, if the module has landed. Whatever it
        // returns goes straight to the editor — the join is not reimplemented
        // here (see loadAttachIntelligence).
        const attach = await loadAttachIntelligence();
        intelligenceAvailable = !!attach;
        intelBeats = attach
          ? attach(back.moments, { topic: opts.topic, brand: opts.brand })
          : (back.moments as IntelligentBeat[]);
        if (!attach) {
          runNotes.push(
            "Beat intelligence is not available in this build — the editor classified beats from language and " +
            "hook score, not from parsed content. Its own notes say which beats were inferred.",
          );
        }
      }

      const formatReports: CastFormatReport[] = [];
      const results: Array<{
        format: CastFormat; ok: boolean; render_job_id?: string; error?: string;
        editor?: CastFormatReport["editor"]; notes?: string[];
      }> = [];
      for (const format of opts.formats) {
        const spec = CAST_FORMATS[format];
        const target = format === "longform"
          ? Math.min(Math.max(moments.reduce((t, m) => t + (m.end - m.start), 0), 120), 600)
          : spec.duration;

        let scenes: PlannedScene[] = [];
        let grade: string | undefined;
        let editorUsed: CastFormatReport["editor"] = "doc_edit_brain";
        const notes: string[] = [...runNotes];
        // The brain's answer for THIS cut. Per format, never shared: the brain
        // is asked about a specific target duration and scene budget, so one
        // answer stamped onto a 12s Story and a 50s Short would be reasoning
        // about a cut that does not exist on at least one of them.
        let brainRaw: Record<string, unknown> | null = null;
        let brainReport: CastBrainReport | undefined;

        if (useIntelligenceEditor) {
          // ── THE INTELLIGENCE EDITOR. The show says this is a documentary,
          // so `editorCraft` cuts it: each beat is classified by narrative
          // function, the order is chosen for retention, the pacing follows
          // the content type's grammar, and the speech lock is applied last
          // inside `paceScenes` (exact bounds, no ramp, no fade over a line).
          // The doc_edit BRAIN is deliberately NOT called here — it is the
          // other ordering brain, and running both means neither owns the cut.
          // ── THE EDITOR BRAIN, between badTakes and order/pace.
          // It reads the beats the bad-take pass left and answers with an
          // ORDER, roles, hooks, tips and — the part that matters most — its
          // reasons. It sits HERE and nowhere else: after cleaning (asking a
          // model to reason about flubs that are already coming out wastes the
          // question) and before `planCut`, which re-roles, re-orders and
          // re-paces on top and ends with the speech lock. It never fails the
          // cut; the worst case is a cut with no recorded reasoning, which is
          // exactly what every cut before today was.
          let beatsForCut: IntelligentBeat[] = intelBeats;
          if (intelBeats.length) {
            setProgress({ stage: "cut", detail: `Asking the editor brain about the ${spec.label}…` });
            const brain = await runEditorBrain({
              beats: intelBeats,
              topic: opts.topic,
              brand: opts.brand,
              channel: channelForFormat(format),
              contentType: decision.contentType ?? opts.contentType ?? null,
              targetDuration: target,
              maxScenes: spec.maxScenes,
              transcript,
            });
            brainRaw = brain.raw;
            brainReport = brain.report;
            notes.push(...brain.notes);

            const applied = applyBrainOrder(intelBeats, brain.order);
            beatsForCut = applied.beats;
            brainReport.handoff = {
              ordered: brain.order.length,
              matched: applied.matched,
              unordered: applied.unordered,
              roles: Object.keys(brain.roles).length,
              // The honest sentence. `editorCraft` owns roles (it derives them
              // from content and there is no channel on `EditOpts` to hand it
              // one), so the brain's roles are RECORDED and not applied — and
              // even the order it did apply is a starting arrangement the
              // craft layer is free to overrule.
              applied: applied.matched
                ? `${applied.matched} beat(s) put in the brain's order before the craft layer ran; ` +
                  `${applied.unordered} it did not order were kept and appended, never deleted. Its ` +
                  `${Object.keys(brain.roles).length} role(s) are recorded only — editorCraft assigns roles from ` +
                  "content and this build has no way to pass it a role hint."
                : "Nothing — no usable order came back, so the cut is entirely the craft layer's.",
            };
          } else {
            notes.push("The editor brain was not asked: there were no beats left to reason about.");
          }

          setProgress({ stage: "cut", detail: `Intelligence-editing the ${spec.label}…` });
          // `planCut`, not `planEditedCut`: the scenes-only wrapper drops the
          // editor's `notes`, and those notes are the honest half of the
          // output — which beats had no parsed intelligence, what the footage
          // does NOT carry, and what it assumed when the content type was not
          // stated. `channel` is passed so that assumption comes from the
          // doctrine's own format table rather than a mapping invented here.
          const cut = planCut(beatsForCut, images, {
            targetDuration: target, maxScenes: spec.maxScenes,
            hookText: hook, minSeg: spec.minSeg, maxSeg: spec.maxSeg,
            ...(decision.contentType ? { contentType: decision.contentType } : {}),
            channel: channelForFormat(format),
            brand: opts.brand, topic: opts.topic,
          } as EditOpts);
          scenes = cut.scenes as unknown as PlannedScene[];
          notes.push(...cut.notes);
          editorUsed = "intelligence";

          // THE HONEST FALLBACK. The old planner is kept for exactly this —
          // a cut too thin to be a cut is reported as a fallback, never
          // dressed up as the intelligence editor's work.
          if (scenes.length < 2) {
            setProgress({ stage: "cut", detail: `Story-editing the ${spec.label} (dead air out)…` });
            scenes = planStoryEditScenes(moments, images, {
              targetDuration: target, maxScenes: spec.maxScenes,
              hookText: hook, minSeg: spec.minSeg, maxSeg: spec.maxSeg,
            });
            editorUsed = "legacy_story_edit";
            notes.push(
              "The intelligence editor produced fewer than two scenes from these beats — fell back to the " +
              "deterministic Story Edit planner. This cut is NOT the intelligence editor's.",
            );
          }
        } else {
          // ── LEGACY LADDER (no show format chosen), unchanged.
          // THE DOCUMENTARY BRAIN: the doc_edit EDL author cuts with real doc
          // grammar (cold open, three acts, tightening pacing, one speed-ramped
          // reveal, act-break dips, a mood-picked color grade). Every timecode
          // is CLAMPED back inside its source moment — the AI shapes the cut
          // but can never invent footage. Falls back to the deterministic
          // planner if the brain is unreachable or returns a thin cut.
          setProgress({ stage: "cut", detail: `Documentary-editing the ${spec.label}…` });
          // EDITING-CRAFT LAYER (code, not prompt): Whisper fragments merge
          // into sentence-complete BEATS, repeated takes dedupe to the best
          // one, and after the brain answers every speech beat is forced to
          // its exact full bounds (no mid-sentence chops, no slow-mo'd
          // dialogue, no fades over speech).
          notes.push(decision.reason);
          const beats = dedupeTakes(mergeMomentsIntoBeats(moments));
          try {
            const { data: edlRes } = await supabase.functions.invoke("video-captions", {
              body: {
                mode: "doc_edit", topic: opts.topic,
                transcript: transcript.slice(0, 8000),
                ...(script ? { story: script } : {}),
                moments: beats.map((m, i) => ({ i, start: m.start, end: m.end, score: m.hookScore, quote: m.quote })),
                target_duration: target, max_scenes: spec.maxScenes,
              },
            });
            const edl = edlRes?.success ? edlRes.edl : null;
            if (edl?.scenes?.length) {
              const PURPOSES = new Set(["hook", "pattern_interrupt", "proof", "payoff", "b_roll", "reveal", "cta"]);
              scenes = (edl.scenes as any[])
                .map((s, idx) => {
                  const mo = beats[Number(s.m)];
                  if (!mo) return null;
                  const lo = Math.max(0, mo.start - 1), hi = mo.end + 1;
                  const start = Math.min(Math.max(Number(s.start), lo), hi - 0.5);
                  const end = Math.min(Math.max(Number(s.end), start + 0.5), hi);
                  const raw = {
                    sceneId: `doc_${idx}`, clipId: mo.sourceId, clipUrl: mo.clipUrl,
                    start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10,
                    purpose: (PURPOSES.has(s.purpose) ? s.purpose : "proof") as PlannedScene["purpose"],
                    ...(s.text ? { text: String(s.text).slice(0, 70), textPosition: "top" as const } : {}),
                    ...(Number(s.speed) >= 0.4 && Number(s.speed) <= 1.5 ? { speed: Number(s.speed) } : {}),
                    ...(s.fade_in ? { fadeIn: true } : {}),
                  } as PlannedScene & { speed?: number; fadeIn?: boolean };
                  return enforceSpeechCraft(raw, mo);
                })
                .filter(Boolean) as PlannedScene[];
              grade = typeof edl.grade === "string" ? edl.grade : undefined;
            }
          } catch { /* brain unreachable — deterministic planner takes over */ }

          if (scenes.length < 2) {
            setProgress({ stage: "cut", detail: `Story-editing the ${spec.label} (dead air out)…` });
            scenes = planStoryEditScenes(moments, images, {
              targetDuration: target, maxScenes: spec.maxScenes,
              hookText: hook, minSeg: spec.minSeg, maxSeg: spec.maxSeg,
            });
            grade = undefined;
            editorUsed = "legacy_story_edit";
          }
        }

        if (!scenes.length) { results.push({ format, ok: false, error: "no moments fit", editor: editorUsed, notes }); continue; }

        // ── CAPTIONS, TIMED AGAINST THE OUTPUT TIMELINE ────────────────────
        // `buildCaptionTrack` groups the real spoken words in SOURCE time and
        // then runs `retimeToOutput` against the edit's own `outStart`/`outEnd`.
        // That is the whole point: once beats are rearranged the two clocks
        // diverge, and a source-timed cue lands over the wrong shot — which
        // reads as a caption bug rather than the ordering bug it is. The
        // mapping is never hand-rolled here.
        //
        // THE TRACK GOES ON THE BLUEPRINT, NOT IN `captions`. `blueprint.
        // captionTrack` is the only channel that survives `video-render`
        // (see the file header), and it carries the ASS document, the capped
        // drawtext fallback and the producer's own recommendation between them
        // — none of which fits through `{text, time, duration}`. The `captions`
        // field stays EMPTY whenever the track is set: the worker draws both,
        // so the same words on both wires are drawn twice, stacked.
        let captions: RendererCaption[] = [];
        let captionTrack: CaptionTrack | null = null;
        let captionSource: CastFormatReport["captions"]["source"] = "none";
        let captionChannel: CastFormatReport["captions"]["channel"] = "none";
        let captionDropped = 0;
        let captionReason: string | null = null;
        let captionGranularity: CueGranularity | undefined;
        let captionEstimated = 0;
        const hasOutputClock = scenes.every((s: any) => Number.isFinite(s?.outEnd) && s.outEnd > 0);
        if (format !== "longform" && useIntelligenceEditor && hasOutputClock) {
          // Cues come from the RAW moments, not the merged beats: Whisper's
          // fragments are finer than a sentence-complete beat, so they group
          // into more readable cues. Every one is placed by its source window,
          // and a fragment whose window is not on screen is dropped and
          // counted rather than nudged onto a neighbouring shot.
          //
          // The scenes handed over are the EDITED ones, carrying `outStart`/
          // `outEnd`: `buildCaptionTrack` runs `retimeToOutput` internally, so
          // no source→output mapping is written here. Hand-rolling one is how a
          // cue ends up over the wrong shot the moment a beat moves — plausible
          // numbers, invisible in review, wrong on screen.
          //
          // Frame size comes from the format's own aspect so the line-wrap
          // width and the ASS `PlayResX/Y` match the pixels the worker renders.
          const [frameW, frameH] = FRAME_FOR_ASPECT[spec.aspectRatio] || FRAME_FOR_ASPECT["9:16"];
          const track = buildCaptionTrack(
            captionSegmentsFrom(moments),
            toCaptionScenes(scenes as any),
            { frameW, frameH },
          );
          captionDropped = track.dropped.length;
          captionReason = track.reason;
          captionGranularity = track.granularity;
          captionEstimated = track.cues.filter((c) => c.estimatedTiming).length;
          if (track.cues.length) {
            captionTrack = track;
            captionSource = "transcript";
            captionChannel = "blueprint.captionTrack";
            notes.push(
              `${track.cues.length} speech caption(s) burned in from the transcript, timed on the OUTPUT ` +
              `timeline${captionDropped ? `; ${captionDropped} cue(s) were cut from the edit and dropped rather than moved` : ""}.`,
            );
            if (track.granularity === "segment") {
              notes.push(
                "Caption timing is SEGMENT-level, not word-level — every boundary inside a segment is " +
                `interpolated (${captionEstimated} of ${track.cues.length} cue(s) carry an interpolated bound). ` +
                "Word timings only exist for material transcribed after the granularity migration; older clips " +
                "cannot have them, and this is not a defect in the cut.",
              );
            }
          } else {
            // No usable spoken cue — the AI caption writer is the honest
            // fallback, and it is labelled as a different thing entirely: it
            // writes marketing copy, it does not transcribe.
            captions = await fetchCaptions(opts.topic, hook, `More at ${site}`, target, opts.captionStyle || "sabri");
            if (captions.length) {
              captionSource = "ai";
              captionChannel = "job.captions";
              notes.push(`No caption cue survived the retime (${track.reason || "no spoken cues"}) — fell back to written captions.`);
            }
          }
        } else if (format !== "longform") {
          captions = await fetchCaptions(opts.topic, hook, `More at ${site}`, target, opts.captionStyle || "sabri");
          captionSource = captions.length ? "ai" : "none";
          captionChannel = captions.length ? "job.captions" : "none";
        }
        // ONE occupancy map, whichever wire the captions took — the hook
        // overlay refuses to draw over a caption, and it can only do that if it
        // is told about the captions that actually exist. Speech cues are
        // already output-timed; `cuesToRendererCaptions` is the same rename the
        // legacy wire uses, kept so both branches speak one shape.
        const captionWindows = captionTrack
          ? cuesToRendererCaptions(captionTrack.cues).map((c) => ({ start: c.time, end: c.time + c.duration, what: "caption" }))
          : captions.map((c) => ({ start: c.time, end: c.time + c.duration, what: "caption" }));
        const captionCount = captionTrack ? captionTrack.cues.length : captions.length;

        // ── THE HOOK OVERLAY — output-timed, planned, not yet drawn.
        const hookPlan = hasOutputClock
          ? planHookOverlay({
              hookLine: opts.hook || null,
              channel: channelForFormat(format),
              brand: opts.brand,
              scenes: toCaptionScenes(scenes as any),
              captionCues: captionWindows,
            })
          : null;
        // ONE HOOK LINE, NOT TWO. The planner already stamped it on scene 0;
        // if the overlay is going to be drawn, that copy comes off.
        if (hookPlan?.rendered) {
          scenes = stripSceneHookText(scenes);
          notes.push(
            `Hook overlay drawn on the output timeline (${hookPlan.start.toFixed(1)}s\u2013${hookPlan.end.toFixed(1)}s). ` +
            "The scene-level hook text was removed so the line is not drawn twice.",
          );
        }

        formatReports.push({
          format,
          editor: editorUsed,
          scenes: scenes.length,
          captions: {
            source: captionSource,
            channel: captionChannel,
            cues: captionCount,
            dropped: captionDropped,
            reason: captionCount ? null : (captionReason || "No captions were written for this format."),
            ...(captionGranularity ? { granularity: captionGranularity } : {}),
            ...(captionTrack ? {
              estimated: captionEstimated,
              representation: captionTrack.plan.recommended,
              representationReason: captionTrack.plan.recommendedReason,
            } : {}),
          },
          ...(hookPlan ? { hookOverlay: { rendered: hookPlan.rendered, reason: hookPlan.reason, start: hookPlan.start, end: hookPlan.end, region: hookPlan.region, text: hookPlan.text, landsInWindow: hookPlan.landsInWindow } } : {}),
          ...(brainReport ? { editorBrain: brainReport } : {}),
          notes,
        });

        try {
          const data = await queueRender({
            scenes, format, brand: opts.brand, topic: opts.topic, hook,
            style: opts.style || "wpw_dark_clean", captions, grade,
            treatment: opts.treatment, credit: opts.credit,
            logo: opts.logo, logoUrl: opts.logoUrl, logoPosition: opts.logoPosition,
            musicUrl: null, keepNativeAudio: true, // speech leads — always
            sourceRef: `brandcast_story_${format}_${session.tag}`,
            editor: editorUsed,
            ...(hookPlan ? { hookOverlay: hookPlan } : {}),
            // Speech subtitles ride the blueprint; `captions` above is empty
            // whenever this is set, so nothing is drawn twice.
            ...(captionTrack ? { captionTrack } : {}),
            // The reasoning, verbatim, under the key `EditorBrainPanel` reads.
            // Stamped even when it failed — "failed" and "never run" are
            // different states with different next steps, and the panel can
            // only tell them apart if the failure is actually recorded.
            ...(brainRaw ? { editorBrain: brainRaw } : {}),
          });
          results.push({ format, ok: true, render_job_id: data?.render_job_id, editor: editorUsed, notes });
        } catch (e: any) {
          results.push({ format, ok: false, error: e?.message || String(e), editor: editorUsed, notes });
        }
      }
      // MEASURED FROM THE REPORTS, not asserted. Whether the overlay was
      // actually drawn is a property of what each format planned, and a run
      // where every overlay was refused (no hook line, or nowhere in frame to
      // put it) genuinely drew none.
      const hookOverlayDrawn = formatReports.some((f) => f.hookOverlay?.rendered === true);
      const report: CastEditorReport = {
        route: decision,
        formats: formatReports,
        ...(badTakeReport ? { badTakes: badTakeReport } : {}),
        intelligence: {
          available: intelligenceAvailable,
          note: intelligenceAvailable
            ? "Beats carry the asset parse's facts — the editor cut on content."
            : "No beat-intelligence join in this build; the editor used its language/score fallback.",
        },
        hookOverlayRendered: hookOverlayDrawn,
      };
      setEditorReport(report);
      const okCount = results.filter((r) => r.ok).length;
      const fellBack = formatReports.filter((f) => f.editor === "legacy_story_edit").length;
      // THE BRAIN'S BAD ANSWERS REACH THE OPERATOR, not just the report.
      // A MISMATCH means the brain refused to reason about the requested angle
      // because the footage does not carry it — the cut still exists, and
      // letting that fall through silently is how a piece ships titled as
      // something it is not. A FAILURE means the cut is unexplained. Neither is
      // a fatal error and neither is allowed to be invisible.
      const mismatched = formatReports.filter((f) => f.editorBrain?.verdict === "mismatch").length;
      const brainFailed = formatReports.filter((f) => f.editorBrain && (!f.editorBrain.answered || f.editorBrain.ok === false)).length;
      const captioned = formatReports.filter((f) => f.captions.channel === "blueprint.captionTrack").length;
      setProgress({
        stage: "queued",
        detail: `Story edit: ${okCount}/${results.length} render(s) queued` +
          (fellBack ? ` · ${fellBack} fell back to the deterministic planner` : "") +
          (captioned ? ` · ${captioned} with burned-in speech captions` : "") +
          (mismatched ? ` · ${mismatched} FLAGGED by the editor brain as an angle MISMATCH — the footage does not carry "${opts.topic}"` : "") +
          (brainFailed ? ` · ${brainFailed} cut(s) unexplained (the editor brain failed)` : ""),
      });
      return { results, transcript, report, route: decision };
    } catch (err: any) {
      setProgress({ stage: "error", detail: "", error: err?.message || String(err) });
      throw err;
    } finally { setBusy(false); }
  }, [session, fetchParsed, queueRender]);

  // ── 4. CONTENT PACK — story-first OpenAI brain, one pack per brand ────────
  // Stage 1: extract the CORE STORY from the full transcript ONCE (the story
  // the footage actually tells — hook, beats, tension, payoff, verbatim
  // quotes). Stage 2: write each brand's five anchors (Blog, X, LinkedIn,
  // Meta IG+FB, YouTube + Substack) FROM that story, in the brand's voice.
  const buildContentPacks = useCallback(async (brands: string[], topic: string) => {
    if (!session) throw new Error("Upload footage first");
    setBusy(true);
    try {
      setProgress({ stage: "pack", detail: "Reading transcripts…" });
      const { moments, transcript } = await fetchParsed();
      const quotes = moments.filter((m) => m.quote).slice(0, 8).map((m) => m.quote as string);

      let story: CoreStory | null = null;
      if (transcript || moments.length) {
        setProgress({ stage: "pack", detail: "Extracting the core story from the footage…" });
        try {
          const { data } = await supabase.functions.invoke("video-captions", {
            body: {
              mode: "core_story", topic,
              transcript: transcript.slice(0, 12000),
              moments: moments.filter((m) => m.quote).slice(0, 20).map((m) => m.quote as string),
            },
          });
          if (data?.success && data?.story) story = data.story as CoreStory;
        } catch { /* packs still write from transcript alone */ }
      }

      const packs: BrandPack[] = [];
      for (const brand of brands) {
        const info = CAST_BRANDS.find((b) => b.slug === brand);
        setProgress({ stage: "pack", detail: `Writing the ${info?.label || brand} pack…` });
        let pack: BrandPack | null = null;
        try {
          const { data } = await supabase.functions.invoke("video-captions", {
            body: {
              mode: "content_pack", brand, topic,
              transcript: transcript.slice(0, 6000),
              quotes,
              ...(story ? { story } : {}),
            },
          });
          if (data?.success && data?.pack) pack = { brand, ...data.pack, ai: true };
        } catch { /* fall through to the deterministic pack */ }
        packs.push(pack || fallbackPack(brand, topic, quotes, info?.site));
      }
      setProgress({ stage: "queued", detail: `${packs.length} brand pack(s) written${story ? " from the core story" : ""}` });
      return { packs, story };
    } catch (err: any) {
      setProgress({ stage: "error", detail: "", error: err?.message || String(err) });
      throw err;
    } finally { setBusy(false); }
  }, [session, fetchParsed]);

  // ── 5. SEND TO APPROVAL BOARD — humans approve before anything publishes ──
  // Every pack now flows through the NARRATIVE SPINE on its way here.
  //
  // What this used to do: write ONE agent_social_posts draft, then concatenate
  // the blog, X thread, Substack, LinkedIn, Instagram, Facebook and YouTube
  // copy into a single slack_agent_tasks description under dashed section
  // headers. Six of seven pieces were a substring — unschedulable, unapprovable,
  // unpublishable, unmeasurable, unlinkable. The Narrative Engine was built to
  // fix exactly that and then had NO CALLER, which is why production sat at 0
  // narratives and 0 artifacts while packs kept getting buried.
  //
  // Now: findOrCreateNarrative (automatic — nobody types a topic into a form),
  // fanOutPack (each piece becomes a real row in the table that already owns
  // it), attachArtifact for the render, and the chain relinks itself. The board
  // card survives because the team works from it — but it is now a MANIFEST
  // pointing at real rows, not the copy itself.
  //
  // Nothing here publishes: every row lands in draft/needs_review.
  const sendToApprovalBoard = useCallback(async (packs: BrandPack[], topic: string) => {
    if (!session) throw new Error("Upload footage first");
    if (!packs.length) throw new Error("Write the content packs first");
    setBusy(true);
    try {
      setProgress({ stage: "board", detail: "Collecting finished renders…" });
      const { data: renders } = await (supabase as any)
        .from("video_render_jobs")
        .select("id, final_url, thumbnail_url, blueprint, source_ref")
        .eq("status", "complete")
        .like("source_ref", `%${session.tag}`)
        .order("created_at", { ascending: false })
        .limit(12);
      const attachments = (renders || [])
        .filter((r: any) => r.final_url)
        .map((r: any) => ({
          url: r.final_url,
          type: "video",
          name: `${r.blueprint?.format || "video"} — ${r.blueprint?.title || "BrandCast render"}`.slice(0, 60),
        }));
      const bestMedia = attachments[0]?.url ? [attachments[0].url] : [];

      const renderId = (renders || []).find((r: any) => r.final_url)?.id || null;

      let cards = 0;
      let artifacts = 0;
      const narrativeIds: string[] = [];

      for (const pack of packs) {
        const label = CAST_BRANDS.find((b) => b.slug === pack.brand)?.label || pack.brand;
        setProgress({ stage: "board", detail: `Fanning ${label} out across the narrative…` });

        // THE SPINE. One narrative per brand + topic, found or created — so it
        // forms because content was made, not because someone opened a form.
        const narrative = await findOrCreateNarrative({
          brand: pack.brand,
          topic,
          objective: "awareness",
          sourceTable: "video_render_jobs",
          sourceId: renderId,
          notes: `BrandCast session ${session.tag}`,
          createdBy: "brandcast",
        });
        narrativeIds.push(narrative.id);

        // Each written piece becomes its OWN row in the table that already owns
        // that channel — blog → agent_blog_posts, Substack → agent_email_campaigns,
        // X/LinkedIn/IG/FB/ad → agent_social_posts on their own platform.
        const fan = await fanOutPack(narrative.id, pack.brand, pack, {
          producedBy: "brandcast",
          mediaUrls: bestMedia,
        });
        artifacts += fan.materialised.length + fan.recorded.length;

        // The finished cut is real content too — adopt it rather than leaving
        // the narrative's own anchor sitting outside its own spine.
        if (renderId) {
          await attachArtifact({
            narrativeId: narrative.id,
            kind: "youtube",
            table: "video_render_jobs",
            id: renderId,
            title: pack.youtube?.title || topic,
            producedBy: "brandcast",
          }).catch(() => { /* the pack still fanned out; a missing anchor is a visible gap */ });
        }

        if (fan.unmapped.length) {
          console.warn(`[brandcast] pack fields with no artifact kind: ${fan.unmapped.join(", ")}`);
        }

        const igId = fan.materialised.find((m) => m.kind === "instagram")?.id || null;
        const manifest = fan.materialised
          .map((m) => `• ${m.kind} → ${m.table}`)
          .concat(fan.recorded.map((k) => `• ${k} → recorded on the narrative (no home table yet)`))
          .join("\n");

        const { error: taskErr } = await (supabase as any).from("slack_agent_tasks").insert({
          brand: "weprintwraps", // the lane the Content Review board displays
          task_type: "social_post",
          status: "pending",
          priority: "medium",
          title: `BrandCast pack (${label}): ${topic.slice(0, 48)}`,
          description:
            `BrandCast content pack for ${label}, grounded in the install footage.\n\n` +
            `Every piece is now its OWN row — open it where it lives, edit it there, ` +
            `approve it there. Nothing is pasted into this card any more.\n\n` +
            `${fan.materialised.length + fan.recorded.length} piece(s), ${fan.linked} link(s) in the chain:\n${manifest || "• (the pack wrote nothing)"}\n\n` +
            `Not made yet: ${fan.stillMissing.join(", ") || "nothing — every channel covered"}\n` +
            `Narrative: ${narrative.id}`,
          created_by: "brandcast",
          metadata: {
            source: "brandcast",
            approval_stage: "needs_approval",
            target_brand: pack.brand,
            session: session.tag,
            narrative_id: narrative.id,
            social_post_id: igId,
            artifacts: fan.materialised,
            still_missing: fan.stillMissing,
            attachments,
            pack_ai: pack.ai,
          },
        });
        if (taskErr) throw new Error(`board card failed (${label}): ${taskErr.message}`);
        cards++;
      }
      setProgress({
        stage: "queued",
        detail: `${artifacts} piece(s) across ${cards} narrative(s) — each its own row, ${attachments.length} render(s) attached`,
      });
      return { cards, attachments: attachments.length, artifacts, narrativeIds };
    } catch (err: any) {
      setProgress({ stage: "error", detail: "", error: err?.message || String(err) });
      throw err;
    } finally { setBusy(false); }
  }, [session]);

  return {
    session, progress, busy, uploadFootage, addFromLibrary, clearSession,
    fastCut, storyEdit, buildContentPacks, fetchParsed, sendToApprovalBoard,
    // The editor choice and its paperwork. Kept as structured values, not
    // flattened to a boolean — the panel renders reasons, overrides, refusals,
    // the music editor's fallback flag and every honest gap the editors report.
    route, editorReport, previewRoute,
  };
}

// Deterministic pack when the AI brain is unreachable — honest, minimal,
// never invented facts beyond the topic + real quotes.
function fallbackPack(brand: string, topic: string, quotes: string[], site?: string): BrandPack {
  const q = quotes[0] ? `\n\n> "${quotes[0]}"` : "";
  const url = site || "weprintwraps.com";
  return {
    brand,
    ai: false,
    blog: { title: topic, body_markdown: `# ${topic}\n\nStraight from the install.${q}\n\nFull video on our channels — more at ${url}.` },
    x: `${topic} — straight from the install. ${url}`,
    substack: { subject: topic, body_markdown: `${topic}${q}\n\nWatch the full cut — ${url}` },
    linkedin: `${topic}. Real work, real install, no studio. See the process at ${url}.`,
    instagram: `${topic} 🔥 straight from the install — full video on the channel. #wrap #vinylwrap`,
    facebook: `${topic} — fresh from the install. Watch the full video. ${url}`,
    youtube: { title: topic, description: `${topic}. Filmed on the install.${q}\n${url}`, tags: ["vehicle wrap", "install"] },
  };
}
