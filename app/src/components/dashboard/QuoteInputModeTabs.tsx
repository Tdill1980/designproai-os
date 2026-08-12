/**
 * QuoteInputModeTabs
 *
 * Tri-mode picker used in the film-line card of QuickQuote. Mirrors
 * weprintwraps.com's "pick a vehicle OR enter area OR enter panels"
 * flow. Default mode is Vehicle. Emits the resolved coverage in sq ft
 * up to the parent, which converts to the selected product's unit
 * (yards for Color Change, sqft for printed wrap, etc.).
 *
 *   ┌─ By Vehicle ─┬─ By Sq Ft ─┬─ By Panel ─┐
 *
 * By Vehicle: reuses VehicleAutocomplete — instant DB match on a
 *   1,664-vehicle CSV, with a "Look Up Vehicle" LLM fallback that
 *   grounds a Gemini search on manufacturer sites. The form updates
 *   in parallel once either path resolves (local cache first, then
 *   the LLM answer merges in via onSelect).
 *
 * By Sq Ft: single numeric input for total wrap coverage.
 *
 * By Panel: one or more rows of W × H (inches) → sum / 144 → sq ft.
 *   Lets the shop quote "just hood + roof" without a full wrap.
 */
import { Car, Grid3x3, Plus, Ruler, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { VehicleAutocomplete } from "@/components/tools/VehicleAutocomplete";
import { cn } from "@/lib/utils";

export type QuoteInputMode = "vehicle" | "sqft" | "panel";

export interface PanelRow {
  id: string;
  w: string;
  h: string;
}

export function makePanelRow(): PanelRow {
  return { id: Math.random().toString(36).slice(2, 9), w: "", h: "" };
}

/** Total sq ft across the panel rows (inches × inches / 144). */
export function panelsToSqFt(panels: PanelRow[]): number {
  return panels.reduce((sum, p) => {
    const w = parseFloat(p.w) || 0;
    const h = parseFloat(p.h) || 0;
    return sum + (w * h) / 144;
  }, 0);
}

interface Props {
  mode: QuoteInputMode;
  onModeChange: (mode: QuoteInputMode) => void;

  // Vehicle mode
  vehicleQuery?: string;
  onVehicleResolve: (v: {
    year?: string;
    make: string;
    model: string;
    sqFt: number;
  }) => void;

  // Sq ft mode
  manualSqFt: string;
  onManualSqFtChange: (value: string) => void;

  // Panel mode
  panels: PanelRow[];
  onPanelsChange: (panels: PanelRow[]) => void;
}

export const QuoteInputModeTabs = ({
  mode,
  onModeChange,
  vehicleQuery,
  onVehicleResolve,
  manualSqFt,
  onManualSqFtChange,
  panels,
  onPanelsChange,
}: Props) => {
  const addPanel = () => onPanelsChange([...panels, makePanelRow()]);
  const removePanel = (id: string) =>
    onPanelsChange(panels.filter((p) => p.id !== id));
  const updatePanel = (id: string, patch: Partial<PanelRow>) =>
    onPanelsChange(panels.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const panelSqFt = panelsToSqFt(panels);

  const tabs: { id: QuoteInputMode; label: string; icon: typeof Car }[] = [
    { id: "vehicle", label: "By Vehicle", icon: Car },
    { id: "sqft", label: "By Sq Ft", icon: Ruler },
    { id: "panel", label: "By Panel", icon: Grid3x3 },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-black border border-[#48484a]">
        {tabs.map((t) => {
          const active = mode === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onModeChange(t.id)}
              className={cn(
                "flex items-center justify-center gap-1.5 h-8 rounded text-[11px] font-bold transition",
                active
                  ? "bg-gradient-rp-pop text-white"
                  : "text-white/60 hover:text-white",
              )}
            >
              <Icon className="w-3 h-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      {mode === "vehicle" && (
        <VehicleAutocomplete
          initialValue={vehicleQuery}
          onSelect={(v) =>
            onVehicleResolve({
              year: v.year,
              make: v.make,
              model: v.model,
              sqFt: v.corrSqFt || v.sqFt || 0,
            })
          }
        />
      )}

      {mode === "sqft" && (
        <div>
          <Input
            type="number"
            step="1"
            min="0"
            value={manualSqFt}
            onChange={(e) => onManualSqFtChange(e.target.value)}
            placeholder="Enter sq ft (e.g. 225)"
            className="h-9 text-xs bg-black border-[#48484a] text-white"
          />
          <p className="text-[10px] text-white/55 mt-1">
            Total wrap coverage in square feet.
          </p>
        </div>
      )}

      {mode === "panel" && (
        <div className="space-y-2">
          {panels.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2">
              <span className="text-[10px] text-white/55 w-12 shrink-0">
                Panel {i + 1}
              </span>
              <Input
                type="number"
                step="1"
                min="0"
                value={p.w}
                onChange={(e) => updatePanel(p.id, { w: e.target.value })}
                placeholder="W″"
                className="h-9 text-xs bg-black border-[#48484a] text-white text-center min-w-0"
                aria-label={`Panel ${i + 1} width in inches`}
              />
              <span className="text-white/50 text-xs">×</span>
              <Input
                type="number"
                step="1"
                min="0"
                value={p.h}
                onChange={(e) => updatePanel(p.id, { h: e.target.value })}
                placeholder="H″"
                className="h-9 text-xs bg-black border-[#48484a] text-white text-center min-w-0"
                aria-label={`Panel ${i + 1} height in inches`}
              />
              <button
                type="button"
                onClick={() => removePanel(p.id)}
                className="h-9 w-9 shrink-0 rounded flex items-center justify-center text-white/40 hover:text-red-400 hover:bg-white/5 transition"
                title="Remove panel"
                disabled={panels.length <= 1}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            onClick={addPanel}
            className="w-full h-8 text-[11px] bg-black border border-[#48484a] text-white/70 hover:text-white hover:bg-black"
          >
            <Plus className="w-3 h-3 mr-1" />
            Add Panel
          </Button>
          <p className="text-[10px] text-white/55">
            Total:{" "}
            <span className="text-white font-semibold">
              {panelSqFt.toFixed(1)} sq ft
            </span>{" "}
            (inches × inches ÷ 144)
          </p>
        </div>
      )}
    </div>
  );
};
