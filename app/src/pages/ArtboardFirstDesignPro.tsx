/**
 * ArtboardFirstDesignPro — the artboard-first DesignPanelPro tool.
 *
 * Runs the artboard-first chain end to end, ISOLATED from the locked live
 * DesignPanelPro/customer pipeline:
 *
 *   1. designpro-flat-art   → persona-based flat ART as real layers
 *      (background-first → fed-back transparent-PNG elements → code-keyed
 *       transparency → install-correct flat panels at true dimensions)
 *   2. designpro-recreate-3d → projects that artboard onto the vehicle (the 3D)
 *
 * White UI per docs/WHITE_UI_STANDARD.md. Auth-gated in App.tsx.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles, Boxes, Layers, Upload } from "lucide-react";

const BODY_TYPES = ["sedan", "suv", "truck", "van"] as const;

interface FlatArt {
  artboardUrl: string;
  backgroundUrl?: string;
  elementsUrl?: string;
  combinedUrl?: string;
  hadElements?: boolean;
  dimsSource?: string;
  mode?: string;
  panels?: { label: string; widthInches: number; heightInches: number }[];
}

export default function ArtboardFirstDesignPro() {
  const { toast } = useToast();

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"commercial" | "restyle">("commercial");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [url, setUrl] = useState("");
  const [year, setYear] = useState("2024");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [bodyType, setBodyType] = useState<(typeof BODY_TYPES)[number]>("truck");
  const [finish, setFinish] = useState("Gloss");

  const [refFile, setRefFile] = useState<File | null>(null);
  const [refPreview, setRefPreview] = useState<string>("");
  const [editNote, setEditNote] = useState("");
  const [sidePanels, setSidePanels] = useState<any[]>([]);
  const [sideStep, setSideStep] = useState("");
  const [flatLoading, setFlatLoading] = useState(false);
  const [flatArt, setFlatArt] = useState<FlatArt | null>(null);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [views, setViews] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const RECREATE_SIDES = ["DRIVER SIDE", "PASSENGER SIDE", "HOOD", "ROOF", "FRONT", "REAR"];

  // RecreatePro-style: reproduce EACH side from the uploaded proof, anchored so
  // nothing drifts. One AI call per side (frontend loop keeps each under the
  // edge time limit). editNote = optional minor edit applied to every side.
  const recreateFromProof = async (edit = "") => {
    if (!refFile) { setErr("Upload the approved 2D proof first."); return; }
    if (!make.trim() || !model.trim()) { setErr("Enter make + model (for true panel sizes)."); return; }
    setFlatLoading(true);
    setErr(null);
    setSidePanels([]);
    setViews(null);
    try {
      setSideStep("Uploading proof…");
      const small = await downscaleRef(refFile);
      const path = `designpro-flat-art/refs/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, small, { upsert: true, contentType: "image/jpeg" });
      if (upErr) throw new Error(`Reference upload failed: ${upErr.message}`);
      const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60);
      const referenceImageUrl = signed?.signedUrl;
      if (!referenceImageUrl) throw new Error("Could not get reference URL");

      const out: any[] = [];
      for (const side of RECREATE_SIDES) {
        setSideStep(`Recreating ${side}…${edit ? " (with edits)" : ""}`);
        const { data, error } = await supabase.functions.invoke("designpro-flat-art", {
          body: { referenceImageUrl, side, editNote: edit, vehicleYear: year, vehicleMake: make, vehicleModel: model, bodyType, finish },
        });
        if (error || !data?.success) {
          out.push({ side, error: error?.message || data?.error || "failed" });
        } else {
          out.push(data);
        }
        setSidePanels([...out]);
      }
      const ok = out.filter((p) => p.url).length;
      toast({ title: "Recreate complete", description: `${ok}/${RECREATE_SIDES.length} panels${edit ? " (with edits)" : ""}` });
    } catch (e: any) {
      setErr(e?.message || "Recreate failed");
      toast({ title: "Recreate failed", description: e?.message || "unknown", variant: "destructive" });
    } finally {
      setFlatLoading(false);
      setSideStep("");
    }
  };

  const onRef = (f: File | undefined) => {
    if (!f) return;
    setRefFile(f);
    setRefPreview(URL.createObjectURL(f));
  };

  // Downscale the reference in-browser to <=1600px before upload. A full-res
  // proof base64-encoded server-side blew the edge worker's memory (546). The
  // browser resize is cheap and 1600px is plenty for faithful reproduction.
  const downscaleRef = async (file: File, maxEdge = 1600): Promise<Blob> => {
    try {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      if (scale >= 1) return file; // already small enough
      const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d")!.drawImage(bmp, 0, 0, w, h);
      const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.92));
      return blob || file;
    } catch { return file; }
  };

  // With a reference (approved design / 2D proof) a text brief is optional —
  // the design IS the reference. Without one, a brief is required.
  const canGenerate = (prompt.trim() || refFile) && make.trim() && model.trim() && !flatLoading;

  const generateArt = async () => {
    setFlatLoading(true);
    setErr(null);
    setFlatArt(null);
    setViews(null);
    try {
      let referenceImageUrl = "";
      if (refFile) {
        const small = await downscaleRef(refFile);
        const path = `designpro-flat-art/refs/${crypto.randomUUID()}.jpg`;
        const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, small, { upsert: true, contentType: "image/jpeg" });
        if (upErr) throw new Error(`Reference upload failed: ${upErr.message}`);
        const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60);
        referenceImageUrl = signed?.signedUrl || "";
        if (!referenceImageUrl) throw new Error("Could not get reference URL");
      }
      const { data, error } = await supabase.functions.invoke("designpro-flat-art", {
        body: { prompt, referenceImageUrl, mode, companyName, phone, url, vehicleYear: year, vehicleMake: make, vehicleModel: model, bodyType, finish },
      });
      if (error) throw new Error(error.message);
      if (!data?.success || !data?.artboardUrl) throw new Error(data?.error || "No flat art returned");
      setFlatArt(data);
      toast({ title: "Flat art generated", description: `${data.mode} · ${data.hadElements ? "background + elements" : "background only"} · dims ${data.dimsSource || "?"}` });
      return data as FlatArt;
    } catch (e: any) {
      setErr(e?.message || "Flat art failed");
      toast({ title: "Flat art failed", description: e?.message || "unknown", variant: "destructive" });
      return null;
    } finally {
      setFlatLoading(false);
    }
  };

  const generate3D = async (artboardUrlArg?: string) => {
    const ab = artboardUrlArg || flatArt?.artboardUrl;
    if (!ab) return;
    setViewsLoading(true);
    setErr(null);
    setViews(null);
    try {
      const { data, error } = await supabase.functions.invoke("designpro-recreate-3d", {
        body: { artboardUrl: ab, designDescription: prompt, vehicleYear: year, vehicleMake: make, vehicleModel: model, finish },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Recreate failed");
      setViews(data.renderUrls || {});
      toast({ title: "3D views generated", description: `${Object.keys(data.renderUrls || {}).length} views${data.failed?.length ? ` · ${data.failed.length} failed` : ""}` });
    } catch (e: any) {
      setErr(e?.message || "3D failed");
      toast({ title: "3D failed", description: e?.message || "unknown", variant: "destructive" });
    } finally {
      setViewsLoading(false);
    }
  };

  // Acts like RecreatePro, flat-first: design (or uploaded reference) → reproduce
  // FLAT → recreate the 3D from that flat artboard, in one go.
  const recreateFlatFirst = async () => {
    const d = await generateArt();
    if (d?.artboardUrl) await generate3D(d.artboardUrl);
  };

  const field = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900";
  const label = "text-[11px] font-semibold text-gray-500";

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-6xl mx-auto px-5 py-8">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center text-white">
            <Layers className="w-5 h-5" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            Artboard-First Design<span className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">Pro</span>
          </h1>
        </div>
        <p className="text-sm text-gray-500 mb-6">
          Flat art first (real layers, true dimensions) → then the 3D is projected from it. Persona: Vehicle Wrap Designer at WePrintWraps.com.
        </p>

        {/* Brief */}
        <div className="rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          {/* Approved design / 2D proof upload — reproduces it flat (image-to-image) */}
          <div>
            <label className={label}>Approved design / 2D proof (optional — to MATCH an existing design)</label>
            <div className="mt-1 border-2 border-dashed border-gray-300 rounded-xl p-4 text-center hover:border-[#3b82f6] transition-colors">
              <input id="ref-file" type="file" accept="image/*" className="hidden" onChange={(e) => onRef(e.target.files?.[0])} />
              <label htmlFor="ref-file" className="cursor-pointer flex flex-col items-center gap-2">
                {refPreview ? (
                  <img src={refPreview} alt="reference" className="max-h-40 rounded-lg border border-gray-200" />
                ) : (
                  <>
                    <Upload className="w-8 h-8 text-gray-400" />
                    <span className="text-sm font-medium text-gray-700">Upload an approved design / 2D proof</span>
                    <span className="text-xs text-gray-400">Reproduces it flat (faithful match, not pixel-exact) — leave empty to generate fresh</span>
                  </>
                )}
              </label>
            </div>
            {refFile && <p className="mt-1 text-[11px] text-gray-500">{refFile.name} — brief below is optional when a reference is uploaded</p>}
          </div>

          <div>
            <label className={label}>Design brief{refFile ? " (optional with a reference)" : ""}</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="e.g. Serenity Pools — luxury infinity-pool imagery, blue/white/gray, clean and high-end"
              className="mt-1 text-sm"
            />
          </div>

          <div className="flex gap-2">
            {(["commercial", "restyle"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg border px-3 py-2 text-sm font-semibold capitalize transition ${
                  mode === m ? "border-[#3b82f6] bg-blue-50 text-gray-900" : "border-gray-300 text-gray-500"
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          {mode === "commercial" && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div><label className={label}>Company</label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="mt-1" /></div>
              <div><label className={label}>Phone</label><Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" /></div>
              <div><label className={label}>Website</label><Input value={url} onChange={(e) => setUrl(e.target.value)} className="mt-1" /></div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div><label className={label}>Year</label><Input value={year} onChange={(e) => setYear(e.target.value)} className="mt-1" /></div>
            <div><label className={label}>Make</label><Input value={make} onChange={(e) => setMake(e.target.value)} className="mt-1" /></div>
            <div><label className={label}>Model</label><Input value={model} onChange={(e) => setModel(e.target.value)} className="mt-1" /></div>
            <div>
              <label className={label}>Body type</label>
              <select value={bodyType} onChange={(e) => setBodyType(e.target.value as any)} className={`${field} mt-1`}>
                {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </div>
            <div><label className={label}>Finish</label><Input value={finish} onChange={(e) => setFinish(e.target.value)} className="mt-1" /></div>
          </div>

          {/* RECREATE from the uploaded proof — exact per-side flat panels, no drift */}
          {refFile && (
            <div className="rounded-xl border border-[#3b82f6]/30 bg-blue-50/40 p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-700">Recreate from the uploaded proof → exact flat panels (one per side, anchored so nothing drifts)</p>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => recreateFromProof("")} disabled={flatLoading || !make.trim() || !model.trim()} className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white">
                  {flatLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Recreate (exact)
                </Button>
                <Button onClick={() => recreateFromProof(editNote)} disabled={flatLoading || !make.trim() || !model.trim() || !editNote.trim()} variant="outline">
                  {flatLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
                  Recreate + Minor Edits
                </Button>
              </div>
              <Input value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="Minor edit (e.g. 'more blue', 'swap phone to 800-555-1212')" className="text-sm" />
              {sideStep && <p className="text-[11px] text-gray-500">{sideStep}</p>}
            </div>
          )}

          <div className="flex flex-wrap gap-3 pt-1">
            <Button onClick={recreateFlatFirst} disabled={!canGenerate || viewsLoading} variant="outline">
              {(flatLoading || viewsLoading) ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Flat-First → 3D (prompt)
            </Button>
            <Button onClick={generateArt} disabled={!canGenerate} variant="outline">
              {flatLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 mr-2" />}
              Flat Art only
            </Button>
            <Button onClick={() => generate3D()} disabled={!flatArt?.artboardUrl || viewsLoading} variant="outline">
              {viewsLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Boxes className="w-4 h-4 mr-2" />}
              3D from Artboard
            </Button>
          </div>

          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>

        {/* Recreated per-side flat panels (the production-pack files) */}
        {sidePanels.length > 0 && (
          <div className="mt-6 rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
            <p className="text-sm font-bold text-gray-900">Recreated panels ({sidePanels.filter((p) => p.url).length}/{sidePanels.length}) — flat, true-size, print-ready</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {sidePanels.map((p, i) => (
                <div key={i} className="rounded-lg border border-gray-200 overflow-hidden">
                  {p.url ? (
                    <>
                      <a href={p.url} target="_blank" rel="noreferrer"><img src={p.url} alt={p.side} className="w-full aspect-video object-cover bg-gray-50" /></a>
                      <div className="px-3 py-2 bg-white border-t border-gray-100">
                        <p className="text-[11px] font-semibold text-gray-700 capitalize">{(p.side || "").toLowerCase()}</p>
                        <p className="text-[10px] text-gray-500">{p.trimWidthInches}×{p.trimHeightInches}" · {p.pixelW}×{p.pixelH}px · {p.effectiveDpi} DPI</p>
                        <a href={`${p.url}${p.url.includes("?") ? "&" : "?"}download`} download className="text-[11px] font-semibold text-[#3b82f6] hover:text-[#ec4899]">Download</a>
                      </div>
                    </>
                  ) : (
                    <div className="p-3 text-[11px] text-red-600">{p.side}: {p.error || "failed"}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Layers */}
        {flatArt && (
          <div className="mt-6 rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
            <p className="text-sm font-bold text-gray-900">
              Flat art layers{flatArt.dimsSource ? ` · dims ${flatArt.dimsSource}` : ""}
              {flatArt.hadElements === false && <span className="text-amber-600"> · ⚠ background only (element pass returned nothing)</span>}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { t: "Background layer", u: flatArt.backgroundUrl, checker: false },
                { t: "Elements (transparent)", u: flatArt.elementsUrl, checker: true },
                { t: "Combined design", u: flatArt.combinedUrl, checker: false },
              ].filter((l) => l.u).map((l) => (
                <a key={l.t} href={l.u} target="_blank" rel="noreferrer" className="block">
                  <p className="text-[11px] text-gray-500 mb-1">{l.t}</p>
                  <img
                    src={l.u}
                    alt={l.t}
                    className="w-full rounded-lg border border-gray-200"
                    style={l.checker
                      ? { backgroundImage: "linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,#fff 25%,#fff 75%,#ddd 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }
                      : { background: "#f9fafb" }}
                  />
                </a>
              ))}
            </div>
            <p className="text-sm font-bold text-gray-900 pt-1">Flat-panel artboard (true dimensions)</p>
            <a href={flatArt.artboardUrl} target="_blank" rel="noreferrer" className="block">
              <img src={flatArt.artboardUrl} alt="Flat-panel artboard" className="w-full rounded-xl border border-gray-200 bg-gray-50" />
            </a>
            {flatArt.panels && (
              <p className="text-[11px] text-gray-500">{flatArt.panels.map((p) => `${p.label} ${p.widthInches}×${p.heightInches}"`).join(" · ")}</p>
            )}
          </div>
        )}

        {/* 3D */}
        {views && (
          <div className="mt-6 rounded-2xl border border-gray-200 shadow-sm p-5 space-y-3">
            <p className="text-sm font-bold text-gray-900">3D views projected from the artboard ({Object.keys(views).length})</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(views).map(([k, u]) => (
                <a key={k} href={u} target="_blank" rel="noreferrer" className="block rounded-lg border border-gray-200 overflow-hidden">
                  <img src={u} alt={k} className="w-full aspect-video object-cover bg-gray-50" />
                  <span className="block px-2 py-1 text-[11px] text-gray-600 capitalize">{k.replace(/[_-]/g, " ")}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
