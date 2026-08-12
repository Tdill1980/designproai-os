/**
 * WpwProofSheet — /wpw-proof/:proofId
 *
 * Generates a WePrintWraps proof-approval sheet in Lance's required format:
 * the "DON'T PAY TWICE" approval disclaimer, a color guide, the design views
 * with per-panel dimension + sq ft callouts, material totals, vehicle
 * length/wheelbase, order #, and the Social Collaboration footer.
 *
 * Designers open it from a proof, fill in the sizing/colors/totals (saved to
 * the proof's metadata so it persists), then Print / Save as PDF and send.
 *
 * White UI standard. No render/panelizer pipeline files are touched — this
 * reads the proof's existing renders and lets the designer enter the print
 * data, exactly as the WPW workflow does today.
 */

import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Helmet } from "react-helmet-async";
import { supabase } from "@/integrations/supabase/client";
import { pdfFirstPageToDataUrl, isPdfPath } from "@/lib/pdf-first-page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, X, Printer, Save } from "lucide-react";

interface ColorRow { name: string; hex: string; }
interface ViewRow { url: string; label: string; caption: string; }
interface SheetData {
  vehicleName: string;
  lengthIn: string;
  wheelbaseIn: string;
  materialName: string;
  materialSqft: string;
  windowPerfSqft: string;
  colors: ColorRow[];
  views: ViewRow[];
}

const DISCLAIMER_LINES = [
  "Your approval, either in writing or by utilizing our online proofing system, constitutes acceptance of the final design. We Print Wraps will not be liable for errors, omissions, or legal and ethical compliance after approval. It is your responsibility to confirm spelling, placement, sizing, colors, etc.",
  "Ensure that the template (Make, Model, Year, Wheelbase, etc) and panel sizes match your vehicle.",
  "We DO NOT have access to the actual vehicle, therefore it is your duty to confirm the size, positioning of visual elements, text, colors, and panel sizing are ready for print.",
  "Changes made after proof approval or change requests exceeding the proof revision limit will result in additional charges.",
];

const emptySheet: SheetData = {
  vehicleName: "", lengthIn: "", wheelbaseIn: "",
  materialName: "Avery MPI 1105", materialSqft: "", windowPerfSqft: "",
  colors: [], views: [],
};

export default function WpwProofSheet() {
  const { proofId } = useParams<{ proofId: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orderNumber, setOrderNumber] = useState<string>("");
  const [sheet, setSheet] = useState<SheetData>(emptySheet);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!proofId) return;
      setLoading(true);
      const { data: proof } = await supabase
        .from("proof_approvals" as any)
        .select("id, design_name, vehicle_year, vehicle_make, vehicle_model, metadata")
        .eq("id", proofId)
        .maybeSingle();
      const { data: version } = await supabase
        .from("proof_versions" as any)
        .select("render_urls, uploaded_file_paths")
        .eq("proof_id", proofId)
        .eq("is_active", true)
        .maybeSingle();
      if (cancelled) return;

      const md = (proof as any)?.metadata || {};
      setOrderNumber(String(md.wpw_order_number || md.wpw_woo_order_id || md.woo_order_number || ""));

      // Resolve every image on the active version into a DISPLAYABLE url.
      // render_urls are already full public urls. Uploaded 2D proofs live in
      // the PRIVATE proof-uploads bucket, so a raw storage path won't render
      // in <img> — it needs a signed url, or the sheet shows blank. PDFs can't
      // render in an <img> at all, so their first page is rasterized to a PNG.
      const resolveUrl = async (p: string): Promise<string | null> => {
        if (!p) return null;
        let url = p;
        if (!/^https?:\/\//i.test(p)) {
          const { data } = await supabase.storage
            .from("proof-uploads")
            .createSignedUrl(p, 60 * 60 * 24 * 7);
          url = data?.signedUrl || "";
        }
        if (!url) return null;
        if (isPdfPath(p) || isPdfPath(url)) {
          const png = await pdfFirstPageToDataUrl(url);
          return png || url;
        }
        return url;
      };
      const imageUrls: string[] = [];
      const ru = (version as any)?.render_urls || {};
      for (const v of Object.values(ru)) {
        if (typeof v === "string" && v && !imageUrls.includes(v)) imageUrls.push(v);
      }
      for (const p of ((version as any)?.uploaded_file_paths || [])) {
        if (typeof p !== "string" || !p) continue;
        const url = await resolveUrl(p);
        if (url && !imageUrls.includes(url)) imageUrls.push(url);
      }
      if (cancelled) return;

      const savedViews = Array.isArray(md.proof_sheet?.views) ? md.proof_sheet.views : [];
      // Use the saved sheet only when it actually has views. An empty saved
      // sheet must NOT hide a freshly uploaded 2D proof — fall through and
      // seed the views from the active version's images instead.
      if (md.proof_sheet && savedViews.length > 0) {
        setSheet({ ...emptySheet, ...md.proof_sheet });
      } else {
        const vehicleName =
          (md.proof_sheet?.vehicleName) ||
          [proof?.vehicle_year, proof?.vehicle_make, proof?.vehicle_model]
            .filter(Boolean).join(" ") || (proof as any)?.design_name || "";
        const labels = ["Driver Side", "Passenger Side", "Front", "Rear", "Roof", "Hood"];
        setSheet({
          ...emptySheet,
          ...(md.proof_sheet || {}),
          vehicleName,
          views: imageUrls.slice(0, 8).map((url, i) => ({ url, label: labels[i] || `View ${i + 1}`, caption: "" })),
        });
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [proofId]);

  const set = (patch: Partial<SheetData>) => setSheet((s) => ({ ...s, ...patch }));

  const save = async () => {
    if (!proofId) return;
    setSaving(true);
    try {
      const { data: cur } = await supabase
        .from("proof_approvals" as any).select("metadata").eq("id", proofId).maybeSingle();
      const md = { ...((cur as any)?.metadata || {}), proof_sheet: sheet };
      await supabase.from("proof_approvals" as any).update({ metadata: md }).eq("id", proofId);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white text-gray-900 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading proof…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Helmet><title>WPW Proof Sheet #{orderNumber || proofId}</title></Helmet>

      {/* ── Editor controls (hidden when printing) ── */}
      <div className="print:hidden border-b border-gray-200 bg-gray-50">
        <div className="h-1 bg-gradient-to-r from-[#3b82f6] to-[#ec4899]" />
        <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h1 className="text-lg font-extrabold tracking-tight">
              WPW Proof Sheet <span className="text-gray-400 font-mono text-sm">#{orderNumber || "—"}</span>
            </h1>
            <div className="flex gap-2">
              <Button onClick={save} disabled={saving} variant="outline" className="border-gray-300 text-gray-700">
                {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}Save
              </Button>
              <Button onClick={() => window.print()} className="bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white border-0">
                <Printer className="w-4 h-4 mr-1" />Print / Save PDF
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Field label="Vehicle / template" value={sheet.vehicleName} onChange={(v) => set({ vehicleName: v })} />
            <Field label="Overall length (in)" value={sheet.lengthIn} onChange={(v) => set({ lengthIn: v })} />
            <Field label="Wheelbase (in)" value={sheet.wheelbaseIn} onChange={(v) => set({ wheelbaseIn: v })} />
            <Field label="Material name" value={sheet.materialName} onChange={(v) => set({ materialName: v })} />
            <Field label="Material total sq ft" value={sheet.materialSqft} onChange={(v) => set({ materialSqft: v })} />
            <Field label="Window perf sq ft" value={sheet.windowPerfSqft} onChange={(v) => set({ windowPerfSqft: v })} />
          </div>

          {/* Color guide editor */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">Color guide</span>
              <button type="button" onClick={() => set({ colors: [...sheet.colors, { name: "", hex: "#000000" }] })}
                className="text-xs text-blue-600 font-semibold inline-flex items-center gap-1"><Plus className="w-3 h-3" />Add color</button>
            </div>
            <div className="space-y-1.5">
              {sheet.colors.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input type="color" value={c.hex} onChange={(e) => { const colors = [...sheet.colors]; colors[i] = { ...c, hex: e.target.value }; set({ colors }); }} className="w-8 h-8 rounded border border-gray-200" />
                  <Input value={c.name} placeholder="Color name (e.g. Matte Charcoal)" onChange={(e) => { const colors = [...sheet.colors]; colors[i] = { ...c, name: e.target.value }; set({ colors }); }} className="h-8 bg-white border-gray-200" />
                  <button type="button" onClick={() => set({ colors: sheet.colors.filter((_, j) => j !== i) })} className="text-gray-400 hover:text-red-600"><X className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          {/* Per-view caption editor */}
          <div>
            <span className="text-xs font-semibold uppercase tracking-wider text-gray-500">View labels & panel sizing</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
              {sheet.views.map((v, i) => (
                <div key={i} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white p-2">
                  <img src={v.url} alt="" className="w-12 h-9 object-cover rounded border border-gray-200 shrink-0" />
                  <div className="flex-1 min-w-0 space-y-1">
                    <Input value={v.label} placeholder="View label" onChange={(e) => { const views = [...sheet.views]; views[i] = { ...v, label: e.target.value }; set({ views }); }} className="h-7 text-xs bg-white border-gray-200" />
                    <Input value={v.caption} placeholder={'e.g. 161.5" Wide X 55" Height = 61.7 sq ft'} onChange={(e) => { const views = [...sheet.views]; views[i] = { ...v, caption: e.target.value }; set({ views }); }} className="h-7 text-xs bg-white border-gray-200" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── The printable proof sheet ── */}
      <div className="max-w-5xl mx-auto p-5">
        {/* Disclaimer banner */}
        <div className="border-2 border-gray-900 rounded-sm flex items-stretch overflow-hidden mb-4">
          <div className="bg-[#ec4899] text-white font-extrabold text-center px-3 py-2 flex items-center justify-center text-sm leading-tight shrink-0" style={{ width: 96 }}>
            DON'T PAY TWICE!!
          </div>
          <div className="px-3 py-2">
            <p className="text-[#ec4899] font-bold text-xs mb-0.5">ARTWORK AND PROOF APPROVAL</p>
            {DISCLAIMER_LINES.map((l, i) => (
              <p key={i} className={`text-[10px] leading-snug ${i === 1 || i === 2 ? "text-[#ec4899] font-semibold italic" : "text-gray-900"}`}>{l}</p>
            ))}
          </div>
        </div>

        {/* Header row: color guide + vehicle + totals */}
        <div className="flex items-start justify-between gap-4 mb-3 flex-wrap">
          <div>
            {sheet.colors.length > 0 && (
              <div className="border border-gray-200 rounded-md p-2 mb-2">
                <p className="text-[9px] font-bold uppercase tracking-wider text-gray-500 mb-1">Color Guide</p>
                {sheet.colors.map((c, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-[11px] text-gray-900">
                    <span className="w-3.5 h-3.5 rounded-full border border-gray-300" style={{ background: c.hex }} />
                    {c.name || "—"}
                  </div>
                ))}
              </div>
            )}
            {sheet.vehicleName && <p className="text-base font-bold text-gray-900">{sheet.vehicleName}</p>}
          </div>
          <div className="text-right">
            {sheet.materialSqft && (
              <p className="text-xl font-extrabold bg-gradient-to-r from-[#3b82f6] to-[#ec4899] bg-clip-text text-transparent">
                Total {sheet.materialName} = {sheet.materialSqft} sq ft
              </p>
            )}
            {sheet.windowPerfSqft && (
              <p className="text-base font-bold text-[#10b981]">Total Window Perf Laminated = {sheet.windowPerfSqft} sq ft</p>
            )}
          </div>
        </div>

        {/* Views grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {sheet.views.map((v, i) => (
            <div key={i} className="border border-gray-200 rounded-md p-2">
              <div className="relative">
                <img src={v.url} alt={v.label} className="w-full object-contain bg-gray-50 rounded" />
              </div>
              <p className="text-[11px] font-semibold text-gray-900 mt-1">{v.label}</p>
              {v.caption && <p className="text-[11px] text-[#3b82f6] font-semibold">{v.caption}</p>}
            </div>
          ))}
        </div>

        {/* Footer: length/wheelbase + order # */}
        <div className="flex items-center justify-between mt-4 pt-3 border-t border-gray-200 flex-wrap gap-2">
          <div className="text-sm text-gray-700">
            {sheet.lengthIn && <span className="font-semibold">{sheet.lengthIn}"</span>}
            {sheet.wheelbaseIn && <span className="ml-3">{sheet.wheelbaseIn}" Wheelbase</span>}
          </div>
          <div className="text-2xl font-extrabold text-[#3b82f6]">Order #{orderNumber || "—"}</div>
        </div>

        {/* Social collaboration */}
        <div className="mt-4 border border-gray-200 rounded-md p-3 text-center">
          <p className="text-sm font-bold text-gray-900">Social Collaboration</p>
          <p className="text-[11px] text-gray-600">We love to share your work! When you have completed your installation, please send us pictures or videos.</p>
          <p className="text-[11px] text-gray-600">If you are posting on Social Media and would like to tag us, please tag us <span className="font-semibold">@weprintwraps</span>.</p>
          <p className="text-sm font-extrabold mt-1"><span className="text-[#3b82f6]">WePrint</span><span className="text-[#ec4899]">Wraps</span>.com</p>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-8 mt-0.5 bg-white border-gray-200 text-gray-900" />
    </label>
  );
}
