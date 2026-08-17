/**
 * content-hook-recipes.ts — Hook-type prompt recipes + tool focus map.
 *
 * Single source of truth for ContentStudio AI copy generation. Both the
 * edge function and (future) batch generator import from here so the same
 * pain-aware / education-first / us-vs-them / feature-callout discipline
 * is applied everywhere. Mirrors brand-copy.ts TOOL_DESCRIPTIONS — keep
 * the tool list in sync when adding new tools.
 */

export type HookType =
  | "pain_aware"
  | "education_first"
  | "us_vs_them"
  | "feature_callout";

export const HOOK_RECIPES: Record<HookType, string> = {
  pain_aware: `## HOOK DISCIPLINE — PAIN-AWARE (DEFAULT)
Lead with the shop owner's frustration in their own words. The SHARPEST pain is
PRODUCTION: a customer shows up with AI wrap art (ChatGPT, Midjourney, a photo of
an old wrap) that isn't production-ready, and the shop has to redraw it, rebuild
it in Photoshop, hire a designer, hand-panel it, or say no. Open on that cost of
NOT acting. Only resolve to the tool (RecreatePro / DesignProAI) in the body.
Never feature-first. ROTATE the pain — do NOT open every piece with the mockup line.

Pain-aware hook examples (DO match this energy — vary them):
- "A customer just emailed you a ChatGPT wrap. It can't be printed. Now what?"
- "AI made the design. Who's making it printable?"
- "Your customer already has the artwork. It's not production-ready."
- "Midjourney gave them the wrap. It gave you a paneling nightmare."
- "Still redrawing customer AI art in Photoshop by hand?"
- "$500 mockup. 5 days late. Customer ghosted." (use sparingly, not the default)

ARC: PAIN → REVEAL → CREDIBILITY → PAYOFF (Arc 1 from system prompt).
Hook = the production pain. Headline = the mechanism that fixes it. Body = proof.
CTA = verb.`,

  education_first: `## HOOK DISCIPLINE — EDUCATION-FIRST
Lead with a teaching moment, an industry insight, or a counter-intuitive
truth. The reader should feel smarter after reading the hook. Tool reveal
happens in the body, not the hook.

Education-first hook examples (DO match this energy):
- "The #1 reason wraps fail at install isn't the installer."
- "3M 2080 vs Avery Supreme — they don't behave the same in heat."
- "Most shops quote off square footage. Pros quote off panel count."

ARC: SITUATION → COMPLICATION → RESOLUTION (Arc 3 from system prompt).
Hook = the insight. Body = the why. CTA = "See how" / "Try it free".`,

  us_vs_them: `## HOOK DISCIPLINE — US vs THEM (OLD WAY / NEW WAY)
Frame an explicit contrast — old way (slow, expensive, frustrating) vs
new way (the tool). Lead with the old way's pain so the reveal lands.

Us-vs-them hook examples (DO match this energy — vary them):
- "Old way: redraw the AI art in Photoshop for hours. New way: upload it, get print files."
- "Adobe owns design. AI owns generation. DesignProAI owns PRODUCTION."
- "Them: 'we generate AI wraps.' Us: we get ANY art to production-ready files."
- "1987 you drew it. 1990 you designed it. 2026 you prompt it AND print it."
- "Old way: $1K mockup, 5 days. New way: prompt to print files." (use sparingly)

ARC: OLD WAY → NEW WAY → RESULT (Arc 2 from system prompt).
Hook = the contrast. Body = the proof. CTA = "Switch" / "See the difference".`,

  feature_callout: `## HOOK DISCIPLINE — FEATURE CALLOUT
ONE feature, named clearly, with the specific outcome it produces. Number
or specific beats adjective. No feature lists.

Feature-callout hook examples (DO match this energy — vary them):
- "RecreatePro™: upload ANY AI art → production-ready print files."
- "Prompt-to-Print™: prompt in, print files out."
- "Upload a photo of an old wrap. Get production-ready files back."
- "7 photoreal angles for client approval." (support proof, not the lead)

ARC: HOOK → PROMISE → PROOF → CTA (Arc 4 from system prompt).
Hook = the named feature + outcome. Body = how it works. CTA = the verb.`,
};

/**
 * Per-tool focus prompts. Each tells Claude which RestyleProAI product the
 * piece is selling and what its specific selling points are. Add new tools
 * here AND to TOOL_DESCRIPTIONS in src/lib/brand-copy.ts (keep in sync).
 */
export const TOOL_FOCUS_PROMPTS: Record<string, string> = {
  all: "",
  DesignProAI: `FOCUS THIS CONTENT ON: DesignProAI™ — the first Prompt-to-Print™ platform. The real problem for shops isn't AI generation, it's PRODUCTION: customers already arrive with AI wrap art (ChatGPT, Midjourney, Firefly, a Photoshop file, a photo of an old wrap) that isn't production-ready. TWO ENTRY POINTS, both output production-ready print files: (1) RecreatePro™ — upload ANY artwork and it rebuilds it into production-ready files (the acquisition wedge / lead with this); (2) DesignProAI — prompt it from scratch (the expansion). Positioning: Adobe owns creative software, AI owns image generation, DesignProAI owns PRODUCTION. Supporting proof: 7 photorealistic camera angles for client approval, natural-language revisions. Key discipline: ROTATE angles across production-pain, RecreatePro upload-any-art, the category shift (Prompt-to-Print), and the two entry points — do NOT lead every piece with "replace $500-$1,000 mockups / 7 renders in 30 seconds" (that is ONE supporting angle, not the default).`,
  ColorPro: `FOCUS THIS CONTENT ON: ColorPro™ — Vehicle color visualization tool. Browse manufacturer color libraries from 3M, Avery Dennison, XPEL, Inozetek, Hexis, Arlon, Oracal, KPMF, TeckWrap. Upload custom swatches. See any vinyl wrap film color on any vehicle before committing. Closes color-change customers who want to "see it first." Key selling points: 1,000+ real manufacturer films, photorealistic preview, any vehicle any color, upload your own swatch, shuts down doubt and closes the job.`,
  MyVehiclePro: `FOCUS THIS CONTENT ON: MyVehiclePro™ — Customer-vehicle visualization. Customer uploads a photo of THEIR ACTUAL CAR and sees real wrap designs, color changes, and graphics applied to it photorealistically. Not a generic 3D mockup — their real vehicle, wrapped. The closer for "I want to see it on MY car first" objections. Key selling points: customer's real vehicle photo, photorealistic wrap preview on their actual car, no more "imagine this" objections, presentation = perception, closes the deal.`,
  GraphicsPro: `FOCUS THIS CONTENT ON: GraphicsPro™ — AI-powered cut vinyl graphics design-to-production tool. Design graphics for any surface (vehicles, walls, windows, signs). Get production-ready cut files for any RIP software (VersaWorks, Onyx, Flexi, SAi, Caldera). Perfect for sign shops and wrap shops that do cut vinyl. Key selling points: design to production, any surface, cut-ready files, AI-powered.`,
  FadeWraps: `FOCUS THIS CONTENT ON: FadeWraps™ — Premium gradient fade wrap effects. Create stunning two-tone fade designs with photorealistic 3D renders. Includes production-ready panel kits with fade zones mapped. Multiple fade styles (linear, radial, diagonal, split). Popular for sports cars, luxury vehicles, show cars. Key selling points: unique fade effects, photorealistic renders, production panel kits, head-turning designs.`,
  PatternPro: `FOCUS THIS CONTENT ON: PatternPro™ (WBTY / Wrap By The Yard) — Pattern wrap visualization and linear footage calculator. Visualize repeating patterns, camo, carbon fiber, brushed metal, wood grain, and custom pattern wraps on vehicles. Calculate exact material needed by the yard. Key selling points: pattern visualization, material calculator, cost estimation, any pattern any vehicle.`,
  QuickQuote: `FOCUS THIS CONTENT ON: QuickQuote™ — Instant vehicle wrap quoting tool. Generate professional quotes for customers in seconds. Pricing based on vehicle size, wrap coverage (full, partial, specific panels), material selection, and labor. Send branded PDF quotes to customers. Perfect for wrap shop sales teams. Key selling points: instant quotes, professional PDFs, accurate pricing, close deals faster.`,
  ProductionFlow: `FOCUS THIS CONTENT ON: ProductionFlow™ — Full production pipeline from render to print-ready files. AI panelizing (3D render to flat production panels), upscaling (4x ESRGAN), vectorizing (Vectorizer.AI), quality checking, production file packaging. 24-hour admin QC hold. Download production packs with all panel files. Key selling points: automated production pipeline, print-ready output, quality guaranteed, saves hours of prep work.`,
  ApprovePro: `FOCUS THIS CONTENT ON: ApprovePro™ — Client approval workflow. Create professional proof sheets from renders. Send approval links to clients. Track approval status. Get digital signatures. Streamline the "does the customer like it?" step. Key selling points: professional proofs, digital approval, faster sign-off, no back-and-forth emails.`,
  RevisionStudio: `FOCUS THIS CONTENT ON: RevisionStudioIQ™ — AI-powered design revision system. 4-layer revision engine for refining wrap designs. Make targeted changes without regenerating from scratch. Adjust colors, patterns, placement, intensity. Key selling points: precise revisions, AI-powered refinement, iterate fast, don't start over.`,
};

/**
 * Build the tool-focus block injected into the Claude prompt. Returns "" when
 * brand isn't RestyleProAI or no tools are selected (matches legacy behavior).
 */
export function buildToolFocusBlock(
  brand: string,
  focusTools: string[] | undefined,
  focusTool: string | undefined,
): string {
  if (brand !== "RestyleProAI") return "";
  const toolKeys: string[] = Array.isArray(focusTools) && focusTools.length > 0
    ? focusTools
    : (focusTool && focusTool !== "all") ? [focusTool] : [];
  if (toolKeys.length === 0) return "";
  const blocks = toolKeys
    .map((k) => TOOL_FOCUS_PROMPTS[k] || "")
    .filter(Boolean);
  return blocks.length > 0 ? "\n\n" + blocks.join("\n\n") : "";
}

/**
 * Build the hook-discipline block. Default is pain_aware. Unknown values
 * fall back to pain_aware so a stale client never silently drops the rule.
 */
export function buildHookBlock(hookType: string | undefined): string {
  const key: HookType =
    hookType === "education_first" ||
    hookType === "us_vs_them" ||
    hookType === "feature_callout" ||
    hookType === "pain_aware"
      ? hookType
      : "pain_aware";
  return "\n\n" + HOOK_RECIPES[key];
}
