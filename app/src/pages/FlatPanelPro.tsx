import { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Upload, Download, Sparkles, Image as ImageIcon, Layers } from "lucide-react";
import { toast } from "sonner";

const SIDES = [
  { key: "driver_side", label: "Driver Side", inches: "227 × 76.4 in" },
  { key: "passenger_side", label: "Passenger Side", inches: "227 × 76.4 in" },
  { key: "roof", label: "Roof", inches: "227 × 81.1 in" },
  { key: "hood", label: "Hood", inches: "68 × 40 in" },
  { key: "front", label: "Front", inches: "18.1 × 17.5 in" },
  { key: "rear", label: "Rear", inches: "18.1 × 88.3 in" },
];
const FINISHES = ["Gloss", "Matte", "Satin"];

async function blobDownload(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const obj = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = obj; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(obj), 5000);
  } catch {
    window.open(url, "_blank");
  }
}

export default function FlatPanelPro() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [side, setSide] = useState("driver_side");
  const [finish, setFinish] = useState("Gloss");
  const [backgroundOnly, setBackgroundOnly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [bgUrl, setBgUrl] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Overlay (extracted logo/text) state.
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null);
  const [overlayAspect, setOverlayAspect] = useState(1); // h / w
  const [overlayUrlInput, setOverlayUrlInput] = useState("");
  const [place, setPlace] = useState({ x: 0.08, y: 0.2, w: 0.3 }); // fractions
  const overlayRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: "move" | "resize"; sx: number; sy: number; px: number; py: number; pw: number } | null>(null);

  const [compositing, setCompositing] = useState(false);
  const [finalUrl, setFinalUrl] = useState<string | null>(null);

  const pickFile = (f: File | null) => {
    setFile(f); setBgUrl(null); setFinalUrl(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(f ? URL.createObjectURL(f) : null);
  };

  async function uploadToStorage(f: File, prefix: string): Promise<string> {
    const { data: { user } } = await supabase.auth.getUser();
    const ext = (f.name.split(".").pop() || "png").toLowerCase();
    const path = `uploads/${prefix}/${user?.id || "anon"}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("wrap-files").upload(path, f, { contentType: f.type || "image/png", upsert: true });
    if (error) throw new Error("Upload failed: " + error.message);
    return supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
  }

  const generate = async () => {
    if (!file) { toast.error("Choose a 2D proof image first"); return; }
    setBusy(true); setBgUrl(null); setFinalUrl(null);
    try {
      setStatus("Uploading source…");
      const publicUrl = await uploadToStorage(file, "flat-panel-openai");
      setStatus(backgroundOnly ? "Generating background (no text/logos)… ≈60–90s" : "Generating flat panel with OpenAI… ≈60–90s");
      const { data, error } = await renderClient.functions.invoke("flat-panel-openai", {
        body: { imageUrl: publicUrl, side, finish, upscale: true, backgroundOnly },
      });
      if (error) throw new Error(error.message || "edge call failed");
      if (!data?.success) throw new Error(data?.error || "generation failed");
      setBgUrl(data.url);
      setStatus("");
      toast.success(backgroundOnly ? "Background ready — now place your extracted element" : "Flat panel ready");
    } catch (e: any) {
      setStatus("");
      toast.error(e?.message || "Failed to generate");
    } finally {
      setBusy(false);
    }
  };

  const pickOverlay = async (f: File | null) => {
    if (!f) return;
    try {
      const url = await uploadToStorage(f, "flat-panel-overlay");
      loadOverlay(url);
    } catch (e: any) { toast.error(e?.message || "Upload failed"); }
  };

  const loadOverlay = (url: string) => {
    const img = new Image();
    img.onload = () => { setOverlayAspect(img.naturalHeight / img.naturalWidth || 1); setOverlayUrl(url); setFinalUrl(null); };
    img.onerror = () => toast.error("Could not load that element image");
    img.src = url;
  };

  // Pointer drag / resize over the CSS-scaled preview (fractions, not pixels —
  // the real composite happens server-side at full res).
  const onPointerDown = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { mode, sx: e.clientX, sy: e.clientY, px: place.x, py: place.y, pw: place.w };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const dx = (e.clientX - drag.current.sx) / rect.width;
    const dy = (e.clientY - drag.current.sy) / rect.height;
    if (drag.current.mode === "move") {
      setPlace((p) => ({ ...p, x: Math.min(1, Math.max(-0.2, drag.current!.px + dx)), y: Math.min(1, Math.max(-0.2, drag.current!.py + dy)) }));
    } else {
      setPlace((p) => ({ ...p, w: Math.min(1.5, Math.max(0.03, drag.current!.pw + dx)) }));
    }
  };
  const onPointerUp = () => { drag.current = null; };

  const composite = async () => {
    if (!bgUrl || !overlayUrl) return;
    setCompositing(true); setFinalUrl(null);
    try {
      const { data, error } = await renderClient.functions.invoke("flat-panel-composite", {
        body: { backgroundUrl: bgUrl, overlayUrl, x: place.x, y: place.y, w: place.w },
      });
      if (error) throw new Error(error.message || "composite failed");
      if (!data?.success) throw new Error(data?.error || "composite failed");
      setFinalUrl(data.url);
      toast.success("Panel flattened — downloading");
      await blobDownload(data.url, `flat-panel-${side}.png`);
    } catch (e: any) {
      toast.error(e?.message || "Composite failed");
    } finally {
      setCompositing(false);
    }
  };

  const sideMeta = SIDES.find((s) => s.key === side);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 md:p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold flex items-center gap-2 mb-1" style={{ fontFamily: "'Montserrat', sans-serif", fontWeight: 700 }}>
        <Sparkles className="w-6 h-6 text-cyan-400" /> Flat Panel Pro
      </h1>
      <p className="text-sm text-muted-foreground mb-5">
        Upload a 2D proof → OpenAI builds a flat, full-bleed print panel at the exact per-side scale.
        In <strong>Background only</strong> mode the AI draws no text/logos — then drop your extracted
        LayerLift element on top and flatten it server-side. Independent of QC Artboard.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <CardHeader><CardTitle className="text-base">1. Source proof</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
            <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()} disabled={busy}>
              <Upload className="w-4 h-4" /> {file ? "Change image" : "Choose 2D proof image"}
            </Button>
            {previewUrl ? (
              <img src={previewUrl} alt="source proof" className="w-full rounded-md border border-border max-h-64 object-contain bg-black/20" />
            ) : (
              <div className="w-full h-40 rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
                <ImageIcon className="w-5 h-5 mr-2" /> No image selected
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Side</Label>
                <Select value={side} onValueChange={setSide}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SIDES.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Finish</Label>
                <Select value={finish} onValueChange={setFinish}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FINISHES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-md border border-border p-2.5">
              <div>
                <Label className="text-xs font-semibold">Background only (recommended)</Label>
                <p className="text-[11px] text-muted-foreground">AI draws no text/logos — you add your real extracted element on top.</p>
              </div>
              <Switch checked={backgroundOnly} onCheckedChange={setBackgroundOnly} />
            </div>
            <p className="text-[11px] text-muted-foreground">Target scale: {sideMeta?.inches}</p>

            <Button className="w-full gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white" onClick={generate} disabled={busy || !file}>
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {busy ? "Working…" : (backgroundOnly ? "Generate Background" : "Generate Flat Panel")}
            </Button>
            {status && <p className="text-xs text-cyan-300">{status}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">2. {backgroundOnly ? "Place element + flatten" : "Print-ready panel"}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {!bgUrl ? (
              <div className="w-full h-64 rounded-md border border-dashed border-border flex items-center justify-center text-muted-foreground text-sm">
                {busy ? "Generating…" : "Result appears here"}
              </div>
            ) : !backgroundOnly ? (
              <>
                <img src={bgUrl} alt="flat panel" className="w-full rounded-md border border-border bg-[repeating-conic-gradient(#0000_0_25%,#1112_0_50%)_50%/16px_16px]" />
                <p className="text-xs text-muted-foreground">{sideMeta?.label} · exact panel aspect, upscaled for print</p>
                <Button className="w-full gap-2" onClick={() => blobDownload(bgUrl, `flat-panel-${side}.png`)}>
                  <Download className="w-4 h-4" /> Download PNG
                </Button>
              </>
            ) : (
              <>
                {/* Drag-to-place stage (CSS-scaled preview; real composite is server-side). */}
                <div
                  ref={stageRef}
                  className="relative w-full rounded-md border border-border overflow-hidden bg-[repeating-conic-gradient(#0000_0_25%,#1112_0_50%)_50%/16px_16px] select-none touch-none"
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerLeave={onPointerUp}
                >
                  <img src={bgUrl} alt="background" className="w-full block pointer-events-none" draggable={false} />
                  {overlayUrl && (
                    <div
                      className="absolute border border-cyan-400/70 ring-1 ring-cyan-400/40 cursor-move"
                      style={{ left: `${place.x * 100}%`, top: `${place.y * 100}%`, width: `${place.w * 100}%` }}
                      onPointerDown={onPointerDown("move")}
                    >
                      <img src={overlayUrl} alt="element" className="w-full block pointer-events-none" draggable={false} style={{ aspectRatio: `1 / ${overlayAspect}` }} />
                      <div
                        className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-sm bg-cyan-400 cursor-nwse-resize"
                        onPointerDown={onPointerDown("resize")}
                        title="Drag to resize"
                      />
                    </div>
                  )}
                </div>

                {!overlayUrl ? (
                  <div className="space-y-2">
                    <input ref={overlayRef} type="file" accept="image/png,image/*" className="hidden" onChange={(e) => pickOverlay(e.target.files?.[0] || null)} />
                    <Button variant="outline" className="w-full gap-2" onClick={() => overlayRef.current?.click()}>
                      <Layers className="w-4 h-4" /> Upload extracted element (PNG)
                    </Button>
                    <div className="flex gap-2">
                      <Input placeholder="…or paste element URL" value={overlayUrlInput} onChange={(e) => setOverlayUrlInput(e.target.value)} className="text-xs" />
                      <Button variant="secondary" onClick={() => overlayUrlInput.trim() && loadOverlay(overlayUrlInput.trim())}>Use</Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">Use the Download button on your LayerLift element, then upload it here (or paste its URL).</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">Drag the element to position it; drag the corner to resize.</p>
                    <div className="flex gap-2">
                      <Button variant="outline" className="flex-1 gap-2" onClick={() => { setOverlayUrl(null); setOverlayUrlInput(""); }}>Change element</Button>
                      <Button className="flex-1 gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white" onClick={composite} disabled={compositing}>
                        {compositing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {compositing ? "Flattening…" : "Composite & Download"}
                      </Button>
                    </div>
                    {finalUrl && (
                      <Button variant="ghost" className="w-full gap-2 text-cyan-300" onClick={() => blobDownload(finalUrl, `flat-panel-${side}.png`)}>
                        <Download className="w-4 h-4" /> Download again
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
