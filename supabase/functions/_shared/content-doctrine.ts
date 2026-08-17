/**
 * content-doctrine (edge) — the publish-side half of the doctrine gate.
 *
 * `src/lib/contentDoctrine.ts` is the full rulebook and the browser imports it.
 * Edge functions are Deno and cannot import from `src/`, so the two rules that
 * must hold at the APPROVAL BOUNDARY are restated here: no ad-speak on an
 * organic piece, and every piece names its pillar.
 *
 * The duplication is deliberate and pinned — `tests/content-doctrine.test.ts`
 * fails the build if this list and the browser's ever disagree. A gate that
 * only ran in the UI would be bypassed by every server-side and cron approval,
 * which is exactly how a "standard" stops meaning anything.
 *
 * Why the gate lives at APPROVE and not at generate: generation is allowed to
 * be wrong — that is what drafts are for. Approving is the moment a piece
 * becomes something the world will see, so it is the moment the rule has to
 * bite. Enforced in marketing-agent's `director_approve`.
 */

export const PILLARS = ["entertain", "educate", "inspire"] as const;
export type Pillar = (typeof PILLARS)[number];

/**
 * Ad-speak. Must stay byte-identical to AD_PHRASES in
 * src/lib/contentDoctrine.ts — the parity test compares the two sources.
 */
export const AD_PHRASES: RegExp[] = [
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

export interface DoctrineVerdict {
  ok: boolean;
  /** Blocking reasons, in language the operator can act on. */
  reasons: string[];
  /** Recorded and shown, never blocking. */
  warnings: string[];
  /** The ad phrase that tripped it, when that was the cause. */
  matched?: string;
}

/**
 * Judge a piece at the approval boundary.
 *
 * `isPaidAd` exempts a genuine paid ad — that is what the ad schedule is for,
 * and refusing ad copy inside an ad would make the flag meaningless.
 */
export function judgeAtApproval(input: {
  caption?: string | null;
  hook?: string | null;
  pillar?: string | null;
  isPaidAd?: boolean;
}): DoctrineVerdict {
  const reasons: string[] = [];
  let matched: string | undefined;

  const text = `${input.hook || ""}\n${input.caption || ""}`.trim();

  if (!input.isPaidAd) {
    for (const re of AD_PHRASES) {
      const hit = text.match(re);
      if (hit) {
        matched = hit[0];
        reasons.push(
          `"${hit[0]}" is ad copy. Organic pieces lead with entertain / educate / inspire — earn the attention first. ` +
          `Rewrite it, or run it on the paid schedule instead.`,
        );
        break;
      }
    }
  }

  // A MISSING PILLAR WARNS. IT DOES NOT BLOCK.
  //
  // This was a hard block for about an hour, and it would have taken the whole
  // queue down on deploy day: not one of the 299 existing posts carries a
  // pillar, so every approve would have returned 422 and the Director would
  // have been unusable. A gate that fires on 100% of real traffic is not a
  // standard, it is an outage — and it would have been "read the doctrine" as
  // the reason nothing worked.
  //
  // Ad-speak stays hard because it is rare, specific, and always wrong. The
  // pillar is surfaced instead, and set from the Brand Board.
  const warnings: string[] = [];
  if (!input.pillar || !(PILLARS as readonly string[]).includes(String(input.pillar))) {
    warnings.push(
      `No pillar declared (${PILLARS.join(" / ")}). Set one on the Brand Board so the next piece ` +
      `on this angle knows what job it is doing.`,
    );
  }

  return { ok: reasons.length === 0, reasons, warnings, matched };
}

/** Read the declared pillar off a post's generation_meta, if it has one. */
export function pillarFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const p = (meta as Record<string, unknown>).pillar;
  return typeof p === "string" && p ? p : null;
}

// ─── WHO EACH BRAND IS TALKING TO ────────────────────────────────────────────

/**
 * The brand's DECLARED facts — a byte-for-byte mirror of `BRANDS` in
 * `src/lib/contentDoctrine.ts`, restated here for the same reason the rest of
 * this file is: Deno cannot import `src/lib/*`, and a rule that only exists in
 * the browser does not run on the server where the copy is actually written.
 * Pinned by `tests/ad-hook.test.ts`, which fails the build if the two drift.
 *
 * WHY AN EDGE COPY EXISTS AT ALL, measured: seven ad packs were generated on
 * 2026-08-07 with only the DB brand block for context. The WePrintWraps pack
 * came back concrete ("PRINTED. LAMINATED. LABELED.") and the other three
 * brands came back as "Unveil the Wrap Magic" / "Behind the Wrap Magic" /
 * "Watch the Wrap Magic" — the same non-sentence three times, because nothing
 * in the prompt said WHO was being talked to. `audience`, `interests`,
 * `givesAway` and `voice` are the answer to that, and they were sitting in a
 * module the ad path could not reach.
 *
 * A brand that is NOT in here gets no aim, and the honest consequence is
 * thinner copy — never a guessed audience. `brandFactsFor` returns null and the
 * caller says so out loud.
 */
/**
 * THE PILLARS, AIMED AT A SHOP OWNER.
 *
 * Owner, 2026-08-13: "Pillars should have hooks from our core customer base
 * shop owners."
 *
 * A PARITY TWIN of `src/lib/contentDoctrine.ts` — pinned by tests.
 *
 * `PILLAR_BRIEF` says what a pillar is FOR in the abstract — "make them stop
 * and enjoy it", "teach one thing they can use today". That is a definition,
 * and a definition is not a hook. Handed nothing more concrete, a writer aims
 * at "the wrap industry", which is nobody, and the copy comes back as
 * "transform your wrap game".
 *
 * These are the angles that land on the person who signs the cheque: someone
 * running a bay, quoting work, carrying the re-print when it goes wrong. Each
 * is a SHAPE to write into, not a line to copy — the specifics still have to
 * come from the brand's declared facts or from something a real customer said
 * on camera.
 */
export const PILLAR_HOOKS: Record<Pillar, string[]> = {
  entertain: [
    "The job that nearly went wrong, and what saved it.",
    "The reveal — the moment the customer sees it and reacts.",
    "Shop life the trade recognises: the bay at 7am, the reprint nobody wants to mention, the dog.",
    "The thing every shop owner has done once and will not admit to.",
  ],
  educate: [
    "The quote conversation — what to charge and how to defend it.",
    "The file mistake that costs a re-print, and the two-minute check that catches it.",
    "Material behaviour a spec sheet does not tell you.",
    "What the customer is really comparing you against when they hesitate.",
    "Where the margin actually goes on a job that looked profitable.",
  ],
  inspire: [
    "A shop that grew, and the specific decision that did it.",
    "Craft at a level worth aiming at — and what it took to get there.",
    "The owner who started with nothing but a bay and a squeegee.",
    "Work good enough that other shops ask who printed it.",
  ],
};

export interface BrandFacts {
  label: string;
  audience: string;
  interests: string[];
  givesAway: string;
  voice: string;
  /**
   * THE CLAIMS THIS BRAND HAS ACTUALLY MADE — declared by the owner, and the
   * only positioning an ad may state as fact.
   *
   * This field exists because the grounding guard works by containment: any
   * figure, guarantee or superlative the corpus does not carry is refused as
   * an invention. Before these were declared, "10+ years", "millions of square
   * feet" and the guarantee were all TRUE and all unusable — the writer either
   * omitted them or had them dropped by `adClaimViolations`.
   *
   * Declaring a claim here is the owner asserting it. The guard's job is to
   * stop the MODEL inventing one, not to audit the business.
   */
  claims: string[];
}

export const BRAND_FACTS: Record<string, BrandFacts> = {
  weprintwraps: {
    label: "WePrintWraps",
    audience: "Wrap shops and installers who buy printed vinyl — trade buyers, not consumers.",
    interests: ["print quality and why it fails", "material behaviour", "colour accuracy", "turnaround and margin", "install-ready files"],
    givesAway: "The print knowledge that stops a re-print — file setup, bleed, laminate choice, what actually causes failures.",
    voice: "Trade to trade. Plain, specific, no consumer fluff. Assume they know the job.",
    claims: [
      "North America's #1 Online Printed Vehicle Wrap Supplier.",
      "Wholesale priced, high-quality printed wrap film.",
      // ONE NAME, settled by the owner 2026-08-13 with the badge artwork:
      // "PREMIUM WRAP GUARANTEE". This line used to declare both names,
      // because the badge and the site copy disagreed and dropping either
      // would have refused true sentences. They no longer disagree — every
      // other file in the repo (brand-os, content-programming,
      // useAutoBuildVideo) already said Premium — so the alternative is
      // removed rather than carried, and the writer has one name to use.
      "Backed by the Premium Wrap Guarantee.",
      "Order online.",
      "10+ years printing wraps.",
      "Millions of square feet printed.",
    ],
  },
  restylepro: {
    label: "RestyleProAI",
    audience: "Shop owners and restylers running the business — quoting, selling, closing.",
    interests: ["closing more jobs", "visualisation that sells", "pricing confidence", "shop workflow", "customer objections"],
    givesAway: "How to sell the job — the quote conversation, the visual that closes, the pricing logic.",
    voice: "Peer who runs a shop too. Practical, commercially honest, never hypey.",
    claims: [],
  },
  designproai: {
    label: "DesignProAI",
    audience: "Designers and shops who need production-ready wrap artwork without a Photoshop day.",
    interests: ["design to print file", "panel/bleed correctness", "turnaround", "design craft", "what makes a wrap read at 60mph"],
    givesAway: "Design craft for wide-format — layout, legibility, how a design survives becoming panels.",
    voice: "Designer to designer. Craft-first, opinionated about quality.",
    claims: [],
  },
  wraptvworld: {
    label: "WrapTVWorld",
    audience: "The whole trade + enthusiasts — people who watch wraps for the love of it.",
    interests: ["reveals", "shop culture", "the people behind the work", "builds and transformations", "behind the install"],
    givesAway: "The show itself — access, story, and craft as entertainment.",
    voice: "Documentary. Let the work and the people talk; narrate as little as possible.",
    claims: [],
  },
  inkandedge: {
    label: "Ink & Edge Magazine",
    audience: "Industry readers who want the story behind the trade.",
    interests: ["profiles", "industry shifts", "opinion", "craft deep-dives"],
    givesAway: "Editorial depth — the argument and the reporting, free.",
    voice: "Editorial. Considered, has a point of view, earns the read.",
    claims: [],
  },
  creatormarket: {
    label: "CreatorMarket",
    audience: "Designers selling work and shops buying it.",
    interests: ["earning from design", "what sells", "portfolio craft", "licensing"],
    givesAway: "How to make money from wrap design without an agency.",
    voice: "Direct and encouraging to creators; commercially concrete.",
    claims: [],
  },
};

/**
 * The declared facts for a brand key, following the alias spellings
 * `_shared/idea-hook.ts` already canonicalises. An unknown brand returns null —
 * the caller must then write thinner copy, not invent an audience.
 */
export function brandFactsFor(brandKey: unknown): BrandFacts | null {
  const k = String(brandKey || "").trim().toLowerCase();
  const canonical = k === "wraptv" || k === "wraptvworld-documentary" ? "wraptvworld" : k;
  return BRAND_FACTS[canonical] || null;
}
