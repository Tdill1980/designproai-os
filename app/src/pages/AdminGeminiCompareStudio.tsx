import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Loader2, Upload, Check, X, Package, ShieldCheck, Truck,
  ArrowRight, Image as ImageIcon, Maximize2, SplitSquareHorizontal, GripVertical,
  LayoutGrid, Move, RotateCcw, Pencil, ZoomIn, ZoomOut, Trash2, FlipHorizontal2, Wand2, AlertTriangle, Layers, Download,
  ChevronDown, HelpCircle,
} from "lucide-react";
import StudioBoardEditor, { StudioBoardEditTarget } from "@/components/studioboard/StudioBoardEditor";
import { ProductionPackQCCard } from "@/components/production/ProductionPackQCCard";
// cn was referenced by the Validate (QC) results block without being imported —
// rendering validation results threw `cn is not defined` and white-screened the
// whole board into the ErrorBoundary (caught in the 2026-07-24 button audit).
import { cn } from "@/lib/utils";
import {
  getProductionPanelPackState,
  type ProductionFlowAssetRow,
} from "@/lib/productionFlowAssetState";
import {
  reconcilePanelProVaultState,
  type PanelProVaultPack,
} from "@/lib/panelProVaultState";

/**
 * StudioBoardExplainer — collapsible "how this page works" banner for the team.
 * Operational only (what the buttons do + how to verify a panel before shipping);
 * deliberately reveals no proprietary/system internals.
 */
function StudioBoardExplainer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5 shrink-0 text-blue-500" />
          <span className="text-sm font-bold text-gray-900">How this page works — read me</span>
          <span className="hidden text-xs text-gray-400 sm:inline">What the Studio Board does, how to run it, and how to verify a panel before you ship.</span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 py-4 text-sm text-gray-700">
          <p className="mb-3">
            <span className="font-semibold text-gray-900">What this page is.</span> The Studio Board turns an approved design into the <span className="font-semibold">per-side print panels</span> for a job (driver, passenger, hood, roof, front, rear), lets you check each side is correct, and builds the real print files. One job at a time — search it by order or job number up top.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-gray-100 bg-gray-50/60 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-500">
                <Layers className="h-3.5 w-3.5" /> The workflow (in order)
              </p>
              <ol className="space-y-1.5 text-[13px] leading-snug text-gray-700">
                <li><span className="font-semibold">1. Load Build Assets Panels</span> — pulls the deterministic per-side print panels from the vault.</li>
                <li><span className="font-semibold">2. Missing or wrong side?</span> Use <span className="font-semibold">Upload panel files</span> to drop in the real art. A side with no source stays a recorded gap — the passenger is never mirrored from the driver, which would print all lettering backwards.</li>
                <li><span className="font-semibold">3. Verify each side</span> using the tools on the right → before you trust it.</li>
                <li><span className="font-semibold">4. Approve side</span> on each one — the counter climbs to 6/6.</li>
                <li><span className="font-semibold">5. Build Print Files (1500-DPI)</span> — produces the real <span className="font-mono text-xs">TIFF</span> print file for every side.</li>
                <li><span className="font-semibold">6. Approve &amp; Send to WrapBox</span> — packages the job and delivers it to the customer.</li>
              </ol>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-600">
                <ShieldCheck className="h-3.5 w-3.5" /> Verification tools — check BEFORE you ship
              </p>
              <ul className="space-y-1.5 text-[13px] leading-snug text-gray-700">
                <li><span className="font-semibold">Compare grid</span> — slide each panel over the 2D proof to confirm the design, colors, and layout match.</li>
                <li><span className="font-semibold">Validate (QC)</span> — runs the automated quality checks on every side and stamps the result.</li>
                <li><span className="font-semibold">Designer QC</span> — the human sign-off surface; a real designer confirms each side.</li>
                <li><span className="font-semibold">Per-side status</span> — each side shows its dimensions + a <span className="font-mono text-xs">TIFF</span>/<span className="font-mono text-xs">PNG</span> once built. A side with no file isn't done.</li>
              </ul>
              <p className="mt-2 text-[12px] font-semibold text-blue-700">Rule: a side isn't ready until it matches the proof AND shows a built file.</p>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12.5px] leading-snug text-amber-800">
            <span className="font-semibold">Getting the files:</span> after <span className="font-semibold">Build Print Files</span>, the real print file is the <span className="font-mono">TIFF</span> (very large — a full vehicle side). To download it without your computer running out of memory, <span className="font-semibold">right-click the TIFF → “Save link as”</span>, and open it in print software (Photoshop / the RIP), not the default photo viewer. The small on-screen preview is NOT the print file.
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Studio Board — /admin/studio-board  (alias: /admin/gemini-compare)  (admin / design team)
 *
 * Search a job by ORDER NUMBER, see all 7 render views + the 2D proof, then
 * MANUALLY UPLOAD each side's Gemini Studio flat artwork (the files Lance
 * produces) next to the system's real view so they can be compared panel by
 * panel. A per-side "Compare" button opens a draggable before/after slider that
 * overlays the Gemini upload directly on top of the real design proof. Approving
 * a side:
 *   1. saves the uploaded Gemini file onto the SHARED panelizer_jobs row
 *      (concept_json.qc_side_panels[sideKey].gemini_url), so it's attached to
 *      the job and reloadable (Design Assets), and
 *   2. flips that side's `approved` flag — the SAME field the customer-facing
 *      GENIE Universal Panelizer (ProductionFlow) subscribes to — so its
 *      progress bar advances in real time as you go through each side.
 *
 * "Run ProductionFlow checks" navigates the job into ProductionFlow.
 *
 * Reuses the proven qc_side_panels mechanism (originally from the retired designer-QC page) /
 * ProductionFlow (QC_SIDE_TO_VIEW). No new pipeline, no schema change.
 */

// Canonical wrappable panels and how each maps to a render view + the GENIE
// qc_side_panels key (mirrors ProductionFlow.QC_SIDE_TO_VIEW).
const VIEW_DEFS: Array<{ view: string; label: string; sideKey: string; aliases: string[] }> = [
  { view: "side", label: "Driver Side", sideKey: "driver_side", aliases: ["side", "driver", "left"] },
  { view: "passenger-side", label: "Passenger Side", sideKey: "passenger_side", aliases: ["passenger"] },
  // Hood + roof renders come back under several keys depending on the pipeline
  // (hood_detail / hood-detail / hood / detail; roof / top / overhead). List
  // every variant so the view ALWAYS resolves — otherwise the side is dropped
  // from Panel Pro Extract and never gets a match.
  { view: "hood_detail", label: "Hood", sideKey: "hood", aliases: ["hood_detail", "hood-detail", "hooddetail", "hood", "detail", "bonnet"] },
  { view: "roof", label: "Roof", sideKey: "roof", aliases: ["roof", "top", "overhead", "birdseye", "birds-eye"] },
  { view: "front", label: "Front", sideKey: "front", aliases: ["front", "hero"] },
  { view: "rear", label: "Rear", sideKey: "rear", aliases: ["rear", "back"] },
];

// Map each side to the exact panel label the flat master ARTBOARD is generated
// with (design-panel-ai-generate mode:'artboard' lays out these labels), so
// panel-pro-flatten-side can isolate the right panel off the master sheet.
const ARTBOARD_LABELS: Record<string, string> = {
  driver_side: "DRIVER SIDE",
  passenger_side: "PASSENGER SIDE",
  hood: "HOOD",
  roof: "ROOF",
  front: "FRONT",
  rear: "REAR",
};

interface Job {
  id: string;
  user_id?: string;
  generation_id?: string;
  order_number?: string;
  status?: string;
  vehicle_year?: number;
  vehicle_make?: string;
  vehicle_model?: string;
  approved_render_url?: string;
  all_view_urls?: any;
  concept_json?: any;
  // "panelizer" = RestylePro production job (default). "approvepro" = a
  // WePrintWraps/ApprovePro proof_approvals row — Studio Board state persists
  // into proof_approvals.metadata.studio_board instead of panelizer_jobs.
  source?: "panelizer" | "approvepro";
  _metadata?: any;
  // For approvepro jobs: the backing panelizer_jobs row that carries this order
  // into ProductionFlow / the GENIE panelizer (minted/reused on demand).
  _panelizerJobId?: string;
}

function safeParseNotes(raw: any): any {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  return raw;
}

// Build a Studio Board Job from a WePrintWraps / ApprovePro proof_approvals row.
// Views come from the linked color_visualizations.render_urls; the 2D proof from
// its admin_notes / custom_design_url. Studio Board uploads + approvals persist
// back into proof_approvals.metadata.studio_board (see writeConcept).
async function buildApproveProJob(pa: any): Promise<Job> {
  let viewUrls: any = {};
  let proof = "";
  if (pa.source_visualization_id) {
    try {
      const { data: viz } = await supabase
        .from("color_visualizations" as any)
        .select("render_urls, admin_notes, custom_design_url")
        .eq("id", pa.source_visualization_id).maybeSingle();
      if (viz) {
        viewUrls = (viz as any).render_urls || {};
        const notes = safeParseNotes((viz as any).admin_notes);
        // RevisionStudio writes the 2D proof to render_urls.production_proof; older
        // designs keep it in admin_notes.flat_proof_url. Check both so a real proof
        // never reads as "No 2D proof found".
        proof = notes.flat_proof_url || viewUrls.production_proof || notes.layer_background_url
          || notes.custom_design_url || (viz as any).custom_design_url || "";
      }
    } catch { /* ignore */ }
  }
  const meta = pa.metadata || {};
  const orderNum = meta.wpw_order_number || meta.wpw_woo_order_id || meta.order_number || "";
  const sb = meta.studio_board || {};
  // A Studio Board proof override (admin uploaded the correct 2D proof) wins over
  // whatever the linked visualization resolved to.
  if (sb.flat_proof_url) proof = sb.flat_proof_url;
  return {
    id: pa.id,
    source: "approvepro",
    generation_id: pa.source_visualization_id || undefined,
    order_number: orderNum ? String(orderNum) : undefined,
    status: pa.status,
    vehicle_year: pa.vehicle_year,
    vehicle_make: pa.vehicle_make,
    vehicle_model: pa.vehicle_model,
    all_view_urls: viewUrls,
    concept_json: { flat_proof_url: proof, qc_side_panels: sb.qc_side_panels || {} },
    _panelizerJobId: sb.panelizer_job_id || undefined,
    _metadata: meta,
  } as Job;
}

// Normalize all_view_urls (array OR {view:url} OR {view:{url}}) into { [view]: url }.
function toViewUrlMap(av: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(av)) {
    av.forEach((u: any) => {
      const url = String(u?.url || u || "");
      const t = String(u?.type || u?.view || "").toLowerCase();
      if (url && t) out[t] = url;
    });
  } else if (av && typeof av === "object") {
    for (const [k, u] of Object.entries(av)) {
      const url = String((u as any)?.url || u || "");
      if (url) out[k.toLowerCase()] = url;
    }
  }
  return out;
}

// Resolve the system render url for a given panel definition (exact key, then
// aliases, then a normalized match that ignores separators so "hood_detail",
// "hood-detail" and "hooddetail" all resolve). Without this, roof/hood often
// failed to resolve and were silently dropped from Panel Pro Extract.
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function viewUrlFor(map: Record<string, string>, def: (typeof VIEW_DEFS)[number]): string {
  if (map[def.view]) return map[def.view];
  const guardPassenger = (lk: string) => !(def.sideKey === "driver_side" && lk.includes("passenger"));
  // 1) substring alias match
  for (const [k, url] of Object.entries(map)) {
    const lk = k.toLowerCase();
    if (def.aliases.some((a) => lk.includes(a)) && guardPassenger(lk)) return url;
  }
  // 2) separator-insensitive match (hood_detail vs hood-detail vs hooddetail)
  const nDef = normKey(def.view);
  const nAliases = def.aliases.map(normKey);
  for (const [k, url] of Object.entries(map)) {
    const nk = normKey(k);
    if ((nk === nDef || nAliases.some((a) => nk.includes(a))) && guardPassenger(k.toLowerCase())) return url;
  }
  return "";
}

// classify-vehicle-views returns one of these camera angles; map each to our
// wrappable side key. (top → roof, detail/close-up → hood.)
const VIEWTYPE_TO_SIDEKEY: Record<string, string> = {
  "front": "front",
  "driver-side": "driver_side",
  "passenger-side": "passenger_side",
  "rear": "rear",
  "top": "roof",
  "detail": "hood",
};

// Downscale a file to <=800px JPEG and return raw base64 (no data-URL prefix) —
// the payload shape classify-vehicle-views expects. Keeps the vision call fast.
function fileToClassifyPayload(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const MAX = 800;
      let w = img.width, h = img.height;
      if (w > MAX || h > MAX) {
        const s = MAX / Math.max(w, h);
        w = Math.round(w * s); h = Math.round(h * s);
      }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { reject(new Error("no canvas context")); return; }
      ctx.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
      resolve({ base64: dataUrl.split(",")[1], mimeType: "image/jpeg" });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image load failed")); };
    img.src = url;
  });
}

// Bulk upload: guess which side a file belongs to from its filename. Specific
// terms win first (passenger before the generic "side"/"driver"). Returns the
// sideKey or null when nothing matches (the caller then fills empty slots in order).
function matchSideByFilename(name: string): string | null {
  const n = (name || "").toLowerCase();
  if (n.includes("passenger")) return "passenger_side";
  if (n.includes("driver") || /(^|[^a-z])left([^a-z]|$)/.test(n)) return "driver_side";
  if (n.includes("hood")) return "hood";
  if (n.includes("roof") || /(^|[^a-z])top([^a-z]|$)/.test(n)) return "roof";
  if (n.includes("rear") || /(^|[^a-z])back([^a-z]|$)/.test(n)) return "rear";
  if (n.includes("front") || n.includes("hero")) return "front";
  if (/(^|[^a-z])side([^a-z]|$)/.test(n)) return "driver_side"; // generic "side" → driver
  return null;
}

// Full-screen before/after comparison. The bottom image is the reference; the
// top image is clipped to a vertical wipe divider. To line two differently-sized
// images up at the SAME SCALE, the top image can be zoomed (slider / scroll) and
// dragged (pan). The divider is moved by its handle so dragging the frame pans.
function CompareSlider({
  real, gemini, label, labelTop, labelBottom, onClose,
}: { real: string; gemini: string; label: string; labelTop?: string; labelBottom?: string; onClose: () => void }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState(50);          // wipe divider %
  const [scale, setScale] = useState(1);        // top-image zoom
  const [pan, setPan] = useState({ x: 0, y: 0 }); // top-image offset
  const dragRef = useRef<null | { mode: "divider" | "pan"; sx: number; sy: number; ox: number; oy: number }>(null);

  const setDividerFromX = useCallback((clientX: number) => {
    const el = frameRef.current; if (!el) return;
    const rect = el.getBoundingClientRect();
    setPos(Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)));
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current; if (!d) return;
      if (d.mode === "divider") setDividerFromX(e.clientX);
      else setPan({ x: d.ox + (e.clientX - d.sx), y: d.oy + (e.clientY - d.sy) });
    };
    const up = () => { dragRef.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [setDividerFromX]);

  const startPan = (e: React.PointerEvent) => { dragRef.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: pan.x, oy: pan.y }; };
  const startDivider = (e: React.PointerEvent) => { e.stopPropagation(); dragRef.current = { mode: "divider", sx: e.clientX, sy: e.clientY, ox: 0, oy: 0 }; setDividerFromX(e.clientX); };
  const reset = () => { setScale(1); setPan({ x: 0, y: 0 }); setPos(50); };
  const topTransform = `translate(${pan.x}px, ${pan.y}px) scale(${scale})`;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90 p-4 sm:p-6" onKeyDown={(e) => {
      if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 2));
      if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 2));
      if (e.key === "Escape") onClose();
    }} tabIndex={-1}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 text-white">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <SplitSquareHorizontal className="h-4 w-4" /> {label}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <ZoomOut className="h-4 w-4 text-white/60" />
            <input
              type="range" min={0.25} max={3} step={0.01} value={scale}
              onChange={(e) => setScale(Number(e.target.value))}
              className="w-40 cursor-pointer accent-fuchsia-500"
              title={`Overlay scale ${Math.round(scale * 100)}%`}
            />
            <ZoomIn className="h-4 w-4 text-white/60" />
            <span className="w-10 text-xs text-white/60">{Math.round(scale * 100)}%</span>
          </div>
          <button className="rounded bg-white/10 px-2 py-1 text-xs hover:bg-white/20" onClick={reset}>Reset</button>
          <button className="rounded-full bg-white/10 p-2 hover:bg-white/20" onClick={onClose} aria-label="Close compare">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      <div
        ref={frameRef}
        className="relative mx-auto flex w-full max-w-6xl flex-1 cursor-move select-none items-center justify-center overflow-hidden rounded-lg bg-[#111]"
        onPointerDown={startPan}
        onWheel={(e) => setScale((s) => Math.max(0.25, Math.min(3, s - e.deltaY * 0.001)))}
      >
        {/* Bottom (reference) */}
        <img src={real} alt={labelBottom || "Real design proof"} className="pointer-events-none max-h-full max-w-full object-contain" draggable={false} />
        {/* Top (zoom/pan), clipped to the divider */}
        <div className="absolute inset-0 flex items-center justify-center overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
          <img src={gemini} alt={labelTop || "Print panel"} className="pointer-events-none max-h-full max-w-full object-contain" draggable={false} style={{ transform: topTransform }} />
        </div>

        <span className="absolute left-3 top-3 rounded bg-fuchsia-600/80 px-2 py-0.5 text-[11px] font-medium text-white">{labelTop || "Print panel"}</span>
        <span className="absolute right-3 top-3 rounded bg-blue-600/80 px-2 py-0.5 text-[11px] font-medium text-white">{labelBottom || "Real design proof"}</span>

        {/* Divider — drag this handle to wipe */}
        <div className="absolute inset-y-0 z-10 w-0.5 bg-white" style={{ left: `${pos}%` }}>
          <div
            className="absolute top-1/2 h-10 w-6 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full bg-white p-1 text-gray-800 shadow-lg"
            onPointerDown={startDivider}
            title="Drag to wipe"
          >
            <GripVertical className="h-full w-full" />
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-white/60">
        Drag the image to position it · scroll or use the slider to match scale · drag the white handle to wipe · Esc to close.
      </p>
    </div>
  );
}

// ── Free-form board ──────────────────────────────────────────────────────
// A "corkboard" where every 3D side render, the 2D proof, and each uploaded
// Gemini file is a tile you can drag anywhere, resize from the corner, and fade
// (opacity) so you can lay one on top of another and line them up. Layout is
// remembered per job in localStorage. Pure DOM/pointer events — no libraries.
type BoardItem = { id: string; label: string; url: string; kind: "3d" | "gemini" | "proof"; sideKey?: string };

// Supabase Storage honors ?download=<filename> (Content-Disposition attachment).
// The bare <a download> attribute is IGNORED cross-origin, so without this the
// print files opened in a tab / saved under their storage-hash names instead of
// a labeled "{order}_{side}_…" filename.
const withDownloadName = (url: string, name: string) =>
  `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
const fileSlug = (s: string) => String(s || "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

function StudioBoardCanvas({ jobId, items, onEnlarge, onEdit, onUploadToSide, onRemove, onFlip, uploadingSide, flippingSide }: {
  jobId: string; items: BoardItem[]; onEnlarge: (url: string, label?: string) => void; onEdit: (it: BoardItem) => void;
  onUploadToSide: (sideKey: string, file: File) => void; onRemove: (sideKey: string) => void;
  onFlip: (sideKey: string) => void;
  uploadingSide: string | null; flippingSide: string | null;
}) {
  type Tile = { x: number; y: number; w: number; z: number; opacity: number };
  const storageKey = `studioboard:${jobId}`;
  const TILE_W = 440; // bigger default so files are easy to read
  const zCounter = useRef(20);
  const [tiles, setTiles] = useState<Record<string, Tile>>(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return {};
  });
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; ox: number; oy: number; ow: number } | null>(null);
  const uploadInput = useRef<HTMLInputElement | null>(null);
  const pendingSide = useRef<string | null>(null);
  const triggerUpload = (sideKey: string) => { pendingSide.current = sideKey; uploadInput.current?.click(); };

  // Seed a tidy grid slot for any tile that doesn't have a saved position yet.
  useEffect(() => {
    setTiles((prev) => {
      const next = { ...prev };
      const COLS = 2, W = TILE_W, GAPX = 28, ROWH = 360, PAD = 16;
      let placed = 0;
      items.forEach((it) => {
        if (!next[it.id]) {
          const col = placed % COLS, row = Math.floor(placed / COLS);
          next[it.id] = { x: PAD + col * (W + GAPX), y: PAD + row * ROWH, w: W, z: ++zCounter.current, opacity: 1 };
        }
        placed++;
      });
      Object.values(next).forEach((t) => { if (t.z >= zCounter.current) zCounter.current = t.z + 1; });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => i.id).join("|")]);

  // Scale every tile up/down so the board can fill the available space.
  const zoomAll = (factor: number) => setTiles((prev) => {
    const next: Record<string, Tile> = {};
    for (const [id, t] of Object.entries(prev)) next[id] = { ...t, w: Math.max(160, Math.min(1100, Math.round(t.w * factor))) };
    return next;
  });

  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(tiles)); } catch { /* ignore */ }
  }, [tiles, storageKey]);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current; if (!d) return;
      const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
      setTiles((prev) => {
        const t = prev[d.id]; if (!t) return prev;
        if (d.mode === "move") return { ...prev, [d.id]: { ...t, x: Math.max(0, d.ox + dx), y: Math.max(0, d.oy + dy) } };
        return { ...prev, [d.id]: { ...t, w: Math.max(140, d.ow + dx) } };
      });
    };
    const up = () => { drag.current = null; };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, []);

  const bringToFront = (id: string) => setTiles((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], z: ++zCounter.current } } : prev));
  const startMove = (e: React.PointerEvent, id: string) => {
    bringToFront(id);
    const t = tiles[id]; if (!t) return;
    drag.current = { id, mode: "move", sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, ow: t.w };
  };
  const startResize = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    bringToFront(id);
    const t = tiles[id]; if (!t) return;
    drag.current = { id, mode: "resize", sx: e.clientX, sy: e.clientY, ox: t.x, oy: t.y, ow: t.w };
  };
  const setOpacity = (id: string, v: number) => setTiles((prev) => (prev[id] ? { ...prev, [id]: { ...prev[id], opacity: v } } : prev));
  const resetLayout = () => { try { localStorage.removeItem(storageKey); } catch { /* ignore */ } setTiles({}); };

  const boardHeight = useMemo(() => {
    let max = 720;
    items.forEach((it) => { const t = tiles[it.id]; if (t) max = Math.max(max, t.y + Math.round(t.w * 0.75) + 80); });
    return max;
  }, [tiles, items]);

  const kindStyle: Record<string, string> = { "3d": "bg-blue-600", "gemini": "bg-fuchsia-600", "proof": "bg-gray-700" };

  return (
    <div className="space-y-2">
      <input
        ref={uploadInput} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f && pendingSide.current) onUploadToSide(pendingSide.current, f); if (e.target) e.target.value = ""; }}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-gray-500">
          Drag any tile to move it · drag the corner to resize · <span className="font-medium text-gray-700">Upload</span> a file straight onto a side · lower a tile's <span className="font-medium text-gray-700">opacity</span> to lay it on top of another.
        </p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => zoomAll(0.85)} title="Smaller tiles">
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="px-1 text-xs text-gray-400">Size</span>
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2" onClick={() => zoomAll(1.18)} title="Bigger tiles">
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={resetLayout}>
            <RotateCcw className="h-3.5 w-3.5" /> Reset layout
          </Button>
        </div>
      </div>
      <div
        className="relative w-full overflow-hidden rounded-xl border border-gray-200 bg-gray-50"
        style={{ height: boardHeight, backgroundImage: "radial-gradient(#e2e8f0 1px, transparent 1px)", backgroundSize: "22px 22px" }}
      >
        {items.map((it) => {
          const t = tiles[it.id];
          if (!t) return null;
          return (
            <div
              key={it.id}
              className="absolute select-none rounded-lg border border-gray-300 bg-white shadow-md"
              style={{ left: t.x, top: t.y, width: t.w, zIndex: t.z, opacity: t.opacity }}
              onPointerDown={(e) => startMove(e, it.id)}
            >
              <div className="flex cursor-move items-center justify-between gap-2 rounded-t-lg bg-gray-50/95 px-2 py-1">
                <span className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white ${kindStyle[it.kind]}`}>
                  <Move className="h-2.5 w-2.5" /> {it.label}
                </span>
                <div className="flex items-center gap-1" onPointerDown={(e) => e.stopPropagation()}>
                  <input
                    type="range" min={0.2} max={1} step={0.05} value={t.opacity}
                    onChange={(e) => setOpacity(it.id, Number(e.target.value))}
                    className="h-1 w-14 cursor-pointer accent-blue-600"
                    title={`Opacity ${Math.round(t.opacity * 100)}%`}
                  />
                  {it.sideKey && (
                    <button
                      className="rounded p-0.5 text-gray-400 hover:text-blue-600"
                      title={it.kind === "gemini" ? "Replace this file" : "Upload a panel file to this side"}
                      onClick={() => triggerUpload(it.sideKey!)}
                    >
                      {uploadingSide === it.sideKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  {it.kind === "gemini" && (
                    <button className="rounded p-0.5 text-gray-400 hover:text-fuchsia-600" title="Edit this file" onClick={() => onEdit(it)}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {it.kind === "gemini" && it.sideKey && (
                    <button className="rounded p-0.5 text-gray-400 hover:text-blue-600" title="Flip horizontally" onClick={() => onFlip(it.sideKey!)}>
                      {flippingSide === it.sideKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlipHorizontal2 className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  {it.kind === "gemini" && it.sideKey && (
                    <button className="rounded p-0.5 text-gray-400 hover:text-red-600" title="Remove this file" onClick={() => onRemove(it.sideKey!)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button className="rounded p-0.5 text-gray-400 hover:text-gray-700" title="Enlarge" onClick={() => onEnlarge(it.url, it.label)}>
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <img src={it.url} alt={it.label} draggable={false} className="pointer-events-none block w-full rounded-b-lg object-contain" />
              <div
                className="absolute bottom-0 right-0 flex h-5 w-5 cursor-nwse-resize items-end justify-end p-0.5"
                onPointerDown={(e) => startResize(e, it.id)}
                title="Resize"
              >
                <div className="h-2.5 w-2.5 border-b-2 border-r-2 border-gray-400" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Mobile browsers (esp. iOS Safari) cap how much canvas memory a tab can use —
// decoding/compositing a full 4K panel can silently fail or reload the tab. Cap
// the working canvas to a long-side that stays well under that limit while still
// being print-usable; the server-side bleed pass can upscale to true print size.
const MOBILE_CANVAS_MAX = 3000;

// ── RENDER-FED A.C.E. DISABLED (Trish, 2026-07-22) ──────────────────────────
// The per-side A.C.E. flatten (extractViaSteps → panel-pro-extract fed the 3D
// VEHICLE RENDER, and the artboard it generates via ensureMasterArtboard) is the
// slop maker: fed a render it hallucinates jagged/kaleidoscope panels with garbled
// text (not print-safe), and generating a master artboard is "not the path"
// (extraction is panel-pro-extract fed the 2D PROOF — the entice pipeline). With
// this false, the Studio Board ONLY pulls the deterministic Build Assets vault
// panels (or an uploaded panel); a side with none honestly reports "upload the
// panel" instead of generating slop. Flip true only to debug the AI draft.
const STUDIO_RENDER_ACE_ENABLED = false;

function canvasDims(w: number, h: number, max = MOBILE_CANVAS_MAX): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= max) return { w, h };
  const s = max / long;
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

export default function AdminGeminiCompareStudio() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();

  const [orderInput, setOrderInput] = useState(params.get("order") || "");
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  // Always-current snapshot of the job so async writes (delete/add version,
  // separate, flip) read the LATEST qc_side_panels instead of a stale closure —
  // otherwise quick successive edits re-add a version you just deleted.
  const jobRef = useRef<Job | null>(null);
  useEffect(() => { jobRef.current = job; }, [job]);
  const [proof2d, setProof2d] = useState<string>("");
  const [replacingProof, setReplacingProof] = useState(false);
  const proofInput = useRef<HTMLInputElement | null>(null);
  const [uploadingSide, setUploadingSide] = useState<string | null>(null);
  const [savingSide, setSavingSide] = useState<string | null>(null);
  const [flippingSide, setFlippingSide] = useState<string | null>(null);
  // separatingSide/separatePanel removed 2026-07-24 — generative separation is banned.
  const [extractingSide, setExtractingSide] = useState<string | null>(null);
  // Lightbox viewer — carries the file's label (side + dims) so you always know
  // WHAT you're looking at; zoom toggles fit-to-screen ↔ 100% (scroll to pan) so
  // ultra-wide print panels can be inspected clean instead of shrunk to a strip.
  const [enlarge, setEnlarge] = useState<{ url: string; label?: string } | null>(null);
  const [enlargeZoom, setEnlargeZoom] = useState(false);
  const [compare, setCompare] = useState<{ real: string; gemini: string; label: string; labelTop?: string; labelBottom?: string } | null>(null);
  const [cmpA, setCmpA] = useState<string>("");
  const [cmpB, setCmpB] = useState<string>("");
  const [editTarget, setEditTarget] = useState<StudioBoardEditTarget | null>(null);
  const [view, setView] = useState<"grid" | "board">("grid");
  const [runningPanelPro, setRunningPanelPro] = useState(false);
  const [panelProProgress, setPanelProProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [buildingPrint, setBuildingPrint] = useState<{ done: number; total: number } | null>(null);
  // QC validation (golden-job-regression — the deterministic 5-check verifier).
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<{ pass: boolean; summary: string; checks: Array<{ id: string; label: string; pass: boolean; detail: string[] }> } | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkPhase, setBulkPhase] = useState<"analyzing" | "uploading" | null>(null);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const proofInputs = useRef<Record<string, HTMLInputElement | null>>({});
  const topProof3dInput = useRef<HTMLInputElement | null>(null);
  const [uploadingProofSide, setUploadingProofSide] = useState<string | null>(null);
  const bulkInput = useRef<HTMLInputElement | null>(null);
  const panelProAutoRan = useRef(false);
  // "Wrong design? Link the correct one" — re-point an order's proof at the right
  // RevisionStudio visualization (paste its /revision-studio?id=… link or the viz ID).
  const [relinkInput, setRelinkInput] = useState("");
  const [relinking, setRelinking] = useState(false);
  // Recent jobs list so the board can be browsed without typing an order number.
  const [recentJobs, setRecentJobs] = useState<Job[] | null>(null);
  const [loadingRecent, setLoadingRecent] = useState(false);
  // BLANK BASE + LOGO PACK (Trish 2026-07-24: "PanelPro wasn't showing the
  // extracted logos or the blank back panel without the logo"). The blank base is
  // the AUTHORED logo-free clean artboard; the logo pack is the real-pixel elements
  // lifted off the design. Both let the design team lay clean panels on vehicle
  // templates and place/resize the separated logos for sizing QC.
  const [cleanBase, setCleanBase] = useState<{ clean?: string; branded?: string }>({});
  // Per-side BLANK (logo-free) panels from the vault — shown in the design-assets
  // area so the design team can pull each side onto a vehicle template for sizing.
  const [sideBlanks, setSideBlanks] = useState<Array<{ side: string; url: string; dims: string }>>([]);
  const [logoPack, setLogoPack] = useState<Array<{ url: string; label: string }>>([]);

  // Load the most recent production jobs (newest first) so the landing screen
  // can show "current jobs" as a clickable list instead of a blank search box.
  const loadRecentJobs = useCallback(async () => {
    setLoadingRecent(true);
    try {
      const { data } = await supabase
        .from("panelizer_jobs" as any)
        .select("id, user_id, generation_id, order_number, status, vehicle_year, vehicle_make, vehicle_model, concept_json, all_view_urls, created_at")
        .order("created_at", { ascending: false })
        .limit(40);
      // Keep only jobs that actually have an order number to act on.
      setRecentJobs(((data as any[]) || []).filter((j) => j.order_number));
    } catch {
      setRecentJobs([]);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  // ── Search a job by order number (accepts "RP-100947" or "100947") ──
  const runSearch = useCallback(async (raw: string) => {
    const q = (raw || "").trim();
    if (!q) return;
    setSearching(true);
    setNotFound(false);
    setJob(null);
    setProof2d("");
    const digits = q.replace(/[^0-9]/g, "");
    try {
      let query = supabase
        .from("panelizer_jobs" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1);
      query = digits
        ? query.ilike("order_number", `%${digits}%`)
        : query.ilike("order_number", `%${q}%`);
      const { data } = await query;
      let found = (data as any[])?.[0] as Job | undefined;
      // Fallback: the input may be a raw job/generation UUID rather than an order #.
      if (!found && /^[0-9a-f-]{8,}$/i.test(q)) {
        const { data: byId } = await supabase
          .from("panelizer_jobs" as any)
          .select("*")
          .or(`id.eq.${q},generation_id.eq.${q}`)
          .order("created_at", { ascending: false })
          .limit(1);
        found = (byId as any[])?.[0] as Job | undefined;
      }
      // Fallback 2: WePrintWraps / ApprovePro orders live in proof_approvals,
      // with the order number inside metadata (wpw_order_number / wpw_woo_order_id).
      // Wrapped so a query issue here can never break the RestylePro search above.
      if (!found) {
        try {
          const term = digits || q;
          let pa: any = null;
          for (const col of ["wpw_order_number", "wpw_woo_order_id", "order_number"]) {
            const { data: paRows } = await supabase
              .from("proof_approvals" as any)
              .select("*")
              .ilike(`metadata->>${col}`, `%${term}%`)
              .order("created_at", { ascending: false })
              .limit(1);
            if ((paRows as any[])?.[0]) { pa = (paRows as any[])[0]; break; }
          }
          if (!pa && /^[0-9a-f-]{8,}$/i.test(q)) {
            const { data } = await supabase.from("proof_approvals" as any).select("*").eq("id", q).limit(1);
            pa = (data as any[])?.[0] || null;
          }
          if (pa) found = await buildApproveProJob(pa);
        } catch (err) {
          console.warn("[StudioBoard] ApprovePro lookup failed", err);
        }
      }
      // Fallback 3: a bare design UUID with NO order — RecreatePro / DesignIQ
      // designs. Resolve (a) color_visualizations.id → canonical designiq id via
      // admin_notes.designiq_generation_id, or (b) a direct production_flow_assets
      // job_id (the Build Assets vault key). Reuse the panelizer job keyed to the
      // canonical id if one exists, else mint one (same pattern as
      // ensureBackingPanelizerJob) so the board has a real row to persist into
      // and the vault pull / extract can run without an order number.
      if (!found && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q)) {
        try {
          const { data: viz } = await supabase
            .from("color_visualizations" as any)
            .select("id, vehicle_year, vehicle_make, vehicle_model, render_urls, admin_notes, custom_design_url")
            .eq("id", q).maybeSingle();
          const notes = viz ? safeParseNotes((viz as any).admin_notes) : {};
          const canonicalGid = notes?.designiq_generation_id ? String(notes.designiq_generation_id) : "";
          // The canonical designiq id may already carry a panelizer job even though the cv id doesn't.
          if (canonicalGid) {
            const { data: byGid } = await supabase
              .from("panelizer_jobs" as any).select("*")
              .eq("generation_id", canonicalGid)
              .order("created_at", { ascending: false }).limit(1);
            found = (byGid as any[])?.[0] as Job | undefined;
          }
          // Direct vault hit: the UUID IS the canonical id Build Assets are keyed to.
          let hasVault = false;
          if (!found && !viz) {
            const { data: pfa } = await supabase
              .from("production_flow_assets" as any)
              .select("job_id").eq("job_id", q).limit(1);
            hasVault = !!(pfa as any[])?.length;
          }
          if (!found && (viz || hasVault)) {
            const { data: u } = await supabase.auth.getUser();
            const uid = u?.user?.id;
            if (!uid) throw new Error("Sign in to load this design.");
            const vz: any = viz || {};
            const proof = notes.flat_proof_url || (vz.render_urls || {}).production_proof
              || notes.layer_background_url || notes.custom_design_url || vz.custom_design_url || "";
            const { data: minted, error: mintErr } = await supabase.from("panelizer_jobs" as any).insert({
              user_id: uid,
              order_number: `DESIGN-${q.slice(0, 8)}`,
              // cv id (vault pull resolves canonical via admin_notes) or designiq id (vault pull hits it direct)
              generation_id: q,
              status: "studio_board",
              job_type: "designiq",
              vehicle_year: vz.vehicle_year || null,
              vehicle_make: vz.vehicle_make || null,
              vehicle_model: vz.vehicle_model || null,
              all_view_urls: vz.render_urls || {},
              concept_json: { flat_proof_url: proof, render_urls: vz.render_urls || {}, qc_side_panels: {} },
            }).select("*").single();
            if (mintErr) throw mintErr;
            found = minted as any as Job;
          }
        } catch (err) {
          console.warn("[StudioBoard] design-id lookup failed", err);
        }
      }
      if (!found) { setNotFound(true); return; }
      setJob(found);
      // Keep a raw UUID in the URL (a minted DESIGN-xxxxxxxx order number's digits
      // could ilike-match an unrelated real order on reload), and preserve
      // &run=panelpro so the RevisionStudio deep-link auto-extract still fires.
      const isUuidQ = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
      const nextParams: Record<string, string> = { order: isUuidQ ? q : (found.order_number || q) };
      const runFlag = new URLSearchParams(window.location.search).get("run");
      if (runFlag) nextParams.run = runFlag;
      setParams(nextParams);
    } catch (e: any) {
      toast({ title: "Search failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  }, [setParams, toast]);

  // ── Re-link the loaded order to the CORRECT design ──
  // When the board resolves an order to the wrong visualization (e.g. it grabbed
  // a stale/draft proof's design), an admin pastes the correct RevisionStudio link
  // or visualization ID here. This re-points proof_approvals.source_visualization_id
  // — the SAME field the approval page, AI-revise, and order-number search read —
  // best-effort saves the design as the proof's active version, then re-resolves
  // the board. It persists in the real proof record, so the fix holds in the UI.
  const relinkDesign = useCallback(async () => {
    if (!job) return;
    if (job.source !== "approvepro") {
      toast({ title: "Re-link applies to order proofs only", description: "This job isn't an ApprovePro/WPW order proof.", variant: "destructive" });
      return;
    }
    const uuid = (relinkInput || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    if (!uuid) {
      toast({ title: "Paste a RevisionStudio link or visualization ID", description: "e.g. /revision-studio?id=… or the viz UUID.", variant: "destructive" });
      return;
    }
    setRelinking(true);
    try {
      // Accept either a visualization ID or a proof ID (resolve the latter to its viz).
      let vizId = uuid;
      let { data: viz } = await supabase
        .from("color_visualizations" as any)
        .select("id, render_urls, admin_notes, custom_design_url")
        .eq("id", vizId).maybeSingle();
      if (!viz) {
        const { data: pa } = await supabase
          .from("proof_approvals" as any)
          .select("source_visualization_id").eq("id", uuid).maybeSingle();
        const srcId = (pa as any)?.source_visualization_id;
        if (srcId) {
          vizId = srcId;
          const r = await supabase
            .from("color_visualizations" as any)
            .select("id, render_urls, admin_notes, custom_design_url")
            .eq("id", vizId).maybeSingle();
          viz = r.data;
        }
      }
      if (!viz) throw new Error("No visualization found for that link/ID.");

      // The order resolves to this proof (job.id === proof_approvals.id for
      // approvepro jobs) — re-point it at the correct design.
      const { error: upErr } = await supabase
        .from("proof_approvals" as any)
        .update({ source_visualization_id: vizId }).eq("id", job.id);
      if (upErr) throw new Error(upErr.message);

      // Best-effort: also make it the proof's active version so the customer
      // approval page + AI-revise reflect the corrected design (mirrors
      // AttachDesignDialog). The board binding above is the must-have.
      const ru = (viz as any).render_urls;
      if (ru && Object.keys(ru).length) {
        try {
          await supabase.functions.invoke("proof-save-version", {
            body: { proof_id: job.id, render_urls: ru, shop_message: "Corrected design link from Studio Board" },
            headers: { "Idempotency-Key": `relink-${job.id}-${vizId}-${Date.now()}` },
          });
        } catch { /* version save is best-effort; binding already persisted */ }
      }

      toast({ title: "Design re-linked", description: "Re-resolving the board…" });
      setRelinkInput("");
      await runSearch(job.order_number || params.get("order") || "");
    } catch (e: any) {
      toast({ title: "Couldn't re-link", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setRelinking(false);
    }
  }, [job, relinkInput, runSearch, params, toast]);

  // Auto-search when arriving with ?order=… (e.g. deep link from another page).
  useEffect(() => {
    const o = params.get("order");
    if (o && !job) runSearch(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the recent-jobs list whenever there's no job loaded (landing screen).
  useEffect(() => {
    if (!job && recentJobs === null) loadRecentJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  // Resolve the 2D proof once a job loads: concept_json first, then the linked
  // designiq_generations / color_visualizations (same resolution order the rest
  // of the app uses).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!job) return;
      const cj = job.concept_json || {};
      const direct = cj.flat_proof_url || cj.render_urls?.production_proof || "";
      if (direct) { setProof2d(direct); return; }
      const gid = job.generation_id;
      if (!gid) return;
      try {
        const { data: gen } = await supabase
          .from("designiq_generations" as any)
          .select("flat_proof_url").eq("id", gid).maybeSingle();
        if (!cancelled && (gen as any)?.flat_proof_url) { setProof2d((gen as any).flat_proof_url); return; }
      } catch { /* fall through */ }
      try {
        const { data: viz } = await supabase
          .from("color_visualizations" as any)
          .select("admin_notes").eq("id", gid).maybeSingle();
        const raw = (viz as any)?.admin_notes;
        if (!cancelled && raw) {
          const n = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (n?.flat_proof_url) setProof2d(n.flat_proof_url);
        }
      } catch { /* none */ }
    })();
    return () => { cancelled = true; };
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: reflect external approvals/uploads so the progress stays in sync
  // with ProductionFlow / Designer QC editing the SAME job.
  useEffect(() => {
    if (!job?.id || job.source === "approvepro") return; // proof_approvals jobs aren't on this channel
    const channel = supabase
      .channel(`gemini-compare-${job.id}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "panelizer_jobs", filter: `id=eq.${job.id}` },
        (payload) => setJob((prev) => (prev ? { ...prev, ...(payload.new as any) } : (payload.new as any))))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [job?.id]);

  const viewMap = useMemo(() => {
    const fromAll = toViewUrlMap(job?.all_view_urls);
    const fromConcept = toViewUrlMap(job?.concept_json?.render_urls);
    return { ...fromConcept, ...fromAll };
  }, [job?.all_view_urls, job?.concept_json]);

  const qcPanels: Record<string, any> = job?.concept_json?.qc_side_panels || {};
  const approvedCount = VIEW_DEFS.filter((d) => qcPanels[d.sideKey]?.approved).length;
  const total = VIEW_DEFS.length;
  const pct = Math.round((approvedCount / total) * 100);

  // Every comparable asset as a draggable board tile: 2D proof, each 3D side
  // render, and each uploaded Gemini file.
  const boardItems = useMemo<BoardItem[]>(() => {
    const out: BoardItem[] = [];
    if (proof2d) out.push({ id: "proof-2d", label: "2D Proof", url: proof2d, kind: "proof" });
    VIEW_DEFS.forEach((def) => {
      const sys = qcPanels[def.sideKey]?.proof_url || viewUrlFor(viewMap, def);
      if (sys) out.push({ id: `3d-${def.sideKey}`, label: `3D ${def.label}`, url: sys, kind: "3d", sideKey: def.sideKey });
      const g = qcPanels[def.sideKey]?.gemini_url;
      if (g) out.push({ id: `gemini-${def.sideKey}`, label: `${def.label} panel`, url: g, kind: "gemini", sideKey: def.sideKey });
    });
    return out;
  }, [proof2d, viewMap, job?.concept_json]); // eslint-disable-line react-hooks/exhaustive-deps

  // Write the managed concept (qc_side_panels) to the correct backing table:
  // panelizer_jobs.concept_json for RestylePro jobs, or
  // proof_approvals.metadata.studio_board for WePrintWraps/ApprovePro jobs.
  const writeConcept = useCallback(async (nextConcept: any) => {
    const cur = jobRef.current || job;
    if (!cur?.id) return;
    if (cur.source === "approvepro") {
      // Merge into the existing studio_board blob so flat_proof_url / panelizer_job_id
      // set elsewhere aren't clobbered by a side-approval write.
      const prevSb = (cur._metadata || {}).studio_board || {};
      const sb: any = { ...prevSb, qc_side_panels: nextConcept.qc_side_panels || {} };
      if (nextConcept.flat_proof_url !== undefined) sb.flat_proof_url = nextConcept.flat_proof_url;
      const meta = { ...(cur._metadata || {}), studio_board: sb };
      const { error } = await supabase.from("proof_approvals" as any).update({ metadata: meta }).eq("id", cur.id);
      if (error) throw error;
      // Keep the backing panelizer_job (if one exists) in sync so ProductionFlow /
      // the GENIE panelizer reflect Studio Board approvals for WPW orders too.
      if (cur._panelizerJobId) {
        const { error: backingError } = await supabase.from("panelizer_jobs" as any)
          .update({ concept_json: { ...(nextConcept || {}), render_urls: cur.all_view_urls || {} } })
          .eq("id", cur._panelizerJobId);
        if (backingError) throw backingError;
      }
      jobRef.current = jobRef.current
        ? { ...jobRef.current, _metadata: meta }
        : jobRef.current;
      setJob((prev) => (prev ? { ...prev, _metadata: meta } : prev));
    } else {
      const { error } = await supabase.from("panelizer_jobs" as any).update({ concept_json: nextConcept }).eq("id", cur.id);
      if (error) throw error;
    }
  }, [job]);

  // Ensure an ApprovePro/WPW order has a backing panelizer_jobs row so it can flow
  // into ProductionFlow + the GENIE panelizer (RestylePro jobs already ARE that
  // row). Reuses an existing job for the order number, else mints one carrying the
  // views + 2D proof + current approvals, and remembers it on the proof.
  const ensureBackingPanelizerJob = useCallback(async (): Promise<string | null> => {
    const cur = jobRef.current || job;
    if (!cur?.id) return null;
    if (cur.source !== "approvepro") return cur.id; // already a panelizer job
    if (cur._panelizerJobId) return cur._panelizerJobId;

    let pjId = "";
    // 1) Reuse an existing panelizer_job for this order number.
    if (cur.order_number) {
      const digits = cur.order_number.replace(/[^0-9]/g, "");
      const { data } = await supabase.from("panelizer_jobs" as any)
        .select("id").ilike("order_number", `%${digits || cur.order_number}%`)
        .order("created_at", { ascending: false }).limit(1);
      pjId = (data as any)?.[0]?.id || "";
    }
    // 2) Otherwise mint one from this order's data.
    if (!pjId) {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) throw new Error("Sign in to set up production for this order.");
      const { data, error } = await supabase.from("panelizer_jobs" as any).insert({
        user_id: uid,
        order_number: cur.order_number || `PROOF-${cur.id.slice(0, 8)}`,
        generation_id: cur.generation_id || null,
        status: "studio_board",
        job_type: "approvepro",
        vehicle_year: cur.vehicle_year || null,
        vehicle_make: cur.vehicle_make || null,
        vehicle_model: cur.vehicle_model || null,
        all_view_urls: cur.all_view_urls || {},
        concept_json: { ...(cur.concept_json || {}), render_urls: cur.all_view_urls || {} },
      }).select("id").single();
      if (error) throw error;
      pjId = (data as any).id;
    }
    // 3) Remember it on the proof + locally so it's reused next time.
    const sb = { ...((cur._metadata || {}).studio_board || {}), qc_side_panels: cur.concept_json?.qc_side_panels || {}, panelizer_job_id: pjId };
    const meta = { ...(cur._metadata || {}), studio_board: sb };
    setJob((prev) => (prev ? { ...prev, _metadata: meta, _panelizerJobId: pjId } : prev));
    await supabase.from("proof_approvals" as any).update({ metadata: meta }).eq("id", cur.id);
    return pjId;
  }, [job]);

  // Open ProductionFlow / Designer QC against the RIGHT job id (mints the backing
  // panelizer_job for approvepro orders first).
  const goToProductionFlow = useCallback(async () => {
    try {
      const id = await ensureBackingPanelizerJob();
      if (id) navigate(`/productionflow/${id}`);
    } catch (e: any) {
      toast({ title: "Couldn't open ProductionFlow", description: e?.message || "Try again", variant: "destructive" });
    }
  }, [ensureBackingPanelizerJob, navigate, toast]);

  // goToDesignerQc removed (2026-07-24 board audit): legacy QC surface — the
  // ProductionPackQCCard on this page owns checklist + stamp + WrapBox.

  // ── Persist a side's versions + approval onto the SHARED job row ──
  // Each side keeps a VERSIONS list (uploads, Panel Pro Extract, edits, flips)
  // so a new file never deletes a good one. `gemini_url` stays as the ACTIVE
  // pointer (what ProductionFlow / approval read), so the GENIE panelizer is
  // unaffected. Existing single-file sides are migrated into a first version.
  const persistSide = useCallback(async (
    def: (typeof VIEW_DEFS)[number],
    patch: {
      approved?: boolean;
      addVersion?: { url: string; source: string; score?: number; match?: boolean; issues?: string[]; makeActive?: boolean; printTiffUrl?: string; printPngUrl?: string; note?: string };
      setActiveUrl?: string;
      removeVersionId?: string;
      geminiUrl?: string; // legacy: set active (ensures a version exists)
      // True print dimensions of the active panel (GENIE trim + bleed). Stored on
      // the side so Upscale can drive the real upscaler to the true print pixel size.
      // `source` is the dimension-resolution tag (e.g. genie:database, csv:…,
      // genie-standard) so the card can show verified vs. needs-tape-measure.
      printDims?: { widthInches?: number; heightInches?: number; bleedInches?: number; source?: string };
      // Per-side 3D "Real design proof" override. The board normally shows the
      // job's render for a side; uploading a correct render here supersedes it
      // (set a url), and "" / null reverts to the job render. Lets a user replace
      // a WRONG 3D proof without re-rendering the whole job.
      proofUrl?: string | null;
      // Hide/delete the job's render for a side (the red X on the 3D proof). When
      // hidden with no override, the slot shows the Upload prompt so a correct 3D
      // proof can be dropped in. Uploading an override clears this automatically.
      proofHidden?: boolean;
    },
  ) => {
    const currentJob = jobRef.current || job;
    if (!currentJob?.id) return;
    setSavingSide(def.sideKey);
    const cj = currentJob.concept_json || {};
    const existing = cj.qc_side_panels || {};
    const prevSide = existing[def.sideKey] || {};

    // Migrate a pre-versions side: seed its single file as version #1.
    let versions: any[] = Array.isArray(prevSide.versions) ? [...prevSide.versions] : [];
    if (versions.length === 0 && prevSide.gemini_url) {
      versions.push({
        id: `v-${prevSide.gemini_uploaded_at || Date.now()}`,
        url: prevSide.gemini_url,
        source: prevSide.gemini_source || "upload",
        createdAt: prevSide.gemini_uploaded_at || new Date().toISOString(),
      });
    }

    const previousActiveUrl = String(prevSide.gemini_url || "");
    let activeUrl: string = previousActiveUrl;

    if (patch.addVersion) {
      const v = {
        id: (globalThis.crypto?.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
        url: patch.addVersion.url,
        source: patch.addVersion.source,
        score: typeof patch.addVersion.score === "number" ? patch.addVersion.score : undefined,
        match: typeof patch.addVersion.match === "boolean" ? patch.addVersion.match : undefined,
        issues: Array.isArray(patch.addVersion.issues) ? patch.addVersion.issues : undefined,
        // Worker-produced print files (1500-DPI CMYK TIFF + full-res PNG), so the
        // board can offer print downloads on this version.
        printTiffUrl: patch.addVersion.printTiffUrl || undefined,
        printPngUrl: patch.addVersion.printPngUrl || undefined,
        note: patch.addVersion.note || undefined,
        createdAt: new Date().toISOString(),
      };
      versions.push(v);
      // Newest becomes active unless explicitly added as a side option
      // (separated background/overlay layers don't steal the active panel).
      if (patch.addVersion.makeActive !== false) activeUrl = v.url;
    }
    if (patch.geminiUrl !== undefined) {
      activeUrl = patch.geminiUrl;
      if (patch.geminiUrl && !versions.some((v) => v.url === patch.geminiUrl)) {
        versions.push({ id: `v-${Date.now()}`, url: patch.geminiUrl, source: "edit", createdAt: new Date().toISOString() });
      }
    }
    if (patch.setActiveUrl !== undefined) {
      activeUrl = patch.setActiveUrl;
    }
    if (patch.removeVersionId) {
      const removed = versions.find((v) => v.id === patch.removeVersionId);
      versions = versions.filter((v) => v.id !== patch.removeVersionId);
      if (removed && removed.url === activeUrl) {
        activeUrl = versions.length ? versions[versions.length - 1].url : "";
      }
    }

    const activeVersion = [...versions]
      .reverse()
      .find((version: any) => version?.url === activeUrl);
    const activePointerChanged =
      activeUrl !== previousActiveUrl ||
      patch.setActiveUrl !== undefined ||
      patch.geminiUrl !== undefined ||
      Boolean(patch.addVersion && patch.addVersion.makeActive !== false);
    const nextSide: any = {
      ...prevSide,
      label: def.label,
      view: def.view,
      versions,
      gemini_url: activeUrl,
      gemini_source: activeUrl
        ? String(activeVersion?.source || prevSide.gemini_source || "")
        : "",
      gemini_uploaded_at: new Date().toISOString(),
    };
    let activeIdentityChanged = false;
    if (activePointerChanged) {
      const previousIdentity = [
        prevSide.active_entice_pack_id,
        prevSide.active_entice_revision_id,
        prevSide.active_entice_designiq_generation_id,
        String(prevSide.active_entice_pack_version || ""),
        prevSide.active_entice_vault_role,
      ].join("|");
      const isExactVerifiedVaultVersion =
        activeVersion?.source === "build-assets" &&
        activeVersion?.vault_role === "branded" &&
        activeVersion?.entice_pack_id &&
        activeVersion?.revision_id &&
        activeVersion?.designiq_generation_id &&
        activeVersion?.pack_version;
      if (isExactVerifiedVaultVersion) {
        nextSide.active_entice_pack_id = activeVersion.entice_pack_id;
        nextSide.active_entice_revision_id = activeVersion.revision_id;
        nextSide.active_entice_designiq_generation_id = activeVersion.designiq_generation_id;
        nextSide.active_entice_pack_version = String(activeVersion.pack_version);
        nextSide.active_entice_vault_role = "branded";
      } else {
        delete nextSide.active_entice_pack_id;
        delete nextSide.active_entice_revision_id;
        delete nextSide.active_entice_designiq_generation_id;
        delete nextSide.active_entice_pack_version;
        delete nextSide.active_entice_vault_role;
      }
      const nextIdentity = [
        nextSide.active_entice_pack_id,
        nextSide.active_entice_revision_id,
        nextSide.active_entice_designiq_generation_id,
        String(nextSide.active_entice_pack_version || ""),
        nextSide.active_entice_vault_role,
      ].join("|");
      activeIdentityChanged = previousIdentity !== nextIdentity;
      if (
        patch.approved === undefined &&
        (activeUrl !== previousActiveUrl || activeIdentityChanged)
      ) {
        nextSide.approved = false;
        nextSide.approved_at = null;
      }
    }
    if (patch.approved !== undefined) {
      nextSide.approved = patch.approved;
      nextSide.approved_at = patch.approved ? new Date().toISOString() : null;
    }
    // Removing the last version clears approval (nothing left to approve).
    if (!activeUrl) nextSide.approved = false;
    // Persist the active panel's true print dims (GENIE trim + bleed) so Upscale
    // can target the real print pixel size (realInches × DPI).
    if (patch.printDims && (patch.printDims.widthInches || patch.printDims.heightInches)) {
      nextSide.print_width_in = patch.printDims.widthInches;
      nextSide.print_height_in = patch.printDims.heightInches;
      nextSide.print_bleed_in = patch.printDims.bleedInches ?? 2;
      if (patch.printDims.source) nextSide.print_size_source = patch.printDims.source;
    }
    // Per-side 3D proof override: set the uploaded render, or clear to revert to
    // the job's render. (Independent of the A.C.E. panel versions above.)
    if (patch.proofUrl !== undefined) {
      nextSide.proof_url = patch.proofUrl || "";
      // Uploading a correct proof clears any "deleted job render" state.
      if (patch.proofUrl) nextSide.proof_hidden = false;
    }
    if (patch.proofHidden !== undefined) {
      nextSide.proof_hidden = patch.proofHidden;
    }

    const nextConcept = { ...cj, qc_side_panels: { ...existing, [def.sideKey]: nextSide } };
    // SYNCHRONOUSLY advance the ref so the NEXT sequential persistSide (the bulk
    // run writes side-by-side in a tight loop) reads THIS side's update. Without
    // this, jobRef only refreshes asynchronously after re-render, so each side was
    // rebuilt from a stale snapshot and overwrote (deleted) the previously-saved
    // sides. This is the fix for "it's deleting panels".
    jobRef.current = { ...(currentJob as any), concept_json: nextConcept };
    setJob((prev) => (prev ? { ...prev, concept_json: nextConcept } : prev));
    try {
      await writeConcept(nextConcept);
    } catch (e: any) {
      toast({ title: "Could not save", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setSavingSide(null);
    }
  }, [job, toast, writeConcept]);

  // Set which version of a side is the active one (used for compare/approve).
  const setActiveVersion = useCallback((def: (typeof VIEW_DEFS)[number], url: string) => {
    return persistSide(def, { setActiveUrl: url });
  }, [persistSide]);

  // Delete a single version from a side (keeps the others).
  const removeVersion = useCallback((def: (typeof VIEW_DEFS)[number], versionId: string) => {
    return persistSide(def, { removeVersionId: versionId });
  }, [persistSide]);

  // Upload Lance's Gemini flat artwork for a side → storage → attach to the job.
  const handleUpload = async (def: (typeof VIEW_DEFS)[number], file: File) => {
    if (!job?.id || !file) return;
    setUploadingSide(def.sideKey);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `gemini-compare/${job.id}/${def.sideKey}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || "image/png", upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
      await persistSide(def, { addVersion: { url: `${publicUrl}?t=${Date.now()}`, source: "upload" } });
      toast({ title: `${def.label} uploaded`, description: "Compare it to the real view, then Approve." });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setUploadingSide(null);
      const el = fileInputs.current[def.sideKey];
      if (el) el.value = "";
    }
  };

  // Upload a CORRECT 3D render for a side's "Real design proof" → storage →
  // store as a per-side override (supersedes the job's render). Lets a user
  // delete/replace a WRONG 3D proof without re-rendering the whole job.
  const handleProofUpload = async (def: (typeof VIEW_DEFS)[number], file: File) => {
    if (!job?.id || !file) return;
    setUploadingProofSide(def.sideKey);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `gemini-compare/${job.id}/${def.sideKey}_proof_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || "image/png", upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
      await persistSide(def, { proofUrl: `${publicUrl}?t=${Date.now()}` });
      toast({ title: `${def.label} proof replaced`, description: "The correct 3D render now shows here." });
    } catch (e: any) {
      toast({ title: "Proof upload failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setUploadingProofSide(null);
      const el = proofInputs.current[def.sideKey];
      if (el) el.value = "";
    }
  };

  // Delete a side's 3D proof (the red X). Clears any uploaded override AND hides
  // the job's render, so the slot becomes an Upload prompt for the correct 3D
  // proof. Re-uploading (handleProofUpload) clears the hidden state.
  const deleteProof = useCallback(async (def: (typeof VIEW_DEFS)[number]) => {
    await persistSide(def, { proofUrl: "", proofHidden: true });
    toast({ title: `${def.label} 3D proof deleted`, description: "Upload the correct 3D render to replace it." });
  }, [persistSide, toast]);

  // Restore a deleted/hidden job render (undo the red X when nothing was uploaded).
  const restoreProof = useCallback(async (def: (typeof VIEW_DEFS)[number]) => {
    await persistSide(def, { proofHidden: false });
  }, [persistSide]);

  // ── BUILD PRINT FILES (Railway worker) ──────────────────────────────────────
  // One click: run every side's deterministic slice through the print worker
  // (multi-pass ESRGAN → true 150 PPI, 10" mirror bleed, 1500-DPI CMYK TIFF +
  // full-res PNG), then pin the result as that side's active version carrying
  // printTiffUrl/printPngUrl so the TIFF/PNG download buttons light up. Source =
  // the SAME Build Assets slices the board pulls; nothing is regenerated by AI.
  const buildPrintFiles = useCallback(async () => {
    const cur = jobRef.current || job;
    if (!cur?.id) return;
    try {
      const { data: u } = await supabase.auth.getUser();
      const uid = u?.user?.id;
      if (!uid) { toast({ title: "Sign in required", variant: "destructive" }); return; }

      const order = cur.order_number || cur.id;
      const PUB = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/wrap-files/`;
      const qc: Record<string, any> = cur.concept_json?.qc_side_panels || {};

      // Source = the BIGGEST clean source for the side. Prefer the user's
      // UPLOADED hi-res design (source:"upload") so the upscaler has real
      // resolution to work with — a low-res A.C.E. flatten just gets softened.
      // Never re-process our own worker output (those carry printTiffUrl).
      const targets = VIEW_DEFS.map((def) => {
        const s = qc[def.sideKey];
        if (!s) return null;
        const versions: any[] = Array.isArray(s.versions) ? s.versions : [];
        const uploads = versions.filter((v) => v.source === "upload" && !v.printTiffUrl);
        const active = versions.find((v) => v.url === s.gemini_url && !v.printTiffUrl);
        let src = uploads[uploads.length - 1] || active || null;
        if (!src) for (let i = versions.length - 1; i >= 0; i--) { if (!versions[i].printTiffUrl) { src = versions[i]; break; } }
        const url = (src?.url) || s.gemini_url;
        if (!url) return null;
        const m = String(url).match(/\/wrap-files\/(.+?)(\?|$)/);
        if (!m) return null; // must live in wrap-files for the worker to pull it
        const inputPath = decodeURIComponent(m[1]);
        const W = Number(s.print_width_in) || 0;
        const H = Number(s.print_height_in) || 0;
        if (!W || !H) return null; // need true print dims
        return { def, inputPath, W, H };
      }).filter(Boolean) as { def: (typeof VIEW_DEFS)[number]; inputPath: string; W: number; H: number }[];

      if (!targets.length) {
        toast({ title: "No print-ready sides", description: "Each side needs a verified panel + print dimensions first.", variant: "destructive" });
        return;
      }

      // The worker's stampPrintWorker updates panelizer_jobs WHERE id = jobId.
      // For approvepro orders cur.id is a proof_approvals id — stamping it lands
      // nowhere and the QC card never appears. Mint/reuse the backing panelizer
      // job FIRST (same as ProductionFlow navigation does) so the hi-res stamps
      // land on a real job and the QC checklist/stamp/WrapBox chain can run.
      const workerJobId = await ensureBackingPanelizerJob();
      if (!workerJobId) { toast({ title: "Couldn't resolve the production job", variant: "destructive" }); return; }

      setBuildingPrint({ done: 0, total: targets.length });
      let done = 0, failed = 0;
      // The Clarity Pro upscale can run ~3 min — longer than the edge function's
      // 150s idle timeout — but the worker writes straight to storage and keeps
      // going. So if the invoke times out, poll for the worker's DETERMINISTIC
      // output path (worker/index.js: {panelKey}_{W}x{H}_1500dpi_CMYK.tiff).
      const head = async (path: string) => {
        try { return (await fetch(PUB + path, { method: "HEAD", cache: "no-store" })).ok; } catch { return false; }
      };
      const waitFor = async (path: string, ms: number) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { if (await head(path)) return true; await new Promise((r) => setTimeout(r, 5000)); }
        return false;
      };
      for (const t of targets) {
        try {
          const w = Math.round(t.W), h = Math.round(t.H);
          const base = `production-packs/${uid}/${order}/${t.def.sideKey}`;
          const expTiff = `${base}_${w}x${h}_1500dpi_CMYK.tiff`;
          const expPng = `${base}_${w}x${h}_1500dpi.png`;
          const expPrev = `${base}.png`;

          let tiffUrl: string | undefined, pngUrl: string | undefined, previewUrl: string | undefined;
          try {
            const { data, error } = await renderClient.functions.invoke("studioboard-build-print", {
              // NATIVE recipe: no upscaling (native pixels = crispy, nothing
              // resampled) + a 5" soft bleed ring. The deterministic path the
              // shop validated — no AI, no wave, no crash.
              body: {
                // jobId MUST be a real panelizer JOB id — the worker's
                // stampPrintWorker updates panelizer_jobs WHERE id = jobId.
                // workerJobId is cur.id for panelizer jobs and the minted/reused
                // backing job for approvepro orders (proof_approvals ids stamp
                // nowhere and the QC card never appears).
                jobId: workerJobId, userId: uid, orderNumber: order, panelKey: t.def.sideKey,
                widthInches: t.W, heightInches: t.H, inputPath: t.inputPath,
                native: true, addBleed: true,
              },
            });
            if (!error && data?.success) {
              tiffUrl = data.tiffPath ? PUB + data.tiffPath : undefined;
              pngUrl = data.pngPath ? PUB + data.pngPath : undefined;
              previewUrl = data.previewPath ? PUB + data.previewPath : undefined;
            }
          } catch { /* edge 504 on slow Clarity — fall through to storage poll */ }

          if (!tiffUrl) {
            const ok = await waitFor(expTiff, 240000);
            if (!ok) throw new Error("timed out waiting for print file");
            tiffUrl = PUB + expTiff;
            pngUrl = (await head(expPng)) ? PUB + expPng : undefined;
            previewUrl = (await head(expPrev)) ? PUB + expPrev : undefined;
          }
          await persistSide(t.def, {
            addVersion: {
              url: `${previewUrl || PUB + t.inputPath}?t=${Date.now()}`, source: "upscale", makeActive: true,
              printTiffUrl: tiffUrl, printPngUrl: pngUrl, note: 'Native (no upscale) · 1500 DPI CMYK · 5" soft bleed',
            },
            printDims: { widthInches: t.W, heightInches: t.H, bleedInches: 5, source: "native" },
          });
          done++;
        } catch (e: any) {
          failed++;
          console.warn("[StudioBoard] build-print failed for", t.def.sideKey, e?.message || e);
        }
        setBuildingPrint({ done: done + failed, total: targets.length });
      }
      setBuildingPrint(null);
      toast({
        title: `Print files built: ${done}/${targets.length}`,
        description: failed ? `${failed} side(s) failed — click again to retry those.` : 'Each side now has a 1500-DPI CMYK TIFF + full-res PNG (Clarity Pro hi-res, clean).',
        variant: failed ? "destructive" : undefined,
      });
    } catch (e: any) {
      setBuildingPrint(null);
      toast({ title: "Build print files failed", description: e?.message || "Try again", variant: "destructive" });
    }
  }, [job, persistSide, toast, ensureBackingPanelizerJob]);

  // Upload a file straight onto a specific side from the board (no auto-classify).
  const uploadToSide = useCallback(async (sideKey: string, file: File) => {
    const def = VIEW_DEFS.find((d) => d.sideKey === sideKey);
    if (def) await handleUpload(def, file);
  }, [job?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remove the ACTIVE version off a side (keeps any other versions).
  const removeGemini = useCallback(async (sideKey: string) => {
    const def = VIEW_DEFS.find((d) => d.sideKey === sideKey);
    if (!def) return;
    const side = jobRef.current?.concept_json?.qc_side_panels?.[sideKey];
    const active = (side?.versions || []).find((v: any) => v.url === side?.gemini_url);
    if (active) await persistSide(def, { removeVersionId: active.id });
    else await persistSide(def, { setActiveUrl: "" });
  }, [persistSide]);

  // ── Download a side's active panel file (fetch → blob so cross-origin URLs
  // actually save instead of navigating). Names it {order}_{Side}.{ext}. ──
  const downloadPanel = useCallback(async (def: (typeof VIEW_DEFS)[number], url: string) => {
    if (!url) return;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const blob = await r.blob();
      const ext = (url.split("?")[0].match(/\.(png|jpe?g|tiff?|webp|svg)$/i)?.[1] || "png").toLowerCase();
      const order = (jobRef.current as any)?.order_number || (jobRef.current as any)?.id || "panel";
      const name = `${order}_${def.label.replace(/[^A-Za-z0-9]+/g, "-")}.${ext}`;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl; a.download = name; document.body.appendChild(a); a.click();
      a.remove(); URL.revokeObjectURL(objUrl);
    } catch (e: any) {
      toast({ title: `Download failed`, description: e?.message || "could not fetch the panel", variant: "destructive" });
    }
  }, [toast]);


  // ── Replace / remove the 2D production proof ──
  // The board sometimes resolves to the wrong 2D proof. This uploads the CORRECT
  // proof image and pins it as concept_json.flat_proof_url (panelizer_jobs) or
  // metadata.studio_board.flat_proof_url (ApprovePro/WPW), so it sticks on reload.
  const persistProofOverride = useCallback(async (url: string) => {
    const cur = jobRef.current;
    if (!cur?.id) return;
    if (cur.source === "approvepro") {
      const sb = { ...((cur._metadata || {}).studio_board || {}), qc_side_panels: cur.concept_json?.qc_side_panels || {}, flat_proof_url: url };
      const meta = { ...(cur._metadata || {}), studio_board: sb };
      setJob((prev) => (prev ? { ...prev, _metadata: meta, concept_json: { ...(prev.concept_json || {}), flat_proof_url: url } } : prev));
      const { error } = await supabase.from("proof_approvals" as any).update({ metadata: meta }).eq("id", cur.id);
      if (error) throw error;
    } else {
      const nextConcept = { ...(cur.concept_json || {}), flat_proof_url: url };
      setJob((prev) => (prev ? { ...prev, concept_json: nextConcept } : prev));
      const { error } = await supabase.from("panelizer_jobs" as any).update({ concept_json: nextConcept }).eq("id", cur.id);
      if (error) throw error;
    }
  }, []);

  const handleReplaceProof = async (file: File) => {
    if (!job?.id || !file) return;
    setReplacingProof(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `gemini-compare/${job.id}/proof2d_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wrap-files")
        .upload(path, file, { contentType: file.type || "image/png", upsert: true });
      if (upErr) throw new Error(upErr.message);
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      await persistProofOverride(url);
      setProof2d(url);
      toast({ title: "2D proof replaced", description: "The correct proof is now pinned to this order." });
    } catch (e: any) {
      toast({ title: "Couldn't replace proof", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setReplacingProof(false);
      if (proofInput.current) proofInput.current.value = "";
    }
  };

  const handleRemoveProof = async () => {
    if (!job?.id) return;
    setReplacingProof(true);
    try {
      await persistProofOverride("");
      setProof2d("");
      toast({ title: "2D proof removed", description: "Upload the correct 2D proof to replace it." });
    } catch (e: any) {
      toast({ title: "Couldn't remove proof", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setReplacingProof(false);
    }
  };

  // Per-side "Upscale" was removed: under the native 1/10 print-scale strategy the
  // panel ships as native pixels and the shop's RIP scales 1000% to true size. Any
  // client-side upscaler only INTERPOLATES — the soft/bloated "large but not crisp"
  // files we deliberately eliminated. Print files come from the production pack's
  // native-1/10 path, so there is nothing to upscale here.

  // Full printed size (inches, trim + 2× bleed) for a side, if known — lets the
  // editor's Upscale tab drive a TRUE-size (realInches × 150 DPI) upscale instead
  // of a flat 2×/4× that can't reach print resolution.
  const printDimsForSide = useCallback((sideKey: string): { printWidthIn?: number; printHeightIn?: number } => {
    const s = jobRef.current?.concept_json?.qc_side_panels?.[sideKey];
    const bleedIn = Number(s?.print_bleed_in) || 0;
    const w = Number(s?.print_width_in), h = Number(s?.print_height_in);
    if (w > 0 && h > 0) return { printWidthIn: w + 2 * bleedIn, printHeightIn: h + 2 * bleedIn };
    return {};
  }, []);

  // Mirror a side's Gemini file horizontally (e.g. reuse a driver-side design on
  // the passenger side). Bakes a flipped PNG via canvas (taint-safe blob load),
  // uploads it, and replaces that side's file.
  // Horizontally flip an image URL (taint-safe blob load → canvas) and upload
  // the mirrored PNG. Returns the public URL. Shared by flipSide + the
  // passenger-from-driver mirror in Panel Pro Extract.
  const flipUrlToStorage = useCallback(async (url: string, sideKey: string): Promise<string> => {
    const blob = await (await fetch(url, { mode: "cors" })).blob();
    const obj = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("decode failed")); img.src = obj; });
    const { w: cw, h: ch } = canvasDims(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = cw; canvas.height = ch;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.translate(canvas.width, 0); ctx.scale(-1, 1);
    ctx.drawImage(img, 0, 0, cw, ch);
    URL.revokeObjectURL(obj);
    const outBlob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error("toBlob failed")), "image/png"));
    const path = `gemini-compare/${job!.id}/${sideKey}_flip_${Date.now()}.png`;
    const { error } = await supabase.storage.from("wrap-files").upload(path, outBlob, { contentType: "image/png", upsert: true });
    if (error) throw new Error(error.message);
    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
    return `${publicUrl}?t=${Date.now()}`;
  }, [job?.id]);

  const flipSide = useCallback(async (sideKey: string) => {
    const def = VIEW_DEFS.find((d) => d.sideKey === sideKey);
    const url = job?.concept_json?.qc_side_panels?.[sideKey]?.gemini_url;
    if (!def || !job?.id || !url) return;
    setFlippingSide(sideKey);
    try {
      const flippedUrl = await flipUrlToStorage(url, sideKey);
      await persistSide(def, { addVersion: { url: flippedUrl, source: "flip" } });
      toast({ title: `${def.label} flipped`, description: "Mirrored horizontally — added as a new version." });
    } catch (e: any) {
      toast({ title: "Flip failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setFlippingSide(null);
    }
  }, [job, persistSide, toast, flipUrlToStorage]);


  // separatePanel/persistRawDesignAssets REMOVED (2026-07-24 board audit):
  // the generative panel-pro-separate pass AI-invents a different design and
  // overwrote design_generation_assets.background_url (vault Layer 0),
  // failing golden-job-regression checks 4/5. Real-pixel separation only.

  // Build the PASSENGER panel from the DRIVER's separated layers WITHOUT any
  // magenta chroma (so it can never leave a pink fringe):
  //   1) mirror the CLEAN background (no text → nothing reads backwards)
  //   2) re-lay the text/logos using the DRIVER's OWN pixels, masked by the
  //      overlay's alpha (destination-in) and drawn UN-mirrored so lettering
  //      reads correctly. Sampling the driver — not the magenta-keyed overlay
  //      RGB — is what kills the pink edge.
  const passengerFromDriverLayers = useCallback(async (
    driverUrl: string,
    bgUrl: string,
    overlayUrl: string,
    sideKey: string,
  ): Promise<string> => {
    const load = async (u: string) => {
      const blob = await (await fetch(u, { mode: "cors" })).blob();
      const obj = URL.createObjectURL(blob);
      const img = new Image();
      await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("decode failed")); img.src = obj; });
      return { img, revoke: () => URL.revokeObjectURL(obj) };
    };
    const drv = await load(driverUrl);
    const bg = await load(bgUrl);
    const ov = await load(overlayUrl);
    try {
      // Cap to a mobile-safe size so two canvases + three decoded images can't
      // blow past the tab's memory limit on a phone.
      const { w: W, h: H } = canvasDims(drv.img.naturalWidth, drv.img.naturalHeight);
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas context");
      // 1) mirrored CLEAN background (text already removed → safe to flip)
      ctx.save();
      ctx.translate(W, 0); ctx.scale(-1, 1);
      ctx.drawImage(bg.img, 0, 0, W, H);
      ctx.restore();
      // 2) readable text/logo layer = driver pixels masked by the overlay alpha
      const tmp = document.createElement("canvas");
      tmp.width = W; tmp.height = H;
      const tctx = tmp.getContext("2d");
      if (!tctx) throw new Error("no temp canvas context");
      tctx.drawImage(drv.img, 0, 0, W, H);
      tctx.globalCompositeOperation = "destination-in"; // keep driver where overlay is opaque
      tctx.drawImage(ov.img, 0, 0, W, H);
      ctx.drawImage(tmp, 0, 0); // un-mirrored → text reads correctly
      const outBlob: Blob = await new Promise((res, rej) => canvas.toBlob((b) => b ? res(b) : rej(new Error("toBlob failed")), "image/png"));
      const path = `gemini-compare/${job!.id}/${sideKey}_passenger_${Date.now()}.png`;
      const { error } = await supabase.storage.from("wrap-files").upload(path, outBlob, { contentType: "image/png", upsert: true });
      if (error) throw new Error(error.message);
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
      return `${publicUrl}?t=${Date.now()}`;
    } finally {
      drv.revoke(); bg.revoke(); ov.revoke();
    }
  }, [job?.id]);

  // ── Extract a side's flat panel in ONE faithful A.C.E. pass ──────────────
  // A single image edit that flattens the EXACT photographic design — remove the
  // glare, vehicle and background, keep every color/gradient/logo/word once in
  // place. One pass (not three) is both FASTER and far more faithful: each extra
  // A.C.E. pass re-generates the whole image and drifts it toward a cartoon /
  // duplicates logos. The prompt forbids redrawing and duplication explicitly.
  const extractViaSteps = useCallback(async (
    def: (typeof VIEW_DEFS)[number],
    sourceUrl: string,
    sideSize: string,
    vehicleDims: any,
    onStep?: (label: string) => void,
    referenceImageUrl?: string,
    masterArtboardUrl?: string,
  ): Promise<string> => {
    if (!job?.id) return "";
    // Slop guard — the render-fed A.C.E. flatten is disabled (see flag above).
    // Callers already tried the deterministic Build Assets vault first; returning
    // "" makes them honestly report "upload the panel" instead of shipping slop.
    if (!STUDIO_RENDER_ACE_ENABLED) return "";
    onStep?.("processing");

    // ── PROVEN PATH: A.C.E. de-vehicle (panel-pro-extract) ───────────────────
    // The artboard-isolate (panel-pro-flatten-side) detour is DISABLED on purpose:
    // for these jobs the "master" is a 3D render (not a labeled flat sheet), so
    // flatten-side produced inconsistent panels. The PROVEN path is the A.C.E.
    // de-vehicle below (panel-pro-extract mode:"single" → full side + 5" bleed).
    // Re-enable only if a real labeled flat artboard is reintroduced.
    if (false && masterArtboardUrl) {
      try {
        const dk = (def.sideKey || "").toLowerCase();
        const v = vehicleDims || {};
        let widthInches: number | undefined;
        let heightInches: number | undefined;
        if (Number(v.bodyLengthInches) > 0) {
          if (dk.includes("hood") || dk.includes("front")) { widthInches = v.hoodWidthInches; heightInches = v.hoodLengthInches; }
          else if (dk.includes("roof") || dk.includes("top")) { widthInches = v.roofWidthInches; heightInches = v.roofLengthInches; }
          else if (dk.includes("rear") || dk.includes("back")) { widthInches = v.backWidthInches; heightInches = v.backHeightInches; }
          else { widthInches = v.bodyLengthInches; heightInches = v.bodyHeightInches; }
        }
        const sideLabel = ARTBOARD_LABELS[def.sideKey] || (def.label || "").toUpperCase();
        const { data: fl, error: flErr } = await renderClient.functions.invoke("panel-pro-flatten-side", {
          body: {
            masterArtboardUrl,
            sideLabel,
            widthInches,
            heightInches,
            vehicle: `${job.vehicle_make || ""} ${job.vehicle_model || ""}`.trim(),
            userId: job.user_id || "studio-board",
            jobId: job.id,
          },
        });
        const flUrl = (fl as any)?.url || (fl as any)?.panelUrl;
        if (!flErr && (fl as any)?.success && flUrl) return flUrl;
        console.warn(`[StudioBoard] ${def.label}: flatten-side from master failed — falling back to render extract:`, (fl as any)?.error || flErr?.message);
      } catch (e: any) {
        console.warn(`[StudioBoard] ${def.label}: flatten-side threw — falling back to render extract:`, e?.message || e);
      }
    }

    // Generative extract. Short, proven one-sentence wording; structural 1:1 rules
    // live in the edge function's RIGID systemInstruction (temperature 0). This is the
    // #2998 golden extractor (restored) — the path that produced clean panels before the
    // rectangle/multistep prompts started making Gemini reinvent the design.
    // (The Vertex mask-inpaint "clone" path was tried and reverted — the Gemini-built
    //  mask was unreliable and left the vehicle in / produced a worse panel. The
    //  panel-pro-clone-extract function stays deployed but is no longer in this path.)
    const prompt =
      "Take the image, remove the glare, then remove all the vehicle parts, and fill the exact same design to the edge.";
    const { data, error } = await renderClient.functions.invoke("panel-pro-extract", {
      body: {
        mode: "single",
        imageUrl: sourceUrl,
        prompt,
        view: def.view,
        sideKey: def.sideKey,
        label: def.label,
        sideSize,
        vehicleDims,
        vehicleMake: job.vehicle_make,
        vehicleModel: job.vehicle_model,
        // Consistency anchor — the same reference render for every panel so the
        // colours/finish match across all sides (DesignPro's 360-view mechanism).
        referenceImageUrl: referenceImageUrl || undefined,
        userId: job.user_id || "studio-board",
        jobId: job.id,
      },
    });
    const outUrl = (data as any)?.panelUrl || (data as any)?.url;
    if (error || !(data as any)?.success || !outUrl) {
      console.warn(`[StudioBoard] ${def.label} extract failed — ${(data as any)?.error || error?.message || "no image"}`);
      return "";
    }

    // COLOUR-LOCK to the truck: the generative extract drifts colours, so run the
    // deterministic panel-pro-color-match against the SOURCE render (saturated wrap
    // pixels only, so the gray studio doesn't skew it). Best-effort — keep the raw
    // panel if it fails.
    try {
      const { data: cm } = await renderClient.functions.invoke("panel-pro-color-match", {
        body: {
          imageUrl: outUrl,
          referenceUrl: sourceUrl,
          referenceSaturatedOnly: true,
          strength: 0.85,
          sideKey: def.sideKey,
          userId: job.user_id || "studio-board",
          jobId: job.id,
        },
      });
      const cmUrl = (cm as any)?.url || (cm as any)?.panelUrl;
      if ((cm as any)?.success && cmUrl) {
        console.log(`[StudioBoard] ${def.label}: colour-matched to truck render`);
        return cmUrl;
      }
    } catch (e: any) {
      console.warn(`[StudioBoard] colour match skipped for ${def.label}:`, e?.message || e);
    }
    return outUrl;
  }, [job]);

  // Conform a clean panel to the GENIE Universal Panelizer rectangle (per-side
  // W×H) and add a true 5" exterior bleed — the final shape of the panel we keep
  // (matches the proven manual workflow: a black rectangle with 5" of bleed all around).
  // Deterministic (no AI). Returns the bleed URL + the resolved true inch dims
  // (so Upscale can later drive the real upscaler to the TRUE print pixel size),
  // or the input (no dims) on any failure.
  const applyBleed = useCallback(async (
    def: (typeof VIEW_DEFS)[number],
    panelUrl: string,
    sideSize: string,
    vehicleDims: any,
  ): Promise<{ url: string; widthInches?: number; heightInches?: number; bleedInches?: number; source?: string }> => {
    if (!job?.id || !panelUrl) return { url: panelUrl };
    try {
      const { data, error } = await renderClient.functions.invoke("panel-pro-extract", {
        body: {
          mode: "bleed",
          imageUrl: panelUrl,
          view: def.view,
          sideKey: def.sideKey,
          label: def.label,
          sideSize,
          bleedInches: 5,
          vehicleDims,
          vehicleMake: job.vehicle_make,
          vehicleModel: job.vehicle_model,
          userId: job.user_id || "studio-board",
          jobId: job.id,
        },
      });
      const url = (data as any)?.url || (data as any)?.panelUrl;
      if (error || !(data as any)?.success || !url) throw new Error((data as any)?.error || error?.message || "bleed failed");
      return {
        url,
        widthInches: Number((data as any)?.widthInches) || undefined,
        heightInches: Number((data as any)?.heightInches) || undefined,
        bleedInches: Number((data as any)?.bleedInches) || 2,
        source: (data as any)?.sizeSource || undefined,
      };
    } catch (e: any) {
      console.warn(`[StudioBoard] bleed failed for ${def.label} — keeping un-bled panel:`, e?.message || e);
      return { url: panelUrl };
    }
  }, [job]);

  // Pull a panel's separated layers (clean background + text/logo overlay) WITHOUT
  // persisting them as card versions — used only to build a text-correct passenger
  // mirror. Returns nulls when there's nothing separable (pure pattern), so the
  // caller falls back to a whole-panel flip.
  const getLayersSilently = useCallback(async (
    def: (typeof VIEW_DEFS)[number],
    panelUrl: string,
  ): Promise<{ bg?: string; overlay?: string; hasElements: boolean }> => {
    try {
      const { data, error } = await renderClient.functions.invoke("panel-pro-separate", {
        body: { imageUrl: panelUrl, label: def.label, sideKey: def.sideKey, userId: job?.user_id || "studio-board", jobId: job?.id },
      });
      if (error || !(data as any)?.success || !(data as any)?.hasElements) return { hasElements: false };
      return {
        bg: (data as any).backgroundUrl ? `${(data as any).backgroundUrl}?t=${Date.now()}` : undefined,
        overlay: (data as any).overlayUrl ? `${(data as any).overlayUrl}?t=${Date.now()}` : undefined,
        hasElements: true,
      };
    } catch (e: any) {
      console.warn(`[StudioBoard] silent layer fetch failed for ${def.label}:`, e?.message || e);
      return { hasElements: false };
    }
  }, [job]);

  // Build the passenger panel from the driver. The mirror + text-correct compositing
  // now runs SERVER-SIDE in the panel-pro-passenger edge function (no dependency on
  // the browser canvas/CORS/memory). It mirrors the clean background and re-lays the
  // text un-mirrored so lettering reads forwards; when text can't be isolated it
  // returns the driver un-flipped (never a whole-panel flip), and only mirrors the
  // whole panel for a confirmed pure pattern. Shared by the bulk run and per-side.

  // ── Panel Pro Extract — one push, runs every side on its own ──
  // For each view that has a 3D render, box it and ask Gemini to remove the
  // glare + vehicle parts and fill the GENIE panel rectangle edge-to-edge,
  // then drop the flat panel into that side's slot. Sequential so the board
  // fills in live and Gemini rate limits stay happy.
  // ── Ensure this job has a real LABELED PANEL ARTBOARD ───────────────────────
  // The deliverable (the green-lightning / Forged-Fitness style sheet) is made by
  // the WORKING artboard system: design-panel-ai-generate mode:'artboard', which
  // feeds Gemini the gold-standard example artboards + real PVO per-side dimensions.
  // Prompt-generated jobs already have one (master_artboard_url) — use it. If a job
  // doesn't, generate it ONCE through that same generator, seeded with the job's
  // brief (concept_json.prompt) + the driver render as the exact design reference,
  // and persist it. Panels then derive from this real artboard, never from a 3D
  // render extract. Returns "" only if it truly can't be produced.
  const ensureMasterArtboard = useCallback(async (): Promise<string> => {
    const j = jobRef.current || job;
    if (!j?.id) return "";
    // 1) Saved master — prompt-generated jobs already have the good sheet.
    if (j.generation_id) {
      try {
        const { data: gen } = await supabase
          .from("designiq_generations" as any)
          .select("master_artboard_url")
          .eq("id", j.generation_id)
          .maybeSingle();
        const saved = (gen as any)?.master_artboard_url || "";
        if (saved) { console.log("[StudioBoard] using saved master artboard:", saved); return saved; }
      } catch (e) { console.warn("[StudioBoard] master lookup failed:", e); }
    }
    // GENERATION DISABLED (Trish 2026-07-22 "artboard is not path"): never AI-generate
    // a new master artboard here. Extraction is panel-pro-extract fed the 2D PROOF
    // (the entice pipeline). Only a pre-existing saved artboard is used, above.
    if (!STUDIO_RENDER_ACE_ENABLED) return "";
    // 2) None saved → generate via the SAME working generator (examples + PVO dims),
    //    reproducing THIS design from the job's brief + the driver render reference.
    const driverRef = viewUrlFor(viewMap, VIEW_DEFS.find((d) => d.sideKey === "driver_side")!) || "";
    const brief = (j.concept_json?.prompt as string)
      || `${j.vehicle_make || ""} ${j.vehicle_model || ""} full vehicle wrap`.trim();
    try {
      console.log("[StudioBoard] no saved master — generating panel artboard via mode:'artboard'");
      const { data, error } = await renderClient.functions.invoke("design-panel-ai-generate", {
        body: {
          mode: "artboard",
          prompt: brief,
          vehicleYear: j.vehicle_year || undefined,
          vehicleMake: j.vehicle_make || undefined,
          vehicleModel: j.vehicle_model || undefined,
          ...(driverRef
            ? { visionBoardImages: [{ slotLabel: "Design Reference", storageUrl: driverRef }], visionboard_intent: "exact_reference" }
            : {}),
          userId: j.user_id || "studio-board",
        },
      });
      const url = (data as any)?.renderUrl || (data as any)?.artboardUrl;
      if (error || !url) { console.warn("[StudioBoard] artboard generate failed:", (data as any)?.error || error?.message); return ""; }
      if (j.generation_id) {
        try { await supabase.from("designiq_generations" as any).update({ master_artboard_url: url }).eq("id", j.generation_id); } catch (_e) { /* non-fatal */ }
      }
      console.log("[StudioBoard] generated panel artboard:", url);
      return url;
    } catch (e: any) {
      console.warn("[StudioBoard] artboard generate threw:", e?.message || e);
      return "";
    }
  }, [job, viewMap]);

  // ── VERIFIED ACTIVE ENTICE PACK PULL ──────────────────────────────────────
  // PanelPro consumes one complete, production-eligible atomic Entice Pack.
  // Resolve the canonical DesignIQ generation first, then pin every asset read
  // to the unique verified active pack's exact pack/revision/generation/version.
  // Reconcile the persisted board cache in one write; history and manual uploads
  // remain immutable, and no partial side-by-side update can be reported ready.
  const pullBuildAssetsVault = useCallback(async (opts?: { announce?: boolean }): Promise<number> => {
    const j = jobRef.current || job;
    if (!j?.id) return 0;

    const reconcileVaultState = async (pack: PanelProVaultPack | null): Promise<number> => {
      const currentJob = jobRef.current || j;
      const currentConcept = currentJob.concept_json || {};
      const reconciled = reconcilePanelProVaultState(
        currentConcept.qc_side_panels || {},
        VIEW_DEFS,
        pack,
      );
      if (!reconciled.changed) return reconciled.loadedCount;
      const nextConcept = {
        ...currentConcept,
        qc_side_panels: reconciled.qcSidePanels,
      };
      await writeConcept(nextConcept);
      const persistedJob = jobRef.current || currentJob;
      jobRef.current = { ...(persistedJob as any), concept_json: nextConcept };
      setJob((prev) => (prev ? { ...prev, concept_json: nextConcept } : prev));
      return reconciled.loadedCount;
    };

    const failClosed = async (message: string, detail?: unknown): Promise<number> => {
      console.warn(`[StudioBoard] ${message}`, detail || "");
      return reconcileVaultState(null);
    };

    let canonicalGid = j.generation_id || "";
    try {
      const { data: viz } = await supabase
        .from("color_visualizations" as any)
        .select("admin_notes").eq("id", j.generation_id).maybeSingle();
      const raw = (viz as any)?.admin_notes;
      const n = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
      if (n?.designiq_generation_id) canonicalGid = String(n.designiq_generation_id);
    } catch { /* fall back to j.generation_id */ }

    if (!canonicalGid) {
      return failClosed("vault pull refused: no canonical DesignIQ generation");
    }

    const { data: activePacks, error: activePackError } = await supabase
      .from("designpro_entice_packs" as any)
      .select("id, revision_id, designiq_generation_id, pack_version, proof_artifact, status, verified_at")
      .eq("designiq_generation_id", canonicalGid)
      .eq("status", "active")
      .limit(2);
    if (activePackError) {
      return failClosed("active Entice Pack lookup failed", activePackError);
    }
    if (!Array.isArray(activePacks) || activePacks.length !== 1) {
      return failClosed(
        `vault pull refused: expected one active Entice Pack for ${canonicalGid}, found ${activePacks?.length || 0}`,
      );
    }
    const activePack = activePacks[0] as any;
    if (
      !activePack?.id ||
      !activePack?.revision_id ||
      activePack?.designiq_generation_id !== canonicalGid ||
      !activePack?.pack_version ||
      !activePack?.verified_at ||
      !activePack?.proof_artifact?.url
    ) {
      return failClosed("vault pull refused: active Entice Pack is not verified or fully pinned");
    }

    const { data: pfa, error: pfaError } = await supabase
      .from("production_flow_assets" as any)
      .select("id, job_id, side, version, background_url, branding_url, final_pack_url, dimensions_inches, meta_metrics, created_at, revision_id, entice_pack_id, designiq_generation_id")
      .eq("entice_pack_id", activePack.id)
      .eq("revision_id", activePack.revision_id)
      .eq("designiq_generation_id", activePack.designiq_generation_id)
      .eq("version", activePack.pack_version)
      .order("created_at", { ascending: false });
    if (pfaError) {
      return failClosed("active Entice Pack asset lookup failed", pfaError);
    }
    const packState = getProductionPanelPackState(
      (Array.isArray(pfa) ? pfa : []) as ProductionFlowAssetRow[],
      activePack.proof_artifact.url,
    );
    if (
      !packState.hasCompleteAtomicPack ||
      !packState.productionEligible ||
      packState.version !== activePack.pack_version
    ) {
      return failClosed("vault pull refused: active Entice Pack is incomplete or production-blocked");
    }

    const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
    const panels: PanelProVaultPack["panels"] = [];
    const mappedSides = new Set<string>();
    for (const row of packState.packRows) {
      const def = VIEW_DEFS.find(
        (candidate) =>
          norm(row.side) === norm(candidate.label) ||
          norm(row.side) === norm(candidate.sideKey),
      );
      const brandedUrl = row.final_pack_url || row.branding_url || "";
      if (!def || !brandedUrl || mappedSides.has(def.sideKey)) {
        return failClosed("vault pull refused: active pack side mapping is incomplete");
      }
      mappedSides.add(def.sideKey);

      let printDims: PanelProVaultPack["panels"][number]["printDims"];
      const di: any = row.dimensions_inches;
      if (di && typeof di === "object") {
        const widthInches = Number(di.w ?? di.width) || 0;
        const heightInches = Number(di.h ?? di.height) || 0;
        if (widthInches && heightInches) {
          printDims = {
            widthInches,
            heightInches,
            bleedInches: 5,
            source: "build-assets",
          };
        }
      } else {
        const dimensionsMatch = String(di || "").match(/([\d.]+)\s*[x×]\s*([\d.]+)/i);
        if (dimensionsMatch) {
          printDims = {
            widthInches: parseFloat(dimensionsMatch[1]),
            heightInches: parseFloat(dimensionsMatch[2]),
            bleedInches: 5,
            source: "build-assets",
          };
        }
      }
      panels.push({
        sideKey: def.sideKey,
        label: def.label,
        view: def.view,
        brandedUrl,
        cleanUrl: row.background_url && row.background_url !== brandedUrl
          ? row.background_url
          : undefined,
        ...(printDims ? { printDims } : {}),
      });
    }
    if (panels.length !== packState.packRows.length) {
      return failClosed("vault pull refused: active pack side mapping is incomplete");
    }

    const loaded = await reconcileVaultState({
      id: String(activePack.id),
      revisionId: String(activePack.revision_id),
      designiqGenerationId: String(activePack.designiq_generation_id),
      version: String(activePack.pack_version),
      panels,
    });
    if (loaded > 0 && opts?.announce) {
      toast({
        title: `Pulled ${loaded} verified panel${loaded === 1 ? "" : "s"} into PanelPro`,
        description: "Loaded the exact active Entice Pack — verify or upscale it here.",
      });
    }
    return loaded;
  }, [job, toast, writeConcept]);

  // Reconcile the board to the exact verified active Entice Pack once per open
  // job. Existing human uploads and every historical version stay intact;
  // exact pack-identity reconciliation is idempotent across repeated mounts.
  const autoVaultRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job?.id || autoVaultRef.current === job.id) return;
    autoVaultRef.current = job.id;
    (async () => {
      try {
        const pulled = await pullBuildAssetsVault({ announce: false });
        if (pulled > 0) {
          toast({ title: `Loaded ${pulled} verified panel${pulled === 1 ? "" : "s"} from the active Entice Pack`, description: "The exact complete production-eligible pack — verify or upscale it here." });
        }
      } catch (e) {
        console.warn("[StudioBoard] auto vault-pull failed:", e);
      }
    })();
  }, [job?.id, pullBuildAssetsVault, toast]);

  // BLANK BASE + LOGO PACK loader — resolve the AUTHORED logo-free clean artboard
  // and the real-pixel logo elements for the open job, so the design team can lay
  // clean panels on templates and place/resize the separated logos. Read-only,
  // canonical-id aware (same admin_notes back-link + order family the vault uses).
  const basePackRef = useRef<string | null>(null);
  useEffect(() => {
    const j = job;
    if (!j?.id || basePackRef.current === j.id) return;
    basePackRef.current = j.id;
    (async () => {
      try {
        // Resolve canonical designiq id + the order family (RP-#####) so we find
        // the base/pack whether keyed to the render id or the designiq id.
        let canonical = j.generation_id || "";
        const family = new Set<string>([j.generation_id].filter(Boolean) as string[]);
        try {
          const { data: viz } = await supabase.from("color_visualizations" as any)
            .select("admin_notes, design_file_name").eq("id", j.generation_id).maybeSingle();
          const raw = (viz as any)?.admin_notes;
          const n = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
          if (n?.designiq_generation_id) { canonical = String(n.designiq_generation_id); family.add(canonical); }
          const m = /RP-\d+/i.exec((viz as any)?.design_file_name || "");
          if (m) {
            const { data: sibs } = await supabase.from("color_visualizations" as any)
              .select("id").ilike("design_file_name", `%${m[0]}%`);
            for (const s of (sibs || [])) if ((s as any)?.id) family.add(String((s as any).id));
          }
        } catch { /* use render id */ }

        // Blank base = the authored logo-free clean artboard (+ its branded twin).
        let clean = "", branded = "";
        try {
          const { data: dg } = await supabase.from("designiq_generations" as any)
            .select("master_artboard_clean_url, master_artboard_url").eq("id", canonical).maybeSingle();
          clean = (dg as any)?.master_artboard_clean_url || "";
          branded = (dg as any)?.master_artboard_url || "";
        } catch { /* none */ }
        setCleanBase({ clean: clean || undefined, branded: branded || undefined });

        // Logo pack — the ACTIVE verified Entice Pack's logo_artifacts are the
        // current source of truth (the Call 7 lift's plotter-ready cut assets,
        // byte-pinned per element). This board used to read only the legacy
        // admin_notes.logo_pack, which the revision-aware chain no longer
        // writes — that is why logo assets never appeared here. The legacy
        // notes remain a fallback for pre-revision designs only.
        const ids = Array.from(family);
        const byUrl = new Map<string, { url: string; label: string }>();
        try {
          const { data: packs } = await supabase.from("designpro_entice_packs" as any)
            .select("logo_artifacts, activated_at")
            .in("designiq_generation_id", ids.length ? ids : [canonical])
            .eq("status", "active")
            .not("verified_at", "is", null)
            .order("activated_at", { ascending: false })
            .limit(1);
          for (const l of (Array.isArray((packs?.[0] as any)?.logo_artifacts) ? (packs![0] as any).logo_artifacts : [])) {
            // `url` on a pack logo artifact IS the plotter-ready cut asset;
            // rebuild_url is the soft rebuild matte. The design team resizes
            // and lays the cut asset on templates, so surface that one.
            const u = String(l?.url || l?.cut_url || "");
            if (u && !byUrl.has(u)) {
              byUrl.set(u, {
                url: u,
                label: `${String(l?.side || "").toLowerCase() || "panel"} · ${String(l?.label || "Logo")}`,
              });
            }
          }
        } catch { /* fall through to the legacy notes */ }
        if (!byUrl.size && ids.length) {
          const { data: rows } = await supabase.from("color_visualizations" as any)
            .select("admin_notes, created_at").in("id", ids).order("created_at", { ascending: false });
          for (const row of (rows || [])) {
            let n: any = {};
            try { n = typeof (row as any)?.admin_notes === "string" ? JSON.parse((row as any).admin_notes) : ((row as any)?.admin_notes || {}); } catch { n = {}; }
            for (const l of (Array.isArray(n?.logo_pack) ? n.logo_pack : [])) {
              if (l?.url && !byUrl.has(l.url)) byUrl.set(l.url, { url: String(l.url), label: String(l.label || "Logo") });
            }
          }
        }
        setLogoPack(Array.from(byUrl.values()));

        // Per-side BLANK panels (logo-free background_url) from the vault, keyed by
        // the canonical designiq id (or the render family). Each is a 5" bleed,
        // logo-free crop the design team lays on a vehicle template for sizing QC.
        try {
          const { data: pfa } = await supabase.from("production_flow_assets" as any)
            .select("side, background_url, dimensions_inches")
            .in("job_id", ids.length ? ids : [canonical]);
          const blanks: Array<{ side: string; url: string; dims: string }> = [];
          const seen = new Set<string>();
          for (const r of (pfa || [])) {
            const u = (r as any)?.background_url;
            const side = String((r as any)?.side || "");
            if (!u || seen.has(side)) continue;
            seen.add(side);
            const di = (r as any)?.dimensions_inches || {};
            const w = di?.w ?? di?.width, h = di?.h ?? di?.height;
            blanks.push({ side, url: String(u), dims: (w && h) ? `${w}″ × ${h}″` : "" });
          }
          setSideBlanks(blanks);
        } catch { /* per-side blanks are optional */ }
      } catch (e) {
        console.warn("[StudioBoard] blank base / logo pack load failed:", e);
      }
    })();
  }, [job]);

  // VALIDATE (QC) — run golden-job-regression, the deterministic 5-check verifier
  // (dims match GENIE proof · 6/6 sides · panels opaque edge-to-edge w/ 5" bleed ·
  // no fabricated lifted layers · Layer-1 is the driver clean panel). Read-only,
  // no AI slop, no writes — shows per-check PASS/FAIL so QC is one click.
  const runValidate = useCallback(async () => {
    if (!job?.generation_id) {
      toast({ title: "No design linked", description: "This job has no generation id to validate.", variant: "destructive" });
      return;
    }
    setValidating(true);
    setValidation(null);
    try {
      const { data, error } = await renderClient.functions.invoke("golden-job-regression", {
        body: { generationId: job.generation_id },
      });
      if (error || !(data as any)?.success) {
        throw new Error((data as any)?.error || error?.message || "Validation failed to run");
      }
      const d = data as any;
      setValidation({ pass: !!d.pass, summary: d.summary || "", checks: Array.isArray(d.checks) ? d.checks : [] });
      toast({
        title: d.pass ? "QC passed — all 5 checks green" : "QC found issues",
        description: d.summary || "",
        variant: d.pass ? undefined : "destructive",
      });
    } catch (e: any) {
      toast({ title: "Validate failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setValidating(false);
    }
  }, [job?.generation_id, toast]);

  const runPanelProExtract = useCallback(async (forceAce = false) => {
    if (!job?.id) return;
    setRunningPanelPro(true);

    // ── LINK TO BUILD ASSETS ──────────────────────────────────────────────
    // If this design already has finished per-side panels from the Build Assets
    // flow (production_flow_assets), pull THOSE in instead of regenerating from
    // scratch. Build Assets is the reliable producer; A.C.E. was re-doing the
    // same work (and stalling on the artboard step). Resolve the canonical
    // generation id the Build Assets are keyed to (admin_notes.designiq_generation_id),
    // then load every side and drop it onto the board so the user can verify +
    // upscale the panels they already approved.
    // forceAce=true skips this pull entirely and runs the A.C.E. flatten — the
    // reliable backup while Build Assets is being refined.
    if (!forceAce) {
      try {
        const pulled = await pullBuildAssetsVault({ announce: true });
        if (pulled > 0) { setRunningPanelPro(false); return; }
      } catch (e) {
        console.warn("[StudioBoard] Build Assets pull failed:", e);
      }
      // NO deterministic Build Assets → STOP. Do NOT silently fall back to the
      // A.C.E. AI flatten: it hallucinates jagged / kaleidoscope panels with
      // garbled text (unusable for print). Require a real deterministic panel
      // or a manual upload. The AI export runs ONLY on an explicit
      // "A.C.E. Extract" click (forceAce=true), never automatically.
      setRunningPanelPro(false);
      toast({
        title: "No deterministic panels yet",
        description: "Upload the real per-side panel(s), or build a clean artboard first. The AI “A.C.E. Extract” is a manual draft only — it will not run automatically and its output is not print-safe.",
        variant: "destructive",
      });
      return;
    }

    // Renders are only required for the A.C.E. flatten fallback — the vault pull
    // above already succeeded for Build-Assets-backed jobs without any 3D views.
    const targets = VIEW_DEFS
      .map((def) => ({ def, url: viewUrlFor(viewMap, def) }))
      .filter((t) => !!t.url);
    if (targets.length === 0) {
      setRunningPanelPro(false);
      toast({ title: "No 3D renders found", description: "No Build Assets vault and no view renders to extract from.", variant: "destructive" });
      return;
    }

    let sideSize = job?.concept_json?.sideSize || job?.concept_json?.side_size || "medium";
    let done = 0;
    let failed = 0;

    // GENIE Panelizer sizing: resolve the SAME per-side dims the 2D proof stamps on
    // the 7th gen call. The 2D proof calls panelizer-step-validate in FULL mode (all
    // add-ons) and reads per-view dims; estimateOnly only returns SIDE dims, so
    // hood/roof/rear cards fell back and didn't match the proof. Use the full call so
    // `vehicle` carries every per-view inch (body/hood/roof/back) + the source tag —
    // identical to the proof. If it fails, panel-pro-extract still falls back per side.
    let vehicleDims: any = null;
    if (job.vehicle_make || job.vehicle_model) {
      try {
        const { data: est } = await renderClient.functions.invoke("panelizer-step-validate", {
          body: {
            vehicleMake: job.vehicle_make,
            vehicleModel: job.vehicle_model,
            vehicleYear: job.vehicle_year || null,
            sideSize: "medium",
            addHood: true,
            addRear: true,
            addRoof: true,
            addFrontBumper: true,
            addRearBumper: true,
          },
        });
        // `vehicle` holds the full VehicleDimensions (bodyLength/Height, hoodWidth/Length,
        // roofWidth/Length, backWidth/Height, source) — the exact shape resolvePanelSize
        // consumes, and the SAME numbers the proof stamps.
        if (Number((est as any)?.vehicle?.bodyLengthInches) > 0) {
          vehicleDims = (est as any).vehicle;
          if ((est as any).sideSize) sideSize = (est as any).sideSize;
          console.log(`[StudioBoard] GENIE sizing (matches 2D proof) for ${job.vehicle_make} ${job.vehicle_model}: source=${vehicleDims.source}`, vehicleDims);
        }
      } catch (err) {
        console.warn("[StudioBoard] panelizer-step-validate sizing failed — using per-side fallback", err);
      }
    }

    // ARTBOARD-FIRST source: ensure a real labeled PANEL ARTBOARD exists (the
    // working mode:'artboard' deliverable) and flatten each side off THAT — never
    // reverse-engineer from the 3D render. Generates the artboard if the job lacks
    // one. Empty only if it truly can't be produced → render-extract fallback runs.
    const masterArtboardUrl = await ensureMasterArtboard();

    const MAX_TRIES = 5; // retry agent rephrases (promptVariant) each round until it passes
    // NOTE: the colour-consistency reference (feeding the driver render as a 2nd
    // image) was removed — on harder views (rear/hood/roof) the second image made
    // A.C.E. return a half-rendered photo instead of a clean flattened panel.
    // The driver PANEL was then wired in as the same kind of reference and had the
    // same effect, one step later: every other side inherited driver artwork. No
    // side is given another side's pixels as a reference. Each extracts from its own.
    // Each side flattens from its OWN render only.
    try {
      for (const { def, url } of targets) {
        setPanelProProgress({ done, total: targets.length, label: def.label });
        try {
          // PASSENGER with its own 3D render gets its OWN extract — every target
          // in this loop has a render by construction, and designs can be
          // asymmetric (black "05" driver / green "04" passenger — RJ's job), so
          // mirroring the driver here printed the WRONG side with backwards text
          // and stamped it "Match 100". The driver-mirror shortcut lives ONLY in
          // the no-render fallback after this loop.

          let bestUrl = "";
          let bestScore = -1;
          let bestIssues: string[] = [];
          let correction = "";
          let matched = false;

          for (let attempt = 1; attempt <= MAX_TRIES && !matched; attempt++) {
            // Surface what the validator AI actually said so the re-ask is visible,
            // not just "try N". On retries, `correction`/`bestScore` hold the prior
            // round's verdict that is driving this re-ask.
            setPanelProProgress({ done, total: targets.length, label: def.label });

            // Every side extracts from its OWN render. Passing the driver panel as a
            // cross-side "colour reference" is what made passenger/front/rear come
            // back carrying driver artwork.
            const panelUrl = await extractViaSteps(
              def, url, sideSize, vehicleDims, undefined,
              undefined,
              masterArtboardUrl || undefined,
            );
            if (!panelUrl) {
              // Soft-fail: a failed step must NOT abort the side. Let the retry
              // agent re-ask instead of throwing out of the loop.
              console.warn(`[StudioBoard] ${def.label} attempt ${attempt}/${MAX_TRIES}: extract failed`);
              await new Promise((r) => setTimeout(r, 1500 * attempt));
              continue;
            }

            // 2) Validate by IMAGE — does the flat panel match the source design 1:1?
            let score = 100;
            try {
              const { data: v } = await renderClient.functions.invoke("panel-pro-validate", {
                body: {
                  sourceUrl: url,
                  panelUrl,
                  label: def.label,
                },
              });
              matched = (v as any)?.match === true;
              score = Number((v as any)?.score) ?? 0;
              correction = (v as any)?.correction || "";
              if (!matched) {
                console.log(`[StudioBoard] ${def.label} attempt ${attempt}: score ${score} — ${correction}`);
              }
              if (score > bestScore) { bestScore = score; bestUrl = panelUrl; bestIssues = Array.isArray((v as any)?.issues) ? (v as any).issues : []; }
            } catch (vErr) {
              // Validator outage → accept the panel rather than block.
              matched = true;
              console.warn(`[StudioBoard] validator unavailable for ${def.label} — accepting`, vErr);
              if (score > bestScore) { bestScore = score; bestUrl = panelUrl; }
            }

            // One-shot: the rectangle-constrained extract is deterministic (temperature
            // 0) and the prompt is a fixed bounding constraint, so re-running the SAME
            // prompt can't raise a low score — it only multiplies wall-clock (the old 5×
            // slowdown). A successful generation ends the loop; we only loop again when
            // the extract returned NO image (the `continue` above).
            break;
          }

          if (bestUrl) {
            // Conform the clean panel to the GENIE rectangle + 2" bleed (only the
            // panel we keep is reshaped — failed attempts are left as-is for review).
            let finalUrl = bestUrl;
            let printDims: { widthInches?: number; heightInches?: number; bleedInches?: number; source?: string } = {};
            if (matched) {
              setPanelProProgress({ done, total: targets.length, label: def.label });
              const bleed = await applyBleed(def, bestUrl, sideSize, vehicleDims);
              finalUrl = bleed.url;
              printDims = { widthInches: bleed.widthInches, heightInches: bleed.heightInches, bleedInches: bleed.bleedInches, source: bleed.source };
            }
            const savedUrl = `${finalUrl}?t=${Date.now()}`;
            // Only a PASSING panel becomes the active version. A failed one is
            // kept as a non-active "Review" version so it never sits on top of a
            // good upload (the validator's verdict actually gates activation).
            await persistSide(def, { addVersion: { url: savedUrl, source: "panel-pro", score: bestScore >= 0 ? bestScore : undefined, match: matched, issues: bestIssues, makeActive: matched }, printDims: matched ? printDims : undefined });
            // ALWAYS remember the driver panel so the passenger is its mirror —
            // even if the validator wasn't a perfect match. The gold workflow is
            // "flip the driver for the passenger", never an independent regen
            // (that's what produced a non-matching passenger before).
            if (!matched) {
              failed += 1; // kept as a Review version; active stays on the upload
            }
          } else {
            failed += 1;
          }
        } catch (e: any) {
          failed += 1;
          console.warn(`[StudioBoard] Panel Pro Extract failed for ${def.label}:`, e?.message || e);
          toast({ title: `${def.label} failed`, description: e?.message || "Skipped — you can re-run or upload manually.", variant: "destructive" });
        }
        done += 1;
        setPanelProProgress({ done, total: targets.length, label: def.label });
      }

      // No passenger fallback. A passenger side with no render of its own is an
      // honest gap for the server to fill; it is never built by flipping the
      // driver panel.

      const ok = done - failed;
      toast({
        title: failed === 0 ? `Panel Pro Extract complete — ${ok}/${done} sides matched` : `Panel Pro Extract: ${ok}/${done} sides matched`,
        description: failed === 0
          ? "Every side validated as a 1:1 match. Slide each over the proof, then Approve."
          : `${failed} side(s) need review — best attempt kept; re-run or upload those manually.`,
      });
    } finally {
      setRunningPanelPro(false);
      setPanelProProgress(null);
    }
  }, [job, viewMap, persistSide, toast, flipUrlToStorage, extractViaSteps, applyBleed, ensureMasterArtboard, pullBuildAssetsVault]);

  // ── Extract ONE side's flat panel from its 3D render, on demand ──
  // Same engine as the bulk run, but for a single side so you can (re)pull just
  // the hood, or redo a side that came out wrong, without re-running everything.
  // Passenger is ALWAYS a clean horizontal flip of the driver panel (so the two
  // sides are identical) — it only extracts its own render if there is no driver.
  const extractSide = useCallback(async (def: (typeof VIEW_DEFS)[number]) => {
    if (!job?.id) return;
    const url = viewUrlFor(viewMap, def);

    // ── DETERMINISTIC FIRST (navy intact) ───────────────────────────────────
    // Pull THIS side's Build Assets panel before doing anything AI. Build Assets
    // is a pure geometric slice of the approved artwork — it keeps the full
    // design and the body color (navy front + rear); the A.C.E. AI extract below
    // re-draws the side and drops the navy. Only fall through to AI if this side
    // has no Build Assets panel yet.
    try {
      let canonicalGid = job.generation_id || "";
      try {
        const { data: viz } = await supabase
          .from("color_visualizations" as any)
          .select("admin_notes").eq("id", job.generation_id).maybeSingle();
        const raw = (viz as any)?.admin_notes;
        const n = raw ? (typeof raw === "string" ? JSON.parse(raw) : raw) : {};
        if (n?.designiq_generation_id) canonicalGid = String(n.designiq_generation_id);
      } catch { /* fall back to job.generation_id */ }
      const gids = Array.from(new Set([canonicalGid, job.generation_id].filter(Boolean)));
      if (gids.length) {
        const { data: pfa } = await supabase
          .from("production_flow_assets" as any)
          .select("side, background_url, dimensions_inches").in("job_id", gids);
        const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
        const row = (pfa as any[] | null)?.find(
          (p) => norm(p.side) === norm(def.label) || norm(p.side) === norm((def as any).sideKey),
        );
        const bg = row?.background_url;
        // FRESH RE-EXTRACT ON SECOND CLICK: if this side's ACTIVE version is
        // already the vault panel, the user is clicking because that panel is
        // WRONG (bad hood) — re-pulling the same file would trap them. Skip the
        // pull and run a fresh extract below; the vault copy stays untouched.
        const activeUrl = String(jobRef.current?.concept_json?.qc_side_panels?.[def.sideKey]?.gemini_url || "").split("?")[0];
        const alreadyPulled = !!bg && !!activeUrl && String(bg).split("?")[0] === activeUrl;
        if (bg && !alreadyPulled) {
          setExtractingSide(def.sideKey);
          // Carry the panel's true print size (save-production-panels writes
          // {w,h}) so the card is labeled and Upscale can target print res —
          // this pull previously dropped the dims entirely.
          const di: any = row?.dimensions_inches;
          const dw = Number(di?.w ?? di?.width) || 0;
          const dh = Number(di?.h ?? di?.height) || 0;
          await persistSide(def, {
            addVersion: { url: `${bg}${bg.includes("?") ? "&" : "?"}t=${Date.now()}`, source: "build-assets", makeActive: true },
            ...(dw && dh ? { printDims: { widthInches: dw, heightInches: dh, bleedInches: 5, source: "build-assets" } } : {}),
          });
          toast({ title: `${def.label}: pulled deterministic panel`, description: "Full design + navy from Build Assets (no AI)." });
          setExtractingSide(null);
          return;
        }
      }
    } catch (e) { console.warn("[StudioBoard] extractSide build-assets pull failed — falling back to AI", e); }

    // The passenger side is never a flip of the driver. Mirroring reverses every
    // phone number, URL and logo on the printed wrap, and this path persisted the
    // flip as `match: true, score: 100` without anything ever comparing it to the
    // design. With no passenger source the side is an explicit gap.
    if (def.sideKey === "passenger_side" && !url) {
      toast({
        title: "Passenger side has no source",
        description: "No passenger render and no deterministic panel for this side. It stays a recorded gap — it is never mirrored from the driver, which would print all lettering backwards.",
        variant: "destructive",
      });
      setExtractingSide(null);
      return;
    }

    if (!url) {
      toast({ title: `No 3D render for ${def.label}`, description: "This side has no view render to extract from.", variant: "destructive" });
      return;
    }

    // GARBAGE SYSTEM REMOVED — no deterministic Build Assets panel for this side
    // and it isn't a passenger mirror. Do NOT run the AI flatten below: it
    // hallucinates jagged / kaleidoscope panels with garbled text that are not
    // print-safe. Require a real panel upload (or build a clean artboard) instead.
    setExtractingSide(null);
    toast({
      title: `No deterministic panel for ${def.label}`,
      description: "Upload the real panel for this side (or build a clean artboard). AI extraction has been removed — it is not print-safe.",
      variant: "destructive",
    });
    return;

    // eslint-disable-next-line no-unreachable
    setExtractingSide(def.sideKey);
    let sideSize = job?.concept_json?.sideSize || job?.concept_json?.side_size || "medium";
    // Resolve the SAME per-side dims the 2D proof stamps (full validate call) so a
    // single-side re-pull matches the proof exactly, just like the bulk run.
    let vehicleDims: any = null;
    if (job.vehicle_make || job.vehicle_model) {
      try {
        const { data: est } = await renderClient.functions.invoke("panelizer-step-validate", {
          body: {
            vehicleMake: job.vehicle_make, vehicleModel: job.vehicle_model, vehicleYear: job.vehicle_year || null,
            sideSize: "medium", addHood: true, addRear: true, addRoof: true, addFrontBumper: true, addRearBumper: true,
          },
        });
        if (Number((est as any)?.vehicle?.bodyLengthInches) > 0) {
          vehicleDims = (est as any).vehicle;
          if ((est as any).sideSize) sideSize = (est as any).sideSize;
        }
      } catch (err) {
        console.warn("[StudioBoard] extractSide sizing failed — using per-side fallback", err);
      }
    }
    // ARTBOARD-FIRST source (same as the bulk run): ensure the labeled panel
    // artboard exists, then flatten this side off it; render-extract is the fallback.
    const masterArtboardUrl = await ensureMasterArtboard();
    const MAX_TRIES = 3;
    let bestUrl = ""; let bestScore = -1; let bestIssues: string[] = []; let matched = false;
    try {
      for (let attempt = 1; attempt <= MAX_TRIES && !matched; attempt++) {
        // No cross-side reference. Anchoring a re-pull to the driver panel is how a
        // single side came back wearing driver artwork; this side extracts from its own.
        const panelUrl = await extractViaSteps(def, url, sideSize, vehicleDims, undefined, undefined, masterArtboardUrl || undefined);
        if (!panelUrl) {
          await new Promise((r) => setTimeout(r, 1200 * attempt));
          continue;
        }
        let score = 100;
        try {
          const { data: v } = await renderClient.functions.invoke("panel-pro-validate", {
            body: { sourceUrl: url, panelUrl, label: def.label },
          });
          matched = (v as any)?.match === true;
          score = Number((v as any)?.score) || 0;
          if (score > bestScore) { bestScore = score; bestUrl = panelUrl; bestIssues = Array.isArray((v as any)?.issues) ? (v as any).issues : []; }
        } catch {
          matched = true;
          if (score > bestScore) { bestScore = score; bestUrl = panelUrl; }
        }
        // One-shot: deterministic extract — a re-run can't improve a low score, only
        // multiply wall-clock. Keep the panel; only retry on a hard no-image failure.
        break;
      }
      if (bestUrl) {
        // GENIE rectangle + 2" bleed on the matched panel before we keep it.
        const bleed = matched ? await applyBleed(def, bestUrl, sideSize, vehicleDims) : { url: bestUrl };
        const savedUrl = `${bleed.url}?t=${Date.now()}`;
        await persistSide(def, {
          addVersion: { url: savedUrl, source: "panel-pro", score: bestScore >= 0 ? bestScore : undefined, match: matched, issues: bestIssues, makeActive: matched },
          printDims: matched ? { widthInches: (bleed as any).widthInches, heightInches: (bleed as any).heightInches, bleedInches: (bleed as any).bleedInches, source: (bleed as any).source } : undefined,
        });
        toast({
          title: matched ? `${def.label} extracted — match ${bestScore}` : `${def.label} extracted — needs review (${bestScore})`,
          description: matched ? "Flat panel pulled from the 3D render. Compare, then Approve." : "Best attempt kept as a Review version — re-extract or upload manually.",
        });
      } else {
        toast({ title: `${def.label} extract failed`, description: "The extract didn't return a panel — try again, or upload the panel.", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: `${def.label} extract failed`, description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setExtractingSide(null);
    }
  }, [job, viewMap, persistSide, toast, flipUrlToStorage, extractViaSteps, applyBleed, ensureMasterArtboard]);

  // Auto-kick the extract when deep-linked from RevisionStudio (?run=panelpro).
  // Fires once, after the job has loaded.
  useEffect(() => {
    if (!job?.id || panelProAutoRan.current) return;
    if (params.get("run") !== "panelpro") return;
    panelProAutoRan.current = true;
    runPanelProExtract();
  }, [job?.id, params, runPanelProExtract]);

  // Bulk upload up to all sides at once. Each file is auto-named to a side by
  // its IMAGE CONTENT via classify-vehicle-views (Gemini vision) — no filename
  // discipline required. Falls back to the filename, then to filling remaining
  // empty slots in order. Files upload in parallel, then ONE concept_json write
  // attaches every gemini_url so ProductionFlow stays in sync.
  const handleBulkUpload = async (fileList: FileList) => {
    if (!job?.id || !fileList?.length) return;
    const files = Array.from(fileList);
    setBulkUploading(true);
    setBulkPhase("analyzing");
    setBulkProgress(null);
    try {
      // 1a) Ask the vision model to name each file by content (camera angle → side).
      //     Resilient: any failure just falls through to filename/in-order below.
      const aiSideByIdx = new Map<number, string>();
      try {
        const payloads = await Promise.all(
          files.map(async (f, i) => {
            const { base64, mimeType } = await fileToClassifyPayload(f);
            return { id: `f-${i}`, data: base64, mimeType };
          }),
        );
        const { data, error } = await supabase.functions.invoke("classify-vehicle-views", {
          body: { images: payloads },
        });
        const classifications = (data as any)?.classifications;
        if (!error && Array.isArray(classifications)) {
          for (const c of classifications as Array<{ id: string; viewType: string }>) {
            const idx = Number(String(c.id).replace(/^f-/, ""));
            const sk = VIEWTYPE_TO_SIDEKEY[c.viewType];
            if (!Number.isNaN(idx) && sk) aiSideByIdx.set(idx, sk);
          }
        }
      } catch (err) {
        console.warn("[StudioBoard] auto-classify unavailable, using filenames", err);
      }

      // 1b) Resolve a side per file: AI content first, then filename, then in order.
      setBulkPhase("uploading");
      setBulkProgress({ done: 0, total: files.length });
      const used = new Set<string>();
      const assignments: Array<{ def: (typeof VIEW_DEFS)[number]; file: File }> = [];
      const leftover: File[] = [];
      files.forEach((file, idx) => {
        const key = aiSideByIdx.get(idx) || matchSideByFilename(file.name);
        const def = key ? VIEW_DEFS.find((d) => d.sideKey === key) : undefined;
        if (def && !used.has(def.sideKey)) {
          assignments.push({ def, file });
          used.add(def.sideKey);
        } else {
          leftover.push(file);
        }
      });
      for (const file of leftover) {
        const def = VIEW_DEFS.find((d) => !used.has(d.sideKey));
        if (!def) break; // every side already has a file in this batch
        assignments.push({ def, file });
        used.add(def.sideKey);
      }
      if (!assignments.length) {
        toast({ title: "Nothing to upload", description: "No free sides for the selected files." });
        return;
      }

      // 2) Upload all assigned files to storage (parallel), tick progress as each lands.
      let done = 0;
      const uploads = await Promise.all(
        assignments.map(async ({ def, file }) => {
          const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
          const path = `gemini-compare/${job.id}/${def.sideKey}_${Date.now()}.${ext}`;
          const { error: upErr } = await supabase.storage.from("wrap-files")
            .upload(path, file, { contentType: file.type || "image/png", upsert: true });
          if (upErr) throw new Error(`${def.label}: ${upErr.message}`);
          const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
          done += 1;
          setBulkProgress({ done, total: assignments.length });
          return { def, url: `${publicUrl}?t=${Date.now()}` };
        }),
      );

      // 3) APPEND each upload as a new version in qc_side_panels (single row update).
      //     Never overwrite an existing good file — it stays in the versions list.
      const cj = job.concept_json || {};
      const existing = cj.qc_side_panels || {};
      const nextPanels: Record<string, any> = { ...existing };
      const now = new Date().toISOString();
      for (const { def, url } of uploads) {
        const prev = existing[def.sideKey] || {};
        let versions: any[] = Array.isArray(prev.versions) ? [...prev.versions] : [];
        if (versions.length === 0 && prev.gemini_url) {
          versions.push({ id: `v-${prev.gemini_uploaded_at || Date.now()}`, url: prev.gemini_url, source: prev.gemini_source || "upload", createdAt: prev.gemini_uploaded_at || now });
        }
        versions.push({ id: (globalThis.crypto?.randomUUID?.() || `v-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`), url, source: "upload", createdAt: now });
        nextPanels[def.sideKey] = {
          ...prev,
          label: def.label,
          view: def.view,
          versions,
          gemini_url: url,
          gemini_uploaded_at: now,
        };
      }
      const nextConcept = { ...cj, qc_side_panels: nextPanels };
      setJob((prev) => (prev ? { ...prev, concept_json: nextConcept } : prev));
      await writeConcept(nextConcept);

      const matched = uploads.map((u) => u.def.label).join(", ");
      toast({ title: `Uploaded ${uploads.length} panel file${uploads.length === 1 ? "" : "s"}`, description: `Assigned to: ${matched}. Compare each side, then Approve.` });
    } catch (e: any) {
      toast({ title: "Bulk upload failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setBulkUploading(false);
      setBulkPhase(null);
      setBulkProgress(null);
      if (bulkInput.current) bulkInput.current.value = "";
    }
  };

  const vehicleName = job
    ? [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ")
    : "";

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header / search */}
      <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold">PanelPro Studio Board</h1>
                <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-[10px] text-gray-500" title="The live build you are on. After a deploy, this changes.">
                  build {typeof __BUILD_ID__ !== "undefined" ? __BUILD_ID__ : "dev"}
                </span>
              </div>
              <p className="text-xs text-gray-500">Generate, compare, and approve each side's print panel for the GENIE Universal Panelizer.</p>
            </div>
            <form
              className="ml-auto flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); runSearch(orderInput); }}
            >
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  value={orderInput}
                  onChange={(e) => setOrderInput(e.target.value)}
                  placeholder="Order / Job # (e.g. RP-100947)"
                  className="w-56 pl-8"
                />
              </div>
              <Button type="submit" disabled={searching || !orderInput.trim()}>
                {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
              </Button>
            </form>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-6">
        <StudioBoardExplainer />
        {!job && !searching && (
          <div className="space-y-6">
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-300 bg-white py-12 text-center">
              <ImageIcon className="mb-3 h-10 w-10 text-gray-300" />
              <p className="font-semibold">Search a job by order or job number</p>
              <p className="mt-1 max-w-md text-sm text-gray-500">
                Enter an order number (e.g. <span className="font-mono">RP-100947</span>), a WePrintWraps/ApprovePro order #, or any design UUID (job, generation, or visualization ID — no order needed) to load its views + 2D proof,
                then Load Build Assets Panels (deterministic per-side slices) or upload your own panel files — one per side, or all at once — to compare.
              </p>
              {notFound && <p className="mt-4 text-sm font-medium text-red-600">No production job, order, or design found for that reference.</p>}
            </div>

            {/* Current jobs — click straight in instead of typing an order #. */}
            <div className="rounded-xl border border-gray-200 bg-white p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold">Current jobs</h2>
                <Button variant="outline" size="sm" className="gap-1.5" disabled={loadingRecent} onClick={loadRecentJobs}>
                  {loadingRecent ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Refresh
                </Button>
              </div>
              {loadingRecent && recentJobs === null ? (
                <div className="flex items-center justify-center py-10 text-sm text-gray-500">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading jobs…
                </div>
              ) : recentJobs && recentJobs.length ? (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {recentJobs.map((j) => {
                    const panels = j.concept_json?.qc_side_panels || {};
                    const approved = VIEW_DEFS.filter((d) => panels[d.sideKey]?.approved).length;
                    const started = VIEW_DEFS.some((d) => panels[d.sideKey]?.gemini_url || (panels[d.sideKey]?.versions || []).length);
                    const name = [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(" ") || "Vehicle";
                    return (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => { setOrderInput(j.order_number || ""); setJob(j); setParams({ order: j.order_number || j.id }); }}
                        className="flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded bg-gray-900 px-1.5 py-0.5 font-mono text-[11px] text-white">{j.order_number}</span>
                          {started
                            ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{approved}/{VIEW_DEFS.length} approved</span>
                            : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">Not started</span>}
                        </div>
                        <span className="truncate text-sm font-semibold text-gray-800">{name}</span>
                        {j.status && <span className="text-[11px] text-gray-400">{j.status}</span>}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="py-6 text-center text-sm text-gray-500">No recent production jobs found.</p>
              )}
            </div>
          </div>
        )}

        {searching && (
          <div className="flex items-center justify-center py-20 text-gray-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Searching…
          </div>
        )}

        {job && (
          <div className="space-y-6">
            {/* Compact top row: job card (half) + action buttons next to it */}
            <div className="grid gap-4 md:grid-cols-2">
              {/* Job card */}
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-gray-900 px-2 py-0.5 font-mono text-xs text-white">{job.order_number || "—"}</span>
                  <span className="text-sm font-semibold">{vehicleName || "Vehicle"}</span>
                  {job.status && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">{job.status}</span>}
                </div>
                <div className="mt-3">
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-500">
                    <span>GENIE Universal Panelizer — sides approved</span>
                    <span className="font-medium text-gray-700">{approvedCount}/{total} ({pct}%)</span>
                  </div>
                  <div className="h-2.5 w-full overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-fuchsia-500 transition-all duration-500" style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  {/* Designer QC button removed (2026-07-24 board audit): the legacy
                      QC pages are NOT the flow — the ProductionPackQCCard on THIS
                      page owns the checklist + QC stamp + WrapBox delivery. */}
                  <Button size="sm" onClick={goToProductionFlow} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                    <Package className="h-4 w-4" /> ProductionFlow <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              {/* Actions: Extract + Upload */}
              <div className="flex flex-col justify-center gap-2 rounded-xl border border-gray-200 bg-white p-4">
                <Button
                  className="w-full gap-1.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110"
                  disabled={runningPanelPro || !job}
                  onClick={() => runPanelProExtract(false)}
                >
                  {runningPanelPro
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {panelProProgress ? `Loading panels (${panelProProgress.done}/${panelProProgress.total})…` : "Loading panels…"}</>
                    : <><Wand2 className="h-4 w-4" /> Load Build Assets Panels</>}
                </Button>
                <input
                  ref={bulkInput}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => { const fs = e.target.files; if (fs && fs.length) handleBulkUpload(fs); }}
                />
                <Button
                  variant="outline"
                  className="w-full gap-1.5"
                  disabled={bulkUploading}
                  onClick={() => bulkInput.current?.click()}
                >
                  {bulkUploading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> {bulkPhase === "analyzing" ? "Detecting sides…" : <>Uploading {bulkProgress ? `${bulkProgress.done}/${bulkProgress.total}` : ""}…</>}</>
                    : <><Upload className="h-4 w-4" /> Upload panel files</>}
                </Button>
                {/* Build true print files on the Railway worker: 1500-DPI CMYK
                    TIFF + full-res PNG, 10" bleed, for every side. */}
                <Button
                  className="w-full gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
                  disabled={!!buildingPrint || !job}
                  onClick={buildPrintFiles}
                  title="Run every side's slice through the print worker → 1500-DPI CMYK TIFF + full-res PNG with 5&quot; bleed"
                >
                  {buildingPrint
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Building print files ({buildingPrint.done}/{buildingPrint.total})…</>
                    : <><Package className="h-4 w-4" /> Build Print Files (1500-DPI)</>}
                </Button>
                {/* QC validation — deterministic 5-check verifier (golden-job-regression). */}
                <Button
                  variant="outline"
                  className="w-full gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-50"
                  disabled={validating || !job}
                  onClick={runValidate}
                  title="Run the deterministic 5-check QC verifier on this design's vault"
                >
                  {validating
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Validating…</>
                    : <><ShieldCheck className="h-4 w-4" /> Validate (QC)</>}
                </Button>
              </div>
            </div>

            {/* QC validation results — per-check PASS/FAIL from golden-job-regression. */}
            {validation && (
              <div className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold",
                    validation.pass ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700",
                  )}>
                    {validation.pass ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                    {validation.pass ? "QC PASS" : "QC FAIL"}
                  </span>
                  <span className="text-sm text-gray-600">{validation.summary}</span>
                </div>
                <ul className="space-y-2">
                  {validation.checks.map((c) => (
                    <li key={c.id} className="rounded-lg border border-gray-100 p-2.5">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                          c.pass ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700",
                        )}>
                          {c.pass ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        </span>
                        <span className="text-sm font-medium text-gray-800">{c.label}</span>
                      </div>
                      {Array.isArray(c.detail) && c.detail.length > 0 && (
                        <ul className="mt-1.5 ml-7 list-disc space-y-0.5 text-[11px] text-gray-500">
                          {c.detail.map((d, i) => <li key={i}>{d}</li>)}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Production Pack QC — ALL pack quality control in one place (the
                two-part check): AI checks (worker per-side print files +
                regression stamp + auto-ZIP) then the designer's Approve & Send
                to WrapBox. Renders once the print worker has run for this job. */}
            {/* For approvepro orders the on-screen job is a proof_approvals row —
                the QC card must key on the BACKING panelizer job (where the
                worker stamps land) or fall back to the generation id. */}
            <ProductionPackQCCard
              job={job?.source === "approvepro"
                ? (job?._panelizerJobId ? { id: job._panelizerJobId, order_number: job.order_number } : null)
                : job}
              generationId={job?.source === "approvepro" && !job?._panelizerJobId ? job?.generation_id || null : null}
            />

            {/* View toggle: structured compare grid vs free-form board */}
            <div className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-1 w-fit">
              <button
                type="button"
                onClick={() => setView("grid")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${view === "grid" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
              >
                <LayoutGrid className="h-4 w-4" /> Compare grid
              </button>
              <button
                type="button"
                onClick={() => setView("board")}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${view === "board" ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-100"}`}
              >
                <Move className="h-4 w-4" /> Free board
              </button>
            </div>

            {/* Free-form board: drag/resize/overlay/upload every asset */}
            {view === "board" && (
              boardItems.length ? (
                <div className="space-y-3">
                  {/* Compare any two side-by-side */}
                  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white p-3">
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-gray-700">
                      <SplitSquareHorizontal className="h-4 w-4" /> Compare any two
                    </span>
                    <select value={cmpA} onChange={(e) => setCmpA(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                      <option value="">Choose first…</option>
                      {boardItems.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
                    </select>
                    <span className="text-xs text-gray-400">vs</span>
                    <select value={cmpB} onChange={(e) => setCmpB(e.target.value)} className="rounded-md border border-gray-300 px-2 py-1.5 text-sm">
                      <option value="">Choose second…</option>
                      {boardItems.map((it) => <option key={it.id} value={it.id}>{it.label}</option>)}
                    </select>
                    <Button
                      size="sm" className="gap-1.5"
                      disabled={!cmpA || !cmpB || cmpA === cmpB}
                      onClick={() => {
                        const a = boardItems.find((i) => i.id === cmpA);
                        const b = boardItems.find((i) => i.id === cmpB);
                        if (a && b) setCompare({ real: b.url, gemini: a.url, label: `${a.label} vs ${b.label}`, labelTop: a.label, labelBottom: b.label });
                      }}
                    >
                      <SplitSquareHorizontal className="h-4 w-4" /> Compare
                    </Button>
                    <span className="text-xs text-gray-400">— then zoom/drag the top image to the same scale.</span>
                  </div>

                  <StudioBoardCanvas
                    jobId={job.id}
                    items={boardItems}
                    onEnlarge={(url, label) => setEnlarge({ url, label })}
                    onEdit={(it) => it.sideKey && setEditTarget({ url: it.url, label: it.label, sideKey: it.sideKey, referenceUrl: viewUrlFor(viewMap, VIEW_DEFS.find((d) => d.sideKey === it.sideKey)!) || undefined, ...printDimsForSide(it.sideKey) })}
                    onUploadToSide={uploadToSide}
                    onRemove={removeGemini}
                    onFlip={flipSide}
                    uploadingSide={uploadingSide}
                    flippingSide={flippingSide}
                  />
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-gray-300 bg-white py-16 text-center text-sm text-gray-500">No 3D views or uploads on this job yet.</div>
              )
            )}

            {view === "grid" && <>
            {/* 2D + 3D production proof — side by side, blue-bordered */}
            <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl p-4" style={{ background: "linear-gradient(#fff,#fff) padding-box, linear-gradient(90deg,#3b82f6,#ec4899) border-box", border: "2px solid transparent" }}>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-sm font-bold">2D Production Proof</h2>
                {/* Replace / remove the proof — for when the wrong one is showing. */}
                <div className="flex items-center gap-2">
                  <input
                    ref={proofInput}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleReplaceProof(f); }}
                  />
                  <Button
                    variant="outline" size="sm" className="gap-1.5"
                    disabled={replacingProof}
                    onClick={() => proofInput.current?.click()}
                    title="Upload the CORRECT 2D proof and pin it to this order"
                  >
                    {replacingProof ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                    {proof2d ? "Replace proof" : "Upload proof"}
                  </Button>
                  {proof2d && (
                    <Button
                      variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700"
                      disabled={replacingProof}
                      onClick={handleRemoveProof}
                      title="Remove this 2D proof"
                    >
                      <Trash2 className="h-4 w-4" /> Delete
                    </Button>
                  )}
                </div>
              </div>
              {proof2d ? (
                <button
                  type="button"
                  onClick={() => setEnlarge({ url: proof2d, label: "2D Production Proof" })}
                  className="group relative block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                >
                  <img src={proof2d} alt="2D proof" className="mx-auto max-h-[420px] w-auto object-contain" />
                  <span className="absolute right-2 top-2 rounded bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100">
                    <Maximize2 className="h-4 w-4" />
                  </span>
                </button>
              ) : (
                <p className="text-sm text-gray-500">No 2D proof on this job yet — generate it in Revision Studio, or use <span className="font-medium text-gray-700">Upload proof</span> above to attach the correct one.</p>
              )}
              {/* Wrong design / wrong proof? Re-point this order at the correct
                  RevisionStudio visualization. Persists on the order's proof record. */}
              {job?.source === "approvepro" && (
                <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-xs font-semibold text-amber-800">Wrong design showing? Link the correct one.</p>
                  <p className="mt-0.5 text-[11px] text-amber-700">
                    Open the right design in Revision Studio, copy its link (or visualization ID) and paste it here. This re-points the order to that design + its 2D proof.
                  </p>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={relinkInput}
                      onChange={(e) => setRelinkInput(e.target.value)}
                      placeholder="/revision-studio?id=…  or  visualization UUID"
                      className="h-9 flex-1 border-amber-300 bg-white text-sm text-gray-900"
                    />
                    <Button
                      onClick={relinkDesign}
                      disabled={relinking || !relinkInput.trim()}
                      className="h-9 bg-amber-600 hover:bg-amber-700 text-white"
                    >
                      {relinking ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Re-linking…</> : <><Wand2 className="mr-2 h-4 w-4" /> Link correct design</>}
                    </Button>
                  </div>
                </div>
              )}
            </div>

            {/* 3D production proof — the on-vehicle render (driver-side hero) */}
            {(() => {
              const driverDef = VIEW_DEFS.find((d) => d.sideKey === "driver_side")!;
              const dSide = qcPanels.driver_side || {};
              const dOverride: string = dSide.proof_url || "";
              const dHidden: boolean = !!dSide.proof_hidden;
              const proof3d = dOverride || (dHidden ? "" : viewUrlFor(viewMap, driverDef));
              const dUploading = uploadingProofSide === "driver_side";
              return (
              <div className="rounded-xl p-4" style={{ background: "linear-gradient(#fff,#fff) padding-box, linear-gradient(90deg,#3b82f6,#ec4899) border-box", border: "2px solid transparent" }}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold">3D Production Proof</h2>
                  {/* Replace / delete the 3D proof — for when the wrong render shows. */}
                  <div className="flex items-center gap-2">
                    <input
                      ref={topProof3dInput}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) handleProofUpload(driverDef, f); if (e.target) e.target.value = ""; }}
                    />
                    <Button
                      variant="outline" size="sm" className="gap-1.5"
                      disabled={dUploading}
                      onClick={() => topProof3dInput.current?.click()}
                      title="Upload the CORRECT 3D render and pin it to this side"
                    >
                      {dUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      {proof3d ? "Replace proof" : "Upload proof"}
                    </Button>
                    {proof3d && (
                      <Button
                        variant="outline" size="sm" className="gap-1.5 text-red-600 hover:text-red-700"
                        disabled={dUploading}
                        onClick={() => deleteProof(driverDef)}
                        title="Delete this 3D proof"
                      >
                        <Trash2 className="h-4 w-4" /> Delete
                      </Button>
                    )}
                  </div>
                </div>
                {proof3d ? (
                  <button type="button" onClick={() => setEnlarge({ url: proof3d, label: "3D Production Proof" })} className="group relative block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                    <img src={proof3d} alt="3D proof" className="mx-auto max-h-[420px] w-auto object-contain" />
                    <span className="absolute right-2 top-2 rounded bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100"><Maximize2 className="h-4 w-4" /></span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={dUploading}
                    onClick={() => topProof3dInput.current?.click()}
                    className="flex min-h-[200px] w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-sm font-medium text-gray-500 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600"
                  >
                    {dUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <><Upload className="h-5 w-5" /> Upload correct 3D proof</>}
                  </button>
                )}
              </div>
              );
            })()}
            </div>

            {/* BLANK BASE + LOGO PACK — the logo-free clean artboard the design
                team lays on vehicle templates for sizing QC, plus the real-pixel
                logos lifted off the design (download + resize). */}
            {(cleanBase.clean || cleanBase.branded || logoPack.length > 0 || sideBlanks.length > 0) && (
              <div className="mb-4 rounded-xl border border-fuchsia-200 bg-fuchsia-50/40 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Layers className="h-4 w-4 text-fuchsia-600" />
                  <h3 className="text-sm font-bold text-gray-900">Blank base &amp; Logo Pack</h3>
                  <span className="text-[11px] text-gray-500">for template sizing &amp; QC</span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {cleanBase.clean && (
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Blank base — no logo</div>
                      <button type="button" onClick={() => setEnlarge({ url: cleanBase.clean!, label: "Blank base — no logo" })} className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
                        <img src={cleanBase.clean} alt="Blank base (no logo)" className="aspect-video w-full object-contain" />
                      </button>
                      <a href={`${cleanBase.clean}${cleanBase.clean!.includes("?") ? "&" : "?"}download`} download className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 hover:text-emerald-700">
                        <Download className="h-3 w-3" /> Download blank base
                      </a>
                    </div>
                  )}
                  {cleanBase.branded && (
                    <div>
                      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">Branded artboard</div>
                      <button type="button" onClick={() => setEnlarge({ url: cleanBase.branded!, label: "Branded artboard" })} className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-white">
                        <img src={cleanBase.branded} alt="Branded artboard" className="aspect-video w-full object-contain" />
                      </button>
                    </div>
                  )}
                </div>
                {sideBlanks.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">Blank panels · {sideBlanks.length} · logo-free · 5″ bleed — lay on vehicle templates</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {sideBlanks.map((b, i) => (
                        <div key={b.url + i}>
                          <button type="button" onClick={() => setEnlarge({ url: b.url, label: `${b.side} — blank (no logo)` })} className="block w-full overflow-hidden rounded-md border border-gray-200 bg-white hover:border-fuchsia-400">
                            <img src={b.url} alt={`${b.side} blank panel`} className="aspect-video w-full object-contain" loading="lazy" />
                          </button>
                          <div className="mt-0.5 flex items-center justify-between gap-1">
                            <span className="truncate text-[10px] font-semibold text-gray-700" title={b.side}>{b.side}{b.dims ? ` · ${b.dims}` : ""}</span>
                            <a href={`${b.url}${b.url.includes("?") ? "&" : "?"}download`} download className="shrink-0 text-[10px] font-medium text-emerald-600 hover:underline">↓</a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {logoPack.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-gray-400">Extracted logos · {logoPack.length}</div>
                    <div className="flex flex-wrap gap-2">
                      {logoPack.map((l, i) => (
                        <div key={l.url + i} className="w-24">
                          <button type="button" onClick={() => setEnlarge({ url: l.url, label: l.label })} className="block h-24 w-24 overflow-hidden rounded-md border border-gray-200 bg-white hover:border-fuchsia-400">
                            <img src={l.url} alt={l.label} className="h-full w-full object-contain" loading="lazy" />
                          </button>
                          <a href={`${l.url}${l.url.includes("?") ? "&" : "?"}download`} download className="mt-1 block truncate text-center text-[10px] font-medium text-fuchsia-600 hover:underline" title={l.label}>{l.label}</a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Per-side compare grid */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {VIEW_DEFS.map((def) => {
                const side = qcPanels[def.sideKey] || {};
                // A per-side uploaded render (proof_url) supersedes the job's render.
                // proof_hidden = the job render was deleted (red X) with nothing uploaded yet.
                const proofOverride: string = side.proof_url || "";
                const proofHidden: boolean = !!side.proof_hidden;
                const systemUrl = proofOverride || (proofHidden ? "" : viewUrlFor(viewMap, def));
                const isUploadingProof = uploadingProofSide === def.sideKey;
                const geminiUrl: string = side.gemini_url || "";
                // Versions list (migrate a legacy single file into one version).
                const versions: any[] = Array.isArray(side.versions) && side.versions.length
                  ? side.versions
                  : (geminiUrl ? [{ id: "legacy", url: geminiUrl, source: side.gemini_source || "upload" }] : []);
                const approved = !!side.approved;
                const isUploading = uploadingSide === def.sideKey;
                const isSaving = savingSide === def.sideKey;
                // Validator verdict for the ACTIVE version (the agent's decision).
                const activeVersion = versions.find((v: any) => v.url === geminiUrl);
                const hasVerdict = activeVersion && typeof activeVersion.score === "number";
                // Resolved print dimensions + their source tag (see persistSide /
                // panel-pro-extract resolvePanelSize). database/csv = verified;
                // anything else (web lookup, trailer, fallback) needs a tape check.
                const pw = Number(side.print_width_in) || 0;
                const ph = Number(side.print_height_in) || 0;
                const hasDims = pw > 0 && ph > 0;
                const dimSource: string = side.print_size_source || "";
                const dimsVerified = /database|csv/i.test(dimSource);
                const dimSourceLabel = /database/i.test(dimSource) ? "Database"
                  : /csv/i.test(dimSource) ? "CSV"
                  : /google|search/i.test(dimSource) ? "Web lookup"
                  : /trailer/i.test(dimSource) ? "Trailer"
                  : /standard|default/i.test(dimSource) ? "Fallback"
                  : (dimSource || "Fallback");
                return (
                  <div
                    key={def.sideKey}
                    className={`rounded-xl p-4 transition ${approved ? "ring-2 ring-emerald-400" : ""}`}
                    style={{ background: "linear-gradient(#fff,#fff) padding-box, linear-gradient(90deg,#3b82f6,#ec4899) border-box", border: "2px solid transparent" }}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-bold">{def.label}</h3>
                      <div className="flex flex-wrap items-center justify-end gap-1.5">
                        {hasDims && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${dimsVerified ? "bg-emerald-50 text-emerald-700" : "bg-amber-100 text-amber-800 ring-1 ring-amber-400"}`}
                            title={dimsVerified
                              ? `Verified dimensions from ${dimSourceLabel}: ${Math.round(ph)}″ high × ${Math.round(pw)}″ wide. Safe to print.`
                              : `⚠️ UNVERIFIED dimensions (source: ${dimSourceLabel}): ${Math.round(ph)}″ high × ${Math.round(pw)}″ wide. Tape-measure the vehicle before production.`}
                          >
                            {dimsVerified ? <ShieldCheck className="h-3 w-3" /> : <span className="leading-none">⚠️</span>}
                            {Math.round(ph)}″×{Math.round(pw)}″
                            <span className="font-normal opacity-75">· {dimSourceLabel}</span>
                          </span>
                        )}
                        {hasVerdict && (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${activeVersion.match ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
                            title={activeVersion.match
                              ? `Validator: 1:1 match (${activeVersion.score})`
                              : `Validator: needs review (${activeVersion.score})${Array.isArray(activeVersion.issues) && activeVersion.issues.length ? " — " + activeVersion.issues.join("; ") : ""}`}
                          >
                            {activeVersion.match ? <ShieldCheck className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                            {activeVersion.match ? `Match ${activeVersion.score}` : `Review ${activeVersion.score}`}
                          </span>
                        )}
                        {approved
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700"><Check className="h-3 w-3" /> Approved</span>
                          : <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">Pending</span>}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      {/* Real proof / system view — with a red X to delete a wrong
                          3D proof, then Upload the correct one in its place. */}
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-gray-400">
                          <span>Real design proof{proofOverride ? " · uploaded" : ""}</span>
                          {(proofHidden && !proofOverride) && (
                            <button
                              type="button"
                              disabled={isUploadingProof}
                              onClick={() => restoreProof(def)}
                              className="text-[10px] font-medium normal-case text-gray-500 underline hover:text-gray-700 touch-manipulation disabled:opacity-50"
                              title="Undo delete — show the job's render again"
                            >
                              Undo
                            </button>
                          )}
                        </div>
                        <input
                          ref={(el) => (proofInputs.current[def.sideKey] = el)}
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleProofUpload(def, f); }}
                        />
                        {systemUrl ? (
                          <div className="relative">
                            <button type="button" onClick={() => setEnlarge({ url: systemUrl, label: `${def.label} — 3D design proof` })} className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                              <img src={systemUrl} alt={`${def.label} system view`} className="aspect-video w-full object-contain" />
                            </button>
                            {/* Red X — delete this 3D proof (then Upload the correct one). */}
                            <button
                              type="button"
                              disabled={isUploadingProof}
                              onClick={(e) => { e.stopPropagation(); deleteProof(def); }}
                              className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-600 active:bg-red-700 touch-manipulation disabled:opacity-50"
                              title="Delete this 3D proof"
                              aria-label={`Delete ${def.label} 3D proof`}
                            >
                              {isUploadingProof ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={isUploadingProof}
                            onClick={() => proofInputs.current[def.sideKey]?.click()}
                            className="flex aspect-video w-full flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 bg-gray-50 text-xs font-medium text-gray-500 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-600 touch-manipulation disabled:opacity-50"
                            title="Upload the correct 3D render for this side"
                          >
                            {isUploadingProof
                              ? <Loader2 className="h-4 w-4 animate-spin" />
                              : <><Upload className="h-4 w-4" /> Upload correct 3D proof</>}
                          </button>
                        )}
                      </div>

                      {/* Active per-side print panel (deterministic slice / uploaded) */}
                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-gray-400">
                          <span>Print Panel</span>
                          {versions.length > 1 && <span className="text-gray-400">{versions.length} versions</span>}
                        </div>
                        {geminiUrl ? (
                          <button type="button" onClick={() => setEnlarge({ url: geminiUrl, label: `${def.label} — print panel${hasDims ? ` · ${Math.round(pw)}″ × ${Math.round(ph)}″` : ""}` })} className="block w-full overflow-hidden rounded-lg border border-gray-200 bg-gray-50">
                            <img src={geminiUrl} alt={`${def.label} panel`} className="aspect-video w-full object-contain" />
                          </button>
                        ) : (
                          <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-xs text-gray-400">
                            {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Not uploaded"}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Version strip — every upload / Panel Pro / edit / flip is kept.
                        Click a thumbnail to make it active; X deletes just that one. */}
                    {versions.length > 0 && (
                      <div className="mt-3">
                      <div className="flex flex-wrap gap-2">
                        {versions.map((v: any) => {
                          const isActive = v.url === geminiUrl;
                          const srcLabel = v.source === "panel-pro" ? "PanelPro" : v.source === "flip" ? "Flip" : v.source === "edit" ? "Edit" : v.source === "upscale" ? "Upscaled" : v.source === "background" ? "Background" : v.source === "overlay" ? "Overlay PNG" : "Upload";
                          return (
                            <div
                              key={v.id}
                              className={`relative w-20 shrink-0 overflow-hidden rounded-md border ${isActive ? "border-fuchsia-500 ring-1 ring-fuchsia-300" : "border-gray-200"}`}
                              title={`${srcLabel}${typeof v.score === "number" ? ` · match ${v.score}` : ""} — click to use`}
                            >
                              <button type="button" onClick={() => setActiveVersion(def, v.url)} className="block w-full">
                                {/* object-contain — print panels are ultra-wide;
                                    object-cover cut their ends off in the strip. */}
                                <img
                                  src={v.url}
                                  alt={srcLabel}
                                  className="aspect-video w-full object-contain bg-gray-50"
                                  style={v.source === "overlay" ? {
                                    backgroundImage: "linear-gradient(45deg,#ddd 25%,transparent 25%),linear-gradient(-45deg,#ddd 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ddd 75%),linear-gradient(-45deg,transparent 75%,#ddd 75%)",
                                    backgroundSize: "10px 10px",
                                    backgroundPosition: "0 0,0 5px,5px -5px,-5px 0",
                                  } : undefined}
                                />
                                <span className={`block truncate px-1 py-0.5 text-[9px] font-medium ${isActive ? "bg-fuchsia-500 text-white" : "bg-gray-100 text-gray-600"}`}>
                                  {srcLabel}{typeof v.score === "number" ? ` ${v.score}` : ""}{isActive ? " ✓" : ""}
                                </span>
                              </button>
                              {v.id !== "legacy" && (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); removeVersion(def, v.id); }}
                                  className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-600 active:bg-red-700 touch-manipulation"
                                  title="Delete this version"
                                  aria-label={`Delete ${srcLabel} version`}
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <input
                        ref={(el) => (fileInputs.current[def.sideKey] = el)}
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(def, f); }}
                      />

                      {/* Extract the flat panel straight from this side's 3D render. */}
                      {systemUrl && (
                        <Button
                          size="sm"
                          className="gap-1.5 bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white hover:brightness-110"
                          disabled={extractingSide === def.sideKey || runningPanelPro}
                          onClick={() => extractSide(def)}
                          title="Extract this side's flat print panel from its 3D render"
                        >
                          {extractingSide === def.sideKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                          Pull panel
                        </Button>
                      )}

                      <Button
                        variant="outline" size="sm" className="gap-1.5"
                        disabled={isUploading}
                        onClick={() => fileInputs.current[def.sideKey]?.click()}
                      >
                        {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                        {geminiUrl ? "Add version" : "Upload panel"}
                      </Button>

                      {systemUrl && geminiUrl && (
                        <Button
                          variant="outline" size="sm" className="gap-1.5"
                          onClick={() => setCompare({ real: systemUrl, gemini: geminiUrl, label: def.label })}
                          title="Slide the A.C.E. panel over the real proof"
                        >
                          <SplitSquareHorizontal className="h-4 w-4" /> Compare
                        </Button>
                      )}

                      {geminiUrl && (
                        <Button
                          variant="outline" size="sm" className="gap-1.5"
                          onClick={() => setEditTarget({ url: geminiUrl, label: def.label, sideKey: def.sideKey, referenceUrl: systemUrl || undefined, ...printDimsForSide(def.sideKey) })}
                          title="Minor edits — color, depth, AI, paint"
                        >
                          <Pencil className="h-4 w-4" /> Edit
                        </Button>
                      )}

                      {geminiUrl && (
                        <Button
                          variant="outline" size="sm" className="gap-1.5"
                          disabled={flippingSide === def.sideKey}
                          onClick={() => flipSide(def.sideKey)}
                          title="Mirror horizontally (reuse a driver design on the passenger side)"
                        >
                          {flippingSide === def.sideKey ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlipHorizontal2 className="h-4 w-4" />} Flip
                        </Button>
                      )}

                      {/* "Extract layers → Assets" REMOVED (Trish 2026-07-24 board
                          audit): it ran the GENERATIVE panel-pro-separate (which
                          AI-invents a different design) and OVERWROTE the vault's
                          design_generation_assets.background_url — corrupting
                          Layer 0 and failing golden-job-regression checks 4/5.
                          Real-pixel separation lives in the Logo Pack flow. */}

                      {approved ? (
                        <Button
                          variant="outline" size="sm"
                          className="gap-1.5 text-gray-600"
                          disabled={isSaving}
                          onClick={() => persistSide(def, { approved: false })}
                        >
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />} Unapprove
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700"
                          disabled={isSaving || !geminiUrl}
                          title={!geminiUrl ? "Extract or upload the panel first" : "Approve this side"}
                          onClick={() => persistSide(def, { approved: true })}
                        >
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve side
                        </Button>
                      )}

                      {/* Print-file downloads: when the active version carries a
                          worker-produced print file (1500-DPI CMYK TIFF + full PNG),
                          link DIRECTLY to the storage URL with ?download=<labeled name>
                          (the bare download attribute is ignored cross-origin, which
                          left files opening in a tab / saving under hash names).
                          Anchor (not fetch→blob) so the huge files download reliably
                          instead of choking a tab. */}
                      {geminiUrl && activeVersion?.printTiffUrl && (
                        <a
                          href={withDownloadName(activeVersion.printTiffUrl, `${fileSlug((job as any)?.order_number || job?.id || "job")}_${fileSlug(def.label)}${hasDims ? `_${Math.round(pw)}x${Math.round(ph)}in` : ""}_1500dpi_CMYK.tiff`)}
                          download
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                          title="Download the print-ready 1500-DPI CMYK TIFF (hi-res)"
                        >
                          <Download className="h-4 w-4" /> TIFF
                        </a>
                      )}
                      {geminiUrl && activeVersion?.printPngUrl && (
                        <a
                          href={withDownloadName(activeVersion.printPngUrl, `${fileSlug((job as any)?.order_number || job?.id || "job")}_${fileSlug(def.label)}${hasDims ? `_${Math.round(pw)}x${Math.round(ph)}in` : ""}_1500dpi.png`)}
                          download
                          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 text-sm font-medium text-emerald-700 hover:bg-emerald-50"
                          title="Download the full print-resolution PNG (hi-res)"
                        >
                          <Download className="h-4 w-4" /> PNG
                        </a>
                      )}
                      {geminiUrl && (
                        <Button
                          variant="outline" size="sm" className="gap-1.5"
                          onClick={() => downloadPanel(def, geminiUrl)}
                          title="Download this panel file as shown"
                        >
                          <Download className="h-4 w-4" /> {activeVersion?.printTiffUrl ? "Preview" : "Download"}
                        </Button>
                      )}

                      {geminiUrl && (
                        <Button
                          variant="outline" size="sm"
                          className="gap-1.5 text-red-600 hover:bg-red-50 hover:text-red-700"
                          disabled={isSaving}
                          onClick={() => { if (window.confirm(`Delete the ${def.label} panel? This removes the active version.`)) removeGemini(def.sideKey); }}
                          title="Delete this panel (removes the active version)"
                        >
                          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            </>}

            {/* Footer action */}
            <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
              <div className="text-sm text-gray-600">
                {approvedCount === total
                  ? <span className="inline-flex items-center gap-1.5 font-medium text-emerald-700"><Check className="h-4 w-4" /> All sides approved — ready for production checks.</span>
                  : `Approve all ${total} sides to fully light the GENIE Universal Panelizer.`}
              </div>
              <Button onClick={goToProductionFlow} className="gap-1.5 bg-blue-600 hover:bg-blue-700">
                <Truck className="h-4 w-4" /> Continue to ProductionFlow
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Minor-edits editor (color/depth · AI · paint) */}
      {job && (
        <StudioBoardEditor
          open={!!editTarget}
          target={editTarget}
          jobId={job.id}
          onClose={() => setEditTarget(null)}
          onSaved={(sideKey, newUrl) => {
            const def = VIEW_DEFS.find((d) => d.sideKey === sideKey);
            if (def) persistSide(def, { addVersion: { url: newUrl, source: "edit" } });
          }}
        />
      )}

      {/* Before/after compare slider */}
      {compare && (
        <CompareSlider
          real={compare.real}
          gemini={compare.gemini}
          label={compare.label}
          labelTop={compare.labelTop}
          labelBottom={compare.labelBottom}
          onClose={() => setCompare(null)}
        />
      )}

      {/* Lightbox — labeled, zoomable (fit ↔ 100%, scroll to pan), downloadable.
          Fit-to-screen shrinks a 227″-wide panel to an uninspectable strip; the
          100% mode is what lets you actually view the print file clean. */}
      {enlarge && (
        <div
          className="fixed inset-0 z-50 bg-black/85"
          onClick={() => { setEnlarge(null); setEnlargeZoom(false); }}
        >
          {enlarge.label && (
            <span className="absolute left-4 top-4 z-10 max-w-[60vw] truncate rounded-md bg-black/70 px-3 py-1.5 text-sm font-semibold text-white">
              {enlarge.label}
            </span>
          )}
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <button
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
              onClick={() => setEnlargeZoom((z) => !z)}
              title={enlargeZoom ? "Fit to screen" : "View at 100% — scroll to pan"}
            >
              {enlargeZoom ? <ZoomOut className="h-4 w-4" /> : <ZoomIn className="h-4 w-4" />}
              {enlargeZoom ? "Fit" : "100%"}
            </button>
            <a
              href={withDownloadName(enlarge.url, `${fileSlug(enlarge.label || "panel")}.png`)}
              download
              className="flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-2 text-sm font-medium text-white hover:bg-white/20"
              title="Download this file"
            >
              <Download className="h-4 w-4" /> Download
            </a>
            <button className="rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => { setEnlarge(null); setEnlargeZoom(false); }}>
              <X className="h-5 w-5" />
            </button>
          </div>
          {enlargeZoom ? (
            <div className="h-full w-full overflow-auto p-6 pt-16" onClick={(e) => e.stopPropagation()}>
              <img
                src={enlarge.url}
                alt={enlarge.label || "enlarged"}
                className="max-w-none cursor-zoom-out"
                onClick={() => setEnlargeZoom(false)}
              />
            </div>
          ) : (
            <div className="flex h-full w-full items-center justify-center p-6 pt-16">
              <img
                src={enlarge.url}
                alt={enlarge.label || "enlarged"}
                className="max-h-full max-w-full cursor-zoom-in object-contain"
                onClick={(e) => { e.stopPropagation(); setEnlargeZoom(true); }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
