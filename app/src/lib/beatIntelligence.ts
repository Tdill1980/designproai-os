/**
 * beatIntelligence — ATTACH WHAT IS ACTUALLY IN A BEAT TO THE BEAT.
 *
 * Owner, 2026-08-06: "the intelligent one cut real editing based on content."
 *
 * `editorCraft` already knows how to cut on content. It reads
 * `assetIntelligence.HookableFact.kind` off each beat — a `transformation` is a
 * turn, a `result` is a payoff, a `tension` is an escalation — and it falls back
 * to reading the spoken line for keywords, or to the beat's hookScore, only when
 * a beat carries no facts.
 *
 * In production every beat carried no facts. The beats it receives are
 * `ParsedMoment`s built from `content_moments` rows — `start_time`, `end_time`,
 * `verbatim_quote`, `hook_score` — and nothing ever put a `facts` array on one.
 * So the fallback was not a fallback, it was the whole editor, and the feature
 * the owner asked for was wired to nothing.
 *
 * This module is the missing wire. It reads the evidence the system has already
 * paid for, derives facts in `assetIntelligence`'s own shape, and hands beats
 * back with `facts` attached — so `editorCraft` and `hookEngine` consume them
 * with no second vocabulary and no changes.
 *
 * ── WHAT THE SOURCES ACTUALLY CONTAIN (measured on production, 2026-08-07) ───
 *
 * 1. `agent_media_assets.visual_tags.asset_intelligence` — the richest source
 *    and the one preferred here. **0 of 746 rows carry it today**; `visual_tags`
 *    is NULL on every row in the table. The `asset-intelligence` function exists
 *    and works, it has simply never been run across the library. So this path is
 *    implemented and preferred, and it currently contributes nothing. That is
 *    stated rather than hidden: the day the backfill runs, coverage jumps and no
 *    code changes.
 *
 * 2. `content_moments` — 11,675 rows over 453 sources, and the shape matters:
 *    3,653 rows carry a `verbatim_quote` and 8,017 carry a `visual_description`,
 *    and **the two sets are disjoint** — 0 rows have both. Per source: 282 are
 *    quote-only (a transcript pass) and 171 are visual-only (a vision pass). A
 *    clip is speech-parsed OR vision-parsed, never both. So a speech beat has no
 *    `install_stage` and no `broll_score` to read, and a visual beat has no line
 *    to read. Both shapes are handled; neither is assumed.
 *
 *    The `words` column (word-level timing, migration
 *    `20260806234500_content_moments_words.sql`) **does not exist in production
 *    yet** — the migration is committed on this branch and applies on merge.
 *    Naming a missing column makes PostgREST reject the WHOLE query, which is
 *    exactly how `sourceFootage` silently broke both of its buttons, so the read
 *    here probes for it and retries without it rather than dying.
 *
 * 3. `media_sources.transcript` — 281 of 481 sources. It adds NO per-beat
 *    classification signal that the beat's own quote does not already carry: a
 *    beat's quote IS a slice of that transcript. Pretending otherwise would be a
 *    third "source" that does nothing. Its one honest job here is INTEGRITY —
 *    a beat whose quote does not appear in its source transcript is reported,
 *    because that is a real parse problem and nothing else in the chain looks.
 *
 * ── THE RULES THIS IS BUILT AROUND ───────────────────────────────────────────
 *
 * NEVER INVENT A FACT. Every emitted fact's `text` is a VERBATIM string from the
 * data — the beat's own quote, or the row's own visual description — never a
 * paraphrase, never a summary, never a sentence this module wrote. Every
 * `evidence` is a pointer a human can follow: a timecode plus that same verbatim
 * string. A beat with no usable evidence gets NO intelligence and takes
 * editorCraft's honest fallback. An empty result is a correct result.
 *
 * CLASSIFICATION IS EVIDENCE-BASED, NEVER POSITIONAL. Nothing here reads a
 * beat's index, its position in the array, or whether it is first or last.
 * Classifying the last beat as a payoff would rebuild the positional heuristic
 * inside the thing meant to replace it — the acceptance test would pass by
 * construction and the cut would be exactly as blind as before. Every kind comes
 * from a MARKER: a phrase actually present in the line, or an `install_stage`
 * actually recorded on the row. The marker is returned (`signals`), the same
 * convention as `assetContentType` — "return the matched signal so a human can
 * see the reasoning and override it".
 *
 * REPORT COVERAGE HONESTLY. `coverage` says how many beats got real intelligence
 * and how many fell back, and by which source. Without that number "the editor
 * is cutting on content" is unfalsifiable.
 *
 * ── WHAT IS DELIBERATELY NOT RE-IMPLEMENTED ──────────────────────────────────
 * `contentTerms` / `termStems` tokenise (assetIntelligence). `provenFacts` sets
 * the confidence bar. `hookEngine.KIND_WEIGHT` decides what a kind is worth per
 * pillar. `editorCraft.KIND_ROLE` turns a kind into a narrative job. None of
 * that is restated here — this module's only job is producing the kinds.
 *
 * ONE DELIBERATE MIRROR, DECLARED: `STAGE_KIND` and `visualConfidence` mirror
 * `kindForStage` and its confidence formula in
 * `supabase/functions/asset-intelligence/index.ts`. That is a Deno edge function
 * a browser bundle cannot import, and the alternative — leaving 8,017 vision
 * rows unclassified — is worse. It is a mirror in ONE place, exported, and
 * pinned by `tests/beat-intelligence.test.ts`, so a drift is visible instead of
 * silent. If the two are ever unified, unify them here.
 *
 * The pure half (everything above `attachIntelligence`) has no database, no
 * network, no clock and no randomness — same beats in, same facts out. The I/O
 * half is thin, and it distinguishes "the read failed" from "there was nothing
 * to read", because a query error reported as "no data" sends someone off to fix
 * the wrong thing. Locked by `tests/beat-intelligence.test.ts`.
 */

import {
  WEAK_CONFIDENCE,
  contentTerms,
  isVideoIntelligence,
  type AssetIntelligence,
  type HookableFact,
} from "./assetIntelligence";
import { type IntelligentBeat } from "./editorCraft";
import { type ParsedMoment } from "./brandcastPlanner";

// ─── What a beat's intelligence came from ────────────────────────────────────

/**
 * Where a beat's facts came from. Ordered by preference, and always reported —
 * "the parse understood this" and "a phrase in the line matched" are different
 * strengths of claim and a consumer is entitled to know which it got.
 */
export type IntelligenceSource =
  | "asset_intelligence"
  | "moment_visual"
  | "moment_speech";

export const SOURCE_LABEL: Record<IntelligenceSource, string> = {
  asset_intelligence: "stored asset intelligence",
  moment_visual: "vision-scored moment",
  moment_speech: "spoken line",
};

// ─── The evidence a beat is built from ───────────────────────────────────────

/** One word and where it is, from `content_moments.words`. */
export interface WordTiming {
  w: string;
  s: number;
  e: number;
}

/**
 * One `content_moments` row, as evidence. Field names mirror the columns so a
 * reader can go from here to the table without a translation step.
 *
 * Everything except `sourceId`/`start`/`end` is optional because production
 * genuinely has both shapes: a quote row has no stage and no b-roll score, a
 * visual row has no quote.
 */
export interface MomentEvidence {
  sourceId: string;
  start: number;
  end: number;
  quote?: string | null;
  visualDescription?: string | null;
  installStage?: string | null;
  speaker?: string | null;
  hookScore?: number | null;
  soundbiteScore?: number | null;
  brollScore?: number | null;
  /** NULL means word timing is unknown — never an empty array. */
  words?: WordTiming[] | null;
}

/** Stored `visual_tags.asset_intelligence`, with the source it belongs to. */
export interface AssetIntelligenceRef {
  /** `media_sources.id` — the same id a beat's `sourceId` carries. */
  sourceId: string;
  intelligence: AssetIntelligence;
}

/** A fact, plus exactly why it exists. */
export interface FactDerivation {
  fact: HookableFact;
  source: IntelligenceSource;
  /** The rule that fired, by id. */
  rule: string;
  /** The literal text in the evidence that fired it — checkable by a human. */
  signal: string;
  /** Where the marker sits, when `words` made that knowable. */
  markerAt?: { start: number; end: number };
}

/** What was understood about one beat. Absent = nothing was understood. */
export interface BeatIntelligence {
  /** The same array put on `beat.facts`, strongest first. */
  facts: HookableFact[];
  /** The source of the strongest fact. */
  source: IntelligenceSource;
  /** Every source that contributed, in preference order. */
  sources: IntelligenceSource[];
  /** Plain language: what was found and what fired it. */
  because: string;
  /** The literal markers, so the reasoning is inspectable and overridable. */
  signals: string[];
  /** How many evidence rows overlapped this beat. */
  evidenceRows: number;
}

/** A beat that may now carry both the facts and the story of how it got them. */
export interface EnrichedBeat extends IntelligentBeat {
  intelligence?: BeatIntelligence;
}

// ─── Coverage ────────────────────────────────────────────────────────────────

export interface IntelligenceCoverage {
  beats: number;
  /** Beats that carry at least one real fact. */
  withIntelligence: number;
  /** Beats that will take editorCraft's language/score fallback. */
  fallback: number;
  /** Total facts attached. */
  facts: number;
  /** Beats by the source of their strongest fact. */
  bySource: Record<IntelligenceSource, number>;
  /** Had evidence, but no marker fired — an honest gap, not a guess. */
  evidenceButNoSignal: number;
  /** Had no evidence row at all. */
  noEvidence: number;
  /** `withIntelligence / beats`, 0-1. 0 beats → 0. */
  ratio: number;
}

function emptyCoverage(beats = 0): IntelligenceCoverage {
  return {
    beats,
    withIntelligence: 0,
    fallback: beats,
    facts: 0,
    bySource: { asset_intelligence: 0, moment_visual: 0, moment_speech: 0 },
    evidenceButNoSignal: 0,
    noEvidence: beats,
    ratio: 0,
  };
}

// ─── Small shared helpers ────────────────────────────────────────────────────

/** 45 → "0:45", 128 → "2:08". A timecode is evidence, so it must be readable.
 *  Same format the `asset-intelligence` function writes, so a human reading a
 *  fact cannot tell (and does not need to care) which path produced it. */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "2:08" / "0:45" inside a stored evidence string → seconds. */
export function parseTimecode(text: string | null | undefined): number | null {
  const m = /(\d+):([0-5]\d)\b/.exec(String(text || ""));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** The same normalisation `assetIntelligence` dedupes facts on. */
function factKey(t: string): string {
  return String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

const MAX_FIELD = 400;
const cap = (s: string) => (s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD - 1)}…` : s);

// ─── VISION EVIDENCE: install_stage → kind ───────────────────────────────────

/**
 * A recorded install stage is a real observation of the asset, made by a pass
 * that watched it. Mapped to the fact vocabulary.
 *
 * DECLARED MIRROR of `kindForStage` in
 * `supabase/functions/asset-intelligence/index.ts` — see the header. Exported so
 * there is exactly one browser-side copy and a test can pin it.
 */
export const STAGE_KIND: Record<string, HookableFact["kind"]> = {
  prep: "demonstration",
  squeegee: "demonstration",
  trim: "demonstration",
  heat: "demonstration",
  peel: "transformation",
  reveal: "result",
  "drive-by": "result",
  detail: "detail",
  interview: "statement",
};

export function kindForStage(stage: string | null | undefined): HookableFact["kind"] {
  return STAGE_KIND[String(stage || "").toLowerCase().trim()] || "visual";
}

/**
 * The bar a vision-scored frame must clear to be raw material.
 *
 * The `asset-intelligence` function's own bar, kept identical on purpose. Below
 * it a frame is still a real observation — of an empty room, of a person
 * shifting in a chair — and promoting it to a fact would put "person sitting at
 * a desk" in front of an editor as something to build a cut around. 4,049 of the
 * 8,017 vision rows in production clear it.
 */
export const VISUAL_EVIDENCE_MIN = 5;

/** Confidence from the b-roll score. Mirrors the server formula exactly. */
export function visualConfidence(broll: number): number {
  return Math.min(0.9, 0.5 + num(broll) / 20);
}

// ─── SPEECH EVIDENCE: what the line is DOING ─────────────────────────────────

/**
 * One reading of a spoken line.
 *
 * Every rule is a MARKER — a phrase that has to actually be in the line — and
 * the matched span is returned, so a classification is always traceable to text
 * a human can read. Nothing here looks at where the beat sits.
 *
 * `weight` is the base confidence, and it encodes SPECIFICITY, not importance:
 * "went from X to Y" states a change and can mean little else; "awesome" is a
 * word people use about everything. It is never derived from position or order.
 */
export interface SpeechRule {
  id: string;
  kind: HookableFact["kind"];
  re: RegExp;
  weight: number;
  why: string;
}

/**
 * THE RULES. Ordered by SPECIFICITY — the first that fires wins, because a line
 * that both quantifies an outcome and calls it awesome is primarily the outcome.
 * `emotion` is last for the same reason its weight is lowest: its vocabulary is
 * the loosest in the set and it fires on 7% of the library's speech beats, more
 * than any other rule.
 *
 * Written against the real transcripts (measured 2026-08-07). Every phrase in
 * here was found in production speech, not imagined: "going from a boring black
 * or white car to something crazy", "it's stressful it's stressful", "that's the
 * one thing you need to do every single time you do a job", "I developed a
 * system for the wrap industry", "man that's freaking awesome", "20 years in the
 * rap game", "one bad install can haunt you for years".
 */
export const SPEECH_RULES: readonly SpeechRule[] = Object.freeze([
  {
    id: "state-change",
    kind: "transformation",
    weight: 0.75,
    why: "States a before and an after — the line itself names the change.",
    re: /\b(?:went from\b[^.!?]{0,80}?\bto\b|going from\b[^.!?]{0,80}?\bto\b|turn(?:ing|ed|s)? (?:it |them |that )?into\b|used to\b|we switched\b|switched (?:to|from)\b|everything changed\b|changed everything\b|changed (?:my|his|her|their) life\b|no longer\b)/i,
  },
  {
    id: "quantified-outcome",
    kind: "result",
    weight: 0.75,
    why: "Names an amount or an outcome — a number or a completed consequence.",
    re: /(?:\$\s?\d|\b\d+(?:\.\d+)?\s?(?:%|percent)\b|\b[\d,]+\s?(?:jobs|cars|vehicles|trucks|customers|clients|orders|shops)\b|\bsaved (?:us|me|them|you)\b|\bdoubled\b|\btripled\b|\bpaid for itself\b|\bquarter of the price\b|\bended up\b|\bthe result (?:was|is)\b)/i,
  },
  {
    id: "stated-problem",
    kind: "tension",
    weight: 0.7,
    why: "Names a problem, a risk or a failure — the line says something is hard or went wrong.",
    re: /\b(?:stressful|nightmare|disaster|ruined|screwed|messed up|mistake|the problem (?:is|was)|(?:goes|went|go) wrong|fails?|failed|hardest|struggl\w*|frustrat\w*|the worst|haunts?|give up|no shortcuts|through the pain|one bad \w+)\b/i,
  },
  {
    id: "instruction",
    kind: "demonstration",
    weight: 0.7,
    why: "Teaches the viewer a step or a rule — instructional language addressed outward.",
    re: /\b(?:make sure|you (?:want|need|have|got|gotta) to|start by|begin by|first (?:you|we)|the trick is|the key is|here'?s how|this is how|what you do is|every single time|all you (?:do|need)|step \d|best advice|my advice|by hand)\b/i,
  },
  {
    id: "first-person-record",
    kind: "proof",
    weight: 0.7,
    why: "Claims something actually done, with the doer named — evidence of work, not opinion.",
    re: /\b(?:\d+ years?(?: in| of| doing| wrapping| printing| experience)|we(?:'ve| have)? (?:built|printed|installed|shipped|made|done|wrapped|developed|created)|i (?:built|developed|created|made|designed)|our (?:customers|clients|shops?|crews?)|every (?:job|time)|been doing this for|one (?:customer|truck) at a time)\b/i,
  },
  {
    id: "spec",
    kind: "detail",
    weight: 0.6,
    why: "Names a material, a measurement or a tool — a concrete specification.",
    re: /\b(?:\d+\s?(?:mil|mm|inch|inches|ft|feet|oz|gsm)|cast vinyl|laminate|3m|avery|oracal|ppf|plotter|squeegee|heat gun)\b/i,
  },
  {
    id: "positioning",
    kind: "statement",
    weight: 0.6,
    why: "States who this is or where to go — a named destination or an explicit positioning line.",
    re: /(?:\b[a-z0-9-]+\.(?:com|net|io|co)\b|\bwe don'?t just \w+|\bthis (?:ain'?t|isn'?t) just\b|\bit'?s not just\b)/i,
  },
  {
    id: "affect",
    kind: "emotion",
    weight: 0.55,
    why: "Says how someone feels about it, in their own words.",
    re: /\b(?:loved?|hated?|awesome|amazing|incredible|insane|sick|proud|excited|scared|blown away|freaking|stoked|beautiful|gorgeous|my dream|dreams?|passion\w*)\b/i,
  },
]);

export interface SpeechReading {
  rule: SpeechRule;
  /** The literal matched span. */
  signal: string;
  /** Every other rule that also fired, by id — converging evidence. */
  also: string[];
}

/**
 * Read a spoken line for what it is DOING. `null` when nothing fires, which is
 * the common and correct answer: 85% of the library's speech beats carry no
 * marker at all, and a beat with no marker must fall through to editorCraft's
 * own honest fallback rather than be labelled with a guess.
 */
export function readSpeech(quote: string | null | undefined): SpeechReading | null {
  const line = text(quote);
  if (!line) return null;
  let winner: { rule: SpeechRule; signal: string } | null = null;
  const also: string[] = [];
  for (const rule of SPEECH_RULES) {
    let m: RegExpExecArray | null = null;
    try {
      m = rule.re.exec(line);
    } catch {
      m = null; // a malformed rule must never take the cut down
    }
    if (!m) continue;
    if (!winner) winner = { rule, signal: String(m[0] || "").trim() };
    else also.push(rule.id);
  }
  if (!winner) return null;
  return { rule: winner.rule, signal: winner.signal, also };
}

/**
 * Where the marker sits in time, when `words` makes that knowable.
 *
 * NULL words means "we do not know where the words are" (the migration is
 * explicit that this is never an empty array), so this returns undefined rather
 * than interpolating — the same refusal the speech-craft lock is built on.
 */
export function locateSignal(
  words: WordTiming[] | null | undefined,
  signal: string,
): { start: number; end: number } | undefined {
  if (!Array.isArray(words) || !words.length) return undefined;
  const bare = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9']+/g, "");
  const wanted = String(signal || "").toLowerCase().split(/\s+/).map(bare).filter(Boolean);
  if (!wanted.length) return undefined;
  const seq = words.map((w) => bare(w?.w));
  for (let i = 0; i + wanted.length <= seq.length; i++) {
    let hit = true;
    for (let j = 0; j < wanted.length; j++) {
      if (seq[i + j] !== wanted[j]) { hit = false; break; }
    }
    if (!hit) continue;
    const a = words[i];
    const b = words[i + wanted.length - 1];
    const start = num(a?.s, NaN);
    const end = num(b?.e, NaN);
    if (!Number.isFinite(start) || !Number.isFinite(end)) return undefined;
    return { start, end };
  }
  return undefined;
}

// ─── Deriving facts from one beat's evidence ─────────────────────────────────

/**
 * Facts from a VISION row. `text` is the row's own description, verbatim — the
 * module never writes a sentence about a frame it cannot see.
 */
export function factsFromVisual(row: MomentEvidence): FactDerivation[] {
  const description = text(row?.visualDescription);
  if (!description) return [];
  const broll = num(row?.brollScore);
  if (broll < VISUAL_EVIDENCE_MIN) return [];
  const stage = text(row?.installStage).toLowerCase();
  const at = timecode(num(row?.start));
  return [{
    source: "moment_visual",
    rule: stage ? `stage:${stage}` : "stage:none",
    signal: stage || `b-roll ${broll}/10`,
    fact: {
      text: cap(description),
      kind: kindForStage(stage),
      evidence: cap(`frame at ${at} — "${description}" (content_moments, b-roll ${broll}/10)`),
      confidence: visualConfidence(broll),
    },
  }];
}

/**
 * The fact from a SPOKEN line. At most ONE.
 *
 * Two rules firing on one line is converging evidence about the SAME line, not
 * two facts: `assetIntelligence.hookableFacts()` dedupes on normalised text, so
 * a second fact carrying the identical quote would be silently dropped anyway —
 * and a ranked list showing the same sentence twice reads to a writer as two
 * independent pieces of proof. So the most specific reading wins and the others
 * are recorded as `also`, raising confidence rather than inventing a second row.
 */
export function factsFromSpeech(
  quote: string | null | undefined,
  ctx: {
    start?: number;
    speaker?: string | null;
    soundbiteScore?: number | null;
    words?: WordTiming[] | null;
  } = {},
): FactDerivation[] {
  const line = text(quote);
  if (!line) return [];
  const reading = readSpeech(line);
  if (!reading) return [];

  const sound = num(ctx.soundbiteScore);
  const confidence = clamp01(
    reading.rule.weight +
    Math.min(0.2, 0.02 * sound) +
    (reading.also.length ? 0.05 : 0),
  );
  const at = timecode(num(ctx.start));
  const who = text(ctx.speaker);
  const markerAt = locateSignal(ctx.words, reading.signal);
  return [{
    source: "moment_speech",
    rule: reading.rule.id,
    signal: reading.signal,
    ...(markerAt ? { markerAt } : {}),
    fact: {
      text: cap(line),
      kind: reading.rule.kind,
      evidence: cap(`spoken at ${at}${who ? ` by ${who}` : ""} — "${line}"`),
      confidence,
    },
  }];
}

/**
 * Stored asset facts that belong to THIS beat.
 *
 * Two links, neither of them positional:
 *
 *   TIMECODE — the stored evidence string carries the `m:ss` it came from
 *   (`frame at 3:04 — …`), and that second lands inside the beat's window.
 *
 *   TEXT IDENTITY — the stored fact's `text` IS the row's own quote or visual
 *   description (that is how `assembleFromStored` builds them), so an exact
 *   containment match against the beat's own text is a real link, not a
 *   similarity score.
 *
 * A fact matching neither belongs to no beat and is left alone. Attaching it to
 * the nearest beat would be the positional heuristic again, wearing a fact.
 */
export function locateAssetFacts(
  intelligence: AssetIntelligence | null | undefined,
  beat: { start: number; end: number; quote?: string },
  beatText: string,
): FactDerivation[] {
  if (!intelligence || typeof intelligence !== "object") return [];
  const raw: HookableFact[] = [
    ...(Array.isArray(intelligence.hookableFacts) ? intelligence.hookableFacts : []),
    ...(isVideoIntelligence(intelligence) && Array.isArray(intelligence.strongestMoments)
      ? intelligence.strongestMoments
      : []),
  ].filter((f) => f && typeof f === "object");

  const lo = num(beat?.start);
  const hi = Math.max(lo, num(beat?.end));
  const haystack = String(beatText || "").toLowerCase();
  const out: FactDerivation[] = [];
  const seen = new Set<string>();

  for (const f of raw) {
    const t = text(f?.text);
    const evidence = text(f?.evidence);
    // The grounding gate, same as everywhere: no evidence → not a fact.
    if (!t || !evidence) continue;
    const key = factKey(t);
    if (!key || seen.has(key)) continue;

    const at = parseTimecode(evidence);
    // A timecode is a whole second; a beat window is not. Round the bounds out
    // by half a second so a fact stamped "0:12" is not lost by a beat that
    // starts at 12.4 — the row it came from is the same row.
    const inWindow = at !== null && at >= Math.floor(lo) - 0.5 && at <= Math.ceil(hi) + 0.5;
    const sameText = key.length >= 12 && haystack.includes(t.toLowerCase());
    if (!inWindow && !sameText) continue;

    seen.add(key);
    out.push({
      source: "asset_intelligence",
      rule: inWindow ? "asset:timecode" : "asset:text",
      signal: inWindow ? `${timecode(at as number)} falls inside this beat` : `the beat restates "${t.slice(0, 48)}"`,
      // Verbatim, including its confidence: the stored fact was produced by a
      // pass that saw the asset. Rewriting it here would lose the thing that
      // made it worth preferring.
      fact: {
        text: cap(t),
        kind: (f.kind as HookableFact["kind"]) || "visual",
        evidence: cap(evidence),
        confidence: f.confidence === undefined || f.confidence === null
          ? 0.6
          : clamp01(num(f.confidence, 0.6)),
      },
    });
  }
  return out;
}

// ─── Applying it to a beat set (PURE) ────────────────────────────────────────

export interface ApplyOpts {
  /** Stored asset intelligence, keyed by `media_sources.id`. */
  assetIntelligence?: AssetIntelligenceRef[];
  /** Source transcripts, keyed by `media_sources.id` — integrity check only. */
  transcripts?: Record<string, string | null | undefined>;
}

export interface AppliedIntelligence {
  beats: EnrichedBeat[];
  coverage: IntelligenceCoverage;
  notes: string[];
}

/** Evidence rows that overlap this beat, in the same source. */
function evidenceFor(beat: ParsedMoment, rows: MomentEvidence[]): MomentEvidence[] {
  const id = String(beat?.sourceId || "");
  const lo = num(beat?.start);
  const hi = Math.max(lo, num(beat?.end));
  return rows.filter((r) => {
    if (String(r?.sourceId || "") !== id) return false;
    const rs = num(r?.start);
    const re = Math.max(rs, num(r?.end));
    return re >= lo && rs <= hi; // overlap — a merged beat spans several rows
  });
}

/**
 * Attach intelligence to a beat set from evidence already in hand.
 *
 * The pure half. Every decision below reads a beat's own content and its own
 * evidence rows; none reads `i`, the array length, or the beat's neighbours.
 * Shuffle the input and every beat keeps the same facts — that is the property
 * the acceptance test asserts, and it is what separates this from the heuristic
 * it replaces.
 */
export function applyIntelligence(
  beats: ParsedMoment[],
  evidence: MomentEvidence[] = [],
  opts: ApplyOpts = {},
): AppliedIntelligence {
  const list = Array.isArray(beats) ? beats.filter((b) => b && typeof b === "object") : [];
  const notes: string[] = [];
  if (!list.length) {
    return { beats: [], coverage: emptyCoverage(0), notes: ["No beats — nothing to attach intelligence to."] };
  }

  const rows = (Array.isArray(evidence) ? evidence : []).filter((r) => r && typeof r === "object");
  const assetBySource = new Map<string, AssetIntelligence>();
  for (const ref of Array.isArray(opts?.assetIntelligence) ? opts.assetIntelligence : []) {
    if (ref && typeof ref === "object" && ref.sourceId && ref.intelligence) {
      assetBySource.set(String(ref.sourceId), ref.intelligence);
    }
  }

  const coverage = emptyCoverage(list.length);
  coverage.noEvidence = 0;
  coverage.fallback = 0;
  let quoteNotInTranscript = 0;
  let assetSources = 0;

  const out: EnrichedBeat[] = list.map((beat) => {
    const mine = evidenceFor(beat, rows);
    // The beat's own quote is the sentence-complete thought (beats are merged
    // upstream by `mergeMomentsIntoBeats`); fall back to the rows it spans only
    // when the beat itself carries no line.
    const quote = text(beat?.quote) || mine.map((r) => text(r.quote)).filter(Boolean).join(" ");
    const visualText = mine.map((r) => text(r.visualDescription)).filter(Boolean).join(" ");
    const beatText = [quote, visualText].filter(Boolean).join(" ");

    const derivations: FactDerivation[] = [];

    // 1. STORED ASSET INTELLIGENCE — richest, preferred, and currently empty in
    //    production (0 of 746 rows). Implemented anyway: the backfill is a
    //    button, not a rewrite.
    const stored = assetBySource.get(String(beat?.sourceId || ""));
    if (stored) {
      assetSources++;
      derivations.push(...locateAssetFacts(stored, beat, beatText));
    }

    // 2. THE MOMENT ROWS. Vision rows carry a stage and a score; the spoken line
    //    carries markers. A source has one shape or the other, never both, so in
    //    practice exactly one of these two contributes.
    for (const row of mine) derivations.push(...factsFromVisual(row));
    if (quote) {
      const speechRow = mine.find((r) => text(r.quote)) || mine[0];
      derivations.push(...factsFromSpeech(quote, {
        start: num(beat?.start),
        speaker: speechRow?.speaker ?? null,
        soundbiteScore: speechRow?.soundbiteScore ?? null,
        words: speechRow?.words ?? null,
      }));
    }

    // 3. TRANSCRIPT INTEGRITY. Not a classification source — a check. A quote
    //    that is not in its own source's transcript means the parse disagrees
    //    with itself, and nothing else in the chain looks.
    const transcript = opts?.transcripts?.[String(beat?.sourceId || "")];
    if (quote && text(transcript) && !text(transcript).toLowerCase().includes(quote.toLowerCase().slice(0, 40))) {
      quoteNotInTranscript++;
    }

    if (!mine.length && !stored) coverage.noEvidence++;

    // Dedupe on normalised text — the same rule `hookableFacts()` applies
    // downstream, done here so the strongest survivor is chosen deliberately
    // rather than by whichever happened to be first.
    const byKey = new Map<string, FactDerivation>();
    derivations.forEach((d) => {
      const key = factKey(d.fact.text);
      if (!key) return;
      const prev = byKey.get(key);
      if (!prev || num(d.fact.confidence) > num(prev.fact.confidence)) byKey.set(key, d);
    });
    const kept = [...byKey.values()]
      .filter((d) => num(d.fact.confidence, 0.6) >= WEAK_CONFIDENCE)
      .sort((a, b) => num(b.fact.confidence) - num(a.fact.confidence));

    if (!kept.length) {
      coverage.fallback++;
      if (mine.length || stored) coverage.evidenceButNoSignal++;
      return { ...beat } as EnrichedBeat;
    }

    const facts = kept.map((d) => d.fact);
    const sources = [...new Set(kept.map((d) => d.source))];
    const primary = kept[0].source;
    coverage.withIntelligence++;
    coverage.facts += facts.length;
    coverage.bySource[primary]++;

    const because = kept
      .map((d) => `[${d.fact.kind}] ${SOURCE_LABEL[d.source]} · ${d.rule} — matched "${d.signal}"`)
      .join("; ");

    return {
      ...beat,
      facts,
      intelligence: {
        facts,
        source: primary,
        sources,
        because,
        signals: kept.map((d) => d.signal),
        evidenceRows: mine.length,
      },
    } as EnrichedBeat;
  });

  coverage.ratio = coverage.beats ? coverage.withIntelligence / coverage.beats : 0;

  notes.push(
    `${coverage.withIntelligence} of ${coverage.beats} beat(s) carry real intelligence (${Math.round(coverage.ratio * 100)}%); ${coverage.fallback} fall back to the editor's language/score heuristics.`,
  );
  const bits = (Object.keys(coverage.bySource) as IntelligenceSource[])
    .filter((s) => coverage.bySource[s] > 0)
    .map((s) => `${coverage.bySource[s]} from ${SOURCE_LABEL[s]}`);
  if (bits.length) notes.push(`By source: ${bits.join(", ")}.`);
  if (coverage.evidenceButNoSignal) {
    notes.push(
      `${coverage.evidenceButNoSignal} beat(s) had evidence but nothing in it classified them — no marker in the line, or a frame below the b-roll ${VISUAL_EVIDENCE_MIN}/10 bar. Honest gap, not a guess.`,
    );
  }
  if (coverage.noEvidence) {
    notes.push(`${coverage.noEvidence} beat(s) had no evidence row at all — nothing was read for them.`);
  }
  if (!assetSources) {
    notes.push(
      "No stored asset intelligence for any of these sources — every fact here was derived from content_moments. Running asset-intelligence over the library would raise this.",
    );
  }
  if (quoteNotInTranscript) {
    notes.push(
      `${quoteNotInTranscript} beat quote(s) do not appear in their source transcript — the parse disagrees with itself on those rows.`,
    );
  }

  return { beats: out, coverage, notes };
}

/**
 * The words a beat's intelligence can vouch for. Handy for a caller checking a
 * planned hook against the cut, and it uses `contentTerms` so a beat and a claim
 * are always tokenised the same way — a second tokeniser would drift and the
 * grounding checks would quietly stop agreeing.
 */
export function beatVocabulary(beat: EnrichedBeat | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const f of Array.isArray(beat?.facts) ? beat!.facts! : []) {
    for (const t of contentTerms(f?.text)) out.add(t.stem);
  }
  return out;
}

// ─── The I/O half ────────────────────────────────────────────────────────────

/**
 * The Supabase client is imported LAZILY, inside the one function that reads.
 *
 * Not a style choice: `integrations/supabase/client` touches `localStorage` at
 * module scope, so a static import makes this whole module unimportable outside
 * a browser — including in the Vitest run that locks the pure half. The rule
 * this file is built on is that the classification is testable in isolation, and
 * a top-level import of the client would quietly cost exactly that.
 */
async function db(): Promise<any> {
  const { supabase } = await import("@/integrations/supabase/client");
  return supabase as any;
}

/**
 * The columns that actually exist on `content_moments` (verified against the
 * live schema, 2026-08-07). `words` is NOT in this list on purpose — the
 * migration that adds it is committed but not applied, and naming a missing
 * column makes PostgREST reject the WHOLE query rather than ignore the field.
 * That is exactly how `sourceFootage` broke both of its buttons silently. It is
 * probed for separately below.
 */
const MOMENT_COLUMNS =
  "source_id, start_time, end_time, speaker, verbatim_quote, visual_description, hook_score, soundbite_score, broll_score, install_stage";

function evidenceFromRow(r: Record<string, any>): MomentEvidence {
  return {
    sourceId: String(r?.source_id || ""),
    start: num(r?.start_time),
    end: num(r?.end_time, num(r?.start_time)),
    quote: r?.verbatim_quote ?? null,
    visualDescription: r?.visual_description ?? null,
    installStage: r?.install_stage ?? null,
    speaker: r?.speaker ?? null,
    hookScore: r?.hook_score ?? null,
    soundbiteScore: r?.soundbite_score ?? null,
    brollScore: r?.broll_score ?? null,
    words: Array.isArray(r?.words) ? (r.words as WordTiming[]) : null,
  };
}

export interface AttachOpts extends ApplyOpts {
  /** Skip the read entirely and use these rows. */
  evidence?: MomentEvidence[];
  /** Cap on evidence rows read. Generous: a ten-minute interview is hundreds. */
  limit?: number;
  /** Skip the asset-intelligence read (it is one extra round trip). */
  skipAssetIntelligence?: boolean;
}

export interface BeatIntelligenceResult extends AppliedIntelligence {
  /**
   * "ok" or "read_failed". A read failure is NOT "no intelligence": reporting a
   * broken query as an empty library sends someone off to fix the parser when
   * the parse is fine and the read is not.
   */
  status: "ok" | "read_failed";
  /** Plain language, always set — including on success. */
  message: string;
  /** How many evidence rows were actually read — the honest denominator. */
  evidenceRows: number;
}

/**
 * Read the evidence for a beat set and attach it.
 *
 * Thin on purpose: three indexed reads and then the pure half does the work. No
 * model call — the intelligence is in having transcribed and vision-scored the
 * library already, not in re-reading it now.
 *
 * On ANY read failure it returns the beats UNCHANGED with `status:"read_failed"`
 * and the real error in `message`. The editor still cuts (it has its own honest
 * fallback); it just does not pretend the footage carried nothing.
 */
export async function attachIntelligence(
  moments: ParsedMoment[],
  opts: AttachOpts = {},
): Promise<BeatIntelligenceResult> {
  const beats = Array.isArray(moments) ? moments.filter((b) => b && typeof b === "object") : [];
  if (!beats.length) {
    return {
      status: "ok",
      beats: [],
      coverage: emptyCoverage(0),
      notes: ["No beats — nothing to attach intelligence to."],
      message: "No beats were passed in.",
      evidenceRows: 0,
    };
  }

  const sourceIds = [...new Set(beats.map((b) => String(b?.sourceId || "")).filter(Boolean))];
  if (!sourceIds.length) {
    const applied = applyIntelligence(beats, opts.evidence || [], opts);
    return {
      ...applied,
      status: "ok",
      message: "These beats carry no sourceId, so no evidence could be looked up. Every beat falls back.",
      evidenceRows: (opts.evidence || []).length,
    };
  }

  const notes: string[] = [];
  let rows: MomentEvidence[] = Array.isArray(opts.evidence) ? opts.evidence : [];
  const client = await db();

  if (!opts.evidence) {
    // Probe for `words`. If the column is not deployed the query fails whole, so
    // the retry is what keeps this working on both sides of the migration.
    let data: any[] | null = null;
    let err: any = null;
    for (const columns of [`${MOMENT_COLUMNS}, words`, MOMENT_COLUMNS]) {
      const res = await client
        .from("content_moments")
        .select(columns)
        .in("source_id", sourceIds)
        .order("start_time", { ascending: true })
        .limit(Math.max(1, opts.limit || 2000));
      if (!res?.error) { data = res?.data || []; err = null; break; }
      err = res.error;
      const msg = String(err?.message || "");
      // 42703 = undefined_column. Anything else is a real failure, not a schema
      // skew, and retrying without `words` would only hide it.
      if (String(err?.code) !== "42703" && !/words/i.test(msg)) break;
      notes.push("content_moments.words is not deployed yet — read without word timing, so no marker carries an exact word span.");
    }
    if (err) {
      return {
        status: "read_failed",
        beats: beats.map((b) => ({ ...b })) as EnrichedBeat[],
        coverage: emptyCoverage(beats.length),
        notes: [`Could not read content_moments — ${err?.message || String(err)}.`],
        message: `Could not read content_moments for ${sourceIds.length} source(s) — ${err?.message || String(err)}. This is a read failure, not footage without content.`,
        evidenceRows: 0,
      };
    }
    rows = (data || []).map(evidenceFromRow);
  }

  // Transcripts, for the integrity check only.
  const transcripts: Record<string, string | null> = { ...(opts.transcripts as any) };
  const assetRefs: AssetIntelligenceRef[] = [...(opts.assetIntelligence || [])];
  try {
    const { data: srcs } = await client
      .from("media_sources")
      .select("id, storage_url, transcript")
      .in("id", sourceIds);
    const urlToSource = new Map<string, string>();
    for (const s of srcs || []) {
      transcripts[String(s.id)] = s.transcript ?? null;
      if (s.storage_url) urlToSource.set(String(s.storage_url), String(s.id));
    }

    if (!opts.skipAssetIntelligence && urlToSource.size) {
      const { data: assets } = await client
        .from("agent_media_assets")
        .select("storage_url, visual_tags")
        .in("storage_url", [...urlToSource.keys()]);
      for (const a of assets || []) {
        const intel = a?.visual_tags?.asset_intelligence;
        const sourceId = urlToSource.get(String(a?.storage_url || ""));
        if (intel && sourceId) assetRefs.push({ sourceId, intelligence: intel as AssetIntelligence });
      }
    }
  } catch (e) {
    // Non-fatal: the moment evidence is the load-bearing read. Say so rather
    // than failing the whole attach over an enrichment lookup.
    notes.push(
      `Could not read media_sources/agent_media_assets — ${e instanceof Error ? e.message : String(e)}. Facts below come from content_moments only.`,
    );
  }

  const applied = applyIntelligence(beats, rows, { ...opts, transcripts, assetIntelligence: assetRefs });
  return {
    ...applied,
    notes: [...notes, ...applied.notes],
    status: "ok",
    message: `Read ${rows.length} evidence row(s) across ${sourceIds.length} source(s); ${applied.coverage.withIntelligence} of ${applied.coverage.beats} beat(s) got real intelligence.`,
    evidenceRows: rows.length,
  };
}
