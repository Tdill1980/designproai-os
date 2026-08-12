import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Plus, Download, X, Sparkles, Layers } from "lucide-react";
import { toast } from "sonner";

/**
 * SidePanelBoxes — draw a frosted-glass box around each side on a render, then
 * crop that exact region and have flat-panel-openai "fill" it into a flat print
 * panel at that side's exact real-world size. Self-contained so it can drop into
 * Revision Studio now and QC Artboard later.
 */

const SIDES = [
  { key: "driver_side", label: "Driver Side", inches: "227 × 76.4 in" },
  { key: "passenger_side", label: "Passenger Side", inches: "227 × 76.4 in" },
  { key: "roof", label: "Roof", inches: "227 × 81.1 in" },
  { key: "hood", label: "Hood", inches: "68 × 40 in" },
  { key: "front", label: "Front", inches: "18.1 × 17.5 in" },
  { key: "rear", label: "Rear", inches: "18.1 × 88.3 in" },
];
const FINISHES = ["Gloss", "Matte", "Satin"];

type BoxStatus = "idle" | "working" | "done" | "error";
interface SideBox {
  id: string;
  side: string;
  x: number; y: number; w: number; h: number; // fractions of the image
  status: BoxStatus;
  resultUrl?: string;
  error?: string;
}

async function blobDownload(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(obj), 5000);
  } catch { window.open(url, "_blank"); }
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  imageUrl: string | null;
  userId: string | null;
  finish?: string | null;
  /** Actual per-side dimensions (inches) from the job's GENIE panels, keyed by
   *  side key (driver_side, passenger_side, roof, hood, front, rear). When
   *  present these override the generic constants so the AI fills at the real
   *  vehicle size. */
  panelDims?: Record<string, { w: number; h: number }> | null;
}

export function SidePanelBoxes({ open, onOpenChange, imageUrl, userId, finish, panelDims }: Props) {
  const [boxes, setBoxes] = useState<SideBox[]>([]);
  const [finishSel, setFinishSel] = useState(finish && FINISHES.includes(finish) ? finish : "Gloss");
  const stageRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const drag = useRef<{ id: string; mode: "move" | "resize"; sx: number; sy: number; bx: number; by: number; bw: number; bh: number } | null>(null);

  const nextSide = () => SIDES.find((s) => !boxes.some((b) => b.side === s.key))?.key || "driver_side";

  const addBox = () => {
    const side = nextSide();
    setBoxes((bs) => [...bs, { id: `box_${Date.now().toString(36)}`, side, x: 0.1, y: 0.3, w: 0.4, h: 0.25, status: "idle" }]);
  };
  const removeBox = (id: string) => setBoxes((bs) => bs.filter((b) => b.id !== id));
  const setSide = (id: string, side: string) => setBoxes((bs) => bs.map((b) => b.id === id ? { ...b, side } : b));

  const onPointerDown = (id: string, mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const b = boxes.find((x) => x.id === id)!;
    drag.current = { id, mode, sx: e.clientX, sy: e.clientY, bx: b.x, by: b.y, bw: b.w, bh: b.h };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.sx) / rect.width;
    const dy = (e.clientY - drag.current.sy) / rect.height;
    const d = drag.current;
    setBoxes((bs) => bs.map((b) => {
      if (b.id !== d.id) return b;
      if (d.mode === "move") return { ...b, x: Math.min(1 - b.w, Math.max(0, d.bx + dx)), y: Math.min(1 - b.h, Math.max(0, d.by + dy)) };
      return { ...b, w: Math.min(1 - b.x, Math.max(0.05, d.bw + dx)), h: Math.min(1 - b.y, Math.max(0.05, d.bh + dy)) };
    }));
  };
  const onPointerUp = () => { drag.current = null; };

  // Crop the box region from the source render (small image — safe in-browser).
  async function cropBox(box: SideBox): Promise<Blob> {
    const img = imgElRef.current;
    if (!img) throw new Error("image not loaded");
    const iw = img.naturalWidth, ih = img.naturalHeight;
    const sx = Math.round(box.x * iw), sy = Math.round(box.y * ih);
    const sw = Math.max(1, Math.round(box.w * iw)), sh = Math.max(1, Math.round(box.h * ih));
    const canvas = document.createElement("canvas");
    canvas.width = sw; canvas.height = sh;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
  }

  async function fillBox(box: SideBox) {
    if (!userId) { toast.error("Sign in required"); return; }
    setBoxes((bs) => bs.map((b) => b.id === box.id ? { ...b, status: "working", error: undefined } : b));
    try {
      const blob = await cropBox(box);
      const path = `uploads/side-box-crops/${userId}/${Date.now()}_${box.side}.png`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, blob, { contentType: "image/png", upsert: true });
      if (upErr) throw new Error("Upload failed: " + upErr.message);
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);

      const real = panelDims?.[box.side];
      const { data, error } = await renderClient.functions.invoke("flat-panel-openai", {
        body: {
          imageUrl: publicUrl, side: box.side, finish: finishSel, upscale: true, noWheels: true,
          ...(real ? { widthIn: real.w, heightIn: real.h } : {}),
        },
      });
      if (error) throw new Error(error.message || "generation failed");
      if (!data?.success) throw new Error(data?.error || "generation failed");
      setBoxes((bs) => bs.map((b) => b.id === box.id ? { ...b, status: "done", resultUrl: data.url } : b));
      toast.success(`${SIDES.find((s) => s.key === box.side)?.label} panel filled`);
    } catch (e: any) {
      setBoxes((bs) => bs.map((b) => b.id === box.id ? { ...b, status: "error", error: e?.message || "failed" } : b));
      toast.error(e?.message || "Failed to fill panel");
    }
  }

  const fillAll = async () => {
    for (const b of boxes) { if (b.status !== "done") await fillBox(b); }
  };

  const sideMeta = (k: string) => SIDES.find((s) => s.key === k);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-cyan-400" /> Side Panel Boxes → Fill
          </DialogTitle>
        </DialogHeader>

        {!imageUrl ? (
          <p className="text-sm text-muted-foreground py-8 text-center">No render selected.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={addBox} disabled={boxes.length >= SIDES.length}>
                <Plus className="w-4 h-4" /> Add side box
              </Button>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Finish</span>
                <Select value={finishSel} onValueChange={setFinishSel}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                  <SelectContent>{FINISHES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              {boxes.length > 0 && (
                <Button size="sm" className="gap-1.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white ml-auto"
                  onClick={fillAll} disabled={boxes.some((b) => b.status === "working")}>
                  <Sparkles className="w-4 h-4" /> Fill all panels
                </Button>
              )}
            </div>

            {/* Stage: render with draggable glassmorphism side boxes */}
            <div
              ref={stageRef}
              className="relative w-full rounded-lg overflow-hidden border border-border bg-black/30 select-none touch-none"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
            >
              <img
                ref={imgElRef}
                src={imageUrl}
                crossOrigin="anonymous"
                alt="render"
                className="w-full block pointer-events-none"
                draggable={false}
              />
              {boxes.map((b) => (
                <div
                  key={b.id}
                  className="absolute rounded-lg border-2 border-cyan-300/70 backdrop-blur-md bg-white/10 shadow-[inset_0_0_24px_rgba(255,255,255,0.18)] cursor-move"
                  style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` }}
                  onPointerDown={onPointerDown(b.id, "move")}
                >
                  <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-cyan-500/90 text-black text-[10px] font-semibold pointer-events-none">
                    {sideMeta(b.side)?.label}
                  </span>
                  {b.status === "working" && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <Loader2 className="w-5 h-5 animate-spin text-cyan-300" />
                    </div>
                  )}
                  {b.status === "done" && <span className="absolute top-1 right-6 text-[10px] text-emerald-300 font-semibold pointer-events-none">✓</span>}
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeBox(b.id); }}
                    className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center"
                  >
                    <X className="w-2.5 h-2.5 text-white" />
                  </button>
                  <div
                    className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-sm bg-cyan-400 cursor-nwse-resize"
                    onPointerDown={onPointerDown(b.id, "resize")}
                  />
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">
              Draw a box matching each side's panel shape, pick the side, then Fill — the AI sees the exact
              cropped shape and renders it as a flat panel at that side's real size.
            </p>

            {/* Per-box controls + results */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {boxes.map((b) => (
                <div key={b.id} className="border border-border rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Select value={b.side} onValueChange={(v) => setSide(b.id, v)}>
                      <SelectTrigger className="h-8 flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>{SIDES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}</SelectContent>
                    </Select>
                    <Button size="sm" className="gap-1.5" onClick={() => fillBox(b)} disabled={b.status === "working"}>
                      {b.status === "working" ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      Fill
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Exact size: {panelDims?.[b.side] ? `${panelDims[b.side].w} × ${panelDims[b.side].h} in (this vehicle)` : sideMeta(b.side)?.inches}
                  </p>
                  {b.error && <p className="text-[10px] text-red-400">{b.error}</p>}
                  {b.resultUrl && (
                    <>
                      <img src={b.resultUrl} alt="panel" className="w-full rounded border border-border" />
                      <Button size="sm" variant="outline" className="w-full gap-1.5"
                        onClick={() => blobDownload(b.resultUrl!, `flat-panel-${b.side}.png`)}>
                        <Download className="w-3.5 h-3.5" /> Download PNG
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
