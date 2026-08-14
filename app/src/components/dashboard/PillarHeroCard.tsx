import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { ArrowRight, Lock, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserTier } from "@/hooks/useUserTier";
import { useIsWpwTenant } from "@/hooks/useIsWpwTenant";
import { TIER_HIERARCHY, type Tier } from "@/hooks/useToolAccess";
import {
  DASHBOARD_TOOLS,
  type DashboardPillar,
  type ToolNavItem,
  toolsByPillar,
} from "@/lib/dashboard-nav";
import { ToolWordmark } from "./ToolWordmark";
import { PillarOrderList } from "./PillarOrderList";
import { PillarPastJobsList } from "./PillarPastJobsList";
import { PillarRecentActivityList } from "./PillarRecentActivityList";

interface PillarHeroCardProps {
  pillar: DashboardPillar;
  index: number; // 1, 2, 3 — big pillar index
  /**
   * Optional slot that replaces the primary anchor section.
   * Used by the Profit pillar to render the Order Revenue card
   * in place of the QuickQuote CTA.
   */
  replacePrimaryWith?: ReactNode;
}

const findTool = (key: string): ToolNavItem | undefined =>
  DASHBOARD_TOOLS.find((t) => t.key === key);

const userHasTier = (userTier: Tier, required: Tier): boolean =>
  TIER_HIERARCHY.indexOf(userTier) >= TIER_HIERARCHY.indexOf(required);

/**
 * One of the three big "pillar hero" cards on RestyleDashboard.
 *
 * Each card features the pillar's anchor tool as the primary CTA.
 * All 15 tools are reachable from the sidebar — the center of the
 * dashboard just shows these three major cards plus CreatorMarket
 * and the live data row.
 *
 * Layout (desktop):
 *   ┌─────────────────────────────┐
 *   │ 01                          │
 *   │ DESIGN                      │
 *   │ Claim tagline               │
 *   │                             │
 *   │ [Primary anchor wordmark]   │
 *   │ description                 │
 *   │ [Open →]                    │
 *   │                             │
 *   │ Also in this pillar:        │
 *   │ ColorPro · FadeWraps · ...  │
 *   └─────────────────────────────┘
 */
export const PillarHeroCard = ({ pillar, index, replacePrimaryWith }: PillarHeroCardProps) => {
  const userTier = useUserTier() as Tier;
  const { data: isWpw = false } = useIsWpwTenant();
  const isFree = userTier === "free";

  const primaryTool = findTool(pillar.primaryAnchor);
  const secondary = pillar.secondaryAnchor ? findTool(pillar.secondaryAnchor) : undefined;

  // Design pillar: DesignProAI is Phase 3 — demote it to the chips row
  // so the WPW design jobs list takes center stage.
  const demotePrimary = pillar.id === "design" && !!primaryTool?.comingSoon;
  const primary = demotePrimary ? undefined : primaryTool;
  const others = toolsByPillar(pillar.id).filter(
    (t) => t.key !== (demotePrimary ? "__none__" : pillar.primaryAnchor) && t.key !== pillar.secondaryAnchor
  );

  const indexStr = String(index).padStart(2, "0");

  // Compute lock state for the primary anchor
  const primaryHasAccess = primary
    ? userHasTier(userTier, primary.tier)
    : true;
  const primaryHardLocked = !!primary && !primaryHasAccess && !isFree;
  const primaryTryMode = !!primary && !primaryHasAccess && isFree;
  const primaryComingSoon = !!primary?.comingSoon;

  return (
    <section
      id={`pillar-${pillar.id}`}
      className="relative overflow-hidden rounded-2xl border border-[#48484a] bg-rp-surface p-5 sm:p-6 flex flex-col h-full"
    >
      {/* Accent bar on left edge */}
      <div
        className={cn(
          "absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl",
          pillar.accent
        )}
      />

      {/* ── Header: number + label + claim ── */}
      <div className="pl-2 mb-4">
        <div
          className={cn(
            "font-montserrat text-3xl sm:text-4xl font-bold leading-none tracking-tight bg-clip-text text-transparent",
            pillar.accent
          )}
        >
          {indexStr}
        </div>
        <h2 className="font-montserrat text-xl sm:text-2xl font-bold text-white uppercase tracking-tight leading-none mt-1">
          {pillar.label}
        </h2>
        <p className="text-[11px] sm:text-xs text-white/80 font-inter mt-1.5 leading-snug">
          {pillar.claim}
        </p>
      </div>

      {/* ── Primary anchor tool (or replacement slot) ── */}
      {replacePrimaryWith ? (
        <div className="pl-2 mb-3">{replacePrimaryWith}</div>
      ) : (
        primary && (
          <div className="pl-2 mb-3">
            <Link
              to={primaryComingSoon || primaryHardLocked ? "/pricing" : primary.route}
              className="block rounded-xl border border-[#48484a] bg-rp-elevated hover:border-white/40 hover:bg-rp-elevated transition p-4 group"
            >
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <ToolWordmark toolKey={primary.key} size="xl" isWpw={isWpw} />
                {primaryComingSoon ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white bg-gradient-rp-pop shrink-0">
                    Phase 3
                  </span>
                ) : primaryHardLocked ? (
                  <Lock className="w-3.5 h-3.5 text-white/60 shrink-0 mt-1" />
                ) : primaryTryMode ? (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded text-white bg-gradient-rp-pop inline-flex items-center gap-0.5 shrink-0">
                    <Sparkles className="w-2.5 h-2.5" />
                    Try
                  </span>
                ) : null}
              </div>
              <p className="text-xs text-white/75 font-inter leading-snug">
                {primary.description}
              </p>
              <div className="flex items-center gap-1 mt-3 text-[11px] font-bold uppercase tracking-[0.1em] text-white group-hover:translate-x-0.5 transition">
                {primaryComingSoon
                  ? "Notify me"
                  : primaryHardLocked
                  ? "Upgrade"
                  : primaryTryMode
                  ? "Try free"
                  : "Open"}
                <ArrowRight className="w-3 h-3" />
              </div>
            </Link>
          </div>
        )
      )}

      {/* ── Secondary anchor tool (Profit pillar only) ── */}
      {secondary && (
        <div className="pl-2 mb-3">
          <Link
            to={secondary.route}
            className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg border border-[#48484a] bg-rp-elevated hover:bg-rp-elevated transition"
          >
            <div className="flex items-center gap-2 min-w-0">
              <ToolWordmark toolKey={secondary.key} size="sm" isWpw={isWpw} />
              <span className="text-[10px] text-white/70 truncate font-inter hidden sm:inline">
                {secondary.description}
              </span>
            </div>
            <ArrowRight className="w-3 h-3 text-white/70 shrink-0" />
          </Link>
        </div>
      )}

      {/* ── WPW order mini-list (Design = design jobs, Output = production) ── */}
      {pillar.id === "design" && (
        <div className="pl-2 mb-2">
          <PillarOrderList stage="design" />
        </div>
      )}
      {pillar.id === "output" && (
        <div className="pl-2 mb-2">
          <PillarOrderList stage="production" />
        </div>
      )}
      {/* ── Profit pillar: recent activity + past completed jobs ── */}
      {pillar.id === "profit" && (
        <div className="pl-2 mb-2 space-y-3">
          <PillarRecentActivityList />
          <PillarPastJobsList />
        </div>
      )}

      {/* ── "Also in this pillar" chip row ── */}
      {others.length > 0 && (
        <div className="mt-auto pt-3 pl-2 border-t border-[#48484a]">
          <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/60 mb-2">
            Also in this pillar
          </div>
          <div className="flex flex-wrap gap-1.5">
            {others.map((t) => {
              const hasAccess = userHasTier(userTier, t.tier);
              const hardLocked = !hasAccess && !isFree;
              return (
                <Link
                  key={t.key}
                  to={t.comingSoon || hardLocked ? "/pricing" : t.route}
                  className={cn(
                    "text-[10px] font-semibold px-2 py-1 rounded border border-[#48484a] bg-rp-elevated hover:bg-rp-elevated hover:border-white/40 transition",
                    hardLocked && "opacity-60"
                  )}
                  title={t.description}
                >
                  <ToolWordmark toolKey={t.key} size="xs" isWpw={isWpw} />
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
};
