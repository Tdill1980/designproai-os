import { useState, useCallback } from "react";
import { renderClient } from "@/integrations/supabase/renderClient";
import { toast } from "@/hooks/use-toast";

/** One cut graphic, specced in real printed inches by cut-graphics-proof. */
export interface CutGraphicElement {
  label: string;
  type: "text" | "logo" | "graphic" | "stripe";
  text?: string | null;
  widthInches: number;
  heightInches: number;
  letterHeightInches: number | null;
  fitsPlotter: boolean;
  belowMinLetter: boolean;
}

export interface CutGraphicsProof {
  vehicle: string;
  designName: string;
  reference: { sideWidthInches: number; sideHeightInches: number };
  plotterMaxHeightInches: number;
  minLetterHeightInches: number;
  elements: CutGraphicElement[];
  elementCount: number;
  warnings: string[];
}

export interface CutGraphicsProofInput {
  renderUrl: string;
  sideWidthInches?: number;
  sideHeightInches?: number;
  plotterMaxHeightInches?: number;
  designName?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
}

/**
 * useCutGraphicsProof — drives the cut-graphics-proof edge function.
 *
 * Specs every cut graphic on a wrap design (overall W x H + letter height)
 * against the REAL vehicle side dimensions from GENIE, and flags pieces that
 * exceed the plotter height or have letters under 2".
 */
export const useCutGraphicsProof = () => {
  const [proof, setProof] = useState<CutGraphicsProof | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateProof = useCallback(async (input: CutGraphicsProofInput): Promise<CutGraphicsProof | null> => {
    if (!input.renderUrl) {
      toast({ title: "No design to proof", description: "Generate a design first.", variant: "destructive" });
      return null;
    }
    if (!input.sideWidthInches || !input.sideHeightInches) {
      toast({
        title: "Vehicle dimensions needed",
        description: "Resolve GENIE vehicle dimensions first so graphics can be specced to scale.",
        variant: "destructive",
      });
      return null;
    }

    setIsGenerating(true);
    setError(null);
    try {
      const invokeOnce = async () => {
        const { data, error: fnErr } = await renderClient.functions.invoke("cut-graphics-proof", {
          body: {
            renderUrl: input.renderUrl,
            sideWidthInches: input.sideWidthInches,
            sideHeightInches: input.sideHeightInches,
            plotterMaxHeightInches: input.plotterMaxHeightInches ?? 59,
            designName: input.designName,
            vehicleYear: input.vehicleYear,
            vehicleMake: input.vehicleMake,
            vehicleModel: input.vehicleModel,
          },
        });
        if (fnErr) {
          // supabase-js reports a generic "Edge Function returned a non-2xx status
          // code" and hides the real reason in the Response body (context). Read it
          // so the operator sees the ACTUAL error (e.g. "Failed to fetch design
          // image", "Gemini analysis failed", "Gemini API key not configured").
          let detail = fnErr.message || "Cut graphics proof failed";
          try {
            const body = await (fnErr as any)?.context?.json?.();
            if (body?.error) detail = body.error;
          } catch { /* body not JSON — keep generic message */ }
          throw new Error(detail);
        }
        if (!data?.success) throw new Error(data?.error || "Could not build the cut graphics proof.");
        return data;
      };

      let data = await invokeOnce();
      // FALSE-NEGATIVE GUARD: the detector sometimes returns ZERO elements on a
      // wrap that plainly carries lettering/logos (model variance — "no cut
      // graphics found" on a fully branded design). One automatic re-run usually
      // reads it correctly; only report "no cut graphics" if BOTH passes agree.
      if ((data.elementCount ?? 0) === 0) {
        try {
          await new Promise((r) => setTimeout(r, 1200));
          const retry = await invokeOnce();
          if ((retry.elementCount ?? 0) > 0) data = retry;
        } catch { /* keep the first (empty) result */ }
      }

      setProof(data as CutGraphicsProof);
      if ((data.elementCount ?? 0) === 0) {
        toast({
          title: "No cut graphics found",
          description: "This looks like a color-change wrap with no plotted graphics.",
        });
      } else {
        toast({
          title: "Cut Graphics Proof ready",
          description: `${data.elementCount} graphic(s) specced to scale.`,
        });
      }
      return data as CutGraphicsProof;
    } catch (err: any) {
      console.error("[CutGraphicsProof] failed:", err);
      setError(err?.message || "Failed to build the cut graphics proof.");
      toast({ title: "Proof Failed", description: err?.message || "Please try again.", variant: "destructive" });
      return null;
    } finally {
      setIsGenerating(false);
    }
  }, []);

  const clearProof = useCallback(() => {
    setProof(null);
    setError(null);
  }, []);

  return { proof, isGenerating, error, generateProof, clearProof };
};
