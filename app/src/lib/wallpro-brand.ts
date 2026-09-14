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

export type WallBrandKey = 'designpro' | 'weprintwraps';

export type WallBrand = {
  /** The small line above the wordmark — who is behind the tool. */
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
};

export const WALL_BRANDS: Record<WallBrandKey, WallBrand> = {
  designpro: {
    eyebrow: 'DesignProAI',
    wordmarkLead: 'Wall',
    wordmarkAccent: 'Pro',
    tagline: 'Custom wall wrap file output',
    showPrintOffer: false,
  },
  weprintwraps: {
    eyebrow: 'WePrintWraps',
    wordmarkLead: 'Wall',
    wordmarkAccent: 'Pro',
    // The owner's line, verbatim (2026-09-14): "WallPro Custom on Demand
    // WallWrap Design and Output files delivered FAST".
    tagline: 'Custom on-demand WallWrap design and output files delivered FAST',
    showPrintOffer: true,
  },
};

export const wallBrand = (key: WallBrandKey = 'designpro'): WallBrand => WALL_BRANDS[key];
