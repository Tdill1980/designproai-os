import { InkFusionColor } from "./restyleproai-colors";

export type LaminationFinish = 'Gloss' | 'Satin' | 'Matte' | 'Sparkle';

interface InkFusionPromptOptions {
  color: InkFusionColor & { lamination?: LaminationFinish };
  fadeConfig?: string;
}

// Helper to darken hex by percentage for ink-density rendering
function darkenHex(hex: string, percent: number): string {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.max(0, Math.floor((num >> 16) * (1 - percent)));
  const g = Math.max(0, Math.floor(((num >> 8) & 0x00FF) * (1 - percent)));
  const b = Math.max(0, Math.floor((num & 0x0000FF) * (1 - percent)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

export function buildInkFusionPrompt({ color, fadeConfig }: InkFusionPromptOptions): string {
  const finish = color.lamination || 'Gloss';
  const displayHex = color.hex;
  const renderHex = color.renderHex || darkenHex(color.hex, 0.20); // 20% darker fallback
  const inkDensity = color.inkDensity || 1.0;
  
  return `
Render an automotive wrap using the InkFusion™ printed wrap system.

### BASE MATERIAL (IMPORTANT)
The wrap is printed on **3M IJ180mC-120 Silver Metallic**, which means:
- A fine metallic shimmer must appear under the printed color.
- No large flakes, chrome-like reflections, or holographic effects.
- Printed metallic effect should remain uniform and subtle.
- This is PRINTED INK, not cast vinyl film.

### FINISH: ${finish.toUpperCase()}
${getFinishInstructions(finish)}

### INK-DENSITY COLOR ACCURACY (CRITICAL)
InkFusion Color: ${color.name}
- UI Preview HEX: ${displayHex} (for reference only)
- RENDER HEX: ${renderHex} (USE THIS for actual rendering)
- Ink Density Factor: ${inkDensity}x
- Base Finish: ${color.finish}
- Applied Lamination: ${finish}

⚠️ IMPORTANT: The rendered color must be RICHER and DEEPER than ${displayHex}.
Printed ink absorbs light differently than screens display it.
Use ${renderHex} as the base color for all rendering.

### GRADIENT / FADE CONFIGURATION
${fadeConfig || "Apply no gradient unless specified."}

### NON-LINEAR FADE BEHAVIOR (INKFUSION SPECIFIC)
When fading to black:
- Transition is NON-LINEAR (exponential darkening curve)
- Color SATURATION INCREASES as it approaches black (ink richness)
- Mid-fade zone shows 1.3x saturation boost before darkening
- Black end must be TRUE black (#000000) with no color bleed
- NEVER use linear RGB interpolation - printed ink doesn't work that way

### RENDERING RULES
- Always render as a **printed ink wrap**, not cast vinyl.
- Colors should feel "painted" with depth, not "applied" like sticker.
- Preserve realistic lamination behavior.
- Do not modify the environment lighting or camera angle.
- Present the vehicle in a clean, neutral studio.
- Metallic substrate shimmer must be visible through the printed color.
- No chrome-like sharp reflections or vinyl clearcoat appearance.
`;
}

function getFinishInstructions(finish: LaminationFinish): string {
  switch (finish) {
    case 'Gloss':
      return `**Gloss Laminate (Default)**
- Smooth printed gloss appearance.
- Soft reflections, not overly sharp or mirror-like.
- Metallic shimmer visible evenly beneath printed ink.
- Enhanced depth and vibrancy.`;
    
    case 'Satin':
      return `**Satin Laminate**
- Lower, diffused reflectivity.
- Subtle metallic shimmer still visible.
- Soft highlights-never glossy.
- Elegant semi-matte appearance.`;
    
    case 'Matte':
      return `**Matte Laminate**
- Near-zero reflections.
- Metallic effect greatly reduced but still subtly rich.
- No shine whatsoever.
- Flat, sophisticated finish.`;
    
    case 'Sparkle':
      return `**Sparkle Finish**
- Printed micro-sparkle overlay.
- Tiny reflective points evenly distributed across surface.
- NO rainbow glitter, NO holographic effects.
- Fine metallic sparkle visible only in highlights and on curves.`;
    
    default:
      return `**Gloss Laminate (Default)**
- Smooth printed gloss appearance.
- Soft reflections, not overly sharp.
- Metallic shimmer visible beneath printed ink.`;
  }
}
