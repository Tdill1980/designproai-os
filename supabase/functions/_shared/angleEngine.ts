// angleEngine.ts - Universal angle controller for all RestylePro tools

export interface CameraAngle {
  yaw: number;
  pitch: number;
  distance: number;
  lightYaw: number;
  lightPitch: number;
  fov: number;
  label: string;
}

export interface MaterialProfile {
  isFlipFilm?: boolean;
  isPearl?: boolean;
  isMetallic?: boolean;
  isSatin?: boolean;
  isMatte?: boolean;
}

export const angleEngine = {
  // Get 360° spin angles (24 frames = 15° increments)
  get360Angles(count = 24): CameraAngle[] {
    const step = 360 / count;
    return Array.from({ length: count }, (_, i) => ({
      yaw: i * step,
      pitch: 10,
      distance: 1.25,
      lightYaw: (i * step) + 25,
      lightPitch: 35,
      fov: 30,
      label: `Angle ${i * step}°`
    }));
  },

  // ApprovePro: 6 wrap projection views (matching existing view types)
  getApproveProAngles(): CameraAngle[] {
    return [
      { yaw: 25, pitch: 10, distance: 1.25, lightYaw: 60, lightPitch: 35, fov: 28, label: 'Hero View' },
      { yaw: 45, pitch: 8, distance: 1.3, lightYaw: 70, lightPitch: 30, fov: 26, label: 'Front' },
      { yaw: 90, pitch: 8, distance: 1.35, lightYaw: 115, lightPitch: 35, fov: 28, label: 'Driver Side' },
      { yaw: -90, pitch: 8, distance: 1.35, lightYaw: -65, lightPitch: 35, fov: 28, label: 'Passenger Side' },
      { yaw: 200, pitch: 12, distance: 1.3, lightYaw: 235, lightPitch: 35, fov: 28, label: 'Rear' },
      { yaw: 0, pitch: 55, distance: 1.5, lightYaw: 45, lightPitch: 70, fov: 32, label: 'Top' }
    ];
  },

  // ColorPro angles based on material type
  getColorProAngles(materialProfile?: MaterialProfile): CameraAngle[] {
    if (materialProfile?.isFlipFilm) {
      return [
        { yaw: 18, pitch: 8, distance: 1.25, lightYaw: 45, lightPitch: 30, fov: 28, label: 'Flip View 1' },
        { yaw: 45, pitch: 10, distance: 1.25, lightYaw: 75, lightPitch: 35, fov: 28, label: 'Flip View 2' },
        { yaw: 78, pitch: 12, distance: 1.3, lightYaw: 110, lightPitch: 40, fov: 28, label: 'Flip View 3' }
      ];
    }
    if (materialProfile?.isPearl) {
      return [
        { yaw: 22, pitch: 8, distance: 1.25, lightYaw: 50, lightPitch: 32, fov: 28, label: 'Pearl View 1' },
        { yaw: 55, pitch: 10, distance: 1.25, lightYaw: 85, lightPitch: 38, fov: 28, label: 'Pearl View 2' }
      ];
    }
    if (materialProfile?.isMetallic) {
      return [
        { yaw: 22, pitch: 8, distance: 1.25, lightYaw: 50, lightPitch: 32, fov: 28, label: 'Metallic View' }
      ];
    }
    // Default for solid/satin/matte
    return [
      { yaw: 25, pitch: 10, distance: 1.25, lightYaw: 55, lightPitch: 35, fov: 28, label: 'Standard View' }
    ];
  },

  // DesignPanelPro angles
  getDesignPanelProAngles(): CameraAngle[] {
    return [
      { yaw: 30, pitch: 8, distance: 1.2, lightYaw: 60, lightPitch: 30, fov: 26, label: 'Hero' },
      { yaw: 85, pitch: 6, distance: 1.3, lightYaw: 115, lightPitch: 35, fov: 28, label: 'Side' },
      { yaw: 195, pitch: 10, distance: 1.25, lightYaw: 225, lightPitch: 35, fov: 28, label: 'Rear' }
    ];
  },

  // PatternPro angles
  getPatternProAngles(): CameraAngle[] {
    return [
      { yaw: 18, pitch: 10, distance: 1.2, lightYaw: 48, lightPitch: 30, fov: 26, label: 'Pattern Hero' },
      { yaw: 30, pitch: 15, distance: 1.15, lightYaw: 60, lightPitch: 35, fov: 24, label: 'Pattern Detail' }
    ];
  },

  // Get angle by view type string (for backward compatibility)
  getAngleByViewType(viewType: string): CameraAngle {
    const angleMap: Record<string, CameraAngle> = {
      'hero': { yaw: 25, pitch: 10, distance: 1.25, lightYaw: 60, lightPitch: 35, fov: 28, label: 'Hero View' },
      'front': { yaw: 0, pitch: 8, distance: 1.3, lightYaw: 30, lightPitch: 30, fov: 26, label: 'Front' },
      'side': { yaw: 90, pitch: 8, distance: 1.35, lightYaw: 115, lightPitch: 35, fov: 28, label: 'Driver Side' },
      'driver-side': { yaw: 90, pitch: 8, distance: 1.35, lightYaw: 115, lightPitch: 35, fov: 28, label: 'Driver Side' },
      'passenger-side': { yaw: -90, pitch: 8, distance: 1.35, lightYaw: -65, lightPitch: 35, fov: 28, label: 'Passenger Side' },
      'rear': { yaw: 180, pitch: 8, distance: 1.3, lightYaw: 210, lightPitch: 35, fov: 28, label: 'Rear' },
      'top': { yaw: 0, pitch: 55, distance: 1.5, lightYaw: 45, lightPitch: 70, fov: 32, label: 'Top' },
      'hood_detail': { yaw: 15, pitch: 25, distance: 0.8, lightYaw: 45, lightPitch: 40, fov: 35, label: 'Hood Detail' },
      'closeup': { yaw: 35, pitch: 20, distance: 0.7, lightYaw: 65, lightPitch: 35, fov: 40, label: 'Close-up' }
    };
    
    return angleMap[viewType] || angleMap['side'];
  },

  // Get angles for a specific tool and material combination
  getAnglesForTool(tool: string, materialProfile?: MaterialProfile): CameraAngle[] {
    switch (tool) {
      case 'colorpro':
        return this.getColorProAngles(materialProfile);
      case 'designpanelpro':
        return this.getDesignPanelProAngles();
      case 'patternpro':
        return this.getPatternProAngles();
      case 'approvepro':
        return this.getApproveProAngles();
      case '360':
        return this.get360Angles(24);
      default:
        return [this.getAngleByViewType('side')];
    }
  },

  // Build camera positioning string for AI prompts
  buildCameraPositioning(angle: CameraAngle): string {
    return `CAMERA POSITIONING:
- Camera yaw: ${angle.yaw}° (rotation around vehicle)
- Camera pitch: ${angle.pitch}° (elevation angle)
- Camera distance: ${angle.distance}x vehicle length
- Field of view: ${angle.fov}°
- Primary light yaw: ${angle.lightYaw}°
- Primary light pitch: ${angle.lightPitch}°
- Maintain consistent studio lighting across all angles
- Keep entire vehicle in frame with appropriate margins`;
  },

  // Build framing instructions for safe vehicle rendering
  buildFramingInstructions(style: 'close' | 'medium' | 'wide' = 'medium'): string {
    const styles = {
      close: 'Fill 85% of frame with vehicle. Dramatic, aggressive framing. Best for supercars and flip films.',
      medium: 'Fill 70% of frame with vehicle. Balanced framing with no cutoffs. Works for all vehicle types.',
      wide: 'Fill 55% of frame with vehicle. Professional studio framing with generous margins. Best for proofs and PDFs.'
    };
    
    return `FRAMING RULES:
- ${styles[style]}
- Keep entire vehicle inside frame at all times
- No cropping of wheels, bumpers, mirrors, or roof
- Maintain consistent distance across all angles
- No extreme close-ups unless specifically requested`;
  }
};
