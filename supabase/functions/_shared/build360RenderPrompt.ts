// build360RenderPrompt.ts - 360° spin render prompt builder

import { CameraAngle } from "./angleEngine.ts";
import { PHOTOREALISM_REQUIREMENT } from "./photorealism-prompt.ts";
import { FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS } from "./forbidden-text-instructions.ts";
import { getStudioEnvironment, selectStudioForFinish } from "./studio-environments.ts";

interface Build360PromptParams {
  vehicle: {
    year: string | number;
    make: string;
    model: string;
  };
  materialProfile?: {
    colorName?: string;
    manufacturer?: string;
    hex?: string;
    finish?: string;
    lab?: { L: number; a: number; b: number };
    reflectivity?: number;
    metallic_flake?: number;
  };
  designImage?: string;
  mode: 'colorpro' | 'patternpro' | 'designpanelpro' | 'approvepro';
  angle: CameraAngle;
}

export function build360RenderPrompt({
  vehicle,
  materialProfile,
  designImage,
  mode,
  angle,
}: Build360PromptParams): string {
  const vehicleDescription = `${vehicle.year} ${vehicle.make} ${vehicle.model}`;
  
  // Build material/design application block based on mode
  let applicationBlock = '';
  
  if (mode === 'approvepro' && designImage) {
    applicationBlock = `
VINYL WRAP PROJECTION:
Apply the provided 2D wrap design EXACTLY as-is to all visible vehicle panels.
- DO NOT modify, recolor, reinterpret, distort, or regenerate the artwork
- Preserve the exact colors, patterns, and graphics from the source design
- Apply as a vinyl wrap with proper surface conforming on curves and edges
- Maintain seamless continuity across body lines
- This is a vinyl wrap projection, NOT a painted surface`;
  } else if (mode === 'designpanelpro' && designImage) {
    applicationBlock = `
DESIGN PANEL APPLICATION:
Apply the provided panel design as a full-body vehicle wrap.
- Extract visual pattern elements: colors, shapes, gradients, textures
- Apply seamlessly across hood, roof, sides, bumpers, fenders, mirrors
- Maintain design scale and proportions across large surfaces
- Preserve design integrity without modification
- Exclude windows, lights, wheels, trim from wrap`;
  } else if (mode === 'patternpro' && designImage) {
    applicationBlock = `
PATTERN WRAP APPLICATION:
Apply the provided pattern as a repeating texture wrap.
- Tile the pattern seamlessly across all vehicle surfaces
- Maintain consistent scale across body panels
- Preserve pattern orientation and flow
- Apply to all paintable surfaces`;
  } else if (materialProfile) {
    applicationBlock = `
MATERIAL APPLICATION:
Apply the specified manufacturer vinyl wrap material.
${materialProfile.colorName ? `- Color: ${materialProfile.colorName}` : ''}
${materialProfile.manufacturer ? `- Manufacturer: ${materialProfile.manufacturer}` : ''}
${materialProfile.hex ? `- Base hex: ${materialProfile.hex}` : ''}
${materialProfile.finish ? `- Finish: ${materialProfile.finish}` : ''}
${materialProfile.lab ? `- LAB values: L=${materialProfile.lab.L}, a=${materialProfile.lab.a}, b=${materialProfile.lab.b}` : ''}
${materialProfile.reflectivity !== undefined ? `- Reflectivity: ${materialProfile.reflectivity}` : ''}
${materialProfile.metallic_flake !== undefined ? `- Metallic flake: ${materialProfile.metallic_flake}` : ''}`;
  }

  // Determine studio based on material finish (chrome needs hard light)
  const finish = materialProfile?.finish || 'gloss';
  const studioEnvironment = getStudioEnvironment(selectStudioForFinish(finish), finish);
  
  return `
Render a photorealistic ${vehicleDescription}.

CAMERA POSITIONING:
- Camera yaw: ${angle.yaw}° (rotation around vehicle)
- Camera pitch: ${angle.pitch}° (elevation angle)  
- Camera distance: ${angle.distance}x vehicle length
- Field of view: ${angle.fov}°
- Primary light yaw: ${angle.lightYaw}°
- Primary light pitch: ${angle.lightPitch}°

${applicationBlock}

${studioEnvironment}

${PHOTOREALISM_REQUIREMENT}

FRAMING RULES:
- Fill 70% of frame with vehicle (medium professional framing)
- Keep entire vehicle inside frame at all times
- No cropping of wheels, bumpers, mirrors, or roof
- Maintain IDENTICAL camera distance and bounding box across all 360° angles
- No extreme close-ups or zoom variations

${FORBIDDEN_TEXT_WATERMARK_INSTRUCTIONS}

OUTPUT:
- Single photorealistic vehicle image only
- No text, labels, UI elements, or borders
- Professional automotive photography quality
${designImage ? `\nDESIGN SOURCE: ${designImage}` : ''}
`;
}
