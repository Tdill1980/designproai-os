/**
 * persona-designer-prompt.ts — Persona 2: Pro Vehicle Wrap Graphic Designer
 *
 * Builds the prompt for Gemini image generation. Identity: Elite vehicle wrap
 * graphic designer, $5K-$10K per design, SEMA featured.
 *
 * IMPORTANT: Prompt length = quality killer. Keep under 4K chars total.
 * Every word must earn its place.
 */

import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { getCameraAngle } from "./view-angles-os.ts";

interface DesignerPromptParams {
  enrichedBrief: string;
  mode: "restyle" | "commercial";
  vehicleYear?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  finish?: string;
  companyName?: string;
  phone?: string;
  mascot?: string;
  industryType?: string;
  bulletPoints?: string[];
  hasVisionBoardImages: boolean;
  visionboard_intent?: "style_inspiration" | "exact_reference";
}

const FINISH_SPECS: Record<string, string> = {
  gloss: "GLOSS — shiny wet-look surface, crisp reflections, deep color depth.",
  matte: "MATTE — completely flat, ZERO reflections, velvety non-reflective surface.",
  satin: "SATIN — soft sheen, subtle highlights that spread wide, silk-like.",
  chrome: "CHROME — mirror-like reflections, maximum specularity.",
  brushed: "BRUSHED METAL — directional grain texture, anisotropic reflections.",
};

export function buildDesignerPrompt(params: DesignerPromptParams): string {
  const {
    enrichedBrief,
    mode,
    vehicleYear,
    vehicleMake,
    vehicleModel,
    finish = "Gloss",
    companyName,
    phone,
    mascot,
    industryType,
    hasVisionBoardImages,
    visionboard_intent,
  } = params;

  const vehicle = [vehicleYear, vehicleMake, vehicleModel].filter(Boolean).join(" ");
  const finishSpec = FINISH_SPECS[(finish || "gloss").toLowerCase()] || FINISH_SPECS.gloss;
  const cameraAngle = getCameraAngle("side");

  if (mode === "commercial") {
    let assembled = `You are an elite vehicle wrap graphic designer. $5K-$10K per design. SEMA featured. You work at a real pro-level wrap shop.

Design a premium commercial wrap for a ${vehicle}. Render it ON the vehicle in a studio — photorealistic, not a flat panel.

${STUDIO_ENVIRONMENT}

DESIGN BRIEF FROM CONSULTANT:
${enrichedBrief}`;

    if (companyName) assembled += `\nBusiness: ${companyName}`;
    if (phone) assembled += `\nPhone: ${phone}`;
    if (mascot) assembled += `\nMascot: ${mascot}`;
    if (industryType) {
      assembled += `\nIndustry: ${industryType}`;
    } else if (companyName) {
      assembled += `\nIndustry: Infer from company name "${companyName}" — the design MUST be thematically relevant to this business.`;
    }

    assembled += `

YOUR DESIGN APPROACH:
- The wrap design MUST be thematically relevant to the business type. Landscaping = grass, trees, nature. Plumbing = water, pipes. Electrical = lightning, circuits. NEVER create random abstract art for a commercial wrap.
- Company name largest on front doors, readable from 30 feet
- Color blocking and graphic flow create movement front to rear
- Every element has tangible material quality — real texture, layered depth, not flat or clip-art
- The design follows the vehicle's body lines naturally`;

    if (hasVisionBoardImages) {
      if (visionboard_intent === "exact_reference") {
        assembled += `\nVISIONBOARD REFERENCES — EXACT: The attached reference images ARE the wrap design. Use the subject matter, imagery, and design elements from these references directly on the vehicle. Reproduce them as professional wrap elements that follow the vehicle's body lines.`;
      } else {
        assembled += `\nVISIONBOARD REFERENCES — STYLE INSPIRATION: Study the mood, colors, and artistic style of reference images. Create an ORIGINAL design inspired by them.`;
      }
    }

    assembled += `\nFinish: ${finish} — ${finishSpec}`;
    assembled += `\nWrap covers painted body panels only. Windows, lights, wheels, trim stay factory.`;
    assembled += `\n${cameraAngle}`;
    assembled += `\n16:9 landscape, 4K. REAL PRINTED VINYL on the vehicle. Canon EOS R5 at 35mm f/8. INDISTINGUISHABLE from a real photograph.`;
    assembled += `\nBefore the image, output: 1) A creative design name (2-4 words, no trademarked names) 2) DESIGN ANCHOR: A detailed 3-sentence description of the design — colors with hex values, element positions relative to vehicle panels, flow direction, and key design features. This anchor ensures consistency across all camera angles.`;

    return assembled;
  }

  // RESTYLE MODE
  let assembled = `You are an elite vehicle wrap graphic designer. $5K-$10K per design. SEMA featured. Your wraps are hero artwork — aggressive, elegant, or playful energy that turns heads.

Design a premium artistic wrap for a ${vehicle}. Render it ON the vehicle in a studio.

${STUDIO_ENVIRONMENT}

DESIGN BRIEF FROM CONSULTANT:
${enrichedBrief}`;

  assembled += `\nArtistic restyle: hero artwork spanning doors, cohesive theme, real texture and depth in every element.`;

  if (hasVisionBoardImages) {
    if (visionboard_intent === "exact_reference") {
      assembled += `\nVISIONBOARD REFERENCES — EXACT: The attached reference images ARE the wrap design. Use the subject matter, imagery, and design elements from these references directly on the vehicle. Reproduce them as professional wrap elements that follow the vehicle's body lines.`;
    } else {
      assembled += `\nVISIONBOARD REFERENCES — STYLE INSPIRATION: Study the mood, colors, and artistic style of references. Create an ORIGINAL design inspired by them.`;
    }
  }

  assembled += `\nFinish: ${finish} — ${finishSpec}`;
  assembled += `\nWrap covers painted body panels only. Windows, lights, wheels, trim stay factory.`;
  assembled += `\n${cameraAngle}`;
  assembled += `\n16:9 landscape, 4K. REAL PRINTED VINYL on the vehicle. Canon EOS R5 at 35mm f/8. INDISTINGUISHABLE from a real photograph. NO TEXT OR BRANDING.`;
  assembled += `\nBefore the image, output: 1) A creative design name (2-4 words, no trademarked names) 2) DESIGN ANCHOR: A detailed 3-sentence description of the design — colors with hex values, element positions relative to vehicle panels, flow direction, and key design features. This anchor ensures consistency across all camera angles.`;

  return assembled;
}
