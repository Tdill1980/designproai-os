/**
 * RENDER-FUNCTION NAMES FOR THE TOOLS THAT STILL CONDUCT THEIR OWN RENDERS.
 *
 * ColorPro, the legacy DesignPro tool UI, GraphicsPro, WBTY and ProductionFlow
 * each invoke a RestylePro edge function from the browser and pick which one by
 * vehicle class. That is the architecture the standalone runtime replaced for
 * DesignPro, and these names are exactly what the customer path must not be
 * able to reach -- so they live here, in a module nothing on that path imports,
 * rather than in the shared VehicleTypeSelector every tool pulls from.
 *
 * This is a holding pen, not a home. When those tools move to the runtime, the
 * file goes with them.
 */
import type { VehicleType } from "@/components/tools/VehicleTypeSelector";

/** Library-panel / colour renders, by vehicle class. */
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

/** Brief-driven design renders, by vehicle class. */
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
