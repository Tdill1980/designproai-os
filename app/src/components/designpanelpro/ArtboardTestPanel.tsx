/**
 * ArtboardTestPanel — admin-only, isolated test trigger for the artboard-first
 * back half. Lets you run the REAL deployed edge functions from the browser
 * (which CAN reach Supabase) without touching the customer render path:
 *
 *   1. "Generate Flat Artboard"  → designpro-artboard  (prompt → flat panels)
 *   2. "Recreate 3D from Artboard" → designpro-recreate-3d (artboard → 7 views)
 *
 * Zero production risk: nothing here is wired into the live generate flow. You
 * click, we both see the actual output, and only if it's good do we ship it.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, FlaskConical, Boxes } from "lucide-react";

const BODY_TYPES = ["sedan", "suv", "truck", "van"] as const;

export function ArtboardTestPanel() {
  const { toast } = useToast();

  const [prompt, setPrompt] = useState(
    "Summit Realty Group luxury real estate wrap — charcoal-to-gold gradient with fine architectural skyline line-art, premium and clean",
  );
  const [companyName, setCompanyName] = useState("Summit Realty Group");
  const [year, setYear] = useState("2022");
  const [make, setMake] = useState("Cadillac");
  const [model, setModel] = useState("Escalade ESV");
  const [bodyType, setBodyType] = useState<(typeof BODY_TYPES)[number]>("suv");
  const [finish, setFinish] = useState("Gloss");

  const [mode, setMode] = useState<"commercial" | "restyle">("commercial");
  const [artboardLoading, setArtboardLoading] = useState(false);
  const [artboard, setArtboard] = useState<{ url: string; panels?: any[]; dimsSource?: string } | null>(null);
  const [flatArtLoading, setFlatArtLoading] = useState(false);
  const [flatArt, setFlatArt] = useState<
    { artboardUrl: string; backgroundUrl?: string; elementsUrl?: string; combinedUrl?: string; hadElements?: boolean; dimsSource?: string } | null
  >(null);
  const [viewsLoading, setViewsLoading] = useState(false);
  const [views, setViews] = useState<Record<string, string> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [exUploading, setExUploading] = useState(false);
  const [exMsg, setExMsg] = useState<string | null>(null);

  const uploadExample = async (file: File | undefined) => {
    if (!file) return;
    setExUploading(true);
    setExMsg(null);
    try {
      // Examples live at the ROOT of the "wrap-files flat panel" bucket — the
      // exact location designpro-artboard reads its few-shot references from.
      const path = file.name.replace(/[^\w.\-]+/g, "_");
      const { error } = await supabase.storage.from("wrap-files flat panel").upload(path, file, { upsert: true, contentType: file.type });
      if (error) throw new Error(error.message);
      setExMsg(`Saved as example: ${path}. The generator will now match it.`);
      toast({ title: "Example artboard saved", description: "designpro-artboard will use it as a few-shot reference." });
    } catch (e: any) {
      setExMsg(`Upload failed: ${e?.message || "unknown"}`);
      toast({ title: "Example upload failed", description: e?.message || "unknown", variant: "destructive" });
    } finally {
      setExUploading(false);
    }
  };

  const runArtboard = async () => {
    setArtboardLoading(true);
    setErr(null);
    setArtboard(null);
    setViews(null);
    try {
      const { data, error } = await supabase.functions.invoke("designpro-artboard", {
        body: {
          designDescription: prompt,
          companyName,
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          bodyType,
          finish,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success || !data?.artboardUrl) throw new Error(data?.error || "No artboard returned");
      setArtboard({ url: data.artboardUrl, panels: data.panels, dimsSource: data.dimsSource });
      toast({ title: "Artboard generated", description: `${data.panels?.length || 0} panels · dims ${data.dimsSource || "?"}` });
    } catch (e: any) {
      setErr(e?.message || "Artboard failed");
      toast({ title: "Artboard failed", description: e?.message || "unknown", variant: "destructive" });
    } finally {
      setArtboardLoading(false);
    }
  };

  // designpro-flat-art (v2): persona-based, background-first → fed-back
  // transparent-PNG elements (code-keyed) → install-correct flat panels.
  const runFlatArt = async () => {
    setFlatArtLoading(true);
    setErr(null);
    setFlatArt(null);
    setViews(null);
    try {
      const { data, error } = await supabase.functions.invoke("designpro-flat-art", {
        body: {
          prompt,
          mode,
          companyName,
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          bodyType,
          finish,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success || !data?.artboardUrl) throw new Error(data?.error || "No flat art returned");
      setFlatArt(data);
      // Feed its artboard into the existing "Recreate 3D" button so you can chain it.
      setArtboard({ url: data.artboardUrl, panels: data.panels, dimsSource: data.dimsSource });
      toast({
        title: "Layered flat art generated",
        description: `${mode} · ${data.hadElements ? "bg + elements" : "bg only"} · dims ${data.dimsSource || "?"}`,
      });
    } catch (e: any) {
      setErr(e?.message || "Flat art failed");
      toast({ title: "Flat art failed", description: e?.message || "unknown", variant: "destructive" });
    } finally {
      setFlatArtLoading(false);
    }
  };

  const runRecreate3D = async () => {
    if (!artboard?.url) return;
    setViewsLoading(true);
    setErr(null);
    setViews(null);
    try {
      const { data, error } = await supabase.functions.invoke("designpro-recreate-3d", {
        body: {
          artboardUrl: artboard.url,
          designDescription: prompt,
          vehicleYear: year,
          vehicleMake: make,
          vehicleModel: model,
          finish,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Recreate failed");
      setViews(data.renderUrls || {});
      toast({
        title: "3D views recreated",
        description: `${Object.keys(data.renderUrls || {}).length} views${data.failed?.length ? ` · ${data.failed.length} failed` : ""}`,
      });
    } catch (e: any) {
      setErr(e?.message || "Recreate failed");
      toast({ title: "Recreate failed", description: e?.message || "unknown", variant: "destructive" });
    } finally {
      setViewsLoading(false);
    }
  };

  const field = "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900";

  return (
    <section className="rounded-2xl bg-white border-2 border-dashed border-[#3b82f6]/40 shadow-md overflow-hidden mb-5">
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-gray-100 bg-blue-50/40">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center text-white shrink-0">
          <FlaskConical className="w-4 h-4" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-gray-900 leading-none">Artboard Test (admin only)</h3>
          <p className="mt-1 text-[11px] text-gray-500">Runs the real deployed edge functions — isolated from the customer flow.</p>
        </div>
      </div>

      <div className="p-5 space-y-4">
        <div>
          <label className="text-[11px] font-semibold text-gray-500">Prompt</label>
          <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} className="mt-1 text-sm" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label className="text-[11px] font-semibold text-gray-500">Company</label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500">Year</label>
            <Input value={year} onChange={(e) => setYear(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500">Make</label>
            <Input value={make} onChange={(e) => setMake(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500">Model</label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500">Body type</label>
            <select value={bodyType} onChange={(e) => setBodyType(e.target.value as any)} className={`${field} mt-1`}>
              {BODY_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500">Finish</label>
            <Input value={finish} onChange={(e) => setFinish(e.target.value)} className="mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500">Mode (flat-art v2)</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as any)} className={`${field} mt-1`}>
              <option value="commercial">commercial</option>
              <option value="restyle">restyle</option>
            </select>
          </div>
        </div>

        <div className="rounded-lg bg-gray-50 border border-gray-200 p-3">
          <label className="text-[11px] font-semibold text-gray-500">
            Example artboard (few-shot) — upload your gold-standard so the generator matches it
          </label>
          <div className="mt-2 flex items-center gap-3">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={exUploading}
              onChange={(e) => uploadExample(e.target.files?.[0])}
              className="text-xs text-gray-700"
            />
            {exUploading && <Loader2 className="w-4 h-4 animate-spin text-gray-500" />}
          </div>
          {exMsg && <p className="mt-1 text-[11px] text-gray-600">{exMsg}</p>}
        </div>

        <div className="flex flex-wrap gap-3">
          <Button onClick={runFlatArt} disabled={flatArtLoading} className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white">
            {flatArtLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
            Generate Layered Flat Art (v2)
          </Button>
          <Button onClick={runArtboard} disabled={artboardLoading} variant="outline">
            {artboardLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <FlaskConical className="w-4 h-4 mr-2" />}
            Flat Artboard (v1)
          </Button>
          <Button onClick={runRecreate3D} disabled={!artboard?.url || viewsLoading} variant="outline">
            {viewsLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Boxes className="w-4 h-4 mr-2" />}
            Recreate 3D from Artboard
          </Button>
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}

        {flatArt && (
          <div className="space-y-3">
            <p className="text-[11px] font-semibold text-gray-500">
              Layered flat art (v2){flatArt.dimsSource ? ` · dims ${flatArt.dimsSource}` : ""}{flatArt.hadElements === false ? " · ⚠ background only (element pass returned nothing)" : ""}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {[
                { label: "Background layer", url: flatArt.backgroundUrl },
                { label: "Elements (transparent)", url: flatArt.elementsUrl },
                { label: "Combined design", url: flatArt.combinedUrl },
              ].filter((l) => l.url).map((l) => (
                <a key={l.label} href={l.url} target="_blank" rel="noreferrer" className="block">
                  <p className="text-[11px] text-gray-500 mb-1">{l.label}</p>
                  <img
                    src={l.url}
                    alt={l.label}
                    className="w-full rounded-lg border border-gray-200"
                    style={l.label.includes("transparent")
                      ? { backgroundImage: "linear-gradient(45deg,#ddd 25%,transparent 25%,transparent 75%,#ddd 75%),linear-gradient(45deg,#ddd 25%,#fff 25%,#fff 75%,#ddd 75%)", backgroundSize: "16px 16px", backgroundPosition: "0 0,8px 8px" }
                      : { background: "#f9fafb" }}
                  />
                </a>
              ))}
            </div>
            <p className="text-[11px] font-semibold text-gray-500">Composed flat-panel artboard</p>
            <a href={flatArt.artboardUrl} target="_blank" rel="noreferrer" className="block">
              <img src={flatArt.artboardUrl} alt="Flat-art artboard" className="w-full rounded-xl border border-gray-200 bg-gray-50" />
            </a>
          </div>
        )}

        {artboard?.url && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-gray-500">
              Flat artboard {artboard.dimsSource ? `· dims ${artboard.dimsSource}` : ""}
            </p>
            <a href={artboard.url} target="_blank" rel="noreferrer" className="block">
              <img src={artboard.url} alt="Test artboard" className="w-full rounded-xl border border-gray-200 bg-gray-50" />
            </a>
            {artboard.panels && (
              <p className="text-[11px] text-gray-500">
                {artboard.panels.map((p: any) => `${p.label} ${p.widthInches}×${p.heightInches}"`).join(" · ")}
              </p>
            )}
          </div>
        )}

        {views && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-gray-500">3D views recreated from artboard ({Object.keys(views).length})</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(views).map(([k, url]) => (
                <a key={k} href={url} target="_blank" rel="noreferrer" className="block rounded-lg border border-gray-200 overflow-hidden">
                  <img src={url} alt={k} className="w-full aspect-video object-cover bg-gray-50" />
                  <span className="block px-2 py-1 text-[11px] text-gray-600 capitalize">{k.replace(/[_-]/g, " ")}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default ArtboardTestPanel;
