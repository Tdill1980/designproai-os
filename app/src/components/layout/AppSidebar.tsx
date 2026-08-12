import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Lock, Sparkles, Crown, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUserTier } from "@/hooks/useUserTier";
import { TIER_HIERARCHY, TIER_LABELS, type Tier } from "@/hooks/useToolAccess";
import { NAV_GROUPS } from "@/lib/dashboard-nav";
import { ToolWordmark } from "@/components/dashboard/ToolWordmark";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface SidebarTooltipProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

const SidebarTooltip = ({ title, description, children }: SidebarTooltipProps) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent
      side="right"
      sideOffset={10}
      className="max-w-[260px] bg-rp-surface border-[#48484a] text-white"
    >
      <div className="font-poppins text-[13px] font-bold text-white leading-tight">
        {title}
      </div>
      <div className="mt-1 text-[12px] text-white/80 leading-snug">
        {description}
      </div>
    </TooltipContent>
  </Tooltip>
);

// Compact tier indicator shown at the top of the sidebar.
// Replaces the old "Current plan" KPI card so the dashboard center
// has less clutter while plan info stays one glance away.
const TIER_PILL_STYLES: Record<Tier, string> = {
  free: "bg-rp-elevated text-white/80 border-[#48484a]",
  starter: "bg-blue-500/15 text-blue-300 border-blue-500/40",
  advanced: "bg-purple-500/15 text-purple-300 border-purple-500/40",
  complete:
    "bg-gradient-to-r from-blue-500/25 to-fuchsia-500/25 text-white border-pink-400/60",
  agency:
    "bg-gradient-to-r from-fuchsia-500/25 to-blue-500/25 text-white border-fuchsia-400/60",
};

interface AppSidebarProps {
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  desktopHidden?: boolean;
}

const userHasTier = (userTier: Tier, required: Tier): boolean => {
  return TIER_HIERARCHY.indexOf(userTier) >= TIER_HIERARCHY.indexOf(required);
};

interface SidebarBodyProps {
  onNavigate?: () => void;
}

const SidebarBody = ({ onNavigate }: SidebarBodyProps) => {
  const location = useLocation();
  const userTier = useUserTier() as Tier;
  const isFree = userTier === "free";
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      const email = data?.session?.user?.email ?? null;
      const userId = data?.session?.user?.id ?? null;
      if (cancelled) return;
      if (isAllowlistedAdmin(email)) {
        setIsAdmin(true);
        return;
      }
      if (!userId) {
        setIsAdmin(false);
        return;
      }
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId)
        .in("role", ["admin", "tester"])
        .limit(1)
        .maybeSingle();
      if (!cancelled) setIsAdmin(!!roleRow);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isActive = (route: string) =>
    location.pathname === route || location.pathname.startsWith(route + "/");

  return (
    <TooltipProvider delayDuration={150}>
    <nav className="flex flex-col gap-5 px-3 py-4 text-sm font-inter h-full">
      {/* ── Compact tier pill (replaces Current Plan KPI) ── */}
      <SidebarTooltip
        title={`Current plan: ${TIER_LABELS[userTier] || "Free"}`}
        description="View or change your subscription plan, render credits, and billing"
      >
        <Link
          to="/billing"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-2 px-2.5 py-2 rounded-md border transition hover:brightness-125",
            TIER_PILL_STYLES[userTier] || TIER_PILL_STYLES.free
          )}
          aria-label="Current plan"
        >
          <Crown className="w-3.5 h-3.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[9px] uppercase tracking-[0.14em] text-white/70 font-bold leading-none">
              Current plan
            </div>
            <div className="text-xs font-bold leading-tight mt-0.5 truncate">
              {TIER_LABELS[userTier] || "Free"}
            </div>
          </div>
        </Link>
      </SidebarTooltip>

      {isAdmin && (
        <div className="flex flex-col gap-1">
          <div className="px-2 mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-fuchsia-300/90">
            Admin
          </div>
          <SidebarTooltip
            title="Admin Dashboard"
            description="Full admin control — users, roles, content, settings, and platform tools"
          >
            <Link
              to="/admin"
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 transition border",
                isActive("/admin")
                  ? "bg-fuchsia-500/15 text-fuchsia-200 border-fuchsia-400/50"
                  : "text-fuchsia-300 border-fuchsia-500/30 hover:bg-fuchsia-500/10 hover:text-fuchsia-200"
              )}
            >
              <Shield className="w-4 h-4 shrink-0" />
              <span className="truncate">Admin Dashboard</span>
            </Link>
          </SidebarTooltip>
        </div>
      )}

      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="flex flex-col gap-1">
          <div className="px-2 mb-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white/80">
            {group.label}
          </div>
          {group.items.map((item) => {
            if (item.type === "link") {
              const Icon = item.icon;
              const active = isActive(item.route);
              return (
                <SidebarTooltip
                  key={item.route}
                  title={item.label}
                  description={item.description || item.label}
                >
                  <Link
                    to={item.route}
                    onClick={onNavigate}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-2 transition",
                      active
                        ? "bg-gradient-blue-deep-subtle text-white border-l-2 border-[#60A5FA]"
                        : "text-white/80 hover:text-white hover:bg-rp-elevated"
                    )}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </SidebarTooltip>
              );
            }

            const tool = item.tool;
            const Icon = tool.icon;
            const active = isActive(tool.route);
            const hasAccess = userHasTier(userTier, tool.tier);
            const hardLocked = !hasAccess && !isFree;
            const tryMode = !hasAccess && isFree;
            const comingSoon = tool.comingSoon;

            const statusSuffix = comingSoon
              ? " — Coming soon"
              : hardLocked
              ? ` — Upgrade to ${TIER_LABELS[tool.tier] || tool.tier}`
              : tryMode
              ? " — Try mode (free preview)"
              : "";

            return (
              <SidebarTooltip
                key={tool.key}
                title={`${tool.label}${statusSuffix}`}
                description={tool.description}
              >
                <Link
                  to={comingSoon ? "/pricing" : tool.route}
                  onClick={onNavigate}
                  className={cn(
                    "group flex items-center gap-2.5 rounded-md px-2.5 py-2 transition relative",
                    active
                      ? "bg-gradient-blue-deep-subtle text-white border-l-2 border-[#60A5FA]"
                      : "text-white/80 hover:text-white hover:bg-rp-elevated",
                    hardLocked && "opacity-60"
                  )}
                  aria-label={
                    comingSoon
                      ? `${tool.label} — coming soon`
                      : hardLocked
                      ? `${tool.label} — upgrade required`
                      : tool.label
                  }
                >
                  <Icon className="w-4 h-4 shrink-0 text-white/70" />
                  <span className="truncate flex-1">
                    <ToolWordmark toolKey={tool.key} compact />
                  </span>
                  {comingSoon && (
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded text-white bg-gradient-rp-pop">
                      Soon
                    </span>
                  )}
                  {hardLocked && !comingSoon && (
                    <Lock className="w-3 h-3 shrink-0 text-white/80" />
                  )}
                  {tryMode && !comingSoon && (
                    <Sparkles className="w-3 h-3 shrink-0 text-[#60A5FA]" />
                  )}
                </Link>
              </SidebarTooltip>
            );
          })}
        </div>
      ))}

      {isFree && (
        <div className="mt-auto px-2 pt-4 border-t border-[#48484a]">
          <div className="rounded-lg bg-rp-surface border border-[#48484a] p-3">
            <div className="text-xs font-bold text-white mb-1 font-poppins">
              Unlock renders
            </div>
            <div className="text-[11px] text-white/80 mb-2">
              Every tool is in try mode. Upgrade to generate real renders.
            </div>
            <Link
              to="/pricing"
              onClick={onNavigate}
              className="block text-center text-[11px] font-semibold rounded-md py-1.5 bg-gradient-rp-pop text-white hover:brightness-110 transition"
            >
              See plans →
            </Link>
          </div>
        </div>
      )}
    </nav>
    </TooltipProvider>
  );
};

/**
 * Desktop: fixed sticky sidebar beneath the existing Header
 * Mobile:  off-canvas Sheet drawer opened from the bottom tab bar
 */
export const AppSidebar = ({ mobileOpen = false, onMobileClose, desktopHidden = false }: AppSidebarProps) => {
  return (
    <>
      {/* Desktop */}
      <aside
        className={cn(
          "hidden md:flex fixed left-0 top-[72px] bottom-0 w-60 z-30 flex-col overflow-y-auto border-r border-[#48484a] bg-rp-root transition-transform duration-200",
          desktopHidden && "md:-translate-x-full",
        )}
        aria-label="Dashboard navigation"
      >
        <SidebarBody />
      </aside>

      {/* Mobile drawer */}
      <Sheet open={mobileOpen} onOpenChange={(open) => !open && onMobileClose?.()}>
        <SheetContent
          side="left"
          className="w-72 p-0 bg-rp-root border-r border-[#48484a]"
        >
          <SheetHeader className="px-4 py-3 border-b border-[#48484a]">
            <SheetTitle className="text-white text-left font-poppins">
              <ToolWordmark toolKey="restylepro" size="lg" />
            </SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto h-[calc(100%-60px)]">
            <SidebarBody onNavigate={onMobileClose} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
