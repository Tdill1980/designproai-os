/**
 * narrativeArc — one topic becomes a SEQUENCE, and every beat is traceable.
 *
 * Owner, 2026-08-07, asked directly: "I want to use our OpenAI API to run fresh
 * hooks, and create narrative based on two things" — FOOTAGE and BRAND PILLARS
 * — where "narrative" means a multi-piece story arc per topic, not a label on a
 * batch of simultaneous posts.
 *
 * ── WHAT WAS ALREADY THERE, AND WHAT WAS NOT ───────────────────────────────
 * The spine exists. `content_narratives` (48 rows) + `content_artifacts` (669)
 * are written by `marketing-agent`'s `idea_approve` and the spine cron, and a
 * narrative already collects the pieces that carry a topic. What it does NOT do
 * is order them. Every artifact under a narrative today is planned for the same
 * moment, so a "narrative" is a fan-out, not a story: nothing opens, nothing
 * builds, nothing pays off.
 *
 * This module adds the missing dimension — ROLE and ORDER — and it adds it ON
 * THE EXISTING SPINE. There is no arc table. A beat is a `content_artifacts`
 * row like any other; what makes it a beat is its `kind` (`arc_beat_1`…), its
 * `target_id` pointing at the `content_moments` row it came from, and its
 * `links_to` pointing back at the beat before it. A parallel arc table that
 * drifted from the spine is the failure this repo pays for repeatedly.
 *
 * ── THE TWO INPUTS, LITERALLY ──────────────────────────────────────────────
 * FOOTAGE — `content_moments`, and both halves of it. Re-measured 2026-08-07
 * against production: 11,675 moments across 293 clips, of which 3,653 carry a
 * `verbatim_quote` (Whisper) and 8,017 carry a `visual_description` (gpt-4o
 * over frames), and ZERO carry both — they are separate passes writing separate
 * rows, so every consumer until now saw what was SAID or what was SHOWN, never
 * both for the same second. `joinMoments` below is that join, and it is free:
 * 8,029 speech×vision pairs overlap in time on the same clip, across 151 clips.
 *
 * How much that actually yields, stated precisely because the two numbers are
 * easy to confuse: those 8,029 are RAW overlaps, and `joinMoments` keeps only
 * the BEST overlap per speech row, so the join produces 804 corroborated
 * ("both") candidates — 22% of the speech rows, not most of them. The join is
 * still worth making, and a `both` beat is still the strongest thing an arc can
 * stand on; it is just rarer than the raw pair count suggests.
 *
 * BRAND PILLARS — `brand_pillars` (28 rows) supplies the topic's argument, and
 * `contentDoctrine.BRANDS[brand]` supplies the audience and what it is
 * interested in. `rankCandidates` runs the footage through the EXISTING
 * `hookEngine.rankFacts`, which already weights a fact by the brand's declared
 * interests hardest. That is what makes the ORDER audience-interest-led rather
 * than shoot-chronological — the owner's "interest based", which means start
 * from what the audience wants, not from what we want to say.
 *
 * ── THIS MODULE IS NOT A RANKER ────────────────────────────────────────────
 * It does not invent a strength signal and it does not invent a second one.
 * `content_moments.hook_score` / `soundbite_score` / `broll_score` are the
 * strength signal, read as-is; `rankFacts` is the interest ranker, imported.
 * What this adds is the ROLE FILTER — which kinds of truth can carry "open the
 * question" versus "show the work" — because that is a structural question a
 * ranker cannot answer.
 *
 * ── AND IT DOES NOT WRITE COPY ─────────────────────────────────────────────
 * Same line `hookEngine` and `videoAngles` hold. Pure code has no ear. This
 * chooses which real footage carries which role, states what the arc CANNOT
 * support, and assembles the brief; a model phrases the beats; `beatViolations`
 * checks the phrasing back against the footage afterwards.
 *
 * Pure by design: no database, no network, no clock, no AI call. A clock would
 * make the pre-spend fingerprint non-repeatable, which is the whole point of
 * it. Locked by `tests/narrative-arc.test.ts`.
 */

import type { ChannelKey } from "./contentDoctrine";
import { rankFacts, groundingViolations } from "./hookEngine";
import type { HookableFact, VideoIntelligence } from "./assetIntelligence";

// ─── What a beat is made of ──────────────────────────────────────────────────

/** Which parse backed this beat. Recorded on the row, shown in the UI. */
export type BeatSignal = "speech" | "vision" | "both";

/** A `content_moments` row, as much of it as an arc needs. */
export interface MomentRow {
  id: string;
  source_id: string;
  start_time: number | null;
  end_time: number | null;
  verbatim_quote?: string | null;
  visual_description?: string | null;
  hook_score?: number | null;
  soundbite_score?: number | null;
  broll_score?: number | null;
  install_stage?: string | null;
  /** Joined from `media_sources` — the human name of the clip. */
  clip_title?: string | null;
}

/**
 * One moment, after the speech/vision join, ready to be considered for a role.
 *
 * `momentId` is the SPEECH row where there is one, because that is the row a
 * reviewer will want to open — the quote is the thing a human argues about.
 */
export interface ArcCandidate {
  momentId: string;
  sourceId: string;
  clipTitle: string;
  startTime: number;
  endTime: number;
  /** The line that was said, if anything was. */
  verbatim: string | null;
  /** What the frame showed, if the vision pass ran over it. */
  visual: string | null;
  signals: BeatSignal;
  /** The moment's own score, read as-is. Null when nothing scored it. */
  score: number | null;
  /** The vision row that overlapped, when `signals` is "both". */
  visionMomentId: string | null;
  installStage: string | null;
}

// ─── The arc ─────────────────────────────────────────────────────────────────

export type ArcRoleKey = "open" | "stakes" | "work" | "payoff" | "proof";

export interface ArcRole {
  key: ArcRoleKey;
  label: string;
  /** What this beat DOES in the sequence. Goes into the model's brief. */
  job: string;
  /**
   * The kinds of truth that can carry this role. A HARD filter, not a
   * preference — a demonstration cannot open a question and a tension cannot
   * be the payoff, and letting the ranker decide that would produce a
   * five-beat arc of five near-identical beats, which is what a fan-out
   * already is.
   */
  wants: HookableFact["kind"][];
  /**
   * The minimum signal this role needs.
   *
   * This is the honest-shortfall detector. "Show the work" needs a PICTURE —
   * a transcript saying somebody squeegeed a panel is not footage of it — so
   * a topic whose clips are all speech produces a real, nameable gap ("we have
   * the words, film the squeegee pull") instead of a beat that promises a shot
   * nobody has.
   */
  needs: "speech" | "vision" | "either";
  /** The surface this beat is for. Drives `rankFacts`'s pillar weighting. */
  channel: ChannelKey;
  /** Days after the arc opens. The sequence is the product; this is its clock. */
  dayOffset: number;
  /**
   * What to film when the library cannot carry this role. Concrete enough for
   * a crew to shoot without asking a follow-up question — naming the missing
   * shot is the useful half of admitting the gap.
   */
  missingShot: string;
}

/**
 * The five beats, in order.
 *
 * Deliberately five and deliberately these: a question, its cost, the work, the
 * result, and somebody other than us saying it. That is the shortest sequence
 * that actually develops — drop the stakes and the payoff is unearned, drop the
 * proof and it is an advert.
 *
 * MUST STAY BYTE-IDENTICAL to ARC_ROLES in
 * `supabase/functions/content-narrative-arc/arc-roles.ts`. Edge functions are
 * Deno and cannot import from `src/`, so the table is mirrored there and
 * `tests/narrative-arc.test.ts` compares the two sources and fails the build if
 * they ever disagree — the same discipline as
 * `_shared/content-doctrine.ts`'s AD_PHRASES.
 */
export const ARC_ROLES: ArcRole[] = [
  {
    key: "open",
    label: "Open the question",
    job: "Put the audience inside a problem they recognise before naming anything we sell. It ends unresolved — the whole arc exists because this question is left open.",
    wants: ["tension", "statement", "emotion"],
    needs: "either",
    channel: "instagram",
    dayOffset: 0,
    missingShot: "Someone on camera naming the problem in their own words — the frustration, unprompted, in one sentence.",
  },
  {
    key: "stakes",
    label: "Name what it costs",
    job: "Make the question expensive. What the problem costs in hours, re-prints or a lost job — stated by someone who paid it, never estimated by us.",
    wants: ["tension", "detail", "proof", "statement"],
    needs: "speech",
    channel: "x",
    dayOffset: 2,
    missingShot: "A shop owner saying what the problem actually cost them — the hours, the re-print, the job that walked.",
  },
  {
    key: "work",
    label: "Show the work",
    job: "The craft, uncut. This is the beat that earns the right to claim anything later, and it has to be SEEN — the audience is here for the work itself.",
    wants: ["demonstration", "visual", "detail"],
    needs: "vision",
    channel: "youtube_short",
    dayOffset: 4,
    missingShot: "Hands-on footage of the step itself — the squeegee pull, the panel going on, the trim — shot close and steady.",
  },
  {
    key: "payoff",
    label: "Give the payoff",
    job: "The result the question was asking for. The finished thing, revealed — earned by the two beats before it rather than promised in the first.",
    wants: ["transformation", "result", "visual"],
    needs: "vision",
    channel: "instagram",
    dayOffset: 7,
    missingShot: "The finished vehicle revealed — a walk-around or a pull-away of the completed wrap, clean light.",
  },
  {
    key: "proof",
    label: "Let someone else say it",
    job: "Somebody who is not us says it worked. The arc closes in another person's voice, because the same sentence from us is an advert and from them it is evidence.",
    wants: ["proof", "result", "emotion", "statement"],
    needs: "speech",
    channel: "linkedin",
    dayOffset: 10,
    missingShot: "The customer or installer, on camera, saying what changed for them — unscripted, their words.",
  },
];

export const ARC_ROLE_KEYS = ARC_ROLES.map((r) => r.key);

/** The most beats one run may plan. A cap, so a run's cost is bounded. */
export const MAX_ARC_BEATS = ARC_ROLES.length;

/** How many candidate moments a model is shown per role. More is noise. */
export const CANDIDATES_PER_ROLE = 6;

export function arcRole(key: string): ArcRole | undefined {
  return ARC_ROLES.find((r) => r.key === key);
}

// ─── The artifact kinds an arc occupies on the spine ──────────────────────────

/**
 * `content_artifacts` has a UNIQUE index on (narrative_id, kind), so a beat's
 * ORDER lives in its kind. That is not a trick: it makes re-running an arc an
 * UPSERT of the same five rows rather than a stack of duplicates, and it means
 * the sequence is readable straight out of SQL with no join.
 */
export const ARC_PLAN_KIND = "arc_plan";
export function beatKind(index: number): string {
  return `arc_beat_${index + 1}`;
}
export function gapKind(roleKey: string): string {
  return `arc_gap_${roleKey}`;
}
export function isArcKind(kind: string): boolean {
  return kind === ARC_PLAN_KIND || /^arc_beat_\d+$/.test(kind) || /^arc_gap_[a-z]+$/.test(kind);
}

/** Every arc row carries this, so an arc is one `produced_by` filter away. */
export const ARC_PRODUCER = "narrative-arc";

// ─── The join that was never made ────────────────────────────────────────────

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** The moment's own score. Read, never re-derived. Null when nothing scored it. */
export function momentScore(m: MomentRow): number | null {
  const vals = [m.hook_score, m.soundbite_score, m.broll_score]
    .map((v) => (v === null || v === undefined ? null : Number(v)))
    .filter((v): v is number => v !== null && Number.isFinite(v));
  return vals.length ? Math.max(...vals) : null;
}

/**
 * Marry the transcription pass to the vision pass.
 *
 * Two passes have been writing separate rows for the same second of footage:
 * 3,653 speech rows, 8,017 vision rows, zero rows carrying both (production,
 * 2026-08-07). A speech row and a vision row on the SAME clip whose time ranges
 * overlap describe the same moment, so this pairs them — 8,029 such overlaps
 * exist across 151 clips, and because only the best overlap per speech row is
 * kept, 804 speech rows come out of here corroborated.
 *
 * Why an arc in particular needs this: a beat that has a line AND a picture can
 * carry a role reliably, because you can check whether the footage actually
 * SHOWS the thing the line claims. A speech-only beat cannot be checked that
 * way, and a vision-only beat has no words at all.
 *
 * Overlap, not containment: a 4-second quote and a frame sampled inside it are
 * the same moment even though neither contains the other.
 */
export function joinMoments(speech: MomentRow[], vision: MomentRow[]): ArcCandidate[] {
  const out: ArcCandidate[] = [];
  const usedVision = new Set<string>();

  const byClip = new Map<string, MomentRow[]>();
  for (const v of vision || []) {
    const list = byClip.get(v.source_id) || [];
    list.push(v);
    byClip.set(v.source_id, list);
  }

  for (const s of speech || []) {
    const sStart = num(s.start_time);
    const sEnd = num(s.end_time);
    // Best overlap, not first: a long quote can span several sampled frames and
    // the one that covers most of it is the one that describes it.
    let best: MomentRow | null = null;
    let bestOverlap = 0;
    for (const v of byClip.get(s.source_id) || []) {
      const overlap = Math.min(sEnd, num(v.end_time)) - Math.max(sStart, num(v.start_time));
      if (overlap > 0 && overlap > bestOverlap) {
        best = v;
        bestOverlap = overlap;
      }
    }
    if (best) usedVision.add(best.id);
    out.push({
      momentId: s.id,
      sourceId: s.source_id,
      clipTitle: String(s.clip_title || "untitled clip"),
      startTime: sStart,
      endTime: sEnd,
      verbatim: (s.verbatim_quote || "").trim() || null,
      visual: best ? (best.visual_description || "").trim() || null : null,
      signals: best ? "both" : "speech",
      score: best ? maxScore(momentScore(s), momentScore(best)) : momentScore(s),
      visionMomentId: best ? best.id : null,
      installStage: s.install_stage || best?.install_stage || null,
    });
  }

  // Vision moments nobody said anything over are still real footage — 133 of
  // 293 clips carry only ONE signal (production, 2026-08-07), and vision is far
  // and away the commoner one: 8,017 vision rows against 3,653 speech. Dropping
  // these would throw away most of the library. They just cannot carry a speech
  // role.
  for (const v of vision || []) {
    if (usedVision.has(v.id)) continue;
    out.push({
      momentId: v.id,
      sourceId: v.source_id,
      clipTitle: String(v.clip_title || "untitled clip"),
      startTime: num(v.start_time),
      endTime: num(v.end_time),
      verbatim: (v.verbatim_quote || "").trim() || null,
      visual: (v.visual_description || "").trim() || null,
      signals: "vision",
      score: momentScore(v),
      visionMomentId: v.id,
      installStage: v.install_stage || null,
    });
  }

  return out.filter((c) => c.verbatim || c.visual);
}

function maxScore(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

// ─── Candidate → fact, so the existing ranker can do its job ─────────────────

const RE_TENSION = /\b(problem|issue|mistake|wrong|fail|delay|bottleneck|struggl|stuck|hard|headache|waste|redo|re-?print|lost|slow)\w*\b/i;
const RE_DEMO = /\b(squeegee|heat|torch|trim|tuck|apply|applying|install|wrap(ping)?|peel|laminat|print(ing)?|panel|cut|align|stretch|post-?heat)\w*\b/i;
const RE_TRANSFORM = /\b(reveal|finish|before|after|transform|complete|done|unveil)\w*\b/i;
const RE_EMOTION = /\b(love|proud|excited|amazing|beautiful|happy|stoked|blown away|incredible)\w*\b/i;
const RE_RESULT = /\b(now|result|went from|since|turnaround|doubled|grew|saved|quit|switched)\b/i;
const RE_NUMBER = /\d/;

/**
 * Which KIND of truth this moment is.
 *
 * NOT a strength score and NOT a ranking — it is the classification
 * `hookEngine` already requires on every fact, and it is what lets the ROLE
 * filter work. Keyword-deterministic and inspectable on purpose, the same
 * discipline as `assetContentType.ts`: a human can see why a moment was called
 * a demonstration and overrule it.
 */
export function candidateKind(c: ArcCandidate): HookableFact["kind"] {
  const stage = (c.installStage || "").toLowerCase();
  const said = c.verbatim || "";
  const shown = c.visual || "";

  if (/reveal|final|finish|complete/.test(stage) || RE_TRANSFORM.test(shown)) return "transformation";
  if (RE_TENSION.test(said)) return "tension";
  if (said && RE_NUMBER.test(said)) return "proof";
  if (RE_EMOTION.test(said)) return "emotion";
  if (shown && RE_DEMO.test(shown)) return "demonstration";
  if (said && RE_RESULT.test(said)) return "result";
  if (said && RE_DEMO.test(said)) return "detail";
  if (!said && shown) return "visual";
  return "statement";
}

/** mm:ss, so a reviewer can scrub straight to it. */
export function timecode(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The evidence line that travels with a beat, everywhere it is shown. */
export function evidenceLine(c: ArcCandidate): string {
  return `${c.clipTitle} @ ${timecode(c.startTime)}–${timecode(c.endTime)}`;
}

/**
 * How much this moment can be leaned on.
 *
 * A moment backed by BOTH a line and a picture rates highest, because the two
 * passes corroborate each other. A single-signal moment that nothing scored
 * still counts — re-measured against production 2026-08-07, only 42 of 2,916
 * video speech moments carry ANY score, so requiring one would throw away 98.6%
 * of everything anyone ever said on camera. It sits above `WEAK_CONFIDENCE` but below a corroborated
 * one, which is exactly what it is: real, and unverified by a second pass.
 */
export function candidateConfidence(c: ArcCandidate): number {
  if (c.signals === "both") return 0.9;
  if (c.score !== null && c.score >= 7) return 0.75;
  if (c.score !== null) return 0.6;
  return 0.5;
}

export function candidateFact(c: ArcCandidate): HookableFact {
  const text = c.verbatim ? c.verbatim : String(c.visual || "");
  return {
    text,
    kind: candidateKind(c),
    evidence: evidenceLine(c),
    confidence: candidateConfidence(c),
  };
}

/** A key that maps a ranked fact back to the moment it came from. */
function factKey(f: HookableFact): string {
  return `${f.kind}|${f.text}|${f.evidence}`;
}

/**
 * The candidates as one asset, so `hookEngine` can consume them unchanged.
 *
 * The transcript is every line, and `visualEvents` is every frame description —
 * which means `groundingViolations` checks a written beat against BOTH halves.
 * That is the grounding rule the arc needs: a claim may rest on the transcript
 * OR on the visual description, never on neither.
 */
export function intelligenceFrom(candidates: ArcCandidate[]): VideoIntelligence {
  return {
    kind: "video",
    transcript: candidates.map((c) => c.verbatim).filter(Boolean).join("\n"),
    visualEvents: candidates.map((c) => c.visual).filter(Boolean) as string[],
    hookableFacts: candidates.map(candidateFact),
    claimsSupported: [],
  };
}

/**
 * Order the footage by what THIS brand's audience is interested in.
 *
 * The ordering is `hookEngine.rankFacts` — imported, not reimplemented. It
 * already weights a fact by the brand's declared `interests` hardest, then the
 * audience description, then the topic, and it weights the topic LIGHTLY on
 * purpose so the arc is not just whichever moment echoed our own wording back
 * at us. That is what "interest based" has to mean structurally: the audience's
 * concerns decide the order, the shoot's chronology does not.
 */
export function rankCandidates(
  candidates: ArcCandidate[],
  opts: { brand: string; topic: string; channel: ChannelKey },
): ArcCandidate[] {
  if (!candidates.length) return [];
  const intel = intelligenceFrom(candidates);
  const byKey = new Map<string, ArcCandidate>();
  for (const c of candidates) byKey.set(factKey(candidateFact(c)), c);

  const ranked = rankFacts(intel, {
    idea: opts.topic,
    brand: opts.brand,
    channel: opts.channel,
  });

  const out: ArcCandidate[] = [];
  const seen = new Set<string>();
  for (const f of ranked) {
    const c = byKey.get(factKey(f));
    if (c && !seen.has(c.momentId)) {
      seen.add(c.momentId);
      out.push(c);
    }
  }
  return out;
}

// ─── Planning the sequence ───────────────────────────────────────────────────

export interface PlannedBeat {
  index: number;
  role: ArcRole;
  candidate: ArcCandidate;
  /** Alternatives the model may pick instead — same role, also eligible. */
  alternatives: ArcCandidate[];
}

export interface ArcGap {
  role: ArcRole;
  /** Why nothing could carry it, in the reviewer's terms. */
  why: string;
  /** What to film. Copied from the role, so a crew gets one instruction. */
  missingShot: string;
}

export interface ArcPlan {
  brand: string;
  topic: string;
  beats: PlannedBeat[];
  gaps: ArcGap[];
  /** True only when every role found footage. */
  complete: boolean;
  /** The honest sentence a human reads first. */
  shortfall: string;
  /** Signal mix, for the UI and the report. */
  signalCounts: Record<BeatSignal, number>;
}

function satisfiesSignal(c: ArcCandidate, needs: ArcRole["needs"]): boolean {
  if (needs === "either") return true;
  if (needs === "speech") return c.signals === "speech" || c.signals === "both";
  return c.signals === "vision" || c.signals === "both";
}

/**
 * Assign the footage to the roles, in order, and REFUSE to fill what it cannot.
 *
 * Greedy over the interest-ranked list, one moment used once. A role takes the
 * highest-ranked unused candidate whose kind it wants and whose signal it
 * needs; if there is none it becomes a GAP with the shot to film.
 *
 * The refusal is the point. An arc that looks complete and is fabricated is
 * worse than a short honest one, because the short one tells the crew what to
 * shoot and the complete one tells them nothing while reading as finished work.
 */
export function planArc(
  candidates: ArcCandidate[],
  opts: { brand: string; topic: string; roles?: ArcRole[] },
): ArcPlan {
  const roles = (opts.roles || ARC_ROLES).slice(0, MAX_ARC_BEATS);
  const used = new Set<string>();
  const beats: PlannedBeat[] = [];
  const gaps: ArcGap[] = [];

  for (const role of roles) {
    // Ranked per role, because the role's CHANNEL changes which kind of truth
    // is weighted highest — the same footage genuinely ranks differently for a
    // "show the work" beat than for a "let someone else say it" beat.
    const ranked = rankCandidates(candidates, {
      brand: opts.brand,
      topic: opts.topic,
      channel: role.channel,
    });
    const eligible = ranked.filter(
      (c) =>
        !used.has(c.momentId) &&
        role.wants.includes(candidateKind(c)) &&
        satisfiesSignal(c, role.needs),
    );

    if (!eligible.length) {
      gaps.push({ role, why: gapReason(candidates, role, used), missingShot: role.missingShot });
      continue;
    }

    const [chosen, ...rest] = eligible;
    used.add(chosen.momentId);
    beats.push({
      index: beats.length,
      role,
      candidate: chosen,
      alternatives: rest.slice(0, CANDIDATES_PER_ROLE - 1),
    });
  }

  const signalCounts: Record<BeatSignal, number> = { speech: 0, vision: 0, both: 0 };
  for (const b of beats) signalCounts[b.candidate.signals]++;

  return {
    brand: opts.brand,
    topic: opts.topic,
    beats,
    gaps,
    complete: gaps.length === 0,
    shortfall: shortfallSentence(beats.length, roles.length, gaps),
    signalCounts,
  };
}

/**
 * Why a role found nothing — separating "wrong kind of moment" from "wrong kind
 * of footage", because they need different answers. The first is an editing
 * problem; the second is a shoot.
 */
function gapReason(candidates: ArcCandidate[], role: ArcRole, used: Set<string>): string {
  const free = candidates.filter((c) => !used.has(c.momentId));
  const rightKind = free.filter((c) => role.wants.includes(candidateKind(c)));
  const rightSignal = free.filter((c) => satisfiesSignal(c, role.needs));

  if (!free.length) {
    return "Every usable moment in this topic's footage is already carrying an earlier beat.";
  }
  if (rightKind.length && !rightSignal.length) {
    const want = role.needs === "vision" ? "shows it" : "says it";
    return `${rightKind.length} moment(s) are the right kind for this beat, but none ${want} — this role needs ${role.needs}, and the footage for this topic only carries the other signal.`;
  }
  if (!rightKind.length) {
    return `Nothing in this topic's footage reads as ${role.wants.join(" / ")}. The clips exist; they are about something else.`;
  }
  return `No moment satisfies both what this beat needs (${role.wants.join(" / ")}) and the ${role.needs} it has to carry.`;
}

function shortfallSentence(made: number, total: number, gaps: ArcGap[]): string {
  if (!gaps.length) {
    return `All ${total} beats are carried by real footage. Nothing in this arc was invented.`;
  }
  if (!made) {
    return `INCOMPLETE — 0 of ${total} beats. This topic has no footage that can carry any beat of the arc. Film: ${gaps.map((g) => g.missingShot).join(" · ")}`;
  }
  return `INCOMPLETE — ${made} of ${total} beats are real; ${gaps.length} could not be filled and were NOT invented. Missing: ${gaps.map((g) => `${g.role.label} (${g.missingShot})`).join(" · ")}`;
}

// ─── The pre-spend key ───────────────────────────────────────────────────────

/**
 * A stable fingerprint of what this run would ask the model to write.
 *
 * NO CLOCK, deliberately. The whole value of a pre-spend guard is that a retry
 * — a refresh, a double click, a re-run after a timeout — finds the answer that
 * was already bought instead of buying a second one. Anything time-varying in
 * here would make every retry a fresh charge, which is the failure the guard
 * exists to prevent. Same shape as `already_scored` in marketing-agent and
 * `already_designed` in the video renderer.
 *
 * FNV-1a rather than a crypto hash so it is synchronous and identical in the
 * browser, in Deno and in a test.
 */
export function arcFingerprint(
  brand: string,
  topic: string,
  momentIds: string[],
  roleKeys: string[] = ARC_ROLE_KEYS,
): string {
  const material = [
    brand.trim().toLowerCase(),
    topic.trim().toLowerCase(),
    [...momentIds].sort().join(","),
    [...roleKeys].join(","),
  ].join("|");

  let h = 0x811c9dc5;
  for (let i = 0; i < material.length; i++) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Second pass over the reversed material so two different briefs of the same
  // length cannot collide as easily as a single 32-bit pass allows.
  let g = 0x811c9dc5;
  for (let i = material.length - 1; i >= 0; i--) {
    g ^= material.charCodeAt(i);
    g = Math.imul(g, 0x01000193) >>> 0;
  }
  return `${h.toString(16).padStart(8, "0")}${g.toString(16).padStart(8, "0")}`;
}

/** The line the fingerprint is stored on, inside the arc_plan artifact body. */
export const FINGERPRINT_PREFIX = "Fingerprint:";

export function fingerprintOf(body: string | null | undefined): string | null {
  const m = String(body || "").match(/Fingerprint:\s*([0-9a-f]{16})/i);
  return m ? m[1].toLowerCase() : null;
}

// ─── Grounding, across BOTH signals ──────────────────────────────────────────

/**
 * Things a picture cannot prove.
 *
 * A visual description says what is in frame. It does not say what anyone felt,
 * what anything cost, or how long it took — "a person smiling" is not "a
 * delighted customer", and reading it that way is fabrication with a citation
 * attached, which is the most convincing kind. These only fire when the beat
 * has NO speech behind it: with a line, the words can carry the claim.
 */
const OVER_READ = [
  { re: /\b(delighted|thrilled|overjoyed|blown away|in love with|can'?t believe)\b/i, why: "reads an emotion off a picture" },
  { re: /\b(saved|cost|spent|paid|worth|cheaper|price|\$)\b/i, why: "puts money on a picture" },
  { re: /\b(hours?|days?|weeks?|minutes?|faster|quicker|overnight)\b/i, why: "puts a duration on a picture" },
  { re: /\b(customer|client) (said|told|loved|approved)\b/i, why: "puts words in someone's mouth off a picture" },
  { re: /\b(first|only|best|fastest|cheapest|never fails?)\b/i, why: "makes a superlative claim off a picture" },
];

/**
 * Check a written beat back against the footage it was supposed to come from.
 *
 * Two layers, and both are needed:
 *   1. `groundingViolations` — the existing engine, run over an asset built
 *      from BOTH the transcript and the frame descriptions, so a beat may rest
 *      on either. Catches invented numbers, invented quotes, unsupported
 *      charged claims, and copy written around the footage rather than from it.
 *   2. OVER-READ — the new one, and specific to this module: a vision-only beat
 *      that asserts something a picture cannot show.
 *
 * Fails OPEN on an empty beat or an empty asset, matching the convention the
 * rest of the codebase uses for judges. A real violation fails CLOSED — the
 * caller must not save the beat.
 */
export function beatViolations(
  written: string | null | undefined,
  candidate: ArcCandidate,
  intel: VideoIntelligence,
): string[] {
  const text = String(written || "").trim();
  if (!text) return [];

  const out = groundingViolations(text, intel);

  if (candidate.signals === "vision") {
    for (const rule of OVER_READ) {
      if (rule.re.test(text)) {
        out.push(
          `This beat ${rule.why}. Its only evidence is a frame description ("${String(candidate.visual || "").slice(0, 80)}…") — nobody says anything here. Rewrite it to what the shot actually shows, or attach a beat that has the line.`,
        );
      }
    }
  }

  return out;
}

// ─── Turning a plan into spine rows ──────────────────────────────────────────

export function formatBeatTitle(index: number, role: ArcRole, headline: string): string {
  return `${index + 1}. ${role.key} — ${headline}`.slice(0, 300);
}

/** The inverse, so the board can read a row back without a second source. */
export function parseBeatTitle(title: string): { index: number; roleKey: string; headline: string } | null {
  const m = String(title || "").match(/^(\d+)\.\s+([a-z]+)\s+—\s+([\s\S]*)$/);
  if (!m) return null;
  return { index: Number(m[1]) - 1, roleKey: m[2], headline: m[3].trim() };
}
