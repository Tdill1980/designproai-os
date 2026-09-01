/**
 * Admin Batch Render Control Center
 *
 * Page 1 of 2: Trigger + Monitor batch renders
 *
 * Features:
 * - Configurable batch parameters (vehicles, tools, prompts, quantity, concurrency)
 * - Launch preset pipeline (25 renders × 7 views) or custom batches
 * - Live progress with per-tool stats
 * - Batch history from past runs
 * - Pause / Resume / Cancel controls
 */

import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Zap, Play, Square, Pause, Loader2, XCircle, Clock, CheckCircle2,
  Layers, ChevronDown, ChevronRight, ImageIcon, Camera, Package, Star,
  ExternalLink, Settings2, History, Plus, Trash2, Car, FileText, Palette,
  Shuffle, Eye, X, Store, Wand2,
} from "lucide-react";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getRandomPresets, getSubcategories, getPresetsByCategory, type PromptPreset } from "@/data/prompt-presets";
import {
  useBatchTestPipeline,
  TOOL_LABELS,
  VIEW_ORDER,
  VIEW_LABELS,
  type PipelineJob,
  type ToolType,
  type BatchPipelineConfig,
  type MixedBatchConfig,
} from "@/hooks/useBatchTestPipeline";
import { useAutoRevisionPipeline } from "@/hooks/useAutoRevisionPipeline";
import { useRestyleBatchPipeline } from "@/hooks/useRestyleBatchPipeline";
import {
  useDeployBatchPipeline,
  type DeploySourceDesign,
} from "@/hooks/useDeployBatchPipeline";
import { STOCK_VEHICLE_PHOTOS } from "@/data/stock-vehicle-photos";
import {
  useCatalogBatchPipeline,
  MANUFACTURER_VEHICLES,
  type CatalogJob,
  type CatalogBatchConfig,
} from "@/hooks/useCatalogBatchPipeline";

/* ================================================================ */
/* Tool icon colors                                                  */
/* ================================================================ */
const TOOL_COLORS: Record<ToolType, string> = {
  designpro: "from-blue-500 to-blue-600",
  colorpro: "from-green-500 to-emerald-600",
  fadewraps: "from-orange-500 to-red-600",
  wbty: "from-purple-500 to-pink-600",
  approvemode: "from-yellow-500 to-amber-600",
};

const TOOL_BORDER: Record<string, string> = {
  designpro: "border-blue-500/30",
  colorpro: "border-green-500/30",
  fadewraps: "border-orange-500/30",
  wbty: "border-purple-500/30",
  approvemode: "border-yellow-500/30",
};

const COST_PER_RENDER = 0.08;
const COST_PER_VIEW = 0.08;

/* ================================================================ */
/* Batch History Hook                                                */
/* ================================================================ */
interface BatchHistoryEntry {
  batch_id: string;
  created_at: string;
  total_renders: number;
  tools: string[];
  vehicles: string[];
}

function useBatchHistory() {
  return useQuery({
    queryKey: ["admin-batch-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("color_visualizations")
        .select("admin_notes, created_at, vehicle_year, vehicle_make, vehicle_model, mode_type")
        .like("admin_notes", '%"batch":true%')
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!data) return [];

      const batches: Record<string, BatchHistoryEntry> = {};

      for (const row of data) {
        let parsed: any = {};
        try {
          parsed = JSON.parse(row.admin_notes || "{}");
        } catch {
          continue;
        }
        if (!parsed.batch) continue;

        const batchId = parsed.batch_id || "unknown";
        if (!batches[batchId]) {
          batches[batchId] = {
            batch_id: batchId,
            created_at: row.created_at || "",
            total_renders: 0,
            tools: [],
            vehicles: [],
          };
        }

        batches[batchId].total_renders++;

        const tool = parsed.tool || row.mode_type || "unknown";
        if (!batches[batchId].tools.includes(tool)) {
          batches[batchId].tools.push(tool);
        }

        const vehicle = `${row.vehicle_year} ${row.vehicle_make} ${row.vehicle_model}`;
        if (!batches[batchId].vehicles.includes(vehicle)) {
          batches[batchId].vehicles.push(vehicle);
        }
      }

      return Object.values(batches).sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    },
  });
}

/* ================================================================ */
/* Vehicle Entry                                                     */
/* ================================================================ */
interface VehicleEntry {
  id: string;
  year: string;
  make: string;
  model: string;
}

/* ================================================================ */
/* Status Badge                                                      */
/* ================================================================ */
function StatusBadge({ status }: { status: PipelineJob["status"] }) {
  if (status === "queued")
    return <Badge variant="outline" className="border-zinc-700 text-zinc-500 text-[10px]">Queued</Badge>;
  if (status === "rendering")
    return <Badge className="bg-blue-600 animate-pulse text-[10px]">Rendering...</Badge>;
  if (status === "views")
    return <Badge className="bg-purple-600 animate-pulse text-[10px]">7 Views...</Badge>;
  if (status === "done")
    return <Badge className="bg-green-600 text-[10px]"><CheckCircle2 className="h-3 w-3 mr-0.5" /> Done</Badge>;
  if (status === "failed")
    return <Badge className="bg-red-600 text-[10px]"><XCircle className="h-3 w-3 mr-0.5" /> Failed</Badge>;
  return null;
}

/* ================================================================ */
/* Job Row                                                           */
/* ================================================================ */
function JobRow({ job }: { job: PipelineJob }) {
  const navigate = useNavigate();
  const hasViews = Object.keys(job.views).length > 0;

  const handleViewInColorPro = async () => {
    // Look up the color_visualizations record for this render
    const heroUrl = job.renderUrl || job.views?.side || Object.values(job.views)[0];
    if (!heroUrl) return;
    const { data } = await supabase
      .from('color_visualizations')
      .select('id')
      .contains('render_urls', { hero: heroUrl })
      .limit(1)
      .maybeSingle();
    // Fallback: try matching side view
    if (data?.id) {
      navigate(`/colorpro?renderId=${data.id}`);
    } else {
      const { data: d2 } = await supabase
        .from('color_visualizations')
        .select('id')
        .contains('render_urls', { side: heroUrl })
        .limit(1)
        .maybeSingle();
      if (d2?.id) {
        navigate(`/colorpro?renderId=${d2.id}`);
      } else {
        toast.error('Could not find this render in the database');
      }
    }
  };

  const handleSendToGallery = async () => {
    const heroUrl = job.renderUrl || job.views?.side || Object.values(job.views)[0];
    if (!heroUrl) { toast.error('No render image to send'); return; }
    const vehicleName = `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`;
    const title = job.designName || 'Batch Render';
    const { error } = await supabase.from('inkfusion_carousel').insert({
      media_url: heroUrl,
      title,
      name: title,
      subtitle: `${job.finish || 'Gloss'} \u2022 ${vehicleName}`,
      vehicle_name: vehicleName,
      color_name: job.designName,
      is_active: true,
    });
    if (error) { toast.error('Failed to send to gallery'); console.error(error); }
    else { toast.success('Sent to gallery!'); }
  };

  return (
    <Card
      className={cn(
        "bg-zinc-900 border-zinc-800 overflow-hidden",
        job.status === "failed" && "border-red-500/30",
        job.status === "rendering" && "border-blue-500/40",
        job.status === "views" && "border-purple-500/40",
        job.status === "done" && hasViews && "border-green-500/20",
      )}
    >
      <div className="flex gap-3 p-3">
        <div className="w-32 flex-shrink-0">
          {job.renderUrl ? (
            <div className="relative rounded-lg overflow-hidden border border-zinc-700">
              <img
                src={job.renderUrl}
                alt={`${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`}
                className="w-full aspect-video object-cover"
              />
            </div>
          ) : (
            <div className="w-full aspect-video bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-700">
              {job.status === "rendering" && <Loader2 className="h-6 w-6 text-blue-400 animate-spin" />}
              {job.status === "queued" && <Clock className="h-6 w-6 text-zinc-600" />}
              {job.status === "failed" && <XCircle className="h-6 w-6 text-red-400" />}
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold text-blue-300 truncate">{job.designName}</h4>
            <Badge variant="outline" className="border-zinc-600 text-[9px] flex-shrink-0">{job.finish}</Badge>
            <StatusBadge status={job.status} />
          </div>
          <p className="text-[10px] text-zinc-300 font-medium">
            {job.vehicle.year} {job.vehicle.make} {job.vehicle.model}
          </p>
          <p className="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed">{job.prompt}</p>
          {job.error && <p className="text-[10px] text-red-400 break-words whitespace-pre-wrap">{job.error}</p>}
          {job.durationMs != null && (
            <span className="text-[9px] text-zinc-500">{(job.durationMs / 1000).toFixed(1)}s</span>
          )}
          {job.status === "views" && (
            <div className="mt-1">
              <Progress value={(job.viewsProgress / VIEW_ORDER.length) * 100} className="h-1" />
              <p className="text-[9px] text-zinc-500 mt-0.5">
                View {Math.min(job.viewsProgress + 1, VIEW_ORDER.length)} of {VIEW_ORDER.length}
              </p>
            </div>
          )}
        </div>

        <div className="flex-shrink-0 flex flex-col items-end gap-1.5">
          {hasViews && (
            <div className="flex items-center gap-1 text-[10px] text-green-400">
              <Camera className="h-3 w-3" />
              <span className="font-bold">{Object.keys(job.views).length}/{VIEW_ORDER.length}</span>
            </div>
          )}
          {job.proofUrl && (
            <a
              href={job.proofUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/40 transition-colors border border-green-500/20"
            >
              <FileText className="h-2.5 w-2.5" /> Proof PDF
            </a>
          )}
          {job.status === "done" && hasViews && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link
                to="/admin/production-test"
                className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 transition-colors border border-blue-500/20"
              >
                <Package className="h-2.5 w-2.5" /> Production
              </Link>
              <Link
                to="/admin/rate-designs"
                className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-yellow-600/20 text-yellow-400 hover:bg-yellow-600/40 transition-colors border border-yellow-500/20"
              >
                <Star className="h-2.5 w-2.5" /> Rate
              </Link>
              <button
                onClick={handleViewInColorPro}
                className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/40 transition-colors border border-cyan-500/20"
              >
                <Palette className="h-2.5 w-2.5" /> View in ColorPro
              </button>
              <button
                onClick={handleSendToGallery}
                className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 transition-colors border border-emerald-500/20"
              >
                <ImageIcon className="h-2.5 w-2.5" /> Send to Gallery
              </button>
            </div>
          )}
        </div>
      </div>

      {hasViews && (
        <Collapsible>
          <CollapsibleTrigger className="w-full flex items-center justify-center gap-1 py-1.5 bg-zinc-800/50 hover:bg-zinc-800 transition-colors text-[10px] text-zinc-400 hover:text-zinc-200 border-t border-zinc-800">
            <Layers className="h-3 w-3" />
            <span>{Object.keys(job.views).length} Views Generated</span>
            <ChevronDown className="h-3 w-3" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="grid grid-cols-3 gap-1.5 p-2 bg-zinc-950">
              {VIEW_ORDER.map((key) => (
                <div key={key} className="relative rounded overflow-hidden border border-zinc-800 bg-zinc-900">
                  {job.views[key] ? (
                    <img src={job.views[key]} alt={VIEW_LABELS[key]} className="w-full aspect-video object-cover" />
                  ) : (
                    <div className="w-full aspect-video flex items-center justify-center">
                      <span className="text-[8px] text-zinc-600">pending</span>
                    </div>
                  )}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/80 text-[8px] text-center py-0.5 text-zinc-400">
                    {VIEW_LABELS[key]}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </Card>
  );
}

/* ================================================================ */
/* Tool Section                                                      */
/* ================================================================ */
function ToolSection({
  tool,
  jobs,
  toolStats,
}: {
  tool: ToolType;
  jobs: PipelineJob[];
  toolStats: { total: number; done: number; failed: number; views: number };
}) {
  const toolJobs = jobs.filter((j) => j.tool === tool);
  if (toolJobs.length === 0) return null;

  const progress = toolStats.total > 0 ? ((toolStats.done + toolStats.failed) / toolStats.total) * 100 : 0;
  const isComplete = toolStats.done + toolStats.failed === toolStats.total;

  return (
    <Collapsible defaultOpen>
      <Card className={cn("bg-zinc-950 border-zinc-800", TOOL_BORDER[tool])}>
        <CollapsibleTrigger className="w-full">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-lg bg-gradient-to-r", TOOL_COLORS[tool])}>
                  <Zap className="h-4 w-4 text-white" />
                </div>
                <div className="text-left">
                  <CardTitle className="text-base">{TOOL_LABELS[tool]}</CardTitle>
                  <CardDescription className="text-xs">
                    {toolStats.done}/{toolStats.total} renders &middot; {toolStats.views} views
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {isComplete ? (
                  <Badge className={toolStats.failed === 0 ? "bg-green-600" : "bg-amber-600"}>
                    {toolStats.failed === 0 ? "All Passed" : `${toolStats.failed} Failed`}
                  </Badge>
                ) : toolStats.done > 0 || toolStats.failed > 0 ? (
                  <Badge className="bg-blue-600 animate-pulse">In Progress</Badge>
                ) : (
                  <Badge variant="outline" className="border-zinc-700 text-zinc-500">Pending</Badge>
                )}
                <ChevronRight className="h-4 w-4 text-zinc-500" />
              </div>
            </div>
            {(toolStats.done > 0 || toolStats.failed > 0) && (
              <Progress value={progress} className="h-1 mt-2" />
            )}
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-2">
            {toolJobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

/* ================================================================ */
/* Batch History Card                                                */
/* ================================================================ */
function BatchHistoryCard({
  entry,
  onViewResults,
}: {
  entry: BatchHistoryEntry;
  onViewResults: (batchId: string) => void;
}) {
  const toolBadges = entry.tools.map((t) => TOOL_LABELS[t as ToolType] || t);
  const dateStr = entry.created_at
    ? new Date(entry.created_at).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "-";

  return (
    <Card className="bg-zinc-900 border-zinc-800 hover:border-zinc-700 transition-colors">
      <CardContent className="p-3">
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-zinc-200">
                {entry.batch_id.replace("batch_", "Batch ")}
              </span>
              <Badge variant="outline" className="border-zinc-700 text-[9px] text-zinc-500">
                {entry.total_renders} renders
              </Badge>
            </div>
            <p className="text-[10px] text-zinc-500">{dateStr}</p>
            <div className="flex gap-1 mt-1 flex-wrap">
              {toolBadges.map((t) => (
                <Badge key={t} variant="outline" className="text-[8px] border-zinc-700 text-zinc-400">
                  {t}
                </Badge>
              ))}
            </div>
            {entry.vehicles.length > 0 && (
              <p className="text-[9px] text-zinc-600 mt-1 truncate">
                {entry.vehicles.slice(0, 3).join(", ")}
                {entry.vehicles.length > 3 && ` +${entry.vehicles.length - 3} more`}
              </p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewResults(entry.batch_id)}
            className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10 text-[10px] h-7 px-2"
          >
            <ExternalLink className="h-3 w-3 mr-1" /> Results
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================================================ */
/* Configuration Panel                                               */
/* ================================================================ */
function ConfigPanel({
  vehicles,
  onAddVehicle,
  onRemoveVehicle,
  onUpdateVehicle,
  selectedTools,
  onToggleTool,
  customPrompt,
  onPromptChange,
  promptCategory,
  onPromptCategoryChange,
  quantityPerCombo,
  onQuantityChange,
  concurrencyLimit,
  onConcurrencyChange,
}: {
  vehicles: VehicleEntry[];
  onAddVehicle: () => void;
  onRemoveVehicle: (id: string) => void;
  onUpdateVehicle: (id: string, field: keyof VehicleEntry, value: string) => void;
  selectedTools: ToolType[];
  onToggleTool: (tool: ToolType) => void;
  customPrompt: string;
  onPromptChange: (prompt: string) => void;
  promptCategory: string;
  onPromptCategoryChange: (cat: string) => void;
  quantityPerCombo: number;
  onQuantityChange: (qty: number) => void;
  concurrencyLimit: number;
  onConcurrencyChange: (limit: number) => void;
}) {
  const totalJobs = vehicles.length * selectedTools.length * quantityPerCombo;
  const totalViews = totalJobs * VIEW_ORDER.length;
  const estimatedCost = (totalJobs * COST_PER_RENDER) + (totalViews * COST_PER_VIEW);

  return (
    <Card className="bg-zinc-900/80 border-zinc-700 mb-6">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-5 w-5 text-blue-400" />
          <CardTitle className="text-lg">Batch Configuration</CardTitle>
        </div>
        <CardDescription className="text-xs">
          Configure parameters for a custom batch run
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Vehicle Selection */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold text-zinc-200">
              <Car className="h-4 w-4 inline mr-1.5" />
              Vehicles
            </Label>
            <Button
              size="sm"
              variant="outline"
              onClick={onAddVehicle}
              className="h-7 text-[10px] border-zinc-600"
            >
              <Plus className="h-3 w-3 mr-1" /> Add Vehicle
            </Button>
          </div>
          <div className="space-y-2">
            {vehicles.map((v) => (
              <div key={v.id} className="flex gap-2 items-center">
                <Input
                  placeholder="Year"
                  value={v.year}
                  onChange={(e) => onUpdateVehicle(v.id, "year", e.target.value)}
                  className="w-20 h-8 text-xs bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Make"
                  value={v.make}
                  onChange={(e) => onUpdateVehicle(v.id, "make", e.target.value)}
                  className="flex-1 h-8 text-xs bg-zinc-800 border-zinc-700"
                />
                <Input
                  placeholder="Model"
                  value={v.model}
                  onChange={(e) => onUpdateVehicle(v.id, "model", e.target.value)}
                  className="flex-1 h-8 text-xs bg-zinc-800 border-zinc-700"
                />
                {vehicles.length > 1 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemoveVehicle(v.id)}
                    className="h-8 w-8 p-0 text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Tool Selection */}
        <div className="space-y-2">
          <Label className="text-sm font-semibold text-zinc-200">
            <Zap className="h-4 w-4 inline mr-1.5" />
            Tools
          </Label>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(TOOL_LABELS) as ToolType[]).map((tool) => {
              const isSelected = selectedTools.includes(tool);
              return (
                <button
                  key={tool}
                  onClick={() => onToggleTool(tool)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
                    isSelected
                      ? cn("bg-gradient-to-r text-white border-transparent", TOOL_COLORS[tool])
                      : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-500"
                  )}
                >
                  {TOOL_LABELS[tool]}
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt Category + Custom Prompt */}
        <div className="grid grid-cols-[160px_1fr] gap-4">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-zinc-200">
              Prompt Category
            </Label>
            <Select
              value={promptCategory}
              onValueChange={onPromptCategoryChange}
            >
              <SelectTrigger className="bg-zinc-800 border-zinc-700 h-9 text-xs">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="commercial">Commercial</SelectItem>
                <SelectItem value="restyle">ReStyle</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[9px] text-zinc-600">
              Each render gets a unique prompt from this category
            </p>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-zinc-200">
              Custom Prompt Override (optional)
            </Label>
            <Textarea
              placeholder="Leave blank to use unique prompts from the library per render..."
              value={customPrompt}
              onChange={(e) => onPromptChange(e.target.value)}
              className="bg-zinc-800 border-zinc-700 text-white text-xs min-h-[60px] placeholder:text-zinc-600"
            />
          </div>
        </div>

        {/* Quantity & Concurrency */}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-zinc-200">
              Quantity per Vehicle/Tool
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[quantityPerCombo]}
                onValueChange={([val]) => onQuantityChange(val)}
                min={1}
                max={50}
                step={1}
                className="flex-1"
              />
              <span className="text-sm font-bold text-blue-400 w-6 text-center">
                {quantityPerCombo}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm font-semibold text-zinc-200">
              Concurrency Limit
            </Label>
            <div className="flex items-center gap-3">
              <Slider
                value={[concurrencyLimit]}
                onValueChange={([val]) => onConcurrencyChange(val)}
                min={1}
                max={5}
                step={1}
                className="flex-1"
              />
              <span className="text-sm font-bold text-blue-400 w-6 text-center">
                {concurrencyLimit}
              </span>
            </div>
            <p className="text-[9px] text-zinc-600">Max 5 simultaneous renders</p>
          </div>
        </div>

        {/* Estimated Summary */}
        <div className="bg-zinc-950 rounded-lg p-3 border border-zinc-800">
          <div className="grid grid-cols-4 gap-4 text-center">
            <div>
              <p className="text-[10px] text-zinc-500 uppercase">Total Jobs</p>
              <p className="text-lg font-bold text-white">{totalJobs}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase">Total Views</p>
              <p className="text-lg font-bold text-purple-400">{totalViews}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase">Est. Cost</p>
              <p className="text-lg font-bold text-amber-400">${estimatedCost.toFixed(2)}</p>
            </div>
            <div>
              <p className="text-[10px] text-zinc-500 uppercase">Vehicles</p>
              <p className="text-lg font-bold text-green-400">{vehicles.length}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================================================ */
/* Batch Prompt Preview - unique prompts before launch               */
/* ================================================================ */
function BatchPromptPreview({
  prompts,
  category,
  onShuffle,
  onRemovePrompt,
  onLaunch,
  onClose,
  onGenerate,
  generating,
}: {
  prompts: PromptPreset[];
  category: "restyle" | "commercial";
  onShuffle: () => void;
  onRemovePrompt: (id: string) => void;
  onLaunch: () => void;
  onClose: () => void;
  onGenerate: (count: number) => void;
  generating: boolean;
}) {
  const isRestyle = category === "restyle";
  const accent = isRestyle ? "pink" : "blue";
  const subcategories = [...new Set(prompts.map((p) => p.subcategory))];
  const [filterSub, setFilterSub] = useState<string | null>(null);

  const displayed = filterSub
    ? prompts.filter((p) => p.subcategory === filterSub)
    : prompts;

  return (
    <Card className={cn(
      "mb-6 border",
      isRestyle ? "bg-zinc-950 border-pink-500/30" : "bg-zinc-950 border-blue-500/30"
    )}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn(
              "p-2 rounded-lg bg-gradient-to-r",
              isRestyle ? "from-pink-500 to-fuchsia-600" : "from-blue-500 to-blue-600"
            )}>
              <Eye className="h-5 w-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">
                {prompts.length} Unique {isRestyle ? "ReStyle" : "Commercial"} Prompts
              </CardTitle>
              <CardDescription className="text-xs">
                Review your batch queue - every render gets a different design. Shuffle for new selections or remove any you don't want.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={onShuffle}
              className={cn(
                "h-8 text-xs border-zinc-600",
                isRestyle ? "hover:border-pink-500/50 hover:text-pink-400" : "hover:border-blue-500/50 hover:text-blue-400"
              )}
            >
              <Shuffle className="h-3.5 w-3.5 mr-1.5" /> Shuffle All
            </Button>
            <div className="flex items-center gap-1">
              {[3, 5, 10].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  disabled={generating}
                  onClick={() => onGenerate(n)}
                  className={cn(
                    "h-8 text-xs font-bold",
                    isRestyle
                      ? "bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90"
                      : "bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90"
                  )}
                >
                  {generating ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <>
                      <Zap className="h-3 w-3 mr-1" /> +{n} New
                    </>
                  )}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="h-8 w-8 p-0 text-zinc-500 hover:text-white"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Subcategory filter chips */}
        {subcategories.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setFilterSub(null)}
              className={cn(
                "px-2.5 py-1 rounded-full text-[9px] font-medium transition-all border",
                !filterSub
                  ? cn("text-white border-transparent", isRestyle ? "bg-pink-600" : "bg-blue-600")
                  : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-500"
              )}
            >
              All ({prompts.length})
            </button>
            {subcategories.map((sub) => {
              const count = prompts.filter((p) => p.subcategory === sub).length;
              return (
                <button
                  key={sub}
                  onClick={() => setFilterSub(filterSub === sub ? null : sub)}
                  className={cn(
                    "px-2.5 py-1 rounded-full text-[9px] font-medium transition-all border",
                    filterSub === sub
                      ? cn("text-white border-transparent", isRestyle ? "bg-pink-600" : "bg-blue-600")
                      : "bg-zinc-800 text-zinc-400 border-zinc-700 hover:border-zinc-500"
                  )}
                >
                  {sub} ({count})
                </button>
              );
            })}
          </div>
        )}

        {/* Prompt list */}
        <div className="space-y-1.5 max-h-[400px] overflow-y-auto pr-1">
          {displayed.map((p, idx) => (
            <div
              key={p.id}
              className="flex items-start gap-3 p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 hover:border-zinc-700 transition-colors group"
            >
              <span className={cn(
                "flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5",
                isRestyle ? "bg-pink-600/20 text-pink-400" : "bg-blue-600/20 text-blue-400"
              )}>
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-200 truncate">
                    {p.name || p.id}
                  </span>
                  <Badge variant="outline" className={cn(
                    "text-[8px] flex-shrink-0",
                    isRestyle ? "border-pink-500/20 text-pink-400/70" : "border-blue-500/20 text-blue-400/70"
                  )}>
                    {p.subcategory}
                  </Badge>
                  {p.id.startsWith("gen_") && (
                    <Badge className="text-[7px] bg-purple-600/30 text-purple-300 border-purple-500/20 flex-shrink-0">
                      <Zap className="h-2 w-2 mr-0.5" /> AI Generated
                    </Badge>
                  )}
                  {p.id.startsWith("custom_") && (
                    <Badge className="text-[7px] bg-amber-600/30 text-amber-300 border-amber-500/20 flex-shrink-0">
                      Custom
                    </Badge>
                  )}
                  {p.vehicle && (
                    <span className="text-[9px] text-zinc-500 flex-shrink-0">
                      {p.vehicle.year} {p.vehicle.make} {p.vehicle.model}
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed">
                  {p.prompt}
                </p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onRemovePrompt(p.id)}
                className="h-6 w-6 p-0 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>

        {/* Summary + Launch */}
        <div className="flex items-center justify-between pt-2 border-t border-zinc-800">
          <div className="flex items-center gap-4 text-[10px] text-zinc-400">
            <span>{prompts.length} unique prompts</span>
            <span>{subcategories.length} styles</span>
            <span className="text-amber-400 font-bold">
              ~${((prompts.length * 0.08) + (prompts.length * 7 * 0.08)).toFixed(2)} est.
            </span>
          </div>
          <Button
            onClick={onLaunch}
            disabled={prompts.length === 0}
            className={cn(
              "h-10 px-6 text-sm font-bold",
              isRestyle
                ? "bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:opacity-90"
                : "bg-gradient-to-r from-blue-600 to-blue-600 hover:opacity-90"
            )}
          >
            <Play className="h-4 w-4 mr-2" /> Launch {prompts.length} Renders
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/* ================================================================ */
/* Main Page                                                        */
/* ================================================================ */
export default function AdminBatchRender() {
  const navigate = useNavigate();
  const { jobs, running, paused, currentIdx, phase, stats, batchId, startPipeline, startMixedBatch, startColorProBatch, startDesignProBatch, stop, pause, resume } =
    useBatchTestPipeline();

  const { data: batchHistory, isLoading: historyLoading } = useBatchHistory();
  const {
    jobs: revisionJobs,
    running: revisionRunning,
    phase: revisionPhase,
    stats: revisionStats,
    startAutoRevision,
    stopAutoRevision,
  } = useAutoRevisionPipeline();

  const {
    jobs: restyleJobs,
    running: restyleRunning,
    paused: restylePaused,
    currentIdx: restyleIdx,
    phase: restylePhase,
    stats: restyleStats,
    batchId: restyleBatchId,
    startPipeline: startRestylePipeline,
    stop: stopRestyle,
    pause: pauseRestyle,
    resume: resumeRestyle,
  } = useRestyleBatchPipeline();

  const {
    jobs: deployJobs,
    running: deployRunning,
    paused: deployPaused,
    currentIdx: deployIdx,
    phase: deployPhase,
    stats: deployStats,
    batchId: deployBatchId,
    startPipeline: startDeployPipeline,
    stop: stopDeploy,
    pause: pauseDeploy,
    resume: resumeDeploy,
    fetchAvailableDesigns,
  } = useDeployBatchPipeline();

  // Catalog Swatch Batch
  const {
    jobs: catalogJobs,
    running: catalogRunning,
    paused: catalogPaused,
    currentIdx: catalogIdx,
    phase: catalogPhase,
    stats: catalogStats,
    startCatalogBatch,
    stop: stopCatalog,
    pause: pauseCatalog,
    resume: resumeCatalog,
  } = useCatalogBatchPipeline();

  const [catalogLimit, setCatalogLimit] = useState(0); // 0 = all

  const handleStartCatalogBatch = (manufacturer: string) => {
    const vehicle = MANUFACTURER_VEHICLES[manufacturer] || { year: "2024", make: "McLaren", model: "720S" };
    setElapsedSeconds(0);
    startCatalogBatch({
      manufacturer,
      vehicle,
      limit: catalogLimit || undefined,
      watermark: true,
    });
    const limitLabel = catalogLimit > 0 ? `(first ${catalogLimit})` : "(all colors)";
    toast.success(`Catalog batch started — ${manufacturer} ${limitLabel} on ${vehicle.year} ${vehicle.make} ${vehicle.model}`);
  };

  // Deploy config state
  const [deployDesigns, setDeployDesigns] = useState<DeploySourceDesign[]>([]);
  const [selectedDeployDesignIds, setSelectedDeployDesignIds] = useState<string[]>([]);
  const [selectedDeployPhotoIds, setSelectedDeployPhotoIds] = useState<string[]>([]);
  const [deployDesignsLoading, setDeployDesignsLoading] = useState(false);

  // Prompt preview state
  const [previewCategory, setPreviewCategory] = useState<"restyle" | "commercial" | null>(null);
  const [previewPrompts, setPreviewPrompts] = useState<PromptPreset[]>([]);
  const [previewCount, setPreviewCount] = useState(5);
  // Custom prompt entry for adding new prompts to the preview queue
  const [newPromptText, setNewPromptText] = useState("");
  const [newPromptName, setNewPromptName] = useState("");
  // AI prompt generation
  const [generating, setGenerating] = useState(false);

  // Config state
  const [activeTab, setActiveTab] = useState<string>("preset");
  const [vehicles, setVehicles] = useState<VehicleEntry[]>([
    { id: "v1", year: "2024", make: "Ford", model: "F-150" },
  ]);
  const [selectedTools, setSelectedTools] = useState<ToolType[]>([
    "designpro", "colorpro", "fadewraps", "wbty", "approvemode",
  ]);
  const [customPrompt, setCustomPrompt] = useState("");
  const [promptCategory, setPromptCategory] = useState<"commercial" | "restyle" | "">("commercial");
  const [quantityPerCombo, setQuantityPerCombo] = useState(1);
  const [concurrencyLimit, setConcurrencyLimit] = useState(1);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // ── Single Prompt → CreatorMarket state ──
  const [singlePromptText, setSinglePromptText] = useState("");
  const [singlePromptName, setSinglePromptName] = useState("");
  const [singleVehicleYear, setSingleVehicleYear] = useState("2024");
  const [singleVehicleMake, setSingleVehicleMake] = useState("Porsche");
  const [singleVehicleModel, setSingleVehicleModel] = useState("911 GT3");
  const [singleFinish, setSingleFinish] = useState<"Gloss" | "Satin" | "Matte">("Gloss");
  const [publishingJobId, setPublishingJobId] = useState<string | null>(null);

  /** All ReStyle presets (for the "Pick from library" dropdown). */
  const restyleLibrary = getPresetsByCategory("restyle");

  /** Apply a preset to the single-prompt form. */
  const applyPresetToSingleForm = (presetId: string) => {
    const preset = restyleLibrary.find((p) => p.id === presetId);
    if (!preset) return;
    setSinglePromptText(preset.prompt);
    setSinglePromptName(preset.name || preset.subcategory || preset.id);
    if (preset.vehicle) {
      setSingleVehicleYear(preset.vehicle.year);
      setSingleVehicleMake(preset.vehicle.make);
      setSingleVehicleModel(preset.vehicle.model);
    }
  };

  const handleLaunchSinglePrompt = () => {
    if (!singlePromptText.trim()) {
      toast.error("Enter a prompt or pick one from the library");
      return;
    }
    if (!singlePromptName.trim()) {
      toast.error("Give the design a name");
      return;
    }
    setElapsedSeconds(0);
    startRestylePipeline({
      quantity: 1,
      concurrencyLimit: 1,
      customJobs: [
        {
          prompt: singlePromptText.trim(),
          designName: singlePromptName.trim(),
          vehicle: {
            year: singleVehicleYear.trim() || "2024",
            make: singleVehicleMake.trim() || "Porsche",
            model: singleVehicleModel.trim() || "911 GT3",
          },
          finish: singleFinish,
        },
      ],
    });
    toast.success(`Rendering "${singlePromptName.trim()}" — 7 views + proof`);
  };

  /**
   * Publish a completed ReStyle job to CreatorMarket.
   * Creates a stub production_pack pointing at the renders, then a
   * marketplace_listings row that references it. Uses the admin's own
   * creator profile (auto-creates one as a verified house creator if
   * none exists). Listing lands in pending_review unless the admin's
   * creator profile is verified — same rule the public publish flow uses.
   */
  const publishToCreatorMarket = async (job: typeof restyleJobs[number]) => {
    setPublishingJobId(job.id);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");

      // Find or create the admin's creator profile.
      let { data: profile } = await (supabase as any)
        .from("neuralnetwork_creator_profiles")
        .select("id, verified, status")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!profile) {
        const { data: created, error: createErr } = await (supabase as any)
          .from("neuralnetwork_creator_profiles")
          .insert({
            user_id: user.id,
            display_name: "DesignProAI Studio",
            status: "active",
            verified: true,
          })
          .select("id, verified, status")
          .single();
        if (createErr) throw createErr;
        profile = created;
      }

      // Build render_urls in the same shape the buyer popup + checkout expect.
      const renderUrls: Record<string, string> = {};
      if (job.renderUrl) renderUrls.side = job.renderUrl;
      for (const [k, v] of Object.entries(job.views || {})) {
        if (typeof v === "string" && v) renderUrls[k] = v;
      }
      const heroUrl = renderUrls.side || renderUrls.front || Object.values(renderUrls)[0] || null;
      if (!heroUrl) throw new Error("Job has no renders to publish");

      const vehicleLabel = `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`.trim();

      // Stub production_packs row — pack_url stays null until the panelizer fills it.
      const { data: pack, error: packErr } = await (supabase as any)
        .from("production_packs")
        .insert({
          user_id: user.id,
          design_name: job.designName,
          finish_type: job.finish,
          panels_selected: {},
          thumbnail_url: heroUrl,
          vehicle_info: job.vehicle,
          upscale_status: "pending",
          payment_status: "n/a",
        })
        .select("id")
        .single();
      if (packErr) throw packErr;

      // Read auto-approve setting.
      const { data: settings } = await (supabase as any)
        .from("creator_market_settings")
        .select("auto_approve_verified")
        .limit(1)
        .maybeSingle();
      const autoApprove = settings?.auto_approve_verified ?? true;
      const status: "listed" | "pending_review" =
        autoApprove && profile.verified ? "listed" : "pending_review";

      const { error: listErr } = await (supabase as any)
        .from("marketplace_listings")
        .insert({
          creator_id: profile.id,
          design_dna_id: pack.id,
          title: `${vehicleLabel} - ${job.designName}`,
          price: 160,
          thumbnail_url: heroUrl,
          vehicle_year: job.vehicle.year,
          vehicle_make: job.vehicle.make,
          vehicle_model: job.vehicle.model,
          render_urls: renderUrls,
          design_style: "custom",
          status,
          listed_at: status === "listed" ? new Date().toISOString() : null,
        });
      if (listErr) throw listErr;

      toast.success(
        status === "listed"
          ? `"${job.designName}" is live on CreatorMarket`
          : `"${job.designName}" submitted for review`,
      );
    } catch (err: any) {
      console.error("[publishToCreatorMarket] Failed:", err);
      toast.error(err?.message || "Failed to publish to CreatorMarket");
    } finally {
      setPublishingJobId(null);
    }
  };

  // Track elapsed time
  useEffect(() => {
    if (!running || paused) return;
    const interval = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [running, paused]);

  const addVehicle = () => {
    setVehicles((prev) => [
      ...prev,
      { id: `v${Date.now()}`, year: "2024", make: "", model: "" },
    ]);
  };

  const removeVehicle = (id: string) => {
    setVehicles((prev) => prev.filter((v) => v.id !== id));
  };

  const updateVehicle = (id: string, field: keyof VehicleEntry, value: string) => {
    setVehicles((prev) =>
      prev.map((v) => (v.id === id ? { ...v, [field]: value } : v))
    );
  };

  const toggleTool = (tool: ToolType) => {
    setSelectedTools((prev) =>
      prev.includes(tool)
        ? prev.filter((t) => t !== tool)
        : [...prev, tool]
    );
  };

  const handleStartPreset = () => {
    setElapsedSeconds(0);
    startPipeline();
    toast.success("Batch Test Pipeline started - 25 renders × 7 views across all 5 tools");
  };

  const handleStartCommercial100 = (count: number = 5) => {
    setElapsedSeconds(0);
    const config = {
      vehicles: [{ year: "2024", make: "Ford", model: "F-150" }],
      tools: ["designpro" as const],
      quantityPerCombo: count,
      promptCategory: "commercial" as const,
      concurrencyLimit: 2,
    };
    startPipeline(config);
    toast.success(`${count} DesignProAI Commercial Prompts - auto-matched vehicles per industry, 7 views + proof`);
  };

  const handleStartRestyle = (count: number = 5) => {
    setElapsedSeconds(0);
    startRestylePipeline({ quantity: count, concurrencyLimit: 2 });
    toast.success(`ReStyle Batch Pipeline started - ${count} artistic renders × 7 views + proofs`);
  };

  const handleStartMixedBatch = () => {
    setElapsedSeconds(0);
    startMixedBatch({ colorProCount: 10, patternProCount: 5, watermark: true });
    toast.success("Mixed batch started — 10 ColorPro + 5 PatternPro (random) with watermarks");
  };

  const handleStartColorProBatch = (count: number = 10) => {
    setElapsedSeconds(0);
    startColorProBatch(count, true);
    toast.success(`ColorPro batch started — ${count} random colors on random vehicles with watermarks`);
  };

  const handleStartDesignProBatch = (count: number = 10) => {
    setElapsedSeconds(0);
    startDesignProBatch(count, true);
    toast.success(`DesignPro Premium batch started — ${count} photo-integrated commercial wraps (new presets)`);
  };

  // --- Prompt Preview Handlers ---
  const handlePreviewPrompts = (category: "restyle" | "commercial", count: number) => {
    const prompts = getRandomPresets(count, category);
    setPreviewCategory(category);
    setPreviewCount(count);
    setPreviewPrompts(prompts);
    setNewPromptText("");
    setNewPromptName("");
  };

  /** Start with an empty queue and immediately generate AI prompts */
  const handleGenerateOnly = async (category: "restyle" | "commercial", count: number) => {
    setPreviewCategory(category);
    setPreviewCount(count);
    setPreviewPrompts([]);
    setNewPromptText("");
    setNewPromptName("");
    // Trigger generation after state is set
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-batch-prompts", {
        body: { category, count },
      });
      if (error) {
        let detail = "";
        if ((error as any).context) {
          try { const b = await (error as any).context.json(); detail = b?.error || b?.message || ""; } catch {}
        }
        throw new Error(detail || error.message);
      }
      if (!data?.prompts || !Array.isArray(data.prompts)) throw new Error("No prompts returned");
      setPreviewPrompts(data.prompts);
      toast.success(`Generated ${data.prompts.length} new ${category} prompts`);
    } catch (err: any) {
      console.error("[GeneratePrompts] Error:", err);
      toast.error(`Failed to generate prompts: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleShufflePreview = () => {
    if (!previewCategory) return;
    const prompts = getRandomPresets(previewCount, previewCategory);
    setPreviewPrompts(prompts);
  };

  const handleRemovePreviewPrompt = (id: string) => {
    setPreviewPrompts((prev) => prev.filter((p) => p.id !== id));
  };

  const handleAddCustomPrompt = () => {
    if (!newPromptText.trim() || !previewCategory) return;
    const customPreset: PromptPreset = {
      id: `custom_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      prompt: newPromptText.trim(),
      category: previewCategory,
      subcategory: "Custom",
      tags: ["custom"],
      name: newPromptName.trim() || `Custom Design ${previewPrompts.length + 1}`,
    };
    setPreviewPrompts((prev) => [...prev, customPreset]);
    setNewPromptText("");
    setNewPromptName("");
    toast.success("Custom prompt added to queue");
  };

  const handleGenerateNewPrompts = async (count: number = 5) => {
    if (!previewCategory || generating) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-batch-prompts", {
        body: { category: previewCategory, count },
      });

      if (error) {
        let detail = "";
        if ((error as any).context) {
          try {
            const b = await (error as any).context.json();
            detail = b?.error || b?.message || "";
          } catch {}
        }
        throw new Error(detail || error.message);
      }

      if (!data?.prompts || !Array.isArray(data.prompts)) {
        throw new Error("No prompts returned");
      }

      // Add generated prompts to the preview queue
      setPreviewPrompts((prev) => [...prev, ...data.prompts]);
      toast.success(`Generated ${data.prompts.length} new ${previewCategory} prompts`);
    } catch (err: any) {
      console.error("[GeneratePrompts] Error:", err);
      toast.error(`Failed to generate prompts: ${err.message}`);
    } finally {
      setGenerating(false);
    }
  };

  const handleLaunchFromPreview = () => {
    if (!previewCategory || previewPrompts.length === 0) return;
    setElapsedSeconds(0);
    if (previewCategory === "restyle") {
      // Build custom jobs from preview prompts for the restyle pipeline
      const customJobs = previewPrompts.map((p) => ({
        prompt: p.prompt,
        designName: p.name || p.subcategory || p.id,
        vehicle: p.vehicle || {
          year: "2024",
          make: ["Porsche", "BMW", "McLaren", "Lamborghini", "Ford", "Tesla", "Audi", "Mercedes-AMG", "Nissan", "Chevrolet"][
            Math.floor(Math.random() * 10)
          ],
          model: ["911 GT3", "M4", "720S", "Huracán", "Mustang GT", "Model S Plaid", "RS e-tron GT", "GT", "Z", "Corvette C8"][
            Math.floor(Math.random() * 10)
          ],
        },
        finish: (["Gloss", "Satin", "Matte"] as const)[Math.floor(Math.random() * 3)],
      }));
      startRestylePipeline({ quantity: customJobs.length, concurrencyLimit: 2, customJobs });
      toast.success(`ReStyle Batch launched - ${customJobs.length} unique prompts × 7 views + proofs`);
    } else {
      // Commercial - use the test pipeline with custom prompt list
      const config = {
        vehicles: [{ year: "2024", make: "Ford", model: "F-150" }],
        tools: ["designpro" as const],
        quantityPerCombo: previewPrompts.length,
        promptCategory: "commercial" as const,
        concurrencyLimit: 2,
        customPrompts: previewPrompts,
      };
      startPipeline(config);
      toast.success(`${previewPrompts.length} Commercial prompts launched - auto-matched vehicles, 7 views + proof`);
    }
    setPreviewCategory(null);
    setPreviewPrompts([]);
  };

  const handleClosePreview = () => {
    setPreviewCategory(null);
    setPreviewPrompts([]);
  };

  const handleRestylePauseResume = () => {
    if (restylePaused) {
      resumeRestyle();
      toast.info("ReStyle pipeline resumed");
    } else {
      pauseRestyle();
      toast.info("ReStyle pipeline paused");
    }
  };

  const handleLoadDeployDesigns = async () => {
    setDeployDesignsLoading(true);
    const designs = await fetchAvailableDesigns();
    setDeployDesigns(designs);
    setDeployDesignsLoading(false);
  };

  const handleToggleDeployDesign = (id: string) => {
    setSelectedDeployDesignIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  };

  const handleToggleDeployPhoto = (id: string) => {
    setSelectedDeployPhotoIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleStartDeploy = () => {
    if (selectedDeployDesignIds.length === 0) {
      toast.error("Select at least one design to deploy");
      return;
    }
    const photos = STOCK_VEHICLE_PHOTOS.filter((p) => selectedDeployPhotoIds.includes(p.id));
    if (photos.length === 0) {
      toast.error("Select at least one vehicle photo");
      return;
    }
    startDeployPipeline({
      designIds: selectedDeployDesignIds,
      vehiclePhotos: photos,
      concurrencyLimit: 2,
    });
    toast.success(`Deploy Pipeline started - ${selectedDeployDesignIds.length} designs x ${photos.length} photos`);
  };

  const handleDeployPauseResume = () => {
    if (deployPaused) {
      resumeDeploy();
      toast.info("Deploy pipeline resumed");
    } else {
      pauseDeploy();
      toast.info("Deploy pipeline paused");
    }
  };

  const handleStartCustom = () => {
    if (vehicles.some((v) => !v.make || !v.model)) {
      toast.error("Please fill in all vehicle fields");
      return;
    }
    if (selectedTools.length === 0) {
      toast.error("Please select at least one tool");
      return;
    }
    setElapsedSeconds(0);
    const config: BatchPipelineConfig = {
      vehicles: vehicles.map((v) => ({ year: v.year, make: v.make, model: v.model })),
      tools: selectedTools,
      quantityPerCombo,
      customPrompt: customPrompt || undefined,
      promptCategory: (promptCategory as "commercial" | "restyle") || undefined,
      concurrencyLimit,
    };
    startPipeline(config);
    toast.success(`Custom batch started - ${vehicles.length} vehicles × ${selectedTools.length} tools × ${quantityPerCombo} each`);
  };

  const handlePauseResume = () => {
    if (paused) {
      resume();
      toast.info("Pipeline resumed");
    } else {
      pause();
      toast.info("Pipeline paused - current render will finish, no new jobs queued");
    }
  };

  const handleStop = () => {
    stop();
    toast.warning("Pipeline stopped");
  };

  const overallProgress =
    stats.total > 0 ? ((stats.done + stats.failed) / stats.total) * 100 : 0;

  const runningCostEstimate = (stats.done * COST_PER_RENDER) + (stats.totalViews * COST_PER_VIEW);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-[1600px] mx-auto px-6 py-8 pt-24">
        {/* Page Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500 via-purple-500 to-amber-500">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Batch Render Control Center</h1>
              <p className="text-zinc-400 text-sm">
                Trigger, monitor, and manage batch render pipelines
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {phase === "complete" && batchId && (
              <Button
                onClick={() => navigate(`/admin/batch-results?batch=${batchId}`)}
                className="bg-gradient-to-r from-green-600 to-emerald-600 hover:opacity-90 h-12 px-6 text-base font-bold"
              >
                <CheckCircle2 className="h-5 w-5 mr-2" /> Review Results
              </Button>
            )}
            {restylePhase === "complete" && restyleBatchId && (
              <Button
                onClick={() => navigate(`/admin/batch-results?batch=${restyleBatchId}`)}
                className="bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:opacity-90 h-12 px-6 text-base font-bold"
              >
                <CheckCircle2 className="h-5 w-5 mr-2" /> Review ReStyle
              </Button>
            )}
            {deployPhase === "complete" && deployBatchId && (
              <Button
                onClick={() => navigate(`/admin/batch-results?batch=${deployBatchId}`)}
                className="bg-gradient-to-r from-cyan-600 to-teal-600 hover:opacity-90 h-12 px-6 text-base font-bold"
              >
                <CheckCircle2 className="h-5 w-5 mr-2" /> Review Deploys
              </Button>
            )}
            {running && (
              <>
                <Button
                  variant="outline"
                  onClick={handlePauseResume}
                  className={cn(
                    "h-12 px-4 border-zinc-600",
                    paused && "border-green-500/50 text-green-400"
                  )}
                >
                  {paused ? (
                    <><Play className="h-4 w-4 mr-2" /> Resume</>
                  ) : (
                    <><Pause className="h-4 w-4 mr-2" /> Pause</>
                  )}
                </Button>
                <Button variant="destructive" onClick={handleStop} className="h-12 px-6">
                  <Square className="h-5 w-5 mr-2" /> Cancel
                </Button>
              </>
            )}
            {restyleRunning && (
              <>
                <Button
                  variant="outline"
                  onClick={handleRestylePauseResume}
                  className={cn(
                    "h-12 px-4 border-zinc-600",
                    restylePaused && "border-green-500/50 text-green-400"
                  )}
                >
                  {restylePaused ? (
                    <><Play className="h-4 w-4 mr-2" /> Resume ReStyle</>
                  ) : (
                    <><Pause className="h-4 w-4 mr-2" /> Pause ReStyle</>
                  )}
                </Button>
                <Button variant="destructive" onClick={() => { stopRestyle(); toast.warning("ReStyle pipeline stopped"); }} className="h-12 px-6">
                  <Square className="h-5 w-5 mr-2" /> Cancel ReStyle
                </Button>
              </>
            )}
            {deployRunning && (
              <>
                <Button
                  variant="outline"
                  onClick={handleDeployPauseResume}
                  className={cn(
                    "h-12 px-4 border-zinc-600",
                    deployPaused && "border-green-500/50 text-green-400"
                  )}
                >
                  {deployPaused ? (
                    <><Play className="h-4 w-4 mr-2" /> Resume Deploy</>
                  ) : (
                    <><Pause className="h-4 w-4 mr-2" /> Pause Deploy</>
                  )}
                </Button>
                <Button variant="destructive" onClick={() => { stopDeploy(); toast.warning("Deploy pipeline stopped"); }} className="h-12 px-6">
                  <Square className="h-5 w-5 mr-2" /> Cancel Deploy
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Studio Environment Banner */}
        <Card className="mb-6 border-zinc-700 bg-zinc-900/50">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="flex gap-2">
              <div className="w-6 h-6 rounded border border-zinc-600" style={{ background: "linear-gradient(to bottom, #2a2a2a, #333333)" }} />
              <div className="w-6 h-6 rounded border border-zinc-600" style={{ background: "linear-gradient(to bottom, #d0d0d0, #e8e8e8)" }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-zinc-200">Locked Studio Environment - Bright</p>
              <p className="text-xs text-zinc-500">
                Dark charcoal textured floor (#2a2a2a–#333333) &middot; Light gray walls (#d0d0d0–#e8e8e8) &middot; Bright commercial photography lighting
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Prompt Preview Panel - shown when user selects a count */}
        {previewCategory && previewPrompts.length > 0 && (
          <>
            <BatchPromptPreview
              prompts={previewPrompts}
              category={previewCategory}
              onShuffle={handleShufflePreview}
              onRemovePrompt={handleRemovePreviewPrompt}
              onLaunch={handleLaunchFromPreview}
              onClose={handleClosePreview}
              onGenerate={handleGenerateNewPrompts}
              generating={generating}
            />
            {/* Add Custom Prompt to Queue */}
            <Card className={cn(
              "mb-6 border",
              previewCategory === "restyle" ? "bg-zinc-950 border-pink-500/20" : "bg-zinc-950 border-blue-500/20"
            )}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Plus className={cn("h-4 w-4", previewCategory === "restyle" ? "text-pink-400" : "text-blue-400")} />
                  <span className="text-sm font-semibold text-zinc-200">Add Custom Prompt</span>
                  <span className="text-[9px] text-zinc-500">Write your own design prompt to add to this batch</span>
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="Design name (e.g. Midnight Storm)"
                    value={newPromptName}
                    onChange={(e) => setNewPromptName(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white text-xs h-8 placeholder:text-zinc-600"
                  />
                  <Textarea
                    placeholder={previewCategory === "restyle"
                      ? "Describe your wrap design... (e.g. Dark metallic dragon scales flowing from hood to trunk, emerald green to black gradient with gold edge highlights, each scale individually rendered with depth and shadow...)"
                      : "Describe your commercial wrap... (e.g. Mike's Plumbing - clean white base with blue wave accents, photograph of modern bathroom renovation on passenger side, contact info on tailgate...)"}
                    value={newPromptText}
                    onChange={(e) => setNewPromptText(e.target.value)}
                    className="bg-zinc-800 border-zinc-700 text-white text-xs min-h-[80px] placeholder:text-zinc-600"
                  />
                  <Button
                    onClick={handleAddCustomPrompt}
                    disabled={!newPromptText.trim()}
                    size="sm"
                    className={cn(
                      "h-8 text-xs font-bold disabled:opacity-30",
                      previewCategory === "restyle"
                        ? "bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:opacity-90"
                        : "bg-gradient-to-r from-blue-600 to-blue-600 hover:opacity-90"
                    )}
                  >
                    <Plus className="h-3 w-3 mr-1" /> Add to Queue
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}

        {/* Tabs: Preset / Custom / History */}
        {!running && !restyleRunning && !deployRunning && phase !== "complete" && restylePhase !== "complete" && deployPhase !== "complete" && jobs.length === 0 && restyleJobs.length === 0 && deployJobs.length === 0 && !previewCategory && (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mb-6">
            <TabsList className="bg-zinc-900 border border-zinc-700">
              <TabsTrigger value="preset" className="text-xs data-[state=active]:bg-blue-600">
                <Zap className="h-3.5 w-3.5 mr-1.5" /> Preset Pipeline
              </TabsTrigger>
              <TabsTrigger value="custom" className="text-xs data-[state=active]:bg-purple-600">
                <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Custom Batch
              </TabsTrigger>
              <TabsTrigger value="single" className="text-xs data-[state=active]:bg-fuchsia-600">
                <Wand2 className="h-3.5 w-3.5 mr-1.5" /> Single Prompt → CM
              </TabsTrigger>
              <TabsTrigger value="catalog" className="text-xs data-[state=active]:bg-emerald-600">
                <Palette className="h-3.5 w-3.5 mr-1.5" /> Catalog Swatches
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs data-[state=active]:bg-amber-600">
                <History className="h-3.5 w-3.5 mr-1.5" /> Batch History
              </TabsTrigger>
            </TabsList>

            {/* Preset Pipeline Tab */}
            <TabsContent value="preset" className="mt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* 5 DesignProAI Commercial Prompts - Primary Preset */}
                <Card className="bg-zinc-950 border-blue-500/30 hover:border-blue-500/50 transition-colors">
                  <CardHeader className="text-center pb-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500 to-blue-600 w-fit mx-auto mb-3">
                      <Zap className="h-8 w-8 text-white" />
                    </div>
                    <CardTitle className="text-lg">5 DesignProAI&trade; Commercial</CardTitle>
                    <CardDescription className="text-xs">
                      Commercial prompt library &mdash; real business wraps from 8 industries
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-blue-400">5</p>
                        <p className="text-[9px] text-zinc-500">Unique Prompts</p>
                      </div>
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-blue-400">35</p>
                        <p className="text-[9px] text-zinc-500">Views</p>
                      </div>
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-amber-400">~$8</p>
                        <p className="text-[9px] text-zinc-500">Est. Cost</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-center">
                      {["Food & Bev", "Construction", "Auto", "Healthcare", "Real Estate", "Delivery", "Events", "Tech"].map((ind) => (
                        <Badge key={ind} variant="outline" className="text-[8px] border-blue-500/20 text-blue-400/70">
                          {ind}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-[10px] text-zinc-500 text-center">
                      Unique commercial prompts &middot; auto-matched vehicles &middot; 7 views each
                    </p>
                    <p className="text-[9px] text-zinc-600 text-center font-semibold uppercase tracking-wider">From Library</p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handlePreviewPrompts("commercial", 5)}
                        className="flex-1 bg-gradient-to-r from-blue-600 to-blue-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        <Eye className="h-4 w-4 mr-1" /> 5
                      </Button>
                      <Button
                        onClick={() => handlePreviewPrompts("commercial", 10)}
                        className="flex-1 bg-gradient-to-r from-blue-600 to-blue-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        <Eye className="h-4 w-4 mr-1" /> 10
                      </Button>
                      <Button
                        onClick={() => handlePreviewPrompts("commercial", 20)}
                        className="flex-1 bg-gradient-to-r from-blue-600 to-blue-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        <Eye className="h-4 w-4 mr-1" /> 20
                      </Button>
                    </div>
                    <p className="text-[9px] text-zinc-600 text-center font-semibold uppercase tracking-wider pt-1">AI Generated - Brand New</p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleGenerateOnly("commercial", 5)}
                        disabled={generating}
                        className="flex-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-1" /> 5</>}
                      </Button>
                      <Button
                        onClick={() => handleGenerateOnly("commercial", 10)}
                        disabled={generating}
                        className="flex-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-1" /> 10</>}
                      </Button>
                      <Button
                        onClick={() => handleGenerateOnly("commercial", 20)}
                        disabled={generating}
                        className="flex-1 bg-gradient-to-r from-cyan-600 to-blue-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-1" /> 20</>}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Original 5×5 Multi-Tool Pipeline */}
                <Card className="bg-zinc-950 border-zinc-700 hover:border-zinc-600 transition-colors">
                  <CardHeader className="text-center pb-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500 via-green-500 to-amber-500 w-fit mx-auto mb-3">
                      <Layers className="h-8 w-8 text-white" />
                    </div>
                    <CardTitle className="text-lg">Multi-Tool Test Pipeline</CardTitle>
                    <CardDescription className="text-xs">
                      25 renders across all 5 tools &mdash; quick validation run
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-blue-400">25</p>
                        <p className="text-[9px] text-zinc-500">Renders</p>
                      </div>
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-blue-400">175</p>
                        <p className="text-[9px] text-zinc-500">Views</p>
                      </div>
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-amber-400">~$28</p>
                        <p className="text-[9px] text-zinc-500">Est. Cost</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-center">
                      {(Object.keys(TOOL_LABELS) as ToolType[]).map((tool) => (
                        <Badge
                          key={tool}
                          variant="outline"
                          className={cn("text-[8px]", TOOL_BORDER[tool])}
                        >
                          {TOOL_LABELS[tool]} &times; 5
                        </Badge>
                      ))}
                    </div>
                    <p className="text-[10px] text-zinc-500 text-center">
                      DesignProAI &rarr; ColorPro &rarr; FadeWraps &rarr; PatternPro &rarr; ApprovePro
                    </p>
                    <Button
                      onClick={handleStartPreset}
                      variant="outline"
                      className="w-full border-zinc-600 hover:bg-zinc-800 h-11 text-sm font-bold"
                    >
                      <Play className="h-4 w-4 mr-2" /> Launch Multi-Tool
                    </Button>
                  </CardContent>
                </Card>

                {/* ColorPro-Only Batch */}
                <Card className="bg-zinc-950 border-green-500/30 hover:border-green-500/50 transition-colors">
                  <CardHeader className="text-center pb-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-green-500 to-emerald-600 w-fit mx-auto mb-3">
                      <Palette className="h-8 w-8 text-white" />
                    </div>
                    <CardTitle className="text-lg">ColorPro&trade;</CardTitle>
                    <CardDescription className="text-xs">
                      Random manufacturer colors from 3M, Avery, KPMF, Hexis, TeckWrap, Oracal &amp; Inozetek &mdash; watermarked with film name
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div className="bg-green-900/20 rounded-lg p-3 border border-green-500/20 text-center">
                      <p className="text-2xl font-bold text-green-400">10</p>
                      <p className="text-[9px] text-zinc-400">Random Colors &times; 7 Views</p>
                    </div>
                    <p className="text-[10px] text-zinc-500 text-center">
                      Random vehicles &bull; Watermark: &ldquo;ColorPro&trade;&rdquo; (top-left) + Manufacturer &amp; Color (bottom-right)
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleStartColorProBatch(5)}
                        disabled={running}
                        variant="outline"
                        className="flex-1 border-green-700 hover:bg-green-900/30 h-11 text-sm font-bold"
                      >
                        <Play className="h-4 w-4 mr-1" /> 5
                      </Button>
                      <Button
                        onClick={() => handleStartColorProBatch(10)}
                        disabled={running}
                        variant="outline"
                        className="flex-1 border-green-600 hover:bg-green-900/30 h-11 text-sm font-bold"
                      >
                        <Play className="h-4 w-4 mr-1" /> 10
                      </Button>
                      <Button
                        onClick={() => handleStartColorProBatch(20)}
                        disabled={running}
                        variant="outline"
                        className="flex-1 border-green-600 hover:bg-green-900/30 h-11 text-sm font-bold"
                      >
                        <Play className="h-4 w-4 mr-1" /> 20
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* DesignPro Premium Commercial Batch */}
                <Card className="bg-zinc-950 border-blue-500/30 hover:border-blue-500/50 transition-colors">
                  <CardHeader className="text-center pb-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-600 w-fit mx-auto mb-3">
                      <ImageIcon className="h-8 w-8 text-white" />
                    </div>
                    <CardTitle className="text-lg">DesignPro&trade; Premium</CardTitle>
                    <CardDescription className="text-xs">
                      30 high-end photo-integrated commercial wraps &mdash; fitness, real estate, med spa, fine dining, tech &amp; more. Each vehicle-matched.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-500/20 text-center">
                      <p className="text-2xl font-bold text-blue-400">30</p>
                      <p className="text-[9px] text-zinc-400">Premium Presets &times; 7 Views</p>
                    </div>
                    <p className="text-[10px] text-zinc-500 text-center">
                      Photo woven into design &bull; Les Mills / Equinox tier &bull; Watermark: design name
                    </p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleStartDesignProBatch(5)}
                        disabled={running}
                        variant="outline"
                        className="flex-1 border-blue-700 hover:bg-blue-900/30 h-11 text-sm font-bold"
                      >
                        <Play className="h-4 w-4 mr-1" /> 5
                      </Button>
                      <Button
                        onClick={() => handleStartDesignProBatch(10)}
                        disabled={running}
                        variant="outline"
                        className="flex-1 border-blue-600 hover:bg-blue-900/30 h-11 text-sm font-bold"
                      >
                        <Play className="h-4 w-4 mr-1" /> 10
                      </Button>
                      <Button
                        onClick={() => handleStartDesignProBatch(20)}
                        disabled={running}
                        variant="outline"
                        className="flex-1 border-blue-600 hover:bg-blue-900/30 h-11 text-sm font-bold"
                      >
                        <Play className="h-4 w-4 mr-1" /> 20
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* 10 ColorPro + 5 PatternPro Random Batch */}
                <Card className="bg-zinc-950 border-cyan-500/30 hover:border-cyan-500/50 transition-colors">
                  <CardHeader className="text-center pb-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-600 w-fit mx-auto mb-3">
                      <Shuffle className="h-8 w-8 text-white" />
                    </div>
                    <CardTitle className="text-lg">ColorPro + PatternPro</CardTitle>
                    <CardDescription className="text-xs">
                      10 random ColorPro colors + 5 random PatternPro patterns on random vehicles &mdash; watermarked with tool name &amp; color/pattern label
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <div className="grid grid-cols-2 gap-2 text-center">
                      <div className="bg-green-900/20 rounded-lg p-2 border border-green-500/20">
                        <p className="text-xl font-bold text-green-400">10</p>
                        <p className="text-[9px] text-zinc-400">ColorPro&trade;</p>
                      </div>
                      <div className="bg-purple-900/20 rounded-lg p-2 border border-purple-500/20">
                        <p className="text-xl font-bold text-purple-400">5</p>
                        <p className="text-[9px] text-zinc-400">PatternPro&trade;</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-center">
                      <Badge variant="outline" className="text-[8px] border-green-500/30">ColorPro &times; 10</Badge>
                      <Badge variant="outline" className="text-[8px] border-purple-500/30">PatternPro &times; 5</Badge>
                    </div>
                    <p className="text-[10px] text-zinc-500 text-center">
                      Random vehicles &bull; Watermark: tool name (top-left) + color/pattern (bottom-right)
                    </p>
                    <Button
                      onClick={handleStartMixedBatch}
                      disabled={running}
                      variant="outline"
                      className="w-full border-cyan-600 hover:bg-cyan-900/30 h-11 text-sm font-bold"
                    >
                      <Shuffle className="h-4 w-4 mr-2" /> Launch 15 Random
                    </Button>
                  </CardContent>
                </Card>

                {/* 5 ReStyle Artistic Batch Pipeline */}
                <Card className="bg-zinc-950 border-pink-500/30 hover:border-pink-500/50 transition-colors">
                  <CardHeader className="text-center pb-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-pink-500 to-fuchsia-600 w-fit mx-auto mb-3">
                      <Palette className="h-8 w-8 text-white" />
                    </div>
                    <CardTitle className="text-lg">ReStyle&trade; Artistic</CardTitle>
                    <CardDescription className="text-xs">
                      103 themed wraps &mdash; graphic slashes, graffiti, shattered, splatter, vintage heritage, racing liveries &amp; more
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-pink-400">5</p>
                        <p className="text-[9px] text-zinc-500">Unique Prompts</p>
                      </div>
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-pink-400">35</p>
                        <p className="text-[9px] text-zinc-500">Views</p>
                      </div>
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-amber-400">~$8</p>
                        <p className="text-[9px] text-zinc-500">Est. Cost</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-center">
                      {["Cyberpunk", "Tactical", "Racing", "Nature", "Cultural", "Luxury", "Street Art", "Chameleon", "Mythical", "Geometric", "Seasons", "Music", "Retro", "Wildlife", "Cosmos", "Steampunk", "Botanical", "Lowrider", "Vintage", "Race Livery", "Floral", "Japanese", "Tron", "Designer", "Angular Slash", "Graffiti Art", "Shattered", "Paint Splatter", "Neon Block", "Vintage Heritage"].map((sub) => (
                        <Badge key={sub} variant="outline" className="text-[8px] border-pink-500/20 text-pink-400/70">
                          {sub}
                        </Badge>
                      ))}
                    </div>
                    <p className="text-[10px] text-zinc-500 text-center">
                      103 unique theme restyle prompts &middot; exotic vehicles &middot; 7 views each
                    </p>
                    <p className="text-[9px] text-zinc-600 text-center font-semibold uppercase tracking-wider">From Library</p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handlePreviewPrompts("restyle", 5)}
                        className="flex-1 bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        <Eye className="h-4 w-4 mr-1" /> 5
                      </Button>
                      <Button
                        onClick={() => handlePreviewPrompts("restyle", 10)}
                        className="flex-1 bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        <Eye className="h-4 w-4 mr-1" /> 10
                      </Button>
                      <Button
                        onClick={() => handlePreviewPrompts("restyle", 20)}
                        className="flex-1 bg-gradient-to-r from-pink-600 to-fuchsia-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        <Eye className="h-4 w-4 mr-1" /> 20
                      </Button>
                    </div>
                    <p className="text-[9px] text-zinc-600 text-center font-semibold uppercase tracking-wider pt-1">AI Generated - Brand New</p>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => handleGenerateOnly("restyle", 5)}
                        disabled={generating}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-1" /> 5</>}
                      </Button>
                      <Button
                        onClick={() => handleGenerateOnly("restyle", 10)}
                        disabled={generating}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-1" /> 10</>}
                      </Button>
                      <Button
                        onClick={() => handleGenerateOnly("restyle", 20)}
                        disabled={generating}
                        className="flex-1 bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 h-11 text-sm font-bold"
                      >
                        {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Zap className="h-4 w-4 mr-1" /> 20</>}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* MyVehiclePro Deploy to Real Photos */}
                <Card className="bg-zinc-950 border-cyan-500/30 hover:border-cyan-500/50 transition-colors">
                  <CardHeader className="text-center pb-3">
                    <div className="p-3 rounded-lg bg-gradient-to-r from-cyan-500 to-teal-600 w-fit mx-auto mb-3">
                      <Camera className="h-8 w-8 text-white" />
                    </div>
                    <CardTitle className="text-lg">MyVehiclePro&trade; Deploy</CardTitle>
                    <CardDescription className="text-xs">
                      Apply past designs to real vehicle photos
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Design Selector */}
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { if (deployDesigns.length === 0) handleLoadDeployDesigns(); }}
                          className="w-full border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10 text-xs justify-between"
                        >
                          <span>Select Designs ({selectedDeployDesignIds.length} selected)</span>
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        {deployDesignsLoading ? (
                          <div className="py-4 text-center">
                            <Loader2 className="h-5 w-5 animate-spin mx-auto text-cyan-400" />
                            <p className="text-[10px] text-zinc-500 mt-1">Loading past designs...</p>
                          </div>
                        ) : deployDesigns.length === 0 ? (
                          <p className="text-[10px] text-zinc-500 text-center py-3">
                            No batch designs found. Run a batch first.
                          </p>
                        ) : (
                          <div className="grid grid-cols-4 gap-1.5 mt-2 max-h-[200px] overflow-y-auto p-1">
                            {deployDesigns.slice(0, 40).map((d) => {
                              const isSelected = selectedDeployDesignIds.includes(d.id);
                              return (
                                <button
                                  key={d.id}
                                  onClick={() => handleToggleDeployDesign(d.id)}
                                  className={cn(
                                    "relative rounded-lg overflow-hidden border-2 transition-all",
                                    isSelected ? "border-cyan-500 ring-1 ring-cyan-500/50" : "border-zinc-700 hover:border-zinc-500"
                                  )}
                                >
                                  {d.renderUrl && (
                                    <img src={d.renderUrl} alt={d.colorName} className="w-full aspect-video object-cover" />
                                  )}
                                  {isSelected && (
                                    <div className="absolute top-0.5 right-0.5 w-4 h-4 bg-cyan-500 rounded-full flex items-center justify-center">
                                      <CheckCircle2 className="h-3 w-3 text-white" />
                                    </div>
                                  )}
                                  <p className="text-[7px] text-zinc-400 p-0.5 truncate">{d.colorName}</p>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        {deployDesigns.length > 0 && (
                          <div className="flex gap-2 mt-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedDeployDesignIds(deployDesigns.slice(0, 10).map((d) => d.id))}
                              className="text-[9px] h-6 px-2 text-cyan-400"
                            >
                              Top 10
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedDeployDesignIds(deployDesigns.slice(0, 20).map((d) => d.id))}
                              className="text-[9px] h-6 px-2 text-cyan-400"
                            >
                              Top 20
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setSelectedDeployDesignIds([])}
                              className="text-[9px] h-6 px-2 text-zinc-500"
                            >
                              Clear
                            </Button>
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Photo Selector */}
                    <Collapsible>
                      <CollapsibleTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/10 text-xs justify-between"
                        >
                          <span>Select Photos ({selectedDeployPhotoIds.length}/{STOCK_VEHICLE_PHOTOS.length})</span>
                          <ChevronDown className="h-3 w-3" />
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <div className="space-y-1 mt-2 max-h-[200px] overflow-y-auto">
                          {STOCK_VEHICLE_PHOTOS.map((photo) => {
                            const isSelected = selectedDeployPhotoIds.includes(photo.id);
                            return (
                              <button
                                key={photo.id}
                                onClick={() => handleToggleDeployPhoto(photo.id)}
                                className={cn(
                                  "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left transition-all border",
                                  isSelected
                                    ? "border-cyan-500/50 bg-cyan-500/10"
                                    : "border-transparent hover:bg-zinc-800"
                                )}
                              >
                                <div className={cn(
                                  "w-3.5 h-3.5 rounded border flex-shrink-0 flex items-center justify-center",
                                  isSelected ? "bg-cyan-500 border-cyan-500" : "border-zinc-600"
                                )}>
                                  {isSelected && <CheckCircle2 className="h-2.5 w-2.5 text-white" />}
                                </div>
                                <Car className="h-3 w-3 text-zinc-500 flex-shrink-0" />
                                <span className="text-[10px] text-zinc-300 truncate">{photo.label}</span>
                                <Badge variant="outline" className="text-[7px] border-zinc-700 text-zinc-500 ml-auto flex-shrink-0">
                                  {photo.bodyStyle}
                                </Badge>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-2 mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedDeployPhotoIds(STOCK_VEHICLE_PHOTOS.map((p) => p.id))}
                            className="text-[9px] h-6 px-2 text-cyan-400"
                          >
                            Select All
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedDeployPhotoIds([])}
                            className="text-[9px] h-6 px-2 text-zinc-500"
                          >
                            Clear
                          </Button>
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Summary */}
                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-cyan-400">{selectedDeployDesignIds.length}</p>
                        <p className="text-[9px] text-zinc-500">Designs</p>
                      </div>
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-cyan-400">{selectedDeployPhotoIds.length}</p>
                        <p className="text-[9px] text-zinc-500">Photos</p>
                      </div>
                      <div className="bg-zinc-900 rounded-lg p-2 border border-zinc-800">
                        <p className="text-sm font-bold text-amber-400">
                          ~${(selectedDeployDesignIds.length * selectedDeployPhotoIds.length * COST_PER_RENDER).toFixed(2)}
                        </p>
                        <p className="text-[9px] text-zinc-500">Est. Cost</p>
                      </div>
                    </div>

                    <p className="text-[10px] text-zinc-500 text-center">
                      {selectedDeployDesignIds.length} designs &times; {selectedDeployPhotoIds.length} photos = {selectedDeployDesignIds.length * selectedDeployPhotoIds.length} total deploys
                    </p>

                    <Button
                      onClick={handleStartDeploy}
                      disabled={selectedDeployDesignIds.length === 0 || selectedDeployPhotoIds.length === 0}
                      className="w-full bg-gradient-to-r from-cyan-600 to-teal-600 hover:opacity-90 h-11 text-sm font-bold disabled:opacity-30"
                    >
                      <Play className="h-4 w-4 mr-2" /> Launch Deploy Pipeline
                    </Button>
                  </CardContent>
                </Card>

              </div>
            </TabsContent>

            {/* Custom Batch Tab */}
            <TabsContent value="custom" className="mt-4">
              <ConfigPanel
                vehicles={vehicles}
                onAddVehicle={addVehicle}
                onRemoveVehicle={removeVehicle}
                onUpdateVehicle={updateVehicle}
                selectedTools={selectedTools}
                onToggleTool={toggleTool}
                customPrompt={customPrompt}
                onPromptChange={setCustomPrompt}
                promptCategory={promptCategory}
                onPromptCategoryChange={setPromptCategory}
                quantityPerCombo={quantityPerCombo}
                onQuantityChange={setQuantityPerCombo}
                concurrencyLimit={concurrencyLimit}
                onConcurrencyChange={setConcurrencyLimit}
              />
              <div className="text-center">
                <Button
                  onClick={handleStartCustom}
                  disabled={vehicles.length === 0 || selectedTools.length === 0}
                  className="bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90 h-12 px-8 text-base font-bold"
                >
                  <Play className="h-5 w-5 mr-2" /> Launch Custom Batch
                </Button>
              </div>
            </TabsContent>

            {/* Single Prompt → CreatorMarket Tab */}
            <TabsContent value="single" className="mt-4">
              <Card className="bg-zinc-950 border-fuchsia-500/30">
                <CardContent className="p-5 space-y-5">
                  <div className="flex items-center gap-2">
                    <Wand2 className="h-5 w-5 text-fuchsia-400" />
                    <h3 className="text-lg font-bold text-zinc-100">Single Prompt → CreatorMarket</h3>
                    <Badge className="bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30 text-[10px]">
                      ReStyle pipeline · 7 views + proof
                    </Badge>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Type a prompt or pick one from the ReStyle library, render the full 7-view set,
                    then publish straight to CreatorMarket. Useful for reverse-engineering what panel
                    files come out of any prompt without editing the locked render pipeline.
                  </p>

                  <div className="space-y-2">
                    <Label className="text-[11px] uppercase tracking-wider text-zinc-400">
                      Pick from ReStyle library ({restyleLibrary.length} prompts)
                    </Label>
                    <Select onValueChange={applyPresetToSingleForm}>
                      <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-200 text-sm">
                        <SelectValue placeholder="Optional — auto-fill from a preset" />
                      </SelectTrigger>
                      <SelectContent className="bg-zinc-900 border-zinc-700 max-h-72">
                        {restyleLibrary.map((p) => (
                          <SelectItem key={p.id} value={p.id} className="text-xs">
                            {p.name || p.id} · {p.subcategory}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wider text-zinc-400">Design name</Label>
                      <Input
                        value={singlePromptName}
                        onChange={(e) => setSinglePromptName(e.target.value)}
                        placeholder="e.g. Iron Suit Mark"
                        className="bg-zinc-900 border-zinc-700 text-zinc-100"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wider text-zinc-400">Finish</Label>
                      <Select value={singleFinish} onValueChange={(v) => setSingleFinish(v as any)}>
                        <SelectTrigger className="bg-zinc-900 border-zinc-700 text-zinc-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700">
                          <SelectItem value="Gloss">Gloss</SelectItem>
                          <SelectItem value="Satin">Satin</SelectItem>
                          <SelectItem value="Matte">Matte</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wider text-zinc-400">Year</Label>
                      <Input
                        value={singleVehicleYear}
                        onChange={(e) => setSingleVehicleYear(e.target.value)}
                        placeholder="2024"
                        className="bg-zinc-900 border-zinc-700 text-zinc-100"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wider text-zinc-400">Make</Label>
                      <Input
                        value={singleVehicleMake}
                        onChange={(e) => setSingleVehicleMake(e.target.value)}
                        placeholder="Porsche"
                        className="bg-zinc-900 border-zinc-700 text-zinc-100"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] uppercase tracking-wider text-zinc-400">Model</Label>
                      <Input
                        value={singleVehicleModel}
                        onChange={(e) => setSingleVehicleModel(e.target.value)}
                        placeholder="911 GT3"
                        className="bg-zinc-900 border-zinc-700 text-zinc-100"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-[11px] uppercase tracking-wider text-zinc-400">Prompt</Label>
                    <Textarea
                      value={singlePromptText}
                      onChange={(e) => setSinglePromptText(e.target.value)}
                      placeholder="Describe the wrap. Long, descriptive prompts work best — see the library for examples."
                      className="bg-zinc-900 border-zinc-700 text-zinc-100 min-h-[160px] text-sm"
                    />
                    <p className="text-[10px] text-zinc-500">
                      {singlePromptText.length} chars — the locked pipeline trims at the edge function.
                    </p>
                  </div>

                  <div className="flex items-center justify-end gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setSinglePromptText("");
                        setSinglePromptName("");
                      }}
                      className="border-zinc-700 text-zinc-300 h-10"
                    >
                      Clear
                    </Button>
                    <Button
                      onClick={handleLaunchSinglePrompt}
                      disabled={restyleRunning}
                      className="bg-gradient-to-r from-fuchsia-600 to-pink-600 hover:opacity-90 h-10 px-6 text-sm font-bold"
                    >
                      <Play className="h-4 w-4 mr-2" />
                      {restyleRunning ? "ReStyle pipeline busy…" : "Render this prompt"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Catalog Swatches Tab */}
            <TabsContent value="catalog" className="mt-4">
              <div className="space-y-4">
                <Card className="bg-zinc-950 border-emerald-500/30">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Palette className="h-5 w-5 text-emerald-400" />
                      Catalog Swatch Generator
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Renders every color in a manufacturer&rsquo;s catalog as a hood-detail shot, square-cropped with color name + product code watermark. One render per color (~$0.08 each).
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Limit option */}
                    <div className="flex items-center gap-3">
                      <Label className="text-xs text-zinc-400 whitespace-nowrap">Limit:</Label>
                      <div className="flex gap-2">
                        {[0, 5, 10, 25, 50].map((n) => (
                          <Button
                            key={n}
                            size="sm"
                            variant={catalogLimit === n ? "default" : "outline"}
                            className={cn("text-xs h-7 px-3", catalogLimit === n && "bg-emerald-600 hover:bg-emerald-700")}
                            onClick={() => setCatalogLimit(n)}
                          >
                            {n === 0 ? "All" : n}
                          </Button>
                        ))}
                      </div>
                      <span className="text-[10px] text-zinc-500">{catalogLimit === 0 ? "Renders every color in catalog" : `First ${catalogLimit} colors only (test run)`}</span>
                    </div>

                    {/* Manufacturer grid */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {Object.entries(MANUFACTURER_VEHICLES).map(([mfr, vehicle]) => (
                        <Card key={mfr} className="bg-zinc-900 border-zinc-700 hover:border-emerald-500/40 transition-colors">
                          <CardContent className="p-4 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-sm text-white">{mfr}</span>
                              <Badge variant="outline" className="text-[9px] border-zinc-600">
                                {vehicle.make} {vehicle.model}
                              </Badge>
                            </div>
                            <p className="text-[10px] text-zinc-500">
                              {vehicle.year} {vehicle.make} {vehicle.model} &bull; hood_detail &bull; square crop
                            </p>
                            <Button
                              onClick={() => handleStartCatalogBatch(mfr)}
                              disabled={running || catalogRunning}
                              size="sm"
                              variant="outline"
                              className="w-full border-emerald-600/50 hover:bg-emerald-900/30 text-xs h-8 font-semibold"
                            >
                              <Play className="h-3 w-3 mr-1.5" />
                              Generate {mfr} Catalog
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>

                    {/* Catalog progress */}
                    {catalogRunning && (
                      <Card className="bg-zinc-900 border-emerald-500/30">
                        <CardContent className="p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-emerald-400">
                              {catalogStats.manufacturer} Catalog
                            </span>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => catalogPaused ? resumeCatalog() : pauseCatalog()}
                              >
                                {catalogPaused ? <Play className="h-3 w-3 mr-1" /> : <Pause className="h-3 w-3 mr-1" />}
                                {catalogPaused ? "Resume" : "Pause"}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs border-red-500/30 hover:bg-red-900/30"
                                onClick={stopCatalog}
                              >
                                <Square className="h-3 w-3 mr-1" /> Stop
                              </Button>
                            </div>
                          </div>
                          <Progress
                            value={catalogStats.total > 0 ? ((catalogStats.done + catalogStats.failed) / catalogStats.total) * 100 : 0}
                            className="h-2"
                          />
                          <div className="flex gap-4 text-xs text-zinc-400">
                            <span className="text-emerald-400">{catalogStats.done} done</span>
                            <span className="text-red-400">{catalogStats.failed} failed</span>
                            <span>{catalogStats.total - catalogStats.done - catalogStats.failed} remaining</span>
                            <span className="text-zinc-500">#{catalogIdx + 1} / {catalogStats.total}</span>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Catalog results grid */}
                    {catalogJobs.length > 0 && (
                      <div>
                        <h3 className="text-sm font-bold mb-2 text-zinc-300">Results ({catalogStats.done} / {catalogStats.total})</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                          {catalogJobs.map((job) => (
                            <div key={job.id} className="relative aspect-square rounded-lg overflow-hidden border border-zinc-700 bg-zinc-900">
                              {job.renderUrl ? (
                                <img
                                  src={job.renderUrl}
                                  alt={job.color.official_name}
                                  className="w-full h-full object-cover"
                                />
                              ) : job.status === "failed" ? (
                                <div className="flex items-center justify-center h-full">
                                  <XCircle className="h-5 w-5 text-red-500" />
                                </div>
                              ) : job.status === "rendering" || job.status === "cropping" ? (
                                <div className="flex items-center justify-center h-full">
                                  <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
                                </div>
                              ) : (
                                <div className="flex items-center justify-center h-full" style={{ backgroundColor: job.color.official_hex }}>
                                  <span className="text-[8px] text-white/50">queued</span>
                                </div>
                              )}
                              <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1.5 py-1">
                                <p className="text-[9px] text-white font-semibold truncate">{job.color.official_name}</p>
                                <p className="text-[8px] text-zinc-400 truncate">{job.color.product_code}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* Batch History Tab */}
            <TabsContent value="history" className="mt-4">
              <div className="space-y-3">
                {historyLoading && (
                  <div className="text-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-zinc-500" />
                    <p className="text-xs text-zinc-500 mt-2">Loading batch history...</p>
                  </div>
                )}
                {!historyLoading && (!batchHistory || batchHistory.length === 0) && (
                  <Card className="bg-zinc-900 border-zinc-800 p-8 text-center">
                    <History className="h-12 w-12 mx-auto mb-3 text-zinc-700" />
                    <h3 className="text-lg font-bold text-zinc-400 mb-1">No Batch History</h3>
                    <p className="text-xs text-zinc-600">
                      Run your first batch to see results here
                    </p>
                  </Card>
                )}
                {batchHistory && batchHistory.map((entry) => (
                  <BatchHistoryCard
                    key={entry.batch_id}
                    entry={entry}
                    onViewResults={(id) => navigate(`/admin/batch-results?batch=${id}`)}
                  />
                ))}
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* Live Progress Dashboard */}
        {jobs.length > 0 && (
          <Card className="mb-6 bg-gradient-to-br from-zinc-900 via-zinc-900 to-blue-950/20 border-blue-500/20">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {running ? (
                    paused ? (
                      <Pause className="h-7 w-7 text-amber-400" />
                    ) : (
                      <Loader2 className="h-7 w-7 text-blue-400 animate-spin" />
                    )
                  ) : phase === "complete" ? (
                    <CheckCircle2 className="h-7 w-7 text-green-400" />
                  ) : (
                    <Clock className="h-7 w-7 text-zinc-500" />
                  )}
                  <div>
                    <h3 className="text-sm font-bold">
                      {phase === "idle" && "Ready to Launch"}
                      {phase === "rendering" && !paused && `Rendering ${currentIdx + 1} of ${stats.total}...`}
                      {phase === "rendering" && paused && "Pipeline Paused"}
                      {phase === "views" && !paused && `Generating Views - Render ${currentIdx + 1} of ${stats.total}...`}
                      {phase === "views" && paused && "Pipeline Paused (Views Phase)"}
                      {phase === "complete" && "Pipeline Complete"}
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      {stats.done} renders &middot; {stats.totalViews} views &middot; {stats.totalProofs} proofs &middot; {stats.failed} failed
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {/* Running stats */}
                  <div className="text-right space-y-0.5">
                    <div className="flex items-center gap-2 text-[10px]">
                      <Clock className="h-3 w-3 text-zinc-500" />
                      <span className="text-zinc-400">{formatTime(elapsedSeconds)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-zinc-600">Est. Cost:</span>
                      <span className="text-amber-400 font-bold">${runningCostEstimate.toFixed(2)}</span>
                    </div>
                  </div>
                  {phase === "complete" && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        const completed = jobs.filter(j => j.renderUrl);
                        if (!completed.length) { toast.error("No renders to download"); return; }
                        toast.info(`Downloading ${completed.length} renders...`);
                        for (const job of completed) {
                          try {
                            const res = await fetch(job.renderUrl!);
                            const blob = await res.blob();
                            const a = document.createElement("a");
                            a.href = URL.createObjectURL(blob);
                            a.download = `${job.designName || job.id}.png`;
                            document.body.appendChild(a);
                            a.click();
                            document.body.removeChild(a);
                            URL.revokeObjectURL(a.href);
                            await new Promise(r => setTimeout(r, 300));
                          } catch { /* skip failed downloads */ }
                        }
                        toast.success(`Downloaded ${completed.length} renders`);
                      }}
                      className="bg-cyan-600 hover:bg-cyan-700 text-xs"
                    >
                      <Download className="h-3.5 w-3.5 mr-1.5" /> Download All ({jobs.filter(j => j.renderUrl).length})
                    </Button>
                  )}
                  {phase === "complete" && batchId && (
                    <Button
                      size="sm"
                      onClick={() => navigate(`/admin/batch-results?batch=${batchId}`)}
                      className="bg-green-600 hover:bg-green-700 text-xs"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Review & Rate Results
                    </Button>
                  )}
                </div>
              </div>

              {/* Overall progress bar */}
              <div className="mb-4">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-zinc-400">Overall Pipeline Progress</span>
                  <span className="text-zinc-500">{Math.round(overallProgress)}%</span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-700",
                      paused
                        ? "bg-amber-500"
                        : "bg-gradient-to-r from-blue-500 via-purple-500 to-amber-500"
                    )}
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </div>

              {/* Per-tool mini stats */}
              <div className="grid grid-cols-5 gap-3">
                {(Object.keys(TOOL_LABELS) as ToolType[]).map((tool) => {
                  const ts = stats.byTool[tool];
                  if (!ts) return null;
                  const pct = ts.total > 0 ? ((ts.done + ts.failed) / ts.total) * 100 : 0;
                  return (
                    <div key={tool} className="bg-zinc-800/50 rounded-lg p-2.5">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={cn("w-2 h-2 rounded-full bg-gradient-to-r", TOOL_COLORS[tool])} />
                        <span className="text-[10px] font-bold text-zinc-300 truncate">
                          {TOOL_LABELS[tool]}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px]">
                        <span className="text-green-400 font-bold">{ts.done}</span>
                        <span className="text-zinc-600">/</span>
                        <span className="text-zinc-400">{ts.total}</span>
                        {ts.views > 0 && (
                          <span className="text-purple-400 ml-auto">
                            <ImageIcon className="h-2.5 w-2.5 inline mr-0.5" />{ts.views}
                          </span>
                        )}
                      </div>
                      <Progress value={pct} className="h-0.5 mt-1" />
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ReStyle Live Progress Dashboard */}
        {restyleJobs.length > 0 && (
          <Card className="mb-6 bg-gradient-to-br from-zinc-900 via-zinc-900 to-pink-950/20 border-pink-500/20">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {restyleRunning ? (
                    restylePaused ? (
                      <Pause className="h-7 w-7 text-amber-400" />
                    ) : (
                      <Loader2 className="h-7 w-7 text-pink-400 animate-spin" />
                    )
                  ) : restylePhase === "complete" ? (
                    <CheckCircle2 className="h-7 w-7 text-green-400" />
                  ) : (
                    <Clock className="h-7 w-7 text-zinc-500" />
                  )}
                  <div>
                    <h3 className="text-sm font-bold">
                      {restylePhase === "idle" && "ReStyle Ready"}
                      {restylePhase === "rendering" && !restylePaused && `ReStyle Rendering ${restyleIdx + 1} of ${restyleStats.total}...`}
                      {restylePhase === "rendering" && restylePaused && "ReStyle Pipeline Paused"}
                      {restylePhase === "views" && !restylePaused && `ReStyle Views - Render ${restyleIdx + 1} of ${restyleStats.total}...`}
                      {restylePhase === "views" && restylePaused && "ReStyle Pipeline Paused (Views Phase)"}
                      {restylePhase === "complete" && "ReStyle Pipeline Complete"}
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      {restyleStats.done} renders &middot; {restyleStats.totalViews} views &middot; {restyleStats.totalProofs} proofs &middot; {restyleStats.failed} failed
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right space-y-0.5">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-zinc-600">Est. Cost:</span>
                      <span className="text-amber-400 font-bold">
                        ${((restyleStats.done * COST_PER_RENDER) + (restyleStats.totalViews * COST_PER_VIEW)).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  {restylePhase === "complete" && restyleBatchId && (
                    <Button
                      size="sm"
                      onClick={() => navigate(`/admin/batch-results?batch=${restyleBatchId}`)}
                      className="bg-pink-600 hover:bg-pink-700 text-xs"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Review ReStyle Results
                    </Button>
                  )}
                </div>
              </div>

              {/* Overall progress */}
              <div className="mb-4">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-zinc-400">ReStyle Pipeline Progress</span>
                  <span className="text-zinc-500">
                    {restyleStats.total > 0
                      ? Math.round(((restyleStats.done + restyleStats.failed) / restyleStats.total) * 100)
                      : 0}%
                  </span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-700",
                      restylePaused
                        ? "bg-amber-500"
                        : "bg-gradient-to-r from-pink-500 via-fuchsia-500 to-purple-500"
                    )}
                    style={{
                      width: `${restyleStats.total > 0 ? ((restyleStats.done + restyleStats.failed) / restyleStats.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              {/* Per-subcategory mini stats */}
              {restyleStats.subcategories.length > 0 && (
                <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
                  {restyleStats.subcategories.map((sub) => {
                    const ss = restyleStats.bySubcategory[sub];
                    if (!ss) return null;
                    const pct = ss.total > 0 ? ((ss.done + ss.failed) / ss.total) * 100 : 0;
                    return (
                      <div key={sub} className="bg-zinc-800/50 rounded-lg p-2">
                        <div className="flex items-center gap-1 mb-1">
                          <div className="w-2 h-2 rounded-full bg-gradient-to-r from-pink-500 to-fuchsia-500" />
                          <span className="text-[9px] font-bold text-zinc-300 truncate">{sub}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px]">
                          <span className="text-green-400 font-bold">{ss.done}</span>
                          <span className="text-zinc-600">/</span>
                          <span className="text-zinc-400">{ss.total}</span>
                        </div>
                        <Progress value={pct} className="h-0.5 mt-1" />
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ReStyle Job List */}
              <div className="mt-4 space-y-2 max-h-[500px] overflow-y-auto">
                {restyleJobs.map((job) => (
                  <Card
                    key={job.id}
                    className={cn(
                      "bg-zinc-900 border-zinc-800 overflow-hidden",
                      job.status === "failed" && "border-red-500/30",
                      job.status === "rendering" && "border-pink-500/40",
                      job.status === "views" && "border-purple-500/40",
                      job.status === "done" && Object.keys(job.views).length > 0 && "border-green-500/20",
                    )}
                  >
                    <div className="flex gap-3 p-3">
                      <div className="w-28 flex-shrink-0">
                        {job.renderUrl ? (
                          <div className="relative rounded-lg overflow-hidden border border-zinc-700">
                            <img
                              src={job.renderUrl}
                              alt={`${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`}
                              className="w-full aspect-video object-cover"
                            />
                          </div>
                        ) : (
                          <div className="w-full aspect-video bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-700">
                            {job.status === "rendering" && <Loader2 className="h-5 w-5 text-pink-400 animate-spin" />}
                            {job.status === "queued" && <Clock className="h-5 w-5 text-zinc-600" />}
                            {job.status === "failed" && <XCircle className="h-5 w-5 text-red-400" />}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-pink-300 truncate">{job.designName}</h4>
                          <Badge variant="outline" className="border-zinc-600 text-[9px] flex-shrink-0">{job.finish}</Badge>
                          <StatusBadge status={job.status} />
                        </div>
                        <p className="text-[10px] text-zinc-300 font-medium">
                          {job.vehicle.year} {job.vehicle.make} {job.vehicle.model}
                        </p>
                        <p className="text-[10px] text-zinc-500 line-clamp-2 leading-relaxed">{job.prompt}</p>
                        {job.error && <p className="text-[10px] text-red-400 break-words">{job.error}</p>}
                        {job.status === "views" && (
                          <div className="mt-1">
                            <Progress value={(job.viewsProgress / 7) * 100} className="h-1" />
                            <p className="text-[9px] text-zinc-500 mt-0.5">
                              View {Math.min(job.viewsProgress + 1, 7)} of 7
                            </p>
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex flex-col items-end gap-1">
                        {Object.keys(job.views).length > 0 && (
                          <div className="flex items-center gap-1 text-[10px] text-green-400">
                            <Camera className="h-3 w-3" />
                            <span className="font-bold">{Object.keys(job.views).length}/7</span>
                          </div>
                        )}
                        {job.proofUrl && (
                          <a
                            href={job.proofUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/40 transition-colors border border-green-500/20"
                          >
                            <FileText className="h-2.5 w-2.5" /> Proof
                          </a>
                        )}
                        {job.renderUrl && job.status === "done" && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            <button
                              onClick={async () => {
                                const heroUrl = job.renderUrl || job.views?.side || Object.values(job.views)[0];
                                if (!heroUrl) return;
                                const { data } = await supabase.from('color_visualizations').select('id').contains('render_urls', { hero: heroUrl }).limit(1).maybeSingle();
                                const found = data?.id || (await supabase.from('color_visualizations').select('id').contains('render_urls', { side: heroUrl }).limit(1).maybeSingle()).data?.id;
                                if (found) navigate(`/colorpro?renderId=${found}`);
                                else toast.error('Could not find render in database');
                              }}
                              className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-cyan-600/20 text-cyan-400 hover:bg-cyan-600/40 transition-colors border border-cyan-500/20"
                            >
                              <Palette className="h-2.5 w-2.5" /> View in ColorPro
                            </button>
                            <button
                              onClick={async () => {
                                const heroUrl = job.renderUrl || job.views?.side || Object.values(job.views)[0];
                                if (!heroUrl) { toast.error('No render image'); return; }
                                const vehicleName = `${job.vehicle.year} ${job.vehicle.make} ${job.vehicle.model}`;
                                const title = job.designName || 'Batch Render';
                                const { error } = await supabase.from('inkfusion_carousel').insert({
                                  media_url: heroUrl, title, name: title,
                                  subtitle: `${job.finish || 'Gloss'} \u2022 ${vehicleName}`,
                                  vehicle_name: vehicleName, color_name: job.designName, is_active: true,
                                });
                                if (error) { toast.error('Failed to send to gallery'); console.error(error); }
                                else { toast.success('Sent to gallery!'); }
                              }}
                              className="inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/40 transition-colors border border-emerald-500/20"
                            >
                              <ImageIcon className="h-2.5 w-2.5" /> Send to Gallery
                            </button>
                            <button
                              onClick={() => publishToCreatorMarket(job)}
                              disabled={publishingJobId === job.id}
                              className={cn(
                                "inline-flex items-center gap-1 text-[9px] px-2 py-1 rounded border transition-colors",
                                "bg-fuchsia-600/20 text-fuchsia-300 border-fuchsia-500/30 hover:bg-fuchsia-600/40",
                                "disabled:opacity-50 disabled:cursor-wait",
                              )}
                            >
                              {publishingJobId === job.id ? (
                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                              ) : (
                                <Store className="h-2.5 w-2.5" />
                              )}
                              {publishingJobId === job.id ? "Publishing…" : "Publish to CM"}
                            </button>
                          </div>
                        )}
                        {job.durationMs != null && (
                          <span className="text-[9px] text-zinc-500">{(job.durationMs / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Deploy Live Progress Dashboard */}
        {deployJobs.length > 0 && (
          <Card className="mb-6 bg-gradient-to-br from-zinc-900 via-zinc-900 to-cyan-950/20 border-cyan-500/20">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {deployRunning ? (
                    deployPaused ? (
                      <Pause className="h-7 w-7 text-amber-400" />
                    ) : (
                      <Loader2 className="h-7 w-7 text-cyan-400 animate-spin" />
                    )
                  ) : deployPhase === "complete" ? (
                    <CheckCircle2 className="h-7 w-7 text-green-400" />
                  ) : (
                    <Clock className="h-7 w-7 text-zinc-500" />
                  )}
                  <div>
                    <h3 className="text-sm font-bold">
                      {deployPhase === "idle" && "Deploy Ready"}
                      {deployPhase === "rendering" && !deployPaused && `Deploying ${deployIdx + 1} of ${deployStats.total}...`}
                      {deployPhase === "rendering" && deployPaused && "Deploy Pipeline Paused"}
                      {deployPhase === "complete" && "Deploy Pipeline Complete"}
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      {deployStats.done} done &middot; {deployStats.failed} failed &middot; {deployStats.uniqueDesigns} designs &times; {deployStats.uniquePhotos} photos
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right space-y-0.5">
                    <div className="flex items-center gap-2 text-[10px]">
                      <span className="text-zinc-600">Est. Cost:</span>
                      <span className="text-amber-400 font-bold">
                        ${(deployStats.done * COST_PER_RENDER).toFixed(2)}
                      </span>
                    </div>
                  </div>
                  {deployPhase === "complete" && deployBatchId && (
                    <Button
                      size="sm"
                      onClick={() => navigate(`/admin/batch-results?batch=${deployBatchId}`)}
                      className="bg-cyan-600 hover:bg-cyan-700 text-xs"
                    >
                      <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Review Deploys
                    </Button>
                  )}
                </div>
              </div>

              {/* Overall progress */}
              <div className="mb-4">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-zinc-400">Deploy Pipeline Progress</span>
                  <span className="text-zinc-500">
                    {deployStats.total > 0
                      ? Math.round(((deployStats.done + deployStats.failed) / deployStats.total) * 100)
                      : 0}%
                  </span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-700",
                      deployPaused
                        ? "bg-amber-500"
                        : "bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-500"
                    )}
                    style={{
                      width: `${deployStats.total > 0 ? ((deployStats.done + deployStats.failed) / deployStats.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              {/* Deploy Job List */}
              <div className="space-y-2 max-h-[500px] overflow-y-auto">
                {deployJobs.map((job) => (
                  <Card
                    key={job.id}
                    className={cn(
                      "bg-zinc-900 border-zinc-800 overflow-hidden",
                      job.status === "failed" && "border-red-500/30",
                      job.status === "rendering" && "border-cyan-500/40",
                      job.status === "done" && "border-green-500/20",
                    )}
                  >
                    <div className="flex gap-3 p-3">
                      {/* Source design thumbnail */}
                      <div className="w-20 flex-shrink-0">
                        {job.source.renderUrl ? (
                          <div className="relative rounded-lg overflow-hidden border border-zinc-700">
                            <img
                              src={job.source.renderUrl}
                              alt={job.source.colorName}
                              className="w-full aspect-square object-cover"
                            />
                            <span className="absolute bottom-0 left-0 right-0 bg-black/80 text-[7px] text-center py-0.5 text-zinc-400">
                              Source
                            </span>
                          </div>
                        ) : (
                          <div className="w-full aspect-square bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-700">
                            <ImageIcon className="h-4 w-4 text-zinc-600" />
                          </div>
                        )}
                      </div>

                      {/* Arrow */}
                      <div className="flex items-center flex-shrink-0">
                        <ChevronRight className="h-4 w-4 text-cyan-400" />
                      </div>

                      {/* Result */}
                      <div className="w-20 flex-shrink-0">
                        {job.renderUrl ? (
                          <div className="relative rounded-lg overflow-hidden border border-green-500/30">
                            <img
                              src={job.renderUrl}
                              alt="Deploy result"
                              className="w-full aspect-square object-cover"
                            />
                            <span className="absolute bottom-0 left-0 right-0 bg-black/80 text-[7px] text-center py-0.5 text-green-400">
                              Result
                            </span>
                          </div>
                        ) : (
                          <div className="w-full aspect-square bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-700">
                            {job.status === "rendering" && <Loader2 className="h-4 w-4 text-cyan-400 animate-spin" />}
                            {job.status === "queued" && <Clock className="h-4 w-4 text-zinc-600" />}
                            {job.status === "failed" && <XCircle className="h-4 w-4 text-red-400" />}
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold text-cyan-300 truncate">{job.source.colorName}</h4>
                          <StatusBadge status={job.status} />
                        </div>
                        <p className="text-[10px] text-zinc-300 font-medium">
                          <Car className="h-3 w-3 inline mr-1" />
                          {job.vehiclePhoto.label}
                        </p>
                        {job.error && <p className="text-[10px] text-red-400 break-words">{job.error}</p>}
                        {job.durationMs != null && (
                          <span className="text-[9px] text-zinc-500">{(job.durationMs / 1000).toFixed(1)}s</span>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Tool Sections - running/completed jobs */}
        {jobs.length > 0 && (
          <div className="space-y-4">
            {(Object.keys(TOOL_LABELS) as ToolType[]).map((tool) => (
              <ToolSection
                key={tool}
                tool={tool}
                jobs={jobs}
                toolStats={stats.byTool[tool] || { total: 0, done: 0, failed: 0, views: 0 }}
              />
            ))}
          </div>
        )}

        {/* Auto-Revision Pipeline */}
        <Card className="mt-6 bg-zinc-950 border-purple-500/20">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500">
                  <Zap className="h-5 w-5 text-white" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Auto-Revision Pipeline</h3>
                  <p className="text-[10px] text-zinc-500">
                    Scans for batch renders rated ≤2 stars and auto-re-renders with quality improvements
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {revisionRunning ? (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={stopAutoRevision}
                    className="h-8 text-xs"
                  >
                    <Square className="h-3 w-3 mr-1" /> Stop
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={async () => {
                      const result = await startAutoRevision();
                      if (result) toast.info(result.message);
                    }}
                    className="h-8 text-xs bg-gradient-to-r from-purple-600 to-pink-600 hover:opacity-90"
                  >
                    <Play className="h-3 w-3 mr-1" /> Scan & Auto-Fix
                  </Button>
                )}
              </div>
            </div>

            {revisionJobs.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-4 text-[10px] text-zinc-400">
                  <span>Found: {revisionStats.total}</span>
                  <span className="text-green-400">Done: {revisionStats.done}</span>
                  <span className="text-red-400">Failed: {revisionStats.failed}</span>
                  {revisionStats.rendering > 0 && (
                    <span className="text-purple-400 animate-pulse">Rendering: {revisionStats.rendering}</span>
                  )}
                </div>
                {revisionStats.total > 0 && (
                  <Progress
                    value={((revisionStats.done + revisionStats.failed) / revisionStats.total) * 100}
                    className="h-1"
                  />
                )}
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {revisionJobs.map((rj) => (
                    <div key={rj.id} className="flex items-center gap-2 text-[10px] py-1 border-b border-zinc-800/50">
                      <span className={cn(
                        "w-1.5 h-1.5 rounded-full flex-shrink-0",
                        rj.status === "done" && "bg-green-500",
                        rj.status === "failed" && "bg-red-500",
                        rj.status === "rendering" && "bg-purple-500 animate-pulse",
                        rj.status === "cloning" && "bg-yellow-500 animate-pulse",
                        rj.status === "queued" && "bg-zinc-600",
                      )} />
                      <span className="text-zinc-300 truncate flex-1">{rj.designName}</span>
                      <span className="text-zinc-600">{rj.originalRating}★</span>
                      {rj.status === "done" && rj.newRenderUrl && (
                        <a href={rj.newRenderUrl} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
                          View
                        </a>
                      )}
                      {rj.error && <span className="text-red-400 truncate max-w-[200px]">{rj.error}</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {revisionPhase === "complete" && revisionJobs.length === 0 && (
              <p className="text-[10px] text-zinc-600 text-center py-2">
                No low-rated batch renders found. Rate renders on the Admin Rate Designs page first.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          <Button
            variant="outline"
            className="border-zinc-700"
            onClick={() => navigate("/admin")}
          >
            Back to Admin
          </Button>
          <Button
            variant="outline"
            className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
            onClick={() => navigate("/admin/batch-results")}
          >
            <ExternalLink className="h-4 w-4 mr-2" /> QA &amp; Curation Studio
          </Button>
        </div>
      </main>
    </div>
  );
}
