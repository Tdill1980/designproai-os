/**
 * keep-clear-os.ts — Obstruction / keep-clear map for wrap design placement.
 *
 * PLACEMENT GUIDANCE ONLY — NOT geometry. Panels stay full rectangles (the
 * panelizer never cuts for a door or a wheel arch). This map tells the
 * artboard designer (A.C.E) WHERE the install cuts and body breaks land —
 * the rear man-door on an enclosed trailer, the wheel arches, door handles —
 * so the logo / business name / phone number get composed CLEAR of those
 * zones and the install cut never slices through branding. The zones are
 * filled with pattern/background, not text.
 *
 * Used by approvepro-autogen-design's artboard pass. The locked render engine
 * (design-panel-ai-generate) is NOT modified — this only enriches the prompt
 * text passed in from the orchestrator.
 */

export type WrapBodyType =
  | "enclosed_trailer"
  | "box_truck"
  | "pickup"
  | "van"
  | "suv"
  | "car";

const ENCLOSED_TRAILER_RE =
  /\btrailers?\b|\benclosed\b|\bgooseneck\b|\bflatbed\b|\bcargo\s*trailer\b|\butility\s*trailer\b|\bconcession\b/i;
const BOX_TRUCK_RE =
  /\bbox\s*truck\b|\bbox\s*van\b|\bcube\s*van\b|\bstraight\s*truck\b|\bbox\b/i;
const VAN_RE = /\bvan\b|\bsprinter\b|\btransit\b|\bpromaster\b|\bsavana\b|\bexpress\b/i;
const PICKUP_RE = /\bpickup\b|\btruck\b|\bf-?150\b|\bsilverado\b|\bram\b|\bsierra\b|\btundra\b|\btacoma\b|\bcolorado\b/i;
const SUV_RE = /\bsuv\b|\bsuburban\b|\btahoe\b|\bexpedition\b|\bescalade\b|\bjeep\b|\bexplorer\b|\b4runner\b/i;

/**
 * Detect the wrap body type from free text (brief + make + model + design name).
 * Order matters: the most install-distinct bodies (trailer, box) win first.
 */
export function detectWrapBodyType(text: string): WrapBodyType {
  const t = text || "";
  if (BOX_TRUCK_RE.test(t)) return "box_truck";
  if (ENCLOSED_TRAILER_RE.test(t)) return "enclosed_trailer";
  if (VAN_RE.test(t)) return "van";
  if (PICKUP_RE.test(t)) return "pickup";
  if (SUV_RE.test(t)) return "suv";
  return "car";
}

// Per-body keep-clear copy. Kept SHORT (Gemini image quality degrades with long
// prompts — see CLAUDE.md) and framed as placement direction, not negatives.
const KEEP_CLEAR_BY_BODY: Record<WrapBodyType, string> = {
  enclosed_trailer:
    "This is an enclosed trailer. Keep the logo, business name, and phone number on the clear left ~60% of each side, well away from the rear man-door (right ~28% of the side) and the lower wheel-arch band (bottom ~18%). Let the pattern/background flow through the door and wheel zones; no critical text there.",
  box_truck:
    "This is a box truck. Place the logo, business name, and phone number on the upper-center of the box, clear of the rear roll-up door seams (right edge) and the lower wheel/fender band (bottom ~18%). Background art may run through those zones; keep text out of them.",
  van:
    "This is a van. Keep the logo, business name, and phone number centered on the clear sliding-door / quarter-panel area, clear of the door handles, fuel door, and wheel arches (bottom ~18%). Pattern fills those zones; no critical text on them.",
  pickup:
    "This is a pickup. Place branding on the clear door and bed panels, clear of the wheel arches (bottom ~20%), door handles, and the bed-to-cab gap. Background art runs through those breaks; keep text off them.",
  suv:
    "This is an SUV. Keep the logo, business name, and phone number on the clear door/quarter-panel area, clear of the wheel arches (bottom ~18%), door handles, and body seams. Pattern fills those zones.",
  car:
    "Keep the logo, business name, and phone number on the clear door/quarter-panel area, clear of the wheel arches (bottom ~18%), door handles, fuel door, and body seams. Pattern fills those zones; no critical text on them.",
};

/**
 * Keep-clear placement guidance for the given body type. Append to the artboard
 * design prompt so logos/text land where the install cut won't slice them.
 */
export function keepClearGuidance(bodyType: WrapBodyType): string {
  return `KEEP-CLEAR (placement only, panels stay full rectangles): ${KEEP_CLEAR_BY_BODY[bodyType]}`;
}

/** Convenience: detect from text and return the guidance in one call. */
export function keepClearGuidanceFromText(text: string): string {
  return keepClearGuidance(detectWrapBodyType(text));
}
