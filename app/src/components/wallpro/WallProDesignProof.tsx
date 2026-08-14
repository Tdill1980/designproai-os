/**
 * WallProDesignProof
 *
 * Official, printable design proof for WallPro renders. Opens in a dialog with
 * a print-ready layout (header, hero, before/after, project + material specs,
 * approval section). Exports to PDF via html2canvas + jsPDF, mirroring the
 * pattern used by ProfessionalProofSheet for vehicle proofs.
 */

import { useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Download, Printer, FileCheck2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { WALL_FILM } from "@/lib/quick-quote";

const GRADIENT = "linear-gradient(135deg, #0EA5E9, #8B5CF6, #D946EF)";

export interface WallProDesignProofProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designName: string;
  renderUrl: string | null;
  beforeUrl: string | null;          // wall photo (if uploaded)
  studioRoomLabel?: string | null;   // e.g. "Modern Office" when no wall photo
  heightInches: number;
  widthInches: number;
  totalSqFt: number;
  totalLinearFeet: number;
  panelsNeeded: number;
  materialCost: number;
  promptText?: string;
  shopName?: string;
  customerName?: string;
}

const TERMS = `By signing below, the customer approves the design, dimensions, and material spec shown on this proof for production. Digital previews are approximate; final color, gloss, and texture may vary slightly from screen. Changes after approval may incur additional charges and lead time.`;

export const WallProDesignProof = ({
  open,
  onOpenChange,
  designName,
  renderUrl,
  beforeUrl,
  studioRoomLabel,
  heightInches,
  widthInches,
  totalSqFt,
  totalLinearFeet,
  panelsNeeded,
  materialCost,
  promptText,
  shopName,
  customerName,
}: WallProDesignProofProps) => {
  const proofRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const [isGenerating, setIsGenerating] = useState(false);

  // Stable proof number derived from time + design hash; safe for one render session.
  const proofNumber = `WP-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(new Date().getDate()).padStart(2, "0")}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const issuedDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  const captureProof = async (): Promise<jsPDF | null> => {
    if (!proofRef.current) return null;

    const images = proofRef.current.querySelectorAll("img");
    await Promise.all(
      Array.from(images).map((img) =>
        img.complete ? Promise.resolve() : new Promise((resolve) => { img.onload = resolve; img.onerror = resolve; })
      )
    );

    const canvas = await html2canvas(proofRef.current, {
      scale: 2,
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#FFFFFF",
      logging: false,
    });

    const imgData = canvas.toDataURL("image/jpeg", 0.92);
    const pdfWidth = 1120;
    const pdfHeight = pdfWidth * (canvas.height / canvas.width);

    const pdf = new jsPDF({
      orientation: pdfWidth > pdfHeight ? "landscape" : "portrait",
      unit: "pt",
      format: [pdfWidth, pdfHeight],
    });
    pdf.addImage(imgData, "JPEG", 0, 0, pdfWidth, pdfHeight);
    return pdf;
  };

  const handleDownload = async () => {
    setIsGenerating(true);
    try {
      const pdf = await captureProof();
      if (!pdf) throw new Error("Could not capture proof");
      const safeName = (designName || "WallPro Design").replace(/[^a-zA-Z0-9 _\-.]/g, "");
      pdf.save(`${safeName} — Official Proof ${proofNumber}.pdf`);
      toast({ title: "Proof downloaded", description: `${proofNumber}.pdf saved` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not generate PDF";
      toast({ title: "Download failed", description: msg, variant: "destructive" });
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePrint = () => {
    if (!proofRef.current) return;
    const w = window.open("", "_blank", "width=1100,height=850");
    if (!w) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print the proof", variant: "destructive" });
      return;
    }
    w.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${designName || "WallPro"} — Official Design Proof</title>
          <style>
            body { margin: 0; padding: 24px; font-family: 'Inter', system-ui, sans-serif; background: #FFF; color: #111; }
            @media print { body { padding: 0; } }
          </style>
        </head>
        <body>${proofRef.current.outerHTML}</body>
      </html>
    `);
    w.document.close();
    setTimeout(() => { w.focus(); w.print(); }, 400);
  };

  const beforeLabel = beforeUrl ? "Client wall (uploaded)" : (studioRoomLabel ? `${studioRoomLabel} (studio render)` : "Reference wall");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileCheck2 className="w-5 h-5" /> Official WallPro Design Proof
          </DialogTitle>
        </DialogHeader>

        {/* Action bar */}
        <div className="flex items-center gap-2 mb-3">
          <Button onClick={handleDownload} disabled={isGenerating || !renderUrl} className="gap-2">
            {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            Download PDF
          </Button>
          <Button onClick={handlePrint} variant="outline" disabled={!renderUrl} className="gap-2">
            <Printer className="w-4 h-4" /> Print
          </Button>
          <div className="ml-auto text-xs text-muted-foreground">Proof #{proofNumber} · {issuedDate}</div>
        </div>

        {/* Proof body — captured 1:1 to PDF */}
        <div
          ref={proofRef}
          style={{
            width: 1120,
            margin: "0 auto",
            background: "#FFFFFF",
            color: "#111",
            fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
            padding: 36,
            border: "1px solid #E5E7EB",
            borderRadius: 8,
          }}
        >
          {/* HEADER */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", paddingBottom: 16, borderBottom: "2px solid #111" }}>
            <div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <div style={{ fontFamily: "'League Spartan', sans-serif", fontSize: 32, fontWeight: 800, color: "#111", letterSpacing: "-0.02em" }}>
                  Wall<span style={{ background: GRADIENT, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>Pro</span>
                </div>
                <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 600, letterSpacing: "0.1em" }}>OFFICIAL DESIGN PROOF</div>
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginTop: 4 }}>DesignProAI · AI-Powered Wall Wrap Designer</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, letterSpacing: "0.08em" }}>PROOF NUMBER</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#111", fontFamily: "'League Spartan', sans-serif" }}>{proofNumber}</div>
              <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>Issued {issuedDate}</div>
            </div>
          </div>

          {/* META ROW */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16, padding: "16px 0", borderBottom: "1px solid #E5E7EB" }}>
            <div>
              <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 2 }}>DESIGN NAME</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{designName || "Wall Wrap Design"}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 2 }}>SHOP / STUDIO</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{shopName || "—"}</div>
            </div>
            <div>
              <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 2 }}>CUSTOMER</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{customerName || "—"}</div>
            </div>
          </div>

          {/* HERO RENDER */}
          <div style={{ padding: "20px 0" }}>
            <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 8 }}>APPROVED DESIGN</div>
            <div style={{ width: "100%", aspectRatio: "16/9", borderRadius: 8, overflow: "hidden", background: "#F3F4F6", border: "1px solid #E5E7EB" }}>
              {renderUrl ? (
                <img src={renderUrl} alt={designName} crossOrigin="anonymous" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              ) : (
                <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#9CA3AF", fontSize: 14 }}>No render</div>
              )}
            </div>
          </div>

          {/* BEFORE / AFTER MINI */}
          {(beforeUrl || studioRoomLabel) && renderUrl && (
            <div style={{ paddingBottom: 20 }}>
              <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 8 }}>BEFORE / AFTER</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div style={{ position: "relative", aspectRatio: "16/9", borderRadius: 6, overflow: "hidden", background: "#F3F4F6", border: "1px solid #E5E7EB" }}>
                  {beforeUrl ? (
                    <img src={beforeUrl} alt="Before" crossOrigin="anonymous" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  ) : (
                    <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#6B7280", fontSize: 12, padding: 12, textAlign: "center" }}>{studioRoomLabel} · studio reference</div>
                  )}
                  <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 4, background: "rgba(0,0,0,0.7)", fontSize: 9, fontWeight: 700, color: "#FFF", letterSpacing: "0.08em" }}>BEFORE</div>
                </div>
                <div style={{ position: "relative", aspectRatio: "16/9", borderRadius: 6, overflow: "hidden", background: "#F3F4F6", border: "1px solid #E5E7EB" }}>
                  <img src={renderUrl} alt="After" crossOrigin="anonymous" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  <div style={{ position: "absolute", top: 8, left: 8, padding: "2px 8px", borderRadius: 4, background: GRADIENT, fontSize: 9, fontWeight: 700, color: "#FFF", letterSpacing: "0.08em" }}>AFTER</div>
                </div>
              </div>
              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 6 }}>Reference: {beforeLabel}</div>
            </div>
          )}

          {/* SPECS */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, padding: "0 0 20px" }}>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 8 }}>PROJECT DIMENSIONS</div>
              <table style={{ width: "100%", fontSize: 12, color: "#111", borderCollapse: "collapse" }}>
                <tbody>
                  <SpecRow label="Wall height" value={`${heightInches}"`} />
                  <SpecRow label="Wall width" value={`${widthInches}"`} />
                  <SpecRow label="Total square footage" value={`${totalSqFt} sq ft`} />
                  <SpecRow label="Linear feet (panel runs)" value={`${totalLinearFeet} ln ft`} />
                  <SpecRow label="Panels needed" value={`${panelsNeeded} × ${WALL_FILM.panelWidthInches}" panels`} />
                </tbody>
              </table>
            </div>
            <div>
              <div style={{ fontSize: 11, color: "#6B7280", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 8 }}>MATERIAL SPECIFICATION</div>
              <table style={{ width: "100%", fontSize: 12, color: "#111", borderCollapse: "collapse" }}>
                <tbody>
                  <SpecRow label="Film" value={WALL_FILM.name} />
                  <SpecRow label="Finish" value={WALL_FILM.finish} />
                  <SpecRow label="Panel width" value={`${WALL_FILM.panelWidthInches}"`} />
                  <SpecRow label="Lamination" value="None required" />
                  <SpecRow label="Install method" value={WALL_FILM.installType} />
                </tbody>
              </table>
            </div>
          </div>

          {/* PROMPT / DESIGN BRIEF */}
          {promptText && (
            <div style={{ padding: "16px 18px", background: "#F9FAFB", borderRadius: 6, border: "1px solid #E5E7EB", marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: "#6B7280", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4 }}>DESIGN BRIEF</div>
              <div style={{ fontSize: 12, color: "#374151", fontStyle: "italic", lineHeight: 1.5 }}>"{promptText}"</div>
            </div>
          )}

          {/* PRICING */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", background: "#111", color: "#FFF", borderRadius: 6, marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 700, letterSpacing: "0.05em" }}>PRINT & SHIP</div>
              <div style={{ fontSize: 12, color: "#D1D5DB", marginTop: 2 }}>{WALL_FILM.name} · ${WALL_FILM.pricePerLinearFoot}/ln ft wholesale</div>
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "'League Spartan', sans-serif" }}>${materialCost.toFixed(2)}</div>
          </div>

          {/* TERMS */}
          <div style={{ fontSize: 10, color: "#6B7280", lineHeight: 1.6, marginBottom: 18, padding: "12px 14px", background: "#FAFAFA", borderRadius: 6, border: "1px solid #F3F4F6" }}>
            <strong style={{ color: "#374151" }}>Terms of approval:</strong> {TERMS}
          </div>

          {/* SIGNATURES */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, paddingTop: 12 }}>
            <div>
              <div style={{ borderBottom: "1px solid #111", height: 36 }} />
              <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>Customer signature</div>
              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>Print name & date</div>
            </div>
            <div>
              <div style={{ borderBottom: "1px solid #111", height: 36 }} />
              <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>Designer / Shop authorization</div>
              <div style={{ fontSize: 10, color: "#9CA3AF", marginTop: 2 }}>{shopName || "DesignProAI"} · {issuedDate}</div>
            </div>
          </div>

          {/* FOOTER */}
          <div style={{ marginTop: 24, paddingTop: 12, borderTop: "1px solid #E5E7EB", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: "#9CA3AF" }}>
            <div>DesignProAI · WallPro · restyleproai.com</div>
            <div>Proof #{proofNumber} · Page 1 of 1</div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

const SpecRow = ({ label, value }: { label: string; value: string }) => (
  <tr>
    <td style={{ padding: "5px 0", color: "#6B7280", fontSize: 11, borderBottom: "1px solid #F3F4F6" }}>{label}</td>
    <td style={{ padding: "5px 0", color: "#111", fontSize: 12, fontWeight: 600, textAlign: "right", borderBottom: "1px solid #F3F4F6" }}>{value}</td>
  </tr>
);

export default WallProDesignProof;
