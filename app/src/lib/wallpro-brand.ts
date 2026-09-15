// WHOSE TOOL IS THIS, FROM THE CUSTOMER'S SIDE.
//
// Owner, 2026-09-14: the WePrintWraps page "should BE the tool" -- not a
// brochure that talks about it. So /wall-wrap renders the REAL designer, with
// every capability it has always had (photo upload, corner pinning, the five
// entry paths, style reference, match upload, before/after, print files), only
// wearing the partner's name.
//
// ONE COMPONENT, NOT A COPY. The alternative -- a second wall page with the
// partner's branding baked in -- is how two products drift apart: a fix lands
// on one and not the other, and the partner's customers quietly get the older
// tool. The branding is DATA; WallPro.tsx reads it and is otherwise unchanged.
//
// This is also the franchising shape the owner is building toward ("sign
// companies like signorama FASTSIGNS can use on demand send links to thier
// customers to design and buy"). The next partner is one entry in this table
// plus one host entry plus one Caddy block -- and eventually not even that,
// once the per-shop row (shops.slug, shops.logo_url, shops.brand colours) from
// the multi-tenant spine feeds it at runtime. The shape here is deliberately
// the shape of that row, so the swap is a read, not a rewrite.

/**
 * THE WALLPRO GRADIENT — one definition, every action.
 *
 * Owner, 2026-09-14, looking at the built tool: "the gradient needs more blue."
 *
 * It was `sky-500 → violet-500 → fuchsia-500`. The problem was never the two
 * ends — it was the MIDPOINT: a gradient spends most of its visible length near
 * its middle stop, so a violet midpoint makes the whole sweep read purple no
 * matter how blue the first stop is.
 *
 * So blue now holds the first two stops and carries the middle, and the magenta
 * survives only as the tail. That is also closer to the WePrintWraps system this
 * file serves, which is blue → pink (#3b82f6 → #ec4899) with nothing purple
 * between them.
 *
 * Declared here, and ONLY here, because the same string was typed at four call
 * sites — the wordmark, both Generate buttons and Refine. Four copies of a brand
 * colour drift the moment one of them is restyled; the print-width literal on
 * the print card was the same failure two commits ago.
 */
export const WALL_GRADIENT = 'bg-gradient-to-r from-blue-700 via-blue-500 to-fuchsia-600';

/**
 * THE CARD SHELL — one definition, every panel.
 *
 * Owner, 2026-09-15: "make the cards stand out better perhaps."
 *
 * The cards were `border-slate-200 bg-white shadow-sm` on a `bg-slate-50`
 * page. White on near-white is about two percent of luminance between the card
 * and the ground, and `shadow-sm` is a one-pixel hairline, so the panels did
 * not read as objects sitting ON a page — they read as faint boxes drawn on
 * it, and the step structure of the tool went with them.
 *
 * Two changes, and the FIRST is the one doing the work: the page ground drops
 * to slate-100 so there is something for a white card to sit on. Chasing this
 * with shadow alone is the common mistake — a heavier shadow under a card that
 * is the same colour as its background just looks smudged.
 *
 * Then the card gets a real lift: a close contact shadow plus a wide soft one,
 * which is how a physical card casts, and `ring-slate-900/5` to keep the edge
 * crisp at the top where a downward shadow gives none.
 */
export const WALL_CARD =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_10px_28px_-12px_rgba(15,23,42,0.18)] ring-1 ring-slate-900/5';

/** The page ground the cards sit on. Must stay darker than the card. */
export const WALL_PAGE_GROUND = 'bg-slate-100';

export type WallBrandKey = 'designpro' | 'weprintwraps';

export type WallBrand = {
  /**
   * The partner's own logo, shown in the header corner ahead of "× WallPro".
   *
   * When a brand has one it REPLACES the eyebrow: a logo and the same company's
   * name spelled out underneath it is the company saying who it is twice. Null
   * falls back to the eyebrow text.
   */
  logo: string | null;
  /** Alt text for that logo. Never "logo" — a screen reader already says so. */
  logoAlt: string;
  /** The small line above the wordmark — used only when there is no logo. */
  eyebrow: string;
  /** Split so the second half can carry the gradient. */
  wordmarkLead: string;
  wordmarkAccent: string;
  /** What the tool DOES, in the owner's own words. */
  tagline: string;
  /**
   * Whether to show the printing offer and material spec below the tool.
   *
   * On the partner's own page the customer arrived wanting a wall wrap
   * PRINTED, so the film price and the spec belong on the page. On
   * DesignProAI the customer came for the design tool and the print is a
   * partner's business, so it stays off.
   */
  showPrintOffer: boolean;
  /**
   * The before/after examples in the narrow band under the header, cycled.
   *
   * Per brand, because the proof should look like the partner's own work — a
   * WePrintWraps visitor should recognise a room WePrintWraps wrapped. An empty
   * list renders no band at all.
   *
   * ORDER MATTERS: the first entry is what a visitor sees on arrival and is the
   * only one many will see, so put the most persuasive room first.
   *
   * Files live under `app/public/` and ship with the build, so the band paints
   * on first load with no request to Supabase and no signed URL. Use WIDE room
   * photographs: the band is a shallow strip and a tall image is cropped to its
   * middle.
   */
  proofs: WallProof[];
};

/** One before/after pair: the same room photographed bare and wrapped. */
export type WallProof = {
  /** The bare wall. */
  before: string;
  /** The same shot with the wrap installed. MUST be the same camera position —
   *  a different angle reads as two rooms and the comparison collapses. */
  after: string;
  alt: string;
  headline: string;
  caption: string;
};

export const WALL_BRANDS: Record<WallBrandKey, WallBrand> = {
  designpro: {
    logo: null,
    logoAlt: '',
    eyebrow: 'DesignProAI',
    wordmarkLead: 'Wall',
    wordmarkAccent: 'Pro',
    tagline: 'Custom wall wrap file output',
    showPrintOffer: false,
    proofs: [],
  },
  weprintwraps: {
    // The real mark off weprintwraps.com, vendored into public/ so the header
    // paints from our own origin instead of hot-linking the WordPress uploads
    // directory -- which would put a marketing-site URL on the critical path of
    // the tool's own header.
    logo: '/wpw-logo-mark.png',
    logoAlt: 'WePrintWraps',
    eyebrow: 'WePrintWraps',
    wordmarkLead: 'Wall',
    wordmarkAccent: 'Pro',
    // The owner, 2026-09-14, on what the header has to make obvious: "Clear
    // persistent header custom instant wall wrap design and file output buy
    // film". THREE things are for sale on this page and a visitor has to see
    // all three without scrolling -- most of all the last one, because the
    // customer who already has artwork was the one this page did not serve.
    tagline: 'Custom Wall Wrap design, print files & printed wrap',
    showPrintOffer: true,
    // REAL JOBS ONLY. Each entry is a room WePrintWraps actually wrapped,
    // photographed twice from one camera position. Drop the two files at the
    // paths below and that entry joins the rotation; a pair whose files are
    // missing is skipped, and if none load the band does not render at all.
    //
    // To add another: copy one block, give it the next number, and write a
    // caption that describes THAT room. Do not reuse a caption across rooms --
    // the specificity is the whole reason a before/after persuades.
    proofs: [
      {
        before: '/wallpro/proof-spa-before.jpg',
        after: '/wallpro/proof-spa-after.jpg',
        alt: 'A home studio photographed with plain cream walls either side of the window, and again with a dark tropical anthurium mural covering both',
        headline: 'One wall, one afternoon.',
        caption: 'A home studio in a dark tropical print, designed and printed here. Drag to compare.',
      },
      {
        // THE SAME BARE WALL as the entry above, deliberately. One room shown
        // two ways is the argument this tool actually makes -- the wall did not
        // change, the design did -- and it is a stronger second slide than a
        // different room would be, because the visitor has already learned this
        // room from slide one and can read the change instantly.
        //
        // The frame was REGISTERED onto that bare photograph rather than eyed
        // in: scripts/wallpro-proof-normalize.mjs --align-to, best 0.782 at
        // 108% scale. WallPro's renders come back framed a few percent wider
        // than the photograph they were made from, and a few percent is enough
        // for the sofa to slide under the wipe and read as two rooms.
        before: '/wallpro/proof-spa-before.jpg',
        after: '/wallpro/proof-studio-slat-after.jpg',
        alt: 'The same home studio with plain cream walls, and again with a warm vertical timber-slat wrap running wall to wall behind the window',
        headline: 'Same wall. Different room.',
        caption: 'The same studio in a warm timber slat — designed in WallPro, printed here. Drag to compare.',
      },
      // PENDING: the gym floor and the hotel lobby feature wall. Both were
      // described but their files are not in the repository, and an entry
      // pointing at a file that does not exist costs every visitor two failed
      // requests. Add the block back with its photographs, not before.
    ],
  },
};

export const wallBrand = (key: WallBrandKey = 'designpro'): WallBrand => WALL_BRANDS[key];
