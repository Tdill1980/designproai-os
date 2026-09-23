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
 * Zones 1/2 use the Studio template rectangles authored from GENIE geometry
 * before Gemini runs. Those coordinates are the surface identity; generated
 * pixels are never re-detected or counted. Zone 3 remains unverified raster slot crops
 * until the separate overlay-compositor phase.
 *
 * No model call or new artwork producer is introduced here.
 */

const PANELS_CONTRACT = "designpro.atlas-proof-panels.v2";

const { containerLayout } = require("./atlas-proof-container-template.cjs");
const { PROOF_REGIONS } = require("./atlas-panel-proof-contract.cjs");

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
async function inkFraction(sharp, bytes, rect = null) {
  // `rect` is the cell's rectangle ON THE SHEET. Omitted, the bytes ARE the
  // panel -- which is the case once a panel has been re-authored on its own
  // canvas. Measuring the refined panel with a sheet rectangle would extract a
  // corner of it and call that the paint density of the whole thing.
  const pipeline = sharp(bytes);
  if (rect) pipeline.extract(rect);
  const { data, info } = await pipeline
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
      // Studio authored these cells from GENIE geometry before Gemini ran.
      // Their coordinates are therefore the authority. Do NOT re-detect/count
      // rectangles from generated pixels: that redundant locator produced the
      // live 3<6 / 5<6 / 7!=6 false refusals and blocked valid customer work.
      assignments = cells.map((cell) => ({
        cell,
        rect: scaleCell(cell, layout, sheet),
        identity: {
          method: "studio-template-cell",
          surfaceKey: cell.surfaceKey,
          geometryAuthority: "GENIE",
        },
        opaqueEdgeExtensionPx: 0,
        opaqueEdgeExtensionBoundedToBand: true,
      }));
    } else {
      // Phase 2 owns overlay extraction. These remain explicitly unverified.
      assignments = cells.map((cell) => ({ cell, rect: scaleCell(cell, layout, sheet), identity: null, opaqueEdgeExtensionPx: 0, opaqueEdgeExtensionBoundedToBand: false }));
    }
    for (const { cell, rect, identity, opaqueEdgeExtensionPx = 0, opaqueEdgeExtensionBoundedToBand = false } of assignments) {
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
        opaqueEdgeExtensionPx,
        opaqueEdgeExtensionBoundedToBand,
        // Geometric identity is not semantic/logo correctness or human QC.
        productionApproved: false,
      });
    }
  }

  return { contract: PANELS_CONTRACT, sheet, panels, refused: null };
}

module.exports = { PANELS_CONTRACT, QUADRANTS, cutProofPanels, scaleCell, inkFraction };
