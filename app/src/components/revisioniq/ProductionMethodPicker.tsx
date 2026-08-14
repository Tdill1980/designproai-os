/**
 * ProductionMethodPicker — choose between Print & Cut and Manufacture Film
 * Cut, the two production methods that drive what the rest of the LayerLift
 * pipeline is allowed to do.
 *
 *   PRINT & CUT     (vinylSubstrate = "printed")
 *     Full-color CMYK print on a base wrap film, then a die-cut contour
 *     follows the artwork outline. Gradients, halftones, photographic
 *     elements and unlimited colors are all fine. Vectorize favors the
 *     "logo" preset (multi-color layered SVG).
 *
 *   MANUFACTURE FILM CUT   (vinylSubstrate = "cut")
 *     Solid-color vinyl sheets plotter-cut into shapes. The plotter has
 *     no concept of gradients, halftones, or photographs — only solid
 *     filled regions separated by clean cut paths. Vectorize switches to
 *     the "silhouette" preset (single-path, higher smoothing, larger
 *     min_area so the plotter doesn't choke on noise).
 *
 * The component is the single source of truth for the UI vocabulary; the
 * underlying value ("cut" | "printed") matches the existing GraphicsPro
 * surface schema so everything downstream (production prep, ProductionFlow,
 * CutContour QC) can read it without translation.
 */
import { Printer, Scissors } from "lucide-react";

export type ProductionMethod = "cut" | "printed";

interface Props {
  value: ProductionMethod;
  onChange: (value: ProductionMethod) => void;
  /** Compact two-button pill — for tight spaces like the LayerStrip header.
   *  Default (false) renders the full picker with descriptions. */
  compact?: boolean;
  disabled?: boolean;
  className?: string;
}

export function ProductionMethodPicker({
  value,
  onChange,
  compact = false,
  disabled = false,
  className = "",
}: Props) {
  if (compact) {
    return (
      <div
        className={`inline-flex rounded-md border border-zinc-700 bg-zinc-900/60 p-0.5 text-[10px] font-semibold ${className}`}
        role="radiogroup"
        aria-label="Production method"
      >
        <button
          type="button"
          role="radio"
          aria-checked={value === "printed"}
          disabled={disabled}
          onClick={() => onChange("printed")}
          className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${
            value === "printed"
              ? "bg-gradient-to-r from-cyan-500 to-blue-500 text-white shadow-[0_0_10px_rgba(34,211,238,0.4)]"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
          title="Print & Cut — full-color print + die-cut contour"
        >
          <Printer className="w-3 h-3" /> Print & Cut
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "cut"}
          disabled={disabled}
          onClick={() => onChange("cut")}
          className={`px-2 py-1 rounded transition-colors flex items-center gap-1 ${
            value === "cut"
              ? "bg-gradient-to-r from-pink-500 to-rose-500 text-white shadow-[0_0_10px_rgba(236,72,153,0.4)]"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
          title="Manufacture Film Cut — solid vinyl plotter cut"
        >
          <Scissors className="w-3 h-3" /> Film Cut
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
          Production Method
        </p>
        <span className="text-[10px] text-zinc-500">
          Drives lift + vectorize constraints
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Production method">
        <button
          type="button"
          role="radio"
          aria-checked={value === "printed"}
          disabled={disabled}
          onClick={() => onChange("printed")}
          className={`p-3 rounded-lg border text-left transition-all ${
            value === "printed"
              ? "border-cyan-400 bg-gradient-to-br from-cyan-500/15 to-blue-500/10 shadow-[0_0_18px_rgba(34,211,238,0.25)]"
              : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-600"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Printer
              className={`w-4 h-4 ${value === "printed" ? "text-cyan-300" : "text-zinc-400"}`}
            />
            <span
              className={`text-sm font-semibold ${value === "printed" ? "text-white" : "text-zinc-300"}`}
            >
              Print &amp; Cut
            </span>
          </div>
          <p className="text-[10px] text-zinc-400 leading-snug">
            Full-color CMYK print + die-cut contour. Gradients, photos,
            unlimited colors all fine.
          </p>
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === "cut"}
          disabled={disabled}
          onClick={() => onChange("cut")}
          className={`p-3 rounded-lg border text-left transition-all ${
            value === "cut"
              ? "border-pink-400 bg-gradient-to-br from-pink-500/15 to-rose-500/10 shadow-[0_0_18px_rgba(236,72,153,0.25)]"
              : "border-zinc-700 bg-zinc-900/40 hover:border-zinc-600"
          }`}
        >
          <div className="flex items-center gap-1.5 mb-1">
            <Scissors
              className={`w-4 h-4 ${value === "cut" ? "text-pink-300" : "text-zinc-400"}`}
            />
            <span
              className={`text-sm font-semibold ${value === "cut" ? "text-white" : "text-zinc-300"}`}
            >
              Manufacture Film Cut
            </span>
          </div>
          <p className="text-[10px] text-zinc-400 leading-snug">
            Solid vinyl, plotter-cut. No gradients — vectorize flattens to
            single-color paths for clean plotter output.
          </p>
        </button>
      </div>
    </div>
  );
}

/**
 * Map a production method to the vectorize-it preset / smoothing / min_area
 * that yields appropriate cut data for that method.
 *
 * - "cut" (plotter): silhouette trace, single-color path, heavy smoothing,
 *   higher min_area so the plotter doesn't chase tiny noise dots.
 * - "printed" (print & cut): logo trace, multi-color layered SVG, default
 *   smoothing — matches the current LayerStrip vectorize behavior.
 */
export function vectorizeOptionsFor(method: ProductionMethod): {
  traceMode: "logo" | "detailed" | "silhouette" | "centerline";
  smoothing: number;
  minArea: number;
} {
  if (method === "cut") {
    return { traceMode: "silhouette", smoothing: 1.5, minArea: 16 };
  }
  return { traceMode: "logo", smoothing: 1.0, minArea: 4 };
}
