import { useState, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, X, Grid3X3, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const VIEW_ORDER = ["roof", "side", "passenger-side", "hood_detail", "front", "rear", "close-up"];
const VIEW_LABELS: Record<string, string> = {
  side: "Driver Side",
  "passenger-side": "Passenger Side",
  hood_detail: "Hood",
  front: "Front",
  rear: "Rear",
  "close-up": "Close-Up",
  roof: "Roof Plan",
  hero: "Hero",
};

const MODE_LABELS: Record<string, string> = {
  colorpro: "ColorPro",
  ColorPro: "ColorPro",
  designpanelpro: "DesignProAI\u2122",
  fadewraps: "FadeWraps",
  wbty: "WBTY",
  approvemode: "ApproveMode",
  GraphicsPro: "GraphicsPro",
  CustomStyling: "CustomStyling",
  ColorProEnhanced: "ColorPro Enhanced",
  inkfusion: "InkFusion",
};

const MODE_COLORS: Record<string, string> = {
  colorpro: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  ColorPro: "bg-cyan-500/20 text-cyan-400 border-cyan-500/40",
  designpanelpro: "bg-purple-500/20 text-purple-400 border-purple-500/40",
  fadewraps: "bg-orange-500/20 text-orange-400 border-orange-500/40",
  wbty: "bg-green-500/20 text-green-400 border-green-500/40",
  approvemode: "bg-blue-500/20 text-blue-400 border-blue-500/40",
  GraphicsPro: "bg-pink-500/20 text-pink-400 border-pink-500/40",
  CustomStyling: "bg-amber-500/20 text-amber-400 border-amber-500/40",
  ColorProEnhanced: "bg-teal-500/20 text-teal-400 border-teal-500/40",
  inkfusion: "bg-indigo-500/20 text-indigo-400 border-indigo-500/40",
};

function getHeroUrl(render: any): string | null {
  const urls = render?.render_urls as Record<string, string> | null;
  if (!urls) return null;
  return urls.roof || urls.side || Object.values(urls)[0] || null;
}

function getAvailableViews(render: any): { key: string; url: string }[] {
  const urls = render?.render_urls as Record<string, string> | null;
  if (!urls) return [];
  return VIEW_ORDER.filter((k) => urls[k]).map((k) => ({ key: k, url: urls[k] }));
}

interface ShowcaseGridProps {
  renders: any[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  isSelecting: boolean;
}

export function ShowcaseGrid({ renders, selectedIds, onToggleSelect, isSelecting }: ShowcaseGridProps) {
  const [columns, setColumns] = useState<number>(3);
  const [modeFilter, setModeFilter] = useState<string>("all");
  const [fullscreenRender, setFullscreenRender] = useState<any | null>(null);
  const [currentViewIndex, setCurrentViewIndex] = useState(0);

  const filteredRenders = modeFilter === "all"
    ? renders
    : renders.filter((r) => r.mode_type === modeFilter);

  const uniqueModes = Array.from(new Set(renders.map((r) => r.mode_type).filter(Boolean)));

  const openFullscreen = useCallback((render: any) => {
    setFullscreenRender(render);
    setCurrentViewIndex(0);
  }, []);

  const views = fullscreenRender ? getAvailableViews(fullscreenRender) : [];

  const prevView = () => setCurrentViewIndex((i) => (i > 0 ? i - 1 : views.length - 1));
  const nextView = () => setCurrentViewIndex((i) => (i < views.length - 1 ? i + 1 : 0));

  const gridCols: Record<number, string> = {
    2: "grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-2 lg:grid-cols-4",
    5: "grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Grid3X3 className="w-4 h-4 text-zinc-400" />
          <Select value={String(columns)} onValueChange={(v) => setColumns(Number(v))}>
            <SelectTrigger className="w-28 bg-zinc-900 border-zinc-700 text-white h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              <SelectItem value="2">2 Columns</SelectItem>
              <SelectItem value="3">3 Columns</SelectItem>
              <SelectItem value="4">4 Columns</SelectItem>
              <SelectItem value="5">5 Columns</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Select value={modeFilter} onValueChange={setModeFilter}>
          <SelectTrigger className="w-40 bg-zinc-900 border-zinc-700 text-white h-9">
            <SelectValue placeholder="All Tools" />
          </SelectTrigger>
          <SelectContent className="bg-zinc-900 border-zinc-700">
            <SelectItem value="all">All Tools</SelectItem>
            {uniqueModes.map((m) => (
              <SelectItem key={m} value={m}>
                {MODE_LABELS[m] || m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-sm text-zinc-400 ml-auto">
          {filteredRenders.length} render{filteredRenders.length !== 1 ? "s" : ""}
          {selectedIds.size > 0 && ` \u00B7 ${selectedIds.size} selected`}
        </span>
      </div>

      {/* Grid */}
      <div className={cn("grid gap-3", gridCols[columns] || gridCols[3])}>
        {filteredRenders.map((render) => {
          const heroUrl = getHeroUrl(render);
          if (!heroUrl) return null;
          const mode = render.mode_type || "";
          const isSelected = selectedIds.has(render.id);

          return (
            <div
              key={render.id}
              className={cn(
                "group relative rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 cursor-pointer transition-all hover:border-zinc-600",
                isSelected && "ring-2 ring-cyan-500 border-cyan-500"
              )}
              onClick={() => (isSelecting ? onToggleSelect(render.id) : openFullscreen(render))}
            >
              <div className="aspect-video relative">
                <img
                  src={heroUrl}
                  alt={`${render.vehicle_year} ${render.vehicle_make} ${render.vehicle_model}`}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
                {/* Selecting checkbox overlay */}
                {isSelecting && (
                  <div className="absolute top-2 left-2 z-10">
                    <div className={cn(
                      "w-6 h-6 rounded border-2 flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-cyan-500 border-cyan-500"
                        : "bg-black/50 border-zinc-400"
                    )}>
                      {isSelected && <Check className="w-4 h-4 text-white" />}
                    </div>
                  </div>
                )}
                {/* Tool badge */}
                {mode && (
                  <Badge className={cn(
                    "absolute top-2 right-2 text-[10px] border",
                    MODE_COLORS[mode] || "bg-zinc-700/80 text-zinc-300 border-zinc-600"
                  )}>
                    {MODE_LABELS[mode] || mode}
                  </Badge>
                )}
              </div>
              <div className="p-3 space-y-1">
                <p className="text-sm font-semibold text-white truncate">
                  {render.vehicle_year} {render.vehicle_make} {render.vehicle_model}
                </p>
                <p className="text-xs text-zinc-400 truncate">
                  {render.color_name} &middot; {render.finish_type}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {filteredRenders.length === 0 && (
        <div className="text-center py-20 text-zinc-500">
          No renders found. Tag renders in Batch QA Studio or adjust filters.
        </div>
      )}

      {/* Fullscreen view overlay */}
      <Dialog open={!!fullscreenRender} onOpenChange={() => setFullscreenRender(null)}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 bg-black border-zinc-800 overflow-hidden">
          {fullscreenRender && views.length > 0 && (
            <div className="relative flex flex-col h-[90vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-3 bg-zinc-950 border-b border-zinc-800">
                <div className="flex items-center gap-3">
                  <p className="text-white font-semibold">
                    {fullscreenRender.vehicle_year} {fullscreenRender.vehicle_make} {fullscreenRender.vehicle_model}
                  </p>
                  <Badge variant="outline" className="border-zinc-600 text-zinc-300">
                    {fullscreenRender.color_name}
                  </Badge>
                  {fullscreenRender.mode_type && (
                    <Badge className={cn(
                      "text-[10px] border",
                      MODE_COLORS[fullscreenRender.mode_type] || "bg-zinc-700 text-zinc-300 border-zinc-600"
                    )}>
                      {MODE_LABELS[fullscreenRender.mode_type] || fullscreenRender.mode_type}
                    </Badge>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="text-zinc-400" onClick={() => setFullscreenRender(null)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              {/* Image */}
              <div className="flex-1 relative flex items-center justify-center bg-black p-4">
                <img
                  src={views[currentViewIndex]?.url}
                  alt={VIEW_LABELS[views[currentViewIndex]?.key] || "View"}
                  className="max-w-full max-h-full object-contain"
                />
                {views.length > 1 && (
                  <>
                    <button
                      className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 rounded-full p-2 text-white"
                      onClick={prevView}
                    >
                      <ChevronLeft className="w-6 h-6" />
                    </button>
                    <button
                      className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/60 hover:bg-black/80 rounded-full p-2 text-white"
                      onClick={nextView}
                    >
                      <ChevronRight className="w-6 h-6" />
                    </button>
                  </>
                )}
              </div>

              {/* View thumbnails */}
              <div className="flex items-center gap-2 px-6 py-3 bg-zinc-950 border-t border-zinc-800 overflow-x-auto">
                {views.map((v, i) => (
                  <button
                    key={v.key}
                    className={cn(
                      "flex-shrink-0 w-20 h-14 rounded border-2 overflow-hidden transition-colors",
                      i === currentViewIndex ? "border-cyan-500" : "border-zinc-700 hover:border-zinc-500"
                    )}
                    onClick={() => setCurrentViewIndex(i)}
                  >
                    <img src={v.url} alt={VIEW_LABELS[v.key]} className="w-full h-full object-cover" />
                  </button>
                ))}
                <span className="text-xs text-zinc-500 ml-2">
                  {VIEW_LABELS[views[currentViewIndex]?.key] || views[currentViewIndex]?.key}
                </span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
