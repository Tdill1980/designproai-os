/**
 * QuickQuote Design & Visualization Tools catalog.
 *
 * These are the render-based tools in the RestylePro suite
 * (DesignPro, RecreatePro, PatternPro, RestyleLibrary, WallPro,
 * GraphicsPro). They aren't sold as line items — they're tools the
 * shop uses to generate the artwork, with monthly quantity governed
 * by the subscription tier.
 *
 * The QuickQuote "Design & Visualization Tools" dropdown renders this
 * list with a per-tier quantity caption as a compelling upsell when
 * a shop is on a lower tier. The copy deliberately shows every tier's
 * included quantity side-by-side so the upgrade path is obvious.
 *
 * WPW tenants see the same tool list in a dedicated "RestylePro Design
 * & Visualization Tools" dropdown alongside their WePrintWraps print
 * product dropdown — their first exposure to RestylePro's design gen
 * stack. Non-WPW tenants see it as "Design Gen Tools" with their
 * current tier's allowance highlighted.
 */
import { PUBLIC_TIERS, TIERS, type PublicTier } from "@/lib/tier-limits";

export type DesignToolId =
  | "designpro"
  | "recreatepro"
  | "patternpro"
  | "restylelibrary"
  | "wallpro"
  | "graphicspro";

export interface DesignTool {
  id: DesignToolId;
  name: string;
  /** Short tagline shown beneath the tool name in the dropdown. */
  description: string;
  /** Route the tool launches from. */
  route: string;
  /**
   * Share of the shop's monthly render allowance a single use consumes.
   * For parity with current usage tracking, every tool burns one render
   * per generation; this field is here so a future design fee / flat
   * add-on doesn't need a schema change.
   */
  rendersPerUse: number;
}

export const DESIGN_TOOLS: DesignTool[] = [
  {
    id: "designpro",
    name: "DesignPro",
    description: "AI-generated custom wrap designs on your vehicle.",
    route: "/designpro",
    rendersPerUse: 1,
  },
  {
    id: "recreatepro",
    name: "RecreatePro",
    description: "Recreate an existing design from a reference image.",
    route: "/visualize",
    rendersPerUse: 1,
  },
  {
    id: "patternpro",
    name: "PatternPro",
    description: "Pattern library applied across body panels.",
    route: "/fadewraps",
    rendersPerUse: 1,
  },
  {
    id: "restylelibrary",
    name: "RestyleLibrary",
    description: "Pre-made wrap designs selectable from the library.",
    route: "/gallery",
    rendersPerUse: 1,
  },
  {
    id: "wallpro",
    name: "WallPro",
    description: "Wall wrap visualization with printed vinyl mockups.",
    route: "/wallpro",
    rendersPerUse: 1,
  },
  {
    id: "graphicspro",
    name: "GraphicsPro",
    description: "Custom graphics designed to a vehicle zone.",
    route: "/graphicspro",
    rendersPerUse: 1,
  },
];

/**
 * Build the "X included @ Tier" breakdown caption that shows under
 * each tool in the dropdown. Only the public (customer-purchasable)
 * tiers appear — Agency is a custom enterprise tier and is handled
 * outside the dropdown. Ordered Starter → Complete so the reader's
 * eye tracks the upgrade path left-to-right.
 */
export function tierQuantityCaption(): string {
  return PUBLIC_TIERS.map((t: PublicTier) => {
    const meta = TIERS[t];
    return `${meta.label} ${meta.monthlyRenders}`;
  }).join(" · ");
}

export function findDesignTool(id: string): DesignTool | undefined {
  return DESIGN_TOOLS.find((t) => t.id === id);
}
