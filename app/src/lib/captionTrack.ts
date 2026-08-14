/**
 * captionTrack — the words that were actually said, over the shot that
 * actually contains them.
 *
 * Owner, 2026-08-06: "must act like a real editor … creates hook overlay
 * caption" / "must wire as operating system, use native tools, but must
 * operate as software editing." Native tools means ffmpeg, which the render
 * container already has. Nothing here calls a captioning service.
 *
 * ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * There are currently ZERO burned-in speech captions in this system. The only
 * text `worker/video-renderer` draws is the scene-0 hook line, lower thirds, a
 * ticker and the end card. Short-form is watched muted, so an uncaptioned
 * talking clip is watched by nobody. Meanwhile the transcript already exists
 * and was already paid for: `content_moments` holds 11,675 rows (3,653 with a
 * `verbatim_quote`), all of them timestamped, and `media_sources.transcript`
 * holds the flat text. The data is there and nothing renders it.
 *
 * ── THE BUG THIS MODULE IS SHAPED AROUND ───────────────────────────────────
 * The edit REARRANGES beats (see `brandcastPlanner.planStoryEditScenes`: the
 * top-scored moment is pulled to the front, everything else follows in story
 * order). The instant beats are reordered, SOURCE time and OUTPUT time
 * diverge. A cue timed against the source clip then appears over a completely
 * different shot — and that failure is invisible in code review, because the
 * numbers all look plausible. So:
 *
 *   cuesFromTranscript → groupIntoCues     work in SOURCE time
 *   retimeToOutput                          maps SOURCE → OUTPUT, per scene
 *   captionFilters                          renders OUTPUT time only
 *
 * `retimeToOutput` is the load-bearing function. A cue whose source window
 * falls in NO scene was cut from the edit and is DROPPED — never clamped onto
 * a neighbouring shot. Captioning a line that is not in the cut is worse than
 * shipping no captions, because it reads as a transcription error to everyone
 * who sees it.
 *
 * ── WHAT THIS MODULE REFUSES TO DO ─────────────────────────────────────────
 * It does not transcribe. It does not invent, paraphrase, punch up, or
 * complete a half-heard sentence — every character it emits was copied out of
 * a stored transcript. It does not run ffmpeg; it returns strings and the
 * caller executes them. It does not read the database, the network, the clock,
 * or a random source. No transcript ⇒ no cues and a stated `reason`, never a
 * fabricated caption.
 *
 * Pure by construction. Locked by `tests/caption-track.test.ts`.
 */

// ─── Readability model ───────────────────────────────────────────────────────
// These are the craft numbers. Each one is a real constraint, not a guess.

/**
 * 32 characters per line. Derived from the renderer's own geometry rather than
 * picked: `worker/video-renderer` computes `maxChars = (W * 0.84) / (fs * 0.5)`
 * and draws timeline captions at fontsize 56 on a 1080-wide reel — which is
 * floor(907 / 28) = 32. Matching it means a cue that passes the cap here is a
 * cue that fits the frame there.
 */
export const MAX_CHARS_PER_LINE = 32;

/**
 * 2 lines. Short-form caption craft: 1–2 lines of big type sits in the lower
 * third; a third line starts covering the subject and reads as a wall of text
 * that viewers scroll past. Broadcast subtitling uses the same 2-line ceiling.
 */
export const MAX_CUE_LINES = 2;

/** 64 characters of speech per cue — the cap the grouper actually enforces. */
export const MAX_CUE_CHARS = MAX_CHARS_PER_LINE * MAX_CUE_LINES;

/**
 * 0.8s minimum on screen. Below this a viewer registers a flash, not words;
 * a cue shorter than this is HELD (its end extended, never its start moved)
 * up to this length, and the hold is flagged on the cue.
 */
export const MIN_CUE_SECONDS = 0.8;

/**
 * 3.5s maximum. A caption still sitting there three and a half seconds later
 * has visibly stopped tracking the cut — in short-form, where a shot lasts
 * 2.5–6s (`brandcastPlanner`'s own segment clamp), it reads as mistimed.
 */
export const MAX_CUE_SECONDS = 3.5;

/**
 * 17 characters/second ≈ 200 wpm, the standard adult subtitle reading-rate
 * ceiling. Exceeding it is REPORTED on the cue (`tooFast`), never fixed by
 * moving the timing — the timing is the truth about when it was said.
 */
export const MAX_CHARS_PER_SECOND = 17;

/**
 * A cue is never one word — a single word alone on screen is an orphan and it
 * reads as a glitch. The one exception is a source unit that WAS a single word
 * ("Okay."); that is a whole utterance, not a split remainder.
 */
export const MIN_CUE_WORDS = 2;

/**
 * 0.6s of silence ends a cue. Same threshold `brandcastPlanner.mergeMomentsIntoBeats`
 * uses to decide a gap is a breath rather than a break — the two layers should
 * not disagree about where a thought ends.
 */
export const PAUSE_BREAK_SECONDS = 0.6;

/**
 * A cue must fill at least half the character budget before a "nicer" earlier
 * break is preferred, or clause-chasing produces a stutter of tiny cues.
 */
export const MIN_CUE_FILL = 0.5;

/** Below this, a cue clipped by a scene boundary is a flash — drop it instead. */
export const MIN_VISIBLE_SECONDS = 0.25;

/**
 * Above 40 cues the per-cue `drawtext` representation stops being viable — see
 * the justification on `captionFilters`.
 */
export const DRAWTEXT_CUE_LIMIT = 40;

/**
 * Break BEFORE these when a break is needed mid-clause: splitting a line so it
 * ends on "and" / "to" / "because" strands the connective away from what it
 * connects, which is the tell of a machine-cut caption.
 */
const LINKING_WORDS = new Set([
  "and", "but", "so", "or", "nor", "yet", "because", "since", "while", "when",
  "if", "that", "which", "who", "than", "as", "to", "of", "in", "on", "at",
  "for", "with", "from", "into", "about", "the", "a", "an",
]);

const TERMINAL_RE = /[.!?]["'’)\]]?$/;
const CLAUSE_RE = /[,;:—–]["'’)\]]?$/;

// ─── Input shapes (the real ones in this codebase) ───────────────────────────

/**
 * Word-level timing. NOT currently produced anywhere in this repo —
 * `wpw-workforce-sweep` calls Whisper with `response_format: "verbose_json"`
 * and no `timestamp_granularities`, so only segments come back. Accepted so
 * that turning word timings on later needs no change here.
 */
export interface TranscriptWord {
  start: number;
  end: number;
  word?: string | null;
  text?: string | null;
  speaker?: string | null;
  source_id?: string | null;
  sourceId?: string | null;
}

/**
 * Segment-level timing. Covers BOTH real shapes:
 *   • a Whisper `verbose_json` segment — `{ start, end, text }`
 *   • a `content_moments` row — `{ start_time, end_time, verbatim_quote,
 *     speaker, source_id }` (see `useBrandCast.fetchParsed`, which selects
 *     exactly those columns).
 */
export interface TranscriptSegment {
  start?: number | null;
  end?: number | null;
  start_time?: number | null;
  end_time?: number | null;
  text?: string | null;
  verbatim_quote?: string | null;
  speaker?: string | null;
  source_id?: string | null;
  sourceId?: string | null;
}

export type TranscriptInput =
  | { words: TranscriptWord[]; sourceId?: string | null }
  | { segments: TranscriptSegment[]; sourceId?: string | null }
  | TranscriptSegment[]
  | string
  | null
  | undefined;

export type CueGranularity = "word" | "segment" | "none";

export interface CueCandidate {
  /** Verbatim. Copied, never rewritten. */
  text: string;
  sourceStart: number;
  sourceEnd: number;
  sourceId?: string;
  speaker?: string;
}

export interface CueCandidateSet {
  candidates: CueCandidate[];
  /**
   * Which timing the transcript actually carries. "segment" means every cue
   * boundary INSIDE a segment is interpolated, and each affected cue says so
   * via `estimatedTiming` — this module does not fake word timing and then
   * present it as measured.
   */
  granularity: CueGranularity;
  /** Populated whenever `candidates` is empty. Never null-and-empty. */
  reason: string | null;
  /** Rows rejected as non-speech (see `isSpeech`). */
  dropped: number;
}

// ─── Cue shapes ──────────────────────────────────────────────────────────────

export interface Cue {
  text: string;
  sourceStart: number;
  sourceEnd: number;
  sourceId?: string;
  speaker?: string;
  /** True when either boundary was interpolated inside a segment. */
  estimatedTiming: boolean;
  /** True when the end was extended to reach MIN_CUE_SECONDS. */
  displayHold: boolean;
  granularity: Exclude<CueGranularity, "none">;
}

/**
 * A scene as the edit emits it. Deliberately declared LOCALLY and structurally
 * rather than imported from `src/lib/editorCraft.ts`: the two modules are being
 * built in parallel and must be able to land independently. Anything carrying
 * these four numbers works.
 */
export interface CaptionScene {
  /** Bounds in the ORIGINAL clip. */
  sourceStart: number;
  sourceEnd: number;
  /** Position on the OUTPUT timeline (contiguous, first is 0). */
  outStart: number;
  outEnd: number;
  /**
   * Which clip this scene is cut from. When both the cue and the scene declare
   * one, they MUST match — otherwise a cue at t=5s of clip A happily lands on
   * a scene showing t=5s of clip B, which is the wrong-shot bug wearing a
   * different hat.
   */
  sourceId?: string | null;
  clipId?: string | null;
  sceneId?: string;
  role?: string;
}

export interface OutputCue extends Cue {
  /** Position on the OUTPUT timeline. This is what gets rendered. */
  outStart: number;
  outEnd: number;
  sceneIndex: number;
  sceneId?: string;
  /** True when a scene boundary cut this cue short. */
  clipped: boolean;
  /** Reading rate of the visible window. Reported, never corrected. */
  charsPerSecond: number;
  /** True when `charsPerSecond` exceeds MAX_CHARS_PER_SECOND. */
  tooFast: boolean;
}

export interface DroppedCue {
  text: string;
  sourceStart: number;
  sourceEnd: number;
  reason: string;
}

export interface RetimeResult {
  cues: OutputCue[];
  dropped: DroppedCue[];
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
};

/**
 * Is this actually speech? Whisper writes silence as punctuation — production
 * `content_moments` contains 96 quotes with no letter or digit in them at all,
 * 31 of which are a bare ".". It also emits bracketed non-speech annotations
 * ("[Music]", "(laughs)"). Burning either in is a visible defect, and neither
 * is a word anybody said.
 */
function isSpeech(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/^[[(][^\])]*[\])]$/.test(t)) return false; // annotation only
  return /[\p{L}\p{N}]/u.test(t);
}

// ─── 1. cuesFromTranscript ───────────────────────────────────────────────────

/**
 * Normalise whatever the parser stored into timed cue candidates.
 *
 * Accepts word-level timings if they ever exist, segment-level otherwise, a
 * bare `content_moments` row array, or the flat `media_sources.transcript`
 * string. The flat string has NO timing, so it yields zero cues and says why —
 * spreading it evenly across the clip would be inventing timing.
 */
export function cuesFromTranscript(input: TranscriptInput): CueCandidateSet {
  const none = (reason: string): CueCandidateSet => ({
    candidates: [], granularity: "none", reason, dropped: 0,
  });

  if (input == null) return none("no transcript supplied");
  if (typeof input === "string") {
    return none(
      input.trim()
        ? "transcript is plain text with no timing (media_sources.transcript) — captions need per-line timing, so none were built"
        : "no transcript supplied",
    );
  }

  let granularity: Exclude<CueGranularity, "none">;
  let rows: Array<TranscriptWord | TranscriptSegment>;
  let fallbackSource: string | null = null;

  if (Array.isArray(input)) {
    granularity = "segment";
    rows = input;
  } else if (Array.isArray((input as { words?: unknown[] }).words)) {
    granularity = "word";
    rows = (input as { words: TranscriptWord[] }).words;
    fallbackSource = (input as { sourceId?: string | null }).sourceId ?? null;
  } else if (Array.isArray((input as { segments?: unknown[] }).segments)) {
    granularity = "segment";
    rows = (input as { segments: TranscriptSegment[] }).segments;
    fallbackSource = (input as { sourceId?: string | null }).sourceId ?? null;
  } else {
    return none("unrecognised transcript shape — expected words[], segments[], content_moments rows, or a transcript string");
  }

  if (!rows.length) return none("transcript has no timed rows");

  const candidates: CueCandidate[] = [];
  let dropped = 0;
  for (const r of rows) {
    const raw = String(
      (r as TranscriptWord).word ??
      (r as TranscriptSegment).verbatim_quote ??
      (r as TranscriptSegment).text ??
      "",
    ).replace(/\s+/g, " ").trim();
    const start = num((r as TranscriptSegment).start ?? (r as TranscriptSegment).start_time);
    const end = num((r as TranscriptSegment).end ?? (r as TranscriptSegment).end_time);
    if (!isSpeech(raw) || start == null || end == null || end <= start) { dropped++; continue; }
    const sourceId = (r.sourceId ?? r.source_id ?? fallbackSource) || undefined;
    const speaker = (r.speaker || undefined) as string | undefined;
    candidates.push({
      text: raw,
      sourceStart: start,
      sourceEnd: end,
      ...(sourceId ? { sourceId } : {}),
      ...(speaker ? { speaker } : {}),
    });
  }

  // Deterministic order: source, then time, then the text itself so equal
  // timestamps can never sort differently between runs.
  candidates.sort((a, b) =>
    (a.sourceId || "") < (b.sourceId || "") ? -1 :
    (a.sourceId || "") > (b.sourceId || "") ? 1 :
    a.sourceStart - b.sourceStart ||
    a.sourceEnd - b.sourceEnd ||
    (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

  if (!candidates.length) {
    return {
      candidates, granularity: "none", dropped,
      reason: dropped
        ? `all ${dropped} transcript row(s) were non-speech or untimed (punctuation-only silence, annotations, missing timestamps) — no captions built`
        : "transcript has no usable rows",
    };
  }
  return { candidates, granularity, reason: null, dropped };
}

// ─── 2. groupIntoCues ────────────────────────────────────────────────────────

interface PackedWord {
  text: string;
  start: number;
  end: number;
  /** These bounds came from the transcript, not from interpolation. */
  realStart: boolean;
  realEnd: boolean;
  sourceId?: string;
  speaker?: string;
  unit: number;
}

/**
 * Explode a candidate into words. For a word-level candidate this is a no-op
 * with both bounds real. For a segment it distributes the interior boundaries
 * by character proportion — the segment's OWN start and end stay exact, so a
 * cue that spans a whole segment still reports `estimatedTiming: false`.
 */
function expandUnit(c: CueCandidate, unit: number): PackedWord[] {
  const words = c.text.split(" ").filter(Boolean);
  if (!words.length) return [];
  const totalChars = words.reduce((n, w) => n + w.length, 0) || 1;
  const span = Math.max(0, c.sourceEnd - c.sourceStart);
  const out: PackedWord[] = [];
  let acc = 0;
  for (let i = 0; i < words.length; i++) {
    const s = c.sourceStart + (acc / totalChars) * span;
    acc += words[i].length;
    const e = c.sourceStart + (acc / totalChars) * span;
    out.push({
      text: words[i],
      start: i === 0 ? c.sourceStart : s,
      end: i === words.length - 1 ? c.sourceEnd : e,
      realStart: i === 0,
      realEnd: i === words.length - 1,
      sourceId: c.sourceId,
      speaker: c.speaker,
      unit,
    });
  }
  return out;
}

/** A hard break between two adjacent words — never packed into one cue. */
function isBarrier(prev: PackedWord, next: PackedWord): boolean {
  if (prev.sourceId !== next.sourceId) return true;   // different clip entirely
  if ((prev.speaker || "") !== (next.speaker || "")) return true;
  if (TERMINAL_RE.test(prev.text)) return true;        // the sentence ended
  if (next.start - prev.end > PAUSE_BREAK_SECONDS) return true;
  return false;
}

export interface GroupOpts {
  maxChars?: number;
  maxSeconds?: number;
  minSeconds?: number;
}

/**
 * The readability model. Not "N words per cue" — cap by CHARACTERS and by
 * DURATION, then move the break to the nearest natural boundary (sentence end,
 * then clause punctuation, then before a linking word), and never strand a
 * one-word remainder.
 */
export function groupIntoCues(
  candidates: CueCandidate[] | CueCandidateSet,
  opts: GroupOpts = {},
): Cue[] {
  const set: CueCandidateSet = Array.isArray(candidates)
    ? { candidates, granularity: "segment", reason: null, dropped: 0 }
    : candidates;
  if (!set.candidates.length) return [];

  const maxChars = opts.maxChars ?? MAX_CUE_CHARS;
  const maxSeconds = opts.maxSeconds ?? MAX_CUE_SECONDS;
  const minSeconds = opts.minSeconds ?? MIN_CUE_SECONDS;
  const granularity: Exclude<CueGranularity, "none"> =
    set.granularity === "word" ? "word" : "segment";

  const words: PackedWord[] = [];
  set.candidates.forEach((c, i) => words.push(...expandUnit(c, i)));
  if (!words.length) return [];

  const charLen = (from: number, to: number) => {
    let n = 0;
    for (let i = from; i < to; i++) n += (i === from ? 0 : 1) + words[i].text.length;
    return n;
  };

  /** Exclusive end index for the cue starting at `s`, bounded by `cap`. */
  const chooseBreak = (s: number, cap: number): number => {
    let hard = s + 1;
    let chars = words[s].text.length;
    for (let j = s + 1; j < cap; j++) {
      const add = 1 + words[j].text.length;
      if (chars + add > maxChars) break;
      if (words[j].end - words[s].start > maxSeconds) break;
      chars += add;
      hard = j + 1;
    }
    if (hard >= cap) return cap;

    // Move the break to the best natural boundary that still fills the cue.
    let best = hard;
    let bestScore = 0;
    for (let k = s + 1; k <= hard; k++) {
      if (charLen(s, k) < maxChars * MIN_CUE_FILL) continue;
      const prev = words[k - 1].text;
      const score =
        TERMINAL_RE.test(prev) ? 3 :
        CLAUSE_RE.test(prev) ? 2 :
        (k < cap && LINKING_WORDS.has(words[k].text.toLowerCase().replace(/[^\p{L}']/gu, ""))) ? 1 :
        0;
      if (score >= bestScore) { bestScore = score; best = k; } // later break wins ties
    }
    let brk = bestScore > 0 ? best : hard;

    // Orphan guard: never leave a single word behind. Pull it in if it fits,
    // otherwise give the tail a second word by stepping the break back.
    if (cap - brk === 1) {
      const wholeFits =
        charLen(s, cap) <= maxChars && words[cap - 1].end - words[s].start <= maxSeconds;
      if (wholeFits) brk = cap;
      else if (brk - s >= MIN_CUE_WORDS) brk -= 1;
    }
    return brk;
  };

  const cues: Cue[] = [];
  let i = 0;
  while (i < words.length) {
    let cap = i + 1;
    while (cap < words.length && !isBarrier(words[cap - 1], words[cap])) cap++;
    let s = i;
    while (s < cap) {
      const e = chooseBreak(s, cap);
      const slice = words.slice(s, e);
      const first = slice[0];
      const last = slice[slice.length - 1];
      cues.push({
        text: slice.map((w) => w.text).join(" "),
        sourceStart: round3(first.start),
        sourceEnd: round3(last.end),
        ...(first.sourceId ? { sourceId: first.sourceId } : {}),
        ...(first.speaker ? { speaker: first.speaker } : {}),
        estimatedTiming: !(first.realStart && last.realEnd),
        displayHold: false,
        granularity,
      });
      s = e;
    }
    i = cap;
  }

  // Minimum display duration. Only the END moves, only into empty space, and
  // only up to the next cue from the same clip — a held caption is standard
  // subtitle practice, but it must never overlap or overwrite the next line.
  for (let k = 0; k < cues.length; k++) {
    const dur = cues[k].sourceEnd - cues[k].sourceStart;
    if (dur >= minSeconds) continue;
    const next = cues[k + 1];
    const ceiling =
      next && next.sourceId === cues[k].sourceId ? next.sourceStart : Infinity;
    const wanted = Math.min(cues[k].sourceStart + minSeconds, ceiling);
    if (wanted > cues[k].sourceEnd) {
      cues[k].sourceEnd = round3(wanted);
      cues[k].displayHold = true;
    }
  }

  return cues;
}

// ─── 3. retimeToOutput — the critical one ────────────────────────────────────

function sameSource(cue: Cue, scene: CaptionScene): boolean {
  const s = (scene.sourceId ?? scene.clipId) || null;
  const c = cue.sourceId || null;
  // Unknown on either side cannot discriminate — a single-clip cut has no ids
  // to compare. When BOTH sides name a clip, the match is strict.
  if (!s || !c) return true;
  return s === c;
}

/**
 * Map cues from SOURCE time onto the OUTPUT timeline.
 *
 * This is the function that makes rearranged edits safe. Rules, all of which a
 * naive implementation gets wrong:
 *   • a cue is placed by the scene it OVERLAPS MOST, not by raw source time;
 *   • a cue overlapping no scene was CUT — it is dropped, never clamped;
 *   • a cue straddling a scene boundary is clipped to the visible part, since
 *     a cut can land mid-word and the caption must not outlive its shot;
 *   • the mapping is linear across the scene, so a speed-ramped scene (output
 *     duration ≠ source duration) still lands its words in the right place;
 *   • output cues are then de-overlapped, so two cues never stack on screen.
 */
export function retimeToOutput(cues: Cue[], scenes: CaptionScene[]): RetimeResult {
  const dropped: DroppedCue[] = [];
  if (!cues.length) return { cues: [], dropped };
  if (!scenes.length) {
    return {
      cues: [],
      dropped: cues.map((c) => ({
        text: c.text, sourceStart: c.sourceStart, sourceEnd: c.sourceEnd,
        reason: "no scenes — nothing is in the cut",
      })),
    };
  }

  const placed: OutputCue[] = [];
  for (const cue of cues) {
    let bestIdx = -1;
    let bestOverlap = 0;
    for (let i = 0; i < scenes.length; i++) {
      const sc = scenes[i];
      if (!sameSource(cue, sc)) continue;
      const ov = Math.min(cue.sourceEnd, sc.sourceEnd) - Math.max(cue.sourceStart, sc.sourceStart);
      if (ov > bestOverlap) { bestOverlap = ov; bestIdx = i; }
    }
    if (bestIdx === -1) {
      dropped.push({
        text: cue.text, sourceStart: cue.sourceStart, sourceEnd: cue.sourceEnd,
        reason: "source window is not in the cut — the editor removed these words",
      });
      continue;
    }

    const sc = scenes[bestIdx];
    const srcSpan = sc.sourceEnd - sc.sourceStart;
    const outSpan = sc.outEnd - sc.outStart;
    const scale = srcSpan > 0 ? outSpan / srcSpan : 0;
    const visStart = Math.max(cue.sourceStart, sc.sourceStart);
    const visEnd = Math.min(cue.sourceEnd, sc.sourceEnd);
    const clipped = visStart > cue.sourceStart + 1e-6 || visEnd < cue.sourceEnd - 1e-6;
    const outStart = round3(sc.outStart + (visStart - sc.sourceStart) * scale);
    const outEnd = round3(sc.outStart + (visEnd - sc.sourceStart) * scale);
    if (outEnd - outStart < MIN_VISIBLE_SECONDS) {
      dropped.push({
        text: cue.text, sourceStart: cue.sourceStart, sourceEnd: cue.sourceEnd,
        reason: `only ${round3(outEnd - outStart)}s of it survived the cut — too short to read`,
      });
      continue;
    }
    placed.push({
      ...cue,
      outStart,
      outEnd,
      sceneIndex: bestIdx,
      ...(sc.sceneId ? { sceneId: sc.sceneId } : {}),
      clipped,
      charsPerSecond: 0,
      tooFast: false,
    });
  }

  // Output order, deterministic down to equal timestamps.
  placed.sort((a, b) =>
    a.outStart - b.outStart ||
    a.outEnd - b.outEnd ||
    a.sceneIndex - b.sceneIndex ||
    (a.text < b.text ? -1 : a.text > b.text ? 1 : 0));

  // De-overlap. Only the earlier cue's END moves — its start is when the words
  // were said. A cue squeezed to nothing is dropped rather than flashed.
  const final: OutputCue[] = [];
  for (const cue of placed) {
    const prev = final[final.length - 1];
    if (prev && cue.outStart < prev.outEnd) {
      prev.outEnd = round3(cue.outStart);
      if (prev.outEnd - prev.outStart < MIN_VISIBLE_SECONDS) {
        final.pop();
        dropped.push({
          text: prev.text, sourceStart: prev.sourceStart, sourceEnd: prev.sourceEnd,
          reason: "overlapped off the timeline by the following cue",
        });
      }
    }
    final.push(cue);
  }
  for (const c of final) {
    const dur = Math.max(c.outEnd - c.outStart, 0.001);
    c.charsPerSecond = round3(c.text.length / dur);
    c.tooFast = c.charsPerSecond > MAX_CHARS_PER_SECOND;
  }

  return { cues: final, dropped };
}

// ─── 4. The ffmpeg representation ────────────────────────────────────────────

export interface CaptionRenderOpts {
  frameW?: number;
  frameH?: number;
  fontSize?: number;
  /** drawtext `fontfile` path. Must exist in the render container. */
  fontFile?: string;
  /** ASS `Fontname`. libass resolves it through fontconfig. */
  fontName?: string;
  position?: "top" | "center" | "bottom";
  uppercase?: boolean;
  /** Black plate behind the type (matches the worker's `box=1:boxcolor=black@0.55`). */
  boxed?: boolean;
  maxCharsPerLine?: number;
}

export interface CaptionRenderPlan {
  cueCount: number;
  /** A complete .ass document. Write it to disk; feed it to `subtitlesFilter`. */
  ass: string;
  /** One drawtext filter per cue, in output-time order. */
  drawtext: string[];
  /** Which representation this cue count should actually use. */
  recommended: "ass" | "drawtext";
  recommendedReason: string;
  /** Present when there is nothing to render, and says why. */
  reason: string | null;
}

/**
 * ── drawtext vs subtitle file: ASS wins, and it is not close ────────────────
 *
 * The worker's existing timeline-caption pass builds one `drawtext` filter per
 * caption with `enable='between(t,a,b)'` and joins them into a single `-vf`
 * chain. That is fine for the four or five overlays it renders today. It does
 * not survive a real speech track:
 *
 *   1. COMMAND LENGTH. Each cue's filter is ~250–400 characters once the font
 *      path, wrapped text and enable window are in it. A three-minute talking
 *      cut is 60–80 cues; a ten-minute one is 240+. At 240 cues the `-vf`
 *      argument passes 80KB and closes on Linux's MAX_ARG_STRLEN (128KB) —
 *      execve then fails with E2BIG and the render dies at the last step, the
 *      exact failure mode the Dockerfile comment already warns about for a
 *      missing font.
 *   2. COST PER FRAME. Every drawtext filter is evaluated on every frame
 *      whether or not `enable` is true. 240 filters × 30fps is real CPU on a
 *      container that is already the pipeline's slowest stage.
 *   3. CRAFT. libass gives per-cue positioning, outline + shadow, margins and
 *      safe areas from ONE style block. Reproducing that in drawtext means
 *      duplicating the styling into all 240 filter strings.
 *
 * So the ASS document is the primary output and `subtitlesFilter()` renders it
 * with a SINGLE filter. The drawtext array is kept as a fallback for two
 * honest reasons: it is the path the worker already proves works, and libass
 * availability is a property of the ffmpeg BUILD (Debian's ffmpeg package is
 * built with --enable-libass, but that should be confirmed with
 * `ffmpeg -filters | grep subtitles` in the container before anyone relies on
 * it). Above DRAWTEXT_CUE_LIMIT cues the fallback is not safe, and
 * `recommended` says so rather than letting a caller find out at render time.
 *
 * This function executes nothing. It returns strings.
 */
export function captionFilters(
  cues: OutputCue[],
  opts: CaptionRenderOpts = {},
): CaptionRenderPlan {
  const frameW = opts.frameW ?? 1080;
  const frameH = opts.frameH ?? 1920;
  const fontSize = opts.fontSize ?? 56;
  const fontFile = opts.fontFile ?? "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf";
  const fontName = opts.fontName ?? "DejaVu Sans";
  const position = opts.position ?? "bottom";
  const boxed = opts.boxed ?? true;
  // Same geometry the worker uses: usable width ≈ 84% of frame, and a bold
  // glyph is ≈ 0.5·fontsize wide.
  const maxCharsPerLine =
    opts.maxCharsPerLine ?? Math.max(8, Math.floor((frameW * 0.84) / (fontSize * 0.5)));

  if (!cues.length) {
    return {
      cueCount: 0,
      ass: assDocument([], { frameW, frameH, fontSize, fontName, position, boxed }),
      drawtext: [],
      recommended: "ass",
      recommendedReason: "nothing to render",
      reason: "no cues survived retiming — nothing was captioned",
    };
  }

  const lines = cues.map((c) =>
    wrapLines(opts.uppercase ? c.text.toUpperCase() : c.text, maxCharsPerLine));

  const drawtext = cues.map((c, i) => {
    const body = lines[i].map(drawtextEscape).join("\n");
    const box = boxed ? ":box=1:boxcolor=black@0.55:boxborderw=24" : "";
    return (
      `drawtext=fontfile='${fontFile}':text='${body}'` +
      `:fontcolor=white:fontsize=${fontSize}:line_spacing=10${box}` +
      `:x=(w-text_w)/2:y=${yExpr(position)}` +
      `:enable='between(t,${c.outStart.toFixed(3)},${c.outEnd.toFixed(3)})'`
    );
  });

  const overLimit = cues.length > DRAWTEXT_CUE_LIMIT;
  return {
    cueCount: cues.length,
    ass: assDocument(
      cues.map((c, i) => ({ cue: c, lines: lines[i] })),
      { frameW, frameH, fontSize, fontName, position, boxed },
    ),
    drawtext,
    recommended: "ass",
    recommendedReason: overLimit
      ? `${cues.length} cues exceeds DRAWTEXT_CUE_LIMIT (${DRAWTEXT_CUE_LIMIT}) — the drawtext chain is not safe at this size, use the ASS file`
      : `${cues.length} cues is within the drawtext fallback's limit, but the ASS file is still one filter instead of ${cues.length}`,
    reason: null,
  };
}

/** Bottom/top/center, matching `worker/video-renderer`'s `yForPosition`. */
function yExpr(position: "top" | "center" | "bottom"): string {
  if (position === "top") return "h*0.12";
  if (position === "center") return "(h-text_h)/2";
  return "h*0.78";
}

/**
 * drawtext-safe escaping. Byte-for-byte the worker's `esc()` — colons end a
 * filter option, a bare apostrophe terminates the quoted text (so it becomes a
 * typographic one, as the worker already does), a backslash is the escape
 * character itself, `%` starts a strftime expansion, and a raw newline inside
 * a single line would break the option. Getting any of these wrong produces a
 * filtergraph parse error that kills the whole render, which is why this is a
 * copy and not an improvement.
 */
export function drawtextEscape(text: string): string {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "’")
    .replace(/%/g, "\\%")
    .replace(/\r?\n/g, " ");
}

/**
 * ASS text escaping. Different rules entirely: `{` and `}` open and close an
 * override block (so a literal brace would silently swallow the rest of the
 * line), `\N` is a hard line break, and ASS has NO escape for a literal
 * backslash — it is substituted, the same class of substitution the worker
 * already applies to apostrophes. Colons, commas and `%` are all safe inside
 * the Text field because it is the LAST field on the Dialogue line.
 */
export function assEscape(text: string): string {
  return String(text)
    .replace(/\\/g, "/")
    .replace(/\{/g, "(")
    .replace(/\}/g, ")")
    .replace(/\r?\n/g, "\\N");
}

/**
 * Wrap to fit the frame. ffmpeg drawtext does NOT auto-wrap and libass is told
 * not to (`WrapStyle: 2`), so this module owns the line breaks — the worker
 * documents the bug this prevents: a long line ran off both edges of a
 * 1080-wide reel and got chopped.
 */
export function wrapLines(text: string, maxChars: number): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/** `H:MM:SS.cc` — the only timestamp format ASS accepts. */
export function assTime(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(c).padStart(2, "0")}`;
}

interface AssStyleOpts {
  frameW: number;
  frameH: number;
  fontSize: number;
  fontName: string;
  position: "top" | "center" | "bottom";
  boxed: boolean;
}

function assDocument(
  rows: Array<{ cue: OutputCue; lines: string[] }>,
  o: AssStyleOpts,
): string {
  // ASS alignment: 2 = bottom-centre, 5 = middle-centre, 8 = top-centre.
  const align = o.position === "top" ? 8 : o.position === "center" ? 5 : 2;
  // BorderStyle 3 = opaque plate behind the type (the worker's box look);
  // 1 = outline + drop shadow. ASS colours are &HAABBGGRR and the alpha byte
  // is INVERTED (00 opaque, FF invisible) — 0x73 ≈ 55% opacity, matching
  // `boxcolor=black@0.55`.
  const borderStyle = o.boxed ? 3 : 1;
  const back = o.boxed ? "&H73000000" : "&H00000000";
  const outline = o.boxed ? 6 : 4;
  const shadow = o.boxed ? 0 : 2;
  const marginV = Math.round(o.frameH * 0.1);
  const marginH = Math.round(o.frameW * 0.08);

  const head = [
    "[Script Info]",
    "; Generated by src/lib/captionTrack.ts — verbatim transcript, output-timeline cues.",
    "ScriptType: v4.00+",
    `PlayResX: ${o.frameW}`,
    `PlayResY: ${o.frameH}`,
    "WrapStyle: 2", // no automatic wrapping — captionTrack owns the line breaks
    "ScaledBorderAndShadow: yes",
    "YCbCr Matrix: TV.709",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: RP,${o.fontName},${o.fontSize},&H00FFFFFF,&H000000FF,&H00000000,${back},-1,0,0,0,100,100,0,0,${borderStyle},${outline},${shadow},${align},${marginH},${marginH},${marginV},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];

  const events = rows.map(({ cue, lines }) =>
    `Dialogue: 0,${assTime(cue.outStart)},${assTime(cue.outEnd)},RP,,0,0,0,,${lines.map(assEscape).join("\\N")}`);

  return [...head, ...events, ""].join("\n");
}

/**
 * The single filter that renders the ASS file. Filtergraph option values need
 * `\`, `:` and `'` escaped or the parser splits the path in the wrong place —
 * a `/tmp/...` path is fine today, but a job id with a colon in it would not
 * be, and that is exactly the kind of thing that fails once in production.
 */
export function subtitlesFilter(assPath: string): string {
  const p = String(assPath)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'");
  return `subtitles=${p}`;
}

// ─── One-call convenience ────────────────────────────────────────────────────

export interface CaptionTrack {
  cues: OutputCue[];
  dropped: DroppedCue[];
  granularity: CueGranularity;
  plan: CaptionRenderPlan;
  /** Non-null whenever there are no cues. The honest "why not". */
  reason: string | null;
}

/**
 * transcript + the edit's scenes → a renderable caption track.
 *
 * Every stage is exported separately so a caller can inspect or replace one;
 * this just wires them in the only correct order (source-time grouping FIRST,
 * retiming SECOND, rendering LAST — rendering from source time is the bug).
 */
export function buildCaptionTrack(
  transcript: TranscriptInput,
  scenes: CaptionScene[],
  opts: CaptionRenderOpts & GroupOpts = {},
): CaptionTrack {
  const set = cuesFromTranscript(transcript);
  if (!set.candidates.length) {
    return {
      cues: [], dropped: [], granularity: set.granularity,
      plan: captionFilters([], opts),
      reason: set.reason,
    };
  }
  const grouped = groupIntoCues(set, opts);
  const { cues, dropped } = retimeToOutput(grouped, scenes);
  const plan = captionFilters(cues, opts);
  return {
    cues,
    dropped,
    granularity: set.granularity,
    plan,
    reason: cues.length
      ? null
      : `every cue was cut from the edit (${dropped.length} dropped) — nothing was captioned`,
  };
}
