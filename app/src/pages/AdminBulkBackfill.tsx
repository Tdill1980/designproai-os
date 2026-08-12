/**
 * Admin Bulk Backfill - Generate Missing Views Across All Renders
 *
 * Scans all color_visualizations records and identifies those missing
 * one or more of the 7 canonical views. Processes them sequentially,
 * generating only the missing views for each record.
 *
 * Uses the same generate-color-render edge function and merge strategy
 * as RevisionStudioIQ's per-record "Generate Missing Views" button.
 */

import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Play, Square, Loader2, XCircle, CheckCircle2,
  ChevronDown, Camera, AlertTriangle, Zap, ImageIcon,
  RefreshCw, BarChart3, Filter,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/* ================================================================ */
/* Canonical 7-view system                                           */
/* ================================================================ */
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

/* ================================================================ */
/* Types                                                             */
/* ================================================================ */
interface BackfillRecord {
  id: string;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  color_name: string;
  color_hex: string;
  finish_type: string;
  mode_type: string | null;
  custom_design_url: string | null;
  custom_swatch_url: string | null;
  custom_styling_prompt_key: string | null;
  render_urls: Record<string, string> | null;
  customer_email: string;
  created_at: string | null;
  existingViews: string[];
  missingViews: string[];
}

type JobStatus = "pending" | "running" | "done" | "failed" | "skipped";

interface BackfillJob {
  record: BackfillRecord;
  status: JobStatus;
  completedViews: string[];
  failedViews: string[];
  currentView: string | null;
  error: string | null;
}

/* ================================================================ */
/* Helpers                                                           */
/* ================================================================ */
function getMissingViews(renderUrls: Record<string, string> | null): string[] {
  if (!renderUrls) return [...VIEW_ORDER];
  return VIEW_ORDER.filter((k) => !renderUrls[k]);
}

function getExistingViews(renderUrls: Record<string, string> | null): string[] {
  if (!renderUrls) return [];
  return VIEW_ORDER.filter((k) => !!renderUrls[k]);
}

function buildColorDataFromRender(record: BackfillRecord): Record<string, any> {
  const modeType = record.mode_type || "";
  const base: Record<string, any> = {
    colorName: record.color_name || "Custom",
    hex: record.color_hex || "#000000",
    finish: record.finish_type || "Gloss",
  };

  if (modeType === "approvemode" && record.custom_design_url) {
    return { ...base, designUrl: record.custom_design_url };
  }
  if ((modeType === "CustomStyling" || modeType === "ColorProEnhanced") && record.custom_styling_prompt_key) {
    return { ...base, customStylingPrompt: record.custom_styling_prompt_key };
  }
  if (modeType === "GraphicsPro" && record.custom_styling_prompt_key) {
    return { ...base, customStylingPrompt: record.custom_styling_prompt_key, colorLibrary: "graphicspro" };
  }
  if ((modeType === "fadewraps" || modeType === "wbty") && record.custom_swatch_url) {
    return { ...base, patternUrl: record.custom_swatch_url };
  }
  if (modeType === "designpanelpro" && record.custom_design_url) {
    return {
      ...base,
      panelUrl: record.custom_design_url,
      panelName: record.design_file_name || record.color_name || "Custom Panel Design",
    };
  }
  return base;
}

/* ================================================================ */
/* Mode color mapping                                                */
/* ================================================================ */
const MODE_COLORS: Record<string, string> = {
  colorpro: "text-green-400 border-green-500/30",
  designpanelpro: "text-blue-400 border-blue-500/30",
  fadewraps: "text-orange-400 border-orange-500/30",
  wbty: "text-purple-400 border-purple-500/30",
  approvemode: "text-yellow-400 border-yellow-500/30",
  GraphicsPro: "text-pink-400 border-pink-500/30",
  CustomStyling: "text-blue-400 border-blue-500/30",
  ColorProEnhanced: "text-emerald-400 border-emerald-500/30",
  inkfusion: "text-indigo-400 border-indigo-500/30",
};

/* ================================================================ */
/* Main Page Component                                               */
/* ================================================================ */
export default function AdminBulkBackfill() {
  const queryClient = useQueryClient();
  const stopRef = useRef(false);

  // Filter state
  const [modeFilter, setModeFilter] = useState<string>("all");

  // Batch processing state
  const [jobs, setJobs] = useState<BackfillJob[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [currentRecordIdx, setCurrentRecordIdx] = useState(-1);
  const [totalViewsGenerated, setTotalViewsGenerated] = useState(0);
  const [totalViewsFailed, setTotalViewsFailed] = useState(0);

  // ---------------------------------------------------------------------------
  // Fetch all incomplete records
  // ---------------------------------------------------------------------------
  const { data: incompleteRecords, isLoading, refetch } = useQuery({
    queryKey: ["bulk-backfill-incomplete", modeFilter],
    queryFn: async () => {
      let query = supabase
        .from("color_visualizations")
        .select("id, vehicle_year, vehicle_make, vehicle_model, color_name, color_hex, finish_type, mode_type, custom_design_url, custom_swatch_url, custom_styling_prompt_key, render_urls, customer_email, created_at")
        .eq("generation_status", "completed")
        .order("created_at", { ascending: false });

      if (modeFilter !== "all") {
        query = query.eq("mode_type", modeFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Filter to only records with missing views
      const incomplete: BackfillRecord[] = (data || [])
        .map((r: any) => {
          const urls = r.render_urls as Record<string, string> | null;
          const missing = getMissingViews(urls);
          const existing = getExistingViews(urls);
          return {
            ...r,
            render_urls: urls,
            existingViews: existing,
            missingViews: missing,
          } as BackfillRecord;
        })
        .filter((r) => r.missingViews.length > 0);

      return incomplete;
    },
  });

  // ---------------------------------------------------------------------------
  // Compute stats
  // ---------------------------------------------------------------------------
  const records = incompleteRecords || [];
  const totalMissingViews = records.reduce((sum, r) => sum + r.missingViews.length, 0);
  const modeBreakdown = records.reduce<Record<string, { count: number; views: number }>>((acc, r) => {
    const mode = r.mode_type || "unknown";
    if (!acc[mode]) acc[mode] = { count: 0, views: 0 };
    acc[mode].count++;
    acc[mode].views += r.missingViews.length;
    return acc;
  }, {});

  // ---------------------------------------------------------------------------
  // Start bulk backfill
  // ---------------------------------------------------------------------------
  const startBackfill = useCallback(async () => {
    if (records.length === 0) {
      toast.info("No records need backfilling");
      return;
    }

    // Get current user email for render generation
    const { data: { user } } = await supabase.auth.getUser();
    const userEmail = user?.email;
    if (!userEmail) {
      toast.error("Please log in to generate renders.");
      return;
    }

    stopRef.current = false;
    setIsRunning(true);
    setCurrentRecordIdx(0);
    setTotalViewsGenerated(0);
    setTotalViewsFailed(0);

    // Initialize jobs
    const initialJobs: BackfillJob[] = records.map((r) => ({
      record: r,
      status: "pending",
      completedViews: [],
      failedViews: [],
      currentView: null,
      error: null,
    }));
    setJobs(initialJobs);

    toast.success(`Starting bulk backfill - ${records.length} records, ${totalMissingViews} views to generate`);

    let viewsGenerated = 0;
    let viewsFailed = 0;

    // Process each record sequentially
    for (let i = 0; i < initialJobs.length; i++) {
      if (stopRef.current) {
        setJobs((prev) => prev.map((j, idx) =>
          idx >= i ? { ...j, status: idx === i ? "skipped" : "pending" } : j
        ));
        break;
      }

      setCurrentRecordIdx(i);
      const job = initialJobs[i];
      const record = job.record;

      // Mark as running
      setJobs((prev) => prev.map((j, idx) =>
        idx === i ? { ...j, status: "running" } : j
      ));

      const colorData = buildColorDataFromRender(record);
      let mergedRenderUrls: Record<string, string> = { ...(record.render_urls || {}) };
      const completed: string[] = [];
      const failed: string[] = [];

      // Generate each missing view sequentially
      for (const viewType of record.missingViews) {
        if (stopRef.current) break;

        setJobs((prev) => prev.map((j, idx) =>
          idx === i ? { ...j, currentView: viewType } : j
        ));

        try {
          const { data, error } = await supabase.functions.invoke("generate-color-render", {
            body: {
              vehicleYear: String(record.vehicle_year),
              vehicleMake: record.vehicle_make,
              vehicleModel: record.vehicle_model,
              colorData,
              modeType: record.mode_type || "colorpro",
              viewType,
              userEmail,
              skipLookups: true,
            },
          });

          if (error) throw error;

          const renderUrl = data?.renderUrl;
          if (renderUrl) {
            mergedRenderUrls[viewType] = renderUrl;

            // Directly update this specific record
            await supabase
              .from("color_visualizations")
              .update({
                render_urls: mergedRenderUrls,
                updated_at: new Date().toISOString(),
              })
              .eq("id", record.id);

            completed.push(viewType);
            viewsGenerated++;
            setTotalViewsGenerated(viewsGenerated);
          } else {
            throw new Error("No renderUrl returned");
          }
        } catch (err: any) {
          console.error(`Failed ${viewType} for ${record.id}:`, err);
          failed.push(viewType);
          viewsFailed++;
          setTotalViewsFailed(viewsFailed);
        }

        // Update job state
        setJobs((prev) => prev.map((j, idx) =>
          idx === i ? { ...j, completedViews: [...completed], failedViews: [...failed] } : j
        ));
      }

      // Mark record as done or failed
      const finalStatus: JobStatus = failed.length === record.missingViews.length
        ? "failed"
        : stopRef.current
          ? "skipped"
          : "done";

      setJobs((prev) => prev.map((j, idx) =>
        idx === i
          ? {
              ...j,
              status: finalStatus,
              currentView: null,
              completedViews: [...completed],
              failedViews: [...failed],
              error: failed.length > 0 ? `${failed.length} view(s) failed` : null,
            }
          : j
      ));
    }

    setIsRunning(false);

    if (stopRef.current) {
      toast.warning("Bulk backfill stopped by user");
    } else {
      toast.success(
        `Bulk backfill complete! ${viewsGenerated} views generated${viewsFailed > 0 ? `, ${viewsFailed} failed` : ""}`
      );
    }

    // Refresh the data
    queryClient.invalidateQueries({ queryKey: ["bulk-backfill-incomplete"] });
    queryClient.invalidateQueries({ queryKey: ["revision-studio-renders"] });
  }, [records, totalMissingViews, queryClient]);

  const stopBackfill = useCallback(() => {
    stopRef.current = true;
    toast.info("Stopping after current view completes...");
  }, []);

  // ---------------------------------------------------------------------------
  // Progress calculations
  // ---------------------------------------------------------------------------
  const completedJobs = jobs.filter((j) => j.status === "done" || j.status === "failed" || j.status === "skipped").length;
  const overallProgress = jobs.length > 0 ? (completedJobs / jobs.length) * 100 : 0;
  const doneJobs = jobs.filter((j) => j.status === "done").length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-black text-white">
      <main className="max-w-[1600px] mx-auto px-6 py-8 pt-24">
        {/* ── Page Header ── */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-600">
              <Zap className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold">Bulk View Backfill</h1>
              <p className="text-zinc-400 text-sm">
                Generate missing views across all existing renders - fill gaps to complete 7-angle coverage
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="border-zinc-700"
              onClick={() => refetch()}
              disabled={isRunning}
            >
              <RefreshCw className="h-4 w-4 mr-2" /> Refresh
            </Button>

            {!isRunning ? (
              <Button
                onClick={startBackfill}
                disabled={isRunning || records.length === 0}
                className="bg-gradient-to-r from-amber-500 to-orange-600 hover:opacity-90 h-12 px-6 text-base font-bold"
              >
                <Play className="h-5 w-5 mr-2" /> Start Bulk Backfill
              </Button>
            ) : (
              <Button variant="destructive" onClick={stopBackfill} className="h-12 px-6">
                <Square className="h-5 w-5 mr-2" /> Stop
              </Button>
            )}
          </div>
        </div>

        {/* ── Filter bar ── */}
        <div className="flex items-center gap-4 mb-6">
          <Filter className="h-4 w-4 text-zinc-500" />
          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="w-56 bg-zinc-900 border-zinc-700">
              <SelectValue placeholder="Filter by tool" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tools</SelectItem>
              <SelectItem value="colorpro">ColorPro</SelectItem>
              <SelectItem value="designpanelpro">DesignProAI™</SelectItem>
              <SelectItem value="fadewraps">FadeWraps</SelectItem>
              <SelectItem value="approvemode">ApprovePro</SelectItem>
              <SelectItem value="wbty">WBTY</SelectItem>
              <SelectItem value="GraphicsPro">GraphicsPro</SelectItem>
              <SelectItem value="CustomStyling">CustomStyling</SelectItem>
              <SelectItem value="inkfusion">InkFusion</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* ── Stats Dashboard ── */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <BarChart3 className="h-4 w-4 text-amber-400" />
                <span className="text-xs text-zinc-400">Records Needing Backfill</span>
              </div>
              <p className="text-3xl font-bold text-amber-400">
                {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : records.length}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <ImageIcon className="h-4 w-4 text-orange-400" />
                <span className="text-xs text-zinc-400">Total Views to Generate</span>
              </div>
              <p className="text-3xl font-bold text-orange-400">
                {isLoading ? <Loader2 className="h-6 w-6 animate-spin" /> : totalMissingViews}
              </p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-xs text-zinc-400">Views Generated</span>
              </div>
              <p className="text-3xl font-bold text-green-400">{totalViewsGenerated}</p>
            </CardContent>
          </Card>

          <Card className="bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <XCircle className="h-4 w-4 text-red-400" />
                <span className="text-xs text-zinc-400">Views Failed</span>
              </div>
              <p className="text-3xl font-bold text-red-400">{totalViewsFailed}</p>
            </CardContent>
          </Card>
        </div>

        {/* ── Mode Breakdown ── */}
        {Object.keys(modeBreakdown).length > 0 && !isRunning && (
          <Card className="mb-6 bg-zinc-900 border-zinc-800">
            <CardContent className="p-4">
              <p className="text-sm font-bold mb-3 text-zinc-300">Breakdown by Tool</p>
              <div className="flex flex-wrap gap-3">
                {Object.entries(modeBreakdown)
                  .sort((a, b) => b[1].count - a[1].count)
                  .map(([mode, stats]) => (
                    <div
                      key={mode}
                      className={cn(
                        "bg-zinc-800/50 rounded-lg px-3 py-2 border",
                        MODE_COLORS[mode] || "text-zinc-400 border-zinc-700"
                      )}
                    >
                      <p className="text-xs font-bold">{mode}</p>
                      <p className="text-[10px] text-zinc-500">
                        {stats.count} records &middot; {stats.views} views
                      </p>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Running Progress Dashboard ── */}
        {jobs.length > 0 && (
          <Card className="mb-6 bg-gradient-to-br from-zinc-900 via-zinc-900 to-amber-950/20 border-amber-500/20">
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  {isRunning ? (
                    <Loader2 className="h-7 w-7 text-amber-400 animate-spin" />
                  ) : completedJobs === jobs.length ? (
                    <CheckCircle2 className="h-7 w-7 text-green-400" />
                  ) : (
                    <AlertTriangle className="h-7 w-7 text-amber-400" />
                  )}
                  <div>
                    <h3 className="text-sm font-bold">
                      {isRunning
                        ? `Processing record ${currentRecordIdx + 1} of ${jobs.length}...`
                        : completedJobs === jobs.length
                          ? "Backfill Complete"
                          : "Backfill Stopped"}
                    </h3>
                    <p className="text-[11px] text-zinc-400">
                      {doneJobs} done &middot; {failedJobs} failed &middot;
                      {totalViewsGenerated} views generated &middot; {totalViewsFailed} views failed
                    </p>
                  </div>
                </div>
              </div>

              {/* Overall progress bar */}
              <div className="mb-2">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-zinc-400">Overall Progress</span>
                  <span className="text-zinc-500">{Math.round(overallProgress)}%</span>
                </div>
                <div className="h-2.5 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all duration-700"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Job List ── */}
        {jobs.length > 0 ? (
          <div className="space-y-2">
            {jobs.map((job, idx) => (
              <RecordRow key={job.record.id} job={job} index={idx} />
            ))}
          </div>
        ) : !isLoading && records.length > 0 ? (
          /* ── Pre-launch record list ── */
          <div className="space-y-2">
            <p className="text-sm text-zinc-400 mb-3">
              {records.length} records need backfilling. Click "Start Bulk Backfill" to begin.
            </p>
            {records.slice(0, 50).map((r) => (
              <Card key={r.id} className="bg-zinc-900 border-zinc-800">
                <CardContent className="p-3 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate">
                      {r.vehicle_year} {r.vehicle_make} {r.vehicle_model}
                    </p>
                    <p className="text-xs text-zinc-400 truncate">
                      {r.color_name} &bull; {r.finish_type}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", MODE_COLORS[r.mode_type || ""] || "border-zinc-700")}
                  >
                    {r.mode_type || "unknown"}
                  </Badge>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-green-400 font-bold">{r.existingViews.length}</span>
                    <span className="text-[10px] text-zinc-600">/</span>
                    <span className="text-[10px] text-zinc-400">{VIEW_ORDER.length}</span>
                    <Camera className="h-3 w-3 text-zinc-500 ml-0.5" />
                  </div>
                  <div className="flex flex-wrap gap-1 max-w-[200px]">
                    {r.missingViews.map((v) => (
                      <span key={v} className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        {VIEW_LABELS[v]}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
            {records.length > 50 && (
              <p className="text-xs text-zinc-500 text-center py-2">
                + {records.length - 50} more records not shown
              </p>
            )}
          </div>
        ) : !isLoading ? (
          /* ── Empty state ── */
          <div className="text-center py-24 text-zinc-500">
            <CheckCircle2 className="h-16 w-16 mx-auto mb-4 text-green-500 opacity-40" />
            <h2 className="text-xl font-bold text-zinc-300 mb-2">All Views Complete</h2>
            <p className="text-sm">
              Every render has all 7 canonical views. Nothing to backfill.
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-amber-400" />
            <span className="ml-3 text-zinc-400">Scanning records...</span>
          </div>
        )}

        {/* ── Navigation ── */}
        <div className="mt-8 flex justify-between">
          <Button
            variant="outline"
            className="border-zinc-700"
            onClick={() => (window.location.href = "/admin")}
          >
            Back to Admin
          </Button>
          <Button
            variant="outline"
            className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
            onClick={() => (window.location.href = "/revision-studio")}
          >
            RevisionStudioIQ
          </Button>
        </div>
      </main>
    </div>
  );
}

/* ================================================================ */
/* Record Row - shows a single backfill job with view progress       */
/* ================================================================ */
function RecordRow({ job, index }: { job: BackfillJob; index: number }) {
  const { record, status, completedViews, failedViews, currentView } = job;
  const totalMissing = record.missingViews.length;
  const progress = totalMissing > 0
    ? ((completedViews.length + failedViews.length) / totalMissing) * 100
    : 100;

  return (
    <Card
      className={cn(
        "bg-zinc-900 border-zinc-800 overflow-hidden",
        status === "running" && "border-amber-500/40",
        status === "done" && "border-green-500/20",
        status === "failed" && "border-red-500/30",
      )}
    >
      <CardContent className="p-3">
        <div className="flex items-center gap-4">
          {/* Index */}
          <span className="text-[10px] text-zinc-600 w-6 text-right flex-shrink-0">
            #{index + 1}
          </span>

          {/* Status icon */}
          <div className="flex-shrink-0">
            {status === "pending" && <ImageIcon className="h-4 w-4 text-zinc-600" />}
            {status === "running" && <Loader2 className="h-4 w-4 text-amber-400 animate-spin" />}
            {status === "done" && <CheckCircle2 className="h-4 w-4 text-green-400" />}
            {status === "failed" && <XCircle className="h-4 w-4 text-red-400" />}
            {status === "skipped" && <Square className="h-4 w-4 text-zinc-500" />}
          </div>

          {/* Vehicle info */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate">
              {record.vehicle_year} {record.vehicle_make} {record.vehicle_model}
            </p>
            <p className="text-[10px] text-zinc-500 truncate">
              {record.color_name} &bull; {record.finish_type}
            </p>
          </div>

          {/* Mode badge */}
          <Badge
            variant="outline"
            className={cn("text-[9px] flex-shrink-0", MODE_COLORS[record.mode_type || ""] || "border-zinc-700")}
          >
            {record.mode_type || "unknown"}
          </Badge>

          {/* Currently generating */}
          {currentView && (
            <Badge className="bg-amber-600 animate-pulse text-[9px] flex-shrink-0">
              {VIEW_LABELS[currentView]}...
            </Badge>
          )}

          {/* View count */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="text-[10px] text-green-400 font-bold">
              {record.existingViews.length + completedViews.length}
            </span>
            <span className="text-[10px] text-zinc-600">/</span>
            <span className="text-[10px] text-zinc-400">{VIEW_ORDER.length}</span>
            <Camera className="h-3 w-3 text-zinc-500" />
          </div>

          {/* Progress bar for running jobs */}
          {status === "running" && (
            <div className="w-24 flex-shrink-0">
              <Progress value={progress} className="h-1" />
            </div>
          )}
        </div>

        {/* View chips - show which were generated */}
        {(status === "done" || status === "failed") && (completedViews.length > 0 || failedViews.length > 0) && (
          <div className="flex flex-wrap gap-1 mt-2 ml-10">
            {completedViews.map((v) => (
              <span key={v} className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                <CheckCircle2 className="h-2.5 w-2.5 inline mr-0.5" />
                {VIEW_LABELS[v]}
              </span>
            ))}
            {failedViews.map((v) => (
              <span key={v} className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                <XCircle className="h-2.5 w-2.5 inline mr-0.5" />
                {VIEW_LABELS[v]}
              </span>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
