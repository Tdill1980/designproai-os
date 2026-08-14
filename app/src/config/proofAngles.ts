/**
 * PROOF ANGLES - LOCKED CONFIGURATION
 * 
 * This file defines the EXACT 6 angles used for all RestylePro proof generation.
 * These angles are LOCKED and should NOT be modified without system-wide review.
 * 
 * Used by: ColorPro, GraphicsPro, FadeWraps, ApprovePro, PatternPro, DesignPanelPro
 */

export interface ProofAngle {
  id: string;
  position: number;
  label: string;
  gridPosition: { row: number; col: number };
  camera: {
    yaw: number;
    pitch: number;
    distance: number;
    fov: number;
  };
  lighting: {
    yaw: number;
    pitch: number;
  };
  aiPrompt: string;
}

export interface ProofConfig {
  version: string;
  locked: boolean;
  studio: {
    backdrop: string;
    floor: string;
    lighting: string;
  };
  grid: {
    columns: number;
    rows: number;
  };
  watermarks: {
    toolName: { position: 'top-left' };
    filmInfo: { position: 'bottom-right' };
  };
  angles: ProofAngle[];
}

/**
 * LOCKED PROOF CONFIGURATION
 * Version 1.0 - Do not modify without approval
 */
export const PROOF_CONFIG: ProofConfig = {
  version: '1.0',
  locked: true,
  
  studio: {
    backdrop: 'light gray gradient (#E5E5E5 to #F5F5F5)',
    floor: 'dark charcoal reflective (#2A2A2A)',
    lighting: 'soft diffusion with subtle rim highlights'
  },
  
  grid: {
    columns: 3,
    rows: 2
  },
  
  watermarks: {
    toolName: { position: 'top-left' },
    filmInfo: { position: 'bottom-right' }
  },
  
  angles: [
    {
      id: 'roof',
      position: 1,
      label: 'Roof View',
      gridPosition: { row: 1, col: 1 },
      camera: {
        yaw: 0,
        pitch: 90,
        distance: 1.5,
        fov: 28
      },
      lighting: {
        yaw: 0,
        pitch: 90
      },
      aiPrompt: `ROOF ANGLE (Position 1):
- Camera: Directly overhead top-down view, camera centered above the vehicle looking straight down
- Show the full roof panel, A-pillars to trunk
- The roof surface fills 90% of the frame
- No visible floor or walls
- The wrap design on the roof is the primary subject`
    },
    {
      id: 'front',
      position: 2,
      label: 'Front View',
      gridPosition: { row: 1, col: 2 },
      camera: {
        yaw: 0,
        pitch: 8,
        distance: 1.3,
        fov: 26
      },
      lighting: {
        yaw: 0,
        pitch: 35
      },
      aiPrompt: `FRONT VIEW (Position 2):
- Camera: Straight-on front view
- Distance: Vehicle fills 65% of frame
- Height: Slightly below eye level (6-10° pitch)
- Rotation: 0° - perfectly centered on grille
- Lighting: Symmetrical, soft boxes from both sides
- Shows hood, grille, headlights, front bumper clearly
- No perspective distortion on vehicle width`
    },
    {
      id: 'driver',
      position: 3,
      label: 'Driver Side',
      gridPosition: { row: 1, col: 3 },
      camera: {
        yaw: 90,
        pitch: 8,
        distance: 1.35,
        fov: 28
      },
      lighting: {
        yaw: 115,
        pitch: 35
      },
      aiPrompt: `DRIVER SIDE VIEW (Position 3):
- Camera: Photograph taken from the LEFT side of the vehicle. Vehicle faces RIGHT in the frame. Camera is at the driver's door.
- Distance: Vehicle fills 60% of frame horizontally
- Height: Eye level (6-10° pitch)
- Rotation: 90° - perfect side profile, vehicle nose points RIGHT
- Lighting: Key light from front-quarter, rim light from rear
- Shows full rocker panel, door lines, wheel wells
- Vehicle centered in frame, equal space front and rear`
    },
    {
      id: 'passenger',
      position: 4,
      label: 'Passenger Side',
      gridPosition: { row: 2, col: 1 },
      camera: {
        yaw: -90,
        pitch: 8,
        distance: 1.35,
        fov: 28
      },
      lighting: {
        yaw: -65,
        pitch: 35
      },
      aiPrompt: `PASSENGER SIDE VIEW (Position 4):
- Camera: Photograph taken from the RIGHT side of the vehicle. Vehicle faces LEFT in the frame. Camera is at the passenger door. This is the OPPOSITE perspective of driver side.
- Distance: Vehicle fills 60% of frame horizontally
- Height: Eye level (6-10° pitch)
- Rotation: -90° (270°) - perfect side profile, vehicle nose points LEFT (opposite of driver side)
- Lighting: Key light from front-quarter, rim light from rear
- Vehicle faces the OPPOSITE direction compared to driver side view
- Vehicle centered in frame, equal space front and rear`
    },
    {
      id: 'rear',
      position: 5,
      label: 'Rear View',
      gridPosition: { row: 2, col: 2 },
      camera: {
        yaw: 180,
        pitch: 10,
        distance: 1.3,
        fov: 28
      },
      lighting: {
        yaw: 180,
        pitch: 35
      },
      aiPrompt: `REAR VIEW (Position 5):
- Camera: Straight-on rear view
- Distance: Vehicle fills 65% of frame
- Height: Slightly below eye level (8-12° pitch)
- Rotation: 180° - perfectly centered on rear
- Lighting: Symmetrical, soft boxes from both sides
- Shows tailgate/trunk, taillights, rear bumper, exhaust
- No perspective distortion on vehicle width`
    },
    {
      id: 'detail',
      position: 6,
      label: 'Detail View',
      gridPosition: { row: 2, col: 3 },
      camera: {
        yaw: 15,
        pitch: 35,
        distance: 0.6,
        fov: 45
      },
      lighting: {
        yaw: 45,
        pitch: 50
      },
      aiPrompt: `DETAIL VIEW - HOOD CLOSE-UP (Position 6):
- Camera: Macro close-up of hood surface
- Distance: Fills 90% of frame with hood panel
- Angle: Looking down at hood from front-quarter
- Focus: Material texture, finish quality, color depth
- Lighting: Raking light to reveal texture (metallic flake, brushed grain, color-shift)
- CRITICAL: This shot sells the wrap quality
- Show surface reflection, material properties, finish characteristics
- For color-flip films: angle to show color transition
- For metallics: show flake distribution and sparkle
- For matte/satin: show smooth, even surface texture`
    }
  ]
};

/**
 * Helper: Get angle by ID
 */
export const getAngleById = (id: string): ProofAngle | undefined => {
  return PROOF_CONFIG.angles.find(angle => angle.id === id);
};

/**
 * Helper: Get angle by position (1-6)
 */
export const getAngleByPosition = (position: number): ProofAngle | undefined => {
  return PROOF_CONFIG.angles.find(angle => angle.position === position);
};

/**
 * Helper: Get all angle IDs in order
 */
export const getAngleIds = (): string[] => {
  return PROOF_CONFIG.angles
    .sort((a, b) => a.position - b.position)
    .map(angle => angle.id);
};

/**
 * Helper: Get angle labels for UI display
 */
export const getAngleLabels = (): Record<string, string> => {
  return PROOF_CONFIG.angles.reduce((acc, angle) => {
    acc[angle.id] = angle.label;
    return acc;
  }, {} as Record<string, string>);
};

/**
 * Helper: Validate that all 6 angles are present
 */
export const validateProofImages = (images: Record<string, string>): boolean => {
  const requiredAngles = getAngleIds();
  return requiredAngles.every(angleId => !!images[angleId]);
};

/**
 * =============================================================================
 * BACKWARD COMPATIBILITY LAYER
 * =============================================================================
 * 
 * CRITICAL: 4 paying customers have existing renders using old view keys.
 * This mapping ensures old renders continue to work while new renders use
 * the locked proof system.
 * 
 * OLD SYSTEM KEYS: hero, front, side, passenger-side, rear, top
 * NEW SYSTEM KEYS: roof, front, driver, passenger, rear, detail
 */

/**
 * Legacy mapping: OLD keys → NEW keys
 * Used when reading old database records
 */
export const LEGACY_VIEW_MAPPING: Record<string, string> = {
  // Direct mappings (unchanged)
  'hero': 'roof',   // Legacy hero maps to new roof
  'roof': 'roof',
  'front': 'front',
  'rear': 'rear',
  
  // Changed mappings
  'side': 'driver',
  'driver-side': 'driver',
  'passenger-side': 'passenger',
  'top': 'detail',
  'closeup': 'detail',
  'hood_detail': 'detail'
};

/**
 * Reverse mapping: NEW keys → OLD keys
 * Used for UI fallback when looking up render URLs
 */
export const LEGACY_VIEW_MAPPING_REVERSE: Record<string, string[]> = {
  'roof': ['roof', 'hero'],
  'front': ['front'],
  'driver': ['side', 'driver-side'],
  'passenger': ['passenger-side'],
  'rear': ['rear'],
  'detail': ['top', 'closeup', 'hood_detail']
};

/**
 * Convert legacy view type to new angle ID
 */
export const convertLegacyViewType = (viewType: string): string => {
  return LEGACY_VIEW_MAPPING[viewType] || viewType;
};

/**
 * Get render URL with fallback to legacy keys
 * UI components should use this to support both old and new renders
 * 
 * @example
 * const url = getRenderUrlWithFallback(renderUrls, 'driver');
 * // Checks: renderUrls['driver'] || renderUrls['side'] || renderUrls['driver-side']
 */
export const getRenderUrlWithFallback = (
  renderUrls: Record<string, string> | null | undefined,
  angleId: string
): string | null => {
  if (!renderUrls) return null;
  
  // Try new key first
  if (renderUrls[angleId]) {
    return renderUrls[angleId];
  }
  
  // Try legacy fallback keys
  const legacyKeys = LEGACY_VIEW_MAPPING_REVERSE[angleId] || [];
  for (const legacyKey of legacyKeys) {
    if (renderUrls[legacyKey]) {
      return renderUrls[legacyKey];
    }
  }
  
  return null;
};

/**
 * Get all view types that should be accepted by edge function
 * Includes both old and new keys for backward compatibility
 */
export const getAllAcceptedViewTypes = (): string[] => {
  const newKeys = getAngleIds();
  const oldKeys = Object.keys(LEGACY_VIEW_MAPPING);
  return [...new Set([...newKeys, ...oldKeys])];
};

/**
 * Normalize render URLs object to use new keys
 * Call this when saving NEW renders to database
 */
export const normalizeRenderUrls = (
  renderUrls: Record<string, string>
): Record<string, string> => {
  const normalized: Record<string, string> = {};
  
  for (const [key, url] of Object.entries(renderUrls)) {
    const newKey = convertLegacyViewType(key);
    normalized[newKey] = url;
  }
  
  return normalized;
};
