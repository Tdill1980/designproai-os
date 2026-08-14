/**
 * AdminProductionFiles — /admin/production-files
 *
 * Dedicated production-file hub: every panel-artboard job with its print
 * panels, named by side + size, with one-click Download and on-demand
 * Topaz upscaling (2× / 4× via upscale-production-panel). Upscaled copies
 * are saved back to the job's print/ folder with a proper filename and
 * registered as assets, so the team never has to dig through storage.
 *
 * ORDER-CENTRIC master-detail layout (like the ApprovePro manager):
 * the left rail lists ORDERS (panel_artboard_jobs grouped by the order
 * number extracted from the job prompt — "RP-100889" / "#34934" — plus
 * DesignPro Artboards (jobs self-registered with mode='designpro' by
 * designpro-artboard / designpro-flat-art, one job per generation) and
 * WrapDesign/ApprovePro jobs under their own section headers), and the
 * right pane shows the selected order's page keyed by ?order=<key>.
 *
 * White UI per docs/WHITE_UI_STANDARD.md: white surface, dark text,
 * blue→magenta gradient as accent only. (Header/nav rails stay black globally.)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { ArrowLeft, Download, Layers, Loader2, PenTool, RefreshCw, Search, Sparkles, FileImage, Trash2, X } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface PAJob {
  id: string;
  prompt: string | null;
  mode: string | null;
  vehicle_year: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  finish: string | null;
  reference_image_url: string | null;
  created_at: string;
}

interface PAAsset {
  id: string;
  job_id: string;
  kind: string;
  label: string;
  panel_label: string | null;
  width_inches: number | null;
  height_inches: number | null;
  dpi: number | null;
  storage_path: string | null;
  url: string;
  created_at: string;
}

interface OrderEntry {
  key: string;          // stable key used for selection + ?order= deep link
  label: string;        // order number ("RP-100889" / "#34934") or prompt prefix / DID
  vehicle: string;      // "year make model"
  date: string;         // newest job created_at in the order
  type: "production" | "designpro" | "approvepro";
  jobs: PAJob[];        // production/designpro: all jobs in the order (newest first)
  apJob?: any;          // approvepro: the color_visualizations row
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// Order key extraction: "RP-100889", "RP- 100889", "#34934" anywhere in the prompt.
const ORDER_RE = /(?:RP-|#)\s?\d{4,}/;

// Preview giant print files via the storage image-transform endpoint — a 40MB
// panel PNG renders as a ~480px thumbnail instantly instead of downloading.
// NOTE: width-only transforms come back as vertical slivers (Supabase applies
// resize:cover against a default frame — verified 640x1536 from a landscape
// source). Explicit landscape geometry + resize=contain returns a true
// letterboxed landscape preview.
const thumb = (url: string, w = 640) =>
  url && url.includes("/storage/v1/object/")
    ? url.replace("/storage/v1/object/", "/storage/v1/render/image/") + (url.includes("?") ? "&" : "?") + `width=${w}&height=${Math.round(w * 9 / 16)}&resize=contain&quality=70`
    : url;

// GPU-cap-safe source for the ESRGAN A100 engine: feed a transform-resized
// copy (contain in a WxW box, original format) instead of the full-res panel
// so an 8× pass lands under the GPU's pixel budget. Wide panels (>150″) get a
// 2600px box; everything else 1700px. Landscape panels contained in a square
// box come out exactly W pixels wide — used below to derive the output DPI.
const ESRGAN_SCALE = 8;
const esrganCapPx = (a: PAAsset) => ((a.width_inches ?? 0) > 150 ? 2600 : 1700);
const gpuSafeUrl = (a: PAAsset) => {
  if (!a.url || !a.url.includes("/storage/v1/object/")) return a.url;
  const w = esrganCapPx(a);
  return a.url.replace("/storage/v1/object/", "/storage/v1/render/image/")
    + (a.url.includes("?") ? "&" : "?")
    + `width=${w}&height=${w}&resize=contain&format=origin`;
};

// ---- COMPARE VS TRUCK (QC) -------------------------------------------
// Full-screen QC modal: line the flat PANEL artwork up against the order's
// matching 3D proof render. Overlay mode = onion-skin (draggable/resizable
// panel rectangle over the truck render, opacity slider); Side-by-side mode
// = render over panel, zoomable with synchronized horizontal scroll.
function CompareModal({ panel, render, onClose }: { panel: PAAsset; render: PAAsset; onClose: () => void }) {
  const [mode, setMode] = useState<"overlay" | "side">("overlay");
  const [opacity, setOpacity] = useState(55);
  const [zoom, setZoom] = useState(1);
  // Overlay rectangle: position + width (height follows the image's aspect).
  const [box, setBox] = useState({ x: 48, y: 48, w: 520 });
  const dragRef = useRef<{ kind: "move" | "resize"; startX: number; startY: number; box: { x: number; y: number; w: number } } | null>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const startDrag = (kind: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, box };
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.kind === "move") setBox({ ...d.box, x: d.box.x + dx, y: d.box.y + dy });
    else setBox({ ...d.box, w: Math.max(80, d.box.w + dx) });
  };
  const endDrag = () => { dragRef.current = null; };

  // Mirror horizontal scroll between the two side-by-side strips when zoomed.
  const syncScroll = (src: React.RefObject<HTMLDivElement>, dst: React.RefObject<HTMLDivElement>) => () => {
    if (syncingRef.current) { syncingRef.current = false; return; }
    if (src.current && dst.current && dst.current.scrollLeft !== src.current.scrollLeft) {
      syncingRef.current = true;
      dst.current.scrollLeft = src.current.scrollLeft;
    }
  };

  const fallbackRaw = (raw: string) => (e: React.SyntheticEvent<HTMLImageElement>) => {
    const t = e.target as HTMLImageElement;
    if (t.src !== raw) t.src = raw;
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-4" onClick={onClose}>
      <div
        className="mx-auto flex h-full w-full max-w-7xl flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-4 py-3">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900" title={`${panel.label} vs ${render.label}`}>
            Compare vs Truck — <span className="text-gray-600">{panel.panel_label || panel.label}</span>
          </p>
          <div className="flex overflow-hidden rounded-md border border-gray-300">
            {([["overlay", "Overlay"], ["side", "Side by side"]] as const).map(([m, lbl]) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`px-3 py-1.5 text-sm font-medium ${mode === m
                  ? "bg-gradient-to-r from-blue-500 to-pink-500 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-50"}`}
              >
                {lbl}
              </button>
            ))}
          </div>
          {mode === "overlay" ? (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              Opacity
              <input
                type="range"
                min={0}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-32 accent-blue-500"
              />
              <span className="w-9 tabular-nums text-gray-900">{opacity}%</span>
            </label>
          ) : (
            <label className="flex items-center gap-2 text-xs text-gray-600">
              Zoom
              <input
                type="range"
                min={1}
                max={4}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-32 accent-blue-500"
              />
              <span className="w-9 tabular-nums text-gray-900">{zoom.toFixed(1)}×</span>
            </label>
          )}
          <button
            onClick={onClose}
            title="Close (Esc)"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-auto bg-gray-50 p-4">
          {mode === "overlay" ? (
            <div className="relative w-full overflow-hidden rounded border border-gray-200 bg-gray-100">
              <img
                src={thumb(render.url, 1600)}
                alt={render.label}
                onError={fallbackRaw(render.url)}
                draggable={false}
                className="w-full select-none object-contain"
              />
              {/* Draggable / resizable onion-skin panel rectangle */}
              <div
                style={{ left: box.x, top: box.y, width: box.w }}
                className="absolute cursor-move touch-none border border-dashed border-blue-500"
                onPointerDown={startDrag("move")}
                onPointerMove={onDragMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                <img
                  src={thumb(panel.url, 1600)}
                  alt={panel.label}
                  onError={fallbackRaw(panel.url)}
                  draggable={false}
                  style={{ opacity: opacity / 100 }}
                  className="pointer-events-none w-full select-none"
                />
                {/* Corner resize handle */}
                <div
                  onPointerDown={startDrag("resize")}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="absolute -bottom-2 -right-2 h-5 w-5 cursor-nwse-resize touch-none rounded-sm border border-white bg-gradient-to-r from-blue-500 to-pink-500 shadow"
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {([[render, topScrollRef, bottomScrollRef], [panel, bottomScrollRef, topScrollRef]] as const).map(([a, ref, other], i) => (
                <div key={a.id}>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {i === 0 ? "3D Render" : "Flat Panel"} — {a.label}
                  </p>
                  <div
                    ref={ref}
                    onScroll={syncScroll(ref, other)}
                    className="overflow-auto rounded border border-gray-200 bg-gray-100"
                  >
                    <img
                      src={thumb(a.url, 1600)}
                      alt={a.label}
                      onError={fallbackRaw(a.url)}
                      draggable={false}
                      style={{ transform: `scale(${zoom})`, transformOrigin: "top left" }}
                      className="w-full select-none object-contain"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminProductionFiles() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [building, setBuilding] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [showSuperseded, setShowSuperseded] = useState(false);
  const [compare, setCompare] = useState<{ panel: PAAsset; render: PAAsset } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const { data: jobs = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["pa_jobs"],
    queryFn: async (): Promise<PAJob[]> => {
      const { data, error } = await (supabase.from("panel_artboard_jobs" as never) as any)
        .select("id, prompt, mode, vehicle_year, vehicle_make, vehicle_model, finish, reference_image_url, created_at")
        .order("created_at", { ascending: false })
        .limit(80);
      if (error) throw error;
      return (data ?? []) as PAJob[];
    },
  });

  const { data: assets = [] } = useQuery({
    queryKey: ["pa_assets"],
    queryFn: async (): Promise<PAAsset[]> => {
      const { data, error } = await (supabase.from("panel_artboard_assets" as never) as any)
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PAAsset[];
    },
  });

  // WePrintWraps WrapDesignJobs (ApprovePro) + RecreatePro designs + any design
  // with saved layer files. RecreatePro rows carry the uploaded design in
  // custom_design_url — the Build Print Files button cuts panels from it.
  const { data: apJobs = [] } = useQuery({
    queryKey: ["approvepro_jobs"],
    queryFn: async (): Promise<any[]> => {
      const { data, error } = await (supabase.from("color_visualizations" as never) as any)
        .select("id, color_name, vehicle_year, vehicle_make, vehicle_model, custom_design_url, render_urls, finish_type, admin_notes, created_at")
        .or("mode_type.eq.approvemode,mode_type.eq.recreatepro,admin_notes.ilike.%layer_background_url%")
        .order("created_at", { ascending: false })
        .limit(40);
      if (error) throw error;
      return (data ?? []).map((r: any) => {
        let n: any = {};
        try { n = typeof r.admin_notes === "string" ? JSON.parse(r.admin_notes) : (r.admin_notes || {}); } catch { n = {}; }
        return { ...r, layers: n };
      }).filter((r: any) => !r.layers?.production_hidden);
    },
  });

  const upscale = async (asset: PAAsset, scale: number) => {
    setBusy(`${asset.id}:${scale}`);
    try {
      // 1) Topaz pass (upscale-production-panel routes to the Topaz API).
      const { data: up, error: upErr } = await renderClient.functions.invoke("upscale-production-panel", {
        body: { image_url: asset.url, scale },
      });
      if (upErr || !up?.success || !up?.upscaled_url) {
        throw new Error(up?.error || upErr?.message || "upscale failed");
      }
      // 2) Copy to a proper production filename in the job's print/ folder.
      const m = String(up.upscaled_url).match(/\/object\/public\/wrap-files\/(.+)$/);
      const fromKey = m ? decodeURIComponent(m[1]) : "";
      const base = slug(asset.panel_label || asset.label || "panel");
      const dims = asset.width_inches && asset.height_inches ? `_${asset.width_inches}x${asset.height_inches}in` : "";
      const toKey = `panel-artboard/${asset.job_id}/print/${base}${dims}_${scale}x.png`;
      let finalUrl = up.upscaled_url as string;
      if (fromKey) {
        const { data: cp } = await renderClient.functions.invoke("storage-file-tools", {
          body: { action: "copy", bucket: "wrap-files", from: fromKey, to: toKey },
        });
        if (cp?.success && cp?.publicUrl) finalUrl = cp.publicUrl;
      }
      // 3) Register so it shows here + on /admin/panel-artboard (admin RLS).
      await (supabase.from("panel_artboard_assets" as never) as any).insert({
        job_id: asset.job_id,
        kind: "panel",
        label: `${asset.panel_label || asset.label} — PRINT ${scale}x (Topaz)`,
        panel_label: asset.panel_label,
        width_inches: asset.width_inches,
        height_inches: asset.height_inches,
        dpi: asset.dpi ? Math.round(asset.dpi * scale) : null,
        storage_path: toKey,
        url: finalUrl,
        sort_order: 500,
      });
      toast.success(`Upscaled ${scale}× and saved`, { description: toKey.split("/").pop() });
      await queryClient.invalidateQueries({ queryKey: ["pa_assets"] });
    } catch (e: any) {
      toast.error(`Upscale failed: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  // 8× ESRGAN (Replicate real-esrgan-a100): GPU-cap-safe transform of the
  // panel in, 8× generative upscale out, copied to a named print/esrgan/ file
  // and registered as a panel asset.
  const esrgan8x = async (asset: PAAsset) => {
    setBusy(`${asset.id}:esrgan`);
    try {
      const { data: up, error: upErr } = await renderClient.functions.invoke("upscale-production-panel", {
        body: { image_url: gpuSafeUrl(asset), engine: "esrgan-a100", scale: ESRGAN_SCALE },
      });
      if (upErr || !up?.success || !up?.upscaled_url) {
        throw new Error(up?.error || upErr?.message || "ESRGAN upscale failed");
      }
      // Copy to a proper production filename in the job's print/esrgan/ folder.
      const m = String(up.upscaled_url).match(/\/object\/public\/wrap-files\/(.+)$/);
      const fromKey = m ? decodeURIComponent(m[1]) : "";
      const base = slug(asset.panel_label || asset.label || "panel");
      const dims = asset.width_inches && asset.height_inches ? `_${asset.width_inches}x${asset.height_inches}in` : "";
      const toKey = `panel-artboard/${asset.job_id}/print/esrgan/${base}${dims}_${ESRGAN_SCALE}x.png`;
      let finalUrl = up.upscaled_url as string;
      if (fromKey) {
        const { data: cp } = await renderClient.functions.invoke("storage-file-tools", {
          body: { action: "copy", bucket: "wrap-files", from: fromKey, to: toKey },
        });
        if (cp?.success && cp?.publicUrl) finalUrl = cp.publicUrl;
      }
      // The GPU-cap transform makes a landscape source exactly capPx wide, so
      // output DPI = ESRGAN_SCALE × capPx / panel width in inches.
      const dpi = asset.width_inches
        ? Math.round((ESRGAN_SCALE * esrganCapPx(asset)) / asset.width_inches)
        : null;
      const dimsLabel = asset.width_inches && asset.height_inches ? ` ${asset.width_inches}×${asset.height_inches}` : "";
      await (supabase.from("panel_artboard_assets" as never) as any).insert({
        job_id: asset.job_id,
        kind: "panel",
        label: `${asset.panel_label || asset.label} — ESRGAN ${ESRGAN_SCALE}×${dimsLabel}`,
        panel_label: asset.panel_label,
        width_inches: asset.width_inches,
        height_inches: asset.height_inches,
        dpi,
        storage_path: toKey,
        url: finalUrl,
        sort_order: 500,
      });
      toast.success(`ESRGAN ${ESRGAN_SCALE}× upscaled and saved`, { description: toKey.split("/").pop() });
      await queryClient.invalidateQueries({ queryKey: ["pa_assets"] });
    } catch (e: any) {
      toast.error(`ESRGAN upscale failed: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  // Vectorize the panel via the DesignProAI vectorize-it API and register
  // the SVG as a design asset on the same job.
  const vectorize = async (asset: PAAsset, orderKey: string) => {
    setBusy(`${asset.id}:vector`);
    try {
      const base = slug(asset.panel_label || asset.label || "panel");
      const resp = await fetch("https://designproai.com/api/vectorize-it", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_url: asset.url,
          file_name: `${base}.png`,
          trace_mode: "detailed",
          order_number: orderKey,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data?.output_url) {
        throw new Error(data?.error || `vectorize-it ${resp.status}`);
      }
      await (supabase.from("panel_artboard_assets" as never) as any).insert({
        job_id: asset.job_id,
        kind: "design",
        label: `${asset.panel_label || asset.label} — VECTOR SVG`,
        panel_label: asset.panel_label,
        width_inches: asset.width_inches,
        height_inches: asset.height_inches,
        url: data.output_url,
        sort_order: 600,
      });
      toast.success("Vectorized and saved", { description: `${base}.svg` });
      await queryClient.invalidateQueries({ queryKey: ["pa_assets"] });
    } catch (e: any) {
      toast.error(`Vectorize failed: ${e?.message || e}`);
    } finally {
      setBusy(null);
    }
  };

  // Remove a registry entry from the card (the storage file is kept — this
  // only de-lists it; admins can re-register or hard-delete in storage).
  const deleteAsset = async (a: PAAsset) => {
    if (!window.confirm(`Remove "${a.label}" from this job's card?`)) return;
    const { error } = await (supabase.from("panel_artboard_assets" as never) as any).delete().eq("id", a.id);
    if (error) { toast.error(`Delete failed: ${error.message}`); return; }
    toast.success("Removed from card");
    await queryClient.invalidateQueries({ queryKey: ["pa_assets"] });
  };

  // Hide an ApprovePro design card from this page (design record untouched —
  // sets admin_notes.production_hidden so the production view stays curated).
  const hideApJob = async (j: any) => {
    if (!window.confirm(`Remove "${j.color_name || "this design"}" from the production page?`)) return;
    const notes = JSON.stringify({ ...(j.layers || {}), production_hidden: true });
    const { error } = await (supabase.from("color_visualizations" as never) as any)
      .update({ admin_notes: notes }).eq("id", j.id);
    if (error) { toast.error(`Hide failed: ${error.message}`); return; }
    toast.success("Removed from production page");
    await queryClient.invalidateQueries({ queryKey: ["approvepro_jobs"] });
  };

  // Build Print Files — RETIRED from this page (Trish 2026-07-24, roadmap #5).
  // The old STEP 2 called `generate-artboard-from-proof`, a DEAD pipeline that
  // crops the truck-render proof and ships WRONG CROPS ("do NOT add new
  // callers" — CLAUDE.md). This page stays a DESIGN-TEAM-ONLY file hub
  // (browse / download / Topaz upscale of past jobs); panel PRODUCTION runs
  // through the ONE sanctioned chain: Build Assets / RevisionStudio → the
  // deterministic gridslice + proof extract → production_flow_assets → the
  // PanelPro Studio Board's QC checklist → QC Stamp → WrapBox.
  const buildPrintFiles = async (j: any) => {
    setBuilding(j.id);
    try {
      toast.message("Panel builds moved to the sanctioned pipeline", {
        description:
          "Build panels from RevisionStudio (Production Layers → Build print panels) or the Design Assets page — they land on the PanelPro Studio Board for QC. This page is the team file hub (browse / download / upscale).",
      });
    } finally {
      setBuilding(null);
    }
  };

  // ---- ORDER GROUPING -------------------------------------------------
  // panel_artboard_jobs → orders keyed by the order number in the prompt
  // ("RP-100889" / "#34934"); jobs without one stand alone under their
  // prompt's first ~40 chars. Jobs arrive newest-first from the query, so
  // each order's jobs[] stays newest-first and jobs[0].created_at is newest.
  const productionOrders = useMemo<OrderEntry[]>(() => {
    const map = new Map<string, OrderEntry>();
    for (const job of jobs) {
      if (job.mode === "designpro") continue; // own section below
      if (!assets.some((a) => a.job_id === job.id)) continue; // same skip as before: nothing to show
      const m = (job.prompt || "").match(ORDER_RE);
      const label = m
        ? m[0].replace(/\s+/g, "")
        : ((job.prompt || "").slice(0, 40).trim() || "Untitled job");
      const key = m ? label : `p-${slug(label) || job.id}`;
      const vehicle = [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ");
      const entry = map.get(key);
      if (entry) {
        entry.jobs.push(job);
        if (!entry.vehicle && vehicle) entry.vehicle = vehicle;
      } else {
        map.set(key, { key, label, vehicle, date: job.created_at, type: "production", jobs: [job] });
      }
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [jobs, assets]);

  // DesignPro artboard runs (designpro-artboard / designpro-flat-art register
  // themselves with mode='designpro', one job per generation) — own section.
  const designProOrders = useMemo<OrderEntry[]>(() =>
    jobs
      .filter((job) => job.mode === "designpro" && assets.some((a) => a.job_id === job.id))
      .map((job) => ({
        key: `dp-${job.id}`,
        label: (job.prompt || "").slice(0, 40).trim() || "DesignPro artboard",
        vehicle: [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" "),
        date: job.created_at,
        type: "designpro" as const,
        jobs: [job],
      })), [jobs, assets]);

  const apEntries = useMemo<OrderEntry[]>(() =>
    apJobs.map((j: any) => ({
      key: `ap-${j.id}`,
      label: `JOB-${String(j.id).slice(0, 8).toUpperCase()}`,
      vehicle: [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(" "),
      date: j.created_at,
      type: "approvepro" as const,
      jobs: [],
      apJob: j,
    })), [apJobs]);

  const q = search.trim().toLowerCase();
  const matches = (e: OrderEntry) =>
    !q || e.label.toLowerCase().includes(q) || e.vehicle.toLowerCase().includes(q) ||
    (e.type === "approvepro" && String(e.apJob?.color_name || "").toLowerCase().includes(q));
  const filteredProduction = productionOrders.filter(matches);
  const filteredDesignPro = designProOrders.filter(matches);
  const filteredAp = apEntries.filter(matches);

  // ---- SELECTION (?order=<key> deep link) ------------------------------
  const allEntries = [...productionOrders, ...designProOrders, ...apEntries];
  const urlKey = searchParams.get("order");
  const selected =
    allEntries.find((e) => e.key === urlKey) ??
    filteredProduction[0] ?? filteredDesignPro[0] ?? filteredAp[0] ?? null;

  const selectOrder = (key: string) => {
    setShowSuperseded(false);
    setSearchParams({ order: key });
  };

  // ---- COMPARE VS TRUCK ------------------------------------------------
  // Line a flat panel up against the order's approved proof / reference render.
  // Lookup order (broadened so it no longer dead-ends when no explicit PROOF
  // asset row exists — the common case, since the proof usually lives on the
  // source generation, not as a panel_artboard_assets row):
  //   1. an asset that is clearly a proof/render (panel_label='PROOF', kind
  //      design/proof/render, or a label containing proof / 3d / render),
  //      preferring one whose label matches the panel's side;
  //   2. the source reference image the artboard was built from
  //      (panel_artboard_jobs.reference_image_url — the approved 2D proof / render).
  const openCompare = (panel: PAAsset) => {
    const orderJobs = selected && selected.type !== "approvepro" ? selected.jobs : [];
    const jobIds = new Set<string>(orderJobs.map((j) => j.id));
    jobIds.add(panel.job_id);
    const side = (panel.panel_label || "").toUpperCase().trim();

    const candidates = assets.filter((a) => {
      if (!jobIds.has(a.job_id)) return false;
      const pl = (a.panel_label || "").toUpperCase().trim();
      const lbl = (a.label || "").toLowerCase();
      return pl === "PROOF" || a.kind === "design" || a.kind === "proof" ||
        lbl.includes("proof") || lbl.includes("3d") || lbl.includes("render");
    });
    let render: PAAsset | null =
      (side && candidates.find((p) => (p.label || "").toUpperCase().includes(side))) ||
      candidates[0] || null;

    // Fallback: the source reference image the artboard was built from.
    if (!render) {
      const refJob = orderJobs.find((j) => j.reference_image_url);
      const refUrl = refJob?.reference_image_url;
      if (refUrl) {
        render = {
          id: "ref", job_id: refJob!.id, kind: "design", label: "Source proof / reference",
          panel_label: "PROOF", width_inches: null, height_inches: null, dpi: null,
          storage_path: null, url: refUrl, created_at: "",
        };
      }
    }
    if (!render) {
      toast.error("No proof or reference render found on this order to compare against.");
      return;
    }
    setCompare({ panel, render });
  };

  // ---- RENDER HELPERS --------------------------------------------------
  const renderAsset = (a: PAAsset) => (
    <div key={a.id} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <a href={a.url} target="_blank" rel="noreferrer">
        <img
          src={thumb(a.url)}
          alt={a.label}
          loading="lazy"
          onError={(e) => { const t = e.target as HTMLImageElement; if (t.src !== a.url) t.src = a.url; }}
          className="mb-2 aspect-[3/1] w-full rounded object-contain bg-gray-100"
        />
      </a>
      <p className="truncate text-sm font-medium text-gray-900" title={a.label}>{a.label}</p>
      <p className="text-xs text-gray-500">
        {a.width_inches && a.height_inches ? `${a.width_inches}″ × ${a.height_inches}″` : "—"}
        {a.dpi ? ` · ~${a.dpi} DPI` : ""}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline" className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50">
          <a href={a.url} download target="_blank" rel="noreferrer">
            <Download className="mr-1 h-3.5 w-3.5" /> Download
          </a>
        </Button>
        <Button size="sm" variant="outline" onClick={() => deleteAsset(a)} className="border-red-200 bg-white text-red-600 hover:bg-red-50">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
        {a.kind === "panel" && (
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={() => openCompare(a)}
              className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
            >
              <Layers className="mr-1 h-3.5 w-3.5" /> Compare
            </Button>
            {[2, 4].map((s) => (
              <Button
                key={s}
                size="sm"
                onClick={() => upscale(a, s)}
                disabled={!!busy}
                className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90"
              >
                {busy === `${a.id}:${s}` ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1 h-3.5 w-3.5" />
                )}
                {s}×
              </Button>
            ))}
            <Button
              size="sm"
              onClick={() => esrgan8x(a)}
              disabled={!!busy}
              className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90"
            >
              {busy === `${a.id}:esrgan` ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3.5 w-3.5" />
              )}
              8× ESRGAN
            </Button>
            <Button
              size="sm"
              onClick={() => vectorize(a, selected?.key ?? "")}
              disabled={!!busy}
              className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90"
            >
              {busy === `${a.id}:vector` ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <PenTool className="mr-1 h-3.5 w-3.5" />
              )}
              Vectorize
            </Button>
          </>
        )}
      </div>
    </div>
  );

  const renderProductionJob = (job: PAJob) => {
    const jobAssets = assets.filter((a) => a.job_id === job.id);
    return (
      <Card key={job.id} className="mb-6 border-gray-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="font-semibold text-gray-900">
            {[job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ") || "Vehicle"}
          </span>
          {job.finish && <Badge variant="outline" className="border-gray-300 text-gray-600">{job.finish}</Badge>}
          <span className="text-xs text-gray-500">
            {formatDistanceToNow(new Date(job.created_at), { addSuffix: true })}
          </span>
          {job.prompt && <span className="truncate text-xs text-gray-500">· {job.prompt}</span>}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {jobAssets.map(renderAsset)}
        </div>
      </Card>
    );
  };

  const renderApCard = (j: any) => (
    <Card key={j.id} className="relative border-gray-200 bg-white p-3 shadow-sm">
      <button
        onClick={() => hideApJob(j)}
        title="Remove from production page"
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-red-200 bg-white text-red-600 hover:bg-red-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
      <div className="mb-2 grid grid-cols-3 gap-2">
        {([["Design", j.custom_design_url], ["Background", j.layers?.layer_background_url], ["Overlays", j.layers?.layer_overlays_url]] as const)
          .filter(([, u]) => !!u)
          .map(([lbl, u]: any) => (
            <a key={lbl} href={u} target="_blank" rel="noreferrer" className="block">
              <img src={thumb(u, 640)} alt={lbl} loading="lazy" className="aspect-video w-full min-w-[140px] rounded border border-gray-200 bg-gray-100 object-contain" />
              <p className="mt-0.5 text-center text-[10px] uppercase tracking-wide text-gray-400">{lbl}</p>
            </a>
          ))}
      </div>
      <p className="truncate font-semibold text-gray-900">{j.color_name || "Design"}</p>
      <p className="text-xs text-gray-500">
        <span className="font-mono">JOB-{String(j.id).slice(0, 8).toUpperCase()}</span>
        {" · "}{[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(" ")}
        {" · "}{formatDistanceToNow(new Date(j.created_at), { addSuffix: true })}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {j.custom_design_url && <Button asChild size="sm" variant="outline" className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"><a href={j.custom_design_url} target="_blank" rel="noreferrer"><Download className="mr-1 h-3.5 w-3.5" /> Design</a></Button>}
        {j.layers?.layer_background_url && <Button asChild size="sm" variant="outline" className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"><a href={j.layers.layer_background_url} target="_blank" rel="noreferrer"><Download className="mr-1 h-3.5 w-3.5" /> Background</a></Button>}
        {j.layers?.layer_overlays_url && <Button asChild size="sm" variant="outline" className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"><a href={j.layers.layer_overlays_url} target="_blank" rel="noreferrer"><Download className="mr-1 h-3.5 w-3.5" /> Overlays (transparent)</a></Button>}
        {j.layers?.flat_proof_url && <Button asChild size="sm" variant="outline" className="border-gray-300 bg-white text-gray-700 hover:bg-gray-50"><a href={j.layers.flat_proof_url} target="_blank" rel="noreferrer"><Download className="mr-1 h-3.5 w-3.5" /> 2D Proof</a></Button>}
        <Button size="sm" onClick={() => buildPrintFiles(j)} disabled={!!building} className="bg-gradient-to-r from-blue-500 to-pink-500 text-white hover:opacity-90">
          {building === j.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />} Build Print Files
        </Button>
      </div>
    </Card>
  );

  const renderRailEntry = (e: OrderEntry) => {
    const isSel = selected?.key === e.key;
    return (
      <button
        key={e.key}
        onClick={() => selectOrder(e.key)}
        className={`w-full rounded-lg border px-3 py-2 text-left ${isSel
          ? "border-transparent bg-gradient-to-r from-blue-500 to-pink-500 text-white"
          : "border-gray-200 bg-white text-gray-900 hover:bg-gray-50"}`}
      >
        <p className="truncate text-sm font-bold">{e.label}</p>
        <p className={`truncate text-xs ${isSel ? "text-white/80" : "text-gray-600"}`}>{e.vehicle || "—"}</p>
        <p className={`text-[11px] ${isSel ? "text-white/70" : "text-gray-500"}`}>
          {e.type === "production" ? `${e.jobs.length} job${e.jobs.length === 1 ? "" : "s"}` : "1 job"}
          {" · "}{formatDistanceToNow(new Date(e.date), { addSuffix: true })}
        </p>
      </button>
    );
  };

  // Selected production order: newest job's assets expanded; superseded
  // rebuilds (prompt starts with "(superseded") collapsed behind a toggle.
  const activeJobs = selected && selected.type !== "approvepro"
    ? selected.jobs.filter((j) => !(j.prompt || "").startsWith("(superseded"))
    : [];
  const supersededJobs = selected && selected.type !== "approvepro"
    ? selected.jobs.filter((j) => (j.prompt || "").startsWith("(superseded"))
    : [];

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Helmet>
        <title>Production Files — Admin</title>
      </Helmet>
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link to="/admin" className="text-gray-500 hover:text-gray-900">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 text-2xl font-bold">
                <FileImage className="h-6 w-6 text-blue-600" /> Production<span className="bg-gradient-to-r from-blue-500 to-pink-500 bg-clip-text text-transparent">Files</span>
              </h1>
              <p className="text-sm text-gray-500">
                Print-ready panels by order — download, or upscale on demand (Topaz).
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="border-gray-300 bg-white hover:bg-gray-50"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="flex gap-6">
          {/* LEFT RAIL — orders, newest first */}
          <aside className="w-[300px] shrink-0">
            <div className="sticky top-4 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search order # or vehicle…"
                  className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none"
                />
              </div>

              <p className="mb-1 mt-2 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                Production Orders
              </p>
              {isLoading ? (
                <div className="flex items-center px-1 py-3 text-sm text-gray-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : filteredProduction.length === 0 ? (
                <p className="px-1 py-2 text-xs text-gray-500">No production orders{q ? " match" : " yet"}.</p>
              ) : (
                <div className="space-y-1.5">{filteredProduction.map(renderRailEntry)}</div>
              )}

              <p className="mb-1 mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                DesignPro Artboards
              </p>
              {filteredDesignPro.length === 0 ? (
                <p className="px-1 py-2 text-xs text-gray-500">No DesignPro artboards{q ? " match" : " yet"}.</p>
              ) : (
                <div className="space-y-1.5">{filteredDesignPro.map(renderRailEntry)}</div>
              )}

              <p className="mb-1 mt-4 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
                WrapDesign & RecreatePro Jobs
              </p>
              {filteredAp.length === 0 ? (
                <p className="px-1 py-2 text-xs text-gray-500">No design jobs{q ? " match" : " yet"}.</p>
              ) : (
                <div className="space-y-1.5">{filteredAp.map(renderRailEntry)}</div>
              )}
            </div>
          </aside>

          {/* RIGHT PANE — the selected order's page */}
          <div className="min-w-0 flex-1">
            {!selected ? (
              isLoading ? (
                <div className="flex items-center justify-center py-20 text-gray-500">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading jobs…
                </div>
              ) : (
                <Card className="border-gray-200 bg-white p-10 text-center text-gray-500">
                  No production jobs yet. Generate panels in /admin/panel-artboard.
                </Card>
              )
            ) : (
              <>
                <div className="mb-4 border-b border-gray-200 pb-3">
                  <h2 className="text-xl font-bold text-gray-900">{selected.label}</h2>
                  <p className="text-sm text-gray-600">
                    {selected.vehicle || "—"}
                    <span className="text-gray-500">
                      {" · "}{formatDistanceToNow(new Date(selected.date), { addSuffix: true })}
                      {selected.type === "approvepro" && " · ApprovePro (WePrintWraps)"}
                      {selected.type === "designpro" && " · DesignPro Artboard"}
                    </span>
                  </p>
                </div>

                {selected.type === "approvepro" ? (
                  renderApCard(selected.apJob)
                ) : (
                  <>
                    {activeJobs.map(renderProductionJob)}
                    {supersededJobs.length > 0 && (
                      <>
                        <button
                          onClick={() => setShowSuperseded((v) => !v)}
                          className="mb-4 text-sm font-medium text-gray-600 underline-offset-2 hover:text-gray-900 hover:underline"
                        >
                          {showSuperseded
                            ? `Hide ${supersededJobs.length} superseded build${supersededJobs.length === 1 ? "" : "s"}`
                            : `Show ${supersededJobs.length} superseded build${supersededJobs.length === 1 ? "" : "s"}`}
                        </button>
                        {showSuperseded && supersededJobs.map(renderProductionJob)}
                      </>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {compare && (
        <CompareModal panel={compare.panel} render={compare.render} onClose={() => setCompare(null)} />
      )}
    </div>
  );
}
