import { ASPECT_RATIO_REQUIREMENT } from "./aspect-ratio-requirement.ts";
import { PHOTOREALISM_REQUIREMENT } from "./photorealism-prompt.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "./forbidden-text-instructions.ts";
import { STUDIO_ENVIRONMENT } from "./studio-os.ts";
import { getCameraAngle } from "./view-angles-os.ts";

export function buildApproveModePrompt(params: {
  vehicle: string;
  colorData: any;
  viewType: string;
  panelDimensions?: {
    sideW?: number;
    sideH?: number;
    hoodW?: number;
    hoodL?: number;
    backW?: number;
    backH?: number;
    roofW?: number;
    roofL?: number;
    totalSqFt?: number;
  };
}): string {
  const { vehicle, colorData, viewType, panelDimensions } = params;

  // Use the shared view-angles-os camera angles — same source as DesignProAI
  const cameraAngle = getCameraAngle(viewType || 'side');

  // View-specific scene framing — mirrors DesignProAI's approach in generate-color-render
  const viewScene = viewType === 'hood_detail'
    ? `A photorealistic studio photograph looking down at the hood of a ${vehicle} with a professionally installed vinyl wrap. The uploaded design has been printed on cast vinyl and installed on the hood. The hood artwork is the hero — rich with layered detail and depth. No text, no logos, no branding.`
    : viewType === 'close-up'
    ? `A photorealistic close-up photograph of a ${vehicle}'s wrapped side body from 12-18 inches away, angled along the bodyline. Door handle, window edge, and fender curve visible for context. The printed vinyl wrap dominates the frame — ink depth, laminate sheen with specular highlights, and material texture conforming to body curves. This must look like a real photo of installed vinyl, not a digital render.`
    : viewType === 'roof'
    ? `A photorealistic studio photograph looking directly down at the roof of a ${vehicle} with a professionally installed vinyl wrap. Camera is directly overhead. The uploaded design has been printed on cast vinyl and installed on the roof panel. The roof fills 90% of the frame. No text, no logos, no branding.`
    : `A photorealistic studio photograph of a ${vehicle} with a professionally installed vinyl wrap. The uploaded design has been physically printed on cast vinyl, laminated, and hand-installed on this vehicle. The wrap follows every body line, fender curve, and wheel arch contour. No text, no logos, no branding.`;

  // Camera spec — mirrors DesignProAI: 85mm for close-up, 35mm for everything else
  const cameraSpec = viewType === 'close-up'
    ? `Canon EOS R5, 85mm f/2.8, shallow depth of field with rich bokeh. Razor-sharp focus on vinyl surface texture showing depth, material quality, and fine detail. Vibrant colors.`
    : `Canon EOS R5, 35mm f/8, tack-sharp. 16:9 landscape. Razor-sharp details, perfect exposure, vibrant colors.`;

  const coverageNote = colorData?.coverageType === 'quarter'
    ? '\nCOVERAGE: Partial wrap — rear quarter panels and tailgate only. Hood, fenders, doors, and roof remain factory/unwrapped.'
    : colorData?.coverageType === 'half'
    ? '\nCOVERAGE: Half wrap — rear half of the vehicle is wrapped (from the B-pillar back). Hood, front fenders, and front doors remain factory/unwrapped.'
    : '';

  const panelDimensionsBlock = panelDimensions ? `
VEHICLE PANEL DIMENSIONS (from production database — use for accurate scaling):
${panelDimensions.sideW ? `- Side panels: ${panelDimensions.sideW}" wide × ${panelDimensions.sideH}" tall` : ""}
${panelDimensions.hoodW ? `- Hood: ${panelDimensions.hoodW}" wide × ${panelDimensions.hoodL}" long` : ""}
${panelDimensions.backW ? `- Rear: ${panelDimensions.backW}" wide × ${panelDimensions.backH}" tall` : ""}
${panelDimensions.roofW ? `- Roof: ${panelDimensions.roofW}" wide × ${panelDimensions.roofL}" long` : ""}
${panelDimensions.totalSqFt ? `- Total wrap coverage: ${panelDimensions.totalSqFt} sqft` : ""}
Scale the design proportionally to these real dimensions.` : "";

  return `${ASPECT_RATIO_REQUIREMENT}

${PHOTOREALISM_REQUIREMENT}

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

${viewScene}

Extract ONLY the wrap design graphics from the uploaded image. Ignore backgrounds, templates, grids, text overlays, and mock-up vehicles. Apply ONLY the actual design to the ${vehicle}. ALL text, logos, and graphics from the design must be fully visible — never crop or hide any element.

The wrap is real printed vinyl — zero air bubbles, zero wrinkles, flawless professional installation. Design flows with perfect continuity across all body panels. Realistic vinyl texture with gloss sheen.

Finish: GLOSS — mirror-like reflections, wet look, maximum shine, sharp highlights.

${STUDIO_ENVIRONMENT}

${cameraAngle}
${panelDimensionsBlock}

The wrap covers painted body panels only. Windows, lights, wheels, grilles, chrome trim, badges, and emblems stay factory.${coverageNote}

${cameraSpec}`;
}
