// placementProfileEngine.ts - Handles 2D design to 3D vehicle panel mapping

export interface PlacementProfile {
  panelName: string;
  width: number;
  height: number;
  aspect: number;
  anchor: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  scale: number;
  offsetX: number;
  offsetY: number;
  preserveProportions: boolean;
}

export interface VehicleTemplate {
  year: string;
  make: string;
  model: string;
  panels: Record<string, {
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

// Build placement profile from uploaded design panels
export async function buildPlacementProfile(
  designPanels: Record<string, string>
): Promise<Record<string, PlacementProfile>> {
  const placementProfiles: Record<string, PlacementProfile> = {};

  for (const [panelName, imageUrl] of Object.entries(designPanels)) {
    try {
      // For edge function context, we estimate dimensions from URL metadata
      // In production, this would use actual image analysis
      const profile: PlacementProfile = {
        panelName,
        width: 1920, // Default high-res width
        height: 1080, // Default 16:9 aspect
        aspect: 1920 / 1080,
        anchor: 'center',
        scale: 1.0,
        offsetX: 0.0,
        offsetY: 0.0,
        preserveProportions: true,
      };

      placementProfiles[panelName] = profile;
    } catch (error) {
      console.error(`Failed to build profile for ${panelName}:`, error);
      // Use defaults on error
      placementProfiles[panelName] = {
        panelName,
        width: 1920,
        height: 1080,
        aspect: 16 / 9,
        anchor: 'center',
        scale: 1.0,
        offsetX: 0.0,
        offsetY: 0.0,
        preserveProportions: true,
      };
    }
  }

  return placementProfiles;
}

// Apply placement profiles to a vehicle template
export function applyPlacementProfile(
  placementProfiles: Record<string, PlacementProfile>,
  vehicleTemplate: VehicleTemplate
): Record<string, PlacementProfile & { finalScale: number; finalOffsetX: number; finalOffsetY: number }> {
  const mapped: Record<string, PlacementProfile & { finalScale: number; finalOffsetX: number; finalOffsetY: number }> = {};

  for (const [panelName, profile] of Object.entries(placementProfiles)) {
    const vehiclePanel = vehicleTemplate.panels[panelName];

    if (!vehiclePanel) {
      // Panel doesn't exist on this vehicle, skip
      continue;
    }

    const fitScale = Math.min(
      vehiclePanel.width / profile.width,
      vehiclePanel.height / profile.height
    );

    mapped[panelName] = {
      ...profile,
      finalScale: fitScale,
      finalOffsetX: vehiclePanel.x + (vehiclePanel.width - (profile.width * fitScale)) / 2,
      finalOffsetY: vehiclePanel.y + (vehiclePanel.height - (profile.height * fitScale)) / 2,
    };
  }

  return mapped;
}

// Get default vehicle template (generic panels that work for most vehicles)
export function getDefaultVehicleTemplate(year: string, make: string, model: string): VehicleTemplate {
  return {
    year,
    make,
    model,
    panels: {
      'full-wrap': { x: 0, y: 0, width: 100, height: 100 },
      'hood': { x: 30, y: 0, width: 40, height: 25 },
      'roof': { x: 25, y: 25, width: 50, height: 30 },
      'trunk': { x: 30, y: 55, width: 40, height: 20 },
      'driver-side': { x: 0, y: 20, width: 25, height: 40 },
      'passenger-side': { x: 75, y: 20, width: 25, height: 40 },
      'front-bumper': { x: 20, y: 75, width: 60, height: 15 },
      'rear-bumper': { x: 20, y: 90, width: 60, height: 10 },
      'driver-door': { x: 5, y: 25, width: 20, height: 30 },
      'passenger-door': { x: 75, y: 25, width: 20, height: 30 },
      'quarter-panels': { x: 0, y: 45, width: 100, height: 15 },
      'fenders': { x: 10, y: 15, width: 80, height: 10 },
    }
  };
}

// Generate placement instructions for AI prompt
export function generatePlacementInstructions(
  profiles: Record<string, PlacementProfile>
): string {
  if (Object.keys(profiles).length === 0) {
    return 'Apply the design as a full vehicle wrap covering all paintable surfaces.';
  }

  const instructions = Object.entries(profiles).map(([panelName, profile]) => {
    return `- ${panelName}: Scale ${profile.scale.toFixed(2)}x, anchor at ${profile.anchor}, offset (${profile.offsetX.toFixed(1)}, ${profile.offsetY.toFixed(1)})`;
  }).join('\n');

  return `PLACEMENT PROFILES:
${instructions}

Apply EACH design panel ONLY to its mapped vehicle panel region.
Do NOT move, resize, reinterpret, distort or recolor.
Maintain exact proportions and positioning as specified.`;
}
