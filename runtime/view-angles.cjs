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
 * Passenger keeps its own immutable slot, but its pixels come from the
 * canonical producePassengerView contract: deterministic driver flip, the
 * existing text-direction repair, then the 64x32 orientation guard. It is not
 * sent through the ordinary angle generator. The passenger camera text remains
 * frozen because the repair/output contract still requires right-facing,
 * forward-reading presentation.
 */

const VIEW_ANGLE_CONTRACT_VERSION = "designpro.view-angles-os.port-ab0f0638.v1";

/**
 * The seven canonical views in the locked production order from
 * `_shared/view-angles-os.ts`. Close-Up is the sixth quality-validation proof;
 * a hero view is not one of Calls 1-7.
 *
 * The legacy `hero-3d` angle definition remains below only so older persisted
 * records can still be described. It must never enter VIEW_ORDER.
 */
const VIEW_ORDER = Object.freeze(["side", "passenger-side", "hood_detail", "front", "rear", "close-up", "roof"]);

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
  "passenger-side": "16:9",   // Own passenger camera; presentation only
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
  "passenger-side": "4K",     // Own passenger render at presentation resolution
  "hood_detail":    "4K",     // Restored to 4K per Trish (was 2K for edge-function memory limit — watch for crashes)
  "front":          "4K",     // GENIE front bumper extract
  "rear":           "4K",     // GENIE rear bumper extract
  "close-up":       "4K",     // Restored to 4K per Trish (was 2K for edge-function memory limit — watch for crashes)
  "hero-3d":        "4K",     // Whole-vehicle hero — needs max detail
  "roof":           "4K",     // Roof panel extract
});

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VIEW-ANGLES-OS IS THE ONLY CAMERA AUTHORITY. (Trish 2026-08-27)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, verbatim: "The surface-specific camera contract must be the
 * final/highest-priority camera instruction and must override generic Studio
 * OS / Canon / automotive-photography composition language... If generic DPAG,
 * Studio OS and view-angles-os are each independently specifying
 * composition/camera, collapse camera authority to view-angles-os."
 *
 * They were. A single A.T.L.A.S. proof request carried FOUR independent voices
 * on camera geometry:
 *
 *   1. `cameraAngle(viewType)` -- this file, the legitimate authority. FIRST.
 *   2. `VIEW_REINFORCEMENT` -- authored in designpanel-server-provider.cjs,
 *      restating the angle in its own words. MIDDLE.
 *   3. the pickup cab-roof override -- also authored in the provider. MIDDLE.
 *   4. STUDIO_ENVIRONMENT's `FRAMING:` block, plus its opening line "You are a
 *      professional automotive photographer shooting for a luxury car brand
 *      campaign", and "Canon EOS R5, 4K capture, studio editorial quality".
 *      LAST.
 *
 * Voice 4 is generic whole-vehicle glamour composition and it held the last
 * word, which is the strongest position in the prompt. "read this FIRST" on
 * voice 1 is a hint, not precedence. That is the mechanism behind the
 * intermittent ROOF and HOOD failures: the contracts for those two views are
 * ALREADY correct here -- roof is "camera centered above the vehicle looking
 * straight down", hood is "straight down at 90 degrees... Zero tilt. Perfectly
 * flat" -- so nothing about them needed rewriting. They were being outvoted.
 *
 * 2 and 3 move here so there is exactly ONE camera voice, and the provider
 * emits `cameraAuthority()` once, LAST, as an explicit override. STUDIO OS is
 * untouched (RULE 0.29: the runtime consumes it and never restates it); it
 * keeps lighting, floor, walls, materials and lens realism, and is explicitly
 * denied camera geometry.
 *
 * THE VALIDATOR IS NOT WEAKENED. `atlas-proof-qc.cjs`'s cameraContract and
 * framingContract grade the same requirements they always did.
 */
const VIEW_CAMERA_REINFORCEMENT = Object.freeze({
  // Keep the DesignPanel detail treatment, but never contradict the locked
  // 18-inch camera above with either historical 12-inch or 3-5-foot duplicate
  // framing.
  "close-up": "This is a CLOSE-UP design-detail photograph at the locked camera distance above. Show the vinyl texture grain, laminate sheen, ink depth, printed pattern, color transitions or artwork conforming to the body curve. A body line, panel edge or door handle may provide scale. The wrap design fills 90%+ of frame. This is NOT a full vehicle shot and NOT a three-quarter vehicle view.",
  "passenger-side": "This is the PASSENGER SIDE of the vehicle — the opposite side from the driver. The vehicle faces RIGHT in frame (nose pointing right). All text and lettering reads correctly left-to-right, NEVER mirrored. Show the passenger-side wheels.",
  roof: "This is a TOP-DOWN ROOF view — the camera is DIRECTLY ABOVE the vehicle pointing straight down at 90 degrees, its optical axis perpendicular to the roof panel. ZERO front, rear or side perspective. Orthographic flat top-down, NOT tilted and NOT angled. The roof is the dominant visible surface. Frame only the roof/cab-top panel between windshield and rear glass. Crop tightly so that panel fills the frame. Exclude hood, front end, cargo bed, tailgate, wheels, mirrors, vehicle sides, floor and walls.",
  hood_detail: "This is a TOP-DOWN HOOD view — the camera is DIRECTLY ABOVE the hood pointing straight down at 90 degrees. ZERO perspective tilt. Orthographic flat overhead, NOT a 3/4 glamour shot. Frame only the hood between windshield base and front bumper edge, with the hood filling at least 80% of the frame.",
  front: "This is a STRAIGHT-ON FRONT view — camera is DIRECTLY in front at grille/bumper height, perpendicular and perfectly symmetrical. NOT a 3/4 angle, rotated or tilted view. Frame grille, both headlights, hood edge, front bumper and windshield head-on, with the front filling the frame.",
  rear: "This is a STRAIGHT-ON REAR view — camera is DIRECTLY behind at tailgate/bumper height, perpendicular and perfectly symmetrical. NOT a 3/4 angle, rotated or tilted view. Frame rear glass/tailgate, both tail lights and rear bumper head-on, with the rear filling the frame.",
});

/**
 * A pickup has no "trunk", so the generalized roof phrase "A-pillars to trunk"
 * reads as the whole vehicle top including the cargo bed. This qualifies it.
 * It is camera framing, so it lives with the camera, not in the producer.
 */
const PICKUP_ROOF_QUALIFICATION = "PICKUP CAB-ROOF QUALIFICATION: for this pickup, CAB ROOF ONLY between windshield and rear cab glass — this qualifies the generalized phrase \u2018A-pillars to trunk\u2019 above. The hood, complete front end, cargo bed/box, bedliner, tailgate, wheels, mirrors, body sides, floor and walls must be outside the frame.";

/**
 * THE ONE CAMERA INSTRUCTION for a proof request, assembled from this file
 * alone. The producer emits this exactly once, as the final block of the
 * prompt. Its own header states the precedence, because a model resolves a
 * conflict by position and by explicit instruction, not by our intentions.
 */
function cameraAuthority(viewType, { pickup = false } = {}) {
  const segments = [
    "CAMERA GEOMETRY \u2014 FINAL AUTHORITY. THIS IS THE LAST WORD ON THE SHOT.",
    "This block alone decides camera position, angle, tilt, perspective and frame fill, and it OVERRIDES every earlier line in this prompt. The studio/photography section above governs lighting, floor, walls, background, material appearance and lens realism ONLY \u2014 it does not choose, soften or reinterpret camera geometry, and its generic composition language (\u201cprofessional automotive photographer\u201d, \u201cluxury car brand campaign\u201d, \u201cclean, uncluttered composition\u201d, \u201cstudio editorial quality\u201d) describes a look, never an angle. If anything above implies a different camera, IGNORE IT and shoot exactly this:",
    cameraAngle(viewType).trim(),
    VIEW_CAMERA_REINFORCEMENT[viewType] || "",
    pickup && viewType === "roof" ? PICKUP_ROOF_QUALIFICATION : "",
    "Shoot the frame described in this block and no other.",
  ];
  return segments.filter((segment) => typeof segment === "string" && segment.trim()).join("\n\n");
}

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
 * Every view owns a slot. Passenger alone uses the canonical deterministic
 * producer instead of asking the ordinary renderer to invent another side.
 */
function requiresOwnGeneration(viewType) {
  if (!VIEW_ORDER.includes(viewType)) throw new Error(`unknown view ${viewType}`);
  return viewType !== "passenger-side";
}

/**
 * The passenger presentation contract must keep its text-direction guard.
 */
function assertTextDirectionGuard(viewType) {
  const angle = cameraAngle(viewType);
  if (viewType === "passenger-side" && !/NEVER mirrored or backwards/i.test(angle)) {
    throw new Error("passenger-side angle lost its text-direction guard");
  }
  return true;
}

module.exports = {
  CAMERA_ANGLES, VIEW_ASPECT_RATIOS, VIEW_LABELS, VIEW_ORDER, VIEW_RESOLUTION,
  VIEW_ANGLE_CONTRACT_VERSION,
  VIEW_CAMERA_REINFORCEMENT, PICKUP_ROOF_QUALIFICATION,
  aspectRatio, assertTextDirectionGuard, cameraAngle, cameraAuthority,
  requiresOwnGeneration, resolutionTier, viewLabel, viewOrder,
};
