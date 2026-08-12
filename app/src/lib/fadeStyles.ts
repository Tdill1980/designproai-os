// Fade style definitions for FadeWraps tool
// Simplified v1: 4 clear options that bundle pattern + direction

export type FadeStyleId = 
  | "front_back" 
  | "top_bottom" 
  | "diagonal"
  | "crossfade";

export interface FadeStyle {
  id: FadeStyleId;
  label: string;
  description: string;
  // Render configuration
  orientation: string;
  startPosition: string;
  endPosition: string;
}

// V1: Ship with 4 clear, installer-friendly styles including signature CrossFade
export const FADE_STYLES: FadeStyle[] = [
  {
    id: "front_back",
    label: "3/4 Fade",
    description: "Solid color across the front 3/4 of the vehicle, fading to black through the rear quarter only",
    orientation: "horizontal",
    startPosition: "front",
    endPosition: "rear"
  },
  { 
    id: "top_bottom", 
    label: "Top → Bottom", 
    description: "Color fades from roof down to rockers",
    orientation: "vertical",
    startPosition: "top",
    endPosition: "bottom"
  },
  { 
    id: "diagonal", 
    label: "Diagonal", 
    description: "Color fades diagonally across vehicle",
    orientation: "diagonal",
    startPosition: "front_top",
    endPosition: "rear_bottom"
  },
  { 
    id: "crossfade", 
    label: "CrossFade™", 
    description: "Black fades across opposing corners - front passenger to rear driver",
    orientation: "opposing_corners",
    startPosition: "front_passenger_corner",
    endPosition: "rear_driver_corner"
  }
];

// Pure black - matches render instructions exactly
const BLACK = '#000000';

// Get CSS gradient preview for each style (for UI thumbnails)
export const getStylePreviewGradient = (
  styleId: FadeStyleId, 
  colorHex: string = '#3B82F6'
): string => {
  const gradients: Record<FadeStyleId, string> = {
    front_back: `linear-gradient(to right, ${colorHex}, ${BLACK})`,
    top_bottom: `linear-gradient(to bottom, ${colorHex}, ${BLACK})`,
    diagonal: `linear-gradient(135deg, ${colorHex}, ${BLACK})`,
    crossfade: `radial-gradient(circle at 100% 0%, ${BLACK} 0%, transparent 45%), radial-gradient(circle at 0% 100%, ${BLACK} 0%, transparent 45%), ${colorHex}`
  };
  return gradients[styleId] || gradients.front_back;
};

export const getFadeStyleById = (id: FadeStyleId): FadeStyle | undefined => {
  return FADE_STYLES.find(style => style.id === id);
};

// Get render instructions for AI prompt - always fades to pure black
export const getFadeRenderInstructions = (styleId: FadeStyleId, colorHex: string): string => {
  const style = getFadeStyleById(styleId);
  if (!style) return '';
  
  const instructions: Record<FadeStyleId, string> = {
    front_back: `Apply a 3/4 fade wrap: the FRONT 75% of the vehicle (hood, front bumper, front fenders, front doors, rear doors, roof, A/B/C pillars) stays 100% solid ${colorHex} with NO blending toward black. The fade begins at roughly the C-pillar / start of the rear quarter panel and smoothly transitions through the rear quarter panel and trunk into pure black (#000000) at the rear bumper and tailgate. The transition occupies only the rear ~25% of the vehicle's length — it is NOT a full body ombre. Industry-standard 3/4 fade.`,
    top_bottom: `Apply a vertical gradient fade: ${colorHex} on the roof and upper body panels transitioning smoothly to pure black (#000000) at the rocker panels and lower body. The fade follows the vehicle's height from top to bottom.`,
    diagonal: `Apply a diagonal gradient fade: ${colorHex} at the front-top corner transitioning smoothly to pure black (#000000) at the rear-bottom corner. The fade cuts diagonally across the entire vehicle body at approximately 45 degrees.`,
    crossfade: `Apply the signature CrossFade™ pattern: Pure black (#000000) fades in ONLY at the front passenger corner (right front fender/bumper area) and the rear driver corner (left rear quarter panel/bumper area). ${colorHex} remains dominant across the rest of the vehicle including hood, roof, doors, and opposite corners. The black should NOT appear in the center or create a band - it is corner-weighted only, creating a diagonal cross-vehicle fade anchored at opposing corners. This is the WePrintWraps signature CrossFade effect.`
  };
  
  return instructions[styleId] || instructions.front_back;
};
