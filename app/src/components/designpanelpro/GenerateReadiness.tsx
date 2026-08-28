/**
 * THE READINESS STRIP — WHAT THE SYSTEM ALREADY KNOWS, NOT A GATE.
 *
 * Owner directive (Trish 2026-08-28): a compact strip immediately above
 * Generate —
 *
 *     Vehicle ✓   Brief ✓   Brand ✓   Logo ✓   Dimensions ✓
 *
 * and when GENIE cannot resolve the vehicle:
 *
 *     Vehicle ✓   Brief ✓   Brand ✓   Logo ✓   Dimensions ⚠
 *
 * ⚠ IT NEVER BLOCKS. "No hard blocks — just add the enter button, it sends to
 * DesignProAI to process appropriately." This replaced a prose list that
 * existed only to explain why a greyed-out button was greyed out; the button is
 * not greyed out any more, so the strip is purely informational. A chip is a
 * statement about the job, never a permission.
 *
 * `warn` is reserved for Dimensions, because it is the only chip where the
 * system knows something the customer does not: that their vehicle has no
 * authoritative GENIE record and the geometry will be provisional. Brand and
 * Logo are `neutral` when absent — a restyle wrap has no company name, and
 * marking that as a deficiency would be the taxonomy question we just removed,
 * reintroduced as an icon.
 */
import { Check, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export type ReadinessState = "ok" | "warn" | "neutral";

export interface ReadinessChip {
  label: string;
  state: ReadinessState;
  /** Shown on the chip when `warn`, e.g. "Confirm". */
  hint?: string;
  onClick?: () => void;
}

export function GenerateReadiness({
  chips,
  className,
}: {
  chips: ReadinessChip[];
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-wrap items-center justify-center gap-x-4 gap-y-2", className)}
      // A strip of statuses is a list, and each chip is read as one item.
      role="list"
      aria-label="What DesignProAI has for this job"
    >
      {chips.map((chip) => {
        const interactive = chip.state === "warn" && typeof chip.onClick === "function";
        const Wrapper = interactive ? "button" : "div";
        return (
          <Wrapper
            key={chip.label}
            role="listitem"
            {...(interactive
              ? { type: "button" as const, onClick: chip.onClick }
              : {})}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium tracking-wide",
              chip.state === "ok" && "text-gray-600",
              chip.state === "warn" && "text-amber-600",
              chip.state === "neutral" && "text-gray-400",
              interactive && "rounded-full px-2 py-0.5 -mx-2 hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400",
            )}
          >
            <span>{chip.label}</span>
            {chip.state === "ok" && <Check className="w-3.5 h-3.5 text-emerald-500" aria-label="ready" />}
            {chip.state === "warn" && (
              <>
                <TriangleAlert className="w-3.5 h-3.5" aria-label="needs attention" />
                {chip.hint && <span className="underline underline-offset-2">{chip.hint}</span>}
              </>
            )}
            {chip.state === "neutral" && (
              // A dash, not an empty box: absent is not the same as wrong.
              <span className="text-gray-300" aria-label="not provided">—</span>
            )}
          </Wrapper>
        );
      })}
    </div>
  );
}

export default GenerateReadiness;
