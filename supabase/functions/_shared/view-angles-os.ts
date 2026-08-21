/**
 * ═══════════════════════════════════════════════════════════════
 *  TRADE SECRET — CONFIDENTIAL & PROPRIETARY
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *
 *  Proprietary canonical camera-angle / production-output config —
 *  a TRADE SECRET of RestylePro / LoopMighty Software Development LLC, part of the
 *  DesignIQ™ / GENIE™ / LiftIQ Engine™ architecture (patent-pending
 *  system & methods).
 *
 *  Do NOT copy, publish, distribute, disclose, or reproduce — in
 *  whole or in part — without express written permission. The prompt
 *  text itself must NOT appear in any published patent filing.
 *  See /NOTICE and docs/TRADEMARKS.md. Not legal advice.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * VIEW ANGLES OS v4.1 — Physics-Based Production Angle Suite
 * ============================================================
 * The single source of truth for camera angles, aspect ratios, and resolution tiers.
 * Every render call, proof sheet, production output, and GENIE Panelizer imports from here.
 *
 * LOCKED: March 9, 2026 — Post-Gemini Technical Cross-Reference
 * DO NOT MODIFY without explicit Trish approval + claude.ai diff review.
 *
 * CRITICAL: These renders feed the GENIE Universal Panelizer (EXTRACT step).
 * Vehicle + design MUST fill the frame — empty floor/ceiling/wall = wasted pixels
 * that degrade panelizer extraction quality. Frame-fill percentages are MANDATORY.
 */

/**
 * The 7 canonical views in LOCKED PRODUCTION ORDER.
 *
 * PRODUCTION ORDER:
 * 1. Driver Side — primary print panel, customer approves FIRST, GENIE primary extract source
 * 2. Passenger Side — INSTANT_MIRROR of driver side (scaleX(-1), NO AI call)
 * 3. Hood — elevated showing hood design, GENIE hood panel extract source
 * 4. Front — straight-on front view, GENIE front bumper extract source
 * 5. Rear — straight-on rear view, GENIE rear bumper extract source
 * 6. Close-Up — 5-inch macro, Material Physics encoder, quality validation only
 * 7. Roof — top-down overhead view, GENIE roof panel extract source
 */
export const VIEW_ORDER = [
  'side',
  'passenger-side',
  'hood_detail',
  'front',
  'rear',
  'close-up',
  'roof',
] as const;

export type ViewType = typeof VIEW_ORDER[number];

/**
 * Human-readable labels for each view.
 */
export const VIEW_LABELS: Record<string, string> = {
  'side': 'Driver Side',
  'driver-side': 'Driver Side',
  'passenger-side': 'Passenger Side',
  'hood_detail': 'Hood',
  'rear': 'Rear',
  'close-up': 'Close-Up',
  'roof': 'Roof',
  'front': 'Front',
};

/**
 * OS LOCKED ANGLES — Physics-Based Camera Constraints
 * ====================================================
 * Each angle uses deterministic distance/height/tilt values.
 * Frame-fill percentages are MANDATORY for GENIE Panelizer compatibility.
 *
 * FRAME FILL RULE: The wrapped vehicle body panels must occupy the specified
 * minimum percentage of the output image. Empty studio space (floor, ceiling,
 * walls) is wasted data that degrades GENIE panel extraction quality.
 */
export const CAMERA_ANGLES: Record<string, string> = {
  side: `
Camera: PERFECTLY STRAIGHT side-on elevation. Camera is exactly 90 degrees perpendicular to the vehicle body — NOT a 3/4 angle, NOT angled forward or backward. Zero tilt, zero rotation. 15-foot distance, level with door handles.
Framing: Full vehicle bumper-to-bumper. The camera faces the flat side of the vehicle like a blueprint elevation drawing.
FRAME FILL: Vehicle body fills minimum 85% of frame width and 65% of frame height.
Minimize visible floor and ceiling. The WRAP DESIGN is the subject, not the studio.
Vehicle faces left in frame. BOTH driver-side wheels visible. The front and rear of the vehicle are equidistant from camera — no foreshortening.
`,

  'driver-side': `
Camera: PERFECTLY STRAIGHT side-on elevation. Camera is exactly 90 degrees perpendicular to the vehicle body — NOT a 3/4 angle, NOT angled forward or backward. Zero tilt, zero rotation. 15-foot distance, level with door handles.
Framing: Full vehicle bumper-to-bumper. The camera faces the flat side of the vehicle like a blueprint elevation drawing.
FRAME FILL: Vehicle body fills minimum 85% of frame width and 65% of frame height.
Minimize visible floor and ceiling. The WRAP DESIGN is the subject, not the studio.
Vehicle faces left in frame. BOTH driver-side wheels visible. The front and rear of the vehicle are equidistant from camera — no foreshortening.
`,

  hood_detail: `
Camera: Directly overhead, centered above the hood, looking straight down at 90 degrees.
Camera height: 8-10 feet above the vehicle. Zero perspective distortion — flat orthographic view.
FRAME FILL: The HOOD SURFACE must fill minimum 80% of the image area.
The hood panel and its wrap design/artwork are the primary subject.
Front bumper edge at bottom of frame, windshield base at top of frame.
This is a FLAT TOP-DOWN shot — not a front view, not an angled glamour shot.
The camera is DIRECTLY ABOVE the hood. Zero tilt. Perfectly flat.
`,

  'passenger-side': `
Camera: PERFECTLY STRAIGHT side-on elevation. Camera is exactly 90 degrees perpendicular to the vehicle body — NOT a 3/4 angle, NOT angled forward or backward. Zero tilt, zero rotation. 15-foot distance, level with door handles.
Framing: Full vehicle bumper-to-bumper. The camera faces the flat side of the vehicle like a blueprint elevation drawing.
Vehicle faces RIGHT in frame (nose pointing right). Show the PASSENGER side of the vehicle — the opposite side from driver.
FRAME FILL: Vehicle body fills minimum 85% of frame width and 65% of frame height.
Minimize visible floor and ceiling. The WRAP DESIGN is the subject, not the studio.
BOTH passenger-side wheels visible. The front and rear of the vehicle are equidistant from camera — no foreshortening.
TEXT DIRECTION: All text, lettering, phone numbers, and URLs on the wrap MUST read correctly left-to-right. Text is NEVER mirrored or backwards.
`,

  rear: `
Camera: Straight-on rear view. 10-foot distance. Bumper height.
Focus: Symmetrical tailgate/hatch, taillights, rear bumper, rear window.
NOT a 3/4 angle. Perfectly straight on. Symmetrical left-right.
FRAME FILL: Vehicle rear fills minimum 70% of frame width and 75% of frame height.
Minimize visible floor. The rear wrap coverage is the subject.
`,

  'close-up': `
Camera: 18 inches from the vehicle body surface, angled 20-30 degrees to show a wide section of the wrap design across the door or quarter panel. 85mm lens, f/4, deep enough focus to keep the full design section sharp.
Framing: Close-up of the wrap design on a body panel — show enough of the design to see the pattern, graphic flow, color transitions, and detail work. Include 2-3 square feet of wrap surface. A door handle or body line for scale is OK.
FRAME FILL: Wrap design fills 90%+ of the frame. The design itself is the subject — NOT blurred texture. Show the actual artwork, graphic elements, and color depth at a distance where the design reads clearly.
This is a DESIGN DETAIL shot — like a portfolio close-up showing craftsmanship. Vinyl texture grain and laminate sheen should be visible but the design artwork stays sharp and readable across the frame.
`,

  'hero-3d': `
Camera: Three-quarter hero view from the front driver corner, 25-30 degrees off the vehicle's centreline and 20 degrees off the side, at roughly chest height. 35mm lens at 20-foot distance so the whole vehicle stays in frame without wide-angle distortion.
Framing: The COMPLETE vehicle, bumper to bumper and roof to tyre contact patch. Both the driver side and the front fascia are visible in one image, which is what makes this the hero.
FRAME FILL: Vehicle fills minimum 80% of frame width and 70% of frame height. This is a whole-vehicle presentation shot, NOT a panel detail and NOT a close-up of the wrap surface.
Vehicle faces left-forward in frame. All four wheels on the ground, front wheels turned slightly toward camera.
Lighting: Even studio key with a soft gradient background. The wrap design across the side and front reads clearly and continuously around the body corner.
TEXT DIRECTION: All text, lettering, phone numbers and URLs on the wrap MUST read correctly left-to-right. Text is NEVER mirrored or backwards.
`,

  roof: `
Directly overhead top-down view, camera centered above the vehicle looking straight down.
Show the full roof panel, A-pillars to trunk. The roof surface fills 90% of the frame.
FRAME FILL: Roof panel fills minimum 90% of frame area. No visible floor or walls.
The wrap design on the roof is the primary subject. Camera is DIRECTLY ABOVE looking DOWN.
`,

  front: `
Camera: Straight-on front view. 10-foot distance. Bumper/grille height.
Focus: Symmetrical grille, headlights, hood edge, front bumper, windshield.
NOT a 3/4 angle. Perfectly straight on. Symmetrical left-right.
FRAME FILL: Vehicle front fills minimum 70% of frame width and 75% of frame height.
Minimize visible floor. The front wrap coverage is the subject.
`,
};

/**
 * Per-View Aspect Ratios — Matched to composition needs
 * =====================================================
 * Gemini 3 Pro Image supports: 1:1, 3:2, 2:3, 3:4, 4:3, 4:5, 5:4, 9:16, 16:9, 21:9
 */
export const VIEW_ASPECT_RATIOS: Record<string, string> = {
  'side':           '16:9',   // Full vehicle profile
  'driver-side':    '16:9',   // Same as side
  'passenger-side': '16:9',   // Mirror of driver side
  'hood_detail':    '16:9',   // Consistent 360 presentation
  'front':          '16:9',   // Consistent 360 presentation
  'rear':           '16:9',   // Consistent 360 presentation
  'close-up':       '16:9',   // Match standard views
  'hero-3d':        '16:9',   // Whole-vehicle hero presentation
  'roof':           '16:9',   // Consistent 360 presentation
};

/**
 * Per-View Resolution Tiers — Token cost optimization
 * ====================================================
 * 4K = 2,520 tokens | 2K = ~1,500 tokens | 1K = 1,120 tokens
 *
 * GENIE NOTE: Side views feed the Panelizer EXTRACT step.
 * Higher resolution = better extraction quality.
 * Close-up is quality validation only (not extracted by GENIE).
 */
export const VIEW_RESOLUTION: Record<string, string> = {
  'side':           '4K',     // GENIE primary extract source — needs max detail
  'driver-side':    '4K',     // Same as side
  'passenger-side': '4K',     // Mirror output matches driver resolution
  'hood_detail':    '4K',     // Restored to 4K per Trish (was 2K for edge-function memory limit — watch for crashes)
  'front':          '4K',     // GENIE front bumper extract
  'rear':           '4K',     // GENIE rear bumper extract
  'close-up':       '4K',     // Restored to 4K per Trish (was 2K for edge-function memory limit — watch for crashes)
  'hero-3d':        '4K',     // Whole-vehicle hero presentation
  'roof':           '4K',     // Roof panel extract
};

/**
 * Check if a view should use INSTANT_MIRROR instead of AI generation.
 * DISABLED: Passenger side now gets its own AI render.
 * Mirroring caused backwards text on wraps with lettering/URLs.
 */
export function isInstantMirrorView(_viewType: string): boolean {
  return false;
}

/**
 * Get the source view for an INSTANT_MIRROR view.
 * DISABLED: All views now get their own AI render.
 */
export function getMirrorSource(_viewType: string): string | null {
  return null;
}

/**
 * Get the camera angle description for a given viewType.
 * Falls back to side shot for unknown view types.
 */
export function getCameraAngle(viewType: string): string {
  return CAMERA_ANGLES[viewType] || CAMERA_ANGLES['side'];
}

/**
 * Get the aspect ratio for a given viewType.
 * Falls back to 16:9 for unknown view types.
 */
export function getAspectRatio(viewType: string): string {
  return VIEW_ASPECT_RATIOS[viewType] || '16:9';
}

/**
 * Get the resolution tier for a given viewType.
 * Falls back to 4K for unknown view types.
 */
export function getResolution(viewType: string): string {
  return VIEW_RESOLUTION[viewType] || '4K';
}

/**
 * WRAP COVERAGE RULES — What gets wrapped and what stays factory.
 * This applies to EVERY render that puts a design on a vehicle.
 */
export const WRAP_COVERAGE_RULES = `
WRAP COVERAGE — MANDATORY:
The vinyl wrap covers ONLY painted body panels. The following areas must remain UNWRAPPED and show their original factory appearance:
- Grille / front grille mesh — NOT wrapped, factory appearance
- Manufacturer emblems and badges (Ford, Chevy, RAM, etc.) — NOT wrapped, visible
- Windshield — NOT wrapped, clear glass
- Driver and passenger side windows — NOT wrapped, clear glass
- Rear window — NOT wrapped, clear glass
- Headlights and taillights — NOT wrapped, factory appearance
- Wheels, tires, wheel wells — NOT wrapped
- Door handles — NOT wrapped
- Side mirrors — NOT wrapped
- Chrome trim, rain gutters, antenna — NOT wrapped
TRUCK BED: on a pickup, the wrap covers the outer painted panels — cab, bed sides, and tailgate exterior; the open bed interior stays bare factory bedliner.
This is how real vehicle wraps work. Vinyl goes on painted body panels only.
`;
