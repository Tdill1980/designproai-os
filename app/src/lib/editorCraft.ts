/**
 * editorCraft — the INTELLIGENCE editor. It cuts on what is actually in the
 * footage, and it recuts the same footage differently per content type.
 *
 * Owner, 2026-08-06, in his own words:
 *   "must act like a real editor — understands how to edit for viral,
 *    educational, entertaining — it cuts, rearranges for a faster more
 *    interesting edit"
 *   "the intelligent one cut real editing based on content"
 *   "recuts based on social content type"
 *   "finds viral hooks educational tips makes a relevant video"
 *
 * There are now two editors in this codebase and they are not the same thing.
 * The music-video editor cuts to a detected beat GRID — the audio decides where
 * the cuts land. This one cuts to CONTENT: what each beat is about decides what
 * job it does and therefore where it goes. Nothing here reads a waveform, and
 * nothing here decides anything from a timestamp while real evidence exists.
 *
 * `planStoryEditScenes` (brandcastPlanner) is the assembler this replaces: it
 * cold-opens on the highest-scoring beat, then plays everything else in SOURCE
 * ORDER with a flat 0.3s pad. That is a transcript with the silence removed. An
 * editor decides two things a sorter cannot:
 *
 *   ORDER  by narrative FUNCTION — read out of the parse's own facts, not out of
 *          when the camera happened to be rolling, and
 *   LENGTH by retention — the first shots are short because the first seconds
 *          decide whether anyone sees the rest.
 *
 * ── WHERE THE INTELLIGENCE COMES FROM (nothing is re-implemented here) ───────
 *
 *   `assetIntelligence.HookableFact.kind` IS the narrative vocabulary. A
 *   `transformation` is a turn, a `result` is a payoff, a `tension` is an
 *   escalation. Roles are read from the content's own classification; the
 *   keyword reading of the spoken line is the FALLBACK, used only for a beat
 *   with no parse, and every beat says which of the two it got (`evidence`).
 *
 *   `hookEngine.rankFacts` decides which fact matters for a given pillar — it
 *   already holds the entertain-vs-educate weighting ("viral hook" vs
 *   "educational tip") and it is already tested. This module CALLS it rather
 *   than restating it, including for `kindLean`, which recovers the split by
 *   probing rankFacts instead of copying its table. CLAUDE.md is explicit about
 *   why (see the asset classifier: "Do NOT add a second classifier … they will
 *   drift"), and it means a change to the weighting reaches the cut for free.
 *
 *   `contentDoctrine.CHANNELS` / `Pillar` supply the surface vocabulary. What is
 *   genuinely new here — and lives nowhere else — is `CUT_TYPES`: the GRAMMAR of
 *   a cut per content type. That is a statement about editing, not about
 *   channels, which is why it is not in the doctrine.
 *
 * ── WHAT THIS MODULE REFUSES TO DO ───────────────────────────────────────────
 *
 * 1. IT NEVER CUTS INSIDE A LINE. CLAUDE.md's speech lock, born from the first
 *    live cut (mid-sentence chops, slow-mo'd dialogue, fades over dialogue —
 *    unusable): "Never trim inside speech, never speed-ramp dialogue, never fade
 *    over a line." So the speed comes from REORDERING whole speech beats,
 *    TIGHTENING visual-only beats, DROPPING weak beats outright, and deleting
 *    the dead air between beats — never from shortening a sentence. Every scene
 *    is routed through the shared `enforceSpeechCraft`, not a local copy, so a
 *    later edit to the pacing code still cannot violate it.
 * 2. It never emits a speed ramp or a fade. Visual beats are ALLOWED both, but a
 *    ramp makes a scene's output duration ≠ its source duration, and the output
 *    clock is what captions and overlays are timed against. Two clocks that can
 *    silently disagree is the exact bug `outStart`/`outEnd` exist to kill.
 * 3. It never removes flubs, filler or false starts — `badTakes.ts` owns that and
 *    runs BEFORE this. Beats arrive already cleaned.
 * 4. It never invents structure it cannot see. A beat with no facts, no speech
 *    and no score is `unclassified` and SAYS SO; footage carrying no educational
 *    content does not get a fabricated "tip" promoted into the lead — the gap is
 *    reported in `notes`. Honest gap over invented data, as everywhere else here.
 *
 * ── THE OUTPUT CLOCK ─────────────────────────────────────────────────────────
 * Once beats are rearranged, source time and output time diverge — beat 7 can be
 * the second shot on screen. Anything timed against SOURCE time (a caption, a
 * hook overlay) then lands over the wrong shot, and it reads as a caption bug
 * rather than an ordering one. So every scene carries `outStart`/`outEnd` (its
 * position in the FINISHED video, contiguous, starting at 0) beside
 * `sourceStart`/`sourceEnd` (its bounds in the source clip). Consumers time
 * against `out*`; the renderer trims against `source*`.
 *
 * Pure: no database, no network, no clock, no AI call, no randomness — an edit
 * must be reproducible, same input, same cut. Locked by
 * `tests/editor-craft.test.ts`.
 */

import {
  enforceSpeechCraft,
  type FastClip,
  type ParsedMoment,
  type PlanOpts,
  type PlannedScene,
} from "./brandcastPlanner";
import {
  EMPTY_VIDEO_INTELLIGENCE,
  contentTerms,
  provenFacts,
  type HookableFact,
  type VideoIntelligence,
} from "./assetIntelligence";
import { rankFacts } from "./hookEngine";
import { CHANNELS, type ChannelKey, type Pillar } from "./contentDoctrine";

// ─── What a beat is FOR ──────────────────────────────────────────────────────

/**
 * The narrative function of a beat. NOT its timeline position — position is what
 * we are deciding, so it cannot also be the input.
 *
 * `b_roll` is a real editorial function (the cutaway that lets a cut breathe),
 * not a shrug. `unclassified` is the shrug, and it is deliberately visible in
 * the output so a human can see which beats the evidence could not place.
 */
export type EditorialRole =
  | "hook"
  | "setup"
  | "escalation"
  | "turn"
  | "proof"
  | "payoff"
  | "b_roll"
  | "unclassified";

/** How a role was arrived at. The honesty flag: `content` was understood,
 * `language` and `score` were inferred, `none` was not known at all. */
export type RoleEvidence = "content" | "language" | "score" | "none";

/**
 * A beat that may carry what the parse understood about it.
 *
 * `facts` is structurally typed on purpose: a beat set with no parse is still a
 * valid input and still cuts (via the language fallback), so nothing upstream is
 * forced to produce intelligence before this module is useful.
 */
export interface IntelligentBeat extends ParsedMoment {
  /** What the asset parse found IN this beat (`assetIntelligence.HookableFact`). */
  facts?: HookableFact[];
}

export interface RoledBeat {
  beat: IntelligentBeat;
  role: EditorialRole;
  /** The parse's own classification of this beat, when there is one. */
  kind?: HookableFact["kind"];
  /** Which of the two "viral hook" / "educational tip" families this beat is in. */
  lean: "viral" | "educational" | "neutral" | "unknown";
  evidence: RoleEvidence;
  /**
   * The evidence that produced the role — the fact, or the matched phrase, or
   * why nothing matched. Same convention as `assetContentType`: return the
   * signal so a human can read the reasoning and override it, rather than a bare
   * label nobody can argue with.
   */
  because: string;
  hasSpeech: boolean;
  /** Proven facts for this beat, strongest first. */
  facts: HookableFact[];
  /** Position in the input array — the stable tie-break, and the source clock. */
  index: number;
  /**
   * Index of a beat this one cannot precede. Derived from CONTENT (a line that
   * opens by pointing at something it does not restate, or a numbered step in a
   * procedure), never from timestamps.
   */
  dependsOn?: number;
  /** Set by ordering: this beat is the cut's spine and is dropped last. */
  spine?: boolean;
}

/** A planned scene that also knows where it lands in the FINISHED video. */
export interface EditedScene extends PlannedScene {
  /** Start on the OUTPUT timeline, seconds. Scene 0 starts at 0. */
  outStart: number;
  /** End on the OUTPUT timeline, seconds. Equals the next scene's `outStart`. */
  outEnd: number;
  role: EditorialRole;
  /** Bounds in the SOURCE clip (identical to `start`/`end`; named for clarity). */
  sourceStart: number;
  sourceEnd: number;
  speed?: number;
  fadeIn?: boolean;
}

// ─── The grammar of a cut, per content type ──────────────────────────────────

export type CutType = "reel" | "short" | "story" | "carousel" | "tutorial" | "longform";

export interface CutGrammar {
  label: string;
  /** Which pillar this cut serves. The doctrine's vocabulary, not a new one. */
  pillar: Pillar;
  /**
   * Does the ORDER carry information? In a tutorial it does — the steps are the
   * lesson, and a "more interesting" rearrangement destroys the only thing the
   * viewer came for. In a reel it does not.
   */
  preserveStepOrder: boolean;
  /** Hard ceiling on the finished piece, seconds. */
  maxDuration: number;
  /** Shot-length multiplier. A tutorial shot has to be legible; a reel shot has
   * to be gone before you decide to leave. */
  pace: number;
  /** Roles this type kills FIRST when the cut is long. */
  cutsFirst: EditorialRole[];
  /** Which of the two things mined out of the footage leads. */
  leadsWith: "viral" | "educational";
  why: string;
}

/**
 * The recut table. Same beats, genuinely different films.
 *
 * This is the part the owner is describing with "recuts based on social content
 * type": a tutorial cut of an install leads with the demonstration and keeps the
 * steps in order because the order IS the information; a reel cut of the SAME
 * footage leads with the transformation or the moment something went wrong, and
 * the steps compress to almost nothing. If a tutorial and a reel come out of
 * here identical, the feature does not exist.
 */
export const CUT_TYPES: Record<CutType, CutGrammar> = {
  reel: {
    label: "Reel", pillar: "entertain", preserveStepOrder: false, maxDuration: 45, pace: 0.85,
    cutsFirst: ["setup", "unclassified", "escalation"], leadsWith: "viral",
    why: "Open on the transformation or the thing that went wrong. Process is texture here, not content — it compresses to almost nothing.",
  },
  short: {
    label: "Short", pillar: "entertain", preserveStepOrder: false, maxDuration: 60, pace: 0.9,
    cutsFirst: ["setup", "unclassified", "b_roll"], leadsWith: "viral",
    why: "Reel grammar written for search intent — the payoff still leads, but one usable thing has to survive the middle.",
  },
  story: {
    label: "Story", pillar: "entertain", preserveStepOrder: false, maxDuration: 15, pace: 0.7,
    cutsFirst: ["setup", "escalation", "unclassified", "proof"], leadsWith: "viral",
    why: "One moment, nothing else. Anything that needs context does not fit.",
  },
  carousel: {
    label: "Carousel", pillar: "educate", preserveStepOrder: true, maxDuration: 30, pace: 1.0,
    cutsFirst: ["b_roll", "unclassified", "escalation"], leadsWith: "educational",
    why: "Card-by-card: each beat has to stand alone and land in order.",
  },
  tutorial: {
    label: "Tutorial", pillar: "educate", preserveStepOrder: true, maxDuration: 600, pace: 1.35,
    cutsFirst: ["b_roll", "unclassified", "escalation"], leadsWith: "educational",
    why: "Lead with the demonstration, hold each step long enough to read, keep the sequence — the order is the lesson.",
  },
  longform: {
    label: "Long-form", pillar: "educate", preserveStepOrder: true, maxDuration: 1800, pace: 1.5,
    cutsFirst: ["unclassified", "b_roll"], leadsWith: "educational",
    why: "Room to let a thing play. The promise is stated once and then delivered in order.",
  },
};

export interface EditOpts extends PlanOpts {
  /** THE recut knob. Same footage, different film. */
  contentType?: CutType;
  /** Used only to derive a pillar/type when `contentType` is absent. */
  channel?: ChannelKey;
  /** Brand + topic are passed through to `rankFacts` so the same footage ranks
   * differently for a brand whose audience cares about different things. */
  brand?: string;
  topic?: string;
  /** Length of the opening shots, seconds. Short on purpose. */
  openShot?: number;
  /** Length once the viewer has committed, seconds. */
  midShot?: number;
  /** Length of the closing shots, seconds — tighten into the payoff. */
  closeShot?: number;
  /** How many shots the opening curve covers. */
  openScenes?: number;
  /** Most a VISUAL beat may be extended past its scored bounds, seconds. */
  handleMax?: number;
}

export const EDITOR_DEFAULTS = {
  openShot: 1.6,
  midShot: 4.5,
  closeShot: 2.6,
  openScenes: 3,
  handleMax: 0.5,
} as const;

/** The whole cut, including what could NOT be found. */
export interface EditedCut {
  scenes: EditedScene[];
  /** The beats that survived, in OUTPUT order. 1:1 with `scenes` unless photos
   * were interleaved (a still is a scene with no beat behind it). */
  roles: RoledBeat[];
  grammar: CutGrammar;
  contentType: CutType;
  mine: FootageMine;
  /** Honest reporting: gaps, fallbacks, and anything that was guessed. */
  notes: string[];
}

/** Roles → the legacy `purpose` union the worker and the render EDL still read. */
const ROLE_PURPOSE: Record<EditorialRole, PlannedScene["purpose"]> = {
  hook: "hook",
  setup: "b_roll",
  escalation: "proof",
  turn: "reveal",
  proof: "proof",
  payoff: "payoff",
  b_roll: "b_roll",
  unclassified: "proof",
};

/**
 * The parse's classification → the narrative job. The mapping the coordinator
 * spelled out, plus the three it did not: a `demonstration` is the show-me
 * evidence (and in a tutorial, the step), a `detail`/`statement` is context, and
 * a `visual` with no speech is the cutaway.
 */
const KIND_ROLE: Record<HookableFact["kind"], EditorialRole> = {
  transformation: "turn",
  tension: "escalation",
  emotion: "escalation",
  result: "payoff",
  demonstration: "proof",
  proof: "proof",
  detail: "setup",
  statement: "setup",
  visual: "b_roll",
};

const round1 = (n: number) => Math.round(n * 10) / 10;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const lerp = (a: number, b: number, t: number) => a + (b - a) * clamp(t, 0, 1);

/** Output duration of a scene. Divides by speed so a future ramp stays honest. */
export function sceneLength(s: { start: number; end: number; speed?: number }): number {
  return Math.max(0, s.end - s.start) / (s.speed && s.speed > 0 ? s.speed : 1);
}

// ─── Borrowing hookEngine's brain instead of copying it ──────────────────────

/**
 * Channels used ONLY as pillar selectors when calling `rankFacts`. hookEngine
 * derives the pillar from the channel (`CHANNELS[channel].pillars[0]`) and takes
 * no pillar argument, so this is how a cut asks it "rank these for an ENTERTAIN
 * surface". Locked by a test that re-derives each pillar from `CHANNELS` — if
 * the doctrine ever reorders a channel's pillars, that test fails loudly instead
 * of this module silently ranking for the wrong one.
 */
export const PILLAR_PROXY: Record<Pillar, ChannelKey> = {
  entertain: "instagram",
  educate: "blog",
  inspire: "pinterest",
};

const KIND_LIST: HookableFact["kind"][] = [
  "statement", "visual", "result", "transformation", "tension",
  "demonstration", "proof", "detail", "emotion",
];

const prefCache = new Map<Pillar, Map<string, number>>();

/**
 * Which fact kinds a pillar wants, RECOVERED from hookEngine rather than copied.
 *
 * One bare probe fact per kind — identical confidence, meaningless text, no
 * brand or topic vocabulary — so the only thing separating them inside
 * `rankFacts` is that pillar's own kind weighting. The returned order IS
 * hookEngine's table, read back out. A literal second copy of the weights here
 * is the thing CLAUDE.md warns about: two copies drift, and the day they
 * disagree the hook and the cut are telling different stories about the same
 * footage.
 */
function kindPreference(pillar: Pillar): Map<string, number> {
  const cached = prefCache.get(pillar);
  if (cached) return cached;
  const probes: HookableFact[] = KIND_LIST.map((kind, i) => ({
    text: `zzprobe${i}`, kind, evidence: `zzprobe${i}`, confidence: 0.9,
  }));
  const ranked = rankFacts(
    { ...EMPTY_VIDEO_INTELLIGENCE, hookableFacts: probes } as VideoIntelligence,
    { idea: "", brand: "", channel: PILLAR_PROXY[pillar] },
  );
  const out = new Map<string, number>();
  ranked.forEach((f, i) => { if (!out.has(f.kind)) out.set(f.kind, i); });
  for (const k of KIND_LIST) if (!out.has(k)) out.set(k, KIND_LIST.length);
  prefCache.set(pillar, out);
  return out;
}

/**
 * Is this kind of content a VIRAL HOOK or an EDUCATIONAL TIP?
 *
 * The owner names both as things the editor must find in the same footage. They
 * are not a new taxonomy — they are the two sides of hookEngine's pillar
 * weighting, so the answer is derived: a kind the entertain pillar ranks higher
 * than the educate pillar leans viral, and vice versa. `result` lands neutral
 * because both pillars weight it the same, which is true and worth saying rather
 * than forcing to a side.
 */
export function kindLean(kind: HookableFact["kind"]): "viral" | "educational" | "neutral" {
  const e = kindPreference("entertain").get(kind) ?? KIND_LIST.length;
  const d = kindPreference("educate").get(kind) ?? KIND_LIST.length;
  return e < d ? "viral" : d < e ? "educational" : "neutral";
}

/** Proven facts on a beat, strongest first. Anything too weak to ground a public
 * claim is too weak to move a shot, so `provenFacts`' bar is reused as-is. */
function factsOf(beat: IntelligentBeat): HookableFact[] {
  const raw = Array.isArray(beat?.facts) ? beat.facts : [];
  if (!raw.length) return [];
  const proven = provenFacts({ ...EMPTY_VIDEO_INTELLIGENCE, hookableFacts: raw } as VideoIntelligence);
  const order = new Map(raw.map((f, i) => [f, i] as const));
  return proven.slice().sort((a, b) => {
    const ca = a.confidence == null ? 0.6 : Number(a.confidence) || 0;
    const cb = b.confidence == null ? 0.6 : Number(b.confidence) || 0;
    return cb - ca || (order.get(a) ?? 0) - (order.get(b) ?? 0);
  });
}

/**
 * Rank every beat for a pillar, by the facts it carries. Beats with no facts get
 * no rank at all (not a zero) — the caller decides what to do with an unknown,
 * rather than a missing parse quietly scoring as "worst".
 */
function rankBeats(roles: RoledBeat[], pillar: Pillar, opts: EditOpts): Map<number, number> {
  const facts: HookableFact[] = [];
  const owner = new Map<HookableFact, number>();
  for (const r of roles) {
    for (const f of r.facts) {
      facts.push(f);
      if (!owner.has(f)) owner.set(f, r.index);
    }
  }
  const out = new Map<number, number>();
  if (!facts.length) return out;
  const ranked = rankFacts(
    { ...EMPTY_VIDEO_INTELLIGENCE, hookableFacts: facts } as VideoIntelligence,
    { idea: opts?.topic || "", brand: opts?.brand || "", channel: PILLAR_PROXY[pillar] },
  );
  ranked.forEach((f, i) => {
    const idx = owner.get(f);
    if (idx !== undefined && !out.has(idx)) out.set(idx, i);
  });
  return out;
}

// ─── Which film are we making? ───────────────────────────────────────────────

/**
 * Resolve the cut grammar. An explicit `contentType` wins; a channel supplies one
 * through the doctrine's own `formats`/`pillars`; with neither we cut a reel and
 * SAY we assumed it, because an unstated content type is a missing input, not a
 * default worth hiding.
 */
export function cutGrammarFor(opts: EditOpts = {} as EditOpts): { type: CutType; grammar: CutGrammar; note?: string } {
  const explicit = opts?.contentType;
  if (explicit && CUT_TYPES[explicit]) return { type: explicit, grammar: CUT_TYPES[explicit] };

  const rule = opts?.channel ? CHANNELS[opts.channel] : undefined;
  if (rule) {
    const fromFormat = (rule.formats || []).find((f) => (CUT_TYPES as Record<string, CutGrammar>)[f]) as CutType | undefined;
    if (fromFormat) {
      return { type: fromFormat, grammar: CUT_TYPES[fromFormat], note: `No contentType given — cut as a ${CUT_TYPES[fromFormat].label} from ${rule.label}'s first supported format.` };
    }
    // The channel has no format this module cuts (a blog, an email). Fall back on
    // its PILLAR, which is the part that still means something to an edit.
    const pillar = rule.pillars?.[0] || "educate";
    const type = (Object.keys(CUT_TYPES) as CutType[]).find((t) => CUT_TYPES[t].pillar === pillar) || "reel";
    return { type, grammar: CUT_TYPES[type], note: `${rule.label} has no video format — cut as a ${CUT_TYPES[type].label} on its ${pillar} pillar.` };
  }
  return { type: "reel", grammar: CUT_TYPES.reel, note: "No contentType and no channel given — assumed a Reel." };
}

// ─── Mining the footage for the two things ───────────────────────────────────

export interface MinedBeat {
  index: number;
  fact: HookableFact;
  why: string;
}

export interface FootageMine {
  /** The transformation / tension / emotion / visual moment. */
  viralHook?: MinedBeat;
  /** The demonstration / proof / detail / statement moment. */
  educationalTip?: MinedBeat;
  /** What this footage does NOT carry. Named, so nothing gets promoted to fill it. */
  gaps: string[];
}

/**
 * Find BOTH things in the same footage: the viral hook and the educational tip.
 *
 * They are different beats. The content type decides which leads and which is
 * support — but the mining happens first and happens once, so a piece of footage
 * that only carries one of them is CAUGHT rather than papered over. Footage with
 * no educational content does not get a weak beat promoted into a "tip"; the gap
 * is returned and the caller leads with what is actually there.
 */
export function mineFootage(roles: RoledBeat[], opts: EditOpts = {} as EditOpts): FootageMine {
  const gaps: string[] = [];
  const withFacts = roles.filter((r) => r.facts.length);
  if (!withFacts.length) {
    gaps.push("No beat carries parsed intelligence — nothing can be mined, only inferred from the spoken lines.");
    return { gaps };
  }

  const pick = (lean: "viral" | "educational", pillar: Pillar): MinedBeat | undefined => {
    const rank = rankBeats(roles, pillar, opts);
    const eligible = withFacts
      .filter((r) => r.facts.some((f) => kindLean(f.kind) === lean))
      .sort((a, b) => (rank.get(a.index) ?? Infinity) - (rank.get(b.index) ?? Infinity) || a.index - b.index);
    const best = eligible[0];
    if (!best) return undefined;
    const fact = best.facts.find((f) => kindLean(f.kind) === lean) as HookableFact;
    return {
      index: best.index,
      fact,
      why: `[${fact.kind}] ${fact.text} — ranks first for ${pillar} (${fact.evidence})`,
    };
  };

  const viralHook = pick("viral", "entertain");
  const educationalTip = pick("educational", "educate");
  const kinds = [...new Set(withFacts.flatMap((r) => r.facts.map((f) => f.kind)))].sort();
  if (!viralHook) {
    gaps.push(`No viral hook in this footage — it carries only ${kinds.join(", ")}, and nothing the entertain pillar ranks above the educate one.`);
  }
  if (!educationalTip) {
    gaps.push(`No educational tip in this footage — it carries only ${kinds.join(", ")}, so there is no demonstration, proof or detail to teach from.`);
  }
  return { ...(viralHook ? { viralHook } : {}), ...(educationalTip ? { educationalTip } : {}), gaps };
}

// ─── 1. ROLES ────────────────────────────────────────────────────────────────

/**
 * Language fallbacks. Used ONLY for a beat the parse never saw — deliberately
 * literal and inspectable, because its whole value is that a human can read the
 * rule and see why a beat was placed where it was. A model here would be
 * undebuggable and would break the "same input, same cut" guarantee.
 */
const PAYOFF_RE = /\b(that'?s why|so now|in the end|which is why|come see|check (?:us )?out|book (?:a|your)|\.com)\b/i;
const TURN_RE = /\b(that'?s when|turns out|until (?:we|i|they)|the problem (?:was|is)|what changed|suddenly|everything changed)\b/i;
const TURN_OPEN_RE = /^(?:but|then|instead)\b/i;
const PROOF_RE = /(\b\d|\bpercent\b|%|\bcustomers?\b|\bclients?\b|\bevery time\b|\bwe (?:built|printed|installed|shipped|made|did)\b|\bresult\b|\bsaved\b|\bsold\b|\bin real life\b)/i;
const SETUP_RE = /\b(when we started|used to|back then|before we|originally|the idea was|at first|we started (?:out|by)|i started)\b/i;

/**
 * A line that OPENS by pointing at something it does not restate. Play it before
 * the thing it points at and the viewer hears an answer to a question nobody
 * asked — the most audible artefact a rearranged cut can produce.
 */
const BACKREF_RE = /^(?:(?:and|so|but|then|because)\s+)*(?:that|this|it|they|those|these|there|then|he|she)\b/i;

/** Procedure language. A numbered step cannot be reordered in ANY cut type. */
const STEP_RE = /\b(first|next|then|after that|once (?:you|we|the|it)|step \w+|final(?:ly)?|last(?:ly)?|start by|begin by|now (?:you|we))\b/i;

function firstMatch(re: RegExp, text: string): string | null {
  const m = re.exec(text);
  return m ? m[0] : null;
}

/**
 * Classify each beat by narrative function — from the CONTENT first.
 *
 * Order of evidence, and each beat records which one it got:
 *   `content`  — the parse classified this beat (`HookableFact.kind`). A
 *                transformation is a turn, a result is a payoff. This is the
 *                real path and the one the owner is asking for.
 *   `language` — no parse, but there is a spoken line, so the line is read for
 *                what it is doing. Inferred, and marked inferred.
 *   `score`    — no parse, no speech, but the vision pass scored it: a cutaway.
 *   `none`     — nothing at all. `unclassified`, and it says so.
 *
 * The HOOK is chosen by CONTENT and by the cut's own pillar, not by hookScore:
 * that is what makes the tutorial and the reel open on different beats of the
 * same footage. hookScore is the fallback for footage with no parse.
 */
export function assignRoles(beats: IntelligentBeat[], opts: EditOpts = {} as EditOpts): RoledBeat[] {
  if (!beats?.length) return [];
  const { grammar } = cutGrammarFor(opts);

  const base: RoledBeat[] = beats.map((beat, index) => {
    const quote = String(beat?.quote || "").trim();
    const hasSpeech = quote.length > 0;
    const score = Number(beat?.hookScore) || 0;
    const facts = factsOf(beat);
    const top = facts[0];

    let role: EditorialRole;
    let because: string;
    let evidence: RoleEvidence;

    if (top) {
      role = KIND_ROLE[top.kind] || "escalation";
      evidence = "content";
      because = `content: [${top.kind}] ${top.text} (${top.evidence})`;
    } else if (hasSpeech) {
      evidence = "language";
      const payoff = firstMatch(PAYOFF_RE, quote);
      const turn = firstMatch(TURN_RE, quote) || firstMatch(TURN_OPEN_RE, quote);
      const proof = firstMatch(PROOF_RE, quote);
      const setup = firstMatch(SETUP_RE, quote);
      if (payoff) { role = "payoff"; because = `no parse — inferred from the line: payoff language "${payoff}"`; }
      else if (turn) { role = "turn"; because = `no parse — inferred from the line: pivot language "${turn}"`; }
      else if (proof) { role = "proof"; because = `no parse — inferred from the line: evidence "${proof.trim()}"`; }
      else if (setup) { role = "setup"; because = `no parse — inferred from the line: context language "${setup}"`; }
      else { role = "escalation"; because = "no parse and no role marker in the line — carries the middle"; }
    } else if (score > 0) {
      role = "b_roll";
      evidence = "score";
      because = `no parse and no speech — visual cutaway, hookScore ${score}`;
    } else {
      role = "unclassified";
      evidence = "none";
      because = "no parse, no speech and no hookScore — nothing to classify from";
    }

    const lean: RoledBeat["lean"] = top ? kindLean(top.kind) : "unknown";
    return {
      beat, role, lean, evidence, because, hasSpeech, facts, index,
      ...(top ? { kind: top.kind } : {}),
    };
  });

  // THE HOOK — content first, pillar-aware. Same footage, different opener per
  // content type, which is the whole point of the recut.
  const rank = rankBeats(base, grammar.pillar, opts);
  let hookIdx = -1;
  if (rank.size) {
    let best = Infinity;
    for (const [idx, r] of rank) {
      if (r < best) { best = r; hookIdx = idx; }
    }
  } else {
    let best = 0;
    base.forEach((r) => {
      const s = Number(r.beat.hookScore) || 0;
      if (s > best) { best = s; hookIdx = r.index; }
    });
  }

  const withHook = base.map((r) =>
    r.index !== hookIdx
      ? r
      : {
          ...r,
          role: "hook" as EditorialRole,
          because: rank.size
            ? `opens the cut — ranks first for the ${grammar.pillar} pillar; ${r.because}`
            : `opens the cut — top hookScore ${Number(r.beat.hookScore) || 0} (no parsed intelligence to rank on); ${r.because}`,
        },
  );

  return withDependencies(withHook);
}

/**
 * Dependencies, derived from CONTENT.
 *
 * Two sources, neither of them a timestamp:
 *
 *   BACK-REFERENCE — a line opening on "that / it / then" does not name its own
 *   subject, so it depends on the beat that supplies it: the beat sharing the
 *   most content vocabulary (`contentTerms`, the same tokeniser the Hook Engine
 *   grounds claims with). If nothing shares vocabulary, there is no dependency —
 *   an honest unknown, not a guess at the previous beat.
 *
 *   PROCEDURE — beats carrying step language are chained in the order the
 *   procedure was performed. Step 3 cannot precede step 1 in ANY cut type, not
 *   even a reel that is otherwise free to rearrange.
 */
function withDependencies(roles: RoledBeat[]): RoledBeat[] {
  const textOf = (r: RoledBeat) => [r.beat.quote || "", ...r.facts.map((f) => f.text)].join(" ");
  const stems = roles.map((r) => new Set(contentTerms(textOf(r)).map((t) => t.stem)));

  // Procedure chain: step beats in the order they were performed.
  const stepOrder = roles
    .filter((r) => STEP_RE.test(textOf(r)))
    .sort((a, b) => a.beat.start - b.beat.start || a.index - b.index);
  const stepPrev = new Map<number, number>();
  stepOrder.forEach((r, i) => { if (i > 0) stepPrev.set(r.index, stepOrder[i - 1].index); });

  return roles.map((r, i) => {
    const step = stepPrev.get(r.index);
    if (step !== undefined) {
      return { ...r, dependsOn: step, because: `${r.because}; step in a procedure — follows beat ${step}` };
    }
    const opener = firstMatch(BACKREF_RE, String(r.beat.quote || "").trim());
    if (!opener) return r;
    let best = -1;
    let bestShared = 0;
    let bestSize = 0;
    roles.forEach((other, j) => {
      if (j === i) return;
      let shared = 0;
      for (const s of stems[i]) if (stems[j].has(s)) shared++;
      if (shared > bestShared || (shared === bestShared && shared > 0 && stems[j].size > bestSize)) {
        best = other.index; bestShared = shared; bestSize = stems[j].size;
      }
    });
    if (best < 0 || bestShared === 0) {
      return { ...r, because: `${r.because}; opens on "${opener}" but nothing else shares its vocabulary — no antecedent found` };
    }
    return { ...r, dependsOn: best, because: `${r.because}; opens on "${opener}" — follows beat ${best}, which establishes ${bestShared} shared term(s)` };
  });
}

// ─── 2. ORDER ────────────────────────────────────────────────────────────────

/**
 * Rearrange for retention, in the grammar of the requested content type.
 *
 * The spine short-form rewards:
 *
 *   HOOK ....... the beat this cut's pillar ranks first, cold, no runway
 *   RECEIPT .... immediately — the evidence that says the hook was not
 *                clickbait. This is the biggest departure from source order and
 *                the reason the assembler feels slow: the proof of an opening
 *                claim is usually recorded minutes later.
 *   BODY ....... weakest → strongest, so intensity climbs instead of peaking at
 *                the front and sagging. RANKED BY CONTENT, not by timestamp.
 *   TURN ....... the pivot
 *   PAYOFF ..... last
 *
 * …except where the content type says the order carries information. A tutorial
 * or a carousel keeps its instructional body in the performed order, because a
 * "more interesting" rearrangement of a procedure destroys the only thing the
 * viewer came for.
 *
 * Chronology is never the organising principle. Real dependencies (back-
 * references, procedure steps — both derived from content) are repaired
 * afterwards by a stable topological pass; falling back to source order would
 * throw away the whole edit to protect one line.
 */
export function orderForRetention(roles: RoledBeat[], opts: EditOpts = {} as EditOpts): RoledBeat[] {
  if (roles.length < 2) return [...roles];
  if (roles.every((r) => r.role === "unclassified")) {
    // No evidence anywhere. A cut with nothing to go on gets no opinion.
    return [...roles].sort((a, b) => a.index - b.index);
  }
  const { grammar } = cutGrammarFor(opts);
  const rank = rankBeats(roles, grammar.pillar, opts);
  const rankOf = (r: RoledBeat) => rank.get(r.index) ?? Number.POSITIVE_INFINITY;

  const bestFirst = (a: RoledBeat, b: RoledBeat) => rankOf(a) - rankOf(b) || a.index - b.index;
  const worstFirst = (a: RoledBeat, b: RoledBeat) => rankOf(b) - rankOf(a) || a.index - b.index;
  const performed = (a: RoledBeat, b: RoledBeat) => a.beat.start - b.beat.start || a.index - b.index;
  const of = (...want: EditorialRole[]) => roles.filter((r) => want.includes(r.role));

  const hook = of("hook").sort(bestFirst);
  const proofs = of("proof").sort(bestFirst);
  const receipt = proofs.slice(0, 1);
  const setup = of("setup").sort(performed);
  const turn = of("turn").sort(grammar.preserveStepOrder ? performed : bestFirst);
  const payoff = of("payoff").sort(performed);
  const unknown = of("unclassified").sort(performed);
  const broll = of("b_roll").sort(bestFirst);
  const body = [...of("escalation"), ...proofs.slice(1)].sort(
    grammar.preserveStepOrder ? performed : worstFirst,
  );

  // The block SEQUENCE is the same for every content type — hook, receipt, then
  // the body, and the payoff last is not a genre convention. What the content
  // type changes is how each block is SORTED above (performed order for a
  // teaching cut, content rank for a viral one) and which beats survive the
  // budget below. Unclassified material sits in the body ahead of the turn —
  // never after the payoff, where an unplaceable beat would be the last thing on
  // screen.
  const spine = [...hook, ...receipt, ...setup, ...body, ...unknown, ...turn, ...payoff];

  // B-ROLL BREATHES BETWEEN SPEECH. Never before the hook→receipt pair: a
  // cutaway there delays the proof, the one thing the opening cannot afford.
  const withBroll: RoledBeat[] = [];
  const firstSlot = Math.min(2, spine.length);
  const stride = broll.length ? Math.max(2, Math.ceil((spine.length - firstSlot) / broll.length)) : 0;
  let b = 0;
  spine.forEach((r, i) => {
    withBroll.push(r);
    if (stride && b < broll.length && i >= firstSlot - 1 && (i - (firstSlot - 1)) % stride === 0) {
      withBroll.push(broll[b++]);
    }
  });
  while (b < broll.length) withBroll.push(broll[b++]);

  // SPINE — what the budget pass may not cut. Position, not content: these beats
  // are load-bearing because of the job they do HERE.
  const spineIdx = new Set<number>([
    ...hook.map((r) => r.index),
    ...receipt.map((r) => r.index),
    ...payoff.slice(-1).map((r) => r.index),
  ]);

  return repairDependencies(withBroll).map((r) => (spineIdx.has(r.index) ? { ...r, spine: true } : r));
}

/**
 * Stable topological repair: keep the editorial order, but never let a beat land
 * before the beat it points back at. A cycle (mutual back-references, which real
 * transcripts do produce) fails OPEN — take the next beat and move on rather
 * than deadlock, matching the QC judge convention in CLAUDE.md.
 *
 * THE LEAD IS EXEMPT. It is the cold open: showing the strongest moment out of
 * context and then earning it is the device, not a mistake, and it is the one
 * place a back-reference is allowed to land before its antecedent. Every other
 * beat follows what establishes it.
 */
function repairDependencies(order: RoledBeat[]): RoledBeat[] {
  if (order.length < 2) return [...order];
  const [lead, ...rest] = order;
  const out: RoledBeat[] = [lead];
  const pending = rest;
  const placed = new Set<number>([lead.index]);
  while (pending.length) {
    let i = pending.findIndex(
      (r) =>
        r.dependsOn === undefined ||
        placed.has(r.dependsOn) ||
        !pending.some((p) => p.index === r.dependsOn), // dependency dropped upstream
    );
    if (i === -1) i = 0;
    const [r] = pending.splice(i, 1);
    placed.add(r.index);
    out.push(r);
  }
  return out;
}

// ─── 3. PACE ─────────────────────────────────────────────────────────────────

/**
 * The shot-length curve. Short at the open (retention is decided in the first
 * seconds, and a long first shot is the most common way to lose it), lengthening
 * as commitment builds, tightening again into the payoff — scaled by the content
 * type, because a tutorial shot has to be readable and a story shot has to be
 * gone.
 *
 * This CAPS visual beats only. A speech beat runs its exact full length whatever
 * the curve says: the curve is a target, the speech lock is a rule.
 */
export function targetShotLength(i: number, n: number, opts: EditOpts = {} as EditOpts): number {
  const { grammar } = cutGrammarFor(opts);
  const scale = grammar.pace;
  const open = (opts.openShot ?? EDITOR_DEFAULTS.openShot) * scale;
  const mid = (opts.midShot ?? EDITOR_DEFAULTS.midShot) * scale;
  const close = (opts.closeShot ?? EDITOR_DEFAULTS.closeShot) * scale;
  if (n <= 1) return round1(mid);
  const openN = clamp(opts.openScenes ?? EDITOR_DEFAULTS.openScenes, 1, Math.max(1, n - 1));
  if (i < openN) return round1(lerp(open, mid, i / openN));
  const p = (i - openN) / Math.max(1, n - 1 - openN);
  const tighten = 0.75; // the last quarter of the body accelerates into the end
  return round1(p <= tighten ? mid : lerp(mid, close, (p - tighten) / (1 - tighten)));
}

/**
 * The adaptive pad — the replacement for the assembler's flat `pad = 0.3`.
 *
 * SPEECH GETS ZERO. The flat pad was applied to every beat including spoken
 * ones, and it is wrong twice over: `enforceSpeechCraft` defines a speech beat's
 * bounds as EXACTLY the beat, so a padded scene disagrees with the beat any
 * caption is timed to; and 0.3s in front of a line reaches back into whatever
 * was said before it, which is how a half word gets glued to the head of a shot.
 *
 * A visual beat has no lock, so it may hold a handle — biggest in the middle,
 * where a shot is allowed to breathe, and ~0 at the open and the close, where
 * every frame is spent buying attention.
 */
export function padFor(rb: RoledBeat, i: number, n: number, opts: EditOpts = {} as EditOpts): number {
  if (rb.hasSpeech) return 0;
  const max = opts.handleMax ?? EDITOR_DEFAULTS.handleMax;
  if (n <= 2) return 0;
  const p = i / (n - 1);
  return round1(max * (1 - Math.abs(p - 0.5) * 2)); // triangular: 0 at both ends
}

/**
 * Turn an ordered beat list into scenes with a source trim AND an output
 * timeline.
 *
 * Speech beats: exact bounds, via the shared `enforceSpeechCraft` — the lock is
 * reused rather than reimplemented, so there is one definition of it in the
 * codebase and a change to the rule cannot miss this file.
 *
 * Visual beats: trimmed from the TAIL to the curve length (the head of a scored
 * visual moment is the moment), or extended by a handle when the scored window
 * is shorter than the curve wants — and that extension is clamped against the
 * neighbouring beats in the same source, because a handle running over the start
 * of the next spoken line clips a half word into a silent shot.
 */
export function paceScenes(ordered: RoledBeat[], opts: EditOpts = {} as EditOpts): EditedScene[] {
  const n = ordered.length;
  if (!n) return [];

  // Neighbour bounds per source, so a visual handle can never cross into an
  // adjacent beat's interior.
  const guards = new Map<number, { lo: number; hi: number }>();
  const bySource = new Map<string, RoledBeat[]>();
  for (const r of ordered) {
    const list = bySource.get(r.beat.sourceId) || [];
    list.push(r);
    bySource.set(r.beat.sourceId, list);
  }
  for (const list of bySource.values()) {
    list.sort((a, b) => a.beat.start - b.beat.start || a.index - b.index);
    list.forEach((r, k) => {
      guards.set(r.index, {
        lo: k > 0 ? list[k - 1].beat.end : 0,
        hi: k < list.length - 1 ? list[k + 1].beat.start : Number.POSITIVE_INFINITY,
      });
    });
  }

  const scenes = ordered.map((rb, i) => {
    const b = rb.beat;
    const target = targetShotLength(i, n, opts);
    let start = b.start;
    let end = b.end;

    if (!rb.hasSpeech) {
      const len = Math.max(0, b.end - b.start);
      if (len > target) {
        end = round1(b.start + target);
      } else {
        const guard = guards.get(rb.index) || { lo: 0, hi: Number.POSITIVE_INFINITY };
        const want = Math.min(padFor(rb, i, n, opts), (target - len) / 2);
        start = round1(Math.max(0, guard.lo, b.start - want));
        end = round1(Math.min(guard.hi, b.end + want));
      }
    }

    const scene = {
      sceneId: `ec_scene_${i}`,
      clipId: b.sourceId,
      clipUrl: b.clipUrl,
      start: round1(start),
      end: round1(end),
      purpose: ROLE_PURPOSE[rb.role],
      role: rb.role,
      ...(i === 0 && opts.hookText ? { text: opts.hookText, textPosition: "top" as const } : {}),
    };

    // The lock, applied last so nothing above can survive it.
    const locked = enforceSpeechCraft(scene, b);
    return {
      ...locked,
      sourceStart: locked.start,
      sourceEnd: locked.end,
      outStart: 0,
      outEnd: 0,
    } as EditedScene;
  });

  return layOutTimeline(scenes);
}

/**
 * Stamp the OUTPUT clock. Contiguous by construction — every scene starts where
 * the previous one ended — because a gap here is dead air in the finished video
 * and an overlap silently shifts every caption after it.
 *
 * Accumulated in integer tenths: 0.1 + 0.2 in floats is 0.30000000000000004, and
 * a consumer comparing `outStart === prev.outEnd` would fail on drift alone.
 */
function layOutTimeline(scenes: EditedScene[]): EditedScene[] {
  let tenths = 0;
  return scenes.map((s) => {
    const d = Math.max(1, Math.round(sceneLength(s) * 10)); // never a zero-length shot
    const out = { ...s, outStart: tenths / 10, outEnd: (tenths + d) / 10 };
    tenths += d;
    return out;
  });
}

// ─── 4. BUDGET ───────────────────────────────────────────────────────────────

/**
 * What gets cut when the edit is long. Weak material is DROPPED WHOLE; strong
 * material is never shortened — the opposite (trimming everything a bit) makes a
 * cut where nothing has room and nothing lands, and for speech beats it is
 * forbidden outright.
 *
 * The content type goes FIRST (`cutsFirst`): a reel kills setup, a tutorial
 * kills b-roll. After that this is the general order, and the spine (hook,
 * receipt, final payoff) is only touched when nothing else is left.
 */
const DROP_LADDER: EditorialRole[] = ["setup", "unclassified", "b_roll", "escalation", "proof"];

function pickDrop(list: RoledBeat[], grammar: CutGrammar): number {
  const ladder = [...new Set([...grammar.cutsFirst, ...DROP_LADDER])];
  for (const role of ladder) {
    let pick = -1;
    let worst = Number.POSITIVE_INFINITY;
    list.forEach((r, i) => {
      if (r.role !== role || r.spine) return;
      const s = Number(r.beat.hookScore) || 0;
      if (s <= worst) {
        // `<=` so ties resolve to the LATER beat: with equal evidence the earlier
        // one has already earned its place in the order above it.
        worst = s;
        pick = i;
      }
    });
    if (pick >= 0) return pick;
  }
  // Nothing but spine left — drop from the back, never the opener.
  for (let i = list.length - 1; i > 0; i--) if (list[i].role !== "hook") return i;
  return -1;
}

// ─── 5. THE CUT ──────────────────────────────────────────────────────────────

/**
 * Plan an edited cut: mine → classify → rearrange → pace → fit the budget, in
 * the grammar of the requested content type.
 *
 * Returns the scenes AND everything that was not found, because a cut assembled
 * over a gap looks exactly like a cut assembled over evidence.
 */
export function planCut(
  beats: IntelligentBeat[],
  images: FastClip[] = [],
  opts: EditOpts = {} as EditOpts,
): EditedCut {
  const { type, grammar, note } = cutGrammarFor(opts);
  const notes: string[] = note ? [note] : [];
  if (!beats?.length) {
    return { scenes: [], roles: [], grammar, contentType: type, mine: { gaps: ["No beats — nothing to cut."] }, notes };
  }

  const roles = assignRoles(beats, opts);
  const mine = mineFootage(roles, opts);
  notes.push(...mine.gaps);

  // WHAT LEADS — and an honest refusal when the footage cannot support it. A
  // tutorial of footage with no demonstration does not get a weak beat promoted
  // into a "tip"; it leads with what IS there and the gap is on the record.
  const wanted = grammar.leadsWith === "viral" ? mine.viralHook : mine.educationalTip;
  const other = grammar.leadsWith === "viral" ? mine.educationalTip : mine.viralHook;
  if (wanted) {
    notes.push(`${grammar.label} leads with the ${grammar.leadsWith === "viral" ? "viral hook" : "educational tip"}: ${wanted.why}`);
  } else if (other) {
    notes.push(`This footage carries no ${grammar.leadsWith === "viral" ? "viral hook" : "educational tip"} — a ${grammar.label} cut is not what it supports. Leading with what is actually there instead: ${other.why}`);
  }
  const guessed = roles.filter((r) => r.evidence !== "content").length;
  if (guessed) {
    notes.push(`${guessed} of ${roles.length} beat(s) had no parsed intelligence — their roles were inferred, not understood.`);
  }

  const maxScenes = Math.max(1, opts.maxScenes || 1);
  const still = opts.stillDuration ?? 2;
  // The content type is a harder statement of intent than a single number: a
  // 60-second target does not make a 60-second Story.
  const budget = Math.min(opts.targetDuration || grammar.maxDuration, grammar.maxDuration);
  if (opts.targetDuration && opts.targetDuration > grammar.maxDuration) {
    notes.push(`Target ${opts.targetDuration}s exceeds what a ${grammar.label} holds — capped at ${grammar.maxDuration}s.`);
  }

  // Photos are pattern interrupts, so they claim budget up front — otherwise the
  // beats spend it all and the stills push the cut past its target.
  const stillBudget = images.length ? Math.min(images.length * still, budget * 0.25) : 0;
  const stillCount = images.length
    ? Math.max(0, Math.min(images.length, Math.floor(stillBudget / still), maxScenes - 2))
    : 0;
  const beatBudget = Math.max(budget - stillCount * still, budget * 0.5);
  const beatMax = Math.max(1, maxScenes - stillCount);

  let ordered = orderForRetention(roles, opts);
  let scenes = paceScenes(ordered, opts);
  // Bounded: one beat leaves per pass, so this cannot run longer than the input.
  for (let guard = ordered.length; guard > 0; guard--) {
    const total = scenes.length ? scenes[scenes.length - 1].outEnd : 0;
    if (ordered.length <= 1) break;
    if (scenes.length <= beatMax && total <= beatBudget * 1.1) break;
    const drop = pickDrop(ordered, grammar);
    if (drop < 0) break;
    ordered = ordered.filter((_, i) => i !== drop);
    // Re-pace, don't patch: the curve is a function of POSITION, so removing a
    // shot changes the intended length of every shot after it.
    scenes = paceScenes(ordered, opts);
  }

  if (stillCount) {
    // Stills land after the hook→receipt pair, evenly spaced — a pattern
    // interrupt belongs where attention decays, not before the proof is shown.
    const merged: EditedScene[] = [];
    const firstSlot = Math.min(2, scenes.length);
    const stride = Math.max(1, Math.ceil((scenes.length - firstSlot) / stillCount));
    let s = 0;
    const still_ = (img: FastClip, id: string): EditedScene => ({
      sceneId: id,
      clipId: img.id || img.url,
      clipUrl: img.url,
      start: 0,
      end: still,
      purpose: "pattern_interrupt",
      role: "b_roll",
      sourceStart: 0,
      sourceEnd: still,
      outStart: 0,
      outEnd: 0,
    });
    scenes.forEach((scene, i) => {
      merged.push(scene);
      if (s < stillCount && i >= firstSlot - 1 && (i - (firstSlot - 1)) % stride === 0) {
        merged.push(still_(images[s], `ec_still_${i}`));
        s++;
      }
    });
    while (s < stillCount) { merged.push(still_(images[s], `ec_still_tail_${s}`)); s++; }
    scenes = layOutTimeline(merged);
  }

  return { scenes, roles: ordered, grammar, contentType: type, mine, notes };
}

/**
 * The scene list alone — signature-compatible with
 * `planStoryEditScenes(moments, images, opts)` so this can be swapped in at the
 * call site without reshaping anything around it. The returned scenes are
 * `PlannedScene`s with extra fields, so existing consumers (the worker,
 * `useBrandCast`) keep reading `start`/`end`/`purpose` unchanged.
 */
export function planEditedCut(
  beats: IntelligentBeat[],
  images: FastClip[] = [],
  opts: EditOpts = {} as EditOpts,
): EditedScene[] {
  return planCut(beats, images, opts).scenes;
}
