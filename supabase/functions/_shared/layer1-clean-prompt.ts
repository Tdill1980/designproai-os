/**
 * ═══════════════════════════════════════════════════════════════
 *  TRADE SECRET — CONFIDENTIAL & PROPRIETARY
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *  Part of the DesignIQ™ / LiftIQ Engine™ architecture (patent-pending).
 * ═══════════════════════════════════════════════════════════════
 *
 * layer1-clean-prompt.ts — LayerLiftIQ Layer-1 ("clean background") prompt.
 *
 * The text-free counterpart to design-panel-ai-generate's hero prompt. Commercial
 * renders bake the company name, phone, and typography into the artwork (the hero
 * the customer approves). For MANUFACTURING we need the SAME background art with
 * ZERO baked text — branding is a separate transparent layer (Layer 2) applied
 * downstream. This builder produces that pristine, unbaked canvas.
 *
 * Lives in _shared (not inlined in the locked edge function) so:
 *   1. the locked design-panel-ai-generate change stays a minimal additive branch,
 *   2. Vitest can import and assert NO branding text leaks into Layer 1.
 *
 * Lean by design (well under the ~4K Gemini quality ceiling). Reuses the same
 * STUDIO_ENVIRONMENT and camera angles every render function uses, so the clean
 * canvas matches the hero's studio/lighting/framing — only the text is gone.
 */

import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { getCameraAngle } from "./view-angles-os.ts";

export interface Layer1CleanParams {
  mode?: "restyle" | "commercial";
  prompt?: string;
  finish?: string;
  brandColors?: string;
  industryType?: string;
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  viewType?: string;
  // VisionBoardIQ — the SAME reference inputs the locked hero builder receives.
  // design-panel-ai-generate passes these to whichever builder is selected and
  // sends the reference IMAGES to Gemini's payload regardless of layer1Clean, so
  // honoring them here is what makes the clean Layer-1 background MATCH the hero's
  // reference-driven look (minus baked text) instead of drifting into generic art.
  visionBoardImages?: Array<{ slotLabel?: string; storageUrl?: string }>;
  visionboard_intent?: "style_inspiration" | "exact_reference" | string;
  // Style DNA extracted from the reference images by the locked function's Flash
  // analysis pass (analyzeVisionBoardStyles). ~400 chars of palette/mood/texture.
  styleDescriptors?: string;
}

/**
 * The hard guarantee that makes Layer 1 a manufacturing-safe canvas. A single,
 * clearly-enumerated constraint (Gemini honors one clear instruction far better
 * than scattered "do nots"). The slicer's assertNoTextInLayer1 guard is the
 * server-side backstop; this is the generation-side cause.
 */
export const LAYER1_CLEAN_BLOCK =
  `CLEAN BACKGROUND LAYER (Layer 1 — artwork only): This render is the pure background ARTWORK canvas. Paint only color, pattern, gradient, texture, and graphic flow across the body panels. There is ZERO text of any kind anywhere on the vehicle — no company name, no phone number, no lettering, no numbers, no words, no logos, no emblems, no badges, no signage, no QR code. Every piece of branding, typography, and contact information is applied separately as a later layer and must not appear here. The result is a clean, gallery-quality painted surface with nothing readable on it.`;

// Compact finish descriptors — the background look only. The full golden FINISH
// SPECS live in the locked hero builder; Layer 1 needs just enough to match tone.
const FINISH_LINE: Record<string, string> = {
  gloss: "GLOSS — wet-look surface, crisp specular highlights, deep saturated color.",
  matte: "MATTE — completely flat, light-absorbing, zero mirror highlights, velvety.",
  satin: "SATIN — soft diffused sheen, feathered highlights, never mirror-bright.",
  chrome: "CHROME — mirror-like reflections, maximum specularity.",
  brushed: "BRUSHED METAL — directional grain, anisotropic stretched reflections.",
};

export function buildLayer1CleanPrompt(params: Layer1CleanParams): string {
  const {
    prompt,
    finish,
    brandColors,
    industryType,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    viewType,
    visionBoardImages,
    visionboard_intent,
    styleDescriptors,
  } = params;

  const vehicle = [vehicleYear, [vehicleMake, vehicleModel].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(" ")
    .trim() || "vehicle";
  const cameraAngle = getCameraAngle(viewType || "side");
  const finishKey = (finish || "gloss").toLowerCase();
  const finishLine = FINISH_LINE[finishKey] || FINISH_LINE.gloss;

  let assembled = `You are WePrintWraps.com Lead Vehicle Wrap Designer creating a COMPLETE, show-quality ${vehicle} wrap — a finished cohesive DESIGN, never a flat pattern or banner. Design bold, gallery-worthy artwork spanning the panels, flowing with the body lines and wheel-arch contours, with layered depth — background atmosphere, mid-ground flow, foreground hero art and custom accents. No baked lettering or logos (a separate layer).

FINISH LOCK (LOCKED — read this FIRST, applies to every body panel):
${(finish || "Gloss").toUpperCase()} — ${finishLine}

CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

A photorealistic studio photograph of a ${vehicle} with a premium artistic vehicle wrap fully installed — real printed vinyl, physically applied.

${STUDIO_ENVIRONMENT}

Design direction: "${(prompt || "").trim()}"`;

  // Brand palette carries over (it is color, not text); industry sets mood ONLY.
  if (brandColors) {
    assembled += `\nColor palette: ${brandColors} — build the entire background from this palette and do not introduce unrelated colors.`;
  }
  if (industryType) {
    assembled += `\nIndustry energy (mood and motif inspiration only — never literal text or logos): ${industryType}`;
  }
  // Commercial: compose a calmer focal zone for the separate Layer-2 branding so
  // the finished wrap reads as one integrated design (no text/logo drawn here).
  if ((params.mode || "") === "commercial") {
    assembled += `\nLeave a calmer focal zone for branding.`;
  }

  // VisionBoardIQ — mirror the locked hero builder so the clean Layer-1 background
  // is driven by the SAME reference images the customer uploaded (they are in the
  // Gemini payload either way). Without this the clean render ignores the reference
  // and produces generic slop — the exact regression we are fixing. Text/logos stay
  // out per LAYER1_CLEAN_BLOCK below; only the artwork style/palette is reproduced.
  if (visionBoardImages && visionBoardImages.length > 0) {
    if (visionboard_intent === "exact_reference") {
      assembled += `\n\nEXACT REFERENCE (background art only): The attached reference image IS the wrap the customer wants. Reproduce its colors, patterns, gradients, textures, and overall composition on the ${vehicle}, adapting to its body lines — but render the painted ARTWORK ONLY. Do not reproduce any text, logos, or typography from the reference; those are applied as a separate layer.`;
    } else if (styleDescriptors) {
      assembled += `\n\nSTYLE INSPIRATION (background art only): Transform the visual style of the attached reference images into an ORIGINAL background for this vehicle. Style DNA:\n${styleDescriptors}\nCapture this energy in the color and artwork — do not reproduce the references directly, and include NO text or logos.`;
    } else {
      assembled += `\n\nSTYLE INSPIRATION (background art only): Transform the mood, colors, and artistic style of the attached reference images into an ORIGINAL background for this vehicle. Use them as style inspiration only — include NO text or logos.`;
    }
  }

  assembled += `\n\n${LAYER1_CLEAN_BLOCK}`;
  assembled += `\nThe wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.`;
  assembled += `\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

  return assembled;
}
