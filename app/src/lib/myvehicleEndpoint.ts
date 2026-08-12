/**
 * MyVehiclePro endpoint router.
 *
 * Single source of truth for picking the right per-tool edge function
 * based on the calling tool. Each tool owns its own function so prompt
 * tweaks in one tool can never affect another.
 *
 * Anything we don't recognize falls through to `edit-vehicle-photo`,
 * the legacy shared function — that's the safety net.
 */

export type MyVehicleTool =
  | "ColorPro"
  | "FadeWraps"
  | "GraphicsPro"
  | "WBTY"
  | "PatternPro"
  | "DesignPanelPro"
  | "DesignPanelProPremium"
  | "DesignProAI"
  | "RestyleLibrary"
  | "ApproveMode"
  | string;

export function pickMyVehicleEndpoint(toolSource?: string | null): string {
  const t = (toolSource || "").trim();

  if (t === "ColorPro" || t === "" || t === "colorpro") {
    return "colorpro-on-vehicle-photo";
  }
  if (t === "FadeWraps" || t === "fadewraps") {
    return "fadewraps-on-vehicle-photo";
  }
  if (t === "GraphicsPro" || t === "graphicspro") {
    return "graphicspro-on-vehicle-photo";
  }
  if (t === "WBTY" || t === "PatternPro" || t === "wbty" || t === "patternpro") {
    return "wbty-on-vehicle-photo";
  }

  // DesignPro AI prompt path (DesignIQ) — designs a wrap from a text prompt /
  // brand brief directly onto each uploaded photo. Distinct from the library
  // panel path, which transfers an existing flat panel via edit-vehicle-photo.
  if (t === "DesignProAI" || t === "designproai" || t === "DesignIQ") {
    return "design-on-vehicle-photo";
  }

  // DesignPro library panels + ApproveMode + anything else falls back to
  // the legacy shared function. It still works the same way it always did.
  return "edit-vehicle-photo";
}
