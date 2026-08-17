// CHANNEL SPECS — the ONE canonical registry of every social/content
// channel the ecosystem creates for, each channel's native format sizes,
// and the per-brand channel rotation. Both the workforce agents
// (wpw-workforce-sweep drafting) and the Content Director / Video Studio
// should read from here — never hardcode sizes in prompts or templates.
//
// publish: "auto" = content-deploy (or Klaviyo/WP) publishes approved+
// scheduled items itself. "draft" = agents draft to spec; a human posts
// manually (no API publisher wired yet). Human-readable version:
// docs/CHANNEL_MATRIX.md

export type ChannelFormat = {
  format: string;            // reel | static | carousel | ad | long_form | short | text | article
  size: string;              // pixel dims or aspect
  limit?: string;            // copy/duration constraint that matters
};

export type ChannelSpec = {
  key: string;               // platform key stored on drafts
  label: string;
  publish: "auto" | "draft";
  formats: ChannelFormat[];
  notes?: string;
};

export const CHANNEL_SPECS: ChannelSpec[] = [
  {
    // OUR OWN platform (/feed) — first-party, no external API, engagement
    // flows straight into SocialIQ. Published by content-deploy 'wrapfeed'.
    key: "wrapfeed", label: "The Feed (our own platform)", publish: "auto",
    formats: [
      { format: "static", size: "1080x1350 (4:5) or 16:9 render", limit: "caption free-length; first 200 chars carry" },
    ],
  },
  {
    key: "instagram", label: "Instagram (feed/static + carousel)", publish: "auto",
    formats: [
      { format: "static", size: "1080x1350 (4:5)", limit: "caption ≤2,200 chars, first 125 visible" },
      { format: "carousel", size: "1080x1350 per slide, ≤10 slides" },
      { format: "ad", size: "1080x1350 or 1080x1080", limit: "primary text ≤125 chars best" },
    ],
  },
  {
    key: "instagram_reels", label: "Instagram Reels", publish: "auto",
    formats: [{ format: "reel", size: "1080x1920 (9:16)", limit: "7-30s sweet spot, hook in first 2s" }],
  },
  {
    key: "facebook", label: "Facebook (organic + ads)", publish: "auto",
    formats: [
      { format: "static", size: "1200x630 link / 1080x1350 feed" },
      { format: "reel", size: "1080x1920 (9:16)" },
      { format: "ad", size: "1080x1080 (1:1)", limit: "primary text ≤125 chars, headline ≤40" },
    ],
  },
  {
    key: "x", label: "X (Twitter)", publish: "draft",
    formats: [
      { format: "text", size: "n/a", limit: "≤280 chars, threads for education" },
      { format: "static", size: "1600x900 (16:9)" },
      { format: "short", size: "1080x1920 or 16:9", limit: "≤2:20 video" },
    ],
  },
  {
    key: "linkedin", label: "LinkedIn (WPW company + Trish founder)", publish: "draft",
    formats: [
      { format: "text", size: "n/a", limit: "first 200 chars before fold; 1,300-2,000 ideal" },
      { format: "static", size: "1200x627" },
      { format: "carousel", size: "1080x1350 PDF doc post" },
    ],
  },
  {
    key: "pinterest", label: "Pinterest", publish: "draft",
    formats: [{ format: "static", size: "1000x1500 (2:3)", limit: "title ≤100, desc ≤500" }],
    notes: "Design inspiration + before/after boards; evergreen search traffic",
  },
  {
    key: "youtube", label: "YouTube long-form", publish: "draft",
    formats: [
      { format: "long_form", size: "3840x2160 or 1920x1080 (16:9)", limit: "title ≤70 chars, chapters required" },
      { format: "static", size: "1280x720 thumbnail", limit: "face + ≤4 words" },
    ],
    notes: "WrapTVWorld shows (Behind Shop Doors documentary, Behind the Install mashups, tutorials)",
  },
  {
    key: "youtube_shorts", label: "YouTube Shorts", publish: "draft",
    formats: [{ format: "short", size: "1080x1920 (9:16)", limit: "≤60s, loopable" }],
  },
  {
    key: "substack", label: "Substack (long-form editorial)", publish: "draft",
    formats: [{ format: "article", size: "1456x1048 header", limit: "Ink & Edge / The Wrap long-form" }],
  },
  {
    key: "founder", label: "Trish Founder (personal X + LinkedIn)", publish: "draft",
    formats: [{ format: "text", size: "per host platform", limit: "first-person, platform-update / behind-the-build voice" }],
    notes: "Founder story content — never brand-account voice",
  },
  {
    key: "blog", label: "Blog (WPW WordPress via SEO system)", publish: "auto",
    formats: [{ format: "article", size: "1200x675 featured image", limit: "700+ words, h2/h3 sections, no h1, focus keyword" }],
    notes: "Drafts into seo_blog_posts → review → seo-wp-publish",
  },
  {
    key: "website_update", label: "Website updates (copy/section refresh)", publish: "draft",
    formats: [{ format: "text", size: "per page section", limit: "WHITE UI standard on customer pages" }],
    notes: "Agent drafts the copy + placement; a human applies it",
  },
  {
    key: "landing_page", label: "Landing pages (per brand/campaign)", publish: "draft",
    formats: [
      { format: "article", size: "full page", limit: "hero ≤8 words, one CTA above fold, WHITE UI standard" },
      { format: "static", size: "1200x630 OG image" },
    ],
    notes: "Per-campaign LPs (giveaways, launches, Wrap Of The Week hub)",
  },
];

// Per-brand channel rotation — which channels each brand actively feeds.
// Weekly cadence lives in _shared/content-programming.ts (the Director's
// grid); this is the brand ↔ channel membership it draws from.
export const BRAND_CHANNEL_ROTATION: Record<string, string[]> = {
  weprintwraps: ["wrapfeed", "instagram", "instagram_reels", "facebook", "x", "linkedin", "pinterest", "youtube_shorts", "blog", "website_update", "landing_page"],
  wraptvworld: ["wrapfeed", "youtube", "youtube_shorts", "instagram", "instagram_reels", "facebook", "x", "website_update"],
  designproai: ["wrapfeed", "instagram", "instagram_reels", "x", "linkedin", "youtube", "youtube_shorts", "facebook", "blog", "landing_page"],
  restylepro: ["wrapfeed", "instagram", "facebook", "x", "linkedin", "blog", "website_update"],
  inkandedge: ["blog", "pinterest", "linkedin", "x", "instagram"],
  thewrap: ["substack", "linkedin", "x"],
  founder: ["founder", "linkedin", "x"],
};

// Per-brand web properties — BLOG IS PER BRAND (each domain has its own),
// and the three sites cross-backlink for SEO authority. Every blog draft
// includes 1-2 natural contextual links to SIBLING domains in the ring
// (never a self-link, never forced).
export const BRAND_WEB_PROPERTIES: Record<string, { domain: string; blog: boolean }> = {
  weprintwraps: { domain: "weprintwraps.com", blog: true },
  inkandedge: { domain: "inkandedge.com", blog: true },
  restylepro: { domain: "restyleproai.com", blog: true },
  designproai: { domain: "restyleproai.com", blog: true },
  wraptvworld: { domain: "weprintwraps.com", blog: false },
};

export const SEO_BACKLINK_RING = ["weprintwraps.com", "inkandedge.com", "restyleproai.com"];

// Brand hierarchy — the repurposing order. One story is retold per brand
// in its own voice (consistent message, never identical copy). DesignProAI
// (the category-defining SaaS) is the TOP brand: flagship launches and
// product stories lead there, then cascade down.
// CONTENT DERIVATION — where every piece originates (the source spine).
// Nothing is invented from nothing; content DERIVES from these, in order:
export const CONTENT_DERIVATION = [
  "youtube",        // long-form episodes/tutorials (WrapTVWorld) — the master source
  "video",          // parsed shoot footage: installer action + verbal hooks (the library)
  "magazine",       // Ink & Edge features/articles — the editorial spine
  "pillars",        // the education pillars (masterclass topics)
  "trish",          // founder voice — platform updates, vision, DesignProAI story
];

// PRIMARY BRAND — DesignProAI leads everything. Flagship stories start on
// DesignProAI and cascade; when in doubt, the DesignProAI angle wins.
export const PRIMARY_BRAND = "designproai";

export const BRAND_HIERARCHY = [
  "designproai",   // #1 — groundbreaking Prompt-to-Print SaaS; product voice
  "weprintwraps",  // #2 — the print house; shop/production voice, biggest list
  "wraptvworld",   // #3 — media/education channel; show + culture voice
  "restylepro",    // #4 — platform/visualizer; founder-story + system voice
  "inkandedge",    // #5 — editorial prestige; magazine voice
  "thewrap",       // #6 — newsletter digest of what shipped
];

// Special recurring slots (formats ride the host channel's specs)
export const RECURRING_SLOTS = [
  {
    name: "Wrap Of The Week", brand: "weprintwraps",
    channels: ["instagram", "facebook", "youtube_shorts", "email"], cadence: "weekly-wednesday",
    rules: [
      "ALWAYS posted and emailed on WEDNESDAY",
      "MUST mention/credit @PaintisDead in every edition",
      "Email edition uses the existing Klaviyo WOTW template — never a new layout",
      "Check CreatorMarket for same-style designs before posting; if one exists, prep the homage cross-promo (credit the lane and the install, then offer our original take)",
    ],
  },
  {
    name: "Wrap Of The Month", brand: "weprintwraps",
    channels: ["instagram", "facebook", "youtube_shorts", "email", "blog"], cadence: "monthly",
    rules: [
      "Winner chosen from the month's Wrap Of The Week features",
      "MUST mention/credit @PaintisDead",
      "Email edition rides the Klaviyo WOTW template family; blog recap cross-links the weekly winners",
    ],
  },
  { name: "Platform Update (Trish)", brand: "founder", channels: ["founder", "linkedin"], cadence: "as-shipped" },
  {
    name: "Behind Shop Doors episode", brand: "wraptvworld",
    channels: ["youtube", "instagram_reels", "youtube_shorts", "instagram", "facebook", "x", "email", "blog", "substack"],
    cadence: "per-episode",
    rules: [
      "EVERY episode ships with a full content pack: reels/shorts cut list, before/after carousel, email feature, Ink & Edge article draft, The Wrap Sheet mention, per-brand promo separates (variation doctrine)",
      "DOCUMENTARY doctrine: natural sound, lower-thirds only, NO anthem music — master episode is edited and HUMAN-APPROVED before any pack piece publishes",
      "Pack drafts may be prepared early but hold until master approval",
      "Pack channel list (minimum): X thread, Substack, WPW email, Ink & Edge article, IG Reel, WrapTVWorld Short, carousel",
      "PROMO TONE: HOOK-HEAVY and FUN — scroll-stopping opens, playful energy, heavy promotion. The documentary is serious; the promotion is NOT",
    ],
  },
  {
    name: "Behind the Install (WrapTVWorld upload)", brand: "wraptvworld",
    channels: ["youtube", "instagram_reels", "youtube_shorts", "instagram", "facebook", "x", "email"],
    cadence: "per-upload",
    rules: [
      "EVERY upload triggers a full cross-channel promo pack — every brand promotes it in its own voice",
      "House anthem music tracks live HERE (mashup format) — never in Behind Shop Doors (documentary)",
      "Promo pack = variation set per the VARIATION DOCTRINE (multiple reels/ads/stories, not one post)",
    ],
  },
  {
    name: "RecreatePro Demo Case", brand: "designproai",
    channels: ["instagram_reels", "youtube", "youtube_shorts", "instagram", "facebook", "linkedin", "blog", "email"],
    cadence: "per-case",
    rules: [
      "Truthfully labeled Demo Case / RecreatePro Challenge — NEVER framed as a real customer testimonial",
      "One recording atomizes into 9 deliverables — see docs/RECREATEPRO_DEMO_CASES.md",
      "Recordings only from the founder test account: no customer data, no admin URLs, no keys on screen",
      "Open: 'RECREATEPRO CASE 0XX — Can you recreate this design?' Close: 'AI MADE THE CONCEPT. RECREATEPRO MADE IT PRODUCIBLE.'",
    ],
  },
];

// Compact prompt block for drafting agents — keeps prompts short while
// making every draft land in its channel's native size/limit.
export function channelSpecPromptBlock(): string {
  const lines = CHANNEL_SPECS.map((c) => {
    const f = c.formats.map((x) => `${x.format} ${x.size}${x.limit ? ` (${x.limit})` : ""}`).join("; ");
    return `- ${c.key} [${c.publish}]: ${f}`;
  });
  return `CHANNEL SPECS (draft to the target channel's NATIVE format — never one-size-fits-all):\n${lines.join("\n")}\n` +
    `VARIATION DOCTRINE: every promoted story ships as a SET — multiple reels, multiple ads, multiple ` +
    `stories per channel, each with a DIFFERENT hook/angle (problem-aware / new-way / proof / education), ` +
    `all promoting the same thing. Never one piece, never duplicate copy across pieces or brands.\n` +
    `SEO RING: blogs are per-brand (weprintwraps.com, inkandedge.com, restyleproai.com); every blog post ` +
    `includes 1-2 NATURAL contextual links to sibling ring domains — never a self-link, never forced.\n` +
    `Wrap Of The Week / Wrap Of The Month: always mention @PaintisDead; email editions use the existing ` +
    `Klaviyo WOTW template, never a new layout.`;
}
