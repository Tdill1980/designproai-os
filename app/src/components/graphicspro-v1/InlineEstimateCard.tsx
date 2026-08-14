/**
 * InlineEstimateCard — compact auto-filled estimate that lives directly
 * under the mockup on the GraphicsPro preview screen. Seeds sq ft from
 * the drawn vinyl zones and shop price from the material rate × markup,
 * then lets the rep override either number inline (manual override sticks
 * until they reset). Keeps the heavier line-item editor in the QuickQuote
 * side panel — this card is the at-a-glance number the customer sees.
 */

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Calculator, RotateCcw } from "lucide-react";
import type { VinylZone } from "./types";

const RATES: Record<string, { rate: number; label: string }> = {
  avery: { rate: 6.32, label: "Avery Cut Contour" },
  "3m": { rate: 6.92, label: "3M Cut Contour" },
};

interface InlineEstimateCardProps {
  vinylZones: VinylZone[];
  materialType: "avery" | "3m";
  markupPercentage: number;
  onMarkupChange: (markup: number) => void;
  onOpenQuickQuote: () => void;
}

export function InlineEstimateCard({
  vinylZones,
  materialType,
  markupPercentage,
  onMarkupChange,
  onOpenQuickQuote,
}: InlineEstimateCardProps) {
  // Auto-filled sq ft from drawn zones. The rep can override; we remember
  // the override so re-renders of this card don't blow away their number.
  const autoSqft = useMemo(() => {
    if (!vinylZones || vinylZones.length === 0) return 0;
    return vinylZones.reduce(
      (sum, z) => sum + (z.widthInches * z.heightInches) / 144,
      0,
    );
  }, [vinylZones]);

  const [sqftOverride, setSqftOverride] = useState<number | null>(null);
  const [priceOverride, setPriceOverride] = useState<number | null>(null);

  // Reset overrides if the zones change materially (new design, new flow)
  useEffect(() => {
    setSqftOverride(null);
    setPriceOverride(null);
  }, [vinylZones.length]);

  const sqft = sqftOverride ?? autoSqft;
  const { rate, label } = RATES[materialType] || RATES.avery;
  const wholesale = Math.max(sqft * rate, 25);
  const autoPrice = Math.max(wholesale * (1 + markupPercentage / 100), 25);
  const price = priceOverride ?? autoPrice;

  const hasOverride = sqftOverride !== null || priceOverride !== null;

  return (
    <Card className="p-4 bg-white border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-blue-600" />
          <h4 className="text-sm font-semibold text-gray-900">Quick Estimate</h4>
          <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
            auto-filled
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hasOverride && (
            <button
              type="button"
              onClick={() => {
                setSqftOverride(null);
                setPriceOverride(null);
              }}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700"
            >
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenQuickQuote}
            className="h-7 px-2.5 text-xs border-gray-300 text-gray-700 hover:bg-gray-50"
          >
            Edit line items
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
            Sq Ft
          </label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step={0.1}
            value={Number.isFinite(sqft) ? sqft.toFixed(2) : "0"}
            onChange={(e) => {
              const next = Number(e.target.value);
              setSqftOverride(Number.isFinite(next) ? next : 0);
            }}
            className="h-9 text-sm bg-white border-gray-300 text-gray-900"
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {sqftOverride !== null ? "overridden" : `auto from ${vinylZones?.length || 0} zone${vinylZones?.length === 1 ? "" : "s"}`}
          </p>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
            Markup %
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={500}
            value={markupPercentage}
            onChange={(e) => onMarkupChange(Number(e.target.value) || 0)}
            className="h-9 text-sm bg-white border-gray-300 text-gray-900"
          />
          <p className="text-[10px] text-gray-500 mt-1">
            {label} @ ${rate}/sq ft
          </p>
        </div>

        <div>
          <label className="block text-[10px] uppercase tracking-wider text-gray-500 font-semibold mb-1">
            Shop Price
          </label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm font-semibold text-gray-500">
              $
            </span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              step={1}
              value={Number.isFinite(price) ? price.toFixed(2) : "0"}
              onChange={(e) => {
                const next = Number(e.target.value);
                setPriceOverride(Number.isFinite(next) ? next : 0);
              }}
              className="h-9 pl-6 text-sm bg-white border-gray-300 text-gray-900 font-semibold"
            />
          </div>
          <p className="text-[10px] text-gray-500 mt-1">
            {priceOverride !== null ? "overridden" : `wholesale $${wholesale.toFixed(2)}`}
          </p>
        </div>
      </div>
    </Card>
  );
}
