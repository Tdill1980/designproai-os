import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowLeft,
  LayoutGrid,
  Zap,
  Play,
  Square,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";

/* ================================================================ */
/* Types                                                            */
/* ================================================================ */

type Category = "restyle" | "commercial";
type JobStatus = "queued" | "generating" | "uploading" | "saved" | "failed";

interface PanelJob {
  id: string;
  index: number;
  status: JobStatus;
  designName?: string;
  thumbnailUrl?: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

/* ================================================================ */
/* Commercial industries (for the dropdown)                         */
/* ================================================================ */

const COMMERCIAL_INDUSTRIES = [
  "Plumbing",
  "HVAC",
  "Electrical",
  "Landscaping",
  "Mobile Detailing",
  "Food Truck",
  "Construction",
  "Fleet Logistics",
  "Pest Control",
  "Roofing",
  "Towing",
  "Auto Repair",
  "Delivery / Courier",
  "Cleaning Services",
  "Security",
];

/* ================================================================ */
/* Helpers — client-side 16:9 → 186:56 (3.32:1) crop                */
/* ================================================================ */

const TARGET_ASPECT = 186 / 56; // ~3.3214

async function loadImageFromBase64(
  base64: string,
  mimeType: string,
): Promise<HTMLImageElement> {
  const src = `data:${mimeType};base64,${base64}`;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

async function cropTo186x56Png(
  base64: string,
  mimeType: string,
): Promise<Blob> {
  const img = await loadImageFromBase64(base64, mimeType);
  const srcW = img.naturalWidth;
  const srcH = img.naturalHeight;
  const srcAspect = srcW / srcH;

  // Center-crop the tall axis to reach the 3.32:1 target ratio.
  let sx = 0;
  let sy = 0;
  let sw = srcW;
  let sh = srcH;

  if (srcAspect > TARGET_ASPECT) {
    // Source is wider than target → crop sides.
    sw = Math.round(srcH * TARGET_ASPECT);
    sx = Math.round((srcW - sw) / 2);
  } else {
    // Source is taller than target (16:9 case) → crop top/bottom.
    sh = Math.round(srcW / TARGET_ASPECT);
    sy = Math.round((srcH - sh) / 2);
  }

  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Canvas toBlob returned null"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ================================================================ */
/* Page                                                             */
/* ================================================================ */

export default function AdminPanelLibraryGenerator() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const [category, setCategory] = useState<Category>("restyle");
  const [batchSize, setBatchSize] = useState<number>(10);
  const [customTheme, setCustomTheme] = useState<string>("");
  const [industry, setIndustry] = useState<string>("Plumbing");
  const [businessName, setBusinessName] = useState<string>("");
  const [autoCurate, setAutoCurate] = useState<boolean>(false);

  const [jobs, setJobs] = useState<PanelJob[]>([]);
  const [running, setRunning] = useState<boolean>(false);
  const stopRef = useRef<boolean>(false);

  /* -------------------------------------------------------------- */
  /* Supabase insert mutation (only the DB write is a mutation)     */
  /* -------------------------------------------------------------- */

  const insertPanelMutation = useMutation({
    mutationFn: async (row: {
      name: string;
      media_url: string;
      category: Category;
      is_curated: boolean;
    }) => {
      const { error } = await supabase.from("designpanelpro_patterns").insert({
        name: row.name,
        ai_generated_name: row.name,
        media_url: row.media_url,
        clean_display_url: row.media_url,
        category: row.category,
        is_active: true,
        is_curated: row.is_curated,
        sort_order: 999,
      });
      if (error) throw error;
    },
  });

  /* -------------------------------------------------------------- */
  /* Per-panel generation                                           */
  /* -------------------------------------------------------------- */

  const generateOnePanel = useCallback(
    async (job: PanelJob): Promise<void> => {
      const setStatus = (patch: Partial<PanelJob>) => {
        setJobs((prev) =>
          prev.map((j) => (j.id === job.id ? { ...j, ...patch } : j)),
        );
      };

      // 1. Session check — matches the AdminDesignPanelProManager pattern.
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        throw new Error("Session expired. Please log out and log back in.");
      }

      setStatus({ status: "generating", startedAt: Date.now() });

      // 2. Call the edge function.
      const { data, error } = await supabase.functions.invoke(
        "generate-flat-panel-library",
        {
          body: {
            category,
            prompt: customTheme || undefined,
            industry: category === "commercial" ? industry : undefined,
            businessName:
              category === "commercial" && businessName
                ? businessName
                : undefined,
          },
        },
      );

      if (error) {
        throw new Error(error.message || "Edge function invoke failed");
      }

      if (!data?.success || !data?.imageBase64) {
        throw new Error(data?.error || "Generation failed (no image)");
      }

      const designName: string =
        typeof data.designName === "string" && data.designName.length > 0
          ? data.designName
          : `Panel ${job.index + 1}`;
      const mimeType: string =
        typeof data.mimeType === "string" && data.mimeType.length > 0
          ? data.mimeType
          : "image/png";

      // 3. Client-side crop to 186:56 (3.32:1).
      setStatus({ status: "uploading", designName });
      const blob = await cropTo186x56Png(data.imageBase64, mimeType);

      // 4. Upload to the `patterns` bucket.
      const timestamp = Date.now();
      const filePath = `curated-panels/lib-${timestamp}-${job.index}.png`;
      const { error: uploadErr } = await supabase.storage
        .from("patterns")
        .upload(filePath, blob, {
          contentType: "image/png",
          upsert: true,
        });

      if (uploadErr) throw uploadErr;

      const {
        data: { publicUrl },
      } = supabase.storage.from("patterns").getPublicUrl(filePath);

      // 5. Insert DB row.
      await insertPanelMutation.mutateAsync({
        name: designName,
        media_url: publicUrl,
        category,
        is_curated: autoCurate,
      });

      setStatus({
        status: "saved",
        thumbnailUrl: publicUrl,
        finishedAt: Date.now(),
      });
    },
    [autoCurate, businessName, category, customTheme, industry, insertPanelMutation],
  );

  /* -------------------------------------------------------------- */
  /* Batch loop                                                     */
  /* -------------------------------------------------------------- */

  const startBatch = async () => {
    if (running) return;

    const initialJobs: PanelJob[] = Array.from({ length: batchSize }, (_, i) => ({
      id: `${Date.now()}-${i}`,
      index: i,
      status: "queued",
    }));

    setJobs(initialJobs);
    setRunning(true);
    stopRef.current = false;

    for (let i = 0; i < initialJobs.length; i++) {
      if (stopRef.current) {
        toast({
          title: "Batch stopped",
          description: `Stopped after ${i} of ${initialJobs.length} panels.`,
        });
        break;
      }

      const job = initialJobs[i];
      try {
        await generateOnePanel(job);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        setJobs((prev) =>
          prev.map((j) =>
            j.id === job.id
              ? { ...j, status: "failed", error: message, finishedAt: Date.now() }
              : j,
          ),
        );
        toast({
          title: `Panel ${i + 1} failed`,
          description: message,
          variant: "destructive",
        });
      }

      // 3s delay between jobs for rate-limit safety.
      if (i < initialJobs.length - 1 && !stopRef.current) {
        await sleep(3000);
      }
    }

    setRunning(false);
    toast({
      title: "Batch complete",
      description: "Check the progress list below for results.",
    });
  };

  const stopBatch = () => {
    stopRef.current = true;
  };

  /* -------------------------------------------------------------- */
  /* Derived stats                                                  */
  /* -------------------------------------------------------------- */

  const doneCount = jobs.filter((j) => j.status === "saved").length;
  const failedCount = jobs.filter((j) => j.status === "failed").length;
  const inProgressCount = jobs.filter(
    (j) => j.status === "generating" || j.status === "uploading",
  ).length;

  const finishedDurations = jobs
    .filter((j) => j.startedAt && j.finishedAt)
    .map((j) => (j.finishedAt! - j.startedAt!) / 1000);
  const avgSeconds =
    finishedDurations.length > 0
      ? finishedDurations.reduce((a, b) => a + b, 0) / finishedDurations.length
      : 0;

  const progressPct =
    jobs.length === 0 ? 0 : Math.round(((doneCount + failedCount) / jobs.length) * 100);

  /* -------------------------------------------------------------- */
  /* Render                                                         */
  /* -------------------------------------------------------------- */

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="container mx-auto p-8 max-w-6xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate("/admin/designpanelpro-manager")}
              className="text-zinc-300 hover:text-white"
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Panel Manager
            </Button>
            <div>
              <h1 className="text-3xl font-bold flex items-center gap-3">
                <LayoutGrid className="w-7 h-7 text-emerald-400" />
                Flat Panel Library Generator
              </h1>
              <p className="text-zinc-400 mt-1">
                Batch-generate flat 186&quot; × 56&quot; vinyl panel artwork for
                RestyleLibrary™ — ReStyle &amp; Commercial modes
              </p>
            </div>
          </div>
        </div>

        {/* Controls Card */}
        <Card className="bg-zinc-900 border-zinc-800 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-400" />
            Batch Settings
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Category */}
            <div className="space-y-2">
              <Label className="text-zinc-300">Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as Category)}
                disabled={running}
              >
                <SelectTrigger className="bg-zinc-950 border-zinc-700">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="restyle">ReStyle (Artistic)</SelectItem>
                  <SelectItem value="commercial">
                    Commercial (Business / Fleet)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Batch size */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-zinc-300">Batch Size</Label>
                <Badge
                  variant="outline"
                  className="text-emerald-300 border-emerald-500/30"
                >
                  {batchSize} panels
                </Badge>
              </div>
              <Slider
                value={[batchSize]}
                min={1}
                max={50}
                step={1}
                onValueChange={(v) => setBatchSize(v[0] ?? 1)}
                disabled={running}
              />
            </div>

            {/* Custom theme */}
            <div className="space-y-2 md:col-span-2">
              <Label className="text-zinc-300">
                Custom theme (optional — leave blank for AI to pick)
              </Label>
              <Textarea
                value={customTheme}
                onChange={(e) => setCustomTheme(e.target.value)}
                placeholder="e.g. liquid chrome flowing into obsidian shards, electric cyan accents"
                className="bg-zinc-950 border-zinc-700 resize-none"
                rows={3}
                disabled={running}
              />
            </div>

            {/* Commercial-only fields */}
            {category === "commercial" && (
              <>
                <div className="space-y-2">
                  <Label className="text-zinc-300">Industry</Label>
                  <Select
                    value={industry}
                    onValueChange={setIndustry}
                    disabled={running}
                  >
                    <SelectTrigger className="bg-zinc-950 border-zinc-700">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {COMMERCIAL_INDUSTRIES.map((ind) => (
                        <SelectItem key={ind} value={ind}>
                          {ind}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-zinc-300">
                    Business name (optional)
                  </Label>
                  <Input
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="e.g. Ed's Smokehouse BBQ"
                    className="bg-zinc-950 border-zinc-700"
                    disabled={running}
                  />
                </div>
              </>
            )}

            {/* Auto-curate switch */}
            <div className="flex items-center justify-between md:col-span-2 bg-zinc-950 border border-zinc-800 rounded-md px-4 py-3">
              <div>
                <Label className="text-zinc-200">Auto-curate winners</Label>
                <p className="text-xs text-zinc-500 mt-0.5">
                  When on, saved panels are flagged as curated (
                  <code className="text-emerald-300">is_curated = true</code>).
                </p>
              </div>
              <Switch
                checked={autoCurate}
                onCheckedChange={setAutoCurate}
                disabled={running}
              />
            </div>
          </div>

          {/* Action buttons */}
          <div className="mt-6 flex items-center gap-3">
            <Button
              onClick={startBatch}
              disabled={running || batchSize < 1}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Start Batch
                </>
              )}
            </Button>
            {running && (
              <Button
                onClick={stopBatch}
                variant="outline"
                className="text-red-400 border-red-500/40 hover:bg-red-500/10"
              >
                <Square className="w-4 h-4 mr-2" />
                Stop
              </Button>
            )}
          </div>
        </Card>

        {/* Progress Section */}
        {jobs.length > 0 && (
          <Card className="bg-zinc-900 border-zinc-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Progress</h2>
              <div className="flex items-center gap-2 text-xs">
                <Badge className="bg-emerald-700/40 text-emerald-200 border border-emerald-500/30">
                  {doneCount} done
                </Badge>
                <Badge className="bg-red-700/40 text-red-200 border border-red-500/30">
                  {failedCount} failed
                </Badge>
                <Badge className="bg-blue-700/40 text-blue-200 border border-blue-500/30">
                  {inProgressCount} in progress
                </Badge>
                {avgSeconds > 0 && (
                  <Badge
                    variant="outline"
                    className="text-zinc-300 border-zinc-600"
                  >
                    avg {avgSeconds.toFixed(1)}s / panel
                  </Badge>
                )}
              </div>
            </div>

            <Progress value={progressPct} className="mb-6" />

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {jobs.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}

/* ================================================================ */
/* Job Card                                                         */
/* ================================================================ */

function JobCard({ job }: { job: PanelJob }) {
  const label = `Panel ${job.index + 1}`;

  return (
    <div
      className={cn(
        "rounded-md border bg-zinc-950 overflow-hidden",
        job.status === "saved" && "border-emerald-500/40",
        job.status === "failed" && "border-red-500/40",
        job.status === "generating" && "border-blue-500/40",
        job.status === "uploading" && "border-cyan-500/40",
        job.status === "queued" && "border-zinc-800",
      )}
    >
      <div
        className="relative bg-black w-full"
        style={{ aspectRatio: "186 / 56" }}
      >
        {job.thumbnailUrl ? (
          <img
            src={job.thumbnailUrl}
            alt={job.designName || label}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-zinc-500">
            {job.status === "queued" && (
              <span className="text-xs">Queued</span>
            )}
            {job.status === "generating" && (
              <Loader2 className="w-5 h-5 animate-spin text-blue-400" />
            )}
            {job.status === "uploading" && (
              <Loader2 className="w-5 h-5 animate-spin text-cyan-400" />
            )}
            {job.status === "failed" && (
              <XCircle className="w-5 h-5 text-red-400" />
            )}
          </div>
        )}
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium text-zinc-200 truncate">
            {job.designName || label}
          </span>
          <StatusBadge status={job.status} />
        </div>
        {job.error && (
          <p className="text-[10px] text-red-400 mt-1 line-clamp-2">
            {job.error}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  switch (status) {
    case "saved":
      return (
        <Badge className="bg-emerald-700/40 text-emerald-200 border border-emerald-500/30 text-[10px]">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          saved
        </Badge>
      );
    case "failed":
      return (
        <Badge className="bg-red-700/40 text-red-200 border border-red-500/30 text-[10px]">
          <XCircle className="w-3 h-3 mr-1" />
          failed
        </Badge>
      );
    case "generating":
      return (
        <Badge className="bg-blue-700/40 text-blue-200 border border-blue-500/30 text-[10px]">
          generating
        </Badge>
      );
    case "uploading":
      return (
        <Badge className="bg-cyan-700/40 text-cyan-200 border border-cyan-500/30 text-[10px]">
          uploading
        </Badge>
      );
    case "queued":
    default:
      return (
        <Badge
          variant="outline"
          className="text-zinc-400 border-zinc-700 text-[10px]"
        >
          queued
        </Badge>
      );
  }
}
