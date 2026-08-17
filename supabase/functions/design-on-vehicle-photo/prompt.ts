// Pure prompt builder for design-on-vehicle-photo.
// Extracted so it can be unit-tested with Vitest (no Deno runtime needed).
// index.ts imports buildDesignOnPhotoPrompt from here.

export const FINISH_INSTRUCTIONS: Record<string, string> = {
  gloss: "sharp specular reflections, wet-look highlights, mirror-like clarity",
  matte: "completely flat surface with zero specular reflections, soft diffuse lighting only",
  satin: "soft silken sheen with subtle, low-intensity reflections (between gloss and matte)",
};

export const COMMERCIAL_INDUSTRY_LABELS: Record<string, string> = {
  "food-beverage": "Food and Beverage",
  construction: "Construction",
  automotive: "Automotive",
  healthcare: "Healthcare",
  "real-estate": "Real Estate",
  landscaping: "Landscaping",
  delivery: "Delivery",
  entertainment: "Entertainment",
  other: "General",
};

export function buildDesignOnPhotoPrompt(params: {
  prompt: string;
  finish: string;
  vehicleInfo?: { year?: string; make?: string; model?: string };
  hasVisionBoard: boolean;
  visionBoardIntent?: string;
  companyName?: string;
  phone?: string;
  mascot?: string;
  industryType?: string;
  bulletPoints?: string[];
}): string {
  const {
    prompt,
    finish,
    vehicleInfo,
    hasVisionBoard,
    visionBoardIntent,
    companyName,
    phone,
    mascot,
    industryType,
    bulletPoints,
  } = params;
  const finishKey = (finish || "Gloss").toLowerCase();
  const finishSpec = FINISH_INSTRUCTIONS[finishKey] || FINISH_INSTRUCTIONS.gloss;

  const vehicleLine = vehicleInfo?.year || vehicleInfo?.make || vehicleInfo?.model
    ? `\nVEHICLE: ${[vehicleInfo.year, vehicleInfo.make, vehicleInfo.model].filter(Boolean).join(" ")}`
    : "";

  // Commercial brand block — active whenever a company name is supplied.
  // Without this the wrap ignores the business identity and Gemini invents
  // a random brand name.
  const trimmedCompany = (companyName || "").trim();
  const trimmedMascot = (mascot || "").trim();
  const keywords = (bulletPoints || []).map((b) => (b || "").trim()).filter(Boolean);
  const industryLabel =
    COMMERCIAL_INDUSTRY_LABELS[industryType || ""] || industryType || "";
  const isCommercial = trimmedCompany.length > 0;

  const brandLines: string[] = [];
  if (trimmedCompany) {
    brandLines.push(
      `  • COMPANY NAME: Render the exact text "${trimmedCompany}" as a polished, custom LOGO-STYLE treatment of the name — distinctive lettering, professional kerning — integrated into the wrap as the dominant brand element. Spell it EXACTLY as written — do not invent, rename, or substitute a different business name. It must be clearly readable from 15+ feet.`
    );
  }
  if (phone && phone.trim()) {
    brandLines.push(`  • CONTACT: Include "${phone.trim()}" in clean, legible secondary text.`);
  }
  if (trimmedMascot) {
    brandLines.push(
      `  • MASCOT / LOGO: Feature a custom illustrated ${trimmedMascot} as the brand's visual identity — make it prominent and memorable.`
    );
  }
  if (industryLabel) {
    brandLines.push(
      `  • INDUSTRY: This is a ${industryLabel} business. The wrap must instantly communicate what the business does to anyone who sees the vehicle.`
    );
  }
  if (keywords.length > 0) {
    brandLines.push(`  • BRAND KEYWORDS: Let these guide color palette, energy, and mood: ${keywords.join(", ")}.`);
  }

  const brandBlock = isCommercial
    ? `

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🏷️ COMMERCIAL BRAND IDENTITY — REQUIRED ON THE WRAP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

This is a commercial fleet wrap for a real business. The branding below is mandatory and must appear ON the vehicle wrap exactly as specified:

${brandLines.join("\n")}

Weight the branding toward the side facing the camera so it reads as a professional fleet wrap. Supporting graphics frame and enhance the branding — they never obscure the company name.`
    : "";

  const visionBoardBlock = hasVisionBoard
    ? `

VISIONBOARD REFERENCES (provided as additional images after IMAGE 1):
${
  visionBoardIntent === "exact_reference"
    ? "Treat the reference images as EXACT visual targets. Carry their colors, motifs, and graphic elements into the wrap design."
    : "Treat the reference images as STYLE / MOOD inspiration. Translate their feel into an original wrap design — do not copy them literally."
}`
    : "";

  return `You are the senior creative director at a high-end vinyl wrap studio. A wrap professional has given you this creative direction:

"${prompt}"

FINISH: ${finish || "Gloss"} — ${finishSpec}${vehicleLine}${brandBlock}${visionBoardBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎯 YOUR TASK
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMAGE 1 is the customer's REAL vehicle photograph. You will design a custom vinyl wrap that brings the creative direction above to life, AND show that wrap professionally installed on the vehicle in IMAGE 1 — in a single output image.

This is a PHOTO EDIT, not a fresh studio render. The output must look like the customer's original photograph with only the body-panel wrap added.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🛡️ PRESERVE FROM IMAGE 1 — NON-NEGOTIABLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  • Same vehicle: identical make, model, body shape, proportions, year-correct details
  • Same scene and background — every element behind the vehicle stays exactly as photographed
  • Same camera angle, framing, and perspective
  • Same lighting conditions: sun direction, shadow length, color temperature, ambient cast
  • Same wheels, tires, windows, glass, lights, mirrors, grille, badges, trim, bumpers, door handles, antennas, trailer (if present)
  • Same panel gaps, body lines, and reflective behavior of the sheet metal
  • Do NOT replace the vehicle with a different one. Do NOT relocate it to a studio. Do NOT remove the trailer or any other equipment in the photo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🎨 DESIGN THE WRAP — CREATIVE DIRECTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Apply the wrap ONLY to the painted body panels of the vehicle in IMAGE 1. The wrap should:

  1. Bring the creative direction above to life with hero artwork, layered composition, and bold visual flow that reads naturally front-to-rear
  2. Wrap and conform to the vehicle's actual 3D contours — the design follows the body shape, panel gaps, and curvature visible in IMAGE 1
  3. Translate any literal references in the prompt into real DESIGN GEOMETRY (e.g. "stealth bomber" → angular faceted panels with sharp swept edges; "samurai armor" → layered metallic plate segments)
  4. Read as a finished, custom-designed wrap — not a generic pattern, not a flat color, not a stock graphic
  5. ${isCommercial
    ? "Render the company name and any requested brand text crisply and legibly as part of the design; do NOT add unrequested watermarks, stray lettering, or a different business name"
    : "Avoid any text, lettering, watermarks, logos, or branding unless the creative direction explicitly asks for them"}
  6. Apply the ${finish} lamination finish: ${finishSpec}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🚫 STAY OFF THESE SURFACES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The wrap does not appear on: windows, glass, lights, mirrors, wheels, tires, grille mesh, trim, badges, door handles, exhaust, or any non-body-panel surface. These elements must show through unchanged from IMAGE 1.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌤️ LIGHTING AUTHORITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The wrap must look natural under the ACTUAL lighting in IMAGE 1. Do NOT apply studio lighting. Reflections, highlights, and shadows on the wrap must match the photo's sun direction, time of day, and ambient color temperature so the result reads as a real photograph of a real wrapped vehicle.

Before the image, output a single ORIGINAL creative design name (2-4 words, no quotes).`;
}
