/**
 * ad-hook — the hook engine, applied to PAID ads.
 *
 * Owner, 2026-08-07: "where are the fucking ads at" → "I need the actual
 * finished ads" → "I need 7 ads."
 *
 * ── THE GAP THIS CLOSES ────────────────────────────────────────────────────
 * `_shared/idea-hook.ts` gives every ORGANIC surface its own opening move and
 * its own claim-free close. It has exactly one caller: `actionIdeaApprove`.
 * The ad path — `actionAdPack` — never touched it. It had its own prompt, and
 * that prompt said nothing about who the brand talks to or what surface the ad
 * lands on.
 *
 * Measured on the seven packs generated 2026-08-07 21:23–21:24Z, every one at
 * `placement:"feed"`:
 *
 *     7 packs · 4 brands · 1 creative (all seven carry the same .mp4)
 *     headlines across the non-WePrintWraps brands:
 *       "Unveil the Wrap Magic"  "Behind the Wrap Magic"  "Watch the Wrap Magic"
 *
 * Three brands, one non-sentence. The WePrintWraps pack was the only concrete
 * one ("PRINTED. LAMINATED. LABELED.") and the difference was not talent — it
 * was that WePrintWraps has an 18,037-character brand block in the database and
 * the others have 1,240–11,063. Where facts existed the doctrine worked; where
 * they did not it floated.
 *
 * ── WHAT THIS MODULE DOES ──────────────────────────────────────────────────
 * 1. Maps an ad PLACEMENT onto the doctrine CHANNEL it actually is, so the
 *    hook move and the closer come from `idea-hook.ts` — imported, never
 *    restated. A feed ad opens on a story; a story-placement ad opens on the
 *    reveal; a Reels ad opens as bravely as the doctrine allows.
 * 2. Renders the brand's DECLARED facts (`content-doctrine.ts` `BRAND_FACTS`,
 *    mirroring `contentDoctrine.BRANDS`) into the brief. A brand with no
 *    declared facts gets an explicit "no audience profile" line, so the model
 *    writes thinner copy instead of inventing a reader.
 * 3. Checks the written copy BACK against the declared corpus
 *    (`adClaimViolations`) — the ads-side sibling of `groundingViolations` in
 *    `src/lib/hookEngine.ts` and `footageGrounding` in `marketing-agent`. Same
 *    shape: after the model writes is the only moment fabrication is
 *    observable.
 * 4. Ranks creatives so two ads in one run cannot silently share a video.
 *
 * Pure by design: no database, no network, no clock, no AI call. Locked by
 * `tests/ad-hook.test.ts`.
 */

import { CHANNEL_MOVE, type HookMove } from "./idea-hook.ts";

import { brandFactsFor, type BrandFacts } from "./content-doctrine.ts";
// ONE slop list, shared with the organic writer. See screenAdStrings.
import { slopViolation } from "./piece-copy.ts";

/**
 * The closing line for a PAID ad.
 *
 * `idea-hook.closerFor` is ORGANIC doctrine and it is right for organic: a
 * post earns reach by being engaged with, so it closes on an engagement ask
 * ("Tag someone who needs to see it", "Anyone printing it differently?").
 * Importing it for paid ads carried that ask straight onto bought impressions.
 *
 * Live 2026-08-13: every primary text in both challenger packs for a
 * RETARGETING campaign closed "Tag someone who needs to see it." Retargeting
 * shows ads to people who have ALREADY been to the site — asking them to tag a
 * friend spends the click on someone else's attention instead of the purchase
 * the audience was built for. Owner: "ALL ADS SHOULD BY SHOP NOW / ORDER NOW /
 * BUY NOW."
 *
 * So paid closes on the purchase. Organic is untouched — `closerFor` is still
 * the right answer for a post, and this file is the only caller that needed a
 * different one.
 *
 * The verb varies by brand because the transaction does: WePrintWraps sells
 * film you order, RestylePro sells a design you start. A single "Buy Now"
 * across brands would ask for a purchase that does not exist on some of them.
 */
export function adCloserFor(channel: string, brand: string): string {
  const b = String(brand || "").trim().toLowerCase();
  if (b === "weprintwraps") return "Order now at WePrintWraps.com.";
  if (b === "restylepro" || b === "restyleproai") return "Start your design now at RestyleProAI.com.";
  if (b === "wraptvworld" || b === "wraptv") return "Watch now at WrapTVWorld.com.";
  if (b === "inkandedge") return "Shop now at Ink & Edge.";
  if (b === "designproai") return "Try DesignProAI now.";
  // An unknown brand still gets a purchase ask, just an unbranded one — a
  // paid impression must never close on an engagement question, and guessing
  // a domain would put a URL in an ad that may not resolve.
  return "Shop now.";
}

// ─── Placement → the surface it actually is ──────────────────────────────────

/**
 * A Meta placement is a SURFACE, and the doctrine already describes surfaces.
 * Rather than invent a second vocabulary for paid, each placement points at the
 * doctrine channel whose reading behaviour it shares, and inherits that
 * channel's `hookMove` / `hookEdge` / closer from `idea-hook.ts`.
 *
 * `why` is carried onto the Hub card. A human QC'ing the pack can see WHY a
 * Reels ad opened harder than a feed ad without reading this file.
 */
export const AD_PLACEMENT_CHANNEL: Record<string, { channel: string; why: string }> = {
  feed: {
    channel: "facebook",
    why: "A scrolling social feed between friends' posts — the surface Facebook's doctrine describes. Open in the middle of the moment.",
  },
  story: {
    channel: "instagram",
    why: "Full-screen and one tap from gone. The payoff has to be in frame one, so this is the reveal.",
  },
  reels: {
    channel: "tiktok",
    why: "Short-form vertical against an infinite alternative. The bravest opening the doctrine allows.",
  },
  explore: {
    channel: "instagram",
    why: "Discovery, no prior relationship with the brand. Lead with the outcome, explain after.",
  },
  search: {
    channel: "youtube_short",
    why: "An intent surface — somebody already asked. Answer plainly; do not invert the sentence to be clever.",
  },
  marketplace: {
    channel: "facebook",
    why: "A buying surface inside Facebook. Same register as the feed, aimed at somebody already shopping.",
  },
  audience_network: {
    channel: "facebook",
    why: "Off-platform placements rendered in someone else's app. Assume the least context; keep it plain.",
  },
  in_stream: {
    channel: "youtube",
    why: "It interrupts something they chose to watch. Say what they get for the interruption, in the first line.",
  },
};

/** The placement a caller may name. `feed` is the default in `actionAdPack`. */
export const AD_PLACEMENTS = Object.keys(AD_PLACEMENT_CHANNEL);

/**
 * How each hook move opens, written as a DIRECTION for a model.
 *
 * `idea-hook.frameForMove` is the deterministic sibling of this: it rearranges
 * words that already exist. It cannot serve here because ad copy is being
 * WRITTEN, not reshaped — and that difference is also why `hookEdge` is acted
 * on here rather than merely carried. `idea-hook` states the reason it only
 * carries it: "deterministic code cannot write a braver true sentence, only a
 * braver false one." A model can — which is exactly why every line it writes
 * goes through `adClaimViolations` before it lands.
 */
export const MOVE_DIRECTION: Record<HookMove, string> = {
  reveal: "Open on the RESULT, then say how it happened. The payoff is the first thing on screen, never the setup.",
  question: "Open by ASKING the reader something they have an opinion about. The question must be answerable from their own work.",
  lesson: "Open with what the work TAUGHT — the transferable point, stated flat. No suspense, no build.",
  answer: "Open with the plain, searchable STATEMENT of the thing. No inversion, no cleverness — somebody already asked.",
  story: "Open MID-MOMENT, as if the reader walked in on it. A person, a job, a specific instant — not a summary of the offer.",
  claim: "Open with the ASSERTION itself, stated once and without hedging. Everything after it is support.",
  promise: "Open with what the reader GETS by staying, named concretely enough to be checked.",
};

/** How brave the opening line is allowed to be, from the channel's edge. */
export function edgeDirection(edge: number): string {
  if (edge >= 0.85) return "Edge: very high. The opening may be contrarian or uncomfortable — as long as it is TRUE.";
  if (edge >= 0.7) return "Edge: high. The opening should surprise. It may challenge a common assumption.";
  if (edge >= 0.5) return "Edge: medium. Confident and direct, not provocative.";
  return "Edge: low. Measured and professional. This surface punishes hype.";
}

// ─── The brief ───────────────────────────────────────────────────────────────

export interface AdHookBrief {
  /** Real customer lines the copy may quote WORD FOR WORD. Never paraphrased. */
  quotes: string[];
  placement: string;
  /** False when the caller named a placement the doctrine has no surface for. */
  placementKnown: boolean;
  channel: string;
  move: HookMove;
  edge: number;
  /** `adCloserFor` — the PAID close: a purchase ask, never an engagement ask. */
  closer: string;
  facts: BrandFacts | null;
  /** The block that goes into the model prompt. */
  text: string;
  why: string;
}

/**
 * Everything the ad writer is told about WHO and WHERE, and nothing about what
 * is true — that comes from the brand corpus, and is checked afterwards.
 *
 * An unrecognised placement falls back to `feed` and says so (`placementKnown:
 * false`). Guessing a register for a surface the doctrine never described is
 * the failure `idea-hook` exists to end; the fallback is at least a surface
 * somebody wrote rules for, and the card records that it was a fallback.
 */
export function adHookBrief(
  placement: unknown,
  brandKey: unknown,
  /**
   * REAL CUSTOMER LINES, from `topCustomerQuotes`.
   *
   * Owner, on the one ad of ten that works: "the one thats OK is one built
   * from real customer quote." A customer saying "you're probably a quarter of
   * the price" outsells any sentence a writer can compose, and it is provable.
   *
   * Passed in rather than fetched so this module stays pure — the caller does
   * the I/O, exactly as it does for the brand block.
   */
  customerQuotes: string[] = [],
): AdHookBrief {
  const raw = String(placement || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const known = Object.prototype.hasOwnProperty.call(AD_PLACEMENT_CHANNEL, raw);
  const resolved = known ? raw : "feed";
  const surface = AD_PLACEMENT_CHANNEL[resolved];
  const rule = CHANNEL_MOVE[surface.channel];
  const closer = adCloserFor(surface.channel, String(brandKey || ""));
  const facts = brandFactsFor(brandKey);

  const factBlock = facts
    ? [
        `WHO THIS IS FOR — ${facts.label}`,
        `Audience: ${facts.audience}`,
        `They care about: ${facts.interests.join("; ")}`,
        `What this brand gives away free: ${facts.givesAway}`,
        `Voice: ${facts.voice}`,
        // THE DECLARED CLAIMS. Before these existed the positioning was true
        // and unusable: the guard refuses any figure or guarantee the corpus
        // does not carry, so "10+ years" and the guarantee were dropped as
        // inventions. Stated here, they are the brand's own words to use.
        facts.claims.length
          ? `CLAIMS THIS BRAND HAS MADE — you may state these, and nothing beyond them:\n- ${facts.claims.join("\n- ")}`
          : `This brand has declared no positioning claims. Do not state one.`,
      ].join("\n")
    : `WHO THIS IS FOR — unknown. This brand has no declared audience profile. ` +
      `Write to the facts in the brand block ONLY and keep the copy short. ` +
      `Do NOT invent a reader, an industry or a pain point to aim at.`;

  const text = [
    `PLACEMENT: ${resolved}${known ? "" : ` (the caller sent "${raw}", which is not a placement this doctrine describes — falling back to feed)`}`,
    `SURFACE: ${surface.why}`,
    `HOOK MOVE — ${rule.move}. ${MOVE_DIRECTION[rule.move]}`,
    edgeDirection(rule.edge),
    closer
      ? `CLOSING LINE: the copy is closed with "${closer}" — it is appended for you, so do not write your own sign-off question.`
      : `CLOSING LINE: none on this surface. End on the copy itself.`,
    "",
    factBlock,
    // VERBATIM OR NOT AT ALL. A quotation the corpus contains is testimony
    // that can be proved; a paraphrase of it is a new claim wearing quotation
    // marks, which is the fabricated-customer failure in a better disguise.
    customerQuotes.length
      ? [
          "",
          "REAL CUSTOMER LINES — the strongest material you have. Prefer building the ad on one of these:",
          ...customerQuotes.map((q) => `- "${q}"`),
          "Quote one WORD FOR WORD and attribute it to a customer, or do not quote at all.",
          "Never reword one and keep the quotation marks around it.",
        ].join("\n")
      : "",
  ].filter(Boolean).join("\n");

  return {
    quotes: customerQuotes,
    placement: resolved,
    placementKnown: known,
    channel: surface.channel,
    move: rule.move,
    edge: rule.edge,
    closer,
    facts,
    text,
    why: surface.why,
  };
}

/**
 * Append the channel's claim-free closer, exactly the way `idea-hook`
 * `hookForSurface` does — deterministically, never asked of the model.
 *
 * The close is the one place a brand's register can change the actual words
 * with zero risk of invention, because it asserts nothing about the subject. A
 * model asked for its own sign-off writes "Order today at weprintwraps.com" —
 * which is a claim about availability, wearing a CTA's clothes.
 */
export function withCloser(text: string, closer: string): string {
  const body = String(text || "").trim();
  if (!body || !closer) return body;
  if (body.toLowerCase().endsWith(closer.toLowerCase())) return body;
  return `${body}\n\n${closer}`;
}

// ─── The grounding check ─────────────────────────────────────────────────────

/**
 * Claim shapes a paid ad must never introduce on its own.
 *
 * These are separate from the number rule because they carry no digits:
 * "same-day", "overnight" and "guaranteed" are promises a regulator reads the
 * same way "in 2 days" is read, and none of them would trip a numeric check.
 */
const AD_GUARANTEE = [
  /\bguarantee[ds]?\b/i,
  /\bwarrant(?:y|ies|ied)\b/i,
  /\brisk[-\s]?free\b/i,
  /\bmoney[-\s]?back\b/i,
  /\bno questions asked\b/i,
  /\blifetime\b/i,
];

const AD_TURNAROUND = [
  /\bsame[-\s]?day\b/i,
  /\bnext[-\s]?day\b/i,
  /\bovernight\b/i,
  /\bwhile you wait\b/i,
  /\binstant(?:ly)?\b/i,
];

/** "2 days", "24 hours", "1-2 day", "3–5 business days". */
const AD_DURATION = /\b(\d+)(?:\s*[-–]\s*(\d+))?\s*(business day|day|hour|week|month)s?\b/gi;

/** Fold a corpus for containment tests: lowercase, collapse whitespace. */
function fold(s: string): string {
  return String(s || "").toLowerCase().replace(/\s+/g, " ");
}

/**
 * Check ONE written ad string back against the brand's declared corpus.
 *
 * The ads-side sibling of `groundingViolations` (src/lib/hookEngine.ts) and
 * `footageGrounding` (marketing-agent). Same discipline, same two core rules —
 * a figure and a quotation must exist in the source — plus the two claim
 * classes above, which only a paid ad can get in trouble for.
 *
 * WHAT IS DELIBERATELY *NOT* CHECKED: term overlap. `footageGrounding` rejects
 * a hook whose words mostly do not appear in the transcript, because a hook is
 * supposed to be made OF the footage. Ad copy is not made of the brand block's
 * words and never should be — enforcing overlap here would reject every good
 * headline and pass every fluent lie.
 *
 * DOUBLE QUOTES ONLY, and the curly singles. A straight apostrophe is a
 * contraction far more often than a quotation mark; including it made ordinary
 * prose ("it isn't printable, so you're reprinting") parse as fabricated
 * testimony. That lesson is written up at length in `src/lib/hookEngine.ts` and
 * is not going to be re-learned here.
 *
 * Fails OPEN on an empty corpus: with nothing declared there is nothing to
 * check against, and inventing violations is as dishonest as inventing copy.
 */
export function adClaimViolations(text: unknown, corpus: unknown): string[] {
  const body = String(text || "").trim();
  const source = String(corpus || "").trim();
  if (!body || !source) return [];
  const hay = fold(source);
  const out: string[] = [];

  // NUMBERS — every figure must appear in the declared corpus.
  //
  // Matched BOTH ways round on purpose. `footageGrounding` compares only the
  // comma-stripped form, which is fine against a Whisper transcript and wrong
  // here: a brand block writes "5,000+ shops" and the stripped "5000" is not a
  // substring of it, so a figure the brand genuinely declared would be reported
  // as invented. So the corpus is also read with its thousands separators
  // removed, and either match clears the figure.
  const hayDigits = hay.replace(/,/g, "");
  for (const n of [...new Set(body.match(/\d[\d,]*(?:\.\d+)?%?/g) || [])]) {
    const written = n.replace(/%/g, "").toLowerCase();
    const bare = n.replace(/[%,]/g, "").toLowerCase();
    if (!bare) continue;
    if (!hay.includes(written) && !hayDigits.includes(bare)) {
      out.push(`states "${n}" — that figure appears nowhere in this brand's declared facts`);
    }
  }

  // QUOTES — invented testimony is written in double quotes. The straight `'`
  // is NOT a delimiter here; the inner class allows it so that contractions
  // inside a genuine quotation still match.
  for (const q of [...new Set([...body.matchAll(/(?:["“‘])([^"“”‘’]{6,})(?:["”’])/g)].map((m) => m[1]))]) {
    if (!hay.includes(fold(q))) {
      out.push(`quotes "${q}" — nobody said that in anything this brand has declared`);
    }
  }

  // GUARANTEES — a promise the brand has not made.
  for (const re of AD_GUARANTEE) {
    const hit = body.match(re);
    if (hit && !re.test(source)) {
      out.push(`promises "${hit[0]}" — this brand has not declared any such guarantee`);
    }
  }

  // TURNAROUND — a speed the brand has not declared.
  for (const re of AD_TURNAROUND) {
    const hit = body.match(re);
    if (hit && !re.test(source)) {
      out.push(`claims "${hit[0]}" turnaround — that speed is nowhere in this brand's declared facts`);
    }
  }

  // DURATIONS — the sharpest rule, and the one the plain number check misses.
  //
  // The live 2026-08-07 WePrintWraps pack shipped "FROM FILE TO FLEET IN 2
  // DAYS". The brand block says "fast 1-2 day ship". The digit "2" is in the
  // corpus, so a containment check on the figure alone PASSES it — and a
  // 1-to-2-day SHIP has quietly become a 2-day file-to-fleet promise. So the
  // whole duration is rebuilt and looked up with its left edge guarded: a "2"
  // that only ever appears as the tail of "1-2" does not license "2 days".
  AD_DURATION.lastIndex = 0;
  for (const m of body.matchAll(AD_DURATION)) {
    const [, lo, hi, unit] = m;
    const num = hi ? `${lo}\\s*[-–]\\s*${hi}` : lo;
    const probe = new RegExp(`(?<![\\d\\-–])${num}\\s*${unit}`, "i");
    if (!probe.test(source)) {
      out.push(`claims "${m[0]}" — this brand has declared no such ${unit.toLowerCase()} figure (a "${lo}" that only appears inside a wider range does not license it)`);
    }
  }

  return out;
}

/** Drop the strings that fail, keep the rest, and say what went. */
export function screenAdStrings(
  values: unknown,
  corpus: string,
): { kept: string[]; dropped: Array<{ text: string; why: string }> } {
  const list = Array.isArray(values) ? values : values ? [values] : [];
  const kept: string[] = [];
  const dropped: Array<{ text: string; why: string }> = [];
  for (const v of list) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    // TWO AXES, and they fail for different reasons. adClaimViolations asks
    // "is this TRUE" — did the line invent a figure, a quotation, a guarantee.
    // slopViolation asks "did a person write it". A line can be perfectly
    // grounded and still be machine copy: "Dive into the world of flawless
    // wraps" invents nothing and shipped in a live WePrintWraps pack on
    // 2026-08-13, because the paid path only ever checked the first axis while
    // organic checked both.
    const slop = slopViolation(s);
    if (slop) { dropped.push({ text: s, why: slop }); continue; }
    const bad = adClaimViolations(s, corpus);
    if (bad.length) dropped.push({ text: s, why: bad[0] });
    else kept.push(s);
  }
  return { kept, dropped };
}

// ─── Creative selection ──────────────────────────────────────────────────────

export interface AdCreativeCandidate {
  id: string;
  file_url: string;
  file_type: string;
  name: string;
  tags: string[];
  /** Best `hook_score`/`broll_score` of any moment cut from this asset. */
  score: number;
  /** How many scored moments back that score. Ties break on depth. */
  moments: number;
}

export interface AdCreativeChoice {
  pick: AdCreativeCandidate | null;
  /** True when every candidate was already claimed and one had to repeat. */
  reused: boolean;
  /** Rank of the pick in the ordered pool, 1-based. 0 when nothing was picked. */
  rank: number;
  pool: number;
  /** Said out loud on the Hub card whenever it is not the clean case. */
  note: string | null;
}

/**
 * Pick ONE creative, and never the same one twice while the last pack is still
 * on the board.
 *
 * `actionAdPack` used to take `assets[0]` from a list ordered by `created_at`.
 * Seven packs generated inside 45 seconds therefore got byte-identical media:
 * 7 cards, 1 `media_url`. Ranking fixes the ordering; `claimed` fixes the
 * repetition, and it is a STATE query (which creatives sit on a pack still
 * awaiting QC), not a time window — so a retry behaves the same way an hour
 * later.
 *
 * When everything is claimed the top-ranked candidate is returned with
 * `reused:true` and a note. Silently repeating a creative is the bug; saying
 * "there is only one usable asset" is an answer.
 */
export function pickAdCreative(
  candidates: AdCreativeCandidate[],
  claimed: Iterable<string>,
): AdCreativeChoice {
  const pool = (candidates || []).filter((c) => c && c.file_url);
  if (!pool.length) {
    return { pick: null, reused: false, rank: 0, pool: 0, note: null };
  }

  const ranked = [...pool].sort((a, b) =>
    (b.score || 0) - (a.score || 0) ||
    (b.moments || 0) - (a.moments || 0) ||
    String(a.file_url).localeCompare(String(b.file_url)));

  const taken = new Set([...claimed].map((u) => String(u || "").trim()).filter(Boolean));
  const freeIndex = ranked.findIndex((c) => !taken.has(c.file_url));

  if (freeIndex >= 0) {
    const pick = ranked[freeIndex];
    return {
      pick,
      reused: false,
      rank: freeIndex + 1,
      pool: ranked.length,
      note: pick.score > 0
        ? null
        : `No clip in the library has a scored moment, so this creative was picked by library order, not by hook strength.`,
    };
  }

  return {
    pick: ranked[0],
    reused: true,
    rank: 1,
    pool: ranked.length,
    note: ranked.length === 1
      ? `Only ONE usable asset exists in the library, and it is already on a pending ad pack — this creative repeats it. Add footage before running more ads.`
      : `All ${ranked.length} ranked candidates are already on ad packs awaiting QC — this creative repeats one. Clear the board or add footage.`,
  };
}

// ─── The pre-spend fence ─────────────────────────────────────────────────────

/**
 * The key an ad pack is bought under.
 *
 * Same shape as `footageHookKey` / `cutSourceRef` / `already_designed`: the
 * identity of the WORK, and NO CLOCK — so a retry, a re-run of the hourly
 * sweep, or a second operator pressing the button finds the answer that was
 * already paid for instead of buying it again.
 *
 * Keyed on brand + placement + goal and deliberately NOT on the creative: the
 * model call writes the COPY, and the copy is a function of those three. The
 * creative is chosen by code and costs nothing, so letting it into the key
 * would defeat the fence every time ranking picked a different clip.
 *
 * Measured on the 7 packs of 2026-08-07: 4 distinct (brand, placement, goal)
 * keys, 7 model calls. Three of those seven were re-buying an answer already
 * on the board.
 */
export function adPackKey(brand: unknown, placement: unknown, goal: unknown): string {
  const norm = (v: unknown) => String(v || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `ad:${norm(brand) || "none"}:${norm(placement) || "feed"}:${goalFingerprint(norm(goal))}`;
}

/**
 * A stable, short fingerprint of the goal text. Deterministic (FNV-1a): the
 * same goal always produces the same key, in any runtime, with no crypto import
 * and no async.
 */
function goalFingerprint(goal: string): string {
  if (!goal) return "nogoal";
  let h = 0x811c9dc5;
  for (let i = 0; i < goal.length; i++) {
    h ^= goal.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
