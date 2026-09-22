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
 *
 * THEMED, 2026-09-17. The literal slate values moved into `.wall-card` in
 * index.css, where a `[data-wall-theme]` scope decides whether they resolve
 * light or dark. This constant therefore names a surface instead of painting
 * one, and every existing call site keeps working unchanged -- which is the
 * whole reason the card was a single constant in the first place.
 */
export const WALL_CARD = 'wall-card';

/** The page ground the cards sit on. Must stay darker than the card in the
 *  light theme and LIGHTER than it in the dark one, so a panel always reads as
 *  an object on a surface rather than a shape cut out of it. */
export const WALL_PAGE_GROUND = 'wall-ground';

/**
 * WHICH SURFACE THEME A BRAND WEARS.
 *
 * Owner, 2026-09-17: "the system should have a light ui for WPW x Wallpro and
 * a dark for standard wallpro."
 *
 * The partner page stays light: it is a storefront a shop sends its own
 * retail customers to, and it carries the printed-film offer, where a bright
 * page is the convention every e-commerce visitor already reads. The
 * DesignProAI page goes dark because it is mounted inside the OS shell, which
 * is dark everywhere else -- a light panel in that frame reads as a foreign
 * document rather than a tool in the product.
 *
 * It is a TOKEN SET, not a second page: both themes are the same component and
 * the same markup, so a fix lands on both at once.
 */
export type WallSurfaceTheme = 'light' | 'dark';

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
  /** Which surface token set this brand's pages resolve. See WallSurfaceTheme. */
  surface: WallSurfaceTheme;
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
  /**
   * THE MARKING STAGE — the step BETWEEN the two photographs (owner,
   * 2026-09-22: "Add image before and after show one touch masking when they
   * click").
   *
   * Before and after answer "what do I get". They do not answer "what do I
   * have to DO", which is the question a visitor actually hesitates on, and the
   * answer — mark the wall, tap what to keep — is the part of this product that
   * sounds hardest and is easiest. So the band gets a third frame the customer
   * reaches by clicking, rather than a fourth paragraph of copy.
   *
   * OPTIONAL, AND HONEST ABOUT WHAT IT IS. `caption` on this object says which
   * kind of frame it is, because there are two and they are not the same claim:
   * a real screen capture of the tool, or a drawn overlay on the before
   * photograph showing where the corners go. A pair with no marking frame
   * simply has two stages, which is what every historical pair has.
   */
  marking?: { src: string; alt: string; caption: string };
};


/**
 * THE BEFORE/AFTER PAIRS — ONE LIST, BOTH BRANDS.
 *
 * Owner, 2026-09-15: the DesignProAI page "should just be the branded WallPro
 * header that has the tagline. With the before and after photos, of course."
 *
 * The band used to belong to the partner brand alone, on the reasoning that a
 * WePrintWraps visitor should recognise WePrintWraps' own work. That reasoning
 * holds for WHOSE logo is on the header; it does not hold for whether the
 * product gets to show what it makes. A tool whose whole promise is "your wall,
 * transformed" opening on an empty preview pane is the same unanswered question
 * on either domain.
 *
 * So the pairs are shared and the CAPTIONS are brand-neutral -- "designed in
 * WallPro" rather than "printed here", because one list cannot claim a specific
 * printer. Who prints it is the header's job and the print offer's job, both of
 * which stay per-brand.
 *
 * ORDER MATTERS: the first entry is what a visitor sees on arrival and is the
 * only one many will see, so the most persuasive room leads.
 *
 * Files live under `app/public/` and ship with the build, so the band paints on
 * first load with no request to Supabase and no signed URL. Curator rows from
 * /admin/wallpro-proofs override this list when they exist; this is the floor.
 */
const WALL_PROOFS: WallProof[] = [
  {
    /**
     * THE GYM IS BACK, WITH THE TRADEMARK REMOVED (owner, 2026-09-22: "you
     * have the gym photos before and after").
     *
     * It was withdrawn on 09-21 because the generated mural carried a real
     * company's wordmark. The mark was found at x 1207-1320, y 393-410 of the
     * 1400x803 frame -- measured, not eyeballed: a per-column scan of bright
     * pixels reads zero either side of exactly that span. It sat on a flat
     * unlit region of the mural, so it was removed by blending the rows
     * between two clean anchor rows (y 390 and y 413), each smoothed +/-6px
     * horizontally first so per-pixel noise could not streak down the patch.
     *
     * That is the same rule the master cut-out fill follows: continue what is
     * already there, invent nothing. The headline "WE MOVE AS ONE" is generic
     * copy and stays; what was removed is somebody else's mark, not the design.
     *
     * NOTE FOR WHOEVER LOOKS NEXT: the gym equipment carries a manufacturer's
     * name on the sled and the plyo box. That is a photographed room, not our
     * artwork, so it is a different question from the mural and is left alone
     * pending the owner's call.
     */
    before: '/wallpro/proof-gym-before.jpg',
    after: '/wallpro/proof-gym-after.jpg',
    alt: 'A gym training floor: the same bare grey wall behind the racks, and then the same wall covered edge to edge with a printed athletic mural',
    headline: 'A training floor, transformed.',
    caption: 'A gym wall in a full-height athletic mural, designed in WallPro.',
    marking: {
      src: '/wallpro/proof-gym-mask.jpg',
      alt: 'The bare gym wall with its four corners marked and the wall area shaded, the way the tool shows it',
      // SAY WHAT THE FRAME IS. This is an overlay drawn on the before
      // photograph, not a screen recording of the tool, and the caption has to
      // carry that or the band is claiming a capture it does not have. The
      // GEOMETRY is measured off that photograph rather than invented: the
      // bottom edge follows the bench line sampled at x=880/1000/1180/1240/1300
      // and the top edge the ceiling boundary at x=500/900/1300, each
      // extrapolated to the frame. Replace with a real capture when one exists.
      caption: 'Four taps mark the wall. Everything in front of it stays put.',
    },
  },

      // THE OWNER'S OWN HOME IS NOT A PORTFOLIO (owner, 2026-09-18, seeing it
      // on the tool page after it had already been taken off the landing:
      // "somehow it's the old wpw x wallpro page", and earlier "remove my
      // photo ... just show the others").
      //
      // TWO entries were her house, not one: the spa pair and the slat pair are
      // the SAME home studio shot two ways, which is why removing one of them
      // earlier was not enough and it reappeared here. Both are gone.
      //
      // The files stay on disk. That room is this product's measured scale
      // reference and the subject of the case study -- evidence, which is a
      // different job from a showcase slide. Add real customer installs here as
      // they land; a shorter honest list beats a longer one padded with the
      // owner's living room.
      // PENDING: the hotel lobby feature wall. Described but its files are not
      // in the repository either. Add the block with its photographs.
];

/**
 * THE OPENING PAIR, PINNED (owner, 2026-09-16: "the header must be the one
 * with the fitness wall before and after").
 *
 * It already led WALL_PROOFS, but leading a list is not the same as being
 * guaranteed: curator rows from /admin/wallpro-proofs REPLACE this list
 * wholesale, so one published row of a different room silently took the gym
 * off the front of the band. Exported so the tool page can put it first
 * whatever else is published behind it.
 */
/**
 * RETRACTED 2026-09-21, RESTORED CLEAN 2026-09-22. The pinned pair was
 * withdrawn because the generated mural carried a real company's wordmark
 * (owner: "its supposed to be inspired style of model wrote les mills than it
 * needs retracting asap"). The mark has been removed from the frame -- see the
 * entry above for exactly where it was and how -- so the pair leads again.
 *
 * The null branch stays and is not dead code: it is what made the empty state
 * survivable, and it is what an empty curator list falls back to. An empty
 * WALL_PROOFS must never take the page's own hero down with it, which is the
 * separate defect fixed in WallPro.tsx the same day.
 */
export const WALL_HERO_PROOF: WallProof | null = WALL_PROOFS[0] ?? null;

export const WALL_BRANDS: Record<WallBrandKey, WallBrand> = {
  designpro: {
    logo: null,
    logoAlt: '',
    // EMPTY ON PURPOSE. The app sidebar is already branded DesignProAI, so an
    // eyebrow here would be the second time on one screen. Empty makes the
    // header read simply "WallPro" -- the tool, named once.
    eyebrow: '',
    wordmarkLead: 'Wall',
    wordmarkAccent: 'Pro',
    // The OS-side tagline is the product-hierarchy line (os-brand.ts, Trish
    // 2026-09-16). The WePrintWraps partner page below keeps its own words.
    tagline: 'Prompt-Based Wall Graphics Design + Production-Ready File Output',
    // The print offer stays OFF here: on DesignProAI the customer came for the
    // design tool and printing is a partner's business. The PROOF is not a
    // print offer -- it is what the tool makes.
    showPrintOffer: false,
    proofs: WALL_PROOFS,
    // Dark: this page is mounted inside the OS shell, which is dark around it.
    surface: 'dark',
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
    proofs: WALL_PROOFS,
    // Light: a retail storefront the partner sends its own customers to.
    surface: 'light',
  },
};

export const wallBrand = (key: WallBrandKey = 'designpro'): WallBrand => WALL_BRANDS[key];
