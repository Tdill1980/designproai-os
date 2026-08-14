/**
 * marketingSuite — the Marketing Suite's tools, their COLORS, and the order
 * they're actually used in.
 *
 * One registry, because the Engine Room's Quick Access bar and the
 * "How to use the Marketing Suite" guide must agree. A tool that's purple on
 * the Hub button and blue in the guide teaches the operator nothing — the
 * colour IS the wayfinding. Gradients here are the Hub's existing ones, so
 * every chip in the guide matches the button you actually click.
 *
 * Adding a marketing tool? Add it here once and both surfaces pick it up.
 */

/** A stage of the workflow — what the operator is trying to do right now. */
export type SuiteStage = "libraries" | "create" | "approve" | "measure";

export interface SuiteTool {
  /** Route. Also the identity used to highlight "you are here". */
  to: string;
  label: string;
  /** Tailwind gradient stops — the Hub's colour for this tool. */
  gradient: string;
  stage: SuiteStage;
  /** One line: what this tool is FOR. Written for someone who's lost. */
  does: string;
}

export const SUITE_STAGES: { key: SuiteStage; title: string; blurb: string }[] = [
  {
    key: "libraries",
    title: "1 · Feed the brains",
    blurb:
      "Everything the AI writes comes from these. Thin libraries = generic content, so fill them first.",
  },
  {
    key: "create",
    title: "2 · Make the content",
    blurb:
      "Pick the tool that matches what you're making. They all drop their output into the same queue.",
  },
  {
    key: "approve",
    title: "3 · Approve — and it publishes itself",
    blurb:
      "One queue for every brand and channel. Approving assigns the slot and ships it. There is no step after this.",
  },
  {
    key: "measure",
    title: "4 · See what shipped",
    blurb: "Where published work and the week's schedule live.",
  },
];

export const SUITE_TOOLS: SuiteTool[] = [
  // ── 1. The libraries every generator reads ──────────────────────────────
  {
    to: "/admin/content-engine",
    label: "Brand Brains",
    gradient: "from-slate-700 to-slate-900",
    stage: "libraries",
    does: "Each brand's voice, audience and rules. Edit it here and every generator uses the new voice — no deploy.",
  },
  {
    to: "/admin/hooks",
    label: "Hooks Manager",
    gradient: "from-amber-500 to-orange-600",
    stage: "libraries",
    does: "The opening lines the AI writes from. Save the ones that work; they steer every caption.",
  },
  {
    to: "/engine-room?tab=assets",
    label: "Asset Library",
    gradient: "from-teal-500 to-cyan-600",
    stage: "libraries",
    does: "Your real footage and photos. Creative is built from these — never from invented images.",
  },
  {
    to: "/admin/content-studio?tab=canva",
    label: "Templates",
    gradient: "from-purple-500 to-fuchsia-600",
    stage: "libraries",
    does: "Per-brand, per-format layouts. A brand with no template for a format gets skipped, not faked.",
  },

  // ── 2. The creation surfaces ────────────────────────────────────────────
  {
    to: "/admin/content-studio",
    label: "Content Studio",
    gradient: "from-purple-500 to-pink-500",
    stage: "create",
    does: "Design a post on the canvas — or turn on Autonomous mode and let it build the Director's queue for you.",
  },
  {
    to: "/admin/composer",
    label: "Composer",
    gradient: "from-blue-500 to-purple-500",
    stage: "create",
    does: "Guided build: brand → format → destination → finished candidates. Fastest way to a single post.",
  },
  {
    to: "/admin/script-studio",
    label: "Script Studio",
    gradient: "from-indigo-500 to-violet-500",
    stage: "create",
    does: "Video: footage → transcript → script → rough cut. Where transcripts live.",
  },
  {
    to: "/admin/marketing-agent",
    label: "Marketing Agent",
    gradient: "from-blue-500 to-pink-500",
    stage: "create",
    does: "Chat to draft posts, hooks and ad packs. Everything it makes lands in the queue for review.",
  },
  {
    to: "/admin/mightymail",
    label: "MightyMail",
    gradient: "from-orange-500 to-red-500",
    stage: "create",
    does: "Email and newsletters. Approved campaigns push to Klaviyo as drafts — they never send themselves.",
  },

  // ── 3. The one gate ─────────────────────────────────────────────────────
  {
    to: "/admin/content-director",
    label: "Content Director",
    gradient: "from-blue-600 to-pink-600",
    stage: "approve",
    does: "THE approval queue. Approve = scheduled = published. Fix copy here with ✏️ Fix with AI, or upload your own post.",
  },

  // ── 4. After it ships ───────────────────────────────────────────────────
  {
    to: "/admin/brand-board",
    label: "Brand Board",
    gradient: "from-fuchsia-500 to-amber-500",
    stage: "measure",
    does: "Everything published across the ecosystem, sorted by brand, type and template.",
  },
  {
    to: "/feed",
    label: "The Feed",
    gradient: "from-cyan-500 to-pink-500",
    stage: "measure",
    does: "OUR OWN social platform — approved 'wrapfeed' posts publish here; every comment lands in SocialIQ with no Meta gatekeeping.",
  },
  {
    to: "/admin/social-iq",
    label: "SocialIQ",
    gradient: "from-sky-500 to-blue-600",
    stage: "measure",
    does: "Comments are leads: reply organically + like from the WPW account, and see what posts are earning per brand.",
  },
  {
    to: "/engine-room?tab=calendar",
    label: "Content Calendar",
    gradient: "from-emerald-500 to-teal-500",
    stage: "measure",
    does: "The week's schedule — what's going out, when, on which channel.",
  },
];

/** Tools for one stage, in registry order. */
export const toolsForStage = (stage: SuiteStage): SuiteTool[] =>
  SUITE_TOOLS.filter((t) => t.stage === stage);

/**
 * Is this registry entry the page we're on? Compares pathname only, so
 * `?tab=` variants still match their page, and `/admin/content-studio`
 * doesn't swallow `/admin/content-studio-something-else`.
 */
export function isCurrentTool(tool: SuiteTool, pathname: string): boolean {
  const toolPath = tool.to.split("?")[0];
  return pathname === toolPath;
}
