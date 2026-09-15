// WHOSE PATTERN TOOL IS THIS, FROM THE CUSTOMER'S SIDE.
//
// Owner, 2026-09-15, after the WPW x WallPro page: "Is it possible for you to
// make a white and gradient blue version for WPW version? PatternPro top left
// show a image on right" — and then "all these need to be in os.designpro
// repo". So PatternPro joins WallPro's shape here: ONE tool (WBTYToolUI — the
// 118-pattern library, the on-vehicle 3D proof, the full-wrap yardage, the
// WooCommerce cart link), worn by whichever brand is serving it. The branding
// is DATA; the page reads it and is otherwise the same component.
//
// The identity fields are the same six WallProLockup reads, so the partner
// header is literally the WallPro one with different words in it — a visitor
// moving from wallpro.weprintwraps.com to the pattern page sees one system.
import type { LockupBrand } from '@/components/wallpro/WallProLockup';
import { WPW_PRODUCT_URLS } from '@/data/patternpro-patterns';

export type PatternBrandKey = 'designpro' | 'weprintwraps';

export type PatternBrand = LockupBrand & {
  /** The hero beside the headline: a real PatternPro render, and the swatch it was made from. */
  hero: { main: string; swatch: string; alt: string; swatchAlt: string } | null;
  /**
   * Where "Already know your pattern?" sends a buyer who needs no proof: the
   * partner's product page per collection, keyed by the collection name. Null
   * renders no bar at all.
   */
  orderFilmUrls: Record<string, string> | null;
};

/**
 * THE BLUE RAMP — the WePrintWraps CommercialPro tokens (#2f7ff7 → #174a91),
 * not the WallPro blue→magenta. Owner, 2026-09-15: "gradiant blue accent".
 * Declared once; PatternWrap.css reads the same two stops.
 */
export const PATTERN_BLUE_GRADIENT = 'linear-gradient(90deg, #2f7ff7, #174a91)';

/**
 * The hero pair: the owner's own PatternPro render (Chameleon Camo Tan on a
 * 2022 Raptor) and, in the small square over it, THE SWATCH of that same
 * pattern (owner, 2026-09-15: "the little square pic is swatch pattern"). The
 * pair is the whole pitch in one glance — this swatch, that truck. Both are
 * served through the storage image transform so a 9 MB render never ships to
 * a phone. They live on the RestylePro project, where the swatch library and
 * the renders are; the URLs are public and the files are not going anywhere.
 */
const RENDER_BASE =
  'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/render/image/public/wrap-files/renders/anonymous/patternpro';
const SWATCH_BASE =
  'https://kfapjdyythzyvnpdeghu.supabase.co/storage/v1/render/image/public/wrap-files/pattern-swatches-wpw';

export const PATTERN_BRANDS: Record<PatternBrandKey, PatternBrand> = {
  designpro: {
    logo: null,
    logoAlt: '',
    eyebrow: 'DesignProAI',
    wordmarkLead: 'Pattern',
    wordmarkAccent: 'Pro',
    tagline: 'Pattern wraps by the yard — proof it on the vehicle first',
    hero: null,
    orderFilmUrls: null,
  },
  weprintwraps: {
    // The same vendored mark WallPro's partner header uses (app/public/).
    logo: '/wpw-logo-mark.png',
    logoAlt: 'WePrintWraps',
    eyebrow: 'WePrintWraps',
    wordmarkLead: 'Pattern',
    wordmarkAccent: 'Pro',
    tagline: 'Pattern wraps by the yard · designed in PatternPro, printed by WePrintWraps',
    hero: {
      main: `${RENDER_BASE}/1789445607140_Ford_Raptor_side.jpg?width=1400&height=788&resize=contain&quality=78`,
      // The swatch card is 1500×929 with the pattern NAME printed along its bottom
      // edge; it ships at its own proportions (owner: "you cropped the swatch name
      // out"), never squared off.
      swatch: `${SWATCH_BASE}/modern-trippy/chameleon-camo-tan.jpg?width=800&quality=80`,
      alt: 'Chameleon Camo Tan pattern rendered on a 2022 Ford Raptor in PatternPro',
      swatchAlt: 'The Chameleon Camo Tan swatch the render was made from',
    },
    // The five WooCommerce product pages, one per collection — the same
    // table the cart link resolves through.
    orderFilmUrls: WPW_PRODUCT_URLS,
  },
};

export const patternBrand = (key: PatternBrandKey = 'designpro'): PatternBrand => PATTERN_BRANDS[key];
