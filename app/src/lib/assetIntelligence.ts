/**
 * assetIntelligence — WHAT IS ACTUALLY IN THE PHOTO OR VIDEO, as data.
 *
 * Owner, 2026-08-06: "Content Director supplies the marketing intent. The asset
 * supplies the truth. The Hook Engine connects the two. And if the video/photo
 * doesn't actually support the idea on the card, it should flag that instead of
 * writing bullshit around it."
 *
 * This module is the second sentence: THE ASSET SUPPLIES THE TRUTH. It holds the
 * grounded parse of one source file — what was said, what is visible, what
 * happened — and nothing about marketing. No brand, no channel, no campaign, no
 * copy. Those belong to the variant, not to the file.
 *
 * ── THE ORDER, AND WHY IT IS THIS WAY ROUND ────────────────────────────────
 *
 *   PHOTO/VIDEO → parse what is actually there → identify the strongest real
 *   angle → apply brand context → apply platform + content type → create hook
 *
 * NOT: Content Director invents a hook, then the asset gets bent to fit it. That
 * second order is how a still photo of a clean install ends up captioned "Bad
 * print ruined this install" — the copy was decided before anyone looked at the
 * picture, and the picture had no say. Every function here exists so the picture
 * gets the first word.
 *
 * ── THE ONE RULE THAT SHAPES THE TYPES ─────────────────────────────────────
 * Owner, verbatim: "DO NOT STORE ONE 'AI GENERATED HOOK' ON THE SOURCE ASSET."
 *
 * The asset stores FACTS. Each content variant derives its OWN hook from those
 * facts, for its own brand and its own platform. If a hook were cached on the
 * asset row, the second variant would inherit the first one's angle — the same
 * Instagram line quietly showing up on LinkedIn, and the whole per-platform
 * angling engine (`videoAngles.ts`) reduced to a repost.
 *
 * So the interfaces declare `hook?: never` and `caption?: never`. Assigning one
 * is a TYPE ERROR, not a code-review note, and `validateIntelligence` catches it
 * again at runtime for objects that arrived as JSON from the database or an edge
 * function, where the compiler never saw them.
 *
 * ── A FACT WITHOUT EVIDENCE IS AN ASSERTION ────────────────────────────────
 * Every `HookableFact` carries `evidence` — a quote, a timecode, a described
 * frame. That field is the entire point of the module: it is what lets a human
 * (or `groundingViolations`) go back to the asset and check. A fact with no
 * evidence is indistinguishable from something a model made up on the way past,
 * which is precisely the failure this is built to prevent, so
 * `validateIntelligence` rejects it.
 *
 * Pure by design: no database, no network, no clock, no AI. It consumes a parse;
 * it does not perform one. Locked by `tests/asset-intelligence.test.ts`.
 */

// ─── Facts ───────────────────────────────────────────────────────────────────

/**
 * One true thing the asset supports, stated plainly, with a pointer back to
 * where in the asset it came from.
 *
 * `kind` is not decoration — the Hook Engine weights kinds differently per
 * pillar (a `demonstration` is worth more to an educate channel than an
 * `emotion` is, and the reverse on an entertain surface), so the classification
 * is what lets the same asset produce genuinely different hooks per platform.
 */
export interface HookableFact {
  /** The truth, stated plainly. */
  text: string;
  kind:
    | "statement"
    | "visual"
    | "result"
    | "transformation"
    | "tension"
    | "demonstration"
    | "proof"
    | "detail"
    | "emotion";
  /** Where in the asset this came from — a quote, a timecode, a described frame. */
  evidence: string;
  /** 0-1. How strongly the asset supports it. */
  confidence?: number;
}

/**
 * Below this, a fact is too weak to ground a public claim on. It is kept (it is
 * still a real observation and still useful to a human) but it does not count
 * as proof, and `supportsClaim` says so rather than silently leaning on it.
 */
export const WEAK_CONFIDENCE = 0.4;

/** How much of a claim's own vocabulary the asset must actually cover. */
export const CLAIM_COVERAGE_MIN = 0.7;

// ─── The two shapes of asset ─────────────────────────────────────────────────

export interface VideoIntelligence {
  kind: "video";
  transcript?: string | null;
  speakers?: string[];
  scenes?: string[];
  semanticTopics?: string[];
  visualEvents?: string[];
  strongestMoments?: HookableFact[];
  demonstrations?: string[];
  emotionalMoments?: string[];
  objects?: string[];
  sourceTimecodes?: Record<string, number>;
  hookableFacts: HookableFact[];
  claimsSupported: string[];
  /** NEVER. The asset stores facts; the variant derives the hook. */
  hook?: never;
  caption?: never;
}

export interface ImageIntelligence {
  kind: "image";
  subjects?: string[];
  setting?: string | null;
  visibleText?: string[];
  actions?: string[];
  products?: string[];
  visualFacts?: string[];
  compositionNotes?: string[];
  hookableFacts: HookableFact[];
  claimsSupported: string[];
  /** NEVER. The asset stores facts; the variant derives the hook. */
  hook?: never;
  caption?: never;
}

export type AssetIntelligence = VideoIntelligence | ImageIntelligence;

export const EMPTY_VIDEO_INTELLIGENCE: VideoIntelligence = Object.freeze({
  kind: "video",
  transcript: null,
  speakers: [],
  scenes: [],
  semanticTopics: [],
  visualEvents: [],
  strongestMoments: [],
  demonstrations: [],
  emotionalMoments: [],
  objects: [],
  sourceTimecodes: {},
  hookableFacts: [],
  claimsSupported: [],
}) as VideoIntelligence;

export const EMPTY_IMAGE_INTELLIGENCE: ImageIntelligence = Object.freeze({
  kind: "image",
  subjects: [],
  setting: null,
  visibleText: [],
  actions: [],
  products: [],
  visualFacts: [],
  compositionNotes: [],
  hookableFacts: [],
  claimsSupported: [],
}) as ImageIntelligence;

export function isVideoIntelligence(i: AssetIntelligence | null | undefined): i is VideoIntelligence {
  return !!i && (i as any).kind === "video";
}

export function isImageIntelligence(i: AssetIntelligence | null | undefined): i is ImageIntelligence {
  return !!i && (i as any).kind === "image";
}

// ─── Terms ───────────────────────────────────────────────────────────────────

/**
 * Words that carry no proof. Two groups, and the second is the interesting one.
 *
 * Ordinary grammar words are dropped for the usual reason. The DIRECTIVE VERBS
 * — show, how, create, make, use — are dropped because they are what a marketing
 * card is written in ("Show how DesignProAI creates production files") and they
 * are never the thing that has to be visible in the footage. Counting them as
 * matched vocabulary would let an asset score well for containing the word
 * "show", which is not evidence of anything.
 */
const STOPWORDS = new Set(
  (
    "a an the and or but not no of to in on at for from with without into onto by as is are was were be been being " +
    "it its this that these those there here they them their we our you your i me my he she his her who whom which " +
    "do does did done can could will would should shall may might must have has had just very really actually also " +
    "still more most all any some one two both each other another over under than then when where while about after " +
    "before up out off down again new now today " +
    "show shows showing showed how why what make makes making made create creates creating created use uses using " +
    "used get gets getting got need needs want wants help helps way ways thing things look looks like see sees " +
    "watch watching go goes going come comes take takes give gives put puts"
  ).split(/\s+/),
);

/** Crude, consistent stemming. It does not need to be linguistically right — it
 * needs "printed", "printing" and "prints" to land on the same token on both
 * sides of every comparison. */
function stem(word: string): string {
  let s = word;
  for (const suf of ["ings", "ing", "ers", "er", "ies", "ied", "ed", "es", "s"]) {
    if (s.endsWith(suf) && s.length - suf.length >= 4) return s.slice(0, -suf.length);
  }
  return s;
}

export interface ContentTerm {
  /** The word as written, for messages a human reads. */
  raw: string;
  /** The stemmed token, for comparison. */
  stem: string;
}

/**
 * The words in a piece of text that could actually be evidence of something.
 * Shared by the Hook Engine so a claim and a fact are always tokenised the same
 * way — two tokenisers would drift and the grounding checks would quietly stop
 * agreeing with each other.
 */
export function contentTerms(text: string | null | undefined): ContentTerm[] {
  const words = String(text || "")
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(Boolean);
  const out: ContentTerm[] = [];
  for (const w of words) {
    const bare = w.replace(/'/g, "");
    if (!bare || bare.length < 3) continue;
    if (STOPWORDS.has(bare)) continue;
    out.push({ raw: w, stem: stem(bare) });
  }
  return out;
}

export function termStems(text: string | null | undefined): Set<string> {
  return new Set(contentTerms(text).map((t) => t.stem));
}

// ─── Facts, gathered ─────────────────────────────────────────────────────────

function normaliseFactKey(text: string): string {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function factStrength(f: HookableFact): number {
  return (f.evidence && String(f.evidence).trim() ? 1 : 0) + (Number(f.confidence) || 0);
}

/**
 * Every fact the asset carries, deduped.
 *
 * A video parse can list the same moment twice — once in `strongestMoments` and
 * once in `hookableFacts` — and a ranked list with the same truth in positions
 * one and two looks to the writer like two independent pieces of proof. When two
 * entries say the same thing, the one with evidence and higher confidence wins.
 */
export function hookableFacts(i: AssetIntelligence | null | undefined): HookableFact[] {
  if (!i) return [];
  const raw: HookableFact[] = [
    ...(Array.isArray(i.hookableFacts) ? i.hookableFacts : []),
    ...(isVideoIntelligence(i) && Array.isArray(i.strongestMoments) ? i.strongestMoments : []),
  ].filter((f) => f && typeof f === "object");

  const byKey = new Map<string, HookableFact>();
  for (const f of raw) {
    const key = normaliseFactKey(f.text);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || factStrength(f) > factStrength(existing)) byKey.set(key, f);
  }
  return [...byKey.values()];
}

/** Facts strong enough to hang a public claim on. */
export function provenFacts(i: AssetIntelligence | null | undefined): HookableFact[] {
  return hookableFacts(i).filter((f) => (f.confidence === undefined || f.confidence === null ? 0.6 : Number(f.confidence)) >= WEAK_CONFIDENCE);
}

/**
 * Everything the asset says, as one raw string. Used for the literal checks
 * (numbers, quoted phrases) where stemming would be the wrong tool.
 */
export function rawCorpus(i: AssetIntelligence | null | undefined): string {
  if (!i) return "";
  const parts: string[] = [];
  for (const f of hookableFacts(i)) parts.push(f.text, f.evidence);
  parts.push(...(Array.isArray(i.claimsSupported) ? i.claimsSupported : []));
  if (isVideoIntelligence(i)) {
    parts.push(String(i.transcript || ""));
    parts.push(...(i.scenes || []), ...(i.semanticTopics || []), ...(i.visualEvents || []));
    parts.push(...(i.demonstrations || []), ...(i.emotionalMoments || []), ...(i.objects || []), ...(i.speakers || []));
  }
  if (isImageIntelligence(i)) {
    parts.push(...(i.subjects || []), String(i.setting || ""), ...(i.visibleText || []));
    parts.push(...(i.actions || []), ...(i.products || []), ...(i.visualFacts || []), ...(i.compositionNotes || []));
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * The vocabulary the asset can actually vouch for.
 *
 * Deliberately narrower than `rawCorpus`: only PROVEN facts and the declared
 * `claimsSupported` count. A scene label or an object tag describes the file; it
 * is not a statement the asset stands behind, and letting it ground a claim is
 * how "there is a truck in frame" turns into "we wrapped this truck".
 */
export function supportVocabulary(i: AssetIntelligence | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!i) return out;
  for (const f of provenFacts(i)) {
    for (const t of contentTerms(f.text)) out.add(t.stem);
    for (const t of contentTerms(f.evidence)) out.add(t.stem);
  }
  for (const c of Array.isArray(i.claimsSupported) ? i.claimsSupported : []) {
    for (const t of contentTerms(c)) out.add(t.stem);
  }
  return out;
}

// ─── Does the asset back this? ───────────────────────────────────────────────

export interface ClaimSupport {
  supported: boolean;
  /** The pointer back into the asset, when there is one. */
  evidence?: string;
  /** Plain language, always set — including, and especially, why NOT. */
  why: string;
  /** 0-1: how much of the claim's own vocabulary the asset covers. */
  coverage?: number;
  /** The claim's terms the asset shows nothing for. */
  missingTerms?: string[];
}

/**
 * Does the asset actually back this claim?
 *
 * The test is coverage of the CLAIM's own vocabulary, not similarity. That
 * distinction is the owner's example working:
 *
 *   Photo: an installer squeegeeing a printed panel onto a box truck. No defect
 *   anywhere in frame.
 *   Claim: "Bad print ruined this install."
 *
 * A similarity score says these are close — "print" and "install" are both
 * there, and two words out of four is a decent overlap. Coverage says the two
 * words that CARRY the claim, "bad" and "ruined", have nothing behind them, and
 * refuses. The words a claim is made of are not interchangeable; the accusation
 * is the point of that sentence, and the asset never made it.
 *
 * When it refuses it names the missing terms, because "unsupported" on its own
 * sends a human back to guess what was wrong.
 */
export function supportsClaim(
  i: AssetIntelligence | null | undefined,
  claim: string,
): ClaimSupport {
  const terms = contentTerms(claim);
  if (!terms.length) {
    return { supported: false, why: "Empty claim — there is nothing to check against the asset.", coverage: 0 };
  }
  const facts = provenFacts(i);
  const declared = Array.isArray(i?.claimsSupported) ? i!.claimsSupported.filter(Boolean) : [];
  if (!facts.length && !declared.length) {
    const weak = hookableFacts(i).length;
    return {
      supported: false,
      coverage: 0,
      missingTerms: terms.map((t) => t.raw),
      why: weak
        ? `The asset has ${weak} parsed observation${weak === 1 ? "" : "s"}, but none confident enough (≥ ${WEAK_CONFIDENCE}) to support a public claim.`
        : "The asset has not been parsed — there are no facts to check this against. Parse it before writing anything.",
    };
  }

  const vocab = supportVocabulary(i);
  const wanted = [...new Set(terms.map((t) => t.stem))];
  const missing = terms.filter((t) => !vocab.has(t.stem));
  const missingRaw = [...new Set(missing.map((t) => t.raw))];
  const covered = wanted.filter((s) => vocab.has(s)).length;
  const coverage = wanted.length ? covered / wanted.length : 0;

  // The best pointer back into the asset: whichever single source covers most
  // of the claim.
  let bestEvidence: string | undefined;
  let bestHits = 0;
  for (const f of facts) {
    const fv = new Set([...termStems(f.text), ...termStems(f.evidence)]);
    const hits = wanted.filter((s) => fv.has(s)).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestEvidence = f.evidence || f.text;
    }
  }
  for (const c of declared) {
    const cv = termStems(c);
    const hits = wanted.filter((s) => cv.has(s)).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestEvidence = `declared support: "${c}"`;
    }
  }

  if (coverage >= CLAIM_COVERAGE_MIN) {
    return {
      supported: true,
      evidence: bestEvidence,
      coverage,
      why: `The asset covers ${Math.round(coverage * 100)}% of this claim's own terms${bestEvidence ? ` — ${bestEvidence}` : ""}.`,
    };
  }

  return {
    supported: false,
    coverage,
    missingTerms: missingRaw,
    evidence: bestEvidence,
    why:
      `The asset does not show this. Nothing in it supports: ${missingRaw.join(", ")}. ` +
      `Only ${Math.round(coverage * 100)}% of the claim's terms appear in the parse (needs ${Math.round(CLAIM_COVERAGE_MIN * 100)}%). ` +
      "Flag it — do not write around it.",
  };
}

// ─── Is this parse usable? ───────────────────────────────────────────────────

/**
 * The problems with a parse, in plain language. Empty array = usable.
 *
 * The load-bearing check is the second one. A fact with no `evidence` is an
 * assertion wearing a fact's clothes: nobody can go back to the asset and see
 * it, so it grounds nothing, and grounding is the entire reason this module
 * exists. It is a problem even though the object is otherwise well-formed.
 */
export function validateIntelligence(i: AssetIntelligence | null | undefined): string[] {
  const problems: string[] = [];
  if (!i || typeof i !== "object") return ["No intelligence object — the asset has not been parsed."];

  const kind = (i as any).kind;
  if (kind !== "video" && kind !== "image") {
    problems.push(`Unknown asset kind "${kind}" — expected "video" or "image".`);
  }

  // Owner: "DO NOT STORE ONE 'AI GENERATED HOOK' ON THE SOURCE ASSET." The types
  // forbid it at compile time; this catches the JSON that never met the compiler.
  for (const banned of ["hook", "caption", "headline", "copy"]) {
    if ((i as any)[banned] != null && String((i as any)[banned]).trim()) {
      problems.push(
        `"${banned}" is stored on the asset. The asset holds FACTS; each content variant derives its own hook per brand and platform. A cached hook makes every variant inherit the first one's angle.`,
      );
    }
  }

  if (!Array.isArray(i.hookableFacts)) {
    problems.push("hookableFacts is missing — the asset carries no truth for a hook to be built from.");
  }

  if (!hookableFacts(i).length) {
    problems.push("No hookable facts. Nothing here can ground a hook — parse the asset before writing copy from it.");
  }

  // VALIDATE THE DECLARED FACTS, NOT THE USABLE ONES.
  //
  // `hookableFacts()` is a READER: it dedupes and drops anything whose text
  // normalises to nothing, so every consumer downstream gets a clean list. That
  // is right for reading and wrong for validating — an empty-text fact is
  // exactly the malformed row this function exists to report, and reading
  // through the filter meant the filter ate the evidence of the problem. The
  // fact was silently discarded and `validateIntelligence` returned "no
  // problems" for a parse that had one. Validation therefore reads the RAW
  // declared arrays, including `strongestMoments`, which is the same material
  // `hookableFacts` starts from before it cleans up.
  const declared: HookableFact[] = [
    ...(Array.isArray(i.hookableFacts) ? i.hookableFacts : []),
    ...(isVideoIntelligence(i) && Array.isArray(i.strongestMoments) ? i.strongestMoments : []),
  ].filter((f) => f && typeof f === "object");

  declared.forEach((f, idx) => {
    const label = String(f.text || "").trim() ? `"${String(f.text).slice(0, 48)}"` : `fact #${idx + 1}`;
    if (!String(f.text || "").trim()) {
      problems.push(`Fact #${idx + 1} has no text — an empty fact states nothing.`);
    }
    if (!String(f.evidence || "").trim()) {
      problems.push(
        `Fact ${label} has no evidence. A fact without evidence is an assertion — nobody can check it against the asset, which is the whole point.`,
      );
    }
    const c = f.confidence;
    if (c !== undefined && c !== null && (!Number.isFinite(Number(c)) || Number(c) < 0 || Number(c) > 1)) {
      problems.push(`Fact ${label} has confidence "${c}" — it must be between 0 and 1.`);
    }
  });

  if (!Array.isArray(i.claimsSupported)) {
    problems.push("claimsSupported is missing — state what this asset can honestly back, even if the list is empty.");
  }

  return problems;
}

/** Shorthand: is this parse safe to write from? */
export function isUsableIntelligence(i: AssetIntelligence | null | undefined): boolean {
  return validateIntelligence(i).length === 0;
}
