import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { CM_TRADES } from "@/lib/cm-trade-options";
import { buildQueueFromPrompts } from "@/lib/bulk-prompt-generator";
import type { PromptPreset } from "@/data/prompt-presets";
import { Store, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Zap, Play, Square, Loader2, XCircle, Star, Clock, RefreshCw,
  Camera, Upload, X, Layers, Download, Package, Heart, ChevronDown,
  AlertTriangle, CheckCircle2, ShieldCheck, Settings2,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buildQueue, VIEW_ORDER, VIEW_LABELS, type RenderJob } from "@/lib/bulk-prompt-generator";
import { formatVehicleName } from "@/lib/vehicle-selection";
import { useBulkRenderQueue } from "@/hooks/useBulkRenderQueue";
import { VisionBoardUploader } from "@/components/designpanelpro/VisionBoardUploader";
import { BatchRenderProgress } from "@/components/admin/BatchRenderProgress";
import type { VisionBoardImage, VisionBoardIntent } from "@/lib/designiq-engine";

/* ================================================================ */
/* Star Rating                                                      */
/* ================================================================ */
function StarRating({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          onClick={() => onChange(s)}
          className="p-0 bg-transparent border-none cursor-pointer"
        >
          <Star
            className={cn(
              "h-5 w-5 transition-colors",
              s <= (value || 0)
                ? "text-yellow-400 fill-yellow-400"
                : "text-zinc-600 hover:text-yellow-300",
            )}
          />
        </button>
      ))}
    </div>
  );
}

/* ================================================================ */
/* Heal Status Badge                                                 */
/* ================================================================ */
function HealBadge({ job }: { job: RenderJob }) {
  if (job.healStatus === "none") return null;
  return (
    <Badge
      className={cn(
        "text-[9px] gap-1",
        job.healStatus === "healed" && "bg-green-600",
        job.healStatus === "retrying" && "bg-amber-600 animate-pulse",
        job.healStatus === "gave_up" && "bg-red-700",
      )}
    >
      {job.healStatus === "healed" && <><Heart className="h-2.5 w-2.5" /> Healed</>}
      {job.healStatus === "retrying" && <><RefreshCw className="h-2.5 w-2.5 animate-spin" /> Healing...</>}
      {job.healStatus === "gave_up" && <><AlertTriangle className="h-2.5 w-2.5" /> Gave Up</>}
      {job.healAttempts > 0 && <span>({job.healAttempts}x)</span>}
    </Badge>
  );
}

/* ================================================================ */
/* Design Row - full-width RevisionStudioIQ-style layout            */
/* ================================================================ */
function DesignRow({
  job,
  onRate,
  onRevise,
  onMyVehicle,
  onGenerateViews,
  onGeneratePack,
  onPublishCm,
  publishingId,
  publishedListingId,
  running,
}: {
  job: RenderJob;
  onRate: (id: string, rating: number) => void;
  onRevise: (job: RenderJob) => void;
  onMyVehicle: (job: RenderJob) => void;
  onGenerateViews: (id: string) => void;
  onGeneratePack: (id: string) => void;
  onPublishCm: (jobId: string) => void;
  publishingId: string | null;
  publishedListingId: string | undefined;
  running: boolean;
}) {
  const hasViews = Object.keys(job.views).length > 0;
  const isDone = job.status === "done" || job.status === "failed";

  return (
    <Card
      className={cn(
        "bg-zinc-900 border-zinc-800 overflow-hidden",
        job.status === "failed" && "border-red-500/30",
        job.status === "done" && "border-zinc-700",
        job.status === "running" && "border-blue-500/40",
        job.healStatus === "healed" && "border-green-500/40",
      )}
    >
      {/* ---- Main row ---- */}
      <div className="flex gap-4 p-4">
        {/* Left: Panel / AI render */}
        <div className="w-48 flex-shrink-0">
          {job.renderUrl ? (
            <div className="relative rounded-lg overflow-hidden border border-zinc-700">
              <img src={job.renderUrl} alt="" className="w-full aspect-square object-cover" />
              <Badge
                className={cn(
                  "absolute top-2 left-2 text-[10px]",
                  job.version > 1 ? "bg-purple-600" : "bg-zinc-700",
                )}
              >
                V{job.version}
              </Badge>
              <HealBadge job={job} />
            </div>
          ) : (
            <div className="w-full aspect-square bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-700">
              {job.status === "running" && <Loader2 className="h-8 w-8 text-blue-400 animate-spin" />}
              {job.status === "queued" && <Clock className="h-8 w-8 text-zinc-600" />}
              {job.status === "failed" && <XCircle className="h-8 w-8 text-red-400" />}
            </div>
          )}
          <p className="text-[10px] text-zinc-500 text-center mt-1">2D AI Panel</p>
        </div>

        {/* Middle: Info + views preview */}
        <div className="flex-1 min-w-0 space-y-2">
          {/* Vehicle + meta row */}
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Badge className="bg-zinc-800 text-zinc-300 border border-zinc-600 text-[9px] font-mono flex-shrink-0">{job.orderNumber}</Badge>
                <h3 className="text-sm font-bold text-white">
                  {formatVehicleName(job.vehicle)}
                </h3>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5 line-clamp-2 max-w-xl leading-relaxed">
                {job.prompt.prompt}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-4">
              <Badge variant="outline" className="border-zinc-600 text-[10px]">{job.finish}</Badge>
              <Badge variant="outline" className="border-zinc-600 text-[10px]">{job.prompt.category}</Badge>
              {job.durationMs != null && (
                <span className="text-[10px] text-zinc-500">{(job.durationMs / 1000).toFixed(1)}s</span>
              )}
              <HealBadge job={job} />
            </div>
          </div>

          {job.error && (
            <p className="text-[11px] text-red-400">{job.error}</p>
          )}

          {/* Views 3x2 grid (if generated) */}
          {hasViews && (
            <div className="grid grid-cols-3 gap-2 mt-2">
              {VIEW_ORDER.map((key) => (
                <div key={key} className="relative rounded-lg overflow-hidden border border-zinc-700 bg-zinc-800">
                  {job.views[key] ? (
                    <img src={job.views[key]} alt={VIEW_LABELS[key]} className="w-full aspect-video object-cover" />
                  ) : (
                    <div className="w-full aspect-video flex items-center justify-center">
                      {job.viewsStatus === "running" ? (
                        <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
                      ) : (
                        <span className="text-[9px] text-zinc-600">&mdash;</span>
                      )}
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/80 text-[9px] text-center py-0.5 text-zinc-400">
                    {VIEW_LABELS[key]}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Views progress bar */}
          {job.viewsStatus === "running" && (
            <div className="mt-2">
              <Progress value={(job.viewsProgress / 6) * 100} className="h-1.5" />
              <p className="text-[10px] text-zinc-500 mt-0.5">
                Generating view {Math.min(job.viewsProgress + 1, 6)} of 6...
              </p>
            </div>
          )}

          {/* Production Pack Status */}
          {job.packStatus !== "none" && (
            <div className="mt-2 flex items-center gap-2">
              {job.packStatus === "running" && (
                <Badge className="bg-purple-600 animate-pulse text-[10px] gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Generating Production Pack...
                </Badge>
              )}
              {job.packStatus === "done" && job.packUrl && (
                <a
                  href={job.packUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[11px] font-bold text-green-400 hover:text-green-300 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" /> Download Production Pack (ZIP)
                </a>
              )}
              {job.packStatus === "failed" && (
                <span className="text-[11px] text-red-400">{job.packError}</span>
              )}
            </div>
          )}

          {/* Heal Log (collapsible) */}
          {job.healLog.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors mt-1">
                <ChevronDown className="h-3 w-3" />
                Self-Heal Log ({job.healLog.length} entries)
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 bg-zinc-950 rounded p-2 max-h-32 overflow-y-auto space-y-0.5">
                  {job.healLog.map((log, i) => (
                    <p key={i} className="text-[9px] text-zinc-500 font-mono">{log}</p>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}
        </div>

        {/* Right: Rating + Actions */}
        <div className="w-48 flex-shrink-0 flex flex-col items-end gap-2">
          {isDone && (
            <>
              <StarRating value={job.rating} onChange={(r) => onRate(job.id, r)} />

              <Button
                size="sm"
                variant="outline"
                className="w-full h-8 text-[11px] border-zinc-700"
                onClick={() => onRevise(job)}
                disabled={running}
              >
                <RefreshCw className="h-3 w-3 mr-1" /> Revise
              </Button>

              {job.renderUrl && !hasViews && job.viewsStatus !== "running" && (
                <Button
                  size="sm"
                  className="w-full h-8 text-[11px] bg-blue-700 hover:bg-blue-600"
                  onClick={() => onGenerateViews(job.id)}
                  disabled={running}
                >
                  <Layers className="h-3 w-3 mr-1" /> Generate 6 Views
                </Button>
              )}

              {/* Production Pack button - needs panel + ideally views */}
              {job.renderUrl && job.packStatus !== "running" && job.packStatus !== "done" && (
                <Button
                  size="sm"
                  className="w-full h-8 text-[11px] bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90"
                  onClick={() => onGeneratePack(job.id)}
                  disabled={running}
                >
                  <Package className="h-3 w-3 mr-1" /> Production Pack
                </Button>
              )}

              {job.packStatus === "done" && job.packUrl && (
                <a
                  href={job.packUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full"
                >
                  <Button
                    size="sm"
                    className="w-full h-8 text-[11px] bg-green-700 hover:bg-green-600"
                  >
                    <Download className="h-3 w-3 mr-1" /> Download ZIP
                  </Button>
                </a>
              )}

              {/* Publish to CreatorMarket — enabled once a hero render
                  exists. Hides after the row is already listed so we
                  can't double-insert. */}
              {job.renderUrl && !publishedListingId && (
                <Button
                  size="sm"
                  className="w-full h-8 text-[11px] bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:opacity-90"
                  onClick={() => onPublishCm(job.id)}
                  disabled={running || publishingId === job.id}
                >
                  {publishingId === job.id ? (
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  ) : (
                    <Store className="h-3 w-3 mr-1" />
                  )}
                  Publish to CreatorMarket
                </Button>
              )}
              {publishedListingId && (
                <Badge className="bg-emerald-600 text-white text-[10px] h-7 px-2 gap-1 w-full justify-center">
                  <CheckCircle2 className="h-3 w-3" />
                  Listed on CreatorMarket
                </Badge>
              )}

              {job.renderUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full h-8 text-[11px] border-zinc-700"
                  onClick={() => onMyVehicle(job)}
                  disabled={running}
                >
                  <Camera className="h-3 w-3 mr-1" /> MyVehicle Test
                </Button>
              )}
            </>
          )}

          {job.status === "running" && (
            <Badge className="bg-blue-600 animate-pulse">Rendering...</Badge>
          )}
          {job.status === "queued" && (
            <Badge variant="outline" className="border-zinc-700 text-zinc-500">Queued</Badge>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ================================================================ */
/* Main Page                                                        */
/* ================================================================ */
export default function AdminBulkDesignPro() {
  const [category, setCategory] = useState<"restyle" | "commercial">("restyle");
  const [batchCount, setBatchCount] = useState(25);

  /**
   * Prompt source:
   *  - "library"  → pull random presets from src/data/prompt-presets.ts
   *                 (existing behavior, untouched for restyle batches).
   *  - "ai_trade" → call generate-batch-prompts to AI-generate brand-new
   *                 prompts scoped to a CreatorMarket trade. Each batch
   *                 is original even when re-run on the same trade.
   */
  const [promptSource, setPromptSource] = useState<"library" | "ai_trade">("library");
  const [tradeSlug, setTradeSlug] = useState<string>("hvac");
  const [aiPromptLoading, setAiPromptLoading] = useState(false);

  // Track which jobs have already been published so the button flips to
  // "Published ↗" and doesn't double-insert if the admin taps twice.
  const [publishedListings, setPublishedListings] = useState<Record<string, string>>({});
  const [publishingId, setPublishingId] = useState<string | null>(null);
  // Configurable creator label that appears on every published card
  // ("Created by …"). Kept editable so Trish can swap to a per-batch
  // brand without re-deploying.
  const [creatorLabel, setCreatorLabel] = useState("DesignProAI Team");

  // VisionBoardIQ state (shared across batch)
  const [vbImages, setVbImages] = useState<VisionBoardImage[]>([]);
  const [vbIntent, setVbIntent] = useState<VisionBoardIntent>("style_inspiration");

  // Revision drawer state
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseTarget, setReviseTarget] = useState<RenderJob | null>(null);
  const [revisePrompt, setRevisePrompt] = useState("");

  // MyVehiclePro test drawer state
  const [mvpOpen, setMvpOpen] = useState(false);
  const [mvpTarget, setMvpTarget] = useState<RenderJob | null>(null);
  const [mvpPhotoPreview, setMvpPhotoPreview] = useState<string | null>(null);
  const [mvpPhotoBase64, setMvpPhotoBase64] = useState<string | null>(null);
  const [mvpPhotoMime, setMvpPhotoMime] = useState("image/jpeg");
  const [mvpResult, setMvpResult] = useState<string | null>(null);
  const [mvpRunning, setMvpRunning] = useState(false);
  const mvpFileRef = useRef<HTMLInputElement>(null);

  const {
    jobs, running, currentIdx, healingActive,
    startBatch, stop, rateJob, reviseJob, generateViews,
    generateProductionPack, publishToCreatorMarket, testOnVehiclePhoto,
    runHealingSweep, detectLowRatingPatterns,
    done, failed, healed, packsReady, avgTime,
  } = useBulkRenderQueue();

  /* ---- Batch launch ---- */
  const handleBuild = async () => {
    // Static library path — unchanged behavior.
    if (promptSource === "library") {
      const queue = buildQueue(batchCount, category);
      startBatch(queue, vbImages.length > 0 ? vbImages : undefined, vbIntent);
      toast.success(`Batch started - ${batchCount} renders queued (self-healing enabled)`);
      return;
    }

    // AI-generated trade path. generate-batch-prompts caps at 20 per
    // call, so we chunk the request for larger batch sizes and stitch
    // the results back together before kicking off the render queue.
    setAiPromptLoading(true);
    try {
      const CHUNK = 20;
      const allPrompts: PromptPreset[] = [];
      let remaining = batchCount;
      while (remaining > 0) {
        const ask = Math.min(CHUNK, remaining);
        const { data, error } = await supabase.functions.invoke("generate-batch-prompts", {
          body: { category: "commercial", count: ask, trade: tradeSlug },
        });
        if (error || !data?.prompts?.length) {
          throw new Error(error?.message || "No prompts returned");
        }
        allPrompts.push(...(data.prompts as PromptPreset[]));
        remaining -= ask;
      }
      const queue = buildQueueFromPrompts(allPrompts);
      startBatch(queue, vbImages.length > 0 ? vbImages : undefined, vbIntent);
      toast.success(
        `Generated ${allPrompts.length} original ${
          CM_TRADES.find((t) => t.slug === tradeSlug)?.label || tradeSlug
        } prompts — batch started`,
      );
    } catch (err) {
      toast.error(`AI prompt generation failed — ${(err as Error).message}`);
    } finally {
      setAiPromptLoading(false);
    }
  };

  /* ---- Publish to CreatorMarket ---- */
  const handlePublishOne = async (jobId: string) => {
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    setPublishingId(jobId);
    try {
      const trade = (job.prompt as PromptPreset).trade_category ?? (
        promptSource === "ai_trade" ? tradeSlug : null
      );
      const res = await publishToCreatorMarket(jobId, {
        trade_category: trade,
        featured_creator_name: creatorLabel,
        industry_title: job.prompt.name,
        status: "listed",
      });
      if ("error" in res) {
        toast.error(`Publish failed — ${res.error}`);
        return;
      }
      setPublishedListings((p) => ({ ...p, [jobId]: res.id }));
      toast.success("Listed on CreatorMarket");
    } finally {
      setPublishingId(null);
    }
  };

  const handlePublishAllRated = async () => {
    const eligible = jobs.filter(
      (j) =>
        j.status === "done" &&
        !!j.renderUrl &&
        (j.rating || 0) >= 4 &&
        !publishedListings[j.id],
    );
    if (eligible.length === 0) {
      toast.info("No 4+ rated jobs ready to publish.");
      return;
    }
    toast.info(`Publishing ${eligible.length} card${eligible.length === 1 ? "" : "s"}…`);
    let ok = 0;
    let fail = 0;
    for (const j of eligible) {
      const trade = (j.prompt as PromptPreset).trade_category ?? (
        promptSource === "ai_trade" ? tradeSlug : null
      );
      const res = await publishToCreatorMarket(j.id, {
        trade_category: trade,
        featured_creator_name: creatorLabel,
        industry_title: j.prompt.name,
        status: "listed",
      });
      if ("error" in res) {
        fail++;
      } else {
        ok++;
        setPublishedListings((p) => ({ ...p, [j.id]: res.id }));
      }
    }
    if (fail === 0) toast.success(`Published ${ok} card${ok === 1 ? "" : "s"} to CreatorMarket`);
    else toast.warning(`Published ${ok}, ${fail} failed`);
  };

  /* ---- Revision ---- */
  const openRevise = (job: RenderJob) => {
    setReviseTarget(job);
    setRevisePrompt(job.prompt.prompt);
    setReviseOpen(true);
  };
  const submitRevise = () => {
    if (!reviseTarget || !revisePrompt.trim()) return;
    setReviseOpen(false);
    reviseJob(
      reviseTarget.id,
      revisePrompt.trim(),
      vbImages.length > 0 ? vbImages : undefined,
      vbIntent,
    );
    toast.info("Revision re-render started");
  };

  /* ---- MyVehiclePro test ---- */
  const openMvp = (job: RenderJob) => {
    setMvpTarget(job);
    setMvpPhotoPreview(null);
    setMvpPhotoBase64(null);
    setMvpResult(null);
    setMvpOpen(true);
  };
  const handleMvpPhoto = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setMvpPhotoPreview(dataUrl);
      setMvpPhotoBase64(dataUrl.split(",")[1]);
      setMvpPhotoMime(file.type || "image/jpeg");
    };
    reader.readAsDataURL(file);
  };
  const runMvp = async () => {
    if (!mvpTarget?.renderUrl || !mvpPhotoBase64) return;
    setMvpRunning(true);
    setMvpResult(null);
    const res = await testOnVehiclePhoto(mvpPhotoBase64, mvpPhotoMime, mvpTarget.renderUrl, mvpTarget.finish);
    setMvpRunning(false);
    if (res.renderUrl) {
      setMvpResult(res.renderUrl);
      toast.success("MyVehiclePro test complete");
    } else {
      toast.error(res.error || "Test failed");
    }
  };

  /* ---- Self-healing sweep ---- */
  const handleHealSweep = () => {
    runHealingSweep(
      vbImages.length > 0 ? vbImages : undefined,
      vbIntent,
    );
    toast.info("Self-healing sweep started - retrying all failed renders...");
  };

  /* ---- Low-rating pattern detection ---- */
  const handleDetectPatterns = async () => {
    await detectLowRatingPatterns();
    toast.success("Low-rating patterns analyzed and logged to dev_agent_events");
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-[1800px] mx-auto px-6 py-8 pt-24">
        {/* ---- Page header ---- */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500 to-purple-500">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Bulk DesignProAI Generator</h1>
              <p className="text-zinc-400 text-sm">
                Up to 200 AI renders &middot; Self-Healing &middot; Production Packs &middot; 6 Views &middot; Star Rate &middot; Revise
              </p>
            </div>
          </div>

          {jobs.length > 0 && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-green-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="h-4 w-4" /> {done} done
              </span>
              {healed > 0 && (
                <span className="text-emerald-400 font-bold flex items-center gap-1">
                  <Heart className="h-4 w-4" /> {healed} healed
                </span>
              )}
              <span className="text-red-400 font-bold">{failed} failed</span>
              {packsReady > 0 && (
                <span className="text-purple-400 font-bold flex items-center gap-1">
                  <Package className="h-4 w-4" /> {packsReady} packs
                </span>
              )}
              <span className="text-zinc-400">{avgTime}s avg</span>
            </div>
          )}
        </div>

        {/* ---- Controls ---- */}
        <Card className="bg-zinc-900 border-zinc-800 mb-6">
          <CardContent className="p-4 flex flex-wrap items-end gap-4">
            <div className="w-44">
              <Label className="mb-1 block text-sm text-zinc-400">Source</Label>
              <Select
                value={promptSource}
                onValueChange={(v: any) => {
                  setPromptSource(v);
                  if (v === "ai_trade") setCategory("commercial");
                }}
                disabled={running || aiPromptLoading}
              >
                <SelectTrigger className="bg-zinc-800 border-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="library">Static Library</SelectItem>
                  <SelectItem value="ai_trade">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-fuchsia-400" />
                      AI Trade (CreatorMarket)
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {promptSource === "ai_trade" ? (
              <div className="w-48">
                <Label className="mb-1 block text-sm text-zinc-400">Trade</Label>
                <Select
                  value={tradeSlug}
                  onValueChange={setTradeSlug}
                  disabled={running || aiPromptLoading}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {CM_TRADES.map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="w-48">
                <Label className="mb-1 block text-sm text-zinc-400">Category</Label>
                <Select
                  value={category}
                  onValueChange={(v: any) => setCategory(v)}
                  disabled={running}
                >
                  <SelectTrigger className="bg-zinc-800 border-zinc-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="restyle">ReStyle (Artistic)</SelectItem>
                    <SelectItem value="commercial">Commercial (Business)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {promptSource === "ai_trade" && (
              <div className="w-56">
                <Label className="mb-1 block text-sm text-zinc-400">Creator label</Label>
                <input
                  type="text"
                  value={creatorLabel}
                  onChange={(e) => setCreatorLabel(e.target.value)}
                  disabled={running || aiPromptLoading}
                  className="w-full h-10 px-3 rounded-md bg-zinc-800 border border-zinc-700 text-sm text-white"
                  placeholder="DesignProAI Team"
                />
              </div>
            )}

            {/* Batch-size + buttons follow ---- */}

            <div className="w-56">
              <Label className="mb-1 block text-sm text-zinc-400">
                <Settings2 className="h-3.5 w-3.5 inline mr-1" />
                Batch Size: <span className="text-blue-400 font-bold">{batchCount}</span>
              </Label>
              <Slider
                value={[batchCount]}
                onValueChange={([val]) => setBatchCount(val)}
                min={10}
                max={200}
                step={5}
                disabled={running}
                className="mt-1"
              />
              <p className="text-[9px] text-zinc-600 mt-0.5">10–200 renders per batch</p>
            </div>

            {!running ? (
              <Button
                onClick={handleBuild}
                disabled={aiPromptLoading}
                className="bg-blue-600 hover:bg-blue-700 h-10"
              >
                {aiPromptLoading ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating prompts…</>
                ) : (
                  <><Play className="h-4 w-4 mr-2" /> Generate {batchCount} Designs</>
                )}
              </Button>
            ) : (
              <Button variant="destructive" onClick={stop} className="h-10">
                <Square className="h-4 w-4 mr-2" /> Stop Batch
              </Button>
            )}

            {/* Bulk publish to CreatorMarket — only shown when there's
                at least one 4★+ unpublished card. Trade context is
                taken from each job's prompt.trade_category (set when
                source = ai_trade) or the picker. */}
            {jobs.some(
              (j) =>
                j.status === "done" &&
                (j.rating || 0) >= 4 &&
                !publishedListings[j.id],
            ) && !running && (
              <Button
                onClick={handlePublishAllRated}
                className="h-10 bg-gradient-to-r from-fuchsia-600 to-violet-600 hover:opacity-90"
              >
                <Store className="h-4 w-4 mr-2" />
                Publish 4★+ to CreatorMarket
              </Button>
            )}

            {/* Self-Healing Controls */}
            {failed > 0 && !running && !healingActive && (
              <Button
                onClick={handleHealSweep}
                className="bg-gradient-to-r from-amber-600 to-red-600 hover:opacity-90 h-10"
              >
                <ShieldCheck className="h-4 w-4 mr-2" /> Heal {failed} Failed
              </Button>
            )}
            {healingActive && (
              <Badge className="bg-amber-600 animate-pulse h-10 flex items-center px-4 gap-2">
                <RefreshCw className="h-4 w-4 animate-spin" /> Self-Healing in Progress...
              </Badge>
            )}

            {/* Low-rating pattern detection */}
            {jobs.filter((j) => j.rating != null && j.rating <= 2).length >= 3 && !running && (
              <Button
                onClick={handleDetectPatterns}
                variant="outline"
                className="border-amber-500/40 text-amber-400 hover:bg-amber-500/10 h-10"
              >
                <AlertTriangle className="h-4 w-4 mr-2" /> Analyze Low Ratings
              </Button>
            )}
          </CardContent>
        </Card>

        {/* ---- Self-Healing Status Banner ---- */}
        {(healed > 0 || jobs.some((j) => j.healStatus === "gave_up")) && (
          <Card className="bg-zinc-900 border-zinc-800 mb-6">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <ShieldCheck className="h-5 w-5 text-emerald-400" />
                <div>
                  <p className="text-sm font-bold text-white">Self-Healing Report</p>
                  <p className="text-xs text-zinc-400">
                    {healed > 0 && <span className="text-green-400">{healed} renders recovered automatically. </span>}
                    {jobs.filter((j) => j.healStatus === "gave_up").length > 0 && (
                      <span className="text-red-400">
                        {jobs.filter((j) => j.healStatus === "gave_up").length} renders need manual review.
                      </span>
                    )}
                    {" "}All events logged to dev_agent_events for monitoring.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ---- VisionBoardIQ ---- */}
        <Card className="bg-zinc-900 border-zinc-800 mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-zinc-300">VisionBoardIQ&trade; &mdash; Optional Reference Images</CardTitle>
            <CardDescription className="text-xs text-zinc-500">
              Upload inspiration images. Every render in this batch will use them.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VisionBoardUploader
              images={vbImages}
              onChange={setVbImages}
              intent={vbIntent}
              onIntentChange={setVbIntent}
              maxImages={4}
              disabled={running}
            />
          </CardContent>
        </Card>

        {/* ---- Batch Progress Wizard ---- */}
        <BatchRenderProgress
          jobs={jobs}
          running={running}
          currentIdx={currentIdx}
          healingActive={healingActive}
          done={done}
          failed={failed}
          healed={healed}
          avgTime={avgTime}
        />

        {/* ---- Results: Full-width rows ---- */}
        {jobs.length > 0 && (
          <div className="space-y-4">
            {jobs.map((job) => (
              <DesignRow
                key={job.id}
                job={job}
                onRate={rateJob}
                onRevise={openRevise}
                onMyVehicle={openMvp}
                onGenerateViews={generateViews}
                onGeneratePack={generateProductionPack}
                onPublishCm={handlePublishOne}
                publishingId={publishingId}
                publishedListingId={publishedListings[job.id]}
                running={running}
              />
            ))}
          </div>
        )}

        {/* ---- Empty state ---- */}
        {jobs.length === 0 && (
          <div className="text-center py-24 text-zinc-500">
            <Zap className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg">Pick a category, set batch size, and hit Generate</p>
            <p className="text-sm mt-1">Up to 200 prompts + 20 vehicles + 3 finishes = instant library</p>
            <div className="mt-6 flex justify-center gap-3">
              <Badge variant="outline" className="border-blue-500/30 text-blue-400">Self-Healing Enabled</Badge>
              <Badge variant="outline" className="border-purple-500/30 text-purple-400">Production Packs Ready</Badge>
              <Badge variant="outline" className="border-green-500/30 text-green-400">Neural Network Ratings</Badge>
            </div>
          </div>
        )}

        <div className="mt-8 flex justify-end">
          <Button variant="outline" className="border-zinc-700" onClick={() => (window.location.href = "/admin")}>
            Back to Admin
          </Button>
        </div>
      </main>

      {/* ============================================================ */}
      {/* Revision Drawer                                              */}
      {/* ============================================================ */}
      <Sheet open={reviseOpen} onOpenChange={setReviseOpen}>
        <SheetContent className="w-[440px] sm:max-w-[440px] bg-zinc-900 border-zinc-700">
          <SheetHeader>
            <SheetTitle className="text-white">Revise Design</SheetTitle>
          </SheetHeader>
          {reviseTarget && (
            <div className="mt-4 space-y-4">
              {reviseTarget.renderUrl && (
                <img src={reviseTarget.renderUrl} alt="" className="w-full rounded-lg border border-zinc-700" />
              )}
              <div>
                <p className="text-xs font-medium mb-1 text-zinc-300">{formatVehicleName(reviseTarget.vehicle)}</p>
                <Badge variant="outline" className="text-[10px] border-zinc-600">{reviseTarget.finish}</Badge>
              </div>
              <div>
                <Label className="text-sm text-zinc-400">Edit prompt &amp; re-render</Label>
                <Textarea
                  value={revisePrompt}
                  onChange={(e) => setRevisePrompt(e.target.value)}
                  rows={6}
                  className="mt-1 text-sm bg-zinc-800 border-zinc-700"
                />
              </div>
              <Button onClick={submitRevise} className="w-full bg-blue-600 hover:bg-blue-700">
                <RefreshCw className="h-4 w-4 mr-1" /> Re-Render with Revision
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ============================================================ */}
      {/* MyVehiclePro Test Drawer                                     */}
      {/* ============================================================ */}
      <Sheet open={mvpOpen} onOpenChange={setMvpOpen}>
        <SheetContent className="w-[480px] sm:max-w-[480px] bg-zinc-900 border-zinc-700">
          <SheetHeader>
            <SheetTitle className="text-white">MyVehiclePro&trade; Test</SheetTitle>
          </SheetHeader>
          {mvpTarget && (
            <div className="mt-4 space-y-4">
              <div>
                <Label className="text-xs text-zinc-500 mb-1 block">AI Design Panel</Label>
                {mvpTarget.renderUrl && (
                  <img src={mvpTarget.renderUrl} alt="" className="w-full rounded-lg border border-zinc-700" />
                )}
              </div>
              <div>
                <Label className="text-sm mb-1 block text-zinc-300">Upload Your Vehicle Photo</Label>
                <input ref={mvpFileRef} type="file" accept="image/*" onChange={handleMvpPhoto} className="hidden" />
                {mvpPhotoPreview ? (
                  <div className="relative">
                    <img src={mvpPhotoPreview} alt="" className="w-full rounded-lg border border-zinc-700" />
                    <button
                      onClick={() => { setMvpPhotoPreview(null); setMvpPhotoBase64(null); setMvpResult(null); }}
                      className="absolute top-2 right-2 p-1 rounded-full bg-black/60 hover:bg-red-500"
                    >
                      <X className="h-3 w-3 text-white" />
                    </button>
                  </div>
                ) : (
                  <div
                    onClick={() => mvpFileRef.current?.click()}
                    className="w-full h-32 rounded-lg border-2 border-dashed border-zinc-700 cursor-pointer hover:border-blue-500/40 hover:bg-blue-500/5 transition-all flex flex-col items-center justify-center gap-2"
                  >
                    <Upload className="h-6 w-6 text-zinc-500" />
                    <span className="text-xs text-zinc-500">Click to upload vehicle photo</span>
                  </div>
                )}
              </div>
              <Button
                onClick={runMvp}
                disabled={!mvpPhotoBase64 || mvpRunning}
                className="w-full bg-blue-600 hover:bg-blue-700"
              >
                {mvpRunning ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Rendering on photo...</>
                ) : (
                  <><Camera className="h-4 w-4 mr-1" /> Apply Design to Photo</>
                )}
              </Button>
              {mvpResult && (
                <div>
                  <Label className="text-xs text-zinc-500 mb-1 block">MyVehiclePro Result</Label>
                  <img src={mvpResult} alt="" className="w-full rounded-lg border border-green-500/30" />
                </div>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
