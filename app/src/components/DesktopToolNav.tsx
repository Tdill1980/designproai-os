import { Link, useLocation } from "react-router-dom";
import { Palette, Layers, Workflow, CheckSquare, Rotate3D, Sparkles, Blend, Scissors, Stamp, ChevronUp, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useIsAppRoute } from "@/hooks/useIsAppRoute";
import { useToolNavCollapse } from "@/hooks/useToolNavCollapse";
import { BRAND, BRAND_ACTIVE_GLOW, BRAND_GRADIENT, BRAND_RAIL_BG } from "@/lib/brandColors";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCallback } from "react";

// Map nav paths to their lazy chunk imports for prefetch-on-hover
const prefetchMap: Record<string, () => Promise<any>> = {
  "/graphics-pro": () => import("@/pages/GraphicsProV1"),
  "/designpro": () => import("@/pages/DesignPanelProPremium"),
  "/colorpro": () => import("@/pages/ColorPro"),
  "/restylelibrary": () => import("@/pages/DesignPro"),
  "/productionflow": () => import("@/pages/ProductionFlow"),
  "/approvepro": () => import("@/pages/ApproveProPage"),
  "/revision-studio": () => import("@/pages/RevisionStudioIQ"),
  "/logopro": () => import("@/pages/LogoPro"),
};
const prefetched = new Set<string>();

const tools = [
  {
    path: "/graphics-pro",
    icon: Scissors,
    label: "GraphicsPro™",
    description: "Cut vinyl graphics design-to-production. Any surface. Photorealistic mockups. Production-ready cut files.",
    highlight: false,
    featured: true
  },
  {
    path: "/designpro",
    icon: Sparkles,
    label: "DesignProAI™",
    description: "The world's first prompt-to-print vehicle wrap design tool. AI-powered wrap creation.",
    highlight: false,
    featured: true
  },
  {
    path: "/logopro",
    icon: Stamp,
    label: "LogoPro™",
    description: "Professional logos in minutes. AI-generated, finished by real designers, delivered as PNG, SVG, and EPS.",
    highlight: false,
    featured: true
  },
  {
    path: "/colorpro",
    icon: Palette,
    label: "ColorPro™",
    description: "Visualize any vinyl wrap color on your vehicle. Upload swatches or browse manufacturer colors.",
    highlight: false,
    featured: false
  },
  {
    path: "/restylelibrary",
    icon: Layers,
    label: "RestyleLibrary™",
    description: "Professional wrap design library with curated panels and production packs.",
    highlight: false,
    featured: false
  },
  {
    path: "/productionflow?tab=prep",
    icon: Workflow,
    label: "ProductionFlow™",
    description: "Track and manage your print production pipeline from prep to ship.",
    highlight: false,
    featured: false
  },
  {
    path: "/approvepro",
    icon: CheckSquare,
    label: "ApprovePro™",
    description: "Send proofs, collect approvals, and manage revisions for every design job.",
    highlight: false,
    featured: false
  },
  {
    path: "/revision-studio",
    icon: Sparkles,
    label: "RevisionStudioIQ™",
    description: "Clone, revise, and evolve your wrap designs with AI-powered version tracking.",
    highlight: true,
    featured: false
  },
];

/**
 * Space the rail reserves at the bottom of every page so it never covers
 * content. Expanded: 62px rail + 32px offset (bottom-8) + breathing room.
 * Collapsed: the small pill + the same offset.
 */
const RESERVE_EXPANDED = "100px";
const RESERVE_COLLAPSED = "68px";

export const DesktopToolNav = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const isAppRoute = useIsAppRoute();
  const { collapsed, setCollapsed, toggle } = useToolNavCollapse(RESERVE_EXPANDED, RESERVE_COLLAPSED, !isMobile && !isAppRoute);

  const handlePrefetch = useCallback((path: string) => {
    const basePath = path.split("?")[0];
    if (prefetched.has(basePath)) return;
    const loader = prefetchMap[basePath];
    if (loader) {
      prefetched.add(basePath);
      loader().catch(() => {}); // fire-and-forget, ignore errors
    }
  }, []);

  if (isMobile) return null;
  // AppShell provides its own sidebar on app routes
  if (isAppRoute) return null;

  // Folded away — a small brand pill the user can click to bring the rail back.
  if (collapsed) {
    return (
      <div
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 rounded-full p-[1px] shadow-[0_0_24px_rgba(0,199,255,0.18)]"
        style={{ background: BRAND_GRADIENT }}
      >
        <button
          type="button"
          onClick={toggle}
          aria-expanded={false}
          aria-label="Show the tool bar"
          className="flex items-center gap-2 rounded-full px-4 py-1.5 backdrop-blur-lg transition-opacity hover:opacity-90"
          style={{ background: BRAND_RAIL_BG }}
        >
          <span className="text-sm font-semibold text-white whitespace-nowrap">Restyle</span>
          <span className="text-sm font-semibold text-gradient-blue-magenta whitespace-nowrap">ProAI™</span>
          <ChevronUp className="h-4 w-4" style={{ color: BRAND.cyan }} />
        </button>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      {/* 1px gradient ring: brand blue -> magenta, with the rail surface inside. */}
      <nav
        className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 max-w-[calc(100vw-2rem)] rounded-full p-[1px] shadow-[0_0_30px_rgba(0,199,255,0.16)]"
        style={{ background: BRAND_GRADIENT }}
      >
        <div className="flex items-center gap-2 rounded-full px-3 py-3 backdrop-blur-lg" style={{ background: BRAND_RAIL_BG }}>
          <Link to="/" className="flex shrink-0 items-center gap-1 px-2 py-1.5 border-r border-white/15 pr-3">
            <span className="text-sm font-semibold text-white whitespace-nowrap">Restyle</span>
            <span className="text-sm font-semibold text-gradient-blue-magenta whitespace-nowrap">ProAI™</span>
          </Link>
          {/* Scrolls horizontally on narrow windows instead of pushing the rail
              (and its collapse control) off the edge of the viewport. */}
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto">
          {tools.map((tool) => {
            const Icon = tool.icon;
            const toolPath = tool.path.split("?")[0];
            const isActive = location.pathname === toolPath;

            return (
              <Tooltip key={tool.path}>
                <TooltipTrigger asChild>
                  <Link
                    to={tool.path}
                    onMouseEnter={() => handlePrefetch(tool.path)}
                    onClick={() => setCollapsed(true)}
                    className={cn(
                      "flex shrink-0 items-center gap-2 px-3 py-2 rounded-full border transition-all justify-center whitespace-nowrap",
                      isActive
                        ? "border-transparent"
                        : tool.featured || tool.highlight
                          ? "border-white/20 bg-white/5 hover:bg-white/10"
                          : "border-transparent text-white/70 hover:text-white hover:bg-white/10"
                    )}
                    style={
                      isActive
                        ? { background: `${BRAND.cyan}22`, borderColor: `${BRAND.cyan}66`, boxShadow: BRAND_ACTIVE_GLOW }
                        : undefined
                    }
                  >
                    <Icon
                      className="h-5 w-5"
                      style={{ color: isActive ? BRAND.cyan : tool.featured || tool.highlight ? BRAND.magenta : undefined }}
                    />
                    <span
                      className={cn("text-sm font-medium", tool.featured && !isActive && "text-gradient-blue-subtle")}
                      style={isActive ? { color: BRAND.cyan } : !tool.featured ? { color: "rgba(255,255,255,0.85)" } : undefined}
                    >
                      {tool.label}
                    </span>
                    {isActive && <Rotate3D className="h-3 w-3 animate-pulse" style={{ color: BRAND.cyan }} />}
                  </Link>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[220px] text-center">
                  <p className="font-semibold text-foreground">{tool.label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{tool.description}</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                aria-expanded
                aria-label="Close the tool bar"
                className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/15 text-white/70 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-xs">Close the tool bar</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </nav>
    </TooltipProvider>
  );
};
