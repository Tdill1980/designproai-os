/**
 * brandAliases — ONE place a written brand string resolves to a canonical
 * brand key, and refuses when it cannot.
 *
 * ── THE DEFECT THIS EXISTS FOR ─────────────────────────────────────────────
 * Footage matching is an EXACT, case-insensitive brand equality —
 * `footageMatch.ts` line 142:
 *
 *     if (opts.brand && c.brand && String(c.brand).toLowerCase() !== ...) continue;
 *
 * so a piece filed under a brand string no asset carries can never match a
 * clip. Not "matches badly" — cannot match, ever, and the runner loops it as
 * `needs_footage` forever with a message that reads like a footage shortage.
 *
 * Measured on production (kfapjdyythzyvnpdeghu) 2026-08-07:
 *
 *   agent_social_posts.brand      agent_media_assets.brand
 *     restylepro              156    restylepro              549
 *     weprintwraps             83    wraptvworld             109
 *     wraptvworld              75    weprintwraps             92
 *     wraptv                    7 ←  designproai              11
 *     inkandedge                6 ←  (nothing else exists)
 *     designproai               5
 *     wraptvworld-documentary   2 ←
 *
 * Fifteen pieces on three strings, and the three are three DIFFERENT problems.
 * Telling them apart is the entire job of this module, because only one of them
 * is a spelling that can be repaired:
 *
 *   • `wraptv` — a documented ALIAS of `wraptvworld`. Repairable.
 *   • `wraptvworld-documentary` — the brand is RIGHT and a format token got
 *     appended. Repairable, but only against corroboration (see below).
 *   • `inkandedge` — NOT a mislabel at all. It is an exact canonical key in
 *     `contentDoctrine.BRANDS`. Those six pieces are filed correctly and match
 *     nothing because Ink & Edge Magazine has ZERO rows in `agent_media_assets`.
 *     That is a footage gap, and no string edit closes it. Resolving it to
 *     anything else would move six pieces onto another brand's footage to make
 *     a symptom disappear.
 *
 * ── ONE CANONICAL SET, NOT TWO ─────────────────────────────────────────────
 * The canonical brands are `contentDoctrine.BRAND_KEYS`, imported, never
 * restated. CLAUDE.md is explicit about why: "Do NOT add a second classifier or
 * duplicate these rules in SQL — they will drift", written after the asset
 * taxonomy paid for exactly that. A second brand list here would be the same
 * bug with a different noun — this module would resolve to a brand the doctrine
 * has no audience profile for, and `validatePiece`'s `unknown_brand` check
 * would start firing on strings this file called canonical.
 *
 * The format-suffix vocabulary is borrowed the same way: `CONTENT_TYPES` from
 * `assetContentType.ts` and the `SHOW_FORMATS` keys from `showFormats.ts`. Both
 * are the taxonomies the rest of the system already uses, so a token is "known"
 * here only because something real in this codebase declares it.
 *
 * ── WHY IT REFUSES INSTEAD OF GUESSING ─────────────────────────────────────
 * There is no fuzzy distance, no nearest-match, no "closest canonical brand".
 * Deliberately, and the asymmetry is the reason: an unresolved piece SITS in a
 * queue where a human can see it, and the whole reported defect is that fifteen
 * of them are sitting there visibly. A wrongly-resolved piece disappears — it
 * silently joins another brand's pool, gets cut from another brand's footage,
 * and goes out in another brand's voice with nothing anywhere recording that a
 * script decided it. `inkandedge` is one edit distance from nothing and eight
 * from `weprintwraps`; a distance threshold loose enough to be useful on real
 * typos is loose enough to reach that.
 *
 * Pure — no database, no network, no clock. Locked by tests/brand-aliases.test.ts.
 */

import { BRAND_KEYS } from "./contentDoctrine";
import { CONTENT_TYPES } from "./assetContentType";
import { SHOW_FORMATS } from "./showFormats";

/**
 * The canonical brand keys, from the doctrine. Read-only view of the one list.
 */
export const CANONICAL_BRANDS: readonly string[] = Object.freeze([...BRAND_KEYS]);

const CANONICAL = new Set<string>(CANONICAL_BRANDS);

/**
 * DOCUMENTED ALIASES — a written string that is a second spelling of a
 * canonical brand. One entry, and it earns its place by citation rather than by
 * looking like a truncation.
 *
 * `wraptv` → `wraptvworld` is asserted THREE times in this repo, by three
 * independent producers that would each be wrong if the alias were wrong:
 *
 *   1. `src/lib/content-tags.ts` — BRAND_META carries `wraptv` with the label
 *      "WrapTVWorld", the identical colour and gradient as `wraptvworld`, and
 *      the comment "alias — drafts land under both slugs".
 *   2. `src/lib/hookOverlay.ts` — BRAND_TREATMENT gives `wraptv` byte-identical
 *      hook typography to `wraptvworld`, because "the treatment must not change
 *      with the spelling".
 *   3. `worker/video-renderer/index.js` — BRAND_LOGOS maps `wraptv` and
 *      `wraptvworld` to the SAME `WTV_LOGO` asset, so a render under either
 *      spelling is stamped with the one WrapTVWorld mark.
 *
 * That is what makes it an alias rather than a truncation that happens to look
 * plausible. `wraptv` is a prefix of `wraptvworld`, but prefix-ness is not the
 * evidence and must never become the rule: `restyle` is a prefix of
 * `restylepro` and could equally be a different brand, and the platform repair
 * next door refuses `wraptv` in ITS column for precisely this reason (bare
 * `wraptv` reads as YouTube to the Brand Board and as `wraptv_site` to
 * content-deploy — genuinely ambiguous THERE, unambiguous HERE, because these
 * three citations are about the brand and not the channel).
 *
 * Adding an entry means finding citations like these. It does not mean deciding
 * two strings look similar.
 */
export const BRAND_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  wraptv: "wraptvworld",
});

/**
 * Tokens that may legally trail a canonical brand — a FORMAT or a SHOW, never
 * another brand and never a campaign name.
 *
 * Both halves are borrowed, not invented:
 *   • the `content_type` taxonomy (`CONTENT_TYPES`), minus `unclassified` —
 *     that one is the honest-gap marker, and "brand-unclassified" would be a
 *     string saying nothing was known, not a format.
 *   • the show keys declared in `SHOW_FORMATS` (behind_the_brand,
 *     behind_shop_doors, behind_the_install).
 *
 * A token outside this set is REFUSED rather than stripped. `wraptvworld-q3`,
 * `wraptvworld-houdini`, `wraptvworld-v2` all keep their whole string, because
 * a trailing word that names a campaign, a customer or a revision is not
 * evidence that the brand is the prefix — it is equally evidence that somebody
 * created a separate lane on purpose.
 */
export const FORMAT_SUFFIX_TOKENS: readonly string[] = Object.freeze([
  ...CONTENT_TYPES.map((c) => c.key).filter((k) => k !== "unclassified"),
  ...SHOW_FORMATS.map((f) => f.key),
]);

const SUFFIXES = new Set<string>(FORMAT_SUFFIX_TOKENS);

/** The characters that may join a brand to a format token. */
const SEPARATORS = ["-", "_", " ", "/", ":"];

export type BrandResolutionKind =
  /** The string is already a canonical brand key. Nothing to repair. */
  | "exact"
  /** A documented second spelling — see BRAND_ALIASES. */
  | "alias"
  /** `<canonical brand><sep><known format token>`. */
  | "brand_with_format_suffix"
  /** Nothing here decides it. The string is reported, never rewritten. */
  | "unresolved";

export interface BrandResolution {
  /** The canonical brand, or null when unresolved. */
  brand: string | null;
  kind: BrandResolutionKind;
  /**
   * WHY — always set, for a resolution and a refusal alike. A refusal without a
   * reason is the thing a human cannot act on, and acting on these is the point.
   */
  why: string;
  /** The token stripped, on a suffix resolution only. */
  suffix?: string;
  /**
   * True when the resolution CHANGES the string. `exact` resolves and changes
   * nothing; callers that only care about writes read this rather than
   * re-deriving the comparison and getting it subtly different.
   */
  changed: boolean;
}

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Is this string, as written, one of the doctrine's canonical brand keys? */
export function isCanonicalBrand(value: unknown): boolean {
  return CANONICAL.has(normalize(value));
}

/**
 * Split `value` into a canonical brand prefix and a remainder, or null.
 *
 * Requires a SEPARATOR after the brand, which is what keeps `wraptvworld` from
 * being read as `wraptv` + `world`. Requires exactly ONE canonical prefix to
 * match: two would mean the answer depends on which was tried first, and a
 * result that depends on iteration order is a guess wearing a rule's clothes.
 */
function splitOnCanonicalPrefix(value: string): { brand: string; rest: string } | null {
  const hits: Array<{ brand: string; rest: string }> = [];
  for (const brand of CANONICAL_BRANDS) {
    if (!value.startsWith(brand) || value.length <= brand.length) continue;
    const sep = value[brand.length];
    if (!SEPARATORS.includes(sep)) continue;
    hits.push({ brand, rest: value.slice(brand.length + 1) });
  }
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Resolve ONE written brand string to a canonical brand key.
 *
 * Never throws — a null, a number, or an object yields an honest `unresolved`,
 * because a resolver that dies on one malformed row makes a whole repair pass
 * abandon rows it could have reported.
 *
 * The order below IS the policy, strongest evidence first, and every branch
 * either cites something or refuses.
 */
export function resolveBrand(value: unknown): BrandResolution {
  const raw = normalize(value);

  if (!raw) {
    return {
      brand: null,
      kind: "unresolved",
      changed: false,
      why: "brand is empty — there is no string to resolve, and nothing may be filled in on its behalf.",
    };
  }

  // 1. EXACT. Already canonical. This is not a repair opportunity and must not
  //    be treated as one — see `inkandedge` in the header. A brand that is
  //    spelled correctly and still matches no footage has a footage problem.
  if (CANONICAL.has(raw)) {
    return {
      brand: raw,
      kind: "exact",
      changed: false,
      why: `"${raw}" is already a canonical brand in contentDoctrine.BRANDS — nothing to repair. If it matches no footage, the gap is in the asset library, not in this string.`,
    };
  }

  // 2. DOCUMENTED ALIAS. Cited in BRAND_ALIASES, not inferred from shape.
  const alias = BRAND_ALIASES[raw];
  if (alias) {
    return {
      brand: alias,
      kind: "alias",
      changed: true,
      why: `"${raw}" is a documented alias of "${alias}" — content-tags.ts labels it "WrapTVWorld" with the identical brand colour, hookOverlay.ts gives it byte-identical hook typography, and the video renderer stamps it with the same WTV logo. Three producers already treat the two spellings as one brand.`,
    };
  }

  // 3. BRAND + FORMAT SUFFIX. The brand is correct and something was appended.
  const split = splitOnCanonicalPrefix(raw);
  if (split) {
    if (SUFFIXES.has(split.rest)) {
      return {
        brand: split.brand,
        kind: "brand_with_format_suffix",
        changed: true,
        suffix: split.rest,
        why: `"${raw}" is the canonical brand "${split.brand}" with the known format token "${split.rest}" appended (declared in the content_type taxonomy / SHOW_FORMATS). The brand is right; a format leaked into the brand column.`,
      };
    }
    return {
      brand: null,
      kind: "unresolved",
      changed: false,
      why: `"${raw}" begins with the canonical brand "${split.brand}", but "${split.rest}" is not a known format or show token. A trailing word that names a campaign, a customer or a revision is not evidence the brand is the prefix — it is equally evidence someone created a separate lane deliberately. REFUSED.`,
    };
  }

  // 4. AN ALIAS WITH A SUFFIX is refused on purpose. Resolving it would stack
  //    two inferences on one string, and each is only as good as the other; the
  //    conservative answer costs nothing here because no such value exists in
  //    production. If one ever appears, a human decides and the citation gets
  //    written down.
  for (const [aliasKey, target] of Object.entries(BRAND_ALIASES)) {
    if (raw.startsWith(aliasKey) && SEPARATORS.includes(raw[aliasKey.length] ?? "")) {
      return {
        brand: null,
        kind: "unresolved",
        changed: false,
        why: `"${raw}" looks like the alias "${aliasKey}" (→ ${target}) with something appended. Resolving an alias AND a suffix in one step compounds two inferences — REFUSED; a human decides this one.`,
      };
    }
  }

  // 5. Everything else. No nearest-match, no edit distance, no most-common
  //    brand. The string is reported and left exactly as written.
  return {
    brand: null,
    kind: "unresolved",
    changed: false,
    why: `"${raw}" is not a canonical brand, not a documented alias, and not a canonical brand with a known format suffix. Unrecognised brand strings are reported, never rewritten — a wrong brand routes a piece to another brand's footage, which is worse than one that sits unrouted where somebody can see it.`,
  };
}

/**
 * The brand a caller should USE for this string, or null.
 *
 * Convenience over `resolveBrand` for read paths (a picker, a filter) that want
 * the canonical key and have nowhere to show a reason. Write paths must use
 * `resolveBrand` and surface `why` — a repair that cannot say why is the thing
 * this module exists to prevent.
 */
export function canonicalBrandOrNull(value: unknown): string | null {
  return resolveBrand(value).brand;
}

/**
 * Do these two strings name the same brand?
 *
 * For the gates that compare a piece's brand against an asset's brand. Written
 * as its own function rather than left to each caller, because the callers that
 * got this wrong got it wrong the same way — `a.toLowerCase() !== b.toLowerCase()`,
 * which reads as careful and still cannot see that `wraptv` and `wraptvworld`
 * are one brand.
 *
 * UNRESOLVABLE IS NOT EQUAL. If either side resolves to null the answer is
 * false, even when the raw strings are identical. Two pieces filed under the
 * same unrecognised spelling are not evidence that the spelling is a brand —
 * treating them as a match would let an unknown string quietly behave like a
 * real brand, which is how the bad spellings survived long enough to strand
 * nine pieces in the first place. `resolveBrand` is where a new brand gets
 * admitted; this function only reads the answer.
 */
export function sameBrand(a: unknown, b: unknown): boolean {
  const left = canonicalBrandOrNull(a);
  if (!left) return false;
  return left === canonicalBrandOrNull(b);
}
