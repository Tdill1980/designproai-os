// Deterministic Fade Specification System
// Converts UI fade style selection into explicit, locked render parameters
// NO AI guessing - all fade parameters are explicitly defined
// EMPHASIS: SEAMLESS AIRBRUSH GRADIENTS - NO HARD LINES

export type FadeStyleKey = "front_back" | "top_bottom" | "diagonal" | "crossfade";

export interface FadeSpec {
  fadeCoordinateSpace: "vehicle";
  fadeAxis: "longitudinal" | "vertical" | "diagonal";
  fadeStart: string;
  fadeEnd: string;
  fadeContinuity: "continuous";
  fadeProfile: "smooth-exponential" | "crossfade-exponential";
  minTransitionWidth: number; // Minimum % of vehicle length for fade transition
  blendCurve: "gaussian" | "exponential";
  midBlackWidth?: number;
  blackFeather?: number;
  prompt: string;
}

export interface StudioLock {
  studioEnvironment: "flat-studio";
  disableCyclorama: boolean;
  disableCurvedBackdrop: boolean;
  floorMaterial: "textured-concrete";
  wallColor: string;
  contactShadows: boolean;
  outputResolution: "4k";
  minWidth: number;
  minHeight: number;
  allowTextOverlay: boolean;
  allowWatermark: boolean;
}

/**
 * Builds deterministic fade specifications from UI selection
 * NO AI interpretation - all parameters are explicit
 * EMPHASIS: Seamless airbrush-style blends with NO hard lines
 */
export function buildFadeSpec(fadeStyle: FadeStyleKey): FadeSpec {
  switch (fadeStyle) {
    case "front_back":
      return {
        fadeCoordinateSpace: "vehicle",
        fadeAxis: "longitudinal",
        fadeStart: "front",
        fadeEnd: "rear",
        fadeContinuity: "continuous",
        fadeProfile: "smooth-exponential",
        minTransitionWidth: 0.25, // Fade lives in the rear ~25% only
        blendCurve: "gaussian",
        prompt: `🔒 FADE: 3/4 FADE — SOLID FRONT 75%, FADE TO BLACK IN REAR QUARTER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
fadeCoordinateSpace: VEHICLE (not screen)
fadeAxis: LONGITUDINAL (front-to-rear)
fadeStart: ~75% of body length back from the front bumper (behind the rear door / start of the rear quarter panel)
fadeEnd: REAR (trunk/tailgate, rear bumper, rear quarter panels)
fadeProfile: SMOOTH-EXPONENTIAL (Gaussian-like falloff)
fadeContinuity: CONTINUOUS — seamless across rear panels only
transitionZone: REAR 25% of vehicle length

🎨 3/4 FADE BLEND REQUIREMENTS:
• 100% FULL COLOR across the FRONT 75% of the vehicle:
   - Hood, front bumper, front fenders, front doors, rear doors, roof, A/B/C pillars
   - This entire region stays SOLID color with NO blending toward black
• The fade STARTS at roughly the C-pillar / start of the rear quarter panel
• SMOOTH airbrush blend through the rear quarter panel into the trunk
• 100% BLACK (#000000) at the rear bumper, tailgate/trunk lid, and rear quarter tail
• The transition occupies ONLY the rear ~25% of vehicle length — NOT the whole body

🚫 CRITICAL FAILURES:
🚫 Color fading across the doors, roof, or front half = INVALID (that is a full ombre, not a 3/4 fade)
🚫 Visible hard line where solid color meets fade = INVALID (must be a seamless airbrush blend)
🚫 Black bleeding forward of the C-pillar = INVALID
🚫 Fade spanning more than the rear quarter = INVALID

✅ SUCCESS: Front three-quarters of the vehicle is 100% solid color. The rear quarter is a smooth airbrush fade from that color into pure black at the rear bumper. Industry-standard "3/4 fade" wrap.`
      };

    case "top_bottom":
      return {
        fadeCoordinateSpace: "vehicle",
        fadeAxis: "vertical",
        fadeStart: "top",
        fadeEnd: "bottom",
        fadeContinuity: "continuous",
        fadeProfile: "smooth-exponential",
        minTransitionWidth: 0.40,
        blendCurve: "gaussian",
        prompt: `🔒 FADE: SEAMLESS AIRBRUSH TOP-TO-BOTTOM OMBRE (NO HARD LINES)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
fadeCoordinateSpace: VEHICLE (not screen)
fadeAxis: VERTICAL (roof-to-rockers)
fadeStart: TOP (roof, upper pillars)
fadeEnd: BOTTOM (rockers, lower body)
fadeProfile: SMOOTH-EXPONENTIAL (Gaussian-like falloff)
fadeContinuity: CONTINUOUS - seamless across all panels
minTransitionWidth: 40% of vehicle height

🎨 SEAMLESS BLEND: Color at roof MISTS imperceptibly to black at rockers.
The transition is SO SMOOTH you cannot see where colors meet.
🚫 NO visible line, edge, or boundary - pure airbrush blend.`
      };

    case "diagonal":
      return {
        fadeCoordinateSpace: "vehicle",
        fadeAxis: "diagonal",
        fadeStart: "front_top",
        fadeEnd: "rear_bottom",
        fadeContinuity: "continuous",
        fadeProfile: "smooth-exponential",
        minTransitionWidth: 0.40,
        blendCurve: "gaussian",
        prompt: `🔒 FADE: SEAMLESS AIRBRUSH DIAGONAL OMBRE (NO HARD LINES)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
fadeCoordinateSpace: VEHICLE (not screen)
fadeAxis: DIAGONAL (combines longitudinal + vertical)
fadeStart: FRONT-TOP (hood/roof intersection)
fadeEnd: REAR-BOTTOM (lower rear panels)
fadeProfile: SMOOTH-EXPONENTIAL (Gaussian-like falloff)
fadeContinuity: CONTINUOUS - seamless across all panels

🎨 SEAMLESS BLEND: 45-degree diagonal sweep with IMPERCEPTIBLE transition.
Colors MIST into each other - no visible boundary or edge.
🚫 NO hard diagonal line - pure airbrush gradient sweep.`
      };

    case "crossfade":
      return {
        fadeCoordinateSpace: "vehicle",
        fadeAxis: "longitudinal",
        fadeStart: "front",
        fadeEnd: "rear",
        fadeContinuity: "continuous",
        fadeProfile: "crossfade-exponential",
        minTransitionWidth: 0.25, // Each transition zone
        blendCurve: "exponential",
        midBlackWidth: 0.28,
        blackFeather: 0.18,
        prompt: `🔒 FADE: CROSSFADE™ SEAMLESS BI-DIRECTIONAL OMBRE (NO HARD LINES)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
fadeCoordinateSpace: VEHICLE (not screen)
fadeAxis: LONGITUDINAL (front-to-rear)
fadeProfile: CROSSFADE-EXPONENTIAL (NOT linear)
blendCurve: EXPONENTIAL with Gaussian feathering
midBlackWidth: 0.28
blackFeather: 0.18

🎨 SEAMLESS BLEND MODEL:
• FRONT: Full color 100% - MISTS toward center
• FRONT-MID: Seamless exponential blend toward black (no visible edge)
• CENTER: Deep black core - colors have MISTED to pure black
• MID-REAR: Seamless exponential blend from black toward color
• REAR: Full color 100% - MISTED from center black

🚫 HARD LINE DETECTION (CRITICAL FAILURE):
🚫 NO visible line where color meets black - anywhere
🚫 The transitions must be IMPERCEPTIBLE airbrush blends
🚫 If you can see "edges" of the black zone = INVALID

✅ SUCCESS: Full color at BOTH ends, seamless black center - like airbrush art`
      };
  }
}

/**
 * Creates locked studio environment parameters
 * Prevents drift back to cyclorama/white backgrounds
 */
export function buildStudioLock(): StudioLock {
  return {
    studioEnvironment: "flat-studio",
    disableCyclorama: true,
    disableCurvedBackdrop: true,
    floorMaterial: "textured-concrete",
    wallColor: "#E6E6E6",
    contactShadows: true,
    outputResolution: "4k",
    minWidth: 4096,
    minHeight: 2304,
    allowTextOverlay: false,
    allowWatermark: false
  };
}

/**
 * Formats studio lock as prompt constraint block
 */
export function formatStudioLockPrompt(lock: StudioLock): string {
  return `
🔒 STUDIO ENVIRONMENT - LOCKED (NON-NEGOTIABLE)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• studioEnvironment: ${lock.studioEnvironment}
• Floor: Dark textured concrete (#2a2a2a), FLAT plane, NO curves
• Walls: Light gray (${lock.wallColor}), FLAT, NO cyclorama dome
• disableCyclorama: ${lock.disableCyclorama} - NO curved floor/wall transitions
• disableCurvedBackdrop: ${lock.disableCurvedBackdrop} - NO rounded edges anywhere
• Output: 4K minimum (${lock.minWidth}x${lock.minHeight})
• NO TEXT/WATERMARKS in image (client overlay handles branding)

⚠️ FLAT CONTINUOUS FLOOR ONLY - no circular pads, no cyclorama cutouts
`;
}

/**
 * Formats fade spec as prompt constraint block
 * EMPHASIS: Seamless airbrush blends with NO hard lines
 */
export function formatFadeSpecPrompt(spec: FadeSpec): string {
  return `
🔒 FADE DIRECTION - SEAMLESS AIRBRUSH OMBRE (NO HARD LINES)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• fadeCoordinateSpace: ${spec.fadeCoordinateSpace}
• fadeAxis: ${spec.fadeAxis}
• fadeStart: ${spec.fadeStart}
• fadeEnd: ${spec.fadeEnd}
• fadeProfile: ${spec.fadeProfile} (Gaussian-like smooth falloff)
• fadeContinuity: ${spec.fadeContinuity}
• blendCurve: ${spec.blendCurve} - colors MIST into each other
• minTransitionWidth: ${spec.minTransitionWidth * 100}% of vehicle - EXTENDED soft blend
${spec.midBlackWidth ? `• midBlackWidth: ${spec.midBlackWidth}` : ''}
${spec.blackFeather ? `• blackFeather: ${spec.blackFeather}` : ''}

🚫 CRITICAL: NO HARD LINES, NO VISIBLE EDGES, NO BOUNDARIES
The transition must be IMPERCEPTIBLE - like airbrush spray paint.

${spec.prompt}
`;
}
