/**
 * Central registry for dashboard navigation + tool metadata.
 * Used by the sidebar, tool grid, and access guards so every surface
 * stays in sync when tools move between groups or tiers.
 *
 * 3-pillar structure that mirrors the brand tagline
 * "Design. Output. Profit.":
 *
 *   - DESIGN  → we eliminate the design bottleneck
 *     ColorPro, FadeWraps, PatternPro, GraphicsPro, DesignProAI,
 *     RevisionStudioIQ, RestyleLibrary, CreatorMarket
 *
 *   - OUTPUT  → we eliminate prepress + production friction
 *     ProductionFlow, ApprovePro, PrintPro, WrapBox
 *
 *   - PROFIT  → we help you close and track revenue
 *     QuickQuote, MightyMail, Gallery
 */

import {
  Palette, Layers, Grid3x3, Sparkles, GitBranch, Library,
  FileCheck2, Printer, Package, Image as ImageIcon, Store,
  Mic, Mail, Brain, Factory, Archive, TrendingUp,
  LayoutDashboard, FileText, Camera, FolderHeart, CreditCard, Settings, Megaphone,
  Calculator, Calendar, Phone,
  type LucideIcon,
} from "lucide-react";
import type { Tier } from "@/hooks/useToolAccess";

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
export const DASHBOARD_TOOLS: ToolNavItem[] = [
  // ── DESIGN ───────────────────────────────────────────────────
  {
    key: "designpro",
    label: "DesignPro",
    route: "/designpro",
    icon: Brain,
    pillar: "design",
    tier: "agency",
    description: "Custom wrap design tool — design any wrap from scratch with AI",
    brandAnchor: true,
  },
  {
    key: "colorpro",
    label: "ColorPro",
    route: "/colorpro",
    icon: Palette,
    pillar: "design",
    tier: "starter",
    description: "Photoreal color change renders on any vehicle",
    brandAnchor: true,
  },
  {
    key: "graphicspro",
    label: "GraphicsPro",
    route: "/graphics-pro",
    icon: Sparkles,
    pillar: "design",
    tier: "advanced",
    description: "AI graphics on hood, roof, panel zones",
  },
  {
    key: "patternpro",
    label: "PatternPro",
    route: "/wbty",
    icon: Grid3x3,
    pillar: "design",
    tier: "starter",
    description: "Pattern wraps with live pricing by the yard",
  },
  {
    key: "revisionstudio",
    label: "RevisionStudioIQ",
    route: "/revision-studio",
    icon: GitBranch,
    pillar: "design",
    tier: "complete",
    description: "Version history, clone & revise, design equity",
  },
  {
    key: "restylelibrary",
    label: "RestyleLibrary",
    route: "/restylelibrary",
    icon: Library,
    pillar: "design",
    tier: "starter",
    description: "Ready-made wrap panel library — browse, preview, buy",
  },
  {
    key: "creatormarket",
    label: "CreatorMarket",
    route: "/creatormarket",
    icon: Store,
    pillar: "profit",
    tier: "starter",
    description: "Marketplace — sell your designs or buy from creators",
  },

  // ── OUTPUT ───────────────────────────────────────────────────
  {
    key: "productionflow",
    label: "ProductionFlow",
    route: "/productionflow",
    icon: Factory,
    pillar: "output",
    tier: "complete",
    description: "Job pipeline — proof to print to delivery",
  },
  {
    key: "approvepro",
    label: "ApprovePro",
    route: "/approvepro",
    icon: FileCheck2,
    pillar: "output",
    tier: "starter",
    description: "Send proofs, capture e-signatures, track revisions",
  },
  {
    key: "printpro",
    label: "PrintPro",
    route: "/printpro",
    icon: Printer,
    pillar: "output",
    tier: "complete",
    description: "Print-ready output and fulfillment",
  },
  {
    key: "wrapbox",
    label: "WrapBox",
    route: "/wrapbox",
    icon: Package,
    pillar: "profit",
    tier: "advanced",
    description: "Bundled wrap delivery kits",
  },

  // ── PROFIT ───────────────────────────────────────────────────
  {
    key: "quickquote",
    label: "QuickQuote",
    route: "/quick-quote",
    icon: Mic,
    pillar: "profit",
    tier: "starter",
    description: "Voice-to-quote in seconds",
  },
  {
    key: "mightymail",
    label: "MightyMail",
    route: "/mightymail",
    icon: Mail,
    pillar: "marketing",
    tier: "starter",
    description: "Email retargeting — cold quote follow-ups, day-3/7 drips, branded templates",
  },
  {
    key: "designvault",
    label: "DesignVault",
    route: "/designvault",
    icon: Archive,
    pillar: "profit",
    tier: "starter",
    description: "Your saved designs & renders archive",
  },
  {
    key: "gallery",
    label: "Gallery",
    route: "/gallery",
    icon: ImageIcon,
    pillar: "design",
    tier: "starter",
    description: "Public showcase — social proof",
  },

  // ── MARKETING ────────────────────────────────────────────────
  {
    key: "seopro",
    label: "SeoPro",
    route: "/seopro",
    icon: TrendingUp,
    pillar: "marketing",
    tier: "starter",
    description: "Automatic SEO toolkit — blogs, GMB, CTR sweep, local pages, indexing. Drives organic traffic to your shop website.",
    brandAnchor: true,
  },
  {
    key: "quotetool",
    label: "QuoteTool",
    route: "/quotetool",
    icon: Calculator,
    pillar: "marketing",
    tier: "starter",
    description: "Instant wrap quotes on your website — customers price their own job 24/7",
  },
  {
    key: "bookingpro",
    label: "BookingPro",
    route: "/bookingpro",
    icon: Calendar,
    pillar: "marketing",
    tier: "starter",
    description: "Online calendar — customers self-book appointments from any quote link",
  },
  {
    key: "quicktext",
    label: "QuickText",
    route: "/never-miss-a-lead",
    icon: Phone,
    pillar: "marketing",
    tier: "starter",
    description: "Dedicated business number + AI voicemail + auto-text quote links",
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
    {
      type: "link",
      label: "Orders",
      route: "/orders",
      icon: Package,
      description: "All WePrintWraps orders — search by email or order #, view artwork, print work orders",
    },
    {
      type: "link",
      label: "Quotes",
      route: "/quotes",
      icon: FileText,
      description: "All customer quotes — track, follow up, and convert leads to jobs",
    },
    {
      type: "link",
      label: "My Renders",
      route: "/my-renders",
      icon: Camera,
      description: "Every photoreal render you've generated — reuse, share, or revise",
    },
    {
      type: "link",
      label: "My Designs",
      route: "/my-designs",
      icon: FolderHeart,
      description: "Your saved wrap designs — organize favorites and proven concepts",
    },
  ],
};

const staticAccountGroup: NavGroup = {
  id: "account",
  label: "Account",
  items: [
    {
      type: "link",
      label: "Marketing Hub",
      route: "/engine-room",
      icon: Megaphone,
      description: "Run campaigns, manage content, and grow your shop's reach",
    },
    {
      type: "link",
      label: "Billing & plan",
      route: "/billing",
      icon: CreditCard,
      description: "Manage subscription, render credits, and payment method",
    },
    {
      type: "link",
      label: "Shop settings",
      route: "/account/shop",
      icon: Settings,
      description: "Branding, team members, defaults, and shop-wide preferences",
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
  buildToolGroup("marketing", "Marketing"),
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
  secondaryAnchor?: string; // optional second tool key (Profit = QuickQuote + MightyMail)
}

export const DASHBOARD_PILLARS: DashboardPillar[] = [
  {
    id: "design",
    label: "Design",
    claim: "We eliminate the design bottleneck.",
    accent: "bg-gradient-to-r from-blue-500 to-purple-500",
    primaryAnchor: "designpro",
  },
  {
    id: "output",
    label: "Output",
    claim: "We eliminate prepress and production friction.",
    accent: "bg-gradient-to-r from-purple-500 to-fuchsia-500",
    primaryAnchor: "productionflow",
  },
  {
    id: "profit",
    label: "Profit",
    claim: "We help you close and track revenue.",
    accent: "bg-gradient-to-r from-fuchsia-500 to-pink-500",
    primaryAnchor: "quickquote",
  },
  {
    id: "marketing",
    label: "Marketing",
    claim: "We bring traffic and turn leads into revenue.",
    accent: "bg-gradient-to-r from-cyan-400 to-sky-500",
    primaryAnchor: "seopro",
    secondaryAnchor: "mightymail",
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
