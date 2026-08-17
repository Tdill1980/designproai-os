/**
 * content-programming — the Content Director's weekly programming grid.
 *
 * This is docs/WEEKLY-CONTENT-ENGINE.md encoded as data: same story, same
 * look, same week, every channel. The Director (marketing-agent director_*
 * actions) uses it to (a) propose a publish slot when a queue item is
 * approved and (b) plan the week's queue (director_plan_week).
 *
 * Channels here are only ones a publisher exists for: instagram/facebook
 * (content-deploy → Meta), wraptv_site (content-deploy → wraptv_site_content
 * rotation), wrapfeed (content-deploy → social_feed_posts, THE FEED — our own
 * platform), email (agent_email_campaigns → Klaviyo push after approval).
 * LinkedIn slots from the doc are intentionally absent — no publisher yet.
 *
 * THE FEED carries the same week's story as every rented channel — that is
 * the whole point of owning it. Its slots are brand-matched to the day's
 * story and sit an hour after the Meta post, so the Director generates a
 * Feed draft per day, it lands in the SAME approval queue, and approving it
 * publishes to our own platform (then shows on the Brand Board and the
 * Content Calendar like anything else).
 *
 * Times are the doc's 9am/10am/12pm shop times (Pacific), stored as UTC
 * hours with a fixed PDT offset (UTC-7). A one-hour winter drift is fine for
 * social posting.
 */

export type ProgrammingPlatform = "instagram" | "facebook" | "wraptv_site" | "wrapfeed" | "email";

export interface ProgrammingSlot {
  id: string;
  /** 0=Sunday … 6=Saturday (UTC day of the slot time) */
  day: number;
  /** UTC hour (shop time + 7) */
  hourUtc: number;
  brand: string;
  platform: ProgrammingPlatform;
  /** The doc's 5 content types + the weekly newsletter */
  contentType:
    | "before_after"
    | "story_insight"
    | "social_proof"
    | "demo_howto"
    | "repost_winner"
    | "newsletter_roundup"
    | "product_spotlight";
  label: string;
  /** For wraptv_site slots: which show the entry files under. */
  wtwShow?: string;
}

const PT = 7; // PDT offset — shop hour + PT = UTC hour

export const WEEKLY_PROGRAMMING: ProgrammingSlot[] = [
  // Monday — BEFORE/AFTER day
  { id: "mon-ba-ig", day: 1, hourUtc: 9 + PT, brand: "restylepro", platform: "instagram", contentType: "before_after", label: "Mon 9am · Before/After Reel · IG" },
  { id: "mon-ba-fb", day: 1, hourUtc: 9 + PT, brand: "restylepro", platform: "facebook", contentType: "before_after", label: "Mon 9am · Before/After cross-post · FB" },
  { id: "mon-ba-feed", day: 1, hourUtc: 11 + PT, brand: "restylepro", platform: "wrapfeed", contentType: "before_after", label: "Mon 11am · Before/After · The Feed" },
  { id: "mon-ba-wtv", day: 1, hourUtc: 10 + PT, brand: "wraptvworld", platform: "wraptv_site", contentType: "before_after", label: "Mon 10am · Same Reel · WrapTVWorld site", wtwShow: "wrap-of-the-week" },
  // Tuesday — STORY/INSIGHT day + EMAIL day
  { id: "tue-story-ig", day: 2, hourUtc: 9 + PT, brand: "restylepro", platform: "instagram", contentType: "story_insight", label: "Tue 9am · Story/Insight static · IG" },
  { id: "tue-story-fb", day: 2, hourUtc: 9 + PT, brand: "restylepro", platform: "facebook", contentType: "story_insight", label: "Tue 9am · Story/Insight cross-post · FB" },
  { id: "tue-story-feed", day: 2, hourUtc: 11 + PT, brand: "restylepro", platform: "wrapfeed", contentType: "story_insight", label: "Tue 11am · Story/Insight · The Feed" },
  { id: "tue-email", day: 2, hourUtc: 10 + PT, brand: "thewrap", platform: "email", contentType: "newsletter_roundup", label: "Tue 10am · The Wrap weekly roundup · Email" },
  // Wednesday — SOCIAL PROOF day
  { id: "wed-proof-ig", day: 3, hourUtc: 9 + PT, brand: "restylepro", platform: "instagram", contentType: "social_proof", label: "Wed 9am · Social proof · IG" },
  { id: "wed-proof-fb", day: 3, hourUtc: 9 + PT, brand: "restylepro", platform: "facebook", contentType: "social_proof", label: "Wed 9am · Social proof cross-post · FB" },
  { id: "wed-proof-feed", day: 3, hourUtc: 11 + PT, brand: "weprintwraps", platform: "wrapfeed", contentType: "social_proof", label: "Wed 11am · Social proof · The Feed" },
  { id: "wed-wpw-copost", day: 3, hourUtc: 12 + PT, brand: "weprintwraps", platform: "instagram", contentType: "social_proof", label: "Wed 12pm · WPW co-post · IG" },
  // Thursday — DEMO/HOW-TO day
  { id: "thu-demo-ig", day: 4, hourUtc: 9 + PT, brand: "restylepro", platform: "instagram", contentType: "demo_howto", label: "Thu 9am · Demo/How-to Reel · IG" },
  { id: "thu-demo-fb", day: 4, hourUtc: 9 + PT, brand: "restylepro", platform: "facebook", contentType: "demo_howto", label: "Thu 9am · Demo cross-post · FB" },
  { id: "thu-demo-feed", day: 4, hourUtc: 11 + PT, brand: "restylepro", platform: "wrapfeed", contentType: "demo_howto", label: "Thu 11am · Demo/How-to · The Feed" },
  { id: "thu-demo-wtv", day: 4, hourUtc: 9 + PT, brand: "wraptvworld", platform: "wraptv_site", contentType: "demo_howto", label: "Thu 9am · Same Reel · WrapTVWorld site", wtwShow: "behind-the-install" },
  // Friday — REPOST WINNER
  { id: "fri-winner-ig", day: 5, hourUtc: 9 + PT, brand: "restylepro", platform: "instagram", contentType: "repost_winner", label: "Fri 9am · Repost the week's winner · IG" },
  { id: "fri-winner-fb", day: 5, hourUtc: 9 + PT, brand: "restylepro", platform: "facebook", contentType: "repost_winner", label: "Fri 9am · Winner cross-post · FB" },
  { id: "fri-winner-feed", day: 5, hourUtc: 11 + PT, brand: "restylepro", platform: "wrapfeed", contentType: "repost_winner", label: "Fri 11am · Week's winner · The Feed" },
  // Saturday — PRODUCT SPOTLIGHT series (WPW)
  { id: "sat-spotlight-ig", day: 6, hourUtc: 9 + PT, brand: "weprintwraps", platform: "instagram", contentType: "product_spotlight", label: "Sat 9am · Product Spotlight · IG" },
  { id: "sat-spotlight-fb", day: 6, hourUtc: 9 + PT, brand: "weprintwraps", platform: "facebook", contentType: "product_spotlight", label: "Sat 9am · Product Spotlight cross-post · FB" },
  { id: "sat-spotlight-feed", day: 6, hourUtc: 11 + PT, brand: "weprintwraps", platform: "wrapfeed", contentType: "product_spotlight", label: "Sat 11am · Product Spotlight · The Feed" },
];

/** Per-contentType creative guidance fed to the copy generator. */
export const CONTENT_TYPE_BRIEF: Record<ProgrammingSlot["contentType"], string> = {
  before_after:
    "BEFORE/AFTER — one vehicle, factory vs wrapped. 3-word-energy caption " +
    '(e.g. "2024 F-150. Satin army green. 30 seconds."). Let the transformation carry it.',
  story_insight:
    "STORY/INSIGHT — founder quote, shop tip, or industry take. Text-forward. " +
    'Example energy: "80% of wrap clients ghost because they can\'t visualize the color. Fix that."',
  social_proof:
    "SOCIAL PROOF — customer result, signup milestone, render showcase, or testimonial. " +
    "Never invent numbers — only use facts present in the brand voice or the asset itself.",
  demo_howto:
    "DEMO/HOW-TO — show a feature or technique in action, 15-30s. " +
    'Example: "How to show a client 6 colors in 60 seconds."',
  repost_winner:
    "REPOST WINNER — re-run the week's best performer with a fresh first line. " +
    "Reference that people loved it without inventing metrics.",
  newsletter_roundup:
    "WEEKLY ROUNDUP — the week's best content across all brands, repurposed not rewritten, " +
    "one image, one CTA.",
  product_spotlight:
    "PRODUCT SPOTLIGHT (series) — ONE real WePrintWraps product per episode " +
    "(3M IJ180 / Avery MPI 1105 film, wrap-by-the-yard, fade wraps, window perf, laminates, " +
    "printed panels): what it is, why shops pick it, one real differentiator (human preflight, " +
    "1-2 day ship, Premium Wrap Guarantee), paired with footage/renders showing it in use. " +
    // THE EPISODE NUMBER IS SUPPLIED, NEVER WRITTEN.
    //
    // This line used to read "collectible, numbered energy ('Spotlight 004')".
    // The model read the EXAMPLE as the format and copied it literally, every
    // week, forever: measured on production, the spotlights of 24 Jul, 26 Jul,
    // 2 Aug, 6 Aug and 8 Aug are all "Spotlight 004". A series whose number
    // never advances is not collectible, it is a stuck counter — and an
    // example inside a prompt is indistinguishable from an instruction.
    "Consistent series voice, collectible and numbered — the caller supplies the episode number " +
    "and you use it EXACTLY as given. Never write your own number. " +
    // The live 004 also said only "Shops pick it for its durability and vibrant
    // finish" — two adjectives that are true of every film ever made.
    "Name a CONCRETE, declared differentiator, not adjectives: 'durable' and 'vibrant' describe " +
    "every film on the market and say nothing. Never invented specs. " +
    "The attached image or clip must SHOW the product you are writing about.",
};

/**
 * The products this series is allowed to spotlight, and the words that identify
 * one in a caption or in an asset's title/tags.
 *
 * ONE registry, read by the brief above AND by the asset-match check in
 * `marketing-agent`'s weekly planner, so the copy and the picture cannot be
 * judged against two different lists. Live failure this exists to catch, from
 * the Brand Board on 2026-08-08: a caption spotlighting "Avery MPI 1105 Film"
 * attached to a photo of a fire-department door decal. Every word of the copy
 * was true and the picture was of something else entirely.
 */
export const SPOTLIGHT_PRODUCTS: Array<{ name: string; terms: string[] }> = [
  { name: "3M IJ180", terms: ["ij180", "ij 180"] },
  { name: "Avery MPI 1105", terms: ["mpi", "1105"] },
  { name: "wrap by the yard", terms: ["by the yard", "wbty"] },
  { name: "fade wraps", terms: ["fade"] },
  { name: "window perf", terms: ["perf"] },
  { name: "laminate", terms: ["laminate"] },
  { name: "printed panels", terms: ["panel"] },
];

/** Lowercased, punctuation-flattened, so "MPI-1105" and "mpi 1105" agree. */
function flatten(text: unknown): string {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The product a spotlight caption is about, or null when it names none.
 *
 * Null is not a failure — a spotlight can be about the service rather than one
 * film. It only means there is no specific product to check the picture against.
 */
export function spotlightProductIn(caption: unknown): { name: string; terms: string[] } | null {
  const hay = flatten(caption);
  if (!hay) return null;
  for (const p of SPOTLIGHT_PRODUCTS) {
    if (p.terms.some((t) => hay.includes(flatten(t)))) return p;
  }
  return null;
}

/**
 * Why this asset cannot illustrate this caption, or null when it can.
 *
 * Deliberately ONE-SIDED and forgiving: it only fires when the caption names a
 * specific product and NOTHING in the asset's own title, tags, category or
 * filename mentions it. An asset with thin metadata that happens to show the
 * right thing still passes — refusing on missing metadata would empty the grid
 * to punish the library rather than the pairing.
 */
export function spotlightAssetMismatch(caption: unknown, assetText: unknown): string | null {
  const product = spotlightProductIn(caption);
  if (!product) return null;
  const hay = flatten(assetText);
  if (!hay) return `names ${product.name}, and the chosen asset has no title, tags or category to show it does`;
  if (product.terms.some((t) => hay.includes(flatten(t)))) return null;
  return `spotlights ${product.name}, but nothing about the chosen asset says it shows ${product.name} — ` +
    `tag or upload footage of ${product.name} rather than illustrating it with unrelated work`;
}

/** Next occurrence of a slot strictly after `after` (UTC). */
export function nextOccurrence(slot: ProgrammingSlot, after: Date): Date {
  const d = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), slot.hourUtc, 0, 0));
  const dayDiff = (slot.day - d.getUTCDay() + 7) % 7;
  d.setUTCDate(d.getUTCDate() + dayDiff);
  if (d <= after) d.setUTCDate(d.getUTCDate() + 7);
  return d;
}

/**
 * Propose the next open programming slot for a queue item. `takenIso` is the
 * set of already-scheduled datetimes (ISO) for the same brand+platform — an
 * occurrence colliding with one is skipped, up to 4 weeks out.
 */
export function proposeSlot(
  platform: string,
  brand: string | null,
  after: Date,
  takenIso: string[],
): { slot: ProgrammingSlot; when: Date } | null {
  const taken = new Set(takenIso.map((t) => new Date(t).toISOString()));
  const candidates = WEEKLY_PROGRAMMING.filter(
    (s) => s.platform === platform && (!brand || s.brand === brand || s.platform === "wraptv_site"),
  );
  const pool = candidates.length
    ? candidates
    : WEEKLY_PROGRAMMING.filter((s) => s.platform === platform);
  let best: { slot: ProgrammingSlot; when: Date } | null = null;
  for (const slot of pool) {
    let when = nextOccurrence(slot, after);
    for (let w = 0; w < 4 && taken.has(when.toISOString()); w++) {
      when = nextOccurrence(slot, when);
    }
    if (!best || when < best.when) best = { slot, when };
  }
  return best;
}
