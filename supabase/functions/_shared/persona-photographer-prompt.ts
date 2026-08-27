/**
 * persona-photographer-prompt.ts — Persona 3: Automotive Photographer
 *
 * Builds prompts for 6-angle magazine-quality studio shots.
 * Identity: Professional automotive photographer shooting for a
 * real vehicle wrap design magazine.
 *
 * Uses Design Anchor from Persona 2 for cross-view consistency.
 * Fixed 6-shot sequence (same order every time):
 *   1. Driver side
 *   2. Passenger side
 *   3. Front
 *   4. Hood detail
 *   5. Close-up (5" at angle to see detail and texture)
 *   6. Rear
 *
 * IMPORTANT: Keep prompts under 3K chars. Gemini quality degrades with length.
 */

import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { CAMERA_ANGLES } from "./view-angles-os.ts";

/**
 * The fixed 6-shot sequence for the photographer persona.
 * This order is locked — same every time, every vehicle.
 */
export const PHOTOGRAPHER_SHOT_SEQUENCE = [
  { key: "side", label: "Driver Side" },
  { key: "passenger-side", label: "Passenger Side" },
  { key: "front", label: "Front" },
  { key: "hood_detail", label: "Hood Detail" },
  { key: "close-up", label: "Close-Up" },
  { key: "rear", label: "Rear" },
] as const;

export type PhotographerShotKey = typeof PHOTOGRAPHER_SHOT_SEQUENCE[number]["key"];

interface PhotographerPromptParams {
  designAnchorText: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  finish?: string;
  shotKey: string;
}

const FINISH_SPECS: Record<string, string> = {
  gloss: "GLOSS — shiny wet-look, crisp reflections.",
  matte: "MATTE — flat, ZERO reflections, velvety.",
  satin: "SATIN — soft sheen, silk-like.",
  chrome: "CHROME — mirror-like reflections.",
  brushed: "BRUSHED METAL — directional grain, anisotropic reflections.",
};

export function buildPhotographerPrompt(params: PhotographerPromptParams): string {
  const {
    designAnchorText,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    finish = "Gloss",
    shotKey,
  } = params;

  const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");
  const finishSpec = FINISH_SPECS[(finish || "gloss").toLowerCase()] || FINISH_SPECS.gloss;
  const cameraAngle = CAMERA_ANGLES[shotKey] || CAMERA_ANGLES["hero"];

  return `Photograph this wrapped ${vehicle} from a specific angle. The wrap is already installed — you are documenting it with a camera.

${STUDIO_ENVIRONMENT}

THE WRAP DESIGN (already installed on the vehicle):
${designAnchorText}

Finish: ${finish} — ${finishSpec}
Wrap covers painted body panels only. Windows, lights, wheels, trim stay factory.

COLOR FIDELITY — CRITICAL:
- Colors must be RICH, VIBRANT, and FULLY SATURATED — exactly as described above.
- Do NOT wash out, fade, or desaturate. The vinyl is brand new, colors at full intensity.

CAMERA SHOT:
${cameraAngle}

4:3 landscape, 4K. REAL PRINTED VINYL on the vehicle. Canon EOS R5, tack-sharp. INDISTINGUISHABLE from a real photograph. No text overlays.`;
}
