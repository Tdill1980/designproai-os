import { Link, useLocation } from "react-router-dom";
import { Home, Factory, Grid3X3, Image, ShoppingBag } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppBottomTabsProps {
  onOpenTools?: () => void;
}

/**
 * Mobile-only bottom tab bar for one-thumb navigation.
 * Hidden on md and up (sidebar takes over).
 *
 * The "Tools" tab opens the AppSidebar Sheet drawer instead of
 * navigating — that way the full tool list is one tap away anywhere
 * in the app.
 */
// One thumb-reachable tab per step of the operating path. Every route here is
// served by the router — the quote/quotes/renders tabs this was copied with
// pointed at RestylePro surfaces that are not part of this system, so they
// landed on the 404 page.
/**
 * WALLPRO AND SHOPFLOW ARE REACHABLE WITH A THUMB (owner, 2026-09-18, about to
 * demo on a phone: "I don't see the ShopFlow link or the WPW WallPro", then
 * "ShopFlow is at bottom of mobile navigation so small I can't press").
 *
 * Both were in the sidebar, which is `hidden md:flex` — so on a phone the only
 * route to either was the Tools drawer, several taps down a long list with the
 * WPW group at the bottom. A partner demo runs on a phone, and the two
 * surfaces being demonstrated were the two hardest to reach.
 *
 * FIVE TABS, NOT SIX. The first attempt at this added a sixth column and
 * dropped the labels to 9px to make them fit, which answered "I cannot find
 * it" with "now you cannot press it either" — the owner said so immediately.
 * At 390px five columns is ~78px a tab; six is ~65px, and the label has to
 * shrink to survive it. A tab nobody can hit is not navigation.
 *
 * So WrapBox and VehiclePro give up their slots. Both are one tap away in the
 * Tools drawer, WrapBox also sits at the end of Jobs beside it, and neither is
 * what a phone visitor opens first. The row keeps its 10px labels and gains a
 * 56px minimum target, comfortably over the 44px floor.
 *
 * WallPro points at the WEPRINTWRAPS tool, because that is the partner-facing
 * app; `match` carries the DesignProAI routes too, so the tab highlights on
 * either brand instead of looking inactive on half of its own product.
 */
const TABS = [
  { label: "Home", route: "/dashboard", icon: Home, match: ["/dashboard"], kind: "link" as const },
  { label: "Tools", icon: Grid3X3, match: [], kind: "drawer" as const },
  { label: "WallPro", route: "/wallwrap-design", icon: Image, match: ["/wallwrap-design", "/printpro/wallpro", "/wall-wrap", "/wallpro"], kind: "link" as const },
  { label: "ShopFlow", route: "/shopflow", icon: ShoppingBag, match: ["/shopflow"], kind: "link" as const },
  { label: "Jobs", route: "/designpro/jobs", icon: Factory, match: ["/designpro/jobs"], kind: "link" as const },
];

export const AppBottomTabs = ({ onOpenTools }: AppBottomTabsProps) => {
  const location = useLocation();

  const isActive = (matches: string[]) =>
    matches.some((m) => location.pathname === m || location.pathname.startsWith(m + "/"));

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 h-16 border-t border-[#48484a] bg-rp-root"
      aria-label="Bottom navigation"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="h-full grid grid-cols-5 gap-1 px-1 font-inter">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.match);

          const content = (
            <>
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-gradient-rp-pop" />
              )}
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide leading-none">
                {tab.label}
              </span>
            </>
          );

          const baseClass = cn(
            "flex flex-col items-center justify-center gap-1 rounded-md transition min-h-[56px] relative",
            active ? "text-white" : "text-white/70 hover:text-white/80"
          );

          if (tab.kind === "drawer") {
            return (
              <button
                key={tab.label}
                type="button"
                onClick={() => onOpenTools?.()}
                className={baseClass}
                aria-label="Open tools menu"
              >
                {content}
              </button>
            );
          }

          return (
            <Link key={tab.label} to={tab.route} className={baseClass}>
              {content}
            </Link>
          );
        })}
      </div>
    </nav>
  );
};
