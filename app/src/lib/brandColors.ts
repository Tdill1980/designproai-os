/**
 * DesignProAI brand palette — the single source of truth for chrome accents
 * (the floating tool rails, and anything else that needs the brand look).
 *
 * These mirror the tokens documented in CLAUDE.md:
 *   - Background: pure black
 *   - Primary accent: cyan #00C7FF
 *   - Brand gradient: blue #3B82F6 -> magenta #EC4899
 *
 * Import these instead of hardcoding hexes, so a palette change is one edit.
 */
export const BRAND = {
  black: "#000000",
  cyan: "#00C7FF",
  blue: "#3B82F6",
  magenta: "#EC4899",
} as const;

/** The blue -> magenta brand gradient, used for hairlines, borders and fills. */
export const BRAND_GRADIENT = `linear-gradient(90deg, ${BRAND.blue}, ${BRAND.magenta})`;

/**
 * Rail surface. Near-black (brand background) with a faint blue wash through
 * the middle so the bar reads as chrome sitting over the page rather than as
 * another card on it.
 */
export const BRAND_RAIL_BG =
  "linear-gradient(90deg, rgba(0,0,0,0.95), rgba(10,16,38,0.95), rgba(0,0,0,0.95))";

/** Cyan glow used for the active tool pill. */
export const BRAND_ACTIVE_GLOW = `0 0 18px ${BRAND.cyan}40`;
