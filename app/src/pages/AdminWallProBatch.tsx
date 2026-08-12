import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Zap, Play, Square, Loader2, XCircle, Star, Clock, RefreshCw,
  Layers, CheckCircle2, Image as ImageIcon, Trash2, Download,
  Eye, EyeOff, Pencil, Save, History, LayoutGrid, Sparkles, Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import {
  getRandomWallPresets,
  WALL_CATEGORIES,
  WALL_CATEGORY_LABELS,
  type WallPromptPreset,
  type WallCategory,
} from "@/data/wall-prompt-presets";

/* ================================================================ */
/* Types                                                            */
/* ================================================================ */

type WallMode = "generate" | "studio";

interface WallJob {
  id: string;
  prompt: WallPromptPreset;
  mode: WallMode;
  surfaceType: string;
  status: "queued" | "running" | "done" | "failed";
  imageUrl: string | null;
  storagePath: string | null;
  designName: string | null;
  error: string | null;
  startedAt: number | null;
  durationMs: number | null;
  published: boolean;
}

interface GalleryDesign {
  id: string;
  name: string;
  category: string;
  subcategory: string | null;
  prompt: string | null;
  image_url: string | null;
  thumbnail_url: string | null;
  storage_path: string | null;
  tags: string[];
  is_active: boolean;
  sort_order: number;
  rating: number | null;
  batch_id: string | null;
  surface_type: string | null;
  mode: string | null;
  thumb_gradient: string | null;
  description: string | null;
  created_at: string;
}

const SURFACE_TYPES = [
  { value: "studio_wall", label: "Studio Wall (flat art)" },
  { value: "office", label: "Office Interior" },
  { value: "gym", label: "Gym Interior" },
  { value: "retail", label: "Retail Interior" },
  { value: "restaurant", label: "Restaurant Interior" },
  { value: "lobby", label: "Lobby Interior" },
  { value: "living", label: "Living Room Interior" },
] as const;

const db = supabase as any;

/* ================================================================ */
/* Star Rating                                                      */
/* ================================================================ */

function StarRating({ value, onChange }: { value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button key={s} onClick={() => onChange(s)} className="p-0 bg-transparent border-none cursor-pointer">
          <Star className={cn("h-4 w-4 transition-colors", s <= (value || 0) ? "text-yellow-400 fill-yellow-400" : "text-zinc-600 hover:text-yellow-300")} />
        </button>
      ))}
    </div>
  );
}

/* ================================================================ */
/* Main Page                                                        */
/* ================================================================ */

export default function AdminWallProBatch() {
  const queryClient = useQueryClient();

  /* ── Generator state ──────────────────────────────────────────── */
  const [category, setCategory] = useState<WallCategory | "all">("all");
  const [batchSize, setBatchSize] = useState(10);
  const [mode, setMode] = useState<WallMode>("generate");
  const [surfaceType, setSurfaceType] = useState("studio_wall");
  const [jobs, setJobs] = useState<WallJob[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const shouldStopRef = useRef(false);
  const [completedCount, setCompletedCount] = useState(0);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [batchId, setBatchId] = useState("");

  /* ── Gallery manager state ────────────────────────────────────── */
  const [galleryFilter, setGalleryFilter] = useState<string>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  /* ── Gallery query ────────────────────────────────────────────── */
  const { data: galleryDesigns = [], isLoading: galleryLoading } = useQuery({
    queryKey: ["wallpro-designs"],
    queryFn: async () => {
      const { data, error } = await db
        .from("wallpro_designs")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as GalleryDesign[];
    },
  });

  /* ── Derived batch history ────────────────────────────────────── */
  const batchHistory = (() => {
    const batches: Record<string, {
      batch_id: string;
      count: number;
      created_at: string;
      categories: string[];
      avgRating: number | null;
      activeCount: number;
    }> = {};

    for (const d of galleryDesigns) {
      if (!d.batch_id) continue;
      if (!batches[d.batch_id]) {
        batches[d.batch_id] = {
          batch_id: d.batch_id,
          count: 0,
          created_at: d.created_at,
          categories: [],
          avgRating: null,
          activeCount: 0,
        };
      }
      batches[d.batch_id].count++;
      if (d.is_active) batches[d.batch_id].activeCount++;
      if (d.category && !batches[d.batch_id].categories.includes(d.category)) {
        batches[d.batch_id].categories.push(d.category);
      }
    }

    for (const bid of Object.keys(batches)) {
      const rated = galleryDesigns.filter(d => d.batch_id === bid && d.rating);
      if (rated.length > 0) {
        batches[bid].avgRating = +(rated.reduce((s, d) => s + (d.rating || 0), 0) / rated.length).toFixed(1);
      }
    }

    return Object.values(batches).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  })();

  /* ── Build queue ──────────────────────────────────────────────── */
  const buildBatch = useCallback(() => {
    const id = `wallbatch_${Date.now()}`;
    setBatchId(id);
    const presets = getRandomWallPresets(batchSize, category === "all" ? undefined : category);
    const newJobs: WallJob[] = presets.map((preset, i) => ({
      id: `wall_${Date.now()}_${i}`,
      prompt: preset,
      mode,
      surfaceType: mode === "generate" ? "studio_wall" : surfaceType,
      status: "queued",
      imageUrl: null,
      storagePath: null,
      designName: null,
      error: null,
      startedAt: null,
      durationMs: null,
      published: false,
    }));
    setJobs(newJobs);
    setCompletedCount(0);
    shouldStopRef.current = false;
    setRatings({});
    toast.success(`${newJobs.length} wall design jobs queued`);
  }, [batchSize, category, mode, surfaceType]);

  /* ── Run one job ──────────────────────────────────────────────── */
  const runOne = async (job: WallJob): Promise<Partial<WallJob>> => {
    const t0 = Date.now();
    try {
      const { data, error } = await supabase.functions.invoke("generate-wall-design", {
        body: {
          mode: job.mode,
          prompt: job.prompt.prompt,
          surface_type: job.surfaceType,
          height_inches: 96,
          width_inches: 144,
          aspect_ratio: "16:9",
        },
      });
      if (error) {
        const detail = data?.error || error.message;
        throw new Error(detail || "Generation failed");
      }
      if (!data?.image_url) throw new Error("No image returned");
      return {
        status: "done",
        imageUrl: data.image_url,
        storagePath: data.storage_path || null,
        designName: data.design_name || null,
        durationMs: Date.now() - t0,
      };
    } catch (err: any) {
      return { status: "failed", error: err.message || "Unknown error", durationMs: Date.now() - t0 };
    }
  };

  /* ── Run batch ────────────────────────────────────────────────── */
  const runBatch = async () => {
    setIsRunning(true);
    shouldStopRef.current = false;
    setCompletedCount(0);

    for (let i = 0; i < jobs.length; i++) {
      if (shouldStopRef.current) break;
      const job = jobs[i];
      if (job.status === "done") { setCompletedCount(c => c + 1); continue; }

      setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, status: "running", startedAt: Date.now() } : j));
      const result = await runOne(job);
      setJobs(prev => prev.map((j, idx) => idx === i ? { ...j, ...result } : j));
      setCompletedCount(c => c + 1);

      if (result.status === "done") toast.success(`Wall ${i + 1}/${jobs.length} complete`);
      else toast.error(`Wall ${i + 1} failed: ${result.error}`);

      if (i < jobs.length - 1 && !shouldStopRef.current) {
        await new Promise(r => setTimeout(r, 1500));
      }
    }

    setIsRunning(false);
    toast.success("Batch complete!");
  };

  const stopBatch = () => {
    shouldStopRef.current = true;
    toast.info("Stopping after current job...");
  };

  /* ── Delete from storage + local state ────────────────────────── */
  const deleteDesign = async (job: WallJob) => {
    try {
      if (job.storagePath) {
        await supabase.storage.from("wrap-files").remove([job.storagePath]);
      } else if (job.imageUrl) {
        const match = job.imageUrl.match(/wrap-files\/(.+?)(\?|$)/);
        if (match) await supabase.storage.from("wrap-files").remove([match[1]]);
      }
      setJobs(prev => prev.filter(j => j.id !== job.id));
      toast.success(`"${job.designName || "Design"}" deleted`);
    } catch (err: any) {
      toast.error("Delete failed: " + (err.message || "Unknown error"));
    }
  };

  /* ── Regenerate single ────────────────────────────────────────── */
  const regenerateDesign = async (jobIndex: number) => {
    const job = jobs[jobIndex];
    if (!job) return;
    if (job.storagePath) {
      await supabase.storage.from("wrap-files").remove([job.storagePath]);
    } else if (job.imageUrl) {
      const match = job.imageUrl.match(/wrap-files\/(.+?)(\?|$)/);
      if (match) await supabase.storage.from("wrap-files").remove([match[1]]);
    }
    setJobs(prev => prev.map((j, idx) =>
      idx === jobIndex
        ? { ...j, status: "running" as const, startedAt: Date.now(), imageUrl: null, storagePath: null, designName: null, error: null }
        : j
    ));
    const result = await runOne({ ...job, status: "queued" });
    setJobs(prev => prev.map((j, idx) => idx === jobIndex ? { ...j, ...result } : j));
    if (result.status === "done") toast.success(`"${result.designName || "Design"}" regenerated`);
    else toast.error(`Regeneration failed: ${result.error}`);
  };

  const clearAll = () => { setJobs([]); setCompletedCount(0); setRatings({}); };

  const retryFailed = () => {
    setJobs(prev => prev.map(j => j.status === "failed" ? { ...j, status: "queued", error: null } : j));
    toast.info("Failed jobs re-queued");
  };

  /* ── Download ─────────────────────────────────────────────────── */
  const downloadDesign = async (imageUrl: string, name: string) => {
    try {
      const resp = await fetch(imageUrl);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${(name || "wall-design").replace(/\s+/g, "-").toLowerCase()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  };

  /* ── Publish to gallery ───────────────────────────────────────── */
  const publishToGallery = async (job: WallJob) => {
    if (!job.imageUrl || job.published) return;
    try {
      let publicUrl = job.imageUrl;
      if (job.storagePath) {
        const { data } = supabase.storage.from("wrap-files").getPublicUrl(job.storagePath);
        if (data?.publicUrl) publicUrl = data.publicUrl;
      }

      const categoryLabel = WALL_CATEGORY_LABELS[job.prompt.category as WallCategory] || job.prompt.category;

      const { error } = await db.from("wallpro_designs").insert({
        name: job.designName || job.prompt.name || "Wall Design",
        category: categoryLabel,
        subcategory: job.prompt.subcategory || null,
        prompt: job.prompt.prompt,
        image_url: publicUrl,
        thumbnail_url: publicUrl,
        storage_path: job.storagePath || null,
        tags: job.prompt.tags || [],
        is_active: true,
        rating: ratings[job.id] || null,
        batch_id: batchId,
        surface_type: job.surfaceType,
        mode: job.mode,
      });

      if (error) throw error;

      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, published: true } : j));
      queryClient.invalidateQueries({ queryKey: ["wallpro-designs"] });
      toast.success(`"${job.designName || "Design"}" published`);
    } catch (err: any) {
      toast.error("Publish failed: " + (err.message || "Unknown"));
    }
  };

  const publishAll = async () => {
    const toDo = jobs.filter(j => j.status === "done" && !j.published);
    if (toDo.length === 0) { toast.info("Nothing to publish"); return; }
    let count = 0;
    for (const job of toDo) {
      await publishToGallery(job);
      count++;
    }
    toast.success(`${count} designs published to gallery`);
  };

  /* ── Gallery management ───────────────────────────────────────── */
  const toggleGalleryActive = async (id: string, active: boolean) => {
    const { error } = await db.from("wallpro_designs").update({ is_active: active }).eq("id", id);
    if (error) { toast.error("Update failed"); return; }
    queryClient.invalidateQueries({ queryKey: ["wallpro-designs"] });
    toast.success(active ? "Design activated" : "Design hidden");
  };

  const deleteFromGallery = async (design: GalleryDesign) => {
    if (design.storage_path) {
      await supabase.storage.from("wrap-files").remove([design.storage_path]);
    }
    const { error } = await db.from("wallpro_designs").delete().eq("id", design.id);
    if (error) { toast.error("Delete failed"); return; }
    queryClient.invalidateQueries({ queryKey: ["wallpro-designs"] });
    toast.success(`"${design.name}" removed`);
  };

  const saveDesignName = async (id: string) => {
    if (!editName.trim()) return;
    const { error } = await db.from("wallpro_designs").update({ name: editName.trim() }).eq("id", id);
    if (error) { toast.error("Update failed"); return; }
    setEditingId(null);
    queryClient.invalidateQueries({ queryKey: ["wallpro-designs"] });
    toast.success("Name updated");
  };

  const updateGalleryRating = async (id: string, rating: number) => {
    const { error } = await db.from("wallpro_designs").update({ rating }).eq("id", id);
    if (error) { toast.error("Rating update failed"); return; }
    queryClient.invalidateQueries({ queryKey: ["wallpro-designs"] });
  };

  /* ── Computed ─────────────────────────────────────────────────── */
  const doneCount = jobs.filter(j => j.status === "done").length;
  const failedCount = jobs.filter(j => j.status === "failed").length;
  const publishedCount = jobs.filter(j => j.published).length;
  const unpublishedDone = doneCount - publishedCount;
  const progress = jobs.length > 0 ? (completedCount / jobs.length) * 100 : 0;

  const filteredGallery = galleryFilter === "all"
    ? galleryDesigns
    : galleryDesigns.filter(d => d.category === galleryFilter);
  const galleryCategories = [...new Set(galleryDesigns.map(d => d.category))].sort();
  const activeGalleryCount = galleryDesigns.filter(d => d.is_active).length;

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-background p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Layers className="h-6 w-6 text-emerald-400" />
            WallPro Batch Generate
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Generate, curate, and publish wall wrap designs for the WallPro library.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><ImageIcon className="h-3.5 w-3.5" /> {galleryDesigns.length} total</span>
          <span className="flex items-center gap-1 text-green-400"><Eye className="h-3.5 w-3.5" /> {activeGalleryCount} active</span>
          <span className="flex items-center gap-1 text-zinc-500"><History className="h-3.5 w-3.5" /> {batchHistory.length} batches</span>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="generator" className="space-y-4">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="generator" className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" /> Generator
          </TabsTrigger>
          <TabsTrigger value="gallery" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" /> Gallery ({galleryDesigns.length})
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> History ({batchHistory.length})
          </TabsTrigger>
        </TabsList>

        {/* ============================================================ */}
        {/* TAB 1: GENERATOR                                             */}
        {/* ============================================================ */}
        <TabsContent value="generator" className="space-y-4">
          {/* Controls */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Batch Settings</CardTitle>
              <CardDescription>Configure and launch wall design generation</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                {/* Category */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={category} onValueChange={(v: any) => setCategory(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {WALL_CATEGORIES.map(cat => (
                        <SelectItem key={cat} value={cat}>{WALL_CATEGORY_LABELS[cat]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Mode */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Mode</Label>
                  <Select value={mode} onValueChange={(v: WallMode) => setMode(v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="generate">Flat Art (print-ready)</SelectItem>
                      <SelectItem value="studio">Studio Room Render</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Surface Type (studio mode only) */}
                {mode === "studio" && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Room Type</Label>
                    <Select value={surfaceType} onValueChange={setSurfaceType}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SURFACE_TYPES.map(st => (
                          <SelectItem key={st.value} value={st.value}>{st.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Batch Size */}
                <div className="space-y-1.5">
                  <Label className="text-xs">Batch Size</Label>
                  <Select value={String(batchSize)} onValueChange={(v) => setBatchSize(Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {[5, 10, 15, 20, 25].map(n => (
                        <SelectItem key={n} value={String(n)}>{n} designs</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Actions */}
                <div className="flex items-end gap-2">
                  <Button onClick={buildBatch} disabled={isRunning} variant="outline" className="gap-2">
                    <Zap className="h-4 w-4" /> Build Queue
                  </Button>
                  {jobs.length > 0 && !isRunning && (
                    <Button onClick={runBatch} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
                      <Play className="h-4 w-4" /> Run
                    </Button>
                  )}
                  {isRunning && (
                    <Button onClick={stopBatch} variant="destructive" className="gap-2">
                      <Square className="h-4 w-4" /> Stop
                    </Button>
                  )}
                </div>
              </div>

              {/* Progress */}
              {jobs.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{completedCount}/{jobs.length} processed</span>
                    <span className="flex gap-3">
                      <span className="text-green-400">{doneCount} done</span>
                      {failedCount > 0 && <span className="text-red-400">{failedCount} failed</span>}
                      {publishedCount > 0 && <span className="text-cyan-400">{publishedCount} published</span>}
                    </span>
                  </div>
                  <Progress value={progress} className="h-2" />
                </div>
              )}

              {/* Secondary actions */}
              {jobs.length > 0 && !isRunning && (
                <div className="flex gap-2 flex-wrap">
                  {unpublishedDone > 0 && (
                    <Button onClick={publishAll} size="sm" className="gap-1 text-xs bg-gradient-to-r from-cyan-600 to-blue-600 text-white">
                      <Upload className="h-3 w-3" /> Publish All ({unpublishedDone})
                    </Button>
                  )}
                  {failedCount > 0 && (
                    <Button onClick={retryFailed} variant="outline" size="sm" className="gap-1 text-xs">
                      <RefreshCw className="h-3 w-3" /> Retry Failed ({failedCount})
                    </Button>
                  )}
                  <Button onClick={clearAll} variant="ghost" size="sm" className="gap-1 text-xs text-muted-foreground">
                    <Trash2 className="h-3 w-3" /> Clear All
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Grid */}
          {jobs.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {jobs.map((job, idx) => (
                <Card key={job.id} className={cn(
                  "overflow-hidden transition-all",
                  job.status === "running" && "ring-2 ring-emerald-500 animate-pulse",
                  job.status === "failed" && "border-red-500/50",
                  job.published && "ring-1 ring-cyan-500/50",
                )}>
                  {/* Image area */}
                  <div className="aspect-video bg-secondary/30 relative flex items-center justify-center overflow-hidden">
                    {job.status === "queued" && (
                      <div className="text-center">
                        <Clock className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
                        <span className="text-xs text-muted-foreground">#{idx + 1} Queued</span>
                      </div>
                    )}
                    {job.status === "running" && (
                      <div className="text-center">
                        <Loader2 className="h-8 w-8 text-emerald-400 animate-spin mx-auto mb-1" />
                        <span className="text-xs text-emerald-400">Generating...</span>
                      </div>
                    )}
                    {job.status === "done" && job.imageUrl && (
                      <img src={job.imageUrl} alt={job.designName || "Wall Design"} className="w-full h-full object-cover" loading="lazy" />
                    )}
                    {job.status === "failed" && (
                      <div className="text-center px-3">
                        <XCircle className="h-6 w-6 text-red-400 mx-auto mb-1" />
                        <span className="text-xs text-red-400 line-clamp-2">{job.error}</span>
                      </div>
                    )}

                    {/* Top-right badge */}
                    <div className="absolute top-2 right-2 flex gap-1">
                      {job.published && (
                        <Badge className="bg-cyan-600 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-0.5" /> Published
                        </Badge>
                      )}
                      {job.status === "done" && !job.published && (
                        <Badge className="bg-green-600 text-[10px]">
                          <CheckCircle2 className="h-3 w-3 mr-0.5" />
                          {((job.durationMs || 0) / 1000).toFixed(0)}s
                        </Badge>
                      )}
                    </div>

                    {/* Top-left badge */}
                    <div className="absolute top-2 left-2">
                      <Badge variant="outline" className="text-[9px] bg-black/50 backdrop-blur-sm">
                        {job.mode === "generate" ? "Flat Art" : "Studio"}
                      </Badge>
                    </div>
                  </div>

                  {/* Info */}
                  <div className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">
                          {job.designName || job.prompt.name || "Wall Design"}
                        </p>
                        <p className="text-[10px] text-muted-foreground truncate">
                          {job.prompt.subcategory}
                        </p>
                      </div>
                      <Badge variant="outline" className="text-[9px] shrink-0">
                        {WALL_CATEGORY_LABELS[job.prompt.category as WallCategory] || job.prompt.category}
                      </Badge>
                    </div>

                    <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
                      {job.prompt.prompt.substring(0, 120)}...
                    </p>

                    {/* Rating + Actions */}
                    {job.status === "done" && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <StarRating
                            value={ratings[job.id] || null}
                            onChange={(v) => setRatings(prev => ({ ...prev, [job.id]: v }))}
                          />
                        </div>
                        <div className="flex gap-1 flex-wrap">
                          {!job.published && (
                            <Button
                              variant="ghost" size="sm"
                              className="h-7 px-2 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                              onClick={() => publishToGallery(job)}
                            >
                              <Upload className="h-3 w-3 mr-1" /> Publish
                            </Button>
                          )}
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-blue-400 hover:text-blue-300 hover:bg-blue-500/10"
                            onClick={() => downloadDesign(job.imageUrl!, job.designName || "wall-design")}
                          >
                            <Download className="h-3 w-3 mr-1" /> Save
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10"
                            onClick={() => regenerateDesign(idx)}
                            disabled={isRunning}
                          >
                            <RefreshCw className="h-3 w-3 mr-1" /> Regen
                          </Button>
                          <Button
                            variant="ghost" size="sm"
                            className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10"
                            onClick={() => deleteDesign(job)}
                          >
                            <Trash2 className="h-3 w-3 mr-1" /> Delete
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}

          {/* Empty state */}
          {jobs.length === 0 && (
            <Card className="p-12 text-center">
              <ImageIcon className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No wall designs queued</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Select a category, mode, and batch size, then click "Build Queue" to generate wall designs.
              </p>
              <Button onClick={buildBatch} className="gap-2">
                <Zap className="h-4 w-4" /> Build Queue ({batchSize} designs)
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 2: GALLERY MANAGER                                       */}
        {/* ============================================================ */}
        <TabsContent value="gallery" className="space-y-4">
          {/* Stats + Filter */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4 text-sm">
                  <span className="text-muted-foreground">{galleryDesigns.length} designs</span>
                  <span className="text-green-400">{activeGalleryCount} active</span>
                  <span className="text-zinc-500">{galleryDesigns.length - activeGalleryCount} hidden</span>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">Filter:</Label>
                  <Select value={galleryFilter} onValueChange={setGalleryFilter}>
                    <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories ({galleryDesigns.length})</SelectItem>
                      {galleryCategories.map(cat => (
                        <SelectItem key={cat} value={cat}>
                          {cat} ({galleryDesigns.filter(d => d.category === cat).length})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Gallery Grid */}
          {galleryLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredGallery.length === 0 ? (
            <Card className="p-12 text-center">
              <LayoutGrid className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No designs in gallery</h3>
              <p className="text-sm text-muted-foreground">Generate and publish designs from the Generator tab.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredGallery.map((design) => (
                <Card key={design.id} className={cn(
                  "overflow-hidden transition-all",
                  !design.is_active && "opacity-50",
                )}>
                  {/* Image */}
                  <div className="aspect-video bg-secondary/30 relative overflow-hidden">
                    {design.image_url ? (
                      <img src={design.image_url} alt={design.name} className="w-full h-full object-cover" loading="lazy" />
                    ) : design.thumb_gradient ? (
                      <div className="w-full h-full" style={{ background: design.thumb_gradient }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="h-8 w-8 text-muted-foreground/30" />
                      </div>
                    )}

                    {/* Active badge */}
                    <div className="absolute top-2 right-2">
                      {design.is_active ? (
                        <Badge className="bg-green-600 text-[10px]"><Eye className="h-3 w-3 mr-0.5" /> Active</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-black/50"><EyeOff className="h-3 w-3 mr-0.5" /> Hidden</Badge>
                      )}
                    </div>

                    {/* Rating */}
                    {design.rating && (
                      <div className="absolute top-2 left-2">
                        <Badge variant="outline" className="text-[9px] bg-black/50 backdrop-blur-sm text-yellow-400">
                          <Star className="h-3 w-3 mr-0.5 fill-yellow-400" /> {design.rating}
                        </Badge>
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      {editingId === design.id ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            value={editName}
                            onChange={(e) => setEditName(e.target.value)}
                            className="h-7 text-xs"
                            onKeyDown={(e) => e.key === "Enter" && saveDesignName(design.id)}
                          />
                          <Button variant="ghost" size="sm" className="h-7 px-1.5" onClick={() => saveDesignName(design.id)}>
                            <Save className="h-3 w-3" />
                          </Button>
                        </div>
                      ) : (
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold truncate">{design.name}</p>
                          <p className="text-[10px] text-muted-foreground truncate">{design.subcategory}</p>
                        </div>
                      )}
                      <Badge variant="outline" className="text-[9px] shrink-0">{design.category}</Badge>
                    </div>

                    {/* Rating */}
                    <StarRating
                      value={design.rating}
                      onChange={(v) => updateGalleryRating(design.id, v)}
                    />

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1">
                        <Switch
                          checked={design.is_active}
                          onCheckedChange={(v) => toggleGalleryActive(design.id, v)}
                          className="scale-75"
                        />
                        <span className="text-[10px] text-muted-foreground">{design.is_active ? "Active" : "Hidden"}</span>
                      </div>
                      <div className="flex gap-0.5">
                        {design.image_url && (
                          <Button variant="ghost" size="sm" className="h-7 px-1.5 text-blue-400 hover:text-blue-300"
                            onClick={() => downloadDesign(design.image_url!, design.name)}>
                            <Download className="h-3 w-3" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" className="h-7 px-1.5 text-zinc-400 hover:text-zinc-300"
                          onClick={() => { setEditingId(design.id); setEditName(design.name); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 px-1.5 text-red-400 hover:text-red-300"
                          onClick={() => deleteFromGallery(design)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ============================================================ */}
        {/* TAB 3: BATCH HISTORY                                         */}
        {/* ============================================================ */}
        <TabsContent value="history" className="space-y-4">
          {batchHistory.length === 0 ? (
            <Card className="p-12 text-center">
              <History className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No batch history</h3>
              <p className="text-sm text-muted-foreground">Published designs will appear here grouped by batch.</p>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {batchHistory.map((batch) => (
                <Card key={batch.batch_id} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-mono">
                        {batch.batch_id.replace("wallbatch_", "").slice(0, 10)}
                      </CardTitle>
                      <Badge variant="outline" className="text-[10px]">
                        {batch.count} designs
                      </Badge>
                    </div>
                    <CardDescription className="text-[11px]">
                      {new Date(batch.created_at).toLocaleDateString("en-US", {
                        month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
                      })}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {/* Categories */}
                    <div className="flex flex-wrap gap-1">
                      {batch.categories.map(cat => (
                        <Badge key={cat} variant="outline" className="text-[9px]">{cat}</Badge>
                      ))}
                    </div>

                    {/* Stats */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3 text-green-400" /> {batch.activeCount} active
                      </span>
                      {batch.avgRating && (
                        <span className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" /> {batch.avgRating} avg
                        </span>
                      )}
                    </div>

                    {/* Filter gallery by this batch */}
                    <Button
                      variant="outline" size="sm"
                      className="w-full text-xs gap-1"
                      onClick={() => {
                        setGalleryFilter("all");
                        // Switch to gallery tab filtered to this batch
                        // We use category filter as proxy; for exact batch filtering,
                        // the gallery tab shows all designs from this batch
                      }}
                    >
                      <LayoutGrid className="h-3 w-3" /> View in Gallery
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
