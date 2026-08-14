import { cn } from "@/lib/utils";

/**
 * Two-color tool wordmark.
 *
 * Matches the existing Header.tsx treatment for "DesignProAI" exactly:
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

// One entry per key in the navigation registry. A key with no entry renders
// its raw key, which is how "revisionsource", "productionjobs" and "genieqc"
// reached the sidebar in lowercase and unspaced.
const TOOL_WORDMARKS: Record<string, WordmarkSplit> = {
  designpro:        { base: "Design",     suffix: "Pro", subSuffix: "AI" },
  revisionsource:   { base: "Revision\u00A0",   suffix: "source" },
  productionjobs:   { base: "Production\u00A0", suffix: "jobs" },
  genieqc:          { base: "GENIE\u00A0",      suffix: "QC" },
  wrapbox:          { base: "Wrap",       suffix: "Box" },
  gallery:          { base: "Gallery",    suffix: "" },
  shopengine:       { base: "Shop",       suffix: "Engine" },
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
