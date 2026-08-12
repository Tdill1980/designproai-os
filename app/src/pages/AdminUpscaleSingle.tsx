/**
 * AdminUpscaleSingle — Single-file 2x AI upscaler
 *
 * Upload one image → calls upscale-production-panel (Real-ESRGAN via Replicate)
 * → returns upscaled URL. One file at a time, full-screen preview, download.
 */

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Upload, Download, FileImage, X, Sparkles, Box } from "lucide-react";
import { toast } from "sonner";
import { downloadAsTiff } from "@/lib/download-as-tiff";
import { addUpscaledElementToWrapBox, type WrapboxElementKind } from "@/lib/wrapboxElements";
import { useOrganization } from "@/contexts/OrganizationContext";

// Replicate's Real-ESRGAN runs on a ~14.5 GiB GPU. Peak memory scales with
// OUTPUT pixels (~scale²), not input — so a 2M-pixel input at 8x is 128M
// output pixels and OOMs even though the input fits. Match the server-side
// caps in supabase/functions/upscale-production-panel/index.ts.
function maxInputPixelsForScale(scale: number): number {
  if (scale >= 8) return 500_000;
  if (scale >= 6) return 800_000;
  if (scale >= 4) return 2_000_000;
  return 2_000_000;
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Failed to decode image"));
      img.src = url;
    });
  } finally {
    // Defer revoke until image is decoded; safe to revoke now since img is loaded.
    URL.revokeObjectURL(url);
  }
}

async function resizeForGPU(file: File, upscaleScale: number): Promise<{
  file: File;
  resized: boolean;
  fromW: number;
  fromH: number;
  toW: number;
  toH: number;
  cap: number;
}> {
  const img = await loadImageFromFile(file);
  const totalPixels = img.naturalWidth * img.naturalHeight;
  const cap = maxInputPixelsForScale(upscaleScale);
  if (totalPixels <= cap) {
    return {
      file,
      resized: false,
      fromW: img.naturalWidth,
      fromH: img.naturalHeight,
      toW: img.naturalWidth,
      toH: img.naturalHeight,
      cap,
    };
  }

  const factor = Math.sqrt(cap / totalPixels);
  const toW = Math.max(1, Math.floor(img.naturalWidth * factor));
  const toH = Math.max(1, Math.floor(img.naturalHeight * factor));

  const canvas = document.createElement("canvas");
  canvas.width = toW;
  canvas.height = toH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, toW, toH);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png"),
  );
  if (!blob) throw new Error("Failed to encode resized image");

  const baseName = file.name.replace(/\.[^.]+$/, "");
  const resizedFile = new File([blob], `${baseName}_gpu-fit.png`, {
    type: "image/png",
  });

  return {
    file: resizedFile,
    resized: true,
    fromW: img.naturalWidth,
    fromH: img.naturalHeight,
    toW,
    toH,
    cap,
  };
}

interface WrapboxJobOption {
  id: string;
  order_number: string;
  vehicle_year?: string | null;
  vehicle_make?: string | null;
  vehicle_model?: string | null;
  finish_type?: string | null;
}

export default function AdminUpscaleSingle() {
  const fileRef = useRef<HTMLInputElement>(null);
  const { currentShopProfileId } = useOrganization();
  const [searchParams] = useSearchParams();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [stage, setStage] = useState<"idle" | "uploading" | "upscaling">("idle");
  const [upscaledUrl, setUpscaledUrl] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [scale, setScale] = useState<4 | 6 | 8>(6);
  const [tiffWorking, setTiffWorking] = useState(false);

  // WrapBox tagging
  const [wrapboxJobs, setWrapboxJobs] = useState<WrapboxJobOption[]>([]);
  const [wrapboxJobsLoading, setWrapboxJobsLoading] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string>("");
  const [jobNumberInput, setJobNumberInput] = useState<string>("");
  const [jobLookupError, setJobLookupError] = useState<string | null>(null);
  const [jobLookingUp, setJobLookingUp] = useState(false);
  const [elementLabel, setElementLabel] = useState("");
  const [elementKind, setElementKind] = useState<Exclude<WrapboxElementKind, "design_panel">>("element");
  const [savingToWrapbox, setSavingToWrapbox] = useState(false);
  const [wrapboxSaved, setWrapboxSaved] = useState(false);

  const selectedJob = wrapboxJobs.find((j) => j.id === selectedJobId) || null;

  // Look up a job # across panelizer_jobs, design_pack_purchases, and wpw_orders.
  // WrapBox jobs can originate from any of these. Caller decides what to do
  // with the returned job; this helper does NOT mutate state.
  async function findJobByOrderNumber(q: string): Promise<WrapboxJobOption | null> {
    const trimmed = q.trim();
    if (!trimmed) return null;

    const { data: pj } = await (supabase as any)
      .from("panelizer_jobs")
      .select("id, order_number, vehicle_year, vehicle_make, vehicle_model, finish_type")
      .eq("order_number", trimmed)
      .maybeSingle();
    if (pj) return pj as WrapboxJobOption;

    const { data: dpp } = await (supabase as any)
      .from("design_pack_purchases")
      .select("id, order_number, customer_order_number, vehicle_year, vehicle_make, vehicle_model")
      .or(`order_number.eq.${trimmed},customer_order_number.eq.${trimmed}`)
      .maybeSingle();
    if (dpp) {
      const row = dpp as any;
      return {
        id: row.id,
        order_number: row.order_number || row.customer_order_number || trimmed,
        vehicle_year: row.vehicle_year ?? null,
        vehicle_make: row.vehicle_make ?? null,
        vehicle_model: row.vehicle_model ?? null,
        finish_type: null,
      };
    }

    const { data: wpw } = await (supabase as any)
      .from("wpw_orders")
      .select("id, order_number")
      .eq("order_number", trimmed)
      .maybeSingle();
    if (wpw) {
      const row = wpw as any;
      return {
        id: row.id,
        order_number: row.order_number || trimmed,
        vehicle_year: null,
        vehicle_make: null,
        vehicle_model: null,
        finish_type: null,
      };
    }

    return null;
  }

  async function findJobByIdOrOrderNumber(q: string): Promise<WrapboxJobOption | null> {
    const trimmed = q.trim();
    if (!trimmed) return null;

    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    const pjFilter = isUuid
      ? `id.eq.${trimmed},order_number.eq.${trimmed}`
      : `order_number.eq.${trimmed}`;
    const { data: pj } = await (supabase as any)
      .from("panelizer_jobs")
      .select("id, order_number, vehicle_year, vehicle_make, vehicle_model, finish_type")
      .or(pjFilter)
      .maybeSingle();
    if (pj) return pj as WrapboxJobOption;

    return findJobByOrderNumber(trimmed);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadJobs() {
      setWrapboxJobsLoading(true);
      const [pjRes, dppRes, wpwRes] = await Promise.all([
        (supabase as any)
          .from("panelizer_jobs")
          .select("id, order_number, vehicle_year, vehicle_make, vehicle_model, finish_type")
          .not("order_number", "is", null)
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("design_pack_purchases")
          .select("id, order_number, vehicle_year, vehicle_make, vehicle_model, created_at")
          .not("order_number", "is", null)
          .order("created_at", { ascending: false })
          .limit(50),
        (supabase as any)
          .from("wpw_orders")
          .select("id, order_number, created_at")
          .not("order_number", "is", null)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);
      if (cancelled) return;
      if (pjRes.error) console.warn("[AdminUpscaleSingle] panelizer_jobs:", pjRes.error);
      if (dppRes.error) console.warn("[AdminUpscaleSingle] design_pack_purchases:", dppRes.error);
      if (wpwRes.error) console.warn("[AdminUpscaleSingle] wpw_orders:", wpwRes.error);
      const merged: WrapboxJobOption[] = [
        ...((pjRes.data || []) as WrapboxJobOption[]),
        ...(((dppRes.data || []) as any[]).map((r) => ({
          id: r.id,
          order_number: r.order_number,
          vehicle_year: r.vehicle_year ?? null,
          vehicle_make: r.vehicle_make ?? null,
          vehicle_model: r.vehicle_model ?? null,
          finish_type: null,
        }))),
        ...(((wpwRes.data || []) as any[]).map((r) => ({
          id: r.id,
          order_number: r.order_number,
          vehicle_year: null,
          vehicle_make: null,
          vehicle_model: null,
          finish_type: null,
        }))),
      ];
      const seen = new Set<string>();
      const deduped = merged.filter((j) => {
        const key = `${j.id}|${j.order_number}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setWrapboxJobs(deduped);
      setWrapboxJobsLoading(false);
    }
    loadJobs();
    return () => {
      cancelled = true;
    };
  }, []);

  // Pre-select from `?job=<id_or_order_number>` (deep-link from WrapBox card).
  useEffect(() => {
    const param = searchParams.get("job");
    if (!param || selectedJobId) return;
    let cancelled = false;
    (async () => {
      setJobLookingUp(true);
      setJobLookupError(null);
      const job = await findJobByIdOrOrderNumber(param);
      if (cancelled) return;
      if (!job) {
        setJobLookupError(`Job "${param}" not found`);
      } else {
        setWrapboxJobs((prev) =>
          prev.some((j) => j.id === job.id) ? prev : [job, ...prev],
        );
        setSelectedJobId(job.id);
        setJobNumberInput(job.order_number);
      }
      setJobLookingUp(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [searchParams, selectedJobId]);

  const lookupJobByNumber = async (override?: string): Promise<WrapboxJobOption | null> => {
    const q = (override ?? jobNumberInput).trim();
    if (!q) return null;
    setJobLookingUp(true);
    setJobLookupError(null);
    const job = await findJobByOrderNumber(q);
    setJobLookingUp(false);
    if (!job) {
      setSelectedJobId("");
      setJobLookupError(`No job with order # "${q}"`);
      return null;
    }
    setWrapboxJobs((prev) =>
      prev.some((j) => j.id === job.id) ? prev : [job, ...prev],
    );
    setSelectedJobId(job.id);
    setJobLookupError(null);
    return job;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setUploadedUrl(null);
    setUpscaledUrl(null);
    setElapsedMs(null);
    setWrapboxSaved(false);
    if (!elementLabel) {
      const guess = f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
      setElementLabel(guess);
    }
    const reader = new FileReader();
    reader.onload = () => setPreviewUrl(reader.result as string);
    reader.readAsDataURL(f);
  };

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setUploadedUrl(null);
    setUpscaledUrl(null);
    setElapsedMs(null);
    setStage("idle");
    setWrapboxSaved(false);
    setElementLabel("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const runUpscale = async () => {
    if (!file) {
      toast.error("Pick a file first");
      return;
    }

    setRunning(true);
    setUpscaledUrl(null);
    setElapsedMs(null);

    try {
      // 1. Resize to fit Replicate's Real-ESRGAN GPU memory cap, then upload.
      setStage("uploading");
      const fit = await resizeForGPU(file, scale);
      if (fit.resized) {
        toast.info(
          `Resized input ${fit.fromW}×${fit.fromH} → ${fit.toW}×${fit.toH} to fit GPU memory at ${scale}x`,
        );
      }
      const uploadFile = fit.file;
      const ext = uploadFile.name.split(".").pop() || "png";
      const path = `panels/upscale-uploads/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("wrap-files")
        .upload(path, uploadFile, { contentType: uploadFile.type, upsert: true });
      if (upErr) throw new Error("Upload failed: " + upErr.message);

      const { data: { publicUrl } } = supabase.storage
        .from("wrap-files")
        .getPublicUrl(path);
      setUploadedUrl(publicUrl);

      // 2. Call the upscaler edge function
      setStage("upscaling");
      const { data, error } = await supabase.functions.invoke(
        "upscale-production-panel",
        { body: { image_url: publicUrl, scale } },
      );

      if (error) throw new Error(error.message || "Upscale request failed");
      if (!data?.success) {
        throw new Error(data?.error || "Upscale failed");
      }

      setUpscaledUrl(data.upscaled_url);
      setElapsedMs(data.elapsed_ms ?? null);
      toast.success("Upscale complete");
    } catch (err: any) {
      toast.error(err.message || "Upscale failed");
    } finally {
      setRunning(false);
      setStage("idle");
    }
  };

  const download = async () => {
    if (!upscaledUrl) return;
    const base = file?.name.replace(/\.[^.]+$/, "") || "upscaled";
    const filename = `${base}_${scale}x.png`;
    // Replicate's CDN is cross-origin, so the <a download> attribute is ignored
    // and the image opens in a tab instead of saving. Fetch as a blob and use
    // an object URL so the browser actually writes the file to disk.
    try {
      const res = await fetch(upscaledUrl);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (err: any) {
      toast.error(`Download failed: ${err.message || err}. Opening in new tab.`);
      window.open(upscaledUrl, "_blank", "noreferrer");
    }
  };

  const saveToWrapbox = async () => {
    if (!upscaledUrl) return;
    if (!currentShopProfileId) {
      toast.error("No shop selected — open WrapBox once to set your shop.");
      return;
    }
    let job = selectedJob;
    if (!job && jobNumberInput.trim()) {
      job = await lookupJobByNumber();
    }
    if (!job) {
      toast.error(
        jobNumberInput.trim()
          ? `No job with order # "${jobNumberInput.trim()}". Check the number above.`
          : "Tag a job # at the top of the page first.",
      );
      return;
    }
    const label = (elementLabel || "Element").trim();
    setSavingToWrapbox(true);
    try {
      await addUpscaledElementToWrapBox({
        job: {
          jobId: job.id,
          orderNumber: job.order_number,
          vehicleInfo: {
            year: job.vehicle_year || undefined,
            make: job.vehicle_make || undefined,
            model: job.vehicle_model || undefined,
          },
          finishType: job.finish_type || null,
        },
        shopId: currentShopProfileId,
        imageUrl: upscaledUrl,
        label,
        kind: elementKind,
        scale,
      });
      setWrapboxSaved(true);
      toast.success(`Saved "${label}" to WrapBox (${selectedJob.order_number})`);
    } catch (err: any) {
      toast.error(err.message || "Failed to save to WrapBox");
    } finally {
      setSavingToWrapbox(false);
    }
  };

  const downloadTiff = async () => {
    if (!upscaledUrl) return;
    const base = file?.name.replace(/\.[^.]+$/, "") || "upscaled";
    const filename = `${base}_${scale}x.tiff`;
    setTiffWorking(true);
    try {
      await downloadAsTiff(upscaledUrl, filename, { dpi: 300 });
      toast.success("TIFF downloaded");
    } catch (err: any) {
      toast.error(`TIFF export failed: ${err.message || err}`);
    } finally {
      setTiffWorking(false);
    }
  };

  const stageLabel =
    stage === "uploading" ? "Uploading file..." :
    stage === "upscaling" ? `Running ${scale}x AI upscale...` :
    null;

  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-semibold">Single Upscaler</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Upload one image and AI-upscale it 2x (Real-ESRGAN). One file at a time.
          </p>
        </header>

        {/* Job # tagging — top of page so every upscale knows where to land */}
        <Card className="p-6 space-y-3 border-blue-600/40">
          <div className="flex items-center gap-2">
            <Box className="w-4 h-4 text-blue-500" />
            <Label className="text-sm font-semibold">Tag to WrapBox Job #</Label>
            {selectedJob && (
              <span className="ml-auto text-xs text-emerald-600 font-mono">
                ✓ {selectedJob.order_number}
                {[selectedJob.vehicle_year, selectedJob.vehicle_make, selectedJob.vehicle_model]
                  .filter(Boolean).length > 0
                  ? ` — ${[selectedJob.vehicle_year, selectedJob.vehicle_make, selectedJob.vehicle_model].filter(Boolean).join(" ")}`
                  : ""}
              </span>
            )}
          </div>
          <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div className="space-y-1">
              <Label className="text-xs">Enter Job #</Label>
              <div className="flex gap-2">
                <Input
                  value={jobNumberInput}
                  onChange={(e) => {
                    setJobNumberInput(e.target.value);
                    if (selectedJobId) setSelectedJobId("");
                    if (jobLookupError) setJobLookupError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      lookupJobByNumber();
                    }
                  }}
                  onBlur={() => {
                    if (jobNumberInput.trim() && !selectedJobId && !jobLookingUp) {
                      lookupJobByNumber();
                    }
                  }}
                  placeholder="e.g. MP-XXXXXX"
                  className="font-mono"
                />
                <Button
                  type="button"
                  variant="secondary"
                  onClick={lookupJobByNumber}
                  disabled={jobLookingUp || !jobNumberInput.trim()}
                >
                  {jobLookingUp ? <Loader2 className="w-4 h-4 animate-spin" /> : "Find"}
                </Button>
              </div>
              {jobLookupError && (
                <p className="text-xs text-red-500">{jobLookupError}</p>
              )}
            </div>
            <div className="text-xs text-muted-foreground text-center pb-2">or</div>
            <div className="space-y-1">
              <Label className="text-xs">Pick from recent</Label>
              <Select
                value={selectedJobId}
                onValueChange={(v) => {
                  setSelectedJobId(v);
                  const job = wrapboxJobs.find((j) => j.id === v);
                  if (job) setJobNumberInput(job.order_number);
                  setJobLookupError(null);
                }}
                disabled={wrapboxJobsLoading}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={wrapboxJobsLoading ? "Loading jobs..." : "Recent jobs"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {wrapboxJobs.map((job) => {
                    const v = [job.vehicle_year, job.vehicle_make, job.vehicle_model]
                      .filter(Boolean)
                      .join(" ");
                    return (
                      <SelectItem key={job.id} value={job.id}>
                        {job.order_number}
                        {v ? ` — ${v}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Locked here once before you upscale — every Save to WrapBox lands under this job # in the shared team WrapBox.
          </p>
        </Card>

        <Card className="p-6 space-y-4">
          <Label htmlFor="upscale-file">Image file</Label>

          {!previewUrl && (
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-md p-10 text-center cursor-pointer hover:border-primary transition-colors"
            >
              <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Click to choose a file (PNG / JPG)
              </p>
            </div>
          )}

          {previewUrl && (
            <div className="relative">
              <img
                src={previewUrl}
                alt="Preview"
                className="max-h-[420px] w-full object-contain rounded-md border border-border bg-muted"
              />
              <Button
                size="icon"
                variant="secondary"
                className="absolute top-2 right-2"
                onClick={reset}
                disabled={running}
                aria-label="Clear file"
              >
                <X className="w-4 h-4" />
              </Button>
              {file && (
                <p className="text-xs text-muted-foreground mt-2 truncate">
                  {file.name} ({Math.round(file.size / 1024)} KB)
                </p>
              )}
            </div>
          )}

          <input
            ref={fileRef}
            id="upscale-file"
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp"
            className="hidden"
            onChange={handleFileChange}
          />

          <div className="flex items-center gap-2">
            <Label className="text-sm">Scale</Label>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {([4, 6, 8] as const).map((s, i) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setScale(s)}
                  disabled={running}
                  className={
                    "px-4 py-2 text-sm transition-colors " +
                    (i > 0 ? "border-l border-border " : "") +
                    (scale === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-foreground hover:bg-muted")
                  }
                >
                  {s}x{s === 8 ? " (max)" : ""}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground ml-2">
              6x is the default. 8x is the highest before quality degrades.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button
              onClick={runUpscale}
              disabled={!file || running}
              className="min-w-[200px]"
            >
              {running ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  {stageLabel || "Working..."}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Upscale {scale}x
                </>
              )}
            </Button>
            {elapsedMs != null && !running && (
              <span className="text-xs text-muted-foreground">
                Done in {(elapsedMs / 1000).toFixed(1)}s
              </span>
            )}
          </div>
        </Card>

        {upscaledUrl && (
          <Card className="p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Upscaled output</h2>
              <div className="flex items-center gap-2">
                <Button onClick={download} size="sm">
                  <Download className="w-4 h-4 mr-2" />
                  PNG
                </Button>
                <Button
                  onClick={downloadTiff}
                  size="sm"
                  variant="secondary"
                  disabled={tiffWorking}
                >
                  {tiffWorking ? (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <FileImage className="w-4 h-4 mr-2" />
                  )}
                  TIFF (300 DPI)
                </Button>
              </div>
            </div>
            <a href={upscaledUrl} target="_blank" rel="noreferrer" className="block">
              <img
                src={upscaledUrl}
                alt="Upscaled"
                className="w-full max-h-[700px] object-contain rounded-md border border-border bg-muted"
              />
            </a>
            <p className="text-xs text-muted-foreground break-all">{upscaledUrl}</p>

            <div className="rounded-md border border-blue-600/40 bg-blue-50 p-4 space-y-3">
              <div className="flex items-center gap-2 text-blue-700">
                <Box className="w-4 h-4" />
                <span className="text-sm font-semibold">Save to WrapBox</span>
                {selectedJob ? (
                  <span className="ml-auto text-xs font-mono text-emerald-700">
                    → {selectedJob.order_number}
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-red-600">No job tagged — set one above</span>
                )}
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Element kind</Label>
                  <Select
                    value={elementKind}
                    onValueChange={(v) => setElementKind(v as Exclude<WrapboxElementKind, "design_panel">)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="element">Element</SelectItem>
                      <SelectItem value="background">Background</SelectItem>
                      <SelectItem value="vector">Vector</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Element label</Label>
                  <Input
                    value={elementLabel}
                    onChange={(e) => setElementLabel(e.target.value)}
                    placeholder="e.g. Logo, Background, Stripe Left"
                  />
                </div>
              </div>
              <Button
                onClick={saveToWrapbox}
                disabled={
                  savingToWrapbox ||
                  !selectedJob ||
                  !currentShopProfileId
                }
                className="w-full sm:w-auto"
              >
                {savingToWrapbox ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <Box className="w-4 h-4 mr-2" />
                )}
                {wrapboxSaved ? "Saved — Save Again" : "Save to WrapBox"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
