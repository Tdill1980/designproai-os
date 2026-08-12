/**
 * VehicleAutocomplete — Type-ahead make/model with LLM fallback.
 *
 * Replaces dropdown <Select> for make/model entry:
 *   1. User types in a single text input: "BMW M4" or "2024 Tesla Cybertruck"
 *   2. Instant search across vehicle measurement database
 *   3. "Look Up Vehicle" button for vehicles not yet in the system
 *   4. Returns VehicleMeasurement-compatible object to parent
 *
 * Also supports per-field mic button for voice entry.
 */

import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { Search, Loader2, Sparkles, Car } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MicInput } from "./MicInput";
import {
  searchVehicles,
  findVehicle,
  type VehicleMeasurement,
} from "@/data/vehicle-measurements";
import { supabase } from "@/integrations/supabase/client";

interface VehicleAutocompleteProps {
  /** Called when a vehicle is selected (from local DB or LLM lookup). */
  onSelect: (vehicle: {
    make: string;
    model: string;
    year: string;
    sqFt: number;
    corrSqFt: number;
    source: "local" | "lookup"; // "lookup" = fetched from vehicle-lookup edge function
    measurement?: VehicleMeasurement;
  }) => void;
  /** Pre-fill the input (e.g., from voice). */
  initialValue?: string;
  className?: string;
}

/** Check Supabase custom table for a cached LLM lookup. */
async function checkCustomCache(
  make: string,
  model: string,
): Promise<any | null> {
  const db = supabase as any;
  const { data } = await db
    .from("vehicle_measurements_custom")
    .select("*")
    .ilike("make", make.trim())
    .ilike("model", model.trim())
    .limit(1)
    .maybeSingle();
  return data || null;
}

/** Call the vehicle-lookup edge function. */
async function lookupVehicle(
  make: string,
  model: string,
  year: string,
): Promise<any> {
  const { data, error } = await supabase.functions.invoke("vehicle-lookup", {
    body: { make, model, year },
  });
  if (error) throw new Error(error.message || "Vehicle lookup failed");
  if (data?.error) throw new Error(data.error);
  return data;
}

export const VehicleAutocomplete = ({
  onSelect,
  initialValue = "",
  className,
}: VehicleAutocompleteProps) => {
  const [query, setQuery] = useState(initialValue);
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [selectedLabel, setSelectedLabel] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Update query when initialValue changes (e.g., from voice)
  useEffect(() => {
    if (initialValue && initialValue !== query) setQuery(initialValue);
  }, [initialValue]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Local search results (instant)
  const results = useMemo(() => {
    if (!query || query.length < 2) return [];
    return searchVehicles(query).slice(0, 12);
  }, [query]);

  const hasLocalResults = results.length > 0;

  const handleSelectLocal = (v: VehicleMeasurement) => {
    const label = `${v.year} ${v.make} ${v.model}`;
    setSelectedLabel(label);
    setQuery(label);
    setShowDropdown(false);
    setAiError("");
    onSelect({
      make: v.make,
      model: v.model,
      year: v.year,
      sqFt: v.corrSqFt || v.totalSqFt || 200,
      corrSqFt: v.corrSqFt || v.totalSqFt || 200,
      source: "local",
      measurement: v,
    });
  };

  const handleAILookup = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setAiError("");

    try {
      // Parse the query into make/model/year
      const parts = query.trim().split(/\s+/);
      let year = "";
      let makeModel: string[];

      // Check if first token is a year
      if (/^\d{4}$/.test(parts[0]) && parseInt(parts[0]) >= 1990 && parseInt(parts[0]) <= 2030) {
        year = parts[0];
        makeModel = parts.slice(1);
      } else {
        makeModel = parts;
      }

      const make = makeModel[0] || query;
      const model = makeModel.slice(1).join(" ") || "";

      if (!make) {
        setAiError("Enter a make and model first");
        return;
      }

      // Check custom cache first
      const cached = await checkCustomCache(make, model);
      if (cached) {
        const label = `${cached.year || year} ${cached.make} ${cached.model}`;
        setSelectedLabel(label);
        setQuery(label);
        setShowDropdown(false);
        onSelect({
          make: cached.make,
          model: cached.model,
          year: cached.year || year,
          sqFt: cached.corr_sq_ft || cached.total_sq_ft || 200,
          corrSqFt: cached.corr_sq_ft || cached.total_sq_ft || 200,
          source: "lookup",
        });
        return;
      }

      // Call edge function
      const result = await lookupVehicle(make, model, year);
      const v = result.vehicle;
      const label = `${v.year || year} ${v.make} ${v.model}`;
      setSelectedLabel(label);
      setQuery(label);
      setShowDropdown(false);
      onSelect({
        make: v.make,
        model: v.model,
        year: v.year || year,
        sqFt: v.corr_sq_ft || v.total_sq_ft || 200,
        corrSqFt: v.corr_sq_ft || v.total_sq_ft || 200,
        source: "lookup",
      });
    } catch (err: any) {
      setAiError(err.message || "Lookup failed");
    } finally {
      setLoading(false);
    }
  }, [query, onSelect]);

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedLabel("");
              setShowDropdown(true);
              setAiError("");
            }}
            onFocus={() => query.length >= 2 && setShowDropdown(true)}
            placeholder="Type make & model — e.g. BMW M4 or 2024 Tesla Cybertruck"
            className="h-10 pl-8 text-xs bg-black border-[#48484a] text-white placeholder:text-white/40 focus-visible:ring-[#60A5FA]/40"
          />
        </div>
        <MicInput
          size="md"
          label="Speak vehicle"
          onTranscript={(t) => {
            setQuery(t);
            setSelectedLabel("");
            setShowDropdown(true);
          }}
        />
      </div>

      {/* Selected badge */}
      {selectedLabel && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Car className="w-3 h-3 text-[#60A5FA]" />
          <span className="text-[10px] font-semibold text-[#60A5FA]">{selectedLabel}</span>
        </div>
      )}

      {/* Dropdown */}
      {showDropdown && query.length >= 2 && (
        <div className="absolute z-50 top-full mt-1 w-full bg-rp-elevated border border-[#48484a] rounded-xl overflow-hidden shadow-xl max-h-72 overflow-y-auto">
          {hasLocalResults ? (
            <>
              <div className="px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-white/40 bg-black/30">
                Vehicles ({results.length})
              </div>
              {results.map((v, i) => (
                <button
                  key={`${v.make}-${v.model}-${v.year}-${i}`}
                  type="button"
                  onClick={() => handleSelectLocal(v)}
                  className="w-full text-left px-3 py-2 hover:bg-white/[0.06] transition-colors flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-white truncate">
                      {v.year} {v.make} {v.model}
                    </p>
                    <p className="text-[9px] text-white/40">
                      {v.corrSqFt || v.totalSqFt || "?"} sq ft
                    </p>
                  </div>
                  <span className="text-[9px] text-emerald-400 font-bold shrink-0">
                    {v.corrSqFt || v.totalSqFt || "?"} ft²
                  </span>
                </button>
              ))}
            </>
          ) : null}

          {/* Vehicle lookup — seamless when no local results */}
          {query.length >= 3 && !hasLocalResults && !loading && (
            <div className="border-t border-[#48484a] px-3 py-2">
              <button
                type="button"
                onClick={handleAILookup}
                className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-gradient-rp-pop text-white text-[11px] font-bold hover:brightness-110 transition-all"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Look Up Vehicle
              </button>
              {aiError && (
                <p className="text-[9px] text-red-400 mt-1 text-center">{aiError}</p>
              )}
            </div>
          )}
          {loading && (
            <div className="px-3 py-4 flex items-center justify-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-[#60A5FA]" />
              <span className="text-[10px] text-white/60">Looking up vehicle dimensions...</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
