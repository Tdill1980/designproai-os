/**
 * CutContourPanel — the workbench surface for "Design Setup / File Output"
 * (SKU DSFO) cut-contour orders. These are NOT creative design jobs: the
 * customer already PROVIDED their finished artwork, so A.C.E never runs (see the
 * cut-contour gate in approvepro-autogen-design). Instead of the generated
 * artboard, the team gets:
 *   • the customer's provided files (print preview + downloadable vector source)
 *   • a one-click DETERMINISTIC "Build Cut-Contour Print File" action
 *     (cut-contour-build) that lays the art out at true scale per panel with a
 *     magenta CutContour keyline + bleed + registration marks → print-ready PDF.
 *
 * White-UI standard: white surface, gray-900/600/500 text, #3b82f6 → #ec4899
 * gradient accent only.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Scissors, FileText, Download, ImageIcon, Loader2, ExternalLink } from "lucide-react";

interface CutContourMeta {
  customer_uploads?: string[];
  customer_documents?: string[];
  cut_contour_pdf_url?: string;
  wpw_order_number?: string | number;
}

const isImage = (u: string) => /\.(jpe?g|png|webp|gif)(\?|$)/i.test(u);
const fileName = (u: string) => {
  try {
    return decodeURIComponent(u.split("?")[0].split("/").pop() || u);
  } catch {
    return u;
  }
};
const downloadHref = (u: string) => `${u}${u.includes("?") ? "&" : "?"}download`;

export function CutContourPanel({ proofId, metadata }: { proofId: string; metadata: CutContourMeta }) {
  const { toast } = useToast();
  const uploads = Array.isArray(metadata?.customer_uploads) ? metadata.customer_uploads : [];
  const documents = Array.isArray(metadata?.customer_documents) ? metadata.customer_documents : [];
  const [pdfUrl, setPdfUrl] = useState<string | null>(metadata?.cut_contour_pdf_url || null);
  const [building, setBuilding] = useState(false);

  const previewImg = uploads.find(isImage);

  const build = async () => {
    setBuilding(true);
    try {
      const { data, error } = await supabase.functions.invoke("cut-contour-build", {
        body: { proof_id: proofId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const url = (data as any)?.pdfUrl;
      if (!url) throw new Error("No PDF returned");
      setPdfUrl(url);
      toast({
        title: "File output ready",
        description: `${(data as any)?.panels ?? 0} panel page(s) built${(data as any)?.dimsKnown ? " at true scale" : " (assumed dims — verify)"}.`,
      });
    } catch (e: any) {
      toast({ title: "Build failed", description: e?.message || "Could not build the cut-contour file.", variant: "destructive" });
    } finally {
      setBuilding(false);
    }
  };

  return (
    <div className="mx-3 mt-3 rounded-lg border border-fuchsia-200 bg-white p-3 space-y-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#3b82f6] to-[#ec4899] flex items-center justify-center shadow-sm shrink-0 text-white">
          <Scissors className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wider text-gray-900">File Output</p>
          <p className="text-[11px] text-gray-500">Customer provided the design — no A.C.E generation. Build the print-ready cut file.</p>
        </div>
      </div>

      {/* Customer-provided files */}
      <div className="rounded-md border border-gray-200 bg-gray-50/60 p-2.5 space-y-2">
        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-600">Customer-provided artwork</p>
        {previewImg && (
          <a href={previewImg} target="_blank" rel="noreferrer" className="block">
            <img src={previewImg} alt="Customer print preview" className="w-full max-h-56 object-contain rounded bg-white border border-gray-200" />
          </a>
        )}
        <div className="flex flex-wrap gap-1.5">
          {uploads.map((u, i) => (
            <a
              key={`u${i}`}
              href={downloadHref(u)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white text-gray-700 text-[10px] font-semibold px-2 py-1 hover:bg-gray-50"
            >
              <ImageIcon className="w-3 h-3" /> {fileName(u).slice(0, 24)}
            </a>
          ))}
          {documents.map((d, i) => (
            <a
              key={`d${i}`}
              href={downloadHref(d)}
              target="_blank"
              rel="noreferrer"
              title="Vector source — the master for the final cut path"
              className="inline-flex items-center gap-1 rounded-md border border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700 text-[10px] font-semibold px-2 py-1 hover:bg-fuchsia-100"
            >
              <FileText className="w-3 h-3" /> {fileName(d).slice(0, 24)}
            </a>
          ))}
          {uploads.length === 0 && documents.length === 0 && (
            <span className="text-[11px] text-gray-500">No files on the order yet.</span>
          )}
        </div>
      </div>

      {/* Build + result */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          type="button"
          onClick={build}
          disabled={building || uploads.length === 0}
          className="inline-flex items-center gap-1.5 rounded-md bg-gradient-to-r from-[#3b82f6] to-[#ec4899] text-white text-[11px] font-bold px-3 py-1.5 disabled:opacity-50"
        >
          {building ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
          {building ? "Building…" : pdfUrl ? "Rebuild File Output" : "Build File Output"}
        </button>
        {pdfUrl && (
          <>
            <a
              href={pdfUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 text-emerald-700 text-[11px] font-bold px-3 py-1.5 hover:bg-emerald-100"
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open PDF
            </a>
            <a
              href={downloadHref(pdfUrl)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white text-gray-700 text-[11px] font-bold px-3 py-1.5 hover:bg-gray-50"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </a>
          </>
        )}
      </div>
      <p className="text-[10px] text-gray-500 leading-relaxed">
        Print-ready PDF: artwork laid out at true scale per panel with a magenta <span className="font-semibold">CutContour</span> keyline (100% Magenta spot),
        0.5″ bleed, and registration marks. The customer's vector source is the master for the final cut path.
      </p>
    </div>
  );
}

export default CutContourPanel;
