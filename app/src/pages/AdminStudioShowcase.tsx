import { useState, useEffect, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Grid3X3, Play, Image, Award, Video,
  ArrowLeft, Loader2, CheckSquare, Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ShowcaseGrid } from "@/components/admin/ShowcaseGrid";
import { ShowcaseSlideshow } from "@/components/admin/ShowcaseSlideshow";
import { ShowcaseUSPs } from "@/components/admin/ShowcaseUSPs";
import { ShowcaseVideoPlayer } from "@/components/admin/ShowcaseVideoPlayer";

const CONFIG_KEY = "studio_showcase_config";

interface ShowcaseConfig {
  selectedIds: string[];
}

function loadConfig(): ShowcaseConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    return raw ? JSON.parse(raw) : { selectedIds: [] };
  } catch {
    return { selectedIds: [] };
  }
}

function saveConfig(config: ShowcaseConfig) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// Before/After slider inline component
function BeforeAfterSlider({ renders }: { renders: any[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [sliderPos, setSliderPos] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  // Filter renders that have both before_url in admin_notes and a render
  const pairs = renders.filter((r) => {
    try {
      const notes = JSON.parse(r.admin_notes || "{}");
      return !!notes.before_url;
    } catch {
      return false;
    }
  }).map((r) => {
    const notes = JSON.parse(r.admin_notes || "{}");
    const urls = r.render_urls as Record<string, string> | null;
    const afterUrl = urls?.hero || urls?.side || (urls ? Object.values(urls)[0] : null);
    return { render: r, beforeUrl: notes.before_url as string, afterUrl: afterUrl as string };
  }).filter((p) => p.afterUrl);

  const handleMove = useCallback((clientX: number) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    setSliderPos((x / rect.width) * 100);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging.current) handleMove(e.clientX);
    };
    const handleMouseUp = () => { isDragging.current = false; };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMove]);

  const activePair = pairs[activeIndex];

  if (pairs.length === 0) {
    return (
      <div className="text-center py-20 text-zinc-500">
        <Image className="w-10 h-10 mx-auto mb-3 opacity-40" />
        <p>No before/after pairs found.</p>
        <p className="text-sm mt-1">Renders need a <code>before_url</code> in admin_notes to appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Thumbnails */}
      {pairs.length > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {pairs.map((p, i) => (
            <button
              key={p.render.id}
              className={cn(
                "flex-shrink-0 w-24 h-16 rounded border-2 overflow-hidden transition-colors",
                i === activeIndex ? "border-cyan-500" : "border-zinc-700 hover:border-zinc-500"
              )}
              onClick={() => { setActiveIndex(i); setSliderPos(50); }}
            >
              <img src={p.afterUrl} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
        </div>
      )}

      {/* Slider */}
      {activePair && (
        <div className="space-y-3">
          <p className="text-sm text-zinc-300">
            {activePair.render.vehicle_year} {activePair.render.vehicle_make} {activePair.render.vehicle_model}
            <span className="text-zinc-500 ml-2">&middot; {activePair.render.color_name}</span>
          </p>
          <div
            ref={containerRef}
            className="relative aspect-video rounded-lg overflow-hidden border border-zinc-800 cursor-ew-resize select-none"
            onMouseDown={(e) => { isDragging.current = true; handleMove(e.clientX); }}
            onTouchMove={(e) => handleMove(e.touches[0].clientX)}
          >
            {/* After (full) */}
            <img src={activePair.afterUrl} alt="After" className="absolute inset-0 w-full h-full object-cover" />

            {/* Before (clipped) */}
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ width: `${sliderPos}%` }}
            >
              <img
                src={activePair.beforeUrl}
                alt="Before"
                className="absolute inset-0 w-full h-full object-cover"
                style={{ width: `${containerRef.current?.offsetWidth || 0}px` }}
              />
            </div>

            {/* Slider line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg z-10"
              style={{ left: `${sliderPos}%` }}
            >
              <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white shadow-lg flex items-center justify-center">
                <div className="flex gap-0.5">
                  <div className="w-0.5 h-3 bg-zinc-400 rounded-full" />
                  <div className="w-0.5 h-3 bg-zinc-400 rounded-full" />
                </div>
              </div>
            </div>

            {/* Labels */}
            <div className="absolute top-3 left-3 z-10">
              <Badge className="bg-black/60 text-white border-0 text-xs">Before</Badge>
            </div>
            <div className="absolute top-3 right-3 z-10">
              <Badge className="bg-cyan-500/80 text-white border-0 text-xs">After</Badge>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Main page component
export default function AdminStudioShowcase() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("grid");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => {
    const config = loadConfig();
    return new Set(config.selectedIds);
  });
  const [isSelecting, setIsSelecting] = useState(false);
  const [showSlideshow, setShowSlideshow] = useState(false);

  // Persist selections
  useEffect(() => {
    saveConfig({ selectedIds: Array.from(selectedIds) });
  }, [selectedIds]);

  // Fetch showcase renders - ISA demo tagged or featured
  const { data: renders = [], isLoading } = useQuery({
    queryKey: ["studio-showcase-renders"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("*")
        .not("render_urls", "is", null)
        .order("created_at", { ascending: false })
        .limit(200);

      if (error) throw error;

      // Filter to renders that have at least one valid render URL
      return (data || []).filter((r) => {
        const urls = r.render_urls as Record<string, string> | null;
        return urls && Object.values(urls).some((u) => typeof u === "string" && u.startsWith("http"));
      });
    },
  });

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectedRenders = renders.filter((r) => selectedIds.has(r.id));
  const slideshowRenders = selectedRenders.length > 0 ? selectedRenders : renders;

  // Launch slideshow
  if (showSlideshow) {
    return (
      <ShowcaseSlideshow
        renders={slideshowRenders}
        onExit={() => setShowSlideshow(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Header */}
      <div className="border-b border-zinc-800 bg-zinc-950">
        <div className="max-w-[1600px] mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button
                size="sm"
                variant="ghost"
                className="text-zinc-400 hover:text-white"
                onClick={() => navigate(-1)}
              >
                <ArrowLeft className="w-4 h-4 mr-1" /> Back
              </Button>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Studio Showcase</h1>
                <p className="text-xs text-zinc-500">Tradeshow Presentation Mode</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Selection toggle */}
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-400">Select for Slideshow</span>
                <Switch checked={isSelecting} onCheckedChange={setIsSelecting} />
              </div>

              {selectedIds.size > 0 && (
                <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/40 border">
                  {selectedIds.size} selected
                </Badge>
              )}

              {/* Launch slideshow */}
              <Button
                className="bg-gradient-to-r from-cyan-500 to-blue-600 hover:brightness-110 text-white"
                onClick={() => setShowSlideshow(true)}
              >
                <Play className="w-4 h-4 mr-2" /> Launch Slideshow
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-[1600px] mx-auto px-6 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-500" />
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="bg-zinc-900 border border-zinc-800 mb-6">
              <TabsTrigger value="grid" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white">
                <Grid3X3 className="w-4 h-4 mr-2" /> Grid
              </TabsTrigger>
              <TabsTrigger value="beforeafter" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white">
                <Image className="w-4 h-4 mr-2" /> Before/After
              </TabsTrigger>
              <TabsTrigger value="usp" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white">
                <Award className="w-4 h-4 mr-2" /> Features
              </TabsTrigger>
              <TabsTrigger value="video" className="data-[state=active]:bg-zinc-700 data-[state=active]:text-white">
                <Video className="w-4 h-4 mr-2" /> Videos
              </TabsTrigger>
            </TabsList>

            <TabsContent value="grid">
              <ShowcaseGrid
                renders={renders}
                selectedIds={selectedIds}
                onToggleSelect={toggleSelect}
                isSelecting={isSelecting}
              />
            </TabsContent>

            <TabsContent value="beforeafter">
              <BeforeAfterSlider renders={renders} />
            </TabsContent>

            <TabsContent value="usp">
              <ShowcaseUSPs />
            </TabsContent>

            <TabsContent value="video">
              <ShowcaseVideoPlayer />
            </TabsContent>
          </Tabs>
        )}
      </div>
    </div>
  );
}
