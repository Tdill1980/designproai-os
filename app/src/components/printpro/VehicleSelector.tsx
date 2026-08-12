import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  VehicleMeasurement,
  PanelBreakdown,
  getUniqueMakes,
  getModelsForMake,
  getYearsForMakeModel,
  findVehicle,
  getPanelBreakdown,
  calculatePricingTier,
} from "@/data/vehicle-measurements";

interface VehicleSelectorProps {
  onVehicleSelect?: (vehicle: VehicleMeasurement | null, breakdown: PanelBreakdown | null) => void;
}

const VehicleSelector = ({ onVehicleSelect }: VehicleSelectorProps) => {
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [year, setYear] = useState("");

  const makes = getUniqueMakes();
  const models = make ? getModelsForMake(make) : [];
  const years = make && model ? getYearsForMakeModel(make, model) : [];

  const selectedVehicle = make && model && year ? findVehicle(make, model, year) : null;
  const breakdown = selectedVehicle ? getPanelBreakdown(selectedVehicle) : null;
  const pricing = selectedVehicle?.sideW != null ? calculatePricingTier(selectedVehicle.sideW) : null;

  useEffect(() => {
    onVehicleSelect?.(selectedVehicle || null, breakdown);
  }, [selectedVehicle?.make, selectedVehicle?.model, selectedVehicle?.year]);

  const handleMakeChange = (val: string) => {
    setMake(val);
    setModel("");
    setYear("");
  };

  const handleModelChange = (val: string) => {
    setModel(val);
    setYear("");
  };

  return (
    <div className="space-y-6">
      {/* Make / Model / Year dropdowns */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <Label htmlFor="vs-make">Make</Label>
          <Select value={make} onValueChange={handleMakeChange}>
            <SelectTrigger id="vs-make">
              <SelectValue placeholder="Select make..." />
            </SelectTrigger>
            <SelectContent>
              {makes.map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="vs-model">Model</Label>
          <Select value={model} onValueChange={handleModelChange} disabled={!make}>
            <SelectTrigger id="vs-model">
              <SelectValue placeholder={make ? "Select model..." : "Select make first"} />
            </SelectTrigger>
            <SelectContent>
              {models.map(m => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="vs-year">Year Range</Label>
          <Select value={year} onValueChange={setYear} disabled={!model}>
            <SelectTrigger id="vs-year">
              <SelectValue placeholder={model ? "Select year..." : "Select model first"} />
            </SelectTrigger>
            <SelectContent>
              {years.map(y => (
                <SelectItem key={y} value={y}>{y}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Panel breakdown */}
      {breakdown && pricing && selectedVehicle && (
        <div className="space-y-4">
          {/* Vehicle summary */}
          <div className="p-4 bg-muted/50 rounded-xl border border-border">
            <p className="text-sm text-muted-foreground">Selected Vehicle</p>
            <p className="text-xl font-bold text-foreground">
              {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
            </p>
          </div>

          {/* Panel-by-panel grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <PanelCard label="Both Sides" sqft={breakdown.sides} icon="◧" />
            <PanelCard label="Back" sqft={breakdown.back} icon="▣" />
            <PanelCard label="Hood" sqft={breakdown.hood} icon="▤" />
            <PanelCard label="Roof" sqft={breakdown.roof} icon="▥" />
          </div>

          {/* Total and pricing */}
          <div className="p-5 rounded-xl bg-gradient-to-r from-[#D946EF]/10 to-[#9b87f5]/10 border border-[#9b87f5]/30">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Corrected Total Coverage</p>
                <p className="text-3xl font-bold text-foreground">{breakdown.corrected} sq ft</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Raw total: {breakdown.total} sq ft
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Production Tier</p>
                <p className="text-lg font-bold uppercase bg-gradient-to-r from-[#D946EF] to-[#9b87f5] bg-clip-text text-transparent">
                  {pricing.label}
                </p>
                <p className="text-2xl font-bold text-primary">${pricing.price}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function PanelCard({ label, sqft, icon }: { label: string; sqft: number; icon: string }) {
  return (
    <div className="p-3 rounded-lg bg-card border border-border text-center">
      <span className="text-2xl">{icon}</span>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
      <p className="text-lg font-bold">{sqft > 0 ? `${sqft} ft²` : "N/A"}</p>
    </div>
  );
}

export default VehicleSelector;
