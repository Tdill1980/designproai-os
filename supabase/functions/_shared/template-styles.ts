/**
 * template-styles.ts — the LAYOUT half of a template.
 *
 * `brand-visuals.ts` says what a brand looks like (palette, type, logo, art
 * direction). This says what a LAYOUT is (grid, us-vs-them, editorial…).
 * Generating a template = one brand identity × one layout × one canvas size.
 *
 * These templates are not finished posts — they are BLANKS the rest of the
 * pipeline fills. `content-studio-ai-copy` in `rewrite_template_image` mode
 * swaps the text and keeps the design, so every layout here MUST be generated
 * with realistic placeholder copy sitting in clearly separated text zones. A
 * "template" with no text zones has nothing to rewrite and is useless
 * downstream — that is the single most important rule in this file.
 *
 * Adding a style: add an entry. The generator, the UI picker and the library
 * folders all read from here, so nothing else needs editing.
 */

/** Which `canva-templates/{brand}/{type}` folder a generated template lands in. */
export type TemplateFolderType =
  | "static-4x5" | "static-1x1" | "static-9x16" | "static-16x9"
  | "carousel" | "story" | "reel";

export interface TemplateStyle {
  key: string;
  label: string;
  /** One line for the picker — what this layout is FOR. */
  purpose: string;
  /** Library folder the output belongs in. */
  folder: TemplateFolderType;
  /** Canvas aspect handed to the image model. */
  aspect: "1:1" | "4:5" | "9:16" | "16:9";
  /** How many slides to generate. >1 makes a numbered set (carousels). */
  slides: number;
  /**
   * The layout instruction. Describes STRUCTURE and the text zones — never
   * the brand's colours or type, which come from brand-visuals.
   */
  layout: string;
}

export const TEMPLATE_STYLES: TemplateStyle[] = [
  {
    key: "grid",
    label: "Grid",
    purpose: "Multi-cell showcase — several shots or points in one frame.",
    folder: "static-4x5",
    aspect: "4:5",
    slides: 1,
    layout:
      "A clean GRID layout: a 2x2 or 3x2 arrangement of equal image cells with " +
      "consistent gutters filling most of the canvas. A single bold headline bar " +
      "across the TOP (placeholder: a short 3-5 word all-caps headline) and a thin " +
      "footer strip at the BOTTOM holding the brand wordmark plus one short CTA " +
      "line. Each cell contains a distinct placeholder photo. Zones must be " +
      "rectangular and obviously separate.",
  },
  {
    key: "us-vs-them",
    label: "Us vs Them",
    purpose: "Side-by-side comparison — the old way against your way.",
    folder: "static-4x5",
    aspect: "4:5",
    slides: 1,
    layout:
      "A SPLIT comparison layout, divided down the middle by a hard vertical " +
      "line. LEFT column is the negative side (muted/desaturated) with a short " +
      "all-caps label at its top (placeholder: 'THE OLD WAY') and 3 short bullet " +
      "lines beneath it. RIGHT column is the positive side (full brand colour) " +
      "with its own short all-caps label (placeholder: 'WITH US') and 3 matching " +
      "bullet lines. One headline spans the very top above both columns, and the " +
      "brand wordmark plus CTA sits centred at the bottom. Both columns must be " +
      "the same width with clearly readable, separate text lines.",
  },
  {
    key: "carousel",
    label: "Carousel set",
    purpose: "A swipeable multi-slide set — hook, points, then the CTA.",
    folder: "carousel",
    aspect: "4:5",
    slides: 5,
    layout:
      "One slide of a swipeable carousel SET, in a consistent system across " +
      "slides: the same margins, the same headline position (upper third), the " +
      "same footer. Slide 1 is the HOOK — one huge all-caps headline, minimal " +
      "else. Middle slides each carry a short numbered heading plus 1-2 lines of " +
      "supporting text and one supporting image area. The final slide is the CTA " +
      "— a short call to action and the brand wordmark, large. A small slide " +
      "number sits in a consistent corner. Leave generous empty space; these get " +
      "rewritten.",
  },
  {
    key: "editorial",
    label: "Editorial",
    purpose: "Magazine-style feature — image-led, considered, unhurried.",
    folder: "static-4x5",
    aspect: "4:5",
    slides: 1,
    layout:
      "A MAGAZINE editorial layout: one large hero image occupying the top two " +
      "thirds, bleeding to the edges. Beneath it a generous white margin holding " +
      "a serif-feeling headline (placeholder: a 4-7 word feature title), a short " +
      "standfirst line under it, and a small credit/issue line at the very bottom. " +
      "Restrained, lots of breathing room, one accent rule. No badges, no stickers.",
  },
  {
    key: "google-ad",
    label: "Google display ad",
    purpose: "Paid display unit — one claim, one CTA button.",
    folder: "static-1x1",
    aspect: "1:1",
    slides: 1,
    layout:
      "A tight DISPLAY AD unit: product/vehicle image on one half, a solid colour " +
      "panel on the other holding a short all-caps headline (3-6 words), one line " +
      "of supporting text, and a clearly drawn rounded CTA BUTTON with a 2-3 word " +
      "label. Brand wordmark small in a corner. Everything must remain legible at " +
      "thumbnail size — no small print, no clutter.",
  },
  {
    key: "newsletter",
    label: "Newsletter header",
    purpose: "Email banner — issue title and one hero image.",
    folder: "static-16x9",
    aspect: "16:9",
    slides: 1,
    layout:
      "A wide EMAIL HEADER banner: the brand wordmark centred or left at the top, " +
      "a short issue/section title beneath it (placeholder: 4-6 words), one hero " +
      "image band filling the lower portion, and a thin accent rule separating " +
      "header from image. Simple and horizontal — it renders small in inboxes.",
  },
  {
    key: "quote",
    label: "Quote card",
    purpose: "A single strong line, attributed — social proof or a hook.",
    folder: "static-1x1",
    aspect: "1:1",
    slides: 1,
    layout:
      "A QUOTE card: one large centred quotation (placeholder: a short 8-14 word " +
      "line) as the dominant element, oversized quotation marks as a graphic " +
      "accent, a small attribution line beneath it (placeholder: a name and role), " +
      "and the brand wordmark small at the bottom. Background is a single colour " +
      "field or a heavily darkened photo so the text dominates.",
  },
  {
    key: "story",
    label: "Story / Reel cover",
    purpose: "Vertical full-screen — thumb-stopping cover frame.",
    folder: "story",
    aspect: "9:16",
    slides: 1,
    layout:
      "A vertical FULL-BLEED cover: photo fills the entire frame, a strong dark " +
      "gradient across the lower third for legibility, one huge all-caps headline " +
      "sitting in that lower third (placeholder: 3-5 words), a short supporting " +
      "line under it, and the brand wordmark at the very bottom. Keep the top " +
      "fifth clear of text — platform UI covers it.",
  },
];

export const getTemplateStyle = (key: string): TemplateStyle | undefined =>
  TEMPLATE_STYLES.find((s) => s.key === key);

/**
 * The full image-model prompt for one template blank.
 * Brand identity + layout + the placeholder-text rule that makes it reusable.
 */
export function buildTemplatePrompt(opts: {
  brandName: string;
  palette: string;
  typography: string;
  logoLockup: string;
  aesthetic: string;
  avoid: string;
  style: TemplateStyle;
  slideIndex?: number;
}): string {
  const { style } = opts;
  const slideLine = style.slides > 1 && opts.slideIndex
    ? `\nThis is SLIDE ${opts.slideIndex} of ${style.slides} in the set. Keep the ` +
      `system identical to the other slides; only the slide's role changes.`
    : "";

  return `Design a REUSABLE SOCIAL TEMPLATE for ${opts.brandName}.

LAYOUT — ${style.label}:
${style.layout}${slideLine}

BRAND IDENTITY (follow exactly):
- Palette: ${opts.palette}
- Typography: ${opts.typography}
- Logo lockup: ${opts.logoLockup}
- Art direction: ${opts.aesthetic}
- Avoid: ${opts.avoid}

THIS IS A TEMPLATE, NOT A FINISHED POST — the rules that make it reusable:
- Every text zone must contain SHORT, REALISTIC PLACEHOLDER COPY in the brand's
  voice, sized and positioned as the final copy will be. The text gets replaced
  later; the zones and the design do not.
- Text zones must be clearly SEPARATED and unmistakably text — never baked into
  the photography, never wrapped around objects, never set on an angle.
- Use invented, obviously generic placeholder details. Never write a real phone
  number, price, statistic, date or customer name.
- Keep the composition clean enough that swapping the copy cannot break it:
  generous margins, real contrast behind every line, nothing crammed.
- No watermarks, no signatures, no UI chrome, no borders around the canvas.

Output the finished template image only.`;
}
