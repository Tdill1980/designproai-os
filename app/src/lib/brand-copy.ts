/**
 * brand-copy.ts — Single source of truth for RestyleProAI™ and WePrintWraps brand positioning.
 * Used by ContentStudio, Marketing Hub, MightyMail, and edge functions.
 *
 * Server-side mirror: supabase/functions/_shared/brand-os.ts (Deno functions
 * can't import this file). If positioning changes, update BOTH files.
 */

// ── THE CHIEF AIM ──────────────────────────────────────────────────
// The strategic spine of all DesignProAI / RestyleProAI content. Every
// generated piece must serve this positioning.
export const CHIEF_AIM = {
  statement:
    "DesignPro is a CATEGORY, not a feature — design to file output, automatically, via an AI-hybrid deterministic system.",
  goal:
    'People say "throw it in DesignPro" the way they say "throw it in Photoshop" — and it changes how wide-format design + print works.',
  pipeline:
    "Prompt (or uploaded design/proof) → approved design → print-ready production files. No manual Canva or Photoshop step.",
  output:
    "One prompt in, a complete print-ready production pack out: true-size panels, production pack, dimensioned production proof, customer 2D proof, photorealistic 3D proof set, and a QC sign-off page — same design across every view, automatically.",
  contentRules: [
    "Talk about the OUTPUT (print-ready production files), not just pretty renders.",
    '"Design to file output, automatically" is the category claim — use it.',
    "Position against the old way: hand-building panels in Canva/Photoshop, $500–$1,000 outsourced mockups, 3–5 business day turnarounds.",
    "DesignPro is the flagship that defines the category; the other tools feed the same design-to-production chain.",
  ],
} as const;

// ── BRAND IDENTITY ─────────────────────────────────────────────────
export const BRAND_IDENTITY = {
  RestyleProAI: {
    tagline: "Design. Output. Profit.",
    positioning: "RestyleProAI™ is a Design-to-Production and Marketing Engine built for sign, wrap, tint, and restyle shops.",
    description: "It gives you the ability to create high-end custom designs, move them into production, and generate profit—all from one streamlined system. Whether you're branding commercial vehicles, restyling cars, installing tint, or running a full sign operation—RestyleProAI™ adapts to how your shop operates. It's modular—so you can use it for design and production, or run a complete system with CMS and marketing built in. Every account includes PrintPro™, your verified wholesale print partner—so you're never limited by production capacity.",
    pillars: [
      { name: "DesignPro™", role: "High-end design", description: "Engineered to think and create like a designer. Takes your direction and turns it into high-end, intentional design. The more detail you provide, the more refined the result." },
      { name: "ProductionFlow™", role: "Real output", description: "Connects design directly to output. No disconnect. No guesswork. From concept to print—everything stays aligned." },
      { name: "MightyMail™", role: "Ongoing demand", description: "Your list isn't just a list. It's parsed, segmented, and activated—so you're retargeting your audience with content that inspires, educates, and keeps you top of mind." },
      { name: "PrintPro™", role: "Production support", description: "Your verified wholesale print partner. Whether you don't offer wraps yet, you're overloaded, or something breaks—you're still able to deliver." },
    ],
    tone: "Premium, professional, confident. Speaks from real shop experience. Not AI hype—real systems that solve real problems. Direct but not aggressive. Empowering, not replacing.",
    audience: "Sign shops, wrap shops, tint shops, restyle shops, fleet managers, commercial vehicle branders.",
    neverSay: ["cheap", "discount", "basic", "simple", "easy", "replace designers", "making designers obsolete", "10x", "hack", "game-changer"],
  },
  WrapTV: {
    tagline: "Wrap Culture, On Camera.",
    positioning: "WrapTV World is the wrap industry's entertainment and culture platform.",
    description: "Creator spotlights, viral builds, transformations, and behind-the-scenes shop life. A media brand, not a shop or a SaaS — WrapTV entertains and builds the audience the other brands convert.",
    tone: "Hype, bold, automotive-lifestyle, creator-focused. High energy, fast pacing, meme-aware. Fan-first.",
    audience: "Car enthusiasts, installers, wrap culture fans, creators.",
    neverSay: ["direct sales pitches", "wholesale pricing", "software demo language", "SaaS", "subscription"],
  },
  WePrintWraps: {
    tagline: "Your Vehicle. Your Vision. Our Expertise.",
    positioning: "WePrintWraps is a professional vehicle wrap installation and print production shop.",
    description: "Full wraps, color changes, fleet branding, commercial vehicle graphics—premium materials, expert installation, and a finish that turns heads. Not a software company. A hands-on, in-the-shop wrap business.",
    tone: "Professional, trustworthy, expert craftsman. Blue collar premium. 'We do the work' energy.",
    audience: "Vehicle owners, fleet managers, businesses needing vehicle branding.",
    neverSay: ["AI", "software", "platform", "SaaS", "prompt", "render", "visualization", "subscription", "app", "tool", "technology"],
  },
  TheWrap: {
    tagline: "The wrap industry's weekly read.",
    positioning: "The Wrap is the ecosystem's weekly email newsletter — a 5-minute Tuesday digest of the week across the wrap industry.",
    description: "The week's best builds and content, new WrapTVWorld episodes, design drops, shop tips, and what's new across WePrintWraps, RestyleProAI, DesignProAI, and Ink & Edge. Repurposed, not rewritten — it rounds up real content that already shipped.",
    tone: "Smart, fast, industry-insider — a trade morning-brew for wrap people. Warm but efficient, zero corporate filler. Credits shops and creators by name.",
    audience: "Installers, shop owners, designers, and wrap-culture fans across every ecosystem brand's list.",
    neverSay: ["invented stats", "invented prices", "hype walls", "more than one CTA"],
  },
} as const;

// ── CONTENT STRATEGY ───────────────────────────────────────────────
export const CONTENT_STRATEGY = {
  weekly: {
    blog: { count: 1, description: "1 blog post per week — thought leadership, education, case studies" },
    contentPieces: { count: 10, description: "10 pieces across all channels per week" },
    channels: [
      "Meta Ads (IG + FB)",
      "Instagram (reels, carousels, static 1080x1080, stories, 4:5)",
      "Facebook (posts, stories, ads)",
      "LinkedIn",
      "Substack",
      "X / Twitter",
      "Email to subscriber list",
      "Email to WPW list",
    ],
  },
  monthly: {
    newsletter: {
      name: "The Edge",
      description: "Monthly newsletter shared with Club WPW. Curated content, insights, wrap industry trends.",
      audience: "All subscribers + Club WPW members",
    },
  },
  quarterly: {
    magazine: {
      name: "Ink & Edge Magazine",
      description: "Digital magazine, free to all subscribers. Compilation of top blog articles, podcasts, and marketing events from the quarter.",
      format: "Digital — free to all subs",
      content: "Best blog articles + podcast highlights + marketing events + featured wraps",
    },
  },
} as const;

// ── TOOL DESCRIPTIONS (Premium positioning) ────────────────────────
export const TOOL_DESCRIPTIONS: Record<string, { name: string; tagline: string; description: string; valueProps: string[] }> = {
  DesignProAI: {
    name: "DesignPro™",
    tagline: "High-End Design, Delivered Faster",
    description: "An advanced vehicle wrap design system that delivers custom wrap designs at the level typically seen from Fortune 500 campaigns and high-end agencies. The difference is speed and clarity.",
    valueProps: [
      "Custom designs from your creative direction",
      "7 photorealistic camera angles per design",
      "Production-ready panel files included",
      "Works for commercial wraps, restyles, and fleet branding",
    ],
  },
  ColorPro: {
    name: "ColorPro™",
    tagline: "See It Before You Commit",
    description: "Browse manufacturer color libraries from every major vinyl brand. Visualize any color on any vehicle before the install begins. Builds client confidence and closes jobs faster.",
    valueProps: [
      "1,000+ colors from 3M, Avery, XPEL, Inozetek, and more",
      "Photorealistic preview on any vehicle",
      "Compare finishes side by side",
      "Upload custom swatches",
    ],
  },
  MyVehiclePro: {
    name: "MyVehiclePro™",
    tagline: "Their Vehicle. Wrapped. Photoreal.",
    description: "Customer uploads a photo of their actual car and sees real wrap designs, color changes, and graphics applied to it photorealistically. Not a generic 3D mockup — their real vehicle, wrapped. The closer for 'I want to see it on MY car first' objections.",
    valueProps: [
      "Customer's real vehicle, not a 3D mockup",
      "Photorealistic wrap preview on their actual car",
      "Kills 'imagine this' objections",
      "Closes the deal at the consultation",
    ],
  },
  GraphicsPro: {
    name: "GraphicsPro™",
    tagline: "Design to Cutter, Streamlined",
    description: "Design cut vinyl graphics for any surface and export production-ready files for your RIP software. Built for sign shops and wrap shops that handle cut vinyl work.",
    valueProps: [
      "Vehicle graphics, wall graphics, storefront vinyl",
      "Production-ready cut files",
      "Compatible with VersaWorks, Onyx, Flexi, and more",
      "From concept to cut file in minutes",
    ],
  },
  FadeWraps: {
    name: "FadeWraps™",
    tagline: "Premium Fades, Production Ready",
    description: "Create stunning two-tone gradient effects with photorealistic renders and production-ready panel kits. Fade zones mapped and ready for install.",
    valueProps: [
      "Linear, radial, diagonal, and split fade styles",
      "Photorealistic 3D preview",
      "Production panels with mapped fade zones",
      "Premium builds made efficient",
    ],
  },
  PatternPro: {
    name: "PatternPro™",
    tagline: "Visualize Patterns, Calculate Material",
    description: "Preview pattern wraps on any vehicle and calculate exact linear footage needed. No more over-ordering. No more guessing.",
    valueProps: [
      "Camo, carbon fiber, brushed metal, custom patterns",
      "Exact material calculator",
      "Cost estimation per job",
      "Reduce material waste",
    ],
  },
  ProductionFlow: {
    name: "ProductionFlow™",
    tagline: "From Concept to Print, Aligned",
    description: "Connects design directly to production output. AI panelizing, upscaling, vectorizing, quality check, and production file packaging.",
    valueProps: [
      "Automated production pipeline",
      "Print-ready output files",
      "Quality check built in",
      "No disconnect between design and production",
    ],
  },
  ApprovePro: {
    name: "ApprovePro™",
    tagline: "Professional Approvals, Faster Sign-Off",
    description: "Create professional proof sheets, send approval links, track status, get digital signatures. Streamline the approval step.",
    valueProps: [
      "Professional proof sheets",
      "Digital approval workflow",
      "Client sign-off tracking",
      "No back-and-forth emails",
    ],
  },
  RevisionStudio: {
    name: "RevisionStudioIQ™",
    tagline: "Refine Without Starting Over",
    description: "4-layer revision engine for refining wrap designs. Make targeted changes without regenerating from scratch.",
    valueProps: [
      "Targeted design revisions",
      "Adjust colors, patterns, placement",
      "Iterate fast without starting over",
      "Precision refinement",
    ],
  },
  QuickQuote: {
    name: "QuickQuote™",
    tagline: "Professional Quotes in Seconds",
    description: "Generate accurate, professional wrap quotes based on vehicle size, coverage, materials, and labor. Send branded PDFs to clients.",
    valueProps: [
      "Instant accurate quotes",
      "Professional branded PDFs",
      "Vehicle-specific pricing",
      "Close deals faster",
    ],
  },
  PrintPro: {
    name: "PrintPro™",
    tagline: "Your Wholesale Print Partner",
    description: "Every account includes PrintPro™—your verified wholesale print partner. Never be limited by production capacity.",
    valueProps: [
      "Wholesale print fulfillment",
      "Included with every account",
      "Production backup when you need it",
      "Scale without adding equipment",
    ],
  },
  MightyMail: {
    name: "MightyMail™",
    tagline: "Your List, Activated",
    description: "Not just an email tool. Your list is parsed, segmented, and activated—retargeting your audience with content that inspires, educates, and keeps you top of mind.",
    valueProps: [
      "Parsed and segmented lists",
      "Automated retargeting",
      "Content that builds brand equity",
      "Turns past work into future revenue",
    ],
  },
};
