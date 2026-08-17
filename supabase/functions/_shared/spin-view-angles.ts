/**
 * 360° Spin View Angles Configuration
 * Defines 12 camera angles at 30° intervals for vehicle spin viewer
 */

export interface SpinViewAngle {
  angle: number;
  label: string;
  description: string;
  cameraPrompt: string;
}

export const SPIN_VIEW_ANGLES: SpinViewAngle[] = [
  {
    angle: 0,
    label: 'front',
    description: 'Front 3/4 view (primary)',
    cameraPrompt: `
      CAMERA POSITIONING - FRONT 3/4 VIEW (0°):
      - Vehicle facing camera at front-right 3/4 angle
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Target: Vehicle center at door handle height
      - Framing: Vehicle fills 70% of frame, full vehicle visible
      - Background: Neutral gray gradient studio environment
      - Lighting: Professional studio lighting from above + ambient fill
      - This is the primary hero view showing front fascia, hood, and right side panel
    `
  },
  {
    angle: 30,
    label: 'front_30',
    description: 'Front-right 30°',
    cameraPrompt: `
      CAMERA POSITIONING - FRONT-RIGHT 30° VIEW:
      - Vehicle rotated 30° clockwise from front view
      - Camera maintains fixed position, vehicle rotates
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: More emphasis on right side panel, hood still visible
      - Background: Consistent neutral studio environment
      - Lighting: Consistent studio setup across all angles
    `
  },
  {
    angle: 60,
    label: 'front_60',
    description: 'Front-right 60°',
    cameraPrompt: `
      CAMERA POSITIONING - FRONT-RIGHT 60° VIEW:
      - Vehicle rotated 60° clockwise from front view
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Transitioning toward side profile, front fender and door visible
      - Background: Consistent neutral studio environment
      - Lighting: Maintain consistent studio lighting
    `
  },
  {
    angle: 90,
    label: 'side_right',
    description: 'Right side profile (90°)',
    cameraPrompt: `
      CAMERA POSITIONING - RIGHT SIDE PROFILE (90°):
      - Vehicle showing pure right side profile
      - Camera perfectly perpendicular (90°) to vehicle centerline
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Full vehicle length visible from front wheel to rear wheel
      - Show full side panels, doors, quarter panels
      - Background: Consistent neutral studio environment
      - Lighting: Side lighting to show panel depth and reflections
    `
  },
  {
    angle: 120,
    label: 'rear_120',
    description: 'Rear-right 120°',
    cameraPrompt: `
      CAMERA POSITIONING - REAR-RIGHT 120° VIEW:
      - Vehicle rotated 120° clockwise from front view
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Rear quarter panel, side, and partial rear visible
      - Background: Consistent neutral studio environment
      - Lighting: Maintain consistent studio lighting
    `
  },
  {
    angle: 150,
    label: 'rear_150',
    description: 'Rear-right 150°',
    cameraPrompt: `
      CAMERA POSITIONING - REAR-RIGHT 150° VIEW:
      - Vehicle rotated 150° clockwise from front view
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Transitioning toward rear 3/4 view, rear fascia becoming prominent
      - Background: Consistent neutral studio environment
      - Lighting: Maintain consistent studio lighting
    `
  },
  {
    angle: 180,
    label: 'rear',
    description: 'Rear 3/4 view',
    cameraPrompt: `
      CAMERA POSITIONING - REAR 3/4 VIEW (180°):
      - Vehicle showing rear-right 3/4 angle
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Full rear fascia, trunk/hatch, rear bumper, right quarter panel
      - Background: Consistent neutral studio environment
      - Lighting: Professional studio lighting highlighting rear wrap coverage
    `
  },
  {
    angle: 210,
    label: 'rear_210',
    description: 'Rear-left 210°',
    cameraPrompt: `
      CAMERA POSITIONING - REAR-LEFT 210° VIEW:
      - Vehicle rotated 210° clockwise from front view (or 150° counter-clockwise)
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Rear left quarter panel and rear fascia visible
      - Background: Consistent neutral studio environment
      - Lighting: Maintain consistent studio lighting
    `
  },
  {
    angle: 240,
    label: 'rear_240',
    description: 'Rear-left 240°',
    cameraPrompt: `
      CAMERA POSITIONING - REAR-LEFT 240° VIEW:
      - Vehicle rotated 240° clockwise from front view (or 120° counter-clockwise)
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Left rear quarter panel and side panel transitioning
      - Background: Consistent neutral studio environment
      - Lighting: Maintain consistent studio lighting
    `
  },
  {
    angle: 270,
    label: 'side_left',
    description: 'Left side profile (270°)',
    cameraPrompt: `
      CAMERA POSITIONING - LEFT SIDE PROFILE (270°):
      - Vehicle showing pure left side profile
      - Camera perfectly perpendicular (90°) to vehicle centerline from left
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Full vehicle length visible from front wheel to rear wheel
      - Show full left side panels, doors, quarter panels
      - Background: Consistent neutral studio environment
      - Lighting: Side lighting to show panel depth and reflections
    `
  },
  {
    angle: 300,
    label: 'front_300',
    description: 'Front-left 300°',
    cameraPrompt: `
      CAMERA POSITIONING - FRONT-LEFT 300° VIEW:
      - Vehicle rotated 300° clockwise from front view (or 60° counter-clockwise)
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Front left fender, hood, and door visible
      - Background: Consistent neutral studio environment
      - Lighting: Maintain consistent studio lighting
    `
  },
  {
    angle: 330,
    label: 'front_330',
    description: 'Front-left 330°',
    cameraPrompt: `
      CAMERA POSITIONING - FRONT-LEFT 330° VIEW:
      - Vehicle rotated 330° clockwise from front view (or 30° counter-clockwise)
      - Camera distance: 12-15 feet from vehicle center
      - Camera height: 5.5 feet (eye level)
      - Framing: Transitioning toward front 3/4 view from left side
      - Background: Consistent neutral studio environment
      - Lighting: Maintain consistent studio lighting
    `
  }
];

/**
 * Get camera angle configuration by angle degree
 */
export function getSpinViewAngle(angle: number): SpinViewAngle | undefined {
  return SPIN_VIEW_ANGLES.find(v => v.angle === angle);
}

/**
 * Get all angle values for iteration
 */
export function getAllAngles(): number[] {
  return SPIN_VIEW_ANGLES.map(v => v.angle);
}

/**
 * Validate if an angle is supported
 */
export function isValidAngle(angle: number): boolean {
  return SPIN_VIEW_ANGLES.some(v => v.angle === angle);
}
