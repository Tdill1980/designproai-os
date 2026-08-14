/**
 * RenderBrowser — Browse renders from color_visualizations + graphics_pro_jobs
 * Used by Content Studio (canvas image insert) and Email Campaign Designer (HTML img insert)
 * Tabs: Starred, ColorPro, GraphicsPro, DesignPro, FadeWraps, PatternPro, All
 *
 * NOTE: GraphicsPro (the current /graphics-pro tool, GraphicsProV1) persists mockups
 * to the `graphics_pro_jobs` table, NOT `color_visualizations`. The OLD deprecated
 * /graphicspro flow saved rows with mode_type="GraphicsPro" in color_visualizations,
 * which is what the previous tab filter showed — wrong version. The GraphicsPro tab
 * now pulls from graphics_pro_jobs so Content Studio surfaces the current tool's
 * output, and the All tab merges both sources.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { isAllowlistedAdmin } from "@/lib/admin-allowlist";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Loader2, Search, ImageIcon, Star, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const DRIVER_FIRST_ORDER = ["side", "driver-side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"];

// All browsable tool modes
const MODE_TABS = [
  { key: "starred", label: "Starred", dbValue: null, color: "text-yellow-400" },
  { key: "colorpro", label: "ColorPro", dbValue: "colorpro", color: "text-cyan-400" },
  { key: "graphicspro", label: "GraphicsPro", dbValue: "GraphicsPro", color: "text-pink-400" },
  { key: "designpro", label: "DesignPro", dbValue: "designpanelpro", color: "text-purple-400" },
  { key: "fadewraps", label: "FadeWraps", dbValue: "fadewraps", color: "text-orange-400" },
  { key: "patternpro", label: "PatternPro", dbValue: "wbty", color: "text-green-400" },
  { key: "all", label: "All", dbValue: "__all__", color: "text-foreground" },
] as const;

type TabKey = typeof MODE_TABS[number]["key"];

interface RenderItem {
  id: string;
  colorName: string;
  vehicle: string;
  finish: string;
  modeType: string;
  viewUrls: { view: string; url: string }[];
  createdAt: string;
  isStarred: boolean;
}

interface RenderBrowserProps {
  onSelect: (url: string, meta: { designName: string; vehicle: string; view: string }) => void;
  triggerLabel?: string;
  triggerVariant?: "ghost" | "outline" | "default" | "secondary";
  triggerSize?: "sm" | "default" | "icon";
  triggerClassName?: string;
}

export function RenderBrowser({
  onSelect,
  triggerLabel = "Browse Renders",
  triggerVariant = "outline",
  triggerSize = "sm",
  triggerClassName,
}: RenderBrowserProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  // Single query hook per tab — enabled only when that tab is active + dialog is open
  const useTabQuery = (tab: typeof MODE_TABS[number]) => {
    return useQuery({
      queryKey: ["render-browser", tab.key],
      queryFn: async () => {
        if (tab.key === "starred") return fetchRenders({ starredOnly: true });
        if (tab.key === "graphicspro") {
          // Current graphics-pro tool writes to graphics_pro_jobs, not color_visualizations
          return fetchGraphicsProJobs();
        }
        if (tab.key === "all") {
          // Merge both sources for "All" so graphics-pro mockups appear alongside everything else
          const [cv, gp] = await Promise.all([fetchRenders({}), fetchGraphicsProJobs()]);
          return [...cv, ...gp].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
        }
        return fetchRenders({ modeType: tab.dbValue! });
      },
      enabled: open && activeTab === tab.key,
      staleTime: 60_000,
    });
  };

  const starredQ = useTabQuery(MODE_TABS[0]);
  const colorproQ = useTabQuery(MODE_TABS[1]);
  const graphicsproQ = useTabQuery(MODE_TABS[2]);
  const designproQ = useTabQuery(MODE_TABS[3]);
  const fadewrapsQ = useTabQuery(MODE_TABS[4]);
  const patternproQ = useTabQuery(MODE_TABS[5]);
  const allQ = useTabQuery(MODE_TABS[6]);

  const queries: Record<TabKey, typeof starredQ> = {
    starred: starredQ, colorpro: colorproQ, graphicspro: graphicsproQ,
    designpro: designproQ, fadewraps: fadewrapsQ, patternpro: patternproQ, all: allQ,
  };

  const currentQ = queries[activeTab];
  const renders = currentQ.data || [];
  const isLoading = currentQ.isLoading;

  const filtered = renders.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.colorName.toLowerCase().includes(q) ||
      r.vehicle.toLowerCase().includes(q) ||
      r.modeType.toLowerCase().includes(q);
  });

  const handlePick = (url: string, render: RenderItem, view: string) => {
    onSelect(url, { designName: render.colorName, vehicle: render.vehicle, view });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant} size={triggerSize} className={cn("gap-1.5", triggerClassName)}>
          <ImageIcon className="h-3.5 w-3.5" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4 text-cyan-400" />
            Browse Renders
          </DialogTitle>
        </DialogHeader>

        {/* Mode tabs — scrollable on narrow screens */}
        <div className="flex gap-1 border-b border-border pb-1 overflow-x-auto">
          {MODE_TABS.map(tab => {
            const count = queries[tab.key].data?.length;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "px-2.5 py-1.5 text-[11px] font-medium rounded-t transition-colors whitespace-nowrap flex-shrink-0",
                  activeTab === tab.key
                    ? "bg-cyan-500/20 text-cyan-300 border-b-2 border-cyan-400"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {tab.key === "starred" && <Star className="h-3 w-3 inline mr-1 text-yellow-400" />}
                {tab.label}
                {count != null && <span className="ml-1 text-[9px] opacity-60">({count})</span>}
              </button>
            );
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by design name, vehicle, or mode..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <ScrollArea className="flex-1 min-h-0" style={{ maxHeight: "calc(85vh - 200px)" }}>
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              {search
                ? "No renders match your search"
                : activeTab === "starred"
                  ? "No starred renders found. Star renders in the Gallery first."
                  : `No ${MODE_TABS.find(t => t.key === activeTab)?.label || ""} renders found.`}
            </div>
          ) : (
            <div className="space-y-4 pr-2">
              {filtered.map(render => (
                <div key={render.id} className="border border-border rounded-lg p-3 bg-card/50">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <p className="text-sm font-medium">{render.vehicle}</p>
                    <Badge variant="outline" className="text-[10px]">{render.colorName}</Badge>
                    <Badge className={cn("text-[10px]", modeBadgeColor(render.modeType))}>
                      {modeLabel(render.modeType)}
                    </Badge>
                    {render.isStarred && (
                      <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {render.viewUrls.length} views
                    </span>
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-1.5">
                    {render.viewUrls.map(({ view, url }) => (
                      <button
                        key={view}
                        onClick={() => handlePick(url, render, view)}
                        className="group relative aspect-video rounded overflow-hidden border border-border hover:border-cyan-500 transition-colors"
                      >
                        <img
                          src={url}
                          alt={`${render.colorName} ${view}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                          <Check className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <span className="absolute bottom-0 left-0 right-0 bg-black/70 text-[9px] text-center text-white py-0.5 truncate">
                          {view.replace(/_/g, " ").replace(/-/g, " ")}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────
function modeLabel(mode: string) {
  if (mode === "designpanelpro") return "DesignPro";
  if (mode === "fadewraps") return "FadeWraps";
  if (mode === "GraphicsPro" || mode === "graphicspro" || mode === "graphics-pro") return "GraphicsPro";
  if (mode === "wbty") return "PatternPro";
  if (mode === "approvemode") return "ApprovePro";
  if (mode === "inkfusion") return "InkFusion";
  return "ColorPro";
}

function modeBadgeColor(mode: string) {
  if (mode === "GraphicsPro" || mode === "graphicspro" || mode === "graphics-pro") return "bg-pink-500/20 text-pink-300 border-pink-500/30";
  if (mode === "designpanelpro") return "bg-purple-500/20 text-purple-300 border-purple-500/30";
  if (mode === "fadewraps") return "bg-orange-500/20 text-orange-300 border-orange-500/30";
  if (mode === "wbty") return "bg-green-500/20 text-green-300 border-green-500/30";
  if (mode === "approvemode") return "bg-amber-500/20 text-amber-300 border-amber-500/30";
  return "bg-cyan-500/20 text-cyan-300 border-cyan-500/30";
}

// ── GraphicsPro (V1) — graphics_pro_jobs table ────────────────────────
// Separate table from color_visualizations, so it needs its own fetcher.
// Maps the job row onto the RenderItem shape consumed by the rest of the UI.
async function fetchGraphicsProJobs(): Promise<RenderItem[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;

  let isAdmin = isAllowlistedAdmin(userEmail);
  if (!isAdmin && userId) {
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "tester"])
      .limit(1)
      .maybeSingle();
    isAdmin = !!roleRow;
  }

  let query = supabase
    .from("graphics_pro_jobs" as any)
    .select("id, user_id, mode, surface_type, vehicle_year, vehicle_make, vehicle_model, design_prompt, business_name, vinyl_finish, mockup_render_url, detail_render_url, closeup_render_url, status, created_at")
    .not("mockup_render_url", "is", null)
    .in("status", ["mockup_ready", "approved", "processing", "complete"])
    .order("created_at", { ascending: false })
    .limit(300);

  // Standard users only see their own jobs. RLS already enforces this, but the
  // explicit filter keeps admin behavior consistent with color_visualizations.
  if (!isAdmin && userId) {
    query = query.eq("user_id", userId);
  }

  const { data, error } = await query;
  if (error) {
    console.warn("fetchGraphicsProJobs error:", error.message);
    return [];
  }

  const items: RenderItem[] = [];
  for (const row of (data || []) as any[]) {
    const views: { view: string; url: string }[] = [];
    if (row.mockup_render_url) views.push({ view: "mockup", url: row.mockup_render_url });
    if (row.detail_render_url) views.push({ view: "detail", url: row.detail_render_url });
    if (row.closeup_render_url) views.push({ view: "close-up", url: row.closeup_render_url });
    if (views.length === 0) continue;

    // Vehicle label: prefer year/make/model when present, else surface_type
    const vehicle = [row.vehicle_year, row.vehicle_make, row.vehicle_model]
      .filter(Boolean)
      .join(" ")
      .trim() || (row.surface_type ? row.surface_type.charAt(0).toUpperCase() + row.surface_type.slice(1) : "Graphic");

    // Title: business_name (commercial) → design_prompt (design) → fallback
    const title = row.business_name
      || (row.design_prompt ? String(row.design_prompt).slice(0, 60) : "")
      || "Graphic";

    items.push({
      id: row.id,
      colorName: title,
      vehicle,
      finish: row.vinyl_finish || "Glossy",
      modeType: "graphics-pro",
      viewUrls: views,
      createdAt: row.created_at,
      isStarred: false,
    });
  }
  return items;
}

async function fetchRenders(opts: { starredOnly?: boolean; modeType?: string }): Promise<RenderItem[]> {
  // Match how Gallery + RevisionStudioIQ query renders.
  // Admins / testers see ALL renders. Standard users see their own + their org's.
  // Bumped to 300 rows to cover operators with large render histories (Carley / Jackson).
  const { data: { session } } = await supabase.auth.getSession();
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;

  let isAdmin = isAllowlistedAdmin(userEmail);
  if (!isAdmin && userId) {
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .in("role", ["admin", "tester"])
      .limit(1)
      .maybeSingle();
    isAdmin = !!roleRow;
  }

  let query = supabase
    .from("color_visualizations")
    .select("id, color_name, design_file_name, vehicle_year, vehicle_make, vehicle_model, finish_type, mode_type, render_urls, created_at, is_featured_hero, customer_email, organization_id")
    .eq("generation_status", "completed")
    .not("render_urls", "is", null)
    .order("created_at", { ascending: false })
    .limit(300);

  // Non-admin → filter to own renders + org renders (matches RevisionStudioIQ default)
  if (!isAdmin && userEmail) {
    const { data: orgRow } = await supabase
      .from("color_visualizations")
      .select("organization_id")
      .eq("customer_email", userEmail)
      .not("organization_id", "is", null)
      .limit(1)
      .maybeSingle();

    if (orgRow?.organization_id) {
      query = query.or(`customer_email.eq.${userEmail},organization_id.eq.${orgRow.organization_id}`);
    } else {
      query = query.eq("customer_email", userEmail);
    }
  } else if (isAdmin) {
    // Hide demo-seed clones from the admin browse view so designs don't
    // appear twice (original + RoyaltyWraps demo copy).
    query = query.not("admin_notes", "ilike", "%royaltywraps_demo_seed%");
  }

  if (opts.starredOnly) {
    query = query.eq("is_featured_hero", true);
  }
  if (opts.modeType) {
    query = query.eq("mode_type", opts.modeType);
  }

  const { data, error } = await query;
  if (error) throw error;

  const items: RenderItem[] = [];
  for (const row of data || []) {
    const urls = row.render_urls as Record<string, string> | null;
    if (!urls || typeof urls !== "object") continue;

    const viewUrls: { view: string; url: string }[] = [];
    for (const vk of DRIVER_FIRST_ORDER) {
      if (urls[vk] && typeof urls[vk] === "string") {
        viewUrls.push({ view: vk, url: urls[vk] });
      }
    }
    for (const [vk, vu] of Object.entries(urls)) {
      if (typeof vu === "string" && !viewUrls.find(v => v.view === vk)) {
        viewUrls.push({ view: vk, url: vu });
      }
    }
    if (viewUrls.length === 0) continue;

    items.push({
      id: row.id,
      colorName: row.color_name || row.design_file_name || "Untitled",
      vehicle: `${row.vehicle_year || ""} ${row.vehicle_make || ""} ${row.vehicle_model || ""}`.trim(),
      finish: row.finish_type || "Gloss",
      modeType: row.mode_type || "colorpro",
      viewUrls,
      createdAt: row.created_at,
      isStarred: !!row.is_featured_hero,
    });
  }
  return items;
}
