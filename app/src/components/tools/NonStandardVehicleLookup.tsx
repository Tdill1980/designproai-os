/**
 * NonStandardVehicleLookup — Dedicated lookup UI for boats, motorcycles, buses, RVs.
 *
 * Shown when the user clicks a non-standard vehicle type in VehicleTypeSelector.
 * Completely separate from VehicleAutocomplete (which calls the car-only
 * vehicle-lookup edge function). This component calls vehicle-lookup-universal,
 * which uses class-aware sanity ranges, class-specific grounding prompts, and
 * the vehicle_specs_universal cache table.
 *
 * Flow:
 *   1. User clicks Boat → this component appears with a single search input
 *   2. User types "Cruisers Yacht 45' Cantius" + optional year
 *   3. Clicks "Look Up {Type}" button
 *   4. Calls vehicle-lookup-universal edge function
 *   5. Returns specs → parent gets make, model, year, sqFt, dimensions, panels
 */

import { useState, useCallback } from "react";
import { Search, Loader2, Sparkles, Ship, Bike, Bus, Caravan } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import type { VehicleType } from "./VehicleTypeSelector";

const TYPE_LABELS: Record<string, string> = {
  motorcycle: "Motorcycle",
  boat: "Boat",
  bus: "Bus",
  rv: "RV",
};

const TYPE_ICONS: Record<string, React.ElementType> = {
  motorcycle: Bike,
  boat: Ship,
  bus: Bus,
  rv: Caravan,
};

const TYPE_PLACEHOLDERS: Record<string, { make: string; model: string }> = {
  motorcycle: { make: "Harley-Davidson", model: "Street Glide" },
  boat: { make: "Cruisers Yachts", model: "45 Cantius" },
  bus: { make: "Prevost", model: "H3-45" },
  rv: { make: "Winnebago", model: "View 24D" },
};

export interface NonStandardLookupResult {
  make: string;
  model: string;
  year: string;
  sqFt: number;
  corrSqFt: number;
  vehicleClass: string;
  subType?: string;
  dimensions?: {
    overall_length_in: number;
    overall_width_in: number;
    overall_height_in: number;
  };
  panels?: Record<string, number | undefined>;
  confidence?: string;
  requiresValidation?: boolean;
  sourceUrls?: string[];
  specsId?: string;
}

interface NonStandardVehicleLookupProps {
  vehicleType: VehicleType;
  onResult: (result: NonStandardLookupResult) => void;
  /** Called as the user types year/make/model so parent can enable the render button. */
  onFieldsChange?: (fields: { year: string; make: string; model: string }) => void;
  className?: string;
}

export const NonStandardVehicleLookup = ({
  vehicleType,
  onResult,
  onFieldsChange,
  className,
}: NonStandardVehicleLookupProps) => {
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");

  // Sync fields to parent as user types so render button enables
  const updateYear = (v: string) => { setYear(v); onFieldsChange?.({ year: v, make, model }); };
  const updateMake = (v: string) => { setMake(v); onFieldsChange?.({ year, make: v, model }); };
  const updateModel = (v: string) => { setModel(v); onFieldsChange?.({ year, make, model: v }); };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<NonStandardLookupResult | null>(null);

  const label = TYPE_LABELS[vehicleType] || vehicleType;
  const Icon = TYPE_ICONS[vehicleType] || Ship;
  const placeholders = TYPE_PLACEHOLDERS[vehicleType] || { make: "Make", model: "Model" };

  const handleLookup = useCallback(async () => {
    if (!make.trim() || !model.trim()) {
      setError("Enter a make and model first");
      return;
    }

    setLoading(true);
    setError("");
    setFound(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "vehicle-lookup-universal",
        {
          body: {
            vehicleClass: vehicleType,
            make: make.trim(),
            model: model.trim(),
            year: year.trim(),
          },
        },
      );

      if (fnError) throw new Error(fnError.message || "Lookup failed");
      if (data?.error) throw new Error(data.error);

      const v = data.vehicle;
      const result: NonStandardLookupResult = {
        make: v.make,
        model: v.model,
        year: v.year || year.trim(),
        sqFt: v.total_sq_ft || 0,
        corrSqFt: v.corr_sq_ft || v.total_sq_ft || 0,
        vehicleClass: v.vehicle_class,
        subType: v.sub_type,
        dimensions: v.dimensions,
        panels: v.panels,
        confidence: v.confidence,
        requiresValidation: v.requires_validation,
        sourceUrls: v.source_urls,
        specsId: v.specs_id,
      };

      setFound(result);
      onResult(result);
    } catch (err: any) {
      setError(err.message || "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [vehicleType, make, model, year, onResult]);

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className="w-4 h-4 text-[#00C7FF]" />
        <span className="text-xs font-semibold text-[#00C7FF]">
          {label} Lookup
        </span>
      </div>

      <div className="flex items-end gap-2">
        <div className="w-20">
          <Label className="text-[10px] text-muted-foreground">Year</Label>
          <Input
            type="text"
            placeholder="2024"
            value={year}
            onChange={(e) => updateYear(e.target.value)}
            className="h-8 text-sm bg-background border border-border/50"
          />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] text-muted-foreground">Make</Label>
          <Input
            type="text"
            placeholder={placeholders.make}
            value={make}
            onChange={(e) => { updateMake(e.target.value); setError(""); }}
            className="h-8 text-sm bg-background border border-border/50"
          />
        </div>
        <div className="flex-1">
          <Label className="text-[10px] text-muted-foreground">Model</Label>
          <Input
            type="text"
            placeholder={placeholders.model}
            value={model}
            onChange={(e) => { updateModel(e.target.value); setError(""); }}
            className="h-8 text-sm bg-background border border-border/50"
          />
        </div>
      </div>

      <button
        type="button"
        onClick={handleLookup}
        disabled={loading || !make.trim() || !model.trim()}
        className={cn(
          "w-full flex items-center justify-center gap-2 h-8 rounded-lg text-white text-[11px] font-semibold transition-all",
          loading
            ? "bg-[#00C7FF]/30 cursor-wait"
            : "border border-[#00C7FF]/40 bg-[#00C7FF]/10 hover:bg-[#00C7FF]/20",
          (!make.trim() || !model.trim()) && !loading && "opacity-40 cursor-not-allowed",
        )}
      >
        {loading ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Looking up specs...
          </>
        ) : (
          <>
            <Search className="w-3.5 h-3.5" />
            Look up sq ft specs (optional)
          </>
        )}
      </button>
      {!found && !loading && (
        <p className="text-[10px] text-white/40 text-center">
          Optional — pick a color below to render without specs
        </p>
      )}

      {error && (
        <p className="text-[10px] text-red-400 text-center">{error}</p>
      )}

      {found && (
        <div className="rounded-lg border border-[#00C7FF]/30 bg-[#00C7FF]/5 p-2.5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#00C7FF]">
              {found.year} {found.make} {found.model}
            </span>
            {found.subType && (
              <span className="text-[9px] text-muted-foreground bg-background/50 px-1.5 py-0.5 rounded">
                {found.subType.replace(/_/g, " ")}
              </span>
            )}
          </div>
          {found.dimensions && (
            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              <div>
                <span className="text-muted-foreground">Length </span>
                <span className="font-mono font-semibold">{found.dimensions.overall_length_in}"</span>
              </div>
              <div>
                <span className="text-muted-foreground">Width </span>
                <span className="font-mono font-semibold">{found.dimensions.overall_width_in}"</span>
              </div>
              <div>
                <span className="text-muted-foreground">Height </span>
                <span className="font-mono font-semibold">{found.dimensions.overall_height_in}"</span>
              </div>
            </div>
          )}
          <div className="text-[10px]">
            <span className="font-semibold text-[#60A5FA]">{found.corrSqFt} sq ft</span>
            <span className="text-muted-foreground"> wrap coverage</span>
          </div>
        </div>
      )}
    </div>
  );
};
