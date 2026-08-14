/**
 * useEstimator — owns EstimatorState + exposes bound mutators.
 *
 * Phase 3 of the quote tool rebuild adds an EstimatorDrawer that lives
 * inside every design tool. The tools shouldn't need to know how
 * EstimatorState is shaped or which helpers from quote-estimator.ts to
 * call — they just call `est.addRenderVariant(...)` when a render
 * lands and `est.setVehicle(...)` when the user picks a different car.
 * That keeps Phase 4-5 wiring a one-liner per tool.
 *
 * Usage:
 *   const est = useEstimator({ vehicle: { year, make, model } });
 *   <EstimatorDrawer state={est.state} onChange={est.setState} ... />
 *
 *   // Inside the render-completion handler:
 *   est.addRenderVariant({
 *     variantKey: "carbon-fiber-hood",
 *     label: "Carbon Fiber Hood",
 *     unitPrice: 400,
 *     qty: 1,
 *     unit: "each",
 *   });
 */

import { useCallback, useMemo, useState } from "react";

import {
  EMPTY_ESTIMATOR,
  addItem,
  computeTotals,
  lineItemFromRender,
  removeItem,
  setBaseItem,
  updateItem,
  type EstimatorCustomer,
  type EstimatorLineItem,
  type EstimatorPrecisionMod,
  type EstimatorState,
  type EstimatorTotals,
  type EstimatorVehicle,
} from "@/lib/quote-estimator";

interface UseEstimatorOptions {
  /** Seeded into the state on first render. */
  initial?: Partial<EstimatorState>;
}

export interface UseEstimatorApi {
  state: EstimatorState;
  totals: EstimatorTotals;
  /** Replace the entire state (passes straight to React's setter). */
  setState: (next: EstimatorState) => void;

  // Item ops ──────────────────────────────────────────────────────
  add: (item: EstimatorLineItem) => void;
  update: (id: string, patch: Partial<Omit<EstimatorLineItem, "id">>) => void;
  remove: (id: string) => void;
  setBase: (item: EstimatorLineItem) => void;

  /**
   * Add or replace a render-derived line. The variantKey makes this
   * idempotent — calling it twice with the same key replaces the
   * existing line instead of stacking.
   */
  addRenderVariant: (args: {
    variantKey: string;
    label: string;
    description?: string;
    qty: number;
    unitPrice: number;
    unit: EstimatorLineItem["unit"];
    productId?: string;
  }) => void;

  // Field ops ────────────────────────────────────────────────────
  setVehicle: (patch: Partial<EstimatorVehicle>) => void;
  setCustomer: (patch: Partial<EstimatorCustomer>) => void;
  setNotes: (notes: string) => void;
  setTaxRate: (rate: number) => void;
  setDepositRate: (rate: number) => void;

  // Render persistence (Phase 6a) ─────────────────────────────────
  /**
   * Capture the unmodified hero render the estimate is being built
   * on top of. Tool pages call this when a fresh design renders.
   * Replacing it (e.g. user picks a new design) auto-clears the
   * precision-mod stack since those mods were stacked on a different
   * source image.
   */
  setBaseRender: (url: string | null) => void;

  /** Append a precision modification to the stacked sequence. */
  pushPrecisionMod: (mod: EstimatorPrecisionMod) => void;

  /** Clear the precision-mod stack (e.g. on Reset to original render). */
  clearPrecisionMods: () => void;

  /** Wipe back to EMPTY_ESTIMATOR (keeps the initial seed). */
  reset: () => void;
}

export function useEstimator(opts: UseEstimatorOptions = {}): UseEstimatorApi {
  // We capture the initial seed on mount only — re-renders don't reset.
  const [state, setState] = useState<EstimatorState>(() => ({
    ...EMPTY_ESTIMATOR,
    ...opts.initial,
  }));

  const totals = useMemo(() => computeTotals(state), [state]);

  const add = useCallback(
    (item: EstimatorLineItem) => setState((s) => addItem(s, item)),
    [],
  );

  const update = useCallback(
    (id: string, patch: Partial<Omit<EstimatorLineItem, "id">>) =>
      setState((s) => updateItem(s, id, patch)),
    [],
  );

  const remove = useCallback(
    (id: string) => setState((s) => removeItem(s, id)),
    [],
  );

  const setBase = useCallback(
    (item: EstimatorLineItem) => setState((s) => setBaseItem(s, item)),
    [],
  );

  const addRenderVariant = useCallback(
    (args: {
      variantKey: string;
      label: string;
      description?: string;
      qty: number;
      unitPrice: number;
      unit: EstimatorLineItem["unit"];
      productId?: string;
    }) => {
      const item = lineItemFromRender(args);
      setState((s) => addItem(s, item));
    },
    [],
  );

  const setVehicle = useCallback(
    (patch: Partial<EstimatorVehicle>) =>
      setState((s) => ({ ...s, vehicle: { ...s.vehicle, ...patch } })),
    [],
  );

  const setCustomer = useCallback(
    (patch: Partial<EstimatorCustomer>) =>
      setState((s) => ({ ...s, customer: { ...s.customer, ...patch } })),
    [],
  );

  const setNotes = useCallback(
    (notes: string) => setState((s) => ({ ...s, notes })),
    [],
  );

  const setTaxRate = useCallback(
    (rate: number) =>
      setState((s) => ({ ...s, taxRate: clamp01(rate) })),
    [],
  );

  const setDepositRate = useCallback(
    (rate: number) =>
      setState((s) => ({ ...s, depositRate: clamp01(rate) })),
    [],
  );

  const setBaseRender = useCallback(
    (url: string | null) =>
      setState((s) => {
        // Picking a different design wipes the stack — those mods were
        // applied to the OLD base, not the new one.
        const stackChanged = url !== s.baseRenderUrl;
        return {
          ...s,
          baseRenderUrl: url,
          precisionMods: stackChanged ? [] : s.precisionMods,
        };
      }),
    [],
  );

  const pushPrecisionMod = useCallback(
    (mod: EstimatorPrecisionMod) =>
      setState((s) => ({ ...s, precisionMods: [...s.precisionMods, mod] })),
    [],
  );

  const clearPrecisionMods = useCallback(
    () => setState((s) => ({ ...s, precisionMods: [] })),
    [],
  );

  const reset = useCallback(
    () => setState({ ...EMPTY_ESTIMATOR, ...opts.initial }),
    [opts.initial],
  );

  return {
    state,
    totals,
    setState,
    add,
    update,
    remove,
    setBase,
    addRenderVariant,
    setVehicle,
    setCustomer,
    setNotes,
    setTaxRate,
    setDepositRate,
    setBaseRender,
    pushPrecisionMod,
    clearPrecisionMods,
    reset,
  };
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}
