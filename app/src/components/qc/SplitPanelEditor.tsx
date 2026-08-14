/**
 * SplitPanelEditor — adjustable-box panel splitter.
 *
 * Auto-detect a first pass of panel boxes (OpenAI), let the operator drag /
 * resize / rename each box on top of the proof, then export each as its own
 * deterministic crop (300 DPI TIFF + PNG) via /api/extract-panels.
 *
 * Boxes are stored as normalized fractions (0..1) of the image so they survive
 * any modal size; the exporter accepts fractional coords directly.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Scissors, Plus, Trash2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const PANEL_NAMES = ["driver_side", "passenger_side", "roof", "front", "rear", "hood"];

interface Box {
  id: string;
  name: string;
  xPct: number; yPct: number; wPct: number; hPct: number; // 0..1 of image
  realWidthIn?: number;
  realHeightIn?: number;
}

/** GENIE Universal Panelizer output (panelizer_jobs.panels) — the real
 *  per-vehicle dimensions for this job. */
interface GeniePanel { panelKey?: string; label?: string; widthInches?: number; heightInches?: number }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageUrl: string | null;
  orderNumber?: string | null;
  userId?: string | null;
  /** GENIE panel dimensions for this job — used for the cover-fit aspect. */
  geniePanels?: GeniePanel[] | null;
  onExported: (result: any) => void;
}

const uid = () => `b_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
const slugName = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function SplitPanelEditor({ open, onOpenChange, imageUrl, orderNumber, userId, geniePanels, onExported }: Props) {
  // Match a box name (driver_side, roof, …) to its GENIE panel and return the
  // real-world inches, so the export cover-fits to the true per-vehicle aspect.
  const geniePanelDims = (boxName: string): { w: number; h: number } | null => {
    if (!Array.isArray(geniePanels)) return null;
    const want = slugName(boxName);
    for (const p of geniePanels) {
      if (!p?.widthInches || !p?.heightInches) continue;
      const key = slugName(p.panelKey || p.label || "");
      if (key && (key === want || key.includes(want) || want.includes(key))) return { w: p.widthInches, h: p.heightInches };
    }
    return null;
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 500 });
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [detecting, setDetecting] = useState(false);
  const [exporting, setExporting] = useState(false);
  // Operator-supplied source (upload or pasted URL) — overrides the job's
  // saved proof so you can split YOUR clean artwork, never a regenerated one.
  const [localSrc, setLocalSrc] = useState<string | null>(null);   // for display
  const [localB64, setLocalB64] = useState<string | null>(null);   // for the API (uploaded file)
  const [urlInput, setUrlInput] = useState("");
  const [uploading, setUploading] = useState(false);
  // Active drag/resize interaction.
  const drag = useRef<null | { id: string; mode: "move" | "resize"; startX: number; startY: number; box: Box }>(null);

  const displayUrl = localSrc || imageUrl;
  const sourceBody = (): Record<string, unknown> =>
    localB64 ? { image_base64: localB64 } : { image_url: localSrc || imageUrl };

  // Upload the chosen file to storage and use its URL (not base64 in the
  // request body — Vercel caps the body at ~4.5MB and a proof exceeds it).
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBoxes([]); setImgLoaded(false); setImgError(false); setLocalB64(null);
    setLocalSrc(URL.createObjectURL(file)); // instant preview
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `panels/split-source/${userId || "anon"}/${Date.now()}_src.${ext}`;
      const { error } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type || "image/png", upsert: true });
      if (error) throw error;
      const { data } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 7);
      if (data?.signedUrl) setLocalSrc(data.signedUrl);
      else throw new Error("could not sign uploaded file");
    } catch (err: any) {
      toast.error("Upload failed: " + (err?.message || err));
      setLocalSrc(null);
    } finally {
      setUploading(false);
    }
  }
  function useUrl() {
    const u = urlInput.trim();
    if (!u) return;
    setBoxes([]); setImgLoaded(false); setImgError(false);
    setLocalB64(null);
    setLocalSrc(u);
  }

  useEffect(() => {
    if (!open) { setBoxes([]); setImgLoaded(false); setImgError(false); setLocalSrc(null); setLocalB64(null); setUrlInput(""); }
  }, [open, imageUrl]);

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const el = containerRef.current;
    const measure = () => { const r = el.getBoundingClientRect(); setContainerSize({ width: r.width, height: r.height }); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open]);

  const aspect = imgRef.current && imgLoaded
    ? imgRef.current.naturalWidth / imgRef.current.naturalHeight
    : 16 / 9;

  // Letterbox the image inside the container.
  const imgRect = useMemo(() => {
    const cW = containerSize.width, cH = containerSize.height;
    let w = cW, h = cW / aspect;
    if (h > cH) { h = cH; w = cH * aspect; }
    return { x: (cW - w) / 2, y: (cH - h) / 2, w, h };
  }, [containerSize, aspect]);

  function pointerToPct(e: React.PointerEvent) {
    const rect = containerRef.current!.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    return { x: (sx - imgRect.x) / imgRect.w, y: (sy - imgRect.y) / imgRect.h };
  }

  function onBoxPointerDown(e: React.PointerEvent, box: Box, mode: "move" | "resize") {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = pointerToPct(e);
    drag.current = { id: box.id, mode, startX: p.x, startY: p.y, box: { ...box } };
  }
  // Draw a brand-new box by dragging on empty area of the proof.
  function onCanvasPointerDown(e: React.PointerEvent) {
    if (!imgLoaded) return;
    const p = pointerToPct(e);
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const id = uid();
    const nb: Box = { id, name: nextName(), xPct: p.x, yPct: p.y, wPct: 0.01, hPct: 0.01 };
    setBoxes((prev) => [...prev, nb]);
    drag.current = { id, mode: "resize", startX: p.x, startY: p.y, box: { ...nb, wPct: 0, hPct: 0 } };
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const p = pointerToPct(e);
    const dx = p.x - drag.current.startX, dy = p.y - drag.current.startY;
    const b = drag.current.box;
    setBoxes((prev) => prev.map((bx) => {
      if (bx.id !== drag.current!.id) return bx;
      if (drag.current!.mode === "move") {
        return { ...bx, xPct: clamp(b.xPct + dx, 0, 1 - bx.wPct), yPct: clamp(b.yPct + dy, 0, 1 - bx.hPct) };
      }
      return { ...bx, wPct: clamp(b.wPct + dx, 0.02, 1 - bx.xPct), hPct: clamp(b.hPct + dy, 0.02, 1 - bx.yPct) };
    }));
  }
  function onPointerUp(e: React.PointerEvent) {
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    // Drop a freshly-drawn box that never got a real size (a stray click).
    if (drag.current) {
      const id = drag.current.id;
      setBoxes((prev) => prev.filter((b) => b.id !== id || (b.wPct >= 0.02 && b.hPct >= 0.02)));
    }
    drag.current = null;
  }

  const nextName = () => PANEL_NAMES.find((n) => !boxes.some((b) => b.name === n)) || "driver_side";
  function addBox() {
    setBoxes((p) => [...p, { id: uid(), name: nextName(), xPct: 0.1, yPct: 0.1, wPct: 0.4, hPct: 0.25 }]);
  }
  function removeBox(id: string) { setBoxes((p) => p.filter((b) => b.id !== id)); }
  function renameBox(id: string, name: string) { setBoxes((p) => p.map((b) => (b.id === id ? { ...b, name } : b))); }

  async function authToken(): Promise<string | null> {
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  }

  async function autoDetect() {
    if (!displayUrl) return;
    setDetecting(true);
    try {
      const token = await authToken();
      if (!token) { toast.error("Sign in first."); return; }
      const res = await fetch("/api/extract-panels", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...sourceBody(), detect_only: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Detect failed (${res.status})`);
      const W = data.imageWidth || 1, H = data.imageHeight || 1;
      const detectedBoxes: Box[] = (data.panels || []).map((p: any) => ({
        id: uid(),
        name: p.name,
        xPct: p.x / W, yPct: p.y / H, wPct: p.width / W, hPct: p.height / H,
        realWidthIn: p.realWidthIn, realHeightIn: p.realHeightIn,
      }));
      if (!detectedBoxes.length) { toast.info("No panels auto-detected — add boxes manually."); return; }
      setBoxes(detectedBoxes);
      toast.success(`Detected ${detectedBoxes.length} panel${detectedBoxes.length > 1 ? "s" : ""} — adjust and export.`);
    } catch (e: any) {
      toast.error(e.message || "Auto-detect failed");
    } finally {
      setDetecting(false);
    }
  }

  async function exportPanels() {
    if (!displayUrl || boxes.length === 0) { toast.error("Add at least one panel box."); return; }
    setExporting(true);
    try {
      const token = await authToken();
      if (!token) { toast.error("Sign in first."); return; }
      const panels = boxes.map((b) => {
        // Prefer GENIE's real per-vehicle dimensions; fall back to any dims the
        // box already carries (e.g. from auto-detect reading the proof).
        const g = geniePanelDims(b.name);
        const rw = g?.w ?? b.realWidthIn;
        const rh = g?.h ?? b.realHeightIn;
        return {
          name: b.name,
          x: b.xPct, y: b.yPct, width: b.wPct, height: b.hPct,
          ...(rw ? { realWidthIn: rw } : {}),
          ...(rh ? { realHeightIn: rh } : {}),
        };
      });
      const res = await fetch("/api/extract-panels", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ ...sourceBody(), order_number: orderNumber || undefined, user_id: userId || undefined, panels }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Export failed (${res.status})`);
      onExported(data);
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Export failed");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] lg:max-w-6xl h-[90vh] flex flex-col p-4 bg-zinc-950 border-zinc-800">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-white">
            <Scissors className="w-5 h-5 text-cyan-400" /> Split to Panel Files
            <span className="ml-auto text-[11px] text-zinc-400 font-normal">Auto-detect, drag to adjust, export one file per side</span>
          </DialogTitle>
        </DialogHeader>

        {/* Source: upload / paste your CLEAN proof (recommended) — splitting
            copies exact pixels, so whatever you load is what prints. */}
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[11px] text-zinc-300 inline-flex items-center gap-1.5 px-2 py-1 rounded border border-zinc-700 hover:border-cyan-500 cursor-pointer">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} {uploading ? "Uploading…" : "Upload clean proof"}
            <input type="file" accept="image/*" className="hidden" onChange={onFile} disabled={uploading} />
          </label>
          <input
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") useUrl(); }}
            placeholder="…or paste an image URL"
            className="flex-1 min-w-[160px] bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-200 outline-none focus:border-cyan-500"
          />
          <Button size="sm" variant="outline" onClick={useUrl} disabled={!urlInput.trim()} className="text-[11px]">Use URL</Button>
          {localSrc && <span className="text-[10px] text-cyan-300">using your image</span>}
        </div>

        <div className="flex items-center gap-2 mt-1">
          <Button size="sm" variant="outline" onClick={autoDetect} disabled={detecting || exporting || !imgLoaded} className="gap-1.5">
            {detecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />} Auto-detect
          </Button>
          <Button size="sm" variant="outline" onClick={addBox} disabled={exporting || !imgLoaded} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" /> Add box
          </Button>
          <span className="text-[11px] text-zinc-500">{boxes.length} panel{boxes.length === 1 ? "" : "s"}</span>
          <Button size="sm" onClick={exportPanels} disabled={exporting || boxes.length === 0}
            className="ml-auto gap-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white">
            {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
            Export {boxes.length || ""} file{boxes.length === 1 ? "" : "s"}
          </Button>
        </div>

        {displayUrl ? (
          <div className="relative flex-1 min-h-[400px] rounded-lg overflow-hidden border border-zinc-800 bg-zinc-900 mt-2">
            <div
              ref={containerRef}
              className="relative w-full h-full"
              style={{ touchAction: "none", cursor: imgLoaded ? "crosshair" : "default" }}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <img
                ref={imgRef}
                src={displayUrl}
                alt="proof"
                onLoad={() => { setImgLoaded(true); setImgError(false); }}
                onError={() => { setImgError(true); setImgLoaded(false); }}
                draggable={false}
                style={{ position: "absolute", left: imgRect.x, top: imgRect.y, width: imgRect.w, height: imgRect.h, userSelect: "none", pointerEvents: "none" }}
              />
              {imgLoaded && boxes.map((b) => {
                const left = imgRect.x + b.xPct * imgRect.w;
                const top = imgRect.y + b.yPct * imgRect.h;
                const width = b.wPct * imgRect.w;
                const height = b.hPct * imgRect.h;
                return (
                  <div
                    key={b.id}
                    onPointerDown={(e) => onBoxPointerDown(e, b, "move")}
                    className="absolute border-2 border-cyan-400 bg-cyan-400/10 cursor-move rounded-sm"
                    style={{ left, top, width, height }}
                  >
                    <div className="absolute -top-7 left-0 flex items-center gap-1 bg-black/80 rounded px-1 py-0.5" onPointerDown={(e) => e.stopPropagation()}>
                      <select
                        value={b.name}
                        onChange={(e) => renameBox(b.id, e.target.value)}
                        className="bg-transparent text-cyan-200 text-[10px] outline-none"
                      >
                        {PANEL_NAMES.map((n) => <option key={n} value={n} className="bg-zinc-900">{n.replace(/_/g, " ")}</option>)}
                      </select>
                      <button onClick={() => removeBox(b.id)} className="text-red-300 hover:text-red-200"><Trash2 className="w-3 h-3" /></button>
                    </div>
                    {/* resize handle */}
                    <div
                      onPointerDown={(e) => onBoxPointerDown(e, b, "resize")}
                      className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-cyan-300 rounded-sm cursor-nwse-resize border border-black/40"
                    />
                  </div>
                );
              })}
              {!imgLoaded && !imgError && (
                <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" /> Loading proof…
                </div>
              )}
              {imgError && (
                <div className="absolute inset-0 flex items-center justify-center text-red-300 text-sm px-6 text-center">
                  Couldn't load the proof image. Generate/save a 2D proof first.
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm text-center px-6">Upload your clean proof (or paste a URL) above to split it into per-side files.</div>
        )}

        <p className="text-[10px] text-amber-400/80 mt-1 leading-snug">
          Boxes are cropped exactly as drawn (no AI redraw — text/logos stay exact). Verify each on the vector template before final print.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

export default SplitPanelEditor;
