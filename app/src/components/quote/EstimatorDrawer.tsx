/**
 * EstimatorDrawer — Phase 3 wrapper around QuickQuoteEstimator.
 *
 * Slides the estimator in from the right edge as a side drawer so the
 * underlying render stays visible. Used by every design tool —
 * DesignPro, ColorPro, FadeWraps, PatternPro, GraphicsPro — via the
 * "Open Estimator" button, which is also exported from this file.
 *
 * Two-mode API:
 *   • Uncontrolled — pass `trigger`, drawer owns its open state.
 *       <EstimatorDrawer state={...} onChange={...} trigger={<button/>}/>
 *
 *   • Controlled — pass `open` + `onOpenChange`, parent owns the gate.
 *       <EstimatorDrawer state={...} onChange={...}
 *                        open={open} onOpenChange={setOpen} />
 *
 * The default trigger (OpenEstimatorButton) shows a live total + item
 * count badge so the shop owner can see the running estimate without
 * even opening the drawer.
 */

import { Calculator, ShoppingBag } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";

import { QuickQuoteEstimator, type QuickQuoteEstimatorProps } from "./QuickQuoteEstimator";
import { computeTotals, formatMoney, type EstimatorState } from "@/lib/quote-estimator";
import { WpwShoppingButtons } from "@/components/wpw/WpwShoppingButtons";

export interface EstimatorDrawerProps
  extends Omit<QuickQuoteEstimatorProps, "compact" | "className"> {
  /** Trigger element. Ignored when `open` is provided. */
  trigger?: React.ReactNode;
  /** Controlled open state. Pair with `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Drawer width — defaults to a comfortable estimate panel. */
  widthClassName?: string;
}

const DEFAULT_WIDTH =
  "w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl";

export function EstimatorDrawer({
  trigger,
  open,
  onOpenChange,
  widthClassName,
  ...estimatorProps
}: EstimatorDrawerProps) {
  // When `open` is passed, run controlled. Otherwise, let Radix manage
  // open state internally and rely on `trigger` to flip it.
  const sheetProps =
    typeof open === "boolean"
      ? { open, onOpenChange }
      : {};

  return (
    <Sheet {...sheetProps}>
      {trigger && typeof open !== "boolean" && (
        <SheetTrigger asChild>{trigger}</SheetTrigger>
      )}
      <SheetContent
        side="right"
        className={cn(
          // Override the shadcn default (sm:max-w-sm + p-6) — the
          // estimator is a dense form and needs room to breathe.
          "p-0 border-l border-[#48484a] bg-[#0b0b0e] text-white",
          widthClassName ?? DEFAULT_WIDTH,
          // The sheet has h-full from the variant; we want internal
          // scrolling for long item lists.
          "overflow-y-auto",
        )}
      >
        <div className="p-4 sm:p-5">
          {/* WPW shortcut buttons — wholesale printing + human-design
              services. Visible to everyone; pricing presentation switches
              based on WPW membership via useIsWpwTenant. */}
          <div className="mb-4 pb-4 border-b border-white/10">
            <WpwShoppingButtons />
          </div>
          <QuickQuoteEstimator
            {...estimatorProps}
            compact
            className="border-0 bg-transparent p-0"
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── OpenEstimatorButton ───────────────────────────────────────────
// A pill button design tools drop next to a render. Shows a live
// running total + item count so the shop owner can glance at the
// estimate without opening the drawer.

export interface OpenEstimatorButtonProps
  extends Omit<React.ComponentPropsWithoutRef<typeof Button>, "children"> {
  /** Current estimator state — drives the badge contents. */
  state: EstimatorState;
  /** Override the visible label. Defaults to "Open Estimator". */
  label?: string;
  /** Hide the inline total/count summary. */
  hideSummary?: boolean;
}

export function OpenEstimatorButton({
  state,
  label = "Open Estimator",
  hideSummary = false,
  className,
  ...buttonProps
}: OpenEstimatorButtonProps) {
  const totals = computeTotals(state);
  const count = state.items.length;
  const showSummary = !hideSummary && count > 0;

  return (
    <Button
      type="button"
      variant="outline"
      {...buttonProps}
      className={cn(
        "h-9 gap-2 border-[#48484a] bg-black/40 text-white hover:bg-[#60A5FA]/10 hover:border-[#60A5FA]/40 hover:text-[#60A5FA]",
        className,
      )}
    >
      <Calculator className="h-4 w-4" />
      <span className="font-medium">{label}</span>
      {showSummary && (
        <span className="flex items-center gap-1.5 ml-1 pl-2 border-l border-white/15 text-xs text-white/70 tabular-nums">
          <ShoppingBag className="h-3 w-3" />
          {count}
          <span aria-hidden="true">·</span>
          <span className="font-semibold text-white">
            {formatMoney(totals.total)}
          </span>
        </span>
      )}
    </Button>
  );
}
