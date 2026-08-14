/**
 * Rep profiles — drives the /wpw/:rep landing pages.
 *
 * Started as WPW-only (Troy/Lance/Brice/Jackson) and grew to cover the
 * DesignProAI team (Carley, Jess, Trish) plus external partners (RJ).
 * The URL prefix stays /wpw/ for backwards compatibility; the `org`
 * field controls which company name is shown on each landing page.
 *
 * Each entry powers a personal landing page the rep can paste into a
 * customer email. The slug is the URL path segment. The coupon code
 * lives in `affiliate_coupons` (10% off, links to the rep's
 * `affiliate_partners` row so commission flows). The `ref` is the
 * attribution slug consumed by `create-guest-design-checkout` —
 * stripe-webhook resolves it case-insensitively against the partner's
 * referral_code (e.g. "lance" → WPW-LANCE).
 *
 * Adding a new rep: insert a row in `affiliate_partners`, create a
 * matching coupon in `affiliate_coupons`, then add an entry here.
 *
 * Branded assets convention: drop files at
 *   /public/reps/<slug>/headshot.jpg   — square headshot
 *   /public/reps/<slug>/hero.jpg       — signature wrap render
 *   /public/reps/<slug>/portfolio-1.jpg, portfolio-2.jpg, portfolio-3.jpg
 * The landing page falls back to a monogram avatar + default hero
 * (McLaren koi) when a rep's file is missing, so it stays shippable
 * before all assets land.
 */

export type RepOrg =
  | "WePrintWraps"
  | "DesignProAI"
  | "RoyaltyWraps"
  | "VinylVixenWraps"
  | "Independent";

export interface WpwRep {
  slug: string;        // URL segment — /wpw/<slug>
  name: string;        // Display name
  title: string;       // Job title shown under name
  ref: string;         // Attribution slug passed as ?ref= to /try-design
  coupon: string;      // Code in `affiliate_coupons` (10% off design + sub)
  partnerCode: string; // affiliate_partners.referral_code that owns this rep
  intro: string;       // First-person blurb on the landing page hero
  bio?: string;        // Optional 2-3 sentence story under the CTAs
  org?: RepOrg;        // Which company line surfaces on the page; default WePrintWraps
  email?: string;      // Optional reply-to surfaced in footer
  photoUrl?: string;   // Headshot URL — defaults to /reps/<slug>/headshot.jpg
  heroUrl?: string;    // Signature work URL — defaults to /reps/<slug>/hero.jpg
  /**
   * Optional org logo (white-on-transparent PNG). When set, surfaces on
   * the rep's popup brand bar, sharing kit card, and 4:5 social post
   * alongside / instead of the org text. Defaults to /orgs/<slug>.png
   * via `defaultOrgLogoPath` when not specified per-rep.
   */
  orgLogoUrl?: string;
  /** Tailwind/CSS hex driving the accent color on this rep's page. */
  accent: string;
  /** Lighter tint of accent for soft backgrounds. */
  accentSoft: string;
}

export const WPW_REPS: Record<string, WpwRep> = {
  troy: {
    slug: "troy",
    name: "Troy",
    title: "Senior Wrap Specialist · WePrintWraps",
    ref: "troy",
    coupon: "TROY10",
    partnerCode: "TROY",
    org: "WePrintWraps",
    intro:
      "Hey, I'm Troy — Senior Wrap Specialist at WePrintWraps. I've spec'd thousands of these jobs. Skip the back-and-forth and design your wrap yourself for $25 — same AI tool I use to mock up customer jobs before any vinyl moves. Code TROY10 takes 10% off.",
    bio:
      "I've been wrapping vehicles at WePrintWraps for years — everything from single-color color changes to full custom commercial fleets. Use these tools to see your idea on your actual vehicle before you commit a dollar.",
    email: "troy@weprintwraps.com",
    orgLogoUrl: "/orgs/weprintwraps-logo.png",
    accent: "#E11D48",
    accentSoft: "#FFE4E6",
  },
  lance: {
    slug: "lance",
    name: "Lance",
    title: "Wrap Specialist · WePrintWraps",
    ref: "lance",
    coupon: "LANCE10",
    partnerCode: "WPW-LANCE",
    org: "WePrintWraps",
    intro:
      "Hey, I'm Lance at WePrintWraps. Stop guessing what your wrap will look like — $25 puts a photorealistic render of YOUR vehicle in your hands, 7 angles deep. Code LANCE10 takes 10% off.",
    bio:
      "Wrap specialist at WePrintWraps. If you've got a vehicle and an idea, this is the fastest way to see it photorealistically before printing anything.",
    email: "lance@weprintwraps.com",
    orgLogoUrl: "/orgs/weprintwraps-logo.png",
    accent: "#16A34A",
    accentSoft: "#DCFCE7",
  },
  brice: {
    slug: "brice",
    name: "Brice",
    title: "Wrap Specialist · WePrintWraps",
    ref: "brice",
    coupon: "BRICE10",
    partnerCode: "WPW-BRICE",
    org: "WePrintWraps",
    intro:
      "Hey, I'm Brice from WePrintWraps. Faster than waiting on a reply from me — design it yourself for $25. Same AI tool I'd run for you, 7 angles, 3 revisions. Code BRICE10 takes 10% off.",
    bio:
      "Wrap specialist at WePrintWraps. I've seen every kind of wrap project come through — these tools turn the slowest part (figuring out what you want) into 60 seconds.",
    email: "brice@weprintwraps.com",
    orgLogoUrl: "/orgs/weprintwraps-logo.png",
    accent: "#F97316",
    accentSoft: "#FFEDD5",
  },
  jackson: {
    slug: "jackson",
    name: "Jackson",
    title: "Wrap Specialist · WePrintWraps",
    ref: "jackson",
    coupon: "JACKSON10",
    partnerCode: "JACKSON10",
    org: "WePrintWraps",
    intro:
      "Hey, I'm Jackson at WePrintWraps. Whether it's your daily driver or a full fleet — $25 gets you a real photorealistic render on YOUR actual vehicle, not a stock image. Code JACKSON10 takes 10% off.",
    bio:
      "Wrap specialist at WePrintWraps. Whether you're commercial or personal, you'll get a real render of your vehicle, not a generic stock image.",
    email: "jackson@weprintwraps.com",
    orgLogoUrl: "/orgs/weprintwraps-logo.png",
    accent: "#7C3AED",
    accentSoft: "#EDE9FE",
  },
  rj: {
    slug: "rj",
    name: "RJ",
    title: "RJ The Wrapper",
    ref: "rj",
    coupon: "RJ10",
    partnerCode: "RP-RJ",
    org: "Independent",
    intro:
      "Hey, I'm RJ — RJ The Wrapper. This is the exact design system I run my whole shop on. $25 gets you the kind of proof I'd charge $300+ for — 7 angles, 3 revisions, you keep it. Code RJ10 takes 10% off.",
    bio:
      "I run RJ The Wrapper. DesignProAI is the design and proofing system I run my own shop on — try it before you commit.",
    orgLogoUrl: "/orgs/rjthewrapper-logo.png",
    accent: "#22C55E",
    accentSoft: "#DCFCE7",
  },
  carley: {
    slug: "carley",
    name: "Carley",
    title: "Customer Success · DesignProAI",
    ref: "carley",
    coupon: "CARLEY10",
    partnerCode: "RP-CARLEY",
    org: "DesignProAI",
    intro:
      "Hey, I'm Carley — Customer Success at DesignProAI. Customers ask me 'what will this look like on MY truck?' every single day. $25 is the answer — your vehicle, your idea, 7 angles. Code CARLEY10 takes 10% off.",
    bio:
      "I run customer success at DesignProAI — which means I see what every kind of shop and vehicle owner asks for. These tools answer 90% of those questions in under a minute.",
    email: "carley@restyleproai.com",
    accent: "#EC4899",
    accentSoft: "#FCE7F3",
  },
  jess: {
    slug: "jess",
    name: "Jess",
    title: "Owner · Vinyl Vixen Wraps",
    ref: "jess",
    coupon: "JESS10",
    partnerCode: "RP-JESS",
    org: "VinylVixenWraps",
    intro:
      "Hey, I'm Jess — Owner at Vinyl Vixen Wraps. I run my whole shop on this design system. Your $25 buys a real proof, not a demo — 7 angles, 3 revisions, and you can list it on CreatorMarket for $350 resale. Code JESS10 takes 10% off.",
    bio:
      "Owner at Vinyl Vixen Wraps. I've used every tool here in production — your $25 buys you a real proof, not a demo.",
    email: "jess@restyleproai.com",
    orgLogoUrl: "/orgs/vinylvixenwraps-logo.png",
    accent: "#0EA5E9",
    accentSoft: "#E0F2FE",
  },
  amanda: {
    slug: "amanda",
    name: "Amanda",
    title: "Co-Owner · RoyaltyWraps",
    ref: "amanda",
    coupon: "AMANDA10",
    partnerCode: "RW-AMANDA",
    org: "RoyaltyWraps",
    intro:
      "Hey, I'm Amanda — Co-Owner at RoyaltyWraps. We spec luxury, exotic, and yacht wraps through this exact AI system before any vinyl is cut. $25 puts the same tools in your hands — 7 angles, 3 revisions in Revision Studio. Code AMANDA10 takes 10% off.",
    bio:
      "I co-run RoyaltyWraps — luxury, exotic, and yacht wraps. We spec every job through these AI tools before any vinyl is cut. Try the same workflow on your vehicle.",
    email: "amanda@restyleproai.com",
    orgLogoUrl: "/orgs/royaltywraps-logo.png",
    accent: "#A855F7",
    accentSoft: "#F3E8FF",
  },
  xavier: {
    slug: "xavier",
    name: "Xavier",
    title: "Co-Owner · RoyaltyWraps",
    ref: "xavier",
    coupon: "XAVIER10",
    partnerCode: "RW-XAVIER",
    org: "RoyaltyWraps",
    intro:
      "Hey, I'm Xavier — Co-Owner at RoyaltyWraps. High-end exotic mock-ups used to take days. With this AI system it's minutes. $25 gets you the same system — 7 angles, 3 revisions, print-ready when you're ready. Code XAVIER10 takes 10% off.",
    bio:
      "Co-Owner at RoyaltyWraps. The AI proofs here cut my mock-up time from days to minutes — same tools, available to you.",
    orgLogoUrl: "/orgs/royaltywraps-logo.png",
    accent: "#D97706",
    accentSoft: "#FEF3C7",
  },
  trish: {
    slug: "trish",
    name: "Trish",
    title: "Founder · DesignProAI",
    ref: "trish",
    coupon: "TRISH10",
    partnerCode: "TRISH",
    org: "DesignProAI",
    intro:
      "Hey, I'm Trish — I built this. After a decade running wrap production at WePrintWraps, the $25 design tool is the one I wished existed when I was the one quoting jobs. Try it yourself. Code TRISH10 takes 10% off.",
    bio:
      "I founded DesignProAI after a decade running wrap production at WePrintWraps. The tools here are the ones I wished existed when I was the one quoting and designing.",
    email: "trish@weprintwraps.com",
    photoUrl: "/founder-trish-dill.jpg",
    accent: "#06B6D4",
    accentSoft: "#CFFAFE",
  },
};

export const WPW_REP_SLUGS = Object.keys(WPW_REPS);

export const getWpwRep = (slug: string | undefined): WpwRep | null => {
  if (!slug) return null;
  return WPW_REPS[slug.toLowerCase()] ?? null;
};

/**
 * Reverse lookup — find a rep by the affiliate_partners.referral_code
 * stored on their partner row. Used by the affiliate dashboard to show
 * the rep their branded landing URL + paste-able snippets.
 */
export const getWpwRepByPartnerCode = (
  partnerCode: string | null | undefined,
): WpwRep | null => {
  if (!partnerCode) return null;
  const upper = partnerCode.toUpperCase();
  return (
    Object.values(WPW_REPS).find((r) => r.partnerCode.toUpperCase() === upper) ??
    null
  );
};

/**
 * Default headshot path for a rep — used by the landing page when the
 * rep hasn't set a custom `photoUrl`. The image is fetched with
 * onError fallback to a monogram, so /reps/<slug>/headshot.jpg can be
 * missing without breaking the page.
 */
export const defaultHeadshotPath = (rep: WpwRep): string =>
  rep.photoUrl ?? `/reps/${rep.slug}/headshot.jpg`;

/**
 * Default signature-work image path. Same fallback contract as
 * headshots — onError swaps to the global hero render.
 */
export const defaultHeroPath = (rep: WpwRep): string =>
  rep.heroUrl ?? `/reps/${rep.slug}/hero.jpg`;

/**
 * Org logo path. Returns null if neither a per-rep override nor a
 * conventional /orgs/<slug>.png exists; callers should render the
 * org name as text instead. The image itself is expected to be a
 * white-on-transparent PNG so it reads on the popup's black brand bar
 * and on the dark-bottom panel of the 4:5 social post.
 */
export const defaultOrgLogoPath = (rep: WpwRep): string | null => {
  if (rep.orgLogoUrl) return rep.orgLogoUrl;
  return null;
};
