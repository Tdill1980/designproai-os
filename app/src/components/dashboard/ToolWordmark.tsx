import { cn } from "@/lib/utils";

/**
 * Two-color tool wordmark.
 *
 * Matches the existing Header.tsx treatment for "RestyleProAI" exactly:
 *   - font:     font-bold tracking-tight (inherits default sans-serif)
 *   - base:     plain white
 *   - suffix:   bg-gradient-to-r from-blue-500 to-fuchsia-500
 *               bg-clip-text text-transparent  (STATIC, not animated)
 *   - secondary suffix (e.g. "AI" on DesignProAI): same blue → magenta,
 *     no purple middle stop — per brand spec.
 *
 * Every dashboard surface (sidebar, cards, hero, revenue row) uses this
 * component so the brand gradient is applied consistently and can be
 * changed in one place.
 */

export interface WordmarkSplit {
  base: string;
  suffix: string;
  subSuffix?: string; // optional 2nd gradient span (e.g. "AI")
}

const TOOL_WORDMARKS: Record<string, WordmarkSplit> = {
  colorpro:         { base: "Color",    suffix: "Pro" },
  fadewraps:        { base: "Fade",     suffix: "Wraps" },
  patternpro:       { base: "Pattern",  suffix: "Pro" },
  graphicspro:      { base: "Graphics", suffix: "Pro" },
  designpro:        { base: "Design",   suffix: "Pro", subSuffix: "AI" },
  revisionstudio:   { base: "Revision", suffix: "Studio", subSuffix: "IQ" },
  restylelibrary:   { base: "Restyle",  suffix: "Library" },
  creatormarket:    { base: "Creator",  suffix: "Market" },
  approvepro:       { base: "Approve",  suffix: "Pro" },
  printpro:         { base: "Print",    suffix: "Pro" },
  wrapbox:          { base: "Wrap",     suffix: "Box" },
  productionflow:   { base: "Production", suffix: "Flow" },
  quickquote:       { base: "Quick",    suffix: "Quote" },
  mightymail:       { base: "Mighty",   suffix: "Mail" },
  designvault:      { base: "Design",   suffix: "Vault" },
  gallery:          { base: "Gallery",  suffix: "" },
  seopro:           { base: "Seo",      suffix: "Pro" },
  quotetool:        { base: "Quote",    suffix: "Tool" },
  bookingpro:       { base: "Booking",  suffix: "Pro" },
  quicktext:        { base: "Quick",    suffix: "Text" },
  restylepro:       { base: "Restyle",  suffix: "Pro", subSuffix: "AI" },
  restyledashboard: { base: "Restyle",  suffix: "Dashboard" },
  shopengine:       { base: "Shop",     suffix: "Engine" },
};

/** WPW tenant overrides — shown instead of default when isWpw is true. */
export const WPW_WORDMARKS: Record<string, WordmarkSplit> = {
  quickquote: { base: "QuickQuote", suffix: "Web", subSuffix: "Tool" },
};

interface ToolWordmarkProps {
  toolKey: string;
  /** Compact sizing for sidebar / inline use. */
  compact?: boolean;
  /** Size override (takes precedence over compact). */
  size?: "xs" | "sm" | "base" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "5xl";
  className?: string;
  /** Override base text explicitly. */
  base?: string;
  /** Override suffix text explicitly. */
  suffix?: string;
  /** When true, use WPW-branded wordmarks for tools that have them. */
  isWpw?: boolean;
}

const SIZE_CLASS: Record<NonNullable<ToolWordmarkProps["size"]>, string> = {
  xs: "text-xs",
  sm: "text-sm",
  base: "text-base",
  lg: "text-lg",
  xl: "text-xl",
  "2xl": "text-2xl",
  "3xl": "text-3xl",
  "4xl": "text-4xl",
  "5xl": "text-5xl",
};

// Gradient classes — exact same strings used in Header.tsx
// Direct blue → magenta, no purple middle stop (per brand spec).
const SUFFIX_GRADIENT =
  "bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent";
const SUB_SUFFIX_GRADIENT =
  "bg-gradient-to-r from-blue-400 to-fuchsia-500 bg-clip-text text-transparent";

export const ToolWordmark = ({
  toolKey,
  compact = false,
  size,
  className,
  base: baseOverride,
  suffix: suffixOverride,
  isWpw = false,
}: ToolWordmarkProps) => {
  const wpwSplit = isWpw ? WPW_WORDMARKS[toolKey] : undefined;
  const split = wpwSplit || TOOL_WORDMARKS[toolKey] || { base: toolKey, suffix: "" };
  const base = baseOverride ?? split.base;
  const suffix = suffixOverride ?? split.suffix;
  const subSuffix = split.subSuffix;

  const resolvedSize = size || (compact ? "sm" : "base");

  return (
    <span
      className={cn(
        "font-bold tracking-tight leading-tight inline-flex items-baseline whitespace-nowrap",
        SIZE_CLASS[resolvedSize],
        className
      )}
    >
      <span className="text-white">{base}</span>
      {suffix && <span className={SUFFIX_GRADIENT}>{suffix}</span>}
      {subSuffix && <span className={SUB_SUFFIX_GRADIENT}>{subSuffix}</span>}
    </span>
  );
};
