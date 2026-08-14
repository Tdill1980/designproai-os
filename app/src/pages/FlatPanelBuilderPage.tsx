import { useSearchParams, Link } from "react-router-dom";
import { FlatPanelBuilder } from "@/components/qc/FlatPanelBuilder";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Layers } from "lucide-react";

/**
 * Flat Panel Builder — standalone admin tool that works alongside Flat Panel Pro.
 *
 * Designer pipeline:
 *   1. LayerLift  → strip text + logos (transparent-PNG overlays for later).
 *   2. Upload the cleaned proof here.
 *   3. Draw the panel rectangle + mark tires/wheel-wells.
 *   4. Build  → tires removed & filled, cropped to real inches + bleed.
 *   5. Upscale → high-res base.
 *   6. Re-apply the lifted text + logos on the template.
 */
export default function FlatPanelBuilderPage() {
  const [params] = useSearchParams();
  const proof = params.get("proof") || undefined;
  const requestId = params.get("request") || undefined;
  const designId = params.get("design") || undefined;

  return (
    <div className="min-h-screen bg-black text-white px-4 py-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <Layers className="h-6 w-6 text-cyan-400" />
          <div>
            <h1 className="text-2xl font-bold font-['Oswald'] tracking-wide">Flat Panel Builder</h1>
            <p className="text-sm text-white/60">2D proof → remove tires & fill → flat print panel + bleed → upscale.</p>
          </div>
        </div>
      </div>
      <FlatPanelBuilder proofImageUrl={proof} requestId={requestId} designId={designId} />
    </div>
  );
}
