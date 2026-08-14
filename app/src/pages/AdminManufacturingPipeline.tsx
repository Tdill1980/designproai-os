/**
 * AdminManufacturingPipeline — G.E.N.I.E. Back-of-House (BOH) control tower.
 *
 * Visual-first, modular BOH workbench. Reads live from the verified
 * `panelizer_jobs` schema, enriched with `design_generation_assets` (the
 * LayerLiftIQ split) via `generation_id`.
 *
 * THREE-COLUMN WORKSPACE
 *   Column 1 — the canonical SaaS left sidebar + branding, provided natively by
 *     <AppShell> (this path is registered in useIsAppRoute). Not rendered here.
 *   Column 2 — fluid center workspace: active pipeline cards + blue-gradient
 *     progress bars tied to live status tokens. Monitoring only, no edit knobs.
 *   Column 3 — 380px collapsible right utility panel (isRightPanelOpen): the
 *     LayerLiftIQ split download gates + drag-and-drop template finalizer, for
 *     the selected job.
 *
 * ONE-PROMPT EXECUTION CONTRACT (read-only here)
 *   A single front-end prompt fans out into three parallel outputs that this
 *   tower surfaces per job: the text-baked hero (approved_render_url), the
 *   text-free clean canvas (background_url, from buildLayer1CleanPrompt), and
 *   the flat 2D panel blueprint (proof_2d_url). BOH monitors + finalizes; it
 *   does not originate generation.
 *
 * Finalize ("Approve & Push to WrapBox") invokes run-master-artboard-flow, the
 * server-side proxy that holds SIDECAR_SECRET and delegates to the Vercel
 * packaging runtime (api/process-production-pack) → wrap-files/wrapbox/{order}/.
 *
 * Internal admin tooling → deep-slate dark theme with cobalt/blue gradient
 * accents (the white-UI standard is for customer-facing pages only).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Factory,
  Layers,
  ImageDown,
  UploadCloud,
  Rocket,
  RefreshCw,
  CircleAlert,
  CheckCircle2,
  Loader2,
  Car,
  FileArchive,
  PanelRightOpen,
  PanelRightClose,
  X,
  Sparkles,
  Image as ImageIcon,
  Grid2x2,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Types (subset of the verified schema) ─────────────────────────────────────
interface PanelizerJob {
  id: string;
  order_number: string | null;
  generation_id: string | null;
  vehicle_year: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_trim: string | null;
  status: string | null;
  current_stage: number | null;
  stage_progress: Record<string, unknown> | null;
  concept_json: Record<string, unknown> | null;
  approved_render_url: string | null;
  all_view_urls: Record<string, string> | null;
  zip_signed_url: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
  completed_at: string | null;
}

interface OverlayPng {
  id?: string;
  kind?: string;
  role?: string;
  text?: string;
  url: string;
}

interface GenerationAssets {
  generation_id: string;
  background_url: string | null;
  overlay_pngs: OverlayPng[] | null;
  proof_2d_url: string | null;
  proof_3d_url: string | null;
  source_prompt: string | null;
}

// ── Status → progress (grounded in real panelizer_jobs.status values) ─────────
type Tone = "slate" | "cobalt" | "amber" | "green" | "red";
interface StageView {
  pct: number;
  label: string;
  tone: Tone;
}

function deriveStage(job: PanelizerJob): StageView {
  const status = (job.status || "").toLowerCase();
  const stage = job.current_stage ?? 0;
  switch (status) {
    case "queued":
      return stage >= 1
        ? { pct: 15, label: "Slicing", tone: "cobalt" }
        : { pct: 5, label: "Queued", tone: "slate" };
    case "optimizing":
      return { pct: 40, label: "Upscaling", tone: "cobalt" };
    case "qa_checking":
      return { pct: 60, label: "Designer QA", tone: "cobalt" };
    case "pending_qc":
      return { pct: 60, label: "QA Ready", tone: "amber" };
    case "packaging":
      return { pct: 85, label: "Packaging", tone: "cobalt" };
    case "ready":
      return { pct: 100, label: "Ready", tone: "green" };
    case "ready_for_print":
      return { pct: 100, label: "Ready for Print", tone: "green" };
    case "failed":
      return { pct: 100, label: "Failed", tone: "red" };
    default:
      return { pct: Math.min(95, stage * 25), label: status || "Unknown", tone: "slate" };
  }
}

const TONE_BADGE: Record<Tone, string> = {
  slate: "bg-slate-800 text-slate-300 border-slate-600",
  cobalt: "bg-blue-950 text-blue-300 border-blue-700",
  amber: "bg-amber-950 text-amber-300 border-amber-700",
  green: "bg-emerald-950 text-emerald-300 border-emerald-700",
  red: "bg-red-950 text-red-300 border-red-700",
};

const TONE_BAR: Record<Tone, string> = {
  slate: "from-slate-500 to-slate-400",
  cobalt: "from-blue-600 via-blue-500 to-cyan-400",
  amber: "from-amber-500 to-amber-400",
  green: "from-emerald-500 to-emerald-400",
  red: "from-red-600 to-red-500",
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function downloadUrl(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function vehicleLabel(job: PanelizerJob): string {
  return (
    [job.vehicle_year, job.vehicle_make, job.vehicle_model, job.vehicle_trim]
      .filter(Boolean)
      .join(" ") || "Unspecified vehicle"
  );
}

function orderNo(job: PanelizerJob): string {
  return job.order_number || `RP-${job.id.slice(0, 8).toUpperCase()}`;
}

function GradientProgress({ pct, tone }: { pct: number; tone: Tone }) {
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-800/80 ring-1 ring-inset ring-white/5">
      <div
        className={cn("h-full rounded-full bg-gradient-to-r transition-all duration-700 ease-out", TONE_BAR[tone])}
        style={{ width: `${Math.max(4, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

// ── Column 2: pipeline card (monitoring only — no edit knobs) ─────────────────
function PipelineCard({
  job,
  assets,
  selected,
  onSelect,
}: {
  job: PanelizerJob;
  assets?: GenerationAssets;
  selected: boolean;
  onSelect: () => void;
}) {
  const stage = useMemo(() => deriveStage(job), [job]);
  const isFailed = stage.tone === "red";
  const isReady = stage.tone === "green";

  // One-prompt contract dots: hero / clean Layer-1 / 2D blueprint presence.
  const hasHero = !!job.approved_render_url;
  const hasClean = !!assets?.background_url;
  const has2d = !!assets?.proof_2d_url;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full rounded-2xl border bg-slate-900/60 p-5 text-left shadow-lg shadow-black/30 ring-1 ring-inset ring-white/5 backdrop-blur transition-all hover:border-blue-600/50",
        selected ? "border-cyan-500/70 ring-cyan-500/20" : "border-slate-800",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 font-mono text-sm font-semibold tracking-wide text-cyan-300">
            <FileArchive className="h-4 w-4 shrink-0" />
            <span className="truncate">{orderNo(job)}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-400">
            <Car className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{vehicleLabel(job)}</span>
          </div>
        </div>
        <Badge variant="outline" className={cn("shrink-0 border text-[11px]", TONE_BADGE[stage.tone])}>
          {isFailed && <CircleAlert className="mr-1 h-3 w-3" />}
          {isReady && <CheckCircle2 className="mr-1 h-3 w-3" />}
          {stage.label}
        </Badge>
      </div>

      <div className="mt-4">
        <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium uppercase tracking-wider text-slate-500">
          <span>Pipeline</span>
          <span className="tabular-nums text-slate-400">{stage.pct}%</span>
        </div>
        <GradientProgress pct={stage.pct} tone={stage.tone} />
        {isFailed && job.error_message && (
          <p className="mt-2 line-clamp-2 text-xs text-red-400">{job.error_message}</p>
        )}
      </div>

      {/* One-prompt → three outputs contract indicator (read-only) */}
      <div className="mt-4 flex items-center gap-3 text-[10px] text-slate-500">
        <ContractDot ok={hasHero} icon={Sparkles} label="Hero" />
        <ContractDot ok={hasClean} icon={ImageIcon} label="Clean L1" />
        <ContractDot ok={has2d} icon={Grid2x2} label="2D Blueprint" />
      </div>
    </button>
  );
}

function ContractDot({
  ok,
  icon: Icon,
  label,
}: {
  ok: boolean;
  icon: typeof Sparkles;
  label: string;
}) {
  return (
    <span className={cn("flex items-center gap-1", ok ? "text-cyan-400" : "text-slate-600")}>
      <Icon className="h-3 w-3" />
      {label}
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-cyan-400" : "bg-slate-700")} />
    </span>
  );
}

// ── Layer-2 overlay download dialog (multi-overlay jobs) ──────────────────────
function Layer2Dialog({
  open,
  onOpenChange,
  overlays,
  orderNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  overlays: OverlayPng[];
  orderNumber: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-slate-700 bg-slate-900 text-slate-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-slate-100">
            <Layers className="h-4 w-4 text-cyan-400" />
            Layer 2 overlays — {orderNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {overlays.map((o, i) => (
            <button
              key={o.id || o.url || i}
              onClick={() => downloadUrl(o.url)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-left text-sm transition-colors hover:border-cyan-500/60 hover:bg-slate-800"
            >
              <span className="truncate">
                {o.role || o.text || (o.kind === "logo" ? "Logo" : "Text")} #{i + 1}
              </span>
              <ImageDown className="h-4 w-4 shrink-0 text-cyan-400" />
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Column 3: right utility panel (tools for the selected job) ────────────────
function UtilityPanel({
  job,
  assets,
  onClose,
  onRefetch,
}: {
  job: PanelizerJob;
  assets?: GenerationAssets;
  onClose: () => void;
  onRefetch: () => void;
}) {
  const orderNumber = orderNo(job);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [layer2Open, setLayer2Open] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const overlays = (assets?.overlay_pngs || []).filter((o) => o?.url);
  const layer1Url = assets?.background_url || job.approved_render_url || null;
  // Original customer prompt for QC validation — prefer the saved source_prompt
  // on the asset row, fall back to the job's concept_json.
  const prompt =
    (typeof assets?.source_prompt === "string" && assets.source_prompt) ||
    (typeof job.concept_json?.prompt === "string" ? (job.concept_json.prompt as string) : null) ||
    (typeof job.concept_json?.raw_prompt === "string" ? (job.concept_json.raw_prompt as string) : null);

  const onDownloadLayer1 = () => {
    if (!layer1Url) return toast.error("No Layer-1 background available yet.");
    downloadUrl(layer1Url);
  };
  const onDownloadLayer2 = () => {
    if (!overlays.length) return toast.error("No Layer-2 overlay PNGs persisted yet.");
    if (overlays.length === 1) return downloadUrl(overlays[0].url);
    setLayer2Open(true);
  };

  const uploadTemplate = useCallback(
    async (file: File) => {
      setUploading(true);
      try {
        const path = `wrapbox/${orderNumber}/templates/${file.name}`;
        const { error } = await supabase.storage
          .from("wrap-files")
          .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: true });
        if (error) throw error;
        setTemplateName(file.name);
        toast.success(`Template "${file.name}" staged for ${orderNumber}`);
      } catch (e) {
        console.error("[BOH] template upload failed:", e);
        toast.error(`Template upload failed: ${(e as Error)?.message || "unknown"}`);
      } finally {
        setUploading(false);
      }
    },
    [orderNumber],
  );

  const onApproveAndPush = async () => {
    setPushing(true);
    try {
      const { data, error } = await renderClient.functions.invoke("run-master-artboard-flow", {
        body: { job_id: job.id },
      });
      if (error) throw new Error((data as { error?: string })?.error || error.message);
      toast.success(`Pushed ${orderNumber} to WrapBox packaging`);
      onRefetch();
    } catch (e) {
      console.error("[BOH] push to wrapbox failed:", e);
      toast.error(`Push to WrapBox failed: ${(e as Error)?.message || "unknown"}`);
    } finally {
      setPushing(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <p className="font-mono text-sm font-semibold text-cyan-300">{orderNumber}</p>
          <p className="truncate text-[11px] text-slate-500">{vehicleLabel(job)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-7 w-7 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {/* Execution contract (read-only) */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            One-prompt execution contract
          </h3>
          {prompt && (
            <p className="mb-3 rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2 text-xs italic text-slate-400">
              “{prompt}”
            </p>
          )}
          <div className="space-y-1.5">
            <ContractRow ok={!!job.approved_render_url} label="Loop 1 · Hero (approved_render_url)" url={job.approved_render_url} />
            <ContractRow ok={!!assets?.background_url} label="Loop 2 · Clean Layer 1 (background_url)" url={assets?.background_url ?? null} />
            <ContractRow ok={!!assets?.proof_2d_url} label="2D Blueprint (proof_2d_url)" url={assets?.proof_2d_url ?? null} />
          </div>
        </section>

        {/* LayerLiftIQ split download gates */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            LayerLiftIQ split downloads
          </h3>
          <div className="space-y-2.5">
            <Button
              variant="outline"
              onClick={onDownloadLayer1}
              disabled={!layer1Url}
              className="h-auto w-full flex-col items-start gap-0.5 border-slate-700 bg-slate-800/40 py-2.5 text-left hover:border-blue-500/60 hover:bg-slate-800 disabled:opacity-40"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <ImageDown className="h-3.5 w-3.5 text-blue-400" /> Layer 1 — Background
              </span>
              <span className="text-[10px] font-normal text-slate-500">
                {assets?.background_url ? "Text-free upscaled texture" : layer1Url ? "Approved render (fallback)" : "Not ready"}
              </span>
            </Button>
            <Button
              variant="outline"
              onClick={onDownloadLayer2}
              disabled={!overlays.length}
              className="h-auto w-full flex-col items-start gap-0.5 border-slate-700 bg-slate-800/40 py-2.5 text-left hover:border-cyan-500/60 hover:bg-slate-800 disabled:opacity-40"
            >
              <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
                <Layers className="h-3.5 w-3.5 text-cyan-400" /> Layer 2 — Overlay PNGs
              </span>
              <span className="text-[10px] font-normal text-slate-500">
                {overlays.length ? `${overlays.length} transparent PNG${overlays.length > 1 ? "s" : ""}` : "No overlays"}
              </span>
            </Button>
          </div>
        </section>

        {/* Pack finalizer */}
        <section>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Pack finalizer
          </h3>
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) uploadTemplate(f);
            }}
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-3 py-5 text-center transition-colors",
              dragOver ? "border-cyan-500/70 bg-cyan-500/5" : "border-slate-700 hover:bg-slate-800/40",
            )}
          >
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadTemplate(f);
                e.target.value = "";
              }}
            />
            {uploading ? (
              <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
            ) : (
              <UploadCloud className={cn("h-5 w-5", templateName ? "text-emerald-400" : "text-slate-500")} />
            )}
            <p className="text-xs text-slate-400">
              {templateName ? (
                <span className="text-emerald-400">{templateName} staged</span>
              ) : (
                <>Drop verified production template <span className="text-slate-500">or click to browse</span></>
              )}
            </p>
          </div>

          <Button
            onClick={onApproveAndPush}
            disabled={pushing}
            className="mt-3 w-full bg-gradient-to-r from-blue-600 to-cyan-500 font-semibold text-white shadow-lg shadow-blue-900/40 hover:from-blue-500 hover:to-cyan-400 disabled:opacity-60"
          >
            {pushing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pushing…
              </>
            ) : (
              <>
                <Rocket className="mr-2 h-4 w-4" /> Approve &amp; Push to WrapBox
              </>
            )}
          </Button>

          {job.zip_signed_url && (
            <button
              onClick={() => downloadUrl(job.zip_signed_url!)}
              className="mt-2 flex w-full items-center justify-center gap-1.5 text-[11px] text-slate-500 transition-colors hover:text-cyan-400"
            >
              <FileArchive className="h-3 w-3" /> Download current WrapBox ZIP
            </button>
          )}
        </section>
      </div>

      <Layer2Dialog open={layer2Open} onOpenChange={setLayer2Open} overlays={overlays} orderNumber={orderNumber} />
    </div>
  );
}

function ContractRow({ ok, label, url }: { ok: boolean; label: string; url: string | null }) {
  const inner = (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2">
      <span className="flex items-center gap-2 text-xs text-slate-300">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", ok ? "bg-emerald-400" : "bg-slate-600")} />
        <span className="truncate">{label}</span>
      </span>
      {ok && url && <ImageDown className="h-3.5 w-3.5 shrink-0 text-cyan-400" />}
    </div>
  );
  return ok && url ? (
    <button onClick={() => downloadUrl(url)} className="block w-full text-left transition-opacity hover:opacity-80">
      {inner}
    </button>
  ) : (
    inner
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function AdminManufacturingPipeline() {
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["admin-manufacturing-pipeline"],
    refetchInterval: 8000,
    queryFn: async () => {
      const { data: jobs, error } = await supabase
        .from("panelizer_jobs")
        .select(
          "id, order_number, generation_id, vehicle_year, vehicle_make, vehicle_model, vehicle_trim, status, current_stage, stage_progress, concept_json, approved_render_url, all_view_urls, zip_signed_url, error_message, created_at, updated_at, completed_at",
        )
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;

      const list = (jobs || []) as PanelizerJob[];
      const genIds = Array.from(new Set(list.map((j) => j.generation_id).filter(Boolean))) as string[];
      const assetMap: Record<string, GenerationAssets> = {};
      if (genIds.length) {
        const { data: assets } = await supabase
          .from("design_generation_assets")
          .select("generation_id, background_url, overlay_pngs, proof_2d_url, proof_3d_url, source_prompt, is_current")
          .in("generation_id", genIds)
          .eq("is_current", true);
        for (const a of (assets || []) as (GenerationAssets & { is_current: boolean })[]) {
          assetMap[a.generation_id] = a;
        }
      }
      return { jobs: list, assetMap };
    },
  });

  const jobs = useMemo(() => data?.jobs || [], [data]);
  const assetMap = data?.assetMap || {};

  // Keep a sensible selection as data streams in.
  useEffect(() => {
    if (!jobs.length) return;
    if (!selectedJobId || !jobs.some((j) => j.id === selectedJobId)) {
      setSelectedJobId(jobs[0].id);
    }
  }, [jobs, selectedJobId]);

  const selectedJob = jobs.find((j) => j.id === selectedJobId) || null;
  const selectedAssets = selectedJob?.generation_id ? assetMap[selectedJob.generation_id] : undefined;

  const activeCount = useMemo(
    () => jobs.filter((j) => !["ready", "ready_for_print", "failed"].includes((j.status || "").toLowerCase())).length,
    [jobs],
  );

  return (
    <div className="flex min-h-[100dvh] bg-slate-950 text-slate-100">
      {/* Column 2 — fluid center workspace */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-800/80 px-6 py-5">
          <div>
            <h1 className="flex items-center gap-2.5 text-xl font-bold">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 shadow-lg shadow-blue-900/40">
                <Factory className="h-5 w-5 text-white" />
              </span>
              <span>
                G.E.N.I.E. Manufacturing Pipeline
                <span className="ml-2 align-middle text-sm font-medium text-slate-500">Back of House</span>
              </span>
            </h1>
            <p className="mt-1.5 text-sm text-slate-400">
              Live <span className="font-mono text-cyan-400">panelizer_jobs</span> queue · monitoring only
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1 text-xs text-slate-300">
              <span className="font-semibold text-cyan-400">{activeCount}</span> active ·{" "}
              <span className="font-semibold text-slate-200">{jobs.length}</span> shown
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsRightPanelOpen((v) => !v)}
              className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
            >
              {isRightPanelOpen ? <PanelRightClose className="mr-1.5 h-3.5 w-3.5" /> : <PanelRightOpen className="mr-1.5 h-3.5 w-3.5" />}
              Tools
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {isLoading ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-56 rounded-2xl bg-slate-900" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 py-24 text-center">
              <Factory className="mb-3 h-10 w-10 text-slate-700" />
              <p className="text-slate-400">No jobs in the pipeline.</p>
              <p className="text-sm text-slate-600">Paid $299 production orders land here automatically.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
              {jobs.map((job) => (
                <PipelineCard
                  key={job.id}
                  job={job}
                  assets={job.generation_id ? assetMap[job.generation_id] : undefined}
                  selected={job.id === selectedJobId}
                  onSelect={() => {
                    setSelectedJobId(job.id);
                    setIsRightPanelOpen(true);
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Column 3 — 380px collapsible right utility panel */}
      <aside
        className={cn(
          "shrink-0 overflow-hidden border-l border-slate-800 bg-slate-900/70 backdrop-blur transition-[width] duration-300 ease-out",
          isRightPanelOpen ? "w-[380px]" : "w-0 border-l-0",
        )}
      >
        {isRightPanelOpen && (
          <div className="h-full w-[380px]">
            {selectedJob ? (
              <UtilityPanel
                job={selectedJob}
                assets={selectedAssets}
                onClose={() => setIsRightPanelOpen(false)}
                onRefetch={refetch}
              />
            ) : (
              <div className="flex h-full flex-col items-center justify-center px-6 text-center text-slate-500">
                <Layers className="mb-3 h-8 w-8 text-slate-700" />
                <p className="text-sm">Select a job to load its manufacturing tools.</p>
              </div>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
