import { Link, useLocation } from "react-router-dom";
import { Home, FileText, Mic, Camera, Grid3X3 } from "lucide-react";
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
const TABS = [
  { label: "Home", route: "/dashboard", icon: Home, match: ["/dashboard"], kind: "link" as const },
  { label: "Tools", icon: Grid3X3, match: [], kind: "drawer" as const },
  { label: "Quote", route: "/quick-quote", icon: Mic, match: ["/quick-quote"], kind: "link" as const },
  { label: "Quotes", route: "/quotes", icon: FileText, match: ["/quotes"], kind: "link" as const },
  { label: "Renders", route: "/my-renders", icon: Camera, match: ["/my-renders"], kind: "link" as const },
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
      <div className="h-full grid grid-cols-5 gap-0.5 px-1 font-inter">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.match);

          const content = (
            <>
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-gradient-rp-pop" />
              )}
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-semibold uppercase tracking-wide">
                {tab.label}
              </span>
            </>
          );

          const baseClass = cn(
            "flex flex-col items-center justify-center gap-1 rounded-md transition min-h-[44px] relative",
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
