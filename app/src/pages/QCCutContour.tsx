/**
 * QCCutContour — admin QC artboard for GraphicsPro Studio cut-contour jobs.
 *
 * Operates on flat studio output (the retired /qc-artboard handled render output)
 * of vehicle panels. Reads panelizer_jobs rows where
 *   concept_json.source === "graphicspro_studio"
 *   status IN ('needs_qc_review', 'ready_for_production')
 *
 * Renders the SVG from cut_path_svg_url on a white artboard, runs the WPW
 * cut-contour spec checklist against concept_json.wpw_spec, surfaces the
 * review_flags that generateStudioProductionPack wrote, and lets the admin
 * approve or send back. Approve flips status to qc_approved and fires off
 * package-production-files for the final WPW-compliant PDF.
 *
 * The canonical WPW spec this page validates against lives in
 * supabase/functions/_shared/production/wpw-cut-contour-spec.md.
 */

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Scissors,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  Search,
  ArrowRight,
  Layers,
  Download,
  Send,
  FileImage,
  RotateCw,
  Eye,
  EyeOff,
  Sparkles,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Types — narrow the panelizer_jobs row shape to just the studio fields we
// actually read. Anything else stays on the unknown side of the typed query.
// ---------------------------------------------------------------------------

interface WpwSpec {
  spot_color_name?: string;
  spot_color_cmyk?: { c?: number; m?: number; y?: number; k?: number };
  stroke_weight_pt?: number;
  stroke_fill?: string;
  layer_order?: string[];
  bleed_color?: string;
  bleed_offset_join?: string;
}

interface StudioLayer {
  index?: number;
  label?: string;
  copy?: string;
  width_inches?: number;
  height_inches?: number;
  film?: string | null;
}

interface StudioConcept {
  source?: string;
  cut_style?: "printed" | "cut";
  bleed_inches?: number;
  wpw_spec?: WpwSpec;
  layers?: StudioLayer[];
  review_flags?: string[];
  mockup_url?: string;
  flat_proof_url?: string;
  design_name?: string;
}

interface StudioJob {
  id: string;
  order_number: string | null;
  status: string;
  created_at: string | null;
  cut_path_svg_url: string | null;
  concept_json: StudioConcept | null;
  qc_notes?: string | null;
  qc_approved_at?: string | null;
}

const STUDIO_STATUSES = [
  "needs_qc_review",
  "ready_for_production",
  "qc_approved",
  "needs_revision",
] as const;

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  needs_qc_review:       { text: "Needs review",     cls: "bg-amber-100 text-amber-700 border-amber-200" },
  ready_for_production:  { text: "Ready",            cls: "bg-cyan-100 text-cyan-700 border-cyan-200" },
  qc_approved:           { text: "Approved",         cls: "bg-green-100 text-green-700 border-green-200" },
  needs_revision:        { text: "Sent back",        cls: "bg-rose-100 text-rose-700 border-rose-200" },
};

// ---------------------------------------------------------------------------
// WPW spec compliance check — matches wpw-cut-contour-spec.md §2 and §1. The
// real validator lives server-side (qc-cutcontour-validate, optional next
// step) and parses the actual SVG. This client-side pass just looks at the
// metadata block Studio wrote into concept_json so the admin can see the
// expected vs. actual values at a glance.
// ---------------------------------------------------------------------------

interface ComplianceCheck {
  id: string;
  label: string;
  pass: boolean;
  actual: string;
}

function runWpwChecks(concept: StudioConcept | null): ComplianceCheck[] {
  const spec = concept?.wpw_spec || {};
  const cmyk = spec.spot_color_cmyk || {};
  const layers = spec.layer_order || [];
  const expectedOrder = ["cut", "art", "bleed"];
  const bleedIn = concept?.bleed_inches ?? 0;
  return [
    {
      id: "spot_name",
      label: "Spot color named 'CutContour'",
      pass: spec.spot_color_name === "CutContour",
      actual: spec.spot_color_name || "(missing)",
    },
    {
      id: "spot_cmyk",
      label: "CMYK 0 / 100 / 0 / 0 (pure magenta)",
      pass: cmyk.c === 0 && cmyk.m === 100 && cmyk.y === 0 && cmyk.k === 0,
      actual: `${cmyk.c ?? "?"} / ${cmyk.m ?? "?"} / ${cmyk.y ?? "?"} / ${cmyk.k ?? "?"}`,
    },
    {
      id: "stroke",
      label: "0.25pt hairline stroke, no fill",
      pass: spec.stroke_weight_pt === 0.25 && (spec.stroke_fill === "none" || !spec.stroke_fill),
      actual: `${spec.stroke_weight_pt ?? "?"}pt / ${spec.stroke_fill || "?"}`,
    },
    {
      id: "layers",
      label: "Three layers: cut · art · bleed",
      pass:
        layers.length === 3 &&
        layers.every((l, i) => l === expectedOrder[i]),
      actual: layers.length ? layers.join(" · ") : "(missing)",
    },
    {
      id: "bleed",
      label: "Black bleed offset configured",
      pass: spec.bleed_color === "black" && bleedIn > 0,
      actual: spec.bleed_color
        ? `${spec.bleed_color} @ ${bleedIn || 0}"`
        : "(none)",
    },
  ];
}

// Human-readable form of "letters_under_2in:Zone 1,Zone 3" review flags.
function describeFlag(flag: string): { title: string; zones?: string } {
  const [key, rest] = flag.split(":");
  const zones = rest ? rest.split(",").map((s) => s.trim()).filter(Boolean).join(", ") : undefined;
  switch (key) {
    case "letters_under_2in":
      return { title: "Letters under 2\" tall — may chip on the plotter", zones };
    case "missing_film":
      return { title: "Zone missing film color — cut-only layer not assigned", zones };
    case "hairline_stroke":
      return { title: "Hairline stroke detected — may break on weed", zones };
    case "raster_low_confidence":
      return { title: "Vectorize confidence < 0.85 — manual cleanup likely", zones };
    default:
      return { title: key.replace(/_/g, " "), zones };
  }
}

function designNameOf(j: StudioJob): string {
  return j.concept_json?.design_name || j.order_number || `Studio job ${j.id.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function QCCutContour() {
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("id");
  const [search, setSearch] = useState("");
  const [showCut, setShowCut] = useState(true);
  const [showArt, setShowArt] = useState(true);
  const [showBleed, setShowBleed] = useState(true);
  const [notes, setNotes] = useState("");
  const qc = useQueryClient();

  const { data: jobs, isLoading } = useQuery({
    queryKey: ["studio-qc-jobs"],
    queryFn: async (): Promise<StudioJob[]> => {
      const { data, error } = await supabase
        .from("panelizer_jobs" as any)
        .select("id, order_number, status, created_at, cut_path_svg_url, concept_json")
        .in("status", STUDIO_STATUSES as unknown as string[])
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      const rows = (data || []) as unknown as StudioJob[];
      return rows.filter((r) => r.concept_json?.source === "graphicspro_studio");
    },
    refetchInterval: 15000,
  });

  // Default the selection to the first job once data lands.
  useEffect(() => {
    if (!selectedId && jobs && jobs.length > 0) {
      setParams({ id: jobs[0].id }, { replace: true });
    }
  }, [jobs, selectedId, setParams]);

  // Reset notes whenever the selected job changes.
  useEffect(() => {
    setNotes("");
  }, [selectedId]);

  const filtered = useMemo(() => {
    if (!jobs) return [];
    const q = search.trim().toLowerCase();
    if (!q) return jobs;
    return jobs.filter((j) =>
      [j.order_number, designNameOf(j), j.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [jobs, search]);

  const selected = useMemo(
    () => (selectedId ? jobs?.find((j) => j.id === selectedId) : undefined),
    [selectedId, jobs],
  );

  const checks = useMemo(() => runWpwChecks(selected?.concept_json || null), [selected]);
  const failingChecks = checks.filter((c) => !c.pass).length;
  const reviewFlags = selected?.concept_json?.review_flags || [];
  const blockedByFlags = reviewFlags.length > 0 || failingChecks > 0;

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No job selected");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("panelizer_jobs" as any)
        .update({
          status: "qc_approved",
          qc_notes: notes || null,
          qc_approved_by: user?.id || null,
          qc_approved_at: new Date().toISOString(),
        })
        .eq("id", selected.id);
      if (error) throw error;
      // Fire-and-forget — the packager is independent from the row update so
      // a transient packager failure doesn't roll back QC approval.
      supabase.functions
        .invoke("package-production-files", { body: { job_id: selected.id } })
        .catch((e) => console.warn("[QCCutContour] packager invoke failed:", e));
    },
    onSuccess: () => {
      toast.success("Job approved — final PDF queued");
      qc.invalidateQueries({ queryKey: ["studio-qc-jobs"] });
    },
    onError: (e: any) => {
      toast.error("Approve failed", { description: e?.message });
    },
  });

  const sendBackMutation = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No job selected");
      if (!notes.trim()) throw new Error("Add a note so the customer knows what to fix");
      const { error } = await supabase
        .from("panelizer_jobs" as any)
        .update({
          status: "needs_revision",
          qc_notes: notes,
        })
        .eq("id", selected.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Sent back for revision");
      qc.invalidateQueries({ queryKey: ["studio-qc-jobs"] });
    },
    onError: (e: any) => {
      toast.error("Send-back failed", { description: e?.message });
    },
  });

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900">
      <header className="border-b bg-white px-6 py-3 flex items-center gap-3">
        <Scissors className="w-5 h-5 text-cyan-700" />
        <div className="flex-1">
          <h1 className="text-base font-semibold tracking-tight">QC Cut Contour</h1>
          <p className="text-[11px] text-zinc-500">
            GraphicsPro Studio jobs awaiting cut-contour review (WPW spec)
          </p>
        </div>
        {isLoading && <Loader2 className="w-4 h-4 animate-spin text-zinc-400" />}
      </header>

      <div className="grid grid-cols-[300px_1fr_360px] gap-4 p-4">
        {/* ── Left rail: job list ─────────────────────────────────────── */}
        <Card className="p-3 space-y-2 h-[calc(100vh-100px)] flex flex-col">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-cyan-700" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-cyan-900">
              Studio Jobs
            </h2>
            <Badge variant="outline" className="ml-auto text-[10px] h-4 px-1">
              {jobs?.length ?? 0}
            </Badge>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-zinc-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search RP-order, design name…"
              className="pl-7 h-8 text-xs"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {filtered.length === 0 && !isLoading && (
              <p className="text-[11px] text-zinc-500 italic px-1 py-4 text-center">
                No studio jobs in QC.
              </p>
            )}
            {filtered.map((job) => {
              const status = STATUS_LABEL[job.status] || { text: job.status, cls: "bg-zinc-100 text-zinc-700 border-zinc-200" };
              const flagCount = (job.concept_json?.review_flags || []).length;
              const isSelected = job.id === selectedId;
              return (
                <button
                  key={job.id}
                  type="button"
                  onClick={() => setParams({ id: job.id }, { replace: true })}
                  className={cn(
                    "w-full text-left rounded-md border bg-white p-2 transition-colors",
                    isSelected
                      ? "border-cyan-500 ring-1 ring-cyan-500/40"
                      : "border-zinc-200 hover:border-cyan-300",
                  )}
                >
                  <div className="flex items-center justify-between gap-1.5 mb-1">
                    <span className="text-[12px] font-semibold truncate">{designNameOf(job)}</span>
                    <Badge variant="outline" className={cn("text-[8px] h-3.5 px-1 shrink-0", status.cls)}>
                      {status.text}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1 text-[10px] text-zinc-500">
                    {job.order_number && (
                      <span className="font-mono text-cyan-700 font-semibold">#{job.order_number}</span>
                    )}
                    <span>·</span>
                    <span>{job.concept_json?.cut_style || "printed"}</span>
                    {flagCount > 0 && (
                      <>
                        <span>·</span>
                        <span className="flex items-center gap-0.5 text-amber-700">
                          <AlertTriangle className="w-2.5 h-2.5" />
                          {flagCount}
                        </span>
                      </>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* ── Center: artboard canvas ─────────────────────────────────── */}
        <Card className="p-4 h-[calc(100vh-100px)] flex flex-col">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center text-sm text-zinc-400">
              {isLoading ? "Loading studio jobs…" : "Select a job from the left rail"}
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-sm font-semibold">{designNameOf(selected)}</h2>
                  <p className="text-[11px] text-zinc-500">
                    {selected.concept_json?.cut_style === "cut" ? "Layered cut vinyl" : "Print & cut"}
                    {" · bleed "}
                    {selected.concept_json?.bleed_inches ?? 0}"
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <LayerToggle label="Cut"   color="bg-fuchsia-500" on={showCut}   onChange={setShowCut} />
                  <LayerToggle label="Art"   color="bg-zinc-700"    on={showArt}   onChange={setShowArt} />
                  <LayerToggle label="Bleed" color="bg-black"       on={showBleed} onChange={setShowBleed} />
                </div>
              </div>

              <div className="flex-1 rounded border-2 border-dashed border-zinc-200 bg-white relative overflow-hidden">
                {selected.cut_path_svg_url ? (
                  <ArtboardCanvas
                    svgUrl={selected.cut_path_svg_url}
                    artUrl={selected.concept_json?.mockup_url || selected.concept_json?.flat_proof_url || null}
                    showCut={showCut}
                    showArt={showArt}
                    showBleed={showBleed}
                    bleedInches={selected.concept_json?.bleed_inches ?? 0.125}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-zinc-400">
                    No cut path SVG yet — job hasn't been vectorized.
                  </div>
                )}
              </div>

              {selected.cut_path_svg_url && (
                <div className="flex items-center gap-2 mt-2">
                  <a
                    href={selected.cut_path_svg_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] text-cyan-700 hover:underline inline-flex items-center gap-1"
                  >
                    <Download className="w-3 h-3" /> Download SVG
                  </a>
                  <span className="text-zinc-300">·</span>
                  <span className="text-[11px] text-zinc-500 font-mono truncate">
                    {selected.cut_path_svg_url.split("/").pop()}
                  </span>
                </div>
              )}
            </>
          )}
        </Card>

        {/* ── Right: inspector ────────────────────────────────────────── */}
        <Card className="p-4 h-[calc(100vh-100px)] flex flex-col overflow-y-auto">
          {!selected ? (
            <p className="text-sm text-zinc-400">Select a job to inspect.</p>
          ) : (
            <div className="space-y-4">
              {/* WPW compliance checklist */}
              <section>
                <div className="flex items-center gap-1.5 mb-2">
                  <Layers className="w-3.5 h-3.5 text-cyan-700" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-900">
                    WPW Spec
                  </h3>
                  <Badge
                    variant="outline"
                    className={cn(
                      "ml-auto text-[10px] h-4 px-1",
                      failingChecks === 0
                        ? "bg-green-50 text-green-700 border-green-200"
                        : "bg-rose-50 text-rose-700 border-rose-200",
                    )}
                  >
                    {checks.length - failingChecks}/{checks.length}
                  </Badge>
                </div>
                <ul className="space-y-1">
                  {checks.map((c) => (
                    <li key={c.id} className="flex items-start gap-2 text-[11px]">
                      {c.pass ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-600 mt-0.5 shrink-0" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-rose-600 mt-0.5 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className={cn("font-medium", !c.pass && "text-rose-700")}>{c.label}</p>
                        <p className="text-zinc-500 font-mono text-[10px]">{c.actual}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              {/* Review flags — surface what generateStudioProductionPack
                  already detected. Each one is a manual-review trigger from
                  wpw-cut-contour-spec.md §5 ("letters < 2 inches", etc.). */}
              {reviewFlags.length > 0 && (
                <section>
                  <div className="flex items-center gap-1.5 mb-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-amber-900">
                      Review flags
                    </h3>
                  </div>
                  <ul className="space-y-1.5">
                    {reviewFlags.map((flag) => {
                      const d = describeFlag(flag);
                      return (
                        <li
                          key={flag}
                          className="rounded border border-amber-200 bg-amber-50 p-2 text-[11px]"
                        >
                          <p className="font-medium text-amber-900">{d.title}</p>
                          {d.zones && (
                            <p className="text-amber-700 mt-0.5">Zones: {d.zones}</p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {/* Per-layer panel */}
              {selected.concept_json?.layers && selected.concept_json.layers.length > 0 && (
                <section>
                  <div className="flex items-center gap-1.5 mb-2">
                    <FileImage className="w-3.5 h-3.5 text-cyan-700" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-cyan-900">
                      Layers
                    </h3>
                  </div>
                  <ul className="space-y-1.5">
                    {selected.concept_json.layers.map((layer) => (
                      <li
                        key={layer.index ?? layer.label}
                        className="rounded border border-zinc-200 bg-white p-2 text-[11px]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-semibold">{layer.label || `Layer ${layer.index}`}</span>
                          {layer.film && (
                            <Badge variant="outline" className="text-[9px] h-3.5 px-1">
                              {layer.film}
                            </Badge>
                          )}
                        </div>
                        {layer.copy && (
                          <p className="text-zinc-600 italic mt-0.5 truncate">"{layer.copy}"</p>
                        )}
                        <p className="text-zinc-500 font-mono text-[10px] mt-0.5">
                          {(layer.width_inches ?? 0).toFixed(2)}" × {(layer.height_inches ?? 0).toFixed(2)}"
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <Separator />

              {/* Notes + actions */}
              <section>
                <Label htmlFor="qc-notes" className="text-[11px] font-semibold uppercase tracking-wider text-zinc-700">
                  QC notes
                </Label>
                <Textarea
                  id="qc-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional on approve · required when sending back"
                  rows={3}
                  className="mt-1 text-xs"
                />
              </section>

              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  className="w-full bg-green-600 hover:bg-green-700"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || selected.status === "qc_approved"}
                >
                  {approveMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  {selected.status === "qc_approved" ? "Already approved" : "Approve & queue PDF"}
                </Button>
                {blockedByFlags && selected.status !== "qc_approved" && (
                  <p className="text-[10px] text-amber-700 -mt-1">
                    Heads up: {failingChecks} spec issue{failingChecks === 1 ? "" : "s"} and {reviewFlags.length} flag
                    {reviewFlags.length === 1 ? "" : "s"} still open. Approve only if you've verified them by hand.
                  </p>
                )}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full border-rose-200 text-rose-700 hover:bg-rose-50"
                  onClick={() => sendBackMutation.mutate()}
                  disabled={sendBackMutation.isPending}
                >
                  {sendBackMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <RotateCw className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Send back for revision
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function LayerToggle({
  label,
  color,
  on,
  onChange,
}: {
  label: string;
  color: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={cn(
        "flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border transition-colors",
        on ? "bg-white border-zinc-300" : "bg-zinc-50 border-zinc-200 text-zinc-400 line-through",
      )}
    >
      <span className={cn("w-2 h-2 rounded-full", color, !on && "opacity-30")} />
      {label}
      {on ? <Eye className="w-3 h-3 ml-1" /> : <EyeOff className="w-3 h-3 ml-1" />}
    </button>
  );
}

/**
 * ArtboardCanvas — composites the three WPW layers on a single white board.
 *
 * Order matches the WPW file structure (top to bottom):
 *   1. Cut layer   — the vectorized SVG rendered with magenta tint, on top
 *   2. Art layer   — the mockup / flat proof image, in the middle
 *   3. Bleed layer — black mask offset under the art (visualized as a black
 *      border on the wrapping div sized by `bleed_inches`)
 *
 * The bleed visualization is approximate — a true offset path lives in the
 * SVG once vectorize-it runs. The server-side qc-cutcontour-validate (Step 3
 * in the brief) will eventually parse the SVG and overlay the real bleed.
 */
function ArtboardCanvas({
  svgUrl,
  artUrl,
  showCut,
  showArt,
  showBleed,
  bleedInches,
}: {
  svgUrl: string;
  artUrl: string | null;
  showCut: boolean;
  showArt: boolean;
  showBleed: boolean;
  bleedInches: number;
}) {
  // Convert "0.125 in" to a visual px offset for the bleed preview. The
  // canvas is conceptually scaled so 1in ≈ 24px which keeps a 0.25" bleed
  // visible without dominating the artboard.
  const bleedPx = Math.max(0, Math.round(bleedInches * 24));
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      <div
        className="relative max-w-full max-h-full"
        style={{
          padding: showBleed ? bleedPx : 0,
          background: showBleed ? "#000" : "transparent",
        }}
      >
        <div className="relative bg-white" style={{ minWidth: 320, minHeight: 200 }}>
          {showArt && artUrl && (
            <img
              src={artUrl}
              alt="Mockup art"
              className="block max-w-[60vw] max-h-[60vh] object-contain"
            />
          )}
          {!artUrl && (
            <div className="px-12 py-16 text-center text-xs text-zinc-400">
              No mockup attached — Cut layer only.
            </div>
          )}
          {showCut && (
            <img
              src={svgUrl}
              alt="Cut path"
              className="absolute inset-0 w-full h-full object-contain mix-blend-multiply"
              style={{ filter: "hue-rotate(280deg) saturate(3) brightness(0.95)" }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
