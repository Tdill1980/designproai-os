/**
 * PrecisionModButtons — button strip on each design tool that lets
 * the shop owner stack precision modifications on the active render.
 *
 * Each button:
 *   1. Calls the apply-precision-modification edge function with the
 *      current displayed render URL
 *   2. Receives a new render URL with the modification visually
 *      applied (chrome delete, carbon fiber roof, racing stripe, …)
 *   3. Hands the new URL + the line item back to the parent via
 *      `onApplied`. The parent sets the new URL as the displayed
 *      image (so the next click STACKS) and pushes the line item to
 *      the QuickQuote estimator (no variantKey — they accumulate).
 *
 * Hidden when there's no current render URL — without a base image
 * to edit, there's nothing for Gemini to modify.
 */

import { Loader2, Plus, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  usePrecisionModifications,
  type PrecisionModResult,
  type PrecisionModTool,
  type PrecisionModification,
} from "@/hooks/usePrecisionModifications";

export interface PrecisionModButtonsProps {
  tool: PrecisionModTool;
  /** The currently displayed render URL — passed to Gemini as input. */
  currentRenderUrl: string | null | undefined;
  onApplied: (
    result: PrecisionModResult,
    mod: PrecisionModification,
  ) => void;
  onError?: (err: Error, mod: PrecisionModification) => void;
  className?: string;
  disabled?: boolean;
}

export function PrecisionModButtons({
  tool,
  currentRenderUrl,
  onApplied,
  onError,
  className,
  disabled,
}: PrecisionModButtonsProps) {
  const { modifications, isLoading, apply, pendingKey } =
    usePrecisionModifications(tool);

  if (isLoading || modifications.length === 0 || !currentRenderUrl) {
    return null;
  }

  const anyPending = pendingKey !== null;

  return (
    <div
      className={cn(
        "rounded-xl border border-[#48484a] bg-black/30 p-3 space-y-2",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-semibold text-white/85">
        <Wand2 className="h-3.5 w-3.5 text-amber-300" />
        Stack a precision modification on this render
      </div>
      <div className="flex flex-wrap gap-2">
        {modifications.map((mod) => {
          const isPending = pendingKey === mod.key;
          return (
            <Button
              key={mod.id}
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || anyPending}
              onClick={async () => {
                try {
                  const result = await apply(mod, currentRenderUrl);
                  onApplied(result, mod);
                } catch (err) {
                  onError?.(err instanceof Error ? err : new Error(String(err)), mod);
                }
              }}
              className="h-8 border-[#48484a] bg-black/40 text-white/90 hover:bg-amber-500/10 hover:border-amber-500/40 hover:text-amber-200 disabled:opacity-50"
              title={mod.description ?? mod.label}
            >
              {isPending ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Plus className="h-3 w-3 mr-1" />
              )}
              {mod.label}
              <span className="ml-1.5 text-[11px] text-white/55 tabular-nums">
                ${Number(mod.base_price).toLocaleString()}
              </span>
            </Button>
          );
        })}
      </div>
      <p className="text-[10px] text-white/40 leading-snug">
        Each click sends the current render to Gemini for a real visual edit.
        Mods stack — chrome delete + then racing stripe + then carbon fiber roof
        all show up on the same vehicle.
      </p>
    </div>
  );
}
