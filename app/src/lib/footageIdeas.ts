/**
 * footageIdeas — the ideas lane, proposed BY THE FOOTAGE.
 *
 * Owner, 2026-08-07: "I need to do editing using ai to give us hooks based on
 * video uploads and library and drive." And: "Must edit based on viral moments,
 * and possible intrest based."
 *
 * ── THE INVERSION THIS FIXES ────────────────────────────────────────────────
 *
 * The 💡 lane in Content Director reads `content_hooks` — strategy hooks written
 * from brand doctrine. Measured in production 2026-08-07: 534 rows, 525 active.
 * Meanwhile the customer's OWN FOOTAGE had already produced 2,701 moments at
 * hook_score >= 7 across 141 clips, and they proposed nothing. So a human
 * approved a hook written from doctrine, and the matcher then went hunting for a
 * clip to fit it. Backwards: the claim is chosen first and the evidence is found
 * afterwards, which is the exact inversion `hookEngine.ts` exists to prevent.
 *
 * ── WHAT THE HEADLINE NUMBER ACTUALLY CONTAINS ──────────────────────────────
 *
 * "2,701 strong hooks" does not survive contact with the rows. Measured the same
 * day, against production:
 *
 *   hook_score >= 7 ............................................. 2,701
 *   …of which carry a verbatim_quote at all .......................  218   (8%)
 *   …of THOSE, from `media_sources.kind = 'music'` ................  193  (89%)
 *
 * The top-scoring "hooks" in the system are SONG LYRICS. The house music catalog
 * was transcribed by Whisper and hook-scored like speech, and lyrics score 10
 * because lyrics are written to be catchy: "We don't just wrap vehicles We wrap
 * dreams" (10), "Whoa, we're never backing down" (10). Shipping those as "your
 * footage said this" would be a fabrication of the worst kind — it attributes a
 * songwriter's line to a person on camera.
 *
 * The rest of the noise is Whisper's own known failure modes, and they score
 * just as high as the real thing:
 *
 *   "Thanks for watching and don't forget to like and subscribe!" ...... 8
 *   "Nếu bạn thích video hấp dẫn, hãy đăng ký kênh nhé" ................. 8
 *   "1.5 tbsp of cornstarch 1 tbsp of water" ×15 ....................... 8
 *   "Subs by www.zeoranger.co.uk" ................................. unscored
 *
 * None of those words were said. They are what Whisper emits over silence, music
 * and noise. A lane that trusts `hook_score` alone puts them on cards.
 *
 * And underneath the noise there is genuine gold, at the SAME scores:
 *
 *   "We print wraps have allowed me to quit window tint and go commercial
 *    wrap 100%. I do not own a printer. I use them solely for everything.
 *    Only commercial wraps. It's where the money's at." ................ 8
 *   "Cool part about this wrap is we ordered it on Wednesday, it's Friday,
 *    and we're getting started on this Tesla." ......................... 9
 *
 * So the score cannot be the filter — it is only the ranker. The filter has to
 * be these gates, and they are the actual product of this module.
 *
 * ── PURE BY DESIGN ──────────────────────────────────────────────────────────
 * No database, no network, no clock, no AI call — the same discipline
 * `hookEngine.ts` holds, and for the same reason: rules you cannot run in a test
 * are rules nobody checks. Locked by `tests/footage-ideas.test.ts`.
 */

import { contentTerms } from "./assetIntelligence";
import { BRANDS } from "./contentDoctrine";

// ─── The raw row, as it comes off content_moments ────────────────────────────

export interface FootageMoment {
  id: string;
  source_id: string;
  verbatim_quote?: string | null;
  /** The VISION pass's description of this instant. Never set on the same row
   * as a quote — see `pairSignals` for why that matters. */
  visual_description?: string | null;
  hook_score?: number | null;
  soundbite_score?: number | null;
  broll_score?: number | null;
  start_time?: number | string | null;
  end_time?: number | string | null;
  speaker?: string | null;
  /** `media_sources.kind` for this moment's clip — 'music' is disqualifying. */
  source_kind?: string | null;
  source_title?: string | null;
  source_url?: string | null;
  /** Poster frame, when the library happens to hold one. Usually it does not. */
  thumbnail_url?: string | null;
}

// ─── The two passes that never met ───────────────────────────────────────────

/**
 * TRANSCRIPTION AND VISION ALREADY BOTH RAN. THEIR OUTPUTS NEVER MEET.
 *
 * Owner, 2026-08-07: "Why cant it use openai to process transcribe plus vision
 * to help create hooks". Measured against production the same day — they do, and
 * that is exactly the problem:
 *
 *   content_moments ................................ 11,675 rows / 356 clips
 *     from TRANSCRIPTION (verbatim_quote, Whisper) ...  3,653
 *     from VISION (visual_description, gpt-4o) .......  8,017
 *     carrying BOTH ..................................      0
 *
 * They are separate passes writing SEPARATE ROWS. A speech moment has no visual
 * description; a visual moment has no quote. So every consumer of this table can
 * see what was SAID or what was SHOWN — never both for the same second — which
 * is why the hooks read thin. The work is done and paid for; only the join is
 * missing, and the join is free:
 *
 *   clips with speech ... 282 · with vision ... 171 · with BOTH ... 97
 *   speech↔vision pairs overlapping in time ......... 6,370
 *
 * Two things that survey does NOT tell you, and both change the design:
 *
 *  1. ONE SPEECH MOMENT OVERLAPS ~45 VISION MOMENTS on average (6,370 pairs
 *     across 445 covered speech moments). The vision pass samples frames far more
 *     densely than Whisper segments speech. Concatenating every overlap into a
 *     prompt would bury the one line somebody said under forty frame captions —
 *     so the overlaps are RANKED and capped, not appended.
 *
 *  2. OF THE 5,830 USABLE (non-music) PAIRS, ZERO of the speech moments score
 *     hook_score >= 7. The strong-scored speech is almost entirely music-track
 *     lyrics. Gate on the score and the paired signal vanishes entirely. This is
 *     the concrete reason the score is a RANKER here and never a filter.
 */

/** Seconds of shared time below which an "overlap" is a boundary artifact. */
export const MIN_OVERLAP_SECONDS = 0.25;

/** How many vision descriptions one speech moment may carry. Beyond this the
 * quote is buried under frame captions — see note 1 above. */
export const MAX_VISION_PER_MOMENT = 3;

function secs(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Seconds two moments share. 0 when they do not overlap or either lacks bounds. */
export function overlapSeconds(a: FootageMoment, b: FootageMoment): number {
  const as = secs(a?.start_time), ae = secs(a?.end_time);
  const bs = secs(b?.start_time), be = secs(b?.end_time);
  if (as === null || ae === null || bs === null || be === null) return 0;
  return Math.max(0, Math.min(ae, be) - Math.max(as, bs));
}

/** Which passes back a card. Shown on the card and stored on the row: a hook
 * grounded in both is stronger evidence, and "vision-only" makes the gap
 * ("this clip was never transcribed") visible instead of invisible. */
export type SignalKind = "speech" | "vision" | "both";

export interface PairedMoment extends FootageMoment {
  /** The vision descriptions of this same instant, best first, capped. */
  vision: FootageMoment[];
  signals: SignalKind;
}

/**
 * Join the two passes on time, per clip.
 *
 * `vision.start < speech.end AND vision.end > speech.start` — the standard
 * half-open interval overlap, so moments that merely touch at a boundary do not
 * pair. Overlaps are ranked by how much time they actually share, then by
 * `broll_score`: a frame caption covering the whole line describes what the
 * viewer saw while it was said; one clipping the last 0.3s does not.
 *
 * A clip with only one signal keeps it. 259 of 356 clips have only one, and
 * refusing them would throw away most of the library to gain a label.
 */
export function pairSignals(moments: FootageMoment[]): PairedMoment[] {
  const all = moments || [];
  const speech = all.filter((m) => String(m.verbatim_quote || "").trim());
  const vision = all.filter((m) => String(m.visual_description || "").trim());

  const visionByClip = new Map<string, FootageMoment[]>();
  for (const v of vision) {
    const k = String(v.source_id || "");
    const list = visionByClip.get(k);
    if (list) list.push(v); else visionByClip.set(k, [v]);
  }

  const out: PairedMoment[] = speech.map((s) => {
    const candidates = visionByClip.get(String(s.source_id || "")) || [];
    const matched = candidates
      .map((v) => ({ v, shared: overlapSeconds(s, v) }))
      .filter((x) => x.shared >= MIN_OVERLAP_SECONDS)
      .sort((a, b) => b.shared - a.shared || (Number(b.v.broll_score ?? 0) || 0) - (Number(a.v.broll_score ?? 0) || 0))
      .slice(0, MAX_VISION_PER_MOMENT)
      .map((x) => x.v);
    return { ...s, vision: matched, signals: matched.length ? ("both" as SignalKind) : ("speech" as SignalKind) };
  });

  // VISION-ONLY CLIPS still produce cards. A clip nobody transcribed is not a
  // clip with nothing in it — 171 clips carry vision and 74 of them carry no
  // speech at all. Only clips with NO speech contribute here, so a vision
  // moment already attached to a quote above is not also listed on its own.
  const speechClips = new Set(speech.map((s) => String(s.source_id || "")));
  for (const v of vision) {
    if (speechClips.has(String(v.source_id || ""))) continue;
    out.push({ ...v, vision: [], signals: "vision" });
  }
  return out;
}

/** Everything a hook written from this moment is allowed to rest on: the line
 * that was said, plus the descriptions of what was on screen while it was said.
 * A claim may rest on either — never on neither. */
export function evidenceCorpus(m: PairedMoment): string {
  return [String(m.verbatim_quote || ""), String(m.visual_description || ""), ...(m.vision || []).map((v) => String(v.visual_description || ""))]
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n");
}

// ─── Gate 1: it has to be somebody speaking, not a song ──────────────────────

/**
 * Song lyrics are not footage.
 *
 * `media_sources.kind = 'music'` is the house track catalog. Whisper transcribed
 * it and the scorer scored it, so 193 of the 218 quoted strong moments in
 * production are lyrics. CLAUDE.md already draws this line for the Asset Library
 * ("RAW ONLY… the parser's archived audio masters are EXCLUDED") — this is the
 * same line, drawn one table over.
 *
 * Kept as its own named predicate rather than folded into a WHERE clause so the
 * reason survives into the UI: the lane can say "193 music-track lines hidden"
 * instead of silently returning fewer cards than the count promised.
 */
export function isMusicSource(kind: string | null | undefined): boolean {
  return String(kind || "").trim().toLowerCase() === "music";
}

// ─── Gate 2: Whisper's known hallucinations ──────────────────────────────────

/**
 * Whisper emits these over silence, music beds and room noise. They are not in
 * the audio. Every one of them is a documented artifact of the model, not a
 * transcription error — which is why they can be matched literally.
 */
const WHISPER_ARTIFACTS: Array<{ re: RegExp; why: string }> = [
  { re: /thanks?\s+for\s+watching/i, why: "Whisper's most common hallucination over silence — nobody said it" },
  { re: /(don'?t\s+forget\s+to\s+)?(like\s+(and|&)\s+subscribe|subscribe\s+to\s+(my|the)\s+channel)/i, why: "YouTube outro boilerplate Whisper invents over noise" },
  { re: /subs?\s+by\s+\S|subtitles?\s+by\s+\S|amara\.org|zeoranger|subtitled?\s+by\s+the\s+amara/i, why: "a subtitling-credit string Whisper emits over non-speech" },
  { re: /please\s+subscribe/i, why: "outro boilerplate Whisper invents over noise" },
  { re: /^\s*(you|thank you|thanks|bye|okay|ok|so|um+|uh+|mm+|hmm+)[.!\s]*$/i, why: "a single filler token Whisper emits over silence" },
];

/**
 * A phrase repeated until it fills the window.
 *
 * Whisper's decoder loops on repetitive audio. Production carries
 * "1.5 tbsp of cornstarch 1 tbsp of water" fifteen times over, scored 8, on a
 * drone clip that contains no speech at all. The signature is a tiny distinct
 * vocabulary spread over a long string, so that is what is measured — not a
 * blacklist, which would only ever catch the loops already seen.
 */
export const LOOP_MIN_WORDS = 12;
export const LOOP_MAX_UNIQUE_RATIO = 0.34;

export function isRepetitionLoop(quote: string): boolean {
  const words = String(quote || "").toLowerCase().match(/[a-z0-9']+/g) || [];
  if (words.length < LOOP_MIN_WORDS) return false;
  return new Set(words).size / words.length < LOOP_MAX_UNIQUE_RATIO;
}

/**
 * Whisper falls into ANOTHER LANGUAGE over non-speech audio.
 *
 * Two shapes of this are live in production, on silent drone footage:
 *
 *   "시청해 주셔서 감사합니다."                                    (Korean)
 *   "Nếu bạn thích video hấp dẫn, hãy đăng ký kênh nhé…"        (Vietnamese, 8)
 *
 * A script test alone catches only the first. Vietnamese is written in the Latin
 * alphabet, so "does this contain a Latin letter" says yes and the line sails
 * through every other gate: it is seventeen words, it is not boilerplate, and
 * its vocabulary is varied enough not to look like a decoder loop. It would land
 * on a card as something somebody said.
 *
 * So the real test is FUNCTION WORDS. English cannot go seventeen words without
 * one — "the", "and", "to", "we", "is". A line of that length carrying none is
 * not English, whatever alphabet it is written in. Applied only at length,
 * because a genuine short line ("Roll out the rack") can legitimately carry just
 * one, and a five-word English fragment is already rejected for being a fragment.
 */
const ENGLISH_FUNCTION_WORDS = new Set([
  "the","a","an","and","or","but","if","so","of","in","on","at","to","for","with","from","by",
  "is","are","was","were","be","been","am","do","does","did","have","has","had","will","would",
  "can","could","should","this","that","these","those","it","its","we","you","they","he","she",
  "i","me","my","our","your","their","his","her","them","us","not","no","yes","just","about",
  "out","up","down","over","into","what","when","where","who","how","why","there","here","all",
  "got","get","going","gonna","like","really","because","then","than","now","one","two","some",
]);

/** Below this many words, one function word is not required — a short real line
 * can legitimately carry none, and short fragments are rejected anyway. */
export const ENGLISH_CHECK_MIN_WORDS = 8;

export function isNotEnglish(quote: string): boolean {
  const t = String(quote || "").trim();
  if (!t) return false;
  if (!/[A-Za-z]/.test(t)) return true;           // no Latin letters at all
  const words = (t.toLowerCase().match(/[\p{L}']+/gu) || []).map((w) => w.replace(/'/g, ""));
  if (words.length < ENGLISH_CHECK_MIN_WORDS) return false;
  return !words.some((w) => ENGLISH_FUNCTION_WORDS.has(w));
}

/** A hook has to be a sentence somebody could say on camera. */
export const MIN_HOOK_WORDS = 6;

/**
 * Why this line cannot be a card — or null when it can.
 *
 * Returns the REASON, not a boolean, because the lane reports what it
 * suppressed. A filter whose output is a smaller number teaches nobody
 * anything; a filter that says "1,288 fragments under six words" is a fact
 * somebody can act on (re-run the parser with sentence merging).
 */
export function quoteRejection(quote: string | null | undefined): string | null {
  const t = String(quote || "").trim();
  if (!t) return "no transcript line on this moment";
  if (isNotEnglish(t)) return "Whisper produced non-English text over non-speech audio";
  for (const a of WHISPER_ARTIFACTS) if (a.re.test(t)) return a.why;
  if (isRepetitionLoop(t)) return "the same phrase repeats until it fills the window — a Whisper decoder loop, not speech";
  const words = t.match(/[A-Za-z0-9']+/g) || [];
  if (words.length < MIN_HOOK_WORDS) {
    return `only ${words.length} word${words.length === 1 ? "" : "s"} — a transcript fragment, not a hook`;
  }
  return null;
}

/**
 * Everything that disqualifies a MOMENT, gates in order.
 *
 * A VISION-ONLY moment is judged on its description instead of a quote: the
 * Whisper artifact rules are about a speech recogniser's failure modes and mean
 * nothing applied to a frame caption. Only the substance floor carries over —
 * "a truck" is no more a hook than "you" is.
 */
export function momentRejection(m: FootageMoment): string | null {
  if (isMusicSource(m.source_kind)) {
    return "this is a music track — the line is song lyrics, not somebody speaking on camera";
  }
  const quote = String(m.verbatim_quote || "").trim();
  if (!quote) {
    const seen = String(m.visual_description || "").trim();
    if (!seen) return "no transcript line and no visual description on this moment";
    const words = seen.match(/[A-Za-z0-9']+/g) || [];
    if (words.length < MIN_HOOK_WORDS) return `the visual description is only ${words.length} words — too thin to build on`;
    return null;
  }
  return quoteRejection(quote);
}

// ─── The viral score, and the NULL trap ──────────────────────────────────────

/**
 * How strong this moment is, across the three scorers.
 *
 * `hook_score` leads; `soundbite_score` and `broll_score` are the fallbacks for
 * moments the hook scorer never reached. `?? 0` and not `|| 0` on each step, so
 * a real score of 0 is not mistaken for "unscored" and quietly replaced by the
 * next scorer's number.
 *
 * THE NULL TRAP THIS MIRRORS: Postgres `ORDER BY … DESC` puts NULLs FIRST, so a
 * plain `.order("hook_score", { ascending: false })` returns the UNSCORED rows
 * ahead of the strong ones — backwards, and it looks like it is working.
 * `useBrandCast.ts` carries the fixed shape (`nullsFirst: false` on all three)
 * and the query behind this lane must too. Stated here because the sort order
 * and this function have to agree or the ranking is a lie in a different place.
 */
export function viralScore(m: FootageMoment): number {
  return Number(m.hook_score ?? m.soundbite_score ?? m.broll_score ?? 0) || 0;
}

/** At or above this, the moment is worth a human's attention. */
export const STRONG_HOOK = 7;

// ─── Interest: what the AUDIENCE cares about, not what we want to say ────────

export interface InterestMatch {
  /** 0-1. Share of the brand's declared interests this line touches. */
  score: number;
  /** The interests it matched, verbatim from the doctrine. Shown on the card. */
  matched: string[];
  /**
   * 0-1. Overlap with the brand's AUDIENCE and `givesAway` description — the
   * softer signal `rankFacts` weights second. Kept separate from `matched`
   * because it is not a nameable reason: "some of these words appear in the
   * audience description" is a ranking nudge, not something to print on a card
   * as if the footage were about that interest.
   */
  audience: number;
}

function stemsOf(parts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const p of parts) for (const t of contentTerms(p)) out.add(t.stem);
  return out;
}

/**
 * Which of the brand's declared interests this line actually touches.
 *
 * `contentDoctrine.BRANDS[*].interests` is the authored answer to "what does
 * this audience care about" — the same list `hookEngine.rankFacts` weights
 * hardest, and the reason identical footage produces a WePrintWraps hook and a
 * WrapTVWorld hook that differ. This reuses that declaration and the same
 * stemmer rather than adding a third ranker with its own opinion.
 *
 * (`rankFacts` itself is not called here: it takes an `AssetIntelligence` parse,
 * and a transcript moment is not one. Manufacturing a fake parse to reach it
 * would be a worse kind of reuse than sharing its inputs — the doctrine and the
 * stemmer — which is what this does.)
 *
 * Returns the matched interests as TEXT because the card has to show why it is
 * on screen. An unexplained ranking is one nobody can correct.
 */
export function interestMatch(quote: string, brandKey?: string | null): InterestMatch {
  const empty: InterestMatch = { score: 0, matched: [], audience: 0 };
  const brand = BRANDS[String(brandKey || "").trim().toLowerCase()];
  if (!brand || !brand.interests?.length) return empty;

  const said = stemsOf([quote]);
  if (!said.size) return empty;

  const matched: string[] = [];
  for (const interest of brand.interests) {
    const terms = [...stemsOf([interest])];
    if (terms.length && terms.some((t) => said.has(t))) matched.push(interest);
  }

  const audienceTerms = [...stemsOf([brand.audience, brand.givesAway])];
  const audience = audienceTerms.length
    ? audienceTerms.filter((t) => said.has(t)).length / audienceTerms.length
    : 0;

  return { score: matched.length / brand.interests.length, matched, audience };
}

// ─── Ranking: viral finds the candidates, interest picks among them ──────────

export interface RankedMoment extends PairedMoment {
  viral: number;
  interest: InterestMatch;
  /** The combined ordering value. */
  rank: number;
}

/**
 * Interest is weighted to matter without being able to outvote a strong score.
 * A perfect match adds at most INTEREST_WEIGHT + AUDIENCE_WEIGHT = 4.5 — enough
 * to lift a 7 above an 8 that says nothing the audience asked about, never
 * enough to lift a 3 above a 9.
 *
 * The 2:1 split between the declared interests and the audience description
 * mirrors `hookEngine.rankFacts` (2.0 and 1.5 there), so the same footage ranks
 * the same way whichever module is doing the ranking.
 */
export const INTEREST_WEIGHT = 3;
export const AUDIENCE_WEIGHT = 1.5;

/**
 * A moment backed by BOTH passes ranks above one backed by a single pass, all
 * else equal. Deliberately small: being seen as well as heard is corroboration,
 * not a better line. Big enough to break the ties that matter, because only 25
 * of the 1,530 gated moments carry a score at all — with `hook_score` almost
 * entirely null, the pair and the interest match ARE the discriminators.
 */
export const PAIRED_BONUS = 1;

export function rankMoments(moments: FootageMoment[], brandKey?: string | null): RankedMoment[] {
  return pairSignals(moments)
    .filter((m) => !momentRejection(m))
    .map((m, index) => {
      const viral = viralScore(m);
      // Interest is measured against EVERYTHING the moment can vouch for —
      // what was said and what was on screen while it was said. A clip whose
      // speech never names the product but whose frames show the print coming
      // off the roller is still about print quality.
      const interest = interestMatch(evidenceCorpus(m), brandKey);
      const rank =
        viral +
        INTEREST_WEIGHT * interest.score +
        AUDIENCE_WEIGHT * interest.audience +
        (m.signals === "both" ? PAIRED_BONUS : 0);
      return { ...m, viral, interest, rank, index };
    })
    // Explicit index tie-break: an unstable sort would reorder the same lane
    // between refreshes, which reads as the ranking being random.
    .sort((a, b) => b.rank - a.rank || b.viral - a.viral || a.index - b.index)
    .map(({ index: _index, ...m }) => m);
}

// ─── Dedupe: 141 clips, one of them carrying dozens ──────────────────────────

/**
 * How many cards one clip may put in the lane.
 *
 * Production has a single clip carrying 7 strong moments and the music tracks
 * carrying more. Listing every one is a lane nobody can read, and the top of it
 * would be one clip's ramblings rather than the best of the library.
 */
export const MAX_PER_CLIP = 2;

/** The lane's own cap, so one refresh cannot render a thousand cards. */
export const MAX_CARDS = 60;

export interface LaneSuppression {
  /** Cards hidden because their clip already had its best few shown. */
  perClip: number;
  /** Moments dropped by a gate, and what the gate was. */
  rejected: Array<{ reason: string; count: number }>;
  /** Ranked cards beyond the lane cap. */
  overCap: number;
}

export interface FootageLane {
  cards: RankedMoment[];
  clips: number;
  suppressed: LaneSuppression;
  /** How many cards each pass backs. Makes the coverage gap visible: a lane
   * that is all `speech` means the vision pass never reached this footage. */
  signals: Record<SignalKind, number>;
}

/**
 * The lane: ranked, capped per clip, and HONEST about what it hid.
 *
 * `suppressed` is not diagnostics — it is on the card deck. The owner's standing
 * complaint about this system is not knowing whether what it made is any good,
 * and "showing 12 of 2,701" with no reason reads as a bug. "1,288 were transcript
 * fragments under six words; 737 were song lyrics" reads as a system that
 * looked.
 */
export function buildFootageLane(
  moments: FootageMoment[],
  opts?: { brand?: string | null; perClip?: number; max?: number },
): FootageLane {
  const perClip = Math.max(1, opts?.perClip ?? MAX_PER_CLIP);
  const max = Math.max(1, opts?.max ?? MAX_CARDS);

  // Tallied over the PAIRED set, not the raw rows: a vision row folded into a
  // speech card is not a rejection, and counting it as one would report
  // thousands of phantom drops.
  const tally = new Map<string, number>();
  for (const m of pairSignals(moments)) {
    const reason = momentRejection(m);
    if (reason) tally.set(reason, (tally.get(reason) || 0) + 1);
  }

  const ranked = rankMoments(moments, opts?.brand);

  const seen = new Map<string, number>();
  const kept: RankedMoment[] = [];
  let perClipDropped = 0;
  for (const m of ranked) {
    const clip = String(m.source_id || "");
    const n = seen.get(clip) || 0;
    if (n >= perClip) { perClipDropped++; continue; }
    seen.set(clip, n + 1);
    kept.push(m);
  }

  const cards = kept.slice(0, max);
  const signals: Record<SignalKind, number> = { speech: 0, vision: 0, both: 0 };
  for (const c of cards) signals[c.signals]++;
  return {
    cards,
    clips: new Set(cards.map((c) => String(c.source_id))).size,
    signals,
    suppressed: {
      perClip: perClipDropped,
      overCap: Math.max(0, kept.length - cards.length),
      rejected: [...tally.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    },
  };
}

/**
 * One line a human can read, stating what was hidden and why.
 * Never "showing 12" with no denominator — that is how a cap got mistaken for
 * the inventory on the doctrine lane.
 */
export function suppressionSummary(lane: FootageLane): string {
  const s = lane.suppressed;
  const bits: string[] = [];
  if (s.perClip) bits.push(`${s.perClip.toLocaleString()} more from clips already shown`);
  if (s.overCap) bits.push(`${s.overCap.toLocaleString()} past the lane cap`);
  for (const r of s.rejected) bits.push(`${r.count.toLocaleString()} — ${r.reason}`);
  if (!bits.length) return `${lane.cards.length} moments from ${lane.clips} clips. Nothing suppressed.`;
  return `${lane.cards.length} cards from ${lane.clips} clips. Hidden: ${bits.join("; ")}.`;
}

/**
 * The honest empty state.
 *
 * A brand with no scored footage gets told THAT — never doctrine hooks dressed
 * as footage-derived. The two are indistinguishable once they are on the same
 * card, and a strategy hook wearing a clip's name is a fabricated provenance.
 */
export function emptyReason(lane: FootageLane, brand?: string | null): string {
  const who = brand && brand !== "all" ? `${brand} has` : "You have";
  if (!lane.suppressed.rejected.length && !lane.suppressed.perClip) {
    return `${who} no scored footage yet. Upload or parse a clip and its moments will propose ideas here. Nothing is being substituted from the strategy hooks — those live in the Ideas lane and are a different thing.`;
  }
  return `${who} footage, but no line in it survives the quality gates. ${suppressionSummary(lane)} These are transcription artifacts, not hooks — re-parsing the clips with sentence merging is what fixes it.`;
}

// ─── Generated hooks: newly written, but every claim from the transcript ─────

/**
 * A hook a model wrote, and the footage it must answer to.
 *
 * The rule, from the owner via the Content Director spec and already stated in
 * `contentdirectoriq-generate` ("the footage is the only truth a script may
 * claim"): the model MAY phrase, compress and angle. It may NOT introduce a
 * fact, a number, a name, a capability or a customer outcome the footage did not
 * contain.
 */
export interface GeneratedHook {
  text: string;
  /** The clip this was drawn from. */
  sourceId: string;
  momentId: string;
  /** Seconds into the clip. A hook nobody can locate cannot be reviewed. */
  startTime: number | null;
  endTime: number | null;
  /** The transcript line itself, carried on the row. */
  evidenceQuote: string;
  /** What was on screen while it was said. Empty when the clip has no vision. */
  evidenceVisual: string[];
  /** Which passes backed it — the reviewer's at-a-glance strength signal. */
  signals: SignalKind;
  pillarSlug: string | null;
}

/** Below this share of grounded vocabulary the hook was written around the
 * footage rather than from it. Same threshold and reasoning as
 * `hookEngine.HOOK_GROUNDING_MIN`. */
export const FOOTAGE_GROUNDING_MIN = 0.25;

/**
 * Check a WRITTEN hook back against the transcript it claims to come from.
 *
 * The transcript-grounded sibling of `hookEngine.groundingViolations`, which
 * takes an `AssetIntelligence` parse this path does not have. Same four
 * suspicions, same fail-open convention, aimed at the same failure: after a
 * model writes is the only moment fabrication can actually be observed.
 *
 *   NUMBERS   — "cut install time 40%" over footage containing no figure. The
 *               most common fabrication and the most damaging, because a number
 *               reads as proof.
 *   QUOTES    — a sentence in quotation marks that nobody said. Putting words in
 *               a real person's mouth is the one this lane could do worst: every
 *               card here is already presented as somebody's actual speech.
 *   LENGTH    — a hook longer than the line it came from is padding, and padding
 *               is where invented specifics arrive.
 *   GROUNDING — vocabulary that barely intersects the evidence at all: not one
 *               identifiable lie, but copy clearly not written from this clip.
 *
 * `evidence` is the WHOLE corpus — the transcript line AND the visual
 * descriptions of that instant (`evidenceCorpus`). A claim may rest on either
 * signal; it may not rest on neither. What the vision pass does NOT license is
 * an inference: "a person smiling" grounds "he's smiling", not "the customer was
 * satisfied". That distinction is a judgement call this pure code cannot make,
 * so it is stated in the generator's instructions and left to the human on the
 * card — which is why the card shows the evidence, not just the verdict.
 *
 * Fails OPEN on missing input (no hook, no evidence) and CLOSED on a real
 * negative — the panel QC judge convention in CLAUDE.md.
 */
export function footageGroundingViolations(
  hook: string | null | undefined,
  evidence: string | null | undefined,
): string[] {
  const text = String(hook || "").trim();
  const source = String(evidence || "").trim();
  if (!text || !source) return [];

  const lower = source.toLowerCase();
  const out: string[] = [];

  for (const n of [...new Set(text.match(/\d[\d,]*(?:\.\d+)?%?/g) || [])]) {
    const bare = n.replace(/[%,]/g, "");
    if (bare && !lower.includes(bare.toLowerCase())) {
      out.push(`The hook states "${n}" — that figure is nowhere in the transcript. Remove it or cite where it came from.`);
    }
  }

  for (const q of [...new Set([...text.matchAll(/["“']([^"“”']{6,})["”']/g)].map((m) => m[1]))]) {
    if (!lower.includes(q.toLowerCase().trim())) {
      out.push(`The hook quotes "${q}" — nobody says that in the clip. A quote must be somebody's actual words.`);
    }
  }

  if (text.length > source.length * 2 && text.length > 80) {
    out.push(`The hook is ${text.length} characters from ${source.length} characters of evidence — it is padding the footage out, and padding is where invented specifics arrive.`);
  }

  const said = stemsOf([source]);
  const terms = [...new Set(contentTerms(text).map((t) => t.stem))];
  if (terms.length >= 4 && said.size) {
    const grounded = terms.filter((t) => said.has(t)).length / terms.length;
    if (grounded < FOOTAGE_GROUNDING_MIN) {
      out.push(
        `Only ${Math.round(grounded * 100)}% of this hook's words appear in the footage evidence — it reads as written around the clip rather than from it. Rewrite it from the line itself.`,
      );
    }
  }

  return out;
}

/**
 * The pre-spend guard key: one clip × one pillar is bought ONCE.
 *
 * Same shape as `already_scored` in marketing-agent and `already_designed` in
 * designs.js — checked BEFORE the call, never after, and carrying NO CLOCK, so
 * re-running the pass tomorrow finds the same key rather than buying the same
 * generation again. A key with a date in it is not a guard, it is a subscription.
 */
export function generationKey(sourceId: string, pillarSlug?: string | null): string {
  const clip = String(sourceId || "").trim();
  const pillar = String(pillarSlug || "none").trim().toLowerCase();
  return `footage_hook:${clip}:${pillar}`;
}

/** Never let an opt-in generation pass turn into an unrequested bill. */
export const GENERATE_MAX_CLIPS = 8;

/**
 * What a generation run is allowed to touch: the best moment per clip, capped.
 *
 * Fed the ALREADY-GATED lane, so music and Whisper artifacts can never reach a
 * paid call. One moment per clip because a second hook from the same 12 seconds
 * of speech is the same hook with different phrasing — and it costs the same.
 */
export function generationTargets(lane: FootageLane, max = GENERATE_MAX_CLIPS): RankedMoment[] {
  const seen = new Set<string>();
  const out: RankedMoment[] = [];
  for (const c of lane.cards) {
    const clip = String(c.source_id || "");
    if (seen.has(clip)) continue;
    seen.add(clip);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}
