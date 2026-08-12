/**
 * hookEngine — the asset gets the first word, and the last veto.
 *
 * Owner, 2026-08-06: "Content Director supplies the marketing intent. The asset
 * supplies the truth. The Hook Engine connects the two. And if the video/photo
 * doesn't actually support the idea on the card, it should flag that instead of
 * writing bullshit around it."
 *
 * ── THE ORDER IS THE PRODUCT ───────────────────────────────────────────────
 *
 *   1. PARSE ASSET .............. consume `AssetIntelligence` (assetIntelligence.ts)
 *   2. EXTRACT HOOKABLE TRUTHS .. `rankFacts` — what is genuinely in there
 *   3. APPLY BRAND .............. which of those truths matters to THIS brand?
 *   4. APPLY AUDIENCE ........... why would THIS audience care?
 *   5. APPLY PLATFORM + TYPE .... `CHANNELS[channel]` rule, window, angle
 *   6. GENERATE FINAL HOOK ...... a model writes it, from the brief this builds
 *
 * It is written as six real, inspectable steps rather than a paragraph in a
 * prompt because the inverse order is the thing that keeps happening on its own:
 * the Director invents a hook on the card, and the asset is bent to fit it
 * afterwards. That inversion is undetectable in output — a fabricated hook reads
 * exactly like a true one — so the only defence is structural. The hook CANNOT
 * be finalised before step 1 here, because steps 2-5 all take the parse as their
 * input and there is no path through this module that skips it.
 *
 * The Director still supplies idea, objective, brand, audience, platform,
 * content type and hook DIRECTION. All of that is honoured. What it cannot do is
 * assert a fact, and `assetMatch` is where that gets caught.
 *
 * ── THIS MODULE DOES NOT WRITE HOOK COPY. ──────────────────────────────────
 * Same line `videoAngles.ts` holds, for the same reason. Pure code cannot know
 * how to phrase a hook — it has no ear, and it cannot read the footage. A
 * "hook" generated here would be a template with the brand name dropped into it,
 * which is precisely the canned-template slop the GENIE pre-pass was removed for
 * (see CLAUDE.md: "GENIE's canned commercial/trade templates ARE the slop").
 *
 * So: this ranks REAL FACTS, names the claims the asset does NOT support, and
 * assembles the brief a model writes from. Code decides which truths matter and
 * what is off-limits; the model writes the words; `groundingViolations` checks
 * the words back against the asset afterwards. Every string this module emits is
 * either a fact copied out of the parse or a rule — never invented copy.
 *
 * Pure by design: no database, no network, no clock, no AI call. Locked by
 * `tests/hook-engine.test.ts`.
 */

import {
  CHANNELS, BRANDS, PILLAR_BRIEF,
  type ChannelKey, type Pillar,
} from "./contentDoctrine";
import { planAngles } from "./videoAngles";
import {
  contentTerms, hookableFacts, provenFacts, rawCorpus, supportVocabulary,
  supportsClaim, isVideoIntelligence, isImageIntelligence, validateIntelligence,
  type AssetIntelligence, type HookableFact,
} from "./assetIntelligence";

// ─── What the Content Director hands over ────────────────────────────────────

/**
 * The marketing intent. Everything here is DIRECTION, not fact — the card is
 * written before anyone has looked at the asset, which is exactly why nothing on
 * it is allowed to become a claim without passing `assetMatch` first.
 */
export interface DirectorIntent {
  idea: string;
  brand: string;
  channel: ChannelKey;
  contentType?: string;
  objective?: string;
  hookDirection?: string;
}

/** What a model is given to WRITE the hook. Not a hook. */
export interface HookBrief {
  intent: DirectorIntent;
  /** Ranked, grounded, each with its pointer back into the asset. */
  chosenFacts: HookableFact[];
  /** From `videoAngles` — the story THIS channel tells. */
  angle: string;
  channelRule: string;
  hookWindow: string;
  audience: string;
  voice: string;
  /** Claims the asset does NOT support. Named, so they cannot be written. */
  forbidden: string[];
  /** The assembled brief. */
  prompt: string;
}

// ─── Step 5, as weights ──────────────────────────────────────────────────────

/**
 * Which KIND of truth each pillar is looking for.
 *
 * This is what makes the same asset produce a different hook on TikTok than on
 * LinkedIn without anyone writing two cards. An entertain surface wants the
 * transformation and the moment somebody's face changed; an educate surface
 * wants the demonstration and the measurable result. Both are in the same
 * footage — the platform decides which one leads.
 */
const KIND_WEIGHT: Record<Pillar, Record<HookableFact["kind"], number>> = {
  entertain: {
    transformation: 3, tension: 3, emotion: 3, visual: 2.5, result: 2,
    demonstration: 1, proof: 1, statement: 1, detail: 0.5,
  },
  educate: {
    demonstration: 3, proof: 3, detail: 2.5, statement: 2.5, result: 2,
    transformation: 1, tension: 1, visual: 1, emotion: 0.5,
  },
  inspire: {
    transformation: 3, result: 3, emotion: 2.5, visual: 2, proof: 2,
    statement: 1.5, tension: 1.5, demonstration: 1, detail: 1,
  },
};

/** How many facts a writer is handed. More than this is a brief nobody reads. */
export const MAX_CHOSEN_FACTS = 5;

/** At or above this, the asset genuinely carries the card's idea. */
export const ASSET_MATCH_OK = 60;

/** …and at least this much of the idea's own vocabulary must be grounded. */
export const ASSET_MATCH_COVERAGE_OK = 0.5;

function overlapCount(terms: Set<string>, text: string): number {
  let n = 0;
  const seen = new Set<string>();
  for (const t of contentTerms(text)) {
    if (seen.has(t.stem)) continue;
    seen.add(t.stem);
    if (terms.has(t.stem)) n++;
  }
  return n;
}

function stemsOf(texts: Array<string | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const t of texts) for (const c of contentTerms(t)) out.add(c.stem);
  return out;
}

function pillarFor(channel: ChannelKey): Pillar {
  const rule = CHANNELS[channel];
  return (rule?.pillars?.[0] as Pillar) || "educate";
}

function angleFor(i: AssetIntelligence | null | undefined, intent: DirectorIntent) {
  const channel = intent.channel;
  if (!CHANNELS[channel]) {
    return { angle: "", job: "", because: "", brief: "", blocked: undefined as string | undefined };
  }
  // A still photo has no speech, and a video only has it if something was said.
  // `planAngles` uses that to block the angles that would otherwise mean
  // inventing a lesson over silent footage — the same honest gap, inherited
  // rather than re-implemented.
  let hasSpeech: boolean | undefined;
  if (isImageIntelligence(i)) hasSpeech = false;
  else if (isVideoIntelligence(i)) {
    hasSpeech = i.transcript === undefined ? undefined : !!String(i.transcript || "").trim();
  }

  const [planned] = planAngles(
    { brand: intent.brand, topic: intent.idea, hasSpeech },
    [channel],
  );
  return planned;
}

// ─── Steps 2-4: rank the real truths ─────────────────────────────────────────

/**
 * The asset's facts, ordered by what matters here.
 *
 * Score = what KIND of truth this platform wants (step 5)
 *       + how much it touches the BRAND's declared interests (step 3, weighted
 *         hardest — this is what makes a WePrintWraps hook and a WrapTVWorld
 *         hook differ on identical footage)
 *       + how much it touches the AUDIENCE description (step 4)
 *       + how close it is to the Director's idea (step 2, weighted LIGHTLY on
 *         purpose — the card is direction, not evidence, and letting it dominate
 *         would rank whichever fact happened to echo the card's wording, which
 *         is the inversion this whole module exists to prevent)
 *       + confidence.
 *
 * Facts the asset is not confident about are excluded outright: they may be true
 * and they are still shown to a human, but they cannot ground published copy.
 */
export function rankFacts(
  i: AssetIntelligence | null | undefined,
  intent: DirectorIntent,
): HookableFact[] {
  const facts = provenFacts(i);
  if (!facts.length) return [];

  const brand = BRANDS[String(intent?.brand || "").trim()];
  const pillar = pillarFor(intent?.channel);
  const weights = KIND_WEIGHT[pillar] || KIND_WEIGHT.educate;

  const brandTerms = stemsOf(brand?.interests || []);
  const audienceTerms = stemsOf([brand?.audience, brand?.givesAway]);
  const ideaTerms = stemsOf([intent?.idea, intent?.hookDirection, intent?.objective]);

  return facts
    .map((f, index) => {
      const conf = f.confidence === undefined || f.confidence === null ? 0.6 : Number(f.confidence) || 0;
      const score =
        (weights[f.kind] ?? 1) +
        2.0 * overlapCount(brandTerms, f.text) +
        1.5 * overlapCount(audienceTerms, f.text) +
        0.75 * overlapCount(ideaTerms, f.text) +
        1.0 * conf;
      return { f, score, index };
    })
    // Explicit index tie-break: the parse's own order is meaningful (a video
    // parse lists moments chronologically) and an unstable sort would make the
    // same asset rank differently between runs.
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((s) => s.f);
}

// ─── The flag ────────────────────────────────────────────────────────────────

export interface AssetMatch {
  /** 0-100. */
  score: number;
  /** Is the card's idea supported at all? */
  ok: boolean;
  /** What the card needs that the asset does not show. */
  missingProof: string[];
  /** What to do about it. */
  recommendations: string[];
  /** What this asset COULD honestly carry, in its own words. */
  supportedInstead?: string;
}

/**
 * Consecutive words of the card that nothing in the asset supports, grouped back
 * into readable phrases. "production files" reads as a missing thing;
 * "production" and "files" as two loose tokens do not.
 */
function unmatchedPhrases(text: string | null | undefined, vocab: Set<string>): string[] {
  const out: string[] = [];
  let run: string[] = [];
  for (const t of contentTerms(text)) {
    if (vocab.has(t.stem)) {
      if (run.length) { out.push(run.join(" ")); run = []; }
    } else {
      run.push(t.raw);
    }
  }
  if (run.length) out.push(run.join(" "));
  return out;
}

/**
 * Does this asset actually support the card's idea — and if not, say what is
 * missing rather than writing around it.
 *
 * THIS IS THE FLAGGING MECHANISM. The owner's worked example:
 *
 *   Card:  "Show how DesignProAI creates production files"
 *   Asset: a video of the AI generating a render. That is all it shows.
 *   →      ASSET MATCH: low 40s%
 *          missing proof — "no production files shown"
 *          recommendations — source another asset · upload production-output
 *          footage · revise the card angle to what this asset does show.
 *
 * The render footage is a perfectly good asset. It is just not an asset about
 * production files, and the honest outcome is to say so. Writing a "production
 * files" hook over render footage produces a piece that is wrong in a way no
 * reviewer can see from the copy alone — they would have to open the video.
 *
 * The score is deliberately dominated by COVERAGE of the card's own vocabulary
 * (75%), because that is the question being asked: does the asset contain the
 * thing the card is about? The remaining 25% stops a one-fact, low-confidence
 * parse from scoring well on a coincidental word match — an asset can be exactly
 * on topic and still be too thin to cut a piece from.
 */
export function assetMatch(
  i: AssetIntelligence | null | undefined,
  intent: DirectorIntent,
): AssetMatch {
  const facts = provenFacts(i);
  const vocab = supportVocabulary(i);
  const idea = String(intent?.idea || "").trim();

  if (!facts.length) {
    const unparsed = !hookableFacts(i).length;
    return {
      score: 0,
      ok: false,
      missingProof: unparsed ? ["the asset has not been parsed — there are no facts at all"] : ["no fact in this asset is confident enough to ground a claim"],
      recommendations: [
        unparsed
          ? "Parse the asset (transcript + visual pass) before any hook is written from it."
          : "Re-parse the asset — every observation came back low-confidence.",
        "Source another asset from the library that already carries proof of this idea.",
      ],
    };
  }

  const ideaTerms = contentTerms(idea);
  const wanted = [...new Set(ideaTerms.map((t) => t.stem))];
  const covered = wanted.filter((s) => vocab.has(s)).length;
  const coverage = wanted.length ? covered / wanted.length : 0;

  const depth = Math.min(1, facts.length / 4);
  const confAvg =
    facts.reduce((sum, f) => sum + (f.confidence === undefined || f.confidence === null ? 0.6 : Number(f.confidence) || 0), 0) /
    facts.length;

  const score = Math.max(0, Math.min(100, Math.round(100 * (0.75 * coverage + 0.15 * depth + 0.10 * confAvg))));
  const ok = score >= ASSET_MATCH_OK && coverage >= ASSET_MATCH_COVERAGE_OK;

  // MISSING PROOF IS THE FAILURE REPORT (plus one unconditional entry, below).
  //
  // It used to be computed unconditionally, which put a flag on assets that
  // pass. The card's own phrasing is the reason: an objective reads "PROVE the
  // TOOL goes design to print file", and neither "prove" nor "tool" is a thing
  // a camera can show — they are how a director writes direction. This module
  // already draws that line in its own brief ("DIRECTOR'S INTENT — direction,
  // not evidence"); it just was not drawing it here. So a video that
  // demonstrably showed the six production files, on screen, with dimensions,
  // came back carrying "no prove tool shown in the asset" — and every
  // recommendation attached to that list says source another asset, upload
  // footage, do NOT write this hook. Told about a passing asset, that is
  // exactly the false alarm that teaches an operator to ignore the flag, and
  // then the flag is worth nothing on the day it is right.
  //
  // When the asset clears the bar, the answer is: it covers the idea. Residual
  // vocabulary is not proof of a gap — it is the card's grammar.
  const missingProof: string[] = [];
  if (!ok) {
    const seen = new Set<string>();
    for (const source of [idea, intent?.hookDirection, intent?.objective]) {
      for (const phrase of unmatchedPhrases(source, vocab)) {
        const key = phrase.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        missingProof.push(`no ${phrase} shown in the asset`);
      }
    }
  }
  // THINNESS IS UNCONDITIONAL — it is not a coverage question.
  // An asset can be squarely on topic and still carry one usable observation,
  // and one observation is not a piece: there is nothing to cut to. That is
  // true whether or not the vocabulary matched, so it survives the gate above.
  if (facts.length < 2) {
    missingProof.push("only one usable fact — not enough to cut a piece from, even on topic");
  }

  const top = rankFacts(i, intent)[0];
  const supportedInstead = top?.text;

  const recommendations: string[] = [];
  if (!ok) {
    if (missingProof.length) {
      recommendations.push(
        `Source another asset from the library that actually shows: ${missingProof
          .map((m) => m.replace(/^no /, "").replace(/ shown in the asset$/, ""))
          .join("; ")}.`,
      );
      recommendations.push("Upload footage or a photo of the missing step, then re-run this card.");
    }
    if (supportedInstead) {
      // Not invented copy — the asset's own words, handed back as the honest
      // alternative angle. Code cannot phrase a new angle; it can point at a
      // true one.
      recommendations.push(`Revise the card angle to what this asset does show: "${supportedInstead}".`);
    }
    recommendations.push("Do NOT write the intended hook over this asset — flag the card instead.");
  }

  return { score, ok, missingProof, recommendations, ...(supportedInstead ? { supportedInstead } : {}) };
}

// ─── Step 6's input ──────────────────────────────────────────────────────────

/**
 * Build the brief a model writes the hook from.
 *
 * The whole six-step order is visible in the output on purpose: whoever reads a
 * generated hook later can read the brief beside it and see which fact it came
 * from, which brand interest picked that fact, and which claims were off the
 * table. A brief that is just a paragraph of instructions cannot be audited
 * after the fact, and an unauditable brief is how a fabricated hook survives
 * review.
 */
export function buildHookBrief(
  i: AssetIntelligence | null | undefined,
  intent: DirectorIntent,
): HookBrief {
  const channel = intent?.channel;
  const rule = CHANNELS[channel];
  const brand = BRANDS[String(intent?.brand || "").trim()];
  const planned = angleFor(i, intent);
  const chosenFacts = rankFacts(i, intent).slice(0, MAX_CHOSEN_FACTS);
  const match = assetMatch(i, intent);

  // FORBIDDEN — every claim the card carries that the asset cannot back. Named
  // individually, because "stick to the facts" is advice and "do not say
  // 'production files'" is a rule.
  const forbidden: string[] = [];
  for (const raw of [intent?.idea, intent?.hookDirection, intent?.objective]) {
    for (const clause of String(raw || "").split(/[.;:\n]|\s+—\s+/)) {
      const claim = clause.trim();
      if (contentTerms(claim).length < 2) continue;
      const verdict = supportsClaim(i, claim);
      if (!verdict.supported) {
        forbidden.push(`"${claim}" — ${verdict.why}`);
      }
    }
  }
  for (const m of match.missingProof) {
    forbidden.push(`Do not imply otherwise: ${m}.`);
  }
  forbidden.push(
    "Any number, price, date, name, brand or quote that does not appear in the facts above — including a phone number, a percentage, or a customer's words.",
  );

  const factLines = chosenFacts.length
    ? chosenFacts.map((f, n) => `  ${n + 1}. [${f.kind}] ${f.text}\n     evidence: ${f.evidence}${f.confidence != null ? ` (confidence ${f.confidence})` : ""}`)
    : ["  (none — this asset carries no usable fact. Do not write a hook.)"];

  const lines: string[] = [
    "HOOK ENGINE — the hook is written FROM the asset, never around it.",
    "The asset was parsed FIRST. Everything below is either something the asset",
    "actually contains, or a rule about what may not be said.",
    "",
    `STEP 1 — THE ASSET (${isVideoIntelligence(i) ? "video" : isImageIntelligence(i) ? "photo" : "unparsed"}). ASSET MATCH: ${match.score}%.`,
  ];

  if (!match.ok) {
    lines.push(
      "⚠ THIS ASSET DOES NOT SUPPORT THE CARD'S IDEA.",
      ...match.missingProof.map((m) => `   · ${m}`),
      "   Flag the card. Do not write copy that implies the missing proof exists.",
      ...match.recommendations.map((r) => `   → ${r}`),
    );
  }

  lines.push(
    "",
    "STEP 2 — HOOKABLE TRUTHS, ranked. The hook comes from ONE of these:",
    ...factLines,
    "",
    `STEP 3 — BRAND: ${brand?.label || intent?.brand || "(unknown)"}.`,
    brand ? `Interested in: ${brand.interests.join("; ")}.` : "No interest profile for this brand — the copy cannot be aimed.",
    brand ? `What we give away free: ${brand.givesAway}` : "",
    "",
    `STEP 4 — AUDIENCE: ${brand?.audience || "(unknown)"}`,
    "Why would THEY care about the truth above? That answer IS the hook.",
    brand ? `Voice: ${brand.voice}` : "",
    "",
    `STEP 5 — PLATFORM: ${rule?.label || channel}${intent?.contentType ? ` · ${intent.contentType}` : ""}.`,
    `The hook has to land in the ${rule?.hookWindow || "opening"}.`,
    rule?.hookRule || "",
    planned?.angle ? `Angle for this surface — ${planned.angle}. ${planned.job}` : "",
    `Pillar: ${pillarFor(channel)}. ${PILLAR_BRIEF[pillarFor(channel)]}`,
    planned?.blocked ? `⚠ ${planned.blocked}` : "",
    "",
    "DIRECTOR'S INTENT — direction, not evidence. It cannot make something true.",
    `Idea: ${intent?.idea || "(none)"}`,
    intent?.objective ? `Objective: ${intent.objective}` : "",
    intent?.hookDirection ? `Hook direction: ${intent.hookDirection}` : "",
    "",
    "FORBIDDEN — the asset does not support these. Saying them anyway is fabrication:",
    ...forbidden.map((f) => `  · ${f}`),
    "",
    "STEP 6 — WRITE THE HOOK.",
    "One line. Built from a numbered truth above, aimed at the audience above,",
    "shaped by the platform rule above. If none of the truths can carry the",
    "card's idea, say so and stop — an honest flag beats a fabricated hook.",
  );

  return {
    intent,
    chosenFacts,
    angle: planned?.angle || "",
    channelRule: rule?.hookRule || "",
    hookWindow: rule?.hookWindow || "",
    audience: brand?.audience || "",
    voice: brand?.voice || "",
    forbidden,
    prompt: lines.filter((l) => l !== "").join("\n"),
  };
}

// ─── The last line of defence ────────────────────────────────────────────────

/**
 * Claims that are almost never in the footage and almost always in the copy.
 * A sentence containing one of these gets checked against the asset; a sentence
 * that does not is left alone, because a gate that fires on everything is an
 * outage rather than a standard (same reasoning as the doctrine's soft pillar
 * rule).
 */
const CHARGED = [
  /\bbad\b/i, /\bruin/i, /\bfail/i, /\bworst\b/i, /\bdisaster\b/i, /\bdestroy/i,
  /\bwrecked?\b/i, /\bcheapest\b/i, /\bfastest\b/i, /\bguarantee/i,
  /\bnever fails?\b/i, /\bonly\s+\w+\s+that\b/i, /\bnumber one\b/i, /\b#1\b/,
];

/** Below this share of grounded vocabulary, the hook was written around the
 * asset rather than from it. */
const HOOK_GROUNDING_MIN = 0.25;

/**
 * Check a WRITTEN hook back against the asset.
 *
 * Used after a model writes, which is the only moment fabrication can actually
 * be observed — everything before this is prevention. Four checks, each aimed at
 * a specific way copy invents things:
 *
 *   NUMBERS   — "cut install time 40%" when no figure appears anywhere in the
 *               parse. The single most common fabrication, and the most damaging
 *               because it reads as proof.
 *   QUOTES    — a customer sentence in quotation marks that is not in the
 *               transcript. Putting words in a real person's mouth.
 *   CHARGED   — a failure/superlative claim ("bad print ruined this install")
 *               over an asset that shows nothing of the kind.
 *   GROUNDING — a hook whose vocabulary barely intersects the asset at all: not
 *               one specific lie, but copy that was clearly not written from
 *               this file.
 *
 * Fails OPEN by design — an empty hook or an unparsed asset returns no
 * violations rather than blocking, matching the panel QC judge convention in
 * CLAUDE.md ("judge errors fail OPEN … real negative verdicts fail CLOSED").
 */
export function groundingViolations(
  hook: string | null | undefined,
  i: AssetIntelligence | null | undefined,
): string[] {
  const text = String(hook || "").trim();
  if (!text) return [];
  if (!i || validateIntelligence(i).some((p) => p.startsWith("No intelligence"))) return [];
  const facts = provenFacts(i);
  if (!facts.length) return [];

  const out: string[] = [];
  const corpus = rawCorpus(i);
  const corpusLower = corpus.toLowerCase();

  // NUMBERS
  const numbers = text.match(/\d[\d,]*(?:\.\d+)?%?/g) || [];
  for (const n of [...new Set(numbers)]) {
    const bare = n.replace(/[%,]/g, "");
    if (!bare) continue;
    if (!corpusLower.includes(bare.toLowerCase())) {
      out.push(`The hook states "${n}" — that figure appears nowhere in the asset. Remove it or cite where it came from.`);
    }
  }

  // QUOTES
  //
  // DOUBLE QUOTES ONLY — an apostrophe is not a quotation mark. The delimiter
  // class used to include the straight `'`, which made the writer's OWN prose
  // parse as quoted testimony: in "it isn't printable, so you're reprinting"
  // the run from the apostrophe in "isn't" to the one in "you're" is nine
  // characters of ordinary narration, and it was reported as a fabricated
  // quote. In English prose a lone apostrophe is a contraction far more often
  // than a quotation mark, so this fired on almost any natural sentence —
  // every caller of this function was raising false fabrication warnings on
  // ordinary contractions. Genuine invented testimony is written in double
  // quotes (and the curly single quotes ‘ ’ are still honoured, because those
  // ARE used as quote marks and are never typed as a contraction here).
  //
  // …and compared on WORDS, not punctuation.
  //
  // The containment test was literal, so copying a transcript line and adding
  // the terminal full stop a sentence needs — `"…if you're stuck, reprint."`
  // against a corpus ending `…reprint` — read as fabrication. Whether a quote
  // is fabricated is a question of which WORDS somebody said; a comma or a
  // closing stop the writer added is not a lie. Both sides are reduced to bare
  // words before the test, which still catches an invented sentence because
  // its words differ. Deliberately NOT a fuzzy/partial match: the check exists
  // to stop fabricated quotes reaching customers, so every word of the quote
  // must still appear, in order, in the asset.
  const bareWords = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const corpusBare = bareWords(corpus);
  const quoted = [...text.matchAll(/[“"‘]([^“”"‘’]{6,})[”"’]/g)].map((m) => m[1]);
  for (const q of [...new Set(quoted)]) {
    const qb = bareWords(q);
    if (qb && !corpusBare.includes(qb)) {
      out.push(`The hook quotes "${q}" — nobody says that in the asset. A quote must be somebody's actual words.`);
    }
  }

  // CHARGED CLAIMS
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const s = sentence.trim();
    if (!s || !CHARGED.some((re) => re.test(s))) continue;
    const verdict = supportsClaim(i, s);
    if (!verdict.supported) {
      out.push(`The hook claims "${s}" — ${verdict.why}`);
    }
  }

  // OVERALL GROUNDING
  const vocab = supportVocabulary(i);
  const terms = [...new Set(contentTerms(text).map((t) => t.stem))];
  if (terms.length >= 4) {
    const hits = terms.filter((t) => vocab.has(t)).length;
    const grounded = hits / terms.length;
    if (grounded < HOOK_GROUNDING_MIN) {
      out.push(
        `Only ${Math.round(grounded * 100)}% of this hook's words appear anywhere in the asset — it reads as written around the asset rather than from it. Rewrite it from one of the parsed facts.`,
      );
    }
  }

  return out;
}
