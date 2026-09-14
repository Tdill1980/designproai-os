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
    // The owner's line, verbatim (2026-09-14): "Custom Wrap Design , Output
    // Files , and Print on Demand". It names the three things sold, in the
    // order they happen, which the previous line ("delivered FAST") did not.
    tagline: 'Custom Wrap Design, Output Files, and Print on Demand',
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
        before: '/wallpro/proof-gym-before.jpg',
        after: '/wallpro/proof-gym-after.jpg',
        alt: 'A gym training floor photographed with a bare grey wall, and again with a full-wall printed wrap installed',
        headline: 'Same wall. Same camera.',
        caption: 'A gym training floor, bare to finished. Drag to compare.',
      },
      {
        before: '/wallpro/proof-lobby-before.jpg',
        after: '/wallpro/proof-lobby-after.jpg',
        alt: 'A hotel lobby photographed with a blank white feature wall, and again with a full-wall pastoral landscape mural installed',
        headline: 'One blank wall, one mural.',
        caption: 'A lobby feature wall, printed floor to ceiling. Drag to compare.',
      },
    ],
  },
};

export const wallBrand = (key: WallBrandKey = 'designpro'): WallBrand => WALL_BRANDS[key];
