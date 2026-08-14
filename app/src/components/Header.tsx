import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "./ui/sheet";
import { Menu, ChevronDown, Rotate3D, Sparkles, Box, Zap, Camera, Store, Shield, Handshake, Settings, LogIn, LogOut, Activity, Calculator, Car, Scissors, Printer, Phone, Calendar, Mail, Stamp, ListChecks, Rocket, CreditCard, Building2, Package, LayoutDashboard, SplitSquareHorizontal, LayoutGrid, FolderOpen, FileText, MessageCircle, Rss, BarChart3 } from "lucide-react";
import React, { useState, useEffect, memo } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Badge } from "./ui/badge";
import { useSubscriptionLimits } from "@/hooks/useSubscriptionLimits";
import { useIsAppRoute } from "@/hooks/useIsAppRoute";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin, isWpwTenantMember } from "@/lib/admin-allowlist";
import { NAV_GROUPS } from "@/lib/dashboard-nav";
import { SproketQueueWidget } from "@/components/queue/SproketQueueWidget";
import { RpToken } from "@/components/RpToken";


const RENDER_LIMITS: Record<string, number> = {
  starter: 20,
  advanced: 50,
  complete: 200,
  agency: 999999,
  free: 0
};
// Read the persisted Supabase session user straight from localStorage so the
// header knows you're logged in INSTANTLY — even when getSession()/
// onAuthStateChange stall (auth-lock contention) and would otherwise leave the
// header showing "Log In" (and hiding the Dashboard/Orders links) while you're
// actually signed in.
const readStoredUser = (): any => {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith("sb-") || !k.endsWith("-auth-token")) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const u = parsed?.user || parsed?.currentSession?.user || parsed?.session?.user;
      if (u) return u;
    }
  } catch {
    // ignore (privacy mode / unparseable)
  }
  return null;
};

const HeaderComponent = () => {
  const location = useLocation();
  const isAppRoute = useIsAppRoute();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [user, setUser] = useState<any>(() => readStoredUser());
  const [shopName, setShopName] = useState<string | null>(null);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [tokenBalance, setTokenBalance] = useState<number>(0);
  const { subscription } = useSubscriptionLimits();
  const isOwner = user?.email?.toLowerCase() === 'tdill@restyleproai.com';
  // WPW-tenant access (Trish, Lance, Brice, Jackson + tdill) — drives the
  // "WPW Engine Room" dropdown link that sits above Marketing Hub.
  const showWpwEngineRoom = isWpwTenantMember(user?.email);
  // Admin gating for the "Admin" dropdown / mobile section. Non-admin
  // subscribers must not see admin-only emails (RP -> Shop sales templates,
  // WPW tenant emails, internal tools). Falls through to user_roles when
  // the email is not on the static allowlist.
  const showAdminMenu = isAdminUser || isAllowlistedAdmin(user?.email);

  useEffect(() => {
    // Only promote to a user here; never clobber the optimistic localStorage
    // user with a transient null (getSession can resolve null while stalling).
    supabase.auth.getSession().then(({ data }) => {
      if (data?.session?.user) setUser(data.session.user);
    });

    const { data: { subscription: authSubscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Trust real auth events. Ignore a null INITIAL_SESSION (it can fire
      // null under lock contention) so we don't flip a logged-in header to
      // "Log In"; a genuine SIGNED_OUT still clears it.
      if (session?.user) {
        setUser(session.user);
      } else if (event === "SIGNED_OUT") {
        setUser(null);
      }
    });

    return () => authSubscription.unsubscribe();
  }, []);

  // Load the shop_name so the "Hi, {name}" pill says "RoyaltyWraps" instead
  // of "info" (email local part fallback). Matches the lookup the dashboard
  // already uses in RestyleDashboardContent.
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setShopName(null);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("shop_profiles")
        .select("shop_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) setShopName(data?.shop_name?.trim() || null);
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const displayName =
    shopName
    || user?.user_metadata?.company_name
    || user?.user_metadata?.first_name
    || user?.email?.split("@")[0]
    || "there";

  // Pull the user's design-token balance so the nav shows the same RP coin
  // the dashboard does. Mirrors the lookup in AiPanelGenerator so we stay
  // consistent with the source of truth (user_tokens.balance).
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setTokenBalance(0);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("user_tokens")
        .select("balance")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setTokenBalance((data as { balance?: number } | null)?.balance ?? 0);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // Resolve admin status from user_roles for users not on the static
  // allowlist. Email allowlist match is handled inline via isAllowlistedAdmin.
  useEffect(() => {
    let cancelled = false;
    if (!user?.id) {
      setIsAdminUser(false);
      return;
    }
    if (isAllowlistedAdmin(user.email)) {
      setIsAdminUser(true);
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id)
        .in('role', ['admin', 'tester'])
        .limit(1)
        .maybeSingle();
      if (!cancelled) setIsAdminUser(!!data);
    })();
    return () => { cancelled = true; };
  }, [user?.id, user?.email]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };
  
  const isActive = (path: string) => location.pathname === path;

  // The account and admin menus were three separate hand-written lists, ~880
  // lines between them, pointing almost entirely at RestylePro surfaces this
  // system does not serve. They are one list each now, and every destination
  // is a route the router declares.
  const AccountMenuItems = () => (
    <>
      <DropdownMenuItem asChild>
        <Link to="/dashboard" className="cursor-pointer w-full min-h-[44px] flex items-center gap-2">
          <LayoutDashboard className="h-4 w-4 text-cyan-400" />
          <span className="text-foreground font-semibold">ShopEngine</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/designpro/jobs" className="cursor-pointer w-full min-h-[44px] flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-cyan-400" />
          <span className="text-foreground font-semibold">Production jobs</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/designpro/wrapbox" className="cursor-pointer w-full min-h-[44px] flex items-center gap-2">
          <Package className="h-4 w-4 text-cyan-400" />
          <span className="text-foreground font-semibold">WrapBox</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem asChild>
        <Link to="/gallery" className="cursor-pointer w-full min-h-[44px] flex items-center gap-2">
          <Camera className="h-4 w-4 text-muted-foreground" />
          <span className="text-foreground font-semibold">Gallery</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <Link to="/pricing" className="cursor-pointer w-full min-h-[44px] flex items-center gap-2">
          <CreditCard className="h-4 w-4 text-muted-foreground" />
          <span className="text-foreground font-semibold">Plans &amp; pricing</span>
        </Link>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {user ? (
        <DropdownMenuItem asChild>
          <Button onClick={handleLogout} variant="ghost" size="sm" className="w-full justify-start min-h-[44px]">
            <LogOut className="h-4 w-4 mr-2" />
            <span className="text-muted-foreground font-semibold">Hi, {displayName} — Log Out</span>
          </Button>
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem asChild>
          <Link to="/login" className="cursor-pointer w-full min-h-[44px] flex items-center gap-2">
            <LogIn className="h-4 w-4 text-cyan-400" />
            <span className="text-cyan-400 font-bold">Log In</span>
          </Link>
        </DropdownMenuItem>
      )}
    </>
  );

  const AdminMenuItems = () => (
    <>
      {[
        ["/admin", "Admin dashboard"],
        ["/admin/production-packs", "Production packs"],
        ["/admin/production-files", "Production files"],
        ["/admin/production-test", "Production test bench"],
        ["/admin/designpanelpro-manager", "DesignPanelPro manager"],
        ["/admin/print-production", "Print production"],
        ["/admin/gallery", "Gallery"],
        ["/admin/gallery-manager", "Gallery manager"],
        ["/admin/designpro-v2-test", "DesignPro v2 test bench"],
      ].map(([route, label]) => (
        <DropdownMenuItem key={route} asChild>
          <Link to={route} className="cursor-pointer w-full min-h-[44px] flex items-center gap-2">
            <Shield className="h-3.5 w-3.5 text-cyan-400" />
            <span className="text-foreground font-semibold">{label}</span>
          </Link>
        </DropdownMenuItem>
      ))}
    </>
  );

  // Both menus are built from the same navigation registry the sidebar reads,
  // so the top nav cannot drift away from what the router actually serves.
  // The hand-written menus this replaced were inherited from the suite the
  // shell was copied from: 61 of their 75 destinations were RestylePro
  // surfaces this system does not serve, and every one of them landed the
  // operator on the 404 page.
  const MobileNavLinks = () => (
    <>
      {NAV_GROUPS.map((group) => (
        <div key={group.id} className="mb-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
            {group.label}
          </h4>
          {group.items.map((item) => {
            const route = item.type === "tool" ? item.tool.route : item.route;
            const label = item.type === "tool" ? item.tool.label : item.label;
            const Icon = item.type === "tool" ? item.tool.icon : item.icon;
            return (
              <Link
                key={route}
                to={route}
                onClick={() => setIsOpen(false)}
                className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive(route) ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
              >
                <Icon className="h-4 w-4 text-cyan-400" />
                {label}
              </Link>
            );
          })}
        </div>
      ))}
      {showAdminMenu && (
        <div className="mb-2">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">
            Admin
          </h4>
          <Link
            to="/admin"
            onClick={() => setIsOpen(false)}
            className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive("/admin") ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
          >
            <LayoutDashboard className="h-4 w-4 text-cyan-400" />
            Admin dashboard
          </Link>
        </div>
      )}
    </>
  );

  const NavLinks = () => (
    <>
      {NAV_GROUPS.filter((group) => group.items.length > 0).map((group) => (
        <DropdownMenu key={group.id}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="text-sm font-bold text-foreground hover:text-primary flex items-center gap-1"
            >
              {group.label} <ChevronDown className="w-3 h-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="bg-card border-border w-64 z-[100]">
            {group.items.map((item) => {
              const route = item.type === "tool" ? item.tool.route : item.route;
              const label = item.type === "tool" ? item.tool.label : item.label;
              const description =
                item.type === "tool" ? item.tool.description : item.description;
              return (
                <DropdownMenuItem key={route} asChild>
                  <Link to={route} className="cursor-pointer w-full min-h-[44px] flex flex-col items-start justify-center gap-0.5">
                    <span className="text-foreground font-semibold">{label}</span>
                    {description && (
                      <span className="text-xs text-muted-foreground leading-snug">{description}</span>
                    )}
                  </Link>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      ))}
    </>
  );

  // Header is now persistent on every route (marketing + app).
  // isAppRoute is still imported so future admin/user variants can diverge,
  // but the header itself no longer self-hides on /dashboard etc.
  void isAppRoute;

  return (
    <header className="border-b border-[#1c1c1e] bg-[#0a0a0a] sticky top-0 z-50">
      <div className="container mx-auto px-2 sm:px-6">
        <div className="header-container">
          <Link to="/" className="header-logo flex items-center gap-0.5 flex-shrink-0">
            <img
              src="/sproket-rocket-logo.png"
              alt="Sproket"
              className="h-10 sm:h-12 md:h-14 w-auto object-contain -mr-1"
            />
            <div className="flex flex-col leading-none">
              <span className="text-xl sm:text-2xl md:text-3xl font-bold tracking-tight">
                <span className="text-white">Design</span>
                <span className="bg-gradient-to-r from-blue-500 to-purple-500 bg-clip-text text-transparent">Pro</span>
                <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">AI</span>
                <span className="text-zinc-400 text-[11px] sm:text-xs align-super ml-0.5">&#8482;</span>
              </span>
              <span className="text-[11px] sm:text-xs md:text-sm font-medium italic bg-gradient-to-r from-purple-400 to-pink-400 bg-clip-text text-transparent hidden sm:block">
                Vehicle Wrap Design System&#8482;
              </span>
            </div>
          </Link>
          
          {/* Mobile Menu */}
          <Sheet open={isOpen} onOpenChange={setIsOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden min-w-[44px] min-h-[44px]">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] bg-card border-border">
              <SheetTitle className="sr-only">Navigation Menu</SheetTitle>
              <nav className="flex flex-col gap-2 mt-8">
                <MobileNavLinks />
                <div className="flex flex-col gap-3 pt-4 border-t border-border">
                  {user ? (
                    <>
                      <button
                        onClick={() => { handleLogout(); setIsOpen(false); }}
                        className="text-sm font-medium text-muted-foreground px-2 text-left hover:text-primary transition-colors"
                        title="Tap to log out"
                      >
                        Hi, <span className="text-foreground">{displayName}</span>
                      </button>
                      {subscription && subscription.tier !== 'agency' && subscription.tier !== 'complete' && (() => {
                        const limit = RENDER_LIMITS[subscription.tier] || 0;
                        const used = subscription.render_count || 0;
                        const usedPct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                        return (
                          <Link to="/pricing" onClick={() => setIsOpen(false)} className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border border-border/50 bg-card/80 hover:bg-card transition-colors">
                            <div className="flex items-center justify-between gap-4">
                              <span className="text-xs text-muted-foreground font-medium">Renders</span>
                              <span className="text-xs font-semibold text-foreground">{used}<span className="text-muted-foreground font-normal">/{limit}</span></span>
                            </div>
                            <div className="w-full h-1.5 rounded-full bg-border/60 overflow-hidden">
                              <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-fuchsia-500 transition-all duration-300" style={{ width: `${usedPct}%` }} />
                            </div>
                          </Link>
                        );
                      })()}
                      <Button variant="outline" size="sm" asChild className="w-full min-h-[44px]">
                        <Link to="/pricing" onClick={() => setIsOpen(false)}>Plans &amp; pricing</Link>
                      </Button>
                      <Button onClick={() => { handleLogout(); setIsOpen(false); }} variant="outline" size="sm" className="w-full min-h-[44px]">
                        Log Out
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button variant="gradient" size="sm" asChild className="w-full min-h-[44px]">
                        <Link to="/signup" onClick={() => setIsOpen(false)}>Start Free — 3 Tokens</Link>
                      </Button>
                      <Button variant="outline" size="sm" asChild className="w-full min-h-[44px]">
                        <Link to="/login" onClick={() => setIsOpen(false)}>Log In</Link>
                      </Button>
                    </>
                  )}
                </div>
              </nav>
            </SheetContent>
          </Sheet>

          {/* Desktop Navigation - Suite buttons next to logo */}
          <nav className="hidden lg:flex items-center gap-3 ml-4">
            <NavLinks />
          </nav>
          
          {/* Desktop Right Side - lean set, everything else in sidebar + Menu */}
          <div className="hidden lg:flex items-center gap-3 ml-auto">
            <Link
              to="/designpro/generate"
              className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                isActive('/designpro/generate') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-foreground">Design</span><span className="text-gradient-designpro">Pro™</span>
            </Link>

            <span className="text-muted-foreground/40">|</span>

            <Link
              to="/gallery"
              className={`text-sm font-semibold transition-colors ${
                isActive('/gallery') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <span className="bg-gradient-to-r from-cyan-300 via-blue-300 to-fuchsia-300 bg-clip-text text-transparent font-semibold">Gallery</span>
            </Link>

            <span className="text-muted-foreground/40">|</span>

            <Link
              to="/designpro/jobs"
              className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                isActive('/designpro/jobs') ? 'text-primary' : 'bg-gradient-to-r from-blue-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent hover:from-blue-300 hover:via-purple-300 hover:to-fuchsia-300'
              }`}
            >
              <ListChecks className="h-3.5 w-3.5 text-purple-400" />
              Production jobs
            </Link>

            <span className="text-muted-foreground/40">|</span>

            {/* Token balance pill — surfaces the user's design-token count
                next to the Try CTA so logged-in buyers can see they already
                own credits. Hidden when balance is 0 (Try CTA covers them). */}
            {user && tokenBalance > 0 && (
              <>
                <span className="text-muted-foreground/40">|</span>
                <Link
                  to="/pricing"
                  title={`${tokenBalance} design token${tokenBalance === 1 ? "" : "s"} — $${tokenBalance * 25} value`}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-cyan-400/40 bg-cyan-400/5 hover:bg-cyan-400/10 transition"
                >
                  <RpToken size="sm" showBadge={false} />
                  <span className="text-sm font-bold text-cyan-300 leading-none">
                    {tokenBalance}
                  </span>
                </Link>
              </>
            )}

            {user && (
              <>
                <span className="text-muted-foreground/40">|</span>
                <Link
                  to="/dashboard"
                  className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                    isActive('/dashboard') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <LayoutDashboard className="h-3.5 w-3.5 text-cyan-400" />
                  Dashboard
                </Link>
                <span className="text-muted-foreground/40">|</span>
                <Link
                  to="/designpro/wrapbox"
                  className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                    isActive('/designpro/wrapbox') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Package className="h-3.5 w-3.5 text-cyan-400" />
                  WrapBox
                </Link>
                <span className="text-muted-foreground/40">|</span>
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new Event("restylepro:open-onboarding-wizard"))}
                  className="text-sm font-semibold transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />
                  Setup
                </button>
              </>
            )}

            {showAdminMenu && <span className="text-muted-foreground/40">|</span>}

            {showAdminMenu && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-foreground hover:text-primary">
                  <Shield className="w-3.5 h-3.5 mr-1 text-cyan-400" />
                  Admin <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border w-64 z-[100] max-h-[80vh] overflow-y-auto">
                <AdminMenuItems />
              </DropdownMenuContent>
            </DropdownMenu>}
          </div>

          {/* Mobile: Visualizer Suite + Menu Dropdown */}
          <div className="flex lg:hidden items-center gap-2">
            {/* Mobile compact suite buttons removed - now in Sheet */}
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-foreground hover:text-primary">
                  Menu <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border w-56 z-[100] max-h-[80vh] overflow-y-auto">
                <AccountMenuItems />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Desktop: Log In / User Greeting + Menu Dropdown */}
          <div className="hidden lg:flex items-center gap-2 lg:gap-3">
            {user && <SproketQueueWidget />}
            {user ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={handleLogout}
                  className="text-sm font-medium text-muted-foreground whitespace-nowrap hover:text-primary transition-colors cursor-pointer"
                  title="Click to log out"
                >
                  Hi, <span className="text-foreground">{displayName}</span>
                </button>
                {subscription && subscription.tier !== 'agency' && subscription.tier !== 'complete' && (() => {
                  const limit = RENDER_LIMITS[subscription.tier] || 0;
                  const used = subscription.render_count || 0;
                  const usedPct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
                  return (
                    <Link to="/pricing" className="inline-flex items-center gap-2.5 text-xs px-3 py-1.5 rounded-full border border-border/50 bg-card/80 hover:bg-card transition-colors whitespace-nowrap">
                      <span className="font-semibold text-foreground">{used}<span className="text-muted-foreground font-normal">/{limit}</span></span>
                      <div className="w-12 h-1.5 rounded-full bg-border/60 overflow-hidden">
                        <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-fuchsia-500 transition-all duration-300" style={{ width: `${usedPct}%` }} />
                      </div>
                    </Link>
                  );
                })()}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                  className="text-foreground hover:text-primary border-border"
                >
                  <Link to="/login">Log In</Link>
                </Button>
                <Button
                  size="sm"
                  asChild
                  variant="gradient"
                  className="whitespace-nowrap"
                >
                  <Link to="/signup">Start Free</Link>
                </Button>
              </div>
            )}

            {/* Desktop suite buttons now in NavLinks section */}
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-foreground hover:text-primary">
                  Menu <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border w-56 z-[100] max-h-[80vh] overflow-y-auto">
                <AccountMenuItems />
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
};

// Memoize Header to prevent re-renders when parent components (like Index.tsx slider) update
export const Header = memo(HeaderComponent);