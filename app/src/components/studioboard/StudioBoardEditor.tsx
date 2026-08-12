import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Line } from "react-konva";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Sparkles, SlidersHorizontal, Brush, Eraser, Undo2, RotateCcw, Save, Check, Maximize2,
} from "lucide-react";

/**
 * StudioBoardEditor — minor edits on an uploaded Gemini file so it matches the
 * design, without leaving the app. Three tabs:
 *   • Adjust — brightness/contrast/saturation/hue (CSS filter, baked via canvas)
 *   • AI edit — natural-language change via revise-render, the RevisionIQ
 *     Master Editor that RevisionStudio uses. It edits THIS rectangle panel
 *     (Image 1) and preserves its flat shape/framing. Check "Match this 3D
 *     design" to attach the side's 3D render as a reference so the editor lays
 *     that exact design onto the panel. (Replaced the old studio-board-edit
 *     call, which re-fed the panel into a naive image-edit endpoint and
 *     regenerated literal flags/slop.)
 *   • Paint  — brush / erase on a Konva canvas at native resolution.
 *
 * Each tab's "Apply" bakes its result into the working image, so edits stack.
 * Save uploads the working image and returns its URL to the caller.
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
  jobId: string;
  onClose: () => void;
  onSaved: (sideKey: string, newUrl: string) => void;
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
  const [workingUrl, setWorkingUrl] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  // Adjust tab
  const [adj, setAdj] = useState({ ...DEFAULT_ADJUST });
  const filterStr = `brightness(${adj.brightness}) contrast(${adj.contrast}) saturate(${adj.saturate}) hue-rotate(${adj.hue}deg)`;
  const adjDirty = adj.brightness !== 1 || adj.contrast !== 1 || adj.saturate !== 1 || adj.hue !== 0;

  // AI tab
  const [aiPrompt, setAiPrompt] = useState("");
  const [refUrl, setRefUrl] = useState<string>("");
  const [refEnabled, setRefEnabled] = useState(false);
  const [refUploading, setRefUploading] = useState(false);
  const refInput = useRef<HTMLInputElement | null>(null);

  // Paint tab
  const [bmp, setBmp] = useState<HTMLImageElement | null>(null);
  const [stageSize, setStageSize] = useState({ w: 520, h: 360, ratio: 1 });
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [brushColor, setBrushColor] = useState("#ff3b30");
  const [brushSize, setBrushSize] = useState(14);
  const [erasing, setErasing] = useState(false);

  // Upscale tab
  const [upscaleFactor, setUpscaleFactor] = useState(2);
  const drawing = useRef(false);
  const stageRef = useRef<any>(null);

  // Reset everything when a new target opens.
  useEffect(() => {
    if (open && target) {
      setTab("adjust");
      setWorkingUrl(target.url);
      setAdj({ ...DEFAULT_ADJUST });
      setAiPrompt("");
      setStrokes([]);
      setErasing(false);
      setRefUrl(target.referenceUrl || "");
      setRefEnabled(!!target.referenceUrl);
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

  // Ensure the working image is a fetchable PUBLIC url for the edge function.
  const ensurePublicUrl = useCallback(async (): Promise<string> => {
    if (!workingUrl.startsWith("data:")) return workingUrl;
    const blob = await (await fetch(workingUrl)).blob();
    const path = `gemini-compare/${jobId}/${target?.sideKey || "edit"}_preai_${Date.now()}.png`;
    const { error } = await supabase.storage.from("wrap-files").upload(path, blob, { contentType: "image/png", upsert: true });
    if (error) throw new Error(error.message);
    const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
    return `${publicUrl}?t=${Date.now()}`;
  }, [workingUrl, jobId, target?.sideKey]);

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

  // Upload a custom reference image (so the edge function can fetch a public URL).
  const handleRefUpload = async (file: File) => {
    if (!file) return;
    setRefUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `gemini-compare/${jobId}/${target?.sideKey || "edit"}_ref_${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type || "image/png", upsert: true });
      if (error) throw new Error(error.message);
      const { data: { publicUrl } } = supabase.storage.from("wrap-files").getPublicUrl(path);
      setRefUrl(`${publicUrl}?t=${Date.now()}`);
      setRefEnabled(true);
    } catch (e: any) {
      toast({ title: "Reference upload failed", description: e?.message, variant: "destructive" });
    } finally {
      setRefUploading(false);
      if (refInput.current) refInput.current.value = "";
    }
  };

  const applyAI = async () => {
    const instruction = aiPrompt.trim();
    const useReference = refEnabled && !!refUrl;
    if (!instruction && !useReference) return;
    setBusy("ai");
    try {
      // Always the RevisionIQ Master Editor (revise-render) — the same tuned
      // edit brain RevisionStudio uses. It EDITS the current rectangle panel
      // (Image 1), preserving its flat shape and framing, instead of
      // regenerating from scratch — so it can't wander off into a literal flag
      // the way the old studio-board-edit did. When a reference 3D render is
      // provided we attach it and force a reference-match, so the editor lays
      // that exact design onto this panel while keeping the rectangle.
      const imageUrl = await ensurePublicUrl();
      const revisionPrompt =
        instruction ||
        "Match the attached reference wrap design exactly — same colors, gradients, artwork and layout. Keep this flat rectangular panel and its framing; do not add a vehicle, background, or 3D shape.";
      const { data, error } = await supabase.functions.invoke("revise-render", {
        body: {
          originalRenderUrl: imageUrl,
          revisionPrompt,
          toolType: "designpanelpro",
          viewType: target?.sideKey || "side",
          ...(useReference ? { visionBoardImageUrls: [refUrl], forceReferenceMatch: true } : {}),
        },
      });
      if (error) throw new Error(error.message || "Edit failed");
      const url = (data as any)?.renderUrl || (data as any)?.url;
      if (!url) throw new Error((data as any)?.message || (data as any)?.error || "No image returned");

      setWorkingUrl(`${url}${String(url).includes("?") ? "&" : "?"}t=${Date.now()}`);
      setAdj({ ...DEFAULT_ADJUST });
      setAiPrompt("");
      toast({ title: "AI edit applied", description: "Refine further or Save." });
    } catch (e: any) {
      toast({ title: "AI edit unavailable", description: e?.message, variant: "destructive" });
    } finally { setBusy(null); }
  };

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

  const applyUpscale = async () => {
    setBusy("upscale");
    try {
      const imageUrl = await ensurePublicUrl();
      const { data, error } = await supabase.functions.invoke("upscale-production-panel", {
        body: { image_url: imageUrl, scale: upscaleFactor, output_format: "png" },
      });
      if (error) throw new Error(error.message || "Upscale failed");
      const url = (data as any)?.upscaled_url || (data as any)?.url;
      if (!(data as any)?.success || !url) throw new Error((data as any)?.error || "No upscaled image returned");
      setWorkingUrl(`${url}${String(url).includes("?") ? "&" : "?"}t=${Date.now()}`);
      setAdj({ ...DEFAULT_ADJUST });
      toast({ title: `Upscaled ${upscaleFactor}×`, description: "Higher-resolution image is now the working copy. Save to keep it." });
    } catch (e: any) {
      toast({ title: "Upscale unavailable", description: e?.message, variant: "destructive" });
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

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!target) return;
    setBusy("save");
    try {
      let finalUrl = workingUrl;
      // Fold in any unbaked adjust filters first.
      if (adjDirty) finalUrl = await bakeFilter(finalUrl, filterStr);
      // Fold in any unbaked paint strokes.
      if (strokes.length && stageRef.current) finalUrl = stageRef.current.toDataURL({ pixelRatio: stageSize.ratio });

      let publicUrl = finalUrl;
      if (finalUrl.startsWith("data:")) {
        const blob = await (await fetch(finalUrl)).blob();
        const path = `gemini-compare/${jobId}/${target.sideKey}_edited_${Date.now()}.png`;
        const { error } = await supabase.storage.from("wrap-files").upload(path, blob, { contentType: "image/png", upsert: true });
        if (error) throw new Error(error.message);
        const { data: { publicUrl: pu } } = supabase.storage.from("wrap-files").getPublicUrl(path);
        publicUrl = `${pu}?t=${Date.now()}`;
      }
      onSaved(target.sideKey, publicUrl);
      toast({ title: "Saved", description: `${target.label} updated.` });
      onClose();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
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
            <TabsTrigger value="ai" className="gap-1.5"><Sparkles className="h-4 w-4" /> AI edit</TabsTrigger>
            <TabsTrigger value="paint" className="gap-1.5"><Brush className="h-4 w-4" /> Paint</TabsTrigger>
            <TabsTrigger value="upscale" className="gap-1.5"><Maximize2 className="h-4 w-4" /> Upscale</TabsTrigger>
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
          <TabsContent value="ai" className="mt-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_280px]">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-2">
                <img src={workingUrl} alt="preview" className="max-h-[320px] w-auto object-contain" />
              </div>
              <div className="space-y-3">
                {/* Reference image to match (defaults to the side's 3D render) */}
                <div className="rounded-lg border border-gray-200 p-2">
                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                      <input type="checkbox" checked={refEnabled} onChange={(e) => setRefEnabled(e.target.checked)} disabled={!refUrl} className="accent-fuchsia-600" />
                      Match this 3D design (attach as reference)
                    </label>
                    <button className="text-[11px] font-medium text-blue-600 hover:underline" onClick={() => refInput.current?.click()}>
                      {refUploading ? "Uploading…" : refUrl ? "Change" : "Upload"}
                    </button>
                  </div>
                  {refUrl ? (
                    <img src={refUrl} alt="reference" className="mt-2 max-h-24 w-full rounded border border-gray-100 object-contain" />
                  ) : (
                    <p className="mt-1 text-[11px] text-gray-400">Upload the side's 3D render to rebuild the flat panel from it.</p>
                  )}
                  <input ref={refInput} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRefUpload(f); }} />
                </div>
                <div>
                  <Label className="text-xs text-gray-600">Describe the change (optional with a reference)</Label>
                  <Textarea
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="e.g. match the reference exactly — give the blue the same gradient and depth"
                    rows={4}
                    className="mt-1 resize-none text-sm"
                  />
                </div>
                <p className="text-[11px] leading-snug text-gray-400">
                  With a reference checked, it rebuilds a flat print panel from that 3D render (strips the vehicle, fills the rectangle). Without one, it uses the RevisionStudio Master Editor to tweak this panel's color, gradient and depth.
                </p>
                <Button className="w-full gap-1.5" onClick={applyAI} disabled={(!aiPrompt.trim() && !(refEnabled && refUrl)) || busy === "ai"}>
                  {busy === "ai" ? <><Loader2 className="h-4 w-4 animate-spin" /> Editing…</> : <><Sparkles className="h-4 w-4" /> Apply with AI</>}
                </Button>
              </div>
            </div>
          </TabsContent>

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
          <TabsContent value="upscale" className="mt-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
              <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 p-2">
                <img src={workingUrl} alt="preview" className="max-h-[320px] w-auto object-contain" />
              </div>
              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-gray-600">Upscale factor</Label>
                  <div className="mt-1.5 flex gap-2">
                    {[2, 4].map((f) => (
                      <Button
                        key={f}
                        variant={upscaleFactor === f ? "default" : "outline"}
                        size="sm" className="flex-1"
                        onClick={() => setUpscaleFactor(f)}
                      >
                        {f}×
                      </Button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] leading-snug text-gray-400">
                  Increases resolution/sharpness for print using the production upscaler (Topaz). Runs on the current working image; Save keeps the result. Larger files take longer.
                </p>
                <Button className="w-full gap-1.5" onClick={applyUpscale} disabled={busy === "upscale"}>
                  {busy === "upscale" ? <><Loader2 className="h-4 w-4 animate-spin" /> Upscaling {upscaleFactor}×…</> : <><Maximize2 className="h-4 w-4" /> Upscale {upscaleFactor}×</>}
                </Button>
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
