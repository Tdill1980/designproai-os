/**
 * THE CASE STUDIES — one page, N real walls.
 *
 * Owner, 2026-09-21, looking at /wall-wrap/how-it-works on her phone and
 * choosing "gym becomes a 2nd case study": her own living room was the only
 * worked example on a customer-facing page, after she had twice asked for her
 * house to come off the product surfaces. The hero band and the landing were
 * cleaned up on 2026-09-18; the case study never was, and it carries her room
 * in five places.
 *
 * WHY A REGISTRY RATHER THAN A SECOND PAGE. A copied page is how two products
 * drift, and this repository has paid that bill repeatedly — most recently the
 * ShopFlow rail, where a second copy of three hrefs was wrong twice in opposite
 * directions. The page is one component; a case study is data.
 *
 * ── THE RULE THAT GOVERNS THIS FILE ────────────────────────────────────────
 *
 * The page's own header states it: every number on it is produced by the same
 * functions the tool runs, so it "cannot lie about the product because it is
 * running the product". That guarantee only holds if the WALL INCHES are real.
 * 142 × 96 is the owner's measured room, which is also where CLAUDE.md's
 * wall-scale baseline comes from.
 *
 * So a study with no measured wall is NOT PUBLISHED. It sits here with `wall:
 * null`, out of the route and out of the switcher, until someone measures it.
 * The alternative — shipping a plausible-looking number under a photograph of
 * a different wall — would put a fictional measurement on the one page whose
 * entire job is to be checkable, and it would do it silently.
 */
export type WallCaseStudy = {
  key: string;
  /** URL segment under /how-it-works. The default study uses ''. */
  slug: string;
  /** Short name for the switcher between studies. */
  tab: string;
  eyebrow: string;
  /** The headline, as its two rendered lines. */
  headline: [string, string];
  /** Describes the wall in the lede: "studio wall", "gym wall". */
  wallNoun: string;
  /**
   * MEASURED, never estimated. `null` means nobody has measured it yet, which
   * keeps the study unpublished rather than inventing a number for it.
   */
  wall: { widthIn: number; heightIn: number } | null;
  /** The brief that produced the artwork, quoted verbatim on the page. */
  brief: string;
  photos: {
    before: string;
    after: string;
    /** The flat generated master, when we have it to show. */
    artwork: string | null;
  };
  alt: { before: string; after: string; mask: string; artwork: string; installed: string };
  /** A real corner-marking capture when one exists; the drawn stand-in until. */
  maskCapture: string | null;
};

const STUDIO: WallCaseStudy = {
  key: 'studio',
  slug: '',
  tab: 'Interior feature wall',
  eyebrow: 'CASE STUDY · INTERIOR FEATURE WALL',
  headline: ['One wall,', 'bare to installed.'],
  wallNoun: 'studio wall',
  // The owner's own room. This is the measurement CLAUDE.md's wall-scale
  // baseline is derived from, so it is the most checkable number we have.
  wall: { widthIn: 142, heightIn: 96 },
  brief: 'dark tropical anthurium and bird of paradise, moody, wall to wall',
  photos: {
    before: '/wallpro/proof-spa-before.jpg',
    after: '/wallpro/proof-spa-after.jpg',
    artwork: '/wallpro/case-studio-artwork.jpg',
  },
  alt: {
    before: 'The same studio before, with plain cream walls either side of the window',
    after: 'A home studio with a dark tropical anthurium mural covering the wall either side of the window',
    mask: 'The bare studio wall with a translucent mask drawn over the wall area',
    artwork: 'The generated artwork: pale anthurium and bird of paradise blooms across deep green tropical foliage on near-black',
    installed: 'The finished studio with the tropical mural installed on both walls either side of the window',
  },
  maskCapture: null,
};

/**
 * THE GYM — measured 2026-09-21, and published because of it.
 *
 * It sat here with `wall: null` for exactly as long as nobody had measured it,
 * which is the rule this file exists to enforce. The owner supplied the inches
 * and it published itself: the route, the switcher and every computed figure
 * follow from those two numbers and nothing else here changed. That is the
 * whole point of a study being data.
 *
 * STILL WORTH KNOWING: the installed mural carries another brand's artwork. The
 * owner directed publication, so this presents it as a WePrintWraps job on her
 * authority; if that is ever not the case, the honest repair is to pull the
 * entry rather than soften the wording.
 */
const GYM: WallCaseStudy = {
  key: 'gym',
  slug: 'gym',
  tab: 'Gym feature wall',
  eyebrow: 'CASE STUDY · GYM FEATURE WALL',
  headline: ['One wall,', 'bare to installed.'],
  wallNoun: 'gym wall',
  /**
   * MEASURED: the owner gave "120\" x 240\"" on 2026-09-21.
   *
   * THE ORDER IS READ OFF THE PHOTOGRAPH, NOT OFF THE MESSAGE. 240 x 120 is a
   * wall twice as wide as it is high, which is the wall in proof-gym-*.jpg;
   * 120 x 240 would be a ten-foot-wide wall standing twenty feet tall, which it
   * plainly is not. Every figure on the page -- panel count, linear feet, price,
   * repeat width -- follows from these two numbers, so putting them the wrong
   * way round would print a wrong panel plan on a public page. Flagged to the
   * owner for a one-word confirmation; if it is the other way, swap these two
   * values and nothing else changes.
   */
  wall: { widthIn: 240, heightIn: 120 },
  brief: 'full-height athletic hero wall, high contrast, bold type, wall to wall',
  photos: {
    before: '/wallpro/proof-gym-before.jpg',
    after: '/wallpro/proof-gym-after.jpg',
    artwork: null,
  },
  alt: {
    before: 'A gym training floor with a bare dark grey wall behind the racks',
    after: 'The same gym wall covered edge to edge with a printed athletic mural',
    mask: 'The bare gym wall with a translucent mask drawn over the wall area',
    artwork: 'The generated artwork for the gym wall',
    installed: 'The finished gym with the mural installed behind the racks',
  },
  maskCapture: null,
};

export const ALL_CASE_STUDIES: WallCaseStudy[] = [STUDIO, GYM];

/** Only studies with a measured wall reach a customer. See the header. */
export const publishedCaseStudies = (): WallCaseStudy[] => ALL_CASE_STUDIES.filter(s => s.wall !== null);

export const DEFAULT_CASE_STUDY = STUDIO;

/**
 * Resolve a URL segment to a study. An unknown slug, or one whose wall has not
 * been measured, falls back to the default rather than 404ing — a visitor who
 * followed a stale link should land on a real case study, not an error.
 */
export function caseStudyForSlug(slug: string | undefined): WallCaseStudy {
  if (!slug) return DEFAULT_CASE_STUDY;
  return publishedCaseStudies().find(s => s.slug === slug) || DEFAULT_CASE_STUDY;
}

/** The path a study lives at, per brand. */
export function caseStudyPath(study: WallCaseStudy, brand: 'designpro' | 'weprintwraps'): string {
  const base = brand === 'weprintwraps' ? '/wall-wrap/how-it-works' : '/printpro/wallpro/how-it-works';
  return study.slug ? `${base}/${study.slug}` : base;
}
