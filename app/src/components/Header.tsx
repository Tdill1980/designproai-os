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
  
  const MobileNavLinks = () => (
    <>
      {/* Dashboard — top of the menu for signed-in users so they can always
          get back to ShopEngine from any marketing page. */}
      {user && (
        <div className="mb-1">
          <Link to="/dashboard" className={`block py-3 px-2 text-base font-bold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/dashboard') ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
            <LayoutDashboard className="h-4 w-4 text-cyan-400" />
            Dashboard
          </Link>
          <Link to="/orders" className={`block py-3 px-2 text-base font-bold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/orders') ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
            <Package className="h-4 w-4 text-cyan-400" />
            Orders
          </Link>
        </div>
      )}
      {/* Core Design Tools */}
      <div>
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">Design Tools</h4>
        <Link to="/graphics-pro" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/graphics-pro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Scissors className="h-4 w-4 text-cyan-400" />
          GraphicsPro™
        </Link>
        <Link to="/designpro/premium" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/designpro/premium') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Sparkles className="h-4 w-4 text-blue-400" />
          DesignProAI™
        </Link>
        <Link to="/productionflow?tab=prep" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/productionflow') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Zap className="h-4 w-4 text-yellow-400" />
          RecreatePro™ · ProductionFlow
        </Link>
        <Link to="/logopro" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/logopro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Stamp className="h-4 w-4 text-cyan-400" />
          LogoPro™
        </Link>
        <Link to="/colorpro" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/colorpro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Rotate3D className="h-4 w-4 text-blue-400" />
          ColorPro™
        </Link>
        <Link to="/restylelibrary" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/restylelibrary') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Rotate3D className="h-4 w-4 text-blue-400" />
          RestyleLibrary™
        </Link>
        <Link to="/wbty" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/wbty') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Rotate3D className="h-4 w-4 text-blue-400" />
          PatternPro™
        </Link>
        <Link to="/approvepro" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/approvepro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Rotate3D className="h-4 w-4 text-blue-400" />
          ApprovePro™
        </Link>
        <Link to="/revision-studio" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/revision-studio') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Sparkles className="h-4 w-4 text-purple-400" />
          RevisionStudioIQ™
        </Link>
        <Link to="/printpro/wallpro" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/printpro/wallpro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Building2 className="h-4 w-4 text-fuchsia-400" />
          WallPro™
        </Link>
      </div>

      {/* Utility Pages */}
      <div className="border-t border-border pt-2 mt-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">More</h4>
        <Link to="/gallery" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/gallery') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Gallery
        </Link>
        <Link to="/wrapbox" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/wrapbox') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Box className="h-4 w-4 text-blue-400" />
          WrapBox™
        </Link>
        <Link to="/creatormarket" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/creatormarket') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Store className="h-4 w-4 text-violet-400" />
          CreatorMarket
        </Link>
        <Link to="/designvault" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/designvault') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Shield className="h-4 w-4 text-emerald-400" />
          DesignVault
        </Link>
        <Link to="/quick-quote" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/quick-quote') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Calculator className="h-4 w-4 text-emerald-400" />
          QuickQuote
        </Link>
        <Link to="/quotetool" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/quotetool') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Calculator className="h-4 w-4 text-emerald-400" />
          QuickQuote · About
        </Link>
        <Link to="/quicktext" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/quicktext') || isActive('/never-miss-a-lead') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Zap className="h-4 w-4 text-cyan-400" />
          QuickText
        </Link>
        <Link to="/mightymail-info" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/mightymail-info') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Mail className="h-4 w-4 text-purple-400" />
          MightyMail
        </Link>
        <Link to="/bookingpro" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/bookingpro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Calendar className="h-4 w-4 text-emerald-400" />
          BookingPro
        </Link>
        <Link to="/myvehiclepro" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/myvehiclepro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Car className="h-4 w-4 text-cyan-400" />
          MyVehiclePro
        </Link>
        <Link to="/never-miss-a-lead" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/never-miss-a-lead') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Phone className="h-4 w-4 text-green-400" />
          Never Miss a Lead
        </Link>
      </div>

      {/* PrintPro Suite */}
      <div className="border-t border-border pt-2 mt-1">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-1">PrintPro™ Suite</h4>
        <Link to="/printpro" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/printpro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Printer className="h-4 w-4 text-blue-300" />
          <span className="text-foreground">Print</span><span className="text-blue-200">Pro™</span>
        </Link>
        <Link to="/printpro/wbty" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/printpro/wbty') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <span className="text-foreground">Pattern</span><span className="text-gradient-designpro">Pro™</span>&nbsp;Printed Rolls
        </Link>
        <Link to="/printpro/fadewrap" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/printpro/fadewrap') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <span className="text-foreground">Fade</span><span className="text-gradient-designpro">Wrap™</span>&nbsp;Printed Panels
        </Link>
        <Link to="/printpro/design-packs" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/printpro/design-packs') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Full-Design Print Packs
        </Link>
        <Link to="/printpro/custom-upload" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/printpro/custom-upload') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Custom Print Upload
        </Link>
      </div>

      {/* Account */}
      <div className="border-t border-border pt-2 mt-1">
        <button
          className="block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50 w-full text-left"
          onClick={() => { setIsOpen(false); setTimeout(() => window.dispatchEvent(new Event("sproket-open-panel")), 300); }}
        >
          <img src="/characters/sproket/sproket-avatar.png" alt="SPROKET" className="w-5 h-5 object-contain" />
          <span style={{ color: "#7F77DD" }}>Ground Control</span>
        </button>
        <Link to="/orders" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/orders') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Package className="h-4 w-4 text-cyan-400" />
          Orders
        </Link>
        <Link to="/queue" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/queue') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <ListChecks className="h-4 w-4 text-cyan-400" />
          Render Queue
        </Link>
        <button
          type="button"
          onClick={() => {
            setIsOpen(false);
            window.dispatchEvent(new Event("restylepro:open-onboarding-wizard"));
          }}
          className="block w-full py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          <Sparkles className="h-4 w-4 text-fuchsia-400" />
          Setup Wizard
        </button>
        <Link to="/user-guide" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/user-guide') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Help & Guide
        </Link>
        <Link to="/dashboard/my-orders" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/dashboard/my-orders') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Box className="h-4 w-4 text-blue-300" />
          My WPW Orders
        </Link>
        {/* /account-settings never existed as a route (hit the 404 catch-all) —
            point at the real account page. */}
        <Link to="/account/shop" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/account/shop') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Settings className="h-4 w-4" />
          Account Settings
        </Link>
        {user && (
          <button
            className="block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 text-red-400 hover:text-red-300 hover:bg-muted/50 w-full text-left"
            onClick={() => { handleLogout(); setIsOpen(false); }}
          >
            <LogOut className="h-4 w-4" />
            Log Out
          </button>
        )}
      </div>

      {/* Marketing Hub */}
      <div className="border-t border-border pt-2 mt-1">
        {showWpwEngineRoom && (
          <Link to="/wpw/engine-room" className={`block py-3 px-2 text-base font-bold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/wpw/engine-room') ? 'bg-primary/10' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
            <span className="bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">WPW Engine Room</span>
          </Link>
        )}
        {showWpwEngineRoom && (
          <Link to="/from/weprintwraps" className={`block py-3 px-2 text-base font-bold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/from/weprintwraps') ? 'bg-primary/10' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
            <span className="bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">WPW Founder Offer</span>
          </Link>
        )}
        <Link to="/engine-room" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/engine-room') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Engine Room
        </Link>
        {user && (
          <Link to="/email-templates" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center gap-2 ${isActive('/email-templates') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
            <Mail className="h-4 w-4 text-fuchsia-400" />
            Email Templates
          </Link>
        )}
      </div>

      {/* Admin Links — admin / tester / allowlisted only */}
      {showAdminMenu && (
      <div className="border-t border-border pt-2 mt-1">
        <Link to="/admin" className={`block py-3 px-2 text-base font-semibold transition-colors rounded-lg min-h-[44px] flex items-center ${isActive('/admin') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Admin
        </Link>
        {/* Content OS — DAILY WORKING ORDER, not alphabetical (owner
            2026-08-04, filming every day): Content Director (the gate) →
            Shot List (film + upload) → Script Studio → Brand Board (published)
            → Content Calendar, then Engine Room and the rest. The nav order
            IS the flow. */}
        <Link to="/admin/content-director" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/content-director') ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Sparkles className="h-3.5 w-3.5 text-[#FF2DC8]" />
          <span className="font-bold bg-gradient-to-r from-[#00C7FF] to-[#FF2DC8] bg-clip-text text-transparent">Content Director</span>
        </Link>
        <Link to="/admin/content-director?tab=shotlist" className="block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 hover:bg-muted/50" onClick={() => setIsOpen(false)}>
          <ListChecks className="h-3.5 w-3.5 text-[#f59e0b]" />
          <span className="text-foreground">Shot List</span>
        </Link>
        <Link to="/admin/script-studio" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/script-studio') ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <FileText className="h-3.5 w-3.5 text-[#3b82f6]" />
          <span className="text-foreground">Script Studio</span>
        </Link>
        <Link to="/admin/brand-board" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/brand-board') ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <LayoutGrid className="h-3.5 w-3.5 text-[#8b5cf6]" />
          <span className="text-foreground">Brand Board</span>
        </Link>
        <Link to="/engine-room?tab=calendar" className="block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 hover:bg-muted/50" onClick={() => setIsOpen(false)}>
          <Calendar className="h-3.5 w-3.5 text-[#10b981]" />
          <span className="text-foreground">Content Calendar</span>
        </Link>
        <Link to="/engine-room" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/engine-room') ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <LayoutGrid className="h-3.5 w-3.5 text-[#3b82f6]" />
          <span className="text-foreground">Engine Room</span>
        </Link>
        <Link to="/engine-room?tab=assets" className="block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 hover:bg-muted/50" onClick={() => setIsOpen(false)}>
          <FolderOpen className="h-3.5 w-3.5 text-[#10b981]" />
          <span className="text-foreground">Asset Library</span>
        </Link>
        <Link to="/admin/creator" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/creator') ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Sparkles className="h-3.5 w-3.5 text-[#00C7FF]" />
          <span className="font-bold bg-gradient-to-r from-[#00C7FF] to-[#FF2DC8] bg-clip-text text-transparent">Creator Studio</span>
        </Link>
        <Link to="/admin/mightymail" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/mightymail') ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          MightyMail
        </Link>
        <Link to="/admin/workforce" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/workforce') ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Sparkles className="h-3.5 w-3.5 text-[#ec4899]" />
          <span className="font-bold bg-gradient-to-r from-[#00C7FF] to-[#FF2DC8] bg-clip-text text-transparent">AI Workforce</span>
        </Link>
        <Link to="/admin/social-iq" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/social-iq') ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <MessageCircle className="h-3.5 w-3.5 text-[#ec4899]" />
          <span className="text-foreground">SocialIQ</span>
        </Link>
        <Link to="/admin/content-director?tab=ads" className="block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 hover:bg-muted/50" onClick={() => setIsOpen(false)}>
          <BarChart3 className="h-3.5 w-3.5 text-[#3b82f6]" />
          <span className="font-bold">
            <span className="text-foreground">Ads</span>
            <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
          </span>
        </Link>
        <Link to="/feed" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/feed') ? 'bg-primary/10 text-primary' : 'hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Rss className="h-3.5 w-3.5 text-[#06B6D4]" />
          <span className="text-foreground">The Feed</span>
        </Link>
        <Link to="/admin/mightymail-landing" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/mightymail-landing') ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          MightyMail Landing Assets
        </Link>
        <Link to="/admin/studio-board" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/studio-board') ? 'bg-primary/10 text-primary' : 'text-cyan-400 hover:text-cyan-300 hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <SplitSquareHorizontal className="h-3.5 w-3.5" />
          PanelPro Studio Board
        </Link>
        <Link to="/flat-panel-pro" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/flat-panel-pro') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Flat Panel Pro
        </Link>
        <Link to="/qc-cutcontour" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/qc-cutcontour') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          QC Cut Contour
        </Link>
        <Link to="/quotes" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/quotes') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Quote Manager
        </Link>
        <Link to="/admin/shop-pricing" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/shop-pricing') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Shop Pricing
        </Link>
        <Link to="/admin/email-editor" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/email-editor') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Email Editor
        </Link>
        <Link to="/admin/batch-render" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/batch-render') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Batch Render
        </Link>
        <Link to="/admin/flat-panel-from-render" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/flat-panel-from-render') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Flat Panel from 3D Render
        </Link>
        <Link to="/admin/upscale-single" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/upscale-single') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Single Upscaler
        </Link>
        <Link to="/admin/batch-results" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/batch-results') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          QA &amp; Curation Studio
        </Link>
        <Link to="/admin/user-renders" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/user-renders') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          All User Renders
        </Link>
        <Link to="/productionflow" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/productionflow') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          QC ProductionFlow
        </Link>
        <Link to="/admin/render-qc" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/render-qc') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Render QC Dashboard
        </Link>
        <Link to="/admin/panel-artboard" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/panel-artboard') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Panel Artboard Generator
        </Link>
        <Link to="/admin/campaigns" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/campaigns') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Email Campaigns
        </Link>
        <Link to="/admin/wpw-enroll" className="block py-3 px-2 text-sm font-medium transition-colors rounded-lg min-h-[44px] flex items-center pl-8 text-cyan-400 hover:text-cyan-300 hover:bg-muted/50" onClick={() => setIsOpen(false)}>
          ↳ Enroll in WPW Drip
        </Link>
        <Link to="/admin/retargeting" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 ${isActive('/admin/retargeting') ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          Retargeting Dashboard
        </Link>
        <Link to="/admin/content-studio" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/content-studio') ? 'bg-primary/10 text-primary' : 'text-cyan-400 hover:text-cyan-300 hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
          <Sparkles className="h-3.5 w-3.5" />
          Content Studio
        </Link>
        {isOwner && (
          <>
            <Link to="/admin/system-health" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/system-health') ? 'bg-primary/10 text-primary' : 'text-emerald-400 hover:text-emerald-300 hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
              <Activity className="h-3.5 w-3.5" />
              System Health
            </Link>
            <Link to="/admin/activity-log" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/activity-log') ? 'bg-primary/10 text-primary' : 'text-cyan-400 hover:text-cyan-300 hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
              <Activity className="h-3.5 w-3.5" />
              Activity Log
            </Link>
            <Link to="/admin/errors" className={`block py-3 px-2 text-sm font-semibold transition-colors rounded-lg min-h-[44px] flex items-center pl-4 gap-1.5 ${isActive('/admin/errors') ? 'bg-primary/10 text-primary' : 'text-red-400 hover:text-red-300 hover:bg-muted/50'}`} onClick={() => setIsOpen(false)}>
              <Activity className="h-3.5 w-3.5" />
              Error Dashboard
            </Link>
          </>
        )}
      </div>
      )}
    </>
  );

  const NavLinks = () => (
    <TooltipProvider delayDuration={200}>
      {/* PrintPro Suite Dropdown */}
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button className="btn-brand hover:opacity-90 text-white font-bold text-sm px-4 py-2 flex items-center gap-1">
                <span className="text-white">Print</span><span className="text-blue-200">Pro™</span> Suite <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="bg-card border-border w-56 z-[100]">
              <DropdownMenuItem asChild>
                <Link to="/printpro/wbty" className="cursor-pointer w-full min-h-[44px] flex items-center">
                  <span className="text-foreground">Pattern</span><span className="text-gradient-designpro">Pro™</span> Printed Rolls
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/printpro/fadewrap" className="cursor-pointer w-full min-h-[44px] flex items-center">
                  <span className="text-foreground">Fade</span><span className="text-gradient-designpro">Wrap™</span> Printed Panels
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/printpro/design-packs" className="cursor-pointer w-full min-h-[44px] flex items-center">
                  Full-Design Print Packs
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/printpro/custom-upload" className="cursor-pointer w-full min-h-[44px] flex items-center">
                  Custom Print Upload
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="bg-card border-primary/20 max-w-xs">
          <p className="font-semibold">Print Products & Fulfillment</p>
          <p className="text-xs text-muted-foreground">Order printed vinyl films, panels, patterns & custom designs</p>
        </TooltipContent>
      </Tooltip>

      {/* WallPro — standalone top-level entry */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Link to="/printpro/wallpro">
            <Button className="btn-brand hover:opacity-90 text-white font-bold text-sm px-4 py-2 flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" />
              <span className="text-white">Wall</span><span className="text-fuchsia-200">Pro™</span>
            </Button>
          </Link>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="bg-card border-primary/20 max-w-xs">
          <p className="font-semibold">WallPro — AI Wall Wrap Designer</p>
          <p className="text-xs text-muted-foreground">Design & visualize wall wraps for offices, gyms, retail & more</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
                <span className="text-white">Restyle</span>
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
                          <Link to="/billing" onClick={() => setIsOpen(false)} className="flex flex-col gap-1.5 px-3 py-2.5 rounded-lg border border-border/50 bg-card/80 hover:bg-card transition-colors">
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
                        <Link to="/billing" onClick={() => setIsOpen(false)}>Manage Billing</Link>
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
              to="/graphics-pro"
              className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                isActive('/graphics-pro') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Scissors className="h-3.5 w-3.5 text-cyan-400" />
              <span className="text-foreground">Graphics</span><span className="text-gradient-designpro">Pro™</span>
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
              to="/quick-quote"
              className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                isActive('/quick-quote') ? 'text-primary' : 'bg-gradient-to-r from-blue-400 via-purple-400 to-fuchsia-400 bg-clip-text text-transparent hover:from-blue-300 hover:via-purple-300 hover:to-fuchsia-300'
              }`}
            >
              <Calculator className="h-3.5 w-3.5 text-purple-400" />
              QuickQuote
            </Link>

            <span className="text-muted-foreground/40">|</span>

            <Link
              to="/signup"
              className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                isActive('/signup') ? 'text-primary' : 'text-cyan-400 hover:text-cyan-300'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Sign Up Free
            </Link>

            <span className="text-muted-foreground/40">|</span>

            <Link
              to="/designpro?try=1"
              className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                isActive('/designpro') ? 'text-primary' : 'bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent hover:from-cyan-300 hover:to-fuchsia-300'
              }`}
            >
              Custom Wrap Design · $250
            </Link>

            {/* Token balance pill — surfaces the user's design-token count
                next to the Try CTA so logged-in buyers can see they already
                own credits. Hidden when balance is 0 (Try CTA covers them). */}
            {user && tokenBalance > 0 && (
              <>
                <span className="text-muted-foreground/40">|</span>
                <Link
                  to="/billing"
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
                  to="/orders"
                  className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                    isActive('/orders') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Package className="h-3.5 w-3.5 text-cyan-400" />
                  Orders
                </Link>
                <span className="text-muted-foreground/40">|</span>
                <Link
                  to="/queue"
                  className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                    isActive('/queue') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <ListChecks className="h-3.5 w-3.5 text-cyan-400" />
                  Queue
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
                <span className="text-muted-foreground/40">|</span>
                <Link
                  to="/email-templates"
                  className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                    isActive('/email-templates') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Mail className="h-3.5 w-3.5 text-fuchsia-400" />
                  Email Templates
                </Link>
              </>
            )}

            {showAdminMenu && <span className="text-muted-foreground/40">|</span>}

            {showAdminMenu && <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                    location.pathname.startsWith('/admin') ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Settings className="h-3.5 w-3.5" />
                  Admin
                  <ChevronDown className="h-3 w-3" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-card border-border w-56 z-[100] max-h-[80vh] overflow-y-auto">
                {/* PanelPro Studio Board — top of the admin menu, white panel with
                    the brand gradient wordmark. */}
                <DropdownMenuItem asChild className="p-0 mb-1 focus:bg-transparent">
                  <Link to="/admin/studio-board" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5 rounded-md bg-white px-2 shadow-sm">
                    <Sparkles className="h-3.5 w-3.5 text-[#ec4899]" />
                    <span className="font-extrabold">
                      <span className="text-gray-900">Panel</span>
                      <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
                      <span className="text-gray-900"> Studio Board</span>
                    </span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin/production-files" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#ec4899]" />
                    <span className="font-bold bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Production Files</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin" className="cursor-pointer w-full min-h-[44px] flex items-center font-semibold">
                    Admin Dashboard
                  </Link>
                </DropdownMenuItem>
                {/* DAILY WORKING ORDER (owner 2026-08-04): Director → Shot
                    List → Script Studio → Brand Board → Content Calendar,
                    then Engine Room and the rest. */}
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#FF2DC8]" />
                    <span className="font-bold bg-gradient-to-r from-[#00C7FF] to-[#FF2DC8] bg-clip-text text-transparent">Content Director</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director?tab=shotlist" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5 text-[#f59e0b]" />
                    <span className="text-foreground">Shot List</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/script-studio" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="text-foreground">Script Studio</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/brand-board" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-[#8b5cf6]" />
                    <span className="text-foreground">Brand Board</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room?tab=calendar" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[#10b981]" />
                    <span className="text-foreground">Content Calendar</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="text-foreground">Engine Room</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room?tab=assets" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5 text-[#10b981]" />
                    <span className="text-foreground">Asset Library</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/creator" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#00C7FF]" />
                    <span className="font-bold bg-gradient-to-r from-[#00C7FF] to-[#FF2DC8] bg-clip-text text-transparent">Creator Studio</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/mightymail" className="cursor-pointer w-full min-h-[44px] flex items-center font-semibold">
                    MightyMail
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/workforce" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#ec4899]" />
                    <span className="font-bold bg-gradient-to-r from-[#00C7FF] to-[#FF2DC8] bg-clip-text text-transparent">AI Workforce</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/social-iq" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5 text-[#ec4899]" />
                    <span className="text-foreground">SocialIQ</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director?tab=ads" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="font-bold">
                      <span className="text-foreground">Ads</span>
                      <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
                    </span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/feed" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Rss className="h-3.5 w-3.5 text-[#06B6D4]" />
                    <span className="text-foreground">The Feed</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/mightymail-landing" className="cursor-pointer w-full min-h-[44px] flex items-center font-semibold">
                    MightyMail Landing Assets
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/flat-panel-pro" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Flat Panel Pro
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/quotes" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Quote Manager
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/shop-pricing" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Shop Pricing
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/email-editor" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Email Editor
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/batch-render" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Batch Render
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/flat-panel-from-render" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Flat Panel from 3D Render
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/upscale-single" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Single Upscaler
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/batch-results" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    QA &amp; Curation Studio
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/user-renders" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    All User Renders
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/productionflow" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    QC ProductionFlow
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/render-qc" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Render QC Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/panel-artboard" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Panel Artboard Generator
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/campaigns" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Email Campaigns
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/wpw-enroll" className="cursor-pointer w-full min-h-[44px] flex items-center pl-4 text-cyan-500">
                    ↳ Enroll in WPW Drip
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/retargeting" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    Retargeting Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-studio" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-cyan-400 font-semibold">Content Studio</span>
                  </Link>
                </DropdownMenuItem>
                {isOwner && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/system-health" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">System Health</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/activity-log" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="text-cyan-400 font-semibold">Activity Log</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/errors" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-red-400" />
                        <span className="text-red-400 font-semibold">Error Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
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
              <DropdownMenuContent align="end" className="bg-card border-border w-48 z-[100] max-h-[80vh] overflow-y-auto">
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
                <DropdownMenuItem asChild>
                  <Link to="/gallery" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">Gallery</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/dashboard" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <LayoutDashboard className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-foreground font-semibold">Dashboard</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/orders" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-foreground font-semibold">Orders</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/my-renders" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">My Renders</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/my-designs" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">My Designs</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/wrapbox" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Box className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-foreground font-semibold">WrapBox™</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/productionflow?tab=prep" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-yellow-400" />
                    <span className="text-gradient-blue font-semibold">ProductionFlow™</span>
                  </Link>
                </DropdownMenuItem>
                {user && (
                  <DropdownMenuItem asChild>
                    <Link to="/billing" className="cursor-pointer w-full min-h-[44px] flex items-center">
                      <span className="text-foreground font-semibold">Manage Billing</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link to="/pricing" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-cyan-400 font-semibold">Pricing</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/designpro?try=1" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="font-semibold bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">Custom Wrap Design · $250</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/quicktext" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">QuickText · from $49/mo</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/mightymail-info" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-purple-400" />
                    <span className="font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">MightyMail · included</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/user-guide" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">Help & Guide</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/printpro" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Printer className="h-3.5 w-3.5 text-blue-300" />
                    <span className="text-foreground font-semibold">Print<span className="text-blue-200">Pro™</span></span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/printpro/wbty" className="cursor-pointer w-full min-h-[44px] flex items-center pl-6">
                    <span className="text-muted-foreground font-semibold"><span className="text-foreground">Pattern</span><span className="text-gradient-designpro">Pro™</span>&nbsp;Printed Rolls</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/printpro/fadewrap" className="cursor-pointer w-full min-h-[44px] flex items-center pl-6">
                    <span className="text-muted-foreground font-semibold"><span className="text-foreground">Fade</span><span className="text-gradient-designpro">Wrap™</span>&nbsp;Printed Panels</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/printpro/design-packs" className="cursor-pointer w-full min-h-[44px] flex items-center pl-6">
                    <span className="text-muted-foreground font-semibold">Full-Design Print Packs</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/printpro/custom-upload" className="cursor-pointer w-full min-h-[44px] flex items-center pl-6">
                    <span className="text-muted-foreground font-semibold">Custom Print Upload</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/printpro/wallpro" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-fuchsia-400" />
                    <span className="text-foreground font-semibold">Wall<span className="text-fuchsia-300">Pro™</span></span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {showWpwEngineRoom && (
                  <DropdownMenuItem asChild>
                    <Link to="/wpw/engine-room" className="cursor-pointer w-full min-h-[44px] flex items-center">
                      <span className="font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">WPW Engine Room</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                {showWpwEngineRoom && (
                  <DropdownMenuItem asChild>
                    <Link to="/from/weprintwraps" className="cursor-pointer w-full min-h-[44px] flex items-center">
                      <span className="font-bold bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">WPW Founder Offer</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link to="/engine-room" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">Engine Room</span>
                  </Link>
                </DropdownMenuItem>
                {showAdminMenu && <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Admin</span>
                  </Link>
                </DropdownMenuItem>
                {/* DAILY WORKING ORDER (owner 2026-08-04): Director → Shot
                    List → Script Studio → Brand Board → Content Calendar,
                    then Engine Room and the rest. */}
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#FF2DC8]" />
                    <span className="text-foreground">Content Director</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director?tab=shotlist" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5 text-[#f59e0b]" />
                    <span className="text-foreground">Shot List</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/script-studio" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="text-foreground">Script Studio</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/brand-board" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-[#8b5cf6]" />
                    <span className="text-foreground">Brand Board</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room?tab=calendar" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[#10b981]" />
                    <span className="text-foreground">Content Calendar</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="text-foreground">Engine Room</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room?tab=assets" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5 text-[#10b981]" />
                    <span className="text-foreground">Asset Library</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/mightymail" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">MightyMail</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/social-iq" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5 text-[#ec4899]" />
                    <span className="text-foreground">SocialIQ</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director?tab=ads" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="font-bold">
                      <span className="text-foreground">Ads</span>
                      <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
                    </span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/feed" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Rss className="h-3.5 w-3.5 text-[#06B6D4]" />
                    <span className="text-foreground">The Feed</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/mightymail-landing" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">MightyMail Landing Assets</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/flat-panel-pro" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Flat Panel Pro</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/quotes" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Quote Manager</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/email-editor" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Email Editor</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/batch-render" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Batch Render</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/flat-panel-from-render" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Flat Panel from 3D Render</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/upscale-single" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Single Upscaler</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/batch-results" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">QA &amp; Curation Studio</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/user-renders" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">All User Renders</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/productionflow" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">QC ProductionFlow</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/render-qc" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Render QC Dashboard</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/campaigns" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Email Campaigns</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/wpw-enroll" className="cursor-pointer w-full min-h-[44px] flex items-center pl-4">
                    <span className="text-cyan-500 hover:text-cyan-400 font-semibold">↳ Enroll in WPW Drip</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/retargeting" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Retargeting Dashboard</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-studio" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-cyan-400 font-semibold">Content Studio</span>
                  </Link>
                </DropdownMenuItem>
                </>}
                {isOwner && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/system-health" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">System Health</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/activity-log" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="text-cyan-400 font-semibold">Activity Log</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/errors" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-red-400" />
                        <span className="text-red-400 font-semibold">Error Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                {user ? (
                  <DropdownMenuItem asChild>
                    <Button onClick={handleLogout} variant="ghost" size="sm" className="w-full justify-start min-h-[44px]">
                      <span className="text-muted-foreground hover:text-foreground font-semibold">Log Out</span>
                    </Button>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem asChild>
                    <Link to="/login" className="cursor-pointer w-full min-h-[44px] flex items-center">
                      <span className="text-foreground font-semibold">Log In</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="p-0">
                  <Button size="sm" variant="gradient" className="w-full min-h-[44px]">
                    Get Started
                  </Button>
                </DropdownMenuItem>
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
                    <Link to="/billing" className="inline-flex items-center gap-2.5 text-xs px-3 py-1.5 rounded-full border border-border/50 bg-card/80 hover:bg-card transition-colors whitespace-nowrap">
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
              <DropdownMenuContent align="end" className="bg-card border-border w-48 z-[100]">
                <DropdownMenuItem asChild>
                  <Link to="/gallery" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">Gallery</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/wrapbox" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Box className="h-3.5 w-3.5 text-blue-400" />
                    <span className="text-foreground font-semibold">WrapBox™</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/productionflow?tab=prep" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-yellow-400" />
                    <span className="text-gradient-blue font-semibold">ProductionFlow™</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/creatormarket" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Store className="h-3.5 w-3.5 text-violet-400" />
                    <span className="text-foreground font-semibold">Creator<span className="text-gradient-blue">Market</span></span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/designvault" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Shield className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-foreground font-semibold">Design<span className="text-gradient-blue">Vault</span></span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/quick-quote" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Calculator className="h-3.5 w-3.5 text-emerald-400" />
                    <span className="text-foreground font-semibold">QuickQuote</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/myvehiclepro" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Car className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-foreground font-semibold">MyVehiclePro</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/never-miss-a-lead" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Phone className="h-3.5 w-3.5 text-green-400" />
                    <span className="text-foreground font-semibold">Never Miss a Lead</span>
                  </Link>
                </DropdownMenuItem>
                {user && (
                  <DropdownMenuItem asChild>
                    <Link to="/billing" className="cursor-pointer w-full min-h-[44px] flex items-center">
                      <span className="text-foreground font-semibold">Manage Billing</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link to="/pricing" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-cyan-400 font-semibold">Pricing</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/designpro?try=1" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="font-semibold bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">Custom Wrap Design · $250</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/quicktext" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Zap className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">QuickText · from $49/mo</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/mightymail-info" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5 text-purple-400" />
                    <span className="font-bold bg-gradient-to-r from-cyan-400 to-purple-500 bg-clip-text text-transparent">MightyMail · included</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/user-guide" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">Help & Guide</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {showWpwEngineRoom && (
                  <DropdownMenuItem asChild>
                    <Link to="/wpw/engine-room" className="cursor-pointer w-full min-h-[44px] flex items-center">
                      <span className="font-bold bg-gradient-to-r from-purple-500 to-pink-500 bg-clip-text text-transparent">WPW Engine Room</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                {showWpwEngineRoom && (
                  <DropdownMenuItem asChild>
                    <Link to="/from/weprintwraps" className="cursor-pointer w-full min-h-[44px] flex items-center">
                      <span className="font-bold bg-gradient-to-r from-cyan-400 to-fuchsia-400 bg-clip-text text-transparent">WPW Founder Offer</span>
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem asChild>
                  <Link to="/engine-room" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">Engine Room</span>
                  </Link>
                </DropdownMenuItem>
                {showAdminMenu && <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link to="/admin" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Admin</span>
                  </Link>
                </DropdownMenuItem>
                {/* DAILY WORKING ORDER (owner 2026-08-04): Director → Shot
                    List → Script Studio → Brand Board → Content Calendar,
                    then Engine Room and the rest. */}
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-[#FF2DC8]" />
                    <span className="text-foreground">Content Director</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director?tab=shotlist" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <ListChecks className="h-3.5 w-3.5 text-[#f59e0b]" />
                    <span className="text-foreground">Shot List</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/script-studio" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="text-foreground">Script Studio</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/brand-board" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-[#8b5cf6]" />
                    <span className="text-foreground">Brand Board</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room?tab=calendar" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5 text-[#10b981]" />
                    <span className="text-foreground">Content Calendar</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <LayoutGrid className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="text-foreground">Engine Room</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/engine-room?tab=assets" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5 text-[#10b981]" />
                    <span className="text-foreground">Asset Library</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/mightymail" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">MightyMail</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/social-iq" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <MessageCircle className="h-3.5 w-3.5 text-[#ec4899]" />
                    <span className="text-foreground">SocialIQ</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-director?tab=ads" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <BarChart3 className="h-3.5 w-3.5 text-[#3b82f6]" />
                    <span className="font-bold">
                      <span className="text-foreground">Ads</span>
                      <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
                    </span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/feed" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Rss className="h-3.5 w-3.5 text-[#06B6D4]" />
                    <span className="text-foreground">The Feed</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/mightymail-landing" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-foreground font-semibold">MightyMail Landing Assets</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/flat-panel-pro" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Flat Panel Pro</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/quotes" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Quote Manager</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/email-editor" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Email Editor</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/batch-render" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Batch Render</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/flat-panel-from-render" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Flat Panel from 3D Render</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/upscale-single" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Single Upscaler</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/batch-results" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">QA &amp; Curation Studio</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/user-renders" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">All User Renders</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/productionflow" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">QC ProductionFlow</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/render-qc" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Render QC Dashboard</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/campaigns" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Email Campaigns</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/wpw-enroll" className="cursor-pointer w-full min-h-[44px] flex items-center pl-4">
                    <span className="text-cyan-500 hover:text-cyan-400 font-semibold">↳ Enroll in WPW Drip</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/retargeting" className="cursor-pointer w-full min-h-[44px] flex items-center">
                    <span className="text-muted-foreground hover:text-foreground font-semibold">Retargeting Dashboard</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link to="/admin/content-studio" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                    <Sparkles className="h-3.5 w-3.5 text-cyan-400" />
                    <span className="text-cyan-400 font-semibold">Content Studio</span>
                  </Link>
                </DropdownMenuItem>
                </>}
                {isOwner && (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/system-health" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-emerald-400" />
                        <span className="text-emerald-400 font-semibold">System Health</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/activity-log" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="text-cyan-400 font-semibold">Activity Log</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/admin/errors" className="cursor-pointer w-full min-h-[44px] flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5 text-red-400" />
                        <span className="text-red-400 font-semibold">Error Dashboard</span>
                      </Link>
                    </DropdownMenuItem>
                  </>
                )}
                {user && (
                  <DropdownMenuItem asChild>
                    <Button onClick={handleLogout} variant="ghost" size="sm" className="w-full justify-start min-h-[44px]">
                      <span className="text-muted-foreground hover:text-foreground font-semibold">Log Out</span>
                    </Button>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem className="p-0">
                  <Button size="sm" variant="gradient" className="w-full min-h-[44px]">
                    Get Started
                  </Button>
                </DropdownMenuItem>
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