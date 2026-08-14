/**
 * contentDoctrine — WHAT WE ARE ALLOWED TO PUBLISH, as code.
 *
 * Owner, 2026-08-06: "Add every piece is INTEREST based Marketing, Gary Vee
 * style. Lead with entertain, education, inspire. Hooks must be relevant to
 * channel and brand type in ecosystem. Must be committed to best value for our
 * audience. Post organic; if it gets views then move to ad content schedule."
 *
 * And, first: "I need it to wire as operating system so this actually stays in
 * place."
 *
 * That last sentence is the whole design. A doctrine written in a prompt is a
 * suggestion — the model drifts, someone edits the prompt, and six weeks later
 * the feed is full of "CALL NOW FOR A FREE QUOTE" again with nobody able to say
 * when it changed. So the doctrine is DATA here, one module, imported by the
 * generator that writes copy AND by the gate that lets a piece through. Both
 * ends read the same rules, so they cannot disagree, and `tests/
 * content-doctrine.test.ts` fails the build if the rules are weakened.
 *
 * ── THE RULE, IN ONE LINE ──────────────────────────────────────────────────
 * We earn attention before we ask for anything. Every piece leads with
 * ENTERTAIN, EDUCATE or INSPIRE. The ask is the exception, not the format.
 *
 * This is interest-based marketing: the content is about what the AUDIENCE is
 * interested in, not about what we happen to sell this week. A wrap installer
 * does not follow a printer for printer news; they follow for the craft, the
 * reveals, the mistakes that cost somebody a re-print. Give that away, and the
 * business follows. That is the whole model, and it only works if it is real —
 * which is why `bestValueCheck` is a hard gate and not a style note.
 *
 * ── THE LADDER ─────────────────────────────────────────────────────────────
 * ORGANIC FIRST, ALWAYS. Nothing is born as an ad. A piece runs organically,
 * the audience votes with its attention, and only a piece that ALREADY EARNED
 * views is promoted to paid. Paying to distribute something nobody chose to
 * watch is how ad budgets disappear — the organic number is the proof the
 * creative works, bought for free.
 *
 * `promotionVerdict` decides that, and it refuses to guess: no metrics means
 * NOT A WINNER, never "probably fine". Measured 2026-08-06 —
 * `social_post_metrics` has ZERO rows, because nothing has ever published — so
 * every verdict is honestly "not enough data yet" until publishing works.
 *
 * Pure by design: no database, no network, no clock.
 */

// ─── The three pillars ───────────────────────────────────────────────────────

/**
 * What a piece is FOR. Exactly three, and "sell" is deliberately not one.
 *
 * A piece that cannot name its pillar has no reason to exist on the feed.
 */
export const PILLARS = ["entertain", "educate", "inspire"] as const;
export type Pillar = (typeof PILLARS)[number];

export const PILLAR_BRIEF: Record<Pillar, string> = {
  entertain:
    "Make them stop and enjoy it. Reveals, satisfying process, near-disasters, personality, humour. No lesson required — being worth watching IS the value.",
  educate:
    "Teach one thing they can use today. A material choice, a measurement, a mistake that costs money. Specific beats comprehensive: one real thing, properly.",
  inspire:
    "Show what is possible and who did it. Craft at a level they want to reach, a shop that made it, a transformation worth aiming at.",
};

// ─── Channels, including the ones we cannot post to yet ──────────────────────

export type ChannelKey =
  | "instagram" | "facebook" | "youtube" | "youtube_short" | "tiktok"
  | "linkedin" | "x" | "pinterest" | "threads"
  | "email" | "blog" | "substack"
  | "wrapfeed" | "wraptv_site";

export interface ChannelRule {
  label: string;
  /**
   * TRUE only when `content-deploy` has a real publisher for it. Verified
   * against the dispatch on 2026-08-06 — five platforms, no more. A channel
   * marked false still gets planned and drafted; it just cannot auto-post, and
   * saying so here stops the plan from quietly implying it can.
   */
  canAutoPublish: boolean;
  /** How long the hook has to work. Drives the copy brief, not decoration. */
  hookWindow: string;
  /** What a hook must DO on this surface. */
  hookRule: string;
  /**
   * THE RHETORICAL MOVE the hook makes here. Prose in `hookRule` briefs a
   * MODEL; this briefs CODE — the editor uses it to pick which beat leads,
   * because the moves want structurally different footage. A `question` needs a
   * beat that leaves something open; a `reveal` needs the before and the after;
   * a `lesson` needs the mistake before the fix. Choosing the lead beat is a
   * code decision, and it cannot read a paragraph.
   *
   * Owner, 2026-08-06, naming these directly: "X is thought provoking, ask a
   * question, start conversation" · "tiktok more outrageous" · "then linkedin
   * hook". They are genuinely different jobs on the same footage, which is the
   * whole "one video, a different angle per platform" requirement.
   */
  hookMove: "reveal" | "question" | "lesson" | "answer" | "story" | "claim" | "promise";
  /**
   * HOW FAR THE HOOK MAY PUSH, 0-1. Distinct from `hookRule`'s production
   * register, and the distinction is real: TikTok's rule already says
   * "unpolished", which is about how it LOOKS, and says nothing about how bold
   * the CLAIM is allowed to be. A hook can be shot on a phone and still be
   * timid, and a timid TikTok hook dies exactly as fast as a produced one.
   *
   * Low means measured and credible — a claim a trade buyer would repeat in
   * front of a customer. High means bold enough to stop a thumb.
   *
   * This is a ceiling on NERVE, never a licence to exaggerate. Everything the
   * hook asserts still has to be a fact the asset actually supports, and
   * `assetMatch` / `groundingViolations` in `hookEngine.ts` enforce that
   * independently of this number. Turning this up must never turn the
   * fabrication guard down.
   */
  hookEdge: number;
  /** The formats this channel actually rewards. */
  formats: string[];
  /** Pillars that work here. A channel is not obliged to carry all three. */
  pillars: Pillar[];
}

export const CHANNELS: Record<ChannelKey, ChannelRule> = {
  instagram: {
    label: "Instagram", canAutoPublish: true, hookWindow: "first 1 second",
    hookRule: "Open ON the payoff or the problem — never on a logo, a greeting, or a slow pan. The first frame is the hook.",
    hookMove: "reveal", hookEdge: 0.75,
    formats: ["reel", "carousel", "story", "feed"], pillars: ["entertain", "educate", "inspire"],
  },
  facebook: {
    label: "Facebook", canAutoPublish: true, hookWindow: "first line of text",
    hookRule: "Lead with the human story, not the product. Longer copy is allowed here — earn the scroll with a real account of what happened.",
    hookMove: "story", hookEdge: 0.5,
    formats: ["feed", "reel"], pillars: ["entertain", "inspire", "educate"],
  },
  youtube: {
    label: "YouTube (longform)", canAutoPublish: true, hookWindow: "first 15 seconds",
    hookRule: "State the promise of the whole video in one sentence, then start delivering it immediately. No intro sequence, no channel trailer.",
    hookMove: "promise", hookEdge: 0.6,
    formats: ["longform"], pillars: ["educate", "inspire", "entertain"],
  },
  youtube_short: {
    label: "YouTube Short", canAutoPublish: true, hookWindow: "first 1 second",
    hookRule: "Same vertical as the Reel, but written for SEARCH intent — the first words should match what someone would type.",
    hookMove: "answer", hookEdge: 0.7,
    formats: ["short"], pillars: ["educate", "entertain"],
  },
  tiktok: {
    label: "TikTok", canAutoPublish: false, hookWindow: "first 1 second",
    // Owner, 2026-08-06: "so tiktok more outrageous". Two separate dials, and
    // this rule only ever moved one of them: "unpolished" is how it LOOKS.
    // Nerve is the other, and it is `hookEdge: 0.95` — the highest on any
    // surface. Bold about something TRUE; the grounding guard in
    // `hookEngine.ts` does not relax because the channel is loud.
    hookRule: "Native, unpolished, spoken to camera or straight into the process — and BOLD. Say the thing most shops would not say out loud, open on the most extreme real moment in the footage. A repurposed ad reads as an ad here and dies; so does a hedged one. If it looks produced or sounds careful, rewrite the open.",
    hookMove: "reveal", hookEdge: 0.95,
    formats: ["short"], pillars: ["entertain", "educate"],
  },
  linkedin: {
    label: "LinkedIn", canAutoPublish: false, hookWindow: "first 2 lines",
    hookRule: "A business lesson learned the hard way, told plainly. First two lines must earn the 'see more' click without a cliffhanger gimmick.",
    hookMove: "lesson", hookEdge: 0.35,
    formats: ["feed", "article"], pillars: ["educate", "inspire"],
  },
  x: {
    label: "X", canAutoPublish: false, hookWindow: "first line",
    // Owner, 2026-08-06: "X is thought provoking, ask a question, start
    // conversation." That is a different move from the flat declarative this
    // rule used to ask for — a finished claim is a broadcast and it ends the
    // thread, which is the opposite of what the surface rewards. The claim
    // still has to be real; it just has to leave the door open.
    hookRule: "Thought-provoking, and OPEN. Ask the real question, or state the thing people disagree about, in a way that invites an answer — the goal is a conversation, not a broadcast. No thread-bait numbering unless the thread genuinely delivers.",
    hookMove: "question", hookEdge: 0.8,
    formats: ["post", "thread"], pillars: ["educate", "entertain"],
  },
  pinterest: {
    label: "Pinterest", canAutoPublish: false, hookWindow: "the image itself",
    hookRule: "Search-and-save intent: the pin has to look like the FINISHED result someone is planning toward. Text overlay names the thing.",
    hookMove: "answer", hookEdge: 0.4,
    formats: ["pin"], pillars: ["inspire", "educate"],
  },
  threads: {
    label: "Threads", canAutoPublish: false, hookWindow: "first line",
    hookRule: "Conversational and unfinished — an opinion or a question that invites a reply, not a broadcast.",
    hookMove: "question", hookEdge: 0.7,
    formats: ["post"], pillars: ["entertain", "educate"],
  },
  email: {
    label: "Email", canAutoPublish: false, hookWindow: "subject line",
    hookRule: "The subject promises ONE specific useful thing and the email delivers it above the fold. Never a newsletter round-up of our own news.",
    hookMove: "promise", hookEdge: 0.45,
    formats: ["newsletter", "broadcast"], pillars: ["educate", "inspire"],
  },
  blog: {
    label: "Blog", canAutoPublish: false, hookWindow: "headline + first paragraph",
    hookRule: "Answer the question someone actually typed. The first paragraph gives the answer; the rest earns the depth.",
    hookMove: "answer", hookEdge: 0.3,
    formats: ["article"], pillars: ["educate"],
  },
  substack: {
    label: "Substack", canAutoPublish: false, hookWindow: "subject + opening line",
    hookRule: "A point of view, argued. This is the long-form voice of the ecosystem — it should be worth reading even by someone who will never buy.",
    hookMove: "claim", hookEdge: 0.55,
    formats: ["newsletter"], pillars: ["educate", "inspire"],
  },
  wrapfeed: {
    label: "The Feed (owned)", canAutoPublish: true, hookWindow: "first line",
    hookRule: "Our own platform — the same week's story, told without a rented algorithm to please. Depth is allowed.",
    hookMove: "story", hookEdge: 0.5,
    formats: ["feed"], pillars: ["entertain", "educate", "inspire"],
  },
  wraptv_site: {
    label: "WrapTVWorld site", canAutoPublish: true, hookWindow: "title + poster",
    hookRule: "Episode framing: the title names the story, the poster frame shows the moment worth watching.",
    hookMove: "reveal", hookEdge: 0.65,
    formats: ["episode"], pillars: ["entertain", "inspire"],
  },
};

export const CHANNEL_KEYS = Object.keys(CHANNELS) as ChannelKey[];

/** Channels a piece can actually be auto-posted to today. */
export function publishableChannels(): ChannelKey[] {
  return CHANNEL_KEYS.filter((k) => CHANNELS[k].canAutoPublish);
}

// ─── Brands, and what their audience is actually interested in ───────────────

export interface BrandInterest {
  label: string;
  /** WHO is on the other side. Interest-based starts with this, not with us. */
  audience: string;
  /** What that audience is genuinely interested in — the content's subject. */
  interests: string[];
  /** The value we owe them, given away free. */
  givesAway: string;
  /** Register — the voice this brand speaks in. */
  voice: string;
}

export const BRANDS: Record<string, BrandInterest> = {
  weprintwraps: {
    label: "WePrintWraps",
    audience: "Wrap shops and installers who buy printed vinyl — trade buyers, not consumers.",
    interests: ["print quality and why it fails", "material behaviour", "colour accuracy", "turnaround and margin", "install-ready files"],
    givesAway: "The print knowledge that stops a re-print — file setup, bleed, laminate choice, what actually causes failures.",
    voice: "Trade to trade. Plain, specific, no consumer fluff. Assume they know the job.",
  },
  restylepro: {
    label: "RestyleProAI",
    audience: "Shop owners and restylers running the business — quoting, selling, closing.",
    interests: ["closing more jobs", "visualisation that sells", "pricing confidence", "shop workflow", "customer objections"],
    givesAway: "How to sell the job — the quote conversation, the visual that closes, the pricing logic.",
    voice: "Peer who runs a shop too. Practical, commercially honest, never hypey.",
  },
  designproai: {
    label: "DesignProAI",
    audience: "Designers and shops who need production-ready wrap artwork without a Photoshop day.",
    interests: ["design to print file", "panel/bleed correctness", "turnaround", "design craft", "what makes a wrap read at 60mph"],
    givesAway: "Design craft for wide-format — layout, legibility, how a design survives becoming panels.",
    voice: "Designer to designer. Craft-first, opinionated about quality.",
  },
  wraptvworld: {
    label: "WrapTVWorld",
    audience: "The whole trade + enthusiasts — people who watch wraps for the love of it.",
    interests: ["reveals", "shop culture", "the people behind the work", "builds and transformations", "behind the install"],
    givesAway: "The show itself — access, story, and craft as entertainment.",
    voice: "Documentary. Let the work and the people talk; narrate as little as possible.",
  },
  inkandedge: {
    label: "Ink & Edge Magazine",
    audience: "Industry readers who want the story behind the trade.",
    interests: ["profiles", "industry shifts", "opinion", "craft deep-dives"],
    givesAway: "Editorial depth — the argument and the reporting, free.",
    voice: "Editorial. Considered, has a point of view, earns the read.",
  },
  creatormarket: {
    label: "CreatorMarket",
    audience: "Designers selling work and shops buying it.",
    interests: ["earning from design", "what sells", "portfolio craft", "licensing"],
    givesAway: "How to make money from wrap design without an agency.",
    voice: "Direct and encouraging to creators; commercially concrete.",
  },
};

export const BRAND_KEYS = Object.keys(BRANDS);

// ─── The brief a generator must be given ─────────────────────────────────────

/**
 * The doctrine, rendered for ONE channel and ONE brand.
 *
 * This is what gets injected into the copy generator. It is built from the same
 * constants the gate validates against, so a piece cannot be written to one
 * standard and judged by another — the single most common way a "content
 * standard" quietly stops meaning anything.
 */
export function hookBriefFor(channel: ChannelKey, brand: string, pillar?: Pillar): string {
  const c = CHANNELS[channel];
  const b = BRANDS[brand];
  if (!c) return "";
  const pillars = pillar ? [pillar] : c.pillars;

  const lines = [
    "INTEREST-BASED MARKETING — this is not an ad, and must not read as one.",
    `Lead with ${pillars.join(" / ")}. ${pillars.map((p) => PILLAR_BRIEF[p]).join(" ")}`,
    "",
    `CHANNEL — ${c.label}. The hook has to land in the ${c.hookWindow}.`,
    c.hookRule,
    `Formats that work here: ${c.formats.join(", ")}.`,
  ];

  if (b) {
    lines.push(
      "",
      `BRAND — ${b.label}. Audience: ${b.audience}`,
      `They are interested in: ${b.interests.join("; ")}.`,
      `What we give away free: ${b.givesAway}`,
      `Voice: ${b.voice}`,
    );
  }

  lines.push(
    "",
    "VALUE TEST — the piece must be worth someone's time even if they never buy anything.",
    "If the only reason it exists is to make us money, rewrite it. No 'call now', no 'DM us',",
    "no 'limited time', no invented urgency. One soft, earned CTA at most, and only after the value lands.",
  );
  return lines.join("\n");
}

// ─── The gate ────────────────────────────────────────────────────────────────

/**
 * Ad-speak. Not a taste judgement — these are the phrases that turn a piece of
 * content into a commercial, which is the exact thing this doctrine exists to
 * keep off the organic feed.
 */
export const AD_PHRASES = [
  /\bcall now\b/i,
  /\bdm us\b/i, /\bdm me\b/i,
  /\blimited time\b/i, /\bact fast\b/i, /\bhurry\b/i,
  /\bdon'?t miss out\b/i,
  /\bbuy now\b/i, /\border now\b/i, /\bshop now\b/i,
  /\bfree quote\b/i, /\bget a quote today\b/i,
  /\bspecial offer\b/i, /\bdiscount code\b/i,
  /\bclick the link in bio to buy\b/i,
  /\bwhile supplies last\b/i,
];

export interface Piece {
  channel?: ChannelKey | string | null;
  brand?: string | null;
  pillar?: Pillar | string | null;
  hook?: string | null;
  caption?: string | null;
  /** True when this piece IS a paid ad — the doctrine relaxes, deliberately. */
  isPaidAd?: boolean;
}

export interface Violation {
  /** `hard` blocks the piece. `soft` is recorded and shown, never blocking. */
  severity: "hard" | "soft";
  code: string;
  message: string;
}

/**
 * Judge one piece against the doctrine.
 *
 * HARD violations block: ad-speak on an organic piece, and a missing pillar.
 * Everything else is soft — recorded and surfaced, never blocking — because a
 * gate that blocks on taste stops being used, and an unused gate protects
 * nothing. The two hard rules are the two the owner stated as absolutes.
 */
export function validatePiece(piece: Piece | null | undefined): Violation[] {
  const out: Violation[] = [];
  if (!piece) return out;

  const text = `${piece.hook || ""}\n${piece.caption || ""}`.trim();
  const channel = String(piece.channel || "") as ChannelKey;
  const rule = CHANNELS[channel];

  // 1. ORGANIC IS NOT AN AD. A real paid ad is exempt — that is what the ad
  //    schedule is FOR, and pretending otherwise would make the flag useless.
  if (!piece.isPaidAd) {
    for (const re of AD_PHRASES) {
      const hit = text.match(re);
      if (hit) {
        out.push({
          severity: "hard",
          code: "ad_speak",
          message: `"${hit[0]}" is ad copy. Organic pieces lead with entertain / educate / inspire — earn the attention first. Rewrite, or run it as a paid ad instead.`,
        });
        break;
      }
    }
  }

  // 2. EVERY PIECE NAMES ITS JOB. A piece that cannot say whether it entertains,
  //    educates or inspires has no reason to be on the feed.
  // SOFT, not hard. It was hard for about an hour, and it would have blocked
  // 100% of real traffic on deploy day — not one of the 299 existing posts
  // carries a pillar, so every approve would have 422'd and the Director would
  // have been unusable. A gate that fires on everything is an outage, not a
  // standard. Ad-speak stays hard because it is rare, specific and always
  // wrong; the pillar is surfaced and set from the Brand Board.
  if (!piece.pillar || !PILLARS.includes(piece.pillar as Pillar)) {
    out.push({
      severity: "soft",
      code: "no_pillar",
      message: `No pillar declared (${PILLARS.join(" / ")}). Set one so the next piece on this angle knows what job it is doing.`,
    });
  } else if (rule && !rule.pillars.includes(piece.pillar as Pillar)) {
    out.push({
      severity: "soft",
      code: "pillar_channel_mismatch",
      message: `${piece.pillar} is an unusual fit for ${rule.label} — that channel rewards ${rule.pillars.join(" / ")}.`,
    });
  }

  // 3. THE HOOK IS THE WORK. A piece with no hook is a caption hoping for luck.
  if (!String(piece.hook || "").trim()) {
    out.push({
      severity: "soft",
      code: "no_hook",
      message: rule
        ? `No hook written. On ${rule.label} it has to land in the ${rule.hookWindow}: ${rule.hookRule}`
        : "No hook written.",
    });
  }

  // 4. THE BRAND HAS AN AUDIENCE. Publishing to a brand we have no interest
  //    profile for means the copy cannot be aimed at anyone.
  if (piece.brand && !BRANDS[String(piece.brand)]) {
    out.push({
      severity: "soft",
      code: "unknown_brand",
      message: `No audience profile for "${piece.brand}" — the copy cannot be aimed. Add it to BRANDS in contentDoctrine.ts.`,
    });
  }

  return out;
}

/** Does this piece pass the gate? Soft violations do not block. */
export function passesDoctrine(piece: Piece | null | undefined): boolean {
  return !validatePiece(piece).some((v) => v.severity === "hard");
}

/** The blocking reasons, for a message a human can act on. */
export function blockingReasons(piece: Piece | null | undefined): string[] {
  return validatePiece(piece).filter((v) => v.severity === "hard").map((v) => v.message);
}

// ─── Organic → paid ──────────────────────────────────────────────────────────

export interface PieceMetrics {
  videoViews?: number | null;
  reach?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
}

export interface PromotionVerdict {
  promote: boolean;
  /** Plain-language why, always set — including why NOT. */
  reason: string;
  /** How far above the brand's own baseline this piece ran, when known. */
  multiple?: number;
}

/**
 * The minimum audience a piece must have reached before paying to show it to
 * more people. Below this the number is noise, not a signal.
 */
export const MIN_VIEWS_FOR_SIGNAL = 500;

/** How far above the brand's own recent median a piece must run to be a winner. */
export const WINNER_MULTIPLE = 2;

/**
 * Should this organic piece be promoted to the paid schedule?
 *
 * Compared against the brand's OWN baseline, never a fixed number: 3,000 views
 * is a triumph for one brand and a flop for another, and a global threshold
 * would promote whichever brand happens to have the biggest following while
 * ignoring a genuine outlier on a smaller one.
 *
 * Refuses to guess. No metrics means NOT a winner — never "probably fine".
 */
export function promotionVerdict(
  metrics: PieceMetrics | null | undefined,
  baselineViews: number | null | undefined,
): PromotionVerdict {
  const views = Number(metrics?.videoViews ?? metrics?.reach ?? 0) || 0;

  if (!metrics || views <= 0) {
    return { promote: false, reason: "No view data yet — a piece is never promoted on a guess." };
  }
  if (views < MIN_VIEWS_FOR_SIGNAL) {
    return {
      promote: false,
      reason: `${views.toLocaleString()} views is below the ${MIN_VIEWS_FOR_SIGNAL} needed to read as a signal rather than noise.`,
    };
  }
  const base = Number(baselineViews) || 0;
  if (base <= 0) {
    return {
      promote: false,
      reason: `${views.toLocaleString()} views, but this brand has no baseline yet — there is nothing to call it good against.`,
    };
  }
  const multiple = views / base;
  if (multiple < WINNER_MULTIPLE) {
    return {
      promote: false,
      multiple,
      reason: `${views.toLocaleString()} views is ${multiple.toFixed(1)}× the brand's median — a winner needs ${WINNER_MULTIPLE}×.`,
    };
  }
  return {
    promote: true,
    multiple,
    reason: `${views.toLocaleString()} views, ${multiple.toFixed(1)}× the brand's median. The audience already chose it — paid distribution amplifies a proven piece rather than buying attention for an unproven one.`,
  };
}

/** The brand's own baseline: the median of its recent organic view counts. */
export function medianViews(values: Array<number | null | undefined>): number {
  const nums = (values || []).map((v) => Number(v) || 0).filter((v) => v > 0).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}
