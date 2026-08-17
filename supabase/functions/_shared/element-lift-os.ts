/**
 * ═══════════════════════════════════════════════════════════════
 *  TRADE SECRET — CONFIDENTIAL & PROPRIETARY
 *  © 2026 RestylePro / LoopMighty Software Development LLC. All rights reserved.
 *
 *  Proprietary canonical ELEMENT-LIFT taxonomy + validation config —
 *  a TRADE SECRET of RestylePro / LoopMighty Software Development LLC, part of the
 *  DesignIQ™ / GENIE™ / LiftIQ Engine™ architecture (patent-pending
 *  system & methods).
 *
 *  Do NOT copy, publish, distribute, disclose, or reproduce — in
 *  whole or in part — without express written permission.
 *  See /NOTICE and docs/TRADEMARKS.md. Not legal advice.
 * ═══════════════════════════════════════════════════════════════
 */
/**
 * ELEMENT LIFT OS v1.0 — Strict Editable-Element Taxonomy + Slop Gate
 * ==================================================================
 * The single source of truth for WHAT counts as an editable design element
 * (logo / text / design-graphic) and the VALIDATION that keeps AI slop —
 * wheels, fenders, window crops, opaque photo blobs — out of admin.
 *
 * THE LAW:
 *   1. Lift from the FLAT ARTBOARD, never the 3D render. DesignProAI is
 *      artboard-FIRST: the prompt makes a flat artboard (clean wrap + logo +
 *      text + design graphics, NO vehicle), then RecreatePro renders the 3D.
 *      A flat artboard structurally CANNOT contain a wheel to misread — that is
 *      the primary slop defense. liftSourceTrust() encodes this.
 *   2. EVERY cutout passes validateLiftedElement() before it can reach a
 *      container. A real lifted element (logo/text/graphic) is a compact mark
 *      surrounded by transparency; a wheel/fender crop is a near-solid opaque
 *      rectangle. The opacity gate rejects the blob. Nothing unvalidated is ever
 *      written to overlay_pngs / element_layers — admin sees a real element or
 *      nothing, never slop.
 *
 * This is the element-side counterpart to view-angles-os.ts and
 * panel-templates-os.ts: a strict spec the lift engine is PASSED, not a loose
 * "ask the AI and hope."
 */

/** The editable element kinds, in stack order (background sits below all). */
export type ElementRole = "logo" | "text" | "design_element";

/**
 * Detected-type → editable role. extract-logo-elements returns loose types
 * (logo/text/wordmark/phone/url/graphic/…); this is the ONLY place that decides
 * what becomes an editable layer and under which role.
 *
 *  - logo / wordmark / emblem     → "logo"
 *  - text / headline / contact /
 *    phone / url / tagline / menu → "text"
 *  - graphic / shape / accent /
 *    stripe / pattern / artwork   → "design_element"
 *
 * Anything else returns null = NOT liftable (stays baked / ignored).
 */
export function classifyElementRole(detectedType: string): ElementRole | null {
  const t = (detectedType || "").toLowerCase().trim();
  if (/(logo|wordmark|emblem|brand ?mark|icon)/.test(t)) return "logo";
  if (/(text|headline|title|contact|phone|url|web|tagline|slogan|menu|address|copy|lettering)/.test(t)) return "text";
  if (/(graphic|shape|accent|stripe|swoosh|flame|pattern|artwork|element|design|splash|burst)/.test(t)) return "design_element";
  return null;
}

/** Human label for a role (admin "Lifted Layers" chips). */
export const ROLE_LABELS: Record<ElementRole, string> = {
  logo: "Logo",
  text: "Text",
  design_element: "Design element",
};

/**
 * GEOMETRY GUARDS (normalized 0..1 bounding boxes).
 * A region that fails any of these is NOT a discrete editable element.
 */
// Never lift a region covering most of the panel — that's the hero artwork /
// the whole background, not a discrete element.
export const MAX_REGION_AREA = 0.5;
// A discrete element must be at least this share of the panel — smaller is noise.
export const MIN_REGION_AREA = 0.0008;
// A wide+thin bar (contact strip / menu list) stays BAKED; a tall wordmark lifts.
export const THIN_BAR_ASPECT = 5;
export const THIN_BAR_MAX_HEIGHT = 0.1;

export interface DetectedRegion {
  x: number; y: number; width: number; height: number;
}

/**
 * Geometry gate on a detected region. Returns the reason it's rejected, or null
 * if the region's shape/size is consistent with a discrete editable element.
 */
export function rejectRegionReason(r: DetectedRegion): string | null {
  if (!(r.width > 0) || !(r.height > 0)) return "zero-size";
  const area = r.width * r.height;
  if (area > MAX_REGION_AREA) return "too-large (hero artwork / background)";
  if (area < MIN_REGION_AREA) return "too-small (noise)";
  const aspect = r.width / r.height;
  if (aspect >= THIN_BAR_ASPECT && r.height <= THIN_BAR_MAX_HEIGHT) return "wide-thin bar (stays baked)";
  return null;
}

/**
 * OPACITY SLOP GATE — the deterministic wheel/fender rejector.
 *
 * A real lifted element is a compact mark floating in transparency:
 *   - logo: opaque pixels form the mark, lots of clear space around → mid/low ratio
 *   - text: thin strokes on clear → LOW opaque ratio
 *   - design graphic: bolder, but still has transparent gaps → mid ratio
 * A misread vehicle part (wheel, fender, window) comes back as a near-SOLID
 * rectangle of photo pixels → opaque ratio ≈ 1.0. That is the tell.
 *
 * opaqueRatio = (# pixels with alpha above OPAQUE_ALPHA) / (total pixels).
 * Reject when the cutout is essentially a solid block (a photo blob) or empty.
 */
export const OPAQUE_ALPHA = 16;          // alpha > this counts as "opaque"
export const MAX_OPAQUE_RATIO = 0.9;     // ≥ this = solid photo blob (wheel/fender) → reject
export const MIN_OPAQUE_RATIO = 0.004;   // ≤ this = effectively empty → reject

export interface LiftValidation {
  ok: boolean;
  reason?: string;
  opaqueRatio?: number;
}

/**
 * Validate ONE lifted transparent-PNG cutout from its opaque-pixel ratio.
 * The caller decodes the cutout (ideally downscaled) and passes the ratio.
 * When the ratio can't be measured (decode failed) and the source is the trusted
 * flat artboard, we allow it through (sourceTrusted); from an untrusted render we
 * reject, because the render is exactly where the wheel slop comes from.
 */
export function validateLiftedElement(
  opaqueRatio: number | null,
  sourceTrusted: boolean,
): LiftValidation {
  if (opaqueRatio == null || !isFinite(opaqueRatio)) {
    return sourceTrusted
      ? { ok: true, reason: "unmeasured-but-trusted-artboard" }
      : { ok: false, reason: "unmeasured-untrusted-render" };
  }
  if (opaqueRatio >= MAX_OPAQUE_RATIO) return { ok: false, reason: "solid-opaque-blob (vehicle part / photo)", opaqueRatio };
  if (opaqueRatio <= MIN_OPAQUE_RATIO) return { ok: false, reason: "empty-cutout", opaqueRatio };
  return { ok: true, opaqueRatio };
}

/**
 * Source trust: lifting from the flat ARTBOARD is trusted (no vehicle parts to
 * misread); lifting from a 3D RENDER is untrusted (the slop source) and must be
 * gated hard. `kind` is whatever the caller knows about the lift source URL.
 */
export function liftSourceTrust(kind: "artboard" | "render" | "unknown"): boolean {
  return kind === "artboard";
}

/**
 * The DETECTION DIRECTIVE passed to the vision step when scanning the FLAT
 * ARTBOARD for elements. Kept here so the contract lives with the taxonomy.
 */
export const ELEMENT_DETECTION_DIRECTIVE =
  `This is a FLAT 2D wrap ARTBOARD (no vehicle, no wheels, no perspective). ` +
  `Detect each DISCRETE design element as its own region: the LOGO/emblem, each ` +
  `TEXT block (company name, tagline, phone, URL — each as its own region), and ` +
  `each distinct DESIGN GRAPHIC (stripe, swoosh, flame, accent shape). Return ` +
  `tight normalized bounding boxes. Do NOT return the whole background as one ` +
  `region. There are no vehicle parts in this image — never report a wheel, ` +
  `window, tire, or body panel.`;
