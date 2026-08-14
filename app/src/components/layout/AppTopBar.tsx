import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Menu, Search, Bell, LogOut, Settings, User as UserIcon, CreditCard,
  LifeBuoy, Home, Shield, Sparkles, Activity, FileText, Mail,
  Palette, Box, Eye, Users, CheckCircle2, MessageSquare, Store, Layers,
  Scissors, ListChecks, LayoutGrid, Calendar,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useUserTier } from "@/hooks/useUserTier";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { TIER_LABELS, type Tier } from "@/hooks/useToolAccess";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const RENDER_LIMITS: Record<string, number> = {
  free: 0,
  starter: 20,
  advanced: 50,
  complete: 200,
  agency: 999999,
};

const TIER_BADGE_STYLES: Record<Tier, string> = {
  free: "bg-[#2c2c2e] text-white/80 border-[#48484a]",
  starter: "bg-blue-500/15 text-blue-300 border-blue-500/40",    // Starter
  advanced: "bg-purple-500/15 text-purple-300 border-purple-500/40", // Pro
  complete: "bg-gradient-to-r from-blue-500/20 to-fuchsia-500/20 text-white border-pink-500/50", // DesignPro
  agency: "bg-gradient-to-r from-fuchsia-500/20 to-blue-500/20 text-white border-fuchsia-500/40",
};

interface AppTopBarProps {
  onOpenSidebar: () => void;
}

const getInitials = (name: string | null | undefined, email: string | null | undefined) => {
  const source = name?.trim() || email?.split("@")[0] || "U";
  const parts = source.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
};

const getFirstName = (name: string | null | undefined, email: string | null | undefined) => {
  if (name?.trim()) return name.trim().split(/\s+/)[0];
  if (email) return email.split("@")[0];
  return "there";
};

export const AppTopBar = ({ onOpenSidebar }: AppTopBarProps) => {
  const navigate = useNavigate();
  const tier = useUserTier() as Tier;
  const { subscription } = useSubscriptionLimits();
  const [user, setUser] = useState<{ name: string | null; email: string | null }>({
    name: null,
    email: null,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      const u = data?.session?.user;
      if (!u) return;
      const meta = (u.user_metadata || {}) as Record<string, any>;
      const name =
        meta.full_name || meta.name || meta.first_name || meta.display_name || null;
      setUser({ name, email: u.email || null });
    });
  }, []);

  const firstName = getFirstName(user.name, user.email);
  const initials = getInitials(user.name, user.email);
  const isAdmin = isAllowlistedAdmin(user.email);
  const limit = RENDER_LIMITS[tier] ?? 0;
  const used = subscription?.render_count ?? 0;
  const isUnlimited = tier === "agency" || tier === "complete";
  const pctUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const pillColor =
    pctUsed >= 95
      ? "text-red-400 border-red-500/40 bg-red-500/10"
      : pctUsed >= 80
      ? "text-amber-300 border-amber-500/40 bg-amber-500/10"
      : "text-cyan-300 border-cyan-500/40 bg-cyan-500/10";

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/");
  };

  return (
    <header className="fixed top-0 left-0 right-0 h-14 z-40 border-b border-white/10 bg-black/80 backdrop-blur-xl">
      <div className="h-full flex items-center gap-2 sm:gap-4 px-3 sm:px-4">
        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden text-white hover:bg-white/10"
          onClick={onOpenSidebar}
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </Button>

        {/* Logo → Dashboard */}
        <Link to="/dashboard" className="flex items-center gap-2 shrink-0">
          <Home className="w-5 h-5 text-cyan-400 md:hidden" />
          <span className="hidden md:block font-bold text-lg tracking-tight">
            <span className="text-white">Restyle</span>
            <span className="text-cyan-400">Pro</span>
          </span>
        </Link>

        {/* Greeting — hidden on mobile */}
        <div className="hidden md:flex items-center gap-2 min-w-0">
          <span className="text-sm text-white/60">Hi,</span>
          <span className="text-sm font-semibold text-white truncate">
            {firstName} 👋
          </span>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Tier badge */}
        <Link
          to="/billing"
          className={cn(
            "hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-semibold uppercase tracking-wide transition hover:brightness-125",
            TIER_BADGE_STYLES[tier] || TIER_BADGE_STYLES.free
          )}
        >
          {TIER_LABELS[tier] || "Free"}
        </Link>

        {/* Render count pill */}
        <Link
          to="/billing"
          className={cn(
            "flex items-center gap-2 px-2.5 py-1 rounded-full border text-[11px] font-semibold transition hover:brightness-125",
            pillColor
          )}
          aria-label={`${used} of ${isUnlimited ? "unlimited" : limit} renders used`}
        >
          <span className="whitespace-nowrap">
            {used}
            {isUnlimited ? "" : `/${limit}`}
          </span>
          {!isUnlimited && limit > 0 && (
            <span className="hidden sm:block w-10 h-1 rounded-full bg-white/10 overflow-hidden">
              <span
                className="block h-full bg-current transition-all"
                style={{ width: `${pctUsed}%` }}
              />
            </span>
          )}
          <span className="hidden sm:block text-white/60 font-normal">renders</span>
        </Link>

        {/* Admin dropdown — only for allowlisted admins */}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-300 text-[11px] font-bold uppercase tracking-wide hover:bg-fuchsia-500/20 hover:text-fuchsia-200 transition"
                aria-label="Admin menu"
              >
                <Shield className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Admin</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-64 max-h-[80vh] overflow-y-auto bg-neutral-950 border-white/10"
            >
              <DropdownMenuLabel className="text-white/90 flex items-center gap-2">
                <Shield className="w-4 h-4 text-fuchsia-400" />
                Admin Tools
              </DropdownMenuLabel>
              <DropdownMenuSeparator className="bg-white/10" />

              {/* DESIGN ASSETS — top of the admin menu, magenta gradient: the
                  artboard + separated files of the working system, for showing
                  the team. Opens the latest design's assets (/design-assets). */}
              <DropdownMenuItem asChild className="cursor-pointer p-0 mb-1 focus:bg-transparent">
                <Link
                  to="/design-assets"
                  className="flex items-center gap-2 w-full rounded-md px-2 py-2 font-bold text-white shadow-sm"
                  style={{ background: "linear-gradient(90deg,#ec4899,#a21caf)" }}
                >
                  <Sparkles className="w-4 h-4" />
                  Design Assets — Artboard &amp; Files
                </Link>
              </DropdownMenuItem>

              {/* LEAD REPLIES — the email agent's approval queue (trish@ /
                  hello@ / design@). Blue→purple gradient to match the page. */}
              <DropdownMenuItem asChild className="cursor-pointer p-0 mb-1 focus:bg-transparent">
                <Link
                  to="/admin/lead-replies"
                  className="flex items-center gap-2 w-full rounded-md px-2 py-2 font-bold text-white shadow-sm"
                  style={{ background: "linear-gradient(90deg,#2563eb,#9333ea)" }}
                >
                  <Mail className="w-4 h-4" />
                  Lead Replies — Email Agent
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator className="bg-white/10" />

              {/* Content OS in DAILY WORKING ORDER (owner 2026-08-04, filming
                  every day): Director → Shot List → Script Studio → Brand
                  Board → Content Calendar. The nav order IS the flow. */}
              <DropdownMenuItem
                asChild
                className="text-cyan-300 focus:text-cyan-200 focus:bg-cyan-500/10 cursor-pointer"
              >
                <Link to="/admin/content-director">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Content Director
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-cyan-300 focus:text-cyan-200 focus:bg-cyan-500/10 cursor-pointer"
              >
                <Link to="/admin/content-director?tab=shotlist">
                  <ListChecks className="w-4 h-4 mr-2" />
                  Shot List
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-cyan-300 focus:text-cyan-200 focus:bg-cyan-500/10 cursor-pointer"
              >
                <Link to="/admin/script-studio">
                  <FileText className="w-4 h-4 mr-2" />
                  Script Studio
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-cyan-300 focus:text-cyan-200 focus:bg-cyan-500/10 cursor-pointer"
              >
                <Link to="/admin/brand-board">
                  <LayoutGrid className="w-4 h-4 mr-2" />
                  Brand Board
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-cyan-300 focus:text-cyan-200 focus:bg-cyan-500/10 cursor-pointer"
              >
                <Link to="/engine-room?tab=calendar">
                  <Calendar className="w-4 h-4 mr-2" />
                  Content Calendar
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-cyan-300 focus:text-cyan-200 focus:bg-cyan-500/10 cursor-pointer"
              >
                <Link to="/admin/content-studio">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Content Studio
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-cyan-300 focus:text-cyan-200 focus:bg-cyan-500/10 cursor-pointer"
              >
                <Link to="/admin/activity-log">
                  <Activity className="w-4 h-4 mr-2" />
                  Activity Log
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-white/10" />

              {/* Admin Dashboard */}
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin">
                  <Shield className="w-4 h-4 mr-2" />
                  Admin Dashboard
                </Link>
              </DropdownMenuItem>

              {/* PRODUCTION QC — the canonical pair. QC ProductionFlow is the
                  page with the asset-version cards, per-panel cards, the G.E.N.I.E.
                  deterministic slicer + WrapBox ship; Print Production Queue is the
                  paid-order queue. The defunct QC pages (QC Artboard, QC Cut Contour,
                  QC Render) were retired from this menu to stop the confusion — their
                  routes still resolve if hit directly, they're just no longer
                  surfaced in admin navigation. */}
              <DropdownMenuItem
                asChild
                className="text-white focus:text-white focus:bg-white/10 cursor-pointer font-semibold"
              >
                <Link to="/productionflow">
                  <CheckCircle2 className="w-4 h-4 mr-2 text-cyan-400" />
                  QC ProductionFlow
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/print-production">
                  <CheckCircle2 className="w-4 h-4 mr-2 text-cyan-400" />
                  Print Production Queue
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-white/10" />

              {/* Quotes + batch */}
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/quotes">
                  <FileText className="w-4 h-4 mr-2" />
                  Quote Manager
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/batch-render">
                  <Box className="w-4 h-4 mr-2" />
                  Batch Render
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/batch-results">
                  <Box className="w-4 h-4 mr-2" />
                  QA &amp; Curation Studio
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/upscale-single">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Single Upscaler
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/system-health">
                  <Activity className="w-4 h-4 mr-2" />
                  System Health
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/user-renders">
                  <Users className="w-4 h-4 mr-2" />
                  All User Renders
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-white/10" />

              {/* Email / SMS / Marketing */}
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/email-editor">
                  <Mail className="w-4 h-4 mr-2" />
                  Email Editor
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/campaigns">
                  <Mail className="w-4 h-4 mr-2" />
                  Email Campaigns
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/retargeting">
                  <Eye className="w-4 h-4 mr-2" />
                  Retargeting Dashboard
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
                <Link to="/admin/mightymail">
                  <Mail className="w-4 h-4 mr-2" />
                  MightyMail
                </Link>
              </DropdownMenuItem>

              <DropdownMenuSeparator className="bg-white/10" />

              {/* Marketplace + content */}
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
              </DropdownMenuItem>
              <DropdownMenuItem
                asChild
                className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
              >
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {/* Notifications (placeholder) */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden sm:inline-flex text-white/70 hover:text-white hover:bg-white/10"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
        </Button>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex items-center gap-2 rounded-full hover:bg-white/10 p-0.5 transition"
              aria-label="User menu"
            >
              <Avatar className="h-8 w-8 border border-white/20">
                <AvatarFallback className="bg-cyan-500/20 text-cyan-300 text-xs font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 bg-neutral-950 border-white/10">
            <DropdownMenuLabel className="text-white/90">
              <div className="flex flex-col">
                <span className="font-semibold">{user.name || firstName}</span>
                <span className="text-xs text-white/50 font-normal truncate">
                  {user.email}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem asChild className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer">
              <Link to="/account/shop">
                <UserIcon className="w-4 h-4 mr-2" />
                Shop settings
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer">
              <Link to="/billing">
                <CreditCard className="w-4 h-4 mr-2" />
                Billing & plan
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer">
              <Link to="/user-guide">
                <LifeBuoy className="w-4 h-4 mr-2" />
                Help & docs
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-white/10" />
            <DropdownMenuItem
              onClick={handleSignOut}
              className="text-white/80 focus:text-white focus:bg-white/10 cursor-pointer"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
};
