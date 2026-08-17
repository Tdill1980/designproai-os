/**
 * non-auto-view-angles.ts — Camera angle definitions for non-car vehicle classes.
 *
 * The locked view-angles-os.ts is tuned for cars (hood, roof, 3/4 front, etc.)
 * and should not be modified. This file defines new camera angle text per
 * non-automotive class. Each render-<type> edge function imports only its
 * own class's angle map so there's no cross-contamination.
 *
 * IMPORTANT: This file is NOT locked. It is separate from view-angles-os.ts
 * by design — non-car vehicles need different viewpoints, and mixing would
 * pollute the golden render pipeline.
 */

export type NonAutoViewKey =
  | "side"
  | "three_quarter_front"
  | "three_quarter_rear"
  | "front"
  | "rear"
  | "overhead"
  | "detail";

// ---------------------------------------------------------------------------
// MOTORCYCLE — 4 useful views. No "hood" or "roof" concept.
// ---------------------------------------------------------------------------

export const MOTORCYCLE_VIEWS: Record<string, string> = {
  side: `CAMERA — SIDE PROFILE (LEFT SIDE):
- Camera positioned at tank height, perfectly perpendicular to the motorcycle
- Shoot the entire left side of the motorcycle as the hero view
- Front wheel on viewer's left, rear wheel on viewer's right
- Frame the full bike: front wheel, fairing, tank, seat, tail, rear wheel
- Motorcycle is the ONLY subject — no rider, no kickstand in dramatic position
- Clean side profile showing all wrappable surfaces: tank, fairing, tail, fenders`,

  three_quarter_front: `CAMERA — 3/4 FRONT (FRONT-LEFT):
- Camera positioned ~45 degrees forward of the left side
- Slightly above handlebar height looking down at ~15 degrees
- Shows front fairing, headlight, windscreen, tank top, and left side of the bike
- Dramatic hero angle emphasizing front fairing graphics`,

  three_quarter_rear: `CAMERA — 3/4 REAR (REAR-LEFT):
- Camera positioned ~45 degrees behind the left side
- Seat height, looking slightly forward
- Shows tail section, exhaust, rear fender, rear wheel, and left flank
- Hero angle for tail and rear fender graphics`,

  front: `CAMERA — FRONT:
- Camera positioned directly in front of the bike, headlight height
- Shows front fairing, windscreen, headlight, both fork tubes
- Symmetrical framing showing the front face of the motorcycle`,

  rear: `CAMERA — REAR:
- Camera positioned directly behind the bike, tail-light height
- Shows tail section, license plate bracket, rear wheel, exhaust tip
- Symmetrical framing showing the back of the motorcycle`,
};

// ---------------------------------------------------------------------------
// BOAT — 5 views. "Side" means port/starboard hull. No "hood" or "roof".
// ---------------------------------------------------------------------------

export const BOAT_VIEWS: Record<string, string> = {
  side: `CAMERA — PORT SIDE PROFILE:
- Camera positioned at gunwale height, perpendicular to the boat's centerline
- Shoot the entire port (left) side of the hull as the hero view
- Bow on viewer's left, stern on viewer's right
- Frame the complete boat: bow, hull side, topsides, console or cabin, transom
- Boat sits on a clean studio stand or trailer (no water reflection — this is studio)
- Clean side profile showing all wrappable surfaces: hull sides above waterline, topsides, console/cabin`,

  three_quarter_front: `CAMERA — 3/4 BOW (FORWARD-PORT):
- Camera positioned ~45 degrees forward of port side
- Slightly elevated, looking down at ~20 degrees
- Shows bow, port hull side, and deck — dramatic hero angle
- Emphasizes hull graphics and deck layout`,

  three_quarter_rear: `CAMERA — 3/4 STERN (REAR-PORT):
- Camera positioned ~45 degrees behind port side
- Gunwale height, showing transom and port side
- Shows motor/outboard, transom name board, rear deck, port hull`,

  front: `CAMERA — BOW HEAD-ON:
- Camera directly in front of the bow, eye level with the deck
- Symmetrical view showing the V of the hull, bow graphics, bow rails`,

  rear: `CAMERA — STERN HEAD-ON:
- Camera directly behind the stern, gunwale height
- Shows transom, motor(s), name board, swim platform`,
};

// ---------------------------------------------------------------------------
// BUS — 5 views. Side is the money shot for transit/coach livery.
// ---------------------------------------------------------------------------

export const BUS_VIEWS: Record<string, string> = {
  side: `CAMERA — FULL SIDE PROFILE (LEFT):
- Camera positioned at mid-body height, perpendicular to the bus centerline
- FULL body-length hero view — this is the primary canvas for bus wraps
- Front on viewer's left, rear on viewer's right
- Frame the complete bus from front bumper to rear bumper
- All windows visible but unwrapped (factory tint stays)
- Clean side profile showing full livery coverage from wheel arch to roofline`,

  three_quarter_front: `CAMERA — 3/4 FRONT (LEFT):
- Camera ~45 degrees off the front-left corner
- Slightly elevated, ~10 degrees down
- Shows front cap, left side (partial), and windshield
- Captures how the front and side graphics connect`,

  three_quarter_rear: `CAMERA — 3/4 REAR (LEFT):
- Camera ~45 degrees off the rear-left corner
- Shows rear cap, left side, and rear window area
- Captures rear livery and how it wraps from the side`,

  front: `CAMERA — FRONT HEAD-ON:
- Camera directly in front of the bus, headlight height
- Shows front cap, windshield, grille, bumper
- Symmetrical framing`,

  rear: `CAMERA — REAR HEAD-ON:
- Camera directly behind the bus, tail-light height
- Shows rear cap, rear window, tail lights, license plate area
- Symmetrical framing`,

  overhead: `CAMERA — OVERHEAD / ROOF:
- Camera positioned directly above the bus, looking straight down
- Shows the full roof and both sides of the bus from above
- Useful for buses that carry top-mounted graphics or air conditioning units`,
};

// ---------------------------------------------------------------------------
// RV — 5 views. Similar to bus but with RV-specific sub-type considerations.
// ---------------------------------------------------------------------------

export const RV_VIEWS: Record<string, string> = {
  side: `CAMERA — FULL SIDE PROFILE (DRIVER SIDE):
- Camera positioned at mid-body height, perpendicular to the RV centerline
- FULL body-length hero view — the driver's-side slab is the primary wrap canvas
- Front cap on viewer's left, rear cap on viewer's right
- Slide-outs closed (showing factory flush body)
- Clean side profile showing full livery from wheel arch to roofline`,

  three_quarter_front: `CAMERA — 3/4 FRONT (DRIVER SIDE):
- Camera ~45 degrees off the front-driver corner
- Slightly elevated, ~10 degrees down
- Shows front cap, driver side (partial), and windshield
- Hero angle for Class A front-cap graphics`,

  three_quarter_rear: `CAMERA — 3/4 REAR (DRIVER SIDE):
- Camera ~45 degrees off the rear-driver corner
- Shows rear cap, driver side, and rear wall
- Captures rear graphics and how they wrap from the side`,

  front: `CAMERA — FRONT HEAD-ON:
- Camera directly in front of the RV, windshield height
- Shows front cap, windshield, front bumper or chassis grille
- Symmetrical framing`,

  rear: `CAMERA — REAR HEAD-ON:
- Camera directly behind the RV, mid-wall height
- Shows rear cap, rear wall, tail lights, ladder (if present)
- Symmetrical framing`,
};

// ---------------------------------------------------------------------------
// Trailer — 5 views. Side panel is the dominant wrap canvas; rear door is
// a strong secondary surface. No front fascia like a bus/RV — front is a
// flat wall on enclosed cargo, or nothing on open utility/flatbed.
// ---------------------------------------------------------------------------

export const TRAILER_VIEWS: Record<string, string> = {
  side: `CAMERA — FULL SIDE PROFILE (LEFT):
- Camera positioned at mid-body height, perpendicular to the trailer centerline
- FULL body-length hero view — the side panel is the primary canvas for trailer wraps
- Hitch/tongue on viewer's left, rear doors on viewer's right
- Frame the complete trailer from hitch to rear door
- Side panel shown as one continuous uninterrupted flat surface — the wrap runs nearly its full length
- Wheels and fenders visible but unwrapped (stay factory)`,

  three_quarter_front: `CAMERA — 3/4 FRONT (LEFT):
- Camera ~45 degrees off the front-left corner
- Slightly elevated, ~10 degrees down
- Shows front wall (if enclosed) and left side panel
- Captures how front-wall and side graphics connect`,

  three_quarter_rear: `CAMERA — 3/4 REAR (LEFT):
- Camera ~45 degrees off the rear-left corner
- Shows rear doors (the secondary canvas) and left side panel
- Captures rear-door livery and how it wraps from the side`,

  front: `CAMERA — FRONT HEAD-ON:
- Camera directly in front of the trailer, mid-body height
- Shows the front wall (enclosed cargo / race trailers) or open deck framing (utility / flatbed)
- Symmetrical framing
- For open-deck trailers, render the deck and frame factory; wrap only applies to enclosed front walls`,

  rear: `CAMERA — REAR HEAD-ON:
- Camera directly behind the trailer, mid-body height
- Shows rear door panel (cargo/race) or open rear (utility/flatbed)
- Symmetrical framing
- Rear door is a strong secondary wrap canvas — render it as a full design surface`,
};

// ---------------------------------------------------------------------------
// Exported lookup helpers
// ---------------------------------------------------------------------------

export function getMotorcycleView(view: string): string {
  return MOTORCYCLE_VIEWS[view] || MOTORCYCLE_VIEWS.side;
}

export function getBoatView(view: string): string {
  return BOAT_VIEWS[view] || BOAT_VIEWS.side;
}

export function getBusView(view: string): string {
  return BUS_VIEWS[view] || BUS_VIEWS.side;
}

export function getRvView(view: string): string {
  return RV_VIEWS[view] || RV_VIEWS.side;
}

export function getTrailerView(view: string): string {
  return TRAILER_VIEWS[view] || TRAILER_VIEWS.side;
}

// Which views the frontend should offer per class
export const AVAILABLE_VIEWS: Record<string, string[]> = {
  motorcycle: ["side", "three_quarter_front", "three_quarter_rear", "front", "rear"],
  boat: ["side", "three_quarter_front", "three_quarter_rear", "front", "rear"],
  bus: ["side", "three_quarter_front", "three_quarter_rear", "front", "rear", "overhead"],
  rv: ["side", "three_quarter_front", "three_quarter_rear", "front", "rear"],
  trailer: ["side", "three_quarter_rear", "rear", "front", "three_quarter_front"],
};
