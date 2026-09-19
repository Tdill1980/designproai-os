"use strict";
/**
 * runtime/atlas-proof-panels.cjs — THE THREE QUADRANTS, CUT OUT AND SHIPPED.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Owner, 2026-09-18, stating what the sheet IS: "the three quadrants ... panels
 * with the graphics, panels without the overlay graphic just the design, and
 * the graphic overlays by themselves." And: "each template will have different
 * size rectangles based on vehicle type."
 *
 * The proof sheet is a DOCUMENT. What production consumes are the rectangles
 * inside it, and until now nothing cut them: `atlas-proof-zone-gate.cjs`
 * measured the cells and threw the pixels away. This turns each cell into an
 * artifact.
 *
 *   zone 1  ->  the branded production panel     (design + text + logo)
 *   zone 2  ->  the clean/background panel       (the same design, no overlay)
 *   zone 3  ->  the cut graphics                 (the overlays by themselves)
 *
 * Zones 1/2 use detected rectangles inside the proof's known bands. Physical
 * aspect ratios identify distinct surfaces; overlapping aspect candidates need
 * a unique template-position anchor. Detection order never supplies identity.
 * Ambiguous layouts are refused. Zone 3 remains unverified raster slot crops
 * until the separate overlay-compositor phase.
 *
 * No model call or new artwork producer is introduced here.
 */

const PANELS_CONTRACT = "designpro.atlas-proof-panels.v2";

const { containerLayout } = require("./atlas-proof-container-template.cjs");
const { PROOF_REGIONS } = require("./atlas-panel-proof-contract.cjs");
const { locatePanels, COARSE_WIDTH, ERODE_PASSES } = require("./atlas-proof-panel-locator.cjs");

const MAX_IDENTITY_ASPECT_DRIFT = 1.05;
const MIN_POSITION_OVERLAP = 0.8;

// Match against geometry, never against the detector's array order. Equal or
// near-equal aspect surfaces require a unique spatial anchor in the template.
// Reflowed identical flanks therefore refuse rather than being guessed.
function identifyPanels(detected, cells, layout, sheet) {
  if (detected.length !== cells.length) {
    return { refused: `panel_count:${detected.length}!=${cells.length}` };
  }
  const assignments = [];
  const used = new Set();
  for (const panel of detected) {
    const { x, y, w, h } = panel;
    if (![x, y, w, h].every(Number.isInteger) || x < 0 || y < 0
      || w <= 0 || h <= 0 || x + w > sheet.width || y + h > sheet.height) {
      return { refused: "panel_bounds_invalid" };
    }
    const aspect = w / h;
    const candidates = cells.filter((cell) => {
      const expected = cell.widthIn / cell.heightIn;
      return Number.isFinite(expected) && expected > 0
        && Math.max(aspect / expected, expected / aspect) <= MAX_IDENTITY_ASPECT_DRIFT;
    });
    let matches = candidates;
    let method = "aspect";
    if (candidates.length > 1) {
      method = "aspect-and-template-position";
      matches = candidates.filter((cell) => {
        const anchor = scaleCell(cell, layout, sheet);
        const overlapW = Math.max(0, Math.min(x + w, anchor.left + anchor.width) - Math.max(x, anchor.left));
        const overlapH = Math.max(0, Math.min(y + h, anchor.top + anchor.height) - Math.max(y, anchor.top));
        const overlap = overlapW * overlapH;
        // Require mutual overlap, not merely a small crop somewhere in a cell.
        return overlap / (w * h) >= MIN_POSITION_OVERLAP
          && overlap / (anchor.width * anchor.height) >= MIN_POSITION_OVERLAP;
      });
    }
    if (matches.length !== 1) {
      return { refused: `panel_identity_ambiguous:${x},${y},${w},${h}:candidates=${candidates.map((c) => c.surfaceKey).join(",") || "none"}` };
    }
    const cell = matches[0];
    if (used.has(cell.surfaceKey)) return { refused: `panel_identity_duplicate:${cell.surfaceKey}` };
    used.add(cell.surfaceKey);
    assignments.push({ cell, rect: { left: x, top: y, width: w, height: h },
      identity: { method, aspect, candidates: candidates.map((c) => c.surfaceKey) } });
  }
  if (used.size !== cells.length) return { refused: "panel_identity_incomplete" };
  return { assignments };
}

/** The three quadrants, by the role each plays downstream. */
const QUADRANTS = Object.freeze({
  zone1: "branded",
  zone2: "clean",
  zone3: "cut-graphic",
});

/**
 * Scale a container cell onto the sheet that actually came back.
 *
 * The container is authored at 1536x1024 and the model returns ~5056x3392, so
 * every rectangle is proportional rather than absolute. Rounded OUTWARD on the
 * far edge and clamped to the sheet, because a half-pixel short on a panel edge
 * is a white hairline down the print and sharp throws on an extract that runs
 * past the image.
 */
function scaleCell(cell, layout, sheet) {
  const sx = sheet.width / layout.width;
  const sy = sheet.height / layout.height;
  const left = Math.max(0, Math.floor(cell.x * sx));
  const top = Math.max(0, Math.floor(cell.y * sy));
  const width = Math.min(sheet.width - left, Math.max(1, Math.ceil(cell.w * sx)));
  const height = Math.min(sheet.height - top, Math.max(1, Math.ceil(cell.h * sy)));
  return { left, top, width, height };
}

/**
 * HOW MUCH OF THE CELL IS ACTUALLY PAINTED.
 *
 * The one honest signal that the model filled this rectangle rather than
 * arranging its own. Deliberately the crudest possible measure — the share of
 * pixels that are not the page — because anything cleverer would be a second
 * definition of "artwork" competing with the gates that already own it.
 */
async function inkFraction(sharp, bytes, rect) {
  const { data, info } = await sharp(bytes)
    .extract(rect)
    .resize({ width: 64, height: 64, fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let ink = 0;
  const total = info.width * info.height;
  for (let i = 0; i < data.length; i += info.channels) {
    // Page is white; anything meaningfully darker is paint.
    if (data[i] < 246 || data[i + 1] < 246 || data[i + 2] < 246) ink += 1;
  }
  return total ? Number((ink / total).toFixed(4)) : 0;
}

/**
 * Cut every quadrant's cells out of a returned proof sheet.
 *
 * @returns {{contract, sheet, panels, refused}} — `panels` carry BYTES; the
 *   caller stores them under their own sha256 and is what binds them to a
 *   revision. Storing is deliberately not this function's job: it is pure
 *   pixels in, pixels out, which is what makes it testable without a bucket.
 */
async function cutProofPanels({
  proofBytes,
  manifest,
  zones = ["zone1", "zone2", "zone3"],
  sharp = require("sharp"),
} = {}) {
  const layout = containerLayout(manifest);
  const meta = await sharp(proofBytes).metadata();
  if (!meta.width || !meta.height) throw new Error("atlas_proof_panels_unreadable_sheet");
  const sheet = { width: meta.width, height: meta.height };

  // A SHEET OF THE WRONG SHAPE MAKES EVERY RECTANGLE MEANINGLESS. The edge's
  // own shape gate already refuses a genuine re-flow before it reaches here;
  // this is the second door, because cutting against a stretched sheet would
  // produce six plausible panels of the wrong regions.
  const wantAspect = layout.width / layout.height;
  const gotAspect = sheet.width / sheet.height;
  if (Math.abs(gotAspect - wantAspect) / wantAspect > 0.02) {
    return {
      contract: PANELS_CONTRACT,
      sheet,
      panels: [],
      refused: `atlas_proof_panels_aspect_drift:${gotAspect.toFixed(3)}!=${wantAspect.toFixed(3)}`,
    };
  }

  const panels = [];
  for (const zone of zones) {
    const cells = layout[zone];
    if (!Array.isArray(cells)) throw new Error(`atlas_proof_panels_unknown_zone:${zone}`);
    let assignments;
    if (zone === "zone1" || zone === "zone2") {
      const located = await locatePanels({ proofBytes, band: PROOF_REGIONS[zone], sharp });
      // The locator returns components after erosion at COARSE_WIDTH. Restore
      // that known inset before measuring aspect or extracting source artwork.
      const inset = Math.ceil(ERODE_PASSES * located.region.width / COARSE_WIDTH);
      const bounds = located.panels.map((p) => {
        const x = Math.max(located.region.left, p.x - inset);
        const y = Math.max(located.region.top, p.y - inset);
        const right = Math.min(located.region.left + located.region.width, p.x + p.w + inset);
        const bottom = Math.min(located.region.top + located.region.height, p.y + p.h + inset);
        return { ...p, x, y, w: right - x, h: bottom - y };
      });
      const identified = identifyPanels(bounds, cells, layout, sheet);
      if (identified.refused) {
        return { contract: PANELS_CONTRACT, sheet, panels: [],
          refused: `atlas_proof_panels_${zone}:${identified.refused}` };
      }
      assignments = identified.assignments;
    } else {
      // Phase 2 owns overlay extraction. These remain explicitly unverified.
      assignments = cells.map((cell) => ({ cell, rect: scaleCell(cell, layout, sheet), identity: null }));
    }
    for (const { cell, rect, identity } of assignments) {
      const bytes = await sharp(proofBytes)
        .extract(rect)
        .png({ compressionLevel: 9 })
        .toBuffer();
      panels.push({
        zone,
        role: QUADRANTS[zone],
        surfaceKey: cell.surfaceKey,
        // The PRINT geometry this rectangle stands for, carried through from
        // GENIE so the panel knows its own inches without a second lookup.
        // Zone 3 slots have none: a cut graphic is sized at the plotter.
        widthIn: cell.widthIn ?? null,
        heightIn: cell.heightIn ?? null,
        rect,
        bytes,
        byteSize: bytes.length,
        fit: await inkFraction(sharp, proofBytes, rect),
        positionalPremiseVerified: identity !== null,
        identity,
        // Geometric identity is not semantic/logo correctness or human QC.
        productionApproved: false,
      });
    }
  }

  return { contract: PANELS_CONTRACT, sheet, panels, refused: null };
}

module.exports = { PANELS_CONTRACT, QUADRANTS, cutProofPanels, scaleCell };
