/**
 * castTreatments — one pile of raw footage, three different finished products.
 *
 * The renderer already knows how to make all three; what was missing was any
 * way to ASK for them. In particular the MTV broadcast pack (lower thirds,
 * title cards, NOW PLAYING flashes, a skate-video credits roll and a QR end
 * card) shipped into `worker/video-renderer` complete — and then nothing in
 * the app ever wrote its blueprint fields, so no button could reach it. Its
 * own worked example is "GHOST INDUSTRIES / Mesa, Arizona", i.e. the exact
 * December shoot this was built for. This module is the missing author.
 *
 * A TREATMENT is what the cut is FOR. It decides the blueprint's broadcast
 * furniture; the planner still decides which moments get used.
 *
 *   organic — the house cut. No furniture. Reel/Story/Short/Long-form.
 *   bti     — Behind The Install. The MTV pack: shop lower-third, NOW PLAYING
 *             flash, and a bottom ticker of shop names. Opens and closes on
 *             the FOOTAGE — no black title card, no black credits/QR tail.
 *   ad      — Meta paid. Feed-shaped (4:5 / 1:1), tight, one hard CTA, no
 *             episode furniture (a title card burns the first second, which
 *             is the entire hook window on a paid placement).
 *
 * ── THE ONE RULE ───────────────────────────────────────────────────────────
 * NOTHING HERE INVENTS A STRING. Every line rendered on screen — the shop
 * name, the city, the handle, the episode number, the song — is one the
 * operator actually typed. No shop name means no lower third, not a plausible
 * one. The renderer's own contract is "only ever renders strings the
 * blueprint provides"; this module holds that line one level up, because a
 * credit that invents a shop's city is worse than no credit.
 * Locked by `tests/cast-treatments.test.ts`.
 */

/**
 * Output formats. These live here rather than in the BrandCast hook so the
 * treatment→format rules below can be unit-tested without dragging in the
 * Supabase client. `useBrandCast` re-exports them, so every existing import
 * keeps working.
 */
export type CastFormat = "reel" | "story" | "short" | "longform" | "ad_feed" | "ad_square";

export const CAST_FORMATS: Record<CastFormat, {
  label: string; aspectRatio: "9:16" | "16:9" | "4:5" | "1:1"; duration: number;
  platform: string; maxScenes: number; minSeg?: number; maxSeg?: number;
}> = {
  reel: { label: "Reel (IG/FB/TikTok)", aspectRatio: "9:16", duration: 24, platform: "instagram", maxScenes: 10 },
  story: { label: "Story (IG/FB)", aspectRatio: "9:16", duration: 12, platform: "instagram", maxScenes: 6 },
  short: { label: "YouTube Short", aspectRatio: "9:16", duration: 50, platform: "youtube", maxScenes: 14 },
  longform: { label: "YouTube Long-Form", aspectRatio: "16:9", duration: 240, platform: "youtube", maxScenes: 40, minSeg: 8, maxSeg: 20 },
  // Paid placements. The renderer already sizes 4:5 and 1:1 (ASPECT_DIMS) —
  // BrandCast just never offered them, so every "ad" was really a 9:16 organic
  // cut competing for the same placement. Short and few-scened on purpose: a
  // feed ad is judged in its first second, so it cannot afford a slow build.
  ad_feed: { label: "Meta Ad — Feed 4:5", aspectRatio: "4:5", duration: 15, platform: "facebook", maxScenes: 6 },
  ad_square: { label: "Meta Ad — Square 1:1", aspectRatio: "1:1", duration: 15, platform: "facebook", maxScenes: 6 },
};

export type CastTreatment = "organic" | "bti" | "ad";

export const TREATMENT_META: Record<CastTreatment, { label: string; blurb: string }> = {
  organic: {
    label: "Organic",
    blurb: "The house cut — feed, story and short. No broadcast furniture.",
  },
  bti: {
    label: "Behind The Install",
    blurb: "The MTV pack: shop lower-third, NOW PLAYING flash, and a bottom ticker of shop names — opens and closes on the footage.",
  },
  ad: {
    label: "Meta Ad",
    blurb: "Feed-shaped and tight. One hard CTA, no episode furniture.",
  },
};

export const TREATMENT_ORDER: CastTreatment[] = ["organic", "bti", "ad"];

/** What the operator typed about this shoot. Every field is optional. */
export interface BtiCredit {
  /** "GHOST INDUSTRIES" — the shop being filmed. */
  shop?: string;
  /** "Mesa, Arizona" */
  city?: string;
  /** "@ghostindustries" */
  handle?: string;
  /** "014" → renders as "EP. 014". */
  episode?: string;
  /** The show strap, e.g. "WRAP ROCK". */
  series?: string;
  /** Track showing in the NOW PLAYING flash. */
  songTitle?: string;
  songArtist?: string;
  /** Submission URL behind the end-card QR. */
  qrUrl?: string;
  /** Extra credit lines for the roll (crew, shop, shout-outs). */
  creditLines?: string[];
}

/** Upper-cased, trimmed, empty → null. Screen furniture is all caps. */
function line(v?: string | null): string | null {
  const s = String(v ?? "").trim();
  return s ? s.toUpperCase() : null;
}

/**
 * The bottom-left shop credit. Max three lines, per the renderer's slice(0,3).
 * Returns null when the operator gave us nothing — the cut then simply has no
 * lower third, which is the honest outcome.
 */
export function buildLowerThird(credit: BtiCredit): { lines: string[]; duration: number } | null {
  const lines = [line(credit.shop), line(credit.city), line(credit.handle)].filter(Boolean) as string[];
  return lines.length ? { lines, duration: 5 } : null;
}

/**
 * The between-songs interstitial: "BEHIND THE INSTALL" / "EP. 014" / "WRAP ROCK".
 * The show name is a constant of the format itself, not a claim about the
 * footage, so it is the one string this module supplies.
 */
export const BTI_SHOW_TITLE = "BEHIND THE INSTALL";

export function buildTitleCardScene(credit: BtiCredit): { type: "titleCard"; lines: string[]; duration: number } {
  const lines = [BTI_SHOW_TITLE];
  const ep = line(credit.episode);
  if (ep) lines.push(ep.startsWith("EP") ? ep : `EP. ${ep}`);
  const series = line(credit.series);
  if (series) lines.push(series);
  return { type: "titleCard", lines, duration: 2.5 };
}

/** The skate-video credits roll. Null when there is nothing real to credit. */
export function buildCredits(credit: BtiCredit): { lines: string[]; duration?: number } | null {
  const lines: string[] = [];
  const shop = line(credit.shop);
  if (shop) lines.push(shop);
  const city = line(credit.city);
  if (city) lines.push(city);
  const handle = line(credit.handle);
  if (handle) lines.push(handle);
  for (const extra of credit.creditLines || []) {
    const l = line(extra);
    if (l) lines.push(l);
  }
  return lines.length ? { lines } : null;
}

/**
 * The NOW PLAYING flash. Only when a real track is named — an invented song
 * credit is a false attribution, not a stylistic flourish.
 */
export function buildNowPlaying(
  credit: BtiCredit,
  at = 3,
): Array<{ at: number; duration: number; lines: string[] }> | null {
  const title = line(credit.songTitle);
  if (!title) return null;
  const lines = ["NOW PLAYING"];
  const series = line(credit.series);
  if (series) lines.push(series);
  lines.push(title);
  const artist = line(credit.songArtist);
  if (artist) lines.push(artist);
  return [{ at, duration: 4, lines }];
}

export interface TreatmentScene {
  type?: string;
  lines?: string[];
  duration?: number;
  lowerThird?: { lines: string[]; duration: number };
  [k: string]: unknown;
}

export interface TreatmentResult {
  /** Scenes after the treatment's additions (title card, lower third). */
  scenes: TreatmentScene[];
  /** Blueprint-level fields to merge in (credits, nowPlaying, endCard extras). */
  blueprint: Record<string, unknown>;
}

/**
 * Apply a treatment to a planned scene list.
 *
 * `organic` and `ad` are pass-throughs at the scene level — an ad must not
 * carry episode furniture, and the house cut never did. Only `bti` decorates.
 */
export function applyTreatment(
  treatment: CastTreatment,
  scenes: TreatmentScene[],
  credit: BtiCredit = {},
): TreatmentResult {
  if (treatment !== "bti") return { scenes, blueprint: {} };

  // OPEN ON THE FOOTAGE. The cut used to start on a black title card and end
  // on a black credits roll + QR screen, so the first and last thing anyone
  // saw was a blank screen — on a 9:16 feed that is the whole thumbnail and
  // the whole scroll-past moment. Owner: "remove black beginning and end,
  // just start with image video still." The episode furniture now rides OVER
  // the footage instead of interrupting it.
  const out: TreatmentScene[] = [...scenes];

  // The shop credit rides the FIRST clip. Once only: a credit re-appearing
  // every scene reads as a broken render, not a style.
  const lowerThird = buildLowerThird(credit);
  if (lowerThird && out[0]) out[0] = { ...out[0], lowerThird };

  const blueprint: Record<string, unknown> = {};

  // The names that used to fill the black credits card are now a bottom
  // crawl over the picture (worker: tickerFilters).
  const ticker = buildTicker(credit);
  if (ticker) blueprint.ticker = ticker;

  const nowPlaying = buildNowPlaying(credit);
  if (nowPlaying) blueprint.nowPlaying = nowPlaying;

  // No endCard: that is the black QR screen the owner asked to remove. The
  // submission URL still travels on the artifact for the caption.
  blueprint.suppressEndCard = true;

  return { scenes: out, blueprint };
}

export interface TickerSpec {
  label: string;
  names: string[];
  cycleSeconds: number;
}

/**
 * The bottom crawl. Built from the SAME real strings the credits roll used —
 * the shop, its city/handle, and any extra credit lines typed by a human.
 * Nothing invented; no names means no ticker at all.
 */
export function buildTicker(credit: BtiCredit): TickerSpec | null {
  const names: string[] = [];
  const shop = line(credit.shop);
  if (shop) names.push(shop);
  for (const extra of credit.creditLines || []) {
    const l = line(extra);
    if (l && !names.includes(l)) names.push(l);
  }
  if (!names.length) return null;
  return { label: "FEATURED SHOPS", names, cycleSeconds: 12 };
}

/**
 * Which formats a treatment is allowed to render into.
 *
 * An ad in 9:16 competes with organic Reels for the same placement and wastes
 * feed real estate; BTI in 4:5 crops the lower third. Keeping this explicit
 * stops the picker offering combinations that produce bad output.
 */
export const TREATMENT_FORMATS: Record<CastTreatment, string[]> = {
  organic: ["reel", "story", "short", "longform"],
  bti: ["short", "longform", "reel"],
  ad: ["ad_feed", "ad_square", "reel"],
};

export function formatsFor(treatment: CastTreatment): string[] {
  return TREATMENT_FORMATS[treatment] || TREATMENT_FORMATS.organic;
}
