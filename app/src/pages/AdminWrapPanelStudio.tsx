// ============================================================================
// AdminWrapPanelStudio — isolated print-ready wrap panel generator (admin)
// ----------------------------------------------------------------------------
// View / edit / download the artboards produced by the `wrap-panel-studio`
// edge function. Self-contained: talks only to that one function.
//   • Generate: clean cloned-background panels (2" bleed) + transparent overlays
//   • Edit:     drag/scale the logo / graphic / text layers over the panel
//   • Download: flattened print panel (bleed + crop marks + legend),
//               background-only, and each layer as a transparent PNG
// ============================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2, Download, Image as ImageIcon, Layers, Wand2, Crop, Package } from "lucide-react";
import { toast } from "sonner";
import { postProductionSlice } from "@/lib/sidecar-url";

const FN = "wrap-panel-studio";

interface Overlay {
  id: string;
  type: "logo" | "graphic" | "text";
  label: string;
  url?: string;
  text?: string;
  font?: string;
  color?: string;
  xPct: number;
  yPct: number;
  scale: number;
  rotation: number;
}
interface Artboard {
  id: string;
  batch_id: string;
  project_name: string;
  vehicle: string;
  design_brief: string;
  finish: string;
  panel_name: string;
  width_in: number;
  height_in: number;
  bleed_in: number;
  dpi: number;
  background_url: string | null;
  overlays: Overlay[];
  status: string;
  created_at: string;
}

interface PanelRow { id: string; name: string; widthIn: number; heightIn: number; file: File | null; url: string; box?: { x: number; y: number; w: number; h: number } }

// 6-panel production set (matches the 1996 F150 flag proof dims reference).
const DEFAULT_PANELS: { name: string; widthIn: number; heightIn: number }[] = [
  { name: "Driver Side", widthIn: 227, heightIn: 76.4 },
  { name: "Passenger Side", widthIn: 227, heightIn: 76.4 },
  { name: "Hood", widthIn: 60, heightIn: 50 },
  { name: "Roof", widthIn: 227, heightIn: 81.1 },
  { name: "Front", widthIn: 18.1, heightIn: 17.5 },
  { name: "Rear", widthIn: 18.1, heightIn: 88.3 },
];

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// Visual region picker: drag a rectangle on the flat source to define which
// zone maps to the active panel (normalized 0..1 → engine srcBox).
function RegionPicker({ src, panels, activeId, onSetBox }: {
  src: string;
  panels: PanelRow[];
  activeId: string | null;
  onSetBox: (id: string, box: { x: number; y: number; w: number; h: number }) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [live, setLive] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const down = (e: React.PointerEvent) => {
    if (!activeId) return;
    const p = pos(e); start.current = { x: p.x, y: p.y }; setLive({ x: p.x, y: p.y, w: 0, h: 0 });
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: React.PointerEvent) => {
    if (!start.current) return;
    const p = pos(e); const { x, y } = start.current;
    setLive({ x: Math.min(x, p.x), y: Math.min(y, p.y), w: Math.abs(p.x - x), h: Math.abs(p.y - y) });
  };
  const up = () => {
    if (start.current && live && live.w > 0.01 && live.h > 0.01 && activeId) onSetBox(activeId, live);
    start.current = null; setLive(null);
  };
  const active = panels.find((p) => p.id === activeId);
  return (
    <div className="space-y-2">
      <p className="text-xs text-gray-600">
        {active ? <>Drag a box on the source to set the <strong>{active.name}</strong> region.</> : "Click a panel's crop button below, then drag its region here."}
      </p>
      <div ref={ref} className="relative inline-block border rounded bg-gray-100 select-none" style={{ touchAction: "none" }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <img src={src} alt="source" className="block max-w-full max-h-[420px] pointer-events-none" draggable={false} />
        {panels.filter((p) => p.box).map((p) => (
          <div key={p.id} className={`absolute border-2 ${p.id === activeId ? "border-blue-600" : "border-cyan-400"} bg-blue-500/10`}
            style={{ left: `${p.box!.x * 100}%`, top: `${p.box!.y * 100}%`, width: `${p.box!.w * 100}%`, height: `${p.box!.h * 100}%` }}>
            <span className="absolute -top-4 left-0 text-[9px] font-semibold bg-black/80 text-white px-1 rounded whitespace-nowrap">{p.name}</span>
          </div>
        ))}
        {live && <div className="absolute border-2 border-blue-600 bg-blue-500/20"
          style={{ left: `${live.x * 100}%`, top: `${live.y * 100}%`, width: `${live.w * 100}%`, height: `${live.h * 100}%` }} />}
      </div>
    </div>
  );
}

function downloadBlob(blob: Blob, name: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  URL.revokeObjectURL(u);
}

export default function AdminWrapPanelStudio() {
  const [searchParams] = useSearchParams();
  // ---- generation form state ----
  const [vehicle, setVehicle] = useState("");
  const [projectName, setProjectName] = useState("");
  const [designBrief, setDesignBrief] = useState("");
  const [finish, setFinish] = useState("gloss");
  const [bleedIn, setBleedIn] = useState(2);
  const [panelRows, setPanelRows] = useState<PanelRow[]>(
    () => DEFAULT_PANELS.map((p) => ({ ...p, id: crypto.randomUUID(), file: null, url: "" })),
  );
  const [graphicElements, setGraphicElements] = useState("");
  const [textLines, setTextLines] = useState<{ text: string; color: string }[]>([]);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [proofUrl, setProofUrl] = useState("");
  const [intent, setIntent] = useState<"exact_reference" | "style_inspiration">("exact_reference");
  const [generating, setGenerating] = useState(false);
  const [packBusy, setPackBusy] = useState(false);
  const [packZipUrl, setPackZipUrl] = useState<string | null>(null);
  const [activeRegionId, setActiveRegionId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");

  function patchRow(id: string, patch: Partial<PanelRow>) {
    setPanelRows((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  // Source preview for the region picker (object URL for uploads, else the URL).
  useEffect(() => {
    if (proofFile) {
      const u = URL.createObjectURL(proofFile);
      setPreviewUrl(u);
      return () => URL.revokeObjectURL(u);
    }
    setPreviewUrl(proofUrl.trim());
  }, [proofFile, proofUrl]);

  // Deep-link from an ApprovePro order: prefill the VisionBoardIQ reference (the
  // order's 2D production proof), vehicle, and project name so the shop can open
  // a tenant job straight into Panel Studio and clone/panelize it. Runs once on
  // mount from the URL params (?proof_url= / ?vehicle= / ?project=).
  useEffect(() => {
    const pu = searchParams.get("proof_url");
    const v = searchParams.get("vehicle");
    const proj = searchParams.get("project");
    if (pu) setProofUrl(pu);
    if (v) setVehicle(v);
    if (proj) setProjectName(proj);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- library state ----
  const [artboards, setArtboards] = useState<Artboard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Artboard | null>(null);

  async function call(action: string, payload: Record<string, unknown> = {}) {
    const { data, error } = await supabase.functions.invoke(FN, { body: { action, ...payload } });
    if (error) throw new Error(error.message || "Request failed");
    if (data?.error) throw new Error(data.error);
    return data;
  }

  async function refresh() {
    setLoading(true);
    try {
      const data = await call("list");
      setArtboards((data.artboards || []) as Artboard[]);
    } catch (e) {
      toast.error("Failed to load artboards: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);

  const batches = useMemo(() => {
    const map = new Map<string, Artboard[]>();
    for (const a of artboards) {
      if (!map.has(a.batch_id)) map.set(a.batch_id, []);
      map.get(a.batch_id)!.push(a);
    }
    return Array.from(map.entries());
  }, [artboards]);

  async function handleGenerate() {
    if (!vehicle.trim()) { toast.error("Enter a vehicle"); return; }
    const valid = panelRows.filter((p) => p.name && p.widthIn > 0 && p.heightIn > 0);
    if (valid.length === 0) { toast.error("Add at least one valid panel (name, width, height)"); return; }

    setGenerating(true);
    try {
      // Each panel carries its own 1:1 source view (upload OR VisionBoardIQ URL) →
      // exact_reference split is a deterministic pixel copy, so panels come out 1:1.
      const panels = await Promise.all(valid.map(async (p) => {
        const out: Record<string, unknown> = { name: p.name, widthIn: p.widthIn, heightIn: p.heightIn };
        if (p.file) { out.sourceBase64 = await fileToBase64(p.file); out.sourceMime = p.file.type || "image/png"; }
        else if (p.url.trim()) { out.sourceUrl = p.url.trim(); }
        return out;
      }));

      const payload: Record<string, unknown> = {
        vehicle, projectName: projectName || vehicle, designBrief, finish, bleedIn, panels,
        visionboardIntent: intent,
        splitMode: intent === "exact_reference" ? "deterministic" : "ai",
        graphicElements: graphicElements.split(",").map((s) => s.trim()).filter(Boolean),
        textElements: textLines.filter((t) => t.text.trim()).map((t) => ({ text: t.text, color: t.color })),
      };
      if (logoFile) { payload.logoBase64 = await fileToBase64(logoFile); }
      // The VisionBoardIQ reference (upload OR URL) drives the CLONE pass
      // (clean background + transparent elements) and the 1:1 fallback source.
      if (proofFile) {
        payload.referenceBase64 = await fileToBase64(proofFile);
        payload.referenceMime = proofFile.type || "image/png";
      } else if (proofUrl.trim()) {
        payload.referenceUrl = proofUrl.trim();
      }
      toast.info(`Splitting ${panels.length} panel${panels.length > 1 ? "s" : ""}… this can take a minute.`);
      const res = await call("generate", payload);
      toast.success(`Built ${res.artboards?.length || 0} panel file(s).`);
      await refresh();
    } catch (e) {
      toast.error("Generation failed: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // Pure deterministic 1:1 crop of the flat source into every panel + 2" bleed.
  // No AI → can't drift, can't OOM (the 546). Needs ONE flat source (upload/URL).
  async function handleCoordinateMap() {
    if (!vehicle.trim()) { toast.error("Enter a vehicle"); return; }
    const valid = panelRows.filter((p) => p.name && p.widthIn > 0 && p.heightIn > 0);
    if (valid.length === 0) { toast.error("Add at least one valid panel"); return; }
    if (!proofFile && !proofUrl.trim()) {
      toast.error("Give it a flat source: upload or paste a URL in the VisionBoardIQ reference above.");
      return;
    }
    setGenerating(true);
    try {
      const payload: Record<string, unknown> = {
        action: "map",
        vehicle, projectName: projectName || vehicle, finish, bleedIn,
        panels: valid.map((p) => ({ name: p.name, widthIn: p.widthIn, heightIn: p.heightIn, srcBox: p.box })),
      };
      if (proofFile) payload.backgroundBase64 = await fileToBase64(proofFile);
      else payload.backgroundUrl = proofUrl.trim();
      // Optional registered overlay layer (e.g. a transparent elements PNG by URL).
      const layerUrls = graphicElements.split(",").map((s) => s.trim()).filter((s) => /^https?:\/\//.test(s));
      if (layerUrls.length) payload.layers = layerUrls.map((u) => ({ label: "Overlay", url: u }));

      toast.info(`Coordinate-mapping ${valid.length} panel(s) — deterministic, no AI…`);
      const { data, error } = await supabase.functions.invoke("coordinate-mapping-engine", { body: payload });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      toast.success(`Mapped ${data.panels?.length || 0} panel(s) at true size + ${bleedIn}″ bleed.`);
      await refresh();
    } catch (e) {
      toast.error("Coordinate-Map failed: " + (e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  // BUILD & DOWNLOAD PRODUCTION PACK — takes the panels above (each with its own
  // uploaded image + true W×H), uploads any files to storage, opens a
  // production-pack job, then runs the deterministic slicer DIRECTLY from the
  // browser (postProductionSlice — the path that actually reaches Vercel) to
  // produce the real ZIP (true-size CMYK TIFF + 2″ bleed + QC cert) and download
  // it. This is the end-to-end "push the button → get print files" flow.
  async function handleBuildProductionPack() {
    const valid = panelRows.filter((p) => p.name && p.widthIn > 0 && p.heightIn > 0 && (p.file || p.url.trim()));
    if (valid.length === 0) {
      toast.error("Add at least one panel with a name, width, height, and an uploaded image (or URL).");
      return;
    }
    setPackBusy(true);
    setPackZipUrl(null);
    try {
      // 1) Make sure every panel has a fetchable URL (upload the files you made).
      toast.info(`Uploading ${valid.length} panel${valid.length > 1 ? "s" : ""}…`);
      const sidePanels: Array<Record<string, unknown>> = [];
      for (const p of valid) {
        let url = p.url.trim();
        if (p.file) {
          const safe = `${p.name}-${p.file.name}`.replace(/[^a-zA-Z0-9._-]+/g, "_");
          const path = `panel-studio-uploads/${crypto.randomUUID()}-${safe}`;
          const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, p.file, {
            upsert: true,
            contentType: p.file.type || "image/png",
          });
          if (upErr) throw new Error(`upload ${p.name}: ${upErr.message}`);
          url = supabase.storage.from("wrap-files").getPublicUrl(path).data.publicUrl;
        }
        sidePanels.push({ side: p.name, label: p.name, url, widthInches: p.widthIn, heightInches: p.heightIn });
      }

      // 2) Open the production-pack job (server creates the row + assigns order #).
      toast.info("Creating production job…");
      const { data: jobRes, error: jobErr } = await supabase.functions.invoke("proof-pack-from-artboard", {
        body: { side_panels: sidePanels, vehicleName: projectName || vehicle || "Production Pack", vehicleMake: vehicle || undefined, finish },
      });
      if (jobErr) throw new Error(jobErr.message);
      const jobId = (jobRes as any)?.job_id;
      if (!jobId) throw new Error((jobRes as any)?.error || "No job_id returned");

      // 3) Slice from the browser (reaches Vercel) → real ZIP, returned synchronously.
      toast.info(`Building print files for ${sidePanels.length} panel(s)… this can take a minute.`);
      const res = await postProductionSlice({ job_id: jobId });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !(out as any)?.zip_url) {
        throw new Error((out as any)?.error || `slicer returned ${res.status}`);
      }
      const zip = (out as any).zip_url as string;
      setPackZipUrl(zip);
      toast.success("Production Pack ready — downloading.");
      window.open(zip, "_blank");
    } catch (e) {
      toast.error("Pack build failed: " + (e as Error).message);
    } finally {
      setPackBusy(false);
    }
  }

  async function deleteBatch(batchId: string) {
    if (!confirm("Delete this entire project?")) return;
    try {
      await call("delete", { batchId });
      toast.success("Deleted");
      if (selected?.batch_id === batchId) setSelected(null);
      refresh();
    } catch (e) { toast.error((e as Error).message); }
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <main className="container mx-auto px-4 py-8 max-w-7xl space-y-8">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Layers className="h-7 w-7 text-blue-600" /> Wrap Panel Studio
          </h1>
          <p className="text-gray-600">
            Reverse-RecreatePro: take the 1:1 2D proof → <strong>clone</strong> (clean background +
            transparent element layers) → <strong>split</strong> into print panels with{" "}
            <strong>{bleedIn}&quot; bleed</strong>. Deterministic split = actually 1:1 (no AI repaint).
          </p>
        </div>

        {/* ------------- GENERATE ------------- */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Wand2 className="h-5 w-5" /> New project</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>Vehicle</Label>
                <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Cadillac Escalade ESV" />
              </div>
              <div className="space-y-1">
                <Label>Project name</Label>
                <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Summit Realty Group" />
              </div>
              <div className="space-y-1">
                <Label>Finish</Label>
                <Select value={finish} onValueChange={setFinish}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["gloss", "matte", "satin", "metallic", "chrome"].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Design brief</Label>
              <Textarea value={designBrief} onChange={(e) => setDesignBrief(e.target.value)} rows={2}
                placeholder="Bold geometric facets in deep blue → magenta gradient with carbon accents" />
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Bleed (inches)</Label>
                <Input type="number" step="0.25" value={bleedIn} onChange={(e) => setBleedIn(Number(e.target.value) || 2)} />
              </div>
              <div className="space-y-1">
                <Label>VisionBoardIQ intent</Label>
                <Select value={intent} onValueChange={(v) => setIntent(v as "exact_reference" | "style_inspiration")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="exact_reference">Exact 1:1 — deterministic copy</SelectItem>
                    <SelectItem value="style_inspiration">Style / prompt — AI design</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>VisionBoardIQ reference — clean wrap / 2D proof (upload OR paste URL)</Label>
              <div className="grid md:grid-cols-2 gap-2">
                <Input type="file" accept="image/*" onChange={(e) => setProofFile(e.target.files?.[0] || null)} />
                <Input value={proofUrl} onChange={(e) => setProofUrl(e.target.value)} placeholder="https://…/visionboard-image.png" />
              </div>
              <p className="text-xs text-gray-500">Drives the clone pass (clean background + transparent elements) and is the 1:1 fallback source. Upload wins over URL.</p>
            </div>

            {/* region picker — map each panel to its exact zone of the flat sheet */}
            {previewUrl && (
              <div className="space-y-1 border rounded-lg p-3 bg-gray-50">
                <Label className="flex items-center gap-1"><Crop className="h-4 w-4" /> Panel regions (optional) — Coordinate-Map crops each panel from its box</Label>
                <RegionPicker src={previewUrl} panels={panelRows} activeId={activeRegionId}
                  onSetBox={(id, box) => patchRow(id, { box })} />
              </div>
            )}

            {/* per-panel rows — each carries its OWN 1:1 source view so the split
                is a deterministic pixel copy (actually 1:1, no AI drift). */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Panels — name, true size, and each panel&apos;s 1:1 view (upload OR URL)</Label>
                <Button variant="outline" size="sm"
                  onClick={() => setPanelRows((r) => [...r, { id: crypto.randomUUID(), name: "", widthIn: 0, heightIn: 0, file: null, url: "" }])}>
                  <Plus className="h-4 w-4 mr-1" /> Add panel
                </Button>
              </div>
              {panelRows.map((p) => (
                <div key={p.id} className="grid grid-cols-[1fr_64px_64px_1fr_1fr_auto_auto] gap-2 items-center">
                  <Input value={p.name} placeholder="Driver Side" onChange={(e) => patchRow(p.id, { name: e.target.value })} />
                  <Input type="number" step="0.1" value={p.widthIn || ""} placeholder="W&quot;" onChange={(e) => patchRow(p.id, { widthIn: Number(e.target.value) })} />
                  <Input type="number" step="0.1" value={p.heightIn || ""} placeholder="H&quot;" onChange={(e) => patchRow(p.id, { heightIn: Number(e.target.value) })} />
                  <Input type="file" accept="image/*" onChange={(e) => patchRow(p.id, { file: e.target.files?.[0] || null })} />
                  <Input value={p.url} placeholder="…or view URL" onChange={(e) => patchRow(p.id, { url: e.target.value })} />
                  <Button variant={activeRegionId === p.id ? "default" : (p.box ? "secondary" : "outline")} size="icon"
                    title={p.box ? "Region set — click to re-draw" : "Set this panel's region on the source"}
                    onClick={() => setActiveRegionId(activeRegionId === p.id ? null : p.id)}>
                    <Crop className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setPanelRows((r) => r.filter((x) => x.id !== p.id))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Logo (transparent PNG overlay)</Label>
                <Input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] || null)} />
              </div>
              <div className="space-y-1">
                <Label>Extra graphic elements (comma-separated → transparent PNGs)</Label>
                <Input value={graphicElements} onChange={(e) => setGraphicElements(e.target.value)} placeholder="emblem badge, eagle crest" />
              </div>
            </div>

            {/* text layers */}
            <div className="space-y-2">
              <Label>Text layers</Label>
              {textLines.map((t, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input value={t.text} placeholder="WEPRINTWRAPS.COM"
                    onChange={(e) => setTextLines((p) => p.map((x, j) => j === i ? { ...x, text: e.target.value } : x))} />
                  <input type="color" value={t.color} className="h-10 w-12 rounded border"
                    onChange={(e) => setTextLines((p) => p.map((x, j) => j === i ? { ...x, color: e.target.value } : x))} />
                  <Button variant="ghost" size="icon" onClick={() => setTextLines((p) => p.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setTextLines((p) => [...p, { text: "", color: "#ffffff" }])}>
                <Plus className="h-4 w-4 mr-1" /> Add text layer
              </Button>
            </div>

            <div className="flex flex-wrap gap-3 items-center">
              <Button onClick={handleCoordinateMap} disabled={generating} className="bg-blue-600 hover:bg-blue-700">
                {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Mapping…</> : <><Layers className="h-4 w-4 mr-2" /> Coordinate-Map panels (1:1, no AI)</>}
              </Button>
              <Button onClick={handleGenerate} disabled={generating} variant="outline" title="AI clone + split (slower, can drift)">
                {generating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Working…</> : <><Wand2 className="h-4 w-4 mr-2" /> AI clone + split</>}
              </Button>
              {/* THE button: take your uploaded panels → true-size CMYK TIFF + 2"
                  bleed + QC cert, ZIP, download. Slices from the browser so it
                  actually reaches the engine. */}
              <Button onClick={handleBuildProductionPack} disabled={packBusy || generating} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {packBusy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Building print files…</> : <><Package className="h-4 w-4 mr-2" /> Build &amp; Download Production Pack</>}
              </Button>
            </div>
            {packZipUrl && (
              <a href={packZipUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-700 hover:underline">
                <Download className="h-4 w-4" /> Download didn&apos;t start? Click here for your Production Pack ZIP
              </a>
            )}
            <p className="text-xs text-gray-500">
              <strong>Coordinate-Map</strong> = pure deterministic 1:1 pixel crop of your flat source into every panel + {bleedIn}&quot; bleed (no AI, can&apos;t drift, can&apos;t time out). Requires the flat source above (upload or URL).
            </p>
          </CardContent>
        </Card>

        {/* ------------- LIBRARY ------------- */}
        <Card>
          <CardHeader><CardTitle>Projects</CardTitle></CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center gap-2 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
            ) : batches.length === 0 ? (
              <p className="text-gray-500">No projects yet — generate one above.</p>
            ) : (
              <div className="space-y-6">
                {batches.map(([batchId, panels]) => (
                  <div key={batchId} className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-semibold">{panels[0].project_name}</h3>
                        <p className="text-sm text-gray-500">{panels[0].vehicle} · {panels.length} panels · {new Date(panels[0].created_at).toLocaleString()}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => deleteBatch(batchId)}>
                        <Trash2 className="h-4 w-4 mr-1" /> Delete
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {panels.map((p) => (
                        <button key={p.id} onClick={() => setSelected(p)}
                          className="group text-left border rounded-md overflow-hidden hover:ring-2 hover:ring-blue-500 bg-gray-100">
                          <div className="aspect-video bg-gray-200 flex items-center justify-center overflow-hidden">
                            {p.background_url
                              ? <img src={p.background_url} alt={p.panel_name} className="w-full h-full object-cover" />
                              : <ImageIcon className="h-8 w-8 text-gray-400" />}
                          </div>
                          <div className="p-2">
                            <div className="text-sm font-medium truncate">{p.panel_name}</div>
                            <div className="text-xs text-gray-500">{p.width_in}″×{p.height_in}″
                              {p.status === "error" && <Badge variant="destructive" className="ml-1">error</Badge>}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {selected && (
        <PanelEditor
          artboard={selected}
          onClose={() => setSelected(null)}
          onSaved={(updated) => {
            setArtboards((p) => p.map((a) => a.id === updated.id ? updated : a));
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

// ===========================================================================
// PanelEditor — drag/scale layers, then download print-ready output
// ===========================================================================
function PanelEditor({ artboard, onClose, onSaved }:
  { artboard: Artboard; onClose: () => void; onSaved: (a: Artboard) => void }) {
  const [overlays, setOverlays] = useState<Overlay[]>(artboard.overlays || []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const bleedFracX = artboard.bleed_in / (artboard.width_in + 2 * artboard.bleed_in);
  const bleedFracY = artboard.bleed_in / (artboard.height_in + 2 * artboard.bleed_in);

  function onPointerDown(e: React.PointerEvent, id: string) {
    e.preventDefault();
    setActiveId(id);
    const rect = stageRef.current!.getBoundingClientRect();
    const ov = overlays.find((o) => o.id === id)!;
    drag.current = {
      id,
      dx: e.clientX - (rect.left + (ov.xPct / 100) * rect.width),
      dy: e.clientY - (rect.top + (ov.yPct / 100) * rect.height),
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    const rect = stageRef.current!.getBoundingClientRect();
    const xPct = Math.min(100, Math.max(0, ((e.clientX - drag.current.dx - rect.left) / rect.width) * 100));
    const yPct = Math.min(100, Math.max(0, ((e.clientY - drag.current.dy - rect.top) / rect.height) * 100));
    setOverlays((p) => p.map((o) => o.id === drag.current!.id ? { ...o, xPct, yPct } : o));
  }
  function onPointerUp() { drag.current = null; }

  function setScale(id: string, scale: number) {
    setOverlays((p) => p.map((o) => o.id === id ? { ...o, scale } : o));
  }

  async function save() {
    setSaving(true);
    try {
      const { data, error } = await supabase.functions.invoke(FN, {
        body: { action: "update", id: artboard.id, overlays },
      });
      if (error || data?.error) throw new Error(error?.message || data?.error);
      toast.success("Saved");
      onSaved(data.artboard);
    } catch (e) {
      toast.error("Save failed: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ---- downloads ----
  async function downloadPrintPanel() {
    if (!artboard.background_url) { toast.error("No background"); return; }
    try {
      const bg = await loadImg(artboard.background_url);
      const W = bg.naturalWidth, H = bg.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(bg, 0, 0, W, H);

      // overlays
      for (const o of overlays) {
        const cx = (o.xPct / 100) * W, cy = (o.yPct / 100) * H;
        if (o.type === "text") {
          const fontPx = W * 0.05 * (o.scale || 1);
          ctx.font = `700 ${fontPx}px Oswald, Arial, sans-serif`;
          ctx.fillStyle = o.color || "#fff";
          ctx.textAlign = "center"; ctx.textBaseline = "middle";
          ctx.fillText(o.text || "", cx, cy);
        } else if (o.url) {
          const im = await loadImg(o.url);
          const w = W * 0.25 * (o.scale || 1);
          const h = w * (im.naturalHeight / im.naturalWidth);
          ctx.drawImage(im, cx - w / 2, cy - h / 2, w, h);
        }
      }

      // trim line + crop marks at the bleed inset
      const insetX = bleedFracX * W, insetY = bleedFracY * H;
      ctx.strokeStyle = "rgba(0,200,255,0.9)";
      ctx.lineWidth = Math.max(1, W * 0.0012);
      ctx.setLineDash([W * 0.01, W * 0.006]);
      ctx.strokeRect(insetX, insetY, W - 2 * insetX, H - 2 * insetY);
      ctx.setLineDash([]);
      const ml = Math.min(insetX, insetY) * 1.4;
      ctx.beginPath();
      [[insetX, insetY], [W - insetX, insetY], [insetX, H - insetY], [W - insetX, H - insetY]].forEach(([x, y]) => {
        ctx.moveTo(x - ml, y); ctx.lineTo(x + ml, y);
        ctx.moveTo(x, y - ml); ctx.lineTo(x, y + ml);
      });
      ctx.stroke();

      // legend
      const pad = W * 0.012, lh = W * 0.022;
      ctx.fillStyle = "rgba(0,0,0,0.72)";
      ctx.fillRect(pad, H - pad - lh * 2.6, W * 0.42, lh * 2.6);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.font = `600 ${lh * 0.7}px Arial`;
      ctx.fillText(`${artboard.project_name} — ${artboard.panel_name}`, pad * 1.6, H - pad - lh * 2.3);
      ctx.font = `400 ${lh * 0.6}px Arial`;
      ctx.fillText(`TRIM ${artboard.width_in}" × ${artboard.height_in}"  ·  BLEED ${artboard.bleed_in}"  ·  ${artboard.dpi} DPI  ·  ${artboard.finish}`,
        pad * 1.6, H - pad - lh * 1.3);

      const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
      downloadBlob(blob, `${artboard.project_name}-${artboard.panel_name}-PRINT.png`.replace(/\s+/g, "_"));
    } catch (e) {
      toast.error("Export failed (image CORS?): " + (e as Error).message);
    }
  }

  async function downloadBackground() {
    if (!artboard.background_url) return;
    const res = await fetch(artboard.background_url);
    downloadBlob(await res.blob(), `${artboard.panel_name}-background.png`.replace(/\s+/g, "_"));
  }

  async function downloadOverlay(o: Overlay) {
    try {
      if (o.type === "text") {
        const canvas = document.createElement("canvas");
        const fontPx = 200 * (o.scale || 1);
        const ctx = canvas.getContext("2d")!;
        ctx.font = `700 ${fontPx}px Oswald, Arial, sans-serif`;
        const w = Math.ceil(ctx.measureText(o.text || "").width) + 40;
        canvas.width = w; canvas.height = Math.ceil(fontPx * 1.4);
        const c2 = canvas.getContext("2d")!;
        c2.font = `700 ${fontPx}px Oswald, Arial, sans-serif`;
        c2.fillStyle = o.color || "#fff";
        c2.textAlign = "center"; c2.textBaseline = "middle";
        c2.fillText(o.text || "", canvas.width / 2, canvas.height / 2);
        const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), "image/png"));
        downloadBlob(blob, `layer-${o.label}.png`.replace(/\s+/g, "_"));
      } else if (o.url) {
        const res = await fetch(o.url);
        downloadBlob(await res.blob(), `layer-${o.label}.png`.replace(/\s+/g, "_"));
      }
    } catch (e) { toast.error((e as Error).message); }
  }

  const active = overlays.find((o) => o.id === activeId);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-6xl w-full max-h-[92vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-bold">{artboard.project_name} — {artboard.panel_name}</h2>
            <p className="text-xs text-gray-500">{artboard.width_in}″ × {artboard.height_in}″ trim · {artboard.bleed_in}″ bleed</p>
          </div>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="grid md:grid-cols-[1fr_280px] gap-4 p-4">
          {/* stage */}
          <div
            ref={stageRef}
            className="relative w-full bg-gray-200 rounded-lg overflow-hidden select-none"
            style={{ aspectRatio: `${artboard.width_in + 2 * artboard.bleed_in} / ${artboard.height_in + 2 * artboard.bleed_in}` }}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            {artboard.background_url && <img src={artboard.background_url} alt="" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />}
            {/* trim guide */}
            <div className="absolute border border-dashed border-cyan-400 pointer-events-none"
              style={{ left: `${bleedFracX * 100}%`, top: `${bleedFracY * 100}%`, right: `${bleedFracX * 100}%`, bottom: `${bleedFracY * 100}%` }} />
            {overlays.map((o) => (
              <div key={o.id}
                onPointerDown={(e) => onPointerDown(e, o.id)}
                className={`absolute cursor-move ${activeId === o.id ? "ring-2 ring-blue-500" : ""}`}
                style={{ left: `${o.xPct}%`, top: `${o.yPct}%`, transform: "translate(-50%,-50%)" }}>
                {o.type === "text"
                  ? <span style={{ color: o.color, fontFamily: "Oswald, sans-serif", fontWeight: 700, fontSize: `${2 * (o.scale || 1)}vw`, whiteSpace: "nowrap" }}>{o.text}</span>
                  : <img src={o.url} alt={o.label} draggable={false} style={{ width: `${10 * (o.scale || 1)}vw`, maxWidth: "40vw" }} />}
              </div>
            ))}
          </div>

          {/* side panel */}
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold text-sm mb-2 flex items-center gap-1"><Layers className="h-4 w-4" /> Layers</h3>
              <div className="space-y-1">
                {overlays.length === 0 && <p className="text-xs text-gray-500">No overlay layers.</p>}
                {overlays.map((o) => (
                  <div key={o.id} className={`flex items-center gap-2 p-2 rounded border text-sm ${activeId === o.id ? "border-blue-500 bg-blue-50" : ""}`}>
                    <button className="flex-1 text-left truncate" onClick={() => setActiveId(o.id)}>
                      <Badge variant="outline" className="mr-1">{o.type}</Badge>{o.label}
                    </button>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => downloadOverlay(o)} title="Download transparent PNG">
                      <Download className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>

            {active && (
              <div className="space-y-2 border-t pt-3">
                <Label className="text-xs">Scale — {active.label}</Label>
                <input type="range" min={0.2} max={3} step={0.05} value={active.scale || 1}
                  className="w-full" onChange={(e) => setScale(active.id, Number(e.target.value))} />
              </div>
            )}

            <div className="space-y-2 border-t pt-3">
              <Button className="w-full bg-blue-600 hover:bg-blue-700" disabled={saving} onClick={save}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null} Save layout
              </Button>
              <Button className="w-full" variant="outline" onClick={downloadPrintPanel}>
                <Download className="h-4 w-4 mr-2" /> Print panel (bleed + marks)
              </Button>
              <Button className="w-full" variant="outline" onClick={downloadBackground}>
                <Download className="h-4 w-4 mr-2" /> Background only
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
