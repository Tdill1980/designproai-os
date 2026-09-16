/**
 * Central registry for dashboard navigation + tool metadata.
 * Used by the sidebar, tool grid, and access guards so every surface
 * stays in sync when tools move between groups or tiers.
 *
 * Scoped to the DesignProAI-owned operating path. The shell was copied from a
 * suite whose registry listed nineteen tools; most of them were RestylePro
 * surfaces whose routes are not part of this standalone system, so every one
 * of those sidebar entries landed on the 404 page. A navigation entry that
 * cannot be reached is worse than a missing one, so this registry lists only
 * what the router actually serves. The remaining DesignProAI-owned apps join
 * it as their routes land.
 *
 * 3-pillar structure that mirrors the brand tagline
 * "Design. Output. Profit.":
 *
 *   - DESIGN  → the seven immutable source views (Calls 1-7)
 *   - OUTPUT  → proof, panels, QC and verified production files (Calls 8-12)
 *   - PROFIT  → delivery of the finished pack
 */

import {
  Brain,
  Layers,
  Factory,
  Ruler,
  Package,
  Image as ImageIcon,
  Scissors,
  LayoutDashboard,
  CreditCard,
  Grid3x3,
  type LucideIcon,
} from "lucide-react";
import type { Tier } from "@/hooks/useToolAccess";
import { OS_TOOLS } from "@/lib/os-brand";

export type Pillar = "home" | "design" | "output" | "profit" | "marketing" | "account";

export interface ToolNavItem {
  key: string;              // matches TOOL_TIER_REQUIREMENTS key in useToolAccess
  label: string;            // display name
  route: string;            // path
  icon: LucideIcon;
  pillar: Pillar;
  tier: Tier;
  description: string;      // short tagline for ToolCard
  comingSoon?: boolean;
  brandAnchor?: boolean;
}

/**
 * Ordered list. Sidebar + tool grid render in this order.
 */
// CUSTOMER-FACING NAMES COME FROM os-brand.ts (Trish 2026-09-16). The keys
// below are internal identifiers read by tier gates, analytics and stored
// rows, and they do not change: `designpro` is VehiclePro, `graphicspro` is
// CutPro. Order is the product hierarchy: VehiclePro, WallPro, CutPro.
export const DASHBOARD_TOOLS: ToolNavItem[] = [
  // ── DESIGN ───────────────────────────────────────────────────
  {
    key: "designpro",
    label: OS_TOOLS.vehiclepro.name,
    route: "/designpro/create",
    icon: Brain,
    pillar: "design",
    tier: "starter",
    description: OS_TOOLS.vehiclepro.tagline,
    brandAnchor: true,
  },
  {
    key: "wallpro",
    label: OS_TOOLS.wallpro.name,
    route: "/printpro/wallpro",
    icon: ImageIcon,
    pillar: "design",
    tier: "starter",
    description: OS_TOOLS.wallpro.tagline,
  },
  {
    key: "graphicspro",
    label: OS_TOOLS.cutpro.name,
    route: "/graphics-pro",
    icon: Scissors,
    pillar: "design",
    tier: "complete",
    description: OS_TOOLS.cutpro.tagline,
  },
  {
    key: "patternpro",
    label: "PatternPro",
    route: "/printpro/patternpro",
    icon: Grid3x3,
    pillar: "design",
    tier: "starter",
    description: "Pick one of 118 WePrintWraps patterns, see it on any vehicle in 3D, get the yards a full wrap takes, order the film",
  },
  {
    // The TENANT page beside the standalone one (owner, 2026-09-16: "I should
    // see both on navigation left side, so I can show WPW and also sell").
    // It opens the page as a WePrintWraps customer sees it — their mark, no
    // DesignProAI chrome — which is the demo of what a tenant gets.
    key: "patternpro_wpw",
    label: "WPW × PatternPro",
    route: "/pattern-wrap",
    icon: Grid3x3,
    pillar: "design",
    tier: "starter",
    description: "PatternPro as the WePrintWraps tenant ships it — the white-label page a shop's own customers use",
  },
  {
    // The product editor itself -- design library, proof/panel review,
    // revisions, Production Pack entice. This surface shipped with a route and
    // an access tier but no registry entry, so the only way to open it was to
    // type /revision-studio by hand; the owner found that out on a phone.
    key: "revisionstudio",
    label: "RevisionStudioIQ",
    route: "/revision-studio",
    icon: Layers,
    pillar: "design",
    tier: "advanced",
    description: "Browse your designs, review every proof beside its print panel, revise and order",
  },
  // "Revision source" (the immutable seven-file upload at
  // /designpro/revisions/new) was removed from navigation by the owner
  // (2026-08-26): in the menu it read as the way into RevisionStudioIQ, which
  // it is not, and the upload surface is an operator path reached from the
  // production pages, not a headline tool. The route still serves.
  {
    key: "gallery",
    label: "Gallery",
    route: "/gallery",
    icon: ImageIcon,
    pillar: "design",
    tier: "starter",
    description: "Public showcase — social proof",
  },

  // ── OUTPUT ───────────────────────────────────────────────────
  {
    key: "productionjobs",
    label: "Production jobs",
    route: "/designpro/jobs",
    icon: Factory,
    pillar: "output",
    tier: "starter",
    description: "2D proof, six production layers, QC gates and the verified output files",
    brandAnchor: true,
  },
  // THE PRODUCTION CONTROL ROOM, IN THE NAV. (Trish 2026-08-28)
  //
  // "Add a link to PanelProStudio to admin tab so I can access and validate."
  // PanelPro Studio is where a design's whole lineage is inspected and where
  // the design team ticks the human QC that releases the preflight gate. Until
  // now the only way in was to already know a generation id and type the URL,
  // which is not a door -- it is a keyhole. `/designpro/studio-board` is the
  // same board with no job pinned: it opens on the recent-jobs list.
  {
    key: "panelprostudio",
    label: "PanelPro Studio",
    route: "/designpro/studio-board",
    icon: Factory,
    pillar: "output",
    tier: "starter",
    description: "The production control room — A.T.L.A.S. master, panels, proofs, downloads and the human QC checklist",
  },
  {
    key: "panelprofileoutput",
    label: "PanelProFileOutput",
    route: "/panelpro-file-output",
    icon: Layers,
    pillar: "output",
    tier: "starter",
    description: "Fit saved artwork to templates, inspect protected placement and prepare physical print panels",
  },
  {
    key: "genieqc",
    label: "GENIE QC",
    route: "/designpro/genie-qc",
    icon: Ruler,
    pillar: "output",
    tier: "agency",
    description: "Validate exact six-surface vehicle geometry and release blocked jobs",
  },

  // ── PROFIT ───────────────────────────────────────────────────
  {
    key: "wrapbox",
    label: "WrapBox",
    route: "/designpro/wrapbox",
    icon: Package,
    pillar: "profit",
    tier: "starter",
    description: "Delivered production packs with immutable ZIP and manifest hashes",
    brandAnchor: true,
  },
];

export interface NavGroup {
  id: Pillar;
  label: string;
  items: Array<
    | { type: "tool"; tool: ToolNavItem }
    | { type: "link"; label: string; route: string; icon: LucideIcon; description?: string }
  >;
}

const staticHomeGroup: NavGroup = {
  id: "home",
  label: "Home",
  items: [
    {
      type: "link",
      label: "ShopEngine",
      route: "/dashboard",
      icon: LayoutDashboard,
      description: "Your main dashboard — design output and profit at a glance",
    },
  ],
};

const staticAccountGroup: NavGroup = {
  id: "account",
  label: "Account",
  items: [
    {
      type: "link",
      label: "Plans & pricing",
      route: "/pricing",
      icon: CreditCard,
      description: "Subscription plans and render token pricing",
    },
  ],
};

const buildToolGroup = (id: Pillar, label: string): NavGroup => ({
  id,
  label,
  items: DASHBOARD_TOOLS.filter((t) => t.pillar === id).map((tool) => ({
    type: "tool" as const,
    tool,
  })),
});

export const NAV_GROUPS: NavGroup[] = [
  staticHomeGroup,
  buildToolGroup("design", "Design"),
  buildToolGroup("output", "Output"),
  buildToolGroup("profit", "Profit"),
  staticAccountGroup,
];

// ─── Pillar dashboard hero cards ────────────────────────────────
// Each pillar gets ONE big hero card on the dashboard. The card
// features the pillar's anchor tool(s) as the primary CTA and lists
// supporting tools as inline chip links. All tools remain reachable
// from the sidebar nav (single source of truth).
export interface DashboardPillar {
  id: "design" | "output" | "profit" | "marketing";
  label: string;           // "DESIGN"
  claim: string;           // "We eliminate the design bottleneck"
  accent: string;          // gradient CSS class for the pillar index + accent bar
  primaryAnchor: string;   // tool key rendered as the big CTA
  secondaryAnchor?: string;
}

export const DASHBOARD_PILLARS: DashboardPillar[] = [
  {
    id: "design",
    label: "Design",
    claim: "We eliminate the design bottleneck.",
    accent: "bg-gradient-to-r from-blue-500 to-purple-500",
    primaryAnchor: "designpro",
    secondaryAnchor: "revisionstudio",
  },
  {
    id: "output",
    label: "Output",
    claim: "We eliminate prepress and production friction.",
    accent: "bg-gradient-to-r from-purple-500 to-fuchsia-500",
    primaryAnchor: "productionjobs",
  },
  {
    id: "profit",
    label: "Profit",
    claim: "We help you close and track revenue.",
    accent: "bg-gradient-to-r from-fuchsia-500 to-pink-500",
    primaryAnchor: "wrapbox",
  },
];

// Legacy alias kept so any older imports don't break
export const DASHBOARD_TABS = DASHBOARD_PILLARS.map((p) => ({
  id: p.id as Pillar,
  label: p.label,
  shortLabel: p.label,
  description: p.claim,
}));

export const toolsByPillar = (pillar: Pillar): ToolNavItem[] =>
  DASHBOARD_TOOLS.filter((t) => t.pillar === pillar);
