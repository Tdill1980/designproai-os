/**
 * Tile Generator for Production Pipeline
 * Splits large SVG designs into printable panels
 */

interface TileResult {
  tiles: string[];
  tileCount: number;
  tileWidth: number;
  overlap: number;
}

// Standard printer roll widths
const ROLL_WIDTHS = {
  'standard': 53,    // 53" wide roll
  'wide': 60,        // 60" wide roll
  'narrow': 48       // 48" narrow roll
};

/**
 * Split SVG into printable tiles for roll printing
 */
export async function tileVector(
  svg: string, 
  rollWidth: keyof typeof ROLL_WIDTHS = 'standard',
  overlapInches: number = 0.5
): Promise<TileResult> {
  const panelWidth = ROLL_WIDTHS[rollWidth];
  const overlapPx = overlapInches * 72;
  
  // In a full implementation, we would:
  // 1. Parse SVG to get total dimensions
  // 2. Calculate number of tiles needed
  // 3. Slice SVG with overlap regions
  // 4. Add registration marks at overlaps
  // 5. Output individual tile SVGs

  // For this scaffold, return single-tile output
  // Real implementation would segment based on actual design size
  
  const tiles: string[] = [];
  
  // Add tile header with panel info
  const tile1 = svg.replace(
    '<svg',
    `<svg data-tile="1" data-panel-width="${panelWidth}"`
  ).replace(
    '</svg>',
    `
  <!-- Tile Info -->
  <g id="tile-info">
    <text x="50" y="1060" font-size="10" fill="#999">
      Panel 1 of 1 | Width: ${panelWidth}" | Overlap: ${overlapInches}"
    </text>
    
    <!-- Alignment guides -->
    <line x1="0" y1="0" x2="0" y2="1080" stroke="#0ff" stroke-width="0.5" stroke-dasharray="5,5" />
    <line x1="${panelWidth * 72}" y1="0" x2="${panelWidth * 72}" y2="1080" stroke="#0ff" stroke-width="0.5" stroke-dasharray="5,5" />
  </g>
</svg>`
  );

  tiles.push(tile1);

  return {
    tiles,
    tileCount: 1,
    tileWidth: panelWidth,
    overlap: overlapInches
  };
}

/**
 * Calculate optimal tiling for a given design size
 */
export function calculateTileLayout(
  designWidthInches: number,
  designHeightInches: number,
  rollWidth: number = 53
): { 
  tilesNeeded: number; 
  orientation: 'landscape' | 'portrait';
  wastePercent: number;
} {
  // Determine if design fits better horizontal or vertical
  const landscapeTiles = Math.ceil(designWidthInches / rollWidth);
  const portraitTiles = Math.ceil(designHeightInches / rollWidth);

  const useLandscape = landscapeTiles <= portraitTiles;
  const tilesNeeded = useLandscape ? landscapeTiles : portraitTiles;

  // Calculate material waste
  const totalMaterial = tilesNeeded * rollWidth * (useLandscape ? designHeightInches : designWidthInches);
  const designArea = designWidthInches * designHeightInches;
  const wastePercent = Math.round(((totalMaterial - designArea) / totalMaterial) * 100);

  return {
    tilesNeeded,
    orientation: useLandscape ? 'landscape' : 'portrait',
    wastePercent
  };
}
