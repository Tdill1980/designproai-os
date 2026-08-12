/**
 * 360° Spin View Camera Angles Configuration
 * Defines 12 camera positions at 30° intervals for vehicle spin viewer
 */

export interface SpinViewAngle {
  angle: number;
  label: string;
  description: string;
}

export const SPIN_VIEW_ANGLES: SpinViewAngle[] = [
  { angle: 0, label: "Front", description: "Front view" },
  { angle: 30, label: "Front-Right 30°", description: "Front-right 30° view" },
  { angle: 60, label: "Front-Right 60°", description: "Front-right 60° view" },
  { angle: 90, label: "Right Side", description: "Right side view" },
  { angle: 120, label: "Rear-Right 120°", description: "Rear-right 120° view" },
  { angle: 150, label: "Rear-Right 150°", description: "Rear-right 150° view" },
  { angle: 180, label: "Rear", description: "Rear view" },
  { angle: 210, label: "Rear-Left 210°", description: "Rear-left 210° view" },
  { angle: 240, label: "Rear-Left 240°", description: "Rear-left 240° view" },
  { angle: 270, label: "Left Side", description: "Left side view" },
  { angle: 300, label: "Front-Left 300°", description: "Front-left 300° view" },
  { angle: 330, label: "Front-Left 330°", description: "Front-left 330° view" }
];

export function getAllAngles(): number[] {
  return SPIN_VIEW_ANGLES.map(sv => sv.angle);
}

export function getSpinViewAngle(angle: number): SpinViewAngle | undefined {
  return SPIN_VIEW_ANGLES.find(sv => sv.angle === angle);
}

export function isValidAngle(angle: number): boolean {
  return SPIN_VIEW_ANGLES.some(sv => sv.angle === angle);
}
