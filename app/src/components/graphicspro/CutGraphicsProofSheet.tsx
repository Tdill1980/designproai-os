import { useMemo } from "react";
import jsPDF from "jspdf";
import { Loader2, Download, AlertTriangle, Scissors, Ruler, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import type { CutGraphicsProof, CutGraphicElement } from "@/hooks/useCutGraphicsProof";

interface Props {
  proof: CutGraphicsProof | null;
  isGenerating: boolean;
  onRegenerate?: () => void;
  /** Total wrap/graphics coverage in sq ft (from GENIE vehicle dims). Shown in
   *  the header + PDF so the proof calls out total square footage. */
  totalSqFt?: number | null;
}

/** Orient a piece so its smaller side is the "height" within the plotter band. */
function oriented(el: CutGraphicElement, plotterMax: number) {
  let w = el.widthInches;
  let h = el.heightInches;
  let rotated = false;
  // If it's too tall to fit but would fit rotated, rotate it.
  if (h > plotterMax && w <= plotterMax) {
    [w, h] = [h, w];
    rotated = true;
  }
  return { w, h, rotated };
}

/**
 * CutGraphicsProofSheet — the dimensioned Cut Graphics Proof (Phase 3a).
 *
 * Specs every cut graphic (overall W x H + letter height) to real scale,
 * flags letters under 2", previews how the pieces nest within the 54" plotter
 * height, and exports a printable proof PDF. The layered vector files and the
 * optimized nester are the next sub-phases.
 */
export const CutGraphicsProofSheet = ({ proof, isGenerating, onRegenerate, totalSqFt }: Props) => {
  const GAP = 1; // inches of cutting clearance between nested pieces (preview)

  const nesting = useMemo(() => {
    if (!proof?.elements?.length) return null;
    const plotterMax = proof.plotterMaxHeightInches || 59;
    let lengthIn = 0;
    let tallest = 0;
    const placed = proof.elements.map((el) => {
      const o = oriented(el, plotterMax);
      const x = lengthIn;
      lengthIn += o.w + GAP;
      tallest = Math.max(tallest, Math.min(o.h, plotterMax));
      return { el, ...o, x };
    });
    const rollLength = Math.max(0, lengthIn - GAP);
    return { plotterMax, placed, rollLengthInches: rollLength, tallestInches: tallest };
  }, [proof]);

  const downloadPdf = () => {
    if (!proof) return;
    try {
      const pdf = new jsPDF({ unit: "pt", format: "letter" });
      const M = 40;
      let y = M;
      const line = (txt: string, size = 10, bold = false) => {
        pdf.setFont("helvetica", bold ? "bold" : "normal");
        pdf.setFontSize(size);
        pdf.text(txt, M, y);
        y += size + 6;
      };
      pdf.setTextColor(20);
      line("CUT GRAPHICS PROOF", 16, true);
      line("CUT CONTOUR GRAPHICS — plotter-cut vinyl, not a printed wrap", 10, true);
      line(`${proof.vehicle || ""}  ·  ${proof.designName || "Custom Graphics"}`, 11);
      line(
        `Reference: driver side ${proof.reference.sideWidthInches}" x ${proof.reference.sideHeightInches}"  ·  Plotter height: ${proof.plotterMaxHeightInches}"`,
        9,
      );
      if (typeof totalSqFt === "number" && totalSqFt > 0) {
        line(`Total coverage: approx ${Math.round(totalSqFt)} sq ft`, 9, true);
      }
      y += 6;

      line("GRAPHIC SPECIFICATIONS", 12, true);
      pdf.setDrawColor(200);
      pdf.line(M, y - 2, 555, y - 2);
      y += 6;
      line("Graphic                         Type      W x H (in)        Letter H", 9, true);
      proof.elements.forEach((el) => {
        const name = (el.label || "Graphic").slice(0, 28).padEnd(30, " ");
        const type = el.type.padEnd(9, " ");
        const wh = `${el.widthInches}" x ${el.heightInches}"`.padEnd(16, " ");
        const lh = el.letterHeightInches != null ? `${el.letterHeightInches}"` : "—";
        const flag = el.belowMinLetter ? "  ⚠ < 2\"" : (!el.fitsPlotter ? "  ⚠ tile" : "");
        line(`${name}${type}${wh}${lh}${flag}`, 9);
      });
      y += 8;

      if (nesting) {
        line("NESTING (preview)", 12, true);
        line(
          `Fits within ${nesting.plotterMax}" plotter height · approx ${Math.ceil(nesting.rollLengthInches)}" (${(nesting.rollLengthInches / 12).toFixed(1)} ft) of roll length`,
          9,
        );
        y += 6;
      }

      if (proof.warnings?.length) {
        line("NOTES", 12, true);
        proof.warnings.forEach((w) => {
          const wrapped = pdf.splitTextToSize(`• ${w}`, 515) as string[];
          wrapped.forEach((w2) => line(w2, 9));
        });
        y += 4;
      }

      line("CUT FILE SUBMISSION", 12, true);
      [
        "Cut lines must use a spot color named 'CutContour' (capital C's).",
        "CutContour = Spot, CMYK 0 / 100 / 0 / 0 (100% magenta), 0.25pt hairline stroke, no fill, on its own layer.",
        "Add a black bleed layer (offset the cut path ~0.1–0.2\", filled black).",
        "Letters under 2\" — contact us prior to ordering.",
      ].forEach((t) => {
        const wrapped = pdf.splitTextToSize(`• ${t}`, 515) as string[];
        wrapped.forEach((t2) => line(t2, 9));
      });

      pdf.save(`Cut-Graphics-Proof-${(proof.vehicle || "vehicle").replace(/\s+/g, "-")}.pdf`);
      toast({ title: "Proof downloaded", description: "Cut Graphics Proof PDF saved." });
    } catch (err: any) {
      toast({ title: "Download failed", description: err?.message || "Try again.", variant: "destructive" });
    }
  };

  if (isGenerating && !proof) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
        <p className="text-sm text-muted-foreground">Speccing each graphic to real scale…</p>
      </div>
    );
  }

  if (!proof) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
        <Scissors className="w-10 h-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground max-w-sm">
          Build a dimensioned cut graphics proof — each graphic specced to scale with letter heights and plotter nesting.
        </p>
        {onRegenerate && (
          <Button onClick={onRegenerate} className="gap-2">
            <Ruler className="w-4 h-4" /> Build Cut Graphics Proof
          </Button>
        )}
      </div>
    );
  }

  const hasGraphics = proof.elements.length > 0;

  return (
    <div className="w-full bg-background p-4 sm:p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-bold flex items-center gap-2">
            <Scissors className="w-5 h-5 text-blue-500" /> Cut Graphics Proof
          </h3>
          <span className="inline-flex items-center gap-1 mt-1 rounded-full bg-purple-500/10 border border-purple-500/40 text-purple-600 dark:text-purple-300 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5">
            <Scissors className="w-3 h-3" /> Cut Contour Graphics — plotter-cut vinyl, not a printed wrap
          </span>
          <p className="text-sm text-muted-foreground mt-1">
            {proof.vehicle} · {proof.designName}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Scale ref: driver side {proof.reference.sideWidthInches}″ × {proof.reference.sideHeightInches}″ ·
            Plotter height {proof.plotterMaxHeightInches}″
            {typeof totalSqFt === "number" && totalSqFt > 0 && (
              <> · Total coverage ≈ {Math.round(totalSqFt)} sq ft</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {onRegenerate && (
            <Button variant="outline" size="sm" onClick={onRegenerate} disabled={isGenerating} className="gap-1.5">
              {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Ruler className="w-4 h-4" />} Re-spec
            </Button>
          )}
          <Button size="sm" onClick={downloadPdf} disabled={!hasGraphics} className="gap-1.5">
            <Download className="w-4 h-4" /> Download Proof
          </Button>
        </div>
      </div>

      {/* Warnings */}
      {proof.warnings?.length > 0 && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-1">
          {proof.warnings.map((w, i) => (
            <p key={i} className="text-xs text-amber-600 dark:text-amber-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {w}
            </p>
          ))}
        </div>
      )}

      {!hasGraphics ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No cut graphics detected — this looks like a color-change wrap with no plotted text or logos.
        </Card>
      ) : (
        <>
          {/* Per-graphic specs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {proof.elements.map((el, i) => (
              <Card
                key={i}
                className={cn(
                  "p-3 border",
                  el.belowMinLetter ? "border-amber-500/40 bg-amber-500/5"
                    : !el.fitsPlotter ? "border-red-500/40 bg-red-500/5"
                      : "border-border bg-secondary/20",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {el.type === "text" ? <Type className="w-4 h-4 text-blue-400 flex-shrink-0" />
                      : <Scissors className="w-4 h-4 text-purple-400 flex-shrink-0" />}
                    <span className="text-sm font-semibold truncate">{el.label}</span>
                  </div>
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{el.type}</span>
                </div>
                {el.text && <p className="text-xs text-muted-foreground mt-1 truncate">“{el.text}”</p>}
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                  <div className="rounded bg-background/60 border border-border/40 p-1.5">
                    <div className="text-[9px] text-muted-foreground uppercase">Width</div>
                    <div className="font-semibold">{el.widthInches}″</div>
                  </div>
                  <div className="rounded bg-background/60 border border-border/40 p-1.5">
                    <div className="text-[9px] text-muted-foreground uppercase">Height</div>
                    <div className="font-semibold">{el.heightInches}″</div>
                  </div>
                  <div className="rounded bg-background/60 border border-border/40 p-1.5">
                    <div className="text-[9px] text-muted-foreground uppercase">Letter H</div>
                    <div className={cn("font-semibold", el.belowMinLetter && "text-amber-500")}>
                      {el.letterHeightInches != null ? `${el.letterHeightInches}″` : "—"}
                    </div>
                  </div>
                </div>
                {el.belowMinLetter && (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 mt-2">
                    Letters under {proof.minLetterHeightInches}″ — contact us prior to ordering.
                  </p>
                )}
                {!el.fitsPlotter && (
                  <p className="text-[11px] text-red-500 mt-2">
                    Exceeds {proof.plotterMaxHeightInches}″ plotter height — must be tiled/paneled.
                  </p>
                )}
              </Card>
            ))}
          </div>

          {/* Nesting preview */}
          {nesting && (
            <Card className="p-3 bg-secondary/20 border-border">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold flex items-center gap-2">
                  <Ruler className="w-4 h-4 text-blue-400" /> Nesting preview
                </span>
                <span className="text-xs text-muted-foreground">
                  {nesting.plotterMax}″ media · ≈ {Math.ceil(nesting.rollLengthInches)}″ ({(nesting.rollLengthInches / 12).toFixed(1)} ft) roll
                </span>
              </div>
              {/* Scaled strip: vertical = plotter height (54"), horizontal = roll length */}
              <div className="relative w-full rounded bg-background border border-dashed border-blue-500/40 overflow-hidden" style={{ aspectRatio: `${Math.max(nesting.rollLengthInches, 1)} / ${nesting.plotterMax}` }}>
                {nesting.placed.map((p, i) => {
                  const total = Math.max(nesting.rollLengthInches, 1);
                  return (
                    <div
                      key={i}
                      className="absolute bg-blue-500/20 border border-blue-500/60 rounded-[2px] flex items-center justify-center overflow-hidden"
                      style={{
                        left: `${(p.x / total) * 100}%`,
                        bottom: 0,
                        width: `${(p.w / total) * 100}%`,
                        height: `${(Math.min(p.h, nesting.plotterMax) / nesting.plotterMax) * 100}%`,
                      }}
                      title={`${p.el.label} — ${p.el.widthInches}″ × ${p.el.heightInches}″${p.rotated ? " (rotated)" : ""}`}
                    >
                      <span className="text-[8px] text-blue-700 dark:text-blue-300 px-0.5 truncate">{p.el.label}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-2">
                Preview only — pieces oriented to fit the {nesting.plotterMax}″ media. Optimized nesting + layered vector
                files (CutContour spot color + bleed) come in the production export.
              </p>
            </Card>
          )}

          {/* CutContour submission spec */}
          <Card className="p-3 bg-secondary/10 border-border">
            <p className="text-xs font-semibold mb-1.5">Cut file requirements</p>
            <ul className="text-[11px] text-muted-foreground space-y-1 list-disc pl-4">
              <li>Cut lines use a spot color named <span className="font-mono font-semibold">CutContour</span> (capital C's).</li>
              <li>CutContour = Spot · CMYK 0 / 100 / 0 / 0 (100% magenta) · 0.25pt hairline stroke · no fill · own layer.</li>
              <li>Add a black bleed layer (offset the cut path ~0.1–0.2″, filled black).</li>
              <li>For intricate designs and letters under {proof.minLetterHeightInches}″, contact us prior to ordering.</li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
};

export default CutGraphicsProofSheet;
