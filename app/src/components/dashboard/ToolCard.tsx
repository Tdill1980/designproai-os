import { Link } from "react-router-dom";
import { Lock, Sparkles, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { TIER_HIERARCHY, TIER_LABELS, type Tier } from "@/hooks/useToolAccess";
import { useUserTier } from "@/hooks/useUserTier";
import { useToolImages } from "@/hooks/useToolImages";
import type { ToolNavItem } from "@/lib/dashboard-nav";
import { ToolWordmark } from "./ToolWordmark";

interface ToolCardProps {
  tool: ToolNavItem;
  compact?: boolean;
}

// Use canonical TIER_LABELS from useToolAccess so badge names stay in
// sync with the rest of the dashboard (Starter / Pro / DesignPro).
const TIER_LABELS_SHORT: Record<Tier, string> = TIER_LABELS;

export const ToolCard = ({ tool, compact = false }: ToolCardProps) => {
  const userTier = useUserTier() as Tier;
  const { data: toolImages } = useToolImages();
  const isFree = userTier === "free";
  const hasAccess = TIER_HIERARCHY.indexOf(userTier) >= TIER_HIERARCHY.indexOf(tool.tier);
  const hardLocked = !hasAccess && !isFree;
  const tryMode = !hasAccess && isFree;
  const comingSoon = tool.comingSoon;
  const Icon = tool.icon;

  // Admin-uploaded hero image (from /admin/homepage-images section:tool-*)
  const imageUrl = toolImages?.[tool.key];

  // Locked / coming-soon cards route to /pricing; unlocked cards open the tool
  const href = comingSoon || hardLocked ? "/pricing" : tool.route;

  return (
    <Link to={href} className="group block h-full">
      <div
        className={cn(
          "relative h-full overflow-hidden rounded-2xl border bg-rp-surface transition-all duration-200 flex flex-col",
          "hover:border-[#48484a] hover:bg-rp-elevated hover:-translate-y-0.5",
          hardLocked && "opacity-65",
          comingSoon
            ? "border-[#48484a]"
            : "border-[#48484a]"
        )}
      >
        {imageUrl ? (
          // ── Image-first "game card" layout ─────────────────────
          <>
            <div className="relative aspect-video overflow-hidden bg-[#0a0a0a]">
              <img
                src={imageUrl}
                alt={tool.label}
                loading="lazy"
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.opacity = "0.3";
                }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/10 to-transparent" />

              {/* Tier / coming-soon badge overlayed on image */}
              <div className="absolute top-2 right-2">
                {comingSoon ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white bg-gradient-rp-pop">
                    Phase 3
                  </span>
                ) : hardLocked ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white/80 bg-black/70 border border-[#48484a]">
                    {TIER_LABELS_SHORT[tool.tier]}
                  </span>
                ) : tryMode ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white bg-gradient-rp-pop inline-flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" />
                    Try it
                  </span>
                ) : (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white/80 bg-black/70 border border-[#48484a]">
                    {TIER_LABELS_SHORT[tool.tier]}
                  </span>
                )}
              </div>

              {/* Wordmark sits on bottom of image */}
              <div className="absolute bottom-2 left-3 right-3">
                <ToolWordmark toolKey={tool.key} size="xl" className="drop-shadow-lg" />
              </div>
            </div>
            <div className="p-3 sm:p-4 flex flex-col gap-2 flex-1">
              <div className="text-[11px] sm:text-xs text-white/75 line-clamp-2 font-inter">
                {tool.description}
              </div>
              <div className="flex items-center justify-between mt-auto pt-1">
                <span
                  className={cn(
                    "text-[11px] font-bold uppercase tracking-[0.1em]",
                    hardLocked ? "text-white/80" : "bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent"
                  )}
                >
                  {comingSoon
                    ? "Notify me"
                    : hardLocked
                    ? "Upgrade"
                    : tryMode
                    ? "View plans"
                    : "Open"}
                </span>
                {hardLocked ? (
                  <Lock className="w-3.5 h-3.5 text-white/80" />
                ) : (
                  <ArrowRight className="w-3.5 h-3.5 text-[#60A5FA] transition group-hover:translate-x-0.5" />
                )}
              </div>
            </div>
          </>
        ) : (
          // ── Icon-tile fallback for tools without admin images ──
          <div className={cn("p-4 sm:p-5 flex flex-col gap-3 h-full", compact && "p-3 gap-2")}>
            <div className="flex items-start justify-between gap-2">
              <div
                className={cn(
                  "flex items-center justify-center rounded-lg shrink-0 bg-rp-elevated border border-[#48484a]",
                  compact ? "w-9 h-9" : "w-10 h-10"
                )}
              >
                <Icon className={cn("text-white/70", compact ? "w-4 h-4" : "w-5 h-5")} />
              </div>
              <div className="flex items-center gap-1.5">
                {comingSoon ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white bg-gradient-rp-pop">
                    Phase 3
                  </span>
                ) : hardLocked ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white/70 bg-rp-elevated border border-[#48484a]">
                    {TIER_LABELS_SHORT[tool.tier]}
                  </span>
                ) : tryMode ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white bg-gradient-rp-pop inline-flex items-center gap-0.5">
                    <Sparkles className="w-2.5 h-2.5" />
                    Try it
                  </span>
                ) : (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white/70 bg-rp-elevated border border-[#48484a]">
                    {TIER_LABELS_SHORT[tool.tier]}
                  </span>
                )}
              </div>
            </div>

            <div className="flex-1 min-w-0">
              <div className="truncate">
                <ToolWordmark
                  toolKey={tool.key}
                  size={compact ? "base" : "lg"}
                />
              </div>
              <div
                className={cn(
                  "text-white/75 mt-1 font-inter",
                  compact ? "text-[11px] line-clamp-1" : "text-xs line-clamp-2"
                )}
              >
                {tool.description}
              </div>
            </div>

            <div className="flex items-center justify-between mt-auto pt-1">
              <span
                className={cn(
                  "text-[11px] font-bold uppercase tracking-[0.1em]",
                  hardLocked ? "text-white/80" : "bg-gradient-to-r from-blue-500 to-fuchsia-500 bg-clip-text text-transparent"
                )}
              >
                {comingSoon
                  ? "Notify me"
                  : hardLocked
                  ? "Upgrade"
                  : tryMode
                  ? "View plans"
                  : "Open"}
              </span>
              {hardLocked ? (
                <Lock className="w-3.5 h-3.5 text-white/80" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5 text-[#60A5FA] transition group-hover:translate-x-0.5" />
              )}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
};
