"use strict";
/**
 * runtime/atlas-element-lockup.cjs — ARCHITECTURE_DAG.md §4.5.
 *
 * Takes the finished element REFERENCES and resolves where each one sits on each
 * surface, as normalized `{xPct, yPct, wPct, hPct}` boxes — the vocabulary
 * RestylePro already uses (`src/lib/buildProductionPanels.ts:606-635`,
 * `flatMasterSheet.ts:97`). Zero AI, zero network, zero pixels: it reads the
 * elements' dimensions and the manifest's zones and returns a plan.
 *
 * THE COORDINATE SPACE IS THE SURFACE'S OWN TRIM RECTANGLE, IN THE PANEL'S
 * READING ORIENTATION. Not the 4096 sheet, and not the zone including bleed.
 * Stating that precisely is not pedantry: a flank is rotated 90° on the sheet,
 * and "which space is this box in" is exactly the ambiguity that produced four
 * separate passenger-lettering defects when placement was reconstructed from
 * pixels after the fact.
 *
 * WHAT IS GEOMETRY, AND WHAT IS TASTE
 *
 * Geometry — derived, not chosen, and not up for debate:
 *   - aspect ratio is PRESERVED. Because the axes are normalized against
 *     different pixel dimensions, holding an element's shape means
 *       hPct = wPct x (elementH / elementW) x (trimWpx / trimHpx)
 *     Getting this wrong stretches a customer's logo, which is the kind of
 *     defect nobody notices until it is printed.
 *   - the passenger box is the driver box MIRRORED: xPct' = 1 - xPct - wPct.
 *     Same mapping RULE 0.36 already uses to move a band into driver space. The
 *     element itself is composited UN-flipped, so the mark lands in the same
 *     physical place on the vehicle and still reads left to right. That is the
 *     entire payoff of the port: nothing to read back off the flank, nothing to
 *     paste over.
 *   - nothing may leave the safe area, and a stack too tall for it is scaled
 *     down as a GROUP, so the arrangement never breaks up.
 *
 * Taste — defaults, each a single named constant, all the owner's to change:
 *   ELEMENT_SURFACES, LOCKUP_WIDTH_PCT, SAFE_MARGIN_PCT, STACK_GAP_PCT,
 *   STACK_ORDER, HORIZONTAL_ANCHOR, VERTICAL_ANCHOR.
 */

const CONTRACT = "designpro.atlas-element-lockup.v1";

/**
 * The flanks only, for now. Both of this file's own evidence sheets put the
 * company name on the two flanks -- the 2026-09-04 Arctic Air Prius and the
 * 2026-09-08 Precision master. Hood, roof, front and rear carry no element
 * until the owner rules on each, because inventing a rear contact bar is a
 * design decision, not a geometric one.
 */
const ELEMENT_SURFACES = Object.freeze(["driver", "passenger"]);
/** The flank the lockup is composed ON. Passenger mirrors it. */
const PRIMARY_SURFACE = "driver";

const LOCKUP_WIDTH_PCT = 0.34;   // of the trim width; "readable from across a parking lot"
const SAFE_MARGIN_PCT = 0.08;    // of each axis, inside the trim
const STACK_GAP_PCT = 0.03;      // of trim height, between stacked elements
const STACK_ORDER = Object.freeze(["logo", "typography", "contact"]);
const HORIZONTAL_ANCHOR = "left";
const VERTICAL_ANCHOR = "middle";

class AtlasLockupError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AtlasLockupError";
    this.code = code;
  }
}

const round = (n) => Math.round(n * 1e6) / 1e6;

/**
 * The trim rectangle's pixel size in the PANEL'S READING ORIENTATION. A flank
 * sits rotated on the sheet, so its displayed width is the panel's height.
 */
function readingTrimSize(zone) {
  const trim = zone?.trim;
  if (!trim || !(trim.w > 0) || !(trim.h > 0)) {
    throw new AtlasLockupError("atlas_lockup_zone_invalid", `${zone?.surfaceKey}: zone carries no usable trim rectangle`);
  }
  const rotated = Math.abs(Number(zone.rotationDegrees) || 0) === 90;
  return rotated ? { w: trim.h, h: trim.w } : { w: trim.w, h: trim.h };
}

/**
 * Plan the lockup.
 *
 * @param {object[]} zones     the run manifest's zones
 * @param {object[]} elements  [{role, width, height, ...reference}] -- dimensions only
 * @returns a placement manifest, or null when there is nothing to place
 */
function planElementLockup({ zones = [], elements = [] } = {}) {
  const present = STACK_ORDER
    .map((role) => elements.find((e) => e && e.role === role))
    .filter(Boolean);
  if (!present.length) return null;

  for (const element of present) {
    if (!(element.width > 0) || !(element.height > 0)) {
      throw new AtlasLockupError("atlas_lockup_element_invalid", `${element.role}: element carries no usable dimensions`);
    }
  }

  const zone = zones.find((z) => z?.surfaceKey === PRIMARY_SURFACE);
  if (!zone) throw new AtlasLockupError("atlas_lockup_zone_invalid", `${PRIMARY_SURFACE} zone missing`);
  const trim = readingTrimSize(zone);

  // Every element is drawn at the same width so the stack reads as one lockup;
  // each keeps its OWN height, from its own aspect ratio.
  const wPct = LOCKUP_WIDTH_PCT;
  const sized = present.map((element) => ({
    role: element.role,
    contentHash: element.contentHash || null,
    storagePath: element.storagePath || null,
    // IDENTITY IS ALL THREE (RULE 0.39). downloadVerified checks path, hash AND
    // byte length, so a plan carrying only two of them cannot be read back.
    byteSize: Number(element.byteSize) || null,
    wPct,
    hPct: wPct * (element.height / element.width) * (trim.w / trim.h),
  }));

  const gaps = STACK_GAP_PCT * (sized.length - 1);
  const stackHeight = sized.reduce((sum, s) => sum + s.hPct, 0) + gaps;

  // NOTHING LEAVES THE SAFE AREA. A stack too tall is scaled as a GROUP, so the
  // arrangement survives rather than one element shrinking out of proportion.
  const available = 1 - 2 * SAFE_MARGIN_PCT;
  const scale = stackHeight > available ? available / stackHeight : 1;
  const scaledGap = STACK_GAP_PCT * scale;
  const scaled = sized.map((s) => ({ ...s, wPct: s.wPct * scale, hPct: s.hPct * scale }));
  const scaledHeight = scaled.reduce((sum, s) => sum + s.hPct, 0) + scaledGap * (scaled.length - 1);

  const top = VERTICAL_ANCHOR === "middle"
    ? (1 - scaledHeight) / 2
    : SAFE_MARGIN_PCT;
  const left = HORIZONTAL_ANCHOR === "left"
    ? SAFE_MARGIN_PCT
    : (1 - (scaled[0]?.wPct || 0)) / 2;

  const placements = [];
  let y = top;
  for (const element of scaled) {
    const driverBox = { xPct: round(left), yPct: round(y), wPct: round(element.wPct), hPct: round(element.hPct) };
    for (const surfaceKey of ELEMENT_SURFACES) {
      // THE MIRROR IS THE BOX, NEVER THE ELEMENT. Same physical place on the
      // vehicle; the artwork is composited un-flipped so it still reads.
      const box = surfaceKey === PRIMARY_SURFACE
        ? driverBox
        : { ...driverBox, xPct: round(1 - driverBox.xPct - driverBox.wPct) };
      placements.push({
        surfaceKey,
        role: element.role,
        storagePath: element.storagePath,
        contentHash: element.contentHash,
        byteSize: element.byteSize,
        box,
        mirroredFrom: surfaceKey === PRIMARY_SURFACE ? null : PRIMARY_SURFACE,
        flipped: false,
      });
    }
    y += element.hPct + scaledGap;
  }

  for (const placement of placements) {
    const { xPct, yPct, wPct: w, hPct: h } = placement.box;
    if (xPct < 0 || yPct < 0 || xPct + w > 1 || yPct + h > 1) {
      throw new AtlasLockupError(
        "atlas_lockup_out_of_bounds",
        `${placement.surfaceKey}/${placement.role} leaves the panel: ${JSON.stringify(placement.box)}`,
      );
    }
  }

  return {
    contract: CONTRACT,
    primarySurface: PRIMARY_SURFACE,
    surfaces: [...ELEMENT_SURFACES],
    arrangement: {
      stackOrder: scaled.map((s) => s.role),
      horizontalAnchor: HORIZONTAL_ANCHOR,
      verticalAnchor: VERTICAL_ANCHOR,
      lockupWidthPct: LOCKUP_WIDTH_PCT,
      safeMarginPct: SAFE_MARGIN_PCT,
      stackGapPct: STACK_GAP_PCT,
      groupScale: round(scale),
    },
    placements,
    deterministic: true,
  };
}

module.exports = {
  CONTRACT,
  AtlasLockupError,
  ELEMENT_SURFACES,
  PRIMARY_SURFACE,
  LOCKUP_WIDTH_PCT,
  SAFE_MARGIN_PCT,
  STACK_GAP_PCT,
  STACK_ORDER,
  readingTrimSize,
  planElementLockup,
};
