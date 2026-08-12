/**
 * CutGraphicsProofCard — surfaces the dimensioned Cut Graphics Proof (the
 * production sheet) on an ApprovePro order.
 *
 * For cut-contour / cut-graphics jobs the shop needs a sheet that CALLS OUT
 * the job as cut-contour graphics (not a printed wrap) and specs every graphic
 * to real scale (W x H + letter height) with the total coverage in sq ft. This
 * card:
 *   1. reads a previously-saved proof from proof_approvals.metadata.cut_graphics_proof, OR
 *   2. generates one from the order's driver-side render + GENIE vehicle dims
 *      (panelizer-step-validate → cut-graphics-proof), then persists it back to
 *      the order metadata so it travels with the order (auto on attach).
 *
 * Pure frontend — uses the already-deployed cut-graphics-proof edge function
 * and the JSONB metadata column (no migration, no locked-pipeline change).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { renderClient } from "@/integrations/supabase/renderClient";
import { toast } from "@/hooks/use-toast";
import { Loader2, Ruler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CutGraphicsProofSheet } from "@/components/graphicspro/CutGraphicsProofSheet";
import type { CutGraphicsProof } from "@/hooks/useCutGraphicsProof";

interface Props {
  proofId: string;
  /** The order's metadata JSON (carries any saved cut_graphics_proof). */
  metadata?: Record<string, any> | null;
  /** Driver-side (or hero) render URL the graphics are specced from. */
  sideRenderUrl?: string | null;
  vehicleYear?: string | number | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  designName?: string | null;
  /** Generate automatically when there's no saved proof yet and a render exists
   *  (used for cut-contour-flagged orders — always a cut job). */
  autoGenerate?: boolean;
  /** The order's linked design (color_visualizations.id). When provided, the card
   *  auto-fires if that design is a GraphicsPro / cut-graphics design — so a cut
   *  job gets its production sheet the moment a design is attached, while
   *  printed-wrap / color-change orders are left alone. */
  sourceVisualizationId?: string | null;
  /** Called after a fresh proof is generated + persisted (refresh the order). */
  onSaved?: () => void;
}

export function CutGraphicsProofCard({
  proofId,
  metadata,
  sideRenderUrl,
  vehicleYear,
  vehicleMake,
  vehicleModel,
  designName,
  autoGenerate,
  sourceVisualizationId,
  onSaved,
}: Props) {
  const savedProof = (metadata?.cut_graphics_proof as CutGraphicsProof | undefined) || null;
  const savedSqFt = typeof metadata?.cut_graphics_total_sqft === "number" ? metadata.cut_graphics_total_sqft : null;
  const [proof, setProof] = useState<CutGraphicsProof | null>(savedProof);
  const [totalSqFt, setTotalSqFt] = useState<number | null>(savedSqFt);
  const [generating, setGenerating] = useState(false);
  const autoFired = useRef(false);

  const generate = useCallback(async () => {
    if (!sideRenderUrl) {
      toast({ title: "No design to proof", description: "Attach or generate a design first.", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      // 1. Resolve REAL per-side dims from the SAME GENIE source the panels use.
      let sideW: number | undefined;
      let sideH: number | undefined;
      let sqft: number | null = null;
      try {
        const { data: dimData } = await renderClient.functions.invoke("panelizer-step-validate", {
          body: {
            vehicleMake,
            vehicleModel,
            vehicleYear: vehicleYear ? Number(vehicleYear) : null,
            estimateOnly: true,
          },
        });
        const d = (dimData?.estimatedDimensions || {}) as Record<string, number>;
        sideW = d.bodyLengthInches;
        sideH = d.bodyHeightInches;
        sqft = typeof d.totalSqFt === "number" ? d.totalSqFt : null;
      } catch {
        /* dims best-effort — cut-graphics-proof will reject below if missing */
      }
      if (!sideW || !sideH) {
        toast({
          title: "Vehicle dimensions needed",
          description: "Couldn't resolve the vehicle's dimensions — set the year/make/model on the order, then try again.",
          variant: "destructive",
        });
        return;
      }

      // 2. Spec every cut graphic to real scale against the side panel.
      const { data, error } = await renderClient.functions.invoke("cut-graphics-proof", {
        body: {
          renderUrl: sideRenderUrl,
          sideWidthInches: sideW,
          sideHeightInches: sideH,
          plotterMaxHeightInches: 59,
          designName: designName || "Custom Graphics",
          vehicleYear: vehicleYear ? String(vehicleYear) : undefined,
          vehicleMake: vehicleMake || undefined,
          vehicleModel: vehicleModel || undefined,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || "Could not build the cut graphics proof.");

      const fresh = data as CutGraphicsProof;
      setProof(fresh);
      setTotalSqFt(sqft);

      // 3. Persist onto the order so the proof travels with it.
      const md = { ...(metadata || {}), cut_graphics_proof: fresh, cut_graphics_total_sqft: sqft };
      const { error: upErr } = await supabase
        .from("proof_approvals" as any)
        .update({ metadata: md })
        .eq("id", proofId);
      if (upErr) {
        toast({ title: "Proof generated, not saved", description: `${upErr.message} (admin permission may be required)`, variant: "destructive" });
      } else {
        toast({
          title: "Cut Graphics Proof ready",
          description: `${fresh.elementCount ?? 0} graphic(s) specced to scale — saved to the order.`,
        });
        onSaved?.();
      }
    } catch (e: any) {
      toast({ title: "Proof failed", description: e?.message || "Please try again.", variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }, [sideRenderUrl, vehicleMake, vehicleModel, vehicleYear, designName, metadata, proofId, onSaved]);

  // Auto-generate once when nothing is saved yet:
  //  • cut-contour-flagged orders (autoGenerate) → always fire (it's a cut job)
  //  • otherwise, only fire when the linked design is a GraphicsPro / cut-graphics
  //    design — so the production sheet appears automatically the moment a cut
  //    design is attached, without spamming printed-wrap / color-change orders.
  useEffect(() => {
    if (autoFired.current) return;
    if (savedProof || !sideRenderUrl) return;
    if (autoGenerate) {
      autoFired.current = true;
      void generate();
      return;
    }
    if (sourceVisualizationId) {
      autoFired.current = true; // claim the slot while we detect (don't re-run)
      (async () => {
        try {
          const { data } = await supabase
            .from("color_visualizations" as any)
            .select("mode_type")
            .eq("id", sourceVisualizationId)
            .maybeSingle();
          const mode = String((data as any)?.mode_type || "").toLowerCase();
          if (mode === "graphicspro") void generate();
        } catch {
          /* detection best-effort — manual Generate button still available */
        }
      })();
    }
  }, [autoGenerate, sourceVisualizationId, savedProof, sideRenderUrl, generate]);

  // Nothing to show and not generating and no source render — keep it quiet.
  if (!proof && !generating && !sideRenderUrl) return null;

  return (
    <div className="mx-3 mt-3 rounded-lg border border-purple-200 bg-purple-50/40 p-2.5">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-wider text-purple-900">
          Cut Graphics Proof — production sheet (dims + total sq ft)
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={generate}
          disabled={generating || !sideRenderUrl}
          className="h-7 gap-1.5 border-purple-300 bg-white text-purple-700 hover:bg-purple-50 text-[11px]"
        >
          {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Ruler className="w-3.5 h-3.5" />}
          {generating ? "Speccing…" : proof ? "Re-spec" : "Generate"}
        </Button>
      </div>
      {proof ? (
        <div className="rounded bg-white border border-purple-100">
          <CutGraphicsProofSheet proof={proof} isGenerating={generating} totalSqFt={totalSqFt} />
        </div>
      ) : (
        <p className="text-[11px] text-purple-800/70 px-1 pb-1">
          {generating
            ? "Speccing each graphic to real scale against the vehicle’s dimensions…"
            : "Specs each cut graphic to real scale (W × H + letter height) with total sq ft — calls the job out as cut-contour graphics."}
        </p>
      )}
    </div>
  );
}
