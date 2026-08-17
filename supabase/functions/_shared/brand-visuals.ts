/**
 * brand-visuals.ts — per-brand VISUAL identity for on-brand design generation.
 *
 * The copy voice lives in brand-os.ts; this is the look. generate-brand-design
 * feeds these into Gemini image generation so every graphic is on-brand for the
 * brand it's for (colors, type, logo lockup, layout, energy).
 */

export interface BrandVisual {
  name: string;
  palette: string;        // named colors + hex the design must use
  typography: string;     // headline/body type feel
  logoLockup: string;     // how the wordmark/logo should appear
  aesthetic: string;      // overall art direction
  avoid: string;          // what NOT to do
}

export const BRAND_VISUALS: Record<string, BrandVisual> = {
  WePrintWraps: {
    name: "WePrintWraps.com",
    palette:
      "Photo-forward: a real full-bleed wrapped-vehicle / installer photo IS the " +
      "background, edge to edge. Type is white or black over the photo. Accent is " +
      "RED (#ED1C24) for banners/quote-marks or CYAN (#22D3EE) for FadeWraps. The " +
      "WPW logo itself is a multicolor CMYK monogram (cyan/magenta/yellow).",
    typography:
      "Headline fonts: Bebas Neue, Anton, League Spartan, or Montserrat Extra Bold " +
      "— ONE giant heavy CONDENSED sans headline in ALL CAPS, tight leading, often " +
      "with a ghost/outline echo. Subtext in Inter or Lato. Big, punchy, bold and " +
      "legible at mobile/thumbnail size.",
    logoLockup:
      "WEPRINTWRAPS.COM wordmark large along the bottom (solid white or outlined " +
      "ghost). The 'WPW' multicolor CMYK monogram may sit bottom-left. Never small.",
    aesthetic:
      "A real wrap ad, not a graphic-design template: full-bleed photo of a wrapped " +
      "car (or an installer laying vinyl) fills the frame, one giant caps headline " +
      "up top ('THIS AIN'T A PAINT JOB', 'WRAPS BUILT FOR SPEED', 'WHY RISK IT?'), " +
      "WEPRINTWRAPS.COM big at the bottom, plus a hard value stamp ('FAST 1-2 DAY " +
      "PRINT PRODUCTION', 'FROM $5.27 A SQ. FT', 'TRUSTED BY THOUSANDS OF WRAP PROS'). " +
      "Gritty, blue-collar, shop-to-shop. 'We print. You install.'",
    avoid:
      "Flat solid-color background cards with no photo, pastels, delicate script " +
      "fonts, cluttered layouts, stock-corporate blandness, tiny logos.",
  },
  RestyleProAI: {
    name: "DesignProAI",
    palette:
      "Apple-clean tech palette: deep black (#0A0A0A) or clean white base with the " +
      "signature blue→magenta gradient (#3B82F6 → #EC4899) as the accent. Lots of " +
      "negative space.",
    typography:
      "Minimal, modern geometric sans. Short declarative headlines. The 'Pro' " +
      "suffix may carry the gradient.",
    logoLockup:
      "DesignProAI wordmark — black/white base word with a gradient 'Pro'. Understated, premium.",
    aesthetic:
      "Category-defining, Apple-keynote minimalism. One idea per frame, huge type, " +
      "calm confidence. Product-UI or a clean wrapped-vehicle render as hero. This " +
      "is pre-launch narrative — aspirational and clean, not a hard-sell ad.",
    avoid: "Busy collages, clip-art, neon overload, cheesy 'AI' tropes (robots, circuit brains).",
  },
  WrapTV: {
    name: "Wrap TV World",
    palette:
      "MTV/Fuse music-TV palette: electric cyan (#22D3EE) and hot orange (#F97316) " +
      "over black, with bold pops. High energy, youth-culture.",
    typography:
      "Loud, bold, display type — graffiti/pop energy, big captions like a music-video " +
      "lower-third. Fast, punchy.",
    logoLockup: "Wrap TV World logo — the cyan/green/orange 'WTV' mark, bold.",
    aesthetic:
      "Music-video / MTV thumbnail energy. Fast cuts, motion, a wrapped car mid-reveal, " +
      "big kinetic captions, culture-first. 'Wrap Culture, On Camera.' Feels like a " +
      "show frame, not an ad.",
    avoid: "Corporate cleanliness, muted colors, small quiet type, editorial restraint.",
  },
  InkAndEdge: {
    name: "Ink & Edge Magazine",
    palette:
      "Editorial black & white with a single restrained accent. Rich blacks, clean " +
      "white, lots of negative space. Premium print-magazine feel.",
    typography:
      "Elegant editorial — a refined serif for headlines, clean sans for captions. " +
      "Magazine cover / feature-spread typesetting.",
    logoLockup: "Ink & Edge masthead — elegant serif wordmark, magazine-masthead placement.",
    aesthetic:
      "High-end magazine spread. Dramatic light, macro texture or a hero build shot, " +
      "generous margins, minimal type. Documents the people and projects of the wrap " +
      "industry. Feels like a printed feature, never a sales ad.",
    avoid: "Neon, hype energy, busy layouts, hard CTAs, meme fonts.",
  },
  TheWrap: {
    name: "The Wrap (weekly newsletter)",
    palette:
      "Newsletter-clean: white ground, near-black ink, one warm accent (the WPW " +
      "orange #F97316) for links/dividers. Email-safe, high contrast.",
    typography:
      "Digest typesetting — bold condensed section headers, clean readable sans body. " +
      "Feels like a smart trade morning-brew, not a promo blast.",
    logoLockup: "\"The Wrap\" wordmark — bold condensed, small 'weekly' tag.",
    aesthetic:
      "One hero image (the week's best build), scannable sections, generous whitespace, " +
      "thin hairline dividers. An email you actually read, not an ad.",
    avoid: "Promo-blast energy, coupon-clutter, multiple CTAs, dark backgrounds (email clients).",
  },
};

export function getBrandVisual(brandOsName: string): BrandVisual {
  return BRAND_VISUALS[brandOsName] || BRAND_VISUALS.WePrintWraps;
}

/** Canvas dimensions per social format. */
export const FORMAT_SPEC: Record<string, { w: number; h: number; label: string }> = {
  post: { w: 1080, h: 1350, label: "Instagram portrait post (4:5)" },
  organic: { w: 1080, h: 1350, label: "Instagram portrait post (4:5)" },
  story: { w: 1080, h: 1920, label: "vertical story/reel cover (9:16)" },
  reel: { w: 1080, h: 1920, label: "vertical reel cover (9:16)" },
  carousel: { w: 1080, h: 1350, label: "carousel slide (4:5)" },
  ad: { w: 1080, h: 1080, label: "square ad (1:1)" },
};
