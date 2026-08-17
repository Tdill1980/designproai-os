/**
 * Bleed Generator for Production Pipeline
 * Adds production bleed offset to SVG cut paths
 */

interface BleedResult {
  svg: string;
}

/**
 * Add bleed offset to SVG paths
 * Standard bleed: 0.5" (12.7mm) for vinyl wrap production
 */
export async function generateBleedVector(svg: string, bleedInches: number = 0.5): Promise<BleedResult> {
  // Calculate bleed in SVG units (assuming 72 DPI base)
  const bleedPx = bleedInches * 72;
  
  // In a full implementation, we would:
  // 1. Parse SVG paths
  // 2. Calculate offset paths using Clipper.js or similar
  // 3. Handle inner vs outer offsets
  // 4. Merge overlapping paths
  // 5. Output clean offset SVG

  // For now, add a visual bleed indicator to the SVG
  const bleedSvg = svg.replace(
    '</svg>',
    `
  <!-- Bleed Offset: ${bleedInches}" -->
  <g id="bleed-outline" transform="scale(1.013)">
    <rect x="0" y="0" width="100%" height="100%" 
          fill="none" 
          stroke="#00ff00" 
          stroke-width="1" 
          stroke-dasharray="10,5"
          opacity="0.5" />
  </g>
  
  <!-- Bleed Info -->
  <text x="50" y="50" font-size="12" fill="#666">
    Bleed: ${bleedInches}" (${(bleedInches * 25.4).toFixed(1)}mm)
  </text>
</svg>`
  );

  return { svg: bleedSvg };
}

/**
 * Calculate bleed for specific material types
 */
export function getBleedForMaterial(material: string): number {
  const bleedMap: Record<string, number> = {
    'chrome': 0.25,      // Chrome needs less bleed (wraps around edges)
    'matte': 0.5,        // Standard bleed
    'gloss': 0.5,        // Standard bleed
    'satin': 0.5,        // Standard bleed
    'carbon': 0.375,     // Patterned materials need careful alignment
    'brushed': 0.375,    // Directional materials
    'default': 0.5
  };

  const lowerMaterial = material.toLowerCase();
  for (const [key, value] of Object.entries(bleedMap)) {
    if (lowerMaterial.includes(key)) return value;
  }
  return bleedMap.default;
}
