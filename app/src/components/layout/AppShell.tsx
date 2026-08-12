import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useIsAppRoute } from "@/hooks/useIsAppRoute";
import { AppSidebar } from "./AppSidebar";
import { AppBottomTabs } from "./AppBottomTabs";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: ReactNode;
}

/**
 * Dashboard shell wrapper.
 *
 * On "app" routes (dashboard, tool pages, quotes, renders, etc.) renders:
 *   - Sticky left sidebar (desktop) grouped by pillar
 *   - Off-canvas Sheet drawer (mobile, triggered by bottom tab bar "Tools")
 *   - Mobile-only bottom tab bar
 *   - Content area with the appropriate padding
 *
 * The existing <Header /> (sproket-rocket logo, tier badge, sign-in, user
 * menu, admin dropdown) is ALWAYS rendered above AppShell by App.tsx —
 * persistent across marketing + app routes.
 *
 * On marketing routes this is a passthrough.
 */
export const AppShell = ({ children }: AppShellProps) => {
  const isAppRoute = useIsAppRoute();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Desktop: let users hide the left nav to give tool pages (Konva canvas, etc.)
  // full width. Persisted so it stays hidden across navigation.
  const [navHidden, setNavHidden] = useState(() => {
    try { return localStorage.getItem("rp_nav_hidden") === "1"; } catch { return false; }
  });
  const toggleNav = () => {
    setNavHidden((v) => {
      const next = !v;
      try { localStorage.setItem("rp_nav_hidden", next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Embedded in an iframe (ApprovePro's WPW proof / DesignPro panels): no
  // sidebar or bottom tabs — the page fills the frame.
  let inIframe = false;
  try { inIframe = typeof window !== "undefined" && window.self !== window.top; } catch { inIframe = true; }

  if (!isAppRoute || inIframe) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] bg-rp-root text-white">
      <AppSidebar
        mobileOpen={mobileOpen}
        onMobileClose={() => setMobileOpen(false)}
        desktopHidden={navHidden}
      />

      {/* Desktop nav toggle — thin tab on the left edge */}
      <button
        type="button"
        onClick={toggleNav}
        className={cn(
          "hidden md:flex fixed top-1/2 -translate-y-1/2 z-40 h-16 w-5 items-center justify-center rounded-r-md border border-l-0 border-[#48484a] bg-rp-root text-white/60 hover:text-white hover:bg-white/5 transition-all",
          navHidden ? "left-0" : "left-60",
        )}
        aria-label={navHidden ? "Show navigation" : "Hide navigation"}
        title={navHidden ? "Show navigation" : "Hide navigation"}
      >
        {navHidden ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
      </button>

      <main
        className={cn(
          "pb-24 md:pb-10 min-h-[100dvh] transition-[padding] duration-200",
          navHidden ? "md:pl-0" : "md:pl-60",
        )}
      >
        {children}
      </main>
      <AppBottomTabs onOpenTools={() => setMobileOpen(true)} />
    </div>
  );
};
