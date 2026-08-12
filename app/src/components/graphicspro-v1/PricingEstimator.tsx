import { useState, useEffect, useCallback } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { DollarSign, Plus, Trash2, Shield } from "lucide-react";
import type { VinylZone } from "./types";

export interface LineItem {
  id: string;
  label: string;
  width: number;
  height: number;
  qty: number;
  laminated: boolean;
}

interface PricingEstimatorProps {
  materialType: "avery" | "3m";
  defaultWidth?: number;
  defaultHeight?: number;
  markupPercentage: number;
  onMarkupChange: (markup: number) => void;
  /** Expose line items to parent for production */
  onLineItemsChange?: (items: LineItem[]) => void;
  /** Auto-seed line items from drawn zones */
  vinylZones?: VinylZone[];
  /**
   * Visual theme. Defaults to "dark" so the dashboard / dark-themed tools
   * (ColorPro, DesignPro) keep their existing look. GraphicsPro renders on
   * a white page and was getting an awkwardly-dark estimator card — pass
   * theme="light" there to match the surrounding UI.
   */
  theme?: "dark" | "light";
}

const RATES: Record<string, { rate: number; label: string }> = {
  avery: { rate: 6.32, label: "Avery Cut Contour" },
  "3m": { rate: 6.92, label: "3M Cut Contour" },
};

const LAMINATION_ADDER = 1.50; // $/sqft additional for lamination

let nextId = 1;
function makeId() {
  return `line-${nextId++}`;
}

function defaultLine(width = 0, height = 0): LineItem {
  return { id: makeId(), label: "Graphic 1", width, height, qty: 1, laminated: false };
}

export function PricingEstimator({
  materialType,
  defaultWidth = 0,
  defaultHeight = 0,
  markupPercentage,
  onMarkupChange,
  onLineItemsChange,
  vinylZones,
  theme = "dark",
}: PricingEstimatorProps) {
  const isLight = theme === "light";
  // Tokenized class strings so the JSX below stays compact while still
  // reading naturally — each token is one role (card surface, sub-card,
  // input, helper text, etc.) mapped to the current theme.
  const t = {
    card: isLight ? "bg-white border-gray-200" : "bg-rp-surface border-rp",
    title: isLight ? "text-gray-900" : "text-foreground",
    sub: isLight ? "text-gray-500" : "text-muted-foreground",
    accent: isLight ? "text-blue-600" : "text-blue-500",
    accentHover: isLight ? "hover:text-blue-700" : "hover:text-blue-400",
    line: isLight ? "border-gray-200 bg-gray-50" : "border-border/20 bg-secondary",
    inputBg: isLight ? "bg-white border-gray-300 text-gray-900" : "bg-secondary border-border/30 text-foreground",
    label: isLight ? "text-gray-500" : "text-muted-foreground",
    money: isLight ? "text-emerald-600" : "text-green-600",
    divider: isLight ? "border-gray-200" : "border-border/20",
    fineSub: isLight ? "text-gray-400" : "text-muted-foreground/60",
    priceAccent: isLight ? "text-blue-600" : "text-blue-500",
  };
  const [lines, setLines] = useState<LineItem[]>(() => [defaultLine(defaultWidth, defaultHeight)]);
  const [seededFromZones, setSeededFromZones] = useState(false);

  // Auto-seed line items from drawn vinyl zones (use real inch dimensions)
  useEffect(() => {
    if (!vinylZones || vinylZones.length === 0 || seededFromZones) return;
    const seeded: LineItem[] = vinylZones.map((zone) => ({
      id: makeId(),
      label: zone.label,
      width: zone.widthInches,
      height: zone.heightInches,
      qty: 1,
      laminated: false,
    }));
    setLines(seeded);
    setSeededFromZones(true);
  }, [vinylZones, seededFromZones, defaultWidth, defaultHeight]);

  useEffect(() => {
    onLineItemsChange?.(lines);
  }, [lines, onLineItemsChange]);

  const updateLine = useCallback((id: string, updates: Partial<LineItem>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  }, []);

  const addLine = useCallback(() => {
    setLines((prev) => {
      const num = prev.length + 1;
      return [...prev, { ...defaultLine(defaultWidth, defaultHeight), label: `Graphic ${num}` }];
    });
  }, [defaultWidth, defaultHeight]);

  const removeLine = useCallback((id: string) => {
    setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.id !== id)));
  }, []);

  const { rate, label } = RATES[materialType] || RATES.avery;

  // Per-line calculations
  const lineCalcs = lines.map((line) => {
    const sqft = (line.width * line.height) / 144;
    const materialCost = sqft * rate;
    const lamCost = line.laminated ? sqft * LAMINATION_ADDER : 0;
    const unitWholesale = materialCost + lamCost;
    const lineWholesale = unitWholesale * line.qty;
    return { sqft, unitWholesale, lineWholesale };
  });

  const totalWholesale = Math.max(lineCalcs.reduce((sum, c) => sum + c.lineWholesale, 0), 25);
  const totalRetail = Math.max(totalWholesale * (1 + markupPercentage / 100), 25);
  const totalSqft = lineCalcs.reduce((sum, c, i) => sum + c.sqft * lines[i].qty, 0);

  return (
    <Card className={`p-4 ${t.card}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DollarSign className={`w-4 h-4 ${t.accent}`} />
          <h4 className={`text-sm font-semibold ${t.title}`}>Price Estimate</h4>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={addLine}
          className={`h-7 px-2 text-xs ${t.accent} ${t.accentHover} gap-1`}
        >
          <Plus className="w-3 h-3" /> Add Line
        </Button>
      </div>

      {/* Line Items */}
      <div className="space-y-3 mb-3">
        {lines.map((line, idx) => {
          const calc = lineCalcs[idx];
          return (
            <div
              key={line.id}
              className={`p-3 rounded-lg border space-y-2 ${t.line}`}
            >
              {/* Row 1: Label + Remove */}
              <div className="flex items-center justify-between">
                <Input
                  value={line.label}
                  onChange={(e) => updateLine(line.id, { label: e.target.value })}
                  className="h-7 text-xs font-medium bg-transparent border-none px-0 max-w-[160px] focus-visible:ring-0"
                  placeholder="Line item name"
                />
                {lines.length > 1 && (
                  <button
                    onClick={() => removeLine(line.id)}
                    className={`transition-colors p-1 ${isLight ? "text-gray-400 hover:text-red-500" : "text-gray-300 hover:text-red-400"}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Row 2: W × H × Qty + Lamination */}
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 items-end">
                <div>
                  <Label className={`text-[10px] ${t.label}`}>W (in)</Label>
                  <Input
                    type="number"
                    value={line.width}
                    onChange={(e) => updateLine(line.id, { width: Number(e.target.value) || 0 })}
                    min={1}
                    max={200}
                    className={`mt-0.5 h-7 text-xs ${t.inputBg}`}
                  />
                </div>
                <div>
                  <Label className={`text-[10px] ${t.label}`}>H (in)</Label>
                  <Input
                    type="number"
                    value={line.height}
                    onChange={(e) => updateLine(line.id, { height: Number(e.target.value) || 0 })}
                    min={1}
                    max={200}
                    className={`mt-0.5 h-7 text-xs ${t.inputBg}`}
                  />
                </div>
                <div>
                  <Label className={`text-[10px] ${t.label}`}>Qty</Label>
                  <Input
                    type="number"
                    value={line.qty}
                    onChange={(e) => updateLine(line.id, { qty: Math.max(1, Number(e.target.value) || 1) })}
                    min={1}
                    max={999}
                    className={`mt-0.5 h-7 text-xs ${t.inputBg}`}
                  />
                </div>
                <div className="hidden sm:block">
                  <Label className={`text-[10px] ${t.label}`}>Area</Label>
                  <p className={`mt-0.5 text-xs font-medium h-7 flex items-center ${t.title}`}>
                    {calc.sqft.toFixed(2)} ft²
                  </p>
                </div>
                <div>
                  <button
                    onClick={() => updateLine(line.id, { laminated: !line.laminated })}
                    className={`flex items-center gap-1 h-7 px-2 rounded-md border text-[10px] font-medium transition-colors w-full justify-center ${
                      line.laminated
                        ? "bg-gradient-to-r from-blue-600 via-purple-600 to-fuchsia-600 border-transparent text-white"
                        : isLight
                          ? "border-gray-300 text-gray-600 hover:border-gray-400"
                          : "border-border/30 text-muted-foreground hover:border-border"
                    }`}
                  >
                    <Shield className="w-3 h-3" />
                    Lam
                  </button>
                </div>
              </div>

              {/* Row 3: Line subtotal */}
              <div className="flex items-center justify-between text-xs">
                <span className={t.sub}>
                  {calc.sqft.toFixed(2)} ft² × {line.qty} = {(calc.sqft * line.qty).toFixed(2)} ft²
                  {line.laminated && " + lamination"}
                </span>
                <span className={`font-medium ${t.money}`}>
                  ${calc.lineWholesale.toFixed(2)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Markup */}
      <div className={`flex items-center gap-3 mb-3 pb-3 border-b ${t.divider}`}>
        <div className="flex-1">
          <Label className={`text-xs ${t.label}`}>Markup %</Label>
          <Input
            type="number"
            value={markupPercentage}
            onChange={(e) => onMarkupChange(Number(e.target.value) || 0)}
            min={0}
            max={500}
            className={`mt-1 h-8 text-sm ${t.inputBg}`}
          />
        </div>
        <div className="flex-1 text-right pt-4">
          <p className={`text-xs ${t.sub}`}>Total: {totalSqft.toFixed(2)} sq ft</p>
        </div>
      </div>

      {/* Totals */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
        <div>
          <p className={`text-xs ${t.sub}`}>{label} @ ${rate}/sq ft{lines.some((l) => l.laminated) ? ` + $${LAMINATION_ADDER.toFixed(2)}/sq ft lam` : ""}</p>
          <p className={`text-sm ${t.sub}`}>
            Wholesale: <span className={`font-medium ${t.money}`}>${totalWholesale.toFixed(2)}</span>
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className={`text-xs ${t.sub}`}>Shop Price</p>
          <p className={`text-xl font-bold ${t.priceAccent}`}>${totalRetail.toFixed(2)}</p>
        </div>
      </div>

      <p className={`text-xs mt-2 ${t.fineSub}`}>
        Includes: weeding, masking, cut paths, print file, install guide
      </p>
    </Card>
  );
}
