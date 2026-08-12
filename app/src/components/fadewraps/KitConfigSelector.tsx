import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Sparkles, Car } from "lucide-react";
import { getRecommendedSize } from "@/lib/vehicle-size-validator";
import { SIDE_PANELS } from "@/lib/panelizer-config";

type KitSize = "small" | "medium" | "large" | "xl";
type RoofSize = "none" | "small" | "medium" | "large";

interface KitConfigSelectorProps {
  kitSize: KitSize;
  onKitSizeChange: (size: KitSize) => void;
  addHood: boolean;
  onAddHoodChange: (checked: boolean) => void;
  addFrontBumper: boolean;
  onAddFrontBumperChange: (checked: boolean) => void;
  addRearBumper: boolean;
  onAddRearBumperChange: (checked: boolean) => void;
  roofSize: RoofSize;
  onRoofSizeChange: (size: RoofSize) => void;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
}

export const KitConfigSelector = ({
  onKitSizeChange,
  onAddHoodChange,
  onAddFrontBumperChange,
  onAddRearBumperChange,
  onRoofSizeChange,
  vehicleYear: initialYear,
  vehicleMake: initialMake,
  vehicleModel: initialModel,
}: KitConfigSelectorProps) => {
  const [year, setYear] = useState(initialYear || "");
  const [make, setMake] = useState(initialMake || "");
  const [model, setModel] = useState(initialModel || "");
  const [detectedLabel, setDetectedLabel] = useState<string | null>(null);

  // Pre-fill from props
  useEffect(() => {
    if (initialYear) setYear(initialYear);
    if (initialMake) setMake(initialMake);
    if (initialModel) setModel(initialModel);
  }, [initialYear, initialMake, initialModel]);

  // Auto-determine all sizes from vehicle and set all panels to included
  useEffect(() => {
    if (!make || !model) {
      setDetectedLabel(null);
      return;
    }
    const rec = getRecommendedSize(make, model, year || undefined);
    if (rec) {
      onKitSizeChange(rec.sideSize as KitSize);
      onRoofSizeChange(rec.roofSize || "none");
      const dim = SIDE_PANELS[rec.sideSize];
      setDetectedLabel(`${dim.label} (${dim.hint})`);
    } else {
      onKitSizeChange("medium");
      onRoofSizeChange("none");
      setDetectedLabel("Medium (default)");
    }
    onAddHoodChange(true);
    onAddFrontBumperChange(true);
    onAddRearBumperChange(true);
  }, [year, make, model]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-1">
        <Car className="w-4 h-4 text-blue-400" />
        <Label className="text-sm font-semibold">Vehicle Info</Label>
      </div>
      <p className="text-xs text-muted-foreground -mt-2">
        GENIE Production Panelizer OS™ auto-sizes all panels from vehicle measurements
      </p>

      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Year</Label>
          <Input
            value={year}
            onChange={(e) => setYear(e.target.value)}
            placeholder="2024"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Make</Label>
          <Input
            value={make}
            onChange={(e) => setMake(e.target.value)}
            placeholder="Ford"
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Model</Label>
          <Input
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="F-250"
            className="h-9"
          />
        </div>
      </div>

      {detectedLabel && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
          <Sparkles className="w-3.5 h-3.5 text-blue-400 shrink-0" />
          <span className="text-xs text-blue-300">
            Auto-configured: <span className="font-semibold text-blue-200">{detectedLabel}</span> - Full wrap (sides, hood, bumpers, roof)
          </span>
        </div>
      )}
    </div>
  );
};
