/**
 * piece-copy — the step every module in this system says exists, and none of
 * them ever called: A MODEL WRITES THE FINISHED COPY.
 *
 * Owner, 2026-08-12, looking at a Brand Board card: "Fix brandboard so we get
 * real designs the designs suck."
 *
 * ── WHAT WAS ACTUALLY ON THE BOARD ─────────────────────────────────────────
 * Measured over the last 60 days of `agent_social_posts`, by producer:
 *
 *     idea_approve ........... 167 rows · 167 (100%) under 140 characters
 *     video_renderer_worker ... 45 rows ·  45 (100%) "(Caption not written yet)"
 *     content-director ........ 85 rows ·  47        under 140 characters
 *
 * So roughly 260 of ~400 cards were a fragment or a placeholder. Live examples,
 * verbatim, all from one idea:
 *
 *   instagram → "Merch and VIP access. WrapRewards: every order earns points
 *                toward discounts."          ← the reveal-invert, mid-sentence
 *   linkedin  → "The lesson: WrapRewards: every order earns points toward
 *                discounts, merch and VIP access."
 *   threads   → "Your Customer Said 'I Want To See It First' — Now You Can What
 *                do you charge for this?"    ← two fragments glued, no stop
 *   substack  → "<the same headline>\n\nThe full breakdown is below."
 *                                            ← a "newsletter" of 107 characters
 *
 * None of that is bad writing. It is NOT WRITING — it is the scaffolding that
 * was supposed to be handed to a writer, shipped as the product.
 *
 * ── THE HOLE, IN THE CODEBASE'S OWN WORDS ──────────────────────────────────
 * Every module on this path says the same thing about itself:
 *
 *   `src/lib/ideaHook.ts`  — "it carries the channel rule, move, edge and the
 *      brand's voice OUT on the piece as a `hookBrief`, SO THE MODEL THAT
 *      WRITES FINAL COPY WRITES TO THE BRIEF instead of guessing."
 *   `src/lib/hookEngine.ts` — "THIS MODULE DOES NOT WRITE HOOK COPY… this ranks
 *      REAL FACTS… and assembles the brief A MODEL WRITES FROM."
 *   `src/lib/videoAngles.ts`, `_shared/idea-hook.ts` — the same line again.
 *
 * The brief was built, stored on the row, and read by nothing. `hookBrief` has
 * ZERO consumers in the repository. The deterministic framing — which every one
 * of those files is careful to describe as rearrangement, never copy — was the
 * last thing to touch the text before it hit the board.
 *
 * This module is the missing consumer. It is the ORGANIC sibling of
 * `_shared/ad-hook.ts`, which closed exactly this hole on the paid side, and it
 * is built the same way on purpose: a brief assembled from declared facts, a
 * model that writes, and a guard that checks the words BACK against the source
 * afterwards — because after the model writes is the only moment fabrication is
 * observable.
 *
 * ── WHAT IT MAY NOT DO ─────────────────────────────────────────────────────
 * `actionIdeaApprove` promises "this action never invents a claim", and that
 * promise now has to survive a model being in the loop. So:
 *
 *   · the idea's own words are the ONLY source of fact. The model may write,
 *     restructure, and lengthen with connective prose — it may not add a
 *     figure, a quote, a handle, a domain, a guarantee or a duration;
 *   · `pieceCopyViolations` checks the written text back against that source
 *     and the brand's declared facts, and a surface that fails FALLS BACK to
 *     today's deterministic framing. A fragment is a poor post; a fluent lie
 *     reaches customers;
 *   · NO WRAP LIFESPAN, ever, on any surface, however hedged — the standing
 *     rule in CLAUDE.md, which exists because a model typed a durability range
 *     into a live sales follow-up to a practising attorney. That check is
 *     corpus-INDEPENDENT: it fails even if somebody put a lifespan in the
 *     source, because the rule is about what we publish, not what we were fed.
 *
 * Pure by design: no database, no network, no clock, no AI call — the caller
 * makes the request, this builds the brief and judges the answer. Locked by
 * `tests/piece-copy.test.ts`.
 */

import { CHANNEL_MOVE, channelFor, closerFor, type HookMove } from "./idea-hook.ts";
import { AD_PHRASES, brandFactsFor, type BrandFacts } from "./content-doctrine.ts";

// ─── What a finished piece looks like on each surface ────────────────────────

export interface SurfaceCopyRule {
  /** Verbatim from `CHANNELS[channel].hookRule` in src/lib/contentDoctrine.ts. */
  hookRule: string;
  /** Verbatim from `CHANNELS[channel].hookWindow`. */
  hookWindow: string;
  /** The SHAPE of a finished piece here — what the writer is actually making. */
  shape: string;
  /**
   * The length a real piece runs on this surface. `min` is the one that
   * matters: every failure being measured here was a piece far under it.
   */
  minChars: number;
  maxChars: number;
}

/**
 * Surface → what a finished piece is there.
 *
 * `hookRule` and `hookWindow` are BYTE-IDENTICAL to `src/lib/contentDoctrine.ts`
 * — Deno cannot import `src/lib/*`, so they are restated here for the same
 * reason `_shared/content-doctrine.ts` restates `BRANDS`, and pinned the same
 * way by `tests/piece-copy.test.ts`. A rule that only exists in the browser
 * does not run on the server where the copy is written.
 *
 * `shape`, `minChars` and `maxChars` are NEW and belong here rather than in the
 * doctrine: the doctrine describes what a hook must DO, and says nothing about
 * how long the finished post is. That omission is why a newsletter shipped at
 * 107 characters and nothing in the system objected.
 */
export const SURFACE_COPY: Record<string, SurfaceCopyRule> = {
  instagram: {
    hookRule: "Open ON the payoff or the problem — never on a logo, a greeting, or a slow pan. The first frame is the hook.",
    hookWindow: "first 1 second",
    shape: "A caption of 2-4 short lines. First line is the hook and stands alone. No hashtag block — hashtags are a separate field.",
    minChars: 90, maxChars: 900,
  },
  facebook: {
    hookRule: "Lead with the human story, not the product. Longer copy is allowed here — earn the scroll with a real account of what happened.",
    hookWindow: "first line of text",
    shape: "A short story in 3-6 sentences across 2-3 paragraphs. Conversational. Longer than Instagram, because this surface rewards it.",
    minChars: 180, maxChars: 1200,
  },
  x: {
    hookRule: "Thought-provoking, and OPEN. Ask the real question, or state the thing people disagree about, in a way that invites an answer — the goal is a conversation, not a broadcast. No thread-bait numbering unless the thread genuinely delivers.",
    hookWindow: "first line",
    shape: "One post that fits the limit with room to be quoted. State the thing worth arguing with, then leave the door open. No hashtags.",
    minChars: 60, maxChars: 280,
  },
  threads: {
    hookRule: "Conversational and unfinished — an opinion or a question that invites a reply, not a broadcast.",
    hookWindow: "first line",
    shape: "One conversational post, 2-4 sentences, ending somewhere a reply naturally goes. Never the same opening as the X post.",
    minChars: 80, maxChars: 500,
  },
  linkedin: {
    hookRule: "A business lesson learned the hard way, told plainly. First two lines must earn the 'see more' click without a cliffhanger gimmick.",
    hookWindow: "first 2 lines",
    shape: "4-8 short paragraphs, one line each, written to an operator. Open on the situation, land the lesson, close on the invitation. Never literally the words \"The lesson:\".",
    minChars: 400, maxChars: 1800,
  },
  substack: {
    hookRule: "A point of view, argued. This is the long-form voice of the ecosystem — it should be worth reading even by someone who will never buy.",
    hookWindow: "subject + opening line",
    shape: "A real newsletter: a subject line, an opening that states the position, 2-3 short sections that argue it, and a close. It has to be worth reading on its own — there is no article underneath it to link to.",
    minChars: 700, maxChars: 3500,
  },
  youtube: {
    hookRule: "State the promise of the whole video in one sentence, then start delivering it immediately. No intro sequence, no channel trailer.",
    hookWindow: "first 15 seconds",
    shape: "A title line, then a description of 2-4 sentences that states what the video shows. Written to be searched, not scrolled.",
    minChars: 150, maxChars: 1500,
  },
  youtube_short: {
    hookRule: "Same vertical as the Reel, but written for SEARCH intent — the first words should match what someone would type.",
    hookWindow: "first 1 second",
    shape: "One plain, indexable line. It should read like the question someone typed into search, answered.",
    minChars: 30, maxChars: 100,
  },
  tiktok: {
    hookRule: "Native, unpolished, spoken to camera or straight into the process — and BOLD. Say the thing most shops would not say out loud, open on the most extreme real moment in the footage. A repurposed ad reads as an ad here and dies; so does a hedged one. If it looks produced or sounds careful, rewrite the open.",
    hookWindow: "first 1 second",
    shape: "One or two lines, spoken-out-loud plain. Bold about something the source actually says. Never polished.",
    minChars: 40, maxChars: 300,
  },
  wrapfeed: {
    hookRule: "Our own platform — the same week's story, told without a rented algorithm to please. Depth is allowed.",
    hookWindow: "first line",
    shape: "3-6 sentences with room to breathe. No algorithm to please, so say the thing properly.",
    minChars: 200, maxChars: 1500,
  },
  wraptv_site: {
    hookRule: "Episode framing: the title names the story, the poster frame shows the moment worth watching.",
    hookWindow: "title + poster",
    shape: "An episode blurb: what this one is, and why it is worth the watch. 2-4 sentences.",
    minChars: 120, maxChars: 900,
  },
};

// ─── The brief one surface is written to ─────────────────────────────────────

export interface SurfaceBrief {
  platform: string;
  postType: string;
  /** The doctrine channel this surface maps to. */
  channel: string;
  hookMove: HookMove;
  hookEdge: number;
  hookRule: string;
  hookWindow: string;
  shape: string;
  minChars: number;
  maxChars: number;
  /**
   * The claim-free close `idea-hook.ts` already chose for this channel + brand.
   * Carried as DIRECTION, not appended: a writer that has read the whole brief
   * can land the same invitation in its own words, and gluing a fixed sentence
   * onto finished prose is what produced "…— Now You Can What do you charge for
   * this?".
   */
  closer: string;
}

/**
 * The brief for one surface, or null when the doctrine has never described it.
 *
 * NULL IS THE HONEST ANSWER for an unknown surface. Guessing a register would
 * hand, say, a Pinterest pin Instagram's voice — the exact failure `idea-hook`
 * returns an untouched string to avoid. The caller keeps its deterministic
 * framing for that surface instead of writing to a made-up rule.
 */
export function surfaceBrief(
  platform: unknown,
  postType: unknown,
  brandKey?: unknown,
): SurfaceBrief | null {
  const p = String(platform || "").trim().toLowerCase();
  const t = String(postType || "").trim().toLowerCase();
  const channel = channelFor(p, t);
  const move = CHANNEL_MOVE[channel];
  const rule = SURFACE_COPY[channel];
  if (!p || !move || !rule) return null;

  // An X THREAD row is still one caption field in `agent_social_posts`, so it
  // is written to the single-post limit. Claiming thread length for a column
  // that holds one string would produce copy the surface silently truncates.
  return {
    platform: p,
    postType: t,
    channel,
    hookMove: move.move,
    hookEdge: move.edge,
    hookRule: rule.hookRule,
    hookWindow: rule.hookWindow,
    shape: rule.shape,
    minChars: rule.minChars,
    maxChars: rule.maxChars,
    closer: closerFor(channel, brandKey ?? null),
  };
}

/**
 * A PIECE CANNOT BE LONGER THAN ITS SOURCE CAN SUPPORT.
 *
 * The first real backfill batch is the reason this exists. Nine cards were
 * rewritten and every one passed every guard, because every word reused the
 * source's vocabulary. They were still fiction:
 *
 *   "I received a message from a fellow shop owner who was struggling… I
 *    suggested using a teleprompter tool… That day, they closed the deal."
 *   "a local shop owner brought in a project… transforming an old, worn-out
 *    storefront into a beacon of modern design. Over the next few days, we
 *    worked closely with the owner…"
 *
 * A whole anecdote, invented, from a rambling transcript that contained no
 * such story. (RestylePro does not do storefronts either.) All nine were
 * reverted from the `previous` line kept on the row.
 *
 * The fault was in the ASK, not the writer. Facebook's shape says "a short
 * story in 3-6 sentences… a real account of what happened", and its floor is
 * 180 characters. Hand that brief a one-line idea and the only way to satisfy
 * it is to make something up. No grounding check can catch the result, because
 * a fabricated story built from the source's own words IS grounded.
 *
 * So the length a surface asks for is checked against the substance available
 * BEFORE the model is called. A source that cannot carry the surface is an
 * honest gap — the same answer this pipeline gives everywhere else when the
 * material is not there.
 */
export const EXPANSION_LIMIT = 3;

/** Why this source cannot fill this surface, or null when it can. */
export function sourceTooThin(brief: SurfaceBrief | null, source: unknown): string | null {
  if (!brief) return null;
  const chars = String(source || "").trim().length;
  if (!chars) return "there is no source material to write from";
  // A short surface can always be written: a one-line idea genuinely is an
  // Instagram caption. It is the long surfaces that force invention.
  // The floor keeps the SHORT surfaces always writable — a one-line idea
  // genuinely is an Instagram caption (90) or an X post (60). It sits below
  // Facebook's 180 on purpose: that is the first surface whose shape asks for
  // a story, and a story is the thing that got invented.
  const ceiling = Math.max(120, chars * EXPANSION_LIMIT);
  if (brief.minChars <= ceiling) return null;
  return `the source is ${chars} characters, and a ${brief.platform} ${brief.postType} starts at ` +
    `${brief.minChars} — writing one would mean inventing the difference`;
}

/** How bold this surface may be, in words a writer can act on. */
export function edgeDirection(edge: number): string {
  if (edge >= 0.9) return "Say the thing most shops would not say out loud. Timid dies here.";
  if (edge >= 0.7) return "Bold and direct — it has to stop a thumb.";
  if (edge >= 0.5) return "Confident and plain. No hype, no hedging.";
  return "Measured and credible — a claim a trade buyer would repeat in front of a customer.";
}

/** What the hook move asks for, per surface. Mirrors MOVE_DIRECTION in ad-hook. */
export const MOVE_DIRECTION: Record<HookMove, string> = {
  reveal: "Lead with the payoff. The result first, the setup after.",
  question: "Ask the real question. Leave it genuinely open — a finished claim ends the conversation.",
  lesson: "The operator's takeaway, stated flat. What it cost, what changed.",
  answer: "Answer the question someone typed. Plain and indexable, first words first.",
  story: "Tell what happened, in order, like a person.",
  claim: "Take a position and argue it.",
  promise: "State what the reader gets, then start delivering it.",
};

function brandBlock(facts: BrandFacts | null, brandKey: unknown): string {
  if (!facts) {
    // Say it out loud rather than inventing a reader. `ad-hook.ts` learned this
    // the expensive way: with no declared audience the copy floats into "Unveil
    // the Wrap Magic", three brands, same non-sentence.
    return `BRAND: ${String(brandKey || "unknown")} — no declared audience profile exists for this brand.\n` +
      `Write thinner, more literal copy. Do NOT invent who the reader is or what they care about.`;
  }
  return [
    `BRAND: ${facts.label}`,
    `READER: ${facts.audience}`,
    `THEY CARE ABOUT: ${facts.interests.join(" · ")}`,
    `WE GIVE AWAY: ${facts.givesAway}`,
    `VOICE: ${facts.voice}`,
  ].join("\n");
}

/**
 * The system + user messages that write EVERY surface in ONE pass.
 *
 * One pass, not one call per surface, and that is a correctness decision rather
 * than a cost one: a writer that can see the other five drafts cannot
 * accidentally open two of them the same way. Per-surface calls are how a
 * system ends up with 59 rows and 9 distinct captions — each call was
 * individually fine and none of them could see the others.
 */
export function copyPrompt(
  source: string,
  brandKey: unknown,
  briefs: SurfaceBrief[],
): { system: string; user: string } {
  const facts = brandFactsFor(brandKey);

  const system = [
    `You are the in-house content lead for this brand. You write FINISHED posts —`,
    `the exact words that go out — not drafts, not outlines, not headlines.`,
    ``,
    brandBlock(facts, brandKey),
    ``,
    `THE ONE HARD RULE: the SOURCE below is the only place facts may come from.`,
    `You may restructure it, expand it into real prose, add connective writing and`,
    `ask questions. You may NOT add a number, a price, a date, a duration, a`,
    `statistic, a quotation, a customer name, a shop name, a @handle, a website or`,
    `a guarantee that is not already in the source. If the source is thin, write`,
    `shorter and plainer — never pad it with invented specifics.`,
    ``,
    `NEVER state how long a wrap, print, film or laminate lasts — no lifespan, no`,
    `durability range, no "years", in any form however hedged. Say what laminate`,
    `DOES (protects the print from abrasion and UV) and point at the film`,
    `manufacturer's own published warranty.`,
    ``,
    `NEVER write ad-speak: no "call now", no "limited time", no "act fast", no`,
    `"don't miss out", no "free quote", no "click the link", no "DM us". Every`,
    `piece leads with something worth reading on its own.`,
    ``,
    `NEVER wrap the copy in quotation marks. You are writing the post itself, not`,
    `quoting one. A caption that opens with a " reads as broken.`,
    ``,
    `NEVER open on a rhetorical question tic — no "Ever wondered…", no "Ever found`,
    `yourself…", no "In the world of…", no "Let me take you through…". Open on the`,
    `actual thing that happened or the actual problem. No "jaw-dropping", no`,
    `"game-changer", no "unlock the power of", no "step into the world of".`,
    ``,
    `NEVER invent a person. No customer name, no shop name, no "when Jason walked`,
    `in" — if the source does not name somebody, your copy does not either.`,
    ``,
    `NEVER invent an EVENT. No anecdote, no case study, no "we worked with them`,
    `over the next few days", no "that day they closed the deal" — if the source`,
    `does not describe something happening, your copy does not narrate it. When`,
    `the source is thin, WRITE SHORT. A short true post beats a long invented one.`,
    ``,
    `PLAIN TEXT ONLY: no markdown (no **bold**, no # headings, no [links](url)),`,
    `and no emoji. A person adds an emoji if they want one.`,
    facts ? `SPELL THE BRAND EXACTLY: ${facts.label}. If the source material mis-hears`
      : `SPELL EVERY NAME exactly as the source spells it. If the source mis-hears`,
    facts ? `the name (a transcript often does), use the correct spelling above — never`
      : `a name, do not repeat the mistake — leave the name out instead.`,
    facts ? `repeat the mistake.` : ``,
    ``,
    `Return ONLY a JSON object: {"pieces":{"<key>":"<the finished copy>"}}.`,
  ].join("\n");

  const surfaces = briefs.map((b) => [
    `── ${b.platform}:${b.postType}  (key: "${b.platform}:${b.postType}")`,
    `   SURFACE RULE: ${b.hookRule}`,
    `   HOOK WINDOW: ${b.hookWindow}`,
    `   MOVE: ${MOVE_DIRECTION[b.hookMove]}`,
    `   NERVE: ${edgeDirection(b.hookEdge)}`,
    `   SHAPE: ${b.shape}`,
    `   LENGTH: ${b.minChars}-${b.maxChars} characters. Under ${b.minChars} is not a finished piece for this surface.`,
    b.closer ? `   LAND ON (in your own words, never verbatim): ${b.closer}` : `   Close on the work, not on a question.`,
  ].join("\n")).join("\n\n");

  const user = [
    `SOURCE — the only facts you have:`,
    `"""`,
    String(source || "").trim(),
    `"""`,
    ``,
    `Write one finished piece for each surface below. Every surface gets its own`,
    `opening — no two may start with the same sentence or the same construction,`,
    `and none may be a reworded copy of another. They are read by overlapping`,
    `audiences on the same day.`,
    ``,
    surfaces,
  ].join("\n");

  return { system, user };
}

// ─── The guard: check the words back against the source ──────────────────────

/**
 * A wrap lifespan, in any form. CORPUS-INDEPENDENT — see CLAUDE.md.
 *
 * A duration alone is not a violation ("48 hours" turnaround is a normal, true
 * thing to write). What is forbidden is a duration attached to how long
 * something LASTS, so both halves have to be present in the same sentence.
 */
const LIFESPAN_DURATION = /\b\d+\s*(?:[-–—]\s*\d+)?\s*(?:\+\s*)?(?:year|yr|month|decade)s?\b/i;
/**
 * The same claim spelled out. "It holds up for about a decade" carries no digit
 * and is the identical promise — a check that only reads numerals is one a
 * fluent writer walks straight past.
 */
const LIFESPAN_WORDED =
  /\b(?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve|several|many|a\s+few|a\s+couple\s+of)\s+(?:year|month|decade)s?\b/i;
const LIFESPAN_CONTEXT =
  /\b(last|lasts|lasted|lasting|life\s?span|lifetime|durab|hold\s?up|holds\s?up|held\s?up|stay\s?(?:on|good)|before\s+(?:it|they)\s+(?:fade|peel|crack)|fade|fades|peel|peels|crack|cracks|warrant)/i;

/** Split into rough sentences so a duration and a lifespan word must co-occur. */
function sentences(text: string): string[] {
  return String(text || "").split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function fold(s: string): string {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * SLOP — the openers and tics that mark copy as machine-written.
 *
 * Grounded is not the same as good, and the first live backfill dry run proved
 * it (2026-08-13). Every one of these six passed the fabrication guard, because
 * every word traced back to the cut's own transcript:
 *
 *   "Ever found yourself juggling tasks and wondering if technology could be
 *    your ally in making life easier?"          ← a wrap brand. About wraps.
 *   "Ever wondered how a simple visual transformation can redefine a space?"
 *   "See the jaw-dropping transformation from drab to dynamic! 🎨"
 *   "**Behind the Install — August 9 Mash-Up**" ← markdown, in a description
 *
 * A rhetorical "Ever wondered…" opener asserts nothing, which is exactly why
 * the grounding check cannot see it — and it is the single most recognisable
 * tell of copy nobody wrote. These are matched as PHRASES rather than judged
 * as style, so the rule is inspectable and cannot drift into taste.
 */
const SLOP = [
  /^\s*ever (?:wondered|thought|found yourself|felt)/i,
  /^\s*(?:in|welcome to) the world of\b/i,
  /^\s*(?:let me|let's) (?:share|take you|dive|walk you)/i,
  /\bdive (?:in|into) (?:the|this)\b/i,
  /\bfrom drab to\b/i,
  /\bhead[- ]turning masterpiece\b/i,
  /\bjaw[- ]dropping\b/i,
  /\bgame[- ]chang(?:er|ing)\b/i,
  /\btake (?:it |your \w+ )?to the next level\b/i,
  /\bun(?:lock|veil) the\b/i,
  /\bwatch the magic\b/i,
  /\bcutting[- ]edge\b/i,
  /\bvisual masterpiece\b/i,
  /\bstep into the world\b/i,
  /\binstant wow\b/i,
  /\bwhen it comes to\b/i,
  /\bin today'?s (?:fast[- ]paced|digital|modern)\b/i,
];

/**
 * The machine tic in a line, or null.
 *
 * EXPORTED because the PAID path needs the identical list. Live on the six
 * WePrintWraps packs of 2026-08-13: organic copy correctly refuses "Dive into
 * the world of…", and the same phrase shipped in an ad, because ad-hook
 * screened for invented CLAIMS and nothing else. Two lists would drift the
 * moment one gets a new phrase, so there is one list and one check.
 */
export function slopViolation(text: unknown): string | null {
  const body = String(text || "");
  for (const re of SLOP) {
    const hit = body.match(re);
    if (hit) return `opens on a machine tic ("${hit[0].trim()}") — say the actual thing instead`;
  }
  return null;
}

/** Markdown and emoji. A caption is plain text; a post is not a document. */
const MARKDOWN = /(\*\*|^#{1,6}\s|\[[^\]]+\]\([^)]+\))/m;
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;

/**
 * The brand's own name, mangled.
 *
 * Live in the same dry run: a WrapTVWorld reel came back opening "This is the
 * RAPtv world" — the Whisper transcript mis-heard the brand, and the writer
 * copied the mis-hearing onto the card. Grounding made it WORSE than useless
 * here: the wrong spelling was genuinely "in the source".
 *
 * So the declared label is compared against every similar-looking token in the
 * copy. Compact (letters only, lowercased) so "Wrap TV World" and "WrapTVWorld"
 * agree, and a token counts as a mangling when it shares the label's start or
 * end and is within a couple of edits — close enough to be the brand, not
 * close enough to be right.
 */
function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function brandNameMangled(text: unknown, label: unknown): string | null {
  const want = String(label || "").toLowerCase().replace(/[^a-z]/g, "");
  if (want.length < 6) return null;

  // WORD WINDOWS, not whole runs. A brand written as two or three words
  // ("Wrap TV World", "RAPtv world") only lines up with the compact label if
  // the comparison slides across neighbouring words — matching a whole
  // letters-and-spaces run instead compares "this is the raptv world" to
  // "wraptvworld" and finds nothing, which is how the live mis-spelling got
  // through the first version of this check.
  const words = String(text || "").split(/[^A-Za-z]+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const span = words.slice(i, i + n);
      const got = span.join("").toLowerCase();
      if (!got || got === want) continue;
      // The window swallowed a neighbouring word around an already-correct
      // name ("A WePrintWraps" → "aweprintwraps", one edit away from the
      // label and sharing its tail). The label is intact inside it, so there
      // is nothing mis-heard here.
      if (got.includes(want)) continue;
      if (Math.abs(got.length - want.length) > 3) continue;
      const d = editDistance(got, want);
      if (d > 0 && d <= 3 && (got.slice(0, 3) === want.slice(0, 3) || got.slice(-3) === want.slice(-3))) {
        return `writes "${span.join(" ")}" where the brand is "${label}" — the transcript mis-heard the name and the copy repeated it`;
      }
    }
  }
  return null;
}

/** Guarantees the brand has not declared. Mirrors AD_GUARANTEE in ad-hook.ts. */
const GUARANTEE = [
  /\b(?:100%|money[-\s]?back|satisfaction)\s+guarantee(?:d)?\b/i,
  /\bguarantee(?:d)?\b/i,
  /\bno[-\s]questions[-\s]asked\b/i,
  /\bfree\s+re-?print/i,
];

/**
 * Everything wrong with a written piece, or an empty array.
 *
 * Fails OPEN on an empty source — with nothing to check against, inventing
 * violations is as dishonest as inventing copy — EXCEPT for the lifespan rule
 * and ad-speak, which are absolute and do not consult the corpus at all.
 *
 * The checks mirror `adClaimViolations` in `_shared/ad-hook.ts` deliberately:
 * one shape of fabrication guard across the paid and organic paths, so a lesson
 * learned on one side is not re-learned on the other. Two are new here, because
 * organic copy has two failure modes an ad headline does not — a fabricated
 * @handle or domain (an ad's link is a field, a caption's is prose), and copy
 * that is simply too short to be the thing it claims to be.
 */
export function pieceCopyViolations(
  text: unknown,
  corpus: unknown,
  opts: {
    minChars?: number;
    maxChars?: number;
    label?: string;
    /**
     * The brand's DECLARED name. Supplied so the copy can be checked for a
     * mangled version of it — see `brandNameMangled`.
     */
    brandLabel?: string;
    /**
     * "all" (default) — every check, for copy written FROM a specific source.
     *
     * "hard" — the three that cannot be a false positive against a general
     * corpus: a wrap lifespan, ad-speak, and a fabricated quotation. Used where
     * the copy is legitimately written from a brand's whole voice document
     * rather than one idea, so "this figure is not in the source" would refuse
     * true sentences. Attributing invented words to a named person is never a
     * true sentence, which is why the quote check stays in both scopes.
     */
    scope?: "all" | "hard";
  } = {},
): string[] {
  const body = String(text || "").trim();
  const out: string[] = [];
  if (!body) return ["is empty"];

  // ── ABSOLUTE, corpus-independent ────────────────────────────────────────
  for (const s of sentences(body)) {
    if ((LIFESPAN_DURATION.test(s) || LIFESPAN_WORDED.test(s)) && LIFESPAN_CONTEXT.test(s)) {
      out.push(`states a wrap lifespan ("${s.slice(0, 90)}") — never publish a durability figure, in any form`);
      break;
    }
  }
  for (const re of AD_PHRASES) {
    const hit = body.match(re);
    if (hit) {
      out.push(`is ad-speak ("${hit[0]}") — the doctrine gate blocks this at approval`);
      break;
    }
  }
  const slop = slopViolation(body);
  if (slop) out.push(slop);
  const md = body.match(MARKDOWN);
  if (md) out.push(`contains markdown ("${md[0].trim()}") — a caption is plain text`);
  const emo = body.match(EMOJI);
  if (emo) out.push(`contains an emoji ("${emo[0]}") — a human adds those, not the writer`);
  if (opts.brandLabel) {
    const mangled = brandNameMangled(body, opts.brandLabel);
    if (mangled) out.push(mangled);
  }

  // ── FABRICATED TESTIMONY — checked in BOTH scopes ───────────────────────
  //
  // Live, 2026-08-12 13:00Z, on three channels at once from the daily Content
  // Director cron: `"When a customer walks into your shop, they need to see
  // more than just samples…" - Founder, RestyleProAI`. Nobody said it. Putting
  // invented words in a named person's mouth is a different order of wrong
  // from a fragment, and it is the one check worth running even where the
  // corpus is a whole brand document.
  //
  // DOUBLE QUOTES ONLY. A straight apostrophe is a contraction far more often
  // than a quotation mark; treating it as a delimiter made ordinary prose parse
  // as fabricated testimony, which is written up at length in
  // `src/lib/hookEngine.ts` and is not going to be re-learned here.
  const hayAll = fold(String(corpus || ""));
  if (hayAll) {
    for (const q of [...new Set([...body.matchAll(/(?:["“])([^"“”]{6,})(?:["”])/g)].map((m) => m[1]))]) {
      if (!hayAll.includes(fold(q))) out.push(`quotes "${q}" — nobody says that in the source`);
    }
  }

  if (opts.scope === "hard") return out;

  // ── LENGTH — the failure actually being measured ────────────────────────
  if (opts.minChars && body.length < opts.minChars) {
    out.push(`is ${body.length} characters — under the ${opts.minChars} a finished piece runs on this surface`);
  }
  if (opts.maxChars && body.length > opts.maxChars) {
    out.push(`is ${body.length} characters — over this surface's ${opts.maxChars} limit`);
  }

  // ── GROUNDED IN THE SOURCE ──────────────────────────────────────────────
  const source = String(corpus || "").trim();
  if (!source) return out;
  const hay = fold(source);
  const hayDigits = hay.replace(/,/g, "");

  // NUMBERS — matched both ways round, so "5,000+" in the source licenses
  // "5000" in the copy and vice versa. Same reasoning as ad-hook.ts.
  for (const n of [...new Set(body.match(/\d[\d,]*(?:\.\d+)?%?/g) || [])]) {
    const written = n.replace(/%/g, "").toLowerCase();
    const bare = n.replace(/[%,]/g, "").toLowerCase();
    if (!bare) continue;
    if (!hay.includes(written) && !hayDigits.includes(bare)) {
      out.push(`states "${n}" — that figure appears nowhere in the source`);
    }
  }

  // (Quotes are checked above, in both scopes.)

  // A PERSON WHO DOES NOT EXIST.
  //
  // Live on the second backfill dry run (2026-08-13): "When Jason first walked
  // into our shop, he was apprehensive. His business vehicle looked tired…" —
  // a customer, a mood and a scene, none of which are anywhere in the source.
  // It is the founder-quote failure wearing different clothes, and it slipped
  // every check above: no figure, no quotation marks, no handle, no domain.
  //
  // A capitalised word MID-SENTENCE is a name. Sentence-initial words are
  // skipped because "When" and "Every" are capitalised by grammar rather than
  // by being anybody, and the common-word list covers the rest. A name that IS
  // in the source passes untouched — this forbids inventing people, not
  // mentioning them.
  const NOT_A_NAME = new Set([
    "i", "i'm", "we", "our", "the", "a", "an", "and", "but", "or", "so", "if", "then",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "may", "june", "july", "august",
    "september", "october", "november", "december",
    "instagram", "facebook", "youtube", "linkedin", "tiktok", "threads", "substack",
    "ai", "diy", "usa", "us", "uv", "pdf", "dpi", "cmyk", "rgb", "qc",
  ]);
  const brandWords = new Set(
    String(opts.brandLabel || "").toLowerCase().split(/[^a-z]+/).filter(Boolean),
  );
  for (const sentence of sentences(body)) {
    const words = sentence.split(/\s+/);

    // A NAME HIDES IN PROSE. A HEADING IS CAPITALISED THROUGHOUT.
    //
    // The first version of this check flagged "From" out of "From Prompt To
    // Production" and "Loyalty" out of "Subject: Loyalty Programs: More Than
    // Just Points" — heading words, not people, and refusing those would have
    // thrown away perfectly good copy, which is the opposite of the point.
    //
    // So a line that is MOSTLY capitalised is read as a title and skipped
    // whole. "When Jason first walked into our shop" is one capital in ten
    // words; a headline is most of them.
    const capitalised = words.filter((w) => /^[A-Z]/.test(w.replace(/[^A-Za-z]/g, ""))).length;
    if (words.length < 5 || capitalised / words.length > 0.4) continue;

    for (let i = 1; i < words.length; i++) {          // i = 1 → skip sentence-initial
      const bare = words[i].replace(/[^A-Za-z'’-]/g, "");
      if (bare.length < 3 || !/^[A-Z][a-z’'-]+$/.test(bare)) continue;
      // "That's" is a contraction wearing a capital, not a person.
      if (/[’']s?$/i.test(bare) || /[’']/.test(bare)) continue;
      // Directly after a colon or a dash is a heading position too.
      if (/[:—–-]$/.test(words[i - 1])) continue;
      const low = bare.toLowerCase();
      if (NOT_A_NAME.has(low) || brandWords.has(low)) continue;
      // A word the previous token already ended a sentence with is still
      // sentence-initial in practice; the split handles most of it, and a
      // source hit clears the rest.
      if (hay.includes(low)) continue;
      out.push(`names "${bare}" — no such person or company is in the source`);
      break;
    }
    if (out.some((v) => v.startsWith("names "))) break;
  }

  // HANDLES AND DOMAINS — an invented @shop or .com is a real business that
  // belongs to somebody else. Organic-only: an ad's destination is a field, a
  // caption's is prose the model can make up.
  for (const h of [...new Set(body.match(/@[a-z0-9._]{3,}/gi) || [])]) {
    if (!hay.includes(fold(h))) out.push(`credits "${h}" — that account is not in the source`);
  }
  for (const d of [...new Set(body.match(/\b[a-z0-9][a-z0-9-]{1,}\.(?:com|net|org|io|co|ai|tv)\b/gi) || [])]) {
    if (!hay.includes(fold(d))) out.push(`links "${d}" — that address is not in the source`);
  }

  // GUARANTEES — a promise nobody made.
  for (const re of GUARANTEE) {
    const hit = body.match(re);
    if (hit && !re.test(source)) {
      out.push(`promises "${hit[0]}" — no such guarantee is in the source`);
    }
  }

  return out;
}

// ─── Choosing what actually lands on the card ────────────────────────────────

export interface ScreenedPiece {
  caption: string;
  /**
   * `written` = the model's copy · `trimmed` = its copy cut to the surface's
   * limit on a sentence boundary · `framed` = the deterministic fallback.
   */
  method: "written" | "trimmed" | "framed";
  /** Why the written copy was refused or cut. Empty when it was accepted whole. */
  violations: string[];
}

/**
 * Cut to a limit on a SENTENCE boundary, or return null.
 *
 * Over-length is a formatting problem, not a truth problem, so it is the one
 * violation worth repairing rather than refusing: dropping whole trailing
 * sentences removes words, and removing words cannot invent a claim. It is
 * deliberately not the word-boundary `clip` used on the framed line — that ends
 * a post mid-thought with an ellipsis, which reads as a broken post rather than
 * a short one. Null when even the first sentence overruns; that copy ignored
 * the brief and the caller should keep the framed line instead.
 */
/**
 * Remove the punctuation artefacts a writer leaves behind. NEVER adds a word.
 *
 * Live on the first real run of the fixed planner (2026-08-12), all three
 * captions came back as:
 *
 *     "Your customer wants to see it first? Show them 6 colors in 60 seconds…
 *
 * — an opening double quote with no closing one. The model was quoting the
 * post to itself, and the orphan mark shipped to the card. The fabrication
 * guard could not see it: `pieceCopyViolations` looks for a quoted SPAN, which
 * needs both marks, so an unterminated quote is invisible to it.
 *
 * Every operation here DELETES characters. Deleting cannot invent a claim,
 * which is why this is allowed to run before the guard rather than being a
 * violation that throws the copy away — an orphan quote is a typo, not a lie.
 */
export function tidyCopy(text: unknown): string {
  let t = String(text || "").trim();
  if (!t) return "";

  // The whole piece wrapped in quotes — unwrap, both marks go.
  const wrapped = t.match(/^["“]([\s\S]+)["”]$/);
  if (wrapped && !/["“”]/.test(wrapped[1])) t = wrapped[1].trim();

  // An ODD number of double-quote marks means one of them has no partner.
  // Drop it at whichever end it is orphaned, and only there.
  const marks = (t.match(/["“”]/g) || []).length;
  if (marks % 2 === 1) {
    if (/^["“]/.test(t)) t = t.slice(1).trim();
    else if (/["”]$/.test(t)) t = t.slice(0, -1).trim();
  }

  // Three or more blank lines is a formatting slip, never a choice.
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

export function fitToLimit(text: string, max: number): string | null {
  const t = String(text || "").trim();
  if (!t || t.length <= max) return t || null;
  let out = "";
  for (const s of sentences(t)) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > max) break;
    out = next;
  }
  return out.length >= Math.min(40, max) ? out : null;
}

/**
 * Take the model's copy when it is clean, keep today's framing when it is not.
 *
 * FALLING BACK IS NOT FAILING. The framed line is a poor post and everyone here
 * knows it — that is the whole reason this module exists — but it is TRUE, and
 * shipping a fluent invented one instead would be strictly worse. The reason is
 * returned so it lands in `generation_meta` and a human can read what happened
 * rather than wondering why one card looks different.
 */
export function screenPieceCopy(input: {
  written: unknown;
  framed: string;
  source: string;
  brief: SurfaceBrief | null;
  /** The brand's declared label, so a mis-heard brand name is caught. */
  brandLabel?: string;
}): ScreenedPiece {
  // Tidied BEFORE judging: an orphan quote mark is a typo, and refusing the
  // whole piece over one deleted character would throw away good copy.
  const written = tidyCopy(input.written);
  if (!written) return { caption: input.framed, method: "framed", violations: ["nothing written for this surface"] };
  const max = input.brief?.maxChars;

  const violations = pieceCopyViolations(written, input.source, {
    minChars: input.brief?.minChars,
    maxChars: max,
    brandLabel: input.brandLabel,
  });
  if (!violations.length) return { caption: written, method: "written", violations: [] };

  // LENGTH ALONE is repairable — see `fitToLimit`. Any other violation is a
  // truth problem and the framed line wins, however plainly it reads.
  const onlyTooLong = max
    && violations.length === 1
    && violations[0].includes(`over this surface's ${max}`);
  if (onlyTooLong) {
    const fitted = fitToLimit(written, max);
    // The trim can leave it under the surface's floor, or drop the sentence
    // carrying the point. Re-judge rather than assume the cut is still a piece.
    if (fitted && !pieceCopyViolations(fitted, input.source, { minChars: input.brief?.minChars, maxChars: max, brandLabel: input.brandLabel }).length) {
      return { caption: fitted, method: "trimmed", violations };
    }
  }

  return { caption: input.framed, method: "framed", violations };
}

/**
 * Surfaces whose copy opens the same way as another's.
 *
 * The duplication this whole path exists to end is measured on OPENINGS, not
 * whole strings: two posts that share their first sentence and diverge after it
 * still read as one bot posting twice. Compared on the first sentence, folded,
 * so punctuation and case cannot hide it.
 */
export function duplicateOpenings(byKey: Record<string, string>): string[] {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const [key, text] of Object.entries(byKey)) {
    const first = fold(sentences(String(text || ""))[0] || "").slice(0, 60);
    if (!first) continue;
    const prior = seen.get(first);
    if (prior) dupes.push(`${key} opens exactly like ${prior}`);
    else seen.set(first, key);
  }
  return dupes;
}
