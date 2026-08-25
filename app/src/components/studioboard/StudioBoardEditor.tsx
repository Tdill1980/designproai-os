import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Line } from "react-konva";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, SlidersHorizontal, Brush, Eraser, Undo2, RotateCcw, Save, Check, Maximize2,
} from "lucide-react";

/**
 * StudioBoardEditor — the design team's correction bench for one surface.
 *
 * WHAT IT IS NOW, AND WHY IT CHANGED. This opened as an editor that changed a
 * side's panel: adjust it, repaint it, ask an AI to redraw it, and Save wrote
 * the result back as that side's print panel. On the server-owned lineage that
 * is a second producer of production artwork -- a panel authored in a browser
 * tab, bound to no master, indistinguishable on screen from one Call 9 cut.
 *
 * The AI tab is gone outright. It sent the panel to a generative edit and put
 * whatever came back into the print set; nothing downstream could tell that
 * artwork apart from the approved design, which is exactly the confusion the
 * one-sanctioned-chain rule exists to prevent.
 *
 * What remains is the bench a designer actually needs, and it ends in the
 * audited correction path rather than a silent overwrite:
 *   • Adjust — brightness/contrast/saturation/hue (CSS filter, baked via canvas)
 *   • Paint  — brush / erase on a Konva canvas at native resolution
 *   • Resolution — what this file can print at, and where the real upscale lives
 *
 * Save records the corrected file against this exact surface and revision, with
 * a reason. The Call 9 panel is left byte-for-byte and stays downloadable; the
 * correction is its own artifact bound to it, and Call 12 enhances whichever is
 * active -- so a corrected side reaches print through Topaz and the output build
 * like any other, never around them.
 *
 * Canvas export is taint-safe: source images are loaded via fetch→blob→objectURL
 * (same-origin) so toDataURL never throws on a remote storage URL.
 */

export interface StudioBoardEditTarget {
  url: string;
  label: string;
  sideKey: string;
  referenceUrl?: string; // e.g. the 3D side render to match colors/gradient/depth against
}

interface Props {
  open: boolean;
  target: StudioBoardEditTarget | null;
  /**
   * Kept for the dialog's own identity in logs and keys. Nothing here writes to
   * storage any more, so it no longer names an upload path.
   */
  jobId: string;
  onClose: () => void;
  /**
   * The corrected file for this surface, and why it was corrected. A URL is not
   * enough any more: the correction is recorded as an artifact bound to the
   * panel it replaces, so the caller needs the bytes and the reason, not a link
   * to something already written somewhere.
   */
  onSaved: (sideKey: string, file: File, reason: string) => Promise<void>;
}

const DEFAULT_ADJUST = { brightness: 1, contrast: 1, saturate: 1, hue: 0 };

async function loadBitmap(url: string): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`Could not load image (${res.status})`);
  const blob = await res.blob();
  const obj = URL.createObjectURL(blob);
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = obj;
  });
  return { img, revoke: () => URL.revokeObjectURL(obj) };
}

type Stroke = { points: number[]; color: string; size: number; erase: boolean };

export default function StudioBoardEditor({ open, target, jobId, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [tab, setTab] = useState("adjust");
  const [correctionReason, setCorrectionReason] = useState("");
  const [workingUrl, setWorkingUrl] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  // The working file's real pixel size, measured rather than assumed -- it is
  // the number that says whether this file can print at its physical size.
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    let live = true;
    const image = new Image();
    image.onload = () => { if (live && image.naturalWidth) setNaturalSize({ w: image.naturalWidth, h: image.naturalHeight }); };
    image.src = workingUrl;
    return () => { live = false; };
  }, [workingUrl]);

  // Adjust tab
  const [adj, setAdj] = useState({ ...DEFAULT_ADJUST });
  const filterStr = `brightness(${adj.brightness}) contrast(${adj.contrast}) saturate(${adj.saturate}) hue-rotate(${adj.hue}deg)`;
  const adjDirty = adj.brightness !== 1 || adj.contrast !== 1 || adj.saturate !== 1 || adj.hue !== 0;

  // Paint tab
  const [bmp, setBmp] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 520, h: 360, ratio: 1 });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brushColor, setBrushColor] = useState("#ff3b30");
  const [brushSize, setBrushSize] = useState(14);
  const [erasing, setErasing] = useState(false);

  const drawing = useRef(false);
  const stageRef = useRef<any>(null);

  // Reset everything when a new target opens.
  useEffect(() => {
    if (open && target) {
      setTab("adjust");
      setWorkingUrl(target.url);
      setAdj({ ...DEFAULT_ADJUST });
      setStrokes([]);
      setErasing(false);
      setCorrectionReason("");
    }
  }, [open, target?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load the working image into a bitmap for the paint canvas + size the stage.
  useEffect(() => {
    let revoke: (() => void) | null = null;
    let cancelled = false;
    if (!workingUrl) { setBmp(null); return; }
    (async () => {
      try {
        const { img, revoke: r } = await loadBitmap(workingUrl);
        revoke = r;
        if (cancelled) { r(); return; }
        const maxW = 560, maxH = 380;
        const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        setBmp(img);
        setStageSize({ w, h, ratio: img.naturalWidth / w });
        setStrokes([]);
      } catch {
        setBmp(null);
      }
    })();
    return () => { cancelled = true; if (revoke) revoke(); };
  }, [workingUrl]);

  // ── Helpers ──────────────────────────────────────────────────────────────
  // Bake a CSS filter into a fresh PNG data URL at native resolution.
  const bakeFilter = useCallback(async (srcUrl: string, filter: string): Promise<string> => {
    const { img, revoke } = await loadBitmap(srcUrl);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas context");
      ctx.filter = filter;
      ctx.drawImage(img, 0, 0);
      return canvas.toDataURL("image/png");
    } finally { revoke(); }
  }, []);

  // ── Tab actions ──────────────────────────────────────────────────────────
  const applyAdjust = async () => {
    if (!adjDirty) return;
    setBusy("adjust");
    try {
      const baked = await bakeFilter(workingUrl, filterStr);
      setWorkingUrl(baked);
      setAdj({ ...DEFAULT_ADJUST });
      toast({ title: "Adjustments applied" });
    } catch (e: any) {
      toast({ title: "Could not apply adjustments", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  // The AI edit and the in-editor upscale both lived here, and both wrote
  // production artwork from the browser. The edit asked a generative model to
  // redraw the panel; the upscale sent the working copy to an enhancement
  // endpoint and made the result the panel. Neither was bound to the accepted
  // master, and neither left a record of what had changed.
  //
  // The real enhancement now runs from the board, on the ACTIVE artifact for
  // the surface, hash-verified, into a new derivative that never overwrites its
  // source -- which is what makes it inspectable and what lets Call 12 reuse it.

  // Bake the brush strokes into the working image. Pure canvas, no network.
  const applyPaint = async () => {
    if (!strokes.length || !stageRef.current) return;
    setBusy("paint");
    try {
      const dataUrl: string = stageRef.current.toDataURL({ pixelRatio: stageSize.ratio });
      setWorkingUrl(dataUrl);
      setStrokes([]);
      toast({ title: "Paint applied" });
    } catch (e: any) {
      toast({ title: "Could not apply paint", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  // ── Paint pointer handlers ───────────────────────────────────────────────
  const pointerPos = () => stageRef.current?.getPointerPosition();
  const onDown = () => {
    const p = pointerPos(); if (!p) return;
    drawing.current = true;
    setStrokes((s) => [...s, { points: [p.x, p.y], color: brushColor, size: brushSize, erase: erasing }]);
  };
  const onMove = () => {
    if (!drawing.current) return;
    const p = pointerPos(); if (!p) return;
    setStrokes((s) => {
      if (!s.length) return s;
      const last = s[s.length - 1];
      const updated = { ...last, points: [...last.points, p.x, p.y] };
      return [...s.slice(0, -1), updated];
    });
  };
  const onUp = () => { drawing.current = false; };

  // ── Save, as an audited correction ───────────────────────────────────────
  //
  // This used to upload the working image to storage and hand back its URL,
  // which silently became that side's print panel. The corrected file now
  // travels the recorded correction path instead: it is bound to the surface
  // and revision it corrects, it carries the reason it was corrected, and the
  // Call 9 panel it replaces is kept byte-for-byte beside it.
  //
  // The reason is not a formality -- it is the audit trail, and the server
  // refuses a correction without one.
  const save = async () => {
    if (!target) return;
    const reason = window.prompt(
      `What did not fit on the template for ${target.label}, and what you changed? (8 characters minimum)`,
      correctionReason,
    );
    if (reason === null) return;
    if (reason.trim().length < 8) {
      setCorrectionReason(reason);
      toast({
        title: "A correction needs a reason",
        description: "That is the audit trail; a blank one is not one.",
        variant: "destructive",
      });
      return;
    }
    setCorrectionReason(reason);
    setBusy("save");
    try {
      let finalUrl = workingUrl;
      // Fold in any unbaked adjust filters first.
      if (adjDirty) finalUrl = await bakeFilter(finalUrl, filterStr);
      // Fold in any unbaked paint strokes.
      if (strokes.length && stageRef.current) finalUrl = stageRef.current.toDataURL({ pixelRatio: stageSize.ratio });

      const blob = await (await fetch(finalUrl)).blob();
      const file = new File([blob], `${target.sideKey}-corrected.png`, { type: "image/png" });
      await onSaved(target.sideKey, file, reason.trim());
      toast({ title: "Correction recorded", description: `${target.label} — the original panel is kept.` });
      onClose();
    } catch (e: any) {
      toast({ title: "Correction refused", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

  const dirty = useMemo(() => adjDirty || strokes.length > 0 || (!!target && workingUrl !== target.url),
    [adjDirty, strokes.length, workingUrl, target]);

  if (!target) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="text-base">Edit — {target.label}</DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="adjust" className="gap-1.5"><SlidersHorizontal className="h-4 w-4" /> Adjust</TabsTrigger>
            <TabsTrigger value="paint" className="gap-1.5"><Brush className="h-4 w-4" /> Paint</TabsTrigger>
            <TabsTrigger value="resolution" className="gap-1.5"><Maximize2 className="h-4 w-4" /> Resolution</TabsTrigger>
          </TabsList>

          {/* ADJUST */}
          <TabsContent value="adjust" className="mt-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-2">
                <img src={workingUrl} alt="preview" style={{ filter: filterStr }} className="max-h-[320px] w-auto object-contain" />
              </div>
              <div className="space-y-4">
                {[
                  { k: "brightness", label: "Brightness", min: 0.5, max: 1.5, step: 0.01 },
                  { k: "contrast", label: "Contrast (depth)", min: 0.5, max: 1.6, step: 0.01 },
                  { k: "saturate", label: "Saturation (color)", min: 0, max: 2, step: 0.01 },
                  { k: "hue", label: "Hue shift", min: -180, max: 180, step: 1 },
                ].map((s) => (
                  <div key={s.k}>
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                      <Label>{s.label}</Label>
                      <span className="font-mono text-gray-400">{(adj as any)[s.k]}</span>
                    </div>
                    <Slider
                      min={s.min} max={s.max} step={s.step}
                      value={[(adj as any)[s.k]]}
                      onValueChange={([v]) => setAdj((a) => ({ ...a, [s.k]: v }))}
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdj({ ...DEFAULT_ADJUST })} disabled={!adjDirty}>
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </Button>
                  <Button size="sm" className="gap-1.5" onClick={applyAdjust} disabled={!adjDirty || busy === "adjust"}>
                    {busy === "adjust" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Apply
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          {/* AI EDIT */}
          {/* PAINT */}
          <TabsContent value="paint" className="mt-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-2">
                {bmp ? (
                  <Stage
                    ref={stageRef}
                    width={stageSize.w}
                    height={stageSize.h}
                    onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}
                    onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp}
                    style={{ touchAction: "none", cursor: "crosshair" }}
                  >
                    <Layer>
                      <KonvaImage image={bmp} width={stageSize.w} height={stageSize.h} />
                      {strokes.map((s, i) => (
                        <Line
                          key={i}
                          points={s.points}
                          stroke={s.color}
                          strokeWidth={s.size}
                          lineCap="round"
                          lineJoin="round"
                          tension={0.4}
                          globalCompositeOperation={s.erase ? "destination-out" : "source-over"}
                        />
                      ))}
                    </Layer>
                  </Stage>
                ) : (
                  <div className="flex h-[320px] items-center justify-center text-sm text-gray-400">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading canvas…
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <div className="flex gap-2">
                  <Button variant={erasing ? "outline" : "default"} size="sm" className="flex-1 gap-1.5" onClick={() => setErasing(false)}>
                    <Brush className="h-3.5 w-3.5" /> Brush
                  </Button>
                  <Button variant={erasing ? "default" : "outline"} size="sm" className="flex-1 gap-1.5" onClick={() => setErasing(true)}>
                    <Eraser className="h-3.5 w-3.5" /> Erase
                  </Button>
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs text-gray-600">Color</Label>
                  <input type="color" value={brushColor} onChange={(e) => setBrushColor(e.target.value)} className="h-7 w-10 cursor-pointer rounded border border-gray-200" disabled={erasing} />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                    <Label>Brush size</Label><span className="font-mono text-gray-400">{brushSize}px</span>
                  </div>
                  <Slider min={2} max={60} step={1} value={[brushSize]} onValueChange={([v]) => setBrushSize(v)} />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStrokes((s) => s.slice(0, -1))} disabled={!strokes.length}>
                    <Undo2 className="h-3.5 w-3.5" /> Undo
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setStrokes([])} disabled={!strokes.length}>
                    <RotateCcw className="h-3.5 w-3.5" /> Clear
                  </Button>
                </div>
                <Button size="sm" className="w-full gap-1.5" onClick={applyPaint} disabled={!strokes.length || busy === "paint"}>
                  {busy === "paint" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Apply paint
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* UPSCALE */}
          {/* RESOLUTION. What this file can print at, and where the real
              enhancement lives. The in-editor upscale used to make its result
              the working copy, which meant a designer could Save an enhanced
              image as the panel without it ever being bound to the artifact it
              came from. Run upscale on the board does the same enhancement
              against the ACTIVE artifact, records what it was made from, and
              leaves the source alone. */}
          <TabsContent value="resolution" className="mt-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-2">
                <img src={workingUrl} alt="preview" className="max-h-[320px] w-auto object-contain" />
              </div>
              <div className="space-y-3">
                <div className="rounded-lg border border-gray-200 p-3">
                  <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
                    This file
                  </div>
                  <div className="mt-1 font-mono text-sm font-semibold text-gray-900">
                    {naturalSize ? `${naturalSize.w} × ${naturalSize.h} px` : "measuring…"}
                  </div>
                </div>
                <p className="text-[11px] leading-snug text-gray-500">
                  Enhancement to print resolution runs from the board, not from here.
                  It reads the surface's active artifact, verifies its bytes, and writes
                  a new derivative — so the file you are looking at is never replaced by
                  one you cannot trace.
                </p>
                <p className="text-[11px] leading-snug text-gray-400">
                  Close this and use <span className="font-semibold text-gray-600">Run upscale</span> on
                  the surface card.
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="mt-2 flex items-center justify-between border-t border-gray-100 pt-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={save} disabled={busy === "save" || !dirty}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save to {target.label}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
