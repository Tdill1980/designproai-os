/**
 * teachingBeats — WHAT HE IS DOING × WHAT HE IS TEACHING.
 *
 * Owner, 2026-08-07, verbatim:
 *
 *   "A lot of the video is just installers installing so we're gonna use that
 *    wraptvworld behind the install, but the AI should be passing everything
 *    because some of that video may have audio of installers giving tutorials
 *    and we need to chop all this up based on what he's doing, what he's
 *    teaching."
 *
 * Two axes, and they come from two different passes over the same footage:
 *
 *   DOING     is `content_moments.install_stage` — prep · squeegee · heat ·
 *             trim · peel · reveal · detail · drive-by · interview · other. A
 *             recorded OBSERVATION made by a pass that watched the frame. This
 *             module does not re-derive it, does not second-guess it, and does
 *             not invent a stage for a row that has none.
 *
 *   TEACHING  is in the WORDS, and nothing has ever read it. It is the hard
 *             half and the half that must not be faked: a tutorial beat is an
 *             instruction, a warning, a reason, a spec or a mistake-to-avoid,
 *             and it is detected from MARKERS actually present in the line.
 *
 * The valuable unit is the two ALIGNED: he is explaining heat while the vision
 * pass recorded `heat`. That pairing is what `segmentInstall` emits, carrying
 * BOTH pieces of evidence, in `assetIntelligence.HookableFact` shape so
 * `editorCraft` and `hookEngine` consume it with no second vocabulary.
 *
 * ── WHAT THE DATA ACTUALLY LOOKS LIKE (production, measured 2026-08-07) ──────
 *
 * `content_moments` holds 11,675 rows over 453 sources, and the two axes are
 * DISJOINT today: 3,658 rows carry a `verbatim_quote` and no stage; 8,017 carry
 * an `install_stage` and no quote. Per source: 282 speech-parsed, 171
 * vision-parsed, **0 with both**. A clip is transcribed OR vision-scored, never
 * both, so RIGHT NOW almost every teaching beat this module emits will report
 * `stage: null` — the parser fix that writes both onto one source is a
 * concurrent piece of work.
 *
 * That is designed for rather than worked around. Pairing is a lookup against
 * whatever staged rows exist in the same source; where there are none the beat
 * is still a teaching beat and says `stage: null` with a note explaining which
 * of the two reasons applies. The day a source carries both, the same code
 * pairs and nothing changes. `coverage.sourcesWithBoth` is the honest number to
 * watch.
 *
 * Stage rows are 8,017 of which 4,049 clear the b-roll bar the rest of the
 * system already uses (`beatIntelligence.VISUAL_EVIDENCE_MIN`), so roughly half
 * the staged frames are a real observation that is NOT worth cutting to. Both
 * facts are kept separate: the STAGE is always trusted (it is what the pass
 * saw), the FRAME is only offered as cutting material when it clears the bar.
 *
 * ── THE RULES THIS IS BUILT AROUND ──────────────────────────────────────────
 *
 * NEVER INVENT TEACHING. An installer working in silence is not teaching. A
 * clip with no transcript has NO teaching beats — not zero-confidence guesses,
 * not "probably a demonstration". Every teaching beat's `text` is the line as
 * spoken, verbatim, and every one carries the literal matched marker so a human
 * can read the reasoning and overrule it. No marker, no beat. Measured over the
 * library's real speech, most spoken lines are not teaching, and that is the
 * correct answer for them.
 *
 * A MARKER IS NOT ENOUGH ON ITS OWN. The corpus is interviews and song lyrics
 * as much as it is tutorials, and the same instructional frames appear in both:
 * "If you don't chase that dream, you're gonna forever be miserable" is a
 * conditional warning about nothing this show can teach. So every loose marker
 * additionally requires a CRAFT TERM in the same line. That is a deliberate,
 * declared narrowing — life advice with an instructional shape is not an
 * install lesson, and this module is not the judge of whether it is worth
 * anything else. An honest gap, not a guess.
 *
 * CLASSIFICATION IS NEVER POSITIONAL. Nothing here reads a row's index, its
 * position in the array, or whether it is first or last. Shuffle the input and
 * every beat keeps the same mode, the same stage and the same confidence — the
 * property `tests/teaching-beats.test.ts` asserts by actually shuffling. Output
 * is sorted by (source, start, end) so even the ORDER cannot leak the input's.
 *
 * ── ITS RELATIONSHIP TO `beatIntelligence.SPEECH_RULES` ─────────────────────
 * They answer different questions and neither is a copy of the other.
 * `SPEECH_RULES` asks what a line is DOING NARRATIVELY (is this a turn, a
 * payoff, an escalation) so the editor can order beats. This asks whether a
 * line is TEACHING and WHAT KIND of teaching, so the editor can pair it with
 * the action it describes. Their vocabularies genuinely differ: `SPEECH_RULES`
 * has one `instruction` rule where this has five modes, and this has a craft
 * gate that would be wrong for narrative classification.
 *
 * They are not duplicated: this module CALLS `readSpeech` and records its
 * verdict as CORROBORATION (`speechRule` on the beat), so the narrative reading
 * reaches the consumer without being restated here. Everything shared — the
 * stage→kind map, the b-roll bar, the timecode format, the vision-fact builder
 * — is imported from `beatIntelligence`, never re-implemented, for the reason
 * CLAUDE.md gives about the asset classifier: two copies of a rule set drift.
 *
 * Pure by design: no database, no network, no clock, no randomness, no AI call.
 * Same rows in, same beats out. Locked by `tests/teaching-beats.test.ts`.
 */

import type { HookableFact } from "./assetIntelligence";
import {
  VISUAL_EVIDENCE_MIN,
  factsFromVisual,
  kindForStage,
  readSpeech,
  timecode,
  type MomentEvidence,
} from "./beatIntelligence";

// ─── DOING: the recorded install stage ───────────────────────────────────────

/**
 * The stage vocabulary, exactly as the vision pass writes it. Not extended
 * here: a stage this module does not recognise is REPORTED, never mapped to the
 * nearest neighbour, because a wrong stage on a teaching beat is worse than no
 * stage (it pairs the lesson to the wrong action).
 */
export const INSTALL_STAGES = [
  "prep",
  "squeegee",
  "heat",
  "trim",
  "peel",
  "reveal",
  "detail",
  "drive-by",
  "interview",
  "other",
] as const;

export type InstallStage = (typeof INSTALL_STAGES)[number];

/**
 * The stages where hands are actually on the vehicle.
 *
 * `reveal` and `drive-by` are the finished result, `interview` is somebody
 * talking, and `other` is the pass saying it looked and did not recognise the
 * work — none of them is the installer DOING the thing he is explaining. The
 * distinction matters because "he is explaining heat while heating" is the
 * pairing worth cutting, and "he is explaining heat while sitting in an
 * interview chair" is not the same beat at all. Both are emitted; only one
 * claims to be work.
 */
export const HANDS_ON_STAGES: readonly InstallStage[] = Object.freeze([
  "prep",
  "squeegee",
  "heat",
  "trim",
  "peel",
  "detail",
]);

const STAGE_SET = new Set<string>(INSTALL_STAGES);
const HANDS_ON_SET = new Set<string>(HANDS_ON_STAGES);

export function isInstallStage(value: unknown): value is InstallStage {
  return typeof value === "string" && STAGE_SET.has(value.trim().toLowerCase());
}

export function isHandsOn(stage: string | null | undefined): boolean {
  return HANDS_ON_SET.has(String(stage || "").trim().toLowerCase());
}

// ─── TEACHING: what the line is teaching, if anything ────────────────────────

/**
 * The kinds of teaching a tutorial line does. Five, and each is a different
 * thing to cut to — a warning wants the moment before the mistake, a spec wants
 * the product in shot, an instruction wants the hands.
 */
export type TeachingMode = "warning" | "mistake" | "instruction" | "spec" | "reason";

export interface TeachingMarker {
  id: TeachingMode;
  /** The shared vocabulary, so downstream needs no translation. */
  kind: HookableFact["kind"];
  re: RegExp;
  /** Base confidence. Encodes SPECIFICITY of the marker, never importance. */
  weight: number;
  /**
   * TRUE when this marker only counts alongside a craft term in the same line.
   * False only where the marker IS a craft term (a brand, a measurement).
   */
  craftRequired: boolean;
  why: string;
}

/**
 * THE CRAFT GATE — a trade lexicon, drawn from the words that actually appear
 * in this library's transcripts.
 *
 * Its job is not to classify anything. Its job is to answer one question about
 * a line that already carries an instructional frame: is the thing being taught
 * THE WORK? Without it, `instruction` fires on "You have to check their
 * inventory" and `warning` fires on "If you don't chase that dream, you're
 * gonna forever be miserable" — both real lines in this corpus, neither an
 * install lesson.
 *
 * No `g` flag, deliberately: a global regex carries `lastIndex` between calls
 * and would make the same line classify differently on the second read.
 */
export const CRAFT_TERMS =
  /\b(?:vinyl|wraps?|wrapping|wrapped|laminat\w*|squeegee\w*|heat ?gun|post[- ]?heat|heat(?:ing|ed)?|blades?|knife|knifeless|sharpie|primer|plotter|cutter|weed(?:s|ed|ing)?|print(?:s|ed|er|ers|ing)?|ink|film|adhesive|bubbles?|creases?|wrinkles?|seams?|edges?|panels?|tuck(?:s|ed|ing)?|tucking tools?|stretch\w*|trim(?:s|med|ming)?|peel(?:s|ed|ing)?|prep(?:s|ped|ping)?|degreas\w*|install(?:s|ed|er|ers|ing|ation)?|ppf|tint|mils?|cast|calendered|overlap\w*|relief cut|air[- ]?release|hoods?|roofs?|fenders?|tailgates?|rockers?|quarter panels?|door handles?|bumpers?|mirrors?|recess\w*|decals?|graphics|chrome delete|colou?r change|3m|avery|oracal|hexis|kpmf|transfer tape|application tape|gun)\b/i;

/**
 * THE MARKERS. Ordered by SPECIFICITY — the first that fires wins, because a
 * line that both warns about a consequence and names a material is primarily
 * the warning. Every phrase in here is a frame found in this library's real
 * speech, not an imagined one: "You gotta have a standard blade", "You gotta
 * keep that clean edge", "we generally take a little more time edge sealing
 * everything because it doesn't necessarily hold as well over time", "you got
 * to out gas and let sit", "The last thing you want is…".
 *
 * `reason` sits at the bottom for the same reason its weight is lowest: its
 * frame is the loosest in the set ("because …" appears in almost every
 * interview answer in the library), so it leans hardest on the craft gate.
 */
export const TEACHING_MARKERS: readonly TeachingMarker[] = Object.freeze([
  {
    id: "warning",
    kind: "tension",
    weight: 0.78,
    craftRequired: true,
    why: "Names a consequence — the line says what goes wrong, and when.",
    re: /\b(?:if you\b[^.!?]{0,70}?\b(?:you'?ll|it'?ll|it will|you will|you'?re gonna|it'?s gonna|you end up|that'?ll|will (?:lift|bubble|tear|fail|peel|crack|burn))|be careful|watch out for|the last thing you want|don'?t ever|never (?:let|use|pull|stretch|leave|apply|put|touch|cut|force)|otherwise (?:it|you|the))\b/i,
  },
  {
    id: "mistake",
    kind: "tension",
    weight: 0.74,
    craftRequired: true,
    // Same narrative KIND as a warning on purpose. The mode is this module's
    // vocabulary and the kind is the shared one; downstream an editor treats
    // both as the escalation before the fix, which is correct — the difference
    // between "this will lift" and "everyone gets this wrong" is who made the
    // mistake, not what the beat does in the cut.
    why: "Names a mistake so the viewer can avoid it — a lesson taken from somebody's failure.",
    re: /\b(?:(?:biggest|common|commonest|number one|number 1|no\.? 1|first) mistake|mistake (?:people|guys|everyone|most)|most (?:people|guys|shops|installers|wrappers)|a lot of (?:people|guys|shops|installers|wrappers)|where (?:people|guys|they|it) go(?:es)? wrong|(?:people|guys|they) (?:mess|screw|get) (?:it |this |that )?(?:up|wrong)|i used to|we used to|the hard way)\b/i,
  },
  {
    id: "instruction",
    kind: "demonstration",
    weight: 0.7,
    craftRequired: true,
    why: "Teaches a step or a rule, addressed outward — the line tells the viewer what to do.",
    re: /\b(?:you (?:want|need|have|gotta|got|hafta) to|you gotta|you'?ve got to|make sure|start by|begin by|first (?:you|we)|what you (?:do|want) is|the way (?:you|we) do it|all you (?:do|need)|step \d|always (?:use|start|keep|pull|work|go|run|cut|heat)|keep (?:the|that|it|your) [a-z]+ moving|the trick is|the key is|here'?s how|this is how|every single time|do it by hand)\b/i,
  },
  {
    id: "spec",
    kind: "detail",
    weight: 0.66,
    // The ONLY marker with no craft gate, because the marker IS the craft term:
    // a brand with a product number, a measurement with a unit, a named
    // material class. Things a viewer can go and buy by that name — which is
    // exactly what makes a spec teachable ("this is 3M 2080").
    craftRequired: false,
    why: "Names a material, a measurement or a tool a viewer could go and buy by that name.",
    re: /(?:\b3m\s?\d{3,4}\b|\bavery(?:\s?dennison)?\s?\d{3,4}\b|\boracal\s?\d{3,4}\b|\bhexis\b|\bkpmf\b|\binozetek\b|\bteckwrap\b|\b\d+(?:\.\d+)?\s?(?:mil|mils|micron|microns|gsm)\b|\b\d{2,3}\s?(?:degrees|deg)\b|\bcast (?:vinyl|film|laminate)\b|\bcalendered\b|\bair[- ]?release\b|\bprimer\s?\d{2,3}\b|\bknifeless tape\b|\btransfer tape\b|\bapplication tape\b)/i,
  },
  {
    id: "reason",
    kind: "statement",
    weight: 0.62,
    craftRequired: true,
    why: "Explains WHY it is done that way — the mechanism behind the step, not just the step.",
    re: /\b(?:the reason (?:is|why|i|we|you|it|for)|that'?s why|which is why|that'?s because|the whole point (?:is|of)|what that does is|so that (?:it|you|the|they)|because (?:it|that|the|you|we|they|there) \w+)\b/i,
  },
]);

export interface TeachingReading {
  marker: TeachingMarker;
  /** The literal matched span — the checkable evidence. */
  signal: string;
  /** The craft term that satisfied the gate. Null when the gate did not apply. */
  craftSignal: string | null;
  /** Other modes that also fired — converging evidence about the SAME line. */
  also: TeachingMode[];
  /**
   * `beatIntelligence.readSpeech`'s narrative verdict on the same line, when it
   * had one. Corroboration carried through, not a second classification.
   */
  speechRule: string | null;
}

function exec(re: RegExp, line: string): string | null {
  try {
    const m = re.exec(line);
    return m ? String(m[0] || "").trim() : null;
  } catch {
    // A malformed marker must never take a cut down.
    return null;
  }
}

/**
 * Is this line teaching, and what kind of teaching?
 *
 * `null` when nothing fires, which is the common and CORRECT answer. An
 * installer talking about his weekend is not teaching, and labelling him as
 * teaching at low confidence would put a fabricated lesson in front of an
 * editor as something to build a cut around.
 */
export function readTeaching(quote: string | null | undefined): TeachingReading | null {
  const line = typeof quote === "string" ? quote.trim() : "";
  if (!line) return null;

  let winner: { marker: TeachingMarker; signal: string; craftSignal: string | null } | null = null;
  const also: TeachingMode[] = [];

  for (const marker of TEACHING_MARKERS) {
    const signal = exec(marker.re, line);
    if (!signal) continue;
    let craftSignal: string | null = null;
    if (marker.craftRequired) {
      craftSignal = exec(CRAFT_TERMS, line);
      // The frame is there but it is not about the work. Not this module's
      // lesson to teach — an honest gap rather than a guess.
      if (!craftSignal) continue;
    }
    if (!winner) winner = { marker, signal, craftSignal };
    else also.push(marker.id);
  }

  if (!winner) return null;
  const speech = readSpeech(line);
  return {
    marker: winner.marker,
    signal: winner.signal,
    craftSignal: winner.craftSignal,
    also,
    speechRule: speech ? speech.rule.id : null,
  };
}

// ─── The beats ───────────────────────────────────────────────────────────────

/** One recorded action: the vision pass watched, and said what was happening. */
export interface DoingBeat {
  sourceId: string;
  start: number;
  end: number;
  stage: InstallStage;
  /** True only for the stages where hands are on the vehicle. */
  handsOn: boolean;
  /** The shared narrative kind for this stage (`beatIntelligence.STAGE_KIND`). */
  kind: HookableFact["kind"];
  /** A pointer a human can follow back to the row. Always set. */
  evidence: string;
  /**
   * The frame as cutting material — present ONLY when the row clears the
   * b-roll bar the rest of the system uses. The STAGE is trusted regardless
   * (it is what the pass saw); the FRAME has to earn its place in a cut.
   */
  fact: HookableFact | null;
}

/** One spoken lesson, and the action it was aligned to — or an honest null. */
export interface TeachingBeat {
  sourceId: string;
  start: number;
  end: number;
  mode: TeachingMode;
  /** The literal matched marker. Evidence, not a label. */
  marker: string;
  /** The craft term that let the marker count, when the gate applied. */
  craftMarker: string | null;
  /** Other modes that fired on the same line. */
  also: TeachingMode[];
  /** `beatIntelligence.readSpeech`'s narrative reading, as corroboration. */
  speechRule: string | null;

  /** The stage recorded UNDER this line, or null — honestly. */
  stage: InstallStage | null;
  /** False whenever `stage` is null. */
  handsOn: boolean;
  /** True when a staged action overlapped this line in the same source. */
  paired: boolean;
  /** Why `stage` is what it is — including why it is null. Always set. */
  stageNote: string;

  /** WHAT WAS SAID. Always present: a teaching beat requires a real line. */
  said: HookableFact;
  /** WHAT WAS SHOWN, when the overlapping frame cleared the b-roll bar. */
  shown: HookableFact | null;
  /** Both, for consumers that just want facts. Strongest first. */
  facts: HookableFact[];
  confidence: number;
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const MAX_FIELD = 400;
const cap = (s: string) => (s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD - 1)}…` : s);

/** Deterministic, position-free ordering: source, then time. */
function byPlace(a: { sourceId: string; start: number; end: number }, b: typeof a): number {
  return (
    a.sourceId.localeCompare(b.sourceId) ||
    a.start - b.start ||
    a.end - b.end
  );
}

function rowBounds(row: MomentEvidence): { start: number; end: number } {
  const start = num(row?.start);
  return { start, end: Math.max(start, num(row?.end, start)) };
}

/**
 * The recorded actions in a set of rows.
 *
 * A row with no stage produces nothing — a stage is never inferred from a
 * description, from a filename, or from what the neighbours were doing.
 */
export function doingBeats(rows: MomentEvidence[] | null | undefined): DoingBeat[] {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object");
  const out: DoingBeat[] = [];
  for (const row of list) {
    const raw = str(row.installStage).toLowerCase();
    if (!raw || !STAGE_SET.has(raw)) continue;
    const stage = raw as InstallStage;
    const { start, end } = rowBounds(row);
    // ONE vision→fact path, imported rather than rebuilt: same b-roll bar, same
    // evidence string format, same stage→kind map as everything else.
    const derived = factsFromVisual(row)[0];
    out.push({
      sourceId: str(row.sourceId),
      start,
      end,
      stage,
      handsOn: HANDS_ON_SET.has(stage),
      kind: kindForStage(stage),
      evidence: cap(
        `install stage "${stage}" recorded at ${timecode(start)} (content_moments)` +
        (derived ? "" : ` — frame below the b-roll ${VISUAL_EVIDENCE_MIN}/10 bar, so the stage is trusted but the frame is not offered as cutting material`),
      ),
      fact: derived ? derived.fact : null,
    });
  }
  return out.sort(byPlace);
}

/** How much of the line's window the action covers, in seconds. 0 = no overlap. */
function overlapSeconds(
  a: { start: number; end: number },
  b: { start: number; end: number },
): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/**
 * The action a line was spoken OVER.
 *
 * Greatest temporal overlap wins. Ties break on the earlier action, then the
 * shorter one, then the stage name — a total order over the rows' own values,
 * so nothing depends on which order they arrived in. A line that overlaps
 * NOTHING gets null: attaching it to the nearest action would be a positional
 * heuristic wearing a fact, and it would pair the lesson to the wrong step.
 */
function pairStage(
  line: { sourceId: string; start: number; end: number },
  actions: DoingBeat[],
): DoingBeat | null {
  let best: DoingBeat | null = null;
  let bestOverlap = 0;
  for (const action of actions) {
    if (action.sourceId !== line.sourceId) continue;
    const overlap = overlapSeconds(line, action);
    if (overlap <= 0) continue;
    if (
      !best ||
      overlap > bestOverlap ||
      (overlap === bestOverlap &&
        (action.start < best.start ||
          (action.start === best.start &&
            (action.end < best.end ||
              (action.end === best.end && action.stage < best.stage)))))
    ) {
      best = action;
      bestOverlap = overlap;
    }
  }
  return best;
}

// ─── Coverage ────────────────────────────────────────────────────────────────

export interface InstallCoverage {
  rows: number;
  /** Rows carrying a spoken line. */
  quoteRows: number;
  /** Rows carrying a recognised install stage. */
  stagedRows: number;
  /** Rows whose `install_stage` is not in `INSTALL_STAGES`. */
  unrecognisedStageRows: number;
  doing: number;
  /** Doing beats whose frame cleared the b-roll bar. */
  doingWithFrame: number;
  teaching: number;
  paired: number;
  unpaired: number;
  /** Paired AND the stage is hands-on-the-vehicle work. The unit worth cutting. */
  pairedToWork: number;
  /** Spoke, but no teaching marker fired. The honest majority. */
  spokenButNotTeaching: number;
  byMode: Record<TeachingMode, number>;
  byStage: Record<string, number>;
  sources: number;
  sourcesWithSpeech: number;
  sourcesWithStage: number;
  /** Sources carrying BOTH — the number that gates pairing. */
  sourcesWithBoth: number;
  /** `teaching / quoteRows`, 0-1. No quote rows → 0. */
  teachingRate: number;
  /** `paired / teaching`, 0-1. No teaching → 0. */
  pairRate: number;
}

function emptyCoverage(): InstallCoverage {
  return {
    rows: 0,
    quoteRows: 0,
    stagedRows: 0,
    unrecognisedStageRows: 0,
    doing: 0,
    doingWithFrame: 0,
    teaching: 0,
    paired: 0,
    unpaired: 0,
    pairedToWork: 0,
    spokenButNotTeaching: 0,
    byMode: { warning: 0, mistake: 0, instruction: 0, spec: 0, reason: 0 },
    byStage: {},
    sources: 0,
    sourcesWithSpeech: 0,
    sourcesWithStage: 0,
    sourcesWithBoth: 0,
    teachingRate: 0,
    pairRate: 0,
  };
}

export interface InstallSegmentation {
  doing: DoingBeat[];
  teaching: TeachingBeat[];
  coverage: InstallCoverage;
  /** Plain language, always populated — including when the answer is nothing. */
  notes: string[];
}

export interface SegmentOpts {
  /**
   * Extra actions to pair against — for the case where the doing rows and the
   * speech rows arrive from separate reads. Merged with the actions derived
   * from `rows`; duplicates are harmless because pairing picks by overlap.
   */
  actions?: DoingBeat[];
}

/**
 * Segment install footage by DOING and TEACHING, and pair the two.
 *
 * The whole module in one call. Feed it `content_moments` rows in
 * `beatIntelligence.MomentEvidence` shape — the same rows `attachIntelligence`
 * reads — and it returns the actions, the lessons, and which lesson was spoken
 * over which action.
 */
export function segmentInstall(
  rows: MomentEvidence[] | null | undefined,
  opts: SegmentOpts = {},
): InstallSegmentation {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r === "object");
  const coverage = emptyCoverage();
  const notes: string[] = [];

  if (!list.length && !(opts.actions || []).length) {
    return {
      doing: [],
      teaching: [],
      coverage,
      notes: ["No rows — nothing was said and nothing was watched, so there is nothing to segment."],
    };
  }

  coverage.rows = list.length;

  const derivedActions = doingBeats(list);
  const extraActions = (Array.isArray(opts.actions) ? opts.actions : [])
    .filter((a) => a && typeof a === "object" && isInstallStage(a.stage));
  const actions = [...derivedActions, ...extraActions].sort(byPlace);

  coverage.doing = actions.length;
  coverage.doingWithFrame = actions.filter((a) => !!a.fact).length;
  for (const a of actions) coverage.byStage[a.stage] = (coverage.byStage[a.stage] || 0) + 1;

  const sources = new Set<string>();
  const spokenSources = new Set<string>();
  const stagedSources = new Set<string>();
  for (const a of actions) {
    if (a.sourceId) { sources.add(a.sourceId); stagedSources.add(a.sourceId); }
  }

  const teaching: TeachingBeat[] = [];

  for (const row of list) {
    const sourceId = str(row.sourceId);
    if (sourceId) sources.add(sourceId);

    const rawStage = str(row.installStage).toLowerCase();
    if (rawStage) {
      if (STAGE_SET.has(rawStage)) coverage.stagedRows++;
      else coverage.unrecognisedStageRows++;
    }

    const line = str(row.quote);
    if (!line) continue;
    coverage.quoteRows++;
    if (sourceId) spokenSources.add(sourceId);

    // NO TRANSCRIPT, NO TEACHING. Silence is not a lesson.
    const reading = readTeaching(line);
    if (!reading) {
      coverage.spokenButNotTeaching++;
      continue;
    }

    const { start, end } = rowBounds(row);
    const action = pairStage({ sourceId, start, end }, actions);
    const who = str(row.speaker);
    const at = timecode(start);

    const paired = !!action;
    const confidence = clamp01(
      reading.marker.weight +
      (reading.craftSignal ? 0.05 : 0) +
      (reading.also.length ? 0.05 : 0) +
      Math.min(0.15, 0.015 * num(row.soundbiteScore)) +
      // He is explaining the thing he is doing. That is a stronger claim than
      // the same sentence floating free, and it is the unit the show is for.
      (paired ? 0.1 : 0),
    );

    const said: HookableFact = {
      text: cap(line),
      kind: reading.marker.kind,
      evidence: cap(`spoken at ${at}${who ? ` by ${who}` : ""} — "${line}"`),
      confidence,
    };

    const shown = action?.fact || null;
    const stageNote = action
      ? `Spoken over a recorded "${action.stage}" action (${action.evidence}).` +
        (action.handsOn
          ? " Hands are on the vehicle — this is the lesson aligned to the work."
          : ` "${action.stage}" is not hands-on-the-vehicle work, so this is a lesson spoken NEAR the job rather than over it.`)
      : stagedSources.has(sourceId)
        ? "No recorded install stage overlaps this line — the source is vision-scored, but nothing was happening at this second that the pass recognised."
        : "No recorded install stage in this source at all — it is transcribed but never vision-scored, so what he was DOING here is unknown. Honest gap, not a guessed stage.";

    teaching.push({
      sourceId,
      start,
      end,
      mode: reading.marker.id,
      marker: reading.signal,
      craftMarker: reading.craftSignal,
      also: [...reading.also],
      speechRule: reading.speechRule,
      stage: action ? action.stage : null,
      handsOn: action ? action.handsOn : false,
      paired,
      stageNote,
      said,
      shown,
      facts: shown ? [said, shown] : [said],
      confidence,
    });
  }

  teaching.sort(byPlace);

  coverage.teaching = teaching.length;
  coverage.paired = teaching.filter((t) => t.paired).length;
  coverage.unpaired = coverage.teaching - coverage.paired;
  coverage.pairedToWork = teaching.filter((t) => t.paired && t.handsOn).length;
  for (const t of teaching) coverage.byMode[t.mode]++;
  coverage.sources = sources.size;
  coverage.sourcesWithSpeech = spokenSources.size;
  coverage.sourcesWithStage = stagedSources.size;
  coverage.sourcesWithBoth = [...spokenSources].filter((s) => stagedSources.has(s)).length;
  coverage.teachingRate = coverage.quoteRows ? coverage.teaching / coverage.quoteRows : 0;
  coverage.pairRate = coverage.teaching ? coverage.paired / coverage.teaching : 0;

  // ── The notes. Every one of these is a number a human can check.
  notes.push(
    `${coverage.doing} recorded action(s) across ${coverage.sourcesWithStage} vision-scored source(s); ` +
    `${coverage.doingWithFrame} of them clear the b-roll ${VISUAL_EVIDENCE_MIN}/10 bar and are offered as cutting material.`,
  );
  notes.push(
    `${coverage.teaching} teaching beat(s) from ${coverage.quoteRows} spoken line(s) ` +
    `(${Math.round(coverage.teachingRate * 100)}%); ${coverage.spokenButNotTeaching} line(s) carried no teaching marker.`,
  );
  if (coverage.quoteRows && !coverage.teaching) {
    notes.push(
      "Somebody is talking, but nobody is teaching — no instruction, warning, reason, spec or mistake in any line. That is an answer, not a failure: this footage has no tutorial in it.",
    );
  }
  if (!coverage.quoteRows) {
    notes.push(
      "No transcript on any row, so there are NO teaching beats — not low-confidence ones. An installer working in silence is not teaching.",
    );
  }
  if (coverage.teaching) {
    notes.push(
      `${coverage.paired} teaching beat(s) are aligned to a recorded action (${coverage.pairedToWork} of them to hands-on work); ` +
      `${coverage.unpaired} report stage: null honestly.`,
    );
  }
  if (coverage.sources && !coverage.sourcesWithBoth) {
    notes.push(
      `0 of ${coverage.sources} source(s) carry BOTH a transcript and a recorded install stage, so nothing here can pair. ` +
      "That is the parser's shape, not this footage's — a clip is transcribed OR vision-scored today.",
    );
  }
  if (coverage.unrecognisedStageRows) {
    notes.push(
      `${coverage.unrecognisedStageRows} row(s) carry an install_stage outside the known vocabulary (${INSTALL_STAGES.join(", ")}) — reported, not mapped to the nearest stage.`,
    );
  }

  return { doing: actions, teaching, coverage, notes };
}

/**
 * Just the lessons, for a caller that has the actions already.
 *
 * Thin on purpose — it exists so "give me the teaching beats" does not require
 * knowing that the actions come back in the same call.
 */
export function teachingBeats(
  rows: MomentEvidence[] | null | undefined,
  opts: SegmentOpts = {},
): TeachingBeat[] {
  return segmentInstall(rows, opts).teaching;
}
