/**
 * VehicleTypeSelector — Push-button grid for picking vehicle class.
 *
 * Routes render requests to the correct edge function based on the selected
 * type. Cars/trucks/SUVs/vans stay on the existing locked generate-color-render
 * pipeline. Motorcycles/boats/buses/RVs go to their dedicated render-<type>
 * edge functions which use Google-grounded Gemini lookups for real dimensions.
 *
 * The user picks once per render; selection defaults to "car" so existing
 * users see zero behavior change unless they click a new button.
 */

import { cn } from "@/lib/utils";

export type VehicleType =
  | "car"
  | "truck"
  | "suv"
  | "van"
  | "motorcycle"
  | "boat"
  | "bus"
  | "rv"
  | "trailer";

export const NON_STANDARD_TYPES: VehicleType[] = ["motorcycle", "boat", "bus", "rv", "trailer"];

export function isNonStandardVehicle(type: VehicleType): boolean {
  return NON_STANDARD_TYPES.includes(type);
}

interface VehicleTypeOption {
  id: VehicleType;
  label: string;
}

const OPTIONS: VehicleTypeOption[] = [
  { id: "car", label: "Car" },
  { id: "truck", label: "Truck" },
  { id: "suv", label: "SUV" },
  { id: "van", label: "Van" },
  { id: "motorcycle", label: "Motorcycle" },
  { id: "boat", label: "Boat" },
  { id: "bus", label: "Bus" },
  { id: "rv", label: "RV" },
  { id: "trailer", label: "Trailer" },
];

interface VehicleTypeSelectorProps {
  value: VehicleType;
  onChange: (type: VehicleType) => void;
  className?: string;
}

export const VehicleTypeSelector = ({ value, onChange, className }: VehicleTypeSelectorProps) => {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
        Vehicle Type
      </label>
      <div className="grid grid-cols-4 gap-1.5">
        {OPTIONS.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange(opt.id)}
              className={cn(
                "flex items-center justify-center py-2 px-1 rounded-md border transition-all",
                "text-xs font-medium",
                selected
                  ? "bg-[#00C7FF]/10 border-[#00C7FF] text-[#00C7FF]"
                  : "bg-background border-border/50 text-muted-foreground hover:border-border hover:text-foreground",
              )}
              aria-pressed={selected}
              title={opt.label}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};

/**
 * The per-type render-function resolvers moved to legacyRenderFunctions.ts.
 *
 * They return the names of RestylePro edge functions for a browser to invoke.
 * Calls 1-7 are one server-owned request now -- the vehicle type travels in it
 * as data, and which engine renders which class is the runtime's decision -- so
 * the DesignPro path must not be able to reach those names at all. The legacy
 * tools that still conduct their own renders import them from their own module.
 */
