/**
 * os-brand.ts — THE customer-facing names and positioning of DesignProAI and
 * the tools that run inside it (owner ruling, Trish 2026-09-16).
 *
 * This is BRAND / UI COPY ONLY. Every internal identifier stays what it was:
 * navigation keys (`designpro`, `graphicspro`, `wallpro`), routes
 * (`/designpro/create`, `/graphics-pro`, `/printpro/wallpro`), edge functions,
 * storage buckets (`graphicspro-files`), tables, tier keys, analytics names
 * and stored project references. Those are load-bearing; the words a customer
 * reads are not, and they are declared here once so no surface can drift.
 *
 * The hierarchy the customer must read at a glance:
 *
 *   DESIGNPROAI — Prompt-Based Design + Production-Ready File Output
 *     VehiclePro — vehicle graphics        (was "DesignPro" / "DesignProAI" in the tool)
 *     WallPro    — wall and environmental graphics
 *     CutPro     — cut graphics            (was "GraphicsPro" in customer-facing copy)
 *
 * No engine, intelligence layer or internal pipeline name is presented to a
 * customer (owner, Trish 2026-09-22: "Remove all UI Powered by Atlas" /
 * "Remove and hide atlas"). The "Powered by Atlas" tagline of 2026-09-16 is
 * retired; nothing replaces it. What the customer is told instead is what the
 * product does: Call 1 draws the three-zone Production Panel Proof, and every
 * print-ready file is cut from that one sheet. Internal identifiers that carry
 * the old engine name stay -- they are plumbing, not copy.
 *
 * Terminology that stays consistent: "Prompt-Based Design",
 * "Production-Ready File Output", "Design-to-Production OS", "Wide Format".
 * Never: "AI design made easy", "Design smarter", "Create faster",
 * "AI graphics generator", "AI image generator", "Prompt-to-print".
 */

export const OS_BRAND = {
  /** The master product name. Always present in the persistent header. */
  name: "DesignProAI",
  /** Uppercase form used in the header lockup and hierarchy displays. */
  nameUpper: "DESIGNPROAI",
  /** The persistent positioning line under the wordmark, on every page. */
  positioning: "Prompt-Based Design + Production-Ready File Output",
  /** Category / hero headline. */
  hero: "The Design-to-Production OS Built for Wide Format.",
  /** Supporting description under the hero. */
  description:
    "Create professional graphics from a prompt, refine the design, and generate production-ready output—all inside one purpose-built wide-format operating system.",
  /** Document-title suffix for every page. */
  titleSuffix: "DesignProAI — Prompt-Based Design + Production-Ready File Output",
} as const;

/**
 * TRIZONE™ — the proprietary name of the three-zone Production Panel Proof.
 *
 * Owner, 2026-09-22: "fix remove atlas come up with a proprietary name for our
 * ProductionPanelProof." The sheet Call 1 draws is the product's own artifact:
 * one document, three zones — full print panels, the same panels without type
 * or logos, and the logo, text and graphic elements — and every print-ready
 * file is cut from it. "Production Panel Proof" describes it; TriZone™ names
 * it, the way PanelPro, CutPro and WallPro name theirs, and it is ownable.
 *
 * This is the ONE place the word lives. Every heading, caption, error message,
 * download name and file name inside the production ZIP reads from here (the
 * runtime cannot import this file, so `fileStem` is mirrored there and a lock
 * asserts the two agree). To change the name, change this object.
 *
 * Internal identifiers stay: `panelProofAuthoring`, `atlas-panel-proof/…`
 * storage paths, `designpro_atlas_panel_proof_paths`, artifact `kind` values,
 * receipt fields. Those are plumbing and stored rows, not copy.
 */
export const PROOF_BRAND = {
  /** The name alone. */
  name: "TriZone",
  /** With the mark, for headings. */
  mark: "TriZone™",
  /** The full customer-facing name of the Call 1 sheet. */
  full: "TriZone™ Production Panel Proof",
  /** Short form for eyebrows and captions. */
  short: "TriZone™ Proof",
  /** File-name stem for downloads and the file inside the production ZIP. Mirrored in the runtime. */
  fileStem: "trizone-production-panel-proof",
  /** The one-line description under the name. */
  blurb: "One sheet, three zones: full print panels, the same panels without type or logos, and your logo, text and graphic elements. Every print-ready file is cut from it.",
} as const;

export type OsToolKey = "vehiclepro" | "wallpro" | "cutpro" | "recreatepro";

export interface OsTool {
  key: OsToolKey;
  /** Customer-facing product name. */
  name: string;
  /** Wordmark split so the second half carries the brand gradient. */
  wordmark: { base: string; suffix: string };
  /** One-line category under the name in hierarchy displays. */
  category: string;
  /** Primary tagline. */
  tagline: string;
  /** Supporting description. */
  description: string;
  /** Where the tool opens. These are the EXISTING routes, unchanged. */
  route: string;
  /**
   * The legacy navigation-registry key this tool is still known by inside the
   * code (`dashboard-nav.ts`, `useToolAccess.ts`, `ToolWordmark.tsx`). Never
   * rename these: tier gates, analytics and stored project rows read them.
   */
  navKey: "designpro" | "wallpro" | "graphicspro" | "recreatepro";
  /** Path prefixes that mean "the customer is inside this tool". */
  pathPrefixes: readonly string[];
}

export const OS_TOOLS: Record<OsToolKey, OsTool> = {
  recreatepro: {
    key: "recreatepro",
    name: "RecreatePro",
    wordmark: { base: "Recreate", suffix: "Pro" },
    category: "Reference-to-print reconstruction",
    tagline: "Your design. Rebuilt for print.",
    description: "Recreate uploaded artwork, complete a partial wrap, or adapt it to another vehicle—then revise and prepare production files.",
    route: "/recreatepro",
    navKey: "recreatepro",
    pathPrefixes: ["/recreatepro"],
  },
  vehiclepro: {
    key: "vehiclepro",
    name: "VehiclePro",
    wordmark: { base: "Vehicle", suffix: "Pro" },
    category: "Vehicle graphics",
    tagline: "Prompt-Based Vehicle Graphics Design + Production-Ready File Output",
    description:
      "Create professional vehicle graphics from a prompt, visualize and refine the design, then generate files prepared for production.",
    route: "/designpro/create",
    navKey: "designpro",
    pathPrefixes: [
      "/designpro/create",
      "/designpro/premium",
      "/designpro/generate",
      "/designpro/studio",
      "/designpro/raster",
      "/designpanelpro",
      "/vehiclepro",
      "/vehicle-pro",
    ],
  },
  wallpro: {
    key: "wallpro",
    name: "WallPro",
    wordmark: { base: "Wall", suffix: "Pro" },
    category: "Wall and environmental graphics",
    tagline: "Prompt-Based Wall Graphics Design + Production-Ready File Output",
    description:
      "Turn a prompt and real space into professionally designed wall graphics, then generate production-ready artwork at the required dimensions.",
    route: "/printpro/wallpro",
    navKey: "wallpro",
    pathPrefixes: ["/printpro/wallpro", "/wallpro"],
  },
  cutpro: {
    key: "cutpro",
    name: "CutPro",
    wordmark: { base: "Cut", suffix: "Pro" },
    category: "Cut graphics",
    tagline: "Prompt-Based Cut Graphics Design + Production-Ready File Output",
    description:
      "Create professional cut graphics from a prompt and move directly toward production-ready artwork inside DesignProAI.",
    route: "/graphics-pro",
    navKey: "graphicspro",
    pathPrefixes: [
      "/graphics-pro",
      "/graphics-pro-wall",
      "/graphics-pro-window",
      "/graphicspro",
      "/cutpro",
      "/cut-pro",
    ],
  },
};

/** Customer-facing tools, including the standalone reference-to-print entry. */
export const OS_TOOL_ORDER: readonly OsToolKey[] = ["vehiclepro", "recreatepro", "wallpro", "cutpro"];

/**
 * Which tool a path is inside, if any. The persistent header uses this to
 * name the active tool BENEATH the DesignProAI identity, never instead of it.
 */
export function activeOsTool(pathname: string): OsTool | null {
  for (const key of OS_TOOL_ORDER) {
    const tool = OS_TOOLS[key];
    if (tool.pathPrefixes.some((p) => pathname === p || pathname.startsWith(p + "/"))) return tool;
  }
  return null;
}

/** "VehiclePro | DesignProAI — Prompt-Based Design + Production-Ready File Output" */
export function osPageTitle(page: string): string {
  return `${page} | ${OS_BRAND.titleSuffix}`;
}

/**
 * Customer-facing compatibility aliases. The legacy route stays the served
 * one; these short names redirect so a link written in the new vocabulary
 * resolves, and so nothing that already links to the old path breaks.
 */
export const OS_TOOL_ALIASES: ReadonlyArray<{ from: string; to: string }> = [
  { from: "/vehiclepro", to: "/designpro/create" },
  { from: "/vehicle-pro", to: "/designpro/create" },
  { from: "/cutpro", to: "/graphics-pro" },
  { from: "/cut-pro", to: "/graphics-pro" },
  { from: "/cut-pro-wall", to: "/graphics-pro-wall" },
  { from: "/cut-pro-window", to: "/graphics-pro-window" },
];
