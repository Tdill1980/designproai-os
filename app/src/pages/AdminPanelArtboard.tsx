/**
 * AdminPanelArtboard — standalone Panel Artboard Generator admin page.
 *
 * Uses ONLY the new panel-artboard-generator edge function (no existing
 * pipeline). One prompt or one reference image →
 *   design → cloned clean background + transparent overlay PNGs (logos /
 *   text / design elements, coordinate-cropped) → six print-ready panels at
 *   true dimensions + bleed → artboard composed in-browser → all saved to
 *   panel_artboard_jobs / panel_artboard_assets.
 *
 * VIEW: every job's assets grouped with downloads.
 * EDIT: drag + scale the overlay PNGs over the cloned background in-browser,
 *       save the composite back as a new asset.
 *
 * White UI per docs/WHITE_UI_STANDARD.md.
 */

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Check, Download, Grid3X3, Loader2, Pencil, Sparkles, Upload, X } from "lucide-react";

const BODY_TYPES = ["sedan", "suv", "truck", "van"] as const;
const PANEL_LABELS = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];
const BLEED = 2;

interface JobRow {
  id: string; status: string; mode: string | null; prompt: string | null;
  vehicle_year: string | null; vehicle_make: string | null; vehicle_model: string | null;
  finish: string | null; dims_source: string | null; created_at: string;
}
interface AssetRow {
  id: string; job_id: string; kind: string; label: string | null; panel_label: string | null;
  width_inches: number | null; height_inches: number | null; dpi: number | null;
  scale_pct: number | null; box: number[] | null; url: string; sort_order: number | null;
}
type StepState = "idle" | "running" | "done" | "failed";

const SECTIONS: { title: string; kinds: string[] }[] = [
  { title: "Flat Design", kinds: ["design"] },
  { title: "Cloned Background (overlays removed)", kinds: ["background"] },
  { title: "Overlay Layer + Separated PNGs (transparent + pixel-exact)", kinds: ["overlays", "overlay_crop", "overlay_crop_exact"] },
  { title: 'Print Panels — true size + 2" bleed', kinds: ["panel"] },
  { title: "Panel Artboard", kinds: ["artboard"] },
  { title: "Edited Composites", kinds: ["combined_edited"] },
];
const TRANSPARENT = ["overlays", "overlay_crop"];

interface EditItem { id: string; url: string; x: number; y: number; scale: number; }

export default function AdminPanelArtboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [prompt, setPrompt] = useState("");
  const [year, setYear] = useState("2024");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [bodyType, setBodyType] = useState<(typeof BODY_TYPES)[number]>("truck");
  const [finish, setFinish] = useState("Gloss");
  const [refFile, setRefFile] = useState<File | null>(null);
  const [pixelExact, setPixelExact] = useState(true);
  const [refPreview, setRefPreview] = useState("");
  const [steps, setSteps] = useState<{ label: string; state: StepState }[]>([]);
  const [busy, setBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<string | null>(null);

  // ── Editor state ──
  const [editJob, setEditJob] = useState<{ jobId: string; bgUrl: string } | null>(null);
  const [editItems, setEditItems] = useState<EditItem[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const editBoxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const { data: jobs } = useQuery({
    queryKey: ["panel-artboard-jobs"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("panel_artboard_jobs").select("*").order("created_at", { ascending: false }).limit(25);
      if (error) throw error;
      return (data || []) as JobRow[];
    },
  });
  const { data: assets } = useQuery({
    queryKey: ["panel-artboard-assets", jobs?.map((j) => j.id).join(",")],
    enabled: !!jobs?.length,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("panel_artboard_assets").select("*")
        .in("job_id", jobs!.map((j) => j.id)).order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as AssetRow[];
    },
  });

  const setStep = (i: number, state: StepState) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, state } : s)));

  const realError = async (error: any, data: any, fallback: string): Promise<string> => {
    if (data?.error) return data.error;
    try { const b = await error?.context?.json?.(); if (b?.error) return b.error; } catch { /* not json */ }
    return error?.message || fallback;
  };

  const call = async (body: Record<string, unknown>, label: string) => {
    const { data, error } = await supabase.functions.invoke("panel-artboard-generator", { body });
    if (error || !data?.success) throw new Error(`${label}: ${await realError(error, data, "failed")}`);
    return data;
  };

  const loadImg = (url: string) =>
    new Promise<HTMLImageElement>((res, rej) => {
      const i = new window.Image();
      i.crossOrigin = "anonymous";
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("image load failed"));
      i.src = url;
    });
  const blobOf = (c: HTMLCanvasElement) =>
    new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));

  const canRun = (prompt.trim() || refFile) && make.trim() && model.trim() && !busy;

  const run = async () => {
    setBusy(true);
    setRunError(null);
    setSteps([
      { label: "Flat design", state: "running" },
      { label: "Cloned background + transparent overlay PNGs", state: "idle" },
      { label: 'Six print panels (true size + 2" bleed)', state: "idle" },
      { label: "Artboard + save", state: "idle" },
    ]);
    try {
      const jobId = crypto.randomUUID();
      let referenceImageUrl = "";
      const exact = pixelExact && !!refFile;
      if (refFile) {
        // Pixel-exact mode keeps the artwork lossless (PNG, up to 3000px);
        // AI modes downscale to 1600px JPEG for edge-worker memory.
        const bmp = await createImageBitmap(refFile);
        const maxEdge = exact ? 3000 : 1600;
        const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
        const c = document.createElement("canvas");
        c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
        c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
        const blob = await new Promise<Blob | null>((res) => exact ? c.toBlob((b) => res(b), "image/png") : c.toBlob((b) => res(b), "image/jpeg", 0.92));
        const path = `panel-artboard/${jobId}/reference.${exact ? "png" : "jpg"}`;
        const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, blob || refFile, { upsert: true, contentType: exact ? "image/png" : "image/jpeg" });
        if (upErr) throw new Error(`Reference upload: ${upErr.message}`);
        const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 7);
        referenceImageUrl = signed?.signedUrl || "";
      }

      // 1 — flat design
      const d = await call({ step: "design", jobId, prompt, referenceImageUrl, finish, pixelExact: exact }, "Design");
      setStep(0, "done"); setStep(1, "running");

      // 2 — separation: cloned background + overlay layer + coordinates.
      // The edge function returns boxes ONLY; every crop is cut here in the
      // browser (canvas region copies — byte-exact at 1:1, no worker limits).
      const sep = await call({ step: "separate", jobId, designUrl: d.designUrl, pixelExact: exact }, "Separation");
      const uploadCrop = async (name: string, blob: Blob): Promise<string> => {
        const path = `panel-artboard/${jobId}/${name}`;
        const { error: cErr } = await supabase.storage.from("wrap-files").upload(path, blob, { upsert: true, contentType: "image/png" });
        if (cErr) throw new Error(`crop upload: ${cErr.message}`);
        return path;
      };
      const signPath = async (path: string): Promise<string> => {
        const { data: sg } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 365);
        if (!sg?.signedUrl) throw new Error(`sign failed: ${path}`);
        return sg.signedUrl;
      };
      const cropFrom = async (img: HTMLImageElement, box: number[], name: string): Promise<{ path: string; url: string } | null> => {
        const [ymin, xmin, ymax, xmax] = box.map((v) => Math.max(0, Math.min(1000, Number(v) || 0)));
        const x = Math.round((xmin / 1000) * img.naturalWidth);
        const y = Math.round((ymin / 1000) * img.naturalHeight);
        const w = Math.min(Math.round(((xmax - xmin) / 1000) * img.naturalWidth), img.naturalWidth - x);
        const h = Math.min(Math.round(((ymax - ymin) / 1000) * img.naturalHeight), img.naturalHeight - y);
        if (w < 8 || h < 8) return null;
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, w, h);
        const path = await uploadCrop(name, await blobOf(c));
        return { path, url: await signPath(path) };
      };
      const cropAssets: any[] = [];
      const boxesFound: { label: string; box: number[] }[] = sep.boxesFound || [];
      if (boxesFound.length) {
        const overlaysImg = sep.overlaysUrl ? await loadImg(sep.overlaysUrl).catch(() => null) : null;
        const designImg = exact ? await loadImg(d.designUrl).catch(() => null) : null;
        for (let i = 0; i < Math.min(boxesFound.length, 10); i++) {
          const b = boxesFound[i];
          const slug = (b.label || `element-${i + 1}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40);
          if (overlaysImg) {
            const r = await cropFrom(overlaysImg, b.box, `overlays/${i + 1}-${slug}.png`).catch(() => null);
            if (r) cropAssets.push({ kind: "overlay_crop", label: b.label, url: r.url, path: r.path, box: b.box });
          }
          if (designImg) {
            const r = await cropFrom(designImg, b.box, `overlays/exact-${i + 1}-${slug}.png`).catch(() => null);
            if (r) cropAssets.push({ kind: "overlay_crop_exact", label: `${b.label} (pixel-exact)`, url: r.url, path: r.path, box: b.box });
          }
        }
      }
      setStep(1, "done"); setStep(2, "running");

      // 3 — six print panels in parallel
      const panelResults = await Promise.all(PANEL_LABELS.map((side) =>
        call({ step: "panel", jobId, designUrl: d.designUrl, side, vehicleYear: year, vehicleMake: make, vehicleModel: model, bodyType, finish, bleedInches: BLEED, pixelExact: exact }, side)
      ));
      setStep(2, "done"); setStep(3, "running");

      // 4 — artboard composed in-browser, then save everything
      const ab = document.createElement("canvas");
      ab.width = 2400; ab.height = 1500;
      const ctx = ab.getContext("2d")!;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, 2400, 1500);
      ctx.fillStyle = "#111"; ctx.textAlign = "center"; ctx.font = "bold 40px Poppins, Arial, sans-serif";
      ctx.fillText(`${year} ${make} ${model} WRAP`.toUpperCase(), 1200, 64);
      ctx.fillStyle = "#777"; ctx.font = "600 22px Inter, Arial, sans-serif";
      ctx.fillText(`ALL PANELS @ ACTUAL SIZE   150 DPI   ${BLEED}" BLEED   ${finish.toUpperCase()}`, 1200, 104);
      const slots: Record<string, [number, number, number, number]> = {
        HOOD: [60, 210, 380, 230], ROOF: [60, 510, 380, 360],
        "DRIVER SIDE": [500, 210, 1320, 360], "PASSENGER SIDE": [500, 630, 1320, 360],
        FRONT: [1860, 230, 480, 180], REAR: [1860, 490, 480, 180],
      };
      ctx.textAlign = "left";
      for (const p of panelResults) {
        const slot = slots[p.side];
        if (!slot) continue;
        const [x, y, w, h] = slot;
        try {
          const im = await loadImg(p.url);
          ctx.fillStyle = "#ccc"; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
          const sr = im.width / im.height, tr = w / h;
          let sw = im.width, sh = im.height, sx = 0, sy = 0;
          if (sr > tr) { sw = sh * tr; sx = (im.width - sw) / 2; } else { sh = sw / tr; sy = (im.height - sh) / 2; }
          ctx.drawImage(im, sx, sy, sw, sh, x, y, w, h);
        } catch { /* leave slot empty */ }
        ctx.fillStyle = "#111"; ctx.font = "bold 24px Inter, Arial, sans-serif";
        ctx.fillText(`${p.side}: ${p.trimWidthInches}" x ${p.trimHeightInches}"`, x, y - 12);
      }
      const abPath = `panel-artboard/${jobId}/artboard.png`;
      const { error: abErr } = await supabase.storage.from("wrap-files").upload(abPath, await blobOf(ab), { upsert: true, contentType: "image/png" });
      if (abErr) throw new Error(`Artboard upload: ${abErr.message}`);
      const { data: abSigned } = await supabase.storage.from("wrap-files").createSignedUrl(abPath, 60 * 60 * 24 * 365);

      const saveAssets: any[] = [
        ...(referenceImageUrl ? [{ kind: "design", label: "Source reference", url: referenceImageUrl }] : []),
        { kind: "design", label: "Flat design", url: d.designUrl, path: d.designPath },
        { kind: "background", label: "Cloned background (overlays removed)", url: sep.backgroundUrl, path: sep.backgroundPath },
        ...(sep.overlaysUrl ? [{ kind: "overlays", label: "Overlay layer (transparent)", url: sep.overlaysUrl, path: sep.overlaysPath }] : []),
        ...cropAssets,
        ...panelResults.map((p) => ({
          kind: "panel", label: `${p.side} — ${p.printWidthInches}" × ${p.printHeightInches}" (incl. ${p.bleedInches}" bleed)`,
          panelLabel: p.side, widthInches: p.printWidthInches, heightInches: p.printHeightInches,
          dpi: 150, scalePct: p.scalePct, url: p.url, path: p.path,
        })),
        { kind: "artboard", label: "Panel artboard", url: abSigned?.signedUrl || "", path: abPath },
      ];
      await call({
        step: "save", jobId, prompt, referenceImageUrl, mode: referenceImageUrl ? (exact ? "pixel_exact" : "recreate") : "creative",
        vehicleYear: year, vehicleMake: make, vehicleModel: model, bodyType, finish, bleedInches: BLEED,
        dimsSource: panelResults[0]?.dimsSource, panels: panelResults[0]?.panels, assets: saveAssets,
      }, "Save");
      setStep(3, "done");
      setOpenJob(jobId);
      toast({ title: "Artboard pack complete", description: `${panelResults.length} panels · ${cropAssets.length} overlay PNGs · saved` });
      queryClient.invalidateQueries({ queryKey: ["panel-artboard-jobs"] });
      queryClient.invalidateQueries({ queryKey: ["panel-artboard-assets"] });
    } catch (e: any) {
      setSteps((prev) => prev.map((s) => (s.state === "running" ? { ...s, state: "failed" } : s)));
      setRunError(e?.message || "Run failed");
      toast({ title: "Run failed", description: e?.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  // ── EDITOR: drag + scale overlay PNGs over the cloned background ──
  const startEdit = (jobId: string) => {
    const jobAssets = (assets || []).filter((a) => a.job_id === jobId);
    const bg = jobAssets.find((a) => a.kind === "background");
    if (!bg) { toast({ title: "No background layer on this job", variant: "destructive" }); return; }
    const crops = jobAssets.filter((a) => a.kind === "overlay_crop");
    setEditItems(crops.map((c) => ({
      id: c.id, url: c.url,
      x: c.box ? (c.box[1] / 1000) * 100 : 10,
      y: c.box ? (c.box[0] / 1000) * 100 : 10,
      scale: 1,
    })));
    setEditJob({ jobId, bgUrl: bg.url });
    setSelected(null);
  };

  const onDragStart = (e: React.PointerEvent, id: string) => {
    e.preventDefault();
    setSelected(id);
    const item = editItems.find((i) => i.id === id);
    if (!item) return;
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, origX: item.x, origY: item.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onDragMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const box = editBoxRef.current;
    if (!d || !box) return;
    const r = box.getBoundingClientRect();
    const nx = d.origX + ((e.clientX - d.startX) / r.width) * 100;
    const ny = d.origY + ((e.clientY - d.startY) / r.height) * 100;
    setEditItems((prev) => prev.map((i) => (i.id === d.id ? { ...i, x: Math.max(-20, Math.min(100, nx)), y: Math.max(-20, Math.min(100, ny)) } : i)));
  };
  const onDragEnd = () => { dragRef.current = null; };

  const saveEdit = async () => {
    if (!editJob) return;
    setSavingEdit(true);
    try {
      const bg = await loadImg(editJob.bgUrl);
      const c = document.createElement("canvas");
      c.width = bg.width; c.height = bg.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(bg, 0, 0);
      for (const item of editItems) {
        const im = await loadImg(item.url);
        const w = im.width * item.scale, h = im.height * item.scale;
        ctx.drawImage(im, (item.x / 100) * bg.width, (item.y / 100) * bg.height, w, h);
      }
      const path = `panel-artboard/${editJob.jobId}/edited-${Date.now()}.png`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, await blobOf(c), { upsert: true, contentType: "image/png" });
      if (upErr) throw new Error(upErr.message);
      const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60 * 24 * 365);
      const { error: insErr } = await (supabase as any).from("panel_artboard_assets").insert({
        job_id: editJob.jobId, kind: "combined_edited", label: `Edited composite ${new Date().toLocaleTimeString()}`,
        storage_path: path, url: signed?.signedUrl || "", sort_order: 999,
      });
      if (insErr) throw new Error(insErr.message);
      toast({ title: "Edited composite saved" });
      setEditJob(null);
      queryClient.invalidateQueries({ queryKey: ["panel-artboard-assets"] });
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message, variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };

  const label = "text-[11px] font-semibold text-gray-500";
  const inputCls = "mt-1 bg-white border-gray-300 text-gray-900 placeholder:text-gray-400";
  const checker = {
    backgroundImage:
      "linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,#fff 25%,#fff 75%,#ddd 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0,8px 8px",
  } as const;

  return (
    <div className="min-h-screen bg-white">
      <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
      <div className="max-w-7xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm">
            <Grid3X3 className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-2xl font-bold">
            <span className="text-gray-900">Panel Artboard </span>
            <span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Generator</span>
          </h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Standalone system — prompt or reference → cloned background + separate transparent overlay PNGs → print-ready panels → artboard. View, edit, download below.
        </p>

        {/* ── New job ── */}
        <div className="rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4 bg-white">
          <p className="text-sm font-bold text-gray-900">New Artboard Job</p>
          <div>
            <label className={label}>Reference image (optional — recreate mode)</label>
            <div className="mt-1 border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:border-[#3b82f6] transition-colors">
              <input id="pa-ref" type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setRefFile(f); setRefPreview(URL.createObjectURL(f)); } }} />
              <label htmlFor="pa-ref" className="cursor-pointer flex flex-col items-center gap-2">
                {refPreview ? <img src={refPreview} alt="reference" className="max-h-36 rounded-lg border border-gray-200" /> : (
                  <>
                    <Upload className="w-7 h-7 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Upload a wrap design / photo / proof</span>
                  </>
                )}
              </label>
            </div>
          </div>
          {refFile && (
            <label className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 cursor-pointer">
              <input type="checkbox" checked={pixelExact} onChange={(e) => setPixelExact(e.target.checked)} className="mt-0.5" />
              <span className="text-xs text-gray-700">
                <span className="font-bold text-gray-900">Pixel-Exact mode</span> — your file IS the design: panels and overlay crops are byte-level
                slices of your artwork (no AI regeneration anywhere except healing the background behind removed overlays). Use when uploading flat
                artwork / a print file. Turn OFF for photos or 3D renders, which need AI flattening.
              </span>
            </label>
          )}
          <div>
            <label className={label}>Design brief{refFile ? " (optional with a reference)" : ""}</label>
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} placeholder='e.g. "Forged carbon base, electric blue accent vectors, bold racing energy"' className={`${inputCls} text-sm`} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><label className={label}>Year</label><Input value={year} onChange={(e) => setYear(e.target.value)} className={inputCls} /></div>
            <div><label className={label}>Make</label><Input value={make} onChange={(e) => setMake(e.target.value)} className={inputCls} /></div>
            <div><label className={label}>Model</label><Input value={model} onChange={(e) => setModel(e.target.value)} className={inputCls} /></div>
            <div>
              <label className={label}>Body type</label>
              <select value={bodyType} onChange={(e) => setBodyType(e.target.value as any)} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 mt-1 bg-white">
                {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div><label className={label}>Finish</label><Input value={finish} onChange={(e) => setFinish(e.target.value)} className={inputCls} /></div>
          </div>
          {!canRun && !busy && (
            <p className="text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
              Enter a brief (or upload a reference) AND vehicle Make + Model to enable.
            </p>
          )}
          {runError && <p className="text-sm font-semibold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{runError}</p>}
          <div className="flex flex-wrap items-center gap-4">
            <Button onClick={run} disabled={!canRun} className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white">
              {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Generate Artboard Pack
            </Button>
            {steps.length > 0 && (
              <div className="flex flex-col gap-1">
                {steps.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    {s.state === "done" && <Check className="w-3.5 h-3.5 text-green-600" />}
                    {s.state === "running" && <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />}
                    {s.state === "failed" && <span className="text-red-600 font-bold">✕</span>}
                    {s.state === "idle" && <span className="w-3.5 h-3.5 rounded-full border border-gray-300 inline-block" />}
                    <span className={s.state === "failed" ? "text-red-600" : "text-gray-600"}>{s.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ── Editor ── */}
        {editJob && (
          <div className="mt-6 rounded-2xl border border-blue-200 shadow-sm p-5 bg-white">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-bold text-gray-900">Edit overlays — drag to move · slider scales the selected overlay</p>
              <div className="flex gap-2">
                <Button size="sm" onClick={saveEdit} disabled={savingEdit} className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white">
                  {savingEdit ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Check className="w-4 h-4 mr-1" />} Save composite
                </Button>
                <Button size="sm" variant="outline" className="border-gray-300 text-gray-700" onClick={() => setEditJob(null)}><X className="w-4 h-4" /></Button>
              </div>
            </div>
            {selected && (
              <div className="flex items-center gap-3 mb-2">
                <span className="text-xs text-gray-600">Scale</span>
                <input
                  type="range" min={0.2} max={3} step={0.05}
                  value={editItems.find((i) => i.id === selected)?.scale ?? 1}
                  onChange={(e) => setEditItems((prev) => prev.map((i) => (i.id === selected ? { ...i, scale: Number(e.target.value) } : i)))}
                  className="w-56"
                />
              </div>
            )}
            <div
              ref={editBoxRef}
              className="relative w-full rounded-lg border border-gray-300 overflow-hidden select-none touch-none"
              onPointerMove={onDragMove}
              onPointerUp={onDragEnd}
            >
              <img src={editJob.bgUrl} alt="background" className="w-full block pointer-events-none" />
              {editItems.map((item) => (
                <img
                  key={item.id}
                  src={item.url}
                  alt="overlay"
                  onPointerDown={(e) => onDragStart(e, item.id)}
                  className={`absolute cursor-move ${selected === item.id ? "ring-2 ring-[#3b82f6]" : ""}`}
                  style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${28 * item.scale}%` }}
                  draggable={false}
                />
              ))}
            </div>
            <p className="text-[11px] text-gray-500 mt-2">The composite is rendered at the background's full resolution on save and stored as a new downloadable asset.</p>
          </div>
        )}

        {/* ── Jobs ── */}
        <div className="mt-8">
          <h2 className="text-lg font-bold text-gray-900 mb-3">Saved Artboard Jobs <span className="text-xs text-gray-400 font-normal">({jobs?.length || 0})</span></h2>
          {!jobs?.length && (
            <p className="text-sm text-gray-500 border border-gray-200 rounded-xl p-6 text-center">No jobs yet — generate one above.</p>
          )}
          <div className="space-y-3">
            {jobs?.map((job) => {
              const jobAssets = (assets || []).filter((a) => a.job_id === job.id);
              const open = openJob === job.id;
              return (
                <div key={job.id} className="rounded-2xl border border-gray-200 shadow-sm bg-white overflow-hidden">
                  <button onClick={() => setOpenJob(open ? null : job.id)} className="w-full flex flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-gray-50">
                    <span className="text-sm font-bold text-gray-900">{job.vehicle_year} {job.vehicle_make} {job.vehicle_model}</span>
                    <span className="text-[10px] uppercase font-semibold text-gray-400">{job.mode}</span>
                    {job.dims_source && <span className="text-[10px] text-gray-400">dims: {job.dims_source}</span>}
                    <span className="ml-auto text-xs text-gray-400">{new Date(job.created_at).toLocaleString()} · {jobAssets.length} assets</span>
                  </button>
                  {open && (
                    <div className="px-5 pb-5 space-y-5 border-t border-gray-100 pt-4">
                      <Button size="sm" variant="outline" className="border-gray-300 text-gray-700" onClick={() => startEdit(job.id)}>
                        <Pencil className="w-3.5 h-3.5 mr-1" /> Edit overlays
                      </Button>
                      {job.prompt && <p className="text-xs text-gray-500">Brief: “{job.prompt}”</p>}
                      {SECTIONS.map((section) => {
                        const items = jobAssets.filter((a) => section.kinds.includes(a.kind));
                        if (!items.length) return null;
                        return (
                          <div key={section.title}>
                            <p className="text-xs font-bold text-gray-900 mb-2">{section.title}</p>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              {items.map((a) => (
                                <div key={a.id} className="rounded-lg border border-gray-200 overflow-hidden bg-gray-50">
                                  <a href={a.url} target="_blank" rel="noreferrer">
                                    <img src={a.url} alt={a.label || a.kind} loading="lazy" className="w-full aspect-video object-contain" style={TRANSPARENT.includes(a.kind) ? checker : undefined} />
                                  </a>
                                  <div className="px-2 py-1.5 flex items-start justify-between gap-1">
                                    <div>
                                      <p className="text-[11px] font-semibold text-gray-700 leading-tight">{a.panel_label || a.label || a.kind}</p>
                                      {a.kind === "panel" && a.width_inches != null && (
                                        <p className="text-[10px] text-gray-500">{a.width_inches}" × {a.height_inches}" · {a.dpi} DPI{a.scale_pct != null && a.scale_pct < 100 ? ` · file @ ${a.scale_pct}%` : ""}</p>
                                      )}
                                    </div>
                                    <a href={a.url} target="_blank" rel="noreferrer" download className="text-gray-400 hover:text-[#3b82f6] mt-0.5">
                                      <Download className="w-3.5 h-3.5" />
                                    </a>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
