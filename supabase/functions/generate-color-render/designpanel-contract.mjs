/**
 * Focused DesignPanel contract extracted from generate-color-render's proven
 * DesignIQ V3 branch. This module is pure so production and tests share the
 * exact prompt and four-tier Gemini request construction.
 */

const FINISH_SPEC = Object.freeze({
  gloss: "High-gloss laminate — shiny wet-look surface with crisp reflections.",
  matte: "Matte laminate — completely flat, zero reflections, velvet appearance.",
  satin: "Satin laminate — soft sheen between matte and gloss, silk-like.",
});

const PHOTO_LOCK = `\n\nPHOTOGRAPHIC REALISM LOCK (the customer explicitly asked for a real photo — obey over any "artistic" wording): the imagery in this wrap must read as an actual high-resolution color PHOTOGRAPH — natural light, true-to-life color, real depth and texture. It is NOT a cartoon, illustration, drawing, painting, vector, or clip-art. Only a LOGO may be a designed graphic.`;

const ANCHOR_PREFIX = "[GENERATE IMAGE] Create a photorealistic production asset: ";
const PRIMARY_LABELS = new Set(["pattern-primary", "hero-reference", "swatch"]);

export function buildDesignPanelPrompt(input) {
  const vehicle = String(input.vehicle || "").trim();
  const viewType = String(input.viewType || "side");
  const panelName = String(input.panelName || "Custom Panel Design");
  const finish = String(input.finish || "gloss");
  const designAnchorText = String(input.designAnchorText || "").trim();
  const briefText = String(input.briefText || "").toLowerCase();
  const cameraAngle = String(input.cameraAngle || "");
  const studioEnvironment = String(input.studioEnvironment || "");
  const wrapCoverageRules = String(input.wrapCoverageRules || "");
  const hasHeroReference = Boolean(input.hasHeroReference);

  const wantsPhoto =
    /\b(photo|photos|photograph|photographs|photographic|photo-?realistic|photorealism|photoreal)\b/.test(briefText) ||
    /\b(lifelike|true[-\s]to[-\s]life)\b/.test(briefText) ||
    (/\brealistic\b/.test(briefText) && /\b(photo|image|render|look|looking|scene|imagery)\b/.test(briefText));
  const finishSpec = FINISH_SPEC[finish.toLowerCase()] || FINISH_SPEC.gloss;

  let prompt;
  if (hasHeroReference && viewType !== "side" && viewType !== "driver-side") {
    const viewScene = viewType === "hood_detail"
      ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a premium artistic vehicle wrap. The wrap is real printed vinyl — the hood artwork is the hero, rich with layered detail and depth. No text, no logos, no branding.`
      : viewType === "close-up"
        ? `A photorealistic close-up photograph of a ${vehicle}'s body panel from 12 inches away. The camera is close enough to see the vinyl texture grain, laminate sheen, ink depth, and how the printed design conforms to the body curve. Show a section where the wrap design has detail — pattern, color transitions, or artwork. The body line, panel edge, and surface contour provide context. This is about seeing the MATERIAL QUALITY and DESIGN DETAIL up close.`
        : `A photorealistic studio photograph of a ${vehicle} with a premium artistic vehicle wrap fully installed. The wrap is real printed vinyl — a bold, gallery-worthy design with hero artwork spanning the door panels as the focal point. The design flows naturally with the vehicle's body lines, following fender curves and wheel arch contours. Rich layered composition with depth: background atmosphere, mid-ground flow elements, and foreground hero artwork. No text, no logos, no branding on the vehicle.`;
    const viewLabel = viewType.replace(/[-_]/g, " ");

    prompt = `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

${viewScene} The attached reference image shows this EXACT wrap design photographed from the driver side. Render the SAME vehicle with the SAME wrap design from the ${viewLabel} angle.

The wrap is real printed vinyl — every color, pattern, graphic element, and design detail from the reference must appear consistently on this view. The design flows naturally with the vehicle body lines.${designAnchorText ? `

DESIGN CONTINUITY — match this driver-side description exactly:
${designAnchorText}` : ""}

Finish: ${finish.toUpperCase()} — ${finishSpec} The vinyl finish is ${finish.toLowerCase()} across ALL body panels — consistent finish on every surface.

${studioEnvironment}

${cameraAngle}

The wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.${viewType === "close-up"
  ? "\nCanon EOS R5, 85mm f/2.8, shallow depth of field with rich bokeh. Razor-sharp focus on vinyl surface texture showing depth, material quality, and fine detail. Vibrant colors."
  : "\nCanon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors."}${wantsPhoto ? PHOTO_LOCK : ""}`;
  } else {
    prompt = `CAMERA ANGLE (LOCKED — read this FIRST):
${cameraAngle}

A photorealistic studio photograph of a ${vehicle} with a professionally installed vinyl wrap. The attached panel artwork has been physically printed on cast vinyl, laminated, and hand-installed on this vehicle. Render this EXACT artwork on the vehicle body — the wrap follows every body line, fender curve, and wheel arch contour.

Panel Design: ${panelName}
Finish: ${finish.toUpperCase()} — ${finishSpec} The vinyl finish is ${finish.toLowerCase()} across ALL body panels — consistent finish on every surface.

${studioEnvironment}

${cameraAngle}

The wrap covers painted body panels only. Windows, lights, wheels, and trim stay factory.
Canon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.${wantsPhoto ? PHOTO_LOCK : ""}`;

    if (designAnchorText && viewType !== "side") {
      prompt = `Same wrap from a different angle. Match this driver-side reference:\n${designAnchorText}\n\n${prompt}`;
    }
  }

  if (prompt && wrapCoverageRules && !prompt.includes("WRAP COVERAGE")) {
    prompt += `\n\n${wrapCoverageRules}`;
    prompt += "\nDESIGN PLACEMENT: Design like a pro-level designer educated on correct wrap installation placement. Design must flow seamlessly across the vehicle. Every render must display the same cohesive design — if a hood design is created and the hood is visible in another view, it must show the same design.";
  }

  return prompt;
}

export function buildDesignPanelRequestParts({ attempt, prompt, references }) {
  const safeAttempt = Number(attempt);
  const allReferences = Array.isArray(references) ? references : [];
  if (safeAttempt === 1) {
    return {
      parts: [{ text: prompt }, ...allReferences.map((part) => ({ inlineData: part.inlineData }))],
      modalities: ["TEXT", "IMAGE"],
    };
  }

  const keptReferences = allReferences
    .filter((part) => PRIMARY_LABELS.has(part.label))
    .map((part) => ({ inlineData: part.inlineData }));
  const text = safeAttempt === 2
    ? (ANCHOR_PREFIX + prompt).substring(0, 2000)
    : ("[GENERATE IMAGE] " + prompt).substring(0, 1000);

  return {
    parts: [{ text }, ...keptReferences],
    modalities: safeAttempt === 3 ? ["IMAGE"] : ["TEXT", "IMAGE"],
  };
}
