/**
 * content-tags — one color system for sorting content by BRAND, CHANNEL, and
 * TEAM MEMBER across the review surfaces (Content Review, Content Director).
 * Colors are stable so a brand/channel reads the same everywhere — like the
 * Engine Room floor tabs, but as filter chips.
 */

export type TagMeta = { label: string; color: string };

/** Brands carry a gradient too — see BRAND_META. */
export type BrandMeta = TagMeta & { gradient: string };

// Each ecosystem brand gets ONE canonical signature color AND one canonical
// GRADIENT — kept in sync with the Engine Room / calendar brand hierarchy
// (PR #3517) so a brand reads the same everywhere.
//
// `gradient` is THE Marketing Hub's brand color code (owner 2026-08-04: "same
// color code system as Marketing Hub") — the Hub's brand switcher dots were
// the de-facto standard while this file carried a DIFFERENT flat hex, so a
// brand read purple→pink in the Hub and cyan on the review surfaces. The
// gradients below are the Hub's values verbatim and the Hub now renders FROM
// here, so the two can no longer drift. Use `gradient` for brand surfaces
// (dots, chips, card rails); `color` remains for charts/filters that need a
// single flat value.
export const BRAND_META: Record<string, BrandMeta> = {
  weprintwraps: { label: "WePrintWraps", color: "#06B6D4", gradient: "from-purple-500 to-pink-600" },
  designproai: { label: "DesignProAI", color: "#7C3AED", gradient: "from-blue-600 to-fuchsia-500" },
  wraptvworld: { label: "WrapTVWorld", color: "#EC4899", gradient: "from-cyan-400 to-orange-500" },
  wraptv: { label: "WrapTVWorld", color: "#EC4899", gradient: "from-cyan-400 to-orange-500" }, // alias — drafts land under both slugs
  inkandedge: { label: "Ink & Edge", color: "#F59E0B", gradient: "from-slate-700 to-slate-900" },
  restylepro: { label: "DesignProAI", color: "#3B82F6", gradient: "from-blue-500 to-pink-500" },
  thewrap: { label: "The Wrap", color: "#10B981", gradient: "from-emerald-500 to-green-600" },
  creatormarket: { label: "CreatorMarket", color: "#22C55E", gradient: "from-emerald-500 to-teal-500" },
  colorpro: { label: "ColorPro", color: "#14B8A6", gradient: "from-teal-500 to-cyan-600" },
};

// Display order for the full brand taxonomy (shown even at 0 count).
export const BRAND_ORDER = ["weprintwraps", "restylepro", "designproai", "wraptvworld", "inkandedge", "thewrap", "colorpro"];

export function brandMeta(slug?: string | null): BrandMeta {
  const k = (slug || "").toLowerCase();
  return BRAND_META[k] || { label: slug || "Other", color: "#64748b", gradient: "from-slate-400 to-slate-600" };
}

// Products / tools — the whole DesignProAI suite, each with a signature color.
export const PRODUCT_META: Record<string, TagMeta> = {
  graphicspro: { label: "GraphicsPro", color: "#ef4444" },
  designproai: { label: "DesignProAI", color: "#a855f7" },
  logopro: { label: "LogoPro", color: "#f59e0b" },
  colorpro: { label: "ColorPro", color: "#06b6d4" },
  myvehiclepro: { label: "MyVehiclePro", color: "#3b82f6" },
  wallpro: { label: "WallPro", color: "#8b5cf6" },
  patternpro: { label: "PatternPro", color: "#14b8a6" },
  fadewraps: { label: "FadeWraps", color: "#ec4899" },
  printpro: { label: "PrintPro", color: "#0ea5e9" },
  creatormarket: { label: "CreatorMarket", color: "#22c55e" },
  restylelibrary: { label: "RestyleLibrary", color: "#6366f1" },
  productionflow: { label: "ProductionFlow", color: "#f97316" },
  approvepro: { label: "ApprovePro", color: "#10b981" },
  revisionstudio: { label: "RevisionStudioIQ", color: "#d946ef" },
};
export const PRODUCT_ORDER = Object.keys(PRODUCT_META);

export function productMeta(key?: string | null): TagMeta {
  const k = (key || "").toLowerCase().replace(/[^a-z]/g, "");
  return PRODUCT_META[k] || { label: key || "—", color: "#64748b" };
}

// Resolve a post's product/tool from its generation metadata (tool / tool_source).
export function productKeyFor(meta?: Record<string, any> | null): string {
  const raw = String(meta?.tool || meta?.tool_source || meta?.product || "").toLowerCase().replace(/[^a-z]/g, "");
  if (!raw) return "";
  for (const k of PRODUCT_ORDER) if (raw.includes(k)) return k;
  return "";
}

// Social channels — brand-accurate colors for the platform each post targets.
export const CHANNEL_META: Record<string, TagMeta> = {
  instagram: { label: "Instagram", color: "#E1306C" },
  facebook: { label: "Facebook", color: "#1877F2" },
  tiktok: { label: "TikTok", color: "#111827" },
  youtube: { label: "YouTube", color: "#FF0000" },
  x: { label: "X", color: "#0f172a" },
  twitter: { label: "X", color: "#0f172a" },
  linkedin: { label: "LinkedIn", color: "#0A66C2" },
  pinterest: { label: "Pinterest", color: "#E60023" },
  threads: { label: "Threads", color: "#000000" },
  snapchat: { label: "Snapchat", color: "#FFFC00" },
  wraptv_site: { label: "WrapTVWorld site", color: "#ef4444" },
  email: { label: "Email", color: "#7c3aed" },
  substack: { label: "Substack", color: "#FF6719" },
};
// Display order for the full channel taxonomy (twitter is an alias of x).
export const CHANNEL_ORDER = ["instagram", "facebook", "tiktok", "youtube", "x", "linkedin", "pinterest", "threads", "snapchat", "wraptv_site", "email", "substack"];

export function channelMeta(platform?: string | null): TagMeta {
  const k = (platform || "").toLowerCase();
  return CHANNEL_META[k] || { label: platform || "—", color: "#64748b" };
}

// Team members — the SAME colors as the Engine Room "The Team" roster
// (AdminMarketingHub TEAM), as hex so they read identically as filter chips.
// `match` holds the tokens a post's created_by / assigned_to might carry.
type TeamMeta = { key: string; label: string; color: string; match: string[] };
export const TEAM_META: TeamMeta[] = [
  { key: "trish", label: "Trish", color: "#ec4899", match: ["trish"] },
  { key: "jess", label: "Jess", color: "#a855f7", match: ["jess", "vinylvixen"] },
  { key: "carley", label: "Carley", color: "#3b82f6", match: ["carley"] },
  { key: "amanda", label: "Amanda", color: "#10b981", match: ["amanda"] },
  { key: "xavier", label: "Xavier", color: "#0f172a", match: ["xavier"] },
  { key: "houdini", label: "Gary (Houdini)", color: "#eab308", match: ["houdini", "gary", "guiterrez"] },
  { key: "jackson", label: "Jackson", color: "#ef4444", match: ["jackson"] },
  { key: "rj", label: "RJ", color: "#6d28d9", match: ["rj", "wrapper"] },
  { key: "brice", label: "Brice", color: "#f97316", match: ["brice"] },
  { key: "troy", label: "Troy", color: "#84cc16", match: ["troy"] },
  { key: "lance", label: "Lance", color: "#14b8a6", match: ["lance"] },
  { key: "agent", label: "AI Agent", color: "#06b6d4", match: ["agent", "marketing-agent", "ai"] },
];

// Resolve a post's created_by / assigned_to string to a team member.
export function teamFor(nameOrEmail?: string | null): TeamMeta {
  const s = (nameOrEmail || "").toLowerCase();
  if (!s) return { key: "unassigned", label: "Unassigned", color: "#94a3b8", match: [] };
  for (const t of TEAM_META) {
    if (t.match.some((m) => s.includes(m))) return t;
  }
  return { key: s, label: nameOrEmail!.split("@")[0], color: "#64748b", match: [] };
}

export function teamColor(name?: string | null): string {
  return teamFor(name).color;
}
export function teamLabel(name?: string | null): string {
  return teamFor(name).label;
}
export function teamKey(name?: string | null): string {
  return teamFor(name).key;
}

// A soft tinted background from a hex color (for the unselected pill state).
export function tint(hex: string, alpha = 0.14): string {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
