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
 * WHY THIS IS NOT "A CROP OF THE MASTER" WITH A NEW NAME. RULE 0.21 already
 * requires the print panel to be a deterministic separation of the accepted
 * source, never an AI re-render and never a browser crop, and RULE 0.27
 * requires the geometry to come from code. Both hold here: the rectangles are
 * `containerLayout`'s own cells — the SAME function that DREW them — scaled to
 * whatever size the sheet came back at. Deriving them a second time somewhere
 * else is how a drawing and its cutter drift apart.
 *
 * ⚠️ THE POSITIONAL PREMISE IS NOT PROVEN, AND THIS SAYS SO RATHER THAN
 * PRETENDING. `atlas-proof-zone-gate.cjs` records it as falsified on live sheet
 * d5314267: the model keeps the bands and the panel identities and then
 * arranges the panels itself, so a cell rectangle is where the CONTAINER put a
 * panel, not provably where the proof drew one. Four live sheets have kept the
 * order (driver, passenger, roof, hood, front, rear, left to right) and none
 * has reordered or dropped one — but four is not a law, so every panel carries
 * `positionalPremiseVerified: false` and a `fit` measurement, and PanelPro's
 * human QC is what turns a cut rectangle into an approved production panel.
 * Do not promote these to canonical print artwork on the strength of the
 * geometry alone.
 *
 * NO MODEL CALL, NO SECOND PRODUCER OF DESIGN. sharp.extract and nothing else.
 */

const PANELS_CONTRACT = "designpro.atlas-proof-panels.v1";

const { containerLayout } = require("./atlas-proof-container-template.cjs");

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
    for (const cell of cells) {
      const rect = scaleCell(cell, layout, sheet);
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
        // See the header: four live sheets have held the order and that is not
        // a proof. A consumer that needs certainty asks a human, not this flag.
        positionalPremiseVerified: false,
      });
    }
  }

  return { contract: PANELS_CONTRACT, sheet, panels, refused: null };
}

module.exports = { PANELS_CONTRACT, QUADRANTS, cutProofPanels, scaleCell };
