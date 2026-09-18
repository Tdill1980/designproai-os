/**
 * RECOVERING BATCH DESIGNS THAT WERE GENERATED AND NEVER PUBLISHED.
 *
 * Owner, 2026-09-18: "The library should be recovering the WallPro batch
 * generator designs." She is right, and the rows prove it.
 *
 * MEASURED in designproai-os-prod: `wallpro_designs` holds 0 rows and
 * `wallpro-files` has no `catalog/` prefix at all — so the batch generator has
 * never published one design here. But `wallpro_generations` holds 32 COMPLETED
 * generations with artwork, and thirteen of them are unmistakably batch runs:
 * no `wallPath`, `intent: "prompt"`, editorial commercial briefs, all at the
 * batch's own 144x96 (one 96x96), produced 2026-09-14 and 2026-09-16.
 *
 * The artwork was made, paid for and stored. Only the publish step never ran,
 * so the catalog read (`is_active AND approval_status = 'approved'`) had
 * nothing to return and the storefront showed "No ready-to-sell designs are
 * published yet". THE DESIGNS WERE NEVER LOST — they were never registered.
 *
 * This module is the pure half of getting them registered: which generations
 * are recoverable, what DesignID each should take, and what catalog entry to
 * build from what the generation already recorded. The impure half (copying
 * the master into `catalog/`, hashing it, writing the row) goes through the
 * EXISTING `publishWallDesign` in the batch admin — recovery is a new way to
 * reach the one publish door, never a second one.
 *
 * TWO DELIBERATE CONSERVATISMS:
 *
 * 1. Recovery always publishes as a MURAL. A repeat may only be published with
 *    a verified seam (`designUpsertRow` refuses otherwise, and rightly), and a
 *    recovered generation carries no seam receipt because the ladder ran in a
 *    browser session that is long gone. Re-running the ladder is a real option
 *    later; claiming a seam we never measured is not.
 * 2. The industry is INFERRED and shown to the curator, never silently
 *    trusted. A wrong industry is a filter mistake, not a wrong design, so the
 *    cost of being approximately right is low and the curator can correct it
 *    before publishing.
 */
import type { WallPromptEntry, WallIntensity } from '@/lib/wallpro-catalog';

/** What a recoverable generation looks like, as the batch admin reads it. */
export type RecoverableGeneration = {
  id: string;
  design_name: string | null;
  artwork_path: string;
  created_at: string;
  /** The stored request body. Only a few fields are read. */
  input: { prompt?: unknown; intent?: unknown; wallPath?: unknown; width?: unknown; height?: unknown } | null;
};

/** The DesignID prefix recovered designs take, so provenance stays legible:
 * a WPB-R id says "this came out of the recovery lane, not a library row". It
 * satisfies the table's own CHECK (`^WPB-[0-9A-Z][0-9A-Z-]{3,19}$`). */
export const RECOVERY_ID_PREFIX = 'WPB-R';

/** A recovered design is one continuous master, never a claimed repeat. */
export const RECOVERY_DESIGN_TYPE = 'Panoramic Mural';
export const RECOVERY_FALLBACK_INDUSTRY = 'Corporate Offices & Coworking';

/**
 * A batch run has no wall photo and no reference: the curator typed or
 * generated a brief and the personas designed from it alone. A customer
 * session carries `wallPath` (design for my wall), a `sourcePath` (match my
 * design) or the `refine`/`match` intent. That distinction is what separates
 * "library stock" from "somebody's private wall", and getting it wrong would
 * publish a customer's own design into a public storefront.
 */
export function looksLikeBatchRun(input: RecoverableGeneration['input']): boolean {
  if (!input || typeof input !== 'object') return false;
  if (input.wallPath) return false;
  const intent = typeof input.intent === 'string' ? input.intent : 'prompt';
  if (intent !== 'prompt') return false;
  return typeof input.prompt === 'string' && input.prompt.trim().length > 0;
}

/**
 * Completed generations that are batch runs and are not already published.
 * Newest first, because the most recent batch is the one a curator remembers.
 */
export function recoverableGenerations(
  generations: RecoverableGeneration[],
  publishedGenerationIds: Iterable<string>,
): RecoverableGeneration[] {
  const published = new Set(publishedGenerationIds);
  return generations
    .filter(g => !!g.artwork_path && !published.has(g.id) && looksLikeBatchRun(g.input))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
}

/**
 * The next free recovery DesignID. Numbering continues past whatever WPB-R ids
 * already exist rather than restarting, so a second recovery pass can never
 * collide with the first (the upsert is keyed on `design_id`, and a collision
 * would REPLACE a published design instead of adding one).
 */
export function nextRecoveryDesignId(existingIds: Iterable<string>, offset = 0): string {
  let highest = 0;
  for (const id of existingIds) {
    const match = /^WPB-R(\d+)$/.exec(id);
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return RECOVERY_ID_PREFIX + String(highest + 1 + offset).padStart(4, '0');
}

/**
 * A title a shopper can read, out of a brief written for a design model.
 *
 * The stored `design_name` is the brief truncated at the column width, so it
 * ends mid-word ("...clean f"). The first clause before an em dash is almost
 * always the subject ("Layered mountain range silhouettes"), which is exactly
 * what a catalog tile wants. Falls back through the prompt, then to a plain
 * label — never to an empty string, which `designUpsertRow` refuses.
 */
export function recoveryTitle(designName: string | null, prompt?: string | null): string {
  const source = (designName || prompt || '').trim();
  if (!source) return 'Recovered design';
  const clause = source.split(/\s+[—–-]\s+/)[0].split(/[.;]\s/)[0].trim();
  const chosen = clause.length >= 8 ? clause : source;
  // Drop a trailing partial word left by the column truncation.
  const capped = chosen.length <= 90 ? chosen : chosen.slice(0, 90).replace(/\s+\S*$/, '');
  const clean = capped.replace(/[,\s]+$/, '').trim();
  if (!clean) return 'Recovered design';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

/**
 * INDUSTRY, INFERRED FROM THE BRIEF'S OWN WORDS.
 *
 * Every key here is an exact `industry` value from the 500-row library, so an
 * inferred design lands in a filter group the storefront already offers rather
 * than inventing a thirty-first one. Order matters: the first match wins, so
 * the specific terms sit above the general ones ("gym" before "office").
 */
const INDUSTRY_WORDS: [RegExp, string][] = [
  [/\b(gym|fitness|weight|barbell|crossfit|beast mode|workout|athletic|performance training)\b/i, 'Gyms & Performance Fitness'],
  [/\b(yoga|pilates|barre)\b/i, 'Yoga, Pilates & Boutique Fitness'],
  [/\b(spa|wellness|sauna|massage)\b/i, 'Spas & Wellness'],
  [/\b(salon|barber|nail|stylist)\b/i, 'Salons, Barbers & Nail Studios'],
  [/\b(restaurant|dining|bistro|kitchen|menu)\b/i, 'Restaurants & Dining'],
  [/\b(cafe|coffee|espresso|roaster)\b/i, 'Cafes & Coffee Shops'],
  [/\b(bar|lounge|brewery|cocktail|taproom)\b/i, 'Bars, Lounges & Breweries'],
  [/\b(hotel|resort|lobby|suite)\b/i, 'Hotels & Resorts'],
  [/\b(clinic|dental|medical|healthcare|patient)\b/i, 'Medical, Dental & Healthcare'],
  [/\b(retail|boutique|storefront|merchandis)\w*/i, 'Retail & Boutiques'],
  [/\b(school|university|classroom|campus|learning)\b/i, 'Schools, Universities & Learning'],
  [/\b(nursery|kids|children|playroom|teen)\b/i, 'Nursery, Kids & Teen Residential'],
  [/\b(bedroom|living room|dining room|hallway|homeowner|residential home)\b/i, 'Homeowner Residential'],
  [/\b(tech|saas|startup|innovation|data visuali|network|global business)\w*/i, 'Tech, SaaS & Innovation Spaces'],
  [/\b(warehouse|industrial|manufactur|factory)\w*/i, 'Manufacturing, Warehouse & Industrial'],
  [/\b(dealership|automotive|wrap shop)\b/i, 'Automotive, Dealerships & Wrap Shops'],
  [/\b(office|corporate|coworking|boardroom|conference)\b/i, 'Corporate Offices & Coworking'],
];

export function inferIndustry(text: string | null | undefined): string {
  const haystack = (text || '').trim();
  if (!haystack) return RECOVERY_FALLBACK_INDUSTRY;
  for (const [pattern, industry] of INDUSTRY_WORDS) if (pattern.test(haystack)) return industry;
  return RECOVERY_FALLBACK_INDUSTRY;
}

/** Residential industries are B2C; everything else is a business buying a wall. */
const RESIDENTIAL = new Set([
  'Homeowner Residential', 'Nursery, Kids & Teen Residential', 'Multifamily & Apartments', 'Home Builders & Model Homes',
]);
export function segmentForIndustry(industry: string): 'B2B' | 'B2C' {
  return RESIDENTIAL.has(industry) ? 'B2C' : 'B2B';
}

/**
 * The catalog entry for a recovered generation. `overrides` is whatever the
 * curator edited on the card; everything else is derived from what the
 * generation already recorded, so an untouched card still publishes something
 * accurate.
 */
export function recoveryEntry(
  generation: Pick<RecoverableGeneration, 'design_name' | 'input'>,
  designId: string,
  overrides: Partial<Pick<WallPromptEntry, 'title' | 'industry' | 'intensity' | 'designType' | 'tags'>> = {},
): WallPromptEntry {
  const prompt = typeof generation.input?.prompt === 'string' ? generation.input.prompt : '';
  const title = (overrides.title ?? recoveryTitle(generation.design_name, prompt)).trim();
  const industry = overrides.industry ?? inferIndustry(generation.design_name || prompt);
  return {
    id: designId,
    segment: segmentForIndustry(industry),
    industry,
    room: '',
    title: title || 'Recovered design',
    designType: overrides.designType ?? RECOVERY_DESIGN_TYPE,
    style: '',
    palette: '',
    intensity: (overrides.intensity ?? 'Statement') as WallIntensity,
    // THE ORIGINAL BRIEF IS THE PROMPT, VERBATIM. It is the provenance of these
    // pixels and what a reprint or a "more like this" would re-run; rewriting
    // it into a tidier sentence would make the row describe a design nobody
    // generated.
    prompt: prompt || (generation.design_name || 'Recovered design'),
    tags: overrides.tags ?? ['recovered'],
    brief: 'natural',
  };
}
