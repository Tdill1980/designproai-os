"use strict";

/**
 * Calls 1-7 camera and frame contract, ported verbatim from
 * restylepro-os @ ab0f0638, blob 03d6282d71faeec37d0fd304f3bc234d9a3cf0a4.
 *
 * TRADE SECRET - CONFIDENTIAL. (c) LoopMighty Software Development LLC.
 * Angles, aspect ratios and resolution tiers are frozen: they are the
 * behavioural baseline every render, proof and GENIE extraction depends on.
 * Do not tune them here.
 *
 * One deliberate divergence from the source, recorded rather than inherited:
 * INSTANT_MIRROR is absent. The source disabled it because mirroring produced
 * backwards text on wraps carrying lettering and URLs, but left dead branches
 * and two live callers behind. Passenger side is its own generation here, and
 * its angle carries the explicit text-direction guard.
 */

/**
 * The seventh slot is a true three-quarter hero view, not the close-up.
 *
 * The revision contract downstream requires the role `hero3d`
 * (gemini-flat-surface.cjs: VIEW_KEYS = [...SURFACE_KEYS, "hero3d"]), and
 * `closeup` is not a role it accepts at all. Aliasing the close-up into that
 * slot would put a two-square-foot panel detail where every downstream proof
 * expects a whole vehicle — the same class of defect as the mirrored passenger
 * side: a plausible image in the wrong semantic slot, which no hash check
 * catches. The close-up angle is retained below for provenance and may be
 * generated on request, but it is not one of the seven.
 */
const VIEW_ORDER = Object.freeze(["side", "passenger-side", "hood_detail", "front", "rear", "hero-3d", "roof"]);

const VIEW_LABELS = Object.freeze({
  "side": "Driver Side",
  "driver-side": "Driver Side",
  "passenger-side": "Passenger Side",
  "hood_detail": "Hood",
  "rear": "Rear",
  "close-up": "Close-Up",
  "hero-3d": "3D Hero View",
  "roof": "Roof",
  "front": "Front",
});

const CAMERA_ANGLES = Object.freeze({
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

  roof: `
Directly overhead top-down view, camera centered above the vehicle looking straight down.
Show the full roof panel, A-pillars to trunk. The roof surface fills 90% of the frame.
FRAME FILL: Roof panel fills minimum 90% of frame area. No visible floor or walls.
The wrap design on the roof is the primary subject. Camera is DIRECTLY ABOVE looking DOWN.
`,

  'hero-3d': `
Camera: Three-quarter hero view from the front driver corner, 25-30 degrees off the vehicle's centreline and 20 degrees off the side, at roughly chest height. 35mm lens at 20-foot distance so the whole vehicle stays in frame without wide-angle distortion.
Framing: The COMPLETE vehicle, bumper to bumper and roof to tyre contact patch. Both the driver side and the front fascia are visible in one image, which is what makes this the hero.
FRAME FILL: Vehicle fills minimum 80% of frame width and 70% of frame height. This is a whole-vehicle presentation shot, NOT a panel detail and NOT a close-up of the wrap surface.
Vehicle faces left-forward in frame. All four wheels on the ground, front wheels turned slightly toward camera.
Lighting: Even studio key with a soft gradient background. The wrap design across the side and front reads clearly and continuously around the body corner.
TEXT DIRECTION: All text, lettering, phone numbers and URLs on the wrap MUST read correctly left-to-right. Text is NEVER mirrored or backwards.
`,

  front: `
Camera: Straight-on front view. 10-foot distance. Bumper/grille height.
Focus: Symmetrical grille, headlights, hood edge, front bumper, windshield.
NOT a 3/4 angle. Perfectly straight on. Symmetrical left-right.
FRAME FILL: Vehicle front fills minimum 70% of frame width and 75% of frame height.
Minimize visible floor. The front wrap coverage is the subject.
`,});

const VIEW_ASPECT_RATIOS = Object.freeze({
  "side":           "16:9",   // Full vehicle profile
  "driver-side":    "16:9",   // Same as side
  "passenger-side": "16:9",   // Mirror of driver side
  "hood_detail":    "16:9",   // Consistent 360 presentation
  "front":          "16:9",   // Consistent 360 presentation
  "rear":           "16:9",   // Consistent 360 presentation
  "close-up":       "16:9",   // Match standard views
  "hero-3d":        "16:9",   // Whole-vehicle hero presentation
  "roof":           "16:9",   // Consistent 360 presentation
});

const VIEW_RESOLUTION = Object.freeze({
  "side":           "4K",     // GENIE primary extract source — needs max detail
  "driver-side":    "4K",     // Same as side
  "passenger-side": "4K",     // Mirror output matches driver resolution
  "hood_detail":    "4K",     // Restored to 4K per Trish (was 2K for edge-function memory limit — watch for crashes)
  "front":          "4K",     // GENIE front bumper extract
  "rear":           "4K",     // GENIE rear bumper extract
  "close-up":       "4K",     // Restored to 4K per Trish (was 2K for edge-function memory limit — watch for crashes)
  "hero-3d":        "4K",     // Whole-vehicle hero — needs max detail
  "roof":           "4K",     // Roof panel extract
});

/** Seven immutable source slots, in the locked production order. */
function viewOrder() { return [...VIEW_ORDER]; }

function cameraAngle(viewType) {
  return CAMERA_ANGLES[viewType] || CAMERA_ANGLES.side;
}
function aspectRatio(viewType) {
  return VIEW_ASPECT_RATIOS[viewType] || "16:9";
}
function resolutionTier(viewType) {
  return VIEW_RESOLUTION[viewType] || "4K";
}
function viewLabel(viewType) {
  return VIEW_LABELS[viewType] || viewType;
}

/**
 * Every view is generated. There is no mirror path, and there must not be one:
 * a horizontal flip reverses logos, phone numbers and URLs, and asserts a
 * left-right symmetry that vehicles do not have.
 */
function requiresOwnGeneration(viewType) {
  if (!VIEW_ORDER.includes(viewType)) throw new Error(`unknown view ${viewType}`);
  return true;
}

/**
 * The passenger angle must keep its text-direction guard. A prompt that lost it
 * would reintroduce the backwards-text defect the source turned mirroring off
 * to escape.
 */
function assertTextDirectionGuard(viewType) {
  const angle = cameraAngle(viewType);
  if (viewType === "passenger-side" && !/NEVER mirrored or backwards/i.test(angle)) {
    throw new Error("passenger-side angle lost its text-direction guard");
  }
  return true;
}

/**
 * Restored from the source blob, which carries it as the last export.
 *
 * The original port dropped it, and nothing noticed because nothing read it:
 * the worker's prompt had no coverage rules at all, so the model decided for
 * itself whether vinyl went over the grille, the glass, the lights and the
 * wheels. That is the difference between a render of a wrapped vehicle and a
 * render of a painted one, and it is also what the six-surface extraction
 * later assumes about where artwork stops.
 */
const WRAP_COVERAGE_RULES = `
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

module.exports = {
  CAMERA_ANGLES, VIEW_ASPECT_RATIOS, VIEW_LABELS, VIEW_ORDER, VIEW_RESOLUTION,
  WRAP_COVERAGE_RULES,
  aspectRatio, assertTextDirectionGuard, cameraAngle, requiresOwnGeneration,
  resolutionTier, viewLabel, viewOrder,
};
