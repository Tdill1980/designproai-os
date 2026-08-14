import { Link, useLocation } from "react-router-dom";
import { Layers, Workflow, CheckSquare, Sparkles, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsAppRoute } from "@/hooks/useIsAppRoute";
import { useToolNavCollapse } from "@/hooks/useToolNavCollapse";
import { BRAND, BRAND_GRADIENT, BRAND_RAIL_BG } from "@/lib/brandColors";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

// Only routes App.tsx declares. The seven RestylePro tools this rail was
// copied with have no route in this system, so every tap reached the 404 page.
const tools = [
  {
    path: "/designpro/generate",
    icon: Sparkles,
    label: "Design",
    fullLabel: "DesignProAI™",
    description: "Describe a wrap and a vehicle. The server generates seven distinct photoreal views.",
    highlight: false,
    featured: true
  },
  {
    path: "/designpro/jobs",
    icon: Workflow,
    label: "Jobs",
    fullLabel: "Production jobs",
    description: "2D proof, the six production layers, QC gates and the verified output files.",
    highlight: false,
    featured: true
  },
  {
    path: "/designpro/genie-qc",
    icon: CheckSquare,
    label: "GENIE",
    fullLabel: "GENIE QC",
    description: "Validate exact six-surface vehicle geometry and release blocked jobs.",
    highlight: false,
    featured: false
  },
  {
    path: "/designpro/wrapbox",
    icon: Layers,
    label: "WrapBox",
    fullLabel: "WrapBox",
    description: "Delivered production packs with immutable ZIP and manifest hashes.",
    highlight: true,
    featured: false
  },
];

/**
 * Space the bar reserves at the bottom of every page so it never covers
 * content. The safe-area inset is added on top for notched devices.
 */
const RESERVE_EXPANDED = "calc(80px + env(safe-area-inset-bottom, 0px))";
const RESERVE_COLLAPSED = "calc(34px + env(safe-area-inset-bottom, 0px))";

export const MobileToolNav = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const isAppRoute = useIsAppRoute();
  const { collapsed, setCollapsed, toggle } = useToolNavCollapse(RESERVE_EXPANDED, RESERVE_COLLAPSED, isMobile && !isAppRoute);

  if (!isMobile) return null;
  // AppShell provides its own bottom tab bar on app routes
  if (isAppRoute) return null;

  // Folded away — a slim brand strip the user can tap to bring the bar back.
  if (collapsed) {
    return (
      <div
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="h-[2px] w-full" style={{ background: BRAND_GRADIENT }} />
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label="Show the tool bar"
          className="flex h-8 w-full items-center justify-center gap-1.5"
          style={{ background: BRAND_RAIL_BG }}
        >
          <span className="text-xs font-semibold text-white">Design</span>
          <span className="text-xs font-semibold text-gradient-blue-magenta">ProAI™</span>
          <ChevronUp className="h-3.5 w-3.5" style={{ color: BRAND.cyan }} />
        </button>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <nav
        className="fixed bottom-0 left-0 right-0 z-50 shadow-[0_-5px_20px_rgba(0,199,255,0.15)]"
        style={{ background: BRAND_RAIL_BG, paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        {/* Brand hairline instead of the old flat blue border. */}
        <div className="h-[2px] w-full" style={{ background: BRAND_GRADIENT }} />
        <button
          type="button"
          onClick={toggle}
          aria-expanded
          aria-label="Close the tool bar"
          className="flex h-6 w-full items-center justify-center"
        >
          <span className="h-1 w-10 rounded-full bg-white/25" />
          <X className="ml-1.5 h-3.5 w-3.5 text-white/60" />
        </button>
        <div className="flex justify-around items-center h-14 max-w-screen-sm mx-auto px-1">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const toolPath = tool.path.split("?")[0];
            const isActive = location.pathname === toolPath;

            return (
              <Tooltip key={tool.path}>
                <TooltipTrigger asChild>
                  <Link
                    to={tool.path}
                    onClick={() => setCollapsed(true)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 px-1.5 py-1.5 rounded-lg transition-all",
                      !isActive && "text-white/70 hover:text-white hover:bg-white/10"
                    )}
                    style={isActive ? { background: `${BRAND.cyan}22` } : undefined}
                  >
                    <Icon
                      className="h-5 w-5 shrink-0"
                      style={{ color: isActive ? BRAND.cyan : tool.featured || tool.highlight ? BRAND.magenta : undefined }}
                    />
                    <span
                      className={cn("text-[9px] font-medium leading-tight", tool.featured && !isActive && "text-gradient-blue-subtle")}
                      style={isActive ? { color: BRAND.cyan } : !tool.featured ? { color: "rgba(255,255,255,0.85)" } : undefined}
                    >
                      {tool.label}
                    </span>
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[200px] text-center">
                  <p className="font-semibold text-foreground">{tool.fullLabel}</p>
                  <p className="text-xs text-muted-foreground mt-1">{tool.description}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </nav>
    </TooltipProvider>
  );
};
