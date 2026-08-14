/**
 * FlatPanelBuilder — QC Artboard tool. Carley's 3-step flow on the 2D proof:
 *   1. Draw the panel rectangle around the wrap section.
 *   2. Draw boxes over the tires / wheel-wells to remove + fill.
 *   3. Build → flat, print-ready rectangle (real inches + bleed).
 *
 * Reliable by design: the fill is a bounded inpaint of the wheel-well boxes,
 * then a deterministic crop — it always returns a rectangle.
 */
import { useEffect, useRef, useState } from "react";
import { Stage, Layer, Rect, Image as KonvaImage } from "react-konva";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Square, Eraser, Trash2, Wand2, Download, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  reconstructPanelArtwork,
  type NormRect,
  type PanelReconstructionResult,
} from "@/lib/reconstructPanelArtwork";
import { ProductionPanelProof, type ProofPanel } from "@/components/qc/ProductionPanelProof";
import { FileText } from "lucide-react";

interface FlatPanelBuilderProps {
  /**
   * Optional starting 2D proof. Typically the designer first cleans the proof
   * in LayerLift (remove text + logos), then uploads that cleaned proof here.
   */
  proofImageUrl?: string;
  requestId?: string;
  designId?: string;
}

type Mode = "panel" | "remove";
const VIEWS = ["driver_side", "passenger_side", "hood", "roof", "rear", "front", "front_bumper", "rear_bumper"];

const SIDE_LABEL = (v: string) => v.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Filename carries the side + real dimensions so each downloaded panel is
// self-describing for production, e.g. "driver_side_218x59.5in.png".
function panelFileName(view: string, w: number, h: number, hires: boolean) {
  const dims = `${w}x${h}in`.replace(/\s+/g, "");
  return `${view}_${dims}${hires ? "_hires" : ""}.png`;
}

export function FlatPanelBuilder({ proofImageUrl, requestId, designId }: FlatPanelBuilderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // The proof currently loaded (prop, or an uploaded LayerLift-cleaned proof).
  // Must be a real URL (not blob:) for the AI fill step to fetch it server-side.
  const [activeProof, setActiveProof] = useState<string | null>(proofImageUrl || null);
  const [uploading, setUploading] = useState(false);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [stage, setStage] = useState({ width: 900, height: 480, scale: 1, offX: 0, offY: 0 });

  const [mode, setMode] = useState<Mode>("panel");
  const [panelBox, setPanelBox] = useState<NormRect | null>(null);
  const [removals, setRemovals] = useState<NormRect[]>([]);

  const [drawing, setDrawing] = useState(false);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [temp, setTemp] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  const [name, setName] = useState("Driver Side");
  const [view, setView] = useState("driver_side");
  const [widthIn, setWidthIn] = useState(218);
  const [heightIn, setHeightIn] = useState(59.5);
  const [bleedIn, setBleedIn] = useState(1.5);
  const [dpi, setDpi] = useState(150);

  const [building, setBuilding] = useState(false);
  const [result, setResult] = useState<PanelReconstructionResult | null>(null);
  const [upscaling, setUpscaling] = useState(false);
  const [upscaledUrl, setUpscaledUrl] = useState<string | null>(null);

  // Vehicle the customer gave + panels built this session (for the proof).
  const [vehYear, setVehYear] = useState("");
  const [vehMake, setVehMake] = useState("");
  const [vehModel, setVehModel] = useState("");
  const [builtPanels, setBuiltPanels] = useState<ProofPanel[]>([]);
  const [showProof, setShowProof] = useState(false);

  useEffect(() => {
    if (!activeProof) { setImg(null); return; }
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => setImg(i);
    i.onerror = () => toast.error("Could not load proof image");
    i.src = activeProof;
  }, [activeProof]);

  // Upload a (LayerLift-cleaned) proof to storage so the AI fill can fetch it.
  const onUpload = async (file: File) => {
    setUploading(true);
    try {
      const path = `flat-panel-builder/${Date.now()}-${file.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage.from("renders").upload(path, file, {
        contentType: file.type || "image/png",
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("renders").getPublicUrl(path);
      setActiveProof(data.publicUrl);
      setPanelBox(null);
      setRemovals([]);
      setResult(null);
      toast.success("Cleaned proof uploaded — draw the panel and tire boxes.");
    } catch (e: any) {
      toast.error(`Upload failed: ${e.message || e}`);
    } finally {
      setUploading(false);
    }
  };

  // Fit the proof into the container, letterboxed.
  useEffect(() => {
    if (!img || !containerRef.current) return;
    const cw = containerRef.current.offsetWidth;
    const ch = 480;
    const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    setStage({ width: cw, height: ch, scale, offX: (cw - w) / 2, offY: (ch - h) / 2 });
  }, [img]);

  // Stage rect → normalised 0..1 rect on the proof.
  const toNorm = (r: { x: number; y: number; width: number; height: number }): NormRect => {
    const drawW = img!.naturalWidth * stage.scale;
    const drawH = img!.naturalHeight * stage.scale;
    return {
      x: (r.x - stage.offX) / drawW,
      y: (r.y - stage.offY) / drawH,
      width: r.width / drawW,
      height: r.height / drawH,
    };
  };
  const toStage = (n: NormRect) => {
    const drawW = img!.naturalWidth * stage.scale;
    const drawH = img!.naturalHeight * stage.scale;
    return { x: stage.offX + n.x * drawW, y: stage.offY + n.y * drawH, width: n.width * drawW, height: n.height * drawH };
  };

  const onDown = (e: any) => {
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setDrawing(true);
    setStart(pos);
    setTemp({ x: pos.x, y: pos.y, width: 0, height: 0 });
  };
  const onMove = (e: any) => {
    if (!drawing || !start) return;
    const pos = e.target.getStage()?.getPointerPosition();
    if (!pos) return;
    setTemp({
      x: Math.min(start.x, pos.x),
      y: Math.min(start.y, pos.y),
      width: Math.abs(pos.x - start.x),
      height: Math.abs(pos.y - start.y),
    });
  };
  const onUp = () => {
    if (drawing && temp && temp.width > 8 && temp.height > 8 && img) {
      const n = toNorm(temp);
      if (mode === "panel") setPanelBox(n);
      else setRemovals((r) => [...r, n]);
    }
    setDrawing(false);
    setStart(null);
    setTemp(null);
  };

  const [panelRemoteUrl, setPanelRemoteUrl] = useState<string | null>(null);

  const build = async () => {
    if (!activeProof) { toast.error("Upload a cleaned proof first."); return; }
    if (!panelBox) { toast.error("Draw the panel rectangle first."); return; }
    setBuilding(true);
    setResult(null);
    setUpscaledUrl(null);
    setPanelRemoteUrl(null);
    try {
      const res = await reconstructPanelArtwork({
        proofImageUrl: activeProof,
        requestId,
        designId,
        panelName: name,
        vehicleView: view,
        box: panelBox,
        removalRegions: removals,
        finalWidthIn: widthIn,
        finalHeightIn: heightIn,
        bleedIn,
        dpi,
      });
      setResult(res);
      setBuiltPanels((prev) => [
        ...prev.filter((p) => p.view !== view),
        { view, name, widthIn, heightIn, bleedIn, imageUrl: res.panelUrl },
      ]);
      setShowProof(true);
      // Persist the panel so it has a fetchable URL for upscaling / saving.
      try {
        const blob = await (await fetch(res.panelUrl)).blob();
        const path = `flat-panel-builder/panels/${Date.now()}-${name.replace(/[^\w]/g, "_")}.png`;
        const { error } = await supabase.storage.from("renders").upload(path, blob, { contentType: "image/png" });
        if (!error) setPanelRemoteUrl(supabase.storage.from("renders").getPublicUrl(path).data.publicUrl);
      } catch { /* preview still works from the object URL */ }
      toast.success(
        res.method === "ai"
          ? `Flat panel built (${res.widthPx}×${res.heightPx}px) — tires removed & filled.`
          : `Flat panel cropped (${res.widthPx}×${res.heightPx}px).`,
      );
    } catch (e: any) {
      toast.error(e.message || "Build failed");
    } finally {
      setBuilding(false);
    }
  };

  // Upscale the built panel to high-res, then text/logos go back on top (template).
  const upscale = async () => {
    if (!panelRemoteUrl) { toast.error("Panel still saving — try again in a moment."); return; }
    setUpscaling(true);
    try {
      const { data, error } = await supabase.functions.invoke("upscale-production-panel", {
        body: { image_url: panelRemoteUrl, scale: 4 },
      });
      if (error) throw error;
      const url = data?.url || data?.upscaled_url || data?.image_url || data?.output_url;
      if (!url) throw new Error("Upscaler returned no URL");
      setUpscaledUrl(url);
      toast.success("Upscaled to high-res — ready to re-apply text & logos on the template.");
    } catch (e: any) {
      toast.error(`Upscale failed: ${e.message || e}`);
    } finally {
      setUpscaling(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
        <span className="text-xs text-white/60 px-1">
          Step 1 · LayerLift to strip text + logos, then upload the cleaned proof here:
        </span>
        <label className="ml-auto">
          <input type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
          <span className="inline-flex items-center gap-1.5 cursor-pointer rounded-md bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium px-3 h-9">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {activeProof ? "Replace proof" : "Upload cleaned proof"}
          </span>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" variant={mode === "panel" ? "default" : "outline"} onClick={() => setMode("panel")}>
          <Square className="h-4 w-4 mr-1.5" /> Draw Panel
        </Button>
        <Button size="sm" variant={mode === "remove" ? "default" : "outline"} onClick={() => setMode("remove")}>
          <Eraser className="h-4 w-4 mr-1.5" /> Mark Tires/Cutouts
        </Button>
        {removals.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => setRemovals([])}>
            <Trash2 className="h-4 w-4 mr-1.5" /> Clear {removals.length} box{removals.length > 1 ? "es" : ""}
          </Button>
        )}
        <Badge variant="outline" className="ml-auto">
          {mode === "panel" ? "Drag the print area" : "Drag over each tire / wheel-well"}
        </Badge>
      </div>

      <div ref={containerRef} className="w-full rounded-lg overflow-hidden border border-white/10 bg-black/40 min-h-[200px] flex items-center justify-center">
        {!activeProof && (
          <span className="text-sm text-white/40 py-12">Upload a cleaned proof to begin.</span>
        )}
        {activeProof && img && (
          <Stage width={stage.width} height={stage.height} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp}>
            <Layer>
              <KonvaImage image={img} x={stage.offX} y={stage.offY} width={img.naturalWidth * stage.scale} height={img.naturalHeight * stage.scale} />
              {panelBox && (() => { const r = toStage(panelBox); return (
                <Rect x={r.x} y={r.y} width={r.width} height={r.height} stroke="#22d3ee" strokeWidth={2} dash={[8, 4]} />
              ); })()}
              {removals.map((n, i) => { const r = toStage(n); return (
                <Rect key={i} x={r.x} y={r.y} width={r.width} height={r.height} stroke="#f87171" strokeWidth={2} fill="rgba(248,113,113,0.25)" />
              ); })}
              {temp && (
                <Rect x={temp.x} y={temp.y} width={temp.width} height={temp.height}
                  stroke={mode === "panel" ? "#22d3ee" : "#f87171"} strokeWidth={2} dash={[6, 3]} />
              )}
            </Layer>
          </Stage>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Panel name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Vehicle view</Label>
          <select value={view} onChange={(e) => setView(e.target.value)}
            className="h-9 w-full rounded-md bg-background border border-input px-2 text-sm">
            {VIEWS.map((v) => <option key={v} value={v}>{v.replace(/_/g, " ")}</option>)}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Width (in)</Label>
          <Input type="number" value={widthIn} onChange={(e) => setWidthIn(+e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Height (in)</Label>
          <Input type="number" value={heightIn} onChange={(e) => setHeightIn(+e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Bleed (in)</Label>
          <Input type="number" step="0.25" value={bleedIn} onChange={(e) => setBleedIn(+e.target.value)} className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">DPI</Label>
          <Input type="number" value={dpi} onChange={(e) => setDpi(+e.target.value)} className="h-9" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Vehicle year</Label>
          <Input value={vehYear} onChange={(e) => setVehYear(e.target.value)} placeholder="2024" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Make</Label>
          <Input value={vehMake} onChange={(e) => setVehMake(e.target.value)} placeholder="Tesla" className="h-9" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Model</Label>
          <Input value={vehModel} onChange={(e) => setVehModel(e.target.value)} placeholder="Cybertruck" className="h-9" />
        </div>
      </div>

      <Button onClick={build} disabled={building || !panelBox} className="w-full h-11 bg-cyan-600 hover:bg-cyan-500">
        {building ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building flat panel…</> : <><Wand2 className="h-4 w-4 mr-2" /> Build Flat Panel</>}
      </Button>

      {builtPanels.length > 0 && (
        <Button onClick={() => setShowProof((s) => !s)} variant="outline" className="w-full">
          <FileText className="h-4 w-4 mr-2" /> {showProof ? "Hide" : "View"} Production Panel Proof ({builtPanels.length} panel{builtPanels.length > 1 ? "s" : ""})
        </Button>
      )}

      {showProof && builtPanels.length > 0 && (
        <>
          <p className="text-[11px] text-amber-300/80">
            These are the <strong>background-base</strong> panels (text &amp; logos removed). Carley re-applies the
            graphics off-platform, then uploads the completed panels in the Print Production queue — that's what gets
            sent to WrapBox.
          </p>
          <ProductionPanelProof vehicleYear={vehYear} vehicleMake={vehMake} vehicleModel={vehModel} panels={builtPanels} />
        </>
      )}

      {result && (
        <div className="space-y-2 rounded-lg border border-white/10 p-3">
          <div className="flex items-center justify-between gap-2 text-xs text-white/60">
            <span>{SIDE_LABEL(view)} · {widthIn}×{heightIn}in (+{bleedIn}" bleed) · {result.widthPx}×{result.heightPx}px · {result.method === "ai" ? "tires filled" : "cropped"}</span>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={upscale} disabled={upscaling || !panelRemoteUrl}>
                {upscaling ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Wand2 className="h-4 w-4 mr-1.5" />}
                Upscale 4×
              </Button>
              <a href={upscaledUrl || result.panelUrl} download={panelFileName(view, widthIn, heightIn, !!upscaledUrl)}>
                <Button size="sm" variant="outline"><Download className="h-4 w-4 mr-1.5" /> Download</Button>
              </a>
            </div>
          </div>
          <img src={result.panelUrl} alt="flat panel" className="w-full rounded border border-white/10 bg-white" />
          {upscaledUrl && (
            <p className="text-[11px] text-emerald-400">
              High-res ready. Re-apply the LayerLift text &amp; logos (transparent PNGs) on top to finish the template.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
