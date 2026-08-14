/**
 * PanelSizer — upload a flat design/artboard, get back properly-sized per-panel
 * PRINT files (true aspect ratio + 1" bleed + print resolution). Deterministic
 * geometry via the panel-sizer edge function — no AI, no render-flattening.
 *
 * Works on flat-first art (designpro-flat-art) OR any existing flat file.
 * White UI, auth-gated in App.tsx.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Upload, Ruler, Download } from "lucide-react";

const BODY_TYPES = ["sedan", "suv", "truck", "van"] as const;

interface SizedPanel {
  label: string;
  trimWidthInches: number;
  trimHeightInches: number;
  bleedWidthInches: number;
  bleedHeightInches: number;
  pixelW: number;
  pixelH: number;
  effectiveDpi: number;
  url: string;
}

export default function PanelSizer() {
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [year, setYear] = useState("2024");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [bodyType, setBodyType] = useState<(typeof BODY_TYPES)[number]>("truck");
  const [dpi, setDpi] = useState("150");
  const [bleed, setBleed] = useState("1");

  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState("");
  const [panels, setPanels] = useState<SizedPanel[] | null>(null);
  const [meta, setMeta] = useState<{ dimsSource?: string; sourcePixels?: { w: number; h: number } } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const onFile = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setPanels(null);
    setErr(null);
  };

  const run = async () => {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setPanels(null);
    try {
      setStep("Uploading flat design...");
      const ext = file.name.split(".").pop() || "png";
      const path = `panel-sizer/uploads/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);
      const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60);
      const imageUrl = signed?.signedUrl;
      if (!imageUrl) throw new Error("Could not get uploaded image URL");

      setStep("Sizing panels (true aspect + bleed)...");
      const { data, error } = await supabase.functions.invoke("panel-sizer", {
        body: { imageUrl, vehicleMake: make, vehicleModel: model, vehicleYear: year, bodyType, dpi: parseInt(dpi), bleedInches: parseFloat(bleed) },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Sizing failed");
      setPanels(data.panels);
      setMeta({ dimsSource: data.dimsSource, sourcePixels: data.sourcePixels });
      toast({ title: "Panels sized", description: `${data.panels.length} print panels · dims ${data.dimsSource}` });
    } catch (e: any) {
      setErr(e?.message || "Failed");
      toast({ title: "Panel sizing failed", description: e?.message || "unknown", variant: "destructive" });
    } finally {
      setBusy(false);
      setStep("");
    }
  };

  const download = async (panel: SizedPanel) => {
    try {
      const res = await fetch(panel.url);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${panel.label}_${panel.trimWidthInches}x${panel.trimHeightInches}in_print.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
    } catch (e: any) {
      toast({ title: "Download failed", description: e?.message || "unknown", variant: "destructive" });
    }
  };

  const label = "text-[11px] font-semibold text-gray-500";
  const field = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900";

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-5xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center text-white">
            <Ruler className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Panel<span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Sizer</span>
          </h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Upload a flat design → get properly-sized per-panel print files (true aspect ratio, 1" bleed, print resolution). Geometry only — no AI, no render-flattening.
        </p>

        <div className="rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          {/* Uploader */}
          <div>
            <label className={label}>Flat design / artboard</label>
            <div className="mt-1 border-2 border-dashed border-gray-300 rounded-xl p-5 text-center hover:border-[#3b82f6] transition-colors">
              <input id="sizer-file" type="file" accept="image/*" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <label htmlFor="sizer-file" className="cursor-pointer flex flex-col items-center gap-2">
                {previewUrl ? (
                  <img src={previewUrl} alt="preview" className="max-h-48 rounded-lg border border-gray-200" />
                ) : (
                  <>
                    <Upload className="w-10 h-10 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Click to upload a flat design</span>
                    <span className="text-xs text-gray-400">PNG / JPG / WEBP</span>
                  </>
                )}
              </label>
            </div>
            {file && <p className="mt-1 text-[11px] text-gray-500">{file.name}</p>}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div><label className={label}>Year</label><Input value={year} onChange={(e) => setYear(e.target.value)} className="mt-1" /></div>
            <div><label className={label}>Make</label><Input value={make} onChange={(e) => setMake(e.target.value)} className="mt-1" /></div>
            <div><label className={label}>Model</label><Input value={model} onChange={(e) => setModel(e.target.value)} className="mt-1" /></div>
            <div>
              <label className={label}>Body</label>
              <select value={bodyType} onChange={(e) => setBodyType(e.target.value as any)} className={`${field} mt-1`}>
                {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div><label className={label}>DPI</label><Input value={dpi} onChange={(e) => setDpi(e.target.value)} className="mt-1" /></div>
            <div><label className={label}>Bleed (in)</label><Input value={bleed} onChange={(e) => setBleed(e.target.value)} className="mt-1" /></div>
          </div>
          <p className="text-[11px] text-gray-400">
            No make/model match falls back to {bodyType} defaults. Effective DPI is capped so very large panels stay within limits — each file is tagged with its physical size.
          </p>

          <Button onClick={run} disabled={!file || busy} className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white">
            {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Ruler className="w-4 h-4 mr-2" />}
            {busy ? step || "Working..." : "Size Print Panels"}
          </Button>

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        {panels && (
          <div className="mt-6 rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
            <p className="text-sm font-bold text-gray-900">
              {panels.length} print panels{meta?.dimsSource ? ` · dims ${meta.dimsSource}` : ""}
              {meta?.sourcePixels ? ` · source ${meta.sourcePixels.w}×${meta.sourcePixels.h}px` : ""}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {panels.map((p) => (
                <div key={p.label} className="rounded-lg border border-gray-200 overflow-hidden">
                  <a href={p.url} target="_blank" rel="noreferrer">
                    <img src={p.url} alt={p.label} className="w-full aspect-video object-cover bg-gray-50" />
                  </a>
                  <div className="p-3 space-y-1">
                    <p className="text-sm font-semibold text-gray-900 capitalize">{p.label.replace(/_/g, " ")}</p>
                    <p className="text-[11px] text-gray-500">
                      Trim {p.trimWidthInches}×{p.trimHeightInches}" · with bleed {p.bleedWidthInches}×{p.bleedHeightInches}"
                    </p>
                    <p className="text-[11px] text-gray-500">{p.pixelW}×{p.pixelH}px · {p.effectiveDpi} DPI</p>
                    <Button variant="outline" size="sm" className="w-full mt-1" onClick={() => download(p)}>
                      <Download className="w-4 h-4 mr-2" /> Download
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
