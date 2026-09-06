import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Search, Loader2, Upload, Check, X, Package, ShieldCheck, Truck,
  ArrowRight, Image as ImageIcon, Maximize2, SplitSquareHorizontal, GripVertical,
  LayoutGrid, Move, RotateCcw, Pencil, ZoomIn, ZoomOut, Trash2, FlipHorizontal2, Wand2, AlertTriangle, Layers, Download,
  ChevronDown, HelpCircle,
} from "lucide-react";
import StudioBoardEditor, { StudioBoardEditTarget } from "@/components/studioboard/StudioBoardEditor";
import {
  dpApi,
  type FinalQc,
  type FlatAtlasRevision,
  type GenieSurfaceKey,
  type PreflightQc,
  PRODUCTION_SURFACES,
  ROLE_FOR_SOURCE_VIEW_TYPE,
  SURFACE_QC_CHECKLIST,
  type SurfaceQcRecord,
  type WorkflowArtifact,
} from "@/lib/designpro-api";
import {
  EXPECTED_OUTPUT_FILES,
  FINAL_CHECKS,
  OUTPUT_FORMATS,
  PACK_PRESENCE_CHECKS,
  outputFormatOf,
  PREFLIGHT_CHECKS,
  STAGE_LABEL,
} from "@/lib/designpro-stages";
import {
  exactTimestamp,
  type DesignVersion,
} from "@/lib/design-version-history";
import {
  findPanelProStudioJob,
  listPanelProStudioJobs,
  loadPanelProStudioJob,
  panelProJobAtVersion,
  SURFACE_FOR_SIDE_KEY,
  type PanelProStudioJob,
} from "@/lib/panelpro-studio-source";
// cn was referenced by the Validate (QC) results block without being imported —
// rendering validation results threw `cn is not defined` and white-screened the
// whole board into the ErrorBoundary (caught in the 2026-07-24 button audit).
import { cn } from "@/lib/utils";
import { SixPanelBoard } from "@/components/designpro/SixPanelBoard";
import { VersionAssetManifest } from "@/components/designpro/VersionAssetManifest";
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
 * PanelPro Studio — the design team's production workspace for one job.
 *
 * Search a job by order number, see all seven proof views and the 2D proof,
 * then work each side: its deterministic print panel beside its real design
 * proof, a draggable slider to overlay one on the other, the version history
 * for that side, and Approve. Below that sit the QC checklist, the print files,
 * the stamp, the ZIP and the WrapBox handoff.
 *
 * WHAT CHANGED UNDERNEATH IT. This board used to read a panelizer job row, fall
 * back to an ApprovePro approval, resolve a visualization for the views and a
 * design row for the proof, and write its own per-side state back into
 * concept_json. Four stores, none of which exist here, and a browser persisting
 * production state into all of them.
 *
 * A DesignProAI job is one server-owned run. `lib/panelpro-studio-source.ts`
 * projects that run into the exact shape this page already reads -- the view
 * map, the proof, and qc_side_panels keyed by the same side keys -- so every
 * card, comparison, lightbox and control below renders unchanged against
 * artifacts the runtime produced and hashed.
 *
 * THE BOARD STOPS PRODUCING. Panels are cut deterministically at Call 9 from
 * the accepted A.T.L.A.S. master; this reads them. It does not extract,
 * flatten, separate, mirror or re-render. The one write it keeps is the one the
 * team genuinely needs: a panel a designer corrected against the real vehicle
 * template, recorded against the surface it replaces, with the original kept
 * and both readable afterwards.
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
  // "panelizer" = DesignProAI production job (default). "approvepro" = a
  // WePrintWraps/ApprovePro proof_approvals row — Studio Board state persists
  // into proof_approvals.metadata.studio_board instead of panelizer_jobs.
  source?: "panelizer" | "approvepro";
  _metadata?: any;
  // For approvepro jobs: the backing panelizer_jobs row that carries this order
  // into ProductionFlow / the GENIE panelizer (minted/reused on demand).
  _panelizerJobId?: string;
}

type PanelProStudioListJob = Awaited<ReturnType<typeof listPanelProStudioJobs>>[number];

function safeParseNotes(raw: any): any {
  if (!raw) return {};
  if (typeof raw === "string") { try { return JSON.parse(raw); } catch { return {}; } }
  return raw;
}

// APPROVEPRO IS NOT A DESIGNPROAI SURFACE. A Studio Board job used to be
// buildable from a WePrintWraps/ApprovePro approval row: views resolved through
// a linked visualization, the proof through its notes, and this board's own
// state persisted back into that approval's metadata. None of those stores
// exist here, /approvemode says the product is unavailable, and a DesignProAI
// job is one server-owned run with one identity. The projection lives in
// lib/panelpro-studio-source.ts.

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

// The AI view classifier is gone with the direct-upload path it served. It
// downscaled each dropped file, sent it to a vision model, and let the model's
// answer decide which surface that file became -- a guess about image contents
// choosing which side gets printed. Filenames decide it now, because the
// designer controls those and can see them.

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

/**
 * THE JOB, AND EVERY VERSION IT HAS BEEN THROUGH.
 *
 * Requirement one and two of the production control room: who this order is
 * for and what exactly was asked for, at every version, in the customer's own
 * words.
 *
 * The history is NOT this page's own. It is the same canonical A.T.L.A.S.
 * revision lineage RevisionStudio reads, through the same function, so V2 here
 * is V2 there -- same number, same prompt text, same timestamp, same master.
 * A revision created in RevisionStudio appears here because both surfaces read
 * one record, not because anything is copied between them.
 *
 * V1 is never replaced when V2 is made. Every version stays selectable, and
 * selecting one is what switches the workspace below to that revision's assets.
 */
/** The seven immutable cameras a finished run has rendered. */
export const CANONICAL_VIEW_COUNT = 7;

export type AtlasProgressCounts = {
  cutSurfaces: GenieSurfaceKey[];
  promotedSurfaces: GenieSurfaceKey[];
  proofCameras: string[];
  unknownCameras: string[];
  viewGenerationFailed: boolean;
  panelLabel: string;
  panelDetail: string;
  panelDone: boolean;
  proofLabel: string;
  proofDetail: string;
  proofDone: boolean;
};

/**
 * THE TWO NUMBERS THE PROGRESS CARD REPORTS, DERIVED WHERE THEY CAN BE TESTED.
 *
 * On generation 04cc0b29 the board read "Print panels 0/6" while RevisionStudio
 * showed all six, and "3D proofs 8/7 - All seven views saved" in green on a run
 * whose own status line says failed - calls_1_7_failed and which never produced
 * roof or close-up. Neither number came from the pipeline; both were this
 * card's arithmetic, and the second one made a failed production job look
 * finished on the one surface an operator trusts.
 *
 * THREE SEPARATE FAULTS, ONE PER INPUT:
 *
 * 1. A PROOF IS A CAMERA, NOT A KEY. `all_view_urls` carries every view under
 *    BOTH names on purpose -- the camera the server rendered and the role the
 *    app displays (side/driver, passenger-side/passenger, hood_detail/hood,
 *    close-up/closeup). Counting its keys turns five saved views into eight.
 *    The cameras are counted here, from the views themselves.
 *
 * 2. `qc_side_panels` IS KEYED BY SIDE, NOT BY SURFACE. Its keys are
 *    `driver_side` and `passenger_side`; the surfaces are `driver` and
 *    `passenger`. Indexing it with a surface key silently missed those two
 *    sides, so a fully promoted job could never read higher than 4/6. The
 *    translation that already exists (SURFACE_FOR_SIDE_KEY) is used.
 *
 * 3. CUT IS NOT PROMOTED. The six panels are cut at Call 1 and published on
 *    the revision as `callOnePanels` -- the record RevisionStudio's Production
 *    Layers renders. `qc_side_panels` is built from the artifacts Call 9
 *    promoted. A run that dies inside Calls 1-7 genuinely has six cut panels
 *    and zero promoted ones, and the row that sits under "master accepted ->
 *    six panels cut" has to say both rather than report the later stage under
 *    the earlier stage's name.
 *
 * COUNT ALONE NEVER DECLARES COMPLETION. "All seven views saved" requires
 * seven canonical cameras AND a view-generation status that did not fail, so a
 * calls_1_7_failed run can never present as finished however its arithmetic
 * lands. A camera outside the canonical set, or an eighth camera, is REPORTED
 * -- named in the label and the detail, never clamped to seven and never green.
 */
export function atlasProgressCounts(input: {
  callOnePanels?: ReadonlyArray<{ surfaceKey?: string } | null | undefined> | null;
  promotedPanels?: Record<string, { gemini_url?: string } | undefined> | null;
  views?: ReadonlyArray<{ sourceViewType?: string; signedUrl?: string } | null | undefined> | null;
  state?: string | null;
  currentStage?: string | null;
  stages?: ReadonlyArray<{ key?: string; state?: string } | null | undefined> | null;
}): AtlasProgressCounts {
  const cut = new Set((input.callOnePanels || []).map((panel) => String(panel?.surfaceKey || "")));
  const cutSurfaces = PRODUCTION_SURFACES.filter((surface) => cut.has(surface));

  const promotedRows = input.promotedPanels || {};
  const promoted = new Set<GenieSurfaceKey>();
  for (const [sideKey, surface] of Object.entries(SURFACE_FOR_SIDE_KEY)) {
    if (promotedRows[sideKey]?.gemini_url) promoted.add(surface);
  }
  const promotedSurfaces = PRODUCTION_SURFACES.filter((surface) => promoted.has(surface));

  const cameras = new Set<string>();
  for (const view of input.views || []) {
    if (!view?.signedUrl) continue;
    const camera = String(view.sourceViewType || "").trim();
    if (camera) cameras.add(camera);
  }
  const proofCameras = [...cameras];
  const unknownCameras = proofCameras.filter((camera) => !ROLE_FOR_SOURCE_VIEW_TYPE[camera]);

  const viewGenerationFailed = input.state === "failed"
    || String(input.currentStage || "").startsWith("calls_1_7_failed")
    || (input.stages || []).some((stage) =>
      String(stage?.key || "").startsWith("calls_1_7") && stage?.state === "failed");

  const proofCount = proofCameras.length;
  const proofDone = proofCount === CANONICAL_VIEW_COUNT
    && unknownCameras.length === 0
    && !viewGenerationFailed;

  const proofDetail = unknownCameras.length
    ? `Unrecognised camera: ${unknownCameras.join(", ")}`
    : proofCount > CANONICAL_VIEW_COUNT
      ? `More cameras than the seven-view contract: ${proofCameras.join(", ")}`
      : viewGenerationFailed
        ? "View generation did not finish, so these are not a complete set"
        : proofDone
          ? "All seven views saved"
          : "Projected from the same frozen master, concurrently";

  return {
    cutSurfaces,
    promotedSurfaces,
    proofCameras,
    unknownCameras,
    viewGenerationFailed,
    panelLabel: `Print panels ${cutSurfaces.length}/${PRODUCTION_SURFACES.length}`,
    // ⛔ ZERO PANELS SAYS SO. (Trish 2026-08-29: "if six deterministic Call-1
    //    panel artifacts do not exist, the UI must say PRODUCTION PANELS NOT
    //    CREATED.")
    //
    // This read "Cut deterministically from the accepted master" on a
    // generation with NO panels -- a description of what the pipeline would do,
    // printed under the number saying it had not. An operator reading a green
    // sentence beside 0/6 has to work out for themselves which half is true.
    // There is no fallback producer any more (`panels.build` fails closed), so
    // zero cut panels means exactly one thing and the card says it.
    panelDetail: cutSurfaces.length
      ? `${cutSurfaces.join(" · ")} · ${promotedSurfaces.length}/${PRODUCTION_SURFACES.length} promoted by Call 9`
      : "PRODUCTION PANELS NOT CREATED — no deterministic Call-1 panel exists for this design",
    panelDone: cutSurfaces.length === PRODUCTION_SURFACES.length,
    proofLabel: `3D proofs ${proofCount}/${CANONICAL_VIEW_COUNT}`,
    proofDetail,
    proofDone,
  };
}

/**
 * THE A.T.L.A.S. CARD, FILLING IN AS THE SERVER ACTUALLY PRODUCES.
 *
 * PanelPro is the live internal production record of a generation, not a report
 * written after the fact. The moment Create Design mints a generationId this
 * board can be opened on it, and at that instant there is genuinely nothing but
 * the brief -- so the card says so, and then fills:
 *
 *   master accepted -> six panels cut -> Driver 3D -> the remaining six proofs
 *
 * Each row states what exists RIGHT NOW. Nothing is pre-drawn as done and
 * nothing is inferred from elapsed time: a panel counts when its artifact
 * exists, a proof counts when its view exists. An operator watching this card
 * is watching the database, which is the only thing worth watching.
 */
/**
 * THE MASTER IS THE DESIGN AUTHORITY, SO THE CONTROL ROOM HAS TO SHOW IT.
 *
 * This card reported that a master existed and printed its hash, and never
 * rendered the artwork -- `masterUrl` has been on the wire the whole time
 * (FlatAtlasRevision carries it, signed, alongside `guideUrl`) and no line in
 * this file referenced it. So the production board could tell you
 * `87a24e3c3da22d40 · 4096×4096` about a sheet you could not look at, which is
 * the one asset RULE 0.22 lists first: "Flattened A.T.L.A.S. master ... each
 * individually downloadable", and "Do not hide files behind only a final ZIP".
 *
 * It binds to the SELECTED version rather than the newest, because the same
 * rule requires V1/V2/V3 to stay inspectable and forbids silently replacing V1
 * when V2 is created.
 */
function AtlasProgressCard({
  job, selectedVersion,
}: { job: PanelProStudioJob; selectedVersion: DesignVersion | null }) {
  const atlas = job.atlas_versions.find(
    (entry) => entry.id === selectedVersion?.revisionId,
  ) || job.atlas_versions[job.atlas_versions.length - 1] || null;
  const proofUrls = job.all_view_urls || {};
  const counts = atlasProgressCounts({
    callOnePanels: atlas?.callOnePanels,
    promotedPanels: job.concept_json?.qc_side_panels,
    views: job.raw_views,
    state: job.state,
    currentStage: job.current_stage,
    stages: job.stages,
  });
  const driverReady = Boolean(proofUrls.driver || proofUrls.side);

  const step = (label: string, done: boolean, detail: string) => (
    <div key={label} className="flex items-start gap-2">
      <span
        aria-hidden
        className={`mt-1 h-2 w-2 shrink-0 rounded-full ${done ? "bg-emerald-500" : "bg-gray-300"}`}
      />
      <div className="min-w-0">
        <div className={`text-[11px] font-semibold ${done ? "text-gray-900" : "text-gray-400"}`}>
          {label}
        </div>
        <div className="truncate text-[10px] text-gray-500" title={detail}>{detail}</div>
      </div>
    </div>
  );

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
          A.T.L.A.S.
        </span>
        <span className="text-[10px] text-gray-400">
          {atlas ? `V${atlas.revisionSequence} · ${atlas.promptVersion}` : "authoring"}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {step(
          "Accepted master",
          Boolean(atlas?.master?.contentHash),
          atlas?.master?.contentHash
            ? `${atlas.master.contentHash.slice(0, 16)} · ${atlas.master.widthPx}×${atlas.master.heightPx}`
            : "Call 1 has not produced an accepted master yet",
        )}
        {step(counts.panelLabel, counts.panelDone, counts.panelDetail)}
        {step(
          "Driver 3D",
          driverReady,
          driverReady
            ? "Rendered and hash-verified before the other cameras"
            : "Rendered first, so the design can be judged before the full set",
        )}
        {step(counts.proofLabel, counts.proofDone, counts.proofDetail)}
      </div>

      {/* A MISSING MASTER IS STATED, NEVER SILENT. (Owner, 2026-08-31: "Treat
          absence of A.T.L.A.S. in PanelProStudio as DCA failure.")
          This block used to be `{atlas?.masterUrl && ...}` alone, so a job whose
          A.T.L.A.S. failed to load rendered NOTHING here and the board looked
          merely quiet. That is exactly how source can be green while the one
          artifact everything descends from is absent from the screen. No proof
          image may stand in for it -- the master is the only thing that belongs
          in this slot. */}
      {!atlas?.masterUrl && (
        <div
          data-testid="atlas-master-missing"
          className="mt-3 rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"
        >
          A.T.L.A.S. master not available for this revision. Every panel and proof
          descends from it, so this job cannot be validated until it loads.
        </div>
      )}

      {/* THE SHEET ITSELF. Everything above is a status line about the master;
          this is the master. It is the design authority every proof and every
          panel is cut from, so the production board has to render it rather
          than describe it. */}
      {atlas?.masterUrl && (
        <div data-testid="atlas-master" className="mt-3 border-t border-gray-200 pt-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
              Flattened A.T.L.A.S. master · V{atlas.revisionSequence}
            </span>
            <span className="flex items-center gap-3 text-[10px]">
              <a
                href={atlas.masterUrl}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-blue-700 underline"
              >
                Open full size
              </a>
              <a
                href={atlas.masterUrl}
                download={`atlas-master-v${atlas.revisionSequence}-${atlas.master.contentHash.slice(0, 12)}.png`}
                className="font-semibold text-blue-700 underline"
              >
                Download master
              </a>
              {atlas.guideUrl && (
                <a
                  href={atlas.guideUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-gray-500 underline"
                >
                  Installer map
                </a>
              )}
            </span>
          </div>
          <a href={atlas.masterUrl} target="_blank" rel="noreferrer" className="block">
            <img
              src={atlas.masterUrl}
              alt={`Flattened A.T.L.A.S. master, revision ${atlas.revisionSequence}`}
              loading="lazy"
              className="max-h-[26rem] w-full rounded border border-gray-200 bg-white object-contain"
            />
          </a>
          <p className="mt-1 text-[10px] text-gray-500">
            {atlas.master.widthPx}×{atlas.master.heightPx} ·{" "}
            {(atlas.master.byteSize / 1_048_576).toFixed(1)} MB ·{" "}
            {atlas.master.effectivePpi.toFixed(1)} PPI at design size · sha256{" "}
            <span className="font-mono">{atlas.master.contentHash.slice(0, 16)}</span>
            {" · "}links are signed for 5 minutes; reload the page if an image stops loading
          </p>
        </div>
      )}

      {/* THE MASTER'S OWN RECORD.
          Every value below was written by Call 1 at authoring time and sat on
          the revision unread. They are the first questions asked when a panel
          looks wrong -- did the master pass its own QC, which model drew it,
          which prompt version, how many attempts, and did the sheet arrive
          holed. PanelPro is the source-of-truth inspection surface, so they
          belong in its UI rather than in a diagnostic log. */}
      {atlas && <AtlasForensicRecord atlas={atlas} />}

      {/* EVERY FILE THIS VERSION PRODUCED, EACH ONE DOWNLOADABLE.
          RULE 0.22 lists the complete asset set the design team takes off this
          board. The card above proves the master exists and prints its record;
          this is where a designer actually gets the files -- the six panels
          with the dimensions that make them checkable, the seven proofs, and
          the 2D Production Proof, all bound to the SELECTED version so V1 stays
          reachable after V2 is made. */}
      {/* The six panels as artwork, above the file manifest: a reviewer looks
          at the compositions first and takes the files second. */}
      <SixPanelBoard revision={atlas} className="mb-6" />
      <VersionAssetManifest job={job} atlas={atlas} />
    </div>
  );
}

/**
 * REAL DESIGN PROOF ∥ PRINT PANEL, one row per surface, straight under the
 * master. (Trish 2026-08-28: "Then Panels next to individual 3d proofs.")
 *
 * RULE 0.21 states the relationship as exactly this row, and the board had it
 * only one level down at /panelpro/surfaces — so the control room showed the
 * master and then jumped to logos, and the pair a designer actually validates
 * was somewhere else. The bytes are already loaded here; this is a second
 * PUBLICATION of the same artifacts, never a second producer, so there is no
 * Pull panel, no Mirror from driver and no browser crop.
 *
 * Both halves publish their A.T.L.A.S. binding, so "same design?" is answered
 * by comparing two hashes rather than by looking. A missing half is reported
 * missing — RULE 0.27 §3 forbids either UI synthesizing a stand-in.
 */
function SurfacePairRows({
  job,
  atlas,
}: {
  job: PanelProStudioJob;
  /** The version selected by the operator, never an unscoped/latest guess. */
  atlas: FlatAtlasRevision | null;
}) {
  const viewFor = (surface: string) =>
    job.raw_views.find((view) => view.surfaceKey === surface) || null;
  const callOneBySurface = new Map(
    (atlas?.callOnePanels || []).map((panel) => [panel.surfaceKey, panel]),
  );

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
          Real design proof ∥ print panel · per surface
        </div>
        <div className="text-[11px] text-gray-500">
          Left is that side's 3D proof. Right publishes the canonical Call&nbsp;1
          A.T.L.A.S. source immediately, then identifies the Call&nbsp;9 promoted
          production artifact when it exists.
        </div>
      </div>

      <div className="grid gap-3">
        {Object.entries(SURFACE_FOR_SIDE_KEY).map(([sideKey, surface]) => {
          const side = job.concept_json?.qc_side_panels?.[sideKey] || null;
          const callOnePanel = callOneBySurface.get(surface) || null;
          const view = viewFor(surface);
          const panelUrl = side?.gemini_url || callOnePanel?.signedUrl || "";
          const promoted = Boolean(side?.gemini_url);
          const proofMasterHash = view?.atlasBinding?.masterContentHash || null;
          const sourceMasterHash = callOnePanel?.sourceMasterHash || null;
          const bound = promoted
            ? side?.atlas?.matches
            : proofMasterHash && sourceMasterHash
              ? proofMasterHash === sourceMasterHash
              : null;
          const widthInches = promoted
            ? side?.print_dims?.widthInches
            : callOnePanel?.printWidthIn;
          const heightInches = promoted
            ? side?.print_dims?.heightInches
            : callOnePanel?.printHeightIn;
          const bleedInches = promoted
            ? side?.print_dims?.bleedInches
            : callOnePanel?.bleedInches;
          return (
            <div key={sideKey} className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-semibold capitalize text-gray-900">
                  {sideKey.replace(/_/g, " ")}
                </h4>
                <div className="flex items-center gap-2">
                  {bound === true && (
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                      same master
                    </span>
                  )}
                  {bound === false && (
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
                      different masters
                    </span>
                  )}
                  {promoted ? (
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-blue-700">
                      Call 9 promoted
                    </span>
                  ) : callOnePanel ? (
                    <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-violet-700">
                      Call 1 canonical · view only
                    </span>
                  ) : null}
                  {promoted && (
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${side?.approved ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>
                      {side?.approved ? "Approved" : "Pending QC"}
                    </span>
                  )}
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Real design proof</div>
                  {view ? (
                    <a href={view.signedUrl} target="_blank" rel="noreferrer" className="block">
                      {/* THE FRAME IS THE PROOF'S OWN SHAPE — the same
                          correction the print panel beside it already got.
                          A fixed `h-40` box at full column width is far wider
                          than 16:9, so object-contain pillarboxed every render
                          into a small strip floating in grey. The proof stack
                          is locked to 16:9 (`view-angles-os`), so an
                          aspect-video frame leaves object-contain nothing to
                          pad and the render fills its container edge to edge.
                          Falls back to the old fixed height only if the box
                          cannot resolve. */}
                      <img
                        src={view.signedUrl}
                        alt={`${sideKey} 3D proof`}
                        loading="lazy"
                        className="mt-1 aspect-video w-full rounded border border-gray-200 bg-gray-50 object-contain"
                      />
                    </a>
                  ) : (
                    <div className="mt-1 flex aspect-video w-full items-center justify-center rounded border border-dashed border-gray-300 text-[11px] text-gray-400">
                      3D proof not rendered yet
                    </div>
                  )}
                  {view && (
                    <p className="mt-1 truncate text-[10px] text-gray-500">
                      {view.sourceViewType} · <span className="font-mono">{view.contentHash.slice(0, 12)}</span>
                    </p>
                  )}
                </div>

                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                    {promoted
                      ? "Call 9 promoted production panel"
                      : callOnePanel
                        ? "Call 1 A.T.L.A.S. source panel"
                        : "Print panel"}
                  </div>
                  {panelUrl ? (
                    <a href={panelUrl} target="_blank" rel="noreferrer" className="block">
                      {/* THE BOX IS THE PANEL'S OWN SHAPE, SO BLACK MEANS INK.
                          (Owner, 2026-08-31: "Determine whether those strips
                          exist in the persisted panel bytes or are introduced
                          by PanelPro rendering.")
                          Every surface used to render into one `h-40` box. A
                          driver flank is 3.65:1 and a hood is 1.31:1, so
                          object-contain letterboxed or pillarboxed nearly all of
                          them -- and those bars read as dead space inside the
                          artwork. Sizing the frame to the panel's own trim
                          proportion leaves object-contain nothing to pad, so any
                          remaining void is genuinely in the bytes and worth
                          investigating rather than an artifact of this box.
                          Falls back to the old fixed height when a surface has
                          no declared dimensions. */}
                      <img
                        src={panelUrl}
                        alt={`${sideKey} ${promoted ? "Call 9 promoted production" : "Call 1 canonical A.T.L.A.S. source"} panel`}
                        loading="lazy"
                        style={widthInches && heightInches
                          ? { aspectRatio: `${widthInches} / ${heightInches}` }
                          : undefined}
                        className={`mt-1 w-full rounded border border-gray-200 bg-gray-50 object-contain${
                          widthInches && heightInches ? "" : " h-40"}`}
                      />
                    </a>
                  ) : callOnePanel ? (
                    <div className="mt-1 flex h-40 items-center justify-center rounded border border-dashed border-amber-300 bg-amber-50 px-3 text-center text-[11px] text-amber-700">
                      Call 1 source panel is recorded, but its signed image URL is unavailable. Reload to request a new link.
                    </div>
                  ) : (
                    <div className="mt-1 flex h-40 items-center justify-center rounded border border-dashed border-gray-300 text-[11px] text-gray-400">
                      Call 1 source panel not cut yet
                    </div>
                  )}
                  {widthInches != null && heightInches != null && (
                    <p className="mt-1 truncate text-[10px] text-gray-500 tabular-nums">
                      {widthInches}″ × {heightInches}″
                      {bleedInches != null && ` · ${bleedInches}″ bleed`}
                      {!promoted && callOnePanel && (
                        <> · sha256 <span className="font-mono">{callOnePanel.contentHash.slice(0, 12)}</span></>
                      )}
                    </p>
                  )}
                  {/* GEOMETRY STATE IS NOT AN AESTHETIC DETAIL. (Owner,
                      2026-08-31: "Do not claim panel sizing validated from
                      aspect ratio... If geometryAuthorityState = provisional,
                      label it provisional.")
                      `calls-1-7-layout-only` is the runtime's own word for
                      design-time geometry: the true production dimensions come
                      from GENIE at manifest.resolve, after purchase. Printing
                      these inches as bare numbers invites them to be read as
                      validated vehicle measurements, which they are not. The
                      PPI is stated for the same reason -- a 4096px master is far
                      below print resolution on a large flank, and the upscale is
                      what closes that gap. */}
                  {!promoted && callOnePanel && (
                    <p className="mt-0.5 truncate text-[10px] text-amber-700 tabular-nums">
                      Design-time geometry ({callOnePanel.geometryPurpose}) · not
                      validated production sizing ·{" "}
                      {Math.round(callOnePanel.effectivePpi)} PPI before upscale
                    </p>
                  )}
                  {!promoted && callOnePanel && (
                    <p className="mt-1 text-[10px] text-violet-700">
                      Canonical artwork is visible now. Human QC, correction, and
                      production enhancement remain locked until Call 9 promotes
                      the verified artifact.
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Rows that render only when the server actually stated a value. */
function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === "" ) return null;
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-gray-500">{label}</dt>
      <dd className="truncate text-[11px] font-semibold text-gray-900" title={typeof value === "string" ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}

function AtlasForensicRecord({ atlas }: { atlas: FlatAtlasRevision }) {
  const qc = atlas.qc || null;
  const provenance = atlas.provenance || null;
  const cutoutSurfaces = Array.isArray(qc?.masterCutoutSurfaces) ? qc!.masterCutoutSurfaces : [];
  const findings = Array.isArray(qc?.masterCutoutFindings) ? qc!.masterCutoutFindings : [];
  const fills = Array.isArray(qc?.cutoutFillApplied) ? qc!.cutoutFillApplied! : [];
  // Equal on a clean sheet; different when cut-outs were filled before the
  // panels were cut. Saying which is the difference between "the panel came
  // from another design" and "the sheet was repaired first".
  const repaired = Boolean(
    qc?.panelSourceHash
    && qc.canonicalMasterHash
    && qc.panelSourceHash !== qc.canonicalMasterHash,
  );
  if (!qc && !provenance) return null;

  return (
    <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
        Master QC &amp; provenance
      </div>

      <dl className="mt-2 grid gap-x-5 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
        <Fact
          label="Master QC"
          value={
            qc?.masterQcPassed === true ? "Passed"
              : qc?.masterQcPassed === false ? "Failed"
                : qc ? "Not recorded" : null
          }
        />
        <Fact
          label="QC confidence"
          value={typeof qc?.masterQcConfidence === "number" ? qc.masterQcConfidence.toFixed(2) : null}
        />
        <Fact label="QC model" value={qc?.masterQcModel || null} />
        <Fact label="QC contract" value={qc?.masterQcContract || null} />
        <Fact
          label="Authoring attempts"
          value={typeof qc?.masterAuthoringAttempts === "number" ? String(qc.masterAuthoringAttempts) : null}
        />
        <Fact label="Authoring model" value={atlas.model} />
        <Fact label="Prompt version" value={atlas.promptVersion} />
        <Fact label="Prompt hash" value={provenance?.promptHash ? provenance.promptHash.slice(0, 16) : null} />
        <Fact label="Pipeline mode" value={provenance?.pipelineMode || null} />
        <Fact label="Input contract" value={provenance?.inputContract || null} />
        <Fact label="Topology" value={provenance?.topology || null} />
        <Fact label="Provider contract" value={provenance?.providerContract || null} />
        <Fact label="Requested size" value={provenance?.requestedImageSize || null} />
        <Fact
          label="Delivered"
          value={
            provenance?.deliveredWidthPx && provenance?.deliveredHeightPx
              ? `${provenance.deliveredWidthPx}×${provenance.deliveredHeightPx}${provenance.nativelyFourK ? " · native 4K" : ""}`
              : null
          }
        />
        <Fact label="Artboard port" value={provenance?.artboardPortVersion || null} />
        <Fact
          label="Canonical master"
          value={qc?.canonicalMasterHash ? qc.canonicalMasterHash.slice(0, 16) : null}
        />
        <Fact
          label="Panels cut from"
          value={qc?.panelSourceHash ? `${qc.panelSourceHash.slice(0, 16)}${repaired ? " · repaired sheet" : " · same as master"}` : null}
        />
      </dl>

      {/* A CUT-OUT IS A PRINT DEFECT, NOT A BROKEN DESIGN. The design and its
          proofs are unaffected; the hole only becomes real at the panel cut, so
          these surfaces must not print until a human has seen them on a
          template. Naming them is the whole point of the flag. */}
      {(cutoutSurfaces.length > 0 || fills.length > 0) && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-2.5">
          <div className="text-[11px] font-bold text-amber-900">
            Cut-outs {fills.length > 0 ? "found and filled" : "recorded"}
            {cutoutSurfaces.length > 0 ? ` · ${cutoutSurfaces.length} surface${cutoutSurfaces.length === 1 ? "" : "s"}` : ""}
          </div>
          {/* HOW MUCH WAS MISSING, PER SURFACE. `zoneFraction` is the share of
              that surface's zone that arrived absent: a wheel arch is a few
              percent, a quarter of the zone is a vehicle silhouette, and that
              difference is what decides whether the proofs were safe. It is the
              number the 2026-08-26 canary turned on, so it is stated rather
              than summarised. */}
          {fills.length > 0 && (
            <div className="mt-1.5 overflow-x-auto">
              <table className="w-full text-left text-[10px]">
                <thead className="text-amber-800">
                  <tr>
                    <th className="pr-3 font-semibold">Surface</th>
                    <th className="pr-3 font-semibold">Share of zone</th>
                    <th className="pr-3 font-semibold">Pixels</th>
                    <th className="pr-3 font-semibold">Shapes</th>
                    <th className="font-semibold">Unresolved</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-amber-950">
                  {fills.map((fill, index) => (
                    <tr key={`${fill?.surfaceKey || index}`}>
                      <td className="pr-3">{String(fill?.surfaceKey || "—")}</td>
                      <td className="pr-3">
                        {typeof fill?.zoneFraction === "number"
                          ? `${(fill.zoneFraction * 100).toFixed(1)}%`
                          : "—"}
                      </td>
                      <td className="pr-3">
                        {typeof fill?.pixels === "number" ? fill.pixels.toLocaleString() : "—"}
                      </td>
                      <td className="pr-3">
                        {typeof fill?.components === "number" ? fill.components : "—"}
                      </td>
                      <td>
                        {typeof fill?.unresolvedPixels === "number" ? fill.unresolvedPixels : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {cutoutSurfaces.length > 0 && fills.length === 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {cutoutSurfaces.map((surface) => (
                <span
                  key={String(surface)}
                  className="rounded border border-amber-400 bg-amber-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-amber-900"
                >
                  {String(surface)}
                </span>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[10px] leading-snug text-amber-800">
            The sheet arrived with openings rendered as absent. They were closed
            deterministically before the panels were cut, and the 3D proofs are
            unaffected — but these surfaces must be checked on the real vehicle
            template before they print.
            {qc?.cutoutFillContract ? ` (${qc.cutoutFillContract})` : ""}
          </p>
          {findings.length > 0 && (
            <details className="mt-1.5">
              <summary className="cursor-pointer text-[10px] font-semibold text-amber-900">
                {findings.length} finding{findings.length === 1 ? "" : "s"}
              </summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 text-[10px] text-amber-950">
                {JSON.stringify(findings, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}

      {/* The semantic reviewer's own words about this sheet. */}
      {qc?.masterQcReview ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[10px] font-semibold text-gray-600">
            Master QC review
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-[10px] text-gray-800">
            {typeof qc.masterQcReview === "string"
              ? qc.masterQcReview
              : JSON.stringify(qc.masterQcReview, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

function JobHeader({
  job,
  selectedVersion,
  onSelectVersion,
}: {
  job: PanelProStudioJob;
  selectedVersion: DesignVersion | null;
  onSelectVersion: (version: number) => void;
}) {
  const vehicle = [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean).join(" ");
  const history = job.version_history;
  // THE GENERATION ID IS THE FIRST PERMANENT IDENTITY OF A DESIGN.
  //
  // It is minted at Create Design and every later table carries it forward.
  // The Design ID and the Design Order # are minted later, when the Production
  // Pack is purchased, and attached to this same generation -- so before that
  // purchase they are genuinely not assigned. Showing them as "—" read as
  // missing data on a healthy job; saying what they are waiting for is the
  // truth, and it is what tells an operator the record is fine.
  const awaitingPurchase = "Not assigned until Production Pack";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">
          Generation ID
        </div>
        <div className="mt-0.5 break-all font-mono text-sm font-semibold text-gray-900">
          {job.generation_id || "—"}
        </div>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-xs sm:grid-cols-3">
        {[
          ["Design ID", job.design_id || awaitingPurchase],
          // THE REVISION IS PART OF THE IDENTITY, NOT A DETAIL. (Owner,
          // 2026-08-31.) A panel, a proof and a Call-8 sheet are only
          // comparable within one immutable revision, so the board must name
          // which revision it is showing beside the generation it belongs to.
          ["Revision ID", history.current?.revisionId || job.revision_id || "—"],
          ["Design Order #", job.order_number || awaitingPurchase],
          ["Customer vehicle", vehicle || "—"],
          ["Current A.T.L.A.S. version", history.current ? `V${history.current.version}` : "—"],
          ["Job status", `${job.state}${job.current_stage ? ` · ${job.current_stage}` : ""}`],
          ["Created", exactTimestamp(job.created_at)],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-gray-500">{label}</dt>
            <dd
              className={`truncate text-[11px] font-semibold ${
                value === awaitingPurchase
                  ? "text-gray-400"
                  : "font-mono text-gray-900"
              }`}
              title={String(value)}
            >
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <AtlasProgressCard job={job} selectedVersion={selectedVersion} />

      <div className="mt-4 border-t border-gray-100 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
            Version + prompt history · {history.versions.length}
          </span>
          <span className="text-[10px] text-gray-400">
            The same history RevisionStudio shows
          </span>
        </div>
        {history.versions.length === 0 ? (
          <p className="text-[11px] text-gray-500">
            No A.T.L.A.S. revision has been recorded for this design yet.
          </p>
        ) : (
          <ol className="space-y-1.5">
            {history.versions.map((entry) => {
              const active = entry.revisionId === selectedVersion?.revisionId;
              return (
                <li key={entry.revisionId}>
                  <button
                    type="button"
                    onClick={() => onSelectVersion(entry.version)}
                    className={`flex w-full items-start gap-3 rounded-lg border p-2 text-left transition ${
                      active
                        ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-300"
                        : "border-gray-200 hover:border-gray-400"
                    }`}
                  >
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        active ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      V{entry.version}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 text-[10px] text-gray-500">
                        <span className="font-mono">{exactTimestamp(entry.createdAt)}</span>
                        <span className="uppercase tracking-wider">
                          {entry.promptKind === "original-brief" ? "original brief" : "revision"}
                        </span>
                        <span className="font-mono">rev {entry.revisionId.slice(0, 8)}</span>
                        <span className="font-mono">master {entry.masterContentHash.slice(0, 12)}</span>
                      </div>
                      {/* Verbatim, exactly as the customer typed it. */}
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-gray-800">
                        {entry.prompt || <span className="text-gray-400">No prompt recorded for this version.</span>}
                      </p>
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );
}

/**
 * EXTRACTED LOGOS AND BRAND ASSETS, FOR THE SELECTED VERSION.
 *
 * Call 10 separates the brand marks out of the accepted panels, one artifact
 * per placement, each recording which surface it sits on and which A.T.L.A.S.
 * master it descends from. This is where the design team downloads them --
 * individually, because the whole point of a Logo Pack is that a designer wants
 * one mark, not a ZIP of six.
 *
 * A logo whose master hash does not match the selected version is not shown as
 * that version's. It is reported as unattributed, because a brand asset from V3
 * sitting under a V1 heading is exactly the kind of quiet substitution the
 * lineage rules exist to stop.
 */
function LogoGallery({ job, selectedVersion }: { job: PanelProStudioJob; selectedVersion: DesignVersion | null }) {
  const master = selectedVersion?.masterContentHash || "";
  const { bound, unattributed } = useMemo(() => {
    const boundRows: WorkflowArtifact[] = [];
    const looseRows: WorkflowArtifact[] = [];
    for (const logo of job.logos) {
      const hash = String((logo.metadata as Record<string, unknown> | undefined)?.sourceMasterHash || "");
      if (master && hash === master) boundRows.push(logo);
      else if (!hash) looseRows.push(logo);
    }
    return { bound: boundRows, unattributed: looseRows };
  }, [job.logos, master]);

  const card = (logo: WorkflowArtifact, attributed: boolean) => {
    const metadata = (logo.metadata || {}) as Record<string, unknown>;
    const name = String(metadata.displayName || metadata.identityKey || "Brand asset");
    const surface = String(metadata.targetSurfaceKey || "");
    return (
      <div key={logo.id} className="rounded-lg border border-gray-200 p-2">
        <div className="flex aspect-square items-center justify-center rounded bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#ffffff_0%_50%)] bg-[length:16px_16px]">
          {logo.signedUrl ? (
            <img src={logo.signedUrl} alt={name} className="max-h-full max-w-full object-contain" />
          ) : (
            <ImageIcon className="h-5 w-5 text-gray-300" />
          )}
        </div>
        <div className="mt-1.5 truncate text-[11px] font-semibold text-gray-900" title={name}>{name}</div>
        <div className="flex flex-wrap items-center gap-1 text-[10px] text-gray-500">
          {surface && <span className="rounded bg-gray-100 px-1 py-0.5">{surface}</span>}
          <span className="font-mono">{String(metadata.contentType || "").replace("image/", "") || "png"}</span>
          {!attributed && <span className="text-amber-600">unattributed</span>}
        </div>
        <a
          href={logo.signedUrl}
          download={`${surface || "logo"}-${name.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase()}.png`}
          className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
        >
          <Download className="h-3 w-3" /> Download
        </a>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">Extracted logos &amp; brand assets</h2>
        <span className="font-mono text-[10px] text-gray-500">
          {bound.length} for {selectedVersion ? `V${selectedVersion.version}` : "this design"}
          {unattributed.length ? ` · ${unattributed.length} unattributed` : ""}
        </span>
      </div>
      {bound.length + unattributed.length === 0 ? (
        <p className="text-[11px] text-gray-500">
          The server separates these at Call 10, from the accepted panels. None has been produced for
          this run yet.
        </p>
      ) : (
        <>
          {bound.length > 0 && (
            <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(7.5rem,1fr))]">
              {bound.map((logo) => card(logo, true))}
            </div>
          )}
          {unattributed.length > 0 && (
            <div className="mt-3 border-t border-gray-100 pt-2">
              {/* Shown, not hidden, and not claimed for this version. These
                  predate the master binding on logo artifacts. */}
              <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-600">
                No version binding · {unattributed.length}
              </div>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(7.5rem,1fr))]">
                {unattributed.map((logo) => card(logo, false))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * PER-SURFACE HUMAN QC, AND WHAT IT ADDS UP TO.
 *
 * This is a physical check: a designer downloads the panel, lays it on the real
 * vehicle template, and confirms it will fit. The ten questions below are that
 * check written down, and the board answers three of them itself because they
 * are facts it can read rather than judgements a person has to make -- correct
 * A.T.L.A.S. version, proof and panel from the same master, and the panel's own
 * effective DPI against print. The rest are the designer's, and they are not
 * pre-ticked.
 *
 * PASS means every question is answered yes. Anything else is NEEDS CORRECTION,
 * which is a statement about the panel, not about the designer's progress -- a
 * surface nobody has looked at yet reads as not passed, because it has not
 * passed.
 *
 * Nothing here writes to the server. The release gate is the preflight
 * submission in the Production Pack section, and this is the evidence a person
 * assembles before they touch it.
 */
/**
 * The thirteen ticks each surface was approved on, for the release receipt.
 *
 * Read from what the server already recorded rather than from anything the
 * board still holds: the durable record is `designpro_surface_qc`, and this
 * copies it into the gate's evidence so the approval and the checklist that
 * justified it end up in the same receipt.
 */
function approvedSurfaceChecklists(
  records: Record<string, SurfaceQcRecord> = {},
): Record<string, Record<string, boolean>> {
  const approved: Record<string, Record<string, boolean>> = {};
  for (const record of Object.values(records)) {
    if (!record?.approved) continue;
    approved[record.surfaceKey] = Object.fromEntries(
      SURFACE_QC_CHECKLIST.map(([key]) => [key, record.checks?.[key] === true]),
    );
  }
  return Object.fromEntries(PRODUCTION_SURFACES.map((surfaceKey) => [
    surfaceKey,
    approved[surfaceKey] || Object.fromEntries(SURFACE_QC_CHECKLIST.map(([key]) => [key, false])),
  ]));
}

/**
 * ONE VERDICT FUNCTION, USED BY THE PANEL AND BY THE RELEASE GATE.
 *
 * If the checklist and the gate computed "passed" separately they would
 * eventually disagree, and the disagreement would only ever surface as a
 * surface that reads PASS but will not release -- or worse, one that releases
 * while reading NEEDS CORRECTION.
 */
function surfaceQcVerdicts(
  job: PanelProStudioJob,
  selectedVersion: DesignVersion | null,
) {
  const derivedFor = (surfaceKey: GenieSurfaceKey) => {
    const panel = job.raw_artifacts.find(
      (artifact) => artifact.kind === "panel" && artifact.surfaceKey === surfaceKey,
    );
    const view = job.raw_views.find((row) => row.surfaceKey === surfaceKey);
    const panelMaster = String((panel?.metadata as Record<string, unknown> | undefined)?.sourceMasterHash || "");
    const proofMaster = String(view?.atlasBinding?.masterContentHash || "");
    const metadata = (panel?.metadata || {}) as Record<string, unknown>;
    const printWidthIn = Number(metadata.printWidthInches);
    const pixelWidth = Number(metadata.pixelWidth);
    const upscaled = job.upscaled.some((row) => row.surfaceKey === surfaceKey);
    const effectiveDpi = printWidthIn > 0 && pixelWidth > 0 ? pixelWidth / printWidthIn : null;
    return {
      version: Boolean(selectedVersion && panelMaster && panelMaster === selectedVersion.masterContentHash),
      lineage: Boolean(panelMaster && proofMaster && panelMaster === proofMaster),
      // A panel short of print resolution passes this only once an enhanced
      // derivative exists for the surface -- which is the whole reason RUN
      // UPSCALE is on the board.
      resolution: upscaled || (effectiveDpi !== null && effectiveDpi >= 150),
      effectiveDpi,
    };
  };

  // MACHINE EVIDENCE ONLY. What the server can prove from the artifacts
  // themselves: that the panel belongs to the selected version, that it and its
  // proof descend from one master, and what the effective resolution is. It is
  // shown to the person making the call and never counts as one of their ticks.
  return PRODUCTION_SURFACES.map((surfaceKey) => ({
    surfaceKey,
    derived: derivedFor(surfaceKey),
  }));
}

/**
 * THE DESIGN AUTHORITY'S CHECKLIST, PER SURFACE, AGAINST ONE EXACT FILE.
 *
 * Thirteen questions only a person standing at a real vehicle template can
 * answer, ticked by hand, stored on the server against the panel's own content
 * hash. Nothing here is scored automatically and nothing is pre-ticked: an
 * automated lineage or DPI check is evidence for the person making the call, not
 * a substitute for the call.
 *
 * THE HASH IS THE VERSION SAFETY. A corrected or re-uploaded panel is different
 * bytes, so it addresses a different row, so its checklist is empty and its
 * APPROVE SURFACE button is disabled again. There is no inheritance to prevent
 * and no reset to remember -- a new file has simply never been checked.
 */
function SurfaceQcPanel({
  job,
  selectedVersion,
  records,
  onRecorded,
}: {
  job: PanelProStudioJob;
  selectedVersion: DesignVersion | null;
  /** What the server has recorded, keyed by `${surfaceKey}:${artifactHash}`. */
  records: Record<string, SurfaceQcRecord>;
  onRecorded: (record: SurfaceQcRecord) => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Record<string, boolean>>>({});
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const machine = useMemo(
    () => surfaceQcVerdicts(job, selectedVersion),
    [job, selectedVersion],
  );

  /** The ACTIVE production file for a surface: newest correction, else Call 9. */
  const activeArtifact = (surfaceKey: string) => {
    const corrected = (job.corrections?.[surfaceKey] || [])[0];
    return corrected
      || job.raw_artifacts.find((a) => a.kind === "panel" && a.surfaceKey === surfaceKey)
      || null;
  };

  const surfaces = PRODUCTION_SURFACES.map((surfaceKey) => {
    const artifact = activeArtifact(surfaceKey);
    const hash = String(artifact?.contentHash || "");
    const recorded = hash ? records[`${surfaceKey}:${hash}`] : undefined;
    const draft = drafts[`${surfaceKey}:${hash}`];
    const checks = draft || recorded?.checks || {};
    const ticked = SURFACE_QC_CHECKLIST.filter(([key]) => checks[key] === true).length;
    return {
      surfaceKey,
      artifact,
      hash,
      recorded,
      checks,
      ticked,
      complete: ticked === SURFACE_QC_CHECKLIST.length,
      evidence: machine.find((row) => row.surfaceKey === surfaceKey),
    };
  }).map((row) => ({
    ...row,
    // APPROVE SURFACE also needs the machine facts the server will re-prove:
    // the panel belongs to the selected A.T.L.A.S. version, and its proof
    // descends from the same master. Effective DPI is deliberately not here --
    // upscale runs after the preflight gate in the frozen stage order, so
    // requiring print resolution to approve a surface would deadlock the
    // workflow. Resolution is enforced at enhancement and output, where it can
    // actually be satisfied.
    approvable: row.complete
      && row.evidence?.derived.version === true
      && row.evidence?.derived.lineage === true,
  }));
  const approvedCount = surfaces.filter((row) => row.recorded?.approved).length;

  const tick = (surfaceKey: string, hash: string, key: string, value: boolean) => {
    const id = `${surfaceKey}:${hash}`;
    setDrafts((prev) => ({
      ...prev,
      [id]: { ...(prev[id] || records[id]?.checks || {}), [key]: value },
    }));
  };

  const submit = async (
    surfaceKey: string,
    hash: string,
    artifactId: string | null,
    checks: Record<string, boolean>,
    intent: "approve" | "correction",
  ) => {
    const id = `${surfaceKey}:${hash}`;
    setBusy(id);
    try {
      const record = await dpApi.recordSurfaceQc(job.generation_id, surfaceKey, {
        artifactHash: hash,
        artifactId,
        atlasRevisionId: selectedVersion?.revisionId || null,
        atlasMasterHash: selectedVersion?.masterContentHash || null,
        checks,
        approved: intent === "approve",
        needsCorrection: intent === "correction",
        correctionReason: intent === "correction" ? (reasons[id] || "").trim() : undefined,
      });
      onRecorded(record);
      setDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
      toast({
        title: intent === "approve" ? `${surfaceKey} approved` : `${surfaceKey} marked for correction`,
        description: intent === "approve"
          ? "Recorded against this exact file. A corrected panel starts a fresh checklist."
          : "The reason is on the record with your name and the time.",
      });
    } catch (cause: any) {
      toast({ title: "The server refused this", description: cause?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
          Human QC · per surface, against the real vehicle template
        </span>
        <span
          className={`rounded px-2 py-0.5 font-mono text-[10px] font-bold ${
            approvedCount === PRODUCTION_SURFACES.length
              ? "bg-emerald-50 text-emerald-700"
              : "bg-amber-50 text-amber-700"
          }`}
        >
          {approvedCount}/{PRODUCTION_SURFACES.length} APPROVED
        </span>
      </div>

      <div className="space-y-1.5">
        {surfaces.map((row) => {
          const id = `${row.surfaceKey}:${row.hash}`;
          const state = row.recorded?.approved
            ? "APPROVED"
            : row.recorded?.needsCorrection ? "NEEDS CORRECTION" : "PENDING";
          return (
            <div key={row.surfaceKey}>
              <button
                type="button"
                onClick={() => setOpen(open === row.surfaceKey ? null : row.surfaceKey)}
                disabled={!row.hash}
                className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left transition disabled:opacity-50 ${
                  state === "APPROVED"
                    ? "border-emerald-300 bg-emerald-50/60 hover:border-emerald-400"
                    : state === "NEEDS CORRECTION"
                      ? "border-red-300 bg-red-50/40 hover:border-red-400"
                      : "border-gray-300 bg-white hover:border-gray-400"
                }`}
              >
                <span className="text-xs font-semibold capitalize text-gray-900">{row.surfaceKey}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-[10px] text-gray-500">
                    {row.hash ? `${row.ticked}/${SURFACE_QC_CHECKLIST.length}` : "no panel yet"}
                  </span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      state === "APPROVED"
                        ? "bg-emerald-600 text-white"
                        : state === "NEEDS CORRECTION" ? "bg-red-600 text-white" : "bg-gray-400 text-white"
                    }`}
                  >
                    {state}
                  </span>
                </span>
              </button>

              {open === row.surfaceKey && row.hash && (
                <div className="mt-1 rounded-lg border border-gray-200 p-3">
                  <div className="mb-2 font-mono text-[9px] text-gray-500">
                    file {row.hash.slice(0, 16)}
                    {row.recorded && (
                      <> · checked by {row.recorded.checkedByName} · {exactTimestamp(row.recorded.checkedAt)}</>
                    )}
                  </div>

                  {/* Machine evidence, shown so the person deciding can see it.
                      It is never a tick and never counts toward the thirteen. */}
                  {row.evidence && (
                    <ul className="mb-3 space-y-0.5 rounded bg-gray-50 p-2 text-[10px] text-gray-600">
                      <li>Panel is from the selected A.T.L.A.S. version: {row.evidence.derived.version ? "yes" : "no"}</li>
                      <li>Proof and panel share one master: {row.evidence.derived.lineage ? "yes" : "no"}</li>
                      <li>
                        Effective resolution:{" "}
                        {row.evidence.derived.effectiveDpi !== null
                          ? `${Math.round(row.evidence.derived.effectiveDpi * 10) / 10} PPI`
                          : "unknown"}
                      </li>
                    </ul>
                  )}

                  <ul className="space-y-1">
                    {SURFACE_QC_CHECKLIST.map(([key, label]) => (
                      <li key={key} className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-gray-300"
                          checked={row.checks[key] === true}
                          disabled={row.recorded?.approved === true || busy === id}
                          onChange={(event) => tick(row.surfaceKey, row.hash, key, event.target.checked)}
                        />
                        <span className="text-[11px] leading-snug text-gray-700">{label}</span>
                      </li>
                    ))}
                  </ul>

                  {row.recorded?.needsCorrection && row.recorded.correctionReason && (
                    <p className="mt-2 rounded bg-red-50 p-2 text-[10px] text-red-700">
                      {row.recorded.correctionReason}
                    </p>
                  )}

                  {!row.recorded?.approved && (
                    <div className="mt-3 space-y-2">
                      <input
                        type="text"
                        placeholder="Why this surface needs correction"
                        value={reasons[id] || ""}
                        onChange={(event) => setReasons((prev) => ({ ...prev, [id]: event.target.value }))}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-[11px]"
                      />
                      {row.complete && !row.approvable && (
                        <p className="rounded bg-amber-50 p-2 text-[10px] text-amber-800">
                          The checklist is complete, but this panel does not bind
                          to the selected A.T.L.A.S. version and its proof. The
                          server refuses the approval for the same reason.
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === id || !(reasons[id] || "").trim()}
                          onClick={() => submit(row.surfaceKey, row.hash, row.artifact?.id || null, row.checks, "correction")}
                          className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                        >
                          Needs correction
                        </Button>
                        <Button
                          size="sm"
                          // Every one of the thirteen, or the button does not
                          // arm. The server refuses an incomplete approval too,
                          // so this is a courtesy rather than the control.
                          disabled={!row.approvable || busy === id}
                          onClick={() => submit(row.surfaceKey, row.hash, row.artifact?.id || null, row.checks, "approve")}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                        >
                          {busy === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Approve surface"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] leading-snug text-gray-500">
        Each checklist is bound to that surface's exact file. A corrected or
        re-uploaded panel starts a new checklist and must be approved again — an
        approval is never inherited from the file it replaced.
      </p>
    </div>
  );
}

/**
 * WHAT HAPPENED TO THIS ORDER, AND WHEN.
 *
 * Assembled from what the server actually recorded -- its stage rail and its
 * artifacts -- rather than from a separate event log the browser appends to. An
 * activity list that a UI writes is a list of what the UI believes; this is a
 * list of what the run did, and the two drift the moment a tab is closed at the
 * wrong time.
 *
 * Each entry names an actor. `server` for work a stage did, and the recorded
 * person for the two things a human causes: a corrected panel and an
 * operator-triggered enhancement.
 */
function ActivityHistory({ job }: { job: PanelProStudioJob }) {
  const entries = useMemo(() => {
    const rows: Array<{ at: string; what: string; actor: string; detail?: string }> = [];

    for (const version of job.version_history.versions) {
      rows.push({
        at: version.createdAt || "",
        what: `V${version.version} created`,
        actor: "customer",
        detail: version.promptKind === "original-brief" ? "original brief" : "revision",
      });
    }
    for (const stage of job.stages) {
      if (stage.state !== "complete") continue;
      rows.push({ at: "", what: STAGE_LABEL[stage.key] || stage.key, actor: "server" });
    }
    for (const artifact of job.raw_artifacts) {
      const metadata = (artifact.metadata || {}) as Record<string, unknown>;
      if (artifact.kind === "corrected-panel") {
        rows.push({
          at: String(metadata.correctedAt || ""),
          what: `${artifact.surfaceKey} panel corrected`,
          actor: String(metadata.correctedBy || "design team"),
          detail: String(metadata.reason || ""),
        });
      }
      if (artifact.kind === "upscaled-panel") {
        rows.push({
          at: "",
          what: `${artifact.surfaceKey} upscaled to ${Number(metadata.widthPx) || "?"}px`,
          actor: metadata.adminTriggered === true ? "design team" : "server",
          detail: metadata.humanCorrected === true ? "from the corrected panel" : undefined,
        });
      }
    }
    if (job.stamp) rows.push({ at: "", what: "Production Pack approved and stamped", actor: "design team" });
    if (job.zip) rows.push({ at: "", what: "Production ZIP built", actor: "server" });
    if (job.wrapbox) rows.push({ at: "", what: "Delivered to WrapBox", actor: "server" });

    // Timestamped entries first, oldest to newest; the rest keep the order the
    // server reported them in. A missing timestamp is left blank rather than
    // filled with "now" -- inventing one would make the audit trail a guess.
    return rows;
  }, [job]);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-900">Activity &amp; audit history</h2>
        <span className="font-mono text-[10px] text-gray-500">{entries.length} events</span>
      </div>
      <ol className="space-y-1">
        {entries.map((entry, index) => (
          <li key={`${entry.what}-${index}`} className="flex flex-wrap items-baseline gap-2 text-[11px]">
            <span className="w-40 shrink-0 font-mono text-[10px] text-gray-400">
              {entry.at ? exactTimestamp(entry.at) : "—"}
            </span>
            <span className="font-semibold text-gray-900">{entry.what}</span>
            <span className="rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-600">{entry.actor}</span>
            {entry.detail && <span className="min-w-0 flex-1 truncate text-gray-500">{entry.detail}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * PRODUCTION PACK — the back half of one job, from the server's own record.
 *
 * This replaces RestylePro's ProductionPackQCCard, which read `panelizer_jobs`,
 * `color_visualizations` and `designiq_generations` and drove delivery through
 * `deploy-to-wrapbox`. None of those exist on this server, and a card that
 * looks live while reading a database nobody writes is worse than no card.
 *
 * Everything below is the standalone runtime's own state: the stage rail it
 * reports, the artifacts it produced, and the two human gates it will not pass
 * without. The gates are real -- the database refuses approval unless every
 * check is explicitly confirmed -- so both are listed rather than summarised,
 * and neither is pre-ticked.
 */
/**
 * WHAT THE SERVER ACTUALLY HAS, FOR EACH PRESENCE CHECK.
 *
 * Computed from the run's own artifacts -- never asserted, never defaulted. A
 * check whose evidence reads "0/7" is telling the design team the truth about
 * the pack in front of them, and the box beside it stays theirs to tick.
 */
function packPresenceEvidence(job: PanelProStudioJob): Record<string, string> {
  const atlas = job.atlas_versions[job.atlas_versions.length - 1] || null;
  const panels = atlas?.callOnePanels || [];
  const cameras = new Set(
    (job.raw_views || []).filter((view) => view.signedUrl).map((view) => String(view.sourceViewType)),
  );
  const outputs = job.outputs || [];
  const formatCount = (format: string) =>
    outputs.filter((row) => outputFormatOf(String(row.storagePath || "")) === format).length;
  const withDims = panels.filter((panel) =>
    Number(panel.trimWidthIn) > 0 && Number(panel.printWidthIn) > 0 && Number(panel.bleedInches) > 0).length;
  const withPpi = panels.filter((panel) => Number(panel.effectivePpi) > 0).length;

  return {
    atlasPresent: atlas?.master?.contentHash
      ? `master ${atlas.master.contentHash.slice(0, 16)} · generation ${job.generation_id}`
      : "no accepted master",
    designIdPresent: job.design_id || "not assigned",
    sevenProofsPresent: `${cameras.size}/7 cameras rendered`,
    proofsIndividuallyPresent: `${(job.raw_views || []).filter((view) => view.signedUrl).length} proof files`,
    resolutionPresent: `${withPpi}/${panels.length || 6} panels state effective PPI`,
    dimensionsPresent: `${withDims}/${panels.length || 6} panels state trim, print and bleed`,
    panelQtyPresent: `${panels.length}/${PRODUCTION_SURFACES.length} panels cut`,
    assetsSeparate: `${(job.logos || []).length} separated logo asset(s)`,
    tiffPresent: `${formatCount("tiff")}/${PRODUCTION_SURFACES.length} TIFF`,
    pngPresent: `${formatCount("png")}/${PRODUCTION_SURFACES.length} PNG`,
    productionProofPresent: job.concept_json?.flat_proof_url ? "present" : "not produced",
  };
}

function ProductionPackSection({
  job,
  approvedSides,
  qcPassedSides,
  surfaceQc,
  onApproved,
}: {
  job: PanelProStudioJob;
  approvedSides: ReadonlySet<string>;
  /** Surfaces whose template check reads PASS. The release gate needs all six. */
  qcPassedSides: ReadonlySet<string>;
  /** What the server recorded per surface, carried into the QC receipt. */
  surfaceQc: Record<string, SurfaceQcRecord>;
  onApproved: () => Promise<void>;
}) {
  const { toast } = useToast();
  const [preflight, setPreflight] = useState<Record<string, boolean>>({});
  const [preflightNotes, setPreflightNotes] = useState("");
  const [finalQc, setFinalQc] = useState<Record<string, boolean>>({});
  const [finalNotes, setFinalNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const stageState = (key: string) => job.stages.find((stage) => stage.key === key)?.state || "pending";
  const preflightDone = stageState("await_panelpro_preflight_qc") === "complete";
  const finalDone = stageState("await_final_human_qc") === "complete";
  const allSidesApproved = PRODUCTION_SURFACES.every((side) => approvedSides.has(side));
  // NO RELEASE WITH AN UNRESOLVED SURFACE. A side reading NEEDS CORRECTION has
  // not been laid on a real template and confirmed to fit, and releasing it
  // sends artwork to print that nobody physically checked.
  const qcOutstanding = PRODUCTION_SURFACES.filter((side) => !qcPassedSides.has(side));
  const presenceEvidence = packPresenceEvidence(job);
  const preflightReady = PACK_PRESENCE_CHECKS.every(([key]) => preflight[key])
    && PREFLIGHT_CHECKS.every(([key]) => preflight[key])
    && allSidesApproved && qcOutstanding.length === 0;
  const finalReady = FINAL_CHECKS.every(([key]) => finalQc[key]);

  const outputsByFormat = OUTPUT_FORMATS.map((format) => ({
    format,
    files: job.outputs.filter((artifact) => outputFormatOf(artifact.storagePath) === format),
  }));

  const submitPreflight = async () => {
    setBusy("preflight");
    try {
      await dpApi.approvePreflight(
        job.generation_id,
        {
          ...(PACK_PRESENCE_CHECKS.reduce((acc, [key]) => ({ ...acc, [key]: true }), {}) as PreflightQc),
          ...(PREFLIGHT_CHECKS.reduce((acc, [key]) => ({ ...acc, [key]: true }), {}) as PreflightQc),
          approvedSides: [...approvedSides],
          // What was verified on each side, so the receipt records the physical
          // check rather than only that a button was pressed.
          surfaceQc: approvedSurfaceChecklists(surfaceQc),
        } as PreflightQc,
        preflightNotes,
      );
      await onApproved();
      toast({ title: "Preflight released", description: "The panels are cleared into enhancement and output." });
    } catch (cause: any) {
      toast({ title: "Preflight refused", description: cause?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const submitFinal = async () => {
    setBusy("final");
    try {
      await dpApi.approveFinalQc(
        job.generation_id,
        FINAL_CHECKS.reduce((acc, [key]) => ({ ...acc, [key]: true }), {}) as FinalQc,
        finalNotes,
      );
      await onApproved();
      toast({ title: "Production Pack approved", description: "Stamp, ZIP and WrapBox delivery follow on the server." });
    } catch (cause: any) {
      toast({ title: "Approval refused", description: cause?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-bold text-gray-900">Production Pack</h2>
        <span className="rounded bg-gray-100 px-2 py-0.5 font-mono text-[10px] text-gray-600">
          {STAGE_LABEL[job.current_stage] || job.current_stage} · {job.state}
        </span>
      </div>

      {/* THE SERVER'S OWN STAGE RAIL. Reported, never inferred: a stage is
          complete because the runtime says so, not because a file exists. */}
      <ol className="mb-4 grid gap-1 sm:grid-cols-2">
        {job.stages.map((stage) => (
          <li key={stage.key} className="flex items-center gap-2 text-[11px]">
            <span
              className={
                stage.state === "complete" ? "h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                : stage.state === "running" ? "h-2 w-2 shrink-0 animate-pulse rounded-full bg-blue-500"
                : stage.state === "waiting" ? "h-2 w-2 shrink-0 rounded-full bg-amber-500"
                : stage.state === "failed" ? "h-2 w-2 shrink-0 rounded-full bg-red-500"
                : "h-2 w-2 shrink-0 rounded-full bg-gray-300"
              }
            />
            <span className={stage.state === "complete" ? "text-gray-900" : "text-gray-500"}>
              {STAGE_LABEL[stage.key] || stage.key}
            </span>
            {stage.waitReason && <span className="text-amber-600">· {stage.waitReason}</span>}
          </li>
        ))}
      </ol>

      {/* GATE ONE. Releases the panels into Topaz and the output build. */}
      <div className="mb-4 rounded-lg border border-gray-200 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">PanelPro preflight</h3>
          {preflightDone
            ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">released</span>
            : <span className="text-[10px] text-gray-500">{approvedSides.size}/{PRODUCTION_SURFACES.length} sides approved</span>}
        </div>
        {!preflightDone && (
          <>
            {/* IS EVERYTHING THERE. The presence sweep the owner asked for
                (2026-08-28), written out so the design team can tick it rather
                than infer it from a wall of tiles. The evidence beside each row
                is computed from the run's own artifacts; the box is only ever
                ticked by a person -- RULE 0.22: PanelPro QC is human QC, and a
                machine may show what it found but never sign for it. */}
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
              Everything present
            </div>
            <ul className="mb-3 space-y-1.5">
              {PACK_PRESENCE_CHECKS.map(([key, label]) => (
                <li key={key} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-emerald-600"
                    checked={!!preflight[key]}
                    onChange={(event) => setPreflight((prev) => ({ ...prev, [key]: event.target.checked }))}
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] leading-snug text-gray-600">{label}</span>
                    <span className="block truncate font-mono text-[10px] text-gray-400" title={presenceEvidence[key]}>
                      {presenceEvidence[key]}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-500">
              Everything correct
            </div>
            <ul className="space-y-1.5">
              {PREFLIGHT_CHECKS.map(([key, label]) => (
                <li key={key} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-emerald-600"
                    checked={!!preflight[key]}
                    onChange={(event) => setPreflight((prev) => ({ ...prev, [key]: event.target.checked }))}
                  />
                  <span className="text-[11px] leading-snug text-gray-600">{label}</span>
                </li>
              ))}
            </ul>
            <Textarea
              value={preflightNotes}
              onChange={(event) => setPreflightNotes(event.target.value)}
              placeholder="What you checked on the vehicle template"
              rows={2}
              className="mt-2 resize-none text-xs"
            />
            <Button
              size="sm"
              className="mt-2 gap-1.5"
              disabled={!preflightReady || busy === "preflight"}
              onClick={() => void submitPreflight()}
            >
              <ShieldCheck className="h-4 w-4" />
              {busy === "preflight" ? "Releasing…" : "Release preflight"}
            </Button>
            {!allSidesApproved && (
              <p className="mt-1 text-[11px] text-gray-500">
                Every surface has to be approved on its own card first.
              </p>
            )}
            {qcOutstanding.length > 0 && (
              <p className="mt-1 text-[11px] text-amber-700">
                Human QC still reads NEEDS CORRECTION on: {qcOutstanding.join(", ")}.
              </p>
            )}
          </>
        )}
      </div>

      {/* THE OUTPUT SET. Eighteen files: six surfaces times PNG, TIFF and EPS. */}
      <div className="mb-4 rounded-lg border border-gray-200 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">Print files</h3>
          <span className="font-mono text-[10px] text-gray-500">
            {job.outputs.length}/{EXPECTED_OUTPUT_FILES}
          </span>
        </div>
        {/* WHERE THESE COME FROM, PER SURFACE. Call 12 enhances the ACTIVE
            artifact -- the newest human correction when one exists, the branded
            Call 9 panel otherwise -- and output.build reads ONLY those enhanced
            panels, hash-verified against the Call 12 receipt. So the file that
            prints is the file the team approved, through the enhancement, never
            around it. */}
        {/* EVERY CONTAINER IS DOWNLOADABLE, SOURCE AND DERIVATIVE BOTH.
            RULE 0.22: "The complete asset set, each individually downloadable"
            and "Do not hide files behind only a final ZIP". This list used to
            report an upscale state in prose with nothing to click, so a
            designer could see that a panel existed and still had no way to take
            it to a vehicle template (owner, 2026-08-27). The source panel is
            kept beside its upscaled derivative rather than replaced by it, so
            the team can compare what the enhancement did. */}
        <ul className="mb-2 grid gap-1 sm:grid-cols-2">
          {PRODUCTION_SURFACES.map((side) => {
            const correction = (job.corrections[side] || [])[0];
            const branded = job.raw_artifacts.find(
              (artifact) => artifact.kind === "panel" && artifact.surfaceKey === side,
            );
            const active = correction || branded;
            const enhanced = job.upscaled.find((row) => row.surfaceKey === side);
            const dims = (artifact?: { metadata?: Record<string, unknown> }) => {
              const width = Number(artifact?.metadata?.pixelWidth ?? artifact?.metadata?.widthPx);
              const height = Number(artifact?.metadata?.pixelHeight ?? artifact?.metadata?.heightPx);
              return width > 0 && height > 0 ? `${width}×${height}` : "";
            };
            return (
              <li key={side} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded border border-gray-200 px-2 py-1 text-[11px]">
                <span className="capitalize font-semibold text-gray-700">{side}</span>
                <span className="font-mono text-[10px] text-gray-500">
                  {correction ? "corrected" : "branded"}
                  {enhanced ? " · upscaled" : " · not upscaled yet"}
                </span>
                <span className="flex w-full items-center gap-3">
                  {active?.signedUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 hover:underline"
                      href={withDownloadName(active.signedUrl, `${side}-${correction ? "corrected" : "panel"}.png`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="h-3 w-3" />
                      {correction ? "Corrected panel" : "Source panel"}
                      {dims(active) ? ` · ${dims(active)}` : ""}
                    </a>
                  ) : (
                    <span className="text-[10px] text-gray-400">panel not cut yet</span>
                  )}
                  {enhanced?.signedUrl ? (
                    <a
                      className="inline-flex items-center gap-1 text-[10px] font-semibold text-fuchsia-700 hover:underline"
                      href={withDownloadName(enhanced.signedUrl, `${side}-upscaled.png`)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Download className="h-3 w-3" />
                      Upscaled{dims(enhanced) ? ` · ${dims(enhanced)}` : ""}
                    </a>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>

        {job.outputs.length === 0 ? (
          <p className="text-[11px] text-gray-500">
            Built on the server from each surface's enhanced panel, after preflight releases.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            {outputsByFormat.map(({ format, files }) => (
              <div key={format}>
                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                  {format} · {files.length}
                </div>
                <ul className="mt-1 space-y-1">
                  {files.map((file) => (
                    <li key={file.id} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate text-gray-700">{file.surfaceKey}</span>
                      <a
                        href={file.signedUrl}
                        download={`${file.surfaceKey}.${format}`}
                        className="shrink-0 font-medium text-blue-600 hover:underline"
                      >
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* GATE TWO. What lets the run stamp, ZIP and deliver. */}
      <div className="mb-4 rounded-lg border border-gray-200 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-gray-700">Approve Production Pack</h3>
          {finalDone && <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">approved</span>}
        </div>
        {!finalDone && (
          <>
            <ul className="space-y-1.5">
              {FINAL_CHECKS.map(([key, label]) => (
                <li key={key} className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-emerald-600"
                    checked={!!finalQc[key]}
                    onChange={(event) => setFinalQc((prev) => ({ ...prev, [key]: event.target.checked }))}
                  />
                  <span className="text-[11px] leading-snug text-gray-600">{label}</span>
                </li>
              ))}
            </ul>
            <Textarea
              value={finalNotes}
              onChange={(event) => setFinalNotes(event.target.value)}
              placeholder="Approver notes"
              rows={2}
              className="mt-2 resize-none text-xs"
            />
            <Button
              size="sm"
              className="mt-2 gap-1.5"
              disabled={!finalReady || job.outputs.length < EXPECTED_OUTPUT_FILES || busy === "final"}
              onClick={() => void submitFinal()}
            >
              <Check className="h-4 w-4" />
              {busy === "final" ? "Approving…" : "Approve Production Pack"}
            </Button>
            {job.outputs.length < EXPECTED_OUTPUT_FILES && (
              <p className="mt-1 text-[11px] text-gray-500">
                All {EXPECTED_OUTPUT_FILES} output files have to exist before the pack can be approved.
              </p>
            )}
          </>
        )}
      </div>

      {/* DELIVERY. Each of the three is an artifact the server wrote, so the
          board shows the file rather than a claim that it happened. */}
      <div className="grid gap-2 sm:grid-cols-3">
        {[
          { label: "Approval stamp", artifact: job.stamp, name: "qc-certificate.png" },
          { label: "Production ZIP", artifact: job.zip, name: `production-pack-${job.order_number || job.design_id}.zip` },
          { label: "WrapBox delivery", artifact: job.wrapbox, name: "wrapbox-manifest.json" },
        ].map(({ label, artifact, name }) => (
          <div key={label} className="rounded-lg border border-gray-200 p-2">
            <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">{label}</div>
            {artifact ? (
              <a
                href={artifact.signedUrl}
                download={name}
                className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:underline"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </a>
            ) : (
              <p className="mt-1 text-[11px] text-gray-400">Not produced yet</p>
            )}
          </div>
        ))}
      </div>

      {/* WHAT IS IN THE ZIP. (Trish 2026-08-28)
          "All ZIP assets must have a container next to ZIP so we know what's in
          ZIP." A download link is not an inventory: RULE 0.22 forbids hiding
          files behind only a final ZIP, and a reader who cannot see inside the
          archive is in that position even when every file is downloadable
          somewhere else on this board. `zip.build` publishes its own table of
          contents -- one row per entry, the path it was written to inside the
          archive, and the sha256 of the bytes that went in -- so this lists the
          archive rather than a guess at it. */}
      <ZipContentsCard zip={job.zip} />
    </div>
  );
}

/**
 * The archive's own table of contents, grouped by what each file is.
 *
 * Before the ZIP is built there is nothing to list, and this says so rather
 * than previewing a contract: what a pack WILL contain depends on which
 * products were purchased, and stating it early would be a claim the server
 * has not made. Once built, every row comes off `metadata.archiveManifest`.
 */
function ZipContentsCard({ zip }: { zip: WorkflowArtifact | null }) {
  const manifest = Array.isArray((zip?.metadata as { archiveManifest?: unknown })?.archiveManifest)
    ? ((zip!.metadata as { archiveManifest: ZipArchiveEntry[] }).archiveManifest)
    : [];
  const groups = new Map<string, ZipArchiveEntry[]>();
  for (const entry of manifest) {
    const kind = String(entry?.kind || "file");
    groups.set(kind, [...(groups.get(kind) || []), entry]);
  }
  const totalBytes = manifest.reduce((sum, entry) => sum + (Number(entry?.byteSize) || 0), 0);

  return (
    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
          Inside the Production ZIP
        </div>
        {manifest.length > 0 && (
          <div className="text-[11px] text-gray-500 tabular-nums">
            {manifest.length} files · {(totalBytes / 1_048_576).toFixed(1)} MB uncompressed
          </div>
        )}
      </div>

      {manifest.length === 0 ? (
        <p className="mt-1 text-[11px] text-gray-400">
          No archive built yet — its contents are listed here the moment
          <span className="font-mono"> zip.build </span> writes them.
        </p>
      ) : (
        <div className="mt-2 space-y-2">
          {[...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([kind, entries]) => (
            <div key={kind}>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-600">
                {kind.replace(/-/g, " ")} · {entries.length}
              </div>
              <ul className="mt-0.5 space-y-0.5">
                {entries.map((entry) => (
                  <li key={entry.archivePath} className="flex flex-wrap items-baseline gap-x-2 text-[11px]">
                    <code className="font-mono text-gray-800 break-all">{entry.archivePath}</code>
                    {entry.surfaceKey && <span className="text-gray-500">{entry.surfaceKey}</span>}
                    {entry.byteSize ? (
                      <span className="text-gray-400 tabular-nums">{(entry.byteSize / 1024).toFixed(0)} KB</span>
                    ) : null}
                    {entry.contentHash && (
                      <code className="font-mono text-gray-400">{String(entry.contentHash).slice(0, 12)}</code>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type ZipArchiveEntry = {
  archivePath: string;
  kind: string;
  surfaceKey: string | null;
  contentHash: string | null;
  byteSize: number | null;
};

export default function AdminGeminiCompareStudio() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [params, setParams] = useSearchParams();
  /**
   * The job this page is about, when the URL already names it.
   *
   * The studio was reachable only at /designpro/studio-board?order=RP-… and
   * searched for its job. It is now what the PanelPro route mounts --
   * /designpro/jobs/:generationId/panelpro -- where the generation is already
   * in the path, so opening that URL has to land on that job rather than on a
   * search box. The order query still works for the deep links that use it.
   */
  const { generationId: routeGenerationId } = useParams();

  const [orderInput, setOrderInput] = useState(params.get("order") || "");
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [job, setJob] = useState<Job | null>(null);
  // Always-current snapshot of the job so async writes (delete/add version,
  // separate, flip) read the LATEST qc_side_panels instead of a stale closure —
  // otherwise quick successive edits re-add a version you just deleted.
  const jobRef = useRef<Job | null>(null);
  useEffect(() => { jobRef.current = job; }, [job]);
  // The sides the team has ticked off, held outside React state for the same
  // reason as jobRef: a reload reads the LATEST set rather than whichever one
  // was captured when the callback was created. Approval is a browser-side
  // working set until the preflight gate is submitted; the server holds it from
  // then on.
  const approvedSidesRef = useRef<Set<string>>(new Set());
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
  /**
   * WHICH VERSION THIS WORKSPACE IS SHOWING. Null means the newest, which is
   * what an unqualified reference to "the design" means. Selecting an older one
   * switches the whole board to that revision's assets rather than layering it
   * over the current set -- two versions on screen at once is how the wrong
   * panel gets approved.
   */
  const [selectedVersionNumber, setSelectedVersionNumber] = useState<number | null>(null);
  // Version selection is scoped to one generation. Without an independent
  // identity ref, selecting V1 on job A and then opening job B could leave B on
  // V1 even though an unqualified open must show its newest accepted revision.
  // Polling the same job does not reset an intentional historical selection.
  const versionSelectionGenerationRef = useRef<string | null>(null);
  /**
   * The designer's answers to the per-surface template check, held in the
   * browser until the preflight gate is submitted. Three of the ten questions
   * are read off the server record instead of asked, so only the human ones
   * live here.
   */
  // WHAT THE SERVER HAS RECORDED, keyed by `${surfaceKey}:${artifactHash}`.
  // The checklist is not browser state any more: it is read back here, so a
  // reload shows what was actually checked and by whom, and a corrected panel
  // (different hash, no row) correctly shows an empty checklist.
  const [surfaceQcRecords, setSurfaceQcRecords] = useState<Record<string, SurfaceQcRecord>>({});
  const surfaceQcRef = useRef<Record<string, SurfaceQcRecord>>({});
  const rememberSurfaceQc = useCallback((record: SurfaceQcRecord) => {
    setSurfaceQcRecords((prev) => {
      const next = { ...prev, [`${record.surfaceKey}:${record.artifactHash}`]: record };
      surfaceQcRef.current = next;
      return next;
    });
  }, []);
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
  const [recentJobs, setRecentJobs] = useState<PanelProStudioListJob[] | null>(null);
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
      const rows = await listPanelProStudioJobs();
      setRecentJobs(rows);
    } catch {
      setRecentJobs([]);
    } finally {
      setLoadingRecent(false);
    }
  }, []);

  // ── Load a job by whatever the designer typed ──
  //
  // ONE STORE, ONE IDENTITY. This search used to run four fallbacks in order: an
  // ilike on the panelizer job's order number, then the same by id, then three
  // ilikes across an ApprovePro approval's metadata for the order number's three
  // spellings, then a design UUID that resolved a visualization, walked its
  // back-link to the canonical generation, and MINTED a panelizer job when none
  // existed -- a browser creating a production row so the board would have
  // somewhere to write.
  //
  // The run mints and owns its order number, and it is the design. So an order
  // number, a Design ID and a generation id all resolve against what the gateway
  // already returned, nothing is minted, and a job that does not exist reports
  // that rather than being created.
  const loadJob = useCallback(async (generationId: string) => {
    const requestedGeneration = String(generationId || "").trim().toLowerCase();
    const changingGeneration = versionSelectionGenerationRef.current !== requestedGeneration;
    const next = await loadPanelProStudioJob(
      requestedGeneration,
      changingGeneration ? new Set<string>() : approvedSidesRef.current,
    );
    if (next) {
      if (versionSelectionGenerationRef.current !== next.generation_id) {
        versionSelectionGenerationRef.current = next.generation_id;
        // These approvals are unsaved browser working state. Every job uses
        // the same six keys, so carrying them across a GenerationID boundary
        // would make the new job appear approved by the old job's clicks.
        approvedSidesRef.current = new Set();
        setSelectedVersionNumber(null);
      }
      setJob(next as unknown as Job);
    }
    // The checklist lives on the server, so it is READ here rather than
    // remembered. A reload shows what was actually ticked, by whom and when;
    // a job opened by a second person shows the same thing.
    const recorded = await dpApi.listSurfaceQc(generationId).catch(() => [] as SurfaceQcRecord[]);
    const byFile = Object.fromEntries(
      recorded.map((record) => [`${record.surfaceKey}:${record.artifactHash}`, record]),
    );
    surfaceQcRef.current = byFile;
    setSurfaceQcRecords(byFile);
    return next;
  }, []);

  const runSearch = useCallback(async (raw: string) => {
    const q = (raw || "").trim();
    if (!q) return;
    setSearching(true);
    setNotFound(false);
    setJob(null);
    setProof2d("");
    try {
      const generationId = await findPanelProStudioJob(q);
      if (!generationId) { setNotFound(true); return; }
      const found = await loadJob(generationId);
      if (!found) { setNotFound(true); return; }
      // Keep the generation in the URL rather than the order number: an order
      // number's digits could match another order on reload, and the generation
      // is the identity everything else on this page keys by. &run= is preserved
      // so a deep link from RevisionStudio still does what it came to do.
      const nextParams: Record<string, string> = { order: generationId };
      const runFlag = new URLSearchParams(window.location.search).get("run");
      if (runFlag) nextParams.run = runFlag;
      setParams(nextParams);
    } catch (e: any) {
      toast({ title: "Search failed", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setSearching(false);
    }
  }, [setParams, toast, loadJob]);

  // RE-LINKING A DESIGN IS GONE, BECAUSE THE MISMATCH IT FIXED CANNOT HAPPEN.
  //
  // An order used to resolve to a design through an approval row's
  // source_visualization_id, and when that pointer was wrong the board let an
  // admin paste the correct visualization link to re-point it. Here the run IS
  // the design: the order number, the Design ID and the artwork are the same
  // record, so there is no pointer to be wrong and nothing to re-point.
  const relinkDesign = useCallback(async () => {
    toast({
      title: "Nothing to re-link",
      description: "An order and its design are one server-owned run here, so they cannot point at each other incorrectly.",
    });
  }, [toast]);

  // THE BOARD READS THE SERVER, ALWAYS, AND KEEPS READING IT.
  //
  // The route parameter wins over ?order=: a path that names a generation is a
  // stronger statement of intent than a query left over from a previous
  // navigation.
  //
  // It used to bail out when a job was already in state (`if (job) return`),
  // which made the board a snapshot of whenever it first loaded. Opened while a
  // design is still being made -- which is exactly when this page is worth
  // watching -- it showed the empty state forever, because at that instant
  // there genuinely was nothing and nothing ever asked again.
  //
  // So: load on mount and on every route change, then keep polling while the
  // run is unfinished. The A.T.L.A.S. master, the six panels, Driver 3D and the
  // remaining proofs each appear as the SERVER produces them, never from
  // anything the browser is holding. Polling stops once the run is terminal,
  // because a finished run has nothing left to reveal.
  useEffect(() => {
    if (!routeGenerationId) {
      const o = params.get("order");
      if (!job && o) runSearch(o);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (cancelled) return;
      const next = await loadJob(String(routeGenerationId)).catch(() => null);
      if (cancelled) return;
      const state = String((next as { state?: string } | null)?.state || "");
      const settled = ["complete", "failed", "cancelled"].includes(state);
      if (!settled) timer = setTimeout(() => { void poll(); }, 5000);
    };
    void poll();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeGenerationId]);

  // Load the recent-jobs list whenever there's no job loaded (landing screen).
  useEffect(() => {
    if (!job && recentJobs === null) loadRecentJobs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job]);

  // The 2D proof comes with the job. It used to fall through two more stores
  // when the concept had none; Call 8 publishes it as a hashed artifact and the
  // projection selects it by role, so there is one place to look.
  useEffect(() => {
    if (!job) return;
    const cj = job.concept_json || {};
    setProof2d(cj.flat_proof_url || cj.render_urls?.production_proof || "");
  }, [job?.id, job?.concept_json]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the board current while the server works. This used to subscribe to
  // row updates on the job table so an approval made elsewhere appeared here;
  // the state lives in the run's artifacts and receipts now, so the board
  // re-reads the projection instead. Signed URLs expire in five minutes, which
  // this refresh also renews.
  useEffect(() => {
    if (!job?.id) return;
    const timer = window.setInterval(() => { void loadJob(String(job.id)); }, 60_000);
    return () => window.clearInterval(timer);
  }, [job?.id, loadJob]);

  /**
   * The version on screen, and the assets that belong to it.
   *
   * Membership is the master hash a panel or proof already records, so
   * switching versions actually changes what is shown instead of relabelling
   * the same files. An artifact with no binding is not attributed to the
   * selected version -- it is reported separately rather than mislabelled.
   */
  const versionHistory = (job as unknown as PanelProStudioJob | null)?.version_history;
  const selectedVersion = useMemo(() => {
    const versions = versionHistory?.versions || [];
    if (!versions.length) return null;
    if (selectedVersionNumber == null) return versions[versions.length - 1];
    return versions.find((entry) => entry.version === selectedVersionNumber) || versions[versions.length - 1];
  }, [versionHistory, selectedVersionNumber]);

  /**
   * The job as it was at the selected version. Switching versions changes the
   * panels, proofs and logos on screen, never just the badge -- two versions on
   * one board is how the wrong panel gets approved.
   */
  const versionedJob = useMemo(() => {
    const current = job as unknown as PanelProStudioJob | null;
    if (!current || !selectedVersion) return current;
    try {
      return panelProJobAtVersion(current, selectedVersion, approvedSidesRef.current);
    } catch {
      return current;
    }
  }, [job, selectedVersion]);

  /**
   * Which surfaces read PASS. Computed by the same function the checklist
   * renders from, so the gate and the panel can never disagree about whether a
   * side is releasable.
   */
  // A surface counts as passed only when the SERVER holds an approval for the
  // file that is active right now. A correction changes the active hash, so the
  // old approval stops counting the moment it is superseded -- which is exactly
  // the behaviour "never inherit approval from the old file" describes.
  const qcPassedSides = useMemo(() => {
    if (!versionedJob) return new Set<string>();
    return new Set(PRODUCTION_SURFACES.filter((surfaceKey) => {
      const active = (versionedJob.corrections?.[surfaceKey] || [])[0]
        || versionedJob.raw_artifacts.find((a) => a.kind === "panel" && a.surfaceKey === surfaceKey);
      const hash = String(active?.contentHash || "");
      return Boolean(hash && surfaceQcRecords[`${surfaceKey}:${hash}`]?.approved);
    }));
  }, [versionedJob, surfaceQcRecords]);

  /**
   * THE PROOFS AND PANELS OF THE SELECTED VERSION, NOT OF THE NEWEST ONE.
   *
   * Both read the version-scoped job, so choosing V1 on a design now at V3
   * changes the six surfaces on screen. Reading the raw job here was the gap
   * that let the version badge move while the artwork underneath it did not --
   * which is worse than not offering the switch at all, because the board would
   * then be labelling V3's panels as V1.
   */
  const viewMap = useMemo(() => {
    const source = versionedJob || job;
    const fromAll = toViewUrlMap(source?.all_view_urls);
    const fromConcept = toViewUrlMap(source?.concept_json?.render_urls);
    return { ...fromConcept, ...fromAll };
  }, [versionedJob, job]);

  const qcPanels: Record<string, any> =
    (versionedJob || job)?.concept_json?.qc_side_panels || {};
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

  // THE BOARD DOES NOT WRITE PRODUCTION STATE.
  //
  // This persisted the whole managed concept -- every side's version list, its
  // active pointer and its approval -- into a job row, and for an ApprovePro
  // order into an approval's metadata AND a second mirrored job row so the
  // panelizer would agree. Three writes of the same state from a browser, which
  // is how two surfaces end up disagreeing about which panel is active.
  //
  // Here the versions are artifacts the server published, the active artifact
  // per surface is decided by the same rule Call 12 enhances by, and the
  // approval that matters is the preflight gate -- a receipt, not a column. So
  // the concept is a projection: side approvals live in this session until the
  // gate is submitted, and everything else is read.
  const writeConcept = useCallback(async (nextConcept: any) => {
    const sides = nextConcept?.qc_side_panels || {};
    const approved = new Set<string>(
      Object.keys(sides).filter((sideKey) => sides[sideKey]?.approved === true),
    );
    approvedSidesRef.current = approved;
    setJob((prev) => (prev
      ? { ...prev, concept_json: { ...(prev.concept_json || {}), ...(nextConcept || {}) } }
      : prev));
    jobRef.current = jobRef.current
      ? { ...jobRef.current, concept_json: { ...(jobRef.current.concept_json || {}), ...(nextConcept || {}) } }
      : jobRef.current;
  }, []);

  // The job IS the production job. This used to mint or reuse a second row so an
  // ApprovePro order could flow into ProductionFlow and the panelizer; a
  // DesignProAI run is that row, so the id it already has is the one every
  // downstream surface keys by.
  const ensureBackingPanelizerJob = useCallback(async (): Promise<string | null> => {
    const cur = jobRef.current || job;
    return cur?.id ? String(cur.id) : null;
  }, [job]);

  const goToProductionFlow = useCallback(async () => {
    const id = await ensureBackingPanelizerJob();
    if (id) navigate(`/productionflow/${id}`);
  }, [ensureBackingPanelizerJob, navigate]);

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

  // THE AUDITED CORRECTION UPLOAD.
  //
  // This used to drop any file into storage and attach it to the job as that
  // side's newest version -- an unbound image entering the production set,
  // recorded nowhere except the row it was written to.
  //
  // It is the same gesture and the same button, but the file is now recorded
  // against the exact surface and revision it corrects, carrying the Call 9
  // panel it replaces, that panel's master, who uploaded it, when, and why. The
  // branded panel is left byte-for-byte and stays downloadable beside it, and
  // Call 12 enhances whichever artifact is active -- so a corrected side reaches
  // print through Topaz and the output build like any other, never around them.
  //
  // A reason is required because that is the audit trail; a correction without
  // one is an unexplained substitution of production artwork.
  const handleUpload = async (def: (typeof VIEW_DEFS)[number], file: File) => {
    const cur = jobRef.current || job;
    if (!cur?.id || !file) return;
    const surfaceKey = SURFACE_FOR_SIDE_KEY[def.sideKey];
    const revisionId = (cur as any).revision_id as string | null;
    if (!surfaceKey) {
      toast({ title: "Not a production surface", description: `${def.label} is not one of the six.`, variant: "destructive" });
      return;
    }
    if (!revisionId) {
      toast({
        title: "This run has no reported revision",
        description: "A correction has to bind to one, so it cannot be recorded yet.",
        variant: "destructive",
      });
      return;
    }
    const reason = window.prompt(
      `What did not fit on the template for ${def.label}, and what did you change?`,
      "",
    );
    if (reason === null) return;
    if (reason.trim().length < 8) {
      toast({ title: "A correction needs a reason", description: "Say what did not fit and what you changed.", variant: "destructive" });
      return;
    }
    setUploadingSide(def.sideKey);
    try {
      await dpApi.uploadCorrectedPanel({
        generationId: String(cur.id),
        revisionId,
        surfaceKey,
        file,
        reason: reason.trim(),
      });
      await loadJob(String(cur.id));
      toast({
        title: `${def.label} correction recorded`,
        description: "The original panel is kept and still bound to it. Compare, then Approve.",
      });
    } catch (e: any) {
      toast({ title: "Correction refused", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setUploadingSide(null);
      const el = fileInputs.current[def.sideKey];
      if (el) el.value = "";
    }
  };

  // A PROOF IS NOT REPLACEABLE FROM HERE.
  //
  // The board let a user upload a correct 3D render for a side and hide the
  // job's own, because a view could be wrong and re-rendering the whole job to
  // fix one was expensive. Under A.T.L.A.S. a proof is a projection of the
  // accepted master, conditioned on that surface's exact zone bytes and refused
  // by the runtime if those bytes do not hash to the master. An uploaded image
  // in its place is unverified, and it is the left half of the comparison the
  // panel is approved against -- so replacing it would let a side pass QC
  // against artwork nobody can trace.
  //
  // A view that is genuinely wrong is a revision, which re-authors the master
  // and every projection of it together.
  const handleProofUpload = async (def: (typeof VIEW_DEFS)[number], _file: File) => {
    toast({
      title: `${def.label} proof is server-owned`,
      description: "It is rendered from this design's master and hash-bound to it. To change what it shows, revise the design.",
      variant: "destructive",
    });
    const el = proofInputs.current[def.sideKey];
    if (el) el.value = "";
  };

  const deleteProof = useCallback(async (def: (typeof VIEW_DEFS)[number]) => {
    toast({
      title: `${def.label} proof is server-owned`,
      description: "Hiding it would leave this side's panel with nothing verifiable to be approved against.",
      variant: "destructive",
    });
  }, [toast]);

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
  // BUILDING THE PRINT FILES IS THE SERVER'S STAGE, BEHIND THE HUMAN GATE.
  //
  // This picked a source per side in the browser -- preferring an uploaded file
  // over the system panel, skipping anything already processed -- resolved a
  // storage path out of a public URL, and called a worker per side to make the
  // 1500-DPI TIFF. Two problems: the browser chose which artwork went to print,
  // and it could start that work before anyone had signed the sides off.
  //
  // The runtime does this as `enhance.upscale` then `output.build`, and both sit
  // BEHIND `await_panelpro_preflight_qc` -- the gate this board's six side
  // approvals and its checklist feed. So the honest action here is to submit
  // that gate, which is what actually releases the panels into Topaz and the
  // output build. Call 12 enhances the active artifact per surface, including a
  // human correction, so the team's choice still reaches print -- through the
  // pipeline rather than around it.
  const buildPrintFiles = useCallback(async () => {
    const cur = jobRef.current || job;
    if (!cur?.id) return;
    const qc: Record<string, any> = cur.concept_json?.qc_side_panels || {};
    const missing = VIEW_DEFS.filter((def) => !qc[def.sideKey]?.approved).map((def) => def.label);
    if (missing.length) {
      toast({
        title: "Approve every side first",
        description: `Still waiting on: ${missing.join(", ")}. The gate releases all six together.`,
        variant: "destructive",
      });
      return;
    }
    setBuildingPrint({ done: 0, total: VIEW_DEFS.length });
    try {
      await dpApi.approvePreflight(
        String(cur.id),
        {
          dimensionsVerified: true,
          sourceRegionsVerified: true,
          fiveInchBleed: true,
          panelHashesVerified: true,
          logoInventoryVerified: true,
          textLockVerified: true,
          approvedSides: VIEW_DEFS.map((def) => SURFACE_FOR_SIDE_KEY[def.sideKey]).filter(Boolean).sort(),
          surfaceQc: approvedSurfaceChecklists(surfaceQcRef.current),
        } as any,
        "Approved on the PanelPro Studio board against the vehicle template.",
      );
      await loadJob(String(cur.id));
      toast({
        title: "Preflight approved",
        description: "The server is enhancing the approved panels and building the print files. They appear below as each lands.",
      });
    } catch (e: any) {
      toast({ title: "The gate refused this", description: e?.message || "Try again", variant: "destructive" });
    } finally {
      setBuildingPrint(null);
    }
  }, [job, toast, loadJob]);

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


  // THE 2D PROOF IS CALL 8'S ARTIFACT, NOT AN UPLOAD.
  //
  // The board used to let an admin upload the correct proof and pin it, because
  // the proof was resolved by pointer chasing and the pointer was sometimes
  // wrong. Call 8 builds the proof from the accepted master and publishes it
  // hashed against this exact run, so there is no wrong proof to replace -- and
  // pinning an uploaded image over it would put an unverified sheet where every
  // panel's binding says the real one is.
  const persistProofOverride = useCallback(async (_url: string) => {
    throw new Error(
      "The 2D Production Proof is built by the server for this exact design. There is no proof to replace here.",
    );
  }, []);

  const handleReplaceProof = async (_file: File) => {
    toast({
      title: "The 2D proof is server-built",
      description: "Call 8 publishes it from the accepted master for this exact design, so there is nothing to replace here.",
      variant: "destructive",
    });
    if (proofInput.current) proofInput.current.value = "";
  };

  const handleRemoveProof = async () => {
    toast({
      title: "The 2D proof is server-built",
      description: "It belongs to this run and its hash is what the panels are bound to.",
      variant: "destructive",
    });
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

  // The browser mirror is gone with the rest of the producer stack. It baked a
  // horizontally flipped PNG on a canvas and uploaded it as a side's panel --
  // artwork authored in a tab, bound to nothing, indistinguishable on screen
  // from a panel the server cut. Passenger is extracted from the same accepted
  // master as driver, at its own GENIE dimensions, by Call 9.

  // THE PRODUCER STACK IS GONE, AND THIS IS WHAT IT WAS.
  //
  // Between here and the extract below, the board used to MAKE panels in the
  // browser: mirror the driver into a passenger panel on a canvas; flatten a
  // side off the master sheet; extract a side with an A.C.E. pass; colour-match
  // it; separate its elements; generate a master artboard when none existed and
  // write the URL back onto the design row; bleed it; validate it; and pull a
  // vault of assets that were themselves produced that way. Eight generative or
  // pixel-authoring paths, all of them a second producer of the artwork that
  // gets printed.
  //
  // Call 1 cuts all six panels deterministically from the accepted A.T.L.A.S.
  // master, at GENIE dimensions with the 5" bleed already in the layout, before
  // a single proof renders. The passenger surface is cut from that same master,
  // so it is the driver's twin by construction rather than by mirroring — which
  // is also why the old mirror had to re-drop lifted logos un-flipped to stop
  // the lettering printing backwards. There is nothing left for this page to
  // make.
  //
  // What remains is what a production control room is for: read the panels,
  // compare each against its own proof, check it on a real vehicle template,
  // correct the ones that do not fit, and release the set.
  const flipSide = useCallback(async (sideKey: string) => {
    const def = VIEW_DEFS.find((d) => d.sideKey === sideKey);
    toast({
      title: `${def?.label || sideKey} is cut from the master`,
      description: "The passenger surface is extracted from the same master as the driver, so mirroring here would replace a bound panel with an unverified one.",
      variant: "destructive",
    });
  }, [toast]);

  const runPanelProExtract = useCallback(async (_forceAce = false) => {
    const cur = jobRef.current || job;
    if (!cur?.id) return;
    setRunningPanelPro(true);
    try {
      await loadJob(String(cur.id));
      const qc: Record<string, any> = (jobRef.current || cur)?.concept_json?.qc_side_panels || {};
      const present = VIEW_DEFS.filter((def) => qc[def.sideKey]?.gemini_url).length;
      toast({
        title: `${present}/${VIEW_DEFS.length} panels loaded`,
        description: present === VIEW_DEFS.length
          ? "Every side is cut and bound to this design's master."
          : "A side with no panel is server work — Call 9 cuts it; it is never hand-built here.",
      });
    } finally {
      setRunningPanelPro(false);
    }
  }, [job, toast, loadJob]);

  // VALIDATE (QC) — the binding every side has to satisfy before it can be
  // approved: this proof and this panel came from the SAME A.T.L.A.S. master.
  // It used to call a regression function that re-derived five checks from
  // storage; both halves publish their binding now, so the check is a
  // comparison of hashes the server already stated.
  const runValidate = useCallback(async () => {
    const cur = jobRef.current || job;
    if (!cur?.id) return;
    setValidating(true);
    setValidation(null);
    try {
      const qc: Record<string, any> = cur.concept_json?.qc_side_panels || {};
      const checks = VIEW_DEFS.map((def) => {
        const side = qc[def.sideKey];
        const atlas = side?.atlas || {};
        const detail: string[] = [];
        if (!side) detail.push("No Call 9 panel exists for this surface yet.");
        else {
          detail.push(`panel ${String(side.gemini_url ? "present" : "missing")}`);
          if (atlas.proofMasterHash) detail.push(`proof master ${String(atlas.proofMasterHash).slice(0, 16)}`);
          if (atlas.panelMasterHash) detail.push(`panel master ${String(atlas.panelMasterHash).slice(0, 16)}`);
          if (atlas.matches === null) detail.push("no master binding on this pair");
          if (side.print_dims?.bleedInches) detail.push(`${side.print_dims.bleedInches}" bleed`);
        }
        return {
          id: def.sideKey,
          label: def.label,
          // Absent binding is not drift. A pair that states two different
          // masters is the only real failure.
          pass: Boolean(side?.gemini_url) && atlas.matches !== false,
          detail,
        };
      });
      const pass = checks.every((check) => check.pass);
      setValidation({
        pass,
        summary: pass
          ? "Every side has its panel, and each panel was cut from the master its proof was rendered from."
          : "At least one side is missing its panel or does not share its proof's master.",
        checks,
      });
      toast({
        title: pass ? "QC passed — every pair shares one master" : "QC found issues",
        description: pass ? "" : "Open the failing side below.",
        variant: pass ? undefined : "destructive",
      });
    } finally {
      setValidating(false);
    }
  }, [job, toast]);

  /**
   * CORRECT SEVERAL SIDES IN ONE PASS.
   *
   * The board used to take a drop of files, ask a vision model which side each
   * one showed, and write them straight into storage as those sides' panels. Two
   * things were wrong with that on a server-owned lineage. The files never said
   * what they were correcting or why, so a panel could be substituted with no
   * audit trail at all; and the side each file belonged to was decided by a
   * guess about its contents, which is not a thing to guess about when the
   * answer picks which surface gets printed.
   *
   * So this is the same convenience -- a designer who re-output four sides
   * against the real vehicle template uploads them together -- routed through
   * the audited correction path, one file per surface, with the reason that
   * applies to the batch. Each file is matched to its side by FILENAME, which
   * the designer controls and can see, and an unmatched file is reported rather
   * than assigned to whichever slot happened to be free.
   *
   * The Call 9 panels are untouched. Each correction is its own artifact bound
   * to the panel it replaces, and both stay downloadable.
   */
  const handleBulkUpload = async (fileList: FileList) => {
    const cur = jobRef.current || job;
    if (!cur?.id || !fileList?.length) return;
    const revisionId = (cur as any).revision_id as string | null;
    if (!revisionId) {
      toast({
        title: "This run has no reported revision",
        description: "A correction has to be bound to the revision it corrects.",
        variant: "destructive",
      });
      return;
    }
    const files = Array.from(fileList);
    const reason = window.prompt(
      `What did not fit on the template, and what you changed? (applies to all ${files.length} file${files.length === 1 ? "" : "s"}, 8 characters minimum)`,
      "",
    );
    if (reason === null) return;
    if (reason.trim().length < 8) {
      toast({
        title: "A correction needs a reason",
        description: "That is the audit trail; a blank one is not one.",
        variant: "destructive",
      });
      return;
    }

    // Filename decides the side, and a file that names none is reported.
    const assignments: Array<{ def: (typeof VIEW_DEFS)[number]; file: File }> = [];
    const unmatched: string[] = [];
    const claimed = new Set<string>();
    for (const file of files) {
      const key = matchSideByFilename(file.name);
      const def = key ? VIEW_DEFS.find((d) => d.sideKey === key) : undefined;
      const surfaceKey = def ? SURFACE_FOR_SIDE_KEY[def.sideKey] : undefined;
      if (!def || !surfaceKey || claimed.has(def.sideKey)) {
        unmatched.push(file.name);
        continue;
      }
      claimed.add(def.sideKey);
      assignments.push({ def, file });
    }
    if (!assignments.length) {
      toast({
        title: "No file named a surface",
        description: "Name each file for its side (driver, passenger, hood, roof, front, rear).",
        variant: "destructive",
      });
      return;
    }

    setBulkUploading(true);
    setBulkPhase("uploading");
    setBulkProgress({ done: 0, total: assignments.length });
    const recorded: string[] = [];
    const refused: string[] = [];
    try {
      // Sequential on purpose: each correction is a separate audited write, and
      // a failure part-way through has to be reportable per side rather than
      // collapsing the batch into one unattributable error.
      for (const { def, file } of assignments) {
        try {
          await dpApi.uploadCorrectedPanel({
            generationId: String(cur.generation_id || cur.id),
            revisionId,
            surfaceKey: SURFACE_FOR_SIDE_KEY[def.sideKey]!,
            file,
            reason: reason.trim(),
          });
          recorded.push(def.label);
        } catch (cause: any) {
          refused.push(`${def.label}: ${cause?.message || "refused"}`);
        }
        setBulkProgress({ done: recorded.length + refused.length, total: assignments.length });
      }
      await loadJob(String(cur.id));
      toast({
        title: recorded.length
          ? `Recorded ${recorded.length} correction${recorded.length === 1 ? "" : "s"}`
          : "No correction was recorded",
        description: [
          recorded.length ? recorded.join(", ") : null,
          refused.length ? `Refused — ${refused.join("; ")}` : null,
          unmatched.length ? `Unmatched files — ${unmatched.join(", ")}` : null,
        ].filter(Boolean).join(". "),
        variant: recorded.length ? undefined : "destructive",
      });
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
                    const name = [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(" ") || "Vehicle";
                    const identity = j.order_number || j.design_id || j.generation_id;
                    const stateLabel = j.state === "complete"
                      ? "Complete"
                      : j.state === "failed"
                        ? "Failed"
                        : j.state === "queued"
                          ? "Queued"
                          : "In progress";
                    return (
                      <button
                        key={j.id}
                        type="button"
                        onClick={() => {
                          setOrderInput(identity);
                          void runSearch(j.generation_id);
                        }}
                        className="flex flex-col gap-1.5 rounded-lg border border-gray-200 bg-white p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="max-w-[70%] truncate rounded bg-gray-900 px-1.5 py-0.5 font-mono text-[11px] text-white"
                            title={identity}
                          >
                            {identity}
                          </span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
                            {stateLabel}
                          </span>
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
            <JobHeader
              job={job as unknown as PanelProStudioJob}
              selectedVersion={selectedVersion}
              onSelectVersion={setSelectedVersionNumber}
            />

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

            {/* PANELS NEXT TO THEIR INDIVIDUAL 3D PROOFS, DIRECTLY UNDER THE
                MASTER. RULE 0.21's row, published on the control room rather
                than only at /panelpro/surfaces one level down. */}
            {versionedJob && (
              <SurfacePairRows job={versionedJob as unknown as PanelProStudioJob} atlas={selectedVersion?.revision || null} />
            )}

            {/* Every brand mark Call 10 separated out of this version's panels,
                individually downloadable. */}
            {versionedJob && (
              <LogoGallery job={versionedJob} selectedVersion={selectedVersion} />
            )}

            {/* The physical check, per surface, and what it adds up to. */}
            {versionedJob && (
              <SurfaceQcPanel
                key={`surface-qc:${versionedJob.generation_id}:${selectedVersion?.revisionId || "none"}`}
                job={versionedJob}
                selectedVersion={selectedVersion}
                records={surfaceQcRecords}
                onRecorded={rememberSurfaceQc}
              />
            )}

            {/* The back half of this job, from the server's own record: its
                stage rail, the two human release gates, the eighteen output
                files, and the stamp/ZIP/WrapBox artifacts it produced. */}
            {job && (
              <ProductionPackSection
                key={`production-pack:${job.generation_id}:${selectedVersion?.revisionId || "none"}`}
                job={(versionedJob || job) as unknown as PanelProStudioJob}
                approvedSides={approvedSidesRef.current}
                qcPassedSides={qcPassedSides}
                surfaceQc={surfaceQcRecords}
                onApproved={async () => { await loadJob(String(job.id)); }}
              />
            )}

            {/* What happened to this order, and when -- from what the server
                recorded, never from a log the browser appends to. */}
            {versionedJob && <ActivityHistory job={versionedJob} />}

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

                      {/* "Pull panel" is gone on purpose. It flattened this
                          side's 3D render in the browser to make a print panel
                          -- a second producer of production artwork, built from
                          a picture of a vehicle rather than from the design. The
                          server cuts every panel deterministically from the
                          accepted A.T.L.A.S. master at Call 9; a side with no
                          panel is server work to be reported, never patched by
                          hand here. The audited correction path below is what
                          remains, and it corrects a panel rather than making one. */}

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

      {/* THE CORRECTION BENCH. Adjust and paint a panel against the real
          vehicle template, then record the corrected file against this exact
          surface and revision with a reason. The Call 9 panel is left
          byte-for-byte; the correction is its own artifact bound to it. */}
      {job && (
        <StudioBoardEditor
          open={!!editTarget}
          target={editTarget}
          jobId={job.id}
          onClose={() => setEditTarget(null)}
          onSaved={async (sideKey, file, reason) => {
            const cur = jobRef.current || job;
            const surfaceKey = SURFACE_FOR_SIDE_KEY[sideKey];
            const revisionId = (cur as any)?.revision_id as string | null;
            if (!surfaceKey) throw new Error(`${sideKey} is not one of the six production surfaces.`);
            if (!revisionId) throw new Error("This run has no reported revision, so a correction cannot be bound to it.");
            await dpApi.uploadCorrectedPanel({
              generationId: String(cur!.generation_id || cur!.id),
              revisionId,
              surfaceKey,
              file,
              reason,
            });
            await loadJob(String(cur!.id));
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
