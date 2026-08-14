import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2, Upload, Download, Ruler, Send, Wand2 } from "lucide-react";
import { useOrganization } from "@/contexts/OrganizationContext";
import { sendDesignPanelToWrapBox } from "@/lib/wrapboxElements";

const SIDES = ["driver side", "passenger side", "roof", "hood", "front", "rear", "front bumper", "rear bumper"];

export default function FlatPanelExport() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [viewName, setViewName] = useState("driver side");
  const [widthIn, setWidthIn] = useState("218");
  const [heightIn, setHeightIn] = useState("71.4");
  const [bleed, setBleed] = useState("3");
  const [dpi, setDpi] = useState("72");
  const [fitMode, setFitMode] = useState<"cover" | "contain" | "stretch">("cover");
  const [format, setFormat] = useState<"png" | "pdf">("png");
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [searchParams] = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(searchParams.get("order") || "");
  const [sending, setSending] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const { currentShopProfileId } = useOrganization();

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setResult(null);
  };

  const px = () => {
    const w = (Number(widthIn) + Number(bleed) * 2) * Number(dpi);
    const h = (Number(heightIn) + Number(bleed) * 2) * Number(dpi);
    return Number.isFinite(w) && Number.isFinite(h) ? `${Math.round(w)} × ${Math.round(h)} px` : "—";
  };

  const onExport = async () => {
    if (!file) { toast.error("Upload your finished flat panel first."); return; }
    if (!(Number(widthIn) > 0) || !(Number(heightIn) > 0)) { toast.error("Enter trim width and height in inches."); return; }
    setExporting(true);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in first.");

      // Upload the finished panel, then export deterministically from its URL.
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const path = `flat-panels/source/${Date.now()}_${viewName.replace(/[^\w]/g, "_")}.${ext}`;
      const { error: upErr } = await supabase.storage.from("wrap-files").upload(path, file, { contentType: file.type || "image/png", upsert: true });
      if (upErr) throw new Error("Upload failed: " + upErr.message);
      const { data: signed } = await supabase.storage.from("wrap-files").createSignedUrl(path, 60 * 60);
      if (!signed?.signedUrl) throw new Error("Could not sign uploaded file");

      // Deterministic only (MODE A): the engine trims the proof background to
      // the artwork bounding box and sizes to the exact rectangle. No AI.
      const res = await fetch("/api/export-flat-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          image_url: signed.signedUrl,
          width_inches: Number(widthIn),
          height_inches: Number(heightIn),
          bleed_inches: Number(bleed),
          dpi: Number(dpi),
          view_name: viewName,
          fit_mode: fitMode,
          format,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `Export failed (${res.status})`);
      setResult(data);
      toast.success(
        data.capped
          ? `Exported at ${data.effective_dpi} DPI (capped from ${data.requested_dpi} to stay within limits).`
          : `Exported ${data.pixel_width}×${data.pixel_height}px.`
      );
    } catch (e: any) {
      toast.error(e?.message || "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // Use as Final Panel → push the exported rectangle into the order's
  // Production Pack → WrapBox (reuses the existing WrapBox panel mechanism).
  const onSendToWrapBox = async () => {
    if (!result?.pngUrl) { toast.error("Export the panel first."); return; }
    const ord = orderNumber.trim();
    if (!ord) { toast.error("Enter the order # (RP-XXXXXX)."); return; }
    if (!currentShopProfileId) { toast.error("No shop selected — open WrapBox once to set your shop."); return; }
    setSending(true);
    try {
      await sendDesignPanelToWrapBox({
        job: { jobId: ord, orderNumber: ord, vehicleInfo: null, finishType: null },
        shopId: currentShopProfileId,
        artboardUrl: result.pngUrl,
        designName: `${result.view_name} flat panel`,
      });
      toast.success(`Sent to Production Pack / WrapBox (${ord}).`);
    } catch (e: any) {
      toast.error(e?.message || "Failed to send to WrapBox");
    } finally {
      setSending(false);
    }
  };

  // MODE B (optional) — repair ONLY the enclosed cutout holes via masked AI.
  const onRepair = async () => {
    if (!result?.pngUrl) return;
    setRepairing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sign in first.");
      const res = await fetch("/api/repair-flat-panel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ image_url: result.pngUrl }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || `Repair failed (${res.status})`);
      if (!data.repaired) { toast("No enclosed cutouts found to repair."); return; }
      setResult((prev: any) => ({ ...prev, pngUrl: data.url, url: data.url }));
      toast.success(`Repaired ${data.tiles_repaired} section${data.tiles_repaired === 1 ? "" : "s"}.`);
    } catch (e: any) {
      toast.error(e?.message || "Repair failed");
    } finally {
      setRepairing(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-white p-4 sm:p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-2 mb-1">
          <Ruler className="w-6 h-6 text-cyan-400" />
          <h1 className="text-2xl font-bold">Final Flat Panel</h1>
        </div>
        <p className="text-sm text-zinc-400 mb-6">
          Upload a finished flat panel and export a print-ready rectangle at exact dimensions — deterministic (Sharp), no AI.
          Pixel size = (inches + bleed×2) × DPI.
        </p>

        <div className="grid lg:grid-cols-[380px,1fr] gap-4">
          {/* Controls */}
          <Card className="bg-zinc-900 border-zinc-800 p-4 space-y-4">
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Upload Finished Flat Panel</Label>
              <Button asChild variant="outline" className="w-full gap-2">
                <label className="cursor-pointer">
                  <Upload className="w-4 h-4" /> {file ? "Change file" : "Choose file"}
                  <input type="file" accept="image/*" className="hidden" onChange={onFile} />
                </label>
              </Button>
              {file && <p className="text-[11px] text-zinc-500 mt-1 truncate">{file.name}</p>}
            </div>

            <div>
              <Label className="text-xs font-semibold mb-1.5 block">Use as Final Panel — Vehicle View</Label>
              <Select value={viewName} onValueChange={setViewName}>
                <SelectTrigger className="bg-secondary border-border/50 h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{SIDES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Trim Width (in)</Label>
                <Input value={widthIn} onChange={(e) => setWidthIn(e.target.value)} className="bg-secondary border-border/50 h-10" />
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Trim Height (in)</Label>
                <Input value={heightIn} onChange={(e) => setHeightIn(e.target.value)} className="bg-secondary border-border/50 h-10" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Bleed (in)</Label>
                <Select value={bleed} onValueChange={setBleed}>
                  <SelectTrigger className="bg-secondary border-border/50 h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{["0", "3", "6"].map((b) => <SelectItem key={b} value={b}>{b}"</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">DPI</Label>
                <Select value={dpi} onValueChange={setDpi}>
                  <SelectTrigger className="bg-secondary border-border/50 h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{["72", "100", "150"].map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Fit Mode</Label>
                <Select value={fitMode} onValueChange={(v: any) => setFitMode(v)}>
                  <SelectTrigger className="bg-secondary border-border/50 h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cover">Cover (preserve ratio, crop excess)</SelectItem>
                    <SelectItem value="contain">Contain (preserve ratio, pad)</SelectItem>
                    <SelectItem value="stretch">Stretch (distort to fit)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs font-semibold mb-1.5 block">Format</Label>
                <Select value={format} onValueChange={(v: any) => setFormat(v)}>
                  <SelectTrigger className="bg-secondary border-border/50 h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG</SelectItem>
                    <SelectItem value="pdf">PDF</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="text-[11px] text-zinc-500 border-t border-zinc-800 pt-2">
              Artboard: {Number(widthIn) + Number(bleed) * 2}" × {Number(heightIn) + Number(bleed) * 2}" → <span className="text-cyan-400">{px()}</span>
            </div>

            <p className="text-[11px] text-zinc-500">
              Trims the proof background to the artwork, then crops to the exact rectangle — deterministic, no AI.
            </p>
            <Button onClick={onExport} disabled={exporting || !file} className="w-full gap-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white h-11">
              {exporting ? <><Loader2 className="w-4 h-4 animate-spin" /> Exporting…</> : <>Export Print Panel</>}
            </Button>
          </Card>

          {/* Preview / result */}
          <Card className="bg-zinc-900 border-zinc-800 p-4">
            {result ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm">
                    <div className="font-semibold">{result.view_name} — {result.pixel_width}×{result.pixel_height}px</div>
                    <div className="text-[11px] text-zinc-500">
                      {result.effective_dpi} DPI{result.capped ? ` (capped from ${result.requested_dpi})` : ""} · {result.fit_mode} · {result.bleed_inches}" bleed
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={onRepair} disabled={repairing} className="gap-1.5"
                      title="Optional: AI repairs ONLY the enclosed cutout holes (wheel wells) — never the whole design.">
                      {repairing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />} Repair Cutouts (AI)
                    </Button>
                    <Button asChild size="sm" className="gap-1.5">
                      <a href={result.url} target="_blank" rel="noreferrer"><Download className="w-3.5 h-3.5" /> Download</a>
                    </Button>
                  </div>
                </div>
                <img src={result.pngUrl} alt="exported panel" className="w-full rounded-lg border border-zinc-800 bg-white" />
                <div className="flex items-end gap-2 border-t border-zinc-800 pt-3">
                  <div className="flex-1">
                    <Label className="text-xs font-semibold mb-1.5 block">Use as Final Panel — Order #</Label>
                    <Input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="RP-100889" className="bg-secondary border-border/50 h-10" />
                  </div>
                  <Button onClick={onSendToWrapBox} disabled={sending} className="gap-1.5 h-10">
                    {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                    Send to Production Pack / WrapBox
                  </Button>
                </div>
              </div>
            ) : previewUrl ? (
              <div className="space-y-2">
                <div className="text-sm text-zinc-400">Source preview — export to see the exact print rectangle</div>
                <img src={previewUrl} alt="source" className="w-full rounded-lg border border-zinc-800 bg-white" />
              </div>
            ) : (
              <div className="h-full min-h-[300px] flex items-center justify-center text-zinc-500 text-sm">
                Upload a finished flat panel to begin.
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
