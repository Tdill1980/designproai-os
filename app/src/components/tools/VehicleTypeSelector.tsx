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

/**
 * Maps a vehicle type to the edge function that should handle its renders.
 * Cars/trucks/SUVs/vans go to the locked golden pipeline. Everything else
 * routes to a dedicated render-<type> function that does spec lookup +
 * class-aware rendering + validation flagging.
 */
export function getRenderFunctionForType(type: VehicleType): string {
  switch (type) {
    case "motorcycle":
      return "render-motorcycle";
    case "boat":
      return "render-boat";
    case "bus":
      return "render-bus";
    case "rv":
      return "render-rv";
    case "trailer":
      return "render-trailer";
    default:
      return "generate-color-render";
  }
}

/**
 * Maps a vehicle type to the DesignPro (DesignIQ) edge function.
 * Cars/trucks/SUVs/vans stay on design-panel-ai-generate.
 * Non-standard vehicles route to designpro-<type> which builds
 * vehicle-class-aware prompts (e.g. knows about hulls, fairings, etc.).
 */
export function getDesignProFunctionForType(type: VehicleType): string {
  switch (type) {
    case "motorcycle":
      return "designpro-motorcycle";
    case "boat":
      return "designpro-boat";
    case "bus":
      return "designpro-bus";
    case "rv":
      return "designpro-rv";
    case "trailer":
      return "designpro-trailer";
    default:
      return "design-panel-ai-generate";
  }
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
