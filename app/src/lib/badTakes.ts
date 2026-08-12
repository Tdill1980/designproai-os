/**
 * badTakes — the "edits bad parts out" half of the intelligent editor.
 *
 * Owner, 2026-08-06: "The intelligent editor will act as a real editor and
 * edits viral hooks, docu style — edits bad parts out."
 *
 * This module is the second clause. It finds the parts a documentary editor
 * cuts — filler, false starts, stutters, dead air, repeated phrasing, the
 * ramble after the point has landed — proposes them as REMOVALS, and refuses
 * the ones that would change what the speaker actually said. It runs BEFORE
 * the rearrangement/pacing pass (`editorCraft.ts`), so what that pass orders is
 * already clean.
 *
 * ── WHAT IT REFUSES TO DO ──────────────────────────────────────────────────
 * It does not transcribe. It does not rewrite. It does not paraphrase. It never
 * adds a word, and it never reorders one. Every string it emits is either a
 * slice of the speaker's own words or a stated reason. The only thing it can do
 * to a transcript is DELETE a span of it, and every deletion has to survive the
 * guard below.
 *
 * ── THE SPEECH LOCK, AND HOW THIS LIVES INSIDE IT ──────────────────────────
 * CLAUDE.md, locked by `tests/brandcast-planner.test.ts`: "Never trim inside
 * speech, never speed-ramp dialogue, never fade over a line." Read against the
 * test file, that lock is about a BEAT'S BOUNDS: `enforceSpeechCraft` snaps a
 * scene back to `beat.start`/`beat.end` and strips `speed`/`fadeIn`, because
 * the first live cut clipped lines off mid-thought, slow-mo'd dialogue, and
 * faded over speech. The failure it prevents is a line arriving BROKEN.
 *
 * It is not a rule that every millisecond between a beat's bounds is sacred —
 * `mergeMomentsIntoBeats` already establishes the real standard, which is that
 * a beat must be a WHOLE SPOKEN THOUGHT (sentence-complete, ending on . ! ? or
 * a real pause). This module holds itself to exactly that standard: after any
 * removal, what remains must still be sentence-complete and natural. An "um"
 * lifted from between two words leaves a whole thought; a word clipped in half
 * does not.
 *
 * So the two coexist, in this order and no other:
 *
 *   parse → beats (mergeMomentsIntoBeats) → BAD PARTS OUT (this module,
 *   sentence-completeness preserved) → order/pace (editorCraft) →
 *   enforceSpeechCraft on the FINAL bounds
 *
 * `enforceSpeechCraft` is still the last word. It snaps a scene to the bounds
 * of the beat it is given — and after this module runs, the beat it is given is
 * the CLEANED beat. Nothing here weakens it.
 *
 * The hard consequence: a removal must land on real word boundaries. If the
 * boundary cannot be established from the data, DO NOT CUT. Leaving an "um" in
 * is a cosmetic flaw; clipping a word is a broken piece, and a broken piece is
 * what made the first cut unusable.
 *
 * ── THE FAILURE THAT MATTERS MOST: MEANING MUST SURVIVE ────────────────────
 * Deleting words can change what was said without inventing anything:
 *
 *   "we usually recommend post-heating"  →  "we post-heat"      (opinion → claim)
 *   "that won't lift"                    →  "that will lift"    (inverted)
 *   "if the surface is clean, it holds"  →  "it holds"          (condition gone)
 *   "almost always"                      →  "always"            (degree gone)
 *
 * An edit that does this is indistinguishable from an honest one in the output.
 * Nobody reviewing the finished cut can tell — exactly like a fabricated hook,
 * which is what the Hook Engine's grounding checks exist for. So it gets a
 * STRUCTURAL defence, not care: `GUARDED_TOKENS` below, and a `guardRemovals`
 * pass that refuses, by name, any removal that would span or delete one.
 *
 * Some tokens are BOTH filler and guarded — "sort of", "kind of", "actually",
 * "like". The guard wins, always. The detector proposes them and the guard
 * refuses them with a stated reason, rather than a lexicon quietly deciding the
 * question: a refusal a human can read is worth more than a cut nobody sees.
 *
 * ── THE MANIFEST IS THE POINT ──────────────────────────────────────────────
 * `applyRemovals` returns a cut list. A real editor's cut list is reviewable;
 * this one makes "the system deleted a word" a query rather than an argument.
 * Refusals are inspectable for the same reason — a removal that was silently
 * dropped teaches nobody anything.
 *
 * Pure by design: no database, no network, no clock, no AI, no randomness. The
 * same footage cleans identically every time, because a cut that cannot be
 * reproduced cannot be reviewed. Locked by `tests/bad-takes.test.ts`.
 */

import { contentTerms } from "./assetIntelligence";

// ─── Input shapes ────────────────────────────────────────────────────────────

/**
 * One word with real bounds. This is the ONLY thing that makes an intra-beat
 * cut safe — a removal built from these can never land mid-word, because its
 * edges ARE word edges.
 *
 * NOTHING IN THE PIPELINE PRODUCES THESE TODAY (verified 2026-08-06):
 * `wpw-workforce-sweep` calls Whisper with `response_format: "verbose_json"`
 * and no `timestamp_granularities: ["word"]`, so it gets segment timings only;
 * `content_moments` stores `start_time` / `end_time` / `verbatim_quote` per
 * segment and `media_sources.transcript` is one flat string. So in production
 * TODAY every intra-beat candidate is refused with `guard: "timing"`, and this
 * module only removes whole beats. That is the honest outcome, and it is
 * reported rather than approximated — asking Whisper for word granularity is
 * what unlocks the rest, and it is a change to the parser, not to this file.
 */
export interface WordTiming {
  word: string;
  start: number;
  end: number;
}

/**
 * A sentence-complete spoken beat — the output of `mergeMomentsIntoBeats`,
 * carrying word timings when the parser has them.
 */
export interface BadTakeBeat {
  id?: string;
  sourceId?: string;
  start: number;
  end: number;
  /** What was said. */
  text?: string;
  /** Word-level timings, when the parser has them. Absent = segment-only. */
  words?: WordTiming[];
}

// ─── What "bad" means ────────────────────────────────────────────────────────

/**
 * The kinds of bad part a documentary editor cuts. `kind` is not decoration:
 * it drives the aggressiveness gate and it is what a human reads in the
 * manifest when they ask why a word is gone.
 */
export type BadPartKind =
  /** Hesitation and discourse filler — "um", "you know". */
  | "filler"
  /** An aborted attempt, kept only until the speaker restarts it. */
  | "false_start"
  /** An immediately repeated word — "the the vinyl". */
  | "stutter"
  /** A long pause inside a beat. */
  | "dead_air"
  /** An immediately repeated phrase, or a short restatement dedupeTakes cannot see. */
  | "repeat"
  /** The ramble after the point has landed. */
  | "tail_off"
  /** Off-topic — says nothing the rest of the material is about. */
  | "tangent";

/**
 * The filler class: hesitation artifacts that carry no propositional content.
 * The conservative default removes nothing else, because everything else
 * involves a judgement about which of two things the speaker meant.
 */
export const FILLER_CLASS_KINDS: readonly BadPartKind[] = Object.freeze(["filler", "stutter"]);

/**
 * How hard to cut. Docu style is not one setting — a customer interview and a
 * b-roll voiceover want different hands.
 *
 * conservative  filler + stutter only. The default, because the cost of an
 *               over-cut is a MISQUOTED CUSTOMER and the cost of an under-cut
 *               is an "um".
 * documentary   + false starts, repeats, dead air. The standard docu pass.
 * aggressive    + tail-off and tangents. This one throws away whole thoughts
 *               the speaker finished; it is a director's call, not a default.
 */
export type Aggressiveness = "conservative" | "documentary" | "aggressive";

export const AGGRESSIVENESS_LEVELS: readonly Aggressiveness[] = Object.freeze([
  "conservative",
  "documentary",
  "aggressive",
]);

function levelRank(level: Aggressiveness): number {
  const i = AGGRESSIVENESS_LEVELS.indexOf(level);
  return i === -1 ? 0 : i;
}

/** Where a removal sits, which decides what it is allowed to do. */
export type RemovalScope =
  /** The whole beat goes. No line is clipped — the beat leaves intact. */
  | "beat"
  /** Inside a beat, between two words. Requires word timings. */
  | "intra_beat";

export interface Removal {
  /** Deterministic identity — kind + bounds. Same input, same id. */
  id: string;
  kind: BadPartKind;
  scope: RemovalScope;
  /** Absolute source-timeline bounds. */
  start: number;
  end: number;
  /** The speaker's own words this deletes. "" for a pure-silence removal. */
  text: string;
  /**
   * WHY this is bad, pointing back at the transcript — a quote and a timecode.
   * Not optional, for the same reason `HookableFact.evidence` is not optional:
   * a judgement nobody can check is an assertion, and this one DELETES things.
   */
  evidence: string;
  /** Minimum aggressiveness that allows this removal. */
  level: Aggressiveness;
  /** The beat this belongs to. */
  beatKey: string;
}

// ─── The guard ───────────────────────────────────────────────────────────────

/**
 * Classes of token a removal may never span or delete.
 *
 * Every one of these is a word whose ABSENCE reads as a different, plausible
 * sentence. That is the whole test for membership: if deleting it leaves
 * something that still parses but says something else, it belongs here.
 *
 * Over-guarding costs a missed cut. Under-guarding costs a misquoted customer.
 * The list is deliberately generous in the first direction.
 *
 * A token may appear in more than one class; the first class in declaration
 * order is the one reported, so the reason a human reads is stable.
 */
export type GuardClass =
  | "negation"
  | "conditional"
  | "hedge"
  | "quantifier"
  | "modal"
  | "comparative";

export const GUARDED_TOKENS: Readonly<Record<GuardClass, readonly string[]>> = Object.freeze({
  // Protects against INVERSION. "that won't lift" → "that will lift" is the
  // single worst thing this module could do: the sentence still reads, and it
  // now says the opposite of what the installer said on camera.
  negation: Object.freeze(
    ("not no never none nothing nobody nowhere nor neither without cannot cant dont doesnt didnt " +
      "wont wouldnt couldnt shouldnt isnt arent wasnt werent hasnt havent hadnt aint dont")
      .split(" "),
  ),

  // Protects against a CONDITION being stripped. "if the surface is clean, it
  // holds" → "it holds" turns a caveated instruction into a guarantee.
  conditional: Object.freeze(
    "if unless until till whenever once provided providing assuming otherwise else depends depending whether when".split(" "),
  ),

  // Protects against OPINION BECOMING CLAIM. "we usually recommend post-heating"
  // → "we post-heat". Also catches "sort of" / "kind of" / "actually", which are
  // filler in one reading and degree-softeners in another — the guard takes the
  // softening reading, because that is the one where deleting changes meaning.
  hedge: Object.freeze(
    ("usually generally typically normally often sometimes occasionally mostly probably possibly likely " +
      "maybe perhaps roughly approximately around about basically essentially practically virtually " +
      "apparently seemingly seem seems seemed tend tends tended think thinks believe believes guess " +
      "suppose supposed recommend recommends recommended suggest suggests ideally prefer prefers " +
      "sort kind actually literally technically arguably potentially")
      .split(" "),
  ),

  // Protects against DEGREE COLLAPSE. "almost always" → "always"; "most of the
  // panels" → "the panels". The claim gets bigger and nothing looks edited.
  quantifier: Object.freeze(
    ("all every everything everyone always each both some any few several half majority minority " +
      "almost nearly barely hardly scarcely only just entire entirely completely fully partly partially " +
      "least twice double")
      .split(" "),
  ),

  // Protects against POSSIBILITY BECOMING FACT. "it can lift" → "it lifts".
  modal: Object.freeze("can could should would may might must will shall ought need needs gonna gotta".split(" ")),

  // Protects against a COMPARISON losing its other half. "cheaper than vinyl" →
  // "cheaper" is an unanchored superlative claim. Also holds "like", which is
  // filler in one reading and a comparison marker in another.
  comparative: Object.freeze(
    ("than more less better worse best worst faster slower cheaper stronger longer shorter higher lower " +
      "harder easier like unlike similar compared versus rather instead")
      .split(" "),
  ),
});

const GUARD_BY_TOKEN: ReadonlyMap<string, GuardClass> = (() => {
  const map = new Map<string, GuardClass>();
  for (const cls of Object.keys(GUARDED_TOKENS) as GuardClass[]) {
    for (const token of GUARDED_TOKENS[cls]) if (!map.has(token)) map.set(token, cls);
  }
  return map;
})();

/** Which guard class a word falls in, if any. Apostrophes are stripped so
 * "won't" and "wont" are the same token on both sides of every comparison. */
export function guardClassOf(word: string): GuardClass | null {
  return GUARD_BY_TOKEN.get(normalizeWord(word)) ?? null;
}

// ─── Lexicons ────────────────────────────────────────────────────────────────

/** Pure hesitation. No reading of these carries meaning, so they are the only
 * thing the conservative default touches. */
const HESITATION = new Set(
  "um umm uhm uh uhh erm err er ah ahh eh hmm hm mm mmm mhm uhhuh".split(" "),
);

/** Discourse filler — meaningless as spoken, but several of these are also
 * guarded tokens and will be refused. That is the design, not an oversight. */
const DISCOURSE_FILLER_WORDS = new Set("like well anyway obviously literally actually basically right".split(" "));
const DISCOURSE_FILLER_PHRASES: readonly string[][] = Object.freeze([
  ["you", "know"],
  ["i", "mean"],
  ["sort", "of"],
  ["kind", "of"],
]);

/** Words a sentence cannot end on without dangling. Used by the completeness
 * check — the same standard `mergeMomentsIntoBeats` holds. */
const DANGLING = new Set(
  ("and but or so because that which who what the a an of to in on at for from with as if when while " +
    "than then is are was were my your our their his her its this these those into onto by")
    .split(" "),
);

/** Doubled words that are legitimate English, so a repeat is not a stutter. */
const LEGITIMATE_DOUBLES = new Set(["that", "had", "is", "very", "no"]);

const TERMINAL = /[.!?…]["')\]]?\s*$/;

// ─── Small deterministic helpers ─────────────────────────────────────────────

const round3 = (n: number) => Math.round(n * 1000) / 1000;

function normalizeWord(word: string): string {
  return String(word || "").toLowerCase().replace(/[^a-z0-9']/g, "").replace(/'/g, "");
}

function beatKeyOf(beat: BadTakeBeat, index = 0): string {
  if (beat.id) return String(beat.id);
  return `${beat.sourceId || "src"}@${round3(beat.start)}-${round3(beat.end)}#${index}`;
}

function removalId(kind: BadPartKind, start: number, end: number, beatKey: string): string {
  return `${kind}@${round3(start).toFixed(3)}-${round3(end).toFixed(3)}:${beatKey}`;
}

function beatText(beat: BadTakeBeat): string {
  if (String(beat.text || "").trim()) return String(beat.text).trim();
  return joinWords(beat.words || []);
}

/** Reconstruct text from word tokens. Joining is not writing — no word is
 * added, none is changed, none is reordered. */
function joinWords(words: WordTiming[]): string {
  return words
    .map((w) => String(w.word || ""))
    .join(" ")
    .replace(/\s+([,.!?;:…])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function stemsOf(text: string | null | undefined): Set<string> {
  return new Set(contentTerms(text).map((t) => t.stem));
}

function contentWordCount(text: string | null | undefined): number {
  return contentTerms(text).length;
}

function tokensOf(text: string | null | undefined): string[] {
  return String(text || "").split(/\s+/).map(normalizeWord).filter(Boolean);
}

/**
 * Is this nothing but noise?
 *
 * Deliberately NOT `contentTerms(...).length === 0`: "hmm" is three letters and
 * survives that tokeniser as a content word, so a beat of pure hesitation read
 * as meaningful. The lexicons are the authority on filler, not the length gate.
 */
function isAllFiller(text: string | null | undefined): boolean {
  const bare = tokensOf(text);
  return bare.length > 0 && bare.every((w) => HESITATION.has(w) || DISCOURSE_FILLER_WORDS.has(w));
}

function endsTerminal(text: string): boolean {
  return TERMINAL.test(String(text || "").trim());
}

function lastWordOf(text: string): string {
  const parts = String(text || "").trim().split(/\s+/);
  return normalizeWord(parts[parts.length - 1] || "");
}

/** Snapshot of a quote for evidence, so the reason stays readable. */
function snippet(text: string, max = 72): string {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
}

// ─── Step 1: find the bad parts ──────────────────────────────────────────────

export interface FindOpts {
  /** Default "conservative" — the cost of an over-cut is a misquoted customer. */
  level?: Aggressiveness;
  /** A pause inside a beat longer than this is dead air. Default 1.2s. */
  deadAirSeconds?: number;
  /** Topic vocabulary for tangent detection. Defaults to the other beats' terms. */
  topicTerms?: string[];
}

/**
 * Candidates, plus the reasons no candidate was proposed where one might have
 * been expected.
 *
 * `notes` is not padding. The most important thing this module can report on
 * real production data today is "no intra-beat cuts, because there are no word
 * timings" — a silent empty result would read as "nothing to clean" and send
 * somebody looking for a bug in the detector instead of at the parser.
 */
export interface BadPartScan {
  candidates: Removal[];
  notes: string[];
}

/**
 * Find the parts a documentary editor would cut.
 *
 * Accepts a single beat or a run of them. Cross-beat kinds (false starts that
 * span a restart, short repeats, tail-off, tangents) need neighbours, so a
 * single beat yields intra-beat kinds only — and says so.
 */
export function findBadParts(input: BadTakeBeat | BadTakeBeat[], opts: FindOpts = {}): BadPartScan {
  const beats = (Array.isArray(input) ? input : [input]).filter((b) => b && Number.isFinite(b.start) && Number.isFinite(b.end));
  const level = opts.level || "conservative";
  const maxRank = levelRank(level);
  const deadAir = opts.deadAirSeconds ?? 1.2;

  const candidates: Removal[] = [];
  const notes: string[] = [];
  if (!beats.length) return { candidates, notes: ["No beats supplied — nothing to clean."] };

  const keys = beats.map((b, i) => beatKeyOf(b, i));

  // ── whole beats of pure noise, and intra-beat cuts for the rest ────────────
  let beatsWithoutWords = 0;
  beats.forEach((beat, i) => {
    // A beat that is nothing but hesitation goes WHOLE, and its interior is not
    // examined. Lifting the "um" and the "uh" out of "Um, uh, hmm." leaves
    // "hmm." — still noise, but now noise that survived the pass because two
    // narrower removals won the overlap race against the right one. Needs no
    // neighbours, so it is judged here rather than in the cross-beat pass.
    const filler = wholeBeatFillerCandidate(beat, keys[i]);
    if (filler) {
      candidates.push(filler);
      return;
    }
    const words = Array.isArray(beat.words) ? beat.words.filter((w) => w && Number.isFinite(w.start) && Number.isFinite(w.end)) : [];
    if (!words.length) {
      beatsWithoutWords++;
      return;
    }
    candidates.push(...intraBeatCandidates(beat, keys[i], words, deadAir));
  });

  if (beatsWithoutWords) {
    notes.push(
      `${beatsWithoutWords} of ${beats.length} beat${beats.length === 1 ? "" : "s"} carry no word timings — ` +
        "no cut inside those beats can be placed on a real word boundary, so none was proposed. " +
        "Whole-beat removals are unaffected. (The parser stores segment-level timings only: Whisper is " +
        'called without timestamp_granularities:["word"], and content_moments holds start_time/end_time/verbatim_quote.)',
    );
  }

  // ── whole-beat, needs neighbours ───────────────────────────────────────────
  if (beats.length === 1) {
    notes.push("Single beat supplied — false starts, repeats, tail-off and tangents need neighbouring beats to judge, so none was proposed.");
  } else {
    candidates.push(...wholeBeatCandidates(beats, keys, opts));
  }

  const allowed = candidates.filter((c) => levelRank(c.level) <= maxRank);
  return { candidates: sortRemovals(allowed), notes };
}

function sortRemovals(list: Removal[]): Removal[] {
  return [...list].sort(
    (a, b) => a.start - b.start || a.end - b.end || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );
}

/** A beat with nothing propositional in it. Nothing to break, so it goes whole. */
function wholeBeatFillerCandidate(beat: BadTakeBeat, key: string): Removal | null {
  const text = beatText(beat);
  if (!isAllFiller(text)) return null;
  const start = round3(beat.start);
  const end = round3(beat.end);
  if (!(end > start)) return null;
  const onlyHesitation = tokensOf(text).every((w) => HESITATION.has(w));
  return {
    id: removalId("filler", start, end, key),
    kind: "filler",
    scope: "beat",
    start,
    end,
    text,
    evidence: `Beat at ${start.toFixed(2)}s–${end.toFixed(2)}s: "${snippet(text)}" — the whole beat is hesitation — it states nothing`,
    level: onlyHesitation ? "conservative" : "documentary",
    beatKey: key,
  };
}

function intraBeatCandidates(beat: BadTakeBeat, key: string, words: WordTiming[], deadAir: number): Removal[] {
  const out: Removal[] = [];
  const norms = words.map((w) => normalizeWord(w.word));
  const whole = joinWords(words);

  const push = (kind: BadPartKind, from: number, to: number, level: Aggressiveness, why: string) => {
    const start = round3(words[from].start);
    const end = round3(words[to].end);
    if (!(end > start)) return;
    const text = joinWords(words.slice(from, to + 1));
    out.push({
      id: removalId(kind, start, end, key),
      kind,
      scope: "intra_beat",
      start,
      end,
      text,
      evidence: `"${text}" at ${start.toFixed(2)}s–${end.toFixed(2)}s — ${why}. In: "${snippet(whole)}"`,
      level,
      beatKey: key,
    });
  };

  // HESITATION and DISCOURSE FILLER.
  for (let i = 0; i < words.length; i++) {
    if (HESITATION.has(norms[i])) {
      push("filler", i, i, "conservative", `hesitation token "${norms[i]}"`);
      continue;
    }
    if (DISCOURSE_FILLER_WORDS.has(norms[i])) {
      push("filler", i, i, "documentary", `discourse filler "${norms[i]}"`);
    }
  }
  for (const phrase of DISCOURSE_FILLER_PHRASES) {
    for (let i = 0; i + phrase.length <= words.length; i++) {
      if (phrase.every((p, k) => norms[i + k] === p)) {
        push("filler", i, i + phrase.length - 1, "documentary", `discourse filler "${phrase.join(" ")}"`);
      }
    }
  }

  // STUTTER — an immediately repeated word. The FIRST copy goes; the second is
  // the one the speaker carried on from.
  for (let i = 0; i + 1 < words.length; i++) {
    const n = norms[i];
    if (!n || n !== norms[i + 1]) continue;
    if (LEGITIMATE_DOUBLES.has(n)) continue;
    if (words[i + 1].start - words[i].end > 0.6) continue; // a real pause, not a stumble
    push("stutter", i, i, "conservative", `"${n}" repeated immediately`);
  }

  // FALSE START and REPEAT — an n-gram immediately restated. At the start of the
  // beat (or straight after a full stop) that is the speaker restarting, which
  // is a false start; anywhere else it is a repeat. Longest run first, so
  // "we squeegee from the centre from the centre" is reported as the six-word
  // stumble it is rather than as two overlapping two-word ones.
  for (let n = 6; n >= 2; n--) {
    for (let i = 0; i + 2 * n <= words.length; i++) {
      let same = true;
      for (let k = 0; k < n; k++) {
        if (!norms[i + k] || norms[i + k] !== norms[i + n + k]) { same = false; break; }
      }
      if (!same) continue;
      const atRestart = i === 0 || endsTerminal(joinWords(words.slice(0, i)));
      const kind: BadPartKind = atRestart ? "false_start" : "repeat";
      push(
        kind,
        i,
        i + n - 1,
        "documentary",
        atRestart
          ? `aborted attempt — the speaker restarts with the same words at ${round3(words[i + n].start).toFixed(2)}s`
          : `phrase immediately restated at ${round3(words[i + n].start).toFixed(2)}s`,
      );
    }
  }

  // DEAD AIR — a long pause between two words. This deletes silence, not
  // speech: both edges are word bounds, so no word is touched at all.
  for (let i = 0; i + 1 < words.length; i++) {
    const gap = words[i + 1].start - words[i].end;
    if (gap <= deadAir) continue;
    const start = round3(words[i].end);
    const end = round3(words[i + 1].start);
    out.push({
      id: removalId("dead_air", start, end, key),
      kind: "dead_air",
      scope: "intra_beat",
      start,
      end,
      text: "",
      evidence:
        `${gap.toFixed(2)}s of silence at ${start.toFixed(2)}s–${end.toFixed(2)}s, between ` +
        `"${words[i].word}" and "${words[i + 1].word}". No word is inside it.`,
      level: "documentary",
      beatKey: key,
    });
  }

  return out;
}

function wholeBeatCandidates(beats: BadTakeBeat[], keys: string[], opts: FindOpts): Removal[] {
  const out: Removal[] = [];
  const texts = beats.map((b) => beatText(b));
  const stems = texts.map((t) => stemsOf(t));

  const pushBeat = (i: number, kind: BadPartKind, level: Aggressiveness, why: string) => {
    const start = round3(beats[i].start);
    const end = round3(beats[i].end);
    if (!(end > start)) return;
    out.push({
      id: removalId(kind, start, end, keys[i]),
      kind,
      scope: "beat",
      start,
      end,
      text: texts[i],
      evidence: `Beat at ${start.toFixed(2)}s–${end.toFixed(2)}s: "${snippet(texts[i])}" — ${why}`,
      level,
      beatKey: keys[i],
    });
  };

  for (let i = 0; i < beats.length; i++) {
    const next = i + 1 < beats.length ? beats[i + 1] : null;
    const sameSourceNext = next && (next.sourceId || null) === (beats[i].sourceId || null);

    // Pure-noise beats are already handled per-beat in `findBadParts` — they
    // need no neighbours, and detecting them twice would double-propose.
    if (isAllFiller(texts[i])) continue;

    // FALSE START across beats — an aborted attempt the speaker then restarts.
    // Keep the completed attempt, drop the aborted one.
    if (sameSourceNext && next && !endsTerminal(texts[i])) {
      const aborted = /[-–—]\s*$/.test(texts[i].trim()) || beats[i].end - beats[i].start < 2.5 || texts[i].split(/\s+/).length <= 6;
      const gap = next.start - beats[i].end;
      const mine = [...stems[i]];
      const covered = mine.length ? mine.filter((s) => stems[i + 1].has(s)).length / mine.length : 0;
      if (aborted && gap >= 0 && gap < 1.5 && mine.length > 0 && covered >= 0.6) {
        pushBeat(
          i,
          "false_start",
          "documentary",
          `aborted — the speaker restarts the same thought at ${round3(next.start).toFixed(2)}s ` +
            `("${snippet(texts[i + 1], 48)}"), which covers ${Math.round(covered * 100)}% of this attempt`,
        );
        continue;
      }
    }

    // SHORT REPEAT — the gap dedupeTakes leaves open. It compares sets of words
    // longer than two characters and gives up when either side has fewer than
    // three, so "Yeah, exactly." said twice is invisible to it. Anything longer
    // is dedupeTakes' call, not this module's, and is deliberately not proposed
    // here — two take-pickers would drift.
    if (sameSourceNext && next) {
      const a = normalizeSpokenLine(texts[i]);
      const b = normalizeSpokenLine(texts[i + 1]);
      const shortForDedupe = stems[i].size < 3 || stems[i + 1].size < 3;
      if (a && a === b && shortForDedupe) {
        pushBeat(i, "repeat", "documentary", `said again verbatim at ${round3(next.start).toFixed(2)}s — too short for dedupeTakes to see`);
        continue;
      }
    }

    // TAIL-OFF — the trail after the point has landed: unfinished, and adding
    // no vocabulary the preceding beat did not already carry.
    if (i > 0 && (beats[i].sourceId || null) === (beats[i - 1].sourceId || null)) {
      const novel = [...stems[i]].filter((s) => !stems[i - 1].has(s));
      const trailing = !endsTerminal(texts[i]) || beats[i].end - beats[i].start < 1.5;
      if (trailing && novel.length === 0 && stems[i].size > 0) {
        pushBeat(i, "tail_off", "aggressive", "adds no word the previous beat did not already carry, and does not finish");
        continue;
      }
    }

    // TANGENT — shares no vocabulary with anything else in the run.
    const topic = opts.topicTerms?.length
      ? stemsOf(opts.topicTerms.join(" "))
      : unionExcept(stems, i);
    if (stems[i].size >= 3 && topic.size >= 3) {
      const shared = [...stems[i]].filter((s) => topic.has(s)).length;
      if (shared === 0) {
        pushBeat(i, "tangent", "aggressive", "shares no vocabulary with the rest of the material — off topic");
      }
    }
  }

  return out;
}

function unionExcept(stems: Set<string>[], skip: number): Set<string> {
  const out = new Set<string>();
  stems.forEach((s, i) => {
    if (i === skip) return;
    for (const t of s) out.add(t);
  });
  return out;
}

function normalizeSpokenLine(text: string): string {
  return String(text || "").toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

// ─── Step 2: the guard ───────────────────────────────────────────────────────

export interface GuardContext {
  /** The beats the candidates were found in. Needed for the completeness check. */
  beats: BadTakeBeat[];
}

export type RefusalGuard = GuardClass | "timing" | "boundary" | "completeness" | "continuation" | "overlap" | "bounds";

export interface RefusedRemoval {
  removal: Removal;
  /** Which defence stopped it. */
  guard: RefusalGuard;
  /** Plain language, always set. A refusal nobody can read teaches nobody. */
  reason: string;
}

export interface GuardResult {
  kept: Removal[];
  refused: RefusedRemoval[];
}

/**
 * Refuse every removal that would change what was said, land somewhere that is
 * not a word boundary, or leave an incomplete utterance behind.
 *
 * Order matters: the cheap structural checks run first so the reason a human
 * reads is the most specific one available, and the meaning guard runs before
 * the completeness check so "you deleted a negation" is never reported as
 * "the sentence looked fine".
 *
 * Nothing is dropped silently. A candidate is either in `kept` or in `refused`
 * with a stated reason — the counts always add up.
 */
export function guardRemovals(candidates: Removal[], context: GuardContext): GuardResult {
  const beats = Array.isArray(context?.beats) ? context.beats : [];
  const byKey = new Map<string, { beat: BadTakeBeat; index: number }>();
  beats.forEach((b, i) => byKey.set(beatKeyOf(b, i), { beat: b, index: i }));

  const kept: Removal[] = [];
  const refused: RefusedRemoval[] = [];
  const refuse = (removal: Removal, guard: RefusalGuard, reason: string) => refused.push({ removal, guard, reason });

  for (const removal of sortRemovals(candidates)) {
    const found = byKey.get(removal.beatKey);
    if (!found) {
      refuse(removal, "bounds", `No beat "${removal.beatKey}" in context — a removal cannot be checked against a beat that was not supplied, so it is refused.`);
      continue;
    }
    const { beat, index } = found;
    const words = Array.isArray(beat.words) ? beat.words.filter((w) => w && Number.isFinite(w.start) && Number.isFinite(w.end)) : [];

    // BOUNDS.
    if (!(removal.end > removal.start) || removal.start < beat.start - 1e-6 || removal.end > beat.end + 1e-6) {
      refuse(removal, "bounds", `Removal ${removal.start}s–${removal.end}s does not sit inside its beat (${beat.start}s–${beat.end}s).`);
      continue;
    }

    // TIMING — the honest degrade. Without word timings there is no way to know
    // where a word starts, and a guess is how a word gets clipped in half.
    if (removal.scope === "intra_beat" && !words.length) {
      refuse(
        removal,
        "timing",
        "No word timings on this beat, so no cut inside it can be placed on a real word boundary. " +
          "Refused rather than approximated — leaving the filler in is cosmetic, clipping a word is a broken piece.",
      );
      continue;
    }

    // BOUNDARY — structurally guaranteed by the detector, re-checked because a
    // candidate can arrive from anywhere and this is the check that keeps the
    // speech lock's promise.
    if (removal.scope === "intra_beat") {
      const startsOnWord = words.some((w) => Math.abs(w.start - removal.start) < 1e-3) || words.some((w) => Math.abs(w.end - removal.start) < 1e-3);
      const endsOnWord = words.some((w) => Math.abs(w.end - removal.end) < 1e-3) || words.some((w) => Math.abs(w.start - removal.end) < 1e-3);
      if (!startsOnWord || !endsOnWord) {
        refuse(removal, "boundary", `Removal ${removal.start}s–${removal.end}s does not land on word boundaries — it would cut inside a word.`);
        continue;
      }
    }

    // MEANING — the structural defence. A removal that deletes or spans a
    // guarded token is refused by name, whatever kind it claims to be.
    const guarded = firstGuardedToken(removal.text);
    if (guarded) {
      refuse(
        removal,
        guarded.cls,
        `Refused: removing this would delete the ${guarded.cls} "${guarded.word}". ` +
          `${GUARD_REASON[guarded.cls]} The removal is dropped — the speaker's meaning outranks the filler.`,
      );
      continue;
    }

    // COMPLETENESS — the same standard mergeMomentsIntoBeats holds: what
    // remains must still be a whole spoken thought.
    if (removal.scope === "intra_beat") {
      const problem = incompleteAfterIntraBeat(beat, words, removal);
      if (problem) {
        refuse(removal, "completeness", `Refused: ${problem} A removal must leave a sentence-complete, natural utterance.`);
        continue;
      }
    } else {
      const problem = breaksContinuation(beats, index, removal);
      if (problem) {
        refuse(removal, "continuation", `Refused: ${problem}`);
        continue;
      }
    }

    // OVERLAP — two removals over the same audio compound into a cut neither
    // was checked for. Earliest wins; the loser is reported, not dropped.
    const clash = kept.find((k) => k.beatKey === removal.beatKey && k.start < removal.end - 1e-6 && removal.start < k.end - 1e-6);
    if (clash) {
      refuse(removal, "overlap", `Refused: overlaps an accepted removal (${clash.kind} at ${clash.start}s–${clash.end}s). Two overlapping cuts compound into one neither was checked for.`);
      continue;
    }

    kept.push(removal);
  }

  return { kept: sortRemovals(kept), refused };
}

const GUARD_REASON: Record<GuardClass, string> = {
  negation: "Deleting a negation inverts the sentence — the result still reads, and says the opposite.",
  conditional: "Deleting a conditional strips the caveat and turns a qualified statement into a guarantee.",
  hedge: "Deleting a hedge turns an opinion into a claim.",
  quantifier: "Deleting a quantifier collapses degree — the claim silently gets bigger.",
  modal: "Deleting a modal turns a possibility into a stated fact.",
  comparative: "Deleting a comparative leaves the comparison unanchored.",
};

function firstGuardedToken(text: string): { word: string; cls: GuardClass } | null {
  for (const raw of String(text || "").split(/\s+/)) {
    const cls = guardClassOf(raw);
    if (cls) return { word: raw.replace(/[^A-Za-z0-9']/g, ""), cls };
  }
  return null;
}

/** What remains of a beat once an intra-beat removal is applied — or a reason
 * it would not be a whole thought. */
function incompleteAfterIntraBeat(beat: BadTakeBeat, words: WordTiming[], removal: Removal): string | null {
  const kept = words.filter((w) => !(w.start >= removal.start - 1e-6 && w.end <= removal.end + 1e-6));
  if (!kept.length) return "nothing would be left of the beat.";
  const remaining = joinWords(kept);
  if (contentWordCount(remaining) === 0) return `what remains ("${snippet(remaining)}") carries no content word.`;
  if (endsTerminal(beatText(beat)) && !endsTerminal(remaining)) {
    return `the beat ended on a full stop and what remains ("${snippet(remaining)}") does not — the line would be left hanging.`;
  }
  if (DANGLING.has(lastWordOf(remaining))) {
    return `what remains ends on "${lastWordOf(remaining)}", which dangles.`;
  }
  return null;
}

/** A whole beat leaves intact — nothing is clipped — but it may be the beat
 * that COMPLETES its predecessor's sentence, and removing it leaves that one
 * broken instead. */
function breaksContinuation(beats: BadTakeBeat[], index: number, removal: Removal): string | null {
  const prev = index > 0 ? beats[index - 1] : null;
  if (!prev) return null;
  if ((prev.sourceId || null) !== (beats[index].sourceId || null)) return null;
  if (beats[index].start - prev.end > 0.6) return null; // a real pause — the previous thought stood alone
  if (endsTerminal(beatText(prev))) return null;
  if (isAllFiller(removal.text)) return null; // pure filler completes nothing
  return (
    `the previous beat ("${snippet(beatText(prev), 48)}") does not finish, and this beat continues it. ` +
    "Removing it would leave that line hanging mid-thought — exactly the break the speech lock exists to prevent."
  );
}

// ─── Step 3: apply, and account for it ───────────────────────────────────────

/** What survives of a beat. Intra-beat removals leave GAPS, so the honest
 * shape is a list of kept ranges, not one span — a renderer concatenates them.
 * `start`/`end` stay the outer bounds so `enforceSpeechCraft` still has
 * something to snap to. */
export interface CleanedBeat extends BadTakeBeat {
  /** The ranges that survive, in order. Empty when the whole beat is removed. */
  keptRanges: Array<{ start: number; end: number }>;
  /** True when the whole beat was removed. */
  dropped: boolean;
}

export interface RemovalManifest {
  beatKey: string;
  /** Every removal that was applied, in timeline order. */
  applied: Removal[];
  /** Seconds deleted. Equals the sum of the applied removals, by construction. */
  removedSeconds: number;
  /** Seconds that survive. */
  keptSeconds: number;
  originalText: string;
  cleanedText: string;
  dropped: boolean;
}

export interface ApplyResult {
  beat: CleanedBeat;
  manifest: RemovalManifest;
}

/**
 * Apply removals to one beat and hand back the cut list.
 *
 * The manifest is the deliverable, not a side effect: it is what turns "the
 * system deleted a word" from an argument into a query. Every applied removal
 * is listed with its kind, its bounds, the speaker's own words, and the
 * evidence that condemned it.
 */
export function applyRemovals(beat: BadTakeBeat, removals: Removal[], beatIndex = 0): ApplyResult {
  const key = beatKeyOf(beat, beatIndex);
  const mine = sortRemovals((removals || []).filter((r) => r && r.beatKey === key));
  const original = beatText(beat);
  const words = Array.isArray(beat.words) ? beat.words.filter((w) => w && Number.isFinite(w.start) && Number.isFinite(w.end)) : [];

  const wholeBeat = mine.find((r) => r.scope === "beat");
  if (wholeBeat) {
    return {
      beat: { ...beat, keptRanges: [], dropped: true },
      manifest: {
        beatKey: key,
        applied: [wholeBeat],
        removedSeconds: round3(wholeBeat.end - wholeBeat.start),
        keptSeconds: 0,
        originalText: original,
        cleanedText: "",
        dropped: true,
      },
    };
  }

  // Subtract each removal from the beat span. Removals are non-overlapping —
  // guardRemovals refuses overlaps — so this is a straight walk.
  const keptRanges: Array<{ start: number; end: number }> = [];
  let cursor = round3(beat.start);
  for (const r of mine) {
    if (r.start > cursor + 1e-6) keptRanges.push({ start: cursor, end: round3(r.start) });
    cursor = Math.max(cursor, round3(r.end));
  }
  if (round3(beat.end) > cursor + 1e-6) keptRanges.push({ start: cursor, end: round3(beat.end) });

  const keptWords = words.filter((w) => !mine.some((r) => w.start >= r.start - 1e-6 && w.end <= r.end + 1e-6));
  const cleanedText = words.length ? joinWords(keptWords) : original;

  const removedSeconds = round3(mine.reduce((sum, r) => sum + (r.end - r.start), 0));
  const keptSeconds = round3(keptRanges.reduce((sum, r) => sum + (r.end - r.start), 0));

  return {
    beat: { ...beat, words: words.length ? keptWords : beat.words, keptRanges, dropped: false },
    manifest: {
      beatKey: key,
      applied: mine,
      removedSeconds,
      keptSeconds,
      originalText: original,
      cleanedText,
      dropped: false,
    },
  };
}

// ─── The whole pass ──────────────────────────────────────────────────────────

export interface CleanResult {
  /** Beats that survive, cleaned. Dropped beats are not in here. */
  beats: CleanedBeat[];
  /** One manifest per input beat, including the dropped ones. */
  manifests: RemovalManifest[];
  /** Every candidate that was refused, with the guard that stopped it. */
  refused: RefusedRemoval[];
  /** Why a cut was not proposed where one might have been expected. */
  notes: string[];
  /** Total seconds removed across the run. */
  removedSeconds: number;
}

/**
 * find → guard → apply, in the only order that is safe.
 *
 * This is the entry point the rearrangement pass calls: it hands back cleaned
 * beats to order, and the paperwork to review.
 */
export function cleanBeats(beats: BadTakeBeat[], opts: FindOpts = {}): CleanResult {
  const list = (beats || []).filter((b) => b && Number.isFinite(b.start) && Number.isFinite(b.end));
  const scan = findBadParts(list, opts);
  const guard = guardRemovals(scan.candidates, { beats: list });

  const out: CleanedBeat[] = [];
  const manifests: RemovalManifest[] = [];
  let removedSeconds = 0;

  list.forEach((beat, i) => {
    const { beat: cleaned, manifest } = applyRemovals(beat, guard.kept, i);
    manifests.push(manifest);
    removedSeconds += manifest.removedSeconds;
    if (!manifest.dropped) out.push(cleaned);
  });

  return {
    beats: out,
    manifests,
    refused: guard.refused,
    notes: scan.notes,
    removedSeconds: round3(removedSeconds),
  };
}
